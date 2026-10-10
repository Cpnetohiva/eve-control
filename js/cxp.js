(function () {

function fechaCorteVigente() {
  return (window.EVE && window.EVE.fechaCorteAuditoria) || '2026-07-01';
}

function calcularCxP(registro, precioInfo, comisionPorKg) {
  const kg = Number(registro.kg) || 0;
  const precioAplicado = precioInfo.precio;
  const comision = Number(comisionPorKg) || 0;
  const precioEfectivo = precioAplicado + comision;
  const montoMaterial = kg * precioAplicado;
  const montoComision = kg * comision;
  const total = montoMaterial + montoComision;
  return {
    precioAplicado,
    comisionPorKg: comision,
    precioEfectivo,
    montoMaterial,
    montoComision,
    total
  };
}

function calcularEstado(pagado, saldo) {
  if (saldo <= 0.001) return 'liquidado';
  if (pagado > 0) return 'parcial';
  return 'pendiente';
}

function yaExisteCxP(cuentasPorPagar, ticket) {
  return cuentasPorPagar.some((c) => String(c.ticket) === String(ticket));
}

function construirDocCxP(registro, precioInfo, comisionPorKg, aprobacion, origenAuditoria, idAuditoria, idFotoAuditoria, usuario) {
  const calculo = calcularCxP(registro, precioInfo, comisionPorKg);
  return {
    ticket: registro.ticket,
    proveedor: registro.proveedor,
    material: registro.material,
    kg: Number(registro.kg) || 0,
    fechaTicket: registro.fechaEntrada,
    ...calculo,
    precioBase: precioInfo.precioBase !== undefined ? precioInfo.precioBase : precioInfo.precio,
    ajusteProveedorAplicado: precioInfo.ajusteProveedorAplicado || null,
    pagado: 0,
    saldo: calculo.total,
    iva: 0,
    estado: 'pendiente',
    origenAuditoria: !!origenAuditoria,
    idAuditoria: idAuditoria || null,
    idFotoAuditoria: idFotoAuditoria || null,
    aprobacion,
    abonos: [],
    precioNegociado: null,
    motivoAjustePrecio: null,
    creadoPor: usuario
  };
}

function generarGrupoPagoId() {
  return `pago_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function generarAbonoId() {
  return `abono_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function movimientosSaldoAFavor(proveedor) {
  return proveedor && Array.isArray(proveedor.saldoAFavor) ? proveedor.saldoAFavor : [];
}

function totalSaldoAFavor(saldoAFavor) {
  const movimientos = Array.isArray(saldoAFavor) ? saldoAFavor : [];
  return movimientos.filter((m) => !m.revertido).reduce((acc, m) => acc + (Number(m.monto) || 0), 0);
}

function aplicarSaldoAFavor(proveedor, docCxP) {
  const saldoDisponible = totalSaldoAFavor(proveedor && proveedor.saldoAFavor);
  if (saldoDisponible <= 0) {
    return { docCxP, aplicado: 0, grupoPagoId: null };
  }
  const aplicado = Math.min(saldoDisponible, docCxP.saldo);
  const pagado = docCxP.pagado + aplicado;
  const saldo = docCxP.saldo - aplicado;
  const grupoPagoId = generarGrupoPagoId();
  const abono = {
    monto: aplicado,
    fecha: window.obtenerFechaMexico(),
    referencia: 'Saldo a favor aplicado automáticamente',
    registradoPor: 'Sistema',
    fechaRegistro: new Date().toISOString(),
    grupoPagoId,
    abonoId: generarAbonoId()
  };
  const docActualizado = {
    ...docCxP,
    pagado,
    saldo,
    estado: calcularEstado(pagado, saldo),
    abonos: [...docCxP.abonos, abono]
  };
  return { docCxP: docActualizado, aplicado, grupoPagoId };
}

// campo: nombre del campo por el que se agrupa ('proveedor' en CxP, 'cliente' en CxC).
function agregarPorClave(cuentas, campo) {
  const mapa = new Map();
  cuentas.forEach((c) => {
    const clave = c[campo];
    if (!mapa.has(clave)) {
      mapa.set(clave, { [campo]: clave, total: 0, pagado: 0, saldo: 0, cuentas: [] });
    }
    const acc = mapa.get(clave);
    acc.total += c.total;
    acc.pagado += c.pagado;
    acc.saldo += c.saldo;
    acc.cuentas.push(c);
  });
  return Array.from(mapa.values()).sort((a, b) => a[campo].localeCompare(b[campo]));
}

function agregarPorProveedorCxP(cuentas) {
  return agregarPorClave(cuentas, 'proveedor');
}

// opciones: { campoFecha, campoEntidad } — permite reusar el mismo filtro en CxC
// (campoFecha: 'fechaVenta', campoEntidad: 'cliente').
function filtrarGenerico(cuentas, filtros, opciones) {
  const campoFecha = (opciones && opciones.campoFecha) || 'fechaTicket';
  const campoEntidad = (opciones && opciones.campoEntidad) || 'proveedor';
  return cuentas.filter((c) => {
    if (filtros.desde && c[campoFecha] < filtros.desde) return false;
    if (filtros.hasta && c[campoFecha] > filtros.hasta) return false;
    if (filtros[campoEntidad] && c[campoEntidad] !== filtros[campoEntidad].toUpperCase()) return false;
    if (filtros.material && window.normalizarMaterial(c.material) !== window.normalizarMaterial(filtros.material)) return false;
    if (filtros.estado && c.estado !== filtros.estado) return false;
    return true;
  });
}

function filtrarCxP(cuentas, filtros) {
  return filtrarGenerico(cuentas, filtros, { campoFecha: 'fechaTicket', campoEntidad: 'proveedor' });
}

// CxP paga a proveedores en ciclos sábado→viernes (no domingo→sábado como el resto del sistema).
// "Esta Semana" toma el viernes más reciente <= hoy como fin de corte y el sábado 6 días antes como inicio.
function calcularCorteSemanalCxP(fechaHoy) {
  const hoy = new Date(`${fechaHoy}T00:00:00`);
  const diasDesdeViernes = (hoy.getDay() - 5 + 7) % 7;
  const fin = new Date(hoy);
  fin.setDate(fin.getDate() - diasDesdeViernes);
  const inicio = new Date(fin);
  inicio.setDate(inicio.getDate() - 6);
  const formatear = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { inicio: formatear(inicio), fin: formatear(fin) };
}

function calcularRangoPeriodoCxP(periodo, rango) {
  const hoy = window.obtenerFechaMexico();
  if (periodo === 'hoy') return { desde: hoy, hasta: hoy };
  if (periodo === 'semana') {
    const { inicio, fin } = calcularCorteSemanalCxP(hoy);
    return { desde: inicio, hasta: fin };
  }
  if (periodo === 'mes') return { desde: hoy.slice(0, 7) + '-01', hasta: null };
  if (periodo === 'rango') return { desde: (rango && rango.desde) || null, hasta: (rango && rango.hasta) || null };
  return { desde: null, hasta: null };
}

function listarPendientesSinAuditar(registrosDestaraje, cuentasPorPagar, auditorias) {
  const coincideSet = new Set();
  (auditorias || []).forEach((a) => {
    (a.resultados || []).forEach((r) => {
      if (r.estado === 'COINCIDE') coincideSet.add(String(r.ticket));
    });
  });
  return registrosDestaraje.filter((r) =>
    r.ticket !== 'V' &&
    r.fechaEntrada >= fechaCorteVigente() &&
    !yaExisteCxP(cuentasPorPagar, r.ticket) &&
    !coincideSet.has(String(r.ticket))
  );
}

// campoFecha: campo usado para ordenar FIFO ('fechaTicket' en CxP, 'fechaVenta' en CxC).
function distribuirPago(cuentasProveedor, monto, fecha, referencia, registradoPor, campoFecha) {
  const campo = campoFecha || 'fechaTicket';
  const ordenadas = cuentasProveedor
    .filter((c) => c.saldo > 0)
    .slice()
    .sort((a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0));
  let restante = Number(monto) || 0;
  const actualizaciones = [];
  ordenadas.forEach((cuenta) => {
    if (restante <= 0) return;
    const abonoMonto = Math.min(cuenta.saldo, restante);
    const pagado = cuenta.pagado + abonoMonto;
    const saldo = cuenta.saldo - abonoMonto;
    actualizaciones.push({
      id: cuenta.id,
      pagado,
      saldo,
      estado: calcularEstado(pagado, saldo),
      abono: { monto: abonoMonto, fecha, referencia, registradoPor, fechaRegistro: new Date().toISOString(), abonoId: generarAbonoId() }
    });
    restante -= abonoMonto;
  });
  return { actualizaciones, sobrante: restante };
}

function aplicarAbono(cxp, abono) {
  const pagado = cxp.pagado + abono.monto;
  const saldo = Math.max(0, cxp.saldo - abono.monto);
  return {
    pagado,
    saldo,
    estado: calcularEstado(pagado, saldo),
    abonos: [...cxp.abonos, abono]
  };
}

window.EVE_CXP = {
  fechaCorteVigente,
  calcularCxP,
  calcularEstado,
  yaExisteCxP,
  construirDocCxP,
  aplicarSaldoAFavor,
  agregarPorProveedorCxP,
  agregarPorClave,
  filtrarCxP,
  filtrarGenerico,
  listarPendientesSinAuditar,
  distribuirPago,
  aplicarAbono,
  generarGrupoPagoId,
  generarAbonoId,
  calcularCorteSemanalCxP,
  calcularRangoPeriodoCxP
};

function usuarioActual() {
  return (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function insertarCxPEnMemoria(id, doc) {
  window.EVE.cuentasPorPagar.push({ id, ...doc, fechaRegistro: new Date().toISOString() });
}

function actualizarProveedorEnMemoria(nombre, saldoAFavor) {
  const existente = window.EVE.proveedores.find((p) => p.nombre === nombre);
  if (existente) {
    existente.saldoAFavor = saldoAFavor;
    existente.ultimaActualizacion = new Date().toISOString();
  } else {
    window.EVE.proveedores.push({ id: nombre, nombre, saldoAFavor, ultimaActualizacion: new Date().toISOString() });
  }
}

async function guardarSaldoAFavor(nombreProveedor, movimiento) {
  const proveedorActual = window.EVE.proveedores.find((p) => p.nombre === nombreProveedor);
  const movimientos = [...movimientosSaldoAFavor(proveedorActual), { revertido: false, ...movimiento }];
  await window.db.collection('proveedores').doc(nombreProveedor).set({
    nombre: nombreProveedor,
    saldoAFavor: movimientos,
    ultimaActualizacion: new Date().toISOString()
  }, { merge: true });
  actualizarProveedorEnMemoria(nombreProveedor, movimientos);
}

async function revertirMovimientoSaldoAFavorSiExiste(nombreProveedor, grupoPagoId, motivo, revertidoPor) {
  if (!grupoPagoId) return;
  const proveedorActual = window.EVE.proveedores.find((p) => p.nombre === nombreProveedor);
  const movimientos = movimientosSaldoAFavor(proveedorActual);
  const indice = movimientos.findIndex((m) => m.grupoPagoId === grupoPagoId && !m.revertido);
  if (indice === -1) return;
  const movimientosActualizados = movimientos.map((m, i) => (i === indice ? {
    ...m,
    revertido: true,
    revertidoMotivo: motivo || null,
    revertidoPor: revertidoPor || null,
    fechaReversion: new Date().toISOString()
  } : m));
  await window.db.collection('proveedores').doc(nombreProveedor).set({
    saldoAFavor: movimientosActualizados,
    ultimaActualizacion: new Date().toISOString()
  }, { merge: true });
  actualizarProveedorEnMemoria(nombreProveedor, movimientosActualizados);
}

// Un anticipo (saldo a favor positivo) ya aplicado a otra cuenta no se puede revertir: el saldo vigente del proveedor
// quedaría negativo. Solo valida (no escribe); se llama antes de cualquier escritura de la reversión.
function validarAnticipoNoConsumido(nombreProveedor, grupoPagoId) {
  if (!grupoPagoId) return;
  const proveedorActual = window.EVE.proveedores.find((p) => p.nombre === nombreProveedor);
  const movimiento = movimientosSaldoAFavor(proveedorActual).find((m) => m.grupoPagoId === grupoPagoId && !m.revertido);
  if (!movimiento) return;
  const monto = Number(movimiento.monto) || 0;
  if (monto > 0 && totalSaldoAFavor(proveedorActual.saldoAFavor) < monto - 0.01) {
    throw new Error('Este anticipo ya fue aplicado a otra cuenta. Revierte primero ese abono y vuelve a intentar.');
  }
}

async function generarYGuardarCxP(registro, aprobacion, origenAuditoria, idAuditoria, idFotoAuditoria) {
  const precioInfo = window.obtenerPrecioVigente(registro.material, registro.fechaEntrada, registro.proveedor);
  if (!precioInfo) {
    throw new Error(`Sin precio vigente para "${registro.material}" en la fecha ${window.formatearFecha(registro.fechaEntrada)}`);
  }
  const comisionPorKg = window.obtenerComisionVigente(registro.fechaEntrada);
  let doc = construirDocCxP(registro, precioInfo, comisionPorKg, aprobacion, origenAuditoria, idAuditoria, idFotoAuditoria, usuarioActual());

  const proveedor = window.EVE.proveedores.find((p) => p.nombre === registro.proveedor);
  const { docCxP, aplicado, grupoPagoId } = aplicarSaldoAFavor(proveedor, doc);
  doc = docCxP;
  if (aplicado > 0) {
    await guardarSaldoAFavor(registro.proveedor, {
      monto: -aplicado,
      fecha: window.obtenerFechaMexico(),
      motivo: `Aplicado automáticamente a CxP del ticket ${registro.ticket}`,
      grupoPagoId
    });
  }

  const id = await window.guardarDato('cuentas_por_pagar', doc);
  insertarCxPEnMemoria(id, doc);
  return id;
}

async function generarCxPDesdeAuditoria(resultados, idAuditoria) {
  let generadas = 0;
  const omitidas = [];
  for (const r of resultados) {
    if (r.estado !== 'COINCIDE') continue;
    if (!r.registro) {
      omitidas.push({ ticket: r.ticket, motivo: 'Sin registro de Báscula vinculado' });
      continue;
    }
    if (yaExisteCxP(window.EVE.cuentasPorPagar, r.registro.ticket)) {
      omitidas.push({ ticket: r.ticket, motivo: 'Ya existe una cuenta por pagar para este ticket' });
      continue;
    }
    try {
      const aprobacion = { tipo: 'foto', motivo: null, aprobadoPor: usuarioActual(), fecha: window.obtenerFechaMexico() };
      await generarYGuardarCxP(r.registro, aprobacion, true, idAuditoria, r.idFotoAuditoria);
      generadas++;
    } catch (error) {
      omitidas.push({ ticket: r.ticket, material: r.registro.material, motivo: error.message });
    }
  }
  return { generadas, omitidas };
}

async function generarCxPSinFoto() {
  let generadas = 0;
  const omitidas = [];
  const candidatos = window.EVE.registrosDestaraje.filter((r) =>
    r.ticket !== 'V' &&
    r.fechaEntrada < fechaCorteVigente() &&
    !yaExisteCxP(window.EVE.cuentasPorPagar, r.ticket)
  );
  for (const registro of candidatos) {
    try {
      const aprobacion = { tipo: 'sin_foto_anterior_corte', motivo: null, aprobadoPor: usuarioActual(), fecha: window.obtenerFechaMexico() };
      await generarYGuardarCxP(registro, aprobacion, false, null, null);
      generadas++;
    } catch (error) {
      omitidas.push({ ticket: registro.ticket, material: registro.material, motivo: error.message });
    }
  }
  return { generadas, omitidas };
}

async function aprobarManualmente(registro, motivo) {
  const aprobacion = { tipo: 'manual', motivo, aprobadoPor: usuarioActual(), fecha: window.obtenerFechaMexico() };
  return generarYGuardarCxP(registro, aprobacion, false, null, null);
}

async function actualizarAbonoCxP(cxpId, abono) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  const cambios = aplicarAbono(cxp, { ...abono, abonoId: generarAbonoId() });
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
}

async function revertirPagosSiExiste(grupoPagoId, ticket, motivo) {
  if (!grupoPagoId) return;
  // El anticipo no tiene ticket (ticket: ''), así que se revierte siempre con su grupo, sin importar el ticket recibido.
  // Con ticket null solo se revierten los anticipos del grupo: los pagos de tickets conservan su abono activo en CxP.
  const coincidencias = window.EVE.registrosPagos.filter((p) =>
    p.grupoPagoId === grupoPagoId && !p.revertido
      && (p.origen === 'anticipo' || (ticket !== null && String(p.ticket) === String(ticket)))
  );
  for (const registro of coincidencias) {
    const cambios = { revertido: true, revertidoMotivo: motivo, fechaReversion: new Date().toISOString() };
    await window.actualizarDato('pagos', registro.id, cambios);
    Object.assign(registro, cambios);
  }
}

async function revertirAbono(cxpId, abonoId, motivo, revertidoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  const abono = cxp.abonos.find((a) => a.abonoId === abonoId);
  if (!abono) throw new Error('Este abono no tiene un identificador válido y no puede revertirse (dato anterior al fix de reversión).');
  validarAnticipoNoConsumido(cxp.proveedor, abono.grupoPagoId);
  const abonos = cxp.abonos.filter((a) => a.abonoId !== abonoId);
  const pagado = abonos.reduce((acc, a) => acc + (Number(a.monto) || 0), 0);
  const saldo = cxp.total - pagado;
  const estado = calcularEstado(pagado, saldo);
  const abonoRevertido = { ...abono, motivo, revertidoPor, fechaReversion: new Date().toISOString() };
  const abonosRevertidos = [...(cxp.abonosRevertidos || []), abonoRevertido];
  const cambios = { abonos, abonosRevertidos, pagado, saldo, estado };
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
  if (abono.grupoPagoId) {
    await revertirMovimientoSaldoAFavorSiExiste(cxp.proveedor, abono.grupoPagoId, motivo, revertidoPor);
    await revertirPagosSiExiste(abono.grupoPagoId, cxp.ticket, motivo);
  }
}

// Aplica a mano el saldo a favor vigente a cuentas que ya existen. asignaciones: [{ id, monto }]. Por cada cuenta escribe un
// abono 'Saldo a favor aplicado' y un movimiento NEGATIVO en proveedores.saldoAFavor con el mismo grupoPagoId (uno por cuenta,
// así revertir un abono devuelve exactamente su monto). NO crea documento en pagos: el efectivo ya se contó con el anticipo.
// Todo ocurre en una transacción con lecturas frescas: si algo no cuadra no se escribe nada.
async function aplicarSaldoAFavorACuentas(proveedor, asignaciones) {
  if (!navigator.onLine) throw new Error('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
  if (!window.puedeEscribir('cxp')) throw new Error('No tienes permiso para aplicar saldo a favor');
  const pedidas = Array.isArray(asignaciones) ? asignaciones : [];
  if (pedidas.length === 0) throw new Error('Selecciona al menos una cuenta');
  if (new Set(pedidas.map((a) => a.id)).size !== pedidas.length) throw new Error('Una cuenta aparece más de una vez');
  if (pedidas.some((a) => !(Number(a.monto) > 0))) throw new Error('Cada monto a aplicar debe ser mayor a 0');

  const refProveedor = window.db.collection('proveedores').doc(proveedor);
  const fecha = window.obtenerFechaMexico();
  const registradoPor = usuarioActual();
  const resultado = await window.db.runTransaction(async (tx) => {
    const docProveedor = await tx.get(refProveedor);
    const refs = pedidas.map((a) => window.db.collection('cuentas_por_pagar').doc(a.id));
    const docsCuentas = await Promise.all(refs.map((ref) => tx.get(ref)));
    if (!docProveedor.exists) throw new Error('El proveedor no tiene saldo a favor');
    const datosProveedor = docProveedor.data();

    const planes = docsCuentas.map((docCuenta, i) => {
      if (!docCuenta.exists) throw new Error('Una de las cuentas ya no existe. Recarga la página.');
      const cuenta = { id: docCuenta.id, ...docCuenta.data() };
      if (cuenta.proveedor !== proveedor) throw new Error(`La cuenta del ticket ${cuenta.ticket} no es de ${proveedor}`);
      if (cuenta.saldo <= 0.01) throw new Error(`La cuenta del ticket ${cuenta.ticket} ya no tiene saldo`);
      const solicitado = Number(pedidas[i].monto);
      if (solicitado > cuenta.saldo + 0.01) {
        throw new Error(`El monto para el ticket ${cuenta.ticket} excede su saldo (${window.formatearMoneda(cuenta.saldo)})`);
      }
      return { cuenta, monto: Math.min(solicitado, cuenta.saldo), grupoPagoId: generarGrupoPagoId(), abonoId: generarAbonoId() };
    });
    const disponible = totalSaldoAFavor(datosProveedor.saldoAFavor);
    const total = planes.reduce((acc, p) => acc + p.monto, 0);
    if (total > disponible + 0.01) {
      throw new Error(`El total a aplicar (${window.formatearMoneda(total)}) excede el saldo a favor disponible (${window.formatearMoneda(disponible)})`);
    }

    const movimientos = [
      ...movimientosSaldoAFavor(datosProveedor),
      ...planes.map((p) => ({
        revertido: false,
        monto: -p.monto,
        fecha,
        motivo: `Aplicado manualmente a CxP del ticket ${p.cuenta.ticket}`,
        grupoPagoId: p.grupoPagoId
      }))
    ];
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
      return aplicarAbono({ ...p.cuenta, abonos: p.cuenta.abonos || [] }, abono);
    });
    tx.update(refProveedor, { saldoAFavor: movimientos, ultimaActualizacion: new Date().toISOString() });
    cambiosCuentas.forEach((cambios, i) => tx.update(refs[i], cambios));
    return { movimientos, cambiosCuentas, total };
  });

  actualizarProveedorEnMemoria(proveedor, resultado.movimientos);
  pedidas.forEach((a, i) => {
    const enMemoria = window.EVE.cuentasPorPagar.find((c) => c.id === a.id);
    if (enMemoria) Object.assign(enMemoria, resultado.cambiosCuentas[i]);
  });
  return { aplicado: resultado.total };
}

function recalcularMontosCxP(kg, precioBase, comisionPorKg, iva) {
  const precioEfectivo = precioBase + comisionPorKg;
  const montoMaterial = kg * precioBase;
  const montoComision = kg * comisionPorKg;
  const total = montoMaterial + montoComision + (Number(iva) || 0);
  return { precioEfectivo, montoMaterial, montoComision, total, saldo: total };
}

async function verificarSinPagosFrescos(cxp) {
  const docFresco = await window.db.collection('cuentas_por_pagar').doc(cxp.id).get();
  if (!docFresco.exists) {
    throw new Error('Esta cuenta ya no existe — probablemente fue eliminada. Recarga la página.');
  }
  Object.assign(cxp, docFresco.data());
  if (cxp.pagado > 0) {
    throw new Error('Esta cuenta recibió un pago mientras se editaba, desde otra sesión. Se actualizó con el dato más reciente — revierte los abonos primero si necesitas hacer este cambio.');
  }
}

async function ajustarPrecioCxP(cxpId, precioNegociado, motivo, ajustadoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  await verificarSinPagosFrescos(cxp);
  const kg = Number(cxp.kg) || 0;
  const comision = Number(cxp.comisionPorKg) || 0;
  const precioBase = precioNegociado !== null ? Number(precioNegociado) : cxp.precioAplicado;
  const cambios = {
    precioNegociado: precioNegociado !== null ? Number(precioNegociado) : null,
    motivoAjustePrecio: precioNegociado !== null ? motivo : null,
    ...recalcularMontosCxP(kg, precioBase, comision, cxp.iva)
  };
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
}

async function ajustarIvaCxP(cxpId, iva, ajustadoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  await verificarSinPagosFrescos(cxp);
  const ivaNum = Number(iva) || 0;
  if (!Number.isFinite(ivaNum) || ivaNum < 0) {
    throw new Error('El IVA debe ser un número mayor o igual a 0');
  }
  const kg = Number(cxp.kg) || 0;
  const comision = Number(cxp.comisionPorKg) || 0;
  const precioBase = cxp.precioNegociado !== null && cxp.precioNegociado !== undefined ? Number(cxp.precioNegociado) : cxp.precioAplicado;
  const cambios = {
    iva: ivaNum,
    ...recalcularMontosCxP(kg, precioBase, comision, ivaNum)
  };
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
}

async function editarMaterialCxP(cxpId, materialNuevo, motivo, editadoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  await verificarSinPagosFrescos(cxp);
  const materialUpper = (materialNuevo || '').toString().trim().toUpperCase();
  if (!materialUpper) {
    throw new Error('El material es obligatorio');
  }
  if (window.normalizarMaterial(materialUpper) === window.normalizarMaterial(cxp.material)) {
    throw new Error('El material nuevo debe ser distinto al actual');
  }
  const precioInfo = window.obtenerPrecioVigente(materialUpper, cxp.fechaTicket, cxp.proveedor);
  if (!precioInfo) {
    throw new Error(`No hay precio vigente para ${materialUpper} en la fecha del ticket (${window.formatearFecha(cxp.fechaTicket)})`);
  }
  const kg = Number(cxp.kg) || 0;
  const comision = Number(cxp.comisionPorKg) || 0;
  const cambios = {
    material: materialUpper,
    materialAnterior: cxp.material,
    motivoAjusteMaterial: motivo,
    precioAplicado: precioInfo.precio,
    precioBase: precioInfo.precioBase !== undefined ? precioInfo.precioBase : precioInfo.precio,
    ajusteProveedorAplicado: precioInfo.ajusteProveedorAplicado || null,
    precioNegociado: null,
    motivoAjustePrecio: null,
    ...recalcularMontosCxP(kg, precioInfo.precio, comision, cxp.iva)
  };
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
}

// ── Corrección de kg entre Báscula (Destaraje) y CxP ─────────────────────────────────────────────────────────────────────
// Regla común: una CxP solo se corrige si no tiene abonos activos. El saldo a favor aplicado (aplicarSaldoAFavor) se guarda
// como un abono más de la cuenta (referencia "Saldo a favor aplicado automáticamente"), así que también la bloquea: al
// revertir ese abono el monto regresa al saldo a favor del proveedor y la cuenta vuelve a ser editable.
const MENSAJE_CXP_CON_ABONOS = 'Revierte los abonos de la CxP primero';
const MOTIVO_CORRECCION_KG_BASCULA = 'Corrección de peso en Báscula';

function esCxPSaldoInicial(cxp) {
  return !!(cxp && cxp.aprobacion && cxp.aprobacion.tipo === 'saldo_inicial');
}

function tieneAbonosActivos(cxp) {
  return (Number(cxp.pagado) || 0) > 0 || (Array.isArray(cxp.abonos) && cxp.abonos.length > 0);
}

function validarKgCorreccion(kgNuevo) {
  const kg = Number(kgNuevo);
  if (kgNuevo === '' || kgNuevo === null || kgNuevo === undefined || !Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  return kg;
}

// Recalcula con el precio base y la comisión ya congelados en la cuenta (nunca consulta Precios); conserva el IVA.
// Con la cuenta sin abonos, saldo = total y el estado vuelve a calcularse (pendiente).
function calcularCorreccionKgCxP(cxp, kgNuevo, motivo) {
  const kg = validarKgCorreccion(kgNuevo);
  const comision = Number(cxp.comisionPorKg) || 0;
  const precioBase = cxp.precioNegociado !== null && cxp.precioNegociado !== undefined ? Number(cxp.precioNegociado) : Number(cxp.precioAplicado);
  if (!Number.isFinite(precioBase)) {
    throw new Error('Esta cuenta no tiene un precio congelado y no se puede recalcular el kg.');
  }
  const montos = recalcularMontosCxP(kg, precioBase, comision, cxp.iva);
  return {
    kg,
    kgAnterior: Number(cxp.kg) || 0,
    motivoAjusteKg: motivo,
    ...montos,
    pagado: 0,
    estado: calcularEstado(0, montos.saldo)
  };
}

// De varias filas con el mismo ticket + proveedor (ticket con renglones de varios materiales) elige la que corresponde a
// `ref` { material, kg }: primero por material, luego por kg. null si sigue habiendo ambigüedad.
function elegirFilaDelTicket(filas, ref) {
  if (filas.length <= 1) return filas[0] || null;
  const material = window.normalizarMaterial(ref.material);
  let candidatas = filas.filter((f) => window.normalizarMaterial(f.material) === material);
  if (candidatas.length === 1) return candidatas[0];
  if (candidatas.length === 0) candidatas = filas;
  const porKg = candidatas.filter((f) => Math.abs((Number(f.kg) || 0) - (Number(ref.kg) || 0)) <= 0.01);
  return porKg.length === 1 ? porKg[0] : null;
}

// Un ticket con proceso de Control Producción como origen, o con auditoría OCR que COINCIDE, sigue guardándose, pero se
// avisa: el kg nuevo no modifica el proceso ni el resultado de la auditoría.
function advertenciasCorreccionKg(ticket, kgNuevo, datos) {
  const advertencias = [];
  const procesos = ((datos && datos.registrosControlProduccion) || []).filter((p) =>
    (p.inputs || []).some((i) => String(i.ticketOrigen || '').trim() === String(ticket))
  );
  if (procesos.length > 0) {
    advertencias.push(`El ticket ${ticket} ya se usa como entrada en Control Producción (proceso ${procesos.map((p) => p.ticket).join(', ')}). `
      + 'El proceso NO se modifica: conservará el kg anterior.');
  }
  const coincide = ((datos && datos.auditorias) || []).some((a) =>
    (a.resultados || []).some((r) => r.estado === 'COINCIDE' && String(r.ticket) === String(ticket))
  );
  if (coincide) {
    advertencias.push(`El ticket ${ticket} tiene una auditoría OCR con resultado COINCIDE: el kg nuevo (${kgNuevo}) ya no coincide con la foto auditada. `
      + 'El resultado de la auditoría no cambia.');
  }
  return advertencias;
}

function exigirEscrituraCxP() {
  if (!window.puedeEscribir('cxp')) {
    throw new Error('Este ticket tiene una cuenta por pagar: corregir su kg requiere permiso de escritura en CxP.');
  }
}

// Reglas comunes de edición de kg sobre una cuenta (ya cargada fresca o en memoria). verificarSinPagosFrescos relee de
// Firestore y cubre la concurrencia: un abono registrado desde otra sesión también bloquea.
async function validarCxPEditableKg(cxp) {
  if (esCxPSaldoInicial(cxp)) {
    throw new Error('Esta cuenta es un saldo inicial histórico y no tiene kg aplicable.');
  }
  if (tieneAbonosActivos(cxp)) throw new Error(MENSAJE_CXP_CON_ABONOS);
  await verificarSinPagosFrescos(cxp);
  if (tieneAbonosActivos(cxp)) throw new Error(MENSAJE_CXP_CON_ABONOS);
}

async function consultarPorTicket(coleccion, ticket) {
  const snapshot = await window.db.collection(coleccion).where('ticket', '==', String(ticket)).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// PARTE 1 (lado Báscula): al editar el kg de un registro, busca la CxP del mismo ticket + proveedor. null si no existe
// (se guarda normal). Si existe y no se puede corregir, lanza el error que bloquea la edición. Devuelve el plan de
// escritura { cxp, cambios } y NO escribe: lo guarda guardarCorreccionKg junto con el registro de Báscula.
async function prepararCorreccionKgDesdeBascula(registroAnterior, kgNuevo) {
  const kg = validarKgCorreccion(kgNuevo);
  if (!window.puedeLeer('cxp')) {
    throw new Error('El kg de un ticket solo se corrige desde CxP. Avisa al responsable de CxP para que use Editar kg.');
  }
  const proveedor = window.normalizarProveedor(registroAnterior.proveedor);
  const cuentas = (await consultarPorTicket('cuentas_por_pagar', registroAnterior.ticket))
    .filter((c) => window.normalizarProveedor(c.proveedor) === proveedor);
  if (cuentas.length === 0) return null;
  const cxp = elegirFilaDelTicket(cuentas, registroAnterior);
  if (!cxp) {
    throw new Error(`El ticket ${registroAnterior.ticket} tiene varias cuentas por pagar: corrige el kg desde CxP.`);
  }
  exigirEscrituraCxP();
  await validarCxPEditableKg(cxp);
  const cambios = calcularCorreccionKgCxP(cxp, kg, MOTIVO_CORRECCION_KG_BASCULA);
  return { cxp, cambios };
}

// Escribe en un solo lote la CxP y el registro de Báscula para que no queden dos valores distintos.
async function guardarCorreccionKg({ cxp, cambiosCxP, basculaId, cambiosBascula }) {
  if (!navigator.onLine) throw new Error('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
  const lote = window.db.batch();
  lote.update(window.db.collection('cuentas_por_pagar').doc(cxp.id), cambiosCxP);
  if (basculaId) lote.update(window.db.collection('destaraje').doc(basculaId), cambiosBascula);
  await lote.commit();
  const totalAnterior = cxp.total;
  const enMemoria = window.EVE.cuentasPorPagar.find((c) => c.id === cxp.id);
  Object.assign(enMemoria || cxp, cambiosCxP);
  window.EVE_HISTORIAL.registrar({
    coleccion: 'cuentas_por_pagar',
    registroId: cxp.id,
    accion: 'edicion',
    valorAnterior: { ticket: cxp.ticket, kg: cambiosCxP.kgAnterior, total: totalAnterior },
    valorNuevo: { ticket: cxp.ticket, kg: cambiosCxP.kg, total: cambiosCxP.total },
    motivo: cambiosCxP.motivoAjusteKg
  });
}

// PARTE 2: acción "Editar kg" de CxP. Recalcula la cuenta y actualiza también el kg del registro de Báscula del mismo
// ticket + proveedor. opciones.confirmar(advertencias) -> Promise<boolean> se invoca ANTES de escribir y puede cancelar.
async function corregirKgCxP(cxpId, kgNuevo, motivo, editadoPor, opciones) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return { cancelado: true, advertencias: [] };
  exigirEscrituraCxP();
  const kg = validarKgCorreccion(kgNuevo);
  const motivoLimpio = (motivo || '').toString().trim();
  if (!motivoLimpio) throw new Error('El motivo es obligatorio');
  await validarCxPEditableKg(cxp);

  const filas = (await consultarPorTicket('destaraje', cxp.ticket))
    .filter((r) => window.normalizarProveedor(r.proveedor) === window.normalizarProveedor(cxp.proveedor));
  const fila = elegirFilaDelTicket(filas, cxp);
  if (filas.length > 1 && !fila) {
    throw new Error(`El ticket ${cxp.ticket} tiene varios renglones en Báscula: edita el kg desde Báscula.`);
  }
  if (fila && !window.puedeEscribir('destaraje')) {
    throw new Error('Corregir el kg también actualiza el registro de Báscula del ticket y tu usuario no tiene permiso de escritura en Báscula.');
  }
  const cambios = calcularCorreccionKgCxP(cxp, kg, motivoLimpio);
  const advertencias = advertenciasCorreccionKg(cxp.ticket, kg, window.EVE);
  if (advertencias.length > 0 && opciones && opciones.confirmar && !(await opciones.confirmar(advertencias))) {
    return { cancelado: true, advertencias };
  }

  await guardarCorreccionKg({ cxp, cambiosCxP: cambios, basculaId: fila ? fila.id : null, cambiosBascula: { kg } });
  if (fila) {
    [window.EVE.registrosDestaraje, window.EVE.registrosDestarajeRaw].forEach((lista) => {
      const enMemoria = (lista || []).find((r) => r.id === fila.id);
      if (enMemoria) enMemoria.kg = kg;
    });
    window.EVE_HISTORIAL.registrar({
      coleccion: 'destaraje',
      registroId: fila.id,
      accion: 'edicion',
      valorAnterior: { ticket: fila.ticket, kg: fila.kg },
      valorNuevo: { ticket: fila.ticket, kg },
      motivo: `Corrección de kg desde CxP: ${motivoLimpio}`
    });
  }
  return { cancelado: false, advertencias };
}

async function eliminarCxP(cxpId, motivo, eliminadoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  await verificarSinPagosFrescos(cxp);
  await window.eliminarDato('cuentas_por_pagar', cxpId);
  window.EVE_HISTORIAL.registrar({
    coleccion: 'cuentas_por_pagar',
    registroId: cxpId,
    accion: 'eliminacion',
    valorAnterior: { ticket: cxp.ticket, proveedor: cxp.proveedor, material: cxp.material, kg: cxp.kg, total: cxp.total },
    valorNuevo: null,
    motivo
  });
  const indice = window.EVE.cuentasPorPagar.findIndex((c) => c.id === cxpId);
  if (indice !== -1) window.EVE.cuentasPorPagar.splice(indice, 1);
}

async function registrarPagoGeneral(nombreProveedor, monto, fecha, referencia, registradoPor) {
  const cuentasProveedor = window.EVE.cuentasPorPagar.filter((c) => c.proveedor === nombreProveedor);
  const { actualizaciones, sobrante } = distribuirPago(cuentasProveedor, monto, fecha, referencia, registradoPor);
  const grupoPagoId = generarGrupoPagoId();
  for (const act of actualizaciones) {
    const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === act.id);
    const abonos = [...cxp.abonos, { ...act.abono, grupoPagoId }];
    await window.actualizarDato('cuentas_por_pagar', act.id, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
    const registroPago = {
      ticket: cxp.ticket,
      proveedor: cxp.proveedor,
      material: cxp.material,
      kg: cxp.kg,
      precioPorKg: cxp.precioEfectivo,
      pagado: act.abono.monto,
      total: cxp.total,
      iva: window.calcularIvaProrrateado(act.abono.monto, cxp.total, cxp.iva),
      fecha,
      origen: 'cxp_pago_general',
      grupoPagoId
    };
    const idPago = await window.guardarDato('pagos', registroPago);
    window.EVE.registrosPagos.push({ id: idPago, ...registroPago, fechaRegistro: new Date().toISOString() });
    Object.assign(cxp, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
  }
  if (sobrante > 0) {
    await guardarSaldoAFavor(nombreProveedor, {
      monto: sobrante,
      fecha,
      motivo: 'Sobrante de pago aplicado como saldo a favor',
      grupoPagoId
    });
    await registrarAnticipoEnPagos(nombreProveedor, sobrante, fecha, grupoPagoId);
  }
  return { actualizaciones, sobrante };
}

// El sobrante de un pago general es dinero que ya salió de caja: se registra en pagos (origen 'anticipo', mismo patrón y mismo
// grupoPagoId que el movimiento de saldo a favor, como en pagos.js) para que aparezca en Pagos y en Flujo de efectivo, y para que
// revertirPagosSiExiste lo marque revertido junto con ese movimiento. Si la escritura falla, el saldo a favor ya quedó guardado:
// se avisa en vez de lanzar el error, para no dar por fallido un pago cuyos abonos y saldo a favor sí se guardaron.
async function registrarAnticipoEnPagos(nombreProveedor, monto, fecha, grupoPagoId) {
  const registroAnticipo = {
    ticket: '',
    proveedor: nombreProveedor,
    material: '',
    kg: 0,
    precioPorKg: 0,
    total: 0,
    pagado: monto,
    nota: 'Anticipo - saldo a favor',
    fecha,
    origen: 'anticipo',
    revertido: false,
    grupoPagoId
  };
  try {
    const idAnticipo = await window.guardarDato('pagos', registroAnticipo);
    window.EVE.registrosPagos.push({ id: idAnticipo, ...registroAnticipo, fechaRegistro: new Date().toISOString() });
    return true;
  } catch (error) {
    window.showError(`El sobrante de ${window.formatearMoneda(monto)} quedó como saldo a favor, pero no se pudo registrar en Pagos: ${error.message}. Hasta registrarlo no aparecerá en Pagos ni en Flujo de efectivo.`);
    return false;
  }
}

// Mensaje para pantalla con la cantidad y los materiales de los tickets omitidos por "Sin precio vigente"
// (vacío si no hubo ninguno). Antes solo se veía en consola.
function resumirOmitidasSinPrecio(omitidas) {
  const sinPrecio = (omitidas || []).filter((o) => String(o.motivo || '').startsWith('Sin precio vigente'));
  if (sinPrecio.length === 0) return '';
  const porMaterial = new Map();
  sinPrecio.forEach((o) => {
    const material = o.material || '(sin material)';
    porMaterial.set(material, (porMaterial.get(material) || 0) + 1);
  });
  const detalle = Array.from(porMaterial.entries()).sort((a, b) => b[1] - a[1]).map(([material, cantidad]) => `${material} (${cantidad})`).join(', ');
  return `${sinPrecio.length} ticket(s) sin precio vigente: no se generó su CxP. Carga el precio en Precios con fecha <= fecha del ticket. Materiales: ${detalle}`;
}

// Con pocos casos el aviso es un toast corto; con más de 3 materiales o más de 5 tickets omitidos se muestra
// un modal que permanece hasta que la persona lo cierre, con la cantidad de tickets por material.
const UMBRAL_MATERIALES_AVISO_SINPRECIO = 3;
const UMBRAL_TICKETS_AVISO_SINPRECIO = 5;

function agruparOmitidasSinPrecio(omitidas) {
  const sinPrecio = (omitidas || []).filter((o) => String(o.motivo || '').startsWith('Sin precio vigente'));
  const porMaterial = new Map();
  sinPrecio.forEach((o) => {
    const material = o.material || '(sin material)';
    porMaterial.set(material, (porMaterial.get(material) || 0) + 1);
  });
  return { total: sinPrecio.length, porMaterial: Array.from(porMaterial.entries()).sort((a, b) => b[1] - a[1]) };
}

function mostrarModalOmitidasSinPrecio(grupos) {
  const previo = document.getElementById('cxp-omitidas-overlay');
  if (previo) previo.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cxp-omitidas-overlay';
  overlay.className = 'modal-overlay open';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const titulo = document.createElement('h3');
  titulo.textContent = `${grupos.total} ticket(s) sin precio vigente`;
  modal.appendChild(titulo);
  const texto = document.createElement('p');
  texto.textContent = 'No se generó su CxP. Carga el precio en Precios con fecha <= fecha del ticket y vuelve a generar. Tickets omitidos por material:';
  modal.appendChild(texto);
  const lista = document.createElement('ul');
  grupos.porMaterial.forEach(([material, cantidad]) => {
    const item = document.createElement('li');
    item.textContent = `${material}: ${cantidad} ticket(s)`;
    lista.appendChild(item);
  });
  modal.appendChild(lista);
  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.className = 'btn-primary';
  cerrar.textContent = 'Cerrar';
  cerrar.addEventListener('click', () => overlay.remove());
  modal.appendChild(cerrar);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// Punto único para avisar de los tickets omitidos por "Sin precio vigente" (Generar pendientes anteriores al
// corte, Aprobar TODOS y generación desde auditoría). No hace nada si no hubo ninguno.
function avisarOmitidasSinPrecio(omitidas) {
  const grupos = agruparOmitidasSinPrecio(omitidas);
  if (grupos.total === 0) return;
  if (grupos.porMaterial.length > UMBRAL_MATERIALES_AVISO_SINPRECIO || grupos.total > UMBRAL_TICKETS_AVISO_SINPRECIO) {
    mostrarModalOmitidasSinPrecio(grupos);
    return;
  }
  window.showError(resumirOmitidasSinPrecio(omitidas));
}

Object.assign(window.EVE_CXP, {
  resumirOmitidasSinPrecio,
  avisarOmitidasSinPrecio,
  generarCxPDesdeAuditoria,
  generarCxPSinFoto,
  aprobarManualmente,
  actualizarAbonoCxP,
  registrarPagoGeneral,
  ajustarIvaCxP,
  guardarSaldoAFavor,
  revertirAbono,
  aplicarSaldoAFavorACuentas,
  revertirMovimientoSaldoAFavorSiExiste,
  revertirPagosSiExiste,
  ajustarPrecioCxP,
  editarMaterialCxP,
  corregirKgCxP,
  prepararCorreccionKgDesdeBascula,
  guardarCorreccionKg,
  calcularCorreccionKgCxP,
  advertenciasCorreccionKg,
  MENSAJE_CXP_CON_ABONOS,
  eliminarCxP,
  generarGrupoPagoId,
  totalSaldoAFavor,
  movimientosSaldoAFavor,
  verificarSinPagosFrescos,
  crearPadFirma,
  generarPDFRecibo,
  generarAbonoId,
  iniciarPDFConTitulo
});

let vistaActiva = 'proveedores';
let proveedorExpandido = null;
let cxpAbonoExpandido = null;
let cxpLiquidadosExpandido = new Set();
let saldoAFavorExpandido = null;
let pendientesSinAuditarExpandido = false;
let tabTodos = 'semana';
let filtrosTodos = { desde: '', hasta: '', proveedor: '', material: '', estado: '' };
let tabProveedorPeriodo = 'todos';
let rangoProveedorDesde = '';
let rangoProveedorHasta = '';
let modalContexto = null;
let ticketsSeleccionadosRecibo = new Set();
let montosSeleccionadosRecibo = new Map();

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

function obtenerInicioMes() {
  return window.obtenerFechaMexico().slice(0, 7) + '-01';
}

function calcularTotalAdeudadoGeneral() {
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(window.EVE.cuentasPorPagar).filter((g) => g.saldo > 0);
  const total = grupos.reduce((suma, g) => suma + g.saldo, 0);
  return { total, cantidadProveedores: grupos.length };
}

function obtenerPeriodoActivoInfo() {
  if (vistaActiva === 'proveedores' && (tabProveedorPeriodo === 'hoy' || tabProveedorPeriodo === 'semana' || tabProveedorPeriodo === 'mes')) {
    const nombres = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes' };
    const { desde, hasta } = calcularRangoPeriodoCxP(tabProveedorPeriodo);
    return { nombre: nombres[tabProveedorPeriodo], desde, hasta };
  }
  if (vistaActiva === 'proveedores' && tabProveedorPeriodo === 'rango' && rangoProveedorDesde && rangoProveedorHasta) {
    return { nombre: 'Rango', desde: rangoProveedorDesde, hasta: rangoProveedorHasta };
  }
  if (vistaActiva === 'todos' && (tabTodos === 'semana' || tabTodos === 'mes')) {
    const nombres = { semana: 'Esta Semana', mes: 'Este Mes' };
    const desde = tabTodos === 'semana' ? window.obtenerInicioSemana() : obtenerInicioMes();
    return { nombre: nombres[tabTodos], desde, hasta: null };
  }
  return null;
}

function crearResumenGeneral() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'cxp-resumen-general';
  return div;
}

function llenarResumenGeneral() {
  const div = document.getElementById('cxp-resumen-general');
  if (!div) return;
  div.innerHTML = '';

  const { total, cantidadProveedores } = calcularTotalAdeudadoGeneral();
  const fila = document.createElement('div');
  fila.style.display = 'flex';
  fila.style.alignItems = 'center';
  fila.style.gap = '1.5rem';
  fila.style.flexWrap = 'wrap';

  const bloqueGeneral = document.createElement('div');
  bloqueGeneral.innerHTML = `<strong>Total Adeudado General: ${window.formatearMoneda(total)}</strong> (${cantidadProveedores} proveedor${cantidadProveedores === 1 ? '' : 'es'} con saldo pendiente)`;
  fila.appendChild(bloqueGeneral);

  const periodoActivo = obtenerPeriodoActivoInfo();
  if (periodoActivo) {
    const cuentasPeriodo = window.EVE_CXP.filtrarCxP(window.EVE.cuentasPorPagar, { desde: periodoActivo.desde, hasta: periodoActivo.hasta });
    const totalPeriodo = window.EVE_CXP.agregarPorProveedorCxP(cuentasPeriodo)
      .filter((g) => g.saldo > 0)
      .reduce((suma, g) => suma + g.saldo, 0);
    const bloquePeriodo = document.createElement('div');
    bloquePeriodo.innerHTML = `<strong>Total ${periodoActivo.nombre}: ${window.formatearMoneda(totalPeriodo)}</strong>`;
    fila.appendChild(bloquePeriodo);
  }

  div.appendChild(fila);
}

function crearBarraAlerta() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'cxp-alerta';
  return div;
}

function llenarBarraAlerta() {
  const div = document.getElementById('cxp-alerta');
  if (!div) return;
  div.innerHTML = '';

  const pendientes = window.EVE_CXP.listarPendientesSinAuditar(
    window.EVE.registrosDestaraje, window.EVE.cuentasPorPagar, window.EVE.auditorias
  );

  const fila = document.createElement('div');
  fila.style.display = 'flex';
  fila.style.alignItems = 'center';
  fila.style.gap = '0.75rem';
  fila.style.flexWrap = 'wrap';

  if (pendientes.length > 0) {
    fila.appendChild(crearChip(`⚠️ ${pendientes.length} tickets sin auditar (requieren foto)`, 'chip-warn'));

    const btnToggleLista = document.createElement('button');
    btnToggleLista.textContent = (pendientesSinAuditarExpandido ? 'Ocultar' : 'Ver') + ' lista de tickets';
    btnToggleLista.className = 'btn-secondary';
    btnToggleLista.addEventListener('click', () => {
      pendientesSinAuditarExpandido = !pendientesSinAuditarExpandido;
      llenarBarraAlerta();
    });
    fila.appendChild(btnToggleLista);

    if (window.puedeEscribir('cxp')) {
    const btnAprobarTodos = document.createElement('button');
    btnAprobarTodos.textContent = 'Aprobar manualmente TODOS';
    btnAprobarTodos.className = 'btn-secondary';
    btnAprobarTodos.addEventListener('click', async () => {
      const pendientesActuales = window.EVE_CXP.listarPendientesSinAuditar(
        window.EVE.registrosDestaraje, window.EVE.cuentasPorPagar, window.EVE.auditorias
      );
      if (pendientesActuales.length === 0) {
        window.showError('No hay tickets pendientes de auditar');
        return;
      }
      const confirmado = window.confirm(
        `Vas a aprobar manualmente ${pendientesActuales.length} tickets sin evidencia fotográfica. Esta acción no se puede deshacer en masa. ¿Confirmas?`
      );
      if (!confirmado) return;

      btnAprobarTodos.disabled = true;
      const motivoMasivo = 'Aprobación masiva histórica — sin evidencia fotográfica (carga inicial 2026)';
      let exitosos = 0;
      const fallidos = [];
      for (const registro of pendientesActuales) {
        try {
          await window.EVE_CXP.aprobarManualmente(registro, motivoMasivo);
          exitosos++;
        } catch (error) {
          fallidos.push({ ticket: registro.ticket, material: registro.material, motivo: error.message });
        }
      }
      if (fallidos.length === 0) {
        window.showSuccess(`${exitosos} tickets aprobados manualmente`);
      } else {
        const grupos = new Map();
        fallidos.forEach((f) => {
          if (!grupos.has(f.motivo)) grupos.set(f.motivo, []);
          grupos.get(f.motivo).push(f.ticket);
        });
        const resumenGrupos = Array.from(grupos.entries())
          .sort((a, b) => b[1].length - a[1].length)
          .map(([motivo, tickets]) => ({
            motivo,
            cantidad: tickets.length,
            ejemplos: tickets.slice(0, 3).join(', '),
          }));

        window.showError(`${exitosos} aprobados, ${fallidos.length} fallaron en ${grupos.size} tipo(s) de error — revisa la consola`);
        console.warn('Aprobación manual masiva — tickets fallidos:', fallidos);
        avisarOmitidasSinPrecio(fallidos);
        console.table(resumenGrupos);
      }
      btnAprobarTodos.disabled = false;
      renderizarVistaActiva();
    });
    fila.appendChild(btnAprobarTodos);
    }
  } else {
    fila.appendChild(crearChip('✅ Sin tickets pendientes de auditar', 'chip-ok'));
  }

  if (window.puedeEscribir('cxp')) {
    const btnGenerarCorte = document.createElement('button');
    btnGenerarCorte.textContent = 'Generar pendientes anteriores al corte';
    btnGenerarCorte.className = 'btn-secondary';
    btnGenerarCorte.addEventListener('click', async () => {
      btnGenerarCorte.disabled = true;
      try {
        const resumen = await window.EVE_CXP.generarCxPSinFoto();
        window.showSuccess(`${resumen.generadas} cuentas generadas` + (resumen.omitidas.length ? `, ${resumen.omitidas.length} omitidas` : ''));
        if (resumen.omitidas.length) console.warn('CxP sin foto omitidas:', resumen.omitidas);
        window.EVE_CXP.avisarOmitidasSinPrecio(resumen.omitidas);
        renderizarVistaActiva();
      } catch (error) {
        window.showError(error.message);
      } finally {
        btnGenerarCorte.disabled = false;
      }
    });
    fila.appendChild(btnGenerarCorte);
  }
  div.appendChild(fila);

  if (pendientes.length > 0 && pendientesSinAuditarExpandido) {
    const lista = document.createElement('div');
    lista.style.marginTop = '0.75rem';
    pendientes.forEach((registro) => {
      const linea = document.createElement('div');
      linea.style.display = 'flex';
      linea.style.justifyContent = 'space-between';
      linea.style.alignItems = 'center';
      linea.style.padding = '0.35rem 0';
      linea.style.borderBottom = '1px solid #eee';

      const texto = document.createElement('span');
      texto.textContent = `Ticket ${registro.ticket} — ${registro.proveedor} — ${registro.material} — ${window.formatearFecha(registro.fechaEntrada)}`;
      linea.appendChild(texto);

      if (window.puedeEscribir('cxp')) {
        const boton = document.createElement('button');
        boton.textContent = 'Aprobar manualmente';
        boton.className = 'btn-secondary';
        boton.addEventListener('click', async () => {
          const motivo = window.prompt('Motivo de aprobación sin foto:');
          if (motivo === null || !motivo.trim()) return;
          try {
            await window.EVE_CXP.aprobarManualmente(registro, motivo.trim());
            window.showSuccess('Cuenta por pagar generada');
            renderizarVistaActiva();
          } catch (error) {
            window.showError(error.message);
          }
        });
        linea.appendChild(boton);
      }
      lista.appendChild(linea);
    });
    div.appendChild(lista);
  }
}

function crearTabsPrincipales() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'proveedores', nombre: 'Por Proveedor' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      vistaActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      renderizarVistaActiva();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearTabsPeriodoProveedor() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' },
    { id: 'rango', nombre: 'Rango' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === tabProveedorPeriodo ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      tabProveedorPeriodo = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      llenarVistaProveedores();
      llenarResumenGeneral();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearVistaProveedores() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxp-proveedores-wrapper';
  wrapper.appendChild(crearTabsPeriodoProveedor());
  const contenido = document.createElement('div');
  contenido.id = 'cxp-proveedores-contenido';
  wrapper.appendChild(contenido);
  return wrapper;
}

function llenarVistaProveedores() {
  const contenido = document.getElementById('cxp-proveedores-contenido');
  if (!contenido) return;
  contenido.innerHTML = '';
  if (tabProveedorPeriodo === 'todos') {
    llenarVistaProveedoresCompleta(contenido);
  } else {
    llenarVistaProveedoresPeriodo(contenido, tabProveedorPeriodo);
  }
}

function crearSelectorRangoProveedor() {
  const card = document.createElement('div');
  card.className = 'card destaraje-filtros';

  const campoDesde = document.createElement('label');
  campoDesde.className = 'filtro-campo';
  const etiquetaDesde = document.createElement('span');
  etiquetaDesde.textContent = 'Desde';
  const inputDesde = document.createElement('input');
  inputDesde.type = 'date';
  inputDesde.id = 'cxp-rango-desde';
  inputDesde.value = rangoProveedorDesde;
  campoDesde.appendChild(etiquetaDesde);
  campoDesde.appendChild(inputDesde);

  const campoHasta = document.createElement('label');
  campoHasta.className = 'filtro-campo';
  const etiquetaHasta = document.createElement('span');
  etiquetaHasta.textContent = 'Hasta';
  const inputHasta = document.createElement('input');
  inputHasta.type = 'date';
  inputHasta.id = 'cxp-rango-hasta';
  inputHasta.value = rangoProveedorHasta;
  campoHasta.appendChild(etiquetaHasta);
  campoHasta.appendChild(inputHasta);

  const btnAplicar = document.createElement('button');
  btnAplicar.className = 'btn-primary';
  btnAplicar.textContent = 'Aplicar';
  btnAplicar.addEventListener('click', () => {
    const desde = inputDesde.value;
    const hasta = inputHasta.value;
    if (!desde || !hasta || desde > hasta) {
      window.showError('El rango no es válido: "Desde" debe ser menor o igual a "Hasta"');
      return;
    }
    rangoProveedorDesde = desde;
    rangoProveedorHasta = hasta;
    llenarVistaProveedores();
    llenarResumenGeneral();
  });

  card.appendChild(campoDesde);
  card.appendChild(campoHasta);
  card.appendChild(btnAplicar);
  return card;
}

function llenarVistaProveedoresPeriodo(contenido, periodo) {
  if (periodo === 'rango') {
    contenido.appendChild(crearSelectorRangoProveedor());
  }
  const { desde, hasta } = calcularRangoPeriodoCxP(periodo, { desde: rangoProveedorDesde, hasta: rangoProveedorHasta });
  if (periodo === 'rango' && (!desde || !hasta)) return;
  const cuentasPeriodo = window.EVE_CXP.filtrarCxP(window.EVE.cuentasPorPagar, { desde, hasta });
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentasPeriodo)
    .filter((g) => g.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo);

  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';

  if (grupos.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin saldo pendiente en este periodo';
    tarjeta.appendChild(vacio);
    contenido.appendChild(tarjeta);
    return;
  }

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  const tbody = document.createElement('tbody');
  tbody.id = 'cxp-resumen-proveedores-periodo-' + periodo;
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th data-tipo="texto">Proveedor</th><th data-tipo="moneda">Saldo</th></tr>';
  tabla.appendChild(thead);

  let total = 0;
  grupos.forEach((grupo) => {
    total += grupo.saldo;
    const fila = document.createElement('tr');
    const celdaProveedor = document.createElement('td');
    celdaProveedor.textContent = grupo.proveedor;
    const celdaSaldo = document.createElement('td');
    celdaSaldo.textContent = window.formatearMoneda(grupo.saldo);
    fila.appendChild(celdaProveedor);
    fila.appendChild(celdaSaldo);
    tbody.appendChild(fila);
  });

  const filaTotal = document.createElement('tr');
  const celdaTotal = document.createElement('td');
  celdaTotal.colSpan = 2;
  celdaTotal.style.fontWeight = 'bold';
  celdaTotal.textContent = `TOTAL: ${window.formatearMoneda(total)}`;
  filaTotal.appendChild(celdaTotal);
  tbody.appendChild(filaTotal);

  tabla.appendChild(tbody);
  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);
  tarjeta.appendChild(tablaWrapper);
  contenido.appendChild(tarjeta);

  grupos.forEach((grupo) => {
    contenido.appendChild(crearTarjetaProveedorCxP(grupo, { periodo, desde, hasta }));
  });
}

// opcionesExportar: null en la vista "Todos" (sin exportación); { periodo, desde, hasta }
// en las vistas por periodo, donde además agrega la barra de exportación del colapsable.
// Modal de "Aplicar saldo a favor": CxP del proveedor con saldo, de la más antigua a la más reciente. Sugiere el reparto FIFO
// del saldo disponible; cada fila se puede desmarcar o ajustar (máximo su saldo). Confirmar se bloquea si el total excede lo disponible.
function abrirModalAplicarSaldoAFavor(nombreProveedor, saldoDisponible) {
  const previo = document.getElementById('cxp-aplicar-saldo-overlay');
  if (previo) previo.remove();
  const cuentas = window.EVE.cuentasPorPagar
    .filter((c) => c.proveedor === nombreProveedor && c.saldo > 0.01)
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? -1 : a.fechaTicket > b.fechaTicket ? 1 : 0));
  if (cuentas.length === 0) {
    window.showError('Este proveedor no tiene cuentas con saldo pendiente');
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'cxp-aplicar-saldo-overlay';
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Aplicar saldo a favor</h3>
      <p style="font-weight:600"></p>
      <div class="destaraje-tabla-wrapper" style="max-height:50vh;overflow:auto">
        <table class="tabla-destaraje">
          <thead><tr><th></th><th>Ticket</th><th>Fecha</th><th>Saldo</th><th>Aplicar</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p id="cxp-aplicar-saldo-total" style="font-weight:600"></p>
      <button type="button" class="btn-primary" id="cxp-aplicar-saldo-confirmar">Confirmar</button>
      <button type="button" class="btn-secondary" id="cxp-aplicar-saldo-cancelar">Cancelar</button>
    </div>
  `;
  overlay.querySelector('p').textContent = `${nombreProveedor} — Saldo a favor disponible: ${window.formatearMoneda(saldoDisponible)}`;
  const redondear = (n) => Math.round(n * 100) / 100;
  const tbody = overlay.querySelector('tbody');
  const btnConfirmar = overlay.querySelector('#cxp-aplicar-saldo-confirmar');
  const filas = [];
  let restante = saldoDisponible;
  cuentas.forEach((cuenta) => {
    const sugerido = redondear(Math.min(cuenta.saldo, Math.max(0, restante)));
    restante -= sugerido;
    const fila = document.createElement('tr');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = sugerido > 0;
    const monto = document.createElement('input');
    monto.type = 'number';
    monto.step = '0.01';
    monto.min = '0.01';
    monto.max = String(cuenta.saldo);
    monto.value = sugerido > 0 ? String(sugerido) : '';
    monto.disabled = !check.checked;
    [check, String(cuenta.ticket), window.formatearFecha(cuenta.fechaTicket), window.formatearMoneda(cuenta.saldo), monto].forEach((contenido) => {
      const celda = document.createElement('td');
      if (typeof contenido === 'string') celda.textContent = contenido;
      else celda.appendChild(contenido);
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
    filas.push({ cuenta, check, monto });
  });

  const seleccionadas = () => filas.filter((f) => f.check.checked);
  const actualizarTotal = () => {
    const elegidas = seleccionadas();
    const total = elegidas.reduce((acc, f) => acc + (Number(f.monto.value) || 0), 0);
    const excede = total > saldoDisponible + 0.01;
    const invalido = elegidas.some((f) => !(Number(f.monto.value) > 0) || Number(f.monto.value) > f.cuenta.saldo + 0.01);
    const totalEl = overlay.querySelector('#cxp-aplicar-saldo-total');
    totalEl.textContent = `Total a aplicar: ${window.formatearMoneda(total)}` + (excede ? ' — excede el saldo a favor disponible' : '');
    totalEl.style.color = excede ? '#c0392b' : '';
    btnConfirmar.disabled = elegidas.length === 0 || excede || invalido;
  };
  filas.forEach((f) => {
    f.monto.addEventListener('input', actualizarTotal);
    f.check.addEventListener('change', () => {
      f.monto.disabled = !f.check.checked;
      if (f.check.checked && !(Number(f.monto.value) > 0)) {
        const otros = seleccionadas().filter((o) => o !== f).reduce((acc, o) => acc + (Number(o.monto.value) || 0), 0);
        f.monto.value = String(redondear(Math.max(0.01, Math.min(f.cuenta.saldo, saldoDisponible - otros))));
      }
      actualizarTotal();
    });
  });
  actualizarTotal();

  const cerrar = () => overlay.remove();
  overlay.querySelector('#cxp-aplicar-saldo-cancelar').addEventListener('click', cerrar);
  btnConfirmar.addEventListener('click', async () => {
    btnConfirmar.disabled = true;
    try {
      const asignaciones = seleccionadas().map((f) => ({ id: f.cuenta.id, monto: Number(f.monto.value) }));
      const { aplicado } = await window.EVE_CXP.aplicarSaldoAFavorACuentas(nombreProveedor, asignaciones);
      cerrar();
      window.showSuccess(`Se aplicaron ${window.formatearMoneda(aplicado)} de saldo a favor a ${asignaciones.length} cuenta(s)`);
      renderizarVistaActiva();
    } catch (error) {
      window.showError(error.message);
      actualizarTotal();
    }
  });
  document.body.appendChild(overlay);
}

function crearTarjetaProveedorCxP(grupo, opcionesExportar) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';

  const encabezado = document.createElement('div');
  encabezado.style.display = 'flex';
  encabezado.style.justifyContent = 'space-between';
  encabezado.style.flexWrap = 'wrap';
  encabezado.style.gap = '0.5rem';
  encabezado.innerHTML = `
    <h3 style="margin:0">${grupo.proveedor}</h3>
    <div>
      <span>Total: ${window.formatearMoneda(grupo.total)}</span> &nbsp;
      <span>Pagado: ${window.formatearMoneda(grupo.pagado)}</span> &nbsp;
      <span><strong>Saldo: ${window.formatearMoneda(grupo.saldo)}</strong></span>
    </div>
  `;
  tarjeta.appendChild(encabezado);

  const proveedorRegistro = window.EVE.proveedores.find((p) => p.nombre === grupo.proveedor);
  const saldoAFavorTotal = totalSaldoAFavor(proveedorRegistro && proveedorRegistro.saldoAFavor);
  const movimientosSaldo = movimientosSaldoAFavor(proveedorRegistro);
  if (saldoAFavorTotal > 0 || movimientosSaldo.length > 0) {
    const filaSaldoAFavor = document.createElement('div');
    filaSaldoAFavor.style.display = 'flex';
    filaSaldoAFavor.style.alignItems = 'center';
    filaSaldoAFavor.style.gap = '0.5rem';
    filaSaldoAFavor.style.flexWrap = 'wrap';
    if (saldoAFavorTotal > 0) {
      filaSaldoAFavor.appendChild(crearChip(`✅ ${grupo.proveedor} — Saldo a favor: ${window.formatearMoneda(saldoAFavorTotal)} (se aplicará al próximo pago)`, 'chip-ok'));
    }
    if (movimientosSaldo.length > 0) {
      const btnMovimientos = document.createElement('button');
      btnMovimientos.className = 'btn-secondary';
      btnMovimientos.textContent = (saldoAFavorExpandido === grupo.proveedor ? 'Ocultar' : 'Ver') + ` Movimientos (${movimientosSaldo.length})`;
      btnMovimientos.addEventListener('click', () => {
        saldoAFavorExpandido = saldoAFavorExpandido === grupo.proveedor ? null : grupo.proveedor;
        llenarVistaProveedores();
      });
      filaSaldoAFavor.appendChild(btnMovimientos);
    }
    tarjeta.appendChild(filaSaldoAFavor);
  }
  if (saldoAFavorExpandido === grupo.proveedor) {
    tarjeta.appendChild(crearTablaSaldoAFavor(grupo.proveedor, movimientosSaldo));
  }

  const acciones = document.createElement('div');
  acciones.style.marginTop = '0.5rem';
  acciones.style.display = 'flex';
  acciones.style.gap = '0.5rem';

  const btnDetalle = document.createElement('button');
  btnDetalle.className = 'btn-secondary';
  btnDetalle.textContent = proveedorExpandido === grupo.proveedor ? 'Ocultar Detalle' : 'Ver Detalle';
  btnDetalle.addEventListener('click', () => {
    proveedorExpandido = proveedorExpandido === grupo.proveedor ? null : grupo.proveedor;
    ticketsSeleccionadosRecibo.clear();
    montosSeleccionadosRecibo.clear();
    llenarVistaProveedores();
  });
  acciones.appendChild(btnDetalle);

  if (window.puedeEscribir('cxp')) {
  const btnPago = document.createElement('button');
  btnPago.className = 'btn-primary';
  btnPago.textContent = 'Registrar Pago';
  btnPago.disabled = true;
  btnPago.title = "Usa 'Generar Recibo' para registrar pagos";
  acciones.appendChild(btnPago);

  if (saldoAFavorTotal > 0.01) {
    const btnAplicarSaldo = document.createElement('button');
    btnAplicarSaldo.className = 'btn-secondary';
    btnAplicarSaldo.textContent = 'Aplicar saldo a favor';
    btnAplicarSaldo.addEventListener('click', () => abrirModalAplicarSaldoAFavor(grupo.proveedor, saldoAFavorTotal));
    acciones.appendChild(btnAplicarSaldo);
  }
  }

  tarjeta.appendChild(acciones);

  if (proveedorExpandido === grupo.proveedor) {
    tarjeta.appendChild(crearTablaCuentas(grupo.cuentas, grupo.proveedor));
    if (opcionesExportar) {
      tarjeta.appendChild(crearBarraExportarEstadoCuentaCxP(grupo, opcionesExportar));
    }
  }

  return tarjeta;
}

function llenarVistaProveedoresCompleta(contenido) {
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(window.EVE.cuentasPorPagar);

  if (grupos.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin cuentas por pagar registradas';
    contenido.appendChild(vacio);
    return;
  }

  grupos.forEach((grupo) => {
    contenido.appendChild(crearTarjetaProveedorCxP(grupo));
  });
}

function crearTablaSaldoAFavor(nombreProveedor, movimientos) {
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="fecha">Fecha</th><th data-tipo="moneda">Monto</th><th data-tipo="texto">Motivo</th><th data-tipo="texto">Estado</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  tbody.id = 'cxp-tabla-saldo-favor-' + nombreProveedor;
  movimientos
    .slice()
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .forEach((m) => {
      const fila = document.createElement('tr');
      [window.formatearFecha(m.fecha), window.formatearMoneda(m.monto), m.motivo || ''].forEach((valor) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        fila.appendChild(celda);
      });
      const celdaEstado = document.createElement('td');
      celdaEstado.textContent = m.revertido ? `Revertido${m.revertidoMotivo ? ` — ${m.revertidoMotivo}` : ''}` : 'Activo';
      fila.appendChild(celdaEstado);
      const celdaAccion = document.createElement('td');
      if (!m.revertido && m.monto > 0 && m.grupoPagoId && window.puedeEscribir('cxp')) {
        const btnRevertir = document.createElement('button');
        btnRevertir.className = 'btn-secondary';
        btnRevertir.textContent = 'Revertir';
        btnRevertir.addEventListener('click', async () => {
          const motivo = window.prompt('Motivo de la reversión (obligatorio):');
          if (motivo === null || !motivo.trim()) return;
          btnRevertir.disabled = true;
          try {
            validarAnticipoNoConsumido(nombreProveedor, m.grupoPagoId);
            await revertirMovimientoSaldoAFavorSiExiste(nombreProveedor, m.grupoPagoId, motivo.trim(), usuarioActual());
            // ticket null: solo el anticipo del grupo; los pagos de tickets del mismo grupo siguen vigentes (sus abonos no se revierten aquí).
            await revertirPagosSiExiste(m.grupoPagoId, null, motivo.trim());
            window.showSuccess('Movimiento de saldo a favor revertido');
            renderizarVistaActiva();
          } catch (error) {
            window.showError(error.message);
            btnRevertir.disabled = false;
          }
        });
        celdaAccion.appendChild(btnRevertir);
      }
      fila.appendChild(celdaAccion);
      tbody.appendChild(fila);
    });
  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);
  return tablaWrapper;
}

function calcularTotalSeleccionado(cuentas) {
  return cuentas
    .filter((c) => ticketsSeleccionadosRecibo.has(c.id))
    .reduce((suma, c) => suma + (montosSeleccionadosRecibo.has(c.id) ? Number(montosSeleccionadosRecibo.get(c.id)) : c.saldo), 0);
}

function crearListaRecibosPendientesProveedor(nombreProveedor) {
  const wrapper = document.createElement('div');
  wrapper.className = 'destaraje-tabla-wrapper';
  wrapper.style.marginTop = '0.5rem';
  wrapper.innerHTML = `
    <table class="tabla-destaraje" style="display:none">
      <thead><tr><th data-tipo="texto">Recibo pendiente</th><th data-tipo="moneda">Monto</th><th data-tipo="fecha">Fecha generación</th><th></th></tr></thead>
      <tbody></tbody>
    </table>
  `;
  const tabla = wrapper.querySelector('table');
  const tbody = wrapper.querySelector('tbody');
  tbody.id = 'cxp-recibos-pendientes-' + nombreProveedor;
  window.activarOrdenamiento(tabla);
  cargarYRenderizarRecibosPendientesProveedor(nombreProveedor, tabla, tbody);
  return wrapper;
}

async function cargarYRenderizarRecibosPendientesProveedor(nombreProveedor, tabla, tbody) {
  try {
    const snapshot = await window.db.collection('recibos_pendientes')
      .where('proveedor', 'in', window.variantesProveedor(nombreProveedor))
      .where('estado', '==', 'pendiente_pago')
      .get();
    const recibos = window.unificarProveedorEnRegistros(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
    tbody.innerHTML = '';
    tabla.style.display = recibos.length === 0 ? 'none' : '';
    recibos.forEach((recibo) => {
      const fila = document.createElement('tr');
      [`${recibo.tickets.length} ticket(s)`, window.formatearMoneda(recibo.montoTotal), window.formatearFecha((recibo.fechaGeneracion || '').slice(0, 10))].forEach((valor) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        fila.appendChild(celda);
      });
      const celdaAccion = document.createElement('td');
      if (window.puedeEscribir('admin')) {
        const btnEliminar = document.createElement('button');
        btnEliminar.className = 'btn-secondary';
        btnEliminar.textContent = 'Eliminar';
        btnEliminar.addEventListener('click', async () => {
          const confirmado = window.confirm(`¿Eliminar el recibo pendiente de ${recibo.proveedor} por ${window.formatearMoneda(recibo.montoTotal)}? Esta acción no se puede deshacer. No afecta las cuentas por pagar ni los saldos de los tickets.`);
          if (!confirmado) return;
          btnEliminar.disabled = true;
          try {
            await window.eliminarDato('recibos_pendientes', recibo.id);
            window.showSuccess('Recibo pendiente eliminado');
            cargarYRenderizarRecibosPendientesProveedor(nombreProveedor, tabla, tbody);
          } catch (error) {
            window.showError(error.message);
            btnEliminar.disabled = false;
          }
        });
        celdaAccion.appendChild(btnEliminar);
      }
      fila.appendChild(celdaAccion);
      tbody.appendChild(fila);
    });
  } catch (error) {
    tabla.style.display = 'none';
  }
}

// Modal de "Editar kg": kg nuevo (> 0) y motivo obligatorio. Si el ticket ya alimenta un proceso de Control Producción o
// tiene una auditoría OCR que COINCIDE, corregirKgCxP pide confirmación antes de escribir.
function abrirModalEditarKg(cuenta) {
  const previo = document.getElementById('cxp-editar-kg-overlay');
  if (previo) previo.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cxp-editar-kg-overlay';
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar kg</h3>
      <form id="cxp-editar-kg-form">
        <p style="font-weight:600"></p>
        <input type="number" id="cxp-editar-kg-valor" placeholder="Kg nuevo" step="0.01" min="0.01" required>
        <textarea id="cxp-editar-kg-motivo" placeholder="Motivo de la corrección (obligatorio)" rows="2" required style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" class="btn-secondary" id="cxp-editar-kg-cancelar">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('p').textContent = `Ticket ${cuenta.ticket} · ${cuenta.proveedor} · kg actual: ${window.formatearKg(cuenta.kg, cuenta.material)}. También se actualiza el kg del registro de Báscula.`;
  const cerrar = () => overlay.remove();
  overlay.querySelector('#cxp-editar-kg-cancelar').addEventListener('click', cerrar);
  overlay.querySelector('#cxp-editar-kg-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const botonGuardar = overlay.querySelector('button[type="submit"]');
    const kgNuevo = overlay.querySelector('#cxp-editar-kg-valor').value;
    const motivo = overlay.querySelector('#cxp-editar-kg-motivo').value.trim();
    if (!(Number(kgNuevo) > 0)) {
      window.showError('El nuevo kg debe ser un número mayor a 0');
      return;
    }
    if (!motivo) {
      window.showError('El motivo es obligatorio');
      return;
    }
    botonGuardar.disabled = true;
    try {
      const resultado = await window.EVE_CXP.corregirKgCxP(cuenta.id, kgNuevo, motivo, usuarioActual(), {
        confirmar: async (advertencias) => window.confirm(`${advertencias.join('\n\n')}\n\n¿Guardar el kg nuevo de todas formas?`)
      });
      if (resultado.cancelado) {
        botonGuardar.disabled = false;
        return;
      }
      cerrar();
      window.showSuccess('Kg actualizado en CxP y Báscula');
      renderizarVistaActiva();
    } catch (error) {
      botonGuardar.disabled = false;
      window.showError(error.message);
    }
  });
  document.body.appendChild(overlay);
}

function crearTablaCuentas(cuentas, nombreProveedor) {
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th></th><th data-tipo="ticket">Ticket</th><th data-tipo="texto">Material</th><th data-tipo="numero">Kg</th><th data-tipo="moneda">Precio Efectivo</th><th data-tipo="moneda">Total</th><th data-tipo="moneda">IVA</th><th data-tipo="moneda">Pagado</th><th data-tipo="moneda">Saldo</th><th data-tipo="texto">Estado</th><th data-tipo="fecha">Fecha</th><th>Abonos</th><th>Ajuste Precio</th><th>Editar Material</th><th>Editar Kg</th><th>Ajustar IVA</th><th>Eliminar</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  tbody.id = 'cxp-tabla-cuentas-' + (nombreProveedor || 'todas');
  const cuentasOrdenadas = cuentas
    .slice()
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? 1 : -1));
  const cuentasActivas = cuentasOrdenadas.filter((c) => c.estado !== 'liquidado');
  const cuentasLiquidadas = cuentasOrdenadas.filter((c) => c.estado === 'liquidado');
  const claveExpandidoLiquidados = nombreProveedor || '__todos__';
  const liquidadosExpandido = cxpLiquidadosExpandido.has(claveExpandidoLiquidados);

  function renderizarFilaCuenta(c) {
      const fila = document.createElement('tr');

      const celdaCheckbox = document.createElement('td');
      if (c.saldo > 0 && window.puedeEscribir('cxp')) {
        const checkboxRecibo = document.createElement('input');
        checkboxRecibo.type = 'checkbox';
        checkboxRecibo.checked = ticketsSeleccionadosRecibo.has(c.id);

        const inputMonto = document.createElement('input');
        inputMonto.type = 'number';
        inputMonto.step = '0.01';
        inputMonto.min = '0.01';
        inputMonto.max = String(c.saldo);
        inputMonto.style.width = '90px';
        inputMonto.style.marginLeft = '0.4rem';
        inputMonto.title = 'Monto a cubrir para este ticket (por defecto, su saldo completo)';
        inputMonto.value = montosSeleccionadosRecibo.has(c.id) ? montosSeleccionadosRecibo.get(c.id) : c.saldo.toFixed(2);
        inputMonto.disabled = !checkboxRecibo.checked;

        function actualizarTotalYBoton() {
          const btnGenerarRecibo = document.getElementById('cxp-btn-generar-recibo');
          if (btnGenerarRecibo) btnGenerarRecibo.disabled = ticketsSeleccionadosRecibo.size === 0;
          const totalSeleccionado = document.getElementById('cxp-total-seleccionado');
          if (totalSeleccionado) totalSeleccionado.textContent = 'Total seleccionado: ' + window.formatearMoneda(calcularTotalSeleccionado(cuentas));
        }

        checkboxRecibo.addEventListener('change', () => {
          if (checkboxRecibo.checked) {
            ticketsSeleccionadosRecibo.add(c.id);
            if (!montosSeleccionadosRecibo.has(c.id)) montosSeleccionadosRecibo.set(c.id, c.saldo);
            inputMonto.value = montosSeleccionadosRecibo.get(c.id);
            inputMonto.disabled = false;
          } else {
            ticketsSeleccionadosRecibo.delete(c.id);
            montosSeleccionadosRecibo.delete(c.id);
            inputMonto.disabled = true;
          }
          actualizarTotalYBoton();
        });

        inputMonto.addEventListener('change', () => {
          let valor = Number(inputMonto.value);
          if (!Number.isFinite(valor) || valor <= 0) {
            window.showError('El monto a cubrir debe ser mayor a 0');
            valor = c.saldo;
          } else if (valor > c.saldo) {
            window.showError(`El monto no puede exceder el saldo (${window.formatearMoneda(c.saldo)})`);
            valor = c.saldo;
          }
          inputMonto.value = valor;
          montosSeleccionadosRecibo.set(c.id, valor);
          actualizarTotalYBoton();
        });

        celdaCheckbox.appendChild(checkboxRecibo);
        celdaCheckbox.appendChild(inputMonto);
      }
      fila.appendChild(celdaCheckbox);

      const valores = [
        c.ticket, c.material, window.formatearKg(c.kg, c.material),
        window.formatearMoneda(c.precioEfectivo), window.formatearMoneda(c.total),
        window.formatearMoneda(Number(c.iva) || 0),
        window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
        c.estado, window.formatearFecha(c.fechaTicket)
      ];
      valores.forEach((valor, indice) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        if (indice === 3 && c.precioNegociado !== null && c.precioNegociado !== undefined) {
          const badge = crearChip('🔖 Precio negociado', 'chip-warn');
          badge.title = c.motivoAjustePrecio || 'Precio negociado, distinto al de Lista de Precios';
          badge.style.marginLeft = '0.5rem';
          celda.appendChild(badge);
        }
        if (indice === 1 && c.materialAnterior) {
          const badge = crearChip('✏️ Material editado', 'chip-warn');
          badge.title = `Material original: ${c.materialAnterior}. Motivo: ${c.motivoAjusteMaterial || '—'}`;
          badge.style.marginLeft = '0.5rem';
          celda.appendChild(badge);
        }
        fila.appendChild(celda);
      });

      const abonos = c.abonos || [];
      const celdaAbonos = document.createElement('td');
      const btnAbonos = document.createElement('button');
      btnAbonos.className = 'btn-secondary';
      btnAbonos.textContent = (cxpAbonoExpandido === c.id ? 'Ocultar' : 'Ver') + ` (${abonos.length})`;
      btnAbonos.disabled = abonos.length === 0;
      btnAbonos.addEventListener('click', () => {
        cxpAbonoExpandido = cxpAbonoExpandido === c.id ? null : c.id;
        renderizarVistaActiva();
      });
      celdaAbonos.appendChild(btnAbonos);
      fila.appendChild(celdaAbonos);

      const esSaldoInicial = c.aprobacion && c.aprobacion.tipo === 'saldo_inicial';
      const celdaAjuste = document.createElement('td');
      if (window.puedeEscribir('cxp')) {
        const btnAjuste = document.createElement('button');
        btnAjuste.className = 'btn-secondary';
        btnAjuste.textContent = 'Ajustar precio';
        if (esSaldoInicial) {
          btnAjuste.disabled = true;
          btnAjuste.title = 'Esta cuenta es un saldo inicial histórico y no tiene precio/material aplicable.';
        } else if (c.pagado > 0) {
          btnAjuste.disabled = true;
          btnAjuste.title = 'No se puede ajustar el precio: esta cuenta ya tiene abonos aplicados. Revierte los abonos primero.';
        } else {
          btnAjuste.addEventListener('click', async () => {
            const precioActual = c.precioNegociado !== null && c.precioNegociado !== undefined ? c.precioNegociado : c.precioAplicado;
            const entradaPrecio = window.prompt(`Precio negociado por Kg (precio de lista: ${window.formatearMoneda(c.precioAplicado)}):`, String(precioActual));
            if (entradaPrecio === null) return;
            const precioNegociado = Number(entradaPrecio);
            if (!Number.isFinite(precioNegociado) || precioNegociado <= 0) {
              window.showError('El precio negociado debe ser un número mayor a 0');
              return;
            }
            const motivo = window.prompt('Motivo del ajuste de precio (obligatorio):');
            if (motivo === null || !motivo.trim()) return;
            try {
              await window.EVE_CXP.ajustarPrecioCxP(c.id, precioNegociado, motivo.trim(), usuarioActual());
              window.showSuccess('Precio ajustado');
              renderizarVistaActiva();
            } catch (error) {
              window.showError(error.message);
              renderizarVistaActiva();
            }
          });
        }
        celdaAjuste.appendChild(btnAjuste);
      }
      fila.appendChild(celdaAjuste);

      const celdaMaterial = document.createElement('td');
      if (window.puedeEscribir('cxp')) {
      const btnMaterial = document.createElement('button');
      btnMaterial.className = 'btn-secondary';
      btnMaterial.textContent = 'Editar material';
      if (esSaldoInicial) {
        btnMaterial.disabled = true;
        btnMaterial.title = 'Esta cuenta es un saldo inicial histórico y no tiene precio/material aplicable.';
      } else if (c.pagado > 0) {
        btnMaterial.disabled = true;
        btnMaterial.title = 'No se puede editar el material: esta cuenta ya tiene abonos aplicados. Revierte los abonos primero.';
      } else {
        btnMaterial.addEventListener('click', async () => {
          const entradaMaterial = window.prompt('Nuevo material:', c.material);
          if (entradaMaterial === null) return;
          const materialNuevo = entradaMaterial.trim().toUpperCase();
          if (!materialNuevo || materialNuevo === c.material) return;
          const motivo = window.prompt('Motivo del cambio de material (obligatorio):');
          if (motivo === null || !motivo.trim()) return;
          try {
            await window.EVE_CXP.editarMaterialCxP(c.id, materialNuevo, motivo.trim(), usuarioActual());
            window.showSuccess('Material actualizado');
            renderizarVistaActiva();
          } catch (error) {
            window.showError(error.message);
            renderizarVistaActiva();
          }
        });
      }
      celdaMaterial.appendChild(btnMaterial);
      }
      fila.appendChild(celdaMaterial);

      const celdaKg = document.createElement('td');
      if (window.puedeEscribir('cxp')) {
        const btnKg = document.createElement('button');
        btnKg.className = 'btn-secondary';
        btnKg.textContent = 'Editar kg';
        if (esSaldoInicial) {
          btnKg.disabled = true;
          btnKg.title = 'Esta cuenta es un saldo inicial histórico y no tiene kg aplicable.';
        } else if (c.pagado > 0 || (c.abonos || []).length > 0) {
          btnKg.disabled = true;
          btnKg.title = `No se puede editar el kg: esta cuenta ya tiene abonos aplicados. ${window.EVE_CXP.MENSAJE_CXP_CON_ABONOS}.`;
        } else if (!window.puedeEscribir('destaraje')) {
          btnKg.disabled = true;
          btnKg.title = 'Editar el kg también actualiza el registro de Báscula del ticket: requiere permiso de escritura en Báscula.';
        } else {
          btnKg.addEventListener('click', () => abrirModalEditarKg(c));
        }
        celdaKg.appendChild(btnKg);
      }
      fila.appendChild(celdaKg);

      const celdaIva = document.createElement('td');
      if (window.puedeEscribir('cxp')) {
        const btnIva = document.createElement('button');
        btnIva.className = 'btn-secondary';
        btnIva.textContent = 'Ajustar IVA';
        if (esSaldoInicial) {
          btnIva.disabled = true;
          btnIva.title = 'Esta cuenta es un saldo inicial histórico y no tiene precio/material aplicable.';
        } else if (c.pagado > 0) {
          btnIva.disabled = true;
          btnIva.title = 'No se puede ajustar el IVA: esta cuenta ya tiene abonos aplicados. Revierte los abonos primero.';
        } else {
          btnIva.addEventListener('click', async () => {
            const ivaActual = Number(c.iva) || 0;
            const entradaIva = window.prompt('IVA de esta cuenta (monto en pesos):', String(ivaActual));
            if (entradaIva === null) return;
            const ivaNuevo = Number(entradaIva);
            if (!Number.isFinite(ivaNuevo) || ivaNuevo < 0) {
              window.showError('El IVA debe ser un número mayor o igual a 0');
              return;
            }
            try {
              await window.EVE_CXP.ajustarIvaCxP(c.id, ivaNuevo, usuarioActual());
              window.showSuccess('IVA ajustado');
              renderizarVistaActiva();
            } catch (error) {
              window.showError(error.message);
              renderizarVistaActiva();
            }
          });
        }
        celdaIva.appendChild(btnIva);
      }
      fila.appendChild(celdaIva);

      const celdaEliminar = document.createElement('td');
      if (c.pagado === 0 && window.puedeEscribir('cxp')) {
        const btnEliminar = document.createElement('button');
        btnEliminar.className = 'btn-secondary';
        btnEliminar.textContent = 'Eliminar';
        btnEliminar.addEventListener('click', async () => {
          const confirmado = window.confirm(`¿Eliminar esta cuenta por pagar?\n\nTicket: ${c.ticket}\nMaterial: ${c.material}\nKg: ${window.formatearKg(c.kg, c.material)}\nTotal: ${window.formatearMoneda(c.total)}\n\nEsta acción no se puede deshacer.`);
          if (!confirmado) return;
          const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
          if (motivo === null) return;
          btnEliminar.disabled = true;
          try {
            await window.EVE_CXP.eliminarCxP(c.id, motivo.trim(), usuarioActual());
            window.showSuccess('Cuenta por pagar eliminada');
            renderizarVistaActiva();
          } catch (error) {
            window.showError(error.message);
            btnEliminar.disabled = false;
            renderizarVistaActiva();
          }
        });
        celdaEliminar.appendChild(btnEliminar);
      }
      fila.appendChild(celdaEliminar);

      tbody.appendChild(fila);

      if (cxpAbonoExpandido === c.id && abonos.length > 0) {
        const filaDetalle = document.createElement('tr');
        const celdaDetalle = document.createElement('td');
        celdaDetalle.colSpan = 17;
        const subtabla = document.createElement('table');
        subtabla.className = 'tabla-destaraje';
        subtabla.style.margin = '0.5rem 0';
        subtabla.innerHTML = `
          <thead>
            <tr><th data-tipo="fecha">Fecha</th><th data-tipo="moneda">Monto</th><th data-tipo="texto">Referencia</th><th data-tipo="texto">Registrado por</th><th></th></tr>
          </thead>
          <tbody></tbody>
        `;
        const subtbody = subtabla.querySelector('tbody');
        subtbody.id = 'cxp-abonos-' + c.id;
        abonos.forEach((abono) => {
          const filaAbono = document.createElement('tr');
          [window.formatearFecha(abono.fecha), window.formatearMoneda(abono.monto), abono.referencia, abono.registradoPor].forEach((valor) => {
            const celda = document.createElement('td');
            celda.textContent = valor;
            filaAbono.appendChild(celda);
          });
          const celdaAccion = document.createElement('td');
          if (window.puedeEscribir('cxp')) {
            const btnRevertir = document.createElement('button');
            btnRevertir.className = 'btn-secondary';
            btnRevertir.textContent = 'Revertir';
            btnRevertir.addEventListener('click', async () => {
              const motivo = window.prompt('Motivo de la reversión (obligatorio):');
              if (motivo === null || !motivo.trim()) return;
              const botonesSubtabla = Array.from(subtbody.querySelectorAll('button'));
              botonesSubtabla.forEach((btn) => { btn.disabled = true; });
              try {
                await window.EVE_CXP.revertirAbono(c.id, abono.abonoId, motivo.trim(), usuarioActual());
                window.showSuccess('Abono revertido');
                renderizarVistaActiva();
              } catch (error) {
                window.showError(error.message);
                botonesSubtabla.forEach((btn) => { btn.disabled = false; });
              }
            });
            celdaAccion.appendChild(btnRevertir);
          }
          filaAbono.appendChild(celdaAccion);
          subtbody.appendChild(filaAbono);
        });
        window.activarOrdenamiento(subtabla);
        celdaDetalle.appendChild(subtabla);
        filaDetalle.appendChild(celdaDetalle);
        tbody.appendChild(filaDetalle);
      }
  }

  cuentasActivas.forEach(renderizarFilaCuenta);

  if (cuentasLiquidadas.length > 0) {
    const filaToggleLiquidados = document.createElement('tr');
    const celdaToggleLiquidados = document.createElement('td');
    celdaToggleLiquidados.colSpan = 17;
    const btnToggleLiquidados = document.createElement('button');
    btnToggleLiquidados.className = 'btn-secondary';
    btnToggleLiquidados.textContent = (liquidadosExpandido ? 'Ocultar liquidados' : 'Ver liquidados') + ` (${cuentasLiquidadas.length})`;
    btnToggleLiquidados.addEventListener('click', () => {
      if (cxpLiquidadosExpandido.has(claveExpandidoLiquidados)) cxpLiquidadosExpandido.delete(claveExpandidoLiquidados);
      else cxpLiquidadosExpandido.add(claveExpandidoLiquidados);
      renderizarVistaActiva();
    });
    celdaToggleLiquidados.appendChild(btnToggleLiquidados);
    filaToggleLiquidados.appendChild(celdaToggleLiquidados);
    tbody.appendChild(filaToggleLiquidados);

    if (liquidadosExpandido) {
      cuentasLiquidadas.forEach(renderizarFilaCuenta);
    }
  }
  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);

  const contenedor = document.createElement('div');
  contenedor.appendChild(tablaWrapper);

  if (nombreProveedor && (window.puedeEscribir('cxp') || window.puedeEscribir('pagos'))) {
    contenedor.appendChild(crearListaRecibosPendientesProveedor(nombreProveedor));
  }

  if (nombreProveedor && window.puedeEscribir('cxp')) {
    const filaRecibo = document.createElement('div');
    filaRecibo.style.marginTop = '0.5rem';
    filaRecibo.style.display = 'flex';
    filaRecibo.style.alignItems = 'center';
    filaRecibo.style.gap = '0.75rem';

    const totalSeleccionado = document.createElement('span');
    totalSeleccionado.id = 'cxp-total-seleccionado';
    totalSeleccionado.textContent = 'Total seleccionado: ' + window.formatearMoneda(calcularTotalSeleccionado(cuentas));
    filaRecibo.appendChild(totalSeleccionado);

    const selectFormaPago = document.createElement('select');
    selectFormaPago.id = 'cxp-forma-pago';
    selectFormaPago.innerHTML = `
      <option value="efectivo">Efectivo</option>
      <option value="transferencia">Transferencia</option>
    `;
    filaRecibo.appendChild(selectFormaPago);

    const btnGenerarRecibo = document.createElement('button');
    btnGenerarRecibo.className = 'btn-secondary';
    btnGenerarRecibo.id = 'cxp-btn-generar-recibo';
    btnGenerarRecibo.textContent = 'Generar Recibo';
    btnGenerarRecibo.disabled = ticketsSeleccionadosRecibo.size === 0;
    btnGenerarRecibo.addEventListener('click', () => manejarGenerarReciboPendiente(nombreProveedor));
    filaRecibo.appendChild(btnGenerarRecibo);

    contenedor.appendChild(filaRecibo);
  }

  return contenedor;
}

function crearTabsTodos() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  nav.id = 'cxp-tabs-todos';
  const definiciones = [
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      tabTodos = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      const filtrosDiv = document.getElementById('cxp-filtros');
      if (filtrosDiv) filtrosDiv.style.display = tabTodos === 'todos' ? '' : 'none';
      llenarVistaTodos();
      llenarResumenGeneral();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearBarraFiltrosTodos() {
  const div = document.createElement('div');
  div.id = 'cxp-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'cxf-desde', etiqueta: 'Desde', tipo: 'date' },
    { id: 'cxf-hasta', etiqueta: 'Hasta', tipo: 'date' },
    { id: 'cxf-proveedor', etiqueta: 'Proveedor', tipo: 'text' },
    { id: 'cxf-material', etiqueta: 'Material', tipo: 'text' }
  ];
  campos.forEach((campo) => {
    const contenedor = document.createElement('label');
    contenedor.className = 'filtro-campo';
    const etiqueta = document.createElement('span');
    etiqueta.textContent = campo.etiqueta;
    contenedor.appendChild(etiqueta);
    const input = document.createElement('input');
    input.type = campo.tipo;
    input.id = campo.id;
    input.addEventListener('input', actualizarFiltrosTodos);
    contenedor.appendChild(input);
    div.appendChild(contenedor);
  });

  const contenedorEstado = document.createElement('label');
  contenedorEstado.className = 'filtro-campo';
  const etiquetaEstado = document.createElement('span');
  etiquetaEstado.textContent = 'Estado';
  contenedorEstado.appendChild(etiquetaEstado);
  const selectEstado = document.createElement('select');
  selectEstado.id = 'cxf-estado';
  ['', 'pendiente', 'parcial', 'liquidado'].forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = valor || 'Todos';
    selectEstado.appendChild(opcion);
  });
  selectEstado.addEventListener('change', actualizarFiltrosTodos);
  contenedorEstado.appendChild(selectEstado);
  div.appendChild(contenedorEstado);

  return div;
}

function actualizarFiltrosTodos() {
  filtrosTodos = {
    desde: document.getElementById('cxf-desde').value,
    hasta: document.getElementById('cxf-hasta').value,
    proveedor: document.getElementById('cxf-proveedor').value,
    material: document.getElementById('cxf-material').value,
    estado: document.getElementById('cxf-estado').value
  };
  llenarVistaTodos();
}

function crearVistaTodos() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxp-todos-wrapper';
  wrapper.style.display = 'none';
  wrapper.appendChild(crearTabsTodos());
  wrapper.appendChild(crearBarraFiltrosTodos());
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.id = 'cxp-todos-tabla-wrapper';
  wrapper.appendChild(tablaWrapper);
  return wrapper;
}

function llenarVistaTodos() {
  const tablaWrapper = document.getElementById('cxp-todos-tabla-wrapper');
  if (!tablaWrapper) return;

  let cuentas = window.EVE.cuentasPorPagar;
  if (tabTodos === 'semana') {
    cuentas = window.EVE_CXP.filtrarCxP(cuentas, { desde: window.obtenerInicioSemana() });
  } else if (tabTodos === 'mes') {
    cuentas = window.EVE_CXP.filtrarCxP(cuentas, { desde: obtenerInicioMes() });
  } else {
    cuentas = window.EVE_CXP.filtrarCxP(cuentas, filtrosTodos);
  }

  tablaWrapper.innerHTML = '';
  const totales = cuentas.reduce((acc, c) => {
    acc.total += c.total; acc.pagado += c.pagado; acc.saldo += c.saldo;
    return acc;
  }, { total: 0, pagado: 0, saldo: 0 });

  const resumen = document.createElement('p');
  resumen.innerHTML = `<strong>Total acumulado:</strong> ${window.formatearMoneda(totales.total)} &nbsp; <strong>Pagado:</strong> ${window.formatearMoneda(totales.pagado)} &nbsp; <strong>Saldo pendiente:</strong> ${window.formatearMoneda(totales.saldo)}`;
  tablaWrapper.appendChild(resumen);

  tablaWrapper.appendChild(crearTablaCuentas(cuentas));
}

function llenarDatalistTicketsProveedor(proveedor) {
  const datalist = document.getElementById('cxp-modal-tickets');
  if (!datalist) return;
  datalist.innerHTML = '';
  window.EVE.cuentasPorPagar
    .filter((c) => c.proveedor === proveedor && c.saldo > 0)
    .forEach((c) => {
      const opcion = document.createElement('option');
      opcion.value = c.ticket;
      datalist.appendChild(opcion);
    });
}

function crearModalPago() {
  const overlay = document.createElement('div');
  overlay.id = 'cxp-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Registrar Pago</h3>
      <form id="cxp-modal-form">
        <p id="cxp-modal-proveedor" style="font-weight:600"></p>
        <input type="text" id="cxp-modal-ticket" placeholder="Ticket específico (opcional — vacío = pago general)" list="cxp-modal-tickets">
        <datalist id="cxp-modal-tickets"></datalist>
        <input type="number" id="cxp-modal-monto" placeholder="Monto" step="0.01" min="0.01" required>
        <input type="date" id="cxp-modal-fecha" required>
        <select id="cxp-modal-referencia">
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Cheque">Cheque</option>
        </select>
        <button type="submit" id="cxp-modal-guardar" class="btn-primary">Guardar</button>
        <button type="button" id="cxp-modal-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#cxp-modal-form').addEventListener('submit', manejarEnvioPago);
  overlay.querySelector('#cxp-modal-cancelar').addEventListener('click', () => cerrarModalPago());
  return overlay;
}

function abrirModalPago(proveedor) {
  modalContexto = { proveedor };
  document.getElementById('cxp-modal-form').reset();
  document.getElementById('cxp-modal-proveedor').textContent = proveedor;
  document.getElementById('cxp-modal-fecha').value = window.obtenerFechaMexico();
  llenarDatalistTicketsProveedor(proveedor);
  document.getElementById('cxp-modal-overlay').classList.add('open');
}

function cerrarModalPago() {
  document.getElementById('cxp-modal-overlay').classList.remove('open');
  modalContexto = null;
}

let envioPagoEnCurso = false;

async function manejarEnvioPago(evento) {
  evento.preventDefault();
  if (!modalContexto || envioPagoEnCurso) return;
  const ticket = document.getElementById('cxp-modal-ticket').value.trim();
  const monto = Number(document.getElementById('cxp-modal-monto').value);
  const fecha = document.getElementById('cxp-modal-fecha').value;
  const referencia = document.getElementById('cxp-modal-referencia').value;
  const usuario = usuarioActual();

  if (!Number.isFinite(monto) || monto <= 0) {
    window.showError('El monto debe ser mayor a 0');
    return;
  }

  const botonGuardar = document.getElementById('cxp-modal-guardar');
  envioPagoEnCurso = true;
  botonGuardar.disabled = true;
  try {
    if (ticket) {
      const cxp = window.EVE.cuentasPorPagar.find((c) => c.proveedor === modalContexto.proveedor && String(c.ticket) === ticket);
      if (!cxp) {
        window.showError('No se encontró una cuenta por pagar para ese ticket');
        return;
      }
      const grupoPagoId = generarGrupoPagoId();
      await window.EVE_CXP.actualizarAbonoCxP(cxp.id, {
        monto, fecha, referencia, registradoPor: usuario, fechaRegistro: new Date().toISOString(), grupoPagoId
      });
      const registroPago = {
        ticket: cxp.ticket,
        proveedor: cxp.proveedor,
        material: cxp.material,
        kg: cxp.kg,
        precioPorKg: cxp.precioEfectivo,
        pagado: monto,
        total: cxp.total,
        iva: window.calcularIvaProrrateado(monto, cxp.total, cxp.iva),
        fecha,
        origen: 'cxp_pago_ticket',
        grupoPagoId
      };
      const idPago = await window.guardarDato('pagos', registroPago);
      window.EVE.registrosPagos.push({ id: idPago, ...registroPago, fechaRegistro: new Date().toISOString() });
    } else {
      const tieneCuentasPendientes = window.EVE.cuentasPorPagar.some(
        (c) => c.proveedor === modalContexto.proveedor && c.saldo > 0
      );
      if (!tieneCuentasPendientes) {
        const confirmado = window.confirm(
          `${modalContexto.proveedor} no tiene cuentas pendientes. Todo el monto (${window.formatearMoneda(monto)}) se registrará como saldo a favor. ¿Deseas continuar?`
        );
        if (!confirmado) return;
      }
      const resultado = await window.EVE_CXP.registrarPagoGeneral(modalContexto.proveedor, monto, fecha, referencia, usuario);
      if (resultado.sobrante > 0) {
        window.showSuccess(`Pago aplicado. Saldo a favor generado: ${window.formatearMoneda(resultado.sobrante)}`);
      }
    }
    cerrarModalPago();
    renderizarVistaActiva();
    window.showSuccess('Pago registrado');
  } catch (error) {
    window.showError(error.message);
  } finally {
    envioPagoEnCurso = false;
    botonGuardar.disabled = false;
  }
}

function crearPadFirma() {
  const contenedor = document.createElement('div');
  contenedor.className = 'firma-pad-contenedor';
  contenedor.innerHTML = `
    <canvas id="firma-pad-canvas" width="400" height="150"></canvas>
    <button type="button" id="firma-pad-limpiar" class="btn-secondary">Limpiar firma</button>
  `;
  const canvas = contenedor.querySelector('#firma-pad-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';
  let dibujando = false;
  let tieneTrazo = false;

  function coordenadasDesdeEvento(evento) {
    const rect = canvas.getBoundingClientRect();
    const escalaX = canvas.width / rect.width;
    const escalaY = canvas.height / rect.height;
    const punto = evento.touches && evento.touches.length ? evento.touches[0] : evento;
    return {
      x: (punto.clientX - rect.left) * escalaX,
      y: (punto.clientY - rect.top) * escalaY
    };
  }

  function iniciarTrazo(evento) {
    evento.preventDefault();
    dibujando = true;
    const { x, y } = coordenadasDesdeEvento(evento);
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function dibujarTrazo(evento) {
    if (!dibujando) return;
    evento.preventDefault();
    const { x, y } = coordenadasDesdeEvento(evento);
    ctx.lineTo(x, y);
    ctx.stroke();
    tieneTrazo = true;
  }

  function detenerTrazo(evento) {
    if (!dibujando) return;
    if (evento) evento.preventDefault();
    dibujando = false;
  }

  canvas.addEventListener('mousedown', iniciarTrazo);
  canvas.addEventListener('mousemove', dibujarTrazo);
  canvas.addEventListener('mouseup', detenerTrazo);
  canvas.addEventListener('mouseleave', detenerTrazo);
  canvas.addEventListener('touchstart', iniciarTrazo, { passive: false });
  canvas.addEventListener('touchmove', dibujarTrazo, { passive: false });
  canvas.addEventListener('touchend', detenerTrazo);

  contenedor.querySelector('#firma-pad-limpiar').addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    tieneTrazo = false;
  });

  return {
    elemento: contenedor,
    estaVacio: () => !tieneTrazo,
    obtenerBase64: () => canvas.toDataURL('image/png')
  };
}

async function manejarGenerarReciboPendiente(proveedor) {
  if (!window.puedeEscribir('cxp')) {
    window.showError('No tienes permiso para generar recibos');
    return;
  }
  const idsSeleccionados = Array.from(ticketsSeleccionadosRecibo);
  const cuentasSeleccionadas = window.EVE.cuentasPorPagar.filter(
    (c) => c.proveedor === proveedor && idsSeleccionados.includes(c.id)
  );
  if (cuentasSeleccionadas.length === 0) {
    window.showError('Selecciona al menos un ticket');
    return;
  }
  const boton = document.getElementById('cxp-btn-generar-recibo');
  if (boton) boton.disabled = true;
  try {
    const tickets = cuentasSeleccionadas.map((c) => ({
      // cuentaId: un mismo ticket puede tener varias cuentas (material/proveedor); Pagos resuelve la cuenta por este id.
      cuentaId: c.id, ticket: c.ticket, material: c.material, kg: c.kg, precio: c.precioEfectivo,
      saldo: c.saldo,
      montoAsignado: montosSeleccionadosRecibo.has(c.id) ? Number(montosSeleccionadosRecibo.get(c.id)) : c.saldo
    }));
    for (const t of tickets) {
      if (!Number.isFinite(t.montoAsignado) || t.montoAsignado <= 0 || t.montoAsignado > t.saldo + 0.01) {
        window.showError(`Monto asignado inválido para el ticket ${t.ticket}`);
        if (boton) boton.disabled = false;
        return;
      }
    }
    const montoTotal = tickets.reduce((suma, t) => suma + Number(t.montoAsignado), 0);
    const fechaGeneracion = new Date().toISOString();
    const generadoPor = usuarioActual();
    const selectFormaPago = document.getElementById('cxp-forma-pago');
    const formaPago = selectFormaPago ? selectFormaPago.value : 'efectivo';
    const recibo = { proveedor, tickets, montoTotal, fechaGeneracion, generadoPor, estado: 'pendiente_pago', formaPago };
    const idRecibo = await window.guardarDato('recibos_pendientes', recibo);
    if (window.EVE.recibosPendientes) {
      window.EVE.recibosPendientes.push({ id: idRecibo, ...recibo });
    }
    generarPDFRecibo({ proveedor, fecha: fechaGeneracion.slice(0, 10), tickets, totalPago: montoTotal, formaPago });
    ticketsSeleccionadosRecibo.clear();
    montosSeleccionadosRecibo.clear();
    window.showSuccess('Recibo pendiente generado. El pago se ejecutará en Pagos > Recibos Pendientes.');
    renderizarVistaActiva();
  } catch (error) {
    window.showError(error.message);
  } finally {
    if (boton) boton.disabled = false;
  }
}

const COLOR_MARCA_PDF = [0, 29, 61];
window.EVE_CXP.COLOR_MARCA_PDF = COLOR_MARCA_PDF;

function iniciarPDFConTitulo(titulo) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const anchoPagina = pdf.internal.pageSize.getWidth();
  let y = 20;
  pdf.setFontSize(18);
  pdf.setFont('helvetica', 'bold');
  pdf.text(titulo, anchoPagina / 2, y, { align: 'center' });
  y += 12;
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  return { pdf, anchoPagina, y };
}

function generarPDFRecibo(recibo, final) {
  const firmado = !!recibo.firmaBase64;
  const esTransferenciaFinal = final === true && recibo.formaPago === 'transferencia';
  const esFinal = firmado || esTransferenciaFinal;

  const inicio = iniciarPDFConTitulo(esFinal ? 'RECIBO DE PAGO' : 'RECIBO PENDIENTE DE PAGO');
  const pdf = inicio.pdf;
  const anchoPagina = inicio.anchoPagina;
  let y = inicio.y;

  pdf.text(`Proveedor: ${recibo.proveedor}`, 14, y);
  y += 6;
  pdf.text(`Fecha: ${window.formatearFecha(recibo.fecha)}`, 14, y);
  y += 6;
  const etiquetaFormaPago = recibo.formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo';
  pdf.text(`Forma de pago: ${etiquetaFormaPago}`, 14, y);
  y += 10;

  pdf.autoTable({
    startY: y,
    head: [['Ticket', 'Material', 'Kg', 'Precio', 'Monto asignado', 'Saldo restante', 'Estado']],
    body: recibo.tickets.map((t) => {
      const esPendiente = t.montoAsignado !== undefined;
      const montoAsignado = esPendiente ? t.montoAsignado : t.monto;
      const saldoRestante = esPendiente ? Math.max(0, Number(t.saldo || 0) - Number(montoAsignado || 0)) : Number(t.saldo || 0);
      const estadoTicket = saldoRestante <= 0.01 ? 'Liquidado' : 'Abono parcial';
      return [t.ticket, t.material, t.kg, window.formatearMoneda(t.precio), window.formatearMoneda(montoAsignado), window.formatearMoneda(saldoRestante), estadoTicket];
    }),
    headStyles: { fillColor: COLOR_MARCA_PDF }
  });
  y = pdf.lastAutoTable.finalY + 10;

  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`TOTAL: ${window.formatearMoneda(recibo.totalPago)}`, 14, y);
  // totalPago sigue siendo la suma de los tickets; el anticipo (excedente a saldo a favor) se muestra aparte.
  const anticipo = Number(recibo.anticipo) || 0;
  if (anticipo > 0.01) {
    y += 7;
    pdf.text(`Anticipo / saldo a favor: ${window.formatearMoneda(anticipo)}`, 14, y);
    y += 7;
    pdf.text(`Total entregado: ${window.formatearMoneda(Number(recibo.totalPago) + anticipo)}`, 14, y);
  }
  y += 12;

  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  if (firmado) {
    pdf.text('Firma:', 14, y);
    y += 4;
    pdf.addImage(recibo.firmaBase64, 'PNG', 14, y, 60, 25);
  } else if (esTransferenciaFinal) {
    pdf.text(`Referencia de transferencia: ${recibo.referenciaTransferencia || '—'}`, 14, y);
    y += 8;
    if (recibo.comprobanteBase64) {
      pdf.text('Comprobante:', 14, y);
      y += 4;
      pdf.addImage(recibo.comprobanteBase64, 'JPEG', 14, y, 60, 60);
    }
  } else {
    pdf.setFont('helvetica', 'italic');
    pdf.text('Firma pendiente — este recibo es preliminar, el pago aún no se ha ejecutado.', 14, y);
  }

  const nombreArchivo = esFinal
    ? `Recibo_Pago_${recibo.proveedor}_${recibo.fecha}.pdf`
    : `Recibo_Pendiente_${recibo.proveedor}_${recibo.fecha}.pdf`;
  pdf.save(nombreArchivo);
}

function renderizarVistaActiva() {
  llenarBarraAlerta();
  llenarResumenGeneral();
  const wrapperProveedores = document.getElementById('cxp-proveedores-wrapper');
  const wrapperTodos = document.getElementById('cxp-todos-wrapper');
  if (wrapperProveedores) wrapperProveedores.style.display = vistaActiva === 'proveedores' ? '' : 'none';
  if (wrapperTodos) wrapperTodos.style.display = vistaActiva === 'todos' ? '' : 'none';
  const botonCaptura = document.getElementById('btn-vista-captura-cxp');
  if (botonCaptura) botonCaptura.style.display = vistaActiva === 'proveedores' ? '' : 'none';
  if (vistaActiva === 'proveedores') {
    llenarVistaProveedores();
  } else {
    llenarVistaTodos();
  }
}

// ── Exportar CSV ──────────────────────────────────────────────────────────

function construirFilasCSVCxPResumen(cuentas) {
  return cuentas.map((c) => ({
    'Ticket': c.ticket,
    'Proveedor': c.proveedor,
    'Material': c.material,
    'Kg': c.kg,
    'Fecha Ticket': c.fechaTicket,
    'Precio Efectivo': c.precioEfectivo,
    'Total': c.total,
    'Pagado': c.pagado,
    'Saldo': c.saldo,
    'Estado': c.estado,
    'Cantidad Abonos': (c.abonos || []).length,
    'Cantidad Abonos Revertidos': (c.abonosRevertidos || []).length
  }));
}

function construirFilasCSVCxPAbonos(cuentas) {
  const filas = [];
  cuentas.forEach((c) => {
    (c.abonos || []).forEach((a) => {
      filas.push({
        'Ticket': c.ticket,
        'Proveedor': c.proveedor,
        'Material': c.material,
        'Monto': a.monto,
        'Fecha': a.fecha,
        'Referencia': a.referencia || '',
        'Registrado Por': a.registradoPor || '',
        'Grupo Pago ID': a.grupoPagoId || '',
        'Estado Abono': 'Activo',
        'Motivo Reversión': '',
        'Revertido Por': '',
        'Fecha Reversión': ''
      });
    });
    (c.abonosRevertidos || []).forEach((a) => {
      filas.push({
        'Ticket': c.ticket,
        'Proveedor': c.proveedor,
        'Material': c.material,
        'Monto': a.monto,
        'Fecha': a.fecha,
        'Referencia': a.referencia || '',
        'Registrado Por': a.registradoPor || '',
        'Grupo Pago ID': a.grupoPagoId || '',
        'Estado Abono': 'Revertido',
        'Motivo Reversión': a.motivo || '',
        'Revertido Por': a.revertidoPor || '',
        'Fecha Reversión': a.fechaReversion || ''
      });
    });
  });
  return filas;
}

function construirFilasCSVCxPResumenProveedor(cuentas) {
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentas);
  const filas = grupos.map((g) => ({
    'Proveedor': g.proveedor,
    'Total': g.total,
    'Pagado': g.pagado,
    'Saldo': g.saldo
  }));
  const totalGeneral = grupos.reduce((suma, g) => suma + g.total, 0);
  const pagadoGeneral = grupos.reduce((suma, g) => suma + g.pagado, 0);
  const saldoGeneral = grupos.reduce((suma, g) => suma + g.saldo, 0);
  filas.push({ 'Proveedor': 'TOTAL GENERAL', 'Total': totalGeneral, 'Pagado': pagadoGeneral, 'Saldo': saldoGeneral });
  return filas;
}

function obtenerCuentasSegunTabActivo() {
  const cuentas = window.EVE.cuentasPorPagar || [];
  const periodoActivo = obtenerPeriodoActivoInfo();
  if (!periodoActivo) return cuentas;
  return window.EVE_CXP.filtrarCxP(cuentas, { desde: periodoActivo.desde, hasta: periodoActivo.hasta });
}

function exportarCxPResumenCSV() {
  const cuentas = obtenerCuentasSegunTabActivo();
  const fecha = window.obtenerFechaMexico();
  window.exportarCSV(construirFilasCSVCxPResumenProveedor(cuentas), `cuentas_por_pagar_resumen_proveedor_${fecha}.csv`);
}

function exportarCxPDetalleCSV() {
  const cuentas = obtenerCuentasSegunTabActivo();
  const fecha = window.obtenerFechaMexico();
  window.exportarCSV(construirFilasCSVCxPResumen(cuentas), `cuentas_por_pagar_detalle_${fecha}.csv`);
  window.exportarCSV(construirFilasCSVCxPAbonos(cuentas), `cuentas_por_pagar_abonos_${fecha}.csv`);
}

// ── Exportar composición de saldo por proveedor (vistas por periodo) ───────

function ordenarCuentasParaVistaCxP(cuentas) {
  const ordenadas = cuentas.slice().sort((a, b) => (a.fechaTicket < b.fechaTicket ? 1 : -1));
  const activas = ordenadas.filter((c) => c.estado !== 'liquidado');
  const liquidadas = ordenadas.filter((c) => c.estado === 'liquidado');
  return activas.concat(liquidadas);
}

function nombreArchivoEstadoCuentaCxP(proveedor, periodo, extension) {
  const etiquetas = { hoy: 'HOY', semana: 'ESTA_SEMANA', mes: 'ESTE_MES', rango: 'RANGO' };
  const proveedorArchivo = proveedor.replace(/\s+/g, '_');
  const periodoArchivo = etiquetas[periodo] || periodo.toUpperCase();
  return `CXP_${proveedorArchivo}_${periodoArchivo}_${window.obtenerFechaMexico()}.${extension}`;
}

function generarPDFEstadoCuentaCxP(grupo, info) {
  const inicio = iniciarPDFConTitulo('ESTADO DE CUENTA - COMPOSICION DE SALDO');
  const pdf = inicio.pdf;
  let y = inicio.y;

  pdf.text(`Proveedor: ${grupo.proveedor}`, 14, y);
  y += 6;
  pdf.text(`Periodo: ${info.nombrePeriodo} (${window.formatearFecha(info.desde)} a ${window.formatearFecha(info.hasta)})`, 14, y);
  y += 6;
  pdf.text(`Fecha de emisión: ${window.formatearFecha(info.fechaEmision)}`, 14, y);
  y += 10;

  const cuentas = ordenarCuentasParaVistaCxP(grupo.cuentas);
  pdf.autoTable({
    startY: y,
    head: [['Ticket', 'Material', 'Kg', 'Precio Efectivo', 'Total', 'Pagado', 'Saldo', 'Estado', 'Fecha']],
    body: cuentas.map((c) => [
      c.ticket, c.material, window.formatearKg(c.kg, c.material),
      window.formatearMoneda(c.precioEfectivo), window.formatearMoneda(c.total),
      window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
      c.estado, window.formatearFecha(c.fechaTicket)
    ]),
    headStyles: { fillColor: COLOR_MARCA_PDF }
  });
  y = pdf.lastAutoTable.finalY + 10;

  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`TOTAL: ${window.formatearMoneda(grupo.total)}   PAGADO: ${window.formatearMoneda(grupo.pagado)}   SALDO: ${window.formatearMoneda(grupo.saldo)}`, 14, y);

  pdf.save(nombreArchivoEstadoCuentaCxP(grupo.proveedor, info.periodo, 'pdf'));
}

function generarTXTEstadoCuentaCxP(grupo, info) {
  const columnas = [
    { titulo: 'Ticket', ancho: 10 }, { titulo: 'Material', ancho: 14 }, { titulo: 'Kg', ancho: 12 },
    { titulo: 'Precio Efectivo', ancho: 16 }, { titulo: 'Total', ancho: 14 }, { titulo: 'Pagado', ancho: 14 },
    { titulo: 'Saldo', ancho: 14 }, { titulo: 'Estado', ancho: 12 }, { titulo: 'Fecha', ancho: 12 }
  ];
  const lineas = [];
  lineas.push('ESTADO DE CUENTA - COMPOSICION DE SALDO');
  lineas.push(`PROVEEDOR: ${grupo.proveedor}`);
  lineas.push(`PERIODO: ${info.nombrePeriodo} (${window.formatearFecha(info.desde)} a ${window.formatearFecha(info.hasta)})`);
  lineas.push(`FECHA DE EMISION: ${window.formatearFecha(info.fechaEmision)}`);
  lineas.push('');
  lineas.push(columnas.map((col) => col.titulo.padEnd(col.ancho)).join(''));
  ordenarCuentasParaVistaCxP(grupo.cuentas).forEach((c) => {
    const valores = [
      String(c.ticket), c.material, window.formatearKg(c.kg, c.material),
      window.formatearMoneda(c.precioEfectivo), window.formatearMoneda(c.total),
      window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
      c.estado, window.formatearFecha(c.fechaTicket)
    ];
    lineas.push(valores.map((valor, indice) => String(valor).padEnd(columnas[indice].ancho)).join(''));
  });
  lineas.push('');
  lineas.push(`TOTAL: ${window.formatearMoneda(grupo.total)}`);
  lineas.push(`PAGADO: ${window.formatearMoneda(grupo.pagado)}`);
  lineas.push(`SALDO: ${window.formatearMoneda(grupo.saldo)}`);
  return lineas.join('\n');
}

function construirFilasCSVEstadoCuentaCxP(grupo) {
  const filas = ordenarCuentasParaVistaCxP(grupo.cuentas).map((c) => ({
    'Ticket': c.ticket,
    'Material': c.material,
    'Kg': c.kg,
    'Precio Efectivo': Number(c.precioEfectivo).toFixed(2),
    'Total': Number(c.total).toFixed(2),
    'Pagado': Number(c.pagado).toFixed(2),
    'Saldo': Number(c.saldo).toFixed(2),
    'Estado': c.estado,
    'Fecha': c.fechaTicket
  }));
  filas.push({
    'Ticket': 'TOTAL', 'Material': '', 'Kg': '', 'Precio Efectivo': '',
    'Total': Number(grupo.total).toFixed(2), 'Pagado': Number(grupo.pagado).toFixed(2), 'Saldo': Number(grupo.saldo).toFixed(2),
    'Estado': '', 'Fecha': ''
  });
  return filas;
}

function exportarCSVConBOM(filas, nombre) {
  const headers = Object.keys(filas[0]);
  const lineasCSV = filas.map((fila) => headers.map((h) => JSON.stringify(fila[h] ?? '')).join(','));
  const csv = '﻿' + [headers.join(','), ...lineasCSV].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  window.descargarArchivo(blob, nombre);
}

function crearBarraExportarEstadoCuentaCxP(grupo, opcionesExportar) {
  const nombresPeriodo = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes', rango: 'Rango' };
  const info = {
    periodo: opcionesExportar.periodo,
    nombrePeriodo: nombresPeriodo[opcionesExportar.periodo] || opcionesExportar.periodo,
    desde: opcionesExportar.desde,
    hasta: opcionesExportar.hasta || window.obtenerFechaMexico(),
    fechaEmision: window.obtenerFechaMexico()
  };

  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  div.style.marginTop = '0.5rem';

  const btnTXT = document.createElement('button');
  btnTXT.className = 'btn-secondary';
  btnTXT.textContent = 'Exportar TXT';
  btnTXT.addEventListener('click', () => {
    const texto = generarTXTEstadoCuentaCxP(grupo, info);
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
    window.descargarArchivo(blob, nombreArchivoEstadoCuentaCxP(grupo.proveedor, info.periodo, 'txt'));
  });
  div.appendChild(btnTXT);

  const btnCSV = document.createElement('button');
  btnCSV.className = 'btn-secondary';
  btnCSV.textContent = 'Exportar CSV';
  btnCSV.addEventListener('click', () => {
    exportarCSVConBOM(construirFilasCSVEstadoCuentaCxP(grupo), nombreArchivoEstadoCuentaCxP(grupo.proveedor, info.periodo, 'csv'));
  });
  div.appendChild(btnCSV);

  const btnPDF = document.createElement('button');
  btnPDF.className = 'btn-secondary';
  btnPDF.textContent = 'Exportar PDF';
  btnPDF.addEventListener('click', () => generarPDFEstadoCuentaCxP(grupo, info));
  div.appendChild(btnPDF);

  return div;
}

function crearBarraExportarCxP() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btnExportarResumen = document.createElement('button');
  btnExportarResumen.textContent = 'Exportar Resumen';
  btnExportarResumen.className = 'btn-secondary';
  btnExportarResumen.addEventListener('click', () => exportarCxPResumenCSV());
  div.appendChild(btnExportarResumen);

  const btnExportarDetalle = document.createElement('button');
  btnExportarDetalle.textContent = 'Exportar Detalle';
  btnExportarDetalle.className = 'btn-secondary';
  btnExportarDetalle.addEventListener('click', () => exportarCxPDetalleCSV());
  div.appendChild(btnExportarDetalle);

  const btnCaptura = document.createElement('button');
  btnCaptura.id = 'btn-vista-captura-cxp';
  btnCaptura.textContent = 'Vista para captura';
  btnCaptura.className = 'btn-secondary';
  btnCaptura.addEventListener('click', abrirVistaCapturaCxP);
  div.appendChild(btnCaptura);
  return div;
}

// ===== Vista para captura (Por Proveedor, todos los tabs de periodo) =====

const formatoMonedaCaptura = (valor) => window.formatearMoneda(valor);

const COLUMNAS_CAPTURA_CXP = [
  { clave: 'ticket', etiqueta: 'Ticket', ancho: '16%', truncar: true },
  { clave: 'material', etiqueta: 'Material', ancho: '30%', truncar: false },
  {
    clave: 'kg', etiqueta: 'Kg', ancho: '16%', alineacion: 'right', truncar: true,
    formato: (valor, fila) => window.formatearKg(fila.kg, fila.material)
  },
  { clave: 'precioEfectivo', etiqueta: 'Precio', ancho: '16%', alineacion: 'right', truncar: true, formato: formatoMonedaCaptura },
  { clave: 'total', etiqueta: 'Total', ancho: '22%', alineacion: 'right', truncar: true, formato: formatoMonedaCaptura }
];

// La columna Saldo solo se agrega al bloque de un proveedor con abonos parciales, para que su subtotal cuadre.
const COLUMNA_SALDO_CAPTURA_CXP = {
  clave: 'saldo', etiqueta: 'Saldo', ancho: '20%', alineacion: 'right', truncar: true, formato: formatoMonedaCaptura
};

// Arma la config de window.VistaCaptura.abrir a partir de las cuentas del periodo activo (las mismas que usan
// Exportar Resumen / Exportar Detalle) y del total adeudado general. Función pura para poder verificarla aparte.
function construirConfigCapturaCxP(cuentas, totalGeneral, periodo) {
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentas)
    .filter((g) => g.saldo > 0)
    .sort((a, b) => b.saldo - a.saldo);
  const totalPeriodo = grupos.reduce((suma, g) => suma + g.saldo, 0);

  const bloques = grupos.map((g) => {
    const filas = g.cuentas
      .filter((c) => c.saldo > 0)
      .sort((a, b) => (a.fechaTicket < b.fechaTicket ? -1 : a.fechaTicket > b.fechaTicket ? 1 : 0));
    const hayAbonos = filas.some((c) => c.pagado > 0);
    return {
      encabezado: g.proveedor,
      subtotal: `Subtotal ${window.formatearMoneda(g.saldo)}`,
      filas,
      columnas: hayAbonos ? COLUMNAS_CAPTURA_CXP.concat(COLUMNA_SALDO_CAPTURA_CXP) : COLUMNAS_CAPTURA_CXP
    };
  });

  return {
    titulo: 'CxP · Por Proveedor',
    periodo,
    kpis: [
      { label: 'Total del periodo', valor: window.formatearMoneda(totalPeriodo) },
      { label: 'Total Adeudado General', valor: window.formatearMoneda(totalGeneral) }
    ],
    resumenSecciones: grupos.length > 0 ? [{
      titulo: 'Saldo por proveedor',
      filas: grupos.map((g) => ({ label: g.proveedor, valor: window.formatearMoneda(g.saldo) })),
      etiquetaLabel: 'Proveedor',
      etiquetaValor: 'Saldo'
    }] : undefined,
    grupos: grupos.length > 0 ? bloques : undefined,
    vacioMensaje: 'Sin saldo pendiente en este periodo'
  };
}

function construirEtiquetaPeriodoCapturaCxP() {
  const periodoActivo = obtenerPeriodoActivoInfo();
  if (!periodoActivo) return 'Todos';
  if (periodoActivo.hasta) {
    const rango = periodoActivo.desde === periodoActivo.hasta
      ? window.formatearFecha(periodoActivo.desde)
      : `${window.formatearFecha(periodoActivo.desde)} al ${window.formatearFecha(periodoActivo.hasta)}`;
    return `${periodoActivo.nombre} · ${rango}`;
  }
  return `${periodoActivo.nombre} · desde ${window.formatearFecha(periodoActivo.desde)}`;
}

function abrirVistaCapturaCxP() {
  const { total: totalGeneral } = calcularTotalAdeudadoGeneral();
  window.VistaCaptura.abrir(
    construirConfigCapturaCxP(obtenerCuentasSegunTabActivo(), totalGeneral, construirEtiquetaPeriodoCapturaCxP())
  );
}

window.EVE_CXP.construirConfigCapturaCxP = construirConfigCapturaCxP;

function renderCxP(container) {
  vistaActiva = 'proveedores';
  proveedorExpandido = null;
  cxpAbonoExpandido = null;
  cxpLiquidadosExpandido = new Set();
  saldoAFavorExpandido = null;
  pendientesSinAuditarExpandido = false;
  tabTodos = 'semana';
  filtrosTodos = { desde: '', hasta: '', proveedor: '', material: '', estado: '' };
  tabProveedorPeriodo = 'todos';
  rangoProveedorDesde = '';
  rangoProveedorHasta = '';

  container.appendChild(crearResumenGeneral());
  container.appendChild(crearBarraAlerta());
  container.appendChild(crearTabsPrincipales());
  container.appendChild(crearBarraExportarCxP());
  container.appendChild(crearVistaProveedores());
  container.appendChild(crearVistaTodos());
  container.appendChild(crearModalPago());

  renderizarVistaActiva();
}

window.EVE_MODULES.cxp = { render: renderCxP };

})();
