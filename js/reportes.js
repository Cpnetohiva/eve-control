(function () {

function esMaterialPZReporte(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function sumarPorUnidad(registros) {
  let kg = 0;
  let pz = 0;
  for (const registro of registros) {
    if (esMaterialPZReporte(registro.material)) {
      pz += Number(registro.kg) || 0;
    } else {
      kg += Number(registro.kg) || 0;
    }
  }
  return { kg, pz };
}

function agregarPorMaterial(registros) {
  const mapa = new Map();
  for (const registro of registros) {
    const clave = registro.material || '';
    const actual = mapa.get(clave) || 0;
    mapa.set(clave, actual + (Number(registro.kg) || 0));
  }
  return Array.from(mapa.entries())
    .map(([material, kg]) => ({ material, kg, unidad: esMaterialPZReporte(material) ? 'PZ' : 'KG' }))
    .sort((a, b) => b.kg - a.kg);
}

function agregarPorProveedor(registros) {
  const mapaProveedores = new Map();
  for (const registro of registros) {
    const claveProveedor = registro.proveedor || '';
    const claveMaterial = registro.material || '';
    if (!mapaProveedores.has(claveProveedor)) {
      mapaProveedores.set(claveProveedor, new Map());
    }
    const mapaMateriales = mapaProveedores.get(claveProveedor);
    const actual = mapaMateriales.get(claveMaterial) || 0;
    mapaMateriales.set(claveMaterial, actual + (Number(registro.kg) || 0));
  }
  const resultado = [];
  for (const [proveedor, mapaMateriales] of mapaProveedores.entries()) {
    const materiales = Array.from(mapaMateriales.entries())
      .map(([material, kg]) => ({ material, kg }))
      .sort((a, b) => b.kg - a.kg);
    const totalKg = materiales.reduce((suma, m) => suma + m.kg, 0);
    resultado.push({ proveedor, totalKg, materiales });
  }
  return resultado.sort((a, b) => b.totalKg - a.totalKg);
}

function dentroDeRangoReporte(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

const MESES_ES = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'
];

function formatearFechaLarga(fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-').map(Number);
  return `${dia} DE ${MESES_ES[mes - 1]} DE ${anio}`;
}

function formatearPeriodo(desde, hasta) {
  if (!desde && !hasta) return 'TODOS LOS REGISTROS';
  if (desde === hasta) return formatearFechaLarga(desde);
  const [anioD, mesD, diaD] = desde.split('-').map(Number);
  const [anioH, mesH, diaH] = hasta.split('-').map(Number);
  if (anioD === anioH && mesD === mesH) {
    return `${diaD} AL ${diaH} DE ${MESES_ES[mesD - 1]} DE ${anioD}`;
  }
  if (anioD === anioH) {
    return `${diaD} DE ${MESES_ES[mesD - 1]} AL ${diaH} DE ${MESES_ES[mesH - 1]} DE ${anioD}`;
  }
  return `${formatearFechaLarga(desde)} AL ${formatearFechaLarga(hasta)}`;
}

function obtenerRangoYEtiqueta(tabId, filtros) {
  if (tabId === 'hoy') {
    const hoy = window.obtenerFechaMexico();
    return { desde: hoy, hasta: hoy, etiquetaReporte: 'HOY', etiquetaPeriodo: formatearPeriodo(hoy, hoy) };
  }
  if (tabId === 'semana') {
    const desde = window.obtenerInicioSemana();
    const hasta = window.obtenerFechaMexico();
    return { desde, hasta, etiquetaReporte: 'SEMANA', etiquetaPeriodo: formatearPeriodo(desde, hasta) };
  }
  const desde = (filtros && filtros.desde) || '';
  const hasta = (filtros && filtros.hasta) || '';
  return {
    desde, hasta, etiquetaReporte: 'TODOS',
    etiquetaPeriodo: formatearPeriodo(desde || null, hasta || null)
  };
}

function aplicaFiltroTicket(registro, ticket) {
  return !ticket || String(registro.ticket || '').toUpperCase().includes(ticket.toUpperCase());
}

function aplicaFiltroMaterial(registro, material) {
  return !material || registro.material === material;
}

function aplicaFiltroExacto(registro, campo, valor) {
  return !valor || registro[campo] === valor;
}

function obtenerDatosPeriodo(desde, hasta, filtrosAdicionales) {
  const f = filtrosAdicionales || {};
  return {
    destaraje: window.EVE.registrosDestaraje.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.proveedor)
    ),
    ventas: window.EVE.registrosVentas.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.cliente)
    ),
    produccion: window.EVE.registrosProduccion.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'cliente', f.cliente)
    ),
    pagos: window.EVE.registrosPagos.filter((r) =>
      dentroDeRangoReporte(r.fecha, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.proveedor)
    )
  };
}

