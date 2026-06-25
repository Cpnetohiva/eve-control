(function () {

let moduloActivo = 'general';

function valoresUnicos(valores) {
  const set = new Set();
  valores.forEach((v) => { if (v) set.add(v); });
  return Array.from(set).sort();
}

function obtenerProveedoresUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosDestaraje.map((r) => r.proveedor),
    ...window.EVE.registrosPagos.map((r) => r.proveedor)
  ]);
}

function obtenerMaterialesUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosDestaraje.map((r) => r.material),
    ...window.EVE.registrosProduccion.map((r) => r.material),
    ...window.EVE.registrosVentas.map((r) => r.material),
    ...window.EVE.registrosPagos.map((r) => r.material)
  ]);
}

function obtenerClientesUnicos() {
  return valoresUnicos([
    ...window.EVE.registrosProduccion.map((r) => r.cliente),
    ...window.EVE.registrosVentas.map((r) => r.proveedor)
  ]);
}

function obtenerOperadoresUnicos() {
  return valoresUnicos(window.EVE.registrosControlProduccion.map((r) => r.operador));
}

function crearSelectConOpciones(id, opciones, etiquetaTodos) {
  const select = document.createElement('select');
  select.id = id;
  const opcionTodos = document.createElement('option');
  opcionTodos.value = '';
  opcionTodos.textContent = etiquetaTodos;
  select.appendChild(opcionTodos);
  opciones.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = valor;
    select.appendChild(opcion);
  });
  return select;
}

function reconstruirCamposFiltro(contenedor) {
  contenedor.innerHTML = '';
  const ticketInput = document.createElement('input');
  ticketInput.type = 'text';
  ticketInput.id = 'ruf-ticket';
  ticketInput.placeholder = 'Ticket';
  const desdeInput = document.createElement('input');
  desdeInput.type = 'date';
  desdeInput.id = 'ruf-desde';
  const hastaInput = document.createElement('input');
  hastaInput.type = 'date';
  hastaInput.id = 'ruf-hasta';
  contenedor.appendChild(ticketInput);
  contenedor.appendChild(desdeInput);
  contenedor.appendChild(hastaInput);

  if (moduloActivo === 'general') {
    contenedor.appendChild(crearSelectConOpciones('ruf-proveedor', obtenerProveedoresUnicos(), 'Todos los proveedores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-material', obtenerMaterialesUnicos(), 'Todos los materiales'));
    contenedor.appendChild(crearSelectConOpciones('ruf-cliente', obtenerClientesUnicos(), 'Todos los clientes'));
  } else {
    contenedor.appendChild(crearSelectConOpciones('ruf-operador', obtenerOperadoresUnicos(), 'Todos los operadores'));
    contenedor.appendChild(crearSelectConOpciones('ruf-turno', ['Matutino', 'Vespertino', 'Nocturno'], 'Todos los turnos'));
    contenedor.appendChild(crearSelectConOpciones('ruf-tipoproceso', Object.keys(window.EVE_CONTROL_PRODUCCION.PROCESOS), 'Todos los procesos'));
  }
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'ru-filtros';
  div.className = 'card destaraje-filtros';
  reconstruirCamposFiltro(div);
  return div;
}

function crearSelectorModulo() {
  const select = document.createElement('select');
  select.id = 'ru-modulo';
  [['general', 'Reporte General'], ['controlProduccion', 'Control de Producción']].forEach(([valor, texto]) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = texto;
    select.appendChild(opcion);
  });
  select.addEventListener('change', () => {
    moduloActivo = select.value;
    reconstruirCamposFiltro(document.getElementById('ru-filtros'));
  });
  return select;
}

function leerFiltrosComunes() {
  return {
    ticket: document.getElementById('ruf-ticket').value,
    desde: document.getElementById('ruf-desde').value,
    hasta: document.getElementById('ruf-hasta').value
  };
}

function leerFiltrosGeneral() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    proveedor: document.getElementById('ruf-proveedor').value,
    material: document.getElementById('ruf-material').value,
    cliente: document.getElementById('ruf-cliente').value
  };
}

function leerFiltrosControlProduccion() {
  const comunes = leerFiltrosComunes();
  return {
    ticket: comunes.ticket, desde: comunes.desde, hasta: comunes.hasta,
    operador: document.getElementById('ruf-operador').value,
    turno: document.getElementById('ruf-turno').value,
    tipoProceso: document.getElementById('ruf-tipoproceso').value
  };
}

function obtenerPeriodoActivo() {
  const comunes = leerFiltrosComunes();
  return {
    desde: comunes.desde,
    hasta: comunes.hasta,
    etiquetaReporte: 'PERSONALIZADO',
    etiquetaPeriodo: window.formatearPeriodo(comunes.desde || null, comunes.hasta || null)
  };
}

function obtenerDatosGeneralFiltrados(periodo) {
  const filtros = leerFiltrosGeneral();
  return window.obtenerDatosPeriodo(periodo.desde, periodo.hasta, {
    ticket: filtros.ticket,
    proveedor: filtros.proveedor,
    material: filtros.material,
    cliente: filtros.cliente
  });
}

