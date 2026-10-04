// Prueba del PDF de Cotizaciones con jsPDF y autoTable REALES en Chromium (Playwright): genera PDFs de verdad, los guarda en
// una carpeta temporal FUERA del repo (os.tmpdir()/eve-cotizaciones-pdf) y revisa su contenido: páginas con 30 partidas,
// folio con revisión, marca de agua por estado, acentos y eñe, logo, y la descarga con el nombre del folio.
//
// jsPDF y autoTable no son dependencias del repo (la app los carga del CDN): aquí se bajan del mismo CDN a una caché
// temporal. Sin internet esos casos se OMITEN (se avisa), no se dan por buenos.
//
// Uso: node scripts/verificar-cotizaciones-pdf.js   (código de salida 1 si algo falla)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SALIDA = path.join(os.tmpdir(), 'eve-cotizaciones-pdf');
const CACHE_LIBS = path.join(os.tmpdir(), 'eve-pdf-libs');
const LIBRERIAS = [
  ['jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
  ['jspdf.plugin.autotable.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js']
];
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/cotizaciones.js', 'js/cotizaciones-pdf.js'];
const LOGO = 'data:image/png;base64,' + fs.readFileSync(path.join(RAIZ, 'icons/icon-192.png')).toString('base64');

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

const SIMULAR_FIREBASE = () => {
  window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
  window.EVE = { currentUser: { username: 'ventas1', permisosResueltos: { cotizaciones: 'escritura' } }, cotizaciones: [], clientesCotizacion: [] };
  window.EVE_MODULES = {};
};

// config.js crea el db real al cargarse: el Firestore simulado se instala DESPUÉS de cargar los scripts.
const SIMULAR_DB = () => {
  const docs = new Map();
  window.__docs = docs;
  window.db = { collection: (c) => ({ doc: (id) => ({ get: async () => { const d = docs.get(`${c}/${id}`); return { exists: !!d, data: () => d && JSON.parse(JSON.stringify(d)) }; } }) }) };
};

const EMISOR_COMPLETO = { razonSocial: 'RIVAL PLASTIC SAPI DE CV', rfc: 'RPS010101AAA', domicilioFiscal: 'Av. Industria #123, Col. Peñuelas, Monterrey, Nuevo León, C.P. 64000', telefono: '81 1234 5678', correo: 'ventas@rivalplastic.example', vigenciaDias: 15 };

const cotizacion = (extra, numPartidas) => ({
  id: 'x1', folio: 'COT-2026-0001', estado: 'Enviada', fecha: '2026-10-01', vigenciaDias: 15,
  cliente: { razonSocial: 'Plásticos del Norte S.A.', contacto: 'Ana Núñez', telefono: '8112345678', direccion: 'Av. Constitución #100, Col. Niño Artillero' },
  condicionesPago: 'Contado', condicionesEntrega: 'En planta, 3 días hábiles', notas: 'Precios sujetos a existencia.',
  partidas: Array.from({ length: numPartidas === undefined ? 3 : numPartidas }, (_, i) => ({ producto: i % 2 ? 'TAMBO' : '', descripcion: i % 2 ? '' : `Pieza especial ${i + 1} con ñ y acentós`, cantidad: i + 1, unidad: i % 2 ? 'PZ' : 'KG', precioUnitario: 10, descuentoPct: 0, importe: (i + 1) * 10 })),
  totales: { subtotal: 60, aplicaIva: true, ivaTasa: 0.16, iva: 9.6, total: 69.6 }, ...extra
});

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(SIMULAR_FIREBASE);
  for (const [nombre] of LIBRERIAS) await page.addScriptTag({ path: path.join(CACHE_LIBS, nombre) });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(SIMULAR_DB);
  page.erroresPagina = errores;
  return page;
}

