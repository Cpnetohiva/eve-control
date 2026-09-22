(function () {

// ── Filtros / stats ──────────────────────────────────────────────────────

function calcularStats(registros) {
  const vigentes = registros.filter((r) => !r.revertido);
  const totalCobrado = vigentes.reduce((suma, r) => suma + (Number(r.pagado) || 0), 0);
  return { totalRegistros: registros.length, totalCobrado };
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
  const folio = (filtros.folio || '').toLowerCase();
  const cliente = (filtros.cliente || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (folio && !String(r.folio).toLowerCase().includes(folio)) return false;
    if (cliente && !String(r.cliente).toLowerCase().includes(cliente)) return false;
    if (material && !String(r.material).toLowerCase().includes(material)) return false;
    if (!dentroDeRangoFecha(r.fecha, filtros.desde, filtros.hasta)) return false;
    return true;
  });
}

function cobroTieneVinculoActivo(grupoPagoId) {
  if (!grupoPagoId) return false;
  return window.EVE.cuentasPorCobrar.some((c) =>
    (c.abonos || []).some((a) => a.grupoPagoId === grupoPagoId)
  );
}

window.EVE_COBROS = {
  calcularStats,
  filtrarPorHoy,
  filtrarPorSemana,
  filtrarPorMes,
  aplicarFiltrosTodos,
  cobroTieneVinculoActivo
};

// ── UI ───────────────────────────────────────────────────────────────────

let tabActiva = 'hoy';
let filtros = { folio: '', desde: '', hasta: '', cliente: '', material: '' };

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

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
  div.id = 'cobros-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'cbf-folio', etiqueta: 'Folio', placeholder: 'Folio', tipo: 'text' },
    { id: 'cbf-desde', etiqueta: 'Desde', placeholder: '', tipo: 'date' },
    { id: 'cbf-hasta', etiqueta: 'Hasta', placeholder: '', tipo: 'date' },
    { id: 'cbf-cliente', etiqueta: 'Cliente', placeholder: 'Cliente', tipo: 'text' },
    { id: 'cbf-material', etiqueta: 'Material', placeholder: 'Material', tipo: 'text' }
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
        folio: document.getElementById('cbf-folio').value,
        desde: document.getElementById('cbf-desde').value,
        hasta: document.getElementById('cbf-hasta').value,
        cliente: document.getElementById('cbf-cliente').value,
        material: document.getElementById('cbf-material').value
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
      <tr><th data-tipo="texto">Folio</th><th data-tipo="texto">Cliente</th><th data-tipo="texto">Material</th><th data-tipo="numero">Kg</th><th data-tipo="moneda">Pagado</th><th data-tipo="moneda">IVA</th><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Referencia</th><th></th></tr>
    </thead>
    <tbody id="cobros-tabla"></tbody>
  `;
  window.activarOrdenamiento(tabla);
  wrapper.appendChild(tabla);
  return wrapper;
}

async function confirmarEliminarCobro(id) {
  const registro = window.EVE.cobros.find((r) => r.id === id);
  if (registro && cobroTieneVinculoActivo(registro.grupoPagoId)) {
    window.showError('Este cobro está vinculado a una cuenta por cobrar activa. Usa "Revertir" desde CxC en vez de "Eliminar" desde Cobros, para no dejar el otro lado huérfano sin trazabilidad.');
    return;
  }
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato('cobros', id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'cobros',
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: registro || null,
      valorNuevo: null,
      motivo
    });
    const indice = window.EVE.cobros.findIndex((r) => r.id === id);
    if (indice !== -1) window.EVE.cobros.splice(indice, 1);
    renderizarVista();
    window.showSuccess('Cobro eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const valores = [
    registro.folio, registro.cliente, registro.material,
    window.formatearKg(registro.cantidad, registro.material),
    window.formatearMoneda(registro.pagado),
    window.formatearMoneda(registro.iva || 0),
    registro.fecha,
    registro.referencia || ''
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
      : 'Este cobro fue revertido y no cuenta en los totales';
    celdaAcciones.appendChild(chip);
  } else if (window.puedeEscribir('ventas')) {
    const botonEliminar = document.createElement('button');
    botonEliminar.textContent = 'Eliminar';
    botonEliminar.className = 'btn-secondary';
    botonEliminar.addEventListener('click', () => confirmarEliminarCobro(registro.id));
    celdaAcciones.appendChild(botonEliminar);
  }
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(registros) {
  const tbody = document.getElementById('cobros-tabla');
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
  registros.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let registros = window.EVE.cobros || [];
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
  const stats = calcularStats(registros);
  const contenedor = document.getElementById('cobros-stats');
  contenedor.innerHTML = '';
  const partes = [
    `Registros: ${stats.totalRegistros}`,
    `Total Cobrado: ${window.formatearMoneda(stats.totalCobrado)}`
  ];
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function renderizarVista() {
  document.getElementById('cobros-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const registros = obtenerRegistrosParaTab();
  renderizarStats(registros);
  llenarTabla(registros);
}

function construirFilasCSVCobros(registros) {
  return registros.map((r) => ({
    'Folio': r.folio,
    'Cliente': r.cliente,
    'Material': r.material,
    'Kg': r.cantidad,
    'Pagado': r.pagado,
    'IVA': r.iva || 0,
    'Fecha': r.fecha,
    'Referencia': r.referencia || '',
    'Origen': r.origen || '',
    'Estado': r.revertido ? 'Revertido' : 'Activo'
  }));
}

function exportarCobrosCSV() {
  const registros = obtenerRegistrosParaTab();
  const fecha = window.obtenerFechaMexico();
  window.exportarCSV(construirFilasCSVCobros(registros), `cobros_${tabActiva}_${fecha}.csv`);
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const boton = document.createElement('button');
  boton.textContent = 'Exportar CSV';
  boton.className = 'btn-secondary';
  boton.addEventListener('click', () => exportarCobrosCSV());
  div.appendChild(boton);
  return div;
}

function crearStats() {
  const div = document.createElement('div');
  div.id = 'cobros-stats';
  div.className = 'card destaraje-stats';
  return div;
}

function renderCobros(container) {
  tabActiva = 'hoy';
  filtros = { folio: '', desde: '', hasta: '', cliente: '', material: '' };

  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearStats());
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla());

  renderizarVista();
}

window.EVE_MODULES.cobros = { render: renderCobros };

})();
