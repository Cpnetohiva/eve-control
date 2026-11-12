// Verifica los descuentos posteriores a una venta (CxC + ventas netas):
//  - el descuento vive en venta.descuentos y baja el saldo de la CxC sin crear cobros ni movimientos de flujo;
//  - valida monto > 0 y <= saldo pendiente de la venta; revertir marca revertido=true sin borrar;
//  - las ventas netas (subtotalVenta, subtotalLineaVenta, reporte de Ventas) restan los descuentos no revertidos
//    en el mes de la VENTA y en la partida indicada;
//  - el caso V-2026-045 (CHINOS QUERETARO, 21/10/2026): descuento 4906 a PET VERDE → partida 60,598.00 y saldo 0.
//
// Uso: node scripts/verificar-descuentos-ventas.js (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js', 'js/cxc.js', 'js/reportes.js'];

function crearContexto() {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: { getElementById: () => ({ value: '' }) },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorCobrar: [], cuentasPorPagar: [], cobros: [], proveedores: [], ventas: [], flujoMovimientos: [] };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  const escrituras = [];
  sandbox.window.escrituras = escrituras;
  sandbox.window.actualizarDato = async (coleccion, id, cambios) => { escrituras.push({ tipo: 'actualizar', coleccion, id, cambios }); };
  sandbox.window.guardarDato = async (coleccion, doc) => { escrituras.push({ tipo: 'guardar', coleccion, doc }); return 'nuevo'; };
  sandbox.window.eliminarDato = async (coleccion, id) => { escrituras.push({ tipo: 'eliminar', coleccion, id }); };
  sandbox.window.obtenerFechaMexico = () => '2026-11-12';
  sandbox.window.puedeEscribir = () => true;
  return sandbox.window;
}

// V-2026-045: una sola partida PET VERDE de 65,504.00, con cobros por 60,598.00 → saldo 4,906.00.
function escenario045(w) {
  const venta = {
    id: 'v45', folio: 'V-2026-045', cliente: 'CHINOS QUERETARO', fecha: '2026-10-21',
    lineas: [{ material: 'PET VERDE', cantidad: 8000, unidad: 'KG', precioUnitario: 8.188, subtotal: 65504, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 65504 }],
    totalVenta: 65504
  };
  w.EVE.ventas = [venta];
  w.EVE.cuentasPorCobrar = [{
    id: 'c45', ventaId: 'v45', lineaIndex: 0, folio: 'V-2026-045', cliente: 'CHINOS QUERETARO', material: 'PET VERDE', cantidad: 8000,
    precioUnitario: 8.188, subtotal: 65504, ivaTrasladado: 0, ivaRetenido: 0, total: 65504, fechaVenta: '2026-10-21',
    pagado: 60598, saldo: 4906, estado: 'parcial',
    abonos: [{ monto: 60598, fecha: '2026-10-25', referencia: 'Transferencia', registradoPor: 'Admin', abonoId: 'a1' }], abonosRevertidos: []
  }];
  return venta;
}

// Venta con dos partidas: PET 1000 (cobrado 900, saldo 100) y HDPE 1000 (sin cobros, saldo 1000).
function escenarioDosPartidas(w) {
  const lineas = [
    { material: 'PET', cantidad: 100, unidad: 'KG', precioUnitario: 10, subtotal: 1000, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 1000 },
    { material: 'HDPE', cantidad: 100, unidad: 'KG', precioUnitario: 10, subtotal: 1000, ivaTrasladado: 0, ivaRetenido: 0, totalLinea: 1000 }
  ];
  w.EVE.ventas = [{ id: 'v2', folio: 'V-2026-099', cliente: 'ACME', fecha: '2026-10-05', lineas, totalVenta: 2000 }];
  const cuenta = (id, indice, pagado) => ({
    id, ventaId: 'v2', lineaIndex: indice, folio: 'V-2026-099', cliente: 'ACME', material: lineas[indice].material, cantidad: 100,
    precioUnitario: 10, subtotal: 1000, ivaTrasladado: 0, ivaRetenido: 0, total: 1000, fechaVenta: '2026-10-05',
    pagado, saldo: 1000 - pagado, estado: pagado > 0 ? 'parcial' : 'pendiente',
    abonos: pagado > 0 ? [{ monto: pagado, fecha: '2026-10-06', referencia: 'x', registradoPor: 'Admin', abonoId: 'a2' }] : [], abonosRevertidos: []
  });
  w.EVE.cuentasPorCobrar = [cuenta('cA', 0, 900), cuenta('cB', 1, 0)];
}

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  if (JSON.stringify(real) !== JSON.stringify(esperado)) throw new Error(`${mensaje}: esperado ${JSON.stringify(esperado)}, real ${JSON.stringify(real)}`);
}
async function rechaza(fn, fragmento, mensaje) {
  try { await fn(); } catch (error) {
    afirmar(error.message.includes(fragmento), `${mensaje}: el error "${error.message}" no contiene "${fragmento}"`);
    return;
  }
  throw new Error(`${mensaje}: debía rechazarse`);
}

