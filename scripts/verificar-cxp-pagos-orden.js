// Ordenamiento por columnas en 'Pagos por día' de CxP (js/cxp.js + js/ordenar-tabla.js, el mismo módulo y estilo de flechas que el
// resto de las tablas). Tabla de días: Fecha de pago (fecha real), Total pagado (numérico), Forma de pago (alfabético) y Tickets
// cubiertos (numérico), por defecto fecha descendente; las filas 'Anticipo recibido' se ordenan junto con los días y su detalle
// ('Ver tickets') viaja pegado a su día. Detalle por día: Ticket (999 antes que 1000), Material, Kg, Precio efectivo, Total del
// ticket, Monto pagado y Origen, con orden independiente por día. El orden y los días abiertos se conservan al repintar la vista.
// Sin lecturas nuevas a Firestore más allá de la de recibos_pago (forma de pago) que ya existía.
//
// Uso: node scripts/verificar-cxp-pagos-orden.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js'];

const abono = (id, monto, fecha, grupo) => ({ abonoId: id, monto, fecha, referencia: '', registradoPor: 'u', ...(grupo ? { grupoPagoId: grupo } : {}) });
const cuenta = (id, ticket, material, kg, precioEfectivo, total, estado, abonos) => ({
  id, proveedor: 'ALFA', ticket, material, kg, precioEfectivo, total, iva: 0, pagado: 0, saldo: 0, estado, fechaTicket: '2026-09-01', abonos
});
// Día A (05/10/2026, efectivo): tickets 999, 1000 y 85 (en ese orden de captura). Día B (12/10/2026, transferencia): 10 tickets de $120.
// Día C (03/11/2026): un ticket de $9,500 sin recibo (N/D). Anticipo de $70,000 el 08/10/2026. Como TEXTO, 03/11 < 05/10 y '$9,500.00' > '$70,000.00'.
const CUENTAS = [
  cuenta('c999', '999', 'HDPE', 1190, 7.8, 9282, 'liquidado', [abono('a1', 9282, '2026-10-05', 'gA')]),
  cuenta('c1000', '1000', 'ABS', 20, 100, 2000, 'parcial', [abono('a2', 1000, '2026-10-05', 'gA')]),
  cuenta('c85', '85', 'PET', 50, 10, 500, 'liquidado', [abono('a3', 500, '2026-10-05', 'gA')]),
  ...Array.from({ length: 10 }, (_, i) => cuenta(`b${i}`, String(2001 + i), 'PET', 12, 10, 120, 'liquidado', [abono(`ab${i}`, 120, '2026-10-12', 'gB')])),
  cuenta('c3000', '3000', 'PET', 95, 100, 9500, 'liquidado', [abono('a4', 9500, '2026-11-03')])
];
const SALDO = [{ monto: 70000, fecha: '2026-10-08', grupoPagoId: 'gAnt', motivo: 'Anticipo en recibo', revertido: false }];
const RECIBOS = [
  { id: 'r1', proveedor: 'ALFA', grupoPagoId: 'gA', formaPago: 'efectivo' },
  { id: 'r2', proveedor: 'ALFA', grupoPagoId: 'gB', formaPago: 'transferencia' }
];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, recibos, saldoAFavor }) => {
    window.lecturas = [];
    const crearConsulta = (coleccion, filtros) => ({
      where(campo, op, valor) { return crearConsulta(coleccion, [...filtros, [campo, op, valor]]); },
      orderBy() { return crearConsulta(coleccion, filtros); },
      get() {
        if (coleccion === 'recibos_pago') window.lecturas.push(filtros.map((f) => f.join(' ')).join(' & '));
        const docs = coleccion === 'recibos_pago'
          ? recibos.filter((r) => filtros.every(([campo, , valor]) => r[campo] === valor)).map((r) => ({ id: r.id, data: () => ({ ...r }) }))
          : [];
        return Promise.resolve({ docs });
      }
    });
    window.db = { collection: (coleccion) => crearConsulta(coleccion, []) };
    window.puedeEscribir = () => true;
    window.puedeLeer = () => true;
    window.showError = () => {};
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: { cxp: 'escritura', pagos: 'escritura' } },
      registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], ventas: [], precios: [],
      composiciones: [], recibosPendientes: [], auditorias: [], metaPiezasDia: {}, cuentasPorPagar: cs,
      proveedores: [{ id: 'ALFA', nombre: 'ALFA', saldoAFavor }]
    };
    window.EVE_MODULES.cxp.render(document.getElementById('main-content'));
  }, { cs: CUENTAS, recibos: RECIBOS, saldoAFavor: SALDO });
  await page.locator('button', { hasText: 'Ver Detalle' }).first().click();
  await page.waitForSelector('#cxp-tabla-cuentas-ALFA');
  await page.locator('details.cxp-pagos-por-dia > summary').click();
  await esperarFormas(page);
  return page;
}

