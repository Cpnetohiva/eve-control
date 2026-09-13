# Contexto EVE Control — Handoff para nueva conversación
**Fecha de corte:** 12/09/2026

---

## 1. Datos del proyecto

- **Producción:** https://cpnetohiva.github.io/eve-control/
- **Repo remoto:** https://github.com/Cpnetohiva/eve-control.git
- **Carpeta local:** `eve-control-v2` (`C:\Users\cpnet\OneDrive\Escritorio\EVERPLASTIC COO\eve-control-v2`) — el nombre de la carpeta no coincide con el del repo, pero sí es el clon correcto.
- **⚠️ Trampa conocida:** `git status`/`git remote -v` corridos desde `EVERPLASTIC COO` (carpeta padre) reportan falsamente "not a git repository". Siempre verificar parado DENTRO de `eve-control-v2`.
- **Backend:** Firebase (proyecto `everplastic`), Firestore + Firebase Authentication. Auth vía `cpnetohiva@gmail.com`.
- **Hosting:** GitHub Pages, publica ÚNICAMENTE desde `master`. Sin ambiente dev/staging — toda prueba real requiere push a producción primero.
- **Sin Playwright ni automatización de navegador** en el entorno de Claude Code. Todas las pruebas las hace Neto manualmente.
- **Sin emulador local funcional** — Firestore Emulator Suite requiere JDK 21+, solo hay Java 8 en el sistema.

---

## 2. Metodología de trabajo (no cambia entre sesiones)

- Claude Code es el agente de ejecución; esta conversación es la capa de planeación/asesoría. Neto revisa diagnósticos aquí, decide, y recibe prompts exactos para pegar en Claude Code.
- Claude Code NO actúa de forma autónoma en acciones de alto impacto (deploy de Firestore Rules, borrado de datos de producción, creación de usuarios) sin aprobación explícita.
- Al cerrar una tarea siempre se entregan 3 cosas juntas: (1) validación breve de las decisiones técnicas, señalando riesgos reales; (2) prompt exacto listo para copiar/pegar en Claude Code, con commit + push; (3) checklist numerado de qué probar en el navegador tras el deploy.
- **Regla permanente:** cualquier cambio que Neto deba verificar en el navegador debe estar mergeado a `master` y pusheado — no basta con que esté en una rama feature, por mucho que se haya pusheado ahí.
- Cambios a `firestore.rules` se tratan con cautela extra: texto completo siempre re-verificado línea por línea antes de aprobar (el texto largo pegado en chat se ha truncado/comprimido más de una vez sin avisar), nunca se despliega sin correr antes una matriz de pruebas manual en el Firestore Rules Playground, y el borrador se guarda como archivo commiteado en el repo (no solo en el historial de chat) para no perderlo entre sesiones.
- Neto se comunica en español en las sesiones técnicas.

---

## 3. Arquitectura de datos clave

- **`cuentas_por_pagar` (CxP):** cada cuenta tiene `abonos[]` (activos) y `abonosRevertidos[]` (histórico). Cada abono tiene `abonoId` único (no por índice). `grupoPagoId` vincula un abono con su sobrante en `saldoAFavor` y con su doc en `pagos`.
- **`proveedores.saldoAFavor`:** array de movimientos, cada uno con `grupoPagoId`, `revertido: boolean`.
- **`pagos`:** puede tener `grupoPagoId` y `origen`. Revertidos se marcan `revertido: true` (nunca se borran), excluidos de Stats/Reportes/exportaciones.
- **`control_produccion`:** `outputs` es un arreglo `[{material, kg, esMerma}]`. `inputs[]` tiene `ticketOrigen` como texto libre, sin validar existencia.
- **`inventario_inicial`:** colección separada, entra como evento sintético con fecha de corte.
- **Empacado** es un proceso (misma identidad de material, cambia de etapa), NUNCA un material distinto.

