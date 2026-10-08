// Tipo de gasto en js/gastos.js: Operación o Financiamiento (deuda), campo tipoGasto.
//
// El alta exige el tipo (sin opción preseleccionada); un gasto anterior sin tipoGasto cuenta como Operación y no se
// reescribe hasta que se guarda una edición; editar un gasto con IVA conserva montoBase e iva pero deja cambiar el tipo.
// El módulo se ejecuta completo contra un DOM mínimo: las pruebas disparan los mismos manejadores que usa la pantalla.
//
// Uso: node scripts/verificar-gastos-tipo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['config.js', 'utils.js', 'gastos.js'];
const leerFuente = (archivo) => fs.readFileSync(path.join(RAIZ, 'js', archivo), 'utf8');

// DOM mínimo: registra los elementos por id (atributo en innerHTML o propiedad id) y guarda los manejadores.
function crearDom() {
  const registro = {};
  class Elemento {
    constructor() {
      this.children = []; this.value = ''; this.disabled = false; this.title = ''; this.style = {}; this.dataset = {};
      this.handlers = {}; this.classList = { add() {}, remove() {}, toggle() {} }; this._id = ''; this._html = '';
    }
    set id(valor) { this._id = valor; registro[valor] = this; }
    get id() { return this._id; }
    set innerHTML(html) {
      this._html = html;
      if (html === '') this.children = [];
      for (const m of String(html).matchAll(/id="([^"]+)"/g)) { const hijo = new Elemento(); hijo.id = m[1]; }
    }
    get innerHTML() { return this._html; }
    appendChild(hijo) { this.children.push(hijo); return hijo; }
    addEventListener(tipo, fn) { this.handlers[tipo] = fn; }
    querySelector(selector) { return selector.startsWith('#') ? registro[selector.slice(1)] : new Elemento(); }
    querySelectorAll() { return []; }
    reset() {}
  }
  return { registro, Elemento, document: { getElementById: (id) => registro[id] || null, createElement: () => new Elemento(), createTextNode: () => new Elemento() } };
}

function crearContexto(gastos = []) {
  const dom = crearDom();
  const llamadas = { guardados: [], actualizados: [], historial: [], errores: [], exitos: [] };
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = { gastos, currentUser: { username: 'prueba' } };
  window.puedeEscribir = () => true;
  window.activarOrdenamiento = () => {};
  window.obtenerFechaMexico = () => '2026-10-08';
  window.obtenerInicioSemana = () => '2026-10-05';
  window.obtenerInicioMes = () => '2026-10-01';
  window.EVE_HISTORIAL = { registrar: (entrada) => llamadas.historial.push(entrada) };
  const ctx = vm.createContext({
    window, document: dom.document, console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, XLSX: {},
    firebase: { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) }
  });
  for (const f of ARCHIVOS) vm.runInContext(leerFuente(f), ctx, { filename: f });
  // utils.js define showError/showSuccess (toasts) y guardarDato/actualizarDato (Firestore): se sustituyen después de cargarlo.
  window.guardarDato = async (coleccion, doc) => { llamadas.guardados.push({ coleccion, doc }); return 'nuevo1'; };
  window.actualizarDato = async (coleccion, id, doc) => { llamadas.actualizados.push({ coleccion, id, doc }); };
  window.showError = (mensaje) => llamadas.errores.push(mensaje);
  window.showSuccess = (mensaje) => llamadas.exitos.push(mensaje);
  return { w: window, dom, llamadas };
}

