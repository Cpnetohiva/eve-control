// Columna y filtro de cliente en CxC → Todos, y sugerencias del filtro de cliente en Cobros → Todos.
// Monta los módulos reales en un navegador (Playwright) con datos en memoria y comprueba:
//  - CxC Todos: columna Cliente justo después de Folio (y solo ahí: la tabla de Por Cliente no la lleva), ordenable;
//  - filtro por cliente (con sugerencias normalizadas) y por folio en Hoy, Esta Semana, Este Mes y Personalizado;
//  - con un cliente elegido y Personalizado vacío se ven TODAS sus CxC (cliente liquidado y viejo, sin tarjeta en Por Cliente);
//  - filtro vacío = lo mismo que antes; Exportar CSV con la columna Cliente y respetando lo que se ve;
//  - Cobros Todos: la columna Cliente y el filtro de cliente que ya existían, ahora con sugerencias y sin duplicar el campo.
//
// Uso: node scripts/verificar-cliente-en-listas.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/ordenar-tabla.js', 'js/cxp.js', 'js/saldo-clientes.js', 'js/cxc.js', 'js/cobros.js'];
const HOY = '2026-11-02';
const VIEJA = '2026-01-10';

const cuenta = (id, cliente, folio, total, fecha, pagado = 0) => ({
  id, ventaId: 'v' + id, cliente, folio, material: 'PET', cantidad: 10, unidad: 'KG', precioUnitario: total / 10, total, pagado,
  saldo: total - pagado, estado: pagado >= total ? 'liquidado' : (pagado > 0 ? 'parcial' : 'pendiente'), fechaVenta: fecha,
  abonos: pagado > 0 ? [{ abonoId: 'a' + id, monto: pagado, fecha, referencia: 'Efectivo', registradoPor: 'u', grupoPagoId: 'g' + id }] : [], abonosRevertidos: []
});
// CHINOS QUERETARO: V-2026-045 liquidada y vieja → no tiene tarjeta en Por Cliente (sin saldo ni saldo a favor).
const CUENTAS = [
  cuenta('c1', 'CHINOS QUERETARO', 'V-2026-045', 5000, VIEJA, 5000),
  cuenta('c2', 'ACME', 'V-2026-100', 1000, HOY),
  cuenta('c3', 'ACME', 'V-2026-101', 700, VIEJA),
  cuenta('c4', 'BETA SA', 'V-2026-102', 300, HOY)
];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, modulo, { cuentas = CUENTAS, cobros = [], ventas = [] } = {}) {
  const page = await browser.newPage();
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(({ cs, co, vs, modulo, hoy }) => {
    window.csv = [];
    window.exportarCSV = (filas, nombre) => window.csv.push({ nombre, filas });
    window.puedeEscribir = () => true;
    window.puedeLeer = () => true;
    window.showError = () => {};
    window.obtenerFechaMexico = () => hoy;
    window.EVE_HISTORIAL = { registrar: async () => {} };
    window.EVE = { currentUser: { username: 'prueba' }, cuentasPorCobrar: cs, clientes: [], cobros: co, ventas: vs, registrosVentas: [], proveedores: [] };
    window.EVE_MODULES[modulo].render(document.getElementById('main-content'));
  }, { cs: cuentas, co: cobros, vs: ventas, modulo, hoy: HOY });
  return page;
}

const irATodos = async (page, subpestana) => {
  await page.locator('#cxc-tabs-principales button', { hasText: 'Todos' }).click();
  await page.locator('#cxc-todos-wrapper .tabs button', { hasText: subpestana }).click();
};
const encabezados = (page) => page.$$eval('#cxc-todos-contenido thead th', (ths) => ths.map((t) => t.textContent.trim()));
const folios = (page) => page.$$eval('#cxc-tabla-cuentas-todas > tr', (rs) => rs.filter((r) => r.cells.length > 2).map((r) => r.cells[0].textContent.trim()).sort());
const escribir = async (page, id, valor) => { await page.fill(id, valor); };

