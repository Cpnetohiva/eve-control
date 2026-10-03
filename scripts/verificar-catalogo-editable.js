// K22a1 — Verificación de window.EVE_CATALOGO (catálogo editable): equivalencia con el catálogo anterior, aplicar
// idempotente, materiales nuevos, archivados y listas que ya no son capturas.
//
// K22b (validación por entrada, errores y caché offline) también se prueba aquí; para la caché se carga js/offline.js
// con un IndexedDB en memoria.
//
// Carga en un vm js/config.js, js/utils.js y js/ventas.js. SNAPSHOT_BASE es el catálogo tal como estaba ANTES de
// K22a1 (generado desde js/config.js de HEAD): con una extensión vacía todo debe ser idéntico a él.
//
// Uso: node scripts/verificar-catalogo-editable.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/ventas.js'];

const SNAPSHOT_BASE = {
  catalogo: [
    {"nombre":"BIDON","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"CRISTAL CON ETIQUETA","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"CRISTAL SIN ETIQUETA","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"CRISTAL CON LECHERO","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"CRISTAL CON VERDE","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"DURO","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"LECHERO","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"LECHERO MOLIDO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"MIXTO","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"MIXTO 2","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"MULTI-COLOR","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"MULTILECHERO","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"P.E.","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"P.E. MOLIDO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"P.P.","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"P.P. MOLIDO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"PET","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"SUERO","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"VERDE","unidad":"KG","seObtieneEnProduccion":false},
    {"nombre":"PELLET TAMBO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"PELLET CAJAS","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"PELLET AGRO20","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"MATERIAL VIRGEN","unidad":"KG","seObtieneEnProduccion":false,"requiereSeleccion":false},
    {"nombre":"PET CRISTAL","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"PET ETIQUETA","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"PET VERDE","unidad":"KG","seObtieneEnProduccion":true},
    {"nombre":"BIDON MOLIDO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"SUERO MOLIDO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"SUERO PELETIZADO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"P.P. PELETIZADO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"P.E. PELETIZADO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"LECHERO PELETIZADO","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"PELLET TAPON","unidad":"KG","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"RECHAZO CAJAS P.E.","unidad":"KG","seObtieneEnProduccion":true,"recibible":false,"requiereSeleccion":false},
    {"nombre":"RECHAZO CAJAS P.P.","unidad":"KG","seObtieneEnProduccion":true,"recibible":false,"requiereSeleccion":false},
    {"nombre":"RECHAZO TAMBOS","unidad":"KG","seObtieneEnProduccion":true,"recibible":false,"requiereSeleccion":false},
    {"nombre":"TAMBO","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"CAJA CO30","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"CAJA CH25","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"CAJA AGRO20","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"ORING","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"SELLO","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false},
    {"nombre":"TAPON","unidad":"PZ","seObtieneEnProduccion":true,"requiereSeleccion":false}
  ],
  comunes: ["BIDON","CRISTAL CON ETIQUETA","CRISTAL SIN ETIQUETA","CRISTAL CON LECHERO","CRISTAL CON VERDE","DURO","LECHERO","LECHERO MOLIDO","MIXTO","MIXTO 2","MULTI-COLOR","MULTILECHERO","P.E.","P.E. MOLIDO","P.P.","P.P. MOLIDO","PET","SUERO","VERDE","PELLET TAMBO","PELLET CAJAS","PELLET AGRO20","MATERIAL VIRGEN","PET CRISTAL","PET ETIQUETA","PET VERDE","BIDON MOLIDO","SUERO MOLIDO","SUERO PELETIZADO","P.P. PELETIZADO","P.E. PELETIZADO","LECHERO PELETIZADO","PELLET TAPON"],
  pz: ["TAMBO","CAJA CO30","CAJA CH25","CAJA AGRO20","ORING","SELLO","TAPON"],
  producibles: ["LECHERO","LECHERO MOLIDO","P.E.","P.E. MOLIDO","P.P.","P.P. MOLIDO","SUERO","PELLET TAMBO","PELLET CAJAS","PELLET AGRO20","PET CRISTAL","PET ETIQUETA","PET VERDE","BIDON MOLIDO","SUERO MOLIDO","SUERO PELETIZADO","P.P. PELETIZADO","P.E. PELETIZADO","LECHERO PELETIZADO","PELLET TAPON","RECHAZO CAJAS P.E.","RECHAZO CAJAS P.P.","RECHAZO TAMBOS","TAMBO","CAJA CO30","CAJA CH25","CAJA AGRO20","ORING","SELLO","TAPON"],
  conStock: ["BIDON","CRISTAL CON ETIQUETA","CRISTAL SIN ETIQUETA","CRISTAL CON LECHERO","CRISTAL CON VERDE","DURO","LECHERO","LECHERO MOLIDO","MIXTO","MIXTO 2","MULTI-COLOR","MULTILECHERO","P.E.","P.E. MOLIDO","P.P.","P.P. MOLIDO","PET","SUERO","VERDE","PELLET TAMBO","PELLET CAJAS","PELLET AGRO20","MATERIAL VIRGEN","PET CRISTAL","PET ETIQUETA","PET VERDE","BIDON MOLIDO","SUERO MOLIDO","SUERO PELETIZADO","P.P. PELETIZADO","P.E. PELETIZADO","LECHERO PELETIZADO","PELLET TAPON","RECHAZO CAJAS P.E.","RECHAZO CAJAS P.P.","RECHAZO TAMBOS","TAMBO","CAJA CO30","CAJA CH25","CAJA AGRO20","ORING","SELLO","TAPON"],
  crudos: ["BIDON","CRISTAL CON ETIQUETA","CRISTAL SIN ETIQUETA","CRISTAL CON LECHERO","CRISTAL CON VERDE","DURO","LECHERO","MIXTO","MIXTO 2","MULTI-COLOR","MULTILECHERO","P.E.","P.P.","PET","SUERO","VERDE","PET CRISTAL","PET ETIQUETA","PET VERDE"],
  alias: {"CRISTAL CON ETIQ":"CRISTAL CON ETIQUETA","CRISTAL SIN ETIQ":"CRISTAL SIN ETIQUETA","MULTI-LECHERO":"MULTILECHERO","MIXTO2":"MIXTO 2","MULTICOLOR":"MULTI-COLOR","GARRAFA":"BIDON","PEAD":"DURO","P.E..":"P.E.","P.P MOLIDO":"P.P. MOLIDO","POLIETILENO":"P.E.","POLIPROPILENO":"P.P.","POLIETILENO MOLIDO":"P.E. MOLIDO","POLIPROPILENO MOLIDO":"P.P. MOLIDO","POLIETILENO PELETIZADO":"P.E. PELETIZADO","POLIPROPILENO PELETIZADO":"P.P. PELETIZADO","GARRAFA MOLIDA":"BIDON MOLIDO"},
  mermas: [{"nombre":"BASURA","procesos":["SELECCION"]},{"nombre":"LODOS","procesos":["MOLIENDA","LAVADO"]},{"nombre":"PIEDRAS","procesos":["PELETIZADO"]}]
};

function crearContexto(avisos) {
  // Siempre silencioso (los casos que prueban errores generan console.warn a propósito); los avisos se acumulan si se pide.
  const consola = { log() {}, error() {}, warn(...argumentos) { if (avisos) avisos.push(argumentos); } };
  const sandbox = {
    console: consola, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
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
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

// K22a2 agrega tipo, reglas y compraHabitual a las entradas base: la equivalencia con el catálogo de antes se mide
// sin esos campos (las listas derivadas, las unidades, las banderas y los alias no deben cambiar).
const CAMPOS_K22A2 = ['tipo', 'reglas', 'compraHabitual'];
const sinCamposNuevos = (m) => Object.fromEntries(Object.entries(m).filter(([clave]) => !CAMPOS_K22A2.includes(clave)));

const estado = (w) => ({
  catalogo: w.CATALOGO_MATERIALES.map(sinCamposNuevos), comunes: w.MATERIALES_COMUNES, pz: w.MATERIALES_PZ,
  producibles: w.materialesProducibles(), conStock: w.materialesConStock(), crudos: w.materialesQueRequierenSeleccion(),
  alias: w.MATERIALES_ALIAS, mermas: w.TIPOS_MERMA
});

const MATERIAL_NUEVO = { nombre: 'PLASTICO NUEVO', unidad: 'KG', seObtieneEnProduccion: true, recibible: true, requiereSeleccion: true, alias: ['PLAST NUEVO'] };
const PIEZA_NUEVA = { nombre: 'CAJA NUEVA', unidad: 'PZ', seObtieneEnProduccion: true, requiereSeleccion: false };

caso('Equivalencia: sin extensión todo es idéntico al catálogo de antes de K22a1', () => {
  const w = crearContexto();
  const actual = estado(w);
  Object.keys(SNAPSHOT_BASE).forEach((clave) => {
    igual(actual[clave], SNAPSHOT_BASE[clave], `lista ${clave}`);
  });
  igual(w.PRODUCTOS_VENTA, SNAPSHOT_BASE.conStock, 'PRODUCTOS_VENTA = materiales con stock');
  igual(w.productosVenta(), SNAPSHOT_BASE.conStock, 'productosVenta() = materiales con stock');
  igual(w.materialesPZ(), SNAPSHOT_BASE.pz, 'materialesPZ()');
});

caso('Cifras del catálogo base: 43 entradas (36 KG y 7 PZ), 33 recibibles, 30 producibles, 19 crudos, 16 alias', () => {
  const w = crearContexto();
  igual([w.CATALOGO_MATERIALES.length, w.CATALOGO_MATERIALES.filter((m) => m.unidad === 'KG').length, w.CATALOGO_MATERIALES.filter((m) => m.unidad === 'PZ').length], [43, 36, 7], 'entradas');
  igual([w.MATERIALES_COMUNES.length, w.materialesProducibles().length, w.materialesQueRequierenSeleccion().length, Object.keys(w.MATERIALES_ALIAS).length], [33, 30, 19, 16], 'listas');
});

caso('aplicar con undefined, null, {} o un valor que no es objeto deja exactamente el catálogo base', () => {
  const w = crearContexto();
  [undefined, null, {}, 'texto', 42, [], { materiales: 'x', overrides: [], mermas: {} }].forEach((extra) => {
    w.EVE_CATALOGO.aplicar(extra);
    igual(estado(w), SNAPSHOT_BASE, `aplicar(${JSON.stringify(extra)})`);
  });
});

caso('aplicar es idempotente: dos veces la misma extensión da el mismo resultado', () => {
  const w = crearContexto();
  const extra = { version: 1, materiales: { 'PLASTICO NUEVO': MATERIAL_NUEVO, 'CAJA NUEVA': PIEZA_NUEVA }, overrides: { BIDON: { activo: false, alias: ['GARRAFON'] } }, mermas: [{ nombre: 'ARENA', procesos: ['LAVADO'] }] };
  w.EVE_CATALOGO.aplicar(extra);
  const una = JSON.stringify([estado(w), w.PRODUCTOS_VENTA]);
  w.EVE_CATALOGO.aplicar(extra);
  igual(JSON.stringify([estado(w), w.PRODUCTOS_VENTA]), una, 'segunda aplicación idéntica');
  igual(w.CATALOGO_MATERIALES.length, 45, '43 base + 2 nuevos (no se acumulan)');
});

caso('Un material nuevo aparece en MATERIALES_COMUNES, materialesProducibles, productosVenta y PRODUCTOS_VENTA sin recargar', () => {
  const w = crearContexto();
  const referencia = w.CATALOGO_MATERIALES; // el arreglo se muta en sitio: las referencias existentes lo ven
  w.EVE_CATALOGO.aplicar({ materiales: { 'PLASTICO NUEVO': MATERIAL_NUEVO } });
  afirmar(w.MATERIALES_COMUNES.includes('PLASTICO NUEVO'), 'MATERIALES_COMUNES');
  afirmar(w.materialesProducibles().includes('PLASTICO NUEVO'), 'materialesProducibles');
  afirmar(w.materialesConStock().includes('PLASTICO NUEVO'), 'materialesConStock');
  afirmar(w.productosVenta().includes('PLASTICO NUEVO'), 'productosVenta()');
  afirmar(w.PRODUCTOS_VENTA.includes('PLASTICO NUEVO'), 'window.PRODUCTOS_VENTA (conservado por aplicar)');
  afirmar(w.materialesQueRequierenSeleccion().includes('PLASTICO NUEVO'), 'crudo (requiereSeleccion)');
  afirmar(referencia === w.CATALOGO_MATERIALES && referencia.length === 44, 'el arreglo del catálogo se mutó en sitio');
  igual(w.normalizarMaterial('  plast   nuevo '), 'PLASTICO NUEVO', 'el alias del material nuevo resuelve (normalizarMaterial)');
  // Y al quitar la extensión desaparece (siempre se parte del catálogo base).
  w.EVE_CATALOGO.aplicar(undefined);
  afirmar(!w.MATERIALES_COMUNES.includes('PLASTICO NUEVO') && referencia.length === 43, 'sin extensión vuelve al base');
  igual(w.normalizarMaterial('plast nuevo'), 'PLAST NUEVO', 'y el alias deja de resolver');
});

caso('Una pieza nueva (PZ): MATERIALES_PZ, materialesPZ() y la unidad en Ventas se actualizan (antes eran capturas al cargar)', () => {
  const w = crearContexto();
  igual(w.unidadParaProducto('CAJA NUEVA'), 'KG', 'antes de aplicar, fuera de catálogo = KG');
  w.EVE_CATALOGO.aplicar({ materiales: { 'CAJA NUEVA': PIEZA_NUEVA } });
  afirmar(w.MATERIALES_PZ.includes('CAJA NUEVA') && w.materialesPZ().includes('CAJA NUEVA'), 'MATERIALES_PZ y materialesPZ()');
  igual(w.unidadParaProducto('caja nueva'), 'PZ', 'unidadParaProducto de Ventas lee el catálogo al usarse');
  afirmar(!w.MATERIALES_COMUNES.includes('CAJA NUEVA'), 'una pieza no es recibible (MATERIALES_COMUNES solo KG)');
  afirmar(w.productosVenta().includes('CAJA NUEVA'), 'se puede vender');
});

caso('Un archivado desaparece de las listas de ALTA pero está en las históricas y sigue resolviendo', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ overrides: { 'PET CRISTAL': { activo: false, alias: ['PETCRISTAL'] } } });
  afirmar(!w.MATERIALES_COMUNES.includes('PET CRISTAL'), 'fuera de MATERIALES_COMUNES');
  afirmar(!w.materialesConStock().includes('PET CRISTAL'), 'fuera de materialesConStock');
  afirmar(!w.materialesProducibles().includes('PET CRISTAL'), 'fuera de materialesProducibles');
  afirmar(!w.materialesQueRequierenSeleccion().includes('PET CRISTAL'), 'fuera de materialesQueRequierenSeleccion');
  afirmar(!w.productosVenta().includes('PET CRISTAL') && !w.PRODUCTOS_VENTA.includes('PET CRISTAL'), 'fuera de productosVenta');
  afirmar(w.materialesConStockHistoricos().includes('PET CRISTAL'), 'en materialesConStockHistoricos');
  afirmar(w.materialesProduciblesHistoricos().includes('PET CRISTAL'), 'en materialesProduciblesHistoricos');
  igual(w.materialesConStockHistoricos().length, 43, 'las históricas siguen con 43');
  igual(w.materialesConStock().length, 42, 'las de alta bajan a 42');
  igual(w.normalizarMaterial('petcristal'), 'PET CRISTAL', 'un alias agregado a un material base resuelve');
  igual(w.normalizarMaterial('pet cristal'), 'PET CRISTAL', 'el nombre archivado sigue resolviendo');
  igual(w.EVE_CATALOGO.buscar('PET CRISTAL').activo, false, 'buscar lo encuentra, marcado como archivado');
  afirmar(!w.EVE_CATALOGO.listar().some((m) => m.nombre === 'PET CRISTAL'), 'listar() por omisión no incluye archivados');
  afirmar(w.EVE_CATALOGO.listar({ incluirArchivados: true }).some((m) => m.nombre === 'PET CRISTAL'), 'listar({incluirArchivados:true}) sí');
  // El catálogo base queda intacto (no se archiva por referencia compartida).
  w.EVE_CATALOGO.aplicar(undefined);
  igual(estado(w), SNAPSHOT_BASE, 'volver al base restaura todo');
});

caso('Una pieza archivada sigue en MATERIALES_PZ (la unidad de un registro histórico no cambia)', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ overrides: { TAPON: { activo: false } } });
  afirmar(w.materialesPZ().includes('TAPON') && w.MATERIALES_PZ.includes('TAPON'), 'TAPON sigue siendo pieza');
  afirmar(!w.materialesConStock().includes('TAPON'), 'pero ya no se ofrece en altas');
  igual(w.unidadParaProducto('TAPON'), 'PZ', 'y Ventas sigue sabiendo que es pieza');
});

