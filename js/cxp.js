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
    pagado: 0,
    saldo: calculo.total,
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
    grupoPagoId
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

function agregarPorProveedorCxP(cuentas) {
  const mapa = new Map();
  cuentas.forEach((c) => {
    if (!mapa.has(c.proveedor)) {
      mapa.set(c.proveedor, { proveedor: c.proveedor, total: 0, pagado: 0, saldo: 0, cuentas: [] });
    }
    const acc = mapa.get(c.proveedor);
    acc.total += c.total;
    acc.pagado += c.pagado;
    acc.saldo += c.saldo;
    acc.cuentas.push(c);
  });
  return Array.from(mapa.values()).sort((a, b) => a.proveedor.localeCompare(b.proveedor));
}

function filtrarCxP(cuentas, filtros) {
  return cuentas.filter((c) => {
    if (filtros.desde && c.fechaTicket < filtros.desde) return false;
    if (filtros.hasta && c.fechaTicket > filtros.hasta) return false;
    if (filtros.proveedor && c.proveedor !== filtros.proveedor.toUpperCase()) return false;
    if (filtros.material && c.material !== filtros.material.toUpperCase()) return false;
    if (filtros.estado && c.estado !== filtros.estado) return false;
    return true;
  });
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

function distribuirPago(cuentasProveedor, monto, fecha, referencia, registradoPor) {
  const ordenadas = cuentasProveedor
    .filter((c) => c.saldo > 0)
    .slice()
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? -1 : a.fechaTicket > b.fechaTicket ? 1 : 0));
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
      abono: { monto: abonoMonto, fecha, referencia, registradoPor, fechaRegistro: new Date().toISOString() }
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
  filtrarCxP,
  listarPendientesSinAuditar,
  distribuirPago,
  aplicarAbono
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

async function revertirMovimientoSaldoAFavorSiExiste(nombreProveedor, grupoPagoId) {
  if (!grupoPagoId) return;
  const proveedorActual = window.EVE.proveedores.find((p) => p.nombre === nombreProveedor);
  const movimientos = movimientosSaldoAFavor(proveedorActual);
  const indice = movimientos.findIndex((m) => m.grupoPagoId === grupoPagoId && !m.revertido);
  if (indice === -1) return;
  const movimientosActualizados = movimientos.map((m, i) => (i === indice ? { ...m, revertido: true } : m));
  await window.db.collection('proveedores').doc(nombreProveedor).set({
    saldoAFavor: movimientosActualizados,
    ultimaActualizacion: new Date().toISOString()
  }, { merge: true });
  actualizarProveedorEnMemoria(nombreProveedor, movimientosActualizados);
}

async function generarYGuardarCxP(registro, aprobacion, origenAuditoria, idAuditoria, idFotoAuditoria) {
  const precioInfo = window.obtenerPrecioVigente(registro.material, registro.fechaEntrada);
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
      omitidas.push({ ticket: r.ticket, motivo: 'Sin registro de Destaraje vinculado' });
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
      omitidas.push({ ticket: r.ticket, motivo: error.message });
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
      omitidas.push({ ticket: registro.ticket, motivo: error.message });
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
  const cambios = aplicarAbono(cxp, abono);
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
}

async function revertirAbono(cxpId, abonoIndex, motivo, revertidoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  const abono = cxp.abonos[abonoIndex];
  if (!abono) return;
  const abonos = cxp.abonos.filter((_, indice) => indice !== abonoIndex);
  const pagado = abonos.reduce((acc, a) => acc + (Number(a.monto) || 0), 0);
  const saldo = cxp.total - pagado;
  const estado = calcularEstado(pagado, saldo);
  const abonoRevertido = { ...abono, motivo, revertidoPor, fechaReversion: new Date().toISOString() };
  const abonosRevertidos = [...(cxp.abonosRevertidos || []), abonoRevertido];
  const cambios = { abonos, abonosRevertidos, pagado, saldo, estado };
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
  if (abono.grupoPagoId) {
    await revertirMovimientoSaldoAFavorSiExiste(cxp.proveedor, abono.grupoPagoId);
  }
}

async function ajustarPrecioCxP(cxpId, precioNegociado, motivo, ajustadoPor) {
  const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === cxpId);
  if (!cxp) return;
  if (cxp.pagado > 0) {
    throw new Error('No se puede ajustar el precio de una cuenta con abonos aplicados — revierte los abonos primero');
  }
  const kg = Number(cxp.kg) || 0;
  const comision = Number(cxp.comisionPorKg) || 0;
  const precioBase = precioNegociado !== null ? Number(precioNegociado) : cxp.precioAplicado;
  const precioEfectivo = precioBase + comision;
  const montoMaterial = kg * precioBase;
  const montoComision = kg * comision;
  const total = montoMaterial + montoComision;
  const saldo = total;
  const cambios = {
    precioNegociado: precioNegociado !== null ? Number(precioNegociado) : null,
    motivoAjustePrecio: precioNegociado !== null ? motivo : null,
    precioEfectivo,
    montoMaterial,
    montoComision,
    total,
    saldo
  };
  await window.actualizarDato('cuentas_por_pagar', cxpId, cambios);
  Object.assign(cxp, cambios);
}

