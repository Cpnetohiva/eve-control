// Pantalla de Flujo de efectivo (js/flujo.js) en Chromium (Playwright), con los js/ reales y jsPDF + autoTable reales.
//
// Cubre: pestañas Hoy / Esta Semana / Este Mes / Todos y su barra de filtros, KPIs, tabla sin columna de IVA con el saldo acumulado
// desde el 1 de octubre aunque la vista esté filtrada, la alerta de cobro con IVA, el alta / edición / eliminación de movimientos
// manuales (con EVE_HISTORIAL en edición y eliminación), permisos, el aviso de fuentes sin acceso, la Vista para captura y las
// descargas TXT, CSV y PDF.
//
// Las colecciones se simulan en la página (guardarDato / actualizarDato / eliminarDato). jsPDF y autoTable no son dependencias del
// repo: se usan de la caché temporal que deja verificar-cotizaciones-pdf.js (o se bajan del mismo CDN). Sin internet y sin caché, el
// caso del PDF se OMITE (se avisa), no se da por bueno.
//
// Uso: node scripts/verificar-flujo-pantalla.js   (código de salida 1 si algo falla)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const CACHE_LIBS = path.join(os.tmpdir(), 'eve-pdf-libs');
const LIBRERIAS = [
  ['jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
  ['jspdf.plugin.autotable.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js']
];
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/flujo.js'];

const HOY = '2026-10-14';
const TODOS_LOS_PERMISOS = { flujo: 'escritura', cxc: 'escritura', pagos: 'escritura', gastos: 'escritura' };
const DATOS = {
  cobros: [
    { id: 'c1', fecha: '2026-10-01', cliente: 'JOSÉ PÉREZ', folio: 'V-2026-001', pagado: 1000, iva: 0, revertido: false, fechaRegistro: '2026-10-01T10:00:00.000Z' },
    { id: 'c2', fecha: HOY, cliente: 'MARÍA', folio: 'V-2026-002', pagado: 500, iva: 80, revertido: false, fechaRegistro: '2026-10-14T10:00:00.000Z' },
    { id: 'c3', fecha: '2026-09-20', cliente: 'ANTES', folio: 'V-2026-000', pagado: 9999, iva: 0, revertido: false, fechaRegistro: '2026-09-20T10:00:00.000Z' }
  ],
  registrosPagos: [
    { id: 'p1', fecha: '2026-10-12', proveedor: 'RECICLADOS SA', ticket: '1160', pagado: 348, iva: 48, origen: 'cxp_pago_general', revertido: false, fechaRegistro: '2026-10-12T10:00:00.000Z' }
  ],
  gastos: [
    { id: 'g1', fecha: HOY, concepto: 'Diésel', beneficiario: 'GASOLINERA', montoBase: 100, iva: 0, fechaRegistro: '2026-10-14T11:00:00.000Z' }
  ],
  flujoMovimientos: []
};

async function prepararLibrerias() {
  fs.mkdirSync(CACHE_LIBS, { recursive: true });
  for (const [nombre, url] of LIBRERIAS) {
    const destino = path.join(CACHE_LIBS, nombre);
    if (fs.existsSync(destino) && fs.statSync(destino).size > 1000) continue;
    const respuesta = await fetch(url);
    if (!respuesta.ok) throw new Error(`${url}: HTTP ${respuesta.status}`);
    fs.writeFileSync(destino, Buffer.from(await respuesta.arrayBuffer()));
  }
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser, { permisos = TODOS_LOS_PERMISOS, datos = DATOS, conPdf = true } = {}) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  if (conPdf) for (const [nombre] of LIBRERIAS) await page.addScriptTag({ path: path.join(CACHE_LIBS, nombre) });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(([permisosUsuario, d, hoy]) => {
    const copia = JSON.parse(JSON.stringify(d));
    window.EVE = { currentUser: { username: 'admin1', permisosResueltos: permisosUsuario }, ...copia };
    window.obtenerFechaMexico = () => hoy;
    window.obtenerInicioSemana = () => '2026-10-12';
    window.obtenerInicioMes = () => '2026-10-01';
    window.__guardados = {}; window.__historial = []; window.__mensajes = [];
    let n = 0;
    window.guardarDato = async (coleccion, doc) => { const id = `nuevo${++n}`; (window.__guardados[coleccion] = window.__guardados[coleccion] || {})[id] = JSON.parse(JSON.stringify(doc)); return id; };
    window.actualizarDato = async (coleccion, id, doc) => { (window.__guardados[coleccion] = window.__guardados[coleccion] || {})[id] = JSON.parse(JSON.stringify(doc)); };
    window.eliminarDato = async (coleccion, id) => { delete (window.__guardados[coleccion] || {})[id]; (window.__eliminados = window.__eliminados || []).push(`${coleccion}/${id}`); };
    window.EVE_HISTORIAL = { registrar: (e) => window.__historial.push(JSON.parse(JSON.stringify(e))) };
    window.showSuccess = (m) => window.__mensajes.push(['ok', m]);
    window.showError = (m) => window.__mensajes.push(['error', m]);
    window.__descarga = null;
    const contenedor = document.getElementById('main-content');
    window.EVE_MODULES.flujo.render(contenedor);
  }, [permisos, datos, HOY]);
  page.erroresPagina = errores;
  return page;
}

