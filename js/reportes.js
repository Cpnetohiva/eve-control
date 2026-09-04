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
  if (tabId === 'mes') {
    const desde = window.obtenerInicioMes();
    const hasta = window.obtenerFechaMexico();
    return { desde, hasta, etiquetaReporte: 'MES', etiquetaPeriodo: formatearPeriodo(desde, hasta) };
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

function obtenerVentasNormalizadas() {
  const legado = (window.registrosDestarajeVentaSinMigrar
    ? window.registrosDestarajeVentaSinMigrar()
    : window.EVE.registrosVentas.filter((r) => r.migrado !== true)
  ).map((r) => ({
    ticket: r.ticket, proveedor: r.proveedor || '', material: r.material, kg: Number(r.kg) || 0,
    fechaEntrada: r.fechaEntrada || '', fechaSalida: r.fechaSalida || ''
  }));
  const nuevas = [];
  (window.EVE.ventas || []).forEach((v) => {
    (v.lineas || []).forEach((l) => {
      nuevas.push({
        ticket: v.folio || '', proveedor: v.cliente || '', material: l.material, kg: Number(l.cantidad) || 0,
        fechaEntrada: v.fecha || '', fechaSalida: v.fecha || ''
      });
    });
  });
  return [...legado, ...nuevas];
}

function obtenerDatosPeriodo(desde, hasta, filtrosAdicionales) {
  const f = filtrosAdicionales || {};
  return {
    destaraje: window.EVE.registrosDestaraje.filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.proveedor)
    ),
    ventas: obtenerVentasNormalizadas().filter((r) =>
      dentroDeRangoReporte(r.fechaSalida, desde, hasta) &&
      aplicaFiltroTicket(r, f.ticket) && aplicaFiltroMaterial(r, f.material) && aplicaFiltroExacto(r, 'proveedor', f.cliente)
    ),
    pagos: window.EVE.registrosPagos.filter((r) =>
      !r.revertido &&
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
  datos.ventas.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor || '', material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada || '', fechaSalida: r.fechaSalida || ''
  }));
  return filas;
}

