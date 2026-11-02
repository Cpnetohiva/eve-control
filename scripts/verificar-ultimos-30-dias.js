// Vista «Últimos 30 días» en los módulos con barra Hoy / Esta Semana / Este Mes.
// Definición: de hoy menos 29 días a hoy, ambos incluidos (30 días corridos), con la misma fecha de hoy (zona horaria de México) que usan
// Hoy / Esta Semana / Este Mes.
//
// Parte 1 (vm): el helper compartido y el rango/título que usan TXT, PDF, CSV y vista para captura (obtenerRangoYEtiqueta).
// Parte 2 (navegador, Playwright): en cada módulo la pestaña va justo después de Este Mes, filtra con fechas en los bordes (hoy, hoy−29,
// hoy−30, mañana y un día de otro mes dentro de la ventana) y el conteo del encabezado coincide con la lista; Este Mes no cambia.
//
// Uso: node scripts/verificar-ultimos-30-dias.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (r) => fs.readFileSync(path.join(RAIZ, r), 'utf8');

// Hoy = 2 de noviembre de 2026. Ventana: 4 de octubre al 2 de noviembre (cruza el cambio de mes).
const HOY = '2026-11-02';
const D = { hoy: HOY, borde29: '2026-10-04', borde30: '2026-10-03', manana: '2026-11-03', mesAnterior: '2026-10-31' };
// Esperado en «Últimos 30 días»: hoy, hoy−29 y el 31 de octubre. Fuera: hoy−30 y mañana.
// Esperado en «Este Mes» (sin cambios): hoy y mañana (el filtro de mes no tiene tope superior).

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// ── Parte 1: helper y rango ──────────────────────────────────────────────────────────────────────────

function crearVm(hoy) {
  const sb = { console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => null }, firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } } };
  sb.window = sb;
  sb.window.EVE = {};
  sb.window.EVE_MODULES = {};
  vm.createContext(sb);
  for (const f of ['js/config.js', 'js/utils.js', 'js/reportes.js']) vm.runInContext(leer(f), sb, { filename: f });
  sb.window.obtenerFechaMexico = () => hoy;
  return sb.window;
}

caso('helper: de hoy−29 a hoy, ambos incluidos; hoy−30 y mañana quedan fuera', () => {
  const w = crearVm(HOY);
  igual(w.obtenerInicioUltimos30Dias(), '2026-10-04', 'inicio');
  igual([D.hoy, D.borde29, D.mesAnterior].map((f) => w.dentroDeUltimos30Dias(f)), [true, true, true], 'dentro');
  igual([D.borde30, D.manana, '', undefined, null].map((f) => w.dentroDeUltimos30Dias(f)), [false, false, false, false, false], 'fuera');
  // 30 días corridos exactos.
  igual((Date.parse(HOY) - Date.parse(w.obtenerInicioUltimos30Dias())) / 86400000 + 1, 30, 'son 30 días');
});

caso('helper: cambios de mes y de año, febrero y año bisiesto', () => {
  const casosFecha = [['2026-03-05', '2026-02-04'], ['2026-01-15', '2025-12-17'], ['2028-03-10', '2028-02-10'], ['2026-03-01', '2026-01-31'], ['2026-12-31', '2026-12-02']];
  for (const [hoy, inicio] of casosFecha) igual(crearVm(hoy).obtenerInicioUltimos30Dias(), inicio, `hoy ${hoy}`);
  const w = crearVm('2026-03-05');
  igual([w.dentroDeUltimos30Dias('2026-02-04'), w.dentroDeUltimos30Dias('2026-02-03')], [true, false], 'borde en otro mes');
});

caso('rango y título del periodo (TXT, PDF, CSV y vista para captura): Últimos 30 días con dd/mm/aaaa al dd/mm/aaaa', () => {
  const w = crearVm(HOY);
  const r = w.obtenerRangoYEtiqueta('ultimos30', {});
  igual([r.desde, r.hasta, r.etiquetaReporte], ['2026-10-04', '2026-11-02', 'ULTIMOS_30_DIAS'], 'rango');
  igual(r.etiquetaPeriodo, 'ÚLTIMOS 30 DÍAS: 04/10/2026 al 02/11/2026', 'título');
  igual(w.obtenerRangoYEtiqueta('mes', {}).desde, '2026-11-01', 'Este Mes sin cambios');
  igual(w.obtenerRangoYEtiqueta('hoy', {}).etiquetaReporte, 'HOY', 'Hoy sin cambios');
});

