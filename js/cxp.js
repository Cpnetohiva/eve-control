(function () {

function fechaCorteVigente() {
  return (window.EVE && window.EVE.fechaCorteAuditoria) || '2026-07-01';
}

function calcularCxP(registro, precioInfo, comisionPorKg) {
  const kg = Number(registro.kg) || 0;
  const precioAplicado = precioInfo.precio;
  const comision = Number(comisionPorKg) || 0;
  const precioEfectivo = precioAplicado + comision;
  const montoMaterial = window.redondearCentavos(kg * precioAplicado);
  const montoComision = window.redondearCentavos(kg * comision);
  const total = window.redondearCentavos(montoMaterial + montoComision);
  return {
    precioAplicado,
    comisionPorKg: comision,
    precioEfectivo,
    montoMaterial,
    montoComision,
    total
  };
}

// Criterio único de saldo: menos de un centavo se considera liquidado. La definición vive en js/utils.js (window.esLiquidadoCxP).
function esLiquidadoCxP(saldo) {
  return window.esLiquidadoCxP(saldo);
}

// Una cuenta está liquidada si su estado guardado lo dice o si su saldo es un residuo menor a un centavo.
function cuentaLiquidadaCxP(cuenta) {
  return cuenta.estado === 'liquidado' || esLiquidadoCxP(cuenta.saldo);
}

function calcularEstado(pagado, saldo) {
  if (esLiquidadoCxP(saldo)) return 'liquidado';
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
  return window.redondearCentavos(movimientos.filter((m) => !m.revertido).reduce((acc, m) => acc + (Number(m.monto) || 0), 0));
}

function aplicarSaldoAFavor(proveedor, docCxP) {
  const saldoDisponible = totalSaldoAFavor(proveedor && proveedor.saldoAFavor);
  if (saldoDisponible <= 0) {
    return { docCxP, aplicado: 0, grupoPagoId: null };
  }
  const aplicado = window.redondearCentavos(Math.min(saldoDisponible, docCxP.saldo));
  const pagado = window.redondearCentavos(docCxP.pagado + aplicado);
  const saldo = window.redondearCentavos(docCxP.saldo - aplicado);
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

// Corte de pago a proveedores en ciclo sábado→viernes (viernes más reciente <= hoy). Ya no define "Esta Semana"
// (esa es lunes a domingo, window.obtenerRangoSemana); se conserva exportado para quien lo necesite.
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
    const { inicio, fin } = window.obtenerRangoSemana(hoy);
    return { desde: inicio, hasta: fin };
  }
  if (periodo === 'mes') return { desde: hoy.slice(0, 7) + '-01', hasta: null };
  if (periodo === 'ultimos30') return { desde: window.obtenerInicioUltimos30Dias(), hasta: hoy };
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
    .filter((c) => !esLiquidadoCxP(c.saldo))
    .slice()
    .sort((a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0));
  let restante = window.redondearCentavos(monto);
  const actualizaciones = [];
  ordenadas.forEach((cuenta) => {
    if (restante <= 0) return;
    const abonoMonto = window.redondearCentavos(Math.min(cuenta.saldo, restante));
    const pagado = window.redondearCentavos(cuenta.pagado + abonoMonto);
    const saldo = window.redondearCentavos(cuenta.saldo - abonoMonto);
    actualizaciones.push({
      id: cuenta.id,
      pagado,
      saldo,
      estado: calcularEstado(pagado, saldo),
      abono: { monto: abonoMonto, fecha, referencia, registradoPor, fechaRegistro: new Date().toISOString(), abonoId: generarAbonoId() }
    });
    restante = window.redondearCentavos(restante - abonoMonto);
  });
  return { actualizaciones, sobrante: restante };
}

// Saldo de una cuenta que aún no está comprometido en recibos pendientes (comprometido: Map id de cuenta -> monto).
function saldoDisponibleCxP(cuenta, comprometido) {
  // Se decide con el saldo sin redondear: un residuo de 0.009 no debe subir a 0.01 y volverse pendiente.
  if (esLiquidadoCxP(cuenta.saldo)) return 0;
  const disponible = window.redondearCentavos(Number(cuenta.saldo) - ((comprometido && comprometido.get(cuenta.id)) || 0));
  return esLiquidadoCxP(disponible) ? 0 : disponible;
}

// Monto que los recibos pendientes (estado pendiente_pago) ya tienen asignado a cada cuenta, como Map id de cuenta -> monto.
// Un renglón sin cuentaId (recibo viejo) se asigna a la cuenta de su mismo proveedor + ticket + material solo si es única con saldo.
function calcularComprometidoPorCuenta(recibos, cuentas) {
  const comprometido = new Map();
  (recibos || []).filter((r) => r.estado === 'pendiente_pago').forEach((recibo) => {
    (recibo.tickets || []).forEach((t) => {
      let id = t.cuentaId;
      if (!id) {
        const candidatas = cuentas.filter((c) => !esLiquidadoCxP(c.saldo)
          && window.normalizarProveedor(c.proveedor) === window.normalizarProveedor(recibo.proveedor)
          && String(c.ticket) === String(t.ticket)
          && window.normalizarMaterial(c.material) === window.normalizarMaterial(t.material));
        if (candidatas.length !== 1) return;
        id = candidatas[0].id;
      }
      const monto = Number(t.montoAsignado !== undefined ? t.montoAsignado : t.monto) || 0;
      comprometido.set(id, window.redondearCentavos((comprometido.get(id) || 0) + monto));
    });
  });
  return comprometido;
}

// Reparto PEPS de un monto total entre cuentas, sin dividir una cuenta en dos: fecha del ticket ascendente, luego número de ticket
// ascendente (numérico) y luego fechaRegistro ascendente. La última cuenta alcanzada puede quedar con pago parcial; el resto no entra.
// Trabaja en centavos enteros, así la suma de lo asignado es exactamente el monto. Devuelve un Map id -> monto asignado.
function compararPEPS(a, b) {
  const fechaA = a.fechaTicket || '';
  const fechaB = b.fechaTicket || '';
  if (fechaA !== fechaB) return fechaA < fechaB ? -1 : 1;
  const ticketA = Number(a.ticket);
  const ticketB = Number(b.ticket);
  const numericos = Number.isFinite(ticketA) && Number.isFinite(ticketB);
  if (numericos && ticketA !== ticketB) return ticketA - ticketB;
  const textoA = String(a.ticket);
  const textoB = String(b.ticket);
  if (!numericos && textoA !== textoB) return textoA < textoB ? -1 : 1;
  const registroA = a.fechaRegistro || '';
  const registroB = b.fechaRegistro || '';
  return registroA < registroB ? -1 : registroA > registroB ? 1 : 0;
}

function repartirMontoPEPS(cuentas, monto) {
  const centavos = Math.round(window.redondearCentavos(monto) * 100);
  const asignaciones = new Map();
  if (!(centavos > 0)) return { ok: false, motivo: 'monto', asignaciones, saldoParticipantes: 0 };
  const ordenadas = cuentas.filter((c) => !esLiquidadoCxP(c.saldo)).slice().sort(compararPEPS);
  const saldoCentavos = (c) => Math.round(c.saldo * 100);
  const totalCentavos = ordenadas.reduce((suma, c) => suma + saldoCentavos(c), 0);
  if (centavos > totalCentavos) return { ok: false, motivo: 'excede', asignaciones, saldoParticipantes: totalCentavos / 100 };
  let restante = centavos;
  for (const cuenta of ordenadas) {
    if (restante <= 0) break;
    const asignado = Math.min(saldoCentavos(cuenta), restante);
    asignaciones.set(cuenta.id, asignado / 100);
    restante -= asignado;
  }
  return { ok: true, asignaciones, saldoParticipantes: totalCentavos / 100 };
}

// Participan las filas que el usuario marcó a mano (manuales) o, si no marcó ninguna, todas las cuentas con saldo. Si el monto no
// alcanza para cubrirlas no se reparte nada: devuelve { ok: false, error } con el aviso (y, si además rebasa el saldo total del
// proveedor, la nota de que el excedente es anticipo en Ejecutar pago).
function planificarRepartoRecibo(cuentas, manuales, monto, saldoProveedor, comprometido) {
  // Solo se reparte el saldo disponible: el ya comprometido en otros recibos pendientes (pendiente_pago) no se vuelve a asignar.
  const conSaldo = cuentas.map((c) => ({ ...c, saldo: saldoDisponibleCxP(c, comprometido) })).filter((c) => !esLiquidadoCxP(c.saldo));
  const marcadas = conSaldo.filter((c) => manuales && manuales.has(c.id));
  const modoManual = marcadas.length > 0;
  const resultado = repartirMontoPEPS(modoManual ? marcadas : conSaldo, monto);
  if (resultado.ok) return { ...resultado, modoManual };
  if (resultado.motivo === 'monto') return { ...resultado, modoManual, error: 'El monto total del recibo debe ser mayor a 0' };
  const montoNumero = Number(monto);
  let error = `El monto (${window.formatearMoneda(montoNumero)}) es mayor a la suma de los saldos de las cuentas ${modoManual ? 'marcadas' : 'del proveedor'} (${window.formatearMoneda(resultado.saldoParticipantes)}). No se repartió nada.`;
  const totalComprometido = comprometido ? cuentas.reduce((suma, c) => suma + (comprometido.get(c.id) || 0), 0) : 0;
  if (totalComprometido > 0.005) error += ` Ya se descontaron ${window.formatearMoneda(totalComprometido)} comprometidos en recibos pendientes.`;
  if (montoNumero > (Number(saldoProveedor) || 0) + 0.005) {
    error += ` El monto excede el saldo total del proveedor (${window.formatearMoneda(saldoProveedor)}): el excedente se maneja como anticipo en Ejecutar pago.`;
  }
  return { ...resultado, modoManual, error };
}

function aplicarAbono(cxp, abonoOriginal) {
  const abono = { ...abonoOriginal, monto: window.redondearCentavos(abonoOriginal.monto) };
  const pagado = window.redondearCentavos(cxp.pagado + abono.monto);
  const saldo = Math.max(0, window.redondearCentavos(cxp.saldo - abono.monto));
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
  esLiquidadoCxP,
  yaExisteCxP,
  construirDocCxP,
  aplicarSaldoAFavor,
  agregarPorProveedorCxP,
  agregarPorClave,
  filtrarCxP,
  filtrarGenerico,
  listarPendientesSinAuditar,
  distribuirPago,
  repartirMontoPEPS,
  planificarRepartoRecibo,
  saldoDisponibleCxP,
  calcularComprometidoPorCuenta,
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
  const resumen = await window.protegerContraDobleRegistro('cxp-desde-auditoria', async () => {
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
  });
  // Llamada ignorada (otra en curso o recién terminada): resumen vacío para que quien llama no falle.
  return resumen || { generadas: 0, omitidas: [] };
}

async function generarCxPSinFoto() {
  const resumen = await window.protegerContraDobleRegistro('cxp-sin-foto', async () => {
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
  });
  // Llamada ignorada (otra en curso o recién terminada): resumen vacío para que quien llama no falle.
  return resumen || { generadas: 0, omitidas: [] };
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
  deseleccionarProveedorCxP(cxp.proveedor);
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
  const pagado = window.redondearCentavos(abonos.reduce((acc, a) => acc + (Number(a.monto) || 0), 0));
  const saldo = window.redondearCentavos(cxp.total - pagado);
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
      if (esLiquidadoCxP(cuenta.saldo)) throw new Error(`La cuenta del ticket ${cuenta.ticket} ya no tiene saldo`);
      const solicitado = Number(pedidas[i].monto);
      if (solicitado > cuenta.saldo + 0.01) {
        throw new Error(`El monto para el ticket ${cuenta.ticket} excede su saldo (${window.formatearMoneda(cuenta.saldo)})`);
      }
      return { cuenta, monto: window.redondearCentavos(Math.min(solicitado, cuenta.saldo)), grupoPagoId: generarGrupoPagoId(), abonoId: generarAbonoId() };
    });
    const disponible = totalSaldoAFavor(datosProveedor.saldoAFavor);
    const total = window.redondearCentavos(planes.reduce((acc, p) => acc + p.monto, 0));
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
  const montoMaterial = window.redondearCentavos(kg * precioBase);
  const montoComision = window.redondearCentavos(kg * comisionPorKg);
  const total = window.redondearCentavos(montoMaterial + montoComision + window.redondearCentavos(iva));
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
  const ivaNum = window.redondearCentavos(iva);
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
  // El material también vive en Báscula (origen del ticket): se cambia en el mismo lote. Sin registro claro de Báscula se bloquea.
  const fila = await localizarBasculaDeCxP(cxp);
  await guardarEdicionBasculaConCxP({ cxp, cambiosCxP: cambios, basculaId: fila.id, cambiosBascula: { material: materialUpper }, basculaAnterior: fila, motivo });
}

// ── Corrección de kg entre Báscula (Destaraje) y CxP ─────────────────────────────────────────────────────────────────────
// Regla común: una CxP solo se corrige si no tiene abonos activos. El saldo a favor aplicado (aplicarSaldoAFavor) se guarda
// como un abono más de la cuenta (referencia "Saldo a favor aplicado automáticamente"), así que también la bloquea: al
// revertir ese abono el monto regresa al saldo a favor del proveedor y la cuenta vuelve a ser editable.
const MENSAJE_CXP_CON_ABONOS = 'Revierte los abonos de la CxP primero';
const MOTIVO_CORRECCION_KG_BASCULA = 'Corrección de peso en Báscula';

