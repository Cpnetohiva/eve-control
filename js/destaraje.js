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

function filtrarPorMes(registros, inicioMes) {
  return registros.filter((r) => r.fechaSalida >= inicioMes);
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
  return {
    ticket: datos.ticket,
    proveedor: window.normalizarProveedor(datos.proveedor),
    material: window.normalizarMaterial(datos.material),
    kg,
    fechaEntrada: datos.fechaEntrada,
    fechaSalida: datos.fechaSalida
  };
}

window.calcularStatsDestaraje = calcularStatsDestaraje;
window.filtrarPorHoy = filtrarPorHoy;
window.filtrarPorSemana = filtrarPorSemana;
window.filtrarPorMes = filtrarPorMes;
window.aplicarFiltrosTodos = aplicarFiltrosTodos;
window.valoresUnicos = valoresUnicos;
window.construirRegistroDesdeFormulario = construirRegistroDesdeFormulario;

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
  const proveedores = valoresUnicos([window.EVE.registrosDestaraje], 'proveedor', window.PROVEEDORES_COMUNES);
  llenarDatalist('dl-proveedores', proveedores);
}

function opcionesMaterialesHtml() {
  return '<option value="">Material</option>' +
    window.MATERIALES_COMUNES.map((m) => `<option value="${m}">${m}</option>`).join('');
}

function insertarRegistroEnMemoria(registro) {
  if (registro.ticket === 'V') return;
  window.EVE.registrosDestaraje.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos) {
  const lista = window.EVE.registrosDestaraje;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice === -1) return;
  lista[indice] = { ...lista[indice], ...datos };
}

