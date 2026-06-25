# Fase 8c — Panel Admin: Backup/Exportación + Configuración del Sistema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two new Panel Admin sub-tabs — "Backup" (JSON/Excel full export, "Probar Telegram") and "Configuración" (edit Telegram token/Chat ID/report-schedule preference) — built as two independent files that each touch the shared `config/telegram` Firestore document on their own.

**Architecture:** `js/admin-backup.js` and `js/admin-config.js` are each built bottom-up: pure helpers first (Node-testable, zero DOM/Firestore), then the DOM/view layer that consumes them. `js/admin.js` (Fase 8a/8b) gains two more sub-tabs, unchanged otherwise.

**Tech Stack:** Vanilla JS, `XLSX` global (CDN, already loaded), Firebase Firestore `db.collection('config').doc('telegram')`, Playwright for live verification.

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-25-backup-config-design.md`.
- Backup (JSON and Excel) covers exactly 5 modules: Destaraje (Compra + Venta combined into one array — they live in the same Firestore collection), Producción, Pagos, Ministraciones, Control de Producción. **The `users` collection is never included in any backup, in any format.**
- Backup reads only from already-loaded `window.EVE.registros*` arrays — no new Firestore reads for the backup itself.
- "Probar Telegram" sends a real `sendMessage` call with the fixed text `"✅ Prueba de conexión EVE Control"` to the configured `chatId` — not a `getMe` call. Same guard pattern, same error message, as `js/reportes.js`'s `enviarReporteTelegram` (`js/reportes.js:647-655`): check `configDoc.exists` then `token`/`chatId` truthiness, throw `'Configura el token de Telegram primero (Firestore: config/telegram)'` before any `fetch` if either check fails.
- Configuración del Sistema writes `{ token, chatId, horaReporte }` to `config/telegram` via `.set(datos, { merge: true })` — **never** via the generic `window.actualizarDato` helper (which uses `.update()` and would throw if the document doesn't exist yet, e.g. on a fresh environment with Telegram never configured).
- Default `horaReporte` shown when the document doesn't have one yet (or doesn't exist): `'20:00'`.
- Validation: Token and Chat ID must be non-empty after `trim()` to save; no format validation on their content. The horario field is always valid by construction (`<input type="time">`).
- **This phase builds no actual scheduled-send mechanism** — `horaReporte` is purely a stored preference; nothing in this codebase wakes up and sends anything at that time.
- Namespace rule: `window.EVE_ADMIN_BACKUP` and `window.EVE_ADMIN_CONFIG` are each built once as an object literal, extended only via `Object.assign` in later tasks.
- XSS rule: any Firestore-derived value reaching the DOM uses `.textContent`/`.value`, never `innerHTML` string interpolation. Static markup, or markup interpolating only a hardcoded constant (e.g. the default `'20:00'`), may use `innerHTML`.
- No changes to `js/reportes.js`, `js/admin-usuarios.js`, `js/admin-importar.js`, `js/auth.js`, or any operational module.
- **Standing checklist item from the Fase 8b final review**: every new Panel Admin sub-tab multiplies the "switch away before an async fetch resolves" race surface (a real bug was found and fixed twice in Fase 8a/8b for exactly this pattern). Any `document.getElementById(...)` call that occurs after an `await` boundary in this phase's two new files must be guarded against the element no longer existing (`if (!elemento) return;`), before any write to it. Applies to `admin-config.js`'s `cargarConfiguracion` (the only such call site in this plan's Tasks 1-4 — `probarTelegram` and `manejarGuardar` only touch toast helpers after their `await`s, never `getElementById`).

---

## File Structure

```
eve-control-v2/
├── index.html                  (Task 5 — add <script> tags for admin-backup.js and admin-config.js, before admin.js)
├── css/
│   └── styles.css              (Task 5 — new classes for the backup buttons and config form)
├── js/
│   ├── admin-backup.js         (Tasks 1-2, new)
│   └── admin-config.js         (Tasks 3-4, new)
└── docs/superpowers/
    └── verify-phase8c.js       (Task 5, new — live Playwright check)
