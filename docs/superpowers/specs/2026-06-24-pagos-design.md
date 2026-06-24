# Fase 5 — Módulo Pagos + Ministraciones

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Módulo 3: Pagos).
Continúa la Fase 4 (Producción), ya fusionada a `master`.

## Objetivo

Un módulo Pagos funcional (CRUD + voz + filtros + exportaciones, mismo
patrón que Destaraje/Producción) más un sub-flujo de Ministraciones
(efectivo semanal entregado) con su propio control de flujo visible en el
tab "Esta Semana". Reutiliza al máximo `reportes.js` y `voz.js`, que ya
incluyen soporte de Pagos desde fases anteriores.

## Arquitectura: namespace en vez de sufijos

La revisión final de la Fase 4 señaló que la convención de sufijos
(`filtrarPorHoyProduccion`, etc.) para evitar colisiones en `window` no
escala bien. Decisión para esta fase (y en adelante): `pagos.js` expone
sus helpers internos en un único objeto, **`window.EVE_PAGOS`**, en vez de
declarar cada uno directo en `window`. Solo `window.EVE_MODULES.pagos =
{ render }` se agrega al registro compartido, igual que los demás
módulos.

`destaraje.js` y `produccion.js` **no se modifican** en esta fase — siguen
con la convención de sufijos, ya revisada y fusionada. La migración de
esos dos módulos al mismo patrón de namespace, si se decide hacer, queda
fuera de alcance aquí.

```javascript
window.EVE_PAGOS = {
  calcularStats, filtrarPorHoy, filtrarPorSemana, aplicarFiltrosTodos,
  valoresUnicos, construirRegistroDesdeFormulario,
  construirMinistracionDesdeFormulario, calcularControlFlujo,
  crearFormulario, crearModalEdicion, abrirModalEdicion,
  actualizarDatalists, confirmarEliminar, confirmarEliminarMinistracion
};
window.EVE_MODULES.pagos = { render: renderPagos };
```

## Datos

- Colecciones Firestore: `pagos` y `ministraciones`
  (`COLECCIONES.PAGOS`/`COLECCIONES.MINISTRACIONES`, ya en `config.js`).
- Fuente en memoria: `window.EVE.registrosPagos` y
  `window.EVE.registrosMinistraciones` (ya cargados desde la Fase 2; sin
  separación en sub-listas).
- Estructura Pagos:
  ```javascript
  {
    ticket, proveedor, material, kg,
    precioPorKg, total,   // total = kg * precioPorKg, siempre calculado
    pagado,                // puede ser 0 (deuda total pendiente) — válido
    fecha,                  // YYYY-MM-DD, fecha del pago (no hay entrada/salida)
    fechaRegistro
  }
  ```
- Estructura Ministración:
  ```javascript
  {
    monto, fecha,            // YYYY-MM-DD
    semana,                  // ISO week, ej. "2026-W26" — solo para el
                              // esquema/registro histórico, no se usa para
                              // filtrar "esta semana" en la UI (ver más abajo)
    fechaRegistro
  }
  ```
- Validación Pagos: ticket/proveedor/material/fecha obligatorios; `kg`
  número `> 0`; `precioPorKg` número `> 0` (un pago siempre tiene precio;
  `pagado` sí puede ser 0, pero el precio no — son conceptos distintos).
  `pagado` número `>= 0`.
- Validación Ministración: fecha obligatoria; `monto` número `> 0`.
- Igual que Destaraje/Producción: tras crear/editar/eliminar se actualiza
  el array en memoria directamente (push/reemplazo/splice), sin releer la
  colección completa.
- Referencia de fecha para Hoy/Esta Semana/filtros: el campo `fecha` del
  registro (Pagos no tiene fechaEntrada/fechaSalida).
- Nueva utilidad en `js/utils.js`: `obtenerSemanaISO(fechaISO)` → string
  `"YYYY-Www"` (algoritmo ISO 8601 estándar: mover al jueves de la semana,
  calcular el número de semana relativo al año de ese jueves). Usada solo
  al construir el registro de Ministración antes de guardarlo.

## Formulario de Pagos

