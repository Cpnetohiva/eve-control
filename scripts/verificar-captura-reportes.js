// K21m — Verificación de reportes y Trazabilidad con registros de la captura simple.
//
// Carga en un contexto vm los js/ reales (config, utils, rendimientos, inventario, reglas, control-produccion, reportes y
// trazabilidad) y comprueba que:
//  - un registro de la captura simple (con mermaCalculada y ticketOrigenInferido) da EXACTAMENTE el mismo resultado en Por
//    Material, Por Proceso y Por Operador que el mismo registro de la captura completa;
//  - Por Proceso destaca el % de merma, el rendimiento y la merma por tipo en el cálculo, el TXT (que es la vista previa),
//    el CSV y Telegram, sin mostrar ninguna entrada de Peletizado (las mezclas son secreto industrial);
//  - Por Operador no cuenta el rechazo como pieza;
//  - Trazabilidad resuelve el origen por la pareja ticket + material, suma renglones repetidos y marca "(inferido)".
// El PDF usa jsPDF y autoTable (no se cargan aquí): comparte con el TXT el cálculo y las funciones de formato.
//
// Uso: node scripts/verificar-captura-reportes.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/inventario.js', 'js/control-produccion-reglas.js', 'js/control-produccion.js', 'js/reportes.js', 'js/trazabilidad.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosControlProduccion: [], composiciones: [], precios: [], ajustesPrecioProveedor: [], comisiones: [],
    ventas: [], registrosVentas: [], inventarioInicial: [], metaPiezasDia: {}, cuentasPorPagar: []
  };
  sandbox.window.EVE_MODULES = {};
  // Estas pruebas verifican la resolución de origen de Trazabilidad con un Peletizado de ejemplo: se simula un Admin con
  // escritura (K24c oculta las entradas de PELETIZADO sin ese permiso; eso se prueba en verificar-formulas-peletizado.js).
  sandbox.window.puedeVerFormulasPeletizado = () => true;
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
function cerca(real, esperado, mensaje) { afirmar(Math.abs(real - esperado) < 0.005, `${mensaje}: esperado ${esperado}, obtenido ${real}`); }

const PERIODO = { desde: '2026-09-01', hasta: '2026-09-30', etiquetaPeriodo: 'SEPTIEMBRE 2026' };
const COMPOSICION = {
  id: 'c1', materialEntrada: 'CRISTAL CON ETIQUETA', version: 1, fechaVigencia: '2026-08-01', fechaCierre: null, totalPorcentaje: 100,
  componentes: [
    { subproducto: 'PET CRISTAL', porcentaje: 80, esMerma: false }, { subproducto: 'PET ETIQUETA', porcentaje: 15, esMerma: false },
    { subproducto: 'PET VERDE', porcentaje: 3, esMerma: false }, { subproducto: 'BASURA', porcentaje: 2, esMerma: true }
  ]
};
const ENTRADA = { id: 'd10', ticket: '10', material: 'CRISTAL CON ETIQUETA', kg: 1000, proveedor: 'JESÚS', fechaEntrada: '2026-09-01', fechaSalida: '2026-09-01' };

// Registro de Selección armado por la captura completa (así era antes de K21).
function seleccionCompleta(w, extra) {
  return {
    id: 'p1', ticket: 'P-001', ...w.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario({
      tipoProceso: 'SELECCION', operador: 'LUIS', turno: 'Matutino', fecha: '2026-09-02', observaciones: '',
      inputs: [{ material: 'CRISTAL CON ETIQUETA', kg: '1000', ticketOrigen: '10' }],
      outputs: [{ material: 'PET CRISTAL', kg: '800', esMerma: false }, { material: 'PET ETIQUETA', kg: '150', esMerma: false },
        { material: 'PET VERDE', kg: '40', esMerma: false }, { material: 'BASURA', kg: '10', esMerma: true }]
    }), ...(extra || {})
  };
}

