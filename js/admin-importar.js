(function () {

function validarFormatoFecha(texto) {
  if (typeof texto !== 'string') return false;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(texto.trim());
  if (!match) return false;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const fecha = new Date(anio, mes - 1, dia);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
}

function convertirFechaAISO(texto) {
  const [dia, mes, anio] = texto.trim().split('-');
  return `${anio}-${mes}-${dia}`;
}

function normalizarFecha(valor) {
  if (valor instanceof Date) {
    const dia = String(valor.getDate()).padStart(2, '0');
    const mes = String(valor.getMonth() + 1).padStart(2, '0');
    const anio = valor.getFullYear();
    return `${dia}-${mes}-${anio}`;
  }
  return String(valor ?? '').trim();
}

function validarFormatoFechaHora(texto) {
  if (typeof texto !== 'string') return false;
  const match = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/.exec(texto.trim());
  if (!match) return false;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const anio = Number(match[3]);
  const horas = Number(match[4]);
  const minutos = Number(match[5]);
  if (mes < 1 || mes > 12 || dia < 1 || horas > 23 || minutos > 59) return false;
  const fecha = new Date(anio, mes - 1, dia, horas, minutos);
  return fecha.getFullYear() === anio && fecha.getMonth() === mes - 1 && fecha.getDate() === dia;
}

function convertirFechaHoraAISO(texto) {
  const [fechaParte, horaParte] = texto.trim().split(/\s+/);
  const [dia, mes, anio] = fechaParte.split('-');
  return `${anio}-${mes}-${dia}T${horaParte}`;
}

function normalizarFechaHora(valor) {
  if (valor instanceof Date) {
    const dia = String(valor.getDate()).padStart(2, '0');
    const mes = String(valor.getMonth() + 1).padStart(2, '0');
    const anio = valor.getFullYear();
    const horas = String(valor.getHours()).padStart(2, '0');
    const minutos = String(valor.getMinutes()).padStart(2, '0');
    return `${dia}-${mes}-${anio} ${horas}:${minutos}`;
  }
  return String(valor ?? '').trim();
}

window.EVE_ADMIN_IMPORTAR = {
  validarFormatoFecha,
  convertirFechaAISO,
  validarFormatoFechaHora,
  convertirFechaHoraAISO
};

function esFilaVacia(fila) {
  return Object.values(fila).every((valor) => String(valor ?? '').trim() === '');
}

function procesarFilaDestaraje(fila) {
  const fechaEntradaTexto = normalizarFecha(fila['Fecha Entrada']);
  const fechaSalidaTexto = normalizarFecha(fila['Fecha Salida']);
  if (!validarFormatoFecha(fechaEntradaTexto) || !validarFormatoFecha(fechaSalidaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  const ticket = String(fila.Ticket ?? '').trim();
  if (!/^\d+$/.test(ticket)) {
    return { valido: false, motivo: 'Ticket debe ser numérico', registro: null, original: fila };
  }
  try {
    const registro = window.construirRegistroDesdeFormulario({
      ticket,
      proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      fechaEntrada: convertirFechaAISO(fechaEntradaTexto),
      fechaSalida: convertirFechaAISO(fechaSalidaTexto)
    });
    return { valido: true, motivo: null, registro, original: fila };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarFilaPagos(fila) {
  const fechaTexto = normalizarFecha(fila.Fecha);
  if (!validarFormatoFecha(fechaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  try {
    const registro = window.EVE_PAGOS.construirRegistroDesdeFormulario({
      ticket: String(fila.Ticket ?? '').trim(),
      proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
      material: String(fila.Material ?? '').trim().toUpperCase(),
      kg: fila.Kg,
      precioPorKg: fila['Precio/Kg'],
      pagado: fila.Pagado,
      fecha: convertirFechaAISO(fechaTexto)
    });
    const cxp = (window.EVE.cuentasPorPagar || []).find((c) => String(c.ticket) === String(registro.ticket));
    const info = cxp ? `Vinculado a CxP (ticket ${cxp.ticket})` : 'Sin CxP vinculada';
    return { valido: true, motivo: null, registro, original: fila, info };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function usuarioActual() {
  return (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function siguienteNumeroSaldoInicial() {
  const patron = /^SALDO-(\d+)$/;
  let maximo = 0;
  (window.EVE.cuentasPorPagar || []).forEach((c) => {
    const match = patron.exec(String(c.ticket));
    if (match) maximo = Math.max(maximo, Number(match[1]));
  });
  return maximo;
}

function procesarFilaSaldoInicial(fila, indice) {
  const proveedor = String(fila.Proveedor ?? '').trim().toUpperCase();
  if (!proveedor) {
    return { valido: false, motivo: 'Proveedor es obligatorio', registro: null, original: fila };
  }
  const saldoPendiente = Number(fila['Saldo Pendiente']);
  if (!(saldoPendiente > 0)) {
    return { valido: false, motivo: 'Saldo Pendiente debe ser numérico mayor a 0', registro: null, original: fila };
  }
  const pagadoTexto = fila.Pagado;
  const pagado = pagadoTexto === '' || pagadoTexto == null ? 0 : Number(pagadoTexto);
  if (Number.isNaN(pagado) || pagado < 0) {
    return { valido: false, motivo: 'Pagado debe ser numérico mayor o igual a 0', registro: null, original: fila };
  }
  const fechaTexto = normalizarFecha(fila['Fecha Ticket']);
  let fechaTicket;
  if (fechaTexto === '') {
    fechaTicket = window.EVE_CXP.fechaCorteVigente();
  } else if (validarFormatoFecha(fechaTexto)) {
    fechaTicket = convertirFechaAISO(fechaTexto);
  } else {
    return { valido: false, motivo: 'Fecha Ticket debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  const total = pagado + saldoPendiente;
  const registro = {
    ticket: `SALDO-${siguienteNumeroSaldoInicial() + indice + 1}`,
    proveedor,
    material: 'VARIOS',
    kg: 0,
    fechaTicket,
    precioAplicado: null,
    comisionPorKg: 0,
    precioEfectivo: null,
    montoMaterial: 0,
    montoComision: 0,
    total,
    pagado,
    saldo: saldoPendiente,
    estado: window.EVE_CXP.calcularEstado(pagado, saldoPendiente),
    origenAuditoria: false,
    idAuditoria: null,
    idFotoAuditoria: null,
    aprobacion: { tipo: 'saldo_inicial', motivo: 'Carga de saldo inicial histórico', aprobadoPor: usuarioActual(), fecha: window.obtenerFechaMexico() },
    abonos: [],
    precioNegociado: null,
    motivoAjustePrecio: null,
    creadoPor: usuarioActual()
  };
  return { valido: true, motivo: null, registro, original: fila };
}

const TURNOS_VALIDOS_CP = ['Matutino', 'Vespertino', 'Nocturno'];
const CAMPOS_CONSISTENTES_CP = ['Tipo Proceso', 'Operador', 'Turno', 'Fecha Inicio', 'Fecha Fin'];

function normalizarTipoFilaCP(valor) {
  return String(valor ?? '').trim().toUpperCase();
}

function esValorAfirmativoCP(valor) {
  const texto = String(valor ?? '').trim().toUpperCase();
  return texto === 'SI' || texto === 'SÍ' || texto === 'TRUE' || texto === '1' || texto === 'X';
}

function validarTiposFilaGrupoCP(grupo) {
  const tipos = grupo.filas.map(({ fila }) => normalizarTipoFilaCP(fila['Tipo Fila']));
  const invalido = tipos.find((t) => t !== 'ENTRADA' && t !== 'SALIDA');
  if (invalido !== undefined) {
    return `"Tipo Fila" debe ser ENTRADA o SALIDA (valor recibido: "${invalido}")`;
  }
  if (!tipos.includes('ENTRADA')) return 'El grupo necesita al menos una fila ENTRADA';
  if (!tipos.includes('SALIDA')) return 'El grupo necesita al menos una fila SALIDA';
  return null;
}

function agruparFilasControlProduccion(filas) {
  const grupos = [];
  const indicePorClave = new Map();
  filas.forEach((fila, indiceOriginal) => {
    const clave = String(fila['Grupo/Proceso'] ?? '').trim();
    if (clave === '') {
      grupos.push({ clave: null, filas: [{ fila, indiceOriginal }] });
      return;
    }
    if (indicePorClave.has(clave)) {
      grupos[indicePorClave.get(clave)].filas.push({ fila, indiceOriginal });
    } else {
      indicePorClave.set(clave, grupos.length);
      grupos.push({ clave, filas: [{ fila, indiceOriginal }] });
    }
  });
  return grupos;
}

function validarConsistenciaGrupoCP(grupo) {
  const filasGrupo = grupo.filas;
  for (const campo of CAMPOS_CONSISTENTES_CP) {
    const valorRef = String(filasGrupo[0].fila[campo] ?? '').trim();
    for (let i = 1; i < filasGrupo.length; i++) {
      const valorActual = String(filasGrupo[i].fila[campo] ?? '').trim();
      if (valorActual !== valorRef) {
        const filaExcel = filasGrupo[i].indiceOriginal + 2;
        const etiquetaGrupo = grupo.clave || `fila ${filaExcel}`;
        return `Grupo "${etiquetaGrupo}", fila ${filaExcel}: "${campo}" no coincide con el resto del grupo`;
      }
    }
  }
  return null;
}

function construirDatosFormularioCP(grupo, fechaInicioISO, fechaFinISO) {
  const primera = grupo.filas[0].fila;
  const filasEntrada = grupo.filas.filter(({ fila }) => normalizarTipoFilaCP(fila['Tipo Fila']) === 'ENTRADA');
  const filasSalida = grupo.filas.filter(({ fila }) => normalizarTipoFilaCP(fila['Tipo Fila']) === 'SALIDA');
  return {
    tipoProceso: String(primera['Tipo Proceso'] ?? '').trim().toUpperCase(),
    inputs: filasEntrada.map(({ fila }) => ({
      material: String(fila['Material'] ?? '').trim().toUpperCase(),
      kg: fila['Kg'],
      ticketOrigen: String(fila['Ticket Origen'] ?? '').trim()
    })),
    outputs: filasSalida.map(({ fila }) => ({
      material: String(fila['Material'] ?? '').trim().toUpperCase(),
      kg: fila['Kg'],
      esMerma: esValorAfirmativoCP(fila['Es Merma'])
    })),
    operador: String(primera['Operador'] ?? '').trim().toUpperCase(),
    turno: String(primera['Turno'] ?? '').trim(),
    fechaInicio: fechaInicioISO,
    fechaFin: fechaFinISO
  };
}

function ticketExisteEnSistemaCP(ticket, ticketsAsignadosEnArchivo) {
  const ticketNormalizado = String(ticket).trim();
  if (ticketsAsignadosEnArchivo.has(ticketNormalizado)) return true;
  if (window.EVE.registrosDestaraje.some((r) => String(r.ticket) === ticketNormalizado)) return true;
  if (window.EVE.registrosControlProduccion.some((r) => String(r.ticket) === ticketNormalizado)) return true;
  return false;
}

function construirOriginalPreviewCP(grupo, registro) {
  if (!registro) {
    const primera = grupo.filas[0].fila;
    const entradas = grupo.filas.filter(({ fila }) => normalizarTipoFilaCP(fila['Tipo Fila']) === 'ENTRADA');
    const salidas = grupo.filas.filter(({ fila }) => normalizarTipoFilaCP(fila['Tipo Fila']) === 'SALIDA');
    return {
      'Grupo/Proceso': grupo.clave || '(individual)',
      'Tipo Proceso': primera['Tipo Proceso'],
      Entradas: entradas.map(({ fila }) => `${fila['Material']} ${fila['Kg']}kg${fila['Ticket Origen'] ? ' <- ' + fila['Ticket Origen'] : ''}`).join(' | '),
      Salidas: salidas.map(({ fila }) => `${fila['Material']} ${fila['Kg']}kg${esValorAfirmativoCP(fila['Es Merma']) ? ' (merma)' : ''}`).join(' | '),
      Operador: primera['Operador'],
      Turno: primera['Turno'],
      'Fecha Inicio': primera['Fecha Inicio'],
      'Fecha Fin': primera['Fecha Fin']
    };
  }
  return {
    Ticket: registro.ticket,
    'Grupo/Proceso': grupo.clave || '(individual)',
    'Tipo Proceso': registro.tipoProceso,
    Entradas: registro.inputs.map((i) => `${i.material} ${i.kg}kg${i.ticketOrigen ? ' <- ' + i.ticketOrigen : ''}`).join(' | '),
    Salidas: registro.outputs.map((o) => `${o.material} ${o.kg}kg${o.esMerma ? ' (merma)' : ''}`).join(' | '),
    Operador: registro.operador,
    Turno: registro.turno,
    'Fecha Inicio': registro.fechaInicio,
    'Fecha Fin': registro.fechaFin
  };
}

function procesarHojaControlProduccion(filasCrudas) {
  const filasNoVacias = filasCrudas.filter((fila) => !esFilaVacia(fila));
  const grupos = agruparFilasControlProduccion(filasNoVacias);

  const preliminares = grupos.map((grupo) => {
    const errorConsistencia = validarConsistenciaGrupoCP(grupo);
    if (errorConsistencia) {
      return { grupo, valido: false, motivo: errorConsistencia, registroSinTicket: null };
    }
    const errorTiposFila = validarTiposFilaGrupoCP(grupo);
    if (errorTiposFila) {
      return { grupo, valido: false, motivo: errorTiposFila, registroSinTicket: null };
    }
    const primera = grupo.filas[0].fila;
    const turno = String(primera.Turno ?? '').trim();
    if (!TURNOS_VALIDOS_CP.includes(turno)) {
      return { grupo, valido: false, motivo: `Turno debe ser uno de: ${TURNOS_VALIDOS_CP.join(', ')}`, registroSinTicket: null };
    }
    const fechaInicioTexto = normalizarFechaHora(primera['Fecha Inicio']);
    const fechaFinTexto = normalizarFechaHora(primera['Fecha Fin']);
    if (!validarFormatoFechaHora(fechaInicioTexto) || !validarFormatoFechaHora(fechaFinTexto)) {
      return { grupo, valido: false, motivo: 'Fecha Inicio/Fecha Fin debe tener el formato DD-MM-AAAA HH:mm', registroSinTicket: null };
    }
    const datosFormulario = construirDatosFormularioCP(grupo, convertirFechaHoraAISO(fechaInicioTexto), convertirFechaHoraAISO(fechaFinTexto));
    try {
      const registroSinTicket = window.EVE_CONTROL_PRODUCCION.construirRegistroDesdeFormulario(datosFormulario);
      return { grupo, valido: true, motivo: null, registroSinTicket };
    } catch (error) {
      return { grupo, valido: false, motivo: error.message, registroSinTicket: null };
    }
  });

  let siguienteNumero = 0;
  window.EVE.registrosControlProduccion.forEach((r) => {
    const match = String(r.ticket || '').match(/^P-(\d+)$/);
    if (match) siguienteNumero = Math.max(siguienteNumero, Number(match[1]));
  });
  const ticketsAsignadosEnArchivo = new Set();
  preliminares.forEach((resultado) => {
    if (!resultado.valido) return;
    siguienteNumero += 1;
    resultado.ticket = `P-${String(siguienteNumero).padStart(3, '0')}`;
    ticketsAsignadosEnArchivo.add(resultado.ticket);
  });

  return preliminares.map((resultado) => {
    if (!resultado.valido) {
      return { valido: false, motivo: resultado.motivo, registro: null, original: construirOriginalPreviewCP(resultado.grupo, null) };
    }
    const registro = { ticket: resultado.ticket, ...resultado.registroSinTicket };
    const ticketsFaltantes = registro.inputs
      .map((input) => input.ticketOrigen)
      .filter((ticketOrigen) => ticketOrigen && !ticketExisteEnSistemaCP(ticketOrigen, ticketsAsignadosEnArchivo));
    const info = ticketsFaltantes.length > 0
      ? `Ticket(s) origen no encontrados: ${[...new Set(ticketsFaltantes)].join(', ')}`
      : null;
    return { valido: true, motivo: null, registro, original: construirOriginalPreviewCP(resultado.grupo, registro), info };
  });
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  esFilaVacia,
  procesarFilaDestaraje,
  procesarFilaPagos,
  procesarFilaSaldoInicial,
  procesarHojaControlProduccion
});

function procesarHoja(filasCrudas, procesador) {
  return filasCrudas.filter((fila) => !esFilaVacia(fila)).map((fila, indice) => procesador(fila, indice));
}

function contarResumenHoja(filasProcesadas) {
  const validas = filasProcesadas.filter((f) => f.valido).length;
  return { validas, invalidas: filasProcesadas.length - validas };
}

function obtenerRegistrosValidos(filasProcesadas) {
  return filasProcesadas.filter((f) => f.valido).map((f) => f.registro);
}

function hojaCalificaParaReemplazo(filasProcesadas) {
  return filasProcesadas.some((f) => f.valido);
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  procesarHoja,
  contarResumenHoja,
  obtenerRegistrosValidos,
  hojaCalificaParaReemplazo
});

function aplicarFormatoFecha(hoja, columnas, filaInicio, filaFin) {
  const rangoActual = XLSX.utils.decode_range(hoja['!ref']);
  columnas.forEach((col) => {
    for (let fila = filaInicio; fila <= filaFin; fila++) {
      const ref = XLSX.utils.encode_cell({ r: fila, c: col });
      if (!hoja[ref]) {
        hoja[ref] = { t: 'z' };
      }
      hoja[ref].z = 'dd-mm-yyyy';
    }
  });
  hoja['!ref'] = XLSX.utils.encode_range({
    s: { r: Math.min(rangoActual.s.r, filaInicio), c: rangoActual.s.c },
    e: { r: Math.max(rangoActual.e.r, filaFin), c: rangoActual.e.c }
  });
}

function generarPlantilla() {
  const libro = XLSX.utils.book_new();
  const fechaEjemploEntrada = new Date(2026, 5, 24);
  const fechaEjemploSalida = new Date(2026, 5, 25);

  const destaraje = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Proveedor', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
    ['9260', 'JOSE ENRIQUE', 'MIXTO', 1000, fechaEjemploEntrada, fechaEjemploSalida]
  ]);
  aplicarFormatoFecha(destaraje, [4, 5], 1, 200);

  const pagos = XLSX.utils.aoa_to_sheet([
    ['Ticket', 'Proveedor', 'Material', 'Kg', 'Precio/Kg', 'Total', 'Pagado', 'Fecha'],
    ['9260', 'JOSE ENRIQUE', 'MIXTO', 1000, 5, 5000, 4000, fechaEjemploEntrada]
  ]);
  aplicarFormatoFecha(pagos, [7], 1, 200);

  const saldosIniciales = XLSX.utils.aoa_to_sheet([
    ['Proveedor', 'Saldo Pendiente', 'Pagado', 'Fecha Ticket'],
    ['ACOPIO NORTE', 8000, 0, ''],
    ['ACOPIO SUR', 5000, 2000, fechaEjemploEntrada]
  ]);
  aplicarFormatoFecha(saldosIniciales, [3], 1, 200);

  const controlProduccion = XLSX.utils.aoa_to_sheet([
    ['Grupo/Proceso', 'Tipo Proceso', 'Tipo Fila', 'Material', 'Kg', 'Ticket Origen', 'Es Merma', 'Operador', 'Turno', 'Fecha Inicio', 'Fecha Fin'],
    ['MOL-001', 'MOLIENDA', 'ENTRADA', 'MIXTO', 500, '9260', '', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['MOL-001', 'MOLIENDA', 'ENTRADA', 'PET LIMPIO', 300, '', '', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['MOL-001', 'MOLIENDA', 'SALIDA', 'MOLIDO PET', 480, '', 'NO', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['MOL-001', 'MOLIENDA', 'SALIDA', 'MERMA', 20, '', 'SI', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['SEL-001', 'SELECCION', 'ENTRADA', 'MIXTO', 200, '9261', '', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'CRISTAL SIN ETIQUETA', 100, '', 'NO', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'LECHERO', 55, '', 'NO', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'ETIQUETA', 30, '', 'NO', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'BASURA', 15, '', 'SI', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00']
  ]);

  XLSX.utils.book_append_sheet(libro, destaraje, 'Destaraje');
  XLSX.utils.book_append_sheet(libro, pagos, 'Pagos');
  XLSX.utils.book_append_sheet(libro, saldosIniciales, 'SaldosIniciales');
  XLSX.utils.book_append_sheet(libro, controlProduccion, 'ControlProduccion');
  XLSX.writeFile(libro, 'Plantilla_Importacion_EVE.xlsx');
}

function leerArchivoExcel(arrayBuffer) {
  const libro = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
  const NOMBRES_HOJA = ['Destaraje', 'Pagos', 'SaldosIniciales'];
  const faltantes = NOMBRES_HOJA.filter((nombre) => !libro.Sheets[nombre]);
  if (faltantes.length > 0) {
    throw new Error(`El archivo no tiene la(s) hoja(s): ${faltantes.join(', ')}`);
  }
  return {
    destaraje: XLSX.utils.sheet_to_json(libro.Sheets.Destaraje, { defval: '' }),
    pagos: XLSX.utils.sheet_to_json(libro.Sheets.Pagos, { defval: '' }),
    saldosIniciales: XLSX.utils.sheet_to_json(libro.Sheets.SaldosIniciales, { defval: '' }),
    controlProduccion: libro.Sheets.ControlProduccion
      ? XLSX.utils.sheet_to_json(libro.Sheets.ControlProduccion, { defval: '' })
      : []
  };
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  generarPlantilla,
  leerArchivoExcel
});

const PROCESADORES_HOJA = {
  destaraje: procesarFilaDestaraje,
  pagos: procesarFilaPagos,
  saldosIniciales: procesarFilaSaldoInicial
};

const COLECCION_POR_HOJA = {
  destaraje: 'destaraje',
  pagos: 'pagos',
  saldosIniciales: 'cuentas_por_pagar',
  controlProduccion: 'control_produccion'
};

const HOJAS_CON_REEMPLAZO = ['destaraje', 'pagos'];
const HOJAS_A_IMPORTAR = [...Object.keys(PROCESADORES_HOJA), 'controlProduccion'];

let modoActual = 'agregar';
let resultadoParseo = null;

function obtenerArrayExistente(hoja) {
  if (hoja === 'destaraje') return [...window.EVE.registrosDestaraje, ...window.EVE.registrosVentas];
  return window.EVE.registrosPagos;
}

async function ejecutarOperacionesEnLotes(operaciones) {
  const TAMANO_LOTE = 500;
  for (let inicio = 0; inicio < operaciones.length; inicio += TAMANO_LOTE) {
    const grupo = operaciones.slice(inicio, inicio + TAMANO_LOTE);
    const lote = window.db.batch();
    grupo.forEach((operacion) => {
      if (operacion.tipo === 'delete') {
        lote.delete(window.db.collection(operacion.coleccion).doc(operacion.id));
      } else {
        const datosCompletos = { ...operacion.datos };
        if (!datosCompletos.fechaRegistro) {
          datosCompletos.fechaRegistro = new Date().toISOString();
        }
        lote.set(window.db.collection(operacion.coleccion).doc(), datosCompletos);
      }
    });
    await lote.commit();
  }
}

function construirColumnasPreview(filasProcesadas) {
  if (filasProcesadas.length === 0) return [];
  return Object.keys(filasProcesadas[0].original);
}

function renderizarTablaHoja(contenedor, etiqueta, filasProcesadas) {
  const resumen = contarResumenHoja(filasProcesadas);
  const titulo = document.createElement('p');
  titulo.textContent = `${etiqueta}: ${resumen.validas} válidas, ${resumen.invalidas} con error`;
  contenedor.appendChild(titulo);

  if (filasProcesadas.length === 0) return;

  const columnas = construirColumnasPreview(filasProcesadas);
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  const encabezado = document.createElement('tr');
  columnas.concat(['Estado']).forEach((nombreColumna) => {
    const celda = document.createElement('th');
    celda.textContent = nombreColumna;
    encabezado.appendChild(celda);
  });
  const cabecera = document.createElement('thead');
  cabecera.appendChild(encabezado);
  tabla.appendChild(cabecera);

  const cuerpo = document.createElement('tbody');
  filasProcesadas.forEach((filaProcesada) => {
    const fila = document.createElement('tr');
    columnas.forEach((nombreColumna) => {
      const celda = document.createElement('td');
      celda.textContent = String(filaProcesada.original[nombreColumna] ?? '');
      fila.appendChild(celda);
    });
    const celdaEstado = document.createElement('td');
    celdaEstado.textContent = filaProcesada.valido ? (filaProcesada.info ? `✓ ${filaProcesada.info}` : '✓') : filaProcesada.motivo;
    fila.appendChild(celdaEstado);
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);

  const envoltura = document.createElement('div');
  envoltura.className = 'destaraje-tabla-wrapper';
  envoltura.appendChild(tabla);
  contenedor.appendChild(envoltura);
}

function renderizarVistaPrevia() {
  const contenedor = document.getElementById('ai-vista-previa');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  if (!resultadoParseo) return;
  renderizarTablaHoja(contenedor, 'Destaraje', resultadoParseo.destaraje);
  renderizarTablaHoja(contenedor, 'Pagos', resultadoParseo.pagos);
  renderizarTablaHoja(contenedor, 'Saldos Iniciales', resultadoParseo.saldosIniciales);
  renderizarTablaHoja(contenedor, 'Control Producción', resultadoParseo.controlProduccion);
}

function actualizarBotonConfirmar() {
  const boton = document.getElementById('ai-confirmar-importacion');
  if (!boton) return;
  if (!resultadoParseo) {
    boton.disabled = true;
    return;
  }
  if (modoActual === 'reemplazar') {
    const texto = document.getElementById('ai-confirmar-texto').value;
    boton.disabled = texto !== 'CONFIRMAR';
  } else {
    boton.disabled = false;
  }
}

function manejarCambioModo(nuevoModo) {
  modoActual = nuevoModo;
  document.getElementById('ai-confirmar-texto').style.display = nuevoModo === 'reemplazar' ? '' : 'none';
  document.getElementById('ai-confirmar-texto').value = '';
  actualizarBotonConfirmar();
}

function manejarDescargarPlantilla() {
  generarPlantilla();
}

function manejarSeleccionArchivo(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = () => {
    try {
      const datosHojas = leerArchivoExcel(lector.result);
      resultadoParseo = {
        destaraje: procesarHoja(datosHojas.destaraje, PROCESADORES_HOJA.destaraje),
        pagos: procesarHoja(datosHojas.pagos, PROCESADORES_HOJA.pagos),
        saldosIniciales: procesarHoja(datosHojas.saldosIniciales, PROCESADORES_HOJA.saldosIniciales),
        controlProduccion: procesarHojaControlProduccion(datosHojas.controlProduccion)
      };
      renderizarVistaPrevia();
      actualizarBotonConfirmar();
    } catch (error) {
      resultadoParseo = null;
      renderizarVistaPrevia();
      actualizarBotonConfirmar();
      window.showError(error.message);
    }
  };
  lector.readAsArrayBuffer(archivo);
}

async function sincronizarPagosConCxP(filasProcesadas) {
  for (const filaProcesada of filasProcesadas) {
    if (!filaProcesada.valido) continue;
    const registro = filaProcesada.registro;
    const cxp = window.EVE.cuentasPorPagar.find((c) => String(c.ticket) === String(registro.ticket));
    if (!cxp) continue;
    try {
      await window.EVE_CXP.actualizarAbonoCxP(cxp.id, {
        monto: registro.pagado,
        fecha: registro.fecha,
        referencia: 'Importado desde Excel (Pagos)',
        registradoPor: usuarioActual(),
        fechaRegistro: new Date().toISOString()
      });
    } catch (error) {
      console.error('No se pudo sincronizar el pago importado con CxP', registro.ticket, error);
    }
  }
}

async function manejarConfirmarImportacion() {
  document.getElementById('ai-confirmar-importacion').disabled = true;
  try {
    for (const hoja of HOJAS_A_IMPORTAR) {
      const filasProcesadas = resultadoParseo[hoja];
      const registrosValidos = obtenerRegistrosValidos(filasProcesadas);
      if (registrosValidos.length === 0) continue;
      const operaciones = [];
      if (modoActual === 'reemplazar' && HOJAS_CON_REEMPLAZO.includes(hoja) && hojaCalificaParaReemplazo(filasProcesadas)) {
        obtenerArrayExistente(hoja).forEach((registroExistente) => {
          operaciones.push({ tipo: 'delete', coleccion: COLECCION_POR_HOJA[hoja], id: registroExistente.id });
        });
      }
      registrosValidos.forEach((registro) => {
        operaciones.push({ tipo: 'set', coleccion: COLECCION_POR_HOJA[hoja], datos: registro });
      });
      await ejecutarOperacionesEnLotes(operaciones);
      if (hoja === 'pagos') {
        await sincronizarPagosConCxP(filasProcesadas);
      }
    }
    await window.cargarDatosEnParalelo();
    resultadoParseo = null;
    const inputArchivo = document.getElementById('ai-archivo');
    if (inputArchivo) inputArchivo.value = '';
    renderizarVistaPrevia();
    actualizarBotonConfirmar();
    window.showSuccess('Importación completada');
  } catch (error) {
    window.showError(error.message);
    actualizarBotonConfirmar();
  }
}

function crearVistaImportar() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-importar';
  tarjeta.innerHTML = `
    <div class="admin-importar-header">
      <h3>Importar Datos</h3>
      <button type="button" id="ai-descargar-plantilla" class="btn-secondary">Descargar plantilla</button>
    </div>
    <input type="file" id="ai-archivo" accept=".xlsx">
    <div class="admin-importar-modo">
      <label><input type="radio" name="ai-modo" value="agregar" id="ai-modo-agregar" checked> Agregar</label>
      <label><input type="radio" name="ai-modo" value="reemplazar" id="ai-modo-reemplazar"> Reemplazar todo</label>
    </div>
    <p style="font-size:0.85em;color:#666;">Nota: las hojas "Saldos Iniciales" (cuentas por pagar históricas) y "Control Producción" siempre se agregan, nunca se reemplazan, sin importar el modo elegido.</p>
    <input type="text" id="ai-confirmar-texto" placeholder="Escribe CONFIRMAR" style="display:none">
    <div id="ai-vista-previa"></div>
    <button type="button" id="ai-confirmar-importacion" class="btn-primary" disabled>Confirmar importación</button>
  `;
  tarjeta.querySelector('#ai-descargar-plantilla').addEventListener('click', manejarDescargarPlantilla);
  tarjeta.querySelector('#ai-archivo').addEventListener('change', manejarSeleccionArchivo);
  tarjeta.querySelector('#ai-modo-agregar').addEventListener('change', () => manejarCambioModo('agregar'));
  tarjeta.querySelector('#ai-modo-reemplazar').addEventListener('change', () => manejarCambioModo('reemplazar'));
  tarjeta.querySelector('#ai-confirmar-texto').addEventListener('input', actualizarBotonConfirmar);
  tarjeta.querySelector('#ai-confirmar-importacion').addEventListener('click', manejarConfirmarImportacion);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  crearVistaImportar
});

})();
