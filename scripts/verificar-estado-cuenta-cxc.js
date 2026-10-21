// Estado de Cuenta de clientes (CxC) en Reportes y orden cronológico del Estado de Cuenta de CxP
// (js/reportes.js, js/reportes-ui.js).
//
// Carga en un contexto vm los js/ reales (config, utils, cxp, cxc, reportes y reportes-ui) y comprueba que:
//  - un cliente con ventas, cobros parciales y un cobro revertido no muestra el revertido y su saldo cuadra con CxC;
//  - TOTAL / COBRADO / SALDO del reporte son los mismos que agrega la pantalla de CxC (total neto de retención, sin recalcular);
//  - Personalizado con Desde y Hasta vacíos incluye todo el histórico, y con fechas acota;
//  - el detalle y el historial salen en orden cronológico (fecha y luego folio);
//  - un cliente sin movimientos (o sin elegir) da aviso y no un archivo vacío;
//  - el detalle del Estado de Cuenta de CxP sale por fecha y luego por ticket, con las mismas cifras;
//  - CSV y mensaje de Telegram usan las mismas cifras.
// El PDF usa jsPDF y autoTable (no se cargan aquí): comparte con el TXT el orden, los totales y las funciones de formato.
//
// Uso: node scripts/verificar-estado-cuenta-cxc.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/cxc.js', 'js/reportes.js', 'js/reportes-ui.js'];

