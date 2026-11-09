// Edición de un ticket de Báscula y de su cuenta por pagar (js/cxp.js: validarEdicionBascula, guardarEdicionBasculaConCxP,
// editarMaterialCxP, editarProveedorCxP; js/destaraje.js: manejarEnvioEdicion).
//
// Regla: Báscula es el origen de ticket, proveedor, material, kg y fecha de entrada; la CxP guarda lo mismo más precio y total y
// cambia junto, en UNA transacción con lectura fresca. Casos al editar un ticket: A) sin CxP: libre; B) con CxP y sin pagos:
// destaraje + CxP en un solo lote; C) con pagos, abonos, saldo a favor o recibo pendiente: bloquea; D) ambiguo: bloquea; E) sin
// permiso de CxP: bloquea; F) sin conexión y con CxP: bloquea.
// Sin navegador: js/ reales en vm con un Firestore en memoria. La pantalla (modal de destaraje.js) se revisa por texto.
//
// Uso: node scripts/verificar-edicion-ticket-bascula.js   (código de salida 1 si algún caso falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

const MSG_PAGOS = 'Este ticket tiene pagos: revierte los pagos en CxP/Pagos y vuelve a editar.';
const MSG_PRECIO = 'No hay precio vigente para el material nuevo con esa fecha y proveedor. Captura el precio en Precios antes de cambiar el material.';
const MSG_PERMISO = 'Este ticket ya tiene cuenta por pagar: solo Admin puede corregirlo.';
const MSG_AMBIGUO = 'El ticket tiene varias filas que no se pueden distinguir; revisalo en CxP.';

// Firestore en memoria: get por id, where('==' | 'in') encadenable, runTransaction (lecturas frescas y escrituras juntas) y un registro de escrituras.
function crearDb(colecciones) {
  const almacen = JSON.parse(JSON.stringify(colecciones));
  const estado = { fallarCommit: false, antesDeCommit: null };
  const escrituras = [];
  const instantanea = (coleccion, id) => {
    const dato = (almacen[coleccion] || {})[id];
    return { exists: !!dato, id, data: () => (dato ? JSON.parse(JSON.stringify(dato)) : undefined) };
  };
  const consulta = (coleccion, filtros) => ({
    where: (campo, op, valor) => consulta(coleccion, [...filtros, { campo, op, valor }]),
    get: async () => ({
      docs: Object.keys(almacen[coleccion] || {})
        .filter((id) => filtros.every((f) => (f.op === 'in' ? f.valor.includes(almacen[coleccion][id][f.campo]) : almacen[coleccion][id][f.campo] === f.valor)))
        .map((id) => instantanea(coleccion, id))
    })
  });
  return {
    almacen, estado, escrituras,
    runTransaction: async (fn) => {
      const pendientes = [];
      const tx = { get: async (ref) => instantanea(ref.coleccion, ref.id), update: (ref, datos) => pendientes.push([ref, datos]) };
      const resultado = await fn(tx);
      if (estado.fallarCommit) throw new Error('commit falló');
      pendientes.forEach(([ref, datos]) => {
        Object.assign(almacen[ref.coleccion][ref.id], JSON.parse(JSON.stringify(datos)));
        escrituras.push({ coleccion: ref.coleccion, id: ref.id, cambios: datos });
      });
      return resultado;
    },
    collection: (coleccion) => ({
      doc: (id) => ({ coleccion, id, get: async () => instantanea(coleccion, id) }),
      where: (campo, op, valor) => consulta(coleccion, [{ campo, op, valor }])
    })
  };
}

const PRECIOS = [
  { material: 'P.P.', precio: 6, fechaInicio: '2026-01-01', fechaFin: null },
  { material: 'BIDON', precio: 8, fechaInicio: '2026-01-01', fechaFin: null }
];

