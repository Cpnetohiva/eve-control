// Prueba en Chromium (Playwright) del "Abono a saldo inicial" de Pagos con los JS reales y un Firestore simulado que anota cada
// escritura: el checkbox oculta ticket/material/kg/precio y exige solo proveedor, monto mayor a 0 y fecha; el pago se guarda con
// abonoSaldoInicial, ticket 'SALDO INICIAL', material 'ABONO A SALDO INICIAL', kg 0 y total 0; no toca ninguna CxP ni genera saldo
// a favor aunque el proveedor tenga cuentas pendientes; sin el checkbox el formulario se comporta igual que antes.
//
// Uso: node scripts/verificar-pagos-saldo-inicial.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const FECHA = '2026-10-16';
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/reportes.js', 'js/voz.js', 'js/historial.js', 'js/cxp.js', 'js/pagos.js', 'js/flujo.js'];

const CXP = () => ({
  id: 'cxp1', proveedor: 'PROVEEDOR DE PRUEBA', ticket: 'T1', material: 'MIXTO', kg: 100, precioEfectivo: 10, total: 1000, iva: 0,
  pagado: 0, saldo: 1000, estado: 'pendiente', abonos: [], fechaEntrada: FECHA
});

const PREPARAR_DB = () => {
  let auto = 0;
  window.__escrituras = [];
  const consulta = () => ({ where: () => consulta(), orderBy: () => consulta(), limit: () => consulta(), get: async () => ({ docs: [], forEach() {}, size: 0, empty: true }) });
  const ref = (coleccion, id) => ({
    id,
    get: async () => ({ exists: false, id, data: () => undefined }),
    set: async (datos) => { window.__escrituras.push({ coleccion, id, datos }); },
    update: async (datos) => { window.__escrituras.push({ coleccion, id, datos }); },
    delete: async () => { window.__escrituras.push({ coleccion, id, borrado: true }); }
  });
  window.db = {
    collection: (coleccion) => ({
      doc: (id) => ref(coleccion, id === undefined ? `auto${++auto}` : id),
      add: async (datos) => { const id = `auto${++auto}`; window.__escrituras.push({ coleccion, id, datos }); return { id }; },
      ...consulta()
    }),
    async runTransaction(fn) { return fn({ get: async () => ({ exists: false, data: () => undefined }), set() {}, update() {}, delete() {} }); }
  };
};

async function paginaNueva(browser, { pagos = [], cuentas = [CXP()] } = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="toast-container"></div><div id="main-content"></div></body></html>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.firebase.firestore.FieldValue = { delete: () => '__borrar_campo__' };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(PREPARAR_DB);
  await page.evaluate(([cuentasPorPagar, registrosPagos, fecha]) => {
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: { pagos: 'escritura', cxp: 'escritura' } },
      registrosDestaraje: [], registrosPagos, registrosMinistraciones: [], cuentasPorPagar, proveedores: [], precios: [], ventas: [], registrosVentas: []
    };
    window.obtenerFechaMexico = () => fecha;
    window.confirm = () => true;
    window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = 0;
    window.EVE_MODULES.pagos.render(document.getElementById('main-content'));
  }, [cuentas, pagos, FECHA]);
  page.erroresPagina = errores;
  return page;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const escrituras = (page) => page.evaluate(() => window.__escrituras);
