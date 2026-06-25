# Fase 7 — Módulo Reportes UI (con Telegram) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working "Reportes" tab (reserved since Phase 2, never built) — a Módulo selector (Reporte General | Control de Producción), an adaptive filter bar, a text Vista Previa, TXT/PDF/CSV export, and a Telegram button that sends a 5-section combined summary with the General PDF attached.

**Architecture:** One new file, `js/reportes-ui.js` (the tab itself), consuming an extended `js/reportes.js` (the already-merged report engine from Phase 3b, gaining a backward-compatible optional filter parameter, new Control de Producción report generators, and Telegram-sending functions). This is the second cross-module change in the project, after `js/destaraje.js` in Phase 6.

**Tech Stack:** Vanilla JS, Firebase Firestore (via `js/utils.js`), jsPDF/autoTable (already loaded), direct `fetch` calls to the Telegram Bot API (confirmed viable without a Cloud Function or proxy), Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-reportes-ui-design.md`.
- `js/reportes.js`'s `obtenerDatosPeriodo(desde, hasta)` becomes
  `obtenerDatosPeriodo(desde, hasta, filtrosAdicionales)` — the third
  parameter is **optional** (`undefined` is treated as `{}`). Every
  existing caller (`exportarReporteTXT/PDF/CSV`, called from
  `destaraje.js`/`produccion.js`/`pagos.js`/`control-produccion.js`)
  calls it with exactly 2 arguments and must see **zero behavior change**.
- Filter semantics: `ticket` is substring match (`.includes()`, like
  every existing Ticket filter in this project); `proveedor`/`material`/
  `cliente` are **exact** match (since the new UI uses real `<select>`
  dropdowns populated from actual distinct Firestore values, not
  free-text). `proveedor` filters Destaraje (Compra) and Pagos (both have
  a `proveedor` field representing a supplier); `cliente` filters
  Producción (`cliente` field) and Ventas (`proveedor` field, which holds
  the client's name in that record type — same field name, different
  real-world meaning, exactly as established since Phase 3a).
- Control de Producción's report generators
  (`generarTXTControlProduccion`, `generarPDFControlProduccion`,
  `construirFilasCSVControlProduccion`) reuse
  `window.EVE_CONTROL_PRODUCCION.calcularStats`/`PROCESOS` rather than
  reimplementing those calculations — consume, don't duplicate.
- The `etiquetaReporte` for every report generated through this new tab
  is always the literal string `"PERSONALIZADO"` (this tab has no
  Hoy/Esta Semana/Todos tabs — it's a single freeform Desde/Hasta range).
- Telegram message: **always** the full 5-section summary (Destaraje,
  Producción, Ventas, Pagos, Control de Producción) for the active
  Desde/Hasta range, regardless of which Módulo is selected in the
  filter, and **ignoring** every other filter (Proveedor/Material/
  Cliente/Operador/Turno/Tipo de Proceso) — this is a deliberate
  brainstorming decision, faithful to the spec's mock, not a bug. The
  attached PDF is always the Reporte General (`generarPDF`) for that
  same Desde/Hasta range, also unfiltered beyond dates.
- Telegram config: read from `window.db.collection('config').doc('telegram')`
  (fields `token`, `chatId`). If the document doesn't exist or either
  field is missing, throw a clear Spanish error — never call the
  Telegram API with missing credentials. Confirmed (by the user, who has
  built this exact stack before) that calling
  `https://api.telegram.org/bot<token>/sendMessage` and `.../sendDocument`
  directly via `fetch` from the browser works — no CORS blocker, no
  Cloud Function needed.
- Namespace rule (same pattern as Phases 5-6): `js/reportes-ui.js`
  exposes `window.EVE_REPORTES_UI = { ... }`, built once and only ever
  extended via `Object.assign` across tasks. The new functions this plan
  adds to `js/reportes.js` are added as additional `window.X = ...` lines
  (matching that file's own established style — it does NOT use the
  namespace-object pattern, since it predates Phase 5's convention and
  this plan only extends it, never rewrites its existing export style).
