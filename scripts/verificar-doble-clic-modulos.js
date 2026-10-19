// Prueba en Chromium (Playwright) de la protección contra doble registro en los handlers REALES de alta de Báscula, Pagos,
// Ventas, CxC (cobros) y Gastos: se cargan los JS reales de cada módulo con un Firestore simulado que anota cada escritura, se
// llena el formulario y se disparan envíos seguidos (en el mismo turno, como un doble o triple clic). Comprueba por módulo que:
//   1) dos envíos seguidos escriben un solo registro,
//   2) tres envíos seguidos escriben un solo registro,
//   3) un envío con un campo obligatorio vacío no escribe nada ni activa el enfriamiento (el siguiente envío válido sí se guarda),
//   4) dentro del enfriamiento se rechaza otro registro y pasado el tiempo se acepta uno nuevo.
// No usa la red ni Firebase real y no modifica código de los módulos. Si un módulo no se puede montar, lo reporta con el motivo.
//
// Uso: node scripts/verificar-doble-clic-modulos.js   (código de salida 1 si algo falla o algún módulo no se pudo cargar)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const FECHA = '2026-10-16';
const ENFRIAMIENTO_PRUEBA_MS = 400;

// Dependencias comunes de los módulos (utilidades, permisos, ordenamiento de tablas, reportes, voz y CxP, que aporta EVE_CXP a Pagos y CxC).
const BASE = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/reportes.js', 'js/voz.js', 'js/cxp.js'];

// permisosExtra.ventas_precios: sin él Ventas oculta el campo de precio de las líneas.
const PERMISOS = { destaraje: 'escritura', pagos: 'escritura', ventas: 'escritura', cxc: 'escritura', gastos: 'escritura', cxp: 'escritura', permisosExtra: { ventas_precios: true } };

const ESTADO_BASE = () => ({
  currentUser: { username: 'prueba', permisosResueltos: PERMISOS },
  registrosDestaraje: [], registrosPagos: [], registrosMinistraciones: [], cuentasPorPagar: [], proveedores: [], precios: [],
  ventas: [], registrosVentas: [], inventarioInicial: [], registrosControlProduccion: [], gastos: [],
  cuentasPorCobrar: [], cobros: []
});

// Firestore simulado: anota cada escritura en window.__escrituras ({ coleccion, id, datos }) y atiende lo mínimo que usan los handlers.
const PREPARAR_DB = () => {
  let auto = 0;
  window.__escrituras = [];
  const consulta = () => ({ where: () => consulta(), orderBy: () => consulta(), limit: () => consulta(), get: async () => ({ docs: [], forEach() {}, size: 0, empty: true }) });
  const ref = (coleccion, id) => ({
    id,
    get: async () => ({ exists: false, id, data: () => undefined }),
    set: async (datos) => { window.__escrituras.push({ coleccion, id, datos, via: 'set' }); },
    update: async (datos) => { window.__escrituras.push({ coleccion, id, datos, via: 'update' }); },
    delete: async () => {}
  });
  window.db = {
    collection: (coleccion) => ({
      doc: (id) => ref(coleccion, id === undefined ? `auto${++auto}` : id),
      add: async (datos) => { const id = `auto${++auto}`; window.__escrituras.push({ coleccion, id, datos, via: 'add' }); return { id }; },
      ...consulta()
    }),
    async runTransaction(fn) {
      const tx = { get: async () => ({ exists: false, data: () => undefined }), set() {}, update() {}, delete() {} };
      return fn(tx);
    }
  };
};

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const pausa = (page, ms) => page.waitForTimeout(ms);

