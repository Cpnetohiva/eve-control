// K2 — Verificación del orden de eventos dentro del día y del corte por fecha del inventario.
//
// Carga en un contexto vm js/config.js, js/utils.js y js/inventario.js y ejecuta casos sintéticos
// sobre window.EVE_INVENTARIO y window.fechaProceso.
//
// Uso: node scripts/verificar-inventario-orden.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout,
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

const w = crearContexto();
const INV = w.EVE_INVENTARIO;

// ── Helpers de datos ─────────────────────────────────────────────────────

const recepcion = (ticket, material, kg, fecha) => ({ id: `d${ticket}`, ticket: String(ticket), material, kg, fechaSalida: fecha, fechaEntrada: fecha });
const proceso = (ticket, tipoProceso, inputs, outputs, extra) => ({ id: `p${ticket}`, ticket, tipoProceso, inputs, outputs, ...extra });
const venta = (folio, material, kg, fecha) => ({ id: `v${folio}`, folio, fecha, lineas: [{ material, cantidad: kg }] });

function ledgerDe(datos) {
  return INV.procesarEventos(INV.construirEventos({ inventarioInicial: [], registrosDestaraje: [], registrosControlProduccion: [], ventas: [], ...datos }));
}

function celdasNegativas(ledger) {
  const negativas = [];
  Object.keys(ledger).forEach((material) => {
    Object.keys(ledger[material]).forEach((etapa) => {
      if (ledger[material][etapa] < -1e-6) negativas.push(`${material}/${etapa}=${ledger[material][etapa]}`);
    });
  });
  return negativas;
}

function ordenProcesos(datos) {
  return INV.construirEventos({ registrosControlProduccion: [], ...datos }).filter((e) => e.tipo === 'proceso').map((e) => e.ticket);
}

// ── Mini arnés de pruebas ────────────────────────────────────────────────

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

// ── fechaProceso ─────────────────────────────────────────────────────────

caso('fechaProceso: usa `fecha` si existe, si no recorta fechaFin a 10 caracteres', () => {
  igual(w.fechaProceso({ fecha: '2026-09-14' }), '2026-09-14', 'registro con fecha');
  igual(w.fechaProceso({ fecha: '2026-09-14', fechaFin: '2026-09-20T10:00' }), '2026-09-14', '`fecha` tiene prioridad');
  igual(w.fechaProceso({ fechaFin: '2026-09-14T10:00' }), '2026-09-14', 'registro antiguo con hora');
  igual(w.fechaProceso({ fechaFin: '2026-09-14' }), '2026-09-14', 'registro antiguo sin hora');
  igual(w.fechaProceso({}), '', 'sin fechas');
});

// ── Caso 1: producir y vender el mismo día ───────────────────────────────

const SELECCION_PET = [{ material: 'PET CRISTAL', kg: 800, esMerma: false }, { material: 'PET ETIQUETA', kg: 200, esMerma: false }];

for (const [etiqueta, extra] of [
  ['proceso con hora en fechaFin', { fechaInicio: '2026-09-14T08:00', fechaFin: '2026-09-14T10:00' }],
  ['proceso con fechaFin sin hora', { fechaFin: '2026-09-14' }],
  ['proceso con `fecha` (sin horas)', { fecha: '2026-09-14' }]
]) {
  caso(`Mismo día: producir y vender no da saldo negativo (${etiqueta})`, () => {
    const datos = {
      registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-14')],
      registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000 }], SELECCION_PET, extra)],
      ventas: [venta('V-001', 'PET CRISTAL', 800, '2026-09-14')]
    };
    const ledger = ledgerDe(datos);
    igual(celdasNegativas(ledger), [], 'celdas negativas');
    igual(Math.round(ledger['PET CRISTAL'].VENDIDO), 800, 'vendido');
    igual(Math.round(ledger['PET CRISTAL']['SELECCIÓN']), 0, 'saldo de PET CRISTAL en SELECCIÓN');
    // El saldo disponible a la fecha de la venta (sin contar la propia venta) alcanza para vender.
    const saldo = INV.calcularSaldoDisponibleEnFecha(datos, 'PET CRISTAL', '2026-09-14', { ventaId: 'vV-001' });
    igual(saldo, 800, 'saldo disponible al momento de la venta');
    igual(INV.calcularAdvertenciasStock(datos, [{ material: 'PET CRISTAL', kg: 800 }], '2026-09-14', { ventaId: 'vV-001' }), [], 'sin advertencia de stock');
  });
}

