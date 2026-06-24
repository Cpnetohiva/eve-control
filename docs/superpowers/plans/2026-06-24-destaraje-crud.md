# Fase 3a — Módulo Destaraje (CRUD + UI) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Destaraje module — capture compras/ventas, see them in HOY/ESTA SEMANA/TODOS tabs with live stats, filter in TODOS, edit/delete — wired into the `window.EVE_MODULES` extension point from Phase 2.

**Architecture:** One new file, `js/destaraje.js`, split internally into pure helpers (filtering/stats/validation — Node-testable) and DOM-rendering/wiring code (browser-only, verified via a live-Firebase Playwright run). Registers `window.EVE_MODULES.destaraje = { render(container) }`. All untrusted data (proveedor/cliente/material/ticket) is written to the DOM via `textContent`/individual property assignment — never via `innerHTML` string interpolation — matching the XSS-safe pattern already established in `js/auth.js`.

**Tech Stack:** Vanilla JS, Firebase Firestore (via `js/utils.js` wrappers), Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-destaraje-crud-design.md`.
- Date field for HOY/ESTA SEMANA and the TODOS date filter is **`fechaSalida`** — not `fechaRegistro`, not `fechaEntrada`. HOY: `fechaSalida === obtenerFechaMexico()`. ESTA SEMANA: `fechaSalida >= obtenerInicioSemana()`.
- Two separate tables per tab: "Destaraje" (`window.EVE.registrosDestaraje`) and "Ventas" (`window.EVE.registrosVentas`).
- Stats per tab: `totalRegistros`, `totalKg` (materials NOT in `window.MATERIALES_PZ`), `totalPz` (materials in `window.MATERIALES_PZ`) — `totalPz` only rendered when > 0.
- Compra ⇄ Venta toggle: Compra → free numeric ticket, label "Proveedor". Venta → ticket fixed to `"V"`, label "Cliente".
- No exports (TXT/PDF/CSV) and no voice input in this phase — later phases (3b, 3c).
- **XSS rule:** any value that came from a Firestore document or a form field must reach the DOM via `textContent` (or a property, never `innerHTML`/template-string interpolation). Static markup (headers, structure with no variable data) may use `innerHTML`.
- After create/update/delete, mutate `window.EVE.registrosDestaraje`/`registrosVentas` in memory directly — never re-fetch the whole collection.

---

## File Structure

```
eve-control-v2/
├── index.html        (Task 4 — add <script src="js/destaraje.js">)
├── css/
│   └── styles.css     (Task 4 — table/stats/badge/form-grid styles)
└── js/
    └── destaraje.js   (Tasks 1-3)
