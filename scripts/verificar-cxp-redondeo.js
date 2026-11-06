// Verificación del redondeo a centavos (window.redondearCentavos) en CxP y Pagos, y de que el reparto PEPS, los recibos y los
// abonos usan esLiquidadoCxP(saldo) en lugar de saldo > 0: un ticket liquidado (saldo < 0.01) no recibe parte de un pago.
// Uso: node scripts/verificar-cxp-redondeo.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/pagos.js'];

function crearContexto() {
  const almacen = {};
  const elementoFalso = () => new Proxy(function () {}, {
    get: (_, prop) => (prop === 'style' || prop === 'classList' || prop === 'dataset' ? elementoFalso() : elementoFalso()),
    apply: () => elementoFalso(),
    set: () => true
  });
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, createElement: elementoFalso },
    localStorage: {
      getItem: (k) => (k in almacen ? almacen[k] : null),
      setItem: (k, v) => { almacen[k] = String(v); }
    },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { registrosDestaraje: [], cuentasPorPagar: [], auditorias: [], registrosPagos: [] };
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

// Un número está "a centavos" si al multiplicarlo por 100 queda entero sin residuo de punto flotante.
const esCentavos = (n) => Number.isFinite(n) && n === Math.round(n * 100) / 100;

function cuenta(ticket, total, saldo, fechaTicket, extra) {
  return {
    id: `cxp-${ticket}`, ticket, proveedor: 'JOSE ENRIQUE', material: 'PET', kg: 100, precioEfectivo: total / 100,
    total, pagado: total - saldo, saldo, fechaTicket, estado: saldo < 0.01 ? 'liquidado' : 'parcial', abonos: [], ...extra
  };
}

// ── redondearCentavos ──
caso('redondearCentavos redondea a 2 decimales sin los errores de punto flotante', () => {
  const w = crearContexto();
  afirmar(typeof w.redondearCentavos === 'function', 'debe existir window.redondearCentavos');
  igual(w.redondearCentavos(1.005), 1.01, '1.005 (en binario 1.00499999...)');
  igual(w.redondearCentavos(0.1 + 0.2), 0.3, '0.1 + 0.2');
  igual(w.redondearCentavos(1.1 * 1.1), 1.21, '1.1 x 1.1');
  igual(w.redondearCentavos(7253.999999999), 7254, 'residuo cercano a 7254');
  igual(w.redondearCentavos(0.004), 0, 'menos de medio centavo');
  igual(w.redondearCentavos('12.345'), 12.35, 'texto numérico');
  igual(w.redondearCentavos(null), 0, 'null');
  igual(w.redondearCentavos(NaN), 0, 'NaN');
});

// ── Total de ticket, saldo, Editar kg ──
caso('7.8 x 930 kg da exactamente 7254.00 en total y en saldo', () => {
  const w = crearContexto();
  const registro = { ticket: '1', proveedor: 'ALFA', material: 'PET', kg: 930, fechaEntrada: '2026-11-01' };
  const doc = w.EVE_CXP.construirDocCxP(registro, { precio: 7.8 }, 0, { tipo: 'manual' }, false, null, null, 'Admin');
  igual(doc.total, 7254, 'total');
  igual(doc.saldo, 7254, 'saldo');
  igual(w.formatearMoneda(doc.saldo), w.formatearMoneda(7254), 'lo que se muestra no cambia');
});

caso('total y saldo quedan a centavos cuando kg x precio produce residuo (1.1 x 1.1)', () => {
  const w = crearContexto();
  const registro = { ticket: '2', proveedor: 'ALFA', material: 'PET', kg: 1.1, fechaEntrada: '2026-11-01' };
  const doc = w.EVE_CXP.construirDocCxP(registro, { precio: 1.1 }, 0, { tipo: 'manual' }, false, null, null, 'Admin');
  igual(doc.total, 1.21, 'total');
  igual(doc.saldo, 1.21, 'saldo');
  afirmar(esCentavos(doc.montoMaterial) && esCentavos(doc.montoComision), 'montos a centavos');
});

caso('con comisión por kg el total sigue a centavos', () => {
  const w = crearContexto();
  const registro = { ticket: '3', proveedor: 'ALFA', material: 'PET', kg: 333.33, fechaEntrada: '2026-11-01' };
  const doc = w.EVE_CXP.construirDocCxP(registro, { precio: 7.77 }, 0.33, { tipo: 'manual' }, false, null, null, 'Admin');
  afirmar(esCentavos(doc.total) && esCentavos(doc.saldo), `total ${doc.total} y saldo ${doc.saldo} a centavos`);
  igual(doc.saldo, doc.total, 'saldo = total');
});

