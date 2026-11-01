// Claridad del saldo a favor en 'Pagos por día' de CxP (js/cxp.js). Los movimientos de saldo a favor ya están en memoria
// (window.EVE.proveedores[].saldoAFavor): no hay lecturas nuevas. Un abono pagado con saldo a favor comparte grupoPagoId con un
// movimiento negativo del proveedor (o trae la referencia 'Saldo a favor aplicado') y NO tiene recibo en recibos_pago.
//
// Caso de referencia: anticipo 70010; aplicaciones 8964 + 11856 + 27253 + 21937 = 70010 -> saldo disponible 0.
// Cubre: forma 'Saldo a favor aplicado' (en vez de N/D) y desglose cuando el día mezcla formas; 'N/D' solo si el origen no se puede
// determinar; fila 'Anticipo recibido' mezclada por fecha (más reciente primero), con estilo propio y sin sumarse al total pagado;
// mini resumen (anticipos, aplicado, disponible) sin contar movimientos revertidos; origen por ticket ('Saldo a favor' / 'Pago con
// recibo'); y que la lectura de recibos_pago no incluya los grupos pagados con saldo a favor.
//
// Uso: node scripts/verificar-cxp-pagos-saldo-favor.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js'];

const abono = (id, monto, fecha, grupo, referencia) => ({ abonoId: id, monto, fecha, referencia: referencia || '', registradoPor: 'u', ...(grupo ? { grupoPagoId: grupo } : {}) });
const cuenta = (id, ticket, estado, abonos) => ({
  id, proveedor: 'ALFA', ticket, material: 'PET', kg: 100, precioEfectivo: 10, total: 1000, iva: 0, pagado: 0, saldo: 0, estado,
  fechaTicket: '2026-09-01', abonos
});
const mov = (monto, fecha, grupoPagoId, motivo, extra) => ({ monto, fecha, grupoPagoId, motivo, revertido: false, ...extra });

// Anticipo de 70,010 el 01/10 (recibo con sobrante, grupo gA); se aplica el 05/10 (8,964 + 11,856), el 12/10 (27,253) y el 20/10 (21,937).
const SALDO = [
  mov(70010, '2026-10-01', 'gA', 'Anticipo en recibo'),
  mov(-8964, '2026-10-05', 'gS1', 'Aplicado automáticamente a CxP del ticket 301'),
  mov(-11856, '2026-10-05', 'gS2', 'Aplicado manualmente a CxP del ticket 302'),
  mov(-27253, '2026-10-12', 'gS3', 'Aplicado manualmente a CxP del ticket 303'),
  mov(-21937, '2026-10-20', 'gS4', 'Aplicado manualmente a CxP del ticket 304'),
  // Revertido: no cuenta en ningún total.
  mov(5000, '2026-10-02', 'gR', 'Anticipo revertido', { revertido: true, revertidoMotivo: 'error' })
];
const CUENTAS = [
  cuenta('c1', '301', 'liquidado', [abono('a1', 8964, '2026-10-05', 'gS1', 'Saldo a favor aplicado automáticamente')]),
  // Mismo día 05/10: un ticket pagado con saldo a favor y otro con recibo en efectivo (día mixto).
  cuenta('c2', '302', 'liquidado', [abono('a2', 11856, '2026-10-05', 'gS2', 'Saldo a favor aplicado')]),
  cuenta('c3', '305', 'parcial', [abono('a3', 1000, '2026-10-05', 'gE1')]),
  cuenta('c4', '303', 'liquidado', [abono('a4', 27253, '2026-10-12', 'gS3', 'Saldo a favor aplicado')]),
  cuenta('c5', '304', 'liquidado', [abono('a5', 21937, '2026-10-20', 'gS4', 'Saldo a favor aplicado')]),
  // Sin grupoPagoId ni referencia de saldo a favor: origen indeterminable -> N/D.
  cuenta('c6', '306', 'parcial', [abono('a6', 40, '2026-10-03')])
];
const RECIBOS = [{ id: 'r1', proveedor: 'ALFA', grupoPagoId: 'gE1', formaPago: 'efectivo' }];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, { saldo = SALDO, cuentas = CUENTAS } = {}) {
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
  }, { cs: cuentas, recibos: RECIBOS, saldoAFavor: saldo });
  await page.locator('button', { hasText: 'Ver Detalle' }).first().click();
  await page.waitForSelector('#cxp-tabla-cuentas-ALFA');
  return page;
}

