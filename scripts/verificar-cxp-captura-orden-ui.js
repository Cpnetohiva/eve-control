// Selector 'Ordenar por' de la Vista para captura de CxP, con los JS reales, el CSS real y Chromium (Playwright). html2canvas y
// jsPDF se simulan (anotan lo que reciben).
//
// Cubre: el selector aparece arriba con Fecha, Ticket y Material (Fecha por defecto); cambiarlo reordena las filas en pantalla
// dentro de cada proveedor sin cambiar el orden de los proveedores ni los subtotales; la elección se guarda en
// localStorage (cxp_captura_orden) y se recupera al reabrir; 'Mostrar solo seleccionados' se conserva al cambiar el orden; y
// Descargar PDF / Compartir fotografían los bloques en el mismo orden que se ve, sin incluir el selector.
//
// Uso: node scripts/verificar-cxp-captura-orden-ui.js   (código de salida 1 si algún caso falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/vista-captura.js', 'js/cxp-captura-pdf.js', 'js/cxp.js'];

const SIMULACROS = () => {
  window.__capturas = [];
  window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = 0;
  window.html2canvas = async (elemento) => {
    const rect = elemento.getBoundingClientRect();
    window.__capturas.push({
      clase: elemento.className,
      tickets: Array.from(elemento.querySelectorAll('tbody tr')).map((tr) => tr.children[0].textContent),
      ignorado: !!elemento.closest('[data-html2canvas-ignore]')
    });
    return { width: Math.round(rect.width * 2), height: Math.round(rect.height * 2), toDataURL: () => 'data:image/png;base64,AAAA' };
  };
  window.jspdf = {
    jsPDF: class {
      constructor() { this.paginas = [1]; window.__doc = this; }
      addPage() { this.paginas.push(1); return this; }
      setFillColor() { return this; }
      rect() { return this; }
      addImage() { return this; }
      save(nombre) { window.__guardado = nombre; }
      output() { return new Blob(['%PDF'], { type: 'application/pdf' }); }
    }
  };
};

const cuenta = (ticket, proveedor, material, saldo, fechaTicket) => ({
  id: `cxp-${ticket}`, ticket, proveedor, material, kg: 100, precioEfectivo: saldo / 100, total: saldo, pagado: 0, saldo, fechaTicket,
  estado: 'pendiente', abonos: []
});

const CUENTAS = [
  cuenta('100', 'ALFA', 'PET', 300, '2026-11-03'),
  cuenta('9', 'ALFA', 'cartón', 200, '2026-11-05'),
  cuenta('80', 'ALFA', 'PET', 150, '2026-11-01'),
  cuenta('55', 'ALFA', 'CARTON', 120, '2026-11-02'),
  cuenta('7', 'ALFA', 'ALUMINIO', 90, '2026-11-04'),
  cuenta('3', 'BETA', 'VIDRIO', 100, '2026-11-02'),
  cuenta('21', 'BETA', 'PET', 50, '2026-11-01'),
  cuenta('500', 'GAMA', 'PET', 10, '2026-11-01'),
  cuenta('400', 'GAMA', 'ALUMINIO', 5, '2026-11-02')
];

const HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="toast-container"></div></body></html>';

// conAlmacenamiento: la página se sirve desde un origen real (https://eve.test) para que localStorage funcione; sin él, setContent
// da un origen opaco y el navegador bloquea localStorage (caso 'sin almacenamiento').
async function crearPagina(browser, { conAlmacenamiento = true } = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, timezoneId: 'UTC' });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  if (conAlmacenamiento) {
    await page.route('https://eve.test/**', (ruta) => ruta.fulfill({ contentType: 'text/html', body: HTML }));
    await page.goto('https://eve.test/');
  } else {
    await page.setContent(HTML);
  }
  await page.addStyleTag({ path: path.join(RAIZ, 'css/styles.css') });
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } };
    window.EVE = { registrosDestaraje: [], auditorias: [] };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(SIMULACROS);
  await page.evaluate((cuentas) => { window.EVE.cuentasPorPagar = cuentas; }, CUENTAS);
  page.erroresPagina = errores;
  return page;
}