```

Build order: each file's pure helpers (Tasks 1 and 3) have zero dependencies and go first. Each file's view layer (Tasks 2 and 4) only needs its own file's pure helpers plus `js/utils.js`/`js/config.js` (already merged). Task 5 wires both files into `index.html`/`js/admin.js`, adds CSS, and is the only task that runs against a real browser and real Firestore.

---

### Task 1: `js/admin-backup.js` — pure backup-object builder

**Files:**
- Create: `js/admin-backup.js` (this task writes the file; Task 2 appends to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: nothing — pure function over plain data passed in by the caller.
- Produces (on `window.EVE_ADMIN_BACKUP`): `construirBackupCompleto(datos)` → `{ destaraje, produccion, pagos, ministraciones, controlProduccion }`, where `datos = { registrosDestaraje, registrosVentas, registrosProduccion, registrosPagos, registrosMinistraciones, registrosControlProduccion }` (plain arrays, same shape as the corresponding `window.EVE.*` arrays). `destaraje` in the result is `registrosDestaraje` concatenated with `registrosVentas`, in that order. The result object has exactly these 5 keys — never a `users` key, under any circumstance.

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
require('./js/admin-backup.js');
const assert = require('assert');
const AB = window.EVE_ADMIN_BACKUP;

const backup = AB.construirBackupCompleto({
  registrosDestaraje: [{ id: 'd1', ticket: '9260' }],
  registrosVentas: [{ id: 'v1', ticket: 'V' }],
  registrosProduccion: [{ id: 'p1', ticket: 'P' }],
  registrosPagos: [{ id: 'pg1', ticket: '9260' }],
  registrosMinistraciones: [{ id: 'm1' }],
  registrosControlProduccion: [{ id: 'cp1', ticket: 'P-001' }]
});

assert.deepStrictEqual(backup.destaraje, [{ id: 'd1', ticket: '9260' }, { id: 'v1', ticket: 'V' }]);
assert.deepStrictEqual(backup.produccion, [{ id: 'p1', ticket: 'P' }]);
assert.deepStrictEqual(backup.pagos, [{ id: 'pg1', ticket: '9260' }]);
assert.deepStrictEqual(backup.ministraciones, [{ id: 'm1' }]);
assert.deepStrictEqual(backup.controlProduccion, [{ id: 'cp1', ticket: 'P-001' }]);
assert.strictEqual('users' in backup, false);
assert.strictEqual(Object.keys(backup).length, 5);

const vacio = AB.construirBackupCompleto({
  registrosDestaraje: [], registrosVentas: [], registrosProduccion: [],
  registrosPagos: [], registrosMinistraciones: [], registrosControlProduccion: []
});
assert.deepStrictEqual(vacio.destaraje, []);

console.log('ADMIN_BACKUP_CONSTRUIR_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/admin-backup.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/admin-backup.js`:

```javascript
(function () {

function construirBackupCompleto(datos) {
  return {
    destaraje: [...datos.registrosDestaraje, ...datos.registrosVentas],
    produccion: datos.registrosProduccion,
    pagos: datos.registrosPagos,
    ministraciones: datos.registrosMinistraciones,
    controlProduccion: datos.registrosControlProduccion
  };
}

window.EVE_ADMIN_BACKUP = {
  construirBackupCompleto
};

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_BACKUP_CONSTRUIR_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-backup.js
git commit -m "feat: add admin-backup.js pure backup-object builder"
```

---

### Task 2: `js/admin-backup.js` — JSON/Excel export, Probar Telegram, view

