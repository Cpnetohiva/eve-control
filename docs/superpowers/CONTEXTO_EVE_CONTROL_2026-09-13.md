# Contexto EVE Control — Handoff para nueva conversación
**Fecha de corte:** 13/09/2026

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
- Cambios a `firestore.rules` se tratan con cautela extra: texto completo siempre re-verificado línea por línea antes de aprobar (el texto largo pegado en chat se ha truncado/comprimido más de una vez sin avisar), nunca se despliega sin correr antes una matriz de pruebas manual en el Firestore Rules Playground, y el borrador se guarda como archivo commiteado en el repo (no solo en el historial de chat) para no perderlo entre sesiones. **Ver hallazgo crítico de sincronización de esta sesión en la sección 6.5.**
- **Regla nueva confirmada esta sesión (13/09):** cualquier commit que toque un archivo listado en `APP_SHELL` de `service-worker.js` (prácticamente todo `js/*.js` y `css/styles.css`) DEBE ir acompañado de un bump de `CACHE_NAME`, en su propio commit separado, al cerrar el bloque de trabajo. Ver incidente en sección 6.2 — ya ocurrió dos veces (`r7` histórico, `r12` esta sesión) por olvidarlo.
- Neto se comunica en español en las sesiones técnicas.

---

## 3. Arquitectura de datos clave

- **`cuentas_por_pagar` (CxP):** cada cuenta tiene `abonos[]` (activos) y `abonosRevertidos[]` (histórico). Cada abono tiene `abonoId` único (no por índice). `grupoPagoId` vincula un abono con su sobrante en `saldoAFavor` y con su doc en `pagos`.
- **`proveedores.saldoAFavor`:** array de movimientos, cada uno con `grupoPagoId`, `revertido: boolean`.
- **`pagos`:** puede tener `grupoPagoId` y `origen` (valores conocidos: `panel_cxp`, `recibo_pendiente` desde el 13/09 — ver sección 6.4). Revertidos se marcan `revertido: true` (nunca se borran), excluidos de Stats/Reportes/exportaciones.
- **`recibos_pendientes`** (nueva, 13/09/2026): generada desde CxP, PDF sin firma, pago aún no ejecutado. `{proveedor, tickets: [{ticket, material, kg, precio, monto, saldo}], montoTotal, formaPago, fechaGeneracion, generadoPor, estado: 'pendiente_pago'|'completado'}`. Ver flujo completo en sección 6.4.
- **`recibos_pago`** (introducida 12-13/09/2026): recibo firmado final (o con evidencia de transferencia), PDF final. `{proveedor, grupoPagoId, tickets, totalPago, fecha, firmaBase64, registradoPor, timestamp}`. **Importante:** ni `recibos_pago` ni `recibos_pendientes` están cableadas a `window.COLECCIONES`/`CARGAS_MODULO`/`window.EVE`/`limpiarEstadoLocal` — se leen/escriben con nombres de colección literales, no se cargan al login ni entran en el borrado masivo de Admin.
- **`control_produccion`:** `outputs` es un arreglo `[{material, kg, esMerma}]`. `inputs[]` tiene `ticketOrigen` como texto libre, sin validar existencia.
- **`inventario_inicial`:** colección separada, entra como evento sintético con fecha de corte.
- **Empacado** es un proceso (misma identidad de material, cambia de etapa), NUNCA un material distinto.

### Catálogo de Materiales — CERRADO (19 entradas canónicas)
```
BIDON, CRISTAL CON ETIQUETA, CRISTAL SIN ETIQUETA, CRISTAL CON LECHERO,
CRISTAL CON VERDE, DURO, LECHERO, LECHERO MOLIDO, LLANTA, MIXTO, MIXTO 2,
MULTI-COLOR, MULTILECHERO, P.E., P.E. MOLIDO, P.P., P.P MOLIDO, SUERO, VERDE
```
- Materiales con posible estado Molido/Lavado/Peletizado: lechero, suero, color, pp, pe, garrafa/bidón, duro. **Cristal nunca se transforma.**
- Compras reales confirmadas de material ya transformado: LECHERO MOLIDO, P.P MOLIDO, P.E. MOLIDO. Suero/Duro molido son posibles pero NO se compran (decisión de negocio: comprar a granel y usar capacidad instalada propia).
- **"PET" fue eliminado por completo** como material capturable — se reemplaza en báscula por CRISTAL CON ETIQUETA o CRISTAL SIN ETIQUETA según corresponda.
- `MATERIALES_ALIAS` (se resuelve al capturar/importar, NO retroactivo a datos viejos en Firestore): CRISTAL CON ETIQ→CRISTAL CON ETIQUETA, CRISTAL SIN ETIQ→CRISTAL SIN ETIQUETA, MULTI-LECHERO→MULTILECHERO, MIXTO2→MIXTO 2, MULTICOLOR→MULTI-COLOR, GARRAFA→BIDON, PEAD→DURO, "P.E.."→P.E.
- **MIXTO 2 tiene composición propia confirmada** (mismo concepto de selección que MIXTO) — porcentajes reales pendientes de que Neto los proporcione.

