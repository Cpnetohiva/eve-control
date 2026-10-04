// Verifica que los estados de las pestañas (reposo, hover, activo y foco) salgan de variables --nav-* definidas UNA sola vez
// en :root, y que en Chromium se vean como se espera (la pestaña activa: azul marino #001D3D con borde oro #FFC300).
//
// Uso: node scripts/verificar-nav-estilos.js   (código de salida 1 si algo falla)

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RAIZ = path.join(__dirname, '..');
const VARIABLES = ['--nav-bg', '--nav-texto', '--nav-borde', '--nav-hover-bg', '--nav-hover-texto', '--nav-hover-borde', '--nav-activo-bg', '--nav-activo-texto', '--nav-activo-borde', '--nav-foco'];

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (c, m) => { if (!c) throw new Error(m); };
const igual = (real, esperado, m) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${m}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const css = fs.readFileSync(path.join(RAIZ, 'css/styles.css'), 'utf8');

caso('las variables --nav-* se definen una sola vez, dentro de :root', () => {
  const raiz = css.match(/:root\s*\{[^}]*\}/)[0];
  VARIABLES.forEach((v) => {
    igual((css.match(new RegExp(`${v}\\s*:`, 'g')) || []).length, 1, `definiciones de ${v}`);
    afirmar(raiz.includes(`${v}:`), `${v} no está en :root`);
  });
});

caso('las reglas .tab no llevan colores literales (solo var(--nav-*))', () => {
  const reglas = css.match(/\.tab[^{}]*\{[^}]*\}/g) || [];
  afirmar(reglas.length >= 4, 'no se encontraron las reglas .tab');
  reglas.forEach((regla) => {
    afirmar(!/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(regla), `color literal en: ${regla.replace(/\s+/g, ' ')}`);
  });
});

caso('en el navegador: reposo, hover, activo y foco', async (browser) => {
  const page = await browser.newPage();
  await page.setContent('<nav class="tabs"><button class="tab active" id="a">Cotizaciones</button><button class="tab" id="b">Gastos</button></nav>');
  await page.addStyleTag({ path: path.join(RAIZ, 'css/styles.css') });
  const estilo = (id) => page.$eval(id, (n) => { const s = getComputedStyle(n); return { bg: s.backgroundColor, color: s.color, borde: s.borderBottomColor, outline: s.outlineStyle + ' ' + s.outlineColor }; });
  const activa = await estilo('#a');
  igual([activa.bg, activa.color, activa.borde], ['rgb(0, 29, 61)', 'rgb(255, 255, 255)', 'rgb(255, 195, 0)'], 'activa: azul marino, texto blanco, borde oro');
  const reposo = await estilo('#b');
  igual([reposo.bg, reposo.color, reposo.borde], ['rgba(0, 0, 0, 0)', 'rgb(102, 102, 102)', 'rgba(0, 0, 0, 0)'], 'reposo');
  await page.hover('#b');
  const hover = await estilo('#b');
  igual([hover.bg, hover.color, hover.borde], ['rgb(255, 255, 255)', 'rgb(0, 29, 61)', 'rgb(255, 195, 0)'], 'hover');
  await page.hover('#a');
  igual((await estilo('#a')).bg, 'rgb(0, 29, 61)', 'la activa conserva su fondo con el cursor encima');
  await page.mouse.move(0, 400);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const foco = await estilo('#b');
  afirmar(foco.outline.includes('solid') && foco.outline.includes('rgb(255, 195, 0)'), `foco sin anillo oro: ${foco.outline}`);
  // Un cambio en UNA variable llega a todas las pestañas.
  await page.evaluate(() => document.documentElement.style.setProperty('--nav-activo-bg', 'rgb(1, 2, 3)'));
  igual((await estilo('#a')).bg, 'rgb(1, 2, 3)', 'cambiar --nav-activo-bg cambia la pestaña activa');
  await page.close();
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
