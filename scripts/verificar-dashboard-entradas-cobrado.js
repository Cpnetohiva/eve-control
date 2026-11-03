// Dashboard: «Entradas de material vs Salidas» y «Cobrado por Mes y Cliente» (y sin «Exposición Actual» ni «Subproductos»).
//
// Parte 1 (vm, js/ reales): los KG del comparativo coinciden con los totales de los reportes de Entradas de material y de Ventas para el
// mismo periodo (todo el histórico y un mes), las ventas en PZ no entran, la diferencia es entradas - salidas, y el total de la tabla
// de cobrado es igual a la suma de los abonos (sin revertidos), por fila, por columna y general.
// Parte 2 (navegador, Playwright): las sub-pestañas, el render de las dos vistas, los permisos y que ya no existan las secciones quitadas.
//
// Uso: node scripts/verificar-dashboard-entradas-cobrado.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const cerca = (a, b, m) => afirmar(Math.abs(a - b) < 0.005, `${m}: esperado ${b}, obtenido ${a}`);

// ── Datos ──
const cxp = (n, fecha, material, kg, monto) => ({ id: 'c' + n, ticket: 'T' + n, proveedor: 'PROV', fechaTicket: fecha, material, kg, montoMaterial: monto, montoComision: 0 });
const CUENTAS_PAGAR = [
  cxp(1, '2026-09-10', 'PET', 1000, 5000), cxp(2, '2026-09-25', 'PET', 500.5, 2500), cxp(3, '2026-10-02', 'HDPE', 2000, 9000),
  cxp(4, '2026-10-15', 'PP', 750, 3000), cxp(5, '2026-11-01', 'PET', 1200, 6000)
];
const L = (material, cantidad, unidad, precioUnitario) => {
  const t = Math.round(cantidad * precioUnitario * 100) / 100;
  return { material, cantidad, unidad, precioUnitario, subtotal: t, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: t };
};
const V = (n, cliente, fecha, lineas) => ({ id: 'v' + n, folio: 'V-2026-' + String(n).padStart(3, '0'), cliente, fecha, lineas, totalVenta: Math.round(lineas.reduce((s, l) => s + l.totalLinea, 0) * 100) / 100 });
const VENTAS = [
  V(1, 'ACME', '2026-09-12', [L('PET', 800, 'KG', 12), L('TAPA', 300, 'PZ', 1.2)]),
  V(2, 'BETA', '2026-10-03', [L('HDPE', 1500.25, 'KG', 8)]),
  V(3, 'ACME', '2026-10-20', [L('PP', 600, 'KG', 7), L('ETIQUETA', 50, 'PZ', 2)]),
  V(4, 'GAMA', '2026-11-02', [L('PET', 900, 'KG', 12.5)])
];
const ab = (monto, fecha, extra) => ({ abonoId: 'a' + Math.random(), monto, fecha, ...(extra || {}) });
const CUENTAS_COBRAR = [
  { id: 'x1', cliente: 'ACME', folio: 'V-2026-001', abonos: [ab(3000, '2026-09-20'), ab(1000, '2026-10-05'), ab(999, '2026-10-06', { revertido: true })] },
  { id: 'x2', cliente: 'ACME', folio: 'V-2026-003', abonos: [ab(2000.5, '2026-10-25')] },
  { id: 'x3', cliente: 'BETA', folio: 'V-2026-002', abonos: [ab(4000, '2026-10-10'), ab(500.25, '2026-11-03')] },
  { id: 'x4', cliente: 'GAMA', folio: 'V-2026-004', abonos: [] }
];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {}, navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosVentas: [], composiciones: [], precios: [], registrosControlProduccion: [],
    cuentasPorPagar: CUENTAS_PAGAR, ventas: VENTAS, cuentasPorCobrar: CUENTAS_COBRAR, cobros: [], gastos: [], registrosPagos: []
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const a of ['js/config.js', 'js/utils.js', 'js/reportes.js', 'js/cxc.js', 'js/dashboard.js']) {
    vm.runInContext(leer(a), sandbox, { filename: a });
  }
  return sandbox.window;
}

// ── Parte 1: números ──
const w = crearContexto();
const D = w.EVE_DASHBOARD;
const ev = D.calcularVistaEntradasVsSalidas();

