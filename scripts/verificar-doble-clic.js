// Prueba en navegador (Chromium de Playwright) de window.protegerContraDobleRegistro (js/utils.js): dos y tres clics seguidos
// guardan un solo registro, el candado se toma antes de cualquier await, un fallo permite reintentar de inmediato, el
// enfriamiento tras un guardado exitoso rechaza otro registro con un toast, y dos claves distintas no se bloquean entre sí.
// No usa la red ni Firebase real.
//
// Uso: node scripts/verificar-doble-clic.js   (código de salida 1 si algo falla)

const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');

const FIREBASE_SIMULADO = () => {
  window.firebase = {
    initializeApp() {},
    firestore() { return { enablePersistence() { return Promise.resolve(); } }; },
    auth() { return { onAuthStateChanged() {} }; }
  };
  window.EVE = {};
  window.EVE_MODULES = {};
};

// Botón por formulario cuyo clic pasa por la protección; `guardados` cuenta los registros que realmente se escribieron.
const PREPARAR_PAGINA = () => {
  window.guardados = { a: 0, b: 0 };
  window.modo = { a: 'ok', b: 'ok' };
  const retraso = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const clave of ['a', 'b']) {
    const boton = document.createElement('button');
    boton.id = `btn-${clave}`;
    boton.addEventListener('click', () => {
      window.protegerContraDobleRegistro(`form-${clave}`, async () => {
        await retraso(80);
        if (window.modo[clave] === 'lanza') throw new Error('falla simulada');
        if (window.modo[clave] === 'false') return false;
        window.guardados[clave]++;
      }).catch(() => {});
    });
    document.body.appendChild(boton);
  }
};

