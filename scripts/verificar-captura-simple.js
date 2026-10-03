// K21e a K21i — Verificación de la captura simple de Control Producción (js/control-produccion.js + reglas).
//
// Carga en un contexto vm config, utils, rendimientos, inventario, control-produccion-reglas y control-produccion con un DOM
// MÍNIMO simulado (no es un navegador: no hay CSS ni validación nativa de formularios) y ejecuta el formulario simple de
// punta a punta: interruptor, entradas derivadas, salidas precargadas, merma calculada, avisos, Duplicar último registro,
// ticketOrigen automático y guardado. También congela el formulario COMPLETO: las funciones de la captura completa deben
// seguir idénticas a las de la versión anterior (huellas de HEAD de la etapa 1), así que con el interruptor apagado el
// formulario se ve y se comporta como antes.
//
// Uso: node scripts/verificar-captura-simple.js   (código de salida 1 si algún caso falla)
// Si cambias A PROPÓSITO el formulario completo, actualiza HUELLAS_FORMULARIO_COMPLETO (ver node scripts/... al final).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/inventario.js', 'js/control-produccion-reglas.js', 'js/control-produccion.js'];

// ── DOM mínimo ───────────────────────────────────────────────────────────

class Nodo {
  constructor(etiqueta) {
    this.tagName = String(etiqueta).toUpperCase();
    this.children = [];
    this.parent = null;
    this.style = {};
    this.dataset = {};
    this.attrs = {};
    this.escuchas = {};
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.disabled = false;
    this.innerHTML = '';
  }
  // Como en el navegador, value siempre es texto.
  get value() { return this._v; }
  set value(v) { this._v = v === null || v === undefined ? '' : String(v); }
  appendChild(hijo) {
    if (hijo.parent) hijo.remove();
    hijo.parent = this;
    this.children.push(hijo);
    return hijo;
  }
  replaceChildren(...hijos) {
    this.children.forEach((c) => { c.parent = null; });
    this.children = [];
    hijos.forEach((h) => this.appendChild(h));
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(tipo, fn) { (this.escuchas[tipo] = this.escuchas[tipo] || []).push(fn); }
  async disparar(tipo) {
    for (const fn of this.escuchas[tipo] || []) await fn({ preventDefault() {}, target: this });
  }
  setAttribute(clave, valor) { this.attrs[clave] = valor; }
  get classList() {
    const nodo = this;
    return {
      toggle(nombre, activo) {
        const clases = new Set(nodo.className.split(/\s+/).filter(Boolean));
        if (activo) clases.add(nombre); else clases.delete(nombre);
        nodo.className = Array.from(clases).join(' ');
      },
      add(nombre) { this.toggle(nombre, true); },
      remove(nombre) { this.toggle(nombre, false); },
      contains(nombre) { return nodo.className.split(/\s+/).includes(nombre); }
    };
  }
  get options() { return this.children.filter((c) => c.tagName === 'OPTION'); }
  descendientes() { return this.children.flatMap((c) => [c, ...c.descendientes()]); }
}

// Un <select> solo acepta valores de sus opciones (como el navegador); sin coincidencia queda en ''.
class NodoSelect extends Nodo {
  constructor() { super('select'); this._valor = ''; }
  get value() { return this._valor; }
  set value(v) { this._valor = this.options.some((o) => o.value === String(v)) ? String(v) : ''; }
  replaceChildren(...hijos) { super.replaceChildren(...hijos); this._valor = ''; }
  // llenarSelectMaterial (captura completa) arma las opciones con innerHTML: se interpretan solo <option value="x">x</option>.
  get innerHTML() { return ''; }
  set innerHTML(html) {
    this.replaceChildren(...Array.from(String(html).matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)).map((m) => {
      const opcion = new Nodo('option');
      opcion.value = m[1];
      opcion.textContent = m[2];
      return opcion;
    }));
  }
}

function crearDocumento() {
  const porId = new Map();
  return {
    createElement(etiqueta) { return etiqueta === 'select' ? new NodoSelect() : new Nodo(etiqueta); },
    createTextNode(texto) { const n = new Nodo('#text'); n.textContent = texto; return n; },
    // Elementos que el módulo busca por id fuera del formulario simple (tabla, filtros…): nodos comodín.
    getElementById(id) {
      if (!porId.has(id)) porId.set(id, new Nodo('div'));
      return porId.get(id);
    }
  };
}

function crearContexto(inicial) {
  const almacen = new Map(Object.entries((inicial && inicial.almacen) || {}));
  const avisos = { errores: [], exitos: [], confirmaciones: [], prompts: [], guardados: [], actualizados: [], historial: [] };
  const respuestas = { confirm: true, prompt: 'ajuste de pesaje' };
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: crearDocumento(),
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosControlProduccion: [], composiciones: [], precios: [], ajustesPrecioProveedor: [],
    comisiones: [], ventas: [], registrosVentas: [], inventarioInicial: [], metaPiezasDia: {}, cuentasPorPagar: []
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  const w = sandbox.window;
  w.localStorage = { getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), setItem: (k, v) => { almacen.set(k, String(v)); } };
  w.obtenerFechaMexico = () => '2026-09-15';
  w.formatearFecha = (f) => String(f);
  w.showError = (m) => avisos.errores.push(m);
  w.showSuccess = (m) => avisos.exitos.push(m);
  w.confirm = (m) => { avisos.confirmaciones.push(m); return respuestas.confirm; };
  w.prompt = (m) => { avisos.prompts.push(m); return respuestas.prompt; };
  w.guardarDato = async (coleccion, registro) => { avisos.guardados.push({ coleccion, registro }); return `id${avisos.guardados.length}`; };
  w.puedeEscribir = () => true;
  w.actualizarDato = async (coleccion, id, datos) => { avisos.actualizados.push({ coleccion, id, datos }); };
  w.EVE_HISTORIAL = { registrar: (entrada) => { avisos.historial.push(entrada); return Promise.resolve(); } };
  return { w, almacen, avisos, respuestas };
}

// ── Helpers de prueba ────────────────────────────────────────────────────

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

const compra = (ticket, material, kg, fecha) => ({ id: `d${ticket}`, ticket: String(ticket), material, kg, fechaSalida: fecha, fechaEntrada: fecha, proveedor: 'JESÚS' });
const inp = (material, kg, ticketOrigen) => ({ material, kg, ticketOrigen: ticketOrigen || '' });
const out = (material, kg, esMerma) => ({ material, kg, esMerma: !!esMerma });
const proceso = (numero, tipoProceso, inputs, outputs, fecha, extra) => ({
  id: `p${numero}`, ticket: `P-${String(numero).padStart(3, '0')}`, tipoProceso, inputs, outputs, fecha, operador: 'LUIS', turno: 'Matutino',
  totalInput: 0, totalOutput: 0, eficiencia: 100, porcentajeMerma: 0, observaciones: '', ...(extra || {})
});
const composicion = (material, componentes) => ({
  id: `c-${material}`, materialEntrada: material, version: 1, fechaVigencia: '2026-01-01', fechaCierre: null,
  componentes: componentes.map(([subproducto, porcentaje, esMerma]) => ({ subproducto, porcentaje, esMerma: !!esMerma })),
  totalPorcentaje: componentes.reduce((s, c) => s + c[1], 0)
});

// Escenario base: 1000 kg de CRISTAL CON ETIQUETA comprados (ticket 10) con su composición.
function escenarioBase(opciones) {
  const ctx = crearContexto(opciones);
  ctx.w.EVE.registrosDestaraje = [compra(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01')];
  ctx.w.EVE.composiciones = [composicion('CRISTAL CON ETIQUETA', [['PET CRISTAL', 80], ['PET ETIQUETA', 15], ['PET VERDE', 3], ['BASURA', 2, true]])];
  return ctx;
}

function crearSimple(ctx) {
  const form = ctx.w.EVE_CONTROL_PRODUCCION.crearFormularioSimple();
  const todos = form.descendientes();
  const hallar = (clase) => todos.find((n) => n.className.split(/\s+/).includes(clase));
  return {
    form,
    botones: todos.filter((n) => n.className.split(/\s+/).includes('cps-proceso-boton')),
    boton: (nombre) => todos.filter((n) => n.className.split(/\s+/).includes('cps-proceso-boton')).find((b) => b.textContent.includes(nombre)),
    avisos: hallar('cps-avisos'),
    editor: hallar('cps-editor'),
    entradas: todos.filter((n) => n.className === 'cp-inputs-lista')[0],
    salidas: todos.filter((n) => n.className === 'cp-inputs-lista')[1],
    todos: hallar('cps-todos').children[0],
    merma: hallar('cps-merma'),
    mermaTipo: hallar('cps-merma-tipo'),
    mermaKg: hallar('cps-merma-kg'),
    operador: todos.find((n) => n.attrs.list === 'dl-cp-operadores'),
    turno: todos.find((n) => n.tagName === 'SELECT' && n.options.some((o) => o.value === 'Matutino')),
    fecha: todos.find((n) => n.tagName === 'INPUT' && n.type === 'date'),
    observaciones: todos.find((n) => n.tagName === 'TEXTAREA'),
    resumen: todos.filter((n) => n.className === 'card cp-resumen')[0],
    producto: hallar('cps-producto'),
    motivo: hallar('cps-motivo'),
    edicion: hallar('cps-edicion'),
    guardar: todos.find((n) => n.tagName === 'BUTTON' && n.type === 'submit'),
    cancelar: todos.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Cancelar edición'),
    pieza: hallar('cps-pieza'),
    todosLosNodos: todos,
    botonDuplicar: todos.find((n) => n.tagName === 'BUTTON' && n.textContent === 'Duplicar último registro'),
    agregarMaterial: todos.find((n) => n.tagName === 'BUTTON' && n.textContent === '+ Agregar Material'),
    agregarSalida: todos.find((n) => n.tagName === 'BUTTON' && n.textContent === '+ Agregar salida'),
    textos: (nodo) => nodo.children.map((c) => c.textContent)
  };
}

async function elegirEntrada(f, fila, material, kg) {
  fila.cpsSelect.value = material;
  await fila.cpsSelect.disparar('change');
  if (kg !== undefined) {
    fila.cpsKg.value = String(kg);
    await fila.cpsKg.disparar('input');
  }
}

async function teclear(campo, valor) {
  campo.value = String(valor);
  await campo.disparar('input');
}

const salidaDe = (f, material) => f.salidas.children.find((c) => c.cpsFijo && c.cpsMaterial === material);

// ── Formulario completo congelado ────────────────────────────────────────

// Huellas (SHA-256, 16 hex) de las funciones de la captura completa tal como estaban ANTES de K21e (HEAD 78e4594).
const HUELLAS_FORMULARIO_COMPLETO = {
  construirRegistroDesdeFormulario: 'd33e9dc05cf09e42',
  nombresInputParaProceso: '2f7ca4150eb6f2d1',
  nombresOutputNoMerma: 'eeeaa2c0263792ef',
  llenarSelectMaterial: '5ddbc8d2865c5944',
  refrescarInputsPorProceso: 'f398d47b87e571a8',
  refrescarOutputsDelTicket: '7c3d08c42a74e5f1',
  crearFilaInput: '008f3354cd0bab14',
  leerInputsFormulario: 'f3ab41e033b57088',
  tiposMermaDelTicket: '384a6a3b5ec7031a',
  nombresOutputParaFila: '61c6cd2a38baa942',
  sincronizarFilaOutput: 'd3b5294489a42087',
  revalidarFilasOutput: 'bdda46713e9c9f27',
  crearFilaOutput: '44c03f8c7b0caf3f',
  leerOutputsFormulario: 'd8d5156dc887f6b3',
  tipoProcesoParaPrefijo: '921517532924469e',
  actualizarResumen: 'fc9efa08977fe46e',
  verificarStockSuficienteProceso: '4d71ee1ffa89ea9b',
  verificarOrigenProceso: '84f37ebcb526a439',
  seleccionarProceso: '8ea3521dbec78a5d',
  reiniciarFormulario: '1f64382b143082f2',
  manejarEnvioFormulario: '9d23a8c40e55748e',
  crearFormulario: '9488c159c392504c'
};

function huellaDeFuncion(fuente, nombre) {
  const m = fuente.match(new RegExp(String.raw`^(async )?function ${nombre}\([\s\S]*?\n}\n`, 'm'));
  return m ? crypto.createHash('sha256').update(m[0]).digest('hex').slice(0, 16) : null;
}

caso('Con el interruptor apagado el formulario completo es idéntico al anterior (funciones congeladas)', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/control-produccion.js'), 'utf8').replace(/\r\n/g, '\n');
  for (const [nombre, esperada] of Object.entries(HUELLAS_FORMULARIO_COMPLETO)) {
    igual(huellaDeFuncion(fuente, nombre), esperada, `la función ${nombre} cambió (si fue a propósito, actualiza la huella)`);
  }
});

caso('El formulario completo se sigue creando con sus mismos campos y su lógica de listas por proceso', () => {
  const { w } = escenarioBase();
  // crearFormulario usa innerHTML + querySelector (no soportados por el DOM mínimo): se comprueba por sus huellas (caso
  // anterior) y aquí que su exportación pública sigue ahí y que el armado del registro completo no cambia.
  afirmar(typeof w.EVE_CONTROL_PRODUCCION.crearFormulario === 'function', 'crearFormulario sigue exportada');
  const r = w.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario({
    tipoProceso: 'SELECCION', operador: 'LUIS', turno: 'Matutino', fecha: '2026-09-02',
    inputs: [{ material: 'CRISTAL CON ETIQUETA', kg: '1000', ticketOrigen: '10' }],
    outputs: [{ material: 'PET CRISTAL', kg: '800', esMerma: false }, { material: 'BASURA', kg: '200', esMerma: true }]
  });
  igual(Object.keys(r), ['tipoProceso', 'inputs', 'outputs', 'operador', 'turno', 'fecha', 'totalInput', 'totalOutput', 'eficiencia', 'porcentajeMerma', 'observaciones'], 'esquema del registro completo');
});

// ── Interruptor ──────────────────────────────────────────────────────────

caso('Interruptor: la captura completa es la predeterminada y el simple queda oculto', () => {
  const { w } = escenarioBase();
  const completo = new Nodo('form');
  const simpleForm = w.EVE_CONTROL_PRODUCCION.crearFormularioSimple();
  w.EVE_CONTROL_PRODUCCION.crearInterruptorModoCaptura(completo, simpleForm);
  igual([completo.style.display, simpleForm.style.display], ['', 'none'], 'completo visible, simple oculto');
});

caso('Interruptor: encenderlo muestra el simple, oculta el completo y lo recuerda; apagarlo regresa', async () => {
  const { w, almacen } = escenarioBase();
  const completo = new Nodo('form');
  const simpleForm = w.EVE_CONTROL_PRODUCCION.crearFormularioSimple();
  const interruptor = w.EVE_CONTROL_PRODUCCION.crearInterruptorModoCaptura(completo, simpleForm);
  const casilla = interruptor.descendientes().find((n) => n.tagName === 'INPUT' && n.type === 'checkbox');
  casilla.checked = true;
  await casilla.disparar('change');
  igual([completo.style.display, simpleForm.style.display, almacen.get('eve:cp-modo')], ['none', '', 'simple'], 'modo simple');
  casilla.checked = false;
  await casilla.disparar('change');
  igual([completo.style.display, simpleForm.style.display, almacen.get('eve:cp-modo')], ['', 'none', 'completa'], 'de vuelta a completa');
});

caso('Interruptor: un dispositivo que ya eligió el modo simple arranca en simple', () => {
  const { w } = escenarioBase({ almacen: { 'eve:cp-modo': 'simple' } });
  const completo = new Nodo('form');
  const simpleForm = w.EVE_CONTROL_PRODUCCION.crearFormularioSimple();
  w.EVE_CONTROL_PRODUCCION.crearInterruptorModoCaptura(completo, simpleForm);
  igual([completo.style.display, simpleForm.style.display], ['none', ''], 'arranca en simple');
});

// ── K21e: entradas derivadas ─────────────────────────────────────────────

caso('Sin proceso elegido no hay editor; con la etapa 3 todos los procesos tienen formulario simple (ya no se manda a la captura completa)', async () => {
  const { w } = escenarioBase();
  const f = crearSimple({ w });
  igual(f.editor.style.display, 'none', 'editor oculto al inicio');
  igual(f.botonDuplicar.disabled, true, 'Duplicar deshabilitado');
  for (const nombre of ['Peletizado', 'Producción Cajas', 'Producción Tambos', 'Producción de Tapones']) {
    await f.boton(nombre).disparar('click');
    igual(f.editor.style.display, '', `${nombre}: editor visible`);
    afirmar(!f.textos(f.avisos).some((t) => /captura completa/.test(t)), `${nombre}: sin aviso de captura completa`);
  }
});

caso('Selección ofrece solo crudos con saldo en RECEPCIÓN, con la etiqueta de saldo', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E. MOLIDO', etapa: 'RECEPCIÓN', kg: 500, fecha: '2026-01-01' }];
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  igual(f.editor.style.display, '', 'editor visible');
  igual(f.entradas.children.length, 1, 'una fila de entrada');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => [o.value, o.textContent]),
    [['', '-- Selecciona material --'], ['CRISTAL CON ETIQUETA', 'CRISTAL CON ETIQUETA — 1000 kg en RECEPCIÓN']],
    'solo el crudo con saldo (el molido comprado no se selecciona)');
});

