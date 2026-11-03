// Orden de la tabla de Ventas y del reporte compartido:
//  (b) con la misma fecha, folio descendente (V-2026-048 antes que V-2026-046), igual en la tabla y en el reporte de js/reportes.js;
//  (c) ordenar por columna mueve el folio COMPLETO como bloque (líneas + subtotal); en Material, Cantidad y Precio Unitario el orden
//      sale de la primera línea de cada folio.
// Usa los js/ reales en Chromium (Playwright). Uso: node scripts/verificar-ventas-orden.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

const L = (material, cantidad, unidad, precioUnitario) => {
  const t = Math.round(cantidad * precioUnitario * 100) / 100;
  return { material, cantidad, unidad, precioUnitario, subtotal: t, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: t };
};
const V = (n, cliente, fecha, lineas) => ({ id: 'v' + n, folio: 'V-2026-' + String(n).padStart(3, '0'), cliente, fecha, lineas, totalVenta: Math.round(lineas.reduce((s, l) => s + l.totalLinea, 0) * 100) / 100 });
const VENTAS = [
  V(46, 'ACME', '2026-10-22', [L('PET', 100, 'KG', 12.5)]),
  V(47, 'BETA', '2026-10-23', [L('PP', 2000, 'KG', 6), L('PET', 300, 'KG', 13)]),
  V(48, 'GAMA', '2026-10-23', [L('HDPE', 500, 'KG', 8), L('PP', 50, 'KG', 7)]),
  V(40, 'ACME', '2026-10-01', [L('TAPA', 10, 'PZ', 2)])
];
const copia = JSON.stringify(VENTAS);
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/cxc.js', 'js/ventas.js'];

async function montar(browser, ventas) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ ventas }) => {
    window.obtenerFechaMexico = () => '2026-11-04';
    window.puedeEscribir = () => false;
    window.puedeLeer = () => true;
    window.showError = () => {};
    window.showSuccess = () => {};
    window.EVE_HISTORIAL = { registrar: () => {} };
    window.EVE = { currentUser: { username: 'p', permisosResueltos: {} }, ventas, registrosVentas: [], registrosDestaraje: [], registrosPagos: [], precios: [], composiciones: [], recibosPendientes: [], auditorias: [], proveedores: [], clientes: [], cuentasPorPagar: [], cuentasPorCobrar: [], cobros: [], gastos: [], flujoMovimientos: [], inventario: [], inventarioInicial: [], registrosControlProduccion: [], metaPiezasDia: {} };
    window.EVE_MODULES.ventas.render(document.getElementById('main-content'));
  }, { ventas });
  await page.locator('.destaraje-subtabs .tab', { hasText: /^Todas$/ }).click();
  page.erroresPagina = errores;
  return page;
}

