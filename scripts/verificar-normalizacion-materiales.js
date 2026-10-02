// K1 — Verificación de la normalización de nombres de material al comparar.
//
// Simula el escenario posterior a la tarea K8: el nombre oficial pasa a ser 'P.P. MOLIDO' con el
// alias 'P.P MOLIDO' → 'P.P. MOLIDO', pero los registros reales (tickets, precios, composiciones)
// siguen guardados con el nombre anterior. Todos deben seguir empatando sin reescribir datos.
//
// Uso: node scripts/verificar-normalizacion-materiales.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = [
  'js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/precios.js',
  'js/reportes.js', 'js/reportes-ui.js', 'js/pagos.js', 'js/trazabilidad.js', 'js/inventario.js', 'js/cxp.js', 'js/dashboard.js'
];

function crearContexto({ conAlias }) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosControlProduccion: [], composiciones: [], precios: [],
    ajustesPrecioProveedor: [], comisiones: [], ventas: [], registrosVentas: [], inventarioInicial: [],
    cuentasPorPagar: []
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  // Alias que agregará K8 (aquí simulado; el catálogo actual todavía no lo trae).
  if (conAlias) sandbox.window.MATERIALES_ALIAS['P.P MOLIDO'] = 'P.P. MOLIDO';
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
function cerca(real, esperado, mensaje) {
  afirmar(Math.abs(real - esperado) < 0.01, `${mensaje}: esperado ${esperado}, obtenido ${real}`);
}

// Tres precios REALES guardados como 'P.P MOLIDO' (cambios de precio de mercado): dos cerrados y uno abierto.
const PRECIOS_PP_MOLIDO = [
  { id: 'pr1', material: 'P.P MOLIDO', precio: 8, fechaInicio: '2026-08-01', fechaFin: '2026-08-31', notas: '' },
  { id: 'pr2', material: 'P.P MOLIDO', precio: 9, fechaInicio: '2026-09-01', fechaFin: '2026-09-20', notas: '' },
  { id: 'pr3', material: 'P.P MOLIDO', precio: 10, fechaInicio: '2026-09-21', fechaFin: null, notas: '' }
];

// ── Precios ──────────────────────────────────────────────────────────────

caso('Precios: obtenerPrecioVigente empata el nombre oficial con un precio guardado con el nombre anterior', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = PRECIOS_PP_MOLIDO.map((p) => ({ ...p }));
  igual(w.obtenerPrecioVigente('P.P. MOLIDO', '2026-09-25').precio, 10, 'precio vigente por nombre oficial');
  igual(w.obtenerPrecioVigente('P.P. MOLIDO', '2026-09-10').precio, 9, 'precio histórico por nombre oficial');
  igual(w.obtenerPrecioVigente('P.P MOLIDO', '2026-08-15').precio, 8, 'el nombre anterior sigue funcionando');
  igual(w.obtenerPrecioVigente('p.p. molido', '2026-09-25').precio, 10, 'sin distinguir mayúsculas');
});

caso('Precios: ajuste por proveedor guardado con el nombre anterior también empata', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = PRECIOS_PP_MOLIDO.map((p) => ({ ...p }));
  w.EVE.ajustesPrecioProveedor = [
    { id: 'aj1', material: 'P.P MOLIDO', proveedor: 'JESÚS', tipoAjuste: 'monto', valorAjuste: -1, fechaInicio: '2026-09-01', fechaFin: null }
  ];
  const precio = w.obtenerPrecioVigente('P.P. MOLIDO', '2026-09-25', 'JESÚS');
  igual(precio.precio, 9, 'precio con ajuste (10 - 1)');
  igual(precio.precioBase, 10, 'precio base');
});