const visible = (page, selector) => page.isVisible(selector);
const enviar = (page) => page.evaluate(() => document.getElementById('pagos-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
const errorMostrado = (page) => page.evaluate(() => [...document.querySelectorAll('.toast-error')].map((t) => t.textContent));

async function llenarAbono(page, { proveedor = 'PROVEEDOR DE PRUEBA', pagado = '1500', nota = '' } = {}) {
  await page.check('#pg-saldo-inicial');
  await page.fill('#pg-proveedor', proveedor);
  await page.fill('#pg-pagado', pagado);
  await page.fill('#pg-fecha', FECHA);
  await page.fill('#pg-nota', nota);
}

caso('construirRegistroDesdeFormulario: abono marcado exige solo proveedor, fecha y monto mayor a 0; los pagos normales siguen igual', async (browser) => {
  const page = await paginaNueva(browser);
  const r = await page.evaluate(() => {
    const f = window.EVE_PAGOS.construirRegistroDesdeFormulario;
    const falla = (datos) => { try { f(datos); return null; } catch (e) { return e.message; } };
    return {
      ok: f({ abonoSaldoInicial: true, proveedor: 'proveedor de prueba', pagado: '250.5', fecha: '2026-10-16', ticket: 'X', material: 'Y', kg: '9', precioPorKg: '9' }),
      sinProveedor: falla({ abonoSaldoInicial: true, proveedor: '', pagado: '10', fecha: '2026-10-16' }),
      sinFecha: falla({ abonoSaldoInicial: true, proveedor: 'A', pagado: '10', fecha: '' }),
      cero: falla({ abonoSaldoInicial: true, proveedor: 'A', pagado: '0', fecha: '2026-10-16' }),
      negativo: falla({ abonoSaldoInicial: true, proveedor: 'A', pagado: '-5', fecha: '2026-10-16' }),
      vacio: falla({ abonoSaldoInicial: true, proveedor: 'A', pagado: '', fecha: '2026-10-16' }),
      normalSinTicket: falla({ proveedor: 'A', material: 'MIXTO', kg: '10', precioPorKg: '5', pagado: '50', fecha: '2026-10-16' }),
      normal: f({ ticket: 'T9', proveedor: 'A', material: 'MIXTO', kg: '10', precioPorKg: '5', pagado: '50', fecha: '2026-10-16' })
    };
  });
  igual([r.ok.ticket, r.ok.material, r.ok.kg, r.ok.total, r.ok.pagado, r.ok.abonoSaldoInicial], ['SALDO INICIAL', 'ABONO A SALDO INICIAL', 0, 0, 250.5, true], 'registro del abono (ignora ticket/material/kg/precio tecleados)');
  igual(r.ok.proveedor, 'PROVEEDOR DE PRUEBA', 'proveedor normalizado');
  afirmar(r.sinProveedor && r.sinFecha, 'proveedor y fecha obligatorios');
  afirmar(r.cero && r.negativo && r.vacio, 'monto mayor a 0');
  igual(r.normalSinTicket, 'Todos los campos son obligatorios', 'un pago normal sin ticket sigue fallando igual');
  igual([r.normal.ticket, r.normal.total, r.normal.abonoSaldoInicial], ['T9', 50, undefined], 'pago normal sin la marca');
  await page.close();
});

caso('el checkbox oculta ticket, material, kg, precio y total, y al desmarcar vuelven (y vuelven a ser obligatorios)', async (browser) => {
  const page = await paginaNueva(browser);
  const ids = ['#pg-ticket', '#pg-material', '#pg-kg', '#pg-precio', '#pg-total'];
  for (const id of ids) afirmar(await visible(page, id), `${id} visible al inicio`);
  await page.check('#pg-saldo-inicial');
  for (const id of ids) igual(await visible(page, id), false, `${id} oculto con el checkbox`);
  for (const id of ['#pg-proveedor', '#pg-pagado', '#pg-fecha', '#pg-nota']) afirmar(await visible(page, id), `${id} sigue visible`);
  igual(await page.$$eval('#pg-ticket, #pg-material, #pg-kg, #pg-precio', (n) => n.map((x) => x.required)), [false, false, false, false], 'ya no son obligatorios');
  await page.uncheck('#pg-saldo-inicial');
  for (const id of ids) afirmar(await visible(page, id), `${id} visible otra vez`);
  igual(await page.$$eval('#pg-ticket, #pg-material, #pg-kg, #pg-precio', (n) => n.map((x) => x.required)), [true, true, true, true], 'vuelven a ser obligatorios');
  await page.close();
});

caso('guardar el abono: pago con las marcas y valores fijos, sin tocar CxP ni saldo a favor aunque el proveedor deba, y sin nota', async (browser) => {
  const page = await paginaNueva(browser);
  await llenarAbono(page);
  await enviar(page);
  await page.waitForFunction(() => window.__escrituras.length > 0);
  await page.waitForTimeout(200);
  const e = await escrituras(page);
  igual(e.map((x) => x.coleccion), ['pagos'], 'solo se escribe un documento, en pagos (nada en cuentas_por_pagar ni saldo a favor)');
  const d = e[0].datos;
  igual([d.abonoSaldoInicial, d.ticket, d.material, d.kg, d.total, d.pagado, d.proveedor, d.fecha, d.iva], [true, 'SALDO INICIAL', 'ABONO A SALDO INICIAL', 0, 0, 1500, 'PROVEEDOR DE PRUEBA', FECHA, 0], 'campos del pago');
  igual(d.nota, undefined, 'sin nota no se guarda nota');
  igual(await page.evaluate(() => window.EVE.cuentasPorPagar[0].saldo), 1000, 'la CxP del proveedor no cambió en memoria');
  igual(await page.evaluate(() => window.EVE.registrosPagos.length), 1, 'el pago quedó en memoria');
  igual(await page.$eval('#pg-saldo-inicial', (n) => n.checked), false, 'el formulario vuelve a su estado normal');
  afirmar(await visible(page, '#pg-ticket'), 'y los campos vuelven a mostrarse');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('guardar el abono con nota opcional: la nota se conserva', async (browser) => {
  const page = await paginaNueva(browser);
  await llenarAbono(page, { nota: 'Saldo al 30 de septiembre' });
  await enviar(page);
  await page.waitForFunction(() => window.__escrituras.length > 0);
  igual((await escrituras(page))[0].datos.nota, 'Saldo al 30 de septiembre', 'nota guardada');
  await page.close();
});

caso('abono con monto 0 o proveedor vacío: muestra el error y no escribe nada', async (browser) => {
  const page = await paginaNueva(browser);
  await llenarAbono(page, { pagado: '0' });
  await enviar(page);
  await page.waitForTimeout(200);
  igual((await escrituras(page)).length, 0, 'monto 0 no escribe');
  afirmar((await errorMostrado(page)).some((t) => t.includes('mayor a 0')), 'mensaje de monto');
  await page.fill('#pg-pagado', '100');
  await page.fill('#pg-proveedor', '');
  await enviar(page);
  await page.waitForTimeout(200);
  igual((await escrituras(page)).length, 0, 'proveedor vacío no escribe');
  await page.close();
});

caso('sin el checkbox el comportamiento no cambia: un ticket fuera de CxP exige nota; con CxP vinculada abona la cuenta', async (browser) => {
  const page = await paginaNueva(browser);
  await page.fill('#pg-ticket', 'T99');
  await page.fill('#pg-proveedor', 'PROVEEDOR DE PRUEBA');
  await page.fill('#pg-material', 'MIXTO');
  await page.fill('#pg-kg', '10');
  await page.fill('#pg-precio', '5');
  await page.fill('#pg-pagado', '50');
  await page.fill('#pg-fecha', FECHA);
  await enviar(page);
  await page.waitForTimeout(200);
  igual((await escrituras(page)).length, 0, 'sin nota no se guarda');
  afirmar((await errorMostrado(page)).some((t) => t.includes('no está en Cuentas por Pagar')), 'mensaje de nota requerida');
  await page.fill('#pg-ticket', 'T1');
  await page.fill('#pg-pagado', '300');
  await enviar(page);
  await page.waitForFunction(() => window.__escrituras.some((x) => x.coleccion === 'cuentas_por_pagar'));
  const e = await escrituras(page);
  igual(e.map((x) => x.coleccion).sort(), ['cuentas_por_pagar', 'pagos'], 'pago normal + abono a su CxP');
  igual(e.find((x) => x.coleccion === 'pagos').datos.abonoSaldoInicial, undefined, 'el pago normal no lleva la marca');
  await page.close();
});

caso('el material "ABONO A SALDO INICIAL" no se ofrece como sugerencia de material', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [
    { id: 'p1', ticket: 'SALDO INICIAL', proveedor: 'PROVEEDOR DE PRUEBA', material: 'ABONO A SALDO INICIAL', kg: 0, precioPorKg: 0, total: 0, pagado: 100, fecha: FECHA, abonoSaldoInicial: true },
    { id: 'p2', ticket: 'T5', proveedor: 'PROVEEDOR DE PRUEBA', material: 'MIXTO', kg: 10, precioPorKg: 5, total: 50, pagado: 50, fecha: FECHA }
  ] });
  const opciones = await page.$$eval('#dl-pagos-materiales option', (o) => o.map((x) => x.value));
  afirmar(opciones.includes('MIXTO'), 'MIXTO sí se ofrece');
  igual(opciones.includes('ABONO A SALDO INICIAL'), false, 'el material artificial no se ofrece');
  await page.close();
});

// ===== Lista, filtros, estadísticas, exportaciones, captura, Flujo, edición y eliminación =====

const ABONO = { id: 'ab1', ticket: 'SALDO INICIAL', proveedor: 'PROVEEDOR DE PRUEBA', material: 'ABONO A SALDO INICIAL', kg: 0, precioPorKg: 0, total: 0, pagado: 1500, iva: 0, fecha: FECHA, abonoSaldoInicial: true };
const NORMAL = { id: 'pn1', ticket: 'T5', proveedor: 'PROVEEDOR DE PRUEBA', material: 'MIXTO', kg: 10, precioPorKg: 5, total: 50, pagado: 50, iva: 0, fecha: FECHA };
const filasTabla = (page) => page.$$eval('#pagos-tabla tr', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));