caso('Mostrar todos ofrece materiales sin saldo; sin saldo en el origen avisa que se use Mostrar todos', async () => {
  const { w } = escenarioBase();
  w.EVE.registrosDestaraje = [];
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  afirmar(f.textos(f.avisos).some((t) => /No hay materiales con saldo/.test(t) && /Mostrar todos/.test(t)), 'aviso de lista vacía');
  f.todos.checked = true;
  await f.todos.disparar('change');
  afirmar(f.entradas.children[0].cpsSelect.options.some((o) => o.value === 'CRISTAL CON ETIQUETA'), 'Mostrar todos ofrece el material sin saldo');
  igual(f.textos(f.avisos).filter((t) => /No hay materiales/.test(t)).length, 0, 'el aviso desaparece');
});

caso('Molienda ofrece solo lo que se muele (reglas del catálogo): nunca DURO, VERDE ni CRISTAL, ni con Mostrar todos', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = ['P.E.', 'LECHERO', 'DURO', 'VERDE', 'CRISTAL CON ETIQUETA'].map((m, i) => ({ id: `i${i}`, material: m, etapa: 'SELECCIÓN', kg: 100, fecha: '2026-01-01' }));
  const f = crearSimple({ w });
  await f.boton('Molienda').disparar('click');
  const ofrecidos = () => f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean);
  igual(ofrecidos(), ['LECHERO', 'P.E.'], 'con saldo');
  f.todos.checked = true;
  await f.todos.disparar('change');
  for (const no of ['DURO', 'VERDE', 'CRISTAL CON ETIQUETA', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON VERDE']) afirmar(!ofrecidos().includes(no), `Molienda no ofrece ${no}`);
});

caso('Agregar material: Selección lo permite con aviso de mezcla; Molienda y Lavado no lo ofrecen; Empacado sí', async () => {
  const { w } = escenarioBase();
  w.EVE.registrosDestaraje = [compra(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01'), compra(11, 'MIXTO', 500, '2026-09-02')];
  const f = crearSimple({ w });
  await f.boton('Molienda').disparar('click');
  igual(f.agregarMaterial.style.display, 'none', 'Molienda sin agregar');
  await f.boton('Lavado').disparar('click');
  igual(f.agregarMaterial.style.display, 'none', 'Lavado sin agregar');
  await f.boton('Empacado').disparar('click');
  igual(f.agregarMaterial.style.display, '', 'Empacado agrega');
  await f.boton('Selección').disparar('click');
  igual(f.agregarMaterial.style.display, '', 'Selección agrega (con aviso)');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 600);
  await f.agregarMaterial.disparar('click');
  igual(f.entradas.children.length, 2, 'segunda fila');
  igual(f.textos(f.avisos).filter((t) => /Mezcla de materiales/.test(t)).length, 0, 'sin aviso con una fila vacía');
  await elegirEntrada(f, f.entradas.children[1], 'MIXTO', 100);
  afirmar(f.textos(f.avisos).some((t) => /Mezcla de materiales/.test(t)), 'aviso de mezcla con dos materiales');
});

// ── K21f: salidas precargadas ────────────────────────────────────────────

caso('Selección con composición: una fila por componente no merma, con kg vacío; la merma va aparte', async () => {
  const { w } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  igual(f.salidas.children.map((c) => [c.cpsMaterial, c.cpsKg.value]), [['PET CRISTAL', ''], ['PET ETIQUETA', ''], ['PET VERDE', '']], 'salidas precargadas sin kg');
  igual(f.merma.style.display, '', 'la fila de merma se muestra');
  igual(f.mermaTipo.value, 'BASURA', 'tipo de merma de la composición');
  igual(f.textos(f.avisos), [], 'sin avisos');
});

caso('Selección sin composición: aviso "Falta composición", sin filas fijas y captura manual de salidas', async () => {
  const { w } = escenarioBase();
  w.EVE.composiciones = [];
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  igual(f.salidas.children.length, 0, 'sin filas fijas');
  afirmar(f.textos(f.avisos).some((t) => /Falta composición de CRISTAL CON ETIQUETA/.test(t)), 'aviso de falta de composición');
  await f.agregarSalida.disparar('click');
  igual(f.salidas.children.length, 1, 'fila manual');
  const select = f.salidas.children[0].cpsSelect;
  afirmar(select.options.some((o) => o.value === 'PET CRISTAL') && select.options.some((o) => o.value === 'CRISTAL CON ETIQUETA'), 'ofrece producibles y el material de entrada');
  select.value = 'PET CRISTAL';
  await select.disparar('change');
  await teclear(f.salidas.children[0].cpsKg, 700);
  igual(leerResumen(f).entrada, 1000, 'balance con salida manual');
});

caso('Molienda produce el molido de reglasDe().muelePara; Empacado y Lavado, el mismo material', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [
    { id: 'i1', material: 'LECHERO', etapa: 'SELECCIÓN', kg: 300, fecha: '2026-01-01' },
    { id: 'i2', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 200, fecha: '2026-01-01' }
  ];
  const f = crearSimple({ w });
  await f.boton('Molienda').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'LECHERO', 100);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['LECHERO MOLIDO'], 'Molienda');
  await f.boton('Empacado').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'LECHERO', 100);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['LECHERO'], 'Empacado');
  await f.boton('Lavado').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'P.E. MOLIDO', 50);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['P.E. MOLIDO'], 'Lavado');
});

caso('Empacado y Lavado: los kg de salida parten de los de entrada y dejan de seguirlos si el operador los edita', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 500, fecha: '2026-01-01' }];
  const f = crearSimple({ w });
  await f.boton('Empacado').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'P.E.', 200);
  igual(salidaDe(f, 'P.E.').cpsKg.value, '200', 'precarga igual a la entrada');
  await teclear(f.entradas.children[0].cpsKg, 250);
  igual(salidaDe(f, 'P.E.').cpsKg.value, '250', 'sigue a la entrada mientras no se edite');
  await teclear(salidaDe(f, 'P.E.').cpsKg, 248);
  await teclear(f.entradas.children[0].cpsKg, 260);
  igual(salidaDe(f, 'P.E.').cpsKg.value, '248', 'editada: ya no la pisa');
});

// ── K21g: merma por diferencia, balance y avisos ─────────────────────────

function leerResumen(f) {
  const texto = f.textos(f.resumen).join(' | ');
  const num = (re) => { const m = texto.match(re); return m ? Number(m[1].replace(/,/g, '')) : null; };
  return { texto, entrada: num(/Total entrada: ([\d.,]+) kg/), salidas: num(/Total salidas: ([\d.,]+) kg/), mermaKg: num(/Merma: ([\d.,]+) kg/) };
}

caso('La merma se calcula por diferencia, con el tipo del proceso y se muestra con su porcentaje', async () => {
  const { w } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 800);
  await teclear(salidaDe(f, 'PET ETIQUETA').cpsKg, 150);
  await teclear(salidaDe(f, 'PET VERDE').cpsKg, 40);
  igual(f.mermaKg.value, '10', 'merma = 1000 - 990');
  igual(f.mermaTipo.value, 'BASURA', 'tipo');
  const r = leerResumen(f);
  igual([r.entrada, r.salidas, r.mermaKg], [1000, 990, 10], 'balance');
  afirmar(/1\.00%|1,00%|1\.0%|1%/.test(r.texto) || /\(1\.00%\)/.test(r.texto), `porcentaje en el resumen: ${r.texto}`);
});

caso('Molienda y Lavado usan LODOS; Empacado no tiene fila de merma', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 500, fecha: '2026-01-01' }, { id: 'i2', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 200, fecha: '2026-01-01' }];
  const f = crearSimple({ w });
  await f.boton('Molienda').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'P.E.', 100);
  igual([f.merma.style.display, f.mermaTipo.value, f.mermaTipo.options.map((o) => o.value)], ['', 'LODOS', ['LODOS']], 'Molienda');
  await f.boton('Lavado').disparar('click');
  igual(f.merma.style.display, '', 'Lavado');
  await f.boton('Empacado').disparar('click');
  igual(f.merma.style.display, 'none', 'Empacado sin merma');
});

