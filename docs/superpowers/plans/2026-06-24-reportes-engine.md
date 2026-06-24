# Fase 3b — Motor de Reportes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable report engine (`js/reportes.js`) generating the exact TXT/PDF/CSV format from the source spec, wired into 3 export buttons on Destaraje's existing Hoy/Esta Semana/Todos tabs — read-only, no new Firestore writes.

**Architecture:** `js/reportes.js` is split into pure data-aggregation/formatting helpers (Node-testable), a TXT generator (Node-testable, exact string match), a PDF generator (jsPDF + autoTable, browser-only), and 3 orchestration functions that wire them to `js/utils.js`'s `descargarArchivo`/`exportarCSV`. `js/destaraje.js` (already merged) gets one new button row reusing its existing `tabActiva`/`filtros` state. Like every other file in this project, internal helpers stay module-scoped (wrapped in an IIFE, matching the convention `js/destaraje.js` already established) and only the public API is attached to `window`.

**Tech Stack:** Vanilla JS, jsPDF + jsPDF-autoTable (already loaded via CDN in `index.html` since Phase 1), Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-reportes-engine-design.md`.
- Date field for filtering: `fechaSalida` for destaraje/ventas/produccion; `fecha` for pagos.
- `TOTAL KG` = sum of `destaraje` kg where material is NOT in `window.MATERIALES_PZ`. `TOTAL PRODUCCION KG` = sum of all `produccion` kg (no PZ split).
- `DESGLOSE POR PROVEEDOR + MATERIAL` only covers `destaraje` (compras) — never `ventas`.
- `DETALLE DE TICKETS`: the `KG` column is always the bare number, no unit suffix, for every row (destaraje, producción, ventas alike). Producción rows use the `cliente` field for the "PROVEEDOR" column (producción records have no `proveedor` field).
- `RESUMEN PAGOS` and `DETALLE DE PAGOS` are omitted entirely when there are no pagos in range.
- CSV is one row per record across all 4 modules with a uniform column set (not a replica of the TXT/PDF breakdowns) — built via the existing `window.exportarCSV` from `js/utils.js`, no new CSV-writing code.
- This phase is read-only: it must not call `guardarDato`/`actualizarDato`/`eliminarDato`.
- Module file wrapped in an IIFE — same pattern Phase 3a's `js/destaraje.js` already uses, to avoid global-scope name collisions with future modules.

---

## File Structure

```
eve-control-v2/
├── index.html        (Task 5 — add <script src="js/reportes.js"> before destaraje.js)
├── css/
│   └── styles.css     (Task 5 — .destaraje-exportar button row)
└── js/
    ├── reportes.js    (Tasks 1-4, new)
    └── destaraje.js   (Task 5 — add the export button row; already exists, modified in place)
