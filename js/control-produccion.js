(function () {

const PROCESOS = {
  SELECCION:  { nombre: 'Selección',  icono: '🔍', outputPrincipal: 'Material separado' },
  EMPACADO:   { nombre: 'Empacado',   icono: '📦', outputPrincipal: 'Pacas' },
  MOLIENDA:   { nombre: 'Molienda',   icono: '⚙️', outputPrincipal: 'Material molido' },
  LAVADO:     { nombre: 'Lavado',     icono: '💧', outputPrincipal: 'Material limpio' },
  PELETIZADO: { nombre: 'Peletizado', icono: '🔵', outputPrincipal: 'Pellets' }
};

function generarSiguienteTicket(registros) {
  let maximo = 0;
  for (const registro of registros) {
    const match = String(registro.ticket || '').match(/^P-(\d+)$/);
    if (match) {
      const numero = Number(match[1]);
      if (numero > maximo) maximo = numero;
    }
  }
  return `P-${String(maximo + 1).padStart(3, '0')}`;
}

function calcularHorasTrabajo(fechaInicio, fechaFin) {
  const inicio = new Date(fechaInicio);
  const fin = new Date(fechaFin);
  return (fin - inicio) / 3600000;
}

function calcularEficiencia(kgPrincipal, totalInput) {
  if (totalInput <= 0) return 0;
  return (kgPrincipal / totalInput) * 100;
}

function calcularPorcentajeMerma(kgMerma, totalInput) {
  if (totalInput <= 0) return 0;
  return (kgMerma / totalInput) * 100;
}

function calcularProductividad(kgPrincipal, horasTrabajo) {
  if (horasTrabajo <= 0) return 0;
  return kgPrincipal / horasTrabajo;
}

function colorEficiencia(eficiencia) {
  if (eficiencia >= 90) return 'verde';
  if (eficiencia >= 80) return 'naranja';
  return 'rojo';
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fechaFin.slice(0, 10) === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fechaFin.slice(0, 10) >= inicioSemana);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const proceso = filtros.tipoProceso || '';
  const operador = (filtros.operador || '').toLowerCase();
  const turno = filtros.turno || '';
  return registros.filter((r) => {
    if (proceso && r.tipoProceso !== proceso) return false;
    if (operador && !String(r.operador).toLowerCase().includes(operador)) return false;
    if (turno && r.turno !== turno) return false;
    if (!dentroDeRangoFecha(r.fechaFin.slice(0, 10), filtros.desde, filtros.hasta)) return false;
    return true;
  });
}

function calcularStats(registros) {
  let totalInput = 0;
  let totalOutput = 0;
  let sumaEficiencia = 0;
  for (const registro of registros) {
    totalInput += Number(registro.totalInput) || 0;
    totalOutput += Number(registro.totalOutput) || 0;
    sumaEficiencia += Number(registro.eficiencia) || 0;
  }
  const eficienciaPromedio = registros.length > 0 ? sumaEficiencia / registros.length : 0;
  return { totalRegistros: registros.length, totalInput, totalOutput, eficienciaPromedio };
}

function construirRegistroDesdeFormulario(datos) {
  if (!datos.tipoProceso || !PROCESOS[datos.tipoProceso]) {
    throw new Error('Selecciona un tipo de proceso válido');
  }
  if (!Array.isArray(datos.inputs) || datos.inputs.length === 0) {
    throw new Error('Agrega al menos un material de entrada');
  }
  const inputs = datos.inputs.map((input) => {
    if (!input.material) {
      throw new Error('Todos los materiales de entrada son obligatorios');
    }
    const kg = Number(input.kg);
    if (!Number.isFinite(kg) || kg <= 0) {
      throw new Error('Kg de cada material de entrada debe ser un número mayor a 0');
    }
    return {
      material: input.material,
      kg,
      ticketOrigen: input.ticketOrigen ? input.ticketOrigen.trim() : ''
    };
  });
  if (!datos.materialPrincipal) {
    throw new Error('El material principal de salida es obligatorio');
  }
  const kgPrincipal = Number(datos.kgPrincipal);
  if (!Number.isFinite(kgPrincipal) || kgPrincipal <= 0) {
    throw new Error('Kg del material principal debe ser un número mayor a 0');
  }
  const kgMerma = Number(datos.kgMerma);
  if (!Number.isFinite(kgMerma) || kgMerma < 0) {
    throw new Error('Kg de merma debe ser un número mayor o igual a 0');
  }
  if (!datos.operador || !datos.turno || !datos.fechaInicio || !datos.fechaFin) {
    throw new Error('Operador, turno y fechas son obligatorios');
  }
  const horasTrabajo = calcularHorasTrabajo(datos.fechaInicio, datos.fechaFin);
  if (!Number.isFinite(horasTrabajo) || horasTrabajo <= 0) {
    throw new Error('La fecha de fin debe ser posterior a la fecha de inicio');
  }
  const totalInput = inputs.reduce((suma, input) => suma + input.kg, 0);
  const totalOutput = kgPrincipal + kgMerma;
  return {
    tipoProceso: datos.tipoProceso,
    inputs,
    outputs: {
      principal: { material: datos.materialPrincipal, kg: kgPrincipal },
      merma: { kg: kgMerma }
    },
    operador: datos.operador,
    turno: datos.turno,
    fechaInicio: datos.fechaInicio,
    fechaFin: datos.fechaFin,
    horasTrabajo,
    totalInput,
    totalOutput,
    eficiencia: calcularEficiencia(kgPrincipal, totalInput),
    porcentajeMerma: calcularPorcentajeMerma(kgMerma, totalInput),
    productividad: calcularProductividad(kgPrincipal, horasTrabajo),
    observaciones: datos.observaciones || ''
  };
}

window.EVE_CONTROL_PRODUCCION = {
  PROCESOS,
  generarSiguienteTicket,
  calcularHorasTrabajo,
  calcularEficiencia,
  calcularPorcentajeMerma,
  calcularProductividad,
  colorEficiencia,
  filtrarPorHoy,
  filtrarPorSemana,
  aplicarFiltrosTodos,
  calcularStats,
  construirRegistroDesdeFormulario
};

})();