// El mismo registro tal como lo guarda la captura simple: igual más los campos opcionales.
function seleccionSimple(w) {
  const r = seleccionCompleta(w);
  r.inputs = r.inputs.map((i) => ({ ...i, ticketOrigenInferido: true }));
  r.mermaCalculada = true;
  return r;
}

function mundo(registros) {
  const w = crearContexto();
  w.EVE.registrosDestaraje = [ENTRADA];
  w.EVE.composiciones = [COMPOSICION];
  w.EVE.registrosControlProduccion = registros(w);
  return w;
}

const TIPO = { SELECCION: 'SELECCION', PELETIZADO: 'PELETIZADO', PRODUCCION_CAJAS: 'PRODUCCION_CAJAS' };
const construir = (w, datos) => ({ id: `r${Math.random()}`, ...w.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario({ operador: 'LUIS', turno: 'Matutino', fecha: '2026-09-05', observaciones: '', ...datos }) });

// ── La captura simple no cambia los resultados ───────────────────────────

caso('Un registro de la captura simple da el mismo rendimiento (Por Material, Por Proceso y Por Operador) que el de la captura completa', () => {
  const completo = mundo((w) => [seleccionCompleta(w)]);
  const simple = mundo((w) => [seleccionSimple(w)]);
  igual(simple.calcularRendimientoMaterial('CRISTAL CON ETIQUETA', PERIODO), completo.calcularRendimientoMaterial('CRISTAL CON ETIQUETA', PERIODO), 'Por Material');
  igual(simple.calcularRendimientoPorProceso('SELECCION', PERIODO), completo.calcularRendimientoPorProceso('SELECCION', PERIODO), 'Por Proceso');
  igual(simple.calcularRendimientoOperador(simple.EVE.registrosControlProduccion, 90), completo.calcularRendimientoOperador(completo.EVE.registrosControlProduccion, 90), 'Por Operador');
  igual(simple.generarTXTRendimientoPorProceso(simple.calcularRendimientoPorProceso('SELECCION', PERIODO), PERIODO),
    completo.generarTXTRendimientoPorProceso(completo.calcularRendimientoPorProceso('SELECCION', PERIODO), PERIODO), 'TXT de Por Proceso');
  const material = completo.calcularRendimientoMaterial('CRISTAL CON ETIQUETA', PERIODO);
  cerca(material.entradaTotalKg, 1000, 'la entrada del reporte por material');
});

// ── Por Proceso: % de merma ──────────────────────────────────────────────

caso('Por Proceso: la merma es la suma de los outputs esMerma, con su % de la entrada, el rendimiento y la merma por tipo', () => {
  const w = mundo((ws) => [
    seleccionSimple(ws),
    construir(ws, { tipoProceso: TIPO.SELECCION, inputs: [{ material: 'CRISTAL CON ETIQUETA', kg: '500', ticketOrigen: '10' }],
      outputs: [{ material: 'PET CRISTAL', kg: '440', esMerma: false }, { material: 'BASURA', kg: '60', esMerma: true }] })
  ]);
  const s = w.calcularRendimientoPorProceso('SELECCION', PERIODO).secciones[0];
  const sumaMerma = w.EVE.registrosControlProduccion.flatMap((r) => r.outputs).filter((o) => o.esMerma).reduce((a, o) => a + o.kg, 0);
  cerca(s.totalMerma, sumaMerma, 'totalMerma = suma de outputs esMerma');
  cerca(s.totalMerma, 70, 'merma total');
  cerca(s.totalInput, 1500, 'entrada total');
  cerca(s.porcentajeMerma, (70 / 1500) * 100, '% de merma del proceso');
  cerca(s.rendimiento, (1430 / 1500) * 100, 'rendimiento = no merma / entrada');
  cerca(s.porcentajeMerma + s.rendimiento, 100, 'merma y rendimiento suman 100 con la merma calculada por diferencia');
  igual(s.desgloseMerma.map((m) => [m.tipo, m.kg]), [['BASURA', 70]], 'merma por tipo');
  cerca(s.desgloseMerma[0].pctEntrada, (70 / 1500) * 100, '% de la entrada del tipo de merma');
  cerca(s.totalOutput, s.totalInput, 'con la merma por diferencia TOTAL OUTPUT = TOTAL INPUT (por eso se destaca el % de merma)');
});