// Reporte de Entradas de material, todo el histórico
const entradasTodo = w.resumirEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS_PAGAR, { desde: '', hasta: '' }));
cerca(ev.totales.entradasKg, entradasTodo.totalKg, 'entradas del comparativo = TOTAL KG del reporte de Entradas');
// Reporte de Ventas, todo el histórico
const ventasTodo = w.construirReporteVentas(w.obtenerVentasReporte('', '', {}));
cerca(ev.totales.salidasKg, ventasTodo.totalKg, 'salidas del comparativo = TOTAL KG del reporte de Ventas');
cerca(ev.totales.salidasPz, ventasTodo.totalPz, 'PZ vendidas informadas aparte = TOTAL PZ del reporte de Ventas');
afirmar(ev.totales.salidasPz === 350, 'las 350 PZ no se suman a los KG');
cerca(ev.totales.salidasKg, 800 + 1500.25 + 600 + 900, 'salidas = solo líneas en KG');
cerca(ev.totales.diferenciaKg, ev.totales.entradasKg - ev.totales.salidasKg, 'diferencia total = entradas - salidas');
cerca(ev.filas.reduce((s, f) => s + f.diferenciaKg, 0), ev.totales.diferenciaKg, 'la suma de las diferencias mensuales = diferencia total');
afirmar(JSON.stringify(ev.filas.map((f) => f.mes)) === JSON.stringify(['2026-09', '2026-10', '2026-11']), 'meses ordenados');

// Cada mes contra los reportes del mismo mes
[['2026-09', '2026-09-01', '2026-09-30'], ['2026-10', '2026-10-01', '2026-10-31'], ['2026-11', '2026-11-01', '2026-11-30']].forEach(([mes, desde, hasta]) => {
  const fila = ev.filas.find((f) => f.mes === mes);
  const entradas = w.resumirEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS_PAGAR, { desde, hasta })).totalKg;
  const salidas = w.construirReporteVentas(w.obtenerVentasReporte(desde, hasta, {})).totalKg;
  cerca(fila.entradasKg, entradas, `${mes}: entradas = reporte de Entradas del mes`);
  cerca(fila.salidasKg, salidas, `${mes}: salidas = reporte de Ventas del mes`);
});

// Cobrado por mes y cliente
const cob = D.calcularVistaCobradoPorMesCliente();
const sumaAbonos = CUENTAS_COBRAR.reduce((s, c) => s + c.abonos.filter((a) => !a.revertido).reduce((t, a) => t + a.monto, 0), 0);
cerca(sumaAbonos, 3000 + 1000 + 2000.5 + 4000 + 500.25, 'suma de abonos de referencia (sin el revertido)');
cerca(cob.totales._total, sumaAbonos, 'total de la tabla de cobrado = suma de abonos');
cerca(cob.filas.reduce((s, f) => s + f._total, 0), sumaAbonos, 'suma de totales por cliente = suma de abonos');
cerca(cob.meses.reduce((s, m) => s + cob.totales[m], 0), sumaAbonos, 'suma de totales por mes = suma de abonos');
afirmar(JSON.stringify(cob.meses) === JSON.stringify(['2026-09', '2026-10', '2026-11']), 'meses de cobro por fecha del abono');
afirmar(JSON.stringify(cob.filas.map((f) => f.clave)) === JSON.stringify(['ACME', 'BETA']), 'clientes con cobros (GAMA no tiene abonos)');
cerca(cob.filas.find((f) => f.clave === 'ACME')['2026-10'], 1000 + 2000.5, 'ACME en octubre: sin el abono revertido');
cerca(cob.filas.find((f) => f.clave === 'BETA')['2026-11'], 500.25, 'BETA en noviembre');
cerca(cob.totales['2026-10'], 1000 + 2000.5 + 4000, 'total de la columna de octubre');
// Por fecha de cobro, no por fecha de venta: la venta V-2026-001 es de septiembre y su abono de octubre cae en octubre
cerca(cob.filas.find((f) => f.clave === 'ACME')['2026-09'], 3000, 'ACME en septiembre');
// Sin cambios en los datos
afirmar(JSON.stringify(CUENTAS_COBRAR).includes('"revertido":true'), 'los abonos revertidos siguen en memoria (no se borran)');