function crearContexto({ colecciones, eve, permisos, enLinea }) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {}, navigator: { onLine: enLinea !== false },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: [], registrosDestaraje: [], registrosDestarajeRaw: [], registrosPagos: [], proveedores: [], precios: PRECIOS, ...eve };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  const w = sandbox.window;
  // Ajuste de precio por proveedor (vive en js/precios.js): MARIA LOPEZ paga 1.00 más por kg de P.P.
  w.obtenerAjusteProveedorVigente = (material, proveedor) => (material === 'P.P.' && w.normalizarProveedor(proveedor) === 'MARIA LOPEZ' ? { tipoAjuste: 'monto', valorAjuste: 1 } : null);
  w.db = crearDb(colecciones);
  const nivel = permisos || { cxp: 'escritura', destaraje: 'escritura' };
  w.puedeEscribir = (modulo) => nivel[modulo] === 'escritura';
  w.puedeLeer = (modulo) => nivel[modulo] === 'escritura' || nivel[modulo] === 'lectura';
  w.historial = [];
  w.EVE_HISTORIAL = { registrar: (entrada) => w.historial.push(entrada) };
  w.showError = () => {};
  return w;
}

// Ticket 2001: 1000 kg de P.P. a 6.00 + 0.50 de comisión (total 6500.00).
const cuenta = (extra) => ({
  ticket: '2001', proveedor: 'JOSE PEREZ', material: 'P.P.', kg: 1000, fechaTicket: '2026-10-01',
  precioAplicado: 6, precioBase: 6, comisionPorKg: 0.5, precioEfectivo: 6.5, montoMaterial: 6000, montoComision: 500, total: 6500,
  pagado: 0, saldo: 6500, iva: 0, estado: 'pendiente', aprobacion: { tipo: 'foto' }, abonos: [], precioNegociado: null, ...extra
});
const bascula = (extra) => ({ ticket: '2001', proveedor: 'JOSE PEREZ', material: 'P.P.', kg: 1000, fechaEntrada: '2026-10-01', fechaSalida: '2026-10-01', ...extra });

// cuentas / basculas / pagos / recibos: { id: documento }. La memoria (window.EVE) se arma con los mismos documentos.
function escenario({ cuentas, basculas, pagos, recibos, permisos, enLinea, memoriaCuentas }) {
  const colecciones = { cuentas_por_pagar: cuentas || {}, destaraje: basculas || {}, pagos: pagos || {}, recibos_pendientes: recibos || {} };
  const conId = (mapa) => Object.keys(mapa).map((id) => ({ id, ...JSON.parse(JSON.stringify(mapa[id])) }));
  return crearContexto({
    colecciones, permisos, enLinea,
    eve: {
      cuentasPorPagar: memoriaCuentas || conId(colecciones.cuentas_por_pagar),
      registrosDestaraje: conId(colecciones.destaraje),
      registrosDestarajeRaw: conId(colecciones.destaraje),
      registrosPagos: conId(colecciones.pagos)
    }
  });
}
const simple = (c, b, extra) => escenario({ cuentas: c ? { cxp1: c } : {}, basculas: b ? { bas1: b } : {}, ...extra });
const anterior = (extra) => ({ id: 'bas1', ...bascula(), ...extra });
const nuevo = (extra) => ({ ...bascula(), ...extra });

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const rechaza = async (promesa, texto, mensaje) => {
  try { await promesa; } catch (error) { afirmar(error.message.includes(texto), `${mensaje}: el error "${error.message}" no contiene "${texto}"`); return; }
  throw new Error(`${mensaje}: debía rechazar con "${texto}"`);
};
const sinEscrituras = (w, mensaje) => igual(w.db.escrituras.length, 0, `${mensaje}: sin escrituras`);

// Valida y, si es B, escribe (lo mismo que hace destaraje.js).
async function editarDesdeBascula(w, nuevoRegistro, motivo) {
  const plan = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevoRegistro, { basculaId: 'bas1', motivo });
  if (plan.caso === 'B' && plan.permitido) {
    await w.EVE_CXP.guardarEdicionBasculaConCxP({ cxp: plan.cxp, cambiosCxP: plan.cambiosCxP, basculaId: 'bas1', cambiosBascula: nuevoRegistro, basculaAnterior: anterior(), motivo });
  }
  return plan;
}

