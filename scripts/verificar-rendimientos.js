// T1 — Arnés de verificación del comparativo de Rendimientos (línea base).
//
// Carga en un contexto vm, con un `window` simulado, js/config.js (catálogo y alias reales),
// js/utils.js, js/rendimientos.js y js/reportes.js, y ejecuta casos sintéticos sobre
// window.calcularRendimientoMaterial. Sin dependencias nuevas.
//
// Los casos 1-4 DOCUMENTAN EL COMPORTAMIENTO ACTUAL (línea base), incluidos los defectos
// conocidos (H1, H4); no afirman que ese comportamiento sea el deseado. Cuando una tarea posterior
// corrija uno de esos puntos, el caso correspondiente debe actualizarse a propósito: T3 (merma real),
// T2 (el caso 3: las piezas ya no cuentan como kg, antes H2) y T17 (el caso 5: Por Material compara
// solo contra SELECCION). T4 (esMerma por versión de composición) se prueba en los casos T4.
//
// Uso: node scripts/verificar-rendimientos.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');

// ── Contexto vm ──────────────────────────────────────────────────────────

function crearContexto(archivos) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error,
    setTimeout, clearTimeout,
    document: {},
    // config.js inicializa Firebase al cargarse: se simula lo mínimo.
    firebase: {
      initializeApp() {},
      firestore() {
        return { enablePersistence() { return Promise.resolve(); } };
      }
    }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = {
    registrosDestaraje: [], registrosControlProduccion: [], composiciones: [], precios: [],
    ajustesPrecioProveedor: [], comisiones: [], ventas: [], inventarioInicial: []
  };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of archivos) {
    const ruta = path.join(RAIZ, archivo);
    vm.runInContext(fs.readFileSync(ruta, 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/rendimientos.js', 'js/reportes.js'];

// ── Datos sintéticos ─────────────────────────────────────────────────────

function composicion(materialEntrada, fechaVigencia, componentes, extra) {
  return {
    id: `c-${materialEntrada}-${fechaVigencia}`,
    materialEntrada, descripcion: '', version: 1, fechaVigencia, fechaCierre: null,
    totalPorcentaje: 100, componentes, ...(extra || {})
  };
}

function entrada(ticket, material, kg, fecha) {
  return { id: `d-${ticket}`, ticket: String(ticket), material, kg, fechaEntrada: fecha, fechaSalida: fecha, proveedor: 'PRUEBA' };
}

function proceso(ticket, tipoProceso, inputs, outputs, fecha) {
  return {
    id: `p-${ticket}`, ticket, tipoProceso, inputs, outputs, operador: 'OP', turno: 'Matutino',
    fechaInicio: `${fecha}T08:00`, fechaFin: `${fecha}T16:00`
  };
}

const MIXTO_80_20 = composicion('MIXTO', '2026-08-01', [
  { subproducto: 'PET CRISTAL', porcentaje: 80, esMerma: false, procesosValidos: [], procesoSugerido: null },
  { subproducto: 'BASURA', porcentaje: 20, esMerma: true, procesosValidos: [], procesoSugerido: null }
]);

const PERIODO = { desde: '2026-07-01', hasta: '2026-08-31' };

function escenario({ entradas, composiciones, procesos }) {
  const w = crearContexto(ARCHIVOS);
  w.EVE.registrosDestaraje = entradas || [];
  w.EVE.composiciones = composiciones || [];
  w.EVE.registrosControlProduccion = procesos || [];
  return w;
}

function fila(resultado, subproducto) {
  return resultado.filas.find((f) => f.subproducto === subproducto);
}

// ── Mini arnés de pruebas ────────────────────────────────────────────────

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }

function cerca(a, b, tolerancia = 0.01) { return Math.abs(a - b) <= tolerancia; }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function afirmarCerca(real, esperado, mensaje) {
  afirmar(cerca(real, esperado), `${mensaje}: esperado ${esperado}, obtenido ${real}`);
}

// ── Caso 1: entradas con y sin composición vigente ───────────────────────
// Comportamiento actual (H1): las entradas SIN composición vigente cuentan en el denominador
// (entradaTotalKg) pero NO aportan al esperado, así que el % esperado se diluye.

caso('1a. Con composición vigente: el esperado sale de la composición', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 790, esMerma: false }, { material: 'BASURA', kg: 210, esMerma: true }], '2026-08-06')]
  });
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmarCerca(r.entradaTotalKg, 1000, 'entradaTotalKg');
  afirmar(r.cantidadTickets === 1, 'cantidadTickets debe ser 1');
  afirmarCerca(fila(r, 'PET CRISTAL').esperadoPct, 80, 'esperadoPct PET CRISTAL');
  afirmarCerca(fila(r, 'PET CRISTAL').realKg, 790, 'realKg PET CRISTAL');
  afirmarCerca(fila(r, 'PET CRISTAL').realPct, 79, 'realPct PET CRISTAL');
  afirmarCerca(fila(r, 'PET CRISTAL').diferencia, -1, 'diferencia PET CRISTAL');
});