caso('lista: el abono lleva la etiqueta "Abono a saldo inicial" junto al proveedor; el pago normal no', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [ABONO, NORMAL] });
  const filas = await filasTabla(page);
  const del = (ticket) => filas.find((f) => f[0] === ticket);
  igual(del('SALDO INICIAL')[1], 'PROVEEDOR DE PRUEBA Abono a saldo inicial', 'proveedor + etiqueta');
  igual(del('T5')[1], 'PROVEEDOR DE PRUEBA', 'el pago normal no lleva etiqueta');
  igual(await page.$$eval('#pagos-tabla .chip', (c) => c.length), 1, 'una sola etiqueta');
  await page.close();
});

caso('filtro "Tipo de pago" en Todos: solo abonos, sin abonos y todos; las estadísticas no cuentan el abono como registro ni kg pero sí su pagado', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [ABONO, NORMAL] });
  igual(await visible(page, '#pgf-tipo'), false, 'los filtros solo se ven en Todos');
  await page.click('button[data-tab="todos"]');
  afirmar(await visible(page, '#pgf-tipo'), 'el filtro de tipo se ve en Todos');
  igual(await page.$$eval('#pgf-tipo option', (o) => o.map((x) => x.value)), ['', 'saldo-inicial', 'sin-saldo-inicial'], 'opciones');
  igual((await filasTabla(page)).map((f) => f[0]).sort(), ['SALDO INICIAL', 'T5'], 'Todos: ambos pagos');
  const stats = await page.$eval('#pagos-stats', (n) => n.textContent);
  afirmar(stats.includes('Registros: 1') && stats.includes('Total KG: 10') && stats.includes('Total Pagado: $1,550.00'), `estadísticas de Todos: ${stats}`);
  await page.selectOption('#pgf-tipo', 'saldo-inicial');
  igual((await filasTabla(page)).map((f) => f[0]), ['SALDO INICIAL'], 'solo abonos');
  const soloAbonos = await page.$eval('#pagos-stats', (n) => n.textContent);
  afirmar(soloAbonos.includes('Registros: 0') && soloAbonos.includes('Total KG: 0') && soloAbonos.includes('Total Pagado: $1,500.00'), `estadísticas de solo abonos: ${soloAbonos}`);
  await page.selectOption('#pgf-tipo', 'sin-saldo-inicial');
  igual((await filasTabla(page)).map((f) => f[0]), ['T5'], 'sin abonos');
  await page.selectOption('#pgf-tipo', '');
  igual((await filasTabla(page)).length, 2, 'de vuelta a todos');
  await page.close();
});