caso('Mermas: la extensión agrega un tipo o reemplaza los procesos de uno existente', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ mermas: [{ nombre: 'ARENA', procesos: ['LAVADO'] }, { nombre: 'LODOS', procesos: ['MOLIENDA'] }] });
  igual(w.tiposMermaParaProceso('LAVADO'), ['ARENA'], 'LAVADO: LODOS ya no aplica y ARENA sí');
  igual(w.tiposMermaParaProceso('MOLIENDA'), ['LODOS'], 'MOLIENDA conserva LODOS');
  igual(w.nombresTiposMerma(), ['BASURA', 'LODOS', 'PIEDRAS', 'ARENA'], 'nombresTiposMerma');
  w.EVE_CATALOGO.aplicar(undefined);
  igual(w.TIPOS_MERMA, SNAPSHOT_BASE.mermas, 'sin extensión vuelve al base');
});

caso('buscar y listar devuelven copias; reglasDe devuelve {} sin reglas y copia con reglas', () => {
  const w = crearContexto();
  const copia = w.EVE_CATALOGO.buscar('lechero');
  copia.nombre = 'MODIFICADO';
  igual(w.EVE_CATALOGO.buscar('LECHERO').nombre, 'LECHERO', 'modificar la copia no cambia el catálogo');
  igual(w.EVE_CATALOGO.buscar('NO EXISTE'), null, 'material inexistente');
  igual(w.EVE_CATALOGO.reglasDe('MIXTO'), {}, 'un material sin reglas');
  igual(w.EVE_CATALOGO.reglasDe('lechero'), { muelePara: 'LECHERO MOLIDO' }, 'un material base con reglas (K22a2)');
  igual(w.EVE_CATALOGO.reglasDe('NO EXISTE'), {}, 'inexistente también {}');
  w.EVE_CATALOGO.aplicar({ materiales: { 'PLASTICO NUEVO': { ...MATERIAL_NUEVO, reglas: { muelePara: 'P.E. MOLIDO' } } } });
  const reglas = w.EVE_CATALOGO.reglasDe('PLASTICO NUEVO');
  igual(reglas, { muelePara: 'P.E. MOLIDO' }, 'reglas de un material con reglas');
  reglas.muelePara = 'X';
  igual(w.EVE_CATALOGO.reglasDe('PLASTICO NUEVO'), { muelePara: 'P.E. MOLIDO' }, 'copia');
  afirmar(w.EVE_CATALOGO.listar().length === 44, 'listar()');
});

