(function () {

function calcularStats(registros) {
  let totalKg = 0;
  for (const registro of registros) {
    totalKg += Number(registro.kg) || 0;
  }
  return { totalRegistros: registros.length, totalKg };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fecha === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fecha >= inicioSemana);
}

function filtrarPorMes(registros, inicioMes) {
  return registros.filter((r) => r.fecha >= inicioMes);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const ticket = (filtros.ticket || '').toLowerCase();
  const proveedor = (filtros.proveedor || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (ticket && !String(r.ticket).toLowerCase().includes(ticket)) return false;
    if (proveedor && !String(r.proveedor).toLowerCase().includes(proveedor)) return false;
    if (material && !String(r.material).toLowerCase().includes(material)) return false;
    if (!dentroDeRangoFecha(r.fecha, filtros.desde, filtros.hasta)) return false;
    return true;
  });
}

function obtenerTicketsPendientes(proveedor) {
  if (!proveedor) return [];
  return (window.EVE.cuentasPorPagar || []).filter((c) => c.proveedor === proveedor && Number(c.saldo) > 0);
}

function requiereNotaPorTicketSinCxp(ticket, pendientes) {
  if (!ticket) return false;
  return !pendientes.some((c) => String(c.ticket) === String(ticket));
}

function valoresUnicos(arraysDeRegistros, campo, semillas) {
  const set = new Set(semillas || []);
  for (const registros of arraysDeRegistros) {
    for (const registro of registros) {
      const valor = registro[campo];
      if (valor) set.add(String(valor).toUpperCase());
    }
  }
  return Array.from(set).sort();
}

function construirRegistroDesdeFormulario(datos) {
  if (!datos.ticket || !datos.proveedor || !datos.material || !datos.fecha) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  const precioPorKg = Number(datos.precioPorKg);
  if (!Number.isFinite(precioPorKg) || precioPorKg <= 0) {
    throw new Error('Precio/Kg debe ser un número mayor a 0');
  }
  const pagado = Number(datos.pagado);
  if (!Number.isFinite(pagado) || pagado < 0) {
    throw new Error('Pagado debe ser un número mayor o igual a 0');
  }
  return {
    ticket: datos.ticket,
    proveedor: window.normalizarProveedor(datos.proveedor),
    material: window.normalizarMaterial(datos.material),
    kg,
    precioPorKg,
    total: kg * precioPorKg,
    pagado,
    fecha: datos.fecha
  };
}

function construirMinistracionDesdeFormulario(datos) {
  if (!datos.fecha) {
    throw new Error('La fecha es obligatoria');
  }
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('Monto debe ser un número mayor a 0');
  }
  return {
    monto,
    fecha: datos.fecha,
    semana: window.obtenerSemanaISO(datos.fecha)
  };
}

function calcularControlFlujo(pagosSemana, ministracionesSemana) {
  const pagosVigentes = pagosSemana.filter((p) => !p.revertido);
  let totalMinistrado = 0;
  for (const m of ministracionesSemana) {
    totalMinistrado += Number(m.monto) || 0;
  }
  let totalPagado = 0;
  for (const p of pagosVigentes) {
    totalPagado += Number(p.pagado) || 0;
  }
  const saldoDisponible = totalMinistrado - totalPagado;
  const porcentajeEjecutado = totalMinistrado > 0 ? (totalPagado / totalMinistrado) * 100 : 0;
  return { totalMinistrado, totalPagado, saldoDisponible, porcentajeEjecutado };
}

window.EVE_PAGOS = {
  calcularStats,
  filtrarPorHoy,
  filtrarPorSemana,
  filtrarPorMes,
  aplicarFiltrosTodos,
  valoresUnicos,
  obtenerTicketsPendientes,
  requiereNotaPorTicketSinCxp,
  construirRegistroDesdeFormulario,
  construirMinistracionDesdeFormulario,
  calcularControlFlujo
};

let editandoId = null;

function llenarDatalist(id, valores) {
  const datalist = document.getElementById(id);
  datalist.innerHTML = '';
  valores.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    datalist.appendChild(opcion);
  });
}

function actualizarDatalists() {
  const proveedores = valoresUnicos([window.EVE.registrosPagos, window.EVE.registrosDestaraje], 'proveedor', window.PROVEEDORES_COMUNES);
  const materiales = valoresUnicos([window.EVE.registrosPagos], 'material', window.MATERIALES_COMUNES);
  llenarDatalist('dl-pagos-proveedores', proveedores);
  llenarDatalist('dl-pagos-materiales', materiales);
}

function actualizarRequeridoNota() {
  const proveedor = document.getElementById('pg-proveedor').value.trim().toUpperCase();
  const ticket = document.getElementById('pg-ticket').value.trim();
  const pendientes = obtenerTicketsPendientes(proveedor);
  document.getElementById('pg-nota').required = requiereNotaPorTicketSinCxp(ticket, pendientes);
}

let ticketsSeleccionadosCxP = new Set();

function actualizarMontoCxPSeleccionado() {
  const proveedor = document.getElementById('pg-proveedor').value.trim().toUpperCase();
  const pendientes = obtenerTicketsPendientes(proveedor);
  const suma = pendientes
    .filter((c) => ticketsSeleccionadosCxP.has(c.id))
    .reduce((acc, c) => acc + Number(c.saldo), 0);
  document.getElementById('pg-cxp-monto').value = suma > 0 ? suma.toFixed(2) : '';
}

