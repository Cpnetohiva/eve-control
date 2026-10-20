// Verifica el "Monto total del recibo" de CxP (detalle de un proveedor): reparte el monto PEPS (fecha del ticket, número de ticket
// numérico y fechaRegistro, ascendentes, sin dividir una cuenta en dos) entre todas las cuentas con saldo o, si el usuario marcó
// filas a mano, solo entre esas; marca y llena las filas alcanzadas; avisa cuando el monto no alcanza; y conserva las marcas y los
// montos cuando el detalle se vuelve a renderizar. El checkbox por ticket y el monto por fila siguen funcionando sin usar el campo.
//
// Carga los JS reales de CxP en Chromium (Playwright) con datos en memoria; no usa la red ni Firebase.
//
// Uso: node scripts/verificar-reparto-peps.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const HTML = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="toast-container"></div><div id="main-content"></div>
<script>window.firebase={initializeApp(){},firestore(){return{enablePersistence(){return Promise.resolve()}}},auth(){return{onAuthStateChanged(){}}}};window.EVE_MODULES={};</script>
${['config.js', 'utils.js', 'permisos.js', 'ordenar-tabla.js', 'vista-captura.js', 'reportes.js', 'voz.js', 'cxp.js'].map((s) => `<script src="/js/${s}"></script>`).join('')}
</body></html>`;

const FECHA = '2026-10-10';
// Caso 1 del pedido: cinco cuentas del mismo proveedor y fecha; el ticket 1285 tiene dos cuentas.
const CUENTAS_BASE = [
  { id: 'c1', ticket: '1285', saldo: 2637.00, material: 'PET' },
  { id: 'c2', ticket: '1285', saldo: 3811.50, material: 'DURO' },
  { id: 'c3', ticket: '1286', saldo: 10218.00, material: 'PET' },
  { id: 'c4', ticket: '1287', saldo: 58995.00, material: 'PET' },
  { id: 'c5', ticket: '1289', saldo: 58752.00, material: 'PET' }
];
const SALDO_TOTAL = 134413.50;

async function abrirDetalle(browser, cuentas, fechaCuentas, recibosPendientes) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  page.errores = [];
  page.avisos = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  await page.route('http://eve.test/**', (ruta) => {
    const url = new URL(ruta.request().url()).pathname;
    if (url === '/') return ruta.fulfill({ contentType: 'text/html', body: HTML });
    const archivo = path.join(RAIZ, url);
    if (fs.existsSync(archivo)) return ruta.fulfill({ body: fs.readFileSync(archivo), contentType: url.endsWith('.css') ? 'text/css' : 'application/javascript' });
    return ruta.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://eve.test/');
  await page.evaluate(({ cuentas: lista, fecha: fechaBase, recibos }) => {
    const fecha = fechaBase === 'HOY' ? window.obtenerFechaMexico() : fechaBase;
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: { cxp: 'escritura', pagos: 'escritura' } },
      registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], proveedores: [], ventas: [], precios: [],
      composiciones: [], recibosPendientes: [], auditorias: [], metaPiezasDia: {},
      cuentasPorPagar: lista.map((c) => ({
        proveedor: 'PROV', kg: 100, precioEfectivo: 10, total: c.saldo, iva: 0, pagado: 0, estado: 'pendiente', fechaTicket: fecha,
        fechaRegistro: '2026-10-10T10:00:00.000Z', abonos: [], ...c
      }))
    };
    window.showError = (m) => { (window.__avisos = window.__avisos || []).push(m); };
    window.EVE_MODULES.cxp.render(document.getElementById('main-content'));
    window.__recibos = [];
    // Recibos pendientes que devuelve Firestore (se pueden cambiar durante la prueba con window.__recibosPendientes).
    window.__recibosPendientes = recibos || [];
    const consulta = { where() { return consulta; }, get: async () => ({ docs: window.__recibosPendientes.map((r) => ({ id: r.id, data: () => ({ ...r }) })) }) };
    window.db = { collection: () => consulta };
    window.guardarDato = async (coleccion, datos) => {
      window.__recibos.push({ coleccion, datos });
      const id = `r${window.__recibos.length}`;
      // Como Firestore: el recibo guardado aparece en la siguiente lectura de pendientes.
      if (coleccion === 'recibos_pendientes') window.__recibosPendientes.push({ id, ...datos });
      return id;
    };
    window.jspdf = { jsPDF: function () { return new Proxy({ internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } }, lastAutoTable: { finalY: 0 } }, { get: (o, k) => (k in o ? o[k] : () => {}) }); } };
  }, { cuentas, fecha: fechaCuentas || FECHA, recibos: recibosPendientes });
  await page.click('button:text-is("Ver Detalle")');
  await page.waitForTimeout(150);
  return { ctx, page };
}

// Estado de las filas del detalle: ticket, saldo (columna Saldo), marcada y monto del input.
const filas = (page) => page.$$eval('#main-content tbody[id^="cxp-tabla-cuentas-"] tr', (trs) => trs
  .filter((tr) => tr.querySelector('input[type="checkbox"]'))
  .map((tr) => ({ ticket: tr.children[1].textContent.trim(), marcada: tr.querySelector('input[type="checkbox"]').checked, monto: tr.querySelector('input[type="number"]').value })));
const montos = async (page) => (await filas(page)).map((f) => (f.marcada ? Number(f.monto) : 0));
const avisos = (page) => page.evaluate(() => window.__avisos || []);
const campoTotal = (page) => page.inputValue('#cxp-monto-total-recibo');
async function ponerMontoTotal(page, valor) {
  await page.fill('#cxp-monto-total-recibo', String(valor));
  await page.dispatchEvent('#cxp-monto-total-recibo', 'change');
}
const marcarFila = (page, indice) => page.locator('#main-content tbody[id^="cxp-tabla-cuentas-"] input[type="checkbox"]').nth(indice).click();

caso('1) sin filas marcadas y monto 63,840: reparte 2,637.00, 3,811.50, 10,218.00 y 47,173.50, y deja el 1289 en cero', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  // Antes de usar el campo, la tabla se ve como siempre: nada marcado.
  igual((await filas(page)).every((f) => !f.marcada), true, 'sin marcas iniciales');
  await ponerMontoTotal(page, 63840);
  const lista = await filas(page);
  igual(lista.map((f) => f.ticket).sort(), ['1285', '1285', '1286', '1287', '1289'], 'tickets');
  const m = await montos(page);
  igual(m.reduce((a, b) => a + b, 0), 63840, 'la suma es exactamente el monto');
  const marcadas = lista.filter((f) => f.marcada).length;
  igual(marcadas, 4, 'cuatro filas marcadas');
  igual(lista.find((f) => f.ticket === '1289').marcada, false, '1289 sin marcar');
  igual([...m].filter((x) => x > 0).sort((a, b) => a - b), [2637, 3811.5, 10218, 47173.5], 'montos repartidos');
  igual(await campoTotal(page), '63840.00', 'el campo muestra la suma de lo marcado');
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

caso('2) con marcadas a mano solo 1286 y 1287 y monto 20,000: 10,218.00 al 1286 y 9,782.00 al 1287, sin tocar las demás', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  const lista0 = await filas(page);
  await marcarFila(page, lista0.findIndex((f) => f.ticket === '1286'));
  await marcarFila(page, lista0.findIndex((f) => f.ticket === '1287'));
  await ponerMontoTotal(page, 20000);
  const lista = await filas(page);
  const de = (t) => lista.filter((f) => f.ticket === t);
  igual([de('1286')[0].marcada, Number(de('1286')[0].monto)], [true, 10218], '1286');
  igual([de('1287')[0].marcada, Number(de('1287')[0].monto)], [true, 9782], '1287');
  igual(de('1285').concat(de('1289')).every((f) => !f.marcada), true, 'las demás sin marcar');
  igual(await campoTotal(page), '20000.00', 'el campo muestra la suma de lo marcado');
  await ctx.close();
});

caso('3) monto mayor al saldo total del proveedor: no reparte, avisa y dice que el excedente es anticipo en Ejecutar pago', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  await ponerMontoTotal(page, SALDO_TOTAL + 100);
  igual((await filas(page)).every((f) => !f.marcada), true, 'no se marcó nada');
  const a = await avisos(page);
  igual(a.length, 1, 'un aviso');
  afirmar(/mayor a la suma de los saldos/.test(a[0]) && /anticipo en Ejecutar pago/.test(a[0]) && /No se repartió nada/.test(a[0]), `aviso: ${a[0]}`);
  // Igual al saldo total sí alcanza: marca todas.
  await ponerMontoTotal(page, SALDO_TOTAL);
  igual((await filas(page)).every((f) => f.marcada), true, 'con el saldo exacto se marcan todas');
  igual((await montos(page)).reduce((x, y) => x + y, 0), SALDO_TOTAL, 'suma exacta');
  await ctx.close();
});

caso('4) monto mayor a la suma de las filas marcadas a mano: no reparte; sin nota de anticipo si cabe en el saldo del proveedor', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  const lista0 = await filas(page);
  await marcarFila(page, lista0.findIndex((f) => f.ticket === '1286'));
  await ponerMontoTotal(page, 11000);
  const a = await avisos(page);
  igual(a.length, 1, 'un aviso');
  afirmar(/cuentas marcadas/.test(a[0]) && !/anticipo/.test(a[0]), `aviso: ${a[0]}`);
  const lista = await filas(page);
  igual(lista.filter((f) => f.marcada).map((f) => f.ticket), ['1286'], 'solo sigue marcada la fila manual');
  // Si además excede el saldo total del proveedor, el aviso añade lo del anticipo.
  await ponerMontoTotal(page, SALDO_TOTAL + 1);
  const b = await avisos(page);
  afirmar(/cuentas marcadas/.test(b[1]) && /anticipo en Ejecutar pago/.test(b[1]), `aviso: ${b[1]}`);
  await ctx.close();
});

caso('5) las marcas y los montos sobreviven a un nuevo renderizado (cambio de periodo, refresco) y Limpiar los borra', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  await ponerMontoTotal(page, 63840);
  const antes = await filas(page);
  // Cambio de pestaña de periodo y regreso.
  await page.click('#cxp-proveedores-wrapper .destaraje-subtabs .tab:text-is("Este Mes")');
  await page.click('#cxp-proveedores-wrapper .destaraje-subtabs .tab:text-is("Todos")');
  igual(await filas(page), antes, 'tras cambiar de periodo');
  // Refresco de datos: otra cuenta cambia de saldo y la vista se vuelve a dibujar; las marcas de las demás se conservan.
  await page.evaluate(() => { window.EVE.cuentasPorPagar.find((c) => c.id === 'c5').saldo = 50000; });
  await page.click('#cxp-proveedores-wrapper .destaraje-subtabs .tab:text-is("Hoy")');
  await page.click('#cxp-proveedores-wrapper .destaraje-subtabs .tab:text-is("Todos")');
  igual((await filas(page)).filter((f) => f.marcada).length, 4, 'tras el refresco siguen las cuatro marcas');
  await page.click('button:text-is("Ocultar Detalle")');
  await page.click('button:text-is("Ver Detalle")');
  igual((await filas(page)).every((f) => !f.marcada), true, 'ocultar y volver a abrir el detalle sí empieza limpio (como hoy)');
  await ponerMontoTotal(page, 63840);
  const reparto = await filas(page);
  // Editar a mano un monto: el campo Monto total pasa a la suma de lo marcado y las marcas se conservan.
  const iMarcada = reparto.findIndex((f) => f.marcada);
  const input = page.locator('#main-content tbody[id^="cxp-tabla-cuentas-"] input[type="number"]').nth(iMarcada);
  await input.fill('100');
  await input.dispatchEvent('change');
  const suma = (await montos(page)).reduce((a, b) => a + b, 0);
  igual(await campoTotal(page), suma.toFixed(2), 'el campo Monto total muestra la suma de lo marcado');
  // Desmarcar una fila a mano también actualiza el campo.
  await marcarFila(page, iMarcada);
  const suma2 = (await montos(page)).reduce((a, b) => a + b, 0);
  igual(await campoTotal(page), suma2.toFixed(2), 'tras desmarcar');
  await page.click('#cxp-btn-limpiar-recibo');
  igual((await filas(page)).every((f) => !f.marcada), true, 'Limpiar desmarca todo');
  igual(await campoTotal(page), '', 'Limpiar vacía el campo');
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

caso('sin usar el campo: checkbox por ticket y monto por fila funcionan igual que antes', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  await marcarFila(page, 0);
  const lista = await filas(page);
  igual(lista[0].marcada, true, 'marcada');
  afirmar(Number(lista[0].monto) > 0, 'monto por defecto = saldo de la fila');
  igual(await page.$eval('#cxp-total-seleccionado', (e) => e.textContent.includes('$')), true, 'total seleccionado visible');
  igual(await page.$eval('#cxp-btn-generar-recibo', (e) => e.disabled), false, 'Generar Recibo habilitado con una fila marcada');
  await marcarFila(page, 0);
  igual(await page.$eval('#cxp-btn-generar-recibo', (e) => e.disabled), true, 'Generar Recibo deshabilitado sin filas');
  await ctx.close();
});

caso('desempate PEPS: fecha del ticket, luego número de ticket numérico (9 antes que 10) y luego fechaRegistro', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, [{ id: 'a', ticket: '10', saldo: 100 }, { id: 'b', ticket: '9', saldo: 100 }]);
  const resultado = await page.evaluate(() => {
    const r = window.EVE_CXP.repartirMontoPEPS([
      { id: 'a', ticket: '10', saldo: 100, fechaTicket: '2026-10-10', fechaRegistro: '2026-10-10T10:00:00Z' },
      { id: 'b', ticket: '9', saldo: 100, fechaTicket: '2026-10-10', fechaRegistro: '2026-10-10T11:00:00Z' },
      { id: 'c', ticket: '50', saldo: 100, fechaTicket: '2026-10-09', fechaRegistro: '2026-10-10T12:00:00Z' },
      { id: 'd', ticket: '9', saldo: 100, fechaTicket: '2026-10-10', fechaRegistro: '2026-10-10T09:00:00Z' }
    ], 250.01);
    return { ok: r.ok, asignaciones: [...r.asignaciones] };
  });
  igual(resultado, { ok: true, asignaciones: [['c', 100], ['d', 100], ['b', 50.01]] }, 'orden y reparto');
  await ctx.close();
});

caso('aviso de periodo: aparece fuera de Todos y no en Todos', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE, 'HOY');
  const aviso = '#cxp-aviso-periodo-reparto';
  igual(await page.isVisible(aviso), false, 'en Todos no se muestra');
  for (const periodo of ['Hoy', 'Esta Semana', 'Este Mes']) {
    // El corte semanal de CxP no es la semana calendario: las cuentas se fechan dentro del periodo que se visita.
    await page.evaluate((p) => {
      const hoy = window.obtenerFechaMexico();
      const fecha = p === 'Esta Semana' ? window.EVE_CXP.calcularCorteSemanalCxP(hoy).inicio : hoy;
      window.EVE.cuentasPorPagar.forEach((c) => { c.fechaTicket = fecha; });
    }, periodo);
    await page.click(`#cxp-proveedores-wrapper .destaraje-subtabs .tab:text-is("${periodo}")`);
    igual(await page.isVisible(aviso), true, `visible en ${periodo}`);
    afirmar((await page.textContent(aviso)).includes('cambia a Todos para repartir PEPS sobre toda la deuda'), 'texto del aviso');
  }
  await page.click('#cxp-proveedores-wrapper .destaraje-subtabs .tab:text-is("Todos")');
  igual(await page.isVisible(aviso), false, 'al volver a Todos se oculta');
  await ctx.close();
});