```

`js/destaraje.js` is built incrementally across three tasks but is one file (matches the project's one-file-per-module architecture):
- Task 1: pure helpers (no DOM, no Firestore) — appended first, Node-tested.
- Task 2: form + save/edit/delete wiring (DOM + Firestore) — appended second.
- Task 3: tabs/tables/stats/filters rendering, plus `renderDestaraje`/module registration — appended last, completing the file.

---

### Task 1: `js/destaraje.js` — pure helpers

**Files:**
- Create: `js/destaraje.js` (this task writes the file; Tasks 2-3 append to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.MATERIALES_PZ` (from `js/config.js`).
- Produces (attached to `window`, consumed by Task 3's rendering code):
  - `calcularStatsDestaraje(registros)` → `{ totalRegistros: number, totalKg: number, totalPz: number }`
  - `filtrarPorHoy(registros, hoy)` → `array` (registros where `fechaSalida === hoy`)
  - `filtrarPorSemana(registros, inicioSemana)` → `array` (registros where `fechaSalida >= inicioSemana`)
  - `aplicarFiltrosTodos(registros, filtros)` → `array`, where `filtros` is `{ ticket, desde, hasta, proveedor, material }` (all optional strings)
  - `valoresUnicos(arraysDeRegistros, campo, semillas)` → sorted `string[]`, deduplicated, uppercased
  - `construirRegistroDesdeFormulario(datos)` → `{ ticket, proveedor, material, kg: number, fechaEntrada, fechaSalida }`, throws `Error` with a user-facing Spanish message on invalid input

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
require('./js/destaraje.js');
const assert = require('assert');

const stats = window.calcularStatsDestaraje([
  { kg: 100, material: 'MIXTO' },
  { kg: 50, material: 'PET' },
  { kg: 400, material: 'TAMBO' }
]);
assert.deepStrictEqual(stats, { totalRegistros: 3, totalKg: 150, totalPz: 400 });

const hoy = window.filtrarPorHoy([
  { fechaSalida: '2026-06-24' }, { fechaSalida: '2026-06-23' }
], '2026-06-24');
assert.strictEqual(hoy.length, 1);

const semana = window.filtrarPorSemana([
  { fechaSalida: '2026-06-24' }, { fechaSalida: '2026-06-10' }
], '2026-06-22');
assert.strictEqual(semana.length, 1);

const filtrados = window.aplicarFiltrosTodos([
  { ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO', fechaSalida: '2026-06-24' },
  { ticket: '9261', proveedor: 'JUANA', material: 'PET', fechaSalida: '2026-06-20' }
], { proveedor: 'jose', desde: '', hasta: '', ticket: '', material: '' });
assert.strictEqual(filtrados.length, 1);
assert.strictEqual(filtrados[0].ticket, '9260');

const unicos = window.valoresUnicos([
  [{ proveedor: 'jose enrique' }, { proveedor: 'JUANA' }]
], 'proveedor', ['FRANCISCO']);
assert.deepStrictEqual(unicos, ['FRANCISCO', 'JOSE ENRIQUE', 'JUANA']);

const registro = window.construirRegistroDesdeFormulario({
  ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO',
  kg: '650', fechaEntrada: '2026-06-23', fechaSalida: '2026-06-24'
});
assert.deepStrictEqual(registro, {
  ticket: '9260', proveedor: 'JOSE ENRIQUE', material: 'MIXTO',
  kg: 650, fechaEntrada: '2026-06-23', fechaSalida: '2026-06-24'
});

assert.throws(() => window.construirRegistroDesdeFormulario({
  ticket: '9260', proveedor: 'X', material: 'Y', kg: '0', fechaEntrada: 'a', fechaSalida: 'b'
}), /Kg debe ser un número mayor a 0/);

console.log('DESTARAJE_HELPERS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/destaraje.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/destaraje.js`:

```javascript
function esMaterialPZ(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function calcularStatsDestaraje(registros) {
  let totalKg = 0;
  let totalPz = 0;
  for (const registro of registros) {
    if (esMaterialPZ(registro.material)) {
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
  const ticket = (filtros.ticket || '').toLowerCase();
  const proveedor = (filtros.proveedor || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (ticket && !String(r.ticket).toLowerCase().includes(ticket)) return false;
    if (proveedor && !String(r.proveedor).toLowerCase().includes(proveedor)) return false;
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
  if (!datos.ticket || !datos.proveedor || !datos.material || !datos.fechaEntrada || !datos.fechaSalida) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  return {
    ticket: datos.ticket,
    proveedor: datos.proveedor,
    material: datos.material,
    kg,
    fechaEntrada: datos.fechaEntrada,
    fechaSalida: datos.fechaSalida
  };
}

window.calcularStatsDestaraje = calcularStatsDestaraje;
window.filtrarPorHoy = filtrarPorHoy;
window.filtrarPorSemana = filtrarPorSemana;
window.aplicarFiltrosTodos = aplicarFiltrosTodos;
window.valoresUnicos = valoresUnicos;
window.construirRegistroDesdeFormulario = construirRegistroDesdeFormulario;
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `DESTARAJE_HELPERS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/destaraje.js
git commit -m "feat: add destaraje.js pure helpers (stats, filters, validation)"
```

---

### Task 2: `js/destaraje.js` — form, save/edit/delete wiring

**Files:**
- Modify: `js/destaraje.js` (append to the end of the file)
- Test: inline `node -e` smoke check (module-load + state shape only — full behavior is verified live in Task 4)

**Interfaces:**
- Consumes: `construirRegistroDesdeFormulario`, `valoresUnicos` (Task 1); `window.guardarDato`, `window.actualizarDato`, `window.eliminarDato`, `window.showSuccess`, `window.showError` (`js/utils.js`); `window.EVE.registrosDestaraje`/`registrosVentas`, `window.PROVEEDORES_COMUNES`, `window.MATERIALES_COMUNES` (`js/config.js`/`js/auth.js`).
- Produces (used by Task 3, and attached to `window` like every other function in this project — see Step 3): `crearFormulario()` → `HTMLFormElement`; `crearModalEdicion()` → `HTMLDivElement`; `abrirModalEdicion(registro)`, `actualizarDatalists()`, `aplicarModoFormulario()`; module-scoped mutable state `editandoId` (`string|null`) and `tipoFormulario` (`'compra'|'venta'`), declared with `let` at the top of this appended block (intentionally NOT attached to `window` — only Task 3's code in this same file reads/writes them).

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
global.PROVEEDORES_COMUNES = ['JOSE ENRIQUE'];
global.MATERIALES_COMUNES = ['MIXTO'];
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
require('./js/destaraje.js');
const assert = require('assert');
assert.strictEqual(typeof window.calcularStatsDestaraje, 'function');
assert.strictEqual(typeof window.crearFormulario, 'function');
assert.strictEqual(typeof window.crearModalEdicion, 'function');
console.log('DESTARAJE_FORM_LOADS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: nothing printed and a thrown `AssertionError` (`typeof window.crearFormulario` is the string `'undefined'`, which fails the `=== 'function'` check) — Task 1 alone doesn't define `crearFormulario`/`crearModalEdicion` yet.

- [ ] **Step 3: Append the implementation**

Append to `js/destaraje.js`:

```javascript
let editandoId = null;
let tipoFormulario = 'compra';

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
  const proveedores = valoresUnicos([window.EVE.registrosDestaraje], 'proveedor', window.PROVEEDORES_COMUNES);
  const clientes = valoresUnicos([window.EVE.registrosVentas], 'proveedor', []);
  const materiales = valoresUnicos(
    [window.EVE.registrosDestaraje, window.EVE.registrosVentas], 'material', window.MATERIALES_COMUNES
  );
  llenarDatalist('dl-proveedores', proveedores);
  llenarDatalist('dl-clientes', clientes);
  llenarDatalist('dl-materiales', materiales);
}

function aplicarModoFormulario() {
  const ticketInput = document.getElementById('df-ticket');
  const proveedorInput = document.getElementById('df-proveedor');
  proveedorInput.setAttribute('list', tipoFormulario === 'venta' ? 'dl-clientes' : 'dl-proveedores');
  proveedorInput.placeholder = tipoFormulario === 'venta' ? 'Cliente' : 'Proveedor';
  if (tipoFormulario === 'venta') {
    ticketInput.value = 'V';
    ticketInput.disabled = true;
  } else {
    ticketInput.disabled = false;
    if (ticketInput.value === 'V') ticketInput.value = '';
  }
}

function insertarRegistroEnMemoria(registro) {
  if (/^\d+$/.test(String(registro.ticket))) {
    window.EVE.registrosDestaraje.push(registro);
  } else if (registro.ticket === 'V') {
    window.EVE.registrosVentas.push(registro);
  }
}

function reemplazarRegistroEnMemoria(id, datos) {
  for (const lista of [window.EVE.registrosDestaraje, window.EVE.registrosVentas]) {
    const indice = lista.findIndex((r) => r.id === id);
    if (indice !== -1) {
      lista[indice] = { ...lista[indice], ...datos };
      return;
    }
  }
}

function eliminarRegistroEnMemoria(id) {
  for (const lista of [window.EVE.registrosDestaraje, window.EVE.registrosVentas]) {
    const indice = lista.findIndex((r) => r.id === id);
    if (indice !== -1) {
      lista.splice(indice, 1);
      return;
    }
  }
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    ticket: tipoFormulario === 'venta' ? 'V' : document.getElementById('df-ticket').value.trim(),
    proveedor: document.getElementById('df-proveedor').value.trim(),
    material: document.getElementById('df-material').value.trim().toUpperCase(),
    kg: document.getElementById('df-kg').value,
    fechaEntrada: document.getElementById('df-entrada').value,
    fechaSalida: document.getElementById('df-salida').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    const id = await window.guardarDato('destaraje', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    document.getElementById('destaraje-form').reset();
    aplicarModoFormulario();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'destaraje-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-tipo">
      <label><input type="radio" name="tipo" value="compra" checked> Compra</label>
      <label><input type="radio" name="tipo" value="venta"> Venta</label>
    </div>
    <div class="form-grid">
      <input type="text" id="df-ticket" placeholder="Ticket" required>
      <input type="text" id="df-proveedor" placeholder="Proveedor" list="dl-proveedores" required>
      <input type="text" id="df-material" placeholder="Material" list="dl-materiales" required>
      <input type="number" id="df-kg" placeholder="Kg" step="0.01" required>
      <input type="date" id="df-entrada" required>
      <input type="date" id="df-salida" required>
    </div>
    <datalist id="dl-proveedores"></datalist>
    <datalist id="dl-clientes"></datalist>
    <datalist id="dl-materiales"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelectorAll('input[name="tipo"]').forEach((radio) => {
    radio.addEventListener('change', (evento) => {
      tipoFormulario = evento.target.value;
      aplicarModoFormulario();
    });
  });
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    ticket: document.getElementById('de-ticket').value.trim(),
    proveedor: document.getElementById('de-proveedor').value.trim(),
    material: document.getElementById('de-material').value.trim().toUpperCase(),
    kg: document.getElementById('de-kg').value,
    fechaEntrada: document.getElementById('de-entrada').value,
    fechaSalida: document.getElementById('de-salida').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    await window.actualizarDato('destaraje', editandoId, registro);
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
  overlay.id = 'destaraje-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar registro</h3>
      <form id="destaraje-edit-form">
        <input type="text" id="de-ticket" placeholder="Ticket" required>
        <input type="text" id="de-proveedor" placeholder="Proveedor/Cliente" required>
        <input type="text" id="de-material" placeholder="Material" required>
        <input type="number" id="de-kg" placeholder="Kg" step="0.01" required>
        <input type="date" id="de-entrada" required>
        <input type="date" id="de-salida" required>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="de-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#destaraje-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#de-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('de-ticket').value = registro.ticket;
  document.getElementById('de-proveedor').value = registro.proveedor;
  document.getElementById('de-material').value = registro.material;
  document.getElementById('de-kg').value = registro.kg;
  document.getElementById('de-entrada').value = registro.fechaEntrada;
  document.getElementById('de-salida').value = registro.fechaSalida;
  document.getElementById('destaraje-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('destaraje-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await window.eliminarDato('destaraje', id);
  eliminarRegistroEnMemoria(id);
  renderizarVista();
  window.showSuccess('Registro eliminado');
}

window.crearFormulario = crearFormulario;
window.crearModalEdicion = crearModalEdicion;
window.abrirModalEdicion = abrirModalEdicion;
window.actualizarDatalists = actualizarDatalists;
window.aplicarModoFormulario = aplicarModoFormulario;
window.confirmarEliminar = confirmarEliminar;
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `DESTARAJE_FORM_LOADS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/destaraje.js
git commit -m "feat: add destaraje.js form, autocomplete, and CRUD wiring"
```

---

### Task 3: `js/destaraje.js` — tabs, tables, stats, filters, module registration

**Files:**
- Modify: `js/destaraje.js` (append to the end of the file — this completes it)
- Test: inline `node -e` smoke check (module-load + registration shape only — full behavior verified live in Task 4)

**Interfaces:**
- Consumes: `filtrarPorHoy`, `filtrarPorSemana`, `aplicarFiltrosTodos`, `calcularStatsDestaraje` (Task 1, via `window.*`); `crearFormulario`, `crearModalEdicion`, `abrirModalEdicion`, `actualizarDatalists`, `aplicarModoFormulario`, `confirmarEliminar` (Task 2, via `window.*`); `window.formatearKg` (`js/utils.js`); `window.obtenerFechaMexico`, `window.obtenerInicioSemana` (`js/utils.js`); `window.EVE.registrosDestaraje`/`registrosVentas` (`js/auth.js`); `window.EVE_MODULES` (`js/auth.js`).
- Produces: `window.EVE_MODULES.destaraje = { render(container) }` — the contract `js/auth.js`'s `renderModulo` (Phase 2) already calls.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.EVE = { registrosDestaraje: [], registrosVentas: [] };
global.EVE_MODULES = {};
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){} }, dataset: {},
    addEventListener(){}, appendChild(){}, removeChild(){}, querySelectorAll(){ return []; },
    querySelector(){ return fakeElement(); }, textContent: '', innerHTML: '', value: '', reset(){},
    setAttribute(){}
  };
}
global.document = {
  getElementById(){ return fakeElement(); },
  createElement(){ return fakeElement(); },
  querySelectorAll(){ return []; },
  querySelector(){ return fakeElement(); }
};
global.MATERIALES_PZ = ['TAMBO'];
global.PROVEEDORES_COMUNES = [];
global.MATERIALES_COMUNES = [];
global.formatearKg = (kg) => String(kg) + ' KG';
global.obtenerFechaMexico = () => '2026-06-24';
global.obtenerInicioSemana = () => '2026-06-22';
require('./js/destaraje.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_MODULES.destaraje.render, 'function');
window.EVE_MODULES.destaraje.render(fakeElement());
console.log('DESTARAJE_MODULE_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: a thrown `TypeError` — `window.EVE_MODULES.destaraje` is `undefined` because Tasks 1-2 never register it.

- [ ] **Step 3: Append the implementation**

Append to `js/destaraje.js`:

```javascript
let tabActiva = 'hoy';
let filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };

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
  div.id = 'destaraje-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'ft-ticket', etiqueta: '', placeholder: 'Ticket', tipo: 'text' },
    { id: 'ft-desde', etiqueta: 'Desde', placeholder: '', tipo: 'date' },
    { id: 'ft-hasta', etiqueta: 'Hasta', placeholder: '', tipo: 'date' },
    { id: 'ft-proveedor', etiqueta: '', placeholder: 'Proveedor/Cliente', tipo: 'text' },
    { id: 'ft-material', etiqueta: '', placeholder: 'Material', tipo: 'text' }
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
        ticket: document.getElementById('ft-ticket').value,
        desde: document.getElementById('ft-desde').value,
        hasta: document.getElementById('ft-hasta').value,
        proveedor: document.getElementById('ft-proveedor').value,
        material: document.getElementById('ft-material').value
      };
      renderizarVista();
    });
    div.appendChild(input);
  });
  return div;
}

function crearTabla(idTbody, titulo) {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const encabezado = document.createElement('h4');
  encabezado.textContent = titulo;
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Ticket</th><th>Proveedor/Cliente</th><th>Material</th><th>Kg</th><th>F. Entrada</th><th>F. Salida</th><th></th></tr>
    </thead>
    <tbody id="${idTbody}"></tbody>
  `;
  wrapper.appendChild(encabezado);
  wrapper.appendChild(tabla);
  return wrapper;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const valores = [
    registro.ticket, registro.proveedor, registro.material,
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

function llenarTabla(idTbody, registros) {
  const tbody = document.getElementById(idTbody);
  tbody.innerHTML = '';
  if (registros.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 7;
    celda.textContent = 'Sin registros';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  registros.forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let destaraje = window.EVE.registrosDestaraje;
  let ventas = window.EVE.registrosVentas;
  if (tabActiva === 'hoy') {
    const hoy = window.obtenerFechaMexico();
    destaraje = filtrarPorHoy(destaraje, hoy);
    ventas = filtrarPorHoy(ventas, hoy);
  } else if (tabActiva === 'semana') {
    const inicioSemana = window.obtenerInicioSemana();
    destaraje = filtrarPorSemana(destaraje, inicioSemana);
    ventas = filtrarPorSemana(ventas, inicioSemana);
  } else {
    destaraje = aplicarFiltrosTodos(destaraje, filtros);
    ventas = aplicarFiltrosTodos(ventas, filtros);
  }
  return { destaraje, ventas };
}

function renderizarStats(destaraje, ventas) {
  const stats = calcularStatsDestaraje([...destaraje, ...ventas]);
  const contenedor = document.getElementById('destaraje-stats');
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
  document.getElementById('destaraje-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const { destaraje, ventas } = obtenerRegistrosParaTab();
  renderizarStats(destaraje, ventas);
  llenarTabla('destaraje-tabla-destaraje', destaraje);
  llenarTabla('destaraje-tabla-ventas', ventas);
}

function renderDestaraje(container) {
  tabActiva = 'hoy';
  filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };
  editandoId = null;
  tipoFormulario = 'compra';

  container.appendChild(crearFormulario());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  const stats = document.createElement('div');
  stats.id = 'destaraje-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearTabla('destaraje-tabla-destaraje', 'Destaraje'));
  container.appendChild(crearTabla('destaraje-tabla-ventas', 'Ventas'));
  container.appendChild(crearModalEdicion());

  aplicarModoFormulario();
  actualizarDatalists();
  renderizarVista();
}

window.EVE_MODULES.destaraje = { render: renderDestaraje };
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `DESTARAJE_MODULE_OK`

- [ ] **Step 5: Commit**

```bash
git add js/destaraje.js
git commit -m "feat: add destaraje.js tabs, tables, stats, filters, and module registration"
```

---

### Task 4: CSS + `index.html` wiring + live Firebase check

**Files:**
- Modify: `css/styles.css` (append new rules)
- Modify: `index.html` (add one `<script>` tag)
- Test: Playwright script run via `node` (ephemeral, not committed — same pattern as `verify-phase1.js`/`verify-phase2.js`)

**Interfaces:**
- Consumes: `js/destaraje.js` (Tasks 1-3), the real Firestore `destaraje` collection in the `everplastic` project, `docs/superpowers/credenciales-phase2.json` (already gitignored, created in Phase 2 — reused here, not recreated).
- Produces: confirmation that Phase 3a's acceptance criteria hold. This task **writes and then deletes** two test records in the real `destaraje` collection — see Step 5.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q '\.destaraje-stats' css/styles.css && grep -q 'src="js/destaraje.js"' index.html && echo "WIRING_OK"
```

Expected: no `WIRING_OK` printed (neither the CSS rule nor the script tag exist yet).

- [ ] **Step 2: Append CSS and add the script tag**

Append to `css/styles.css`:

```css
.destaraje-form {
  margin-bottom: 1rem;
}

.form-tipo {
  display: flex;
  gap: 1rem;
  margin-bottom: 0.75rem;
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.destaraje-filtros {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.destaraje-stats {
  display: flex;
  gap: 1.5rem;
  font-weight: 600;
  margin-bottom: 1rem;
}

.destaraje-tabla-wrapper {
  margin-bottom: 1rem;
  overflow-x: auto;
}

.tabla-destaraje {
  width: 100%;
  border-collapse: collapse;
}

.tabla-destaraje th,
.tabla-destaraje td {
  text-align: left;
  padding: 0.5rem;
  border-bottom: 1px solid var(--gris-claro);
}

@media (min-width: 768px) {
  .form-grid,
  .destaraje-filtros {
    grid-template-columns: repeat(3, 1fr);
  }
}
```

In `index.html`, change:

```html
  <script src="js/auth.js"></script>
</body>
</html>
```

to:

```html
  <script src="js/auth.js"></script>
  <script src="js/destaraje.js"></script>
</body>
</html>
```

- [ ] **Step 3: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `WIRING_OK`

- [ ] **Step 4: Commit the markup/style change**

```bash
git add css/styles.css index.html
git commit -m "feat: wire destaraje.js into index.html and add its styles"
```

- [ ] **Step 5: Write and run the live-Firebase Playwright check**

This test **writes two real records** to the live `destaraje` collection and
**deletes them itself** as part of the test (the delete assertions double as
cleanup) — do not skip the delete steps even if an earlier assertion fails;
fix forward or manually delete the `88888888`-ticket record before re-running.

Create `docs/superpowers/verify-phase3a.js`:

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

  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('#destaraje-form');

  const TICKET_PRUEBA = '88888888';
  // Row-scoped locators everywhere below — never a bare "button:has-text(Eliminar)"
  // across the whole table. Real production rows coexist with the test row;
  // an earlier, unscoped version of this script deleted a real record because
  // it clicked the first "Eliminar" match across the whole table instead of
  // the one inside this specific row.
  const filaCompraPrueba = page.locator(`#destaraje-tabla-destaraje tr:has-text("${TICKET_PRUEBA}")`);

  await page.fill('#df-ticket', TICKET_PRUEBA);
  await page.fill('#df-proveedor', 'TEST PROVEEDOR QA');
  await page.fill('#df-material', 'MIXTO');
  await page.fill('#df-kg', '123');
  await page.fill('#df-entrada', '2026-06-24');
  await page.fill('#df-salida', '2026-06-24');
  await page.click('#destaraje-form button[type="submit"]');
  await page.waitForFunction(() => document.querySelectorAll('.toast-success').length > 0);

  console.log('HOY_TIENE_PRUEBA:', await filaCompraPrueba.count() === 1);

  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#ft-ticket', TICKET_PRUEBA);
  await page.waitForFunction((ticket) => {
    const filas = document.querySelectorAll('#destaraje-tabla-destaraje tr');
    return filas.length === 1 && filas[0].textContent.includes(ticket);
  }, TICKET_PRUEBA);
  console.log('FILTRO_OK');

  await filaCompraPrueba.locator('button:has-text("Editar")').click();
  await page.waitForSelector('#destaraje-modal-overlay.open');
  await page.fill('#de-kg', '456');
  await page.click('#destaraje-edit-form button[type="submit"]');
  await page.waitForFunction(() => !document.getElementById('destaraje-modal-overlay').classList.contains('open'));
  console.log('EDICION_OK:', await filaCompraPrueba.textContent().then((t) => t.includes('456 KG')));

  // Wait for the row itself to detach — not for "a toast-success exists",
  // which can be satisfied by a leftover toast from the edit step above and
  // make this check pass before the delete actually completes.
  await filaCompraPrueba.locator('button:has-text("Eliminar")').click();
  await filaCompraPrueba.waitFor({ state: 'detached' });
  console.log('ELIMINACION_COMPRA_OK:', await filaCompraPrueba.count() === 0);

  await page.fill('#ft-ticket', '');
  await page.click('input[name="tipo"][value="venta"]');
  await page.fill('#df-proveedor', 'TEST CLIENTE QA');
  await page.fill('#df-material', 'PET');
  await page.fill('#df-kg', '50');
  await page.fill('#df-entrada', '2026-06-24');
  await page.fill('#df-salida', '2026-06-24');
  await page.click('#destaraje-form button[type="submit"]');

  const filaVentaPrueba = page.locator('#destaraje-tabla-ventas tr:has-text("TEST CLIENTE QA")');
  await filaVentaPrueba.waitFor({ state: 'visible' });
  console.log('VENTA_CREADA_OK:', await filaVentaPrueba.count() === 1);

  await filaVentaPrueba.locator('button:has-text("Eliminar")').click();
  await page.waitForFunction(() =>
    !document.getElementById('destaraje-tabla-ventas').textContent.includes('TEST CLIENTE QA')
  );
  console.log('VENTA_ELIMINADA_OK:', await filaVentaPrueba.count() === 0);

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

Run:

```bash
cd "eve-control-v2"
(python -m http.server 8765 >/tmp/eve-server.log 2>&1 &)
sleep 1
node docs/superpowers/verify-phase3a.js
```

Expected output:
```
HOY_TIENE_PRUEBA: true
FILTRO_OK
EDICION_OK: true
ELIMINACION_COMPRA_OK: true
VENTA_CREADA_OK: true
VENTA_ELIMINADA_OK: true
CONSOLE_ERRORS: []
```

If `CONSOLE_ERRORS` is non-empty or any assertion hangs/times out, stop and
report — don't guess at a fix blindly (see systematic-debugging if the cause
isn't obvious). If the script fails partway through, check the live
`destaraje` collection for a leftover `88888888` or `TEST CLIENTE QA` record
and delete it manually (via the running app's own Eliminar button, or
Firebase console) before re-running.

**Incident from the actual run of this step:** an earlier version of this
script used an unscoped `page.click('#destaraje-tabla-ventas
button:has-text("Eliminar")')` while the real `destaraje` collection
happened to contain one other real venta record alongside the test one.
That click resolved to the first matching button in DOM order, which
deleted the **real** record instead of (or in addition to) the test one —
confirmed by checking the collection before/after and finding the real
venta gone and the test one still present. The fix (already reflected in
the script above) is to scope every interaction to a `Locator` built from a
test-specific row match (`tr:has-text(...)`) and call `.locator(...)` on
*that* for the action button, never a bare table-wide selector. **Lesson for
future phases' live-Firebase tests: never click an action button via a
selector that isn't scoped to a row uniquely identified by the test's own
marker data, when the target table can contain real production rows.**

- [ ] **Step 6: Stop the local server**

```bash
PID=$(netstat -ano | grep ':8765 ' | grep LISTENING | head -1 | awk '{print $NF}')
[ -n "$PID" ] && taskkill //PID "$PID" //F
```

- [ ] **Step 7: Commit the verification script**

```bash
git add docs/superpowers/verify-phase3a.js
git commit -m "test: add live-Firebase Playwright check for Phase 3a Destaraje CRUD"
```

---

## Self-Review Notes

- **Spec coverage:** form with Compra/Venta toggle (Task 2), autocomplete from real data + seed constants (Task 2), HOY/ESTA SEMANA/TODOS with `fechaSalida` as the reference date (Tasks 1, 3), two separate tables per tab (Task 3), stats split into `totalKg`/`totalPz` (Tasks 1, 3), real-time filters in TODOS (Tasks 1, 3), edit/delete via modal (Task 2), in-memory `window.EVE` mutation instead of re-fetch (Task 2) — all covered. No exports, no voice — correctly out of scope per the spec.
- **Placeholder scan:** none — every step has complete code and exact commands/expected output.
- **XSS check:** every Firestore- or form-sourced value reaches the DOM via `.textContent` or a direct property (`.value`), never via `innerHTML` string interpolation — `construirFilaTabla` (Task 3) for table cells, `llenarDatalist` (Task 2) for datalist `<option>`s. `innerHTML` is used only for fully static markup with no variables (`crearFormulario`, `crearModalEdicion`, `crearTabla`, the empty-state `Sin registros` row's container clear).
- **Type/interface consistency:** `window.EVE.registrosDestaraje`/`registrosVentas` (Phase 2's `auth.js`) ↔ Task 2/3's reads and in-memory mutations use the same names. `window.EVE_MODULES.destaraje.render` (Task 3) matches the exact contract `js/auth.js`'s `renderModulo` (Phase 2, already merged) expects. `formatearKg(kg, material)` (Phase 2's `utils.js`) signature matches Task 3's call site.

