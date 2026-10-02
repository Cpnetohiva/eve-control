// K20a — Verificación de window.EVE_RENDIMIENTOS.calcularComposicionesPendientes (panel "Composiciones pendientes").
//
// Carga en un vm js/config.js, js/utils.js y js/rendimientos.js. La función es pura: no lee Firestore ni el DOM.
//
// Uso: node scripts/verificar-composiciones-pendientes.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { composiciones: [], registrosDestaraje: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const w = crearContexto();
const calcular = (tickets, composiciones, opciones) => w.EVE_RENDIMIENTOS.calcularComposicionesPendientes(tickets, composiciones, opciones);

let secuencia = 0;
const ticket = (material, kg, fechaSalida, extra) => ({ id: `t${++secuencia}`, ticket: String(1000 + secuencia), material, kg, fechaEntrada: fechaSalida, fechaSalida, ...extra });
const version = (materialEntrada, v, fechaVigencia, fechaCierre) => ({
  id: `c${++secuencia}`, materialEntrada, version: v, fechaVigencia, fechaCierre: fechaCierre === undefined ? null : fechaCierre,
  componentes: [{ subproducto: 'P.E.', porcentaje: 100, esMerma: false }]
});

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

caso('(1) Material sin composición y 3 tickets: una fila con los kg y tickets sumados y la primera fecha mínima', () => {
  const { filas, noEvaluables } = calcular([
    ticket('LECHERO', 100, '2026-09-10'), ticket('LECHERO', 250.5, '2026-08-31'), ticket('LECHERO', 49.5, '2026-09-20')
  ], []);
  igual(filas.length, 1, 'una fila');
  const f = filas[0];
  igual([f.material, f.tipo, f.kgPendientes, f.kgTotalRecibidos, f.tickets], ['LECHERO', 'SIN_COMPOSICION', 400, 400, 3], 'datos de la fila');
  igual([f.primeraFecha, f.ultimaFecha, f.primeraVigenciaExistente, f.inconsistencia], ['2026-08-31', '2026-09-20', null, false], 'fechas y banderas');
  igual(noEvaluables, 0, 'sin no evaluables');
});

caso('(2) v1 desde 2026-08-01 y un ticket de 2026-07-15: COBERTURA_INCOMPLETA con solo los kg de julio', () => {
  const { filas } = calcular(
    [ticket('LECHERO', 300, '2026-07-15'), ticket('LECHERO', 700, '2026-08-20')],
    [version('LECHERO', 1, '2026-08-01')]
  );
  igual(filas.length, 1, 'una fila');
  const f = filas[0];
  igual([f.tipo, f.kgPendientes, f.kgTotalRecibidos, f.tickets, f.primeraFecha, f.primeraVigenciaExistente], ['COBERTURA_INCOMPLETA', 300, 1000, 1, '2026-07-15', '2026-08-01'], 'solo julio pendiente');
});

caso('(3) Alias GARRAFA en el ticket y composición guardada como BIDON: sin pendiente (K1)', () => {
  igual(w.normalizarMaterial('GARRAFA'), 'BIDON', 'el alias existe en config.js');
  const { filas } = calcular([ticket('GARRAFA', 542, '2026-09-05')], [version('BIDON', 1, '2026-01-01')]);
  igual(filas, [], 'cubierto');
  const al_reves = calcular([ticket('BIDON', 542, '2026-09-05')], [version('GARRAFA', 1, '2026-01-01')]);
  igual(al_reves.filas, [], 'cubierto también al revés');
});

caso('(3b) Datos reales simulados: 6 materiales SIN_COMPOSICION en ese orden y sin los molidos', () => {
  const t = [];
  const repartir = (material, total, n, fechas) => {
    const base = Math.floor(total / n);
    for (let i = 0; i < n; i++) t.push(ticket(material, i === n - 1 ? total - base * (n - 1) : base, fechas[i % fechas.length]));
  };
  const fechas = ['2026-08-31', '2026-09-05', '2026-09-10', '2026-09-15', '2026-09-20', '2026-09-24'];
  repartir('LECHERO', 48088, 8, fechas);
  repartir('P.E.', 10670, 5, fechas);
  repartir('P.P.', 6858, 2, fechas);
  repartir('DURO', 6370, 8, fechas);
  repartir('VERDE', 670, 1, fechas);
  repartir('BIDON', 542, 2, fechas);
  repartir('P.P MOLIDO', 4552, 2, fechas);
  repartir('LECHERO MOLIDO', 1110, 1, fechas);
  const { filas } = calcular(t, []);
  igual(filas.map((f) => [f.material, f.tipo, f.kgPendientes, f.tickets]), [
    ['LECHERO', 'SIN_COMPOSICION', 48088, 8], ['P.E.', 'SIN_COMPOSICION', 10670, 5], ['P.P.', 'SIN_COMPOSICION', 6858, 2],
    ['DURO', 'SIN_COMPOSICION', 6370, 8], ['VERDE', 'SIN_COMPOSICION', 670, 1], ['BIDON', 'SIN_COMPOSICION', 542, 2]
  ], 'seis filas en orden de kg');
});