caso('Precios: la vista de vigentes muestra UNA sola serie con el nombre normalizado', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = PRECIOS_PP_MOLIDO.map((p) => ({ ...p }));
  const vigentes = w.EVE_PRECIOS.precioVigentePorMaterial(w.EVE.precios, '2026-09-25');
  igual(vigentes.length, 1, 'una sola fila vigente');
  igual(vigentes[0].material, 'P.P. MOLIDO', 'nombre mostrado normalizado');
  igual(vigentes[0].precio, 10, 'precio de la versión abierta');
  igual(vigentes[0].id, 'pr3', 'conserva el id del documento');
  igual(w.EVE.precios[2].material, 'P.P MOLIDO', 'el documento guardado NO se modifica');
  igual(w.EVE_PRECIOS.materialesConPrecio(w.EVE.precios), ['P.P. MOLIDO'], 'materiales con precio (selector de historial)');
  const historial = w.EVE_PRECIOS.historialPorMaterial(w.EVE.precios, 'P.P. MOLIDO', '2026-09-25');
  igual(historial.map((h) => h.id), ['pr3', 'pr2', 'pr1'], 'el historial junta las 3 versiones');
  igual(w.EVE_PRECIOS.historialPorMaterial(w.EVE.precios, 'P.P MOLIDO', '2026-09-25').length, 3, 'también por el nombre anterior');
});

caso('Precios: un precio nuevo para el nombre oficial cierra la versión abierta guardada con el nombre anterior', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = PRECIOS_PP_MOLIDO.map((p) => ({ ...p }));
  const { cierre, nuevo } = w.EVE_PRECIOS.construirNuevoPrecio(
    { material: 'P.P. MOLIDO', precio: 11, fechaInicio: '2026-10-05', notas: '' }, w.EVE.precios);
  igual(cierre, { id: 'pr3', fechaFin: '2026-10-04' }, 'cierra pr3 el día anterior');
  igual(nuevo.material, 'P.P. MOLIDO', 'el nuevo se guarda con el nombre oficial');
  igual(nuevo.fechaFin, null, 'el nuevo queda abierto');
  // Aplicado el cierre, no deben quedar dos versiones abiertas.
  w.EVE.precios.find((p) => p.id === 'pr3').fechaFin = cierre.fechaFin;
  w.EVE.precios.push({ id: 'pr4', ...nuevo });
  igual(w.EVE.precios.filter((p) => p.fechaFin === null).length, 1, 'una sola versión abierta');
  igual(w.EVE_PRECIOS.precioVigenteAbiertoPorMaterial(w.EVE.precios, 'P.P. MOLIDO').id, 'pr4', 'la abierta es la nueva');
  // Un precio con la misma fecha de inicio que uno guardado con el nombre anterior se detecta.
  let error = null;
  try {
    w.EVE_PRECIOS.construirNuevoPrecio({ material: 'P.P. MOLIDO', precio: 12, fechaInicio: '2026-09-01' }, w.EVE.precios);
  } catch (e) { error = e; }
  afirmar(error && /Ya existe un precio/.test(error.message), 'debe detectar la coincidencia exacta con el nombre anterior');
});

caso('Precios: sin alias y con nombres ya normalizados el resultado es idéntico', () => {
  const w = crearContexto({ conAlias: false });
  const precios = [
    { id: 'a', material: 'P.E.', precio: 7, fechaInicio: '2026-08-01', fechaFin: null, notas: 'x' },
    { id: 'b', material: 'LECHERO', precio: 12, fechaInicio: '2026-08-01', fechaFin: null, notas: '' }
  ];
  igual(w.EVE_PRECIOS.precioVigentePorMaterial(precios, '2026-09-01'), [
    { id: 'b', material: 'LECHERO', precio: 12, fechaInicio: '2026-08-01', fechaFin: null, notas: '' },
    { id: 'a', material: 'P.E.', precio: 7, fechaInicio: '2026-08-01', fechaFin: null, notas: 'x' }
  ], 'vigentes idénticos');
  w.EVE.precios = precios;
  igual(w.obtenerPrecioVigente('P.E.', '2026-09-01').precio, 7, 'obtenerPrecioVigente');
});

// ── Composiciones y reportes ─────────────────────────────────────────────