const abrir = (page) => page.evaluate(() => window.EVE_CXP.abrirVistaCapturaCxP());
// { proveedor: [tickets en pantalla] } y los encabezados con subtotal, en el orden en que se ven.
const leerVista = (page) => page.evaluate(() => {
  const bloques = Array.from(document.querySelectorAll('#vista-captura-overlay .captura-dia'));
  return {
    proveedores: bloques.map((b) => b.querySelector('h3').textContent),
    tickets: Object.fromEntries(bloques.map((b) => [b.dataset.capturaGrupoClave, Array.from(b.querySelectorAll('tbody tr')).map((tr) => tr.children[0].textContent)]))
  };
});

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

caso('el selector aparece arriba, fuera de la captura, con Fecha por defecto', async (browser) => {
  const page = await crearPagina(browser);
  await abrir(page);
  const info = await page.evaluate(() => {
    const sel = document.getElementById('cxp-captura-orden');
    const contenido = document.querySelector('#vista-captura-overlay .captura-contenido');
    const hijos = Array.from(contenido.children).map((h) => h.className.split(' ')[0]);
    return {
      opciones: Array.from(sel.options).map((o) => [o.value, o.textContent]),
      valor: sel.value,
      etiqueta: document.querySelector('label[for="cxp-captura-orden"]').textContent.trim(),
      ignorado: sel.closest('[data-html2canvas-ignore]') !== null,
      noImprimir: sel.closest('.captura-no-imprimir') !== null,
      posicionSelector: hijos.indexOf('captura-acciones'),
      posicionLayout: hijos.indexOf('captura-layout')
    };
  });
  igual(info.opciones, [['fecha', 'Fecha'], ['ticket', 'Ticket'], ['material', 'Material']], 'opciones');
  igual(info.valor, 'fecha', 'valor por defecto');
  igual(info.etiqueta, 'Ordenar por', 'etiqueta');
  afirmar(info.ignorado && info.noImprimir, 'fuera de la captura y de la impresión');
  afirmar(info.posicionSelector >= 0 && info.posicionSelector < info.posicionLayout, 'está arriba de la tabla');
  igual(page.erroresPagina, [], 'sin errores de página');
  await page.close();
});

caso('cambiar a Ticket y a Material reordena dentro de cada proveedor, sin tocar proveedores ni subtotales', async (browser) => {
  const page = await crearPagina(browser);
  await abrir(page);
  const porFecha = await leerVista(page);
  igual(porFecha.tickets.ALFA, ['80', '55', '100', '7', '9'], 'ALFA por fecha');
  await page.selectOption('#cxp-captura-orden', 'ticket');
  const porTicket = await leerVista(page);
  igual(porTicket.tickets.ALFA, ['7', '9', '55', '80', '100'], 'ALFA por ticket (numérico)');
  igual(porTicket.tickets.BETA, ['3', '21'], 'BETA por ticket');
  igual(porTicket.proveedores, porFecha.proveedores, 'proveedores y subtotales iguales (ticket)');
  igual(await page.inputValue('#cxp-captura-orden'), 'ticket', 'el selector conserva la elección');
  await page.selectOption('#cxp-captura-orden', 'material');
  const porMaterial = await leerVista(page);
  igual(porMaterial.tickets.ALFA, ['7', '55', '9', '80', '100'], 'ALFA por material');
  igual(porMaterial.proveedores, porFecha.proveedores, 'proveedores y subtotales iguales (material)');
  await page.selectOption('#cxp-captura-orden', 'fecha');
  igual((await leerVista(page)).tickets, porFecha.tickets, 'volver a Fecha restaura el orden original');
  igual(page.erroresPagina, [], 'sin errores de página');
  await page.close();
});