- XSS rule (same as every prior module): any Firestore-/form-derived
  value reaching the DOM uses `.textContent`/`.value`, never `innerHTML`
  string interpolation. Static markup with no interpolated variables may
  use `innerHTML`. The Vista Previa text is set via `.textContent` on a
  `<pre>` (it's a multi-line plain-text string, never parsed as HTML).
- This plan never modifies `js/destaraje.js`, `js/produccion.js`,
  `js/pagos.js`, `js/control-produccion.js`, `js/trazabilidad.js`,
  `js/voz.js`, or `js/auth.js` — it only consumes their existing exports
  (`window.EVE.*` arrays, `window.EVE_CONTROL_PRODUCCION.*`).
- No "Probar Telegram" button, no Panel Admin UI to edit the token — out
  of scope for this phase (see the design spec's "Fuera de alcance").

---

## File Structure

```
eve-control-v2/
├── index.html                (Task 7 — add <script src="js/reportes-ui.js"> after control-produccion.js)
├── css/
│   └── styles.css            (Task 7 — Módulo selector, adaptive filter bar, Vista Previa <pre> card)
└── js/
    ├── reportes.js            (Tasks 1-3 — modify, already merged)
    └── reportes-ui.js         (Tasks 4-6, new)
```

`js/reportes.js` is extended across 3 tasks (date/filter extension, Control de Producción generators, Telegram). `js/reportes-ui.js` is built across 3 tasks (filter infrastructure, Vista Previa + export, Telegram wiring) — each is independently Node-testable before the live Playwright check in Task 7.

---

### Task 1: `js/reportes.js` — extend `obtenerDatosPeriodo` with optional additional filters

**Files:**
- Modify: `js/reportes.js`
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: nothing new.
- Produces: `window.obtenerDatosPeriodo(desde, hasta, filtrosAdicionales)` — `filtrosAdicionales` optional, shape `{ ticket, proveedor, material, cliente }`. Also exports (for Task 4's reuse and for this task's own tests): `aplicaFiltroTicket(registro, ticket)`, `aplicaFiltroMaterial(registro, material)`, `aplicaFiltroExacto(registro, campo, valor)` — kept as bare (non-exported) identifiers inside the IIFE, consumed only by `obtenerDatosPeriodo` itself; no new `window.*` export needed for them since nothing outside this file calls them directly.

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = [];
require('./js/reportes.js');
const assert = require('assert');

global.EVE = {
  registrosDestaraje: [
    { ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO', kg: 650, fechaSalida: '2026-04-24' },
    { ticket: '9261', proveedor: 'JUANA', material: 'PET', kg: 300, fechaSalida: '2026-04-24' }
  ],
  registrosVentas: [
    { ticket: 'V', proveedor: 'CLIENTE X', material: 'PELLETS', kg: 900, fechaSalida: '2026-04-24' }
  ],
  registrosProduccion: [
    { ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO', kg: 1800, fechaSalida: '2026-04-24' }
  ],
  registrosPagos: [
    { ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO', kg: 650, pagado: 6500, total: 6500, fecha: '2026-04-24' }
  ]
};

// Sin filtrosAdicionales: comportamiento idéntico al actual (todo llamador existente)
const sinFiltros = window.obtenerDatosPeriodo('2026-04-24', '2026-04-24');
assert.strictEqual(sinFiltros.destaraje.length, 2);
assert.strictEqual(sinFiltros.ventas.length, 1);
assert.strictEqual(sinFiltros.produccion.length, 1);
assert.strictEqual(sinFiltros.pagos.length, 1);

// Con filtro de proveedor (exacto) -> solo afecta destaraje y pagos
const porProveedor = window.obtenerDatosPeriodo('2026-04-24', '2026-04-24', { proveedor: 'JOSE ENRIQUE' });
assert.strictEqual(porProveedor.destaraje.length, 1);
assert.strictEqual(porProveedor.destaraje[0].proveedor, 'JOSE ENRIQUE');
assert.strictEqual(porProveedor.pagos.length, 1);
assert.strictEqual(porProveedor.ventas.length, 1); // proveedor no filtra ventas
assert.strictEqual(porProveedor.produccion.length, 1); // ni produccion

// Con filtro de cliente (exacto) -> solo afecta ventas y produccion
const porCliente = window.obtenerDatosPeriodo('2026-04-24', '2026-04-24', { cliente: 'PRODUCCION' });
assert.strictEqual(porCliente.produccion.length, 1);
assert.strictEqual(porCliente.ventas.length, 0); // 'CLIENTE X' !== 'PRODUCCION'
assert.strictEqual(porCliente.destaraje.length, 2); // cliente no filtra destaraje

// Con filtro de material (exacto) -> afecta los 4
const porMaterial = window.obtenerDatosPeriodo('2026-04-24', '2026-04-24', { material: 'MIXTO' });
assert.strictEqual(porMaterial.destaraje.length, 1);
assert.strictEqual(porMaterial.pagos.length, 1);
assert.strictEqual(porMaterial.ventas.length, 0);
assert.strictEqual(porMaterial.produccion.length, 0);

// Con filtro de ticket (substring) -> afecta los 4
const porTicket = window.obtenerDatosPeriodo('2026-04-24', '2026-04-24', { ticket: '926' });
assert.strictEqual(porTicket.destaraje.length, 2);
assert.strictEqual(porTicket.pagos.length, 1);
assert.strictEqual(porTicket.ventas.length, 0);
assert.strictEqual(porTicket.produccion.length, 0);

console.log('OBTENER_DATOS_PERIODO_FILTROS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: an `AssertionError` (`porProveedor.destaraje.length` is `2`, not `1`) — the current `obtenerDatosPeriodo` ignores the third argument entirely.

- [ ] **Step 3: Write the implementation**

In `js/reportes.js`, find this anchor:

```javascript
function obtenerDatosPeriodo(desde, hasta) {
  return {
    destaraje: window.EVE.registrosDestaraje.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    ventas: window.EVE.registrosVentas.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    produccion: window.EVE.registrosProduccion.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    pagos: window.EVE.registrosPagos.filter((r) => dentroDeRangoReporte(r.fecha, desde, hasta))
  };
}
```

Replace it with:

```javascript
function aplicaFiltroTicket(registro, ticket) {
  return !ticket || String(registro.ticket || '').toUpperCase().includes(ticket.toUpperCase());
}

function aplicaFiltroMaterial(registro, material) {
  return !material || registro.material === material;
}

function aplicaFiltroExacto(registro, campo, valor) {
  return !valor || registro[campo] === valor;
}

function obtenerDatosPeriodo(desde, hasta, filtrosAdicionales) {
  const f = filtrosAdicionales || {};
  return {
    destaraje: window.EVE.registrosDestaraje.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.proveedor)
    ),
    ventas: window.EVE.registrosVentas.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.cliente)
    ),
    produccion: window.EVE.registrosProduccion.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'cliente', f.cliente)
    ),
    pagos: window.EVE.registrosPagos.filter((r) =>
      dentroDeRangoReporte(r.fecha, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.proveedor)
    )
  };
}
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `OBTENER_DATOS_PERIODO_FILTROS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add optional ticket/proveedor/material/cliente filters to obtenerDatosPeriodo"
```

---

### Task 2: `js/reportes.js` — Control de Producción report generators

**Files:**
- Modify: `js/reportes.js`
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.EVE_CONTROL_PRODUCCION.calcularStats` (`js/control-produccion.js`, unmodified); `formatearNumeroReporte` (this file, bare identifier, already exists).
- Produces: `window.agregarPorTipoProceso(registros)` → `[{ tipoProceso, cantidad, totalOutput, eficienciaPromedio }]`, sorted descending by `totalOutput`; `window.generarTXTControlProduccion(registros, periodo)` → `string`; `window.generarPDFControlProduccion(registros, periodo)` → jsPDF `doc`; `window.construirFilasCSVControlProduccion(registros)` → `array` of flat row objects.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = [];
global.jspdf = { jsPDF: class { constructor(){ this.internal = { pageSize: { getWidth: () => 210 } }; } setFontSize(){} setFont(){} setDrawColor(){} line(){} text(){} addPage(){} autoTable(o){ this.lastAutoTable = { finalY: 100 }; } output(){ return new Blob(['pdf']); } save(){} } };
global.EVE_CONTROL_PRODUCCION = {
  calcularStats(registros) {
    let totalInput = 0, totalOutput = 0, sumaEficiencia = 0;
    registros.forEach((r) => { totalInput += r.totalInput; totalOutput += r.totalOutput; sumaEficiencia += r.eficiencia; });
    return { totalRegistros: registros.length, totalInput, totalOutput, eficienciaPromedio: registros.length ? sumaEficiencia / registros.length : 0 };
  }
};
global.obtenerFechaMexico = () => '2026-06-24';
global.formatearMoneda = (v) => '\$' + v;
require('./js/reportes.js');
const assert = require('assert');

const registros = [
  { ticket: 'P-001', tipoProceso: 'PELETIZADO', operador: 'CHRISTIAN', turno: 'Matutino', totalInput: 1000, totalOutput: 900, eficiencia: 90, porcentajeMerma: 10, fechaInicio: '2026-04-28T08:00', fechaFin: '2026-04-28T14:00' },
  { ticket: 'P-002', tipoProceso: 'PELETIZADO', operador: 'CHRISTIAN', turno: 'Vespertino', totalInput: 500, totalOutput: 480, eficiencia: 96, porcentajeMerma: 4, fechaInicio: '2026-04-28T14:00', fechaFin: '2026-04-28T18:00' },
  { ticket: 'P-003', tipoProceso: 'MOLIENDA', operador: 'JUAN', turno: 'Matutino', totalInput: 800, totalOutput: 760, eficiencia: 95, porcentajeMerma: 5, fechaInicio: '2026-04-28T08:00', fechaFin: '2026-04-28T12:00' }
];

const porTipo = window.agregarPorTipoProceso(registros);
assert.strictEqual(porTipo.length, 2);
assert.strictEqual(porTipo[0].tipoProceso, 'PELETIZADO');
assert.strictEqual(porTipo[0].cantidad, 2);
assert.strictEqual(porTipo[0].totalOutput, 1380);
assert.strictEqual(porTipo[0].eficienciaPromedio, 93);
assert.strictEqual(porTipo[1].tipoProceso, 'MOLIENDA');

const periodo = { etiquetaReporte: 'PERSONALIZADO', etiquetaPeriodo: '28 DE ABRIL DE 2026' };
const txt = window.generarTXTControlProduccion(registros, periodo);
assert.ok(txt.includes('CONTROL DE PRODUCCIÓN'));
assert.ok(txt.includes('TOTAL PROCESOS: 3'));
assert.ok(txt.includes('TOTAL INPUT: 2,300 KG'));
assert.ok(txt.includes('EFICIENCIA PROMEDIO: 93.67%'));
assert.ok(txt.includes('P-001'));
assert.ok(txt.includes('MOLIENDA'));

const filas = window.construirFilasCSVControlProduccion(registros);
assert.strictEqual(filas.length, 3);
assert.deepStrictEqual(filas[0], {
  ticket: 'P-001', tipoProceso: 'PELETIZADO', operador: 'CHRISTIAN', turno: 'Matutino',
  totalInput: 1000, totalOutput: 900, eficiencia: 90, porcentajeMerma: 10,
  fechaInicio: '2026-04-28T08:00', fechaFin: '2026-04-28T14:00'
});

const doc = window.generarPDFControlProduccion(registros, periodo);
assert.ok(doc);

console.log('CONTROL_PRODUCCION_REPORTE_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.agregarPorTipoProceso is not a function`.

- [ ] **Step 3: Write the implementation**

In `js/reportes.js`, find this anchor:

```javascript
window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

})();
```

Replace it with:

```javascript
function agregarPorTipoProceso(registros) {
  const mapa = new Map();
  for (const r of registros) {
    if (!mapa.has(r.tipoProceso)) {
      mapa.set(r.tipoProceso, { cantidad: 0, totalOutput: 0, sumaEficiencia: 0 });
    }
    const acumulado = mapa.get(r.tipoProceso);
    acumulado.cantidad += 1;
    acumulado.totalOutput += Number(r.totalOutput) || 0;
    acumulado.sumaEficiencia += Number(r.eficiencia) || 0;
  }
  return Array.from(mapa.entries())
    .map(([tipoProceso, acc]) => ({
      tipoProceso,
      cantidad: acc.cantidad,
      totalOutput: acc.totalOutput,
      eficienciaPromedio: acc.cantidad > 0 ? acc.sumaEficiencia / acc.cantidad : 0
    }))
    .sort((a, b) => b.totalOutput - a.totalOutput);
}

window.agregarPorTipoProceso = agregarPorTipoProceso;

function generarTXTControlProduccion(registros, periodo) {
  const lineas = [];
  lineas.push('CONTROL DE PRODUCCIÓN');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');

  const stats = window.EVE_CONTROL_PRODUCCION.calcularStats(registros);
  lineas.push(`TOTAL PROCESOS: ${stats.totalRegistros}`);
  lineas.push(`TOTAL INPUT: ${formatearNumeroReporte(stats.totalInput)} KG`);
  lineas.push(`TOTAL OUTPUT: ${formatearNumeroReporte(stats.totalOutput)} KG`);
  lineas.push(`EFICIENCIA PROMEDIO: ${stats.eficienciaPromedio.toFixed(2)}%`);
  lineas.push('');

  lineas.push('DESGLOSE POR TIPO DE PROCESO:');
  agregarPorTipoProceso(registros).forEach((item) => {
    lineas.push(`  ${item.tipoProceso}  ${item.cantidad} procesos  ${formatearNumeroReporte(item.totalOutput)} KG output  eficiencia prom ${item.eficienciaPromedio.toFixed(2)}%`);
  });
  lineas.push('');

  lineas.push('DETALLE DE PROCESOS:');
  lineas.push('  TICKET  PROCESO  OPERADOR  TURNO  INPUT  OUTPUT  EFICIENCIA  MERMA%  F.INICIO  F.FIN');
  registros.forEach((r) => {
    lineas.push(`  ${r.ticket}  ${r.tipoProceso}  ${r.operador}  ${r.turno}  ${formatearNumeroReporte(r.totalInput)}  ${formatearNumeroReporte(r.totalOutput)}  ${r.eficiencia.toFixed(2)}%  ${r.porcentajeMerma.toFixed(2)}%  ${r.fechaInicio}  ${r.fechaFin}`);
  });

  return lineas.join('\n');
}

window.generarTXTControlProduccion = generarTXTControlProduccion;

function generarPDFControlProduccion(registros, periodo) {
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
  doc.text('CONTROL DE PRODUCCIÓN', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const stats = window.EVE_CONTROL_PRODUCCION.calcularStats(registros);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL INPUT: ${formatearNumeroReporte(stats.totalInput)} KG`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`TOTAL OUTPUT: ${formatearNumeroReporte(stats.totalOutput)} KG  —  EFICIENCIA PROMEDIO: ${stats.eficienciaPromedio.toFixed(2)}%`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const porTipo = agregarPorTipoProceso(registros);
  saltoSiNecesario(14 + porTipo.length * 6);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DESGLOSE POR TIPO DE PROCESO:', 14, y);
  y += 5;
  lineaSeparadora();
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  porTipo.forEach((item) => {
    doc.text(`    ${item.tipoProceso} (${item.cantidad})`, 14, y);
    doc.text(`${formatearNumeroReporte(item.totalOutput)} KG — ${item.eficienciaPromedio.toFixed(2)}%`, anchoPagina - 14, y, { align: 'right' });
    y += 6;
  });
  y += 6;

  saltoSiNecesario(30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE PROCESOS:', 14, y);
  y += 6;
  doc.autoTable({
    startY: y,
    head: [['TICKET', 'PROCESO', 'OPERADOR', 'TURNO', 'INPUT', 'OUTPUT', 'EFICIENCIA', 'MERMA%', 'F.INICIO', 'F.FIN']],
    body: registros.map((r) => [
      r.ticket, r.tipoProceso, r.operador, r.turno,
      formatearNumeroReporte(r.totalInput), formatearNumeroReporte(r.totalOutput),
      `${r.eficiencia.toFixed(2)}%`, `${r.porcentajeMerma.toFixed(2)}%`, r.fechaInicio, r.fechaFin
    ]),
    headStyles: { fillColor: [0, 29, 61] }
  });

  return doc;
}

window.generarPDFControlProduccion = generarPDFControlProduccion;

function construirFilasCSVControlProduccion(registros) {
  return registros.map((r) => ({
    ticket: r.ticket,
    tipoProceso: r.tipoProceso,
    operador: r.operador,
    turno: r.turno,
    totalInput: r.totalInput,
    totalOutput: r.totalOutput,
    eficiencia: r.eficiencia,
    porcentajeMerma: r.porcentajeMerma,
    fechaInicio: r.fechaInicio,
    fechaFin: r.fechaFin
  }));
}

window.construirFilasCSVControlProduccion = construirFilasCSVControlProduccion;

window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `CONTROL_PRODUCCION_REPORTE_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add Control de Produccion report generators (TXT/PDF/CSV) to reportes.js"
```

---

### Task 3: `js/reportes.js` — `agregarPagadoPorProveedor` + Telegram message + send

**Files:**
- Modify: `js/reportes.js`
- Test: inline `node -e` smoke check (async, mocks `fetch`/`window.db`)

**Interfaces:**
- Consumes: `obtenerDatosPeriodo`, `sumarPorUnidad`, `agregarPorMaterial`, `calcularResumenPagos`, `generarPDF` (this file, bare identifiers, already exist); `window.EVE_CONTROL_PRODUCCION.calcularStats`; `window.EVE.registrosControlProduccion`; `window.db` (`js/utils.js`'s Firestore handle, already global).
- Produces: `window.agregarPagadoPorProveedor(pagos)` → `[{ proveedor, totalPagado }]` (excludes `totalPagado <= 0`, sorted descending); `window.construirMensajeTelegram(periodo)` → `string`; `window.enviarReporteTelegram(periodo)` → `Promise` resolving to the Telegram API's `sendDocument` response, throwing a Spanish-message `Error` if config is missing or either API call reports `ok: false`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
(async () => {
global.window = global;
global.MATERIALES_PZ = [];
require('./js/reportes.js');
const assert = require('assert');

global.EVE = {
  registrosDestaraje: [{ ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO', kg: 1000, fechaSalida: '2026-04-24' }],
  registrosVentas: [{ ticket: 'V', proveedor: 'CLIENTE X', material: 'PELLETS', kg: 900, fechaSalida: '2026-04-24' }],
  registrosProduccion: [{ ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO', kg: 800, fechaSalida: '2026-04-24' }],
  registrosPagos: [
    { ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO', kg: 1000, pagado: 8440, total: 10000, fecha: '2026-04-24' },
    { ticket: '9261', proveedor: 'JUANA', material: 'PET', kg: 500, pagado: 5360, total: 5360, fecha: '2026-04-24' },
    { ticket: '9262', proveedor: 'FRANCISCO', material: 'PET', kg: 100, pagado: 0, total: 500, fecha: '2026-04-24' }
  ],
  registrosControlProduccion: [
    { ticket: 'P-001', tipoProceso: 'PELETIZADO', operador: 'CHRISTIAN', turno: 'Matutino', totalInput: 1500, totalOutput: 1430, eficiencia: 92.5, porcentajeMerma: 4.67, fechaFin: '2026-04-24T14:00' }
  ]
};
global.EVE_CONTROL_PRODUCCION = {
  calcularStats(registros) {
    let totalInput = 0, totalOutput = 0, sumaEficiencia = 0;
    registros.forEach((r) => { totalInput += r.totalInput; totalOutput += r.totalOutput; sumaEficiencia += r.eficiencia; });
    return { totalRegistros: registros.length, totalInput, totalOutput, eficienciaPromedio: registros.length ? sumaEficiencia / registros.length : 0 };
  }
};
global.obtenerFechaMexico = () => '2026-04-24';
global.formatearMoneda = (v) => '\$' + Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2 });
global.jspdf = { jsPDF: class { constructor(){ this.internal = { pageSize: { getWidth: () => 210 } }; } setFontSize(){} setFont(){} setDrawColor(){} line(){} text(){} addPage(){} autoTable(){ this.lastAutoTable = { finalY: 100 }; } output(){ return new Blob(['pdf']); } } };

const periodo = { desde: '2026-04-24', hasta: '2026-04-24', etiquetaReporte: 'PERSONALIZADO', etiquetaPeriodo: '24 DE ABRIL DE 2026' };

const pagados = window.agregarPagadoPorProveedor(global.EVE.registrosPagos);
assert.deepStrictEqual(pagados, [
  { proveedor: 'JOSE ENRIQUE', totalPagado: 8440 },
  { proveedor: 'JUANA', totalPagado: 5360 }
]);

const mensaje = window.construirMensajeTelegram(periodo);
assert.ok(mensaje.includes('📊 REPORTE'));
assert.ok(mensaje.includes('DESTARAJE:'));
assert.ok(mensaje.includes('PRODUCCIÓN:'));
assert.ok(mensaje.includes('VENTAS:'));
assert.ok(mensaje.includes('PAGOS:'));
assert.ok(mensaje.includes('CONTROL DE PRODUCCIÓN:'));
assert.ok(mensaje.includes('JOSE ENRIQUE'));
assert.ok(!mensaje.includes('FRANCISCO')); // pagado=0, excluido
assert.ok(mensaje.includes('Eficiencia promedio: 92.5%'));
assert.ok(mensaje.includes('📄 Ver PDF adjunto'));
console.log('TELEGRAM_MENSAJE_OK');

// Sin documento de configuracion -> error claro, sin llamar fetch
global.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) };
let lanzoErrorSinConfig = false;
try {
  await window.enviarReporteTelegram(periodo);
} catch (error) {
  lanzoErrorSinConfig = error.message.includes('Configura el token de Telegram');
}
assert.ok(lanzoErrorSinConfig);
console.log('TELEGRAM_SIN_CONFIG_OK');

// Con configuracion, fetch simulado exitoso
global.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ token: 'ABC', chatId: '123' }) }) }) }) };
const llamadas = [];
global.fetch = async (url, opciones) => {
  llamadas.push(url);
  return { json: async () => ({ ok: true }) };
};
const resultado = await window.enviarReporteTelegram(periodo);
assert.strictEqual(resultado.ok, true);
assert.strictEqual(llamadas.length, 2);
assert.ok(llamadas[0].includes('/botABC/sendMessage'));
assert.ok(llamadas[1].includes('/botABC/sendDocument'));
console.log('TELEGRAM_ENVIO_OK');

console.log('TODO_OK');
})().catch((e) => { console.error(e); process.exit(1); });
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.agregarPagadoPorProveedor is not a function`.

- [ ] **Step 3: Write the implementation**

In `js/reportes.js`, find this anchor:

```javascript
window.construirFilasCSVControlProduccion = construirFilasCSVControlProduccion;

