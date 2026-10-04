// Verifica el orden del DETALLE por proveedor (A-Z, alias resueltos) y ticket (numérico ascendente, no numéricos al final) con
// desempate estable por fecha: la función compartida window.ordenarPorProveedorTicket (js/utils.js) y su aplicación en Báscula
// (Vista para captura en Hoy / Esta Semana / Todos, y TXT, PDF y CSV). Comprueba también que NO cambió lo que no debía:
// la tabla en pantalla, el desglose por material y por proveedor y los totales.
// La lógica pura corre en un contexto vm; la integración, en Chromium (Playwright) con los JS reales y Firebase simulado.
//
// Uso: node scripts/verificar-orden-proveedor-ticket.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const leer = (relativa) => fs.readFileSync(path.join(RAIZ, relativa), 'utf8');

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
  vm.createContext(sandbox);
  ['js/config.js', 'js/utils.js'].forEach((archivo) => vm.runInContext(leer(archivo), sandbox, { filename: archivo }));
  return sandbox.window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const r = (proveedor, ticket, fechaSalida, extra) => ({ proveedor, ticket, fechaSalida, material: 'PET', kg: 10, ...extra });
const tickets = (lista) => lista.map((x) => `${x.proveedor}#${x.ticket}`);

// ── Función compartida ─────────────────────────────────────────────────────────────────────────────────────────────────
caso('proveedor A-Z sin distinguir mayúsculas ni acentos, y ticket ascendente dentro de cada proveedor', () => {
  const w = crearContexto();
  const orden = w.ordenarPorProveedorTicket([r('Óscar', '5', 'a'), r('arturo lara', '2', 'a'), r('ARTURO LARA', '1', 'a'), r('Beto', '9', 'a'), r('oscar', '3', 'a')]);
  igual(tickets(orden), ['ARTURO LARA#1', 'arturo lara#2', 'Beto#9', 'oscar#3', 'Óscar#5'], 'Óscar/oscar y arturo lara/ARTURO LARA quedan juntos, y dentro de cada uno por ticket');
});

caso('alias de proveedor: J.ENRIQUE y JOSE ENRIQUE son el mismo y quedan juntos, entre FELIX y JUANA', () => {
  const w = crearContexto();
  const orden = w.ordenarPorProveedorTicket([
    r('JUANA', '1', 'a'), r('J.ENRIQUE', '30', 'a'), r('FELIX LOZANO', '7', 'a'), r('JOSE ENRIQUE', '10', 'a'), r('FÉLIX', '2', 'a'), r('J. ENRIQUE', '20', 'a')
  ]);
  igual(orden.map((x) => `${w.normalizarProveedor(x.proveedor)}#${x.ticket}`),
    ['FELIX LOZANO#2', 'FELIX LOZANO#7', 'JOSE ENRIQUE#10', 'JOSE ENRIQUE#20', 'JOSE ENRIQUE#30', 'JUANA#1'], 'alias fusionados y ordenados por ticket entre ellos');
  igual(orden.slice(2, 5).map((x) => x.proveedor), ['JOSE ENRIQUE', 'J. ENRIQUE', 'J.ENRIQUE'], 'el registro conserva su nombre original (no se reescribe)');
});

caso('tickets 999 / 1000 / 1010 se ordenan como número (no como texto) y 2 va antes que 10', () => {
  const w = crearContexto();
  igual(w.ordenarPorProveedorTicket([r('A', '1010', 'x'), r('A', '999', 'x'), r('A', '1000', 'x'), r('A', '10', 'x'), r('A', '2', 'x')]).map((x) => x.ticket), ['2', '10', '999', '1000', '1010'], 'orden numérico');
  igual(w.ordenarPorProveedorTicket([r('A', 1010, 'x'), r('A', 999, 'x'), r('A', 1000, 'x')]).map((x) => x.ticket), [999, 1000, 1010], 'tickets que son número (no texto)');
});

