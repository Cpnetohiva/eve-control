// Prueba de la pantalla y del PDF de Órdenes de Compra en Chromium (Playwright) con jsPDF y autoTable REALES y un Firestore
// simulado (scripts/db-simulada.js): captura y guardado desde el formulario, lista con filtros y totales por estado, botones
// por estado y permiso, confirmaciones, eliminación, y el PDF (A4, folio, emisor, proveedor, marca de agua por estado,
// paginación, descarga con el nombre del folio). Los PDFs se guardan FUERA del repo (os.tmpdir()/eve-ordenes-compra-pdf).
//
// jsPDF y autoTable no son dependencias del repo: se usan de la caché temporal que deja verificar-cotizaciones-pdf.js (o se
// bajan del mismo CDN). Sin internet y sin caché, los casos de PDF se OMITEN (se avisa), no se dan por buenos.
//
// Uso: node scripts/verificar-ordenes-compra-pantalla.js   (código de salida 1 si algo falla)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { crearDbSimulada } = require('./db-simulada');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(os.tmpdir(), 'eve-ordenes-compra-pdf');
const CACHE_LIBS = path.join(os.tmpdir(), 'eve-pdf-libs');
const LIBRERIAS = [
  ['jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
  ['jspdf.plugin.autotable.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js']
];
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/cotizaciones.js', 'js/cotizaciones-pdf.js', 'js/ordenescompra.js', 'js/ordenescompra-pdf.js'];
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'icons/icon-192.png')).toString('base64');
const EMISOR_COMPLETO = { razonSocial: 'RIVAL PLASTIC SAPI DE CV', rfc: 'RPS010101AAA', domicilioFiscal: 'Av. Industria #123, Col. Peñuelas, Monterrey, Nuevo León, C.P. 64000', telefono: '81 1234 5678', correo: 'compras@rivalplastic.example', vigenciaDias: 15 };

async function prepararLibrerias() {
  fs.mkdirSync(CACHE_LIBS, { recursive: true });
  fs.mkdirSync(SALIDA, { recursive: true });
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

const orden = (extra, numPartidas) => ({
  id: 'o1', folio: 'OC-2026-0001', estado: 'Emitida', fecha: '2026-10-01',
  proveedor: { nombre: 'Plásticos del Norte S.A.', telefono: '8112345678', email: 'ventas@norte.example', domicilio: 'Av. Constitución #100, Col. Niño Artillero' },
  condicionesPago: 'Contado', condicionesEntrega: 'En planta, 3 días hábiles', notas: 'Material con ñ y acentós.',
  partidas: Array.from({ length: numPartidas === undefined ? 3 : numPartidas }, (_, i) => ({ producto: i % 2 ? 'TAMBO' : '', descripcion: i % 2 ? '' : `Pieza especial ${i + 1} con ñ`, cantidad: i + 1, unidad: i % 2 ? 'PZ' : 'KG', precioUnitario: 10, descuentoPct: 0, importe: (i + 1) * 10 })),
  totales: { subtotal: 60, aplicaIva: true, ivaTasa: 0.16, iva: 9.6, total: 69.6 }, ...extra
});

// `permisos`: permisos del usuario; `ordenes`: documentos que ya están en el servidor simulado y en memoria.
async function nuevaPagina(browser, { permisos = { ordenesCompra: 'escritura' }, ordenes = [], emisor = EMISOR_COMPLETO } = {}) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const [nombre] of LIBRERIAS) await page.addScriptTag({ path: path.join(CACHE_LIBS, nombre) });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  // config.js crea el db real al cargarse: el simulado se instala DESPUÉS de cargar los scripts.
  await page.evaluate(([crearDb, permisosUsuario, docs, emisorGuardado, fecha]) => {
    window.db = (0, eval)(`(${crearDb})()`);
    docs.forEach((d) => { const { id, ...datos } = d; window.db.docs.set(`ordenes_compra/${id}`, { datos, version: 1 }); });
    if (emisorGuardado) window.db.docs.set('config/emisor', { datos: emisorGuardado, version: 1 });
    window.obtenerFechaMexico = () => fecha;
    window.EVE = { currentUser: { username: 'compras1', permisosResueltos: permisosUsuario }, ordenesCompra: docs.map((d) => ({ ...d })), ordenesCompraProveedores: [], cotizaciones: [], clientesCotizacion: [] };
    window.EVE.ordenesCompraProveedores = window.EVE_ORDENES_COMPRA.proveedoresDeOrdenes(window.EVE.ordenesCompra);
  }, [crearDbSimulada.toString(), permisos, ordenes, emisor, '2026-10-04']);
  page.erroresPagina = errores;
  return page;
}

