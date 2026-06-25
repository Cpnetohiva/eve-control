# Fase 8b — Panel Admin: Importación de Datos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Importar Datos" sub-tab in the Panel Admin: download an Excel template (3 sheets), upload a file, see a row-by-row validated preview, and import in either Agregar (additive) or Reemplazar todo (destructive, requires typing "CONFIRMAR") mode.

**Architecture:** One new file, `js/admin-importar.js`, built bottom-up: pure date helpers → row validation that calls the *already-existing* validators in `destaraje.js`/`produccion.js`/`pagos.js` (never duplicates their business rules) → sheet-level aggregation → thin XLSX-library glue (template generation, file parsing) → the DOM/preview/write layer. `js/admin.js` (Fase 8a) gains a second sub-tab, unchanged otherwise.

**Tech Stack:** Vanilla JS, `XLSX` global (already loaded via CDN script tag in `index.html` since Fase 1 — no new dependency), Firebase Firestore `db.batch()` for bulk writes, Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-25-importacion-datos-design.md`.
- Excel template: 3 sheets named exactly `Destaraje`, `Produccion`, `Pagos` (no accent in the *sheet name*, to dodge encoding issues — column headers do use accents where natural).
  - Destaraje columns: `Ticket | Proveedor | Material | Kg | Fecha Entrada | Fecha Salida`
  - Produccion columns: `Ticket | Cliente | Material | Kg | Fecha Entrada | Fecha Salida`
  - Pagos columns: `Ticket | Proveedor | Material | Kg | Precio/Kg | Total | Pagado | Fecha`
- **Dates must be literal text `DD-MM-AAAA`** (e.g. `24-06-2026`) — this is a standing project convention, not new. Any other format (including a cell Excel auto-converted to its own date type) is a row-level validation error with the exact message `'Fecha debe tener el formato DD-MM-AAAA'`. Valid dates convert to `AAAA-MM-DD` (Firestore's internal format) before being handed to any validator — never stored as `DD-MM-AAAA`.
- **Row validation reuses the existing validators, never re-implements their rules:**
  - Destaraje → `window.construirRegistroDesdeFormulario` (bare global, from `js/destaraje.js`).
  - Producción → `window.construirRegistroDesdeFormularioProduccion` (bare global, suffixed, from `js/produccion.js`).
  - Pagos → `window.EVE_PAGOS.construirRegistroDesdeFormulario` (namespaced, from `js/pagos.js`).
  Each of these `throw`s an `Error` with a Spanish message on invalid input — that `.message` is the row's validation-failure reason in the preview.
- Producción's "Ticket" column is always ignored; the built record's `ticket` is always the constant `'P'` (the existing validator doesn't even accept a ticket parameter).
- Pagos' "Total" column is always ignored; `total` is always recomputed as `kg * precioPorKg` inside the existing validator (same "never trust a display field" rule established in Fase 5).
- `proveedor`/`material`/`cliente` values are uppercased before being passed to the validators — matches what every existing create/edit form already does (`js/destaraje.js:161-162`, `js/produccion.js:123-124`, `js/pagos.js:166-167`) — so imported data looks identical to manually-entered data.
- Blank rows (every cell empty after `defval: ''`) are silently skipped — never counted as invalid, never shown in the preview.
- **Reemplazar todo**: per sheet, only sheets with **at least one valid row** get their existing Firestore data deleted before the new rows are inserted. A sheet with zero valid rows (empty, or every row invalid) leaves its module's existing data untouched.
- Writes (deletes + inserts) are batched via `window.db.batch()`, chunked to a maximum of 500 operations per batch (Firestore's hard limit).
- Reemplazar mode requires the user to type exactly `CONFIRMAR` into a dedicated text field before the "Confirmar importación" button is enabled. Agregar mode requires no extra confirmation beyond the button itself.
- The "Confirmar importación" button is disabled for the duration of the in-flight `manejarConfirmarImportacion` call (re-evaluated via `actualizarBotonConfirmar()` on both the success and failure paths) — this addresses the double-submit/duplicate-insert risk flagged forward-looking in the Fase 8a final review, ahead of this exact feature.
- Namespace rule: `window.EVE_ADMIN_IMPORTAR` is built once as an object literal, extended only via `Object.assign` in later tasks.
- XSS rule (same as every prior module): any Firestore-/Excel-derived value reaching the DOM uses `.textContent`/`.value`, never `innerHTML` string interpolation.
- No changes to `js/destaraje.js`, `js/produccion.js`, `js/pagos.js`, `js/admin-usuarios.js`, `js/auth.js` — this phase only consumes their already-public functions.

---

## File Structure

```
eve-control-v2/
├── index.html                  (Task 6 — add <script> tag for admin-importar.js, before admin.js)
├── css/
│   └── styles.css              (Task 6 — new classes for the import card, mode toggle, preview table)
├── js/
│   ├── admin-importar.js       (Tasks 1-5, new)
│   └── admin.js                (Task 6 — modify: add "Importar Datos" sub-tab)
└── docs/superpowers/
    └── verify-phase8b.js       (Task 6, new — live Playwright check)
