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
    const actual = mapa.get(registro.material) || 0;
    mapa.set(registro.material, actual + (Number(registro.kg) || 0));
  }
  return Array.from(mapa.entries())
    .map(([material, kg]) => ({ material, kg, unidad: esMaterialPZReporte(material) ? 'PZ' : 'KG' }))
    .sort((a, b) => b.kg - a.kg);
}

function agregarPorProveedor(registros) {
  const mapaProveedores = new Map();
  for (const registro of registros) {
    if (!mapaProveedores.has(registro.proveedor)) {
      mapaProveedores.set(registro.proveedor, new Map());
    }
    const mapaMateriales = mapaProveedores.get(registro.proveedor);
    const actual = mapaMateriales.get(registro.material) || 0;
    mapaMateriales.set(registro.material, actual + (Number(registro.kg) || 0));
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

function obtenerDatosPeriodo(desde, hasta) {
  return {
    destaraje: window.EVE.registrosDestaraje.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    ventas: window.EVE.registrosVentas.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    produccion: window.EVE.registrosProduccion.filter((r) => dentroDeRangoReporte(r.fechaSalida, desde, hasta)),
    pagos: window.EVE.registrosPagos.filter((r) => dentroDeRangoReporte(r.fecha, desde, hasta))
  };
}

function construirDetalleTickets(datos) {
  const filas = [];
  datos.destaraje.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor, material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada, fechaSalida: r.fechaSalida
  }));
  datos.produccion.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.cliente, material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada, fechaSalida: r.fechaSalida
  }));
  datos.ventas.forEach((r) => filas.push({
    ticket: r.ticket, proveedor: r.proveedor, material: r.material, kg: r.kg,
    fechaEntrada: r.fechaEntrada, fechaSalida: r.fechaSalida
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

})();