caso('generar sin blur ni Enter: reparte primero y genera el recibo con el reparto correcto', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  // fill escribe el valor sin disparar change (no hay blur ni Enter); se llama directo al manejador de Generar Recibo.
  await page.fill('#cxp-monto-total-recibo', '63840');
  igual((await filas(page)).every((f) => !f.marcada), true, 'aún no se repartió nada');
  await page.evaluate(() => window.EVE_CXP.manejarGenerarReciboPendiente('PROV'));
  await page.waitForTimeout(100);
  const recibos = await page.evaluate(() => window.__recibos);
  igual(recibos.length, 1, 'un recibo');
  igual(recibos[0].coleccion, 'recibos_pendientes', 'colección');
  igual(recibos[0].datos.montoTotal, 63840, 'monto total del recibo');
  igual(recibos[0].datos.tickets.map((t) => [t.cuentaId, t.montoAsignado]), [['c1', 2637], ['c2', 3811.5], ['c3', 10218], ['c4', 47173.5]], 'reparto exacto por cuenta');
  igual(recibos[0].datos.estado, 'pendiente_pago', 'estado');
  igual((await avisos(page)), [], 'sin avisos');
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

caso('generar con el monto escrito si hay marcas manuales: reparte solo entre ellas', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  const lista0 = await filas(page);
  await marcarFila(page, lista0.findIndex((f) => f.ticket === '1286'));
  await marcarFila(page, lista0.findIndex((f) => f.ticket === '1287'));
  await page.fill('#cxp-monto-total-recibo', '20000');
  await page.evaluate(() => window.EVE_CXP.manejarGenerarReciboPendiente('PROV'));
  await page.waitForTimeout(100);
  const recibos = await page.evaluate(() => window.__recibos);
  igual(recibos.map((r) => r.datos.tickets.map((t) => [t.cuentaId, t.montoAsignado])), [[['c3', 10218], ['c4', 9782]]], 'reparto manual');
  await ctx.close();
});