### Composición real de MIXTO (confirmada)
Cristal sin etiqueta 50%, Lechero 10%, Verde 10%, Multicolor 10%, Suero 5%, Cristal con etiqueta 10% (**vendible, NO merma**), Basura 5% (única merma real).

### Precios — dos capas
- **Precio general** (`precios`): por Material + vigencia. **Ajuste por Proveedor** (`ajustes_precio_proveedor`): por Material+Proveedor+vigencia propia, `tipoAjuste` (monto fijo | porcentaje), `valorAjuste` con signo. Coexisten con el `precioNegociado`/`motivoAjustePrecio` manual por ticket.
- **Comisiones** ($0.10/kg sobre precio): **descontinuadas desde el 31/08/2026**, sigue siendo histórico consultable.

---

## 4. Sistema de Roles y Permisos

- `roles/{rolId}`: `{nombre, permisos: {11 módulos → ninguno/lectura/escritura}, permisosExtra: {ventas_precios, cxp_reportes}, activo}`.
- `users/{uid}` tiene `rolId` + `permisosResueltos` (denormalizado desde el rol). El `permissions` legacy se conserva como respaldo, no se borró.
- `js/permisos.js`: `puedeLeer(modulo)` / `puedeEscribir(modulo)` / `tienePermisoExtra(clave)`, aplicado en los 11 módulos.
- **Migración corrida y confirmada** (Admin → Roles → "Generar roles desde permisos actuales", con vista previa antes de escribir): 4 usuarios reales (`test@everplastic.com`, Matilde, Admin, Christian) migrados a 3 roles reales + "Sin acceso" por defecto.
- **`firestore.rules` (Fase 6) YA DESPLEGADO a producción**, verificado con matriz de 28 checks (usuarios reales: Christian, Admin, Matilde) corrida manualmente en el Firestore Rules Playground — los 28 pasaron. Login confirmado funcionando post-deploy.
- Mapeo de colecciones no obvio: `proveedores`→`cxp` (no `pagos`); `comisiones`→lectura vía `cxp`, escritura EXCLUSIVA de `esAdminEscritura()`; `historial_cambios`→lectura vía `admin`, escritura abierta a cualquier autenticado (log append-only); `users`/`roles` permiten lectura también con `admin:'lectura'` (no solo `'escritura'`).
- El archivo `matriz-pruebas-firestore-rules.md` (raíz del repo) documenta los 28 checks originales de Fase 6.
- **Hallazgo crítico de esta sesión (13/09):** `firestore.rules` real de producción estaba desincronizado del repo desde hacía semanas — producción corría Fase 6 desplegada manualmente desde la consola de Firebase, el repo seguía commiteado en Fase 5 (`a4f3cd7`). Se reconstruyó y redesplegó vía CLI. **Detalle completo, causa raíz y verificación byte a byte en la sección 6.5.**
- Reglas de `recibos_pendientes`/`recibos_pago` con mapeo diferenciado (NO el mismo que `cuentas_por_pagar`) — ver sección 6.5.

---

## 5. Sesión 12/09/2026 — CxP "Por Proveedor" y tabs de periodo

### 5.1 Tabs "Este Mes" en Báscula, Pagos, Ventas y Control Producción
Commit `5d3af3a`. Se agregó el tab "Este Mes" entre "Esta Semana" y "Todos" en los cuatro módulos, usando `window.obtenerInicioMes()` (`js/utils.js:41`). Báscula/Pagos/Ventas heredan el filtro en su exportación CSV automáticamente vía `obtenerRangoYEtiqueta()` (`js/reportes.js:85`); Control Producción nunca filtró su CSV por tab (tampoco antes) — decisión intencional, no es bug pendiente.

