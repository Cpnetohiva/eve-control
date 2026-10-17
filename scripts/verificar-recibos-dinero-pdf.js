// Prueba del PDF de Recibos de dinero en Chromium (Playwright) con jsPDF y autoTable REALES y un Firestore simulado: carta vertical en
// UNA sola hoja (también con 12 partidas y textos largos), logo, título, folio, emisor tomado de config/emisor, leyenda, datos del
// cliente y del pago, importe con letra, concepto, resumen con saldo pendiente solo en Anticipo, declaración (Anticipo vs Pago de
// contado), dos bloques de firma, pie, marca CANCELADO, campos vacíos, y que generar el PDF no escribe nada. Los PDFs se guardan
// FUERA del repo (os.tmpdir()/eve-recibos-dinero-pdf).
//
// jsPDF y autoTable no son dependencias del repo: se usan de la caché temporal que dejan las otras verificaciones de PDF (o se bajan
// del mismo CDN). Sin internet y sin caché, estos casos se OMITEN (se avisa), no se dan por buenos.
//
// Uso: node scripts/verificar-recibos-dinero-pdf.js   (código de salida 1 si algo falla)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const { crearDbSimulada } = require('./db-simulada');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(os.tmpdir(), 'eve-recibos-dinero-pdf');
const CACHE_LIBS = path.join(os.tmpdir(), 'eve-pdf-libs');
const LIBRERIAS = [
  ['jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
  ['jspdf.plugin.autotable.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js']
];
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/cotizaciones.js', 'js/cotizaciones-pdf.js', 'js/recibosdinero.js', 'js/recibosdinero-pdf.js'];
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'assets/rivalplastic-logo.png')).toString('base64');

const EMISOR = {
  razonSocial: 'RIVAL PLASTIC, S.A.P.I. DE C.V.', rfc: 'RPL010101AAA', domicilioFiscal: 'San Luis Potosí, S.L.P.', telefono: '444 123 4567',
  correo: 'ventas@rivalplastic.example', condicionesPagoDefault: '', condicionesEntregaDefault: '', vigenciaDias: 15
};

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

const recibo = (extra) => ({
  id: 'r1', folio: 'RD-16102026-002', estado: 'Emitido', tipo: 'Anticipo', fecha: '2026-10-16',
  cliente: { nombre: 'AMERICA ALVAREZ SANCHEZ', rfc: 'AASA800101AB1', domicilio: 'Av. Industrias 100, San Luis Potosí, S.L.P.' },
  importe: 30000, moneda: 'MXN', importeLetra: 'TREINTA MIL PESOS 00/100 MN', formaPago: 'Transferencia', referencia: 'SPEI 987654',
  concepto: 'Anticipo / pago a cuenta por compra de: 400 TAMBOS NUEVOS DE HDPE REPROCESO CAPACIDAD 220LTS', pedidoReferencia: 'COT-2026-0007',
  resumen: { partidas: [{ descripcion: 'TAMBO NUEVO 200 LTS HDPE REPROCESO', cantidad: 400, unidad: 'PZ', precioUnitario: 265, importe: 106000 }], totalOperacion: 106000, importeRecibido: 30000, saldoPendiente: 76000 },
  creadoPor: 'ventas1', ...extra
});

async function nuevaPagina(browser) {
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
  page.erroresPagina = errores;
  return page;
}

