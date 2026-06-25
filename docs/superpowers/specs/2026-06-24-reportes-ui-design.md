# Fase 7 — Módulo Reportes UI (con Telegram)

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Módulo 5: Reportes).
Continúa la Fase 6 (Control de Producción + Trazabilidad), ya fusionada a
`master`.

## Objetivo

La pestaña "Reportes" dedicada (ya reservada en `ORDEN_TABS` desde la Fase
2, nunca construida): un selector de Módulo (Reporte General | Control de
Producción), filtros adaptados a ese módulo, Vista Previa en texto, y
exportación TXT/PDF/CSV — más el botón de Telegram, que envía un resumen
combinado de los 5 módulos junto con el PDF del Reporte General.

Reutiliza al máximo el motor de reportes ya construido (`reportes.js`,
Fase 3b) en vez de duplicar lógica de formato; lo extiende donde hace
falta sin romper a los módulos que ya lo consumen.

## Arquitectura

- **`js/reportes-ui.js`** (nuevo): la pestaña completa — dropdown de
  Módulo, barra de filtros adaptativa, Vista Previa, botones de
  exportación. Namespace `window.EVE_REPORTES_UI` (mismo patrón de
  namespace adoptado en la Fase 5, usado también en la Fase 6). Registra
  `window.EVE_MODULES.reportes = { render(container) {...} }`.
- **`js/reportes.js`** (modifica el archivo ya fusionado desde la Fase
  3b — el segundo cambio a un módulo de una fase anterior en todo el
  proyecto, después de `destaraje.js` en la Fase 6):
  - `obtenerDatosPeriodo(desde, hasta, filtrosAdicionales)` gana un
    tercer parámetro **opcional**, `{ ticket, proveedor, material,
    cliente }` (default `{}`). Cuando un campo viene vacío/ausente, no
    filtra por él — comportamiento idéntico al actual para todo llamador
    existente (`exportarReporteTXT/PDF/CSV` de Destaraje/Producción/
    Pagos/Control de Producción, que nunca pasan este tercer argumento).
  - Nuevas funciones, paralelas a las del Reporte General:
    `generarTXTControlProduccion(datos, periodo)`,
    `generarPDFControlProduccion(datos, periodo)`,
    `construirFilasCSVControlProduccion(datos)` — reutilizan
    `window.EVE_CONTROL_PRODUCCION.calcularStats`/`colorEficiencia`/
    `PROCESOS` en vez de reimplementar esos cálculos.
  - `agregarPagadoPorProveedor(pagos)`: nueva agregación — suma de
    `pagado` (dinero, no kg) por proveedor, excluye proveedores con
    suma `0`, ordenado descendente por monto (igual criterio que
    `agregarPorMaterial`/`agregarPorProveedor` ya existentes) — para el
    mensaje de Telegram.
  - `construirMensajeTelegram(periodo)` + `enviarReporteTelegram(periodo)`:
    leen `window.db.collection('config').doc('telegram')` (campos
    `token`, `chatId` — documento sembrado a mano en Firestore por
    ahora, ya que el Panel Admin que lo editaría no existe todavía) y
    llaman directo a la API de Telegram (`sendMessage` para el texto,
    `sendDocument` con el PDF adjunto) vía `fetch` desde el navegador —
    confirmado viable sin Cloud Function ni proxy.

## Filtros

- Dropdown **Módulo**: `"general"` (Reporte General) | `"controlProduccion"`
  (Control de Producción). Al cambiar, la barra de filtros se reconstruye
  por completo:
  - **General**: Ticket (texto), Desde, Hasta, Proveedor (`<select>`),
    Material (`<select>`), Cliente (`<select>`).
  - **Control de Producción**: Ticket (texto), Desde, Hasta, Operador
    (`<select>`), Turno (`<select>`, fijo: Matutino/Vespertino/Nocturno),
    Tipo de Proceso (`<select>`, los 5 valores de `PROCESOS`).
- Los `<select>` de Proveedor/Material/Cliente/Operador se pueblan con
  valores únicos reales de Firestore (orden alfabético, primera opción
  "Todos"), no autocompletado de texto libre — selección exacta, distinto
  del patrón de filtro usado en los módulos operativos.
- Botones "🔍 Vista Previa" y "🔄 Limpiar" (resetea todos los campos de
  filtro al estado vacío, sin regenerar la vista previa automáticamente).

## Vista Previa

- Al hacer clic en "🔍 Vista Previa": genera el periodo (`formatearPeriodo`,
  ya existente) y los datos filtrados, llama a `generarTXT` o
  `generarTXTControlProduccion` según el Módulo activo, y muestra ese
  texto dentro de un `<pre>` en una tarjeta — mismo contenido que
  descargaría el botón TXT, sin generar PDF (más rápido, sin
  dependencias nuevas).
- Botón "✕ Cerrar Vista Previa" oculta la tarjeta.

## Exportar (TXT / PDF / CSV)

- **Reporte General** (Módulo = `"general"`): mismo formato exacto ya
  implementado en la Fase 3b (`DESTARAJE GENERAL`, `TOTAL KG`,
  `DESGLOSE POR MATERIAL/PRODUCCION/VENTAS/PROVEEDOR+MATERIAL`,
  `RESUMEN PAGOS`, `DETALLE DE TICKETS`, `DETALLE DE PAGOS`) — sin
  cambios al formato, solo a la fuente de datos filtrados.
