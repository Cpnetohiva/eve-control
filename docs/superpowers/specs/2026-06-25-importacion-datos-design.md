# Fase 8b — Panel Admin: Importación de Datos

Fuente: `EVERPLASTIC COO.md` (sección "PANEL ADMIN (`admin.js`)", subsección
"Importación de Datos"). Segunda de 4 sub-fases del Panel Admin (8a
Usuarios → **8b Importación de Datos** → 8c Backup/Exportación +
Configuración del Sistema → 8d Gestión de Datos), decomposición acordada
al iniciar el brainstorming de la Fase 8. Continúa la Fase 8a (Gestión de
Usuarios), ya fusionada a `master`.

## Objetivo

Una sub-pestaña "Importar Datos" dentro del Panel Admin (junto a
"Usuarios"): descarga de plantilla Excel con 3 hojas (Destaraje /
Producción / Pagos), selección de archivo, vista previa fila por fila con
validación, y dos modos de importación — Agregar o Reemplazar todo — con
confirmación adicional en el modo destructivo.

## Arquitectura

- **`js/admin-importar.js`** (nuevo): generación de la plantilla,
  parseo del `.xlsx` (vía `XLSX.read`, ya cargado globalmente en
  `index.html` desde la Fase 1, sin dependencia nueva), validación fila
  por fila, vista previa, y la lógica de escritura en Firestore para
  ambos modos. Namespace `window.EVE_ADMIN_IMPORTAR` (mismo patrón de
  namespace adoptado en la Fase 5).
- **`js/admin.js`** (modifica el archivo de la Fase 8a): se agrega
  "Importar Datos" a `SUBPESTANAS`, delegando el render a
  `window.EVE_ADMIN_IMPORTAR.crearVistaImportar()` — mismo patrón
  unidireccional ya usado para `EVE_ADMIN_USUARIOS`.
- **Validación por fila reutiliza los validadores ya existentes de cada
  módulo operativo**, en vez de duplicar sus reglas de negocio:
  - Hoja Destaraje → `window.construirRegistroDesdeFormulario` (de
    `js/destaraje.js`, global sin prefijo — convención anterior a la
    Fase 5).
  - Hoja Producción → `window.construirRegistroDesdeFormularioProduccion`
    (de `js/produccion.js`, sufijo `Produccion` para evitar colisión con
    el nombre bare de Destaraje).
  - Hoja Pagos → `window.EVE_PAGOS.construirRegistroDesdeFormulario` (de
    `js/pagos.js`, namespace).
  Estas tres funciones ya validan exactamente las mismas reglas
  (campos obligatorios, Kg > 0, etc.) que sus formularios nativos —
  `admin-importar.js` solo adapta los datos de cada fila al `datos` que
  cada una espera, y traduce cualquier `Error` lanzado en un motivo de
  fila inválida en la vista previa.
- Sin cambios a `js/destaraje.js`, `js/produccion.js`, `js/pagos.js`,
  `js/admin-usuarios.js`, `js/auth.js` — esta fase solo los **consume**
  (sus validadores ya públicos), nunca los modifica.

## Plantilla Excel

- Botón "Descargar plantilla" genera un `.xlsx` (vía `XLSX.utils.book_new`
  + `XLSX.utils.aoa_to_sheet` + `XLSX.writeFile`) con 3 hojas, nombres de
  hoja exactos `Destaraje`, `Produccion`, `Pagos` (sin acento en el
  nombre de hoja, para evitar problemas de codificación con algunas
  versiones de Excel — los encabezados de columna sí llevan acento donde
  corresponde):
  - **Destaraje**: `Ticket | Proveedor | Material | Kg | Fecha Entrada | Fecha Salida`
  - **Produccion**: `Ticket | Cliente | Material | Kg | Fecha Entrada | Fecha Salida`
  - **Pagos**: `Ticket | Proveedor | Material | Kg | Precio/Kg | Total | Pagado | Fecha`
- Cada hoja incluye una fila de ejemplo (valores ficticios coherentes)
  inmediatamente debajo del encabezado, mostrando el formato exacto
  esperado en las columnas de fecha: `24-06-2026` (DD-MM-AAAA, con
  guiones) — la misma convención que el sistema ya usa para mostrar
  fechas en pantalla (`formatearFecha` en `js/utils.js`), solo que ahí
  con diagonales; en el Excel se exige específicamente con guiones,
  según la convención ya establecida para este proyecto.