const texto = (page, selector) => page.locator(selector).innerText();
const filas = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#flujo-tabla tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim())));
const irATab = (page, id) => page.click(`.destaraje-subtabs .tab[data-tab="${id}"]`);

caso('Hoy: solo los movimientos de hoy, con el saldo acumulado desde el 1 de octubre (no el del día) y sin columna de IVA', async (browser) => {
  const page = await nuevaPagina(browser);
  const encabezados = await page.evaluate(() => Array.from(document.querySelectorAll('.tabla-destaraje thead th')).map((th) => th.innerText.trim()));
  igual(encabezados, ['Fecha', 'Concepto', 'Cliente / Proveedor', 'Folio', 'Rubro', 'Entrada', 'Salida', 'Saldo', ''], 'columnas');
  const f = await filas(page);
  igual(f.length, 2, 'dos movimientos hoy');
  afirmar(f[0][1].startsWith('Cobro') && f[0][2] === 'MARÍA' && f[0][3] === 'V-2026-002' && f[0][4] === 'Operación' && f[0][5].includes('500.00') && f[0][6] === '', `cobro de hoy: ${JSON.stringify(f[0])}`);
  afirmar(f[1][1] === 'Diésel' && f[1][2] === 'GASOLINERA' && f[1][5] === '' && f[1][6].includes('100.00'), `gasto de hoy: ${JSON.stringify(f[1])}`);
  // 1000 (cobro 1-oct) - 300 (pago sin IVA) + 500 (cobro de hoy) = 1200, y luego - 100 = 1100: lo anterior al día cuenta en el saldo.
  afirmar(f[0][7].includes('1,200.00') && f[1][7].includes('1,100.00'), `saldo acumulado: ${f[0][7]} / ${f[1][7]}`);
  igual(page.erroresPagina, [], 'errores de página');
  await page.close();
});

caso('KPIs: Entradas, Salidas, Neto del periodo, Flujo operativo, Flujo de financiamiento y Saldo actual (el saldo actual no depende del periodo)', async (browser) => {
  const page = await nuevaPagina(browser);
  const kpis = await page.evaluate(() => Array.from(document.querySelectorAll('#flujo-stats span')).map((s) => s.innerText));
  igual(kpis.length, 6, 'seis KPIs');
  afirmar(kpis[0].startsWith('Entradas:') && kpis[0].includes('500.00'), kpis[0]);
  afirmar(kpis[1].startsWith('Salidas:') && kpis[1].includes('100.00'), kpis[1]);
  afirmar(kpis[2].startsWith('Neto del periodo:') && kpis[2].includes('400.00'), kpis[2]);
  afirmar(kpis[3].startsWith('Flujo operativo:') && kpis[3].includes('400.00'), kpis[3]);
  afirmar(kpis[4].startsWith('Flujo de financiamiento:') && kpis[4].includes('0.00'), kpis[4]);
  afirmar(kpis[5].startsWith('Saldo actual:') && kpis[5].includes('1,100.00'), kpis[5]);
  await page.close();
});

