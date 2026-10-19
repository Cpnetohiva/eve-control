// Prueba de la pantalla de Recibos de dinero en Chromium (Playwright) con los JS y el CSS reales y un Firestore simulado
// (scripts/db-simulada.js): permisos, formulario (importe con letra y resumen de la operación en vivo, solo en Anticipo),
// validación, emisión con folio, autocompletado de clientes, lista con búsqueda, filtros y totales, vista de solo lectura,
// cancelación con motivo (estado final, sin botón de eliminar) y móvil sin desbordes.
//
// Uso: node scripts/verificar-recibos-dinero-pantalla.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');
const { crearDbSimulada } = require('./db-simulada');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/cotizaciones.js', 'js/cotizaciones-pdf.js', 'js/recibosdinero.js'];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const ya = (extra) => ({
  tipo: 'Anticipo', cliente: { nombre: 'AMERICA ALVAREZ SANCHEZ', rfc: 'AAA010101AAA', domicilio: 'San Luis Potosí, S.L.P.' },
  clienteNormalizado: 'america alvarez sanchez', fecha: '2026-10-16', importe: 30000, moneda: 'MXN', importeLetra: 'TREINTA MIL PESOS 00/100 MN',
  formaPago: 'Transferencia', referencia: 'SPEI 1', concepto: 'Anticipo por 400 tambos', pedidoReferencia: '', resumen: null,
  folio: 'RD-16102026-001', estado: 'Emitido', creadoPor: 'ventas1', fechaRegistro: '2026-10-16T15:00:00.000Z',
  historialEstados: [{ de: null, a: 'Emitido', usuario: 'ventas1', fecha: '2026-10-16T15:00:00.000Z' }], ...extra
});

