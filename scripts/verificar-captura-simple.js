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
  const avisos = { errores: [], exitos: [], confirmaciones: [], prompts: [], guardados: [] };
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

caso('Sin proceso elegido no hay editor; Peletizado y las piezas avisan que se use la captura completa', async () => {
  const { w } = escenarioBase();
  const f = crearSimple({ w });
  igual(f.editor.style.display, 'none', 'editor oculto al inicio');
  for (const nombre of ['Peletizado', 'Producción Cajas', 'Producción Tambos', 'Producción de Tapones']) {
    await f.boton(nombre).disparar('click');
    igual(f.textos(f.avisos), ['Usa la captura completa para este proceso'], `aviso de ${nombre}`);
    igual(f.editor.style.display, 'none', `${nombre}: editor oculto`);
  }
  igual(f.botonDuplicar.disabled, true, 'Duplicar deshabilitado');
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
