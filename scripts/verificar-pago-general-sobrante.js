// Pago general de CxP con sobrante (js/cxp.js, registrarPagoGeneral).
//
// El sobrante se guarda como saldo a favor y ahora también como documento en `pagos` (origen 'anticipo', pagado = sobrante, total 0,
// mismo grupoPagoId que el movimiento de saldo a favor, mismo patrón que pagos.js), para que entre al Flujo de efectivo. Cubre:
// con cuentas pendientes, sin cuentas pendientes (todo el monto es sobrante), pago exacto (sin anticipo), fallo de la escritura en
// pagos (aviso claro, el saldo a favor queda), que el saldo a favor APLICADO a una cuenta nueva NO genere documento en pagos, y la
// reversión (por abono y desde la tabla de saldo a favor) marcando el anticipo junto con el movimiento, por grupoPagoId. Un caso
// de extremo a extremo comprueba que lo que escribe registrarPagoGeneral es lo que el Flujo de efectivo (js/flujo.js) cuenta.
//
// Uso: node scripts/verificar-pago-general-sobrante.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/flujo.js'];
const leer = (ruta) => fs.readFileSync(path.join(RAIZ, ruta), 'utf8');

function crearContexto({ cuentas = [], fallaAnticipo = false } = {}) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: cuentas.map((c) => ({ ...c })), registrosPagos: [], proveedores: [], currentUser: { username: 'admin1' } };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(leer(archivo), sandbox, { filename: archivo });
  const w = sandbox.window;
  const guardados = { pagos: [], cuentas_por_pagar: {}, proveedores: {} };
  let contador = 0;
  w.__guardados = guardados;
  w.__errores = [];
  w.obtenerFechaMexico = () => '2026-10-06';
  w.showError = (m) => w.__errores.push(m);
  w.guardarDato = async (coleccion, doc) => {
    if (coleccion === 'pagos' && fallaAnticipo && doc.origen === 'anticipo') throw new Error('permission-denied');
    const id = `id${++contador}`;
    if (coleccion === 'pagos') guardados.pagos.push({ id, ...doc });
    return id;
  };
  w.actualizarDato = async (coleccion, id, cambios) => {
    if (coleccion === 'pagos') {
      const doc = guardados.pagos.find((p) => p.id === id);
      if (doc) Object.assign(doc, cambios);
    } else {
      guardados[coleccion][id] = { ...(guardados[coleccion][id] || {}), ...cambios };
    }
  };
  w.db = { collection: (nombre) => ({ doc: (id) => ({ set: async (datos) => { guardados[nombre][id] = { ...(guardados[nombre][id] || {}), ...datos }; } }) }) };
  return w;
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const rechaza = async (promesa, texto, mensaje) => {
  try { await promesa; } catch (error) { afirmar(error.message.includes(texto), `${mensaje}: el error "${error.message}" no contiene "${texto}"`); return; }
  throw new Error(`${mensaje}: debía rechazar con "${texto}"`);
};

const cuenta = (extra) => ({
  id: 'c1', ticket: '1160', proveedor: 'PROV A', material: 'P.P.', kg: 100, fechaTicket: '2026-10-01', precioEfectivo: 10,
  total: 1000, pagado: 0, saldo: 1000, estado: 'pendiente', iva: 0, abonos: [], ...extra
});
const anticipos = (w) => w.__guardados.pagos.filter((p) => p.origen === 'anticipo');

caso('Con cuentas pendientes: el abono y su pago de ticket de siempre, más el anticipo del sobrante con el mismo grupoPagoId', async () => {
  const w = crearContexto({ cuentas: [cuenta()] });
  const r = await w.EVE_CXP.registrarPagoGeneral('PROV A', 1300, '2026-10-06', 'Efectivo', 'admin1');
  igual([r.actualizaciones.length, r.sobrante], [1, 300], 'resultado');
  const grupo = w.EVE.cuentasPorPagar[0].abonos[0].grupoPagoId;
  afirmar(grupo, 'el abono lleva grupoPagoId');
  const [pagoTicket] = w.__guardados.pagos.filter((p) => p.origen === 'cxp_pago_general');
  igual([pagoTicket.ticket, pagoTicket.pagado, pagoTicket.grupoPagoId], ['1160', 1000, grupo], 'pago del ticket intacto');
  const [anticipo] = anticipos(w);
  igual(anticipos(w).length, 1, 'un solo anticipo');
  igual([anticipo.pagado, anticipo.total, anticipo.ticket, anticipo.proveedor, anticipo.fecha, anticipo.revertido, anticipo.origen, anticipo.grupoPagoId],
    [300, 0, '', 'PROV A', '2026-10-06', false, 'anticipo', grupo], 'documento del anticipo');
  const movimiento = w.EVE.proveedores[0].saldoAFavor[0];
  igual([movimiento.monto, movimiento.grupoPagoId, movimiento.revertido], [300, grupo, false], 'movimiento de saldo a favor con el mismo grupo');
  igual(w.EVE.registrosPagos.filter((p) => p.origen === 'anticipo').map((p) => p.pagado), [300], 'también en memoria (Pagos y Flujo lo ven sin recargar)');
  igual(w.__errores, [], 'sin avisos');
});