### 5.2 CxP — rediseño de "Por Proveedor" (commits `d20dbff`, `4294057`, `b0e4081`)
- **Nuevos tabs Hoy / Esta Semana / Este Mes / Todos**, filtrando sobre Fecha Ticket (`d20dbff`). Bajo Hoy/Semana/Mes se muestra tabla Proveedor/Saldo ordenada de mayor a menor con fila TOTAL; "Todos" conserva la vista completa de tarjetas (Registrar Pago/Ver Detalle) sin cambios de lógica de pagos.
- **"Esta Semana" usa un corte propio de CxP, NO la semana calendario** (`calcularCorteSemanalCxP()`, `js/cxp.js:133-142`): ciclo de pago a proveedores sábado→viernes. `fin` = viernes más reciente (`hoy - ((hoy.getDay() - 5 + 7) % 7)` días); `inicio` = `fin - 6` días.
- **Tarjeta fija "Total Adeudado General"** (`calcularTotalAdeudadoGeneral()`, `js/cxp.js:524-528`, commit `4294057`): suma el saldo (>0) de TODOS los proveedores sin filtro, visible en cualquier tab, junto con el total del periodo activo cuando aplica.
- **Exportaciones** (commit `b0e4081`): reemplaza el botón único "Exportar CSV" por dos:
  - **"Exportar Resumen"** — una fila por proveedor (Proveedor, Total, Pagado, Saldo) + fila TOTAL GENERAL.
  - **"Exportar Detalle"** — nivel ticket + abonos (el detalle que ya existía).
  - Ambos respetan el periodo del tab activo; si el tab activo es "Todos", exportan el histórico completo sin filtro.

### 5.3 Hallazgo de arquitectura — mecanismo real de generación de CxP
El botón "Generar pendientes anteriores al corte" ejecuta `generarCxPSinFoto()` (`js/cxp.js`), filtro: `ticket !== 'V' && fechaEntrada < fechaCorteVigente() && !yaExisteCxP(ticket)`. `fechaCorteVigente()` (`js/cxp.js:3-5`) lee `config/sistema.fechaCorteAuditoria`, default hardcodeado `'2026-07-01'` en tres lugares del código para cuando el campo no existe en Firestore (que fue el caso hasta esta sesión). Neto lo configuró manualmente a `'2026-09-01'` vía Admin → Configuración.

Este botón, por diseño, nunca procesa tickets posteriores al corte — no es un bug. `generarCxPDesdeAuditoria()` (auditoría de foto COINCIDE) y `aprobarManualmente()` (individual o masiva) sí generan CxP para tickets recientes.

**Hueco real de cobertura de precios:** `precios` (17 documentos) cubre casi todos los materiales solo desde el 22/07/2026 (excepción: MIXTO, desde 2026-01-01). Cualquier ticket anterior al 22/07/2026 con otro material queda "Sin precio vigente" — causa real de "0 cuentas generadas, 542-548 omitidas" antes de mover la fecha de corte.

### 5.4 Caso ticket 127 (ARTURO LARA) — CxP huérfano de $4,640
Doc `cuentas_por_pagar/GL9gMZFp1bRbwDOQaCfL`, ticket "127", material "MIXTO 2", saldo $4,640 — generado por aprobación manual masiva el 08/09/2026; el ticket de Destaraje origen se eliminó el 10/09/2026 sin que el sistema revirtiera o marcara el CxP dependiente. Se confirmó que `confirmarEliminar()` en `js/destaraje.js` no tenía guard alguno contra `cuentas_por_pagar` en ese momento (a diferencia de `js/pagos.js`, que ya bloqueaba por `grupoPagoId`/`saldoAFavor`, commit `808e270`).

**Este hueco de diseño se cierra el mismo 13/09/2026 — ver sección 6.1.** El doc huérfano en sí se resuelve como efecto colateral del borrado masivo (5.5 / 6.6), no con una corrección dirigida.

### 5.5 Decisión operativa de Neto — EJECUTADA el 13/09/2026
Neto decidió el borrado masivo de todos los datos de Firestore EXCEPTO `precios`, con recarga posterior desde el 31/08/2026 en adelante. Ejecutada el 13/09 — ver sección 6.6. Queda pendiente confirmar con Neto el checklist de 20 puntos de verificación post-recarga, y si `recibos_pago`/`recibos_pendientes` (no cableadas a ningún borrado masivo) sobrevivieron intactas.