const filasListado = (page) => page.$$eval('details.cxp-pagos-por-dia > table > tbody > tr', (filas) => filas
  .filter((r) => r.cells.length > 1)
  .map((r) => ({ anticipo: r.classList.contains('cxp-anticipo-fila'), celdas: [0, 1, 2, 3].map((i) => r.cells[i].textContent.trim()) })));
const abrir = async (page) => {
  await page.locator('details.cxp-pagos-por-dia > summary').click();
  await page.waitForFunction(() => {
    const filas = Array.from(document.querySelectorAll('details.cxp-pagos-por-dia > table > tbody > tr')).filter((r) => r.cells.length > 1);
    return filas.length > 0 && filas.every((r) => r.cells[2].textContent.trim() && !r.cells[2].textContent.includes('Cargando'));
  });
};

caso('caso de referencia: anticipo 70010 y aplicaciones 8964 + 11856 + 27253 + 21937 dan saldo disponible 0', async (browser) => {
  const page = await nuevaPagina(browser);
  const r = await page.evaluate((m) => window.EVE_CXP.resumirSaldoAFavorCxP(m), SALDO);
  igual([r.anticipos, r.aplicado, r.disponible], [70010, 70010, 0], 'anticipos / aplicado / disponible');
  igual(r.filasAnticipo, [{ fecha: '2026-10-01', monto: 70010 }], 'solo el anticipo activo');
  igual(8964 + 11856 + 27253 + 21937, 70010, 'aritmética del caso');
});