caso('generar con un monto que da aviso de error: no genera el recibo ni cambia la selección', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  await page.fill('#cxp-monto-total-recibo', String(SALDO_TOTAL + 50));
  await page.evaluate(() => window.EVE_CXP.manejarGenerarReciboPendiente('PROV'));
  await page.waitForTimeout(100);
  igual((await page.evaluate(() => window.__recibos)).length, 0, 'sin recibo');
  const a = await avisos(page);
  igual(a.length, 1, 'un aviso');
  afirmar(/anticipo en Ejecutar pago/.test(a[0]), `aviso: ${a[0]}`);
  igual((await filas(page)).every((f) => !f.marcada), true, 'nada marcado');
  await ctx.close();
});

caso('el clic real en Generar Recibo con el monto recién escrito no se pierde (el blur no redibuja el detalle)', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  await page.fill('#cxp-monto-total-recibo', '6448.50');
  await page.click('#cxp-btn-generar-recibo');
  await page.waitForTimeout(150);
  const recibos = await page.evaluate(() => window.__recibos);
  igual(recibos.length, 1, 'un recibo con un solo clic');
  igual(recibos[0].datos.tickets.map((t) => [t.cuentaId, t.montoAsignado]), [['c1', 2637], ['c2', 3811.5]], 'reparto');
  await ctx.close();
});