// Módulos: cómo se monta, cómo se llena un registro válido (variante `n` para no chocar con duplicados), cuál es el
// formulario, qué campo vaciar para que falle la validación del handler y en qué colección se cuenta el alta.
const MODULOS = [
  {
    nombre: 'Báscula (destaraje.js → manejarEnvioFormulario)', modulo: 'destaraje', scripts: ['js/destaraje.js'], coleccion: 'destaraje',
    formulario: '#destaraje-form', campoObligatorio: '#df-ticket',
    async montar(page) { await page.evaluate(() => window.EVE_MODULES.destaraje.render(document.getElementById('main-content'))); },
    async llenar(page, n) {
      await page.fill('#df-ticket', `T${1000 + n}`);
      await page.fill('#df-proveedor', 'PROVEEDOR DE PRUEBA');
      await page.$eval('#df-material', (s) => { s.value = Array.from(s.options).find((o) => o.value).value; });
      await page.fill('#df-kg', '120.5');
      await page.fill('#df-salida', FECHA);
    }
  },
  {
    nombre: 'Pagos (pagos.js → manejarEnvioFormulario)', modulo: 'pagos', scripts: ['js/pagos.js'], coleccion: 'pagos',
    formulario: '#pagos-form', campoObligatorio: '#pg-kg',
    async montar(page) { await page.evaluate(() => window.EVE_MODULES.pagos.render(document.getElementById('main-content'))); },
    async llenar(page, n) {
      await page.fill('#pg-ticket', `P${2000 + n}`);
      await page.fill('#pg-proveedor', 'PROVEEDOR DE PRUEBA');
      await page.$eval('#pg-material', (s) => { if (s.tagName === 'SELECT') s.value = Array.from(s.options).find((o) => o.value).value; else s.value = 'MIXTO'; });
      await page.fill('#pg-kg', '100');
      await page.fill('#pg-precio', '5');
      await page.fill('#pg-pagado', '500');
      await page.fill('#pg-fecha', FECHA);
      await page.fill('#pg-nota', 'Pago de prueba sin cuenta por pagar');
    }
  },
  {
    nombre: 'Ventas (ventas.js → manejarEnvioFormulario)', modulo: 'ventas', scripts: ['js/inventario.js', 'js/ventas.js'], coleccion: 'ventas',
    formulario: '#ventas-form', campoObligatorio: '#vt-cliente',
    async montar(page) { await page.evaluate(() => { window.EVE_MODULES.ventas.render(document.getElementById('main-content')); }); },
    async llenar(page, n) {
      await page.fill('#vt-cliente', 'CLIENTE DE PRUEBA');
      await page.fill('#vt-fecha', FECHA);
      await page.$eval('#ventas-form .vl-material', (e) => { e.value = (window.productosVenta()[0] || {}).nombre || window.productosVenta()[0] || 'MIXTO'; });
      await page.fill('#ventas-form .vl-cantidad', String(10 + n));
      await page.fill('#ventas-form .vl-precio', '8');
    }
  },
  {
    nombre: 'CxC cobros (cxc.js → manejarEnvioPago)', modulo: 'cxc', scripts: ['js/cxc.js'], coleccion: 'cobros',
    formulario: '#cxc-modal-form', campoObligatorio: '#cxc-modal-monto',
    async montar(page) {
      await page.evaluate((fecha) => {
        window.EVE.cuentasPorCobrar = [{
          id: 'cxc1', cliente: 'CLIENTE DE PRUEBA', ventaId: 'v1', folio: 'V-001', material: 'MIXTO', cantidad: 100, precioUnitario: 10,
          total: 1000, pagado: 0, saldo: 1000, estado: 'pendiente', abonos: [], fechaVenta: fecha
        }];
        window.EVE_MODULES.cxc.render(document.getElementById('main-content'));
      }, FECHA);
      await this.abrir(page);
    },
    async abrir(page) {
      await page.click('text=Registrar Pago');
      await page.waitForSelector('#cxc-modal-overlay.open');
    },
    async llenar(page, n) {
      // El modal se cierra al guardar: se vuelve a abrir antes de cada registro nuevo.
      if (!(await page.$('#cxc-modal-overlay.open'))) await this.abrir(page);
      await page.fill('#cxc-modal-monto', String(100 + n));
      await page.fill('#cxc-modal-fecha', FECHA);
    }
  },
  {
    nombre: 'Gastos (gastos.js → manejarEnvioFormulario)', modulo: 'gastos', scripts: ['js/gastos.js'], coleccion: 'gastos',
    formulario: '#gastos-form', campoObligatorio: '#ga-monto-base',
    async montar(page) { await page.evaluate(() => window.EVE_MODULES.gastos.render(document.getElementById('main-content'))); },
    async llenar(page, n) {
      await page.fill('#ga-fecha', FECHA);
      await page.fill('#ga-beneficiario', 'BENEFICIARIO DE PRUEBA');
      await page.fill('#ga-concepto', `Gasto de prueba ${n}`);
      await page.fill('#ga-monto-base', String(250 + n));
      await page.selectOption('#ga-tipo', 'operacion');
    }
  }
];

