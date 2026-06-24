# Fase 2 — `utils.js` + `auth.js` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Working login against real Firebase (`everplastic`), persistent session with permission-gated tabs, and `window.EVE` populated from a parallel Firestore load — building on the Phase 1 app shell.

**Architecture:** Two new vanilla-JS files (`js/utils.js`, `js/auth.js`), both attaching their public surface to `window` (same pattern as `js/config.js`). `auth.js` separates pure logic (ticket classification, permission→tabs mapping) from DOM-wiring (login form, tab rendering, logout) so the pure logic is unit-testable in Node while the DOM/Firestore integration is verified end-to-end with Playwright against the live Firebase project.

**Tech Stack:** Vanilla JS, Firebase Firestore (compat SDK, already initialized in `js/config.js`), `localStorage`, Playwright (already a devDependency from Phase 1, used via `node docs/superpowers/verify-phase1.js`-style scripts).

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-23-utils-auth-design.md`.
- `localStorage` key for the session: `'eve_session'`.
- Permission keys (exact, from `docs/PROMPT_ORIGINAL_EVE_CONTROL.md`): `destaraje`, `produccion`, `pagos`, `controlProduccion`, `reportes`, `admin`.
- Tab order (fixed): Destaraje → Producción → Pagos → Control Producción → Reportes. `admin` is not a tab — it gates `#btn-admin` visibility.
- Ticket classification on the `destaraje` collection: ticket matching `/^\d+$/` → `registrosDestaraje`; ticket `=== 'V'` → `registrosVentas`; anything else is dropped (not expected in practice).
- Dates stay `YYYY-MM-DD` internally (Firestore storage, comparisons). `formatearFecha` converts to `DD/MM/AAAA` for display only — never the reverse.
- Timezone for `obtenerFechaMexico`/`obtenerInicioSemana`: `'America/Mexico_City'`.
- Passwords are compared as plain text (matches the existing production data in Firestore) — no hashing introduced in this phase.
- Real-data verification (Task 3) uses the 3 real users already documented in `docs/PROMPT_ORIGINAL_EVE_CONTROL.md` (Admin, Matilde, Christian) — read-only Firestore calls (login + initial data load), no writes.
- No business-module logic, no Reportes/Admin/Voz, no service worker — out of scope (later phases).

---

## File Structure

```
eve-control-v2/
├── index.html        (Task 3 — add <script> tags for utils.js and auth.js)
└── js/
    ├── utils.js       (Task 1)
    └── auth.js        (Task 2)
```

---

### Task 1: `js/utils.js`

**Files:**
- Create: `js/utils.js`
- Test: inline `node -e` smoke check (no file created)

**Interfaces:**
- Consumes: `window.MATERIALES_PZ` (from `js/config.js`, Phase 1); `window.db` (Firestore instance, from `js/config.js`) for the 4 CRUD wrappers; `document`/`URL`/`Blob` (browser-only — see note below) for `descargarArchivo`/`exportarCSV`/`showSuccess`/`showError`.
- Produces (all attached to `window`):
  - `formatearKg(valor, material)` → `string`
  - `formatearMoneda(valor)` → `string`
  - `formatearFecha(fechaISO)` → `string` (`"DD/MM/AAAA"`)
  - `obtenerFechaMexico()` → `string` (`"YYYY-MM-DD"`)
  - `obtenerInicioSemana()` → `string` (`"YYYY-MM-DD"`)
  - `descargarArchivo(blob, nombre)` → `void`
  - `exportarCSV(datos, nombre)` → `void`
  - `guardarDato(coleccion, datos)` → `Promise<string>` (new doc id)
  - `actualizarDato(coleccion, id, datos)` → `Promise<void>`
  - `eliminarDato(coleccion, id)` → `Promise<void>`
  - `cargarDatos(coleccion)` → `Promise<Array<{id: string, ...}>>`
  - `showSuccess(mensaje)` → `void`
  - `showError(mensaje)` → `void`