// Renderiza la pantalla; devuelve helpers para leer la tabla y los KPIs.
function abrirPantalla(gastos) {
  const c = crearContexto(gastos);
  const contenedor = new c.dom.Elemento();
  c.w.EVE_MODULES.gastos.render(contenedor);
  const reg = c.dom.registro;
  c.filas = () => reg['gastos-tabla'].children;
  c.textosFila = (fila) => fila.children.map((celda) => celda.textContent);
  c.kpis = () => reg['gastos-stats'].children.map((s) => s.textContent);
  return c;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const base = { montoBase: '1000', fecha: '2026-10-08', concepto: 'Luz' };

// ── Alta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

caso('Alta: sin tipo de gasto se rechaza; con operacion o financiamiento se guarda en tipoGasto', () => {
  const { w } = crearContexto();
  const construir = (extra) => w.EVE_GASTOS.construirGastoDesdeFormulario({ ...base, ...extra });
  for (const invalido of [undefined, '', 'otro']) {
    let mensaje = '';
    try { construir({ tipoGasto: invalido }); } catch (e) { mensaje = e.message; }
    igual(mensaje, 'Tipo de gasto es obligatorio', `tipo ${JSON.stringify(invalido)}`);
  }
  igual(construir({ tipoGasto: 'operacion' }).tipoGasto, 'operacion', 'operacion');
  igual(construir({ tipoGasto: 'financiamiento' }).tipoGasto, 'financiamiento', 'financiamiento');
});

caso('Alta (pantalla): el select no trae opción preseleccionada y, sin elegir, el envío no guarda nada', async () => {
  const c = abrirPantalla([]);
  const fuente = leerFuente('gastos.js');
  afirmar(/<select id="ga-tipo"[^>]*required>\s*<option value="" selected disabled>/.test(fuente), 'select obligatorio con opción vacía seleccionada y deshabilitada');
  const reg = c.dom.registro;
  reg['ga-monto-base'].value = '500';
  reg['ga-tipo'].value = '';
  await reg['gastos-form'].handlers.submit({ preventDefault() {} });
  igual(c.llamadas.guardados.length, 0, 'no se guardó');
  igual(c.llamadas.errores, ['Tipo de gasto es obligatorio'], 'mensaje de error');
});

caso('Alta (pantalla): con tipo elegido se guarda tipoGasto y el gasto aparece con su tipo en la tabla', async () => {
  const c = abrirPantalla([]);
  const reg = c.dom.registro;
  reg['ga-monto-base'].value = '2500';
  reg['ga-concepto'].value = 'Abono a crédito';
  reg['ga-tipo'].value = 'financiamiento';
  await reg['gastos-form'].handlers.submit({ preventDefault() {} });
  igual(c.llamadas.guardados.map((g) => [g.coleccion, g.doc.tipoGasto, g.doc.montoBase, g.doc.iva]), [['gastos', 'financiamiento', 2500, 0]], 'documento guardado');
  igual(c.textosFila(c.filas()[0]).slice(2, 4), ['Abono a crédito', 'Financiamiento (deuda)'], 'concepto y columna Tipo');
});

// ── Gastos viejos sin tipo ────────────────────────────────────────────────────────────────────────────────────────────

caso('Un gasto viejo sin tipoGasto cuenta como Operación en subtotales, filtro y tabla (sin escribir nada)', () => {
  const viejos = [{ id: 'a', montoBase: 100, iva: 0, fecha: '2026-10-08' }, { id: 'b', montoBase: 1000, iva: 160, fecha: '2026-10-08', tipoGasto: 'operacion' }, { id: 'c', montoBase: 50, fecha: '2026-10-08', tipoGasto: 'financiamiento' }];
  const c = abrirPantalla(viejos);
  const stats = c.w.EVE_GASTOS.calcularStats(viejos);
  igual([stats.total, stats.operacion, stats.financiamiento], [1310, 1260, 50], 'subtotales (el total sigue siendo montoBase + iva)');
  igual(c.w.EVE_GASTOS.tipoDeGasto(viejos[0]), 'operacion', 'tipoDeGasto');
  igual(c.w.EVE_GASTOS.aplicarFiltrosTodos(viejos, { tipo: 'operacion' }).map((g) => g.id), ['a', 'b'], 'filtro Operación incluye al viejo');
  igual(c.w.EVE_GASTOS.aplicarFiltrosTodos(viejos, { tipo: 'financiamiento' }).map((g) => g.id), ['c'], 'filtro Financiamiento');
  igual(c.w.EVE_GASTOS.aplicarFiltrosTodos(viejos, { tipo: '' }).length, 3, 'sin filtro de tipo');
  const tipos = c.filas().map((f) => c.textosFila(f)[3]).sort();
  igual(tipos, ['Financiamiento (deuda)', 'Operación', 'Operación'], 'columna Tipo');
  igual(c.llamadas.actualizados.length + c.llamadas.guardados.length, 0, 'nada se escribió al mostrarlos');
  igual(viejos[0].tipoGasto, undefined, 'el documento viejo no se modificó');
});

caso('KPIs: Operación y Financiamiento aparecen junto a Total General', () => {
  const c = abrirPantalla([{ id: 'a', montoBase: 300, fecha: '2026-10-08' }, { id: 'b', montoBase: 200, fecha: '2026-10-08', tipoGasto: 'financiamiento' }]);
  const kpis = c.kpis();
  igual(kpis.map((k) => k.split(':')[0]), ['Registros', 'Total General', 'Operación', 'Financiamiento'], 'etiquetas');
  afirmar(/500/.test(kpis[1]) && /300/.test(kpis[2]) && /200/.test(kpis[3]), `importes de los KPIs: ${kpis.join(' | ')}`);
  const f = leerFuente('gastos.js');
  const captura = f.slice(f.indexOf('function abrirVistaCapturaGastos'), f.indexOf('function crearBarraCapturaGastos'));
  afirmar(captura.includes("label: 'Operación'") && captura.includes("label: 'Financiamiento'"), 'también en la Vista para captura');
});

// ── Edición ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function editarDesdeTabla(c, indiceFila) {
  const celdaAcciones = c.filas()[indiceFila].children.slice(-1)[0];
  celdaAcciones.children.find((b) => b.textContent === 'Editar').handlers.click();
}