caso('(4) P.P. MOLIDO, un PELLET, MATERIAL VIRGEN, un rechazo y un PZ no aparecen', () => {
  const { filas } = calcular([
    ticket('P.P. MOLIDO', 100, '2026-09-01'), ticket('PELLET CAJAS', 100, '2026-09-01'), ticket('MATERIAL VIRGEN', 100, '2026-09-01'),
    ticket('RECHAZO CAJAS P.E.', 100, '2026-09-01'), ticket('CAJA CO30', 100, '2026-09-01'), ticket('MIXTO', 100, '2026-09-01')
  ], []);
  igual(filas.map((f) => f.material), ['MIXTO'], 'solo el crudo');
  // Si la lista de requeridos se pasa por parámetro, manda esa lista.
  const acotada = calcular([ticket('MIXTO', 100, '2026-09-01'), ticket('LECHERO', 50, '2026-09-01')], [], { materialesRequeridos: ['LECHERO'] });
  igual(acotada.filas.map((f) => f.material), ['LECHERO'], 'materialesRequeridos por parámetro');
  // Un PZ nunca aparece aunque se pase como requerido.
  igual(calcular([ticket('CAJA CO30', 100, '2026-09-01')], [], { materialesRequeridos: ['CAJA CO30'] }).filas, [], 'PZ excluido');
});

caso('(5) Dos versiones abiertas del mismo material: inconsistencia true', () => {
  const { filas } = calcular(
    [ticket('LECHERO', 100, '2026-07-01')],
    [version('LECHERO', 1, '2026-08-01'), version('LECHERO', 2, '2026-09-01')]
  );
  igual(filas.length, 1, 'el ticket anterior a ambas versiones queda pendiente');
  igual([filas[0].tipo, filas[0].inconsistencia], ['COBERTURA_INCOMPLETA', true], 'inconsistencia');
  const normal = calcular([ticket('LECHERO', 100, '2026-07-01')], [version('LECHERO', 1, '2026-08-01', '2026-08-31'), version('LECHERO', 2, '2026-09-01')]);
  igual(normal.filas[0].inconsistencia, false, 'una cerrada y una abierta no es inconsistencia');
});

caso('(6) El orden es por kg pendientes descendente', () => {
  const { filas } = calcular([
    ticket('VERDE', 10, '2026-09-01'), ticket('DURO', 500, '2026-09-01'), ticket('LECHERO', 100, '2026-09-01'), ticket('P.E.', 100, '2026-09-02')
  ], []);
  igual(filas.map((f) => f.material), ['DURO', 'LECHERO', 'P.E.', 'VERDE'], 'orden (empate por nombre)');
});

caso('Tickets no evaluables: sin fecha, sin material o con kg <= 0 se cuentan aparte y no suman', () => {
  const { filas, noEvaluables } = calcular([
    ticket('LECHERO', 100, '2026-09-01'),
    { id: 'x1', ticket: '1', material: 'LECHERO', kg: 50, fechaEntrada: '', fechaSalida: '' },
    ticket('LECHERO', 0, '2026-09-01'),
    ticket('LECHERO', -5, '2026-09-01'),
    ticket('', 80, '2026-09-01'),
    ticket('P.P. MOLIDO', 0, '2026-09-01')
  ], []);
  igual(filas.map((f) => [f.material, f.kgPendientes, f.tickets]), [['LECHERO', 100, 1]], 'solo el ticket válido');
  igual(noEvaluables, 4, 'sin fecha, kg 0, kg negativo y sin material; el molido con kg 0 no cuenta (no es evaluable por catálogo)');
});

caso('La fecha cae en fechaEntrada cuando falta fechaSalida y la vigencia de una versión cerrada cubre su rango', () => {
  const { filas } = calcular(
    [{ id: 'e1', ticket: '1', material: 'LECHERO', kg: 100, fechaEntrada: '2026-08-15', fechaSalida: '' },
      ticket('LECHERO', 200, '2026-09-15')],
    [version('LECHERO', 1, '2026-08-01', '2026-08-31')]
  );
  igual(filas.map((f) => [f.tipo, f.kgPendientes, f.primeraFecha]), [['COBERTURA_INCOMPLETA', 200, '2026-09-15']], 'agosto cubierto por la v1 cerrada; septiembre pendiente');
});