caso('1b. Sin ninguna composición: solo hay real, esperado 0 (hueco de datos)', () => {
  const w = escenario({
    composiciones: [],
    entradas: [entrada(1, 'LECHERO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'LECHERO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'LECHERO', kg: 900, esMerma: false }], '2026-08-06')]
  });
  const r = w.calcularRendimientoMaterial('LECHERO', PERIODO);
  afirmarCerca(r.entradaTotalKg, 1000, 'entradaTotalKg (cuenta en el denominador)');
  afirmarCerca(fila(r, 'LECHERO').esperadoPct, 0, 'esperadoPct');
  afirmarCerca(fila(r, 'LECHERO').realPct, 90, 'realPct');
  afirmarCerca(fila(r, 'LECHERO').diferencia, 90, 'diferencia inflada por falta de composición');
});

caso('1c. Entrada anterior a la vigencia: cuenta en el denominador pero no en el esperado (H1)', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05'), entrada(2, 'MIXTO', 500, '2026-07-15')],
    procesos: []
  });
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmarCerca(r.entradaTotalKg, 1500, 'entradaTotalKg incluye la entrada sin composición');
  // esperado = 1000 * 80% = 800 kg sobre 1500 kg de entrada
  afirmarCerca(fila(r, 'PET CRISTAL').esperadoPct, (800 / 1500) * 100, 'esperadoPct diluido');
});

// ── Caso 2: outputs de merma ─────────────────────────────────────────────
// Comportamiento actual (H3): el real solo suma outputs NO merma; la merma real capturada
// no llega al reporte. La merma esperada sí aparece (viene de la composición).

caso('2. Outputs merma: no entran al aprovechamiento; la fila de merma muestra la merma real (T3)', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 790, esMerma: false }, { material: 'BASURA', kg: 210, esMerma: true }], '2026-08-06')]
  });
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  const basura = fila(r, 'BASURA');
  afirmar(basura, 'la merma esperada debe aparecer como fila');
  afirmar(basura.esMerma === true, 'la fila BASURA debe marcarse esMerma');
  afirmarCerca(basura.realKg, 210, 'realKg de BASURA = la merma real capturada (T3: antes era 0)');
  afirmarCerca(basura.realPct, 21, 'realPct de BASURA');
  afirmarCerca(basura.diferencia, 1, 'diferencia de BASURA: 21% real vs 20% esperado');
  afirmarCerca(r.mermaRealKg, 210, 'mermaRealKg total');
  afirmarCerca(r.mermaRealPct, 21, 'mermaRealPct total sobre la entrada (1000 kg)');
  afirmarCerca(basura.esperadoPct, 20, 'esperadoPct de BASURA');
  afirmarCerca(r.aprovechamientoReal, 79, 'aprovechamientoReal excluye la merma');
  afirmarCerca(r.aprovechamientoEsperado, 80, 'aprovechamientoEsperado excluye la merma');
});

// ── T3: merma real en Por Material ────────────────────────────────────────

const escenarioMerma = (kgBasura, extraOutputs) => escenario({
  composiciones: [MIXTO_80_20],
  entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
  procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
    [{ material: 'PET CRISTAL', kg: 1000 - kgBasura - ((extraOutputs || []).reduce((s, o) => s + o.kg, 0)), esMerma: false }, { material: 'BASURA', kg: kgBasura, esMerma: true }, ...(extraOutputs || [])], '2026-08-06')]
});