window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

})();
```

Replace it with:

```javascript
window.construirFilasCSVControlProduccion = construirFilasCSVControlProduccion;

function agregarPagadoPorProveedor(pagos) {
  const mapa = new Map();
  for (const p of pagos) {
    const clave = p.proveedor || '';
    const actual = mapa.get(clave) || 0;
    mapa.set(clave, actual + (Number(p.pagado) || 0));
  }
  return Array.from(mapa.entries())
    .map(([proveedor, totalPagado]) => ({ proveedor, totalPagado }))
    .filter((item) => item.totalPagado > 0)
    .sort((a, b) => b.totalPagado - a.totalPagado);
}

window.agregarPagadoPorProveedor = agregarPagadoPorProveedor;

function topMaterialesTelegram(registros) {
  return agregarPorMaterial(registros)
    .slice(0, 2)
    .map((m) => `${m.material} ${formatearNumeroReporte(m.kg)} ${m.unidad}`)
    .join(', ');
}

function construirMensajeTelegram(periodo) {
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const datosCP = window.EVE.registrosControlProduccion.filter((r) =>
    dentroDeRangoReporte(r.fechaFin.slice(0, 10), periodo.desde, periodo.hasta)
  );
  const lineas = [];
  lineas.push('📊 REPORTE');
  lineas.push(`Periodo: ${periodo.etiquetaPeriodo}`);
  lineas.push('');

  lineas.push('DESTARAJE:');
  lineas.push(`• Total: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)} kg`);
  lineas.push(`• ${topMaterialesTelegram(datos.destaraje)}`);
  lineas.push('');

  lineas.push('PRODUCCIÓN:');
  lineas.push(`• Total: ${formatearNumeroReporte(datos.produccion.reduce((s, r) => s + (Number(r.kg) || 0), 0))} kg`);
  lineas.push(`• ${topMaterialesTelegram(datos.produccion)}`);
  lineas.push('');

  lineas.push('VENTAS:');
  lineas.push(`• Total: ${formatearNumeroReporte(sumarPorUnidad(datos.ventas).kg)} kg`);
  lineas.push(`• ${topMaterialesTelegram(datos.ventas)}`);
  lineas.push('');

  const resumenPagos = calcularResumenPagos(datos.pagos) || { totalPagado: 0, totalDeuda: 0 };
  lineas.push('PAGOS:');
  lineas.push(`• Total Pagado: ${window.formatearMoneda(resumenPagos.totalPagado)}`);
  const porProveedorPagado = agregarPagadoPorProveedor(datos.pagos);
  lineas.push(`• ${porProveedorPagado.map((p) => `${p.proveedor} ${window.formatearMoneda(p.totalPagado)}`).join(', ')}`);
  lineas.push('');

  const statsCP = window.EVE_CONTROL_PRODUCCION.calcularStats(datosCP);
  lineas.push('CONTROL DE PRODUCCIÓN:');
  lineas.push(`• Procesos: ${statsCP.totalRegistros}`);
  lineas.push(`• Material procesado: ${formatearNumeroReporte(statsCP.totalInput)} kg`);
  lineas.push(`• Eficiencia promedio: ${statsCP.eficienciaPromedio.toFixed(1)}%`);
  lineas.push('');

  lineas.push('📄 Ver PDF adjunto');
  return lineas.join('\n');
}