caso('calcularStats y calcularControlFlujo: el pagado del abono es salida de efectivo; no suma kg, registros ni compras', async (browser) => {
  const page = await paginaNueva(browser);
  const r = await page.evaluate(([abono, normal]) => ({
    stats: window.EVE_PAGOS.calcularStats([normal, abono]),
    flujo: window.EVE_PAGOS.calcularControlFlujo([normal, abono], [{ monto: 1000 }]),
    resumen: window.calcularResumenPagos([normal, abono])
  }), [ABONO, NORMAL]);
  igual(r.stats, { totalRegistros: 1, totalKg: 10 }, 'stats: el abono no es registro ni kg');
  igual([r.flujo.totalPagado, r.flujo.saldoDisponible], [1550, 1000 - 1550], 'flujo semanal: pagado incluye el abono');
  igual(r.resumen.totalPagado, 1550, 'resumen: total pagado incluye el abono');
  await page.close();
});

caso('Flujo de efectivo: el abono entra como salida del día (y semana) en que se hizo', async (browser) => {
  const page = await paginaNueva(browser);
  const mov = await page.evaluate((abono) => window.EVE_FLUJO.construirMovimientosFlujo({ pagos: [abono] }), ABONO);
  igual(mov.length, 1, 'un movimiento');
  igual([mov[0].tipo, mov[0].entrada, mov[0].salida, mov[0].fecha, mov[0].contraparte, mov[0].folio], ['Salida', 0, 1500, FECHA, 'PROVEEDOR DE PRUEBA', 'SALDO INICIAL'], 'movimiento de salida');
  await page.close();
});