// ── A) sin CxP ──
caso('a) ticket sin CxP: edición libre (caso A), solo Báscula, sin tocar CxP', async () => {
  const w = simple(null, bascula());
  const plan = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON', kg: 900, proveedor: 'MARIA LOPEZ' }), { basculaId: 'bas1' });
  igual([plan.caso, plan.permitido, plan.mensaje], ['A', true, ''], 'caso A');
  sinEscrituras(w, 'A');
});

caso('a) la CxP de otro proveedor con el mismo ticket no cuenta (caso A) y un cambio que no replica la CxP (fecha de salida) tampoco consulta nada', async () => {
  const w = simple(cuenta({ proveedor: 'OTRO' }), bascula());
  igual((await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {})).caso, 'A', 'otro proveedor');
  const w2 = simple(cuenta({ pagado: 100, abonos: [{ monto: 100 }] }), bascula());
  igual((await w2.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ fechaSalida: '2026-10-05' }), {})).caso, 'A', 'solo fecha de salida, aun con pagos');
});

// ── B) con CxP y sin pagos ──
caso('b) con CxP sin pagos: cambiar el material actualiza Báscula y CxP en un solo lote, con precio y total recalculados', async () => {
  const w = simple(cuenta(), bascula());
  const plan = await editarDesdeBascula(w, nuevo({ material: 'BIDON' }), 'Material mal capturado');
  igual([plan.caso, plan.permitido], ['B', true], 'caso B');
  const c = w.db.almacen.cuentas_por_pagar.cxp1, b = w.db.almacen.destaraje.bas1;
  igual([c.material, c.materialAnterior, c.precioAplicado, c.montoMaterial, c.montoComision, c.total, c.saldo, c.estado], ['BIDON', 'P.P.', 8, 8000, 500, 8500, 8500, 'pendiente'], 'CxP: material, precio y total');
  igual(b.material, 'BIDON', 'Báscula');
  igual(w.db.escrituras.map((e) => e.coleccion).sort(), ['cuentas_por_pagar', 'destaraje'], 'un solo lote con las dos colecciones');
  igual([w.EVE.cuentasPorPagar[0].material, w.EVE.registrosDestaraje[0].material, w.EVE.registrosDestarajeRaw[0].material], ['BIDON', 'BIDON', 'BIDON'], 'memoria');
});

caso('c) lo mismo para proveedor, kg, fecha de entrada y ticket', async () => {
  // proveedor: se normaliza y el precio se recalcula con el ajuste del proveedor nuevo (MARIA LOPEZ: +1.00 por kg => 7.00 + 0.50)
  let w = simple(cuenta(), bascula());
  await editarDesdeBascula(w, nuevo({ proveedor: ' maria lopez ' }), 'x');
  let c = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([c.proveedor, c.proveedorAnterior, w.db.almacen.destaraje.bas1.proveedor.trim().toUpperCase(), c.precioAplicado, c.precioBase, c.total], ['MARIA LOPEZ', 'JOSE PEREZ', 'MARIA LOPEZ', 7, 6, 7500], 'proveedor');
  // kg: conserva el precio congelado (6 + 0.50): 1200 kg = 7800
  w = simple(cuenta(), bascula());
  await editarDesdeBascula(w, nuevo({ kg: 1200 }), 'x');
  c = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([c.kg, c.kgAnterior, c.montoMaterial, c.montoComision, c.total, c.saldo, w.db.almacen.destaraje.bas1.kg], [1200, 1000, 7200, 600, 7800, 7800, 1200], 'kg');
  // fecha de entrada: la CxP guarda fechaTicket
  w = simple(cuenta(), bascula());
  await editarDesdeBascula(w, nuevo({ fechaEntrada: '2026-10-03' }), 'x');
  c = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([c.fechaTicket, c.fechaTicketAnterior, w.db.almacen.destaraje.bas1.fechaEntrada], ['2026-10-03', '2026-10-01', '2026-10-03'], 'fecha de entrada');
  // ticket
  w = simple(cuenta(), bascula());
  await editarDesdeBascula(w, nuevo({ ticket: '2002' }), 'x');
  c = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([c.ticket, c.ticketAnterior, w.db.almacen.destaraje.bas1.ticket], ['2002', '2001', '2002'], 'ticket');
});