caso('CxC Todos: columna Cliente justo después de Folio, ordenable; Por Cliente no la lleva', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  await irATodos(page, 'Hoy');
  igual((await encabezados(page)).slice(0, 4), ['Folio', 'Cliente', 'Material', 'Cantidad'], 'encabezados');
  igual(await page.$$eval('#cxc-todos-contenido tbody tr', (rs) => rs.filter((r) => r.cells.length > 2).map((r) => [r.cells[0].textContent.trim(), r.cells[1].textContent.trim()]).sort()),
    [['V-2026-100', 'ACME'], ['V-2026-102', 'BETA SA']], 'cliente en cada fila');
  igual(await page.$eval('#cxc-todos-contenido thead th:nth-child(2)', (th) => th.getAttribute('data-tipo')), 'texto', 'columna ordenable (data-tipo)');
  await page.locator('#cxc-todos-contenido thead th:nth-child(2)').click();
  const orden = await page.$$eval('#cxc-todos-contenido tbody tr', (rs) => rs.filter((r) => r.cells.length > 2).map((r) => r.cells[1].textContent.trim()));
  afirmar(JSON.stringify(orden) === JSON.stringify([...orden].sort()) || JSON.stringify(orden) === JSON.stringify([...orden].sort().reverse()), 'clic en Cliente ordena: ' + orden);
  // Por Cliente: la tabla del detalle conserva sus columnas.
  await page.locator('#cxc-tabs-principales button', { hasText: 'Por Cliente' }).click();
  await page.locator('#cxc-clientes-contenido button', { hasText: 'Ver Detalle' }).first().click();
  const detalle = await page.$$eval('#cxc-clientes-contenido thead th', (ths) => ths.map((t) => t.textContent.trim()));
  afirmar(!detalle.includes('Cliente') && detalle[0] === 'Folio' && detalle[1] === 'Material', 'Por Cliente sin columna Cliente: ' + detalle);
  await page.close();
});

caso('el detalle de abonos en Todos ocupa todas las columnas (colSpan 11)', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  await irATodos(page, 'Personalizado');
  await page.locator('#cxc-todos-contenido tbody tr', { hasText: 'V-2026-045' }).locator('button').click();
  igual(await page.$eval('#cxc-todos-contenido tbody tr td[colspan]', (td) => [td.colSpan, document.querySelectorAll('#cxc-todos-contenido .destaraje-tabla-wrapper > table > thead th').length]), [11, 11], 'colSpan = columnas');
  await page.close();
});

caso('filtro por cliente en Hoy, Esta Semana y Este Mes: filtra dentro del periodo', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  for (const sub of ['Hoy', 'Esta Semana', 'Este Mes']) {
    await irATodos(page, sub);
    igual(await page.isVisible('#cxc-filtro-cliente'), true, `${sub}: el campo Cliente está visible`);
    igual(await page.isVisible('#cxc-filtro-desde'), false, `${sub}: las fechas siguen solo en Personalizado`);
    await escribir(page, '#cxc-filtro-cliente', '');
    igual(await folios(page), ['V-2026-100', 'V-2026-102'], `${sub}: sin filtro, lo de siempre`);
    await escribir(page, '#cxc-filtro-cliente', 'acme');
    igual(await folios(page), ['V-2026-100'], `${sub}: cliente ACME (minúsculas)`);
    await escribir(page, '#cxc-filtro-cliente', 'inexistente');
    afirmar((await page.textContent('#cxc-todos-contenido')).includes('Sin registros con ese filtro'), `${sub}: aviso sin resultados`);
    await escribir(page, '#cxc-filtro-cliente', '');
  }
  await page.close();
});

