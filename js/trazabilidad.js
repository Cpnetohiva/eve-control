(function () {

function construirNodoProceso(registro) {
  return {
    tipo: 'proceso',
    ticket: registro.ticket,
    tipoProceso: registro.tipoProceso,
    kg: Number(registro.outputs.principal.kg) || 0,
    merma: Number(registro.outputs.merma.kg) || 0,
    eficiencia: Number(registro.eficiencia) || 0
  };
}

function construirNodoEntrada(ticket, registrosDestaraje) {
  const entrada = registrosDestaraje.find((r) => String(r.ticket) === String(ticket));
  if (entrada) {
    return { tipo: 'entrada', ticket, material: entrada.material, kg: Number(entrada.kg) || 0, identificada: true };
  }
  return { tipo: 'entrada', ticket, material: null, kg: 0, identificada: false };
}

function buscarProcesoPorTicket(ticket, registrosControlProduccion) {
  return registrosControlProduccion.find((r) => r.ticket === ticket) || null;
}

function ventasNuevasPorTicket(ticket, ventasNuevas) {
  const resultado = [];
  (ventasNuevas || []).forEach((v) => {
    const tickets = v.ticketsOrigen || [];
    if (!tickets.some((t) => String(t) === String(ticket))) return;
    (v.lineas || []).forEach((l, idx) => {
      resultado.push({
        tipo: 'venta',
        id: `${v.id || v.folio}-${idx}`,
        ticket,
        folio: v.folio,
        cliente: v.cliente,
        material: l.material,
        kg: Number(l.cantidad) || 0,
        precioUnitario: Number(l.precioUnitario) || 0,
        subtotal: Number(l.subtotal) || 0
      });
    });
  });
  return resultado;
}

function recolectarAlcanzables(ticketInicial, datos) {
  const entradas = new Map();
  const procesos = new Map();
  const terminales = new Map();

  function explorarAtras(ticket, visitados) {
    if (visitados.has(ticket)) return;
    visitados.add(ticket);
    const proceso = buscarProcesoPorTicket(ticket, datos.registrosControlProduccion);
    if (!proceso) {
      if (!entradas.has(ticket)) {
        entradas.set(ticket, construirNodoEntrada(ticket, datos.registrosDestaraje));
      }
      return;
    }
    if (!procesos.has(ticket)) {
      procesos.set(ticket, construirNodoProceso(proceso));
    }
    proceso.inputs.forEach((input) => explorarAtras(input.ticketOrigen, visitados));
  }

  function explorarAdelante(ticket, visitados) {
    if (visitados.has(ticket)) return;
    visitados.add(ticket);
    const ventasLegacy = datos.registrosVentas.filter((r) => r.ticketOrigen === ticket);
    const ventasNuevas = ventasNuevasPorTicket(ticket, datos.ventas);
    const siguientes = datos.registrosControlProduccion.filter((r) =>
      r.inputs.some((input) => input.ticketOrigen === ticket)
    );
    ventasLegacy.forEach((v) => {
      terminales.set(`venta-legacy:${v.id}`, { tipo: 'venta', id: v.id, ticket: v.ticket, proveedor: v.proveedor, material: v.material, kg: Number(v.kg) || 0, subtotal: 0 });
    });
    ventasNuevas.forEach((v) => {
      terminales.set(`venta-nueva:${v.id}`, v);
    });
    if (ventasLegacy.length === 0 && ventasNuevas.length === 0 && siguientes.length === 0) {
      const nodo = procesos.get(ticket);
      if (nodo) terminales.set(`proceso-final:${ticket}`, nodo);
    }
    siguientes.forEach((p) => {
      if (!procesos.has(p.ticket)) {
        procesos.set(p.ticket, construirNodoProceso(p));
      }
      explorarAdelante(p.ticket, visitados);
    });
  }

  const procesoInicial = buscarProcesoPorTicket(ticketInicial, datos.registrosControlProduccion);
  if (procesoInicial && !procesos.has(ticketInicial)) {
    procesos.set(ticketInicial, construirNodoProceso(procesoInicial));
  }
  explorarAtras(ticketInicial, new Set());
  explorarAdelante(ticketInicial, new Set());

  return { entradas, procesos, terminales };
}

function calcularResumenGlobal(alcanzables, datos) {
  let kgEntrada = 0;
  alcanzables.entradas.forEach((nodo) => { kgEntrada += nodo.kg; });

  let kgSalida = 0;
  let ingresoGenerado = 0;
  alcanzables.terminales.forEach((nodo) => {
    if (nodo.tipo !== 'venta') return;
    kgSalida += nodo.kg;
    ingresoGenerado += Number(nodo.subtotal) || 0;
  });

  let mermaTotal = 0;
  alcanzables.procesos.forEach((nodo) => { mermaTotal += nodo.merma; });

  const kgPendiente = Math.max(0, kgEntrada - kgSalida - mermaTotal);
  const eficienciaGlobal = kgEntrada > 0 ? (kgSalida / kgEntrada) * 100 : 0;

  let costoMaterial = 0;
  alcanzables.entradas.forEach((nodo) => {
    const cxp = (datos && datos.cuentasPorPagar || []).find((c) => String(c.ticket) === String(nodo.ticket));
    if (cxp) costoMaterial += Number(cxp.total) || 0;
  });
  const margen = ingresoGenerado - costoMaterial;

  return { kgEntrada, kgSalida, mermaTotal, kgPendiente, eficienciaGlobal, ingresoGenerado, costoMaterial, margen };
}

function construirArbolHaciaAtras(ticket, datos, visitados) {
  if (visitados.has(ticket)) return null;
  const proceso = buscarProcesoPorTicket(ticket, datos.registrosControlProduccion);
  if (!proceso) {
    return { nodo: construirNodoEntrada(ticket, datos.registrosDestaraje), origenes: [], destinos: [] };
  }
  const nuevosVisitados = new Set(visitados);
  nuevosVisitados.add(ticket);
  const origenes = proceso.inputs
    .map((input) => construirArbolHaciaAtras(input.ticketOrigen, datos, nuevosVisitados))
    .filter(Boolean);
  return { nodo: construirNodoProceso(proceso), origenes, destinos: [] };
}

function construirArbolHaciaAdelante(ticket, datos, visitados) {
  if (visitados.has(ticket)) return [];
  const nuevosVisitados = new Set(visitados);
  nuevosVisitados.add(ticket);
  const ventasLegacy = datos.registrosVentas.filter((r) => r.ticketOrigen === ticket);
  const ventasNuevas = ventasNuevasPorTicket(ticket, datos.ventas);
  const siguientes = datos.registrosControlProduccion.filter((r) =>
    r.inputs.some((input) => input.ticketOrigen === ticket)
  );
  const nodosVentaLegacy = ventasLegacy.map((v) => ({
    nodo: { tipo: 'venta', id: v.id, ticket: v.ticket, proveedor: v.proveedor, material: v.material, kg: Number(v.kg) || 0, subtotal: 0 },
    origenes: [],
    destinos: []
  }));
  const nodosVentaNueva = ventasNuevas.map((v) => ({ nodo: v, origenes: [], destinos: [] }));
  const nodosProceso = siguientes.map((p) => ({
    nodo: construirNodoProceso(p),
    origenes: [],
    destinos: construirArbolHaciaAdelante(p.ticket, datos, nuevosVisitados)
  }));
  return [...nodosVentaLegacy, ...nodosVentaNueva, ...nodosProceso];
}

function construirCadena(ticketBuscado, datos) {
  const proceso = buscarProcesoPorTicket(ticketBuscado, datos.registrosControlProduccion);
  const entrada = datos.registrosDestaraje.find((r) => String(r.ticket) === String(ticketBuscado));
  if (!proceso && !entrada) {
    return { encontrado: false, arbol: null, resumen: null };
  }
  let arbol;
  if (proceso) {
    const origenes = proceso.inputs
      .map((input) => construirArbolHaciaAtras(input.ticketOrigen, datos, new Set([ticketBuscado])))
      .filter(Boolean);
    const destinos = construirArbolHaciaAdelante(ticketBuscado, datos, new Set());
    arbol = { nodo: construirNodoProceso(proceso), origenes, destinos };
  } else {
    const destinos = construirArbolHaciaAdelante(ticketBuscado, datos, new Set());
    arbol = { nodo: construirNodoEntrada(ticketBuscado, datos.registrosDestaraje), origenes: [], destinos };
  }
  const alcanzables = recolectarAlcanzables(ticketBuscado, datos);
  const resumen = calcularResumenGlobal(alcanzables, datos);
  return { encontrado: true, arbol, resumen };
}

function normalizar(valor) {
  return String(valor || '').toLowerCase();
}

function buscarTicketsPorCriterio(criterio, valorBuscado, datos) {
  const valor = normalizar(valorBuscado);
  if (!valor) return [];
  const tickets = new Set();
  if (criterio === 'ticket') {
    tickets.add(String(valorBuscado).trim());
  } else if (criterio === 'proveedor') {
    datos.registrosDestaraje
      .filter((r) => normalizar(r.proveedor).includes(valor))
      .forEach((r) => tickets.add(String(r.ticket)));
  } else if (criterio === 'material') {
    datos.registrosDestaraje
      .filter((r) => normalizar(r.material).includes(valor))
      .forEach((r) => tickets.add(String(r.ticket)));
  } else if (criterio === 'proceso') {
    datos.registrosControlProduccion
      .filter((r) => normalizar(r.tipoProceso).includes(valor))
      .forEach((r) => tickets.add(String(r.ticket)));
  } else if (criterio === 'folio') {
    (datos.ventas || [])
      .filter((v) => normalizar(v.folio).includes(valor))
      .forEach((v) => (v.ticketsOrigen || []).forEach((t) => tickets.add(String(t))));
  }
  return Array.from(tickets);
}

window.EVE_TRAZABILIDAD = {
  construirNodoProceso,
  construirNodoEntrada,
  buscarProcesoPorTicket,
  ventasNuevasPorTicket,
  recolectarAlcanzables,
  calcularResumenGlobal,
  construirArbolHaciaAtras,
  construirArbolHaciaAdelante,
  construirCadena,
  buscarTicketsPorCriterio
};

function colorEficienciaLocal(eficiencia) {
  if (eficiencia >= 90) return 'verde';
  if (eficiencia >= 80) return 'naranja';
  return 'rojo';
}

function crearNodoArbolDOM(nodoArbol, esRaiz) {
  const contenedor = document.createElement('div');
  contenedor.className = 'cp-trz-nodo' + (esRaiz ? ' cp-trz-raiz' : '');
  const etiqueta = document.createElement('div');
  etiqueta.className = 'cp-trz-etiqueta';
  const nodo = nodoArbol.nodo;
  if (nodo.tipo === 'entrada') {
    etiqueta.textContent = nodo.identificada
      ? `ENTRADA ${nodo.ticket} — ${nodo.material} — ${window.formatearKg(nodo.kg, nodo.material)}`
      : `ENTRADA ${nodo.ticket} (no identificada)`;
  } else if (nodo.tipo === 'proceso') {
    etiqueta.textContent = `${nodo.tipoProceso} ${nodo.ticket} — Eficiencia ${nodo.eficiencia.toFixed(2)}% — ${window.formatearKg(nodo.kg, '')}`;
    etiqueta.classList.add(`cp-eficiencia-${colorEficienciaLocal(nodo.eficiencia)}`);
  } else {
    const contraparte = nodo.cliente || nodo.proveedor || '—';
    const folioTexto = nodo.folio ? ` — ${nodo.folio}` : '';
    etiqueta.textContent = `VENTA ${contraparte}${folioTexto} — ${nodo.material} — ${window.formatearKg(nodo.kg, nodo.material)}`;
  }
  contenedor.appendChild(etiqueta);

  if (nodoArbol.origenes && nodoArbol.origenes.length > 0) {
    const grupoOrigenes = document.createElement('div');
    grupoOrigenes.className = 'cp-trz-rama cp-trz-origenes';
    const tituloOrigenes = document.createElement('span');
    tituloOrigenes.className = 'cp-trz-titulo-rama';
    tituloOrigenes.textContent = 'Viene de:';
    grupoOrigenes.appendChild(tituloOrigenes);
    nodoArbol.origenes.forEach((hijo) => grupoOrigenes.appendChild(crearNodoArbolDOM(hijo, false)));
    contenedor.appendChild(grupoOrigenes);
  }
  if (nodoArbol.destinos && nodoArbol.destinos.length > 0) {
    const grupoDestinos = document.createElement('div');
    grupoDestinos.className = 'cp-trz-rama cp-trz-destinos';
    const tituloDestinos = document.createElement('span');
    tituloDestinos.className = 'cp-trz-titulo-rama';
    tituloDestinos.textContent = 'Va hacia:';
    grupoDestinos.appendChild(tituloDestinos);
    nodoArbol.destinos.forEach((hijo) => grupoDestinos.appendChild(crearNodoArbolDOM(hijo, false)));
    contenedor.appendChild(grupoDestinos);
  }
  return contenedor;
}

function renderizarResumenGlobal(resumen) {
  const contenedor = document.getElementById('cp-trz-resumen');
  contenedor.innerHTML = '';
  const partes = [
    `Kg Entrada: ${resumen.kgEntrada.toLocaleString('es-MX')}`,
    `Kg Vendido: ${resumen.kgSalida.toLocaleString('es-MX')}`,
    `Merma Total: ${resumen.mermaTotal.toLocaleString('es-MX')}`,
    `En Inventario: ${resumen.kgPendiente.toLocaleString('es-MX')}`,
    `Eficiencia Global: ${resumen.eficienciaGlobal.toFixed(2)}%`,
    `Ingreso Generado: ${window.formatearMoneda(resumen.ingresoGenerado)}`,
    `Costo Material: ${window.formatearMoneda(resumen.costoMaterial)}`,
    `Margen: ${window.formatearMoneda(resumen.margen)}`
  ];
  partes.forEach((texto, indice) => {
    const span = document.createElement('span');
    span.textContent = texto;
    if (indice === partes.length - 1) {
      span.classList.add(resumen.margen >= 0 ? 'cp-trz-margen-positivo' : 'cp-trz-margen-negativo');
    }
    contenedor.appendChild(span);
  });
}

function obtenerDatosActuales() {
  return {
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosVentas: window.EVE.registrosVentas,
    ventas: window.EVE.ventas,
    cuentasPorPagar: window.EVE.cuentasPorPagar
  };
}

function describirTicket(ticket, datos) {
  const entrada = datos.registrosDestaraje.find((r) => String(r.ticket) === String(ticket));
  if (!entrada) return ticket;
  return `${ticket} — ${entrada.material} — ${entrada.proveedor} — ${window.formatearFecha(entrada.fechaEntrada)}`;
}

let cadenaActual = null;
let ticketActual = null;

function actualizarBotonExportar() {
  const boton = document.getElementById('cp-trz-exportar-pdf');
  if (boton) boton.disabled = !cadenaActual;
}

function buscarTrazabilidad(ticket) {
  const datos = obtenerDatosActuales();
  const cadena = construirCadena(String(ticket).trim(), datos);
  document.getElementById('cp-trz-resultados').innerHTML = '';
  const arbolContenedor = document.getElementById('cp-trz-arbol');
  arbolContenedor.innerHTML = '';
  const resumenContenedor = document.getElementById('cp-trz-resumen');
  resumenContenedor.innerHTML = '';
  if (!cadena.encontrado) {
    const mensaje = document.createElement('p');
    mensaje.textContent = `No se encontró ningún registro con el ticket "${ticket}"`;
    arbolContenedor.appendChild(mensaje);
    cadenaActual = null;
    ticketActual = null;
    actualizarBotonExportar();
    return;
  }
  arbolContenedor.appendChild(crearNodoArbolDOM(cadena.arbol, true));
  renderizarResumenGlobal(cadena.resumen);
  cadenaActual = cadena;
  ticketActual = String(ticket).trim();
  actualizarBotonExportar();
}

function renderizarListaResultados(tickets, datos) {
  const contenedor = document.getElementById('cp-trz-resultados');
  contenedor.innerHTML = '';
  const titulo = document.createElement('p');
  titulo.className = 'cp-trz-titulo-rama';
  titulo.textContent = `${tickets.length} resultado(s) — selecciona un ticket:`;
  contenedor.appendChild(titulo);
  tickets.forEach((ticket) => {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'cp-trz-resultado-btn';
    boton.textContent = describirTicket(ticket, datos);
    boton.addEventListener('click', () => buscarTrazabilidad(ticket));
    contenedor.appendChild(boton);
  });
}

function ejecutarBusqueda() {
  const criterio = document.getElementById('cp-trz-criterio').value;
  const valor = document.getElementById('cp-trz-ticket').value.trim();
  if (!valor) return;
  document.getElementById('cp-trz-resultados').innerHTML = '';
  if (criterio === 'ticket') {
    buscarTrazabilidad(valor);
    return;
  }
  const datos = obtenerDatosActuales();
  const tickets = buscarTicketsPorCriterio(criterio, valor, datos);
  document.getElementById('cp-trz-arbol').innerHTML = '';
  document.getElementById('cp-trz-resumen').innerHTML = '';
  cadenaActual = null;
  ticketActual = null;
  actualizarBotonExportar();
  if (tickets.length === 0) {
    const mensaje = document.createElement('p');
    mensaje.textContent = `No se encontraron resultados para "${valor}"`;
    document.getElementById('cp-trz-resultados').appendChild(mensaje);
    return;
  }
  if (tickets.length === 1) {
    buscarTrazabilidad(tickets[0]);
    return;
  }
  renderizarListaResultados(tickets, datos);
}

function aplanarArbol(nodoArbol, nivel, filas) {
  const nodo = nodoArbol.nodo;
  let etiqueta;
  if (nodo.tipo === 'entrada') {
    etiqueta = nodo.identificada
      ? `ENTRADA ${nodo.ticket} — ${nodo.material}`
      : `ENTRADA ${nodo.ticket} (no identificada)`;
  } else if (nodo.tipo === 'proceso') {
    etiqueta = `${nodo.tipoProceso} ${nodo.ticket} — Eficiencia ${nodo.eficiencia.toFixed(2)}%`;
  } else {
    const contraparte = nodo.cliente || nodo.proveedor || '—';
    etiqueta = `VENTA ${contraparte}${nodo.folio ? ' — ' + nodo.folio : ''} — ${nodo.material}`;
  }
  filas.push([
    '  '.repeat(nivel) + etiqueta,
    window.formatearKg(nodo.kg, nodo.material || ''),
    nodo.tipo === 'proceso' ? window.formatearKg(nodo.merma, '') : ''
  ]);
  (nodoArbol.origenes || []).forEach((hijo) => aplanarArbol(hijo, nivel + 1, filas));
  (nodoArbol.destinos || []).forEach((hijo) => aplanarArbol(hijo, nivel + 1, filas));
}

function generarPDFTrazabilidad(ticket, cadena) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;

  function lineaSeparadora() {
    doc.setDrawColor(200);
    doc.line(14, y, anchoPagina - 14, y);
    y += 6;
  }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('TRAZABILIDAD', anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`Ticket: ${ticket}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`Fecha: ${window.formatearFecha(window.obtenerFechaMexico())}`, anchoPagina / 2, y, { align: 'center' });
  y += 10;

  const resumen = cadena.resumen;
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('RESUMEN GLOBAL', 14, y);
  y += 5;
  lineaSeparadora();
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const lineasResumen = [
    `Kg Entrada: ${resumen.kgEntrada.toLocaleString('es-MX')}   Kg Vendido: ${resumen.kgSalida.toLocaleString('es-MX')}   Merma: ${resumen.mermaTotal.toLocaleString('es-MX')}   En Inventario: ${resumen.kgPendiente.toLocaleString('es-MX')}`
  ];
  lineasResumen.forEach((linea) => { doc.text(linea, 14, y); y += 6; });
  y += 4;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`EFICIENCIA GLOBAL: ${resumen.eficienciaGlobal.toFixed(2)}%`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`MARGEN: ${window.formatearMoneda(resumen.margen)}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Ingreso: ${window.formatearMoneda(resumen.ingresoGenerado)}   Costo: ${window.formatearMoneda(resumen.costoMaterial)}`, anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE CADENA', 14, y);
  y += 5;
  lineaSeparadora();

  const filas = [];
  aplanarArbol(cadena.arbol, 0, filas);
  doc.autoTable({
    startY: y,
    head: [['Nodo', 'Kg', 'Merma']],
    body: filas,
    headStyles: { fillColor: [0, 29, 61] },
    styles: { fontSize: 8 }
  });
  return doc;
}

function exportarTrazabilidadPDF() {
  if (!cadenaActual || !ticketActual) {
    window.showError('Primero busca un ticket con resultados');
    return;
  }
  const doc = generarPDFTrazabilidad(ticketActual, cadenaActual);
  doc.save(`Trazabilidad_${ticketActual}_${window.obtenerFechaMexico()}.pdf`);
}

function crearVistaTrazabilidad() {
  const contenedor = document.createElement('div');
  contenedor.className = 'card cp-trazabilidad';
  contenedor.innerHTML = `
    <div class="cp-trz-buscador">
      <select id="cp-trz-criterio">
        <option value="ticket">Ticket</option>
        <option value="proveedor">Proveedor</option>
        <option value="material">Material</option>
        <option value="proceso">Proceso</option>
        <option value="folio">Folio de venta</option>
      </select>
      <input type="text" id="cp-trz-ticket" placeholder="Buscar por ticket">
      <button type="button" id="cp-trz-buscar" class="btn-primary">Buscar</button>
      <button type="button" id="cp-trz-exportar-pdf" class="btn-secondary" disabled>📕 Exportar Reporte PDF</button>
    </div>
    <div id="cp-trz-resultados" class="cp-trz-resultados"></div>
    <div id="cp-trz-resumen" class="cp-trz-resumen-global"></div>
    <div id="cp-trz-arbol" class="cp-trz-arbol"></div>
  `;
  const criterioSelect = contenedor.querySelector('#cp-trz-criterio');
  const inputValor = contenedor.querySelector('#cp-trz-ticket');
  const placeholders = {
    ticket: 'Buscar por ticket',
    proveedor: 'Buscar por proveedor',
    material: 'Buscar por material',
    proceso: 'Buscar por tipo de proceso',
    folio: 'Buscar por folio de venta (ej. V-2026-001)'
  };
  criterioSelect.addEventListener('change', () => {
    inputValor.placeholder = placeholders[criterioSelect.value] || 'Buscar';
  });
  contenedor.querySelector('#cp-trz-buscar').addEventListener('click', ejecutarBusqueda);
  inputValor.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') ejecutarBusqueda();
  });
  contenedor.querySelector('#cp-trz-exportar-pdf').addEventListener('click', exportarTrazabilidadPDF);
  return contenedor;
}

Object.assign(window.EVE_TRAZABILIDAD, {
  crearVistaTrazabilidad,
  buscarTrazabilidad,
  ejecutarBusqueda
});

})();