---

## 6. Sesión 13/09/2026 — Guard de borrado, incidente de caché, recibos firmables, sync de firestore.rules

### 6.1 Guard de borrado en Destaraje contra CxP con saldo pendiente
Commit `b9c7f5a`. Cierra el hueco de la sección 5.4. `confirmarEliminar(id)` en `js/destaraje.js` ahora, antes de pedir motivo y borrar, hace lectura fresca a Firestore (`obtenerCxPConSaldoPendiente(ticket)`: `cuentas_por_pagar.where('ticket', '==', ticket)`, filtra `saldo > 0`). Si existe saldo pendiente para ese ticket, **bloquea el borrado por completo** (hard block) indicando el saldo y que debe resolverse desde CxP primero. No se tocó el guard existente de `js/pagos.js`. No repara el caso histórico del ticket 127, solo previene que se repita.

Caso de prueba real: el ticket 938 (JULIO, MIXTO, $1,794) se usó para validar el guard en el navegador tras resolver el incidente de caché (6.2), recapturándose manualmente después.

### 6.2 Incidente de caché: guard de borrado no se reflejaba en producción (r12 → r14)
El commit `b9c7f5a` modificó `js/destaraje.js` (en `APP_SHELL` de `service-worker.js`) **sin incrementar `CACHE_NAME`**. El service worker no detectó cambio en el script y siguió sirviendo `r12` sin el guard — mismo patrón que un incidente histórico previo con `r7`.

- `d2bf1c6` — fix: bump a `r13`, corrigiendo específicamente el olvido de `b9c7f5a`.
- 3 commits más tocaron archivos precacheados sin bump individual en la misma sesión: `aa2f565` (incluir proveedores de Báscula en el datalist de Proveedor de Pagos), `ea2977c` (columna Fecha en tabla de tickets pendientes de CxP en Pagos), `b5063e6` (buscador global por Ticket/Proveedor/Fecha en Báscula, reutiliza `aplicarFiltrosTodos`).
- `6c0e9c1` — chore: bump a `r14`, cerrando ese bloque (`pagos.js`, `destaraje.js`, `css/styles.css`).

**Lección ya incorporada a la metodología (sección 2):** cerrar cada bloque de trabajo que toque `APP_SHELL` con un bump de `CACHE_NAME` en commit separado, sin esperar a que Neto reporte que "no ve el cambio".

### 6.3 Rename Destaraje → Báscula
Completo en la UI, salvo el nombre de hoja "Destaraje" en la plantilla Excel de `js/admin-importar.js` — decisión consciente de no tocarlo, rompería archivos de importación ya existentes en manos de Neto.

### 6.4 Recibos firmables en dos etapas

**Primera versión, de una sola etapa (superada):** commits `a0e2243`, `861788f`, `247469a` (bump `r15`). Al completar "Registrar Pago" en CxP se ofrecía un paso opcional "Generar Recibo" inmediato con pad de firma y PDF (`crearPadFirma()`, `generarPDFRecibo()`), todo encadenado al pago en una sola etapa. `861788f` agregó borrador de regla para `recibos_pago` en `rules-test/firestore.rules`, sin desplegar.

**Petición explícita de Neto:** separar "generar el recibo" (documentación/desglose) de "ejecutar el pago" (acción real de dinero), para poder generar recibos preliminares sin comprometerse a pagar en ese momento. Reestructurado el mismo día — commits `53c0de7`, `22b4fc7`, `ffc2184`, `7fa3778` (bump `r16`). El pad de firma y `generarPDFRecibo()` de la primera versión se conservaron y reutilizaron tal cual.

