// K22a1 — Verificación de window.EVE_CATALOGO (catálogo editable): equivalencia con el catálogo anterior, aplicar
// idempotente, materiales nuevos, archivados y listas que ya no son capturas.
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