caso('Composiciones: la guardada con el nombre anterior empata con el nombre oficial (y viceversa)', () => {
  const w = crearContexto({ conAlias: true });
  const comp = (id, material) => ({
    id, materialEntrada: material, version: 1, fechaVigencia: '2026-08-01', fechaCierre: null,
    componentes: [{ subproducto: 'P.P. MOLIDO', porcentaje: 100, esMerma: false }], totalPorcentaje: 100
  });
  w.EVE.composiciones = [comp('c1', 'P.P MOLIDO')];
  igual(w.obtenerComposicionVigente('P.P. MOLIDO', '2026-09-01').id, 'c1', 'oficial → guardada con nombre anterior');
  igual(w.EVE_RENDIMIENTOS.composicionVigenteAbiertaPorMaterial(w.EVE.composiciones, 'P.P. MOLIDO').id, 'c1', 'versión abierta');
  igual(w.EVE_RENDIMIENTOS.historialPorMaterial(w.EVE.composiciones, 'P.P. MOLIDO', '2026-09-01').length, 1, 'historial');
  igual(w.EVE_RENDIMIENTOS.materialesConComposicion(w.EVE.composiciones), ['P.P. MOLIDO'], 'materiales con composición');
  w.EVE.composiciones = [comp('c2', 'P.P. MOLIDO')];
  igual(w.obtenerComposicionVigente('P.P MOLIDO', '2026-09-01').id, 'c2', 'nombre anterior → guardada con oficial');
});

caso('Reporte Por Material: tickets, procesos y subproductos guardados con el nombre anterior empatan', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.composiciones = [{
    id: 'c1', materialEntrada: 'P.P. MOLIDO', version: 1, fechaVigencia: '2026-08-01', fechaCierre: null, totalPorcentaje: 100,
    componentes: [
      { subproducto: 'P.P. MOLIDO', porcentaje: 90, esMerma: false },
      { subproducto: 'BASURA', porcentaje: 10, esMerma: true }
    ]
  }];
  // Ticket y proceso guardados con el nombre anterior; la salida con el nombre anterior también.
  w.EVE.registrosDestaraje = [{ id: 'd1', ticket: '1', material: 'P.P MOLIDO', kg: 1000, fechaEntrada: '2026-09-02', fechaSalida: '2026-09-02' }];
  w.EVE.registrosControlProduccion = [{
    id: 'p1', ticket: 'P-001', tipoProceso: 'SELECCION', fechaFin: '2026-09-03T16:00',
    inputs: [{ material: 'P.P MOLIDO', kg: 1000, ticketOrigen: '1' }],
    outputs: [{ material: 'P.P MOLIDO', kg: 900, esMerma: false }, { material: 'BASURA', kg: 100, esMerma: true }]
  }];
  const r = w.calcularRendimientoMaterial('P.P. MOLIDO', { desde: '2026-09-01', hasta: '2026-09-30' });
  cerca(r.entradaTotalKg, 1000, 'entradaTotalKg');
  igual(r.filas.length, 2, 'una sola fila por subproducto (real y esperado empatan aunque los nombres difieran)');
  const fila = r.filas.find((f) => f.subproducto === 'P.P. MOLIDO');
  cerca(fila.esperadoPct, 90, 'esperadoPct');
  cerca(fila.realKg, 900, 'realKg');
  // Búsqueda por el nombre anterior da el mismo resultado.
  const r2 = w.calcularRendimientoMaterial('P.P MOLIDO', { desde: '2026-09-01', hasta: '2026-09-30' });
  igual(r2.filas, r.filas, 'mismo resultado con el nombre anterior');
});

// ── Trazabilidad y CxP ───────────────────────────────────────────────────

caso('Trazabilidad: el enlace de un input con el nombre anterior a la salida con el nombre oficial', () => {
  const w = crearContexto({ conAlias: true });
  const datos = {
    registrosDestaraje: [],
    registrosVentas: [],
    ventas: [],
    registrosControlProduccion: [
      { id: 'p1', ticket: 'P-001', tipoProceso: 'MOLIENDA', inputs: [{ material: 'P.P.', kg: 100, ticketOrigen: '9' }],
        outputs: [{ material: 'P.P. MOLIDO', kg: 95, esMerma: false }], fechaFin: '2026-09-03T10:00' },
      { id: 'p2', ticket: 'P-002', tipoProceso: 'LAVADO', inputs: [{ material: 'P.P MOLIDO', kg: 95, ticketOrigen: 'P-001' }],
        outputs: [{ material: 'P.P. MOLIDO', kg: 90, esMerma: false }], fechaFin: '2026-09-04T10:00' }
    ]
  };
  const alcance = w.EVE_TRAZABILIDAD.recolectarAlcanzables('P-001', datos);
  afirmar(alcance.procesos.has('P-002'), 'el lavado con input "P.P MOLIDO" debe enlazar con la salida "P.P. MOLIDO" de P-001');
  // Búsqueda por material con cualquiera de los dos nombres.
  const t1 = w.EVE_TRAZABILIDAD.buscarTicketsPorCriterio('material', 'P.P. MOLIDO', datos);
  const t2 = w.EVE_TRAZABILIDAD.buscarTicketsPorCriterio('material', 'P.P MOLIDO', datos);
  igual(t1.slice().sort(), ['P-001', 'P-002'], 'búsqueda por nombre oficial');
  igual(t2.slice().sort(), ['P-001', 'P-002'], 'búsqueda por nombre anterior');
});