function renderizarPanelPagoCxP() {
  ticketsSeleccionadosCxP = new Set();
  const proveedor = document.getElementById('pg-proveedor').value.trim().toUpperCase();
  const pendientes = obtenerTicketsPendientes(proveedor);
  const tbody = document.getElementById('pg-cxp-tickets');
  const tabla = document.getElementById('pg-cxp-tabla');
  const vacio = document.getElementById('pg-cxp-vacio');
  tbody.innerHTML = '';
  document.getElementById('pg-cxp-monto').value = '';
  if (!proveedor || pendientes.length === 0) {
    tabla.style.display = 'none';
    vacio.style.display = '';
    vacio.textContent = proveedor
      ? 'Sin cuentas pendientes para este proveedor'
      : 'Escribe un proveedor con cuentas pendientes para ver sus tickets';
    return;
  }
  vacio.style.display = 'none';
  tabla.style.display = '';
  pendientes.forEach((cuenta) => {
    const fila = document.createElement('tr');
    const celdaCheck = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        ticketsSeleccionadosCxP.add(cuenta.id);
      } else {
        ticketsSeleccionadosCxP.delete(cuenta.id);
      }
      actualizarMontoCxPSeleccionado();
    });
    celdaCheck.appendChild(checkbox);
    fila.appendChild(celdaCheck);
    [cuenta.ticket, cuenta.material, window.formatearFecha(cuenta.fechaTicket), window.formatearMoneda(cuenta.saldo)].forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
}

let pagoCxPEnCurso = false;

async function manejarConfirmarPagoCxP() {
  if (pagoCxPEnCurso) return;
  const proveedor = document.getElementById('pg-proveedor').value.trim().toUpperCase();
  const cuentasMarcadas = window.EVE.cuentasPorPagar.filter((c) => ticketsSeleccionadosCxP.has(c.id));
  if (cuentasMarcadas.length === 0) {
    window.showError('Selecciona al menos un ticket pendiente para pagar');
    return;
  }
  const monto = Number(document.getElementById('pg-cxp-monto').value);
  if (!Number.isFinite(monto) || monto <= 0) {
    window.showError('El monto a pagar debe ser mayor a 0');
    return;
  }
  const fecha = document.getElementById('pg-cxp-fecha').value;
  if (!fecha) {
    window.showError('La fecha es obligatoria');
    return;
  }
  const referencia = document.getElementById('pg-cxp-referencia').value;
  const registradoPor = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  const botonConfirmar = document.getElementById('pg-cxp-confirmar');
  pagoCxPEnCurso = true;
  botonConfirmar.disabled = true;
  try {
    const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
    const { actualizaciones, sobrante } = window.EVE_CXP.distribuirPago(cuentasMarcadas, monto, fecha, referencia, registradoPor);
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
        fecha,
        origen: 'panel_cxp',
        grupoPagoId
      };
      const idPago = await window.guardarDato('pagos', registroPago);
      insertarRegistroEnMemoria({ id: idPago, ...registroPago, fechaRegistro: new Date().toISOString() });
      Object.assign(cxp, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
    }
    if (sobrante > 0) {
      await window.EVE_CXP.guardarSaldoAFavor(proveedor, {
        monto: sobrante,
        fecha,
        motivo: 'Sobrante de pago aplicado como saldo a favor',
        grupoPagoId
      });
    }
    const liquidados = actualizaciones
      .filter((a) => a.estado === 'liquidado')
      .map((a) => cuentasMarcadas.find((c) => c.id === a.id).ticket);
    const parciales = actualizaciones
      .filter((a) => a.estado === 'parcial')
      .map((a) => cuentasMarcadas.find((c) => c.id === a.id).ticket);
    let mensaje = 'Pago confirmado.';
    if (liquidados.length) mensaje += ` Liquidados: ${liquidados.join(', ')}.`;
    if (parciales.length) mensaje += ` Parciales: ${parciales.join(', ')}.`;
    if (sobrante > 0) mensaje += ` Sobrante aplicado a saldo a favor: ${window.formatearMoneda(sobrante)}.`;
    window.showSuccess(mensaje);
    document.getElementById('pg-cxp-fecha').value = window.obtenerFechaMexico();
    renderizarPanelPagoCxP();
  } catch (error) {
    window.showError(error.message);
  } finally {
    pagoCxPEnCurso = false;
    botonConfirmar.disabled = false;
  }
}

let recibosPendientesCache = [];
let reciboPendienteSeleccionado = null;
let contextoFirmaPendiente = null;
let padFirmaPendienteActual = null;
let reciboPendienteEnCurso = false;
let firmaPendienteEnCurso = false;

async function cargarRecibosPendientes() {
  try {
    const snapshot = await window.db.collection('recibos_pendientes').where('estado', '==', 'pendiente_pago').get();
    recibosPendientesCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    recibosPendientesCache = [];
  }
  renderizarListaRecibosPendientes();
}

function renderizarListaRecibosPendientes() {
  const tbody = document.getElementById('rp-lista');
  const tabla = document.getElementById('rp-tabla');
  const vacio = document.getElementById('rp-vacio');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (recibosPendientesCache.length === 0) {
    tabla.style.display = 'none';
    vacio.style.display = '';
    return;
  }
  vacio.style.display = 'none';
  tabla.style.display = '';
  recibosPendientesCache.forEach((recibo) => {
    const fila = document.createElement('tr');
    [recibo.proveedor, window.formatearMoneda(recibo.montoTotal), window.formatearFecha((recibo.fechaGeneracion || '').slice(0, 10))].forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    const celdaAccion = document.createElement('td');
    const boton = document.createElement('button');
    boton.className = 'btn-primary';
    boton.textContent = 'Ejecutar Pago';
    boton.addEventListener('click', () => abrirModalReciboPendiente(recibo));
    celdaAccion.appendChild(boton);
    fila.appendChild(celdaAccion);
    tbody.appendChild(fila);
  });
}

