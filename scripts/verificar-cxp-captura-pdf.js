// PDF de la Vista para captura de CxP (js/cxp-captura-pdf.js) con los JS reales, el CSS real y Chromium (Playwright).
// html2canvas y jsPDF se simulan (anotan lo que reciben): aquí se verifica QUÉ se captura, en qué orden, a qué escala, cómo se
// reparte en páginas y que la selección no cambia. El renderizado real de las librerías se probó aparte.
//
// Cubre: encabezado temporal con la fecha y hora de México del momento de pulsar el botón (aunque el dispositivo esté en UTC u
// otra zona), nombre CxP_por_proveedor_AAAA-MM-DD_HHmm.pdf, captura por bloques (encabezado, panel Resumen y cada proveedor, escala 2), espera de document.fonts.ready, una sola página
// continua con la altura sumada, corte de páginas solo entre bloques de proveedor, 'Mostrar solo seleccionados' y la selección
// tal como se ven (sin modificarla), nombre CxP_por_proveedor_AAAA-MM-DD.pdf, botones fuera de la captura
// (data-html2canvas-ignore), sin autoTable y protección contra doble clic.
//
// Uso: node scripts/verificar-cxp-captura-pdf.js   (código de salida 1 si algún caso falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/vista-captura.js', 'js/cxp-captura-pdf.js'];
// 20 de octubre de 2026, 21:30 UTC = 15:30 en Ciudad de México (UTC-6); el navegador de la prueba corre en UTC.
const RELOJ = '2026-10-20T21:30:00Z';
const ENCABEZADO = 'CxP al 20 de octubre de 2026, 3:30 p. m.';
const NOMBRE = 'CxP_por_proveedor_2026-10-20_1530.pdf';

// Se serializa y se ejecuta dentro de la página, por eso lleva sus datos adentro.
function CONFIG_PAGINA() {
  const PROVEEDORES = [
    { nombre: 'ALFA', saldo: 3000, tickets: 3 },
    { nombre: 'BETA', saldo: 2000, tickets: 2 },
    { nombre: 'GAMA', saldo: 1000, tickets: 4 }
  ];
  const filasDe = (p) => Array.from({ length: p.tickets }, (_, i) => ({ ticket: `${p.nombre}-${i + 1}`, material: 'P.P.', kg: 100, total: 1000 }));
  const columnas = [
    { clave: 'ticket', etiqueta: 'Ticket', ancho: '30%' },
    { clave: 'material', etiqueta: 'Material', ancho: '30%' },
    { clave: 'kg', etiqueta: 'Kg', ancho: '20%', alineacion: 'right' },
    { clave: 'total', etiqueta: 'Total', ancho: '20%', alineacion: 'right' }
  ];
  window.__marcados = new Set();
  return {
    titulo: 'CxP · Por Proveedor',
    periodo: 'Todos',
    kpis: [{ label: 'Total del periodo', valor: '$6,000.00' }],
    resumenSecciones: [{
      titulo: 'Saldo por proveedor',
      filas: PROVEEDORES.map((p) => ({ label: p.nombre, valor: `$${p.saldo}`, clave: p.nombre, monto: p.saldo })),
      etiquetaLabel: 'Proveedor',
      etiquetaValor: 'Saldo',
      seleccion: {
        marcados: window.__marcados,
        alAlternar: (clave, marcado) => { if (marcado) window.__marcados.add(clave); else window.__marcados.delete(clave); },
        etiquetaTotal: 'Total seleccionado',
        formatoTotal: (m) => `$${m}`
      }
    }],
    grupos: PROVEEDORES.map((p) => ({ clave: p.nombre, encabezado: p.nombre, subtotal: `Subtotal $${p.saldo}`, filas: filasDe(p), columnas }))
  };
}