caso('Es pura: no modifica los datos de entrada', () => {
  const tickets = [ticket('LECHERO', 100, '2026-09-01')];
  const comps = [version('LECHERO', 1, '2026-10-01')];
  const antes = JSON.stringify([tickets, comps]);
  calcular(tickets, comps);
  igual(JSON.stringify([tickets, comps]), antes, 'entradas intactas');
  igual(calcular([], []), { filas: [], noEvaluables: 0 }, 'sin datos');
  igual(calcular(undefined, undefined), { filas: [], noEvaluables: 0 }, 'undefined tolerado');
});

// ── K20c: funciones puras del botón Capturar y de la relectura antes de guardar ────────────────

caso('K20c: vigencia sugerida = primera fecha pendiente; si no es posterior a la versión abierta, el día siguiente con aviso', () => {
  const R = w.EVE_RENDIMIENTOS;
  igual(R.calcularVigenciaSugerida('2026-08-31', null), { fecha: '2026-08-31', aviso: null }, 'sin versión abierta');
  const abierta = version('LECHERO', 1, '2026-08-01');
  igual(R.calcularVigenciaSugerida('2026-09-05', abierta), { fecha: '2026-09-05', aviso: null }, 'primera fecha posterior a la vigencia');
  const ajustada = R.calcularVigenciaSugerida('2026-07-15', abierta);
  igual(ajustada.fecha, '2026-08-02', 'día siguiente a la vigencia');
  afirmar(/no quedarán cubiertos/.test(ajustada.aviso), 'avisa que los tickets anteriores no quedan cubiertos');
  igual(R.calcularVigenciaSugerida('2026-08-01', abierta).fecha, '2026-08-02', 'igual a la vigencia tampoco es posterior');
  igual(R.calcularVigenciaSugerida('2026-01-01', version('LECHERO', 1, '2026-08-31')).fecha, '2026-09-01', 'cruza de mes');
  igual(R.calcularVigenciaSugerida('2026-01-01', version('LECHERO', 1, '2026-12-31')).fecha, '2027-01-01', 'cruza de año');
});

caso('K20c: la fecha sugerida es válida para construirNuevaComposicion cuando ya hay una versión abierta', () => {
  const R = w.EVE_RENDIMIENTOS;
  const abierta = version('LECHERO', 1, '2026-08-01');
  const { fecha } = R.calcularVigenciaSugerida('2026-07-15', abierta);
  const datos = { materialEntrada: 'LECHERO', fechaVigencia: fecha, motivo: 'captura', actualizadoPor: 'prueba', componentes: [{ subproducto: 'P.E.', porcentaje: 100, esMerma: false, procesosValidos: [], procesoSugerido: null }] };
  const { nuevo, cierre } = R.construirNuevaComposicion(datos, abierta);
  igual([nuevo.version, nuevo.fechaVigencia, cierre.fechaCierre], [2, '2026-08-02', '2026-08-01'], 'no lanza y cierra la anterior');
});

caso('K20c: nombresGuardadosDeMaterial incluye el oficial y sus alias (para la consulta a Firestore con in)', () => {
  const nombres = w.EVE_RENDIMIENTOS.nombresGuardadosDeMaterial('garrafa');
  afirmar(nombres.includes('BIDON') && nombres.includes('GARRAFA'), 'BIDON y GARRAFA: ' + nombres.join(','));
  afirmar(w.EVE_RENDIMIENTOS.nombresGuardadosDeMaterial('LECHERO').length <= 10, 'cabe en el límite de 10 de in');
});

caso('K20c: composicionesDifieren detecta versiones nuevas, cierres y borrados en el servidor (y normaliza alias)', () => {
  const R = w.EVE_RENDIMIENTOS;
  const v1 = { ...version('LECHERO', 1, '2026-08-01'), id: 'a' };
  const v2 = { ...version('LECHERO', 2, '2026-09-01'), id: 'b' };
  const otro = { ...version('P.E.', 1, '2026-08-01'), id: 'z' };
  igual(R.composicionesDifieren([v1, otro], [v1], 'LECHERO'), false, 'igual (las de otros materiales no cuentan)');
  igual(R.composicionesDifieren([v1], [v1, v2], 'LECHERO'), true, 'el servidor tiene una versión nueva');
  igual(R.composicionesDifieren([v1, v2], [v1], 'LECHERO'), true, 'el servidor ya no tiene una versión');
  igual(R.composicionesDifieren([v1], [{ ...v1, fechaCierre: '2026-08-31' }], 'LECHERO'), true, 'el servidor la cerró');
  igual(R.composicionesDifieren([{ ...v1, materialEntrada: 'GARRAFA', id: 'g' }], [{ ...v1, materialEntrada: 'BIDON', id: 'g' }], 'BIDON'), false, 'mismo documento con alias distinto en cada lado');
  igual(R.composicionesDifieren([], [], 'LECHERO'), false, 'sin versiones en ambos');
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
