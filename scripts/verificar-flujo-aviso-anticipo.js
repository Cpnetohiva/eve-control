// Aviso de doble conteo de anticipos en el formulario de movimiento manual de Flujo de efectivo (js/flujo.js).
// Los anticipos ya entran solos al flujo: el de proveedor (pagos origen 'anticipo') como salida y el de cliente (cobros origen
// 'anticipo': sobrante de un cobro o «Registrar anticipo de cliente» en CxC) como «Anticipo cliente». Capturarlos también a mano los
// contaría dos veces. El aviso es solo informativo: no bloquea el guardado y no cambia ninguna cifra ni fórmula.
//
// Uso: node scripts/verificar-flujo-aviso-anticipo.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const SCRIPTS = ['js/config.js', 'js/utils.js', 'js/permisos.js', 'js/ordenar-tabla.js', 'js/vista-captura.js', 'js/reportes.js', 'js/flujo.js'];
const HOY = '2026-10-14';

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

async function nuevaPagina(browser) {
  const page = await browser.newPage();
  await page.setContent('<div id="toast-container"></div><div id="main-content"></div>');
  await page.evaluate(() => {
    window.firebase = { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; }, auth() { return { onAuthStateChanged() {} }; } };
    window.EVE_MODULES = {};
  });
  for (const s of SCRIPTS) await page.addScriptTag({ path: path.join(RAIZ, s) });
  await page.evaluate((hoy) => {
    window.EVE = {
      currentUser: { username: 'admin1', permisosResueltos: { flujo: 'escritura', cxc: 'escritura', pagos: 'escritura', gastos: 'escritura' } },
      cobros: [], registrosPagos: [], gastos: [], flujoMovimientos: []
    };
    window.obtenerFechaMexico = () => hoy;
    window.obtenerInicioSemana = () => '2026-10-12';
    window.obtenerInicioMes = () => '2026-10-01';
    window.__guardados = []; window.__mensajes = [];
    window.guardarDato = async (coleccion, doc) => { window.__guardados.push([coleccion, JSON.parse(JSON.stringify(doc))]); return 'nuevo1'; };
    window.EVE_HISTORIAL = { registrar: () => {} };
    window.showSuccess = (m) => window.__mensajes.push(['ok', m]);
    window.showError = (m) => window.__mensajes.push(['error', m]);
    window.EVE_MODULES.flujo.render(document.getElementById('main-content'));
  }, HOY);
  return page;
}

const visible = (page, id) => page.isVisible(id);

caso('el aviso de anticipo a proveedor sigue visible y con su texto de siempre', async (browser) => {
  const page = await nuevaPagina(browser);
  const proveedor = await page.evaluate(() => [window.EVE_FLUJO.TEXTO_AVISO_ANTICIPO, document.getElementById('flujo-aviso-anticipo').textContent]);
  igual(proveedor[0], proveedor[1], 'texto en pantalla = constante');
  afirmar(proveedor[0].startsWith('Anticipo a proveedor:') && proveedor[0].includes('capturarlos aquí los contaría dos veces'), 'texto del proveedor intacto');
  igual(await visible(page, '#flujo-aviso-anticipo'), true, 'visible siempre');
  await page.close();
});

caso('al elegir «Anticipo de cliente» aparece el aviso de cliente (oculto antes y para otros tipos)', async (browser) => {
  const page = await nuevaPagina(browser);
  igual(await visible(page, '#flujo-aviso-anticipo-cliente'), false, 'oculto al abrir');
  await page.selectOption('#fl-tipo', 'Anticipo de cliente');
  igual(await visible(page, '#flujo-aviso-anticipo-cliente'), true, 'visible con Anticipo de cliente');
  const texto = await page.textContent('#flujo-aviso-anticipo-cliente');
  igual(texto, await page.evaluate(() => window.EVE_FLUJO.TEXTO_AVISO_ANTICIPO_CLIENTE), 'texto = constante exportada');
  for (const frase of ['sobrantes de cobros', 'Registrar anticipo de cliente', 'Anticipo cliente', 'contaría dos veces', 'fuera del sistema']) {
    afirmar(texto.includes(frase), `el aviso menciona «${frase}»`);
  }
  await page.selectOption('#fl-tipo', 'Otra entrada');
  igual(await visible(page, '#flujo-aviso-anticipo-cliente'), false, 'se oculta con otro tipo de entrada');
  await page.selectOption('#fl-tipo', 'Anticipo a proveedor');
  igual(await visible(page, '#flujo-aviso-anticipo-cliente'), false, 'no sale con Anticipo a proveedor (ese tiene el suyo)');
  igual(await visible(page, '#flujo-aviso-anticipo'), true, 'y el de proveedor sigue visible');
  await page.close();
});

caso('el aviso no bloquea: se puede guardar un Anticipo de cliente manual y el aviso se oculta al limpiar el formulario', async (browser) => {
  const page = await nuevaPagina(browser);
  await page.selectOption('#fl-tipo', 'Anticipo de cliente');
  await page.fill('#fl-concepto', 'Dinero recibido fuera del sistema');
  await page.fill('#fl-importe', '750');
  igual(await page.isEnabled('#flujo-form button[type="submit"]'), true, 'Guardar habilitado con el aviso visible');
  await page.click('#flujo-form button[type="submit"]');
  await page.waitForFunction(() => window.__mensajes.length > 0);
  igual(await page.evaluate(() => window.__mensajes), [['ok', 'Movimiento guardado']], 'se guardó');
  const guardado = await page.evaluate(() => window.__guardados.map(([col, d]) => [col, d.tipo, d.importe]));
  igual(guardado, [['flujo_movimientos', 'Anticipo de cliente', 750]], 'documento manual');
  igual(await visible(page, '#flujo-aviso-anticipo-cliente'), false, 'el aviso se oculta tras guardar (el formulario vuelve a su estado)');
  await page.close();
});

caso('ninguna cifra cambia: un cobro anticipo sigue entrando como «Anticipo cliente» y un anticipo a proveedor como salida', async (browser) => {
  const page = await nuevaPagina(browser);
  const r = await page.evaluate(() => {
    const movs = window.EVE_FLUJO.construirMovimientosFlujo({
      cobros: [{ id: 'k', cliente: 'ACME', folio: 'V-1', pagado: 300, iva: 0, fecha: '2026-10-14', origen: 'anticipo' }],
      pagos: [{ id: 'p', proveedor: 'RECI', ticket: '', pagado: 120, iva: 0, fecha: '2026-10-14', origen: 'anticipo' }]
    });
    return movs.map((m) => [m.concepto, m.entrada, m.salida]);
  });
  igual(r.sort(), [['Anticipo a proveedor', 0, 120], ['Anticipo cliente', 300, 0]].sort(), 'ambos anticipos automáticos');
  await page.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallidos = 0;
  for (const c of casos) {
    try { await c.fn(browser); console.log('ok   ' + c.nombre); } catch (e) { fallidos++; console.error('FALLA ' + c.nombre + ': ' + e.message); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallidos}/${casos.length} casos correctos`);
  process.exit(fallidos ? 1 : 0);
})();