// Genera el PDF en la página, lo guarda en la carpeta temporal y devuelve sus bytes como cadena latin1 (los textos de
// jsPDF con fuentes estándar van en el flujo sin comprimir).
async function generar(page, archivo, cot, emisor, logo) {
  const base64 = await page.evaluate(([c, e, l]) => {
    const doc = window.EVE_COTIZACIONES_PDF.crearDocumento(c, e, l);
    const bytes = new Uint8Array(doc.output('arraybuffer'));
    let binario = '';
    bytes.forEach((b) => { binario += String.fromCharCode(b); });
    return btoa(binario);
  }, [cot, emisor, logo || null]);
  const buffer = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(SALIDA, archivo), buffer);
  const texto = buffer.toString('latin1');
  afirmar(texto.startsWith('%PDF-') && texto.trimEnd().endsWith('%%EOF'), 'el archivo no es un PDF válido');
  return { texto, paginas: (texto.match(/\/Type\s*\/Page\b(?!s)/g) || []).length, bytes: buffer.length };
}

caso('PDF real: cotización de 3 partidas = 1 página, con folio, emisor, cliente, totales y total en letra', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'COT-2026-0001.pdf', cotizacion(), EMISOR_COMPLETO, LOGO);
  igual(pdf.paginas, 1, 'páginas');
  ['COT-2026-0001', 'RIVAL PLASTIC SAPI DE CV', 'RFC: RPS010101AAA', 'Plásticos del Norte', 'Subtotal', 'IVA 16%', 'TOTAL', 'SESENTA Y NUEVE PESOS 60/100 M.N.', 'hasta el 16/10/2026', 'Fecha: 01/10/2026']
    .forEach((fragmento) => afirmar(pdf.texto.includes(Buffer.from(fragmento, 'latin1').toString('latin1')), `falta "${fragmento}" en el PDF`));
  afirmar(/\/Subtype\s*\/Image/.test(pdf.texto), 'debe llevar el logo (imagen)');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('PDF real: con 30 partidas pagina (más de una página), repite el encabezado y numera "Página i de n"', async (browser) => {
  const page = await nuevaPagina(browser);
  const pdf = await generar(page, 'COT-2026-0002-30-partidas.pdf', cotizacion({ folio: 'COT-2026-0002' }, 30), EMISOR_COMPLETO, LOGO);
  afirmar(pdf.paginas > 1, `con 30 partidas debe tener más de una página (tiene ${pdf.paginas})`);
  afirmar(pdf.texto.includes(`Página 1 de ${pdf.paginas}`) && pdf.texto.includes(`Página ${pdf.paginas} de ${pdf.paginas}`), 'paginación en el pie');
  afirmar((pdf.texto.match(/\(Descripci\\?\d*[^)]*n\)/g) || pdf.texto.match(/Descripci/g) || []).length >= 1, 'encabezado de la tabla');
  console.log(`     (30 partidas: ${pdf.paginas} páginas, ${pdf.bytes} bytes → ${path.join(SALIDA, 'COT-2026-0002-30-partidas.pdf')})`);
});

caso('PDF real: folio con revisión y leyenda "Sustituye a" (R2 → base, R3 → R2); una R1 no la lleva', async (browser) => {
  const page = await nuevaPagina(browser);
  const r2 = await generar(page, 'COT-2026-0001-R2.pdf', cotizacion({ folio: 'COT-2026-0001-R2', folioBase: 'COT-2026-0001', revision: 2, estado: 'Borrador' }), EMISOR_COMPLETO);
  afirmar(r2.texto.includes('COT-2026-0001-R2') && r2.texto.includes('Sustituye a COT-2026-0001)'), 'R2 sustituye a la base');
  const r3 = await generar(page, 'COT-2026-0001-R3.pdf', cotizacion({ folio: 'COT-2026-0001-R3', folioBase: 'COT-2026-0001', revision: 3 }), EMISOR_COMPLETO);
  afirmar(r3.texto.includes('Sustituye a COT-2026-0001-R2)'), 'R3 sustituye a R2');
  const r1 = await generar(page, 'COT-2026-0003.pdf', cotizacion({ folio: 'COT-2026-0003' }), EMISOR_COMPLETO);
  afirmar(!r1.texto.includes('Sustituye a'), 'la R1 no lleva leyenda');
});