function calcularResumenPagos(pagos) {
  const vigentes = pagos.filter((p) => !p.revertido);
  if (vigentes.length === 0) return null;
  let totalPagado = 0;
  let totalDeuda = 0;
  for (const p of vigentes) {
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
  lineas.push('');

  lineas.push('DESGLOSE POR MATERIAL:');
  agregarPorMaterial(datos.destaraje).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE VENTAS:');
  agregarPorMaterial(datos.ventas).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE POR PROVEEDOR + MATERIAL:');
  const pagadoPorProveedorTXT = new Map(agregarPagadoPorProveedor(datos.pagos).map((p) => [p.proveedor, p.totalPagado]));
  agregarPorProveedor(datos.destaraje).forEach((p) => {
    const pagado = pagadoPorProveedorTXT.get(p.proveedor) || 0;
    lineas.push(`  ${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG  —  Pagado: ${window.formatearMoneda(pagado)}`);
    p.materiales.forEach((m) => lineas.push(`    ${m.material}  ${formatearNumeroReporte(m.kg)} KG`));
  });

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    lineas.push('');
    lineas.push('RESUMEN PAGOS:');
    lineas.push(`  TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`);
    lineas.push(`  TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`);
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
  seccionDesglose('DESGLOSE VENTAS:', agregarPorMaterial(datos.ventas));

  const porProveedor = agregarPorProveedor(datos.destaraje);
  saltoSiNecesario(14 + porProveedor.reduce((s, p) => s + 6 + p.materiales.length * 6, 0));
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DESGLOSE POR PROVEEDOR + MATERIAL:', 14, y);
  y += 5;
  lineaSeparadora();
  const pagadoPorProveedorPDF = new Map(agregarPagadoPorProveedor(datos.pagos).map((p) => [p.proveedor, p.totalPagado]));
  porProveedor.forEach((p) => {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text(`${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG`, 18, y);
    doc.text(`Pagado: ${window.formatearMoneda(pagadoPorProveedorPDF.get(p.proveedor) || 0)}`, anchoPagina - 14, y, { align: 'right' });
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

  return doc;
}

window.generarPDF = generarPDF;

function generarTXTDestaraje(datos, periodo) {
  const lineas = [];
  lineas.push('REPORTE DESTARAJE');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');
  lineas.push(`TOTAL KG: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)}`);
  lineas.push('');

  lineas.push('DESGLOSE POR MATERIAL:');
  agregarPorMaterial(datos.destaraje).forEach((item) => lineas.push(lineaDesgloseReporte(item)));
  lineas.push('');

  lineas.push('DESGLOSE POR PROVEEDOR + MATERIAL:');
  agregarPorProveedor(datos.destaraje).forEach((p) => {
    lineas.push(`  ${p.proveedor}: ${formatearNumeroReporte(p.totalKg)} KG`);
    p.materiales.forEach((m) => lineas.push(`    ${m.material}  ${formatearNumeroReporte(m.kg)} KG`));
  });
  lineas.push('');

  lineas.push('DETALLE DE TICKETS:');
  lineas.push('  TICKET  PROVEEDOR  MATERIAL  KG  F.ENTRADA  F.SALIDA');
  construirDetalleTickets({ destaraje: datos.destaraje, ventas: [] }).forEach((r) => {
    lineas.push(`  ${r.ticket}  ${r.proveedor}  ${r.material}  ${formatearNumeroReporte(r.kg)}  ${r.fechaEntrada}  ${r.fechaSalida}`);
  });

  return lineas.join('\n');
}

window.generarTXTDestaraje = generarTXTDestaraje;

function generarPDFDestaraje(datos, periodo) {
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
  doc.text('REPORTE DESTARAJE', anchoPagina / 2, y, { align: 'center' });
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

  const detalle = construirDetalleTickets({ destaraje: datos.destaraje, ventas: [] });
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

  return doc;
}

window.generarPDFDestaraje = generarPDFDestaraje;

function generarTXTPagos(datos, periodo) {
  const lineas = [];
  lineas.push('REPORTE PAGOS');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    lineas.push(`TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`);
    lineas.push(`TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`);
    lineas.push('');
  }

  const porProveedorPagado = agregarPagadoPorProveedor(datos.pagos);
  if (porProveedorPagado.length > 0) {
    lineas.push('DESGLOSE POR PROVEEDOR:');
    porProveedorPagado.forEach((p) => lineas.push(`  ${p.proveedor}: ${window.formatearMoneda(p.totalPagado)}`));
    lineas.push('');
  }

  lineas.push('DETALLE DE PAGOS:');
  lineas.push('  TICKET  PROVEEDOR  MATERIAL  KG  PRECIO/KG  TOTAL  PAGADO  DEUDA  FECHA');
  datos.pagos.forEach((p) => {
    const deuda = (Number(p.total) || 0) - (Number(p.pagado) || 0);
    lineas.push(`  ${p.ticket}  ${p.proveedor || ''}  ${p.material}  ${formatearNumeroReporte(p.kg)}  ${formatearPrecioPorKg(p.precioPorKg)}  ${window.formatearMoneda(p.total)}  ${window.formatearMoneda(p.pagado)}  ${window.formatearMoneda(deuda)}  ${p.fecha || ''}`);
  });

  return lineas.join('\n');
}

window.generarTXTPagos = generarTXTPagos;

function generarPDFPagos(datos, periodo) {
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
  doc.text('REPORTE PAGOS', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const resumenPagos = calcularResumenPagos(datos.pagos);
  if (resumenPagos) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL PAGADO: ${window.formatearMoneda(resumenPagos.totalPagado)}`, anchoPagina / 2, y, { align: 'center' });
    y += 7;
    doc.text(`TOTAL DEUDA: ${window.formatearMoneda(resumenPagos.totalDeuda)}`, anchoPagina / 2, y, { align: 'center' });
    y += 12;
  }

  const porProveedorPagado = agregarPagadoPorProveedor(datos.pagos);
  if (porProveedorPagado.length > 0) {
    saltoSiNecesario(14 + porProveedorPagado.length * 6);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('DESGLOSE POR PROVEEDOR:', 14, y);
    y += 5;
    lineaSeparadora();
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    porProveedorPagado.forEach((p) => {
      doc.text(`    ${p.proveedor}`, 14, y);
      doc.text(window.formatearMoneda(p.totalPagado), anchoPagina - 14, y, { align: 'right' });
      y += 6;
    });
    y += 6;
  }

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

  return doc;
}

window.generarPDFPagos = generarPDFPagos;

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

function exportarReporteDestarajeTXT(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros);
  const texto = generarTXTDestaraje(datos, periodo);
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.txt`);
}

function exportarReporteDestarajePDF(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros);
  const doc = generarPDFDestaraje(datos, periodo);
  doc.save(`Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
}

function exportarReporteDestarajeCSV(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros);
  const filas = construirFilasCSV({ destaraje: datos.destaraje, ventas: [], pagos: [] });
  window.exportarCSV(filas, `Reporte_Destaraje_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`);
}

function exportarReportePagosTXT(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros);
  const texto = generarTXTPagos(datos, periodo);
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, `Reporte_Pagos_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.txt`);
}

function exportarReportePagosPDF(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros);
  const doc = generarPDFPagos(datos, periodo);
  doc.save(`Reporte_Pagos_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
}

function exportarReportePagosCSV(tabId, filtros) {
  const periodo = obtenerRangoYEtiqueta(tabId, filtros);
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta, filtros);
  const filas = construirFilasCSV({ destaraje: [], ventas: [], pagos: datos.pagos });
  window.exportarCSV(filas, `Reporte_Pagos_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`);
}

window.exportarReporteDestarajeTXT = exportarReporteDestarajeTXT;
window.exportarReporteDestarajePDF = exportarReporteDestarajePDF;
window.exportarReporteDestarajeCSV = exportarReporteDestarajeCSV;
window.exportarReportePagosTXT = exportarReportePagosTXT;
window.exportarReportePagosPDF = exportarReportePagosPDF;
window.exportarReportePagosCSV = exportarReportePagosCSV;

function agregarPorTipoProceso(registros) {
  const mapa = new Map();
  for (const r of registros) {
    if (!mapa.has(r.tipoProceso)) {
      mapa.set(r.tipoProceso, { cantidad: 0, totalOutput: 0, sumaEficiencia: 0 });
    }
    const acumulado = mapa.get(r.tipoProceso);
    acumulado.cantidad += 1;
    acumulado.totalOutput += Number(r.totalOutput) || 0;
    acumulado.sumaEficiencia += Number(r.eficiencia) || 0;
  }
  return Array.from(mapa.entries())
    .map(([tipoProceso, acc]) => ({
      tipoProceso,
      cantidad: acc.cantidad,
      totalOutput: acc.totalOutput,
      eficienciaPromedio: acc.cantidad > 0 ? acc.sumaEficiencia / acc.cantidad : 0
    }))
    .sort((a, b) => b.totalOutput - a.totalOutput);
}

window.agregarPorTipoProceso = agregarPorTipoProceso;

function generarTXTControlProduccion(registros, periodo) {
  const lineas = [];
  lineas.push('CONTROL DE PRODUCCIÓN');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');

  const stats = window.EVE_CONTROL_PRODUCCION.calcularStats(registros);
  lineas.push(`TOTAL PROCESOS: ${stats.totalRegistros}`);
  lineas.push(`TOTAL INPUT: ${formatearNumeroReporte(stats.totalInput)} KG`);
  lineas.push(`TOTAL OUTPUT: ${formatearNumeroReporte(stats.totalOutput)} KG`);
  lineas.push(`EFICIENCIA PROMEDIO: ${stats.eficienciaPromedio.toFixed(2)}%`);
  lineas.push('');

  lineas.push('DESGLOSE POR TIPO DE PROCESO:');
  agregarPorTipoProceso(registros).forEach((item) => {
    lineas.push(`  ${item.tipoProceso}  ${item.cantidad} procesos  ${formatearNumeroReporte(item.totalOutput)} KG output  eficiencia prom ${item.eficienciaPromedio.toFixed(2)}%`);
  });
  lineas.push('');

  lineas.push('DETALLE DE PROCESOS:');
  lineas.push('  TICKET  PROCESO  OPERADOR  TURNO  INPUT  OUTPUT  EFICIENCIA  MERMA%  F.INICIO  F.FIN');
  registros.forEach((r) => {
    lineas.push(`  ${r.ticket}  ${r.tipoProceso}  ${r.operador}  ${r.turno}  ${formatearNumeroReporte(r.totalInput)}  ${formatearNumeroReporte(r.totalOutput)}  ${r.eficiencia.toFixed(2)}%  ${r.porcentajeMerma.toFixed(2)}%  ${r.fechaInicio}  ${r.fechaFin}`);
  });

  return lineas.join('\n');
}

window.generarTXTControlProduccion = generarTXTControlProduccion;

function generarPDFControlProduccion(registros, periodo) {
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
  doc.text('CONTROL DE PRODUCCIÓN', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const stats = window.EVE_CONTROL_PRODUCCION.calcularStats(registros);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL INPUT: ${formatearNumeroReporte(stats.totalInput)} KG`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`TOTAL OUTPUT: ${formatearNumeroReporte(stats.totalOutput)} KG  —  EFICIENCIA PROMEDIO: ${stats.eficienciaPromedio.toFixed(2)}%`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const porTipo = agregarPorTipoProceso(registros);
  saltoSiNecesario(14 + porTipo.length * 6);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DESGLOSE POR TIPO DE PROCESO:', 14, y);
  y += 5;
  lineaSeparadora();
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  porTipo.forEach((item) => {
    doc.text(`    ${item.tipoProceso} (${item.cantidad})`, 14, y);
    doc.text(`${formatearNumeroReporte(item.totalOutput)} KG — ${item.eficienciaPromedio.toFixed(2)}%`, anchoPagina - 14, y, { align: 'right' });
    y += 6;
  });
  y += 6;

  saltoSiNecesario(30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE PROCESOS:', 14, y);
  y += 6;
  doc.autoTable({
    startY: y,
    head: [['TICKET', 'PROCESO', 'OPERADOR', 'TURNO', 'INPUT', 'OUTPUT', 'EFICIENCIA', 'MERMA%', 'F.INICIO', 'F.FIN']],
    body: registros.map((r) => [
      r.ticket, r.tipoProceso, r.operador, r.turno,
      formatearNumeroReporte(r.totalInput), formatearNumeroReporte(r.totalOutput),
      `${r.eficiencia.toFixed(2)}%`, `${r.porcentajeMerma.toFixed(2)}%`, r.fechaInicio, r.fechaFin
    ]),
    headStyles: { fillColor: [0, 29, 61] }
  });

  return doc;
}

window.generarPDFControlProduccion = generarPDFControlProduccion;

function construirFilasCSVControlProduccion(registros) {
  return registros.map((r) => ({
    ticket: r.ticket,
    tipoProceso: r.tipoProceso,
    operador: r.operador,
    turno: r.turno,
    totalInput: r.totalInput,
    totalOutput: r.totalOutput,
    eficiencia: r.eficiencia,
    porcentajeMerma: r.porcentajeMerma,
    fechaInicio: r.fechaInicio,
    fechaFin: r.fechaFin
  }));
}

window.construirFilasCSVControlProduccion = construirFilasCSVControlProduccion;

function agregarPagadoPorProveedor(pagos) {
  const mapa = new Map();
  for (const p of pagos) {
    const clave = p.proveedor || '';
    const actual = mapa.get(clave) || 0;
    mapa.set(clave, actual + (Number(p.pagado) || 0));
  }
  return Array.from(mapa.entries())
    .map(([proveedor, totalPagado]) => ({ proveedor, totalPagado }))
    .filter((item) => item.totalPagado > 0)
    .sort((a, b) => b.totalPagado - a.totalPagado);
}

window.agregarPagadoPorProveedor = agregarPagadoPorProveedor;

function topMaterialesTelegram(registros) {
  return agregarPorMaterial(registros)
    .slice(0, 2)
    .map((m) => `${m.material} ${formatearNumeroReporte(m.kg)} ${m.unidad}`)
    .join(', ');
}

function construirMensajeTelegram(periodo) {
  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const datosCP = window.EVE.registrosControlProduccion.filter((r) =>
    dentroDeRangoReporte(r.fechaFin.slice(0, 10), periodo.desde, periodo.hasta)
  );
  const lineas = [];
  lineas.push('📊 REPORTE');
  lineas.push(`Periodo: ${periodo.etiquetaPeriodo}`);
  lineas.push('');

  lineas.push('DESTARAJE:');
  lineas.push(`• Total: ${formatearNumeroReporte(sumarPorUnidad(datos.destaraje).kg)} kg`);
  lineas.push(`• ${topMaterialesTelegram(datos.destaraje)}`);
  lineas.push('');

  lineas.push('VENTAS:');
  lineas.push(`• Total: ${formatearNumeroReporte(sumarPorUnidad(datos.ventas).kg)} kg`);
  lineas.push(`• ${topMaterialesTelegram(datos.ventas)}`);
  lineas.push('');

  const resumenPagos = calcularResumenPagos(datos.pagos) || { totalPagado: 0, totalDeuda: 0 };
  lineas.push('PAGOS:');
  lineas.push(`• Total Pagado: ${window.formatearMoneda(resumenPagos.totalPagado)}`);
  const porProveedorPagado = agregarPagadoPorProveedor(datos.pagos);
  lineas.push(`• ${porProveedorPagado.map((p) => `${p.proveedor} ${window.formatearMoneda(p.totalPagado)}`).join(', ')}`);
  lineas.push('');

  const statsCP = window.EVE_CONTROL_PRODUCCION.calcularStats(datosCP);
  lineas.push('CONTROL DE PRODUCCIÓN:');
  lineas.push(`• Procesos: ${statsCP.totalRegistros}`);
  lineas.push(`• Material procesado: ${formatearNumeroReporte(statsCP.totalInput)} kg`);
  lineas.push(`• Eficiencia promedio: ${statsCP.eficienciaPromedio.toFixed(1)}%`);
  lineas.push('');

  lineas.push('📄 Ver PDF adjunto');
  return lineas.join('\n');
}

window.construirMensajeTelegram = construirMensajeTelegram;

async function enviarReporteTelegram(periodo) {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  if (!configDoc.exists) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }
  const { token, chatId } = configDoc.data();
  if (!token || !chatId) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }

  const mensaje = construirMensajeTelegram(periodo);
  const formDataMensaje = new FormData();
  formDataMensaje.append('chat_id', chatId);
  formDataMensaje.append('text', mensaje);
  const respuestaMensaje = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    body: formDataMensaje
  });
  const resultadoMensaje = await respuestaMensaje.json();
  if (!resultadoMensaje.ok) {
    throw new Error(`Telegram rechazó el mensaje: ${resultadoMensaje.description || 'error desconocido'}`);
  }

  const datos = obtenerDatosPeriodo(periodo.desde, periodo.hasta);
  const doc = generarPDF(datos, periodo);
  const pdfBlob = doc.output('blob');
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', pdfBlob, `Reporte_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
  const respuestaDocumento = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData
  });
  const resultadoDocumento = await respuestaDocumento.json();
  if (!resultadoDocumento.ok) {
    throw new Error(`Telegram rechazó el PDF: ${resultadoDocumento.description || 'error desconocido'}`);
  }
  return resultadoDocumento;
}

