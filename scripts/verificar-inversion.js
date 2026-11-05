// Rubro Inversión (js/gastos.js y js/flujo.js).
//
// Gastos: tipoGasto acepta 'inversion' además de operacion y financiamiento; un gasto sin tipoGasto sigue como Operación.
// Flujo: el movimiento manual 'Inversión en activo' (salida) y los gastos de inversión caen en el rubro 'inversion';
// la barra de totales agrega Flujo de inversión y el neto del periodo no cambia (neto = operativo + inversión + financiamiento).
//
// Uso: node scripts/verificar-inversion.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');

function crearContexto(archivos) {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = { cobros: [], registrosPagos: [], gastos: [], flujoMovimientos: [], currentUser: null };
  const ctx = vm.createContext({
    window, console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout,
    firebase: { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) },
    document: { getElementById: () => null, createElement: () => ({}) }
  });
  for (const f of archivos) vm.runInContext(leer(`js/${f}`), ctx, { filename: f });
  return window;
}
const flujo = () => crearContexto(['config.js', 'utils.js', 'permisos.js', 'flujo.js']);
const gastos = () => crearContexto(['config.js', 'utils.js', 'gastos.js']);

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const gasto = (extra) => ({ fecha: '2026-10-07', concepto: 'Luz', beneficiario: 'CFE', montoBase: 300, iva: 0, fechaRegistro: '2026-10-07T10:00:00.000Z', ...extra });
const manual = (extra) => ({ id: 'm1', fecha: '2026-10-08', tipo: 'Otra entrada', concepto: 'X', contraparte: '', folio: '', importe: 500, fechaRegistro: '2026-10-08T10:00:00.000Z', ...extra });

caso('Gastos: tipoGasto acepta inversion y la etiqueta es "Inversión (compra de activo o mejora)"', () => {
  const w = gastos();
  igual(w.EVE_GASTOS.construirGastoDesdeFormulario({ montoBase: 900, tipoGasto: 'inversion', fecha: '2026-10-06' }).tipoGasto, 'inversion', 'inversion');
  igual(w.EVE_GASTOS.construirGastoDesdeFormulario({ montoBase: 900, tipoGasto: 'operacion', fecha: '2026-10-06' }).tipoGasto, 'operacion', 'operacion');
  igual(w.EVE_GASTOS.construirGastoDesdeFormulario({ montoBase: 900, tipoGasto: 'financiamiento', fecha: '2026-10-06' }).tipoGasto, 'financiamiento', 'financiamiento');
  const fuente = leer('js/gastos.js');
  afirmar(fuente.includes('Inversión (compra de activo o mejora)'), 'etiqueta de Inversión');
  afirmar((fuente.match(/<option value="inversion">/g) || []).length >= 2, 'opción en alta y edición');
});

caso('Gastos: un gasto sin tipoGasto sigue como Operación y no se modifica', () => {
  const w = gastos();
  const viejo = { id: 'a', montoBase: 100, iva: 0, fecha: '2026-10-08' };
  const s = w.EVE_GASTOS.calcularStats([viejo, { id: 'b', montoBase: 50, tipoGasto: 'inversion' }, { id: 'c', montoBase: 30, tipoGasto: 'financiamiento' }]);
  igual([s.operacion, s.inversion, s.financiamiento], [100, 50, 30], 'subtotales');
  igual(viejo.tipoGasto, undefined, 'documento intacto');
});

caso('Flujo: clasificarMovimientoFlujo manda Inversión en activo y gastos inversion al rubro inversion', () => {
  const w = flujo();
  const c = (m) => w.EVE_FLUJO.clasificarMovimientoFlujo(m);
  igual(c({ tipoManual: 'Inversión en activo' }), 'inversion', 'manual');
  igual(c({ tipoManual: 'inversion en activo' }), 'inversion', 'sin acentos');
  igual(c({ tipoGasto: 'inversion' }), 'inversion', 'gasto');
  igual(c({ tipoGasto: 'financiamiento' }), 'financiamiento', 'financiamiento intacto');
  igual(c({}), 'operacion', 'sin tipo');
  igual(w.EVE_FLUJO.TIPOS_MANUAL.find((t) => t.valor === 'Inversión en activo').direccion, 'Salida', 'es salida');
});

caso('Flujo: Flujo de inversión en totales; el neto del periodo no cambia', () => {
  const w = flujo();
  const m = w.EVE_FLUJO.construirMovimientosFlujo({
    gastos: [gasto({ montoBase: 100, tipoGasto: 'operacion' }), gasto({ montoBase: 400, tipoGasto: 'inversion', concepto: 'Montacargas' })],
    movimientosManuales: [manual({ id: 'i', tipo: 'Inversión en activo', importe: 250 }), manual({ id: 'e', tipo: 'Otra entrada', importe: 1000 })]
  });
  igual(m.filter((x) => x.rubro === 'inversion').map((x) => x.salida).sort(), [250, 400], 'filas de inversión');
  const t = w.EVE_FLUJO.calcularTotalesFlujo(m);
  igual([t.entradas, t.salidas, t.neto, t.operativo, t.inversion, t.financiamiento], [1000, 750, 250, 900, -650, 0], 'totales');
  igual(Math.round((t.operativo + t.inversion + t.financiamiento) * 100) / 100, t.neto, 'neto = suma de rubros');
});

caso('Flujo: la columna Rubro muestra Inversión y las exportaciones traen Flujo de inversión', () => {
  const f = leer('js/flujo.js');
  ['inversion: \'Inversión\'', '`Flujo de inversión: ', "label: 'Flujo de inversión'", 'FLUJO DE INVERSIÓN'].forEach((x) => afirmar(f.includes(x), `incluye ${x}`));
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`✓ ${nombre}`); } catch (e) { fallos++; console.log(`✗ ${nombre}\n    ${e.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos pasan`);
  process.exit(fallos ? 1 : 0);
})();
