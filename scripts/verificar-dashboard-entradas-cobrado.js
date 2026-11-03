// Dashboard: «Entradas de material vs Salidas» y «Cobrado por Mes y Cliente» (y sin «Exposición Actual» ni «Subproductos»).
//
// Parte 1 (vm, js/ reales): los KG del comparativo coinciden con los totales de los reportes de Entradas de material y de Ventas para el
// mismo periodo (todo el histórico y un mes). Salidas es el monto de TODAS las ventas (KG y PZ): su monto, kg y pz son iguales al TOTAL
// VENTAS, TOTAL KG y TOTAL PZ del reporte de Ventas de cada mes y de cada opción del selector; la diferencia es entradas - salidas, solo
// en pesos (sin kg), y el total de la tabla
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

// «Hoy» fijo para el selector de periodo: 4 de noviembre de 2026. Últimos 6 meses = desde el 1 de junio de 2026; Año en curso = desde el
// 1 de enero de 2026. EXTRAS trae registros fuera de esas ventanas para que cada opción dé un resultado distinto.
const HOY_PRUEBA = '2026-11-04';
const EXTRAS = {
  cuentasPagar: [cxp(11, '2025-12-20', 'PET', 300, 1500), cxp(12, '2026-03-05', 'HDPE', 400, 2000)],
  ventas: [V(21, 'ACME', '2025-12-10', [L('PET', 100, 'KG', 10)]), V(22, 'BETA', '2026-03-15', [L('HDPE', 200, 'KG', 5), L('TAPA', 40, 'PZ', 1)])],
  cuentasCobrar: [{ id: 'x9', cliente: 'DELTA', folio: 'V-2026-021', abonos: [ab(700, '2025-12-05'), ab(300, '2026-03-12')] }]
};

