// Forma de pago por día en el desplegable 'Pagos por día' de CxP (js/cxp.js). La forma de pago solo existe en recibos_pago, que no
// está en memoria: se lee UNA vez por proveedor al abrir el desplegable (where proveedor == ...), se cruza por grupoPagoId contra
// los abonos ya cargados y se cachea. Cubre: el cruce por grupoPagoId (efectivo / transferencia / desglose cuando un día mezcla
// formas / 'N/D' sin dato), que la lectura ocurra una sola vez por proveedor (al cerrar y reabrir, al repintar la vista y con otro
// proveedor aparte), el indicador mientras carga, y que un fallo deje 'N/D' sin romper el resto (y se reintente al reabrir).
//
// Uso: node scripts/verificar-cxp-pagos-forma-pago.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js'];

const abono = (id, monto, fecha, grupo) => ({ abonoId: id, monto, fecha, referencia: '', registradoPor: 'u', ...(grupo ? { grupoPagoId: grupo } : {}) });
const cuenta = (id, proveedor, ticket, estado, abonos) => ({
  id, proveedor, ticket, material: 'PET', kg: 100, precioEfectivo: 10, total: 1000, iva: 0, pagado: 0, saldo: 0, estado,
  fechaTicket: '2026-09-01', abonos
});
// ALFA: 12/10 = g2 (transferencia) 1,600 · 05/10 = g1 (efectivo) 400 + g3 (transferencia) 30 -> día mixto · 01/10 = sin grupoPagoId.
const CUENTAS = [
  cuenta('c1', 'ALFA', '101', 'liquidado', [abono('a1', 400, '2026-10-05', 'g1'), abono('a2', 600, '2026-10-12', 'g2')]),
  cuenta('c2', 'ALFA', '102', 'liquidado', [abono('a3', 1000, '2026-10-12', 'g2')]),
  cuenta('c3', 'ALFA', '103', 'parcial', [abono('a4', 30, '2026-10-05', 'g3'), abono('a5', 50, '2026-10-01')]),
  cuenta('c4', 'BETA', '201', 'parcial', [abono('b1', 70, '2026-10-06', 'g9')])
];
// recibos_pago de todos los proveedores: el filtro where('proveedor', '==', ...) lo aplica el Firestore simulado.
const RECIBOS = [
  { id: 'r1', proveedor: 'ALFA', grupoPagoId: 'g1', formaPago: 'efectivo' },
  { id: 'r2', proveedor: 'ALFA', grupoPagoId: 'g2', formaPago: 'transferencia' },
  { id: 'r3', proveedor: 'ALFA', grupoPagoId: 'g3', formaPago: 'transferencia' },
  { id: 'r4', proveedor: 'BETA', grupoPagoId: 'g9', formaPago: 'efectivo' },
  { id: 'r5', proveedor: 'OTRO', grupoPagoId: 'g1', formaPago: 'transferencia' }
];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// modo: 'normal' (responde de inmediato) | 'lento' (la lectura queda pendiente hasta window.__resolver()) | 'falla'.
async function nuevaPagina(browser, { modo = 'normal' } = {}) {
  const page = await browser.newPage();
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, recibos, modoLectura }) => {
    window.lecturasRecibos = [];
    window.modoLectura = modoLectura;
    const crearConsulta = (coleccion, filtros) => ({
      where(campo, op, valor) { return crearConsulta(coleccion, [...filtros, [campo, op, valor]]); },
      orderBy() { return crearConsulta(coleccion, filtros); },
      get() {
        if (coleccion !== 'recibos_pago') return Promise.resolve({ docs: [] });
        window.lecturasRecibos.push(filtros.map((f) => f.join(' ')).join(' & '));
        if (window.modoLectura === 'falla') return Promise.reject(new Error('sin permiso'));
        const docs = recibos
          .filter((r) => filtros.every(([campo, , valor]) => r[campo] === valor))
          .map((r) => ({ id: r.id, data: () => ({ ...r }) }));
        if (window.modoLectura === 'lento') return new Promise((resolver) => { window.__resolver = () => resolver({ docs }); });
        return Promise.resolve({ docs });
      }
    });
    window.db = { collection: (coleccion) => crearConsulta(coleccion, []) };
    window.puedeEscribir = () => true;
    window.puedeLeer = () => true;
    window.showError = () => {};
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: { cxp: 'escritura', pagos: 'escritura' } },
      registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], proveedores: [], ventas: [], precios: [],
      composiciones: [], recibosPendientes: [], auditorias: [], metaPiezasDia: {}, cuentasPorPagar: cs
    };
    window.EVE_MODULES.cxp.render(document.getElementById('main-content'));
  }, { cs: CUENTAS, recibos: RECIBOS, modoLectura: modo });
  return page;
}

