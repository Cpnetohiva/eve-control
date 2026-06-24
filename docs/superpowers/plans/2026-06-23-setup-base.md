# Fase 1 — Setup inicial y estructura base — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a working, error-free "app shell" for EVE Control v3.0 — a login screen with correct branding/styling, Firebase initialized, and no business logic yet — that opens correctly in a browser.

**Architecture:** Static vanilla-JS site, no build step, no bundler, no test framework. Firebase SDKs and other libraries load via CDN `<script>` tags in `index.html`. All app-level globals (config, constants, later `db`, `EVE` session object) are attached explicitly to `window` so every later `<script src="js/...">` file can read them without modules/imports.

**Tech Stack:** Vanilla JS (ES2017+), HTML5, CSS3 (custom properties), Firebase Firestore (compat SDK v10.7.1 via CDN), jsPDF 2.5.1 + jsPDF-autoTable 3.5.31 (CDN, unused until the Reportes phase but loaded now per architecture), SheetJS/xlsx (CDN, unused until Admin import phase).

## Global Constraints

- Repo root for all paths below: `eve-control-v2/` (already created, git initialized locally, **no remote configured yet** — do not push).
- Firebase project ID **must** be `everplastic` (NOT `control-evecontrol` — this was called out as a critical correction in the source spec).
- Exact Firebase config values (from `docs/PROMPT_ORIGINAL_EVE_CONTROL.md`):
  ```javascript
  {
    apiKey: "AIzaSyCF_6UdCStIo2eq-BSDH-vHmSu6LvzX7gU",
    authDomain: "everplastic.firebaseapp.com",
    projectId: "everplastic",
    storageBucket: "everplastic.firebasestorage.app",
    messagingSenderId: "804807980304",
    appId: "1:804807980304:web:47466f961871b5b0a80c06"
  }
  ```
- Exact CDN versions: `firebase-app-compat.js` / `firebase-firestore-compat.js` → `10.7.1`; `jspdf` → `2.5.1`; `jspdf-autotable` → `3.5.31`.
- Exact palette (CSS custom properties): `--azul-marino: #001D3D`, `--oro: #FFC300`, `--azul-claro: #0077B6`, `--blanco: #FFFFFF`, `--gris-claro: #F5F5F5`, `--gris-oscuro: #666666`.
- Fonts: **DM Sans** for general UI, **JetBrains Mono** for numbers/data (loaded via Google Fonts).
- Mobile-first CSS: base styles target small screens, `@media (min-width: 768px)` adds desktop refinements.
- No `db.enablePersistence()`, no service worker, no IndexedDB in this phase — that belongs to the PWA/offline phase later.
- No login logic, no session, no permissions in this phase — that belongs to `auth.js` (next phase). The login form in `index.html` is markup only.

---

## File Structure

```
eve-control-v2/
├── index.html          (Task 3 — app shell markup)
├── css/
│   └── styles.css      (Task 2 — palette, components, responsive)
└── js/
    └── config.js       (Task 1 — Firebase init + global constants)
```

No test framework is introduced (none exists in this stack). Verification uses plain `node --check`/stubbed `node -e` smoke checks for JS, `grep` content checks for CSS/HTML, and a final manual browser check — each with exact commands and expected output.

---

### Task 1: `js/config.js` — Firebase init + global constants

**Files:**
- Create: `js/config.js`
- Test: inline `node -e` smoke check (no file created — run directly from repo root)