caso('b) cambiar material y kg juntos: precio nuevo con el kg nuevo (BIDON 500 kg: 8 + 0.50)', async () => {
  const w = simple(cuenta(), bascula());
  await editarDesdeBascula(w, nuevo({ material: 'BIDON', kg: 500 }), 'x');
  const c = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([c.montoMaterial, c.montoComision, c.total], [4000, 250, 4250], 'montos');
});

caso('b) un ticket con dos materiales: se elige la CxP del material del renglón editado (no es ambiguo)', async () => {
  const w = escenario({
    cuentas: { cxpA: cuenta({ material: 'BIDON', kg: 200, precioAplicado: 8, precioBase: 8, montoMaterial: 1600, montoComision: 100, total: 1700, saldo: 1700 }), cxpB: cuenta() },
    basculas: { bas1: bascula(), basB: bascula({ material: 'BIDON', kg: 200 }) }
  });
  const plan = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ kg: 900 }), { basculaId: 'bas1' });
  igual([plan.caso, plan.permitido, plan.cxp.id], ['B', true, 'cxpB'], 'elige la de P.P.');
});

// ── C) pagos ──
caso('d) con abono en la CxP: bloquea con el mensaje de pagos y no escribe nada', async () => {
  const w = simple(cuenta({ pagado: 100, saldo: 6400, estado: 'parcial', abonos: [{ monto: 100, abonoId: 'a1' }] }), bascula());
  const plan = await editarDesdeBascula(w, nuevo({ material: 'BIDON' }));
  igual([plan.caso, plan.permitido, plan.mensaje], ['C', false, MSG_PAGOS], 'bloqueo');
  sinEscrituras(w, 'abono');
  igual(w.db.almacen.destaraje.bas1.material, 'P.P.', 'Báscula intacta');
});

caso('e) con un pago en la colección pagos pero sin abono en memoria ni en la cuenta: bloquea; un pago revertido o de otro material no', async () => {
  const pago = (extra) => ({ ticket: '2001', proveedor: 'JOSE PEREZ', material: 'P.P.', kg: 1000, pagado: 500, total: 6500, fecha: '2026-10-02', origen: 'cxp_pago', ...extra });
  const w = simple(cuenta(), bascula(), { pagos: { p1: pago() } });
  const plan = await editarDesdeBascula(w, nuevo({ material: 'BIDON' }));
  igual([plan.caso, plan.mensaje], ['C', MSG_PAGOS], 'pago en pagos');
  sinEscrituras(w, 'pago');
  // solo existe en Firestore (la memoria no lo conoce)
  const w2 = simple(cuenta(), bascula());
  w2.db.almacen.pagos = { p9: pago({ ticket: '2001' }) };
  igual((await w2.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {})).caso, 'C', 'pago visible solo con lectura fresca');
  // revertido / otro material: no bloquea
  const w3 = simple(cuenta(), bascula(), { pagos: { p1: pago({ revertido: true }), p2: pago({ material: 'BIDON' }) } });
  igual((await w3.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {})).caso, 'B', 'revertido y de otro material no bloquean');
});

