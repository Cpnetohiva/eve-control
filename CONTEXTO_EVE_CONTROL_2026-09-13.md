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
- Cambios a `firestore.rules` se tratan con cautela extra: texto completo siempre re-verificado línea por línea antes de aprobar (el texto largo pegado en chat se ha truncado/comprimido más de una vez sin avisar), nunca se despliega sin correr antes una matriz de pruebas manual en el Firestore Rules Playground, y el borrador se guarda como archivo commiteado en el repo (no solo en el historial de chat) para no perderlo entre sesiones.
- **Regla nueva confirmada esta sesión (13/09):** cualquier commit que toque un archivo listado en `APP_SHELL` de `service-worker.js` (prácticamente todo `js/*.js` y `css/styles.css`) DEBE ir acompañado de un bump de `CACHE_NAME`, en su propio commit separado, al cerrar el bloque de trabajo. Ver incidente en sección 7.1 — ya ocurrió dos veces (r7 histórico, r12 esta sesión) por olvidarlo.
- Neto se comunica en español en las sesiones técnicas.

---

## 3. Arquitectura de datos clave

- **`cuentas_por_pagar` (CxP):** cada cuenta tiene `abonos[]` (activos) y `abonosRevertidos[]` (histórico). Cada abono tiene `abonoId` único (no por índice). `grupoPagoId` vincula un abono con su sobrante en `saldoAFavor` y con su doc en `pagos`.
- **`proveedores.saldoAFavor`:** array de movimientos, cada uno con `grupoPagoId`, `revertido: boolean`.
- **`pagos`:** puede tener `grupoPagoId` y `origen` (valores conocidos: `panel_cxp`, `recibo_pendiente` desde el 13/09 — ver sección 7.2). Revertidos se marcan `revertido: true` (nunca se borran), excluidos de Stats/Reportes/exportaciones.
- **`recibos_pendientes` (nueva, 13/09/2026):** generada desde CxP, PDF sin firma, pago aún no ejecutado. `{proveedor, tickets: [{ticket, material, kg, precio, monto, saldo}], montoTotal, fechaGeneracion, generadoPor, estado: 'pendiente_pago'|'completado'}`. Ver flujo completo en sección 7.2.
- **`recibos_pago` (introducida 12-13/09/2026):** recibo firmado final, PDF con firma. `{proveedor, grupoPagoId, tickets, totalPago, fecha, firmaBase64, registradoPor, timestamp}`. **Importante:** ni `recibos_pago` ni `recibos_pendientes` están cableadas a `window.COLECCIONES`/`CARGAS_MODULO`/`window.EVE`/`limpiarEstadoLocal` — se leen/escriben con nombres de colección literales (`window.guardarDato('recibos_pago', ...)`, queries `.where()` ad-hoc), no se cargan al login ni entran en el borrado masivo de Admin. Si el borrado total de datos (sección 8) se ejecuta, estas dos colecciones NO se van a limpiar automáticamente junto con las demás — hay que decidir aparte qué hacer con ellas.
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
- Mapeo de colecciones no obvio: `proveedores`→`cxp` (no `pagos`); `comisiones`→lectura vía `cxp`, escritura EXCLUSIVA de `esAdminEscritura()`; `historial_cambios`→lectura vía `admin`, escritura abierta a cualquier autenticado (log append-only); `users`/`roles` permiten lectura también con `admin:'lectura'` (no solo `'escritura'`), para no bloquear el panel a un admin de solo-auditoría; `recibos_pendientes`→`create` solo `puedeEscribir('cxp')`, `update` `puedeEscribir('cxp') || puedeEscribir('pagos')`, `delete` `false`; `recibos_pago`→`create` solo `puedeEscribir('pagos')`, `update`/`delete` `false` (comprobante inmutable). **Detalle completo y verificación del deploy en sección 8.5.**
- **Actualizado 13/09/2026:** el `firestore.rules` real de producción estaba desincronizado del repo desde hace semanas (producción corría Fase 6 desplegada manualmente desde la consola de Firebase, el repo seguía en Fase 5) — se reconstruyó y redesplegó vía CLI en esta sesión. Ver hallazgo completo en sección 8.5. El borrador vive commiteado en `rules-test/firestore.rules`; los bloques de `recibos_pago`/`recibos_pendientes` ya están también en el `firestore.rules` de producción, no solo en el borrador.
- El archivo `matriz-pruebas-firestore-rules.md` (raíz del repo) documenta los 28 checks originales de Fase 6 y sus resultados. Los bloques de `recibos_pago`/`recibos_pendientes` se validaron aparte con una matriz propia de 13 pruebas en el Playground (sección 8.5) antes del deploy.

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

