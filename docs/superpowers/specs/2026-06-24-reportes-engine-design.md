# Fase 3b — Motor de reportes (TXT/PDF/CSV, formato completo)

Fuente: `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Módulo 5: Reportes — sección
"Formato TXT/PDF — ESTRUCTURA EXACTA"). Continúa la Fase 3a (Destaraje CRUD),
ya fusionada a `master`.

Descomposición de la Fase 3 (sin cambios):
1. 3a — CRUD + UI + tabs + filtros ✅ (fusionado)
2. **3b — Motor de reporte PDF/TXT/CSV con formato completo ← este documento**
3. 3c — Reconocimiento de voz

## Objetivo de 3b

Un motor de generación de reportes (`js/reportes.js`) reutilizable después por
el módulo Reportes completo (fase 7), con 3 botones de exportación
(TXT/PDF/CSV) agregados a cada una de las 3 tabs internas de Destaraje
(Hoy/Esta Semana/Todos). El reporte usa los 4 conjuntos de datos ya cargados
en `window.EVE` desde la Fase 2 (destaraje, ventas, producción, pagos) —
producción y pagos no tienen módulo de captura propio todavía, pero sus
datos ya existen en Firestore y ya se cargan al iniciar sesión.

Esta fase es de **solo lectura**: no escribe nada nuevo en Firestore.

## Período del reporte

El período = la tab activa de Destaraje en el momento de exportar:

- **Hoy:** `desde = hasta = obtenerFechaMexico()`.
- **Esta Semana:** `desde = obtenerInicioSemana()`, `hasta = obtenerFechaMexico()`.
- **Todos:** `desde`/`hasta` = los valores del filtro de fechas de esa tab (vacíos si no se usó el filtro).

Todas las colecciones excepto `pagos` se filtran por `fechaSalida`; `pagos`
se filtra por su propio campo `fecha` (no tiene fechaEntrada/fechaSalida).

Etiqueta de período en español:
- Un solo día: `"24 DE JUNIO DE 2026"`.
- Rango mismo mes: `"20 AL 25 DE ABRIL DE 2026"`.
- Rango entre meses: `"28 DE ABRIL AL 02 DE MAYO DE 2026"`.
- Sin rango (Todos sin filtro): `"TODOS LOS REGISTROS"`.

## Estructura exacta del reporte (TXT y PDF)

```
DESTARAJE GENERAL
REPORTE: HOY | SEMANA | TODOS
PERIODO: <etiqueta de período>
FECHA: <hoy, DD-MM-AAAA>

TOTAL KG: <suma de destaraje, solo materiales que NO están en MATERIALES_PZ>
TOTAL PRODUCCION KG: <suma de producción>

DESGLOSE POR MATERIAL:
  <material>  <kg o pz, con unidad>     ← uno por material de destaraje, desc por cantidad

DESGLOSE PRODUCCION:
  <material>  <kg>                      ← uno por material de producción, desc por cantidad

DESGLOSE VENTAS:
  <material>  <kg o pz, con unidad>     ← uno por material de ventas, desc por cantidad

DESGLOSE POR PROVEEDOR + MATERIAL:
  <proveedor>: <total kg>
    <material>  <kg>                    ← sangría doble, uno por material de ese proveedor
  ...                                    ← proveedores desc por total, solo datos de destaraje (compras)

RESUMEN PAGOS:                           ← se omite si no hay pagos en el rango
  TOTAL PAGADO: <suma de pagado>
  TOTAL DEUDA: <suma de (total - pagado)>

DETALLE DE TICKETS:                      ← tabla, destaraje + producción + ventas mezclados
  TICKET  PROVEEDOR  MATERIAL  KG  F.ENTRADA  F.SALIDA
  ...                                    ← KG siempre como número simple, SIN sufijo de unidad
                                            (ni "KG" ni "PZ"), para todas las filas

DETALLE DE PAGOS:                        ← tabla, se omite si no hay pagos en el rango
  TICKET  PROVEEDOR  MATERIAL  KG  PRECIO/KG  TOTAL  PAGADO  DEUDA  FECHA
```

Notas de mapeo de columnas en DETALLE DE TICKETS:
- Destaraje/Ventas → columna PROVEEDOR = campo `proveedor`.
- Producción → columna PROVEEDOR = campo `cliente` (los registros de
  producción no tienen campo `proveedor`).

### Estilo PDF (jsPDF + autoTable)

- Título "DESTARAJE GENERAL": 18pt bold, centrado.
- Encabezados de sección (DESGLOSE..., DETALLE...): 14pt bold, con línea
  separadora debajo.
- TOTAL KG / TOTAL PRODUCCION KG: 16pt bold, centrados.
- Líneas de desglose: 12pt; sangría de 4 espacios para materiales, doble
  sangría (8 espacios) para materiales dentro de un proveedor.
- DETALLE DE TICKETS / DETALLE DE PAGOS: `doc.autoTable()` con
  `headStyles: { fillColor: [0, 29, 61] }` (azul marino `#001D3D`).
- Separador horizontal (`doc.line`) entre secciones.

### TXT

Mismo contenido y orden que el PDF, en texto plano: título en mayúsculas,
miles separados con coma, sangría con espacios literales, sin tablas con
bordes (encabezados de columna alineados con espacios).

### CSV

Una fila por registro de los 4 módulos dentro del rango — **no** replica los
desgloses/totales. Columnas: `modulo, ticket, proveedorOCliente, material,
kg, fechaEntrada, fechaSalida` (pagos agrega `precioPorKg, total, pagado,
deuda, fecha` en lugar de fechaEntrada/fechaSalida). Generado con el
`window.exportarCSV` ya existente de `utils.js` — sin nueva función CSV.

## Archivos

- Crear `js/reportes.js`: funciones puras de agregación + generadores
  TXT/CSV/PDF + 3 funciones de orquestación (`window.exportarReporteTXT`,
  `window.exportarReportePDF`, `window.exportarReporteCSV`, cada una con
  firma `(tabId, filtros)`).
- Modificar `js/destaraje.js`: agregar 3 botones (TXT/PDF/CSV) en cada una
  de las 3 tabs internas, cerca de las stats, que llaman a las funciones de
  orquestación de `reportes.js` con el `tabActiva`/`filtros` actuales del
  módulo.
- Modificar `index.html`: agregar `<script src="js/reportes.js">` (antes de
  `destaraje.js`, ya que este último lo consume).

## Fuera de alcance

- UI dedicada del módulo Reportes (selector de módulo, dropdowns
  proveedor/material/cliente, Vista Previa, botón Telegram) → fase 7.
- Envío por Telegram → fase 7 (requiere leer el token desde Firestore
  `config/telegram`, no construido todavía).
- Voz → fase 3c.

## Criterio de aceptación

- Verificado con Node: agregaciones (`agregarPorMaterial`,
  `agregarPorProveedor`, `calcularResumenPagos`), formateo de período
  (mismo mes, entre meses, un día, sin rango), y el TXT generado coincide
  carácter por carácter con un caso de ejemplo construido a partir de datos
  ficticios con la forma exacta de los 4 módulos.
- Verificado con Playwright en vivo (datos reales de Firebase, solo
  lectura): exportar TXT/PDF/CSV desde cada una de las 3 tabs no genera
  errores de consola, el PDF descargado es un archivo válido (firma `%PDF`,
  tamaño razonable), el TXT/CSV descargado tiene contenido no vacío. No se
  escribe ni se borra nada en Firestore.
