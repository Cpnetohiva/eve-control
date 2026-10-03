// K24 — Protección de interfaz de las fórmulas (mezclas) de Peletizado.
//
// Carga en un contexto vm los js/ reales (config, utils, rendimientos, inventario, reglas, permisos, control-produccion y
// trazabilidad) y comprueba que, sin window.puedeVerFormulasPeletizado():
//  - K24a: el CSV histórico de Control Producción exporta un Peletizado como UNA fila por ticket (kg de entrada total, kg de
//    salida total y el pellet), sin material ni kg por input; con permiso, exporta como siempre;
//  - K24a: el permiso es únicamente Admin con escritura;
//  - K24b: Inventario → historial por material agrega por día los consumos por PELETIZADO (sin ticket ni enlace), sin tocar saldos;
//  - K24c: Trazabilidad no busca por los inputs de un Peletizado ni muestra sus entradas ni el árbol hacia atrás de ellas.
// (Duplicar en Peletizado se prueba en scripts/verificar-captura-simple.js, que ya tiene el DOM simulado.)
// La protección es solo de interfaz: quien lee control_produccion recibe los documentos completos.
//
// Uso: node scripts/verificar-formulas-peletizado.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/inventario.js', 'js/control-produccion-reglas.js', 'js/permisos.js', 'js/control-produccion.js', 'js/trazabilidad.js'];

// permisosAdmin: valor de permisosResueltos.admin del usuario simulado ('escritura' | 'lectura' | 'ninguno').
function crearContexto(permisosAdmin) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosControlProduccion: [], composiciones: [], precios: [], ajustesPrecioProveedor: [], comisiones: [],
    ventas: [], registrosVentas: [], inventarioInicial: [], metaPiezasDia: {}, cuentasPorPagar: [],
    currentUser: { permisosResueltos: { admin: permisosAdmin, control_produccion: 'escritura', inventario: 'escritura' } }
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  sandbox.window.obtenerFechaMexico = () => '2026-09-30';
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

const inp = (material, kg, ticketOrigen) => ({ material, kg, ticketOrigen: ticketOrigen || '' });
const out = (material, kg, esMerma) => ({ material, kg, esMerma: !!esMerma });
const proceso = (numero, tipoProceso, inputs, outputs, fecha, extra) => ({
  id: `p${numero}`, ticket: `P-${String(numero).padStart(3, '0')}`, tipoProceso, inputs, outputs, fecha, operador: 'LUIS', turno: 'Matutino',
  totalInput: inputs.reduce((s, i) => s + i.kg, 0), totalOutput: outputs.reduce((s, o) => s + o.kg, 0),
  eficiencia: 100, porcentajeMerma: 0, observaciones: '', ...(extra || {})
});

// ── K24a: permiso ────────────────────────────────────────────────────────

caso('K24a: puedeVerFormulasPeletizado es true solo para Admin con escritura', () => {
  igual(crearContexto('escritura').puedeVerFormulasPeletizado(), true, 'Admin escritura');
  igual(crearContexto('lectura').puedeVerFormulasPeletizado(), false, 'Admin lectura');
  igual(crearContexto('ninguno').puedeVerFormulasPeletizado(), false, 'sin Admin');
  const sinUsuario = crearContexto('escritura');
  sinUsuario.EVE.currentUser = null;
  igual(sinUsuario.puedeVerFormulasPeletizado(), false, 'sin usuario');
});

// ── K24a: CSV histórico ──────────────────────────────────────────────────

const PELETIZADO_3_MOLIDOS = proceso(5, 'PELETIZADO',
  [inp('P.E. MOLIDO', 300, 'P-001'), inp('P.P. MOLIDO', 200, 'P-002'), inp('PET MOLIDO', 100, 'P-003')],
  [out('PELLET CAJAS', 570), out('PIEDRAS', 30, true)], '2026-09-12');
const SELECCION = proceso(1, 'SELECCIÓN', [inp('CRISTAL CON ETIQUETA', 1000, '10')], [out('PET CRISTAL', 900), out('BASURA', 100, true)], '2026-09-10');

