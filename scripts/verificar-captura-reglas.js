// K21a — Verificación de las reglas de proceso de la captura simplificada (js/control-produccion-reglas.js).
//
// Carga en un contexto vm js/config.js, js/utils.js, js/inventario.js y js/control-produccion-reglas.js y ejecuta casos
// sintéticos sobre window.EVE_CP_REGLAS: entradas derivadas por proceso (opcionesEntrada), salidas sugeridas, pellet y
// rechazo por producto. Las reglas de material se leen del catálogo (reglasDe): el módulo no fija nombres de materiales.
//
// Uso: node scripts/verificar-captura-reglas.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/inventario.js', 'js/control-produccion-reglas.js'];

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

const materialesDe = (opciones) => opciones.map((o) => o.material).sort();
const ofrece = (proceso, saldos, opciones) => materialesDe(R.opcionesEntrada(proceso, saldos, opciones));
const comp = (material, componentes) => ({
  materialEntrada: material, version: 1, fechaVigencia: '2026-08-01', fechaCierre: null,
  componentes: componentes.map(([subproducto, porcentaje, esMerma]) => ({ subproducto, porcentaje, esMerma: !!esMerma })),
  totalPorcentaje: componentes.reduce((s, c) => s + c[1], 0)
});
const filasDe = (resultado) => resultado.filas.map((f) => f.material);

// ── Salidas sugeridas ────────────────────────────────────────────────────