caso('Ventas ya no captura la lista al cargar: window.PRODUCTOS_VENTA lo mantiene config.js, no ventas.js', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/ventas.js'), 'utf8');
  afirmar(!/const PRODUCTOS_VENTA\b/.test(fuente), 'ventas.js ya no define const PRODUCTOS_VENTA');
  afirmar(!/window\.PRODUCTOS_VENTA\s*=/.test(fuente), 'ventas.js ya no asigna window.PRODUCTOS_VENTA');
  afirmar(!/UNIDAD_POR_PRODUCTO/.test(fuente), 'ni la captura de unidades');
  const importador = fs.readFileSync(path.join(RAIZ, 'js/admin-importar.js'), 'utf8');
  afirmar(/window\.productosVenta\(\)/.test(importador) && !/window\.PRODUCTOS_VENTA/.test(importador), 'el importador llama productosVenta()');
});

// ── K22b: validación por entrada, errores y carga/caché de la extensión ───────────────────────────────────

const REGLAS_PIEZA_NUEVA = { procesoProduccion: 'PRODUCCION_CAJAS', pelletUsado: ['PELLET CAJAS'], rechazoGenerado: 'RECHAZO CAJAS P.E.' };
const EXT_VALIDA = {
  version: 3,
  materiales: {
    'PLASTICO NUEVO': { ...MATERIAL_NUEVO, reglas: { muelePara: 'P.E. MOLIDO' } },
    'CAJA NUEVA': { ...PIEZA_NUEVA, reglas: REGLAS_PIEZA_NUEVA }
  },
  overrides: { BIDON: { alias: ['GARRAFON'] } },
  mermas: [{ nombre: 'ARENA', procesos: ['LAVADO'] }]
};
const nuevo = (extra) => ({ unidad: 'KG', seObtieneEnProduccion: true, ...extra });
const conAvisos = () => { const avisos = []; const w = crearContexto(avisos); return { w, avisos }; };
const nombresOmitidos = (w) => w.EVE_CATALOGO.errores.map((e) => e.nombre).sort();
const motivoDe = (w, nombre) => (w.EVE_CATALOGO.errores.find((e) => e.nombre === nombre) || {}).motivo || '';
const catalogoBaseDe = (nombre) => SNAPSHOT_BASE.catalogo.find((m) => m.nombre === nombre);