caso('T3a. Merma real distinta de la esperada: la fila y los totales la reflejan; el aprovechamiento no cambia', () => {
  const r = escenarioMerma(150).calcularRendimientoMaterial('MIXTO', PERIODO);
  const basura = fila(r, 'BASURA');
  afirmarCerca(basura.realKg, 150, 'realKg de BASURA');
  afirmarCerca(basura.diferencia, -5, 'diferencia: 15% real vs 20% esperado');
  afirmarCerca(r.mermaRealPct, 15, 'mermaRealPct');
  afirmarCerca(r.aprovechamientoReal, 85, 'aprovechamientoReal = 85% (sin la merma)');
  afirmarCerca(r.aprovechamientoEsperado, 80, 'aprovechamientoEsperado sin cambio');
});

caso('T3b. Merma que no está en la composición: cuenta en el total pero no crea fila', () => {
  const r = escenarioMerma(100, [{ material: 'LODOS', kg: 50, esMerma: true }]).calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmarCerca(r.mermaRealKg, 150, 'mermaRealKg incluye BASURA (100) y LODOS (50)');
  afirmar(!fila(r, 'LODOS'), 'LODOS no genera fila de subproducto');
  afirmarCerca(fila(r, 'BASURA').realKg, 100, 'la fila BASURA solo suma su propia merma');
});

caso('T3c. Sin merma capturada: mermaReal 0 y sin fallos', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }], [{ material: 'PET CRISTAL', kg: 1000, esMerma: false }], '2026-08-06')]
  });
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmarCerca(r.mermaRealKg, 0, 'mermaRealKg');
  afirmarCerca(fila(r, 'BASURA').realKg, 0, 'la fila BASURA queda en 0');
});

caso('T3d. La marca MERMA del TXT se activa con más merma que la esperada y no con menos', () => {
  const PER = { etiquetaPeriodo: 'Prueba' };
  const mas = escenarioMerma(250);
  const txtMas = mas.generarTXTRendimientoMaterial(mas.calcularRendimientoMaterial('MIXTO', PERIODO), PER);
  afirmar(/BASURA[^\n]*← MERMA/.test(txtMas), 'merma real 25% > esperada 20%: la línea de BASURA lleva ← MERMA');
  afirmar(/MERMA REAL: 250 KG/.test(txtMas.replace(/\./g, '').replace(/,/g, '')) || /MERMA REAL: 250/.test(txtMas), 'el TXT trae la línea MERMA REAL con 250 KG');
  const menos = escenarioMerma(150);
  const txtMenos = menos.generarTXTRendimientoMaterial(menos.calcularRendimientoMaterial('MIXTO', PERIODO), PER);
  afirmar(!/← MERMA/.test(txtMenos), 'merma real 15% < esperada 20%: sin marca');
});

caso('T3e. CSV: fila TOTAL MERMA REAL y mismas columnas en todas las filas', () => {
  const w = escenarioMerma(210);
  const filas = w.construirFilasCSVRendimientoMaterial(w.calcularRendimientoMaterial('MIXTO', PERIODO));
  const total = filas[filas.length - 1];
  afirmar(total.subproducto === 'TOTAL MERMA REAL', 'última fila = TOTAL MERMA REAL');
  afirmarCerca(total.realKg, 210, 'realKg del total');
  afirmarCerca(total.realPct, 21, 'realPct del total');
  afirmarCerca(total.esperadoPct, 20, 'esperadoPct del total (suma de las mermas de la composición)');
  afirmarCerca(total.diferenciaPct, 1, 'diferenciaPct del total');
  afirmar(new Set(filas.map((f) => Object.keys(f).join())).size === 1, 'todas las filas tienen las mismas columnas');
});

caso('T3f. PDF: la tabla marca la merma excedida y el cierre trae MERMA REAL', () => {
  const w = escenarioMerma(250);
  const textos = [];
  let tabla = null;
  const noop = () => {};
  w.jspdf = { jsPDF: function () {
    this.internal = { pageSize: { getWidth: () => 210 } };
    this.setFontSize = noop; this.setFont = noop; this.setDrawColor = noop; this.line = noop; this.addPage = noop;
    this.text = (t) => { textos.push(t); };
    this.autoTable = (opciones) => { tabla = opciones; this.lastAutoTable = { finalY: 100 }; };
  } };
  w.generarPDFRendimientoMaterial(w.calcularRendimientoMaterial('MIXTO', PERIODO), { etiquetaPeriodo: 'Prueba' });
  afirmar(tabla.body.some((fila) => /BASURA.*← MERMA/.test(fila[0])), 'la fila BASURA del PDF lleva ← MERMA');
  afirmar(textos.some((t) => /^MERMA REAL: /.test(t)), 'el PDF trae la línea MERMA REAL');
});