```

`js/reportes.js` is built incrementally across 4 tasks, all inside one IIFE:
- Task 1: pure aggregation/period helpers — appended first, Node-tested.
- Task 2: TXT generator — appended second, Node-tested with an exact-string fixture.
- Task 3: PDF generator (jsPDF/autoTable) — appended third, minimal Node smoke test (real visual verification is live-only, Task 5).
- Task 4: CSV row builder + the 3 `window.exportarReporteX` orchestration functions, plus the closing `})();` — completes the file.

---

### Task 1: `js/reportes.js` — pure aggregation and period helpers

**Files:**
- Create: `js/reportes.js` (this task writes the file; Tasks 2-4 append to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.MATERIALES_PZ` (`js/config.js`).
- Produces (attached to `window`, consumed by Tasks 2-4):
  - `agregarPorMaterial(registros)` → `[{ material, kg, unidad }]` sorted desc by `kg`, `unidad` is `'KG'`/`'PZ'` per `MATERIALES_PZ` membership
  - `agregarPorProveedor(registros)` → `[{ proveedor, totalKg, materiales: [{ material, kg }] }]` sorted desc by `totalKg`, `materiales` sorted desc by `kg`
  - `sumarPorUnidad(registros)` → `{ kg, pz }`
  - `formatearFechaLarga(fechaISO)` → e.g. `"24 DE JUNIO DE 2026"`
  - `formatearPeriodo(desde, hasta)` → handles same-day, same-month, cross-month/cross-year, and `null`/empty (→ `"TODOS LOS REGISTROS"`)
  - `obtenerRangoYEtiqueta(tabId, filtros)` → `{ desde, hasta, etiquetaReporte, etiquetaPeriodo }`
  - `obtenerDatosPeriodo(desde, hasta)` → `{ destaraje, ventas, produccion, pagos }`, each filtered from `window.EVE.*`
  - `construirDetalleTickets(datos)` → flat `[{ ticket, proveedor, material, kg, fechaEntrada, fechaSalida }]`, destaraje rows then producción then ventas
  - `calcularResumenPagos(pagos)` → `{ totalPagado, totalDeuda }` or `null` if `pagos.length === 0`

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
global.EVE = {
  registrosDestaraje: [
    { ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' },
    { ticket: '2', proveedor: 'PROV A', material: 'PET', kg: 50, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' },
    { ticket: '3', proveedor: 'PROV B', material: 'MIXTO', kg: 30, fechaEntrada: '2026-06-02', fechaSalida: '2026-06-02' }
  ],
  registrosVentas: [
    { ticket: 'V', proveedor: 'CLIENTE X', material: 'TAMBO', kg: 10, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }
  ],
  registrosProduccion: [
    { ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO', kg: 80, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }
  ],
  registrosPagos: [
    { ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, precioPorKg: 10, total: 1000, pagado: 800, fecha: '2026-06-01' }
  ]
};
require('./js/reportes.js');
const assert = require('assert');

const porMaterial = window.agregarPorMaterial(window.EVE.registrosDestaraje);
assert.deepStrictEqual(porMaterial, [
  { material: 'MIXTO', kg: 130, unidad: 'KG' },
  { material: 'PET', kg: 50, unidad: 'KG' }
]);

const porMaterialVentas = window.agregarPorMaterial(window.EVE.registrosVentas);
assert.deepStrictEqual(porMaterialVentas, [{ material: 'TAMBO', kg: 10, unidad: 'PZ' }]);

const porProveedor = window.agregarPorProveedor(window.EVE.registrosDestaraje);
assert.deepStrictEqual(porProveedor, [
  { proveedor: 'PROV A', totalKg: 150, materiales: [{ material: 'MIXTO', kg: 100 }, { material: 'PET', kg: 50 }] },
  { proveedor: 'PROV B', totalKg: 30, materiales: [{ material: 'MIXTO', kg: 30 }] }
]);

assert.deepStrictEqual(window.sumarPorUnidad(window.EVE.registrosDestaraje), { kg: 180, pz: 0 });

assert.strictEqual(window.formatearFechaLarga('2026-06-24'), '24 DE JUNIO DE 2026');
assert.strictEqual(window.formatearPeriodo('2026-06-24', '2026-06-24'), '24 DE JUNIO DE 2026');
assert.strictEqual(window.formatearPeriodo('2026-04-20', '2026-04-25'), '20 AL 25 DE ABRIL DE 2026');
assert.strictEqual(window.formatearPeriodo('2026-04-28', '2026-05-02'), '28 DE ABRIL AL 2 DE MAYO DE 2026');
assert.strictEqual(window.formatearPeriodo(null, null), 'TODOS LOS REGISTROS');
assert.strictEqual(window.formatearPeriodo('', ''), 'TODOS LOS REGISTROS');

global.obtenerFechaMexico = () => '2026-06-24';
global.obtenerInicioSemana = () => '2026-06-22';
assert.deepStrictEqual(window.obtenerRangoYEtiqueta('hoy', {}), {
  desde: '2026-06-24', hasta: '2026-06-24', etiquetaReporte: 'HOY', etiquetaPeriodo: '24 DE JUNIO DE 2026'
});
assert.deepStrictEqual(window.obtenerRangoYEtiqueta('semana', {}), {
  desde: '2026-06-22', hasta: '2026-06-24', etiquetaReporte: 'SEMANA', etiquetaPeriodo: '22 AL 24 DE JUNIO DE 2026'
});
assert.deepStrictEqual(window.obtenerRangoYEtiqueta('todos', { desde: '', hasta: '' }), {
  desde: '', hasta: '', etiquetaReporte: 'TODOS', etiquetaPeriodo: 'TODOS LOS REGISTROS'
});

const datosPeriodo = window.obtenerDatosPeriodo('2026-06-01', '2026-06-01');
assert.strictEqual(datosPeriodo.destaraje.length, 2);
assert.strictEqual(datosPeriodo.ventas.length, 1);
assert.strictEqual(datosPeriodo.produccion.length, 1);
assert.strictEqual(datosPeriodo.pagos.length, 1);

const detalle = window.construirDetalleTickets(datosPeriodo);
assert.deepStrictEqual(detalle.map((d) => d.ticket), ['1', '2', 'P', 'V']);
assert.strictEqual(detalle[2].proveedor, 'PRODUCCION');

assert.deepStrictEqual(window.calcularResumenPagos(window.EVE.registrosPagos), { totalPagado: 800, totalDeuda: 200 });
assert.strictEqual(window.calcularResumenPagos([]), null);

console.log('REPORTES_HELPERS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/reportes.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/reportes.js`:

```javascript
(function () {

function esMaterialPZReporte(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function sumarPorUnidad(registros) {
  let kg = 0;
  let pz = 0;
  for (const registro of registros) {
    if (esMaterialPZReporte(registro.material)) {
      pz += Number(registro.kg) || 0;
    } else {
      kg += Number(registro.kg) || 0;
    }
  }
  return { kg, pz };
}

function agregarPorMaterial(registros) {
  const mapa = new Map();
  for (const registro of registros) {
    const actual = mapa.get(registro.material) || 0;
    mapa.set(registro.material, actual + (Number(registro.kg) || 0));
  }
  return Array.from(mapa.entries())
    .map(([material, kg]) => ({ material, kg, unidad: esMaterialPZReporte(material) ? 'PZ' : 'KG' }))
    .sort((a, b) => b.kg - a.kg);
}

function agregarPorProveedor(registros) {
  const mapaProveedores = new Map();
  for (const registro of registros) {
    if (!mapaProveedores.has(registro.proveedor)) {
      mapaProveedores.set(registro.proveedor, new Map());
    }
    const mapaMateriales = mapaProveedores.get(registro.proveedor);
    const actual = mapaMateriales.get(registro.material) || 0;
    mapaMateriales.set(registro.material, actual + (Number(registro.kg) || 0));
  }
  const resultado = [];
  for (const [proveedor, mapaMateriales] of mapaProveedores.entries()) {
    const materiales = Array.from(mapaMateriales.entries())
      .map(([material, kg]) => ({ material, kg }))
      .sort((a, b) => b.kg - a.kg);
    const totalKg = materiales.reduce((suma, m) => suma + m.kg, 0);
    resultado.push({ proveedor, totalKg, materiales });
  }
  return resultado.sort((a, b) => b.totalKg - a.totalKg);
}

function dentroDeRangoReporte(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

const MESES_ES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

function formatearFechaLarga(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia} DE ${MESES_ES[mes - 1]} DE ${anio}`;
}

function formatearPeriodo(desde, hasta) {
  if (!desde && !hasta) return 'TODOS LOS REGISTROS';
  if (desde === hasta) return formatearFechaLarga(desde);
  const [anioD, mesD, diaD] = desde.split('-').map(Number);
  const [anioH, mesH, diaH] = hasta.split('-').map(Number);
  if (anioD === anioH && mesD === mesH) {
    return `${diaD} AL ${diaH} DE ${MESES_ES[mesD - 1]} DE ${anioD}`;
  }
  if (anioD === anioH) {
    return `${diaD} DE ${MESES_ES[mesD - 1]} AL ${diaH} DE ${MESES_ES[mesH - 1]} DE ${anioD}`;
  }
  return `${formatearFechaLarga(desde)} AL ${formatearFechaLarga(hasta)}`;
}

function obtenerRangoYEtiqueta(tabId, filtros) {
  if (tabId === 'hoy') {
    const hoy = window.obtenerFechaMexico();
    return { desde: hoy, hasta: hoy, etiquetaReporte: 'HOY', etiquetaPeriodo: formatearPeriodo(hoy, hoy) };
  }
  if (tabId === 'semana') {
    const desde = window.obtenerInicioSemana();
    const hasta = window.obtenerFechaMexico();
    return { desde, hasta, etiquetaReporte: 'SEMANA', etiquetaPeriodo: formatearPeriodo(desde, hasta) };
  }
  const desde = (filtros && filtros.desde) || '';
  const hasta = (filtros && filtros.hasta) || '';
  return {
    desde, hasta, etiquetaReporte: 'TODOS',
    etiquetaPeriodo: formatearPeriodo(desde || null, hasta || null)
  };
}

function obtenerDatosPeriodo(desde, hasta) {
  return {
    destaraje: window.EVE.registrosDestaraje.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    ventas: window.EVE.registrosVentas.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    produccion: window.EVE.registrosProduccion.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    pagos: window.EVE.registrosPagos.filter((r) => dentroDeRangoReporte(r.fecha, desde, hasta))
  };
}

function construirDetalleTickets(datos) {
  const filas = [];
  datos.destaraje.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor, material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada, fechaSalida: r.fechaSalida
  }));
  datos.produccion.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.cliente, material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada, fechaSalida: r.fechaSalida
  }));
  datos.ventas.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor, material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada, fechaSalida: r.fechaSalida
  }));
  return filas;
}