caso('Proveedor sin cuentas pendientes: todo el monto es sobrante y también crea su anticipo', async () => {
  const w = crearContexto({ cuentas: [cuenta({ saldo: 0, pagado: 1000, estado: 'liquidado' })] });
  const r = await w.EVE_CXP.registrarPagoGeneral('PROV A', 500, '2026-10-06', 'Transferencia', 'admin1');
  igual([r.actualizaciones.length, r.sobrante], [0, 500], 'todo es sobrante');
  igual(w.__guardados.pagos.map((p) => [p.origen, p.pagado]), [['anticipo', 500]], 'solo el anticipo, sin pagos de ticket');
  igual(w.EVE.proveedores[0].saldoAFavor[0].grupoPagoId, anticipos(w)[0].grupoPagoId, 'mismo grupoPagoId');
});

caso('Pago exacto, sin sobrante: no se crea anticipo ni saldo a favor', async () => {
  const w = crearContexto({ cuentas: [cuenta()] });
  await w.EVE_CXP.registrarPagoGeneral('PROV A', 1000, '2026-10-06', 'Efectivo', 'admin1');
  igual(anticipos(w).length, 0, 'sin anticipo');
  igual(w.EVE.proveedores.length, 0, 'sin saldo a favor');
});

caso('Si falla la escritura en pagos: aviso claro, el saldo a favor queda guardado y el pago no se da por fallido', async () => {
  const w = crearContexto({ cuentas: [cuenta()], fallaAnticipo: true });
  const r = await w.EVE_CXP.registrarPagoGeneral('PROV A', 1300, '2026-10-06', 'Efectivo', 'admin1');
  igual(r.sobrante, 300, 'la función termina con su resultado');
  igual(w.__errores.length, 1, 'un aviso');
  ['$300.00', 'saldo a favor', 'Pagos', 'permission-denied', 'Flujo de efectivo'].forEach((f) => afirmar(w.__errores[0].includes(f), `el aviso debe incluir "${f}": ${w.__errores[0]}`));
  igual(w.EVE.proveedores[0].saldoAFavor[0].monto, 300, 'el saldo a favor sí se guardó');
  igual(anticipos(w).length, 0, 'sin anticipo');
  igual(w.__guardados.pagos.filter((p) => p.origen === 'cxp_pago_general').length, 1, 'el pago del ticket sí se guardó');
});

caso('El saldo a favor aplicado automáticamente a una cuenta nueva NO genera documento en pagos', async () => {
  const w = crearContexto();
  w.guardarDato = async () => { throw new Error('no debe escribir en pagos'); };
  const proveedor = { nombre: 'PROV A', saldoAFavor: [{ monto: 300, fecha: '2026-10-06', revertido: false, grupoPagoId: 'pago_x' }] };
  const aplicada = w.EVE_CXP.aplicarSaldoAFavor(proveedor, { ...cuenta() });
  igual([aplicada.aplicado, aplicada.docCxP.pagado, aplicada.docCxP.abonos.length], [300, 300, 1], 'se aplica como abono');
  const fuente = leer('js/cxp.js');
  const generar = fuente.slice(fuente.indexOf('async function generarYGuardarCxP'), fuente.indexOf('async function generarCxPDesdeAuditoria'));
  afirmar(!generar.includes("'pagos'"), 'generarYGuardarCxP no escribe en pagos');
  const aplicar = fuente.slice(fuente.indexOf('function aplicarSaldoAFavor'), fuente.indexOf('// campo: nombre del campo por el que se agrupa'));
  afirmar(!aplicar.includes('guardarDato') && !aplicar.includes("'pagos'"), 'aplicarSaldoAFavor no escribe en pagos');
});

