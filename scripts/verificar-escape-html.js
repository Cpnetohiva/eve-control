// Escape de HTML en los innerHTML que muestran texto capturado: window.escaparHtml (js/utils.js) y sus usos en
//   js/cxc.js (cliente de la tarjeta), js/historial.js (usuario, módulo, ticket, motivo, cambios y el mensaje de error de la carga) y
//   js/admin-auditoria.js (mensaje de error de la búsqueda de foto).
// Carga los js/ reales en Chromium y mete <img src=x onerror=alert(1)> en cliente, ticket, motivo, usuario, módulo y cambios: debe
// verse como TEXTO literal, sin crear ningún <img> y sin ejecutar nada. Los textos normales (con & y acentos) se ven igual que antes.
//
// Uso: node scripts/verificar-escape-html.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r\n/g, '\n');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const XSS = '<img src=x onerror=alert(1)>';
const XSS2 = '<img src=x onerror="window.__xss=1">';
const BASE = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js'];

async function nuevaPagina(browser, scripts) {
  const page = await browser.newPage();
  const errores = [];
  const dialogos = [];
  page.on('pageerror', (e) => errores.push(e.message));
  page.on('dialog', async (d) => { dialogos.push(d.message()); await d.dismiss(); });
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of scripts) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(() => {
    window.obtenerFechaMexico = () => '2026-11-04';
    window.puedeEscribir = () => true;
    window.puedeLeer = () => true;
    window.showError = () => {};
    window.showSuccess = () => {};
    window.__xss = undefined;
  });
  page.erroresPagina = errores;
  page.dialogos = dialogos;
  return page;
}
const sinEjecucion = async (page, nombre) => {
  afirmar(page.dialogos.length === 0, `${nombre}: no se disparó ningún alert(): ${page.dialogos.join(' | ')}`);
  afirmar(await page.evaluate(() => window.__xss === undefined), `${nombre}: no se ejecutó el onerror`);
  afirmar(page.erroresPagina.length === 0, `${nombre}: sin errores de JavaScript: ${page.erroresPagina.join(' / ')}`);
};