// ── Caso 3 / T2: outputs de materialesPZ() ───────────────────────────────
// T2 corrigió el defecto H2: las piezas ya no se suman como kg en el real ni en el aprovechamiento; salen aparte
// en 'piezas'.

caso('3 (T2). Outputs PZ: no se suman como kg; salen aparte en piezas (antes defecto H2)', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 700, esMerma: false }, { material: 'TAMBO', kg: 50, esMerma: false }], '2026-08-06')]
  });
  afirmar(w.materialesPZ().includes('TAMBO'), 'TAMBO debe ser un material PZ');
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(!fila(r, 'TAMBO'), 'las piezas ya no aparecen como una fila en kg');
  afirmarCerca(r.aprovechamientoReal, 70, 'aprovechamientoReal solo con los kg (70%), sin las 50 piezas');
  afirmar(JSON.stringify(r.piezas) === JSON.stringify([{ material: 'TAMBO', cantidad: 50 }]), 'las piezas salen en r.piezas: ' + JSON.stringify(r.piezas));
});

caso('T2a. Un output CAJA CO30 (PZ) no suma a las filas ni al aprovechamiento y aparece en piezas', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 790, esMerma: false }, { material: 'CAJA CO30', kg: 120, esMerma: false }, { material: 'BASURA', kg: 90, esMerma: true }], '2026-08-06'),
    proceso('P-002', 'SELECCION', [{ material: 'MIXTO', kg: 10, ticketOrigen: '1' }],
      [{ material: 'CAJA CO30', kg: 30, esMerma: false }], '2026-08-07')]
  });
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(!fila(r, 'CAJA CO30'), 'CAJA CO30 no genera fila');
  afirmarCerca(fila(r, 'PET CRISTAL').realKg, 790, 'los kg de PET CRISTAL no cambian');
  afirmarCerca(r.aprovechamientoReal, 79, 'aprovechamientoReal solo con kg');
  afirmarCerca(r.mermaRealKg, 90, 'la merma real no se ve afectada');
  afirmar(JSON.stringify(r.piezas) === JSON.stringify([{ material: 'CAJA CO30', cantidad: 150 }]), 'piezas suma ambos procesos: ' + JSON.stringify(r.piezas));
  const sin = escenarioMerma(100).calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(Array.isArray(sin.piezas) && sin.piezas.length === 0, 'sin piezas, r.piezas es un arreglo vacío');
});

caso('T2b. TXT, PDF y CSV muestran PIEZAS PRODUCIDAS solo si hay piezas', () => {
  const PER = { etiquetaPeriodo: 'Prueba' };
  const conPiezas = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 800, esMerma: false }, { material: 'CAJA CO30', kg: 40, esMerma: false }, { material: 'BASURA', kg: 160, esMerma: true }], '2026-08-06')]
  });
  const r = conPiezas.calcularRendimientoMaterial('MIXTO', PERIODO);
  const txt = conPiezas.generarTXTRendimientoMaterial(r, PER);
  afirmar(/PIEZAS PRODUCIDAS:\n  CAJA CO30  40 PZ/.test(txt), 'el TXT trae la sección PIEZAS PRODUCIDAS: ' + txt.split('\n').slice(-3).join(' | '));
  const filas = conPiezas.construirFilasCSVRendimientoMaterial(r);
  const filaPieza = filas.find((f) => /^PIEZAS PRODUCIDAS: CAJA CO30$/.test(f.subproducto));
  afirmar(filaPieza && filaPieza.piezas === 40, 'el CSV trae la fila de la pieza con piezas = 40');
  afirmar(new Set(filas.map((f) => Object.keys(f).join())).size === 1, 'todas las filas del CSV conservan las mismas columnas');
  const textos = [];
  let tablas = [];
  const noop = () => {};
  conPiezas.jspdf = { jsPDF: function () {
    this.internal = { pageSize: { getWidth: () => 210 } };
    this.setFontSize = noop; this.setFont = noop; this.setDrawColor = noop; this.line = noop; this.addPage = noop;
    this.text = (t) => { textos.push(t); };
    this.autoTable = (opciones) => { tablas.push(opciones); this.lastAutoTable = { finalY: 100 }; };
  } };
  conPiezas.generarPDFRendimientoMaterial(r, PER);
  afirmar(textos.includes('PIEZAS PRODUCIDAS:') && tablas.some((t) => t.body.some((fila) => fila[0] === 'CAJA CO30')), 'el PDF trae la sección y la tabla de piezas');
  // Sin piezas: ni sección ni columna.
  const sin = escenarioMerma(100);
  const rSin = sin.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(!/PIEZAS PRODUCIDAS/.test(sin.generarTXTRendimientoMaterial(rSin, PER)), 'sin piezas el TXT no trae la sección');
  afirmar(!sin.construirFilasCSVRendimientoMaterial(rSin).some((f) => 'piezas' in f), 'sin piezas el CSV no trae la columna piezas');
  textos.length = 0; tablas = [];
  sin.jspdf = conPiezas.jspdf;
  sin.generarPDFRendimientoMaterial(rSin, PER);
  afirmar(!textos.includes('PIEZAS PRODUCIDAS:') && tablas.length === 1, 'sin piezas el PDF no trae la sección (solo la tabla de subproductos)');
});

