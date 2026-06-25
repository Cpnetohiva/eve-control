# Fase 8a — Panel Admin: Gestión de Usuarios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working "Admin" panel reachable from the existing `#btn-admin` header button: a Usuarios sub-screen with a table of existing users, create/edit via a modal (including inline password reset), and activate/deactivate — with no permanent deletion and self-lockout protection.

**Architecture:** Two new files. `js/admin-usuarios.js` is self-contained: pure validation/payload helpers, then the table + modal + CRUD wiring, exposing `window.EVE_ADMIN_USUARIOS`. `js/admin.js` is the Panel Admin "shell" — it owns the `#btn-admin` click handler (auth.js keeps owning only the button's visibility), renders a sub-tab bar (today just "Usuarios", built to grow in future sub-phases), and delegates the Usuarios screen to `js/admin-usuarios.js`. No existing file changes — this phase is entirely additive.

**Tech Stack:** Vanilla JS, Firebase Firestore (via `js/utils.js`), Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-gestion-usuarios-design.md`.
- `users` collection document shape (already in use by `js/auth.js`, no schema change):
  ```javascript
  {
    username: string,
    password: string,       // plain text, same as today
    active: boolean,
    permissions: {
      destaraje: boolean, produccion: boolean, pagos: boolean,
      controlProduccion: boolean, reportes: boolean, admin: boolean
    },
    fechaRegistro: string    // ISO, added automatically by guardarDato()
  }
  ```
- The 6 permission keys, in this exact order everywhere (table display, modal checkboxes): `destaraje, produccion, pagos, controlProduccion, reportes, admin` — same order as `ORDEN_TABS` in `js/auth.js:14-19`, with `admin` appended last.
- Username uniqueness: exact-match comparison (`===`), same criterion `js/auth.js:122` already uses for login. Validated against in-memory loaded users, never a Firestore query.
- Password: required to create, optional to edit (empty = unchanged — omit the `password` key entirely from the update payload, never write an empty string).
- No permanent user deletion anywhere in this phase. Activate/deactivate via `active: boolean` is the only lifecycle action.
- Self-protection (compare against `window.EVE.currentUser.id`): the Activar/Desactivar button on the logged-in user's own row is disabled; the "Admin" permission checkbox AND the "Activo" checkbox inside that same user's own edit modal are both disabled (the modal's "Activo" checkbox must be blocked too — otherwise it's an open path to self-deactivation that completely bypasses the row button's lock).
- No caching in `window.EVE` — `js/admin-usuarios.js` calls `window.cargarDatos(window.COLECCIONES.USERS)` itself, every time the Usuarios screen opens and after every create/update/toggle, storing the result in a module-scoped variable.
- **Zero changes to `js/auth.js` or any other existing file** — `js/admin.js` attaches its own `addEventListener` to the pre-existing `#btn-admin` element; `js/auth.js` keeps the only code that sets that button's `style.display`.
- XSS rule (same as every prior module): any Firestore-/form-derived value reaching the DOM uses `.textContent`/`.value`, never `innerHTML` string interpolation. Static markup, or markup interpolating only hardcoded constants (e.g. the `PERMISOS_DISPLAY` array below), may use `innerHTML`.
- Namespace rule (Phase 5 onward): `window.EVE_ADMIN_USUARIOS` and `window.EVE_ADMIN` are each built once as an object literal / `Object.assign` target, never reassigned wholesale.

---

## File Structure

```
eve-control-v2/
├── index.html                  (Task 4 — add <script> tags for admin-usuarios.js then admin.js, after reportes-ui.js)
├── css/
│   └── styles.css              (Task 4 — new classes for the Admin shell, user table actions, permission checkboxes)
├── js/
│   ├── admin-usuarios.js       (Tasks 1-2, new)
│   └── admin.js                (Task 3, new)
└── docs/superpowers/
    └── verify-phase8a.js       (Task 4, new — live Playwright check)
```

Build order: `admin-usuarios.js`'s pure helpers (Task 1) have zero dependencies, so they go first. Its DOM layer (Task 2) only needs Task 1's helpers plus `js/utils.js`/`js/config.js` (already merged). `admin.js` (Task 3) is built last since it's the only piece that calls into `window.EVE_ADMIN_USUARIOS` and owns the `#btn-admin` wiring. Task 4 wires the two files into `index.html`, adds CSS, and is the only task that actually exercises the feature in a real browser.

---

### Task 1: `js/admin-usuarios.js` — validation and payload helpers

**Files:**
- Create: `js/admin-usuarios.js` (this task writes the file; Task 2 appends to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: nothing — pure functions over plain data passed in by the caller.
- Produces (on `window.EVE_ADMIN_USUARIOS`):
  - `PERMISOS_DISPLAY` → `[{ clave: 'destaraje', nombre: 'Destaraje' }, { clave: 'produccion', nombre: 'Producción' }, { clave: 'pagos', nombre: 'Pagos' }, { clave: 'controlProduccion', nombre: 'Control Producción' }, { clave: 'reportes', nombre: 'Reportes' }, { clave: 'admin', nombre: 'Admin' }]`.
  - `listarNombresPermisos(permissions)` → `string[]` (display names of keys that are `=== true`; `[]` if `permissions` is falsy or has none true).
  - `validarUsername(username, usuarios, idExcluir)` → `string|null` (error message, or `null` if valid). `usuarios` is an array of `{ id, username, ... }`. `idExcluir` lets editing a user keep its own username (pass `null` when creating).
  - `validarPassword(password, esEdicion)` → `string|null` (error message, or `null` if valid). Required only when `esEdicion === false`.
  - `construirPayloadUsuario(datos, esEdicion)` → `object` (`{ username, permissions, active, password? }`). `datos = { username, password, permissions, active }`. `username` is trimmed. `password` is included only when `!esEdicion` or when `datos.password` is non-empty.
  - `esUsuarioActual(usuario, currentUserId)` → `boolean` (`usuario.id === currentUserId`).

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
require('./js/admin-usuarios.js');
const assert = require('assert');
const AU = window.EVE_ADMIN_USUARIOS;

assert.deepStrictEqual(AU.listarNombresPermisos({ destaraje: true, admin: true, pagos: false }), ['Destaraje', 'Admin']);
assert.deepStrictEqual(AU.listarNombresPermisos({}), []);
assert.deepStrictEqual(AU.listarNombresPermisos(null), []);

const usuarios = [{ id: 'u1', username: 'admin' }, { id: 'u2', username: 'operador1' }];
assert.strictEqual(AU.validarUsername('  ', usuarios, null), 'El nombre de usuario es obligatorio');
assert.strictEqual(AU.validarUsername('admin', usuarios, null), 'Ya existe un usuario con ese nombre');
assert.strictEqual(AU.validarUsername('admin', usuarios, 'u1'), null);
assert.strictEqual(AU.validarUsername('nuevo', usuarios, null), null);

assert.strictEqual(AU.validarPassword('', false), 'La contraseña es obligatoria para crear un usuario');
assert.strictEqual(AU.validarPassword('', true), null);
assert.strictEqual(AU.validarPassword('clave123', false), null);

const permissions = { destaraje: true, produccion: false, pagos: false, controlProduccion: false, reportes: false, admin: false };
const payloadCrear = AU.construirPayloadUsuario({ username: ' nuevo ', password: 'clave123', permissions, active: true }, false);
assert.deepStrictEqual(payloadCrear, { username: 'nuevo', permissions, active: true, password: 'clave123' });

const payloadEditarSinPassword = AU.construirPayloadUsuario({ username: 'nuevo', password: '', permissions, active: false }, true);
assert.strictEqual('password' in payloadEditarSinPassword, false);
assert.strictEqual(payloadEditarSinPassword.active, false);

const payloadEditarConPassword = AU.construirPayloadUsuario({ username: 'nuevo', password: 'otra', permissions, active: true }, true);
assert.strictEqual(payloadEditarConPassword.password, 'otra');

assert.strictEqual(AU.esUsuarioActual({ id: 'u1' }, 'u1'), true);
assert.strictEqual(AU.esUsuarioActual({ id: 'u1' }, 'u2'), false);

console.log('ADMIN_USUARIOS_HELPERS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/admin-usuarios.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/admin-usuarios.js`:

```javascript
(function () {

const PERMISOS_DISPLAY = [
  { clave: 'destaraje', nombre: 'Destaraje' },
  { clave: 'produccion', nombre: 'Producción' },
  { clave: 'pagos', nombre: 'Pagos' },
  { clave: 'controlProduccion', nombre: 'Control Producción' },
  { clave: 'reportes', nombre: 'Reportes' },
  { clave: 'admin', nombre: 'Admin' }
];

function listarNombresPermisos(permissions) {
  if (!permissions) return [];
  return PERMISOS_DISPLAY.filter((p) => permissions[p.clave] === true).map((p) => p.nombre);
}

function validarUsername(username, usuarios, idExcluir) {
  const limpio = (username || '').trim();
  if (!limpio) return 'El nombre de usuario es obligatorio';
  const duplicado = usuarios.some((u) => u.username === limpio && u.id !== idExcluir);
  if (duplicado) return 'Ya existe un usuario con ese nombre';
  return null;
}

function validarPassword(password, esEdicion) {
  if (!esEdicion && (!password || password.length === 0)) {
    return 'La contraseña es obligatoria para crear un usuario';
  }
  return null;
}

function construirPayloadUsuario(datos, esEdicion) {
  const payload = {
    username: datos.username.trim(),
    permissions: { ...datos.permissions },
    active: datos.active === true
  };
  if (!esEdicion || (datos.password && datos.password.length > 0)) {
    payload.password = datos.password;
  }
  return payload;
}

function esUsuarioActual(usuario, currentUserId) {
  return usuario.id === currentUserId;
}

window.EVE_ADMIN_USUARIOS = {
  PERMISOS_DISPLAY,
  listarNombresPermisos,
  validarUsername,
  validarPassword,
  construirPayloadUsuario,
  esUsuarioActual
};

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_USUARIOS_HELPERS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-usuarios.js
git commit -m "feat: add admin-usuarios.js validation and payload helpers"
```

---

### Task 2: `js/admin-usuarios.js` — user table, create/edit modal, CRUD

**Files:**
- Modify: `js/admin-usuarios.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (module-load + DOM construction only — full live behavior verified in Task 4)

**Interfaces:**
- Consumes: `PERMISOS_DISPLAY`, `listarNombresPermisos`, `validarUsername`, `validarPassword`, `construirPayloadUsuario`, `esUsuarioActual` (Task 1, same file, bare identifiers); `window.cargarDatos`, `window.guardarDato`, `window.actualizarDato`, `window.showSuccess`, `window.showError` (`js/utils.js`); `window.COLECCIONES.USERS` (`js/config.js`); `window.EVE.currentUser` (`js/auth.js`).
- Produces (added to `window.EVE_ADMIN_USUARIOS`, which Task 1 already created): `crearVistaUsuarios()` → `HTMLDivElement` (table card + create/edit modal, both wired and appended; calling it also kicks off the initial fetch). Module-scoped state (`usuariosCargados`, `editandoId`) stays unexported.
- Each table row carries `data-user-id` (the Firestore doc id) so the live verification task can target a specific row without relying on visible text alone.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
function fakeElement() {
  return {
    style: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } }, dataset: {},
    children: [], disabled: false, checked: false, value: '', textContent: '', innerHTML: '',
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
global.window.cargarDatos = async () => [];
global.window.COLECCIONES = { USERS: 'users' };
global.window.EVE = { currentUser: { id: 'admin1' } };
require('./js/admin-usuarios.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_ADMIN_USUARIOS.crearVistaUsuarios, 'function');
const vista = window.EVE_ADMIN_USUARIOS.crearVistaUsuarios();
assert.ok(vista);
console.log('ADMIN_USUARIOS_VISTA_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: an `AssertionError` (`typeof window.EVE_ADMIN_USUARIOS.crearVistaUsuarios` is `'undefined'`) — Task 1 alone doesn't define it yet.

- [ ] **Step 3: Insert the implementation**

In `js/admin-usuarios.js`, find this anchor:

```javascript
window.EVE_ADMIN_USUARIOS = {
  PERMISOS_DISPLAY,
  listarNombresPermisos,
  validarUsername,
  validarPassword,
  construirPayloadUsuario,
  esUsuarioActual
};

})();
```

Replace it with:

```javascript
window.EVE_ADMIN_USUARIOS = {
  PERMISOS_DISPLAY,
  listarNombresPermisos,
  validarUsername,
  validarPassword,
  construirPayloadUsuario,
  esUsuarioActual
};

let usuariosCargados = [];
let editandoId = null;

async function cargarUsuarios() {
  usuariosCargados = await window.cargarDatos(window.COLECCIONES.USERS);
  renderizarTabla();
}

function renderizarTabla() {
  const cuerpo = document.getElementById('admin-usuarios-tabla-body');
  cuerpo.innerHTML = '';
  usuariosCargados.forEach((usuario) => {
    const fila = document.createElement('tr');
    fila.dataset.userId = usuario.id;

    const celdaUsername = document.createElement('td');
    celdaUsername.textContent = usuario.username;

    const celdaPermisos = document.createElement('td');
    const nombres = listarNombresPermisos(usuario.permissions);
    celdaPermisos.textContent = nombres.length > 0 ? nombres.join(', ') : 'Ninguno';

    const celdaActivo = document.createElement('td');
    celdaActivo.textContent = usuario.active ? '✓' : '✗';

    const celdaAcciones = document.createElement('td');
    const grupoAcciones = document.createElement('div');
    grupoAcciones.className = 'admin-usuarios-acciones';
    const botonEditar = document.createElement('button');
    botonEditar.type = 'button';
    botonEditar.textContent = 'Editar';
    botonEditar.className = 'btn-secondary';
    botonEditar.addEventListener('click', () => abrirModalUsuario(usuario));
    const botonToggle = document.createElement('button');
    botonToggle.type = 'button';
    botonToggle.textContent = usuario.active ? 'Desactivar' : 'Activar';
    botonToggle.className = 'btn-secondary';
    botonToggle.disabled = esUsuarioActual(usuario, window.EVE.currentUser.id);
    botonToggle.addEventListener('click', () => manejarToggleActivo(usuario));
    grupoAcciones.appendChild(botonEditar);
    grupoAcciones.appendChild(botonToggle);
    celdaAcciones.appendChild(grupoAcciones);

    fila.appendChild(celdaUsername);
    fila.appendChild(celdaPermisos);
    fila.appendChild(celdaActivo);
    fila.appendChild(celdaAcciones);
    cuerpo.appendChild(fila);
  });
}

async function manejarToggleActivo(usuario) {
  const accion = usuario.active ? 'Desactivar' : 'Activar';
  if (!confirm(`¿${accion} a ${usuario.username}?`)) return;
  try {
    await window.actualizarDato(window.COLECCIONES.USERS, usuario.id, { active: !usuario.active });
    await cargarUsuarios();
    window.showSuccess(usuario.active ? 'Usuario desactivado' : 'Usuario activado');
  } catch (error) {
    window.showError(error.message);
  }
}

function construirCheckboxesPermisos() {
  return PERMISOS_DISPLAY
    .map((p) => `<label class="admin-usuarios-permiso"><input type="checkbox" id="au-permiso-${p.clave}"> ${p.nombre}</label>`)
    .join('');
}

function crearModalUsuario() {
  const overlay = document.createElement('div');
  overlay.id = 'admin-usuarios-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3 id="au-modal-titulo">Nuevo Usuario</h3>
      <form id="admin-usuarios-form">
        <input type="text" id="au-username" placeholder="Username" required>
        <input type="password" id="au-password" placeholder="Password">
        <div class="admin-usuarios-permisos">${construirCheckboxesPermisos()}</div>
        <label class="admin-usuarios-permiso"><input type="checkbox" id="au-activo" checked> Activo</label>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="au-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#admin-usuarios-form').addEventListener('submit', manejarEnvioFormulario);
  overlay.querySelector('#au-cancelar').addEventListener('click', cerrarModalUsuario);
  return overlay;
}

function abrirModalUsuario(usuario) {
  editandoId = usuario ? usuario.id : null;
  document.getElementById('au-modal-titulo').textContent = usuario ? 'Editar Usuario' : 'Nuevo Usuario';
  document.getElementById('au-username').value = usuario ? usuario.username : '';
  const passwordInput = document.getElementById('au-password');
  passwordInput.value = '';
  passwordInput.placeholder = usuario ? 'Dejar vacío para no cambiar' : 'Password';
  PERMISOS_DISPLAY.forEach((p) => {
    const checkbox = document.getElementById(`au-permiso-${p.clave}`);
    checkbox.checked = usuario ? usuario.permissions[p.clave] === true : false;
    checkbox.disabled = false;
  });
  const activoCheckbox = document.getElementById('au-activo');
  activoCheckbox.checked = usuario ? usuario.active === true : true;
  activoCheckbox.disabled = false;
  if (usuario && esUsuarioActual(usuario, window.EVE.currentUser.id)) {
    document.getElementById('au-permiso-admin').disabled = true;
    activoCheckbox.disabled = true;
  }
  document.getElementById('admin-usuarios-modal-overlay').classList.add('open');
}

function cerrarModalUsuario() {
  document.getElementById('admin-usuarios-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const username = document.getElementById('au-username').value;
  const password = document.getElementById('au-password').value;
  const esEdicion = editandoId !== null;

  const errorUsername = validarUsername(username, usuariosCargados, editandoId);
  if (errorUsername) { window.showError(errorUsername); return; }
  const errorPassword = validarPassword(password, esEdicion);
  if (errorPassword) { window.showError(errorPassword); return; }

  const permissions = {};
  PERMISOS_DISPLAY.forEach((p) => {
    permissions[p.clave] = document.getElementById(`au-permiso-${p.clave}`).checked === true;
  });
  const payload = construirPayloadUsuario({
    username,
    password,
    permissions,
    active: document.getElementById('au-activo').checked === true
  }, esEdicion);

  try {
    if (esEdicion) {
      await window.actualizarDato(window.COLECCIONES.USERS, editandoId, payload);
    } else {
      await window.guardarDato(window.COLECCIONES.USERS, payload);
    }
    cerrarModalUsuario();
    await cargarUsuarios();
    window.showSuccess(esEdicion ? 'Usuario actualizado' : 'Usuario creado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearVistaUsuarios() {
  const wrapper = document.createElement('div');
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-usuarios';
  tarjeta.innerHTML = `
    <div class="admin-usuarios-header">
      <h3>Usuarios</h3>
      <button type="button" id="admin-usuarios-nuevo" class="btn-primary">+ Nuevo Usuario</button>
    </div>
    <div class="destaraje-tabla-wrapper">
      <table class="tabla-destaraje">
        <thead><tr><th>Username</th><th>Permisos</th><th>Activo</th><th>Acciones</th></tr></thead>
        <tbody id="admin-usuarios-tabla-body"></tbody>
      </table>
    </div>
  `;
  tarjeta.querySelector('#admin-usuarios-nuevo').addEventListener('click', () => abrirModalUsuario(null));
  wrapper.appendChild(tarjeta);
  wrapper.appendChild(crearModalUsuario());
  cargarUsuarios();
  return wrapper;
}

Object.assign(window.EVE_ADMIN_USUARIOS, {
  crearVistaUsuarios
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_USUARIOS_VISTA_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-usuarios.js
git commit -m "feat: add admin-usuarios.js table, create/edit modal, and CRUD"
```

---

### Task 3: `js/admin.js` — Panel Admin shell

**Files:**
- Create: `js/admin.js`
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.EVE_ADMIN_USUARIOS.crearVistaUsuarios()` (Task 2); `#btn-admin`, `#main-content`, `#tabs-container .tab` (existing DOM, `index.html`/`js/auth.js` — read/clicked only, never modified in source).
- Produces: `window.EVE_ADMIN = { renderAdmin(container) }`. Attaches its own `click` listener to `#btn-admin` at load time (mirrors how `js/auth.js` wires `#login-form`/`#btn-salir` directly, outside the `EVE_MODULES` system — Admin is not a regular tab in `ORDEN_TABS`).

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

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
require('./js/admin.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_ADMIN.renderAdmin, 'function');
const contenedor = fakeElement();
window.EVE_ADMIN.renderAdmin(contenedor);
assert.ok(contenedor.children.length > 0);
console.log('ADMIN_SHELL_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/admin.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/admin.js`:

```javascript
(function () {

const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' }
];

let subpestanaActiva = 'usuarios';

function renderizarSubpestana(contenedor) {
  contenedor.innerHTML = '';
  if (subpestanaActiva === 'usuarios') {
    contenedor.appendChild(window.EVE_ADMIN_USUARIOS.crearVistaUsuarios());
  }
}

function crearSubnav() {
  const nav = document.createElement('div');
  nav.className = 'tabs';
  SUBPESTANAS.forEach((sub) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (sub.id === subpestanaActiva ? ' active' : '');
    boton.textContent = sub.nombre;
    boton.dataset.subpestana = sub.id;
    boton.addEventListener('click', () => {
      subpestanaActiva = sub.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.subpestana === sub.id));
      renderizarSubpestana(document.getElementById('admin-contenido'));
    });
    nav.appendChild(boton);
  });
  return nav;
}

function renderAdmin(container) {
  subpestanaActiva = 'usuarios';
  container.appendChild(crearSubnav());
  const contenido = document.createElement('div');
  contenido.id = 'admin-contenido';
  container.appendChild(contenido);
  renderizarSubpestana(contenido);
}

function mostrarPanelAdmin() {
  document.querySelectorAll('#tabs-container .tab').forEach((boton) => boton.classList.remove('active'));
  const contenedor = document.getElementById('main-content');
  contenedor.innerHTML = '';
  renderAdmin(contenedor);
}

window.EVE_ADMIN = {
  renderAdmin
};

document.getElementById('btn-admin').addEventListener('click', mostrarPanelAdmin);

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_SHELL_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin.js
git commit -m "feat: add admin.js Panel Admin shell wired to btn-admin"
```

---

### Task 4: Wire into `index.html`, add CSS, live verification

**Files:**
- Modify: `index.html`
- Modify: `css/styles.css`
- Create: `docs/superpowers/verify-phase8a.js`

**Interfaces:**
- Consumes: nothing new — this task only wires already-built pieces together and exercises them in a real browser.
- Produces: nothing consumed by later tasks (this is the final task of this plan).

- [ ] **Step 1: Add the script tags**

In `index.html`, find:

```html
  <script src="js/control-produccion.js"></script>
  <script src="js/reportes-ui.js"></script>
</body>
```

Replace with:

```html
  <script src="js/control-produccion.js"></script>
  <script src="js/reportes-ui.js"></script>
  <script src="js/admin-usuarios.js"></script>
  <script src="js/admin.js"></script>
</body>
```

- [ ] **Step 2: Add the CSS**

In `css/styles.css`, append at the end of the file:

```css
/* ===== Panel Admin ===== */

.admin-usuarios {
  margin-bottom: 1rem;
}

.admin-usuarios-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.admin-usuarios-acciones {
  display: flex;
  gap: 0.5rem;
}

.admin-usuarios-permisos {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin: 0.75rem 0;
}

.admin-usuarios-permiso {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
}
```

- [ ] **Step 3: Start the local server**

Run (from `eve-control-v2/`, in the background if your tooling supports it):

```bash
npx http-server -p 8765 .
```

- [ ] **Step 4: Write the live verification script**

Create `docs/superpowers/verify-phase8a.js`:

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

  await page.click('#btn-admin');
  await page.waitForSelector('#admin-usuarios-nuevo');
  await page.waitForSelector('#admin-usuarios-tabla-body tr');

  const filasIniciales = await page.locator('#admin-usuarios-tabla-body tr').count();
  console.log('TABLA_CARGA_OK:', filasIniciales > 0);

  const usernamePrueba = `prueba_8a_${Date.now()}`;
  await page.click('#admin-usuarios-nuevo');
  await page.waitForSelector('.modal-overlay.open');
  await page.fill('#au-username', usernamePrueba);
  await page.fill('#au-password', 'clave_prueba_123');
  await page.check('#au-permiso-destaraje');
  await page.check('#au-permiso-reportes');
  await page.click('#admin-usuarios-form button[type="submit"]');
  await page.waitForSelector('#admin-usuarios-modal-overlay.open', { state: 'hidden' });

  const filaPrueba = page.locator(`tr:has-text("${usernamePrueba}")`);
  await filaPrueba.waitFor();
  const textoPermisosCreado = await filaPrueba.locator('td').nth(1).textContent();
  console.log('CREAR_USUARIO_OK:', textoPermisosCreado.includes('Destaraje') && textoPermisosCreado.includes('Reportes'));

  const testUserId = await filaPrueba.getAttribute('data-user-id');

  // Username duplicado: debe bloquear el guardado, sin crear una segunda fila
  await page.click('#admin-usuarios-nuevo');
  await page.waitForSelector('.modal-overlay.open');
  await page.fill('#au-username', usernamePrueba);
  await page.fill('#au-password', 'otra_clave');
  await page.click('#admin-usuarios-form button[type="submit"]');
  await page.waitForTimeout(300);
  const filasConMismoUsername = await page.locator(`tr:has-text("${usernamePrueba}")`).count();
  console.log('USERNAME_DUPLICADO_BLOQUEADO_OK:', filasConMismoUsername === 1);
  await page.click('#au-cancelar');

  // Editar: agregar un permiso, dejar password vacío
  const filaPruebaParaEditar = page.locator(`tr[data-user-id="${testUserId}"]`);
  await filaPruebaParaEditar.locator('button:has-text("Editar")').click();
  await page.waitForSelector('.modal-overlay.open');
  await page.check('#au-permiso-pagos');
  await page.click('#admin-usuarios-form button[type="submit"]');
  await page.waitForSelector('#admin-usuarios-modal-overlay.open', { state: 'hidden' });
  await page.waitForTimeout(300);
  const filaPruebaActualizada = page.locator(`tr[data-user-id="${testUserId}"]`);
  const textoPermisosEditado = await filaPruebaActualizada.locator('td').nth(1).textContent();
  console.log('EDITAR_USUARIO_OK:', textoPermisosEditado.includes('Pagos'));

  // Desactivar
  await filaPruebaActualizada.locator('button:has-text("Desactivar")').click();
  await page.waitForTimeout(300);
  const textoActivoFinal = await filaPruebaActualizada.locator('td').nth(2).textContent();
  console.log('DESACTIVAR_USUARIO_OK:', textoActivoFinal.trim() === '✗');

  // Auto-bloqueo: el propio usuario admin no puede desactivarse ni quitarse su propio permiso Admin
  const filaAdminActual = page.locator(`tr:has-text("${CREDENCIALES.admin.username}")`);
  const botonToggleAdmin = filaAdminActual.locator('button:has-text("Desactivar"), button:has-text("Activar")');
  console.log('AUTOBLOQUEO_DESACTIVAR_OK:', await botonToggleAdmin.isDisabled());

  await filaAdminActual.locator('button:has-text("Editar")').click();
  await page.waitForSelector('.modal-overlay.open');
  console.log('AUTOBLOQUEO_ADMIN_CHECKBOX_OK:', await page.locator('#au-permiso-admin').isDisabled());
  console.log('AUTOBLOQUEO_ACTIVO_CHECKBOX_OK:', await page.locator('#au-activo').isDisabled());
  await page.click('#au-cancelar');

  // Limpieza: borrar el usuario de prueba directamente en Firestore (no hay borrado permanente en la UI)
  await page.evaluate(async (id) => {
    await window.eliminarDato(window.COLECCIONES.USERS, id);
  }, testUserId);
  const usuariosFinal = await page.evaluate(async () => {
    return await window.cargarDatos(window.COLECCIONES.USERS);
  });
  console.log('LIMPIEZA_OK:', !usuariosFinal.some((u) => u.id === testUserId));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

- [ ] **Step 5: Run the live verification script**

Run:

```bash
node docs/superpowers/verify-phase8a.js
```

Expected: every line ends in `true`, and `CONSOLE_ERRORS: []`.

- [ ] **Step 6: Commit**

```bash
git add index.html css/styles.css docs/superpowers/verify-phase8a.js
git commit -m "feat: wire admin-usuarios.js and admin.js into the app, add live verification"
```

---

## Self-Review Notes

- **Spec coverage:** Arquitectura (admin.js shell + admin-usuarios.js, `#btn-admin` wiring, no `auth.js` changes) → Tasks 2-3-4. Datos (users shape, 6 permission keys, refetch-not-cache) → Tasks 1-2, called out in Global Constraints. Validación (username unique, password required-on-create) → Task 1, exercised live in Task 4. UI (table, create/edit modal, activar/desactivar, self-protection) → Task 2, exercised live in Task 4. Archivos → Task 4. All spec sections have a task.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command.
- **Type consistency:** `crearVistaUsuarios()` (Task 2) is the only function `js/admin.js` (Task 3) calls — checked the name and zero-argument signature match across both tasks. `PERMISOS_DISPLAY`'s `clave` values (`destaraje`/`produccion`/`pagos`/`controlProduccion`/`reportes`/`admin`) are used identically to build checkbox ids (`au-permiso-${clave}`) in Task 2's `construirCheckboxesPermisos`, `abrirModalUsuario`, and `manejarEnvioFormulario` — same source array, no risk of drift.