caso('K24a: sin permiso, el CSV de un Peletizado con 3 molidos no contiene los nombres ni los kg de los molidos', () => {
  const w = crearContexto('lectura');
  const filas = w.EVE_CONTROL_PRODUCCION.construirFilasCSVControlProduccionHistorico([PELETIZADO_3_MOLIDOS]);
  igual(filas.length, 1, 'una fila por ticket');
  igual(filas[0], {
    'Fecha': '2026-09-12', 'Tipo Proceso': 'PELETIZADO', 'Ticket Origen (input)': '', 'Material Input': '', 'Kg Input': 600,
    'Material Output': 'PELLET CAJAS', 'Kg Output': 600, 'Es Merma': 'No'
  }, 'totales y pellet');
  const texto = JSON.stringify(filas);
  ['P.E. MOLIDO', 'P.P. MOLIDO', 'PET MOLIDO', '300', '200', '100', 'P-001', 'P-002', 'P-003'].forEach((dato) => {
    afirmar(!texto.includes(dato), `el CSV no debe contener ${dato}`);
  });
});

caso('K24a: con permiso, el CSV de Peletizado sale como hoy (input × output)', () => {
  const w = crearContexto('escritura');
  const filas = w.EVE_CONTROL_PRODUCCION.construirFilasCSVControlProduccionHistorico([PELETIZADO_3_MOLIDOS]);
  igual(filas.length, 6, '3 inputs × 2 outputs');
  igual(Array.from(new Set(filas.map((f) => f['Material Input']))), ['P.E. MOLIDO', 'P.P. MOLIDO', 'PET MOLIDO'], 'materiales de entrada');
  igual(filas[0], {
    'Fecha': '2026-09-12', 'Tipo Proceso': 'PELETIZADO', 'Ticket Origen (input)': 'P-001', 'Material Input': 'P.E. MOLIDO', 'Kg Input': 300,
    'Material Output': 'PELLET CAJAS', 'Kg Output': 570, 'Es Merma': 'No'
  }, 'primera fila');
});

caso('K24a: los demás procesos se exportan igual con o sin permiso', () => {
  const sin = crearContexto('lectura').EVE_CONTROL_PRODUCCION.construirFilasCSVControlProduccionHistorico([SELECCION, PELETIZADO_3_MOLIDOS]).filter((f) => f['Tipo Proceso'] === 'SELECCIÓN');
  const con = crearContexto('escritura').EVE_CONTROL_PRODUCCION.construirFilasCSVControlProduccionHistorico([SELECCION, PELETIZADO_3_MOLIDOS]).filter((f) => f['Tipo Proceso'] === 'SELECCIÓN');
  igual(sin, con, 'Selección idéntica');
  igual(sin.length, 2, '1 input × 2 outputs');
});

caso('K24a: el CSV sin permiso no depende de totalInput/totalOutput guardados (los recalcula si faltan)', () => {
  const w = crearContexto('lectura');
  const sinTotales = { ...PELETIZADO_3_MOLIDOS, totalInput: 0, totalOutput: 0 };
  const fila = w.EVE_CONTROL_PRODUCCION.construirFilasCSVControlProduccionHistorico([sinTotales])[0];
  igual([fila['Kg Input'], fila['Kg Output']], [600, 600], 'totales recalculados');
});

// ── K24b: Inventario → historial por material ───────────────────────────

// 1000 kg de P.E. MOLIDO en MOLIENDA; dos Peletizados el 12 (P-001 y P-002) y uno el 13 (P-003) lo consumen; un Lavado no.
function datosInventario() {
  return {
    inventarioInicial: [{ id: 'i1', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 1000, fecha: '2026-01-01' }],
    registrosDestaraje: [],
    registrosControlProduccion: [
      proceso(1, 'PELETIZADO', [inp('P.E. MOLIDO', 300)], [out('PELLET CAJAS', 290), out('PIEDRAS', 10, true)], '2026-09-12'),
      proceso(2, 'PELETIZADO', [inp('P.E. MOLIDO', 200)], [out('PELLET TAMBO', 195), out('PIEDRAS', 5, true)], '2026-09-12'),
      proceso(3, 'PELETIZADO', [inp('P.E. MOLIDO', 100)], [out('PELLET CAJAS', 97), out('PIEDRAS', 3, true)], '2026-09-13')
    ],
    ventas: []
  };
}