// `permisos`: permisos del usuario; `recibos`: documentos que ya están en el servidor simulado y en memoria.
async function nuevaPagina(browser, { permisos = { recibosDinero: 'escritura' }, recibos = [], ancho = 1280 } = {}) {
  const page = await browser.newPage({ viewport: { width: ancho, height: 900 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="toast-container"></div><div id="main-content"></div></body></html>');
  await page.addStyleTag({ path: path.join(RAIZ, 'css/styles.css') });
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  // config.js crea el db real al cargarse: el simulado se instala DESPUÉS de cargar los scripts.
  await page.evaluate(([crearDb, permisosUsuario, docs, fecha]) => {
    // eval a propósito: inyecta en la página el texto de crearDbSimulada (código local de prueba, autocontenido; no hay datos externos).
    window.db = (0, eval)(`(${crearDb})()`);
    docs.forEach((d) => { const { id, ...datos } = d; window.db.docs.set(`recibos_dinero/${id}`, { datos, version: 1 }); });
    window.obtenerFechaMexico = () => fecha;
    window.EVE = { currentUser: { username: 'ventas1', permisosResueltos: permisosUsuario }, recibosDinero: docs.map((d) => ({ ...d })), clientesCotizacion: [{ razonSocial: 'Plásticos del Norte', direccion: 'Av. Norte 1' }] };
    window.__prompt = null;
    window.prompt = () => window.__prompt;
    window.EVE_MODULES.recibosDinero.render(document.getElementById('main-content'));
  }, [crearDbSimulada.toString(), permisos, recibos, '2026-10-16']);
  page.erroresPagina = errores;
  return page;
}

const llenar = async (page, clave, valor) => { await page.fill(`[data-campo="${clave}"]`, valor); };
const filasLista = (page) => page.$$eval('#modulo-recibosdinero tbody tr[data-id]', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));
const texto = (page, selector) => page.$eval(selector, (n) => n.textContent.trim());

async function capturar(page, extra = {}) {
  await llenar(page, 'cliente.nombre', extra.cliente || 'Cliente de Prueba SA');
  await llenar(page, 'importe', extra.importe || '30000');
  await llenar(page, 'concepto', extra.concepto || 'Anticipo por compra de tambos');
}

caso('permisos: con escritura hay "+ Nuevo recibo de dinero"; con solo lectura se ve la lista pero no se crea ni se cancela', async (browser) => {
  const conEscritura = await nuevaPagina(browser, { recibos: [ya({ id: 'r1' })] });
  afirmar(await conEscritura.$('text=+ Nuevo recibo de dinero'), 'botón de alta para escritura');
  afirmar(await conEscritura.$('text=Cancelar recibo'), 'botón de cancelar para escritura');
  await conEscritura.close();
  const soloLectura = await nuevaPagina(browser, { permisos: { recibosDinero: 'lectura' }, recibos: [ya({ id: 'r1' })] });
  igual(await soloLectura.$('text=+ Nuevo recibo de dinero'), null, 'sin botón de alta en lectura');
  igual(await soloLectura.$('text=Cancelar recibo'), null, 'sin botón de cancelar en lectura');
  igual((await filasLista(soloLectura)).length, 1, 'pero la lista sí se ve');
  afirmar(await soloLectura.$('text=Ver'), 'y se puede abrir en solo lectura');
  await soloLectura.close();
});

caso('formulario nuevo: valores por omisión (Anticipo, hoy, MXN) e importe con letra en vivo, también en dólares', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.click('text=+ Nuevo recibo de dinero');
  igual(await page.$eval('[data-campo="tipo"]', (n) => n.value), 'Anticipo', 'tipo por omisión');
  igual(await page.$eval('[data-campo="fecha"]', (n) => n.value), '16/10/2026', 'fecha de hoy');
  igual(await page.$eval('[data-campo="moneda"]', (n) => n.value), 'MXN', 'moneda por omisión');
  igual(await page.$$eval('[data-campo="tipo"] option', (o) => o.map((x) => x.textContent)), ['Anticipo / pago a cuenta', 'Pago de contado'], 'tipos');
  igual(await page.$$eval('[data-campo="formaPago"] option', (o) => o.map((x) => x.value)), ['Efectivo', 'Transferencia', 'Cheque', 'Otro'], 'formas de pago');
  igual(await page.$eval('[data-campo="importeLetra"]', (n) => n.value), '', 'sin importe no hay letra');
  await llenar(page, 'importe', '30000');
  igual(await page.$eval('[data-campo="importeLetra"]', (n) => n.value), 'TREINTA MIL PESOS 00/100 MN', 'letra en vivo');
  afirmar(await page.$eval('[data-campo="importeLetra"]', (n) => n.readOnly), 'el importe con letra no se escribe a mano');
  await llenar(page, 'importe', '1234.56');
  igual(await page.$eval('[data-campo="importeLetra"]', (n) => n.value), 'UN MIL DOSCIENTOS TREINTA Y CUATRO PESOS 56/100 MN', 'centavos');
  await page.selectOption('[data-campo="moneda"]', 'USD');
  igual(await page.$eval('[data-campo="importeLetra"]', (n) => n.value), 'UN MIL DOSCIENTOS TREINTA Y CUATRO DÓLARES 56/100 USD', 'dólares');
  await llenar(page, 'importe', '10.123');
  igual(await page.$eval('[data-campo="importeLetra"]', (n) => n.value), '', 'un importe inválido no genera letra');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('resumen de la operación: solo en Anticipo; varias partidas; total de la operación y saldo pendiente se calculan solos', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.click('text=+ Nuevo recibo de dinero');
  afirmar(await page.isVisible('.rd-resumen'), 'visible en Anticipo');
  await llenar(page, 'importe', '30000');
  const fila = (i, campo) => `.cot-partida:nth-of-type(${i}) [data-f="${campo}"]`;
  await page.fill(fila(1, 'descripcion'), 'TAMBO NUEVO 200 LTS HDPE REPROCESO');
  await page.fill(fila(1, 'cantidad'), '400');
  await page.fill(fila(1, 'precioUnitario'), '265');
  igual(await texto(page, '.cot-partida:nth-of-type(1) .cot-importe'), '$106,000.00', 'importe de la partida');
  igual([await texto(page, '[data-total="totalOperacion"]'), await texto(page, '[data-total="importeRecibido"]'), await texto(page, '[data-total="saldoPendiente"]')], ['$106,000.00', '$30,000.00', '$76,000.00'], 'una partida');
  await page.click('text=+ Agregar partida');
  await page.fill(fila(2, 'descripcion'), 'TAPA');
  await page.fill(fila(2, 'cantidad'), '400');
  await page.fill(fila(2, 'precioUnitario'), '12.5');
  igual([await texto(page, '[data-total="totalOperacion"]'), await texto(page, '[data-total="saldoPendiente"]')], ['$111,000.00', '$81,000.00'], 'dos partidas');
  await llenar(page, 'importe', '50000');
  igual(await texto(page, '[data-total="saldoPendiente"]'), '$61,000.00', 'el saldo sigue al importe recibido');
  await page.selectOption('[data-campo="tipo"]', 'Pago de contado');
  afirmar(!(await page.isVisible('.rd-resumen')), 'oculto en Pago de contado');
  await page.selectOption('[data-campo="tipo"]', 'Anticipo');
  afirmar(await page.isVisible('.rd-resumen'), 'vuelve en Anticipo');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('validación: campos obligatorios se marcan y no se guarda nada; un importe mayor al total de la operación se rechaza', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.click('text=+ Nuevo recibo de dinero');
  await page.click('text=Emitir recibo');
  const marcados = await page.$$eval('.campo-invalido', (n) => n.map((x) => x.dataset.campo));
  igual(marcados, ['cliente.nombre', 'importe', 'concepto'], 'campos obligatorios marcados');
  igual(await page.evaluate(() => window.db.docs.size), 0, 'no se escribió nada');
  await capturar(page);
  await page.fill('.cot-partida [data-f="descripcion"]', 'TAMBO');
  await page.fill('.cot-partida [data-f="cantidad"]', '1');
  await page.fill('.cot-partida [data-f="precioUnitario"]', '100');
  await page.click('text=Emitir recibo');
  igual(await page.$$eval('.campo-invalido', (n) => n.map((x) => x.dataset.campo)), ['importe'], 'importe mayor al total (30,000 > 100)');
  igual(await page.evaluate(() => window.db.docs.size), 0, 'tampoco se escribió');
  await page.close();
});

caso('emitir: guarda con folio RD-DDMMAAAA-001 y 002, cierra el formulario, aparece en la lista y no toca otros datos', async (browser) => {
  const page = await nuevaPagina(browser);
  // Esta prueba emite dos recibos seguidos a propósito: sin enfriamiento para que el segundo no lo rechace la protección de doble registro.
  await page.evaluate(() => { window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = 0; });
  await page.evaluate(() => {
    ['cobros/c1', 'cuentas_por_cobrar/q1', 'flujo_movimientos/f1'].forEach((r) => window.db.docs.set(r, { datos: { saldo: 1 }, version: 1 }));
  });
  await page.click('text=+ Nuevo recibo de dinero');
  await capturar(page, { importe: '30000' });
  await page.fill('.cot-partida [data-f="descripcion"]', 'TAMBO NUEVO');
  await page.fill('.cot-partida [data-f="cantidad"]', '400');
  await page.fill('.cot-partida [data-f="precioUnitario"]', '265');
  await page.click('text=Emitir recibo');
  await page.waitForSelector('#modulo-recibosdinero tbody tr[data-id]');
  afirmar(!(await page.$('.cot-form')), 'el formulario se cierra al emitir');
  let filas = await filasLista(page);
  igual([filas[0][0], filas[0][1], filas[0][2], filas[0][3], filas[0][4], filas[0][5]], ['RD-16102026-001', '16/10/2026', 'Cliente de Prueba SA', 'Anticipo / pago a cuenta', '$30,000.00 MXN', 'Emitido'], 'fila nueva');
  await page.click('text=+ Nuevo recibo de dinero');
  await capturar(page, { importe: '500' });
  await page.selectOption('[data-campo="tipo"]', 'Pago de contado');
  await page.click('text=Emitir recibo');
  await page.waitForFunction(() => document.querySelectorAll('#modulo-recibosdinero tbody tr[data-id]').length === 2);
  filas = await filasLista(page);
  igual(filas.map((f) => f[0]), ['RD-16102026-002', 'RD-16102026-001'], 'más reciente primero, folio consecutivo');
  const guardado = await page.evaluate(() => Array.from(window.db.docs.entries()).filter(([r]) => r.startsWith('recibos_dinero/')).map(([, d]) => d.datos));
  igual(guardado.map((d) => [d.tipo, d.estado, d.resumen && d.resumen.saldoPendiente]), [['Anticipo', 'Emitido', 76000], ['Pago de contado', 'Emitido', null]], 'datos guardados (saldo pendiente solo en Anticipo)');
  igual(await page.evaluate(() => ['cobros/c1', 'cuentas_por_cobrar/q1', 'flujo_movimientos/f1'].map((r) => window.db.docs.get(r).version)), [1, 1, 1], 'cobros, CxC y Flujo intactos');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('autocompletado de "Recibimos de": ofrece clientes de recibos anteriores y de Cotizaciones, y rellena RFC y domicilio sin pisar lo escrito', async (browser) => {
  const page = await nuevaPagina(browser, { recibos: [ya({ id: 'r1' })] });
  await page.click('text=+ Nuevo recibo de dinero');
  igual(await page.$$eval('#rd-clientes-lista option', (o) => o.map((x) => x.value)), ['AMERICA ALVAREZ SANCHEZ', 'Plásticos del Norte'], 'opciones del datalist');
  await page.fill('[data-campo="cliente.nombre"]', 'america alvarez sanchez');
  await page.dispatchEvent('[data-campo="cliente.nombre"]', 'change');
  igual([await page.$eval('[data-campo="cliente.rfc"]', (n) => n.value), await page.$eval('[data-campo="cliente.domicilio"]', (n) => n.value)], ['AAA010101AAA', 'San Luis Potosí, S.L.P.'], 'cliente conocido rellena');
  await page.fill('[data-campo="cliente.nombre"]', 'Plásticos del Norte');
  await page.dispatchEvent('[data-campo="cliente.nombre"]', 'change');
  igual(await page.$eval('[data-campo="cliente.domicilio"]', (n) => n.value), 'San Luis Potosí, S.L.P.', 'no pisa un domicilio ya escrito');
  await page.fill('[data-campo="cliente.nombre"]', 'Cliente Nuevo Libre');
  await page.dispatchEvent('[data-campo="cliente.nombre"]', 'change');
  igual(await page.$eval('[data-campo="cliente.nombre"]', (n) => n.value), 'Cliente Nuevo Libre', 'la captura es libre');
  await page.close();
});

caso('lista: búsqueda por folio o cliente, filtros por tipo, estado y fechas, y resumen por estado y moneda', async (browser) => {
  const recibos = [
    ya({ id: 'r1' }),
    ya({ id: 'r2', folio: 'RD-10102026-001', fecha: '2026-10-10', tipo: 'Pago de contado', cliente: { nombre: 'PLASTICOS DEL NORTE', rfc: '', domicilio: '' }, clienteNormalizado: 'plasticos del norte', importe: 500, moneda: 'USD' }),
    ya({ id: 'r3', folio: 'RD-01102026-001', fecha: '2026-10-01', estado: 'Cancelado', importe: 1000, cliente: { nombre: 'OTRO CLIENTE', rfc: '', domicilio: '' }, clienteNormalizado: 'otro cliente', motivoCancelacion: 'duplicado' })
  ];
  const page = await nuevaPagina(browser, { recibos });
  const folios = async () => (await filasLista(page)).map((f) => f[0]);
  igual(await folios(), ['RD-16102026-001', 'RD-10102026-001', 'RD-01102026-001'], 'sin filtros, más reciente primero');
  await page.fill('[data-campo="filtro.buscar"]', 'plásticos');
  igual(await folios(), ['RD-10102026-001'], 'cliente con acento');
  await page.fill('[data-campo="filtro.buscar"]', 'rd-0110');
  igual(await folios(), ['RD-01102026-001'], 'parte del folio');
  await page.fill('[data-campo="filtro.buscar"]', '');
  await page.selectOption('[data-campo="filtro.tipo"]', 'Pago de contado');
  igual(await folios(), ['RD-10102026-001'], 'tipo');
  await page.selectOption('[data-campo="filtro.tipo"]', '');
  await page.selectOption('[data-campo="filtro.estado"]', 'Cancelado');
  igual(await folios(), ['RD-01102026-001'], 'estado');
  await page.selectOption('[data-campo="filtro.estado"]', '');
  await page.fill('[data-campo="filtro.desde"]', '05/10/2026');
  await page.fill('[data-campo="filtro.hasta"]', '12/10/2026');
  igual(await folios(), ['RD-10102026-001'], 'rango de fechas');
  await page.fill('[data-campo="filtro.hasta"]', '31/02/2026');
  afirmar((await page.$eval('[data-error="filtro.hasta"]', (n) => n.textContent)).includes('no válida'), 'fecha inválida se marca');
  await page.fill('[data-campo="filtro.desde"]', '');
  await page.fill('[data-campo="filtro.hasta"]', '');
  const resumen = await page.$$eval('.cot-resumen-item', (n) => n.map((x) => Array.from(x.children).map((s) => s.textContent.trim())));
  igual(resumen, [['Emitido', '2 · $30,000.00 MXN + $500.00 USD'], ['Cancelado', '1 · $1,000.00 MXN']], 'resumen por estado, sin mezclar monedas');
  await page.fill('[data-campo="filtro.buscar"]', 'no existe');
  igual((await page.$$eval('#modulo-recibosdinero tbody td', (t) => t.map((x) => x.textContent.trim())))[0], 'Sin recibos de dinero', 'mensaje de lista vacía');
  await page.close();
});

caso('Ver: abre el recibo en solo lectura (campos deshabilitados, resumen visible solo si lo tiene), con botón PDF y sin eliminar', async (browser) => {
  const conResumen = ya({ id: 'r1', resumen: { partidas: [{ descripcion: 'TAMBO', cantidad: 400, unidad: 'PZ', precioUnitario: 265, importe: 106000 }], totalOperacion: 106000, importeRecibido: 30000, saldoPendiente: 76000 } });
  const sinResumen = ya({ id: 'r2', folio: 'RD-15102026-001', tipo: 'Pago de contado' });
  const page = await nuevaPagina(browser, { recibos: [conResumen, sinResumen] });
  await page.click('tr[data-id="r1"] >> text=Ver');
  igual(await texto(page, '.cot-form .cot-titulo'), 'Recibo de dinero RD-16102026-001', 'título con el folio');
  afirmar(await page.$$eval('.cot-form input, .cot-form select, .cot-form textarea', (c) => c.every((x) => x.disabled)), 'todos los campos deshabilitados');
  afirmar(await page.isVisible('.rd-resumen'), 'resumen visible');
  igual([await texto(page, '[data-total="totalOperacion"]'), await texto(page, '[data-total="saldoPendiente"]')], ['$106,000.00', '$76,000.00'], 'totales del resumen guardado');
  igual(await page.$eval('[data-campo="importeLetra"]', (n) => n.value), 'TREINTA MIL PESOS 00/100 MN', 'importe con letra');
  igual(await page.$('text=Emitir recibo'), null, 'no se puede guardar un recibo ya emitido');
  igual(await page.$('text=Eliminar'), null, 'sin eliminar');
  afirmar(await page.$('.cot-form button.cot-pdf'), 'el detalle tiene botón PDF');
  await page.click('.cot-form >> text=Cerrar');
  afirmar(!(await page.$('.cot-form')), 'Cerrar quita el formulario');
  await page.click('tr[data-id="r2"] >> text=Ver');
  afirmar(!(await page.isVisible('.rd-resumen')), 'un Pago de contado no muestra resumen');
  igual(await page.$('text=Eliminar'), null, 'sin eliminar en ninguna parte');
  await page.close();
});

caso('cancelar: pide motivo (obligatorio), pasa a Cancelado conservando folio e importes, queda sin botones y no se puede deshacer', async (browser) => {
  const page = await nuevaPagina(browser, { recibos: [ya({ id: 'r1' })] });
  await page.evaluate(() => { window.db.docs.set('cuentas_por_cobrar/q1', { datos: { saldo: 1 }, version: 1 }); });
  await page.evaluate(() => { window.__prompt = null; });
  await page.click('tr[data-id="r1"] >> text=Cancelar recibo');
  igual(await page.evaluate(() => window.db.docs.get('recibos_dinero/r1').datos.estado), 'Emitido', 'prompt cancelado: no pasa nada');
  await page.evaluate(() => { window.__prompt = '   '; });
  await page.click('tr[data-id="r1"] >> text=Cancelar recibo');
  igual(await page.evaluate(() => window.db.docs.get('recibos_dinero/r1').datos.estado), 'Emitido', 'sin motivo no cancela');
  await page.evaluate(() => { window.__prompt = 'Cliente desistió de la compra'; });
  await page.click('tr[data-id="r1"] >> text=Cancelar recibo');
  await page.waitForSelector('tr[data-id="r1"] .cot-estado-cancelada');
  const doc = await page.evaluate(() => window.db.docs.get('recibos_dinero/r1').datos);
  igual([doc.estado, doc.folio, doc.importe, doc.motivoCancelacion], ['Cancelado', 'RD-16102026-001', 30000, 'Cliente desistió de la compra'], 'documento cancelado con folio e importe intactos');
  igual((await filasLista(page))[0][5], 'Cancelado', 'la lista lo muestra');
  igual(await page.$('tr[data-id="r1"] >> text=Cancelar recibo'), null, 'ya no se puede cancelar');
  igual(await page.evaluate(() => window.db.docs.get('cuentas_por_cobrar/q1').version), 1, 'CxC intacta');
  await page.click('tr[data-id="r1"] >> text=Ver');
  afirmar((await texto(page, '.rd-aviso-cancelado')).includes('Cliente desistió de la compra'), 'el aviso de cancelación muestra el motivo');
  igual(await page.$('.cot-form >> text=Cancelar recibo'), null, 'sin cancelar otra vez desde el detalle');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('cancelar desde el detalle de un recibo Emitido: usa el mismo motivo obligatorio y cierra el formulario', async (browser) => {
  const page = await nuevaPagina(browser, { recibos: [ya({ id: 'r1' })] });
  await page.click('tr[data-id="r1"] >> text=Ver');
  await page.evaluate(() => { window.__prompt = 'Error de captura'; });
  await page.click('.cot-form >> text=Cancelar recibo');
  await page.waitForSelector('tr[data-id="r1"] .cot-estado-cancelada');
  afirmar(!(await page.$('.cot-form')), 'el formulario se cierra tras cancelar');
  igual(await page.evaluate(() => window.db.docs.get('recibos_dinero/r1').datos.motivoCancelacion), 'Error de captura', 'motivo guardado');
  await page.close();
});

caso('móvil (375 px): formulario y lista sin desbordes horizontales', async (browser) => {
  const page = await nuevaPagina(browser, { ancho: 375, recibos: [ya({ id: 'r1' })] });
  const sinDesborde = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  afirmar(await sinDesborde(), 'la lista no desborda');
  await page.click('text=+ Nuevo recibo de dinero');
  afirmar(await sinDesborde(), 'el formulario no desborda');
  await page.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message.split('\n')[0]}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