function crearPanelRecibosPendientes() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'rp-panel';
  div.innerHTML = `
    <h4>Recibos Pendientes</h4>
    <table class="tabla-destaraje" id="rp-tabla" style="display:none">
      <thead><tr><th>Proveedor</th><th>Monto</th><th>Fecha generación</th><th></th></tr></thead>
      <tbody id="rp-lista"></tbody>
    </table>
    <p id="rp-vacio">Sin recibos pendientes de pago</p>
  `;
  return div;
}

function abrirModalReciboPendiente(recibo) {
  reciboPendienteSeleccionado = recibo;
  document.getElementById('rp-modal-proveedor').textContent = recibo.proveedor;
  const tbody = document.getElementById('rp-modal-tickets');
  tbody.innerHTML = '';
  recibo.tickets.forEach((t) => {
    const fila = document.createElement('tr');
    [t.ticket, t.material, window.formatearKg(t.kg, t.material), window.formatearMoneda(t.monto)].forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
  document.getElementById('rp-monto').value = recibo.montoTotal;
  document.getElementById('rp-fecha').value = window.obtenerFechaMexico();
  document.getElementById('rp-referencia').value = 'Efectivo';
  document.getElementById('rp-modal-overlay').classList.add('open');
}

function cerrarModalReciboPendiente() {
  document.getElementById('rp-modal-overlay').classList.remove('open');
  reciboPendienteSeleccionado = null;
}

function crearModalReciboPendiente() {
  const overlay = document.createElement('div');
  overlay.id = 'rp-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Ejecutar pago — Recibo pendiente</h3>
      <p id="rp-modal-proveedor"></p>
      <table class="tabla-destaraje">
        <thead><tr><th>Ticket</th><th>Material</th><th>Kg</th><th>Monto</th></tr></thead>
        <tbody id="rp-modal-tickets"></tbody>
      </table>
      <div class="form-grid" style="margin-top:0.75rem">
        <input type="number" id="rp-monto" placeholder="Monto a pagar" step="0.01" min="0.01">
        <input type="date" id="rp-fecha">
        <select id="rp-referencia">
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Cheque">Cheque</option>
        </select>
      </div>
      <button type="button" id="rp-confirmar" class="btn-primary">Confirmar pago y firmar</button>
      <button type="button" id="rp-cancelar" class="btn-secondary">Cancelar</button>
    </div>
  `;
  overlay.querySelector('#rp-confirmar').addEventListener('click', manejarConfirmarReciboPendiente);
  overlay.querySelector('#rp-cancelar').addEventListener('click', () => cerrarModalReciboPendiente());
  return overlay;
}

async function revalidarYObtenerCuentasFrescas(recibo) {
  const cuentasFrescas = [];
  for (const t of recibo.tickets) {
    const cxp = window.EVE.cuentasPorPagar.find((c) => c.proveedor === recibo.proveedor && String(c.ticket) === String(t.ticket));
    if (!cxp) {
      throw new Error(`El ticket ${t.ticket} ya no existe en Cuentas por Pagar. No se ejecutó el pago.`);
    }
    const docFresco = await window.db.collection('cuentas_por_pagar').doc(cxp.id).get();
    if (!docFresco.exists) {
      throw new Error(`El ticket ${t.ticket} ya no existe en Cuentas por Pagar. No se ejecutó el pago.`);
    }
    const datosFrescos = docFresco.data();
    if (Number(datosFrescos.saldo) !== Number(t.saldo)) {
      throw new Error(`El ticket ${t.ticket} cambió de saldo desde que se generó el recibo (esperado ${window.formatearMoneda(t.saldo)}, actual ${window.formatearMoneda(datosFrescos.saldo)}). No se ejecutó el pago — genera un recibo nuevo desde CxP.`);
    }
    Object.assign(cxp, datosFrescos);
    cuentasFrescas.push(cxp);
  }
  return cuentasFrescas;
}

async function manejarConfirmarReciboPendiente() {
  if (!reciboPendienteSeleccionado || reciboPendienteEnCurso) return;
  const monto = Number(document.getElementById('rp-monto').value);
  if (!Number.isFinite(monto) || monto <= 0) {
    window.showError('El monto a pagar debe ser mayor a 0');
    return;
  }
  const fecha = document.getElementById('rp-fecha').value;
  if (!fecha) {
    window.showError('La fecha es obligatoria');
    return;
  }
  const referencia = document.getElementById('rp-referencia').value;
  const registradoPor = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  const boton = document.getElementById('rp-confirmar');
  reciboPendienteEnCurso = true;
  boton.disabled = true;
  try {
    const recibo = reciboPendienteSeleccionado;
    const cuentasFrescas = await revalidarYObtenerCuentasFrescas(recibo);
    const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
    const { actualizaciones, sobrante } = window.EVE_CXP.distribuirPago(cuentasFrescas, monto, fecha, referencia, registradoPor);
    const ticketsPDF = [];
    for (const act of actualizaciones) {
      const cxp = cuentasFrescas.find((c) => c.id === act.id);
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
        fecha,
        origen: 'recibo_pendiente',
        grupoPagoId
      };
      const idPago = await window.guardarDato('pagos', registroPago);
      insertarRegistroEnMemoria({ id: idPago, ...registroPago, fechaRegistro: new Date().toISOString() });
      Object.assign(cxp, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
      ticketsPDF.push({ ticket: cxp.ticket, material: cxp.material, kg: cxp.kg, precio: cxp.precioEfectivo, monto: act.abono.monto, saldo: act.saldo });
    }
    if (sobrante > 0) {
      await window.EVE_CXP.guardarSaldoAFavor(recibo.proveedor, {
        monto: sobrante,
        fecha,
        motivo: 'Sobrante de pago aplicado como saldo a favor',
        grupoPagoId
      });
    }
    contextoFirmaPendiente = {
      reciboPendienteId: recibo.id,
      proveedor: recibo.proveedor,
      tickets: ticketsPDF,
      totalPago: monto - sobrante,
      fecha,
      grupoPagoId,
      registradoPor
    };
    const indiceCache = recibosPendientesCache.findIndex((r) => r.id === recibo.id);
    if (indiceCache !== -1) recibosPendientesCache.splice(indiceCache, 1);
    renderizarListaRecibosPendientes();
    cerrarModalReciboPendiente();
    abrirModalFirmaPendiente();
  } catch (error) {
    window.showError(error.message);
  } finally {
    reciboPendienteEnCurso = false;
    boton.disabled = false;
  }
}

function crearModalFirmaPendiente() {
  const overlay = document.createElement('div');
  overlay.id = 'rp-firma-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Firma del recibo</h3>
      <p>El pago ya fue ejecutado. Captura la firma para generar el recibo final.</p>
      <div id="rp-firma-pad-contenedor"></div>
      <button type="button" id="rp-firma-guardar" class="btn-primary">Guardar firma y generar recibo</button>
    </div>
  `;
  overlay.querySelector('#rp-firma-guardar').addEventListener('click', manejarGuardarFirmaPendiente);
  return overlay;
}

function abrirModalFirmaPendiente() {
  const contenedor = document.getElementById('rp-firma-pad-contenedor');
  contenedor.innerHTML = '';
  padFirmaPendienteActual = window.EVE_CXP.crearPadFirma();
  contenedor.appendChild(padFirmaPendienteActual.elemento);
  document.getElementById('rp-firma-modal-overlay').classList.add('open');
}

function cerrarModalFirmaPendiente() {
  document.getElementById('rp-firma-modal-overlay').classList.remove('open');
  padFirmaPendienteActual = null;
}

async function manejarGuardarFirmaPendiente() {
  if (!contextoFirmaPendiente || !padFirmaPendienteActual || firmaPendienteEnCurso) return;
  if (padFirmaPendienteActual.estaVacio()) {
    window.showError('La firma es obligatoria');
    return;
  }
  const boton = document.getElementById('rp-firma-guardar');
  firmaPendienteEnCurso = true;
  boton.disabled = true;
  try {
    const recibo = {
      proveedor: contextoFirmaPendiente.proveedor,
      grupoPagoId: contextoFirmaPendiente.grupoPagoId,
      tickets: contextoFirmaPendiente.tickets,
      totalPago: contextoFirmaPendiente.totalPago,
      fecha: contextoFirmaPendiente.fecha,
      firmaBase64: padFirmaPendienteActual.obtenerBase64(),
      registradoPor: contextoFirmaPendiente.registradoPor,
      timestamp: new Date().toISOString()
    };
    await window.guardarDato('recibos_pago', recibo);
    await window.actualizarDato('recibos_pendientes', contextoFirmaPendiente.reciboPendienteId, { estado: 'completado' });
    window.EVE_CXP.generarPDFRecibo(recibo);
    contextoFirmaPendiente = null;
    cerrarModalFirmaPendiente();
    window.showSuccess('Recibo generado y guardado');
  } catch (error) {
    window.showError(error.message);
  } finally {
    firmaPendienteEnCurso = false;
    boton.disabled = false;
  }
}

function insertarRegistroEnMemoria(registro) {
  window.EVE.registrosPagos.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos, camposAEliminar) {
  const lista = window.EVE.registrosPagos;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    const actualizado = { ...lista[indice], ...datos };
    if (camposAEliminar) {
      camposAEliminar.forEach((campo) => delete actualizado[campo]);
    }
    lista[indice] = actualizado;
  }
}

function eliminarRegistroEnMemoria(id) {
  const lista = window.EVE.registrosPagos;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista.splice(indice, 1);
  }
}