Se verificó (`js/destaraje.js`, función `confirmarEliminar()`) que en ese momento NO existía ningún guard de borrado en Destaraje — la función solo pedía un motivo por `window.prompt()` y borraba directamente, sin validar contra `cuentas_por_pagar`. Esto contrastaba con el guard que sí existe en `js/pagos.js` (bloquea "Eliminar" si el pago tiene `grupoPagoId` con abono activo o `saldoAFavor`, commit `808e270`).

**Este hueco de diseño ya se cerró el 13/09/2026 — ver sección 7.1 de la sesión 13/09.** El caso puntual del ticket 127 en sí (el doc huérfano ya existente) sigue pendiente de resolverse como efecto colateral del borrado masivo de datos (sección 7.5) o de una corrección manual directa — el guard nuevo solo previene que **vuelva a pasar**, no repara el dato ya huérfano.

### 7.5 Decisión operativa de Neto (12/09/2026) — EJECUTADA el 13/09/2026
Neto decidió el borrado masivo de todos los datos de Firestore EXCEPTO la colección `precios`, con recarga posterior a partir del 31/08/2026 en adelante.

**Estado real al cierre del 13/09/2026: la decisión se ejecutó.** Ver sección 8.5 para el detalle. Sigue sin confirmarse con Neto el resultado del checklist de 20 puntos de verificación post-recarga (nunca se reportó explícitamente en esta sesión) — no asumir que se corrió solo porque el borrado ya pasó.

**Nota pendiente de confirmar:** no quedó registrado en esta sesión si `recibos_pago` y `recibos_pendientes` (nuevas colecciones, sección 3) se incluyeron en el borrado o se conservaron — no estaban cableadas a ningún mecanismo de borrado masivo existente en Admin, así que por defecto deberían haber sobrevivido intactas, pero hay que confirmarlo con Neto.

---

## 8. Sesión 13/09/2026

### 8.1 Guard de borrado en Destaraje contra CxP con saldo pendiente
Commit `b9c7f5a`. Cierra el hueco de diseño documentado en la sesión anterior (sección 7.4, caso ticket 127).

`confirmarEliminar(id)` en `js/destaraje.js` ahora, antes de pedir el motivo y borrar, hace una lectura fresca a Firestore (`obtenerCxPConSaldoPendiente(ticket)`: `cuentas_por_pagar.where('ticket', '==', ticket)`, filtra `saldo > 0`). Si encuentra una cuenta con saldo pendiente para ese ticket, **bloquea el borrado por completo** (hard block, no advertencia salteable) con mensaje indicando el saldo y que debe resolverse desde CxP primero.

No se tocó `js/pagos.js` (su guard por `grupoPagoId`/`saldoAFavor` ya existía y sigue igual, commit `808e270` de una sesión previa). No repara el caso histórico del ticket 127 — solo previene que se repita con tickets futuros.

### 8.2 Incidente de caché: guard de borrado no se reflejaba en producción (r12 → r14)
El commit `b9c7f5a` (guard de borrado) modificó `js/destaraje.js`, que está en `APP_SHELL` de `service-worker.js` (precacheado), **sin incrementar `CACHE_NAME`**. Resultado: el service worker no detectó cambio en el script y siguió sirviendo la versión cacheada (`r12`) sin el guard — mismo patrón que un incidente histórico previo con `r7`.

- `d2bf1c6` — fix: bump a `r13`, corrigiendo específicamente el olvido de `b9c7f5a`.
- Luego, en la misma sesión, 3 commits más tocaron archivos precacheados sin bump individual:
  - `aa2f565` — fix(pagos): incluir proveedores de Báscula en el datalist de Proveedor.
  - `ea2977c` — feat(pagos): agrega columna Fecha en la tabla de tickets pendientes (CxP), entre Material y Saldo, para priorizar pago por antigüedad. No modifica lógica de selección/checkbox ni el cálculo de autosuma.
  - `b5063e6` — feat(bascula): buscador global fijo (icono de lupa) por Ticket/Proveedor/Fecha, visible en cualquier tab de Báscula; detecta automáticamente si el término es fecha (`AAAA-MM-DD`)/ticket (contiene dígitos)/proveedor (solo letras), cambia a la tab "Todos" y reutiliza `aplicarFiltrosTodos` ya existente — sin duplicar lógica de filtrado.