function calcularResumenPagos(pagos) {
  if (pagos.length === 0) return null;
  let totalPagado = 0;
  let totalDeuda = 0;
  for (const p of pagos) {
    totalPagado += Number(p.pagado) || 0;
    totalDeuda += (Number(p.total) || 0) - (Number(p.pagado) || 0);
  }
  return { totalPagado, totalDeuda };
}

window.agregarPorMaterial = agregarPorMaterial;
window.agregarPorProveedor = agregarPorProveedor;
window.sumarPorUnidad = sumarPorUnidad;
window.formatearFechaLarga = formatearFechaLarga;
window.formatearPeriodo = formatearPeriodo;
window.obtenerRangoYEtiqueta = obtenerRangoYEtiqueta;
window.obtenerDatosPeriodo = obtenerDatosPeriodo;
window.construirDetalleTickets = construirDetalleTickets;
window.calcularResumenPagos = calcularResumenPagos;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_HELPERS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add reportes.js aggregation and period helpers"
```

---

### Task 2: `js/reportes.js` — TXT generator

**Files:**
- Modify: `js/reportes.js` — insert before the closing `})();` (do NOT append after it; everything in this file lives inside the one IIFE Task 1 opened)
- Test: inline `node -e` smoke check with an exact-string fixture

**Interfaces:**
- Consumes: `agregarPorMaterial`, `agregarPorProveedor`, `sumarPorUnidad`, `construirDetalleTickets`, `calcularResumenPagos` (Task 1, same file, called as bare identifiers — no `window.` prefix needed inside the IIFE); `window.obtenerFechaMexico`, `window.formatearMoneda` (`js/utils.js`).
- Produces: `generarTXT(datos, periodo)` → `string`, where `datos` is `obtenerDatosPeriodo`'s return shape and `periodo` is `obtenerRangoYEtiqueta`'s return shape (only `etiquetaReporte`/`etiquetaPeriodo` are read). Attached as `window.generarTXT`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root. This reuses the same `EVE`/`MATERIALES_PZ` fixture as Task 1, plus stubs for the two `utils.js` functions this task needs:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
global.EVE = {
  registrosDestaraje: [
    { ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' },
    { ticket: '2', proveedor: 'PROV A', material: 'PET', kg: 50, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' },
    { ticket: '3', proveedor: 'PROV B', material: 'MIXTO', kg: 30, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }
  ],
  registrosVentas: [
    { ticket: 'V', proveedor: 'CLIENTE X', material: 'TAMBO', kg: 10, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }
  ],
  registrosProduccion: [
    { ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO', kg: 80, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }
  ],
  registrosPagos: [
    { ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, precioPorKg: 10, total: 1000, pagado: 800, fecha: '2026-06-01' }
  ]
};
global.obtenerFechaMexico = () => '2026-06-24';
global.formatearMoneda = (v) => Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
require('./js/reportes.js');
const assert = require('assert');

const datos = window.obtenerDatosPeriodo('', '');
const periodo = { etiquetaReporte: 'TODOS', etiquetaPeriodo: 'TODOS LOS REGISTROS' };
const texto = window.generarTXT(datos, periodo);

const esperado = [
  'DESTARAJE GENERAL',
  'REPORTE: TODOS',
  'PERIODO: TODOS LOS REGISTROS',
  'FECHA: 24-06-2026',
  '',
  'TOTAL KG: 180',
  'TOTAL PRODUCCION KG: 80',
  '',
  'DESGLOSE POR MATERIAL:',
  '  MIXTO  130 KG',
  '  PET  50 KG',
  '',
  'DESGLOSE PRODUCCION:',
  '  PELETIZADO  80 KG',
  '',
  'DESGLOSE VENTAS:',
  '  TAMBO  10 PZ',
  '',
  'DESGLOSE POR PROVEEDOR + MATERIAL:',
  '  PROV A: 150 KG',
  '    MIXTO  100 KG',
  '    PET  50 KG',
  '  PROV B: 30 KG',
  '    MIXTO  30 KG',
  '',
  'RESUMEN PAGOS:',
  '  TOTAL PAGADO: \$800.00',
  '  TOTAL DEUDA: \$200.00',
  '',
  'DETALLE DE TICKETS:',
  '  TICKET  PROVEEDOR  MATERIAL  KG  F.ENTRADA  F.SALIDA',
  '  1  PROV A  MIXTO  100  2026-06-01  2026-06-01',
  '  2  PROV A  PET  50  2026-06-01  2026-06-01',
  '  3  PROV B  MIXTO  30  2026-06-01  2026-06-01',
  '  P  PRODUCCION  PELETIZADO  80  2026-06-01  2026-06-01',
  '  V  CLIENTE X  TAMBO  10  2026-06-01  2026-06-01',
  '',
  'DETALLE DE PAGOS:',
  '  TICKET  PROVEEDOR  MATERIAL  KG  PRECIO/KG  TOTAL  PAGADO  DEUDA  FECHA',
  '  1  PROV A  MIXTO  100  \$10.00  \$1,000.00  \$800.00  \$200.00  2026-06-01'
].join('\n');

assert.strictEqual(texto, esperado);
console.log('REPORTES_TXT_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.generarTXT is not a function` (exit code 1) — Task 1 doesn't define it yet.