### Catálogo de Materiales — CERRADO (19 entradas canónicas)
```
BIDON, CRISTAL CON ETIQUETA, CRISTAL SIN ETIQUETA, CRISTAL CON LECHERO,
CRISTAL CON VERDE, DURO, LECHERO, LECHERO MOLIDO, LLANTA, MIXTO, MIXTO 2,
MULTI-COLOR, MULTILECHERO, P.E., P.E. MOLIDO, P.P., P.P MOLIDO, SUERO, VERDE
```
- **Regla de negocio:** empacado nunca cambia identidad del material; molido/lavado/peletizado sí, por ser transformación con valor agregado propio.
- Materiales con posible estado Molido/Lavado/Peletizado: lechero, suero, color, pp, pe, garrafa/bidón, duro. **Cristal nunca se transforma.**
- Compras reales confirmadas de material ya transformado: LECHERO MOLIDO, P.P MOLIDO, P.E. MOLIDO. Suero/Duro molido son posibles pero NO se compran (decisión de negocio: comprar a granel y usar capacidad instalada propia).
- **"PET" fue eliminado por completo** como material capturable — se reemplaza en báscula por CRISTAL CON ETIQUETA o CRISTAL SIN ETIQUETA según corresponda.
- `MATERIALES_ALIAS` (se resuelve al capturar/importar, NO retroactivo a datos viejos en Firestore): CRISTAL CON ETIQ→CRISTAL CON ETIQUETA, CRISTAL SIN ETIQ→CRISTAL SIN ETIQUETA, MULTI-LECHERO→MULTILECHERO, MIXTO2→MIXTO 2, MULTICOLOR→MULTI-COLOR, GARRAFA→BIDON, PEAD→DURO, "P.E.."→P.E.
- **MIXTO 2 tiene composición propia confirmada** (mismo concepto de selección que MIXTO) — porcentajes reales pendientes de que Neto los proporcione.

### Catálogo de Proveedores
- `PROVEEDORES_ALIAS`: ARTURO→ARTURO LARA, JESUS→JESÚS, FÉLIX/FELIX→FELIX LOZANO.
- Proveedor sigue siendo texto libre + datalist (conjunto abierto), a diferencia de Material que en Destaraje/Precios ya es `<select>` estricto.

### Composición real de MIXTO (confirmada)
Cristal sin etiqueta 50%, Lechero 10%, Verde 10%, Multicolor 10%, Suero 5%, Cristal con etiqueta 10% (**vendible, NO merma**), Basura 5% (única merma real).

### Precios — dos capas
- **Precio general** (`precios`): por Material + vigencia, cubre solo lo que se compra tal como llega a báscula (crudo o ya transformado por el proveedor). NO es catálogo comercial completo.
- **Ajuste por Proveedor** (`ajustes_precio_proveedor`, nuevo): por Material+Proveedor+vigencia propia, `tipoAjuste` (monto fijo | porcentaje), `valorAjuste` con signo. `obtenerPrecioVigente(material, fecha, proveedor?)` es retrocompatible; con proveedor aplica el ajuste y devuelve también `precioBase` + `ajusteProveedorAplicado`. Coexiste con (no reemplaza) el `precioNegociado`/`motivoAjustePrecio` manual por ticket ya existente.
- **Comisiones** ($0.10/kg sobre precio): **descontinuadas desde el 31/08/2026**, ya no se genera dato nuevo — sigue siendo histórico consultable.

---

## 4. Cinco plantillas de importación masiva — TODAS completas

Mismo patrón en las 5: catálogo validado, reporte de "valores no reconocidos" (nunca se inventa silenciosamente), modo Agregar (Destaraje/Pagos también soportan Reemplazar).

1. **Destaraje (Báscula)** — importador ya existente, consolidado con el catálogo de 19.
2. **Pagos** — matchea contra CxP existente por ticket; `resincronizarPagosHuerfanos()` (Admin→Importar Datos) repara pagos ya guardados sin vínculo, con 3 resultados posibles: vinculado / ambiguo (requiere revisión manual) / sin match.
3. **Composiciones/Rendimientos** — formato largo (una fila por subproducto), sin columna "Fecha Vigencia Fin" (se deriva automáticamente al versionar). Bloque MIXTO real precargado; MIXTO 2 como placeholder inválido a propósito.
4. **Ventas** — multi-línea agrupada por `Grupo Venta` (folio), advertencia NO bloqueante de stock insuficiente (`calcularAdvertenciasStock()`, mismo criterio de fecha de corte que ya usa Control Producción — reutilizable a futuro ahí).
5. **Precios** — dos hojas: Precios Generales + Ajustes por Proveedor.

**⚠️ Orden de carga correcto (no documentado en la UI):** Precios → Destaraje → clic en "Generar corte" en CxP (o auditoría/aprobación manual para tickets post-corte) → Pagos.

---

## 5. Sistema de Roles y Permisos — COMPLETO Y DESPLEGADO

