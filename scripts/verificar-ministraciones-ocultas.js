// Interruptor global MINISTRACIONES_ACTIVAS (js/config.js) en Pagos (js/pagos.js).
//
// Monta el módulo Pagos REAL en Chromium (Playwright, Firestore simulado) con pagos y ministraciones de la semana y comprueba que:
//  - con el interruptor en false (valor por defecto) no hay botón, modal, detalle ni cifras de ministración, y la tarjeta
//    "Pagado esta semana" muestra solo el total pagado;
//  - el total pagado de la semana es el mismo con el interruptor en false y en true (y no cambia por haber ministraciones);
//  - las exportaciones TXT y CSV de Esta Semana no traen ministraciones (el PDF comparte generador y se revisa en el código);
//  - con el interruptor en true vuelven botón, modal, detalle y las cuatro cifras;
//  - el resto de pantallas (Dashboard, Reportes, Flujo, importadores) no leen ministraciones, y el interruptor no borra código ni datos.
//
// Uso: node scripts/verificar-ministraciones-ocultas.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const FECHA = '2026-10-21'; // miércoles
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/reportes.js', 'js/voz.js', 'js/cxp.js', 'js/pagos.js'];
const PERMISOS = { pagos: 'escritura', cxp: 'escritura', permisosExtra: {} };

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };

const pago = (id, ticket, pagado, extra = {}) => ({ id, ticket, proveedor: 'PROV', material: 'HDPE', kg: 10, precioPorKg: 5, total: pagado, pagado, fecha: FECHA, revertido: false, ...extra });

async function montar(browser, activas) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errores = [];
  page.on('pageerror', (e) => errores.push(e.message));
  await page.setContent('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="toast-container"></div><div id="main-content"></div></body></html>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate(([fecha, permisos, activasPrueba, pagos]) => {
    window.MINISTRACIONES_ACTIVAS = activasPrueba;
    window.EVE = {
      currentUser: { username: 'prueba', permisosResueltos: permisos },
      registrosDestaraje: [], registrosPagos: pagos, registrosMinistraciones: [{ id: 'm1', monto: 5000, fecha, semana: window.obtenerSemanaISO(fecha) }],
      cuentasPorPagar: [], proveedores: [], precios: [], ventas: [], registrosVentas: [], inventarioInicial: [],
      registrosControlProduccion: [], gastos: [], cuentasPorCobrar: [], cobros: []
    };
    window.obtenerFechaMexico = () => fecha;
    window.obtenerInicioSemana = () => '2026-10-18';
    window.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }), where() { return this; }, orderBy() { return this; }, get: async () => ({ docs: [], forEach() {} }) }) };
    window.EVE_MODULES.pagos.render(document.getElementById('main-content'));
  }, [FECHA, PERMISOS, activas, [pago('p1', 'A1', 1200), pago('p2', 'A2', 300), pago('p3', 'A3', 999, { revertido: true })]]);
  await page.click('.tab:has-text("Esta Semana")');
  page.errores = errores;
  return page;
}

const textoFlujo = (page) => page.evaluate(() => document.getElementById('control-flujo').innerText);

caso('interruptor en false por defecto: sin botón, modal, detalle ni cifras de ministración; sí el total pagado', async (b) => {
  const valor = fs.readFileSync(path.join(RAIZ, 'js/config.js'), 'utf8').match(/window\.MINISTRACIONES_ACTIVAS\s*=\s*(\w+)/);
  afirmar(valor && valor[1] === 'false', 'js/config.js debe declarar MINISTRACIONES_ACTIVAS = false');
  const page = await montar(b, false);
  for (const id of ['#btn-registrar-ministracion', '#ministracion-modal-overlay', '#lista-ministraciones', '#cf-ministrado', '#cf-saldo', '#cf-ejecutado']) {
    afirmar(!(await page.$(id)), `no debería existir ${id}`);
  }
  const texto = await textoFlujo(page);
  afirmar(texto.includes('Pagado esta semana'), 'falta el título "Pagado esta semana": ' + texto);
  afirmar(!/ministr|disponible|ejecutado/i.test(texto), 'aparece texto de ministraciones: ' + texto);
  afirmar(texto.includes('1,500.00'), 'falta el total pagado de la semana (1,500.00): ' + texto);
  afirmar(page.errores.length === 0, 'errores de página: ' + page.errores.join(' | '));
  await page.close();
});

