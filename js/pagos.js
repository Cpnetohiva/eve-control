(function () {

function calcularStats(registros) {
  let totalKg = 0;
  for (const registro of registros) {
    totalKg += Number(registro.kg) || 0;
  }
  return { totalRegistros: registros.length, totalKg };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fecha === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fecha >= inicioSemana);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const ticket = (filtros.ticket || '').toLowerCase();
  const proveedor = (filtros.proveedor || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (ticket && !String(r.ticket).toLowerCase().includes(ticket)) return false;
    if (proveedor && !String(r.proveedor).toLowerCase().includes(proveedor)) return false;
    if (material && !String(r.material).toLowerCase().includes(material)) return false;
    if (!dentroDeRangoFecha(r.fecha, filtros.desde, filtros.hasta)) return false;
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
  if (!datos.ticket || !datos.proveedor || !datos.material || !datos.fecha) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  const precioPorKg = Number(datos.precioPorKg);
  if (!Number.isFinite(precioPorKg) || precioPorKg <= 0) {
    throw new Error('Precio/Kg debe ser un número mayor a 0');
  }
  const pagado = Number(datos.pagado);
  if (!Number.isFinite(pagado) || pagado < 0) {
    throw new Error('Pagado debe ser un número mayor o igual a 0');
  }
  return {
    ticket: datos.ticket,
    proveedor: datos.proveedor,
    material: datos.material,
    kg,
    precioPorKg,
    total: kg * precioPorKg,
    pagado,
    fecha: datos.fecha
  };
}

function construirMinistracionDesdeFormulario(datos) {
  if (!datos.fecha) {
    throw new Error('La fecha es obligatoria');
  }
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('Monto debe ser un número mayor a 0');
  }
  return {
    monto,
    fecha: datos.fecha,
    semana: window.obtenerSemanaISO(datos.fecha)
  };
}

function calcularControlFlujo(pagosSemana, ministracionesSemana) {
  let totalMinistrado = 0;
  for (const m of ministracionesSemana) {
    totalMinistrado += Number(m.monto) || 0;
  }
  let totalPagado = 0;
  for (const p of pagosSemana) {
    totalPagado += Number(p.pagado) || 0;
  }
  const saldoDisponible = totalMinistrado - totalPagado;
  const porcentajeEjecutado = totalMinistrado > 0 ? (totalPagado / totalMinistrado) * 100 : 0;
  return { totalMinistrado, totalPagado, saldoDisponible, porcentajeEjecutado };
}

window.EVE_PAGOS = {
  calcularStats,
  filtrarPorHoy,
  filtrarPorSemana,
  aplicarFiltrosTodos,
  valoresUnicos,
  construirRegistroDesdeFormulario,
  construirMinistracionDesdeFormulario,
  calcularControlFlujo
};

})();