// Genera el PDF en la página, lo guarda en la carpeta temporal y devuelve sus bytes como cadena latin1 (los textos de jsPDF con
// fuentes estándar van en el flujo sin comprimir). Los paréntesis van escapados en el flujo, igual que en `contiene`.
async function generar(page, archivo, datos, emisor, logo) {
  const base64 = await page.evaluate(([r, e, l]) => {
    const doc = window.EVE_RECIBOS_DINERO_PDF.crearDocumento(r, e, l);
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
// Texto plano del PDF: cada cadena `(…) Tj` del flujo, sin escapes y unidas por espacios, para poder buscar frases que jsPDF parte
// en varias líneas (los párrafos largos). El texto va en latin1 (WinAnsi), igual que `fragmento` tras Buffer.from(…, 'latin1').
const planoDe = (pdf) => {
  if (!pdf.plano) {
    const trozos = [];
    pdf.texto.replace(/\(((?:\\.|[^\\)])*)\)\s*Tj/g, (_, cadena) => { trozos.push(cadena.replace(/\\([()\\])/g, '$1')); return ''; });
    pdf.plano = trozos.join(' ').replace(/\s+/g, ' ');
  }
  return pdf.plano;
};
const normal = (fragmento) => Buffer.from(fragmento, 'latin1').toString('latin1').replace(/\s+/g, ' ');
const contiene = (pdf, fragmento) => planoDe(pdf).includes(normal(fragmento));
const veces = (pdf, fragmento) => planoDe(pdf).split(normal(fragmento)).length - 1;
const mediaBox = (pdf) => (pdf.texto.match(/\/MediaBox\s*\[\s*([\d.\s]+)\]/) || [])[1].trim().split(/\s+/).map(Number);

caso('Anticipo: UNA hoja carta con logo, título, folio, emisor, leyenda, datos del cliente y del pago, concepto, resumen con saldo pendiente, declaración, firmas y pie', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'RD-16102026-002-anticipo.pdf', recibo(), EMISOR, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  const medida = await page.evaluate(([r, e]) => { const { escala, paginas, cabe } = window.EVE_RECIBOS_DINERO_PDF.construirDocumento(r, e, null); return { escala, paginas, cabe }; }, [recibo(), EMISOR]);
  igual(medida, { escala: 1, paginas: 1, cabe: true }, 'un recibo normal sale a tamaño normal, sin encogerse');
  igual(mediaBox(pdf).map(Math.round), [0, 0, 612, 792], 'tamaño carta');
  afirmar(/\/Subtype\s*\/Image/.test(pdf.texto), 'lleva el logo (imagen)');
  [
    'RECIBO DE DINERO', 'Folio: RD-16102026-002', 'RIVAL PLASTIC, S.A.P.I. DE C.V.', 'Domicilio: San Luis Potosí, S.L.P.', 'Tel.: 444 123 4567', 'Correo: ventas@rivalplastic.example',
    'RECIBO DE CONTROL INTERNO. No sustituye al CFDI ni acredita por sí solo la liquidación total de la operación.',
    'DATOS DEL CLIENTE Y DEL PAGO', 'Recibimos de:', 'AMERICA ALVAREZ SANCHEZ', 'RFC (opcional):', 'AASA800101AB1', 'Fecha:', '16/10/2026', 'Domicilio / Ciudad:',
    'Importe recibido:', '$30,000.00 MXN', 'Moneda:', 'MXN', 'Importe con letra:', 'TREINTA MIL PESOS 00/100 MN', 'Forma de pago:', 'Transferencia', 'Referencia:', 'SPEI 987654',
    'CONCEPTO DEL PAGO', 'Anticipo / pago a cuenta por compra de: 400 TAMBOS NUEVOS DE HDPE REPROCESO CAPACIDAD 220LTS', 'Pedido / cotización / OC No.:', 'COT-2026-0007',
    'RESUMEN DE LA OPERACIÓN', 'Descripción del producto', 'TAMBO NUEVO 200 LTS HDPE REPROCESO', '$106,000.00', 'Total de la operación', 'Importe recibido', 'Saldo pendiente', '$76,000.00 MXN',
    'DECLARACIÓN Y ALCANCE', 'declara haber recibido del cliente identificado en este documento el importe señalado, en calidad de anticipo o pago a cuenta de la operación descrita',
    'RECIBIÓ POR RIVALPLASTIC', 'Nombre:', 'Cargo:', 'Firma:', 'ENTREGÓ EL DINERO', 'Identificación (opcional):', 'MATERIALES PLÁSTICOS', 'PRODUCTOS PLÁSTICOS', 'SOLUCIONES LOGÍSTICAS'
  ].forEach((fragmento) => afirmar(contiene(pdf, fragmento), `falta en el PDF: "${fragmento}"`));
  igual(veces(pdf, 'Nombre:'), 2, 'dos bloques de firma, cada uno con Nombre');
  afirmar(!contiene(pdf, 'CANCELADO'), 'un recibo Emitido no lleva la marca CANCELADO');
  afirmar(!contiene(pdf, 'pago total de contado'), 'el Anticipo no usa la declaración de contado');
  igual(page.erroresPagina, [], 'errores de JS');
  console.log(`     (Anticipo: ${pdf.paginas} página, ${pdf.bytes} bytes → ${path.join(SALIDA, 'RD-16102026-002-anticipo.pdf')})`);
  await page.close();
});

caso('Pago de contado: sin resumen ni saldo pendiente y con la declaración de pago total de la compra descrita', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'RD-16102026-003-contado.pdf', recibo({ folio: 'RD-16102026-003', tipo: 'Pago de contado', resumen: null, concepto: 'Compra de 10 tambos nuevos', importe: 2650, importeLetra: 'DOS MIL SEISCIENTOS CINCUENTA PESOS 00/100 MN' }), EMISOR, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  ['RECIBO DE DINERO', 'Folio: RD-16102026-003', 'DOS MIL SEISCIENTOS CINCUENTA PESOS 00/100 MN', 'DECLARACIÓN Y ALCANCE', 'como pago total de contado de la compra descrita en el concepto', 'RECIBIÓ POR RIVALPLASTIC', 'ENTREGÓ EL DINERO'].forEach((f) => afirmar(contiene(pdf, f), `falta: "${f}"`));
  ['RESUMEN DE LA OPERACIÓN', 'Saldo pendiente', 'Total de la operación', 'en calidad de anticipo'].forEach((f) => afirmar(!contiene(pdf, f), `no debe llevar: "${f}"`));
  // Un recibo de contado con un resumen guardado (no debería existir) tampoco lo imprime.
  const conResumen = await generar(page, 'RD-contado-con-resumen.pdf', recibo({ tipo: 'Pago de contado' }), EMISOR, null);
  afirmar(!contiene(conResumen, 'Saldo pendiente') && !contiene(conResumen, 'RESUMEN DE LA OPERACIÓN'), 'contado nunca imprime el resumen');
  await page.close();
});