- **Control de Producción** (Módulo = `"controlProduccion"`), formato
  nuevo y paralelo:
  ```
  CONTROL DE PRODUCCIÓN
  REPORTE: PERSONALIZADO
  PERIODO: ...
  FECHA: ...

  TOTAL PROCESOS: 3
  TOTAL INPUT: 1,500 KG
  TOTAL OUTPUT: 1,430 KG
  EFICIENCIA PROMEDIO: 92.50%

  DESGLOSE POR TIPO DE PROCESO:
    PELETIZADO   2 procesos   900 KG output   eficiencia prom 90.00%
    MOLIENDA     1 proceso    530 KG output   eficiencia prom 96.50%

  DETALLE DE PROCESOS:
    TICKET  PROCESO     OPERADOR   TURNO     INPUT  OUTPUT  EFICIENCIA  MERMA%  F.INICIO  F.FIN
    P-001   PELETIZADO  CHRISTIAN  Matutino  1000   900     90.00%      10.00%  ...       ...
  ```
- El `etiquetaReporte` para esta pantalla (no atada a un tab Hoy/Esta
  Semana/Todos) es siempre `"PERSONALIZADO"`.
- CSV, una fila por registro (mismo criterio ya usado para el Reporte
  General desde la Fase 3b):
  - General: mismas columnas ya existentes (`modulo, ticket,
    proveedorOCliente, material, kg, fechaEntrada, fechaSalida,
    precioPorKg, total, pagado, deuda, fecha`) — sin cambios.
  - Control de Producción: `ticket, tipoProceso, operador, turno,
    totalInput, totalOutput, eficiencia, porcentajeMerma, fechaInicio,
    fechaFin` (un registro = un proceso completo; no se desglosan los
    materiales de entrada individuales en filas separadas).

## Telegram

- Botón "📤 Telegram": SIEMPRE construye el resumen de 5 secciones
  (decisión de esta fase, fiel al mock del spec, independiente del
  Módulo seleccionado en el filtro):
  ```
  📊 REPORTE
  Periodo: ...

  DESTARAJE:
  • Total: X kg
  • [material 1] X kg, [material 2] X kg   ← top 2 por kg

  PRODUCCIÓN:
  • Total: X kg
  • [material 1] X kg, [material 2] X kg

  VENTAS:
  • Total: X kg
  • [material 1] X kg, [material 2] X kg

  PAGOS:
  • Total Pagado: $X
  • [proveedor 1] $X, [proveedor 2] $X, ...   ← TODOS los proveedores con pagado > 0

  CONTROL DE PRODUCCIÓN:
  • Procesos: N
  • Material procesado: X kg     ← totalInput
  • Eficiencia promedio: X%

  📄 Ver PDF adjunto
  ```
  usando el rango Desde/Hasta del filtro activo (ignora Proveedor/
  Material/Cliente/Operador/Turno/Tipo de Proceso — el resumen siempre
  es global para ese periodo). El PDF adjunto es el Reporte General
  (`generarPDF`) del mismo periodo, sin esos filtros tampoco.
- Si `config/telegram` no existe, o falta `token`/`chatId`, se muestra un
  error claro (`showError`) y no se intenta la llamada.
- Sin "Probar Telegram" en esta fase — ese botón es del Panel Admin
  (fase futura), sirve para probar la conexión, no para enviar un
  reporte real.

## Archivos

- Crear `js/reportes-ui.js`: IIFE, expone `window.EVE_REPORTES_UI`,
  registra `window.EVE_MODULES.reportes`.
- Modificar `js/reportes.js`: extender `obtenerDatosPeriodo` (parámetro
  opcional, retrocompatible), agregar generadores de Control de
  Producción, `agregarPagadoPorProveedor`, `construirMensajeTelegram`,
  `enviarReporteTelegram`.
- Modificar `index.html`: agregar `<script src="js/reportes-ui.js">`
  después de `control-produccion.js`.
- Modificar `css/styles.css`: estilos para el dropdown de Módulo, la
  barra de filtros adaptativa, la tarjeta de Vista Previa con `<pre>`.
  Reutilizar `.card`, `.btn-primary`/`.btn-secondary`, `.form-grid` donde
  aplique.
- **Acción manual fuera de código** (no automatizable desde el cliente):
  sembrar el documento `config/telegram` en Firestore con `token` y
  `chatId` reales, para poder probar el botón en vivo. Se documentará el
  procedimiento exacto en el plan de implementación.

## Fuera de alcance

- Panel Admin completo (gestión de usuarios, importación Excel, borrado
  de datos, UI para editar el token de Telegram, botón "Probar
  Telegram", horario de reporte automático) — fase futura.
- Cualquier cambio a `js/destaraje.js`, `js/produccion.js`, `js/pagos.js`,
  `js/control-produccion.js`, `js/trazabilidad.js`, `js/voz.js`,
  `js/auth.js` — esta fase solo los consume (vía `reportes.js`/
  `reportes-ui.js`).
- Envío automático/programado de reportes — el spec lo menciona para el
  Panel Admin ("Configurar horario de reporte automático"), no para esta
  pestaña, que es siempre manual (el usuario hace clic).

## Criterio de aceptación

- Node: `obtenerDatosPeriodo` con y sin el tercer parámetro (confirmando
  que los llamadores existentes — sin pasarlo — no cambian de
  comportamiento), los nuevos generadores de Control de Producción con
  datos de prueba, `agregarPagadoPorProveedor`, y `construirMensajeTelegram`
  con un fixture que cubra los 5 módulos.
- Playwright en vivo: abrir la pestaña Reportes, cambiar entre los 2
  Módulos (confirmar que la barra de filtros cambia), aplicar un filtro
  real (ej. un proveedor existente) y verificar que Vista Previa refleja
  el filtro, exportar TXT/PDF/CSV de ambos Módulos, y — si el documento
  `config/telegram` está sembrado en el ambiente de prueba — probar el
  botón de Telegram y confirmar que la API respondió `ok: true` (sin
  depender de revisar el chat de Telegram manualmente). Sin errores de
  consola.