caso('generar con el campo ya repartido (o sin usar) no vuelve a repartir y conserva los montos editados por fila', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  await marcarFila(page, 0);
  const lista = await filas(page);
  const input = page.locator('#main-content tbody[id^="cxp-tabla-cuentas-"] input[type="number"]').nth(0);
  await input.fill('100');
  await input.dispatchEvent('change');
  await page.evaluate(() => window.EVE_CXP.manejarGenerarReciboPendiente('PROV'));
  await page.waitForTimeout(100);
  const recibos = await page.evaluate(() => window.__recibos);
  igual(recibos.length, 1, 'un recibo');
  igual(recibos[0].datos.tickets.map((t) => t.montoAsignado), [100], 'monto de la fila editada a mano');
  void lista;
  await ctx.close();
});

// ===== Recibos pendientes: el saldo ya comprometido no se vuelve a repartir =====
const recibo = (id, tickets) => ({ id, proveedor: 'PROV', estado: 'pendiente_pago', montoTotal: tickets.reduce((a, t) => a + t.montoAsignado, 0), tickets });
// Un recibo pendiente que compromete todo el c1 (2,637.00) y 5,000.00 del c3 (de 10,218.00).
const RECIBO_PENDIENTE = () => recibo('rp1', [{ cuentaId: 'c1', ticket: '1285', material: 'PET', montoAsignado: 2637 }, { cuentaId: 'c3', ticket: '1286', material: 'PET', montoAsignado: 5000 }]);

