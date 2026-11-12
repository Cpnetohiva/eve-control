// Botón «↻ Actualizar» reutilizable (js/boton-actualizar.js) y su conexión a Compras > Báscula y Compras > CxP.
//
// Componente: texto, «Actualizado HH:MM» (hora de México), estado de cargando, bloqueo anti doble clic de 5 s, toast al terminar
// (éxito o error), sin conexión no lee nada y se conserva el scroll.
// Báscula y CxP (Chromium con Playwright y los js/ reales; Firestore simulado con contador de lecturas): el botón va a la derecha de la
// barra de subpestañas; actualizar lee SOLO las colecciones del módulo (tickets nuevos de forma incremental por fechaRegistro), no dispara
// la carga completa (cargarDatosEnParalelo) ni recarga la página, y conserva pestaña, filtros, «Incluir material de socios» y scroll.
//
// Uso: node scripts/verificar-boton-actualizar.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const HTML = (scripts) => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="login-screen"></div><form id="login-form"></form><button id="btn-salir"></button><div id="toast-container"></div><div id="main-content"></div>
<script>window.firebase={initializeApp(){},firestore(){return{enablePersistence(){return Promise.resolve()}}},auth(){return{onAuthStateChanged(){}}}};window.EVE_MODULES={};</script>
${scripts.map((s) => `<script src="/js/${s}"></script>`).join('')}
</body></html>`;
const BASE = ['config.js', 'utils.js', 'permisos.js', 'ordenar-tabla.js', 'vista-captura.js', 'reportes.js'];

async function abrir(browser, scripts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 } });
  const page = await ctx.newPage();
  page.errores = [];
  page.navegaciones = 0;
  page.on('pageerror', (e) => page.errores.push(e.message));
  page.on('framenavigated', () => { page.navegaciones++; });
  await page.route('http://eve.test/**', (ruta) => {
    const url = new URL(ruta.request().url()).pathname;
    if (url === '/') return ruta.fulfill({ contentType: 'text/html', body: HTML(scripts) });
    const archivo = path.join(RAIZ, url);
    if (fs.existsSync(archivo)) return ruta.fulfill({ body: fs.readFileSync(archivo), contentType: url.endsWith('.css') ? 'text/css' : 'application/javascript' });
    return ruta.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://eve.test/');
  page.navegaciones = 0;
  return { ctx, page };
}

// ───────────────────────── Componente ─────────────────────────
async function paginaComponente(browser) {
  const { ctx, page } = await abrir(browser, ['config.js', 'utils.js', 'boton-actualizar.js']);
  await page.evaluate(() => {
    window.__toasts = [];
    window.showSuccess = (m) => window.__toasts.push(['ok', m]);
    window.showError = (m) => window.__toasts.push(['error', m]);
    window.EVE = { cargadoEn: Date.UTC(2026, 10, 12, 18, 30) }; // 12:30 en México (UTC-6)
    // Reloj falso: ahora() y esperar(fn, ms) controlados por la prueba.
    window.__t = Date.UTC(2026, 10, 12, 19, 0);
    window.__cola = [];
    window.__reloj = { ahora: () => window.__t, esperar: (fn, ms) => window.__cola.push({ en: window.__t + ms, fn }) };
    window.__avanzar = (ms) => {
      window.__t += ms;
      const listos = window.__cola.filter((x) => x.en <= window.__t);
      window.__cola = window.__cola.filter((x) => x.en > window.__t);
      listos.forEach((x) => x.fn());
    };
  });
  return { ctx, page };
}
const estadoBoton = (page) => page.evaluate(() => {
  const c = document.querySelector('.eve-actualizar');
  const b = c.querySelector('button');
  return { texto: b.textContent.trim(), deshabilitado: b.disabled, ocupado: b.getAttribute('aria-busy'), hora: c.querySelector('.eve-actualizar-hora').textContent.trim() };
});

caso('componente: botón «↻ Actualizar» con «Actualizado HH:MM» (hora de México de la última carga)', async (browser) => {
  const { ctx, page } = await paginaComponente(browser);
  await page.evaluate(() => {
    window.__llamadas = 0;
    document.getElementById('main-content').appendChild(window.EVE_BOTON_ACTUALIZAR.crear({ reloj: window.__reloj, alActualizar: async () => { window.__llamadas++; } }).elemento);
  });
  igual(await estadoBoton(page), { texto: '↻ Actualizar', deshabilitado: false, ocupado: null, hora: 'Actualizado 12:30' }, 'estado inicial');
  igual(page.errores, [], 'errores de página');
  await ctx.close();
});

caso('componente: al pulsar muestra cargando, avisa con toast al terminar y actualiza la hora', async (browser) => {
  const { ctx, page } = await paginaComponente(browser);
  await page.evaluate(() => {
    window.__liberar = null;
    document.getElementById('main-content').appendChild(window.EVE_BOTON_ACTUALIZAR.crear({
      reloj: window.__reloj,
      alActualizar: () => new Promise((resolver) => { window.__liberar = () => resolver('3 tickets nuevos'); }),
      mensajeExito: (r) => `Listo: ${r}`
    }).elemento);
  });
  await page.click('.eve-actualizar button');
  igual(await estadoBoton(page), { texto: '↻ Actualizando…', deshabilitado: true, ocupado: 'true', hora: 'Actualizado 12:30' }, 'mientras carga');
  await page.evaluate(() => { window.__t = Date.UTC(2026, 10, 12, 19, 0, 3); window.__liberar(); });
  await page.waitForFunction(() => window.__toasts.length === 1);
  igual(await page.evaluate(() => window.__toasts), [['ok', 'Listo: 3 tickets nuevos']], 'toast de éxito');
  const e = await estadoBoton(page);
  igual(e.hora, 'Actualizado 13:00', 'hora nueva');
  igual(e.texto, '↻ Actualizar', 'texto vuelve');
  igual(e.deshabilitado, true, 'sigue bloqueado: no han pasado 5 s desde el clic');
  await ctx.close();
});

caso('componente: bloqueo anti doble clic de 5 segundos (un solo recarga aunque se pulse varias veces)', async (browser) => {
  const { ctx, page } = await paginaComponente(browser);
  await page.evaluate(() => {
    window.__llamadas = 0;
    document.getElementById('main-content').appendChild(window.EVE_BOTON_ACTUALIZAR.crear({ reloj: window.__reloj, alActualizar: async () => { window.__llamadas++; } }).elemento);
  });
  const clic = () => page.evaluate(() => document.querySelector('.eve-actualizar button').click());
  await clic(); await clic(); await clic();
  await page.waitForFunction(() => window.__llamadas >= 1);
  igual(await page.evaluate(() => window.__llamadas), 1, 'una sola recarga con tres clics seguidos');
  await page.evaluate(() => window.__avanzar(4900));
  await clic();
  igual(await page.evaluate(() => window.__llamadas), 1, 'a los 4.9 s sigue bloqueado');
  igual((await estadoBoton(page)).deshabilitado, true, 'deshabilitado a los 4.9 s');
  await page.evaluate(() => window.__avanzar(200));
  igual((await estadoBoton(page)).deshabilitado, false, 'a los 5 s se habilita');
  await clic();
  await page.waitForFunction(() => window.__llamadas === 2);
  await ctx.close();
});

caso('componente: si falla, toast de error, la hora no cambia y el botón vuelve a poder usarse tras 5 s', async (browser) => {
  const { ctx, page } = await paginaComponente(browser);
  await page.evaluate(() => {
    document.getElementById('main-content').appendChild(window.EVE_BOTON_ACTUALIZAR.crear({ reloj: window.__reloj, alActualizar: async () => { throw new Error('sin red'); } }).elemento);
  });
  await page.click('.eve-actualizar button');
  await page.waitForFunction(() => window.__toasts.length === 1);
  const toasts = await page.evaluate(() => window.__toasts);
  igual(toasts[0][0], 'error', 'toast de error');
  afirmar(toasts[0][1].includes('sin red'), 'el mensaje incluye el motivo: ' + toasts[0][1]);
  igual((await estadoBoton(page)).hora, 'Actualizado 12:30', 'la hora no cambia si falló');
  await page.evaluate(() => window.__avanzar(5000));
  igual((await estadoBoton(page)).deshabilitado, false, 'se habilita');
  await ctx.close();
});

caso('componente: sin conexión no llama a la recarga y avisa', async (browser) => {
  const { ctx, page } = await paginaComponente(browser);
  await page.evaluate(() => {
    window.__llamadas = 0;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    document.getElementById('main-content').appendChild(window.EVE_BOTON_ACTUALIZAR.crear({ reloj: window.__reloj, alActualizar: async () => { window.__llamadas++; } }).elemento);
  });
  await page.click('.eve-actualizar button');
  const t = await page.evaluate(() => ({ llamadas: window.__llamadas, toasts: window.__toasts }));
  igual(t.llamadas, 0, 'no recarga');
  igual(t.toasts[0][0], 'error', 'avisa');
  afirmar(/conexi/i.test(t.toasts[0][1]), 'menciona la conexión: ' + t.toasts[0][1]);
  await ctx.close();
});

caso('componente: conserva el scroll de la página mientras recarga', async (browser) => {
  const { ctx, page } = await paginaComponente(browser);
  await page.evaluate(() => {
    document.getElementById('main-content').style.height = '3000px';
    document.getElementById('main-content').appendChild(window.EVE_BOTON_ACTUALIZAR.crear({
      reloj: window.__reloj,
      alActualizar: async () => { document.getElementById('main-content').style.height = '1500px'; window.scrollTo(0, 0); }
    }).elemento);
    window.scrollTo(0, 400);
  });
  await page.evaluate(() => document.querySelector('.eve-actualizar button').click());
  await page.waitForFunction(() => window.__toasts.length === 1);
  igual(await page.evaluate(() => Math.round(window.scrollY)), 400, 'scroll restaurado');
  await ctx.close();
});

// ───────────────────────── Báscula y CxP ─────────────────────────
const HOY = '2026-11-12';
const iso = (dia, hora) => `2026-11-${dia}T${hora}:00:00.000Z`;
const ticket = (id, n, prov, fechaEntrada, fechaRegistro, extra) => ({ id, ticket: String(n), proveedor: prov, material: 'PET', kg: 100, fechaEntrada, fechaSalida: fechaEntrada, fechaRegistro, ...(extra || {}) });
const cuenta = (id, n, prov, saldo, fechaTicket, fechaRegistro) => ({ id, ticket: String(n), proveedor: prov, material: 'PET', kg: 100, precioEfectivo: 10, total: 1000, iva: 0, pagado: 1000 - saldo, saldo, estado: saldo > 0 ? 'pendiente' : 'liquidado', fechaTicket, fechaRegistro, abonos: [] });

// Estado de Firestore simulado. Cada lectura se anota en window.__lecturas.
async function paginaModulo(browser, modulo, { permisos } = {}) {
  // auth.js aporta clasificarDestaraje (la misma regla de la carga completa); sus listeners de sesión quedan inertes con el firebase simulado.
  // (auth.js reinicia window.EVE_MODULES, por eso carga antes que los módulos, igual que en index.html.)
  const scripts = ['config.js', 'utils.js', 'auth.js', ...BASE.slice(2), 'cxp.js', ...(modulo === 'destaraje' ? ['destaraje.js'] : []), 'boton-actualizar.js'];
  const { ctx, page } = await abrir(browser, scripts);
  await page.evaluate(({ modulo, hoy, permisos }) => {
    window.obtenerFechaMexico = () => hoy;
    window.puedeEscribir = () => false;
    window.puedeLeer = (m) => (permisos ? permisos.includes(m) : true);
    window.__toasts = [];
    window.showSuccess = (m) => window.__toasts.push(['ok', m]);
    window.showError = (m) => window.__toasts.push(['error', m]);
    window.EVE_HISTORIAL = { registrar: () => {} };
    window.__cargasCompletas = 0;
    window.cargarDatosEnParalelo = async () => { window.__cargasCompletas++; };
    // Firestore simulado: colecciones en memoria; where('campo', '>=', valor) soportado.
    window.__bd = { destaraje: [], cuentas_por_pagar: [], auditorias: [] };
    window.__lecturas = [];
    const consulta = (nombre, filtro) => ({
      where(campo, op, valor) { return consulta(nombre, { campo, op, valor }); },
      async get() {
        let docs = window.__bd[nombre] || [];
        if (filtro) docs = docs.filter((d) => d[filtro.campo] !== undefined && String(d[filtro.campo]) >= String(filtro.valor));
        window.__lecturas.push({ coleccion: nombre, filtro: filtro ? `${filtro.campo}${filtro.op}${filtro.valor}` : null, docs: docs.length });
        return { size: docs.length, metadata: { fromCache: false }, docs: docs.map((d) => ({ id: d.id, data: () => { const { id, ...resto } = d; return JSON.parse(JSON.stringify(resto)); } })) };
      }
    });
    window.db = { collection: (nombre) => consulta(nombre) };
  }, { modulo, hoy: HOY, permisos });
  return { ctx, page };
}

async function montarBascula(page, { registros, bd }) {
  await page.evaluate(({ registros, bd }) => {
    window.EVE = { cargadoEn: Date.UTC(2026, 10, 12, 18, 30), registrosDestaraje: registros.filter((r) => r.ticket !== 'V'), registrosVentas: [], registrosPagos: [], ventas: [], cuentasPorPagar: [], auditorias: [], proveedores: [], currentUser: { username: 'p', permisosResueltos: {} } };
    Object.assign(window.__bd, bd);
    window.EVE_MODULES.destaraje.render(document.getElementById('main-content'));
  }, { registros, bd });
}

async function montarCxP(page, { cuentas, registros, bd }) {
  await page.evaluate(({ cuentas, registros, bd }) => {
    window.EVE = { cargadoEn: Date.UTC(2026, 10, 12, 18, 30), cuentasPorPagar: cuentas, registrosDestaraje: registros, registrosVentas: [], registrosPagos: [], ventas: [], precios: [], composiciones: [], auditorias: [], proveedores: [], recibosPendientes: [], currentUser: { username: 'p', permisosResueltos: {} } };
    Object.assign(window.__bd, bd);
    window.EVE_MODULES.cxp.render(document.getElementById('main-content'));
  }, { cuentas, registros, bd });
}

const colecciones = (page) => page.evaluate(() => Array.from(new Set(window.__lecturas.map((l) => l.coleccion))).sort());
const botonDeBarra = (page) => page.evaluate(() => {
  const barra = document.querySelector('.destaraje-subtabs');
  const contenedor = barra.querySelector('.eve-actualizar');
  if (!contenedor) return null;
  const tabs = Array.from(barra.querySelectorAll('.tab')).map((t) => t.getBoundingClientRect());
  const r = contenedor.getBoundingClientRect();
  return { aLaDerecha: r.left >= Math.max(...tabs.map((t) => t.right)) - 1, ultimoHijo: barra.lastElementChild === contenedor, hora: contenedor.querySelector('.eve-actualizar-hora').textContent.trim() };
});
const pulsar = async (page) => {
  // click() del DOM y no page.click: Playwright desplazaría la página hasta el botón antes de pulsar y se perdería el scroll que se quiere comprobar.
  await page.evaluate(() => document.querySelector('.destaraje-subtabs .eve-actualizar button').click());
  await page.waitForFunction(() => window.__toasts.length >= 1);
};

caso('Báscula: el botón está a la derecha de la barra de subpestañas, sin ser una pestaña', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'destaraje');
  await montarBascula(page, { registros: [ticket('a', 1001, 'ALFA', HOY, iso('12', '08'))], bd: {} });
  const b = await botonDeBarra(page);
  afirmar(b && b.aLaDerecha && b.ultimoHijo, 'botón a la derecha y al final de la barra: ' + JSON.stringify(b));
  igual(b.hora, 'Actualizado 12:30', 'hora de la última carga');
  igual(await page.$$eval('.destaraje-subtabs .tab', (t) => t.map((x) => x.textContent.trim())), ['Hoy', 'Esta Semana', 'Este Mes', 'Últimos 30 días', 'Todos'], 'las pestañas no cambian');
  igual(page.errores, [], 'errores de página');
  await ctx.close();
});

caso('Báscula: trae los tickets nuevos y refresca el contador sin cargar toda la app ni otras colecciones', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'destaraje');
  const viejo = ticket('a', 1001, 'ALFA', HOY, iso('12', '08'));
  const nuevo = ticket('b', 1002, 'BETA', HOY, iso('12', '19'));
  await montarBascula(page, { registros: [viejo], bd: { destaraje: [viejo, nuevo] } });
  const registros = () => page.$eval('#destaraje-stats', (e) => e.children[0].textContent.trim());
  igual(await registros(), 'Registros: 1', 'antes');
  await pulsar(page);
  igual(await registros(), 'Registros: 2', 'el contador cuenta el ticket nuevo');
  igual(await page.evaluate(() => window.EVE.registrosDestaraje.map((r) => r.ticket).sort()), ['1001', '1002'], 'memoria actualizada');
  igual(await page.evaluate(() => window.__cargasCompletas), 0, 'no se dispara la carga completa');
  igual(page.navegaciones, 0, 'la página no se recarga');
  const lecturas = await page.evaluate(() => window.__lecturas);
  const destaraje = lecturas.find((l) => l.coleccion === 'destaraje');
  afirmar(destaraje && destaraje.filtro && destaraje.filtro.startsWith('fechaRegistro>='), 'destaraje se lee de forma incremental por fechaRegistro: ' + JSON.stringify(lecturas));
  igual(await colecciones(page), ['auditorias', 'cuentas_por_pagar', 'destaraje'], 'solo las colecciones de Báscula/CxP');
  igual((await page.evaluate(() => window.__toasts))[0][0], 'ok', 'toast de éxito');
  igual((await botonDeBarra(page)).hora, 'Actualizado ' + (await page.evaluate(() => window.EVE_BOTON_ACTUALIZAR.formatearHora(Date.now()))), 'hora actualizada');
  await ctx.close();
});

caso('Báscula: conserva pestaña, filtros y buscador; el ticket sin auditar nuevo llega a la lista de CxP', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'destaraje');
  const viejo = ticket('a', 1001, 'ALFA', '2026-11-01', iso('01', '08'));
  const nuevo = ticket('b', 1002, 'ALFA', '2026-11-05', iso('12', '19'));
  const otro = ticket('c', 1003, 'BETA', '2026-11-05', iso('12', '19'));
  await montarBascula(page, { registros: [viejo], bd: { destaraje: [viejo, nuevo, otro] } });
  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  await page.fill('#ft-proveedor', 'ALFA');
  await page.dispatchEvent('#ft-proveedor', 'input');
  await page.evaluate(() => { document.getElementById('main-content').style.minHeight = '3000px'; window.scrollTo(0, 250); });
  await pulsar(page);
  igual(await page.$eval('.destaraje-subtabs .tab.active', (e) => e.textContent.trim()), 'Todos', 'sigue en Todos');
  igual(await page.$eval('#ft-proveedor', (e) => e.value), 'ALFA', 'el filtro de proveedor se conserva');
  igual(await page.$$eval('#destaraje-tabla-destaraje tr', (trs) => trs.map((t) => t.children[0].textContent.trim()).filter((t) => t !== 'Sin registros').sort()), ['1001', '1002'], 'el filtro sigue aplicando sobre los datos nuevos');
  igual(await page.evaluate(() => Math.round(window.scrollY)), 250, 'scroll conservado');
  // Tickets sin auditar (los consume la lista de CxP): el recién llegado ya cuenta.
  const pendientes = await page.evaluate(() => window.EVE_CXP.listarPendientesSinAuditar(window.EVE.registrosDestaraje, window.EVE.cuentasPorPagar, window.EVE.auditorias).map((r) => r.ticket).sort());
  igual(pendientes, ['1001', '1002', '1003'], 'tickets sin auditar tras actualizar');
  await ctx.close();
});

caso('Báscula: un ticket de venta (V) nuevo no entra a la lista de Báscula y las cuentas/auditorías nuevas se fusionan', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'destaraje');
  const viejo = ticket('a', 1001, 'ALFA', HOY, iso('12', '08'));
  const venta = ticket('v', 'V', 'CLIENTE', HOY, iso('12', '19'));
  const nuevo = ticket('b', 1002, 'BETA', HOY, iso('12', '19'));
  const cxpNueva = cuenta('c2', 1002, 'BETA', 1000, HOY, iso('12', '19'));
  await montarBascula(page, { registros: [viejo], bd: { destaraje: [viejo, venta, nuevo], cuentas_por_pagar: [cxpNueva] } });
  await pulsar(page);
  igual(await page.evaluate(() => window.EVE.registrosDestaraje.map((r) => r.ticket).sort()), ['1001', '1002'], 'V no entra a registrosDestaraje');
  igual(await page.evaluate(() => window.EVE.registrosVentas.map((r) => r.ticket)), ['V'], 'V va a registrosVentas');
  igual(await page.evaluate(() => window.EVE.cuentasPorPagar.map((c) => c.ticket)), ['1002'], 'la CxP nueva se fusiona');
  igual(await page.evaluate(() => window.EVE_CXP.listarPendientesSinAuditar(window.EVE.registrosDestaraje, window.EVE.cuentasPorPagar, window.EVE.auditorias).map((r) => r.ticket)), ['1001'], 'el ticket con CxP ya no está sin auditar');
  await ctx.close();
});

caso('Báscula: sin lectura de CxP no se lee cuentas_por_pagar ni auditorias', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'destaraje', { permisos: ['destaraje'] });
  await montarBascula(page, { registros: [ticket('a', 1001, 'ALFA', HOY, iso('12', '08'))], bd: { destaraje: [ticket('a', 1001, 'ALFA', HOY, iso('12', '08')), ticket('b', 1002, 'BETA', HOY, iso('12', '19'))] } });
  await pulsar(page);
  igual(await colecciones(page), ['destaraje'], 'solo destaraje');
  await ctx.close();
});

caso('CxP: el botón está a la derecha de la barra de Por Proveedor / Todos', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'cxp');
  await montarCxP(page, { cuentas: [cuenta('c1', 1, 'ALFA', 500, HOY, iso('12', '08'))], registros: [], bd: {} });
  const b = await botonDeBarra(page);
  afirmar(b && b.aLaDerecha && b.ultimoHijo, 'botón a la derecha: ' + JSON.stringify(b));
  igual(page.errores, [], 'errores de página');
  await ctx.close();
});

caso('CxP: refresca Total Adeudado General, saldos por proveedor y tickets sin auditar, solo con lecturas de CxP', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'cxp');
  const c1 = cuenta('c1', 1, 'ALFA', 500, HOY, iso('12', '08'));
  const c1Pagada = cuenta('c1', 1, 'ALFA', 0, HOY, iso('12', '08'));
  const c2 = cuenta('c2', 2, 'BETA', 800, HOY, iso('12', '19'));
  const sinAuditar = ticket('t3', 3, 'GAMMA', HOY, iso('12', '19'));
  await montarCxP(page, { cuentas: [c1], registros: [], bd: { cuentas_por_pagar: [c1Pagada, c2], destaraje: [sinAuditar] } });
  const total = () => page.$eval('#cxp-resumen-general strong', (e) => e.textContent.trim());
  const chip = () => page.$$eval('#cxp-alerta .chip-warn', (e) => e.map((x) => x.textContent.trim()));
  afirmar((await total()).includes('500.00'), 'total antes: ' + await total());
  igual(await chip(), [], 'sin tickets sin auditar antes');
  await pulsar(page);
  afirmar((await total()).includes('800.00'), 'el Total Adeudado General se actualiza: ' + await total());
  afirmar((await page.$eval('#cxp-resumen-general', (e) => e.innerText)).includes('(1 proveedor con saldo pendiente)'), 'un proveedor con saldo');
  const chips = await chip();
  afirmar(chips.length === 1 && chips[0].includes('1 tickets sin auditar'), 'contador de tickets sin auditar: ' + JSON.stringify(chips));
  igual(await page.evaluate(() => window.EVE.cuentasPorPagar.find((c) => c.id === 'c1').saldo), 0, 'el saldo cambiado de una cuenta existente se actualiza');
  igual(await page.evaluate(() => window.__cargasCompletas), 0, 'no se dispara la carga completa');
  igual(page.navegaciones, 0, 'la página no se recarga');
  igual(await colecciones(page), ['auditorias', 'cuentas_por_pagar', 'destaraje'], 'solo las colecciones de CxP');
  const cxpLeida = await page.evaluate(() => window.__lecturas.find((l) => l.coleccion === 'cuentas_por_pagar'));
  igual(cxpLeida.filtro, null, 'cuentas_por_pagar se lee completa (los saldos cambian en cuentas viejas)');
  await ctx.close();
});

caso('CxP: conserva «Incluir material de socios», la pestaña Todos, sus filtros y el scroll', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'cxp');
  const socio = cuenta('s1', 1, 'GERMAN', 300, HOY, iso('12', '08'));
  const alfa = cuenta('a1', 2, 'ALFA', 500, HOY, iso('12', '08'));
  const alfaNueva = cuenta('a2', 3, 'ALFA', 200, HOY, iso('12', '19'));
  await montarCxP(page, { cuentas: [socio, alfa], registros: [], bd: { cuentas_por_pagar: [socio, alfa, alfaNueva] } });
  await page.evaluate(() => { window.localStorage.setItem('cxp_incluir_socios', '1'); });
  await page.uncheck('#cxp-incluir-socios');
  await page.click('.destaraje-subtabs .tab:has-text("Todos")');
  const totalAntes = await page.$eval('#cxp-resumen-general strong', (e) => e.textContent.trim());
  afirmar(totalAntes.includes('500.00'), 'sin socios el total es 500: ' + totalAntes);
  await page.evaluate(() => { document.getElementById('main-content').style.minHeight = '3000px'; window.scrollTo(0, 300); });
  await pulsar(page);
  igual(await page.isChecked('#cxp-incluir-socios'), false, 'la casilla de socios sigue desmarcada');
  igual(await page.evaluate(() => window.localStorage.getItem('cxp_incluir_socios')), '0', 'la preferencia se conserva');
  const totalDespues = await page.$eval('#cxp-resumen-general strong', (e) => e.textContent.trim());
  afirmar(totalDespues.includes('700.00'), 'sin socios y con la cuenta nueva el total es 700 (no incluye a GERMAN): ' + totalDespues);
  igual(await page.$eval('.destaraje-subtabs .tab.active', (e) => e.textContent.trim()), 'Todos', 'sigue en la vista Todos');
  igual(await page.evaluate(() => Math.round(window.scrollY)), 300, 'scroll conservado');
  await ctx.close();
});

caso('CxP: sin conexión no lee nada', async (browser) => {
  const { ctx, page } = await paginaModulo(browser, 'cxp');
  await montarCxP(page, { cuentas: [cuenta('c1', 1, 'ALFA', 500, HOY, iso('12', '08'))], registros: [], bd: {} });
  await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); });
  await pulsar(page);
  igual(await page.evaluate(() => window.__lecturas.length), 0, 'sin lecturas');
  igual((await page.evaluate(() => window.__toasts))[0][0], 'error', 'avisa del error');
  await ctx.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log('ok   ' + nombre); } catch (error) { fallos++; console.error('FALLA ' + nombre + '\n     ' + error.message); }
  }
  await browser.close();
  console.log(`${casos.length - fallos}/${casos.length} casos correctos`);
  if (fallos > 0) process.exit(1);
})();
