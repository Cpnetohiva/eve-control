// K2 — Verificación del orden de eventos dentro del día y del corte por fecha del inventario.
//
// Carga en un contexto vm js/config.js, js/utils.js, js/inventario.js y js/ventas.js y ejecuta casos
// sintéticos sobre window.EVE_INVENTARIO, window.fechaProceso y la validación de Ventas (K13).
//
// Uso: node scripts/verificar-inventario-orden.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js', 'js/ventas.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout,
    document: {},
    // Ventas pide confirmación cuando falta stock: el arnés la cuenta y responde según `respuestaConfirm`.
    confirm(mensaje) { sandbox.confirmaciones.push(mensaje); return sandbox.respuestaConfirm; },
    confirmaciones: [],
    respuestaConfirm: true,
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

// ── K13: Ventas con lista cerrada y validación de stock coherente con el orden del ledger ──

function verificarVenta(datos, ventaNueva, excluirId) {
  w.confirmaciones.length = 0;
  w.EVE = { inventarioInicial: [], registrosDestaraje: [], registrosControlProduccion: [], ventas: [], ...datos };
  const resultado = w.verificarStockSuficienteVenta(ventaNueva, excluirId);
  return { resultado, avisos: w.confirmaciones.length };
}
const lineaVenta = (material, cantidad, unidad) => ({ material, cantidad, unidad: unidad || 'KG' });

caso('K13: una venta del mismo día que la producción NO avisa de falta de stock', () => {
  const datos = {
    registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-14')],
    registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000 }], [{ material: 'PET CRISTAL', kg: 800, esMerma: false }], { fecha: '2026-09-14' })]
  };
  const r = verificarVenta(datos, { fecha: '2026-09-14', lineas: [lineaVenta('PET CRISTAL', 500)] });
  igual(r, { resultado: true, avisos: 0 }, 'venta de 500 de PET CRISTAL el mismo día de su producción (800)');
});

caso('K13: una venta ANTERIOR a la producción sí avisa; si el usuario no confirma, no continúa', () => {
  const datos = {
    registrosDestaraje: [recepcion(1, 'MIXTO', 1000, '2026-09-10')],
    registrosControlProduccion: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000 }], [{ material: 'PET CRISTAL', kg: 800, esMerma: false }], { fecha: '2026-09-14' })]
  };
  w.respuestaConfirm = false;
  const r = verificarVenta(datos, { fecha: '2026-09-13', lineas: [lineaVenta('PET CRISTAL', 500)] });
  w.respuestaConfirm = true;
  igual(r, { resultado: false, avisos: 1 }, 'avisa una vez y devuelve false si no se confirma');
  const r2 = verificarVenta(datos, { fecha: '2026-09-13', lineas: [lineaVenta('PET CRISTAL', 500)] });
  igual(r2, { resultado: true, avisos: 1 }, 'si se confirma, continúa (no bloquea)');
});

caso('K13: el aviso usa el material normalizado (alias y minúsculas) y la fecha de la venta', () => {
  const datos = { inventarioInicial: [{ material: 'P.P MOLIDO', etapa: 'RECEPCIÓN', kg: 100, fecha: '2026-09-01' }] };
  igual(verificarVenta(datos, { fecha: '2026-09-14', lineas: [lineaVenta('p.p. molido', 80)] }), { resultado: true, avisos: 0 }, "stock guardado como 'P.P MOLIDO' alcanza para 'p.p. molido'");
  igual(verificarVenta(datos, { fecha: '2026-08-31', lineas: [lineaVenta('P.P. MOLIDO', 80)] }).avisos, 1, 'una venta anterior al inventario inicial sí avisa');
  igual(verificarVenta(datos, { fecha: '2026-09-14', lineas: [lineaVenta('P.P. MOLIDO', 80), lineaVenta('P.P. MOLIDO', 80)] }).avisos, 1, 'dos líneas del mismo material comparten saldo: la segunda avisa');
});

caso('K13: editar una venta no cuenta su propia versión guardada', () => {
  const datos = {
    inventarioInicial: [{ material: 'LECHERO', etapa: 'RECEPCIÓN', kg: 100, fecha: '2026-09-01' }],
    ventas: [venta('V-001', 'LECHERO', 100, '2026-09-14')]
  };
  igual(verificarVenta(datos, { fecha: '2026-09-14', lineas: [lineaVenta('LECHERO', 100)] }, 'vV-001'), { resultado: true, avisos: 0 }, 'editar V-001 con la misma cantidad no avisa');
});