caso('K22b-a. Una extensión válida se aplica por completo y errores queda vacía', () => {
  const { w, avisos } = conAvisos();
  w.EVE_CATALOGO.aplicar(EXT_VALIDA);
  igual(w.EVE_CATALOGO.errores, [], 'errores');
  igual(avisos.length, 0, 'sin console.warn');
  igual(w.CATALOGO_MATERIALES.length, 45, 'catálogo: 43 base + 2 nuevos');
  igual(w.normalizarMaterial('garrafon'), 'BIDON', 'alias agregado a un material base');
  igual(w.tiposMermaParaProceso('LAVADO'), ['LODOS', 'ARENA'], 'merma nueva');
  igual(w.EVE_CATALOGO.reglasDe('CAJA NUEVA'), REGLAS_PIEZA_NUEVA, 'reglas del material nuevo');
});

caso('K22b-b. validarExtension es pura: devuelve { validas, omitidas, ilegible } y no modifica la extensión ni el catálogo', () => {
  const w = crearContexto();
  const antes = JSON.stringify([EXT_VALIDA, estado(w)]);
  const r = w.EVE_CATALOGO.validarExtension(EXT_VALIDA);
  igual(Object.keys(r).sort(), ['ilegible', 'omitidas', 'validas'], 'forma del resultado');
  igual([r.ilegible, r.omitidas.length, Object.keys(r.validas.materiales).sort(), r.validas.version], [false, 0, ['CAJA NUEVA', 'PLASTICO NUEVO'], 3], 'todo válido');
  igual(JSON.stringify([EXT_VALIDA, estado(w)]), antes, 'ni la extensión ni el catálogo cambiaron');
});