function esCxPSaldoInicial(cxp) {
  return window.esCuentaSaldoInicial(cxp);
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

// ── Edición de un ticket de Báscula que ya tiene CxP ─────────────────────────────────────────────────────────────────────
// Báscula es el origen de ticket, proveedor, material, kg y fecha de entrada; la CxP guarda lo mismo (más precio y total) y debe
// cambiar junto, en un solo lote. Casos al editar un ticket (validarEdicionBascula):
//   A) sin CxP ligada: edición libre, solo destaraje.            B) con CxP y sin pagos: destaraje + CxP en una transacción.
//   C) con pagos, abonos, saldo a favor aplicado o recibo pendiente: se bloquea.   D) ambiguo (filas indistinguibles): se bloquea.
//   E) sin permiso de escritura en cxp (o sin poder verificarlo): se bloquea.      F) sin conexión y con CxP: se bloquea.
const MENSAJE_EDICION_PAGOS = 'Este ticket tiene pagos: revierte los pagos en CxP/Pagos y vuelve a editar.';
const MENSAJE_EDICION_SIN_PRECIO = 'No hay precio vigente para el material nuevo con esa fecha y proveedor. Captura el precio en Precios antes de cambiar el material.';
const MENSAJE_EDICION_PERMISO = 'Este ticket ya tiene cuenta por pagar: solo Admin puede corregirlo.';
const MENSAJE_EDICION_AMBIGUO = 'El ticket tiene varias filas que no se pueden distinguir; revisalo en CxP.';
// Mensaje que daba prepararCorreccionKgDesdeBascula (antes de A4) al editar el kg sin lectura de CxP.
const MENSAJE_KG_SOLO_DESDE_CXP = 'El kg de un ticket solo se corrige desde CxP. Avisa al responsable de CxP para que use Editar kg.';
const MENSAJE_EDICION_SIN_CONEXION = 'Sin conexión: un ticket con cuenta por pagar no se puede editar sin internet.';
const MOTIVO_EDICION_BASCULA = 'Edición del ticket en Báscula';

const mismoKg = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= 0.01;

// Campos de Báscula que la CxP replica, con su valor normalizado para compararlos.
function camposEdicionBascula(r) {
  return {
    ticket: String(r.ticket === undefined || r.ticket === null ? '' : r.ticket).trim(),
    proveedor: window.normalizarProveedor(r.proveedor),
    material: window.normalizarMaterial(r.material),
    kg: Number(r.kg) || 0,
    fechaEntrada: String(r.fechaEntrada || '')
  };
}

function camposCambiadosBascula(anterior, nuevo) {
  const a = camposEdicionBascula(anterior);
  const n = camposEdicionBascula(nuevo);
  return Object.keys(a).filter((campo) => (campo === 'kg' ? !mismoKg(a.kg, n.kg) : a[campo] !== n[campo]));
}

function plantillaResultadoEdicion(caso, mensaje, extra) {
  return { caso, mensaje: mensaje || '', permitido: caso === 'A' || (caso === 'B' && !mensaje), ...extra };
}

// Documentos de pagos no revertidos de la misma cuenta (ticket + proveedor + material), en memoria y con lectura fresca.
async function pagosVigentesDeLaCuenta(cxp) {
  const proveedor = window.normalizarProveedor(cxp.proveedor);
  const material = window.normalizarMaterial(cxp.material);
  const coincide = (p) => !p.revertido && !p.abonoSaldoInicial && String(p.ticket) === String(cxp.ticket)
    && window.normalizarProveedor(p.proveedor) === proveedor && window.normalizarMaterial(p.material) === material;
  const enMemoria = (window.EVE.registrosPagos || []).filter(coincide);
  let frescos = [];
  try {
    frescos = (await consultarPorTicket('pagos', cxp.ticket)).filter(coincide);
  } catch (error) {
    frescos = []; // sin lectura de pagos: quedan los abonos de la cuenta (cada pago genera su abono) y la memoria
  }
  return enMemoria.length + frescos.length;
}

// Valida la edición de un ticket de Báscula ANTES de escribir nada. anterior/nuevo: registros de Báscula (ticket, proveedor, material,
// kg, fechaEntrada). contexto: { basculaId, motivo }. Devuelve { caso: 'A'..'F', permitido, mensaje, cxp?, cambiosCxP? }. No escribe.
async function validarEdicionBascula(anterior, nuevo, contexto) {
  const ctx = contexto || {};
  if (!anterior || camposCambiadosBascula(anterior, nuevo).length === 0) return plantillaResultadoEdicion('A');
  // Operador sin lectura de CxP (no ve montos): no se lee cuentas_por_pagar, pagos ni recibos. Como antes de A4, ticket, proveedor,
  // material y fecha de entrada se escriben libres solo en Báscula; el kg se bloquea con el mismo mensaje que daba entonces.
  if (!window.puedeLeer('cxp')) {
    return camposCambiadosBascula(anterior, nuevo).includes('kg')
      ? plantillaResultadoEdicion('E', MENSAJE_KG_SOLO_DESDE_CXP)
      : plantillaResultadoEdicion('A');
  }
  const proveedorAnterior = window.normalizarProveedor(anterior.proveedor);
  const delTicket = (c) => String(c.ticket) === String(anterior.ticket) && window.normalizarProveedor(c.proveedor) === proveedorAnterior;

  if (!navigator.onLine) {
    const enMemoria = (window.EVE.cuentasPorPagar || []).some(delTicket);
    return enMemoria ? plantillaResultadoEdicion('F', MENSAJE_EDICION_SIN_CONEXION) : plantillaResultadoEdicion('A');
  }

  // Lectura fresca de las CxP del ticket. Si no se puede leer (sin permiso), no se puede descartar una CxP: se bloquea.
  let cuentas;
  try {
    cuentas = (await consultarPorTicket('cuentas_por_pagar', anterior.ticket)).filter(delTicket);
  } catch (error) {
    return plantillaResultadoEdicion('E', MENSAJE_EDICION_PERMISO);
  }
  if (cuentas.length === 0) return plantillaResultadoEdicion('A');

  if (!window.puedeEscribir('cxp')) return plantillaResultadoEdicion('E', MENSAJE_EDICION_PERMISO);

  // D) ambigüedad: varias CxP que no se distinguen, o varias filas idénticas del ticket en Báscula.
  const cxp = elegirFilaDelTicket(cuentas, anterior);
  if (!cxp) return plantillaResultadoEdicion('D', MENSAJE_EDICION_AMBIGUO);
  try {
    const filasBascula = (await consultarPorTicket('destaraje', anterior.ticket)).filter(delTicket);
    const iguales = filasBascula.filter((f) => window.normalizarMaterial(f.material) === window.normalizarMaterial(anterior.material) && mismoKg(f.kg, anterior.kg));
    if (iguales.length > 1) return plantillaResultadoEdicion('D', MENSAJE_EDICION_AMBIGUO);
  } catch (error) {
    // Sin lectura de Báscula no hay edición posible (el usuario necesita escribirla); se sigue con lo demás.
  }
  if (esCxPSaldoInicial(cxp)) return plantillaResultadoEdicion('D', MENSAJE_EDICION_AMBIGUO);

  // C) pagos: abonos (incluye el saldo a favor aplicado), documentos de pagos y lectura fresca de la cuenta.
  if (tieneAbonosActivos(cxp)) return plantillaResultadoEdicion('C', MENSAJE_EDICION_PAGOS);
  try {
    await verificarSinPagosFrescos(cxp);
  } catch (error) {
    return /pago/i.test(error.message) ? plantillaResultadoEdicion('C', MENSAJE_EDICION_PAGOS) : plantillaResultadoEdicion('D', MENSAJE_EDICION_AMBIGUO);
  }
  if (tieneAbonosActivos(cxp) || (await pagosVigentesDeLaCuenta(cxp)) > 0) return plantillaResultadoEdicion('C', MENSAJE_EDICION_PAGOS);
  // Un recibo pendiente de pago guarda el proveedor y el reparto de la cuenta: también bloquea (mismo caso C).
  try {
    const recibos = await consultarRecibosPendientesProveedor(cxp.proveedor);
    if (calcularComprometidoPorCuenta(recibos, [cxp]).has(cxp.id)) return plantillaResultadoEdicion('C', MENSAJE_CXP_EN_RECIBO_PENDIENTE);
  } catch (error) {
    // Sin lectura de recibos pendientes: los pagos y abonos ya se revisaron arriba.
  }

  // B) precio y total: con material, proveedor o fecha de entrada nuevos se vuelve a consultar el precio vigente; si solo cambian el
  // ticket o el kg se conserva el precio congelado de la cuenta (como la corrección de kg).
  const n = camposEdicionBascula(nuevo);
  const a = camposEdicionBascula(anterior);
  const cambiaPrecio = n.material !== a.material || n.proveedor !== a.proveedor || n.fechaEntrada !== a.fechaEntrada;
  const comision = Number(cxp.comisionPorKg) || 0;
  const extras = {};
  let precioBase;
  if (cambiaPrecio) {
    const precioInfo = window.obtenerPrecioVigente(n.material, n.fechaEntrada, n.proveedor);
    if (!precioInfo) return plantillaResultadoEdicion('B', MENSAJE_EDICION_SIN_PRECIO);
    precioBase = precioInfo.precio;
    Object.assign(extras, {
      precioAplicado: precioInfo.precio,
      precioBase: precioInfo.precioBase !== undefined ? precioInfo.precioBase : precioInfo.precio,
      ajusteProveedorAplicado: precioInfo.ajusteProveedorAplicado || null,
      precioNegociado: null,
      motivoAjustePrecio: null
    });
  } else {
    precioBase = cxp.precioNegociado !== null && cxp.precioNegociado !== undefined ? Number(cxp.precioNegociado) : Number(cxp.precioAplicado);
    if (!Number.isFinite(precioBase)) return plantillaResultadoEdicion('B', MENSAJE_EDICION_SIN_PRECIO);
  }
  const montos = recalcularMontosCxP(n.kg, precioBase, comision, cxp.iva);
  const cambiosCxP = {
    ticket: n.ticket,
    proveedor: n.proveedor,
    material: n.material,
    kg: n.kg,
    fechaTicket: n.fechaEntrada,
    ...extras,
    ...montos,
    pagado: 0,
    estado: calcularEstado(0, montos.saldo),
    motivoEdicionBascula: ctx.motivo || MOTIVO_EDICION_BASCULA
  };
  if (n.ticket !== a.ticket) cambiosCxP.ticketAnterior = String(cxp.ticket);
  if (n.proveedor !== a.proveedor) cambiosCxP.proveedorAnterior = cxp.proveedor;
  if (n.material !== a.material) cambiosCxP.materialAnterior = cxp.material;
  if (!mismoKg(n.kg, a.kg)) cambiosCxP.kgAnterior = Number(cxp.kg) || 0;
  if (n.fechaEntrada !== a.fechaEntrada) cambiosCxP.fechaTicketAnterior = cxp.fechaTicket;
  return plantillaResultadoEdicion('B', '', { cxp, cambiosCxP, basculaId: ctx.basculaId || null });
}

// Escribe destaraje y la CxP en UNA transacción con lectura fresca dentro de la operación (como registrarCobroFactura en CxC): si
// aparece un pago, o el registro de Báscula cambió, no se escribe nada. Actualiza la memoria y deja historial en las dos colecciones.
// basculaAnterior: el registro de Báscula antes del cambio (para el historial y para detectar que cambió mientras se editaba).
async function guardarEdicionBasculaConCxP({ cxp, cambiosCxP, basculaId, cambiosBascula, basculaAnterior, motivo }) {
  if (!navigator.onLine) throw new Error(MENSAJE_EDICION_SIN_CONEXION);
  if (!basculaId) throw new Error(MENSAJE_EDICION_AMBIGUO);
  const refCxp = window.db.collection('cuentas_por_pagar').doc(cxp.id);
  const refBascula = window.db.collection('destaraje').doc(basculaId);
  await window.db.runTransaction(async (tx) => {
    const docCxp = await tx.get(refCxp);
    if (!docCxp.exists) throw new Error('Esta cuenta ya no existe — probablemente fue eliminada. Recarga la página.');
    if (tieneAbonosActivos(docCxp.data())) throw new Error(MENSAJE_EDICION_PAGOS);
    const docBascula = await tx.get(refBascula);
    if (!docBascula.exists) throw new Error('El registro de Báscula ya no existe. Recarga la página.');
    if (basculaAnterior) {
      const actual = camposEdicionBascula(docBascula.data());
      const previo = camposEdicionBascula(basculaAnterior);
      if (camposCambiadosBascula(docBascula.data(), basculaAnterior).length > 0 || actual.ticket !== previo.ticket) {
        throw new Error('El registro de Báscula cambió mientras se editaba. Recarga la página e inténtalo de nuevo.');
      }
    }
    tx.update(refCxp, cambiosCxP);
    tx.update(refBascula, cambiosBascula);
  });

  const enMemoria = (window.EVE.cuentasPorPagar || []).find((c) => c.id === cxp.id);
  const cxpAntes = { ticket: cxp.ticket, proveedor: cxp.proveedor, material: cxp.material, kg: cxp.kg, fechaTicket: cxp.fechaTicket, precioAplicado: cxp.precioAplicado, total: cxp.total };
  Object.assign(enMemoria || cxp, cambiosCxP);
  [window.EVE.registrosDestaraje, window.EVE.registrosDestarajeRaw].forEach((lista) => {
    const registro = (lista || []).find((r) => r.id === basculaId);
    if (registro) Object.assign(registro, cambiosBascula);
  });
  const motivoLimpio = (motivo || cambiosCxP.motivoEdicionBascula || MOTIVO_EDICION_BASCULA).toString();
  window.EVE_HISTORIAL.registrar({
    coleccion: 'cuentas_por_pagar',
    registroId: cxp.id,
    accion: 'edicion',
    valorAnterior: cxpAntes,
    valorNuevo: { ticket: cambiosCxP.ticket !== undefined ? cambiosCxP.ticket : cxp.ticket, proveedor: cambiosCxP.proveedor !== undefined ? cambiosCxP.proveedor : cxpAntes.proveedor,
      material: cambiosCxP.material !== undefined ? cambiosCxP.material : cxpAntes.material, kg: cambiosCxP.kg !== undefined ? cambiosCxP.kg : cxpAntes.kg,
      fechaTicket: cambiosCxP.fechaTicket !== undefined ? cambiosCxP.fechaTicket : cxpAntes.fechaTicket,
      precioAplicado: cambiosCxP.precioAplicado !== undefined ? cambiosCxP.precioAplicado : cxpAntes.precioAplicado,
      total: cambiosCxP.total !== undefined ? cambiosCxP.total : cxpAntes.total },
    motivo: motivoLimpio
  });
  const antes = basculaAnterior || {};
  window.EVE_HISTORIAL.registrar({
    coleccion: 'destaraje',
    registroId: basculaId,
    accion: 'edicion',
    valorAnterior: { ticket: antes.ticket, proveedor: antes.proveedor, material: antes.material, kg: antes.kg, fechaEntrada: antes.fechaEntrada, fechaSalida: antes.fechaSalida },
    valorNuevo: { ...antes, ...cambiosBascula },
    motivo: motivoLimpio
  });
}

// Lado CxP: el registro de Báscula del mismo ticket + proveedor al que corresponde esta cuenta. Sin permiso de escritura en Báscula,
// sin registro o con registros indistinguibles se bloquea (mensaje de ambiguo).
async function localizarBasculaDeCxP(cxp) {
  if (!window.puedeEscribir('destaraje')) {
    throw new Error('Este cambio también actualiza el registro de Báscula del ticket y tu usuario no tiene permiso de escritura en Báscula.');
  }
  if (!navigator.onLine) throw new Error(MENSAJE_EDICION_SIN_CONEXION);
  const proveedor = window.normalizarProveedor(cxp.proveedor);
  const filas = (await consultarPorTicket('destaraje', cxp.ticket)).filter((r) => window.normalizarProveedor(r.proveedor) === proveedor);
  const fila = elegirFilaDelTicket(filas, cxp);
  const iguales = filas.filter((f) => window.normalizarMaterial(f.material) === window.normalizarMaterial(cxp.material) && mismoKg(f.kg, cxp.kg));
  if (!fila || iguales.length > 1) throw new Error(MENSAJE_EDICION_AMBIGUO);
  return fila;
}

// ── Desalineación entre Báscula y CxP (solo se detecta y se avisa a Admin; nunca se corrige sola) ─────────────────────────────
// Función pura: no lee Firestore. historial (opcional): entradas de historial_cambios que ya estén en memoria; sin ellas, quién editó y
// cuándo salen vacíos. Devuelve una lista de { ticket, campo, bascula, cxp, editadoPor, fecha }. Sin montos: solo ticket, material,
// proveedor, kg y fecha de entrada. El ticket 'V' (legado de ventas) se excluye; un ticket sin CxP no se marca (pendiente de aprobar).
function detectarDesalineacionBasculaCxP(registrosDestaraje, cuentasPorPagar, historial) {
  const resultado = [];
  const porTicket = (lista) => {
    const mapa = new Map();
    (lista || []).forEach((r) => {
      const t = String(r.ticket === undefined || r.ticket === null ? '' : r.ticket).trim();
      if (!t || t.toUpperCase() === 'V') return;
      if (!mapa.has(t)) mapa.set(t, []);
      mapa.get(t).push(r);
    });
    return mapa;
  };
  const bascula = porTicket(registrosDestaraje);
  const cuentas = porTicket((cuentasPorPagar || []).filter((c) => !esCxPSaldoInicial(c)));
  const ultimaEdicion = (ticket) => {
    const entradas = (historial || []).filter((h) => h && h.accion === 'edicion' && (h.coleccion === 'destaraje' || h.coleccion === 'cuentas_por_pagar')
      && ((h.valorNuevo && String(h.valorNuevo.ticket) === ticket) || (h.valorAnterior && String(h.valorAnterior.ticket) === ticket)));
    entradas.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    return entradas[0] ? { editadoPor: entradas[0].usuario || '', fecha: entradas[0].timestamp || '' } : { editadoPor: '', fecha: '' };
  };
  const agregar = (ticket, campo, valorBascula, valorCxp) => resultado.push({ ticket, campo, bascula: valorBascula, cxp: valorCxp, ...ultimaEdicion(ticket) });

  const tickets = Array.from(new Set([...bascula.keys(), ...cuentas.keys()]))
    .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  tickets.forEach((ticket) => {
    const filas = bascula.get(ticket) || [];
    const libres = (cuentas.get(ticket) || []).slice();
    if (filas.length === 0) {
      libres.forEach(() => agregar(ticket, 'renglón', 'CxP sin renglón en Báscula', 'CxP'));
      return;
    }
    // Emparejamiento por número de ticket: primero material y kg iguales, luego material, luego cualquier cuenta libre; cada CxP una vez.
    const pares = [];
    const pendientes = filas.slice();
    const pasada = (criterio) => {
      for (let i = pendientes.length - 1; i >= 0; i -= 1) {
        const fila = pendientes[i];
        const cxp = libres.find((c) => criterio(fila, c));
        if (cxp) { libres.splice(libres.indexOf(cxp), 1); pares.push([fila, cxp]); pendientes.splice(i, 1); }
      }
    };
    pasada((f, c) => window.normalizarMaterial(f.material) === window.normalizarMaterial(c.material) && mismoKg(f.kg, c.kg));
    pasada((f, c) => window.normalizarMaterial(f.material) === window.normalizarMaterial(c.material));
    pasada(() => true);
    pares.forEach(([fila, cxp]) => {
      if (window.normalizarMaterial(fila.material) !== window.normalizarMaterial(cxp.material)) agregar(ticket, 'material', window.normalizarMaterial(fila.material), window.normalizarMaterial(cxp.material));
      if (window.normalizarProveedor(fila.proveedor) !== window.normalizarProveedor(cxp.proveedor)) agregar(ticket, 'proveedor', window.normalizarProveedor(fila.proveedor), window.normalizarProveedor(cxp.proveedor));
      if (!mismoKg(fila.kg, cxp.kg)) agregar(ticket, 'kg', Number(fila.kg) || 0, Number(cxp.kg) || 0);
      if (String(fila.fechaEntrada || '') !== String(cxp.fechaTicket || '')) agregar(ticket, 'fecha de entrada', fila.fechaEntrada || '', cxp.fechaTicket || '');
    });
    // CxP que sobran (más cuentas que renglones) se marcan sin renglón; renglones que sobran son pendientes de aprobar y no se marcan.
    libres.forEach(() => agregar(ticket, 'renglón', 'CxP sin renglón en Báscula', 'CxP'));
  });
  return resultado;
}

// Cantidad de tickets distintos con diferencias.
function contarTicketsDesalineados(diferencias) {
  return new Set((diferencias || []).map((d) => d.ticket)).size;
}

// Aviso para Admin: solo con lectura de cxp Y de destaraje. Sin lecturas nuevas de Firestore: usa lo que ya está en memoria y se
// recalcula cada vez que se llama (al pintar Báscula o CxP). contenedor: div donde se pinta; queda oculto si no hay diferencias.
function renderizarAvisoDesalineacion(contenedor) {
  if (!contenedor) return 0;
  contenedor.innerHTML = '';
  contenedor.style.display = 'none';
  if (!window.puedeLeer('cxp') || !window.puedeLeer('destaraje')) return 0;
  const diferencias = detectarDesalineacionBasculaCxP(window.EVE.registrosDestaraje, window.EVE.cuentasPorPagar, window.EVE.historialCambios);
  const n = contarTicketsDesalineados(diferencias);
  if (n === 0) return 0;
  contenedor.className = 'card';
  contenedor.style.cssText = 'background:#fff8e1;border:1px solid #f5c542;color:#6b4e00;display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap';
  contenedor.style.display = 'flex';
  const texto = document.createElement('span');
  texto.textContent = `${n} ticket${n === 1 ? '' : 's'} con diferencias entre Báscula y CxP`;
  const boton = document.createElement('button');
  boton.className = 'btn-secondary';
  boton.textContent = 'Ver';
  boton.addEventListener('click', () => abrirModalDesalineacion(diferencias));
  contenedor.appendChild(texto);
  contenedor.appendChild(boton);
  return n;
}

function abrirModalDesalineacion(diferencias) {
  const previo = document.getElementById('desalineacion-overlay');
  if (previo) previo.remove();
  const overlay = document.createElement('div');
  overlay.id = 'desalineacion-overlay';
  overlay.className = 'modal-overlay open';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Tickets con diferencias entre Báscula y CxP';
  modal.appendChild(titulo);
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = '<thead><tr><th>Ticket</th><th>Campo</th><th>En Báscula</th><th>En CxP</th><th>Editó</th><th>Cuándo</th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  diferencias.forEach((d) => {
    const fila = document.createElement('tr');
    [d.ticket, d.campo, d.bascula, d.cxp, d.editadoPor || '—', d.fecha ? window.formatearFecha(String(d.fecha).slice(0, 10)) : '—'].forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = String(valor);
      fila.appendChild(celda);
    });
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);
  modal.appendChild(tabla);
  const cerrar = document.createElement('button');
  cerrar.className = 'btn-secondary';
  cerrar.textContent = 'Cerrar';
  cerrar.addEventListener('click', () => overlay.remove());
  modal.appendChild(cerrar);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
}