caso('descuento a PET VERDE de V-2026-045: saldo 0, estado liquidado, sin cobros ni flujo', async () => {
  const w = crearContexto();
  const venta = escenario045(w);
  await w.EVE_CXC.aplicarDescuentoVenta('v45', { monto: 4906, lineaIndex: 0, motivo: 'Merma pactada', fecha: '2026-11-12', usuario: 'Neto' });
  const cxc = w.EVE.cuentasPorCobrar[0];
  igual(cxc.saldo, 0, 'saldo CxC');
  igual(cxc.estado, 'liquidado', 'estado de la CxC');
  igual(cxc.pagado, 60598, 'pagado no cambia');
  igual(cxc.total, 65504, 'total no cambia');
  igual(venta.descuentos.length, 1, 'un descuento en la venta');
  const d = venta.descuentos[0];
  igual([d.monto, d.material, d.motivo, d.usuario, d.revertido, d.fecha], [4906, 'PET VERDE', 'Merma pactada', 'Neto', false, '2026-11-12'], 'campos del descuento');
  afirmar(d.id, 'el descuento lleva id');
  igual(venta.lineas[0].precioUnitario, 8.188, 'precio unitario intacto');
  igual(venta.lineas[0].cantidad, 8000, 'kg intactos');
  igual(w.EVE.cobros.length, 0, 'no crea cobros en memoria');
  igual(w.EVE.flujoMovimientos.length, 0, 'no toca flujo en memoria');
  afirmar(w.escrituras.every((e) => e.tipo === 'actualizar' && ['ventas', 'cuentas_por_cobrar'].includes(e.coleccion)), 'solo escribe ventas y cuentas_por_cobrar: ' + JSON.stringify(w.escrituras.map((e) => e.coleccion)));
});

caso('ventas netas: la partida baja a 60,598.00 en octubre (mes de la venta, no del descuento)', async () => {
  const w = crearContexto();
  const venta = escenario045(w);
  await w.EVE_CXC.aplicarDescuentoVenta('v45', { monto: 4906, lineaIndex: 0, motivo: 'Merma', fecha: '2026-11-12', usuario: 'Neto' });
  igual(w.subtotalLineaVenta(venta.lineas[0], venta, 0), 60598, 'subtotal neto de la partida');
  igual(w.subtotalVenta(venta), 60598, 'subtotal neto de la venta');
  const r = w.construirReporteVentas([venta]);
  igual(r.totalVentas, 60598, 'TOTAL VENTAS del reporte');
  igual(r.grupos[0].lineas[0].total, 60598, 'total de la partida en el reporte');
  igual(r.porProducto[0].total, 60598, 'por material');
  igual(r.porCliente[0].total, 60598, 'por cliente');
});

caso('revertir marca revertido=true sin borrar, restaura el saldo y las ventas netas', async () => {
  const w = crearContexto();
  const venta = escenario045(w);
  await w.EVE_CXC.aplicarDescuentoVenta('v45', { monto: 4906, lineaIndex: 0, motivo: 'Merma', fecha: '2026-11-12', usuario: 'Neto' });
  const id = venta.descuentos[0].id;
  await w.EVE_CXC.revertirDescuentoVenta('v45', id, 'Error de captura', 'Neto');
  igual(venta.descuentos.length, 1, 'no se borra');
  igual(venta.descuentos[0].revertido, true, 'revertido');
  const cxc = w.EVE.cuentasPorCobrar[0];
  igual([cxc.saldo, cxc.estado], [4906, 'parcial'], 'saldo y estado restaurados');
  igual(w.subtotalVenta(venta), 65504, 'ventas netas vuelven al bruto');
  await rechaza(() => w.EVE_CXC.revertirDescuentoVenta('v45', id, 'otra vez', 'Neto'), 'ya está revertido', 'doble reversión');
});

