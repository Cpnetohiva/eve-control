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

let recibosPagoActuales = [];

async function renderizarTablaRecibosPago(tbody, vacio) {
  tbody.innerHTML = '';
  const recibos = await cargarRecibosPago();
  recibosPagoActuales = recibos;
  actualizarVisibilidadBotonCapturaRecibosPago();
  if (recibos.length === 0) {
    vacio.style.display = '';
    return;
  }
  vacio.style.display = 'none';
  recibos.forEach((recibo) => tbody.appendChild(construirFilaRecibo(recibo)));
}

// ===== Vista para captura =====
// Usa los mismos recibos ya cargados en pantalla (recibosPagoActuales, llenado
// por renderizarTablaRecibosPago) — no se hace una consulta adicional.

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