- Campos: Ticket, Proveedor (`<datalist>`, autocompleta con
  `PROVEEDORES_COMUNES` + únicos de `registrosPagos[].proveedor`),
  Material (`<datalist>`, `MATERIALES_COMUNES` + únicos), Kg, Precio/Kg,
  Pagado, Fecha (`type="date"`, valor inicial = `obtenerFechaMexico()`),
  Total (`<input disabled>`, solo lectura).
- Total se recalcula en vivo: un listener `input` en Kg y Precio/Kg
  recalcula `kg * precioPorKg` y lo muestra formateado con
  `formatearMoneda` en el campo Total. Al guardar, el total real se
  recalcula de nuevo en `construirRegistroDesdeFormulario` (nunca se
  confía en el valor mostrado en el campo deshabilitado).
- Botón de voz: reutiliza `window.crearBotonVoz` + `window.parsePagos`
  (Fase 3c, sin cambios). Patrón: `"Ticket 9260 de Jose Enrique, Mixto,
  650, a 10, pagado 6500"` → llena ticket/proveedor/material/kg/
  precioPorKg/pagado y dispara el recálculo de Total. La fecha no viene en
  el resultado de voz (el spec no la incluye en ese patrón) — el campo
  Fecha se deja con el valor que ya tenga (hoy por defecto); el usuario lo
  ajusta a mano si el pago es de otro día. Igual que en fases anteriores,
  la voz solo llena el formulario — el usuario revisa y da clic en
  Guardar, nunca se guarda automáticamente.
- Guardar: `guardarDato('pagos', registro)`.
- Editar: modal con los mismos campos (incluye Ticket, a diferencia de
  Producción — en Pagos no hay bifurcación de arrays que proteger, así que
  el ticket es editable también en el modal). Total también recalculado en
  vivo dentro del modal.
- Eliminar: confirmación nativa (`confirm()`), igual que los demás
  módulos.

## Tabs Hoy / Todos

- 3 tabs internas: Hoy / Esta Semana / Todos (criterio de fecha:
  `fecha` del registro, igual lógica de comparación que
  `fechaSalida` en Destaraje/Producción).
- Stats card: Registros, Total KG, Total Pagado, Total Deuda. Total
  Pagado/Total Deuda reutilizan **directamente**
  `window.calcularResumenPagos(registros)` (ya existe en `reportes.js`
  desde la Fase 3b) — sin duplicar ese cálculo en `pagos.js`.
- Tabla: columnas Ticket | Proveedor | Material | Kg | Precio/Kg | Total |
  Pagado | Fecha | acciones (Editar/Eliminar).
- Filtros (solo visibles en tab "Todos"): Ticket, Proveedor, Material,
  Desde, Hasta — mismo patrón de barra de filtros que Destaraje, aplicados
  sobre `fecha`.
- Exportar: 3 botones TXT/PDF/CSV llamando **directamente**
  `window.exportarReporteTXT/PDF/CSV(tabActiva, filtros)` (Fase 3b, sin
  cambios) — el reporte generado sigue siendo el reporte completo de los 4
  módulos (incluye su propia sección "RESUMEN PAGOS" y "DETALLE DE PAGOS",
  ya implementadas); lo único que cambia es el rango de fechas derivado
  del tab/filtros activos en Pagos.

## Tab Esta Semana: Control de Flujo Semanal

- Tarjeta nueva (CSS nuevo: `.control-flujo`, `.lista-ministraciones`),
  arriba de la tabla normal de Pagos de esta semana:
  ```
  CONTROL DE FLUJO SEMANAL
  Total Ministrado:  $20,000.00
  Total Pagado:       $15,000.00
  Saldo Disponible:   $5,000.00
  % Ejecutado:        75%

  Detalle ministraciones:
  • 28/04 - $10,000 [🗑️]
  • 25/04 - $10,000 [🗑️]

  [💵 Registrar Ministración]
  ```
- "Esta semana" se calcula **igual para Pagos y para Ministraciones**:
  `fecha >= obtenerInicioSemana()` — la misma convención que ya usan
  Destaraje/Producción para su tab "Esta Semana". El campo `semana`
  guardado en Ministraciones es solo una etiqueta de esquema (tal como la
  pide el spec original); no se usa para filtrar la vista.