// ── Cambio de proveedor de una cuenta ───────────────────────────────────────────────────────────────────────────────────
// Mismas reglas que editar material/kg: solo sin abonos (el saldo a favor aplicado también es un abono) y, además, sin recibo
// pendiente_pago (el recibo guarda el proveedor y el reparto de la cuenta) y sin ser saldo inicial. El saldo a favor del proveedor
// nuevo solo se avisa: aplicarlo es una decisión aparte (Aplicar saldo a favor).
const MOTIVO_CORRECCION_PROVEEDOR_BASCULA = 'Corrección de proveedor desde Báscula';
const MENSAJE_CXP_EN_RECIBO_PENDIENTE = 'La cuenta está incluida en un recibo pendiente de pago: cancela el recibo primero';

function nombresProveedoresCxP() {
  const nombres = new Set();
  (window.EVE.cuentasPorPagar || []).forEach((c) => { if (c.proveedor) nombres.add(window.normalizarProveedor(c.proveedor)); });
  (window.EVE.proveedores || []).forEach((p) => { if (p.nombre) nombres.add(window.normalizarProveedor(p.nombre)); });
  return Array.from(nombres).sort();
}

function saldoAFavorDisponibleProveedor(nombre) {
  const clave = window.normalizarProveedor(nombre);
  const registro = (window.EVE.proveedores || []).find((p) => window.normalizarProveedor(p.nombre) === clave);
  return Math.round(totalSaldoAFavor(registro && registro.saldoAFavor) * 100) / 100;
}

// Lanza el error que bloquea el cambio. Relee la cuenta (abonos desde otra sesión) y los recibos pendientes del proveedor.
async function validarCxPEditableProveedor(cxp) {
  if (esCxPSaldoInicial(cxp)) {
    throw new Error('Esta cuenta es un saldo inicial histórico: su proveedor no se puede cambiar.');
  }
  const conAbonos = `La cuenta tiene abonos aplicados. ${MENSAJE_CXP_CON_ABONOS}`;
  if (tieneAbonosActivos(cxp)) throw new Error(conAbonos);
  await verificarSinPagosFrescos(cxp);
  if (tieneAbonosActivos(cxp)) throw new Error(conAbonos);
  const recibos = await consultarRecibosPendientesProveedor(cxp.proveedor);
  if (calcularComprometidoPorCuenta(recibos, window.EVE.cuentasPorPagar).has(cxp.id)) {
    throw new Error(MENSAJE_CXP_EN_RECIBO_PENDIENTE);
  }
}

async function editarProveedorCxP(cxpId, proveedorNuevo, motivo, editadoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  if (!window.puedeEscribir('cxp')) {
    throw new Error('Cambiar el proveedor de una cuenta requiere permiso de escritura en CxP.');
  }
  const motivoLimpio = (motivo || '').toString().trim();
  if (!motivoLimpio) throw new Error('El motivo es obligatorio');
  const proveedor = window.normalizarProveedor(proveedorNuevo);
  if (!proveedor) throw new Error('El proveedor es obligatorio');
  if (proveedor === window.normalizarProveedor(cxp.proveedor)) {
    throw new Error('El proveedor nuevo debe ser distinto al actual');
  }
  await validarCxPEditableProveedor(cxp);
  const cambios = { proveedor, proveedorAnterior: cxp.proveedor, motivoCambioProveedor: motivoLimpio };
  // El proveedor también vive en Báscula (origen del ticket): se cambia en el mismo lote. Sin registro claro de Báscula se bloquea.
  const fila = await localizarBasculaDeCxP(cxp);
  await guardarEdicionBasculaConCxP({ cxp, cambiosCxP: cambios, basculaId: fila.id, cambiosBascula: { proveedor }, basculaAnterior: fila, motivo: motivoLimpio });
  return { proveedorAnterior: cambios.proveedorAnterior, proveedorNuevo: proveedor, saldoAFavorNuevo: saldoAFavorDisponibleProveedor(proveedor) };
}

