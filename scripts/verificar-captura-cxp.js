// Verificación de la Vista para captura de CxP · Por Proveedor.
//
// Carga en un contexto vm los js/ reales (config, utils, cxp) y comprueba que construirConfigCapturaCxP:
//  - ordena a los proveedores de mayor a menor saldo, tanto en el Resumen (izquierda) como en los bloques (derecha);
//  - usa solo las líneas con saldo pendiente y el subtotal de cada bloque es el saldo del proveedor;
//  - la suma de los subtotales es igual al Total del periodo (y a lo que dan Exportar Resumen / Detalle);
//  - agrega la columna Saldo solo en el bloque del proveedor con abonos parciales;
//  - sin saldo pendiente no arma bloques y muestra el mensaje de vacío.
//
// Uso: node scripts/verificar-captura-cxp.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
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
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${mensaje}: esperado ${b}, real ${a}`);
}

function cuenta(ticket, proveedor, material, kg, precio, pagado, fechaTicket) {
  const total = Math.round(kg * precio * 100) / 100;
  const saldo = Math.round((total - pagado) * 100) / 100;
  return {
    id: `cxp-${ticket}`, ticket, proveedor, material, kg, precioEfectivo: precio, total, pagado, saldo, fechaTicket,
    estado: saldo <= 0 ? 'liquidado' : (pagado > 0 ? 'parcial' : 'pendiente'), abonos: []
  };
}

const CUENTAS = [
  cuenta('100', 'ALFA', 'PET', 1000, 5, 0, '2026-09-28'),
  cuenta('101', 'ALFA', 'HDPE', 500, 8, 0, '2026-09-29'),
  cuenta('102', 'BETA', 'PET', 3000, 5, 4000, '2026-09-27'), // abono parcial: saldo 11000
  cuenta('103', 'BETA', 'PP', 200, 10, 2000, '2026-09-28'), // liquidada: no debe aparecer
  cuenta('104', 'GAMMA', 'PET', 100, 5, 0, '2026-09-30')
];

function construir(window, cuentas) {
  return window.EVE_CXP.construirConfigCapturaCxP(cuentas, 99999, 'Todos');
}

caso('ordena proveedores por saldo descendente en Resumen y en bloques', (window) => {
  const config = construir(window, CUENTAS);
  igual(config.resumenSecciones[0].filas.map((f) => f.label), ['BETA', 'ALFA', 'GAMMA'], 'orden del Resumen');
  igual(config.grupos.map((g) => g.encabezado), ['BETA', 'ALFA', 'GAMMA'], 'orden de los bloques');
});

caso('solo incluye líneas con saldo pendiente', (window) => {
  const config = construir(window, CUENTAS);
  const beta = config.grupos.find((g) => g.encabezado === 'BETA');
  igual(beta.filas.map((f) => f.ticket), ['102'], 'líneas de BETA');
});

caso('la suma de subtotales es igual al Total del periodo y a Exportar Resumen', (window) => {
  const config = construir(window, CUENTAS);
  const sumaSaldos = CUENTAS.reduce((suma, c) => suma + c.saldo, 0);
  const sumaBloques = config.grupos.reduce((suma, g) => suma + g.filas.reduce((s, f) => s + f.saldo, 0), 0);
  afirmar(Math.abs(sumaBloques - sumaSaldos) < 0.005, `líneas ${sumaBloques} vs saldos ${sumaSaldos}`);
  igual(config.kpis[0].valor, window.formatearMoneda(sumaSaldos), 'Total del periodo');
  igual(config.grupos.map((g) => g.subtotal), config.resumenSecciones[0].filas.map((f) => `Subtotal ${f.valor}`), 'subtotales vs Resumen');
  const csv = window.EVE_CXP.agregarPorProveedorCxP(CUENTAS).reduce((suma, g) => suma + g.saldo, 0);
  afirmar(Math.abs(csv - sumaSaldos) < 0.005, 'Exportar Resumen no coincide');
});

caso('la columna Saldo aparece solo en el proveedor con abonos', (window) => {
  const config = construir(window, CUENTAS);
  const etiquetas = (nombre) => config.grupos.find((g) => g.encabezado === nombre).columnas.map((c) => c.etiqueta);
  igual(etiquetas('ALFA'), ['Ticket', 'Material', 'Kg', 'Precio', 'Total'], 'columnas de ALFA');
  igual(etiquetas('BETA'), ['Ticket', 'Material', 'Kg', 'Precio', 'Total', 'Saldo'], 'columnas de BETA');
});

caso('sin saldo pendiente no hay bloques y se muestra el mensaje de vacío', (window) => {
  const config = construir(window, [cuenta('103', 'BETA', 'PP', 200, 10, 2000, '2026-09-28')]);
  afirmar(config.grupos === undefined && config.resumenSecciones === undefined, 'no debe armar bloques');
  igual(config.kpis[0].valor, window.formatearMoneda(0), 'Total del periodo');
  igual(config.vacioMensaje, 'Sin saldo pendiente en este periodo', 'mensaje de vacío');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn(crearContexto());
    console.log(`OK   ${nombre}`);
  } catch (error) {
    fallos++;
    console.log(`FALLA ${nombre}\n     ${error.message}`);
  }
}
console.log(fallos === 0 ? `\n${casos.length} casos OK` : `\n${fallos} de ${casos.length} casos fallaron`);
process.exit(fallos === 0 ? 0 : 1);
