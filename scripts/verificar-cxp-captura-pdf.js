// PDF de la Vista para captura de CxP (js/cxp-captura-pdf.js) con los JS reales, el CSS real y Chromium (Playwright).
// html2canvas y jsPDF se simulan (anotan lo que reciben): aquí se verifica QUÉ se captura, en qué orden, a qué escala, cómo se
// reparte en páginas y que la selección no cambia. El renderizado real de las librerías se probó aparte.
//
// Cubre: captura por bloques (panel Resumen y cada proveedor, escala 2), espera de document.fonts.ready, una sola página
// continua con la altura sumada, corte de páginas solo entre bloques de proveedor, 'Mostrar solo seleccionados' y la selección
// tal como se ven (sin modificarla), nombre CxP_por_proveedor_AAAA-MM-DD.pdf, botones fuera de la captura
// (data-html2canvas-ignore), sin autoTable y protección contra doble clic.
//
// Uso: node scripts/verificar-cxp-captura-pdf.js   (código de salida 1 si algún caso falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/vista-captura.js', 'js/cxp-captura-pdf.js'];
const FECHA = '2026-10-21';

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
const PREPARAR_SIMULACROS = (fecha) => {
  window.__capturas = [];
  window.__pdf = { docs: [] };
  window.obtenerFechaMexico = () => fecha;
  window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = 0;
  window.html2canvas = async (elemento, opciones) => {
    window.__capturas.push({
      clase: elemento.className,
      encabezado: (elemento.querySelector('h3') || elemento.querySelector('h2') || {}).textContent,
      escala: opciones.scale,
      fuentesListas: window.__fuentesListas !== false
    });
    const rect = elemento.getBoundingClientRect();
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

async function crearPagina(browser, { ancho = 480 } = {}) {
  const page = await browser.newPage({ viewport: { width: ancho, height: 900 } });
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
  await page.evaluate(PREPARAR_SIMULACROS, FECHA);
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
  igual(capturas.map((c) => c.clase.split(' ')[0]), ['captura-resumen', 'captura-dia', 'captura-dia', 'captura-dia'], 'orden de bloques');
  igual(capturas.slice(1).map((c) => c.encabezado), ['ALFA · Subtotal $3000', 'BETA · Subtotal $2000', 'GAMA · Subtotal $1000'], 'proveedores');
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
  igual(antes.capturasDespues, 4, 'captura al estar listas');
  afirmar(!antes.algunaSinFuentes, 'ninguna captura con las fuentes sin cargar');
  await page.close();
});

caso('Una sola página continua: ancho de la vista y altura sumada de los bloques', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(async () => {
    const overlay = document.getElementById('vista-captura-overlay');
    const cajas = [overlay.querySelector('.captura-resumen'), ...overlay.querySelectorAll('.captura-dia')].map((e) => {
      const caja = e.getBoundingClientRect();
      return { w: caja.width, h: caja.height, mb: parseFloat(getComputedStyle(overlay.querySelector('.captura-dia')).marginBottom) || 0 };
    });
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(overlay);
    const doc = window.__pdf.docs[0];
    return { cajas, formato: doc.opciones.format, adds: doc.llamadas.filter((l) => l[0] === 'addImage'), paginas: doc.paginas.length };
  });
  igual(r.paginas, 1, 'una sola página');
  const ancho = Math.max(...r.cajas.map((c) => c.w));
  const alto = r.cajas.reduce((s, c, i) => s + c.h + (i < r.cajas.length - 1 ? c.mb : 0), 0);
  afirmar(Math.abs(r.formato[0] - ancho) < 1.5 && Math.abs(r.formato[1] - alto) < 3, `tamaño de página ${JSON.stringify(r.formato)} vs ${ancho}x${alto}`);
  igual(r.adds.length, 4, 'una imagen por bloque');
  const ys = r.adds.map((a) => a[1]);
  afirmar(ys.every((y, i) => i === 0 || y > ys[i - 1]), `bloques apilados de arriba abajo: ${ys}`);
  await page.close();
});

caso('Si la altura supera el máximo, parte en páginas solo entre proveedores (cada proveedor en una sola página)', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  const r = await page.evaluate(async () => {
    const overlay = document.getElementById('vista-captura-overlay');
    const altos = [...overlay.querySelectorAll('.captura-dia')].map((e) => e.getBoundingClientRect().height);
    const resumen = overlay.querySelector('.captura-resumen').getBoundingClientRect().height;
    // Máximo que alcanza para el Resumen + 2 proveedores pero no para los 3.
    const maxAlto = resumen + altos[0] + altos[1] + 60;
    await window.EVE_CXP_CAPTURA_PDF.descargarPdf(overlay, { maxAlto });
    const doc = window.__pdf.docs[0];
    return { paginas: doc.paginas.length, adds: doc.llamadas.filter((l) => l[0] === 'addImage').map((a) => a[5]), altoMaxPagina: Math.max(doc.paginas[0].formato[1], ...doc.paginas.map((p) => p.formato[1])), maxAlto };
  });
  igual(r.paginas, 2, 'dos páginas');
  igual(r.adds, [1, 1, 1, 2], 'Resumen + 2 proveedores en la 1; el tercero completo en la 2');
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
  igual(capturas.slice(1), ['BETA · Subtotal $2000'], 'solo el proveedor seleccionado');
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
  igual(await page.evaluate(() => window.__capturas.length), 4, 'resumen + 3 proveedores');
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
  igual(r.textos, ['Descargar PDF'], 'botón de la barra');
  afirmar(!r.dentroDeUnBloque, 'la barra no está dentro de ningún bloque capturado');
  await page.close();
});

caso('Descargar PDF guarda CxP_por_proveedor_AAAA-MM-DD.pdf', async (browser) => {
  const page = await crearPagina(browser);
  await abrirVista(page);
  await page.click('text=Descargar PDF');
  await page.waitForFunction(() => window.__pdf.docs.length > 0 && window.__pdf.docs[0].guardado);
  igual(await page.evaluate(() => window.__pdf.docs[0].guardado), `CxP_por_proveedor_${FECHA}.pdf`, 'nombre');
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