caso('CxP: el filtro de material empata nombres anterior y oficial', () => {
  const w = crearContexto({ conAlias: true });
  const cuentas = [
    { id: 'x1', material: 'P.P MOLIDO', fechaTicket: '2026-09-01', proveedor: 'JESÚS', estado: 'pendiente' },
    { id: 'x2', material: 'LECHERO', fechaTicket: '2026-09-01', proveedor: 'JESÚS', estado: 'pendiente' }
  ];
  const ids = (filtros) => w.EVE_CXP.filtrarGenerico(cuentas, filtros).map((c) => c.id);
  igual(ids({ material: 'P.P. MOLIDO' }), ['x1'], 'filtro con el nombre oficial');
  igual(ids({ material: 'p.p molido' }), ['x1'], 'filtro con el nombre anterior en minúsculas');
  igual(ids({ material: 'LECHERO' }), ['x2'], 'material sin alias');
  igual(ids({}), ['x1', 'x2'], 'sin filtro de material');
});

// K1c: el filtro de CxP del módulo Reportes (js/reportes-ui.js) compara el material normalizado en ambos lados.
function filtrarCxPReportes(w, cuentas, material) {
  w.EVE.cuentasPorPagar = cuentas;
  const valores = { 'ruf-ticket': '', 'ruf-desde': '', 'ruf-hasta': '', 'ruf-cxp-proveedor': '', 'ruf-cxp-material': material, 'ruf-cxp-estado': '' };
  w.document.getElementById = (id) => ({ value: valores[id] || '' });
  return w.EVE_REPORTES_UI.obtenerCuentasCxPFiltradas({ desde: '', hasta: '' }).map((c) => c.id);
}

caso('CxP en Reportes (K1c): una CxP guardada como "P.P MOLIDO" aparece al filtrar por "P.P. MOLIDO"', () => {
  const w = crearContexto({ conAlias: true });
  const cuentas = [
    { id: 'x1', material: 'P.P MOLIDO', fechaTicket: '2026-09-01', proveedor: 'JESÚS', estado: 'pendiente', ticket: '1' },
    { id: 'x2', material: 'LECHERO', fechaTicket: '2026-09-01', proveedor: 'JESÚS', estado: 'pendiente', ticket: '2' }
  ];
  igual(filtrarCxPReportes(w, cuentas, 'P.P. MOLIDO'), ['x1'], 'filtro con el nombre oficial');
  igual(filtrarCxPReportes(w, cuentas, 'P.P MOLIDO'), ['x1'], 'filtro con el nombre anterior');
  igual(w.EVE.cuentasPorPagar[0].material, 'P.P MOLIDO', 'el documento guardado NO se modifica');
});

caso('CxP en Reportes (K1c): con nombres ya normalizados el resultado no cambia', () => {
  const w = crearContexto({ conAlias: false });
  const cuentas = [
    { id: 'x1', material: 'P.E.', fechaTicket: '2026-09-01', proveedor: 'JESÚS', estado: 'pendiente', ticket: '1' },
    { id: 'x2', material: 'LECHERO', fechaTicket: '2026-09-01', proveedor: 'JESÚS', estado: 'pendiente', ticket: '2' }
  ];
  igual(filtrarCxPReportes(w, cuentas, 'LECHERO'), ['x2'], 'filtro por material');
  igual(filtrarCxPReportes(w, cuentas, ''), ['x1', 'x2'], 'sin filtro de material');
  igual(filtrarCxPReportes(w, cuentas, 'BOTE'), [], 'material sin coincidencias');
});

