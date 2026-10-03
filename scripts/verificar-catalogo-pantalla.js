// K22d — Verificación de la pantalla de Admin «Catálogo» de solo lectura (js/admin-catalogo.js).
//
// Carga en un contexto vm config, utils, rendimientos, admin-catalogo y admin, y comprueba la lógica de presentación (filas con
// origen, filtros, orden, agrupación, conteo de usos, mapa de transformaciones y banner) y la vista con un DOM mínimo simulado
// (no es un navegador: no hay CSS). También comprueba que el código nuevo NO escribe en Firestore y que la pestaña solo la ve el
// Admin con escritura, el mismo permiso que protege la configuración.
//
// Uso: node scripts/verificar-catalogo-pantalla.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/admin-catalogo.js', 'js/admin.js'];

// ── DOM mínimo ───────────────────────────────────────────────────────────

class Nodo {
  constructor(etiqueta) {
    this.tagName = String(etiqueta).toUpperCase();
    this.children = [];
    this.parent = null;
    this.style = {};
    this.attrs = {};
    this.escuchas = {};
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.title = '';
    this.checked = false;
    this._v = '';
  }
  get value() { return this._v; }
  set value(v) { this._v = v === undefined || v === null ? '' : String(v); }
  appendChild(hijo) { hijo.parent = this; this.children.push(hijo); return hijo; }
  replaceChildren(...hijos) { this.children = []; hijos.forEach((h) => this.appendChild(h)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(tipo, fn) { (this.escuchas[tipo] = this.escuchas[tipo] || []).push(fn); }
  disparar(tipo) { (this.escuchas[tipo] || []).forEach((fn) => fn({ preventDefault() {}, target: this })); }
  descendientes() { return this.children.flatMap((c) => [c, ...c.descendientes()]); }
  texto() { return [this.textContent, ...this.children.map((c) => c.texto())].join(' ').replace(/\s+/g, ' ').trim(); }
}

function crearContexto(opciones) {
  const o = opciones || {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {
      createElement: (e) => new Nodo(e),
      createTextNode: (t) => { const n = new Nodo('#text'); n.textContent = t; return n; },
      getElementById: () => new Nodo('div'),
      querySelectorAll: () => []
    },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosVentas: [], registrosPagos: [], cuentasPorPagar: [], precios: [], ajustesPrecioProveedor: [],
    composiciones: [], registrosControlProduccion: [], inventarioInicial: [], inventario: [], ventas: [],
    currentUser: { permisosResueltos: { admin: o.admin === undefined ? 'escritura' : o.admin } }
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  const w = sandbox.window;
  w.obtenerFechaMexico = () => '2026-09-30';
  w.EVE.catalogoExtra = o.extension;
  w.EVE_CATALOGO.aplicar(o.extension);
  return w;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

const EXTENSION = {
  version: 3,
  materiales: {
    'PELLET NUEVO': { nombre: 'PELLET NUEVO', unidad: 'KG', seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'intermedio', alias: ['PEL NUEVO'] },
    'CAJA NUEVA': { nombre: 'CAJA NUEVA', unidad: 'PZ', seObtieneEnProduccion: true, requiereSeleccion: false, tipo: 'producto_terminado',
      reglas: { procesoProduccion: 'PRODUCCION_CAJAS', pelletUsado: ['PELLET NUEVO'] } },
    'LECHERO': { nombre: 'LECHERO', unidad: 'KG' },                      // colisión con un material base: se omite
    'MAL ALIAS': { nombre: 'MAL ALIAS', unidad: 'KG', alias: ['GARRAFA'] }, // alias base ocupado: se omite
    'UNIDAD RARA': { nombre: 'UNIDAD RARA', unidad: 'LT' }                 // unidad inválida: se omite
  },
  overrides: { 'DURO': { activo: false, alias: ['PEAD NEGRO'] } }
};

const contexto = (w) => ({ catalogo: w.CATALOGO_MATERIALES, extension: w.EVE.catalogoExtra, alias: w.MATERIALES_ALIAS, datos: w.EVE, hoy: '2026-09-30' });
const filasDe = (w) => w.EVE_ADMIN_CATALOGO.construirFilasCatalogo(contexto(w));
const nombres = (filas) => filas.map((f) => f.nombre);

// ── Filas, origen y banderas ─────────────────────────────────────────────

caso('Sin extensión: todas las filas son base, en el orden del catálogo, con las banderas normalizadas', () => {
  const w = crearContexto();
  const filas = filasDe(w);
  igual(filas.length, w.CATALOGO_MATERIALES.length, 'una fila por material');
  afirmar(filas.every((f) => f.origen === 'base' && !f.archivadoPorExtension), 'todas base');
  igual(nombres(filas), w.CATALOGO_MATERIALES.map((m) => m.nombre), 'orden del catálogo');
  const virgen = filas.find((f) => f.nombre === 'MATERIAL VIRGEN');
  igual([virgen.tipo, virgen.unidad, virgen.activo, virgen.recibible, virgen.requiereSeleccion, virgen.seObtieneEnProduccion, virgen.compraHabitual], ['materia_prima', 'KG', true, true, false, false, true], 'MATERIAL VIRGEN');
  const rechazo = filas.find((f) => f.nombre === 'RECHAZO CAJAS P.E.');
  igual([rechazo.recibible, rechazo.requiereSeleccion, rechazo.reglas], [false, false, { muelePara: ['P.E. MOLIDO'], etapaRechazo: ['INYECCIÓN'] }], 'RECHAZO CAJAS P.E.');
  const tapon = filas.find((f) => f.nombre === 'TAPON');
  igual(tapon.reglas, { pelletUsado: ['PELLET TAPON', 'MATERIAL VIRGEN'], procesoProduccion: ['PRODUCCION_TAPONES'] }, 'TAPON: pellet a elegir, sin rechazo');
  igual(filas.find((f) => f.nombre === 'PELLET TAMBO').compraHabitual, false, 'compraHabitual=false de un pellet');
});

caso('Con extensión: origen base o extensión, archivado por override y alias con su origen', () => {
  const w = crearContexto({ extension: EXTENSION });
  const filas = filasDe(w);
  const por = (n) => filas.find((f) => f.nombre === n);
  igual([por('PELLET NUEVO').origen, por('CAJA NUEVA').origen], ['extension', 'extension'], 'materiales de la extensión');
  igual(por('LECHERO').origen, 'base', 'el que colisiona con uno base sigue siendo el base');
  afirmar(!por('MAL ALIAS') && !por('UNIDAD RARA'), 'las entradas omitidas no aparecen como materiales');
  const duro = por('DURO');
  igual([duro.origen, duro.activo, duro.archivadoPorExtension], ['base', false, true], 'DURO: base, archivado por la extensión');
  igual(duro.alias.map((a) => [a.alias, a.origen]), [['PEAD', 'base'], ['PEAD NEGRO', 'extension']], 'alias base y de la extensión');
  igual(por('PELLET NUEVO').alias, [{ alias: 'PEL NUEVO', origen: 'extension' }], 'alias de un material de la extensión');
  igual(por('CAJA NUEVA').reglas, { pelletUsado: ['PELLET NUEVO'], procesoProduccion: ['PRODUCCION_CAJAS'] }, 'reglas de la extensión');
  igual(por('P.P. MOLIDO').alias.map((a) => a.alias).sort(), ['P.P MOLIDO', 'POLIPROPILENO MOLIDO'], 'alias base de P.P. MOLIDO');
  igual(filas.length, w.CATALOGO_MATERIALES.length, 'una fila por material fusionado');
});

caso('Máximo 9 alias por material: la pantalla muestra los aplicados y el banner reporta el sobrante omitido', () => {
  const alias = Array.from({ length: 10 }, (_, i) => `ALIAS ${i + 1}`);
  const w = crearContexto({ extension: { version: 1, materiales: { 'DEMASIADOS': { nombre: 'DEMASIADOS', unidad: 'KG', alias } } } });
  igual(filasDe(w).find((f) => f.nombre === 'DEMASIADOS'), undefined, 'con 10 alias la entrada se omite (límite de 9)');
  afirmar(w.EVE_CATALOGO.errores.some((e) => /9/.test(e.motivo) || /alias/.test(e.motivo)), 'el motivo menciona el tope de alias');
  const ok = crearContexto({ extension: { version: 1, materiales: { 'NUEVE': { nombre: 'NUEVE', unidad: 'KG', alias: alias.slice(0, 9) } } } });
  igual(filasDe(ok).find((f) => f.nombre === 'NUEVE').alias.length, 9, 'con 9 alias se aplica');
});

// ── Filtros, orden y agrupación ──────────────────────────────────────────

caso('Buscador: nombre, alias, tipo y valores de reglas, sin acentos ni mayúsculas', () => {
  const w = crearContexto({ extension: EXTENSION });
  const filas = filasDe(w);
  const buscar = (texto) => nombres(w.EVE_ADMIN_CATALOGO.filtrarFilas(filas, { texto }));
  igual(buscar('tambo').sort(), ['PELLET TAMBO', 'RECHAZO TAMBOS', 'TAMBO'], 'por nombre y por regla');
  igual(buscar('peap'), [], 'sin coincidencias');
  afirmar(buscar('garrafa').includes('BIDON'), 'por alias');
  afirmar(buscar('PET NEGRO ').length === 0 && buscar('pead negro').includes('DURO'), 'alias de la extensión');
  igual(buscar('intermedio').every((n) => w.CATALOGO_MATERIALES.find((m) => m.nombre === n).tipo === 'intermedio'), true, 'por tipo');
  afirmar(buscar('inyeccion').includes('RECHAZO CAJAS P.E.'), 'sin acentos: INYECCIÓN');
  afirmar(buscar('   ').length === filas.length, 'solo espacios no filtra');
  afirmar(buscar('P.E. MOLIDO').includes('RECHAZO CAJAS P.E.') && buscar('P.E. MOLIDO').includes('P.E.'), 'por el valor de muelePara');
});

caso('Filtros por tipo, unidad, estado, origen y banderas, combinados con Y', () => {
  const w = crearContexto({ extension: EXTENSION });
  const filas = filasDe(w);
  const f = (filtros) => nombres(w.EVE_ADMIN_CATALOGO.filtrarFilas(filas, filtros));
  afirmar(f({ tipo: 'rechazo' }).length === 3 && f({ tipo: 'rechazo' }).every((n) => /^RECHAZO/.test(n)), 'tipo rechazo: 3');
  afirmar(f({ unidad: 'PZ' }).includes('CAJA NUEVA') && !f({ unidad: 'PZ' }).includes('LECHERO'), 'unidad PZ');
  igual(f({ estado: 'archivados' }), ['DURO'], 'archivados');
  afirmar(!f({ estado: 'activos' }).includes('DURO') && f({ estado: 'activos' }).length === filas.length - 1, 'activos');
  igual(f({ origen: 'extension' }), ['PELLET NUEVO', 'CAJA NUEVA'], 'origen extensión');
  igual(f({ origen: 'extension', unidad: 'PZ' }), ['CAJA NUEVA'], 'origen y unidad combinados');
  igual(f({ banderas: { recibible: 'no' } }).includes('RECHAZO TAMBOS'), true, 'recibible=no');
  afirmar(f({ banderas: { recibible: 'no' } }).every((n) => !filas.find((x) => x.nombre === n).recibible), 'solo no recibibles');
  afirmar(f({ banderas: { requiereSeleccion: 'si' } }).includes('CRISTAL CON ETIQUETA') && !f({ banderas: { requiereSeleccion: 'si' } }).includes('P.E. MOLIDO'), 'requiereSeleccion=si');
  afirmar(f({ banderas: { seObtieneEnProduccion: 'si' } }).includes('P.E. MOLIDO'), 'seObtieneEnProduccion=si');
  afirmar(f({ banderas: { compraHabitual: 'no' } }).includes('PELLET CAJAS'), 'compraHabitual=no');
  igual(f({ banderas: { requiereSeleccion: 'no', seObtieneEnProduccion: 'no' } }), ['MATERIAL VIRGEN'], 'dos banderas a la vez');
  igual(f({ tipo: 'rechazo', texto: 'tambos' }), ['RECHAZO TAMBOS'], 'tipo y texto');
  igual(f({}).length, filas.length, 'sin filtros: todo');
  igual(f(undefined).length, filas.length, 'sin objeto de filtros: todo');
});

caso('Falta composición: crudos activos que requieren selección sin composición vigente', () => {
  const w = crearContexto();
  w.EVE.composiciones = [{ id: 'c1', materialEntrada: 'CRISTAL CON ETIQUETA', version: 1, fechaVigencia: '2026-08-01', fechaCierre: null, componentes: [{ subproducto: 'PET CRISTAL', porcentaje: 90, esMerma: false }, { subproducto: 'BASURA', porcentaje: 10, esMerma: true }] }];
  const filas = filasDe(w);
  const falta = nombres(w.EVE_ADMIN_CATALOGO.filtrarFilas(filas, { faltaComposicion: true }));
  afirmar(!falta.includes('CRISTAL CON ETIQUETA') && falta.includes('MIXTO'), 'con composición no falta; sin ella sí');
  afirmar(!falta.some((n) => /MOLIDO|PELLET|RECHAZO|MATERIAL VIRGEN/.test(n)) && !falta.includes('TAMBO'), 'molidos, pellets, rechazos, virgen y piezas no requieren composición');
  w.EVE.composiciones[0].fechaCierre = '2026-08-31';
  afirmar(w.EVE_ADMIN_CATALOGO.filtrarFilas(filasDe(w), { faltaComposicion: true }).some((f) => f.nombre === 'CRISTAL CON ETIQUETA'), 'una composición cerrada ya no es vigente');
  const archivada = crearContexto({ extension: { version: 1, overrides: { 'MIXTO': { activo: false } } } });
  afirmar(!filasDe(archivada).find((f) => f.nombre === 'MIXTO').faltaComposicion, 'un material archivado no avisa');
});

caso('Orden: del catálogo, por nombre o por usos, sin modificar el arreglo recibido y con desempate estable', () => {
  const w = crearContexto();
  w.EVE.registrosDestaraje = [{ material: 'P.E.' }, { material: 'P.E.' }, { material: 'LECHERO' }, { material: 'LECHERO' }, { material: 'BIDON' }];
  const filas = filasDe(w);
  const copia = JSON.stringify(nombres(filas));
  const orden = (c) => nombres(w.EVE_ADMIN_CATALOGO.ordenarFilas(filas, c));
  igual(orden('catalogo'), w.CATALOGO_MATERIALES.map((m) => m.nombre), 'catálogo');
  igual(orden(undefined), orden('catalogo'), 'por omisión: catálogo');
  const porNombre = orden('nombre');
  igual(porNombre, porNombre.slice().sort((a, b) => a.localeCompare(b, 'es')), 'por nombre');
  igual(orden('usos').slice(0, 3), ['LECHERO', 'P.E.', 'BIDON'], 'por usos desc con desempate del catálogo (LECHERO va antes que P.E.)');
  igual(JSON.stringify(nombres(filas)), copia, 'el arreglo original no cambió');
});

caso('Agrupación por tipo en orden fijo, sin grupos vacíos y con tipos desconocidos al final', () => {
  const w = crearContexto({ extension: { version: 1, materiales: { 'RARO': { nombre: 'RARO', unidad: 'KG', tipo: 'otro_tipo' }, 'SIN': { nombre: 'SIN', unidad: 'KG' } } } });
  const grupos = w.EVE_ADMIN_CATALOGO.agruparPorTipo(filasDe(w));
  igual(grupos.map((g) => g.tipo), ['materia_prima', 'subproducto', 'intermedio', 'rechazo', 'producto_terminado', 'otro_tipo', 'sin tipo'], 'orden de los grupos');
  igual(grupos.reduce((s, g) => s + g.filas.length, 0), w.CATALOGO_MATERIALES.length, 'todas las filas en algún grupo');
  igual(grupos[0].filas[0].nombre, 'BIDON', 'dentro del grupo se conserva el orden recibido');
  igual(w.EVE_ADMIN_CATALOGO.agruparPorTipo([]), [], 'sin filas: sin grupos');
  igual(w.EVE_ADMIN_CATALOGO.agruparPorTipo(w.EVE_ADMIN_CATALOGO.filtrarFilas(filasDe(w), { tipo: 'rechazo' })).map((g) => g.tipo), ['rechazo'], 'tras filtrar solo queda el grupo con filas');
});

// ── Conteo de usos ───────────────────────────────────────────────────────

caso('Usos: cuenta registros por nombre normalizado (alias incluidos), una vez por registro y de cada fuente', () => {
  const w = crearContexto();
  Object.assign(w.EVE, {
    registrosDestaraje: [{ material: 'P.P MOLIDO' }, { material: 'P.P. MOLIDO' }, { material: 'LECHERO' }],
    ventas: [{ lineas: [{ material: 'LECHERO' }, { material: 'LECHERO' }, { material: 'P.E.' }] }],
    registrosPagos: [{ material: 'LECHERO' }],
    composiciones: [{ materialEntrada: 'MIXTO', componentes: [{ subproducto: 'LECHERO' }, { subproducto: 'BASURA', esMerma: true }] }],
    registrosControlProduccion: [{ inputs: [{ material: 'LECHERO' }], outputs: [{ material: 'LECHERO' }, { material: 'LECHERO MOLIDO' }, { material: 'LODOS', esMerma: true }] }],
    inventarioInicial: [{ material: 'P.E.' }]
  });
  const filas = filasDe(w);
  const por = (n) => filas.find((f) => f.nombre === n);
  igual(por('P.P. MOLIDO').usos, 2, 'el alias cuenta para el nombre oficial');
  igual(por('LECHERO').usos, 5, 'Báscula 1, ventas 1 (una venta con la línea repetida), pagos 1, composición 1, proceso 1 (entrada y salida cuentan una vez)');
  igual(por('LECHERO').fuentesUso, { 'Báscula': 1, 'Ventas': 1, 'Pagos': 1, 'Composiciones': 1, 'Control Producción': 1 }, 'por fuente');
  igual(por('P.E.').usos, 2, 'ventas + inventario inicial');
  igual(por('LODOS'), undefined, 'una merma no es un material del catálogo');
  igual(por('BIDON').usos, 0, 'sin registros: 0');
  const vacio = crearContexto();
  igual(Object.keys(vacio.EVE_ADMIN_CATALOGO.contarUsosPorMaterial(undefined)).length, 0, 'sin datos');
});

// ── Mapa de transformaciones ─────────────────────────────────────────────

caso('Mapa: crudo -> subproductos -> molido, pieza -> pellet y pieza -> rechazo -> molido; sin el tramo molido -> pellet', () => {
  const w = crearContexto();
  w.EVE.composiciones = [{ id: 'c1', materialEntrada: 'DURO', version: 1, fechaVigencia: '2026-08-01', fechaCierre: null,
    componentes: [{ subproducto: 'P.P.', porcentaje: 60, esMerma: false }, { subproducto: 'P.E.', porcentaje: 35, esMerma: false }, { subproducto: 'BASURA', porcentaje: 5, esMerma: true }] }];
  const mapa = w.EVE_ADMIN_CATALOGO.construirMapaTransformaciones(w.CATALOGO_MATERIALES, w.EVE.composiciones, '2026-09-30');
  const t = (lineas) => lineas.map((l) => `${l.nivel}:${l.texto}`);
  const duro = t(mapa.crudos).indexOf('0:DURO');
  igual(t(mapa.crudos).slice(duro, duro + 6), ['0:DURO', '1:P.P. (60 %)', '2:se muele a P.P. MOLIDO', '1:P.E. (35 %)', '2:se muele a P.E. MOLIDO', '1:merma BASURA (5 %)'], 'DURO con su composición y moliendas');
  afirmar(t(mapa.crudos).includes('1:sin composición vigente: no se puede seleccionar con la captura simple'), 'un crudo sin composición avisa');
  afirmar(mapa.crudos.filter((l) => l.advertencia).length > 0 && mapa.crudos.every((l) => !l.advertencia || /sin composición/.test(l.texto)), 'la advertencia solo marca los crudos sin composición');
  const i = t(mapa.pellets).indexOf('0:CAJA AGRO20 — PRODUCCION_CAJAS');
  igual(t(mapa.pellets).slice(i, i + 2), ['0:CAJA AGRO20 — PRODUCCION_CAJAS', '1:consume PELLET AGRO20'], 'pieza -> pellet');
  const tapon = t(mapa.pellets).indexOf('0:TAPON — PRODUCCION_TAPONES');
  igual(t(mapa.pellets).slice(tapon + 1, tapon + 3), ['1:consume PELLET TAPON (una de varias opciones)', '1:consume MATERIAL VIRGEN (una de varias opciones)'], 'tapón: dos pellets a elegir');
  const j = t(mapa.rechazos).indexOf('0:CAJA CO30 — PRODUCCION_CAJAS');
  igual(t(mapa.rechazos).slice(j, j + 3), ['0:CAJA CO30 — PRODUCCION_CAJAS', '1:genera RECHAZO CAJAS P.E.', '2:se muele a P.E. MOLIDO'], 'pieza -> rechazo -> molido');
  const k = t(mapa.rechazos).indexOf('0:TAPON — PRODUCCION_TAPONES');
  igual(t(mapa.rechazos).slice(k, k + 2), ['0:TAPON — PRODUCCION_TAPONES', '1:no genera rechazo recuperable'], 'tapón sin rechazo');
  const todo = JSON.stringify(mapa);
  afirmar(!/peletizaComo|formula|fórmula|mezcla/i.test(todo), 'ni peletizaComo ni fórmulas');
  afirmar(!mapa.crudos.concat(mapa.pellets, mapa.rechazos).some((l) => /P\.E\. MOLIDO.*PELLET|PELLET.*MOLIDO/.test(l.texto)), 'no hay un tramo molido -> pellet');
});

caso('Mapa: una pieza sin pellet o sin molido del rechazo marca la advertencia; una pieza archivada y una nueva de la extensión aparecen', () => {
  const w = crearContexto({ extension: { version: 1, materiales: {
    'PIEZA SIN PELLET': { nombre: 'PIEZA SIN PELLET', unidad: 'PZ', tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_CAJAS' } },
    'RECHAZO SIN MOLIDO': { nombre: 'RECHAZO SIN MOLIDO', unidad: 'KG', tipo: 'rechazo', requiereSeleccion: false, seObtieneEnProduccion: true },
    'PIEZA RARA': { nombre: 'PIEZA RARA', unidad: 'PZ', tipo: 'producto_terminado', reglas: { procesoProduccion: 'PRODUCCION_CAJAS', pelletUsado: ['PELLET CAJAS'], rechazoGenerado: ['RECHAZO SIN MOLIDO'] } }
  }, overrides: { 'TAMBO': { activo: false } } } });
  const mapa = w.EVE_ADMIN_CATALOGO.construirMapaTransformaciones(w.CATALOGO_MATERIALES, [], '2026-09-30');
  const sinPellet = mapa.pellets.findIndex((l) => l.texto.startsWith('PIEZA SIN PELLET'));
  igual([mapa.pellets[sinPellet + 1].texto, mapa.pellets[sinPellet + 1].advertencia], ['sin pellet definido', true], 'pieza sin pellet');
  const rara = mapa.rechazos.findIndex((l) => l.texto.startsWith('PIEZA RARA'));
  igual(mapa.rechazos.slice(rara + 1, rara + 3).map((l) => [l.texto, l.advertencia]), [['genera RECHAZO SIN MOLIDO', false], ['sin molido definido', true]], 'rechazo sin molido');
  afirmar(mapa.pellets.some((l) => l.texto === 'TAMBO (archivada) — PRODUCCION_TAMBOS'), 'una pieza archivada se lista como archivada');
});

// ── Banner y extensión vacía ─────────────────────────────────────────────

caso('Banner: lista cada entrada omitida con su motivo cuando hay errores y no existe sin ellos', () => {
  const w = crearContexto({ extension: EXTENSION });
  const banner = w.EVE_ADMIN_CATALOGO.construirBanner(w.EVE_CATALOGO.errores);
  igual([banner.visible, banner.titulo], [true, 'Extensión del catálogo con errores'], 'visible y con su título');
  afirmar(/NO están aplicadas/.test(banner.mensaje) && /no reconocidos/.test(banner.mensaje), 'dice que no están aplicadas');
  afirmar(banner.lineas.length === w.EVE_CATALOGO.errores.length && banner.lineas.length >= 3, 'una línea por error');
  afirmar(banner.lineas.some((l) => /^LECHERO — .*colision/.test(l)) && banner.lineas.some((l) => /^MAL ALIAS — /.test(l)) && banner.lineas.some((l) => /^UNIDAD RARA — .*unidad invalida/.test(l)), 'nombre y motivo de cada una');
  const limpio = crearContexto({ extension: { version: 1, materiales: { 'OK': { nombre: 'OK', unidad: 'KG' } } } });
  igual(limpio.EVE_ADMIN_CATALOGO.construirBanner(limpio.EVE_CATALOGO.errores), { visible: false, titulo: '', mensaje: '', lineas: [] }, 'sin errores: sin banner');
  igual(limpio.EVE_ADMIN_CATALOGO.construirBanner(undefined).visible, false, 'sin lista');
  const ilegible = crearContexto({ extension: 'esto no es un objeto' });
  afirmar(ilegible.EVE_ADMIN_CATALOGO.construirBanner(ilegible.EVE_CATALOGO.errores).lineas.some((l) => /extension completa/.test(l)), 'una extensión ilegible también se reporta');
});

caso('Extensión vacía: mensaje claro con el total base; con contenido, sin mensaje', () => {
  const w = crearContexto();
  const A = w.EVE_ADMIN_CATALOGO;
  for (const vacia of [undefined, null, {}, { version: 2 }, { materiales: {}, overrides: {}, mermas: [] }]) afirmar(A.extensionVacia(vacia), `vacía: ${JSON.stringify(vacia)}`);
  for (const llena of [{ materiales: { X: {} } }, { overrides: { DURO: {} } }, { mermas: [{}] }, 'texto']) afirmar(!A.extensionVacia(llena), `no vacía: ${JSON.stringify(llena)}`);
  const total = w.CATALOGO_MATERIALES.length;
  igual(A.mensajeExtensionVacia(undefined, total), `La extensión del catálogo está vacía: se usa solo el catálogo base (${total} materiales).`, 'mensaje');
  igual(A.mensajeExtensionVacia(EXTENSION, total), null, 'con contenido');
});

// ── Vista y permiso ──────────────────────────────────────────────────────

caso('Vista: con errores muestra el banner SIN botón de cerrar; sin errores y extensión vacía muestra el mensaje de vacía', () => {
  const con = crearContexto({ extension: EXTENSION });
  const vista = con.EVE_ADMIN_CATALOGO.crearVistaCatalogo();
  const banner = vista.descendientes().find((n) => /acat-banner/.test(n.className));
  afirmar(banner, 'hay banner');
  afirmar(/Extensión del catálogo con errores/.test(banner.texto()) && /LECHERO/.test(banner.texto()) && /UNIDAD RARA/.test(banner.texto()), 'título y entradas');
  igual(banner.descendientes().filter((n) => n.tagName === 'BUTTON').length, 0, 'sin botón de cerrar');
  const sin = crearContexto();
  const vistaSin = sin.EVE_ADMIN_CATALOGO.crearVistaCatalogo();
  afirmar(!vistaSin.descendientes().some((n) => /acat-banner/.test(n.className)), 'sin errores no hay banner');
  afirmar(/extensión del catálogo está vacía/.test(vistaSin.texto()), 'mensaje de extensión vacía');
});

caso('Vista: lista todos los materiales agrupados, filtra al escribir y es de solo lectura (ningún botón de alta, edición ni archivado)', () => {
  const w = crearContexto({ extension: EXTENSION });
  const vista = w.EVE_ADMIN_CATALOGO.crearVistaCatalogo();
  const nodos = vista.descendientes();
  const conteo = nodos.find((n) => n.className === 'acat-conteo');
  igual(conteo.textContent, `${w.CATALOGO_MATERIALES.length} de ${w.CATALOGO_MATERIALES.length} materiales`, 'conteo inicial');
  const filasTabla = () => vista.descendientes().filter((n) => n.tagName === 'TR' && n.parent && n.parent.tagName === 'TBODY' && n.parent.parent && /acat-tabla/.test(n.parent.parent.className));
  igual(filasTabla().length, w.CATALOGO_MATERIALES.length, 'una fila por material');
  const texto = vista.texto();
  afirmar(/PELLET NUEVO/.test(texto) && /extensión/.test(texto) && /archivado \(extensión\)/.test(texto) && /muelePara: P\.E\. MOLIDO/.test(texto) && /Compra habitual: no/.test(texto), 'muestra origen, archivado por extensión, reglas y banderas');
  const buscador = nodos.find((n) => n.tagName === 'INPUT' && n.type === 'search');
  buscador.value = 'tambo';
  buscador.disparar('input');
  igual(conteo.textContent, `3 de ${w.CATALOGO_MATERIALES.length} materiales`, 'al buscar se filtra');
  igual(filasTabla().length, 3, 'tres filas');
  buscador.value = 'zzzz';
  buscador.disparar('input');
  afirmar(/Ningún material coincide/.test(vista.texto()), 'sin coincidencias lo dice');
  const botones = vista.descendientes().filter((n) => n.tagName === 'BUTTON');
  igual(botones.length, 0, 'la pantalla no tiene botones');
  afirmar(!/Agregar|Editar|Archivar|Restaurar|Guardar|Eliminar|Nuevo/.test(vista.texto().replace(/Solo lectura\. El alta, la edición y el archivado llegan en una versión posterior\./, '')), 'ningún texto de alta, edición o archivado');
  const selectOrden = nodos.filter((n) => n.tagName === 'SELECT').find((s) => s.children.some((o) => o.value === 'usos'));
  selectOrden.value = 'nombre';
  buscador.value = '';
  buscador.disparar('input');
  selectOrden.disparar('change');
  igual(filasTabla().length, w.CATALOGO_MATERIALES.length, 'cambiar el orden no pierde filas');
});

caso('Permiso: la pestaña Catálogo la ve solo el Admin con escritura; sin permiso la vista no lista nada', () => {
  const visibles = (admin) => crearContexto({ admin }).EVE_ADMIN.subpestanasVisibles().map((s) => s.id);
  afirmar(visibles('escritura').includes('catalogo') && visibles('escritura').includes('config'), 'escritura: Catálogo junto a Configuración');
  igual(visibles('lectura'), ['auditoria'], 'lectura: solo Auditoría (el mismo criterio que Configuración)');
  igual(visibles('ninguno'), [], 'ninguno: nada');
  const sinPermiso = crearContexto({ admin: 'lectura' }).EVE_ADMIN_CATALOGO.crearVistaCatalogo();
  afirmar(/No tienes permiso/.test(sinPermiso.texto()) && !/Catálogo de materiales/.test(sinPermiso.texto()), 'defensa en la propia vista');
  const sinUsuario = crearContexto();
  sinUsuario.EVE.currentUser = null;
  afirmar(/No tienes permiso/.test(sinUsuario.EVE_ADMIN_CATALOGO.crearVistaCatalogo().texto()), 'sin usuario tampoco');
});

// ── Solo lectura: sin escrituras a Firestore ─────────────────────────────

caso('El código nuevo NO escribe en Firestore ni usa las funciones de escritura de la app', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/admin-catalogo.js'), 'utf8');
  const sinComentarios = fuente.replace(/\/\/.*$/gm, '');
  for (const patron of [/\.set\s*\(/, /\.update\s*\(/, /\.add\s*\(/, /\.delete\s*\(/, /\.batch\s*\(/, /runTransaction/, /\bguardarDato\b/, /\bactualizarDato\b/, /\beliminarDato\b/, /\bdb\.collection\b/, /firebase\./, /EVE_HISTORIAL/, /fetch\s*\(/, /localStorage/]) {
    afirmar(!patron.test(sinComentarios), `js/admin-catalogo.js no debe usar ${patron}`);
  }
  const w = crearContexto({ extension: EXTENSION });
  let escrituras = 0;
  const cuenta = () => { escrituras += 1; return Promise.resolve(); };
  w.db = { collection: () => ({ doc: () => ({ set: cuenta, update: cuenta, get: cuenta, delete: cuenta }), add: cuenta, get: cuenta }), batch: cuenta, runTransaction: cuenta };
  w.guardarDato = cuenta; w.actualizarDato = cuenta; w.eliminarDato = cuenta;
  const vista = w.EVE_ADMIN_CATALOGO.crearVistaCatalogo();
  vista.descendientes().filter((n) => n.tagName === 'SELECT' || n.tagName === 'INPUT').forEach((n) => { n.disparar('change'); n.disparar('input'); });
  igual(escrituras, 0, 'renderizar y usar los filtros no toca la base de datos');
});

caso('Las metas de piezas ya listan las piezas archivadas (no hace falta tocar admin-config.js)', () => {
  const arch = crearContexto({ extension: { version: 1, overrides: { 'CAJA CO30': { activo: false } } } });
  afirmar(arch.materialesPZ().includes('CAJA CO30'), 'materialesPZ() incluye una pieza archivada, y admin-config.js arma sus metas con esa lista');
  afirmar(/window\.materialesPZ\(\)\.forEach/.test(fs.readFileSync(path.join(RAIZ, 'js/admin-config.js'), 'utf8')), 'admin-config.js recorre materialesPZ()');
});

// ── Ejecución ────────────────────────────────────────────────────────────

let fallos = 0;
for (const { nombre, fn } of casos) {
  try {
    fn();
    console.log(`PASS  ${nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`FAIL  ${nombre}\n      ${error.stack ? error.stack.split('\n').slice(0, 3).join('\n      ') : error.message}`);
  }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos > 0 ? 1 : 0);