- Cálculo (`calcularControlFlujo(pagosSemana, ministracionesSemana)`):
  - `totalMinistrado` = suma de `monto` de las ministraciones de la
    semana.
  - `totalPagado` = suma de `pagado` de los pagos de la semana.
  - `saldoDisponible` = `totalMinistrado - totalPagado`.
  - `porcentajeEjecutado` = `totalPagado / totalMinistrado * 100`, **0 si
    totalMinistrado es 0** (evita división entre 0).
- Lista de ministraciones de la semana: fecha (formateada dd/mm) + monto +
  botón 🗑️ con `confirm()` → `eliminarDato('ministraciones', id)` +
  splice en memoria + re-render de la tarjeta. Sin edición (el spec original
  solo muestra borrar, no editar, para ministraciones).
- Botón "💵 Registrar Ministración" abre un modal (mismo patrón visual
  `.modal-overlay` ya usado en los modales de edición) con campos Monto y
  Fecha (`type="date"`, valor inicial = hoy). Al guardar:
  `construirMinistracionDesdeFormulario` calcula `semana` con
  `obtenerSemanaISO(fecha)`, `guardarDato('ministraciones', registro)`,
  push en memoria, cierra modal, re-render de la tarjeta.
- Debajo de la tarjeta: stats card + tabla normal de Pagos de esta semana
  (mismo patrón de columnas/acciones que en Hoy/Todos) + los 3 botones de
  exportar.
- Ministraciones no aparecen en los reportes exportados (TXT/PDF/CSV) — el
  spec original no las incluye ahí, solo en esta tarjeta de la UI.

## Archivos

- Crear `js/pagos.js`: IIFE, helpers propios (duplican intencionalmente
  los de Destaraje/Producción donde aplica — mismo criterio ya usado en
  fases anteriores: son funciones cortas y compartirlas significaría
  tocar código ya fusionado sin necesidad clara), expuestos en
  `window.EVE_PAGOS` (ver sección Arquitectura). Registra
  `window.EVE_MODULES.pagos = { render(container) {...} }`.
- Modificar `js/utils.js`: agregar `window.obtenerSemanaISO(fechaISO)`.
- Modificar `index.html`: agregar `<script src="js/pagos.js">` después de
  `produccion.js`.
- Modificar `css/styles.css`: reutilizar clases genéricas existentes
  (`.card`, `.tabs`, `.modal-overlay`, `.btn-voz`, las clases
  `.destaraje-*` ya reutilizadas por Producción) para el formulario,
  tabs, tabla, filtros y exportar. Agregar únicamente lo necesario para
  `.control-flujo` (la tarjeta de flujo semanal) y `.lista-ministraciones`
  (lista con botón de borrar inline), que no tienen equivalente en fases
  anteriores.

## Fuera de alcance

- Cualquier cambio a `reportes.js`, `voz.js`, `auth.js`, `destaraje.js` o
  `produccion.js` — esta fase solo los consume.
- Migrar Destaraje/Producción al patrón `window.EVE_<MODULO>` — decisión
  de arquitectura aplicada solo hacia adelante, no retroactiva en esta
  fase.
- Edición de ministraciones (el spec original solo pide alta y borrado).
- Incluir ministraciones en los reportes exportados.
- Control de Producción (transformaciones, trazabilidad) → fase 6.

## Criterio de aceptación

- Node: helpers puros (stats, filtro por fecha, validación de formulario
  de Pagos, validación de Ministración, `calcularControlFlujo` con caso de
  ministrado=0, `obtenerSemanaISO` con casos cruzando fin de año) con
  casos de prueba análogos a los de Destaraje/Producción.
- Playwright en vivo: crear un pago de prueba (ticket/proveedor
  claramente marcados como prueba) por voz, verificar que aparece en Hoy,
  filtrar en Todos, editar, exportar TXT/PDF/CSV desde la tab de Pagos,
  registrar una ministración de prueba y verificar que el Control de Flujo
  Semanal refleja los montos correctos, eliminar la ministración de
  prueba, eliminar el pago de prueba (limpieza). Sin errores de consola.
  Selectores siempre acotados a la fila/elemento del registro de prueba
  (lección de la Fase 3a — nunca un selector que pueda coincidir con
  registros reales ya existentes en Firebase).