const abrirProveedor = async (page, nombre) => {
  const tarjeta = page.locator('.card', { has: page.locator('h3, h4, strong', { hasText: new RegExp(`^${nombre}$`) }) }).first();
  await tarjeta.locator('button', { hasText: 'Ver Detalle' }).click();
  await page.waitForSelector(`#cxp-tabla-cuentas-${nombre}`);
};
const formasPorDia = (page) => page.$$eval('details.cxp-pagos-por-dia > table > tbody > tr', (filas) => filas
  .filter((r) => r.cells.length > 1).map((r) => [r.cells[0].textContent.trim(), r.cells[2].textContent.trim()]));
// Espera a que todas las celdas de forma de pago tengan su valor final (ni vacías ni 'Cargando…').
const esperarFormas = (page) => page.waitForFunction(() => {
  const filas = Array.from(document.querySelectorAll('details.cxp-pagos-por-dia > table > tbody > tr')).filter((r) => r.cells.length > 1);
  return filas.length > 0 && filas.every((r) => r.cells[2].textContent.trim() && !r.cells[2].textContent.includes('Cargando'));
});
const lecturas = (page) => page.evaluate(() => window.lecturasRecibos.slice());
const resumen = (page) => page.locator('details.cxp-pagos-por-dia > summary');

caso('desglosarFormasPagoDiaCxP: cruza por grupoPagoId; una forma = su nombre, varias = desglose con montos, sin dato = N/D', async (browser) => {
  const page = await nuevaPagina(browser);
  const r = await page.evaluate(() => {
    const f = window.EVE_CXP.desglosarFormasPagoDiaCxP;
    const dia = (grupos) => ({ grupos });
    const mapa = new Map([['g1', 'efectivo'], ['g2', 'transferencia']]);
    return [
      f(dia([{ grupoPagoId: 'g1', monto: 5 }]), mapa),
      f(dia([{ grupoPagoId: 'g1', monto: 5 }, { grupoPagoId: 'g1b', monto: 1 }].slice(0, 1)), mapa),
      f(dia([{ grupoPagoId: 'g1', monto: 400 }, { grupoPagoId: 'g2', monto: 1600.5 }]), mapa),
      f(dia([{ grupoPagoId: 'g2', monto: 10 }, { grupoPagoId: '', monto: 5 }]), mapa),
      f(dia([{ grupoPagoId: 'x', monto: 10 }]), mapa),
      f(dia([{ grupoPagoId: 'g1', monto: 10 }]), null),
      f(dia([{ grupoPagoId: 'g1', monto: 1 }, { grupoPagoId: 'g1c', monto: 1 }]), new Map([['g1', 'efectivo'], ['g1c', 'efectivo']]))
    ];
  });
  igual(r, ['Efectivo', 'Efectivo', 'Efectivo $400.00 · Transferencia $1,600.50', 'Transferencia $10.00 · N/D $5.00', 'N/D', 'N/D', 'Efectivo'], 'desgloses');
});

caso("al abrir 'Pagos por día' cada día muestra su forma de pago cruzada por grupoPagoId (día mixto con desglose, sin recibo = N/D)", async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirProveedor(page, 'ALFA');
  igual(await lecturas(page), [], 'sin lecturas hasta abrir el desplegable');
  await resumen(page).click();
  await esperarFormas(page);
  igual(await formasPorDia(page), [
    ['12/10/2026', 'Transferencia'],
    ['05/10/2026', 'Efectivo $400.00 · Transferencia $30.00'],
    ['01/10/2026', 'N/D']
  ], 'forma de pago por día');
});

caso('la consulta es solo de recibos_pago del proveedor (no del OTRO proveedor con el mismo grupoPagoId) y ocurre una sola vez', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirProveedor(page, 'ALFA');
  await resumen(page).click();
  await esperarFormas(page);
  igual(await lecturas(page), ['proveedor == ALFA'], 'lectura filtrada por proveedor');
  igual((await formasPorDia(page))[1][1].includes('Efectivo $400.00'), true, 'g1 de ALFA es efectivo (no el g1 de OTRO)');
  // Cerrar y reabrir: sin lectura nueva.
  await resumen(page).click();
  await resumen(page).click();
  igual(await formasPorDia(page), [['12/10/2026', 'Transferencia'], ['05/10/2026', 'Efectivo $400.00 · Transferencia $30.00'], ['01/10/2026', 'N/D']], 'formas tras reabrir');
  igual((await lecturas(page)).length, 1, 'lecturas tras cerrar y reabrir');
  // Repintar la vista ('Ver liquidados' re-renderiza): el desplegable sigue abierto y no vuelve a leer.
  await page.locator('#cxp-tabla-cuentas-ALFA button', { hasText: 'Ver liquidados' }).click();
  await page.waitForSelector('details.cxp-pagos-por-dia[open]');
  igual((await formasPorDia(page))[0][1], 'Transferencia', 'forma tras repintar');
  igual((await lecturas(page)).length, 1, 'lecturas tras repintar la vista');
});

