// Verifica el orden cronológico por captura de Báscula: window.ordenarPorCaptura (js/utils.js) ordena por fechaRegistro
// (timestamp que guardarDato agrega a todo registro nuevo) del más antiguo al más reciente, con los registros sin el campo al
// inicio en su orden original. Comprueba que la tabla, la Vista para captura y las exportaciones TXT, PDF y CSV de Báscula
// salen en ese mismo orden, que las flechas de columna siguen funcionando y que los totales no cambian.
//
// Uso: node scripts/verificar-orden-captura.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
  vm.createContext(sandbox);
  ['js/config.js', 'js/utils.js'].forEach((archivo) => vm.runInContext(leer(archivo), sandbox, { filename: archivo }));
  return sandbox.window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const r = (proveedor, ticket, fechaSalida, extra) => ({ proveedor, ticket, fechaSalida, material: 'PET', kg: 10, ...extra });
const tickets = (lista) => lista.map((x) => `${x.proveedor}#${x.ticket}`);
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="toast-container"></div><div id="main-content"></div>
<script>window.firebase={initializeApp(){},firestore(){return{enablePersistence(){return Promise.resolve()}}},auth(){return{onAuthStateChanged(){}}}};window.EVE_MODULES={};</script>
${['config.js', 'utils.js', 'permisos.js', 'ordenar-tabla.js', 'vista-captura.js', 'reportes.js', 'destaraje.js', 'pagos.js'].map((s) => `<script src="/js/${s}"></script>`).join('')}
</body></html>`;

// Registros de Báscula pensados para romper cualquier orden por fecha o por captura: fechas de salida mezcladas dentro de la semana.
async function abrirBascula(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  await page.route('http://eve.test/**', (ruta) => {
    const p = new URL(ruta.request().url()).pathname;
    if (p === '/') return ruta.fulfill({ contentType: 'text/html', body: HTML });
    const f = path.join(RAIZ, p);
    return fs.existsSync(f) ? ruta.fulfill({ path: f }) : ruta.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://eve.test/');
  await page.evaluate((fn) => {
    window.EVE = { currentUser: { username: 'prueba', permisosResueltos: { destaraje: 'lectura' } }, registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], cuentasPorPagar: [], proveedores: [], ventas: [], precios: [], composiciones: [], metaPiezasDia: {} };
    window.__descargas = { csv: null, txt: null, pdfBody: null };
    window.exportarCSV = (filas) => { window.__descargas.csv = filas; };
    window.descargarArchivo = (blob) => { window.__descargas.txt = blob; };
    // jsPDF simulado: registra el cuerpo de las tablas y acepta cualquier otra llamada.
    window.jspdf = { jsPDF: function () {
      const doc = new Proxy({}, { get: (_, nombre) => (nombre === 'internal' ? { pageSize: { getWidth: () => 210 } } : nombre === 'autoTable' ? (op) => { (window.__descargas.tablas = window.__descargas.tablas || []).push(op); } : nombre === 'save' ? () => {} : () => {}) });
      return doc;
    } };
  }, null);
  return { ctx, page };
}

async function cargarDatos(page, registros) {
  // Igual que el login (auth.js): los alias de proveedor se unifican al cargar los datos.
  await page.evaluate((regs) => { window.EVE.registrosDestaraje = window.unificarProveedorEnRegistros(regs); }, registros);
}

const fechas = (page) => page.evaluate(() => ({ hoy: window.obtenerFechaMexico(), ayer: (() => { const d = new Date(`${window.obtenerFechaMexico()}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })() }));

const A = { id: 'a', ticket: '30', proveedor: 'ZETA', material: 'PET', kg: 100, fechaRegistro: '2026-10-01T10:00:00.000Z' };
const B = { id: 'b', ticket: '10', proveedor: 'MARIO', material: 'DURO', kg: 50 };
const C = { id: 'c', ticket: '20', proveedor: 'ALFA', material: 'PET', kg: 70, fechaRegistro: '2026-09-30T09:00:00.000Z' };
const D = { id: 'd', ticket: '5', proveedor: 'BETA', material: 'MIXTO', kg: 30 };
const E = { id: 'e', ticket: '40', proveedor: 'OMEGA', material: 'DURO', kg: 10, fechaRegistro: '2026-10-01T10:00:00.500Z' };
const ESPERADO_CAPTURA = ['10', '5', '20', '30', '40'];

caso('ordenarPorCaptura: sin fechaRegistro al inicio en su orden original, luego ascendente por fecha y hora exacta', () => {
  const w = crearContexto();
  igual(w.ordenarPorCaptura([A, B, C, D, E]).map((x) => x.ticket), ESPERADO_CAPTURA, 'orden');
  igual(w.ordenarPorCaptura([D, B, E, A, C]).map((x) => x.ticket), ['5', '10', '20', '30', '40'], 'sin campo conservan su orden relativo');
});