const consumos = (filas) => filas.filter((f) => f.tipo.includes('PELETIZADO') || f.tipo.includes('Peletizado'));

caso('K24b: sin permiso, dos Peletizados del mismo día que consumen el mismo molido dan un solo renglón con la suma y sin ticket', () => {
  const w = crearContexto('lectura');
  const filas = consumos(w.EVE_INVENTARIO.construirFilasMovimientosHistorial(datosInventario(), 'P.E. MOLIDO'));
  igual(filas.map((f) => [String(f.fecha).slice(0, 10), f.etapa, f.kg, f.saldoDespues, f.referencia, f.clic]),
    [['2026-09-12', 'MOLIENDA', -500, 500, '—', null], ['2026-09-13', 'MOLIENDA', -100, 400, '—', null]], 'un renglón por día, sin ticket ni enlace');
  const texto = JSON.stringify(filas);
  ['P-001', 'P-002', 'P-003'].forEach((ticket) => afirmar(!texto.includes(ticket), `no debe aparecer ${ticket}`));
});

caso('K24b: con permiso, dos renglones el mismo día, cada uno con su ticket y enlace', () => {
  const w = crearContexto('escritura');
  const filas = consumos(w.EVE_INVENTARIO.construirFilasMovimientosHistorial(datosInventario(), 'P.E. MOLIDO'));
  igual(filas.map((f) => [String(f.fecha).slice(0, 10), f.kg, f.saldoDespues, f.referencia, typeof f.clic]),
    [['2026-09-12', -300, 700, 'P-001', 'function'], ['2026-09-12', -200, 500, 'P-002', 'function'], ['2026-09-13', -100, 400, 'P-003', 'function']], 'un renglón por ticket');
});

caso('K24b: los saldos y el ledger no cambian con el permiso; el saldo del agregado es el del último movimiento del día', () => {
  const sin = crearContexto('lectura');
  const con = crearContexto('escritura');
  const datos = datosInventario();
  const saldosSin = sin.EVE_INVENTARIO.calcularSaldosPorEtapaEnFecha(datos, '2026-09-30');
  const saldosCon = con.EVE_INVENTARIO.calcularSaldosPorEtapaEnFecha(datos, '2026-09-30');
  igual(saldosSin, saldosCon, 'saldos por etapa');
  igual(saldosCon['P.E. MOLIDO'], { 'MOLIENDA': 400 }, 'saldo final del molido');
  igual(sin.EVE_INVENTARIO.construirMovimientosPorMaterial(datos, 'P.E. MOLIDO').map((m) => [m.kg, m.saldoDespues]),
    con.EVE_INVENTARIO.construirMovimientosPorMaterial(datos, 'P.E. MOLIDO').map((m) => [m.kg, m.saldoDespues]), 'movimientos del ledger');
  const ultimoSin = sin.EVE_INVENTARIO.construirFilasMovimientosHistorial(datos, 'P.E. MOLIDO').slice(-1)[0];
  igual(ultimoSin.saldoDespues, 400, 'el último renglón cierra en el saldo real');
  const sumaSin = sin.EVE_INVENTARIO.construirFilasMovimientosHistorial(datos, 'P.E. MOLIDO').reduce((s, f) => s + f.kg, 0);
  const sumaCon = con.EVE_INVENTARIO.construirFilasMovimientosHistorial(datos, 'P.E. MOLIDO').reduce((s, f) => s + f.kg, 0);
  igual([sumaSin, sumaCon], [-600 + 1000, -600 + 1000], 'los kg totales del historial coinciden');
});

