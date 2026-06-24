(function () {

function esMaterialPZ(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function calcularStatsDestaraje(registros) {
  let totalKg = 0;
  let totalPz = 0;
  for (const registro of registros) {
    if (esMaterialPZ(registro.material)) {
      totalPz += Number(registro.kg) || 0;
    } else {
      totalKg += Number(registro.kg) || 0;
    }
  }
  return { totalRegistros: registros.length, totalKg, totalPz };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fechaSalida === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fechaSalida >= inicioSemana);
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
    if (!dentroDeRangoFecha(r.fechaSalida, filtros.desde, filtros.hasta)) return false;
    return true;
  });
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
  if (!datos.ticket || !datos.proveedor || !datos.material || !datos.fechaEntrada || !datos.fechaSalida) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  const registro = {
    ticket: datos.ticket,
    proveedor: datos.proveedor,
    material: datos.material,
    kg,
    fechaEntrada: datos.fechaEntrada,
    fechaSalida: datos.fechaSalida
  };
  if (datos.ticketOrigen && datos.ticketOrigen.trim()) {
    registro.ticketOrigen = datos.ticketOrigen.trim();
  }
  return registro;
}

window.calcularStatsDestaraje = calcularStatsDestaraje;
window.filtrarPorHoy = filtrarPorHoy;
window.filtrarPorSemana = filtrarPorSemana;
window.aplicarFiltrosTodos = aplicarFiltrosTodos;
window.valoresUnicos = valoresUnicos;
window.construirRegistroDesdeFormulario = construirRegistroDesdeFormulario;

let editandoId = null;
let tipoFormulario = 'compra';

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
  const proveedores = valoresUnicos([window.EVE.registrosDestaraje], 'proveedor', window.PROVEEDORES_COMUNES);
  const clientes = valoresUnicos([window.EVE.registrosVentas], 'proveedor', []);
  const materiales = valoresUnicos(
    [window.EVE.registrosDestaraje, window.EVE.registrosVentas], 'material', window.MATERIALES_COMUNES
  );
  llenarDatalist('dl-proveedores', proveedores);
  llenarDatalist('dl-clientes', clientes);
  llenarDatalist('dl-materiales', materiales);
  llenarDatalist('dl-cp-tickets', (window.EVE.registrosControlProduccion || []).map((r) => r.ticket).sort());
}

function aplicarModoFormulario() {
  const ticketInput = document.getElementById('df-ticket');
  const proveedorInput = document.getElementById('df-proveedor');
  proveedorInput.setAttribute('list', tipoFormulario === 'venta' ? 'dl-clientes' : 'dl-proveedores');
  proveedorInput.placeholder = tipoFormulario === 'venta' ? 'Cliente' : 'Proveedor';
  if (tipoFormulario === 'venta') {
    ticketInput.value = 'V';
    ticketInput.disabled = true;
  } else {
    ticketInput.disabled = false;
    if (ticketInput.value === 'V') ticketInput.value = '';
  }
  const ticketOrigenInput = document.getElementById('df-ticketorigen');
  ticketOrigenInput.style.display = tipoFormulario === 'venta' ? '' : 'none';
  if (tipoFormulario !== 'venta') ticketOrigenInput.value = '';
}

function insertarRegistroEnMemoria(registro) {
  if (/^\d+$/.test(String(registro.ticket))) {
    window.EVE.registrosDestaraje.push(registro);
  } else if (registro.ticket === 'V') {
    window.EVE.registrosVentas.push(registro);
  }
}

function reemplazarRegistroEnMemoria(id, datos) {
  for (const lista of [window.EVE.registrosDestaraje, window.EVE.registrosVentas]) {
    const indice = lista.findIndex((r) => r.id === id);
    if (indice !== -1) {
      lista[indice] = { ...lista[indice], ...datos };
      return;
    }
  }
}

