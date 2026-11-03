// Panel de pendientes de la cola offline (js/offline.js): lo que viene del registro (ticket, folio, colección, cliente…) se muestra
// SIEMPRE como texto, nunca como HTML. Carga el js/offline.js real en Chromium con IndexedDB real, sin conexión, y mete registros con
// <img src=x onerror=alert(1)> en ticket y folio (y en la colección y en un registro «en revisión por posible duplicado»).
//
// También comprueba que el panel se ve igual que antes (misma estructura: .pp-item con tres <span>) y que la cola sigue funcionando
// (se encolan, se cuentan y quedan guardadas tal cual, sin escapar los datos que se suben).
//
// Uso: node scripts/verificar-offline-panel.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const XSS = '<img src=x onerror=alert(1)>';
const XSS2 = '<img src=x onerror="window.__xss=1">';

const HTML = `<!doctype html><html><body>
<span id="estado-conexion"></span><div id="toast-container"></div>
<script>
  window.EVE = { currentUser: { username: 'prueba' } };
  window.guardarDato = async () => 'id1'; window.actualizarDato = async () => {}; window.eliminarDato = async () => {};
  window.showError = () => {}; window.showSuccess = () => {};
  window.__alertas = 0;
</script>
<script src="/offline.js"></script>
</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const contexto = await browser.newContext();
  const page = await contexto.newPage();
  const errores = [];
  const dialogos = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', async (d) => { dialogos.push(d.message()); await d.dismiss(); });
  await page.route('http://eve.test/**', (route) => {
    const url = route.request().url();
    if (url.endsWith('/offline.js')) return route.fulfill({ contentType: 'application/javascript; charset=utf-8', body: fs.readFileSync(path.join(RAIZ, 'js/offline.js'), 'utf8') });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: HTML });
  });
  await page.goto('http://eve.test/');
  await page.waitForSelector('#panel-pendientes', { state: 'attached' });

  try {
    // Panel vacío (sin conexión el indicador es pulsable)
    await contexto.setOffline(true);
    await page.waitForFunction(() => document.getElementById('estado-conexion').style.cursor === 'pointer');
    await page.click('#estado-conexion');
    await page.waitForFunction(() => document.getElementById('panel-pendientes').classList.contains('open'));
    igual((await page.locator('#pp-lista').innerText()).trim(), 'Sin registros pendientes', 'panel vacío: «Sin registros pendientes»');
    afirmar(await page.locator('#pp-lista p.pp-vacio').count() === 1, 'panel vacío: mismo elemento <p class="pp-vacio"> de siempre');

    // Registros con HTML en ticket y folio (y en la colección)
    await page.evaluate(({ xss, xss2 }) => window.guardarDato('ventas', { ticket: xss, folio: xss, cliente: xss2, fecha: '2026-11-04' }), { xss: XSS, xss2: XSS2 });
    await page.evaluate(({ xss }) => window.guardarDato('pagos', { folio: xss, proveedor: 'P' }), { xss: XSS });
    await page.evaluate(({ xss2 }) => window.guardarDato('<b>negritas</b>', { ticket: xss2 }), { xss2: XSS2 });
    await page.evaluate(() => window.guardarDato('gastos', { concepto: 'sin ticket ni folio' }));
    await page.waitForTimeout(100);

    afirmar(await page.locator('#pp-lista img').count() === 0, 'ticket/folio con <img onerror>: NO se crea ningún <img> en el panel');
    afirmar(await page.locator('#pp-lista b').count() === 0, 'colección con <b>: no se interpreta como HTML');
    const filas = await page.$$eval('#pp-lista .pp-item', (fs_) => fs_.map((f) => Array.from(f.children).map((c) => ({ tag: c.tagName, texto: c.textContent }))));
    igual(filas.length, 4, 'cuatro registros pendientes en el panel');
    afirmar(filas.every((f) => f.length === 3 && f.every((c) => c.tag === 'SPAN')), 'cada fila conserva su estructura: <div class="pp-item"> con tres <span>');
    igual(filas[0].slice(0, 2).map((c) => c.texto), ['ventas', 'Ticket ' + XSS], 'el ticket con HTML se muestra como TEXTO literal');
    igual(filas[1].slice(0, 2).map((c) => c.texto), ['pagos', 'Ticket ' + XSS], 'sin ticket se muestra el folio, también como texto');
    igual(filas[2].slice(0, 2).map((c) => c.texto), ['<b>negritas</b>', 'Ticket ' + XSS2], 'la colección con etiquetas también se muestra como texto');
    igual(filas[3].slice(0, 2).map((c) => c.texto), ['gastos', 'Ticket —'], 'sin ticket ni folio: «Ticket —», igual que antes');
    afirmar(filas.every((f) => /\d{1,2}:\d{2}/.test(f[2].texto)), 'la hora se sigue mostrando');
    afirmar(!(await page.locator('#pp-lista').innerHTML()).includes('<img'), 'el HTML del panel no contiene un <img> real (solo texto escapado)');
    afirmar(dialogos.length === 0, 'no se disparó ningún alert(): ' + dialogos.join(' | '));
    afirmar(await page.evaluate(() => window.__xss === undefined), 'tampoco se ejecutó el onerror de la segunda carga útil');

    // La cola no cambia lo que se sube: el dato se guarda tal cual (sin escapar), solo se muestra escapado
    const guardado = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('EVEControlOffline', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      return new Promise((res) => { const q = db.transaction('cola_pendiente', 'readonly').objectStore('cola_pendiente').getAll(); q.onsuccess = () => res(q.result); });
    });
    igual(guardado.length, 4, 'la cola tiene los cuatro registros');
    igual(guardado[0].datos.ticket, XSS, 'el dato encolado se conserva idéntico (no se escapa al guardar)');
    igual(guardado.every((g) => g.estado === 'pendiente'), true, 'siguen en estado pendiente');

    // Sección «en revisión por posible duplicado»: también se construye con textContent
    await page.evaluate(async ({ xss, xss2 }) => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('EVEControlOffline', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      await new Promise((res) => {
        const tx = db.transaction('cola_pendiente', 'readwrite');
        tx.objectStore('cola_pendiente').add({ coleccion: 'ventas', datos: { folio: xss, ticket: xss, fecha: xss2 }, timestamp: new Date().toISOString(), intentos: 0, estado: 'revision', duplicadoDe: { id: xss2, folio: xss, fecha: '2026-11-01', coincidencias: ['fecha'] } });
        tx.oncomplete = res;
      });
    }, { xss: XSS, xss2: XSS2 });
    await page.evaluate(() => window.guardarDato('gastos', { concepto: 'refresca el panel' }));
    await page.waitForTimeout(100);
    const revision = await page.locator('#pp-lista').innerText();
    afirmar(revision.includes('En revisión por posible duplicado') && revision.includes(XSS), 'la sección en revisión muestra el HTML como texto');
    afirmar(await page.locator('#pp-lista img').count() === 0, 'en revisión: tampoco se crea ningún <img>');
    afirmar(await page.getByRole('button', { name: 'Es otro registro, subir' }).count() === 1 && await page.getByRole('button', { name: 'Descartar' }).count() === 1, 'en revisión: siguen sus botones');
    afirmar(dialogos.length === 0 && await page.evaluate(() => window.__xss === undefined), 'tras la sección en revisión, ningún script se ejecutó');
    afirmar(errores.length === 0, 'sin errores de JavaScript: ' + errores.join(' / '));
  } finally {
    await browser.close();
  }

  // Estático: el panel ya no arma HTML con datos del registro
  const src = fs.readFileSync(path.join(RAIZ, 'js/offline.js'), 'utf8').replace(/\r\n/g, '\n');
  const inicio = src.indexOf('async function actualizarPanelPendientes');
  const fin = src.indexOf('// ── Sincronización');
  const bloque = src.slice(inicio, fin);
  afirmar(!/innerHTML/.test(bloque), 'actualizarPanelPendientes no usa innerHTML');
  const usos = (src.match(/innerHTML/g) || []).length;
  afirmar(usos === 1 && /panel\.innerHTML = \[/.test(src), 'el único innerHTML que queda en offline.js es el armazón fijo del panel (sin datos del registro)');
  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