caso('Personalizado vacío con cliente elegido: se ven TODAS sus CxC (cliente liquidado sin tarjeta en Por Cliente)', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  // CHINOS no tiene tarjeta en Por Cliente.
  igual((await page.textContent('#cxc-clientes-contenido')).includes('CHINOS'), false, 'sin tarjeta en Por Cliente');
  await irATodos(page, 'Personalizado');
  igual(await folios(page), ['V-2026-045', 'V-2026-100', 'V-2026-101', 'V-2026-102'], 'Personalizado vacío: todo');
  await escribir(page, '#cxc-filtro-cliente', 'chinos queretaro');
  igual(await folios(page), ['V-2026-045'], 'su CxC vieja y liquidada aparece');
  await page.locator('#cxc-todos-contenido tbody tr', { hasText: 'V-2026-045' }).locator('button').click();
  afirmar(await page.locator('#cxc-todos-contenido', { hasText: 'Revertir' }).isVisible(), 'puede abrir los abonos y ver Revertir');
  await escribir(page, '#cxc-filtro-cliente', 'acme');
  igual(await folios(page), ['V-2026-100', 'V-2026-101'], 'ACME: sus dos CxC, de cualquier fecha');
  await escribir(page, '#cxc-filtro-cliente', '  Beta ');
  igual(await folios(page), ['V-2026-102'], 'coincidencia parcial con espacios y mayúsculas');
  await escribir(page, '#cxc-filtro-cliente', '');
  igual(await folios(page), ['V-2026-045', 'V-2026-100', 'V-2026-101', 'V-2026-102'], 'filtro vacío: vuelve todo');
  // El filtro de fechas de Personalizado sigue funcionando junto con el cliente.
  await page.fill('#cxc-filtro-desde', '2026-11-01');
  await page.dispatchEvent('#cxc-filtro-desde', 'change');
  await escribir(page, '#cxc-filtro-cliente', 'acme');
  igual(await folios(page), ['V-2026-100'], 'cliente + desde');
  await page.close();
});

caso('buscador por folio en todas las subpestañas, combinable con el cliente', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  await irATodos(page, 'Personalizado');
  await escribir(page, '#cxc-filtro-folio', '045');
  igual(await folios(page), ['V-2026-045'], 'folio parcial en Personalizado');
  await escribir(page, '#cxc-filtro-folio', 'v-2026-10');
  igual(await folios(page), ['V-2026-100', 'V-2026-101', 'V-2026-102'], 'folio sin distinguir mayúsculas');
  await escribir(page, '#cxc-filtro-cliente', 'acme');
  igual(await folios(page), ['V-2026-100', 'V-2026-101'], 'folio + cliente');
  await irATodos(page, 'Hoy');
  igual(await page.inputValue('#cxc-filtro-folio'), 'v-2026-10', 'el filtro se conserva al cambiar de subpestaña');
  igual(await folios(page), ['V-2026-100'], 'Hoy: folio + cliente dentro del periodo');
  await page.close();
});

caso('sugerencias del cliente: ventas y CxC, normalizadas, sin repetir y ordenadas', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc', { ventas: [{ cliente: ' gama ' }, { cliente: 'acme' }, { cliente: '' }] });
  await irATodos(page, 'Hoy');
  igual(await page.$$eval('#cxc-filtro-clientes option', (os) => os.map((o) => o.value)), ['ACME', 'BETA SA', 'CHINOS QUERETARO', 'GAMA'], 'opciones');
  await page.close();
});

caso('Exportar CSV de Todos: trae la columna Cliente y exporta lo que se ve (filtro y periodo)', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  await irATodos(page, 'Personalizado');
  await escribir(page, '#cxc-filtro-cliente', 'acme');
  await page.locator('button', { hasText: 'Exportar CSV' }).click();
  const r = await page.evaluate(() => window.csv.map((c) => ({ nombre: c.nombre.split('_').slice(0, 4).join('_'), claves: Object.keys(c.filas[0] || {}), folios: c.filas.map((f) => f.Folio).sort(), clientes: [...new Set(c.filas.map((f) => f.Cliente))] })));
  igual(r[0].claves.slice(0, 3), ['Folio', 'Cliente', 'Material'], 'detalle: Cliente después de Folio');
  igual([r[0].folios, r[0].clientes], [['V-2026-100', 'V-2026-101'], ['ACME']], 'detalle: solo el cliente filtrado');
  await escribir(page, '#cxc-filtro-cliente', 'chinos');
  await page.evaluate(() => { window.csv.length = 0; });
  await page.locator('button', { hasText: 'Exportar CSV' }).click();
  const abonos = await page.evaluate(() => window.csv[1].filas.map((f) => [f.Folio, f.Cliente]));
  igual(abonos, [['V-2026-045', 'CHINOS QUERETARO']], 'abonos: columna Cliente y solo el cliente filtrado');
  await escribir(page, '#cxc-filtro-cliente', '');
  await irATodos(page, 'Hoy');
  await page.evaluate(() => { window.csv.length = 0; });
  await page.locator('button', { hasText: 'Exportar CSV' }).click();
  igual(await page.evaluate(() => window.csv[0].filas.map((f) => f.Folio).sort()), ['V-2026-100', 'V-2026-102'], 'Hoy exporta solo hoy');
  await page.close();
});

