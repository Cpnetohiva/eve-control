// Prueba en Chromium móvil (Playwright, con toque y meta viewport activo) de la Vista para captura: al abrirla en celular el
// navegador permite alejar (escala mínima < 1, medida con CDP Emulation.setPageScaleFactor), el contenido conserva su ancho,
// y al cerrarla la app queda como estaba (meta EXACTO, clases, scroll, zoom y layout). Usa el CSS y el JS reales.
// Límites: Chromium emulado no es un celular real; no prueba el pellizco con los dedos ni Safari de iOS.
//
// Uso: node scripts/verificar-vista-captura-zoom.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const META_ORIGINAL = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
const CONTENIDO_ORIGINAL = 'width=device-width, initial-scale=1.0';
const FILAS = Array.from({ length: 60 }, (_, i) => ({ a: `Material ${i}`, b: i, c: i * 10 }));
const CONFIG = {
  titulo: 'Báscula', periodo: 'Hoy · 03/10/2026',
  kpis: [{ label: 'Tickets', valor: '60' }, { label: 'Kg', valor: '1,770' }],
  resumenTitulo: 'Kg por material', resumenFilas: [{ label: 'PET', valor: '10' }, { label: 'DURO', valor: '20' }],
  columnas: [{ clave: 'a', etiqueta: 'Material' }, { clave: 'b', etiqueta: 'Tickets', alineacion: 'right' }, { clave: 'c', etiqueta: 'Kg', alineacion: 'right', mono: true }],
  filas: FILAS
};

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function abrir(browser, { ancho = 360, alto = 740, meta = META_ORIGINAL, movil = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, hasTouch: movil, isMobile: movil, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.errores = [];
  page.on('pageerror', (e) => page.errores.push(e.message));
  const html = `<!doctype html><html><head><meta charset="utf-8">${meta}<link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="app-shell" class="visible"><header class="app-header"><h1>EVE Control</h1></header><nav class="nav-modulos" id="tabs-container"></nav>
<main id="main-content">${Array.from({ length: 80 }, (_, i) => `<p>Fila de la app ${i}</p>`).join('')}</main></div><script src="/js/vista-captura.js"></script></body></html>`;
  await page.route('http://eve.test/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    if (p === '/') return r.fulfill({ contentType: 'text/html', body: html });
    const f = path.join(RAIZ, p);
    return fs.existsSync(f) ? r.fulfill({ path: f }) : r.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://eve.test/');
  page.cdp = await ctx.newCDPSession(page);
  return page;
}

// Escala mínima que acepta el navegador (se pide 0.2 y se lee la que quedó): 1 = no se puede alejar.
const escalaMinima = async (page) => {
  await page.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.2 });
  const escala = await page.evaluate(() => Number(window.visualViewport.scale.toFixed(2)));
  await page.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  return escala;
};
const metaActual = (page) => page.evaluate(() => { const m = document.querySelector('meta[name="viewport"]'); return m ? m.getAttribute('content') : null; });
const anchoDoc = (page) => page.evaluate(() => document.documentElement.scrollWidth);
const abrirVista = (page) => page.evaluate((c) => window.VistaCaptura.abrir(c), CONFIG);
const cerrarVista = async (page) => { await page.evaluate(() => window.VistaCaptura.cerrar()); await page.waitForTimeout(200); };

caso('línea base: sin la vista abierta no se puede alejar (documento de 360px, escala mínima 1)', async (browser) => {
  const page = await abrir(browser);
  igual([await anchoDoc(page), await escalaMinima(page)], [360, 1], 'ancho y escala mínima de la app');
});

caso('al abrir en celular: meta nuevo, documento ≥ 900px y el navegador deja alejar', async (browser) => {
  const page = await abrir(browser);
  await abrirVista(page);
  igual(await metaActual(page), 'width=device-width, initial-scale=1, minimum-scale=0.25, maximum-scale=5, user-scalable=yes', 'meta con la vista abierta');
  afirmar(await anchoDoc(page) >= 900, `el documento debe medir al menos 900px: ${await anchoDoc(page)}`);
  const minima = await escalaMinima(page);
  afirmar(minima < 1 && minima <= 0.4, `la escala mínima debería bajar de 0.4: ${minima}`);
  igual(page.errores, [], 'errores de JS');
});