caso('ceros a la izquierda y números muy largos se comparan por su valor, sin perder precisión', () => {
  const w = crearContexto();
  igual(w.ordenarPorProveedorTicket([r('A', '0100', 'x'), r('A', '99', 'x'), r('A', '007', 'x'), r('A', '0', 'x')]).map((x) => x.ticket), ['0', '007', '99', '0100'], 'ceros a la izquierda');
  igual(w.ordenarPorProveedorTicket([r('A', '12345678901234567891', 'x'), r('A', '12345678901234567890', 'x'), r('A', '999', 'x')]).map((x) => x.ticket), ['999', '12345678901234567890', '12345678901234567891'], 'más de 15 dígitos');
});

caso('ticket no numérico: va después de los numéricos de su proveedor y entre ellos se ordena como texto', () => {
  const w = crearContexto();
  const orden = w.ordenarPorProveedorTicket([r('A', 'V', 'x'), r('A', '1000', 'x'), r('A', '12A', 'x'), r('A', '5', 'x'), r('A', 'B7', 'x'), r('A', '', 'x'), r('B', '1', 'x')]);
  igual(orden.map((x) => `${x.proveedor}#${x.ticket}`), ['A#5', 'A#1000', 'A#', 'A#12A', 'A#B7', 'A#V', 'B#1'], 'numéricos primero; el vacío y los de texto al final; no cruza proveedores');
});

caso('empates: mismo proveedor y ticket se desempatan por fecha ascendente y luego por posición original (estable)', () => {
  const w = crearContexto();
  const base = [r('A', '5', '2026-10-03', { id: 1 }), r('A', '5', '2026-10-01', { id: 2 }), r('A', '5', '2026-10-03', { id: 3 }), r('A', '5', '2026-10-02', { id: 4 }), r('A', '5', '2026-10-01', { id: 5 })];
  igual(w.ordenarPorProveedorTicket(base).map((x) => x.id), [2, 5, 4, 1, 3], 'fecha asc y, a igual fecha, orden de entrada');
  igual(w.ordenarPorProveedorTicket(base.slice().reverse()).map((x) => x.id), [5, 2, 4, 3, 1], 'estable también con la entrada invertida');
  igual(w.ordenarPorProveedorTicket([{ proveedor: 'A', ticket: '1', fecha: '2026-02-01', id: 1 }, { proveedor: 'A', ticket: '1', fecha: '2026-01-01', id: 2 }], 'proveedor', 'ticket', 'fecha').map((x) => x.id), [2, 1], 'campo de fecha configurable (Pagos usa "fecha")');
  igual(w.ordenarPorProveedorTicket([{ proveedor: 'A', ticket: '1', id: 1 }, { proveedor: 'A', ticket: '1', id: 2 }]).map((x) => x.id), [1, 2], 'sin fecha: conserva el orden de entrada');
});

caso('no modifica el arreglo original ni los registros, y tolera entradas vacías', () => {
  const w = crearContexto();
  const original = [r('B', '2', 'x'), r('A', '1', 'x')];
  const copia = JSON.stringify(original);
  const orden = w.ordenarPorProveedorTicket(original);
  igual(JSON.stringify(original), copia, 'el arreglo original no cambió');
  afirmar(orden !== original && orden[0] === original[1], 'devuelve una copia con los mismos objetos');
  igual([w.ordenarPorProveedorTicket([]), w.ordenarPorProveedorTicket(undefined), w.ordenarPorProveedorTicket(null)], [[], [], []], 'vacío, undefined y null');
  igual(w.ordenarPorProveedorTicket([{ ticket: '2' }, { proveedor: null, ticket: '1' }, { proveedor: 'A', ticket: undefined }]).map((x) => x.ticket), ['1', '2', undefined].map((x) => x), 'proveedor o ticket ausentes no rompen');
});