caso('K13: las líneas de venta solo aceptan materiales del catálogo', () => {
  const construir = (material) => w.construirLineasDesdeFormulario([{ material, cantidad: 10, precioUnitario: 5 }], false);
  igual(construir('LECHERO')[0].material, 'LECHERO', 'LECHERO aceptado');
  igual(construir('polietileno')[0].material, 'P.E.', 'alias POLIETILENO normalizado a P.E.');
  igual(construir('RECHAZO TAMBOS')[0].unidad, 'KG', 'los rechazos se pueden vender (materialesConStock)');
  igual(construir('ORING')[0].unidad, 'PZ', 'ORING en piezas');
  let mensaje = '';
  try { construir('LLANTA'); } catch (error) { mensaje = error.message; }
  igual(mensaje, "Material 'LLANTA' no está en el catálogo", 'LLANTA rechazada con mensaje claro');
  mensaje = '';
  try { construir('XYZ INVENTADO'); } catch (error) { mensaje = error.message; }
  igual(mensaje, "Material 'XYZ INVENTADO' no está en el catálogo", 'nombre libre rechazado');
});

// ── K14: etapa informativa, totales separados kg/pz e inventario inicial del catálogo ──

caso('K14: ya no existe la distinción Listo venta / En proceso / Pendiente', () => {
  igual(['ETAPAS_FINALES', 'ETAPAS_EN_PROCESO', 'estadoInventario'].filter((k) => k in INV), [], 'APIs retiradas');
  const filas = [
    { material: 'LECHERO', etapa: 'RECEPCIÓN', cantidadReal: 100 },
    { material: 'LECHERO', etapa: 'EMPACADO', cantidadReal: 50 },
    { material: 'LECHERO', etapa: 'MOLIENDA', cantidadReal: 25 }
  ];
  igual(Object.keys(INV.resumenInventario(filas)).sort(), ['totalKg', 'totalPiezas'], 'el resumen solo trae totales (kg y piezas)');
  igual(INV.resumenInventario(filas).totalKg, 175, 'el total en planta suma todas las etapas');
});

caso('K14: el total en planta excluye VENDIDO y no suma piezas con kg', () => {
  const filas = [
    { material: 'LECHERO', etapa: 'RECEPCIÓN', cantidadReal: 100 },
    { material: 'LECHERO', etapa: 'VENDIDO', cantidadReal: 40 },
    { material: 'TAMBO', etapa: 'SOPLADO', cantidadReal: 30 },
    { material: 'CAJA CO30', etapa: 'INYECCIÓN', cantidadReal: 12 }
  ];
  igual(INV.resumenInventario(filas), { totalKg: 100, totalPiezas: 42 }, '100 kg y 42 piezas por separado, sin VENDIDO');
});

caso('K14: la matriz lleva la unidad de cada material y su total no mezcla unidades', () => {
  const filas = [
    { material: 'LECHERO', etapa: 'RECEPCIÓN', cantidadReal: 100 },
    { material: 'TAMBO', etapa: 'SOPLADO', cantidadReal: 30 }
  ];
  const matriz = INV.construirMatrizInventario(filas);
  igual(matriz.map((m) => [m.material, m.unidad, m.totalPlanta]), [['LECHERO', 'KG', 100], ['TAMBO', 'PZ', 30]], 'unidad y total por material');
});

caso('K14: inventario inicial solo acepta nombres del catálogo', () => {
  const crear = (material, existentes) => INV.construirRegistroInventarioInicial({ material, etapa: 'RECEPCIÓN', kg: 10, fecha: '2026-09-01' }, existentes);
  igual(crear('lechero').material, 'LECHERO', 'minúsculas se normalizan');
  igual(crear('P.P MOLIDO').material, 'P.P. MOLIDO', 'nombre anterior se normaliza por alias');
  igual(crear('RECHAZO TAMBOS').material, 'RECHAZO TAMBOS', 'los rechazos se pueden cargar (materialesConStock)');
  igual(crear('TAMBO').material, 'TAMBO', 'las piezas se pueden cargar');
  let mensaje = '';
  try { crear('LLANTA'); } catch (error) { mensaje = error.message; }
  igual(mensaje, "Material 'LLANTA' no está en el catálogo", 'LLANTA rechazada');
  mensaje = '';
  try { crear('Inventado'); } catch (error) { mensaje = error.message; }
  igual(mensaje, "Material 'INVENTADO' no está en el catálogo", 'nombre libre rechazado');
  mensaje = '';
  try { crear('P.P. MOLIDO', [{ material: 'P.P MOLIDO', etapa: 'RECEPCIÓN' }]); } catch (error) { mensaje = error.message; }
  igual(mensaje, 'Ya existe un Inventario Inicial para este Material + Etapa', 'un inicial guardado con el nombre anterior cuenta como duplicado');
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