caso('f) con saldo a favor aplicado (se guarda como abono): bloquea', async () => {
  const w0 = simple();
  const proveedor = { nombre: 'JOSE PEREZ', saldoAFavor: [{ monto: 500, fecha: '2026-09-30', revertido: false, grupoPagoId: 'pago_x' }] };
  w0.obtenerFechaMexico = () => '2026-10-06';
  const aplicada = w0.EVE_CXP.aplicarSaldoAFavor(proveedor, cuenta());
  const w = simple(aplicada.docCxP, bascula());
  const plan = await editarDesdeBascula(w, nuevo({ kg: 900 }));
  igual([plan.caso, plan.mensaje], ['C', MSG_PAGOS], 'saldo a favor aplicado');
  sinEscrituras(w, 'saldo a favor');
});

caso('c) con un recibo pendiente_pago que incluye la cuenta: bloquea (se trata como caso C); con el recibo completado, no', async () => {
  const recibo = (estado) => ({ proveedor: 'JOSE PEREZ', estado, tickets: [{ cuentaId: 'cxp1', ticket: '2001', material: 'P.P.', montoAsignado: 6500 }] });
  const w = simple(cuenta(), bascula(), { recibos: { r1: recibo('pendiente_pago') } });
  const plan = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {});
  igual([plan.caso, plan.permitido], ['C', false], 'recibo pendiente');
  afirmar(plan.mensaje.includes('recibo pendiente'), `el mensaje explica el recibo: ${plan.mensaje}`);
  const w2 = simple(cuenta(), bascula(), { recibos: { r1: recibo('completado') } });
  igual((await w2.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {})).caso, 'B', 'recibo completado no bloquea');
});

// ── D) ambiguo ──
caso('g) ticket con filas que no se pueden distinguir: bloquea con el mensaje de ambiguo', async () => {
  // dos CxP idénticas (mismo material y kg)
  const w = escenario({ cuentas: { c1: cuenta(), c2: cuenta() }, basculas: { bas1: bascula() } });
  const plan = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {});
  igual([plan.caso, plan.mensaje], ['D', MSG_AMBIGUO], 'dos CxP iguales');
  sinEscrituras(w, 'ambiguo');
  // dos renglones idénticos en Báscula con una sola CxP
  const w2 = escenario({ cuentas: { c1: cuenta() }, basculas: { bas1: bascula(), bas2: bascula() } });
  const plan2 = await w2.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {});
  igual([plan2.caso, plan2.mensaje], ['D', MSG_AMBIGUO], 'dos renglones iguales en Báscula');
});

// ── precio ──
caso('h) material nuevo sin precio vigente: bloquea con el mensaje de precio y no escribe nada', async () => {
  const w = simple(cuenta(), bascula());
  const plan = await editarDesdeBascula(w, nuevo({ material: 'CARTON' }));
  igual([plan.permitido, plan.mensaje], [false, MSG_PRECIO], 'sin precio');
  sinEscrituras(w, 'sin precio');
  // lo mismo si el cambio de fecha deja el material sin precio
  const w2 = simple(cuenta(), bascula());
  const plan2 = await w2.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ fechaEntrada: '2025-01-01' }), {});
  igual([plan2.permitido, plan2.mensaje], [false, MSG_PRECIO], 'sin precio en la fecha nueva');
  // y un cambio de solo kg no consulta precios: aunque no haya precio vigente, conserva el congelado
  const w3 = simple(cuenta(), bascula());
  w3.EVE.precios = [];
  igual((await w3.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ kg: 900 }), {})).caso, 'B', 'solo kg: precio congelado');
});

