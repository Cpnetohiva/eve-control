// Visibilidad de la fecha de pago en CxP (js/cxp.js), vista de proveedor: desplegable 'Pagos por día' (agrupa los abonos por
// la fecha del recibo de pago, no la del ticket; total del día, tickets cubiertos, detalle por ticket, del día más reciente al
// más antiguo) y columna 'Pagado el' (fecha del último abono) en las cuentas liquidadas. Todo sale de los abonos ya cargados:
// ninguna lectura a Firestore. No toca los botones existentes (Ver (n), Revertir, Ajustar, Eliminar...).
//
// Uso: node scripts/verificar-cxp-pagos-por-dia.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js'];

const abono = (id, monto, fecha, grupo) => ({ abonoId: id, monto, fecha, referencia: '', registradoPor: 'u', grupoPagoId: grupo });
const CUENTAS = [
  // Ticket de septiembre pagado en dos días de octubre; el segundo abono lo liquida.
  { id: 'c1', proveedor: 'ALFA', ticket: '101', material: 'PET', kg: 100, precioEfectivo: 10, total: 1000, iva: 0, pagado: 1000, saldo: 0, estado: 'liquidado', fechaTicket: '2026-09-01', abonos: [abono('a1', 400, '2026-10-05', 'g1'), abono('a2', 600, '2026-10-12', 'g2')] },
  { id: 'c2', proveedor: 'ALFA', ticket: '102', material: 'HDPE', kg: 50, precioEfectivo: 20, total: 1000, iva: 0, pagado: 1000, saldo: 0, estado: 'liquidado', fechaTicket: '2026-10-02', abonos: [abono('a3', 1000, '2026-10-12', 'g2')] },
  // Con abono parcial: cuenta en 'Pagos por día' pero sin 'Pagado el'.
  { id: 'c3', proveedor: 'ALFA', ticket: '103', material: 'PET', kg: 10, precioEfectivo: 10, total: 100, iva: 0, pagado: 30, saldo: 70, estado: 'parcial', fechaTicket: '2026-10-03', abonos: [abono('a4', 30, '2026-10-05', 'g1')] },
  { id: 'c4', proveedor: 'ALFA', ticket: '104', material: 'PET', kg: 10, precioEfectivo: 10, total: 100, iva: 0, pagado: 0, saldo: 100, estado: 'pendiente', fechaTicket: '2026-10-04', abonos: [] }
];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, cuentas) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  // Se monta la vista real de CxP (así 'Ver liquidados' y los re-renders funcionan) con Firestore simulado y vacío.
  await page.evaluate((cs) => {
    window.lecturas = 0;
    const consulta = { where() { return consulta; }, orderBy() { return consulta; }, get: async () => { window.lecturas += 1; return { docs: [] }; } };
    window.db = { collection() { return consulta; } };
    window.puedeEscribir = () => true;
    window.puedeLeer = () => true;
    window.showError = (m) => { (window.__avisos = window.__avisos || []).push(m); };
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: { cxp: 'escritura', pagos: 'escritura' } },
      registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], proveedores: [], ventas: [], precios: [],
      composiciones: [], recibosPendientes: [], auditorias: [], metaPiezasDia: {}, cuentasPorPagar: cs
    };
    window.EVE_MODULES.cxp.render(document.getElementById('main-content'));
  }, cuentas);
  await page.locator('button', { hasText: 'Ver Detalle' }).first().click();
  await page.waitForSelector('#cxp-tabla-cuentas-ALFA');
  await page.evaluate(() => { window.lecturas = 0; });
  page.erroresPagina = errores;
  return page;
}

caso('agruparPagosPorDiaCxP: por fecha del abono, del más reciente al más antiguo, con total, tickets y montos en centavos', async (browser) => {
  const page = await nuevaPagina(browser, CUENTAS);
  const dias = await page.evaluate((cs) => window.EVE_CXP.agruparPagosPorDiaCxP(cs), CUENTAS);
  igual(dias.map((d) => [d.fecha, d.total, d.numTickets]), [['2026-10-12', 1600, 2], ['2026-10-05', 430, 2]], 'días');
  igual(dias[0].tickets, [{ ticket: '101', material: 'PET', monto: 600 }, { ticket: '102', material: 'HDPE', monto: 1000 }], 'tickets del 12/10');
  const redondeo = await page.evaluate(() => window.EVE_CXP.agruparPagosPorDiaCxP([{ id: 'x', ticket: '1', material: 'M', abonos: [{ monto: 0.1, fecha: '2026-10-01' }, { monto: 0.2, fecha: '2026-10-01' }] }])[0].total);
  igual(redondeo, 0.3, 'suma exacta en centavos');
});

