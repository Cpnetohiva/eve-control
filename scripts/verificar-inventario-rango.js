// Verificación del inventario por rango Desde/Hasta (EVE_INVENTARIO.calcularInventarioPorRango y helpers).
//
// Carga en un contexto vm js/config.js, js/utils.js e js/inventario.js y ejecuta casos sintéticos: saldo inicial y final salen
// de la línea de tiempo cortada a cada fecha, un inventario inicial anterior a Desde cuenta en el saldo inicial y uno dentro
// del rango como entrada, y saldo inicial + entradas − salidas + ajustes = saldo final por material.
//
// Uso: node scripts/verificar-inventario-rango.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {};
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
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

const w = crearContexto();
const INV = w.EVE_INVENTARIO;

const VACIO = { inventarioInicial: [], registrosDestaraje: [], registrosControlProduccion: [], ventas: [] };
let secuencia = 0;
const compra = (material, kg, fecha) => ({ id: `d${++secuencia}`, ticket: String(100 + secuencia), material, kg, fechaSalida: fecha, fechaEntrada: fecha });
const inicial = (material, etapa, kg, fecha) => ({ id: `i${++secuencia}`, material, etapa, kg, fecha });
const inp = (material, kg) => ({ material, kg });
const out = (material, kg, esMerma) => ({ material, kg, esMerma: !!esMerma });
const proceso = (tipoProceso, inputs, outputs, fecha) => ({ id: `p${++secuencia}`, ticket: `P-${String(secuencia).padStart(3, '0')}`, tipoProceso, inputs, outputs, fecha });
const venta = (material, kg, fecha) => ({ id: `v${++secuencia}`, folio: `V-2026-${String(secuencia).padStart(3, '0')}`, fecha, lineas: [{ material, cantidad: kg }] });
const ajuste = (material, etapa, diferencia, fecha) => ({ id: `a${++secuencia}`, material, etapa, ajustes: [{ fecha, diferencia }] });

const rango = (datos, registrosInventario, desde, hasta) => INV.calcularInventarioPorRango({ ...VACIO, ...datos }, registrosInventario || [], desde, hasta);
const fila = (resultado, material) => resultado.filas.find((f) => f.material === material);
const numeros = (f) => [f.saldoInicial, f.entradas, f.salidas, f.ajustes, f.saldoFinal];

caso('Recepción dentro del rango: saldo inicial 0, entrada y saldo final', () => {
  const r = rango({ registrosDestaraje: [compra('LECHERO', 100, '2026-09-10')] }, [], '2026-09-01', '2026-09-30');
  const f = fila(r, 'LECHERO');
  igual(numeros(f), [0, 100, 0, 0, 100], 'ini/ent/sal/aj/fin');
  afirmar(f.cuadra && r.descuadres.length === 0, 'debe cuadrar');
});

caso('Saldo inicial es el cierre del día anterior a Desde (el propio día de Desde cuenta como entrada)', () => {
  const datos = { registrosDestaraje: [compra('LECHERO', 100, '2026-09-09'), compra('LECHERO', 40, '2026-09-10')] };
  const f = fila(rango(datos, [], '2026-09-10', '2026-09-30'), 'LECHERO');
  igual(numeros(f), [100, 40, 0, 0, 140], 'corte en la víspera de Desde');
});

caso('Movimientos posteriores a Hasta no cuentan en el saldo final', () => {
  const datos = { registrosDestaraje: [compra('LECHERO', 100, '2026-09-10'), compra('LECHERO', 70, '2026-10-05')] };
  const f = fila(rango(datos, [], '2026-09-01', '2026-09-30'), 'LECHERO');
  igual(numeros(f), [0, 100, 0, 0, 100], 'saldo al cierre de Hasta');
});

caso('Inventario inicial anterior a Desde va al saldo inicial; dentro del rango es entrada', () => {
  const datos = { inventarioInicial: [inicial('LECHERO', 'RECEPCIÓN', 50, '2026-08-31'), inicial('LECHERO', 'RECEPCIÓN', 30, '2026-09-15')] };
  const f = fila(rango(datos, [], '2026-09-01', '2026-09-30'), 'LECHERO');
  igual(numeros(f), [50, 30, 0, 0, 80], 'inicial antes y dentro');
  afirmar(f.cuadra, 'debe cuadrar');
});

caso('Producción: consumo es salida, output no merma es entrada, merma no cuenta', () => {
  const datos = {
    registrosDestaraje: [compra('LECHERO', 100, '2026-09-01')],
    registrosControlProduccion: [proceso('SELECCION', [inp('LECHERO', 100)], [out('LECHERO', 85), out('LECHERO', 15, true)], '2026-09-05')]
  };
  const r = rango(datos, [], '2026-09-01', '2026-09-30');
  const f = fila(r, 'LECHERO');
  igual(numeros(f), [0, 185, 100, 0, 85], 'recepción + output − consumo');
  afirmar(f.cuadra, 'debe cuadrar');
  const etapa = (nombre) => f.etapas.find((e) => e.etapa === nombre);
  igual(etapa('RECEPCIÓN').saldoFinal, 0, 'RECEPCIÓN quedó en 0');
  igual(etapa('SELECCIÓN').saldoFinal, 85, 'SELECCIÓN recibió el output');
});