caso('Los movimientos anteriores al 1 de octubre no entran (cobro de septiembre ausente de Todos)', async (browser) => {
  const page = await nuevaPagina(browser);
  await irATab(page, 'todos');
  const f = await filas(page);
  igual(f.length, 4, 'cuatro movimientos desde octubre');
  afirmar(!f.some((fila) => fila[2] === 'ANTES'), 'el cobro de septiembre no aparece');
  await page.close();
});

caso('Esta Semana y Este Mes filtran por fecha; la barra de filtros solo aparece en Todos', async (browser) => {
  const page = await nuevaPagina(browser);
  igual(await page.isVisible('#flujo-filtros'), false, 'filtros ocultos en Hoy');
  await irATab(page, 'semana');
  igual((await filas(page)).length, 3, 'semana (desde el lunes 12)');
  igual(await page.isVisible('#flujo-filtros'), false, 'filtros ocultos en Semana');
  await irATab(page, 'mes');
  igual((await filas(page)).length, 4, 'mes');
  await irATab(page, 'todos');
  igual(await page.isVisible('#flujo-filtros'), true, 'filtros visibles en Todos');
  await page.close();
});

caso('Todos: filtra por texto (sin acentos), tipo y fechas; el saldo de cada fila sigue siendo el acumulado', async (browser) => {
  const page = await nuevaPagina(browser);
  await irATab(page, 'todos');
  const [desde, hasta, buscar] = await page.$$('#flujo-filtros input');
  await buscar.fill('jose perez');
  let f = await filas(page);
  igual(f.length, 1, 'texto con acentos distintos');
  afirmar(f[0][2] === 'JOSÉ PÉREZ' && f[0][7].includes('1,000.00'), JSON.stringify(f[0]));
  await buscar.fill('');
  await page.selectOption('#flujo-filtros select', 'Salida');
  f = await filas(page);
  igual(f.map((fila) => fila[1]), ['Pago a proveedor', 'Diésel'], 'solo salidas');
  afirmar(f[0][6].includes('300.00'), `el pago se muestra sin IVA (348 - 48): ${f[0][6]}`);
  afirmar(f[0][7].includes('700.00'), `saldo acumulado tras el pago: ${f[0][7]}`);
  await page.selectOption('#flujo-filtros select', '');
  await desde.fill('2026-10-12');
  await hasta.fill('2026-10-13');
  igual((await filas(page)).length, 1, 'rango de fechas');
  await page.close();
});

caso('Cobro con IVA: la fila muestra el ícono de alerta con el texto; el cobro sin IVA no', async (browser) => {
  const page = await nuevaPagina(browser);
  await irATab(page, 'todos');
  const alertas = await page.evaluate(() => Array.from(document.querySelectorAll('#flujo-tabla tr')).map((tr) => (tr.querySelector('.chip-warn') ? tr.querySelector('.chip-warn').innerText : null)));
  igual(alertas.filter(Boolean), ['⚠️ Cobro con IVA: revisa la venta'], 'una sola alerta');
  const filaAlerta = await page.evaluate(() => Array.from(document.querySelectorAll('#flujo-tabla tr')).findIndex((tr) => tr.querySelector('.chip-warn')));
  const f = await filas(page);
  afirmar(f[filaAlerta][2] === 'MARÍA', 'la alerta es la del cobro de MARÍA (iva 80)');
  await page.close();
});