// ── E) permisos ──
caso('i) usuario sin permiso de escritura de CxP sobre un ticket con CxP: bloquea con el mensaje de permiso', async () => {
  const lectura = simple(cuenta(), bascula(), { permisos: { cxp: 'lectura', destaraje: 'escritura' } });
  const plan = await editarDesdeBascula(lectura, nuevo({ material: 'BIDON' }));
  igual([plan.caso, plan.permitido, plan.mensaje], ['E', false, MSG_PERMISO], 'solo lectura de CxP');
  sinEscrituras(lectura, 'permiso');
  // sin permiso de CxP el usuario tampoco puede descartar que haya CxP: la lectura de Firestore falla y se bloquea
  const sinCxp = simple(cuenta(), bascula(), { permisos: { destaraje: 'escritura' } });
  sinCxp.db.collection = (coleccion) => {
    if (coleccion === 'cuentas_por_pagar') return { where: () => ({ get: async () => { throw new Error('permission-denied'); } }), doc: () => ({}) };
    return crearDb({}).collection(coleccion);
  };
  const plan2 = await sinCxp.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {});
  igual([plan2.caso, plan2.mensaje], ['E', MSG_PERMISO], 'sin lectura de CxP');
});

caso('j) la CxP aparece mientras el operador edita (lectura fresca): sin permiso de CxP bloquea; con permiso y con un pago nuevo bloquea', async () => {
  // La memoria no tiene la CxP (se generó después de abrir la pantalla), Firestore sí.
  const sinPermiso = escenario({ cuentas: { cxp1: cuenta() }, basculas: { bas1: bascula() }, memoriaCuentas: [], permisos: { cxp: 'lectura', destaraje: 'escritura' } });
  igual((await sinPermiso.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {})).caso, 'E', 'aparece y no puede escribir cxp');
  const conPermiso = escenario({ cuentas: { cxp1: cuenta() }, basculas: { bas1: bascula() }, memoriaCuentas: [] });
  const plan = await conPermiso.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {});
  igual([plan.caso, plan.permitido], ['B', true], 'con permiso la CxP recién aparecida se edita junto');
  // Un pago llega entre la validación y la escritura: la transacción lo detecta y no escribe nada
  const w = simple(cuenta(), bascula());
  const plan2 = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), { basculaId: 'bas1' });
  Object.assign(w.db.almacen.cuentas_por_pagar.cxp1, { pagado: 50, saldo: 6450, abonos: [{ monto: 50, abonoId: 'a1' }] });
  await rechaza(w.EVE_CXP.guardarEdicionBasculaConCxP({ cxp: plan2.cxp, cambiosCxP: plan2.cambiosCxP, basculaId: 'bas1', cambiosBascula: nuevo({ material: 'BIDON' }), basculaAnterior: anterior() }), MSG_PAGOS, 'pago durante la edición');
  sinEscrituras(w, 'pago durante la edición');
  igual(w.db.almacen.destaraje.bas1.material, 'P.P.', 'Báscula intacta');
  // Báscula cambió desde otra sesión mientras se editaba
  const w2 = simple(cuenta(), bascula());
  const plan3 = await w2.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), { basculaId: 'bas1' });
  w2.db.almacen.destaraje.bas1.kg = 1111;
  await rechaza(w2.EVE_CXP.guardarEdicionBasculaConCxP({ cxp: plan3.cxp, cambiosCxP: plan3.cambiosCxP, basculaId: 'bas1', cambiosBascula: nuevo({ material: 'BIDON' }), basculaAnterior: anterior() }), 'cambió mientras se editaba', 'Báscula cambió');
  sinEscrituras(w2, 'Báscula cambió');
});

// ── F) sin conexión ──
caso('k) sin conexión: un ticket con CxP no se edita (caso F); uno sin CxP sí (caso A)', async () => {
  const w = simple(cuenta(), bascula(), { enLinea: false });
  const plan = await w.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), { basculaId: 'bas1' });
  igual([plan.caso, plan.permitido], ['F', false], 'con CxP sin conexión');
  afirmar(plan.mensaje.includes('Sin conexión'), `mensaje: ${plan.mensaje}`);
  await rechaza(w.EVE_CXP.guardarEdicionBasculaConCxP({ cxp: { id: 'cxp1' }, cambiosCxP: {}, basculaId: 'bas1', cambiosBascula: {} }), 'Sin conexión', 'guardar sin conexión');
  sinEscrituras(w, 'sin conexión');
  const sinCuenta = simple(null, bascula(), { enLinea: false });
  igual((await sinCuenta.EVE_CXP.validarEdicionBascula(anterior(), nuevo({ material: 'BIDON' }), {})).caso, 'A', 'sin CxP sin conexión: libre');
});

