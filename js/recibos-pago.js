(function () {

function formatearFormaPago(recibo) {
  return recibo.formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo';
}

async function cargarRecibosPago() {
  const snapshot = await window.db.collection('recibos_pago').orderBy('fecha', 'desc').get();
  return window.unificarProveedorEnRegistros(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })));
}

function construirFilaRecibo(recibo) {
  const fila = document.createElement('tr');
  const celdaCheck = document.createElement('td');
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.className = 'rpg-check';
  check.checked = rpgSeleccion.has(recibo.id);
  check.setAttribute('aria-label', `Seleccionar recibo de ${recibo.proveedor}`);
  check.addEventListener('change', () => {
    if (check.checked) rpgSeleccion.add(recibo.id);
    else rpgSeleccion.delete(recibo.id);
    actualizarSeleccionRecibosPago();
  });
  celdaCheck.appendChild(check);
  fila.appendChild(celdaCheck);
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
// ids de los recibos marcados; siempre es un subconjunto de recibosPagoActuales (se limpia al cambiar filtros).
const rpgSeleccion = new Set();

// ===== Selección múltiple y resumen =====
// Todo se calcula en memoria sobre recibosPagoTodos / recibosPagoActuales: no hay lecturas nuevas a Firestore.

function recibosSeleccionadosRecibosPago() {
  return recibosPagoTodos.filter((recibo) => rpgSeleccion.has(recibo.id));
}

function sumarCentavosRecibosPago(recibos) {
  return recibos.reduce((suma, recibo) => suma + Math.round((Number(recibo.totalPago) || 0) * 100), 0) / 100;
}

function agruparRecibosPago(recibos, obtenerClave) {
  const mapa = new Map();
  recibos.forEach((recibo) => {
    const clave = obtenerClave(recibo);
    const grupo = mapa.get(clave) || { etiqueta: clave, cantidad: 0, centavos: 0 };
    grupo.cantidad += 1;
    grupo.centavos += Math.round((Number(recibo.totalPago) || 0) * 100);
    mapa.set(clave, grupo);
  });
  return Array.from(mapa.values())
    .sort((a, b) => b.centavos - a.centavos || a.etiqueta.localeCompare(b.etiqueta))
    .map((grupo) => ({ etiqueta: grupo.etiqueta, cantidad: grupo.cantidad, total: grupo.centavos / 100 }));
}

function construirResumenSeleccionRecibosPago(recibos) {
  const fechas = recibos.map((recibo) => recibo.fecha).filter(Boolean).sort();
  return {
    cantidad: recibos.length,
    total: sumarCentavosRecibosPago(recibos),
    desde: fechas[0] || '',
    hasta: fechas[fechas.length - 1] || '',
    proveedores: agruparRecibosPago(recibos, (recibo) => recibo.proveedor || 'Sin proveedor'),
    formasPago: agruparRecibosPago(recibos, formatearFormaPago)
  };
}

function actualizarSeleccionRecibosPago() {
  const seleccionados = recibosSeleccionadosRecibosPago();
  const barra = document.getElementById('rpg-barra-seleccion');
  if (barra) {
    barra.style.display = seleccionados.length > 0 ? '' : 'none';
    const texto = barra.querySelector('#rpg-seleccion-texto');
    if (texto) {
      texto.textContent = `${seleccionados.length} recibo${seleccionados.length === 1 ? '' : 's'} seleccionado${seleccionados.length === 1 ? '' : 's'} · Total: ${window.formatearMoneda(sumarCentavosRecibosPago(seleccionados))}`;
    }
  }
  const todos = document.getElementById('rpg-check-todos');
  if (todos) {
    const visiblesMarcados = recibosPagoActuales.filter((recibo) => rpgSeleccion.has(recibo.id)).length;
    todos.checked = recibosPagoActuales.length > 0 && visiblesMarcados === recibosPagoActuales.length;
    todos.indeterminate = visiblesMarcados > 0 && visiblesMarcados < recibosPagoActuales.length;
  }
}

function alternarTodosRecibosPago(marcar) {
  recibosPagoActuales.forEach((recibo) => {
    if (marcar) rpgSeleccion.add(recibo.id);
    else rpgSeleccion.delete(recibo.id);
  });
  if (rpgTbodyActual) {
    rpgTbodyActual.querySelectorAll('input.rpg-check').forEach((check) => { check.checked = marcar; });
  }
  actualizarSeleccionRecibosPago();
}

function crearBarraSeleccionRecibosPago() {
  const barra = document.createElement('div');
  barra.id = 'rpg-barra-seleccion';
  barra.className = 'card rpg-barra-seleccion';
  barra.style.display = 'none';
  const texto = document.createElement('span');
  texto.id = 'rpg-seleccion-texto';
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.id = 'rpg-btn-ver-resumen';
  boton.className = 'btn-primary';
  boton.textContent = 'Ver resumen';
  boton.addEventListener('click', abrirResumenSeleccionRecibosPago);
  barra.appendChild(texto);
  barra.appendChild(boton);
  return barra;
}

function etiquetaPeriodoResumenRecibosPago(resumen) {
  return construirEtiquetaDiaORangoRecibosPago(resumen.desde, resumen.hasta);
}

function construirTablaResumenRecibosPago(id, titulo, etiquetaPrimera, filas) {
  const seccion = document.createElement('div');
  const encabezado = document.createElement('h4');
  encabezado.textContent = titulo;
  const tabla = document.createElement('table');
  tabla.id = id;
  tabla.className = 'tabla-destaraje';
  const thead = document.createElement('thead');
  const filaHead = document.createElement('tr');
  [etiquetaPrimera, 'Recibos', 'Total pagado'].forEach((texto, i) => {
    const th = document.createElement('th');
    th.textContent = texto;
    if (i > 0) th.style.textAlign = 'right';
    filaHead.appendChild(th);
  });
  thead.appendChild(filaHead);
  const tbody = document.createElement('tbody');
  filas.forEach((fila) => {
    const tr = document.createElement('tr');
    [fila.etiqueta, String(fila.cantidad), window.formatearMoneda(fila.total)].forEach((texto, i) => {
      const td = document.createElement('td');
      td.textContent = texto;
      if (i > 0) td.style.textAlign = 'right';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  tabla.appendChild(thead);
  tabla.appendChild(tbody);
  seccion.appendChild(encabezado);
  seccion.appendChild(tabla);
  return seccion;
}

function cerrarResumenSeleccionRecibosPago() {
  const overlay = document.getElementById('rpg-resumen-overlay');
  if (overlay) overlay.remove();
}

function abrirResumenSeleccionRecibosPago() {
  const resumen = construirResumenSeleccionRecibosPago(recibosSeleccionadosRecibosPago());
  if (resumen.cantidad === 0) return;
  cerrarResumenSeleccionRecibosPago();

  const overlay = document.createElement('div');
  overlay.id = 'rpg-resumen-overlay';
  overlay.className = 'modal-overlay open';
  const modal = document.createElement('div');
  modal.className = 'modal modal-ancho';

  const titulo = document.createElement('h3');
  titulo.textContent = 'Resumen de recibos de pago';
  const periodo = document.createElement('p');
  periodo.id = 'rpg-resumen-periodo';
  periodo.textContent = `${etiquetaPeriodoResumenRecibosPago(resumen)} · ${resumen.cantidad} recibo${resumen.cantidad === 1 ? '' : 's'}`;

  const granTotal = document.createElement('div');
  granTotal.id = 'rpg-resumen-gran-total';
  granTotal.className = 'rpg-gran-total';
  const etiquetaTotal = document.createElement('span');
  etiquetaTotal.textContent = 'GRAN TOTAL';
  const montoTotal = document.createElement('strong');
  montoTotal.textContent = window.formatearMoneda(resumen.total);
  granTotal.appendChild(etiquetaTotal);
  granTotal.appendChild(document.createTextNode(' '));
  granTotal.appendChild(montoTotal);

  const acciones = document.createElement('div');
  acciones.className = 'rpg-resumen-acciones';
  [
    { id: 'rpg-resumen-imprimir', texto: 'Imprimir', clase: 'btn-secondary', accion: () => imprimirResumenRecibosPago(resumen) },
    { id: 'rpg-resumen-pdf', texto: 'Descargar PDF', clase: 'btn-primary', accion: () => descargarPDFResumenRecibosPago(resumen) },
    { id: 'rpg-resumen-cerrar', texto: 'Cerrar', clase: 'btn-secondary', accion: cerrarResumenSeleccionRecibosPago }
  ].forEach((def) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.id = def.id;
    boton.className = def.clase;
    boton.textContent = def.texto;
    boton.addEventListener('click', def.accion);
    acciones.appendChild(boton);
  });

  modal.appendChild(titulo);
  modal.appendChild(periodo);
  modal.appendChild(construirTablaResumenRecibosPago('rpg-resumen-proveedores', 'Total por proveedor', 'Proveedor', resumen.proveedores));
  modal.appendChild(construirTablaResumenRecibosPago('rpg-resumen-formas', 'Desglose por forma de pago', 'Forma de pago', resumen.formasPago));
  modal.appendChild(granTotal);
  modal.appendChild(acciones);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (evento) => { if (evento.target === overlay) cerrarResumenSeleccionRecibosPago(); });
  document.body.appendChild(overlay);
}

function escaparHtmlRecibosPago(texto) {
  return String(texto).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function construirHtmlImpresionRecibosPago(resumen) {
  const filas = (grupos) => grupos.map((g) => `<tr><td>${escaparHtmlRecibosPago(g.etiqueta)}</td><td class="num">${g.cantidad}</td><td class="num">${escaparHtmlRecibosPago(window.formatearMoneda(g.total))}</td></tr>`).join('');
  const tabla = (titulo, primera, grupos) => `<h2>${titulo}</h2><table><thead><tr><th>${primera}</th><th class="num">Recibos</th><th class="num">Total pagado</th></tr></thead><tbody>${filas(grupos)}</tbody></table>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Resumen de recibos de pago</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#001D3D;margin:24px}
    h1{text-align:center;font-size:20px;margin:0 0 4px}
    h2{font-size:14px;margin:18px 0 6px}
    p.periodo{text-align:center;margin:0 0 12px;color:#666}
    table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#001D3D;color:#fff;text-align:left;padding:6px}
    td{padding:6px;border-bottom:1px solid #ddd}
    .num{text-align:right}
    .gran-total{margin-top:18px;padding:10px 12px;border:2px solid #001D3D;font-size:16px;font-weight:bold;display:flex;justify-content:space-between}
  </style></head><body>
    <h1>RESUMEN DE RECIBOS DE PAGO</h1>
    <p class="periodo">${escaparHtmlRecibosPago(etiquetaPeriodoResumenRecibosPago(resumen))} · ${resumen.cantidad} recibo${resumen.cantidad === 1 ? '' : 's'}</p>
    ${tabla('Total por proveedor', 'Proveedor', resumen.proveedores)}
    ${tabla('Desglose por forma de pago', 'Forma de pago', resumen.formasPago)}
    <div class="gran-total"><span>GRAN TOTAL</span><span>${escaparHtmlRecibosPago(window.formatearMoneda(resumen.total))}</span></div>
  </body></html>`;
}

// Imprime desde un iframe oculto (no un popup, que el navegador puede bloquear).
function imprimirResumenRecibosPago(resumen) {
  const marco = document.createElement('iframe');
  marco.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  marco.setAttribute('aria-hidden', 'true');
  marco.srcdoc = construirHtmlImpresionRecibosPago(resumen);
  marco.addEventListener('load', () => {
    marco.contentWindow.focus();
    marco.contentWindow.print();
    setTimeout(() => marco.remove(), 60000);
  });
  document.body.appendChild(marco);
}

function descargarPDFResumenRecibosPago(resumen) {
  if (!window.jspdf || !window.EVE_CXP || !window.EVE_CXP.iniciarPDFConTitulo) {
    window.showError('No se pudo generar el PDF: faltan las librerías de PDF');
    return;
  }
  const inicio = window.EVE_CXP.iniciarPDFConTitulo('RESUMEN DE RECIBOS DE PAGO');
  const pdf = inicio.pdf;
  let y = inicio.y;
  pdf.text(`${etiquetaPeriodoResumenRecibosPago(resumen)} · ${resumen.cantidad} recibo${resumen.cantidad === 1 ? '' : 's'}`, 14, y);
  y += 8;

  const cuerpo = (grupos) => grupos.map((g) => [g.etiqueta, String(g.cantidad), window.formatearMoneda(g.total)]);
  const estiloTabla = (primera, grupos) => ({
    startY: y,
    head: [[primera, 'Recibos', 'Total pagado']],
    body: cuerpo(grupos),
    headStyles: { fillColor: window.EVE_CXP.COLOR_MARCA_PDF },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } }
  });
  pdf.autoTable(estiloTabla('Proveedor', resumen.proveedores));
  y = pdf.lastAutoTable.finalY + 8;
  pdf.autoTable(estiloTabla('Forma de pago', resumen.formasPago));
  y = pdf.lastAutoTable.finalY + 12;

  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.text(`GRAN TOTAL: ${window.formatearMoneda(resumen.total)}`, 14, y);

  const sufijo = resumen.desde && resumen.hasta && resumen.desde !== resumen.hasta ? `${resumen.desde}_${resumen.hasta}` : (resumen.desde || resumen.hasta);
  pdf.save(`recibos-pago-resumen_${sufijo}.pdf`);
}

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
  rpgSeleccion.clear();
  actualizarContadorRecibosPago(recibosPagoActuales.length);
  actualizarVisibilidadBotonCapturaRecibosPago();
  if (rpgTbodyActual && rpgVacioActual) {
    llenarTablaRecibosPago(rpgTbodyActual, rpgVacioActual, recibosPagoActuales);
  }
  actualizarSeleccionRecibosPago();
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
  rpgSeleccion.clear();
  cerrarResumenSeleccionRecibosPago();
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.innerHTML = `
    <h3>Recibos de Pago</h3>
    <p id="rpg-vacio" style="display:none">Sin recibos de pago registrados</p>
    <table class="tabla-destaraje">
      <thead>
        <tr><th><input type="checkbox" id="rpg-check-todos" aria-label="Seleccionar todos los recibos visibles"></th><th data-tipo="texto">Proveedor</th><th data-tipo="moneda">Monto</th><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Forma de pago</th><th></th></tr>
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
  wrapper.insertBefore(crearBarraSeleccionRecibosPago(), wrapper.querySelector('table'));
  wrapper.querySelector('#rpg-check-todos').addEventListener('change', (evento) => alternarTodosRecibosPago(evento.target.checked));
  container.appendChild(wrapper);

  const tbody = wrapper.querySelector('#rpg-tabla');
  const vacio = wrapper.querySelector('#rpg-vacio');
  window.activarOrdenamiento(wrapper.querySelector('table'));
  renderizarTablaRecibosPago(tbody, vacio).catch((error) => window.showError(error.message));
}

window.EVE_MODULES.recibosPago = { render: renderRecibosPago };
window.EVE_RECIBOS_PAGO = { construirResumenSeleccionRecibosPago };

})();