// Simulacros: html2canvas devuelve un "canvas" del tamaño del elemento por la escala; jsPDF anota cada llamada.
const PREPARAR_SIMULACROS = (reloj) => {
  window.__capturas = [];
  window.__pdf = { docs: [] };
  window.__ahoraISO = reloj;
  const RealDate = Date;
  window.Date = class extends RealDate {
    constructor(...args) { if (args.length === 0) super(window.__ahoraISO); else super(...args); }
    static now() { return new RealDate(window.__ahoraISO).getTime(); }
  };
  window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = 0;
  window.html2canvas = async (elemento, opciones) => {
    const rect = elemento.getBoundingClientRect();
    const titulo = elemento.querySelector('h1');
    const overlay = document.getElementById('vista-captura-overlay');
    window.__capturas.push({
      clase: elemento.className,
      encabezado: (elemento.querySelector('h3') || elemento.querySelector('h2') || {}).textContent,
      texto: titulo ? titulo.textContent : undefined,
      escala: opciones.scale,
      fuentesListas: window.__fuentesListas !== false,
      caja: { w: rect.width, h: rect.height },
      mb: parseFloat(getComputedStyle(elemento).marginBottom) || 0,
      enDocumento: document.body.contains(elemento),
      dentroDelOverlay: overlay.contains(elemento),
      enPantalla: rect.right > 0 && rect.left < window.innerWidth && rect.bottom > 0 && rect.top < window.innerHeight,
      estilo: titulo ? { peso: getComputedStyle(titulo).fontWeight, color: getComputedStyle(titulo).color, familia: getComputedStyle(titulo).fontFamily, altoLinea: titulo.getBoundingClientRect().height, letra: parseFloat(getComputedStyle(titulo).fontSize) } : undefined,
      layout: window.__layout ? window.__layout() : undefined
    });
    if (window.__fallarEnCaptura && window.__capturas.length === window.__fallarEnCaptura) throw new Error('Falló la captura');
    if (window.__avanzarReloj) window.__ahoraISO = window.__avanzarReloj;
    return { width: Math.round(rect.width * opciones.scale), height: Math.round(rect.height * opciones.scale), toDataURL: () => 'data:image/png;base64,AAAA' };
  };
  window.jspdf = {
    jsPDF: class {
      constructor(opciones) {
        this.llamadas = [];
        this.paginas = [{ formato: opciones.format }];
        this.opciones = opciones;
        window.__pdf.docs.push(this);
      }
      addPage(formato) { this.paginas.push({ formato }); this.llamadas.push(['addPage', formato]); return this; }
      setFillColor() { return this; }
      rect() { return this; }
      addImage(...args) { this.llamadas.push(['addImage', args[3], args[4], args[5], args[6], this.paginas.length]); return this; }
      save(nombre) { this.guardado = nombre; }
      output() { return new Blob(['%PDF'], { type: 'application/pdf' }); }
    }
  };
};

async function crearPagina(browser, { ancho = 480, zona = 'UTC' } = {}) {
  const page = await browser.newPage({ viewport: { width: ancho, height: 900 }, timezoneId: zona });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="toast-container"></div></body></html>');
  await page.addStyleTag({ path: path.join(RAIZ, 'css/styles.css') });
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } };
    window.EVE = {};
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(PREPARAR_SIMULACROS, RELOJ);
  page.erroresPagina = errores;
  return page;
}

async function abrirVista(page) {
  await page.evaluate(`window.__construirConfig = ${CONFIG_PAGINA.toString()};`);
  await page.evaluate(() => {
    window.VistaCaptura.abrir(window.__construirConfig());
    window.EVE_CXP_CAPTURA_PDF.agregarBotones(document.getElementById('vista-captura-overlay'));
  });
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// ── Reparto en páginas (función pura) ─────────────────────────────────────────

caso('Reparto: si todo cabe va en una sola página con el Resumen', async (browser) => {
  const page = await crearPagina(browser);
  const r = await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.repartirBloquesEnPaginas(100, [200, 200, 200], 1000, 10));
  igual(r, [{ conResumen: true, indices: [0, 1, 2], alto: 730 }], 'una página');
  await page.close();
});

caso('Reparto: parte solo entre proveedores, el Resumen queda con el primero y ningún bloque se divide', async (browser) => {
  const page = await crearPagina(browser);
  const r = await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.repartirBloquesEnPaginas(100, [400, 400, 400, 400], 1000, 0));
  igual(r.map((p) => [p.conResumen, p.indices]), [[true, [0, 1]], [false, [2, 3]]], 'páginas');
  const unico = await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.repartirBloquesEnPaginas(100, [5000, 300], 1000, 0));
  igual(unico.map((p) => [p.conResumen, p.indices]), [[true, [0]], [false, [1]]], 'un bloque más alto que el máximo va completo, nunca partido');
  await page.close();
});

// ── Captura ───────────────────────────────────────────────────────────────────

