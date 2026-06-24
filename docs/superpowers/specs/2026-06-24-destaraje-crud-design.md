# Fase 3a — Módulo Destaraje y Ventas: CRUD + UI + tabs + filtros

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Módulo 1: Destaraje y Ventas).
Continúa la Fase 2 (`utils.js`/`auth.js`), ya fusionada a `master`.

## Por qué se dividió la Fase 3

El módulo completo (CRUD + reporte con formato exacto + voz) es demasiado
grande para un solo ciclo diseño→plan→implementación. Se dividió en:

- **3a — CRUD + UI + tabs + filtros ← este documento**
- 3b — Generador de reporte PDF/TXT/CSV con el formato completo (reutilizable
  luego por el módulo Reportes de la fase 7)
- 3c — Reconocimiento de voz

3a no incluye exportaciones ni voz — eso llega en 3b y 3c.

## Objetivo de 3a

Un módulo Destaraje funcional: capturar compras y ventas, verlas en 3 tabs
con estadísticas en tiempo real, filtrar en la tab TODOS, editar y eliminar
registros — todo contra Firebase real, actualizando `window.EVE` en memoria
sin recargar.

## Regla de negocio clave: fecha de referencia

Todo el módulo (tabs HOY/ESTA SEMANA, filtro de fechas en TODOS) usa
**`fechaSalida`** como fecha de referencia — no `fechaRegistro` ni
`fechaEntrada`. Razón (del usuario): `fechaSalida` indica cuándo el material
se procesó en planta e inició el proceso productivo; el histórico de
reportes se carga según la fecha en que ocurrieron los hechos, no según
cuándo se capturó el dato en el sistema.

- **HOY:** `fechaSalida === obtenerFechaMexico()`
- **ESTA SEMANA:** `fechaSalida >= obtenerInicioSemana()`
- **TODOS:** sin filtro de fecha por defecto; el filtro Desde/Hasta de esta
  tab compara contra `fechaSalida`.

## Datos

- Colección Firestore: `destaraje` (`COLECCIONES.DESTARAJE`, de `config.js`).
- Fuente en memoria: `window.EVE.registrosDestaraje` (ticket numérico) y
  `window.EVE.registrosVentas` (ticket `"V"`) — ya separados por `auth.js`
  (Fase 2) al cargar sesión.
- Tras crear/editar/eliminar vía `guardarDato`/`actualizarDato`/`eliminarDato`
  (`utils.js`), se actualiza el array en memoria correspondiente
  (push/reemplazo/splice) y se re-renderiza — sin volver a leer toda la
  colección de Firestore.
- Mapeo unidad: `formatearKg(kg, material)` (de `utils.js`) ya decide
  KG vs PZ según `MATERIALES_PZ`.

## Formulario

- Selector **Compra / Venta** (radio o botones tipo toggle) arriba del
  formulario:
  - Compra → campo Ticket numérico libre; etiqueta del campo
    proveedor/cliente = "Proveedor".
  - Venta → campo Ticket fijo en `"V"` (no editable); etiqueta = "Cliente".
- Campos: Ticket, Proveedor/Cliente (con `<datalist>`), Material (con
  `<datalist>`), Kg, Fecha Entrada, Fecha Salida.
- Autocompletado:
  - Modo Compra: datalist de proveedores = únicos de
    `registrosDestaraje[].proveedor` ∪ `PROVEEDORES_COMUNES`.
  - Modo Venta: datalist de clientes = únicos de
    `registrosVentas[].proveedor` (sin semilla común — no hay
    `CLIENTES_COMUNES` en el proyecto).
  - Material: únicos de `registrosDestaraje[].material` ∪
    `registrosVentas[].material` ∪ `MATERIALES_COMUNES`, en ambos modos.
  - El datalist se reconstruye después de cada alta/edición (incluye el
    valor recién capturado para la siguiente vez).