function eliminarRegistroEnMemoria(id) {
  for (const lista of [window.EVE.registrosDestaraje, window.EVE.registrosVentas]) {
    const indice = lista.findIndex((r) => r.id === id);
    if (indice !== -1) {
      lista.splice(indice, 1);
      return;
    }
  }
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    ticket: tipoFormulario === 'venta' ? 'V' : document.getElementById('df-ticket').value.trim(),
    proveedor: document.getElementById('df-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('df-material').value.trim().toUpperCase(),
    kg: document.getElementById('df-kg').value,
    fechaEntrada: document.getElementById('df-entrada').value,
    fechaSalida: document.getElementById('df-salida').value,
    ticketOrigen: document.getElementById('df-ticketorigen').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    const id = await window.guardarDato('destaraje', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    document.getElementById('destaraje-form').reset();
    aplicarModoFormulario();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'destaraje-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-tipo">
      <label><input type="radio" name="tipo" value="compra" checked> Compra</label>
      <label><input type="radio" name="tipo" value="venta"> Venta</label>
    </div>
    <div class="form-grid">
      <input type="text" id="df-ticket" placeholder="Ticket" required>
      <input type="text" id="df-proveedor" placeholder="Proveedor" list="dl-proveedores" required>
      <input type="text" id="df-material" placeholder="Material" list="dl-materiales" required>
      <input type="number" id="df-kg" placeholder="Kg" step="0.01" required>
      <input type="date" id="df-entrada" required>
      <input type="date" id="df-salida" required>
      <input type="text" id="df-ticketorigen" placeholder="Ticket Origen (opcional)" list="dl-cp-tickets" style="display:none">
    </div>
    <datalist id="dl-proveedores"></datalist>
    <datalist id="dl-clientes"></datalist>
    <datalist id="dl-materiales"></datalist>
    <datalist id="dl-cp-tickets"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelectorAll('input[name="tipo"]').forEach((radio) => {
    radio.addEventListener('change', (evento) => {
      tipoFormulario = evento.target.value;
      aplicarModoFormulario();
    });
  });
  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));
  return form;
}

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parseDestaraje(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  tipoFormulario = datos.ticket === 'V' ? 'venta' : 'compra';
  document.querySelector(`input[name="tipo"][value="${tipoFormulario}"]`).checked = true;
  aplicarModoFormulario();
  if (tipoFormulario === 'compra') {
    document.getElementById('df-ticket').value = datos.ticket;
  }
  document.getElementById('df-proveedor').value = datos.proveedor;
  document.getElementById('df-material').value = datos.material;
  document.getElementById('df-kg').value = datos.kg;
  document.getElementById('df-entrada').value = datos.fechaEntrada;
  document.getElementById('df-salida').value = datos.fechaSalida;
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    ticket: document.getElementById('de-ticket').value.trim(),
    proveedor: document.getElementById('de-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('de-material').value.trim().toUpperCase(),
    kg: document.getElementById('de-kg').value,
    fechaEntrada: document.getElementById('de-entrada').value,
    fechaSalida: document.getElementById('de-salida').value,
    ticketOrigen: document.getElementById('de-ticketorigen').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    await window.actualizarDato('destaraje', editandoId, registro);
    reemplazarRegistroEnMemoria(editandoId, registro);
    cerrarModalEdicion();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'destaraje-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar registro</h3>
      <form id="destaraje-edit-form">
        <input type="text" id="de-ticket" placeholder="Ticket" disabled>
        <input type="text" id="de-proveedor" placeholder="Proveedor/Cliente" required>
        <input type="text" id="de-material" placeholder="Material" required>
        <input type="number" id="de-kg" placeholder="Kg" step="0.01" required>
        <input type="date" id="de-entrada" required>
        <input type="date" id="de-salida" required>
        <input type="text" id="de-ticketorigen" placeholder="Ticket Origen (opcional)" list="dl-cp-tickets" style="display:none">
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="de-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#destaraje-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#de-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('de-ticket').value = registro.ticket;
  document.getElementById('de-proveedor').value = registro.proveedor;
  document.getElementById('de-material').value = registro.material;
  document.getElementById('de-kg').value = registro.kg;
  document.getElementById('de-entrada').value = registro.fechaEntrada;
  document.getElementById('de-salida').value = registro.fechaSalida;
  const esVenta = registro.ticket === 'V';
  const ticketOrigenInput = document.getElementById('de-ticketorigen');
  ticketOrigenInput.style.display = esVenta ? '' : 'none';
  ticketOrigenInput.value = esVenta ? (registro.ticketOrigen || '') : '';
  document.getElementById('destaraje-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('destaraje-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await window.eliminarDato('destaraje', id);
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

window.crearFormulario = crearFormulario;
window.crearModalEdicion = crearModalEdicion;
window.abrirModalEdicion = abrirModalEdicion;
window.actualizarDatalists = actualizarDatalists;
window.aplicarModoFormulario = aplicarModoFormulario;
window.confirmarEliminar = confirmarEliminar;

let tabActiva = 'hoy';
let filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
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
  div.id = 'destaraje-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'ft-ticket', etiqueta: '', placeholder: 'Ticket', tipo: 'text' },
    { id: 'ft-desde', etiqueta: 'Desde', placeholder: '', tipo: 'date' },
    { id: 'ft-hasta', etiqueta: 'Hasta', placeholder: '', tipo: 'date' },
    { id: 'ft-proveedor', etiqueta: '', placeholder: 'Proveedor/Cliente', tipo: 'text' },
    { id: 'ft-material', etiqueta: '', placeholder: 'Material', tipo: 'text' }
  ];
  campos.forEach((campo) => {
    if (campo.etiqueta) {
      const etiqueta = document.createElement('span');
      etiqueta.textContent = campo.etiqueta;
      div.appendChild(etiqueta);
    }
    const input = document.createElement('input');
    input.type = campo.tipo;
    input.id = campo.id;
    input.placeholder = campo.placeholder;
    input.addEventListener('input', () => {
      filtros = {
        ticket: document.getElementById('ft-ticket').value,
        desde: document.getElementById('ft-desde').value,
        hasta: document.getElementById('ft-hasta').value,
        proveedor: document.getElementById('ft-proveedor').value,
        material: document.getElementById('ft-material').value
      };
      renderizarVista();
    });
    div.appendChild(input);
  });
  return div;
}

function crearTabla(idTbody, titulo) {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const encabezado = document.createElement('h4');
  encabezado.textContent = titulo;
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Ticket</th><th>Proveedor/Cliente</th><th>Material</th><th>Kg</th><th>F. Entrada</th><th>F. Salida</th><th></th></tr>
    </thead>
    <tbody id="${idTbody}"></tbody>
  `;
  wrapper.appendChild(encabezado);
  wrapper.appendChild(tabla);
  return wrapper;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const valores = [
    registro.ticket, registro.proveedor, registro.material,
    window.formatearKg(registro.kg, registro.material), registro.fechaEntrada, registro.fechaSalida
  ];
  valores.forEach((valor) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
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
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(idTbody, registros) {
  const tbody = document.getElementById(idTbody);
  tbody.innerHTML = '';
  if (registros.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 7;
    celda.textContent = 'Sin registros';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  registros.forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let destaraje = window.EVE.registrosDestaraje;
  let ventas = window.EVE.registrosVentas;
  if (tabActiva === 'hoy') {
    const hoy = window.obtenerFechaMexico();
    destaraje = filtrarPorHoy(destaraje, hoy);
    ventas = filtrarPorHoy(ventas, hoy);
  } else if (tabActiva === 'semana') {
    const inicioSemana = window.obtenerInicioSemana();
    destaraje = filtrarPorSemana(destaraje, inicioSemana);
    ventas = filtrarPorSemana(ventas, inicioSemana);
  } else {
    destaraje = aplicarFiltrosTodos(destaraje, filtros);
    ventas = aplicarFiltrosTodos(ventas, filtros);
  }
  return { destaraje, ventas };
}

function renderizarStats(destaraje, ventas) {
  const stats = calcularStatsDestaraje([...destaraje, ...ventas]);
  const contenedor = document.getElementById('destaraje-stats');
  contenedor.innerHTML = '';
  const partes = [
    `Registros: ${stats.totalRegistros}`,
    `Total KG: ${stats.totalKg.toLocaleString('es-MX')}`
  ];
  if (stats.totalPz > 0) {
    partes.push(`Total PZ: ${stats.totalPz.toLocaleString('es-MX')}`);
  }
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function renderizarVista() {
  document.getElementById('destaraje-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const { destaraje, ventas } = obtenerRegistrosParaTab();
  renderizarStats(destaraje, ventas);
  llenarTabla('destaraje-tabla-destaraje', destaraje);
  llenarTabla('destaraje-tabla-ventas', ventas);
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const acciones = [
    { texto: 'TXT', fn: () => window.exportarReporteTXT(tabActiva, filtros) },
    { texto: 'PDF', fn: () => window.exportarReportePDF(tabActiva, filtros) },
    { texto: 'CSV', fn: () => window.exportarReporteCSV(tabActiva, filtros) }
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

function renderDestaraje(container) {
  tabActiva = 'hoy';
  filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };
  editandoId = null;
  tipoFormulario = 'compra';

  container.appendChild(crearFormulario());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  const stats = document.createElement('div');
  stats.id = 'destaraje-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla('destaraje-tabla-destaraje', 'Destaraje'));
  container.appendChild(crearTabla('destaraje-tabla-ventas', 'Ventas'));
  container.appendChild(crearModalEdicion());

  aplicarModoFormulario();
  actualizarDatalists();
  renderizarVista();
}

window.EVE_MODULES.destaraje = { render: renderDestaraje };

})();