- `6c0e9c1` — chore: bump a `r14`, cerrando el bloque de los 3 commits anteriores (`pagos.js`, `destaraje.js`, `css/styles.css` modificados).

**Lección operativa ya incorporada a la metodología (sección 2):** cerrar cada bloque de trabajo que toque `APP_SHELL` con un bump de `CACHE_NAME` en commit separado, sin esperar a que Neto reporte que "no ve el cambio" en el navegador.

### 8.3 Flujo de recibo de pago firmable — primera versión de una sola etapa (superada, ver 8.4)
Commits `a0e2243`, `861788f`, `247469a` (bump a `r15`).

Primera implementación: al completar "Registrar Pago" en CxP se ofrecía un paso opcional "Generar Recibo" inmediato, que mostraba el desglose exacto de tickets liquidados por ese pago, un pad de firma táctil/mouse, y generaba tanto el doc en `recibos_pago` como el PDF con jsPDF — todo en una sola etapa, encadenado directamente al pago. No modificaba `distribuirPago` ni la lógica de abonos/reversión, solo leía su resultado.

`861788f` agregó el borrador de regla para `recibos_pago` en `rules-test/firestore.rules` (mismo mapeo que `cuentas_por_pagar` vía `permisosResueltos.cxp`), sin desplegar a producción.

**Esta versión fue completamente reestructurada más tarde en la misma sesión — ver 8.4.** El pad de firma (`crearPadFirma()`) y la función de generación de PDF (`generarPDFRecibo()`) de esta primera versión SÍ se conservaron y reutilizaron tal cual en el flujo final; lo que cambió fue desde dónde se disparan.

### 8.4 Flujo de recibo de pago en DOS ETAPAS (versión final, vigente)
Petición explícita de Neto: separar "generar el recibo" (documentación/desglose) de "ejecutar el pago" (acción real de dinero), para poder generar recibos preliminares sin comprometerse a pagar en ese momento, y ejecutar el pago real después con firma de conformidad. Commits `53c0de7`, `22b4fc7`, `ffc2184`, `7fa3778` (bump a `r16`).

**Etapa 1 — CxP genera el recibo SIN firma y SIN pago** (`53c0de7`, `js/cxp.js`):
- Se quitó el disparo automático del modal de firma justo después de "Registrar Pago" (de la versión 8.3). El pad de firma y `generarPDFRecibo()` se conservaron intactos, solo se dejaron de invocar desde ahí.
- Se agregó una columna de checkbox por ticket en la tabla de cuentas por proveedor (visible solo si `puedeEscribir('cxp')` y `saldo > 0`) + botón "Generar Recibo" (habilitado solo con ≥1 ticket marcado).
- Al presionar "Generar Recibo": genera un PDF **sin firma** con el desglose (tickets + total), **no ejecuta ningún pago**, y guarda un doc en la nueva colección `recibos_pendientes` con `estado: 'pendiente_pago'`.
- Se quitó también la columna "Origen" (aprobación/auditoría) de esa misma tabla — solo se dejó de mostrar, el campo `aprobacion`/`origenAuditoria` en los documentos no se tocó.
- `generarPDFRecibo()` se generalizó para aceptar recibos con o sin `firmaBase64`: cambia título, sección de firma y nombre de archivo según corresponda (`RECIBO PENDIENTE DE PAGO`/`Recibo_Pendiente_...` vs. `RECIBO DE PAGO`/`Recibo_Pago_...`). Se corrigió en el mismo commit un bug de formato de fecha (`fechaGeneracion` es ISO completo para el campo de Firestore, pero se le hace `.slice(0, 10)` antes de pasarlo al PDF, porque `window.formatearFecha()` espera estrictamente `AAAA-MM-DD`).