**Files:**
- Modify: `js/admin-backup.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (module-load + DOM construction only — full live behavior verified in Task 5)

**Interfaces:**
- Consumes: `construirBackupCompleto` (Task 1, same file, bare identifier); `window.descargarArchivo`, `window.obtenerFechaMexico`, `window.showSuccess`, `window.showError` (`js/utils.js`); `window.EVE.registrosDestaraje`/`registrosVentas`/`registrosProduccion`/`registrosPagos`/`registrosMinistraciones`/`registrosControlProduccion` (`js/auth.js`); `window.db` (`js/config.js`); the global `XLSX` object (CDN, `index.html`).
- Produces (added to `window.EVE_ADMIN_BACKUP`): `generarBackupJSON()` → `void` (builds the backup object, downloads `Backup_EVE_Control_<fecha>.json`); `generarBackupExcel()` → `void` (same data, downloads `Backup_EVE_Control_<fecha>.xlsx` with 5 sheets named `Destaraje`/`Produccion`/`Pagos`/`Ministraciones`/`ControlProduccion`); `probarTelegram()` → `Promise<void>` (reads `config/telegram`, sends a real test message, shows a success/error toast); `crearVistaBackup()` → `HTMLDivElement`.

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
    setAttribute(){}, getAttribute(){ return null; },
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
global.window.EVE = {
  registrosDestaraje: [], registrosVentas: [], registrosProduccion: [],
  registrosPagos: [], registrosMinistraciones: [], registrosControlProduccion: []
};
require('./js/admin-backup.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_ADMIN_BACKUP.crearVistaBackup, 'function');
const vista = window.EVE_ADMIN_BACKUP.crearVistaBackup();
assert.ok(vista);
console.log('ADMIN_BACKUP_VISTA_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: an `AssertionError` (`typeof window.EVE_ADMIN_BACKUP.crearVistaBackup` is `'undefined'`) — Task 1 alone doesn't define it yet.

- [ ] **Step 3: Insert the implementation**

In `js/admin-backup.js`, find this anchor:

```javascript
window.EVE_ADMIN_BACKUP = {
  construirBackupCompleto
};

})();
```

Replace it with:

```javascript
window.EVE_ADMIN_BACKUP = {
  construirBackupCompleto
};

function obtenerDatosActuales() {
  return {
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosVentas: window.EVE.registrosVentas,
    registrosProduccion: window.EVE.registrosProduccion,
    registrosPagos: window.EVE.registrosPagos,
    registrosMinistraciones: window.EVE.registrosMinistraciones,
    registrosControlProduccion: window.EVE.registrosControlProduccion
  };
}

function generarBackupJSON() {
  const backup = construirBackupCompleto(obtenerDatosActuales());
  const texto = JSON.stringify(backup, null, 2);
  const blob = new Blob([texto], { type: 'application/json;charset=utf-8;' });
  window.descargarArchivo(blob, `Backup_EVE_Control_${window.obtenerFechaMexico()}.json`);
}

function generarBackupExcel() {
  const backup = construirBackupCompleto(obtenerDatosActuales());
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.destaraje), 'Destaraje');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.produccion), 'Produccion');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.pagos), 'Pagos');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.ministraciones), 'Ministraciones');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.controlProduccion), 'ControlProduccion');
  XLSX.writeFile(libro, `Backup_EVE_Control_${window.obtenerFechaMexico()}.xlsx`);
}