caso('Movimiento manual: alta desde el formulario (se guarda con usuario y fecha de registro y aparece con su saldo); importe 0 no se guarda', async (browser) => {
  const page = await nuevaPagina(browser);
  afirmar(await page.isVisible('#flujo-form'), 'el formulario es visible con escritura');
  igual(await page.inputValue('#fl-tipo'), '', 'el tipo no viene preseleccionado');
  igual(await page.$$eval('#fl-tipo option:not([disabled])', (os) => os.map((o) => o.value)),
    ['Saldo inicial', 'Aportación o préstamo', 'Disposición de crédito', 'Anticipo de cliente', 'Otra entrada', 'Anticipo a proveedor', 'Retiro o devolución a socio', 'Otra salida'], 'tipos disponibles');
  await page.selectOption('#fl-tipo', 'Otra entrada');
  await page.fill('#fl-concepto', 'Aportación socio');
  await page.fill('#fl-contraparte', 'SOCIO');
  await page.fill('#fl-importe', '0');
  await page.click('#flujo-form button[type="submit"]');
  let guardados = await page.evaluate(() => window.__guardados.flujo_movimientos || {});
  igual(Object.keys(guardados).length, 0, 'importe 0 no se guarda');
  afirmar((await page.evaluate(() => window.__mensajes)).some(([tipo, m]) => tipo === 'error' && m.includes('mayor a 0')), 'se avisa que el importe debe ser mayor a 0');
  await page.fill('#fl-importe', '250.5');
  await page.click('#flujo-form button[type="submit"]');
  guardados = await page.evaluate(() => window.__guardados.flujo_movimientos);
  const doc = Object.values(guardados)[0];
  igual([doc.fecha, doc.tipo, doc.concepto, doc.contraparte, doc.importe, doc.creadoPor], [HOY, 'Otra entrada', 'Aportación socio', 'SOCIO', 250.5, 'admin1'], 'documento guardado');
  afirmar(typeof doc.fechaRegistro === 'string' && doc.fechaRegistro.length > 10, 'lleva fechaRegistro');
  const f = await filas(page);
  igual(f.length, 3, 'tres movimientos hoy');
  afirmar(f.some((fila) => fila[1] === 'Aportación socio' && fila[5].includes('250.50')), 'la fila nueva aparece como entrada');
  await page.close();
});

caso('Aportación o préstamo: se guarda como entrada, la fila muestra el rubro Financiamiento y el KPI Flujo de financiamiento lo suma (el operativo no cambia)', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.selectOption('#fl-tipo', 'Aportación o préstamo');
  await page.fill('#fl-concepto', 'PRESTAMO MM');
  await page.fill('#fl-importe', '1500000');
  await page.click('#flujo-form button[type="submit"]');
  const doc = Object.values(await page.evaluate(() => window.__guardados.flujo_movimientos))[0];
  igual([doc.tipo, doc.concepto, doc.importe], ['Aportación o préstamo', 'PRESTAMO MM', 1500000], 'documento guardado');
  const f = await filas(page);
  afirmar(f.some((fila) => fila[1] === 'PRESTAMO MM' && fila[4] === 'Financiamiento' && fila[5].includes('1,500,000.00')), 'fila con rubro Financiamiento');
  const kpis = await page.evaluate(() => Array.from(document.querySelectorAll('#flujo-stats span')).map((s) => s.innerText));
  afirmar(kpis[3].startsWith('Flujo operativo:') && kpis[3].includes('400.00'), `el operativo no cambia: ${kpis[3]}`);
  afirmar(kpis[4].startsWith('Flujo de financiamiento:') && kpis[4].includes('1,500,000.00'), kpis[4]);
  afirmar(kpis[5].includes('1,501,100.00'), `saldo actual: ${kpis[5]}`);
  await page.close();
});