const FILAS_DIAS = 'details.cxp-pagos-por-dia > table > tbody > tr';
const esperarFormas = (page) => page.waitForFunction(() => {
  const filas = Array.from(document.querySelectorAll('details.cxp-pagos-por-dia > table > tbody > tr')).filter((r) => r.cells.length > 1);
  return filas.length > 0 && filas.every((r) => r.cells[2].textContent.trim() && !r.cells[2].textContent.includes('Cargando'));
});
const dias = (page) => page.$$eval(FILAS_DIAS, (filas) => filas.filter((r) => r.cells.length > 1).map((r) => r.cells[0].textContent.trim()));
const columnaDias = (page, i) => page.$$eval(FILAS_DIAS, (filas, k) => filas.filter((r) => r.cells.length > 1).map((r) => r.cells[k].textContent.trim()), i);
const encabezadoDias = (page, i) => page.locator('details.cxp-pagos-por-dia > table > thead th').nth(i);
const claseFlecha = (page, i) => encabezadoDias(page, i).evaluate((th) => (th.classList.contains('th-ordenable-asc') ? 'asc' : (th.classList.contains('th-ordenable-desc') ? 'desc' : '')));
const abrirDetalle = async (page, fecha) => {
  await page.locator(FILAS_DIAS, { hasText: fecha }).first().locator('button', { hasText: 'Ver tickets' }).click();
};
// Detalle (tabla interna) del día dado: filas como texto de la columna i.
const detalleDia = (page, fecha, i) => page.evaluate(([f, k]) => {
  const fila = Array.from(document.querySelectorAll('details.cxp-pagos-por-dia > table > tbody > tr')).find((r) => r.cells.length > 1 && r.cells[0].textContent.trim() === f);
  const tabla = fila.nextElementSibling.querySelector('table');
  return Array.from(tabla.tBodies[0].rows).map((r) => r.cells[k].firstChild.textContent.trim());
}, [fecha, i]);
const encabezadoDetalle = (page, fecha, i) => page.locator(FILAS_DIAS, { hasText: fecha }).first().locator('xpath=following-sibling::tr[1]').locator('thead th').nth(i);

caso('por defecto: fecha de pago descendente (cronológica, con el anticipo mezclado) y flecha en la columna Fecha', async (browser) => {
  const page = await nuevaPagina(browser);
  igual(await dias(page), ['03/11/2026', '12/10/2026', '08/10/2026', '05/10/2026'], 'orden por defecto');
  igual(await claseFlecha(page, 0), 'desc', 'flecha en Fecha de pago');
  igual(await claseFlecha(page, 1), '', 'sin flecha en las demás');
  igual(await page.textContent('details.cxp-pagos-por-dia > summary'), 'Pagos por día (3)', 'el anticipo no cuenta como día de pago');
});

caso('Fecha de pago: un clic ordena ascendente (fecha real, no texto), otro clic descendente', async (browser) => {
  const page = await nuevaPagina(browser);
  await encabezadoDias(page, 0).click();
  igual(await dias(page), ['05/10/2026', '08/10/2026', '12/10/2026', '03/11/2026'], 'ascendente (como texto 03/11 saldría primero)');
  igual(await claseFlecha(page, 0), 'asc', 'flecha asc');
  await encabezadoDias(page, 0).click();
  igual(await dias(page), ['03/11/2026', '12/10/2026', '08/10/2026', '05/10/2026'], 'descendente');
  igual(await claseFlecha(page, 0), 'desc', 'flecha desc');
});