caso('Aviso de Selección: la merma real supera la esperada (2 %) por más de 5 puntos', async () => {
  const { w } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 800);
  await teclear(salidaDe(f, 'PET ETIQUETA').cpsKg, 150);
  await teclear(salidaDe(f, 'PET VERDE').cpsKg, 30);
  afirmar(!/supera/.test(leerResumen(f).texto), 'merma de 2 %: sin aviso');
  await teclear(salidaDe(f, 'PET VERDE').cpsKg, 0);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 700);
  afirmar(/supera/.test(leerResumen(f).texto), `merma de 15 %: avisa (${leerResumen(f).texto})`);
  igual(f.resumen.children.find((c) => /supera/.test(c.textContent)).className, 'cp-eficiencia-naranja', 'color naranja');
});

caso('Aviso de Empacado: avisa si entrada y salida difieren más de 1 %', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 2000, fecha: '2026-01-01' }];
  const f = crearSimple({ w });
  await f.boton('Empacado').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'P.E.', 1000);
  afirmar(!/difiere/.test(leerResumen(f).texto), 'igual: sin aviso');
  await teclear(salidaDe(f, 'P.E.').cpsKg, 990);
  afirmar(!/difiere/.test(leerResumen(f).texto), '1 %: sin aviso');
  await teclear(salidaDe(f, 'P.E.').cpsKg, 980);
  afirmar(/difiere/.test(leerResumen(f).texto), '2 %: avisa');
});

caso('Molienda/Lavado: sin aviso con menos de 10 registros con merma calculada; con 10 avisa sobre promedio + 5 puntos', async () => {
  const historial = (n, pct) => Array.from({ length: n }, (_, i) => proceso(100 + i, 'LAVADO', [inp('P.E. MOLIDO', 100)], [out('P.E. MOLIDO', 100 - pct), out('LODOS', pct, true)], '2026-08-01', { mermaCalculada: true, porcentajeMerma: pct }));
  for (const [registros, avisa] of [[9, false], [10, true]]) {
    const { w } = escenarioBase();
    w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 50000, fecha: '2026-01-01' }];
    w.EVE.registrosControlProduccion = historial(registros, 8);
    const f = crearSimple({ w });
    await f.boton('Lavado').disparar('click');
    await elegirEntrada(f, f.entradas.children[0], 'P.E. MOLIDO', 100);
    await teclear(salidaDe(f, 'P.E. MOLIDO').cpsKg, 80);
    igual(/supera/.test(leerResumen(f).texto), avisa, `20 % con ${registros} registros de historial (promedio 8 %)`);
    await teclear(salidaDe(f, 'P.E. MOLIDO').cpsKg, 88);
    afirmar(!/supera/.test(leerResumen(f).texto), `12 % con ${registros} registros: dentro del promedio + 5 (13 %)`);
  }
});

caso('El kg de merma es editable: queda editado y el registro guarda mermaCalculada=false', async () => {
  const { w, avisos } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 900);
  igual(f.mermaKg.value, '100', 'calculada');
  await teclear(f.mermaKg, 95);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 880);
  igual(f.mermaKg.value, '95', 'la edición manual no se pisa');
  afirmar(/difiere/.test(leerResumen(f).texto), 'avisa que la merma capturada difiere de la diferencia');
  f.operador.value = 'luis';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const guardado = avisos.guardados[0].registro;
  igual(guardado.mermaCalculada, false, 'mermaCalculada=false');
  igual(guardado.outputs.filter((o) => o.esMerma).map((o) => [o.material, o.kg]), [['BASURA', 95]], 'merma capturada');
});

caso('Salidas mayores que la entrada: aviso en rojo y guarda solo con confirmación y motivo (queda en observaciones)', async () => {
  const { w, avisos, respuestas } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 1050);
  igual(f.resumen.children.find((c) => /superan/.test(c.textContent)).className, 'cp-eficiencia-rojo', 'aviso fuerte en rojo');
  igual(f.mermaKg.value, '', 'no inventa merma negativa');
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  respuestas.prompt = null;
  await f.form.disparar('submit');
  igual([avisos.prompts.length, avisos.guardados.length], [1, 0], 'sin motivo no se guarda');
  respuestas.prompt = '   ';
  await f.form.disparar('submit');
  igual(avisos.guardados.length, 0, 'motivo vacío tampoco');
  respuestas.prompt = 'báscula descalibrada';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  igual(avisos.guardados.length, 1, 'con motivo se guarda');
  afirmar(/Salidas mayores que la entrada: báscula descalibrada/.test(avisos.guardados[0].registro.observaciones), 'motivo en observaciones');
});

caso('historicoMerma: solo cuentan los registros del proceso con merma calculada (los de la captura completa no)', () => {
  const { w } = escenarioBase();
  const R = w.EVE_CP_REGLAS;
  const reg = (tipoProceso, porcentajeMerma, extra) => ({ tipoProceso, porcentajeMerma, ...(extra || {}) });
  const registros = [
    reg('LAVADO', 10, { mermaCalculada: true }), reg('LAVADO', 20, { mermaCalculada: true }),
    reg('LAVADO', 90), reg('LAVADO', 90, { mermaCalculada: false }), reg('MOLIENDA', 50, { mermaCalculada: true })
  ];
  igual(R.historicoMerma(registros, 'LAVADO'), { promedio: 15, registros: 2 }, 'LAVADO');
  igual(R.historicoMerma(registros, 'PELETIZADO'), { promedio: null, registros: 0 }, 'sin registros');
  igual(R.historicoMerma(undefined, 'LAVADO'), { promedio: null, registros: 0 }, 'sin datos');
});

// ── K21h: valores por omisión y Duplicar último registro ─────────────────

caso('Valores por omisión: fecha de hoy, operador y turno recordados por dispositivo (visibles y editables)', () => {
  const { w } = escenarioBase({ almacen: { 'eve:cp-ultimo-operador': 'MARIA', 'eve:cp-ultimo-turno': 'Vespertino' } });
  const f = crearSimple({ w });
  igual([f.fecha.value, f.operador.value, f.turno.value], ['2026-09-15', 'MARIA', 'Vespertino'], 'precargados');
  igual(f.turno.options.map((o) => o.value), ['', 'Matutino', 'Vespertino'], 'solo Matutino y Vespertino');
  const sin = crearSimple(escenarioBase({ almacen: { 'eve:cp-ultimo-turno': 'Nocturno' } }));
  igual(sin.turno.value, '', 'un turno que no existe no se precarga');
});

caso('Duplicar último registro: copia material, operador y turno del último del MISMO proceso, con los kg vacíos', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 900, fecha: '2026-01-01' }, { id: 'i2', material: 'P.P.', etapa: 'SELECCIÓN', kg: 900, fecha: '2026-01-01' }];
  w.EVE.registrosControlProduccion = [
    proceso(1, 'EMPACADO', [inp('P.E.', 100)], [out('P.E.', 100)], '2026-09-10', { operador: 'ANA', turno: 'Vespertino' }),
    proceso(2, 'EMPACADO', [inp('P.P.', 50)], [out('P.P.', 50)], '2026-09-12', { operador: 'LUIS', turno: 'Matutino' }),
    proceso(3, 'LAVADO', [inp('P.E. MOLIDO', 50)], [out('P.E. MOLIDO', 50)], '2026-09-14', { operador: 'PEDRO', turno: 'Vespertino' })
  ];
  const f = crearSimple({ w });
  igual(f.botonDuplicar.disabled, true, 'sin proceso: deshabilitado');
  await f.boton('Empacado').disparar('click');
  igual(f.botonDuplicar.disabled, false, 'con un registro previo del proceso: habilitado');
  await f.botonDuplicar.disparar('click');
  igual(f.entradas.children.map((c) => [c.cpsSelect.value, c.cpsKg.value]), [['P.P.', '']], 'material del último Empacado (P-002), sin kg');
  igual([f.operador.value, f.turno.value], ['LUIS', 'Matutino'], 'operador y turno del último Empacado');
  igual(f.salidas.children.map((c) => [c.cpsMaterial, c.cpsKg.value]), [['P.P.', '']], 'salida sin kg');
  await f.boton('Molienda').disparar('click');
  igual(f.botonDuplicar.disabled, true, 'sin registros de Molienda: deshabilitado');
});

caso('Duplicar activa Mostrar todos si el material del último registro ya no tiene saldo', async () => {
  const { w } = escenarioBase();
  w.EVE.registrosControlProduccion = [proceso(1, 'EMPACADO', [inp('P.E.', 100)], [out('P.E.', 100)], '2026-09-10')];
  const f = crearSimple({ w });
  await f.boton('Empacado').disparar('click');
  await f.botonDuplicar.disparar('click');
  igual([f.todos.checked, f.entradas.children[0].cpsSelect.value], [true, 'P.E.'], 'Mostrar todos y material copiado');
});

caso('K24a: Duplicar en Peletizado copia operador y turno, pero NO las entradas (la mezcla es secreto industrial)', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = SALDOS_PELETIZADO;
  w.EVE.registrosControlProduccion = [
    proceso(1, 'PELETIZADO', [inp('P.E. MOLIDO', 300), inp('P.P. MOLIDO', 200)], [out('PELLET CAJAS', 480), out('PIEDRAS', 20, true)], '2026-09-12', { operador: 'ANA', turno: 'Vespertino' })
  ];
  const f = crearSimple({ w });
  await f.boton('Peletizado').disparar('click');
  igual(f.botonDuplicar.disabled, false, 'con un Peletizado previo: habilitado');
  await f.botonDuplicar.disparar('click');
  igual(f.entradas.children.map((c) => [c.cpsSelect.value, c.cpsKg.value]), [['', '']], 'una sola fila de entrada vacía: ni P.E. MOLIDO ni P.P. MOLIDO');
  igual([f.operador.value, f.turno.value], ['ANA', 'Vespertino'], 'operador y turno sí se copian');
});

// ── K21i: guardado ───────────────────────────────────────────────────────

caso('Guardado de Selección: mismo esquema que el formulario completo + ticketOrigen inferido y merma calculada', async () => {
  const { w, avisos, almacen } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 800);
  await teclear(salidaDe(f, 'PET ETIQUETA').cpsKg, 150);
  await teclear(salidaDe(f, 'PET VERDE').cpsKg, 40);
  f.operador.value = 'luis';
  f.turno.value = 'Vespertino';
  f.observaciones.value = ' lote nuevo ';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  igual(avisos.confirmaciones, [], 'sin avisos de stock ni de origen (hay saldo)');
  igual(avisos.guardados.length, 1, 'se guardó');
  const { coleccion, registro } = avisos.guardados[0];
  igual(coleccion, 'control_produccion', 'colección');
  igual(registro.ticket, 'P-001', 'ticket');
  const completo = w.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario({
    tipoProceso: 'SELECCION', operador: 'LUIS', turno: 'Vespertino', fecha: '2026-09-15', observaciones: 'lote nuevo',
    inputs: [{ material: 'CRISTAL CON ETIQUETA', kg: '1000', ticketOrigen: '10' }],
    outputs: [{ material: 'PET CRISTAL', kg: '800', esMerma: false }, { material: 'PET ETIQUETA', kg: '150', esMerma: false }, { material: 'PET VERDE', kg: '40', esMerma: false }, { material: 'BASURA', kg: '10', esMerma: true }]
  });
  const { ticket, ...sinTicket } = registro;
  void ticket;
  const sinOpcionales = JSON.parse(JSON.stringify(sinTicket));
  delete sinOpcionales.mermaCalculada;
  sinOpcionales.inputs.forEach((i) => delete i.ticketOrigenInferido);
  igual(sinOpcionales, JSON.parse(JSON.stringify(completo)), 'idéntico al registro de la captura completa (salvo los campos opcionales)');
  igual(registro.inputs, [{ material: 'CRISTAL CON ETIQUETA', kg: 1000, ticketOrigen: '10', ticketOrigenInferido: true }], 'ticketOrigen = ticket de Báscula, marcado inferido');
  igual(registro.mermaCalculada, true, 'mermaCalculada');
  igual(registro.outputs.at(-1), { material: 'BASURA', kg: 10, esMerma: true }, 'merma como output del tipo del proceso');
  igual([almacen.get('eve:cp-ultimo-operador'), almacen.get('eve:cp-ultimo-turno')], ['LUIS', 'Vespertino'], 'operador y turno recordados');
  igual(w.EVE.registrosControlProduccion.length, 1, 'insertado en memoria');
  igual([f.operador.value, f.turno.value, f.fecha.value, f.editor.style.display], ['luis', 'Vespertino', '2026-09-15', 'none'], 'conserva operador, turno y fecha; vacía el proceso');
  igual(avisos.exitos, ['Registro P-001 guardado'], 'aviso de éxito');
});