caso('Orden dentro del día: inicial, recepción, proceso y venta (aunque se construyan en otro orden)', () => {
  const eventos = INV.construirEventos({
    inventarioInicial: [{ material: 'P.E.', etapa: 'RECEPCIÓN', kg: 50, fecha: '2026-09-14' }],
    registrosDestaraje: [recepcion(5, 'P.E.', 100, '2026-09-14')],
    registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'P.E.', kg: 10 }], [{ material: 'P.E.', kg: 10, esMerma: false }], { fechaFin: '2026-09-14T09:00' })],
    ventas: [venta('V-001', 'P.E.', 5, '2026-09-14')]
  });
  igual(eventos.map((e) => `${e.rango}:${e.tipo}`), ['0:inicial', '1:recepcion', '2:proceso', '3:venta'], 'rangos');
  const dias = INV.construirEventos({
    registrosDestaraje: [recepcion(2, 'P.E.', 1, '2026-09-15'), recepcion(1, 'P.E.', 1, '2026-09-14')]
  });
  igual(dias.map((e) => e.fecha), ['2026-09-14', '2026-09-15'], 'días distintos ordenados por fecha');
});

// ── Caso 2: cadena de procesos del mismo día ─────────────────────────────

for (const [variante, fechas] of [
  ['con horas distintas', [{ fechaFin: '2026-09-14T10:00' }, { fechaFin: '2026-09-14T11:00' }]],
  ['con la misma hora', [{ fechaFin: '2026-09-14T10:00' }, { fechaFin: '2026-09-14T10:00' }]],
  ['sin horas (`fecha`)', [{ fecha: '2026-09-14' }, { fecha: '2026-09-14' }]]
]) {
  caso(`Cadena P-001→P-002 del mismo día (${variante}): el origen va primero aunque llegue después en el arreglo`, () => {
    const p1 = proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000 }], [{ material: 'PET CRISTAL', kg: 800, esMerma: false }], fechas[0]);
    const p2 = proceso('P-002', 'EMPACADO', [{ material: 'PET CRISTAL', kg: 800, ticketOrigen: 'P-001' }], [{ material: 'PET CRISTAL', kg: 800, esMerma: false }], fechas[1]);
    for (const [etiqueta, lista] of [['orden natural', [p1, p2]], ['orden invertido (id de Firestore)', [p2, p1]]]) {
      const datos = { registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-14')], registrosControlProduccion: lista };
      igual(ordenProcesos(datos), ['P-001', 'P-002'], `orden de procesos (${etiqueta})`);
      const ledger = ledgerDe(datos);
      igual(celdasNegativas(ledger), [], `celdas negativas (${etiqueta})`);
      igual(Math.round(ledger['PET CRISTAL'].EMPACADO), 800, `PET CRISTAL en EMPACADO (${etiqueta})`);
    }
  });
}

caso('Desempate: ticketOrigen manda sobre el número; entre independientes, P-### ascendente', () => {
  // P-003 consume lo que produce P-005 (mismo día): P-005 debe ir antes aunque su número sea mayor.
  const p5 = proceso('P-005', 'SELECCION', [{ material: 'MIXTO', kg: 100 }], [{ material: 'PET CRISTAL', kg: 80, esMerma: false }], { fecha: '2026-09-14' });
  const p3 = proceso('P-003', 'EMPACADO', [{ material: 'PET CRISTAL', kg: 80, ticketOrigen: 'P-005' }], [{ material: 'PET CRISTAL', kg: 80, esMerma: false }], { fecha: '2026-09-14' });
  const p4 = proceso('P-004', 'SELECCION', [{ material: 'P.E.', kg: 1 }], [{ material: 'P.E.', kg: 1, esMerma: false }], { fecha: '2026-09-14' });
  const p10 = proceso('P-010', 'SELECCION', [{ material: 'P.E.', kg: 1 }], [{ material: 'P.E.', kg: 1, esMerma: false }], { fecha: '2026-09-14' });
  const p9 = proceso('P-009', 'SELECCION', [{ material: 'P.E.', kg: 1 }], [{ material: 'P.E.', kg: 1, esMerma: false }], { fecha: '2026-09-14' });
  igual(ordenProcesos({ registrosControlProduccion: [p10, p3, p9, p5, p4] }), ['P-004', 'P-005', 'P-003', 'P-009', 'P-010'], 'orden');
  // Un ticketOrigen de OTRO día no altera el orden del día.
  const pOtroDia = proceso('P-001', 'SELECCION', [{ material: 'P.E.', kg: 1 }], [{ material: 'P.E.', kg: 1, esMerma: false }], { fecha: '2026-09-13' });
  const pHoy = proceso('P-002', 'LAVADO', [{ material: 'P.E.', kg: 1, ticketOrigen: 'P-001' }], [{ material: 'P.E.', kg: 1, esMerma: false }], { fecha: '2026-09-14' });
  igual(ordenProcesos({ registrosControlProduccion: [pHoy, pOtroDia] }), ['P-001', 'P-002'], 'procesos de días distintos');
});

