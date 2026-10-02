// K21d — Verificación del ticketOrigen automático (EVE_CP_REGLAS.resolverTicketOrigen).
//
// Carga en un contexto vm js/config.js, js/utils.js, js/inventario.js, js/control-produccion-reglas.js y
// js/trazabilidad.js. La regla (v1, aproximada: no hay FIFO ni lotes): el último ticket que produjo ese material en la
// etapa de origen. Un ticket de Báscula puede traer renglones de materiales distintos, así que el origen se resuelve por
// la pareja ticket + material.
//
// Uso: node scripts/verificar-ticket-origen.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js', 'js/control-produccion-reglas.js', 'js/trazabilidad.js'];

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
const R = w.EVE_CP_REGLAS;
const INV = w.EVE_INVENTARIO;

const VACIO = { inventarioInicial: [], registrosDestaraje: [], registrosControlProduccion: [], ventas: [] };
const renglon = (ticket, material, kg, fecha) => ({ id: `d${ticket}-${material}-${kg}`, ticket: String(ticket), material, kg, fechaSalida: fecha, fechaEntrada: fecha });
const inp = (material, kg, ticketOrigen) => ({ material, kg, ticketOrigen });
const out = (material, kg, esMerma) => ({ material, kg, esMerma: !!esMerma });
const proceso = (numero, tipoProceso, inputs, outputs, fecha) => ({ id: `p${numero}`, ticket: `P-${String(numero).padStart(3, '0')}`, tipoProceso, inputs, outputs, fecha });
const origen = (material, datos, fecha, exclusiones) => {
  const etapas = INV.etapasOrigen(datos.proceso, material);
  return R.resolverTicketOrigen(material, etapas, fecha, { ...VACIO, ...datos.datos }, exclusiones);
};
const resolver = (proceso, material, datos, fecha, exclusiones) => origen(material, { proceso, datos }, fecha, exclusiones);

// ── Báscula (RECEPCIÓN) ──────────────────────────────────────────────────

caso('Material comprado en dos tickets de Báscula: el más reciente', () => {
  const datos = { registrosDestaraje: [renglon(10, 'CRISTAL CON ETIQUETA', 500, '2026-09-01'), renglon(11, 'CRISTAL CON ETIQUETA', 400, '2026-09-05')] };
  igual(resolver('SELECCION', 'CRISTAL CON ETIQUETA', datos, '2026-09-10'), { ticket: '11', inferido: true }, 'ticket más reciente');
  igual(resolver('SELECCION', 'CRISTAL CON ETIQUETA', datos, '2026-09-03'), { ticket: '10', inferido: true }, 'a una fecha anterior solo existe el primero');
});

caso('Mismo día: gana el número de ticket mayor, comparado como número', () => {
  const datos = { registrosDestaraje: [renglon(9, 'P.E.', 100, '2026-09-05'), renglon(100, 'P.E.', 100, '2026-09-05'), renglon(20, 'P.E.', 100, '2026-09-05')] };
  igual(resolver('SELECCION', 'P.E.', datos, '2026-09-05'), { ticket: '100', inferido: true }, '100 > 20 > 9');
});

caso('Ticket de Báscula con varios renglones: el origen es la pareja ticket + material', () => {
  // Como el ticket 1066: dos renglones de P.P. MOLIDO y uno de BIDON.
  const datos = {
    registrosDestaraje: [
      renglon(1066, 'P.P. MOLIDO', 300, '2026-09-08'),
      renglon(1066, 'BIDON', 120, '2026-09-08'),
      renglon(1066, 'P.P. MOLIDO', 200, '2026-09-08')
    ]
  };
  igual(resolver('PELETIZADO', 'P.P. MOLIDO', datos, '2026-09-10'), { ticket: '1066', inferido: true }, 'dos renglones del mismo material = un solo origen');
  igual(resolver('SELECCION', 'BIDON', datos, '2026-09-10'), { ticket: '1066', inferido: true }, 'el renglón de otro material del mismo ticket');
  datos.registrosDestaraje.push(renglon(1070, 'BIDON', 80, '2026-09-09'));
  igual(resolver('SELECCION', 'BIDON', datos, '2026-09-10'), { ticket: '1070', inferido: true }, 'BIDON: el ticket más reciente de ese material');
  igual(resolver('PELETIZADO', 'P.P. MOLIDO', datos, '2026-09-10'), { ticket: '1066', inferido: true }, 'P.P. MOLIDO no se mezcla con el ticket de BIDON');
});