caso('Guardado: las salidas sin kg se omiten y los registros del modo simple tienen la misma forma que los completos', async () => {
  const { w, avisos } = escenarioBase();
  w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 500, fecha: '2026-01-01' }];
  const f = crearSimple({ w });
  await f.boton('Empacado').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'P.E.', 200);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const r = avisos.guardados[0].registro;
  igual(r.outputs, [{ material: 'P.E.', kg: 200, esMerma: false }], 'una sola salida');
  afirmar(!('mermaCalculada' in r), 'Empacado no tiene merma: no se agrega el campo');
  igual(r.inputs[0].ticketOrigenInferido, undefined, 'sin proceso previo en SELECCIÓN no hay origen que inferir (inventario inicial)');
  igual(r.inputs[0].ticketOrigen, '', 'ticketOrigen vacío como en la captura completa sin dato');
  igual([r.totalInput, r.totalOutput, r.eficiencia, r.porcentajeMerma], [200, 200, 100, 0], 'totales calculados por la misma función');
});

caso('Guardado: ticketOrigen del último ticket que produjo el material en la etapa de origen (por pareja ticket y material)', async () => {
  const { w, avisos } = escenarioBase();
  w.EVE.registrosDestaraje = [
    compra(1066, 'P.P.', 400, '2026-09-08'), compra(1066, 'BIDON', 120, '2026-09-08'), compra(1066, 'P.P.', 100, '2026-09-08'), compra(1070, 'BIDON', 50, '2026-09-09')
  ];
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await f.agregarMaterial.disparar('click');
  w.EVE.composiciones = [];
  await elegirEntrada(f, f.entradas.children[0], 'P.P.', 300);
  await elegirEntrada(f, f.entradas.children[1], 'BIDON', 100);
  await f.agregarSalida.disparar('click');
  f.salidas.children[0].cpsSelect.value = 'P.P.';
  await teclear(f.salidas.children[0].cpsKg, 380);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  const r = (avisos.guardados[0] || {}).registro;
  afirmar(r, `se guardó (errores: ${avisos.errores.join('; ')})`);
  igual(r.inputs.map((i) => [i.material, i.ticketOrigen, i.ticketOrigenInferido]), [['P.P.', '1066', true], ['BIDON', '1070', true]], 'dos renglones del mismo material = un origen; BIDON, el más reciente');
});

caso('Guardado: usa las mismas validaciones y avisos de stock y de origen que el formulario completo', async () => {
  const { w, avisos, respuestas } = escenarioBase();
  w.EVE.registrosDestaraje = [compra(10, 'CRISTAL CON ETIQUETA', 100, '2026-09-01')];
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 500);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 400);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  respuestas.confirm = false;
  await f.form.disparar('submit');
  igual(avisos.guardados.length, 0, 'stock insuficiente y el operador dice que no: no se guarda');
  afirmar(avisos.confirmaciones.some((m) => /no tiene stock suficiente/.test(m)), 'pidió confirmación de stock');
  respuestas.confirm = true;
  await f.form.disparar('submit');
  igual(avisos.guardados.length, 1, 'con confirmación se guarda');
});

caso('Guardado: operador y turno obligatorios, entrada con kg y al menos una salida (mismos mensajes que la captura completa)', async () => {
  const ctx = escenarioBase();
  const { w, avisos } = ctx;
  const f = crearSimple(ctx);
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 100);
  await f.form.disparar('submit');
  igual(avisos.errores.at(-1), 'Debe haber al menos un output que no sea merma', 'sin salidas (solo la merma calculada): mismo mensaje que la captura completa');
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 90);
  f.operador.value = '';
  f.turno.value = '';
  await f.form.disparar('submit');
  igual(avisos.errores.at(-1), 'Operador, turno y fecha son obligatorios', 'sin operador ni turno');
  igual(avisos.guardados.length, 0, 'nada guardado');
  void w;
});

caso('Guardado de la captura simple: los reportes no distinguen el origen (los campos nuevos son opcionales y se ignoran)', async () => {
  const { w, avisos } = escenarioBase();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 1000);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 900);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  const registro = avisos.guardados[0].registro;
  // El esquema base es exactamente el del formulario completo; solo se sumaron campos opcionales.
  const camposBase = ['ticket', 'tipoProceso', 'inputs', 'outputs', 'operador', 'turno', 'fecha', 'totalInput', 'totalOutput', 'eficiencia', 'porcentajeMerma', 'observaciones'];
  igual(Object.keys(registro).filter((k) => !camposBase.includes(k)), ['mermaCalculada'], 'único campo nuevo a nivel de registro');
  // El inventario lee el registro sin cambios.
  const saldos = w.EVE_INVENTARIO.calcularSaldosPorEtapaEnFecha({ ...w.EVE, registrosControlProduccion: [registro] }, '2026-09-30');
  igual(saldos['PET CRISTAL'], { 'SELECCIÓN': 900 }, 'el inventario lo procesa igual');
  igual(w.EVE_CONTROL_PRODUCCION.formatearEficiencia(registro.eficiencia), '90.00%', 'eficiencia calculada por la misma función');
});

// ── K21k: Peletizado multi-input ─────────────────────────────────────────

const SALDOS_PELETIZADO = [
  { id: 'i1', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 300, fecha: '2026-01-01' },
  { id: 'i2', material: 'P.P. MOLIDO', etapa: 'LAVADO', kg: 200, fecha: '2026-01-01' },
  { id: 'i3', material: 'LECHERO MOLIDO', etapa: 'MOLIENDA', kg: 100, fecha: '2026-01-01' },
  { id: 'i4', material: 'P.E. MOLIDO', etapa: 'RECEPCIÓN', kg: 50, fecha: '2026-01-01' },
  { id: 'i5', material: 'MATERIAL VIRGEN', etapa: 'RECEPCIÓN', kg: 400, fecha: '2026-01-01' },
  { id: 'i6', material: 'P.E.', etapa: 'SELECCIÓN', kg: 900, fecha: '2026-01-01' }
];

caso('Peletizado: ofrece los molidos con saldo de LAVADO, MOLIENDA y RECEPCIÓN (sin crudos), sin sugerir salida ni mezcla', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = SALDOS_PELETIZADO;
  const f = crearSimple({ w });
  await f.boton('Peletizado').disparar('click');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean), ['LECHERO MOLIDO', 'MATERIAL VIRGEN', 'P.E. MOLIDO', 'P.P. MOLIDO'], 'entradas con saldo en el origen (P.E. crudo no)');
  igual(f.agregarMaterial.style.display, '', 'varias entradas permitidas');
  igual(f.salidas.children.length, 1, 'una fila para elegir el pellet');
  igual([f.salidas.children[0].cpsManual, f.salidas.children[0].cpsSelect.value], [true, ''], 'el pellet NO viene preseleccionado');
  igual(f.salidas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean),
    ['LECHERO PELETIZADO', 'P.E. PELETIZADO', 'P.P. PELETIZADO', 'PELLET AGRO20', 'PELLET CAJAS', 'PELLET TAMBO', 'PELLET TAPON', 'SUERO PELETIZADO'], 'pellets posibles del catálogo');
  await elegirEntrada(f, f.entradas.children[0], 'P.E. MOLIDO', 300);
  igual([f.salidas.children.length, f.salidas.children[0].cpsSelect.value], [1, ''], 'con un input tampoco se sugiere salida');
  await f.agregarMaterial.disparar('click');
  await elegirEntrada(f, f.entradas.children[1], 'P.P. MOLIDO', 200);
  igual([f.salidas.children.length, f.salidas.children[0].cpsSelect.value], [1, ''], 'con varios inputs tampoco');
  igual(f.textos(f.avisos), [], 'ni avisos de mezcla');
});

caso('Peletizado: no hay campos de fórmula, notas de fórmula ni nada que guarde la mezcla fuera de los inputs y el pellet', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = SALDOS_PELETIZADO;
  const f = crearSimple({ w });
  await f.boton('Peletizado').disparar('click');
  const textos = f.todosLosNodos.map((n) => `${n.textContent || ''} ${n.attrs && n.attrs.placeholder ? n.attrs.placeholder : ''} ${n.placeholder || ''}`).join(' ');
  afirmar(!/f[oó]rmula|color|dureza|flexibilidad|producto destino/i.test(textos), `sin campos de fórmula: ${textos.match(/f[oó]rmula|color|dureza|flexibilidad|producto destino/i)}`);
  const campos = f.todosLosNodos.filter((n) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(n.tagName)).length;
  afirmar(campos > 0, 'hay campos');
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/control-produccion.js'), 'utf8') + fs.readFileSync(path.join(RAIZ, 'js/control-produccion-reglas.js'), 'utf8');
  afirmar(!/notasFormula|notas de f[oó]rmula|formulaPellet|peletizaComo/i.test(fuente), 'el código no modela fórmulas');
});

caso('Peletizado: mezcla de dos molidos -> pellet de salida libre y merma PIEDRAS por diferencia', async () => {
  const { w, avisos } = escenarioBase();
  w.EVE.inventarioInicial = SALDOS_PELETIZADO;
  const f = crearSimple({ w });
  await f.boton('Peletizado').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'P.E. MOLIDO', 300);
  await f.agregarMaterial.disparar('click');
  await elegirEntrada(f, f.entradas.children[1], 'P.P. MOLIDO', 200);
  f.salidas.children[0].cpsSelect.value = 'PELLET CAJAS';
  await f.salidas.children[0].cpsSelect.disparar('change');
  await teclear(f.salidas.children[0].cpsKg, 480);
  igual([f.mermaKg.value, f.mermaTipo.value, f.merma.style.display], ['20', 'PIEDRAS', ''], 'merma PIEDRAS calculada');
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const r = avisos.guardados[0].registro;
  igual(r.inputs.map((i) => [i.material, i.kg]), [['P.E. MOLIDO', 300], ['P.P. MOLIDO', 200]], 'inputs con sus kg');
  igual(r.outputs, [{ material: 'PELLET CAJAS', kg: 480, esMerma: false }, { material: 'PIEDRAS', kg: 20, esMerma: true }], 'pellet de salida y merma PIEDRAS');
  igual(r.mermaCalculada, true, 'mermaCalculada');
  const camposBase = ['ticket', 'tipoProceso', 'inputs', 'outputs', 'operador', 'turno', 'fecha', 'totalInput', 'totalOutput', 'eficiencia', 'porcentajeMerma', 'observaciones'];
  igual(Object.keys(r).filter((k) => !camposBase.includes(k)), ['mermaCalculada'], 'ningún dato de fórmula en el registro');
  const completo = w.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario({
    tipoProceso: 'PELETIZADO', operador: 'LUIS', turno: 'Matutino', fecha: '2026-09-15', observaciones: '',
    inputs: [{ material: 'P.E. MOLIDO', kg: '300', ticketOrigen: '' }, { material: 'P.P. MOLIDO', kg: '200', ticketOrigen: '' }],
    outputs: [{ material: 'PELLET CAJAS', kg: '480', esMerma: false }, { material: 'PIEDRAS', kg: '20', esMerma: true }]
  });
  const { ticket, mermaCalculada, ...resto } = r;
  void ticket; void mermaCalculada;
  resto.inputs = resto.inputs.map(({ ticketOrigenInferido, ...i }) => { void ticketOrigenInferido; return i; });
  igual(resto, JSON.parse(JSON.stringify(completo)), 'mismo esquema que el formulario completo');
});

caso('Peletizado: acepta siete o más filas de entrada y avisa con los umbrales de K21c (10 registros + promedio + 5 puntos)', async () => {
  const historial = (n) => Array.from({ length: n }, (_, i) => proceso(100 + i, 'PELETIZADO', [inp('P.E. MOLIDO', 100)], [out('PELLET CAJAS', 97), out('PIEDRAS', 3, true)], '2026-08-01', { mermaCalculada: true, porcentajeMerma: 3 }));
  for (const [registros, avisaConMerma15] of [[9, false], [10, true]]) {
    const { w } = escenarioBase();
    w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 90000, fecha: '2026-01-01' }];
    w.EVE.registrosControlProduccion = historial(registros);
    const f = crearSimple({ w });
    await f.boton('Peletizado').disparar('click');
    for (let i = 0; i < 6; i += 1) await f.agregarMaterial.disparar('click');
    igual(f.entradas.children.length, 7, 'siete filas de entrada');
    for (const fila of f.entradas.children) await elegirEntrada(f, fila, 'P.E. MOLIDO', 100);
    f.salidas.children[0].cpsSelect.value = 'PELLET CAJAS';
    await teclear(f.salidas.children[0].cpsKg, 595);
    igual(f.mermaKg.value, '105', 'merma de 700 - 595');
    igual(/supera/.test(f.textos(f.resumen).join(' ')), avisaConMerma15, `15 % con ${registros} registros de historial (promedio 3 %, límite 8 %)`);
    await teclear(f.salidas.children[0].cpsKg, 650);
    afirmar(!/supera/.test(f.textos(f.resumen).join(' ')), `7.1 % con ${registros} registros: dentro del límite (3 + 5)`);
  }
});