function eliminarRegistroEnMemoria(id) {
  const lista = window.EVE.registrosDestaraje;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) lista.splice(indice, 1);
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const dfEntrada = document.getElementById('df-entrada');
  const dfSalida = document.getElementById('df-salida');
  if (!dfEntrada.value) dfEntrada.value = dfSalida.value;
  const datos = {
    ticket: document.getElementById('df-ticket').value.trim().toUpperCase(),
    proveedor: document.getElementById('df-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('df-material').value.trim().toUpperCase(),
    kg: document.getElementById('df-kg').value,
    fechaEntrada: dfEntrada.value,
    fechaSalida: dfSalida.value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    const id = await window.guardarDato('destaraje', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    document.getElementById('destaraje-form').reset();
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
    <div class="form-grid">
      <input type="text" id="df-ticket" placeholder="Ticket" required>
      <input type="text" id="df-proveedor" placeholder="Proveedor" list="dl-proveedores" required>
      <select id="df-material" required>${opcionesMaterialesHtml()}</select>
      <input type="number" id="df-kg" placeholder="Kg" step="0.01" required>
      <input type="date" id="df-entrada" style="display:none">
      <input type="date" id="df-salida" required>
    </div>
    <datalist id="dl-proveedores"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
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
  document.getElementById('df-ticket').value = datos.ticket;
  document.getElementById('df-proveedor').value = datos.proveedor;
  document.getElementById('df-material').value = window.normalizarMaterial(datos.material);
  document.getElementById('df-kg').value = datos.kg;
  document.getElementById('df-entrada').value = datos.fechaEntrada;
  document.getElementById('df-salida').value = datos.fechaSalida;
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const ticket = document.getElementById('de-ticket').value.trim();
  if (!/^\d+$/.test(ticket)) {
    window.showError('Ticket debe ser numérico');
    return;
  }
  const datos = {
    ticket,
    proveedor: document.getElementById('de-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('de-material').value.trim().toUpperCase(),
    kg: document.getElementById('de-kg').value,
    fechaEntrada: document.getElementById('de-entrada').value,
    fechaSalida: document.getElementById('de-salida').value
  };
  const anterior = window.EVE.registrosDestaraje.find((r) => r.id === editandoId);
  const motivo = document.getElementById('de-motivo').value.trim();
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    await window.actualizarDato('destaraje', editandoId, registro);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'destaraje',
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior ? { ticket: anterior.ticket, proveedor: anterior.proveedor, material: anterior.material, kg: anterior.kg, fechaEntrada: anterior.fechaEntrada, fechaSalida: anterior.fechaSalida } : null,
      valorNuevo: registro,
      motivo
    });
    document.getElementById('de-motivo').value = '';
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
        <input type="text" id="de-ticket" placeholder="Ticket" required>
        <input type="text" id="de-proveedor" placeholder="Proveedor" list="dl-proveedores" required>
        <select id="de-material" required>${opcionesMaterialesHtml()}</select>
        <input type="number" id="de-kg" placeholder="Kg" step="0.01" required>
        <input type="date" id="de-entrada" required>
        <input type="date" id="de-salida" required>
        <textarea id="de-motivo" placeholder="Motivo del cambio (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
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
  document.getElementById('destaraje-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('destaraje-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function obtenerCxPConSaldoPendiente(ticket, material, kg) {
  const kgNum = Number(kg);
  const dentroTolerancia = (valor) => Math.abs(Number(valor) - kgNum) <= 0.01;

  const [snapshotDestaraje, snapshotCxP] = await Promise.all([
    window.db.collection('destaraje').where('ticket', '==', ticket).get(),
    window.db.collection('cuentas_por_pagar').where('ticket', '==', ticket).get()
  ]);

  const cantidadDestaraje = snapshotDestaraje.docs
    .map((doc) => doc.data())
    .filter((r) => r.material === material && dentroTolerancia(r.kg)).length;

  const cxpPendientes = snapshotCxP.docs
    .map((doc) => doc.data())
    .filter((cxp) => Number(cxp.saldo) > 0 && cxp.material === material && dentroTolerancia(cxp.kg));

  if (cantidadDestaraje > cxpPendientes.length) return null;

  return cxpPendientes[0] || null;
}

async function confirmarEliminar(id) {
  const registro = window.EVE.registrosDestaraje.find((r) => r.id === id);
  if (registro) {
    try {
      const cxpPendiente = await obtenerCxPConSaldoPendiente(registro.ticket, registro.material, registro.kg);
      if (cxpPendiente) {
        window.showError(`No se puede eliminar: el ticket ${registro.ticket} tiene una cuenta por pagar con saldo pendiente de ${window.formatearMoneda(cxpPendiente.saldo)} para ${cxpPendiente.material} (${window.formatearKg(cxpPendiente.kg, cxpPendiente.material)}). Resuélvela desde CxP antes de eliminar este registro.`);
        return;
      }
    } catch (error) {
      window.showError(error.message);
      return;
    }
  }
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato('destaraje', id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'destaraje',
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: registro ? { ticket: registro.ticket, proveedor: registro.proveedor, material: registro.material, kg: registro.kg, fechaEntrada: registro.fechaEntrada, fechaSalida: registro.fechaSalida } : null,
      valorNuevo: null,
      motivo
    });
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
window.confirmarEliminar = confirmarEliminar;

let tabActiva = 'hoy';
let filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };
// ISO de la fecha buscada vía el buscador global (lupa) cuando la búsqueda activa
// es por fecha, o null si no hay una búsqueda por fecha activa. Controla cuándo
// "Vista para captura" aparece fuera de Hoy/Esta Semana (ver actualizarVisibilidadBotonCaptura).
let busquedaFechaActiva = null;

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
      busquedaFechaActiva = null;
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
    { id: 'ft-ticket', etiqueta: 'Ticket', placeholder: 'Ticket', tipo: 'text' },
    { id: 'ft-desde', etiqueta: 'Desde', placeholder: '', tipo: 'date' },
    { id: 'ft-hasta', etiqueta: 'Hasta', placeholder: '', tipo: 'date' },
    { id: 'ft-proveedor', etiqueta: 'Proveedor', placeholder: 'Proveedor', tipo: 'text' },
    { id: 'ft-material', etiqueta: 'Material', placeholder: 'Material', tipo: 'text' }
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
        ticket: document.getElementById('ft-ticket').value,
        desde: document.getElementById('ft-desde').value,
        hasta: document.getElementById('ft-hasta').value,
        proveedor: document.getElementById('ft-proveedor').value,
        material: document.getElementById('ft-material').value
      };
      // Editar los filtros a mano ya no es "la búsqueda por fecha" del buscador global.
      busquedaFechaActiva = null;
      renderizarVista();
    });
    contenedor.appendChild(input);
    div.appendChild(contenedor);
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
      <tr><th data-tipo="ticket">Ticket</th><th data-tipo="texto">Proveedor</th><th data-tipo="texto">Material</th><th data-tipo="numero">Kg</th><th data-tipo="fecha">F. Entrada</th><th data-tipo="fecha">F. Salida</th><th></th></tr>
    </thead>
    <tbody id="${idTbody}"></tbody>
  `;
  wrapper.appendChild(encabezado);
  wrapper.appendChild(tabla);
  window.activarOrdenamiento(tabla);
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
  if (window.puedeEscribir('destaraje')) {
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
  if (tabActiva === 'hoy') {
    destaraje = filtrarPorHoy(destaraje, window.obtenerFechaMexico());
  } else if (tabActiva === 'semana') {
    destaraje = filtrarPorSemana(destaraje, window.obtenerInicioSemana());
  } else if (tabActiva === 'mes') {
    destaraje = filtrarPorMes(destaraje, window.obtenerInicioMes());
  } else {
    destaraje = aplicarFiltrosTodos(destaraje, filtros);
  }
  return destaraje;
}

function renderizarStats(destaraje) {
  const stats = calcularStatsDestaraje(destaraje);
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
  const destaraje = obtenerRegistrosParaTab();
  renderizarStats(destaraje);
  llenarTabla('destaraje-tabla-destaraje', destaraje);
  actualizarVisibilidadBotonCaptura(destaraje);
}

// ===== Vista para captura (Hoy / Esta Semana) =====
// Reusa obtenerRegistrosParaTab() (mismos datos en memoria que ya usa el tab
// activo) y obtenerRangoYEtiqueta() (mismo rango que usan TXT/PDF/CSV) en vez
// de recalcular filtros o rangos de fecha por separado.

const NOMBRES_TAB_CAPTURA = { hoy: 'Hoy', semana: 'Esta Semana' };
const DIAS_ES = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];

function nombreDiaSemana(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return DIAS_ES[new Date(anio, mes - 1, dia).getDay()];
}

function generarSelloCaptura() {
  const partes = new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(new Date());
  const obtener = (tipo) => partes.find((p) => p.type === tipo).value;
  return `${obtener('day')}/${obtener('month')}/${obtener('year')} ${obtener('hour')}:${obtener('minute')}`;
}

function construirEtiquetaPeriodoCaptura(tabId) {
  const { desde, hasta } = window.obtenerRangoYEtiqueta(tabId, filtros);
  const nombreTab = NOMBRES_TAB_CAPTURA[tabId] || '';
  const rango = desde === hasta ? window.formatearFecha(desde) : `${window.formatearFecha(desde)} al ${window.formatearFecha(hasta)}`;
  return `${nombreTab} · ${rango}`;
}

function agruparPorFechaSalida(registros) {
  const mapa = new Map();
  registros.forEach((registro) => {
    const clave = registro.fechaSalida;
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(registro);
  });
  return Array.from(mapa.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, regs]) => ({
      fecha,
      registros: regs,
      totalKg: regs.reduce((suma, r) => suma + (Number(r.kg) || 0), 0)
    }));
}

function construirTablaCapturaRegistros(registros) {
  const tabla = document.createElement('table');
  tabla.className = 'captura-tabla';
  tabla.innerHTML = '<thead><tr><th>Ticket</th><th>Proveedor</th><th>Material</th><th>Kg</th></tr></thead><tbody></tbody>';
  const tbody = tabla.querySelector('tbody');
  registros.forEach((registro) => {
    const fila = document.createElement('tr');
    [registro.ticket, registro.proveedor, registro.material, window.formatearKg(registro.kg, registro.material)]
      .forEach((valor) => {
        const celda = document.createElement('td');
        celda.textContent = valor;
        fila.appendChild(celda);
      });
    tbody.appendChild(fila);
  });
  return tabla;
}

function construirSeccionPorDia(grupo) {
  const seccion = document.createElement('div');
  seccion.className = 'captura-dia';
  const titulo = document.createElement('h3');
  titulo.className = 'captura-dia-titulo';
  titulo.textContent = `${nombreDiaSemana(grupo.fecha)} ${window.formatearFecha(grupo.fecha)} · Subtotal ${grupo.totalKg.toLocaleString('es-MX')} kg`;
  seccion.appendChild(titulo);
  seccion.appendChild(construirTablaCapturaRegistros(grupo.registros));
  return seccion;
}

function construirCuerpoCaptura(agruparPorDia, registros) {
  const cuerpo = document.createElement('div');
  cuerpo.className = 'captura-cuerpo';
  if (registros.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'captura-vacio';
    vacio.textContent = 'Sin registros en este periodo';
    cuerpo.appendChild(vacio);
    return cuerpo;
  }
  if (agruparPorDia) {
    agruparPorFechaSalida(registros).forEach((grupo) => cuerpo.appendChild(construirSeccionPorDia(grupo)));
  } else {
    cuerpo.appendChild(construirTablaCapturaRegistros(registros));
  }
  return cuerpo;
}

// Bloque RESUMEN: agrupa las cifras grandes (Registros / Total KG / Total PZ)
// en una franja compacta junto con el desglose de kg por material, para que
// todo quepa en la primera pantalla al capturar. Reemplaza a las cifras
// grandes sueltas y al "Total general" que antes iban por separado.
function construirBloqueResumen(registros) {
  const contenedor = document.createElement('div');
  contenedor.className = 'captura-resumen';
  const titulo = document.createElement('h2');
  titulo.textContent = 'Resumen';
  contenedor.appendChild(titulo);

  const stats = calcularStatsDestaraje(registros);
  const statsDiv = document.createElement('div');
  statsDiv.className = 'captura-resumen-stats';
  const items = [
    { valor: stats.totalRegistros.toLocaleString('es-MX'), etiqueta: 'Registros' },
    { valor: `${stats.totalKg.toLocaleString('es-MX')} KG`, etiqueta: 'Total KG' }
  ];
  if (stats.totalPz > 0) {
    items.push({ valor: stats.totalPz.toLocaleString('es-MX'), etiqueta: 'Total PZ' });
  }
  items.forEach((item) => {
    const bloque = document.createElement('div');
    bloque.className = 'captura-resumen-stat';
    const valor = document.createElement('span');
    valor.className = 'captura-resumen-stat-valor mono';
    valor.textContent = item.valor;
    const etiqueta = document.createElement('span');
    etiqueta.className = 'captura-resumen-stat-etiqueta';
    etiqueta.textContent = item.etiqueta;
    bloque.appendChild(valor);
    bloque.appendChild(etiqueta);
    statsDiv.appendChild(bloque);
  });
  contenedor.appendChild(statsDiv);

  const subtitulo = document.createElement('h3');
  subtitulo.className = 'captura-resumen-subtitulo';
  subtitulo.textContent = 'Kg por material';
  contenedor.appendChild(subtitulo);

  const tabla = document.createElement('table');
  tabla.className = 'captura-tabla captura-tabla-resumen';
  tabla.innerHTML = '<thead><tr><th>Material</th><th>Kg</th></tr></thead><tbody></tbody>';
  const tbody = tabla.querySelector('tbody');
  window.agregarPorMaterial(registros).forEach((item) => { // ya viene ordenado de mayor a menor
    const fila = document.createElement('tr');
    const celdaMaterial = document.createElement('td');
    celdaMaterial.textContent = item.material;
    const celdaKg = document.createElement('td');
    celdaKg.className = 'mono';
    celdaKg.textContent = `${item.kg.toLocaleString('es-MX')} ${item.unidad}`;
    fila.appendChild(celdaMaterial);
    fila.appendChild(celdaKg);
    tbody.appendChild(fila);
  });
  contenedor.appendChild(tabla);

  return contenedor;
}

let handlerEscapeCaptura = null;

function cerrarVistaCaptura() {
  const overlay = document.getElementById('destaraje-captura-overlay');
  if (overlay) overlay.remove();
  if (handlerEscapeCaptura) {
    document.removeEventListener('keydown', handlerEscapeCaptura);
    handlerEscapeCaptura = null;
  }
}

// opciones.etiquetaPeriodo / opciones.agruparPorDia permiten reusar esta misma
// vista desde una búsqueda por fecha del buscador global (ver crearBotonesExportar),
// en vez de duplicar el markup para ese caso.
function abrirVistaCaptura(opciones) {
  const config = opciones || {};
  cerrarVistaCaptura();
  const registros = obtenerRegistrosParaTab();

  const overlay = document.createElement('div');
  overlay.id = 'destaraje-captura-overlay';
  overlay.className = 'captura-overlay';

  const botonCerrar = document.createElement('button');
  botonCerrar.type = 'button';
  botonCerrar.className = 'captura-cerrar';
  botonCerrar.setAttribute('aria-label', 'Cerrar');
  botonCerrar.textContent = '✕';
  botonCerrar.addEventListener('click', cerrarVistaCaptura);
  overlay.appendChild(botonCerrar);

  const contenido = document.createElement('div');
  contenido.className = 'captura-contenido';

  const header = document.createElement('header');
  header.className = 'captura-header';
  const titulo = document.createElement('h1');
  titulo.textContent = 'Báscula';
  const periodo = document.createElement('p');
  periodo.className = 'captura-periodo';
  periodo.textContent = config.etiquetaPeriodo || construirEtiquetaPeriodoCaptura(tabActiva);
  header.appendChild(titulo);
  header.appendChild(periodo);
  contenido.appendChild(header);

  const agruparPorDia = config.agruparPorDia != null ? config.agruparPorDia : (tabActiva === 'semana');
  if (registros.length === 0) {
    contenido.appendChild(construirCuerpoCaptura(agruparPorDia, registros)); // solo el mensaje "Sin registros..."
  } else {
    // Layout de dos columnas (resumen a la izquierda, tickets a la derecha) en
    // pantallas anchas/horizontales; una sola columna apilada en vertical (ver CSS).
    const layout = document.createElement('div');
    layout.className = 'captura-layout';
    const colResumen = document.createElement('div');
    colResumen.className = 'captura-col-resumen';
    colResumen.appendChild(construirBloqueResumen(registros));
    const colTickets = document.createElement('div');
    colTickets.className = 'captura-col-tickets';
    colTickets.appendChild(construirCuerpoCaptura(agruparPorDia, registros));
    layout.appendChild(colResumen);
    layout.appendChild(colTickets);
    contenido.appendChild(layout);
  }

  const footer = document.createElement('footer');
  footer.className = 'captura-footer';
  footer.textContent = `Generado el ${generarSelloCaptura()}`;
  contenido.appendChild(footer);

  overlay.appendChild(contenido);
  document.body.appendChild(overlay);

  handlerEscapeCaptura = (evento) => {
    if (evento.key === 'Escape') cerrarVistaCaptura();
  };
  document.addEventListener('keydown', handlerEscapeCaptura);
}

// Visible en Hoy/Esta Semana como siempre; además, si el buscador global
// resolvió una búsqueda por fecha (busquedaFechaActiva), visible en cualquier
// tab mientras esa fecha tenga registros.
function actualizarVisibilidadBotonCaptura(destarajeActual) {
  const boton = document.getElementById('btn-vista-captura');
  if (!boton) return;
  if (busquedaFechaActiva) {
    const registros = destarajeActual || obtenerRegistrosParaTab();
    boton.style.display = registros.length > 0 ? '' : 'none';
    return;
  }
  boton.style.display = (tabActiva === 'hoy' || tabActiva === 'semana') ? '' : 'none';
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const acciones = [
    { texto: 'TXT', fn: () => window.exportarReporteDestarajeTXT(tabActiva, filtros) },
    { texto: 'PDF', fn: () => window.exportarReporteDestarajePDF(tabActiva, filtros) },
    { texto: 'CSV', fn: () => window.exportarReporteDestarajeCSV(tabActiva, filtros) }
  ];
  acciones.forEach((accion) => {
    const boton = document.createElement('button');
    boton.textContent = accion.texto;
    boton.className = 'btn-secondary';
    boton.addEventListener('click', accion.fn);
    div.appendChild(boton);
  });
  const botonCaptura = document.createElement('button');
  botonCaptura.id = 'btn-vista-captura';
  botonCaptura.textContent = 'Vista para captura';
  botonCaptura.className = 'btn-secondary';
  botonCaptura.addEventListener('click', () => {
    if (busquedaFechaActiva) {
      abrirVistaCaptura({ etiquetaPeriodo: `Día ${window.formatearFecha(busquedaFechaActiva)}`, agruparPorDia: false });
    } else {
      abrirVistaCaptura();
    }
  });
  div.appendChild(botonCaptura);
  return div;
}

function crearBuscadorGlobal() {
  const div = document.createElement('div');
  div.className = 'card destaraje-buscador-global';
  div.innerHTML = `
    <label class="buscador-global-campo">
      <span aria-hidden="true">🔍</span>
      <input type="text" id="destaraje-buscar-global" placeholder="Buscar por Ticket, Proveedor o Fecha (AAAA-MM-DD)...">
    </label>
  `;
  div.querySelector('#destaraje-buscar-global').addEventListener('input', (evento) => {
    aplicarBusquedaGlobal(evento.target.value.trim());
  });
  return div;
}

// Palabras relativas en español reconocidas por el buscador global, en días a
// restar de la fecha local actual (window.obtenerFechaMexico(), misma utilidad
// de utils.js que ya usa p. ej. obtenerInicioSemana para calcular fechas).
const PALABRAS_FECHA_RELATIVA = { hoy: 0, ayer: 1, anteayer: 2, antier: 2 };

function resolverFechaRelativa(termino) {
  const clave = (termino || '').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(PALABRAS_FECHA_RELATIVA, clave)) return null;
  const fecha = new Date(`${window.obtenerFechaMexico()}T00:00:00`);
  fecha.setDate(fecha.getDate() - PALABRAS_FECHA_RELATIVA[clave]);
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function aplicarBusquedaGlobal(termino) {
  if (!termino) {
    busquedaFechaActiva = null;
    actualizarVisibilidadBotonCaptura();
    return;
  }
  const fechaRelativa = resolverFechaRelativa(termino);
  const esFechaISO = /^\d{4}-\d{2}-\d{2}$/.test(termino);
  const esFecha = fechaRelativa !== null || esFechaISO;
  const fechaResuelta = fechaRelativa || (esFechaISO ? termino : '');
  const esTicket = !esFecha && /\d/.test(termino);
  filtros = {
    ticket: esTicket ? termino : '',
    desde: esFecha ? fechaResuelta : '',
    hasta: esFecha ? fechaResuelta : '',
    proveedor: (!esFecha && !esTicket) ? termino : '',
    material: ''
  };
  busquedaFechaActiva = esFecha ? fechaResuelta : null;
  tabActiva = 'todos';
  document.querySelectorAll('.destaraje-subtabs .tab').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.tab === 'todos');
  });
  document.getElementById('ft-ticket').value = filtros.ticket;
  document.getElementById('ft-desde').value = filtros.desde;
  document.getElementById('ft-hasta').value = filtros.hasta;
  document.getElementById('ft-proveedor').value = filtros.proveedor;
  document.getElementById('ft-material').value = filtros.material;
  renderizarVista();
}

function renderDestaraje(container) {
  tabActiva = 'hoy';
  filtros = { ticket: '', desde: '', hasta: '', proveedor: '', material: '' };
  busquedaFechaActiva = null;
  editandoId = null;

  container.appendChild(crearBuscadorGlobal());
  if (window.puedeEscribir('destaraje')) {
    container.appendChild(crearFormulario());
  }
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  const stats = document.createElement('div');
  stats.id = 'destaraje-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla('destaraje-tabla-destaraje', 'Báscula'));
  container.appendChild(crearModalEdicion());

  actualizarDatalists();
  renderizarVista();
}

window.EVE_MODULES.destaraje = { render: renderDestaraje };

})();