function actualizarTotalFormulario() {
  const kg = Number(document.getElementById('pg-kg').value) || 0;
  const precio = Number(document.getElementById('pg-precio').value) || 0;
  document.getElementById('pg-total').value = window.formatearMoneda(kg * precio);
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    ticket: document.getElementById('pg-ticket').value.trim(),
    proveedor: document.getElementById('pg-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('pg-material').value.trim().toUpperCase(),
    kg: document.getElementById('pg-kg').value,
    precioPorKg: document.getElementById('pg-precio').value,
    pagado: document.getElementById('pg-pagado').value,
    fecha: document.getElementById('pg-fecha').value
  };
  const nota = document.getElementById('pg-nota').value.trim();
  const pendientes = obtenerTicketsPendientes(datos.proveedor);
  if (requiereNotaPorTicketSinCxp(datos.ticket, pendientes) && !nota) {
    window.showError('Este ticket no está en Cuentas por Pagar — agrega una nota explicando el motivo');
    return;
  }
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    if (nota) registro.nota = nota;
    const id = await window.guardarDato('pagos', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });

    if (window.EVE_CXP) {
      const cxp = window.EVE.cuentasPorPagar.find((c) => String(c.ticket) === String(registro.ticket));
      if (cxp) {
        const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
        window.EVE_CXP.actualizarAbonoCxP(cxp.id, {
          monto: registro.pagado,
          fecha: registro.fecha,
          referencia: 'Registrado desde Pagos',
          registradoPor: usuario,
          fechaRegistro: new Date().toISOString()
        }).catch((error) => console.error('No se pudo actualizar la CxP vinculada', error));
      }
    }

    document.getElementById('pagos-form').reset();
    document.getElementById('pg-fecha').value = window.obtenerFechaMexico();
    document.getElementById('pg-total').value = '';
    document.getElementById('pg-nota').value = '';
    actualizarDatalists();
    actualizarRequeridoNota();
    renderizarPanelPagoCxP();
    renderizarVista();
    window.showSuccess('Pago guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parsePagos(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  document.getElementById('pg-ticket').value = datos.ticket;
  document.getElementById('pg-proveedor').value = datos.proveedor;
  document.getElementById('pg-material').value = datos.material;
  document.getElementById('pg-kg').value = datos.kg;
  document.getElementById('pg-precio').value = datos.precioPorKg;
  document.getElementById('pg-pagado').value = datos.pagado;
  actualizarTotalFormulario();
  actualizarRequeridoNota();
  renderizarPanelPagoCxP();
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'pagos-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-grid">
      <input type="text" id="pg-ticket" placeholder="Ticket" required>
      <input type="text" id="pg-proveedor" placeholder="Proveedor" list="dl-pagos-proveedores" required>
      <input type="text" id="pg-material" placeholder="Material" list="dl-pagos-materiales" required>
      <input type="number" id="pg-kg" placeholder="Kg" step="0.01" required>
      <input type="number" id="pg-precio" placeholder="Precio/Kg" step="0.01" required>
      <input type="number" id="pg-pagado" placeholder="Pagado" step="0.01" required>
      <input type="date" id="pg-fecha" required>
      <input type="text" id="pg-total" placeholder="Total" disabled>
      <input type="text" id="pg-nota" placeholder="Nota (requerida si el ticket no está en CxP)">
    </div>
    <datalist id="dl-pagos-proveedores"></datalist>
    <datalist id="dl-pagos-materiales"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelector('#pg-fecha').value = window.obtenerFechaMexico();
  form.querySelector('#pg-kg').addEventListener('input', actualizarTotalFormulario);
  form.querySelector('#pg-precio').addEventListener('input', actualizarTotalFormulario);
  form.querySelector('#pg-proveedor').addEventListener('input', () => {
    actualizarRequeridoNota();
    renderizarPanelPagoCxP();
  });
  form.querySelector('#pg-ticket').addEventListener('input', actualizarRequeridoNota);
  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));
  return form;
}

