// Flujo de efectivo desde el 01/09/2026: septiembre entra al flujo, el cobro entra sin IVA y los periodos que incluyen
// septiembre muestran el aviso de gastos incompletos (pantalla, TXT, PDF, CSV y vista para captura). Octubre no cambia.
//
// Uso: node scripts/verificar-flujo-septiembre.js (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');

function crearContexto() {
  const window = { EVE_MODULES: {} };
  window.window = window;
  window.EVE = { cobros: [], registrosPagos: [], gastos: [], flujoMovimientos: [], currentUser: null };
  const ctx = vm.createContext({
    window, console: { log() {}, warn() {}, error() {} }, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout,
    firebase: { initializeApp() {}, firestore: () => ({ enablePersistence: () => ({ catch() {} }) }) },
    document: { getElementById: () => null, createElement: () => ({}) }
  });
  for (const f of ['config.js', 'utils.js', 'permisos.js', 'flujo.js']) vm.runInContext(leer(`js/${f}`), ctx, { filename: f });
  return window;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);

const AVISO = 'Septiembre 2026 puede estar incompleto: los gastos (nomina, renta, deuda) se capturan completos desde el 01/10/2026. El flujo operativo de septiembre puede salir mayor al real.';
const cobro = (extra) => ({ fecha: '2026-09-10', cliente: 'CLIENTE A', folio: 'V-1', pagado: 1000, iva: 0, revertido: false, fechaRegistro: '2026-09-10T10:00:00.000Z', ...extra });
const pago = (extra) => ({ fecha: '2026-09-12', proveedor: 'PROV A', ticket: '1', pagado: 580, iva: 80, origen: 'cxp_pago_general', revertido: false, fechaRegistro: '2026-09-12T10:00:00.000Z', ...extra });
const gasto = (extra) => ({ fecha: '2026-09-15', concepto: 'Luz', beneficiario: 'CFE', montoBase: 300, fechaRegistro: '2026-09-15T10:00:00.000Z', ...extra });
const SEP = { desde: '2026-09-01', hasta: '2026-09-30' };
const OCT = { desde: '2026-10-01', hasta: '2026-10-31' };

const datosOctubre = () => ({
  cobros: [cobro({ fecha: '2026-10-05', pagado: 500, folio: 'V-2' })],
  pagos: [pago({ fecha: '2026-10-06', ticket: '2' })],
  gastos: [gasto({ fecha: '2026-10-07' })]
});
const datosMixtos = () => {
  const oct = datosOctubre();
  return { cobros: [cobro(), ...oct.cobros], pagos: [pago(), ...oct.pagos], gastos: [gasto(), ...oct.gastos] };
};

caso('Con filtro 01/09 a 30/09 el flujo no sale en cero cuando hay cobros y pagos de septiembre', () => {
  const w = crearContexto();
  const todos = w.EVE_FLUJO.construirMovimientosFlujo(datosMixtos());
  const sep = w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'todos', { desde: SEP.desde, hasta: SEP.hasta });
  igual(sep.length, 3, 'movimientos de septiembre');
  const t = w.EVE_FLUJO.calcularTotalesFlujo(sep);
  igual([t.entradas, t.salidas], [1000, 800], 'entradas y salidas de septiembre (pago 580 - iva 80 = 500, gasto 300)');
  afirmar(t.entradas > 0 && t.salidas > 0, 'no sale en cero');
});

caso('Un cobro de septiembre con iva entra neto (pagado menos iva) y conserva la alerta con su texto nuevo', () => {
  const w = crearContexto();
  const [m] = w.EVE_FLUJO.construirMovimientosFlujo({ cobros: [cobro({ pagado: 1160, iva: 160 })] });
  igual([m.fecha, m.entrada, m.alertaIva], ['2026-09-10', 1000, true], 'cobro neto con alerta');
  igual(w.EVE_FLUJO.TEXTO_ALERTA_IVA, 'Cobro con IVA: el flujo lo muestra sin IVA', 'texto de la alerta');
});

caso('El aviso aparece en periodos que incluyen septiembre y no de octubre en adelante', () => {
  const w = crearContexto();
  const aviso = w.EVE_FLUJO.avisoPeriodoIncompleto;
  igual(aviso(SEP), AVISO, 'septiembre');
  igual(aviso({ desde: '2026-09-20', hasta: '2026-10-10' }), AVISO, 'periodo a caballo');
  igual(aviso({ desde: '', hasta: '' }), AVISO, 'Todos sin filtros incluye septiembre');
  igual(aviso({ desde: '', hasta: '2026-10-31' }), AVISO, 'Todos hasta octubre');
  igual(aviso(OCT), '', 'octubre');
  igual(aviso({ desde: '2026-11-09', hasta: '2026-11-09' }), '', 'hoy');
});