caso('Captura por bloques a escala 2: primero el panel Resumen y luego cada proveedor, sin autoTable', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay')));
  const capturas = await page.evaluate(() => window.__capturas);
  igual(capturas.map((c) => c.clase.split(' ')[0]), ['captura-header', 'captura-resumen', 'captura-dia', 'captura-dia', 'captura-dia'], 'orden de bloques');
  igual(capturas.slice(2).map((c) => c.encabezado), ['ALFA · Subtotal $3000', 'BETA · Subtotal $2000', 'GAMA · Subtotal $1000'], 'proveedores');
  afirmar(capturas.every((c) => c.escala === 2), 'todas a escala 2');
  const sinAutoTable = await page.evaluate(() => typeof window.__pdf.docs[0].autoTable === 'undefined');
  afirmar(sinAutoTable, 'no se usa autoTable');
  await page.close();
});

caso('Espera document.fonts.ready antes de capturar', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const antes = await page.evaluate(async () => {
    let liberar;
    const lista = new Promise((resolver) => { liberar = resolver; });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: lista } });
    window.__fuentesListas = false;
    const tarea = window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay'));
    await new Promise((r) => setTimeout(r, 50));
    const capturasAntes = window.__capturas.length;
    window.__fuentesListas = true;
    liberar();
    await tarea;
    return { capturasAntes, capturasDespues: window.__capturas.length, algunaSinFuentes: window.__capturas.some((c) => !c.fuentesListas) };
  });
  igual(antes.capturasAntes, 0, 'sin capturas mientras las fuentes no están listas');
  igual(antes.capturasDespues, 5, 'captura al estar listas');
  afirmar(!antes.algunaSinFuentes, 'ninguna captura con las fuentes sin cargar');
  await page.close();
});

caso('Una sola página continua: ancho de la vista y altura sumada de los bloques', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(async () => {
    const overlay = document.getElementById('vista-captura-overlay');
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(overlay);
    const doc = window.__pdf.docs[0];
    return { capturas: window.__capturas, formato: doc.opciones.format, adds: doc.llamadas.filter((l) => l[0] === 'addImage'), paginas: doc.paginas.length };
  });
  igual(r.paginas, 1, 'una sola página');
  // Huecos: tras el encabezado, su propio margen; entre los demás bloques, el margen de un proveedor.
  const ancho = Math.max(...r.capturas.map((c) => c.caja.w));
  const alto = r.capturas.reduce((s, c) => s + c.caja.h, 0) + r.capturas[0].mb + 3 * r.capturas[2].mb;
  afirmar(Math.abs(r.formato[0] - ancho) < 1.5 && Math.abs(r.formato[1] - alto) < 3, `tamaño de página ${JSON.stringify(r.formato)} vs ${ancho}x${alto}`);
  igual(r.adds.length, 5, 'una imagen por bloque');
  const ys = r.adds.map((a) => a[1]);
  afirmar(ys.every((y, i) => i === 0 || y > ys[i - 1]), `bloques apilados de arriba abajo: ${ys}`);
  await page.close();
});

caso('Si la altura supera el máximo, parte en páginas solo entre proveedores (cada proveedor en una sola página)', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(async () => {
    const overlay = document.getElementById('vista-captura-overlay');
    // Una primera pasada mide los bloques; el máximo alcanza para encabezado + Resumen + 2 proveedores pero no para los 3.
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(overlay);
    const [enc, res, a, b] = window.__capturas;
    const maxAlto = enc.caja.h + enc.mb + res.caja.h + res.mb + a.caja.h + a.mb + b.caja.h + 60;
    window.__capturas = [];
    window.__pdf.docs = [];
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(overlay, { maxAlto });
    const doc = window.__pdf.docs[0];
    return { paginas: doc.paginas.length, adds: doc.llamadas.filter((l) => l[0] === 'addImage').map((a) => a[5]), altoMaxPagina: Math.max(doc.paginas[0].formato[1], ...doc.paginas.map((p) => p.formato[1])), maxAlto };
  });
  igual(r.paginas, 2, 'dos páginas');
  igual(r.adds, [1, 1, 1, 1, 2], 'encabezado + Resumen + 2 proveedores en la 1; el tercero completo en la 2');
  afirmar(r.altoMaxPagina <= r.maxAlto + 1, 'ninguna página supera el máximo');
  await page.close();
});