caso('Aviso de anticipos: el formulario dice que un anticipo manual es solo para dinero entregado fuera del sistema (los de CxP y Pagos ya salen solos)', async (browser) => {
  const page = await nuevaPagina(browser);
  const aviso = await texto(page, '#flujo-aviso-anticipo');
  ['Anticipo a proveedor', 'solo para dinero entregado fuera del sistema', 'sin pago en CxP ni en Recibos de Pago', 'ya aparecen solos', 'dos veces'].forEach((f) => afirmar(aviso.includes(f), `el aviso debe incluir "${f}": ${aviso}`));
  await page.close();
  const lectura = await nuevaPagina(browser, { permisos: { flujo: 'lectura', cxc: 'lectura', pagos: 'lectura', gastos: 'lectura' } });
  igual(await lectura.isVisible('#flujo-aviso-anticipo'), false, 'sin formulario no hay aviso');
  await lectura.close();
});

caso('Movimiento manual: fecha anterior al 1 de octubre se rechaza con mensaje', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.fill('#fl-fecha', '2026-09-15');
  await page.selectOption('#fl-tipo', 'Otra salida');
  await page.fill('#fl-importe', '10');
  await page.click('#flujo-form button[type="submit"]');
  igual(Object.keys(await page.evaluate(() => window.__guardados.flujo_movimientos || {})).length, 0, 'no se guarda');
  afirmar((await page.evaluate(() => window.__mensajes)).some(([tipo, m]) => tipo === 'error' && m.includes('o posterior')), 'se explica la fecha mínima');
  await page.close();
});

const DATOS_CON_MANUAL = { ...DATOS, flujoMovimientos: [{ id: 'm1', fecha: HOY, tipo: 'Salida', concepto: 'Fletes', contraparte: 'TRANSPORTES', folio: 'F-1', importe: 80, notas: '', fechaRegistro: '2026-10-14T12:00:00.000Z' }] };

caso('Editar un movimiento manual: guarda el cambio y registra EVE_HISTORIAL con valor anterior, nuevo y motivo', async (browser) => {
  const page = await nuevaPagina(browser, { datos: DATOS_CON_MANUAL });
  const botonesEditar = await page.$$eval('#flujo-tabla button', (bs) => bs.map((b) => b.innerText));
  igual(botonesEditar, ['Editar', 'Eliminar'], 'solo el movimiento manual tiene botones (no cobros, pagos ni gastos)');
  await page.click('#flujo-tabla button:has-text("Editar")');
  igual(await page.inputValue('#fle-importe'), '80', 'el modal carga el importe');
  igual(await page.inputValue('#fle-tipo'), 'Otra salida', 'el tipo heredado Salida se carga como su equivalente nuevo');
  await page.fill('#fle-importe', '95');
  await page.fill('#fle-motivo', 'Se corrigió el flete');
  await page.click('#flujo-edit-form button[type="submit"]');
  const guardado = await page.evaluate(() => window.__guardados.flujo_movimientos.m1);
  igual([guardado.importe, guardado.concepto], [95, 'Fletes'], 'documento actualizado');
  const historial = await page.evaluate(() => window.__historial);
  igual(historial.length, 1, 'una entrada de historial');
  igual([historial[0].coleccion, historial[0].registroId, historial[0].accion, historial[0].valorAnterior.importe, historial[0].valorNuevo.importe, historial[0].motivo], ['flujo_movimientos', 'm1', 'edicion', 80, 95, 'Se corrigió el flete'], 'historial');
  const f = await filas(page);
  afirmar(f.some((fila) => fila[1] === 'Fletes' && fila[6].includes('95.00')), 'la tabla muestra el importe nuevo');
  await page.close();
});

