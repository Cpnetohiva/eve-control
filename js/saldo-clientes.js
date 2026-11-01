(function () {

// Saldo a favor de clientes: replica el de proveedores de CxP (js/cxp.js) sobre la colección `clientes`.
// Un documento por cliente (id = nombre normalizado) con saldoAFavor[]: { revertido, monto, fecha, motivo, grupoPagoId }.
// Anticipo = monto positivo; aplicación a una cuenta = monto negativo. Los movimientos que escriben leen primero el
// documento fresco de Firestore dentro de una transacción (hay concurrencia): la memoria solo se actualiza después.

const COLECCION = 'clientes';
const MENSAJE_ANTICIPO_CONSUMIDO = 'Este anticipo ya fue aplicado a otra cuenta. Revierte primero ese abono y vuelve a intentar.';

function usuarioActual() {
  return (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function claveCliente(valor) {
  return window.normalizarCliente(valor);
}

function totalSaldoAFavorCliente(saldoAFavor) {
  return window.EVE_CXP.totalSaldoAFavor(saldoAFavor);
}

function movimientosDeCliente(cliente) {
  return cliente && Array.isArray(cliente.saldoAFavor) ? cliente.saldoAFavor : [];
}

function clienteEnMemoria(nombre) {
  const clave = claveCliente(nombre);
  return (window.EVE.clientes || []).find((c) => c.nombre === clave) || null;
}

function saldoAFavorDisponibleCliente(nombre) {
  const registro = clienteEnMemoria(nombre);
  return Math.round(totalSaldoAFavorCliente(registro && registro.saldoAFavor) * 100) / 100;
}

function actualizarClienteEnMemoria(nombre, saldoAFavor) {
  if (!window.EVE.clientes) window.EVE.clientes = [];
  const existente = window.EVE.clientes.find((c) => c.nombre === nombre);
  const ahora = new Date().toISOString();
  if (existente) {
    existente.saldoAFavor = saldoAFavor;
    existente.ultimaActualizacion = ahora;
  } else {
    window.EVE.clientes.push({ id: nombre, nombre, saldoAFavor, ultimaActualizacion: ahora });
  }
}

function exigirEnLinea() {
  if (!navigator.onLine) throw new Error('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
}

function registrarHistorial(clave, accion, valorAnterior, valorNuevo, motivo) {
  return window.EVE_HISTORIAL.registrar({ coleccion: COLECCION, registroId: clave, accion, valorAnterior, valorNuevo, motivo });
}

function refCliente(nombreCliente) {
  return window.db.collection(COLECCION).doc(claveCliente(nombreCliente));
}

// Para quien ya está dentro de una transacción: `docCliente` es el resultado de tx.get(refCliente(...)), leído ANTES de
// cualquier escritura de la transacción. Solo escribe (tx.set); la memoria y el historial se confirman con confirmarAlta
// una vez que la transacción termina bien.
// `movimiento` puede ser uno o un arreglo (p. ej. una aplicación negativa por cada línea de una venta).
function agregarMovimientoEnTransaccion(tx, nombreCliente, docCliente, movimiento) {
  const clave = claveCliente(nombreCliente);
  if (!clave) throw new Error('El cliente es obligatorio.');
  const nuevos = (Array.isArray(movimiento) ? movimiento : [movimiento]).map((m) => ({ revertido: false, ...m }));
  const movimientos = [...movimientosDeCliente(docCliente.exists ? docCliente.data() : null), ...nuevos];
  tx.set(refCliente(clave), { nombre: clave, saldoAFavor: movimientos, ultimaActualizacion: new Date().toISOString() }, { merge: true });
  return { clave, nuevos, movimientos };
}

// Historial: un anticipo (positivo) es un alta; una aplicación (negativa) es una aplicación.
async function confirmarAlta({ clave, nuevos, movimientos }) {
  actualizarClienteEnMemoria(clave, movimientos);
  for (const nuevo of nuevos) {
    await registrarHistorial(clave, nuevo.monto < 0 ? 'aplicacion' : 'alta', null, nuevo, nuevo.motivo || '');
  }
  return movimientos;
}

// Agrega un movimiento al saldo del cliente. Lee el documento fresco dentro de la transacción.
async function guardarSaldoAFavorCliente(nombreCliente, movimiento) {
  exigirEnLinea();
  const ref = refCliente(nombreCliente);
  const resultado = await window.db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    return agregarMovimientoEnTransaccion(tx, nombreCliente, doc, movimiento);
  });
  return confirmarAlta(resultado);
}

// Marca como revertido el movimiento vigente de un grupoPagoId. Devuelve true si había uno.
async function revertirMovimientoSaldoAFavorClienteSiExiste(nombreCliente, grupoPagoId, motivo, revertidoPor) {
  if (!grupoPagoId) return false;
  exigirEnLinea();
  const clave = claveCliente(nombreCliente);
  const ref = window.db.collection(COLECCION).doc(clave);
  const resultado = await window.db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return null;
    const movimientos = movimientosDeCliente(doc.data());
    const indice = movimientos.findIndex((m) => m.grupoPagoId === grupoPagoId && !m.revertido);
    if (indice === -1) return null;
    const anterior = movimientos[indice];
    const revertido = {
      ...anterior,
      revertido: true,
      revertidoMotivo: motivo || null,
      revertidoPor: revertidoPor || usuarioActual(),
      fechaReversion: new Date().toISOString()
    };
    const siguientes = movimientos.map((m, i) => (i === indice ? revertido : m));
    tx.set(ref, { saldoAFavor: siguientes, ultimaActualizacion: new Date().toISOString() }, { merge: true });
    return { siguientes, anterior, revertido };
  });
  if (!resultado) return false;
  actualizarClienteEnMemoria(clave, resultado.siguientes);
  await registrarHistorial(clave, 'reversion', resultado.anterior, resultado.revertido, motivo || '');
  return true;
}

// Un anticipo (positivo) ya aplicado a otra cuenta no se puede revertir: el saldo vigente quedaría negativo.
// Solo valida (no escribe); lee el documento fresco. Se llama antes de cualquier escritura de la reversión.
async function validarAnticipoClienteNoConsumido(nombreCliente, grupoPagoId) {
  if (!grupoPagoId) return;
  const doc = await window.db.collection(COLECCION).doc(claveCliente(nombreCliente)).get();
  if (!doc.exists) return;
  const datos = doc.data();
  const movimiento = movimientosDeCliente(datos).find((m) => m.grupoPagoId === grupoPagoId && !m.revertido);
  if (!movimiento) return;
  const monto = Number(movimiento.monto) || 0;
  if (monto > 0 && totalSaldoAFavorCliente(datos.saldoAFavor) < monto - 0.01) {
    throw new Error(MENSAJE_ANTICIPO_CONSUMIDO);
  }
}

// Aplica a mano el saldo a favor vigente a CxC que ya existen. asignaciones: [{ id, monto }]. Por cada cuenta escribe un
// abono 'Saldo a favor aplicado' y un movimiento NEGATIVO en clientes.saldoAFavor con el mismo grupoPagoId. NO crea
// documento en cobros: el efectivo ya se contó con el anticipo. Una transacción con lecturas frescas: si algo no cuadra
// no se escribe nada.
async function aplicarSaldoAFavorACuentasCliente(nombreCliente, asignaciones) {
  exigirEnLinea();
  if (!window.puedeEscribir('cxc')) throw new Error('No tienes permiso para aplicar saldo a favor');
  const pedidas = Array.isArray(asignaciones) ? asignaciones : [];
  if (pedidas.length === 0) throw new Error('Selecciona al menos una cuenta');
  if (new Set(pedidas.map((a) => a.id)).size !== pedidas.length) throw new Error('Una cuenta aparece más de una vez');
  if (pedidas.some((a) => !(Number(a.monto) > 0))) throw new Error('Cada monto a aplicar debe ser mayor a 0');

  const clave = claveCliente(nombreCliente);
  const refCliente = window.db.collection(COLECCION).doc(clave);
  const fecha = window.obtenerFechaMexico();
  const registradoPor = usuarioActual();
  const resultado = await window.db.runTransaction(async (tx) => {
    const docCliente = await tx.get(refCliente);
    const refs = pedidas.map((a) => window.db.collection('cuentas_por_cobrar').doc(a.id));
    const docsCuentas = await Promise.all(refs.map((ref) => tx.get(ref)));
    if (!docCliente.exists) throw new Error('El cliente no tiene saldo a favor');
    const datosCliente = docCliente.data();

    const planes = docsCuentas.map((docCuenta, i) => {
      if (!docCuenta.exists) throw new Error('Una de las cuentas ya no existe. Recarga la página.');
      const cuenta = { id: docCuenta.id, ...docCuenta.data() };
      if (claveCliente(cuenta.cliente) !== clave) throw new Error(`La cuenta del folio ${cuenta.folio} no es de ${clave}`);
      if (cuenta.saldo <= 0.01) throw new Error(`La cuenta del folio ${cuenta.folio} ya no tiene saldo`);
      const solicitado = Number(pedidas[i].monto);
      if (solicitado > cuenta.saldo + 0.01) {
        throw new Error(`El monto para el folio ${cuenta.folio} excede su saldo (${window.formatearMoneda(cuenta.saldo)})`);
      }
      return { cuenta, monto: Math.min(solicitado, cuenta.saldo), grupoPagoId: window.EVE_CXP.generarGrupoPagoId(), abonoId: window.EVE_CXP.generarAbonoId() };
    });
    const disponible = totalSaldoAFavorCliente(datosCliente.saldoAFavor);
    const total = planes.reduce((acc, p) => acc + p.monto, 0);
    if (total > disponible + 0.01) {
      throw new Error(`El total a aplicar (${window.formatearMoneda(total)}) excede el saldo a favor disponible (${window.formatearMoneda(disponible)})`);
    }

    const nuevosMovimientos = planes.map((p) => ({
      revertido: false,
      monto: -p.monto,
      fecha,
      motivo: `Aplicado manualmente a la CxC del folio ${p.cuenta.folio}`,
      grupoPagoId: p.grupoPagoId
    }));
    const movimientos = [...movimientosDeCliente(datosCliente), ...nuevosMovimientos];
    const cambiosCuentas = planes.map((p) => {
      const abono = {
        monto: p.monto,
        fecha,
        referencia: 'Saldo a favor aplicado',
        registradoPor,
        fechaRegistro: new Date().toISOString(),
        grupoPagoId: p.grupoPagoId,
        abonoId: p.abonoId
      };
      return window.EVE_CXP.aplicarAbono({ ...p.cuenta, abonos: p.cuenta.abonos || [] }, abono);
    });
    tx.set(refCliente, { saldoAFavor: movimientos, ultimaActualizacion: new Date().toISOString() }, { merge: true });
    cambiosCuentas.forEach((cambios, i) => tx.update(refs[i], cambios));
    return { movimientos, cambiosCuentas, nuevosMovimientos, total };
  });

  actualizarClienteEnMemoria(clave, resultado.movimientos);
  pedidas.forEach((a, i) => {
    const enMemoria = (window.EVE.cuentasPorCobrar || []).find((c) => c.id === a.id);
    if (enMemoria) Object.assign(enMemoria, resultado.cambiosCuentas[i]);
  });
  for (const mov of resultado.nuevosMovimientos) {
    await registrarHistorial(clave, 'aplicacion', null, mov, mov.motivo);
  }
  return { aplicado: resultado.total };
}

window.EVE_SALDO_CLIENTES = {
  claveCliente,
  totalSaldoAFavorCliente,
  movimientosDeCliente,
  clienteEnMemoria,
  saldoAFavorDisponibleCliente,
  refCliente,
  agregarMovimientoEnTransaccion,
  confirmarAlta,
  guardarSaldoAFavorCliente,
  revertirMovimientoSaldoAFavorClienteSiExiste,
  validarAnticipoClienteNoConsumido,
  aplicarSaldoAFavorACuentasCliente,
  MENSAJE_ANTICIPO_CONSUMIDO
};

})();