window.construirMensajeTelegram = construirMensajeTelegram;

async function enviarReporteTelegram(periodo) {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  if (!configDoc.exists) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }
  const { token, chatId } = configDoc.data();
  if (!token || !chatId) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }

  const mensaje = construirMensajeTelegram(periodo);
  const respuestaMensaje = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: mensaje })
  });
  const resultadoMensaje = await respuestaMensaje.json();
  if (!resultadoMensaje.ok) {
    throw new Error(`Telegram rechazó el mensaje: ${resultadoMensaje.description || 'error desconocido'}`);
  }

  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const doc = generarPDF(datos, periodo);
  const pdfBlob = doc.output('blob');
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', pdfBlob, `Reporte_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
  const respuestaDocumento = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData
  });
  const resultadoDocumento = await respuestaDocumento.json();
  if (!resultadoDocumento.ok) {
    throw new Error(`Telegram rechazó el PDF: ${resultadoDocumento.description || 'error desconocido'}`);
  }
  return resultadoDocumento;
}

window.enviarReporteTelegram = enviarReporteTelegram;

window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output:
```
TELEGRAM_MENSAJE_OK
TELEGRAM_SIN_CONFIG_OK
TELEGRAM_ENVIO_OK
TODO_OK
```

- [ ] **Step 5: Commit**

```bash
git add js/reportes.js
git commit -m "feat: add Telegram message builder and sender to reportes.js"
```

---

### Task 4: `js/reportes-ui.js` — Módulo selector, adaptive filter bar, dropdown population