```

Build order: date helpers (Task 1) have zero dependencies. Row validation (Task 2) depends only on Task 1 plus the three *already-merged* external validators. Sheet-level aggregation (Task 3) depends only on Task 2's per-row shape. The XLSX-library glue (Task 4) is independent of Tasks 1-3 and is the only place the `XLSX` global is touched — kept thin and deliberately untested in Node (consistent with this project's existing pattern for third-party-library glue, e.g. jsPDF in `reportes.js`), verified instead by Task 6's live script. The DOM/write layer (Task 5) ties Tasks 1-4 together. Task 6 wires everything into the app and is the only task that runs in a real browser against real Firestore.

---

### Task 1: `js/admin-importar.js` — date format helpers

**Files:**
- Create: `js/admin-importar.js` (this task writes the file; Tasks 2-5 append to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: nothing — pure functions.
- Produces (on `window.EVE_ADMIN_IMPORTAR`): `validarFormatoFecha(texto)` → `boolean` (true only for a literal `DD-MM-AAAA` string representing a real calendar date — rejects out-of-range days/months and non-existent dates like Feb 30); `convertirFechaAISO(texto)` → `string` (`'AAAA-MM-DD'`; only ever called after `validarFormatoFecha` returned `true`).

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
require('./js/admin-importar.js');
const assert = require('assert');
const AI = window.EVE_ADMIN_IMPORTAR;

assert.strictEqual(AI.validarFormatoFecha('24-06-2026'), true);
assert.strictEqual(AI.validarFormatoFecha('2026-06-24'), false);
assert.strictEqual(AI.validarFormatoFecha('24/06/2026'), false);
assert.strictEqual(AI.validarFormatoFecha('32-06-2026'), false);
assert.strictEqual(AI.validarFormatoFecha('30-02-2026'), false);
assert.strictEqual(AI.validarFormatoFecha('29-02-2024'), true);
assert.strictEqual(AI.validarFormatoFecha(''), false);
assert.strictEqual(AI.validarFormatoFecha(null), false);
assert.strictEqual(AI.validarFormatoFecha('00-06-2026'), false);
assert.strictEqual(AI.validarFormatoFecha('24-00-2026'), false);

assert.strictEqual(AI.convertirFechaAISO('24-06-2026'), '2026-06-24');
assert.strictEqual(AI.convertirFechaAISO('01-12-2025'), '2025-12-01');

console.log('ADMIN_IMPORTAR_FECHAS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/admin-importar.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/admin-importar.js`:

```javascript
(function () {

function validarFormatoFecha(texto) {
  if (typeof texto !== 'string') return false;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto.trim());
  if (!match) return false;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
}

function convertirFechaAISO(texto) {
  const [dia, mes, anio] = texto.trim().split('-');
  return `${anio}-${mes}-${dia}`;
}

window.EVE_ADMIN_IMPORTAR = {
  validarFormatoFecha,
  convertirFechaAISO
};

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_IMPORTAR_FECHAS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-importar.js
git commit -m "feat: add admin-importar.js date format helpers"
```

---

### Task 2: `js/admin-importar.js` — per-row validation reusing existing validators

**Files:**
- Modify: `js/admin-importar.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (requires the **real** `js/destaraje.js`, `js/produccion.js`, `js/pagos.js`)

**Interfaces:**
- Consumes: `validarFormatoFecha`, `convertirFechaAISO` (Task 1, same file, bare identifiers); `window.construirRegistroDesdeFormulario` (`js/destaraje.js`); `window.construirRegistroDesdeFormularioProduccion` (`js/produccion.js`); `window.EVE_PAGOS.construirRegistroDesdeFormulario` (`js/pagos.js`).
- Produces (added to `window.EVE_ADMIN_IMPORTAR`): `esFilaVacia(fila)` → `boolean`; `procesarFilaDestaraje(fila)`, `procesarFilaProduccion(fila)`, `procesarFilaPagos(fila)` → each returns `{ valido: boolean, motivo: string|null, registro: object|null, original: object }`, where `fila` is a plain object shaped like what `XLSX.utils.sheet_to_json(hoja, { defval: '' })` produces (keys are the exact column headers from the Global Constraints).

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = [];
global.EVE_MODULES = {};
require('./js/destaraje.js');
require('./js/produccion.js');
require('./js/pagos.js');
require('./js/admin-importar.js');
const assert = require('assert');
const AI = window.EVE_ADMIN_IMPORTAR;

assert.strictEqual(AI.esFilaVacia({ Ticket: '', Proveedor: '', Material: '', Kg: '', 'Fecha Entrada': '', 'Fecha Salida': '' }), true);
assert.strictEqual(AI.esFilaVacia({ Ticket: '9260', Proveedor: '', Material: '', Kg: '', 'Fecha Entrada': '', 'Fecha Salida': '' }), false);

const destarajeValida = AI.procesarFilaDestaraje({
  Ticket: '9260', Proveedor: 'jose enrique', Material: 'mixto', Kg: 1000,
  'Fecha Entrada': '23-06-2026', 'Fecha Salida': '24-06-2026'
});
assert.strictEqual(destarajeValida.valido, true);
assert.strictEqual(destarajeValida.registro.proveedor, 'JOSE ENRIQUE');
assert.strictEqual(destarajeValida.registro.material, 'MIXTO');
assert.strictEqual(destarajeValida.registro.fechaEntrada, '2026-06-23');
assert.strictEqual(destarajeValida.registro.fechaSalida, '2026-06-24');
assert.strictEqual(destarajeValida.motivo, null);

const destarajeFechaMala = AI.procesarFilaDestaraje({
  Ticket: '9260', Proveedor: 'JOSE', Material: 'MIXTO', Kg: 1000,
  'Fecha Entrada': '2026-06-23', 'Fecha Salida': '24-06-2026'
});
assert.strictEqual(destarajeFechaMala.valido, false);
assert.strictEqual(destarajeFechaMala.motivo, 'Fecha debe tener el formato DD-MM-AAAA');
assert.strictEqual(destarajeFechaMala.registro, null);

const destarajeKgMalo = AI.procesarFilaDestaraje({
  Ticket: '9260', Proveedor: 'JOSE', Material: 'MIXTO', Kg: -5,
  'Fecha Entrada': '23-06-2026', 'Fecha Salida': '24-06-2026'
});
assert.strictEqual(destarajeKgMalo.valido, false);
assert.strictEqual(destarajeKgMalo.motivo, 'Kg debe ser un número mayor a 0');

const ventaDestaraje = AI.procesarFilaDestaraje({
  Ticket: 'V', Proveedor: 'cliente x', Material: 'pellets', Kg: 900,
  'Fecha Entrada': '23-06-2026', 'Fecha Salida': '24-06-2026'
});
assert.strictEqual(ventaDestaraje.valido, true);
assert.strictEqual(ventaDestaraje.registro.ticket, 'V');

const produccionValida = AI.procesarFilaProduccion({
  Ticket: 'lo-que-sea', Cliente: 'cliente x', Material: 'pellets', Kg: 500,
  'Fecha Entrada': '01-06-2026', 'Fecha Salida': '02-06-2026'
});
assert.strictEqual(produccionValida.valido, true);
assert.strictEqual(produccionValida.registro.ticket, 'P');
assert.strictEqual(produccionValida.registro.cliente, 'CLIENTE X');

const pagosValida = AI.procesarFilaPagos({
  Ticket: '9260', Proveedor: 'jose', Material: 'mixto', Kg: 1000,
  'Precio/Kg': 5, Total: 999999, Pagado: 4000, Fecha: '24-06-2026'
});
assert.strictEqual(pagosValida.valido, true);
assert.strictEqual(pagosValida.registro.total, 5000);
assert.strictEqual(pagosValida.registro.pagado, 4000);

const pagosPrecioMalo = AI.procesarFilaPagos({
  Ticket: '9260', Proveedor: 'jose', Material: 'mixto', Kg: 1000,
  'Precio/Kg': 0, Total: 0, Pagado: 0, Fecha: '24-06-2026'
});
assert.strictEqual(pagosPrecioMalo.valido, false);
assert.strictEqual(pagosPrecioMalo.motivo, 'Precio/Kg debe ser un número mayor a 0');

console.log('ADMIN_IMPORTAR_FILAS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: an `AssertionError` (`typeof AI.esFilaVacia` related call throws / `procesarFilaDestaraje is not a function`) — Task 1 alone doesn't define these yet.

- [ ] **Step 3: Insert the implementation**

In `js/admin-importar.js`, find this anchor:

```javascript
window.EVE_ADMIN_IMPORTAR = {
  validarFormatoFecha,
  convertirFechaAISO
};

})();
```

Replace it with:

```javascript
window.EVE_ADMIN_IMPORTAR = {
  validarFormatoFecha,
  convertirFechaAISO
};