caso('Compara el material por su nombre normalizado (alias)', () => {
  const datos = { registrosDestaraje: [renglon(7, 'P.P MOLIDO', 100, '2026-09-01')] };
  igual(resolver('PELETIZADO', 'P.P. MOLIDO', datos, '2026-09-02'), { ticket: '7', inferido: true }, 'guardado con el nombre anterior');
});

// ── Procesos (etapas intermedias) ────────────────────────────────────────

caso('Salida de una Selección usada en un Empacado: el P-### de la Selección', () => {
  const seleccion = proceso(5, 'SELECCION', [inp('CRISTAL CON ETIQUETA', 1000, '10')], [out('PET CRISTAL', 800), out('PET ETIQUETA', 150), out('BASURA', 50, true)], '2026-09-02');
  const datos = { registrosDestaraje: [renglon(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01')], registrosControlProduccion: [seleccion] };
  igual(resolver('EMPACADO', 'PET CRISTAL', datos, '2026-09-03'), { ticket: 'P-005', inferido: true }, 'PET CRISTAL');
  igual(resolver('EMPACADO', 'PET ETIQUETA', datos, '2026-09-03'), { ticket: 'P-005', inferido: true }, 'PET ETIQUETA');
  // El ticket resuelto cumple inputCoincideConTicket: el input queda enlazado en la trazabilidad.
  const empacado = proceso(6, 'EMPACADO', [inp('PET CRISTAL', 400, 'P-005')], [out('PET CRISTAL', 400)], '2026-09-03');
  const alcance = w.EVE_TRAZABILIDAD.recolectarAlcanzables('P-005', { registrosDestaraje: datos.registrosDestaraje, registrosVentas: [], ventas: [], registrosControlProduccion: [seleccion, empacado] });
  afirmar(alcance.procesos.has('P-006'), 'el Empacado con ticketOrigen P-005 es alcanzable desde la Selección');
});

caso('El último proceso que produjo el material en la etapa: por día y luego por número', () => {
  const datos = {
    registrosControlProduccion: [
      proceso(1, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 90)], '2026-09-01'),
      proceso(12, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 90)], '2026-09-02'),
      proceso(3, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 90)], '2026-09-02')
    ]
  };
  igual(resolver('EMPACADO', 'P.E.', datos, '2026-09-05'), { ticket: 'P-012', inferido: true }, 'P-012 > P-003 el mismo día');
  igual(resolver('EMPACADO', 'P.E.', datos, '2026-09-01'), { ticket: 'P-001', inferido: true }, 'a una fecha anterior');
});

caso('Solo cuentan las salidas que no son merma, con kg, de esa etapa y hasta la fecha', () => {
  const datos = {
    registrosControlProduccion: [
      proceso(1, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 90)], '2026-09-01'),
      proceso(2, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 10, true)], '2026-09-02'),
      proceso(3, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 0)], '2026-09-02'),
      proceso(4, 'MOLIENDA', [inp('P.E.', 100)], [out('P.E.', 90)], '2026-09-02'),
      proceso(5, 'SELECCION', [inp('P.E.', 100)], [out('P.E.', 90)], '2026-09-20')
    ]
  };
  igual(resolver('EMPACADO', 'P.E.', datos, '2026-09-10'), { ticket: 'P-001', inferido: true }, 'ni merma, ni kg en cero, ni otra etapa, ni futuro');
});

caso('Varias etapas de origen: se toma la de más saldo', () => {
  const molienda = proceso(2, 'MOLIENDA', [inp('P.E.', 100)], [out('P.E. MOLIDO', 50)], '2026-09-02');
  const base = { registrosDestaraje: [renglon(30, 'P.E. MOLIDO', 100, '2026-09-01')], registrosControlProduccion: [molienda] };
  // Un molido (requiereSeleccion=false) toma de MOLIENDA y de RECEPCIÓN en Lavado y Peletizado: MOLIENDA 50, RECEPCIÓN 100.
  igual(resolver('LAVADO', 'P.E. MOLIDO', base, '2026-09-03'), { ticket: '30', inferido: true }, 'Lavado: RECEPCIÓN tiene más saldo');
  igual(resolver('PELETIZADO', 'P.E. MOLIDO', base, '2026-09-03'), { ticket: '30', inferido: true }, 'Peletizado: RECEPCIÓN tiene más saldo');
  const sinCompra = { registrosControlProduccion: [molienda] };
  igual(resolver('LAVADO', 'P.E. MOLIDO', sinCompra, '2026-09-03'), { ticket: 'P-002', inferido: true }, 'sin compra solo hay MOLIENDA');
  const masMolienda = { ...base, registrosControlProduccion: [{ ...molienda, outputs: [out('P.E. MOLIDO', 300)] }] };
  igual(resolver('PELETIZADO', 'P.E. MOLIDO', masMolienda, '2026-09-03'), { ticket: 'P-002', inferido: true }, 'MOLIENDA tiene más saldo');
});