caso('K22b-c. Un material de la extensión con el MISMO nombre que uno base se omite y el base queda intacto', () => {
  const { w, avisos } = conAvisos();
  // Escenario: una versión futura del código agrega a config.js un material que ya se había creado en pantalla.
  w.EVE_CATALOGO.aplicar({ materiales: { LECHERO: nuevo({ seObtieneEnProduccion: false, recibible: false }), 'PLASTICO NUEVO': MATERIAL_NUEVO } });
  igual(nombresOmitidos(w), ['LECHERO'], 'solo se omite LECHERO');
  afirmar(/colision de nombre con el material base LECHERO/.test(motivoDe(w, 'LECHERO')), motivoDe(w, 'LECHERO'));
  igual(Object.fromEntries(Object.entries(w.EVE_CATALOGO.buscar('LECHERO')).filter(([k]) => !['tipo', 'reglas', 'compraHabitual'].includes(k))), catalogoBaseDe('LECHERO'), 'el base LECHERO no cambió');
  afirmar(w.MATERIALES_COMUNES.includes('PLASTICO NUEVO'), 'el resto de la extensión sí se aplicó');
  igual(avisos.length, 1, 'un console.warn con la lista de omitidas');
  w.EVE_CATALOGO.aplicar({ materiales: { POLIETILENO: nuevo({}) } });
  afirmar(/alias base de P\.E\./.test(motivoDe(w, 'POLIETILENO')), 'un nombre que es alias de un base también colisiona: ' + motivoDe(w, 'POLIETILENO'));
});

caso('K22b-d. Una entrada con un alias en colisión se omite y el resto se aplica', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: {
    'ENT A': nuevo({ alias: ['GARRAFA'] }),        // alias de un base (BIDON)
    'ENT B': nuevo({ alias: ['MIXTO'] }),          // nombre de un base
    'ENT C': nuevo({ alias: ['C ALIAS'] }),
    'ENT D': nuevo({ alias: ['c   alias'] })       // el mismo alias que C (tras normalizar)
  } });
  igual(nombresOmitidos(w), ['ENT A', 'ENT B', 'ENT D'], 'omitidas');
  afirmar(/alias base de BIDON/.test(motivoDe(w, 'ENT A')) && /material base MIXTO/.test(motivoDe(w, 'ENT B')) && /alias de ENT C/.test(motivoDe(w, 'ENT D')), 'motivos: ' + w.EVE_CATALOGO.errores.map((e) => e.motivo).join(' | '));
  igual(w.normalizarMaterial('c alias'), 'ENT C', 'el alias de la entrada aceptada resuelve');
  igual(w.normalizarMaterial('garrafa'), 'BIDON', 'el alias base sigue intacto');
});

caso('K22b-e. Más de 9 alias en un material se omite (9 sí entra); los alias base cuentan', () => {
  const w = crearContexto();
  const alias = (n, pref) => Array.from({ length: n }, (_, i) => pref + i);
  w.EVE_CATALOGO.aplicar({ materiales: { 'CON NUEVE': nuevo({ alias: alias(9, 'N') }), 'CON DIEZ': nuevo({ alias: alias(10, 'D') }) } });
  igual(nombresOmitidos(w), ['CON DIEZ'], 'solo el de 10 alias');
  afirmar(/tiene 10 alias \(maximo 9/.test(motivoDe(w, 'CON DIEZ')), motivoDe(w, 'CON DIEZ'));
  igual(w.normalizarMaterial('n8'), 'CON NUEVE', 'los 9 alias aceptados resuelven');
  // P.E. ya tiene 2 alias base (P.E.., POLIETILENO): con 8 nuevos serían 10, con 7 son 9.
  w.EVE_CATALOGO.aplicar({ overrides: { 'P.E.': { alias: alias(8, 'PE') } } });
  afirmar(/tiene 10 alias/.test(motivoDe(w, 'P.E.')), 'la suma cuenta los alias base: ' + motivoDe(w, 'P.E.'));
  igual(w.normalizarMaterial('pe0'), 'PE0', 'un override omitido no aplica ninguno de sus alias');
  w.EVE_CATALOGO.aplicar({ overrides: { 'P.E.': { alias: [...alias(7, 'PE'), 'POLIETILENO'] } } });
  igual(w.EVE_CATALOGO.errores, [], 'repetir un alias base propio no cuenta ni colisiona: 2 base + 7 nuevos = 9');
  igual(w.normalizarMaterial('pe6'), 'P.E.', 'el override válido aplica');
});

caso('K22b-f. peletizaComo se rechaza como campo de reglas desconocido', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: { 'CON PELETIZA': nuevo({ reglas: { muelePara: 'P.E. MOLIDO', peletizaComo: ['PELLET CAJAS'] } }), 'CON OTRO': nuevo({ reglas: { inventado: 1 } }) } });
  igual(nombresOmitidos(w), ['CON OTRO', 'CON PELETIZA'], 'omitidas');
  afirmar(/campo de reglas desconocido: peletizaComo/.test(motivoDe(w, 'CON PELETIZA')) && /ya no existe/.test(motivoDe(w, 'CON PELETIZA')), motivoDe(w, 'CON PELETIZA'));
  afirmar(/campo de reglas desconocido: inventado/.test(motivoDe(w, 'CON OTRO')), motivoDe(w, 'CON OTRO'));
});