caso('Total pagado: numérico ($9,500 antes que $70,000), con el anticipo como una fila más y sin sumarse al total de los días', async (browser) => {
  const page = await nuevaPagina(browser);
  await encabezadoDias(page, 1).click();
  igual(await columnaDias(page, 1), ['$1,200.00', '$9,500.00', '$10,782.00', '$70,000.00'], 'ascendente numérico');
  igual(await dias(page), ['12/10/2026', '03/11/2026', '05/10/2026', '08/10/2026'], 'fechas en ese orden');
  await encabezadoDias(page, 1).click();
  igual(await columnaDias(page, 1), ['$70,000.00', '$10,782.00', '$9,500.00', '$1,200.00'], 'descendente');
  // El anticipo (fila propia) no entra en lo pagado a tickets: la suma de los días no lo incluye.
  const sumaDias = await page.$$eval(FILAS_DIAS, (f) => f.filter((r) => r.cells.length > 1 && !r.classList.contains('cxp-anticipo-fila'))
    .reduce((a, r) => a + Number(r.cells[1].textContent.replace(/[$,]/g, '')), 0));
  igual(Math.round(sumaDias * 100) / 100, 10782 + 1200 + 9500, 'total pagado a tickets sin el anticipo');
});

caso('Tickets cubiertos: numérico (3 antes que 10) y Forma de pago: alfabético', async (browser) => {
  const page = await nuevaPagina(browser);
  await encabezadoDias(page, 3).click();
  igual((await columnaDias(page, 3)).filter((x) => x !== '—'), ['1', '3', '10'], 'tickets cubiertos ascendente numérico');
  await encabezadoDias(page, 2).click();
  igual(await columnaDias(page, 2), ['Anticipo recibido', 'Efectivo', 'N/D', 'Transferencia'], 'forma de pago ascendente');
  await encabezadoDias(page, 2).click();
  igual(await columnaDias(page, 2), ['Transferencia', 'N/D', 'Efectivo', 'Anticipo recibido'], 'forma de pago descendente');
});

caso('el detalle de cada día viaja pegado a su día al ordenar (no queda al final)', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirDetalle(page, '05/10/2026');
  await encabezadoDias(page, 1).click();
  const siguiente = await page.$$eval(FILAS_DIAS, (filas) => filas.map((r) => (r.hasAttribute('data-fila-ligada') ? 'detalle' : r.cells[0].textContent.trim())));
  igual(siguiente, ['12/10/2026', 'detalle', '03/11/2026', 'detalle', '05/10/2026', 'detalle', '08/10/2026'], 'cada detalle sigue a su día (el anticipo no tiene)');
  igual(await detalleDia(page, '05/10/2026', 0), ['999', '1000', '85'], 'el detalle abierto es el del día 05/10');
});

caso('detalle: Ticket numérico (85, 999, 1000), Material, Kg, Precio, Total y Monto pagado numéricos, y toggle asc/desc', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirDetalle(page, '05/10/2026');
  igual(await detalleDia(page, '05/10/2026', 0), ['999', '1000', '85'], 'orden de captura por defecto');
  await encabezadoDetalle(page, '05/10/2026', 0).click();
  igual(await detalleDia(page, '05/10/2026', 0), ['85', '999', '1000'], 'Ticket ascendente (999 antes que 1000; como texto 1000 iría primero)');
  await encabezadoDetalle(page, '05/10/2026', 0).click();
  igual(await detalleDia(page, '05/10/2026', 0), ['1000', '999', '85'], 'Ticket descendente');
  await encabezadoDetalle(page, '05/10/2026', 1).click();
  igual(await detalleDia(page, '05/10/2026', 1), ['ABS', 'HDPE', 'PET'], 'Material alfabético');
  await encabezadoDetalle(page, '05/10/2026', 2).click();
  igual(await detalleDia(page, '05/10/2026', 2), ['20 KG', '50 KG', '1,190 KG'], 'Kg numérico');
  await encabezadoDetalle(page, '05/10/2026', 3).click();
  igual(await detalleDia(page, '05/10/2026', 3), ['$7.80', '$10.00', '$100.00'], 'Precio efectivo numérico');
  await encabezadoDetalle(page, '05/10/2026', 4).click();
  igual(await detalleDia(page, '05/10/2026', 4), ['$500.00', '$2,000.00', '$9,282.00'], 'Total del ticket numérico');
  await encabezadoDetalle(page, '05/10/2026', 5).click();
  igual(await detalleDia(page, '05/10/2026', 5), ['$500.00', '$1,000.00', '$9,282.00'], 'Monto pagado numérico ($1,000 va antes que $9,282; como texto iría primero)');
  await encabezadoDetalle(page, '05/10/2026', 6).click();
  igual(await detalleDia(page, '05/10/2026', 6), ['Pago con recibo', 'Pago con recibo', 'Pago con recibo'], 'Origen alfabético');
});