- **Etapa 1 — CxP genera el recibo SIN firma y SIN pago** (`53c0de7`, `js/cxp.js`): se quitó el disparo automático del modal de firma tras "Registrar Pago". Se agregó columna de checkbox por ticket (visible solo si `puedeEscribir('cxp')` y `saldo > 0`) + botón "Generar Recibo" (habilitado con ≥1 ticket marcado). Al presionar: genera PDF **sin firma** con el desglose, **no ejecuta ningún pago**, guarda doc en la nueva colección `recibos_pendientes` con `estado: 'pendiente_pago'`. Se quitó también la columna "Origen" de esa tabla (solo visual, el campo en Firestore no se tocó). `generarPDFRecibo()` se generalizó para aceptar recibos con o sin `firmaBase64` (título/nombre de archivo cambian según corresponda); se corrigió en el mismo commit un bug de formato de fecha (`.slice(0, 10)` antes de pasar `fechaGeneracion` ISO a `window.formatearFecha()`).
- **Etapa 2 — Pagos ejecuta el pago real y luego pide firma** (`22b4fc7`, `js/pagos.js`): nueva sección "Recibos Pendientes" (visible solo con `puedeEscribir('pagos')`) que lista `recibos_pendientes` con `estado: 'pendiente_pago'`. Al elegir uno: modal precarga proveedor + tickets fijos + monto editable (permite pago parcial). Antes de ejecutar, `revalidarYObtenerCuentasFrescas()` hace lectura fresca del saldo actual de cada ticket (mismo principio de concurrencia que `verificarSinPagosFrescos()` en `js/cxp.js`); si algún ticket cambió de saldo desde la generación, bloquea con mensaje claro y no ejecuta nada. Al confirmar: ejecuta `distribuirPago()` sin modificarla, escribe `cuentas_por_pagar` + `pagos` (`origen: 'recibo_pendiente'`), y recién después abre el pad de firma. Al firmar: genera el PDF final reutilizando `generarPDFRecibo()`, guarda en `recibos_pago`, marca el `recibos_pendientes` de origen como `completado` (nunca se borra). El panel/flujo directo preexistente "Pagar cuentas pendientes (CxP)" sigue disponible sin cambios en esta etapa.
- **Caveat conocido:** si se cierra la app entre el pago ya ejecutado y la firma pendiente, el doc en `recibos_pendientes` queda `pendiente_pago` aunque el pago real ya ocurrió (el pago sí quedó bien registrado en `cuentas_por_pagar`/`pagos`). No se agregó un tercer estado — queda en backlog (sección 7).
- **Restricciones respetadas en todo el flujo:** no se modificó `distribuirPago()`, ni la lógica de abonos, ni la de reversión de pagos.
- **Borrador de reglas (`ffc2184`):** bloque `recibos_pendientes` en `rules-test/firestore.rules`, mismo mapeo que `recibos_pago` en ese momento — solo borrador, no desplegado.

**Extensiones posteriores en la misma sesión** (siguen el mismo principio: el recibo se genera ANTES del pago):
- `921bb6e` — **monto editable por ticket** al generar el recibo en CxP: los checkboxes dejan de ser todo-o-nada, permiten cubrir varios tickets completos y uno con abono parcial en el mismo recibo, con total seleccionado en tiempo real.
- **Selector de forma de pago (Efectivo/Transferencia)** agregado a la generación del recibo en CxP, guardado como `formaPago` en `recibos_pendientes` junto con el monto asignado por ticket.
- `24172e3` — en Pagos, al ejecutar el recibo pendiente, el flujo se vuelve condicional por `formaPago`: **Efectivo** exige firma en el pad (como en la etapa 2 original); **Transferencia** exige en su lugar referencia obligatoria + comprobante opcional (comprimido a base64, mismo patrón que `auditoria_fotos`), sin pedir firma. `generarPDFRecibo()` recibe un flag `final` explícito para distinguir recibo preliminar de recibo ejecutado por transferencia.
- `c95dee5` — **deshabilita temporalmente el modal "Registrar Pago" de CxP** (pago a suma alzada FIFO o abono a un ticket específico, sin recibo ni evidencia), con tooltip explicativo. **Bloqueo intencionalmente reversible:** el código (`crearModalPago`/`abrirModalPago`/`manejarEnvioPago`/`registrarPagoGeneral`/`actualizarAbonoCxP`) sigue intacto — Neto planea reactivarlo más adelante junto con la operación real.
- `be194a4` — **elimina el flujo directo "Pagar cuentas pendientes (CxP)" en Pagos**: se quita el panel de pago directo por checkbox (`crearPanelPagoCxP`, `manejarConfirmarPagoCxP`, `renderizarPanelPagoCxP` y estado asociado) junto con sus 4 invocaciones huérfanas, dejando como único flujo de ejecución el de recibos pendientes (`manejarConfirmarReciboPendiente`). El formulario de registro de Pagos independiente se preserva sin cambios. Confirmar con Neto el alcance exacto de este cambio junto con `c95dee5` si hace falta reactivar alguno.
- `79a03f6` — tickets en estado `liquidado` **colapsados bajo "Ver liquidados (N)"** en el detalle de proveedor en CxP; no afecta los totales de Total/Pagado/Saldo.
- `e65c36a` — **nuevo módulo de navegación "Recibos de Pago"** (nivel superior, no sub-pestaña de CxP/Pagos) para listar y redescargar los PDFs de `recibos_pago`, reconstruidos a partir de los datos guardados en Firestore.
- Checklist funcional completo (7 puntos) confirmado por Neto en el navegador con producción real.
- Cache: `7fa3778` cierra el bloque de etapas 1-2 con bump a `r16`; `41a8ccc` bump a `r18` tras el selector de forma de pago.