caso('cada proveedor lee una sola vez: BETA tiene su propia lectura y no repite la de ALFA', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirProveedor(page, 'ALFA');
  await resumen(page).click();
  await esperarFormas(page);
  await abrirProveedor(page, 'BETA');
  await page.locator('#cxp-tabla-cuentas-BETA').locator('xpath=ancestor::div[contains(@class,"card")][1]').locator('details.cxp-pagos-por-dia > summary').click();
  await page.waitForFunction(() => document.querySelectorAll('details.cxp-pagos-por-dia[open]').length >= 1);
  await page.waitForTimeout(200);
  igual((await lecturas(page)).sort(), ['proveedor == ALFA', 'proveedor == BETA'], 'una lectura por proveedor');
});

caso("mientras carga se ve un indicador discreto 'Cargando…' y al llegar el dato lo reemplaza", async (browser) => {
  const page = await nuevaPagina(browser, { modo: 'lento' });
  await abrirProveedor(page, 'ALFA');
  await resumen(page).click();
  await page.waitForFunction(() => document.querySelector('details.cxp-pagos-por-dia').textContent.includes('Cargando…'));
  igual((await formasPorDia(page)).map((f) => f[1]), ['Cargando…', 'Cargando…', 'Cargando…'], 'indicador');
  afirmar(await page.locator('details.cxp-pagos-por-dia button', { hasText: 'Ver tickets' }).first().isEnabled(), 'el resto sigue usable mientras carga');
  await page.evaluate(() => window.__resolver());
  await esperarFormas(page);
  igual((await formasPorDia(page))[0][1], 'Transferencia', 'dato final');
});

caso("si la lectura falla: 'N/D' en cada día, el resto del bloque sigue funcionando y al reabrir se reintenta", async (browser) => {
  const page = await nuevaPagina(browser, { modo: 'falla' });
  await abrirProveedor(page, 'ALFA');
  await resumen(page).click();
  await esperarFormas(page);
  igual((await formasPorDia(page)).map((f) => f[1]), ['N/D', 'N/D', 'N/D'], 'N/D por falla');
  await page.locator('details.cxp-pagos-por-dia button', { hasText: 'Ver tickets' }).first().click();
  afirmar((await page.locator('details.cxp-pagos-por-dia').textContent()).includes('$600.00'), 'el detalle por ticket sigue funcionando');
  igual((await page.locator('details.cxp-pagos-por-dia summary').textContent()), 'Pagos por día (3)', 'resumen intacto');
  await page.evaluate(() => { window.modoLectura = 'normal'; });
  await resumen(page).click();
  await resumen(page).click();
  await page.waitForFunction(() => window.lecturasRecibos.length >= 2); // el evento toggle es asíncrono: espera el reintento
  await esperarFormas(page);
  igual((await formasPorDia(page))[0][1], 'Transferencia', 'reintento correcto');
  igual((await lecturas(page)).length, 2, 'la lectura fallida no se cacheó');
});

caso('un pago nuevo (grupoPagoId que la lectura anterior no cubría) provoca una lectura nueva; sin pago nuevo, no', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirProveedor(page, 'ALFA');
  await resumen(page).click();
  await esperarFormas(page);
  await page.evaluate(() => {
    window.EVE.cuentasPorPagar.find((c) => c.id === 'c4').abonos.push({ abonoId: 'zz', monto: 5, fecha: '2026-10-20', grupoPagoId: 'gNUEVO' });
    window.EVE.cuentasPorPagar.find((c) => c.id === 'c3').abonos.push({ abonoId: 'yy', monto: 9, fecha: '2026-10-20', grupoPagoId: 'gNUEVO' });
    window.db.collection('x');
  });
  await page.locator('#cxp-tabla-cuentas-ALFA button', { hasText: 'Ver liquidados' }).click();
  await page.waitForFunction(() => document.querySelectorAll('details.cxp-pagos-por-dia[open] tbody tr').length > 0);
  await esperarFormas(page);
  igual((await lecturas(page)).length, 2, 'lectura nueva por el grupoPagoId nuevo');
  igual((await formasPorDia(page))[0], ['20/10/2026', 'N/D'], 'el pago nuevo sin recibo queda N/D');
  await page.locator('#cxp-tabla-cuentas-ALFA button', { hasText: 'Ocultar liquidados' }).click();
  await esperarFormas(page);
  igual((await lecturas(page)).length, 2, 'sin otro pago nuevo no se vuelve a leer aunque ese grupo no tenga recibo');
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