async function registrarPagoGeneral(nombreProveedor, monto, fecha, referencia, registradoPor) {
  const cuentasProveedor = window.EVE.cuentasPorPagar.filter((c) => c.proveedor === nombreProveedor);
  const { actualizaciones, sobrante } = distribuirPago(cuentasProveedor, monto, fecha, referencia, registradoPor);
  const grupoPagoId = generarGrupoPagoId();
  for (const act of actualizaciones) {
    const cxp = window.EVE.cuentasPorPagar.find((c) => c.id === act.id);
    const abonos = [...cxp.abonos, { ...act.abono, grupoPagoId }];
    await window.actualizarDato('cuentas_por_pagar', act.id, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
    Object.assign(cxp, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
  }
  if (sobrante > 0) {
    await guardarSaldoAFavor(nombreProveedor, {
      monto: sobrante,
      fecha,
      motivo: 'Sobrante de pago aplicado como saldo a favor',
      grupoPagoId
    });
  }
  return { actualizaciones, sobrante };
}

Object.assign(window.EVE_CXP, {
  generarCxPDesdeAuditoria,
  generarCxPSinFoto,
  aprobarManualmente,
  actualizarAbonoCxP,
  registrarPagoGeneral,
  guardarSaldoAFavor,
  revertirAbono,
  ajustarPrecioCxP,
  generarGrupoPagoId,
  totalSaldoAFavor
});

let vistaActiva = 'proveedores';
let proveedorExpandido = null;
let cxpAbonoExpandido = null;
let tabTodos = 'semana';
let filtrosTodos = { desde: '', hasta: '', proveedor: '', material: '', estado: '' };
let modalContexto = null;

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

function obtenerInicioMes() {
  return window.obtenerFechaMexico().slice(0, 7) + '-01';
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
  } else {
    fila.appendChild(crearChip('✅ Sin tickets pendientes de auditar', 'chip-ok'));
  }

  const btnGenerarCorte = document.createElement('button');
  btnGenerarCorte.textContent = 'Generar pendientes anteriores al corte';
  btnGenerarCorte.className = 'btn-secondary';
  btnGenerarCorte.addEventListener('click', async () => {
    btnGenerarCorte.disabled = true;
    try {
      const resumen = await window.EVE_CXP.generarCxPSinFoto();
      window.showSuccess(`${resumen.generadas} cuentas generadas` + (resumen.omitidas.length ? `, ${resumen.omitidas.length} omitidas` : ''));
      if (resumen.omitidas.length) console.warn('CxP sin foto omitidas:', resumen.omitidas);
      renderizarVistaActiva();
    } catch (error) {
      window.showError(error.message);
    } finally {
      btnGenerarCorte.disabled = false;
    }
  });
  fila.appendChild(btnGenerarCorte);
  div.appendChild(fila);

  if (pendientes.length > 0) {
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

function crearVistaProveedores() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxp-proveedores-wrapper';
  return wrapper;
}

function llenarVistaProveedores() {
  const wrapper = document.getElementById('cxp-proveedores-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  const grupos = window.EVE_CXP.agregarPorProveedorCxP(window.EVE.cuentasPorPagar);

  if (grupos.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin cuentas por pagar registradas';
    wrapper.appendChild(vacio);
    return;
  }

  grupos.forEach((grupo) => {
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
    if (saldoAFavorTotal > 0) {
      tarjeta.appendChild(crearChip(`✅ ${grupo.proveedor} — Saldo a favor: ${window.formatearMoneda(saldoAFavorTotal)} (se aplicará al próximo pago)`, 'chip-ok'));
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
      llenarVistaProveedores();
    });
    acciones.appendChild(btnDetalle);

    const btnPago = document.createElement('button');
    btnPago.className = 'btn-primary';
    btnPago.textContent = 'Registrar Pago';
    btnPago.addEventListener('click', () => abrirModalPago(grupo.proveedor));
    acciones.appendChild(btnPago);

    tarjeta.appendChild(acciones);

    if (proveedorExpandido === grupo.proveedor) {
      tarjeta.appendChild(crearTablaCuentas(grupo.cuentas));
    }

    wrapper.appendChild(tarjeta);
  });
}

function crearTablaCuentas(cuentas) {
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Ticket</th><th>Material</th><th>Kg</th><th>Precio Efectivo</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Estado</th><th>Origen</th><th>Fecha</th><th>Abonos</th><th>Ajuste Precio</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  cuentas
    .slice()
    .sort((a, b) => (a.fechaTicket < b.fechaTicket ? 1 : -1))
    .forEach((c) => {
      const fila = document.createElement('tr');
      const origenTexto = c.aprobacion
        ? (c.aprobacion.tipo === 'foto' ? 'Foto auditada'
          : c.aprobacion.tipo === 'sin_foto_anterior_corte' ? 'Sin foto (anterior al corte)'
          : `Manual — ${c.aprobacion.motivo || ''}`)
        : '—';
      const valores = [
        c.ticket, c.material, window.formatearKg(c.kg, c.material),
        window.formatearMoneda(c.precioEfectivo), window.formatearMoneda(c.total),
        window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
        c.estado, origenTexto, window.formatearFecha(c.fechaTicket)
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

      const celdaAjuste = document.createElement('td');
      const btnAjuste = document.createElement('button');
      btnAjuste.className = 'btn-secondary';
      btnAjuste.textContent = 'Ajustar precio';
      if (c.pagado > 0) {
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
          }
        });
      }
      celdaAjuste.appendChild(btnAjuste);
      fila.appendChild(celdaAjuste);

      tbody.appendChild(fila);

      if (cxpAbonoExpandido === c.id && abonos.length > 0) {
        const filaDetalle = document.createElement('tr');
        const celdaDetalle = document.createElement('td');
        celdaDetalle.colSpan = 12;
        const subtabla = document.createElement('table');
        subtabla.className = 'tabla-destaraje';
        subtabla.style.margin = '0.5rem 0';
        subtabla.innerHTML = `
          <thead>
            <tr><th>Fecha</th><th>Monto</th><th>Referencia</th><th>Registrado por</th><th></th></tr>
          </thead>
          <tbody></tbody>
        `;
        const subtbody = subtabla.querySelector('tbody');
        abonos.forEach((abono, indice) => {
          const filaAbono = document.createElement('tr');
          [window.formatearFecha(abono.fecha), window.formatearMoneda(abono.monto), abono.referencia, abono.registradoPor].forEach((valor) => {
            const celda = document.createElement('td');
            celda.textContent = valor;
            filaAbono.appendChild(celda);
          });
          const celdaAccion = document.createElement('td');
          const btnRevertir = document.createElement('button');
          btnRevertir.className = 'btn-secondary';
          btnRevertir.textContent = 'Revertir';
          btnRevertir.addEventListener('click', async () => {
            const motivo = window.prompt('Motivo de la reversión (obligatorio):');
            if (motivo === null || !motivo.trim()) return;
            try {
              await window.EVE_CXP.revertirAbono(c.id, indice, motivo.trim(), usuarioActual());
              window.showSuccess('Abono revertido');
              renderizarVistaActiva();
            } catch (error) {
              window.showError(error.message);
            }
          });
          celdaAccion.appendChild(btnRevertir);
          filaAbono.appendChild(celdaAccion);
          subtbody.appendChild(filaAbono);
        });
        celdaDetalle.appendChild(subtabla);
        filaDetalle.appendChild(celdaDetalle);
        tbody.appendChild(filaDetalle);
      }
    });
  tablaWrapper.appendChild(tabla);
  return tablaWrapper;
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
        <button type="submit" class="btn-primary">Guardar</button>
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

async function manejarEnvioPago(evento) {
  evento.preventDefault();
  if (!modalContexto) return;
  const ticket = document.getElementById('cxp-modal-ticket').value.trim();
  const monto = Number(document.getElementById('cxp-modal-monto').value);
  const fecha = document.getElementById('cxp-modal-fecha').value;
  const referencia = document.getElementById('cxp-modal-referencia').value;
  const usuario = usuarioActual();

  if (!Number.isFinite(monto) || monto <= 0) {
    window.showError('El monto debe ser mayor a 0');
    return;
  }

  try {
    if (ticket) {
      const cxp = window.EVE.cuentasPorPagar.find((c) => c.proveedor === modalContexto.proveedor && String(c.ticket) === ticket);
      if (!cxp) {
        window.showError('No se encontró una cuenta por pagar para ese ticket');
        return;
      }
      await window.EVE_CXP.actualizarAbonoCxP(cxp.id, {
        monto, fecha, referencia, registradoPor: usuario, fechaRegistro: new Date().toISOString()
      });
    } else {
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
  }
}

function renderizarVistaActiva() {
  llenarBarraAlerta();
  const wrapperProveedores = document.getElementById('cxp-proveedores-wrapper');
  const wrapperTodos = document.getElementById('cxp-todos-wrapper');
  if (wrapperProveedores) wrapperProveedores.style.display = vistaActiva === 'proveedores' ? '' : 'none';
  if (wrapperTodos) wrapperTodos.style.display = vistaActiva === 'todos' ? '' : 'none';
  if (vistaActiva === 'proveedores') {
    llenarVistaProveedores();
  } else {
    llenarVistaTodos();
  }
}

function renderCxP(container) {
  vistaActiva = 'proveedores';
  proveedorExpandido = null;
  cxpAbonoExpandido = null;
  tabTodos = 'semana';
  filtrosTodos = { desde: '', hasta: '', proveedor: '', material: '', estado: '' };

  container.appendChild(crearBarraAlerta());
  container.appendChild(crearTabsPrincipales());
  container.appendChild(crearVistaProveedores());
  container.appendChild(crearVistaTodos());
  container.appendChild(crearModalPago());

  renderizarVistaActiva();
}

window.EVE_MODULES.cxp = { render: renderCxP };

})();