window.enviarReporteTelegram = enviarReporteTelegram;

window.construirFilasCSV = construirFilasCSV;
window.exportarReporteTXT = exportarReporteTXT;
window.exportarReportePDF = exportarReportePDF;
window.exportarReporteCSV = exportarReporteCSV;

function agregarCxPPorProveedor(cuentas) {
  const mapa = new Map();
  for (const c of cuentas) {
    const clave = c.proveedor || '';
    if (!mapa.has(clave)) mapa.set(clave, { proveedor: clave, total: 0, pagado: 0, saldo: 0, cantidad: 0 });
    const acc = mapa.get(clave);
    acc.total += Number(c.total) || 0;
    acc.pagado += Number(c.pagado) || 0;
    acc.saldo += Number(c.saldo) || 0;
    acc.cantidad += 1;
  }
  return Array.from(mapa.values()).sort((a, b) => a.proveedor.localeCompare(b.proveedor));
}
window.agregarCxPPorProveedor = agregarCxPPorProveedor;

function aplanarAbonosCxP(cuentas) {
  const filas = [];
  cuentas.forEach((c) => {
    (c.abonos || []).forEach((a) => {
      filas.push({ ticket: c.ticket, proveedor: c.proveedor, material: c.material, monto: a.monto, fecha: a.fecha, referencia: a.referencia, registradoPor: a.registradoPor });
    });
  });
  return filas.sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}