function construirDetalleTickets(datos) {
  const filas = [];
  datos.destaraje.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor || '', material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada || '', fechaSalida: r.fechaSalida || ''
  }));
  datos.produccion.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.cliente || '', material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada || '', fechaSalida: r.fechaSalida || ''
  }));
  datos.ventas.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor || '', material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada || '', fechaSalida: r.fechaSalida || ''
  }));
  return filas;
}

function calcularResumenPagos(pagos) {
  if (pagos.length === 0) return null;
  let totalPagado = 0;
  let totalDeuda = 0;
  for (const p of pagos) {
    totalPagado += Number(p.pagado) || 0;
    totalDeuda += (Number(p.total) || 0) - (Number(p.pagado) || 0);
  }
  return { totalPagado, totalDeuda };
}

window.agregarPorMaterial = agregarPorMaterial;
window.agregarPorProveedor = agregarPorProveedor;
window.sumarPorUnidad = sumarPorUnidad;
window.formatearFechaLarga = formatearFechaLarga;
window.formatearPeriodo = formatearPeriodo;
window.obtenerRangoYEtiqueta = obtenerRangoYEtiqueta;
window.obtenerDatosPeriodo = obtenerDatosPeriodo;
window.construirDetalleTickets = construirDetalleTickets;
window.calcularResumenPagos = calcularResumenPagos;

function formatearNumeroReporte(n) {
  return Math.round(n).toLocaleString('es-MX');
}

function formatearPrecioPorKg(valor) {
  return Number.isFinite(Number(valor)) ? window.formatearMoneda(valor) : 'N/D';
}

function lineaDesgloseReporte(item) {
  return `  ${item.material}  ${formatearNumeroReporte(item.kg)} ${item.unidad}`;
}

function generarTXT(datos, periodo) {
  const lineas = [];
  lineas.push('DESTARAJE GENERAL');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');
  lineas.push(`TOTAL KG: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)}`);
  lineas.push(`TOTAL PRODUCCION KG: ${formatearNumeroReporte(datos.produccion.reduce((s, r) => s + (Number(r.kg) || 0), 0))}`);
  lineas.push('');

  lineas.push('DESGLOSE POR MATERIAL:');
  agregarPorMaterial(datos.destaraje).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE PRODUCCION:');
  agregarPorMaterial(datos.produccion).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE VENTAS:');
  agregarPorMaterial(datos.ventas).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE POR PROVEEDOR + MATERIAL:');
  agregarPorProveedor(datos.destaraje).forEach((p) => {
    lineas.push(`  ${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG`);
    p.materiales.forEach((m) => lineas.push(`    ${m.material}  ${formatearNumeroReporte(m.kg)} KG`));
  });

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    lineas.push('');
    lineas.push('RESUMEN PAGOS:');
    lineas.push(`  TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`);
    lineas.push(`  TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`);
  }

  lineas.push('');
  lineas.push('DETALLE DE TICKETS:');
  lineas.push('  TICKET  PROVEEDOR  MATERIAL  KG  F.ENTRADA  F.SALIDA');
  construirDetalleTickets(datos).forEach((r) => {
    lineas.push(`  ${r.ticket}  ${r.proveedor}  ${r.material}  ${formatearNumeroReporte(r.kg)}  ${r.fechaEntrada}  ${r.fechaSalida}`);
  });

  if (datos.pagos.length > 0) {
    lineas.push('');
    lineas.push('DETALLE DE PAGOS:');
    lineas.push('  TICKET  PROVEEDOR  MATERIAL  KG  PRECIO/KG  TOTAL  PAGADO  DEUDA  FECHA');
    datos.pagos.forEach((p) => {
      const deuda = (Number(p.total) || 0) - (Number(p.pagado) || 0);
      lineas.push(`  ${p.ticket}  ${p.proveedor || ''}  ${p.material}  ${formatearNumeroReporte(p.kg)}  ${formatearPrecioPorKg(p.precioPorKg)}  ${window.formatearMoneda(p.total)}  ${window.formatearMoneda(p.pagado)}  ${window.formatearMoneda(deuda)}  ${p.fecha || ''}`);
    });
  }

  return lineas.join('\n');
}

window.generarTXT = generarTXT;