// ── Parte 2: módulos en el navegador ────────────────────────────────────────────────────────────────

const SCRIPTS_BASE = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js'];
const PERMISOS = { cxc: 'escritura', cxp: 'escritura', pagos: 'escritura', gastos: 'escritura', flujo: 'escritura', ventas: 'escritura', destaraje: 'escritura', control_produccion: 'escritura', reportes: 'escritura' };

const fechas = (campo, extra) => Object.entries(D).map(([clave, f]) => ({ id: 'r_' + clave, [campo]: f, ...(extra ? extra(clave, f) : {}) }));

const MODULOS = [
  {
    nombre: 'Cobros', id: 'cobros', scripts: ['js/cobros.js'], stats: '#cobros-stats', tabs: '.destaraje-subtabs',
    datos: () => ({ cobros: fechas('fecha', (c) => ({ cliente: 'ACME', folio: 'V-' + c, material: 'PET', cantidad: 1, pagado: 100, iva: 0, revertido: false })), cuentasPorCobrar: [], clientes: [] })
  },
  {
    nombre: 'Gastos', id: 'gastos', scripts: ['js/gastos.js'], stats: '#gastos-stats', tabs: '.destaraje-subtabs',
    datos: () => ({ gastos: fechas('fecha', (c) => ({ concepto: 'Diésel ' + c, beneficiario: 'GAS', montoBase: 100, iva: 0, tipoGasto: 'operacion' })) })
  },
  {
    nombre: 'Pagos', id: 'pagos', scripts: ['js/cxp.js', 'js/pagos.js'], stats: '#pagos-stats', tabs: '.destaraje-subtabs',
    datos: () => ({ registrosPagos: fechas('fecha', (c) => ({ ticket: 'T' + c, proveedor: 'ALFA', material: 'PET', kg: 10, pagado: 100, total: 100, iva: 0, revertido: false })), recibosPendientes: [], cuentasPorPagar: [] })
  },
  {
    nombre: 'Destaraje (Báscula)', id: 'destaraje', scripts: ['js/destaraje.js'], stats: '#destaraje-stats', tabs: '.destaraje-subtabs',
    datos: () => ({ registrosDestaraje: fechas('fechaSalida', (c, f) => ({ ticket: 'T' + c, fechaEntrada: f, proveedor: 'ALFA', material: 'PET', kg: 10, kgBruto: 12, tara: 2, unidad: 'KG' })), precios: [], cuentasPorPagar: [] })
  },
  {
    nombre: 'Ventas', id: 'ventas', scripts: ['js/ventas.js'], stats: '#ventas-stats', tabs: '.destaraje-subtabs',
    datos: () => ({ ventas: fechas('fecha', (c) => ({ folio: 'V-' + c, cliente: 'ACME', totalVenta: 100, lineas: [{ material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: 10, subtotal: 100, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 100 }] })), registrosVentas: [], inventario: [], inventarioInicial: [] })
  },
  {
    nombre: 'Control de Producción', id: 'controlProduccion', scripts: ['js/rendimientos.js', 'js/trazabilidad.js', 'js/control-produccion.js'], stats: '#control-produccion-stats', tabs: '.destaraje-subtabs',
    datos: () => ({ registrosControlProduccion: fechas('fecha', (c) => ({ ticket: 'P-' + c, tipoProceso: 'PELETIZADO', turno: 'Matutino', operador: 'OP', totalInput: 100, totalOutput: 90, eficiencia: 90, outputs: [], inputs: [] })) })
  },
  {
    nombre: 'Flujo de efectivo', id: 'flujo', scripts: ['js/flujo.js'], stats: null, tabs: '.destaraje-subtabs',
    datos: () => ({ cobros: fechas('fecha', (c) => ({ cliente: 'ACME', folio: 'V-' + c, pagado: 100, iva: 0, revertido: false, fechaRegistro: '2026-11-02T10:00:00.000Z' })), registrosPagos: [], gastos: [], flujoMovimientos: [] })
  }
];