caso('K22b-g. Una regla a un material inexistente omite esa entrada y sus dependientes (en cascada) y aplica el resto', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: {
    'ENT A': nuevo({ reglas: { muelePara: 'NO EXISTE' } }),
    'ENT B': nuevo({ reglas: { pelletUsado: ['ENT A'] } }),          // depende de A
    'ENT E': nuevo({ reglas: { rechazoGenerado: 'ENT B' } }),         // depende de B (cascada)
    'ENT C': nuevo({ reglas: { muelePara: 'P.E. MOLIDO' } }),         // válida
    'ENT D': nuevo({ reglas: { pelletUsado: ['ENT C', 'PELLET CAJAS'] } }) // depende de C, que sí se aplica
  } });
  igual(nombresOmitidos(w), ['ENT A', 'ENT B', 'ENT E'], 'omitidas');
  afirmar(/apunta a 'NO EXISTE', que no existe/.test(motivoDe(w, 'ENT A')), motivoDe(w, 'ENT A'));
  afirmar(/depende de 'ENT A', que se omitio/.test(motivoDe(w, 'ENT B')), motivoDe(w, 'ENT B'));
  afirmar(/depende de 'ENT B', que se omitio/.test(motivoDe(w, 'ENT E')), motivoDe(w, 'ENT E'));
  afirmar(w.EVE_CATALOGO.buscar('ENT C') && w.EVE_CATALOGO.buscar('ENT D'), 'C y D sí se aplican');
  afirmar(!w.EVE_CATALOGO.buscar('ENT A') && !w.EVE_CATALOGO.buscar('ENT B') && !w.EVE_CATALOGO.buscar('ENT E'), 'A, B y E no están en el catálogo');
  igual(w.CATALOGO_MATERIALES.length, 45, '43 base + C + D');
});

caso('K22b-h. Unidad inválida, banderas no booleanas, proceso que no es de pieza, entrada que no es objeto y nombre vacío se omiten', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: {
    'UNIDAD MALA': { unidad: 'LT', seObtieneEnProduccion: true },
    'SIN UNIDAD': { seObtieneEnProduccion: true },
    'BANDERA MALA': nuevo({ recibible: 'si' }),
    'PROCESO MALO': nuevo({ reglas: { procesoProduccion: 'MOLIENDA' } }),
    'REGLAS MALAS': nuevo({ reglas: 'x' }),
    'NO OBJETO': 'texto',
    'BUENA': nuevo({ unidad: 'PZ', reglas: { procesoProduccion: 'PRODUCCION_TAMBOS' } })
  } });
  igual(nombresOmitidos(w), ['BANDERA MALA', 'NO OBJETO', 'PROCESO MALO', 'REGLAS MALAS', 'SIN UNIDAD', 'UNIDAD MALA'], 'omitidas');
  afirmar(/unidad invalida: "LT"/.test(motivoDe(w, 'UNIDAD MALA')) && /bandera recibible/.test(motivoDe(w, 'BANDERA MALA')) && /no es un proceso de pieza/.test(motivoDe(w, 'PROCESO MALO')), 'motivos');
  afirmar(w.EVE_CATALOGO.buscar('BUENA') && w.materialesPZ().includes('BUENA'), 'la válida (una pieza) sí entra');
});

caso('K22b-i. Una extensión que no es un objeto (string, número, booleano, array, null) se ignora entera y deja el base', () => {
  ['texto', 42, true, [], null, [EXT_VALIDA]].forEach((extra) => {
    const { w, avisos } = conAvisos();
    const r = w.EVE_CATALOGO.validarExtension(extra);
    igual([r.ilegible, r.omitidas.length, Object.keys(r.validas.materiales).length], [true, 1, 0], 'validarExtension(' + JSON.stringify(extra) + ')');
    w.EVE_CATALOGO.aplicar(extra);
    igual(estado(w), SNAPSHOT_BASE, 'aplicar(' + JSON.stringify(extra) + ') deja el catálogo base');
    igual(w.EVE_CATALOGO.errores.map((e) => e.nombre), ['(extension completa)'], 'un error que lo explica');
    igual(avisos.length, 1, 'con un console.warn');
  });
});