caso('Venta: salida del material; VENDIDO no cuenta como existencia', () => {
  const datos = {
    registrosDestaraje: [compra('LECHERO', 100, '2026-09-01')],
    ventas: [venta('LECHERO', 60, '2026-09-12')]
  };
  const r = rango(datos, [], '2026-09-01', '2026-09-30');
  const f = fila(r, 'LECHERO');
  igual(numeros(f), [0, 100, 60, 0, 40], 'venta como salida');
  afirmar(!f.etapas.some((e) => e.etapa === 'VENDIDO'), 'VENDIDO no aparece en el detalle');
  afirmar(f.cuadra, 'debe cuadrar');
});

caso('Ajustes: anterior a Desde en el saldo inicial, dentro del rango en Ajustes, posterior a Hasta fuera', () => {
  const datos = { registrosDestaraje: [compra('LECHERO', 100, '2026-08-01')] };
  const registros = [{
    id: 'inv1', material: 'LECHERO', etapa: 'RECEPCIÓN',
    ajustes: [{ fecha: '2026-08-15', diferencia: -5 }, { fecha: '2026-09-10', diferencia: 3 }, { fecha: '2026-10-02', diferencia: 9 }]
  }];
  const r = rango(datos, registros, '2026-09-01', '2026-09-30');
  const f = fila(r, 'LECHERO');
  igual(numeros(f), [95, 0, 0, 3, 98], 'ajustes por su fecha');
  afirmar(f.cuadra, 'debe cuadrar');
});

caso('Suma de etapas por material = saldo de calcularSaldoDisponibleEnFecha (inicial y final)', () => {
  const datos = {
    ...VACIO,
    registrosDestaraje: [compra('LECHERO', 100, '2026-09-01'), compra('LECHERO', 50, '2026-09-20')],
    registrosControlProduccion: [proceso('SELECCION', [inp('LECHERO', 80)], [out('LECHERO', 70)], '2026-09-05')],
    ventas: [venta('LECHERO', 30, '2026-09-25')]
  };
  const f = fila(INV.calcularInventarioPorRango(datos, [], '2026-09-10', '2026-09-30'), 'LECHERO');
  igual(f.saldoInicial, INV.calcularSaldoDisponibleEnFecha(datos, 'LECHERO', '2026-09-09'), 'saldo inicial');
  igual(f.saldoFinal, INV.calcularSaldoDisponibleEnFecha(datos, 'LECHERO', '2026-09-30'), 'saldo final');
});

caso('Un renglón que no cuadra se marca (output sin etapa destino que no llega al ledger)', () => {
  const datos = {
    registrosDestaraje: [compra('LECHERO', 100, '2026-09-01')],
    registrosControlProduccion: [proceso('SIN_ETAPA_DESTINO', [inp('LECHERO', 100)], [out('LECHERO', 90)], '2026-09-05')]
  };
  const r = rango(datos, [], '2026-09-01', '2026-09-30');
  const f = fila(r, 'LECHERO');
  afirmar(f.cuadra === false, 'debe marcarse como no cuadra');
  igual(f.diferencia, 90, 'diferencia = output que no llegó al ledger');
  igual(r.descuadres.map((x) => x.material), ['LECHERO'], 'reportado en descuadres');
});

caso('Sin datos o rango sin movimientos: sin filas', () => {
  igual(rango({}, [], '2026-09-01', '2026-09-30').filas, [], 'sin datos');
  const datos = { registrosDestaraje: [compra('LECHERO', 100, '2025-01-01')] };
  const f = fila(rango(datos, [], '2026-09-01', '2026-09-30'), 'LECHERO');
  igual(numeros(f), [100, 0, 0, 0, 100], 'saldo arrastrado sin movimientos en el rango');
});

caso('No modifica los datos', () => {
  const datos = { ...VACIO, registrosDestaraje: [compra('LECHERO', 100, '2026-09-10')], ventas: [venta('LECHERO', 10, '2026-09-11')] };
  const antes = JSON.stringify(datos);
  INV.calcularInventarioPorRango(datos, [], '2026-09-01', '2026-09-30');
  igual(JSON.stringify(datos), antes, 'datos intactos');
});

caso('validarRangoInventario: sin rango, incompleto, invertido y válido', () => {
  igual(INV.validarRangoInventario('', ''), { activo: false, error: '' }, 'sin rango');
  afirmar(!INV.validarRangoInventario('2026-09-01', '').activo && INV.validarRangoInventario('2026-09-01', '').error, 'solo Desde');
  afirmar(!INV.validarRangoInventario('', '2026-09-01').activo && INV.validarRangoInventario('', '2026-09-01').error, 'solo Hasta');
  afirmar(!INV.validarRangoInventario('2026-09-30', '2026-09-01').activo && INV.validarRangoInventario('2026-09-30', '2026-09-01').error, 'Desde > Hasta');
  igual(INV.validarRangoInventario('2026-09-01', '2026-09-01'), { activo: true, error: '' }, 'Desde = Hasta es válido');
});

caso('CSV por rango: mismas columnas, fila TOTAL por material y filas por etapa', () => {
  const datos = { registrosDestaraje: [compra('LECHERO', 100, '2026-09-10')] };
  const filasCSV = INV.construirFilasCSVInventarioRango(rango(datos, [], '2026-09-01', '2026-09-30'));
  igual(Object.keys(filasCSV[0]), ['Material', 'Etapa', 'Unidad', 'Saldo Inicial', 'Entradas', 'Salidas', 'Ajustes', 'Saldo Final', 'Cuadra'], 'columnas');
  igual(filasCSV[0].Etapa, 'TOTAL', 'primera fila es el total del material');
  igual(filasCSV[0].Cuadra, 'SI', 'cuadra');
  igual(filasCSV[1].Etapa, 'RECEPCIÓN', 'detalle por etapa');
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