// ── Desde CxP ──
caso('l) edición de material desde CxP: actualiza también Báscula, en el mismo lote y con historial en las dos colecciones', async () => {
  const w = simple(cuenta(), bascula());
  await w.EVE_CXP.editarMaterialCxP('cxp1', 'bidon', 'Material mal capturado', 'Admin');
  const c = w.db.almacen.cuentas_por_pagar.cxp1;
  igual([c.material, c.materialAnterior, c.motivoAjusteMaterial, c.total], ['BIDON', 'P.P.', 'Material mal capturado', 8500], 'CxP');
  igual(w.db.almacen.destaraje.bas1.material, 'BIDON', 'Báscula');
  igual(w.db.escrituras.map((e) => e.coleccion).sort(), ['cuentas_por_pagar', 'destaraje'], 'un solo lote');
  igual(w.historial.map((h) => h.coleccion).sort(), ['cuentas_por_pagar', 'destaraje'], 'historial (n) en las dos colecciones');
  const h = w.historial.find((x) => x.coleccion === 'destaraje');
  igual([h.valorAnterior.material, h.valorNuevo.material, h.motivo], ['P.P.', 'BIDON', 'Material mal capturado'], 'historial de Báscula: antes y después');
  const hc = w.historial.find((x) => x.coleccion === 'cuentas_por_pagar');
  igual([hc.valorAnterior.material, hc.valorNuevo.material, hc.valorAnterior.total, hc.valorNuevo.total], ['P.P.', 'BIDON', 6500, 8500], 'historial de CxP: antes y después');
});

caso('l) edición desde CxP con pagos mantiene el bloqueo; sin Báscula o ambigua bloquea con el mensaje de ambiguo', async () => {
  const conPago = simple(cuenta({ pagado: 100, saldo: 6400, abonos: [{ monto: 100 }] }), bascula());
  await rechaza(conPago.EVE_CXP.editarMaterialCxP('cxp1', 'BIDON', 'x', 'Admin'), 'recibió un pago', 'con abonos (lectura fresca de la cuenta)');
  sinEscrituras(conPago, 'con pagos');
  const sinBascula = simple(cuenta(), null);
  await rechaza(sinBascula.EVE_CXP.editarMaterialCxP('cxp1', 'BIDON', 'x', 'Admin'), MSG_AMBIGUO, 'sin Báscula');
  sinEscrituras(sinBascula, 'sin Báscula');
  const ambigua = escenario({ cuentas: { cxp1: cuenta() }, basculas: { b1: bascula(), b2: bascula() } });
  await rechaza(ambigua.EVE_CXP.editarMaterialCxP('cxp1', 'BIDON', 'x', 'Admin'), MSG_AMBIGUO, 'Báscula ambigua');
  sinEscrituras(ambigua, 'ambigua');
});

// ── Atomicidad ──
caso('m) el lote es atómico: si falla la escritura no queda nada a medias (ni Firestore ni memoria ni historial)', async () => {
  const w = simple(cuenta(), bascula());
  w.db.estado.fallarCommit = true;
  await rechaza(editarDesdeBascula(w, nuevo({ material: 'BIDON' }), 'x'), 'commit falló', 'desde Báscula');
  igual([w.db.almacen.cuentas_por_pagar.cxp1.material, w.db.almacen.destaraje.bas1.material, w.EVE.cuentasPorPagar[0].material, w.EVE.registrosDestaraje[0].material], ['P.P.', 'P.P.', 'P.P.', 'P.P.'], 'sin cambios');
  igual(w.historial.length, 0, 'sin historial');
  await rechaza(w.EVE_CXP.editarMaterialCxP('cxp1', 'BIDON', 'x', 'Admin'), 'commit falló', 'desde CxP');
  igual([w.db.almacen.cuentas_por_pagar.cxp1.material, w.db.almacen.destaraje.bas1.material], ['P.P.', 'P.P.'], 'sin cambios desde CxP');
});