caso('K24b: sin permiso, el pellet de salida y los movimientos de otros procesos siguen con su ticket', () => {
  const w = crearContexto('lectura');
  const datos = datosInventario();
  datos.registrosControlProduccion.push(proceso(4, 'LAVADO', [inp('P.E. MOLIDO', 50)], [out('P.E. MOLIDO', 50)], '2026-09-14'));
  const filas = w.EVE_INVENTARIO.construirFilasMovimientosHistorial(datos, 'P.E. MOLIDO');
  afirmar(filas.some((f) => f.referencia === 'P-004'), 'el Lavado conserva su ticket');
  const pellet = w.EVE_INVENTARIO.construirFilasMovimientosHistorial(datos, 'PELLET CAJAS');
  igual(pellet.map((f) => f.referencia), ['P-001', 'P-003'], 'la producción del pellet conserva sus tickets');
});

// ── K24c: Trazabilidad ───────────────────────────────────────────────────

// Báscula 10 (P.E.) → Molienda P-001 (P.E. MOLIDO) y Lavado P-002 (P.P. MOLIDO) → Peletizado P-005 con ambos molidos →
// Empacado P-006 del pellet. El Peletizado P-005 es el que no debe revelar sus entradas.
function datosTrazabilidad() {
  return {
    registrosDestaraje: [
      { id: 'd10', ticket: '10', material: 'P.E.', kg: 1000, proveedor: 'JESÚS', fechaEntrada: '2026-09-01', fechaSalida: '2026-09-01' },
      { id: 'd11', ticket: '11', material: 'P.P.', kg: 500, proveedor: 'JESÚS', fechaEntrada: '2026-09-01', fechaSalida: '2026-09-01' }
    ],
    registrosControlProduccion: [
      proceso(1, 'MOLIENDA', [inp('P.E.', 1000, '10')], [out('P.E. MOLIDO', 950), out('POLVO', 50, true)], '2026-09-05'),
      proceso(2, 'LAVADO', [inp('P.P.', 500, '11')], [out('P.P. MOLIDO', 480), out('POLVO', 20, true)], '2026-09-05'),
      proceso(5, 'PELETIZADO', [inp('P.E. MOLIDO', 300, 'P-001'), inp('P.P. MOLIDO', 200, 'P-002')],
        [out('PELLET CAJAS', 480), out('PIEDRAS', 20, true)], '2026-09-12'),
      proceso(6, 'EMPACADO', [inp('PELLET CAJAS', 480, 'P-005')], [out('PELLET CAJAS', 480)], '2026-09-13')
    ],
    registrosVentas: [],
    ventas: [],
    cuentasPorPagar: []
  };
}

caso('K24c: sin permiso, buscar P.E. MOLIDO no devuelve el Peletizado que lo usó como input; con permiso sí', () => {
  const sin = crearContexto('lectura').EVE_TRAZABILIDAD.buscarTicketsPorCriterio('material', 'P.E. MOLIDO', datosTrazabilidad());
  const con = crearContexto('escritura').EVE_TRAZABILIDAD.buscarTicketsPorCriterio('material', 'P.E. MOLIDO', datosTrazabilidad());
  igual(sin.slice().sort(), ['P-001'], 'sin permiso: solo el que lo produce (Molienda)');
  igual(con.slice().sort(), ['P-001', 'P-005'], 'con permiso: también el Peletizado');
});

caso('K24c: sin permiso el Peletizado se sigue encontrando por su número y por su output', () => {
  const t = crearContexto('lectura').EVE_TRAZABILIDAD;
  igual(t.buscarTicketsPorCriterio('ticket', 'P-005', datosTrazabilidad()), ['P-005'], 'por ticket');
  igual(t.buscarTicketsPorCriterio('material', 'PELLET CAJAS', datosTrazabilidad()).sort(), ['P-005', 'P-006'], 'por output');
  igual(t.buscarTicketsPorCriterio('proceso', 'PELETIZADO', datosTrazabilidad()), ['P-005'], 'por proceso');
});