// K1d: los selectores de material deduplican por nombre normalizado (una sola opción 'P.P. MOLIDO').
caso('Selectores de Reportes (K1d): "P.P MOLIDO" y "P.P. MOLIDO" dan UNA sola opción normalizada y ordenada', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.registrosDestaraje = [{ id: 'd1', material: 'P.P MOLIDO' }, { id: 'd2', material: 'P.P. MOLIDO' }, { id: 'd3', material: 'LECHERO' }];
  w.EVE.registrosVentas = [{ id: 'v1', material: 'p.p  molido' }];
  w.EVE.ventas = [{ id: 'vt1', lineas: [{ material: 'P.P MOLIDO' }, { material: 'BOTE' }] }];
  w.EVE.registrosPagos = [{ id: 'g1', material: 'P.P MOLIDO' }];
  igual(w.EVE_REPORTES_UI.obtenerMaterialesUnicos(), ['BOTE', 'LECHERO', 'P.P. MOLIDO'], 'selector general');
  w.EVE.cuentasPorPagar = [{ id: 'x1', material: 'P.P MOLIDO' }, { id: 'x2', material: 'P.P. MOLIDO' }, { id: 'x3', material: 'LECHERO' }, { id: 'x4', material: '' }];
  igual(w.EVE_REPORTES_UI.obtenerMaterialesCxPUnicos(), ['LECHERO', 'P.P. MOLIDO'], 'selector de CxP');
  igual(w.EVE.cuentasPorPagar[0].material, 'P.P MOLIDO', 'el documento guardado NO se modifica');
});

caso('Datalist de Pagos (K1d): el pago guardado como "P.P MOLIDO" no duplica la opción del catálogo', () => {
  const w = crearContexto({ conAlias: true });
  const lista = w.EVE_PAGOS.materialesParaDatalistPagos([{ material: 'P.P MOLIDO' }, { material: 'lechero' }], ['P.P. MOLIDO', 'LECHERO', 'BOTE']);
  igual(lista, ['BOTE', 'LECHERO', 'P.P. MOLIDO'], 'una sola opción por material');
});

caso('Selectores de material (K1d): con nombres ya normalizados el resultado no cambia', () => {
  const w = crearContexto({ conAlias: false });
  w.EVE.registrosDestaraje = [{ id: 'd1', material: 'P.E.' }, { id: 'd2', material: 'LECHERO' }, { id: 'd3', material: 'P.E.' }];
  w.EVE.registrosVentas = []; w.EVE.ventas = []; w.EVE.registrosPagos = [];
  igual(w.EVE_REPORTES_UI.obtenerMaterialesUnicos(), ['LECHERO', 'P.E.'], 'selector general');
  igual(w.EVE_PAGOS.materialesParaDatalistPagos([{ material: 'P.E.' }], ['LECHERO', 'P.E.']), ['LECHERO', 'P.E.'], 'datalist de Pagos');
});

// K1e: un ticket de Báscula con varios renglones y las comparaciones de ajustes de inventario por nombre normalizado.
const renglonBascula = (id, material, kg) => ({ id, ticket: '1066', material, kg, fechaEntrada: '2026-09-08', fechaSalida: '2026-09-08', proveedor: 'JESÚS' });
const procesoConInput = (id, ticket, material, ticketOrigen) => ({
  id, ticket, tipoProceso: 'PELETIZADO', fechaFin: '2026-09-09T10:00', inputs: [{ material, kg: 100, ticketOrigen }], outputs: [{ material: 'PELLET CAJAS', kg: 95, esMerma: false }]
});
const datosTrz = (renglones, procesos) => ({ registrosDestaraje: renglones, registrosVentas: [], ventas: [], registrosControlProduccion: procesos });

caso('Trazabilidad (K1e): una entrada de BIDON con ticketOrigen 1066 enlaza aunque el primer renglón del ticket sea P.P.', () => {
  const w = crearContexto({ conAlias: true });
  const renglones = [renglonBascula('r1', 'P.P.', 400), renglonBascula('r2', 'P.P. MOLIDO', 300), renglonBascula('r3', 'BIDON', 120), renglonBascula('r4', 'P.P. MOLIDO', 200)];
  const alcance = w.EVE_TRAZABILIDAD.recolectarAlcanzables('1066', datosTrz(renglones, [procesoConInput('p1', 'P-001', 'BIDON', '1066')]));
  afirmar(alcance.procesos.has('P-001'), 'el proceso con input BIDON y ticketOrigen 1066 debe enlazar');
});