caso('exportaciones TXT, CSV y PDF: el abono aparece identificado con "ABONO A SALDO INICIAL"; el filtro de tipo también aplica', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [ABONO, NORMAL] });
  const r = await page.evaluate(([fecha]) => {
    window.__csv = null; window.__pdf = null;
    window.exportarCSV = (filas) => { window.__csv = filas; };
    window.jspdf = { jsPDF: function () {
      const doc = {
        internal: { pageSize: { getWidth: () => 210 } },
        setFontSize() {}, setFont() {}, text() {}, setDrawColor() {}, line() {}, addPage() {}, save() {},
        autoTable(opciones) { window.__pdf = opciones.body; }
      };
      return doc;
    } };
    const filtros = { desde: fecha, hasta: fecha, ticket: '', proveedor: '', material: '', tipo: '' };
    const periodo = window.obtenerRangoYEtiqueta('todos', filtros);
    const txt = window.generarTXTPagos(window.obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros), periodo);
    window.exportarReportePagosCSV('todos', filtros);
    const csvTodos = window.__csv;
    window.exportarReportePagosPDF('todos', filtros);
    const pdfTodos = window.__pdf;
    window.exportarReportePagosCSV('todos', { ...filtros, tipo: 'saldo-inicial' });
    const csvSoloAbonos = window.__csv;
    window.exportarReportePagosCSV('todos', { ...filtros, tipo: 'sin-saldo-inicial' });
    return { txt, csvTodos, pdfTodos, csvSoloAbonos, csvSinAbonos: window.__csv };
  }, [FECHA]);
  afirmar(/SALDO INICIAL\s+PROVEEDOR DE PRUEBA\s+ABONO A SALDO INICIAL\s+0/.test(r.txt), `TXT identifica el abono: ${r.txt}`);
  afirmar(r.csvTodos.some((f) => f.material === 'ABONO A SALDO INICIAL' && f.ticket === 'SALDO INICIAL' && f.pagado === 1500 && f.kg === 0), 'CSV identifica el abono');
  afirmar(r.pdfTodos.some((fila) => fila.includes('ABONO A SALDO INICIAL') && fila.includes('SALDO INICIAL')), 'PDF identifica el abono');
  igual(r.csvSoloAbonos.map((f) => f.ticket), ['SALDO INICIAL'], 'exportación con filtro "solo abonos"');
  igual(r.csvSinAbonos.map((f) => f.ticket), ['T5'], 'exportación con filtro "sin abonos"');
  await page.close();
});

caso('Vista para captura: el abono aparece como "Abono a saldo inicial" junto al proveedor', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [ABONO, NORMAL] });
  await page.evaluate(() => { window.VistaCaptura = { abrir(config) { window.__captura = config; } }; });
  await page.click('#btn-vista-captura-pagos');
  const r = await page.evaluate(() => {
    const c = window.__captura;
    const columna = c.columnas.find((x) => x.clave === 'proveedor');
    return {
      filas: c.filas.map((f) => ({ ticket: f.ticket, proveedor: columna.formato(f.proveedor, f) })),
      resumen: c.resumenFilas, kpis: c.kpis
    };
  });
  igual(r.filas.find((f) => f.ticket === 'SALDO INICIAL').proveedor, 'PROVEEDOR DE PRUEBA (Abono a saldo inicial)', 'abono identificado');
  igual(r.filas.find((f) => f.ticket === 'T5').proveedor, 'PROVEEDOR DE PRUEBA', 'pago normal sin cambio');
  igual(r.resumen, [{ label: 'PROVEEDOR DE PRUEBA', valor: '$1,550.00' }], 'total por proveedor incluye el abono');
  await page.close();
});