**Files:**
- Create: `js/reportes-ui.js` (this task writes the file; Tasks 5-6 append to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.EVE.registrosDestaraje/registrosVentas/registrosProduccion/registrosPagos/registrosControlProduccion`; `window.EVE_CONTROL_PRODUCCION.PROCESOS`; `window.formatearPeriodo` (`js/reportes.js`, unmodified).
- Produces (on `window.EVE_REPORTES_UI`): `crearSelectorModulo()` → `HTMLSelectElement`; `crearBarraFiltros()` → `HTMLDivElement`; `reconstruirCamposFiltro(contenedor)`; `leerFiltrosComunes()` → `{ ticket, desde, hasta }`; `leerFiltrosGeneral()` → `{ ticket, desde, hasta, proveedor, material, cliente }`; `leerFiltrosControlProduccion()` → `{ ticket, desde, hasta, operador, turno, tipoProceso }`; `obtenerPeriodoActivo()` → `{ desde, hasta, etiquetaReporte: 'PERSONALIZADO', etiquetaPeriodo }`; `obtenerDatosGeneralFiltrados(periodo)` → same shape `window.obtenerDatosPeriodo` returns; `obtenerRegistrosControlProduccionFiltrados(periodo)` → `array`. Module-scoped `moduloActivo` (`'general'|'controlProduccion'`, starts `'general'`) stays unexported.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.EVE_CONTROL_PRODUCCION = { PROCESOS: { SELECCION: {}, EMPACADO: {}, MOLIENDA: {}, LAVADO: {}, PELETIZADO: {} } };
global.EVE = {
  registrosDestaraje: [{ proveedor: 'JOSE ENRIQUE', material: 'MIXTO' }],
  registrosVentas: [{ proveedor: 'CLIENTE X', material: 'PELLETS' }],
  registrosProduccion: [{ cliente: 'PRODUCCION', material: 'PELETIZADO' }],
  registrosPagos: [{ proveedor: 'JOSE ENRIQUE' }],
  registrosControlProduccion: [{ operador: 'CHRISTIAN' }]
};
global.formatearPeriodo = (d, h) => d === h ? d : \`\${d} a \${h}\`;
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){} }, dataset: {},
    children: [],
    addEventListener(){}, appendChild(){ this.children.push(arguments[0]); }, removeChild(){}, remove(){},
    setAttribute(){},
    querySelectorAll(){ return []; }, querySelector(){ return fakeElement(); },
    textContent: '', innerHTML: '', value: ''
  };
}
const valores = {};
global.document = {
  getElementById(id){ const e = fakeElement(); e.id = id; if (!(id in valores)) valores[id] = ''; Object.defineProperty(e, 'value', { get(){ return valores[id]; }, set(v){ valores[id] = v; } }); return e; },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
require('./js/reportes-ui.js');
const assert = require('assert');
const RU = window.EVE_REPORTES_UI;

const selector = RU.crearSelectorModulo();
assert.ok(selector);

const filtros = RU.crearBarraFiltros();
assert.ok(filtros);

valores['ruf-ticket'] = '9260';
valores['ruf-desde'] = '2026-04-01';
valores['ruf-hasta'] = '2026-04-30';
const comunes = RU.leerFiltrosComunes();
assert.deepStrictEqual(comunes, { ticket: '9260', desde: '2026-04-01', hasta: '2026-04-30' });

valores['ruf-proveedor'] = 'JOSE ENRIQUE';
valores['ruf-material'] = 'MIXTO';
valores['ruf-cliente'] = '';
const general = RU.leerFiltrosGeneral();
assert.deepStrictEqual(general, { ticket: '9260', desde: '2026-04-01', hasta: '2026-04-30', proveedor: 'JOSE ENRIQUE', material: 'MIXTO', cliente: '' });

const periodo = RU.obtenerPeriodoActivo();
assert.strictEqual(periodo.desde, '2026-04-01');
assert.strictEqual(periodo.hasta, '2026-04-30');
assert.strictEqual(periodo.etiquetaReporte, 'PERSONALIZADO');

console.log('REPORTES_UI_FILTROS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/reportes-ui.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/reportes-ui.js`:

```javascript
(function () {

let moduloActivo = 'general';

function valoresUnicos(valores) {
  const set = new Set();
  valores.forEach((v) => { if (v) set.add(v); });
  return Array.from(set).sort();
}

function obtenerProveedoresUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosDestaraje.map((r) => r.proveedor),
    ...window.EVE.registrosPagos.map((r) => r.proveedor)
  ]);
}

function obtenerMaterialesUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosDestaraje.map((r) => r.material),
    ...window.EVE.registrosProduccion.map((r) => r.material),
    ...window.EVE.registrosVentas.map((r) => r.material),
    ...window.EVE.registrosPagos.map((r) => r.material)
  ]);
}

function obtenerClientesUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosProduccion.map((r) => r.cliente),
    ...window.EVE.registrosVentas.map((r) => r.proveedor)
  ]);
}

function obtenerOperadoresUnicos() {
  return valoresUnicos(window.EVE.registrosControlProduccion.map((r) => r.operador));
}

function crearSelectConOpciones(id, opciones, etiquetaTodos) {
  const select = document.createElement('select');
  select.id = id;
  const opcionTodos = document.createElement('option');
  opcionTodos.value = '';
  opcionTodos.textContent = etiquetaTodos;
  select.appendChild(opcionTodos);
  opciones.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = valor;
    select.appendChild(opcion);
  });
  return select;
}

function reconstruirCamposFiltro(contenedor) {
  contenedor.innerHTML = '';
  const ticketInput = document.createElement('input');
  ticketInput.type = 'text';
  ticketInput.id = 'ruf-ticket';
  ticketInput.placeholder = 'Ticket';
  const desdeInput = document.createElement('input');
  desdeInput.type = 'date';
  desdeInput.id = 'ruf-desde';
  const hastaInput = document.createElement('input');
  hastaInput.type = 'date';
  hastaInput.id = 'ruf-hasta';
  contenedor.appendChild(ticketInput);
  contenedor.appendChild(desdeInput);
  contenedor.appendChild(hastaInput);

  if (moduloActivo === 'general') {
    contenedor.appendChild(crearSelectConOpciones('ruf-proveedor', obtenerProveedoresUnicos(), 'Todos los proveedores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-material', obtenerMaterialesUnicos(), 'Todos los materiales'));
    contenedor.appendChild(crearSelectConOpciones('ruf-cliente', obtenerClientesUnicos(), 'Todos los clientes'));
  } else {
    contenedor.appendChild(crearSelectConOpciones('ruf-operador', obtenerOperadoresUnicos(), 'Todos los operadores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-turno', ['Matutino', 'Vespertino', 'Nocturno'], 'Todos los turnos'));
    contenedor.appendChild(crearSelectConOpciones('ruf-tipoproceso', Object.keys(window.EVE_CONTROL_PRODUCCION.PROCESOS), 'Todos los procesos'));
  }
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'ru-filtros';
  div.className = 'card destaraje-filtros';
  reconstruirCamposFiltro(div);
  return div;
}

function crearSelectorModulo() {
  const select = document.createElement('select');
  select.id = 'ru-modulo';
  [['general', 'Reporte General'], ['controlProduccion', 'Control de Producción']].forEach(([valor, texto]) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = texto;
    select.appendChild(opcion);
  });
  select.addEventListener('change', () => {
    moduloActivo = select.value;
    reconstruirCamposFiltro(document.getElementById('ru-filtros'));
  });
  return select;
}

function leerFiltrosComunes() {
  return {
    ticket: document.getElementById('ruf-ticket').value,
    desde: document.getElementById('ruf-desde').value,
    hasta: document.getElementById('ruf-hasta').value
  };
}

function leerFiltrosGeneral() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    proveedor: document.getElementById('ruf-proveedor').value,
    material: document.getElementById('ruf-material').value,
    cliente: document.getElementById('ruf-cliente').value
  };
}

function leerFiltrosControlProduccion() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    operador: document.getElementById('ruf-operador').value,
    turno: document.getElementById('ruf-turno').value,
    tipoProceso: document.getElementById('ruf-tipoproceso').value
  };
}

function obtenerPeriodoActivo() {
  const comunes = leerFiltrosComunes();
  return {
    desde: comunes.desde,
    hasta: comunes.hasta,
    etiquetaReporte: 'PERSONALIZADO',
    etiquetaPeriodo: window.formatearPeriodo(comunes.desde || null, comunes.hasta || null)
  };
}

function obtenerDatosGeneralFiltrados(periodo) {
  const filtros = leerFiltrosGeneral();
  return window.obtenerDatosPeriodo(periodo.desde, periodo.hasta, {
    ticket: filtros.ticket,
    proveedor: filtros.proveedor,
    material: filtros.material,
    cliente: filtros.cliente
  });
}

function obtenerRegistrosControlProduccionFiltrados(periodo) {
  const filtros = leerFiltrosControlProduccion();
  return window.EVE.registrosControlProduccion.filter((r) => {
    const fechaFin = r.fechaFin.slice(0, 10);
    if (periodo.desde && fechaFin < periodo.desde) return false;
    if (periodo.hasta && fechaFin > periodo.hasta) return false;
    if (filtros.ticket && !String(r.ticket).toUpperCase().includes(filtros.ticket.toUpperCase())) return false;
    if (filtros.operador && r.operador !== filtros.operador) return false;
    if (filtros.turno && r.turno !== filtros.turno) return false;
    if (filtros.tipoProceso && r.tipoProceso !== filtros.tipoProceso) return false;
    return true;
  });
}

window.EVE_REPORTES_UI = {
  crearSelectorModulo,
  crearBarraFiltros,
  reconstruirCamposFiltro,
  leerFiltrosComunes,
  leerFiltrosGeneral,
  leerFiltrosControlProduccion,
  obtenerPeriodoActivo,
  obtenerDatosGeneralFiltrados,
  obtenerRegistrosControlProduccionFiltrados
};

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_UI_FILTROS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes-ui.js
git commit -m "feat: add reportes-ui.js Modulo selector, adaptive filter bar, and dropdown population"
```

---

### Task 5: `js/reportes-ui.js` — Vista Previa, export buttons, module registration

**Files:**
- Modify: `js/reportes-ui.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (full render flow against stubbed DOM/data)

**Interfaces:**
- Consumes: `moduloActivo`, `obtenerPeriodoActivo`, `obtenerDatosGeneralFiltrados`, `obtenerRegistrosControlProduccionFiltrados`, `crearSelectorModulo`, `crearBarraFiltros` (Task 4, bare identifiers); `window.generarTXT`, `window.generarPDF`, `window.construirFilasCSV`, `window.generarTXTControlProduccion`, `window.generarPDFControlProduccion`, `window.construirFilasCSVControlProduccion` (`js/reportes.js`, Tasks 1-2); `window.descargarArchivo`, `window.exportarCSV`, `window.obtenerFechaMexico` (`js/utils.js`); `window.EVE_MODULES` (`js/auth.js`).
- Produces: `window.EVE_MODULES.reportes = { render(container) }` — the contract `js/auth.js`'s `renderModulo` already calls.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.EVE_MODULES = {};
global.EVE_CONTROL_PRODUCCION = { PROCESOS: { SELECCION: {}, EMPACADO: {}, MOLIENDA: {}, LAVADO: {}, PELETIZADO: {} } };
global.EVE = {
  registrosDestaraje: [], registrosVentas: [], registrosProduccion: [],
  registrosPagos: [], registrosControlProduccion: []
};
global.formatearPeriodo = () => 'TODOS LOS REGISTROS';
global.obtenerDatosPeriodo = () => ({ destaraje: [], ventas: [], produccion: [], pagos: [] });
global.generarTXT = () => 'texto general';
global.generarPDF = () => ({ save(){} });
global.construirFilasCSV = () => [];
global.generarTXTControlProduccion = () => 'texto cp';
global.generarPDFControlProduccion = () => ({ save(){} });
global.construirFilasCSVControlProduccion = () => [];
global.descargarArchivo = () => {};
global.exportarCSV = () => {};
global.obtenerFechaMexico = () => '2026-06-24';
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){} }, dataset: {},
    children: [],
    addEventListener(){}, appendChild(){ this.children.push(arguments[0]); }, removeChild(){}, remove(){},
    setAttribute(){},
    querySelectorAll(){ return []; }, querySelector(){ return fakeElement(); },
    textContent: '', innerHTML: '', value: ''
  };
}
global.document = {
  getElementById(){ return fakeElement(); },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
require('./js/reportes-ui.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_MODULES.reportes.render, 'function');
window.EVE_MODULES.reportes.render(fakeElement());
window.EVE_REPORTES_UI.mostrarVistaPrevia();
console.log('REPORTES_UI_MODULE_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: a thrown `TypeError` — `window.EVE_MODULES.reportes` is `undefined` because Task 4 never registers it.

- [ ] **Step 3: Insert the implementation**

In `js/reportes-ui.js`, find this anchor:

```javascript
window.EVE_REPORTES_UI = {
  crearSelectorModulo,
  crearBarraFiltros,
  reconstruirCamposFiltro,
  leerFiltrosComunes,
  leerFiltrosGeneral,
  leerFiltrosControlProduccion,
  obtenerPeriodoActivo,
  obtenerDatosGeneralFiltrados,
  obtenerRegistrosControlProduccionFiltrados
};

})();
```

Replace it with:

```javascript
window.EVE_REPORTES_UI = {
  crearSelectorModulo,
  crearBarraFiltros,
  reconstruirCamposFiltro,
  leerFiltrosComunes,
  leerFiltrosGeneral,
  leerFiltrosControlProduccion,
  obtenerPeriodoActivo,
  obtenerDatosGeneralFiltrados,
  obtenerRegistrosControlProduccionFiltrados
};