// ── Caso 4: registro con dos inputs de materiales distintos ──────────────
// Comportamiento actual (H4): TODO el output del registro se atribuye a CADA material de
// entrada (no hay prorrateo), así que se cuenta doble entre materiales.

caso('4. Dos inputs distintos: el output completo se atribuye a cada material (sin prorrateo)', () => {
  const composicionPet = composicion('PET', '2026-08-01', [
    { subproducto: 'PET CRISTAL', porcentaje: 100, esMerma: false, procesosValidos: [], procesoSugerido: null }
  ]);
  const w = escenario({
    composiciones: [MIXTO_80_20, composicionPet],
    entradas: [entrada(1, 'MIXTO', 500, '2026-08-05'), entrada(2, 'PET', 500, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION',
      [{ material: 'MIXTO', kg: 500, ticketOrigen: '1' }, { material: 'PET', kg: 500, ticketOrigen: '2' }],
      [{ material: 'PET CRISTAL', kg: 900, esMerma: false }], '2026-08-06')]
  });
  const rMixto = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  const rPet = w.calcularRendimientoMaterial('PET', PERIODO);
  afirmarCerca(fila(rMixto, 'PET CRISTAL').realKg, 900, 'MIXTO recibe los 900 kg completos');
  afirmarCerca(fila(rPet, 'PET CRISTAL').realKg, 900, 'PET recibe los mismos 900 kg completos');
});

// ── Caso 5: filtro tipoProceso ───────────────────────────────────────────

caso('5 (T17). El tercer parámetro tipoProceso queda sin efecto: Por Material compara siempre solo contra SELECCION (antes sumaba todos)', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [
      proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
        [{ material: 'PET CRISTAL', kg: 790, esMerma: false }], '2026-08-06'),
      proceso('P-002', 'EMPACADO', [{ material: 'MIXTO', kg: 100, ticketOrigen: 'P-001' }],
        [{ material: 'PET CRISTAL', kg: 100, esMerma: false }], '2026-08-07')
    ]
  });
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO), 'PET CRISTAL').realKg, 790, 'sin parámetro: solo la SELECCION (el Empacado ya no suma)');
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO, 'SELECCION'), 'PET CRISTAL').realKg, 790, 'SELECCION');
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO, 'EMPACADO'), 'PET CRISTAL').realKg, 790, 'EMPACADO se ignora');
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO, 'MOLIENDA'), 'PET CRISTAL').realKg, 790, 'MOLIENDA se ignora');
});

caso('5b. Periodo: entradas y procesos fuera del rango no cuentan', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05'), entrada(2, 'MIXTO', 777, '2026-09-20')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 790, esMerma: false }], '2026-09-21')]
  });
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmarCerca(r.entradaTotalKg, 1000, 'solo la entrada dentro del periodo');
  afirmarCerca(fila(r, 'PET CRISTAL').realKg, 0, 'el proceso de septiembre queda fuera');
});

// ── T17: Por Material compara solo contra procesos de SELECCION ───────────

const PET_CRISTAL_95_5 = composicion('PET CRISTAL', '2026-08-01', [
  { subproducto: 'PET CRISTAL', porcentaje: 95, esMerma: false, procesosValidos: [], procesoSugerido: null },
  { subproducto: 'BASURA', porcentaje: 5, esMerma: true, procesosValidos: [], procesoSugerido: null }
]);