function crearContexto(extras) {
  const x = extras || {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {}, navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosVentas: [], composiciones: [], precios: [], registrosControlProduccion: [],
    cuentasPorPagar: [...CUENTAS_PAGAR, ...(x.cuentasPagar || [])], ventas: [...VENTAS, ...(x.ventas || [])],
    cuentasPorCobrar: [...CUENTAS_COBRAR, ...(x.cuentasCobrar || [])], cobros: [], gastos: [], registrosPagos: []
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const a of ['js/config.js', 'js/utils.js', 'js/reportes.js', 'js/cxc.js', 'js/dashboard.js']) {
    vm.runInContext(leer(a), sandbox, { filename: a });
  }
  sandbox.window.obtenerFechaMexico = () => HOY_PRUEBA;
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
cerca(ev.totales.salidasMonto, ventasTodo.totalVentas, 'salidas $ del comparativo = TOTAL VENTAS del reporte de Ventas');
afirmar(ev.totales.salidasPz === 350, 'las 350 PZ no se suman a los KG');
cerca(ev.totales.salidasKg, 800 + 1500.25 + 600 + 900, 'los kg de salidas son solo los de líneas en KG (las PZ van aparte)');
cerca(ev.totales.salidasMonto, 9960 + 12002 + 4300 + 11250, 'salidas $ incluye las líneas en KG y en PZ (TAPA y ETIQUETA)');
cerca(ev.totales.diferenciaMonto, ev.totales.entradasMonto - ev.totales.salidasMonto, 'diferencia total = entradas - salidas (en pesos)');
afirmar(!('diferenciaKg' in ev.totales) && ev.filas.every((f) => !('diferenciaKg' in f)), 'la diferencia no trae kg');
cerca(ev.filas.reduce((s, f) => s + f.diferenciaMonto, 0), ev.totales.diferenciaMonto, 'la suma de las diferencias mensuales = diferencia total');
afirmar(JSON.stringify(ev.filas.map((f) => f.mes)) === JSON.stringify(['2026-09', '2026-10', '2026-11']), 'meses ordenados');

// Cada mes contra los reportes del mismo mes
[['2026-09', '2026-09-01', '2026-09-30'], ['2026-10', '2026-10-01', '2026-10-31'], ['2026-11', '2026-11-01', '2026-11-30']].forEach(([mes, desde, hasta]) => {
  const fila = ev.filas.find((f) => f.mes === mes);
  const entradas = w.resumirEntradasMaterial(w.filtrarEntradasMaterial(CUENTAS_PAGAR, { desde, hasta })).totalKg;
  const repVentas = w.construirReporteVentas(w.obtenerVentasReporte(desde, hasta, {}));
  cerca(fila.entradasKg, entradas, `${mes}: entradas = reporte de Entradas del mes`);
  cerca(fila.salidasKg, repVentas.totalKg, `${mes}: salidas kg = TOTAL KG del reporte de Ventas del mes`);
  cerca(fila.salidasPz, repVentas.totalPz, `${mes}: salidas pz = TOTAL PZ del reporte de Ventas del mes`);
  cerca(fila.salidasMonto, repVentas.totalVentas, `${mes}: salidas $ = TOTAL VENTAS del reporte de Ventas del mes`);
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

// ── Parte 1b: montos, KG y selector de periodo ──
const wp = crearContexto(EXTRAS);
const Dp = wp.EVE_DASHBOARD;
afirmar(JSON.stringify(Dp.PERIODOS_DASHBOARD.map((p) => p.nombre)) === JSON.stringify(['Últimos 6 meses', 'Año en curso', 'Todo']) && Dp.PERIODO_DASHBOARD_POR_DEFECTO === 'anio', 'selector: opciones y valor por defecto (Año en curso)');
afirmar(Dp.obtenerRangoPeriodoDashboard('6meses').desde === '2026-06-01' && Dp.obtenerRangoPeriodoDashboard('anio').desde === '2026-01-01' && Dp.obtenerRangoPeriodoDashboard('todo').desde === '', 'rangos de cada opción con «hoy» = 2026-11-04');
afirmar(wp.obtenerFechaMexico() === HOY_PRUEBA, 'fecha simulada');

// Esperado por opción. salidasMonto = TOTAL VENTAS (KG y PZ): V-1 9,960 + V-2 12,002 + V-3 4,300 + V-4 11,250 + V-21 1,000 + V-22 1,040
const PERIODOS = {
  todo: { desde: '', entradasKg: 1000 + 500.5 + 2000 + 750 + 1200 + 300 + 400, entradasMonto: 5000 + 2500 + 9000 + 3000 + 6000 + 1500 + 2000, salidasKg: 800 + 1500.25 + 600 + 900 + 100 + 200, salidasMonto: 9960 + 12002 + 4300 + 11250 + 1000 + 1040, pz: 350 + 40 },
  anio: { desde: '2026-01-01', entradasKg: 1000 + 500.5 + 2000 + 750 + 1200 + 400, entradasMonto: 5000 + 2500 + 9000 + 3000 + 6000 + 2000, salidasKg: 800 + 1500.25 + 600 + 900 + 200, salidasMonto: 9960 + 12002 + 4300 + 11250 + 1040, pz: 350 + 40 },
  '6meses': { desde: '2026-06-01', entradasKg: 1000 + 500.5 + 2000 + 750 + 1200, entradasMonto: 5000 + 2500 + 9000 + 3000 + 6000, salidasKg: 800 + 1500.25 + 600 + 900, salidasMonto: 9960 + 12002 + 4300 + 11250, pz: 350 }
};
Object.entries(PERIODOS).forEach(([id, e]) => {
  const v = Dp.calcularVistaEntradasVsSalidas(id);
  const t = v.totales;
  cerca(t.entradasKg, e.entradasKg, `${id}: entradas kg`);
  cerca(t.entradasMonto, e.entradasMonto, `${id}: entradas $ (costo de los tickets con CxP)`);
  cerca(t.salidasKg, e.salidasKg, `${id}: salidas kg (solo líneas en KG)`);
  cerca(t.salidasMonto, e.salidasMonto, `${id}: salidas $ (todas las ventas, KG y PZ)`);
  cerca(t.salidasPz, e.pz, `${id}: salidas pz aparte`);
  cerca(t.diferenciaMonto, e.entradasMonto - e.salidasMonto, `${id}: diferencia $ = entradas - salidas`);
  afirmar(!('diferenciaKg' in t), `${id}: la diferencia solo se da en pesos`);
  // La suma de los meses es el total
  ['entradasMonto', 'salidasMonto', 'diferenciaMonto', 'entradasKg', 'salidasKg', 'salidasPz'].forEach((c) => cerca(v.filas.reduce((s, f) => s + f[c], 0), t[c], `${id}: suma de los meses de ${c} = total`));
  // Mismos números que los reportes del mismo periodo
  const entradasRep = wp.resumirEntradasMaterial(wp.filtrarEntradasMaterial(wp.EVE.cuentasPorPagar, { desde: e.desde, hasta: '' }));
  const ventasRep = wp.obtenerVentasReporte(e.desde, '', {});
  cerca(t.entradasKg, entradasRep.totalKg, `${id}: entradas kg = TOTAL KG del reporte de Entradas`);
  cerca(t.entradasMonto, entradasRep.totalCosto, `${id}: entradas $ = TOTAL COSTO del reporte de Entradas`);
  const repVentas = wp.construirReporteVentas(ventasRep);
  cerca(t.salidasKg, repVentas.totalKg, `${id}: salidas kg = TOTAL KG del reporte de Ventas`);
  cerca(t.salidasPz, repVentas.totalPz, `${id}: salidas pz = TOTAL PZ del reporte de Ventas`);
  cerca(t.salidasMonto, repVentas.totalVentas, `${id}: salidas $ = TOTAL VENTAS del reporte de Ventas`);
  // Cada mes de la tabla contra el reporte de Ventas de ese mes
  v.filas.forEach((f) => {
    const [anio, mm] = f.mes.split('-').map(Number);
    const rep = wp.construirReporteVentas(wp.obtenerVentasReporte(f.mes + '-01', f.mes + '-' + String(new Date(anio, mm, 0).getDate()), {}));
    cerca(f.salidasMonto, rep.totalVentas, `${id}: ${f.mes} salidas $ = TOTAL VENTAS del reporte del mes`);
    cerca(f.salidasKg, rep.totalKg, `${id}: ${f.mes} salidas kg = TOTAL KG del reporte del mes`);
    cerca(f.salidasPz, rep.totalPz, `${id}: ${f.mes} salidas pz = TOTAL PZ del reporte del mes`);
  });
  afirmar(v.filas.every((f) => f.mes >= e.desde.slice(0, 7)), `${id}: ningún mes antes del periodo`);
});
afirmar(Dp.calcularVistaEntradasVsSalidas('anio').filas.length < Dp.calcularVistaEntradasVsSalidas('todo').filas.length, 'Año en curso deja fuera los meses de 2025');
afirmar(Dp.calcularVistaEntradasVsSalidas('6meses').filas.every((f) => f.mes >= '2026-06'), 'Últimos 6 meses: desde junio de 2026');

// Cobrado por periodo: total de la tabla = abonos del periodo; totales por fila y por columna dentro del periodo
const ABONOS_BASE = 3000 + 1000 + 2000.5 + 4000 + 500.25;
const COBRADO = { todo: ABONOS_BASE + 700 + 300, anio: ABONOS_BASE + 300, '6meses': ABONOS_BASE };
Object.entries(COBRADO).forEach(([id, esperado]) => {
  const c = Dp.calcularVistaCobradoPorMesCliente(id);
  const desde = PERIODOS[id].desde;
  const abonosPeriodo = wp.EVE.cuentasPorCobrar.reduce((s, cu) => s + cu.abonos.filter((a) => !a.revertido && (!desde || a.fecha >= desde)).reduce((t, a) => t + a.monto, 0), 0);
  cerca(abonosPeriodo, esperado, `${id}: abonos del periodo (referencia)`);
  cerca(c.totales._total, abonosPeriodo, `${id}: total de la tabla = suma de abonos del periodo`);
  cerca(c.filas.reduce((s, f) => s + f._total, 0), abonosPeriodo, `${id}: suma de totales por cliente`);
  cerca(c.meses.reduce((s, m) => s + c.totales[m], 0), abonosPeriodo, `${id}: suma de totales por mes`);
  c.filas.forEach((f) => cerca(c.meses.reduce((s, m) => s + f[m], 0), f._total, `${id}: ${f.clave}: total de la fila = suma de sus meses`));
  afirmar(c.meses.every((m) => m >= desde.slice(0, 7)), `${id}: ningún mes antes del periodo`);
});
afirmar(Dp.calcularVistaCobradoPorMesCliente('todo').filas.some((f) => f.clave === 'DELTA'), 'todo: DELTA con sus abonos de 2025 y 2026');
const deltaAnio = Dp.calcularVistaCobradoPorMesCliente('anio').filas.find((f) => f.clave === 'DELTA');
afirmar(deltaAnio && deltaAnio._total === 300, 'Año en curso: DELTA solo con el abono de marzo');
afirmar(!Dp.calcularVistaCobradoPorMesCliente('6meses').filas.some((f) => f.clave === 'DELTA'), 'Últimos 6 meses: DELTA ya no aparece');

// ── Parte 2: navegador ──
async function montar(browser, permisos, extras) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/reportes.js', 'js/cxc.js', 'js/dashboard.js']) await page.addScriptTag({ path: path.join(RAIZ, s) });
  const x = extras || {};
  await page.evaluate(({ cuentasPagar, ventas, cuentasCobrar, perm, hoy }) => {
    window.obtenerFechaMexico = () => hoy;
    window.puedeLeer = (m) => perm.leer.includes(m);
    window.tienePermisoExtra = (c) => perm.extra.includes(c);
    window.EVE = {
      currentUser: { username: 'prueba' }, registrosDestaraje: [], registrosVentas: [], composiciones: [], precios: [], registrosControlProduccion: [],
      cuentasPorPagar: cuentasPagar, ventas, cuentasPorCobrar: cuentasCobrar, cobros: [], gastos: [], registrosPagos: []
    };
    window.EVE_MODULES.dashboard.render(document.getElementById('main-content'));
  }, {
    cuentasPagar: [...CUENTAS_PAGAR, ...(x.cuentasPagar || [])], ventas: [...VENTAS, ...(x.ventas || [])],
    cuentasCobrar: [...CUENTAS_COBRAR, ...(x.cuentasCobrar || [])], perm: permisos, hoy: HOY_PRUEBA
  });
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
    afirmar(/Total del periodo/.test(textoEvs) && textoEvs.includes('Salidas: monto de todas las ventas (kg y piezas). Entradas: costo de tickets con cuenta por pagar generada.'), 'comparativo: totales y nota nueva');
    const filasEvs = await completo.$$eval('#main-content table:not([style*="display: none"])', (ts) => ts.map((t) => t.innerText));
    afirmar(textoEvs.includes('2026-09') && textoEvs.includes('TOTAL'), 'comparativo: filas por mes y TOTAL');

    await completo.locator('.destaraje-subtabs .tab', { hasText: 'Cobrado por Mes y Cliente' }).click();
    const textoCob = await completo.$eval('#main-content', (e) => e.innerText);
    afirmar(/ACME/.test(textoCob) && /BETA/.test(textoCob) && /TOTAL/.test(textoCob) && /Total cobrado/.test(textoCob), 'cobrado: clientes, total por fila y fila TOTAL');
    afirmar(completo.erroresPagina.length === 0, 'sin errores de JavaScript: ' + completo.erroresPagina.join(' / '));

    // ── Título, formato de celdas y selector de periodo (con registros dentro y fuera de cada ventana) ──
    const dash = await montar(browser, { leer: ['ventas', 'cxc'], extra: ['cxp_reportes'] }, EXTRAS);
    afirmar((await dash.$eval('#main-content h3', (h) => h.textContent)) === 'Dashboard: Entradas, Ventas y Cobranza', 'título del Dashboard');
    afirmar(!(await dash.$eval('#main-content', (e) => e.textContent)).includes('Exposición Financiera'), 'ya no dice «Exposición Financiera y Producción»');
    const selector = dash.locator('#dashboard-periodo-select');
    afirmar((await selector.inputValue()) === 'anio', 'el periodo por defecto es Año en curso');
    afirmar(JSON.stringify(await dash.$$eval('#dashboard-periodo-select option', (os) => os.map((o) => o.textContent))) === JSON.stringify(['Últimos 6 meses', 'Año en curso', 'Todo']), 'opciones del selector');
    afirmar(await dash.$eval('#dashboard-periodo', (b) => b.style.display) === 'none', 'el selector no se muestra en las vistas a las que no aplica');

    const celdasTotal = async () => dash.$$eval('#main-content table', (ts) => {
      const t = ts.find((x) => x.offsetParent !== null && /Diferencia/.test(x.innerText));
      if (!t) return null;
      const fila = Array.from(t.querySelectorAll('tbody tr')).find((r) => r.cells[0].textContent === 'TOTAL');
      return fila ? Array.from(fila.cells).map((c) => c.textContent) : null;
    });
    const formato = (monto, kg) => dash.evaluate(({ m, k }) => `${window.formatearMoneda(m)} (${k.toLocaleString('es-MX', { maximumFractionDigits: 2 })} kg)`, { m: monto, k: kg });
    const formatoSalidas = (monto, kg, pz) => dash.evaluate(({ m, k, z }) => `${window.formatearMoneda(m)} (${k.toLocaleString('es-MX', { maximumFractionDigits: 2 })} kg · ${z.toLocaleString('es-MX')} pz)`, { m: monto, k: kg, z: pz });
    const moneda = (monto) => dash.evaluate((m) => window.formatearMoneda(m), monto);
    await dash.locator('.destaraje-subtabs .tab', { hasText: 'Entradas de material vs Salidas' }).click();
    afirmar(await dash.$eval('#dashboard-periodo', (b) => b.style.display) === '', 'el selector aparece en Entradas vs Salidas');
    for (const [id, nombre] of [['6meses', 'Últimos 6 meses'], ['anio', 'Año en curso'], ['todo', 'Todo']]) {
      await selector.selectOption(id);
      const e = PERIODOS[id];
      const fila = await celdasTotal();
      afirmar(fila && fila.length === 4, `${nombre}: fila TOTAL con 4 celdas`);
      afirmar(fila[1] === await formato(e.entradasMonto, e.entradasKg), `${nombre}: Entradas «${fila && fila[1]}»`);
      afirmar(fila[2] === await formatoSalidas(e.salidasMonto, e.salidasKg, e.pz), `${nombre}: Salidas «${fila && fila[2]}»`);
      afirmar(fila[3] === await moneda(e.entradasMonto - e.salidasMonto), `${nombre}: Diferencia solo en pesos «${fila && fila[3]}»`);
      const texto = await dash.$eval('#main-content', (el) => el.innerText);
      afirmar(texto.includes(`Entradas: ${await formato(e.entradasMonto, e.entradasKg)}`) && texto.includes(`Salidas: ${await formatoSalidas(e.salidasMonto, e.salidasKg, e.pz)}`) && texto.includes(`Diferencia: ${await moneda(e.entradasMonto - e.salidasMonto)}`), `${nombre}: resumen «Total del periodo» con pesos, kg y pz`);
      afirmar(/\$[\d,]+\.\d{2} \([\d,.]+ kg\)/.test(fila[1]), `${nombre}: Entradas con formato «$123,456.00 (12,345 kg)»`);
      afirmar(/^\$[\d,]+\.\d{2} \([\d,.]+ kg · [\d,]+ pz\)$/.test(fila[2]), `${nombre}: Salidas con formato «$4,126,186.20 (287,560.6 kg · 6,919 pz)»`);
      afirmar(!/kg|pz/.test(fila[3]) && /^-?\$[\d,]+\.\d{2}$/.test(fila[3]), `${nombre}: la diferencia no lleva kg ni pz`);
      afirmar(!/no se incluyen/.test(texto) && texto.includes('Salidas: monto de todas las ventas (kg y piezas). Entradas: costo de tickets con cuenta por pagar generada.') && !/utilidad|margen/i.test(texto), `${nombre}: nota nueva y sin rótulo de utilidad ni margen`);
    }
    // Una celda mensual con el mismo formato (septiembre de 2026, entradas 1500.5 kg y $7,500.00)
    const celdaSep = await dash.$$eval('#main-content table', (ts) => {
      const t = ts.find((x) => x.offsetParent !== null && /Diferencia/.test(x.innerText));
      const fila = Array.from(t.querySelectorAll('tbody tr')).find((r) => r.cells[0].textContent === '2026-09');
      return fila ? fila.cells[1].textContent : null;
    });
    afirmar(celdaSep === await formato(7500, 1500.5), `celda mensual de Entradas: «${celdaSep}»`);

    // Cobrado por mes y cliente con el selector
    await dash.locator('.destaraje-subtabs .tab', { hasText: 'Cobrado por Mes y Cliente' }).click();
    afirmar(await dash.$eval('#dashboard-periodo', (b) => b.style.display) === '', 'el selector aparece en Cobrado');
    const totalCobrado = () => dash.$$eval('#main-content table', (ts) => {
      const t = ts.find((x) => x.offsetParent !== null && /Total cobrado/.test(x.innerText));
      const fila = Array.from(t.querySelectorAll('tbody tr')).find((r) => r.cells[0].textContent === 'TOTAL');
      return { total: fila.cells[fila.cells.length - 1].textContent, clientes: Array.from(t.querySelectorAll('tbody tr')).map((r) => r.cells[0].textContent) };
    });
    for (const [id, nombre] of [['6meses', 'Últimos 6 meses'], ['anio', 'Año en curso'], ['todo', 'Todo']]) {
      await selector.selectOption(id);
      const r = await totalCobrado();
      const monedaEsperada = await dash.evaluate((m) => window.formatearMoneda(m), COBRADO[id]);
      afirmar(r.total === monedaEsperada, `${nombre}: total cobrado ${r.total} = ${monedaEsperada}`);
      afirmar(r.clientes.includes('DELTA') === (id !== '6meses'), `${nombre}: DELTA ${id === '6meses' ? 'no aparece' : 'aparece'}`);
    }
    afirmar(await selector.inputValue() === 'todo', 'el selector conserva la opción elegida al cambiar de vista');
    await dash.locator('.destaraje-subtabs .tab', { hasText: 'KG por Mes y Material' }).click();
    afirmar(await dash.$eval('#dashboard-periodo', (b) => b.style.display) === 'none', 'el selector se oculta en las demás vistas');
    afirmar(dash.erroresPagina.length === 0, 'sin errores de JavaScript con el selector: ' + dash.erroresPagina.join(' / '));

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
