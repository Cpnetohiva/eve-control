// Verifica el buscador superior de Báscula (js/destaraje.js): busca, sin distinguir mayúsculas ni acentos y con coincidencia
// parcial, en proveedor, material y ticket a la vez; ya no copia el texto al filtro Proveedor; aplica en Hoy, Esta Semana,
// Este Mes y Todos; se suma a los filtros de Todos (deben cumplirse todos) y lo respetan el contador de registros y kg, la
// Vista para captura y las exportaciones TXT, PDF y CSV.
//
// Uso: node scripts/verificar-bascula-busqueda.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="toast-container"></div><div id="main-content"></div>
<script>window.firebase={initializeApp(){},firestore(){return{enablePersistence(){return Promise.resolve()}}},auth(){return{onAuthStateChanged(){}}}};window.EVE_MODULES={};</script>
${['config.js', 'utils.js', 'permisos.js', 'ordenar-tabla.js', 'vista-captura.js', 'reportes.js', 'destaraje.js'].map((s) => `<script src="/js/${s}"></script>`).join('')}
</body></html>`;

async function abrirBascula(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  await page.route('http://eve.test/**', (ruta) => {
    const url = new URL(ruta.request().url()).pathname;
    if (url === '/') return ruta.fulfill({ contentType: 'text/html', body: HTML });
    const archivo = path.join(RAIZ, url);
    if (fs.existsSync(archivo)) return ruta.fulfill({ body: fs.readFileSync(archivo), contentType: url.endsWith('.css') ? 'text/css' : 'application/javascript' });
    return ruta.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://eve.test/');
  await page.evaluate(() => {
    window.EVE = { registrosPagos: [], registrosVentas: [], ventas: [] };
    window.__descargas = {};
    window.exportarCSV = (filas) => { window.__descargas.csv = filas; };
    window.descargarArchivo = (blob) => blob.text().then((t) => { window.__descargas.txt = t; });
    window.jspdf = {
      jsPDF: function () {
        const doc = { internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } }, lastAutoTable: { finalY: 0 }, textos: [], tablas: [] };
        return new Proxy(doc, {
          get: (o, k) => {
            if (k in o) return o[k];
            if (k === 'text') return (t) => { o.textos.push(String(t)); };
            if (k === 'autoTable') return (op) => { o.tablas.push(op); };
            if (k === 'save') return () => { window.__descargas.pdf = { textos: o.textos, tablas: o.tablas }; };
            return () => {};
          }
        });
      }
    };
    const hoy = window.obtenerFechaMexico();
    window.EVE.registrosDestaraje = [
      { id: 'a', ticket: '1001', proveedor: 'PÉREZ HNOS', material: 'PET CRISTAL', kg: 100, fechaEntrada: hoy, fechaSalida: hoy },
      { id: 'b', ticket: '2002', proveedor: 'ALFA', material: 'CARTÓN', kg: 50, fechaEntrada: hoy, fechaSalida: hoy },
      { id: 'c', ticket: '3003', proveedor: 'BETA', material: 'DURO NEGRO', kg: 25, fechaEntrada: '2020-01-01', fechaSalida: '2020-01-01' }
    ];
    window.EVE_MODULES.destaraje.render(document.getElementById('main-content'));
  });
  return { ctx, page };
}

const irATab = (page, nombre) => page.click(`.destaraje-subtabs .tab:has-text("${nombre}")`);
const buscar = (page, texto) => page.fill('#destaraje-buscar-global', texto);
const tickets = (page) => page.$$eval('#destaraje-tabla-destaraje tr', (trs) => trs.map((tr) => tr.children[0].textContent.trim()).filter((t) => t !== 'Sin registros'));
const stats = (page) => page.$eval('#destaraje-stats', (e) => [...e.children].map((x) => x.textContent.trim()).join(' | '));
const pestanaActiva = (page) => page.$eval('.destaraje-subtabs .tab.active', (e) => e.textContent.trim());

// Pulsa el botón real de exportación (TXT, PDF o CSV) y devuelve lo que se habría descargado.
async function exportar(page, texto) {
  await page.evaluate(() => { window.__descargas = {}; });
  await page.click(`.destaraje-exportar button:text-is("${texto}")`);
  await page.waitForTimeout(80);
  return page.evaluate(() => window.__descargas);
}

caso('buscar un fragmento de material encuentra el registro (sin mayúsculas ni acentos)', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'cristal');
  igual(await tickets(page), ['1001'], 'fragmento de material');
  await buscar(page, 'CRIS');
  igual(await tickets(page), ['1001'], 'mayúsculas y parcial');
  await buscar(page, 'carton');
  igual(await tickets(page), ['2002'], 'sin acento encuentra CARTÓN');
  await buscar(page, 'CARTÓN');
  igual(await tickets(page), ['2002'], 'con acento');
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

caso('proveedor y ticket siguen funcionando (parcial, sin acentos)', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'perez');
  igual(await tickets(page), ['1001'], 'proveedor sin acento');
  await buscar(page, 'Pérez hn');
  igual(await tickets(page), ['1001'], 'proveedor parcial');
  await buscar(page, '2002');
  igual(await tickets(page), ['2002'], 'ticket completo');
  await buscar(page, '100');
  igual(await tickets(page), ['1001'], 'ticket parcial');
  await buscar(page, 'alfa');
  igual(await tickets(page), ['2002'], 'proveedor ALFA');
  await ctx.close();
});

caso('un texto sin coincidencias da cero registros y totales en cero', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'zzzxxx');
  igual(await tickets(page), [], 'sin filas');
  igual(await stats(page), 'Registros: 0 | Total KG: 0', 'contadores');
  await buscar(page, '');
  igual(await tickets(page), ['1001', '2002'], 'al vaciar el buscador vuelve la lista de Hoy');
  await ctx.close();
});

caso('ya no copia el texto al filtro Proveedor ni cambia de pestaña', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'alfa');
  igual(await page.inputValue('#ft-proveedor'), '', 'ft-proveedor vacío');
  igual(await page.inputValue('#ft-ticket'), '', 'ft-ticket vacío');
  igual(await page.inputValue('#ft-material'), '', 'ft-material vacío');
  igual(await pestanaActiva(page), 'Hoy', 'sigue en Hoy');
  await ctx.close();
});

caso('aplica en Hoy, Esta Semana, Este Mes y Todos; los contadores respetan la búsqueda', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'cristal');
  for (const tab of ['Hoy', 'Esta Semana', 'Este Mes', 'Todos']) {
    await irATab(page, tab);
    igual(await tickets(page), ['1001'], `pestaña ${tab}`);
    igual(await stats(page), 'Registros: 1 | Total KG: 100', `contadores en ${tab}`);
  }
  await buscar(page, 'duro');
  await irATab(page, 'Hoy');
  igual(await tickets(page), [], 'DURO es de 2020: no sale en Hoy');
  await irATab(page, 'Todos');
  igual(await tickets(page), ['3003'], 'DURO sí sale en Todos');
  await ctx.close();
});

caso('Todos: el filtro de Material existe, es parcial y se combina con la búsqueda (deben cumplirse todos)', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await irATab(page, 'Todos');
  igual(await tickets(page), ['1001', '2002', '3003'], 'sin filtros');
  await page.fill('#ft-material', 'cris');
  igual(await tickets(page), ['1001'], 'filtro Material parcial');
  await page.fill('#ft-material', '');
  await buscar(page, 'perez');
  await page.fill('#ft-material', 'carton');
  igual(await tickets(page), [], 'búsqueda de uno y material de otro: ninguno cumple ambos');
  await page.fill('#ft-material', 'crist');
  igual(await tickets(page), ['1001'], 'búsqueda y material del mismo registro');
  await page.fill('#ft-proveedor', 'beta');
  igual(await tickets(page), [], 'con proveedor distinto tampoco cumple');
  await ctx.close();
});

caso('buscar una fecha sigue funcionando (pasa a Todos con ese rango)', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, '2020-01-01');
  igual(await pestanaActiva(page), 'Todos', 'pestaña Todos');
  igual(await tickets(page), ['3003'], 'registro de esa fecha');
  await buscar(page, 'cristal');
  igual(await tickets(page), ['1001'], 'el rango de la búsqueda por fecha se descarta al buscar texto');
  await ctx.close();
});

caso('Vista para captura respeta la búsqueda', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'carton');
  await page.click('#btn-vista-captura');
  const filas = await page.$$eval('#vista-captura-overlay .captura-col-tickets .captura-tabla tr', (trs) => trs.map((tr) => tr.children[0].textContent.trim()));
  afirmar(filas.includes('2002') && !filas.includes('1001'), `filas de la vista: ${JSON.stringify(filas)}`);
  const texto = await page.$eval('#vista-captura-overlay', (e) => e.textContent.replace(/\s+/g, ' '));
  afirmar(texto.replace(/\s+/g, '').includes('1Registros50KGTotalKG'), `KPIs de la vista: ${texto.slice(0, 200)}`);
  await ctx.close();
});

caso('TXT, PDF y CSV respetan la búsqueda (con y sin resultados)', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  await buscar(page, 'cristal');
  const csv = await exportar(page, 'CSV');
  igual(csv.csv.map((f) => String(f.ticket)), ['1001'], 'CSV');
  const txt = await exportar(page, 'TXT');
  afirmar(txt.txt.includes('1001') && !txt.txt.includes('2002') && txt.txt.includes('TOTAL KG: 100'), 'TXT con la búsqueda');
  const pdf = await exportar(page, 'PDF');
  igual(pdf.pdf.tablas.flatMap((t) => (t.body || []).map((f) => String(f[0]))).filter((t) => /^\d+$/.test(t)), ['1001'], 'PDF');
  afirmar(pdf.pdf.textos.some((t) => t.includes('TOTAL KG: 100')), 'PDF total');
  await buscar(page, 'zzzxxx');
  const csv0 = await exportar(page, 'CSV');
  igual((csv0.csv || []).filter((f) => f.ticket).length, 0, 'CSV sin coincidencias');
  const txt0 = await exportar(page, 'TXT');
  afirmar(txt0.txt.includes('TOTAL KG: 0') && !txt0.txt.includes('1001'), 'TXT sin coincidencias');
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn(browser);
      console.log(`ok   ${nombre}`);
    } catch (error) {
      fallos++;
      console.log(`FALLA ${nombre}\n     ${error.message}`);
    }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
