# Fase 4 — Módulo Producción — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Producción module — capture/edit/delete production records (single type, no Compra/Venta), see them in Hoy/Esta Semana/Todos tabs with stats and filters, voice input, and report exports — reusing the voice engine (`js/voz.js`) and report engine (`js/reportes.js`) built in Phase 3 without modifying either.

**Architecture:** One new file, `js/produccion.js`, mirroring `js/destaraje.js`'s structure (IIFE, pure helpers + DOM/Firestore wiring, registered into `window.EVE_MODULES.produccion`). Simpler than Destaraje: one record type (always `ticket: "P"`), one table (no Destaraje/Ventas split), `cliente` instead of `proveedor`.

**Tech Stack:** Vanilla JS, Firebase Firestore (via `js/utils.js`), reuses `js/voz.js`'s `crearBotonVoz`/`parseProduccion` and `js/reportes.js`'s `exportarReporteTXT/PDF/CSV` unmodified, Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-produccion-design.md`.
- Record shape: `{ ticket: "P", cliente, material, kg, fechaEntrada, fechaSalida, fechaRegistro }`. `ticket` is always `"P"`, never user-editable — shown disabled in both the create form and the edit modal (decision from brainstorming: visible-but-disabled, for visual consistency with Destaraje's disabled Venta ticket field).
- Date field for Hoy/Esta Semana/the Todos date filter is **`fechaSalida`** (same rule as Destaraje, Phase 3a).
- **Critical naming rule, to prevent a real bug:** `js/destaraje.js` already attaches `window.filtrarPorHoy`, `window.filtrarPorSemana`, `window.aplicarFiltrosTodos`, `window.valoresUnicos`, `window.construirRegistroDesdeFormulario`, `window.crearFormulario`, `window.crearModalEdicion`, `window.abrirModalEdicion`, `window.actualizarDatalists`, `window.confirmarEliminar`. Since both files load as plain `<script>` tags into the SAME global `window`, `js/produccion.js` must **never** reuse these exact names for its own `window.*` exports — the second script to load would silently overwrite the first's. Every test-support export this plan defines is suffixed `Produccion` (e.g. `window.filtrarPorHoyProduccion`) specifically to avoid this. Internal (non-exported) function/variable names inside `produccion.js`'s own IIFE do NOT need suffixing — the IIFE already isolates them from `destaraje.js`'s internals; only the explicit `window.X = ...` lines are at risk.
- `js/reportes.js`'s `exportarReporteTXT/PDF/CSV(tabId, filtros)` and `js/voz.js`'s `crearBotonVoz`/`parseProduccion` are consumed as-is — this plan never modifies `js/reportes.js`, `js/voz.js`, `js/destaraje.js`, or `js/auth.js`.
- Reuse existing generic CSS classes (`.card`, `.tabs`/`.tab`, `.modal`/`.modal-overlay`, `.btn-primary`/`.btn-secondary`, `.btn-voz`, and Destaraje's `.destaraje-form`/`.destaraje-subtabs`/`.destaraje-filtros`/`.destaraje-stats`/`.destaraje-tabla-wrapper`/`.destaraje-exportar`/`.tabla-destaraje` — despite the name, these rules are generic, not Destaraje-specific, in `css/styles.css`) — no new CSS is needed for this phase.
- XSS rule (same as every prior module): any Firestore-/form-derived value reaches the DOM via `textContent`/a property, never `innerHTML` interpolation. Static markup with no variables may use `innerHTML`.
- After create/update/delete, mutate `window.EVE.registrosProduccion` in memory directly — never re-fetch.

---

## File Structure

```
eve-control-v2/
├── index.html        (Task 4 — add <script src="js/produccion.js"> after destaraje.js)
└── js/
    └── produccion.js  (Tasks 1-3, new)