**Etapa 2 — Pagos ejecuta el pago real y luego pide firma** (`22b4fc7`, `js/pagos.js`):
- Nueva sección "Recibos Pendientes" (panel visible solo con `puedeEscribir('pagos')`) que lista los docs de `recibos_pendientes` con `estado: 'pendiente_pago'` (proveedor, monto, fecha de generación), consultados con `window.db.collection('recibos_pendientes').where('estado', '==', 'pendiente_pago').get()` — patrón de query nuevo en el módulo, no existía antes.
- Al elegir uno ("Ejecutar Pago"): modal precarga proveedor + tickets fijos (no reseleccionables) + monto editable (permite pago parcial).
- Antes de ejecutar, `revalidarYObtenerCuentasFrescas()` hace lectura fresca a Firestore del saldo actual de cada ticket incluido (mismo principio de concurrencia que `verificarSinPagosFrescos()` en `js/cxp.js`, pero con lógica propia: compara el `saldo` esperado — el que tenía el ticket cuando se generó el recibo pendiente — contra el `saldo` real actual). Si algún ticket cambió de saldo desde la generación, **bloquea con mensaje claro y no ejecuta nada**.
- Al confirmar: ejecuta `distribuirPago()` **sin modificar su lógica**, genera `grupoPagoId`, escribe `cuentas_por_pagar` + `pagos` (con `origen: 'recibo_pendiente'`) igual que el panel de pago directo ya existente (`manejarConfirmarPagoCxP()`, que sirvió de plantilla y **no se tocó**), y recién después abre el pad de firma **ya construido** (`window.EVE_CXP.crearPadFirma`).
- Al firmar: genera el PDF final firmado reutilizando `window.EVE_CXP.generarPDFRecibo()` (misma función de la etapa 1, ahora con `firmaBase64`), guarda el doc final en `recibos_pago` (estructura sin cambios) y marca el `recibos_pendientes` de origen como `estado: 'completado'` (no se borra, para trazabilidad).
- El panel/flujo directo preexistente "Pagar cuentas pendientes (CxP)" (`crearPanelPagoCxP`/`manejarConfirmarPagoCxP`) **sigue disponible sin cambios** — es una opción distinta, no reemplazada.
- **Caveat conocido y no resuelto:** si el usuario cierra la app después de que el pago ya se ejecutó pero antes de completar la firma, el doc en `recibos_pendientes` queda en `estado: 'pendiente_pago'` aunque el pago real ya ocurrió (el pago sí quedó registrado correctamente en `cuentas_por_pagar`/`pagos`, solo el estado del recibo queda desincronizado). No se agregó un tercer estado para cubrir este caso porque no estaba en el alcance pedido — queda como pendiente de backlog (ver sección 9).

**Restricciones explícitas respetadas en todo el flujo:** no se modificó `distribuirPago()`, ni la lógica de abonos, ni la de reversión de pagos en ningún punto de las etapas 1 o 2.

**Borrador de reglas (`ffc2184`):** se agregó el bloque `recibos_pendientes` en `rules-test/firestore.rules`, mismo mapeo `puedeLeer('cxp')`/`puedeEscribir('cxp')` que `recibos_pago`. **Sigue siendo solo borrador — NO desplegado a producción, pendiente de revisión de Neto y de correrse en el Playground junto con `recibos_pago` (ninguno de los dos está todavía en la matriz de 28 checks de `matriz-pruebas-firestore-rules.md`).**

**Cache:** `7fa3778` — bump final a `r16`, cerrando el bloque completo de `js/cxp.js` + `js/pagos.js` de las etapas 1 y 2.

### 8.5 Continuación 13/09/2026 — CxP: guard de borrado, incidente de caché, recibos firmables en dos etapas, sincronización de firestore.rules

Esta subsección cubre el resto del trabajo real de la sesión del 13/09, posterior a lo ya detallado en 8.1-8.4.

**Guard de borrado — caso de prueba real.** Además de lo documentado en 8.1/8.2, el ticket 938 (JULIO, MIXTO, $1,794) se usó para probar el guard nuevo en el navegador: se recapturó manualmente en Báscula/Destaraje después de confirmar que el guard bloqueaba correctamente el borrado, una vez resuelto el incidente de caché de 8.2. El caso huérfano del ticket 127 (sección 7.4) no se reparó con un fix dirigido — quedó cerrado como efecto colateral del borrado masivo de datos ejecutado hoy (ver más abajo).