caso('Peletizado con varios inputs: cada uno resuelve su propio origen', () => {
  const datos = {
    registrosDestaraje: [renglon(40, 'P.P. MOLIDO', 200, '2026-09-01')],
    registrosControlProduccion: [proceso(8, 'MOLIENDA', [inp('P.E.', 300)], [out('P.E. MOLIDO', 280)], '2026-09-02')]
  };
  igual(resolver('PELETIZADO', 'P.E. MOLIDO', datos, '2026-09-05'), { ticket: 'P-008', inferido: true }, 'molido de la Molienda');
  igual(resolver('PELETIZADO', 'P.P. MOLIDO', datos, '2026-09-05'), { ticket: '40', inferido: true }, 'molido comprado');
});

caso('Excluir el registro que se edita: no se enlaza consigo mismo', () => {
  const seleccion = proceso(5, 'SELECCION', [inp('CRISTAL CON ETIQUETA', 1000, '10')], [out('PET CRISTAL', 1000)], '2026-09-02');
  const datos = { registrosDestaraje: [renglon(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01')], registrosControlProduccion: [seleccion] };
  igual(resolver('EMPACADO', 'PET CRISTAL', datos, '2026-09-03', { controlProduccionId: seleccion.id }), null, 'sin el registro excluido no hay origen');
  igual(resolver('SELECCION', 'CRISTAL CON ETIQUETA', datos, '2026-09-03', { controlProduccionId: seleccion.id }), { ticket: '10', inferido: true }, 'el origen de Báscula se conserva');
});

// ── Sin candidatos y entradas inválidas ──────────────────────────────────

caso('Sin candidatos devuelve null', () => {
  igual(resolver('EMPACADO', 'PET CRISTAL', {}, '2026-09-03'), null, 'sin datos');
  const datos = { registrosDestaraje: [renglon(10, 'CRISTAL CON ETIQUETA', 100, '2026-09-20')] };
  igual(resolver('SELECCION', 'CRISTAL CON ETIQUETA', datos, '2026-09-03'), null, 'la compra es posterior a la fecha');
  const soloInicial = { inventarioInicial: [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 100, fecha: '2026-01-01' }] };
  igual(resolver('EMPACADO', 'P.E.', soloInicial, '2026-09-03'), null, 'el inventario inicial no tiene ticket');
  igual(R.resolverTicketOrigen('', ['RECEPCIÓN'], '2026-09-03', VACIO), null, 'sin material');
  igual(R.resolverTicketOrigen('P.E.', [], '2026-09-03', VACIO), null, 'sin etapas de origen');
  igual(R.resolverTicketOrigen('P.E.', ['RECEPCIÓN'], '', VACIO), null, 'sin fecha');
  igual(resolver('SELECCION', 'P.E. MOLIDO', { registrosDestaraje: [renglon(10, 'P.E. MOLIDO', 100, '2026-09-01')] }, '2026-09-03'), null, 'un material que no se selecciona no tiene origen en Selección');
});

caso('No modifica los datos y siempre marca el origen como inferido', () => {
  const datos = {
    ...VACIO,
    registrosDestaraje: [renglon(10, 'P.E.', 100, '2026-09-01')],
    registrosControlProduccion: [proceso(1, 'SELECCION', [inp('P.E.', 100, '10')], [out('P.E.', 90)], '2026-09-02')]
  };
  const antes = JSON.stringify(datos);
  const resultado = R.resolverTicketOrigen('P.E.', ['SELECCIÓN'], '2026-09-05', datos);
  igual(JSON.stringify(datos), antes, 'datos intactos');
  igual(resultado.inferido, true, 'inferido');
  igual(typeof resultado.ticket, 'string', 'el ticket es texto');
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