- [ ] **Step 3: Insert the implementation**

In `js/reportes.js`, find this anchor (the last two lines before the closing IIFE call):

```javascript
window.calcularResumenPagos = calcularResumenPagos;

})();
```

Replace it with (adding the TXT generator and its `window` attachment before the closing call):

```javascript
window.calcularResumenPagos = calcularResumenPagos;

function formatearNumeroReporte(n) {
  return Math.round(n).toLocaleString('es-MX');
}

function lineaDesgloseReporte(item) {
  return `  ${item.material}  ${formatearNumeroReporte(item.kg)} ${item.unidad}`;
}

function generarTXT(datos, periodo) {
  const lineas = [];
  lineas.push('DESTARAJE GENERAL');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');
  lineas.push(`TOTAL KG: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)}`);
  lineas.push(`TOTAL PRODUCCION KG: ${formatearNumeroReporte(datos.produccion.reduce((s, r) => s + (Number(r.kg) || 0), 0))}`);
  lineas.push('');

  lineas.push('DESGLOSE POR MATERIAL:');
  agregarPorMaterial(datos.destaraje).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE PRODUCCION:');
  agregarPorMaterial(datos.produccion).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE VENTAS:');
  agregarPorMaterial(datos.ventas).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE POR PROVEEDOR + MATERIAL:');
  agregarPorProveedor(datos.destaraje).forEach((p) => {
    lineas.push(`  ${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG`);
    p.materiales.forEach((m) => lineas.push(`    ${m.material}  ${formatearNumeroReporte(m.kg)} KG`));
  });

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    lineas.push('');
    lineas.push('RESUMEN PAGOS:');
    lineas.push(`  TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`);
    lineas.push(`  TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`);
  }

  lineas.push('');
  lineas.push('DETALLE DE TICKETS:');
  lineas.push('  TICKET  PROVEEDOR  MATERIAL  KG  F.ENTRADA  F.SALIDA');
  construirDetalleTickets(datos).forEach((r) => {
    lineas.push(`  ${r.ticket}  ${r.proveedor}  ${r.material}  ${formatearNumeroReporte(r.kg)}  ${r.fechaEntrada}  ${r.fechaSalida}`);
  });

  if (datos.pagos.length > 0) {
    lineas.push('');
    lineas.push('DETALLE DE PAGOS:');
    lineas.push('  TICKET  PROVEEDOR  MATERIAL  KG  PRECIO/KG  TOTAL  PAGADO  DEUDA  FECHA');
    datos.pagos.forEach((p) => {
      const deuda = (Number(p.total) || 0) - (Number(p.pagado) || 0);
      lineas.push(`  ${p.ticket}  ${p.proveedor}  ${p.material}  ${formatearNumeroReporte(p.kg)}  ${window.formatearMoneda(p.precioPorKg)}  ${window.formatearMoneda(p.total)}  ${window.formatearMoneda(p.pagado)}  ${window.formatearMoneda(deuda)}  ${p.fecha}`);
    });
  }

  return lineas.join('\n');
}

window.generarTXT = generarTXT;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_TXT_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add reportes.js TXT generator"
```

---

### Task 3: `js/reportes.js` — PDF generator

**Files:**
- Modify: `js/reportes.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check against a minimal jsPDF stub (this only proves the function runs without throwing and calls `autoTable`/`save`-shaped methods; real visual verification is the live Playwright check in Task 5)

**Interfaces:**
- Consumes: `sumarPorUnidad`, `agregarPorMaterial`, `agregarPorProveedor`, `calcularResumenPagos`, `construirDetalleTickets`, `formatearNumeroReporte` (Task 1/2, same file); `window.jspdf.jsPDF` (jsPDF UMD global, loaded via CDN in `index.html` since Phase 1 — `const { jsPDF } = window.jspdf`); `window.obtenerFechaMexico`, `window.formatearMoneda` (`js/utils.js`).
- Produces: `generarPDF(datos, periodo)` → a jsPDF document instance (has `.save(filename)`). Attached as `window.generarPDF`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO'];
global.EVE = {
  registrosDestaraje: [{ ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }],
  registrosVentas: [{ ticket: 'V', proveedor: 'CLIENTE X', material: 'TAMBO', kg: 10, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }],
  registrosProduccion: [{ ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO', kg: 80, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }],
  registrosPagos: [{ ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, precioPorKg: 10, total: 1000, pagado: 800, fecha: '2026-06-01' }]
};
global.obtenerFechaMexico = () => '2026-06-24';
global.formatearMoneda = (v) => '\$' + Number(v).toFixed(2);
class FakeDoc {
  constructor() { this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }; this.lastAutoTable = { finalY: 50 }; }
  setFontSize() {}
  setFont() {}
  setDrawColor() {}
  text() {}
  line() {}
  addPage() {}
  autoTable() { this.lastAutoTable = { finalY: this.lastAutoTable.finalY + 50 }; }
  save(nombre) { this.savedAs = nombre; }
}
global.jspdf = { jsPDF: FakeDoc };
require('./js/reportes.js');
const assert = require('assert');

const datos = window.obtenerDatosPeriodo('', '');
const periodo = { etiquetaReporte: 'TODOS', etiquetaPeriodo: 'TODOS LOS REGISTROS' };
const doc = window.generarPDF(datos, periodo);
assert.strictEqual(typeof doc.save, 'function');
doc.save('prueba.pdf');
assert.strictEqual(doc.savedAs, 'prueba.pdf');
console.log('REPORTES_PDF_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.generarPDF is not a function` (exit code 1).

- [ ] **Step 3: Insert the implementation**

In `js/reportes.js`, find this anchor:

```javascript
window.generarTXT = generarTXT;

})();
```

Replace it with:

```javascript
window.generarTXT = generarTXT;

function generarPDF(datos, periodo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;

  function saltoSiNecesario(alto) {
    if (y + alto > 280) {
      doc.addPage();
      y = 20;
    }
  }

  function lineaSeparadora() {
    doc.setDrawColor(200);
    doc.line(14, y, anchoPagina - 14, y);
    y += 6;
  }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('DESTARAJE GENERAL', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL KG: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)}`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`TOTAL PRODUCCION KG: ${formatearNumeroReporte(datos.produccion.reduce((s, r) => s + (Number(r.kg) || 0), 0))}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  function seccionDesglose(titulo, items) {
    saltoSiNecesario(14 + items.length * 6);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(titulo, 14, y);
    y += 5;
    lineaSeparadora();
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    items.forEach((item) => {
      doc.text(`    ${item.material}`, 14, y);
      doc.text(`${formatearNumeroReporte(item.kg)} ${item.unidad}`, anchoPagina - 14, y, { align: 'right' });
      y += 6;
    });
    y += 6;
  }

  seccionDesglose('DESGLOSE POR MATERIAL:', agregarPorMaterial(datos.destaraje));
  seccionDesglose('DESGLOSE PRODUCCION:', agregarPorMaterial(datos.produccion));
  seccionDesglose('DESGLOSE VENTAS:', agregarPorMaterial(datos.ventas));

  const porProveedor = agregarPorProveedor(datos.destaraje);
  saltoSiNecesario(14 + porProveedor.reduce((s, p) => s + 6 + p.materiales.length * 6, 0));
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DESGLOSE POR PROVEEDOR + MATERIAL:', 14, y);
  y += 5;
  lineaSeparadora();
  porProveedor.forEach((p) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG`, 18, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    p.materiales.forEach((m) => {
      doc.text(`${m.material}  ${formatearNumeroReporte(m.kg)} KG`, 22, y);
      y += 6;
    });
  });
  y += 6;

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    saltoSiNecesario(20);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN PAGOS:', 14, y);
    y += 5;
    lineaSeparadora();
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`, 18, y);
    y += 6;
    doc.text(`TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`, 18, y);
    y += 10;
  }

  const detalle = construirDetalleTickets(datos);
  saltoSiNecesario(30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE TICKETS:', 14, y);
  y += 6;
  doc.autoTable({
    startY: y,
    head: [['TICKET', 'PROVEEDOR', 'MATERIAL', 'KG', 'F.ENTRADA', 'F.SALIDA']],
    body: detalle.map((r) => [r.ticket, r.proveedor, r.material, formatearNumeroReporte(r.kg), r.fechaEntrada, r.fechaSalida]),
    headStyles: { fillColor: [0, 29, 61] }
  });
  y = doc.lastAutoTable.finalY + 10;

  if (datos.pagos.length > 0) {
    saltoSiNecesario(30);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLE DE PAGOS:', 14, y);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [['TICKET', 'PROVEEDOR', 'MATERIAL', 'KG', 'PRECIO/KG', 'TOTAL', 'PAGADO', 'DEUDA', 'FECHA']],
      body: datos.pagos.map((p) => [
        p.ticket, p.proveedor, p.material, formatearNumeroReporte(p.kg),
        window.formatearMoneda(p.precioPorKg), window.formatearMoneda(p.total),
        window.formatearMoneda(p.pagado),
        window.formatearMoneda((Number(p.total) || 0) - (Number(p.pagado) || 0)),
        p.fecha
      ]),
      headStyles: { fillColor: [0, 29, 61] }
    });
  }

  return doc;
}

window.generarPDF = generarPDF;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_PDF_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add reportes.js PDF generator (jsPDF + autoTable)"
```