window.aplanarAbonosCxP = aplanarAbonosCxP;

function calcularTotalesCxP(cuentas) {
  return cuentas.reduce((acc, c) => {
    acc.total += Number(c.total) || 0;
    acc.pagado += Number(c.pagado) || 0;
    acc.saldo += Number(c.saldo) || 0;
    return acc;
  }, { total: 0, pagado: 0, saldo: 0 });
}

function generarTXTEstadoCuenta(proveedor, cuentas, periodo) {
  const lineas = [];
  lineas.push('ESTADO DE CUENTA — CxP');
  lineas.push(`PROVEEDOR: ${proveedor}`);
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');

  const totales = calcularTotalesCxP(cuentas);
  lineas.push(`TOTAL ACUMULADO: ${window.formatearMoneda(totales.total)}`);
  lineas.push(`TOTAL PAGADO: ${window.formatearMoneda(totales.pagado)}`);
  lineas.push(`SALDO PENDIENTE: ${window.formatearMoneda(totales.saldo)}`);

  const proveedorRegistro = (window.EVE.proveedores || []).find((p) => p.nombre === proveedor);
  const saldoAFavorTotal = window.EVE_CXP.totalSaldoAFavor(proveedorRegistro && proveedorRegistro.saldoAFavor);
  if (saldoAFavorTotal > 0) {
    lineas.push(`SALDO A FAVOR: ${window.formatearMoneda(saldoAFavorTotal)}`);
  }
  lineas.push('');

  lineas.push('DETALLE DE TICKETS:');
  lineas.push('  TICKET  MATERIAL  KG  PRECIO EFECTIVO  TOTAL  PAGADO  SALDO  ESTADO  FECHA');
  cuentas.forEach((c) => {
    lineas.push(`  ${c.ticket}  ${c.material}  ${formatearNumeroReporte(c.kg)}  ${window.formatearMoneda(c.precioEfectivo)}  ${window.formatearMoneda(c.total)}  ${window.formatearMoneda(c.pagado)}  ${window.formatearMoneda(c.saldo)}  ${c.estado}  ${c.fechaTicket}`);
  });

  const abonos = aplanarAbonosCxP(cuentas);
  if (abonos.length > 0) {
    lineas.push('');
    lineas.push('HISTORIAL DE PAGOS:');
    abonos.forEach((a) => lineas.push(`  ${a.fecha}  Ticket ${a.ticket}  ${window.formatearMoneda(a.monto)}  ${a.referencia}  ${a.registradoPor}`));
  }

  return lineas.join('\n');
}
window.generarTXTEstadoCuenta = generarTXTEstadoCuenta;

function generarPDFEstadoCuenta(proveedor, cuentas, periodo) {
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

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('ESTADO DE CUENTA — CxP', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`PROVEEDOR: ${proveedor}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const totales = calcularTotalesCxP(cuentas);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL: ${window.formatearMoneda(totales.total)}`, anchoPagina / 2, y, { align: 'center' });
  y += 7;
  doc.text(`PAGADO: ${window.formatearMoneda(totales.pagado)}`, anchoPagina / 2, y, { align: 'center' });
  y += 7;
  doc.text(`SALDO: ${window.formatearMoneda(totales.saldo)}`, anchoPagina / 2, y, { align: 'center' });
  y += 10;

  const proveedorRegistro = (window.EVE.proveedores || []).find((p) => p.nombre === proveedor);
  const saldoAFavorTotalPdf = window.EVE_CXP.totalSaldoAFavor(proveedorRegistro && proveedorRegistro.saldoAFavor);
  if (saldoAFavorTotalPdf > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`SALDO A FAVOR: ${window.formatearMoneda(saldoAFavorTotalPdf)}`, anchoPagina / 2, y, { align: 'center' });
    y += 10;
  }

  saltoSiNecesario(30);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('DETALLE DE TICKETS:', 14, y);
  y += 6;
  doc.autoTable({
    startY: y,
    head: [['TICKET', 'MATERIAL', 'KG', 'PRECIO EFECTIVO', 'TOTAL', 'PAGADO', 'SALDO', 'ESTADO', 'FECHA']],
    body: cuentas.map((c) => [
      c.ticket, c.material, formatearNumeroReporte(c.kg), window.formatearMoneda(c.precioEfectivo),
      window.formatearMoneda(c.total), window.formatearMoneda(c.pagado), window.formatearMoneda(c.saldo),
      c.estado, c.fechaTicket
    ]),
    headStyles: { fillColor: [0, 29, 61] }
  });
  y = doc.lastAutoTable.finalY + 10;

  const abonos = aplanarAbonosCxP(cuentas);
  if (abonos.length > 0) {
    saltoSiNecesario(30);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('HISTORIAL DE PAGOS:', 14, y);
    y += 6;
    doc.autoTable({
      startY: y,
      head: [['FECHA', 'TICKET', 'MONTO', 'REFERENCIA', 'REGISTRADO POR']],
      body: abonos.map((a) => [a.fecha, a.ticket, window.formatearMoneda(a.monto), a.referencia, a.registradoPor]),
      headStyles: { fillColor: [0, 29, 61] }
    });
  }

  return doc;
}
window.generarPDFEstadoCuenta = generarPDFEstadoCuenta;