caso('Reversión por abono: el anticipo, el movimiento de saldo a favor y el pago del ticket quedan revertidos juntos', async () => {
  const w = crearContexto({ cuentas: [cuenta()] });
  await w.EVE_CXP.registrarPagoGeneral('PROV A', 1300, '2026-10-06', 'Efectivo', 'admin1');
  const abono = w.EVE.cuentasPorPagar[0].abonos[0];
  await w.EVE_CXP.revertirAbono('c1', abono.abonoId, 'error de captura', 'admin1');
  igual(w.__guardados.pagos.map((p) => [p.origen, p.revertido, p.revertidoMotivo]), [['cxp_pago_general', true, 'error de captura'], ['anticipo', true, 'error de captura']], 'pagos revertidos');
  const movimiento = w.EVE.proveedores[0].saldoAFavor[0];
  igual([movimiento.revertido, movimiento.revertidoMotivo], [true, 'error de captura'], 'movimiento revertido');
  igual(w.EVE.cuentasPorPagar[0].saldo, 1000, 'la cuenta vuelve a su saldo');
});

caso('Reversión desde la tabla de saldo a favor: el anticipo se marca revertido junto con el movimiento (por grupoPagoId)', async () => {
  const w = crearContexto({ cuentas: [] });
  await w.EVE_CXP.registrarPagoGeneral('PROV A', 500, '2026-10-06', 'Efectivo', 'admin1');
  const movimiento = w.EVE.proveedores[0].saldoAFavor[0];
  // Misma secuencia que el botón Revertir de la tabla (cxp.js, crearTablaSaldoAFavor).
  await w.EVE_CXP.revertirMovimientoSaldoAFavorSiExiste('PROV A', movimiento.grupoPagoId, 'duplicado', 'admin1');
  await w.EVE_CXP.revertirPagosSiExiste(movimiento.grupoPagoId, null, 'duplicado');
  igual(w.EVE.proveedores[0].saldoAFavor[0].revertido, true, 'movimiento revertido');
  igual(anticipos(w).map((p) => [p.revertido, p.revertidoMotivo]), [[true, 'duplicado']], 'anticipo revertido');
  const fuente = leer('js/cxp.js');
  const tabla = fuente.slice(fuente.indexOf('function crearTablaSaldoAFavor'), fuente.indexOf('function crearTablaSaldoAFavor') + 2600);
  afirmar(tabla.includes('revertirMovimientoSaldoAFavorSiExiste(nombreProveedor, m.grupoPagoId') && tabla.includes('revertirPagosSiExiste(m.grupoPagoId'), 'el botón de la tabla usa esas dos funciones con el grupoPagoId del movimiento');
});

caso('Un anticipo ya aplicado a otra cuenta no se puede revertir (se conserva el bloqueo)', async () => {
  const w = crearContexto({ cuentas: [cuenta()] });
  await w.EVE_CXP.registrarPagoGeneral('PROV A', 1300, '2026-10-06', 'Efectivo', 'admin1');
  await w.EVE_CXP.guardarSaldoAFavor('PROV A', { monto: -300, fecha: '2026-10-07', motivo: 'Aplicado automáticamente a CxP del ticket 1170', grupoPagoId: 'otro' });
  await rechaza(w.EVE_CXP.revertirAbono('c1', w.EVE.cuentasPorPagar[0].abonos[0].abonoId, 'x', 'admin1'), 'ya fue aplicado', 'anticipo consumido');
  igual(anticipos(w).map((p) => p.revertido), [false], 'el anticipo sigue vigente');
});

caso('Extremo a extremo con el Flujo de efectivo: el pago completo (ticket + sobrante) sale una vez, y revertirlo lo saca', async () => {
  const w = crearContexto({ cuentas: [cuenta()] });
  await w.EVE_CXP.registrarPagoGeneral('PROV A', 1300, '2026-10-06', 'Efectivo', 'admin1');
  const flujo = () => w.EVE_FLUJO.construirMovimientosFlujo({ pagos: w.EVE.registrosPagos });
  igual(flujo().map((m) => [m.concepto, m.salida]), [['Pago a proveedor', 1000], ['Anticipo a proveedor', 300]], 'salidas del flujo');
  igual(w.EVE_FLUJO.calcularTotalesFlujo(flujo()).salidas, 1300, 'todo el dinero que salió de caja');
  await w.EVE_CXP.revertirAbono('c1', w.EVE.cuentasPorPagar[0].abonos[0].abonoId, 'error', 'admin1');
  igual(flujo(), [], 'revertido el pago general, el flujo queda sin salidas');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