**Ajustes menores de UX del mismo periodo** (la mayoría con commits ya listados en 8.2, más uno nuevo):
- Tabs "Este Mes" en Báscula/Pagos/Ventas/Control Producción (ver 7.1); tabs Hoy/Esta Semana/Este Mes/Todos en CxP "Por Proveedor" con `calcularCorteSemanalCxP()` (ver 7.2); tarjeta "Total Adeudado General" fija; botones "Exportar Resumen"/"Exportar Detalle"; columna "Origen" removida (ver 8.4).
- Pagos: dropdown de Proveedor incluye `window.EVE.registrosDestaraje`; columna "Fecha" en la tabla de tickets con checkbox (commits `aa2f565`/`ea2977c`, ver 8.2).
- Báscula: buscador global (ticket/proveedor/fecha) visible en cualquier tab, reutiliza `aplicarFiltrosTodos` (commit `b5063e6`, ver 8.2).
- **Nuevo:** rename Destaraje→Báscula completo en la UI, salvo el nombre de hoja "Destaraje" en la plantilla Excel de `js/admin-importar.js` — decisión consciente de no tocarlo, rompería archivos de importación ya existentes en manos de Neto.

**Recibos firmables por proveedor — commits posteriores a `7fa3778`**, extienden el flujo de dos etapas de 8.3/8.4 (decisión de fondo sin cambios: el recibo se genera ANTES del pago):
- `921bb6e` — monto editable por ticket al generar el recibo en CxP: los checkboxes dejan de ser todo-o-nada, permiten cubrir varios tickets completos y uno con abono parcial en el mismo recibo, con total seleccionado en tiempo real.
- Selector de forma de pago (Efectivo/Transferencia) agregado a la generación del recibo en CxP, guardado como `formaPago` en `recibos_pendientes` junto con el monto asignado por ticket.
- En Pagos, al ejecutar el recibo pendiente: si `formaPago === 'efectivo'` se exige firma en el pad táctil/mouse (como ya describe 8.4); si `formaPago === 'transferencia'` se exige en su lugar referencia/evidencia del movimiento bancario, sin pedir firma.
- `c95dee5` — deshabilita temporalmente el modal "Registrar Pago" de CxP (pago a suma alzada FIFO o abono a un ticket específico, sin recibo ni evidencia) en la UI, con tooltip explicativo. **Bloqueo intencionalmente reversible:** el código (`crearModalPago`/`abrirModalPago`/`manejarEnvioPago`/`registrarPagoGeneral`) sigue intacto, sin borrar — Neto planea reactivarlo más adelante junto con la operación real. El commit `be194a4` tocó en el mismo bloque el flujo directo "Pagar cuentas pendientes (CxP)" de Pagos (descrito en 8.4 como vigente sin cambios) — confirmar con Neto el alcance exacto de cada uno si hace falta reactivarlos.
- `79a03f6` — tickets en estado `liquidado` colapsados bajo "Ver liquidados (N)" en el detalle de proveedor en CxP; no afecta los totales de Total/Pagado/Saldo.
- `e65c36a` — nuevo módulo de navegación "Recibos de Pago" (nivel superior, no sub-pestaña de CxP/Pagos) para listar y redescargar los PDFs de `recibos_pago`, reconstruidos a partir de los datos guardados en Firestore.
- Checklist funcional completo (7 puntos) confirmado por Neto en el navegador con producción real.

**Reglas de Firestore para `recibos_pendientes`/`recibos_pago` — mapeo diferenciado, reemplaza lo dicho en 8.4 y en la sección 5 ("mismo mapeo que `cuentas_por_pagar`"):**
- `recibos_pendientes`: `create` solo `puedeEscribir('cxp')`; `update` `puedeEscribir('cxp') || puedeEscribir('pagos')` (CxP los crea, Pagos los marca `completado`); `delete` `false`.
- `recibos_pago`: `create` solo `puedeEscribir('pagos')`; `update` y `delete` `false` — comprobante inmutable una vez generado.
- Validadas con una matriz dedicada de 13 pruebas en el Firestore Rules Playground con los 3 usuarios reales, antes del deploy. Esto cierra el pendiente de "prioridad alta" que tenía la sección 9 sobre revisar y desplegar estas reglas.