caso('Eliminar un movimiento manual: pide motivo, borra el documento y registra EVE_HISTORIAL', async (browser) => {
  const page = await nuevaPagina(browser, { datos: DATOS_CON_MANUAL });
  await page.evaluate(() => { window.prompt = () => 'capturado dos veces'; });
  await page.click('#flujo-tabla button:has-text("Eliminar")');
  await page.waitForFunction(() => (window.__eliminados || []).length === 1);
  igual(await page.evaluate(() => window.__eliminados), ['flujo_movimientos/m1'], 'documento eliminado');
  const historial = await page.evaluate(() => window.__historial);
  igual([historial[0].accion, historial[0].valorAnterior.concepto, historial[0].valorNuevo, historial[0].motivo], ['eliminacion', 'Fletes', null, 'capturado dos veces'], 'historial');
  igual((await filas(page)).length, 2, 'la fila desaparece');
  await page.close();
});

caso('Cancelar el motivo de eliminación no borra nada', async (browser) => {
  const page = await nuevaPagina(browser, { datos: DATOS_CON_MANUAL });
  await page.evaluate(() => { window.prompt = () => null; });
  await page.click('#flujo-tabla button:has-text("Eliminar")');
  igual(await page.evaluate(() => (window.__eliminados || []).length), 0, 'sin eliminaciones');
  igual((await filas(page)).length, 3, 'la fila sigue');
  await page.close();
});

caso('Solo lectura: sin formulario ni botones de editar o eliminar, pero con la tabla y las exportaciones', async (browser) => {
  const page = await nuevaPagina(browser, { permisos: { flujo: 'lectura', cxc: 'lectura', pagos: 'lectura', gastos: 'lectura' }, datos: DATOS_CON_MANUAL });
  igual(await page.isVisible('#flujo-form'), false, 'sin formulario');
  igual(await page.$$eval('#flujo-tabla button', (bs) => bs.length), 0, 'sin botones por fila');
  igual((await filas(page)).length, 3, 'la tabla se ve');
  igual(await page.isVisible('button:has-text("Exportar CSV")'), true, 'exportación disponible');
  await page.close();
});

caso('Aviso: si el rol no puede leer Cobros, Pagos o Gastos, se avisa que el flujo está incompleto', async (browser) => {
  const completo = await nuevaPagina(browser);
  igual(await completo.isVisible('#flujo-aviso'), false, 'sin aviso con todos los permisos');
  await completo.close();
  const page = await nuevaPagina(browser, { permisos: { flujo: 'escritura', gastos: 'lectura' } });
  igual(await page.isVisible('#flujo-aviso'), true, 'aviso visible');
  const aviso = await texto(page, '#flujo-aviso');
  afirmar(aviso.includes('Cobros (CxC)') && aviso.includes('Pagos') && !aviso.includes('Gastos'), aviso);
  await page.close();
});

async function descargar(page, nombreBoton) {
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.click(`button:has-text("${nombreBoton}")`)]);
  return { nombre: descarga.suggestedFilename(), contenido: fs.readFileSync(await descarga.path()) };
}

caso('Exportar TXT: archivo con el periodo, los totales, el saldo final y el detalle de la vista activa', async (browser) => {
  const page = await nuevaPagina(browser);
  await irATab(page, 'todos');
  const { nombre, contenido } = await descargar(page, 'Exportar TXT');
  const t = contenido.toString('utf8');
  igual(nombre, `Reporte_Flujo_TODOS_${HOY}.txt`, 'nombre');
  ['REPORTE DE FLUJO DE EFECTIVO', 'ENTRADAS: $1,500.00', 'SALIDAS: $400.00', 'NETO DEL PERIODO: $1,100.00', 'FLUJO OPERATIVO: $1,100.00', 'FLUJO DE FINANCIAMIENTO: $0.00', 'SALDO FINAL: $1,100.00', 'JOSÉ PÉREZ', 'RECICLADOS SA', 'Diésel'].forEach((f) => afirmar(t.includes(f), `el TXT debe incluir "${f}"`));
  afirmar(!/iva/i.test(t), 'el TXT no menciona IVA');
  await page.close();
});

