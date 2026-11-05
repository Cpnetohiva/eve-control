// Doble conteo en Compras > Pagos: cada abono a una cuenta por pagar genera un registro en `pagos` con los kg y el total COMPLETOS del
// ticket, y los totales sumaban registro por registro. Ahora los abonos NO revertidos se agrupan por ticket + proveedor + material
// (agruparPagosPorTicket / calcularResumenPagos en js/reportes.js; calcularStats en js/pagos.js).
//
// Parte 1 (vm, js/ reales): el ticket de 770 kg y $6,006 pagado en 2000 y 4006 da 1 registro, 770 kg, pagado $6,006 y deuda $0; un
//   ticket pagado parcialmente conserva su deuda; el mismo ticket con dos materiales cuenta dos grupos; un abono revertido no cuenta;
//   los anticipos y los pagos sin ticket se cuentan uno por uno; con kg distintos entre abonos gana el más reciente (en cualquier orden);
//   la cuenta por pagar del ticket tiene prioridad; los datos no se modifican.
// Parte 2 (Chromium, Playwright): la pantalla de Pagos (Registros, Total KG, Total Pagado; ya sin Total Deuda), el TXT y el PDF de pagos
//   dan los mismos totales; las filas de detalle (pantalla, TXT, PDF y CSV) siguen mostrando cada abono.
// Parte 2b (Chromium): Total Pagado y Deuda por periodo. Total Pagado de cualquier vista (pantalla, TXT, PDF, reporte general, vista para captura,
//   desglose por proveedor) es SOLO la suma del pagado de los abonos que están dentro de la vista; la Deuda de un ticket usa TODOS sus
//   abonos no revertidos. Ticket de $3,000 con anticipo de $1,000 el 28/10 y liquidación de $2,000 el 04/11: la vista Hoy (04/11) da
//   1 registro, 500 kg, Total $3,000, Pagado $2,000 y Deuda $0; Todos da Pagado $3,000 y Deuda $0; la del 28/10 da Pagado $1,000 y Deuda $0.
//   También: pestañas Hoy, Esta Semana, Este Mes, Últimos 30 días y Todos, un rango de fechas, TXT y PDF contra la pantalla, el KPI Registros
//   y Total pagado de la vista para captura, y que Flujo de efectivo y el Dashboard (Pagado por Mes y Proveedor) siguen dando el pagado real
//   por fecha de pago (no usan estas funciones).
// Parte 3: scripts/diagnostico-pagos-doble-conteo.js (solo lectura) lista los tickets con varios pagos, descarga el JSON y no escribe.
//
// Uso: node scripts/verificar-pagos-doble-conteo.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8').replace(/\r\n/g, '\n');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

// ── Datos ──
const abono = (id, ticket, proveedor, material, kg, total, pagado, fecha, fechaRegistro, extra) => ({ id, ticket, proveedor, material, kg, precioPorKg: kg ? total / kg : 0, total, pagado, fecha, fechaRegistro, ...(extra || {}) });
const PAGOS = [
  // A. ticket de 770 kg y $6,006 pagado en dos abonos (anticipo aplicado y liquidación)
  abono('a1', '1380', 'JUANA', 'MIXTO', 770, 6006, 2000, '2026-10-20', '2026-10-20T10:00:00.000Z'),
  abono('a2', '1380', 'JUANA', 'MIXTO', 770, 6006, 4006, '2026-11-02', '2026-11-02T10:00:00.000Z'),
  // abono revertido del mismo ticket: no cuenta
  abono('a3', '1380', 'JUANA', 'MIXTO', 770, 6006, 4000, '2026-11-03', '2026-11-03T10:00:00.000Z', { revertido: true }),
  // B. pagado parcialmente con un solo abono
  abono('b1', '2001', 'LUIS', 'PET', 200, 1000, 400, '2026-11-01', '2026-11-01T09:00:00.000Z'),
  // C. mismo ticket con dos materiales distintos: dos grupos
  abono('c1', '5000', 'PEDRO', 'PET', 100, 500, 500, '2026-11-01', '2026-11-01T11:00:00.000Z'),
  abono('c2', '5000', 'PEDRO', 'HDPE', 50, 400, 400, '2026-11-01', '2026-11-01T11:00:01.000Z'),
  // D. kg y total distintos entre abonos: gana el más reciente (770 kg, $6,006)
  abono('d1', '6000', 'ANA', 'PP', 700, 5460, 1000, '2026-10-25', '2026-10-25T09:00:00.000Z'),
  abono('d2', '6000', 'ANA', 'PP', 770, 6006, 2000, '2026-10-30', '2026-10-30T09:00:00.000Z'),
  // F. anticipos sin ticket: uno por uno
  { id: 'n1', ticket: '', proveedor: 'JUANA', material: '', kg: 0, precioPorKg: 0, total: 0, pagado: 800, fecha: '2026-11-03', origen: 'anticipo', fechaRegistro: '2026-11-03T08:00:00.000Z' },
  { id: 'n2', ticket: '', proveedor: 'JUANA', material: '', kg: 0, precioPorKg: 0, total: 0, pagado: 800, fecha: '2026-11-03', origen: 'anticipo', fechaRegistro: '2026-11-03T08:01:00.000Z' }
];
const copia = JSON.stringify(PAGOS);
const ESPERADO = { registros: 5, kg: 1890, pagado: 11906, deuda: 2006 }; // A 1/770/6006/0, B 1/200/400/600, C 2/150/900/0, D 1/770/3000/3006, F (2 anticipos) 0/0/1600/-1600
const ANTIGUO = { registros: 7, kg: 3360, deuda: 13472 }; // lo que daba sumar abono por abono