function generarPDF(datos, periodo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;

  function saltoSiNecesario(alto) {
    if (y + alto > 280) {
      doc.addPage();
      y = 20;
    }
  }

  function lineaSeparadora() {
    doc.setDrawColor(200);
    doc.line(14, y, anchoPagina - 14, y);
    y += 6;
  }

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('DESTARAJE GENERAL', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL KG: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)}`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`TOTAL PRODUCCION KG: ${formatearNumeroReporte(datos.produccion.reduce((s, r) => s + (Number(r.kg) || 0), 0))}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  function seccionDesglose(titulo, items) {
    saltoSiNecesario(14 + items.length * 6);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(titulo, 14, y);
    y += 5;
    lineaSeparadora();
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    items.forEach((item) => {
      doc.text(`    ${item.material}`, 14, y);
      doc.text(`${formatearNumeroReporte(item.kg)} ${item.unidad}`, anchoPagina - 14, y, { align: 'right' });
      y += 6;
    });
    y += 6;
  }

  seccionDesglose('DESGLOSE POR MATERIAL:', agregarPorMaterial(datos.destaraje));
  seccionDesglose('DESGLOSE PRODUCCION:', agregarPorMaterial(datos.produccion));
  seccionDesglose('DESGLOSE VENTAS:', agregarPorMaterial(datos.ventas));

  const porProveedor = agregarPorProveedor(datos.destaraje);
  saltoSiNecesario(14 + porProveedor.reduce((s, p) => s + 6 + p.materiales.length * 6, 0));
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DESGLOSE POR PROVEEDOR + MATERIAL:', 14, y);
  y += 5;
  lineaSeparadora();
  porProveedor.forEach((p) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG`, 18, y);
    y += 6;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    p.materiales.forEach((m) => {
      doc.text(`${m.material}  ${formatearNumeroReporte(m.kg)} KG`, 22, y);
      y += 6;
    });
  });
  y += 6;

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    saltoSiNecesario(20);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RESUMEN PAGOS:', 14, y);
    y += 5;
    lineaSeparadora();
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`, 18, y);
    y += 6;
    doc.text(`TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`, 18, y);
    y += 10;
  }

  const detalle = construirDetalleTickets(datos);
  saltoSiNecesario(30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE TICKETS:', 14, y);
  y += 6;
  doc.autoTable({
    startY: y,
    head: [['TICKET', 'PROVEEDOR', 'MATERIAL', 'KG', 'F.ENTRADA', 'F.SALIDA']],
    body: detalle.map((r) => [r.ticket, r.proveedor, r.material, formatearNumeroReporte(r.kg), r.fechaEntrada, r.fechaSalida]),
    headStyles: { fillColor: [0, 29, 61] }
  });
  y = doc.lastAutoTable.finalY + 10;

  if (datos.pagos.length > 0) {
    saltoSiNecesario(30);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DETALLE DE PAGOS:', 14, y);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [['TICKET', 'PROVEEDOR', 'MATERIAL', 'KG', 'PRECIO/KG', 'TOTAL', 'PAGADO', 'DEUDA', 'FECHA']],
      body: datos.pagos.map((p) => [
        p.ticket, p.proveedor || '', p.material, formatearNumeroReporte(p.kg),
        formatearPrecioPorKg(p.precioPorKg), window.formatearMoneda(p.total),
        window.formatearMoneda(p.pagado),
        window.formatearMoneda((Number(p.total) || 0) - (Number(p.pagado) || 0)),
        p.fecha || ''
      ]),
      headStyles: { fillColor: [0, 29, 61] }
    });
  }

  return doc;
}

window.generarPDF = generarPDF;

function construirFilasCSV(datos) {
  const filas = [];
  const agregarFila = (modulo, registro, proveedorOCliente) => {
    filas.push({
      modulo,
      ticket: registro.ticket,
      proveedorOCliente,
      material: registro.material,
      kg: registro.kg,
      fechaEntrada: registro.fechaEntrada || '',
      fechaSalida: registro.fechaSalida || '',
      precioPorKg: registro.precioPorKg ?? '',
      total: registro.total ?? '',
      pagado: registro.pagado ?? '',
      deuda: registro.total !== undefined ? (Number(registro.total) || 0) - (Number(registro.pagado) || 0) : '',
      fecha: registro.fecha || ''
    });
  };
  datos.destaraje.forEach((r) => agregarFila('DESTARAJE', r, r.proveedor));
  datos.ventas.forEach((r) => agregarFila('VENTA', r, r.proveedor));
  datos.produccion.forEach((r) => agregarFila('PRODUCCION', r, r.cliente));
  datos.pagos.forEach((r) => agregarFila('PAGO', r, r.proveedor));
  return filas;
}

function exportarReporteTXT(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const texto = generarTXT(datos, periodo);
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.txt`);
}

function exportarReportePDF(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const doc = generarPDF(datos, periodo);
  doc.save(`Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
}

function exportarReporteCSV(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const filas = construirFilasCSV(datos);
  window.exportarCSV(filas, `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`);
}

window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

})();