// ── K21k: Selección con varios materiales ────────────────────────────────

function escenarioSeleccionMultiple() {
  const ctx = escenarioBase();
  ctx.w.EVE.registrosDestaraje = [compra(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01'), compra(11, 'MIXTO', 800, '2026-09-02')];
  ctx.w.EVE.composiciones = [
    composicion('CRISTAL CON ETIQUETA', [['PET CRISTAL', 80], ['PET ETIQUETA', 15], ['PET VERDE', 3], ['BASURA', 2, true]]),
    composicion('MIXTO', [['PET CRISTAL', 50], ['P.E.', 40], ['BASURA', 10, true]])
  ];
  return ctx;
}

caso('Selección con varios materiales: la precarga es la unión de las composiciones y avisa de la mezcla', async () => {
  const { w } = escenarioSeleccionMultiple();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 600);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE'], 'un material: su composición');
  await f.agregarMaterial.disparar('click');
  await elegirEntrada(f, f.entradas.children[1], 'MIXTO', 400);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE', 'P.E.'], 'dos materiales: unión sin duplicar PET CRISTAL');
  afirmar(f.textos(f.avisos).some((t) => /Mezcla de materiales/.test(t)), 'aviso de mezcla');
});

caso('Selección con varios materiales: conserva los kg ya tecleados al agregar otro material y la merma esperada se pondera por kg', async () => {
  const { w } = escenarioSeleccionMultiple();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 600);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 400);
  await f.agregarMaterial.disparar('click');
  await elegirEntrada(f, f.entradas.children[1], 'MIXTO', 400);
  igual(salidaDe(f, 'PET CRISTAL').cpsKg.value, '400', 'no se pierde lo tecleado');
  // Merma esperada ponderada: 5.2 %; límite de aviso 10.2 %. Entrada total 1000 kg.
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 700);
  await teclear(salidaDe(f, 'PET ETIQUETA').cpsKg, 100);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 100);
  igual(f.mermaKg.value, '100', 'merma de 1000 - 900 (10 %)');
  afirmar(!/supera/.test(f.textos(f.resumen).join(' ')), '10 % no supera 5.2 + 5');
  await teclear(salidaDe(f, 'P.E.').cpsKg, 90);
  afirmar(/supera/.test(f.textos(f.resumen).join(' ')), '11 % supera 10.2 %');
  afirmar(/5\.2/.test(f.textos(f.resumen).join(' ')), `el aviso cita la merma esperada ponderada: ${f.textos(f.resumen).join(' | ')}`);
});

caso('Selección con varios materiales: una composición faltante avisa de ese material y precarga la del otro', async () => {
  const { w } = escenarioSeleccionMultiple();
  w.EVE.composiciones = w.EVE.composiciones.filter((c) => c.materialEntrada === 'CRISTAL CON ETIQUETA');
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 600);
  await f.agregarMaterial.disparar('click');
  await elegirEntrada(f, f.entradas.children[1], 'MIXTO', 400);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['PET CRISTAL', 'PET ETIQUETA', 'PET VERDE'], 'composición del que sí la tiene');
  afirmar(f.textos(f.avisos).some((t) => /Falta composición de MIXTO/.test(t)), 'aviso del que falta');
});

caso('Selección con varios materiales: se guarda con cada entrada y su ticketOrigen, y las salidas de la unión', async () => {
  const { w, avisos } = escenarioSeleccionMultiple();
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'CRISTAL CON ETIQUETA', 600);
  await f.agregarMaterial.disparar('click');
  await elegirEntrada(f, f.entradas.children[1], 'MIXTO', 400);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 700);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 250);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const r = avisos.guardados[0].registro;
  igual(r.inputs.map((i) => [i.material, i.kg, i.ticketOrigen, i.ticketOrigenInferido]), [['CRISTAL CON ETIQUETA', 600, '10', true], ['MIXTO', 400, '11', true]], 'entradas con origen');
  igual(r.outputs.map((o) => [o.material, o.kg, o.esMerma]), [['PET CRISTAL', 700, false], ['P.E.', 250, false], ['BASURA', 50, true]], 'salidas y merma');
});

// ── K21j: procesos de pieza ──────────────────────────────────────────────

const SALDOS_PIEZAS = [
  { id: 'p1', material: 'PELLET CAJAS', etapa: 'PELETIZADO', kg: 1000, fecha: '2026-01-01' },
  { id: 'p2', material: 'PELLET AGRO20', etapa: 'PELETIZADO', kg: 500, fecha: '2026-01-01' },
  { id: 'p3', material: 'PELLET TAMBO', etapa: 'PELETIZADO', kg: 800, fecha: '2026-01-01' },
  { id: 'p4', material: 'PELLET TAPON', etapa: 'PELETIZADO', kg: 100, fecha: '2026-01-01' },
  { id: 'p5', material: 'MATERIAL VIRGEN', etapa: 'RECEPCIÓN', kg: 300, fecha: '2026-01-01' }
];

function escenarioPiezas(opciones) {
  const ctx = escenarioBase(opciones);
  ctx.w.EVE.inventarioInicial = SALDOS_PIEZAS;
  return ctx;
}

async function elegirProducto(f, producto) {
  f.producto.value = producto;
  await f.producto.disparar('change');
}

const textoResumen = (f) => f.textos(f.resumen).join(' | ');

caso('Piezas: el producto se elige entre los PZ del catálogo del proceso; no hay merma, ni más entradas, ni salidas manuales', async () => {
  const { w } = escenarioPiezas();
  const f = crearSimple({ w });
  const productosDe = async (nombre) => { await f.boton(nombre).disparar('click'); return f.producto.options.map((o) => o.value).filter(Boolean); };
  igual((await productosDe('Producción Cajas')).sort(), ['CAJA AGRO20', 'CAJA CH25', 'CAJA CO30'], 'Cajas');
  igual(await productosDe('Producción Tambos'), ['TAMBO'], 'Tambos');
  igual((await productosDe('Producción de Tapones')).sort(), ['ORING', 'SELLO', 'TAPON'], 'Tapones');
  await f.boton('Producción Cajas').disparar('click');
  igual([f.pieza.style.display, f.merma.style.display, f.agregarMaterial.style.display, f.agregarSalida.style.display], ['', 'none', 'none', 'none'], 'producto visible; sin merma, sin agregar material ni salidas');
  igual(f.entradas.children.length, 1, 'una sola entrada');
  await f.boton('Selección').disparar('click');
  igual(f.pieza.style.display, 'none', 'el selector de producto se oculta en procesos de kg');
});

caso('Piezas: CAJA CO30 y CAJA CH25 usan PELLET CAJAS y RECHAZO CAJAS P.E.; el ticket se arma como el del formulario completo', async () => {
  const { w, avisos } = escenarioPiezas();
  const f = crearSimple({ w });
  await f.boton('Producción Cajas').disparar('click');
  igual(f.entradas.children[0].cpsSelect.value, '', 'sin producto no hay entrada elegida');
  await elegirProducto(f, 'CAJA CO30');
  igual(f.entradas.children[0].cpsSelect.value, 'PELLET CAJAS', 'pellet preseleccionado');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean), ['PELLET CAJAS'], 'solo el pellet del producto');
  igual(f.salidas.children.map((c) => [c.cpsMaterial, c.cpsKg.placeholder]), [['CAJA CO30', 'Piezas'], ['RECHAZO CAJAS P.E.', 'Kg']], 'piezas y rechazo derivado (sin select de resina)');
  igual(f.salidas.children.some((c) => c.cpsManual), false, 'ninguna fila manual');
  await teclear(f.entradas.children[0].cpsKg, 470);
  await teclear(salidaDe(f, 'CAJA CO30').cpsKg, 400);
  await teclear(salidaDe(f, 'RECHAZO CAJAS P.E.').cpsKg, 50);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const r = avisos.guardados[0].registro;
  const completo = w.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario({
    tipoProceso: 'PRODUCCION_CAJAS', operador: 'LUIS', turno: 'Matutino', fecha: '2026-09-15', observaciones: '',
    inputs: [{ material: 'PELLET CAJAS', kg: '470', ticketOrigen: '' }],
    outputs: [{ material: 'CAJA CO30', kg: '400', esMerma: false }, { material: 'RECHAZO CAJAS P.E.', kg: '50', esMerma: false }]
  });
  const { ticket, ...resto } = r;
  void ticket;
  igual(resto, JSON.parse(JSON.stringify(completo)), 'mismo esquema que el formulario completo (sin campos nuevos)');
  igual([r.totalOutput, r.eficiencia, r.porcentajeMerma], [50, null, 0], 'totalOutput solo en kg (sin sumar piezas), sin eficiencia ni merma');
  igual(r.outputs.some((o) => o.esMerma), false, 'el rechazo es un output en kg que NO es merma');
  afirmar(!('mermaCalculada' in r), 'sin mermaCalculada');
  await f.boton('Producción Cajas').disparar('click');
  await elegirProducto(f, 'CAJA CH25');
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['CAJA CH25', 'RECHAZO CAJAS P.E.'], 'CAJA CH25');
});

caso('Piezas: cambiar de producto cambia el pellet y el rechazo (CAJA AGRO20 -> PELLET AGRO20 y RECHAZO CAJAS P.P.; TAMBO -> PELLET TAMBO)', async () => {
  const { w } = escenarioPiezas();
  const f = crearSimple({ w });
  await f.boton('Producción Cajas').disparar('click');
  await elegirProducto(f, 'CAJA CO30');
  await teclear(salidaDe(f, 'CAJA CO30').cpsKg, 400);
  await elegirProducto(f, 'CAJA AGRO20');
  igual(f.entradas.children[0].cpsSelect.value, 'PELLET AGRO20', 'pellet de AGRO20');
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['CAJA AGRO20', 'RECHAZO CAJAS P.P.'], 'rechazo derivado P.P.');
  igual(f.salidas.children.map((c) => c.cpsKg.value), ['', ''], 'las piezas del otro producto no se arrastran');
  await f.boton('Producción Tambos').disparar('click');
  await elegirProducto(f, 'TAMBO');
  igual([f.entradas.children[0].cpsSelect.value, f.salidas.children.map((c) => c.cpsMaterial)], ['PELLET TAMBO', ['TAMBO', 'RECHAZO TAMBOS']], 'TAMBO');
});

caso('Piezas: TAPON, ORING y SELLO eligen PELLET TAPON o MATERIAL VIRGEN, sin rechazo, y se recuerda el último pellet usado', async () => {
  const { w, avisos, almacen } = escenarioPiezas();
  const f = crearSimple({ w });
  await f.boton('Producción de Tapones').disparar('click');
  await elegirProducto(f, 'TAPON');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean), ['PELLET TAPON', 'MATERIAL VIRGEN'], 'dos opciones');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.textContent).filter((t) => /MATERIAL VIRGEN/.test(t)), ['MATERIAL VIRGEN — 300 kg en RECEPCIÓN'], 'con el saldo de cada una');
  igual(f.entradas.children[0].cpsSelect.value, 'PELLET TAPON', 'sin historial se sugiere la primera');
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['TAPON'], 'sin fila de rechazo');
  for (const producto of ['ORING', 'SELLO']) {
    await elegirProducto(f, producto);
    igual(f.salidas.children.map((c) => c.cpsMaterial), [producto], `${producto}: sin rechazo`);
  }
  await elegirProducto(f, 'TAPON');
  f.entradas.children[0].cpsSelect.value = 'MATERIAL VIRGEN';
  await f.entradas.children[0].cpsSelect.disparar('change');
  await teclear(f.entradas.children[0].cpsKg, 100);
  await teclear(salidaDe(f, 'TAPON').cpsKg, 5000);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const r = avisos.guardados[0].registro;
  igual([r.inputs.map((i) => [i.material, i.kg]), r.outputs], [[['MATERIAL VIRGEN', 100]], [{ material: 'TAPON', kg: 5000, esMerma: false }]], 'MATERIAL VIRGEN comprado como entrada, sin fila de rechazo ni de merma');
  igual(almacen.get('eve:cp-ultimo-pellet:TAPON'), 'MATERIAL VIRGEN', 'se recordó el pellet usado');
  await f.boton('Producción de Tapones').disparar('click');
  await elegirProducto(f, 'TAPON');
  igual(f.entradas.children[0].cpsSelect.value, 'MATERIAL VIRGEN', 'la siguiente captura de TAPON lo preselecciona');
  await elegirProducto(f, 'ORING');
  igual(f.entradas.children[0].cpsSelect.value, 'PELLET TAPON', 'el recuerdo es por producto');
});