caso('Selección con composición de CRISTAL CON ETIQUETA precarga 3 filas sin kg', () => {
  const composicion = comp('CRISTAL CON ETIQUETA', [['PET CRISTAL', 80], ['PET ETIQUETA', 15], ['PET VERDE', 5]]);
  const r = R.salidasSugeridas('SELECCION', [{ material: 'CRISTAL CON ETIQUETA', kg: 1000 }], { composicion });
  igual(filasDe(r), ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE'], 'filas');
  afirmar(r.filas.every((f) => f.kg === null && f.esMerma === false && f.origen === 'composicion'), 'kg vacío, no merma, origen composición');
  igual(r.avisos, [], 'sin avisos');
});

caso('Selección sin composición avisa falta_composicion y no precarga', () => {
  const r = R.salidasSugeridas('SELECCION', [{ material: 'CRISTAL CON ETIQUETA', kg: 1000 }], { composicion: null });
  igual(r.filas, [], 'sin filas');
  igual(r.avisos.map((a) => a.codigo), ['falta_composicion'], 'aviso');
  afirmar(/CRISTAL CON ETIQUETA/.test(r.avisos[0].mensaje), 'el aviso nombra el material');
});

caso('Selección de DURO: filas P.P. y P.E. sin kg, merma BASURA y sin fila DURO', () => {
  const composicion = comp('DURO', [['P.P.', 60], ['P.E.', 35], ['BASURA', 5, true]]);
  const r = R.salidasSugeridas('SELECCION', [{ material: 'DURO', kg: 500 }], { composicion });
  igual(filasDe(r), ['P.P.', 'P.E.'], 'filas (sin DURO)');
  igual(r.merma, { material: 'BASURA', porcentajeEsperado: 5 }, 'merma esperada');
});

caso('Molienda: cada crudo y cada rechazo sugiere el molido del catálogo', () => {
  const sugerida = (material) => filasDe(R.salidasSugeridas('MOLIENDA', [{ material, kg: 100 }]));
  igual(sugerida('RECHAZO CAJAS P.E.'), ['P.E. MOLIDO'], 'RECHAZO CAJAS P.E.');
  igual(sugerida('RECHAZO CAJAS P.P.'), ['P.P. MOLIDO'], 'RECHAZO CAJAS P.P.');
  igual(sugerida('RECHAZO TAMBOS'), ['P.E. MOLIDO'], 'RECHAZO TAMBOS');
  igual(sugerida('LECHERO'), ['LECHERO MOLIDO'], 'LECHERO');
  igual(sugerida('BIDON'), ['BIDON MOLIDO'], 'BIDON');
  igual(sugerida('SUERO'), ['SUERO MOLIDO'], 'SUERO');
  igual(sugerida('P.E.'), ['P.E. MOLIDO'], 'P.E.');
  igual(sugerida('P.P.'), ['P.P. MOLIDO'], 'P.P.');
  igual(sugerida('DURO'), [], 'DURO no se muele');
  const dos = R.salidasSugeridas('MOLIENDA', [{ material: 'P.E.', kg: 1 }, { material: 'RECHAZO TAMBOS', kg: 1 }]);
  igual(filasDe(dos), ['P.E. MOLIDO'], 'el molido repetido se sugiere una sola vez');
  igual(R.salidasSugeridas('MOLIENDA', [{ material: 'P.E.', kg: 1 }]).avisos, [], 'no existe el aviso sin_molido');
});

caso('Empacado y Lavado: la salida es el mismo material de cada entrada', () => {
  igual(filasDe(R.salidasSugeridas('EMPACADO', [{ material: 'P.E.', kg: 10 }, { material: 'P.P.', kg: 5 }])), ['P.E.', 'P.P.'], 'Empacado');
  igual(filasDe(R.salidasSugeridas('LAVADO', [{ material: 'P.E. MOLIDO', kg: 10 }])), ['P.E. MOLIDO'], 'Lavado');
});

caso('Peletizado no sugiere ninguna salida ni con un input ni con varios', () => {
  const uno = R.salidasSugeridas('PELETIZADO', [{ material: 'P.E. MOLIDO', kg: 300 }]);
  const varios = R.salidasSugeridas('PELETIZADO', [{ material: 'P.E. MOLIDO', kg: 300 }, { material: 'P.P. MOLIDO', kg: 200 }]);
  igual(uno.filas, [], 'un input');
  igual(varios.filas, [], 'varios inputs');
  igual(R.salidasSugeridas('PELETIZADO', [], {}).filas, [], 'sin inputs');
  igual(R.salidasSugeridas('PELETIZADO', [{ material: 'P.E. MOLIDO', kg: 300 }]).merma, { material: 'PIEDRAS', porcentajeEsperado: null }, 'merma PIEDRAS por omisión');
});

caso('Piezas: producto y rechazo derivado; los tapones no llevan rechazo', () => {
  const agro = R.salidasSugeridas('PRODUCCION_CAJAS', [], { producto: 'CAJA AGRO20' });
  igual(filasDe(agro), ['CAJA AGRO20', 'RECHAZO CAJAS P.P.'], 'CAJA AGRO20');
  igual(agro.filas[0].unidad, 'PZ', 'el producto va en piezas');
  igual(filasDe(R.salidasSugeridas('PRODUCCION_CAJAS', [], { producto: 'CAJA CO30' })), ['CAJA CO30', 'RECHAZO CAJAS P.E.'], 'CAJA CO30');
  igual(filasDe(R.salidasSugeridas('PRODUCCION_CAJAS', [], { producto: 'CAJA CH25' })), ['CAJA CH25', 'RECHAZO CAJAS P.E.'], 'CAJA CH25');
  igual(filasDe(R.salidasSugeridas('PRODUCCION_TAMBOS', [], { producto: 'TAMBO' })), ['TAMBO', 'RECHAZO TAMBOS'], 'TAMBO');
  igual(filasDe(R.salidasSugeridas('PRODUCCION_TAPONES', [], { producto: 'TAPON' })), ['TAPON'], 'TAPON solo la fila del producto');
  igual(filasDe(R.salidasSugeridas('PRODUCCION_TAPONES', [], { producto: 'ORING' })), ['ORING'], 'ORING');
  igual(filasDe(R.salidasSugeridas('PRODUCCION_TAPONES', [], { producto: 'SELLO' })), ['SELLO'], 'SELLO');
  const fuera = R.salidasSugeridas('PRODUCCION_CAJAS', [], { producto: 'TAMBO' });
  igual(fuera.filas, [], 'un producto de otro proceso no se sugiere');
  igual(fuera.avisos.map((a) => a.codigo), ['producto_fuera_de_proceso'], 'aviso');
  igual(R.salidasSugeridas('PRODUCCION_CAJAS', [], {}).filas, [], 'sin producto no hay filas');
  igual(R.salidasSugeridas('PRODUCCION_CAJAS', [], { producto: 'CAJA CO30' }).merma, null, 'las piezas no llevan merma');
});

caso('Piezas: productos por proceso, pellets por producto y rechazo por producto salen del catálogo', () => {
  igual(R.productosDeProceso('PRODUCCION_TAMBOS'), ['TAMBO'], 'TAMBOS');
  igual(R.productosDeProceso('PRODUCCION_CAJAS').sort(), ['CAJA AGRO20', 'CAJA CH25', 'CAJA CO30'], 'CAJAS');
  igual(R.productosDeProceso('PRODUCCION_TAPONES').sort(), ['ORING', 'SELLO', 'TAPON'], 'TAPONES');
  igual(R.productosDeProceso('SELECCION'), [], 'un proceso de kg no produce piezas');
  igual(R.pelletsParaProducto('CAJA CO30'), ['PELLET CAJAS'], 'CAJA CO30');
  igual(R.pelletsParaProducto('CAJA CH25'), ['PELLET CAJAS'], 'CAJA CH25');
  igual(R.pelletsParaProducto('CAJA AGRO20'), ['PELLET AGRO20'], 'CAJA AGRO20');
  igual(R.pelletsParaProducto('TAMBO'), ['PELLET TAMBO'], 'TAMBO');
  for (const producto of ['TAPON', 'ORING', 'SELLO']) igual(R.pelletsParaProducto(producto), ['PELLET TAPON', 'MATERIAL VIRGEN'], producto);
  igual(R.pelletsParaProducto('LECHERO'), [], 'un material sin pellet');
  igual(R.rechazoParaProducto('CAJA CO30'), 'RECHAZO CAJAS P.E.', 'CAJA CO30');
  igual(R.rechazoParaProducto('CAJA CH25'), 'RECHAZO CAJAS P.E.', 'CAJA CH25');
  igual(R.rechazoParaProducto('CAJA AGRO20'), 'RECHAZO CAJAS P.P.', 'CAJA AGRO20');
  igual(R.rechazoParaProducto('TAMBO'), 'RECHAZO TAMBOS', 'TAMBO');
  for (const producto of ['TAPON', 'ORING', 'SELLO']) igual(R.rechazoParaProducto(producto), null, producto);
});

caso('tipoMermaPorDefecto: BASURA, LODOS y PIEDRAS; sin merma en Empacado y piezas', () => {
  igual(R.tipoMermaPorDefecto('SELECCION'), 'BASURA', 'SELECCION');
  igual(R.tipoMermaPorDefecto('MOLIENDA'), 'LODOS', 'MOLIENDA');
  igual(R.tipoMermaPorDefecto('LAVADO'), 'LODOS', 'LAVADO');
  igual(R.tipoMermaPorDefecto('PELETIZADO'), 'PIEDRAS', 'PELETIZADO');
  for (const proceso of ['EMPACADO', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES', 'NO_EXISTE']) igual(R.tipoMermaPorDefecto(proceso), null, proceso);
});

caso('REGLAS_PROCESO: salida, multiInput y sinMerma por proceso', () => {
  const reglas = w.REGLAS_PROCESO;
  igual(Object.keys(reglas).sort(), ['EMPACADO', 'LAVADO', 'MOLIENDA', 'PELETIZADO', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES', 'SELECCION'], 'procesos');
  igual(reglas.PELETIZADO.reglaSalida, 'libre', 'Peletizado es libre');
  igual(Object.keys(reglas).filter((p) => reglas[p].multiInput).sort(), ['EMPACADO', 'PELETIZADO'], 'multiInput');
  igual(Object.keys(reglas).filter((p) => reglas[p].sinMerma).sort(), ['EMPACADO', 'PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'], 'sinMerma');
  afirmar(w.PELLET_POR_PRODUCTO === undefined && w.MOLIDO_DE === undefined && w.PZ_POR_PROCESO === undefined && w.RECHAZO_POR_PRODUCTO === undefined, 'los mapas por material viven en el catálogo, no en config.js');
});

// ── Entradas derivadas ───────────────────────────────────────────────────

const SALDOS = {
  // Crudos recibidos y crudos ya seleccionados.
  'CRISTAL CON ETIQUETA': { 'RECEPCIÓN': 1000 },
  'PET CRISTAL': { 'SELECCIÓN': 800 },
  'LECHERO': { 'SELECCIÓN': 300 },
  'P.E.': { 'SELECCIÓN': 200, 'EMPACADO': 40 },
  'P.P.': { 'SELECCIÓN': 100 },
  'BIDON': { 'SELECCIÓN': 50 },
  'SUERO': { 'SELECCIÓN': 60 },
  'DURO': { 'SELECCIÓN': 70, 'RECEPCIÓN': 30 },
  'VERDE': { 'SELECCIÓN': 20 },
  'CRISTAL CON VERDE': { 'SELECCIÓN': 25 },
  'CRISTAL SIN ETIQUETA': { 'SELECCIÓN': 25 },
  'CRISTAL CON LECHERO': { 'SELECCIÓN': 25 },
  // Rechazos (etapa de la pieza que los genera) y molidos.
  'RECHAZO CAJAS P.E.': { 'INYECCIÓN': 15 },
  'RECHAZO CAJAS P.P.': { 'INYECCIÓN': 12 },
  'RECHAZO TAMBOS': { 'SOPLADO': 9 },
  'P.E. MOLIDO': { 'MOLIENDA': 50, 'RECEPCIÓN': 100 },
  'P.P. MOLIDO': { 'LAVADO': 80 },
  // Comprados que no se seleccionan.
  'MATERIAL VIRGEN': { 'RECEPCIÓN': 500 },
  'PELLET CAJAS': { 'PELETIZADO': 400, 'RECEPCIÓN': 10 },
  'PELLET TAPON': { 'PELETIZADO': 90 },
  // Una pieza nunca es entrada de kg.
  'CAJA CO30': { 'INYECCIÓN': 5000 }
};

caso('Selección ofrece solo crudos con saldo en RECEPCIÓN (no molidos, pellets ni MATERIAL VIRGEN)', () => {
  const lista = ofrece('SELECCION', SALDOS);
  igual(lista, ['CRISTAL CON ETIQUETA', 'DURO'], 'solo requiereSeleccion=true con saldo en RECEPCIÓN');
  for (const no of ['P.E. MOLIDO', 'PELLET CAJAS', 'MATERIAL VIRGEN']) afirmar(!lista.includes(no), `Selección no ofrece ${no}`);
});

caso('Empacado solo ofrece materiales con saldo en SELECCIÓN', () => {
  const lista = ofrece('EMPACADO', SALDOS);
  afirmar(lista.includes('P.E.') && lista.includes('PET CRISTAL'), 'ofrece lo que está en SELECCIÓN');
  afirmar(!lista.includes('P.E. MOLIDO') && !lista.includes('CRISTAL CON ETIQUETA') && !lista.includes('MATERIAL VIRGEN'), 'no ofrece molidos en MOLIENDA, RECEPCIÓN ni virgen');
  const soloEmpacado = R.opcionesEntrada('EMPACADO', { 'P.E.': { 'EMPACADO': 40 } });
  igual(soloEmpacado, [], 'saldo en la propia etapa EMPACADO no es origen');
});

caso('Molienda ofrece LECHERO, P.E., P.P., BIDON, SUERO y los tres rechazos, y nunca DURO, VERDE ni CRISTAL', () => {
  const esperado = ['BIDON', 'LECHERO', 'P.E.', 'P.P.', 'RECHAZO CAJAS P.E.', 'RECHAZO CAJAS P.P.', 'RECHAZO TAMBOS', 'SUERO'];
  igual(ofrece('MOLIENDA', SALDOS), esperado, 'lista con saldo');
  const todos = ofrece('MOLIENDA', SALDOS, { mostrarTodos: true });
  igual(todos, esperado, 'también con mostrarTodos');
  for (const no of ['DURO', 'VERDE', 'CRISTAL CON VERDE', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON ETIQUETA', 'CRISTAL CON LECHERO', 'PET CRISTAL']) {
    afirmar(!todos.includes(no), `Molienda no ofrece ${no}`);
  }
  const sinSaldo = ofrece('MOLIENDA', {}, { mostrarTodos: true });
  igual(sinSaldo, esperado, 'mostrarTodos las ofrece aunque no tengan saldo');
});

caso('Lavado y Peletizado ofrecen un molido comprado desde RECEPCIÓN; Selección no', () => {
  const lavado = R.opcionesEntrada('LAVADO', SALDOS).find((o) => o.material === 'P.E. MOLIDO');
  const peletizado = R.opcionesEntrada('PELETIZADO', SALDOS).find((o) => o.material === 'P.E. MOLIDO');
  igual(lavado.detalle, [{ etapa: 'MOLIENDA', saldo: 50 }, { etapa: 'RECEPCIÓN', saldo: 100 }], 'Lavado: MOLIENDA y RECEPCIÓN');
  igual(peletizado.detalle, [{ etapa: 'MOLIENDA', saldo: 50 }, { etapa: 'RECEPCIÓN', saldo: 100 }], 'Peletizado: MOLIENDA y RECEPCIÓN');
  igual(peletizado.saldoTotal, 150, 'saldo total');
  afirmar(R.opcionesEntrada('PELETIZADO', SALDOS).some((o) => o.material === 'P.P. MOLIDO'), 'Peletizado ofrece el molido de LAVADO');
  afirmar(!ofrece('LAVADO', SALDOS).includes('CRISTAL CON ETIQUETA'), 'Lavado no toma crudos de RECEPCIÓN');
  afirmar(!ofrece('SELECCION', SALDOS).includes('P.E. MOLIDO'), 'Selección no ofrece el molido');
});

caso('Piezas: la entrada son los pellets y los materiales sin selección en PELETIZADO o RECEPCIÓN', () => {
  const lista = ofrece('PRODUCCION_CAJAS', SALDOS);
  afirmar(['PELLET CAJAS', 'PELLET TAPON', 'MATERIAL VIRGEN'].every((m) => lista.includes(m)), 'pellets y virgen');
  afirmar(!lista.includes('CAJA CO30') && !lista.includes('CRISTAL CON ETIQUETA'), 'ni piezas ni crudos');
  igual(R.opcionesEntrada('PRODUCCION_CAJAS', SALDOS).find((o) => o.material === 'PELLET CAJAS').detalle.map((d) => d.etapa), ['PELETIZADO', 'RECEPCIÓN'], 'etapas de PELLET CAJAS');
});

caso('Etiquetas: una etapa y varias etapas', () => {
  const sel = R.opcionesEntrada('SELECCION', { 'PET CRISTAL': { 'RECEPCIÓN': 800 } });
  igual(sel[0].etiqueta, 'PET CRISTAL — 800 kg en RECEPCIÓN', 'una etapa');
  const lav = R.opcionesEntrada('LAVADO', SALDOS).find((o) => o.material === 'P.E. MOLIDO');
  igual(lav.etiqueta, 'P.E. MOLIDO — 150 kg (50 MOLIENDA · 100 RECEPCIÓN)', 'varias etapas');
});

caso('mostrarTodos quita el filtro de etapas y de saldo, salvo la lista de Molienda', () => {
  const sinFiltro = R.opcionesEntrada('SELECCION', { 'CRISTAL CON ETIQUETA': { 'RECEPCIÓN': 10 } }, { mostrarTodos: true });
  const nombres = materialesDe(sinFiltro);
  afirmar(nombres.includes('P.E. MOLIDO') && nombres.includes('MATERIAL VIRGEN') && nombres.includes('LECHERO'), 'ofrece materiales sin saldo ni etapa de origen');
  igual(sinFiltro.find((o) => o.material === 'P.E. MOLIDO').etiqueta, 'P.E. MOLIDO — sin saldo', 'etiqueta sin saldo');
  afirmar(!nombres.includes('CAJA CO30') && !nombres.includes('TAMBO'), 'las piezas nunca son entrada');
  const conSaldoFueraDeOrigen = R.opcionesEntrada('SELECCION', { 'P.E. MOLIDO': { 'MOLIENDA': 50 } }, { mostrarTodos: true }).find((o) => o.material === 'P.E. MOLIDO');
  igual(conSaldoFueraDeOrigen.detalle, [{ etapa: 'MOLIENDA', saldo: 50 }], 'con mostrarTodos el detalle trae cualquier etapa');
  igual(R.opcionesEntrada('SELECCION', { 'P.E. MOLIDO': { 'MOLIENDA': 50 } }).length, 0, 'sin mostrarTodos no');
});

caso('Sin saldo en las etapas de origen la lista queda vacía; un material archivado solo aparece si tiene saldo', () => {
  igual(R.opcionesEntrada('SELECCION', {}), [], 'vacía');
  igual(R.opcionesEntrada('SELECCION', { 'PET CRISTAL': { 'SELECCIÓN': 800 } }), [], 'saldo fuera de las etapas de origen');
  const w2 = crearContexto();
  w2.EVE_CATALOGO.aplicar({ version: 1, materiales: {}, overrides: { 'DURO': { activo: false } } });
  afirmar(w2.EVE_CATALOGO.estadoDe('DURO') === 'archivado', 'DURO quedó archivado');
  const R2 = w2.EVE_CP_REGLAS;
  igual(R2.opcionesEntrada('SELECCION', { 'DURO': { 'RECEPCIÓN': 10 } }).map((o) => o.material), ['DURO'], 'archivado con saldo se ofrece');
  igual(R2.opcionesEntrada('SELECCION', {}, { mostrarTodos: true }).map((o) => o.material).includes('DURO'), false, 'archivado sin saldo no, ni con mostrarTodos');
});

caso('El módulo no fija nombres de materiales del catálogo', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/control-produccion-reglas.js'), 'utf8');
  const citados = w.CATALOGO_MATERIALES.map((m) => m.nombre).filter((n) => fuente.includes(`'${n}'`) || fuente.includes(`"${n}"`));
  igual(citados, [], 'nombres de materiales escritos en el código');
});

// ── K21j y K21k: piezas, Peletizado y Selección con varios materiales ────

caso('La captura simple cubre todos los procesos con reglas; las piezas se reconocen por su regla', () => {
  for (const proceso of Object.keys(w.REGLAS_PROCESO)) afirmar(R.procesoSoportaCapturaSimple(proceso), `${proceso} soportado`);
  igual(R.procesoSoportaCapturaSimple('NO_EXISTE'), false, 'proceso desconocido');
  igual(Object.keys(w.REGLAS_PROCESO).filter((p) => R.esProcesoDePieza(p)).sort(), ['PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'], 'procesos de pieza');
  igual(R.reglaEntradasMultiples('PELETIZADO'), { permite: true, avisaMezcla: false }, 'Peletizado: varias entradas, sin aviso de mezcla');
  igual(R.reglaEntradasMultiples('SELECCION'), { permite: true, avisaMezcla: true }, 'Selección: con aviso de mezcla');
  for (const proceso of ['PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES']) igual(R.reglaEntradasMultiples(proceso).permite, false, `${proceso}: una sola entrada`);
});

caso('Peletizado: la salida es libre y las opciones son los pellets del catálogo (sin molidos, rechazos ni fórmulas)', () => {
  igual(R.salidasLibresPermitidas('PELETIZADO'),
    ['LECHERO PELETIZADO', 'P.E. PELETIZADO', 'P.P. PELETIZADO', 'PELLET AGRO20', 'PELLET CAJAS', 'PELLET TAMBO', 'PELLET TAPON', 'SUERO PELETIZADO'], 'salidas posibles');
  for (const proceso of ['SELECCION', 'EMPACADO', 'MOLIENDA', 'LAVADO', 'PRODUCCION_CAJAS']) igual(R.salidasLibresPermitidas(proceso), [], `${proceso} no tiene salida libre`);
  const w2 = crearContexto();
  w2.EVE_CATALOGO.aplicar({ version: 1, overrides: {}, materiales: { 'PELLET NUEVO': { nombre: 'PELLET NUEVO', unidad: 'KG', seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio' } } });
  afirmar(w2.EVE_CP_REGLAS.salidasLibresPermitidas('PELETIZADO').includes('PELLET NUEVO'), 'un pellet nuevo del catálogo aparece solo');
  w2.EVE_CATALOGO.aplicar({ version: 1, materiales: {}, overrides: { 'PELLET TAMBO': { activo: false } } });
  afirmar(!w2.EVE_CP_REGLAS.salidasLibresPermitidas('PELETIZADO').includes('PELLET TAMBO'), 'un pellet archivado ya no se ofrece');
  const salida = R.salidasSugeridas('PELETIZADO', [{ material: 'P.E. MOLIDO', kg: 300 }, { material: 'P.P. MOLIDO', kg: 200 }, { material: 'LECHERO MOLIDO', kg: 100 }]);
  igual([salida.filas, salida.avisos], [[], []], 'sin sugerencia de salida ni de mezcla');
});

const COMP_A = comp('CRISTAL CON ETIQUETA', [['PET CRISTAL', 80], ['PET ETIQUETA', 15], ['PET VERDE', 3], ['BASURA', 2, true]]);
const COMP_B = comp('MIXTO', [['PET CRISTAL', 50], ['P.E.', 40], ['BASURA', 10, true]]);

caso('combinarComposiciones: una sola es la misma; varias, promedio ponderado por kg sin nombres duplicados', () => {
  igual(R.combinarComposiciones([]), null, 'sin items');
  igual(R.combinarComposiciones([{ material: 'X', kg: 10, composicion: null }]), null, 'sin composiciones');
  afirmar(R.combinarComposiciones([{ material: 'CRISTAL CON ETIQUETA', kg: 10, composicion: COMP_A }, { material: 'Y', kg: 5, composicion: null }]) === COMP_A, 'una sola: la misma composición');
  const c = R.combinarComposiciones([{ material: 'CRISTAL CON ETIQUETA', kg: 600, composicion: COMP_A }, { material: 'MIXTO', kg: 400, composicion: COMP_B }]);
  igual(c.componentes.map((x) => [x.subproducto, x.porcentaje, x.esMerma]),
    [['PET CRISTAL', 68, false], ['PET ETIQUETA', 9, false], ['PET VERDE', 1.8, false], ['BASURA', 5.2, true], ['P.E.', 16, false]], 'ponderado 60/40');
  igual(Math.round(c.componentes.reduce((s, x) => s + x.porcentaje, 0) * 100) / 100, 100, 'sigue sumando 100');
  const igualPeso = R.combinarComposiciones([{ material: 'CRISTAL CON ETIQUETA', kg: 0, composicion: COMP_A }, { material: 'MIXTO', kg: 0, composicion: COMP_B }]);
  igual(igualPeso.componentes.find((x) => x.subproducto === 'BASURA').porcentaje, 6, 'sin kg pesan igual (2 y 10 -> 6)');
  const sinUno = R.combinarComposiciones([{ material: 'CRISTAL CON ETIQUETA', kg: 600, composicion: COMP_A }, { material: 'MIXTO', kg: 400, composicion: null }, { material: 'Z', kg: 100, composicion: COMP_B }]);
  igual(sinUno.componentes.find((x) => x.subproducto === 'BASURA').porcentaje, 3.14, 'un material sin composición no entra en el promedio: (2*600 + 10*100) / 700');
});

caso('Selección con varios materiales: precarga la UNIÓN de las composiciones y pondera la merma esperada por kg', () => {
  const items = [{ material: 'CRISTAL CON ETIQUETA', kg: 600, composicion: COMP_A }, { material: 'MIXTO', kg: 400, composicion: COMP_B }];
  const r = R.salidasSugeridas('SELECCION', items.map((i) => ({ material: i.material, kg: i.kg })), { composiciones: items });
  igual(filasDe(r), ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE', 'P.E.'], 'unión sin duplicar PET CRISTAL ni incluir la merma');
  igual(r.merma, { material: 'BASURA', porcentajeEsperado: 5.2 }, 'merma esperada ponderada');
  igual(r.avisos, [], 'sin avisos');
  const falta = R.salidasSugeridas('SELECCION', [], { composiciones: [{ material: 'CRISTAL CON ETIQUETA', kg: 600, composicion: COMP_A }, { material: 'mixto', kg: 400, composicion: null }] });
  igual(filasDe(falta), ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE'], 'con una composición faltante se precarga la del otro');
  igual(falta.avisos.map((a) => [a.codigo, a.material]), [['falta_composicion', 'MIXTO']], 'avisa de la que falta');
  const ninguna = R.salidasSugeridas('SELECCION', [], { composiciones: [{ material: 'A', kg: 1, composicion: null }, { material: 'B', kg: 1, composicion: null }] });
  igual([ninguna.filas, ninguna.avisos.map((a) => a.material)], [[], ['A', 'B']], 'sin ninguna: aviso por cada material');
  const uno = R.salidasSugeridas('SELECCION', [{ material: 'CRISTAL CON ETIQUETA', kg: 1000 }], { composiciones: [{ material: 'CRISTAL CON ETIQUETA', kg: 1000, composicion: COMP_A }] });
  const antes = R.salidasSugeridas('SELECCION', [{ material: 'CRISTAL CON ETIQUETA', kg: 1000 }], { composicion: COMP_A });
  igual([uno.filas, uno.merma], [antes.filas, antes.merma], 'con un solo material es igual que antes');
});

caso('Piezas: un pellet con saldo se preselecciona y solo se ofrecen los pellets del producto', () => {
  const opcionesDe = (proceso, producto, saldos, o) => R.opcionesEntradaPieza(proceso, producto, saldos || SALDOS, o);
  const co30 = opcionesDe('PRODUCCION_CAJAS', 'CAJA CO30');
  igual(co30.opciones.map((o) => o.material), ['PELLET CAJAS'], 'CAJA CO30');
  igual([co30.sugerida, co30.avisos], ['PELLET CAJAS', []], 'preseleccionado y sin avisos');
  igual(co30.opciones[0].etiqueta, 'PELLET CAJAS — 410 kg (400 PELETIZADO · 10 RECEPCIÓN)', 'etiqueta con saldo');
  igual(opcionesDe('PRODUCCION_CAJAS', 'CAJA CH25').opciones.map((o) => o.material), ['PELLET CAJAS'], 'CAJA CH25');
  const conAgro = { ...SALDOS, 'PELLET AGRO20': { 'PELETIZADO': 50 }, 'PELLET TAMBO': { 'PELETIZADO': 70 } };
  igual(opcionesDe('PRODUCCION_CAJAS', 'CAJA AGRO20', conAgro).opciones.map((o) => o.material), ['PELLET AGRO20'], 'CAJA AGRO20');
  igual(opcionesDe('PRODUCCION_TAMBOS', 'TAMBO', conAgro).opciones.map((o) => o.material), ['PELLET TAMBO'], 'TAMBO');
});

caso('Piezas: TAPON, ORING y SELLO eligen entre PELLET TAPON y MATERIAL VIRGEN (con el saldo de cada uno)', () => {
  for (const producto of ['TAPON', 'ORING', 'SELLO']) {
    const r = R.opcionesEntradaPieza('PRODUCCION_TAPONES', producto, SALDOS);
    igual(r.opciones.map((o) => [o.material, o.saldoTotal]), [['PELLET TAPON', 90], ['MATERIAL VIRGEN', 500]], `${producto}: dos opciones`);
    igual(r.sugerida, 'PELLET TAPON', `${producto}: sugerida la primera`);
  }
  const soloVirgen = { 'MATERIAL VIRGEN': { 'RECEPCIÓN': 500 } };
  const r = R.opcionesEntradaPieza('PRODUCCION_TAPONES', 'TAPON', soloVirgen);
  igual([r.opciones.map((o) => o.material), r.sugerida, r.avisos], [['PELLET TAPON', 'MATERIAL VIRGEN'], 'MATERIAL VIRGEN', []], 'sin saldo del primero: se sugiere el que tiene saldo');
  igual(r.opciones[0].etiqueta, 'PELLET TAPON — sin saldo', 'la opción sin saldo lo dice');
});

caso('Piezas: sin saldo de ningún pellet del producto avisa y deja elegir cualquier material con saldo en el origen', () => {
  const r = R.opcionesEntradaPieza('PRODUCCION_CAJAS', 'CAJA AGRO20', SALDOS);
  igual(r.avisos.map((a) => a.codigo), ['sin_saldo_pellet'], 'aviso');
  igual(r.opciones.map((o) => o.material), ['PELLET AGRO20', 'MATERIAL VIRGEN', 'P.E. MOLIDO', 'PELLET CAJAS', 'PELLET TAPON'], 'el pellet sin saldo primero y luego lo que tiene saldo en PELETIZADO o RECEPCIÓN');
  igual(r.sugerida, 'PELLET AGRO20', 'sugerida: el del producto');
  for (const no of ['P.P. MOLIDO', 'CAJA CO30', 'CRISTAL CON ETIQUETA']) afirmar(!r.opciones.some((o) => o.material === no), `no ofrece ${no} (fuera del origen, pieza o crudo)`);
});

caso('Piezas: Mostrar todos ofrece el resto después de los pellets del producto; sin producto no hay opciones', () => {
  const r = R.opcionesEntradaPieza('PRODUCCION_CAJAS', 'CAJA CO30', SALDOS, { mostrarTodos: true });
  igual(r.opciones[0].material, 'PELLET CAJAS', 'los del producto primero');
  afirmar(r.opciones.length > 1, 'y luego más materiales');
  igual(R.opcionesEntradaPieza('PRODUCCION_CAJAS', '', SALDOS), { opciones: [], avisos: [], sugerida: null }, 'sin producto');
  igual(R.opcionesEntradaPieza('SELECCION', 'CAJA CO30', SALDOS).opciones, [], 'un proceso que no es de pieza');
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