## Parseo y conversión de fechas

- Al seleccionar un archivo, se lee con `XLSX.read(arrayBuffer, { type: 'array' })`
  y se accede a las 3 hojas por su nombre exacto (`Destaraje`,
  `Produccion`, `Pagos`).
- Si el archivo no es un `.xlsx` válido, o falta cualquiera de las 3
  hojas esperadas, se muestra un error claro (`showError`) y el flujo se
  detiene ahí — no se intenta adivinar nombres de hoja parecidos ni
  continuar con hojas parciales.
- Cada hoja se convierte a un arreglo de objetos vía
  `XLSX.utils.sheet_to_json(hoja, { defval: '' })`, usando la primera
  fila como encabezados.
- Filas completamente vacías (todas las celdas vacías) se ignoran
  silenciosamente — no cuentan como inválidas, son el resultado normal
  de exportar/editar un Excel con filas de más al final.
- Una columna de fecha solo es válida si es **texto literal en formato
  `DD-MM-AAAA`** (con guiones, regex `^\d{2}-\d{2}-\d{4}$`, día/mes/año
  dentro de rangos válidos). Cualquier otro caso — texto en otro formato,
  o una celda que Excel haya autoconvertido a su tipo de fecha interno
  (que `sheet_to_json` puede entregar como número de serie o como objeto
  `Date` según el formato de la celda en el archivo original) — se
  marca como fila inválida con el motivo `"Fecha debe tener el formato
  DD-MM-AAAA"`. Al pasar la validación, se convierte a `AAAA-MM-DD`
  (formato interno que ya usa Firestore en `fechaEntrada`/`fechaSalida`/
  `fecha`) antes de construir el registro — nunca se guarda en
  DD-MM-AAAA.

## Validación y vista previa

- Cada fila de cada hoja se adapta al `datos` que su validador espera y
  se le pasa:
  - Destaraje: `{ ticket, proveedor, material, kg, fechaEntrada, fechaSalida }`
    (`ticketOrigen` no aplica a esta vía de importación, queda fuera).
  - Producción: `{ cliente, material, kg, fechaEntrada, fechaSalida }`
    — la columna "Ticket" de la fila se ignora siempre; el `ticket` real
    del registro construido es la constante `'P'`, igual que ya hace
    `construirRegistroDesdeFormularioProduccion` (que ni siquiera acepta
    un parámetro de ticket).
  - Pagos: `{ ticket, proveedor, material, kg, precioPorKg, pagado, fecha }`
    — la columna "Total" de la fila se ignora siempre; `total` ya se
    recalcula dentro del propio validador como `kg * precioPorKg`
    (mismo criterio "nunca confiar en un campo de despliegue" ya
    establecido en la Fase 5).
- Si el validador lanza un `Error`, su `.message` es el motivo mostrado
  para esa fila; si no lanza, la fila es válida y el registro construido
  queda listo para guardarse.
- La vista previa muestra, por hoja: un resumen (`"Destaraje: 45
  válidas, 2 con error"`) y una tabla con todas las filas no-vacías,
  cada una con una columna de Estado (`✓` o el motivo exacto del
  error). Una fila inválida no detiene el procesamiento de las demás.
- El botón "Confirmar importación" solo importa las filas válidas de
  cada hoja; las inválidas se omiten silenciosamente en ambos modos (no
  hay forma de "forzar" una fila inválida).

## Modos Agregar / Reemplazar todo

- **Agregar**: cada fila válida de cada hoja se guarda con
  `window.guardarDato(coleccion, registro)` en su colección
  correspondiente (`destaraje`, `produccion`, `pagos`) — sin tocar
  ningún registro existente.
- **Reemplazar todo**: por cada hoja que tiene **al menos una fila
  válida**, se borran primero todos los registros existentes de esa
  colección (vía `window.EVE.registrosDestaraje` + `registrosVentas`
  para Destaraje, `registrosProduccion`, `registrosPagos` — los arrays
  ya cargados en memoria) y luego se insertan los nuevos. Una hoja sin
  ninguna fila válida (vacía, o todas sus filas con error) **deja su
  módulo existente intacto** — nunca se reemplaza con un conjunto vacío
  por accidente.