caso('ordenarPorCaptura: devuelve una copia, tolera vacíos y valores inválidos', () => {
  const w = crearContexto();
  const original = [A, B, C];
  const copia = JSON.stringify(original);
  const orden = w.ordenarPorCaptura(original);
  igual(JSON.stringify(original), copia, 'el arreglo original no cambió');
  afirmar(orden !== original, 'devuelve una copia');
  igual([w.ordenarPorCaptura([]), w.ordenarPorCaptura(undefined), w.ordenarPorCaptura(null)], [[], [], []], 'vacío, undefined y null');
  igual(w.ordenarPorCaptura([{ ticket: 'x', fechaRegistro: 'no es fecha' }, { ticket: 'y', fechaRegistro: '2026-01-01T00:00:00Z' }]).map((x) => x.ticket), ['x', 'y'], 'fecha inválida cuenta como ausente');
});

async function ticketsTabla(page) {
  return page.$$eval('#main-content table.tabla-destaraje tbody tr', (trs) => trs.map((tr) => tr.children[0].textContent.trim()));
}

async function abrirTodos(browser) {
  const sesion = await abrirBascula(browser);
  const { hoy } = await fechas(sesion.page);
  const datos = [A, B, C, D, E].map((x) => ({ ...x, fechaEntrada: hoy, fechaSalida: hoy }));
  await cargarDatos(sesion.page, datos);
  await sesion.page.evaluate(() => window.EVE_MODULES.destaraje.render(document.getElementById('main-content')));
  await sesion.page.click('.tabs .tab:has-text("Todos")');
  return sesion;
}

caso('Báscula · la tabla sale por defecto en orden de captura; las flechas de columna se respetan; al recargar vuelve a captura', async (browser) => {
  const { ctx, page } = await abrirTodos(browser);
  igual(await ticketsTabla(page), ESPERADO_CAPTURA, 'orden por defecto');
  await page.click('#main-content table.tabla-destaraje th:has-text("Ticket")');
  igual(await ticketsTabla(page), ['5', '10', '20', '30', '40'], 'ordenada por Ticket ascendente');
  await page.click('#main-content table.tabla-destaraje th:has-text("Proveedor")');
  igual(await ticketsTabla(page), ['20', '5', '10', '40', '30'], 'ordenada por Proveedor ascendente');
  await ctx.close();
  const recarga = await abrirTodos(browser);
  igual(await ticketsTabla(recarga.page), ESPERADO_CAPTURA, 'tras recargar vuelve al orden de captura');
  igual(recarga.page.errores, [], 'errores de JS');
  await recarga.ctx.close();
});

caso('Báscula · un registro nuevo (con fechaRegistro de ahora) queda al final', async (browser) => {
  const { ctx, page } = await abrirTodos(browser);
  await page.evaluate(() => {
    window.EVE.registrosDestaraje.push({ id: 'z', ticket: '99', proveedor: 'NUEVO', material: 'PET', kg: 5, fechaEntrada: window.obtenerFechaMexico(), fechaSalida: window.obtenerFechaMexico(), fechaRegistro: new Date().toISOString() });
    window.EVE_MODULES.destaraje.render(document.getElementById('main-content'));
  });
  await page.click('.tabs .tab:has-text("Todos")');
  igual((await ticketsTabla(page)).slice(-1), ['99'], 'último');
  await ctx.close();
});

caso('Báscula · Vista para captura, CSV, TXT y PDF salen en el mismo orden que la tabla; totales intactos', async (browser) => {
  const { ctx, page } = await abrirTodos(browser);
  const tabla = await ticketsTabla(page);
  igual(tabla, ESPERADO_CAPTURA, 'tabla');

  await page.click('#btn-vista-captura');
  const captura = await page.$$eval('#vista-captura-overlay .captura-col-tickets .captura-tabla tbody tr', (trs) => trs.map((tr) => tr.children[0].textContent.trim()));
  igual(captura, tabla, 'Vista para captura');
  await page.evaluate(() => window.VistaCaptura.cerrar());

  const res = await page.evaluate(async () => {
    window.exportarReporteDestarajeCSV('todos', { ticket: '', desde: '', hasta: '', proveedor: '', material: '' });
    const csv = window.__descargas.csv.map((f) => String(f.ticket));
    window.exportarReporteDestarajeTXT('todos', { ticket: '', desde: '', hasta: '', proveedor: '', material: '' });
    const txt = await window.__descargas.txt.text();
    window.exportarReporteDestarajePDF('todos', { ticket: '', desde: '', hasta: '', proveedor: '', material: '' });
    const tablas = window.__descargas.tablas || [];
    const pdf = (tablas.length ? tablas[tablas.length - 1].body : []).map((f) => String(f[0]));
    return { csv, txt, pdf };
  });
  igual(res.csv, tabla, 'CSV');
  igual(res.pdf, tabla, 'PDF');
  const lineas = res.txt.split('\n');
  const inicio = lineas.findIndex((l) => /TICKET\s+PROVEEDOR/.test(l));
  afirmar(inicio >= 0, 'no se encontró el detalle en el TXT');
  igual(lineas.slice(inicio + 1).filter((l) => l.trim()).map((l) => l.trim().split(/\s{2}/)[0]).filter((t) => /^\d+$/.test(t)).slice(0, 5), tabla, 'TXT');
  afirmar(res.txt.includes('TOTAL KG: 260'), `TOTAL KG distinto de 260: ${(res.txt.match(/TOTAL KG:.*/) || [''])[0]}`);
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