caso('Por Proceso: un proceso de pieza no tiene % de merma ni rendimiento en kg, y el rechazo no cuenta como pieza', () => {
  const w = mundo((ws) => [construir(ws, { tipoProceso: TIPO.PRODUCCION_CAJAS, inputs: [{ material: 'PELLET CAJAS', kg: '470', ticketOrigen: '' }],
    outputs: [{ material: 'CAJA CO30', kg: '400', esMerma: false }, { material: 'RECHAZO CAJAS P.E.', kg: '50', esMerma: false }] })]);
  w.EVE.metaPiezasDia = { 'CAJA CO30': 1000 };
  const s = w.calcularRendimientoPorProceso('PRODUCCION_CAJAS', PERIODO).secciones[0];
  igual([s.porcentajeMerma, s.rendimiento], [null, null], 'sin % de merma ni rendimiento');
  igual(s.desgloseMerma, [], 'sin merma por tipo');
  igual(s.cumplimientoDiario.map((d) => [d.producto, d.piezas]), [['CAJA CO30', 400]], 'cumplimiento: solo las piezas (el rechazo no cuenta)');
  const txt = w.generarTXTRendimientoPorProceso({ secciones: [s] }, PERIODO);
  afirmar(/% MERMA: —/.test(txt) && /RENDIMIENTO \(NO MERMA \/ ENTRADA\): —/.test(txt), `TXT con "—": ${txt}`);
  afirmar(/CAJA CO30  400 KG(?!  \()/.test(txt), 'las piezas no llevan % de la entrada');
  afirmar(/RECHAZO CAJAS P\.E\.  50 KG  \(10\.64% de la entrada\)/.test(txt), `el rechazo (kg) sí: ${txt}`);
});

caso('Por Proceso: el TXT (que es la vista previa) muestra % de merma, rendimiento, merma por tipo y la nota del cambio de significado', () => {
  const w = mundo((ws) => [seleccionSimple(ws), construir(ws, { tipoProceso: TIPO.PRODUCCION_CAJAS, inputs: [{ material: 'PELLET CAJAS', kg: '470', ticketOrigen: '' }],
    outputs: [{ material: 'CAJA CO30', kg: '400', esMerma: false }] })]);
  const txt = w.generarTXTRendimientoPorProceso(w.calcularRendimientoPorProceso('SELECCION', PERIODO), PERIODO);
  for (const esperado of ['TOTAL MERMA: 10 KG', '% MERMA: 1.00%', 'RENDIMIENTO (NO MERMA / ENTRADA): 99.00%', 'PET CRISTAL  800 KG  (80.00% de la entrada)', 'MERMA POR TIPO:', 'BASURA  10 KG  (1.00% de la entrada)', 'NOTA: TOTAL OUTPUT incluye la merma']) {
    afirmar(txt.includes(esperado), `falta "${esperado}" en:\n${txt}`);
  }
  const todos = w.generarTXTRendimientoPorProceso(w.calcularRendimientoPorProceso('', PERIODO), PERIODO);
  afirmar(todos.includes('── Selección ──') && todos.includes('── Inyección ──') && todos.includes('% MERMA: 1.00%') && todos.includes('% MERMA: —'), 'modo Todos los procesos');
  igual(w.generarTXTRendimientoPorProceso({ secciones: [] }, PERIODO).includes('NOTA:'), false, 'sin procesos no hay nota');
});

caso('Por Proceso: el CSV conserva sus columnas y agrega concepto y pctEntrada al final, iguales en todas las filas', () => {
  const w = mundo((ws) => [seleccionSimple(ws), construir(ws, { tipoProceso: TIPO.PRODUCCION_CAJAS, inputs: [{ material: 'PELLET CAJAS', kg: '470', ticketOrigen: '' }],
    outputs: [{ material: 'CAJA CO30', kg: '400', esMerma: false }] })]);
  w.EVE.metaPiezasDia = { 'CAJA CO30': 1000 };
  const filas = w.construirFilasCSVRendimientoPorProceso(w.calcularRendimientoPorProceso('', PERIODO));
  const claves = Object.keys(filas[0]);
  igual(claves, ['tipoProceso', 'material', 'kg', 'fecha', 'piezas', 'metaPiezas', 'cumplimientoPct', 'concepto', 'pctEntrada'], 'columnas (las anteriores en su orden)');
  afirmar(filas.every((f) => JSON.stringify(Object.keys(f)) === JSON.stringify(claves)), 'todas las filas con las mismas columnas');
  const sel = filas.filter((f) => f.tipoProceso === 'SELECCION');
  igual(sel.map((f) => [f.concepto, f.material, f.kg, f.pctEntrada]), [
    ['SALIDA', 'PET CRISTAL', 800, 80], ['SALIDA', 'PET ETIQUETA', 150, 15], ['SALIDA', 'PET VERDE', 40, 4],
    ['MERMA', 'BASURA', 10, 1], ['RESUMEN', '% MERMA DEL PROCESO', 10, 1], ['RESUMEN', 'RENDIMIENTO (NO MERMA / ENTRADA)', '', 99]
  ], 'Selección: salidas, merma por tipo y resumen');
  const pieza = filas.filter((f) => f.tipoProceso === 'PRODUCCION_CAJAS');
  igual(pieza.find((f) => f.concepto === 'SALIDA').pctEntrada, '', 'una pieza no lleva % de la entrada');
  igual(pieza.filter((f) => f.concepto === 'RESUMEN').map((f) => f.pctEntrada), ['', ''], 'proceso de pieza: resumen sin %');
  afirmar(pieza.some((f) => f.concepto === 'CUMPLIMIENTO'), 'el cumplimiento se conserva');
});

caso('Telegram: solo cambia por el % de merma', () => {
  const w = mundo((ws) => [seleccionSimple(ws), construir(ws, { tipoProceso: TIPO.PRODUCCION_CAJAS, inputs: [{ material: 'PELLET CAJAS', kg: '470', ticketOrigen: '' }],
    outputs: [{ material: 'CAJA CO30', kg: '400', esMerma: false }] })]);
  const resultado = w.calcularRendimientoPorProceso('', PERIODO);
  const mensaje = w.construirMensajeRendimientoTelegram(PERIODO, null, null, 90, resultado);
  afirmar(/• Merma: 10 kg \(1\.00%\)  —  Eficiencia promedio: 99\.00%/.test(mensaje), `Selección con %: ${mensaje}`);
  afirmar(/• Merma: 0 kg  —  Eficiencia promedio: Sin meta configurada/.test(mensaje), `pieza sin %: ${mensaje}`);
  const sinPct = mensaje.replace(/ \(\d+\.\d+%\)/g, '');
  afirmar(/• Input: 1,?000 kg  —  Output: 1,?000 kg/.test(sinPct) && /📄 Ver PDF adjunto/.test(sinPct), 'el resto del mensaje no cambia');
});

caso('Ningún reporte de Por Proceso muestra las entradas de Peletizado: la mezcla es secreto industrial', () => {
  const w = mundo((ws) => [construir(ws, { tipoProceso: TIPO.PELETIZADO,
    inputs: [{ material: 'P.E. MOLIDO', kg: '300', ticketOrigen: '' }, { material: 'P.P. MOLIDO', kg: '200', ticketOrigen: '' }, { material: 'LECHERO MOLIDO', kg: '100', ticketOrigen: '' }],
    outputs: [{ material: 'PELLET CAJAS', kg: '580', esMerma: false }, { material: 'PIEDRAS', kg: '20', esMerma: true }] })]);
  const resultado = w.calcularRendimientoPorProceso('PELETIZADO', PERIODO);
  const todo = [
    w.generarTXTRendimientoPorProceso(resultado, PERIODO),
    JSON.stringify(w.construirFilasCSVRendimientoPorProceso(resultado)),
    w.construirMensajeRendimientoTelegram(PERIODO, null, null, 90, resultado),
    JSON.stringify(resultado)
  ].join('\n');
  afirmar(!/MOLIDO/.test(todo), `no debe aparecer ningún molido de entrada: ${todo.match(/.{0,30}MOLIDO.{0,30}/)}`);
  afirmar(/PELLET CAJAS  580 KG  \(96\.67% de la entrada\)/.test(todo), 'sí el pellet de salida y su % de la entrada');
  afirmar(/PIEDRAS  20 KG  \(3\.33% de la entrada\)/.test(todo), 'y la merma por tipo');
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/reportes.js'), 'utf8');
  afirmar(!/f[oó]rmulas?/i.test(fuente.slice(fuente.indexOf('function calcularMermaPorTipoProceso'), fuente.indexOf('window.construirFilasCSVRendimientoPorProceso'))), 'el código de Por Proceso no habla de fórmulas');
});

// ── Por Operador ─────────────────────────────────────────────────────────

caso('Por Operador: en las piezas, "salida" son los kg de rechazo y las piezas van aparte (el rechazo nunca es una pieza)', () => {
  const w = mundo((ws) => [construir(ws, { tipoProceso: TIPO.PRODUCCION_CAJAS, inputs: [{ material: 'PELLET CAJAS', kg: '470', ticketOrigen: '' }],
    outputs: [{ material: 'CAJA CO30', kg: '400', esMerma: false }, { material: 'RECHAZO CAJAS P.E.', kg: '50', esMerma: false }] })]);
  const fila = w.calcularRendimientoOperador(w.EVE.registrosControlProduccion, 90)[0].filas[0];
  igual([fila.esPZ, fila.piezas, fila.salida, fila.entrada, fila.eficiencia], [true, 400, 50, 470, null], 'piezas 400, salida (rechazo) 50 kg');
  const csv = w.construirFilasCSVRendimientoOperador(w.calcularRendimientoOperador(w.EVE.registrosControlProduccion, 90));
  igual(csv.find((f) => f.proceso === 'Inyección').piezas, 400, 'el CSV lleva solo las piezas en su columna');
});

// ── Trazabilidad ─────────────────────────────────────────────────────────

const renglon = (id, material, kg) => ({ id, ticket: '1066', material, kg, proveedor: 'JESÚS', fechaEntrada: '2026-09-08', fechaSalida: '2026-09-08' });
const datosTrz = (w, procesos) => ({
  registrosDestaraje: [renglon('r1', 'P.P.', 400), renglon('r2', 'P.P. MOLIDO', 300), renglon('r3', 'BIDON', 120), renglon('r4', 'P.P MOLIDO', 200)],
  registrosVentas: [], ventas: [], registrosControlProduccion: procesos, cuentasPorPagar: []
});
const proc = (w, ticket, material, kg, origen, inferido) => ({
  id: ticket, ticket, tipoProceso: 'PELETIZADO', fecha: '2026-09-09', operador: 'LUIS', turno: 'Matutino',
  inputs: [{ material, kg, ticketOrigen: origen, ...(inferido ? { ticketOrigenInferido: true } : {}) }],
  outputs: [{ material: 'PELLET CAJAS', kg: kg - 5, esMerma: false }, { material: 'PIEDRAS', kg: 5, esMerma: true }], totalInput: kg, totalOutput: kg, eficiencia: 100, porcentajeMerma: 0, observaciones: ''
});

caso('Trazabilidad: el origen se resuelve por la pareja ticket + material (BIDON no es el primer renglón del 1066)', () => {
  const w = crearContexto();
  const datos = datosTrz(w, [proc(w, 'P-001', 'BIDON', 100, '1066', true)]);
  const cadena = w.EVE_TRAZABILIDAD.construirCadena('P-001', datos);
  const origen = cadena.arbol.origenes[0];
  igual([origen.nodo.tipo, origen.nodo.ticket, origen.nodo.material, origen.nodo.kg], ['entrada', '1066', 'BIDON', 120], 'el nodo es el renglón de BIDON, no el de P.P.');
  igual(origen.inferido, true, 'marcado como inferido');
});

caso('Trazabilidad: dos renglones del mismo material (incluso con el nombre anterior) cuentan como un solo origen y suman sus kg', () => {
  const w = crearContexto();
  const datos = datosTrz(w, [proc(w, 'P-001', 'P.P. MOLIDO', 100, '1066', false)]);
  const origen = w.EVE_TRAZABILIDAD.construirCadena('P-001', datos).arbol.origenes[0];
  igual([origen.nodo.material, origen.nodo.kg], ['P.P. MOLIDO', 500], 'P.P. MOLIDO: 300 + 200 (guardado como P.P MOLIDO)');
  afirmar(!('inferido' in origen), 'un origen escrito a mano no se marca inferido');
  igual(w.EVE_TRAZABILIDAD.construirNodoEntrada('1066', datos.registrosDestaraje).material, 'P.P.', 'sin material se conserva el primer renglón (comportamiento de siempre)');
  igual(w.EVE_TRAZABILIDAD.construirNodoEntrada('1066', datos.registrosDestaraje, 'VERDE').material, 'P.P.', 'un material que el ticket no trae: también el primer renglón');
});

caso('Trazabilidad: "(inferido)" aparece junto al ticket de origen en la vista aplanada (TXT/CSV/PDF) y solo en los inferidos', () => {
  const w = crearContexto();
  const datos = datosTrz(w, [{ ...proc(w, 'P-002', 'BIDON', 100, '1066', true), inputs: [
    { material: 'BIDON', kg: 100, ticketOrigen: '1066', ticketOrigenInferido: true },
    { material: 'P.P. MOLIDO', kg: 100, ticketOrigen: '1066' }] }]);
  const arbol = w.EVE_TRAZABILIDAD.construirCadena('P-002', datos).arbol;
  const filas = [];
  w.EVE_TRAZABILIDAD.aplanarArbol(arbol, 0, filas);
  const etiquetas = filas.map((f) => f[0]);
  igual(etiquetas.filter((e) => /\(inferido\)/.test(e)), ['  ENTRADA 1066 — BIDON (inferido)'], 'solo el origen inferido');
  afirmar(etiquetas.includes('  ENTRADA 1066 — P.P. MOLIDO'), 'el origen manual sin marca');
});

caso('Trazabilidad: la búsqueda hacia adelante sigue enlazando la entrada de BIDON con el ticket 1066 (K1e)', () => {
  const w = crearContexto();
  const datos = datosTrz(w, [proc(w, 'P-001', 'BIDON', 100, '1066', true)]);
  const alcance = w.EVE_TRAZABILIDAD.recolectarAlcanzables('1066', datos);
  afirmar(alcance.procesos.has('P-001'), 'P-001 es alcanzable desde el 1066');
  const adelante = w.EVE_TRAZABILIDAD.construirCadena('1066', datos).arbol.destinos.map((d) => d.nodo.ticket);
  igual(adelante, ['P-001'], 'el ticket 1066 lleva a P-001');
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
