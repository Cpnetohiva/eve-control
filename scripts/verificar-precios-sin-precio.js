// K15b/K15c — Verificación de los grupos del aviso "Materiales del catálogo sin precio vigente" (js/precios.js).
//
// MATERIALES_SIN_PRECIO_NO_HABITUAL (js/config.js, editable) lista los recibibles que no se compran
// habitualmente: sin precio solo se listan como informativos. Todo OTRO recibible sin precio alarma
// ("necesarios antes de su primer ticket"), incluido cualquier material nuevo del catálogo.
//
// Uso: node scripts/verificar-precios-sin-precio.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/precios.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { precios: [], ajustesPrecioProveedor: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const HOY = '2026-10-02';
const precio = (material, fechaInicio) => ({ id: `p-${material}`, material, precio: 5, fechaInicio: fechaInicio || '2026-01-01', fechaFin: null });

caso('La lista de no habituales vive en config.js y trae los 13 materiales acordados', () => {
  const w = crearContexto();
  igual(w.MATERIALES_SIN_PRECIO_NO_HABITUAL.slice().sort(), [
    'BIDON MOLIDO', 'LECHERO PELETIZADO', 'P.E. PELETIZADO', 'P.P. PELETIZADO', 'PELLET AGRO20', 'PELLET CAJAS', 'PELLET TAMBO',
    'PELLET TAPON', 'PET CRISTAL', 'PET ETIQUETA', 'PET VERDE', 'SUERO MOLIDO', 'SUERO PELETIZADO'
  ], 'constante en config.js');
  afirmar(!fs.readFileSync(path.join(RAIZ, 'js/precios.js'), 'utf8').includes("'PET CRISTAL'"), 'precios.js no repite la lista');
  w.MATERIALES_SIN_PRECIO_NO_HABITUAL.forEach((m) => afirmar(w.MATERIALES_COMUNES.includes(m), `${m} es recibible`));
  afirmar(!('MATERIALES_PRECIO_ANTES_DE_PRIMER_TICKET' in w), 'la constante invertida de K15b ya no existe');
});

caso('P.E. MOLIDO y MATERIAL VIRGEN sin precio alarman', () => {
  const w = crearContexto();
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([], HOY);
  ['P.E. MOLIDO', 'MATERIAL VIRGEN'].forEach((m) => afirmar(g.necesarios.includes(m) && !g.noHabituales.includes(m), `${m} alarma`));
});

caso('MIXTO y LECHERO (se compran a diario) sin precio alarman', () => {
  const w = crearContexto();
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([], HOY);
  ['MIXTO', 'LECHERO'].forEach((m) => afirmar(g.necesarios.includes(m), `${m} alarma`));
  const g2 = w.EVE_PRECIOS.materialesSinPrecioVigente([precio('LECHERO')], HOY);
  afirmar(g2.necesarios.includes('MIXTO') && !g2.necesarios.includes('LECHERO'), 'con precio solo sale el que lo tiene');
});

caso('Un material habitual que PIERDE su precio vigente (cerrado) vuelve a alarmar', () => {
  const w = crearContexto();
  const cerrado = { id: 'p-mixto', material: 'MIXTO', precio: 5, fechaInicio: '2026-01-01', fechaFin: '2026-09-30' };
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([cerrado], HOY);
  afirmar(g.necesarios.includes('MIXTO'), 'MIXTO sin precio vigente hoy alarma');
});

caso('Los no habituales sin precio (PET, pellets, molidos y peletizados nuevos) NO alarman', () => {
  const w = crearContexto();
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([], HOY);
  w.MATERIALES_SIN_PRECIO_NO_HABITUAL.forEach((m) => afirmar(g.noHabituales.includes(m) && !g.necesarios.includes(m), `${m} es informativo`));
  igual(Object.keys(g).sort(), ['necesarios', 'noHabituales'], 'solo dos grupos');
  igual(g.necesarios.length + g.noHabituales.length, w.MATERIALES_COMUNES.length, 'todos los recibibles sin precio están en algún grupo');
});

caso('Un material nuevo del catálogo que no está en la constante alarma por omisión', () => {
  const w = crearContexto();
  w.MATERIALES_COMUNES.push('PLASTICO NUEVO');
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([], HOY);
  afirmar(g.necesarios.includes('PLASTICO NUEVO') && !g.noHabituales.includes('PLASTICO NUEVO'), 'el nuevo alarma');
  w.MATERIALES_SIN_PRECIO_NO_HABITUAL.push('PLASTICO NUEVO');
  const g2 = w.EVE_PRECIOS.materialesSinPrecioVigente([], HOY);
  afirmar(g2.noHabituales.includes('PLASTICO NUEVO'), 'al agregarlo a la constante pasa a informativo');
});

caso('Con precio vigente, el material sale de su grupo', () => {
  const w = crearContexto();
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([precio('P.E. MOLIDO'), precio('PET CRISTAL')], HOY);
  afirmar(!g.necesarios.includes('P.E. MOLIDO') && g.necesarios.includes('MATERIAL VIRGEN'), 'solo MATERIAL VIRGEN sigue alarmando');
  afirmar(!g.noHabituales.includes('PET CRISTAL'), 'PET CRISTAL ya no aparece');
});

caso('Un precio guardado con el nombre anterior (alias) cuenta (K1)', () => {
  const w = crearContexto();
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([precio('P.P MOLIDO')], HOY);
  afirmar(!g.necesarios.includes('P.P. MOLIDO') && !g.noHabituales.includes('P.P. MOLIDO'), 'P.P. MOLIDO cubierto por el precio guardado como P.P MOLIDO');
});

caso('Un precio que empieza en el futuro todavía no cuenta', () => {
  const w = crearContexto();
  const g = w.EVE_PRECIOS.materialesSinPrecioVigente([precio('MATERIAL VIRGEN', '2026-12-01')], HOY);
  afirmar(g.necesarios.includes('MATERIAL VIRGEN'), 'MATERIAL VIRGEN sigue alarmando');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${error.message}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