caso('K22b-j. Campo ausente o vacío no cambia nada, no reporta errores y no lanza', () => {
  [undefined, {}, { version: 1 }, { materiales: {}, overrides: {}, mermas: [] }].forEach((extra) => {
    const { w, avisos } = conAvisos();
    w.EVE_CATALOGO.aplicar(extra);
    igual(estado(w), SNAPSHOT_BASE, 'aplicar(' + JSON.stringify(extra) + ')');
    igual([w.EVE_CATALOGO.errores, avisos.length, w.EVE_CATALOGO.validarExtension(extra).ilegible], [[], 0, false], 'sin errores ni avisos');
  });
});

caso('K22b-k. Secciones mal formadas (materiales, overrides y mermas con otro tipo) se ignoran y se reportan', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: 'x', overrides: [], mermas: {} });
  igual(estado(w), SNAPSHOT_BASE, 'catálogo base');
  igual(nombresOmitidos(w), ['mermas', 'materiales', 'overrides'].sort(), 'una entrada de error por sección');
});

caso('K22b-l. aplicar NUNCA lanza: ante un error inesperado deja el catálogo base y lo reporta', () => {
  const { w, avisos } = conAvisos();
  w.EVE_CATALOGO.aplicar(EXT_VALIDA);
  afirmar(w.CATALOGO_MATERIALES.length === 45, 'primero una extensión válida');
  const hostil = {};
  Object.defineProperty(hostil, 'materiales', { enumerable: true, get() { throw new Error('boom'); } });
  let lanzo = false;
  try { w.EVE_CATALOGO.aplicar(hostil); } catch (e) { lanzo = true; }
  igual(lanzo, false, 'no lanzó');
  igual(estado(w), SNAPSHOT_BASE, 'quedó el catálogo base');
  afirmar(/error inesperado al aplicar: boom/.test(w.EVE_CATALOGO.errores[0].motivo), 'lo reporta: ' + w.EVE_CATALOGO.errores[0].motivo);
  afirmar(avisos.length >= 1, 'con console.warn');
  w.EVE_CATALOGO.aplicar(EXT_VALIDA);
  igual(w.EVE_CATALOGO.errores, [], 'y se recupera al aplicar una extensión válida');
});

caso('K22b-m. Overrides: solo sobre materiales base, solo activo y alias, con tipos correctos', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ materiales: { 'PLASTICO NUEVO': MATERIAL_NUEVO }, overrides: {
    'PLASTICO NUEVO': { activo: false },          // no es un material base
    'NO EXISTE': { activo: false },
    LECHERO: { compraHabitual: false },            // campo no permitido
    MIXTO: { activo: 'no' },                       // activo no booleano
    'MIXTO 2': 'texto',
    DURO: { activo: false, alias: ['DURO BLANCO'] } // válido
  } });
  igual(nombresOmitidos(w), ['LECHERO', 'MIXTO', 'MIXTO 2', 'NO EXISTE', 'PLASTICO NUEVO'], 'omitidos');
  afirmar(/solo aplican a materiales base/.test(motivoDe(w, 'NO EXISTE')) && /campo no permitido en un override: compraHabitual/.test(motivoDe(w, 'LECHERO')), 'motivos');
  igual(w.EVE_CATALOGO.buscar('DURO').activo, false, 'el override válido archiva DURO');
  igual(w.normalizarMaterial('duro blanco'), 'DURO', 'y agrega su alias');
});

caso('K22b-n. Mermas: proceso desconocido, nombre repetido o sin nombre se omiten; las demás se aplican', () => {
  const w = crearContexto();
  w.EVE_CATALOGO.aplicar({ mermas: [{ nombre: 'ARENA', procesos: ['LAVADO'] }, { nombre: 'arena', procesos: ['MOLIENDA'] }, { nombre: 'POLVO', procesos: ['INEXISTENTE'] }, { nombre: '', procesos: [] }, { nombre: 'LIMO', procesos: 'LAVADO' }, 'x', { nombre: 'FIBRA', procesos: ['SELECCION'] }] });
  igual(nombresOmitidos(w).length, 5, 'cinco omitidas: ' + nombresOmitidos(w).join(','));
  igual(w.nombresTiposMerma(), ['BASURA', 'LODOS', 'PIEDRAS', 'ARENA', 'FIBRA'], 'solo las válidas');
  igual(w.tiposMermaParaProceso('LAVADO'), ['LODOS', 'ARENA'], 'ARENA en LAVADO (la repetida con otro proceso no aplica)');
});