caso('validaciones: monto > 0, no mayor al saldo de la venta y motivo obligatorio', async () => {
  const w = crearContexto();
  escenario045(w);
  const base = { lineaIndex: 0, motivo: 'x', fecha: '2026-11-12', usuario: 'Neto' };
  await rechaza(() => w.EVE_CXC.aplicarDescuentoVenta('v45', { ...base, monto: 0 }), 'mayor a 0', 'monto 0');
  await rechaza(() => w.EVE_CXC.aplicarDescuentoVenta('v45', { ...base, monto: -5 }), 'mayor a 0', 'monto negativo');
  await rechaza(() => w.EVE_CXC.aplicarDescuentoVenta('v45', { ...base, monto: 4906.01 }), 'saldo pendiente', 'monto excede saldo');
  await rechaza(() => w.EVE_CXC.aplicarDescuentoVenta('v45', { ...base, monto: 10, motivo: '  ' }), 'motivo', 'sin motivo');
  igual(w.escrituras.length, 0, 'nada se escribió');
});

caso('sin permiso de escritura de CxC no se aplica ni se revierte', async () => {
  const w = crearContexto();
  escenario045(w);
  w.puedeEscribir = () => false;
  await rechaza(() => w.EVE_CXC.aplicarDescuentoVenta('v45', { monto: 10, lineaIndex: 0, motivo: 'x', fecha: '2026-11-12', usuario: 'Neto' }), 'permiso', 'aplicar sin permiso');
  igual(w.escrituras.length, 0, 'nada se escribió');
});

caso('descuento mayor al saldo de su partida se reparte al resto de la venta y la reversión lo deshace', async () => {
  const w = crearContexto();
  escenarioDosPartidas(w);
  const venta = w.EVE.ventas[0];
  await w.EVE_CXC.aplicarDescuentoVenta('v2', { monto: 300, lineaIndex: 0, motivo: 'Calidad', fecha: '2026-11-12', usuario: 'Neto' });
  const [a, b] = w.EVE.cuentasPorCobrar;
  igual([a.saldo, a.estado, b.saldo], [0, 'liquidado', 800], 'PET absorbe 100 y HDPE 200');
  igual(w.subtotalLineaVenta(venta.lineas[0], venta, 0), 700, 'la partida PET resta los 300 completos');
  igual(w.subtotalLineaVenta(venta.lineas[1], venta, 1), 1000, 'HDPE no cambia en ventas netas');
  await w.EVE_CXC.revertirDescuentoVenta('v2', venta.descuentos[0].id, 'x', 'Neto');
  igual([a.saldo, b.saldo, a.descuentoAplicado, b.descuentoAplicado], [100, 1000, 0, 0], 'saldos restaurados');
});

caso('revertir un abono con descuento aplicado conserva el descuento en el saldo', async () => {
  const w = crearContexto();
  escenario045(w);
  await w.EVE_CXC.aplicarDescuentoVenta('v45', { monto: 4906, lineaIndex: 0, motivo: 'Merma', fecha: '2026-11-12', usuario: 'Neto' });
  w.EVE_SALDO_CLIENTES = { validarAnticipoClienteNoConsumido: async () => {}, revertirMovimientoSaldoAFavorClienteSiExiste: async () => {} };
  await w.EVE_CXC.revertirAbonoCxC('c45', 'a1', 'Error', 'Neto');
  const cxc = w.EVE.cuentasPorCobrar[0];
  igual([cxc.pagado, cxc.saldo, cxc.estado], [0, 60598, 'pendiente'], 'saldo = total − descuento − cobros');
});

caso('una venta con descuentos vigentes no se puede editar sus líneas', async () => {
  const w = crearContexto();
  escenario045(w);
  await w.EVE_CXC.aplicarDescuentoVenta('v45', { monto: 4906, lineaIndex: 0, motivo: 'Merma', fecha: '2026-11-12', usuario: 'Neto' });
  let mensaje = '';
  try { w.EVE_CXC.validarVentaEditable('v45'); } catch (error) { mensaje = error.message; }
  afirmar(mensaje.includes('descuento'), 'debe bloquear la edición mencionando el descuento: ' + mensaje);
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log('ok   ' + nombre); } catch (error) { fallos++; console.error('FALLA ' + nombre + '\n     ' + error.message); }
  }
  console.log(`${casos.length - fallos}/${casos.length} casos`);
  if (fallos > 0) process.exit(1);
})();
