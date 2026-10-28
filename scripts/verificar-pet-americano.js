// Alta de PET AMERICANO: material crudo, se recibe, pasa por Selección, se vende, sin composición propia.
// Carga en un vm js/config.js, js/utils.js, js/rendimientos.js y js/control-produccion-reglas.js.
//
// Uso: node scripts/verificar-pet-americano.js (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/control-produccion-reglas.js'];

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
  for (const archivo of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  return sandbox.window;
}

const w = crearContexto();
const N = 'PET AMERICANO';
let fallos = 0;
let total = 0;
function caso(nombre, fn) {
  total += 1;
  try { fn(); console.log(`ok   ${nombre}`); } catch (e) { fallos += 1; console.log(`FALLA ${nombre}: ${e.message}`); }
}
function afirmar(cond, msg) { if (!cond) throw new Error(msg); }

caso('(1) está en el catálogo como crudo KG, sin precio ni composición', () => {
  const e = w.CATALOGO_MATERIALES.find((m) => m.nombre === N);
  afirmar(e, 'no existe');
  afirmar(e.unidad === 'KG' && e.tipo === 'materia_prima' && e.seObtieneEnProduccion === false, 'datos base distintos a CRISTAL CON ETIQUETA');
  afirmar(e.recibible !== false && e.requiereSeleccion !== false && e.seVende !== false && e.activo !== false, 'banderas');
  afirmar(e.sinComposicion === true, 'falta sinComposicion');
});
caso('(2) sin duplicados ni alias nuevos', () => {
  afirmar(w.CATALOGO_MATERIALES.filter((m) => m.nombre === N).length === 1, 'duplicado');
  afirmar(!Object.values(w.MATERIALES_ALIAS).includes(N), 'alias de más');
});
caso('(3) aparece en las listas derivadas (recibir, seleccionar, vender, stock)', () => {
  afirmar(w.MATERIALES_COMUNES.includes(N), 'MATERIALES_COMUNES');
  afirmar(w.materialesQueRequierenSeleccion().includes(N), 'selección');
  afirmar(w.productosVenta().includes(N), 'ventas');
  afirmar(w.materialesConStock().includes(N), 'stock');
  afirmar(w.materialesRecibiblesHistoricos().includes(N), 'recibibles');
  afirmar(!w.materialesProducibles().includes(N), 'no debe ser salida de proceso');
});
caso('(4) normalizarMaterial lo deja igual', () => afirmar(w.normalizarMaterial(' pet  americano ') === N, 'normalizar'));
caso('(5) no aparece en Composiciones pendientes aunque tenga tickets', () => {
  const tickets = [{ material: N, kg: 500, fechaEntrada: '2026-10-01' }, { material: 'LECHERO', kg: 100, fechaEntrada: '2026-10-01' }];
  const { filas } = w.EVE_RENDIMIENTOS.calcularComposicionesPendientes(tickets, []);
  afirmar(!filas.some((f) => f.material === N), 'PET AMERICANO en pendientes');
  afirmar(filas.some((f) => f.material === 'LECHERO'), 'LECHERO debe seguir pendiente');
});
caso('(6) materialSinComposicion distingue PET AMERICANO de un material con composición', () => {
  afirmar(w.materialSinComposicion(N) === true, 'PET AMERICANO');
  afirmar(w.materialSinComposicion('pet americano') === true, 'sin normalizar');
  afirmar(w.materialSinComposicion('LECHERO') === false, 'LECHERO');
});
caso('(7) Selección: sin composición no avisa "falta composición" y acepta salidas libres', () => {
  const sug = (material) => w.EVE_CP_REGLAS.salidasSugeridas('SELECCION', [{ material, kg: 100 }], { composicion: null });
  afirmar(sug('LECHERO').avisos.some((a) => a.codigo === 'falta_composicion'), 'control: LECHERO sí debe avisar');
  afirmar(!sug(N).avisos.some((a) => a.codigo === 'falta_composicion'), 'PET AMERICANO no debe avisar');
  const varios = w.EVE_CP_REGLAS.salidasSugeridas('SELECCION', [{ material: N, kg: 100 }], { composiciones: [{ material: N, kg: 100, composicion: null }] });
  afirmar(!varios.avisos.some((a) => a.codigo === 'falta_composicion'), 'captura simple: no debe avisar');
});