caso('Anticipo sin resumen capturado: no imprime la sección de resumen', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'RD-anticipo-sin-resumen.pdf', recibo({ resumen: null }), EMISOR, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  afirmar(!contiene(pdf, 'RESUMEN DE LA OPERACIÓN') && !contiene(pdf, 'Saldo pendiente'), 'sin resumen');
  afirmar(contiene(pdf, 'en calidad de anticipo'), 'pero sí la declaración de anticipo');
  await page.close();
});

caso('Cancelado: lleva la marca CANCELADO (y el aviso con su motivo); Emitido no', async (browser) => {
  const page = await nuevaPagina(browser);
  const cancelado = await generar(page, 'RD-16102026-002-cancelado.pdf', recibo({ estado: 'Cancelado', motivoCancelacion: 'Cliente desistió de la compra', canceladoPor: 'ventas1', canceladoEn: '2026-10-17T15:30:00.000Z' }), EMISOR, LOGO);
  igual(cancelado.paginas, 1, 'páginas');
  afirmar(veces(cancelado, 'CANCELADO') >= 2, `marca de agua y aviso: ${veces(cancelado, 'CANCELADO')} apariciones`);
  afirmar(contiene(cancelado, 'Motivo: Cliente desistió de la compra'), 'el aviso lleva el motivo');
  afirmar(/0\.7071/.test(cancelado.texto), 'la marca va en diagonal (matriz de rotación a 45°)');
  const emitido = await generar(page, 'RD-16102026-002-emitido.pdf', recibo(), EMISOR, LOGO);
  igual(veces(emitido, 'CANCELADO'), 0, 'Emitido sin marca');
  await page.close();
});

caso('el emisor sale de config/emisor, no del código: otra razón social, domicilio, teléfono y correo aparecen; si faltan, se omiten', async (browser) => {
  const page = await nuevaPagina(browser);
  const otro = await generar(page, 'RD-otro-emisor.pdf', recibo(), { ...EMISOR, razonSocial: 'OTRA EMPRESA DEL SUR SA', domicilioFiscal: 'Calle Falsa 123', telefono: '555 000 1111', correo: 'hola@otra.example' }, null);
  ['OTRA EMPRESA DEL SUR SA declara haber recibido', 'Domicilio: Calle Falsa 123', 'Tel.: 555 000 1111', 'Correo: hola@otra.example'].forEach((f) => afirmar(contiene(otro, f), `falta: "${f}"`));
  afirmar(!contiene(otro, 'RIVAL PLASTIC, S.A.P.I.') && !contiene(otro, 'Domicilio: San Luis Potosí') && !contiene(otro, '444 123 4567') && !contiene(otro, 'ventas@rivalplastic.example'), 'no queda ningún dato fijo del emisor anterior');
  const vacio = await generar(page, 'RD-emisor-vacio.pdf', recibo(), { razonSocial: 'EMPRESA SA', rfc: '', domicilioFiscal: '', telefono: '', correo: '' }, null);
  afirmar(!contiene(vacio, 'Tel.:') && !contiene(vacio, 'Correo:'), 'Tel. y Correo omitidos');
  igual(vacio.paginas, 1, 'páginas');
  await page.close();
});