function generarTXTConsolidadoCxP(cuentas, periodo) {
  const lineas = [];
  lineas.push('CONSOLIDADO CxP');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');

  const grupos = agregarCxPPorProveedor(cuentas);
  const totales = calcularTotalesCxP(cuentas);
  lineas.push(`TOTAL ACUMULADO: ${window.formatearMoneda(totales.total)}`);
  lineas.push(`TOTAL PAGADO: ${window.formatearMoneda(totales.pagado)}`);
  lineas.push(`SALDO PENDIENTE: ${window.formatearMoneda(totales.saldo)}`);
  lineas.push('');

  lineas.push('POR PROVEEDOR:');
  lineas.push('  PROVEEDOR  TICKETS  TOTAL  PAGADO  SALDO');
  grupos.forEach((g) => lineas.push(`  ${g.proveedor}  ${g.cantidad}  ${window.formatearMoneda(g.total)}  ${window.formatearMoneda(g.pagado)}  ${window.formatearMoneda(g.saldo)}`));

  return lineas.join('\n');
}
window.generarTXTConsolidadoCxP = generarTXTConsolidadoCxP;

function generarPDFConsolidadoCxP(cuentas, periodo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('CONSOLIDADO CxP', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const grupos = agregarCxPPorProveedor(cuentas);
  const totales = calcularTotalesCxP(cuentas);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL ACUMULADO: ${window.formatearMoneda(totales.total)}`, anchoPagina / 2, y, { align: 'center' });
  y += 7;
  doc.text(`TOTAL PAGADO: ${window.formatearMoneda(totales.pagado)}`, anchoPagina / 2, y, { align: 'center' });
  y += 7;
  doc.text(`SALDO PENDIENTE: ${window.formatearMoneda(totales.saldo)}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  doc.autoTable({
    startY: y,
    head: [['PROVEEDOR', 'TICKETS', 'TOTAL', 'PAGADO', 'SALDO']],
    body: grupos.map((g) => [g.proveedor, g.cantidad, window.formatearMoneda(g.total), window.formatearMoneda(g.pagado), window.formatearMoneda(g.saldo)]),
    headStyles: { fillColor: [0, 29, 61] }
  });

  return doc;
}
window.generarPDFConsolidadoCxP = generarPDFConsolidadoCxP;

function generarTXTHistorialPagos(cuentas, periodo) {
  const lineas = [];
  lineas.push('HISTORIAL DE PAGOS — CxP');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');

  const abonos = aplanarAbonosCxP(cuentas);
  const totalPagado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
  lineas.push(`TOTAL PAGADO EN EL PERIODO: ${window.formatearMoneda(totalPagado)}`);
  lineas.push('');

  lineas.push('DETALLE:');
  lineas.push('  FECHA  TICKET  PROVEEDOR  MATERIAL  MONTO  REFERENCIA  REGISTRADO POR');
  abonos.forEach((a) => lineas.push(`  ${a.fecha}  ${a.ticket}  ${a.proveedor}  ${a.material}  ${window.formatearMoneda(a.monto)}  ${a.referencia}  ${a.registradoPor}`));

  return lineas.join('\n');
}
window.generarTXTHistorialPagos = generarTXTHistorialPagos;

function generarPDFHistorialPagos(cuentas, periodo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;

  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('HISTORIAL DE PAGOS — CxP', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  const abonos = aplanarAbonosCxP(cuentas);
  const totalPagado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL PAGADO EN EL PERIODO: ${window.formatearMoneda(totalPagado)}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  doc.autoTable({
    startY: y,
    head: [['FECHA', 'TICKET', 'PROVEEDOR', 'MATERIAL', 'MONTO', 'REFERENCIA', 'REGISTRADO POR']],
    body: abonos.map((a) => [a.fecha, a.ticket, a.proveedor, a.material, window.formatearMoneda(a.monto), a.referencia, a.registradoPor]),
    headStyles: { fillColor: [0, 29, 61] }
  });

  return doc;
}
window.generarPDFHistorialPagos = generarPDFHistorialPagos;

function construirFilasCSVEstadoCuenta(cuentas) {
  return cuentas.map((c) => ({
    ticket: c.ticket, proveedor: c.proveedor, material: c.material, kg: c.kg,
    precioAplicado: c.precioAplicado, comisionPorKg: c.comisionPorKg, precioEfectivo: c.precioEfectivo,
    total: c.total, pagado: c.pagado, saldo: c.saldo, estado: c.estado, fechaTicket: c.fechaTicket
  }));
}
window.construirFilasCSVEstadoCuenta = construirFilasCSVEstadoCuenta;

function construirFilasCSVConsolidadoCxP(cuentas) {
  return agregarCxPPorProveedor(cuentas).map((p) => ({
    proveedor: p.proveedor, cantidadTickets: p.cantidad, total: p.total, pagado: p.pagado, saldo: p.saldo
  }));
}
window.construirFilasCSVConsolidadoCxP = construirFilasCSVConsolidadoCxP;

function construirFilasCSVHistorialPagos(cuentas) {
  return aplanarAbonosCxP(cuentas);
}
window.construirFilasCSVHistorialPagos = construirFilasCSVHistorialPagos;

function construirMensajeCxPTelegram(tipo, proveedor, cuentas, periodo) {
  const lineas = [];
  lineas.push('💰 CxP');
  lineas.push(`Periodo: ${periodo.etiquetaPeriodo}`);
  lineas.push('');

  if (tipo === 'estadoCuenta') {
    const totales = calcularTotalesCxP(cuentas);
    lineas.push(`PROVEEDOR: ${proveedor}`);
    lineas.push(`Total: ${window.formatearMoneda(totales.total)}`);
    lineas.push(`Pagado: ${window.formatearMoneda(totales.pagado)}`);
    lineas.push(`Saldo: ${window.formatearMoneda(totales.saldo)}`);
  } else if (tipo === 'consolidado') {
    lineas.push('CONSOLIDADO POR PROVEEDOR:');
    agregarCxPPorProveedor(cuentas).forEach((p) =>
      lineas.push(`• ${p.proveedor}: Total ${window.formatearMoneda(p.total)} — Saldo ${window.formatearMoneda(p.saldo)}`)
    );
  } else {
    const abonos = aplanarAbonosCxP(cuentas);
    const totalPagado = abonos.reduce((s, a) => s + (Number(a.monto) || 0), 0);
    lineas.push('HISTORIAL DE PAGOS:');
    lineas.push(`Total pagado en el periodo: ${window.formatearMoneda(totalPagado)}`);
    lineas.push(`Cantidad de abonos: ${abonos.length}`);
  }

  lineas.push('');
  lineas.push('📄 Ver PDF adjunto');
  return lineas.join('\n');
}
window.construirMensajeCxPTelegram = construirMensajeCxPTelegram;

async function enviarReporteCxPTelegram(tipo, proveedor, cuentas, periodo) {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  if (!configDoc.exists) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }
  const { token, chatId } = configDoc.data();
  if (!token || !chatId) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }

  const mensaje = construirMensajeCxPTelegram(tipo, proveedor, cuentas, periodo);
  const formDataMensaje = new FormData();
  formDataMensaje.append('chat_id', chatId);
  formDataMensaje.append('text', mensaje);
  const respuestaMensaje = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    body: formDataMensaje
  });
  const resultadoMensaje = await respuestaMensaje.json();
  if (!resultadoMensaje.ok) {
    throw new Error(`Telegram rechazó el mensaje: ${resultadoMensaje.description || 'error desconocido'}`);
  }

  let doc, nombreArchivo;
  if (tipo === 'estadoCuenta') {
    doc = generarPDFEstadoCuenta(proveedor, cuentas, periodo);
    nombreArchivo = `CxP_EstadoCuenta_${proveedor}_${window.obtenerFechaMexico()}.pdf`;
  } else if (tipo === 'consolidado') {
    doc = generarPDFConsolidadoCxP(cuentas, periodo);
    nombreArchivo = `CxP_Consolidado_${window.obtenerFechaMexico()}.pdf`;
  } else {
    doc = generarPDFHistorialPagos(cuentas, periodo);
    nombreArchivo = `CxP_HistorialPagos_${window.obtenerFechaMexico()}.pdf`;
  }

  const pdfBlob = doc.output('blob');
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', pdfBlob, nombreArchivo);
  const respuestaDocumento = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData
  });
  const resultadoDocumento = await respuestaDocumento.json();
  if (!resultadoDocumento.ok) {
    throw new Error(`Telegram rechazó el PDF: ${resultadoDocumento.description || 'error desconocido'}`);
  }
  return resultadoDocumento;
}
window.enviarReporteCxPTelegram = enviarReporteCxPTelegram;

