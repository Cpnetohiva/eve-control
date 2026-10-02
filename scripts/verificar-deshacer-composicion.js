// K20d — Verificación de 'Deshacer última versión' de composiciones (funciones puras de js/rendimientos.js).
//
// Carga en un vm js/config.js, js/utils.js y js/rendimientos.js y prueba planificarDeshacerUltimaVersion y
// resumirImpactoDeshacer. La transacción de Firestore y el modal viven en la UI y no se ejercitan aquí.
//
// Uso: node scripts/verificar-deshacer-composicion.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { composiciones: [], registrosDestaraje: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const R = crearContexto().EVE_RENDIMIENTOS;
const version = (id, materialEntrada, v, fechaVigencia, fechaCierre) => ({
  id, materialEntrada, version: v, fechaVigencia, fechaCierre: fechaCierre === undefined ? null : fechaCierre,
  componentes: [{ subproducto: 'P.E.', porcentaje: 100, esMerma: false }]
});

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

caso('Material con 3 versiones: última v3, anterior v2 y la acción reabre v2', () => {
  const plan = R.planificarDeshacerUltimaVersion([
    version('a', 'LECHERO', 1, '2026-07-01', '2026-07-31'),
    version('b', 'LECHERO', 2, '2026-08-01', '2026-08-31'),
    version('c', 'LECHERO', 3, '2026-09-01', null)
  ], 'LECHERO');
  afirmar(plan.ok && plan.motivoError === null, 'ok');
  igual([plan.ultima.version, plan.anterior.version], [3, 2], 'última y anterior');
  igual(plan.accion, { borrarId: 'c', reabrirId: 'b', fechaCierre: null }, 'borra v3 y reabre v2 (fechaCierre null)');
});

caso('Material con 1 versión: anterior null (vuelve a pendiente) y no reabre nada', () => {
  const plan = R.planificarDeshacerUltimaVersion([version('a', 'LECHERO', 1, '2026-08-01', null)], 'LECHERO');
  afirmar(plan.ok, 'ok');
  igual([plan.ultima.id, plan.anterior, plan.accion.reabrirId, plan.accion.borrarId], ['a', null, null, 'a'], 'solo borra');
});

caso('Dos versiones abiertas: ok=false', () => {
  const plan = R.planificarDeshacerUltimaVersion([version('a', 'LECHERO', 1, '2026-08-01', null), version('b', 'LECHERO', 2, '2026-09-01', null)], 'LECHERO');
  igual([plan.ok, plan.ultima, plan.anterior, plan.accion], [false, null, null, null], 'sin plan');
  afirmar(/más de una versión abierta/.test(plan.motivoError), plan.motivoError);
});

caso('Última cerrada: ok=false (nunca se deshace una intermedia ni una cerrada)', () => {
  const plan = R.planificarDeshacerUltimaVersion([version('a', 'LECHERO', 1, '2026-07-01', '2026-07-31'), version('b', 'LECHERO', 2, '2026-08-01', '2026-08-31')], 'LECHERO');
  igual(plan.ok, false, 'ok');
  afirmar(/ya está cerrada/.test(plan.motivoError), plan.motivoError);
  // La abierta no es la de mayor vigencia (inconsistente): tampoco se deshace.
  const raro = R.planificarDeshacerUltimaVersion([version('a', 'LECHERO', 1, '2026-07-01', null), version('b', 'LECHERO', 2, '2026-08-01', '2026-08-31')], 'LECHERO');
  igual(raro.ok, false, 'la abierta no es la más reciente');
});

caso('Sin versiones del material: ok=false; las de otros materiales no cuentan', () => {
  const plan = R.planificarDeshacerUltimaVersion([version('a', 'P.E.', 1, '2026-08-01', null)], 'LECHERO');
  igual(plan.ok, false, 'ok');
  igual(R.planificarDeshacerUltimaVersion([], 'LECHERO').ok, false, 'lista vacía');
  igual(R.planificarDeshacerUltimaVersion(undefined, 'LECHERO').ok, false, 'undefined tolerado');
});

caso('Solo mira las versiones del material, con alias normalizado (K1)', () => {
  const plan = R.planificarDeshacerUltimaVersion([
    version('x', 'P.E.', 5, '2026-10-01', null),
    version('a', 'GARRAFA', 1, '2026-07-01', '2026-07-31'),
    version('b', 'BIDON', 2, '2026-08-01', null)
  ], 'BIDON');
  afirmar(plan.ok, 'ok');
  igual([plan.ultima.id, plan.anterior.id], ['b', 'a'], 'GARRAFA y BIDON son el mismo material');
});

caso('Empate de vigencia: manda la versión con número mayor', () => {
  const plan = R.planificarDeshacerUltimaVersion([version('a', 'LECHERO', 1, '2026-08-01', '2026-08-31'), version('b', 'LECHERO', 2, '2026-08-01', null)], 'LECHERO');
  afirmar(plan.ok, 'ok');
  igual(plan.ultima.id, 'b', 'la v2');
});

caso('No modifica las versiones recibidas', () => {
  const lista = [version('a', 'LECHERO', 1, '2026-07-01', '2026-07-31'), version('b', 'LECHERO', 2, '2026-08-01', null)];
  const antes = JSON.stringify(lista);
  R.planificarDeshacerUltimaVersion(lista, 'LECHERO');
  igual(JSON.stringify(lista), antes, 'sin cambios');
});

caso('Impacto: tickets y kg de Báscula con fecha >= la vigencia de la versión a borrar', () => {
  const t = (material, kg, fechaSalida, fechaEntrada) => ({ material, kg, fechaSalida, fechaEntrada: fechaEntrada || fechaSalida });
  const impacto = R.resumirImpactoDeshacer([
    t('LECHERO', 100, '2026-08-31'), t('LECHERO', 250.5, '2026-09-01'), t('LECHERO', 49.5, '2026-09-20'),
    t('P.E.', 999, '2026-09-10'), t('lechero', 10, '', '2026-09-02'), t('LECHERO', 5, '', '')
  ], 'LECHERO', '2026-09-01');
  igual(impacto, { tickets: 3, kg: 310 }, 'desde el 1 de septiembre (incluye fechaEntrada si falta fechaSalida)');
  igual(R.resumirImpactoDeshacer([], 'LECHERO', '2026-09-01'), { tickets: 0, kg: 0 }, 'sin tickets');
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
