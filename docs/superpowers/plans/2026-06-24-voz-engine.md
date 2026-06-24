# Fase 3c — Motor de Voz — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable voice-recognition engine (`js/voz.js`) with hold-to-record UI and 3 module parsers, with a real 🎤 button wired into Destaraje's form — filling fields for the user to review, never auto-saving.

**Architecture:** `js/voz.js` is split into pure text parsers (Node-testable, verified against the source spec's exact input→output examples) and a `crearBotonVoz` factory wrapping the Web Speech API in a hold-to-record button (browser-only, but its start/stop/error logic is Node-testable against a stubbed `SpeechRecognition` class). `js/destaraje.js` (already merged) gets one new button in its form and one new handler function. Like `js/destaraje.js`/`js/reportes.js`, the whole file is wrapped in an IIFE.

**Tech Stack:** Vanilla JS, Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`, no CDN dependency — it's a browser built-in), Playwright with an injected fake `SpeechRecognition` for live verification (no real microphone is available or needed).

## Global Constraints

- Source spec: `docs/superpowers/specs/2026-06-24-voz-engine-design.md`.
- Hold-to-record: `mousedown`/`touchstart` → `recognition.start()`; `mouseup`/`touchend`/`mouseleave` → `recognition.stop()`.
- Recognition config: `lang = 'es-MX'`, `continuous = false`, `interimResults = false` — never `continuous: true`.
- If `SpeechRecognition`/`webkitSpeechRecognition` isn't available, show `showError('Tu navegador no soporta reconocimiento de voz')` instead of throwing.
- On recognition `onerror`, show `showError('No se pudo reconocer el audio, intenta de nuevo')`.
- Parsers split the recognized text on commas; each expects exactly 5 segments (fewer → throw with a Spanish message naming how many were found vs. expected).
- `parseDestaraje`/`parseProduccion` share the same shape (ticket+name, material, kg, fechaEntrada, fechaSalida) — only the output field name differs (`proveedor` vs `cliente`). `parsePagos` computes `total = kg * precioPorKg`.
- Date parsing always uses the current year (from `window.obtenerFechaMexico()`) — no "roll to next year" logic.
- Voice results fill the Destaraje form; they never call `guardarDato`/`actualizarDato`/`eliminarDato`. The user must click "Guardar" themselves.
- A recognized ticket of `"V"` switches the form to Venta mode (reusing the existing `tipoFormulario`/`aplicarModoFormulario` machinery from Phase 3a) — for any other ticket value, Compra mode.

---

## File Structure

```
eve-control-v2/
├── index.html        (Task 3 — add <script src="js/voz.js"> before destaraje.js)
├── css/
│   └── styles.css     (Task 3 — .btn-voz / .btn-voz.grabando)
└── js/
    ├── voz.js         (Tasks 1-2, new)
    └── destaraje.js   (Task 3 — add the mic button + result handler; already exists, modified in place)
```

`js/voz.js` is built across 2 tasks, both inside one IIFE:
- Task 1: the 3 parsers + their shared helpers — appended first, Node-tested against the spec's exact examples.
- Task 2: `crearBotonVoz` — appended second, completing the file, Node-tested against a stubbed `SpeechRecognition`.

---

### Task 1: `js/voz.js` — parsers

**Files:**
- Create: `js/voz.js` (this task writes the file; Task 2 appends to it)
- Test: inline `node -e` smoke check

**Interfaces:**
- Consumes: `window.obtenerFechaMexico()` (`js/utils.js`).
- Produces (attached to `window`, consumed by Task 3's `destaraje.js` wiring):
  - `parsearFechaVoz(texto)` → `"YYYY-MM-DD"`, throws on unrecognized day/month
  - `parsearTicketYNombre(segmento)` → `{ ticket: string, nombre: string }`, throws if the segment doesn't match `"ticket ... de ..."`
  - `parseDestaraje(texto)` → `{ ticket, proveedor, material, kg, fechaEntrada, fechaSalida }`
  - `parseProduccion(texto)` → `{ ticket, cliente, material, kg, fechaEntrada, fechaSalida }`
  - `parsePagos(texto)` → `{ ticket, proveedor, material, kg, precioPorKg, pagado, total }`

- [ ] **Step 1: Write the failing verification check**

Run from repo root (`eve-control-v2/`):

```bash
node -e "
global.window = global;
global.obtenerFechaMexico = () => '2026-06-24';
require('./js/voz.js');
const assert = require('assert');

assert.strictEqual(window.parsearFechaVoz('23 abril'), '2026-04-23');
assert.strictEqual(window.parsearFechaVoz('3 de mayo'), '2026-05-03');
assert.throws(() => window.parsearFechaVoz('mañana'), /No se pudo reconocer la fecha/);
assert.throws(() => window.parsearFechaVoz('23 lunes'), /No se reconoció el mes/);

assert.deepStrictEqual(
  window.parsearTicketYNombre('Ticket 9260 de Jose Enrique'),
  { ticket: '9260', nombre: 'Jose Enrique' }
);
assert.throws(() => window.parsearTicketYNombre('9260 Jose Enrique'), /No se reconoció/);

assert.deepStrictEqual(
  window.parseDestaraje('Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 abril, salida 24 abril'),
  { ticket: '9260', proveedor: 'Jose Enrique', material: 'Mixto', kg: 650, fechaEntrada: '2026-04-23', fechaSalida: '2026-04-24' }
);

assert.deepStrictEqual(
  window.parseProduccion('Ticket P de Produccion, Peletizado, 1800, entrada 24 abril, salida 24 abril'),
  { ticket: 'P', cliente: 'Produccion', material: 'Peletizado', kg: 1800, fechaEntrada: '2026-04-24', fechaSalida: '2026-04-24' }
);

assert.deepStrictEqual(
  window.parsePagos('Ticket 9260 de Jose Enrique, Mixto, 650, a 10, pagado 6500'),
  { ticket: '9260', proveedor: 'Jose Enrique', material: 'Mixto', kg: 650, precioPorKg: 10, pagado: 6500, total: 6500 }
);

assert.throws(
  () => window.parseDestaraje('Ticket 9260 de Jose Enrique, Mixto, 650'),
  /No se reconocieron todos los datos/
);
assert.throws(
  () => window.parsePagos('Ticket 9260 de Jose Enrique, Mixto, abc, a 10, pagado 6500'),
  /No se reconoció la cantidad/
);

console.log('VOZ_PARSERS_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `Error: Cannot find module './js/voz.js'` (exit code 1).

- [ ] **Step 3: Write the implementation**

Create `js/voz.js`:

```javascript
(function () {

const MESES_VOZ = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

function parsearFechaVoz(texto) {
  const limpio = texto.trim().toLowerCase();
  const match = limpio.match(/(\d{1,2})\s+(?:de\s+)?(\w+)/);
  if (!match) {
    throw new Error(`No se pudo reconocer la fecha: "${texto}"`);
  }
  const dia = Number(match[1]);
  const mes = MESES_VOZ[match[2]];
  if (!mes) {
    throw new Error(`No se reconoció el mes: "${match[2]}"`);
  }
  const anio = Number(window.obtenerFechaMexico().split('-')[0]);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function parsearTicketYNombre(segmento) {
  const match = segmento.trim().match(/^ticket\s+(\S+)\s+de\s+(.+)$/i);
  if (!match) {
    throw new Error(`No se reconoció "ticket ... de ...": "${segmento}"`);
  }
  return { ticket: match[1].toUpperCase(), nombre: match[2].trim() };
}

function dividirSegmentos(texto, minimo) {
  const segmentos = texto.split(',').map((s) => s.trim()).filter(Boolean);
  if (segmentos.length < minimo) {
    throw new Error(`No se reconocieron todos los datos esperados (se reconocieron ${segmentos.length} de ${minimo})`);
  }
  return segmentos;
}

function parsearNumero(segmento) {
  const match = segmento.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`No se reconoció la cantidad: "${segmento}"`);
  }
  return Number(match[1]);
}

function parseDestaraje(texto) {
  const segmentos = dividirSegmentos(texto, 5);
  const { ticket, nombre: proveedor } = parsearTicketYNombre(segmentos[0]);
  const material = segmentos[1];
  const kg = parsearNumero(segmentos[2]);
  const fechaEntrada = parsearFechaVoz(segmentos[3]);
  const fechaSalida = parsearFechaVoz(segmentos[4]);
  return { ticket, proveedor, material, kg, fechaEntrada, fechaSalida };
}

function parseProduccion(texto) {
  const segmentos = dividirSegmentos(texto, 5);
  const { ticket, nombre: cliente } = parsearTicketYNombre(segmentos[0]);
  const material = segmentos[1];
  const kg = parsearNumero(segmentos[2]);
  const fechaEntrada = parsearFechaVoz(segmentos[3]);
  const fechaSalida = parsearFechaVoz(segmentos[4]);
  return { ticket, cliente, material, kg, fechaEntrada, fechaSalida };
}

function parsePagos(texto) {
  const segmentos = dividirSegmentos(texto, 5);
  const { ticket, nombre: proveedor } = parsearTicketYNombre(segmentos[0]);
  const material = segmentos[1];
  const kg = parsearNumero(segmentos[2]);
  const precioPorKg = parsearNumero(segmentos[3]);
  const pagado = parsearNumero(segmentos[4]);
  const total = kg * precioPorKg;
  return { ticket, proveedor, material, kg, precioPorKg, pagado, total };
}

window.parsearFechaVoz = parsearFechaVoz;
window.parsearTicketYNombre = parsearTicketYNombre;
window.parseDestaraje = parseDestaraje;
window.parseProduccion = parseProduccion;
window.parsePagos = parsePagos;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `VOZ_PARSERS_OK`

- [ ] **Step 5: Commit**

```bash
git add js/voz.js
git commit -m "feat: add voz.js speech-to-data parsers (destaraje, produccion, pagos)"
```

---

### Task 2: `js/voz.js` — `crearBotonVoz` hold-to-record button

**Files:**
- Modify: `js/voz.js` — insert before the closing `})();`
- Test: inline `node -e` smoke check against a stubbed `SpeechRecognition`

**Interfaces:**
- Consumes: `window.showError` (`js/utils.js`); `window.SpeechRecognition`/`window.webkitSpeechRecognition` (browser built-in, stubbed in this task's test).
- Produces: `crearBotonVoz(onResultado)` → an `HTMLButtonElement` with class `btn-voz`; calls `onResultado(texto)` with the raw recognized transcript on a successful result. Attached as `window.crearBotonVoz`.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
node -e "
global.window = global;
global.obtenerFechaMexico = () => '2026-06-24';

function fakeBoton() {
  const handlers = {};
  return {
    type: '', className: '', textContent: '',
    classList: { add() {}, remove() {} },
    addEventListener(evento, fn) { handlers[evento] = fn; },
    _handlers: handlers
  };
}
global.document = { createElement: () => fakeBoton() };

const instancias = [];
class FakeRecognition {
  constructor() { instancias.push(this); this.started = false; this.stopped = false; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}
global.SpeechRecognition = FakeRecognition;

const errores = [];
global.showError = (msg) => errores.push(msg);

require('./js/voz.js');
const assert = require('assert');

const resultados = [];
const boton = window.crearBotonVoz((texto) => resultados.push(texto));
boton._handlers.mousedown({ preventDefault() {} });
assert.strictEqual(instancias.length, 1);
assert.strictEqual(instancias[0].started, true);
assert.strictEqual(instancias[0].lang, 'es-MX');
assert.strictEqual(instancias[0].continuous, false);
assert.strictEqual(instancias[0].interimResults, false);

instancias[0].onresult({ results: [[{ transcript: 'hola mundo' }]] });
assert.deepStrictEqual(resultados, ['hola mundo']);

boton._handlers.mouseup();
assert.strictEqual(instancias[0].stopped, true);

delete global.SpeechRecognition;
const boton2 = window.crearBotonVoz(() => {});
boton2._handlers.mousedown({ preventDefault() {} });
assert.deepStrictEqual(errores, ['Tu navegador no soporta reconocimiento de voz']);
assert.strictEqual(instancias.length, 1);

console.log('VOZ_BOTON_OK');
"
```

