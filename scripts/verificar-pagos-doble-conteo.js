// Doble conteo en Compras > Pagos: cada abono a una cuenta por pagar genera un registro en `pagos` con los kg y el total COMPLETOS del
// ticket, y los totales sumaban registro por registro. Ahora los abonos NO revertidos se agrupan por ticket + proveedor + material
// (agruparPagosPorTicket / calcularResumenPagos en js/reportes.js; calcularStats en js/pagos.js).
//
// Parte 1 (vm, js/ reales): el ticket de 770 kg y $6,006 pagado en 2000 y 4006 da 1 registro, 770 kg, pagado $6,006 y deuda $0; un
//   ticket pagado parcialmente conserva su deuda; el mismo ticket con dos materiales cuenta dos grupos; un abono revertido no cuenta;
//   los anticipos y los pagos sin ticket se cuentan uno por uno; con kg distintos entre abonos gana el más reciente (en cualquier orden);
//   la cuenta por pagar del ticket tiene prioridad; los datos no se modifican.
// Parte 2 (Chromium, Playwright): la pantalla de Pagos (Registros, Total KG, Total Pagado, Total Deuda), el TXT y el PDF de pagos
//   dan los mismos totales; las filas de detalle (pantalla, TXT, PDF y CSV) siguen mostrando cada abono.
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
async function montar(browser, tabId) {
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
  }, { pagos: PAGOS });
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
    igual(pantalla, [`Registros: ${ESPERADO.registros}`, `Total KG: ${kgTexto}`, `Total Pagado: ${await mon(ESPERADO.pagado)}`, `Total Deuda: ${await mon(ESPERADO.deuda)}`], 'pantalla de Pagos: Registros, Total KG, Total Pagado y Total Deuda sin doble conteo');
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
    const totalDeuda = `TOTAL DEUDA: ${await mon(ESPERADO.deuda)}`;
    afirmar(salida.txt.includes(totalPagado) && salida.txt.includes(totalDeuda), 'TXT: TOTAL PAGADO y TOTAL DEUDA iguales a los de la pantalla');
    afirmar(salida.textos.includes(totalPagado) && salida.textos.includes(totalDeuda), 'PDF: TOTAL PAGADO y TOTAL DEUDA iguales a los de la pantalla');
    afirmar(pantalla[2].replace('Total Pagado: ', 'TOTAL PAGADO: ') === totalPagado && pantalla[3].replace('Total Deuda: ', 'TOTAL DEUDA: ') === totalDeuda, 'pantalla, TXT y PDF coinciden entre sí');
    afirmar(!salida.txt.includes(`TOTAL DEUDA: ${await mon(ANTIGUO.deuda)}`), 'TXT: ya no trae la deuda inflada');

    // Las filas de detalle siguen mostrando cada abono (9 pagos activos: 2 + 1 + 2 + 2 + 2 anticipos)
    const detalleTxt = salida.txt.split('DETALLE DE PAGOS:')[1].split('\n').filter((l) => l.trim()).slice(1);
    igual(detalleTxt.length, 9, 'TXT: el detalle muestra cada abono (9 filas)');
    afirmar(detalleTxt.filter((l) => /\b1380\b/.test(l)).length === 2 && detalleTxt.some((l) => /\$4,006\.00/.test(l)), 'TXT: el ticket 1380 aparece con sus dos abonos ($2,000 y $4,006)');
    igual(salida.tablas[salida.tablas.length - 1].body.length, 9, 'PDF: el detalle muestra cada abono (9 filas)');
    const filaPdf1380 = salida.tablas[salida.tablas.length - 1].body.filter((f) => f[0] === '1380');
    igual(filaPdf1380.map((f) => f[6]), ['$2,000.00', '$4,006.00'], 'PDF: pagado por abono');
    igual(filaPdf1380.map((f) => f[7]), ['$4,006.00', '$2,000.00'], 'PDF: la fila de detalle conserva su deuda por abono, sin cambios (total menos el pagado de ese abono)');
    igual(salida.csv.length, 9, 'CSV: una fila por abono');
    igual(salida.csv.filter((f) => f.ticket === '1380').map((f) => [f.kg, f.total, f.pagado, f.deuda]), [[770, 6006, 2000, 4006], [770, 6006, 4006, 2000]], 'CSV: kg, total, pagado y deuda de cada abono sin cambios');
    igual(salida.filasPantalla, 9, 'tabla de Pagos: una fila por abono, sin cambios');
    afirmar(page.erroresPagina.length === 0, 'sin errores de JavaScript: ' + page.erroresPagina.join(' / '));

    // Otras pestañas (la lógica es la misma): Hoy sin pagos de fecha de hoy muestra ceros
    await page.locator('.destaraje-subtabs .tab', { hasText: /^Hoy$/ }).click();
    igual(await page.$$eval('#pagos-stats span', (ss) => ss.map((s) => s.textContent.trim())), ['Registros: 0', 'Total KG: 0', 'Total Pagado: $0.00', 'Total Deuda: $0.00'], 'pestaña Hoy sin pagos de hoy: ceros');
    await page.close();
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