function esFilaVacia(fila) {
  return Object.values(fila).every((valor) => String(valor ?? '').trim() === '');
}

function procesarFilaDestaraje(fila) {
  const fechaEntradaTexto = String(fila['Fecha Entrada'] ?? '').trim();
  const fechaSalidaTexto = String(fila['Fecha Salida'] ?? '').trim();
  if (!validarFormatoFecha(fechaEntradaTexto) || !validarFormatoFecha(fechaSalidaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.construirRegistroDesdeFormulario({
      ticket: String(fila.Ticket ?? '').trim(),
      proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      fechaEntrada: convertirFechaAISO(fechaEntradaTexto),
      fechaSalida: convertirFechaAISO(fechaSalidaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarFilaProduccion(fila) {
  const fechaEntradaTexto = String(fila['Fecha Entrada'] ?? '').trim();
  const fechaSalidaTexto = String(fila['Fecha Salida'] ?? '').trim();
  if (!validarFormatoFecha(fechaEntradaTexto) || !validarFormatoFecha(fechaSalidaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.construirRegistroDesdeFormularioProduccion({
      cliente: String(fila.Cliente ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      fechaEntrada: convertirFechaAISO(fechaEntradaTexto),
      fechaSalida: convertirFechaAISO(fechaSalidaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarFilaPagos(fila) {
  const fechaTexto = String(fila.Fecha ?? '').trim();
  if (!validarFormatoFecha(fechaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.EVE_PAGOS.construirRegistroDesdeFormulario({
      ticket: String(fila.Ticket ?? '').trim(),
      proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      precioPorKg: fila['Precio/Kg'],
      pagado: fila.Pagado,
      fecha: convertirFechaAISO(fechaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  esFilaVacia,
  procesarFilaDestaraje,
  procesarFilaProduccion,
  procesarFilaPagos
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_IMPORTAR_FILAS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-importar.js
git commit -m "feat: add admin-importar.js per-row validation reusing existing module validators"
```

---

### Task 3: `js/admin-importar.js` — sheet-level aggregation

**Files:**
- Modify: `js/admin-importar.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `esFilaVacia` (Task 2, same file, bare identifier).
- Produces (added to `window.EVE_ADMIN_IMPORTAR`): `procesarHoja(filasCrudas, procesador)` → `FilaProcesada[]` (filters blank rows, then maps the rest through `procesador`); `contarResumenHoja(filasProcesadas)` → `{ validas: number, invalidas: number }`; `obtenerRegistrosValidos(filasProcesadas)` → `object[]` (just the `.registro` of every valid entry, in order); `hojaCalificaParaReemplazo(filasProcesadas)` → `boolean` (`true` iff at least one row is valid).

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
require('./js/admin-importar.js');
const assert = require('assert');
const AI = window.EVE_ADMIN_IMPORTAR;

const procesadorDePrueba = (fila) => fila.Kg > 0
  ? { valido: true, motivo: null, registro: { kg: fila.Kg }, original: fila }
  : { valido: false, motivo: 'Kg malo', registro: null, original: fila };

const filasCrudas = [
  { Ticket: '1', Kg: 100 },
  { Ticket: '', Kg: '' },
  { Ticket: '2', Kg: -5 },
  { Ticket: '3', Kg: 50 }
];

const procesadas = AI.procesarHoja(filasCrudas, procesadorDePrueba);
assert.strictEqual(procesadas.length, 3);

const resumen = AI.contarResumenHoja(procesadas);
assert.deepStrictEqual(resumen, { validas: 2, invalidas: 1 });

const validos = AI.obtenerRegistrosValidos(procesadas);
assert.deepStrictEqual(validos, [{ kg: 100 }, { kg: 50 }]);

assert.strictEqual(AI.hojaCalificaParaReemplazo(procesadas), true);
assert.strictEqual(AI.hojaCalificaParaReemplazo([]), false);
assert.strictEqual(AI.hojaCalificaParaReemplazo([{ valido: false, motivo: 'x', registro: null, original: {} }]), false);

console.log('ADMIN_IMPORTAR_HOJA_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: AI.procesarHoja is not a function`.

- [ ] **Step 3: Insert the implementation**

In `js/admin-importar.js`, find this anchor:

```javascript
Object.assign(window.EVE_ADMIN_IMPORTAR, {
  esFilaVacia,
  procesarFilaDestaraje,
  procesarFilaProduccion,
  procesarFilaPagos
});

})();
```

Replace it with:

```javascript
Object.assign(window.EVE_ADMIN_IMPORTAR, {
  esFilaVacia,
  procesarFilaDestaraje,
  procesarFilaProduccion,
  procesarFilaPagos
});

function procesarHoja(filasCrudas, procesador) {
  return filasCrudas.filter((fila) => !esFilaVacia(fila)).map((fila) => procesador(fila));
}

function contarResumenHoja(filasProcesadas) {
  const validas = filasProcesadas.filter((f) => f.valido).length;
  return { validas, invalidas: filasProcesadas.length - validas };
}

function obtenerRegistrosValidos(filasProcesadas) {
  return filasProcesadas.filter((f) => f.valido).map((f) => f.registro);
}

function hojaCalificaParaReemplazo(filasProcesadas) {
  return filasProcesadas.some((f) => f.valido);
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  procesarHoja,
  contarResumenHoja,
  obtenerRegistrosValidos,
  hojaCalificaParaReemplazo
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_IMPORTAR_HOJA_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-importar.js
git commit -m "feat: add admin-importar.js sheet-level aggregation helpers"
```

---

### Task 4: `js/admin-importar.js` — template generation and file parsing (XLSX glue)

**Files:**
- Modify: `js/admin-importar.js` — insert before the closing `})();`
- Test: none in this task (this task touches only the `XLSX` library, loaded as a browser global with no Node equivalent installed in this project — consistent with how this project already treats other CDN-only libraries, e.g. jsPDF in `reportes.js`; correctness is verified live in Task 6)

**Interfaces:**
- Consumes: the global `XLSX` object (already loaded via `<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js">` in `index.html` since Fase 1).
- Produces (added to `window.EVE_ADMIN_IMPORTAR`): `generarPlantilla()` → `void` (builds and downloads `Plantilla_Importacion_EVE.xlsx` with 3 sheets, each with one example row); `leerArchivoExcel(arrayBuffer)` → `{ destaraje: object[], produccion: object[], pagos: object[] }` (throws `Error` listing any of the 3 expected sheet names that's missing).

- [ ] **Step 1: Insert the implementation**

In `js/admin-importar.js`, find this anchor:

```javascript
Object.assign(window.EVE_ADMIN_IMPORTAR, {
  procesarHoja,
  contarResumenHoja,
  obtenerRegistrosValidos,
  hojaCalificaParaReemplazo
});

})();
```

Replace it with:

```javascript
Object.assign(window.EVE_ADMIN_IMPORTAR, {
  procesarHoja,
  contarResumenHoja,
  obtenerRegistrosValidos,
  hojaCalificaParaReemplazo
});

function generarPlantilla() {
  const libro = XLSX.utils.book_new();
  const destaraje = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Proveedor', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
    ['9260', 'JOSE ENRIQUE', 'MIXTO', 1000, '24-06-2026', '25-06-2026']
  ]);
  const produccion = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Cliente', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
    ['P', 'CLIENTE EJEMPLO', 'PELLETS', 500, '24-06-2026', '25-06-2026']
  ]);
  const pagos = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Proveedor', 'Material', 'Kg', 'Precio/Kg', 'Total', 'Pagado', 'Fecha'],
    ['9260', 'JOSE ENRIQUE', 'MIXTO', 1000, 5, 5000, 4000, '24-06-2026']
  ]);
  XLSX.utils.book_append_sheet(libro, destaraje, 'Destaraje');
  XLSX.utils.book_append_sheet(libro, produccion, 'Produccion');
  XLSX.utils.book_append_sheet(libro, pagos, 'Pagos');
  XLSX.writeFile(libro, 'Plantilla_Importacion_EVE.xlsx');
}

function leerArchivoExcel(arrayBuffer) {
  const libro = XLSX.read(arrayBuffer, { type: 'array' });
  const NOMBRES_HOJA = ['Destaraje', 'Produccion', 'Pagos'];
  const faltantes = NOMBRES_HOJA.filter((nombre) => !libro.Sheets[nombre]);
  if (faltantes.length > 0) {
    throw new Error(`El archivo no tiene la(s) hoja(s): ${faltantes.join(', ')}`);
  }
  return {
    destaraje: XLSX.utils.sheet_to_json(libro.Sheets.Destaraje, { defval: '' }),
    produccion: XLSX.utils.sheet_to_json(libro.Sheets.Produccion, { defval: '' }),
    pagos: XLSX.utils.sheet_to_json(libro.Sheets.Pagos, { defval: '' })
  };
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  generarPlantilla,
  leerArchivoExcel
});

})();
```

- [ ] **Step 2: Commit**

```bash
git add js/admin-importar.js
git commit -m "feat: add admin-importar.js template generation and file parsing"
```

---

### Task 5: `js/admin-importar.js` — preview UI, mode toggle, batched writes

**Files:**
- Modify: `js/admin-importar.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (module-load + DOM construction only — full live behavior verified in Task 6)

**Interfaces:**
- Consumes: every function from Tasks 1-4 (same file, bare identifiers); `window.cargarDatosEnParalelo` (`js/auth.js` — refreshes all of `window.EVE`'s arrays after a successful import); `window.db` (`js/config.js`); `window.COLECCIONES` (`js/config.js`); `window.EVE.registrosDestaraje`/`registrosVentas`/`registrosProduccion`/`registrosPagos` (`js/auth.js`); `window.showSuccess`/`window.showError` (`js/utils.js`).
- Produces (added to `window.EVE_ADMIN_IMPORTAR`): `crearVistaImportar()` → `HTMLDivElement` (the whole sub-tab card).

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, dataset: {},
    children: [], disabled: false, checked: false, value: '', textContent: '', innerHTML: '', files: [],
    addEventListener(){}, appendChild(){ this.children.push(arguments[0]); }, removeChild(){}, remove(){},
    setAttribute(){}, getAttribute(){ return null; },
    querySelectorAll(){ return []; }, querySelector(){ return fakeElement(); }
  };
}
global.document = {
  getElementById(){ return fakeElement(); },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
global.window.COLECCIONES = { DESTARAJE: 'destaraje', PRODUCCION: 'produccion', PAGOS: 'pagos' };
global.window.EVE = { registrosDestaraje: [], registrosVentas: [], registrosProduccion: [], registrosPagos: [] };
require('./js/admin-importar.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_ADMIN_IMPORTAR.crearVistaImportar, 'function');
const vista = window.EVE_ADMIN_IMPORTAR.crearVistaImportar();
assert.ok(vista);
console.log('ADMIN_IMPORTAR_VISTA_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: an `AssertionError` (`typeof window.EVE_ADMIN_IMPORTAR.crearVistaImportar` is `'undefined'`).

- [ ] **Step 3: Insert the implementation**

In `js/admin-importar.js`, find this anchor:

```javascript
Object.assign(window.EVE_ADMIN_IMPORTAR, {
  generarPlantilla,
  leerArchivoExcel
});

})();
```

Replace it with:

```javascript
Object.assign(window.EVE_ADMIN_IMPORTAR, {
  generarPlantilla,
  leerArchivoExcel
});

const PROCESADORES_HOJA = {
  destaraje: procesarFilaDestaraje,
  produccion: procesarFilaProduccion,
  pagos: procesarFilaPagos
};

const COLECCION_POR_HOJA = {
  destaraje: 'destaraje',
  produccion: 'produccion',
  pagos: 'pagos'
};

let modoActual = 'agregar';
let resultadoParseo = null;

function obtenerArrayExistente(hoja) {
  if (hoja === 'destaraje') return [...window.EVE.registrosDestaraje, ...window.EVE.registrosVentas];
  if (hoja === 'produccion') return window.EVE.registrosProduccion;
  return window.EVE.registrosPagos;
}

async function ejecutarOperacionesEnLotes(operaciones) {
  const TAMANO_LOTE = 500;
  for (let inicio = 0; inicio < operaciones.length; inicio += TAMANO_LOTE) {
    const grupo = operaciones.slice(inicio, inicio + TAMANO_LOTE);
    const lote = window.db.batch();
    grupo.forEach((operacion) => {
      if (operacion.tipo === 'delete') {
        lote.delete(window.db.collection(operacion.coleccion).doc(operacion.id));
      } else {
        const datosCompletos = { ...operacion.datos };
        if (!datosCompletos.fechaRegistro) {
          datosCompletos.fechaRegistro = new Date().toISOString();
        }
        lote.set(window.db.collection(operacion.coleccion).doc(), datosCompletos);
      }
    });
    await lote.commit();
  }
}

function construirColumnasPreview(filasProcesadas) {
  if (filasProcesadas.length === 0) return [];
  return Object.keys(filasProcesadas[0].original);
}

function renderizarTablaHoja(contenedor, etiqueta, filasProcesadas) {
  const resumen = contarResumenHoja(filasProcesadas);
  const titulo = document.createElement('p');
  titulo.textContent = `${etiqueta}: ${resumen.validas} válidas, ${resumen.invalidas} con error`;
  contenedor.appendChild(titulo);

  if (filasProcesadas.length === 0) return;

  const columnas = construirColumnasPreview(filasProcesadas);
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  const encabezado = document.createElement('tr');
  columnas.concat(['Estado']).forEach((nombreColumna) => {
    const celda = document.createElement('th');
    celda.textContent = nombreColumna;
    encabezado.appendChild(celda);
  });
  const cabecera = document.createElement('thead');
  cabecera.appendChild(encabezado);
  tabla.appendChild(cabecera);

  const cuerpo = document.createElement('tbody');
  filasProcesadas.forEach((filaProcesada) => {
    const fila = document.createElement('tr');
    columnas.forEach((nombreColumna) => {
      const celda = document.createElement('td');
      celda.textContent = String(filaProcesada.original[nombreColumna] ?? '');
      fila.appendChild(celda);
    });
    const celdaEstado = document.createElement('td');
    celdaEstado.textContent = filaProcesada.valido ? '✓' : filaProcesada.motivo;
    fila.appendChild(celdaEstado);
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);

  const envoltura = document.createElement('div');
  envoltura.className = 'destaraje-tabla-wrapper';
  envoltura.appendChild(tabla);
  contenedor.appendChild(envoltura);
}

function renderizarVistaPrevia() {
  const contenedor = document.getElementById('ai-vista-previa');
  contenedor.innerHTML = '';
  if (!resultadoParseo) return;
  renderizarTablaHoja(contenedor, 'Destaraje', resultadoParseo.destaraje);
  renderizarTablaHoja(contenedor, 'Producción', resultadoParseo.produccion);
  renderizarTablaHoja(contenedor, 'Pagos', resultadoParseo.pagos);
}

function actualizarBotonConfirmar() {
  const boton = document.getElementById('ai-confirmar-importacion');
  if (!resultadoParseo) {
    boton.disabled = true;
    return;
  }
  if (modoActual === 'reemplazar') {
    const texto = document.getElementById('ai-confirmar-texto').value;
    boton.disabled = texto !== 'CONFIRMAR';
  } else {
    boton.disabled = false;
  }
}

function manejarCambioModo(nuevoModo) {
  modoActual = nuevoModo;
  document.getElementById('ai-confirmar-texto').style.display = nuevoModo === 'reemplazar' ? '' : 'none';
  document.getElementById('ai-confirmar-texto').value = '';
  actualizarBotonConfirmar();
}

function manejarDescargarPlantilla() {
  generarPlantilla();
}

function manejarSeleccionArchivo(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const datosHojas = leerArchivoExcel(lector.result);
      resultadoParseo = {
        destaraje: procesarHoja(datosHojas.destaraje, PROCESADORES_HOJA.destaraje),
        produccion: procesarHoja(datosHojas.produccion, PROCESADORES_HOJA.produccion),
        pagos: procesarHoja(datosHojas.pagos, PROCESADORES_HOJA.pagos)
      };
      renderizarVistaPrevia();
      actualizarBotonConfirmar();
    } catch (error) {
      resultadoParseo = null;
      renderizarVistaPrevia();
      actualizarBotonConfirmar();
      window.showError(error.message);
    }
  };
  lector.readAsArrayBuffer(archivo);
}

async function manejarConfirmarImportacion() {
  document.getElementById('ai-confirmar-importacion').disabled = true;
  try {
    for (const hoja of Object.keys(PROCESADORES_HOJA)) {
      const filasProcesadas = resultadoParseo[hoja];
      const registrosValidos = obtenerRegistrosValidos(filasProcesadas);
      if (registrosValidos.length === 0) continue;
      const operaciones = [];
      if (modoActual === 'reemplazar' && hojaCalificaParaReemplazo(filasProcesadas)) {
        obtenerArrayExistente(hoja).forEach((registroExistente) => {
          operaciones.push({ tipo: 'delete', coleccion: COLECCION_POR_HOJA[hoja], id: registroExistente.id });
        });
      }
      registrosValidos.forEach((registro) => {
        operaciones.push({ tipo: 'set', coleccion: COLECCION_POR_HOJA[hoja], datos: registro });
      });
      await ejecutarOperacionesEnLotes(operaciones);
    }
    await window.cargarDatosEnParalelo();
    resultadoParseo = null;
    document.getElementById('ai-archivo').value = '';
    renderizarVistaPrevia();
    actualizarBotonConfirmar();
    window.showSuccess('Importación completada');
  } catch (error) {
    window.showError(error.message);
    actualizarBotonConfirmar();
  }
}

function crearVistaImportar() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-importar';
  tarjeta.innerHTML = `
    <div class="admin-importar-header">
      <h3>Importar Datos</h3>
      <button type="button" id="ai-descargar-plantilla" class="btn-secondary">Descargar plantilla</button>
    </div>
    <input type="file" id="ai-archivo" accept=".xlsx">
    <div class="admin-importar-modo">
      <label><input type="radio" name="ai-modo" value="agregar" id="ai-modo-agregar" checked> Agregar</label>
      <label><input type="radio" name="ai-modo" value="reemplazar" id="ai-modo-reemplazar"> Reemplazar todo</label>
    </div>
    <input type="text" id="ai-confirmar-texto" placeholder="Escribe CONFIRMAR" style="display:none">
    <div id="ai-vista-previa"></div>
    <button type="button" id="ai-confirmar-importacion" class="btn-primary" disabled>Confirmar importación</button>
  `;
  tarjeta.querySelector('#ai-descargar-plantilla').addEventListener('click', manejarDescargarPlantilla);
  tarjeta.querySelector('#ai-archivo').addEventListener('change', manejarSeleccionArchivo);
  tarjeta.querySelector('#ai-modo-agregar').addEventListener('change', () => manejarCambioModo('agregar'));
  tarjeta.querySelector('#ai-modo-reemplazar').addEventListener('change', () => manejarCambioModo('reemplazar'));
  tarjeta.querySelector('#ai-confirmar-texto').addEventListener('input', actualizarBotonConfirmar);
  tarjeta.querySelector('#ai-confirmar-importacion').addEventListener('click', manejarConfirmarImportacion);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  crearVistaImportar
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_IMPORTAR_VISTA_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-importar.js
git commit -m "feat: add admin-importar.js preview UI, mode toggle, and batched writes"
```

---

### Task 6: Wire into `admin.js`/`index.html`, add CSS, live verification

**Files:**
- Modify: `js/admin.js`
- Modify: `index.html`
- Modify: `css/styles.css`
- Create: `docs/superpowers/verify-phase8b.js`

**Interfaces:**
- Consumes: `window.EVE_ADMIN_IMPORTAR.crearVistaImportar()` (Task 5).
- Produces: nothing consumed by later tasks (final task of this plan).

- [ ] **Step 1: Add the second sub-tab to `admin.js`**

In `js/admin.js`, find:

```javascript
const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' }
];
```

Replace with:

```javascript
const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'importar', nombre: 'Importar Datos' }
];
```

Find:

```javascript
function renderizarSubpestana(contenedor) {
  contenedor.innerHTML = '';
  if (subpestanaActiva === 'usuarios') {
    contenedor.appendChild(window.EVE_ADMIN_USUARIOS.crearVistaUsuarios());
  }
}
```

Replace with:

```javascript
function renderizarSubpestana(contenedor) {
  contenedor.innerHTML = '';
  if (subpestanaActiva === 'usuarios') {
    contenedor.appendChild(window.EVE_ADMIN_USUARIOS.crearVistaUsuarios());
  } else if (subpestanaActiva === 'importar') {
    contenedor.appendChild(window.EVE_ADMIN_IMPORTAR.crearVistaImportar());
  }
}
```

- [ ] **Step 2: Run admin.js's existing smoke test to confirm nothing broke**

```bash
node -e "
global.window = global;
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, dataset: {},
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
global.window.EVE_ADMIN_USUARIOS = { crearVistaUsuarios(){ return fakeElement(); } };
global.window.EVE_ADMIN_IMPORTAR = { crearVistaImportar(){ return fakeElement(); } };
require('./js/admin.js');
const assert = require('assert');
const contenedor = fakeElement();
window.EVE_ADMIN.renderAdmin(contenedor);
assert.ok(contenedor.children.length > 0);
console.log('ADMIN_SHELL_CON_IMPORTAR_OK');
"
```

Expected output: `ADMIN_SHELL_CON_IMPORTAR_OK`

- [ ] **Step 3: Commit the admin.js change**

```bash
git add js/admin.js
git commit -m "feat: add Importar Datos sub-tab to admin.js shell"
```

- [ ] **Step 4: Add the script tag**

In `index.html`, find:

```html
  <script src="js/admin-usuarios.js"></script>
  <script src="js/admin.js"></script>
</body>
```

Replace with:

```html
  <script src="js/admin-usuarios.js"></script>
  <script src="js/admin-importar.js"></script>
  <script src="js/admin.js"></script>
</body>
```

- [ ] **Step 5: Add the CSS**

In `css/styles.css`, append at the end of the file:

```css
/* ===== Panel Admin: Importar Datos ===== */

.admin-importar {
  margin-bottom: 1rem;
}

.admin-importar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.admin-importar-modo {
  display: flex;
  gap: 1rem;
  margin: 0.75rem 0;
}

#ai-archivo {
  margin-bottom: 0.75rem;
}

#ai-confirmar-texto {
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  border: 1px solid var(--gris-claro);
  border-radius: var(--radio);
}

#ai-vista-previa {
  margin-bottom: 1rem;
}
```

- [ ] **Step 6: Start the local server**

Run (from `eve-control-v2/`, if not already running):

```bash
npx http-server -p 8765 .
```

- [ ] **Step 7: Write the live verification script**

Create `docs/superpowers/verify-phase8b.js`:

```javascript
const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

  await page.click('#btn-admin');
  await page.waitForSelector('.tab:has-text("Importar Datos")');
  await page.click('.tab:has-text("Importar Datos")');
  await page.waitForSelector('#ai-descargar-plantilla');

  const [descarga] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ai-descargar-plantilla')
  ]);
  const rutaPlantilla = await descarga.path();
  console.log('PLANTILLA_DESCARGADA_OK:', !!rutaPlantilla);

  const ticketPrueba = `IMP${Date.now()}`.slice(-8);
  const archivoPrueba = path.join(os.tmpdir(), `prueba-importacion-${Date.now()}.xlsx`);
  await page.evaluate((args) => {
    const libro = XLSX.utils.book_new();
    const destaraje = XLSX.utils.aoa_to_sheet([
      ['Ticket', 'Proveedor', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
      [args.ticketPrueba, 'PROVEEDOR PRUEBA 8B', 'MIXTO', 100, '24-06-2026', '25-06-2026'],
      ['', '', '', '', '', '']
    ]);
    const produccion = XLSX.utils.aoa_to_sheet([
      ['Ticket', 'Cliente', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida']
    ]);
    const pagos = XLSX.utils.aoa_to_sheet([
      ['Ticket', 'Proveedor', 'Material', 'Kg', 'Precio/Kg', 'Total', 'Pagado', 'Fecha'],
      [args.ticketPrueba, 'PROVEEDOR PRUEBA 8B', 'MIXTO', 100, '2026-06-24', 999, 50, '24-06-2026']
    ]);
    XLSX.utils.book_append_sheet(libro, destaraje, 'Destaraje');
    XLSX.utils.book_append_sheet(libro, produccion, 'Produccion');
    XLSX.utils.book_append_sheet(libro, pagos, 'Pagos');
    window.__archivoPrueba = XLSX.write(libro, { type: 'base64' });
  }, { ticketPrueba });

  const base64Archivo = await page.evaluate(() => window.__archivoPrueba);
  fs.writeFileSync(archivoPrueba, Buffer.from(base64Archivo, 'base64'));

  await page.setInputFiles('#ai-archivo', archivoPrueba);
  await page.waitForSelector('#ai-vista-previa table');

  const textoResumen = await page.locator('#ai-vista-previa').textContent();
  console.log('PREVIEW_DESTARAJE_1_VALIDA_OK:', textoResumen.includes('Destaraje: 1 válidas, 0 con error'));
  console.log('PREVIEW_PRODUCCION_0_FILAS_OK:', textoResumen.includes('Producción: 0 válidas, 0 con error'));
  console.log('PREVIEW_PAGOS_1_INVALIDA_OK:', textoResumen.includes('Pagos: 0 válidas, 1 con error'));
  console.log('PREVIEW_MOTIVO_FECHA_OK:', textoResumen.includes('Fecha debe tener el formato DD-MM-AAAA'));

  console.log('BOTON_HABILITADO_AGREGAR_OK:', !(await page.locator('#ai-confirmar-importacion').isDisabled()));

  await page.click('#ai-confirmar-importacion');
  await page.waitForTimeout(500);

  const destarajeImportado = await page.evaluate(async (ticket) => {
    const registros = await window.cargarDatos(window.COLECCIONES.DESTARAJE);
    return registros.find((r) => r.ticket === ticket);
  }, ticketPrueba);
  console.log('IMPORTACION_AGREGAR_OK:', !!destarajeImportado && destarajeImportado.proveedor === 'PROVEEDOR PRUEBA 8B');

  const pagosImportados = await page.evaluate(async (ticket) => {
    const registros = await window.cargarDatos(window.COLECCIONES.PAGOS);
    return registros.filter((r) => r.ticket === ticket);
  }, ticketPrueba);
  console.log('FILA_INVALIDA_OMITIDA_OK:', pagosImportados.length === 0);

  await page.click('#ai-modo-reemplazar');
  console.log('BOTON_DESHABILITADO_SIN_CONFIRMAR_OK:', await page.locator('#ai-confirmar-importacion').isDisabled());

  await page.setInputFiles('#ai-archivo', archivoPrueba);
  await page.waitForSelector('#ai-vista-previa table');
  await page.fill('#ai-confirmar-texto', 'CONFIRMAR');
  console.log('BOTON_HABILITADO_TRAS_CONFIRMAR_OK:', !(await page.locator('#ai-confirmar-importacion').isDisabled()));

  await page.click('#ai-confirmar-importacion');
  await page.waitForTimeout(500);

  const destarajeFinal = await page.evaluate(async () => window.cargarDatos(window.COLECCIONES.DESTARAJE));
  console.log('REEMPLAZAR_DEJO_UN_SOLO_REGISTRO_OK:', destarajeFinal.filter((r) => r.proveedor === 'PROVEEDOR PRUEBA 8B').length === 1);

  const produccionFinal = await page.evaluate(async () => window.cargarDatos(window.COLECCIONES.PRODUCCION));
  console.log('PRODUCCION_NO_VACIADA_OK:', produccionFinal.length > 0);

  // Limpieza: borrar los registros de prueba directamente (no hay borrado en la UI de esta fase)
  await page.evaluate(async (ticket) => {
    const registros = await window.cargarDatos(window.COLECCIONES.DESTARAJE);
    const propios = registros.filter((r) => r.proveedor === 'PROVEEDOR PRUEBA 8B');
    for (const registro of propios) {
      await window.eliminarDato(window.COLECCIONES.DESTARAJE, registro.id);
    }
  }, ticketPrueba);
  fs.unlinkSync(archivoPrueba);

  const destarajeLimpio = await page.evaluate(async () => window.cargarDatos(window.COLECCIONES.DESTARAJE));
  console.log('LIMPIEZA_OK:', !destarajeLimpio.some((r) => r.proveedor === 'PROVEEDOR PRUEBA 8B'));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

- [ ] **Step 8: Run the live verification script**

Run:

```bash
node docs/superpowers/verify-phase8b.js
```

Expected: every line ends in `true`, and `CONSOLE_ERRORS: []`. If any line is flaky (timing-related, e.g. a check right after a Firestore write), follow the Fase 8a precedent: replace a fixed `waitForTimeout` with `page.waitForFunction` polling on the actual condition, never just increase the fixed delay.

- [ ] **Step 9: Commit**

```bash
git add index.html css/styles.css docs/superpowers/verify-phase8b.js
git commit -m "feat: wire admin-importar.js into the app, add live verification"
```

---

## Self-Review Notes

- **Spec coverage:** Arquitectura (single file, reuses existing validators, sub-tab in `admin.js`) → Tasks 1-2-6. Plantilla Excel (3 sheets, example row, sheet names without accents) → Task 4. Parseo y conversión de fechas (strict DD-MM-AAAA, ISO conversion, missing-sheet error) → Tasks 1, 4. Validación y vista previa (per-row reuse of validators, skip invalid, summary + table) → Tasks 2-3-5. Modos Agregar/Reemplazar (only-sheets-with-data, CONFIRMAR gate, batched writes, in-memory refresh) → Task 5. Manejo de errores generales (invalid file / missing sheet) → Task 4. Archivos → Task 6. Every spec section has a task.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command. Removed a dead `hojasPlantilla` variable found in an earlier draft of Task 6's verify script — inspecting a downloaded `.xlsx`'s actual sheet names from Node would need the `xlsx` npm package, not installed in this project, so the script only checks that the download succeeded; the later full round-trip import test (upload → preview → confirm → Firestore) already exercises the template's column layout end-to-end, so no coverage is lost.
- **Type consistency:** `FilaProcesada`'s shape (`{ valido, motivo, registro, original }`) is defined once in Task 2 and consumed identically in Task 3 (`contarResumenHoja`/`obtenerRegistrosValidos`/`hojaCalificaParaReemplazo`) and Task 5 (`renderizarTablaHoja`, `manejarConfirmarImportacion`) — no drift. `resultadoParseo`'s three keys (`destaraje`/`produccion`/`pagos`) match `leerArchivoExcel`'s return keys (Task 4) and `PROCESADORES_HOJA`/`COLECCION_POR_HOJA`'s keys (Task 5) exactly.