- [ ] **Step 2: Run it to verify it fails**

Expected: `TypeError: window.crearBotonVoz is not a function` (exit code 1).

- [ ] **Step 3: Insert the implementation**

In `js/voz.js`, find this anchor:

```javascript
window.parsearFechaVoz = parsearFechaVoz;
window.parsearTicketYNombre = parsearTicketYNombre;
window.parseDestaraje = parseDestaraje;
window.parseProduccion = parseProduccion;
window.parsePagos = parsePagos;

})();
```

Replace it with:

```javascript
window.parsearFechaVoz = parsearFechaVoz;
window.parsearTicketYNombre = parsearTicketYNombre;
window.parseDestaraje = parseDestaraje;
window.parseProduccion = parseProduccion;
window.parsePagos = parsePagos;

function crearBotonVoz(onResultado) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn-voz';
  boton.textContent = '🎤';
  let reconocimiento = null;

  function iniciar(evento) {
    evento.preventDefault();
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      window.showError('Tu navegador no soporta reconocimiento de voz');
      return;
    }
    reconocimiento = new Constructor();
    reconocimiento.lang = 'es-MX';
    reconocimiento.continuous = false;
    reconocimiento.interimResults = false;
    reconocimiento.onresult = (eventoResultado) => {
      const texto = eventoResultado.results[0][0].transcript;
      onResultado(texto);
    };
    reconocimiento.onerror = () => {
      window.showError('No se pudo reconocer el audio, intenta de nuevo');
    };
    boton.classList.add('grabando');
    reconocimiento.start();
  }

  function detener() {
    boton.classList.remove('grabando');
    if (reconocimiento) {
      reconocimiento.stop();
    }
  }

  boton.addEventListener('mousedown', iniciar);
  boton.addEventListener('touchstart', iniciar);
  boton.addEventListener('mouseup', detener);
  boton.addEventListener('touchend', detener);
  boton.addEventListener('mouseleave', detener);

  return boton;
}

window.crearBotonVoz = crearBotonVoz;

})();
```