- **4 usuarios reales:** `test@everplastic.com` (cuenta de prueba vieja), Matilde, Admin, Christian.
- `roles/{rolId}`: `{nombre, permisos: {11 módulos → ninguno/lectura/escritura}, permisosExtra: {ventas_precios, cxp_reportes}, activo}`.
- `users/{uid}` tiene `rolId` + `permisosResueltos` (denormalizado desde el rol). El `permissions` legacy se conserva como respaldo, no se borró.
- `js/permisos.js`: `puedeLeer(modulo)` / `puedeEscribir(modulo)` / `tienePermisoExtra(clave)`, aplicado en los 11 módulos.
- **Migración corrida y confirmada** (Admin → Roles → "Generar roles desde permisos actuales", con vista previa antes de escribir): 4 usuarios migrados a 3 roles reales + "Sin acceso" por defecto.
- **`firestore.rules` (Fase 6) YA DESPLEGADO a producción**, verificado con matriz de 28 checks (usuarios reales: Christian, Admin, Matilde) corrida manualmente en el Firestore Rules Playground — los 28 pasaron. Login confirmado funcionando post-deploy.
- Mapeo de colecciones no obvio: `proveedores`→`cxp` (no `pagos`); `comisiones`→lectura vía `cxp`, escritura EXCLUSIVA de `esAdminEscritura()`; `historial_cambios`→lectura vía `admin`, escritura abierta a cualquier autenticado (log append-only); `users`/`roles` permiten lectura también con `admin:'lectura'` (no solo `'escritura'`), para no bloquear el panel a un admin de solo-auditoría.
- Dos bugs reales cazados y corregidos ANTES del deploy: `resolverPermisosUsuario()` leía `roles/{rolId}` directo en login (quedaba denegado bajo las reglas nuevas) → corregido a usar `permisosResueltos` ya denormalizado. `cargarDatosEnParalelo()` en `auth.js` usaba un solo `Promise.all` que reventaba completo y cerraba sesión ante el primer permiso denegado → corregido a `Promise.resolve([])` por colección cuando `puedeLeer(modulo)` es falso.
- El borrador de reglas vive commiteado en `rules-test/firestore.rules` (además de ya estar desplegado como `firestore.rules` real).
- El archivo `matriz-pruebas-firestore-rules.md` (raíz del repo) documenta los 28 checks y sus resultados — útil como evidencia de auditoría.

---

## 6. Cambios de sesión 10/09/2026

- **CxP:** botón "Aprobar manualmente TODOS" para tickets post-corte pendientes de foto (motivo fijo, distinguible de aprobación individual). Bloque "N tickets sin auditar" ahora colapsable, colapsado por defecto.
- **Dashboard:** las 4 vistas reorientadas (Mes en columnas, antes en filas), con columna/fila Total agregada. "$ por Mes y Material" y "KG por Mes y Material" ahora usan el catálogo completo de 19 como base de columnas (antes solo materiales con CxP existente). Nueva tabla de aviso: "materiales sin precio vigente" (candidatos a seguir generando CxP faltantes). "Exposición Actual" con fila "Total [Proveedor]" en negritas + separador visual entre proveedores.
- **Inventario/Dashboard:** agregaciones ahora aplican `normalizarMaterial()`/`normalizarProveedor()` de forma defensiva antes de sumar — resiliente a datos viejos sin consolidar sin necesidad de reescribir Firestore.

---

## 7. Sesión 12/09/2026

### 7.1 Tabs "Este Mes" en Báscula, Pagos, Ventas y Control Producción
Commit `5d3af3a`. Se agregó el tab "Este Mes" entre "Esta Semana" y "Todos" en los cuatro módulos, usando la función ya existente `window.obtenerInicioMes()` (definida en `js/utils.js:41`, retorna el primer día del mes actual en México).
- **Báscula, Pagos y Ventas:** sus exportaciones CSV heredan el filtro de "Este Mes" automáticamente, sin código adicional, porque ya usan `obtenerRangoYEtiqueta(tabId, filtros)` (`js/reportes.js:85`) para resolver el rango de fechas según el tab activo.
- **Control Producción:** su exportación CSV (`exportarControlProduccionCSV()`, `js/control-produccion.js:900`) **nunca filtró por tab** (tampoco antes con "Semana") — siempre exporta `window.EVE.registrosControlProduccion` completo. Se dejó así intencionalmente en esta sesión; no es un bug pendiente.

### 7.2 CxP — rediseño de "Por Proveedor"
Commits confirmados en `git log` (12/09/2026): `d20dbff`, `4294057`, `b0e4081`.
- **Nuevos tabs:** Hoy / Esta Semana / Este Mes / Todos, filtrando sobre Fecha Ticket (`d20dbff`).
- **Fórmula exacta de "Esta Semana"** (`calcularCorteSemanalCxP()`, `js/cxp.js:133-142`): NO es la semana calendario (lunes-domingo) que usa el resto del sistema. Es el ciclo de pago a proveedores, sábado→viernes:
  - `fin` = viernes más reciente (hoy mismo si hoy es viernes) — calculado como `hoy - ((hoy.getDay() - 5 + 7) % 7)` días.
  - `inicio` = `fin - 6` días → cae en sábado.
  - Rango resultante: sábado → viernes (7 días).