caso('campos opcionales vacíos (RFC, domicilio, referencia, pedido): el PDF sale igual, en una hoja, sin la palabra "undefined"', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'RD-campos-vacios.pdf', recibo({ cliente: { nombre: 'CLIENTE SIN DATOS', rfc: '', domicilio: '' }, referencia: '', pedidoReferencia: '', formaPago: 'Efectivo' }), EMISOR, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  afirmar(!contiene(pdf, 'undefined') && !contiene(pdf, 'NaN'), 'sin undefined ni NaN');
  ['CLIENTE SIN DATOS', 'RFC (opcional):', 'Pedido / cotización / OC No.:', 'Efectivo'].forEach((f) => afirmar(contiene(pdf, f), `falta: "${f}"`));
  await page.close();
});

caso('peor caso: 12 partidas, concepto de 500 caracteres, cliente y domicilio largos y saldo en dólares caben en UNA hoja carta', async (browser) => {
  const page = await nuevaPagina(browser);
  const partidas = Array.from({ length: 12 }, (_, i) => ({ descripcion: `PRODUCTO NÚMERO ${i + 1} CON UNA DESCRIPCIÓN BASTANTE LARGA PARA PROBAR EL AJUSTE DE LÍNEA DEL RESUMEN`, cantidad: 100 + i, unidad: 'PZ', precioUnitario: 12.5, importe: (100 + i) * 12.5 }));
  const total = partidas.reduce((s, p) => s + p.importe, 0);
  const pdf = await generar(page, 'RD-peor-caso.pdf', recibo({
    moneda: 'USD', importe: 1000.5, importeLetra: 'UN MIL DÓLARES 50/100 USD',
    cliente: { nombre: 'COMERCIALIZADORA Y DISTRIBUIDORA INDUSTRIAL DE PLÁSTICOS RECICLADOS DEL BAJÍO Y DEL CENTRO DE MÉXICO, SOCIEDAD ANÓNIMA DE CAPITAL VARIABLE', rfc: 'CDI010101AAA', domicilio: 'Avenida de los Insurgentes Sur 1234, Colonia Del Valle Centro, Alcaldía Benito Juárez, Ciudad de México, C.P. 03100, entre calle Sur y calle Norte' },
    concepto: 'Anticipo / pago a cuenta por compra de: '.concat('TAMBOS Y TAPAS DE HDPE REPROCESO '.repeat(15)).slice(0, 500),
    resumen: { partidas, totalOperacion: total, importeRecibido: 1000.5, saldoPendiente: total - 1000.5 }
  }), EMISOR, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  afirmar(contiene(pdf, 'ENTREGÓ EL DINERO') && contiene(pdf, 'MATERIALES PLÁSTICOS') && contiene(pdf, 'Saldo pendiente'), 'incluye firmas, pie y saldo');
  afirmar(contiene(pdf, 'PRODUCTO NÚMERO 12'), 'las 12 partidas están');
  // `cabe` mide la posición vertical (firmas incluidas, sobre el pie), no solo el número de páginas.
  const medida = await page.evaluate(([r, e]) => { const { escala, paginas, cabe } = window.EVE_RECIBOS_DINERO_PDF.construirDocumento(r, e, null); return { escala, paginas, cabe }; }, [{
    ...recibo(), moneda: 'USD', cliente: { nombre: 'C'.repeat(150), rfc: 'CDI010101AAA', domicilio: 'D'.repeat(250) }, concepto: 'X'.repeat(500),
    resumen: { partidas: Array.from({ length: 12 }, (_, i) => ({ descripcion: 'P'.repeat(200), cantidad: 1 + i, unidad: 'PZ', precioUnitario: 1, importe: 1 + i })), totalOperacion: 78, importeRecibido: 1, saldoPendiente: 77 }
  }, EMISOR]);
  afirmar(medida.cabe && medida.paginas === 1, `el peor caso absoluto (textos al máximo) cabe: ${JSON.stringify(medida)}`);
  await page.close();
});

caso('la detección de "cabe en una hoja" sabe fallar: 40 partidas no caben y se reporta (el módulo no deja capturar más de 12)', async (browser) => {
  const page = await nuevaPagina(browser);
  const medida = await page.evaluate(([r, e]) => { const { cabe } = window.EVE_RECIBOS_DINERO_PDF.construirDocumento(r, e, null); return cabe; }, [recibo({
    resumen: { partidas: Array.from({ length: 40 }, (_, i) => ({ descripcion: `P${i}`, cantidad: 1, unidad: 'PZ', precioUnitario: 1, importe: 1 })), totalOperacion: 40, importeRecibido: 1, saldoPendiente: 39 }
  }), EMISOR]);
  igual(medida, false, '40 partidas no caben');
  await page.close();
});

caso('Generar el PDF desde la pantalla descarga RD-DDMMAAAA-NNN.pdf con el estado real del servidor y NO escribe nada (ni consume folio)', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.evaluate(([crearDb, doc, emisor]) => {
    // eval a propósito: inyecta en la página el texto de crearDbSimulada (código local de prueba, autocontenido; sin datos externos).
    window.db = (0, eval)(`(${crearDb})()`);
    window.db.docs.set('recibos_dinero/r1', { datos: doc, version: 1 });
    window.db.docs.set('config/emisor', { datos: emisor, version: 1 });
    window.db.docs.set('contadores/RD-16102026', { datos: { ultimo: 2 }, version: 1 });
    window.obtenerFechaMexico = () => '2026-10-16';
    // La copia en pantalla dice Emitido, pero en el servidor ya está Cancelado: el PDF debe salir con la marca.
    window.EVE = { currentUser: { username: 'ventas1', permisosResueltos: { recibosDinero: 'lectura' } }, recibosDinero: [{ ...doc, id: 'r1', estado: 'Emitido' }], clientesCotizacion: [] };
    window.EVE_MODULES.recibosDinero.render(document.getElementById('main-content'));
  }, [crearDbSimulada.toString(), { ...recibo(), id: undefined, estado: 'Cancelado', motivoCancelacion: 'Duplicado', canceladoPor: 'ventas1', canceladoEn: '2026-10-17T10:00:00.000Z' }, EMISOR]);
  const versionesAntes = await page.evaluate(() => JSON.stringify(Array.from(window.db.docs.entries()).map(([r, d]) => [r, d.version])));
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.EVE_RECIBOS_DINERO_PDF.generarPdfReciboDinero('r1', window.EVE.recibosDinero[0]))]);
  igual(descarga.suggestedFilename(), 'RD-16102026-002.pdf', 'nombre del archivo = folio');
  const ruta = path.join(SALIDA, 'RD-descargado.pdf');
  await descarga.saveAs(ruta);
  const texto = fs.readFileSync(ruta).toString('latin1');
  afirmar(texto.includes('CANCELADO'), 'el PDF usa el estado real del servidor (Cancelado)');
  afirmar(texto.includes('RIVAL PLASTIC, S.A.P.I. DE C.V.'), 'el emisor salió de config/emisor');
  igual(await page.evaluate(() => JSON.stringify(Array.from(window.db.docs.entries()).map(([r, d]) => [r, d.version]))), versionesAntes, 'ningún documento cambió de versión (ni el contador)');
  igual(await page.evaluate(() => window.EVE.recibosDinero[0].estado), 'Emitido', 'ni siquiera la copia en memoria');
  await page.click('tr[data-id="r1"] >> text=PDF');
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.toast')).some((t) => /PDF RD-16102026-002\.pdf generado/.test(t.textContent)));
  igual(await page.evaluate(() => JSON.stringify(Array.from(window.db.docs.entries()).map(([r, d]) => [r, d.version]))), versionesAntes, 'tampoco el botón escribe nada');
  igual(page.erroresPagina, [], 'errores de JS');
  await page.close();
});