- Validación mínima: todos los campos requeridos, `kg` debe ser número > 0,
  `fechaEntrada`/`fechaSalida` no vacíos. Sin validar relación entre fechas
  (la spec no lo pide).
- Guardar: construye el objeto `{ ticket, proveedor, material, kg: Number(kg),
  fechaEntrada, fechaSalida }`, llama `guardarDato('destaraje', datos)`, y
  con el id devuelto inserta `{ id, ...datos, fechaRegistro }` en
  `registrosDestaraje` o `registrosVentas` según el ticket. Muestra
  `showSuccess('Registro guardado')` (de `utils.js`) y limpia el formulario.
- Editar: precarga el formulario (incluido el selector Compra/Venta según el
  ticket) dentro de `.modal`/`.modal-overlay` (clases ya creadas en la Fase 1).
  Guardar llama `actualizarDato('destaraje', id, datos)`, reemplaza el
  registro en el array en memoria, cierra el modal.
- Eliminar: confirmación simple (`confirm()` nativo del navegador es
  suficiente para esta fase — no se pide un modal de confirmación dedicado)
  y llama `eliminarDato('destaraje', id)`, luego quita el registro del array
  en memoria.

## Tabs y tablas

- 3 tabs internas (independientes de los tabs de módulo del header):
  HOY / ESTA SEMANA / TODOS.
- Cada tab muestra **dos tablas separadas**, una para Destaraje
  (`registrosDestaraje` filtrado) y otra para Ventas (`registrosVentas`
  filtrado), cada una con columnas Ticket | Proveedor (o Cliente) | Material |
  Kg | F. Entrada | F. Salida | acciones (Editar/Eliminar).
- Stats por tab (sobre el conjunto ya filtrado por fecha, combinando ambas
  tablas): Total registros, **Total KG** (suma de `kg` donde el material NO
  está en `MATERIALES_PZ`), **Total PZ** (suma de `kg` donde el material SÍ
  está en `MATERIALES_PZ`). Si no hay registros en PZ en la vista, no se
  muestra ese número.
- Tab TODOS agrega una barra de filtros en tiempo real (sin botón "aplicar",
  se recalcula en cada `input`): Ticket (substring, case-insensitive),
  Fecha Desde, Fecha Hasta (ambas sobre `fechaSalida`), Proveedor (substring),
  Material (substring). Los filtros aplican igual a ambas tablas.

## Fuera de alcance (3b/3c y fases posteriores)

- Botones de exportación TXT/PDF/CSV → 3b.
- Botón de reconocimiento de voz → 3c.
- Reporte cruzado con otros módulos, Vista Previa, Telegram → fase Reportes (7).

## Archivos

- Crear `js/destaraje.js`: se registra en `window.EVE_MODULES.destaraje =
  { render(container) { ... } }` (punto de extensión creado en la Fase 2).
  Genera todo su HTML dinámicamente — no se toca `index.html`.
- Modificar `css/styles.css`: estilos nuevos para tabla de registros, tarjetas
  de stats, badge de tipo de ticket (Compra/Venta) y grid del formulario.
  Reutiliza `.card`, `.tabs`/`.tab`, `.modal`/`.modal-overlay`, `.toast*`,
  `.btn-primary`/`.btn-secondary` ya existentes — no se duplican.

## Criterio de aceptación

- Al entrar al tab "Destaraje" del módulo (con un usuario con permiso), se
  ven las 3 tabs internas, cada una con sus dos tablas y sus stats.
- Capturar una compra y una venta nuevas las refleja de inmediato en las
  tablas y stats correspondientes, sin recargar la página.
- Los filtros de la tab TODOS reducen ambas tablas en tiempo real.
- Editar y eliminar un registro existente actualiza la tabla y las stats al
  instante.
- Verificado con Playwright contra Firebase real (mismo patrón que fases
  anteriores): captura, edición y borrado de un registro de prueba, limpiando
  el registro de prueba al final para no dejar basura en los datos reales.