caso('Trazabilidad (K1e): un material que NO está en ningún renglón del ticket no enlaza', () => {
  const w = crearContexto({ conAlias: true });
  const renglones = [renglonBascula('r1', 'P.P.', 400), renglonBascula('r3', 'BIDON', 120)];
  const alcance = w.EVE_TRAZABILIDAD.recolectarAlcanzables('1066', datosTrz(renglones, [procesoConInput('p1', 'P-001', 'VERDE', '1066')]));
  afirmar(!alcance.procesos.has('P-001'), 'VERDE no está en el ticket 1066');
});

caso('Trazabilidad (K1e): dos renglones de P.P. MOLIDO (y uno guardado como "P.P MOLIDO") cuentan como un solo origen', () => {
  const w = crearContexto({ conAlias: true });
  const renglones = [renglonBascula('r1', 'P.P. MOLIDO', 300), renglonBascula('r2', 'P.P MOLIDO', 200), renglonBascula('r3', 'BIDON', 120)];
  const procesos = [procesoConInput('p1', 'P-001', 'P.P. MOLIDO', '1066'), procesoConInput('p2', 'P-002', 'P.P MOLIDO', '1066')];
  const alcance = w.EVE_TRAZABILIDAD.recolectarAlcanzables('1066', datosTrz(renglones, procesos));
  igual(Array.from(alcance.procesos.keys ? alcance.procesos.keys() : alcance.procesos).sort(), ['P-001', 'P-002'], 'cada proceso aparece una vez, con cualquiera de los dos nombres');
  igual(Array.from(alcance.entradas.keys ? alcance.entradas.keys() : alcance.entradas), ['1066'], 'un solo origen de Báscula');
});

caso('Inventario (K1e): un ajuste guardado como "P.P MOLIDO" se encuentra al buscar "P.P. MOLIDO"', () => {
  const w = crearContexto({ conAlias: true });
  const docs = [{ id: 'a1', material: 'P.P MOLIDO', etapa: 'MOLIENDA', ajusteNeto: -5, ajustes: [{ fecha: '2026-09-01' }] }];
  igual((w.EVE_INVENTARIO.buscarDocInventario(docs, 'P.P. MOLIDO', 'MOLIENDA') || {}).id, 'a1', 'oficial → guardado con el nombre anterior');
  igual((w.EVE_INVENTARIO.buscarDocInventario(docs, 'P.P MOLIDO', 'MOLIENDA') || {}).id, 'a1', 'el nombre anterior sigue funcionando');
  igual(w.EVE_INVENTARIO.buscarDocInventario(docs, 'P.P. MOLIDO', 'LAVADO'), null, 'otra etapa no empata');
  igual(docs[0].material, 'P.P MOLIDO', 'el documento guardado NO se modifica');
});

caso('Inventario (K1e): el ajuste con el nombre anterior se aplica a la fila calculada y no duplica la fila', () => {
  const w = crearContexto({ conAlias: true });
  const docs = [{ id: 'a1', material: 'P.P MOLIDO', etapa: 'MOLIENDA', ajusteNeto: -5, ajustes: [] }];
  const calculadas = [{ material: 'P.P. MOLIDO', etapa: 'MOLIENDA', cantidadCalculada: 100 }];
  const filas = w.EVE_INVENTARIO.combinarConAjustes(calculadas, docs);
  igual(filas.map((f) => [f.material, f.etapa, f.cantidadReal, f.docId]), [['P.P. MOLIDO', 'MOLIENDA', 95, 'a1']], 'una sola fila con el ajuste aplicado');
  // Sin fila calculada, el ajuste solo aparece con el nombre normalizado (misma fila de la matriz que el resto).
  const soloAjuste = w.EVE_INVENTARIO.combinarConAjustes([], docs);
  igual(soloAjuste.map((f) => [f.material, f.cantidadReal]), [['P.P. MOLIDO', -5]], 'ajuste sin fila calculada');
});