caso('Exportar CSV: una fila por movimiento y las filas de totales, neto y saldo final; sin columna de IVA', async (browser) => {
  const page = await nuevaPagina(browser);
  await irATab(page, 'mes');
  const { nombre, contenido } = await descargar(page, 'Exportar CSV');
  const lineas = contenido.toString('utf8').split('\n');
  igual(nombre, `Reporte_Flujo_MES_${HOY}.csv`, 'nombre');
  igual(lineas[0], 'Fecha,Tipo,Rubro,Concepto,Cliente/Proveedor,Folio,Entrada,Salida,Saldo,Origen,Alerta', 'encabezado');
  igual(lineas.length, 1 + 4 + 6, 'encabezado + 4 movimientos + 6 filas de resumen');
  afirmar(lineas.some((l) => l.includes('FLUJO OPERATIVO') && l.includes('1100')) && lineas.some((l) => l.includes('FLUJO DE FINANCIAMIENTO')), 'subtotales de flujo operativo y de financiamiento');
  afirmar(lineas.some((l) => l.includes('Cobro con IVA: revisa la venta')), 'la alerta viaja en la columna Alerta');
  afirmar(lineas[lineas.length - 1].includes('SALDO FINAL') && lineas[lineas.length - 1].includes('1100'), lineas[lineas.length - 1]);
  await page.close();
});

caso('Exportar PDF: documento válido con título, periodo y los movimientos', async (browser) => {
  const page = await nuevaPagina(browser);
  await irATab(page, 'todos');
  const { nombre, contenido } = await descargar(page, 'Exportar PDF');
  igual(nombre, `Reporte_Flujo_TODOS_${HOY}.pdf`, 'nombre');
  const t = contenido.toString('latin1');
  afirmar(t.startsWith('%PDF-') && t.trimEnd().endsWith('%%EOF'), 'no es un PDF válido');
  afirmar(t.includes('REPORTE DE FLUJO DE EFECTIVO') && t.includes('SALDO FINAL'), 'título y saldo final en el PDF');
  await page.close();
});

caso('Vista para captura: abre con el título, los KPIs y la tabla del periodo', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.click('#btn-vista-captura-flujo');
  const cuerpo = await page.evaluate(() => document.body.innerText);
  ['Flujo de efectivo', 'Entradas', 'Salidas', 'Neto', 'Saldo final', 'Diésel', 'MARÍA'].forEach((f) => afirmar(cuerpo.includes(f), `la vista para captura debe incluir "${f}"`));
  afirmar(!/\bIVA\b/.test(cuerpo.replace('Cobro con IVA', '')), 'la vista para captura no muestra IVA');
  await page.close();
});

caso('Vista para captura sin movimientos: muestra el mensaje de vacío', async (browser) => {
  const page = await nuevaPagina(browser, { datos: { cobros: [], registrosPagos: [], gastos: [], flujoMovimientos: [] } });
  await page.click('#btn-vista-captura-flujo');
  afirmar((await page.evaluate(() => document.body.innerText)).includes('Sin movimientos en este periodo'), 'mensaje de vacío');
  await page.close();
});

(async () => {
  let hayPdf = true;
  try { await prepararLibrerias(); } catch (error) { hayPdf = false; console.log(`AVISO: sin jsPDF/autoTable (${error.message}); se omiten los casos de PDF y de descargas`); }
  const browser = await chromium.launch();
  let fallos = 0;
  let omitidos = 0;
  for (const { nombre, fn } of casos) {
    if (!hayPdf && /PDF|Exportar/.test(nombre)) { omitidos++; console.log(`omit ${nombre}`); continue; }
    try { await fn(browser); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos - omitidos}/${casos.length} casos correctos${omitidos ? `, ${omitidos} omitidos` : ''}`);
  process.exit(fallos ? 1 : 0);
})();