async function probarTelegram() {
  try {
    const configDoc = await window.db.collection('config').doc('telegram').get();
    if (!configDoc.exists) {
      throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
    }
    const { token, chatId } = configDoc.data();
    if (!token || !chatId) {
      throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
    }
    const respuesta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ Prueba de conexión EVE Control' })
    });
    const resultado = await respuesta.json();
    if (!resultado.ok) {
      throw new Error(`Telegram rechazó el mensaje: ${resultado.description || 'error desconocido'}`);
    }
    window.showSuccess('Mensaje de prueba enviado a Telegram');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearVistaBackup() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-backup';
  tarjeta.innerHTML = `
    <h3>Backup / Exportación</h3>
    <div class="admin-backup-botones">
      <button type="button" id="ab-backup-json" class="btn-secondary">Backup JSON completo</button>
      <button type="button" id="ab-backup-excel" class="btn-secondary">Backup Excel completo</button>
      <button type="button" id="ab-probar-telegram" class="btn-primary">📤 Probar Telegram</button>
    </div>
  `;
  tarjeta.querySelector('#ab-backup-json').addEventListener('click', generarBackupJSON);
  tarjeta.querySelector('#ab-backup-excel').addEventListener('click', generarBackupExcel);
  tarjeta.querySelector('#ab-probar-telegram').addEventListener('click', probarTelegram);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_BACKUP, {
  generarBackupJSON,
  generarBackupExcel,
  probarTelegram,
  crearVistaBackup
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_BACKUP_VISTA_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-backup.js
git commit -m "feat: add admin-backup.js JSON/Excel export, Probar Telegram, and view"
```

---

### Task 3: `js/admin-config.js` — validation and payload helpers

**Files:**
- Create: `js/admin-config.js` (this task writes the file; Task 4 appends to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: nothing — pure functions.
- Produces (on `window.EVE_ADMIN_CONFIG`): `validarConfiguracion(token, chatId)` → `string|null` (error message, or `null` if both are non-empty after `trim()`); `construirPayloadConfig(datos)` → `{ token, chatId, horaReporte }` (`datos = { token, chatId, horaReporte }`; `token`/`chatId` are trimmed, `horaReporte` is passed through as-is since it always comes from a native `<input type="time">`).

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
require('./js/admin-config.js');
const assert = require('assert');
const AC = window.EVE_ADMIN_CONFIG;

assert.strictEqual(AC.validarConfiguracion('', '123'), 'El token de Telegram es obligatorio');
assert.strictEqual(AC.validarConfiguracion('  ', '123'), 'El token de Telegram es obligatorio');
assert.strictEqual(AC.validarConfiguracion('abc', ''), 'El Chat ID es obligatorio');
assert.strictEqual(AC.validarConfiguracion('abc', '   '), 'El Chat ID es obligatorio');
assert.strictEqual(AC.validarConfiguracion('abc', '123'), null);

const payload = AC.construirPayloadConfig({ token: ' abc ', chatId: ' 123 ', horaReporte: '20:00' });
assert.deepStrictEqual(payload, { token: 'abc', chatId: '123', horaReporte: '20:00' });

console.log('ADMIN_CONFIG_HELPERS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/admin-config.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/admin-config.js`:

```javascript
(function () {

function validarConfiguracion(token, chatId) {
  if (!token || !token.trim()) return 'El token de Telegram es obligatorio';
  if (!chatId || !chatId.trim()) return 'El Chat ID es obligatorio';
  return null;
}

function construirPayloadConfig(datos) {
  return {
    token: datos.token.trim(),
    chatId: datos.chatId.trim(),
    horaReporte: datos.horaReporte
  };
}

window.EVE_ADMIN_CONFIG = {
  validarConfiguracion,
  construirPayloadConfig
};

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_CONFIG_HELPERS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-config.js
git commit -m "feat: add admin-config.js validation and payload helpers"
```

---

### Task 4: `js/admin-config.js` — read/prefill/save form, view

**Files:**
- Modify: `js/admin-config.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check (module-load + DOM construction only, with a stubbed `window.db` — full live behavior verified in Task 5)

**Interfaces:**
- Consumes: `validarConfiguracion`, `construirPayloadConfig` (Task 3, same file, bare identifiers); `window.db` (`js/config.js`); `window.showSuccess`, `window.showError` (`js/utils.js`).
- Produces (added to `window.EVE_ADMIN_CONFIG`): `cargarConfiguracion()` → `Promise<void>` (reads `config/telegram`, prefills the 3 form fields; empty strings for token/chatId and `'20:00'` for horario if the document doesn't exist yet); `manejarGuardar(evento)` → `Promise<void>` (validates, builds the payload, `.set(payload, { merge: true })`); `crearVistaConfig()` → `HTMLDivElement` (calling it also kicks off the initial `cargarConfiguracion()` call).

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
    setAttribute(){}, getAttribute(){ return null; },
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
global.window.db = {
  collection() {
    return { doc() { return { get: async () => ({ exists: false }) }; } };
  }
};
require('./js/admin-config.js');
const assert = require('assert');
assert.strictEqual(typeof window.EVE_ADMIN_CONFIG.crearVistaConfig, 'function');
const vista = window.EVE_ADMIN_CONFIG.crearVistaConfig();
assert.ok(vista);
console.log('ADMIN_CONFIG_VISTA_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: an `AssertionError` (`typeof window.EVE_ADMIN_CONFIG.crearVistaConfig` is `'undefined'`).

- [ ] **Step 3: Insert the implementation**

In `js/admin-config.js`, find this anchor:

```javascript
window.EVE_ADMIN_CONFIG = {
  validarConfiguracion,
  construirPayloadConfig
};

})();
```

Replace it with:

```javascript
window.EVE_ADMIN_CONFIG = {
  validarConfiguracion,
  construirPayloadConfig
};