function crearPanelPagoCxP() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'pg-cxp-panel';
  div.innerHTML = `
    <h4>Pagar cuentas pendientes (CxP)</h4>
    <p id="pg-cxp-vacio">Escribe un proveedor con cuentas pendientes para ver sus tickets</p>
    <table class="tabla-destaraje" id="pg-cxp-tabla" style="display:none">
      <thead>
        <tr><th></th><th>Ticket</th><th>Material</th><th>Fecha</th><th>Saldo</th></tr>
      </thead>
      <tbody id="pg-cxp-tickets"></tbody>
    </table>
    <div class="form-grid" style="margin-top:0.75rem">
      <input type="number" id="pg-cxp-monto" placeholder="Monto a pagar" step="0.01" min="0.01">
      <input type="date" id="pg-cxp-fecha">
      <select id="pg-cxp-referencia">
        <option value="Efectivo">Efectivo</option>
        <option value="Transferencia">Transferencia</option>
        <option value="Cheque">Cheque</option>
      </select>
      <button type="button" id="pg-cxp-confirmar" class="btn-primary">Confirmar pago</button>
    </div>
  `;
  div.querySelector('#pg-cxp-fecha').value = window.obtenerFechaMexico();
  div.querySelector('#pg-cxp-confirmar').addEventListener('click', manejarConfirmarPagoCxP);
  return div;
}

function actualizarTotalEdicion() {
  const kg = Number(document.getElementById('pge-kg').value) || 0;
  const precio = Number(document.getElementById('pge-precio').value) || 0;
  document.getElementById('pge-total').value = window.formatearMoneda(kg * precio);
}