- **Tarjeta fija "Total Adeudado General"** (`calcularTotalAdeudadoGeneral()`, `js/cxp.js:524-528`, commit `4294057`): suma el saldo (>0) de TODOS los proveedores sin ningún filtro de periodo. Se muestra siempre, en cualquier tab, junto con el total del periodo activo cuando aplica (tabs Hoy/Semana/Mes en "Por Proveedor", o Semana/Mes en "Todos").
- **Exportaciones** (commit `b0e4081`): el botón único "Exportar CSV" anterior fue reemplazado por dos botones:
  - **"Exportar Resumen"** — una fila por proveedor (Proveedor, Total, Pagado, Saldo) + fila TOTAL GENERAL, respetando el periodo del tab activo.
  - **"Exportar Detalle"** — nivel ticket + abonos (el detalle que ya existía), también filtrado por el periodo activo.
  - Si el tab activo es "Todos", ambas exportan el histórico completo sin filtro.

### 7.3 Hallazgo de arquitectura — mecanismo real de generación de CxP
El botón "Generar pendientes anteriores al corte" ejecuta `generarCxPSinFoto()` en `js/cxp.js`, con filtro: `ticket !== 'V' && fechaEntrada < fechaCorteVigente() && !yaExisteCxP(ticket)`.

`fechaCorteVigente()` (`js/cxp.js:3-5`) lee `window.EVE.fechaCorteAuditoria`, que a su vez se carga desde `config/sistema.fechaCorteAuditoria` en Firestore (`js/auth.js:120`), con default hardcodeado `'2026-07-01'` en tres lugares del código (`js/cxp.js:4`, `js/auth.js:20` y `:189`) para cuando el campo no existe en Firestore — que fue el caso hasta esta sesión. Neto reporta que ya lo configuró manualmente en Firestore a `'2026-09-01'` vía Admin → Configuración (dato operativo de Firestore, no verificable desde el código en este repo; queda documentado como reportado por Neto).

Este botón, por diseño, NUNCA procesa tickets con `fechaEntrada` posterior al corte — no es un bug. Los mecanismos que sí generan CxP para tickets recientes son `generarCxPDesdeAuditoria()` (cuando la auditoría de foto marca COINCIDE) y `aprobarManualmente()` (aprobación individual, o el botón "Aprobar manualmente TODOS" agregado el 10/09).

**Hueco real de cobertura de precios documentado:** la colección `precios` (17 documentos) cubre casi todos los materiales solo desde el 22/07/2026 en adelante (excepción: MIXTO, con vigencia desde el 2026-01-01). Cualquier ticket anterior al 22/07/2026 con otro material queda sin precio vigente al intentar procesarse ("Sin precio vigente") — esto fue la causa real de "0 cuentas generadas, 542-548 omitidas" antes de que se moviera la fecha de corte.

### 7.4 Caso ticket 127 (ARTURO LARA) — CxP huérfano de $4,640
Doc `cuentas_por_pagar/GL9gMZFp1bRbwDOQaCfL`, ticket "127", material "MIXTO 2", saldo $4,640 — generado vía aprobación manual masiva histórica el 08/09/2026; el ticket de Destaraje origen se eliminó el 10/09/2026 sin que el sistema revirtiera o marcara el CxP dependiente (secuencia confirmada vía `historial_cambios` en investigación de esta sesión).

**No hubo corrección puntual en código.** Se verificó (`js/destaraje.js`, función `confirmarEliminar()`) que NO existe ningún guard de borrado en Destaraje — la función solo pide un motivo por `window.prompt()` y borra directamente, sin validar contra `cuentas_por_pagar`. Esto contrasta con el guard que sí existe en `js/pagos.js` (bloquea "Eliminar" si el pago tiene `grupoPagoId` con abono activo o `saldoAFavor`, commit `808e270`).

El caso quedará resuelto como **efecto colateral** del borrado masivo de datos (ver 7.5) una vez que se ejecute, no por una corrección dirigida. El hueco de diseño de fondo —eliminar un registro de Destaraje no verifica si ya generó un CxP con saldo pendiente— **sigue abierto como pendiente de backlog** (ver sección 8), independientemente de si el borrado masivo se ejecuta o no, porque puede volver a ocurrir con cualquier ticket futuro.