// ── Integración en Chromium (JS y CSS reales) ──────────────────────────────────────────────────────────────────────────
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="toast-container"></div><div id="main-content"></div>
<script>window.firebase={initializeApp(){},firestore(){return{enablePersistence(){return Promise.resolve()}}},auth(){return{onAuthStateChanged(){}}}};window.EVE_MODULES={};</script>
${['config.js', 'utils.js', 'permisos.js', 'ordenar-tabla.js', 'vista-captura.js', 'reportes.js', 'destaraje.js', 'pagos.js'].map((s) => `<script src="/js/${s}"></script>`).join('')}
</body></html>`;

// Registros de Báscula pensados para romper cualquier orden por fecha o por captura: fechas de salida mezcladas dentro de la semana.
function registrosPrueba(hoy, ayer) {
  const reg = (ticket, proveedor, fechaSalida, material, kg) => ({ id: `${proveedor}-${ticket}-${fechaSalida}`, ticket, proveedor, material, kg, fechaEntrada: fechaSalida, fechaSalida, fechaRegistro: `${fechaSalida}T10:00:00Z` });
  return [
    reg('1010', 'JUANA', hoy, 'PET', 100),
    reg('999', 'J.ENRIQUE', hoy, 'DURO', 50),
    reg('1000', 'JOSE ENRIQUE', ayer, 'PET', 70),
    reg('12', 'JUANA', ayer, 'MIXTO', 30),
    reg('5', 'FELIX LOZANO', hoy, 'PET', 20),
    reg('1005', 'JOSE ENRIQUE', hoy, 'DURO', 10)
  ];
}

async function abrirBascula(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  await page.route('http://eve.test/**', (ruta) => {
    const p = new URL(ruta.request().url()).pathname;
    if (p === '/') return ruta.fulfill({ contentType: 'text/html', body: HTML });
    const f = path.join(RAIZ, p);
    return fs.existsSync(f) ? ruta.fulfill({ path: f }) : ruta.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://eve.test/');
  await page.evaluate((fn) => {
    window.EVE = { currentUser: { username: 'prueba', permisosResueltos: { destaraje: 'lectura' } }, registrosDestaraje: [], registrosVentas: [], registrosPagos: [], registrosMinistraciones: [], cuentasPorPagar: [], proveedores: [], ventas: [], precios: [], composiciones: [], metaPiezasDia: {} };
    window.__descargas = { csv: null, txt: null, pdfBody: null };
    window.exportarCSV = (filas) => { window.__descargas.csv = filas; };
    window.descargarArchivo = (blob) => { window.__descargas.txt = blob; };
    // jsPDF simulado: registra el cuerpo de las tablas y acepta cualquier otra llamada.
    window.jspdf = { jsPDF: function () {
      const doc = new Proxy({}, { get: (_, nombre) => (nombre === 'internal' ? { pageSize: { getWidth: () => 210 } } : nombre === 'autoTable' ? (op) => { (window.__descargas.tablas = window.__descargas.tablas || []).push(op); } : nombre === 'save' ? () => {} : () => {}) });
      return doc;
    } };
  }, null);
  return { ctx, page };
}

async function cargarDatos(page, registros) {
  // Igual que el login (auth.js): los alias de proveedor se unifican al cargar los datos.
  await page.evaluate((regs) => { window.EVE.registrosDestaraje = window.unificarProveedorEnRegistros(regs); }, registros);
}

const fechas = (page) => page.evaluate(() => ({ hoy: window.obtenerFechaMexico(), ayer: (() => { const d = new Date(`${window.obtenerFechaMexico()}T12:00:00`); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })() }));
const ESPERADO_ORDEN = ['FELIX LOZANO#5', 'JOSE ENRIQUE#999', 'JOSE ENRIQUE#1000', 'JOSE ENRIQUE#1005', 'JUANA#12', 'JUANA#1010'];

async function filasVistaCaptura(page) {
  return page.$$eval('#vista-captura-overlay .captura-col-tickets .captura-tabla tbody tr', (trs) => trs.map((tr) => { const t = Array.from(tr.children).map((td) => td.textContent.trim()); return `${t[1]}#${t[0]}`; }));
}