// ── Parte 2: navegador ──
async function montar(browser, permisos) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/reportes.js', 'js/cxc.js', 'js/dashboard.js']) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cuentasPagar, ventas, cuentasCobrar, perm }) => {
    window.puedeLeer = (m) => perm.leer.includes(m);
    window.tienePermisoExtra = (c) => perm.extra.includes(c);
    window.EVE = {
      currentUser: { username: 'prueba' }, registrosDestaraje: [], registrosVentas: [], composiciones: [], precios: [], registrosControlProduccion: [],
      cuentasPorPagar: cuentasPagar, ventas, cuentasPorCobrar: cuentasCobrar, cobros: [], gastos: [], registrosPagos: []
    };
    window.EVE_MODULES.dashboard.render(document.getElementById('main-content'));
  }, { cuentasPagar: CUENTAS_PAGAR, ventas: VENTAS, cuentasCobrar: CUENTAS_COBRAR, perm: permisos });
  page.erroresPagina = errores;
  return page;
}
const textoTabs = (page) => page.$$eval('.destaraje-subtabs .tab', (bs) => bs.map((b) => b.textContent.trim()));

(async () => {
  const browser = await chromium.launch();
  try {
    const completo = await montar(browser, { leer: ['ventas', 'cxc'], extra: ['cxp_reportes'] });
    const tabs = await textoTabs(completo);
    afirmar(JSON.stringify(tabs) === JSON.stringify(['KG por Mes y Material', '$ por Mes y Material', 'Pagado por Mes y Proveedor', 'Entradas de material vs Salidas', 'Cobrado por Mes y Cliente']), 'sub-pestañas: ' + tabs.join(' | '));
    afirmar(!tabs.some((t) => /Exposici|Subproductos/.test(t)), 'ya no están Exposición Actual ni Subproductos');

    await completo.locator('.destaraje-subtabs .tab', { hasText: 'Entradas de material vs Salidas' }).click();
    const textoEvs = await completo.$eval('#main-content', (e) => e.innerText);
    afirmar(/Total del periodo/.test(textoEvs) && /no se incluyen/.test(textoEvs) && /350 PZ/.test(textoEvs), 'comparativo: totales y nota de PZ');
    const filasEvs = await completo.$$eval('#main-content table:not([style*="display: none"])', (ts) => ts.map((t) => t.innerText));
    afirmar(textoEvs.includes('2026-09') && textoEvs.includes('TOTAL'), 'comparativo: filas por mes y TOTAL');

    await completo.locator('.destaraje-subtabs .tab', { hasText: 'Cobrado por Mes y Cliente' }).click();
    const textoCob = await completo.$eval('#main-content', (e) => e.innerText);
    afirmar(/ACME/.test(textoCob) && /BETA/.test(textoCob) && /TOTAL/.test(textoCob) && /Total cobrado/.test(textoCob), 'cobrado: clientes, total por fila y fila TOTAL');
    afirmar(completo.erroresPagina.length === 0, 'sin errores de JavaScript: ' + completo.erroresPagina.join(' / '));

    // Permisos: sin lectura de CxC no aparece el cobrado; sin cxp_reportes no aparece el comparativo
    const sinCxc = await textoTabs(await montar(browser, { leer: ['ventas'], extra: ['cxp_reportes'] }));
    afirmar(!sinCxc.includes('Cobrado por Mes y Cliente') && sinCxc.includes('Entradas de material vs Salidas'), 'sin permiso de CxC se oculta el cobrado');
    const sinExtra = await textoTabs(await montar(browser, { leer: ['ventas', 'cxc'], extra: [] }));
    afirmar(!sinExtra.includes('Entradas de material vs Salidas') && sinExtra.includes('Cobrado por Mes y Cliente'), 'sin cxp_reportes se oculta el comparativo');
    const sinVentas = await textoTabs(await montar(browser, { leer: ['cxc'], extra: ['cxp_reportes'] }));
    afirmar(!sinVentas.includes('Entradas de material vs Salidas'), 'sin lectura de Ventas se oculta el comparativo');
  } finally {
    await browser.close();
  }

  // Código quitado
  const d = leer('js/dashboard.js');
  ['renderizarTablaExposicionActual', 'agregarCxPPorProveedorYMaterial', 'calcularVistaSubproductosRealVsTeorico', 'renderizarTablaSubproductosRealVsTeorico',
    'construirBloqueSubproductosMaterial', 'construirMatricesDiferencia', 'calcularDiferenciaPorcentual', "'exposicion-actual'", "'subproductos-real-teorico'"]
    .forEach((t) => afirmar(!d.includes(t), `dashboard.js ya no contiene ${t}`));
  afirmar(d.includes('function agruparPorMesY') && d.includes('function construirMatrizMesClave') && d.includes('calcularMaterialesSinPrecioVigente'), 'los agregadores compartidos y la alerta de precios siguen');
  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + e.message); process.exitCode = 1; });
