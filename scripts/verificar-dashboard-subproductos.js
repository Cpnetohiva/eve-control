// Dashboard — Subproductos: Real vs Teórico por Mes. Verifica que la columna Total de Diferencia (%) se
// calcule con los totales ((real total - teórico total) / teórico total * 100) y no sumando los porcentajes
// mensuales, que teórico 0 dé guion (null) también en las celdas mensuales, y que Diferencia (kg) sume bien.
//
// Carga en un vm js/config.js, js/utils.js, js/rendimientos.js y js/dashboard.js. calcularRendimientoMaterial (de reportes.js) se
// reemplaza por un doble que devuelve los kg reales y el % esperado de cada mes.
//
// Uso: node scripts/verificar-dashboard-subproductos.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/dashboard.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], composiciones: [], precios: [], cuentasPorPagar: [], registrosControlProduccion: [] };
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
const cerca = (real, esperado, mensaje) => afirmar(real !== null && Math.abs(real - esperado) < 1e-6, `${mensaje}: esperado ${esperado}, obtenido ${real}`);
const esNulo = (real, mensaje) => afirmar(real === null, `${mensaje}: esperado null (guion), obtenido ${real}`);

// Matriz con la forma de construirMatrizMesClave (filas { clave, [mes]: valor, _total }).
const matriz = (meses, filas) => ({
  meses,
  claves: filas.map((f) => f.clave),
  filas: filas.map((f) => ({ ...f, _total: meses.reduce((suma, mes) => suma + (f[mes] || 0), 0) }))
});

caso('Fórmula pura: (real - teórico) / teórico * 100; guion con teórico 0', () => {
  const D = crearContexto().EVE_DASHBOARD;
  cerca(D.calcularDiferenciaPorcentual(0, 793), -100, 'real 0 contra 793');
  cerca(D.calcularDiferenciaPorcentual(150, 100), 50, 'real 150 contra 100');
  cerca(D.calcularDiferenciaPorcentual(100, 100), 0, 'igual al teórico');
  esNulo(D.calcularDiferenciaPorcentual(50, 0), 'teórico 0');
  esNulo(D.calcularDiferenciaPorcentual(0, 0), 'real y teórico 0');
  esNulo(D.calcularDiferenciaPorcentual(50, undefined), 'teórico sin dato');
});

caso('Dos meses con real 0 y teórico 793 y 91: -100% en cada mes y -100% en el total (no -200%)', () => {
  const D = crearContexto().EVE_DASHBOARD;
  const meses = ['2026-08', '2026-09'];
  const { diferenciaKg, diferenciaPct } = D.construirMatricesDiferencia(
    matriz(meses, [{ clave: 'PET CRISTAL', '2026-08': 0, '2026-09': 0 }]),
    matriz(meses, [{ clave: 'PET CRISTAL', '2026-08': 793, '2026-09': 91 }])
  );
  const pct = diferenciaPct.filas[0];
  cerca(pct['2026-08'], -100, 'mes 1');
  cerca(pct['2026-09'], -100, 'mes 2');
  cerca(pct._total, -100, 'total (antes mostraba -200%)');
  const kg = diferenciaKg.filas[0];
  cerca(kg['2026-08'], -793, 'kg mes 1');
  cerca(kg['2026-09'], -91, 'kg mes 2');
  cerca(kg._total, -884, 'kg total = suma de los meses');
});

caso('El total pondera por kg: real 50/teórico 100 y real 300/teórico 100 da +75%, no el promedio de -50% y +200%', () => {
  const D = crearContexto().EVE_DASHBOARD;
  const meses = ['2026-08', '2026-09'];
  const { diferenciaPct } = D.construirMatricesDiferencia(
    matriz(meses, [{ clave: 'P.E.', '2026-08': 50, '2026-09': 300 }]),
    matriz(meses, [{ clave: 'P.E.', '2026-08': 100, '2026-09': 100 }])
  );
  const pct = diferenciaPct.filas[0];
  cerca(pct['2026-08'], -50, 'mes 1');
  cerca(pct['2026-09'], 200, 'mes 2');
  cerca(pct._total, 75, '(350 - 200) / 200 * 100');
});

caso('Teórico 0 da guion en la celda mensual y en el total (no 0%)', () => {
  const D = crearContexto().EVE_DASHBOARD;
  const meses = ['2026-08', '2026-09'];
  const { diferenciaPct } = D.construirMatricesDiferencia(
    matriz(meses, [{ clave: 'BASURA', '2026-08': 30, '2026-09': 0 }, { clave: 'SUERO', '2026-08': 10, '2026-09': 0 }]),
    matriz(meses, [{ clave: 'BASURA', '2026-08': 0, '2026-09': 0 }, { clave: 'SUERO', '2026-08': 20, '2026-09': 0 }])
  );
  const [basura, suero] = diferenciaPct.filas;
  esNulo(basura['2026-08'], 'BASURA mes 1');
  esNulo(basura['2026-09'], 'BASURA mes 2');
  esNulo(basura._total, 'BASURA total');
  cerca(suero['2026-08'], -50, 'SUERO mes 1');
  esNulo(suero['2026-09'], 'SUERO mes 2 (teórico 0)');
  cerca(suero._total, -50, 'SUERO total = (10 - 20) / 20');
});

caso('De punta a punta: calcularVistaSubproductosRealVsTeorico con composición y tickets de dos meses', () => {
  const w = crearContexto();
  w.EVE.composiciones = [{ id: 'c1', materialEntrada: 'MIXTO', version: 1, fechaVigencia: '2026-01-01', fechaCierre: null, componentes: [{ subproducto: 'PET CRISTAL', porcentaje: 100, esMerma: false }] }];
  w.EVE.registrosDestaraje = [
    { id: 'd1', ticket: '1', material: 'MIXTO', kg: 793, fechaSalida: '2026-08-10' },
    { id: 'd2', ticket: '2', material: 'MIXTO', kg: 91, fechaSalida: '2026-09-10' }
  ];
  // Doble de calcularRendimientoMaterial: sin producción real, el esperado es el 100% de la entrada del mes.
  w.calcularRendimientoMaterial = (material, periodo) => {
    const entradaTotalKg = periodo.desde.startsWith('2026-08') ? 793 : 91;
    return { entradaTotalKg, filas: [{ subproducto: 'PET CRISTAL', esperadoPct: 100, realKg: 0 }] };
  };
  const bloque = w.EVE_DASHBOARD.calcularVistaSubproductosRealVsTeorico().find((b) => b.material === 'MIXTO');
  afirmar(bloque, 'bloque de MIXTO');
  const pct = bloque.diferenciaPct.filas[0];
  cerca(pct['2026-08'], -100, 'mes 1');
  cerca(pct['2026-09'], -100, 'mes 2');
  cerca(pct._total, -100, 'total');
  cerca(bloque.diferenciaKg.filas[0]._total, -884, 'Diferencia (kg) total');
  cerca(bloque.real.filas[0]._total - bloque.teorico.filas[0]._total, -884, 'Real - Teórico coincide con Diferencia (kg)');
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