function obtenerTextoYNombre(periodo, extension) {
  if (moduloActivo === 'general') {
    return {
      texto: window.generarTXT(obtenerDatosGeneralFiltrados(periodo), periodo),
      nombre: `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  return {
    texto: window.generarTXTControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo), periodo),
    nombre: `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.${extension}`
  };
}

function mostrarVistaPrevia() {
  const periodo = obtenerPeriodoActivo();
  const { texto } = obtenerTextoYNombre(periodo, 'txt');
  document.getElementById('ru-preview-texto').textContent = texto;
  document.getElementById('ru-preview-card').style.display = '';
}

function ocultarVistaPrevia() {
  document.getElementById('ru-preview-card').style.display = 'none';
}

function manejarExportarTXT() {
  const periodo = obtenerPeriodoActivo();
  const { texto, nombre } = obtenerTextoYNombre(periodo, 'txt');
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, nombre);
}

function manejarExportarPDF() {
  const periodo = obtenerPeriodoActivo();
  let doc, nombre;
  if (moduloActivo === 'general') {
    doc = window.generarPDF(obtenerDatosGeneralFiltrados(periodo), periodo);
    nombre = `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`;
  } else {
    doc = window.generarPDFControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo), periodo);
    nombre = `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`;
  }
  doc.save(nombre);
}

function manejarExportarCSV() {
  const periodo = obtenerPeriodoActivo();
  let filas, nombre;
  if (moduloActivo === 'general') {
    filas = window.construirFilasCSV(obtenerDatosGeneralFiltrados(periodo));
    nombre = `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`;
  } else {
    filas = window.construirFilasCSVControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo));
    nombre = `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`;
  }
  window.exportarCSV(filas, nombre);
}

function crearTarjetaVistaPrevia() {
  const tarjeta = document.createElement('div');
  tarjeta.id = 'ru-preview-card';
  tarjeta.className = 'card';
  tarjeta.style.display = 'none';
  tarjeta.innerHTML = `
    <pre id="ru-preview-texto"></pre>
    <button type="button" id="ru-cerrar-preview" class="btn-secondary">✕ Cerrar Vista Previa</button>
  `;
  tarjeta.querySelector('#ru-cerrar-preview').addEventListener('click', ocultarVistaPrevia);
  return tarjeta;
}

function crearBotonesAccion() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonVistaPrevia = document.createElement('button');
  botonVistaPrevia.type = 'button';
  botonVistaPrevia.textContent = '🔍 Vista Previa';
  botonVistaPrevia.className = 'btn-primary';
  botonVistaPrevia.addEventListener('click', mostrarVistaPrevia);
  const botonLimpiar = document.createElement('button');
  botonLimpiar.type = 'button';
  botonLimpiar.textContent = '🔄 Limpiar';
  botonLimpiar.className = 'btn-secondary';
  botonLimpiar.addEventListener('click', () => {
    reconstruirCamposFiltro(document.getElementById('ru-filtros'));
    ocultarVistaPrevia();
  });
  div.appendChild(botonVistaPrevia);
  div.appendChild(botonLimpiar);
  return div;
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonTXT = document.createElement('button');
  botonTXT.textContent = 'TXT';
  botonTXT.className = 'btn-secondary';
  botonTXT.addEventListener('click', manejarExportarTXT);
  const botonPDF = document.createElement('button');
  botonPDF.textContent = 'PDF';
  botonPDF.className = 'btn-secondary';
  botonPDF.addEventListener('click', manejarExportarPDF);
  const botonCSV = document.createElement('button');
  botonCSV.textContent = 'CSV';
  botonCSV.className = 'btn-secondary';
  botonCSV.addEventListener('click', manejarExportarCSV);
  div.appendChild(botonTXT);
  div.appendChild(botonPDF);
  div.appendChild(botonCSV);
  return div;
}

function renderReportesUI(container) {
  moduloActivo = 'general';
  container.appendChild(crearSelectorModulo());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearBotonesAccion());
  container.appendChild(crearTarjetaVistaPrevia());
  container.appendChild(crearBotonesExportar());
}

window.EVE_MODULES.reportes = { render: renderReportesUI };

Object.assign(window.EVE_REPORTES_UI, {
  mostrarVistaPrevia,
  ocultarVistaPrevia
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_UI_MODULE_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes-ui.js
git commit -m "feat: add reportes-ui.js Vista Previa, export buttons, and module registration"
```

---

### Task 6: `js/reportes-ui.js` — Telegram button

**Files:**
- Modify: `js/reportes-ui.js`
- Test: inline `node -e` smoke check (async, mocks `window.enviarReporteTelegram`)

**Interfaces:**
- Consumes: `obtenerPeriodoActivo` (Task 4, bare identifier); `window.enviarReporteTelegram` (`js/reportes.js`, Task 3); `window.showSuccess`, `window.showError` (`js/utils.js`).
- Produces: `crearBotonesExportar()` (Task 5) gains a 4th button; new `manejarEnviarTelegram()` handler, added to `window.EVE_REPORTES_UI` via `Object.assign`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
(async () => {
global.window = global;
global.EVE_MODULES = {};
global.EVE_CONTROL_PRODUCCION = { PROCESOS: { SELECCION: {}, EMPACADO: {}, MOLIENDA: {}, LAVADO: {}, PELETIZADO: {} } };
global.EVE = { registrosDestaraje: [], registrosVentas: [], registrosProduccion: [], registrosPagos: [], registrosControlProduccion: [] };
global.formatearPeriodo = () => 'TODOS LOS REGISTROS';
global.obtenerDatosPeriodo = () => ({ destaraje: [], ventas: [], produccion: [], pagos: [] });
global.generarTXT = () => 'x'; global.generarPDF = () => ({ save(){} }); global.construirFilasCSV = () => [];
global.generarTXTControlProduccion = () => 'x'; global.generarPDFControlProduccion = () => ({ save(){} }); global.construirFilasCSVControlProduccion = () => [];
global.descargarArchivo = () => {}; global.exportarCSV = () => {}; global.obtenerFechaMexico = () => '2026-06-24';
let mensajesError = [];
let mensajesExito = [];
global.showError = (m) => mensajesError.push(m);
global.showSuccess = (m) => mensajesExito.push(m);
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){} }, dataset: {},
    children: [],
    addEventListener(){}, appendChild(){ this.children.push(arguments[0]); }, removeChild(){}, remove(){},
    setAttribute(){},
    querySelectorAll(){ return []; }, querySelector(){ return fakeElement(); },
    textContent: '', innerHTML: '', value: ''
  };
}
global.document = {
  getElementById(){ return fakeElement(); },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
require('./js/reportes-ui.js');
const assert = require('assert');

global.enviarReporteTelegram = async () => { throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)'); };
await window.EVE_REPORTES_UI.manejarEnviarTelegram();
assert.strictEqual(mensajesError.length, 1);
assert.ok(mensajesError[0].includes('Configura el token'));

global.enviarReporteTelegram = async () => ({ ok: true });
await window.EVE_REPORTES_UI.manejarEnviarTelegram();
assert.strictEqual(mensajesExito.length, 1);

const container = fakeElement();
window.EVE_MODULES.reportes.render(container);

console.log('REPORTES_UI_TELEGRAM_OK');
})().catch((e) => { console.error(e); process.exit(1); });
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.EVE_REPORTES_UI.manejarEnviarTelegram is not a function`.

- [ ] **Step 3: Insert the implementation**

In `js/reportes-ui.js`, find this anchor:

```javascript
function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonTXT = document.createElement('button');
  botonTXT.textContent = 'TXT';
  botonTXT.className = 'btn-secondary';
  botonTXT.addEventListener('click', manejarExportarTXT);
  const botonPDF = document.createElement('button');
  botonPDF.textContent = 'PDF';
  botonPDF.className = 'btn-secondary';
  botonPDF.addEventListener('click', manejarExportarPDF);
  const botonCSV = document.createElement('button');
  botonCSV.textContent = 'CSV';
  botonCSV.className = 'btn-secondary';
  botonCSV.addEventListener('click', manejarExportarCSV);
  div.appendChild(botonTXT);
  div.appendChild(botonPDF);
  div.appendChild(botonCSV);
  return div;
}
```

Replace it with:

```javascript
async function manejarEnviarTelegram() {
  const periodo = obtenerPeriodoActivo();
  try {
    await window.enviarReporteTelegram(periodo);
    window.showSuccess('Reporte enviado a Telegram');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonTXT = document.createElement('button');
  botonTXT.textContent = 'TXT';
  botonTXT.className = 'btn-secondary';
  botonTXT.addEventListener('click', manejarExportarTXT);
  const botonPDF = document.createElement('button');
  botonPDF.textContent = 'PDF';
  botonPDF.className = 'btn-secondary';
  botonPDF.addEventListener('click', manejarExportarPDF);
  const botonCSV = document.createElement('button');
  botonCSV.textContent = 'CSV';
  botonCSV.className = 'btn-secondary';
  botonCSV.addEventListener('click', manejarExportarCSV);
  const botonTelegram = document.createElement('button');
  botonTelegram.textContent = '📤 Telegram';
  botonTelegram.className = 'btn-secondary';
  botonTelegram.addEventListener('click', manejarEnviarTelegram);
  div.appendChild(botonTXT);
  div.appendChild(botonPDF);
  div.appendChild(botonCSV);
  div.appendChild(botonTelegram);
  return div;
}
```

Find this anchor:

```javascript
Object.assign(window.EVE_REPORTES_UI, {
  mostrarVistaPrevia,
  ocultarVistaPrevia
});

})();
```

Replace it with:

```javascript
Object.assign(window.EVE_REPORTES_UI, {
  mostrarVistaPrevia,
  ocultarVistaPrevia,
  manejarEnviarTelegram
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `REPORTES_UI_TELEGRAM_OK`

- [ ] **Step 5: Commit**

```bash
git add js/reportes-ui.js
git commit -m "feat: add Telegram button to reportes-ui.js"
```

---

### Task 7: Wire `index.html` + CSS + live Firebase check

**Files:**
- Modify: `index.html` (add one `<script>` tag)
- Modify: `css/styles.css` (Módulo selector spacing, Vista Previa `<pre>` styling)
- Test: Playwright script run via `node` (ephemeral, not committed differently from prior phases)

**Interfaces:**
- Consumes: `js/reportes-ui.js` (Tasks 4-6), `js/reportes.js` (Tasks 1-3), the real Firestore collections in the `everplastic` project, `docs/superpowers/credenciales-phase2.json` (already gitignored, reused from Phase 2).
- Produces: confirmation that Phase 7's acceptance criteria hold.

**Critical safety rule for this task, specific to Telegram:** clicking the
"📤 Telegram" button has a real, external, irreversible side effect —
sending an actual message (and PDF) to a real chat — *if* `config/telegram`
is seeded with real credentials. The automated live-verification script in
this task **must never click that button** — it only confirms the button
exists and is wired, and separately checks (read-only) whether
`config/telegram` exists. Actually triggering a real send is a manual,
explicitly-confirmed follow-up step (Step 6 below), never baked into the
unattended script.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q 'src="js/reportes-ui.js"' index.html && echo "WIRING_OK"
```

Expected: no `WIRING_OK` printed.

- [ ] **Step 2: Modify `index.html`**

Change:

```html
  <script src="js/trazabilidad.js"></script>
  <script src="js/control-produccion.js"></script>
</body>
</html>
```

to:

```html
  <script src="js/trazabilidad.js"></script>
  <script src="js/control-produccion.js"></script>
  <script src="js/reportes-ui.js"></script>
</body>
</html>
```

Run the exact command from Step 1 again. Expected output: `WIRING_OK`. Commit:

```bash
git add index.html
git commit -m "feat: wire reportes-ui.js into index.html"
```

- [ ] **Step 3: Add the new CSS**

In `css/styles.css`, append at the end of the file:

```css

/* ===== Reportes UI ===== */

#ru-modulo {
  margin-bottom: 1rem;
  padding: 0.5rem;
  border: 1px solid var(--gris-claro);
  border-radius: var(--radio);
}

#ru-preview-card {
  margin-bottom: 1rem;
  overflow-x: auto;
}