caso('n) historial desde Báscula: valor anterior y nuevo en destaraje y en cuentas_por_pagar', async () => {
  const w = simple(cuenta(), bascula());
  await editarDesdeBascula(w, nuevo({ material: 'BIDON', kg: 800 }), 'Corrección');
  igual(w.historial.map((h) => h.coleccion).sort(), ['cuentas_por_pagar', 'destaraje'], 'dos colecciones');
  const b = w.historial.find((h) => h.coleccion === 'destaraje');
  igual([b.registroId, b.accion, b.valorAnterior.material, b.valorAnterior.kg, b.valorNuevo.material, b.valorNuevo.kg, b.motivo], ['bas1', 'edicion', 'P.P.', 1000, 'BIDON', 800, 'Corrección'], 'Báscula');
  const c = w.historial.find((h) => h.coleccion === 'cuentas_por_pagar');
  igual([c.registroId, c.valorAnterior.material, c.valorAnterior.kg, c.valorAnterior.total, c.valorNuevo.material, c.valorNuevo.kg, c.valorNuevo.total], ['cxp1', 'P.P.', 1000, 6500, 'BIDON', 800, 6800], 'CxP');
});

// ── Caso 1504 ──
caso('o) caso 1504: el material editado desde CxP queda igual en Báscula (ya no hay dos materiales para un ticket)', async () => {
  const w = escenario({
    cuentas: { c1504: cuenta({ ticket: '1504', material: 'P.P.' }) },
    basculas: { b1504: bascula({ ticket: '1504', material: 'P.P.' }) }
  });
  await w.EVE_CXP.editarMaterialCxP('c1504', 'BIDON', 'Era BIDON, no P.P.', 'Admin');
  igual([w.db.almacen.cuentas_por_pagar.c1504.material, w.db.almacen.destaraje.b1504.material], ['BIDON', 'BIDON'], 'CxP y Báscula iguales');
  igual([w.EVE.cuentasPorPagar[0].material, w.EVE.registrosDestaraje[0].material], ['BIDON', 'BIDON'], 'memoria igual');
});

// ── Cableado en la pantalla de Báscula (no se puede correr sin navegador: se revisa el texto) ──
caso('Báscula (destaraje.js): valida antes de cualquier escritura, escribe en lote en el caso B y ya no pregunta con confirm por el proveedor', () => {
  const fuente = fs.readFileSync(path.join(RAIZ, 'js/destaraje.js'), 'utf8');
  const inicio = fuente.indexOf('async function manejarEnvioEdicion');
  const fin = fuente.indexOf('function crearModalEdicion');
  const f = fuente.slice(inicio, fin);
  const iValidar = f.indexOf('validarEdicionBascula');
  const iPlan = f.indexOf('plan.permitido');
  const iLote = f.indexOf('guardarEdicionBasculaConCxP');
  const iLibre = f.indexOf("window.actualizarDato('destaraje'");
  afirmar(iValidar > 0 && iPlan > iValidar && iLote > iPlan && iLibre > iPlan, 'validarEdicionBascula va antes que cualquier escritura');
  afirmar(!/ofrecerActualizar|¿Actualizar también la CxP/.test(fuente), 'ya no pregunta si actualizar la CxP del proveedor (se propaga solo)');
  afirmar(!/prepararCorreccionKgDesdeBascula/.test(f), 'la corrección de kg pasa por la misma validación');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try { await fn(); console.log(`ok   ${nombre}`); } catch (error) { fallos++; console.log(`FAIL ${nombre}\n     ${error.message}`); }
  }
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos ? 1 : 0);
})();