caso('PDF real: marca de agua BORRADOR / CANCELADA / RECHAZADA / REEMPLAZADA; Enviada y Aceptada salen sin marca', async (browser) => {
  const page = await nuevaPagina(browser);
  for (const estado of ['Borrador', 'Cancelada', 'Rechazada', 'Reemplazada']) {
    const pdf = await generar(page, `marca-${estado}.pdf`, cotizacion({ estado }), EMISOR_COMPLETO);
    afirmar(pdf.texto.includes(`(${estado.toUpperCase()})`), `falta la marca ${estado.toUpperCase()}`);
  }
  for (const estado of ['Enviada', 'Aceptada']) {
    const pdf = await generar(page, `sin-marca-${estado}.pdf`, cotizacion({ estado }), EMISOR_COMPLETO);
    afirmar(!/\((BORRADOR|CANCELADA|RECHAZADA|REEMPLAZADA)\)/.test(pdf.texto), `${estado} no debe llevar marca`);
  }
  const larga = await generar(page, 'marca-30-partidas.pdf', cotizacion({ estado: 'Borrador' }, 30), EMISOR_COMPLETO);
  igual((larga.texto.match(/\(BORRADOR\)/g) || []).length, larga.paginas, 'la marca está en CADA página');
});

caso('PDF real: acentos y eñe se escriben tal cual (emisor, cliente, partidas, condiciones, notas)', async (browser) => {
  const page = await nuevaPagina(browser);
  const cot = cotizacion({ cliente: { razonSocial: 'Peñafiel Niño S.A.', contacto: 'José Muñoz', telefono: '1', direccion: 'Av. Ñuñoa #5, Col. Peñuelas' }, notas: 'Entrega después de las 16:00 h. ¡Gracias por su preferencia!' }, 2);
  const pdf = await generar(page, 'acentos.pdf', cot, { ...EMISOR_COMPLETO, razonSocial: 'PEÑA Y COMPAÑÍA SA DE CV' });
  ['Peñafiel Niño S.A.', 'José Muñoz', 'Av. Ñuñoa #5, Col. Peñuelas', 'PEÑA Y COMPAÑÍA SA DE CV', 'acentós', 'después', '¡Gracias por su preferencia!', 'COTIZACIÓN', 'Razón Social', 'Teléfono', 'Dirección', 'Descripción']
    .forEach((fragmento) => afirmar(pdf.texto.includes(fragmento), `falta "${fragmento}" con su acento/eñe`));
});

caso('PDF real: emisor incompleto → el aviso se muestra y, si el usuario acepta, se descarga el PDF con el folio como nombre', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.evaluate((cot) => {
    window.__docs.set('config/emisor', { razonSocial: 'RIVAL PLASTIC SAPI DE CV', vigenciaDias: 15 }); // sin RFC ni domicilio
    window.__cot = cot;
  }, cotizacion({ folio: 'COT-2026-0001-R2', folioBase: 'COT-2026-0001', revision: 2 }));
  const mensajes = [];
  let aceptar = false;
  page.on('dialog', (d) => { mensajes.push(d.message()); return aceptar ? d.accept() : d.dismiss(); });
  igual(await page.evaluate(() => window.EVE_COTIZACIONES_PDF.generarPDF(window.__cot)), null, 'cancelar no genera nada');
  afirmar(mensajes[0].includes('RFC') && mensajes[0].includes('domicilio fiscal'), `aviso: ${mensajes[0]}`);
  aceptar = true;
  const [descarga] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => window.EVE_COTIZACIONES_PDF.generarPDF(window.__cot))]);
  igual(descarga.suggestedFilename(), 'COT-2026-0001-R2.pdf', 'nombre del archivo descargado');
  const destino = path.join(SALIDA, 'descarga-COT-2026-0001-R2.pdf');
  await descarga.saveAs(destino);
  afirmar(fs.readFileSync(destino).toString('latin1').startsWith('%PDF-'), 'la descarga es un PDF');
  igual(page.erroresPagina, [], 'errores de JS');
});

(async () => {
  try {
    await prepararLibrerias();
  } catch (error) {
    console.log(`OMITIDO: no se pudieron bajar jsPDF/autoTable del CDN (${error.message}). Los ${casos.length} casos de PDF real NO se ejecutaron.`);
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