- El modo se selecciona con un toggle (Agregar / Reemplazar todo) antes
  de generar la vista previa. En modo Reemplazar, el botón "Confirmar
  importación" permanece deshabilitado hasta que el usuario escribe
  exactamente `CONFIRMAR` en un campo de texto dedicado — mismo patrón
  de seguridad que tendrá la Gestión de Datos (Fase 8d) para acciones
  destructivas. En modo Agregar no se pide nada adicional.
- Las escrituras (borrado + inserción) se agrupan en lotes
  (`window.db.batch()`), con un máximo de 500 operaciones por lote (el
  límite que impone Firestore) — si una hoja completa, sumando los
  borrados y las inserciones, excede 500 operaciones, se divide en
  lotes sucesivos de hasta 500 cada uno, ejecutados en orden. Esto evita
  hacer una escritura de red por fila (lento e innecesario para este
  volumen de datos) y minimiza la ventana de un estado "a medias" si
  algo falla a mitad de una hoja grande.
- Tras una importación exitosa, se recargan en memoria (vía
  `window.cargarDatos`) los arrays de `window.EVE` correspondientes a
  las hojas que tuvieron al menos una fila válida — mismo patrón ya
  usado por los módulos operativos tras cualquier cambio.

## Archivos

- Crear `js/admin-importar.js`: namespace `window.EVE_ADMIN_IMPORTAR` —
  generación de plantilla, parseo, validación por fila, vista previa,
  lógica de Agregar/Reemplazar con lotes Firestore.
- Modificar `js/admin.js`: agregar la sub-pestaña "Importar Datos" a
  `SUBPESTANAS`, delegando a `EVE_ADMIN_IMPORTAR.crearVistaImportar()`.
- Modificar `index.html`: agregar `<script src="js/admin-importar.js">`
  antes de `admin.js` (mismo orden de dependencia que
  `admin-usuarios.js`).
- Modificar `css/styles.css`: estilos para el selector de archivo, el
  toggle Agregar/Reemplazar, el campo de confirmación "CONFIRMAR", y la
  tabla de vista previa con columna de Estado.
- Sin cambios a `js/destaraje.js`, `js/produccion.js`, `js/pagos.js`,
  `js/admin-usuarios.js`, `js/auth.js`.

## Fuera de alcance

- Hojas de Ministraciones o Control de Producción en la plantilla — el
  spec original solo define 3 hojas (Destaraje/Producción/Pagos); esos
  dos módulos no tienen vía de importación masiva en ninguna fase.
- Backup/Exportación, Configuración del Sistema (Telegram, horario de
  reporte automático), Gestión de Datos (borrado masivo) — sub-fases
  futuras del Panel Admin (8c/8d).
- Importación incremental/streaming para archivos muy grandes — el
  volumen de datos esperado para este negocio es pequeño; un solo lote
  (o unos pocos lotes de 500) cubre el caso real con margen amplio.

## Criterio de aceptación

- Node: helpers de parseo de fecha (DD-MM-AAAA válido/inválido,
  conversión a AAAA-MM-DD), la adaptación fila→`datos` para cada una de
  las 3 hojas (incluyendo los casos donde Producción ignora su columna
  Ticket y Pagos ignora su columna Total), y el cálculo de qué hojas
  califican para reemplazo (al menos una fila válida) — todo con
  fixtures en memoria, sin Firestore real.
- Playwright en vivo: descargar la plantilla y confirmar que el archivo
  resultante tiene las 3 hojas con los encabezados correctos, importar
  un archivo de prueba en modo Agregar (algunas filas válidas, alguna
  inválida a propósito) y confirmar que la vista previa marca
  correctamente cada una y que solo las válidas terminan en Firestore,
  probar que el modo Reemplazar exige escribir "CONFIRMAR" antes de
  habilitar el botón, y verificar que una hoja vacía en modo Reemplazar
  no borra el módulo correspondiente. Limpieza completa de los datos de
  prueba al final, sin dejar residuos. Sin errores de consola.
