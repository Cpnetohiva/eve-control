(function () {

function esMaterialPZProduccion(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function calcularStatsProduccion(registros) {
  let totalKg = 0;
  let totalPz = 0;
  for (const registro of registros) {
    if (esMaterialPZProduccion(registro.material)) {
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

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const cliente = (filtros.cliente || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (cliente && !String(r.cliente).toLowerCase().includes(cliente)) return false;
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
  if (!datos.cliente || !datos.material || !datos.fechaEntrada || !datos.fechaSalida) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  return {
    ticket: 'P',
    cliente: datos.cliente,
    material: datos.material,
    kg,
    fechaEntrada: datos.fechaEntrada,
    fechaSalida: datos.fechaSalida
  };
}

window.calcularStatsProduccion = calcularStatsProduccion;
window.filtrarPorHoyProduccion = filtrarPorHoy;
window.filtrarPorSemanaProduccion = filtrarPorSemana;
window.aplicarFiltrosTodosProduccion = aplicarFiltrosTodos;
window.valoresUnicosProduccion = valoresUnicos;
window.construirRegistroDesdeFormularioProduccion = construirRegistroDesdeFormulario;

})();