// ── Reportes de Rendimiento ─────────────────────────────────────────────

function obtenerEntradasMaterialPeriodo(material, desde, hasta) {
  return window.EVE.registrosDestaraje.filter((r) =>
    r.material === material && dentroDeRangoReporte(r.fechaSalida, desde, hasta)
  );
}

function calcularEsperadoPorEntradas(entradas) {
  const acumulado = new Map();
  const definiciones = new Map();
  entradas.forEach((entrada) => {
    const fecha = entrada.fechaSalida || entrada.fechaEntrada;
    const composicion = window.obtenerComposicionVigente(entrada.material, fecha);
    if (!composicion) return;
    (composicion.componentes || []).forEach((c) => {
      const kgEsperado = (Number(entrada.kg) || 0) * (Number(c.porcentaje) || 0) / 100;
      acumulado.set(c.subproducto, (acumulado.get(c.subproducto) || 0) + kgEsperado);
      definiciones.set(c.subproducto, Boolean(c.esMerma));
    });
  });
  return { acumulado, definiciones };
}

function obtenerProcesosDesdeMaterialPeriodo(material, desde, hasta) {
  return window.EVE.registrosControlProduccion.filter((r) =>
    (r.inputs || []).some((i) => i.material === material) &&
    dentroDeRangoReporte((r.fechaFin || '').slice(0, 10), desde, hasta)
  );
}

function calcularRealPorProcesos(procesos) {
  const acumulado = new Map();
  procesos.forEach((r) => {
    const nombre = r.outputs && r.outputs.principal ? r.outputs.principal.material : null;
    if (!nombre) return;
    const kg = r.outputs.principal.kg;
    acumulado.set(nombre, (acumulado.get(nombre) || 0) + (Number(kg) || 0));
  });
  return acumulado;
}

function calcularRendimientoMaterial(material, periodo) {
  const entradas = obtenerEntradasMaterialPeriodo(material, periodo.desde, periodo.hasta);
  const entradaTotalKg = entradas.reduce((s, r) => s + (Number(r.kg) || 0), 0);
  const cantidadTickets = entradas.length;

  const { acumulado: esperadoMap, definiciones } = calcularEsperadoPorEntradas(entradas);
  const procesos = obtenerProcesosDesdeMaterialPeriodo(material, periodo.desde, periodo.hasta);
  const realMap = calcularRealPorProcesos(procesos);

  const nombres = new Set([...esperadoMap.keys(), ...realMap.keys()]);
  const filas = Array.from(nombres).map((nombre) => {
    const realKg = realMap.get(nombre) || 0;
    const esperadoKg = esperadoMap.get(nombre) || 0;
    const realPct = entradaTotalKg > 0 ? (realKg / entradaTotalKg) * 100 : 0;
    const esperadoPct = entradaTotalKg > 0 ? (esperadoKg / entradaTotalKg) * 100 : 0;
    return {
      subproducto: nombre,
      realKg, realPct, esperadoPct,
      diferencia: realPct - esperadoPct,
      esMerma: definiciones.has(nombre) ? definiciones.get(nombre) : false
    };
  }).sort((a, b) => b.esperadoPct - a.esperadoPct);

  const aprovechamientoReal = filas.filter((f) => !f.esMerma).reduce((s, f) => s + f.realPct, 0);
  const aprovechamientoEsperado = filas.filter((f) => !f.esMerma).reduce((s, f) => s + f.esperadoPct, 0);

  return {
    material, entradaTotalKg, cantidadTickets, filas,
    aprovechamientoReal, aprovechamientoEsperado,
    diferenciaAprovechamiento: aprovechamientoReal - aprovechamientoEsperado
  };
}
window.calcularRendimientoMaterial = calcularRendimientoMaterial;

function obtenerRegistrosControlProduccionPorOperadorPeriodo(periodo, filtros) {
  const f = filtros || {};
  return window.EVE.registrosControlProduccion.filter((r) => {
    if (!dentroDeRangoReporte((r.fechaFin || '').slice(0, 10), periodo.desde, periodo.hasta)) return false;
    if (f.operador && r.operador !== f.operador) return false;
    if (f.tipoProceso && r.tipoProceso !== f.tipoProceso) return false;
    return true;
  });
}
window.obtenerRegistrosControlProduccionPorOperadorPeriodo = obtenerRegistrosControlProduccionPorOperadorPeriodo;