function obtenerRegistrosControlProduccionFiltrados(periodo) {
  const filtros = leerFiltrosControlProduccion();
  return window.EVE.registrosControlProduccion.filter((r) => {
    const fechaFin = r.fechaFin.slice(0, 10);
    if (periodo.desde && fechaFin < periodo.desde) return false;
    if (periodo.hasta && fechaFin > periodo.hasta) return false;
    if (filtros.ticket && !String(r.ticket).toUpperCase().includes(filtros.ticket.toUpperCase())) return false;
    if (filtros.operador && r.operador !== filtros.operador) return false;
    if (filtros.turno && r.turno !== filtros.turno) return false;
    if (filtros.tipoProceso && r.tipoProceso !== filtros.tipoProceso) return false;
    return true;
  });
}

window.EVE_REPORTES_UI = {
  crearSelectorModulo,
  crearBarraFiltros,
  reconstruirCamposFiltro,
  leerFiltrosComunes,
  leerFiltrosGeneral,
  leerFiltrosControlProduccion,
  obtenerPeriodoActivo,
  obtenerDatosGeneralFiltrados,
  obtenerRegistrosControlProduccionFiltrados
};

function obtenerTextoYNombre(periodo, extension) {
  if (moduloActivo === 'general') {
    return {
      texto: window.generarTXT(obtenerDatosGeneralFiltrados(periodo), periodo),
      nombre: `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.${extension}`
    };
  }
  return {
    texto: window.generarTXTControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo), periodo),
    nombre: `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.${extension}`
  };
}

function mostrarVistaPrevia() {
  const periodo = obtenerPeriodoActivo();
  const { texto } = obtenerTextoYNombre(periodo, 'txt');
  document.getElementById('ru-preview-texto').textContent = texto;
  document.getElementById('ru-preview-card').style.display = '';
}

function ocultarVistaPrevia() {
  document.getElementById('ru-preview-card').style.display = 'none';
}

function manejarExportarTXT() {
  const periodo = obtenerPeriodoActivo();
  const { texto, nombre } = obtenerTextoYNombre(periodo, 'txt');
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, nombre);
}

function manejarExportarPDF() {
  const periodo = obtenerPeriodoActivo();
  let doc, nombre;
  if (moduloActivo === 'general') {
    doc = window.generarPDF(obtenerDatosGeneralFiltrados(periodo), periodo);
    nombre = `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`;
  } else {
    doc = window.generarPDFControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo), periodo);
    nombre = `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`;
  }
  doc.save(nombre);
}

function manejarExportarCSV() {
  const periodo = obtenerPeriodoActivo();
  let filas, nombre;
  if (moduloActivo === 'general') {
    filas = window.construirFilasCSV(obtenerDatosGeneralFiltrados(periodo));
    nombre = `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`;
  } else {
    filas = window.construirFilasCSVControlProduccion(obtenerRegistrosControlProduccionFiltrados(periodo));
    nombre = `Reporte_ControlProduccion_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`;
  }
  window.exportarCSV(filas, nombre);
}

function crearTarjetaVistaPrevia() {
  const tarjeta = document.createElement('div');
  tarjeta.id = 'ru-preview-card';
  tarjeta.className = 'card';
  tarjeta.style.display = 'none';
  tarjeta.innerHTML = `
    <pre id="ru-preview-texto"></pre>
    <button type="button" id="ru-cerrar-preview" class="btn-secondary">✕ Cerrar Vista Previa</button>
  `;
  tarjeta.querySelector('#ru-cerrar-preview').addEventListener('click', ocultarVistaPrevia);
  return tarjeta;
}

function crearBotonesAccion() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonVistaPrevia = document.createElement('button');
  botonVistaPrevia.type = 'button';
  botonVistaPrevia.textContent = '🔍 Vista Previa';
  botonVistaPrevia.className = 'btn-primary';
  botonVistaPrevia.addEventListener('click', mostrarVistaPrevia);
  const botonLimpiar = document.createElement('button');
  botonLimpiar.type = 'button';
  botonLimpiar.textContent = '🔄 Limpiar';
  botonLimpiar.className = 'btn-secondary';
  botonLimpiar.addEventListener('click', () => {
    reconstruirCamposFiltro(document.getElementById('ru-filtros'));
    ocultarVistaPrevia();
  });
  div.appendChild(botonVistaPrevia);
  div.appendChild(botonLimpiar);
  return div;
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const botonTXT = document.createElement('button');
  botonTXT.textContent = 'TXT';
  botonTXT.className = 'btn-secondary';
  botonTXT.addEventListener('click', manejarExportarTXT);
  const botonPDF = document.createElement('button');
  botonPDF.textContent = 'PDF';
  botonPDF.className = 'btn-secondary';
  botonPDF.addEventListener('click', manejarExportarPDF);
  const botonCSV = document.createElement('button');
  botonCSV.textContent = 'CSV';
  botonCSV.className = 'btn-secondary';
  botonCSV.addEventListener('click', manejarExportarCSV);
  div.appendChild(botonTXT);
  div.appendChild(botonPDF);
  div.appendChild(botonCSV);
  return div;
}

function renderReportesUI(container) {
  moduloActivo = 'general';
  container.appendChild(crearSelectorModulo());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearBotonesAccion());
  container.appendChild(crearTarjetaVistaPrevia());
  container.appendChild(crearBotonesExportar());
}

window.EVE_MODULES.reportes = { render: renderReportesUI };

Object.assign(window.EVE_REPORTES_UI, {
  mostrarVistaPrevia,
  ocultarVistaPrevia
});

})();