// Monta la página con los scripts reales del módulo. Devuelve { page, errores } o lanza con el motivo si el módulo no se puede cargar.
async function paginaDe(browser, m) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="toast-container"></div><div id="main-content"></div></body></html>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of [...BASE, ...m.scripts]) {
    const antes = errores.length;
    await page.addScriptTag({ path: path.join(RAIZ, s) }).catch((e) => errores.push(`${s}: ${e.message}`));
    if (errores.length > antes) throw new Error(`no se pudo cargar ${s}: ${errores.slice(antes).join(' | ')}`);
  }
  // config.js crea el db real al cargarse: el simulado se instala DESPUÉS de cargar los scripts.
  await page.evaluate(PREPARAR_DB);
  await page.evaluate(([estado, fecha, enfriamiento]) => {
    window.EVE = estado;
    window.obtenerFechaMexico = () => fecha;
    window.confirm = () => true;
    window.prompt = () => null;
    window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = enfriamiento;
  }, [ESTADO_BASE(), FECHA, ENFRIAMIENTO_PRUEBA_MS]);
  if (!(await page.evaluate((mod) => !!(window.EVE_MODULES && window.EVE_MODULES[mod]), m.modulo))) {
    throw new Error(`js/${m.modulo}.js no registró window.EVE_MODULES.${m.modulo}`);
  }
  try { await m.montar(page); } catch (e) { throw new Error(`no se pudo montar el módulo: ${e.message.split('\n')[0]}`); }
  if (!(await page.$(m.formulario))) throw new Error(`no apareció el formulario ${m.formulario} (errores de página: ${errores.join(' | ') || 'ninguno'})`);
  page.errores = errores;
  return page;
}

// Dispara `veces` envíos del formulario en el mismo turno (como clics seguidos). Se usa dispatchEvent y no un clic para que la
// validación nativa de HTML5 no filtre el envío: lo que se prueba es el handler real, con sus propias validaciones.
const enviar = (page, m, veces) => page.evaluate(([selector, n]) => {
  const form = document.querySelector(selector);
  for (let i = 0; i < n; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}, [m.formulario, veces]);
const escrituras = (page, m) => page.evaluate((c) => window.__escrituras.filter((e) => e.coleccion === c).length, m.coleccion);
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

for (const m of MODULOS) {
  caso(`${m.nombre}: dos envíos seguidos escriben un solo registro`, async (browser) => {
    const page = await paginaDe(browser, m);
    await m.llenar(page, 1);
    await enviar(page, m, 2);
    await pausa(page, 400);
    igual(await escrituras(page, m), 1, `escrituras en ${m.coleccion}`);
    igual(page.errores, [], 'errores de JS en la página');
    await page.close();
  });

  caso(`${m.nombre}: tres envíos seguidos escriben un solo registro`, async (browser) => {
    const page = await paginaDe(browser, m);
    await m.llenar(page, 1);
    await enviar(page, m, 3);
    await pausa(page, 400);
    igual(await escrituras(page, m), 1, `escrituras en ${m.coleccion}`);
    igual(page.errores, [], 'errores de JS en la página');
    await page.close();
  });

  caso(`${m.nombre}: un envío con un campo obligatorio vacío no escribe ni activa el enfriamiento; el siguiente válido se guarda`, async (browser) => {
    const page = await paginaDe(browser, m);
    await m.llenar(page, 1);
    const valorOriginal = await page.inputValue(m.campoObligatorio);
    await page.fill(m.campoObligatorio, '');
    await enviar(page, m, 1);
    await pausa(page, 200);
    igual(await escrituras(page, m), 0, 'el envío inválido no escribe');
    igual((await toasts(page)).includes('Registro ya guardado, espera un momento'), false, 'sin toast de enfriamiento');
    await page.fill(m.campoObligatorio, valorOriginal);
    await enviar(page, m, 1);
    await pausa(page, 300);
    igual(await escrituras(page, m), 1, 'el siguiente envío válido se guarda de inmediato');
    igual(page.errores, [], 'errores de JS en la página');
    await page.close();
  });

  caso(`${m.nombre}: dentro del enfriamiento se rechaza otro registro; pasado el tiempo se acepta`, async (browser) => {
    const page = await paginaDe(browser, m);
    await m.llenar(page, 1);
    await enviar(page, m, 1);
    await pausa(page, 150);
    igual(await escrituras(page, m), 1, 'primer registro');
    await m.llenar(page, 2);
    await enviar(page, m, 1);
    await pausa(page, 100);
    igual(await escrituras(page, m), 1, 'dentro del enfriamiento no se escribe otro');
    afirmar((await toasts(page)).includes('Registro ya guardado, espera un momento'), 'toast del enfriamiento');
    await pausa(page, ENFRIAMIENTO_PRUEBA_MS + 200);
    await m.llenar(page, 3);
    await enviar(page, m, 1);
    await pausa(page, 300);
    afirmar((await escrituras(page, m)) >= 2, `pasado el enfriamiento se acepta un segundo registro (escrituras: ${await escrituras(page, m)})`);
    igual(page.errores, [], 'errores de JS en la página');
    await page.close();
  });
}

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