async function montar(browser, m) {
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of [...SCRIPTS_BASE, ...m.scripts]) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ datos, hoy, permisos }) => {
    window.obtenerFechaMexico = () => hoy;
    window.puedeEscribir = () => false;
    window.puedeLeer = () => true;
    window.showError = (e) => { (window.__errores = window.__errores || []).push(e); };
    window.showSuccess = () => {};
    window.EVE_HISTORIAL = { registrar: () => {} };
    window.EVE = Object.assign({ currentUser: { username: 'prueba', permisosResueltos: permisos }, registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], registrosControlProduccion: [], ventas: [], precios: [], composiciones: [], recibosPendientes: [], auditorias: [], proveedores: [], clientes: [], cuentasPorPagar: [], cuentasPorCobrar: [], cobros: [], gastos: [], flujoMovimientos: [], inventario: [], inventarioInicial: [], metaPiezasDia: {} }, datos);
  }, { datos: m.datos(), hoy: HOY, permisos: PERMISOS });
  // El inicio de semana y de mes dependen de «hoy»: se recalculan con la fecha simulada.
  await page.evaluate(() => { delete window.__x; });
  await page.evaluate((id) => window.EVE_MODULES[id].render(document.getElementById('main-content')), m.id);
  page.erroresPagina = errores;
  return page;
}

const botonesTab = (page) => page.$$eval('.destaraje-subtabs .tab', (bs) => bs.map((b) => b.textContent.trim()));
const filasDe = (page) => page.$$eval('#main-content table tbody tr', (rs) => rs.filter((r) => r.cells.length > 2 && !/Sin registros/.test(r.textContent)).length);

for (const m of MODULOS) {
  caso(`${m.nombre}: pestaña «Últimos 30 días» justo después de Este Mes, filtra con los bordes y el encabezado coincide con la lista`, async (browser) => {
    const page = await montar(browser, m);
    const tabs = await botonesTab(page);
    const i = tabs.indexOf('Este Mes');
    afirmar(i >= 0 && tabs[i + 1] === 'Últimos 30 días', `orden de pestañas: ${tabs.join(' | ')}`);
    afirmar(tabs[0] === 'Hoy', 'la pestaña por defecto no cambia (sigue siendo Hoy)');
    // Este Mes no cambia: hoy y mañana (sin tope superior).
    await page.locator('.destaraje-subtabs .tab', { hasText: 'Este Mes' }).first().click();
    const filasMes = await filasDe(page);
    igual(filasMes, 2, 'Este Mes (hoy y mañana, como siempre)');
    await page.locator('.destaraje-subtabs .tab', { hasText: 'Últimos 30 días' }).click();
    igual(await filasDe(page), 3, 'Últimos 30 días: hoy, hoy−29 y el 31 de octubre (hoy−30 y mañana quedan fuera)');
    if (m.stats) {
      const texto = (await page.textContent(m.stats)).replace(/\s+/g, ' ');
      const n = (texto.match(/(?:Registros|Tickets|Ventas|Cobros|Pagos)[^0-9]{0,4}(\d+)/) || [])[1];
      afirmar(n === '3', `el conteo del encabezado coincide con la lista (3): «${texto}»`);
    }
    igual(await page.evaluate(() => window.__errores || []), [], 'sin errores en pantalla');
    igual(page.erroresPagina, [], 'sin errores de JavaScript');
    await page.close();
  });
}

caso('Flujo: el saldo acumulado de «Últimos 30 días» es el mismo acumulado que en Este Mes (no se reinicia en la ventana)', async (browser) => {
  const m = MODULOS.find((x) => x.id === 'flujo');
  const page = await montar(browser, m);
  await page.locator('.destaraje-subtabs .tab', { hasText: 'Este Mes' }).first().click();
  const saldoMes = await page.$$eval('#flujo-tabla tr', (rs) => rs.map((r) => (r.cells[7] ? r.cells[7].textContent.trim() : '')).filter(Boolean));
  await page.locator('.destaraje-subtabs .tab', { hasText: 'Últimos 30 días' }).click();
  const saldo30 = await page.$$eval('#flujo-tabla tr', (rs) => rs.map((r) => (r.cells[7] ? r.cells[7].textContent.trim() : '')).filter(Boolean));
  afirmar(saldo30.length === 3, 'tres movimientos en 30 días: ' + saldo30);
  igual(saldoMes.length, 2, 'Este Mes sigue con sus 2');
  const acum = await page.$$eval('#flujo-tabla tr', (rs) => rs.map((r) => [r.cells[0] && r.cells[0].textContent.trim(), r.cells[7] && r.cells[7].textContent.trim()]).filter((x) => x[0]));
  const porFecha = Object.fromEntries(acum);
  // El movimiento del 3 de octubre (hoy−30) no se lista, pero SÍ está en el saldo: el 4/10 ya muestra $200 (acumulado desde el 1 de octubre).
  igual(porFecha, { '04/10/2026': '$200.00', '31/10/2026': '$300.00', '02/11/2026': '$400.00' }, 'saldo acumulado desde el 1 de octubre, igual que en Este Mes');
  await page.close();
});