```

`js/produccion.js` is built across 3 tasks, all inside one IIFE:
- Task 1: pure helpers — Node-tested.
- Task 2: form, autocomplete, voice wiring, CRUD — appended second, Node-tested (module-load smoke only; full behavior verified live in Task 4).
- Task 3: tabs/table/stats/filters/export buttons/module registration — appended third, completing the file, Node-tested against the full render flow.

---

### Task 1: `js/produccion.js` — pure helpers

**Files:**
- Create: `js/produccion.js` (this task writes the file; Tasks 2-3 append to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.MATERIALES_PZ` (`js/config.js`).
- Produces (attached to `window` with the `Produccion` suffix per the global constraint above):
  - `calcularStatsProduccion(registros)` → `{ totalRegistros, totalKg, totalPz }`
  - `filtrarPorHoyProduccion(registros, hoy)` → `array`
  - `filtrarPorSemanaProduccion(registros, inicioSemana)` → `array`
  - `aplicarFiltrosTodosProduccion(registros, filtros)` → `array`, `filtros = { cliente, material, desde, hasta }`
  - `valoresUnicosProduccion(arraysDeRegistros, campo, semillas)` → sorted, deduplicated, uppercased `string[]`
  - `construirRegistroDesdeFormularioProduccion(datos)` → `{ ticket: 'P', cliente, material, kg: number, fechaEntrada, fechaSalida }`, throws `Error` on invalid input

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
require('./js/produccion.js');
const assert = require('assert');

const stats = window.calcularStatsProduccion([
  { kg: 100, material: 'PELETIZADO' },
  { kg: 400, material: 'TAMBO' }
]);
assert.deepStrictEqual(stats, { totalRegistros: 2, totalKg: 100, totalPz: 400 });

const hoy = window.filtrarPorHoyProduccion([
  { fechaSalida: '2026-06-24' }, { fechaSalida: '2026-06-23' }
], '2026-06-24');
assert.strictEqual(hoy.length, 1);

const semana = window.filtrarPorSemanaProduccion([
  { fechaSalida: '2026-06-24' }, { fechaSalida: '2026-06-10' }
], '2026-06-22');
assert.strictEqual(semana.length, 1);

const filtrados = window.aplicarFiltrosTodosProduccion([
  { cliente: 'PRODUCCION', material: 'PELETIZADO', fechaSalida: '2026-06-24' },
  { cliente: 'OTRO', material: 'PP MOLIDO', fechaSalida: '2026-06-20' }
], { cliente: 'produc', desde: '', hasta: '', material: '' });
assert.strictEqual(filtrados.length, 1);
assert.strictEqual(filtrados[0].cliente, 'PRODUCCION');

const unicos = window.valoresUnicosProduccion([
  [{ cliente: 'produccion' }, { cliente: 'OTRO' }]
], 'cliente', []);
assert.deepStrictEqual(unicos, ['OTRO', 'PRODUCCION']);

const registro = window.construirRegistroDesdeFormularioProduccion({
  cliente: 'PRODUCCION', material: 'PELETIZADO',
  kg: '1800', fechaEntrada: '2026-04-24', fechaSalida: '2026-04-24'
});
assert.deepStrictEqual(registro, {
  ticket: 'P', cliente: 'PRODUCCION', material: 'PELETIZADO',
  kg: 1800, fechaEntrada: '2026-04-24', fechaSalida: '2026-04-24'
});

assert.throws(() => window.construirRegistroDesdeFormularioProduccion({
  cliente: 'X', material: 'Y', kg: '0', fechaEntrada: 'a', fechaSalida: 'b'
}), /Kg debe ser un número mayor a 0/);