caso('Respeta "Mostrar solo seleccionados" y la selección tal como se ven, sin modificarla', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.check('[data-captura-fila-clave="BETA"] input');
  await page.check('.captura-solo-seleccionados input');
  const antes = await page.evaluate(() => ({
    marcados: [...window.__marcados],
    checks: [...document.querySelectorAll('.captura-check-seleccion')].map((c) => c.checked),
    interruptor: document.querySelector('.captura-solo-seleccionados input').checked
  }));
  await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay')));
  const capturas = await page.evaluate(() => window.__capturas.map((c) => c.encabezado));
  igual(capturas.slice(2), ['BETA · Subtotal $2000'], 'solo el proveedor seleccionado');
  igual(capturas.length, 3, 'encabezado + Resumen + el proveedor');
  const despues = await page.evaluate(() => ({
    marcados: [...window.__marcados],
    checks: [...document.querySelectorAll('.captura-check-seleccion')].map((c) => c.checked),
    interruptor: document.querySelector('.captura-solo-seleccionados input').checked
  }));
  igual(despues, antes, 'la selección no cambia');
  await page.close();
});

caso('Sin "Mostrar solo seleccionados" se capturan todos aunque haya selección', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.check('[data-captura-fila-clave="ALFA"] input');
  await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay')));
  igual(await page.evaluate(() => window.__capturas.length), 5, 'encabezado + resumen + 3 proveedores');
  await page.close();
});

// ── Botón, nombre y doble clic ────────────────────────────────────────────────

caso('Los botones llevan data-html2canvas-ignore y quedan fuera de los bloques capturados', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(() => {
    const barra = document.querySelector('#vista-captura-overlay [data-html2canvas-ignore]');
    const bloques = [document.querySelector('.captura-resumen'), ...document.querySelectorAll('.captura-dia')];
    return {
      textos: [...barra.querySelectorAll('button')].map((b) => b.textContent),
      dentroDeUnBloque: bloques.some((b) => b.contains(barra))
    };
  });
  igual(r.textos, ['Descargar PDF', 'Compartir'], 'botones de la barra');
  afirmar(!r.dentroDeUnBloque, 'la barra no está dentro de ningún bloque capturado');
  await page.close();
});

caso('Descargar PDF guarda CxP_por_proveedor_AAAA-MM-DD_HHmm.pdf con la hora de México', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.click('text=Descargar PDF');
  await page.waitForFunction(() => window.__pdf.docs.length > 0 && window.__pdf.docs[0].guardado);
  igual(await page.evaluate(() => window.__pdf.docs[0].guardado), NOMBRE, 'nombre');
  await page.close();
});

caso('Doble clic seguido genera un solo PDF', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Descargar PDF'); b.click(); b.click(); });
  await page.waitForFunction(() => window.__pdf.docs.length > 0 && window.__pdf.docs[0].guardado);
  await page.waitForTimeout(150);
  igual(await page.evaluate(() => window.__pdf.docs.length), 1, 'un solo documento');
  await page.close();
});

caso('Sin las librerías cargadas avisa con un mensaje claro y no guarda nada', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(() => { delete window.html2canvas; });
  await page.click('text=Descargar PDF');
  await page.waitForSelector('.toast-error');
  afirmar((await page.textContent('.toast-error')).includes('librería'), 'mensaje de librería');
  igual(await page.evaluate(() => window.__pdf.docs.length), 0, 'no se creó ningún PDF');
  await page.close();
});

// ── Encabezado con fecha y hora de México ─────────────────────────────────────

caso('Formato: fecha en palabras y hora de 12 h con a. m./p. m., y nombre con HHmm de 24 h (zona de México, no la del dispositivo)', async (browser) => {
  const page = await crearPagina(browser);
  const r = await page.evaluate(() => {
    const m = window.EVE_CXP_CAPTURA_PDF;
    return ['2026-10-20T21:30:00Z', '2026-10-20T18:00:00Z', '2026-10-21T06:05:00Z', '2026-10-21T05:59:00Z', '2026-01-05T15:07:00Z']
      .map((iso) => [m.textoEncabezadoPdf(new Date(iso)), m.nombreArchivoPdf(new Date(iso))]);
  });
  igual(r, [
    ['CxP al 20 de octubre de 2026, 3:30 p. m.', 'CxP_por_proveedor_2026-10-20_1530.pdf'],
    ['CxP al 20 de octubre de 2026, 12:00 p. m.', 'CxP_por_proveedor_2026-10-20_1200.pdf'],
    ['CxP al 21 de octubre de 2026, 12:05 a. m.', 'CxP_por_proveedor_2026-10-21_0005.pdf'],
    ['CxP al 20 de octubre de 2026, 11:59 p. m.', 'CxP_por_proveedor_2026-10-20_2359.pdf'],
    ['CxP al 5 de enero de 2026, 9:07 a. m.', 'CxP_por_proveedor_2026-01-05_0907.pdf']
  ], 'textos y nombres');
  await page.close();
});