caso('Báscula · Vista para captura: Hoy / Esta Semana / Todos salen planos, ordenados por proveedor y ticket (sin agrupar por fecha)', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  const { hoy, ayer } = await fechas(page);
  await cargarDatos(page, registrosPrueba(hoy, ayer));
  await page.evaluate(() => window.EVE_MODULES.destaraje.render(document.getElementById('main-content')));
  const semanaTienePrimerDia = await page.evaluate(() => { const d = new Date(`${window.obtenerFechaMexico()}T12:00:00`); return window.obtenerInicioSemana() <= new Date(d.getTime() - 86400000).toISOString().slice(0, 10); });
  for (const [pestana, esperaAyer] of [['Hoy', false], ['Esta Semana', true], ['Todos', true]]) {
    if (pestana === 'Esta Semana' && !semanaTienePrimerDia) continue; // lunes: "ayer" cae fuera de la semana
    await page.click(`.destaraje-subtabs .tab:has-text("${pestana}"), .tabs .tab:has-text("${pestana}")`);
    await page.click('#btn-vista-captura');
    const filas = await filasVistaCaptura(page);
    const esperado = ESPERADO_ORDEN.filter((t) => esperaAyer || !['JOSE ENRIQUE#1000', 'JUANA#12'].includes(t));
    // En pantalla J.ENRIQUE ya se muestra como lo guardó el registro; se compara por proveedor resuelto.
    const resueltos = await page.evaluate((f) => f.map((x) => { const [p, t] = x.split('#'); return `${window.normalizarProveedor(p)}#${t}`; }), filas);
    igual(resueltos, esperado, `orden en ${pestana}`);
    igual(await page.$$('#vista-captura-overlay .captura-dia-titulo').then((n) => n.length), 0, `sin encabezados por día en ${pestana}`);
    igual(await page.$$('#vista-captura-overlay .captura-tabla').then((n) => n.length) >= 2, true, `el resumen por material sigue presente en ${pestana}`);
    await page.evaluate(() => window.VistaCaptura.cerrar());
  }
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

caso('Báscula · la tabla principal en pantalla, los KPIs y el resumen por material NO cambian de orden ni de valor', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  const { hoy, ayer } = await fechas(page);
  const datos = registrosPrueba(hoy, ayer);
  await cargarDatos(page, datos);
  await page.evaluate(() => window.EVE_MODULES.destaraje.render(document.getElementById('main-content')));
  await page.click('.tabs .tab:has-text("Todos")');
  const antes = await page.evaluate(() => Array.from(document.querySelectorAll('#main-content table.tabla-destaraje tbody tr')).map((tr) => tr.children[0].textContent.trim() + '|' + tr.children[1].textContent.trim()));
  await page.click('#btn-vista-captura');
  const resumen = await page.$$eval('#vista-captura-overlay .captura-resumen table tbody tr', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim()).join(':')));
  const kpis = await page.$$eval('#vista-captura-overlay .captura-resumen-stat', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  await page.evaluate(() => window.VistaCaptura.cerrar());
  const despues = await page.evaluate(() => Array.from(document.querySelectorAll('#main-content table.tabla-destaraje tbody tr')).map((tr) => tr.children[0].textContent.trim() + '|' + tr.children[1].textContent.trim()));
  igual(despues, antes, 'tabla principal intacta tras abrir y cerrar la vista');
  igual(await page.evaluate(() => window.EVE.registrosDestaraje.map((x) => x.id)), datos.map((x) => x.id), 'los datos en memoria conservan su orden');
  afirmar(resumen.length >= 3 && kpis.length >= 2, `resumen/KPIs no encontrados: ${resumen.length}/${kpis.length}`);
  const totalKg = datos.reduce((s, x) => s + x.kg, 0);
  afirmar(kpis.join(' ').includes(String(datos.length)) && kpis.join(' ').includes(String(totalKg)), `KPIs distintos de los totales reales (${datos.length} / ${totalKg}): ${kpis.join(' | ')}`);
  const porMaterial = {};
  datos.forEach((x) => { porMaterial[x.material] = (porMaterial[x.material] || 0) + x.kg; });
  Object.keys(porMaterial).forEach((m) => afirmar(resumen.some((f) => f.startsWith(`${m}:`) && f.includes(String(porMaterial[m]))), `desglose de ${m} distinto de ${porMaterial[m]}: ${resumen.join(' | ')}`));
  await ctx.close();
});

