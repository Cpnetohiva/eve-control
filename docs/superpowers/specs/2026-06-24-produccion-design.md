# Fase 4 — Módulo Producción

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Módulo 2: Producción).
Continúa la Fase 3 (Destaraje CRUD + reportes + voz), ya fusionada a
`master`.

## Objetivo

Un módulo Producción funcional, estructuralmente igual a Destaraje pero más
simple: un solo tipo de registro (sin Compra/Venta), captura manual + voz +
exportaciones — reutilizando al máximo el motor de reportes y de voz ya
construidos en la Fase 3, sin duplicar esa lógica.

## Datos

- Colección Firestore: `produccion` (`COLECCIONES.PRODUCCION`, ya en
  `config.js`).
- Estructura: `{ ticket: "P", cliente, material, kg, fechaEntrada,
  fechaSalida, fechaRegistro }` — el ticket es siempre `"P"`, nunca
  editable por el usuario.
- Fuente en memoria: `window.EVE.registrosProduccion` (ya cargado desde la
  Fase 2; sin separación en sub-listas, a diferencia de Destaraje/Ventas).
- Igual que Destaraje: tras crear/editar/eliminar, se actualiza el array en
  memoria directamente (push/reemplazo/splice), sin volver a leer toda la
  colección.
- `fechaSalida` sigue siendo la fecha de referencia para Hoy/Esta
  Semana/filtro de fechas (misma regla de negocio que Destaraje, Fase 3a).

## Formulario

- Campos: Ticket (deshabilitado, valor fijo `"P"` — decisión de esta fase:
  visible pero no editable, para consistencia visual con el campo ticket
  deshabilitado del modo Venta de Destaraje), Cliente (con `<datalist>`),
  Material (con `<datalist>`), Kg, Fecha Entrada, Fecha Salida.
- Autocompletado: Cliente = únicos de `registrosProduccion[].cliente` (sin
  semilla — no existe una lista `CLIENTES_COMUNES` en `config.js`).
  Material = únicos de `registrosProduccion[].material` ∪
  `MATERIALES_COMUNES`.
- Sin selector Compra/Venta — no aplica a este módulo.
- Botón de voz: reutiliza `window.crearBotonVoz` + `window.parseProduccion`
  (ambos ya construidos en la Fase 3c, sin cambios). El resultado llena el
  formulario para que el usuario revise y guarde — no se guarda solo, igual
  que en Destaraje.
- Guardar: `guardarDato('produccion', { ticket: 'P', cliente, material,
  kg, fechaEntrada, fechaSalida })`.
- Editar: modal con los mismos campos, ticket también deshabilitado (no
  hay ambigüedad de tipo que resolver, a diferencia de Destaraje donde el
  ticket deshabilitado evita que una venta se reclasifique).
- Eliminar: confirmación nativa, igual que Destaraje.

## Tabs y tabla

- 3 tabs internas: Hoy / Esta Semana / Todos — mismo criterio que
  Destaraje (`fechaSalida`).
- Una sola tabla (no hay split en sub-tablas, a diferencia de
  Destaraje/Ventas) con columnas Cliente | Material | Kg | F. Entrada |
  F. Salida | acciones. La columna Ticket se omite de la tabla (siempre
  "P", no aporta información) — a diferencia de Destaraje, donde el ticket
  sí distingue compra/venta.
- Stats: Total registros, Total KG (suma de `kg` donde el material no está
  en `MATERIALES_PZ`), Total PZ (si aplica — el documento original no
  lista materiales de producción en PZ, pero la lógica se deja genérica por
  si algún material de producción coincide con `MATERIALES_PZ` en el
  futuro).
- Tab Todos agrega filtros en tiempo real: Cliente, Material, Fecha
  Desde/Hasta (no se incluye filtro de Ticket — siempre es "P", filtrar por
  él no aporta nada).

## Exportaciones

- 3 botones (TXT/PDF/CSV) en las tabs de Producción, llamando
  **directamente** `window.exportarReporteTXT/PDF/CSV(tabId, filtros)` —
  las mismas funciones que ya usa Destaraje (Fase 3b), sin ningún cambio en
  `reportes.js`. El reporte generado sigue siendo el reporte completo de
  los 4 módulos; lo único que cambia es el rango de fechas, derivado de la
  tab/filtros activos en Producción en ese momento.

## Archivos

- Crear `js/produccion.js`: mismo patrón que `js/destaraje.js` — IIFE,
  helpers puros propios (stats, filtros por fecha, validación) duplicados
  a propósito en este archivo en vez de compartidos con `destaraje.js`
  (mismo criterio ya usado entre `destaraje.js` y `reportes.js` en la Fase
  3b: son funciones de 5-10 líneas, y compartirlas significaría tocar
  código ya fusionado y revisado sin necesidad clara). Se registra en
  `window.EVE_MODULES.produccion = { render(container) {...} }`.
- Modificar `index.html`: agregar `<script src="js/produccion.js">`
  después de `destaraje.js`.
- Modificar `css/styles.css`: estilos nuevos solo si hace falta algo que
  las clases existentes (`.card`, `.tabs`, `.destaraje-tabla-wrapper`
  reutilizada con otro nombre o genérica, `.destaraje-exportar`,
  `.btn-voz`, `.modal`) no cubran. Si las clases existentes de Destaraje
  sirven igual para Producción (son genéricas, no específicas de
  Destaraje en su nombre salvo el prefijo), se reutilizan tal cual.

## Fuera de alcance

- Cualquier cambio a `reportes.js`, `voz.js`, `destaraje.js` o `auth.js` —
  esta fase solo los consume.
- Control de Producción (transformaciones, trazabilidad) → fase 6, no debe
  confundirse con este módulo de Producción simple.

## Criterio de aceptación

- Node: helpers puros (stats, filtro por fecha, validación de formulario)
  con casos de prueba análogos a los de Destaraje.
- Playwright en vivo: crear un registro de producción de prueba (ticket
  "P", cliente/material claramente marcados como prueba), verificar que
  aparece en Hoy, filtrar en Todos, editar, exportar TXT/PDF/CSV desde la
  tab de Producción, eliminar el registro de prueba (limpieza), y probar
  el botón de voz con `SpeechRecognition` simulado. Sin errores de
  consola. Selectores siempre acotados a la fila del registro de prueba
  (lección de la Fase 3a — nunca un selector que pueda coincidir con
  registros reales de producción ya existentes).