caso('recibos pendientes: calcularComprometidoPorCuenta suma por cuenta, ignora otros estados y resuelve renglones viejos sin cuentaId', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  const r = await page.evaluate(() => {
    const cuentas = window.EVE.cuentasPorPagar;
    const mapa = window.EVE_CXP.calcularComprometidoPorCuenta([
      { estado: 'pendiente_pago', proveedor: 'PROV', tickets: [{ cuentaId: 'c3', ticket: '1286', material: 'PET', montoAsignado: 1000.1 }, { ticketViejo: true, ticket: '1287', material: 'PET', monto: 200 }] },
      { estado: 'pendiente_pago', proveedor: 'PROV', tickets: [{ cuentaId: 'c3', ticket: '1286', material: 'PET', montoAsignado: 2000.2 }] },
      { estado: 'completado', proveedor: 'PROV', tickets: [{ cuentaId: 'c5', ticket: '1289', material: 'PET', montoAsignado: 999 }] },
      // 1285 PET es única con saldo (c1); renglón viejo sin cuentaId
      { estado: 'pendiente_pago', proveedor: 'PROV', tickets: [{ ticket: '1285', material: 'PET', monto: 50 }] }
    ], cuentas);
    return [...mapa];
  });
  igual(r, [['c3', 3000.3], ['c4', 200], ['c1', 50]], 'comprometido por cuenta');
  await ctx.close();
});