caso('CxC: Por Cliente y Todos tienen la pestaña; el rango incluye ambos bordes y los totales del encabezado coinciden con la lista', async (browser) => {
  const cuenta = (c, f) => ({ id: 'c_' + c, ventaId: 'v_' + c, cliente: 'CLI_' + c.toUpperCase(), folio: 'V-' + c, material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: 10, total: 100, pagado: 0, saldo: 100, estado: 'pendiente', fechaVenta: f, abonos: [], abonosRevertidos: [] });
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => { window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } }; window.EVE_MODULES = {}; });
  for (const s of [...SCRIPTS_BASE, 'js/cxp.js', 'js/saldo-clientes.js', 'js/cxc.js']) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, hoy }) => {
    window.obtenerFechaMexico = () => hoy;
    window.puedeEscribir = () => false; window.puedeLeer = () => true; window.showError = () => {}; window.EVE_HISTORIAL = { registrar: () => {} };
    window.EVE = { currentUser: { username: 'p' }, cuentasPorCobrar: cs, clientes: [], cobros: [], ventas: [], registrosVentas: [], proveedores: [] };
    window.EVE_MODULES.cxc.render(document.getElementById('main-content'));
  }, { cs: Object.entries(D).map(([c, f]) => cuenta(c, f)), hoy: HOY });
  // Por Cliente: subpestañas de periodo.
  const tabsCliente = await page.$$eval('#cxc-tabs-periodo-cliente .tab', (bs) => bs.map((b) => b.textContent.trim()));
  igual(tabsCliente, ['Hoy', 'Esta Semana', 'Este Mes', 'Últimos 30 días', 'Todos'], 'Por Cliente: orden de pestañas');
  await page.locator('#cxc-tabs-periodo-cliente .tab', { hasText: 'Últimos 30 días' }).click();
  const tarjetas = await page.$$eval('#cxc-clientes-contenido h3', (hs) => hs.map((h) => h.textContent.trim()).sort());
  igual(tarjetas, ['CLI_BORDE29', 'CLI_HOY', 'CLI_MESANTERIOR'], 'Por Cliente: clientes con CxC dentro de la ventana');
  const total30 = (await page.textContent('#cxc-resumen-general')).replace(/\s+/g, ' ');
  afirmar(total30.includes('Total Últimos 30 días: $300.00'), 'el encabezado suma lo mismo que la lista: ' + total30);
  // Todos: subpestañas.
  await page.locator('#cxc-tabs-principales .tab', { hasText: 'Todos' }).click();
  const tabsTodos = await page.$$eval('#cxc-todos-wrapper > .tabs .tab', (bs) => bs.map((b) => b.textContent.trim()));
  igual(tabsTodos, ['Hoy', 'Esta Semana', 'Este Mes', 'Últimos 30 días', 'Personalizado'], 'Todos: orden de pestañas');
  await page.locator('#cxc-todos-wrapper > .tabs .tab', { hasText: 'Últimos 30 días' }).click();
  const folios = await page.$$eval('#cxc-tabla-cuentas-todas > tr', (rs) => rs.filter((r) => r.cells.length > 2).map((r) => r.cells[0].textContent.trim()).sort());
  igual(folios, ['V-borde29', 'V-hoy', 'V-mesAnterior'], 'Todos: hoy, hoy−29 y el 31 de octubre (no hoy−30 ni mañana)');
  igual(await page.$eval('#cxc-tabs-principales .tab.active', (b) => b.textContent.trim()), 'Todos', 'la vista principal es la que se eligió');
  igual(errores, [], 'sin errores de JavaScript');
  await page.close();
});

