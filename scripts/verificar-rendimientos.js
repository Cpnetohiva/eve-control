// T1 — Arnés de verificación del comparativo de Rendimientos (línea base).
//
// Carga en un contexto vm, con un `window` simulado, js/config.js (catálogo y alias reales),
// js/utils.js, js/rendimientos.js y js/reportes.js, y ejecuta casos sintéticos sobre
// window.calcularRendimientoMaterial. Sin dependencias nuevas.
//
// Los casos 1-4 DOCUMENTAN EL COMPORTAMIENTO ACTUAL (línea base), incluidos los defectos
// conocidos (H1, H2, H3, H4); no afirman que ese comportamiento sea el deseado. Cuando una
// tarea posterior corrija uno de esos puntos, el caso correspondiente debe actualizarse a propósito.
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

// ── Caso 3: outputs de MATERIALES_PZ ─────────────────────────────────────
// Comportamiento actual (H2): las piezas se suman como kg en el real y en el aprovechamiento.

caso('3. Outputs PZ: se suman como si fueran kg (defecto H2, línea base)', () => {
  const w = escenario({
    composiciones: [MIXTO_80_20],
    entradas: [entrada(1, 'MIXTO', 1000, '2026-08-05')],
    procesos: [proceso('P-001', 'SELECCION', [{ material: 'MIXTO', kg: 1000, ticketOrigen: '1' }],
      [{ material: 'PET CRISTAL', kg: 700, esMerma: false }, { material: 'TAMBO', kg: 50, esMerma: false }], '2026-08-06')]
  });
  afirmar(w.MATERIALES_PZ.includes('TAMBO'), 'TAMBO debe ser un material PZ');
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO);
  afirmar(fila(r, 'TAMBO'), 'hoy las piezas aparecen como una fila más');
  afirmarCerca(fila(r, 'TAMBO').realKg, 50, 'realKg de TAMBO (piezas contadas como kg)');
  afirmarCerca(r.aprovechamientoReal, 75, 'aprovechamientoReal incluye las piezas (70% + 5%)');
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

caso('5. Filtro tipoProceso: sin filtro cuenta todos los procesos; con filtro solo ese', () => {
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
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO), 'PET CRISTAL').realKg, 890, 'sin filtro suma ambos procesos');
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO, 'SELECCION'), 'PET CRISTAL').realKg, 790, 'SELECCION');
  afirmarCerca(fila(w.calcularRendimientoMaterial('MIXTO', PERIODO, 'EMPACADO'), 'PET CRISTAL').realKg, 100, 'EMPACADO');
  const r = w.calcularRendimientoMaterial('MIXTO', PERIODO, 'MOLIENDA');
  afirmarCerca(fila(r, 'PET CRISTAL').realKg, 0, 'un proceso sin registros no aporta real');
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