#ru-preview-texto {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.85rem;
  white-space: pre-wrap;
  margin-bottom: 1rem;
}
```

Commit:

```bash
git add css/styles.css
git commit -m "feat: add CSS for Reportes UI Modulo selector and Vista Previa"
```

- [ ] **Step 4: Write and run the live-Firebase Playwright check**

Create `docs/superpowers/verify-phase7.js`:

```javascript
const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');

  await page.click('#tabs-container .tab:has-text("Reportes")');
  await page.waitForSelector('#ru-modulo');

  console.log('FILTROS_GENERAL_OK:', await page.locator('#ruf-proveedor').count() === 1 && await page.locator('#ruf-operador').count() === 0);

  await page.selectOption('#ru-modulo', 'controlProduccion');
  console.log('FILTROS_CP_OK:', await page.locator('#ruf-operador').count() === 1 && await page.locator('#ruf-proveedor').count() === 0);

  await page.click('button:has-text("🔍 Vista Previa")');
  const textoCp = await page.locator('#ru-preview-texto').textContent();
  console.log('PREVIEW_CP_OK:', textoCp.includes('CONTROL DE PRODUCCIÓN'));
  await page.click('#ru-cerrar-preview');
  console.log('CERRAR_PREVIEW_OK:', (await page.locator('#ru-preview-card').isVisible()) === false);

  const [descargaCpTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  console.log('EXPORT_CP_TXT_OK:', !!(await descargaCpTxt.path()));

  const [descargaCpPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  console.log('EXPORT_CP_PDF_OK:', !!(await descargaCpPdf.path()));

  const [descargaCpCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  console.log('EXPORT_CP_CSV_OK:', !!(await descargaCpCsv.path()));

  await page.selectOption('#ru-modulo', 'general');
  await page.waitForSelector('#ruf-proveedor');

  await page.click('button:has-text("🔍 Vista Previa")');
  const textoGeneral = await page.locator('#ru-preview-texto').textContent();
  console.log('PREVIEW_GENERAL_OK:', textoGeneral.includes('DESTARAJE GENERAL'));
  await page.click('#ru-cerrar-preview');

  // Filtro real: usar el primer proveedor real del dropdown, si existe
  const opcionesProveedor = await page.locator('#ruf-proveedor option').allTextContents();
  if (opcionesProveedor.length > 1) {
    const primerProveedorReal = opcionesProveedor[1];
    await page.selectOption('#ruf-proveedor', { label: primerProveedorReal });
    await page.click('button:has-text("🔍 Vista Previa")');
    const textoFiltrado = await page.locator('#ru-preview-texto').textContent();
    console.log('FILTRO_PROVEEDOR_OK:', textoFiltrado.includes(primerProveedorReal));
    await page.click('#ru-cerrar-preview');
    await page.selectOption('#ruf-proveedor', { label: opcionesProveedor[0] });
  } else {
    console.log('FILTRO_PROVEEDOR_OMITIDO_SIN_DATOS_REALES');
  }

  const [descargaTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  console.log('EXPORT_GENERAL_TXT_OK:', !!(await descargaTxt.path()));

  const [descargaPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  console.log('EXPORT_GENERAL_PDF_OK:', !!(await descargaPdf.path()));

  const [descargaCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  console.log('EXPORT_GENERAL_CSV_OK:', !!(await descargaCsv.path()));

  // Boton de Telegram: solo confirmar que existe. NUNCA hacer clic aqui --
  // un clic real envia un mensaje real si config/telegram ya esta sembrado.
  console.log('BOTON_TELEGRAM_EXISTE_OK:', await page.locator('button:has-text("📤 Telegram")').count() === 1);

  const tieneConfigTelegram = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists;
  });
  console.log('CONFIG_TELEGRAM_SEMBRADA:', tieneConfigTelegram);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

Run:

```bash
cd "eve-control-v2"
(python -m http.server 8765 >/tmp/eve-server.log 2>&1 &)
sleep 1
node docs/superpowers/verify-phase7.js
```

Expected output (with `FILTRO_PROVEEDOR_OK`/`_OMITIDO` and
`CONFIG_TELEGRAM_SEMBRADA` depending on what real data already exists in
the `everplastic` project):
```
FILTROS_GENERAL_OK: true
FILTROS_CP_OK: true
PREVIEW_CP_OK: true
CERRAR_PREVIEW_OK: true
EXPORT_CP_TXT_OK: true
EXPORT_CP_PDF_OK: true
EXPORT_CP_CSV_OK: true
PREVIEW_GENERAL_OK: true
FILTRO_PROVEEDOR_OK: true
EXPORT_GENERAL_TXT_OK: true
EXPORT_GENERAL_PDF_OK: true
EXPORT_GENERAL_CSV_OK: true
BOTON_TELEGRAM_EXISTE_OK: true
CONFIG_TELEGRAM_SEMBRADA: false
CONSOLE_ERRORS: []
```

If `CONSOLE_ERRORS` is non-empty or any assertion is false, stop and
report — don't guess at a fix blindly. This script reads real production
data (no writes, no deletes) — there is no cleanup step, since nothing in
this task creates or mutates any Firestore document.

- [ ] **Step 5: Commit the verification script**

```bash
git add docs/superpowers/verify-phase7.js
git commit -m "test: add live-Firebase Playwright check for Phase 7 Reportes UI"
```

- [ ] **Step 6 (manual, optional, requires explicit confirmation — not part of automated verification): seed `config/telegram` and test a real send**

This step is **out of the automated test loop on purpose** — it sends a
real message to a real Telegram chat. Only do this with the user's
explicit go-ahead, separately from running Step 4's script.

If the user wants to test the real send, seed the config document first
(replace `TU_TOKEN_REAL` / `TU_CHAT_ID_REAL` with the actual bot token and
chat ID — never commit these values anywhere):

```bash
node -e "
const { chromium } = require('playwright');
const CREDENCIALES = require('./docs/superpowers/credenciales-phase2.json');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type=\"submit\"]');
  await page.waitForFunction(() => window.db);
  await page.evaluate(async () => {
    await window.db.collection('config').doc('telegram').set({ token: 'TU_TOKEN_REAL', chatId: 'TU_CHAT_ID_REAL' });
  });
  console.log('CONFIG_TELEGRAM_SEMBRADA_OK');
  await browser.close();
})();
"
```

Then, with the user's explicit confirmation immediately before clicking,
open the app in a real browser (or drive one click via Playwright),
go to Reportes, and click "📤 Telegram" once. Confirm in the actual
Telegram chat that the message and PDF arrived.

---

## Self-Review Notes

- **Spec coverage:** the optional, backward-compatible `obtenerDatosPeriodo` extension and its `proveedor`-vs-`cliente`-vs-`material` semantics (Global Constraints; Task 1) — covered. Control de Producción's report generators reusing `calcularStats`/`PROCESOS` rather than duplicating them (Task 2) — covered. `agregarPagadoPorProveedor`, the always-5-section Telegram message ignoring every filter except dates, the General-PDF attachment, and the clear-error-on-missing-config rule (Task 3) — covered. The Módulo selector, the filter bar that rebuilds per Módulo, exact-match `<select>` dropdowns sourced from real Firestore values (Task 4) — covered. Text-based Vista Previa and TXT/PDF/CSV export for both Módulos (Task 5) — covered. The Telegram button itself (Task 6) — covered. "Fuera de alcance" items (no Panel Admin, no changes to `destaraje.js`/`produccion.js`/`pagos.js`/`control-produccion.js`/`trazabilidad.js`/`voz.js`/`auth.js`, no scheduled/automatic sending) — no task adds any of that scope.
- **Deliberate divergence from the design spec's literal acceptance criterion, for safety — flagged here rather than buried:** the spec's acceptance criterion says the live Playwright check should "probar el botón de Telegram y confirmar que la API respondió `ok: true`" if `config/telegram` is seeded. This plan's Task 7 does **not** do that in the automated script — clicking the button has a real, externally-visible, irreversible side effect (sending an actual message to a real chat) the instant `config/telegram` holds real credentials, and an unattended verification script should never risk that on its own. Task 7 instead verifies the button exists/is wired and reports (read-only) whether `config/telegram` is seeded, then documents an explicit, separately-confirmed manual step (Step 6) for the real send. The actual message-construction and Telegram-API-call logic is still fully covered by Task 3's Node tests (including a simulated successful send and a simulated missing-config error), so the only thing deferred to a manual step is the one real, external, side-effecting action itself.
- **Placeholder scan:** none — every step has complete code and exact commands/expected output.
- **Namespace check:** `window.EVE_REPORTES_UI` is created once (Task 4) and extended twice via `Object.assign` (Tasks 5, 6) — all keys from every task present in the final file (cross-checked: 9 keys from Task 4; `mostrarVistaPrevia`/`ocultarVistaPrevia` from Task 5; `manejarEnviarTelegram` from Task 6). `window.EVE_MODULES.reportes` uses its own object key — no collision with `destaraje`/`produccion`/`pagos`/`controlProduccion`. `js/reportes.js`'s new exports (Tasks 1-3) are added as individual `window.X = ...` lines, matching that file's own pre-existing style — deliberately not converted to a namespace object, since this plan only extends an already-merged file and a stylistic rewrite of its existing exports is out of scope and would risk an unrelated regression.
- **Backward-compatibility check (this plan's main new risk, since it modifies an already-merged, widely-consumed file):** `obtenerDatosPeriodo`'s third parameter is optional and every existing call site across `destaraje.js`/`produccion.js`/`pagos.js`/`control-produccion.js` (via `exportarReporteTXT/PDF/CSV`) passes exactly 2 arguments — confirmed by Task 1's Node test asserting identical filtered counts with and without the third argument on the same fixture data.
- **XSS check:** the Vista Previa `<pre>`'s content is set via `.textContent` (Task 5), never `innerHTML`, even though the text itself is multi-line — `.textContent` preserves newlines correctly in a `<pre>` element without needing HTML interpretation. `crearBarraFiltros`/`crearSelectConOpciones` (Task 4) build `<option>` elements via `.textContent`/`.value` for every Firestore-derived value (the unique proveedor/material/cliente/operador lists) — never `innerHTML` interpolation. The two `innerHTML` uses in this plan (`crearTarjetaVistaPrevia`'s static skeleton in Task 5) have zero interpolated variables.
- **Type/interface consistency:** every bare identifier one task consumes from an earlier task in the same file (Task 5 consuming Task 4's `moduloActivo`/`obtenerPeriodoActivo`/`obtenerDatosGeneralFiltrados`/`obtenerRegistrosControlProduccionFiltrados`/`crearSelectorModulo`/`crearBarraFiltros`/`reconstruirCamposFiltro`; Task 6 consuming Task 4's `obtenerPeriodoActivo` and modifying Task 5's `crearBotonesExportar` via an anchor that matches Task 5's code byte-for-byte) was cross-checked name-by-name while writing this plan. `window.EVE_MODULES.reportes.render` matches the exact contract `js/auth.js`'s `renderModulo` expects, identical in shape to every prior module's registration.