---

### Task 4: `js/reportes.js` — CSV row builder + export orchestration

**Files:**
- Modify: `js/reportes.js` — insert before the closing `})();`, completing the file
- Test: inline `node -e` smoke check (the CSV row builder is fully Node-testable; the 3 orchestration functions are DOM-dependent — `window.descargarArchivo`/`window.exportarCSV` — and are smoke-tested for existence only here, exercised for real in Task 5's live Playwright check)

**Interfaces:**
- Consumes: `obtenerRangoYEtiqueta`, `obtenerDatosPeriodo`, `generarTXT`, `generarPDF` (Tasks 1-3, same file); `window.descargarArchivo`, `window.exportarCSV`, `window.obtenerFechaMexico` (`js/utils.js`).
- Produces: `construirFilasCSV(datos)` → uniform-shape row array; `window.exportarReporteTXT(tabId, filtros)`, `window.exportarReportePDF(tabId, filtros)`, `window.exportarReporteCSV(tabId, filtros)` — the 3 functions Task 5 wires to buttons in `js/destaraje.js`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO'];
global.EVE = {
  registrosDestaraje: [{ ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }],
  registrosVentas: [],
  registrosProduccion: [{ ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO', kg: 80, fechaEntrada: '2026-06-01', fechaSalida: '2026-06-01' }],
  registrosPagos: [{ ticket: '1', proveedor: 'PROV A', material: 'MIXTO', kg: 100, precioPorKg: 10, total: 1000, pagado: 800, fecha: '2026-06-01' }]
};
require('./js/reportes.js');
const assert = require('assert');

const datos = window.obtenerDatosPeriodo('', '');
const filas = window.construirFilasCSV(datos);
assert.strictEqual(filas.length, 2);
const claves = Object.keys(filas[0]).sort();
assert.deepStrictEqual(claves, Object.keys(filas[1]).sort());
assert.strictEqual(filas[0].modulo, 'DESTARAJE');
assert.strictEqual(filas[0].proveedorOCliente, 'PROV A');
assert.strictEqual(filas[1].modulo, 'PRODUCCION');
assert.strictEqual(filas[1].proveedorOCliente, 'PRODUCCION');

assert.strictEqual(typeof window.exportarReporteTXT, 'function');
assert.strictEqual(typeof window.exportarReportePDF, 'function');
assert.strictEqual(typeof window.exportarReporteCSV, 'function');
console.log('REPORTES_CSV_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.construirFilasCSV is not a function` (exit code 1).

- [ ] **Step 3: Insert the implementation**

In `js/reportes.js`, find this anchor:

```javascript
window.generarPDF = generarPDF;

})();
```

Replace it with:

```javascript
window.generarPDF = generarPDF;

function construirFilasCSV(datos) {
  const filas = [];
  const agregarFila = (modulo, registro, proveedorOCliente) => {
    filas.push({
      modulo,
      ticket: registro.ticket,
      proveedorOCliente,
      material: registro.material,
      kg: registro.kg,
      fechaEntrada: registro.fechaEntrada || '',
      fechaSalida: registro.fechaSalida || '',
      precioPorKg: registro.precioPorKg ?? '',
      total: registro.total ?? '',
      pagado: registro.pagado ?? '',
      deuda: registro.total !== undefined ? (Number(registro.total) || 0) - (Number(registro.pagado) || 0) : '',
      fecha: registro.fecha || ''
    });
  };
  datos.destaraje.forEach((r) => agregarFila('DESTARAJE', r, r.proveedor));
  datos.ventas.forEach((r) => agregarFila('VENTA', r, r.proveedor));
  datos.produccion.forEach((r) => agregarFila('PRODUCCION', r, r.cliente));
  datos.pagos.forEach((r) => agregarFila('PAGO', r, r.proveedor));
  return filas;
}

function exportarReporteTXT(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const texto = generarTXT(datos, periodo);
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.txt`);
}

function exportarReportePDF(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const doc = generarPDF(datos, periodo);
  doc.save(`Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
}

function exportarReporteCSV(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const filas = construirFilasCSV(datos);
  window.exportarCSV(filas, `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`);
}

window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_CSV_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add reportes.js CSV row builder and export orchestration"
```

---

### Task 5: Wire export buttons into `js/destaraje.js` + `index.html`/CSS + live Firebase check

**Files:**
- Modify: `js/destaraje.js` (add one function + one call site)
- Modify: `index.html` (add `<script src="js/reportes.js">` before `destaraje.js`)
- Modify: `css/styles.css` (append `.destaraje-exportar` rule)
- Test: Playwright script run via `node` (ephemeral, not committed differently from prior phases — same pattern as `verify-phase3a.js`)

**Interfaces:**
- Consumes: `window.exportarReporteTXT`, `window.exportarReportePDF`, `window.exportarReporteCSV` (Task 4); `js/destaraje.js`'s own module-scoped `tabActiva`/`filtros` (already exist, Phase 3a).
- Produces: confirmation that Phase 3b's acceptance criteria hold. No Firestore writes — this task only reads.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q 'src="js/reportes.js"' index.html && grep -q 'destaraje-exportar' css/styles.css && grep -q 'exportarReporteTXT' js/destaraje.js && echo "WIRING_OK"
```

Expected: no `WIRING_OK` printed.

- [ ] **Step 2: Modify `js/destaraje.js`**

Find this anchor (the end of `renderizarVista` and the start of `renderDestaraje`):

```javascript
function renderizarVista() {
  document.getElementById('destaraje-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const { destaraje, ventas } = obtenerRegistrosParaTab();
  renderizarStats(destaraje, ventas);
  llenarTabla('destaraje-tabla-destaraje', destaraje);
  llenarTabla('destaraje-tabla-ventas', ventas);
}

function renderDestaraje(container) {
```

Replace it with (adding `crearBotonesExportar` before `renderDestaraje`):

```javascript
function renderizarVista() {
  document.getElementById('destaraje-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const { destaraje, ventas } = obtenerRegistrosParaTab();
  renderizarStats(destaraje, ventas);
  llenarTabla('destaraje-tabla-destaraje', destaraje);
  llenarTabla('destaraje-tabla-ventas', ventas);
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const acciones = [
    { texto: 'TXT', fn: () => window.exportarReporteTXT(tabActiva, filtros) },
    { texto: 'PDF', fn: () => window.exportarReportePDF(tabActiva, filtros) },
    { texto: 'CSV', fn: () => window.exportarReporteCSV(tabActiva, filtros) }
  ];
  acciones.forEach((accion) => {
    const boton = document.createElement('button');
    boton.textContent = accion.texto;
    boton.className = 'btn-secondary';
    boton.addEventListener('click', accion.fn);
    div.appendChild(boton);
  });
  return div;
}

function renderDestaraje(container) {
```

Then find this anchor inside `renderDestaraje`:

```javascript
  const stats = document.createElement('div');
  stats.id = 'destaraje-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearTabla('destaraje-tabla-destaraje', 'Destaraje'));
```

Replace it with (adding the export button row right after the stats div):

```javascript
  const stats = document.createElement('div');
  stats.id = 'destaraje-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla('destaraje-tabla-destaraje', 'Destaraje'));
```

- [ ] **Step 3: Modify `css/styles.css`**

Append:

```css
.destaraje-exportar {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
```

- [ ] **Step 4: Modify `index.html`**

Change:

```html
  <script src="js/auth.js"></script>
  <script src="js/destaraje.js"></script>
</body>
</html>
```

to:

```html
  <script src="js/auth.js"></script>
  <script src="js/reportes.js"></script>
  <script src="js/destaraje.js"></script>
</body>
</html>
```

- [ ] **Step 5: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `WIRING_OK`

- [ ] **Step 6: Commit**

```bash
git add js/destaraje.js css/styles.css index.html
git commit -m "feat: wire TXT/PDF/CSV export buttons into Destaraje tabs"
```

- [ ] **Step 7: Write and run the live-Firebase Playwright check**

This check is **read-only** — it never calls `guardarDato`/`actualizarDato`/`eliminarDato`, only exports from whatever real data already exists.

Create `docs/superpowers/verify-phase3b.js`:

```javascript
const fs = require('fs');
const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');
  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('.destaraje-exportar');

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');

  const [downloadTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  const txtContenido = fs.readFileSync(await downloadTxt.path(), 'utf-8');
  console.log('TXT_OK:', txtContenido.startsWith('DESTARAJE GENERAL') && txtContenido.includes('REPORTE: TODOS'));

  const [downloadCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  const csvContenido = fs.readFileSync(await downloadCsv.path(), 'utf-8');
  console.log('CSV_OK:', csvContenido.length > 0);

  const [downloadPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  const pdfBuffer = fs.readFileSync(await downloadPdf.path());
  console.log('PDF_OK:', pdfBuffer.slice(0, 4).toString() === '%PDF', 'TAMANO:', pdfBuffer.length);

  await page.click('.destaraje-subtabs .tab:has-text("Hoy")');
  const [downloadTxtHoy] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  const txtHoyContenido = fs.readFileSync(await downloadTxtHoy.path(), 'utf-8');
  console.log('REPORTE_HOY_OK:', txtHoyContenido.includes('REPORTE: HOY'));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

Run:

```bash
cd "eve-control-v2"
(python -m http.server 8765 >/tmp/eve-server.log 2>&1 &)
sleep 1
node docs/superpowers/verify-phase3b.js
```

Expected output:
```
TXT_OK: true
CSV_OK: true
PDF_OK: true TAMANO: <some number > 1000>
REPORTE_HOY_OK: true
CONSOLE_ERRORS: []
```

If `CONSOLE_ERRORS` is non-empty or any assertion is false, stop and report —
don't guess at a fix blindly (see systematic-debugging if the cause isn't
obvious). This check never writes to Firestore, so there is no cleanup step.

- [ ] **Step 8: Stop the local server**

```bash
PID=$(netstat -ano | grep ':8765 ' | grep LISTENING | head -1 | awk '{print $NF}')
[ -n "$PID" ] && taskkill //PID "$PID" //F
```

- [ ] **Step 9: Commit the verification script**

```bash
git add docs/superpowers/verify-phase3b.js
git commit -m "test: add live-Firebase Playwright check for Phase 3b report exports"
```

---

## Self-Review Notes

- **Spec coverage:** exact TXT/PDF section order and content (Tasks 2-3), `fechaSalida`/`fecha` field split (Task 1), `TOTAL KG` excluding PZ materials (Tasks 1-3), `DESGLOSE POR PROVEEDOR + MATERIAL` destaraje-only (Tasks 1-3), bare-number KG column in `DETALLE DE TICKETS` (Tasks 1-3), conditional `RESUMEN PAGOS`/`DETALLE DE PAGOS` (Tasks 2-3), CSV as uniform flat rows via the existing `exportarCSV` (Task 4), 3 buttons per Destaraje tab (Task 5), read-only (no task calls `guardarDato`/`actualizarDato`/`eliminarDato`) — all covered.
- **Placeholder scan:** none — every step has complete code and exact commands/expected output.
- **Type/interface consistency:** `obtenerDatosPeriodo`'s return shape (`{destaraje, ventas, produccion, pagos}`) is defined once in Task 1 and consumed identically by Tasks 2-4. `agregarPorMaterial`/`agregarPorProveedor`'s shapes are used identically in the TXT generator (Task 2) and PDF generator (Task 3). `formatearNumeroReporte` is defined in Task 2 and reused as a bare identifier in Task 3 (same IIFE, no `window.` prefix needed) — consistent with how Task 3 of Phase 3a's plan reused Task 1's bare identifiers within `destaraje.js`'s own IIFE.
- **IIFE-append mechanics:** every task after Task 1 inserts before the closing `})();` rather than appending after it — called out explicitly in each task's Files section, since this differs from how Phase 3a's tasks appended (that file's IIFE was added retroactively after all 3 tasks were already merged).