const HORA_DEFAULT = '20:00';

async function cargarConfiguracion() {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  const inputToken = document.getElementById('ac-token');
  if (!inputToken) return;
  const datos = configDoc.exists ? configDoc.data() : {};
  inputToken.value = datos.token || '';
  document.getElementById('ac-chatid').value = datos.chatId || '';
  document.getElementById('ac-horario').value = datos.horaReporte || HORA_DEFAULT;
}

async function manejarGuardar(evento) {
  evento.preventDefault();
  const token = document.getElementById('ac-token').value;
  const chatId = document.getElementById('ac-chatid').value;
  const horaReporte = document.getElementById('ac-horario').value;

  const errorValidacion = validarConfiguracion(token, chatId);
  if (errorValidacion) {
    window.showError(errorValidacion);
    return;
  }

  const payload = construirPayloadConfig({ token, chatId, horaReporte });
  try {
    await window.db.collection('config').doc('telegram').set(payload, { merge: true });
    window.showSuccess('Configuración guardada');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearVistaConfig() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-config';
  tarjeta.innerHTML = `
    <h3>Configuración del Sistema</h3>
    <form id="admin-config-form">
      <input type="text" id="ac-token" placeholder="Token de Telegram">
      <input type="text" id="ac-chatid" placeholder="Chat ID">
      <label class="admin-config-campo">
        Horario de reporte automático
        <input type="time" id="ac-horario" value="${HORA_DEFAULT}">
      </label>
      <button type="submit" class="btn-primary">Guardar</button>
    </form>
  `;
  tarjeta.querySelector('#admin-config-form').addEventListener('submit', manejarGuardar);
  cargarConfiguracion();
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_CONFIG, {
  cargarConfiguracion,
  manejarGuardar,
  crearVistaConfig
});

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `ADMIN_CONFIG_VISTA_OK`

- [ ] **Step 5: Commit**

```bash
git add js/admin-config.js
git commit -m "feat: add admin-config.js read/prefill/save form and view"
```

---

### Task 5: Wire into `admin.js`/`index.html`, add CSS, live verification

**Files:**
- Modify: `js/admin.js`
- Modify: `index.html`
- Modify: `css/styles.css`
- Create: `docs/superpowers/verify-phase8c.js`

**Interfaces:**
- Consumes: `window.EVE_ADMIN_BACKUP.crearVistaBackup()` (Task 2); `window.EVE_ADMIN_CONFIG.crearVistaConfig()` (Task 4).
- Produces: nothing consumed by later tasks (final task of this plan).

- [ ] **Step 1: Add the two sub-tabs to `admin.js`**

In `js/admin.js`, find:

```javascript
const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'importar', nombre: 'Importar Datos' }
];
```

Replace with:

```javascript
const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'importar', nombre: 'Importar Datos' },
  { id: 'backup', nombre: 'Backup' },
  { id: 'config', nombre: 'Configuración' }
];
```

Find:

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

Replace with:

```javascript
function renderizarSubpestana(contenedor) {
  contenedor.innerHTML = '';
  if (subpestanaActiva === 'usuarios') {
    contenedor.appendChild(window.EVE_ADMIN_USUARIOS.crearVistaUsuarios());
  } else if (subpestanaActiva === 'importar') {
    contenedor.appendChild(window.EVE_ADMIN_IMPORTAR.crearVistaImportar());
  } else if (subpestanaActiva === 'backup') {
    contenedor.appendChild(window.EVE_ADMIN_BACKUP.crearVistaBackup());
  } else if (subpestanaActiva === 'config') {
    contenedor.appendChild(window.EVE_ADMIN_CONFIG.crearVistaConfig());
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
global.window.EVE_ADMIN_BACKUP = { crearVistaBackup(){ return fakeElement(); } };
global.window.EVE_ADMIN_CONFIG = { crearVistaConfig(){ return fakeElement(); } };
require('./js/admin.js');
const assert = require('assert');
const contenedor = fakeElement();
window.EVE_ADMIN.renderAdmin(contenedor);
assert.ok(contenedor.children.length > 0);
console.log('ADMIN_SHELL_CON_BACKUP_CONFIG_OK');
"
```

Expected output: `ADMIN_SHELL_CON_BACKUP_CONFIG_OK`

- [ ] **Step 3: Commit the admin.js change**

```bash
git add js/admin.js
git commit -m "feat: add Backup and Configuracion sub-tabs to admin.js shell"
```

- [ ] **Step 4: Add the script tags**

In `index.html`, find:

```html
  <script src="js/admin-usuarios.js"></script>
  <script src="js/admin-importar.js"></script>
  <script src="js/admin.js"></script>
</body>
```

Replace with:

```html
  <script src="js/admin-usuarios.js"></script>
  <script src="js/admin-importar.js"></script>
  <script src="js/admin-backup.js"></script>
  <script src="js/admin-config.js"></script>
  <script src="js/admin.js"></script>
</body>
```

- [ ] **Step 5: Add the CSS**

In `css/styles.css`, append at the end of the file:

```css
/* ===== Panel Admin: Backup ===== */

.admin-backup {
  margin-bottom: 1rem;
}

.admin-backup-botones {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

/* ===== Panel Admin: Configuracion ===== */

.admin-config {
  margin-bottom: 1rem;
}

.admin-config-campo {
  display: block;
  margin: 0.75rem 0;
  font-size: 0.9rem;
}

.admin-config-campo input {
  display: block;
  margin-top: 0.4rem;
}
```

- [ ] **Step 6: Start the local server**

Run (from `eve-control-v2/`, if not already running):

```bash
npx http-server -p 8765 .
```

- [ ] **Step 7: Write the live verification script**

Create `docs/superpowers/verify-phase8c.js`. This script tests the Configuración save against the **real** `config/telegram` document, which already holds real Telegram credentials seeded in Fase 7 — to avoid leaving it corrupted if a later assertion fails, it captures the original value, performs the save/reload round-trip, and **restores the original value immediately afterward, before any further step**:

```javascript
const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');
const fs = require('fs');

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

  // --- Backup ---
  await page.click('.tab:has-text("Backup")');
  await page.waitForSelector('#ab-backup-json');

  const [descargaJson] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ab-backup-json')
  ]);
  const rutaJson = await descargaJson.path();
  console.log('BACKUP_JSON_OK:', !!rutaJson);
  const contenidoJson = fs.readFileSync(rutaJson, 'utf-8');
  console.log('BACKUP_JSON_SIN_PASSWORD_OK:', !contenidoJson.toLowerCase().includes('password'));
  const backupParseado = JSON.parse(contenidoJson);
  console.log('BACKUP_JSON_5_CLAVES_SIN_USERS_OK:', Object.keys(backupParseado).length === 5 && !('users' in backupParseado));

  const [descargaExcel] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#ab-backup-excel')
  ]);
  console.log('BACKUP_EXCEL_OK:', !!(await descargaExcel.path()));

  console.log('BOTON_TELEGRAM_EXISTE_OK:', await page.locator('#ab-probar-telegram').count() === 1);

  // --- Configuracion: round-trip contra el documento REAL, restaurado de inmediato ---
  await page.click('.tab:has-text("Configuración")');
  await page.waitForSelector('#admin-config-form');

  const configOriginal = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists ? doc.data() : null;
  });

  await page.fill('#ac-token', 'token_prueba_8c');
  await page.fill('#ac-chatid', 'chatid_prueba_8c');
  await page.fill('#ac-horario', '21:30');
  await page.click('#admin-config-form button[type="submit"]');
  await page.waitForFunction(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists && doc.data().token === 'token_prueba_8c';
  }, { timeout: 5000 });

  const configGuardada = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.data();
  });
  console.log('CONFIG_GUARDADA_OK:', configGuardada.token === 'token_prueba_8c'
    && configGuardada.chatId === 'chatid_prueba_8c'
    && configGuardada.horaReporte === '21:30');

  // Restaurar INMEDIATAMENTE, antes de cualquier otro paso
  await page.evaluate(async (original) => {
    if (original) {
      await window.db.collection('config').doc('telegram').set(original);
    } else {
      await window.eliminarDato(window.COLECCIONES.CONFIG, 'telegram');
    }
  }, configOriginal);

  const configRestaurada = await page.evaluate(async () => {
    const doc = await window.db.collection('config').doc('telegram').get();
    return doc.exists ? doc.data() : null;
  });
  console.log('CONFIG_RESTAURADA_OK:', JSON.stringify(configRestaurada) === JSON.stringify(configOriginal));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

- [ ] **Step 8: Run the live verification script**

Run:

```bash
node docs/superpowers/verify-phase8c.js
```

Expected: every line ends in `true`, and `CONSOLE_ERRORS: []`. If `CONFIG_RESTAURADA_OK` is ever `false`, stop immediately and manually re-seed `config/telegram` with its real token/chatId before doing anything else — do not proceed to the next task with the real Telegram config left corrupted.

- [ ] **Step 9: Commit**

```bash
git add index.html css/styles.css docs/superpowers/verify-phase8c.js
git commit -m "feat: wire admin-backup.js and admin-config.js into the app, add live verification"
```

---

## Self-Review Notes

- **Spec coverage:** Arquitectura (2 files, 2 sub-tabs, no shared code between them) → Tasks 1-2-3-4-5. Backup/Exportación (JSON, Excel, users excluded, Probar Telegram sends a real message) → Tasks 1-2. Configuración del Sistema (3 fields, `.set` with merge, default horario, minimal validation) → Tasks 3-4. Archivos → Task 5. Fuera de alcance (no real scheduled-send mechanism) → nothing builds it, by omission, consistent with the spec. Every spec section has a task.
- **Placeholder scan:** no TBD/TODO; every step has complete code or an exact command.
- **Type consistency:** `construirBackupCompleto`'s 5 output keys (`destaraje`/`produccion`/`pagos`/`ministraciones`/`controlProduccion`) are used identically by Task 2's `generarBackupJSON`/`generarBackupExcel` (same key names, same order of `book_append_sheet` calls). `validarConfiguracion`/`construirPayloadConfig`'s parameter shapes match exactly how Task 4's `manejarGuardar` calls them (same field names: `token`, `chatId`, `horaReporte`). The `config/telegram` document's 3 fields (`token`/`chatId`/`horaReporte`) are read and written with identical names across Tasks 2 and 4, matching the pre-existing field names `js/reportes.js`'s `enviarReporteTelegram` already reads (`token`/`chatId`).
