// Cambio de proveedor de una cuenta por pagar (js/cxp.js, js/destaraje.js).
//
// Cubre: cuenta sin abonos cambia de proveedor y conserva el anterior y el motivo (más el historial); se bloquea con abonos
// (en memoria o registrados desde otra sesión), con un recibo en estado pendiente_pago y con saldo inicial; el motivo es
// obligatorio; el saldo a favor del proveedor nuevo solo se avisa, no se aplica. Y el lado Báscula: al corregir el proveedor
// de un registro con CxP se ofrece actualizar la cuenta (sí / no / con abonos / sin CxP).
//
// Uso: node scripts/verificar-editar-proveedor-cxp.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const ARCHIVOS = ['js/config.js', 'js/utils.js', 'js/cxp.js'];

// Firestore mínimo: colecciones en memoria, get por id y where(campo, '==' | 'in', v) encadenable.
function crearDb(colecciones) {
  const almacen = JSON.parse(JSON.stringify(colecciones));
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
    almacen,
    collection: (coleccion) => ({
      doc: (id) => ({ coleccion, id, get: async () => instantanea(coleccion, id) }),
      where: (campo, op, valor) => consulta(coleccion, [{ campo, op, valor }])
    })
  };
}

function crearContexto({ colecciones, eve, permisos }) {
  const sandbox = {
    console, Intl, Date, Map, Set, Math, Number, String, Array, Object, JSON, Promise, RegExp, Error, setTimeout, clearTimeout,
    document: {},
    navigator: { onLine: true },
    firebase: { initializeApp() {}, firestore() { return { enablePersistence() { return Promise.resolve(); } }; } }
  };
  sandbox.window = sandbox;
  sandbox.window.EVE = { cuentasPorPagar: [], registrosDestaraje: [], registrosDestarajeRaw: [], proveedores: [], ...eve };
  sandbox.window.EVE_MODULES = {};
  vm.createContext(sandbox);
  for (const archivo of ARCHIVOS) {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), sandbox, { filename: archivo });
  }
  const w = sandbox.window;
  w.db = crearDb(colecciones);
  w.puedeEscribir = (modulo) => (permisos || { cxp: 'escritura', destaraje: 'escritura' })[modulo] === 'escritura';
  w.puedeLeer = () => true;
  w.escrituras = [];
  w.actualizarDato = async (coleccion, id, cambios) => {
    w.escrituras.push({ coleccion, id, cambios });
    Object.assign(w.db.almacen[coleccion][id], JSON.parse(JSON.stringify(cambios)));
  };
  w.historial = [];
  w.EVE_HISTORIAL = { registrar: (entrada) => w.historial.push(entrada) };
  w.showError = () => {};
  return w;
}

const cuentaBase = (extra) => ({
  ticket: '2001', proveedor: 'JOSE PEREZ', material: 'P.P.', kg: 1000, fechaTicket: '2026-10-01',
  precioAplicado: 6, comisionPorKg: 0, precioEfectivo: 6, montoMaterial: 6000, montoComision: 0, total: 6000,
  pagado: 0, saldo: 6000, iva: 0, estado: 'pendiente', aprobacion: { tipo: 'foto' }, abonos: [], precioNegociado: null, ...extra
});

// cuentas / recibos / proveedores: { id: documento }. La memoria (window.EVE) se arma con los mismos documentos.
function escenario({ cuentas, recibos, proveedores, basculas, permisos }) {
  const colecciones = {
    cuentas_por_pagar: cuentas || {},
    recibos_pendientes: recibos || {},
    proveedores: proveedores || {},
    destaraje: basculas || {}
  };
  const conId = (mapa) => Object.keys(mapa).map((id) => ({ id, ...JSON.parse(JSON.stringify(mapa[id])) }));
  return crearContexto({
    colecciones,
    permisos,
    eve: {
      cuentasPorPagar: conId(colecciones.cuentas_por_pagar),
      proveedores: conId(colecciones.proveedores),
      registrosDestaraje: conId(colecciones.destaraje),
      registrosDestarajeRaw: conId(colecciones.destaraje)
    }
  });
}

