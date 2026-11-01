(function () {

// Saldo a favor de clientes (cuando pagan más de lo adeudado). Colección `saldos_cliente`.
// Montos sin IVA, igual que los cobros. Saldo disponible = monto - suma de aplicaciones (0 si está revertido).
// Las operaciones que consumen saldo leen de Firestore dentro de una transacción (hay concurrencia).

const ORIGENES = ['cobro_sobrante', 'manual'];
const MSG_YA_APLICADO = 'Este saldo ya se aplicó a una venta; revierte primero esa aplicación.';

function normalizarCliente(valor) {
  return (valor || '').toString().trim().replace(/\s+/g, ' ').toUpperCase();
}

function aCentavos(valor) {
  return Math.round((Number(valor) || 0) * 100);
}

function generarAplicacionId() {
  return `aplic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function saldoDisponible(doc) {
  if (!doc || doc.revertido) return 0;
  const aplicado = (doc.aplicaciones || []).reduce((suma, a) => suma + aCentavos(a.monto), 0);
  return Math.max(0, aCentavos(doc.monto) - aplicado) / 100;
}

// Agrupa por cliente (mismo normalizador que Ventas: trim + mayúsculas). Solo clientes con saldo disponible.
function saldoPorCliente(lista) {
  const mapa = new Map();
  (lista || []).forEach((doc) => {
    if (doc.revertido) return;
    const cliente = normalizarCliente(doc.cliente);
    if (!mapa.has(cliente)) mapa.set(cliente, { cliente, disponible: 0, fechaMasAntigua: null, movimientos: [] });
    const fila = mapa.get(cliente);
    const disponible = saldoDisponible(doc);
    fila.movimientos.push(doc);
    fila.disponible = (aCentavos(fila.disponible) + aCentavos(disponible)) / 100;
    if (disponible > 0 && (!fila.fechaMasAntigua || doc.fecha < fila.fechaMasAntigua)) fila.fechaMasAntigua = doc.fecha;
  });
  return Array.from(mapa.values())
    .filter((fila) => fila.disponible > 0)
    .sort((a, b) => a.cliente.localeCompare(b.cliente));
}

function registrarHistorial(saldoId, accion, valorAnterior, valorNuevo, motivo) {
  return window.EVE_HISTORIAL.registrar({ coleccion: window.COLECCIONES.SALDOS_CLIENTE, registroId: saldoId, accion, valorAnterior, valorNuevo, motivo });
}

function actualizarEnMemoria(saldoId, cambios) {
  const doc = (window.EVE.saldosCliente || []).find((s) => s.id === saldoId);
  if (doc) Object.assign(doc, cambios);
}

async function crearSaldoCliente(datos) {
  const cliente = normalizarCliente(datos.cliente);
  if (!cliente) throw new Error('El cliente es obligatorio.');
  const monto = aCentavos(datos.monto) / 100;
  if (!(monto > 0)) throw new Error('El monto del saldo a favor debe ser mayor a 0.');
  const origen = datos.origen || 'manual';
  if (!ORIGENES.includes(origen)) throw new Error(`Origen de saldo no válido: ${origen}`);
  const doc = {
    cliente,
    monto,
    fecha: datos.fecha || window.obtenerFechaMexico(),
    origen,
    folio: datos.folio || '',
    grupoPagoId: datos.grupoPagoId || '',
    nota: datos.nota || '',
    aplicaciones: [],
    revertido: false,
    creadoPor: (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema',
    fechaRegistro: new Date().toISOString()
  };
  const id = await window.guardarDato(window.COLECCIONES.SALDOS_CLIENTE, doc);
  if (!window.EVE.saldosCliente) window.EVE.saldosCliente = [];
  window.EVE.saldosCliente.push({ id, ...doc });
  await registrarHistorial(id, 'alta', null, doc, datos.nota || '');
  return id;
}

async function aplicarSaldoCliente(saldoId, monto, cobroId, folio) {
  const centavos = aCentavos(monto);
  if (!(centavos > 0)) throw new Error('El monto a aplicar debe ser mayor a 0.');
  const ref = window.db.collection(window.COLECCIONES.SALDOS_CLIENTE).doc(saldoId);
  const aplicacion = { aplicacionId: generarAplicacionId(), monto: centavos / 100, fecha: window.obtenerFechaMexico(), cobroId, folio: folio || '' };
  const aplicaciones = await window.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('El saldo a favor ya no existe.');
    const actual = snap.data();
    if (actual.revertido) throw new Error('Este saldo a favor está revertido y no se puede aplicar.');
    if (centavos > aCentavos(saldoDisponible(actual))) throw new Error('El monto a aplicar es mayor al saldo a favor disponible.');
    const nuevas = [...(actual.aplicaciones || []), aplicacion];
    tx.update(ref, { aplicaciones: nuevas });
    return nuevas;
  });
  actualizarEnMemoria(saldoId, { aplicaciones });
  await registrarHistorial(saldoId, 'aplicacion', null, aplicacion, folio ? `Aplicado a ${folio}` : '');
  return aplicacion;
}

async function quitarAplicacion(saldoId, cobroId) {
  const ref = window.db.collection(window.COLECCIONES.SALDOS_CLIENTE).doc(saldoId);
  let quitadas = [];
  const aplicaciones = await window.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error('El saldo a favor ya no existe.');
    const todas = snap.data().aplicaciones || [];
    quitadas = todas.filter((a) => a.cobroId === cobroId);
    if (quitadas.length === 0) throw new Error('Este saldo no tiene una aplicación ligada a ese cobro.');
    const restantes = todas.filter((a) => a.cobroId !== cobroId);
    tx.update(ref, { aplicaciones: restantes });
    return restantes;
  });
  actualizarEnMemoria(saldoId, { aplicaciones });
  await registrarHistorial(saldoId, 'quitar_aplicacion', quitadas, null, `Cobro ${cobroId} revertido`);
  return quitadas;
}

// Revierte (revertido: true, no borra) los saldos nacidos de un grupo de pago, solo si no tienen aplicaciones.
// Devuelve { ok: true, revertidos } o { ok: false, error }.
async function revertirSaldoPorGrupo(grupoPagoId, motivo) {
  if (!grupoPagoId) return { ok: true, revertidos: 0 };
  const coleccion = window.COLECCIONES.SALDOS_CLIENTE;
  const consulta = await window.db.collection(coleccion).where('grupoPagoId', '==', grupoPagoId).get();
  const ids = consulta.docs.map((d) => d.id);
  const revertidos = [];
  for (const id of ids) {
    const ref = window.db.collection(coleccion).doc(id);
    try {
      const cambios = await window.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const actual = snap.data();
        if (actual.revertido) return null;
        if ((actual.aplicaciones || []).length > 0) throw new Error(MSG_YA_APLICADO);
        const nuevos = {
          revertido: true,
          revertidoMotivo: motivo || '',
          fechaReversion: new Date().toISOString(),
          revertidoPor: (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema'
        };
        tx.update(ref, nuevos);
        return nuevos;
      });
      if (cambios) {
        actualizarEnMemoria(id, cambios);
        revertidos.push(id);
        await registrarHistorial(id, 'reversion', { revertido: false }, cambios, motivo || '');
      }
    } catch (error) {
      return { ok: false, error: error.message, revertidos };
    }
  }
  return { ok: true, revertidos: revertidos.length };
}

window.EVE_SALDOS_CLIENTE = {
  normalizarCliente,
  crearSaldoCliente,
  saldoDisponible,
  saldoPorCliente,
  aplicarSaldoCliente,
  quitarAplicacion,
  revertirSaldoPorGrupo
};

})();