caso('el orden del detalle de cada día es independiente del de los demás y de la tabla de días', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirDetalle(page, '05/10/2026');
  await abrirDetalle(page, '12/10/2026');
  const antesB = await detalleDia(page, '12/10/2026', 0);
  igual(antesB, ['2001', '2002', '2003', '2004', '2005', '2006', '2007', '2008', '2009', '2010'], 'día B en orden de captura');
  await encabezadoDetalle(page, '05/10/2026', 0).click();
  await encabezadoDetalle(page, '05/10/2026', 0).click();
  igual(await detalleDia(page, '05/10/2026', 0), ['1000', '999', '85'], 'día A ordenado descendente');
  igual(await detalleDia(page, '12/10/2026', 0), antesB, 'día B intacto');
  await encabezadoDetalle(page, '12/10/2026', 0).click();
  await encabezadoDetalle(page, '12/10/2026', 0).click();
  igual((await detalleDia(page, '12/10/2026', 0))[0], '2010', 'día B descendente por su cuenta');
  igual(await detalleDia(page, '05/10/2026', 0), ['1000', '999', '85'], 'día A sigue igual');
  igual(await claseFlecha(page, 0), 'desc', 'la tabla de días conserva su flecha por defecto');
});

caso('el orden elegido (días y detalle) y los días abiertos se conservan al repintar la vista', async (browser) => {
  const page = await nuevaPagina(browser);
  await abrirDetalle(page, '05/10/2026');
  await encabezadoDias(page, 1).click();
  await encabezadoDetalle(page, '05/10/2026', 0).click();
  const diasAntes = await dias(page);
  const detalleAntes = await detalleDia(page, '05/10/2026', 0);
  igual(detalleAntes, ['85', '999', '1000'], 'detalle ordenado antes de repintar');
  // Repintar la vista de CxP completa ('Ver liquidados' la vuelve a dibujar).
  await page.locator('#cxp-tabla-cuentas-ALFA button', { hasText: 'Ver liquidados' }).click();
  await page.waitForSelector('details.cxp-pagos-por-dia[open]');
  await esperarFormas(page);
  igual(await dias(page), diasAntes, 'orden de los días tras repintar');
  igual(await claseFlecha(page, 1), 'asc', 'flecha de Total pagado tras repintar');
  igual(await detalleDia(page, '05/10/2026', 0), detalleAntes, 'orden del detalle tras repintar');
  igual(await page.locator(FILAS_DIAS, { hasText: '05/10/2026' }).first().locator('xpath=following-sibling::tr[1]').evaluate((tr) => tr.style.display), '', 'el día abierto sigue abierto');
  igual(await page.locator(FILAS_DIAS, { hasText: '12/10/2026' }).first().locator('xpath=following-sibling::tr[1]').evaluate((tr) => tr.style.display), 'none', 'el día cerrado sigue cerrado');
});

caso('al terminar de cargar la forma de pago, el orden por esa columna se reacomoda; solo hay una lectura de recibos_pago', async (browser) => {
  const page = await nuevaPagina(browser);
  await encabezadoDias(page, 2).click();
  igual(await columnaDias(page, 2), ['Anticipo recibido', 'Efectivo', 'N/D', 'Transferencia'], 'orden por forma de pago');
  igual(await page.evaluate(() => window.lecturas), ['proveedor == ALFA'], 'una sola lectura');
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