// ══ Parte 1: funciones (vm) ══
function crearVm(cuentasPorPagar) {
  const sandbox = { console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout, document: {}, navigator: { onLine: true } };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: cuentasPorPagar || [], registrosPagos: [] };
  sandbox.window.EVE_MODULES = {};
  sandbox.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } };
  vm.createContext(sandbox);
  for (const a of ['js/config.js', 'js/utils.js', 'js/reportes.js']) vm.runInContext(leer(a), sandbox, { filename: a });
  const pagos = leer('js/pagos.js');
  const i = pagos.indexOf('function calcularStats(');
  vm.runInContext(pagos.slice(i, pagos.indexOf('\n}\n', i) + 3) + '\nthis.calcularStats = calcularStats;', sandbox);
  return sandbox.window;
}
const w = crearVm();
const resumen = (pagos, ventana) => { const v = ventana || w; return { ...v.calcularResumenPagos(pagos), ...v.calcularStats(pagos) }; };

let r = resumen([PAGOS[0], PAGOS[1]]);
igual([r.registros, r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [1, 1, 770, 6006, 0], 'ticket de 770 kg y $6,006 pagado en 2000 y 4006: 1 registro, 770 kg, pagado $6,006 y deuda $0');
r = resumen([PAGOS[3]]);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [1, 200, 400, 600], 'ticket pagado parcialmente con un solo abono: conserva su deuda ($600)');
r = resumen([PAGOS[4], PAGOS[5]]);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [2, 150, 900, 0], 'mismo ticket con dos materiales: dos grupos');
igual(w.agruparPagosPorTicket([PAGOS[4], PAGOS[5]]).length, 2, 'dos materiales = dos grupos');
r = resumen([PAGOS[0], PAGOS[1], PAGOS[2]]);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [1, 770, 6006, 0], 'un abono revertido no cuenta (ni sus kg, ni su pagado)');
r = resumen([PAGOS[0], PAGOS[2]]);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [1, 770, 2000, 4006], 'con el segundo abono revertido el ticket vuelve a deber lo que faltaba');
afirmar(w.calcularResumenPagos([PAGOS[2]]) === null && w.calcularResumenPagos([]) === null, 'solo revertidos o sin pagos: sin resumen (null), como antes');
r = resumen([PAGOS[8], PAGOS[9]]);
igual([w.agruparPagosPorTicket([PAGOS[8], PAGOS[9]]).length, r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [2, 0, 0, 1600, -1600], 'anticipos sin ticket: cada uno su grupo, suman su pagado, no son registro ni kg y conservan su cálculo de deuda de siempre (restan su pagado)');
// Pagos sin ticket que no son anticipo (captura incompleta) y abonos a saldo inicial
const sinTicket = (id, kg) => ({ id, ticket: '', proveedor: 'LUIS', material: 'PET', kg, total: 100, pagado: 40, fecha: '2026-11-01', fechaRegistro: '2026-11-01T0' + kg + ':00:00.000Z' });
r = resumen([sinTicket('s1', 1), sinTicket('s2', 1)]);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [2, 2, 80, 120], 'pagos sin ticket (no anticipo): se cuentan uno por uno');
const saldoIni = { id: 'si', ticket: '', proveedor: 'LUIS', pagado: 300, total: 0, kg: 0, abonoSaldoInicial: true, fecha: '2026-11-01' };
r = resumen([PAGOS[3], saldoIni]);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [1, 200, 700, 600], 'abono a saldo inicial: suma su pagado, no es registro ni kg y su deuda es 0');
// kg distintos entre abonos: el más reciente, sin importar el orden del arreglo
const d1 = PAGOS[6], d2 = PAGOS[7];
for (const [nombre, lista] of [['orden original', [d1, d2]], ['orden invertido', [d2, d1]]]) {
  r = resumen(lista);
  igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [1, 770, 3000, 3006], `kg y total distintos entre abonos (${nombre}): usa el abono más reciente por fechaRegistro (770 kg, $6,006), sin sumar los demás`);
}
r = resumen([{ ...d1, fechaRegistro: '2026-11-05T00:00:00.000Z' }, d2]);
igual([r.totalKg, r.totalDeuda], [700, 5460 - 3000], 'si el abono de 700 kg es el más reciente, gana ese');
r = resumen([{ ...d1, fechaRegistro: '', id: 'd1' }, { ...d2, fechaRegistro: '', fecha: '2026-11-09', id: 'd2' }]);
igual(r.totalKg, 770, 'sin fechaRegistro, desempata la fecha del pago');
// La cuenta por pagar del ticket tiene prioridad
const wc = crearVm([{ id: 'x1', ticket: '6000', proveedor: 'ANA', material: 'PP', kg: 780, total: 6084, saldo: 3084 }]);
r = resumen([d1, d2], wc);
igual([r.totalKg, r.totalPagado, r.totalDeuda], [780, 3000, 3084], 'si existe la cuenta por pagar del ticket, su total y sus kg tienen prioridad');
r = resumen([PAGOS[0], PAGOS[1]], wc);
igual([r.totalKg, r.totalDeuda], [770, 0], 'una cuenta por pagar de otro ticket no afecta');
// Tickets distintos con el mismo proveedor y material son grupos distintos; el mismo ticket con otro proveedor también
igual(w.agruparPagosPorTicket([abono('t1', '1', 'JUANA', 'PET', 10, 50, 50, '2026-11-01', 'a'), abono('t2', '2', 'JUANA', 'PET', 10, 50, 50, '2026-11-01', 'b'), abono('t3', '1', 'OTRO', 'PET', 10, 50, 50, '2026-11-01', 'c')]).length, 3, 'tickets distintos, o el mismo ticket de otro proveedor: grupos distintos');
igual(w.agruparPagosPorTicket([abono('t1', ' 1380 ', 'juana', 'mixto', 770, 6006, 1, 'x', 'a'), abono('t2', '1380', 'JUANA', 'MIXTO', 770, 6006, 1, 'y', 'b')]).length, 1, 'ticket, proveedor y material se comparan sin distinguir mayúsculas, espacios ni acentos');
// Todo el conjunto
r = resumen(PAGOS);
igual([r.totalRegistros, r.totalKg, r.totalPagado, r.totalDeuda], [ESPERADO.registros, ESPERADO.kg, ESPERADO.pagado, ESPERADO.deuda], 'conjunto completo: registros, kg, pagado y deuda sin doble conteo');
igual(JSON.stringify(PAGOS), copia, 'los registros de pagos no se modifican');
afirmar(w.deudaDePago === undefined || typeof w.deudaDePago === 'function', 'deudaDePago sigue disponible para las filas de detalle');