**Hallazgo crítico de sincronización — `firestore.rules` del repo estaba desactualizado desde hace semanas:**
- El repo llevaba en Fase 5 (commit `a4f3cd7`) mientras producción ya corría Fase 6 (roles/permisos por módulo, sección 5) desde que se desplegó — ese deploy se hizo directo desde la consola web de Firebase en su momento, nunca vía commit al repo. Nadie lo notó hasta esta sesión.
- Se reconstruyó `firestore.rules` combinando el contenido real de Fase 6 (copiado directamente de la consola de Firebase) con los 2 bloques nuevos de `recibos_pendientes`/`recibos_pago` de arriba.
- No existía `firebase.json` ni CLI de Firebase instalado en la máquina de desarrollo — se resolvió sin instalación permanente vía `npx firebase-tools deploy --only firestore:rules --project everplastic`, autenticado con `GOOGLE_APPLICATION_CREDENTIALS` apuntando a una service-account key generada solo para la sesión y borrada al terminar. Se creó un `firebase.json` mínimo (solo `firestore.rules` + un `firestore.indexes.json` vacío).
- El deploy se verificó no solo por el output del CLI sino comparando byte a byte el ruleset activo (vía API de Firebase Rules) contra el archivo local — coincidencia exacta. Publicado `2026-09-13T17:44:35Z`, ruleset `14cf9410-3547-4bfc-a501-a4ffc9cbfe2f`.
- **Principio nuevo para futuras sesiones:** nunca asumir que `firestore.rules` del repo refleja lo publicado en producción sin comparar directamente contra la consola — un deploy manual desde la consola web puede desincronizar el repo silenciosamente y sin aviso.

**Decisión operativa de Neto — EJECUTADA el 13/09/2026** (actualiza el estado "pendiente" de la sección 7.5): borrado masivo de todos los datos de Firestore EXCEPTO `precios`, con recarga desde el 31/08/2026 en adelante. Esto resolvió de facto el caso huérfano del ticket 127 (sección 7.4) y volvió irrelevante para el día a día el hueco de precios anteriores al 22/07/2026 (sección 7.3) — pero **ese hueco de datos históricos en sí nunca se completó ni se decidió formalmente**: si algún día se necesita generar CxP retroactivo anterior al 31/08/2026, sigue latente y habrá que resolverlo aparte (no hay precios vigentes cargados para fechas previas a esa fecha, salvo MIXTO desde 2026-01-01).

**Pendiente real al cierre de esta sesión:** `js/admin-usuarios.js` sigue con el trabajo sin terminar y sin commitear del botón "Restablecer contraseña" en Admin→Usuarios (sección 9) — no se tocó en ninguna tarea de esta sesión, queda explícitamente tal cual se encontró.

---

## 9. PENDIENTES reales

### Prioridad alta / decisión de negocio pendiente
- **Porcentajes de MIXTO 2:** Neto confirmó que tiene composición propia pero aún no dio los números reales — la plantilla de Composiciones tiene un placeholder inválido a propósito ahí.
- **Borrado total de datos y recarga limpia:** RESUELTO/EJECUTADO el 13/09/2026 (ver sección 7.5 y 8.5). Pendiente real que queda: confirmar con Neto el resultado del checklist de 20 puntos de verificación post-recarga (nunca reportado explícitamente), y si `recibos_pago`/`recibos_pendientes` quedaron incluidas o no en el borrado (ver sección 3 y 7.5).
- **Hueco de precios históricos anterior al 31/08/2026** (y, en general, anterior al 22/07/2026 para materiales fuera de MIXTO — sección 7.3): el borrado masivo de datos lo volvió irrelevante para el día a día actual, pero el hueco en sí nunca se completó ni se decidió formalmente. Si algún día se necesita generar CxP retroactivo anterior a esas fechas, sigue latente.
- ~~Revisión y deploy de reglas de `recibos_pago`/`recibos_pendientes`~~ — **RESUELTO el 13/09/2026** (ver sección 8.5): mapeo diferenciado por colección definido, validado con una matriz de 13 pruebas propia en el Playground, y `firestore.rules` reconstruido (Fase 6 real + bloques de recibos) y desplegado a producción, verificado byte a byte contra el ruleset activo.

