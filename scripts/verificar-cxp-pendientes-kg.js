// Verificación del renglón de la lista de tickets sin auditar de CxP (kg o pz entre material y fecha).
// Uso: node scripts/verificar-cxp-pendientes-kg.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

function crearContexto() {
  const almacen = {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); }
    },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function igual(real, esperado, mensaje) {
  if (real !== esperado) throw new Error(`${mensaje}: esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`);
}
const reg = (material, kg) => ({ ticket: '1511', proveedor: 'JUANA', material, kg, fechaEntrada: '2026-11-07' });

caso('listarPendientesSinAuditar conserva el kg del registro', () => {
  const w = crearContexto();
  const r = w.EVE_CXP.listarPendientesSinAuditar([{ ...reg('MIXTO', 1250), fechaEntrada: '2099-01-01' }], [], []);
  igual(r.length, 1, 'pendientes');
  igual(r[0].kg, 1250, 'kg');
});

caso('el renglón muestra kg con miles entre material y fecha', () => {
  const w = crearContexto();
  igual(w.EVE_CXP.textoPendienteSinAuditar(reg('MIXTO', 1250)), 'Ticket 1511 — JUANA — MIXTO — 1,250 kg — 07/11/2026', 'renglon');
});

caso('sin decimales innecesarios', () => {
  const w = crearContexto();
  igual(w.EVE_CXP.textoPendienteSinAuditar(reg('MIXTO', 80)).includes('— 80 kg —'), true, 'entero');
});

caso('material de pieza muestra pz', () => {
  const w = crearContexto();
  w.MATERIALES_PZ = ['TAMBO', 'CAJA CO30', 'CAJA CH25', 'CAJA AGRO20'];
  igual(w.EVE_CXP.textoPendienteSinAuditar(reg('TAMBO', 12)).includes('— 12 pz —'), true, 'pz');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`OK   ${nombre}`); } catch (e) { fallos++; console.log(`FALLA ${nombre}\n     ${e.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos`);
  process.exit(fallos ? 1 : 0);
})();
