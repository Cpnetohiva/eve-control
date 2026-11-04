// Verificación del interruptor "Incluir material de socios" de CxP (solo vista) y de esProveedorSocio.
// Uso: node scripts/verificar-cxp-socios.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

function crearContexto() {
  const almacen = {};
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; } },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); }
    },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  return sandbox.window;
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${mensaje}: esperado ${b}, real ${a}`);
}

function cuenta(ticket, proveedor, total, pagado, fechaTicket) {
  const saldo = Math.round((total - pagado) * 100) / 100;
  return {
    id: `cxp-${ticket}`, ticket, proveedor, material: 'PET', kg: 100, total, pagado, saldo, fechaTicket,
    estado: saldo <= 0 ? 'liquidado' : (pagado > 0 ? 'parcial' : 'pendiente'), abonos: []
  };
}

const CUENTAS = [
  cuenta('1', 'ALFA', 1000, 0, '2026-09-28'),
  cuenta('2', 'German', 500, 0, '2026-09-29'),
  cuenta('3', ' mario  m ', 300, 0, '2026-09-29'),
  cuenta('4', 'BETA', 200, 0, '2026-09-30')
];

caso('esProveedorSocio normaliza mayúsculas, espacios y acentos', () => {
  const w = crearContexto();
  igual(w.PROVEEDORES_SOCIOS, ['GERMAN', 'MARIO M'], 'constante');
  afirmar(w.esProveedorSocio('German'), 'German');
  afirmar(w.esProveedorSocio('  GERMÁN '), 'GERMÁN con acento y espacios');
  afirmar(w.esProveedorSocio('mario   m'), 'mario m');
  afirmar(!w.esProveedorSocio('MARIO'), 'MARIO solo no es socio');
  afirmar(!w.esProveedorSocio(''), 'vacío');
  afirmar(!w.esProveedorSocio(null), 'null');
});

caso('por defecto el interruptor está activo y todo suma', () => {
  const w = crearContexto();
  w.EVE.cuentasPorPagar = CUENTAS;
  afirmar(w.EVE_CXP.incluirSociosCxP(), 'activo por defecto');
  igual(w.EVE_CXP.cuentasVisiblesCxP().length, 4, 'cuentas visibles');
});

caso('apagado excluye socios de la vista y conserva los datos', () => {
  const w = crearContexto();
  w.EVE.cuentasPorPagar = CUENTAS;
  w.localStorage.setItem('cxp_incluir_socios', '0');
  afirmar(!w.EVE_CXP.incluirSociosCxP(), 'apagado');
  igual(w.EVE_CXP.cuentasVisiblesCxP().map((c) => c.ticket), ['1', '4'], 'visibles sin socios');
  igual(w.EVE.cuentasPorPagar.length, 4, 'los datos en memoria no se tocan');
});

caso('el Total adeudado general y la cuenta de proveedores siguen el filtro', () => {
  const w = crearContexto();
  w.EVE.cuentasPorPagar = CUENTAS;
  const total = () => w.EVE_CXP.cuentasVisiblesCxP().reduce((s, c) => s + c.saldo, 0);
  igual(total(), 2000, 'con socios');
  w.localStorage.setItem('cxp_incluir_socios', '0');
  igual(total(), 1200, 'sin socios');
  const grupos = w.EVE_CXP.agregarPorProveedorCxP(w.EVE_CXP.cuentasVisiblesCxP()).filter((g) => g.saldo > 0);
  igual(grupos.map((g) => g.proveedor).sort(), ['ALFA', 'BETA'], 'proveedores con saldo');
});

function ctxConDatos() {
  const w = crearContexto();
  w.__guardados = [];
  w.__actualizados = [];
  w.guardarDato = async (col, doc) => { w.__guardados.push({ col, doc }); return 'id-' + w.__guardados.length; };
  w.actualizarDato = async (col, id, cambios) => { w.__actualizados.push({ col, id, cambios }); };
  w.obtenerFechaMexico = () => '2026-11-04';
  return w;
}
const SALDO_INICIAL = (proveedor, monto, fecha) => ({
  id: 'si-' + proveedor, tipo: 'saldo_inicial', ticket: '', proveedor, material: 'VARIOS', kg: 0, total: monto, pagado: 0, saldo: monto,
  fechaTicket: fecha, estado: 'pendiente', abonos: [], aprobacion: { tipo: 'saldo_inicial' }
});

caso('construirDocSaldoInicial: sin ticket ni kg, total = saldo = monto', () => {
  const w = ctxConDatos();
  const d = w.EVE_CXP.construirDocSaldoInicial({ proveedor: 'alfa', monto: '1500.5', fecha: '2026-11-01', nota: ' deuda previa ', usuario: 'u' });
  igual([d.tipo, d.ticket, d.kg, d.total, d.saldo, d.pagado, d.estado], ['saldo_inicial', '', 0, 1500.5, 1500.5, 0, 'pendiente'], 'campos');
  igual(d.proveedor, 'ALFA', 'proveedor normalizado');
  igual(d.nota, 'deuda previa', 'nota');
  afirmar(w.EVE_CXP.esCxPSaldoInicial(d), 'se reconoce como saldo inicial (bloquea Editar kg)');
  let error = null;
  try { w.EVE_CXP.construirDocSaldoInicial({ proveedor: 'x', monto: 0, fecha: '2026-11-01' }); } catch (e) { error = e; }
  afirmar(error, 'monto 0 se rechaza');
});

caso('registrarSaldoInicialCxP guarda en cuentas_por_pagar y en memoria', async () => {
  const w = ctxConDatos();
  w.EVE.currentUser = { username: 'tester' };
  await w.EVE_CXP.registrarSaldoInicialCxP({ proveedor: 'ALFA', monto: 800, fecha: '2026-11-01', nota: '' });
  igual(w.__guardados.length, 1, 'una escritura');
  igual(w.__guardados[0].col, 'cuentas_por_pagar', 'colección');
  igual(w.EVE.cuentasPorPagar.length, 1, 'en memoria');
});

caso('abono a saldo inicial descuenta el saldo inicial, el más antiguo primero', async () => {
  const w = ctxConDatos();
  w.EVE.cuentasPorPagar = [SALDO_INICIAL('ALFA', 100, '2026-10-02'), { ...SALDO_INICIAL('ALFA', 300, '2026-10-01'), id: 'viejo' }, cuenta('9', 'ALFA', 500, 0, '2026-10-03')];
  const aplicado = await w.EVE_CXP.aplicarAbonoASaldosIniciales('ALFA', 350, '2026-11-04');
  igual(aplicado, 350, 'aplicado');
  igual(w.EVE.cuentasPorPagar.find((c) => c.id === 'viejo').saldo, 0, 'el más antiguo se liquida');
  igual(w.EVE.cuentasPorPagar.find((c) => c.id === 'si-ALFA').saldo, 50, 'el siguiente queda en 50');
  igual(w.EVE.cuentasPorPagar.find((c) => c.ticket === '9').saldo, 500, 'la compra normal no se toca');
});

caso('saldo inicial: no suma en Total del periodo, sí en Total Adeudado General y Saldo por proveedor', () => {
  const w = ctxConDatos();
  w.EVE.cuentasPorPagar = [cuenta('1', 'ALFA', 1000, 0, '2026-10-30'), SALDO_INICIAL('ALFA', 700, '2026-10-30'), SALDO_INICIAL('BETA', 200, '2026-10-30')];
  const general = w.EVE_CXP.calcularTotalAdeudadoGeneral();
  igual([general.total, general.saldoInicial, general.cantidadProveedores], [1900, 900, 2], 'general');
  const config = w.EVE_CXP.construirConfigCapturaCxP(w.EVE.cuentasPorPagar, general.total, 'Todos', general.saldoInicial);
  const kpi = (l) => (config.kpis.find((k) => k.label === l) || {}).valor;
  afirmar(/1,000\.00/.test(kpi('Total del periodo')), 'Total del periodo solo compras: ' + kpi('Total del periodo'));
  afirmar(/1,900\.00/.test(kpi('Total Adeudado General')), 'general: ' + kpi('Total Adeudado General'));
  afirmar(/900\.00/.test(kpi('de los cuales saldo inicial')), 'línea de saldo inicial');
  const filas = config.resumenSecciones[0].filas;
  igual(filas.map((f) => f.monto), [1700, 200], 'Saldo por proveedor incluye saldo inicial');
  afirmar(/de los cuales saldo inicial: .*700\.00/.test(filas[0].label), 'etiqueta ALFA: ' + filas[0].label);
});

caso('el interruptor de socios sigue funcionando con saldos iniciales', () => {
  const w = ctxConDatos();
  w.EVE.cuentasPorPagar = [cuenta('1', 'ALFA', 1000, 0, '2026-10-30'), SALDO_INICIAL('GERMAN', 500, '2026-10-30'), SALDO_INICIAL('ALFA', 100, '2026-10-30')];
  w.localStorage.setItem('cxp_incluir_socios', '0');
  const g = w.EVE_CXP.calcularTotalAdeudadoGeneral();
  igual([g.total, g.saldoInicial, g.cantidadProveedores], [1100, 100, 1], 'sin el saldo inicial de GERMAN');
});

caso('el pago de una cuenta de saldo inicial no cuenta como compra en Pagos', () => {
  const w = ctxConDatos();
  const pago = { ticket: '', proveedor: 'ALFA', material: 'VARIOS', kg: 0, precioPorKg: null, pagado: 50, total: 700, iva: 3, fecha: '2026-11-04' };
  w.EVE_CXP.marcarPagoDeSaldoInicial(pago, SALDO_INICIAL('ALFA', 700, '2026-10-30'));
  igual([pago.abonoSaldoInicial, pago.total, pago.kg, pago.iva, pago.pagado], [true, 0, 0, 0, 50], 'marcado');
  const normal = { ticket: '1', total: 10, pagado: 5 };
  w.EVE_CXP.marcarPagoDeSaldoInicial(normal, cuenta('1', 'ALFA', 10, 0, '2026-10-30'));
  afirmar(!normal.abonoSaldoInicial && normal.total === 10, 'compra normal intacta');
});

caso('esCuentaSaldoInicial reconoce tipo y aprobacion.tipo', () => {
  const w = ctxConDatos();
  afirmar(w.esCuentaSaldoInicial({ tipo: 'saldo_inicial' }), 'tipo');
  afirmar(w.esCuentaSaldoInicial({ aprobacion: { tipo: 'saldo_inicial' } }), 'importado');
  afirmar(!w.esCuentaSaldoInicial({ tipo: 'compra' }) && !w.esCuentaSaldoInicial(null), 'otros');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`OK   ${nombre}`); } catch (e) { fallos++; console.log(`FALLA ${nombre}\n     ${e.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos`);
  process.exit(fallos ? 1 : 0);
})();