**Reglas de Firestore para `recibos_pendientes`/`recibos_pago` — mapeo diferenciado (reemplaza cualquier mención anterior de "mismo mapeo que `cuentas_por_pagar`"):**
- `recibos_pendientes`: `create` solo `puedeEscribir('cxp')`; `update` `puedeEscribir('cxp') || puedeEscribir('pagos')` (CxP los crea, Pagos los marca `completado`); `delete` `false`.
- `recibos_pago`: `create` solo `puedeEscribir('pagos')`; `update` y `delete` `false` — comprobante inmutable una vez generado.
- Validadas con una matriz dedicada de 13 pruebas en el Firestore Rules Playground con los 3 usuarios reales, antes del deploy.

### 6.5 Hallazgo crítico de sincronización — `firestore.rules` del repo estaba desactualizado desde hace semanas
- El repo llevaba commiteada la Fase 5 (commit `a4f3cd7`), mientras producción ya corría Fase 6 (roles/permisos por módulo, sección 4) desde que se desplegó — ese deploy se hizo directo desde la consola web de Firebase, nunca vía commit al repo. Nadie lo notó hasta esta sesión.
- Se reconstruyó `firestore.rules` combinando el contenido real de Fase 6 (copiado directamente de la consola de Firebase, confirmado 11/09 7:57am) con los 2 bloques nuevos de `recibos_pendientes`/`recibos_pago` (6.4), commit `154bdc2`.
- No existía `firebase.json` ni CLI de Firebase instalado en la máquina de desarrollo — se agregó un `firebase.json` mínimo apuntando solo a `firestore.rules`/`firestore.indexes.json` (vacío), sin tocar hosting/storage/functions, commit `d708eef`. Deploy resuelto sin instalación permanente vía `npx firebase-tools deploy --only firestore:rules --project everplastic`, autenticado con `GOOGLE_APPLICATION_CREDENTIALS` apuntando a una service-account key generada solo para la sesión y borrada al terminar.
- El deploy se verificó no solo por el output del CLI, sino comparando **byte a byte** el ruleset activo (vía API de Firebase Rules) contra el archivo local — coincidencia exacta. Publicado `2026-09-13T17:44:35Z`, ruleset `14cf9410-3547-4bfc-a501-a4ffc9cbfe2f`.
- **Principio nuevo para futuras sesiones:** nunca asumir que `firestore.rules` del repo refleja lo publicado en producción sin comparar directamente contra la consola — un deploy manual desde la consola web puede desincronizar el repo silenciosamente y sin aviso.

### 6.6 Borrado masivo de datos — EJECUTADO
Decisión operativa de Neto del 12/09 (sección 5.5), ejecutada este 13/09: borrado masivo de todos los datos de Firestore EXCEPTO `precios`, con recarga desde el 31/08/2026 en adelante. Resolvió de facto el caso huérfano del ticket 127 (sección 5.4) y volvió irrelevante para el día a día el hueco de precios anteriores al 22/07/2026 (sección 5.3) — pero ese hueco de datos históricos en sí nunca se completó ni se decidió formalmente. Sigue sin confirmarse con Neto el resultado del checklist de 20 puntos de verificación post-recarga, y si `recibos_pago`/`recibos_pendientes` quedaron incluidas o no en el borrado (no estaban cableadas a ningún mecanismo de borrado masivo existente, así que por defecto deberían haber sobrevivido intactas).

### 6.7 Pendiente sin tocar en esta sesión
`js/admin-usuarios.js` sigue con trabajo sin terminar y sin commitear del botón "Restablecer contraseña" en Admin→Usuarios — no se tocó en ninguna tarea de esta sesión, queda tal cual se encontró.

---

## 7. Pendientes