caso('Editar kg recalcula total y saldo a centavos', () => {
  const w = crearContexto();
  const cxp = { precioAplicado: 1.1, precioNegociado: null, comisionPorKg: 0, iva: 0, kg: 5 };
  const r = w.EVE_CXP.calcularCorreccionKgCxP(cxp, 1.1, 'prueba');
  igual(r.total, 1.21, 'total');
  igual(r.saldo, 1.21, 'saldo');
  igual(r.estado, 'pendiente', 'estado');
});

// ── Abonos ──
caso('aplicarAbono suma y resta a centavos (0.1 + 0.2 = 0.3)', () => {
  const w = crearContexto();
  const base = cuenta('10', 1.21, 1.11, '2026-11-01', { pagado: 0.1 });
  const r = w.EVE_CXP.aplicarAbono(base, { monto: 0.2, fecha: '2026-11-02', abonoId: 'a1' });
  igual(r.pagado, 0.3, 'pagado');
  igual(r.saldo, 0.91, 'saldo');
  const liquida = w.EVE_CXP.aplicarAbono(cuenta('11', 0.3, 0.3, '2026-11-01', { pagado: 0 }), { monto: 0.1 + 0.2, fecha: '2026-11-02', abonoId: 'a2' });
  igual(liquida.saldo, 0, 'saldo tras liquidar con 0.1 + 0.2');
  igual(liquida.estado, 'liquidado', 'estado');
});

// ── Saldo inicial ──
caso('el saldo inicial se guarda a centavos', () => {
  const w = crearContexto();
  const doc = w.EVE_CXP.construirDocSaldoInicial({ proveedor: 'ALFA', monto: '1000.005', fecha: '2026-11-01', nota: '', usuario: 'Admin' });
  igual(doc.total, 1000.01, 'total');
  igual(doc.saldo, 1000.01, 'saldo');
});

// ── Pago que llega a un ticket con saldo 0.004 ──
caso('distribuirPago: un pago no toca el ticket con saldo 0.004 y pasa al siguiente', () => {
  const w = crearContexto();
  const cuentas = [
    cuenta('20', 500, 0.004, '2026-10-01'),
    cuenta('21', 500, 500, '2026-10-02')
  ];
  const { actualizaciones, sobrante } = w.EVE_CXP.distribuirPago(cuentas, 100, '2026-11-02', 'ref', 'Admin');
  igual(actualizaciones.map((a) => a.id), ['cxp-21'], 'solo el ticket con saldo real recibe el pago');
  igual(actualizaciones[0].abono.monto, 100, 'monto del abono');
  igual(actualizaciones[0].saldo, 400, 'saldo nuevo');
  igual(sobrante, 0, 'sin sobrante');
});

caso('distribuirPago: lo que excede los saldos reales queda como sobrante (saldo a favor), sin tocar el residuo', () => {
  const w = crearContexto();
  const cuentas = [cuenta('22', 500, 0.004, '2026-10-01'), cuenta('23', 50, 50, '2026-10-02')];
  const { actualizaciones, sobrante } = w.EVE_CXP.distribuirPago(cuentas, 80, '2026-11-02', 'ref', 'Admin');
  igual(actualizaciones.map((a) => a.id), ['cxp-23'], 'solo el ticket de 50');
  igual(actualizaciones[0].estado, 'liquidado', 'queda liquidado');
  igual(sobrante, 30, 'sobrante = saldo a favor');
});

caso('repartirMontoPEPS ignora el ticket con saldo 0.004 y no lo cuenta como saldo disponible', () => {
  const w = crearContexto();
  const cuentas = [cuenta('24', 500, 0.004, '2026-10-01'), cuenta('25', 500, 500, '2026-10-02')];
  const r = w.EVE_CXP.repartirMontoPEPS(cuentas, 100);
  afirmar(r.ok, 'debe repartir');
  igual(Array.from(r.asignaciones.entries()), [['cxp-25', 100]], 'asignaciones');
  const excede = w.EVE_CXP.repartirMontoPEPS(cuentas, 500.01);
  afirmar(!excede.ok && excede.motivo === 'excede', 'el residuo no suma al saldo participante');
  igual(excede.saldoParticipantes, 500, 'saldo participante');
});