Note: `descargarArchivo`, `exportarCSV`, `showSuccess`, `showError` need a real DOM and are re-verified end-to-end in Task 3's Playwright script (browser context), in addition to this task's Node check for the other 9 functions.

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
global.db = {
  collection(name) {
    return {
      add: async (datos) => ({ id: 'NEWID', _datos: datos }),
      doc: (id) => ({
        update: async () => {},
        delete: async () => {}
      }),
      get: async () => ({
        docs: [
          { id: 'abc', data: () => ({ proveedor: 'X' }) }
        ]
      })
    };
  }
};
require('./js/utils.js');
const assert = require('assert');
assert.strictEqual(window.formatearKg(650, 'MIXTO'), '650 KG');
assert.strictEqual(window.formatearKg(400, 'tambo'), '400 PZ');
assert.strictEqual(window.formatearMoneda(15000), '\$15,000.00');
assert.strictEqual(window.formatearFecha('2026-04-23'), '23/04/2026');
assert.match(window.obtenerFechaMexico(), /^\d{4}-\d{2}-\d{2}\$/);
assert.match(window.obtenerInicioSemana(), /^\d{4}-\d{2}-\d{2}\$/);
window.guardarDato('destaraje', { ticket: '1' }).then((id) => {
  assert.strictEqual(id, 'NEWID');
  return window.actualizarDato('destaraje', 'abc', { kg: 1 });
}).then(() => window.eliminarDato('destaraje', 'abc'))
  .then(() => window.cargarDatos('destaraje'))
  .then((registros) => {
    assert.deepStrictEqual(registros, [{ id: 'abc', proveedor: 'X' }]);
    console.log('UTILS_OK');
  })
  .catch((err) => { console.error(err); process.exit(1); });
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: `Error: Cannot find module './js/utils.js'` (exit code 1) — the file doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `js/utils.js`:

```javascript
window.formatearKg = function (valor, material) {
  const mat = (material || '').toString().trim().toUpperCase();
  const unidad = window.MATERIALES_PZ.includes(mat) ? 'PZ' : 'KG';
  return `${Number(valor).toLocaleString('es-MX')} ${unidad}`;
};

window.formatearMoneda = function (valor) {
  return Number(valor).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
};

window.formatearFecha = function (fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
};

window.obtenerFechaMexico = function () {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
};

window.obtenerInicioSemana = function () {
  const hoy = new Date(`${window.obtenerFechaMexico()}T00:00:00`);
  const diaSemana = hoy.getDay();
  const offset = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - offset);
  const yyyy = lunes.getFullYear();
  const mm = String(lunes.getMonth() + 1).padStart(2, '0');
  const dd = String(lunes.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

window.descargarArchivo = function (blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

window.exportarCSV = function (datos, nombre) {
  if (!datos.length) {
    window.showError('No hay datos para exportar');
    return;
  }
  const headers = Object.keys(datos[0]);
  const filas = datos.map((fila) => headers.map((h) => JSON.stringify(fila[h] ?? '')).join(','));
  const csv = [headers.join(','), ...filas].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  window.descargarArchivo(blob, nombre);
};

window.guardarDato = async function (coleccion, datos) {
  const datosCompletos = { ...datos };
  if (!datosCompletos.fechaRegistro) {
    datosCompletos.fechaRegistro = new Date().toISOString();
  }
  const ref = await window.db.collection(coleccion).add(datosCompletos);
  return ref.id;
};

window.actualizarDato = async function (coleccion, id, datos) {
  await window.db.collection(coleccion).doc(id).update(datos);
};

window.eliminarDato = async function (coleccion, id) {
  await window.db.collection(coleccion).doc(id).delete();
};

window.cargarDatos = async function (coleccion) {
  const snapshot = await window.db.collection(coleccion).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

function mostrarToast(mensaje, claseTipo, duracionMs) {
  const contenedor = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${claseTipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);
  setTimeout(() => toast.remove(), duracionMs);
}

window.showSuccess = function (mensaje) {
  mostrarToast(mensaje, 'toast-success', 3000);
};

window.showError = function (mensaje) {
  mostrarToast(mensaje, 'toast-error', 4000);
};
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `UTILS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/utils.js
git commit -m "feat: add utils.js (formatters, Firestore CRUD wrappers, toasts)"
```

---

### Task 2: `js/auth.js`

**Files:**
- Create: `js/auth.js`
- Test: inline `node -e` smoke check (no file created)

**Interfaces:**
- Consumes: `window.cargarDatos(coleccion)` and `window.COLECCIONES` (Task 1 / `js/config.js` — stubbed directly in this task's Node test, not required from the real files, to keep the test isolated).
- Produces:
  - `window.EVE` — `{ currentUser, registrosDestaraje, registrosVentas, registrosProduccion, registrosPagos, registrosMinistraciones, registrosControlProduccion }`
  - `window.EVE_MODULES` — `{}` (empty registry; later phases add `{ render(container) {...} }` per module id)
  - `window.clasificarDestaraje(registros)` → `{ destaraje: array, ventas: array }`
  - `window.tabsVisiblesPorPermiso(permissions)` → `Array<{ permiso, id, nombre }>`
  - DOM wiring (not unit-tested here, covered in Task 3): login form submit handler, `#btn-salir` click handler, tab rendering, auto-login on load.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.localStorage = {
  _data: {},
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null; },
  setItem(k, v) { this._data[k] = v; },
  removeItem(k) { delete this._data[k]; }
};
function fakeElement() {
  return {
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
    addEventListener() {},
    appendChild() {},
    removeChild() {},
    querySelectorAll() { return []; },
    textContent: '',
    innerHTML: ''
  };
}
global.document = {
  getElementById() { return fakeElement(); },
  createElement() { return fakeElement(); },
  querySelectorAll() { return []; }
};
global.cargarDatos = async () => [];
global.COLECCIONES = {
  USERS: 'users', DESTARAJE: 'destaraje', PRODUCCION: 'produccion',
  PAGOS: 'pagos', MINISTRACIONES: 'ministraciones', CONTROL_PRODUCCION: 'control_produccion'
};
require('./js/auth.js');
const assert = require('assert');
assert.strictEqual(window.EVE.currentUser, null);
assert.deepStrictEqual(window.EVE.registrosDestaraje, []);
assert.deepStrictEqual(window.EVE_MODULES, {});
const clasificado = window.clasificarDestaraje([
  { ticket: '9260' }, { ticket: 'V' }, { ticket: '9261' }, { ticket: 'RARO' }
]);
assert.strictEqual(clasificado.destaraje.length, 2);
assert.strictEqual(clasificado.ventas.length, 1);
const tabs = window.tabsVisiblesPorPermiso({
  destaraje: true, produccion: false, pagos: true, controlProduccion: false, reportes: true, admin: false
});
assert.deepStrictEqual(tabs.map((t) => t.id), ['destaraje', 'pagos', 'reportes']);
console.log('AUTH_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: `Error: Cannot find module './js/auth.js'` (exit code 1) — the file doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `js/auth.js`:

```javascript
window.EVE = {
  currentUser: null,
  registrosDestaraje: [],
  registrosVentas: [],
  registrosProduccion: [],
  registrosPagos: [],
  registrosMinistraciones: [],
  registrosControlProduccion: []
};

window.EVE_MODULES = {};

const SESSION_KEY = 'eve_session';
const ORDEN_TABS = [
  { permiso: 'destaraje', id: 'destaraje', nombre: 'Destaraje' },
  { permiso: 'produccion', id: 'produccion', nombre: 'Producción' },
  { permiso: 'pagos', id: 'pagos', nombre: 'Pagos' },
  { permiso: 'controlProduccion', id: 'controlProduccion', nombre: 'Control Producción' },
  { permiso: 'reportes', id: 'reportes', nombre: 'Reportes' }
];

function clasificarDestaraje(registros) {
  const destaraje = [];
  const ventas = [];
  for (const registro of registros) {
    const ticket = String(registro.ticket ?? '');
    if (/^\d+$/.test(ticket)) {
      destaraje.push(registro);
    } else if (ticket === 'V') {
      ventas.push(registro);
    }
  }
  return { destaraje, ventas };
}

function tabsVisiblesPorPermiso(permissions) {
  if (!permissions) return [];
  return ORDEN_TABS.filter((tab) => permissions[tab.permiso] === true);
}

window.clasificarDestaraje = clasificarDestaraje;
window.tabsVisiblesPorPermiso = tabsVisiblesPorPermiso;

async function cargarDatosEnParalelo() {
  const [destarajeRaw, produccion, pagos, ministraciones, controlProduccion] = await Promise.all([
    window.cargarDatos(window.COLECCIONES.DESTARAJE),
    window.cargarDatos(window.COLECCIONES.PRODUCCION),
    window.cargarDatos(window.COLECCIONES.PAGOS),
    window.cargarDatos(window.COLECCIONES.MINISTRACIONES),
    window.cargarDatos(window.COLECCIONES.CONTROL_PRODUCCION)
  ]);
  const { destaraje, ventas } = clasificarDestaraje(destarajeRaw);
  window.EVE.registrosDestaraje = destaraje;
  window.EVE.registrosVentas = ventas;
  window.EVE.registrosProduccion = produccion;
  window.EVE.registrosPagos = pagos;
  window.EVE.registrosMinistraciones = ministraciones;
  window.EVE.registrosControlProduccion = controlProduccion;
}

function renderModulo(moduloId) {
  const contenedor = document.getElementById('main-content');
  contenedor.innerHTML = '';
  const modulo = window.EVE_MODULES[moduloId];
  if (modulo && typeof modulo.render === 'function') {
    modulo.render(contenedor);
  } else {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Módulo en construcción';
    contenedor.appendChild(mensaje);
  }
}

function activarTab(moduloId) {
  document.querySelectorAll('#tabs-container .tab').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.modulo === moduloId);
  });
  renderModulo(moduloId);
}

function renderTabs(permissions) {
  const contenedor = document.getElementById('tabs-container');
  contenedor.innerHTML = '';
  const tabs = tabsVisiblesPorPermiso(permissions);
  tabs.forEach((tab, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = tab.nombre;
    boton.dataset.modulo = tab.id;
    boton.addEventListener('click', () => activarTab(tab.id));
    contenedor.appendChild(boton);
  });
  document.getElementById('btn-admin').style.display = permissions && permissions.admin ? '' : 'none';
  if (tabs.length > 0) activarTab(tabs[0].id);
}

function mostrarAppShell() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').classList.add('visible');
}

function mostrarLoginScreen() {
  document.getElementById('app-shell').classList.remove('visible');
  document.getElementById('login-screen').style.display = '';
  document.getElementById('login-error').textContent = '';
}

async function iniciarSesion(username, password) {
  const usuarios = await window.cargarDatos(window.COLECCIONES.USERS);
  const usuario = usuarios.find((u) => u.username === username && u.password === password);
  if (!usuario) {
    throw new Error('Usuario o contraseña incorrectos');
  }
  if (usuario.active !== true) {
    throw new Error('Usuario desactivado. Contacta al administrador.');
  }
  window.EVE.currentUser = usuario;
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: usuario.id,
    username: usuario.username,
    permissions: usuario.permissions
  }));
  await cargarDatosEnParalelo();
  mostrarAppShell();
  renderTabs(usuario.permissions);
}

function cerrarSesion() {
  localStorage.removeItem(SESSION_KEY);
  window.EVE.currentUser = null;
  window.EVE.registrosDestaraje = [];
  window.EVE.registrosVentas = [];
  window.EVE.registrosProduccion = [];
  window.EVE.registrosPagos = [];
  window.EVE.registrosMinistraciones = [];
  window.EVE.registrosControlProduccion = [];
  mostrarLoginScreen();
}

async function intentarAutoLogin() {
  const guardada = localStorage.getItem(SESSION_KEY);
  if (!guardada) return;
  let sesion;
  try {
    sesion = JSON.parse(guardada);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  const usuarios = await window.cargarDatos(window.COLECCIONES.USERS);
  const usuario = usuarios.find((u) => u.id === sesion.userId);
  if (!usuario || usuario.active !== true) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  window.EVE.currentUser = usuario;
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: usuario.id,
    username: usuario.username,
    permissions: usuario.permissions
  }));
  await cargarDatosEnParalelo();
  mostrarAppShell();
  renderTabs(usuario.permissions);
}

document.getElementById('login-form').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  errorDiv.textContent = '';
  try {
    await iniciarSesion(username, password);
  } catch (error) {
    errorDiv.textContent = error.message;
  }
});

document.getElementById('btn-salir').addEventListener('click', cerrarSesion);

intentarAutoLogin();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `AUTH_OK`

- [ ] **Step 5: Commit**

```bash
git add js/auth.js
git commit -m "feat: add auth.js (login, session, permissions, window.EVE)"
```

---

### Task 3: Wire `index.html` + live Firebase integration check

**Files:**
- Modify: `index.html` (add two `<script>` tags)
- Test: Playwright script run via `node` (ephemeral, not committed — same pattern as `docs/superpowers/verify-phase1.js`)

**Interfaces:**
- Consumes: `js/utils.js` (Task 1), `js/auth.js` (Task 2), the real Firestore `users`/`destaraje`/`produccion`/`pagos`/`ministraciones`/`control_produccion` collections in the `everplastic` project (already configured in `js/config.js`).
- Produces: confirmation that Phase 2's acceptance criteria hold. No new reusable artifact beyond the modified `index.html`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q 'src="js/utils.js"' index.html && grep -q 'src="js/auth.js"' index.html && echo "SCRIPTS_OK"
```

Expected: no `SCRIPTS_OK` printed (the tags don't exist in `index.html` yet).

- [ ] **Step 2: Modify `index.html`**

In `index.html`, change:

```html
  <!-- App -->
  <script src="js/config.js"></script>
</body>
</html>
```

to:

```html
  <!-- App -->
  <script src="js/config.js"></script>
  <script src="js/utils.js"></script>
  <script src="js/auth.js"></script>
</body>
</html>
```

- [ ] **Step 3: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `SCRIPTS_OK`

- [ ] **Step 4: Commit the markup change**

```bash
git add index.html
git commit -m "feat: load utils.js and auth.js in index.html"
```

- [ ] **Step 5: Write and run the live-Firebase Playwright check**

Create a temporary file `docs/superpowers/verify-phase2.js` (same throwaway-tooling pattern as `verify-phase1.js` from Phase 1):

```javascript
const { chromium } = require('playwright');

const CREDENCIALES = require('./credenciales-phase2.json');

async function login(page, username, password) {
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('#login-form button[type="submit"]');
}

async function logout(page) {
  await page.click('#btn-salir');
  await page.waitForSelector('#login-screen', { state: 'visible' });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto('http://localhost:8765/index.html', { waitUntil: 'load' });

  // 1. Wrong password
  await login(page, CREDENCIALES.admin.username, 'contraseña-incorrecta');
  await page.waitForFunction(() => document.getElementById('login-error').textContent.length > 0);
  console.log('WRONG_PASSWORD_MESSAGE:', await page.textContent('#login-error'));

  // 2. Admin login
  await page.fill('#login-username', '');
  await page.fill('#login-password', '');
  await login(page, CREDENCIALES.admin.username, CREDENCIALES.admin.password);
  await page.waitForSelector('#app-shell.visible');
  const tabsAdmin = await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent));
  const adminBtnVisible = await page.isVisible('#btn-admin');
  console.log('ADMIN_TABS:', JSON.stringify(tabsAdmin), 'ADMIN_BTN_VISIBLE:', adminBtnVisible);
  const eveSnapshot = await page.evaluate(() => ({
    destaraje: window.EVE.registrosDestaraje.length,
    ventas: window.EVE.registrosVentas.length,
    produccion: window.EVE.registrosProduccion.length,
    pagos: window.EVE.registrosPagos.length,
  }));
  console.log('EVE_COUNTS:', JSON.stringify(eveSnapshot));

  // toasts + exportarCSV smoke check (utils.js DOM helpers)
  await page.evaluate(() => { window.showSuccess('ok prueba'); window.showError('error prueba'); });
  const toastCounts = await page.evaluate(() => ({
    success: document.querySelectorAll('.toast-success').length,
    error: document.querySelectorAll('.toast-error').length
  }));
  console.log('TOAST_COUNTS:', JSON.stringify(toastCounts));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(() => window.exportarCSV([{ a: 1, b: 2 }], 'prueba.csv'))
  ]);
  console.log('DOWNLOAD_FILENAME:', download.suggestedFilename());

  await logout(page);

  // 3. Matilde login
  await login(page, CREDENCIALES.matilde.username, CREDENCIALES.matilde.password);
  await page.waitForSelector('#app-shell.visible');
  console.log('MATILDE_TABS:', JSON.stringify(await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent))));
  console.log('MATILDE_ADMIN_BTN_VISIBLE:', await page.isVisible('#btn-admin'));
  await logout(page);

  // 4. Christian login
  await login(page, CREDENCIALES.christian.username, CREDENCIALES.christian.password);
  await page.waitForSelector('#app-shell.visible');
  console.log('CHRISTIAN_TABS:', JSON.stringify(await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent))));

  // 5. Auto-login on reload
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#app-shell.visible');
  console.log('AUTOLOGIN_TABS:', JSON.stringify(await page.$$eval('#tabs-container .tab', (els) => els.map((e) => e.textContent))));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));

  await browser.close();
})();
```

Create `docs/superpowers/credenciales-phase2.json` (gitignored — add `docs/superpowers/credenciales-phase2.json` to `.gitignore` first) with the 3 real users' exact `username`/`password` values from `docs/PROMPT_ORIGINAL_EVE_CONTROL.md`'s "USUARIOS Y PERMISOS" section:

```json
{
  "admin": { "username": "Admin", "password": "<de docs/PROMPT_ORIGINAL_EVE_CONTROL.md>" },
  "matilde": { "username": "Matilde", "password": "<de docs/PROMPT_ORIGINAL_EVE_CONTROL.md>" },
  "christian": { "username": "Christian", "password": "<de docs/PROMPT_ORIGINAL_EVE_CONTROL.md>" }
}
```

Run:

```bash
cd "eve-control-v2" && echo "docs/superpowers/credenciales-phase2.json" >> .gitignore
(python -m http.server 8765 >/tmp/eve-server.log 2>&1 &)
sleep 1
node docs/superpowers/verify-phase2.js
```

Expected output (values will vary for the EVE_COUNTS based on real data, but shape/labels must match):
```
WRONG_PASSWORD_MESSAGE: Usuario o contraseña incorrectos
ADMIN_TABS: ["Destaraje","Producción","Pagos","Control Producción","Reportes"]
ADMIN_BTN_VISIBLE: true
EVE_COUNTS: {"destaraje":<n>,"ventas":<n>,"produccion":<n>,"pagos":<n>}
TOAST_COUNTS: {"success":1,"error":1}
DOWNLOAD_FILENAME: prueba.csv
MATILDE_TABS: ["Destaraje","Reportes"]
MATILDE_ADMIN_BTN_VISIBLE: false
CHRISTIAN_TABS: ["Producción","Pagos","Reportes"]
AUTOLOGIN_TABS: ["Producción","Pagos","Reportes"]
CONSOLE_ERRORS: []
```

If `CONSOLE_ERRORS` is non-empty, or any tab list / button visibility doesn't match, stop and report — don't guess at a fix blindly (see systematic-debugging if the cause isn't obvious from the error text).

- [ ] **Step 6: Stop the local server**

```bash
PID=$(netstat -ano | grep ':8765 ' | grep LISTENING | head -1 | awk '{print $NF}')
[ -n "$PID" ] && taskkill //PID "$PID" //F
```

- [ ] **Step 7: Commit the verification script (not the credentials file)**

```bash
git add docs/superpowers/verify-phase2.js .gitignore
git commit -m "test: add live-Firebase Playwright check for Phase 2 login flow"
```

---

## Self-Review Notes

- **Spec coverage:** all 13 `utils.js` functions (Task 1), `window.EVE` + `window.EVE_MODULES` + login/session/logout/auto-login/tab-rendering (Task 2 + Task 3), the 3-real-user + wrong-password + logout + auto-login acceptance criteria (Task 3) — all covered.
- **Placeholder scan:** none — every step has complete code and exact commands/expected output. The one literal placeholder-looking text, `"Módulo en construcción"`, is the actual intended UI string from the spec, not a TODO.
- **Type/interface consistency:** `cargarDatos`/`guardarDato`/`actualizarDato`/`eliminarDato` signatures match between Task 1's definition and Task 2's usage (`window.cargarDatos(window.COLECCIONES.X)`). `window.EVE` keys match between Task 2's definition and Task 3's `eveSnapshot` check. Permission keys (`destaraje`, `produccion`, `pagos`, `controlProduccion`, `reportes`, `admin`) match between the spec, `ORDEN_TABS`, and Task 3's expected tab lists for each real user.
- **Security note carried into the plan:** Task 3 introduces `docs/superpowers/credenciales-phase2.json` to hold real plaintext passwords for the live test — explicitly gitignored before it's created, never committed.