function colorEficienciaOperador(eficiencia, metaEficiencia) {
  return eficiencia >= metaEficiencia ? '🟢' : '🔴';
}
window.colorEficienciaOperador = colorEficienciaOperador;

function calcularRendimientoOperador(registros, metaEficiencia) {
  const porOperador = new Map();
  registros.forEach((r) => {
    if (!porOperador.has(r.operador)) porOperador.set(r.operador, new Map());
    const porProceso = porOperador.get(r.operador);
    if (!porProceso.has(r.tipoProceso)) porProceso.set(r.tipoProceso, { procesos: 0, entrada: 0, salida: 0 });
    const acc = porProceso.get(r.tipoProceso);
    acc.procesos += 1;
    acc.entrada += Number(r.totalInput) || 0;
    acc.salida += Number(r.outputs && r.outputs.principal ? r.outputs.principal.kg : 0) || 0;
  });

  return Array.from(porOperador.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([operador, procesosMap]) => {
      const filas = Array.from(procesosMap.entries()).map(([tipoProceso, acc]) => {
        const eficiencia = acc.entrada > 0 ? (acc.salida / acc.entrada) * 100 : 0;
        return {
          tipoProceso, procesos: acc.procesos, entrada: acc.entrada, salida: acc.salida,
          eficiencia, semaforo: colorEficienciaOperador(eficiencia, metaEficiencia)
        };
      }).sort((a, b) => b.entrada - a.entrada);

      const totalProcesos = filas.reduce((s, f) => s + f.procesos, 0);
      const totalEntrada = filas.reduce((s, f) => s + f.entrada, 0);
      const totalSalida = filas.reduce((s, f) => s + f.salida, 0);
      const eficienciaTotal = totalEntrada > 0 ? (totalSalida / totalEntrada) * 100 : 0;

      return {
        operador, filas,
        total: {
          procesos: totalProcesos, entrada: totalEntrada, salida: totalSalida,
          eficiencia: eficienciaTotal, semaforo: colorEficienciaOperador(eficienciaTotal, metaEficiencia)
        }
      };
    });
}
window.calcularRendimientoOperador = calcularRendimientoOperador;

function formatearPorcentajeConSigno(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

function generarTXTRendimientoMaterial(resultado, periodo) {
  const lineas = [];
  lineas.push(`RENDIMIENTO — ${resultado.material}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push('');
  lineas.push(`ENTRADA TOTAL: ${formatearNumeroReporte(resultado.entradaTotalKg)} KG (${resultado.cantidadTickets} tickets)`);
  lineas.push('');

  lineas.push('SUBPRODUCTOS OBTENIDOS:');
  resultado.filas.forEach((f) => {
    const marca = f.esMerma && f.diferencia > 0 ? '  ← MERMA' : '';
    lineas.push(`  ${f.subproducto}  ${formatearNumeroReporte(f.realKg)} KG  ${f.realPct.toFixed(1)}%  (esperado ${f.esperadoPct.toFixed(1)}%)  ${formatearPorcentajeConSigno(f.diferencia)}${marca}`);
  });
  lineas.push('');

  lineas.push(`APROVECHAMIENTO REAL: ${resultado.aprovechamientoReal.toFixed(1)}%  (esperado ${resultado.aprovechamientoEsperado.toFixed(1)}%)  DIFERENCIA: ${formatearPorcentajeConSigno(resultado.diferenciaAprovechamiento)}`);

  return lineas.join('\n');
}
window.generarTXTRendimientoMaterial = generarTXTRendimientoMaterial;

function generarPDFRendimientoMaterial(resultado, periodo) {
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
  doc.text(`RENDIMIENTO — ${resultado.material}`, anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`ENTRADA TOTAL: ${formatearNumeroReporte(resultado.entradaTotalKg)} KG (${resultado.cantidadTickets} tickets)`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  saltoSiNecesario(20 + resultado.filas.length * 8);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('SUBPRODUCTOS OBTENIDOS:', 14, y);
  y += 5;
  lineaSeparadora();

  doc.autoTable({
    startY: y,
    head: [['SUBPRODUCTO', 'REAL (KG)', '%REAL', 'ESPERADO (%)', 'DIFERENCIA (%)']],
    body: resultado.filas.map((f) => [
      f.subproducto + (f.esMerma && f.diferencia > 0 ? ' ← MERMA' : ''),
      formatearNumeroReporte(f.realKg),
      `${f.realPct.toFixed(1)}%`,
      `${f.esperadoPct.toFixed(1)}%`,
      formatearPorcentajeConSigno(f.diferencia)
    ]),
    headStyles: { fillColor: [0, 29, 61] }
  });
  y = doc.lastAutoTable.finalY + 12;

  saltoSiNecesario(30);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`APROVECHAMIENTO REAL: ${resultado.aprovechamientoReal.toFixed(1)}%`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`APROVECHAMIENTO ESPERADO: ${resultado.aprovechamientoEsperado.toFixed(1)}%`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`DIFERENCIA: ${formatearPorcentajeConSigno(resultado.diferenciaAprovechamiento)}`, anchoPagina / 2, y, { align: 'center' });
  y += 10;

  return doc;
}
window.generarPDFRendimientoMaterial = generarPDFRendimientoMaterial;

function construirFilasCSVRendimientoMaterial(resultado) {
  return resultado.filas.map((f) => ({
    material: resultado.material,
    subproducto: f.subproducto,
    realKg: Math.round(f.realKg * 100) / 100,
    realPct: Math.round(f.realPct * 100) / 100,
    esperadoPct: Math.round(f.esperadoPct * 100) / 100,
    diferenciaPct: Math.round(f.diferencia * 100) / 100,
    esMerma: f.esMerma ? 'SI' : 'NO'
  }));
}
window.construirFilasCSVRendimientoMaterial = construirFilasCSVRendimientoMaterial;

function generarTXTRendimientoOperador(resultados, periodo, metaEficiencia) {
  const lineas = [];
  lineas.push('RENDIMIENTO POR OPERADOR');
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`);
  lineas.push(`META DE EFICIENCIA: ${metaEficiencia}%`);
  lineas.push('');

  resultados.forEach((op) => {
    lineas.push(`OPERADOR: ${op.operador}`);
    lineas.push('  PROCESO  PROCESOS  ENTRADA  SALIDA  EFICIENCIA');
    op.filas.forEach((f) => {
      const nombreProceso = window.NOMBRE_PROCESO_UI[f.tipoProceso] || f.tipoProceso;
      lineas.push(`  ${nombreProceso}  ${f.procesos}  ${formatearNumeroReporte(f.entrada)} kg  ${formatearNumeroReporte(f.salida)} kg  ${f.eficiencia.toFixed(1)}% ${f.semaforo}`);
    });
    lineas.push(`  TOTAL  ${op.total.procesos}  ${formatearNumeroReporte(op.total.entrada)} kg  ${formatearNumeroReporte(op.total.salida)} kg  ${op.total.eficiencia.toFixed(1)}% ${op.total.semaforo}`);
    lineas.push('');
  });

  return lineas.join('\n');
}
window.generarTXTRendimientoOperador = generarTXTRendimientoOperador;

function generarPDFRendimientoOperador(resultados, periodo, metaEficiencia) {
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
  doc.text('RENDIMIENTO POR OPERADOR', anchoPagina / 2, y, { align: 'center' });
  y += 10;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.obtenerFechaMexico().split('-').reverse().join('-')}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`META DE EFICIENCIA: ${metaEficiencia}%`, anchoPagina / 2, y, { align: 'center' });
  y += 12;

  resultados.forEach((op) => {
    saltoSiNecesario(20 + (op.filas.length + 1) * 8);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`OPERADOR: ${op.operador}`, 14, y);
    y += 5;
    lineaSeparadora();

    const body = op.filas.map((f) => [
      window.NOMBRE_PROCESO_UI[f.tipoProceso] || f.tipoProceso,
      String(f.procesos),
      `${formatearNumeroReporte(f.entrada)} kg`,
      `${formatearNumeroReporte(f.salida)} kg`,
      `${f.eficiencia.toFixed(1)}% ${f.semaforo}`
    ]);
    body.push([
      'TOTAL', String(op.total.procesos), `${formatearNumeroReporte(op.total.entrada)} kg`,
      `${formatearNumeroReporte(op.total.salida)} kg`, `${op.total.eficiencia.toFixed(1)}% ${op.total.semaforo}`
    ]);

    doc.autoTable({
      startY: y,
      head: [['PROCESO', 'PROCESOS', 'ENTRADA', 'SALIDA', 'EFICIENCIA']],
      body,
      headStyles: { fillColor: [0, 29, 61] },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === body.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
    y = doc.lastAutoTable.finalY + 10;
  });

  return doc;
}
window.generarPDFRendimientoOperador = generarPDFRendimientoOperador;

