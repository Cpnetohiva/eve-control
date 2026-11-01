// Prueba de la selección múltiple y el resumen tipo reporte de Recibos de Pago (Chromium con Playwright): checkbox por fila y
// "seleccionar todos" que solo marca lo visible según los filtros, barra con contador/total/'Ver resumen', modal con periodo,
// tabla por proveedor (mayor a menor), desglose por forma de pago y GRAN TOTAL, limpieza de la selección al cambiar filtros, y
// que todo sale de la lista ya cargada (una sola lectura a recibos_pago). El PDF se prueba con jsPDF/autoTable de la caché temporal
// que dejan las otras verificaciones de PDF; sin ella ese caso se OMITE (se avisa), no se da por bueno.
//
// Uso: node scripts/verificar-recibos-pago-seleccion.js   (código de salida 1 si algo falla)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const CACHE_LIBS = path.join(os.tmpdir(), 'eve-pdf-libs');
const LIBS_PDF = ['jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js'].map((n) => path.join(CACHE_LIBS, n));
const hayLibsPdf = LIBS_PDF.every((p) => fs.existsSync(p) && fs.statSync(p).size > 1000);
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/recibos-pago.js'];

const RECIBOS = [
  { id: 'a', proveedor: 'ALFA', totalPago: 1000, fecha: '2026-10-01', formaPago: 'efectivo' },
  { id: 'b', proveedor: 'BETA', totalPago: 5000.5, fecha: '2026-10-02', formaPago: 'transferencia' },
  { id: 'c', proveedor: 'ALFA', totalPago: 2000, fecha: '2026-10-03', formaPago: 'transferencia' },
  { id: 'd', proveedor: 'GAMA', totalPago: 300, fecha: '2026-10-10', formaPago: 'efectivo' }
];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, conPdf) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate((recibos) => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  }, RECIBOS);
  if (conPdf) for (const p of LIBS_PDF) await page.addScriptTag({ path: p });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  if (conPdf) {
    // Mismo arranque del PDF institucional que usa cxp.js (iniciarPDFConTitulo + COLOR_MARCA_PDF), sin cargar todo cxp.js.
    await page.evaluate(() => {
      window.EVE_CXP = window.EVE_CXP || {};
      window.EVE_CXP.COLOR_MARCA_PDF = [0, 29, 61];
      window.EVE_CXP.iniciarPDFConTitulo = (titulo) => {
        const pdf = new window.jspdf.jsPDF();
        const anchoPagina = pdf.internal.pageSize.getWidth();
        pdf.setFontSize(18); pdf.setFont('helvetica', 'bold');
        pdf.text(titulo, anchoPagina / 2, 20, { align: 'center' });
        pdf.setFontSize(11); pdf.setFont('helvetica', 'normal');
        return { pdf, anchoPagina, y: 32 };
      };
    });
  }
  // config.js crea su propio window.db: la base simulada se pone después de cargar los scripts.
  await page.evaluate((recibos) => {
    window.lecturas = 0;
    window.db = { collection(nombre) {
      return { orderBy() { return { get() { window.lecturas += 1; return Promise.resolve({ docs: recibos.map((r) => ({ id: r.id, data: () => { const { id, ...resto } = r; return resto; } })) }); } }; } };
    } };
    window.render = () => {
      const cont = document.getElementById('main-content');
      cont.innerHTML = '';
      window.EVE_MODULES.recibosPago.render(cont);
    };
    window.render();
  }, RECIBOS);
  await page.waitForSelector('#rpg-tabla tr');
  page.erroresPagina = errores;
  return page;
}

const filasVisibles = (page) => page.$$eval('#rpg-tabla tr', (f) => f.length);
const marcadas = (page) => page.$$eval('#rpg-tabla input.rpg-check:checked', (c) => c.length);

caso('cada fila tiene checkbox y el encabezado tiene "seleccionar todos"; sin selección no hay barra', async (browser) => {
  const page = await nuevaPagina(browser);
  igual(await page.$$eval('#rpg-tabla input.rpg-check', (c) => c.length), 4, 'checkboxes por fila');
  afirmar(await page.$('#rpg-check-todos'), 'falta el checkbox del encabezado');
  afirmar(!(await page.isVisible('#rpg-barra-seleccion')), 'la barra no debe verse sin selección');
  afirmar((await page.$$eval('#rpg-tabla tr', (f) => f.every((r) => r.firstElementChild.querySelector('input.rpg-check')))), 'el checkbox va al inicio de la fila');
});

caso('la barra muestra contador y total de lo seleccionado y se actualiza', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.check('#rpg-tabla tr:nth-child(1) input.rpg-check');
  await page.check('#rpg-tabla tr:nth-child(2) input.rpg-check');
  afirmar(await page.isVisible('#rpg-barra-seleccion'), 'la barra debe verse');
  const texto = await page.textContent('#rpg-barra-seleccion');
  afirmar(/2 recibos seleccionados/.test(texto), `contador: ${texto}`);
  afirmar(texto.includes('$6,000.50'), `total: ${texto}`);
  afirmar(await page.isVisible('#rpg-btn-ver-resumen'), "falta 'Ver resumen'");
  await page.uncheck('#rpg-tabla tr:nth-child(2) input.rpg-check');
  afirmar(/1 recibo seleccionado\b/.test(await page.textContent('#rpg-barra-seleccion')), 'singular con 1');
  await page.uncheck('#rpg-tabla tr:nth-child(1) input.rpg-check');
  afirmar(!(await page.isVisible('#rpg-barra-seleccion')), 'la barra se oculta sin selección');
});