- [ ] **Step 4: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `VOZ_BOTON_OK`

- [ ] **Step 5: Commit**

```bash
git add js/voz.js
git commit -m "feat: add crearBotonVoz hold-to-record button factory"
```

---

### Task 3: Wire the mic button into `js/destaraje.js` + CSS/`index.html` + live check

**Files:**
- Modify: `js/destaraje.js` (add the mic button + one handler function)
- Modify: `css/styles.css` (append `.btn-voz`/`.btn-voz.grabando`)
- Modify: `index.html` (add `<script src="js/voz.js">` before `destaraje.js`)
- Test: Playwright script run via `node`, with a fake `SpeechRecognition` injected via `page.addInitScript` (no real microphone needed or used)

**Interfaces:**
- Consumes: `window.crearBotonVoz`, `window.parseDestaraje` (Task 1-2); `js/destaraje.js`'s own `tipoFormulario`/`aplicarModoFormulario` (Phase 3a, already merged).
- Produces: confirmation that Phase 3c's acceptance criteria hold. No Firestore writes — voice only fills the form; "Guardar" is never clicked in this check.

- [ ] **Step 1: Write the failing verification check**

Run from repo root:

```bash
grep -q 'src="js/voz.js"' index.html && grep -q 'btn-voz' css/styles.css && grep -q 'crearBotonVoz' js/destaraje.js && echo "WIRING_OK"
```

