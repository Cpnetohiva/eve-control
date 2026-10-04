// Prueba en Chromium (Playwright) de la navegación agrupada con los JS y el CSS reales: grupos y orden, whitelist de permisos,
// grupo con un solo módulo, último módulo por grupo, modo Dos filas / Desplegable (persistido en localStorage), hover y toque,
// sin barra horizontal, botones de 44px, panel Admin y activarTab. Sirve los archivos desde un origen falso (http://eve.test)
// para que localStorage exista y se pueda recargar; Firebase está simulado y no usa la red.
//
// Uso: node scripts/verificar-navegacion.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const ORIGEN = 'http://eve.test';
const SCRIPTS = ['config.js', 'utils.js', 'permisos.js', 'navegacion.js', 'auth.js', 'admin.js'];
const TODOS_LOS_MODULOS = ['destaraje', 'pagos', 'ventas', 'precios', 'rendimientos', 'cxp', 'recibosPago', 'cxc', 'cobros', 'gastos', 'cotizaciones', 'controlProduccion', 'inventario', 'reportes', 'dashboard'];
const TODO_ESCRITURA = { destaraje: 'escritura', pagos: 'escritura', ventas: 'escritura', precios: 'escritura', rendimientos: 'escritura', cxp: 'escritura', cxc: 'escritura', control_produccion: 'escritura', inventario: 'escritura', reportes: 'escritura', dashboard: 'escritura', gastos: 'escritura', cotizaciones: 'escritura', admin: 'escritura', permisosExtra: {} };

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/css/styles.css"></head><body>
<div id="login-screen"><form id="login-form"><input id="login-username"><input id="login-password"><div id="login-error"></div></form></div>
<div id="app-shell" class="visible"><header class="app-header"><h1>EVE Control</h1><div class="header-actions"><button id="btn-admin">Admin</button><button id="btn-salir">Salir</button></div></header>
<nav class="nav-modulos" id="tabs-container" aria-label="Módulos"></nav><main id="main-content"></main></div><div id="toast-container"></div>
<script>window.firebase={initializeApp(){},firestore(){return{enablePersistence(){return Promise.resolve()}}},auth(){return{onAuthStateChanged(){},signInWithEmailAndPassword(){}}}};</script>
${SCRIPTS.map((s) => `<script src="/js/${s}"></script>`).join('')}
</body></html>`;

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// Abre la app falsa con estos permisos. opciones: { viewport, tactil, almacen }.
async function abrir(browser, permisos, opciones) {
  const o = opciones || {};
  const contexto = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 800 }, hasTouch: !!o.tactil, isMobile: !!o.tactil });
  const page = await contexto.newPage();
  page.erroresPagina = [];
  page.on('pageerror', (e) => page.erroresPagina.push(e.message));
  await page.route(`${ORIGEN}/**`, (route) => {
    const ruta = new URL(route.request().url()).pathname;
    if (ruta === '/') return route.fulfill({ contentType: 'text/html', body: HTML });
    const archivo = path.join(RAIZ, ruta);
    if (fs.existsSync(archivo)) return route.fulfill({ path: archivo });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto(`${ORIGEN}/`);
  if (o.almacen) await page.evaluate((a) => Object.keys(a).forEach((k) => localStorage.setItem(k, a[k])), o.almacen);
  await iniciar(page, permisos);
  return page;
}

// Simula el login: define módulos y usuario y llama a renderTabs (el mismo camino que establecerSesionActiva).
async function iniciar(page, permisos) {
  await page.evaluate((p) => {
    const todos = ['destaraje', 'pagos', 'ventas', 'precios', 'rendimientos', 'cxp', 'recibosPago', 'cxc', 'cobros', 'gastos', 'cotizaciones', 'controlProduccion', 'inventario', 'reportes', 'dashboard'];
    todos.forEach((id) => { window.EVE_MODULES[id] = { render(c) { c.textContent = `Módulo ${id}`; } }; });
    window.EVE_ADMIN_USUARIOS = { crearVistaUsuarios: () => { const d = document.createElement('div'); d.textContent = 'Panel admin'; return d; } };
    window.EVE.currentUser = { username: 'prueba', permisosResueltos: p };
    window.renderTabs(p);
  }, permisos);
}

const botones = (page, selector) => page.$$eval(selector, (n) => n.map((b) => b.textContent.trim()));
const gruposVisibles = (page) => botones(page, '.nav-grupos > .nav-grupo, .nav-grupos > .nav-grupo-envoltura > .nav-grupo');
const filaModulos = (page) => botones(page, '.nav-modulos-fila .tab');
const modulo = (page) => page.textContent('#main-content');
const grupoActivo = (page) => page.$$eval('.nav-grupo.active', (n) => n.map((b) => b.textContent.replace(' ▾', '').trim()));
const sinBarraHorizontal = (page) => page.evaluate(() => {
  const nav = document.getElementById('tabs-container');
  return document.documentElement.scrollWidth <= document.documentElement.clientWidth && nav.scrollWidth <= nav.clientWidth;
});

caso('cada módulo tiene grupo, en el orden y con los grupos definidos', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  const mapa = await page.evaluate(() => window.EVE_NAV.agruparTabs(window.tabsVisiblesPorPermiso(window.EVE.currentUser.permisosResueltos)).map((g) => [g.nombre, g.tabs.map((t) => t.id)]));
  igual(mapa, [
    ['Compras', ['destaraje', 'pagos', 'precios', 'cxp', 'recibosPago']],
    ['Ventas', ['ventas', 'cxc', 'cobros', 'cotizaciones']],
    ['Planta', ['rendimientos', 'controlProduccion', 'inventario']],
    ['Finanzas', ['gastos', 'reportes', 'dashboard']]
  ], 'grupos y módulos');
  igual(mapa.flatMap(([, ids]) => ids).sort(), TODOS_LOS_MODULOS.slice().sort(), 'ningún módulo se pierde ni se repite');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('módulo sin grupo conocido no desaparece: cae en "Otros"', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  const r = await page.evaluate(() => window.EVE_NAV.agruparTabs([{ id: 'x', nombre: 'X', grupo: 'ventas' }, { id: 'y', nombre: 'Y' }, { id: 'z', nombre: 'Z', grupo: 'inventado' }]).map((g) => [g.id, g.tabs.map((t) => t.id)]));
  igual(r, [['ventas', ['x']], ['otros', ['y', 'z']]], 'agrupación con módulos sueltos');
});

caso('Dos filas por omisión: arranca en el primer grupo, su fila de módulos y el grupo activo', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  igual(await gruposVisibles(page), ['Compras', 'Ventas', 'Planta', 'Finanzas'], 'fila de grupos');
  igual(await filaModulos(page), ['Báscula', 'Pagos', 'Precios', 'CxP', 'Recibos de Pago'], 'fila de módulos (orden actual)');
  igual(await grupoActivo(page), ['Compras'], 'grupo activo');
  igual(await modulo(page), 'Módulo destaraje', 'módulo abierto');
  igual((await page.evaluate(() => window.EVE_NAV.estado())).modo, 'filas', 'modo por omisión');
  igual(await page.textContent('.nav-modo'), 'Menú', 'el interruptor ofrece cambiar a Menú');
  igual(await page.isVisible('#btn-admin'), true, 'el botón Admin sigue aparte');
});

caso('recuerda el último módulo de cada grupo y el grupo del módulo abierto queda activo', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  await page.click('.nav-grupos >> text=Ventas');
  igual([await modulo(page), (await filaModulos(page)).join()], ['Módulo ventas', 'Ventas,CxC,Cobros,Cotizaciones'], 'al entrar a un grupo abre su primer módulo');
  await page.click('.nav-modulos-fila >> text=Cobros');
  await page.click('.nav-grupos >> text=Planta');
  await page.click('.nav-modulos-fila >> text=Inventario');
  await page.click('.nav-grupos >> text=Ventas');
  igual(await modulo(page), 'Módulo cobros', 'vuelve al último módulo de Ventas');
  await page.click('.nav-grupos >> text=Planta');
  igual(await modulo(page), 'Módulo inventario', 'vuelve al último módulo de Planta');
  await page.evaluate(() => window.activarTab('dashboard'));
  igual(await grupoActivo(page), ['Finanzas'], 'activarTab desde otro lugar activa el grupo del módulo');
  igual(await page.$$eval('.nav-modulos-fila .tab.active', (n) => n.map((b) => b.textContent)), ['Dashboard'], 'módulo activo en la fila');
  igual(await page.evaluate(() => JSON.parse(localStorage.getItem('eve-nav-ultimo-por-grupo'))), { compras: 'destaraje', ventas: 'cobros', planta: 'inventario', finanzas: 'dashboard' }, 'localStorage');
  await iniciar(page, TODO_ESCRITURA);
  igual(await modulo(page), 'Módulo destaraje', 'tras un nuevo login arranca en el primer grupo');
  await page.click('.nav-grupos >> text=Ventas');
  igual(await modulo(page), 'Módulo cobros', 'el último módulo sobrevive al volver a iniciar sesión');
});

caso('sin barra horizontal en escritorio y botones de al menos 44px', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  afirmar(await sinBarraHorizontal(page), 'hay desplazamiento horizontal en 1280px (Dos filas)');
  const altos = await page.$$eval('#tabs-container button', (n) => n.map((b) => b.getBoundingClientRect().height).filter((h) => h > 0));
  afirmar(altos.length >= 9 && altos.every((h) => h >= 44), `botones menores de 44px: ${altos.join(',')}`);
  await page.click('.nav-modo');
  afirmar(await sinBarraHorizontal(page), 'hay desplazamiento horizontal en 1280px (Desplegable)');
});

caso('Desplegable en escritorio: se guarda el modo, el menú abre con el cursor y al elegir se cierra', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  await page.click('.nav-modo');
  igual(await page.evaluate(() => localStorage.getItem('eve-nav-modo')), 'desplegable', 'modo guardado');
  igual(await page.$$('.nav-modulos-fila').then((n) => n.length), 0, 'sin segunda fila');
  igual(await page.textContent('.nav-modo'), '2 filas', 'el interruptor ofrece volver a 2 filas');
  igual(await gruposVisibles(page), ['Compras ▾', 'Ventas ▾', 'Planta ▾', 'Finanzas ▾'], 'grupos con flecha');
  igual(await page.isVisible('.nav-menu >> nth=1'), false, 'menú cerrado en reposo');
  await page.hover('.nav-grupo:has-text("Ventas")');
  igual(await page.isVisible('[data-grupo="ventas"] .nav-menu'), true, 'el cursor abre el menú');
  igual(await botones(page, '[data-grupo="ventas"] .nav-menu .tab'), ['Ventas', 'CxC', 'Cobros', 'Cotizaciones'], 'módulos del menú');
  igual(await modulo(page), 'Módulo destaraje', 'abrir el menú no cambia de módulo');
  await page.click('[data-grupo="ventas"] .nav-menu >> text=Cotizaciones');
  igual(await modulo(page), 'Módulo cotizaciones', 'módulo elegido');
  igual(await grupoActivo(page), ['Ventas'], 'su grupo queda activo');
  igual(await page.isVisible('[data-grupo="ventas"] .nav-menu'), false, 'el menú se cierra al elegir aunque el cursor siga encima');
  await page.mouse.move(5, 500);
  await page.hover('.nav-grupo:has-text("Ventas")');
  igual(await page.isVisible('[data-grupo="ventas"] .nav-menu'), true, 'al volver con el cursor, abre de nuevo');
  await page.mouse.move(5, 500);
  // clic abre/cierra, clic fuera y Escape cierran
  await page.click('.nav-grupo:has-text("Planta")');
  igual(await page.isVisible('[data-grupo="planta"] .nav-menu'), true, 'clic abre');
  await page.click('#main-content');
  igual(await page.isVisible('[data-grupo="planta"] .nav-menu'), false, 'clic fuera cierra');
  await page.click('.nav-grupo:has-text("Planta")');
  await page.keyboard.press('Escape');
  igual(await page.isVisible('[data-grupo="planta"] .nav-menu'), false, 'Escape cierra');
  await page.mouse.move(5, 500);
  await page.keyboard.press('Escape');
  await page.hover('.nav-grupo:has-text("Finanzas")');
  igual(await page.isVisible('[data-grupo="finanzas"] .nav-menu'), true, 'un Escape sin menú abierto no suprime el siguiente hover');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('el modo elegido sobrevive a recargar la página y a un nuevo login', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  await page.click('.nav-modo');
  await page.reload();
  await iniciar(page, TODO_ESCRITURA);
  igual((await page.evaluate(() => window.EVE_NAV.estado())).modo, 'desplegable', 'modo tras recargar');
  igual(await page.$$('.nav-modulos-fila').then((n) => n.length), 0, 'sigue sin segunda fila');
  await page.click('.nav-modo');
  igual((await page.evaluate(() => window.EVE_NAV.estado())).modo, 'filas', 'de vuelta a Dos filas');
  afirmar((await filaModulos(page)).length > 0, 'vuelve la segunda fila');
});

caso('celular (toque, 360px): el menú abre con toque, sin barra horizontal y botones de 44px', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA, { viewport: { width: 360, height: 740 }, tactil: true });
  igual(await page.evaluate(() => matchMedia('(hover: hover)').matches), false, 'el emulador debe ser táctil sin hover');
  afirmar(await sinBarraHorizontal(page), 'desplazamiento horizontal en 360px (Dos filas)');
  await page.tap('.nav-modo');
  afirmar(await sinBarraHorizontal(page), 'desplazamiento horizontal en 360px (Desplegable)');
  igual(await page.isVisible('[data-grupo="ventas"] .nav-menu'), false, 'cerrado en reposo');
  await page.tap('.nav-grupo:has-text("Ventas")');
  igual(await page.isVisible('[data-grupo="ventas"] .nav-menu'), true, 'el toque abre el menú');
  const altos = await page.$$eval('[data-grupo="ventas"] .nav-menu .tab, .nav-grupos .nav-grupo, .nav-modo', (n) => n.map((b) => b.getBoundingClientRect().height).filter((h) => h > 0));
  afirmar(altos.length >= 6 && altos.every((h) => h >= 44), `botones táctiles menores de 44px: ${altos.join(',')}`);
  await page.tap('.nav-grupo:has-text("Ventas")');
  igual(await page.isVisible('[data-grupo="ventas"] .nav-menu'), false, 'un segundo toque lo cierra');
  await page.tap('.nav-grupo:has-text("Planta")');
  await page.tap('[data-grupo="planta"] .nav-menu >> text=Rendimientos');
  igual(await modulo(page), 'Módulo rendimientos', 'módulo elegido con toque');
  igual(await page.isVisible('[data-grupo="planta"] .nav-menu'), false, 'el menú se cierra tras elegir');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('celular de 320px: el menú de cada grupo cabe en pantalla (sin desbordar a la derecha)', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA, { viewport: { width: 320, height: 640 }, tactil: true, almacen: { 'eve-nav-modo': 'desplegable' } });
  for (const grupo of ['compras', 'ventas', 'planta', 'finanzas']) {
    await page.tap(`[data-grupo="${grupo}"] .nav-grupo`);
    const caja = await page.$eval(`[data-grupo="${grupo}"] .nav-menu`, (m) => { const r = m.getBoundingClientRect(); return { izq: r.left, der: r.right, ancho: r.width }; });
    afirmar(caja.izq >= 0 && caja.der <= 320 && caja.ancho > 0, `menú de ${grupo} fuera de pantalla: ${JSON.stringify(caja)}`);
    afirmar(await sinBarraHorizontal(page), `desplazamiento horizontal con el menú de ${grupo} abierto`);
    await page.tap(`[data-grupo="${grupo}"] .nav-grupo`);
  }
});

caso('permisos: Socios en solo lectura (whitelist) — grupos y módulos que le tocan', async (browser) => {
  const socios = { ventas: 'lectura', cxc: 'lectura', gastos: 'lectura', reportes: 'lectura', dashboard: 'lectura', cotizaciones: 'ninguno', admin: 'ninguno', permisosExtra: {} };
  const page = await abrir(browser, socios);
  igual(await gruposVisibles(page), ['Compras', 'Ventas', 'Finanzas'], 'Planta no aparece (sin ningún módulo)');
  // cxc con lectura también habilita Recibos de Pago (permiso: cxp, pagos o cxc): Compras queda con un solo módulo.
  igual(await filaModulos(page), [], 'Compras tiene un solo módulo visible: sin segunda fila');
  igual(await modulo(page), 'Módulo recibosPago', 'el grupo de un solo módulo abre ese módulo directo');
  await page.click('.nav-grupos >> text=Ventas');
  igual(await filaModulos(page), ['Ventas', 'CxC', 'Cobros'], 'Cotizaciones (ninguno) no aparece');
  igual(await page.isVisible('#btn-admin'), false, 'sin permiso de Admin el botón Admin sigue oculto (lo gestiona renderTabs)');
  igual(page.erroresPagina, [], 'errores de JS');
});

caso('permisos: key ausente o valor raro en cotizaciones no muestra el módulo ni su grupo', async (browser) => {
  for (const valor of [undefined, null, '', 'ninguno', 'x', true]) {
    const permisos = { gastos: 'lectura', ventas: 'ninguno', cotizaciones: valor, permisosExtra: {} };
    const page = await abrir(browser, permisos);
    igual(await gruposVisibles(page), ['Finanzas'], `solo Finanzas con cotizaciones=${JSON.stringify(valor)}`);
    await page.context().close();
  }
});

caso('permisos: rol con un solo módulo — un grupo, sin segunda fila ni interruptor', async (browser) => {
  const page = await abrir(browser, { destaraje: 'escritura', permisosExtra: {} });
  igual(await gruposVisibles(page), ['Compras'], 'un solo grupo');
  igual(await modulo(page), 'Módulo destaraje', 'abre su módulo');
  igual(await grupoActivo(page), ['Compras'], 'grupo activo');
  igual(await page.$$('.nav-modulos-fila, .nav-modo').then((n) => n.length), 0, 'sin segunda fila ni interruptor');
  const sin = await abrir(browser, { permisosExtra: {} });
  igual(await gruposVisibles(sin), [], 'sin módulos no hay grupos');
  igual(await modulo(sin), '', 'sin módulo abierto');
});

caso('permisos: grupos de un módulo en Dos filas y en Desplegable abren directo', async (browser) => {
  const page = await abrir(browser, { precios: 'lectura', ventas: 'lectura', gastos: 'lectura', permisosExtra: {} });
  igual(await gruposVisibles(page), ['Compras', 'Ventas', 'Finanzas'], 'grupos');
  igual(await page.$$('.nav-modo').then((n) => n.length), 0, 'sin interruptor: ningún grupo tiene más de un módulo');
  await page.click('.nav-grupos >> text=Ventas');
  igual([await modulo(page), (await filaModulos(page)).length], ['Módulo ventas', 0], 'Ventas abre su único módulo');
  const con = await abrir(browser, { precios: 'lectura', cxp: 'lectura', ventas: 'lectura', permisosExtra: {} }, { almacen: { 'eve-nav-modo': 'desplegable' } });
  igual(await gruposVisibles(con), ['Compras ▾', 'Ventas'], 'solo el grupo con varios módulos lleva flecha');
  await con.click('.nav-grupos >> text=Ventas');
  igual([await modulo(con), await con.$$('[data-grupo="ventas"]').then((n) => n.length)], ['Módulo ventas', 0], 'el grupo de un módulo abre directo, sin menú');
});

caso('el panel Admin no deja ningún grupo ni módulo marcado y se puede volver', async (browser) => {
  const page = await abrir(browser, TODO_ESCRITURA);
  await page.click('.nav-grupos >> text=Ventas');
  await page.click('#btn-admin');
  afirmar((await modulo(page)).includes('Panel admin'), 'panel Admin abierto');
  igual(await page.$$('#tabs-container .tab.active').then((n) => n.length), 0, 'sin pestañas activas en Admin');
  igual(await page.$$('.nav-modulos-fila').then((n) => n.length), 0, 'sin segunda fila en Admin');
  await page.click('.nav-grupos >> text=Ventas');
  igual(await modulo(page), 'Módulo ventas', 'tocar el grupo otra vez sale de Admin');
});

caso('estado activo, hover y foco siguen saliendo de las variables --nav-* (sin colores nuevos)', async () => {
  const css = fs.readFileSync(path.join(RAIZ, 'css/styles.css'), 'utf8');
  const bloque = css.slice(css.indexOf('/* ===== Navegación agrupada'));
  afirmar(bloque.length > 200, 'no se encontró el bloque de navegación');
  afirmar(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(bloque), 'el bloque de navegación usa un color literal');
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