caso('mini resumen arriba del desplegable: Anticipos recibidos, Saldo aplicado a tickets y Saldo a favor disponible (sin revertidos)', async (browser) => {
  const page = await nuevaPagina(browser);
  const texto = (await page.textContent('.cxp-resumen-saldo-favor')).replace(/\s+/g, ' ');
  igual(texto, 'Anticipos recibidos: $70,010.00Saldo aplicado a tickets: $70,010.00Saldo a favor disponible: $0.00', 'mini resumen');
  const orden = await page.evaluate(() => {
    const resumen = document.querySelector('.cxp-resumen-saldo-favor');
    const detalles = document.querySelector('details.cxp-pagos-por-dia');
    return !!(resumen.compareDocumentPosition(detalles) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  afirmar(orden, 'el mini resumen va antes del desplegable');
});

caso("sin movimientos de saldo a favor no se muestra mini resumen ni filas de anticipo", async (browser) => {
  const page = await nuevaPagina(browser, { saldo: [], cuentas: [CUENTAS[2]] });
  afirmar(!(await page.$('.cxp-resumen-saldo-favor')), 'sin mini resumen');
  await abrir(page);
  igual((await filasListado(page)).filter((f) => f.anticipo).length, 0, 'sin filas de anticipo');
});

caso("forma de pago: 'Saldo a favor aplicado' en vez de N/D; día mixto con desglose; N/D solo sin origen determinable", async (browser) => {
  const page = await nuevaPagina(browser);
  await abrir(page);
  const formas = Object.fromEntries((await filasListado(page)).filter((f) => !f.anticipo).map((f) => [f.celdas[0], f.celdas[2]]));
  igual(formas['20/10/2026'], 'Saldo a favor aplicado', 'día solo saldo a favor');
  igual(formas['12/10/2026'], 'Saldo a favor aplicado', 'día solo saldo a favor');
  igual(formas['05/10/2026'], 'Efectivo $1,000.00 · Saldo a favor $20,820.00', 'día mixto: recibo en efectivo + saldo a favor');
  igual(formas['03/10/2026'], 'N/D', 'origen indeterminable');
});

caso("'Anticipo recibido': una fila por anticipo activo, mezclada por fecha (más reciente primero), con estilo distinto y sin sumarse al total", async (browser) => {
  const page = await nuevaPagina(browser);
  await abrir(page);
  const filas = await filasListado(page);
  igual(filas.map((f) => f.celdas[0]), ['20/10/2026', '12/10/2026', '05/10/2026', '03/10/2026', '01/10/2026'], 'orden cronológico descendente');
  igual(filas.map((f) => f.anticipo), [false, false, false, false, true], 'el anticipo es la fila marcada');
  igual(filas[4].celdas, ['01/10/2026', '$70,010.00', 'Anticipo recibido', '—'], 'fila del anticipo (el revertido no aparece)');
  // La página de prueba no carga styles.css: se revisa el estilo propio de la fila (variables de la paleta: gris claro y oro).
  const estilo = await page.$eval('tr.cxp-anticipo-fila', (tr) => ({ cursiva: tr.style.fontStyle, fondo: tr.style.background, borde: tr.style.boxShadow }));
  igual(estilo.cursiva, 'italic', 'estilo distinto');
  afirmar(estilo.fondo.includes('--gris-claro') && estilo.borde.includes('--oro'), `fondo y marca propios: ${JSON.stringify(estilo)}`);
  afirmar(!(await page.$eval('details.cxp-pagos-por-dia > table > tbody > tr:not(.cxp-anticipo-fila)', (tr) => tr.style.fontStyle)), 'las filas de pago no llevan ese estilo');
  // No se suma al total pagado: lo pagado a tickets = 8,964 + 11,856 + 1,000 + 27,253 + 21,937 + 40.
  const totales = filas.filter((f) => !f.anticipo).map((f) => Number(f.celdas[1].replace(/[$,]/g, '')));
  igual(Math.round(totales.reduce((a, b) => a + b, 0) * 100) / 100, 8964 + 11856 + 1000 + 27253 + 21937 + 40, 'total pagado a tickets sin el anticipo');
  igual(await page.textContent('details.cxp-pagos-por-dia > summary'), 'Pagos por día (4)', 'el contador cuenta solo días de pago');
});

caso("'Ver tickets' indica por ticket si fue 'Saldo a favor' o 'Pago con recibo'", async (browser) => {
  const page = await nuevaPagina(browser);
  await abrir(page);
  const fila05 = page.locator('details.cxp-pagos-por-dia > table > tbody > tr', { hasText: '05/10/2026' }).first();
  await fila05.locator('button', { hasText: 'Ver tickets' }).click();
  const tickets = await page.$$eval('details.cxp-pagos-por-dia table table tbody tr', (f) => f.filter((r) => r.offsetParent !== null)
    .map((r) => Array.from(r.cells).map((c) => c.textContent.trim())));
  igual(tickets.map((t) => [t[0], t[3]]).sort(), [['301', 'Saldo a favor'], ['302', 'Saldo a favor'], ['305', 'Pago con recibo']], 'origen por ticket');
});

caso('la lectura de recibos_pago es una sola y no incluye los grupos pagados con saldo a favor ni el anticipo', async (browser) => {
  const page = await nuevaPagina(browser);
  igual(await page.evaluate(() => window.lecturas), [], 'sin lecturas hasta abrir');
  await abrir(page);
  igual(await page.evaluate(() => window.lecturas), ['proveedor == ALFA'], 'una lectura al abrir');
  const ids = await page.evaluate(() => {
    const dias = window.EVE_CXP.agruparPagosPorDiaCxP(window.EVE.cuentasPorPagar, window.EVE.proveedores[0].saldoAFavor);
    return dias.flatMap((d) => d.grupos).filter((g) => g.grupoPagoId && !g.saldoAFavor).map((g) => g.grupoPagoId);
  });
  igual(ids, ['gE1'], 'solo el grupo con recibo se cruza con recibos_pago');
});

caso('si todos los pagos son con saldo a favor no se lee recibos_pago y se muestra la forma sin pasar por "Cargando…"', async (browser) => {
  const page = await nuevaPagina(browser, { cuentas: [CUENTAS[0], CUENTAS[3]] });
  await abrir(page);
  igual(await page.evaluate(() => window.lecturas), [], 'ninguna lectura');
  igual((await filasListado(page)).filter((f) => !f.anticipo).map((f) => f.celdas[2]), ['Saldo a favor aplicado', 'Saldo a favor aplicado'], 'formas');
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