caso('Con filtro de octubre las cifras no cambian: mismos totales que con solo datos de octubre', () => {
  const w = crearContexto();
  const todos = w.EVE_FLUJO.construirMovimientosFlujo(datosMixtos());
  const oct = w.EVE_FLUJO.filtrarMovimientosFlujo(todos, 'todos', { desde: OCT.desde, hasta: OCT.hasta });
  const t = w.EVE_FLUJO.calcularTotalesFlujo(oct);
  igual([t.entradas, t.salidas, t.neto], [500, 800, -300], 'totales de octubre');
  igual(t, w.EVE_FLUJO.calcularTotalesFlujo(w.EVE_FLUJO.construirMovimientosFlujo(datosOctubre())), 'iguales a los de octubre calculado solo');
});

caso('El mensaje de fecha mínima se arma con la constante y en dd/mm/aaaa', () => {
  const w = crearContexto();
  let mensaje = '';
  try { w.EVE_FLUJO.construirMovimientoManualDesdeFormulario({ fecha: '2026-08-31', importe: '10', tipo: 'Otra salida' }); } catch (e) { mensaje = e.message; }
  afirmar(mensaje.includes('La fecha debe ser 01/09/2026 o posterior'), `mensaje: ${mensaje}`);
  igual(w.EVE_FLUJO.FLUJO_FECHA_INICIO, '2026-09-01', 'FLUJO_FECHA_INICIO');
  afirmar((leer('js/flujo.js').match(/2026-10-01/g) || []).length === 1, 'solo la constante de gastos completos escribe 2026-10-01');
});

caso('TXT y CSV llevan el aviso cuando el periodo incluye septiembre y no en octubre', () => {
  const w = crearContexto();
  w.formatearFecha = w.formatearFecha || ((f) => f);
  const movs = w.EVE_FLUJO.construirMovimientosFlujo(datosMixtos());
  const t = w.EVE_FLUJO.calcularTotalesFlujo(movs);
  const saldo = w.EVE_FLUJO.saldoFinalFlujo(movs);
  afirmar(w.EVE_FLUJO.generarTXTFlujo(movs, { etiquetaReporte: 'TODOS', etiquetaPeriodo: 'X', ...SEP }, t, saldo).includes(AVISO), 'TXT de septiembre con aviso');
  afirmar(!w.EVE_FLUJO.generarTXTFlujo(movs, { etiquetaReporte: 'MES', etiquetaPeriodo: 'X', ...OCT }, t, saldo).includes('incompleto'), 'TXT de octubre sin aviso');
  const csv = w.EVE_FLUJO.construirFilasCSVFlujo(movs, t, saldo, AVISO);
  igual(csv[0].Concepto, `AVISO: ${AVISO}`, 'primera fila del CSV');
  igual(w.EVE_FLUJO.construirFilasCSVFlujo(movs, t, saldo).length, csv.length - 1, 'sin aviso no hay fila extra');
});

caso('Pantalla, PDF, CSV y vista para captura están cableados al aviso', () => {
  const f = leer('js/flujo.js');
  ["div.id = 'flujo-aviso-septiembre'", 'renderizarAvisoSeptiembre();', 'container.appendChild(crearAvisoSeptiembre())'].forEach((x) => afirmar(f.includes(x), `pantalla: ${x}`));
  afirmar(/function generarPDFFlujo[\s\S]*avisoPeriodoIncompleto\(periodo\)[\s\S]*doc\.autoTable/.test(f), 'PDF usa el aviso antes de la tabla');
  afirmar(f.includes('saldoFinal, avisoPeriodoIncompleto(periodo))'), 'CSV recibe el aviso');
  afirmar(/VistaCaptura\.abrir\(\{[\s\S]*aviso: avisoPeriodoIncompleto/.test(f), 'vista para captura recibe el aviso');
  afirmar(leer('js/vista-captura.js').includes('config.aviso'), 'VistaCaptura dibuja config.aviso');
  afirmar(f.indexOf('crearAvisoSeptiembre());') < f.indexOf('crearStats());'), 'el aviso va arriba de la barra de totales');
});

(async () => {
  let fallas = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (e) { fallas++; console.log(`FAIL ${nombre}\n     ${e.message}`); }
  }
  console.log(`\n${casos.length - fallas}/${casos.length} casos correctos`);
  process.exit(fallas ? 1 : 0);
})();