async function paginaNueva(browser) {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="toast-container"></div></body></html>');
  await page.evaluate(FIREBASE_SIMULADO);
  await page.addScriptTag({ path: path.join(RAIZ, 'js/config.js') });
  await page.addScriptTag({ path: path.join(RAIZ, 'js/utils.js') });
  await page.evaluate(PREPARAR_PAGINA);
  return page;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function igual(real, esperado, mensaje) {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) {
    throw new Error(`${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
  }
}
const pausa = (page, ms) => page.waitForTimeout(ms);
const guardados = (page) => page.evaluate(() => ({ ...window.guardados }));
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent));

caso('el enfriamiento por omisión es de 2500 ms', async (browser) => {
  const page = await paginaNueva(browser);
  igual(await page.evaluate(() => window.ENFRIAMIENTO_DOBLE_REGISTRO_MS), 2500, 'constante de config.js');
  await page.close();
});

caso('dos clics seguidos (mismo turno) guardan un solo registro', async (browser) => {
  const page = await paginaNueva(browser);
  await page.evaluate(() => { const b = document.getElementById('btn-a'); b.click(); b.click(); });
  await pausa(page, 300);
  igual((await guardados(page)).a, 1, 'registros guardados');
  igual(await toasts(page), [], 'el segundo clic en curso se ignora en silencio, sin toast');
  await page.close();
});

caso('tres clics seguidos (mismo turno) guardan un solo registro', async (browser) => {
  const page = await paginaNueva(browser);
  await page.evaluate(() => { const b = document.getElementById('btn-a'); b.click(); b.click(); b.click(); });
  await pausa(page, 300);
  igual((await guardados(page)).a, 1, 'registros guardados');
  await page.close();
});

caso('doble clic real del ratón guarda un solo registro', async (browser) => {
  const page = await paginaNueva(browser);
  await page.dblclick('#btn-a');
  await pausa(page, 300);
  igual((await guardados(page)).a, 1, 'registros guardados');
  await page.close();
});

caso('el candado se toma de forma síncrona: la acción arranca una sola vez aunque el segundo clic llegue antes del primer await', async (browser) => {
  const page = await paginaNueva(browser);
  const arranques = await page.evaluate(async () => {
    let n = 0;
    const accion = async () => { n++; await new Promise((r) => setTimeout(r, 50)); };
    window.protegerContraDobleRegistro('sync', accion);
    window.protegerContraDobleRegistro('sync', accion);
    window.protegerContraDobleRegistro('sync', accion);
    await new Promise((r) => setTimeout(r, 120));
    return n;
  });
  igual(arranques, 1, 'veces que arrancó la acción');
  await page.close();
});

caso('tras un guardado exitoso, otro clic dentro del enfriamiento se rechaza con toast', async (browser) => {
  const page = await paginaNueva(browser);
  await page.click('#btn-a');
  await pausa(page, 200);
  await page.click('#btn-a');
  await pausa(page, 200);
  igual((await guardados(page)).a, 1, 'registros guardados');
  igual(await toasts(page), ['Registro ya guardado, espera un momento'], 'toast del enfriamiento');
  await page.close();
});

caso('pasado el enfriamiento se vuelve a poder registrar', async (browser) => {
  const page = await paginaNueva(browser);
  await page.evaluate(() => { window.ENFRIAMIENTO_DOBLE_REGISTRO_MS = 300; });
  await page.click('#btn-a');
  await pausa(page, 500);
  await page.click('#btn-a');
  await pausa(page, 200);
  igual((await guardados(page)).a, 2, 'registros guardados');
  await page.close();
});

caso('si la acción lanza error, se puede reintentar de inmediato y no hay enfriamiento', async (browser) => {
  const page = await paginaNueva(browser);
  await page.evaluate(() => { window.modo.a = 'lanza'; });
  await page.click('#btn-a');
  await pausa(page, 200);
  igual((await guardados(page)).a, 0, 'nada guardado tras el fallo');
  await page.evaluate(() => { window.modo.a = 'ok'; });
  await page.click('#btn-a');
  await pausa(page, 200);
  igual((await guardados(page)).a, 1, 'el reintento inmediato guarda');
  igual(await toasts(page), [], 'sin toast de enfriamiento tras el fallo');
  await page.close();
});

caso('si la acción devuelve false (error atrapado por el handler), se puede reintentar de inmediato', async (browser) => {
  const page = await paginaNueva(browser);
  await page.evaluate(() => { window.modo.a = 'false'; });
  await page.click('#btn-a');
  await pausa(page, 200);
  await page.evaluate(() => { window.modo.a = 'ok'; });
  await page.click('#btn-a');
  await pausa(page, 200);
  igual((await guardados(page)).a, 1, 'el reintento inmediato guarda');
  await page.close();
});

caso('el error de la acción se relanza a quien llamó', async (browser) => {
  const page = await paginaNueva(browser);
  const mensaje = await page.evaluate(async () => {
    try { await window.protegerContraDobleRegistro('r', async () => { throw new Error('boom'); }); return 'sin error'; }
    catch (error) { return error.message; }
  });
  igual(mensaje, 'boom', 'mensaje del error');
  await page.close();
});

caso('dos claves distintas no se bloquean entre sí (en curso ni en enfriamiento)', async (browser) => {
  const page = await paginaNueva(browser);
  await page.evaluate(() => { document.getElementById('btn-a').click(); document.getElementById('btn-b').click(); });
  await pausa(page, 300);
  igual(await guardados(page), { a: 1, b: 1 }, 'ambas claves guardan mientras la otra estaba en curso');
  await page.click('#btn-a');
  await pausa(page, 200);
  igual(await guardados(page), { a: 1, b: 1 }, 'a en enfriamiento no guarda otra vez');
  await page.evaluate(() => { window.modo.b = 'ok'; });
  await page.click('#btn-b');
  await pausa(page, 200);
  igual(await guardados(page), { a: 1, b: 1 }, 'b también quedó en su propio enfriamiento');
  const otra = await page.evaluate(async () => {
    let n = 0;
    await window.protegerContraDobleRegistro('c', async () => { n++; });
    return n;
  });
  igual(otra, 1, 'una tercera clave nunca usada guarda mientras a y b enfrían');
  await page.close();
});

(async () => {
  const browser = await chromium.launch();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(browser); console.log(`ok ${nombre}`); }
    catch (error) { fallos++; console.log(`FALLA ${nombre}\n  ${error.message}`); }
  }
  await browser.close();
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