caso('CxP Por Proveedor: pestaña después de Este Mes; la barra de «Todos» (sin Hoy) no se modifica', async (browser) => {
  const cuenta = (c, f) => ({ id: 'c_' + c, proveedor: 'PROV_' + c.toUpperCase(), ticket: 'T' + c, material: 'PET', kg: 10, precioEfectivo: 10, total: 100, iva: 0, pagado: 0, saldo: 100, estado: 'pendiente', fechaTicket: f, abonos: [] });
  const page = await browser.newPage();
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => { window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } }; window.EVE_MODULES = {}; });
  for (const s of [...SCRIPTS_BASE, 'js/cxp.js']) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, hoy }) => {
    window.obtenerFechaMexico = () => hoy;
    window.puedeEscribir = () => false; window.puedeLeer = () => true; window.showError = () => {}; window.EVE_HISTORIAL = { registrar: () => {} };
    window.EVE = { currentUser: { username: 'p', permisosResueltos: {} }, cuentasPorPagar: cs, proveedores: [], registrosDestaraje: [], registrosVentas: [], registrosPagos: [], ventas: [], precios: [], composiciones: [], recibosPendientes: [], auditorias: [], metaPiezasDia: {} };
    window.EVE_MODULES.cxp.render(document.getElementById('main-content'));
  }, { cs: Object.entries(D).map(([c, f]) => cuenta(c, f)), hoy: HOY });
  const rangos = await page.evaluate(() => ({
    ultimos30: window.EVE_CXP.calcularRangoPeriodoCxP('ultimos30'), mes: window.EVE_CXP.calcularRangoPeriodoCxP('mes')
  }));
  igual(rangos, { ultimos30: { desde: '2026-10-04', hasta: '2026-11-02' }, mes: { desde: '2026-11-01', hasta: null } }, 'rangos de CxP');
  const tabs = await page.$$eval('.destaraje-subtabs .tab', (bs) => bs.map((b) => b.textContent.trim()));
  const i = tabs.indexOf('Este Mes');
  afirmar(tabs[i + 1] === 'Últimos 30 días', 'Por Proveedor: orden ' + tabs.join('|'));
  await page.locator('.destaraje-subtabs .tab', { hasText: 'Últimos 30 días' }).click();
  const tarjetas = await page.$$eval('#cxp-proveedores-contenido h3', (hs) => hs.map((h) => h.textContent.trim()).sort()).catch(() => []);
  if (tarjetas.length) igual(tarjetas, ['PROV_BORDE29', 'PROV_HOY', 'PROV_MESANTERIOR'], 'proveedores con cuentas dentro de la ventana');
  // La barra de «Todos» de CxP no tiene Hoy: queda como estaba.
  const src = fs.readFileSync(path.join(RAIZ, 'js/cxp.js'), 'utf8').replace(/\r\n/g, '\n');
  const iTodos = src.indexOf("nav.id = 'cxp-tabs-todos';");
  afirmar(!src.slice(iTodos, iTodos + 400).includes('ultimos30'), 'la barra de Todos de CxP (Esta Semana / Este Mes / Todos) no se modificó');
  igual(errores, [], 'sin errores de JavaScript');
  await page.close();
});

caso('Reportes: la barra de periodo (Hoy / Esta Semana / Este Mes / Personalizado) también trae Últimos 30 días con el rango correcto', () => {
  const ui = leer('js/reportes-ui.js').replace(/\r\n/g, '\n');
  afirmar(ui.includes("{ id: 'mes', nombre: 'Este Mes' },\n    { id: 'ultimos30', nombre: 'Últimos 30 días' },\n    { id: 'personalizado', nombre: 'Personalizado' }"), 'pestaña en Reportes');
  afirmar(ui.includes('window.obtenerRangoYEtiqueta(tabActivaReportes'), 'Reportes usa el mismo helper de rango');
});

caso('el helper de rango es el único lugar donde se calcula la ventana (sin copias por módulo)', () => {
  const archivos = fs.readdirSync(path.join(RAIZ, 'js')).filter((f) => f.endsWith('.js'));
  const copias = archivos.filter((f) => /-\s*29\)/.test(leer('js/' + f)));
  igual(copias, ['utils.js'], 'solo utils.js resta 29 días');
});

(async () => {
  const browser = await chromium.launch();
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(browser); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