// Genera el PDF en la página, lo guarda en la carpeta temporal y devuelve sus bytes como cadena latin1 (los textos de jsPDF con
// fuentes estándar van en el flujo sin comprimir).
async function generar(page, archivo, datos, emisor, logo) {
  const base64 = await page.evaluate(([o, e, l]) => {
    const doc = window.EVE_ORDENES_COMPRA_PDF.crearDocumento(o, e, l);
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    let binario = '';
    bytes.forEach((b) => { binario += String.fromCharCode(b); });
    return btoa(binario);
  }, [datos, emisor, logo || null]);
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(SALIDA, archivo), buffer);
  const texto = buffer.toString('latin1');
  afirmar(texto.startsWith('%PDF-') && texto.trimEnd().endsWith('%%EOF'), 'el archivo no es un PDF válido');
  return { texto, paginas: (texto.match(/\/Type\s*\/Page\b(?!s)/g) || []).length, bytes: buffer.length };
}
const contiene = (pdf, fragmento) => pdf.texto.includes(Buffer.from(fragmento, 'latin1').toString('latin1'));

// ── PDF real ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
caso('PDF real: OC de 3 partidas = 1 página A4, con ORDEN DE COMPRA, folio, emisor, proveedor, totales, total en letra, logo y marca EMITIDA', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'OC-2026-0001.pdf', orden(), EMISOR_COMPLETO, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  const caja = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.texto);
  afirmar(caja && Math.abs(Number(caja[1]) - 595.28) < 0.01 && Math.abs(Number(caja[2]) - 841.89) < 0.01, `tamaño A4 (595.28 × 841.89 pt), obtenido ${caja && caja.slice(1, 3)}`);
  ['ORDEN DE COMPRA', 'OC-2026-0001', 'RIVAL PLASTIC SAPI DE CV', 'RFC: RPS010101AAA', 'Domicilio fiscal', 'PROVEEDOR', 'Plásticos del Norte', 'ventas@norte.example', 'Subtotal', 'IVA 16%', 'TOTAL', 'SESENTA Y NUEVE PESOS 60/100 M.N.', 'Fecha: 01/10/2026', 'Contado', 'EMITIDA']
    .forEach((fragmento) => afirmar(contiene(pdf, fragmento), `falta "${fragmento}" en el PDF`));
  afirmar(!contiene(pdf, 'Vigencia'), 'una OC no lleva vigencia');
  afirmar(/\/Subtype\s*\/Image/.test(pdf.texto), 'debe llevar el logo (imagen)');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('PDF real: marca de agua por estado — EMITIDA / RECIBIDA / CANCELADA (las tres llevan, y solo la suya)', async (browser) => {
  const page = await nuevaPagina(browser);
  const marcas = { Emitida: 'EMITIDA', Recibida: 'RECIBIDA', Cancelada: 'CANCELADA' };
  for (const [estado, marca] of Object.entries(marcas)) {
    const pdf = await generar(page, `marca-${estado}.pdf`, orden({ estado }), EMISOR_COMPLETO);
    afirmar(contiene(pdf, `(${marca})`), `falta la marca ${marca}`);
    Object.values(marcas).filter((otra) => otra !== marca).forEach((otra) => afirmar(!contiene(pdf, `(${otra})`), `${estado} no debe llevar la marca ${otra}`));
  }
});