caso('Báscula · CSV, TXT y PDF: detalle ordenado por proveedor y ticket; desglose y totales intactos', async (browser) => {
  const { ctx, page } = await abrirBascula(browser);
  const { hoy, ayer } = await fechas(page);
  await cargarDatos(page, registrosPrueba(hoy, ayer));
  const res = await page.evaluate(async () => {
    const filtros = { desde: '', hasta: '' };
    window.exportarReporteDestarajeCSV('todos', filtros);
    const csv = window.__descargas.csv.map((f) => `${window.normalizarProveedor(f.proveedorOCliente)}#${f.ticket}`);
    window.exportarReporteDestarajeTXT('todos', filtros);
    const txt = await window.__descargas.txt.text();
    window.exportarReporteDestarajePDF('todos', filtros);
    const tablas = window.__descargas.tablas || [];
    const detalle = tablas.length ? tablas[tablas.length - 1].body : [];
    return { csv, txt, pdf: detalle.map((f) => `${window.normalizarProveedor(f[1])}#${f[0]}`), tablasPdf: tablas.length };
  });
  igual(res.csv, ESPERADO_ORDEN, 'CSV');
  const lineas = res.txt.split('\n');
  const inicio = lineas.indexOf('  TICKET  PROVEEDOR  MATERIAL  KG  F.ENTRADA  F.SALIDA');
  afirmar(inicio >= 0, 'no se encontró el detalle en el TXT');
  igual(lineas.slice(inicio + 1).filter((l) => l.trim()).map((l) => l.trim().split(/\s{2}/)[0]), ['5', '999', '1000', '1005', '12', '1010'], 'TXT: tickets en orden');
  const txtProveedores = lineas.slice(inicio + 1).filter((l) => l.trim()).map((l) => l.trim().split(/\s{2}/)[1]);
  igual(txtProveedores, ['FELIX LOZANO', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JUANA', 'JUANA'], 'TXT: proveedores consecutivos (alias unidos)');
  igual(res.pdf, ESPERADO_ORDEN, 'PDF');
  // lo que NO debe cambiar: el desglose por proveedor del TXT se arma con los registros sin ordenar y los totales siguen iguales
  afirmar(res.txt.includes('TOTAL KG: 280'), `TOTAL KG distinto de 280: ${(res.txt.match(/TOTAL KG:.*/) || [''])[0]}`);
  afirmar(res.txt.includes('DESGLOSE POR MATERIAL:') && res.txt.includes('DESGLOSE POR PROVEEDOR + MATERIAL:'), 'faltan los desgloses');
  await ctx.close();
});

// Pagos: la fecha de cada pago es `fecha`; los revertidos no cuentan.
function registrosPagosPrueba(hoy, ayer) {
  const pago = (ticket, proveedor, fecha, material, kg, pagado, extra) => ({ id: `${proveedor}-${ticket}-${fecha}`, ticket, proveedor, material, kg, precioPorKg: 2, total: kg * 2, pagado, fecha, ...extra });
  return [
    pago('1010', 'JUANA', hoy, 'PET', 100, 200),
    pago('999', 'J.ENRIQUE', hoy, 'DURO', 50, 100),
    pago('1000', 'JOSE ENRIQUE', ayer, 'PET', 70, 140),
    pago('12', 'JUANA', ayer, 'MIXTO', 30, 60),
    pago('5', 'FELIX LOZANO', hoy, 'PET', 20, 40),
    pago('1005', 'JOSE ENRIQUE', hoy, 'DURO', 10, 20),
    pago('1', 'ARTURO LARA', hoy, 'PET', 10, 20, { revertido: true })
  ];
}
const ESPERADO_PAGOS = ['FELIX LOZANO#5', 'JOSE ENRIQUE#999', 'JOSE ENRIQUE#1000', 'JOSE ENRIQUE#1005', 'JUANA#12', 'JUANA#1010'];

async function abrirPagos(browser) {
  const { ctx, page } = await abrirBascula(browser);
  const { hoy, ayer } = await fechas(page);
  await page.evaluate((regs) => {
    window.EVE.currentUser.permisosResueltos = { pagos: 'lectura' };
    window.EVE.registrosPagos = window.unificarProveedorEnRegistros(regs);
    window.EVE_MODULES.pagos.render(document.getElementById('main-content'));
  }, registrosPagosPrueba(hoy, ayer));
  return { ctx, page, hoy, ayer };
}

const filasVistaPagos = (page) => page.$$eval('#vista-captura-overlay .captura-col-tickets .captura-tabla tbody tr', (trs) => trs.map((tr) => { const t = Array.from(tr.children).map((td) => td.textContent.trim()); return `${window.normalizarProveedor(t[1])}#${t[2]}`; }));

caso('Pagos · Vista para captura: Hoy / Esta Semana / Todos (con fecha) salen planos, ordenados por proveedor y ticket', async (browser) => {
  const { ctx, page } = await abrirPagos(browser);
  const semanaTieneAyer = await page.evaluate(() => { const d = new Date(`${window.obtenerFechaMexico()}T12:00:00`); return window.obtenerInicioSemana() <= new Date(d.getTime() - 86400000).toISOString().slice(0, 10); });
  const sinAyer = ESPERADO_PAGOS.filter((t) => !['JOSE ENRIQUE#1000', 'JUANA#12'].includes(t));
  for (const [pestana, esperado] of [['Hoy', sinAyer], ['Esta Semana', semanaTieneAyer ? ESPERADO_PAGOS : null], ['Todos', ESPERADO_PAGOS]]) {
    if (!esperado) continue; // lunes: "ayer" cae fuera de la semana
    await page.click(`.destaraje-subtabs .tab:has-text("${pestana}")`);
    if (pestana === 'Todos') {
      // Rango completo (Desde y Hasta): un rango con una sola fecha rompe formatearPeriodo en reportes.js (error previo, ajeno a esta tarea).
      await page.evaluate(() => {
        [['pgf-desde', '2000-01-01'], ['pgf-hasta', '2999-12-31']].forEach(([id, valor]) => { const i = document.getElementById(id); i.value = valor; i.dispatchEvent(new Event('input', { bubbles: true })); });
      });
    }
    await page.click('#btn-vista-captura-pagos');
    igual(await filasVistaPagos(page), esperado, `orden en ${pestana}`);
    igual(await page.$$('#vista-captura-overlay .captura-dia-titulo').then((n) => n.length), 0, `sin encabezados por día en ${pestana}`);
    await page.evaluate(() => window.VistaCaptura.cerrar());
  }
  igual(page.errores, [], 'errores de JS');
  await ctx.close();
});

caso('Pagos · la tabla en pantalla, el total pagado por proveedor y los KPIs NO cambian', async (browser) => {
  const { ctx, page } = await abrirPagos(browser);
  await page.click('.destaraje-subtabs .tab:has-text("Hoy")');
  const tabla = () => page.evaluate(() => Array.from(document.querySelectorAll('#pagos-tabla tr')).map((tr) => tr.children[0].textContent.trim() + '|' + tr.children[1].textContent.trim()));
  const antes = await tabla();
  await page.click('#btn-vista-captura-pagos');
  const resumen = await page.$$eval('#vista-captura-overlay .captura-resumen table tbody tr', (trs) => trs.map((tr) => Array.from(tr.children).map((td) => td.textContent.trim())));
  const kpis = await page.$$eval('#vista-captura-overlay .captura-resumen-stat', (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  await page.evaluate(() => window.VistaCaptura.cerrar());
  igual(await tabla(), antes, 'tabla principal intacta');
  igual(antes.length, 5, 'la tabla de Hoy sigue mostrando los 5 pagos, incluido el revertido (la vista y los reportes lo excluyen)');
  const pesos = (t) => Number(String(t).replace(/[^0-9.]/g, ''));
  // Hoy: JUANA 200, JOSE ENRIQUE 100 + 20 = 120, FELIX LOZANO 40 (orden por monto descendente, como antes)
  igual(resumen.map((f) => [f[0], pesos(f[1])]), [['JUANA', 200], ['JOSE ENRIQUE', 120], ['FELIX LOZANO', 40]], 'total pagado por proveedor, mismo orden por monto');
  afirmar(kpis.join(' ').includes('4') && kpis.join(' ').includes('360'), `KPIs distintos de 4 registros y $360: ${kpis.join(' | ')}`);
  await ctx.close();
});

caso('Pagos · CSV, TXT y PDF: detalle ordenado; totales, desglose por proveedor y revertidos intactos', async (browser) => {
  const { ctx, page } = await abrirPagos(browser);
  const res = await page.evaluate(async () => {
    const filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };
    window.exportarReportePagosCSV('todos', filtros);
    const csv = window.__descargas.csv.map((f) => `${window.normalizarProveedor(f.proveedorOCliente)}#${f.ticket}`);
    window.exportarReportePagosTXT('todos', filtros);
    const txt = await window.__descargas.txt.text();
    window.__descargas.tablas = [];
    window.exportarReportePagosPDF('todos', filtros);
    const cuerpo = (window.__descargas.tablas.slice(-1)[0] || { body: [] }).body;
    return { csv, txt, pdf: cuerpo.map((f) => `${window.normalizarProveedor(f[1])}#${f[0]}`) };
  });
  igual(res.csv, ESPERADO_PAGOS, 'CSV');
  igual(res.pdf, ESPERADO_PAGOS, 'PDF');
  const lineas = res.txt.split('\n');
  const inicio = lineas.findIndex((l) => l.startsWith('  TICKET  PROVEEDOR'));
  afirmar(inicio >= 0, 'no se encontró el detalle en el TXT');
  const detalle = lineas.slice(inicio + 1).filter((l) => l.trim()).map((l) => l.trim().split(/\s{2}/));
  igual(detalle.map((c) => c[0]), ['5', '999', '1000', '1005', '12', '1010'], 'TXT: tickets en orden');
  igual(detalle.map((c) => c[1]), ['FELIX LOZANO', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JOSE ENRIQUE', 'JUANA', 'JUANA'], 'TXT: proveedores consecutivos (alias unidos)');
  afirmar(res.txt.includes('TOTAL PAGADO: $560.00'), `TOTAL PAGADO distinto de $560.00: ${(res.txt.match(/TOTAL PAGADO:.*/) || [''])[0]}`);
  const desglose = lineas.slice(lineas.indexOf('DESGLOSE POR PROVEEDOR:') + 1, lineas.indexOf('DETALLE DE PAGOS:') - 1).map((l) => l.trim().split(':')[0]);
  igual(desglose, ['JUANA', 'JOSE ENRIQUE', 'FELIX LOZANO'], 'el desglose por proveedor conserva su orden por monto (empate JUANA/JOSE a $260 por orden de captura), no el alfabético del detalle');
  afirmar(!res.txt.includes('ARTURO LARA'), 'un pago revertido apareció en el reporte');
  await ctx.close();
});

caso('aplicación acotada: el orden solo se usa en el detalle de Báscula y de Pagos (el resto de reportes no cambia)', async () => {
  const usan = [];
  fs.readdirSync(path.join(RAIZ, 'js')).filter((f) => f.endsWith('.js')).forEach((f) => { if (leer(`js/${f}`).includes('ordenarPorProveedorTicket')) usan.push(f); });
  igual(usan.sort(), ['destaraje.js', 'pagos.js', 'reportes.js', 'utils.js'], 'archivos que usan la función');
  afirmar(!/ordenarPorProveedorTicket/.test(leer('js/vista-captura.js')), 'vista-captura.js no debe llamar a la función');
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