caso('recibos: planificarRepartoRecibo no asigna nada a un ticket con saldo 0.009', () => {
  const w = crearContexto();
  const cuentas = [cuenta('26', 500, 0.009, '2026-10-01'), cuenta('27', 500, 500, '2026-10-02')];
  const plan = w.EVE_CXP.planificarRepartoRecibo(cuentas, new Set(), 100, 500, new Map());
  afirmar(plan.ok, 'debe repartir');
  igual(Array.from(plan.asignaciones.keys()), ['cxp-27'], 'solo el ticket con saldo real');
  const manual = w.EVE_CXP.planificarRepartoRecibo(cuentas, new Set(['cxp-26']), 100, 500, new Map());
  afirmar(manual.modoManual === false, 'una marca manual sobre un ticket liquidado no cuenta');
  igual(Array.from(manual.asignaciones.keys()), ['cxp-27'], 'el reparto sigue al ticket pendiente');
});

caso('saldoDisponibleCxP devuelve 0 para un residuo menor a un centavo', () => {
  const w = crearContexto();
  igual(w.EVE_CXP.saldoDisponibleCxP(cuenta('28', 500, 0.004, '2026-10-01'), new Map()), 0, 'residuo');
  igual(w.EVE_CXP.saldoDisponibleCxP(cuenta('29', 500, 100, '2026-10-01'), new Map([['cxp-29', 40]])), 60, 'saldo real menos comprometido');
});

// ── Pagos ──
caso('Pagos: el total del formulario queda a centavos y 7.8 x 930 da 7254', () => {
  const w = crearContexto();
  const base = { ticket: 'T1', proveedor: 'ALFA', material: 'PET', fecha: '2026-11-01', pagado: 0 };
  igual(w.EVE_PAGOS.construirRegistroDesdeFormulario({ ...base, kg: '930', precioPorKg: '7.8' }).total, 7254, '7.8 x 930');
  igual(w.EVE_PAGOS.construirRegistroDesdeFormulario({ ...base, kg: '1.1', precioPorKg: '1.1' }).total, 1.21, '1.1 x 1.1');
});

caso('Pagos: obtenerTicketsPendientes no lista tickets con saldo menor a un centavo', () => {
  const w = crearContexto();
  w.EVE.cuentasPorPagar = [cuenta('30', 500, 0.004, '2026-10-01'), cuenta('31', 500, 0.009, '2026-10-02'), cuenta('32', 500, 0.01, '2026-10-03')];
  igual(w.EVE_PAGOS.obtenerTicketsPendientes('JOSE ENRIQUE').map((c) => c.ticket), ['32'], 'tickets pendientes');
});

// ── scripts/listar-residuos-cxp.js (solo lectura): la detección es una función pura ──
caso('listar-residuos-cxp: detecta saldos entre 0 y 0.01 y montos que no son múltiplos de centavo', () => {
  const { detectarResiduosCxP } = require('./listar-residuos-cxp.js');
  const cuentas = [
    { id: 'a', ticket: '1', proveedor: 'JOSE ENRIQUE', total: 800, saldo: 0.004, estado: 'liquidado' },
    { id: 'b', ticket: '2', proveedor: 'JOSE ENRIQUE', total: 1.2100000000000002, saldo: 0, estado: 'liquidado' },
    { id: 'c', ticket: '3', proveedor: 'ALFA', total: 2699.973, saldo: 2699.973, estado: 'pendiente' },
    { id: 'd', ticket: '4', proveedor: 'ALFA', total: 7254, saldo: 7254, estado: 'pendiente' },
    { id: 'e', ticket: '5', proveedor: 'ALFA', total: 100, saldo: 0, estado: 'liquidado' },
    { id: 'f', ticket: '6', proveedor: 'ALFA', total: 100.01, saldo: 0.01, estado: 'parcial' }
  ];
  igual(detectarResiduosCxP(cuentas).map((r) => r.id), ['a', 'b', 'c'], 'cuentas señaladas');
  igual(detectarResiduosCxP(cuentas)[0].motivos, ['saldo entre 0 y 0.01', 'saldo no es múltiplo de centavo'], 'motivos de 0.004');
  afirmar(!JSON.stringify(detectarResiduosCxP(cuentas)).includes('"d"'), 'una cuenta limpia no se señala');
});

caso('listar-residuos-cxp: sin llave avisa y no escribe nada (código de salida 1)', () => {
  const { spawnSync } = require('child_process');
  const env = { ...process.env };
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'listar-residuos-cxp.js')], { env, encoding: 'utf8' });
  igual(r.status, 1, 'código de salida');
  afirmar(/llave de servicio/i.test(r.stderr), 'debe explicar cómo ejecutarlo');
});

let fallos = 0;
for (const { nombre, fn } of casos) {
  try { fn(); console.log(`OK    ${nombre}`); } catch (e) { fallos += 1; console.log(`FALLA ${nombre}\n      ${e.message}`); }
}
console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
process.exit(fallos ? 1 : 0);