### Prioridad media
- **Caso histórico del ticket 127 (ARTURO LARA, $4,640, CxP huérfano):** RESUELTO de facto — el borrado masivo de datos ejecutado el 13/09/2026 (sección 8.5) eliminó el doc huérfano junto con el resto de los datos previos a la recarga, sin necesidad de una corrección manual dirigida. El guard nuevo (sección 8.1) sigue vigente para prevenir que se repita.
- **Estado desincronizado si se cierra la app entre pago ejecutado y firma pendiente** (caveat de la sección 8.4): un recibo puede quedar en `estado: 'pendiente_pago'` en Firestore aunque el pago real ya se haya ejecutado y registrado correctamente. No bloquea nada crítico (el dinero/CxP quedan bien), pero puede confundir al ver la lista de "Recibos Pendientes" en Pagos. Sin solución implementada — evaluar si hace falta un estado intermedio o una reconciliación manual.
- **Reseteo de contraseña por Admin:** explorado y descartado por ahora — el sistema usa emails sintéticos (`username@everplastic.local`, sin correos reales), y la vía correcta (Admin SDK) requeriría backend/Cloud Functions, descartado por costo y por falta de acceso remoto a Firebase desde la máquina de desarrollo (nunca está físicamente en la planta). **Proceso manual de emergencia:** dar de alta un usuario nuevo con el mismo rol y desactivar el viejo. Queda código SIN COMMITEAR y sin terminar en `js/admin-usuarios.js` de un intento abandonado — no es una regresión, es un residuo intencional a limpiar o retomar cuando se decida (verificado que sigue sin commitear al 13/09/2026).
- **Manual de Operación** (`docs/MANUAL_OPERACION.md`): completo (cerrado en sesión previa, incluye Mapa de Interacciones).
- **Dashboard Fase 2** (subproductos real vs. teórico por mes, todos los materiales): diseño acordado en una sesión anterior, sin código.
- **Formato de los reportes:** Neto señaló que "muy probablemente tendrá que cambiar" sin definir qué — pendiente de sesión dedicada.
- **Rendimientos — modo "por proceso sin material":** el selector de proceso es decorativo en modo "Por Material" (sin efecto real).

### Prioridad baja / backlog conocido
- Editar el ticket de un pago vinculado a CxP no re-vincula ni rompe el guard (usa `grupoPagoId`, no ticket) — inconsistencia visual/trazabilidad menor.
- Borrado masivo de Admin no tiene concepto de `grupoPagoId` — borrar CxP sin borrar Pagos del mismo rango deja `grupoPagoId` huérfano en documentos de `pagos`. Tampoco cubre `recibos_pago`/`recibos_pendientes` (ver sección 3).
- Consolidado CxP no muestra saldo a favor por proveedor (solo el Estado de Cuenta individual lo hace).
- Sin reporte exportable de "Composiciones vigentes".
- Telegram de Ventas duplica lógica en vez de reutilizar `enviarReporteTelegram` (deuda técnica, no gap funcional).
- Caso `admin:'lectura'` en las reglas de Firestore nunca se probó con un usuario real (ninguno tiene ese perfil hoy) — bajo riesgo dado el fallback de denegar por defecto, pero vale correrlo el día que se dé de alta alguien con ese rol.

---

## 10. Instrucción para la próxima sesión

1. Verificar `git log --oneline -5` (parado DENTRO de `eve-control-v2`) para confirmar el último commit real en `master` — al cierre de esta sesión es `c95dee5` (más el commit de esta misma actualización del handoff).
2. Confirmar con Neto el resultado del checklist de 20 puntos post-recarga del borrado masivo ejecutado el 13/09/2026 (secciones 7.5/8.5), y si `recibos_pago`/`recibos_pendientes` quedaron incluidas o no en ese borrado. Actualizar la sección 7.5 con lo que responda.
3. Confirmar con Neto si planea reactivar el modal "Registrar Pago" de CxP (deshabilitado en `c95dee5`) y/o el flujo directo "Pagar cuentas pendientes (CxP)" de Pagos (tocado en `be194a4`) — el código de ambos sigue intacto, solo bloqueado en la UI (sección 8.5).
4. Si Neto trae los porcentajes reales de MIXTO 2, actualizar la plantilla de Composiciones antes de cualquier carga masiva nueva.
5. Revisar si sigue pendiente terminar o descartar el trabajo sin commitear en `js/admin-usuarios.js` (botón "Restablecer contraseña" en Admin→Usuarios, sección 9) — al cierre de esta sesión seguía intacto tal cual se encontró.
6. Retomar desde ahí según lo que Neto indique.