caso('Desempate de recepciones por ticket numérico y de ventas por folio', () => {
  const datos = {
    registrosDestaraje: [recepcion(10, 'P.E.', 1, '2026-09-14'), recepcion(2, 'P.E.', 1, '2026-09-14'), recepcion(9, 'P.E.', 1, '2026-09-14')],
    ventas: [venta('V-010', 'P.E.', 1, '2026-09-14'), venta('V-002', 'P.E.', 1, '2026-09-14')]
  };
  const eventos = INV.construirEventos(datos);
  igual(eventos.filter((e) => e.tipo === 'recepcion').map((e) => e.ticket), ['2', '9', '10'], 'tickets de Báscula');
  igual(eventos.filter((e) => e.tipo === 'venta').map((e) => e.folio), ['V-002', 'V-010'], 'folios de venta');
});

caso('Los eventos que empatan en todo conservan el orden de construcción (sort estable)', () => {
  const datos = {
    inventarioInicial: [
      { material: 'A', etapa: 'RECEPCIÓN', kg: 1, fecha: '2026-09-14' },
      { material: 'B', etapa: 'RECEPCIÓN', kg: 1, fecha: '2026-09-14' },
      { material: 'C', etapa: 'RECEPCIÓN', kg: 1, fecha: '2026-09-14' }
    ]
  };
  igual(INV.construirEventos(datos).map((e) => e.material), ['A', 'B', 'C'], 'orden de inventario inicial');
});

// ── Caso 3: corte por fecha con registros que traen hora ─────────────────

caso('Corte por fecha: un proceso con hora (2026-09-14T10:00) entra en el corte del 2026-09-14', () => {
  const datos = {
    registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-14')],
    registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000 }], [{ material: 'PET CRISTAL', kg: 800, esMerma: false }], { fechaInicio: '2026-09-14T08:00', fechaFin: '2026-09-14T10:00' })]
  };
  igual(INV.calcularSaldoDisponibleEnFecha(datos, 'PET CRISTAL', '2026-09-14'), 800, 'saldo al cierre del día del proceso');
  igual(INV.calcularSaldoDisponibleEnFecha(datos, 'PET CRISTAL', '2026-09-13'), 0, 'saldo del día anterior');
  igual(INV.calcularSaldoDisponibleEnFecha(datos, 'MIXTO', '2026-09-14'), 0, 'el insumo ya se consumió ese día');
  // También si la fecha de corte trae hora: se comparan solo los primeros 10 caracteres.
  igual(INV.calcularSaldoDisponibleEnFecha(datos, 'PET CRISTAL', '2026-09-14T09:00'), 800, 'corte con hora');
  igual(INV.calcularSaldoDisponibleEnFecha(datos, 'PET CRISTAL', '2026-09-15'), 800, 'saldo del día siguiente');
});

caso('Corte por fecha: excluir el registro que se edita sigue funcionando', () => {
  const datos = {
    registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-14')],
    registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000 }], [{ material: 'PET CRISTAL', kg: 800, esMerma: false }], { fechaFin: '2026-09-14T10:00' })]
  };
  igual(INV.calcularSaldoDisponibleEnFecha(datos, 'MIXTO', '2026-09-14', { controlProduccionId: 'pP-001' }), 1000, 'sin contar el proceso editado');
});

caso('Compatibilidad: sin horas el resultado de un día sin conflictos no cambia', () => {
  const datos = {
    inventarioInicial: [{ material: 'P.E.', etapa: 'RECEPCIÓN', kg: 50, fecha: '2026-09-01' }],
    registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-10')],
    registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 400 }], [{ material: 'PET CRISTAL', kg: 300, esMerma: false }], { fechaFin: '2026-09-11' })],
    ventas: [venta('V-001', 'PET CRISTAL', 100, '2026-09-12')]
  };
  const ledger = ledgerDe(datos);
  igual(ledger['MIXTO']['RECEPCIÓN'], 600, 'MIXTO restante');
  igual(ledger['PET CRISTAL']['SELECCIÓN'], 200, 'PET CRISTAL restante');
  igual(ledger['PET CRISTAL'].VENDIDO, 100, 'vendido');
  igual(ledger['P.E.']['RECEPCIÓN'], 50, 'inventario inicial');
});

// ── Ejecución ────────────────────────────────────────────────────────────

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