console.log('PRODUCCION_HELPERS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/produccion.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/produccion.js`:

```javascript
(function () {

function esMaterialPZProduccion(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function calcularStatsProduccion(registros) {
  let totalKg = 0;
  let totalPz = 0;
  for (const registro of registros) {
    if (esMaterialPZProduccion(registro.material)) {
      totalPz += Number(registro.kg) || 0;
    } else {
      totalKg += Number(registro.kg) || 0;
    }
  }
  return { totalRegistros: registros.length, totalKg, totalPz };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fechaSalida === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fechaSalida >= inicioSemana);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const cliente = (filtros.cliente || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (cliente && !String(r.cliente).toLowerCase().includes(cliente)) return false;
    if (material && !String(r.material).toLowerCase().includes(material)) return false;
    if (!dentroDeRangoFecha(r.fechaSalida, filtros.desde, filtros.hasta)) return false;
    return true;
  });
}

function valoresUnicos(arraysDeRegistros, campo, semillas) {
  const set = new Set(semillas || []);
  for (const registros of arraysDeRegistros) {
    for (const registro of registros) {
      const valor = registro[campo];
      if (valor) set.add(String(valor).toUpperCase());
    }
  }
  return Array.from(set).sort();
}

function construirRegistroDesdeFormulario(datos) {
  if (!datos.cliente || !datos.material || !datos.fechaEntrada || !datos.fechaSalida) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  return {
    ticket: 'P',
    cliente: datos.cliente,
    material: datos.material,
    kg,
    fechaEntrada: datos.fechaEntrada,
    fechaSalida: datos.fechaSalida
  };
}

window.calcularStatsProduccion = calcularStatsProduccion;
window.filtrarPorHoyProduccion = filtrarPorHoy;
window.filtrarPorSemanaProduccion = filtrarPorSemana;
window.aplicarFiltrosTodosProduccion = aplicarFiltrosTodos;
window.valoresUnicosProduccion = valoresUnicos;
window.construirRegistroDesdeFormularioProduccion = construirRegistroDesdeFormulario;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `PRODUCCION_HELPERS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/produccion.js
git commit -m "feat: add produccion.js pure helpers (stats, filters, validation)"
```

---

### Task 2: `js/produccion.js` — form, autocomplete, voice wiring, CRUD

**Files:**
- Modify: `js/produccion.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (module-load + function-existence only — full behavior verified live in Task 4)

**Interfaces:**
- Consumes: `construirRegistroDesdeFormulario`, `valoresUnicos` (Task 1, same file, bare identifiers); `window.guardarDato`, `window.actualizarDato`, `window.eliminarDato`, `window.showSuccess`, `window.showError` (`js/utils.js`); `window.crearBotonVoz`, `window.parseProduccion` (`js/voz.js`, unmodified); `window.EVE.registrosProduccion`, `window.MATERIALES_COMUNES` (`js/auth.js`/`js/config.js`).
- Produces (attached to `window` with the `Produccion` suffix): `crearFormularioProduccion()` → `HTMLFormElement`; `crearModalEdicionProduccion()` → `HTMLDivElement`; `abrirModalEdicionProduccion(registro)`; `actualizarDatalistsProduccion()`; `confirmarEliminarProduccion(id)`. Module-scoped `editandoId` (`string|null`) stays unexported.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
global.MATERIALES_COMUNES = ['PELETIZADO'];
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){} }, dataset: {},
    addEventListener(){}, appendChild(){}, removeChild(){}, querySelectorAll(){ return []; },
    querySelector(){ return fakeElement(); }, textContent: '', innerHTML: '', value: '', reset(){}
  };
}
global.document = {
  getElementById(){ return fakeElement(); },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
require('./js/produccion.js');
const assert = require('assert');
assert.strictEqual(typeof window.calcularStatsProduccion, 'function');
assert.strictEqual(typeof window.crearFormularioProduccion, 'function');
assert.strictEqual(typeof window.crearModalEdicionProduccion, 'function');
console.log('PRODUCCION_FORM_LOADS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: an `AssertionError` (`typeof window.crearFormularioProduccion` is `'undefined'`) — Task 1 alone doesn't define it yet.

- [ ] **Step 3: Insert the implementation**

In `js/produccion.js`, find this anchor:

```javascript
window.calcularStatsProduccion = calcularStatsProduccion;
window.filtrarPorHoyProduccion = filtrarPorHoy;
window.filtrarPorSemanaProduccion = filtrarPorSemana;
window.aplicarFiltrosTodosProduccion = aplicarFiltrosTodos;
window.valoresUnicosProduccion = valoresUnicos;
window.construirRegistroDesdeFormularioProduccion = construirRegistroDesdeFormulario;

})();
```

Replace it with:

```javascript
window.calcularStatsProduccion = calcularStatsProduccion;
window.filtrarPorHoyProduccion = filtrarPorHoy;
window.filtrarPorSemanaProduccion = filtrarPorSemana;
window.aplicarFiltrosTodosProduccion = aplicarFiltrosTodos;
window.valoresUnicosProduccion = valoresUnicos;
window.construirRegistroDesdeFormularioProduccion = construirRegistroDesdeFormulario;

let editandoId = null;

function llenarDatalist(id, valores) {
  const datalist = document.getElementById(id);
  datalist.innerHTML = '';
  valores.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    datalist.appendChild(opcion);
  });
}

function actualizarDatalists() {
  const clientes = valoresUnicos([window.EVE.registrosProduccion], 'cliente', []);
  const materiales = valoresUnicos([window.EVE.registrosProduccion], 'material', window.MATERIALES_COMUNES);
  llenarDatalist('prod-dl-clientes', clientes);
  llenarDatalist('prod-dl-materiales', materiales);
}

function insertarRegistroEnMemoria(registro) {
  window.EVE.registrosProduccion.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos) {
  const lista = window.EVE.registrosProduccion;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista[indice] = { ...lista[indice], ...datos };
  }
}

function eliminarRegistroEnMemoria(id) {
  const lista = window.EVE.registrosProduccion;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista.splice(indice, 1);
  }
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    cliente: document.getElementById('prod-cliente').value.trim().toUpperCase(),
    material: document.getElementById('prod-material').value.trim().toUpperCase(),
    kg: document.getElementById('prod-kg').value,
    fechaEntrada: document.getElementById('prod-entrada').value,
    fechaSalida: document.getElementById('prod-salida').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    const id = await window.guardarDato('produccion', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    document.getElementById('produccion-form').reset();
    document.getElementById('prod-ticket').value = 'P';
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parseProduccion(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  document.getElementById('prod-cliente').value = datos.cliente;
  document.getElementById('prod-material').value = datos.material;
  document.getElementById('prod-kg').value = datos.kg;
  document.getElementById('prod-entrada').value = datos.fechaEntrada;
  document.getElementById('prod-salida').value = datos.fechaSalida;
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'produccion-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-grid">
      <input type="text" id="prod-ticket" value="P" disabled>
      <input type="text" id="prod-cliente" placeholder="Cliente" list="prod-dl-clientes" required>
      <input type="text" id="prod-material" placeholder="Material" list="prod-dl-materiales" required>
      <input type="number" id="prod-kg" placeholder="Kg" step="0.01" required>
      <input type="date" id="prod-entrada" required>
      <input type="date" id="prod-salida" required>
    </div>
    <datalist id="prod-dl-clientes"></datalist>
    <datalist id="prod-dl-materiales"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));
  return form;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    cliente: document.getElementById('prode-cliente').value.trim().toUpperCase(),
    material: document.getElementById('prode-material').value.trim().toUpperCase(),
    kg: document.getElementById('prode-kg').value,
    fechaEntrada: document.getElementById('prode-entrada').value,
    fechaSalida: document.getElementById('prode-salida').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    await window.actualizarDato('produccion', editandoId, registro);
    reemplazarRegistroEnMemoria(editandoId, registro);
    cerrarModalEdicion();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'produccion-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar registro</h3>
      <form id="produccion-edit-form">
        <input type="text" id="prode-ticket" value="P" disabled>
        <input type="text" id="prode-cliente" placeholder="Cliente" required>
        <input type="text" id="prode-material" placeholder="Material" required>
        <input type="number" id="prode-kg" placeholder="Kg" step="0.01" required>
        <input type="date" id="prode-entrada" required>
        <input type="date" id="prode-salida" required>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="prode-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#produccion-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#prode-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('prode-cliente').value = registro.cliente;
  document.getElementById('prode-material').value = registro.material;
  document.getElementById('prode-kg').value = registro.kg;
  document.getElementById('prode-entrada').value = registro.fechaEntrada;
  document.getElementById('prode-salida').value = registro.fechaSalida;
  document.getElementById('produccion-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('produccion-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await window.eliminarDato('produccion', id);
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

window.crearFormularioProduccion = crearFormulario;
window.crearModalEdicionProduccion = crearModalEdicion;
window.abrirModalEdicionProduccion = abrirModalEdicion;
window.actualizarDatalistsProduccion = actualizarDatalists;
window.confirmarEliminarProduccion = confirmarEliminar;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `PRODUCCION_FORM_LOADS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/produccion.js
git commit -m "feat: add produccion.js form, autocomplete, voice wiring, and CRUD"
```

---

### Task 3: `js/produccion.js` — tabs, table, stats, filters, export buttons, module registration

**Files:**
- Modify: `js/produccion.js` — insert before the closing `})();`, completing the file
- Test: inline `node -e` smoke check (full render flow against stubbed DOM/data)

**Interfaces:**
- Consumes: `filtrarPorHoy`, `filtrarPorSemana`, `aplicarFiltrosTodos`, `calcularStatsProduccion` (Task 1, bare identifiers); `crearFormulario`, `crearModalEdicion`, `abrirModalEdicion`, `confirmarEliminar`, `actualizarDatalists` (Task 2, bare identifiers); `window.formatearKg` (`js/utils.js`); `window.obtenerFechaMexico`, `window.obtenerInicioSemana` (`js/utils.js`); `window.exportarReporteTXT/PDF/CSV` (`js/reportes.js`, unmodified); `window.EVE.registrosProduccion`, `window.EVE_MODULES` (`js/auth.js`).
- Produces: `window.EVE_MODULES.produccion = { render(container) }` — the contract `js/auth.js`'s `renderModulo` already calls.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.EVE = { registrosProduccion: [] };
global.EVE_MODULES = {};
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){} }, dataset: {},
    addEventListener(){}, appendChild(){}, removeChild(){}, querySelectorAll(){ return []; },
    querySelector(){ return fakeElement(); }, textContent: '', innerHTML: '', value: '', reset(){}
  };
}
global.document = {
  getElementById(){ return fakeElement(); },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
global.MATERIALES_PZ = ['TAMBO'];
global.MATERIALES_COMUNES = [];
global.formatearKg = (kg) => String(kg) + ' KG';
global.obtenerFechaMexico = () => '2026-06-24';
global.obtenerInicioSemana = () => '2026-06-22';
global.crearBotonVoz = () => fakeElement();
require('./js/produccion.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_MODULES.produccion.render, 'function');
window.EVE_MODULES.produccion.render(fakeElement());
console.log('PRODUCCION_MODULE_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: a thrown `TypeError` — `window.EVE_MODULES.produccion` is `undefined` because Tasks 1-2 never register it.

- [ ] **Step 3: Append the implementation**

Append to `js/produccion.js` (before the closing `})();`):

```javascript
let tabActiva = 'hoy';
let filtros = { cliente: '', desde: '', hasta: '', material: '' };

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
    boton.addEventListener('click', () => {
      tabActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      renderizarVista();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'produccion-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'pft-desde', etiqueta: 'Desde', placeholder: '', tipo: 'date' },
    { id: 'pft-hasta', etiqueta: 'Hasta', placeholder: '', tipo: 'date' },
    { id: 'pft-cliente', etiqueta: '', placeholder: 'Cliente', tipo: 'text' },
    { id: 'pft-material', etiqueta: '', placeholder: 'Material', tipo: 'text' }
  ];
  campos.forEach((campo) => {
    if (campo.etiqueta) {
      const etiqueta = document.createElement('span');
      etiqueta.textContent = campo.etiqueta;
      div.appendChild(etiqueta);
    }
    const input = document.createElement('input');
    input.type = campo.tipo;
    input.id = campo.id;
    input.placeholder = campo.placeholder;
    input.addEventListener('input', () => {
      filtros = {
        cliente: document.getElementById('pft-cliente').value,
        desde: document.getElementById('pft-desde').value,
        hasta: document.getElementById('pft-hasta').value,
        material: document.getElementById('pft-material').value
      };
      renderizarVista();
    });
    div.appendChild(input);
  });
  return div;
}