(async () => {
  const browser = await chromium.launch();
  try {
    // ── window.escaparHtml ──
    {
      const page = await nuevaPagina(browser, BASE);
      const r = await page.evaluate((xss) => [window.escaparHtml(xss), window.escaparHtml('Ana & "Co" <b>x</b> \'y\''), window.escaparHtml(null), window.escaparHtml(undefined), window.escaparHtml(12.5), window.escaparHtml(0), window.escaparHtml('Báscula — ñ → ok')], XSS);
      igual(r[0], '&lt;img src=x onerror=alert(1)&gt;', 'escaparHtml: neutraliza las etiquetas');
      igual(r[1], 'Ana &amp; &quot;Co&quot; &lt;b&gt;x&lt;/b&gt; &#39;y&#39;', 'escaparHtml: & " < > \'');
      igual([r[2], r[3], r[4], r[5], r[6]], ['', '', '12.5', '0', 'Báscula — ñ → ok'], 'escaparHtml: null/undefined dan vacío; números y acentos intactos');
      const viaDom = await page.evaluate((xss) => { const d = document.createElement('div'); d.innerHTML = '<p>' + window.escaparHtml(xss) + '</p>'; return [d.querySelectorAll('img').length, d.textContent]; }, XSS);
      igual(viaDom, [0, XSS], 'escaparHtml: dentro de innerHTML se ve como el texto original y no crea elementos');
      await page.close();
    }

    // ── Historial ──
    {
      const page = await nuevaPagina(browser, [...BASE, 'js/historial.js']);
      const registros = [
        { timestamp: '2026-11-03T15:00:00.000Z', usuario: XSS, coleccion: XSS2, accion: 'edicion', motivo: XSS, valorAnterior: { ticket: XSS, kg: '<b>1</b>' }, valorNuevo: { ticket: XSS, kg: 2, nota: XSS2 } },
        { timestamp: '2026-11-02T10:00:00.000Z', usuario: 'Ana & Co', coleccion: 'pagos', accion: 'alta', motivo: 'Corrección de "kg" > 0', valorAnterior: null, valorNuevo: { ticket: '1234', kg: 10 } },
        { timestamp: '2026-11-01T10:00:00.000Z', usuario: 'Luis', coleccion: 'destaraje', accion: XSS, motivo: '', valorAnterior: null, valorNuevo: null }
      ];
      await page.evaluate((regs) => {
        window.db = { collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => ({ docs: regs.map((r, i) => ({ id: 'h' + i, data: () => r })) }) }) }) }) };
        document.getElementById('main-content').appendChild(window.EVE_HISTORIAL.crearVistaHistorial());
      }, registros);
      await page.getByRole('button', { name: 'Cargar Historial' }).click();
      await page.waitForSelector('#historial-tabla tr');
      afirmar(await page.locator('#historial-tabla img').count() === 0 && await page.locator('#main-content img').count() === 0, 'Historial: no se crea ningún <img> con usuario, módulo, ticket, motivo, cambios ni acción con HTML');
      const filas = await page.$$eval('#historial-tabla tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
      igual(filas.length, 3, 'Historial: tres filas');
      igual(filas[0].slice(1, 6), [XSS, XSS2, 'Edición', XSS, XSS], 'Historial: usuario, módulo, acción, ticket y motivo con HTML se ven como texto literal');
      afirmar(filas[0][6].includes('<b>1</b> → 2') && filas[0][6].includes('nota: — → ' + XSS2), 'Historial: la columna Cambios muestra el diff como texto: ' + filas[0][6]);
      igual(filas[1].slice(1, 6), ['Ana & Co', 'pagos', 'Alta', '1234', 'Corrección de "kg" > 0'], 'Historial: un registro normal se ve igual que antes (con & " > y acentos)');
      igual(filas[1][6], 'ticket: — → 1234 | kg: — → 10', 'Historial: el diff normal se ve igual que antes');
      igual(filas[2].slice(1, 6), ['Luis', 'destaraje', XSS, '—', '—'], 'Historial: una acción desconocida con HTML también se ve como texto; sin ticket ni motivo: «—»');
      igual(filas[2][6], '—', 'Historial: sin cambios: «—»');
      afirmar(/^\d{1,2}\/\d{1,2}\/\d{4}/.test(filas[1][0]), 'Historial: la fecha se sigue mostrando');
      await sinEjecucion(page, 'Historial');

      // Mensaje de error de la carga
      await page.evaluate((xss) => { window.db = { collection: () => ({ orderBy: () => ({ limit: () => ({ get: async () => { throw new Error(xss); } }) }) }) }; }, XSS);
      await page.getByRole('button', { name: 'Cargar Historial' }).click();
      await page.waitForFunction(() => /Error al cargar/.test(document.getElementById('main-content').textContent));
      afirmar(await page.locator('#main-content img').count() === 0, 'Historial: el mensaje de error con HTML no crea ningún <img>');
      afirmar((await page.locator('#main-content').innerText()).includes('Error al cargar: ' + XSS), 'Historial: el mensaje de error se ve como texto literal');
      await sinEjecucion(page, 'Historial (error)');
      await page.close();
    }

    // ── CxC: cliente de la tarjeta ──
    {
      const page = await nuevaPagina(browser, [...BASE, 'js/cxp.js', 'js/saldo-clientes.js', 'js/cxc.js']);
      await page.evaluate((xss) => {
        window.EVE_HISTORIAL = { registrar: () => {} };
        const cuenta = (id, cliente, folio) => ({ id, cliente, ventaId: 'v' + id, folio, material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: 10, total: 100, pagado: 0, saldo: 100, estado: 'pendiente', fechaVenta: '2026-11-01', abonos: [] });
        window.EVE = { currentUser: { username: 'p', permisosResueltos: {} }, cuentasPorCobrar: [cuenta('1', xss, 'V-1'), cuenta('2', 'Ana & Co', 'V-2')], clientes: [], cobros: [], ventas: [], registrosVentas: [], proveedores: [], registrosDestaraje: [], registrosPagos: [], precios: [], composiciones: [], recibosPendientes: [], auditorias: [], cuentasPorPagar: [] };
        window.EVE_MODULES.cxc.render(document.getElementById('main-content'));
      }, XSS);
      const titulos = await page.$$eval('#main-content h3', (hs) => hs.map((h) => h.textContent.trim()));
      afirmar(titulos.includes(XSS), 'CxC: el cliente con HTML se ve como texto literal en la tarjeta: ' + JSON.stringify(titulos));
      afirmar(titulos.includes('Ana & Co'), 'CxC: un cliente normal con & se ve igual que antes');
      afirmar(await page.locator('#main-content h3 img, #main-content img').count() === 0, 'CxC: no se crea ningún <img> en la tarjeta del cliente');
      await sinEjecucion(page, 'CxC');
      await page.close();
    }

    // ── Auditoría de fotos: mensaje de error de la búsqueda ──
    {
      const page = await nuevaPagina(browser, [...BASE, 'js/admin-auditoria.js']);
      await page.evaluate((xss) => {
        window.EVE = { currentUser: { username: 'p', permisosResueltos: {} }, registrosDestaraje: [] };
        window.db = { collection: () => ({ where: () => ({ orderBy: () => ({ limit: () => ({ get: async () => { throw new Error(xss); } }) }) }) }) };
        document.getElementById('main-content').appendChild(window.EVE_ADMIN_AUDITORIA.crearVistaAuditoria());
      }, XSS);
      await page.fill('#aud-ticket-buscar', '123');
      await page.locator('#main-content').getByRole('button', { name: 'Buscar' }).click();
      await page.waitForFunction(() => /Error:/.test(document.getElementById('aud-resultado-buscar').textContent));
      afirmar(await page.locator('#aud-resultado-buscar img').count() === 0, 'Auditoría: el mensaje de error con HTML no crea ningún <img>');
      igual((await page.locator('#aud-resultado-buscar').innerText()).trim(), 'Error: ' + XSS, 'Auditoría: el mensaje se ve como texto literal');
      await sinEjecucion(page, 'Auditoría');
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ── Estático: los cuatro puntos usan la función compartida ──
  const cxc = leer('js/cxc.js');
  const historial = leer('js/historial.js');
  const auditoria = leer('js/admin-auditoria.js');
  afirmar(cxc.includes('<h3 style="margin:0">${window.escaparHtml(grupo.cliente)}</h3>'), 'cxc.js: el cliente de la tarjeta pasa por escaparHtml');
  afirmar(['esc(fechaStr)', 'esc(r.usuario', 'esc(r.coleccion', 'esc(ticket)', 'esc(r.motivo', 'esc(formatearDiff(r.valorAnterior, r.valorNuevo))'].every((t) => historial.includes(t)), 'historial.js: usuario, módulo, ticket, motivo y cambios pasan por escaparHtml');
  afirmar(historial.includes("Error al cargar: ' + window.escaparHtml(e.message)"), 'historial.js: e.message pasa por escaparHtml');
  afirmar(auditoria.includes("Error: ' + window.escaparHtml(e.message)"), 'admin-auditoria.js: e.message pasa por escaparHtml');
  afirmar(!/'<td>' \+ (ticket|\(r\.usuario|\(r\.motivo)/.test(historial), 'historial.js: ya no concatena campos del registro sin escapar');
  afirmar((leer('js/utils.js').match(/window\.escaparHtml = function/g) || []).length === 1, 'utils.js define escaparHtml una sola vez');
  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