function crearContexto() {
  const valoresCampos = {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: (id) => ({ value: valoresCampos[id] || '' }) },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorCobrar: [], cuentasPorPagar: [], cobros: [], proveedores: [] };
  sandbox.window.EVE_MODULES = {};
  sandbox.window.actualizarDato = async () => {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  sandbox.window.actualizarDato = async () => {};
  sandbox.window.obtenerFechaMexico = () => '2026-10-21';
  sandbox.window.__campos = valoresCampos;
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

const PERIODO_TODO = { desde: '', hasta: '', etiquetaReporte: 'TODOS', etiquetaPeriodo: 'TODOS LOS REGISTROS' };

// Venta de varias líneas con IVA y retención: el total de cada partida (totalLinea) es neto de retención.
function ventaDe(folio, cliente, fecha, lineas) {
  return { folio, cliente, fecha, lineas: lineas.map(([material, cantidad, precio, retener]) => {
    const subtotal = cantidad * precio;
    const ivaTrasladado = subtotal * 0.16;
    const ivaRetenido = retener ? subtotal * 0.04 : 0;
    return { material, cantidad, unidad: 'KG', precioUnitario: precio, subtotal, ivaTrasladado, ivaRetenido, totalLinea: subtotal + ivaTrasladado - ivaRetenido };
  }) };
}

function agregarVenta(w, id, venta) {
  w.EVE_CXC.construirDocsCxCDesdeVenta(venta, id, 'prueba').forEach((doc, i) => {
    w.EVE.cuentasPorCobrar.push({ id: `${id}-${i}`, ...doc });
  });
}

async function cobrar(w, cuentaId, monto, fecha, referencia) {
  const cxc = w.EVE.cuentasPorCobrar.find((c) => c.id === cuentaId);
  const abono = { monto, fecha, referencia, registradoPor: 'cobranza', abonoId: w.EVE_CXP.generarAbonoId() };
  Object.assign(cxc, w.EVE_CXP.aplicarAbono(cxc, abono));
  return abono;
}

// Cliente de prueba: 3 partidas en 2 ventas, 2 cobros vigentes y 1 cobro revertido.
async function escenarioBase(w) {
  agregarVenta(w, 'v1', ventaDe('12', 'ACME', '2026-09-20', [['PET CRISTAL', 100, 10, true], ['HDPE', 50, 8, false]]));
  agregarVenta(w, 'v2', ventaDe('9', 'ACME', '2026-09-20', [['CARTON', 200, 2, false]]));
  agregarVenta(w, 'v3', ventaDe('5', 'OTRO', '2026-09-01', [['HDPE', 10, 8, false]]));
  await cobrar(w, 'v1-0', 300, '2026-09-25', 'TRANSFERENCIA 111');
  const revertir = await cobrar(w, 'v1-1', 100, '2026-09-26', 'EFECTIVO');
  await cobrar(w, 'v2-0', 200, '2026-09-22', 'CHEQUE 55');
  await w.EVE_CXC.revertirAbonoCxC('v1-1', revertir.abonoId, 'error de captura', 'admin');
}

caso('cliente con cobros parciales y un cobro revertido: el revertido no aparece y el saldo cuadra con CxC', async () => {
  const w = crearContexto();
  await escenarioBase(w);
  const cuentas = w.EVE.cuentasPorCobrar.filter((c) => c.cliente === 'ACME');
  const txt = w.generarTXTEstadoCuentaCxC('ACME', cuentas, PERIODO_TODO);
  afirmar(!txt.includes('EFECTIVO'), 'el cobro revertido aparece en el historial');
  afirmar(txt.includes('TRANSFERENCIA 111') && txt.includes('CHEQUE 55'), 'faltan cobros vigentes en el historial');
  const cobros = w.aplanarCobrosCxC(cuentas);
  igual(cobros.map((c) => c.monto), [200, 300], 'cobros vigentes (por fecha)');
  const grupo = w.EVE_CXC.agregarPorClienteCxC(w.EVE.cuentasPorCobrar).find((g) => g.cliente === 'ACME');
  afirmar(txt.includes(`SALDO: ${w.formatearMoneda(grupo.saldo)}`), 'el saldo del reporte no cuadra con CxC');
  afirmar(txt.includes('CLIENTE: ACME') && txt.includes('PERIODO: TODOS LOS REGISTROS') && txt.includes('FECHA: 21-10-2026'), 'encabezado incompleto');
});

caso('TOTAL, COBRADO y SALDO del reporte son los de la pantalla de CxC (neto de retención)', async () => {
  const w = crearContexto();
  await escenarioBase(w);
  const cuentas = w.EVE.cuentasPorCobrar.filter((c) => c.cliente === 'ACME');
  const grupo = w.EVE_CXC.agregarPorClienteCxC(w.EVE.cuentasPorCobrar).find((g) => g.cliente === 'ACME');
  const txt = w.generarTXTEstadoCuentaCxC('ACME', cuentas, PERIODO_TODO);
  afirmar(txt.includes(`TOTAL: ${w.formatearMoneda(grupo.total)}`), 'TOTAL distinto al de la pantalla');
  afirmar(txt.includes(`COBRADO: ${w.formatearMoneda(grupo.pagado)}`), 'COBRADO distinto al de la pantalla');
  afirmar(txt.includes(`SALDO: ${w.formatearMoneda(grupo.saldo)}`), 'SALDO distinto al de la pantalla');
  // La línea con retención muestra su total neto (1000 + 160 - 40), no el bruto con IVA.
  afirmar(txt.includes(w.formatearMoneda(1120)), 'la línea con retención no muestra el total neto de retención');
  const filas = w.construirFilasCSVEstadoCuentaCxC(cuentas);
  igual(filas.reduce((s, f) => s + f.total, 0), grupo.total, 'CSV: suma de totales');
  igual(filas.reduce((s, f) => s + f.saldo, 0), grupo.saldo, 'CSV: suma de saldos');
  const mensaje = w.construirMensajeCxCTelegram('ACME', cuentas, PERIODO_TODO);
  afirmar(mensaje.includes(`Saldo: ${w.formatearMoneda(grupo.saldo)}`) && mensaje.includes(`Total: ${w.formatearMoneda(grupo.total)}`), 'Telegram: cifras distintas');
});

caso('Personalizado con Desde y Hasta vacíos incluye todo el histórico; con fechas acota', async () => {
  const w = crearContexto();
  await escenarioBase(w);
  agregarVenta(w, 'v4', ventaDe('40', 'ACME', '2026-01-15', [['HDPE', 10, 8, false]]));
  w.__campos['ruf-cxc-cliente'] = 'acme';
  const periodoVacio = w.obtenerRangoYEtiqueta('personalizado', { desde: '', hasta: '' });
  igual(w.EVE_REPORTES_UI.obtenerCuentasCxCFiltradas(periodoVacio).length, 4, 'sin fechas: todo el histórico');
  w.__campos['ruf-desde'] = '2026-09-01';
  w.__campos['ruf-hasta'] = '2026-09-30';
  const periodoSep = w.obtenerRangoYEtiqueta('personalizado', w.EVE_REPORTES_UI.leerFiltrosComunes());
  igual(w.EVE_REPORTES_UI.obtenerCuentasCxCFiltradas(periodoSep).length, 3, 'con fechas: solo septiembre');
  w.__campos['ruf-cxc-estado'] = 'parcial';
  igual(w.EVE_REPORTES_UI.obtenerCuentasCxCFiltradas(periodoVacio).length, 2, 'filtro de estado parcial');
});

caso('el detalle y el historial salen en orden cronológico (fecha y luego folio)', async () => {
  const w = crearContexto();
  await escenarioBase(w);
  agregarVenta(w, 'v4', ventaDe('3', 'ACME', '2026-08-01', [['HDPE', 10, 8, false]]));
  const cuentas = w.EVE.cuentasPorCobrar.filter((c) => c.cliente === 'ACME');
  const txt = w.generarTXTEstadoCuentaCxC('ACME', cuentas, PERIODO_TODO);
  const detalle = txt.split('HISTORIAL DE COBROS:')[0];
  const folios = detalle.split('\n').filter((l) => /^ {2}\d+ {2}\d\d\/\d\d\/\d{4}/.test(l)).map((l) => l.trim().split(/\s+/).slice(0, 2).join('|'));
  igual(folios, ['3|01/08/2026', '9|20/09/2026', '12|20/09/2026', '12|20/09/2026'], 'orden del detalle (folio 9 antes que 12, no por texto)');
  const historial = txt.split('HISTORIAL DE COBROS:')[1].split('\n').filter((l) => l.startsWith('  2'.slice(0, 2)) && /\d\d\/\d\d\/\d{4}/.test(l));
  igual(historial.map((l) => l.trim().split(/\s+/)[0]), ['22/09/2026', '25/09/2026'], 'orden del historial de cobros');
  igual(w.construirFilasCSVEstadoCuentaCxC(cuentas).map((f) => f.fechaVenta), ['2026-08-01', '2026-09-20', '2026-09-20', '2026-09-20'], 'orden del CSV');
});

caso('cliente sin movimientos o sin elegir: da aviso en vez de un archivo vacío', async () => {
  const w = crearContexto();
  await escenarioBase(w);
  const periodo = w.obtenerRangoYEtiqueta('personalizado', { desde: '', hasta: '' });
  igual(w.EVE_REPORTES_UI.avisoEstadoCuentaCxC(periodo).includes('cliente'), true, 'sin cliente elegido');
  w.__campos['ruf-cxc-cliente'] = 'FANTASMA';
  const aviso = w.EVE_REPORTES_UI.avisoEstadoCuentaCxC(periodo);
  afirmar(aviso.includes('no tiene movimientos'), 'cliente sin movimientos sin aviso: ' + aviso);
  w.__campos['ruf-cxc-cliente'] = 'ACME';
  igual(w.EVE_REPORTES_UI.avisoEstadoCuentaCxC(periodo), '', 'cliente con movimientos no debe avisar');
});

caso('Estado de Cuenta de CxP: el detalle sale por fecha y luego por ticket, con las mismas cifras y columnas', async () => {
  const w = crearContexto();
  const cuenta = (ticket, fechaTicket, total) => ({
    ticket, proveedor: 'PROV', material: 'HDPE', kg: 10, precioAplicado: 5, comisionPorKg: 0, precioEfectivo: 5,
    precioNegociado: null, total, pagado: 0, saldo: total, estado: 'pendiente', fechaTicket, abonos: []
  });
  const cuentas = [cuenta('T10', '2026-09-02', 50), cuenta('T2', '2026-09-02', 40), cuenta('T7', '2026-08-30', 30)];
  const copiaOriginal = JSON.stringify(cuentas);
  const txt = w.generarTXTEstadoCuenta('PROV', cuentas, PERIODO_TODO);
  const tickets = txt.split('\n').filter((l) => /^ {2}T\d+ /.test(l)).map((l) => l.trim().split(/\s+/)[0]);
  igual(tickets, ['T7', 'T2', 'T10'], 'orden del detalle de tickets');
  igual(w.construirFilasCSVEstadoCuenta(cuentas).map((f) => f.ticket), ['T7', 'T2', 'T10'], 'orden del CSV de CxP');
  igual(JSON.stringify(cuentas), copiaOriginal, 'no debe alterar el arreglo recibido');
  afirmar(txt.includes('TOTAL ACUMULADO: ' + w.formatearMoneda(120)), 'cifras de CxP cambiaron');
  afirmar(txt.includes('  TICKET  MATERIAL  KG  PRECIO EFECTIVO  TOTAL  PAGADO  SALDO  ESTADO  FECHA'), 'columnas de CxP cambiaron');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`  ok   ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`  FALLA ${nombre}\n       ${error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos} de ${casos.length} casos pasaron.`);
  process.exit(fallos ? 1 : 0);
})();
