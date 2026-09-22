(function () {

// ── Datos ────────────────────────────────────────────────────────────────

function usuarioActual() {
  return (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function yaExisteCxC(cuentasPorCobrar, ventaId) {
  return cuentasPorCobrar.some((c) => c.ventaId === ventaId);
}

function construirDocsCxCDesdeVenta(venta, ventaId, usuario) {
  return (venta.lineas || []).map((l, indice) => ({
    ventaId,
    lineaIndex: indice,
    folio: venta.folio,
    cliente: venta.cliente,
    material: l.material,
    cantidad: Number(l.cantidad) || 0,
    unidad: l.unidad,
    precioUnitario: Number(l.precioUnitario) || 0,
    subtotal: Number(l.subtotal) || 0,
    ivaTrasladado: Number(l.ivaTrasladado) || 0,
    ivaRetenido: Number(l.ivaRetenido) || 0,
    total: Number(l.totalLinea) || 0,
    fechaVenta: venta.fecha,
    fechaEsperadaCobro: venta.fechaEsperadaCobro || venta.fecha,
    pagado: 0,
    saldo: Number(l.totalLinea) || 0,
    estado: 'pendiente',
    abonos: [],
    abonosRevertidos: [],
    creadoPor: usuario
  }));
}

async function generarCxCDesdeVenta(ventaId, venta) {
  if (yaExisteCxC(window.EVE.cuentasPorCobrar, ventaId)) return;
  const docs = construirDocsCxCDesdeVenta(venta, ventaId, usuarioActual());
  for (const doc of docs) {
    const id = await window.guardarDato('cuentas_por_cobrar', doc);
    window.EVE.cuentasPorCobrar.push({ id, ...doc, fechaRegistro: new Date().toISOString() });
  }
}

async function eliminarCxCDeVenta(ventaId) {
  const docs = window.EVE.cuentasPorCobrar.filter((c) => c.ventaId === ventaId);
  for (const doc of docs) {
    await window.eliminarDato('cuentas_por_cobrar', doc.id);
  }
  window.EVE.cuentasPorCobrar = window.EVE.cuentasPorCobrar.filter((c) => c.ventaId !== ventaId);
}

function cxcConCobrosDeVenta(ventaId) {
  return window.EVE.cuentasPorCobrar.some((c) => c.ventaId === ventaId && c.pagado > 0);
}

// Al editar una venta (sin cobros aplicados aún) se regeneran sus líneas de CxC
// desde cero, porque cambiar cantidades/materiales/precios invalida los docs previos.
async function regenerarCxCDesdeVenta(ventaId, venta) {
  if (cxcConCobrosDeVenta(ventaId)) {
    throw new Error('Esta venta ya tiene cobros registrados — revierte los abonos antes de editar sus líneas.');
  }
  await eliminarCxCDeVenta(ventaId);
  await generarCxCDesdeVenta(ventaId, venta);
}

function agregarPorClienteCxC(cuentas) {
  return window.EVE_CXP.agregarPorClave(cuentas, 'cliente');
}

function filtrarCxC(cuentas, filtros) {
  return window.EVE_CXP.filtrarGenerico(cuentas, filtros, { campoFecha: 'fechaVenta', campoEntidad: 'cliente' });
}

function calcularRangoPeriodoCxC(periodo) {
  const hoy = window.obtenerFechaMexico();
  if (periodo === 'hoy') return { desde: hoy, hasta: hoy };
  if (periodo === 'semana') return { desde: window.obtenerInicioSemana(), hasta: null };
  if (periodo === 'mes') return { desde: window.obtenerInicioMes(), hasta: null };
  return { desde: null, hasta: null };
}

async function actualizarAbonoCxC(cxcId, abono) {
  const cxc = window.EVE.cuentasPorCobrar.find((c) => c.id === cxcId);
  if (!cxc) return;
  const cambios = window.EVE_CXP.aplicarAbono(cxc, { ...abono, abonoId: window.EVE_CXP.generarAbonoId() });
  await window.actualizarDato('cuentas_por_cobrar', cxcId, cambios);
  Object.assign(cxc, cambios);
}

async function revertirCobrosSiExiste(grupoPagoId, cxcId, motivo) {
  if (!grupoPagoId) return;
  const coincidencias = window.EVE.cobros.filter((c) =>
    c.grupoPagoId === grupoPagoId && (cxcId === null || c.cxcId === cxcId) && !c.revertido
  );
  for (const registro of coincidencias) {
    const cambios = { revertido: true, revertidoMotivo: motivo, fechaReversion: new Date().toISOString() };
    await window.actualizarDato('cobros', registro.id, cambios);
    Object.assign(registro, cambios);
  }
}

async function revertirAbonoCxC(cxcId, abonoId, motivo, revertidoPor) {
  const cxc = window.EVE.cuentasPorCobrar.find((c) => c.id === cxcId);
  if (!cxc) return;
  const abono = cxc.abonos.find((a) => a.abonoId === abonoId);
  if (!abono) throw new Error('Este abono no tiene un identificador válido y no puede revertirse.');
  const abonos = cxc.abonos.filter((a) => a.abonoId !== abonoId);
  const pagado = abonos.reduce((acc, a) => acc + (Number(a.monto) || 0), 0);
  const saldo = cxc.total - pagado;
  const estado = window.EVE_CXP.calcularEstado(pagado, saldo);
  const abonoRevertido = { ...abono, motivo, revertidoPor, fechaReversion: new Date().toISOString() };
  const abonosRevertidos = [...(cxc.abonosRevertidos || []), abonoRevertido];
  const cambios = { abonos, abonosRevertidos, pagado, saldo, estado };
  await window.actualizarDato('cuentas_por_cobrar', cxcId, cambios);
  Object.assign(cxc, cambios);
  if (abono.grupoPagoId) {
    await revertirCobrosSiExiste(abono.grupoPagoId, cxc.id, motivo);
  }
}

async function registrarCobroGeneral(nombreCliente, monto, fecha, referencia, registradoPor) {
  const cuentasCliente = window.EVE.cuentasPorCobrar.filter((c) => c.cliente === nombreCliente);
  const { actualizaciones, sobrante } = window.EVE_CXP.distribuirPago(cuentasCliente, monto, fecha, referencia, registradoPor, 'fechaVenta');
  const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
  for (const act of actualizaciones) {
    const cxc = window.EVE.cuentasPorCobrar.find((c) => c.id === act.id);
    const abonos = [...cxc.abonos, { ...act.abono, grupoPagoId }];
    await window.actualizarDato('cuentas_por_cobrar', act.id, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
    const registroCobro = {
      cxcId: cxc.id,
      ventaId: cxc.ventaId,
      folio: cxc.folio,
      cliente: cxc.cliente,
      material: cxc.material,
      cantidad: cxc.cantidad,
      unidad: cxc.unidad,
      pagado: act.abono.monto,
      total: cxc.total,
      iva: window.calcularIvaProrrateado(act.abono.monto, cxc.total, cxc.ivaTrasladado),
      fecha,
      referencia,
      origen: 'cxc_cobro_general',
      grupoPagoId
    };
    const idCobro = await window.guardarDato('cobros', registroCobro);
    window.EVE.cobros.push({ id: idCobro, ...registroCobro, fechaRegistro: new Date().toISOString() });
    Object.assign(cxc, { pagado: act.pagado, saldo: act.saldo, estado: act.estado, abonos });
  }
  return { actualizaciones, sobrante };
}

window.EVE_CXC = {
  yaExisteCxC,
  construirDocsCxCDesdeVenta,
  generarCxCDesdeVenta,
  eliminarCxCDeVenta,
  cxcConCobrosDeVenta,
  regenerarCxCDesdeVenta,
  agregarPorClienteCxC,
  filtrarCxC,
  calcularRangoPeriodoCxC,
  actualizarAbonoCxC,
  revertirAbonoCxC,
  registrarCobroGeneral
};

// ── UI ───────────────────────────────────────────────────────────────────

let vistaActiva = 'clientes';
let tabClientePeriodo = 'todos';
let clienteExpandido = null;
let cxcAbonoExpandido = null;
let tabTodos = 'semana';
let filtrosTodos = { desde: '', hasta: '', cliente: '', material: '', estado: '' };
let modalContexto = null;
let envioPagoEnCurso = false;

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

function crearResumenGeneral() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'cxc-resumen-general';
  return div;
}

function calcularTotalPorCobrarGeneral() {
  const grupos = agregarPorClienteCxC(window.EVE.cuentasPorCobrar).filter((g) => g.saldo > 0);
  const total = grupos.reduce((suma, g) => suma + g.saldo, 0);
  return { total, cantidadClientes: grupos.length };
}

function obtenerPeriodoActivoInfo() {
  if (vistaActiva === 'clientes' && (tabClientePeriodo === 'hoy' || tabClientePeriodo === 'semana' || tabClientePeriodo === 'mes')) {
    const nombres = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes' };
    const { desde, hasta } = calcularRangoPeriodoCxC(tabClientePeriodo);
    return { nombre: nombres[tabClientePeriodo], desde, hasta };
  }
  if (vistaActiva === 'todos' && (tabTodos === 'semana' || tabTodos === 'mes')) {
    const nombres = { semana: 'Esta Semana', mes: 'Este Mes' };
    const { desde, hasta } = calcularRangoPeriodoCxC(tabTodos);
    return { nombre: nombres[tabTodos], desde, hasta };
  }
  return null;
}

function llenarResumenGeneral() {
  const div = document.getElementById('cxc-resumen-general');
  if (!div) return;
  div.innerHTML = '';
  const { total, cantidadClientes } = calcularTotalPorCobrarGeneral();
  const fila = document.createElement('div');
  fila.style.cssText = 'display:flex;align-items:center;gap:1.5rem;flex-wrap:wrap';
  const bloqueGeneral = document.createElement('div');
  bloqueGeneral.innerHTML = `<strong>Total por Cobrar General: ${window.formatearMoneda(total)}</strong> (${cantidadClientes} cliente${cantidadClientes === 1 ? '' : 's'} con saldo pendiente)`;
  fila.appendChild(bloqueGeneral);

  const periodoActivo = obtenerPeriodoActivoInfo();
  if (periodoActivo) {
    const cuentasPeriodo = filtrarCxC(window.EVE.cuentasPorCobrar, { desde: periodoActivo.desde, hasta: periodoActivo.hasta });
    const totalPeriodo = agregarPorClienteCxC(cuentasPeriodo).filter((g) => g.saldo > 0).reduce((suma, g) => suma + g.saldo, 0);
    const bloquePeriodo = document.createElement('div');
    bloquePeriodo.innerHTML = `<strong>Total ${periodoActivo.nombre}: ${window.formatearMoneda(totalPeriodo)}</strong>`;
    fila.appendChild(bloquePeriodo);
  }
  div.appendChild(fila);
}

function crearTabsPrincipales() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'clientes', nombre: 'Por Cliente' },
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

function crearTabsPeriodoCliente() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === tabClientePeriodo ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      tabClientePeriodo = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      llenarVistaClientes();
      llenarResumenGeneral();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearVistaClientes() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxc-clientes-wrapper';
  wrapper.appendChild(crearTabsPeriodoCliente());
  const contenido = document.createElement('div');
  contenido.id = 'cxc-clientes-contenido';
  wrapper.appendChild(contenido);
  return wrapper;
}

function llenarVistaClientes() {
  const contenido = document.getElementById('cxc-clientes-contenido');
  if (!contenido) return;
  contenido.innerHTML = '';
  if (tabClientePeriodo === 'todos') {
    llenarVistaClientesCompleta(contenido);
  } else {
    llenarVistaClientesPeriodo(contenido, tabClientePeriodo);
  }
}

function llenarVistaClientesCompleta(contenido) {
  const grupos = agregarPorClienteCxC(window.EVE.cuentasPorCobrar).filter((g) => g.saldo > 0).sort((a, b) => b.saldo - a.saldo);
  if (grupos.length === 0) {
    const tarjeta = document.createElement('div');
    tarjeta.className = 'card';
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin saldo pendiente';
    tarjeta.appendChild(vacio);
    contenido.appendChild(tarjeta);
    return;
  }
  grupos.forEach((grupo) => contenido.appendChild(crearTarjetaClienteCxC(grupo)));
}

function llenarVistaClientesPeriodo(contenido, periodo) {
  const { desde, hasta } = calcularRangoPeriodoCxC(periodo);
  const cuentasPeriodo = filtrarCxC(window.EVE.cuentasPorCobrar, { desde, hasta });
  const grupos = agregarPorClienteCxC(cuentasPeriodo).filter((g) => g.saldo > 0).sort((a, b) => b.saldo - a.saldo);

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
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th data-tipo="texto">Cliente</th><th data-tipo="moneda">Saldo</th></tr>';
  tabla.appendChild(thead);
  const tbody = document.createElement('tbody');

  let total = 0;
  grupos.forEach((grupo) => {
    total += grupo.saldo;
    const fila = document.createElement('tr');
    const celdaCliente = document.createElement('td');
    celdaCliente.textContent = grupo.cliente;
    const celdaSaldo = document.createElement('td');
    celdaSaldo.textContent = window.formatearMoneda(grupo.saldo);
    fila.appendChild(celdaCliente);
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

  grupos.forEach((grupo) => contenido.appendChild(crearTarjetaClienteCxC(grupo)));
}

function crearTarjetaClienteCxC(grupo) {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';

  const encabezado = document.createElement('div');
  encabezado.style.cssText = 'display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem';
  encabezado.innerHTML = `
    <h3 style="margin:0">${grupo.cliente}</h3>
    <div>
      <span>Total: ${window.formatearMoneda(grupo.total)}</span> &nbsp;
      <span>Pagado: ${window.formatearMoneda(grupo.pagado)}</span> &nbsp;
      <span><strong>Saldo: ${window.formatearMoneda(grupo.saldo)}</strong></span>
    </div>
  `;
  tarjeta.appendChild(encabezado);

  const acciones = document.createElement('div');
  acciones.style.cssText = 'margin-top:0.5rem;display:flex;gap:0.5rem';

  const btnDetalle = document.createElement('button');
  btnDetalle.className = 'btn-secondary';
  btnDetalle.textContent = clienteExpandido === grupo.cliente ? 'Ocultar Detalle' : 'Ver Detalle';
  btnDetalle.addEventListener('click', () => {
    clienteExpandido = clienteExpandido === grupo.cliente ? null : grupo.cliente;
    llenarVistaClientes();
  });
  acciones.appendChild(btnDetalle);

  if (window.puedeEscribir('ventas')) {
    const btnPago = document.createElement('button');
    btnPago.className = 'btn-primary';
    btnPago.textContent = 'Registrar Pago';
    btnPago.addEventListener('click', () => abrirModalPago(grupo.cliente));
    acciones.appendChild(btnPago);
  }

  tarjeta.appendChild(acciones);

  if (clienteExpandido === grupo.cliente) {
    tarjeta.appendChild(crearTablaCuentas(grupo.cuentas, grupo.cliente));
  }

  return tarjeta;
}

function crearTablaCuentas(cuentas, nombreCliente) {
  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'destaraje-tabla-wrapper';
  tablaWrapper.style.marginTop = '0.75rem';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="texto">Folio</th><th data-tipo="texto">Material</th><th data-tipo="numero">Cantidad</th><th data-tipo="moneda">Precio Unitario</th><th data-tipo="moneda">Total</th><th data-tipo="moneda">Pagado</th><th data-tipo="moneda">Saldo</th><th data-tipo="texto">Estado</th><th data-tipo="fecha">Fecha Venta</th><th>Abonos</th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  tbody.id = 'cxc-tabla-cuentas-' + (nombreCliente || 'todas');

  const cuentasOrdenadas = cuentas.slice().sort((a, b) => (a.fechaVenta < b.fechaVenta ? 1 : -1));

  cuentasOrdenadas.forEach((c) => {
    const fila = document.createElement('tr');
    const valores = [
      c.folio, c.material, window.formatearKg(c.cantidad, c.material),
      window.formatearMoneda(c.precioUnitario), window.formatearMoneda(c.total),
      window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
      c.estado, window.formatearFecha(c.fechaVenta)
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });

    const abonos = c.abonos || [];
    const celdaAbonos = document.createElement('td');
    const btnAbonos = document.createElement('button');
    btnAbonos.className = 'btn-secondary';
    btnAbonos.textContent = (cxcAbonoExpandido === c.id ? 'Ocultar' : 'Ver') + ` (${abonos.length})`;
    btnAbonos.disabled = abonos.length === 0;
    btnAbonos.addEventListener('click', () => {
      cxcAbonoExpandido = cxcAbonoExpandido === c.id ? null : c.id;
      renderizarVistaActiva();
    });
    celdaAbonos.appendChild(btnAbonos);
    fila.appendChild(celdaAbonos);
    tbody.appendChild(fila);

    if (cxcAbonoExpandido === c.id && abonos.length > 0) {
      const filaDetalle = document.createElement('tr');
      const celdaDetalle = document.createElement('td');
      celdaDetalle.colSpan = 10;
      const subtabla = document.createElement('table');
      subtabla.className = 'tabla-destaraje';
      subtabla.style.margin = '0.5rem 0';
      subtabla.innerHTML = `
        <thead><tr><th data-tipo="fecha">Fecha</th><th data-tipo="moneda">Monto</th><th data-tipo="texto">Referencia</th><th data-tipo="texto">Registrado por</th><th></th></tr></thead>
        <tbody></tbody>
      `;
      const subtbody = subtabla.querySelector('tbody');
      abonos.forEach((abono) => {
        const filaAbono = document.createElement('tr');
        [window.formatearFecha(abono.fecha), window.formatearMoneda(abono.monto), abono.referencia || '', abono.registradoPor].forEach((valor) => {
          const celda = document.createElement('td');
          celda.textContent = valor;
          filaAbono.appendChild(celda);
        });
        const celdaAccion = document.createElement('td');
        if (window.puedeEscribir('ventas')) {
          const btnRevertir = document.createElement('button');
          btnRevertir.className = 'btn-secondary';
          btnRevertir.textContent = 'Revertir';
          btnRevertir.addEventListener('click', async () => {
            const motivo = window.prompt('Motivo de la reversión (obligatorio):');
            if (motivo === null || !motivo.trim()) return;
            const botones = Array.from(subtbody.querySelectorAll('button'));
            botones.forEach((btn) => { btn.disabled = true; });
            try {
              await revertirAbonoCxC(c.id, abono.abonoId, motivo.trim(), usuarioActual());
              window.showSuccess('Abono revertido');
              renderizarVistaActiva();
            } catch (error) {
              window.showError(error.message);
              botones.forEach((btn) => { btn.disabled = false; });
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
  });

  window.activarOrdenamiento(tabla);
  tablaWrapper.appendChild(tabla);
  return tablaWrapper;
}

// ── Vista "Todos" ────────────────────────────────────────────────────────

function crearTabsTodos() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'personalizado', nombre: 'Personalizado' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === tabTodos ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      tabTodos = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      llenarVistaTodos();
      llenarResumenGeneral();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function crearBarraFiltrosTodos() {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = 'cxc-filtros-todos';
  div.style.display = 'none';
  div.innerHTML = `
    <div class="form-grid">
      <input type="date" id="cxc-filtro-desde" placeholder="Desde">
      <input type="date" id="cxc-filtro-hasta" placeholder="Hasta">
      <input type="text" id="cxc-filtro-cliente" placeholder="Cliente">
      <input type="text" id="cxc-filtro-material" placeholder="Material">
      <select id="cxc-filtro-estado">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="parcial">Parcial</option>
        <option value="liquidado">Liquidado</option>
      </select>
    </div>
  `;
  ['desde', 'hasta', 'cliente', 'material', 'estado'].forEach((campo) => {
    div.querySelector(`#cxc-filtro-${campo}`).addEventListener('change', (evento) => {
      filtrosTodos[campo] = evento.target.value;
      llenarVistaTodos();
    });
  });
  return div;
}

function crearVistaTodos() {
  const wrapper = document.createElement('div');
  wrapper.id = 'cxc-todos-wrapper';
  wrapper.style.display = 'none';
  wrapper.appendChild(crearTabsTodos());
  wrapper.appendChild(crearBarraFiltrosTodos());
  const contenido = document.createElement('div');
  contenido.id = 'cxc-todos-contenido';
  wrapper.appendChild(contenido);
  return wrapper;
}

function llenarVistaTodos() {
  const filtrosDiv = document.getElementById('cxc-filtros-todos');
  if (filtrosDiv) filtrosDiv.style.display = tabTodos === 'personalizado' ? '' : 'none';

  let cuentas = window.EVE.cuentasPorCobrar || [];
  if (tabTodos === 'personalizado') {
    cuentas = filtrarCxC(cuentas, filtrosTodos);
  } else {
    const { desde, hasta } = calcularRangoPeriodoCxC(tabTodos);
    cuentas = filtrarCxC(cuentas, { desde, hasta });
  }

  const contenido = document.getElementById('cxc-todos-contenido');
  if (!contenido) return;
  contenido.innerHTML = '';
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';
  if (cuentas.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'Sin registros en este periodo';
    tarjeta.appendChild(vacio);
  } else {
    tarjeta.appendChild(crearTablaCuentas(cuentas, null));
  }
  contenido.appendChild(tarjeta);
}

function renderizarVistaActiva() {
  llenarResumenGeneral();
  const wrapperClientes = document.getElementById('cxc-clientes-wrapper');
  const wrapperTodos = document.getElementById('cxc-todos-wrapper');
  if (wrapperClientes) wrapperClientes.style.display = vistaActiva === 'clientes' ? '' : 'none';
  if (wrapperTodos) wrapperTodos.style.display = vistaActiva === 'todos' ? '' : 'none';
  if (vistaActiva === 'clientes') {
    llenarVistaClientes();
  } else {
    llenarVistaTodos();
  }
}

// ── Modal Registrar Pago ────────────────────────────────────────────────

function llenarDatalistFoliosCliente(cliente) {
  const datalist = document.getElementById('cxc-modal-folios');
  datalist.innerHTML = '';
  window.EVE.cuentasPorCobrar
    .filter((c) => c.cliente === cliente && c.saldo > 0)
    .forEach((c) => {
      const option = document.createElement('option');
      option.value = c.folio;
      option.textContent = `${c.folio} — ${c.material} — ${window.formatearMoneda(c.saldo)}`;
      datalist.appendChild(option);
    });
}

function crearModalPago() {
  const overlay = document.createElement('div');
  overlay.id = 'cxc-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Registrar Pago</h3>
      <form id="cxc-modal-form">
        <p id="cxc-modal-cliente" style="font-weight:600"></p>
        <input type="text" id="cxc-modal-folio" placeholder="Folio específico (opcional — vacío = pago general)" list="cxc-modal-folios">
        <datalist id="cxc-modal-folios"></datalist>
        <input type="number" id="cxc-modal-monto" placeholder="Monto" step="0.01" min="0.01" required>
        <input type="date" id="cxc-modal-fecha" required>
        <select id="cxc-modal-referencia">
          <option value="Efectivo">Efectivo</option>
          <option value="Transferencia">Transferencia</option>
          <option value="Cheque">Cheque</option>
        </select>
        <button type="submit" id="cxc-modal-guardar" class="btn-primary">Guardar</button>
        <button type="button" id="cxc-modal-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#cxc-modal-form').addEventListener('submit', manejarEnvioPago);
  overlay.querySelector('#cxc-modal-cancelar').addEventListener('click', () => cerrarModalPago());
  return overlay;
}

function abrirModalPago(cliente) {
  modalContexto = { cliente };
  document.getElementById('cxc-modal-form').reset();
  document.getElementById('cxc-modal-cliente').textContent = cliente;
  document.getElementById('cxc-modal-fecha').value = window.obtenerFechaMexico();
  llenarDatalistFoliosCliente(cliente);
  document.getElementById('cxc-modal-overlay').classList.add('open');
}

function cerrarModalPago() {
  document.getElementById('cxc-modal-overlay').classList.remove('open');
  modalContexto = null;
}

async function manejarEnvioPago(evento) {
  evento.preventDefault();
  if (!modalContexto || envioPagoEnCurso) return;
  const folio = document.getElementById('cxc-modal-folio').value.trim();
  const monto = Number(document.getElementById('cxc-modal-monto').value);
  const fecha = document.getElementById('cxc-modal-fecha').value;
  const referencia = document.getElementById('cxc-modal-referencia').value;
  const usuario = usuarioActual();

  if (!Number.isFinite(monto) || monto <= 0) {
    window.showError('El monto debe ser mayor a 0');
    return;
  }

  const botonGuardar = document.getElementById('cxc-modal-guardar');
  envioPagoEnCurso = true;
  botonGuardar.disabled = true;
  try {
    if (folio) {
      const cxc = window.EVE.cuentasPorCobrar.find((c) => c.cliente === modalContexto.cliente && String(c.folio) === folio && c.saldo > 0);
      if (!cxc) {
        window.showError('No se encontró una cuenta por cobrar pendiente con ese folio para este cliente');
        return;
      }
      if (monto > cxc.saldo) {
        window.showError(`El monto no puede exceder el saldo de esta línea (${window.formatearMoneda(cxc.saldo)})`);
        return;
      }
      const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
      await actualizarAbonoCxC(cxc.id, {
        monto, fecha, referencia, registradoPor: usuario, fechaRegistro: new Date().toISOString(), grupoPagoId
      });
      const registroCobro = {
        cxcId: cxc.id,
        ventaId: cxc.ventaId,
        folio: cxc.folio,
        cliente: cxc.cliente,
        material: cxc.material,
        cantidad: cxc.cantidad,
        unidad: cxc.unidad,
        pagado: monto,
        total: cxc.total,
        iva: window.calcularIvaProrrateado(monto, cxc.total, cxc.ivaTrasladado),
        fecha,
        referencia,
        origen: 'cxc_pago_folio',
        grupoPagoId
      };
      const idCobro = await window.guardarDato('cobros', registroCobro);
      window.EVE.cobros.push({ id: idCobro, ...registroCobro, fechaRegistro: new Date().toISOString() });
    } else {
      const tieneCuentasPendientes = window.EVE.cuentasPorCobrar.some(
        (c) => c.cliente === modalContexto.cliente && c.saldo > 0
      );
      if (!tieneCuentasPendientes) {
        window.showError(`${modalContexto.cliente} no tiene cuentas pendientes`);
        return;
      }
      const resultado = await registrarCobroGeneral(modalContexto.cliente, monto, fecha, referencia, usuario);
      if (resultado.sobrante > 0) {
        window.showSuccess(`Pago aplicado. Sobrante sin aplicar: ${window.formatearMoneda(resultado.sobrante)}`);
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

// ── Exportar CSV ─────────────────────────────────────────────────────────

function construirFilasCSVCxCResumen(cuentas) {
  return cuentas.map((c) => ({
    'Folio': c.folio,
    'Cliente': c.cliente,
    'Material': c.material,
    'Cantidad': c.cantidad,
    'Fecha Venta': c.fechaVenta,
    'Precio Unitario': c.precioUnitario,
    'Total': c.total,
    'Pagado': c.pagado,
    'Saldo': c.saldo,
    'Estado': c.estado,
    'Cantidad Abonos': (c.abonos || []).length
  }));
}

function construirFilasCSVCxCAbonos(cuentas) {
  const filas = [];
  cuentas.forEach((c) => {
    (c.abonos || []).forEach((a) => {
      filas.push({
        'Folio': c.folio,
        'Cliente': c.cliente,
        'Material': c.material,
        'Monto': a.monto,
        'Fecha': a.fecha,
        'Referencia': a.referencia || '',
        'Registrado Por': a.registradoPor || '',
        'Grupo Pago ID': a.grupoPagoId || ''
      });
    });
  });
  return filas;
}

function obtenerCuentasSegunTabActivo() {
  const cuentas = window.EVE.cuentasPorCobrar || [];
  const periodoActivo = obtenerPeriodoActivoInfo();
  if (!periodoActivo) return cuentas;
  return filtrarCxC(cuentas, { desde: periodoActivo.desde, hasta: periodoActivo.hasta });
}

function exportarCxCCSV() {
  const cuentas = obtenerCuentasSegunTabActivo();
  const fecha = window.obtenerFechaMexico();
  window.exportarCSV(construirFilasCSVCxCResumen(cuentas), `cuentas_por_cobrar_detalle_${fecha}.csv`);
  window.exportarCSV(construirFilasCSVCxCAbonos(cuentas), `cuentas_por_cobrar_abonos_${fecha}.csv`);
}

function crearBarraExportarCxC() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btn = document.createElement('button');
  btn.textContent = 'Exportar CSV';
  btn.className = 'btn-secondary';
  btn.addEventListener('click', () => exportarCxCCSV());
  div.appendChild(btn);
  return div;
}

function renderCxC(container) {
  vistaActiva = 'clientes';
  tabClientePeriodo = 'todos';
  clienteExpandido = null;
  cxcAbonoExpandido = null;
  tabTodos = 'semana';
  filtrosTodos = { desde: '', hasta: '', cliente: '', material: '', estado: '' };

  container.appendChild(crearResumenGeneral());
  container.appendChild(crearTabsPrincipales());
  container.appendChild(crearBarraExportarCxC());
  container.appendChild(crearVistaClientes());
  container.appendChild(crearVistaTodos());
  container.appendChild(crearModalPago());

  renderizarVistaActiva();
}

window.EVE_MODULES.cxc = { render: renderCxC };

})();