caso('El primer bloque es el encabezado de la hora de México con el dispositivo en UTC y también en Tokio', async (browser) => {
  for (const zona of ['UTC', 'Asia/Tokyo']) {
    const page = await crearPagina(browser, { zona });
    await abrirVista(page);
    await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay')));
    const r = await page.evaluate(() => ({ primero: window.__capturas[0].texto, guardado: window.__pdf.docs[0].guardado }));
    igual([r.primero, r.guardado], [ENCABEZADO, NOMBRE], `zona ${zona}`);
    await page.close();
  }
});

caso('El encabezado usa el instante de pulsar el botón, no el de terminar la captura', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(() => { window.__avanzarReloj = '2026-10-20T22:45:00Z'; });
  await page.evaluate(() => window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay')));
  igual(await page.evaluate(() => [window.__capturas[0].texto, window.__pdf.docs[0].guardado]), [ENCABEZADO, NOMBRE], 'hora de la pulsación');
  await page.close();
});

caso('El encabezado es temporal: fuera de pantalla, fuera del overlay, sin alterar el layout y se elimina al terminar', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(async () => {
    const overlay = document.getElementById('vista-captura-overlay');
    const medir = () => [overlay.scrollHeight, ...[...overlay.querySelectorAll('.captura-resumen, .captura-dia')].map((e) => JSON.stringify(e.getBoundingClientRect()))];
    window.__layout = medir;
    const antes = medir();
    const titulosAntes = document.querySelectorAll('h1').length;
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(overlay);
    const durante = window.__capturas[0];
    return {
      sinEncabezadoAntes: !document.querySelector('.captura-pdf-encabezado'),
      durante: { enDocumento: durante.enDocumento, dentroDelOverlay: durante.dentroDelOverlay, enPantalla: durante.enPantalla },
      layoutIgualDurante: JSON.stringify(durante.layout) === JSON.stringify(antes),
      layoutIgualDespues: JSON.stringify(medir()) === JSON.stringify(antes),
      restos: document.querySelectorAll('.captura-pdf-encabezado').length,
      titulos: document.querySelectorAll('h1').length === titulosAntes
    };
  });
  igual(r.durante, { enDocumento: true, dentroDelOverlay: false, enPantalla: false }, 'durante la captura');
  afirmar(r.sinEncabezadoAntes, 'no existe antes de pulsar');
  afirmar(r.layoutIgualDurante && r.layoutIgualDespues, 'el layout de la vista no cambia');
  igual([r.restos, r.titulos], [0, true], 'nada queda en el DOM al terminar');
  await page.close();
});

caso('Si la captura falla, el encabezado temporal también se elimina y se avisa', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(() => { window.__fallarEnCaptura = 3; });
  await page.click('text=Descargar PDF');
  await page.waitForSelector('.toast-error');
  igual(await page.evaluate(() => document.querySelectorAll('.captura-pdf-encabezado').length), 0, 'sin restos');
  igual(await page.evaluate(() => window.__pdf.docs.length), 0, 'no se creó PDF');
  await page.close();
});

caso('El encabezado va en una sola línea y con el estilo de los títulos de la vista', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(async () => {
    const titulo = getComputedStyle(document.querySelector('.captura-header h1'));
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(document.getElementById('vista-captura-overlay'));
    const e = window.__capturas[0].estilo;
    return { propio: [e.peso, e.color, e.familia], vista: [titulo.fontWeight, titulo.color, titulo.fontFamily], unaLinea: e.altoLinea < e.letra * 1.6 };
  });
  igual(r.propio, r.vista, 'negrita, color y familia iguales a los del título de la vista');
  afirmar(r.propio[2].includes('DM Sans'), 'DM Sans');
  afirmar(r.unaLinea, 'una sola línea');
  await page.close();
});

// ── Compartir (navigator.share simulado) ──────────────────────────────────────