caso('fechaUltimoAbonoCxP devuelve el abono más reciente, aunque no sea el último de la lista', async (browser) => {
  const page = await nuevaPagina(browser, CUENTAS);
  igual(await page.evaluate(() => window.EVE_CXP.fechaUltimoAbonoCxP({ abonos: [{ fecha: '2026-10-12' }, { fecha: '2026-10-05' }] })), '2026-10-12', 'máxima');
  igual(await page.evaluate(() => window.EVE_CXP.fechaUltimoAbonoCxP({ abonos: [] })), '', 'sin abonos');
});

caso('"Pagos por día" aparece en el bloque del proveedor, cerrado, con los días ordenados y el detalle oculto hasta expandir', async (browser) => {
  const page = await nuevaPagina(browser, CUENTAS);
  igual(await page.textContent('details.cxp-pagos-por-dia summary'), 'Pagos por día (2)', 'resumen');
  igual(await page.$eval('details.cxp-pagos-por-dia', (d) => d.open), false, 'cerrado por defecto');
  await page.click('details.cxp-pagos-por-dia summary');
  const filas = await page.$$eval('details.cxp-pagos-por-dia > table > tbody > tr', (f) => f.filter((r) => r.cells.length > 1).map((r) => Array.from(r.cells).slice(0, 3).map((c) => c.textContent.trim())));
  igual(filas, [['12/10/2026', '$1,600.00', '2'], ['05/10/2026', '$430.00', '2']], 'días');
  afirmar(!(await page.isVisible('details.cxp-pagos-por-dia table table')), 'el detalle del día está oculto');
  await page.locator('details.cxp-pagos-por-dia button', { hasText: 'Ver tickets' }).first().click();
  const tickets = await page.$$eval('details.cxp-pagos-por-dia table table tbody tr', (f) => f.filter((r) => r.offsetParent !== null).map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  igual(tickets, [['101', 'PET', '$600.00'], ['102', 'HDPE', '$1,000.00']], 'tickets del día expandido');
});

caso("columna 'Pagado el': fecha del último abono en liquidadas; vacía en las demás", async (browser) => {
  const page = await nuevaPagina(browser, CUENTAS);
  await page.click('text=Ver liquidados');
  const pagadoEl = await page.evaluate(() => {
    const encabezados = Array.from(document.getElementById('cxp-tabla-cuentas-ALFA').closest('table').tHead.rows[0].cells);
    const indice = encabezados.findIndex((t) => t.textContent === 'Pagado el');
    const filas = Array.from(document.querySelectorAll('#cxp-tabla-cuentas-ALFA > tr')).filter((f) => f.cells.length > 5);
    if (indice < 0) return { indice, enc: encabezados.map((t) => t.textContent) };
    return { indice, filas: filas.map((f) => [f.cells[1].textContent, f.cells[indice].textContent]) };
  });
  afirmar(pagadoEl.indice > 0, `falta el encabezado 'Pagado el': ${JSON.stringify(pagadoEl.enc)}`);
  const mapa = Object.fromEntries(pagadoEl.filas);
  igual(mapa['101'], '12/10/2026', 'liquidada 101 (último abono)');
  igual(mapa['102'], '12/10/2026', 'liquidada 102');
  igual(mapa['103'], '', 'parcial sin fecha');
  igual(mapa['104'], '', 'pendiente sin fecha');
});

caso('los botones existentes siguen (Ver (n), Revertir) y el desglose de abonos ocupa todo el ancho', async (browser) => {
  const page = await nuevaPagina(browser, CUENTAS);
  await page.click('text=Ver liquidados');
  await page.locator('#cxp-tabla-cuentas-ALFA button', { hasText: 'Ver (2)' }).click();
  afirmar(await page.$('#cxp-tabla-cuentas-ALFA button:text("Revertir")'), "falta 'Revertir'");
  const columnas = await page.$$eval('#cxp-tabla-cuentas-ALFA', (t) => t[0].closest('table').tHead.rows[0].cells.length);
  const colSpan = await page.$eval('#cxp-tabla-cuentas-ALFA td[colspan]', (c) => c.colSpan);
  igual(colSpan, columnas, 'colSpan = columnas de la tabla');
});

caso('sin lecturas a Firestore', async (browser) => {
  const page = await nuevaPagina(browser, CUENTAS);
  await page.click('details.cxp-pagos-por-dia summary');
  igual(await page.evaluate(() => window.lecturas), 0, 'lecturas');
});

caso('proveedor sin pagos: "Pagos por día (0)" con aviso', async (browser) => {
  const page = await nuevaPagina(browser, [CUENTAS[3]]);
  igual(await page.textContent('details.cxp-pagos-por-dia summary'), 'Pagos por día (0)', 'resumen');
  afirmar((await page.textContent('details.cxp-pagos-por-dia')).includes('Sin pagos registrados'), 'aviso');
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