function crearTabla() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Cliente</th><th>Material</th><th>Kg</th><th>F. Entrada</th><th>F. Salida</th><th></th></tr>
    </thead>
    <tbody id="produccion-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  return wrapper;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const valores = [
    registro.cliente, registro.material,
    window.formatearKg(registro.kg, registro.material), registro.fechaEntrada, registro.fechaSalida
  ];
  valores.forEach((valor) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
  const botonEditar = document.createElement('button');
  botonEditar.textContent = 'Editar';
  botonEditar.className = 'btn-secondary';
  botonEditar.addEventListener('click', () => abrirModalEdicion(registro));
  const botonEliminar = document.createElement('button');
  botonEliminar.textContent = 'Eliminar';
  botonEliminar.className = 'btn-secondary';
  botonEliminar.addEventListener('click', () => confirmarEliminar(registro.id));
  celdaAcciones.appendChild(botonEditar);
  celdaAcciones.appendChild(botonEliminar);
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(registros) {
  const tbody = document.getElementById('produccion-tabla');
  tbody.innerHTML = '';
  if (registros.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 6;
    celda.textContent = 'Sin registros';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  registros.forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let registros = window.EVE.registrosProduccion;
  if (tabActiva === 'hoy') {
    registros = filtrarPorHoy(registros, window.obtenerFechaMexico());
  } else if (tabActiva === 'semana') {
    registros = filtrarPorSemana(registros, window.obtenerInicioSemana());
  } else {
    registros = aplicarFiltrosTodos(registros, filtros);
  }
  return registros;
}

function renderizarStats(registros) {
  const stats = calcularStatsProduccion(registros);
  const contenedor = document.getElementById('produccion-stats');
  contenedor.innerHTML = '';
  const partes = [
    `Registros: ${stats.totalRegistros}`,
    `Total KG: ${stats.totalKg.toLocaleString('es-MX')}`
  ];
  if (stats.totalPz > 0) {
    partes.push(`Total PZ: ${stats.totalPz.toLocaleString('es-MX')}`);
  }
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function renderizarVista() {
  document.getElementById('produccion-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const registros = obtenerRegistrosParaTab();
  renderizarStats(registros);
  llenarTabla(registros);
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

function renderProduccion(container) {
  tabActiva = 'hoy';
  filtros = { cliente: '', desde: '', hasta: '', material: '' };
  editandoId = null;

  container.appendChild(crearFormulario());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  const stats = document.createElement('div');
  stats.id = 'produccion-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla());
  container.appendChild(crearModalEdicion());

  actualizarDatalists();
  renderizarVista();
}

window.EVE_MODULES.produccion = { render: renderProduccion };

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `PRODUCCION_MODULE_OK`

- [ ] **Step 5: Commit**

```bash
git add js/produccion.js
git commit -m "feat: add produccion.js tabs, table, stats, filters, exports, and module registration"
```

---

### Task 4: Wire `index.html` + live Firebase check

**Files:**
- Modify: `index.html` (add one `<script>` tag — no CSS changes needed, per the Global Constraints' CSS-reuse note)
- Test: Playwright script run via `node` (ephemeral, not committed differently from prior phases)

**Interfaces:**
- Consumes: `js/produccion.js` (Tasks 1-3), the real Firestore `produccion` collection in the `everplastic` project, `docs/superpowers/credenciales-phase2.json` (already gitignored, from Phase 2 — reused, not recreated).
- Produces: confirmation that Phase 4's acceptance criteria hold. This task **writes and then deletes one test record** in the real `produccion` collection — see Step 3.

**Critical selector-scoping rule (lesson from Phase 3a's incident — an unscoped table-wide selector once deleted a real production record):** with Producción added, `.btn-voz` now matches TWO elements in the app (Destaraje's and Producción's). Every selector in this task's verification script must be scoped to `#produccion-form`/the specific test row — never a bare `.btn-voz` or table-wide selector.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q 'src="js/produccion.js"' index.html && echo "WIRING_OK"
```

Expected: no `WIRING_OK` printed.

- [ ] **Step 2: Modify `index.html`**

Change:

```html
  <script src="js/voz.js"></script>
  <script src="js/destaraje.js"></script>
</body>
</html>
```

to:

```html
  <script src="js/voz.js"></script>
  <script src="js/destaraje.js"></script>
  <script src="js/produccion.js"></script>
</body>
</html>
```

Run the exact command from Step 1 again. Expected output: `WIRING_OK`. Commit:

```bash
git add index.html
git commit -m "feat: wire produccion.js into index.html"
```

- [ ] **Step 3: Write and run the live-Firebase Playwright check**

This test writes one real record via the voice path, edits it, exports
TXT/PDF/CSV, then deletes it (cleanup) — confirmed via a direct Firestore
query at the end, same pattern as Phase 3a/3b/3c.

Create `docs/superpowers/verify-phase4.js`:

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

  await page.addInitScript(() => {
    window.__VOZ_TRANSCRIPT__ = '';
    class FakeSpeechRecognition {
      start() {
        setTimeout(() => {
          if (this.onresult) {
            this.onresult({ results: [[{ transcript: window.__VOZ_TRANSCRIPT__ }]] });
          }
        }, 20);
      }
      stop() {}
    }
    window.SpeechRecognition = FakeSpeechRecognition;
    window.webkitSpeechRecognition = FakeSpeechRecognition;
  });

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.fill('#login-username', CREDENCIALES.admin.username);
  await page.fill('#login-password', CREDENCIALES.admin.password);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app-shell.visible');
  await page.click('#tabs-container .tab:has-text("Producción")');
  await page.waitForSelector('#produccion-form');

  const CLIENTE_PRUEBA = 'TEST PROD QA';
  const filaPrueba = page.locator(`#produccion-tabla tr:has-text("${CLIENTE_PRUEBA}")`);

  // Voice fills the form (no real microphone — fake SpeechRecognition above)
  await page.evaluate((cliente) => {
    window.__VOZ_TRANSCRIPT__ = `Ticket P de ${cliente}, PET, 55, entrada 24 junio, salida 24 junio`;
  }, CLIENTE_PRUEBA);
  await page.dispatchEvent('#produccion-form .btn-voz', 'mousedown');
  await page.waitForFunction((cliente) => document.getElementById('prod-cliente').value === cliente, CLIENTE_PRUEBA);
  console.log('VOZ_LLENO_FORMULARIO_OK');

  await page.click('#produccion-form button[type="submit"]');
  await filaPrueba.waitFor({ state: 'visible' });
  console.log('HOY_TIENE_PRUEBA:', await filaPrueba.count() === 1);

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#pft-cliente', CLIENTE_PRUEBA);
  await page.waitForFunction((cliente) => {
    const filas = document.querySelectorAll('#produccion-tabla tr');
    return filas.length === 1 && filas[0].textContent.includes(cliente);
  }, CLIENTE_PRUEBA);
  console.log('FILTRO_OK');

  await filaPrueba.locator('button:has-text("Editar")').click();
  await page.waitForSelector('#produccion-modal-overlay.open');
  await page.fill('#prode-kg', '99');
  await page.click('#produccion-edit-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('produccion-modal-overlay').classList.contains('open'));
  console.log('EDICION_OK:', await filaPrueba.textContent().then((t) => t.includes('99 KG')));

  const [downloadTxt] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("TXT")')
  ]);
  console.log('EXPORT_TXT_OK:', !!(await downloadTxt.path()));

  const [downloadPdf] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("PDF")')
  ]);
  console.log('EXPORT_PDF_OK:', !!(await downloadPdf.path()));

  const [downloadCsv] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.destaraje-exportar button:has-text("CSV")')
  ]);
  console.log('EXPORT_CSV_OK:', !!(await downloadCsv.path()));

  await filaPrueba.locator('button:has-text("Eliminar")').click();
  await filaPrueba.waitFor({ state: 'detached' });
  console.log('ELIMINACION_OK:', await filaPrueba.count() === 0);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

Run:

```bash
cd "eve-control-v2"
(python -m http.server 8765 >/tmp/eve-server.log 2>&1 &)
sleep 1
node docs/superpowers/verify-phase4.js
```

Expected output:
```
VOZ_LLENO_FORMULARIO_OK
HOY_TIENE_PRUEBA: true
FILTRO_OK
EDICION_OK: true
EXPORT_TXT_OK: true
EXPORT_PDF_OK: true
EXPORT_CSV_OK: true
ELIMINACION_OK: true
CONSOLE_ERRORS: []
```

If `CONSOLE_ERRORS` is non-empty or any assertion is false, stop and report
— don't guess at a fix blindly. If the script fails partway through, check
the live `produccion` collection for a leftover `"TEST PROD QA"` record and
delete it manually before re-running.

- [ ] **Step 4: Confirm no test data remains**

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.db);
  const r = await page.evaluate(async () => {
    const s = await window.db.collection('produccion').where('cliente', '==', 'TEST PROD QA').get();
    return s.size;
  });
  console.log('REGISTROS_DE_PRUEBA_RESTANTES:', r);
  await browser.close();
})();
"
```

Expected output: `REGISTROS_DE_PRUEBA_RESTANTES: 0`

- [ ] **Step 5: Stop the local server**

```bash
PID=$(netstat -ano | grep ':8765 ' | grep LISTENING | head -1 | awk '{print $NF}')
[ -n "$PID" ] && taskkill //PID "$PID" //F
```

- [ ] **Step 6: Commit the verification script**

```bash
git add docs/superpowers/verify-phase4.js
git commit -m "test: add live-Firebase Playwright check for Phase 4 Produccion CRUD/voice/exports"
```

---

## Self-Review Notes

- **Spec coverage:** single record type with `ticket` fixed to `"P"` and shown disabled (Task 2), `cliente` instead of `proveedor` (Tasks 1-3), single table (no Destaraje/Ventas-style split, Task 3), Hoy/Esta Semana/Todos on `fechaSalida` (Tasks 1, 3), stats KG/PZ split (Tasks 1, 3), Todos-tab filters on cliente/material/dates (Tasks 1, 3), voice via the unmodified `js/voz.js` engine (Task 2), exports via the unmodified `js/reportes.js` engine (Task 3), in-memory mutation instead of re-fetch (Task 2) — all covered.
- **Placeholder scan:** none — every step has complete code and exact commands/expected output.
- **Naming-collision check (this plan's main new risk):** every function this plan attaches to `window` either already has a name disjoint from `js/destaraje.js`'s exports (`calcularStatsProduccion`) or is explicitly suffixed `Produccion` (`filtrarPorHoyProduccion`, `filtrarPorSemanaProduccion`, `aplicarFiltrosTodosProduccion`, `valoresUnicosProduccion`, `construirRegistroDesdeFormularioProduccion`, `crearFormularioProduccion`, `crearModalEdicionProduccion`, `abrirModalEdicionProduccion`, `actualizarDatalistsProduccion`, `confirmarEliminarProduccion`). Cross-checked against every `window.X = ...` line in the current `js/destaraje.js` (read directly from the file before writing this plan) — no overlaps. `window.EVE_MODULES.produccion` uses its own object key, so it cannot collide with `window.EVE_MODULES.destaraje`.
- **XSS check:** `construirFilaTabla` (Task 3) sets every Firestore-sourced value via `.textContent`; `llenarDatalist` (Task 2) sets `.value` on `<option>` elements — never `innerHTML` with interpolated data, matching every prior phase's pattern.
- **Type/interface consistency:** `window.EVE.registrosProduccion` (Phase 2's `auth.js`) ↔ this plan's reads/mutations use the same name and a flat array (not split, unlike Destaraje). `window.EVE_MODULES.produccion.render` matches the exact contract `js/auth.js`'s `renderModulo` expects. `window.exportarReporteTXT/PDF/CSV(tabId, filtros)` (Phase 3b) is called with the exact same 2-argument signature Destaraje already uses, with a `filtros` shape (`{cliente, material, desde, hasta}`) that `obtenerRangoYEtiqueta` only reads `.desde`/`.hasta` from — confirmed compatible without needing any change to `reportes.js`. `window.crearBotonVoz`/`window.parseProduccion` (Phase 3c) are called with the exact same signatures Destaraje already uses.