caso('K22b-o. auth.js y offline.js llaman a aplicar dentro de un try/catch (el login y el arranque no pueden romperse)', () => {
  const llamada = /try\s*\{\s*window\.EVE_CATALOGO\.aplicar\((configSistema|configCacheado)\.catalogoExtra\);\s*\}\s*catch\s*\(error\)\s*\{\s*console\.warn\(/;
  const auth = fs.readFileSync(path.join(RAIZ, 'js/auth.js'), 'utf8');
  const offline = fs.readFileSync(path.join(RAIZ, 'js/offline.js'), 'utf8');
  afirmar(llamada.test(auth), 'auth.js: aplicar dentro de try/catch');
  afirmar(llamada.test(offline), 'offline.js: aplicar dentro de try/catch');
  igual((auth.match(/EVE_CATALOGO\.aplicar\(/g) || []).length, 1, 'una sola llamada en auth.js');
  igual((offline.match(/EVE_CATALOGO\.aplicar\(/g) || []).length, 1, 'una sola llamada en offline.js');
  // cargarDatosEnParalelo guarda la extensión tal cual para la caché y para K22e, antes de aplicarla.
  afirmar(/window\.EVE\.catalogoExtra = configSistema\.catalogoExtra;\s*try \{/.test(auth), 'auth.js guarda window.EVE.catalogoExtra y luego aplica');
});

caso('K22b-r. PROCESOS_PIEZA de EVE_CATALOGO (usado para validar procesoProduccion) coincide con PROCESOS_PZ de control-produccion.js', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/control-produccion.js'), 'utf8');
  const procesosPZ = /const PROCESOS_PZ = \[([^\]]*)\]/.exec(fuente)[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean);
  igual(crearContexto().EVE_CATALOGO.PROCESOS_PIEZA, procesosPZ, 'PROCESOS_PIEZA');
});

// ── Caché offline: guardar y restaurar con un IndexedDB en memoria ───────────────────────────────────────

function crearIndexedDBFalso(almacen) {
  const clonar = (x) => structuredClone(x);
  return {
    open() {
      const req = {};
      setTimeout(() => {
        const db = {
          objectStoreNames: { contains: (n) => n in almacen },
          createObjectStore(n) { if (!(n in almacen)) almacen[n] = n === 'cache_datos' ? new Map() : []; },
          transaction(nombre) {
            const tx = {};
            tx.objectStore = () => ({
              put(valor) { if (nombre === 'cache_datos') almacen.cache_datos.set(valor.coleccion, clonar(valor)); },
              add() {}, delete() {}, count() { const r = {}; setTimeout(() => { r.result = 0; if (r.onsuccess) r.onsuccess(); }, 0); return r; },
              getAll() {
                const r = {};
                setTimeout(() => { r.result = nombre === 'cache_datos' ? Array.from(almacen.cache_datos.values()).map(clonar) : []; if (r.onsuccess) r.onsuccess(); }, 0);
                return r;
              }
            });
            setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
            return tx;
          }
        };
        req.result = db;
        if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: db } });
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

function crearContextoOffline(almacen) {
  const universal = new Proxy(function () {}, { get: () => universal, apply: () => universal, set: () => true });
  const sandbox = {
    console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    structuredClone, navigator: { onLine: true }, indexedDB: crearIndexedDBFalso(almacen), document: universal,
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { currentUser: { id: 'u1' } }; // guardarCacheDatos no escribe sin sesión (K24d)
  sandbox.window.EVE_MODULES = {};
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  for (const archivo of ['js/config.js', 'js/offline.js']) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

caso('K22b-p. Caché offline: guardar y restaurar reaplica la extensión con los MISMOS errores', async () => {
  const almacen = {};
  const EXT_CON_ERRORES = { ...EXT_VALIDA, materiales: { ...EXT_VALIDA.materiales, 'ENT A': nuevo({ reglas: { muelePara: 'NO EXISTE' } }), LECHERO: nuevo({}) } };
  const w1 = crearContextoOffline(almacen);
  w1.EVE.catalogoExtra = EXT_CON_ERRORES;
  w1.EVE_CATALOGO.aplicar(EXT_CON_ERRORES);
  afirmar(w1.EVE_CATALOGO.errores.length === 2, 'en línea: 2 entradas omitidas (ENT A y LECHERO)');
  await w1.EVE_OFFLINE.guardarCacheDatos();
  afirmar(JSON.stringify(almacen.cache_datos.get('config').registros[0].catalogoExtra) === JSON.stringify(EXT_CON_ERRORES), 'la caché guardó catalogoExtra tal cual');

  // Arranque sin red: contexto nuevo (catálogo base) que restaura desde la misma caché.
  const w2 = crearContextoOffline(almacen);
  igual(w2.CATALOGO_MATERIALES.length, 43, 'antes de restaurar: catálogo base');
  const restaurado = await w2.EVE_OFFLINE.cargarCacheDatos();
  igual(restaurado, true, 'cargarCacheDatos devolvió true');
  igual(w2.CATALOGO_MATERIALES.length, 45, 'la extensión se reaplicó (43 + 2 válidos)');
  igual(JSON.stringify(w2.EVE_CATALOGO.errores), JSON.stringify(w1.EVE_CATALOGO.errores), 'los mismos errores');
  igual(JSON.stringify(estado(w2)), JSON.stringify(estado(w1)), 'el mismo catálogo que en línea');
  igual(w2.normalizarMaterial('garrafon'), 'BIDON', 'los alias de la extensión resuelven');
  igual(JSON.stringify(w2.EVE.catalogoExtra), JSON.stringify(EXT_CON_ERRORES), 'window.EVE.catalogoExtra restaurado');
});

caso('K22b-q. Caché offline: sin extensión guardada o con un valor corrupto, el arranque no se rompe y queda el catálogo base', async () => {
  const sin = {};
  const wA = crearContextoOffline(sin);
  await wA.EVE_OFFLINE.guardarCacheDatos();
  const wB = crearContextoOffline(sin);
  igual(await wB.EVE_OFFLINE.cargarCacheDatos(), true, 'restaura sin extensión');
  igual([estado(wB), wB.EVE_CATALOGO.errores], [SNAPSHOT_BASE, []], 'catálogo base y sin errores');
  const corrupto = {};
  const wC = crearContextoOffline(corrupto);
  wC.EVE.catalogoExtra = 'basura';
  await wC.EVE_OFFLINE.guardarCacheDatos();
  const wD = crearContextoOffline(corrupto);
  igual(await wD.EVE_OFFLINE.cargarCacheDatos(), true, 'restaura con un valor corrupto sin lanzar');
  igual(estado(wD), SNAPSHOT_BASE, 'queda el catálogo base');
  igual(wD.EVE_CATALOGO.errores.map((e) => e.nombre), ['(extension completa)'], 'y reporta que la extensión es ilegible');
});

(async () => {
let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    await fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${error.message}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
})();