caso('K24c: sin permiso, el nodo del Peletizado muestra pellet, kg de entrada y de salida totales y NO sus entradas ni el árbol hacia atrás', () => {
  const w = crearContexto('lectura');
  const cadena = w.EVE_TRAZABILIDAD.construirCadena('P-005', datosTrazabilidad());
  afirmar(cadena.encontrado, 'se encuentra');
  igual(cadena.arbol.origenes, [], 'sin árbol hacia atrás');
  igual([cadena.arbol.nodo.entradasOcultas, cadena.arbol.nodo.totalInput, cadena.arbol.nodo.totalOutput], [true, 500, 500], 'totales');
  igual(cadena.arbol.nodo.outputs.map((o) => o.material), ['PELLET CAJAS', 'PIEDRAS'], 'pellet de salida (y su merma)');
  igual(cadena.arbol.destinos.map((d) => d.nodo.ticket), ['P-006'], 'hacia adelante no cambia');
  const filas = [];
  w.EVE_TRAZABILIDAD.aplanarArbol(cadena.arbol, 0, filas);
  const texto = JSON.stringify([cadena.arbol.nodo, cadena.arbol.origenes, filas]);
  ['P.E. MOLIDO', 'P.P. MOLIDO', 'P-001', 'P-002', 'JESÚS', '"P.E."', '"P.P."'].forEach((dato) => afirmar(!texto.includes(dato), `no debe aparecer ${dato}`));
  afirmar(filas[0][1].startsWith('Entrada total: 500 kg — Salida total: 500 kg'), `el detalle (PDF) lleva los totales: ${filas[0][1]}`);
});

caso('K24c: sin permiso, otro proceso que usa el pellet no reabre la mezcla por el árbol hacia atrás', () => {
  const w = crearContexto('lectura');
  const cadena = w.EVE_TRAZABILIDAD.construirCadena('P-006', datosTrazabilidad());
  igual(cadena.arbol.origenes.map((o) => o.nodo.ticket), ['P-005'], 'el Peletizado sigue enlazado como origen (K1e no cambia)');
  igual(cadena.arbol.origenes[0].origenes, [], 'pero sin sus entradas');
});

caso('K24c: con permiso todo sale como hoy (entradas y árbol hacia atrás del Peletizado)', () => {
  const w = crearContexto('escritura');
  const cadena = w.EVE_TRAZABILIDAD.construirCadena('P-005', datosTrazabilidad());
  igual(cadena.arbol.origenes.map((o) => o.nodo.ticket), ['P-001', 'P-002'], 'orígenes P-001 y P-002');
  igual(cadena.arbol.origenes[0].origenes.map((o) => o.nodo.ticket), ['10'], 'y hasta la Báscula');
  afirmar(cadena.arbol.nodo.entradasOcultas === undefined && cadena.arbol.nodo.totalInput === undefined, 'el nodo no lleva campos de ocultamiento');
});

caso('K24c: los árboles de otros procesos y el resumen global son idénticos con o sin permiso', () => {
  const sin = crearContexto('lectura').EVE_TRAZABILIDAD;
  const con = crearContexto('escritura').EVE_TRAZABILIDAD;
  igual(sin.construirCadena('P-001', datosTrazabilidad()).arbol.origenes, con.construirCadena('P-001', datosTrazabilidad()).arbol.origenes, 'Molienda hacia atrás');
  igual(sin.construirCadena('P-005', datosTrazabilidad()).resumen, con.construirCadena('P-005', datosTrazabilidad()).resumen, 'resumen global del Peletizado');
  igual(sin.construirCadena('10', datosTrazabilidad()).resumen, con.construirCadena('10', datosTrazabilidad()).resumen, 'resumen global de la Báscula');
});

// ── Ejecución ────────────────────────────────────────────────────────────

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`PASS  ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`FAIL  ${nombre}\n      ${error.stack ? error.stack.split('\n').slice(0, 3).join('\n      ') : error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos > 0 ? 1 : 0);
})();