**Interfaces:**
- Consumes: global `firebase` object (provided by the CDN `<script>` tags loaded in `index.html`, *before* this file — Task 3 wires the load order; for this task's standalone test, `firebase` is stubbed).
- Produces (attached to `window`, consumed by every later module):
  - `window.firebaseConfig` — object, exact shape in Global Constraints
  - `window.db` — Firestore instance (result of `firebase.firestore()`)
  - `window.COLECCIONES` — `{ USERS: 'users', DESTARAJE: 'destaraje', PRODUCCION: 'produccion', PAGOS: 'pagos', MINISTRACIONES: 'ministraciones', CONTROL_PRODUCCION: 'control_produccion', CONFIG: 'config' }`
  - `window.MATERIALES_COMUNES` — `string[]` (14 entries, see step 3)
  - `window.MATERIALES_PZ` — `['TAMBO', 'CAJA CO30']`
  - `window.PROVEEDORES_COMUNES` — `string[]` (7 entries, see step 3)

- [ ] **Step 1: Write the failing verification check**

Run this from the repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.firebase = {
  initializeApp: (cfg) => { global.__initCfg = cfg; },
  firestore: () => 'FIRESTORE_INSTANCE'
};
require('./js/config.js');
const assert = require('assert');
assert.deepStrictEqual(window.firebaseConfig.projectId, 'everplastic');
assert.deepStrictEqual(window.__initCfg, window.firebaseConfig);
assert.strictEqual(window.db, 'FIRESTORE_INSTANCE');
assert.strictEqual(window.COLECCIONES.DESTARAJE, 'destaraje');
assert.strictEqual(window.COLECCIONES.CONTROL_PRODUCCION, 'control_produccion');
assert.deepStrictEqual(window.MATERIALES_PZ, ['TAMBO', 'CAJA CO30']);
assert.strictEqual(window.MATERIALES_COMUNES.length, 14);
assert.strictEqual(window.PROVEEDORES_COMUNES.length, 7);
console.log('CONFIG_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected output: `Error: Cannot find module './js/config.js'` (exit code 1) — the file doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `js/config.js`:

```javascript
window.firebaseConfig = {
  apiKey: "AIzaSyCF_6UdCStIo2eq-BSDH-vHmSu6LvzX7gU",
  authDomain: "everplastic.firebaseapp.com",
  projectId: "everplastic",
  storageBucket: "everplastic.firebasestorage.app",
  messagingSenderId: "804807980304",
  appId: "1:804807980304:web:47466f961871b5b0a80c06"
};

firebase.initializeApp(window.firebaseConfig);
window.db = firebase.firestore();

window.COLECCIONES = {
  USERS: 'users',
  DESTARAJE: 'destaraje',
  PRODUCCION: 'produccion',
  PAGOS: 'pagos',
  MINISTRACIONES: 'ministraciones',
  CONTROL_PRODUCCION: 'control_produccion',
  CONFIG: 'config'
};

window.MATERIALES_COMUNES = [
  'MIXTO', 'MIXTO 2', 'PET', 'PET CRISTAL', 'PET COLOR',
  'MULTICOLOR', 'PELETIZADO', 'LECHERO LAVADO', 'LECHERO MOLIDO',
  'PP MOLIDO', 'PACAS CRISTAL CON ETIQUETA', 'PEAD',
  'TAMBO', 'CAJA CO30'
];

window.MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];

window.PROVEEDORES_COMUNES = [
  'JOSE ENRIQUE', 'JUANA', 'FRANCISCO',
  'FELIX LOZANO', 'ARTURO LARA', 'OLEGARIO', 'JESUS'
];
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `CONFIG_OK`

- [ ] **Step 5: Commit**

```bash
git add js/config.js
git commit -m "feat: add Firebase config and global constants"
```

---

### Task 2: `css/styles.css` — palette, components, responsive base

**Files:**
- Create: `css/styles.css`
- Test: inline `grep` content check (no file created)

**Interfaces:**
- Consumes: nothing (pure CSS, no dependency on other tasks).
- Produces (selectors consumed by `index.html` in Task 3, and by every future module's markup): `.card`, `.btn-primary`, `.btn-secondary`, `.tabs`, `.tab`, `.tab.active`, `.modal-overlay`, `.modal-overlay.open`, `.modal`, `#toast-container`, `.toast`, `.toast-success`, `.toast-error`, `#login-screen`, `#login-error`, `#app-shell`, `#app-shell.visible`, `.app-header`, `#estado-conexion`, `.header-actions`, `#main-content`, `.mono`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q -- "--azul-marino: #001D3D;" css/styles.css && \
grep -q -- "--oro: #FFC300;" css/styles.css && \
grep -q -- "--azul-claro: #0077B6;" css/styles.css && \
grep -q -- "--gris-claro: #F5F5F5;" css/styles.css && \
grep -q -- "--gris-oscuro: #666666;" css/styles.css && \
grep -q "\.card {" css/styles.css && \
grep -q "\.tabs {" css/styles.css && \
grep -q "\.modal-overlay {" css/styles.css && \
grep -q "\.toast-success {" css/styles.css && \
grep -q "\.toast-error {" css/styles.css && \
grep -q "@media (min-width: 768px)" css/styles.css && \
echo "STYLES_OK"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: no `STYLES_OK` printed — `grep` errors with `css/styles.css: No such file or directory` and the `&&` chain stops (exit code 2).

- [ ] **Step 3: Write the implementation**

Create `css/styles.css`:

```css
:root {
  --azul-marino: #001D3D;
  --oro: #FFC300;
  --azul-claro: #0077B6;
  --blanco: #FFFFFF;
  --gris-claro: #F5F5F5;
  --gris-oscuro: #666666;
  --verde-exito: #06D6A0;
  --rojo-error: #EF476F;
  --sombra: 0 2px 8px rgba(0, 0, 0, 0.12);
  --radio: 10px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'DM Sans', sans-serif;
  background: var(--gris-claro);
  color: var(--azul-marino);
  min-height: 100vh;
}

.mono {
  font-family: 'JetBrains Mono', monospace;
}

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
}

input, select {
  font-family: inherit;
  font-size: 1rem;
}

/* ===== Componentes base ===== */

.card {
  background: var(--blanco);
  border-radius: var(--radio);
  box-shadow: var(--sombra);
  padding: 1.25rem;
}

.btn-primary {
  background: var(--oro);
  color: var(--azul-marino);
  font-weight: 700;
  padding: 0.75rem 1.5rem;
  border-radius: var(--radio);
  transition: opacity 0.15s ease;
}

.btn-primary:hover {
  opacity: 0.85;
}

.btn-secondary {
  background: var(--blanco);
  color: var(--azul-marino);
  border: 1px solid var(--azul-marino);
  padding: 0.75rem 1.5rem;
  border-radius: var(--radio);
}

.tabs {
  display: flex;
  gap: 0.5rem;
  border-bottom: 2px solid var(--gris-claro);
  overflow-x: auto;
}

.tab {
  padding: 0.75rem 1rem;
  font-weight: 600;
  color: var(--gris-oscuro);
  border-bottom: 3px solid transparent;
  white-space: nowrap;
}

.tab.active {
  color: var(--azul-marino);
  border-bottom-color: var(--oro);
}

.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0, 29, 61, 0.6);
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal-overlay.open {
  display: flex;
}

.modal {
  background: var(--blanco);
  border-radius: var(--radio);
  box-shadow: var(--sombra);
  padding: 1.5rem;
  width: min(480px, 90vw);
  max-height: 85vh;
  overflow-y: auto;
}

#toast-container {
  position: fixed;
  bottom: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 200;
}

.toast {
  padding: 0.75rem 1.25rem;
  border-radius: var(--radio);
  color: var(--blanco);
  box-shadow: var(--sombra);
  font-weight: 600;
}

.toast-success {
  background: var(--verde-exito);
}

.toast-error {
  background: var(--rojo-error);
}

/* ===== Login ===== */

#login-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--azul-marino);
  padding: 1rem;
}

#login-screen .card {
  width: min(360px, 100%);
  text-align: center;
}

#login-screen h1 {
  color: var(--azul-marino);
  font-size: 1.5rem;
  margin-bottom: 0.25rem;
}

#login-screen .subtitulo {
  color: var(--gris-oscuro);
  font-size: 0.85rem;
  margin-bottom: 1.5rem;
}

#login-screen input {
  width: 100%;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--gris-claro);
  border-radius: var(--radio);
}

#login-screen .btn-primary {
  width: 100%;
}

#login-error {
  color: var(--rojo-error);
  font-size: 0.85rem;
  margin-top: 0.75rem;
  min-height: 1.2em;
}

/* ===== App shell ===== */

#app-shell {
  display: none;
  min-height: 100vh;
  flex-direction: column;
}

#app-shell.visible {
  display: flex;
}

header.app-header {
  background: var(--azul-marino);
  color: var(--blanco);
  padding: 0.75rem 1rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
}

header.app-header h1 {
  font-size: 1.1rem;
}

#estado-conexion {
  font-size: 0.8rem;
  color: var(--verde-exito);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

.header-actions button {
  background: transparent;
  color: var(--blanco);
  border: 1px solid var(--blanco);
  padding: 0.4rem 0.9rem;
  border-radius: var(--radio);
  font-size: 0.85rem;
}

#main-content {
  flex: 1;
  padding: 1rem;
}

/* ===== Responsive ===== */

@media (min-width: 768px) {
  #main-content {
    padding: 2rem;
  }

  header.app-header {
    padding: 1rem 2rem;
  }

  header.app-header h1 {
    font-size: 1.4rem;
  }
}
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `STYLES_OK`

- [ ] **Step 5: Commit**

```bash
git add css/styles.css
git commit -m "feat: add base styles (palette, components, responsive)"
```

---

### Task 3: `index.html` — app shell markup

**Files:**
- Create: `index.html`
- Test: inline `grep` content check (no file created)

**Interfaces:**
- Consumes: `css/styles.css` (Task 2, via `<link>`), `js/config.js` (Task 1, via `<script>`), external CDN scripts.
- Produces: DOM elements `#login-screen`, `#login-form`, `#login-username`, `#login-password`, `#login-error`, `#app-shell`, `#estado-conexion`, `#btn-admin`, `#btn-salir`, `#tabs-container`, `#main-content`, `#toast-container` — these exact ids are the contract every later module (`auth.js`, module files) will query against.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q 'id="login-screen"' index.html && \
grep -q 'id="login-form"' index.html && \
grep -q 'id="login-username"' index.html && \
grep -q 'id="login-password"' index.html && \
grep -q 'id="login-error"' index.html && \
grep -q 'id="app-shell"' index.html && \
grep -q 'id="estado-conexion"' index.html && \
grep -q 'id="btn-admin"' index.html && \
grep -q 'id="btn-salir"' index.html && \
grep -q 'id="tabs-container"' index.html && \
grep -q 'id="main-content"' index.html && \
grep -q 'id="toast-container"' index.html && \
grep -q 'firebase-app-compat.js' index.html && \
grep -q 'firebase-firestore-compat.js' index.html && \
grep -q 'jspdf.umd.min.js' index.html && \
grep -q 'jspdf.plugin.autotable.min.js' index.html && \
grep -q 'xlsx.full.min.js' index.html && \
grep -q 'href="css/styles.css"' index.html && \
grep -q 'src="js/config.js"' index.html && \
echo "HTML_OK"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: no `HTML_OK` printed — `grep` errors with `index.html: No such file or directory`.

- [ ] **Step 3: Write the implementation**

Create `index.html`:

```html
<!DOCTYPE html>
<html lang="es-MX">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EVE Control v3.0</title>
  <meta name="theme-color" content="#001D3D">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="css/styles.css">
</head>
<body>

  <!-- Pantalla de login -->
  <div id="login-screen">
    <div class="card">
      <h1>EVE Control</h1>
      <p class="subtitulo">EVERPLASTIC — Mehicaso Group</p>
      <form id="login-form">
        <input type="text" id="login-username" placeholder="Usuario" autocomplete="username" required>
        <input type="password" id="login-password" placeholder="Contraseña" autocomplete="current-password" required>
        <button type="submit" class="btn-primary">Entrar</button>
        <div id="login-error"></div>
      </form>
    </div>
  </div>

  <!-- Shell de la app -->
  <div id="app-shell">
    <header class="app-header">
      <h1>EVE Control v3.0</h1>
      <span id="estado-conexion">🟢 En línea</span>
      <div class="header-actions">
        <button id="btn-admin">Admin</button>
        <button id="btn-salir">Salir</button>
      </div>
    </header>

    <nav class="tabs" id="tabs-container"></nav>

    <main id="main-content"></main>
  </div>

  <div id="toast-container"></div>

  <!-- SDKs externos -->
  <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>

  <!-- App -->
  <script src="js/config.js"></script>
</body>
</html>
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `HTML_OK`

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat: add app shell markup (login screen + header + containers)"
```

---

### Task 4: Integration check — serve and verify in a real browser

**Files:**
- None created. Uses the artifacts from Tasks 1-3.

**Interfaces:**
- Consumes: `index.html`, `css/styles.css`, `js/config.js` (all three previous tasks).
- Produces: confirmation that Phase 1's acceptance criteria (from the design spec) hold. No code artifact.

- [ ] **Step 1: Start a local static server and verify all three files are reachable**

Run from repo root:

```bash
cd "$(pwd)" && python -m http.server 8765 >/tmp/eve-server.log 2>&1 &
echo $! > /tmp/eve-server.pid
sleep 1
curl -s -o /dev/null -w "index.html: %{http_code}\n" http://localhost:8765/index.html
curl -s -o /dev/null -w "styles.css: %{http_code}\n" http://localhost:8765/css/styles.css
curl -s -o /dev/null -w "config.js: %{http_code}\n" http://localhost:8765/js/config.js
kill "$(cat /tmp/eve-server.pid)"
```

Expected output:
```
index.html: 200
styles.css: 200
config.js: 200
```

- [ ] **Step 2: Manual browser check**

Start the server again (`python -m http.server 8765` from the repo root) and open `http://localhost:8765/` in an actual browser (use whatever browser-driving tool is available — e.g. the `run` skill — or, if none is available in this environment, ask the user to open it and confirm). Verify:

- A centered card on a navy (`#001D3D`) background shows the title "EVE Control", subtitle "EVERPLASTIC — Mehicaso Group", username/password inputs, and a gold "Entrar" button.
- Browser DevTools console shows **no errors** (Firebase SDKs load, `config.js` runs `firebase.initializeApp()` without throwing).
- Resizing the viewport to a phone width (~375px) keeps the login card centered and readable.

If this cannot be verified directly (no browser tool available), say so explicitly rather than claiming it passes, and ask the user to confirm.

- [ ] **Step 3: Record completion**

No commit needed (no files changed) — Phase 1 is complete once Step 2 is confirmed. Report back to the user that Phase 1 is done and ready for Phase 2 (`utils.js` + `auth.js`).

---

## Self-Review Notes

- **Spec coverage:** `index.html` shell, login screen, header (title/estado/admin/salir), tabs container, main content, toast container, `css/styles.css` palette/components/responsive, `js/config.js` Firebase init + all constants — all covered by Tasks 1-3. Acceptance criteria (loads without console errors, correct look, responsive) covered by Task 4.
- **Placeholder scan:** none — every step has exact, runnable commands and complete file contents.
- **Type/interface consistency:** `window.db`, `window.COLECCIONES`, `window.MATERIALES_COMUNES`, `window.MATERIALES_PZ`, `window.PROVEEDORES_COMUNES` are defined once in Task 1 and referenced with the same names in Task 1's own interface block; no other task currently consumes them (that starts in Phase 2's `auth.js`/`utils.js`), so there's nothing to drift yet — future plans must reuse these exact names.