caso('Vista para captura de Todos usa el mismo filtro (con cliente)', async (browser) => {
  const page = await nuevaPagina(browser, 'cxc');
  await page.evaluate(() => { window.VistaCaptura = { abrir: (cfg) => { window.captura = cfg; } }; });
  await irATodos(page, 'Personalizado');
  await page.fill('#cxc-filtro-desde', '2026-01-01');
  await page.dispatchEvent('#cxc-filtro-desde', 'change');
  await escribir(page, '#cxc-filtro-cliente', 'acme');
  await page.locator('#btn-vista-captura-cxc').click();
  igual(await page.evaluate(() => window.captura.filas.map((f) => [f.cliente, f.saldo])), [['ACME', 1700]], 'solo el cliente filtrado');
  await page.close();
});

caso('Cobros Todos: la columna Cliente y el filtro de cliente ya existían; ahora con sugerencias, sin campo duplicado', async (browser) => {
  const cobros = [
    { id: 'k1', cliente: 'ACME', folio: 'V-2026-100', material: 'PET', cantidad: 5, pagado: 400, fecha: HOY, referencia: 'Efectivo' },
    { id: 'k2', cliente: 'CHINOS QUERETARO', folio: 'V-2026-045', material: 'PET', cantidad: 5, pagado: 5000, fecha: VIEJA, referencia: 'Transferencia' },
    { id: 'k3', cliente: 'ZETA', folio: '', material: '', cantidad: 0, pagado: 90, fecha: HOY, origen: 'anticipo' }
  ];
  const page = await nuevaPagina(browser, 'cobros', { cobros });
  await page.locator('#main-content .tabs button', { hasText: 'Todos' }).click();
  igual((await page.$$eval('#cobros-tabla', (t) => t.length)), 1, 'una sola tabla');
  igual(await page.$$eval('#main-content thead th', (ths) => ths.map((t) => t.textContent.trim()).slice(0, 3)), ['Folio', 'Cliente', 'Material'], 'columna Cliente visible');
  igual(await page.$$eval('#cbf-cliente', (x) => x.length), 1, 'un solo campo de filtro por cliente (no se duplicó)');
  igual(await page.getAttribute('#cbf-cliente', 'list'), 'cbf-clientes', 'enlazado a sus sugerencias');
  igual(await page.$$eval('#cbf-clientes option', (os) => os.map((o) => o.value)), ['ACME', 'BETA SA', 'CHINOS QUERETARO', 'ZETA'], 'sugerencias: CxC más los clientes de los cobros');
  const filas = () => page.$$eval('#cobros-tabla tr', (rs) => rs.map((r) => r.cells[0] ? r.cells[0].textContent.trim() : '').filter(Boolean).sort());
  igual(await filas(), ['V-2026-045', 'V-2026-100'], 'sin filtro (los anticipos sin folio salen con folio vacío)');
  await page.fill('#cbf-cliente', 'chinos');
  igual(await filas(), ['V-2026-045'], 'filtra por cliente, sin límite de fecha');
  await page.fill('#cbf-cliente', '');
  igual((await filas()).length, 2, 'filtro vacío: vuelve todo');
  await page.close();
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