### 7.5 Decisión operativa de Neto (12/09/2026) — EJECUCIÓN PENDIENTE
Neto decidió el borrado masivo de todos los datos de Firestore EXCEPTO la colección `precios`, con recarga posterior a partir del 31/08/2026 en adelante.

**Estado real: decisión tomada, ejecución pendiente.** A la fecha de este documento el borrado y la recarga todavía NO se han ejecutado. No hay resultado de recarga ni del checklist de 20 puntos de verificación post-recarga todavía — se actualizará esta sección con la fecha real de ejecución, el resultado de la recarga y el resultado del checklist en cuanto Neto confirme que se corrió.

---

## 8. PENDIENTES reales

### Prioridad alta / decisión de negocio pendiente
- **Porcentajes de MIXTO 2:** Neto confirmó que tiene composición propia pero aún no dio los números reales — la plantilla de Composiciones tiene un placeholder inválido a propósito ahí.
- **Borrado total de datos y recarga limpia:** decisión tomada por Neto el 12/09/2026 (ver sección 7.5) — catálogo, aliases y las 5 plantillas ya están listos, pero la ejecución real (borrado de todo excepto `precios` + recarga desde 31/08/2026) sigue pendiente. Actualizar esta sección con el resultado en cuanto se ejecute.
- **Destaraje sin guard de borrado contra CxP:** eliminar un registro de Destaraje no verifica si ya generó una cuenta por pagar con saldo pendiente (a diferencia de Pagos, que sí bloquea por `grupoPagoId`/`saldoAFavor`, commit `808e270`). Causó el caso del ticket 127 (sección 7.4); puede repetirse con cualquier ticket futuro mientras no se implemente el guard.

### Prioridad media
- **Reseteo de contraseña por Admin:** explorado y descartado por ahora — el sistema usa emails sintéticos (`username@everplastic.local`, sin correos reales), y la vía correcta (Admin SDK) requeriría backend/Cloud Functions, descartado por costo y por falta de acceso remoto a Firebase desde la máquina de desarrollo (nunca está físicamente en la planta). **Proceso manual de emergencia:** dar de alta un usuario nuevo con el mismo rol y desactivar el viejo. Queda código SIN COMMITEAR y sin terminar en `js/admin-usuarios.js` de un intento abandonado — no es una regresión, es un residuo intencional a limpiar o retomar cuando se decida.
- **Manual de Operación** (`docs/MANUAL_OPERACION.md`): completo (cerrado en sesión previa, incluye Mapa de Interacciones).
- **Dashboard Fase 2** (subproductos real vs. teórico por mes, todos los materiales): diseño acordado en una sesión anterior, sin código.
- **Formato de los reportes:** Neto señaló que "muy probablemente tendrá que cambiar" sin definir qué — pendiente de sesión dedicada.
- **Rendimientos — modo "por proceso sin material":** el selector de proceso es decorativo en modo "Por Material" (sin efecto real).

### Prioridad baja / backlog conocido
- Editar el ticket de un pago vinculado a CxP no re-vincula ni rompe el guard (usa `grupoPagoId`, no ticket) — inconsistencia visual/trazabilidad menor.
- Borrado masivo de Admin no tiene concepto de `grupoPagoId` — borrar CxP sin borrar Pagos del mismo rango deja `grupoPagoId` huérfano en documentos de `pagos`.
- Consolidado CxP no muestra saldo a favor por proveedor (solo el Estado de Cuenta individual lo hace).
- Sin reporte exportable de "Composiciones vigentes".
- Telegram de Ventas duplica lógica en vez de reutilizar `enviarReporteTelegram` (deuda técnica, no gap funcional).
- Caso `admin:'lectura'` en las reglas de Firestore nunca se probó con un usuario real (ninguno tiene ese perfil hoy) — bajo riesgo dado el fallback de denegar por defecto, pero vale correrlo el día que se dé de alta alguien con ese rol.

---

## 9. Instrucción para la próxima sesión

1. Verificar `git log --oneline -5` (parado DENTRO de `eve-control-v2`) para confirmar el último commit real en `master`.
2. Confirmar con Neto si el borrado total + recarga limpia de datos (sección 7.5) ya se ejecutó. Si sí: actualizar la sección 7.5 con fecha real, resultado de la recarga y resultado del checklist de 20 puntos. Si no: sigue pendiente, no asumir que se resolvió el caso del ticket 127 (sección 7.4).
3. Si Neto trae los porcentajes reales de MIXTO 2, actualizar la plantilla de Composiciones antes de cualquier carga masiva nueva.
4. Retomar desde ahí según lo que Neto indique.
