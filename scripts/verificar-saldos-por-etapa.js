// K21b — Verificación de los saldos por etapa a una fecha (EVE_INVENTARIO.calcularSaldosPorEtapaEnFecha).
//
// Carga en un contexto vm js/config.js, js/utils.js e js/inventario.js y ejecuta casos sintéticos: el saldo por etapa usa
// el mismo ledger (orden de K2, reparto por etapa de K18), el mismo corte por día y las mismas exclusiones que
// calcularSaldoDisponibleEnFecha, y la suma de las etapas de un material es siempre su saldo disponible.
//
// Uso: node scripts/verificar-saldos-por-etapa.js   (código de salida 1 si algún caso falla)

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
const inicial = (material, etapa, kg) => ({ id: `i${++secuencia}`, material, etapa, kg, fecha: '2026-01-01' });
const inp = (material, kg) => ({ material, kg });
const out = (material, kg, esMerma) => ({ material, kg, esMerma: !!esMerma });
const proceso = (tipoProceso, inputs, outputs, fecha) => ({ id: `p${++secuencia}`, ticket: `P-${String(secuencia).padStart(3, '0')}`, tipoProceso, inputs, outputs, fecha });
const venta = (material, kg, fecha) => ({ id: `v${++secuencia}`, folio: `V-2026-${String(secuencia).padStart(3, '0')}`, fecha, lineas: [{ material, cantidad: kg }] });

const saldos = (datos, fecha, exclusiones) => INV.calcularSaldosPorEtapaEnFecha({ ...VACIO, ...datos }, fecha, exclusiones);
const celda = (s, material, etapa) => (s[material] || {})[etapa] || 0;

// Cuadre: para cada material, la suma de sus etapas es calcularSaldoDisponibleEnFecha.
function cuadra(datos, fecha, exclusiones) {
  const completos = { ...VACIO, ...datos };
  const s = INV.calcularSaldosPorEtapaEnFecha(completos, fecha, exclusiones);
  const materiales = new Set(Object.keys(s));
  completos.registrosDestaraje.forEach((r) => materiales.add(w.normalizarMaterial(r.material)));
  completos.inventarioInicial.forEach((r) => materiales.add(w.normalizarMaterial(r.material)));
  materiales.forEach((material) => {
    const suma = Math.round(Object.values(s[material] || {}).reduce((a, b) => a + b, 0) * 100) / 100;
    const total = INV.calcularSaldoDisponibleEnFecha(completos, material, fecha, exclusiones);
    afirmar(Math.abs(suma - total) < 0.005, `${material}: suma de etapas ${suma} distinta del saldo disponible ${total}`);
  });
}

caso('Compra y selección: SELECCIÓN tiene los saldos, RECEPCIÓN queda en cero', () => {
  const datos = {
    registrosDestaraje: [compra('CRISTAL CON ETIQUETA', 1000, '2026-09-01')],
    registrosControlProduccion: [proceso('SELECCION', [inp('CRISTAL CON ETIQUETA', 1000)], [out('PET CRISTAL', 800), out('PET ETIQUETA', 150), out('PET VERDE', 50)], '2026-09-02')]
  };
  const s = saldos(datos, '2026-09-30');
  igual(s['PET CRISTAL'], { 'SELECCIÓN': 800 }, 'PET CRISTAL');
  igual(s['PET ETIQUETA'], { 'SELECCIÓN': 150 }, 'PET ETIQUETA');
  igual(s['PET VERDE'], { 'SELECCIÓN': 50 }, 'PET VERDE');
  igual(celda(s, 'CRISTAL CON ETIQUETA', 'RECEPCIÓN'), 0, 'RECEPCIÓN en cero');
  afirmar(!('RECEPCIÓN' in (s['CRISTAL CON ETIQUETA'] || {})), 'la celda en cero se omite');
  cuadra(datos, '2026-09-30');
});

caso('Un proceso posterior a la fecha de corte no cuenta', () => {
  const datos = {
    registrosDestaraje: [compra('CRISTAL CON ETIQUETA', 1000, '2026-09-01')],
    registrosControlProduccion: [proceso('SELECCION', [inp('CRISTAL CON ETIQUETA', 1000)], [out('PET CRISTAL', 800), out('PET ETIQUETA', 200)], '2026-09-10')]
  };
  const antes = saldos(datos, '2026-09-09');
  igual(antes['CRISTAL CON ETIQUETA'], { 'RECEPCIÓN': 1000 }, 'antes del proceso');
  igual(antes['PET CRISTAL'], undefined, 'sin salidas todavía');
  const eseDia = saldos(datos, '2026-09-10');
  igual(eseDia['PET CRISTAL'], { 'SELECCIÓN': 800 }, 'el corte incluye el día del proceso');
  cuadra(datos, '2026-09-09');
  cuadra(datos, '2026-09-10');
});

caso('Excluir el registro que se edita devuelve el saldo previo a ese registro', () => {
  const seleccion = proceso('SELECCION', [inp('CRISTAL CON ETIQUETA', 1000)], [out('PET CRISTAL', 800), out('PET ETIQUETA', 200)], '2026-09-02');
  const datos = { registrosDestaraje: [compra('CRISTAL CON ETIQUETA', 1000, '2026-09-01')], registrosControlProduccion: [seleccion] };
  const s = saldos(datos, '2026-09-30', { controlProduccionId: seleccion.id });
  igual(s['CRISTAL CON ETIQUETA'], { 'RECEPCIÓN': 1000 }, 'RECEPCIÓN vuelve a 1000');
  igual(s['PET CRISTAL'], undefined, 'sus salidas tampoco cuentan');
  cuadra(datos, '2026-09-30', { controlProduccionId: seleccion.id });
});