caso('PDF real: con 30 partidas pagina, numera "Página i de n", repite el encabezado y mantiene la marca en cada página', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'OC-2026-0002-30-partidas.pdf', orden({ folio: 'OC-2026-0002' }, 30), EMISOR_COMPLETO, LOGO);
  afirmar(pdf.paginas > 1, `con 30 partidas debe tener más de una página (tiene ${pdf.paginas})`);
  afirmar(contiene(pdf, `Página 1 de ${pdf.paginas}`) && contiene(pdf, `Página ${pdf.paginas} de ${pdf.paginas}`), 'paginación en el pie');
  afirmar((pdf.texto.match(/\(EMITIDA\)/g) || []).length >= pdf.paginas, 'la marca de agua va en cada página');
  console.log(`     (30 partidas: ${pdf.paginas} páginas, ${pdf.bytes} bytes → ${path.join(SALIDA, 'OC-2026-0002-30-partidas.pdf')})`);
});

caso('PDF real: descuento y sin IVA — fila de importe sin descuento, descuento, sin renglón de IVA; total en letra con millones', async (browser) => {
  const page = await nuevaPagina(browser);
  const conDescuento = orden({
    partidas: [{ descripcion: 'Scrap', cantidad: 100, unidad: 'KG', precioUnitario: 10, descuentoPct: 10, importe: 900 }],
    totales: { subtotal: 900, aplicaIva: false, ivaTasa: 0.16, iva: 0, total: 900 }
  });
  const a = await generar(page, 'OC-descuento.pdf', conDescuento, EMISOR_COMPLETO);
  ['Importe sin descuento', 'Descuento', 'NOVECIENTOS PESOS 00/100 M.N.'].forEach((f) => afirmar(contiene(a, f), `falta "${f}"`));
  afirmar(!contiene(a, 'IVA 16%'), 'sin IVA no debe haber renglón de IVA');
  const grande = orden({ totales: { subtotal: 2000000, aplicaIva: false, ivaTasa: 0.16, iva: 0, total: 2000000 } });
  afirmar(contiene(await generar(page, 'OC-millones.pdf', grande, EMISOR_COMPLETO), 'DOS MILLONES DE PESOS 00/100 M.N.'), 'millones exactos');
});

caso('PDF real: generarPdfOrdenCompra relee del servidor, avisa si falta RFC/domicilio, y descarga OC-AAAA-nnnn.pdf', async (browser) => {
  const page = await nuevaPagina(browser, { ordenes: [orden({ estado: 'Recibida' })], emisor: { razonSocial: 'RIVAL PLASTIC SAPI DE CV', vigenciaDias: 15 } });
  const mensajes = [];
  let aceptar = false;
  page.on('dialog', (d) => { mensajes.push(d.message()); return aceptar ? d.accept() : d.dismiss(); });
  // Copia en pantalla desactualizada (Emitida): el PDF debe salir con el estado real del servidor.
  const viejo = orden({ estado: 'Emitida' });
  igual(await page.evaluate((o) => window.EVE_ORDENES_COMPRA_PDF.generarPdfOrdenCompra('o1', o), viejo), null, 'cancelar no genera nada');
  afirmar(mensajes[0].includes('RFC') && mensajes[0].includes('domicilio fiscal'), `aviso: ${mensajes[0]}`);
  aceptar = true;
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.evaluate((o) => window.EVE_ORDENES_COMPRA_PDF.generarPdfOrdenCompra('o1', o), viejo)]);
  igual(descarga.suggestedFilename(), 'OC-2026-0001.pdf', 'nombre del archivo descargado');
  const destino = path.join(SALIDA, 'descarga-OC-2026-0001.pdf');
  await descarga.saveAs(destino);
  const texto = fs.readFileSync(destino).toString('latin1');
  afirmar(texto.startsWith('%PDF-') && texto.includes('(RECIBIDA)') && !texto.includes('(EMITIDA)'), 'la descarga lleva el estado REAL del servidor (Recibida)');
  igual(await page.evaluate(() => window.EVE_ORDENES_COMPRA_PDF.generarPdfOrdenCompra('no-existe').then(() => 'generó', (e) => e.message)), 'La orden de compra ya no existe', 'una inexistente sin copia no genera');
  igual(page.erroresPagina, [], 'errores de JS');
});