caso('recibos pendientes: el reparto sin marcas usa solo el saldo disponible (descuenta lo comprometido)', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE, FECHA, [RECIBO_PENDIENTE()]);
  // c1 queda sin saldo disponible (ya no se ofrece) y c3 solo tiene 5,218.00.
  igual((await filas(page)).map((f) => f.ticket).sort(), ['1285', '1286', '1287', '1289'], 'la cuenta totalmente comprometida ya no se ofrece');
  await ponerMontoTotal(page, 20000);
  igual((await montos(page)).filter((m) => m > 0).sort((a, b) => a - b), [3811.5, 5218, 10970.5], 'reparto PEPS sobre el disponible');
  igual(await campoTotal(page), '20000.00', 'el campo muestra la suma de lo marcado');
  await ctx.close();
});

caso('recibos pendientes: el monto por defecto y el tope de cada fila son el saldo disponible, también para filas marcadas a mano', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE, FECHA, [RECIBO_PENDIENTE()]);
  const lista0 = await filas(page);
  const i1286 = lista0.findIndex((f) => f.ticket === '1286');
  await marcarFila(page, i1286);
  igual(Number((await filas(page))[i1286].monto), 5218, 'por defecto: 10,218.00 menos 5,000.00 comprometidos');
  const input = page.locator('#main-content tbody[id^="cxp-tabla-cuentas-"] input[type="number"]').nth(i1286);
  await input.fill('6000');
  await input.dispatchEvent('change');
  igual(Number((await filas(page))[i1286].monto), 5218, 'el monto se recorta al disponible');
  const a = await avisos(page);
  afirmar(a.length === 1 && /saldo disponible/.test(a[0]) && /recibos pendientes/.test(a[0]), `aviso: ${a[0]}`);
  // El reparto con filas manuales también respeta el disponible: 5,300 no cabe en 5,218.
  await ponerMontoTotal(page, 5300);
  const b = await avisos(page);
  afirmar(/cuentas marcadas/.test(b[1]) && /comprometidos en recibos pendientes/.test(b[1]), `aviso del reparto: ${b[1]}`);
  await ctx.close();
});