Expected: no `WIRING_OK` printed.

- [ ] **Step 2: Modify `js/destaraje.js`**

Find this anchor (end of `crearFormulario`):

```javascript
  form.querySelectorAll('input[name="tipo"]').forEach((radio) => {
    radio.addEventListener('change', (evento) => {
      tipoFormulario = evento.target.value;
      aplicarModoFormulario();
    });
  });
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}
```

Replace it with (adding the mic button and a new `aplicarResultadoVoz` handler):

```javascript
  form.querySelectorAll('input[name="tipo"]').forEach((radio) => {
    radio.addEventListener('change', (evento) => {
      tipoFormulario = evento.target.value;
      aplicarModoFormulario();
    });
  });
  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));
  return form;
}

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parseDestaraje(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  tipoFormulario = datos.ticket === 'V' ? 'venta' : 'compra';
  document.querySelector(`input[name="tipo"][value="${tipoFormulario}"]`).checked = true;
  aplicarModoFormulario();
  if (tipoFormulario === 'compra') {
    document.getElementById('df-ticket').value = datos.ticket;
  }
  document.getElementById('df-proveedor').value = datos.proveedor;
  document.getElementById('df-material').value = datos.material;
  document.getElementById('df-kg').value = datos.kg;
  document.getElementById('df-entrada').value = datos.fechaEntrada;
  document.getElementById('df-salida').value = datos.fechaSalida;
  window.showSuccess('Datos reconocidos, revisa y guarda');
}
```