caso('Piezas: sin saldo del pellet del producto avisa y deja elegir otro material con saldo en el origen', async () => {
  const { w } = escenarioPiezas();
  w.EVE.inventarioInicial = SALDOS_PIEZAS.filter((i) => i.material !== 'PELLET AGRO20');
  const f = crearSimple({ w });
  await f.boton('Producción Cajas').disparar('click');
  await elegirProducto(f, 'CAJA AGRO20');
  afirmar(f.textos(f.avisos).some((t) => /No hay saldo de PELLET AGRO20/.test(t)), 'aviso de falta de saldo');
  const ofrecidos = f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean);
  igual(ofrecidos[0], 'PELLET AGRO20', 'el del producto primero');
  afirmar(ofrecidos.includes('PELLET CAJAS') && ofrecidos.includes('MATERIAL VIRGEN'), 'y los demás con saldo en PELETIZADO o RECEPCIÓN');
  afirmar(!ofrecidos.includes('CRISTAL CON ETIQUETA'), 'no un crudo');
});

caso('Piezas: el resumen muestra consumo, piezas y rechazo por separado y el cumplimiento diario de K6 (con el ticket en captura)', async () => {
  const { w } = escenarioPiezas();
  w.EVE.metaPiezasDia = { 'CAJA CO30': 1000 };
  w.EVE.registrosControlProduccion = [
    proceso(1, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 200)], [out('CAJA CO30', 300), out('RECHAZO CAJAS P.E.', 80)], '2026-09-15'),
    proceso(2, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 200)], [out('CAJA CO30', 900)], '2026-09-14')
  ];
  const f = crearSimple({ w });
  await f.boton('Producción Cajas').disparar('click');
  await elegirProducto(f, 'CAJA CO30');
  await teclear(f.entradas.children[0].cpsKg, 470);
  await teclear(salidaDe(f, 'CAJA CO30').cpsKg, 400);
  await teclear(salidaDe(f, 'RECHAZO CAJAS P.E.').cpsKg, 50);
  const texto = textoResumen(f);
  afirmar(/Material consumido: 470 kg/.test(texto), `consumo: ${texto}`);
  afirmar(/Piezas de CAJA CO30: 400/.test(texto), `piezas: ${texto}`);
  afirmar(/Rechazo \(RECHAZO CAJAS P\.E\.\): 50 kg/.test(texto), `rechazo: ${texto}`);
  afirmar(/Piezas del día de CAJA CO30: 700 de 1.?000 \(70\.0%\) — avance parcial/.test(texto), `cumplimiento con las 300 ya guardadas hoy + 400 en captura, sin el rechazo ni el día anterior: ${texto}`);
  igual(f.resumen.children.find((c) => /Piezas del día/.test(c.textContent)).className, 'cp-eficiencia-rojo', 'color según el cumplimiento');
  afirmar(!/Total salidas|Merma/.test(texto), 'no se suman piezas con kg ni hay merma');
  await teclear(salidaDe(f, 'RECHAZO CAJAS P.E.').cpsKg, 500);
  afirmar(/700 de 1.?000/.test(textoResumen(f)), 'el rechazo no altera el cumplimiento');
  await elegirProducto(f, 'CAJA CH25');
  await teclear(salidaDe(f, 'CAJA CH25').cpsKg, 120);
  afirmar(/Piezas del día de CAJA CH25: 120 — Sin meta configurada/.test(textoResumen(f)), `sin meta: ${textoResumen(f)}`);
});

caso('Piezas: Mostrar todos y la fecha recalculan la entrada del producto', async () => {
  const { w } = escenarioPiezas();
  const f = crearSimple({ w });
  await f.boton('Producción Cajas').disparar('click');
  await elegirProducto(f, 'CAJA CO30');
  f.todos.checked = true;
  await f.todos.disparar('change');
  const ofrecidos = f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean);
  igual(ofrecidos[0], 'PELLET CAJAS', 'el pellet del producto primero');
  afirmar(ofrecidos.length > 1, 'con Mostrar todos hay más');
  igual(f.entradas.children[0].cpsSelect.value, 'PELLET CAJAS', 'conserva la elección');
  f.fecha.value = '2025-12-01';
  await f.fecha.disparar('input');
  afirmar(f.textos(f.avisos).some((t) => /No hay saldo de PELLET CAJAS/.test(t)), 'antes del inventario inicial el pellet no tiene saldo a esa fecha: avisa');
  igual(f.entradas.children[0].cpsSelect.options.find((o) => o.value === 'PELLET CAJAS').textContent, 'PELLET CAJAS — sin saldo', 'y la opción lo dice');
});

caso('Piezas: Duplicar último registro copia el producto y el pellet del último del mismo proceso, con piezas, kg y rechazo vacíos', async () => {
  const { w } = escenarioPiezas();
  w.EVE.registrosControlProduccion = [
    proceso(1, 'PRODUCCION_TAPONES', [inp('PELLET TAPON', 30)], [out('ORING', 1000)], '2026-09-10', { operador: 'ANA', turno: 'Vespertino' }),
    proceso(2, 'PRODUCCION_TAPONES', [inp('MATERIAL VIRGEN', 40)], [out('SELLO', 2000)], '2026-09-12', { operador: 'LUIS', turno: 'Matutino' }),
    proceso(3, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 470)], [out('CAJA CO30', 400), out('RECHAZO CAJAS P.E.', 50)], '2026-09-14', { operador: 'PEDRO', turno: 'Vespertino' })
  ];
  const f = crearSimple({ w });
  await f.boton('Producción de Tapones').disparar('click');
  igual(f.botonDuplicar.disabled, false, 'hay un registro previo de Tapones');
  await f.botonDuplicar.disparar('click');
  igual([f.producto.value, f.entradas.children[0].cpsSelect.value, f.entradas.children[0].cpsKg.value], ['SELLO', 'MATERIAL VIRGEN', ''], 'producto y pellet del último Tapones (P-002), kg vacíos');
  igual([f.operador.value, f.turno.value], ['LUIS', 'Matutino'], 'operador y turno');
  igual(f.salidas.children.map((c) => [c.cpsMaterial, c.cpsKg.value]), [['SELLO', '']], 'piezas vacías');
  await f.boton('Producción Tambos').disparar('click');
  igual(f.botonDuplicar.disabled, true, 'sin registros de Tambos');
});

caso('Piezas: validaciones del formulario completo (un solo tipo de pieza, kg y piezas mayores a 0) y avisos de stock', async () => {
  const { w, avisos, respuestas } = escenarioPiezas();
  const f = crearSimple({ w });
  await f.boton('Producción Cajas').disparar('click');
  await elegirProducto(f, 'CAJA CO30');
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores.at(-1), 'Kg de cada material de entrada debe ser un número mayor a 0', 'sin kg consumidos: el mismo mensaje que la captura completa');
  igual(avisos.guardados.length, 0, 'no se guardó');
  await teclear(f.entradas.children[0].cpsKg, 100);
  await f.form.disparar('submit');
  igual(avisos.errores.at(-1), 'Agrega al menos un output', 'sin piezas ni rechazo: el mismo mensaje que la captura completa');
  igual(avisos.guardados.length, 0, 'tampoco se guardó');
  await teclear(f.entradas.children[0].cpsKg, 5000);
  await teclear(salidaDe(f, 'CAJA CO30').cpsKg, 400);
  respuestas.confirm = false;
  await f.form.disparar('submit');
  igual(avisos.guardados.length, 0, 'consumo mayor que el saldo: pide confirmación y se cancela');
  afirmar(avisos.confirmaciones.some((m) => /no tiene stock suficiente/.test(m)), 'aviso de stock');
  respuestas.confirm = true;
  await f.form.disparar('submit');
  igual(avisos.guardados.length, 1, 'con confirmación se guarda');
});

// ── K21l: edición y compatibilidad con registros existentes ──────────────

// Registro ANTERIOR a la captura simple: fechaInicio y fechaFin (sin fecha), turno Nocturno, sin ticketOrigen inferido ni
// mermaCalculada. Se arma a mano para que no tenga ningún campo de la captura simple.
const registroAntiguo = () => ({
  id: 'old1', ticket: 'P-005', tipoProceso: 'EMPACADO', fechaInicio: '2026-08-20T08:00', fechaFin: '2026-08-20T16:00',
  inputs: [{ material: 'P.E.', kg: 200, ticketOrigen: 'P-001' }], outputs: [{ material: 'P.E.', kg: 200, esMerma: false }],
  operador: 'LUIS', turno: 'Nocturno', totalInput: 200, totalOutput: 200, eficiencia: 100, porcentajeMerma: 0, observaciones: 'viejo'
});

function escenarioEdicion(registros, inventario) {
  // El dispositivo ya eligió la captura simple (así el interruptor arranca encendido, como lo recuerda el navegador).
  const ctx = escenarioBase({ almacen: { 'eve:cp-modo': 'simple' } });
  ctx.w.EVE.inventarioInicial = inventario || [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 500, fecha: '2026-01-01' }];
  ctx.w.EVE.registrosControlProduccion = registros;
  return ctx;
}

// Enciende el interruptor del modo simple como lo haría el operador y devuelve el formulario y el interruptor.
function crearSimpleActivo(ctx) {
  const completo = new Nodo('form');
  const f = crearSimple(ctx);
  ctx.w.EVE_CONTROL_PRODUCCION.crearInterruptorModoCaptura(completo, f.form);
  return { f, completo };
}

caso('Edición: con el interruptor apagado SIEMPRE es la edición completa; encendido, solo si el registro cabe', async () => {
  const ctx = escenarioBase();  // sin eve:cp-modo: la captura completa es la predeterminada
  ctx.w.EVE.registrosControlProduccion = [registroAntiguo()];
  ctx.w.EVE.inventarioInicial = [{ id: 'i1', material: 'P.E.', etapa: 'SELECCIÓN', kg: 500, fecha: '2026-01-01' }];
  const completo = new Nodo('form');
  const form = ctx.w.EVE_CONTROL_PRODUCCION.crearFormularioSimple();
  const interruptor = ctx.w.EVE_CONTROL_PRODUCCION.crearInterruptorModoCaptura(completo, form);
  igual(ctx.w.EVE_CONTROL_PRODUCCION.modoDeEdicion(registroAntiguo()), 'completa', 'apagado: completa');
  const casilla = interruptor.descendientes().find((n) => n.tagName === 'INPUT' && n.type === 'checkbox');
  casilla.checked = true;
  await casilla.disparar('change');
  igual(ctx.w.EVE_CONTROL_PRODUCCION.modoDeEdicion(registroAntiguo()), 'simple', 'encendido y cabe: simple');
  const noCabe = { ...registroAntiguo(), outputs: [{ material: 'P.E.', kg: 150, esMerma: false }, { material: 'LODOS', kg: 50, esMerma: true }] };
  igual(ctx.w.EVE_CONTROL_PRODUCCION.modoDeEdicion(noCabe), 'completa', 'Empacado con merma: no cabe -> completa');
  casilla.checked = false;
  await casilla.disparar('change');
  igual(ctx.w.EVE_CONTROL_PRODUCCION.modoDeEdicion(registroAntiguo()), 'completa', 'apagado otra vez: completa');
});