caso('recibos pendientes: monto mayor al disponible total no reparta y avisa del descuento y del anticipo', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE, FECHA, [RECIBO_PENDIENTE()]);
  // El saldo total es 134,413.50 pero 7,637.00 ya están comprometidos: 130,000 ya no cabe.
  await ponerMontoTotal(page, 130000);
  igual((await filas(page)).every((f) => !f.marcada), true, 'no se marcó nada');
  const a = await avisos(page);
  afirmar(/Ya se descontaron \$7,637\.00 comprometidos en recibos pendientes/.test(a[0]) && /anticipo en Ejecutar pago/.test(a[0]), `aviso: ${a[0]}`);
  await ctx.close();
});

caso('recibos pendientes: Generar Recibo guarda el reparto sobre el disponible, y el recibo nuevo ya cuenta como comprometido', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE, FECHA, [RECIBO_PENDIENTE()]);
  await page.fill('#cxp-monto-total-recibo', '20000');
  await page.evaluate(() => window.EVE_CXP.manejarGenerarReciboPendiente('PROV'));
  await page.waitForTimeout(150);
  const recibos = await page.evaluate(() => window.__recibos);
  igual(recibos.length, 1, 'un recibo');
  igual(recibos[0].datos.tickets.map((t) => [t.cuentaId, t.montoAsignado]), [['c2', 3811.5], ['c3', 5218], ['c4', 10970.5]], 'reparto sobre el disponible');
  // Sin recargar nada: otro reparto ya no ve lo del recibo recién generado (queda en c4 58,995 - 10,970.50 = 48,024.50 y c5 58,752).
  await ponerMontoTotal(page, 48024.5);
  igual((await montos(page)).filter((m) => m > 0), [48024.5], 'solo cabe en c4');
  await ctx.close();
});

caso('recibos pendientes: al generar se vuelven a leer los recibos; un monto por fila que ya no cabe no genera el recibo', async (browser) => {
  const { ctx, page } = await abrirDetalle(browser, CUENTAS_BASE);
  const lista0 = await filas(page);
  await marcarFila(page, lista0.findIndex((f) => f.ticket === '1286'));
  // Mientras tanto, otro usuario genera un recibo que compromete 5,000.00 del c3.
  await page.evaluate((r) => { window.__recibosPendientes = [r]; }, RECIBO_PENDIENTE());
  await page.evaluate(() => window.EVE_CXP.manejarGenerarReciboPendiente('PROV'));
  await page.waitForTimeout(150);
  igual((await page.evaluate(() => window.__recibos)).length, 0, 'no se generó el recibo');
  const a = await avisos(page);
  afirmar(a.length === 1 && /ticket 1286/.test(a[0]) && /solo tiene \$5,218\.00 disponibles/.test(a[0]) && /otros recibos pendientes/.test(a[0]), `aviso: ${a[0]}`);
  await ctx.close();
});

// ===== Pagos: validar el saldo de cada cuenta antes de aplicar cualquier abono =====
function crearContextoPagos() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  ['js/config.js', 'js/utils.js', 'js/pagos.js'].forEach((archivo) => vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo }));
  return sandbox.window;
}