caso('Inventario (K1e): con nombres ya normalizados el resultado no cambia', () => {
  const w = crearContexto({ conAlias: false });
  const docs = [{ id: 'a1', material: 'LECHERO', etapa: 'RECEPCIÓN', ajusteNeto: 10, ajustes: [] }];
  igual(w.EVE_INVENTARIO.combinarConAjustes([{ material: 'LECHERO', etapa: 'RECEPCIÓN', cantidadCalculada: 50 }], docs).map((f) => f.cantidadReal), [60], 'ajuste aplicado');
  igual(w.EVE_INVENTARIO.buscarDocInventario(docs, 'BOTE', 'RECEPCIÓN'), null, 'material sin ajuste');
});

// K1b: cobertura de precios del Dashboard ("candidatos a CxP faltantes").
const fechasK1b = ['2026-08-31', '2026-09-05', '2026-09-10', '2026-09-12', '2026-09-17', '2026-09-20', '2026-09-24'];
const ticketsK1b = (material) => fechasK1b.map((f, i) => ({ id: 'k' + i, ticket: String(900 + i), material, kg: 100, fechaEntrada: f, fechaSalida: f }));

caso('Dashboard (K1b): precio y tickets guardados como "P.P MOLIDO" cubren al material oficial "P.P. MOLIDO"', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = [{ id: 'pr1', material: 'P.P MOLIDO', precio: 7.5, fechaInicio: '2026-07-23', fechaFin: null }];
  w.EVE.registrosDestaraje = ticketsK1b('P.P MOLIDO');
  igual((w.obtenerPrecioVigente('P.P. MOLIDO', '2026-09-24') || {}).precio, 7.5, 'obtenerPrecioVigente ya empataba por nombre normalizado');
  const sinPrecio = w.EVE_DASHBOARD.calcularMaterialesSinPrecioVigente();
  igual(sinPrecio.map((m) => m.material), [], 'ningún material sin precio vigente');
});

caso('Dashboard (K1b): el aviso sigue apareciendo si de verdad no hay precio', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = [{ id: 'pr1', material: 'P.P MOLIDO', precio: 7.5, fechaInicio: '2026-09-01', fechaFin: null }];
  w.EVE.registrosDestaraje = ticketsK1b('P.P MOLIDO');
  const sinPrecio = w.EVE_DASHBOARD.calcularMaterialesSinPrecioVigente();
  igual(sinPrecio.map((m) => [m.material, m.ticketsSinPrecio, m.totalTickets]), [['P.P. MOLIDO', 1, 7]], 'solo el ticket anterior al precio queda sin cobertura');
});

caso('Dashboard (K1b): precio con el nombre oficial y tickets con el anterior también cubren', () => {
  const w = crearContexto({ conAlias: true });
  w.EVE.precios = [{ id: 'pr1', material: 'P.P. MOLIDO', precio: 7.5, fechaInicio: '2026-07-23', fechaFin: null }];
  w.EVE.registrosDestaraje = ticketsK1b('P.P MOLIDO');
  igual(w.EVE_DASHBOARD.calcularMaterialesSinPrecioVigente().map((m) => m.material), [], 'sin material sin precio');
});

caso('Reporte de rendimiento por proceso (K1b): salidas "P.P MOLIDO" y "P.P. MOLIDO" dan una sola fila con la suma', () => {
  const w = crearContexto({ conAlias: true });
  // calcularSeccionRendimientoProceso solo usa stats de Control Producción para los totales; se acotan aquí.
  w.EVE_CONTROL_PRODUCCION = { calcularStats: () => ({ totalRegistros: 1, totalInput: 100, totalOutput: 90, totalMerma: 10, eficienciaPromedio: 90 }), PROCESOS_PZ: [] };
  w.EVE.registrosControlProduccion = [{
    id: 'p1', ticket: 'P-001', tipoProceso: 'LAVADO', fecha: '2026-09-04', totalOutput: 90,
    inputs: [{ material: 'P.P. MOLIDO', kg: 100 }],
    outputs: [{ material: 'P.P MOLIDO', kg: 40, esMerma: false }, { material: 'P.P. MOLIDO', kg: 50, esMerma: false }, { material: 'LODOS', kg: 10, esMerma: true }]
  }];
  const seccion = w.calcularRendimientoPorProceso('LAVADO', { desde: '2026-09-01', hasta: '2026-09-30' }).secciones[0];
  igual(seccion.desglosePorMaterial, [{ material: 'P.P. MOLIDO', kg: 90 }], 'una sola fila con el nombre normalizado y la suma');
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
