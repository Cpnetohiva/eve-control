# Contexto EVE Control — Handoff para nueva conversación
**Fecha de corte:** 23/09/2026

---

## 1. Datos del proyecto

- **Producción:** https://cpnetohiva.github.io/eve-control/
- **Repo remoto:** https://github.com/Cpnetohiva/eve-control.git
- **Carpeta local:** `eve-control-v2` (`C:\Users\cpnet\OneDrive\Escritorio\EVERPLASTIC COO\eve-control-v2`) — el nombre de la carpeta no coincide con el del repo, pero sí es el clon correcto.
- **⚠️ Trampa conocida:** `git status`/`git remote -v` corridos desde `EVERPLASTIC COO` (carpeta padre) reportan falsamente "not a git repository". Siempre verificar parado DENTRO de `eve-control-v2`.
- **Backend:** Firebase (proyecto `everplastic`), Firestore + Firebase Authentication. Auth vía `cpnetohiva@gmail.com`.
- **Hosting:** GitHub Pages, publica ÚNICAMENTE desde `master`. Sin ambiente dev/staging — toda prueba real requiere push a producción primero.
- **Nuevo (23/09/2026): Cloudflare Worker** en `cloudflare-worker/` (repo `eve-control-worker`, desplegado en https://eve-control-worker.cpnetohiva.workers.dev). Accede a Firestore vía REST + Web Crypto (SubtleCrypto), firmando JWTs con el service account — NO usa `firebase-admin` (su cliente gRPC es incompatible con el runtime de Workers, incluso con `nodejs_compat`). Ver sección 5 para el detalle completo. `service-account.json` y `.dev.vars` viven solo localmente, nunca trackeados (`.gitignore` de `cloudflare-worker/`).
- **Sin Playwright ni automatización de navegador** en el entorno de Claude Code. Todas las pruebas las hace Neto manualmente (excepción puntual: en la sesión del 23/09 sí se pudo levantar un servidor estático local con `npx serve` para pruebas de integración del candado de dispositivos, limitado por CORS al no ser el origen de producción).
- **Sin emulador local funcional** — Firestore Emulator Suite requiere JDK 21+, solo hay Java 8 en el sistema.

---

## 2. Metodología de trabajo (no cambia entre sesiones)

- Claude Code es el agente de ejecución; esta conversación es la capa de planeación/asesoría. Neto revisa diagnósticos aquí, decide, y recibe prompts exactos para pegar en Claude Code.
- Claude Code NO actúa de forma autónoma en acciones de alto impacto (deploy de Firestore Rules, borrado de datos de producción, creación de usuarios) sin aprobación explícita. **Actualizado 22/09/2026:** se tomó una decisión operativa puntual sobre el nivel de autonomía permitido para agregar bloques *nuevos y aislados* de `firestore.rules` (caso concreto: `cuentas_por_cobrar`/`cobros`, commit `13550df`) — confirmar con Neto el alcance exacto de esta política antes de asumir que aplica a cambios de reglas más amplios o a colecciones ya existentes.
- Al cerrar una tarea siempre se entregan 3 cosas juntas: (1) validación breve de las decisiones técnicas, señalando riesgos reales; (2) prompt exacto listo para copiar/pegar en Claude Code, con commit + push; (3) checklist numerado de qué probar en el navegador tras el deploy.
- **Regla permanente:** cualquier cambio que Neto deba verificar en el navegador debe estar mergeado a `master` y pusheado — no basta con que esté en una rama feature, por mucho que se haya pusheado ahí.
- **Regla nueva confirmada 13/09/2026:** cualquier commit que toque un archivo listado en `APP_SHELL` de `service-worker.js` (prácticamente todo `js/*.js` y `css/styles.css`) DEBE ir acompañado de un bump de `CACHE_NAME`, en su propio commit separado, al cerrar el bloque de trabajo. Ha ocurrido el mismo incidente de caché al menos tres veces por olvidarlo: `r7` (histórico), `r12→r14` (13/09, sección 8.2 de `CONTEXTO_EVE_CONTROL_2026-09-13.md`), y el bump preventivo `r43` de esta sesión (23/09, sección 4) que sí se hizo correctamente en su propio commit.
- Cambios a `firestore.rules` se tratan con cautela extra: texto completo siempre re-verificado línea por línea antes de aprobar, nunca se despliega sin correr antes una matriz de pruebas manual en el Firestore Rules Playground (con la excepción puntual del 22/09 mencionada arriba), y el borrador se guarda como archivo commiteado en el repo (`rules-test/firestore.rules`) para no perderlo entre sesiones. **Ver también el hallazgo crítico de sincronización de la sesión 13/09** (`firestore.rules` real puede desincronizarse silenciosamente si alguien despliega manualmente desde la consola de Firebase).
- Para credenciales/secretos usados por scripts de diagnóstico puntuales (Cloudflare Worker, Firestore vía REST): nunca se imprime el contenido completo de un secreto en el transcript; cualquier script temporal creado solo para una tarea de diagnóstico/migración se borra al terminar esa tarea.
- Neto se comunica en español en las sesiones técnicas.

---

## 3. Arquitectura de datos clave

- **`cuentas_por_pagar` (CxP):** cada cuenta tiene `abonos[]` (activos) y `abonosRevertidos[]` (histórico). Cada abono tiene `abonoId` único (no por índice). `grupoPagoId` vincula un abono con su sobrante en `saldoAFavor` y con su doc en `pagos`.
- **`proveedores.saldoAFavor`:** array de movimientos, cada uno con `grupoPagoId`, `revertido: boolean`.
- **`pagos`:** puede tener `grupoPagoId` y `origen` (valores conocidos: `panel_cxp`, `recibo_pendiente`). Revertidos se marcan `revertido: true` (nunca se borran), excluidos de Stats/Reportes/exportaciones.
- **`recibos_pendientes`** (13/09/2026): generada desde CxP, PDF sin firma, pago aún no ejecutado. `{proveedor, tickets: [{ticket, material, kg, precio, monto, saldo}], montoTotal, formaPago, fechaGeneracion, generadoPor, estado: 'pendiente_pago'|'completado'}`.
- **`recibos_pago`** (12-13/09/2026): recibo firmado final (o con evidencia de transferencia), PDF final. `{proveedor, grupoPagoId, tickets, totalPago, fecha, firmaBase64, registradoPor, timestamp}`. **Importante:** ni `recibos_pago` ni `recibos_pendientes` están cableadas a `window.COLECCIONES`/`CARGAS_MODULO`/`window.EVE`/`limpiarEstadoLocal`, ni al borrado masivo de Admin — confirmar con Neto si esto sigue siendo así antes de asumirlo.
- **`cuentas_por_cobrar`/`cobros`** (nuevas, 22/09/2026, commit `a4029b1`): espejo estructural de `cuentas_por_pagar`/`pagos` pero del lado de clientes. Se generan automáticamente al guardar/editar una Venta (commit `60f3486`). Bloques de `firestore.rules` agregados y desplegados en `13550df` — ver nota de autonomía en sección 2.
- **`ventas`:** ahora con IVA por línea y retención (commit `6624c4a`, 22/09), con ajuste correspondiente de IVA reflejado en CxP y prorrateo en Pagos. El folio se conserva correctamente al editar (fix `b2e8971`).
- **`gastos`** (nueva colección, módulo completo 22/09/2026, commits `78838ec`→`6de7cb3`): reemplaza la clasificación Fijo/Variable por un campo `Concepto` libre (`0108d32`), con Total auto-calculado y su propia regla de Firestore (`9305f16`), cálculo automático de IVA 16% desde el Monto Total Pagado (`cff9fec`), y la pestaña de navegación oculta cuando `puedeLeer('gastos')` es `false` (`6de7cb3`).
- **`control_produccion`:** `outputs` es un arreglo `[{material, kg, esMerma}]`. `inputs[]` tiene `ticketOrigen` como texto libre, sin validar existencia.
- **`inventario_inicial`:** colección separada, entra como evento sintético con fecha de corte.
- **Empacado** es un proceso (misma identidad de material, cambia de etapa), NUNCA un material distinto.
- **Nuevo (23/09/2026): `users/{uid}/dispositivos`** (subcolección) — ver sección 5 para el detalle completo del candado de dispositivos. Campos opcionales en `users/{uid}`: `limiteDispositivos` (número, default 2 si no existe) y `exentoDispositivos` (booleano, default `false`).

### Catálogo de Materiales — CERRADO (19 entradas canónicas)
```
BIDON, CRISTAL CON ETIQUETA, CRISTAL SIN ETIQUETA, CRISTAL CON LECHERO,
CRISTAL CON VERDE, DURO, LECHERO, LECHERO MOLIDO, LLANTA, MIXTO, MIXTO 2,
MULTI-COLOR, MULTILECHERO, P.E., P.E. MOLIDO, P.P., P.P MOLIDO, SUERO, VERDE
```
- **Regla de negocio:** empacado nunca cambia identidad del material; molido/lavado/peletizado sí, por ser transformación con valor agregado propio.
- **"PET" fue eliminado por completo** como material capturable — se reemplaza en báscula por CRISTAL CON ETIQUETA o CRISTAL SIN ETIQUETA según corresponda.
- **MIXTO 2 sigue sin porcentajes reales** — la plantilla de Composiciones tiene un placeholder inválido a propósito ahí. Ver sección 6.

### Precios — dos capas
- **Precio general** (`precios`): por Material + vigencia. **Ajuste por Proveedor** (`ajustes_precio_proveedor`): por Material+Proveedor+vigencia propia. Coexisten con el `precioNegociado`/`motivoAjustePrecio` manual por ticket.

---

## 4. Sistema de Roles y Permisos

- `roles/{rolId}`: `{nombre, permisos: {11+ módulos → ninguno/lectura/escritura}, permisosExtra, activo}`.
- `users/{uid}` tiene `rolId` + `permisosResueltos` (denormalizado desde el rol). `permisosResueltos` ahora se recalcula y reescribe automáticamente al asignar/crear un rol de usuario (commit `9f05eae`, 14/09), cerrando el hueco donde quedaba desactualizado.
- `js/permisos.js`: `puedeLeer(modulo)` / `puedeEscribir(modulo)` / `tienePermisoExtra(clave)`.
- **`firestore.rules` en producción**, con matriz de checks manual en el Firestore Rules Playground como práctica estándar antes de cada deploy (excepción puntual del 22/09, sección 2).
- El archivo `matriz-pruebas-firestore-rules.md` (raíz del repo) documenta los checks de la Fase 6 original. **Corregido 23/09/2026 (commit `6145a4e`):** el UID de Admin en su tabla de referencia tenía un typo — era `stXEoFGdFFS44hbNyDw7RSn7MN53` ("Gd"), el real y correcto (confirmado directamente contra el documento `users/{uid}` en Firestore, `username: "Admin"`) es `stXEoFGfFFS44hbNyDw7RSn7MN53` ("Gf"). Cualquier referencia a ese UID en sesiones anteriores a esta corrección puede tener el typo.
- **Auditoría 12-13/09/2026:** se detectó que `firestore.rules` del repo llevaba semanas desincronizado de lo real en producción (producción corría Fase 6, el repo seguía en Fase 5) porque un deploy anterior se hizo manualmente desde la consola de Firebase sin commitear. Se reconstruyó y redesplegó vía CLI, verificado byte a byte. **Principio vigente:** nunca asumir que `firestore.rules` del repo refleja lo publicado sin comparar directamente contra la consola.

---

## 5. Sesión 23/09/2026 — Candado de dispositivos, Fase A y B completas

Objetivo: limitar cuántos dispositivos distintos pueden tener sesión activa simultánea por usuario, con exención configurable.

### 5.1 Diseño
- Identificación de dispositivo por dos señales combinadas: un **token** aleatorio (`crypto.randomUUID()`) persistido en `localStorage` del navegador, y un **fingerprint** de navegador (FingerprintJS v4, `visitorId`).
- Límite configurable por usuario vía `users/{uid}.limiteDispositivos` (si no existe, default `2` — constante `LIMITE_DISPOSITIVOS_DEFAULT` en el Worker).
- Exención opcional vía `users/{uid}.exentoDispositivos` (booleano, default `false`): si es `true`, se salta el conteo/límite pero se sigue haciendo la reconciliación normal de token/fingerprint.
- Diseño fail-open explícito y repetido: cualquier error de red, timeout o respuesta inesperada del Worker debe permitir el login igual, nunca bloquearlo — con log de advertencia en consola (`console.warn`) para que quede rastro sin afectar al operador.

### 5.2 Cloudflare Worker (`cloudflare-worker/`)
- Repo del Worker: `eve-control-worker`, desplegado en `https://eve-control-worker.cpnetohiva.workers.dev`.
- `src/firebase.js`: acceso a Firestore vía REST, autenticado firmando un JWT con el service account (Web Crypto `crypto.subtle`, scope `https://www.googleapis.com/auth/datastore`), intercambiado por un access token OAuth2 de Google. Funciones: `contarDocumentosColeccion`, `obtenerDocumento`, `listarDocumentos` (con paginación), `escribirDocumento` (PATCH = sobrescritura total), `eliminarDocumento` (DELETE, tolerante a 404) — esta última agregada en esta sesión.
- `src/index.js`: endpoint `POST /device-check` (lógica completa: match por token → actualiza `ultimoAcceso`; match por fingerprint sin match de token → reconcilia sobre el mismo documento existente; sin match y con cupo → registra dispositivo nuevo; sin cupo → `403`), gate por header `x-device-check-secret` contra `env.DEVICE_CHECK_SECRET` (`401` si no coincide, antes de tocar Firestore), CORS completo (`OPTIONS` preflight, `Access-Control-Allow-Origin` fijo a `https://cpnetohiva.github.io` vía helper `jsonResponse`), y `GET /health`.
- Commits: `6382b67` (scaffold + acceso REST), `499f655` (endpoint `/device-check`, CORS, helpers de Firestore).
- Secrets configurados en producción vía `wrangler secret put` (fuera de este repo, verificado ya presentes): `FIREBASE_SERVICE_ACCOUNT_JSON`, `DEVICE_CHECK_SECRET`.

### 5.3 Bug de reconciliación por fingerprint — encontrado y corregido
Al inspeccionar `users/stXEoFGfFFS44hbNyDw7RSn7MN53/dispositivos` (Admin) tras pruebas reales, se encontraron 2 documentos con **fingerprint y userAgent idénticos pero token distinto** — exactamente el caso que la rama de reconciliación por fingerprint debía prevenir. Causa: esa rama generaba un `deviceId` nuevo al azar y escribía un documento nuevo, en vez de sobrescribir el documento ya existente. Corregido en el commit `2151fbb` (usa `porFingerprint.id` en vez de `crypto.randomUUID()`, preserva `fechaRegistro` original). El documento huérfano `37d4246c-467b-47de-9559-3dc76253fe07` se borró manualmente con `eliminarDocumento`, dejando la subcolección con los 2 documentos legítimos. **Desplegado a producción**, Worker Version ID `1609b68a-2d98-4272-8069-66bbfcbdc3ba`.

### 5.4 Integración en el frontend (`index.html` + `js/auth.js`)
- FingerprintJS v4.6.2 cargado vía CDN (jsdelivr) con SRI (`integrity` + `crossorigin="anonymous"`, hash verificado independientemente contra el hash sha256 publicado por jsdelivr antes de usarse).
- `js/auth.js`: nueva `verificarDispositivo(uid)` — obtiene/genera el token de `localStorage`, obtiene el fingerprint, hace `POST /device-check` con `x-device-check-secret` real (`DEVICE_CHECK_SECRET`, valor final `75fbe5a9-84ec-4456-82b8-80d1fe91efd7`), con timeout de 5s vía `AbortController`. Se llama dentro de `onAuthStateChanged`, después de confirmar `usuario.active === true` y antes de `establecerSesionActiva`. Si `allowed` es `false`: `signOut()` + mensaje de rechazo reutilizando el `errorDiv` que ya usa el resto del flujo de login. Cualquier error de red/timeout cae al fallback fail-open (sección 5.1).
- **Caveat de seguridad conocido y comunicado a Neto:** `DEVICE_CHECK_SECRET` vive hardcodeado en `js/auth.js`, que es un archivo estático servido por GitHub Pages — visible vía "ver código fuente". Funciona como filtro básico anti-scraper, no como control de acceso real. Para que sea un secreto genuino haría falta validar algo que el cliente no pueda forjar (p. ej. un ID token de Firebase Auth verificado del lado del Worker) en vez de un string estático compartido.
- Commit `6eaac94` (integración completa de frontend) + `1720a34` (bump `CACHE_NAME` a `r43`, ya que `index.html` y `js/auth.js` están en `APP_SHELL` — bump hecho correctamente en su propio commit siguiendo la regla de la sección 2).

### 5.5 Configuración de datos post-deploy
- `users/stXEoFGfFFS44hbNyDw7RSn7MN53.limiteDispositivos` se escribió manualmente a `3` (vía `escribirDocumento`, preservando el resto del documento) — **valor temporal para pruebas de Admin, revisar antes de considerarlo definitivo** (ver sección 6).
- El UID correcto de Admin es `stXEoFGfFFS44hbNyDw7RSn7MN53` ("Gf") — ver nota de la sección 4 sobre el typo corregido en `matriz-pruebas-firestore-rules.md` (`6145a4e`).

---

## 6. Sesión 12-13/09/2026 — resumen (detalle completo en `CONTEXTO_EVE_CONTROL_2026-09-13.md`)

- **Tabs de periodo en CxP "Por Proveedor"** (Hoy/Esta Semana/Este Mes/Todos, commits `d20dbff`, `4294057`, `b0e4081`): "Esta Semana" usa un corte semanal propio de pago a proveedores (sábado→viernes, `calcularCorteSemanalCxP()`, `js/cxp.js`), distinto de la semana calendario lunes-domingo que usa el resto del sistema.
- **Guard de borrado Destaraje↔CxP** (commit `b9c7f5a`): `confirmarEliminar()` en `js/destaraje.js` ahora bloquea el borrado si el ticket tiene un CxP con saldo pendiente, cerrando el hueco que causó el caso huérfano del ticket 127 (resuelto de facto por el borrado masivo de datos del 13/09).
- **Incidente de caché del Service Worker** (mismo patrón que el histórico `r7`): el commit del guard de borrado (`b9c7f5a`) modificó `js/destaraje.js` (en `APP_SHELL`) sin bump de `CACHE_NAME` — producción siguió sirviendo `r12` sin el guard hasta el fix `d2bf1c6` (bump a `r13`). Esto motivó la regla permanente de la sección 2.
- **Recibos firmables en dos etapas** (commits `53c0de7`, `22b4fc7`, `ffc2184`, `7fa3778`, luego `921bb6e` monto editable por ticket, `41a8ccc` selector de forma de pago, `24172e3` flujo condicional firma/evidencia): Etapa 1 en CxP genera el recibo (PDF sin firma, `recibos_pendientes`, monto editable por ticket, forma de pago Efectivo/Transferencia) SIN ejecutar el pago. Etapa 2 en Pagos ejecuta el pago real (con revalidación de saldo fresco) y solo entonces pide firma (Efectivo) o evidencia de transferencia (Transferencia), generando el PDF final en `recibos_pago`.
- **Bloqueo reversible del modal viejo "Registrar Pago"** (commit `c95dee5`, con `be194a4` tocando también el flujo directo "Pagar cuentas pendientes (CxP)" de Pagos): deshabilitado en la UI con tooltip explicativo, código intacto sin borrar — Neto planea reactivarlo junto con la operación real.
- **Sincronización de `firestore.rules` con la Fase 6 real** (commits `154bdc2`, `d708eef`): ver detalle en sección 4.

---

## 7. Sesión 22/09/2026 — resumen

- **CxC/Cobros — diseño y roadmap:** commit `a4029b1` (módulo espejo de CxP/Pagos), `60f3486` (generación automática de CxC al guardar/editar una Venta), `13550df` (bloques de `firestore.rules` para `cuentas_por_cobrar`/`cobros`, ver nota de autonomía en sección 2).
- **IVA en Ventas con retención:** commit `6624c4a` — IVA calculado por línea, con retención, reflejado como ajuste en CxP y prorrateado en Pagos. Fix de folio y recálculo de IVA por línea al editar: `b2e8971`.
- **Gastos (módulo completo, Pieza 2):** commits `78838ec` (módulo base), `9305f16` (Total auto-calculado + regla de Firestore + bump de caché), `0108d32` (Concepto libre reemplaza Fijo/Variable), `cff9fec` (IVA automático 16% desde Monto Total Pagado), `6de7cb3` (oculta la pestaña si `puedeLeer('gastos')` es `false`).
- **Dos incidentes de login por `Promise.all` estricto:** reportados y resueltos con deploy de emergencia en esta sesión; `Promise.allSettled` ya estaba implementado en `cargarDatosEnParalelo()` desde una corrección anterior por otro motivo (aislar colecciones sin permiso de lectura, ver sección 4 / `CONTEXTO_EVE_CONTROL_2026-09-10.md` sección 5) — el fix concreto de esta sesión es el commit `20eed12` ("usa `Promise.allSettled` en `cargarDatosEnParalelo` para aislar fallos de lectura"). **No se tiene en este repo el detalle exacto de qué disparó cada uno de los dos incidentes** — si hace falta el detalle completo, viene de la conversación de asesoría de esa sesión, no de este código.
- **Decisión de política de autonomía de Claude Code para bloques nuevos de Firestore rules:** aplicada puntualmente al agregar `cuentas_por_cobrar`/`cobros` (`13550df`). Confirmar con Neto el alcance exacto antes de asumir que se extiende a otros cambios de reglas (ver sección 2).

---

## 8. Pendientes

### Prioridad alta / decisión de negocio pendiente
- **Porcentajes de MIXTO 2:** Neto confirmó que tiene composición propia pero aún no dio los números reales.
- **`limiteDispositivos: 3` de Admin es temporal:** se asignó manualmente el 23/09/2026 para pruebas — revisar con Neto si ese es el valor definitivo o solo un valor de prueba antes de dar por cerrado el candado de dispositivos.
- **Fase C del candado de dispositivos — UI de Admin:** falta una pantalla (probablemente dentro de Admin → Usuarios) para ver los dispositivos registrados por usuario, liberar/borrar uno manualmente, y editar `limiteDispositivos`/`exentoDispositivos` sin tener que escribir directo en Firestore.
- **Fase D del candado de dispositivos — restablecer contraseña sobre el mismo Worker:** el botón actual en Admin → Usuarios (commit `ffa3e40`, 14/09) envía un correo de restablecimiento vía Firebase Auth, pero el sistema usa emails sintéticos (`username@everplastic.local`, sin bandeja real) — ese correo no le llega a nadie. La idea pendiente es resolverlo sobre el mismo Cloudflare Worker (que ya tiene acceso privilegiado vía service account) en vez de depender del flujo de email de Firebase Auth.

### Prioridad media
- **`js/admin-usuarios.js` con código sin terminar:** confirmar con Neto el alcance exacto de lo que sigue incompleto ahí — `ffa3e40` sí agregó y commiteó un botón de restablecer contraseña (ver Fase D arriba), pero puede haber otro residuo distinto del descrito en sesiones anteriores (`CONTEXTO_EVE_CONTROL_2026-09-13.md` sección 9 lo describía como no commiteado a esa fecha). No dar por sentado cuál de los dos es el pendiente real sin confirmarlo primero.
- **CxC — Dashboard de Flujo de Efectivo / Posición de IVA:** no implementado.
- **Reglas de `gastos`/`cxc` en `rules-test/` vs. raíz:** vigilar que el borrador en `rules-test/firestore.rules` y el `firestore.rules` real desplegado no se desincronicen, sobre todo tras el bloque agregado con autonomía ampliada el 22/09 (`13550df`) — aplicar el mismo principio de verificación byte a byte de la sesión 13/09 antes de asumir que están sincronizados.
- **Manual de Operación** (`docs/MANUAL_OPERACION.md`): estado reportado como completo en sesiones anteriores — confirmar que sigue así.
- **Dashboard Fase 2** (subproductos real vs. teórico por mes, todos los materiales): diseño acordado, sin código.
- **Formato de los reportes:** pendiente de sesión dedicada.
- **Rendimientos — modo "por proceso sin material":** el selector de proceso sigue siendo decorativo en modo "Por Material".

### Prioridad baja / backlog conocido
- Editar el ticket de un pago vinculado a CxP no re-vincula ni rompe el guard.
- Borrado masivo de Admin no tiene concepto de `grupoPagoId`, ni cubre `recibos_pago`/`recibos_pendientes`.
- Consolidado CxP no muestra saldo a favor por proveedor.
- Estado desincronizado si se cierra la app entre pago ejecutado y firma pendiente de un recibo (recibo puede quedar `pendiente_pago` aunque el dinero ya se movió).

---

## 9. Instrucción para la próxima sesión

1. Verificar `git log --oneline -5` (parado DENTRO de `eve-control-v2`) para confirmar el último commit real en `master`.
2. Confirmar con Neto si `limiteDispositivos: 3` de Admin es el valor definitivo (sección 8).
3. Preguntar si se avanza con la Fase C (UI de Admin para dispositivos) o la Fase D (restablecer contraseña vía el Worker) del candado de dispositivos.
4. Pedir a Neto el alcance exacto de lo que falta en `js/admin-usuarios.js` antes de tocar ese archivo.
5. Si Neto trae los porcentajes reales de MIXTO 2, actualizar la plantilla de Composiciones antes de cualquier carga masiva nueva.
6. Retomar desde ahí según lo que Neto indique.