caso('al abrir: el contenido conserva el ancho de la pantalla, la app de fondo queda oculta y se ve desde arriba', async (browser) => {
  const page = await abrir(browser);
  await page.evaluate(() => window.scrollTo(0, 600));
  await abrirVista(page);
  const m = await page.evaluate(() => {
    const c = document.querySelector('.captura-contenido').getBoundingClientRect();
    return { izq: Math.round(c.left), ancho: Math.round(c.width), shell: getComputedStyle(document.getElementById('app-shell')).display, scrollY: window.scrollY, titulo: document.querySelector('.captura-header h1').getBoundingClientRect().top };
  });
  igual([m.izq, m.ancho], [16, 328], 'contenido pegado a la izquierda y de 360 - 2rem (igual que antes)');
  igual(m.shell, 'none', 'app de fondo oculta');
  igual(m.scrollY, 0, 'arranca arriba');
  afirmar(m.titulo > 0 && m.titulo < 200, `el título debe verse al abrir: ${m.titulo}`);
});

caso('el botón ✕ queda DENTRO de la pantalla visible, arriba a la derecha, y recibe el toque', async (browser) => {
  const page = await abrir(browser);
  await abrirVista(page);
  const b = await page.evaluate(() => {
    const r = document.querySelector('.captura-cerrar').getBoundingClientRect();
    const vv = window.visualViewport;
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { izq: Math.round(r.left), der: Math.round(r.right), arriba: Math.round(r.top), alto: Math.round(r.height), visibleW: Math.round(vv.width), punto: e && e.className };
  });
  afirmar(b.der <= b.visibleW && b.izq >= 0 && b.arriba >= 0, `✕ fuera de la pantalla visible: ${JSON.stringify(b)}`);
  igual([b.der, b.arriba], [348, 12], 'a 0.75rem de la esquina superior derecha de la pantalla (igual que antes)');
  igual(b.punto, 'captura-cerrar', 'el toque cae en el botón');
  // la vista es larga: al desplazarla el ✕ sigue a la vista
  await page.evaluate(() => window.scrollTo(0, 900));
  const despues = await page.evaluate(() => { const r = document.querySelector('.captura-cerrar').getBoundingClientRect(); return { arriba: Math.round(r.top), der: Math.round(r.right) }; });
  igual(despues, { arriba: 12, der: 348 }, '✕ pegado arriba tras desplazar');
  igual(await page.evaluate(() => Math.round(document.querySelector('.captura-header h1').getBoundingClientRect().top)) < 0, true, 'el contenido sí se desplazó');
});

caso('al cerrar: meta EXACTO, clases, scroll, zoom y layout como antes', async (browser) => {
  const page = await abrir(browser);
  await page.evaluate(() => window.scrollTo(0, 600));
  const antes = await page.evaluate(() => ({ htmlClase: document.documentElement.className, htmlEstilo: document.documentElement.getAttribute('style'), bodyEstilo: document.body.getAttribute('style'), meta: document.querySelectorAll('meta[name="viewport"]').length }));
  await abrirVista(page);
  await cerrarVista(page);
  igual(await metaActual(page), CONTENIDO_ORIGINAL, 'meta restaurado EXACTAMENTE');
  igual(await page.evaluate(() => document.querySelectorAll('meta[name="viewport"]').length), antes.meta, 'sigue habiendo un solo meta viewport');
  const despues = await page.evaluate(() => ({ htmlClase: document.documentElement.className, htmlEstilo: document.documentElement.getAttribute('style'), bodyEstilo: document.body.getAttribute('style'), overlay: !!document.getElementById('vista-captura-overlay'), shell: getComputedStyle(document.getElementById('app-shell')).display, scrollY: window.scrollY }));
  igual([despues.htmlClase, despues.htmlEstilo, despues.bodyEstilo], [antes.htmlClase, antes.htmlEstilo, antes.bodyEstilo], 'clases y estilos en línea de html/body');
  igual([despues.overlay, despues.shell], [false, 'flex'], 'overlay fuera y app de vuelta');
  igual(despues.scrollY, 600, 'posición de scroll restaurada');
  igual([await anchoDoc(page), await escalaMinima(page)], [360, 1], 'layout y zoom normales (documento de 360px, sin alejar)');
  igual(page.errores, [], 'errores de JS');
});

caso('si la persona alejó el zoom con la vista abierta, al cerrar la app vuelve a escala 1', async (browser) => {
  const page = await abrir(browser);
  await abrirVista(page);
  await page.cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 0.4 });
  igual(await page.evaluate(() => Number(window.visualViewport.scale.toFixed(2))), 0.4, 'zoom alejado con la vista abierta');
  await cerrarVista(page);
  igual(await page.evaluate(() => Number(window.visualViewport.scale.toFixed(2))), 1, 'escala tras cerrar');
});