// Lado Báscula del cambio de proveedor: tras corregir el proveedor de un registro, busca la CxP del mismo ticket + proveedor
// anterior (si el ticket tiene varios materiales, elegirFilaDelTicket decide por material y kg). No escribe nada sin que
// opciones.confirmar(texto) -> Promise<boolean> responda que sí. Devuelve { estado, aviso }:
// 'sin_cxp' (nada que mostrar), 'bloqueada' (con abonos, recibo pendiente, saldo inicial o ambigua: se explica), 'sin_cambio'
// (respondió que no: la CxP sigue a nombre del anterior), 'actualizada' o 'error'.
async function ofrecerActualizarProveedorDesdeBascula(registroAnterior, proveedorNuevo, opciones) {
  const proveedor = window.normalizarProveedor(proveedorNuevo);
  const anterior = window.normalizarProveedor(registroAnterior.proveedor);
  if (!proveedor || proveedor === anterior || !window.puedeLeer('cxp')) return { estado: 'sin_cxp' };
  try {
    const cuentas = (await consultarPorTicket('cuentas_por_pagar', registroAnterior.ticket))
      .filter((c) => window.normalizarProveedor(c.proveedor) === anterior);
    if (cuentas.length === 0) return { estado: 'sin_cxp' };
    const sigueA = `La CxP del ticket ${registroAnterior.ticket} sigue a nombre de ${anterior}.`;
    const cxp = elegirFilaDelTicket(cuentas, registroAnterior);
    if (!cxp) {
      return { estado: 'bloqueada', aviso: `${sigueA} El ticket tiene varias cuentas por pagar: cambia el proveedor desde CxP (Editar proveedor).` };
    }
    if (!window.puedeEscribir('cxp')) {
      return { estado: 'bloqueada', aviso: `${sigueA} Cambiarla requiere permiso de escritura en CxP.` };
    }
    try {
      await validarCxPEditableProveedor(cxp);
    } catch (error) {
      return { estado: 'bloqueada', aviso: `${sigueA} ${error.message}.` };
    }
    if (!(await opciones.confirmar(`¿Actualizar también la CxP de este ticket a ${proveedor}?`))) {
      return { estado: 'sin_cambio', aviso: `${sigueA} Solo se cambió el registro de Báscula.` };
    }
    const resultado = await window.protegerContraDobleRegistro(`cxp-editar-proveedor-${cxp.id}`, () =>
      editarProveedorCxP(cxp.id, proveedor, MOTIVO_CORRECCION_PROVEEDOR_BASCULA, null));
    if (!resultado) return { estado: 'error', aviso: `${sigueA} No se pudo actualizar: recarga la página e inténtalo desde CxP.` };
    const aviso = resultado.saldoAFavorNuevo > 0.01
      ? `${proveedor} tiene ${window.formatearMoneda(resultado.saldoAFavorNuevo)} de saldo a favor disponible; no se aplicó a esta cuenta.`
      : undefined;
    return { estado: 'actualizada', aviso, ...resultado };
  } catch (error) {
    return { estado: 'error', aviso: `No se pudo revisar la CxP del ticket ${registroAnterior.ticket}: ${error.message}` };
  }
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

// El pago de una cuenta de saldo inicial se guarda igual que un "Abono a saldo inicial" de Pagos: sin ticket, kg ni total, para
// que no cuente como compra en los totales de Pagos (sí sale en Flujo de efectivo, que suma el pagado).
function marcarPagoDeSaldoInicial(registroPago, cxp) {
  if (!esCxPSaldoInicial(cxp)) return registroPago;
  Object.assign(registroPago, {
    ticket: 'SALDO INICIAL', material: 'ABONO A SALDO INICIAL', kg: 0, precioPorKg: 0, total: 0, iva: 0, abonoSaldoInicial: true
  });
  return registroPago;
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
    marcarPagoDeSaldoInicial(registroPago, cxp);
    const idPago = await window.guardarDato('pagos', registroPago);
    window.EVE.registrosPagos.push({ id: idPago, ...registroPago, fechaRegistro: new Date().toISOString() });
    Object.assign(cxp, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
    deseleccionarProveedorCxP(cxp.proveedor);
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
  deseleccionarProveedor: deseleccionarProveedorCxP,
  revertirMovimientoSaldoAFavorSiExiste,
  revertirPagosSiExiste,
  ajustarPrecioCxP,
  editarMaterialCxP,
  editarProveedorCxP,
  ofrecerActualizarProveedorDesdeBascula,
  nombresProveedoresCxP,
  saldoAFavorDisponibleProveedor,
  corregirKgCxP,
  validarEdicionBascula,
  guardarEdicionBasculaConCxP,
  detectarDesalineacionBasculaCxP,
  renderizarAvisoDesalineacion,
  MENSAJE_KG_SOLO_DESDE_CXP,
  MENSAJE_EDICION_PAGOS,
  MENSAJE_EDICION_SIN_PRECIO,
  MENSAJE_EDICION_PERMISO,
  MENSAJE_EDICION_AMBIGUO,
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
  iniciarPDFConTitulo,
  fechaUltimoAbonoCxP,
  desglosarFormasPagoDiaCxP,
  construirFilasPagosPorDiaCxP,
  resumirSaldoAFavorCxP,
  agruparPagosPorDiaCxP,
  crearPagosPorDiaCxP,
  crearTablaCuentas
});

let vistaActiva = 'proveedores';
let proveedorExpandido = null;
let cxpAbonoExpandido = null;
let cxpLiquidadosExpandido = new Set();
let saldoAFavorExpandido = null;
// Proveedores con el desplegable 'Historial de movimientos de saldo a favor' abierto; sobrevive al re-render de la vista.
const cxpHistorialSaldoAbierto = new Set();
let pendientesSinAuditarExpandido = false;
let tabTodos = 'semana';
let filtrosTodos = { desde: '', hasta: '', proveedor: '', material: '', estado: '' };
let tabProveedorPeriodo = 'todos';
let rangoProveedorDesde = '';
let rangoProveedorHasta = '';
let modalContexto = null;
let ticketsSeleccionadosRecibo = new Set();
let montosSeleccionadosRecibo = new Map();
// Filas que el usuario marcó con su propio clic (no las que puso el reparto del Monto total): definen si el reparto va a esas filas o a todas.
let marcasManualesRecibo = new Set();
// Recibos pendientes (pendiente_pago) por proveedor, tal como se leyeron de Firestore: su monto ya está comprometido y no se puede volver a repartir.
const recibosPendientesPorProveedor = new Map();

function comprometidoPorCuenta(proveedor) {
  const recibos = recibosPendientesPorProveedor.get(window.normalizarProveedor(proveedor)) || [];
  return window.EVE_CXP.calcularComprometidoPorCuenta(recibos, window.EVE.cuentasPorPagar);
}

async function consultarRecibosPendientesProveedor(nombreProveedor) {
  const snapshot = await window.db.collection('recibos_pendientes')
    .where('proveedor', 'in', window.variantesProveedor(nombreProveedor))
    .where('estado', '==', 'pendiente_pago')
    .get();
  const recibos = window.unificarProveedorEnRegistros(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
  recibosPendientesPorProveedor.set(window.normalizarProveedor(nombreProveedor), recibos);
  return recibos;
}

// Proveedores marcados en Por Proveedor (clave: nombre). Vive en sessionStorage para sobrevivir a recargas y a cambios de pestaña.
const CLAVE_SELECCION_CXP = 'cxpSeleccionados';

function cargarSeleccionCxP() {
  try {
    const guardado = JSON.parse(sessionStorage.getItem(CLAVE_SELECCION_CXP));
    return new Set(Array.isArray(guardado) ? guardado.filter((n) => typeof n === 'string') : []);
  } catch (error) {
    return new Set();
  }
}

function guardarSeleccionCxP() {
  try {
    sessionStorage.setItem(CLAVE_SELECCION_CXP, JSON.stringify(Array.from(cxpSeleccionados)));
  } catch (error) {
    // sessionStorage no disponible: la selección sigue funcionando en memoria.
  }
}

let cxpSeleccionados = cargarSeleccionCxP();

function alternarSeleccionCxP(proveedor, marcado) {
  if (marcado) cxpSeleccionados.add(proveedor);
  else cxpSeleccionados.delete(proveedor);
  guardarSeleccionCxP();
  actualizarBarraSeleccionCxP();
}

// Un proveedor sin saldo pendiente deja de ser seleccionable (los residuos de redondeo no cuentan como saldo).
function tieneSaldoCxP(grupo) {
  return !esLiquidadoCxP(grupo.saldo);
}

// Quita de la selección a un proveedor al que se le acaba de registrar un pago (lo llaman todos los caminos de pago, incluido Pagos).
function deseleccionarProveedorCxP(proveedor) {
  if (!cxpSeleccionados.delete(proveedor)) return;
  guardarSeleccionCxP();
  actualizarBarraSeleccionCxP();
}

// Descarta de la selección a los proveedores que ya quedaron sin saldo en total (p. ej. liquidados desde Pagos).
// Solo toca a los que sí tienen cuentas con saldo 0: si aún no cargan los datos no borra nada.
function podarSeleccionSinSaldoCxP() {
  if (cxpSeleccionados.size === 0) return;
  let cambio = false;
  window.EVE_CXP.agregarPorProveedorCxP(window.EVE.cuentasPorPagar || []).forEach((g) => {
    if (!tieneSaldoCxP(g) && cxpSeleccionados.delete(g.proveedor)) cambio = true;
  });
  if (cambio) guardarSeleccionCxP();
}

// Proveedores con su saldo tal como los muestra Por Proveedor en la pestaña de periodo activa.
function obtenerGruposVistaProveedoresCxP() {
  const cuentas = cuentasVisiblesCxP();
  if (tabProveedorPeriodo === 'todos') return window.EVE_CXP.agregarPorProveedorCxP(cuentas);
  const { desde, hasta } = calcularRangoPeriodoCxP(tabProveedorPeriodo, { desde: rangoProveedorDesde, hasta: rangoProveedorHasta });
  if (tabProveedorPeriodo === 'rango' && (!desde || !hasta)) return [];
  return window.EVE_CXP.agregarPorProveedorCxP(window.EVE_CXP.filtrarCxP(cuentas, { desde, hasta }));
}

// Solo suma proveedores seleccionados con saldo pendiente en la vista actual; uno con saldo 0 no cuenta aunque siga marcado.
function calcularSeleccionVistaCxP() {
  const conSaldo = obtenerGruposVistaProveedoresCxP().filter(tieneSaldoCxP);
  const seleccionados = conSaldo.filter((g) => cxpSeleccionados.has(g.proveedor));
  return {
    conSaldo,
    cantidadEnVista: seleccionados.length,
    total: seleccionados.reduce((suma, g) => suma + g.saldo, 0)
  };
}

function crearBarraSeleccionCxP() {
  const barra = document.createElement('div');
  barra.id = 'cxp-barra-seleccion';
  barra.className = 'cxp-barra-seleccion';
  barra.style.display = 'none';
  barra.innerHTML = `
    <div class="cxp-barra-info">
      <span class="cxp-barra-cantidad"></span>
      <span class="cxp-barra-total-etiqueta">Total a pagar</span>
      <span class="cxp-barra-total mono"></span>
    </div>
    <div class="cxp-barra-acciones">
      <button type="button" class="btn-secondary" id="cxp-barra-todos">Seleccionar todos</button>
      <button type="button" class="btn-secondary" id="cxp-barra-limpiar">Limpiar</button>
    </div>
  `;
  barra.querySelector('#cxp-barra-todos').addEventListener('click', () => {
    calcularSeleccionVistaCxP().conSaldo.forEach((g) => cxpSeleccionados.add(g.proveedor));
    guardarSeleccionCxP();
    llenarVistaProveedores();
  });
  barra.querySelector('#cxp-barra-limpiar').addEventListener('click', () => {
    cxpSeleccionados.clear();
    guardarSeleccionCxP();
    llenarVistaProveedores();
  });
  return barra;
}

function actualizarBarraSeleccionCxP() {
  const barra = document.getElementById('cxp-barra-seleccion');
  if (!barra) return;
  const visible = vistaActiva === 'proveedores' && cxpSeleccionados.size > 0;
  barra.style.display = visible ? '' : 'none';
  const espaciador = document.getElementById('cxp-barra-espaciador');
  if (espaciador) espaciador.style.display = visible ? '' : 'none';
  if (!visible) return;
  const { cantidadEnVista, total } = calcularSeleccionVistaCxP();
  const cantidad = cxpSeleccionados.size;
  let texto = `${cantidad} ${cantidad === 1 ? 'proveedor seleccionado' : 'proveedores seleccionados'}`;
  if (cantidadEnVista !== cantidad) texto += ` (${cantidadEnVista} con saldo en esta vista)`;
  barra.querySelector('.cxp-barra-cantidad').textContent = texto;
  barra.querySelector('.cxp-barra-total').textContent = window.formatearMoneda(total);
}

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

// ── Interruptor "Incluir material de socios" (solo afecta la vista; no toca Firestore) ──
const CLAVE_INCLUIR_SOCIOS_CXP = 'cxp_incluir_socios';

function incluirSociosCxP() {
  try { return window.localStorage.getItem(CLAVE_INCLUIR_SOCIOS_CXP) !== '0'; } catch (e) { return true; }
}

function guardarIncluirSociosCxP(valor) {
  try { window.localStorage.setItem(CLAVE_INCLUIR_SOCIOS_CXP, valor ? '1' : '0'); } catch (e) { /* sin almacenamiento: queda solo en pantalla */ }
}

// Cuentas que alimentan resumen, saldo por proveedor, totales y consolidado según el interruptor.
function cuentasVisiblesCxP() {
  const cuentas = window.EVE.cuentasPorPagar || [];
  if (incluirSociosCxP()) return cuentas;
  return cuentas.filter((c) => !window.esProveedorSocio(c.proveedor));
}

// Saldo pendiente que viene de saldos iniciales (deuda previa a EVE). Suma en lo adeudado pero no en las compras del periodo.
function calcularSaldoInicialCxP(cuentas) {
  const suma = (cuentas || []).filter((c) => esCxPSaldoInicial(c) && !esLiquidadoCxP(c.saldo)).reduce((s, c) => s + c.saldo, 0);
  return Math.round(suma * 100) / 100;
}

function calcularTotalAdeudadoGeneral() {
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentasVisiblesCxP()).filter((g) => !esLiquidadoCxP(g.saldo));
  const total = grupos.reduce((suma, g) => suma + g.saldo, 0);
  return { total, cantidadProveedores: grupos.length, saldoInicial: calcularSaldoInicialCxP(cuentasVisiblesCxP()) };
}

function obtenerPeriodoActivoInfo() {
  if (vistaActiva === 'proveedores' && (tabProveedorPeriodo === 'hoy' || tabProveedorPeriodo === 'semana' || tabProveedorPeriodo === 'mes' || tabProveedorPeriodo === 'ultimos30')) {
    const nombres = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes', ultimos30: 'Últimos 30 días' };
    const { desde, hasta } = calcularRangoPeriodoCxP(tabProveedorPeriodo);
    return { nombre: nombres[tabProveedorPeriodo], desde, hasta };
  }
  if (vistaActiva === 'proveedores' && tabProveedorPeriodo === 'rango' && rangoProveedorDesde && rangoProveedorHasta) {
    return { nombre: 'Rango', desde: rangoProveedorDesde, hasta: rangoProveedorHasta };
  }
  if (vistaActiva === 'todos' && (tabTodos === 'semana' || tabTodos === 'mes')) {
    const nombres = { semana: 'Esta Semana', mes: 'Este Mes' };
    const { desde, hasta } = calcularRangoPeriodoCxP(tabTodos);
    return { nombre: nombres[tabTodos], desde, hasta };
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

  const etiquetaSocios = document.createElement('label');
  etiquetaSocios.className = 'cxp-interruptor-socios';
  etiquetaSocios.style.display = 'flex';
  etiquetaSocios.style.alignItems = 'center';
  etiquetaSocios.style.gap = '0.5rem';
  etiquetaSocios.style.marginBottom = '0.5rem';
  const casillaSocios = document.createElement('input');
  casillaSocios.type = 'checkbox';
  casillaSocios.id = 'cxp-incluir-socios';
  casillaSocios.checked = incluirSociosCxP();
  casillaSocios.addEventListener('change', () => {
    guardarIncluirSociosCxP(casillaSocios.checked);
    renderizarVistaActiva();
  });
  etiquetaSocios.appendChild(casillaSocios);
  etiquetaSocios.appendChild(document.createTextNode('Incluir material de socios'));
  div.appendChild(etiquetaSocios);

  const { total, cantidadProveedores, saldoInicial } = calcularTotalAdeudadoGeneral();
  const fila = document.createElement('div');
  fila.style.display = 'flex';
  fila.style.alignItems = 'center';
  fila.style.gap = '1.5rem';
  fila.style.flexWrap = 'wrap';

  const bloqueGeneral = document.createElement('div');
  bloqueGeneral.innerHTML = `<strong>Total Adeudado General: ${window.formatearMoneda(total)}</strong> (${cantidadProveedores} proveedor${cantidadProveedores === 1 ? '' : 'es'} con saldo pendiente)`;
  if (saldoInicial > 0) {
    const lineaSaldoInicial = document.createElement('div');
    lineaSaldoInicial.className = 'cxp-linea-saldo-inicial';
    lineaSaldoInicial.textContent = `de los cuales saldo inicial: ${window.formatearMoneda(saldoInicial)}`;
    bloqueGeneral.appendChild(lineaSaldoInicial);
  }
  fila.appendChild(bloqueGeneral);

  const periodoActivo = obtenerPeriodoActivoInfo();
  if (periodoActivo) {
    // El saldo inicial no es una compra del periodo: no entra en este total.
    const cuentasPeriodo = window.EVE_CXP.filtrarCxP(cuentasVisiblesCxP(), { desde: periodoActivo.desde, hasta: periodoActivo.hasta })
      .filter((c) => !esCxPSaldoInicial(c));
    const totalPeriodo = window.EVE_CXP.agregarPorProveedorCxP(cuentasPeriodo)
      .filter((g) => !esLiquidadoCxP(g.saldo))
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
    { id: 'ultimos30', nombre: 'Últimos 30 días' },
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
  podarSeleccionSinSaldoCxP();
  contenido.innerHTML = '';
  if (tabProveedorPeriodo === 'todos') {
    llenarVistaProveedoresCompleta(contenido);
  } else {
    llenarVistaProveedoresPeriodo(contenido, tabProveedorPeriodo);
  }
  actualizarBarraSeleccionCxP();
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
  const cuentasPeriodo = window.EVE_CXP.filtrarCxP(cuentasVisiblesCxP(), { desde, hasta });
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentasPeriodo)
    .filter((g) => !esLiquidadoCxP(g.saldo))
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
  encabezado.style.alignItems = 'center';
  encabezado.innerHTML = `
    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer">
      <input type="checkbox" class="cxp-check-proveedor" aria-label="Seleccionar proveedor">
      <h3 style="margin:0"></h3>
    </label>
    <div>
      <span>Total: ${window.formatearMoneda(grupo.total)}</span> &nbsp;
      <span>Pagado: ${window.formatearMoneda(grupo.pagado)}</span> &nbsp;
      <span><strong>Saldo: ${window.formatearMoneda(grupo.saldo)}</strong></span>
    </div>
  `;
  encabezado.querySelector('h3').textContent = grupo.proveedor;
  const checkProveedor = encabezado.querySelector('.cxp-check-proveedor');
  checkProveedor.disabled = !tieneSaldoCxP(grupo);
  checkProveedor.checked = !checkProveedor.disabled && cxpSeleccionados.has(grupo.proveedor);
  checkProveedor.addEventListener('change', () => alternarSeleccionCxP(grupo.proveedor, checkProveedor.checked));
  tarjeta.appendChild(encabezado);

  const saldoInicialProveedor = calcularSaldoInicialCxP(grupo.cuentas);
  if (saldoInicialProveedor > 0) {
    const lineaSaldoInicial = document.createElement('div');
    lineaSaldoInicial.className = 'cxp-linea-saldo-inicial';
    lineaSaldoInicial.textContent = `de los cuales saldo inicial: ${window.formatearMoneda(saldoInicialProveedor)}`;
    tarjeta.appendChild(lineaSaldoInicial);
  }

  const proveedorRegistro = window.EVE.proveedores.find((p) => p.nombre === grupo.proveedor);
  const saldoAFavorTotal = totalSaldoAFavor(proveedorRegistro && proveedorRegistro.saldoAFavor);
  const movimientosSaldo = movimientosSaldoAFavor(proveedorRegistro);
  // "Ver Movimientos" y su bloque solo existen mientras haya saldo a favor disponible; con anticipos ya consumidos
  // el historial no se borra y sigue consultable dentro de "Ver Detalle".
  const hayAnticipoDisponible = saldoAFavorTotal > 0.01;
  if (hayAnticipoDisponible) {
    const filaSaldoAFavor = document.createElement('div');
    filaSaldoAFavor.style.display = 'flex';
    filaSaldoAFavor.style.alignItems = 'center';
    filaSaldoAFavor.style.gap = '0.5rem';
    filaSaldoAFavor.style.flexWrap = 'wrap';
    filaSaldoAFavor.appendChild(crearChip(`✅ ${grupo.proveedor} — Saldo a favor: ${window.formatearMoneda(saldoAFavorTotal)} (se aplicará al próximo pago)`, 'chip-ok'));
    const btnMovimientos = document.createElement('button');
    btnMovimientos.className = 'btn-secondary';
    btnMovimientos.textContent = (saldoAFavorExpandido === grupo.proveedor ? 'Ocultar' : 'Ver') + ` Movimientos (${movimientosSaldo.length})`;
    btnMovimientos.addEventListener('click', () => {
      saldoAFavorExpandido = saldoAFavorExpandido === grupo.proveedor ? null : grupo.proveedor;
      llenarVistaProveedores();
    });
    filaSaldoAFavor.appendChild(btnMovimientos);
    tarjeta.appendChild(filaSaldoAFavor);
  }
  if (hayAnticipoDisponible && saldoAFavorExpandido === grupo.proveedor) {
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
    marcasManualesRecibo.clear();
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
    if (!hayAnticipoDisponible && movimientosSaldo.length > 0) {
      // Mismo patrón que 'Pagos por día': <details>/<summary> nativo, cerrado por defecto, con el estado abierto por proveedor en memoria.
      const historial = document.createElement('details');
      historial.className = 'cxp-historial-saldo-favor';
      historial.style.marginTop = '0.75rem';
      historial.open = cxpHistorialSaldoAbierto.has(grupo.proveedor);
      historial.addEventListener('toggle', () => {
        if (historial.open) cxpHistorialSaldoAbierto.add(grupo.proveedor);
        else cxpHistorialSaldoAbierto.delete(grupo.proveedor);
      });
      const tituloHistorial = document.createElement('summary');
      tituloHistorial.style.cursor = 'pointer';
      tituloHistorial.style.fontWeight = '600';
      tituloHistorial.textContent = `Historial de movimientos de saldo a favor (${movimientosSaldo.length})`;
      historial.appendChild(tituloHistorial);
      historial.appendChild(crearTablaSaldoAFavor(grupo.proveedor, movimientosSaldo));
      tarjeta.appendChild(historial);
    }
    if (opcionesExportar) {
      tarjeta.appendChild(crearBarraExportarEstadoCuentaCxP(grupo, opcionesExportar));
    }
  }

  return tarjeta;
}

function llenarVistaProveedoresCompleta(contenido) {
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentasVisiblesCxP());

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

// Las marcas y montos viven en memoria hasta generar el recibo o presionar Limpiar; si una cuenta ya no tiene saldo (refresco de datos)
// su marca se descarta.
function depurarSeleccionRecibo() {
  const conSaldo = new Set(window.EVE.cuentasPorPagar.filter((c) => c.saldo > 0).map((c) => c.id));
  [ticketsSeleccionadosRecibo, marcasManualesRecibo].forEach((conjunto) => {
    Array.from(conjunto).forEach((id) => { if (!conSaldo.has(id)) conjunto.delete(id); });
  });
  Array.from(montosSeleccionadosRecibo.keys()).forEach((id) => { if (!conSaldo.has(id)) montosSeleccionadosRecibo.delete(id); });
}

// Reparte el Monto total del recibo (PEPS) marcando las filas alcanzadas y llenando su monto; las no alcanzadas quedan sin marcar.
function aplicarMontoTotalRecibo(cuentas, proveedor, monto) {
  const comprometido = comprometidoPorCuenta(proveedor);
  const saldoProveedor = window.EVE.cuentasPorPagar
    .filter((c) => c.proveedor === proveedor && c.saldo > 0)
    .reduce((suma, c) => suma + saldoDisponibleCxP(c, comprometido), 0);
  const plan = planificarRepartoRecibo(cuentas, marcasManualesRecibo, monto, saldoProveedor, comprometido);
  if (!plan.ok) {
    window.showError(plan.error);
    return false;
  }
  cuentas.forEach((c) => {
    ticketsSeleccionadosRecibo.delete(c.id);
    montosSeleccionadosRecibo.delete(c.id);
  });
  plan.asignaciones.forEach((asignado, id) => {
    ticketsSeleccionadosRecibo.add(id);
    montosSeleccionadosRecibo.set(id, asignado);
  });
  sincronizarPantallaRecibo(cuentas);
  return true;
}

// Refleja en la pantalla (sin volver a dibujar el detalle, para no perder un clic en curso) las marcas y montos de la selección.
function sincronizarPantallaRecibo(cuentas) {
  const filas = document.querySelectorAll('input[type="checkbox"][data-cuenta-id]');
  filas.forEach((checkbox) => {
    const id = checkbox.dataset.cuentaId;
    const marcada = ticketsSeleccionadosRecibo.has(id);
    checkbox.checked = marcada;
    const inputMonto = document.querySelector(`input[type="number"][data-cuenta-id="${id}"]`);
    if (!inputMonto) return;
    inputMonto.disabled = !marcada;
    if (marcada && montosSeleccionadosRecibo.has(id)) inputMonto.value = montosSeleccionadosRecibo.get(id);
  });
  const totalSeleccionado = document.getElementById('cxp-total-seleccionado');
  if (totalSeleccionado) totalSeleccionado.textContent = 'Total seleccionado: ' + window.formatearMoneda(calcularTotalSeleccionado(cuentas));
  const campoMontoTotal = document.getElementById('cxp-monto-total-recibo');
  if (campoMontoTotal) campoMontoTotal.value = ticketsSeleccionadosRecibo.size > 0 ? calcularTotalSeleccionado(cuentas).toFixed(2) : '';
  actualizarBotonGenerarRecibo();
}

// Generar Recibo se habilita con filas marcadas o con un Monto total escrito (que se reparte al generar).
function actualizarBotonGenerarRecibo() {
  const boton = document.getElementById('cxp-btn-generar-recibo');
  const campo = document.getElementById('cxp-monto-total-recibo');
  if (boton) boton.disabled = ticketsSeleccionadosRecibo.size === 0 && !(campo && campo.value !== '');
}

// Hay un Monto total escrito que todavía no se repartió (el usuario no salió del campo ni pulsó Enter): no coincide con la suma de lo marcado.
function hayMontoTotalPendiente(cuentas) {
  const campo = document.getElementById('cxp-monto-total-recibo');
  if (!campo || campo.value === '') return false;
  const marcado = ticketsSeleccionadosRecibo.size > 0 ? calcularTotalSeleccionado(cuentas) : 0;
  return Math.round(Number(campo.value) * 100) !== Math.round(marcado * 100);
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
    const firmaAntes = JSON.stringify(Array.from(comprometidoPorCuenta(nombreProveedor)));
    const recibos = await consultarRecibosPendientesProveedor(nombreProveedor);
    // Si lo comprometido cambió respecto a lo que se dibujó (el detalle se pintó antes de leer los recibos), se redibuja una vez.
    if (JSON.stringify(Array.from(comprometidoPorCuenta(nombreProveedor))) !== firmaAntes && proveedorExpandido === nombreProveedor) {
      renderizarVistaActiva();
      return;
    }
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

// Modal de "Editar proveedor": nombre nuevo (con los proveedores existentes como sugerencias) y motivo obligatorio. Avisa, sin
// aplicarlo, si el proveedor nuevo ya tiene saldo a favor disponible.
function abrirModalEditarProveedor(cuenta) {
  const previo = document.getElementById('cxp-editar-proveedor-overlay');
  if (previo) previo.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cxp-editar-proveedor-overlay';
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar proveedor</h3>
      <form id="cxp-editar-proveedor-form">
        <p style="font-weight:600"></p>
        <input type="text" id="cxp-editar-proveedor-valor" list="cxp-editar-proveedor-lista" placeholder="Proveedor nuevo" autocomplete="off" required>
        <datalist id="cxp-editar-proveedor-lista"></datalist>
        <textarea id="cxp-editar-proveedor-motivo" placeholder="Motivo del cambio (obligatorio)" rows="2" required style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" class="btn-secondary" id="cxp-editar-proveedor-cancelar">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('p').textContent = `Ticket ${cuenta.ticket} · ${cuenta.material} · proveedor actual: ${cuenta.proveedor}.`;
  const lista = overlay.querySelector('datalist');
  window.EVE_CXP.nombresProveedoresCxP().forEach((nombre) => {
    const opcion = document.createElement('option');
    opcion.value = nombre;
    lista.appendChild(opcion);
  });
  const cerrar = () => overlay.remove();
  overlay.querySelector('#cxp-editar-proveedor-cancelar').addEventListener('click', cerrar);
  overlay.querySelector('#cxp-editar-proveedor-form').addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const botonGuardar = overlay.querySelector('button[type="submit"]');
    const proveedorNuevo = overlay.querySelector('#cxp-editar-proveedor-valor').value.trim();
    const motivo = overlay.querySelector('#cxp-editar-proveedor-motivo').value.trim();
    if (!proveedorNuevo) {
      window.showError('El proveedor es obligatorio');
      return;
    }
    if (!motivo) {
      window.showError('El motivo es obligatorio');
      return;
    }
    botonGuardar.disabled = true;
    const resultado = await window.protegerContraDobleRegistro(`cxp-editar-proveedor-${cuenta.id}`, async () => {
      try {
        return await window.EVE_CXP.editarProveedorCxP(cuenta.id, proveedorNuevo, motivo, usuarioActual());
      } catch (error) {
        botonGuardar.disabled = false;
        window.showError(error.message);
        return false;
      }
    });
    if (!resultado) return;
    cerrar();
    window.showSuccess(`Proveedor actualizado a ${resultado.proveedorNuevo}`);
    if (resultado.saldoAFavorNuevo > 0.01) {
      window.showSuccess(`${resultado.proveedorNuevo} tiene ${window.formatearMoneda(resultado.saldoAFavorNuevo)} de saldo a favor disponible. No se aplicó a esta cuenta: usa Aplicar saldo a favor si corresponde.`);
    }
    renderizarVistaActiva();
  });
  document.body.appendChild(overlay);
}

// ===== Pagos por día =====
// Los días salen de los abonos ya cargados en cada cuenta (fecha = fecha del recibo de pago, no la del ticket): sin lecturas.
// La forma de pago vive solo en recibos_pago, que no está en memoria: se lee UNA vez por proveedor, al abrir 'Pagos por día',
// y se cruza por grupoPagoId contra los abonos. El resultado se cachea en memoria.
// El saldo a favor NO necesita lectura: sus movimientos viven en window.EVE.proveedores[].saldoAFavor. Un abono pagado con saldo a
// favor (aplicado automática o manualmente, sin recibo propio) comparte grupoPagoId con un movimiento NEGATIVO del proveedor; los
// anticipos son los movimientos positivos. Los movimientos revertidos se ignoran en anticipos, aplicado y disponible.

// Fecha (AAAA-MM-DD) del abono más reciente de la cuenta, o '' si no tiene.
function fechaUltimoAbonoCxP(cuenta) {
  return (cuenta.abonos || []).reduce((ultima, abono) => (abono.fecha && abono.fecha > ultima ? abono.fecha : ultima), '');
}

const centavosCxP = (monto) => Math.round((Number(monto) || 0) * 100);

// grupoPagoId de las aplicaciones de saldo a favor (movimientos negativos, también revertidos: el abono se identifica igual).
function gruposAplicacionSaldoCxP(movimientos) {
  const grupos = new Set();
  (movimientos || []).forEach((m) => { if (m && m.grupoPagoId && Number(m.monto) < 0) grupos.add(m.grupoPagoId); });
  return grupos;
}

function esAbonoSaldoAFavorCxP(abono, gruposAplicacion) {
  return (!!abono.grupoPagoId && gruposAplicacion.has(abono.grupoPagoId)) || /^saldo a favor aplicado/i.test(abono.referencia || '');
}

// { anticipos, aplicado, disponible, filasAnticipo: [{ fecha, monto }] } con los movimientos activos (no revertidos), en pesos.
function resumirSaldoAFavorCxP(movimientos) {
  let anticipos = 0;
  let aplicado = 0;
  const filasAnticipo = [];
  (movimientos || []).forEach((m) => {
    if (!m || m.revertido) return;
    const centavos = centavosCxP(m.monto);
    if (centavos > 0) {
      anticipos += centavos;
      filasAnticipo.push({ fecha: m.fecha || '', monto: centavos / 100 });
    } else if (centavos < 0) {
      aplicado -= centavos;
    }
  });
  return { anticipos: anticipos / 100, aplicado: aplicado / 100, disponible: (anticipos - aplicado) / 100, filasAnticipo };
}

// [{ fecha, total, numTickets, tickets: [{ ticket, material, kg, precioEfectivo, total, monto, pagadoDia, saldoAFavor }], grupos: [...] }]
// kg / precioEfectivo / total son los de la cuenta (los mismos valores que la fila de la tabla); monto es lo de esa fila (recibo o
// saldo a favor) y pagadoDia lo pagado a ese ticket en TODO el día, que es lo que se compara con el total para el 'pago parcial'.
// del día más reciente al más antiguo. 'grupos' reparte el total del día por grupoPagoId ('' = abono sin recibo, p. ej. pago
// manual) y marca los pagados con saldo a favor. movimientos (opcional): proveedor.saldoAFavor.
function agruparPagosPorDiaCxP(cuentas, movimientos) {
  const gruposAplicacion = gruposAplicacionSaldoCxP(movimientos);
  const dias = new Map();
  cuentas.forEach((cuenta) => {
    (cuenta.abonos || []).forEach((abono) => {
      const centavos = centavosCxP(abono.monto);
      if (!abono.fecha || centavos <= 0) return;
      const saldoAFavor = esAbonoSaldoAFavorCxP(abono, gruposAplicacion);
      const dia = dias.get(abono.fecha) || { fecha: abono.fecha, centavos: 0, cuentas: new Map(), tickets: new Map(), grupos: new Map() };
      dia.centavos += centavos;
      dia.cuentas.set(cuenta.id, (dia.cuentas.get(cuenta.id) || 0) + centavos);
      const claveTicket = `${cuenta.id}|${saldoAFavor ? 's' : 'r'}`;
      const ticket = dia.tickets.get(claveTicket) || { cuenta, saldoAFavor, centavos: 0 };
      ticket.centavos += centavos;
      dia.tickets.set(claveTicket, ticket);
      const grupoPagoId = abono.grupoPagoId || '';
      const claveGrupo = `${saldoAFavor ? 's' : 'r'}|${grupoPagoId}`;
      const grupo = dia.grupos.get(claveGrupo) || { grupoPagoId, saldoAFavor, centavos: 0 };
      grupo.centavos += centavos;
      dia.grupos.set(claveGrupo, grupo);
      dias.set(abono.fecha, dia);
    });
  });
  return Array.from(dias.values())
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
    .map((dia) => ({
      fecha: dia.fecha,
      total: dia.centavos / 100,
      numTickets: dia.cuentas.size,
      tickets: Array.from(dia.tickets.values()).map((t) => ({
        ticket: t.cuenta.ticket,
        material: t.cuenta.material,
        kg: t.cuenta.kg,
        precioEfectivo: t.cuenta.precioEfectivo,
        total: t.cuenta.total,
        monto: t.centavos / 100,
        pagadoDia: dia.cuentas.get(t.cuenta.id) / 100,
        saldoAFavor: t.saldoAFavor
      })),
      grupos: Array.from(dia.grupos.values()).map((g) => ({ grupoPagoId: g.grupoPagoId, monto: g.centavos / 100, saldoAFavor: g.saldoAFavor }))
    }));
}

// Días de pago y anticipos en una sola lista, del más reciente al más antiguo (a igual fecha, primero el día de pago).
function construirFilasPagosPorDiaCxP(dias, filasAnticipo) {
  return [
    ...dias.map((dia) => ({ tipo: 'dia', fecha: dia.fecha, dia })),
    ...filasAnticipo.map((a) => ({ tipo: 'anticipo', fecha: a.fecha, monto: a.monto }))
  ].sort((a, b) => (a.fecha === b.fecha ? (a.tipo === b.tipo ? 0 : (a.tipo === 'dia' ? -1 : 1)) : (a.fecha < b.fecha ? 1 : -1)));
}

// Solo los grupos que pueden tener recibo: los pagados con saldo a favor no tienen recibo propio y no se consultan.
function idsGrupoPagoDiasCxP(dias) {
  const ids = new Set();
  dias.forEach((dia) => dia.grupos.forEach((g) => { if (g.grupoPagoId && !g.saldoAFavor) ids.add(g.grupoPagoId); }));
  return ids;
}

// 'Efectivo', 'Transferencia', 'Saldo a favor aplicado' o, si el día mezcla formas, 'Efectivo $X · Saldo a favor $Y'. Lo que no se
// pueda determinar (sin grupoPagoId, sin recibo o con la lectura fallida) cuenta como 'N/D'.
// porGrupo: Map grupoPagoId -> 'efectivo' | 'transferencia'.
function desglosarFormasPagoDiaCxP(dia, porGrupo) {
  const etiquetas = { efectivo: 'Efectivo', transferencia: 'Transferencia' };
  const sumas = new Map([['Efectivo', 0], ['Transferencia', 0], ['Saldo a favor', 0], ['N/D', 0]]);
  dia.grupos.forEach((g) => {
    let etiqueta;
    if (g.saldoAFavor) {
      etiqueta = 'Saldo a favor';
    } else {
      const forma = g.grupoPagoId && porGrupo ? porGrupo.get(g.grupoPagoId) : null;
      etiqueta = etiquetas[forma] || 'N/D';
    }
    sumas.set(etiqueta, sumas.get(etiqueta) + Math.round(g.monto * 100));
  });
  const usadas = Array.from(sumas.entries()).filter(([, centavos]) => centavos > 0);
  if (usadas.length === 0) return 'N/D';
  if (usadas.length === 1) return usadas[0][0] === 'Saldo a favor' ? 'Saldo a favor aplicado' : usadas[0][0];
  return usadas.map(([etiqueta, centavos]) => `${etiqueta} ${window.formatearMoneda(centavos / 100)}`).join(' · ');
}

// proveedor -> { consultados: Set de grupoPagoId que cubrió la lectura, promesa, porGrupo (cuando ya resolvió) }.
// Se vuelve a leer solo si aparece un grupoPagoId que la lectura anterior no cubría (un pago nuevo); las lecturas fallidas no se cachean.
const cxpFormasPagoCache = new Map();

function formasPagoEnCacheCxP(proveedor, ids) {
  const entrada = cxpFormasPagoCache.get(proveedor);
  if (!entrada || !entrada.porGrupo) return null;
  return Array.from(ids).every((id) => entrada.consultados.has(id)) ? entrada.porGrupo : null;
}

function cargarFormasPagoProveedorCxP(proveedor, ids) {
  const previa = cxpFormasPagoCache.get(proveedor);
  if (previa && Array.from(ids).every((id) => previa.consultados.has(id))) return previa.promesa;
  if (ids.size === 0) return Promise.resolve(new Map());
  const entrada = { consultados: new Set(ids), porGrupo: null, promesa: null };
  entrada.promesa = window.db.collection('recibos_pago').where('proveedor', '==', proveedor).get().then((snapshot) => {
    const porGrupo = new Map();
    snapshot.docs.forEach((doc) => {
      const recibo = doc.data();
      if (recibo.grupoPagoId && (recibo.formaPago === 'efectivo' || recibo.formaPago === 'transferencia')) {
        porGrupo.set(recibo.grupoPagoId, recibo.formaPago);
      }
    });
    entrada.porGrupo = porGrupo;
    return porGrupo;
  });
  cxpFormasPagoCache.set(proveedor, entrada);
  entrada.promesa.catch(() => { if (cxpFormasPagoCache.get(proveedor) === entrada) cxpFormasPagoCache.delete(proveedor); });
  return entrada.promesa;
}

// Mini resumen sobre el desplegable; se omite si el proveedor no tiene movimientos de saldo a favor activos.
function crearResumenSaldoAFavorPagosCxP(resumen) {
  if (resumen.anticipos === 0 && resumen.aplicado === 0) return null;
  const caja = document.createElement('div');
  caja.className = 'cxp-resumen-saldo-favor';
  caja.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.4rem 1.5rem;margin-top:0.75rem;font-size:0.9rem;color:var(--azul-marino)';
  [
    ['Anticipos recibidos', resumen.anticipos],
    ['Saldo aplicado a tickets', resumen.aplicado],
    ['Saldo a favor disponible', resumen.disponible]
  ].forEach(([etiqueta, monto]) => {
    const item = document.createElement('span');
    const nombre = document.createElement('span');
    nombre.textContent = `${etiqueta}: `;
    const valor = document.createElement('strong');
    valor.textContent = window.formatearMoneda(monto);
    item.appendChild(nombre);
    item.appendChild(valor);
    caja.appendChild(item);
  });
  return caja;
}

// Claves abiertas ('proveedor' o 'proveedor|fecha'); sobreviven al re-render de la vista.
const cxpPagosPorDiaAbierto = new Set();

function crearPagosPorDiaCxP(cuentas, nombreProveedor) {
  const registroProveedor = (window.EVE.proveedores || []).find((p) => p.nombre === nombreProveedor);
  const movimientos = movimientosSaldoAFavor(registroProveedor);
  const dias = agruparPagosPorDiaCxP(cuentas, movimientos);
  const resumenSaldo = resumirSaldoAFavorCxP(movimientos);
  const filas = construirFilasPagosPorDiaCxP(dias, resumenSaldo.filasAnticipo);
  const celdasForma = [];
  let tablaDias = null;
  const envoltura = document.createElement('div');
  const miniResumen = crearResumenSaldoAFavorPagosCxP(resumenSaldo);
  if (miniResumen) envoltura.appendChild(miniResumen);
  const detalles = document.createElement('details');
  detalles.className = 'cxp-pagos-por-dia';
  detalles.style.marginTop = '0.75rem';
  detalles.open = cxpPagosPorDiaAbierto.has(nombreProveedor);
  envoltura.appendChild(detalles);

  const pintarFormas = (porGrupo) => {
    celdasForma.forEach(({ celda, dia }) => {
      celda.textContent = desglosarFormasPagoDiaCxP(dia, porGrupo);
      celda.style.color = '';
      celda.style.fontStyle = '';
    });
    // El texto de 'Forma de pago' cambió: si se ordena por esa columna, se reacomoda.
    if (tablaDias && window.reaplicarOrdenTabla) window.reaplicarOrdenTabla(tablaDias);
  };
  const cargarFormas = () => {
    if (dias.length === 0) return;
    const ids = idsGrupoPagoDiasCxP(dias);
    if (ids.size === 0) { pintarFormas(new Map()); return; }
    const enCache = formasPagoEnCacheCxP(nombreProveedor, ids);
    if (enCache) { pintarFormas(enCache); return; }
    celdasForma.forEach(({ celda }) => {
      celda.textContent = 'Cargando…';
      celda.style.color = 'var(--gris-oscuro)';
      celda.style.fontStyle = 'italic';
    });
    cargarFormasPagoProveedorCxP(nombreProveedor, ids).then(pintarFormas, () => pintarFormas(null));
  };

  detalles.addEventListener('toggle', () => {
    if (detalles.open) {
      cxpPagosPorDiaAbierto.add(nombreProveedor);
      cargarFormas();
    } else {
      cxpPagosPorDiaAbierto.delete(nombreProveedor);
    }
  });
  const resumen = document.createElement('summary');
  resumen.style.cursor = 'pointer';
  resumen.style.fontWeight = '600';
  resumen.textContent = `Pagos por día (${dias.length})`;
  detalles.appendChild(resumen);

  if (filas.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin pagos registrados';
    detalles.appendChild(vacio);
    return envoltura;
  }

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = '<thead><tr><th data-tipo="fecha">Fecha de pago</th><th data-tipo="moneda">Total pagado</th><th data-tipo="texto">Forma de pago</th><th data-tipo="numero">Tickets cubiertos</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');
  // id fijo por proveedor: el orden elegido (módulo de ordenamiento) sobrevive al repintar la vista.
  tbody.id = `cxp-pagos-dias-${nombreProveedor}`;
  filas.forEach((item) => {
    if (item.tipo === 'anticipo') {
      // Dinero recibido por adelantado: se ve en la línea de tiempo pero no entra en el total pagado de los tickets.
      const filaAnticipo = document.createElement('tr');
      filaAnticipo.className = 'cxp-anticipo-fila';
      filaAnticipo.style.cssText = 'background:var(--gris-claro);font-style:italic;box-shadow:inset 3px 0 0 var(--oro)';
      const celdaFechaAnticipo = document.createElement('td');
      celdaFechaAnticipo.textContent = window.formatearFecha(item.fecha);
      const celdaMonto = document.createElement('td');
      celdaMonto.textContent = window.formatearMoneda(item.monto);
      const celdaEtiqueta = document.createElement('td');
      celdaEtiqueta.textContent = 'Anticipo recibido';
      celdaEtiqueta.style.fontWeight = '600';
      const celdaSin = document.createElement('td');
      celdaSin.textContent = '—';
      const celdaVacia = document.createElement('td');
      [celdaFechaAnticipo, celdaMonto, celdaEtiqueta, celdaSin, celdaVacia].forEach((celda) => filaAnticipo.appendChild(celda));
      tbody.appendChild(filaAnticipo);
      return;
    }
    const dia = item.dia;
    const clave = `${nombreProveedor}|${dia.fecha}`;
    const fila = document.createElement('tr');
    const celdaFecha = document.createElement('td');
    celdaFecha.textContent = window.formatearFecha(dia.fecha);
    const celdaTotal = document.createElement('td');
    celdaTotal.textContent = window.formatearMoneda(dia.total);
    const celdaForma = document.createElement('td');
    const celdaTickets = document.createElement('td');
    celdaTickets.textContent = String(dia.numTickets);
    [celdaFecha, celdaTotal, celdaForma, celdaTickets].forEach((celda) => fila.appendChild(celda));
    celdasForma.push({ celda: celdaForma, dia });
    const celdaToggle = document.createElement('td');
    const boton = document.createElement('button');
    boton.className = 'btn-secondary';
    boton.type = 'button';
    boton.textContent = cxpPagosPorDiaAbierto.has(clave) ? 'Ocultar' : 'Ver tickets';
    celdaToggle.appendChild(boton);
    fila.appendChild(celdaToggle);
    tbody.appendChild(fila);

    const filaDetalle = document.createElement('tr');
    filaDetalle.setAttribute('data-fila-ligada', '1'); // viaja junto a su día al ordenar
    filaDetalle.style.display = cxpPagosPorDiaAbierto.has(clave) ? '' : 'none';
    const celdaDetalle = document.createElement('td');
    celdaDetalle.colSpan = 5;
    // En pantallas angostas la tabla del detalle se desplaza por su cuenta en vez de ensanchar todo el bloque.
    const envolturaLista = document.createElement('div');
    envolturaLista.style.cssText = 'overflow-x:auto;max-width:100%';
    const lista = document.createElement('table');
    lista.className = 'tabla-destaraje';
    lista.style.fontSize = '0.9rem';
    lista.innerHTML = '<thead><tr><th data-tipo="ticket">Ticket</th><th data-tipo="texto">Material</th><th data-tipo="numero">Kg</th><th data-tipo="moneda">Precio efectivo</th><th data-tipo="moneda">Total del ticket</th><th data-tipo="moneda">Monto pagado</th><th data-tipo="texto">Origen</th></tr></thead>';
    const cuerpo = document.createElement('tbody');
    cuerpo.id = `cxp-pagos-tickets-${nombreProveedor}-${dia.fecha}`; // el orden de cada día es independiente

    dia.tickets.forEach((t) => {
      const filaTicket = document.createElement('tr');
      // Mismos formatos que la fila del ticket en la tabla de cuentas (formatearKg / formatearMoneda sobre los valores de la cuenta).
      const valores = [
        t.ticket || 'Saldo inicial', t.material || '', window.formatearKg(t.kg, t.material),
        window.formatearMoneda(t.precioEfectivo), window.formatearMoneda(t.total), window.formatearMoneda(t.monto),
        t.saldoAFavor ? 'Saldo a favor' : 'Pago con recibo'
      ];
      valores.forEach((valor, indice) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        if (indice === 5 && centavosCxP(t.pagadoDia) < centavosCxP(t.total)) {
          const etiqueta = document.createElement('small');
          etiqueta.className = 'cxp-pago-parcial';
          etiqueta.textContent = 'pago parcial';
          etiqueta.style.cssText = 'margin-left:0.4rem;color:var(--gris-oscuro);font-style:italic;white-space:nowrap';
          celda.appendChild(etiqueta);
        }
        filaTicket.appendChild(celda);
      });
      cuerpo.appendChild(filaTicket);
    });
    lista.appendChild(cuerpo);
    window.activarOrdenamiento(lista);
    envolturaLista.appendChild(lista);
    celdaDetalle.appendChild(envolturaLista);
    filaDetalle.appendChild(celdaDetalle);
    tbody.appendChild(filaDetalle);

    boton.addEventListener('click', () => {
      const abrir = filaDetalle.style.display === 'none';
      filaDetalle.style.display = abrir ? '' : 'none';
      boton.textContent = abrir ? 'Ocultar' : 'Ver tickets';
      if (abrir) cxpPagosPorDiaAbierto.add(clave);
      else cxpPagosPorDiaAbierto.delete(clave);
    });
  });
  tabla.appendChild(tbody);
  // Orden por defecto: fecha de pago descendente (la más reciente primero), con flecha en la columna activa.
  window.activarOrdenamiento(tabla, { porDefecto: { indice: 0, direccion: 'desc' } });
  tablaDias = tabla;
  detalles.appendChild(tabla);
  if (detalles.open) cargarFormas();
  return envoltura;
}