// ══ Parte 2: pantalla, TXT y PDF (navegador) ══
async function montar(browser, tabId, pagosCargados) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/cxp.js', 'js/pagos.js']) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ pagos }) => {
    window.obtenerFechaMexico = () => '2026-11-04';
    window.VistaCaptura = { abrir: (config) => { window.__captura = config; } };
    window.puedeEscribir = () => false;
    window.puedeLeer = () => true;
    window.showError = () => {};
    window.showSuccess = () => {};
    window.EVE_HISTORIAL = { registrar: () => {} };
    window.EVE = { currentUser: { username: 'p', permisosResueltos: {} }, registrosPagos: JSON.parse(JSON.stringify(pagos)), registrosMinistraciones: [], cuentasPorPagar: [], recibosPendientes: [], proveedores: [], registrosDestaraje: [], registrosVentas: [], ventas: [], precios: [], composiciones: [], auditorias: [], cuentasPorCobrar: [], cobros: [], gastos: [], clientes: [] };
    window.__textos = []; window.__tablas = [];
    window.jspdf = { jsPDF: function () {
      const doc = new Proxy({ internal: { pageSize: { getWidth: () => 210 } }, text(t) { window.__textos.push(String(t)); }, autoTable(o) { window.__tablas.push(JSON.parse(JSON.stringify(o))); doc.lastAutoTable = { finalY: 100 }; } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
      return doc;
    } };
    window.EVE_MODULES.pagos.render(document.getElementById('main-content'));
  }, { pagos: pagosCargados || PAGOS });
  await page.locator('.destaraje-subtabs .tab', { hasText: new RegExp('^' + tabId + '$') }).click();
  page.erroresPagina = errores;
  return page;
}

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await montar(browser, 'Todos');
    const pantalla = await page.$$eval('#pagos-stats span', (ss) => ss.map((s) => s.textContent.trim()));
    const dinero = (n) => ({ pagado: n.pagado, deuda: n.deuda });
    const mon = (n) => page.evaluate((x) => window.formatearMoneda(x), n);
    const kgTexto = ESPERADO.kg.toLocaleString('es-MX');
    igual(pantalla, [`Registros: ${ESPERADO.registros}`, `Total KG: ${kgTexto}`, `Total Pagado: ${await mon(ESPERADO.pagado)}`], 'pantalla de Pagos: Registros, Total KG y Total Pagado sin doble conteo, sin Total Deuda');
    afirmar(!pantalla.some((t) => /Registros: 7|Total KG: 3,360|13,472/.test(t)), 'pantalla: ya no muestra los totales inflados (7 registros, 3,360 kg, $15,072.00 de deuda)');

    // TXT y PDF con los mismos pagos que muestra la pantalla
    const salida = await page.evaluate(() => {
      const vigentes = window.EVE.registrosPagos.filter((p) => !p.revertido);
      const periodo = { etiquetaReporte: 'TODOS', etiquetaPeriodo: 'TODOS LOS REGISTROS' };
      const txt = window.generarTXTPagos({ destaraje: [], ventas: [], pagos: vigentes }, periodo);
      window.__textos = []; window.__tablas = [];
      window.generarPDFPagos({ destaraje: [], ventas: [], pagos: vigentes }, periodo);
      return { txt, textos: window.__textos.slice(), tablas: window.__tablas.slice(), csv: window.construirFilasCSV({ destaraje: [], ventas: [], pagos: vigentes }), filasPantalla: document.querySelectorAll('#pagos-tabla tr').length };
    });
    const totalPagado = `TOTAL PAGADO: ${await mon(ESPERADO.pagado)}`;
    afirmar(salida.txt.includes(totalPagado) && !salida.txt.includes('TOTAL DEUDA') && !/DEUDA/.test(salida.txt), 'TXT: TOTAL PAGADO igual al de la pantalla y sin deuda');
    afirmar(salida.textos.includes(totalPagado) && !salida.textos.some((t) => /DEUDA/.test(t)), 'PDF: TOTAL PAGADO igual al de la pantalla y sin deuda');
    afirmar(pantalla[2].replace('Total Pagado: ', 'TOTAL PAGADO: ') === totalPagado && pantalla.length === 3, 'pantalla, TXT y PDF coinciden entre sí');

    // Las filas de detalle siguen mostrando cada abono (9 pagos activos: 2 + 1 + 2 + 2 + 2 anticipos)
    const detalleTxt = salida.txt.split('DETALLE DE PAGOS:')[1].split('\n').filter((l) => l.trim()).slice(1);
    igual(detalleTxt.length, 9, 'TXT: el detalle muestra cada abono (9 filas)');
    afirmar(detalleTxt.filter((l) => /\b1380\b/.test(l)).length === 2 && detalleTxt.some((l) => /\$4,006\.00/.test(l)), 'TXT: el ticket 1380 aparece con sus dos abonos ($2,000 y $4,006)');
    igual(salida.tablas[salida.tablas.length - 1].body.length, 9, 'PDF: el detalle muestra cada abono (9 filas)');
    const filaPdf1380 = salida.tablas[salida.tablas.length - 1].body.filter((f) => f[0] === '1380');
    igual(filaPdf1380.map((f) => f[6]), ['$2,000.00', '$4,006.00'], 'PDF: pagado por abono');
    igual(filaPdf1380.map((f) => f.length), [8, 8], 'PDF: la fila de detalle ya no trae la columna de deuda (ticket, proveedor, material, kg, precio, total, pagado, fecha)');
    igual(salida.tablas[salida.tablas.length - 1].head[0].includes('DEUDA'), false, 'PDF: el encabezado del detalle ya no dice DEUDA');
    igual(salida.csv.length, 9, 'CSV: una fila por abono');
    igual(salida.csv.filter((f) => f.ticket === '1380').map((f) => [f.kg, f.total, f.pagado]), [[770, 6006, 2000], [770, 6006, 4006]], 'CSV: kg, total y pagado de cada abono sin cambios (la columna deuda del CSV de Pagos se verifica en verificar-pagos-saldo-inicial.js)');
    igual(salida.filasPantalla, 9, 'tabla de Pagos: una fila por abono, sin cambios');
    afirmar(page.erroresPagina.length === 0, 'sin errores de JavaScript: ' + page.erroresPagina.join(' / '));

    // Otras pestañas (la lógica es la misma): Hoy sin pagos de fecha de hoy muestra ceros
    await page.locator('.destaraje-subtabs .tab', { hasText: /^Hoy$/ }).click();
    igual(await page.$$eval('#pagos-stats span', (ss) => ss.map((s) => s.textContent.trim())), ['Registros: 0', 'Total KG: 0', 'Total Pagado: $0.00'], 'pestaña Hoy sin pagos de hoy: ceros');
    await page.close();

    // ══ Parte 2b: Total Pagado y Deuda por periodo ══
    // Ticket 7000 (MARIO, PET, 500 kg, $3,000): anticipo de $1,000 la semana pasada (28/10) y liquidación de $2,000 hoy (4/11).
    const E1 = abono('e1', '7000', 'MARIO', 'PET', 500, 3000, 1000, '2026-10-28', '2026-10-28T10:00:00.000Z');
    const E2 = abono('e2', '7000', 'MARIO', 'PET', 500, 3000, 2000, '2026-11-04', '2026-11-04T10:00:00.000Z');
    // Ticket 7100 pagado a medias con un solo abono hoy (700 de 2,000)
    const H1 = abono('h1', '7100', 'ROSA', 'HDPE', 250, 2000, 700, '2026-11-04', '2026-11-04T11:00:00.000Z');
    // Ticket 7200 pagado en dos abonos de la misma semana, ambos en Esta Semana
    const S1 = abono('s1', '7200', 'ELVA', 'PP', 100, 800, 300, '2026-11-02', '2026-11-02T09:00:00.000Z');
    const S2 = abono('s2', '7200', 'ELVA', 'PP', 100, 800, 500, '2026-11-03', '2026-11-03T09:00:00.000Z');
    const RV = abono('rv', '7000', 'MARIO', 'PET', 500, 3000, 2500, '2026-11-04', '2026-11-04T12:00:00.000Z', { revertido: true });
    const PAGOS_P = [E1, E2, H1, S1, S2, RV];
    const monP = (page, n) => page.evaluate((x) => window.formatearMoneda(x), n);
    const statsPantalla = (page) => page.$$eval('#pagos-stats span', (ss) => ss.map((s) => s.textContent.trim()));
    const pagP = await montar(browser, 'Hoy', PAGOS_P);

    // Hoy: e2 (liquidación) y h1 (parcial). El anticipo de la semana pasada no está en la vista: no suma al Pagado, pero sí a la Deuda.
    let s = await statsPantalla(pagP);
    igual(s, ['Registros: 2', 'Total KG: 750', `Total Pagado: ${await monP(pagP, 2000 + 700)}`], 'Hoy: Pagado = solo lo pagado hoy ($2,000 + $700), sin el anticipo de la semana pasada; la deuda del ticket 7000 es $0 y la del parcial $1,300');
    const resumenHoy7000 = await pagP.evaluate(() => { const v = window.EVE.registrosPagos.filter((x) => x.ticket === '7000' && !x.revertido && x.fecha === '2026-11-04'); const r = window.calcularResumenPagos(v); return [v.length, r.registros, r.totalKg, r.totalTickets, r.totalPagado, r.totalDeuda]; });
    igual(resumenHoy7000, [1, 1, 500, 3000, 2000, 0], 'vista Hoy del ticket 7000: 1 registro, 500 kg, Total $3,000, Pagado $2,000 y Deuda $0');
    const resumenTodos7000 = await pagP.evaluate(() => { const v = window.EVE.registrosPagos.filter((x) => x.ticket === '7000' && !x.revertido); const r = window.calcularResumenPagos(v); return [v.length, r.registros, r.totalKg, r.totalTickets, r.totalPagado, r.totalDeuda]; });
    igual(resumenTodos7000, [2, 1, 500, 3000, 3000, 0], 'vista Todos del ticket 7000: 1 registro, Total $3,000, Pagado $3,000 y Deuda $0');
    const resumen2810 = await pagP.evaluate(() => { const v = window.EVE.registrosPagos.filter((x) => x.ticket === '7000' && !x.revertido && x.fecha === '2026-10-28'); const r = window.calcularResumenPagos(v); return [v.length, r.registros, r.totalKg, r.totalTickets, r.totalPagado, r.totalDeuda]; });
    igual(resumen2810, [1, 1, 500, 3000, 1000, 0], 'vista del 28/10 del ticket 7000: 1 registro, Total $3,000, Pagado $1,000 y Deuda $0 (la liquidación posterior ya saldó el ticket)');
    const sinUniverso = await pagP.evaluate(() => { const v = window.EVE.registrosPagos.filter((x) => x.ticket === '7000' && !x.revertido && x.fecha === '2026-11-04'); const r = window.calcularResumenPagos(v, v); return [r.totalPagado, r.totalDeuda]; });
    igual(sinUniverso, [2000, 1000], 'control: sin el conjunto completo la deuda de la vista Hoy sería $1,000 (el anticipo no se vería)');
    const soloH = await pagP.evaluate(() => { const r = window.calcularResumenPagos([window.EVE.registrosPagos.find((x) => x.id === 'h1')]); return [r.registros, r.totalKg, r.totalPagado, r.totalDeuda]; });
    igual(soloH, [1, 250, 700, 1300], 'ticket parcialmente pagado visto desde el periodo de su único abono: Pagado $700 y conserva su deuda');
    // Un abono revertido no cuenta ni como pagado ni en la deuda
    const conRevertido = await pagP.evaluate(() => { const v = window.EVE.registrosPagos.filter((x) => x.ticket === '7000' && x.fecha === '2026-11-04'); const r = window.calcularResumenPagos(v); return [v.length, r.totalPagado, r.totalDeuda]; });
    igual(conRevertido, [2, 2000, 0], 'el abono revertido ($2,500) no suma al pagado ni cambia la deuda');

    // Vista para captura (Hoy): Registros y Total pagado como la pantalla
    const kpiCaptura = (c, etiqueta) => (((c.kpis || []).find((k) => k.label === etiqueta) || {}).valor);
    await pagP.click('#btn-vista-captura-pagos');
    let captura = await pagP.evaluate(() => window.__captura);
    igual(String(kpiCaptura(captura, 'Registros')), '2', 'vista para captura (Hoy): el KPI Registros es el de la pantalla');
    igual(kpiCaptura(captura, 'Total pagado'), await monP(pagP, 2700), 'vista para captura (Hoy): el KPI Total pagado es el Total Pagado de la pantalla ($2,700)');
    afirmar(captura.filas.length === 2, 'vista para captura: el detalle sigue mostrando cada abono (2 filas hoy)');
    await pagP.close();

    // Todas las pestañas: pantalla = TXT = PDF = reporte general = desglose por proveedor = vista para captura
    const TABS = [['Hoy', 'hoy'], ['Esta Semana', 'semana'], ['Este Mes', 'mes'], ['Últimos 30 días', 'ultimos30'], ['Todos', 'todos']];
    const esperadoPorTab = {
      Hoy: [2, 750, 2700, 1300], 'Esta Semana': [3, 850, 3500, 1300], 'Este Mes': [3, 850, 3500, 1300], 'Últimos 30 días': [3, 850, 4500, 1300], Todos: [3, 850, 4500, 1300]
    };
    for (const [nombre, id] of TABS) {
      const pg = await montar(browser, nombre, PAGOS_P);
      const stats = await statsPantalla(pg);
      const periodo = await pg.evaluate((tab) => window.obtenerRangoYEtiqueta(tab, { desde: '', hasta: '' }), id);
      const salida = await pg.evaluate(({ desde, hasta, etiquetaReporte, etiquetaPeriodo }) => {
        const datos = window.obtenerDatosPeriodo(desde, hasta, {});
        const periodoR = { etiquetaReporte, etiquetaPeriodo };
        const txt = window.generarTXTPagos(datos, periodoR);
        window.__textos = []; window.__tablas = [];
        window.generarPDFPagos(datos, periodoR);
        const general = window.generarTXT({ destaraje: [], ventas: [], pagos: datos.pagos }, periodoR);
        const desglose = window.agregarPagadoPorProveedor(datos.pagos);
        return { txt, pdf: window.__textos.slice(), general, desglose, sumaDesglose: Math.round(desglose.reduce((suma, d) => suma + d.totalPagado, 0) * 100) / 100 };
      }, periodo);
      const pagado = stats[2].replace('Total Pagado: ', '');
      const [reg, kg, pag, deu] = esperadoPorTab[nombre];
      afirmar(salida.txt.includes('TOTAL PAGADO: ' + pagado) && !/DEUDA/.test(salida.txt), `${nombre}: TXT = pantalla (pagado ${pagado}) y sin deuda`);
      afirmar(salida.pdf.includes('TOTAL PAGADO: ' + pagado) && !salida.pdf.some((t) => /DEUDA/.test(t)), `${nombre}: PDF = pantalla y sin deuda`);
      // El reporte general de Reportes (Báscula) conserva su TOTAL DEUDA: calculado con calcularResumenPagos, no con la pantalla de Pagos.
      afirmar(salida.general.includes('TOTAL PAGADO: ' + pagado) && salida.general.includes('TOTAL DEUDA: ' + (await monP(pg, deu))), `${nombre}: el reporte general (Báscula) conserva pagado y deuda`);
      igual(stats, [`Registros: ${reg}`, `Total KG: ${kg.toLocaleString('es-MX')}`, `Total Pagado: ${await monP(pg, pag)}`], `${nombre}: totales de la pantalla`);
      // El desglose por proveedor suma exactamente el Total Pagado de la pantalla, y lo muestran el TXT y el PDF
      igual(await monP(pg, salida.sumaDesglose), pagado, `${nombre}: el desglose por proveedor suma el Total Pagado de la pantalla`);
      afirmar(salida.desglose.every((d) => salida.txt.includes(`  ${d.proveedor}: `) && salida.pdf.includes(`    ${d.proveedor}`)), `${nombre}: el TXT y el PDF listan a cada proveedor del desglose`);
      if (id === 'hoy' || id === 'semana') {
        await pg.click('#btn-vista-captura-pagos');
        captura = await pg.evaluate(() => window.__captura);
        igual(String(kpiCaptura(captura, 'Registros')), String(reg), `${nombre}: el KPI Registros de la vista para captura coincide con la pantalla`);
        igual(kpiCaptura(captura, 'Total pagado'), pagado, `${nombre}: el KPI Total pagado de la vista para captura coincide con la pantalla`);
        const sumaResumen = (captura.resumenFilas || []).reduce((suma, f) => suma + Number(String(f.valor).replace(/[^0-9.-]/g, '')), 0);
        igual(await monP(pg, Math.round(sumaResumen * 100) / 100), pagado, `${nombre}: el total por proveedor de la vista para captura suma el Total Pagado de la pantalla`);
      }
      afirmar(pg.erroresPagina.length === 0, `${nombre}: sin errores de JavaScript: ` + pg.erroresPagina.join(' / '));
      await pg.close();
    }

    // Rangos de fechas en Todos (filtro Desde/Hasta): el anticipo (28/10), la liquidación (04/11) y todo el rango
    for (const [desde, hasta, esperado, nota] of [
      ['2026-10-28', '2026-10-28', [1, 500, 1000, 0], 'solo el anticipo: Pagado $1,000 y Deuda $0 (el ticket ya está liquidado)'],
      ['2026-11-04', '2026-11-04', [2, 750, 2700, 1300], 'solo hoy: igual a la pestaña Hoy'],
      ['2026-10-28', '2026-11-04', [3, 850, 4500, 1300], 'todo el rango: Pagado $4,500']
    ]) {
      const pg = await montar(browser, 'Todos', PAGOS_P);
      await pg.fill('#pgf-desde', desde);
      await pg.fill('#pgf-hasta', hasta);
      await pg.dispatchEvent('#pgf-hasta', 'input');
      await pg.dispatchEvent('#pgf-hasta', 'change');
      await pg.waitForTimeout(50);
      const st = await statsPantalla(pg);
      const [reg, kg, pag, deu] = esperado;
      igual(st, [`Registros: ${reg}`, `Total KG: ${kg.toLocaleString('es-MX')}`, `Total Pagado: ${await monP(pg, pag)}`], `rango ${desde} a ${hasta}: ${nota}`);
      const salida = await pg.evaluate(({ desde, hasta }) => {
        const datos = window.obtenerDatosPeriodo(desde, hasta, {});
        const periodoR = { etiquetaReporte: 'TODOS', etiquetaPeriodo: 'X' };
        window.__textos = []; window.__tablas = [];
        window.generarPDFPagos(datos, periodoR);
        return { txt: window.generarTXTPagos(datos, periodoR), pdf: window.__textos.slice() };
      }, { desde, hasta });
      const pagadoTxt = await monP(pg, pag);
      afirmar(salida.txt.includes('TOTAL PAGADO: ' + pagadoTxt) && !/DEUDA/.test(salida.txt), `rango ${desde} a ${hasta}: el TXT coincide con la pantalla`);
      afirmar(salida.pdf.includes('TOTAL PAGADO: ' + pagadoTxt) && !salida.pdf.some((t) => /DEUDA/.test(t)), `rango ${desde} a ${hasta}: el PDF coincide con la pantalla`);
      // Con filtro de fechas la vista para captura está disponible: su Registros y su Total pagado coinciden con la pantalla
      await pg.click('#btn-vista-captura-pagos');
      captura = await pg.evaluate(() => window.__captura);
      igual(String(kpiCaptura(captura, 'Registros')), String(reg), `rango ${desde} a ${hasta}: KPI Registros de la vista para captura = pantalla`);
      igual(kpiCaptura(captura, 'Total pagado'), pagadoTxt, `rango ${desde} a ${hasta}: KPI Total pagado de la vista para captura = pantalla`);
      await pg.close();
    }

    // ══ Flujo de efectivo y Dashboard: ni usan calcularResumenPagos / agruparPagosPorTicket ni cambian ══
    // Flujo (js/flujo.js, construirMovimientosFlujo ~L99-123) toma cada pago por su fecha y su pagado; el Dashboard (js/dashboard.js,
    // calcularVistaPagadoPorMesProveedor ~L67-76) suma el pagado por mes y proveedor. Deben dar el pagado real por fecha de pago.
    {
      const pf = await browser.newPage();
      const errores = [];
      pf.on('pageerror', (e) => errores.push(e.message));
      await pf.setContent('<div id="toast-container"></div><div id="main-content"></div>');
      await pf.evaluate(() => {
        window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
        window.EVE_MODULES = {};
      });
      for (const sc of ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/flujo.js', 'js/dashboard.js']) await pf.addScriptTag({ path: path.join(RAIZ, sc) });
      const r = await pf.evaluate((pagos) => {
        window.obtenerFechaMexico = () => '2026-11-04';
        window.EVE = { currentUser: { username: 'p' }, registrosPagos: pagos, cuentasPorPagar: [], cobros: [], gastos: [], flujoMovimientos: [], registrosDestaraje: [], precios: [], composiciones: [] };
        const movimientos = window.EVE_FLUJO.construirMovimientosFlujo({ cobros: [], pagos, gastos: [], movimientosManuales: [] });
        const matriz = window.EVE_DASHBOARD.calcularVistaPagadoPorMesProveedor();
        return {
          flujo: movimientos.map((m) => [m.fecha, m.contraparte, m.folio, m.salida]).sort((a, b) => (a[0] + a[2]).localeCompare(b[0] + b[2])),
          dashboard: { meses: matriz.meses, filas: matriz.filas.map((f) => ({ clave: f.clave, ...Object.fromEntries(matriz.meses.map((mes) => [mes, f[mes]])), total: f._total })) }
        };
      }, PAGOS_P);
      igual(r.flujo, [
        ['2026-10-28', 'MARIO', '7000', 1000], ['2026-11-02', 'ELVA', '7200', 300], ['2026-11-03', 'ELVA', '7200', 500], ['2026-11-04', 'MARIO', '7000', 2000], ['2026-11-04', 'ROSA', '7100', 700]
      ], 'Flujo de efectivo: una salida por cada abono NO revertido, con su pagado real en su fecha de pago (el anticipo $1,000 el 28/10 y la liquidación $2,000 el 04/11, sin agrupar por ticket)');
      igual(r.dashboard.meses, ['2026-10', '2026-11'], 'Dashboard (Pagado por Mes y Proveedor): meses por fecha de pago');
      const fila = (c) => r.dashboard.filas.find((f) => f.clave === c);
      igual([fila('MARIO')['2026-10'], fila('MARIO')['2026-11'], fila('MARIO').total], [1000, 2000, 3000], 'Dashboard: MARIO pagó $1,000 en octubre y $2,000 en noviembre (no $3,000 en un solo mes)');
      igual([fila('ROSA')['2026-11'], fila('ELVA')['2026-11']], [700, 800], 'Dashboard: ROSA y ELVA con su pagado real del mes');
      afirmar(errores.length === 0, 'Flujo y Dashboard: sin errores de JavaScript: ' + errores.join(' / '));
      await pf.close();
      for (const archivo of ['js/flujo.js', 'js/dashboard.js']) {
        const codigo = leer(archivo);
        afirmar(!/calcularResumenPagos|agruparPagosPorTicket/.test(codigo), `${archivo} no usa calcularResumenPagos ni agruparPagosPorTicket`);
      }
    }
  } finally {
    await browser.close();
  }

  // ══ Parte 3: diagnóstico de solo lectura ══
  {
    const escrituras = [];
    const prohibido = (nombre) => () => { escrituras.push(nombre); throw new Error('ESCRITURA PROHIBIDA ' + nombre); };
    const descargas = [];
    const consola = [];
    const sandbox = {
      console: { log: (...a) => consola.push(a.join(' ')), error: (...a) => consola.push('ERROR ' + a.join(' ')), group() {}, groupEnd() {}, table() {}, warn() {} },
      Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON,
      Blob: class { constructor(partes) { this.contenido = partes.join(''); } },
      URL: { createObjectURL: (b) => { descargas.push(b.contenido); return 'blob:x'; } },
      document: { createElement: () => ({ click() { descargas.push('click'); }, remove() {} }), body: { appendChild() {} } }
    };
    sandbox.window = sandbox;
    sandbox.window.guardarDato = prohibido('guardarDato');
    sandbox.window.actualizarDato = prohibido('actualizarDato');
    sandbox.window.eliminarDato = prohibido('eliminarDato');
    sandbox.window.db = { collection: prohibido('db.collection') };
    sandbox.window.EVE = { currentUser: { username: 'Admin' }, registrosPagos: JSON.parse(JSON.stringify(PAGOS)), cuentasPorPagar: [] };
    vm.createContext(sandbox);
    const antes = JSON.stringify(sandbox.window.EVE);
    vm.runInContext(leer('scripts/diagnostico-pagos-doble-conteo.js'), sandbox, { filename: 'scripts/diagnostico-pagos-doble-conteo.js' });
    const d = sandbox.window.__diagnosticoPagos;
    afirmar(!!d, 'el diagnóstico dejó su resultado en window.__diagnosticoPagos');
    igual(d.registrosActivos, 9, 'diagnóstico: 9 registros activos (el revertido no cuenta)');
    igual(d.ticketsConVariosPagos, 2, 'diagnóstico: 2 tickets con varios pagos (1380 y 6000; el de dos materiales no)');
    igual(d.tickets.map((t) => t.ticket).sort(), ['1380', '6000'], 'diagnóstico: los tickets listados');
    const t1380 = d.tickets.find((t) => t.ticket === '1380');
    igual(t1380.abonos.map((a) => [a.id, a.ticket, a.proveedor, a.material, a.kg, a.total, a.pagado, a.fechaRegistro]), [
      ['a1', '1380', 'JUANA', 'MIXTO', 770, 6006, 2000, '2026-10-20T10:00:00.000Z'], ['a2', '1380', 'JUANA', 'MIXTO', 770, 6006, 4006, '2026-11-02T10:00:00.000Z']
    ], 'diagnóstico: por abono ticket, proveedor, material, kg, total, pagado y fechaRegistro (en orden de captura)');
    igual([t1380.kgSumadoHoy, t1380.kgReal, t1380.kgDeMas, t1380.deudaReal], [1540, 770, 770, 0], 'diagnóstico: ticket 1380, kg sumados hoy 1,540 contra 770 reales');
    const t6000 = d.tickets.find((t) => t.ticket === '6000');
    afirmar(t6000.kgDistintosEntreAbonos && t6000.totalDistintosEntreAbonos && t6000.kgReal === 770 && t6000.kgDeMas === 700, 'diagnóstico: ticket 6000 marca que sus abonos traen kg y total distintos y usa el más reciente');
    igual([d.kgDeMas, d.totalDeMas], [1470, 11466], 'diagnóstico: kg de más y total de más (suma de los tickets)');
    // Coincide con lo que calcula la app
    const wr = crearVm();
    const grupos = wr.agruparPagosPorTicket(PAGOS);
    afirmar(['1380', '6000'].every((tk) => grupos.find((g) => g.ticket === tk).kg === d.tickets.find((t) => t.ticket === tk).kgReal), 'diagnóstico: los kg reales coinciden con los de agruparPagosPorTicket');
    // Descarga y JSON
    const json = descargas.find((x) => x.startsWith('{'));
    afirmar(descargas.includes('click') && json && JSON.parse(json).ticketsConVariosPagos === 2, 'diagnóstico: descarga el resultado como JSON');
    // Solo lectura
    igual(escrituras, [], 'diagnóstico: no llamó a guardarDato, actualizarDato, eliminarDato ni a Firestore');
    igual(JSON.stringify(sandbox.window.EVE), antes, 'diagnóstico: los datos no se modificaron');
    const codigo = leer('scripts/diagnostico-pagos-doble-conteo.js').replace(/\/\/.*$/gm, '');
    afirmar(!/guardarDato\(|actualizarDato\(|eliminarDato\(|window\.db|\.collection\(|runTransaction|\.batch\(/.test(codigo), 'diagnóstico: el script no contiene ninguna llamada de escritura ni a Firestore');
    // Sin sesión
    const sin = { console: { log() {}, error: (...a) => consola.push('SIN SESION ' + a.join(' ')) }, window: {}, document: {}, Math, Number, String, Array, Object, JSON, Set, Map, Date };
    sin.window = sin;
    vm.createContext(sin);
    vm.runInContext(leer('scripts/diagnostico-pagos-doble-conteo.js'), sin);
    afirmar(consola.some((l) => l.startsWith('SIN SESION') && /inicia sesión/.test(l)), 'diagnóstico: sin sesión avisa y no hace nada');
  }

  console.log(`${ok}/${total} verificaciones correctas`);
})().catch((e) => { console.error('FALLA: ' + (e.stack || e.message)); process.exitCode = 1; });