function actualizarRequeridoNotaEdicion() {
  const proveedor = document.getElementById('pge-proveedor').value.trim().toUpperCase();
  const ticket = document.getElementById('pge-ticket').value.trim();
  const pendientes = obtenerTicketsPendientes(proveedor);
  document.getElementById('pge-nota').required = requiereNotaPorTicketSinCxp(ticket, pendientes);
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    ticket: document.getElementById('pge-ticket').value.trim(),
    proveedor: document.getElementById('pge-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('pge-material').value.trim().toUpperCase(),
    kg: document.getElementById('pge-kg').value,
    precioPorKg: document.getElementById('pge-precio').value,
    pagado: document.getElementById('pge-pagado').value,
    fecha: document.getElementById('pge-fecha').value
  };
  const anterior = window.EVE.registrosPagos.find((r) => r.id === editandoId);
  const motivo = document.getElementById('pge-motivo').value.trim();
  const nota = document.getElementById('pge-nota').value.trim();
  const pendientes = obtenerTicketsPendientes(datos.proveedor);
  if (requiereNotaPorTicketSinCxp(datos.ticket, pendientes) && !nota) {
    window.showError('Este ticket no está en Cuentas por Pagar — agrega una nota explicando el motivo');
    return;
  }
  if (anterior && pagoTieneVinculoActivo(anterior.grupoPagoId)) {
    if (Number(datos.pagado) !== Number(anterior.pagado)) {
      window.showError('Este pago está vinculado a una cuenta por pagar o a un saldo a favor activo. Para corregir el monto, revierte el abono desde CxP y vuelve a registrar el pago con el monto correcto — no lo edites directamente aquí.');
      return;
    }
    if (datos.ticket !== anterior.ticket) {
      window.showError('Este pago está vinculado a una cuenta específica por CxP. Cambiar el ticket rompería la trazabilidad entre el pago y esa cuenta — revierte el abono desde CxP y vuelve a capturar el pago con el ticket correcto.');
      return;
    }
  }
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    if (nota) registro.nota = nota;
    const registroParaGuardar = { ...registro };
    if (!nota) {
      registroParaGuardar.nota = firebase.firestore.FieldValue.delete();
    }
    await window.actualizarDato('pagos', editandoId, registroParaGuardar);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'pagos',
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior ? { ticket: anterior.ticket, proveedor: anterior.proveedor, material: anterior.material, kg: anterior.kg, precioPorKg: anterior.precioPorKg, total: anterior.total, pagado: anterior.pagado, fecha: anterior.fecha } : null,
      valorNuevo: registro,
      motivo
    });
    document.getElementById('pge-motivo').value = '';
    reemplazarRegistroEnMemoria(editandoId, registro, nota ? null : ['nota']);
    cerrarModalEdicion();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Pago actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'pagos-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar pago</h3>
      <form id="pagos-edit-form">
        <input type="text" id="pge-ticket" placeholder="Ticket" required>
        <input type="text" id="pge-proveedor" placeholder="Proveedor" list="dl-pagos-proveedores" required>
        <input type="text" id="pge-material" placeholder="Material" list="dl-pagos-materiales" required>
        <input type="number" id="pge-kg" placeholder="Kg" step="0.01" required>
        <input type="number" id="pge-precio" placeholder="Precio/Kg" step="0.01" required>
        <input type="number" id="pge-pagado" placeholder="Pagado" step="0.01" required>
        <input type="date" id="pge-fecha" required>
        <input type="text" id="pge-total" placeholder="Total" disabled>
        <input type="text" id="pge-nota" placeholder="Nota (requerida si el ticket no está en CxP)">
        <textarea id="pge-motivo" placeholder="Motivo del cambio (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="pge-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#pge-kg').addEventListener('input', actualizarTotalEdicion);
  overlay.querySelector('#pge-precio').addEventListener('input', actualizarTotalEdicion);
  overlay.querySelector('#pge-proveedor').addEventListener('input', actualizarRequeridoNotaEdicion);
  overlay.querySelector('#pge-ticket').addEventListener('input', actualizarRequeridoNotaEdicion);
  overlay.querySelector('#pagos-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#pge-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('pge-ticket').value = registro.ticket;
  document.getElementById('pge-proveedor').value = registro.proveedor;
  document.getElementById('pge-material').value = registro.material;
  document.getElementById('pge-kg').value = registro.kg;
  document.getElementById('pge-precio').value = registro.precioPorKg;
  document.getElementById('pge-pagado').value = registro.pagado;
  document.getElementById('pge-fecha').value = registro.fecha;
  document.getElementById('pge-nota').value = registro.nota || '';
  actualizarTotalEdicion();
  actualizarRequeridoNotaEdicion();
  document.getElementById('pagos-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('pagos-modal-overlay').classList.remove('open');
  editandoId = null;
}

function pagoTieneVinculoActivo(grupoPagoId) {
  if (!grupoPagoId) return false;
  const abonoVinculado = window.EVE.cuentasPorPagar.some((c) =>
    (c.abonos || []).some((a) => a.grupoPagoId === grupoPagoId)
  );
  if (abonoVinculado) return true;
  return window.EVE.proveedores.some((p) =>
    (p.saldoAFavor || []).some((m) => m.grupoPagoId === grupoPagoId && !m.revertido)
  );
}

async function confirmarEliminar(id) {
  const registro = window.EVE.registrosPagos.find((r) => r.id === id);
  if (registro && pagoTieneVinculoActivo(registro.grupoPagoId)) {
    window.showError('Este pago está vinculado a una cuenta por pagar o a un saldo a favor activo. Usa "Revertir" desde CxP en vez de "Eliminar" desde Pagos, para no dejar el otro lado huérfano sin trazabilidad.');
    return;
  }
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato('pagos', id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'pagos',
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: registro ? { ticket: registro.ticket, proveedor: registro.proveedor, material: registro.material, kg: registro.kg, precioPorKg: registro.precioPorKg, total: registro.total, pagado: registro.pagado, fecha: registro.fecha } : null,
      valorNuevo: null,
      motivo
    });
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Pago eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

Object.assign(window.EVE_PAGOS, {
  crearFormulario,
  crearModalEdicion,
  abrirModalEdicion,
  actualizarDatalists,
  confirmarEliminar
});

let tabActiva = 'hoy';
let filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
    boton.addEventListener('click', () => {
      tabActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      renderizarVista();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'pagos-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'pgf-ticket', etiqueta: 'Ticket', placeholder: 'Ticket', tipo: 'text' },
    { id: 'pgf-desde', etiqueta: 'Desde', placeholder: '', tipo: 'date' },
    { id: 'pgf-hasta', etiqueta: 'Hasta', placeholder: '', tipo: 'date' },
    { id: 'pgf-proveedor', etiqueta: 'Proveedor', placeholder: 'Proveedor', tipo: 'text' },
    { id: 'pgf-material', etiqueta: 'Material', placeholder: 'Material', tipo: 'text' }
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
    input.placeholder = campo.placeholder;
    input.addEventListener('input', () => {
      filtros = {
        ticket: document.getElementById('pgf-ticket').value,
        desde: document.getElementById('pgf-desde').value,
        hasta: document.getElementById('pgf-hasta').value,
        proveedor: document.getElementById('pgf-proveedor').value,
        material: document.getElementById('pgf-material').value
      };
      renderizarVista();
    });
    contenedor.appendChild(input);
    div.appendChild(contenedor);
  });
  return div;
}