caso('El consumo se reparte entre las etapas de origen (K18) y la suma sigue cuadrando', () => {
  const datos = {
    inventarioInicial: [inicial('P.E.', 'SELECCIÓN', 100), inicial('RECHAZO TAMBOS', 'SOPLADO', 40)],
    registrosControlProduccion: [
      proceso('MOLIENDA', [inp('P.E.', 60)], [out('P.E. MOLIDO', 58), out('LODOS', 2, true)], '2026-09-01'),
      proceso('MOLIENDA', [inp('RECHAZO TAMBOS', 40)], [out('P.E. MOLIDO', 39)], '2026-09-02')
    ]
  };
  const s = saldos(datos, '2026-09-30');
  igual(s['P.E.'], { 'SELECCIÓN': 40 }, 'P.E. en SELECCIÓN');
  igual(s['P.E. MOLIDO'], { 'MOLIENDA': 97 }, 'P.E. MOLIDO en MOLIENDA (la merma no genera saldo)');
  igual(s['RECHAZO TAMBOS'], undefined, 'el rechazo se consumió de SOPLADO');
  cuadra(datos, '2026-09-30');
});

caso('Un material con saldo en varias etapas las trae todas', () => {
  const datos = { inventarioInicial: [inicial('P.E. MOLIDO', 'MOLIENDA', 50), inicial('P.E. MOLIDO', 'RECEPCIÓN', 100), inicial('P.E. MOLIDO', 'LAVADO', 25)] };
  igual(saldos(datos, '2026-09-30')['P.E. MOLIDO'], { 'RECEPCIÓN': 100, 'MOLIENDA': 50, 'LAVADO': 25 }, 'tres etapas');
  cuadra(datos, '2026-09-30');
});

caso('VENDIDO no aparece y la venta descuenta de la etapa con saldo', () => {
  const datos = {
    registrosDestaraje: [compra('LECHERO', 500, '2026-09-01')],
    ventas: [venta('LECHERO', 200, '2026-09-05')]
  };
  const s = saldos(datos, '2026-09-30');
  igual(s['LECHERO'], { 'RECEPCIÓN': 300 }, 'saldo tras la venta');
  afirmar(Object.values(s).every((etapas) => !('VENDIDO' in etapas)), 'VENDIDO no se incluye');
  cuadra(datos, '2026-09-30');
  igual(saldos(datos, '2026-09-04')['LECHERO'], { 'RECEPCIÓN': 500 }, 'antes de la venta');
  const sinVenta = saldos(datos, '2026-09-30', { ventaId: datos.ventas[0].id });
  igual(sinVenta['LECHERO'], { 'RECEPCIÓN': 500 }, 'excluir la venta que se edita');
});

caso('Un faltante de origen deja la celda negativa y el total cuadra', () => {
  const datos = {
    registrosDestaraje: [compra('LECHERO', 100, '2026-09-01')],
    registrosControlProduccion: [proceso('EMPACADO', [inp('LECHERO', 30)], [out('LECHERO', 30)], '2026-09-02')]
  };
  const s = saldos(datos, '2026-09-30');
  igual(s['LECHERO'], { 'RECEPCIÓN': 100, 'SELECCIÓN': -30, 'EMPACADO': 30 }, 'faltante en SELECCIÓN (origen de EMPACADO)');
  cuadra(datos, '2026-09-30');
});

caso('Fechas con hora y varios procesos el mismo día cuadran con el saldo disponible', () => {
  const datos = {
    registrosDestaraje: [compra('P.E.', 1000, '2026-09-01')],
    registrosControlProduccion: [
      { ...proceso('SELECCION', [inp('P.E.', 1000)], [out('P.E.', 900)], '2026-09-03'), fecha: undefined, fechaFin: '2026-09-03T16:00' },
      proceso('EMPACADO', [inp('P.E.', 400)], [out('P.E.', 400)], '2026-09-03')
    ]
  };
  const s = saldos(datos, '2026-09-03T08:00');
  igual(s['P.E.'], { 'SELECCIÓN': 500, 'EMPACADO': 400 }, 'el corte es por día');
  cuadra(datos, '2026-09-03T08:00');
  cuadra(datos, '2026-12-31');
});

caso('No modifica los datos y exporta ORIGEN_POR_PROCESO', () => {
  const datos = {
    ...VACIO,
    registrosDestaraje: [compra('LECHERO', 100, '2026-09-01')],
    registrosControlProduccion: [proceso('SELECCION', [inp('LECHERO', 100)], [out('LECHERO', 90)], '2026-09-02')]
  };
  const antes = JSON.stringify(datos);
  INV.calcularSaldosPorEtapaEnFecha(datos, '2026-09-30', { controlProduccionId: datos.registrosControlProduccion[0].id });
  igual(JSON.stringify(datos), antes, 'datos intactos');
  igual(INV.ORIGEN_POR_PROCESO.MOLIENDA, ['SELECCIÓN', 'INYECCIÓN', 'SOPLADO'], 'ORIGEN_POR_PROCESO exportado');
  igual(saldos({}, '2026-09-30'), {}, 'sin datos');
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