caso('la elección se guarda en cxp_captura_orden y se recupera al abrir de nuevo', async (browser) => {
  const page = await crearPagina(browser);
  await abrir(page);
  await page.selectOption('#cxp-captura-orden', 'material');
  igual(await page.evaluate(() => window.localStorage.getItem('cxp_captura_orden')), 'material', 'localStorage');
  await page.evaluate(() => window.VistaCaptura.cerrar());
  await abrir(page);
  igual(await page.inputValue('#cxp-captura-orden'), 'material', 'selector al reabrir');
  igual((await leerVista(page)).tickets.ALFA, ['7', '55', '9', '80', '100'], 'filas al reabrir');
  await page.evaluate(() => window.localStorage.removeItem('cxp_captura_orden'));
  await page.close();
});

caso("'Mostrar solo seleccionados' y la selección se conservan al cambiar el orden", async (browser) => {
  const page = await crearPagina(browser);
  await abrir(page);
  await page.check('#vista-captura-overlay [data-captura-fila-clave="BETA"] input');
  await page.check('#vista-captura-overlay .captura-solo-seleccionados input');
  await page.selectOption('#cxp-captura-orden', 'ticket');
  const estado = await page.evaluate(() => ({
    solo: document.querySelector('#vista-captura-overlay .captura-solo-seleccionados input').checked,
    marcadoBeta: document.querySelector('#vista-captura-overlay [data-captura-fila-clave="BETA"] input').checked,
    marcadoAlfa: document.querySelector('#vista-captura-overlay [data-captura-fila-clave="ALFA"] input').checked,
    visibles: Array.from(document.querySelectorAll('#vista-captura-overlay .captura-dia')).filter((b) => b.getClientRects().length > 0).map((b) => b.dataset.capturaGrupoClave)
  }));
  igual(estado, { solo: true, marcadoBeta: true, marcadoAlfa: false, visibles: ['BETA'] }, 'estado tras reordenar');
  await page.evaluate(() => window.localStorage.removeItem('cxp_captura_orden'));
  await page.close();
});

caso('sin almacenamiento (localStorage bloqueado) el selector sigue funcionando durante la sesión', async (browser) => {
  const page = await crearPagina(browser, { conAlmacenamiento: false });
  afirmar(await page.evaluate(() => { try { window.localStorage.getItem('x'); return false; } catch (e) { return true; } }), 'el entorno debe bloquear localStorage');
  await abrir(page);
  await page.selectOption('#cxp-captura-orden', 'ticket');
  igual(await page.inputValue('#cxp-captura-orden'), 'ticket', 'el selector conserva la elección');
  igual((await leerVista(page)).tickets.ALFA, ['7', '9', '55', '80', '100'], 'ALFA por ticket');
  igual(page.erroresPagina, [], 'sin errores de página');
  await page.close();
});

caso('Descargar PDF y Compartir fotografían los proveedores en el mismo orden que se ve y sin el selector', async (browser) => {
  for (const accion of ['descargarPdf', 'compartirPdf']) {
    const page = await crearPagina(browser);
    await abrir(page);
    await page.selectOption('#cxp-captura-orden', 'material');
    const enPantalla = await leerVista(page);
    await page.evaluate((nombre) => {
      window.__capturas = [];
      // Sin soporte para compartir archivos, compartirPdf descarga igual; aquí solo importa qué se fotografía.
      return window.EVE_CXP_CAPTURA_PDF[nombre](document.getElementById('vista-captura-overlay'));
    }, accion);
    const bloques = await page.evaluate(() => window.__capturas.filter((c) => c.clase.includes('captura-dia')).map((c) => c.tickets));
    igual(bloques, enPantalla.proveedores.map((_, i) => Object.values(enPantalla.tickets)[i]), `${accion}: filas por proveedor`);
    afirmar(await page.evaluate(() => window.__capturas.every((c) => !c.ignorado)), `${accion}: no fotografía elementos ignorados`);
    afirmar(await page.evaluate(() => !window.__capturas.some((c) => c.clase.includes('captura-acciones'))), `${accion}: el selector no sale en el PDF`);
    igual(page.erroresPagina, [], `${accion}: sin errores de página`);
    await page.evaluate(() => window.localStorage.removeItem('cxp_captura_orden'));
    await page.close();
  }
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`OK    ${nombre}`); } catch (e) { fallos += 1; console.log(`FALLA ${nombre}\n      ${e.message}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