function crearTablaCuentas(cuentas, nombreProveedor) {
  depurarSeleccionRecibo();
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th></th><th data-tipo="ticket">Ticket</th><th data-tipo="texto">Material</th><th data-tipo="numero">Kg</th><th data-tipo="moneda">Precio Efectivo</th><th data-tipo="moneda">Total</th><th data-tipo="moneda">IVA</th><th data-tipo="moneda">Pagado</th><th data-tipo="moneda">Saldo</th><th data-tipo="texto">Estado</th><th data-tipo="fecha">Fecha</th><th data-tipo="fecha">Pagado el</th><th>Abonos</th><th>Ajuste Precio</th><th>Editar Material</th><th>Editar Kg</th><th>Editar Proveedor</th><th>Ajustar IVA</th><th>Eliminar</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  tbody.id = 'cxp-tabla-cuentas-' + (nombreProveedor || 'todas');
  const cuentasOrdenadas = cuentas
    .slice()
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? 1 : -1));
  const cuentasActivas = cuentasOrdenadas.filter((c) => !cuentaLiquidadaCxP(c));
  const cuentasLiquidadas = cuentasOrdenadas.filter(cuentaLiquidadaCxP);
  const claveExpandidoLiquidados = nombreProveedor || '__todos__';
  const liquidadosExpandido = cxpLiquidadosExpandido.has(claveExpandidoLiquidados);

  const comprometido = nombreProveedor ? comprometidoPorCuenta(nombreProveedor) : new Map();

  function renderizarFilaCuenta(c) {
      const fila = document.createElement('tr');
      // Lo ya comprometido en otros recibos pendientes no se ofrece de nuevo: el tope y el monto por defecto son el saldo disponible.
      const disponible = saldoDisponibleCxP(c, comprometido);

      const celdaCheckbox = document.createElement('td');
      if (disponible > 0 && window.puedeEscribir('cxp')) {
        const checkboxRecibo = document.createElement('input');
        checkboxRecibo.type = 'checkbox';
        checkboxRecibo.dataset.cuentaId = c.id;
        checkboxRecibo.checked = ticketsSeleccionadosRecibo.has(c.id);

        const inputMonto = document.createElement('input');
        inputMonto.type = 'number';
        inputMonto.dataset.cuentaId = c.id;
        inputMonto.step = '0.01';
        inputMonto.min = '0.01';
        inputMonto.max = String(disponible);
        inputMonto.style.width = '90px';
        inputMonto.style.marginLeft = '0.4rem';
        inputMonto.title = 'Monto a cubrir para este ticket (por defecto, su saldo completo)';
        inputMonto.value = montosSeleccionadosRecibo.has(c.id) ? montosSeleccionadosRecibo.get(c.id) : disponible.toFixed(2);
        inputMonto.disabled = !checkboxRecibo.checked;

        function actualizarTotalYBoton() {
          const totalSeleccionado = document.getElementById('cxp-total-seleccionado');
          if (totalSeleccionado) totalSeleccionado.textContent = 'Total seleccionado: ' + window.formatearMoneda(calcularTotalSeleccionado(cuentas));
          // Tras editar a mano una marca o un monto, el Monto total muestra la suma de lo marcado.
          const campoMontoTotal = document.getElementById('cxp-monto-total-recibo');
          if (campoMontoTotal) campoMontoTotal.value = ticketsSeleccionadosRecibo.size > 0 ? calcularTotalSeleccionado(cuentas).toFixed(2) : '';
          actualizarBotonGenerarRecibo();
        }

        checkboxRecibo.addEventListener('change', () => {
          if (checkboxRecibo.checked) {
            ticketsSeleccionadosRecibo.add(c.id);
            marcasManualesRecibo.add(c.id);
            if (!montosSeleccionadosRecibo.has(c.id)) montosSeleccionadosRecibo.set(c.id, disponible);
            inputMonto.value = montosSeleccionadosRecibo.get(c.id);
            inputMonto.disabled = false;
          } else {
            ticketsSeleccionadosRecibo.delete(c.id);
            montosSeleccionadosRecibo.delete(c.id);
            marcasManualesRecibo.delete(c.id);
            inputMonto.disabled = true;
          }
          actualizarTotalYBoton();
        });

        inputMonto.addEventListener('change', () => {
          let valor = Number(inputMonto.value);
          if (!Number.isFinite(valor) || valor <= 0) {
            window.showError('El monto a cubrir debe ser mayor a 0');
            valor = disponible;
          } else if (valor > disponible) {
            window.showError(`El monto no puede exceder el saldo disponible (${window.formatearMoneda(disponible)})${disponible < c.saldo ? ', ya hay recibos pendientes por el resto' : ''}`);
            valor = disponible;
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

      // Fecha del último abono: solo en cuentas liquidadas, para no abrir 'Ver (n)'.
      const celdaPagadoEl = document.createElement('td');
      const fechaPagadoEl = cuentaLiquidadaCxP(c) ? fechaUltimoAbonoCxP(c) : '';
      celdaPagadoEl.textContent = fechaPagadoEl ? window.formatearFecha(fechaPagadoEl) : '';
      fila.appendChild(celdaPagadoEl);

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

      const celdaProveedor = document.createElement('td');
      if (window.puedeEscribir('cxp')) {
        const btnProveedor = document.createElement('button');
        btnProveedor.className = 'btn-secondary';
        btnProveedor.textContent = 'Editar proveedor';
        if (esSaldoInicial) {
          btnProveedor.disabled = true;
          btnProveedor.title = 'Esta cuenta es un saldo inicial histórico: su proveedor no se puede cambiar.';
        } else if (c.pagado > 0 || (c.abonos || []).length > 0) {
          btnProveedor.disabled = true;
          btnProveedor.title = `No se puede cambiar el proveedor: esta cuenta ya tiene abonos aplicados. ${window.EVE_CXP.MENSAJE_CXP_CON_ABONOS}.`;
        } else if (comprometido.has(c.id)) {
          btnProveedor.disabled = true;
          btnProveedor.title = `No se puede cambiar el proveedor. ${MENSAJE_CXP_EN_RECIBO_PENDIENTE}.`;
        } else {
          btnProveedor.addEventListener('click', () => abrirModalEditarProveedor(c));
        }
        celdaProveedor.appendChild(btnProveedor);
      }
      fila.appendChild(celdaProveedor);

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
        celdaDetalle.colSpan = 19;
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
    celdaToggleLiquidados.colSpan = 19;
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

  if (nombreProveedor) {
    contenedor.appendChild(crearPagosPorDiaCxP(cuentas, nombreProveedor));
  }

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

    const campoMontoTotal = document.createElement('input');
    campoMontoTotal.type = 'number';
    campoMontoTotal.id = 'cxp-monto-total-recibo';
    campoMontoTotal.step = '0.01';
    campoMontoTotal.min = '0.01';
    campoMontoTotal.placeholder = 'Monto total del recibo';
    campoMontoTotal.title = 'Monto total del recibo: se reparte PEPS (más antiguo primero) entre las filas marcadas a mano o, si no hay ninguna, entre todas las cuentas con saldo';
    campoMontoTotal.style.width = '160px';
    campoMontoTotal.value = ticketsSeleccionadosRecibo.size > 0 ? calcularTotalSeleccionado(cuentas).toFixed(2) : '';
    campoMontoTotal.addEventListener('input', actualizarBotonGenerarRecibo);
    campoMontoTotal.addEventListener('change', () => {
      if (campoMontoTotal.value === '') return;
      aplicarMontoTotalRecibo(cuentas, nombreProveedor, campoMontoTotal.value);
    });
    filaRecibo.appendChild(campoMontoTotal);

    // El reparto PEPS solo ve las cuentas del periodo visible: fuera de "Todos" se avisa junto al campo.
    const avisoPeriodo = document.createElement('span');
    avisoPeriodo.id = 'cxp-aviso-periodo-reparto';
    avisoPeriodo.style.fontSize = '0.85rem';
    avisoPeriodo.style.color = '#b45309';
    avisoPeriodo.textContent = 'El reparto aplica solo a las cuentas del periodo visible; cambia a Todos para repartir PEPS sobre toda la deuda';
    avisoPeriodo.style.display = tabProveedorPeriodo === 'todos' ? 'none' : '';
    filaRecibo.appendChild(avisoPeriodo);

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
    btnGenerarRecibo.addEventListener('click', () => manejarGenerarReciboPendiente(nombreProveedor, cuentas));
    filaRecibo.appendChild(btnGenerarRecibo);

    const btnLimpiarSeleccion = document.createElement('button');
    btnLimpiarSeleccion.className = 'btn-secondary';
    btnLimpiarSeleccion.id = 'cxp-btn-limpiar-recibo';
    btnLimpiarSeleccion.textContent = 'Limpiar';
    btnLimpiarSeleccion.addEventListener('click', () => {
      ticketsSeleccionadosRecibo.clear();
      montosSeleccionadosRecibo.clear();
      marcasManualesRecibo.clear();
      renderizarVistaActiva();
    });
    filaRecibo.appendChild(btnLimpiarSeleccion);

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

  let cuentas = cuentasVisiblesCxP();
  if (tabTodos === 'semana' || tabTodos === 'mes') {
    cuentas = window.EVE_CXP.filtrarCxP(cuentas, calcularRangoPeriodoCxP(tabTodos));
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
  await window.protegerContraDobleRegistro('pagos-general', async () => {
    envioPagoEnCurso = true;
    botonGuardar.disabled = true;
    try {
      if (ticket) {
        const cxp = window.EVE.cuentasPorPagar.find((c) => c.proveedor === modalContexto.proveedor && String(c.ticket) === ticket);
        if (!cxp) {
          window.showError('No se encontró una cuenta por pagar para ese ticket');
          return false;
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
        marcarPagoDeSaldoInicial(registroPago, cxp);
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
          if (!confirmado) return false;
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
      return false;
    } finally {
      envioPagoEnCurso = false;
      botonGuardar.disabled = false;
    }
  });
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

async function manejarGenerarReciboPendiente(proveedor, cuentasVisibles) {
  if (!window.puedeEscribir('cxp')) {
    window.showError('No tienes permiso para generar recibos');
    return;
  }
  const boton = document.getElementById('cxp-btn-generar-recibo');
  await window.protegerContraDobleRegistro('cxp-generar-recibo', async () => {
    // Antes de repartir o validar, se vuelven a leer los recibos pendientes del proveedor: su monto ya está comprometido (otro usuario
    // pudo generar uno). Si la lectura falla se usa lo último que se leyó.
    try {
      await consultarRecibosPendientesProveedor(proveedor);
    } catch (errorLectura) {
      // sin conexión o sin Firestore: se conserva lo último leído
    }
    // Un Monto total escrito y aún sin repartir se reparte primero (el reparto actualiza la pantalla sin redibujarla, así el clic no se
    // pierde); si el reparto avisa de un error, no se genera el recibo.
    const cuentasReparto = cuentasVisibles || window.EVE.cuentasPorPagar.filter((c) => c.proveedor === proveedor);
    if (hayMontoTotalPendiente(cuentasReparto)) {
      const campo = document.getElementById('cxp-monto-total-recibo');
      if (!aplicarMontoTotalRecibo(cuentasReparto, proveedor, campo.value)) return false;
    }
    const idsSeleccionados = Array.from(ticketsSeleccionadosRecibo);
    const cuentasSeleccionadas = window.EVE.cuentasPorPagar.filter(
      (c) => c.proveedor === proveedor && idsSeleccionados.includes(c.id)
    );
    if (cuentasSeleccionadas.length === 0) {
      window.showError('Selecciona al menos un ticket');
      return false;
    }
    if (boton) boton.disabled = true;
    try {
      const comprometido = comprometidoPorCuenta(proveedor);
      const tickets = cuentasSeleccionadas.map((c) => ({
        // cuentaId: un mismo ticket puede tener varias cuentas (material/proveedor); Pagos resuelve la cuenta por este id.
        cuentaId: c.id, ticket: c.ticket, material: c.material, kg: c.kg, precio: c.precioEfectivo,
        saldo: c.saldo,
        montoAsignado: montosSeleccionadosRecibo.has(c.id) ? Number(montosSeleccionadosRecibo.get(c.id)) : saldoDisponibleCxP(c, comprometido)
      }));
      for (const t of tickets) {
        if (!Number.isFinite(t.montoAsignado) || t.montoAsignado <= 0 || t.montoAsignado > t.saldo + 0.01) {
          window.showError(`Monto asignado inválido para el ticket ${t.ticket}`);
          return false;
        }
        // También los montos por fila marcados a mano: no pueden usar saldo que otros recibos pendientes ya tienen asignado.
        const disponible = saldoDisponibleCxP({ id: t.cuentaId, saldo: t.saldo }, comprometido);
        if (t.montoAsignado > disponible + 0.01) {
          window.showError(`El ticket ${t.ticket} (${t.material}) solo tiene ${window.formatearMoneda(disponible)} disponibles: ${window.formatearMoneda(t.saldo - disponible)} ya están comprometidos en otros recibos pendientes. No se generó el recibo.`);
          return false;
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
      // El recibo nuevo ya cuenta como comprometido para los repartos siguientes.
      const claveProveedor = window.normalizarProveedor(proveedor);
      recibosPendientesPorProveedor.set(claveProveedor, [...(recibosPendientesPorProveedor.get(claveProveedor) || []), { id: idRecibo, ...recibo }]);
      generarPDFRecibo({ proveedor, fecha: fechaGeneracion.slice(0, 10), tickets, totalPago: montoTotal, formaPago });
      ticketsSeleccionadosRecibo.clear();
      montosSeleccionadosRecibo.clear();
      marcasManualesRecibo.clear();
      window.showSuccess('Recibo pendiente generado. El pago se ejecutará en Pagos > Recibos Pendientes.');
      renderizarVistaActiva();
    } catch (error) {
      window.showError(error.message);
      return false;
    } finally {
      if (boton) boton.disabled = false;
    }
  });
}

window.EVE_CXP.manejarGenerarReciboPendiente = manejarGenerarReciboPendiente;

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

// "DD/MM/AAAA HH:mm" con la hora de registro del recibo (recibo.timestamp, el ISO que guardan los recibos_pago). Sin hora guardada
// se queda solo la fecha, sin inventarla. Si el pago se capturó con una fecha distinta al día en que se registró (pago con fecha
// atrasada), esa hora pertenece a otro día y tampoco se muestra.
function textoFechaRecibo(recibo) {
  const fecha = window.formatearFecha(recibo.fecha);
  const registro = window.fechaYHoraMexico(recibo.timestamp);
  return registro && registro.fecha === recibo.fecha ? `${fecha} ${registro.hora}` : fecha;
}
window.EVE_CXP.textoFechaRecibo = textoFechaRecibo;

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
  pdf.text(`Fecha: ${esFinal ? textoFechaRecibo(recibo) : window.formatearFecha(recibo.fecha)}`, 14, y);
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
  renderizarAvisoDesalineacion(document.getElementById('cxp-aviso-desalineacion'));
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
  actualizarBarraSeleccionCxP();
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
  const cuentas = cuentasVisiblesCxP();
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
  const activas = ordenadas.filter((c) => !cuentaLiquidadaCxP(c));
  const liquidadas = ordenadas.filter(cuentaLiquidadaCxP);
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
  const nombresPeriodo = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes', ultimos30: 'Últimos 30 días', rango: 'Rango' };
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

  if (window.puedeEscribir('cxp')) {
    const btnSaldoInicial = document.createElement('button');
    btnSaldoInicial.id = 'btn-registrar-saldo-inicial-cxp';
    btnSaldoInicial.textContent = 'Registrar saldo inicial';
    btnSaldoInicial.className = 'btn-secondary';
    btnSaldoInicial.addEventListener('click', abrirModalSaldoInicialCxP);
    div.appendChild(btnSaldoInicial);
  }
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
function etiquetaProveedorConSaldoInicial(grupo) {
  const saldoInicial = calcularSaldoInicialCxP(grupo.cuentas);
  return saldoInicial > 0 ? `${grupo.proveedor} (de los cuales saldo inicial: ${window.formatearMoneda(saldoInicial)})` : grupo.proveedor;
}

// Un ticket tiene saldo por cobrar solo si su saldo llega al menos a 1 centavo. Un residuo de decimales (p. ej. 0.0004) ya
// es 'liquidado' en calcularEstado y se vería como 0.00, así que no cuenta. Se agrupa solo lo que se muestra: el subtotal
// por proveedor sale de las mismas filas.
function tieneSaldoParaCapturaCxP(cuenta) {
  return !esLiquidadoCxP(cuenta.saldo);
}

// Orden de los tickets dentro de cada proveedor en la Vista para captura. 'fecha' es el comportamiento de siempre.
const CLAVE_ORDEN_CAPTURA_CXP = 'cxp_captura_orden';
const ORDENES_CAPTURA_CXP = [
  { valor: 'fecha', etiqueta: 'Fecha' },
  { valor: 'ticket', etiqueta: 'Ticket' },
  { valor: 'material', etiqueta: 'Material' }
];

// Respaldo en memoria: solo se usa si el navegador no deja leer localStorage (así la elección sobrevive mientras la app está abierta).
let ordenCapturaCxPEnMemoria = null;

function obtenerOrdenCapturaCxP() {
  let guardado = null;
  try {
    guardado = window.localStorage.getItem(CLAVE_ORDEN_CAPTURA_CXP);
  } catch (e) {
    guardado = ordenCapturaCxPEnMemoria;
  }
  return ORDENES_CAPTURA_CXP.some((o) => o.valor === guardado) ? guardado : 'fecha';
}

function guardarOrdenCapturaCxP(valor) {
  if (!ORDENES_CAPTURA_CXP.some((o) => o.valor === valor)) return;
  ordenCapturaCxPEnMemoria = valor;
  try { window.localStorage.setItem(CLAVE_ORDEN_CAPTURA_CXP, valor); } catch (e) { /* sin almacenamiento: queda en memoria */ }
}

const compararFechaCapturaCxP = (a, b) => (a.fechaTicket < b.fechaTicket ? -1 : a.fechaTicket > b.fechaTicket ? 1 : 0);

// Ticket numérico de menor a mayor (9 antes que 80 y 100); los que no son número (p. ej. el saldo inicial, sin ticket) van al final.
function compararTicketCapturaCxP(a, b) {
  const textoA = String(a.ticket === undefined || a.ticket === null ? '' : a.ticket).trim();
  const textoB = String(b.ticket === undefined || b.ticket === null ? '' : b.ticket).trim();
  const numeroA = /^\d+(\.\d+)?$/.test(textoA) ? Number(textoA) : null;
  const numeroB = /^\d+(\.\d+)?$/.test(textoB) ? Number(textoB) : null;
  if (numeroA !== null && numeroB !== null) return numeroA - numeroB;
  if (numeroA !== null) return -1;
  if (numeroB !== null) return 1;
  return textoA < textoB ? -1 : textoA > textoB ? 1 : 0;
}

// Material A-Z sin mayúsculas ni acentos, sobre el nombre canónico (así 'cartón' y 'CARTON' son el mismo material y quedan juntos).
function claveMaterialCapturaCxP(cuenta) {
  return window.normalizarMaterial(cuenta.material).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Devuelve una copia ordenada; nunca modifica la lista recibida ni cambia qué filas entran (eso lo decide el filtro de saldo).
function ordenarFilasCapturaCxP(filas, orden) {
  const copia = filas.slice();
  if (orden === 'ticket') {
    return copia.sort((a, b) => compararTicketCapturaCxP(a, b) || compararFechaCapturaCxP(a, b));
  }
  if (orden === 'material') {
    return copia.sort((a, b) => {
      const claveA = claveMaterialCapturaCxP(a);
      const claveB = claveMaterialCapturaCxP(b);
      if (claveA !== claveB) return claveA < claveB ? -1 : 1;
      return compararFechaCapturaCxP(a, b) || compararTicketCapturaCxP(a, b);
    });
  }
  return copia.sort(compararFechaCapturaCxP);
}

function construirConfigCapturaCxP(cuentas, totalGeneral, periodo, saldoInicialGeneral, orden) {
  const ordenElegido = ORDENES_CAPTURA_CXP.some((o) => o.valor === orden) ? orden : obtenerOrdenCapturaCxP();
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(cuentas.filter(tieneSaldoParaCapturaCxP))
    .sort((a, b) => b.saldo - a.saldo);
  // Total del periodo = compras: el saldo inicial queda fuera (sí está en Total Adeudado General y en Saldo por proveedor).
  const totalPeriodo = grupos.reduce((suma, g) => suma + g.cuentas.filter((c) => !esCxPSaldoInicial(c)).reduce((s, c) => s + (!esLiquidadoCxP(c.saldo) ? c.saldo : 0), 0), 0);

  const bloques = grupos.map((g) => {
    const filas = ordenarFilasCapturaCxP(g.cuentas.filter(tieneSaldoParaCapturaCxP), ordenElegido);
    const hayAbonos = filas.some((c) => c.pagado > 0);
    return {
      clave: g.proveedor,
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
    ].concat(saldoInicialGeneral > 0 ? [{ label: 'de los cuales saldo inicial', valor: window.formatearMoneda(saldoInicialGeneral) }] : []),
    resumenSecciones: grupos.length > 0 ? [{
      titulo: 'Saldo por proveedor',
      filas: grupos.map((g) => ({ label: etiquetaProveedorConSaldoInicial(g), valor: window.formatearMoneda(g.saldo), clave: g.proveedor, monto: g.saldo })),
      etiquetaLabel: 'Proveedor',
      etiquetaValor: 'Saldo',
      seleccion: {
        marcados: cxpSeleccionados,
        alAlternar: alternarSeleccionCxP,
        etiquetaTotal: 'Total seleccionado',
        formatoTotal: (monto) => window.formatearMoneda(monto)
      }
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
  const { total: totalGeneral, saldoInicial } = calcularTotalAdeudadoGeneral();
  window.VistaCaptura.abrir(
    construirConfigCapturaCxP(obtenerCuentasSegunTabActivo(), totalGeneral, construirEtiquetaPeriodoCapturaCxP(), saldoInicial)
  );
  const overlay = document.getElementById('vista-captura-overlay');
  window.EVE_CXP_CAPTURA_PDF.agregarBotones(overlay);
  agregarSelectorOrdenCapturaCxP(overlay);
}

// Selector 'Ordenar por' arriba de la vista. Al cambiarlo se guarda la elección y la vista se vuelve a armar con ese orden; como
// Descargar PDF y Compartir fotografían lo que está en pantalla, salen en el mismo orden. Fuera de la captura y de la impresión.
function agregarSelectorOrdenCapturaCxP(overlay) {
  const contenido = overlay && overlay.querySelector('.captura-contenido');
  if (!contenido || !overlay.querySelector('.captura-dia')) return;
  const barra = document.createElement('div');
  barra.className = 'captura-acciones captura-no-imprimir';
  barra.style.alignItems = 'center';
  barra.setAttribute('data-html2canvas-ignore', 'true');
  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Ordenar por ';
  etiqueta.htmlFor = 'cxp-captura-orden';
  const selector = document.createElement('select');
  selector.id = 'cxp-captura-orden';
  ORDENES_CAPTURA_CXP.forEach((opcion) => {
    const elemento = document.createElement('option');
    elemento.value = opcion.valor;
    elemento.textContent = opcion.etiqueta;
    selector.appendChild(elemento);
  });
  selector.value = obtenerOrdenCapturaCxP();
  selector.addEventListener('change', () => {
    const interruptor = overlay.querySelector('.captura-solo-seleccionados input');
    const soloSeleccionados = !!(interruptor && interruptor.checked);
    guardarOrdenCapturaCxP(selector.value);
    abrirVistaCapturaCxP();
    if (soloSeleccionados) {
      const nuevo = document.querySelector('#vista-captura-overlay .captura-solo-seleccionados input');
      if (nuevo) { nuevo.checked = true; nuevo.dispatchEvent(new Event('change')); }
    }
  });
  barra.appendChild(etiqueta);
  barra.appendChild(selector);
  const encabezado = contenido.querySelector('.captura-header');
  contenido.insertBefore(barra, encabezado ? encabezado.nextSibling : contenido.firstChild);
}

window.EVE_CXP.construirConfigCapturaCxP = construirConfigCapturaCxP;
window.EVE_CXP.ordenarFilasCapturaCxP = ordenarFilasCapturaCxP;
window.EVE_CXP.obtenerOrdenCapturaCxP = obtenerOrdenCapturaCxP;
window.EVE_CXP.guardarOrdenCapturaCxP = guardarOrdenCapturaCxP;
window.EVE_CXP.agregarSelectorOrdenCapturaCxP = agregarSelectorOrdenCapturaCxP;
window.EVE_CXP.abrirVistaCapturaCxP = abrirVistaCapturaCxP;
window.EVE_CXP.incluirSociosCxP = incluirSociosCxP;
window.EVE_CXP.cuentasVisiblesCxP = cuentasVisiblesCxP;

// ── Registrar saldo inicial (cuenta sin ticket ni kg que representa deuda previa a EVE) ──
// Función pura: arma el documento de cuentas_por_pagar. tipo='saldo_inicial' lo distingue de una compra; aprobacion.tipo se
// conserva igual que en los saldos importados para que los bloqueos de edición existentes (kg, material, proveedor, IVA) lo cubran.
function construirDocSaldoInicial({ proveedor, monto, fecha, nota, usuario }) {
  const nombre = window.normalizarProveedor(proveedor);
  if (!nombre) throw new Error('Proveedor es obligatorio');
  const importe = Number.isFinite(Number(monto)) ? window.redondearCentavos(monto) : NaN;
  if (!Number.isFinite(importe) || importe <= 0) throw new Error('El monto debe ser un número mayor a 0');
  if (!fecha) throw new Error('La fecha es obligatoria');
  const notaLimpia = String(nota || '').trim();
  return {
    tipo: 'saldo_inicial',
    ticket: '',
    proveedor: nombre,
    material: 'VARIOS',
    kg: 0,
    fechaTicket: fecha,
    precioAplicado: null,
    comisionPorKg: 0,
    precioEfectivo: null,
    montoMaterial: 0,
    montoComision: 0,
    total: importe,
    pagado: 0,
    saldo: importe,
    estado: 'pendiente',
    origenAuditoria: false,
    idAuditoria: null,
    idFotoAuditoria: null,
    aprobacion: { tipo: 'saldo_inicial', motivo: notaLimpia || 'Registro de saldo inicial', aprobadoPor: usuario, fecha: window.obtenerFechaMexico() },
    abonos: [],
    precioNegociado: null,
    motivoAjustePrecio: null,
    nota: notaLimpia,
    creadoPor: usuario
  };
}

async function registrarSaldoInicialCxP(datos) {
  const doc = construirDocSaldoInicial({ ...datos, usuario: usuarioActual() });
  const id = await window.guardarDato('cuentas_por_pagar', doc);
  insertarCxPEnMemoria(id, doc);
  return id;
}

// Un "Abono a saldo inicial" de Pagos descuenta los saldos iniciales del proveedor, el más antiguo primero. Lo que exceda el
// saldo inicial pendiente no se aplica a ninguna otra cuenta. Devuelve el monto aplicado.
async function aplicarAbonoASaldosIniciales(proveedor, monto, fecha) {
  const clave = window.normalizarProveedor(proveedor);
  let restante = window.redondearCentavos(monto);
  let aplicado = 0;
  const cuentas = (window.EVE.cuentasPorPagar || [])
    .filter((c) => esCxPSaldoInicial(c) && window.normalizarProveedor(c.proveedor) === clave && !esLiquidadoCxP(c.saldo))
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? -1 : a.fechaTicket > b.fechaTicket ? 1 : 0));
  for (const cuenta of cuentas) {
    if (restante <= 0.004) break;
    const parte = window.redondearCentavos(Math.min(cuenta.saldo, restante));
    await actualizarAbonoCxP(cuenta.id, {
      monto: parte,
      fecha,
      referencia: 'Abono a saldo inicial desde Pagos',
      registradoPor: usuarioActual(),
      fechaRegistro: new Date().toISOString()
    });
    restante = window.redondearCentavos(restante - parte);
    aplicado = window.redondearCentavos(aplicado + parte);
  }
  return aplicado;
}

function abrirModalSaldoInicialCxP() {
  const previo = document.getElementById('cxp-saldo-inicial-overlay');
  if (previo) previo.remove();
  const overlay = document.createElement('div');
  overlay.id = 'cxp-saldo-inicial-overlay';
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Registrar saldo inicial</h3>
      <label>Proveedor <input type="text" id="cxp-si-proveedor" list="cxp-si-proveedores" autocomplete="off"></label>
      <datalist id="cxp-si-proveedores"></datalist>
      <label>Monto <input type="number" id="cxp-si-monto" min="0.01" step="0.01"></label>
      <label>Fecha <input type="date" id="cxp-si-fecha"></label>
      <label>Nota <input type="text" id="cxp-si-nota" maxlength="200"></label>
      <button type="button" class="btn-primary" id="cxp-si-confirmar">Guardar</button>
      <button type="button" class="btn-secondary" id="cxp-si-cancelar">Cancelar</button>
    </div>
  `;
  const lista = overlay.querySelector('#cxp-si-proveedores');
  nombresProveedoresCxP().forEach((nombre) => {
    const opcion = document.createElement('option');
    opcion.value = nombre;
    lista.appendChild(opcion);
  });
  overlay.querySelector('#cxp-si-fecha').value = window.obtenerFechaMexico();
  overlay.querySelector('#cxp-si-cancelar').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#cxp-si-confirmar').addEventListener('click', async () => {
    const datos = {
      proveedor: overlay.querySelector('#cxp-si-proveedor').value,
      monto: overlay.querySelector('#cxp-si-monto').value,
      fecha: overlay.querySelector('#cxp-si-fecha').value,
      nota: overlay.querySelector('#cxp-si-nota').value
    };
    await window.protegerContraDobleRegistro('cxp-saldo-inicial', async () => {
      try {
        await registrarSaldoInicialCxP(datos);
        overlay.remove();
        renderizarVistaActiva();
        window.showSuccess('Saldo inicial registrado');
      } catch (error) {
        window.showError(error.message);
        return false;
      }
    });
  });
  document.body.appendChild(overlay);
}

window.EVE_CXP.construirDocSaldoInicial = construirDocSaldoInicial;
window.EVE_CXP.registrarSaldoInicialCxP = registrarSaldoInicialCxP;
window.EVE_CXP.aplicarAbonoASaldosIniciales = aplicarAbonoASaldosIniciales;
window.EVE_CXP.esCxPSaldoInicial = esCxPSaldoInicial;
window.EVE_CXP.calcularSaldoInicialCxP = calcularSaldoInicialCxP;
window.EVE_CXP.calcularTotalAdeudadoGeneral = calcularTotalAdeudadoGeneral;
window.EVE_CXP.marcarPagoDeSaldoInicial = marcarPagoDeSaldoInicial;
// ── Diagnóstico de saldos (SOLO LECTURA) ──
// Uso desde la consola del navegador con la sesión iniciada: window.EVE_CXP.diagnosticoSaldos('JOSE ENRIQUE')
// Imprime una tabla por ticket con los valores crudos (todos sus decimales) para ver de dónde sale un residuo. No escribe en
// Firestore, no toca window.EVE ni la pantalla. Fila marcada con '*': saldo crudo mayor que 0 y menor que 0.01.
function diagnosticoSaldos(nombreProveedor) {
  const clave = window.normalizarProveedor(nombreProveedor);
  const cuentas = (window.EVE && window.EVE.cuentasPorPagar || []).filter((c) => window.normalizarProveedor(c.proveedor) === clave);
  if (cuentas.length === 0) {
    console.warn(`diagnosticoSaldos: no hay cuentas por pagar de "${nombreProveedor}" (buscado como "${clave}").`);
    return;
  }
  const filas = cuentas
    .slice()
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? -1 : a.fechaTicket > b.fechaTicket ? 1 : 0))
    .map((c) => {
      const sumaAbonos = (Array.isArray(c.abonos) ? c.abonos : []).reduce((s, a) => s + (Number(a.monto) || 0), 0);
      const saldoCrudo = (Number(c.total) || 0) - sumaAbonos;
      return {
        '': saldoCrudo > 0 && saldoCrudo < 0.01 ? '*' : '',
        ticket: c.ticket,
        kg: c.kg,
        precioEfectivo: c.precioEfectivo,
        total: c.total,
        sumaAbonos,
        saldoCrudo,
        saldoGuardado: c.saldo,
        estadoGuardado: c.estado,
        esLiquidadoCxP: window.esLiquidadoCxP(c.saldo)
      };
    });
  console.log(`diagnosticoSaldos · ${clave} · ${filas.length} cuentas · ${filas.filter((f) => f[''] === '*').length} con * (saldo crudo entre 0 y 0.01)`);
  console.table(filas);
}

window.EVE_CXP.diagnosticoSaldos = diagnosticoSaldos;

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
  const avisoDesalineacion = document.createElement('div');
  avisoDesalineacion.id = 'cxp-aviso-desalineacion';
  avisoDesalineacion.style.display = 'none';
  container.appendChild(avisoDesalineacion);
  container.appendChild(crearBarraAlerta());
  container.appendChild(crearTabsPrincipales());
  container.appendChild(crearBarraExportarCxP());
  container.appendChild(crearVistaProveedores());
  container.appendChild(crearVistaTodos());
  container.appendChild(crearModalPago());
  const espaciadorBarra = document.createElement('div');
  espaciadorBarra.id = 'cxp-barra-espaciador';
  espaciadorBarra.className = 'cxp-barra-espaciador';
  espaciadorBarra.style.display = 'none';
  container.appendChild(espaciadorBarra);
  container.appendChild(crearBarraSeleccionCxP());

  renderizarVistaActiva();
}

window.EVE_MODULES.cxp = { render: renderCxP };

})();