// Filas de la tabla agrupadas por folio: [{ folio, lineas: [material...], subtotal: 'Subtotal V-...' }]
const bloques = (page) => page.$$eval('#ventas-tabla-body tr', (filas) => {
  const grupos = [];
  filas.forEach((tr) => {
    const c = Array.from(tr.cells).map((x) => x.textContent.trim());
    if (c[0]) grupos.push({ folio: c[0], lineas: [c[3]], subtotal: null, filas: 1 });
    else if (/^Subtotal /.test(c[3])) { const g = grupos[grupos.length - 1]; g.subtotal = c[3]; g.filas++; }
    else { const g = grupos[grupos.length - 1]; g.lineas.push(c[3]); g.filas++; }
  });
  return grupos;
});
const folios = async (page) => (await bloques(page)).map((g) => g.folio);
const clickEncabezado = (page, texto) => page.locator('#ventas-tabla-body').locator('xpath=ancestor::table//th', { hasText: new RegExp('^' + texto) }).first().click();

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await montar(browser, VENTAS);

    // ── (b) Desempate por folio descendente con la misma fecha ──
    igual(await folios(page), ['V-2026-048', 'V-2026-047', 'V-2026-046', 'V-2026-040'], 'tabla de Ventas: fecha descendente y, con la misma fecha (23/10), folio descendente');
    const comparador = await page.evaluate(() => {
      const c = window.compararVentasRecientes;
      return [c({ fecha: '2026-10-23', folio: 'V-2026-048' }, { fecha: '2026-10-23', folio: 'V-2026-047' }), c({ fecha: '2026-10-22', folio: 'V-2026-099' }, { fecha: '2026-10-23', folio: 'V-2026-001' }), c({ fecha: '2026-10-23', folio: 'V-2026-9' }, { fecha: '2026-10-23', folio: 'V-2026-10' }), c({ fecha: 'x', folio: 'V-1' }, { fecha: 'x', folio: 'V-1' })];
    });
    igual(comparador.map((n) => Math.sign(n)), [-1, 1, 1, 0], 'comparador: folio mayor primero (V-2026-10 antes que V-2026-9, comparación numérica), la fecha manda y empate total = 0');
    const reporte = await page.evaluate(() => window.obtenerVentasReporte('', '', {}).map((v) => v.folio));
    igual(reporte, ['V-2026-048', 'V-2026-047', 'V-2026-046', 'V-2026-040'], 'reporte compartido (js/reportes.js): mismo orden que la tabla');
    const invertido = await page.evaluate((v) => { window.EVE.ventas = v.slice().reverse(); return window.obtenerVentasReporte('', '', {}).map((x) => x.folio); }, VENTAS);
    igual(invertido, reporte, 'el orden no depende del orden en que llegan los datos (antes un empate quedaba indefinido)');
    await page.evaluate((v) => { window.EVE.ventas = v; }, VENTAS);
    const txt = await page.evaluate(() => window.generarTXTVentas(window.obtenerVentasReporte('', '', {}), { etiquetaReporte: 'TODOS', etiquetaPeriodo: 'X' }));
    afirmar(txt.indexOf('V-2026-048') < txt.indexOf('V-2026-047') && txt.indexOf('V-2026-047') < txt.indexOf('V-2026-046'), 'el TXT del reporte respeta el mismo orden');

    // ── (c) Bloques por folio: líneas + subtotal viajan juntos ──
    const base = await bloques(page);
    igual(base.map((g) => [g.folio, g.lineas.length, g.subtotal]), [['V-2026-048', 2, 'Subtotal V-2026-048'], ['V-2026-047', 2, 'Subtotal V-2026-047'], ['V-2026-046', 1, 'Subtotal V-2026-046'], ['V-2026-040', 1, 'Subtotal V-2026-040']], 'cada folio: sus líneas y su fila de subtotal');

    const casos = [
      // [encabezado, orden ascendente esperado por la primera línea, descendente]
      ['Material', ['V-2026-048', 'V-2026-046', 'V-2026-047', 'V-2026-040'], 'primera línea: HDPE, PET, PP, TAPA'],
      ['Cantidad', ['V-2026-040', 'V-2026-046', 'V-2026-048', 'V-2026-047'], 'primera línea: 10, 100, 500, 2000'],
      ['Precio Unitario', ['V-2026-040', 'V-2026-047', 'V-2026-048', 'V-2026-046'], 'primera línea: 2, 6, 8, 12.5']
    ];
    for (const [encabezado, ascendente, nota] of casos) {
      await clickEncabezado(page, encabezado);
      let orden = await bloques(page);
      igual(orden.map((g) => g.folio), ascendente, `${encabezado} ascendente (${nota})`);
      afirmar(orden.every((g) => g.subtotal === 'Subtotal ' + g.folio && g.lineas.length === base.find((b) => b.folio === g.folio).lineas.length), `${encabezado} ascendente: cada folio conserva todas sus líneas y su subtotal pegados`);
      await clickEncabezado(page, encabezado);
      orden = await bloques(page);
      igual(orden.map((g) => g.folio), ascendente.slice().reverse(), `${encabezado} descendente`);
      afirmar(orden.every((g) => g.subtotal === 'Subtotal ' + g.folio), `${encabezado} descendente: los subtotales siguen con su folio`);
    }
    await clickEncabezado(page, 'Folio');
    igual(await folios(page), ['V-2026-040', 'V-2026-046', 'V-2026-047', 'V-2026-048'], 'Folio ascendente');
    afirmar((await bloques(page)).every((g) => g.subtotal === 'Subtotal ' + g.folio), 'Folio: los bloques siguen completos');

    // Los datos no se modifican y no hay errores
    igual(await page.evaluate(() => JSON.stringify(window.EVE.ventas)), copia, 'las ventas en memoria no cambian al ordenar');
    afirmar(page.erroresPagina.length === 0, 'sin errores de JavaScript: ' + page.erroresPagina.join(' / '));
  } finally {
    await browser.close();
  }

  // Estático: ambos usan el mismo comparador
  const ventas = leer('js/ventas.js');
  const reportes = leer('js/reportes.js');
  afirmar(ventas.includes('.sort(window.compararVentasRecientes)') && reportes.includes('.sort(window.compararVentasRecientes)'), 'la tabla y el reporte usan el mismo comparador');
  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