// Instala navigator.share / canShare simulados; `modo`: 'ok' | 'cancela' | 'falla' | 'sin_canshare' | 'no_permite'.
const SIMULAR_SHARE = (modo) => {
  window.__share = { llamadas: [], canShare: [] };
  const definir = (nombre, valor) => Object.defineProperty(navigator, nombre, { configurable: true, value: valor });
  if (modo === 'sin_canshare') {
    definir('share', undefined);
    definir('canShare', undefined);
    return;
  }
  definir('canShare', (datos) => { window.__share.canShare.push(datos.files.map((f) => f.name)); return modo !== 'no_permite'; });
  definir('share', async (datos) => {
    window.__share.llamadas.push({ nombres: datos.files.map((f) => f.name), tipos: datos.files.map((f) => f.type), tamanos: datos.files.map((f) => f.size) });
    if (modo === 'cancela') throw new DOMException('Share canceled', 'AbortError');
    if (modo === 'falla') throw new Error('Fallo del sistema al compartir');
  });
};

async function compartirCon(browser, modo) {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(SIMULAR_SHARE, modo);
  await page.click('text=Compartir');
  await page.waitForFunction(() => !document.querySelector('.captura-acciones button:disabled'));
  const r = await page.evaluate(() => ({
    share: window.__share,
    guardado: window.__pdf.docs.length ? window.__pdf.docs[0].guardado : undefined,
    primerBloque: window.__capturas.length ? window.__capturas[0].texto : undefined,
    errores: [...document.querySelectorAll('.toast-error')].map((t) => t.textContent),
    avisos: [...document.querySelectorAll('.toast-success')].map((t) => t.textContent)
  }));
  await page.close();
  return r;
}

caso('Compartir: junto a Descargar PDF, dentro de la barra que se excluye de la captura', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  igual(await page.evaluate(() => [...document.querySelectorAll('#vista-captura-overlay [data-html2canvas-ignore] button')].map((b) => b.textContent)), ['Descargar PDF', 'Compartir'], 'botones');
  await page.close();
});

caso('Compartir: comparte el archivo PDF con el nombre correcto y no lo descarga', async (browser) => {
  const r = await compartirCon(browser, 'ok');
  igual(r.share.canShare, [[NOMBRE]], 'se comprobó canShare con el archivo');
  igual(r.share.llamadas.map((l) => [l.nombres, l.tipos]), [[[NOMBRE], ['application/pdf']]], 'archivo compartido');
  afirmar(r.share.llamadas[0].tamanos[0] > 0, 'el archivo no está vacío');
  igual(r.primerBloque, ENCABEZADO, 'mismo encabezado que Descargar PDF');
  igual([r.guardado, r.errores], [undefined, []], 'no se descarga ni hay errores');
});

caso('Compartir: si la persona cancela no se muestra error ni se descarga', async (browser) => {
  const r = await compartirCon(browser, 'cancela');
  igual(r.share.llamadas.length, 1, 'se intentó compartir');
  igual([r.guardado, r.errores, r.avisos], [undefined, [], []], 'sin descarga, sin error, sin aviso');
});

caso('Compartir: sin soporte (canShare dice que no) descarga el PDF y avisa', async (browser) => {
  const r = await compartirCon(browser, 'no_permite');
  igual(r.share.llamadas.length, 0, 'no se llamó a share');
  igual(r.guardado, NOMBRE, 'se descargó con el nombre correcto');
  igual(r.avisos, ['Tu dispositivo no permite compartir directo; adjunta el archivo descargado'], 'aviso breve');
  igual(r.errores, [], 'no es un error');
});

caso('Compartir: sin navigator.share ni canShare también descarga y avisa', async (browser) => {
  const r = await compartirCon(browser, 'sin_canshare');
  igual(r.guardado, NOMBRE, 'descarga');
  igual(r.avisos, ['Tu dispositivo no permite compartir directo; adjunta el archivo descargado'], 'aviso');
});

caso('Compartir: un fallo real de share (no cancelación) sí se muestra como error', async (browser) => {
  const r = await compartirCon(browser, 'falla');
  igual(r.errores, ['Fallo del sistema al compartir'], 'error visible');
  igual(r.guardado, undefined, 'no descarga');
});

caso('Compartir: doble clic seguido comparte una sola vez', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.evaluate(SIMULAR_SHARE, 'ok');
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Compartir'); b.click(); b.click(); });
  await page.waitForFunction(() => window.__share.llamadas.length > 0);
  await page.waitForTimeout(150);
  igual(await page.evaluate(() => [window.__share.llamadas.length, window.__pdf.docs.length]), [1, 1], 'un share y un documento');
  await page.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn(browser);
      console.log(`  ok   ${nombre}`);
    } catch (error) {
      fallos++;
      console.log(`  FALLA ${nombre}\n       ${error.message.split('\n')[0]}`);
    }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