- [ ] **Step 3: Modify `css/styles.css`**

Append:

```css
.btn-voz {
  background: var(--oro);
  color: var(--azul-marino);
  border-radius: 50%;
  width: 2.5rem;
  height: 2.5rem;
  font-size: 1.2rem;
}

.btn-voz.grabando {
  background: var(--rojo-error);
  color: var(--blanco);
}
```

- [ ] **Step 4: Modify `index.html`**

Change:

```html
  <script src="js/reportes.js"></script>
  <script src="js/destaraje.js"></script>
```

to:

```html
  <script src="js/reportes.js"></script>
  <script src="js/voz.js"></script>
  <script src="js/destaraje.js"></script>
```

- [ ] **Step 5: Run the verification check again to confirm it passes**

Run the exact command from Step 1 again.
Expected output: `WIRING_OK`

- [ ] **Step 6: Commit**

```bash
git add js/destaraje.js css/styles.css index.html
git commit -m "feat: wire voice-recognition button into Destaraje form"
```

- [ ] **Step 7: Write and run the live Playwright check**

This check never clicks "Guardar" and never writes to Firestore — it only
verifies the mic button fills the form correctly. A fake
`SpeechRecognition` is injected before the page loads, so no real
microphone is involved.

Create `docs/superpowers/verify-phase3c.js`:

```javascript
const { chromium } = require('playwright');
const CREDENCIALES = require('./credenciales-phase2.json');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(String(err)));

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
  await page.click('#tabs-container .tab:has-text("Destaraje")');
  await page.waitForSelector('.btn-voz');

  await page.evaluate(() => { window.__VOZ_TRANSCRIPT__ = 'Ticket 123 de Juan'; });
  await page.dispatchEvent('.btn-voz', 'mousedown');
  await page.waitForFunction(() => document.querySelectorAll('.toast-error').length > 0);
  console.log('ERROR_TOAST_OK');

  await page.evaluate(() => {
    window.__VOZ_TRANSCRIPT__ = 'Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 junio, salida 24 junio';
  });
  await page.dispatchEvent('.btn-voz', 'mousedown');
  await page.waitForFunction(() => document.getElementById('df-ticket').value === '9260');
  const compra = await page.evaluate(() => ({
    ticket: document.getElementById('df-ticket').value,
    proveedor: document.getElementById('df-proveedor').value,
    material: document.getElementById('df-material').value,
    kg: document.getElementById('df-kg').value,
    entrada: document.getElementById('df-entrada').value,
    salida: document.getElementById('df-salida').value,
    tipoCompra: document.querySelector('input[name="tipo"][value="compra"]').checked
  }));
  console.log('COMPRA_OK:', JSON.stringify(compra));

  await page.evaluate(() => {
    window.__VOZ_TRANSCRIPT__ = 'Ticket V de Cliente Voz, PET, 200, entrada 24 junio, salida 24 junio';
  });
  await page.dispatchEvent('.btn-voz', 'mousedown');
  await page.waitForFunction(() => document.getElementById('df-proveedor').value === 'Cliente Voz');
  await page.dispatchEvent('.btn-voz', 'mouseup');
  const venta = await page.evaluate(() => ({
    ticket: document.getElementById('df-ticket').value,
    ticketDisabled: document.getElementById('df-ticket').disabled,
    proveedor: document.getElementById('df-proveedor').value,
    material: document.getElementById('df-material').value,
    kg: document.getElementById('df-kg').value,
    tipoVenta: document.querySelector('input[name="tipo"][value="venta"]').checked
  }));
  console.log('VENTA_OK:', JSON.stringify(venta));

  console.log('CONSOLE_ERRORS:', JSON.stringify(errors));
  await browser.close();
})();
```

Run:

```bash
cd "eve-control-v2"
(python -m http.server 8765 >/tmp/eve-server.log 2>&1 &)
sleep 1
node docs/superpowers/verify-phase3c.js
```

Expected output:
```
ERROR_TOAST_OK
COMPRA_OK: {"ticket":"9260","proveedor":"Jose Enrique","material":"Mixto","kg":"650","entrada":"2026-06-23","salida":"2026-06-24","tipoCompra":true}
VENTA_OK: {"ticket":"V","ticketDisabled":true,"proveedor":"Cliente Voz","material":"PET","kg":"200","tipoVenta":true}
CONSOLE_ERRORS: []
```

If `CONSOLE_ERRORS` is non-empty or any assertion/wait times out, stop and
report — don't guess at a fix blindly (see systematic-debugging if the
cause isn't obvious). No Firestore cleanup is needed — this check never
saves anything.

- [ ] **Step 8: Stop the local server**

```bash
PID=$(netstat -ano | grep ':8765 ' | grep LISTENING | head -1 | awk '{print $NF}')
[ -n "$PID" ] && taskkill //PID "$PID" //F
```

- [ ] **Step 9: Commit the verification script**

```bash
git add docs/superpowers/verify-phase3c.js
git commit -m "test: add live (mocked-SpeechRecognition) Playwright check for Phase 3c voice"
```

---

## Self-Review Notes

- **Spec coverage:** hold-to-record pattern with `mousedown`/`mouseup`/`mouseleave` (Task 2), `es-MX`/`continuous: false`/`interimResults: false` (Task 2), unsupported-browser and recognition-error fallbacks (Task 2), all 3 parsers matching the spec's exact examples (Task 1), comma-segmented parsing with Spanish month mapping (Task 1), current-year-only date inference (Task 1), Destaraje wiring with Venta-mode switch on ticket `"V"` and no auto-save (Task 3) — all covered. Producción/Pagos wiring is explicitly out of scope (their parsers exist and are ready, per the spec, for whenever those modules are built).
- **Placeholder scan:** none — every step has complete code and exact commands/expected output.
- **Type/interface consistency:** `crearBotonVoz(onResultado)` (Task 2) is called with `aplicarResultadoVoz` (Task 3), which receives the raw transcript string, matching the contract documented in Task 2's Interfaces block (`calls onResultado(texto) with the raw recognized transcript`). `parseDestaraje`'s return shape (`{ticket, proveedor, material, kg, fechaEntrada, fechaSalida}`, Task 1) matches exactly the fields `aplicarResultadoVoz` (Task 3) reads (`datos.ticket`, `datos.proveedor`, etc.).