// ── Pantalla ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const ORDENES_LISTA = [
  orden({ id: 'a', folio: 'OC-2026-0001', estado: 'Emitida', fecha: '2026-10-01', proveedorNormalizado: 'plasticos del norte' }),
  orden({ id: 'b', folio: 'OC-2026-0002', estado: 'Recibida', fecha: '2026-10-10', proveedor: { nombre: 'Acopios MX' }, proveedorNormalizado: 'acopios mx' }),
  orden({ id: 'c', folio: 'OC-2026-0003', estado: 'Cancelada', fecha: '2026-09-01', proveedor: { nombre: 'Acopios MX' }, proveedorNormalizado: 'acopios mx' })
];
const renderizar = (page) => page.evaluate(() => window.EVE_MODULES.ordenesCompra.render(document.getElementById('main-content')));
const filasFolio = (page) => page.$$eval('#modulo-ordenescompra tbody tr[data-id] td:first-child', (tds) => tds.map((td) => td.textContent));
const botones = (page, id) => page.$$eval(`tr[data-id="${id}"] button`, (bs) => bs.map((b) => `${b.textContent}${b.disabled ? '(off)' : ''}`));

caso('pantalla: lista ordenada por folio, estados, totales por estado y botones según el estado (con permiso de escritura)', async (browser) => {
  const page = await nuevaPagina(browser, { ordenes: ORDENES_LISTA });
  await renderizar(page);
  igual(await filasFolio(page), ['OC-2026-0003', 'OC-2026-0002', 'OC-2026-0001'], 'folios en orden descendente');
  igual(await page.$$eval('.cot-resumen-item', (is) => is.map((i) => i.dataset.estado)), ['Emitida', 'Recibida', 'Cancelada'], 'resumen por estado');
  igual(await botones(page, 'a'), ['Editar', 'PDF', 'Marcar Recibida', 'Cancelar orden', 'Eliminar'], 'Emitida');
  igual(await botones(page, 'b'), ['Ver', 'PDF', 'Cancelar orden', 'Eliminar(off)'], 'Recibida: eliminar deshabilitado');
  igual(await botones(page, 'c'), ['Ver', 'PDF', 'Eliminar(off)'], 'Cancelada: final, sin transiciones');
  afirmar(await page.$('text=+ Nueva orden de compra'), 'botón de nueva orden');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('pantalla: con solo lectura no hay Nueva orden, ni transiciones, ni Eliminar; sí Ver y PDF', async (browser) => {
  const page = await nuevaPagina(browser, { permisos: { ordenesCompra: 'lectura' }, ordenes: ORDENES_LISTA });
  await renderizar(page);
  igual(await page.$('text=+ Nueva orden de compra'), null, 'sin botón de nueva orden');
  igual(await botones(page, 'a'), ['Ver', 'PDF'], 'solo lectura');
  igual(await filasFolio(page), ['OC-2026-0003', 'OC-2026-0002', 'OC-2026-0001'], 'la lista sí se ve');
});

caso('pantalla: filtros por proveedor (sin acentos), estado y fechas dd/mm/aaaa; resumen sigue a los filtros; fecha inválida se marca', async (browser) => {
  const page = await nuevaPagina(browser, { ordenes: ORDENES_LISTA });
  await renderizar(page);
  await page.fill('[data-campo="filtro.proveedor"]', 'PLÁSTICOS');
  igual(await filasFolio(page), ['OC-2026-0001'], 'proveedor');
  await page.fill('[data-campo="filtro.proveedor"]', '');
  await page.selectOption('[data-campo="filtro.estado"]', 'Recibida');
  igual(await filasFolio(page), ['OC-2026-0002'], 'estado');
  await page.selectOption('[data-campo="filtro.estado"]', '');
  await page.fill('[data-campo="filtro.desde"]', '05/10/2026');
  await page.fill('[data-campo="filtro.hasta"]', '31/10/2026');
  igual(await filasFolio(page), ['OC-2026-0002'], 'rango de fechas');
  igual(await page.$$eval('.cot-resumen-item', (is) => is.map((i) => i.dataset.estado)), ['Recibida'], 'resumen filtrado');
  await page.fill('[data-campo="filtro.hasta"]', '31/13/2026');
  afirmar((await page.textContent('[data-error="filtro.hasta"]')).includes('Fecha no válida'), 'mensaje de fecha inválida');
});

caso('pantalla: capturar una OC (validación por campo, partidas, IVA en vivo) y guardarla — queda Emitida con folio y contador en 1', async (browser) => {
  const page = await nuevaPagina(browser);
  await renderizar(page);
  await page.click('text=+ Nueva orden de compra');
  await page.click('button[type="submit"]');
  afirmar((await page.textContent('[data-error="proveedor.nombre"]')).includes('obligatorio'), 'proveedor obligatorio');
  afirmar((await page.textContent('tr.cot-partida [data-e="cantidad"]')).includes('mayor a 0'), 'cantidad obligatoria');
  igual(await page.$$eval('.campo-invalido', (n) => n.length) > 0, true, 'campos marcados');
  await page.fill('[data-campo="proveedor.nombre"]', 'Recicladora del Norte');
  await page.fill('[data-campo="proveedor.email"]', 'mal');
  await page.click('button[type="submit"]');
  afirmar((await page.textContent('[data-error="proveedor.email"]')).includes('no es válido'), 'correo inválido');
  await page.fill('[data-campo="proveedor.email"]', 'ventas@norte.example');
  await page.fill('[data-f="producto"]', 'Scrap PET');
  await page.fill('[data-f="cantidad"]', '100');
  await page.fill('[data-f="precioUnitario"]', '10');
  igual(await page.textContent('[data-total="total"]'), await page.evaluate(() => window.formatearMoneda(1000)), 'total sin IVA');
  await page.check('[data-campo="aplicaIva"]');
  igual(await page.textContent('[data-total="total"]'), await page.evaluate(() => window.formatearMoneda(1160)), 'total con IVA 16%');
  await page.click('text=+ Agregar partida');
  igual(await page.$$eval('tr.cot-partida', (f) => f.length), 2, 'segunda partida');
  await page.click('tr.cot-partida:nth-child(2) .cot-quitar');
  await page.click('button[type="submit"]');
  await page.waitForSelector('tr[data-id]');
  igual(await filasFolio(page), ['OC-2026-0001'], 'la lista muestra la nueva orden');
  const guardado = await page.evaluate(() => Array.from(window.db.docs.entries()).filter(([r]) => r.startsWith('ordenes_compra/')).map(([, d]) => d.datos));
  igual([guardado.length, guardado[0].estado, guardado[0].totales.total, guardado[0].proveedor.nombre], [1, 'Emitida', 1160, 'Recicladora del Norte'], 'documento guardado');
  igual(await page.evaluate(() => window.db.docs.get('contadores/OC-2026').datos.ultimo), 1, 'contador');
  igual(await page.evaluate(() => window.EVE.ordenesCompraProveedores.map((p) => p.nombre)), ['Recicladora del Norte'], 'proveedores en memoria');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('pantalla: editar una Emitida conserva el folio; abrir una Recibida es solo lectura (sin Guardar, sin Eliminar)', async (browser) => {
  const page = await nuevaPagina(browser, { ordenes: ORDENES_LISTA });
  await renderizar(page);
  await page.click('tr[data-id="a"] >> text=Editar');
  igual(await page.textContent('.cot-titulo.mono'), 'Editar OC-2026-0001', 'título del formulario');
  await page.fill('[data-campo="notas"]', 'cambio de nota');
  await page.click('button[type="submit"]');
  await page.waitForSelector('tr[data-id="a"]');
  const nota = await page.evaluate(() => window.db.docs.get('ordenes_compra/a').datos.notas);
  igual([nota, await filasFolio(page)], ['cambio de nota', ['OC-2026-0003', 'OC-2026-0002', 'OC-2026-0001']], 'edición sin nuevo folio');
  igual(await page.evaluate(() => window.db.docs.has('contadores/OC-2026')), false, 'editar no toca el contador');
  await page.click('tr[data-id="b"] >> text=Ver');
  igual(await page.$('button[type="submit"]'), null, 'sin Guardar en solo lectura');
  igual(await page.$('form .cot-eliminar'), null, 'sin Eliminar en solo lectura');
  afirmar(await page.$eval('[data-campo="proveedor.nombre"]', (i) => i.disabled), 'campos deshabilitados');
});

caso('pantalla: Marcar Recibida cambia el estado en Firestore y en la lista; Cancelar pide confirmación (rechazarla no cambia nada)', async (browser) => {
  const page = await nuevaPagina(browser, { ordenes: ORDENES_LISTA });
  await renderizar(page);
  await page.click('tr[data-id="a"] >> text=Marcar Recibida');
  await page.waitForFunction(() => document.querySelector('tr[data-id="a"] .cot-estado').textContent === 'Recibida');
  igual(await page.evaluate(() => window.db.docs.get('ordenes_compra/a').datos.estado), 'Recibida', 'estado en Firestore');
  igual(await botones(page, 'a'), ['Ver', 'PDF', 'Cancelar orden', 'Eliminar(off)'], 'botones tras recibir');
  const mensajes = [];
  let aceptar = false;
  page.on('dialog', (d) => { mensajes.push(d.message()); return aceptar ? d.accept() : d.dismiss(); });
  await page.click('tr[data-id="a"] >> text=Cancelar orden');
  afirmar(mensajes[0].includes('OC-2026-0001') && mensajes[0].includes('estado final'), `confirmación: ${mensajes[0]}`);
  igual(await page.evaluate(() => window.db.docs.get('ordenes_compra/a').datos.estado), 'Recibida', 'rechazar la confirmación no cambia nada');
  aceptar = true;
  await page.click('tr[data-id="a"] >> text=Cancelar orden');
  await page.waitForFunction(() => document.querySelector('tr[data-id="a"] .cot-estado').textContent === 'Cancelada');
  igual(await botones(page, 'a'), ['Ver', 'PDF', 'Eliminar(off)'], 'Cancelada es final');
  igual(await page.evaluate(() => window.db.docs.get('ordenes_compra/a').datos.historialEstados.map((e) => e.a)), ['Recibida', 'Cancelada'], 'historialEstados');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('pantalla: Eliminar una Emitida pide confirmación, la borra y el folio no se reutiliza; si otro usuario ya la cambió, refresca y NO borra', async (browser) => {
  const page = await nuevaPagina(browser, { ordenes: ORDENES_LISTA });
  await renderizar(page);
  const mensajes = [];
  let aceptar = false;
  page.on('dialog', (d) => { mensajes.push(d.message()); return aceptar ? d.accept() : d.dismiss(); });
  await page.click('tr[data-id="a"] >> text=Eliminar');
  afirmar(mensajes[0].includes('OC-2026-0001') && mensajes[0].includes('El folio no se vuelve a usar'), `confirmación: ${mensajes[0]}`);
  igual(await page.evaluate(() => window.db.docs.has('ordenes_compra/a')), true, 'rechazar no borra');
  // Otro usuario la marcó Recibida en el servidor mientras esta pantalla seguía viendo "Emitida".
  await page.evaluate(() => { window.db.docs.get('ordenes_compra/a').datos.estado = 'Recibida'; });
  aceptar = true;
  await page.click('tr[data-id="a"] >> text=Eliminar');
  await page.waitForFunction(() => document.querySelector('tr[data-id="a"] .cot-estado').textContent === 'Recibida');
  igual(await page.evaluate(() => window.db.docs.has('ordenes_compra/a')), true, 'no borró una orden que ya no era Emitida');
  igual(await page.$eval('#toast-container', (t) => t.textContent.includes('solo se elimina una orden Emitida')), true, 'aviso al usuario');
  await page.evaluate(() => { window.db.docs.get('ordenes_compra/a').datos.estado = 'Emitida'; });
  await page.evaluate(() => { window.EVE.ordenesCompra.find((o) => o.id === 'a').estado = 'Emitida'; });
  await renderizar(page);
  await page.click('tr[data-id="a"] >> text=Eliminar');
  await page.waitForFunction(() => !document.querySelector('tr[data-id="a"]'));
  igual(await page.evaluate(() => window.db.docs.has('ordenes_compra/a')), false, 'la Emitida se borró');
  igual(await page.evaluate(() => window.db.docs.has('contadores/OC-2026')), false, 'eliminar no toca el contador');
  igual(page.erroresPagina, [], 'errores de JS');
});

(async () => {
  try {
    await prepararLibrerias();
  } catch (error) {
    console.log(`OMITIDO: no se pudieron bajar jsPDF/autoTable del CDN (${error.message}). Los ${casos.length} casos NO se ejecutaron.`);
    process.exit(0);
  }
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos · PDFs en ${SALIDA}`);
  process.exit(fallos ? 1 : 0);
})();