caso('Edición simple de un registro ANTERIOR: lo lee entero (fechaFin, turno Nocturno, origen manual) y al guardar no pierde ni inventa datos', async () => {
  const ctx = escenarioEdicion([registroAntiguo()]);
  const { w, avisos } = ctx;
  const { f } = crearSimpleActivo(ctx);
  w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(registroAntiguo());
  igual(f.edicion.style.display, '', 'banner de edición');
  igual(f.edicion.children[0].textContent, 'Editando P-005', 'ticket en el banner');
  igual([f.fecha.value, f.operador.value, f.turno.value, f.observaciones.value], ['2026-08-20', 'LUIS', 'Nocturno', 'viejo'], 'fecha de fechaFin, operador, turno Nocturno conservado y observaciones');
  igual(f.turno.options.map((o) => o.value), ['', 'Matutino', 'Vespertino', 'Nocturno'], 'el turno antiguo queda como opción');
  igual(f.entradas.children.map((c) => [c.cpsSelect.value, c.cpsKg.value]), [['P.E.', '200']], 'entrada');
  igual(f.salidas.children.map((c) => [c.cpsMaterial, c.cpsKg.value]), [['P.E.', '200']], 'salida');
  igual([f.guardar.textContent, f.cancelar.style.display, f.motivo.style.display, f.botonDuplicar.style.display], ['Guardar cambios', '', '', 'none'], 'controles de edición');
  igual(f.boton('Empacado').disabled, true, 'no se cambia el proceso al editar');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.textContent)[1], 'P.E. — 500 kg en SELECCIÓN', 'saldo SIN contar el propio registro');
  await teclear(f.entradas.children[0].cpsKg, 210);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 210);
  f.motivo.value = '  se corrigió el pesaje  ';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  igual(avisos.guardados.length, 0, 'no es un alta');
  igual(avisos.actualizados.length, 1, 'se actualizó una vez');
  const { coleccion, id, datos } = avisos.actualizados[0];
  igual([coleccion, id, datos.ticket], ['control_produccion', 'old1', 'P-005'], 'mismo documento y mismo ticket');
  igual(datos.turno, 'Nocturno', 'el turno antiguo no se pierde');
  igual(datos.inputs, [{ material: 'P.E.', kg: 210, ticketOrigen: 'P-001' }], 'el origen manual se conserva y NO se marca inferido');
  afirmar(!('mermaCalculada' in datos), 'un registro anterior sin mermaCalculada no lo recibe');
  afirmar(!('fechaInicio' in datos) && !('fechaFin' in datos), 'update no toca fechaInicio ni fechaFin (se conservan en el documento)');
  igual(datos.fecha, '2026-08-20', 'guarda la fecha del proceso en el campo actual');
  igual([datos.totalInput, datos.totalOutput, datos.eficiencia], [210, 210, 100], 'totales con la misma función que la captura completa');
  igual(avisos.historial.length, 1, 'un registro en el historial');
  const h = avisos.historial[0];
  igual([h.coleccion, h.registroId, h.accion, h.motivo], ['control_produccion', 'old1', 'edicion', 'se corrigió el pesaje'], 'historial con motivo');
  igual([h.valorAnterior.turno, h.valorNuevo.turno, h.valorAnterior.fecha, h.valorNuevo.fecha], ['Nocturno', 'Nocturno', '2026-08-20', '2026-08-20'], 'valores anterior y nuevo con la forma de la edición completa');
  igual(Object.keys(h.valorNuevo), ['ticket', 'tipoProceso', 'outputs', 'operador', 'turno', 'fecha'], 'mismo contenido que registra la edición completa');
  const enMemoria = w.EVE.registrosControlProduccion[0];
  igual([enMemoria.fechaInicio, enMemoria.fechaFin, enMemoria.inputs[0].kg], ['2026-08-20T08:00', '2026-08-20T16:00', 210], 'en memoria conserva fechaInicio y fechaFin');
  igual(avisos.exitos.at(-1), 'Registro actualizado', 'aviso de éxito');
  igual([f.edicion.style.display, f.editor.style.display, f.boton('Empacado').disabled], ['none', 'none', false], 'el formulario vuelve al estado de alta');
});

caso('Edición simple: el ticketOrigen inferido se conserva (y su marca) mientras no cambie el material; al cambiarlo se vuelve a resolver', async () => {
  const seleccion = proceso(7, 'SELECCION', [{ ...inp('CRISTAL CON ETIQUETA', 1000, '10'), ticketOrigenInferido: true }],
    [out('PET CRISTAL', 900), out('BASURA', 100, true)], '2026-09-10', { mermaCalculada: true, porcentajeMerma: 10, totalInput: 1000 });
  const ctx = escenarioEdicion([seleccion], []);
  ctx.w.EVE.registrosDestaraje = [compra(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01'), compra(12, 'MIXTO', 800, '2026-09-02')];
  ctx.w.EVE.composiciones.push(composicion('MIXTO', [['PET CRISTAL', 90], ['BASURA', 10, true]]));
  const { f } = crearSimpleActivo(ctx);
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(seleccion);
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.textContent)[1], 'CRISTAL CON ETIQUETA — 1000 kg en RECEPCIÓN', 'el saldo no cuenta la Selección que se edita');
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 800);
  igual([f.mermaKg.value, f.mermaTipo.value], ['200', 'BASURA'], 'merma calculada vuelve a calcularse (mermaCalculada=true)');
  await f.form.disparar('submit');
  const r = ctx.avisos.actualizados[0].datos;
  igual(ctx.avisos.errores, [], 'sin errores');
  igual(r.inputs, [{ material: 'CRISTAL CON ETIQUETA', kg: 1000, ticketOrigen: '10', ticketOrigenInferido: true }], 'origen y marca conservados');
  igual([r.mermaCalculada, r.outputs.at(-1)], [true, { material: 'BASURA', kg: 200, esMerma: true }], 'sigue calculada');
  // Cambiar el material de la entrada vuelve a resolver el origen del nuevo material.
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(seleccion);
  f.todos.checked = true;
  await f.todos.disparar('change');
  await elegirEntrada(f, f.entradas.children[0], 'MIXTO', 800);
  await teclear(salidaDe(f, 'PET CRISTAL').cpsKg, 700);
  await f.form.disparar('submit');
  const r2 = ctx.avisos.actualizados.at(-1).datos;
  igual(ctx.avisos.errores, [], 'sin errores');
  igual(r2.inputs.map((i) => [i.material, i.ticketOrigen, i.ticketOrigenInferido]), [['MIXTO', '12', true]], 'MIXTO: origen resuelto de nuevo');
});

caso('Edición simple: editar la merma a mano deja mermaCalculada=false; en un registro anterior con merma se respeta lo guardado', async () => {
  const conFlag = proceso(7, 'SELECCION', [inp('CRISTAL CON ETIQUETA', 1000, '10')], [out('PET CRISTAL', 900), out('BASURA', 100, true)], '2026-09-10', { mermaCalculada: true, porcentajeMerma: 10 });
  const ctx = escenarioEdicion([conFlag], []);
  ctx.w.EVE.registrosDestaraje = [compra(10, 'CRISTAL CON ETIQUETA', 1000, '2026-09-01')];
  const { f } = crearSimpleActivo(ctx);
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(conFlag);
  await teclear(f.mermaKg, 95);
  await f.form.disparar('submit');
  igual(ctx.avisos.actualizados.at(-1).datos.mermaCalculada, false, 'merma editada a mano: false');
  // Registro anterior (sin mermaCalculada) con merma: se muestra la guardada y no se agrega el campo.
  const sinFlag = { ...proceso(8, 'SELECCION', [inp('CRISTAL CON ETIQUETA', 1000, '10')], [out('PET CRISTAL', 900), out('BASURA', 60, true)], '2026-09-11'), fecha: undefined, fechaFin: '2026-09-11T10:00' };
  delete sinFlag.fecha;
  ctx.w.EVE.registrosControlProduccion.push(sinFlag);
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(sinFlag);
  igual([f.mermaKg.value, f.mermaTipo.value, f.fecha.value], ['60', 'BASURA', '2026-09-11'], 'muestra la merma guardada (no la recalcula) y la fecha de fechaFin');
  await f.form.disparar('submit');
  const d = ctx.avisos.actualizados.at(-1).datos;
  igual(d.outputs.filter((o) => o.esMerma).map((o) => [o.material, o.kg]), [['BASURA', 60]], 'merma guardada intacta');
  afirmar(!('mermaCalculada' in d), 'no se agrega mermaCalculada a un registro anterior');
});

caso('Edición simple: los avisos son los del alta (stock, salidas mayores que la entrada con motivo) y cancelar no guarda nada', async () => {
  const antiguo = registroAntiguo();
  const ctx = escenarioEdicion([antiguo]);
  const { f } = crearSimpleActivo(ctx);
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(antiguo);
  await teclear(f.entradas.children[0].cpsKg, 900);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 900);
  ctx.respuestas.confirm = false;
  await f.form.disparar('submit');
  igual(ctx.avisos.actualizados.length, 0, 'sin stock suficiente y el operador dice que no: no se guarda');
  afirmar(ctx.avisos.confirmaciones.some((m) => /no tiene stock suficiente/.test(m)), 'pidió confirmación de stock (500 disponibles)');
  await f.cancelar.disparar('click');
  igual([f.edicion.style.display, f.editor.style.display, f.guardar.textContent, ctx.avisos.actualizados.length], ['none', 'none', 'Guardar', 0], 'cancelar vuelve al alta sin guardar');
  igual(ctx.w.EVE.registrosControlProduccion[0].inputs[0].kg, 200, 'el registro no cambió');
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(antiguo);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 260);
  ctx.respuestas.confirm = true;
  ctx.respuestas.prompt = null;
  await teclear(f.entradas.children[0].cpsKg, 250);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 260);
  await f.form.disparar('submit');
  igual([ctx.avisos.prompts.length, ctx.avisos.actualizados.length], [0, 1], 'Empacado con salida mayor no pide motivo (no tiene merma): avisa en pantalla pero guarda');
});

caso('Edición simple: un registro de pieza y uno de Peletizado se cargan completos y se guardan con el mismo esquema', async () => {
  const pieza = proceso(9, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 470, 'P-003')], [out('CAJA CO30', 400), out('RECHAZO CAJAS P.E.', 50)], '2026-09-12', { eficiencia: null, totalOutput: 50 });
  const pelet = proceso(10, 'PELETIZADO', [inp('P.E. MOLIDO', 300, 'P-004'), inp('P.P. MOLIDO', 200, '30')], [out('PELLET CAJAS', 480), out('PIEDRAS', 20, true)], '2026-09-13');
  const ctx = escenarioEdicion([pieza, pelet], [
    { id: 'p1', material: 'PELLET CAJAS', etapa: 'PELETIZADO', kg: 1000, fecha: '2026-01-01' },
    { id: 'p2', material: 'P.E. MOLIDO', etapa: 'MOLIENDA', kg: 400, fecha: '2026-01-01' },
    { id: 'p3', material: 'P.P. MOLIDO', etapa: 'LAVADO', kg: 300, fecha: '2026-01-01' }
  ]);
  const { f } = crearSimpleActivo(ctx);
  igual(ctx.w.EVE_CONTROL_PRODUCCION.modoDeEdicion(pieza), 'simple', 'la pieza cabe');
  igual(ctx.w.EVE_CONTROL_PRODUCCION.modoDeEdicion(pelet), 'simple', 'Peletizado cabe');
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(pieza);
  igual([f.producto.value, f.entradas.children[0].cpsSelect.value, f.entradas.children[0].cpsKg.value], ['CAJA CO30', 'PELLET CAJAS', '470'], 'pieza: producto, pellet y consumo');
  igual(f.salidas.children.map((c) => [c.cpsMaterial, c.cpsKg.value]), [['CAJA CO30', '400'], ['RECHAZO CAJAS P.E.', '50']], 'pieza: piezas y rechazo');
  await f.form.disparar('submit');
  igual(ctx.avisos.errores, [], 'sin errores');
  const rp = ctx.avisos.actualizados[0].datos;
  igual([rp.inputs, rp.outputs, rp.eficiencia, rp.totalOutput], [[{ material: 'PELLET CAJAS', kg: 470, ticketOrigen: 'P-003' }], [{ material: 'CAJA CO30', kg: 400, esMerma: false }, { material: 'RECHAZO CAJAS P.E.', kg: 50, esMerma: false }], null, 50], 'pieza guardada sin cambios');
  ctx.w.EVE_CONTROL_PRODUCCION.editarRegistroSimple(pelet);
  igual(f.entradas.children.map((c) => [c.cpsSelect.value, c.cpsKg.value]), [['P.E. MOLIDO', '300'], ['P.P. MOLIDO', '200']], 'Peletizado: dos entradas');
  igual(f.salidas.children.map((c) => [c.cpsManual, c.cpsSelect.value, c.cpsKg.value]), [[true, 'PELLET CAJAS', '480']], 'Peletizado: una sola fila de salida (la que eligió el operador)');
  await f.form.disparar('submit');
  const rl = ctx.avisos.actualizados[1].datos;
  igual(rl.inputs.map((i) => [i.material, i.kg, i.ticketOrigen]), [['P.E. MOLIDO', 300, 'P-004'], ['P.P. MOLIDO', 200, '30']], 'orígenes conservados');
  igual(rl.outputs, [{ material: 'PELLET CAJAS', kg: 480, esMerma: false }, { material: 'PIEDRAS', kg: 20, esMerma: true }], 'Peletizado guardado igual');
  afirmar(!('mermaCalculada' in rl), 'Peletizado anterior sin el campo: no se agrega');
});