function construirFilasCSVRendimientoOperador(resultados) {
  const filas = [];
  resultados.forEach((op) => {
    op.filas.forEach((f) => filas.push({
      operador: op.operador,
      proceso: window.NOMBRE_PROCESO_UI[f.tipoProceso] || f.tipoProceso,
      procesos: f.procesos,
      entradaKg: Math.round(f.entrada * 100) / 100,
      salidaKg: Math.round(f.salida * 100) / 100,
      eficiencia: Math.round(f.eficiencia * 100) / 100
    }));
    filas.push({
      operador: op.operador,
      proceso: 'TOTAL',
      procesos: op.total.procesos,
      entradaKg: Math.round(op.total.entrada * 100) / 100,
      salidaKg: Math.round(op.total.salida * 100) / 100,
      eficiencia: Math.round(op.total.eficiencia * 100) / 100
    });
  });
  return filas;
}
window.construirFilasCSVRendimientoOperador = construirFilasCSVRendimientoOperador;

function construirMensajeRendimientoTelegram(periodo, materialResultado, operadorResultados, metaEficiencia) {
  const lineas = [];
  lineas.push(`📊 RENDIMIENTO — ${periodo.etiquetaPeriodo}`);
  lineas.push('');

  if (materialResultado) {
    lineas.push(`${materialResultado.material}:`);
    lineas.push(`• Aprovechamiento: ${materialResultado.aprovechamientoReal.toFixed(1)}% (esperado ${materialResultado.aprovechamientoEsperado.toFixed(1)}%)`);
    lineas.push(`• Diferencia: ${formatearPorcentajeConSigno(materialResultado.diferenciaAprovechamiento)} vs esperado`);
    lineas.push('');
  }

  if (operadorResultados && operadorResultados.length > 0) {
    lineas.push('OPERADORES:');
    operadorResultados.forEach((op) => {
      const ef = op.total.eficiencia;
      const extra = ef < metaEficiencia ? ` (meta: ${metaEficiencia}%)` : '';
      lineas.push(`• ${op.operador}: ${ef.toFixed(1)}% ${op.total.semaforo}${extra}`);
    });
    lineas.push('');
  }

  lineas.push('📄 Ver PDF adjunto para detalle completo');
  return lineas.join('\n');
}
window.construirMensajeRendimientoTelegram = construirMensajeRendimientoTelegram;

async function enviarReporteRendimientoTelegram(tipo, periodo, materialResultado, operadorResultados, metaEficiencia) {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  if (!configDoc.exists) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }
  const { token, chatId } = configDoc.data();
  if (!token || !chatId) {
    throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
  }

  const mensaje = construirMensajeRendimientoTelegram(periodo, materialResultado, operadorResultados, metaEficiencia);
  const formDataMensaje = new FormData();
  formDataMensaje.append('chat_id', chatId);
  formDataMensaje.append('text', mensaje);
  const respuestaMensaje = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    body: formDataMensaje
  });
  const resultadoMensaje = await respuestaMensaje.json();
  if (!resultadoMensaje.ok) {
    throw new Error(`Telegram rechazó el mensaje: ${resultadoMensaje.description || 'error desconocido'}`);
  }

  let doc, nombreArchivo;
  if (tipo === 'porMaterial') {
    doc = generarPDFRendimientoMaterial(materialResultado, periodo);
    nombreArchivo = `Rendimiento_${materialResultado.material}_${window.obtenerFechaMexico()}.pdf`;
  } else {
    doc = generarPDFRendimientoOperador(operadorResultados, periodo, metaEficiencia);
    nombreArchivo = `Rendimiento_Operadores_${window.obtenerFechaMexico()}.pdf`;
  }
  const pdfBlob = doc.output('blob');
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('document', pdfBlob, nombreArchivo);
  const respuestaDocumento = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: 'POST',
    body: formData
  });
  const resultadoDocumento = await respuestaDocumento.json();
  if (!resultadoDocumento.ok) {
    throw new Error(`Telegram rechazó el PDF: ${resultadoDocumento.description || 'error desconocido'}`);
  }
  return resultadoDocumento;
}
window.enviarReporteRendimientoTelegram = enviarReporteRendimientoTelegram;

})();