caso('"seleccionar todos" marca solo los visibles según los filtros y refleja estado indeterminado', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.fill('#rpg-filtro-hasta', '2026-10-03');
  await page.dispatchEvent('#rpg-filtro-hasta', 'change');
  igual(await filasVisibles(page), 3, 'filas con filtro');
  await page.check('#rpg-check-todos');
  igual(await marcadas(page), 3, 'marcadas');
  afirmar(/3 recibos seleccionados/.test(await page.textContent('#rpg-barra-seleccion')), 'contador de 3');
  afirmar((await page.textContent('#rpg-barra-seleccion')).includes('$8,000.50'), 'el recibo oculto (300) no cuenta');
  await page.uncheck('#rpg-tabla tr:nth-child(1) input.rpg-check');
  igual(await page.$eval('#rpg-check-todos', (c) => ({ c: c.checked, i: c.indeterminate })), { c: false, i: true }, 'estado parcial');
  await page.click('#rpg-check-todos'); // en estado parcial (sin marcar) un clic marca todos los visibles
  igual(await marcadas(page), 3, 'marcar todos desde el estado parcial');
  await page.click('#rpg-check-todos');
  igual(await marcadas(page), 0, 'desmarcar todos');
});

caso('cambiar un filtro o limpiarlos limpia la selección', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.check('#rpg-check-todos');
  igual(await marcadas(page), 4, 'todas marcadas');
  await page.selectOption('#rpg-filtro-proveedor', 'ALFA');
  igual(await marcadas(page), 0, 'sin marcas tras filtrar');
  afirmar(!(await page.isVisible('#rpg-barra-seleccion')), 'barra oculta tras filtrar');
  await page.check('#rpg-check-todos');
  await page.click('text=Limpiar filtros');
  igual(await marcadas(page), 0, 'sin marcas tras limpiar filtros');
  afirmar(!(await page.$eval('#rpg-check-todos', (c) => c.checked)), 'encabezado desmarcado');
});

caso('el resumen agrupa por proveedor de mayor a menor, desglosa por forma de pago y da el GRAN TOTAL', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.check('#rpg-check-todos');
  await page.click('#rpg-btn-ver-resumen');
  afirmar(await page.isVisible('#rpg-resumen-overlay.open .modal'), 'el modal debe abrirse');
  const modal = await page.textContent('#rpg-resumen-overlay');
  afirmar(modal.includes('Del 01/10/2026 al 10/10/2026'), `rango de fechas: ${modal}`);
  const proveedores = await page.$$eval('#rpg-resumen-proveedores tbody tr', (f) => f.map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  igual(proveedores, [['BETA', '1', '$5,000.50'], ['ALFA', '2', '$3,000.00'], ['GAMA', '1', '$300.00']], 'tabla por proveedor');
  const formas = await page.$$eval('#rpg-resumen-formas tbody tr', (f) => f.map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  igual(formas, [['Transferencia', '2', '$7,000.50'], ['Efectivo', '2', '$1,300.00']], 'desglose por forma de pago');
  igual((await page.textContent('#rpg-resumen-gran-total')).replace(/\s+/g, ' ').trim(), 'GRAN TOTAL $8,300.50', 'gran total');
  afirmar(await page.isVisible('#rpg-resumen-imprimir') && await page.isVisible('#rpg-resumen-pdf'), 'faltan Imprimir / Descargar PDF');
  await page.click('#rpg-resumen-cerrar');
  afirmar(!(await page.isVisible('#rpg-resumen-overlay.open')), 'el modal debe cerrarse');
});

caso('con una sola fecha el modal dice "Día dd/mm/aaaa"; el resumen respeta solo lo seleccionado', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.check('#rpg-tabla tr:nth-child(2) input.rpg-check');
  await page.click('#rpg-btn-ver-resumen');
  const modal = await page.textContent('#rpg-resumen-overlay');
  afirmar(modal.includes('Día 02/10/2026'), `fecha única: ${modal}`);
  igual((await page.textContent('#rpg-resumen-gran-total')).replace(/\s+/g, ' ').trim(), 'GRAN TOTAL $5,000.50', 'gran total de 1 recibo');
});

caso('todo sale de la lista ya cargada: una sola lectura a recibos_pago', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.check('#rpg-check-todos');
  await page.click('#rpg-btn-ver-resumen');
  await page.click('#rpg-resumen-cerrar');
  await page.selectOption('#rpg-filtro-proveedor', 'BETA');
  igual(await page.evaluate(() => window.lecturas), 1, 'lecturas a Firestore');
});

caso('Descargar PDF genera un PDF institucional con el gran total', async (browser) => {
  if (!hayLibsPdf) { console.log('  (omitido: no hay jsPDF/autoTable en la caché temporal)'); return; }
  const page = await nuevaPagina(browser, true);
  await page.check('#rpg-check-todos');
  await page.click('#rpg-btn-ver-resumen');
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click('#rpg-resumen-pdf')]);
  const ruta = path.join(os.tmpdir(), 'eve-recibos-pago-resumen.pdf');
  await descarga.saveAs(ruta);
  const texto = fs.readFileSync(ruta).toString('latin1');
  afirmar(texto.startsWith('%PDF-'), 'no es un PDF');
  afirmar(texto.includes('RESUMEN DE RECIBOS DE PAGO'), 'falta el título');
  afirmar(texto.includes('GRAN TOTAL: $8,300.50'), 'falta el gran total');
  afirmar(/recibos-pago-resumen.*\.pdf$/.test(descarga.suggestedFilename()), `nombre: ${descarga.suggestedFilename()}`);
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`OK   ${nombre}`); } catch (e) { fallos += 1; console.log(`FALLA ${nombre}\n     ${e.message.split('\n')[0]}`); }
  }
  await browser.close();
  console.log(fallos ? `\n${fallos} de ${casos.length} fallaron` : `\nTodas las pruebas pasaron (${casos.length})`);
  process.exit(fallos ? 1 : 0);
})();