caso('cabeEnCapturaSimple: lo que cabe y lo que va a la edición completa', () => {
  const { w } = escenarioBase();
  const cabe = (r) => w.EVE_CP_REGLAS.cabeEnCapturaSimple(r);
  const base = proceso(1, 'SELECCION', [inp('CRISTAL CON ETIQUETA', 1000)], [out('PET CRISTAL', 900), out('BASURA', 100, true)], '2026-09-10');
  igual(cabe(base).cabe, true, 'Selección normal');
  const no = (r, parte) => { const c = cabe(r); afirmar(!c.cabe && new RegExp(parte).test(c.motivo), `debía no caber (${parte}): ${JSON.stringify(c)}`); };
  no({ ...base, tipoProceso: 'NO_EXISTE' }, 'no está cubierto');
  no({ ...base, inputs: [] }, 'no tiene entradas');
  no({ ...base, inputs: [inp('MATERIAL RARO', 100)] }, 'fuera del catálogo');
  no({ ...base, inputs: [inp('CRISTAL CON ETIQUETA', 0)] }, 'sin kg');
  no({ ...base, outputs: [out('PET CRISTAL', 900), out('BASURA', 60, true), out('BASURA', 40, true)] }, 'más de una fila de merma');
  no({ ...base, outputs: [out('PET CRISTAL', 900), out('LODOS', 100, true)] }, 'no es un tipo de merma');
  no({ ...base, outputs: [out('PET CRISTAL', 900), out('SALIDA RARA', 100)] }, 'fuera del catálogo');
  no({ ...base, outputs: [out('CAJA CO30', 10)] }, 'una pieza como salida');
  no(proceso(1, 'MOLIENDA', [inp('P.E.', 10), inp('P.P.', 10)], [out('P.E. MOLIDO', 20)], '2026-09-10'), 'solo admite una entrada');
  no(proceso(1, 'MOLIENDA', [inp('DURO', 10)], [out('P.P. MOLIDO', 10)], '2026-09-10'), 'solo ofrece los materiales que se muelen');
  no(proceso(1, 'EMPACADO', [inp('P.E.', 10)], [out('P.E.', 8), out('LODOS', 2, true)], '2026-09-10'), 'no tiene merma');
  no(proceso(1, 'PELETIZADO', [inp('P.E. MOLIDO', 10)], [out('P.E. MOLIDO', 10)], '2026-09-10'), 'no está entre las que ofrece');
  no(proceso(1, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 10), inp('PELLET AGRO20', 10)], [out('CAJA CO30', 10)], '2026-09-10'), 'solo admite una entrada');
  no(proceso(1, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 10)], [out('CAJA CO30', 10), out('CAJA CH25', 10)], '2026-09-10'), 'un solo tipo de pieza');
  no(proceso(1, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 10)], [out('TAMBO', 10)], '2026-09-10'), 'no se produce en este proceso');
  no(proceso(1, 'PRODUCCION_CAJAS', [inp('PELLET CAJAS', 10)], [out('CAJA CO30', 10), out('RECHAZO TAMBOS', 5)], '2026-09-10'), 'rechazo derivado');
  no(proceso(1, 'PRODUCCION_TAPONES', [inp('PELLET TAPON', 10)], [out('TAPON', 10), out('RECHAZO CAJAS P.E.', 5)], '2026-09-10'), 'rechazo derivado');
  igual(cabe(proceso(1, 'PRODUCCION_TAPONES', [inp('MATERIAL VIRGEN', 10)], [out('TAPON', 10)], '2026-09-10')).cabe, true, 'tapón con MATERIAL VIRGEN');
  w.EVE_CATALOGO.aplicar({ version: 1, materiales: {}, overrides: { 'CRISTAL CON ETIQUETA': { activo: false } } });
  no(base, 'archivada');
});

caso('conservarOpcionalesAlEditar (edición completa): conserva la marca de inferido solo si el origen no cambió y nunca inventa campos', () => {
  const { w } = escenarioBase();
  const f = (a, n) => w.EVE_CP_REGLAS.conservarOpcionalesAlEditar(a, n);
  const anterior = { inputs: [{ material: 'P.E.', kg: 100, ticketOrigen: 'P-001', ticketOrigenInferido: true }, { material: 'P.P.', kg: 50, ticketOrigen: '9' }],
    outputs: [out('P.E. MOLIDO', 140), out('LODOS', 10, true)], mermaCalculada: true };
  const igualRegistro = () => ({ inputs: [{ material: 'P.E.', kg: 100, ticketOrigen: 'P-001' }, { material: 'P.P.', kg: 50, ticketOrigen: '9' }], outputs: [out('P.E. MOLIDO', 140), out('LODOS', 10, true)] });
  const r1 = f(anterior, igualRegistro());
  igual(r1.inputs.map((i) => i.ticketOrigenInferido), [true, undefined], 'la marca solo en la entrada que la tenía');
  igual(r1.mermaCalculada, true, 'merma igual y cuadra: sigue calculada');
  const editado = igualRegistro();
  editado.inputs[0].ticketOrigen = 'P-002';
  igual(f(anterior, editado).inputs[0].ticketOrigenInferido, undefined, 'editar el ticket quita la marca');
  const otroMaterial = igualRegistro();
  otroMaterial.inputs[0].material = 'P.E. MOLIDO';
  igual(f(anterior, otroMaterial).inputs[0].ticketOrigenInferido, undefined, 'cambiar el material también');
  const mermaCambiada = igualRegistro();
  mermaCambiada.outputs[1].kg = 5;
  igual(f(anterior, mermaCambiada).mermaCalculada, false, 'merma cambiada a mano: false');
  const salidaCambiada = igualRegistro();
  salidaCambiada.outputs[0].kg = 100;
  igual(f(anterior, salidaCambiada).mermaCalculada, false, 'la misma merma pero ya no cuadra con la diferencia: false');
  const antiguo = { inputs: [{ material: 'P.E.', kg: 100, ticketOrigen: 'P-001' }], outputs: [out('P.E. MOLIDO', 90), out('LODOS', 10, true)] };
  const r2 = f(antiguo, { inputs: [{ material: 'P.E.', kg: 100, ticketOrigen: 'P-001' }], outputs: [out('P.E. MOLIDO', 90), out('LODOS', 10, true)] });
  afirmar(!('mermaCalculada' in r2) && r2.inputs[0].ticketOrigenInferido === undefined, 'un registro anterior no recibe ningún campo nuevo');
  const dos = f({ inputs: [{ material: 'P.E.', kg: 1, ticketOrigen: 'X', ticketOrigenInferido: true }], outputs: [out('P.E.', 1)], mermaCalculada: false },
    { inputs: [{ material: 'P.E.', kg: 1, ticketOrigen: 'X' }, { material: 'P.E.', kg: 1, ticketOrigen: 'X' }], outputs: [out('P.E.', 2)] });
  igual(dos.inputs.map((i) => i.ticketOrigenInferido), [true, undefined], 'una marca no se reparte entre dos entradas iguales');
  igual(dos.mermaCalculada, false, 'mermaCalculada=false se conserva como false');
});

// ── K21n: escenarios de punta a punta del documento de diseño ────────────

caso('K21n: Selección de DURO (P.P., P.E. y BASURA, sin fila DURO) y Molienda sin oferta de DURO, VERDE ni CRISTAL', async () => {
  const { w, avisos } = escenarioBase();
  w.EVE.registrosDestaraje = [compra(20, 'DURO', 500, '2026-09-03')];
  w.EVE.composiciones = [composicion('DURO', [['P.P.', 60], ['P.E.', 35], ['BASURA', 5, true]])];
  w.EVE.inventarioInicial = ['DURO', 'VERDE', 'CRISTAL CON VERDE', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON LECHERO', 'P.E.'].map((m, i) => ({ id: `i${i}`, material: m, etapa: 'SELECCIÓN', kg: 100, fecha: '2026-01-01' }));
  const f = crearSimple({ w });
  await f.boton('Selección').disparar('click');
  await elegirEntrada(f, f.entradas.children[0], 'DURO', 500);
  igual(f.salidas.children.map((c) => c.cpsMaterial), ['P.P.', 'P.E.'], 'salidas P.P. y P.E., sin fila DURO');
  igual([f.mermaTipo.value, f.merma.style.display], ['BASURA', ''], 'merma BASURA');
  await teclear(salidaDe(f, 'P.P.').cpsKg, 290);
  await teclear(salidaDe(f, 'P.E.').cpsKg, 180);
  igual(f.mermaKg.value, '30', 'merma por diferencia (6 %)');
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  igual(avisos.guardados[0].registro.outputs.map((o) => [o.material, o.kg, o.esMerma]), [['P.P.', 290, false], ['P.E.', 180, false], ['BASURA', 30, true]], 'registro de Selección de DURO');
  await f.boton('Molienda').disparar('click');
  for (const mostrarTodos of [false, true]) {
    f.todos.checked = mostrarTodos;
    await f.todos.disparar('change');
    const ofrecidos = f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean);
    for (const no of ['DURO', 'VERDE', 'CRISTAL CON VERDE', 'CRISTAL SIN ETIQUETA', 'CRISTAL CON LECHERO', 'CRISTAL CON ETIQUETA']) afirmar(!ofrecidos.includes(no), `Molienda no ofrece ${no} (Mostrar todos: ${mostrarTodos})`);
  }
});

caso('K21n: Molienda de RECHAZO CAJAS P.E., RECHAZO CAJAS P.P. y RECHAZO TAMBOS produce su molido y guarda con LODOS', async () => {
  const { w, avisos } = escenarioBase();
  w.EVE.inventarioInicial = [
    { id: 'r1', material: 'RECHAZO CAJAS P.E.', etapa: 'INYECCIÓN', kg: 100, fecha: '2026-01-01' },
    { id: 'r2', material: 'RECHAZO CAJAS P.P.', etapa: 'INYECCIÓN', kg: 100, fecha: '2026-01-01' },
    { id: 'r3', material: 'RECHAZO TAMBOS', etapa: 'SOPLADO', kg: 100, fecha: '2026-01-01' }
  ];
  const f = crearSimple({ w });
  await f.boton('Molienda').disparar('click');
  igual(f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean), ['RECHAZO CAJAS P.E.', 'RECHAZO CAJAS P.P.', 'RECHAZO TAMBOS'], 'los tres rechazos con saldo');
  for (const [rechazo, molido] of [['RECHAZO CAJAS P.E.', 'P.E. MOLIDO'], ['RECHAZO CAJAS P.P.', 'P.P. MOLIDO'], ['RECHAZO TAMBOS', 'P.E. MOLIDO']]) {
    await elegirEntrada(f, f.entradas.children[0], rechazo, 100);
    igual(f.salidas.children.map((c) => c.cpsMaterial), [molido], `${rechazo} -> ${molido}`);
  }
  await elegirEntrada(f, f.entradas.children[0], 'RECHAZO TAMBOS', 100);
  await teclear(salidaDe(f, 'P.E. MOLIDO').cpsKg, 95);
  f.operador.value = 'LUIS';
  f.turno.value = 'Matutino';
  await f.form.disparar('submit');
  igual(avisos.errores, [], 'sin errores');
  const r = avisos.guardados[0].registro;
  igual([r.inputs[0].material, r.outputs.map((o) => [o.material, o.kg, o.esMerma])], ['RECHAZO TAMBOS', [['P.E. MOLIDO', 95, false], ['LODOS', 5, true]]], 'registro');
  igual(r.inputs[0].ticketOrigen, '', 'sin proceso previo con ese rechazo en SOPLADO no hay origen que inferir');
});

caso('K21n: un molido comprado entra a Lavado y a Peletizado desde RECEPCIÓN; Selección no lo ofrece y Empacado solo toma de SELECCIÓN', async () => {
  const { w } = escenarioBase();
  w.EVE.inventarioInicial = [
    { id: 'm1', material: 'P.E. MOLIDO', etapa: 'RECEPCIÓN', kg: 200, fecha: '2026-01-01' },
    { id: 'm2', material: 'P.E.', etapa: 'SELECCIÓN', kg: 100, fecha: '2026-01-01' },
    { id: 'm3', material: 'PET CRISTAL', etapa: 'MOLIENDA', kg: 100, fecha: '2026-01-01' }
  ];
  const f = crearSimple({ w });
  const ofrecidos = async (nombre) => { await f.boton(nombre).disparar('click'); return f.entradas.children[0].cpsSelect.options.map((o) => o.value).filter(Boolean); };
  afirmar((await ofrecidos('Lavado')).includes('P.E. MOLIDO'), 'Lavado ofrece el molido comprado desde RECEPCIÓN');
  afirmar((await ofrecidos('Peletizado')).includes('P.E. MOLIDO'), 'Peletizado también');
  afirmar(!(await ofrecidos('Selección')).includes('P.E. MOLIDO'), 'Selección no ofrece un molido');
  igual(await ofrecidos('Empacado'), ['P.E.'], 'Empacado solo ofrece lo que tiene saldo en SELECCIÓN (no el molido de RECEPCIÓN ni lo de MOLIENDA)');
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
