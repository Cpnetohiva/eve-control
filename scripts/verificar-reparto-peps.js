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

async function abrirDetalle(browser, cuentas) {
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
  await page.evaluate(({ cuentas: lista, fecha }) => {
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
  }, { cuentas, fecha: FECHA });
  await page.click('button:text-is("Ver Detalle")');
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
