(function () {

function formatearFormaPago(recibo) {
  return recibo.formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo';
}

async function cargarRecibosPago() {
  const snapshot = await window.db.collection('recibos_pago').orderBy('fecha', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function construirFilaRecibo(recibo) {
  const fila = document.createElement('tr');
  [recibo.proveedor, window.formatearMoneda(recibo.totalPago), window.formatearFecha(recibo.fecha), formatearFormaPago(recibo)]
    .forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });

  const celdaAccion = document.createElement('td');
  const boton = document.createElement('button');
  boton.className = 'btn-secondary';
  boton.textContent = 'Descargar PDF';
  boton.addEventListener('click', () => {
    window.EVE_CXP.generarPDFRecibo(recibo, true);
  });
  celdaAccion.appendChild(boton);
  fila.appendChild(celdaAccion);
  return fila;
}

let recibosPagoTodos = [];
let recibosPagoActuales = [];
let filtrosRecibosPago = { desde: '', hasta: '', proveedor: '' };
let rpgTbodyActual = null;
let rpgVacioActual = null;

// ===== Filtros (Fecha y Proveedor) =====
// Se aplican en memoria sobre recibosPagoTodos (ya cargado por
// cargarRecibosPago), sin ninguna consulta nueva.

function aplicarFiltrosRecibosPago(recibos, filtros) {
  return recibos.filter((recibo) => {
    if (filtros.desde && recibo.fecha < filtros.desde) return false;
    if (filtros.hasta && recibo.fecha > filtros.hasta) return false;
    if (filtros.proveedor && recibo.proveedor !== filtros.proveedor) return false;
    return true;
  });
}

function llenarSelectProveedoresRecibos(recibos) {
  const select = document.getElementById('rpg-filtro-proveedor');
  if (!select) return;
  const proveedorActual = select.value;
  const proveedores = Array.from(new Set(recibos.map((r) => r.proveedor).filter(Boolean))).sort();
  select.innerHTML = '';
  const opcionTodos = document.createElement('option');
  opcionTodos.value = '';
  opcionTodos.textContent = 'Todos';
  select.appendChild(opcionTodos);
  proveedores.forEach((proveedor) => {
    const opcion = document.createElement('option');
    opcion.value = proveedor;
    opcion.textContent = proveedor;
    select.appendChild(opcion);
  });
  select.value = proveedores.includes(proveedorActual) ? proveedorActual : '';
}

function actualizarContadorRecibosPago(cantidad) {
  const contador = document.getElementById('rpg-contador');
  if (contador) contador.textContent = `${cantidad} resultado${cantidad === 1 ? '' : 's'}`;
}

function renderizarListaFiltradaRecibosPago() {
  recibosPagoActuales = aplicarFiltrosRecibosPago(recibosPagoTodos, filtrosRecibosPago);
  actualizarContadorRecibosPago(recibosPagoActuales.length);
  actualizarVisibilidadBotonCapturaRecibosPago();
  if (rpgTbodyActual && rpgVacioActual) {
    llenarTablaRecibosPago(rpgTbodyActual, rpgVacioActual, recibosPagoActuales);
  }
}

function actualizarFiltrosRecibosPago() {
  const desde = document.getElementById('rpg-filtro-desde').value;
  const hasta = document.getElementById('rpg-filtro-hasta').value;
  if (desde && hasta && desde > hasta) {
    window.showError('"Desde" debe ser menor o igual a "Hasta"');
    return;
  }
  filtrosRecibosPago = {
    desde,
    hasta,
    proveedor: document.getElementById('rpg-filtro-proveedor').value
  };
  renderizarListaFiltradaRecibosPago();
}

function limpiarFiltrosRecibosPago() {
  filtrosRecibosPago = { desde: '', hasta: '', proveedor: '' };
  document.getElementById('rpg-filtro-desde').value = '';
  document.getElementById('rpg-filtro-hasta').value = '';
  document.getElementById('rpg-filtro-proveedor').value = '';
  renderizarListaFiltradaRecibosPago();
}

function crearBarraFiltrosRecibosPago() {
  const div = document.createElement('div');
  div.id = 'rpg-filtros';
  div.className = 'card destaraje-filtros';

  const campoDesde = document.createElement('label');
  campoDesde.className = 'filtro-campo';
  campoDesde.innerHTML = '<span>Desde</span>';
  const inputDesde = document.createElement('input');
  inputDesde.type = 'date';
  inputDesde.id = 'rpg-filtro-desde';
  campoDesde.appendChild(inputDesde);

  const campoHasta = document.createElement('label');
  campoHasta.className = 'filtro-campo';
  campoHasta.innerHTML = '<span>Hasta</span>';
  const inputHasta = document.createElement('input');
  inputHasta.type = 'date';
  inputHasta.id = 'rpg-filtro-hasta';
  campoHasta.appendChild(inputHasta);

  const campoProveedor = document.createElement('label');
  campoProveedor.className = 'filtro-campo';
  campoProveedor.innerHTML = '<span>Proveedor</span>';
  const selectProveedor = document.createElement('select');
  selectProveedor.id = 'rpg-filtro-proveedor';
  campoProveedor.appendChild(selectProveedor);

  const btnLimpiar = document.createElement('button');
  btnLimpiar.type = 'button';
  btnLimpiar.className = 'btn-secondary';
  btnLimpiar.textContent = 'Limpiar filtros';
  btnLimpiar.addEventListener('click', limpiarFiltrosRecibosPago);

  const contador = document.createElement('span');
  contador.id = 'rpg-contador';
  contador.style.alignSelf = 'center';

  [inputDesde, inputHasta].forEach((input) => input.addEventListener('change', actualizarFiltrosRecibosPago));
  selectProveedor.addEventListener('change', actualizarFiltrosRecibosPago);

  div.appendChild(campoDesde);
  div.appendChild(campoHasta);
  div.appendChild(campoProveedor);
  div.appendChild(btnLimpiar);
  div.appendChild(contador);
  return div;
}

function llenarTablaRecibosPago(tbody, vacio, recibos) {
  tbody.innerHTML = '';
  if (recibos.length === 0) {
    vacio.style.display = '';
    return;
  }
  vacio.style.display = 'none';
  recibos.forEach((recibo) => tbody.appendChild(construirFilaRecibo(recibo)));
}

async function renderizarTablaRecibosPago(tbody, vacio) {
  rpgTbodyActual = tbody;
  rpgVacioActual = vacio;
  tbody.innerHTML = '';
  const recibos = await cargarRecibosPago();
  recibosPagoTodos = recibos;
  llenarSelectProveedoresRecibos(recibos);
  renderizarListaFiltradaRecibosPago();
}

// ===== Vista para captura =====
// Usa recibosPagoActuales (el subconjunto ya filtrado en pantalla por fecha
// y proveedor, llenado por renderizarListaFiltradaRecibosPago) — no se hace
// una consulta ni un filtrado adicional.

// 'Día dd/mm/aaaa' si es una sola fecha (desde === hasta, o solo una de las
// dos viene llena), 'Del dd/mm/aaaa al dd/mm/aaaa' si es un rango real.
function construirEtiquetaDiaORangoRecibosPago(desde, hasta) {
  if (desde && hasta && desde !== hasta) {
    return `Del ${window.formatearFecha(desde)} al ${window.formatearFecha(hasta)}`;
  }
  const fecha = desde || hasta;
  return fecha ? `Día ${window.formatearFecha(fecha)}` : '';
}

function construirPeriodoCapturaRecibosPago(filtros) {
  const partes = [];
  if (filtros.desde || filtros.hasta) {
    partes.push(construirEtiquetaDiaORangoRecibosPago(filtros.desde, filtros.hasta));
  }
  if (filtros.proveedor) {
    partes.push(`Proveedor: ${filtros.proveedor}`);
  }
  return partes.length > 0 ? partes.join(' · ') : undefined;
}

const COLUMNAS_CAPTURA_RECIBOS_PAGO = [
  { clave: 'fecha', etiqueta: 'Fecha', ancho: '20%', truncar: true, formato: (valor) => window.formatearFecha(valor) },
  { clave: 'proveedor', etiqueta: 'Proveedor', ancho: '38%', truncar: false },
  { clave: 'formaPago', etiqueta: 'Forma de pago', ancho: '20%', truncar: true, formato: (valor, fila) => formatearFormaPago(fila) },
  {
    clave: 'totalPago', etiqueta: 'Monto', ancho: '22%', alineacion: 'right', truncar: true,
    formato: (valor) => window.formatearMoneda(valor)
  }
];

function construirResumenProveedorCapturaRecibosPago(recibos) {
  const mapa = new Map();
  recibos.forEach((recibo) => {
    mapa.set(recibo.proveedor, (mapa.get(recibo.proveedor) || 0) + (Number(recibo.totalPago) || 0));
  });
  return Array.from(mapa.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([proveedor, total]) => ({ label: proveedor, valor: window.formatearMoneda(total) }));
}

function construirResumenFormaPagoCapturaRecibosPago(recibos) {
  const mapa = new Map();
  recibos.forEach((recibo) => {
    const etiqueta = formatearFormaPago(recibo);
    mapa.set(etiqueta, (mapa.get(etiqueta) || 0) + (Number(recibo.totalPago) || 0));
  });
  return Array.from(mapa.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([forma, total]) => ({ label: forma, valor: window.formatearMoneda(total) }));
}

function abrirVistaCapturaRecibosPago() {
  const recibos = recibosPagoActuales;
  const hayRecibos = recibos.length > 0;
  const totalGeneral = recibos.reduce((suma, r) => suma + (Number(r.totalPago) || 0), 0);
  const sinTabla = recibos.length > 60;

  window.VistaCaptura.abrir({
    titulo: 'Recibos de Pago',
    periodo: construirPeriodoCapturaRecibosPago(filtrosRecibosPago),
    kpis: hayRecibos ? [
      { label: 'Recibos', valor: recibos.length.toLocaleString('es-MX') },
      { label: 'Total', valor: window.formatearMoneda(totalGeneral) }
    ] : undefined,
    resumenSecciones: hayRecibos ? [
      { titulo: 'Total por proveedor', filas: construirResumenProveedorCapturaRecibosPago(recibos), etiquetaLabel: 'Proveedor', etiquetaValor: 'Total' },
      { titulo: 'Desglose por forma de pago', filas: construirResumenFormaPagoCapturaRecibosPago(recibos), etiquetaLabel: 'Forma de pago', etiquetaValor: 'Total' }
    ] : undefined,
    columnas: COLUMNAS_CAPTURA_RECIBOS_PAGO,
    filas: (hayRecibos && !sinTabla) ? recibos : undefined,
    sinTabla: hayRecibos && sinTabla,
    notaSinTabla: 'Lista completa disponible en pantalla',
    vacioMensaje: 'Sin recibos de pago registrados'
  });
}

function actualizarVisibilidadBotonCapturaRecibosPago() {
  const boton = document.getElementById('btn-vista-captura-recibos-pago');
  if (!boton) return;
  boton.style.display = recibosPagoActuales.length > 0 ? '' : 'none';
}

function renderRecibosPago(container) {
  filtrosRecibosPago = { desde: '', hasta: '', proveedor: '' };
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.innerHTML = `
    <h3>Recibos de Pago</h3>
    <p id="rpg-vacio" style="display:none">Sin recibos de pago registrados</p>
    <table class="tabla-destaraje">
      <thead>
        <tr><th data-tipo="texto">Proveedor</th><th data-tipo="moneda">Monto</th><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Forma de pago</th><th></th></tr>
      </thead>
      <tbody id="rpg-tabla"></tbody>
    </table>
  `;
  wrapper.insertBefore(crearBarraFiltrosRecibosPago(), wrapper.querySelector('table'));
  const botonCaptura = document.createElement('button');
  botonCaptura.id = 'btn-vista-captura-recibos-pago';
  botonCaptura.textContent = 'Vista para captura';
  botonCaptura.className = 'btn-secondary';
  botonCaptura.style.display = 'none';
  botonCaptura.addEventListener('click', abrirVistaCapturaRecibosPago);
  wrapper.insertBefore(botonCaptura, wrapper.querySelector('table'));
  container.appendChild(wrapper);

  const tbody = wrapper.querySelector('#rpg-tabla');
  const vacio = wrapper.querySelector('#rpg-vacio');
  window.activarOrdenamiento(wrapper.querySelector('table'));
  renderizarTablaRecibosPago(tbody, vacio).catch((error) => window.showError(error.message));
}

window.EVE_MODULES.recibosPago = { render: renderRecibosPago };

})();