### Prioridad alta / decisión de negocio pendiente
- **Porcentajes de MIXTO 2:** Neto confirmó que tiene composición propia pero aún no dio los números reales — la plantilla de Composiciones tiene un placeholder inválido a propósito ahí.
- **Checklist de 20 puntos post-recarga** del borrado masivo (sección 6.6): nunca reportado explícitamente por Neto — no asumir que se corrió solo porque el borrado ya pasó.
- **Hueco de precios históricos anterior al 31/08/2026** (y, en general, anterior al 22/07/2026 para materiales fuera de MIXTO — sección 5.3): el borrado masivo lo volvió irrelevante para el día a día actual, pero el hueco en sí nunca se completó ni se decidió formalmente.

### Prioridad media
- **Estado desincronizado si se cierra la app entre pago ejecutado y firma pendiente** (caveat de la sección 6.4): un recibo puede quedar `pendiente_pago` en Firestore aunque el pago real ya se haya ejecutado y registrado correctamente. No bloquea nada crítico, pero puede confundir en la lista de "Recibos Pendientes" de Pagos. Sin solución implementada.
- **Reactivación del modal "Registrar Pago" de CxP** (deshabilitado en `c95dee5`) y del flujo directo "Pagar cuentas pendientes (CxP)" de Pagos (tocado en `be194a4`): código de ambos intacto, solo bloqueado en la UI — confirmar con Neto si/cuándo se reactivan.
- **Reseteo de contraseña por Admin:** explorado y descartado por ahora — el sistema usa emails sintéticos (`username@everplastic.local`), la vía correcta (Admin SDK) requeriría backend/Cloud Functions. Proceso manual de emergencia: dar de alta un usuario nuevo con el mismo rol y desactivar el viejo. Código SIN COMMITEAR y sin terminar en `js/admin-usuarios.js` de un intento abandonado (sección 6.7) — residuo intencional, no regresión.
- **Manual de Operación** (`docs/MANUAL_OPERACION.md`): completo (cerrado en sesión previa, incluye Mapa de Interacciones).
- **Dashboard Fase 2** (subproductos real vs. teórico por mes, todos los materiales): diseño acordado, sin código.
- **Formato de los reportes:** Neto señaló que "muy probablemente tendrá que cambiar" sin definir qué — pendiente de sesión dedicada.
- **Rendimientos — modo "por proceso sin material":** el selector de proceso es decorativo en modo "Por Material".

### Prioridad baja / backlog conocido
- Editar el ticket de un pago vinculado a CxP no re-vincula ni rompe el guard (usa `grupoPagoId`, no ticket).
- Borrado masivo de Admin no tiene concepto de `grupoPagoId` — borrar CxP sin borrar Pagos del mismo rango deja `grupoPagoId` huérfano. Tampoco cubre `recibos_pago`/`recibos_pendientes`.
- Consolidado CxP no muestra saldo a favor por proveedor (solo el Estado de Cuenta individual lo hace).
- Sin reporte exportable de "Composiciones vigentes".
- Telegram de Ventas duplica lógica en vez de reutilizar `enviarReporteTelegram` (deuda técnica, no gap funcional).
- Caso `admin:'lectura'` en las reglas de Firestore nunca se probó con un usuario real (ninguno tiene ese perfil hoy) — bajo riesgo dado el fallback de denegar por defecto.

---

## 8. Instrucción para la próxima sesión

1. Verificar `git log --oneline -5` (parado DENTRO de `eve-control-v2`) para confirmar el último commit real en `master`.
2. Confirmar con Neto el resultado del checklist de 20 puntos post-recarga del borrado masivo (sección 6.6/7), y si `recibos_pago`/`recibos_pendientes` quedaron incluidas o no en ese borrado.
3. Confirmar con Neto si planea reactivar el modal "Registrar Pago" de CxP (`c95dee5`) y/o el flujo directo "Pagar cuentas pendientes (CxP)" de Pagos (`be194a4`) — ambos siguen con el código intacto, solo bloqueados en la UI.
4. Si Neto trae los porcentajes reales de MIXTO 2, actualizar la plantilla de Composiciones antes de cualquier carga masiva nueva.
5. Revisar si sigue pendiente terminar o descartar el trabajo sin commitear en `js/admin-usuarios.js` (botón "Restablecer contraseña", sección 6.7).
6. Retomar desde ahí según lo que Neto indique.