caso('T17a. PET CRISTAL: Selección 1000 → 950 + BASURA 50 y un Empacado 950 → 950: el real es 950, NO 1900', () => {
  const w = escenario({
    composiciones: [PET_CRISTAL_95_5],
    entradas: [entrada(1, 'PET CRISTAL', 1000, '2026-08-05')],
    procesos: [
      proceso('P-001', 'SELECCION', [{ material: 'PET CRISTAL', kg: 1000, ticketOrigen: '1' }],
        [{ material: 'PET CRISTAL', kg: 950, esMerma: false }, { material: 'BASURA', kg: 50, esMerma: true }], '2026-08-06'),
      proceso('P-002', 'EMPACADO', [{ material: 'PET CRISTAL', kg: 950, ticketOrigen: 'P-001' }],
        [{ material: 'PET CRISTAL', kg: 950, esMerma: false }], '2026-08-07')
    ]
  });
  const r = w.calcularRendimientoMaterial('PET CRISTAL', PERIODO);
  afirmarCerca(fila(r, 'PET CRISTAL').realKg, 950, 'real de PET CRISTAL');
  afirmarCerca(fila(r, 'PET CRISTAL').realPct, 95, 'realPct');
  afirmarCerca(r.aprovechamientoReal, 95, 'aprovechamientoReal');
  afirmarCerca(r.mermaRealKg, 50, 'mermaRealKg');
  afirmarCerca(r.diferenciaAprovechamiento, 0, 'el real coincide con el esperado');
  // El Dashboard (Subproductos: Real vs Teórico) usa el mismo filtro porque llama a calcularRendimientoMaterial.
  const wd = crearContexto([...ARCHIVOS, 'js/dashboard.js']);
  wd.EVE.registrosDestaraje = [entrada(1, 'PET CRISTAL', 1000, '2026-08-05')];
  wd.EVE.composiciones = [PET_CRISTAL_95_5];
  wd.EVE.registrosControlProduccion = w.EVE.registrosControlProduccion;
  const bloque = wd.EVE_DASHBOARD.calcularVistaSubproductosRealVsTeorico().find((b) => b.material === 'PET CRISTAL');
  afirmar(bloque, 'el Dashboard trae el bloque de PET CRISTAL');
  afirmarCerca(bloque.real.filas.find((f) => f.clave === 'PET CRISTAL')._total, 950, 'Dashboard: Real de PET CRISTAL = 950 (no 1900)');
  afirmarCerca(bloque.teorico.filas.find((f) => f.clave === 'PET CRISTAL')._total, 950, 'Dashboard: Teórico = 950');
});

caso('T17b. Una Molienda con input LECHERO no suma al real de la composición de LECHERO', () => {
  const lechero = composicion('LECHERO', '2026-08-01', [
    { subproducto: 'LECHERO', porcentaje: 90, esMerma: false, procesosValidos: [], procesoSugerido: null },
    { subproducto: 'BASURA', porcentaje: 10, esMerma: true, procesosValidos: [], procesoSugerido: null }
  ]);
  const w = escenario({
    composiciones: [lechero],
    entradas: [entrada(1, 'LECHERO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'MOLIENDA', [{ material: 'LECHERO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'LECHERO MOLIDO', kg: 950, esMerma: false }, { material: 'LODOS', kg: 50, esMerma: true }], '2026-08-06')]
  });
  const r = w.calcularRendimientoMaterial('LECHERO', PERIODO);
  afirmarCerca(fila(r, 'LECHERO').realKg, 0, 'el real de LECHERO no incluye la Molienda');
  afirmar(!fila(r, 'LECHERO MOLIDO'), 'LECHERO MOLIDO no aparece como subproducto');
  afirmarCerca(r.mermaRealKg, 0, 'los LODOS de la Molienda no son merma de la selección');
  afirmarCerca(r.aprovechamientoReal, 0, 'aprovechamientoReal 0: no hubo selección');
});