caso('Editar un gasto viejo: se muestra como Operación y abrir el modal no escribe nada', () => {
  const c = abrirPantalla([{ id: 'v1', montoBase: 100, iva: 0, fecha: '2026-10-08', concepto: 'Papel' }]);
  editarDesdeTabla(c, 0);
  igual(c.dom.registro['gae-tipo'].value, 'operacion', 'select de edición');
  igual(c.llamadas.actualizados.length, 0, 'sin escrituras al abrir');
});

caso('Editar un gasto con IVA: conserva montoBase e iva (monto deshabilitado) y permite cambiar el tipo; queda en el historial', async () => {
  const c = abrirPantalla([{ id: 'v2', montoBase: 1000, iva: 160, fecha: '2026-10-08', concepto: 'Renta' }]);
  editarDesdeTabla(c, 0);
  const reg = c.dom.registro;
  igual(reg['gae-monto-base'].disabled, true, 'monto base bloqueado');
  igual(reg['gae-tipo'].disabled, false, 'el tipo sigue editable');
  reg['gae-monto-base'].value = '999999'; // aunque se manipule, se conserva el guardado
  reg['gae-tipo'].value = 'financiamiento';
  reg['gae-motivo'].value = 'es un crédito';
  await reg['gastos-edit-form'].handlers.submit({ preventDefault() {} });
  igual(c.llamadas.errores, [], 'sin errores');
  igual(c.llamadas.actualizados.map((a) => [a.coleccion, a.id, a.doc.montoBase, a.doc.iva, a.doc.tipoGasto]), [['gastos', 'v2', 1000, 160, 'financiamiento']], 'documento actualizado');
  const h = c.llamadas.historial[0];
  igual([h.coleccion, h.registroId, h.accion, h.valorAnterior.tipoGasto, h.valorNuevo.tipoGasto, h.motivo], ['gastos', 'v2', 'edicion', 'operacion', 'financiamiento', 'es un crédito'], 'EVE_HISTORIAL');
  igual(c.w.EVE.gastos[0].tipoGasto, 'financiamiento', 'memoria actualizada');
});

caso('Editar un gasto viejo sin cambiar el tipo: al guardar queda escrito como operacion', async () => {
  const c = abrirPantalla([{ id: 'v3', montoBase: 100, fecha: '2026-10-08' }]);
  editarDesdeTabla(c, 0);
  await c.dom.registro['gastos-edit-form'].handlers.submit({ preventDefault() {} });
  igual(c.llamadas.actualizados.map((a) => a.doc.tipoGasto), ['operacion'], 'tipoGasto escrito al guardar');
});

caso('Tabla: columna Tipo y colSpan de la fila vacía al día', () => {
  const f = leerFuente('gastos.js');
  const columnas = (f.match(/<tr>(<th.*?)<\/tr>/) || [])[1].split('<th').length - 1;
  afirmar(f.includes('<th data-tipo="texto">Tipo</th>'), 'encabezado Tipo');
  afirmar(f.includes(`celda.colSpan = ${columnas}`), `colSpan = ${columnas} columnas`);
  afirmar(/<select id="gaf-tipo"|selectTipo\.id = 'gaf-tipo'/.test(f), 'filtro por tipo en la pestaña Todos');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${process.env.DEBUG_TEST ? error.stack : error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