caso('el total pagado de la semana es el mismo con el interruptor en false y en true, y no cambia por las ministraciones', async (b) => {
  const apagado = await montar(b, false);
  const encendido = await montar(b, true);
  const a = await apagado.evaluate(() => document.getElementById('cf-pagado').textContent);
  const e = await encendido.evaluate(() => document.getElementById('cf-pagado').textContent);
  afirmar(a.includes('1,500.00') && e.includes('1,500.00'), `pagado distinto: apagado "${a}", encendido "${e}"`);
  const calculo = await apagado.evaluate(() => [
    window.EVE_PAGOS.calcularControlFlujo(window.EVE.registrosPagos, []).totalPagado,
    window.EVE_PAGOS.calcularControlFlujo(window.EVE.registrosPagos, window.EVE.registrosMinistraciones).totalPagado
  ]);
  afirmar(calculo[0] === 1500 && calculo[1] === 1500, 'calcularControlFlujo cambió el pagado: ' + calculo);
  await apagado.close();
  await encendido.close();
});

caso('las exportaciones TXT y CSV de Esta Semana no incluyen ministraciones; el generador de PDF tampoco las lee', async (b) => {
  const page = await montar(b, false);
  const csv = await page.evaluate(() => {
    window.__capturas = [];
    window.descargarArchivo = (blob, nombre) => window.__capturas.push({ nombre, blob });
    window.exportarCSV = (filas, nombre) => window.__capturas.push({ nombre, filas });
    window.exportarReportePagosTXT('semana', {});
    window.exportarReportePagosCSV('semana', {});
    return JSON.stringify(window.__capturas[1].filas);
  });
  const txt = await page.evaluate(async () => await window.__capturas[0].blob.text());
  afirmar(txt.includes('TOTAL PAGADO') && !/ministr|disponible|ejecutado/i.test(txt), 'el TXT trae ministraciones o no trae el total pagado');
  afirmar(!/ministr/i.test(csv), 'el CSV trae ministraciones');
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/reportes.js'), 'utf8');
  afirmar(!/ministr/i.test(fuente), 'js/reportes.js no debe leer ministraciones (TXT, PDF y CSV comparten generadores)');
  await page.close();
});

caso('con el interruptor en true todo vuelve: botón, modal, detalle y las cuatro cifras', async (b) => {
  const page = await montar(b, true);
  for (const id of ['#btn-registrar-ministracion', '#ministracion-modal-overlay', '#lista-ministraciones', '#cf-ministrado', '#cf-pagado', '#cf-saldo', '#cf-ejecutado']) {
    afirmar(await page.$(id), `debería existir ${id}`);
  }
  const texto = await textoFlujo(page);
  afirmar(texto.includes('Control de Flujo Semanal') && texto.includes('Total Ministrado: $5,000.00'), 'faltan cifras de ministración: ' + texto);
  afirmar(texto.includes('Saldo Disponible: $3,500.00') && texto.includes('% Ejecutado: 30%'), 'saldo o % ejecutado incorrectos: ' + texto);
  await page.click('#btn-registrar-ministracion');
  afirmar(await page.$('#ministracion-modal-overlay.open'), 'el modal no abre');
  await page.close();
});

caso('otras pantallas no leen ministraciones y el interruptor no borra código ni la colección', async () => {
  for (const f of ['dashboard', 'reportes', 'reportes-ui', 'flujo', 'admin-importar']) {
    const ruta = path.join(RAIZ, 'js', f + '.js');
    if (!fs.existsSync(ruta)) continue;
    afirmar(!/ministr/i.test(fs.readFileSync(ruta, 'utf8')), `js/${f}.js lee ministraciones`);
  }
  const pagos = fs.readFileSync(path.join(RAIZ, 'js/pagos.js'), 'utf8');
  afirmar(pagos.includes("guardarDato('ministraciones'") && pagos.includes("eliminarDato('ministraciones'"), 'el código de ministraciones debe seguir en pagos.js');
  afirmar(fs.readFileSync(path.join(RAIZ, 'js/config.js'), 'utf8').includes("MINISTRACIONES: 'ministraciones'"), 'la colección debe seguir declarada');
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn(browser);
      console.log(`  ok   ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`  FALLA ${nombre}\n       ${error.message}`);
    }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos} de ${casos.length} casos pasaron.`);
  process.exit(fallos ? 1 : 0);
})();