const casos = [];
const caso = (nombre, fn) => casos.push({ nombre, fn });
const afirmar = (condicion, mensaje) => { if (!condicion) throw new Error(mensaje); };
const igual = (real, esperado, mensaje) => afirmar(JSON.stringify(real) === JSON.stringify(esperado), `${mensaje}: esperado ${JSON.stringify(esperado)}, obtenido ${JSON.stringify(real)}`);
const rechaza = async (promesa, texto, mensaje) => {
  try { await promesa; } catch (error) { afirmar(error.message.includes(texto), `${mensaje}: el error "${error.message}" no contiene "${texto}"`); return; }
  throw new Error(`${mensaje}: debía rechazar con "${texto}"`);
};
const cuentaEnFirestore = (w, id) => w.db.almacen.cuentas_por_pagar[id];

// ── Lado CxP ──────────────────────────────────────────────────────────────────

caso('Cuenta sin abonos cambia de proveedor y conserva el anterior y el motivo', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase() } });
  const resultado = await w.EVE_CXP.editarProveedorCxP('cxp1', 'maria lopez', 'Se capturó con el proveedor equivocado', 'prueba');
  const guardada = cuentaEnFirestore(w, 'cxp1');
  igual([guardada.proveedor, guardada.proveedorAnterior, guardada.motivoCambioProveedor], ['MARIA LOPEZ', 'JOSE PEREZ', 'Se capturó con el proveedor equivocado'], 'Firestore');
  igual(w.EVE.cuentasPorPagar[0].proveedor, 'MARIA LOPEZ', 'memoria');
  igual([guardada.total, guardada.saldo, guardada.pagado, guardada.estado], [6000, 6000, 0, 'pendiente'], 'montos intactos');
  igual([resultado.proveedorAnterior, resultado.proveedorNuevo], ['JOSE PEREZ', 'MARIA LOPEZ'], 'resultado');
  igual(w.historial.length, 1, 'una entrada de historial');
  igual([w.historial[0].coleccion, w.historial[0].registroId, w.historial[0].accion, w.historial[0].motivo], ['cuentas_por_pagar', 'cxp1', 'edicion', 'Se capturó con el proveedor equivocado'], 'historial');
  igual([w.historial[0].valorAnterior.proveedor, w.historial[0].valorNuevo.proveedor], ['JOSE PEREZ', 'MARIA LOPEZ'], 'historial antes/después');
});

caso('El nombre nuevo se normaliza como el resto del sistema (alias de ortografía)', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase() } });
  await w.EVE_CXP.editarProveedorCxP('cxp1', ' j. enrique ', 'Corrección', 'prueba');
  igual(cuentaEnFirestore(w, 'cxp1').proveedor, 'JOSE ENRIQUE', 'alias -> canónico');
});

caso('Proveedor vacío o igual al actual se rechaza sin escribir', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase() } });
  await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', '   ', 'x', 'prueba'), 'obligatorio', 'vacío');
  await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', 'jose perez', 'x', 'prueba'), 'distinto', 'igual');
  igual(w.escrituras.length, 0, 'sin escrituras');
});

caso('Cuenta con abono aplicado se bloquea', async () => {
  const abono = { id: 'a1', monto: 100, fecha: '2026-10-02' };
  const w = escenario({ cuentas: { cxp1: cuentaBase({ pagado: 100, saldo: 5900, abonos: [abono], estado: 'parcial' }) } });
  await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'x', 'prueba'), 'abonos', 'abono');
  igual(w.escrituras.length, 0, 'sin escrituras');
  igual(cuentaEnFirestore(w, 'cxp1').proveedor, 'JOSE PEREZ', 'proveedor intacto');
});

caso('Abono registrado desde otra sesión (solo en Firestore) también se bloquea', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase() } });
  Object.assign(w.db.almacen.cuentas_por_pagar.cxp1, { pagado: 50, saldo: 5950, abonos: [{ id: 'a1', monto: 50 }] });
  await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'x', 'prueba'), 'abono', 'otra sesión');
  igual(w.escrituras.length, 0, 'sin escrituras');
});