caso('T17c. Un molido comprado (P.E. MOLIDO) que entra a Lavado o Peletizado no aparece en Por Material ni como "sin composición"', () => {
  const w = escenario({
    entradas: [entrada(1, 'P.E. MOLIDO', 500, '2026-08-05')],
    procesos: [
      proceso('P-001', 'LAVADO', [{ material: 'P.E. MOLIDO', kg: 300, ticketOrigen: '1' }],
        [{ material: 'P.E. MOLIDO', kg: 290, esMerma: false }, { material: 'LODOS', kg: 10, esMerma: true }], '2026-08-06'),
      proceso('P-002', 'PELETIZADO', [{ material: 'P.E. MOLIDO', kg: 200, ticketOrigen: '1' }],
        [{ material: 'PELLET CAJAS', kg: 195, esMerma: false }, { material: 'PIEDRAS', kg: 5, esMerma: true }], '2026-08-06')
    ]
  });
  const r = w.calcularRendimientoMaterial('P.E. MOLIDO', PERIODO);
  afirmar(r.filas.length === 0, 'no hay ninguna fila (ni real ni esperado): ' + r.filas.map((f) => f.subproducto).join(', '));
  afirmarCerca(r.mermaRealKg, 0, 'sin merma real');
  afirmar(!w.materialesQueRequierenSeleccion().includes('P.E. MOLIDO'), 'un molido no requiere selección (no se ofrece en Por Material)');
  const pendientes = w.EVE_RENDIMIENTOS.calcularComposicionesPendientes(w.EVE.registrosDestaraje, w.EVE.composiciones);
  afirmar(!pendientes.filas.some((f) => f.material === 'P.E. MOLIDO'), 'tampoco figura como composición pendiente');
});

caso('T17d. Una Molienda con input de rechazo (RECHAZO CAJAS P.E.) y salida P.E. MOLIDO no suma al real de ningún material de Por Material', () => {
  const peComposicion = composicion('P.E.', '2026-08-01', [
    { subproducto: 'P.E.', porcentaje: 100, esMerma: false, procesosValidos: [], procesoSugerido: null }
  ]);
  const w = escenario({
    composiciones: [MIXTO_80_20, peComposicion, PET_CRISTAL_95_5],
    entradas: [entrada(1, 'P.E.', 500, '2026-08-05'), entrada(2, 'MIXTO', 500, '2026-08-05')],
    procesos: [proceso('P-001', 'MOLIENDA', [{ material: 'RECHAZO CAJAS P.E.', kg: 50, ticketOrigen: 'P-000' }],
      [{ material: 'P.E. MOLIDO', kg: 49, esMerma: false }, { material: 'LODOS', kg: 1, esMerma: true }], '2026-08-06')]
  });
  w.materialesQueRequierenSeleccion().forEach((material) => {
    const r = w.calcularRendimientoMaterial(material, PERIODO);
    afirmar(r.filas.every((f) => f.realKg === 0) && r.mermaRealKg === 0 && r.piezas.length === 0, `${material}: el rechazo molido no aporta nada al real`);
  });
  afirmar(!w.calcularRendimientoMaterial('P.E.', PERIODO).filas.some((f) => f.subproducto === 'P.E. MOLIDO'), 'P.E. MOLIDO no es subproducto de P.E.');
});

caso('T17e. El PROCESO: SELECCION aparece en el TXT, el PDF y el CSV de Por Material', () => {
  const PER = { etiquetaPeriodo: 'Prueba' };
  const w = escenarioMerma(100);
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(/\nPROCESO: SELECCION\n/.test(w.generarTXTRendimientoMaterial(r, PER)), 'TXT');
  afirmar(w.construirFilasCSVRendimientoMaterial(r).every((f) => f.proceso === 'SELECCION'), 'CSV: columna proceso = SELECCION en todas las filas');
  const textos = [];
  const noop = () => {};
  w.jspdf = { jsPDF: function () {
    this.internal = { pageSize: { getWidth: () => 210 } };
    this.setFontSize = noop; this.setFont = noop; this.setDrawColor = noop; this.line = noop; this.addPage = noop;
    this.text = (t) => { textos.push(t); };
    this.autoTable = () => { this.lastAutoTable = { finalY: 100 }; };
  } };
  w.generarPDFRendimientoMaterial(r, PER);
  afirmar(textos.includes('PROCESO: SELECCION'), 'PDF');
  afirmar(!/Esperado corresponde a todos los procesos/i.test(w.generarTXTRendimientoMaterial(r, PER)), 'no hay leyenda de "todos los procesos" en el TXT');
});

// ── T4: esMerma por versión de composición ───────────────────────────────