caso('abrir y cerrar varias veces, y reabrir antes de restaurar, no pierde el meta original', async (browser) => {
  const page = await abrir(browser);
  for (let i = 0; i < 3; i++) { await abrirVista(page); await cerrarVista(page); }
  igual(await metaActual(page), CONTENIDO_ORIGINAL, 'meta tras 3 ciclos');
  await abrirVista(page);
  await page.evaluate(() => { window.VistaCaptura.cerrar(); window.VistaCaptura.abrir({ titulo: 'Otra', columnas: [], filas: [] }); });
  await page.waitForTimeout(200);
  igual(await metaActual(page), 'width=device-width, initial-scale=1, minimum-scale=0.25, maximum-scale=5, user-scalable=yes', 'reabierta: sigue con el meta de captura');
  await page.evaluate(() => window.VistaCaptura.abrir({ titulo: 'Tercera', columnas: [], filas: [] }));
  await cerrarVista(page);
  igual(await metaActual(page), CONTENIDO_ORIGINAL, 'tras cerrar la última, el original (no el de captura ni el de reinicio)');
  igual(await page.evaluate(() => document.documentElement.className), '', 'sin clases residuales');
});

caso('el botón ✕ y Escape cierran y restauran', async (browser) => {
  const page = await abrir(browser);
  await abrirVista(page);
  await page.tap('.captura-cerrar');
  await page.waitForTimeout(200);
  igual([await metaActual(page), await page.$$('#vista-captura-overlay').then((n) => n.length)], [CONTENIDO_ORIGINAL, 0], 'cerrar con ✕');
  await abrirVista(page);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  igual([await metaActual(page), await page.$$('#vista-captura-overlay').then((n) => n.length)], [CONTENIDO_ORIGINAL, 0], 'cerrar con Escape');
});

caso('página sin meta viewport: la vista no inventa uno ni deja residuos', async (browser) => {
  const page = await abrir(browser, { meta: '' });
  igual(await metaActual(page), null, 'sin meta al inicio');
  await abrirVista(page);
  igual([await metaActual(page), await page.evaluate(() => document.documentElement.className)], [null, ''], 'sin meta ni clase al abrir');
  await cerrarVista(page);
  igual(await page.evaluate(() => document.querySelectorAll('meta[name="viewport"]').length), 0, 'sigue sin meta');
  igual(page.errores, [], 'errores de JS');
});

caso('escritorio (1280px): no se toca el meta ni se agrega clase; contenido centrado como siempre', async (browser) => {
  const page = await abrir(browser, { ancho: 1280, alto: 800, movil: false });
  await abrirVista(page);
  igual([await metaActual(page), await page.evaluate(() => document.documentElement.className)], [CONTENIDO_ORIGINAL, ''], 'meta y clase en escritorio');
  const c = await page.evaluate(() => { const r = document.querySelector('.captura-contenido').getBoundingClientRect(); return { izq: Math.round(r.left), ancho: Math.round(r.width) }; });
  igual(c, { izq: 190, ancho: 900 }, 'contenido de 900px centrado');
  igual(await page.evaluate(() => getComputedStyle(document.querySelector('.captura-overlay')).position), 'fixed', 'overlay fijo en escritorio');
  await cerrarVista(page);
  igual(await metaActual(page), CONTENIDO_ORIGINAL, 'meta intacto');
});

caso('celular horizontal (800px): sigue usando dos columnas y se puede alejar un poco', async (browser) => {
  const page = await abrir(browser, { ancho: 800, alto: 360 });
  await abrirVista(page);
  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.captura-layout')).flexDirection);
  igual(cols, 'row', 'dos columnas en horizontal');
  afirmar(await escalaMinima(page) < 1, 'en horizontal también debe poder alejarse');
  await cerrarVista(page);
  igual(await metaActual(page), CONTENIDO_ORIGINAL, 'meta restaurado');
});

caso('todos los módulos usan el componente compartido y ninguno toca el viewport por su cuenta', async () => {
  const dir = path.join(RAIZ, 'js');
  const usan = [];
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    if (f !== 'vista-captura.js') afirmar(!/name="viewport"|meta\[name=.viewport/.test(t), `${f} manipula el meta viewport`);
    if (/VistaCaptura\.abrir/.test(t)) usan.push(f);
  });
  ['cobros.js', 'cxc.js', 'cxp.js', 'destaraje.js', 'gastos.js', 'pagos.js', 'precios.js', 'recibos-pago.js', 'rendimientos.js', 'ventas.js'].forEach((f) => afirmar(usan.includes(f), `${f} ya no usa VistaCaptura`));
  const css = fs.readFileSync(path.join(RAIZ, 'css/styles.css'), 'utf8');
  afirmar(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css.slice(css.indexOf('html.captura-abierta #app-shell'), css.indexOf('/* ===== Ventas ====='))), 'el bloque nuevo usa colores literales');
  afirmar(fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8').includes('<meta name="viewport" content="width=device-width, initial-scale=1.0">'), 'el meta global de index.html cambió');
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