const wp = crearContextoPagos();
const cuentaP = (id, ticket, saldo) => ({ id, proveedor: 'PROV', ticket, material: 'PET', saldo, total: 20000, estado: 'pendiente' });
async function revalidar(cuentas, docsFrescos, reciboPendiente) {
  wp.EVE.cuentasPorPagar = cuentas.map((c) => ({ ...c }));
  const escrituras = [];
  wp.actualizarDato = async (...args) => { escrituras.push(args); };
  wp.guardarDato = async (...args) => { escrituras.push(args); };
  wp.db = { collection: () => ({ doc: (id) => ({ get: async () => ({ exists: !!docsFrescos[id], data: () => ({ ...docsFrescos[id] }) }) }) }) };
  let error = null;
  let cuentasFrescas = null;
  try { cuentasFrescas = await wp.EVE_PAGOS.revalidarYObtenerCuentasFrescas(reciboPendiente); } catch (e) { error = e; }
  return { error, cuentasFrescas, escrituras };
}
const reciboPagos = (tickets) => ({ id: 'rp', proveedor: 'PROV', estado: 'pendiente_pago', tickets });
const renglonP = (cuentaId, ticket, saldo, montoAsignado) => ({ cuentaId, ticket, material: 'PET', saldo, montoAsignado });

caso('Pagos: si la cuenta ya no alcanza para el monto asignado no aplica nada, avisa con el ticket y el recibo sigue pendiente', async () => {
  const cuentas = [cuentaP('a', '1285', 8000), cuentaP('b', '1286', 8000)];
  // El ticket 1286 bajó de 8,000 a 3,000 (otro pago) y el recibo le asigna 5,000.
  const r = await revalidar(cuentas, { a: cuentas[0], b: { ...cuentas[1], saldo: 3000 } }, reciboPagos([renglonP('a', '1285', 8000, 8000), renglonP('b', '1286', 8000, 5000)]));
  afirmar(r.error, 'debe fallar');
  afirmar(/ticket 1286/.test(r.error.message) && /cambió de saldo/.test(r.error.message) && /\$5,000\.00/.test(r.error.message) && /\$3,000\.00/.test(r.error.message), `mensaje: ${r.error.message}`);
  afirmar(/ningún abono/.test(r.error.message) && /sigue pendiente/.test(r.error.message), 'dice que no se aplicó nada y que el recibo sigue pendiente');
  igual(r.escrituras.length, 0, 'ninguna escritura (ni abonos ni pagos ni el estado del recibo)');
  igual(r.cuentasFrescas, null, 'no devuelve cuentas para pagar');
});

caso('Pagos: si el saldo bajó pero sigue cubriendo el monto asignado (otro recibo pendiente se pagó antes) el pago procede', async () => {
  const cuentas = [cuentaP('a', '1285', 8000)];
  // El recibo asigna 3,000.00; el saldo era 8,000 al generarlo y ahora es 5,000 por otro recibo pagado: antes se rechazaba por "cambió de saldo".
  const r = await revalidar(cuentas, { a: { ...cuentas[0], saldo: 5000 } }, reciboPagos([renglonP('a', '1285', 8000, 3000)]));
  igual(r.error, null, 'sin error');
  igual(r.cuentasFrescas.map((c) => [c.id, c.saldo]), [['a', 5000]], 'cuenta fresca con el saldo actual');
});

caso('Pagos: saldo exactamente igual al monto asignado alcanza; un centavo menos no', async () => {
  const cuentas = [cuentaP('a', '1285', 8000)];
  const justo = await revalidar(cuentas, { a: { ...cuentas[0], saldo: 3000 } }, reciboPagos([renglonP('a', '1285', 8000, 3000)]));
  igual(justo.error, null, 'igual alcanza');
  const corto = await revalidar(cuentas, { a: { ...cuentas[0], saldo: 2999.5 } }, reciboPagos([renglonP('a', '1285', 8000, 3000)]));
  afirmar(corto.error && /ticket 1285/.test(corto.error.message), 'menos no alcanza');
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