function crearTabla() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Ticket</th><th>Proveedor</th><th>Material</th><th>Kg</th><th>Precio/Kg</th><th>Total</th><th>Pagado</th><th>Fecha</th><th></th></tr>
    </thead>
    <tbody id="pagos-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  return wrapper;
}

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const valores = [
    registro.ticket, registro.proveedor, registro.material,
    window.formatearKg(registro.kg, registro.material),
    window.formatearMoneda(registro.precioPorKg),
    window.formatearMoneda(registro.total),
    window.formatearMoneda(registro.pagado),
    registro.fecha
  ];
  valores.forEach((valor) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    if (registro.revertido) celda.style.textDecoration = 'line-through';
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
  if (registro.revertido) {
    const chip = crearChip('↩️ Revertido', 'chip-error');
    chip.title = registro.revertidoMotivo
      ? `Motivo: ${registro.revertidoMotivo} (${window.formatearFecha(registro.fechaReversion)})`
      : 'Este pago fue revertido y no cuenta en los totales';
    celdaAcciones.appendChild(chip);
  } else if (window.puedeEscribir('pagos')) {
    const botonEditar = document.createElement('button');
    botonEditar.textContent = 'Editar';
    botonEditar.className = 'btn-secondary';
    botonEditar.addEventListener('click', () => abrirModalEdicion(registro));
    const botonEliminar = document.createElement('button');
    botonEliminar.textContent = 'Eliminar';
    botonEliminar.className = 'btn-secondary';
    botonEliminar.addEventListener('click', () => confirmarEliminar(registro.id));
    celdaAcciones.appendChild(botonEditar);
    celdaAcciones.appendChild(botonEliminar);
  }
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(registros) {
  const tbody = document.getElementById('pagos-tabla');
  tbody.innerHTML = '';
  if (registros.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 9;
    celda.textContent = 'Sin registros';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  registros.forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let registros = window.EVE.registrosPagos;
  if (tabActiva === 'hoy') {
    registros = filtrarPorHoy(registros, window.obtenerFechaMexico());
  } else if (tabActiva === 'semana') {
    registros = filtrarPorSemana(registros, window.obtenerInicioSemana());
  } else if (tabActiva === 'mes') {
    registros = filtrarPorMes(registros, window.obtenerInicioMes());
  } else {
    registros = aplicarFiltrosTodos(registros, filtros);
  }
  return registros;
}

function renderizarStats(registros) {
  const registrosVigentes = registros.filter((r) => !r.revertido);
  const stats = calcularStats(registrosVigentes);
  const resumen = window.calcularResumenPagos(registrosVigentes) || { totalPagado: 0, totalDeuda: 0 };
  const contenedor = document.getElementById('pagos-stats');
  contenedor.innerHTML = '';
  const partes = [
    `Registros: ${stats.totalRegistros}`,
    `Total KG: ${stats.totalKg.toLocaleString('es-MX')}`,
    `Total Pagado: ${window.formatearMoneda(resumen.totalPagado)}`,
    `Total Deuda: ${window.formatearMoneda(resumen.totalDeuda)}`
  ];
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function construirItemMinistracion(ministracion) {
  const li = document.createElement('li');
  const texto = document.createElement('span');
  texto.textContent = `${window.formatearFecha(ministracion.fecha)} - ${window.formatearMoneda(ministracion.monto)}`;
  li.appendChild(texto);
  if (window.puedeEscribir('pagos')) {
    const botonEliminar = document.createElement('button');
    botonEliminar.textContent = '🗑️';
    botonEliminar.className = 'btn-secondary';
    botonEliminar.addEventListener('click', () => confirmarEliminarMinistracion(ministracion.id));
    li.appendChild(botonEliminar);
  }
  return li;
}

function llenarListaMinistraciones(ministraciones) {
  const lista = document.getElementById('lista-ministraciones');
  lista.innerHTML = '';
  if (ministraciones.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Sin ministraciones esta semana';
    lista.appendChild(li);
    return;
  }
  ministraciones.forEach((m) => lista.appendChild(construirItemMinistracion(m)));
}

function renderizarControlFlujo() {
  const contenedor = document.getElementById('control-flujo');
  contenedor.style.display = tabActiva === 'semana' ? '' : 'none';
  if (tabActiva !== 'semana') return;
  const inicioSemana = window.obtenerInicioSemana();
  const pagosSemana = filtrarPorSemana(window.EVE.registrosPagos, inicioSemana);
  const ministracionesSemana = filtrarPorSemana(window.EVE.registrosMinistraciones, inicioSemana);
  const flujo = calcularControlFlujo(pagosSemana, ministracionesSemana);
  document.getElementById('cf-ministrado').textContent = `Total Ministrado: ${window.formatearMoneda(flujo.totalMinistrado)}`;
  document.getElementById('cf-pagado').textContent = `Total Pagado: ${window.formatearMoneda(flujo.totalPagado)}`;
  document.getElementById('cf-saldo').textContent = `Saldo Disponible: ${window.formatearMoneda(flujo.saldoDisponible)}`;
  document.getElementById('cf-ejecutado').textContent = `% Ejecutado: ${flujo.porcentajeEjecutado.toFixed(0)}%`;
  llenarListaMinistraciones(ministracionesSemana);
}

function renderizarVista() {
  document.getElementById('pagos-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  renderizarControlFlujo();
  const registros = obtenerRegistrosParaTab();
  renderizarStats(registros);
  llenarTabla(registros);
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const acciones = [
    { texto: 'TXT', fn: () => window.exportarReportePagosTXT(tabActiva, filtros) },
    { texto: 'PDF', fn: () => window.exportarReportePagosPDF(tabActiva, filtros) },
    { texto: 'CSV', fn: () => window.exportarReportePagosCSV(tabActiva, filtros) }
  ];
  acciones.forEach((accion) => {
    const boton = document.createElement('button');
    boton.textContent = accion.texto;
    boton.className = 'btn-secondary';
    boton.addEventListener('click', accion.fn);
    div.appendChild(boton);
  });
  return div;
}

function crearControlFlujo() {
  const div = document.createElement('div');
  div.id = 'control-flujo';
  div.className = 'card control-flujo';
  div.innerHTML = `
    <h4>Control de Flujo Semanal</h4>
    <div class="control-flujo-cifras">
      <span id="cf-ministrado"></span>
      <span id="cf-pagado"></span>
      <span id="cf-saldo"></span>
      <span id="cf-ejecutado"></span>
    </div>
    <h5>Detalle ministraciones:</h5>
    <ul id="lista-ministraciones" class="lista-ministraciones"></ul>
    ${window.puedeEscribir('pagos') ? '<button type="button" id="btn-registrar-ministracion" class="btn-primary">💵 Registrar Ministración</button>' : ''}
  `;
  if (window.puedeEscribir('pagos')) {
    div.querySelector('#btn-registrar-ministracion').addEventListener('click', abrirModalMinistracion);
  }
  return div;
}

function crearModalMinistracion() {
  const overlay = document.createElement('div');
  overlay.id = 'ministracion-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Registrar Ministración</h3>
      <form id="ministracion-form">
        <input type="number" id="mn-monto" placeholder="Monto" step="0.01" required>
        <input type="date" id="mn-fecha" required>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="mn-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#ministracion-form').addEventListener('submit', manejarEnvioMinistracion);
  overlay.querySelector('#mn-cancelar').addEventListener('click', () => cerrarModalMinistracion());
  return overlay;
}

function abrirModalMinistracion() {
  document.getElementById('mn-monto').value = '';
  document.getElementById('mn-fecha').value = window.obtenerFechaMexico();
  document.getElementById('ministracion-modal-overlay').classList.add('open');
}

function cerrarModalMinistracion() {
  document.getElementById('ministracion-modal-overlay').classList.remove('open');
}

async function manejarEnvioMinistracion(evento) {
  evento.preventDefault();
  const datos = {
    monto: document.getElementById('mn-monto').value,
    fecha: document.getElementById('mn-fecha').value
  };
  try {
    const ministracion = construirMinistracionDesdeFormulario(datos);
    const id = await window.guardarDato('ministraciones', ministracion);
    window.EVE.registrosMinistraciones.push({ id, ...ministracion, fechaRegistro: new Date().toISOString() });
    cerrarModalMinistracion();
    renderizarControlFlujo();
    window.showSuccess('Ministración registrada');
  } catch (error) {
    window.showError(error.message);
  }
}

async function confirmarEliminarMinistracion(id) {
  if (!confirm('¿Eliminar esta ministración?')) return;
  try {
    await window.eliminarDato('ministraciones', id);
    const lista = window.EVE.registrosMinistraciones;
    const indice = lista.findIndex((r) => r.id === id);
    if (indice !== -1) lista.splice(indice, 1);
    renderizarControlFlujo();
    window.showSuccess('Ministración eliminada');
  } catch (error) {
    window.showError(error.message);
  }
}

function renderPagos(container) {
  tabActiva = 'hoy';
  filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };
  editandoId = null;
  recibosPendientesCache = [];
  reciboPendienteSeleccionado = null;
  contextoFirmaPendiente = null;
  padFirmaPendienteActual = null;

  if (window.puedeEscribir('pagos')) {
    container.appendChild(crearFormulario());
    container.appendChild(crearPanelPagoCxP());
    container.appendChild(crearPanelRecibosPendientes());
  }
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearControlFlujo());
  const stats = document.createElement('div');
  stats.id = 'pagos-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla());
  container.appendChild(crearModalEdicion());
  container.appendChild(crearModalMinistracion());
  if (window.puedeEscribir('pagos')) {
    container.appendChild(crearModalReciboPendiente());
    container.appendChild(crearModalFirmaPendiente());
  }

  actualizarDatalists();
  if (window.puedeEscribir('pagos')) {
    renderizarPanelPagoCxP();
    cargarRecibosPendientes();
  }
  renderizarVista();
}

Object.assign(window.EVE_PAGOS, {
  confirmarEliminarMinistracion
});

window.EVE_MODULES.pagos = { render: renderPagos };

})();