caso('editar un abono: abre sin ticket/material/kg/precio, no exige nota, conserva el tipo y guarda sin errores', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [{ ...ABONO }, { ...NORMAL }] });
  await page.evaluate((abono) => window.EVE_PAGOS.abrirModalEdicion(abono), ABONO);
  for (const id of ['#pge-ticket', '#pge-material', '#pge-kg', '#pge-precio', '#pge-total']) igual(await visible(page, id), false, `${id} oculto al editar un abono`);
  igual(await page.$eval('#pge-nota', (n) => n.required), false, 'la nota no es obligatoria');
  await page.fill('#pge-pagado', '2000');
  await page.evaluate(() => document.getElementById('pagos-edit-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.waitForFunction(() => window.__escrituras.some((x) => x.coleccion === 'pagos' && x.id === 'ab1'));
  await page.waitForTimeout(150);
  const e = await escrituras(page);
  const dato = e.find((x) => x.coleccion === 'pagos' && x.id === 'ab1').datos;
  igual([dato.abonoSaldoInicial, dato.ticket, dato.material, dato.kg, dato.total, dato.pagado], [true, 'SALDO INICIAL', 'ABONO A SALDO INICIAL', 0, 0, 2000], 'abono editado');
  igual(e.map((x) => x.coleccion).filter((c) => c !== 'historial_cambios'), ['pagos'], 'solo se actualizó el pago (ni CxP ni saldo a favor); el historial de cambios es aparte');
  igual(await page.evaluate(() => window.EVE.registrosPagos.find((r) => r.id === 'ab1').pagado), 2000, 'memoria actualizada');
  igual(await errorMostrado(page), [], 'sin mensajes de error');
  // un pago normal sigue mostrando todos sus campos
  await page.evaluate((normal) => window.EVE_PAGOS.abrirModalEdicion(normal), NORMAL);
  for (const id of ['#pge-ticket', '#pge-material', '#pge-kg', '#pge-precio', '#pge-total']) afirmar(await visible(page, id), `${id} visible al editar un pago normal`);
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('eliminar un abono: se borra de pagos y de memoria sin tocar CxP ni errores', async (browser) => {
  const page = await paginaNueva(browser, { pagos: [{ ...ABONO }, { ...NORMAL }] });
  await page.evaluate(() => { window.prompt = () => 'duplicado'; });
  await page.evaluate(() => window.EVE_PAGOS.confirmarEliminar('ab1'));
  await page.waitForFunction(() => window.__escrituras.some((x) => x.coleccion === 'pagos' && x.borrado));
  await page.waitForTimeout(150);
  const e = await escrituras(page);
  igual(e.filter((x) => x.coleccion !== 'historial_cambios').map((x) => [x.coleccion, x.id, !!x.borrado]), [['pagos', 'ab1', true]], 'solo se borró el abono');
  igual(await page.evaluate(() => window.EVE.registrosPagos.map((r) => r.id)), ['pn1'], 'memoria');
  igual(await errorMostrado(page), [], 'sin mensajes de error');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('Total Deuda no cambia con un abono (ni en pantalla ni en TXT, PDF y CSV) y Total Pagado sí suma; el anticipo y los pagos normales no cambian', async (browser) => {
  const DEUDOR = { id: 'pd1', ticket: 'T7', proveedor: 'PROVEEDOR DE PRUEBA', material: 'MIXTO', kg: 10, precioPorKg: 100, total: 1000, pagado: 400, iva: 0, fecha: FECHA };
  const ANTICIPO = { id: 'an1', ticket: '', proveedor: 'PROVEEDOR DE PRUEBA', material: '', kg: 0, precioPorKg: 0, total: 0, pagado: 200, iva: 0, fecha: FECHA, origen: 'anticipo' };
  const page = await paginaNueva(browser, { pagos: [DEUDOR, ABONO, ANTICIPO] });
  const r = await page.evaluate(([deudor, abono, anticipo, fecha]) => {
    const resumen = (pagos) => window.calcularResumenPagos(pagos);
    window.__csv = null; window.__pdf = null;
    window.exportarCSV = (filas) => { window.__csv = filas; };
    window.jspdf = { jsPDF: function () {
      return { internal: { pageSize: { getWidth: () => 210 } }, setFontSize() {}, setFont() {}, text() {}, setDrawColor() {}, line() {}, addPage() {}, save() {}, autoTable(o) { window.__pdf = o.body; } };
    } };
    const filtros = { desde: fecha, hasta: fecha, ticket: '', proveedor: '', material: '', tipo: '' };
    const periodo = window.obtenerRangoYEtiqueta('todos', filtros);
    const txt = window.generarTXTPagos(window.obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros), periodo);
    window.exportarReportePagosCSV('todos', filtros);
    window.exportarReportePagosPDF('todos', filtros);
    return {
      sinAbono: resumen([deudor, anticipo]), conAbono: resumen([deudor, anticipo, abono]), soloAbono: resumen([abono]),
      txt, csv: window.__csv, pdf: window.__pdf
    };
  }, [DEUDOR, ABONO, ANTICIPO, FECHA]);
  // Total Deuda: 600 del ticket - 200 del anticipo (como antes) = 400, con o sin el abono; Total Pagado sí suma los 1,500.
  igual([r.sinAbono.totalPagado, r.sinAbono.totalDeuda], [600, 400], 'sin abono (el anticipo conserva su cálculo)');
  igual([r.conAbono.totalPagado, r.conAbono.totalDeuda], [2100, 400], 'con abono: Total Pagado +1500, Total Deuda igual');
  igual([r.soloAbono.totalPagado, r.soloAbono.totalDeuda], [1500, 0], 'solo un abono: deuda 0 y no negativa');
  afirmar(r.txt.includes('TOTAL PAGADO: $2,100.00') && r.txt.includes('TOTAL DEUDA: $400.00'), `TXT: totales (${r.txt.split('\n').filter((l) => l.startsWith('TOTAL')).join(' | ')})`);
  const lineaAbono = r.txt.split('\n').find((l) => l.includes('ABONO A SALDO INICIAL'));
  afirmar(lineaAbono && lineaAbono.includes('$1,500.00  $0.00'), `TXT: la fila del abono muestra pagado 1,500 y deuda 0 (${lineaAbono})`);
  const filaCsv = (ticket) => r.csv.find((f) => f.ticket === ticket);
  igual([filaCsv('SALDO INICIAL').pagado, filaCsv('SALDO INICIAL').deuda], [1500, 0], 'CSV: fila del abono');
  igual(filaCsv('T7').deuda, 600, 'CSV: pago normal sin cambio');
  igual(filaCsv('').deuda, -200, 'CSV: el anticipo sigue con su cálculo');
  const filaPdf = r.pdf.find((f) => f.includes('ABONO A SALDO INICIAL'));
  igual([filaPdf[6], filaPdf[7]], ['$1,500.00', '$0.00'], 'PDF: fila del abono (pagado, deuda)');
  // Pantalla de Pagos (pestaña Todos)
  await page.click('button[data-tab="todos"]');
  const stats = await page.$eval('#pagos-stats', (n) => n.textContent);
  afirmar(stats.includes('Total Pagado: $2,100.00') && stats.includes('Total Deuda: $400.00'), `pantalla: ${stats}`);
  await page.selectOption('#pgf-tipo', 'saldo-inicial');
  const soloAbonos = await page.$eval('#pagos-stats', (n) => n.textContent);
  afirmar(soloAbonos.includes('Total Pagado: $1,500.00') && soloAbonos.includes('Total Deuda: $0.00'), `pantalla, solo abonos: ${soloAbonos}`);
  // Control de flujo: el pagado del abono sigue siendo salida de efectivo
  igual(await page.evaluate(([deudor, abono]) => window.EVE_PAGOS.calcularControlFlujo([deudor, abono], []).totalPagado, [DEUDOR, ABONO]), 1900, 'control de flujo suma el abono');
  await page.close();
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