caso('botones PDF: en la lista y en el detalle, para cualquier estado y con solo lectura', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.evaluate(([crearDb, a, b]) => {
    // eval a propósito: inyecta en la página el texto de crearDbSimulada (código local de prueba, autocontenido; sin datos externos).
    window.db = (0, eval)(`(${crearDb})()`);
    window.EVE = { currentUser: { username: 'v', permisosResueltos: { recibosDinero: 'lectura' } }, recibosDinero: [a, b], clientesCotizacion: [] };
    window.EVE_MODULES.recibosDinero.render(document.getElementById('main-content'));
  }, [crearDbSimulada.toString(), { ...recibo(), id: 'r1' }, { ...recibo({ folio: 'RD-16102026-001', estado: 'Cancelado', motivoCancelacion: 'x', canceladoEn: '2026-10-17T10:00:00.000Z', canceladoPor: 'v' }), id: 'r2' }]);
  igual(await page.$$eval('#modulo-recibosdinero tbody tr[data-id] button.cot-pdf', (b) => b.length), 2, 'un PDF por fila, Emitido y Cancelado');
  await page.click('tr[data-id="r2"] >> text=Ver');
  afirmar(await page.$('.cot-form button.cot-pdf'), 'PDF también en el detalle');
  await page.close();
});

(async () => {
  try {
    await prepararLibrerias();
  } catch (error) {
    console.log(`OMITIDO: no hay jsPDF/autoTable en caché y no se pudieron bajar (${error.message}). Los casos de PDF NO se probaron.`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FALLA ${nombre}\n     ${error.message.split('\n')[0]}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos · PDFs en ${SALIDA}`);
  process.exit(fallos ? 1 : 0);
})();