caso('T4a. Un subproducto que es merma en la versión 1 y aprovechable en la versión 2: el esperado se separa por entrada', () => {
  // v1 (julio): SUERO es merma (10%). v2 (desde agosto): SUERO es aprovechable (20%).
  const v1 = composicion('MIXTO', '2026-07-01', [
    { subproducto: 'PET CRISTAL', porcentaje: 90, esMerma: false, procesosValidos: [], procesoSugerido: null },
    { subproducto: 'SUERO', porcentaje: 10, esMerma: true, procesosValidos: [], procesoSugerido: null }
  ], { id: 'v1', version: 1, fechaCierre: '2026-07-31' });
  const v2 = composicion('MIXTO', '2026-08-01', [
    { subproducto: 'PET CRISTAL', porcentaje: 80, esMerma: false, procesosValidos: [], procesoSugerido: null },
    { subproducto: 'SUERO', porcentaje: 20, esMerma: false, procesosValidos: [], procesoSugerido: null }
  ], { id: 'v2', version: 2 });
  const w = escenario({
    composiciones: [v1, v2],
    entradas: [entrada(1, 'MIXTO', 100, '2026-07-15'), entrada(2, 'MIXTO', 200, '2026-08-15')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 300, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 250, esMerma: false }, { material: 'SUERO', kg: 35, esMerma: false }, { material: 'SUERO', kg: 15, esMerma: true }], '2026-08-16')]
  });
  const ent = w.EVE.registrosDestaraje;
  const esperado = (() => {
    // Se prueba la función interna a través de sus efectos en el resultado.
    return w.calcularRendimientoMaterial('MIXTO', PERIODO);
  })();
  // Esperado por entrada: julio 100 kg → PET CRISTAL 90, SUERO merma 10; agosto 200 kg → PET CRISTAL 160, SUERO aprovechable 40.
  afirmarCerca(fila(esperado, 'PET CRISTAL').esperadoPct * 3, 250, 'PET CRISTAL esperado: 250 kg de 300 (83.33%)');
  afirmarCerca(esperado.aprovechamientoEsperado, (250 + 40) / 300 * 100, 'aprovechamientoEsperado = aprovechable (PET CRISTAL 250 + SUERO 40) / 300');
  afirmarCerca(esperado.mermaEsperadaKg, 10, 'merma esperada = solo los 10 kg de SUERO de la v1');
  afirmarCerca(esperado.mermaEsperadaPct, 10 / 300 * 100, 'mermaEsperadaPct');
  const suero = fila(esperado, 'SUERO');
  afirmar(suero.esMerma === false, 'SUERO no es merma: es aprovechable en la composición más reciente (antes: el último componente visto)');
  afirmarCerca(suero.esperadoPct, 40 / 300 * 100, 'la fila de SUERO compara solo su parte aprovechable (40 kg)');
  afirmarCerca(suero.realKg, 35, 'real aprovechable de SUERO');
  // El orden de las entradas no cambia el resultado (antes ganaba el último componente visto).
  w.EVE.registrosDestaraje = ent.slice().reverse();
  const invertido = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(fila(invertido, 'SUERO').esMerma === false, 'con las entradas en otro orden SUERO sigue sin ser merma');
  afirmarCerca(invertido.aprovechamientoEsperado, esperado.aprovechamientoEsperado, 'aprovechamientoEsperado igual con otro orden');
  afirmarCerca(invertido.mermaEsperadaKg, 10, 'merma esperada igual con otro orden');
  // La merma real (T3) sigue igual: los 15 kg de SUERO merma entran al total de merma real.
  afirmarCerca(esperado.mermaRealKg, 15, 'mermaRealKg (T3) no se rompe');
});

caso('T4b. Un subproducto que es merma en TODAS las composiciones sigue siendo merma, y las claves acumulado y definiciones se mantienen', () => {
  const w = escenarioMerma(200);
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(fila(r, 'BASURA').esMerma === true, 'BASURA sigue siendo merma');
  afirmarCerca(r.mermaEsperadaPct, 20, 'mermaEsperadaPct = 20%');
  afirmarCerca(r.aprovechamientoEsperado, 80, 'aprovechamientoEsperado = 80%');
  afirmarCerca(r.mermaRealPct, 20, 'mermaRealPct (T3)');
  // La función interna conserva sus claves por compatibilidad (la usan calcularRendimientoMaterial y el Dashboard).
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/reportes.js'), 'utf8');
  afirmar(/return \{ acumulado, definiciones, aprovechable, merma \};/.test(fuente), 'calcularEsperadoPorEntradas devuelve acumulado y definiciones (más aprovechable y merma)');
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