caso('Cuenta incluida en un recibo pendiente_pago se bloquea; con el recibo completado ya no', async () => {
  const recibo = (estado) => ({ proveedor: 'JOSE PEREZ', estado, tickets: [{ cuentaId: 'cxp1', ticket: '2001', material: 'P.P.', montoAsignado: 6000 }] });
  const bloqueada = escenario({ cuentas: { cxp1: cuentaBase() }, recibos: { r1: recibo('pendiente_pago') } });
  await rechaza(bloqueada.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'x', 'prueba'), 'recibo', 'recibo pendiente');
  igual(bloqueada.escrituras.length, 0, 'sin escrituras');
  const libre = escenario({ cuentas: { cxp1: cuentaBase() }, recibos: { r1: recibo('completado') } });
  await libre.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'x', 'prueba');
  igual(cuentaEnFirestore(libre, 'cxp1').proveedor, 'MARIA LOPEZ', 'recibo completado no bloquea');
});

caso('Cuenta de saldo inicial se bloquea', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase({ aprobacion: { tipo: 'saldo_inicial' } }) } });
  await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'x', 'prueba'), 'saldo inicial', 'saldo inicial');
  igual(w.escrituras.length, 0, 'sin escrituras');
});

caso('Motivo vacío se rechaza', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase() } });
  for (const motivo of ['', '   ', null, undefined]) {
    await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', motivo, 'prueba'), 'motivo', `motivo ${JSON.stringify(motivo)}`);
  }
  igual(w.escrituras.length, 0, 'sin escrituras');
});

caso('El saldo a favor del proveedor nuevo se avisa pero NO se aplica', async () => {
  const proveedores = { 'MARIA LOPEZ': { nombre: 'MARIA LOPEZ', saldoAFavor: [{ monto: 2500, fecha: '2026-09-30', motivo: 'Sobrante', grupoPagoId: 'g1' }] } };
  const w = escenario({ cuentas: { cxp1: cuentaBase() }, proveedores });
  const resultado = await w.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'Proveedor equivocado', 'prueba');
  igual(resultado.saldoAFavorNuevo, 2500, 'aviso con el saldo disponible');
  const guardada = cuentaEnFirestore(w, 'cxp1');
  igual([guardada.pagado, guardada.saldo, guardada.abonos.length, guardada.estado], [0, 6000, 0, 'pendiente'], 'cuenta sin abonos nuevos');
  igual(w.escrituras.length, 1, 'una sola escritura (la cuenta)');
  igual(w.escrituras[0].coleccion, 'cuentas_por_pagar', 'solo cuentas_por_pagar');
  igual(w.db.almacen.proveedores['MARIA LOPEZ'].saldoAFavor.length, 1, 'saldo a favor intacto');
  const sinSaldo = await escenario({ cuentas: { cxp1: cuentaBase() } }).EVE_CXP.editarProveedorCxP('cxp1', 'OTRO', 'x', 'prueba');
  igual(sinSaldo.saldoAFavorNuevo, 0, 'sin saldo a favor -> 0');
});

caso('Sin permiso de escritura en CxP se rechaza', async () => {
  const w = escenario({ cuentas: { cxp1: cuentaBase() }, permisos: { cxp: 'lectura' } });
  await rechaza(w.EVE_CXP.editarProveedorCxP('cxp1', 'MARIA LOPEZ', 'x', 'prueba'), 'permiso', 'sin permiso');
  igual(w.escrituras.length, 0, 'sin escrituras');
});

(async () => {
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    try {
      await fn();
      console.log(`  ok   ${nombre}`);
    } catch (error) {
      fallos++;
      console.log(`  FALLA ${nombre}\n       ${error.message}`);
    }
  }
  console.log(`\n${casos.length - fallos} de ${casos.length} casos pasaron`);
  process.exit(fallos ? 1 : 0);
})();
