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

function normalizarTicketComparacion(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.replace(/^0+(?=\d)/, '');
}

function procesarFilaPagos(fila) {
  const fechaTexto = normalizarFecha(fila.Fecha);
  if (!validarFormatoFecha(fechaTexto)) {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  const ticket = String(fila.Ticket ?? '').trim();
  const ticketNormalizado = normalizarTicketComparacion(ticket);
  const cxp = (window.EVE.cuentasPorPagar || []).find((c) => normalizarTicketComparacion(c.ticket) === ticketNormalizado);
  const original = cxp
    ? {
        ...fila,
        Proveedor: cxp.proveedor,
        Material: cxp.material,
        Kg: cxp.kg,
        'Precio/Kg': cxp.kg > 0 ? Math.round((cxp.total / cxp.kg) * 100) / 100 : ''
      }
    : fila;
  try {
    const datosFormulario = cxp
      ? {
          ticket,
          proveedor: cxp.proveedor,
          material: cxp.material,
          kg: cxp.kg,
          precioPorKg: cxp.kg > 0 ? cxp.total / cxp.kg : 0,
          pagado: fila.Pagado,
          fecha: convertirFechaAISO(fechaTexto)
        }
      : {
          ticket,
          proveedor: String(fila.Proveedor ?? '').trim().toUpperCase(),
          material: String(fila.Material ?? '').trim().toUpperCase(),
          kg: fila.Kg,
          precioPorKg: fila['Precio/Kg'],
          pagado: fila.Pagado,
          fecha: convertirFechaAISO(fechaTexto)
        };
    const registro = window.EVE_PAGOS.construirRegistroDesdeFormulario(datosFormulario);
    const info = cxp ? `Vinculado a CxP (ticket ${cxp.ticket})` : 'Sin CxP vinculada';
    return { valido: true, motivo: null, registro, original, info };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original };
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
  const proveedor = window.normalizarProveedor(fila.Proveedor);
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

function esValorAfirmativo(valor) {
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

function agruparFilasPorClave(filas, columna) {
  const grupos = [];
  const indicePorClave = new Map();
  filas.forEach((fila, indiceOriginal) => {
    const clave = String(fila[columna] ?? '').trim();
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

function validarConsistenciaGrupo(grupo, campos) {
  const filasGrupo = grupo.filas;
  for (const campo of campos) {
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
      esMerma: esValorAfirmativo(fila['Es Merma'])
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
      Salidas: salidas.map(({ fila }) => `${fila['Material']} ${fila['Kg']}kg${esValorAfirmativo(fila['Es Merma']) ? ' (merma)' : ''}`).join(' | '),
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
  const grupos = agruparFilasPorClave(filasNoVacias, 'Grupo/Proceso');

  const preliminares = grupos.map((grupo) => {
    const errorConsistencia = validarConsistenciaGrupo(grupo, CAMPOS_CONSISTENTES_CP);
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

// ── Composiciones (Rendimientos) ────────────────────────────────────────

function agruparFilasPorMaterialEntrada(filas) {
  const grupos = [];
  const indicePorClave = new Map();
  filas.forEach((fila, indiceOriginal) => {
    const clave = window.normalizarMaterial(fila['Material Entrada']);
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

function construirLookupProcesos() {
  const mapa = new Map();
  window.EVE_RENDIMIENTOS.procesosDisponibles().forEach((p) => mapa.set(p.nombre.trim().toUpperCase(), p.clave));
  return mapa;
}

function parsearListaProcesos(texto, lookup) {
  const partes = String(texto ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const claves = [];
  for (const parte of partes) {
    const clave = lookup.get(parte.toUpperCase());
    if (!clave) return { error: `Proceso "${parte}" no reconocido` };
    claves.push(clave);
  }
  return { claves };
}

function construirOriginalPreviewComposicion(grupo, registro) {
  const primera = grupo.filas[0].fila;
  if (!registro) {
    return {
      'Material Entrada': primera['Material Entrada'],
      Componentes: grupo.filas.map(({ fila }) => `${fila['Subproducto']} ${fila['%']}%${esValorAfirmativo(fila['Es Merma']) ? ' (merma)' : ''}`).join(' | ')
    };
  }
  return {
    'Material Entrada': registro.nuevo.materialEntrada,
    Componentes: registro.nuevo.componentes.map((c) => `${c.subproducto} ${c.porcentaje}%${c.esMerma ? ' (merma)' : ''}`).join(' | '),
    'Versión': `v${registro.nuevo.version}`,
    'Vigente desde': registro.nuevo.fechaVigencia
  };
}

function procesarHojaComposiciones(filasCrudas) {
  const filasNoVacias = filasCrudas.filter((fila) => !esFilaVacia(fila));
  const grupos = agruparFilasPorMaterialEntrada(filasNoVacias);
  const lookupProcesos = construirLookupProcesos();
  const hoy = window.obtenerFechaMexico();

  return grupos.map((grupo) => {
    if (!grupo.clave) {
      return { valido: false, motivo: 'Material Entrada es obligatorio', registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
    }
    const materialEntrada = grupo.clave;
    if (!window.MATERIALES_COMUNES.includes(materialEntrada)) {
      return { valido: false, motivo: `Material Entrada "${materialEntrada}" no está en el catálogo de materiales`, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
    }

    const componentes = [];
    for (const { fila, indiceOriginal } of grupo.filas) {
      const filaExcel = indiceOriginal + 2;
      const esMerma = esValorAfirmativo(fila['Es Merma']);
      const subproductoRaw = String(fila['Subproducto'] ?? '').trim();
      if (!subproductoRaw) {
        return { valido: false, motivo: `Fila ${filaExcel}: Subproducto es obligatorio`, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
      }
      let subproducto = subproductoRaw.toUpperCase();
      let procesosValidos = [];
      let procesoSugerido = null;
      if (!esMerma) {
        const normalizado = window.normalizarMaterial(subproductoRaw);
        if (!window.MATERIALES_COMUNES.includes(normalizado)) {
          return { valido: false, motivo: `Fila ${filaExcel}: Subproducto "${subproductoRaw}" no está en el catálogo (usa Es Merma = Sí si no es un material de inventario)`, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
        }
        subproducto = normalizado;
        const resultadoValidos = parsearListaProcesos(fila['Procesos Válidos'], lookupProcesos);
        if (resultadoValidos.error) {
          return { valido: false, motivo: `Fila ${filaExcel}: ${resultadoValidos.error}`, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
        }
        procesosValidos = resultadoValidos.claves;
        const sugeridoTexto = String(fila['Proceso Sugerido'] ?? '').trim();
        if (sugeridoTexto) {
          const claveSugerido = lookupProcesos.get(sugeridoTexto.toUpperCase());
          if (!claveSugerido) {
            return { valido: false, motivo: `Fila ${filaExcel}: Proceso Sugerido "${sugeridoTexto}" no reconocido`, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
          }
          if (!procesosValidos.includes(claveSugerido)) {
            return { valido: false, motivo: `Fila ${filaExcel}: Proceso Sugerido debe estar incluido en Procesos Válidos`, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
          }
          procesoSugerido = claveSugerido;
        }
      }
      const porcentaje = Number(fila['%']);
      componentes.push({ subproducto, porcentaje, esMerma, procesosValidos, procesoSugerido });
    }

    const anterior = window.EVE_RENDIMIENTOS.composicionVigenteAbiertaPorMaterial(window.EVE.composiciones, materialEntrada);
    const datos = {
      materialEntrada,
      descripcion: '',
      fechaVigencia: hoy,
      componentes,
      motivo: 'Importación desde Excel',
      actualizadoPor: usuarioActual()
    };
    try {
      const { cierre, nuevo } = window.EVE_RENDIMIENTOS.construirNuevaComposicion(datos, anterior);
      const anteriorParaHistorial = anterior ? { version: anterior.version, componentes: anterior.componentes } : null;
      const registro = { cierre, nuevo, anteriorParaHistorial };
      return { valido: true, motivo: null, registro, original: construirOriginalPreviewComposicion(grupo, registro) };
    } catch (error) {
      return { valido: false, motivo: error.message, registro: null, original: construirOriginalPreviewComposicion(grupo, null) };
    }
  });
}

async function procesarConfirmacionComposiciones(filasProcesadas) {
  for (const filaProcesada of filasProcesadas) {
    if (!filaProcesada.valido) continue;
    const { cierre, nuevo, anteriorParaHistorial } = filaProcesada.registro;
    if (cierre) {
      await window.actualizarDato('composiciones', cierre.id, { fechaCierre: cierre.fechaCierre });
      const registroCerrado = window.EVE.composiciones.find((c) => c.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaCierre = cierre.fechaCierre;
    }
    const id = await window.guardarDato('composiciones', nuevo);
    window.EVE.composiciones.push({ id, ...nuevo, fechaRegistro: new Date().toISOString() });
    window.EVE_HISTORIAL.registrar({
      coleccion: 'composiciones',
      registroId: id,
      accion: anteriorParaHistorial ? 'edicion' : 'creacion',
      valorAnterior: anteriorParaHistorial,
      valorNuevo: { version: nuevo.version, componentes: nuevo.componentes },
      motivo: nuevo.motivo
    });
  }
}

// ── Ventas ───────────────────────────────────────────────────────────────

// Mismo shape de ledger que usan verificarStockSuficienteVenta (ventas.js) y
// verificarStockSuficienteProceso (control-produccion.js); reutilizable también
// si en el futuro se agrega esta misma advertencia no bloqueante a Control de Producción.
function datosLedgerParaStock() {
  return {
    inventarioInicial: window.EVE.inventarioInicial,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    ventas: window.EVE.ventas
  };
}

const CAMPOS_CONSISTENTES_VENTA = ['Fecha', 'Cliente', 'Ticket Relacionado'];

function materialesVentaNormalizados() {
  return new Set((window.PRODUCTOS_VENTA || []).map((m) => window.normalizarMaterial(m)));
}

function crearGeneradorFolio(ventasExistentes) {
  const maxPorAnio = new Map();
  (ventasExistentes || []).forEach((v) => {
    const match = /^V-(\d{4})-(\d+)$/.exec(String(v.folio || ''));
    if (match) {
      const anio = match[1];
      const n = Number(match[2]);
      maxPorAnio.set(anio, Math.max(maxPorAnio.get(anio) || 0, n));
    }
  });
  return function siguienteFolioPorAnio(fechaISO) {
    const anio = fechaISO.split('-')[0];
    const siguiente = (maxPorAnio.get(anio) || 0) + 1;
    maxPorAnio.set(anio, siguiente);
    return `V-${anio}-${String(siguiente).padStart(3, '0')}`;
  };
}

function construirOriginalPreviewVenta(grupo, registro) {
  const primera = grupo.filas[0].fila;
  if (!registro) {
    return {
      'Grupo Venta': grupo.clave || '(individual)',
      Fecha: primera['Fecha'],
      Cliente: primera['Cliente'],
      'Ticket Relacionado': primera['Ticket Relacionado'],
      Líneas: grupo.filas.map(({ fila }) => `${fila['Material']} ${fila['Kg']}kg x ${fila['Precio']}`).join(' | ')
    };
  }
  return {
    Folio: registro.folio,
    'Grupo Venta': grupo.clave || '(individual)',
    Fecha: registro.fecha,
    Cliente: registro.cliente,
    'Ticket Relacionado': (registro.ticketsOrigen || []).join(', '),
    Líneas: registro.lineas.map((l) => `${l.material} ${l.cantidad}${l.unidad} x ${l.precioUnitario}`).join(' | '),
    Total: registro.totalVenta
  };
}

function procesarHojaVentas(filasCrudas) {
  const filasNoVacias = filasCrudas.filter((fila) => !esFilaVacia(fila));
  const grupos = agruparFilasPorClave(filasNoVacias, 'Grupo Venta');
  const materialesValidos = materialesVentaNormalizados();
  const generarSiguienteFolio = crearGeneradorFolio(window.EVE.ventas);

  return grupos.map((grupo) => {
    const errorConsistencia = validarConsistenciaGrupo(grupo, CAMPOS_CONSISTENTES_VENTA);
    if (errorConsistencia) {
      return { valido: false, motivo: errorConsistencia, registro: null, original: construirOriginalPreviewVenta(grupo, null) };
    }
    const primera = grupo.filas[0].fila;
    const fechaTexto = normalizarFecha(primera['Fecha']);
    if (!validarFormatoFecha(fechaTexto)) {
      return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: construirOriginalPreviewVenta(grupo, null) };
    }
    const cliente = String(primera['Cliente'] ?? '').trim();
    if (!cliente) {
      return { valido: false, motivo: 'Cliente es obligatorio', registro: null, original: construirOriginalPreviewVenta(grupo, null) };
    }
    for (const { fila, indiceOriginal } of grupo.filas) {
      const filaExcel = indiceOriginal + 2;
      const materialNormalizado = window.normalizarMaterial(fila['Material']);
      if (!materialNormalizado || !materialesValidos.has(materialNormalizado)) {
        return { valido: false, motivo: `Fila ${filaExcel}: Material "${fila['Material']}" no reconocido`, registro: null, original: construirOriginalPreviewVenta(grupo, null) };
      }
      const kg = Number(fila['Kg']);
      if (!(kg > 0)) {
        return { valido: false, motivo: `Fila ${filaExcel}: Kg debe ser numérico mayor a 0`, registro: null, original: construirOriginalPreviewVenta(grupo, null) };
      }
      const precio = Number(fila['Precio']);
      if (Number.isNaN(precio) || precio < 0) {
        return { valido: false, motivo: `Fila ${filaExcel}: Precio debe ser numérico mayor o igual a 0`, registro: null, original: construirOriginalPreviewVenta(grupo, null) };
      }
    }
    const ticketRelacionado = String(primera['Ticket Relacionado'] ?? '').trim();
    const datosFormulario = {
      cliente,
      fecha: convertirFechaAISO(fechaTexto),
      lineas: grupo.filas.map(({ fila }) => ({ material: fila['Material'], cantidad: fila['Kg'], precioUnitario: fila['Precio'] })),
      observaciones: '',
      ticketsOrigen: ticketRelacionado
    };
    try {
      const venta = window.construirVentaDesdeFormulario(datosFormulario);
      venta.folio = generarSiguienteFolio(venta.fecha);
      venta.registradoPor = usuarioActual();
      const advertenciasStock = window.EVE_INVENTARIO.calcularAdvertenciasStock(
        datosLedgerParaStock(),
        venta.lineas.map((l) => ({ material: l.material, kg: l.cantidad })),
        venta.fecha
      );
      const advertencia = advertenciasStock.length > 0 ? advertenciasStock.join(' | ') : undefined;
      return { valido: true, motivo: null, registro: venta, original: construirOriginalPreviewVenta(grupo, venta), advertencia };
    } catch (error) {
      return { valido: false, motivo: error.message, registro: null, original: construirOriginalPreviewVenta(grupo, null) };
    }
  });
}

// ── Precios Generales / Ajustes de Precio por Proveedor ────────────────────
// Mismo patrón de cierre+nuevo (fechaInicio/fechaFin encadenado) que Composiciones,
// pero sin agrupar filas: cada fila es un registro independiente.

function normalizarTipoAjusteImportado(valor) {
  const texto = String(valor ?? '').trim().toUpperCase();
  if (texto === 'MONTO' || texto === 'MONTO FIJO') return 'monto';
  if (texto === 'PORCENTAJE' || texto === '%') return 'porcentaje';
  return null;
}

function procesarFilaPrecioGeneral(fila) {
  const material = window.normalizarMaterial(fila.Material);
  if (!material) {
    return { valido: false, motivo: 'Material es obligatorio', registro: null, original: fila };
  }
  if (!window.MATERIALES_COMUNES.includes(material)) {
    return { valido: false, motivo: `Material "${fila.Material}" no está en el catálogo de materiales`, registro: null, original: fila };
  }
  const fechaTexto = normalizarFecha(fila['Fecha Vigencia']);
  if (!validarFormatoFecha(fechaTexto)) {
    return { valido: false, motivo: 'Fecha Vigencia debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  const datos = {
    material,
    precio: fila.Precio,
    fechaInicio: convertirFechaAISO(fechaTexto),
    notas: fila.Notas
  };
  try {
    const { cierre, nuevo } = window.EVE_PRECIOS.construirNuevoPrecio(datos, window.EVE.precios);
    const info = cierre ? `Cierra el precio anterior el ${window.formatearFecha(cierre.fechaFin)}` : undefined;
    return { valido: true, motivo: null, registro: { cierre, nuevo }, original: fila, info };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarHojaPreciosGenerales(filasCrudas) {
  return procesarHoja(filasCrudas, procesarFilaPrecioGeneral);
}

async function procesarConfirmacionPreciosGenerales(filasProcesadas) {
  for (const filaProcesada of filasProcesadas) {
    if (!filaProcesada.valido) continue;
    const { cierre, nuevo } = filaProcesada.registro;
    if (cierre) {
      await window.actualizarDato('precios', cierre.id, { fechaFin: cierre.fechaFin });
      const registroCerrado = window.EVE.precios.find((p) => p.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaFin = cierre.fechaFin;
    }
    const nuevoConMeta = { ...nuevo, creadoPor: usuarioActual() };
    const id = await window.guardarDato('precios', nuevoConMeta);
    window.EVE.precios.push({ id, ...nuevoConMeta, fechaRegistro: new Date().toISOString() });
  }
}

function procesarFilaAjusteProveedor(fila) {
  const material = window.normalizarMaterial(fila.Material);
  if (!material) {
    return { valido: false, motivo: 'Material es obligatorio', registro: null, original: fila };
  }
  if (!window.MATERIALES_COMUNES.includes(material)) {
    return { valido: false, motivo: `Material "${fila.Material}" no está en el catálogo de materiales`, registro: null, original: fila };
  }
  const proveedor = window.normalizarProveedor(fila.Proveedor);
  if (!proveedor) {
    return { valido: false, motivo: 'Proveedor es obligatorio', registro: null, original: fila };
  }
  const tipoAjuste = normalizarTipoAjusteImportado(fila['Tipo Ajuste']);
  if (!tipoAjuste) {
    return { valido: false, motivo: '"Tipo Ajuste" debe ser "Monto" o "Porcentaje"', registro: null, original: fila };
  }
  const fechaTexto = normalizarFecha(fila['Fecha Vigencia']);
  if (!validarFormatoFecha(fechaTexto)) {
    return { valido: false, motivo: 'Fecha Vigencia debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  const datos = {
    material,
    proveedor,
    tipoAjuste,
    valorAjuste: fila.Valor,
    fechaInicio: convertirFechaAISO(fechaTexto)
  };
  try {
    const { cierre, nuevo } = window.EVE_PRECIOS.construirNuevoAjustePrecio(datos, window.EVE.ajustesPrecioProveedor);
    const info = cierre ? `Cierra el ajuste anterior el ${window.formatearFecha(cierre.fechaFin)}` : undefined;
    return { valido: true, motivo: null, registro: { cierre, nuevo }, original: fila, info };
  } catch (error) {
    return { valido: false, motivo: error.message, registro: null, original: fila };
  }
}

function procesarHojaAjustesProveedor(filasCrudas) {
  return procesarHoja(filasCrudas, procesarFilaAjusteProveedor);
}

async function procesarConfirmacionAjustesProveedor(filasProcesadas) {
  for (const filaProcesada of filasProcesadas) {
    if (!filaProcesada.valido) continue;
    const { cierre, nuevo } = filaProcesada.registro;
    if (cierre) {
      await window.actualizarDato('ajustes_precio_proveedor', cierre.id, { fechaFin: cierre.fechaFin });
      const registroCerrado = window.EVE.ajustesPrecioProveedor.find((a) => a.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaFin = cierre.fechaFin;
    }
    const id = await window.guardarDato('ajustes_precio_proveedor', nuevo);
    window.EVE.ajustesPrecioProveedor.push({ id, ...nuevo, fechaRegistro: new Date().toISOString() });
  }
}

function procesarFilaInventarioInicial(fila) {
  const material = window.normalizarMaterial(fila.Material);
  if (!material) {
    return { valido: false, motivo: 'Material es obligatorio', registro: null, original: fila };
  }
  const etapasValidas = window.EVE_INVENTARIO.ETAPAS_INVENTARIO.filter((e) => e !== 'VENDIDO');
  const etapa = String(fila.Etapa ?? '').trim().toUpperCase();
  if (!etapasValidas.includes(etapa)) {
    return { valido: false, motivo: `Etapa inválida (usa: ${etapasValidas.join(', ')})`, registro: null, original: fila };
  }
  const kg = Number(fila.Kg);
  if (!(kg > 0)) {
    return { valido: false, motivo: 'Kg debe ser numérico mayor a 0', registro: null, original: fila };
  }
  const yaExiste = (window.EVE.inventarioInicial || []).some((r) => r.material === material && r.etapa === etapa);
  if (yaExiste) {
    return { valido: false, motivo: 'Ya existe un Inventario Inicial para este Material + Etapa', registro: null, original: fila };
  }
  const fechaTexto = normalizarFecha(fila.Fecha);
  let fecha;
  if (fechaTexto === '') {
    fecha = window.EVE_CXP.fechaCorteVigente();
  } else if (validarFormatoFecha(fechaTexto)) {
    fecha = convertirFechaAISO(fechaTexto);
  } else {
    return { valido: false, motivo: 'Fecha debe tener el formato DD-MM-AAAA', registro: null, original: fila };
  }
  const registro = {
    material,
    etapa,
    kg,
    fecha,
    nota: String(fila.Nota ?? '').trim(),
    creadoPor: usuarioActual(),
    fechaRegistro: new Date().toISOString()
  };
  return { valido: true, motivo: null, registro, original: fila };
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  esFilaVacia,
  procesarFilaDestaraje,
  procesarFilaPagos,
  procesarFilaSaldoInicial,
  procesarFilaInventarioInicial,
  procesarHojaControlProduccion,
  procesarHojaComposiciones,
  procesarHojaVentas,
  procesarHojaPreciosGenerales,
  procesarHojaAjustesProveedor,
  normalizarTicketComparacion
});

function procesarHoja(filasCrudas, procesador) {
  return filasCrudas.filter((fila) => !esFilaVacia(fila)).map((fila, indice) => procesador(fila, indice));
}

function contarResumenHoja(filasProcesadas) {
  const validas = filasProcesadas.filter((f) => f.valido).length;
  const conAdvertencia = filasProcesadas.filter((f) => f.valido && f.advertencia).length;
  return { validas, invalidas: filasProcesadas.length - validas, conAdvertencia };
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
    ['9260', '', '', '', '', '', 4000, fechaEjemploEntrada],
    ['9999', 'JOSE ENRIQUE', 'MIXTO', 1000, 5, 5000, 4000, fechaEjemploEntrada]
  ]);
  aplicarFormatoFecha(pagos, [7], 1, 200);

  const saldosIniciales = XLSX.utils.aoa_to_sheet([
    ['Proveedor', 'Saldo Pendiente', 'Pagado', 'Fecha Ticket'],
    ['ACOPIO NORTE', 8000, 0, ''],
    ['ACOPIO SUR', 5000, 2000, fechaEjemploEntrada]
  ]);
  aplicarFormatoFecha(saldosIniciales, [3], 1, 200);

  const inventarioInicial = XLSX.utils.aoa_to_sheet([
    ['Material', 'Etapa', 'Kg', 'Fecha', 'Nota'],
    ['LECHERO MOLIDO', 'MOLIENDA', 480, '', 'Conteo físico al corte'],
    ['MIXTO', 'RECEPCIÓN', 1200, fechaEjemploEntrada, '']
  ]);
  aplicarFormatoFecha(inventarioInicial, [3], 1, 200);

  const controlProduccion = XLSX.utils.aoa_to_sheet([
    ['Grupo/Proceso', 'Tipo Proceso', 'Tipo Fila', 'Material', 'Kg', 'Ticket Origen', 'Es Merma', 'Operador', 'Turno', 'Fecha Inicio', 'Fecha Fin'],
    ['MOL-001', 'MOLIENDA', 'ENTRADA', 'MIXTO', 500, '9260', '', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['MOL-001', 'MOLIENDA', 'ENTRADA', 'LECHERO', 300, '', '', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['MOL-001', 'MOLIENDA', 'SALIDA', 'LECHERO MOLIDO', 280, '', 'NO', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['MOL-001', 'MOLIENDA', 'SALIDA', 'MERMA', 20, '', 'SI', 'JUAN PEREZ', 'Matutino', '24-06-2026 08:00', '24-06-2026 16:00'],
    ['SEL-001', 'SELECCION', 'ENTRADA', 'MIXTO', 200, '9261', '', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'CRISTAL SIN ETIQUETA', 100, '', 'NO', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'LECHERO', 55, '', 'NO', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'ETIQUETA', 30, '', 'NO', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00'],
    ['SEL-001', 'SELECCION', 'SALIDA', 'BASURA', 15, '', 'SI', 'MARIA LOPEZ', 'Vespertino', '25-06-2026 08:00', '25-06-2026 14:00']
  ]);

  const preciosGenerales = XLSX.utils.aoa_to_sheet([
    ['Material', 'Precio', 'Fecha Vigencia', 'Notas'],
    ['MIXTO', 3.5, fechaEjemploEntrada, '']
  ]);
  aplicarFormatoFecha(preciosGenerales, [2], 1, 200);

  const ajustesProveedor = XLSX.utils.aoa_to_sheet([
    ['Material', 'Proveedor', 'Tipo Ajuste', 'Valor', 'Fecha Vigencia'],
    ['MIXTO', 'JOSE ENRIQUE', 'Monto', 0.5, fechaEjemploEntrada],
    ['MIXTO', 'FELIX LOZANO', 'Porcentaje', 10, fechaEjemploEntrada]
  ]);
  aplicarFormatoFecha(ajustesProveedor, [4], 1, 200);

  const composiciones = XLSX.utils.aoa_to_sheet([
    ['Material Entrada', 'Subproducto', '%', 'Es Merma', 'Procesos Válidos', 'Proceso Sugerido'],
    ['MIXTO', 'CRISTAL SIN ETIQUETA', 50, 'No', 'EMPACADO, VENTA DIRECTA', 'EMPACADO'],
    ['MIXTO', 'LECHERO', 10, 'No', 'MOLIENDA, LAVADO, PELETIZADO, VENTA DIRECTA', 'MOLIENDA'],
    ['MIXTO', 'VERDE', 10, 'No', 'EMPACADO, MOLIENDA, VENTA DIRECTA', 'EMPACADO'],
    ['MIXTO', 'MULTI-COLOR', 10, 'No', 'MOLIENDA, LAVADO, PELETIZADO, INYECCIÓN, VENTA DIRECTA', 'MOLIENDA'],
    ['MIXTO', 'SUERO', 5, 'No', 'MOLIENDA, LAVADO, VENTA DIRECTA', 'MOLIENDA'],
    ['MIXTO', 'ETIQUETA', 10, 'Sí', '', ''],
    ['MIXTO', 'BASURA', 5, 'Sí', '', ''],
    ['MIXTO 2', 'EJEMPLO - REEMPLAZA CON TUS SUBPRODUCTOS Y % REALES', 0, 'No', '', '']
  ]);

  const ventas = XLSX.utils.aoa_to_sheet([
    ['Grupo Venta', 'Fecha', 'Cliente', 'Ticket Relacionado', 'Material', 'Kg', 'Precio', 'Total'],
    ['V-EJ-001', fechaEjemploEntrada, 'CLIENTE EJEMPLO', '', 'CRISTAL SIN ETIQUETA', 500, 8, 4000],
    ['V-EJ-002', fechaEjemploEntrada, 'CLIENTE DOS', '9999', 'LECHERO', 300, 7, 2100],
    ['V-EJ-002', fechaEjemploEntrada, 'CLIENTE DOS', '9999', 'SUERO', 100, 3, 300]
  ]);
  aplicarFormatoFecha(ventas, [1], 1, 200);

  const instrucciones = XLSX.utils.aoa_to_sheet([
    ['INSTRUCCIONES DE IMPORTACIÓN'],
    [''],
    ['PRECIOS GENERALES'],
    ['- "Material" debe ser uno de los 19 materiales del catálogo.'],
    ['- Cada fila crea un nuevo precio vigente para ese Material a partir de "Fecha Vigencia"; si ya existía un precio vigente para ese Material en esa fecha, se cierra automáticamente un día antes (igual que al crear un precio manualmente).'],
    ['- No puede haber dos filas con el mismo Material y la misma "Fecha Vigencia" exacta.'],
    [''],
    ['AJUSTES DE PRECIO POR PROVEEDOR'],
    ['- Ajusta el precio general de un Material para un Proveedor específico (ej. un proveedor que negocia $0.50 más por Kg, o 10% menos).'],
    ['- "Tipo Ajuste": escribe Monto (suma/resta una cantidad fija al precio general) o Porcentaje (aplica un % sobre el precio general).'],
    ['- "Valor": si es Monto, un número que se suma al precio (usa negativos para descuentos); si es Porcentaje, el % a aplicar (usa negativos para descuentos).'],
    ['- Encadena vigencias igual que Precios Generales: cierra automáticamente el ajuste anterior del mismo Material + Proveedor si ya existía uno vigente.'],
    ['- El ajuste solo se aplica al generar CxP de tickets de ese Proveedor; no modifica precios de otros proveedores ni el precio general.'],
    [''],
    ['COMPOSICIONES / RENDIMIENTOS'],
    ['- Cada fila representa un subproducto de un Material Entrada. Repite el Material Entrada en cada fila de sus subproductos.'],
    ['- "Es Merma": escribe Sí o No. Si es Sí, el Subproducto es texto libre (ej. BASURA, ETIQUETA) y no necesita existir como material de inventario.'],
    ['- Si "Es Merma" es No, el Subproducto debe ser uno de los materiales del catálogo (los mismos 19 materiales usados en el resto del sistema).'],
    ['- La suma de "%" de todos los subproductos de un mismo Material Entrada debe ser exactamente 100, igual que en la captura manual.'],
    ['- "Procesos Válidos": lista de procesos separados por coma o punto y coma (ej. Molienda, Selección). Déjalo vacío si no aplica.'],
    ['- "Proceso Sugerido": debe ser uno de los procesos indicados en "Procesos Válidos".'],
    ['- Al importar, cada Material Entrada genera una nueva versión de su composición (cierra automáticamente la versión vigente anterior), igual que al crear manualmente.'],
    ['- La fila de "MIXTO 2" en la hoja Composiciones trae un EJEMPLO con % = 0 a propósito: reemplázala con tus subproductos y porcentajes reales antes de importar; si la dejas así, se marcará como error.'],
    [''],
    ['VENTAS'],
    ['- "Grupo Venta": identificador que agrupa varias líneas de un mismo documento/folio de venta. Filas con el mismo "Grupo Venta" deben compartir Fecha, Cliente y Ticket Relacionado.'],
    ['- "Cliente": texto libre (igual que Proveedor en Destaraje).'],
    ['- "Ticket Relacionado" es opcional y no se valida contra tickets existentes (igual que Ticket Origen en Control de Producción).'],
    ['- "Material" debe ser uno de los productos de venta del catálogo (no se restringe a los 19 materiales de inventario).'],
    ['- "Total" se calcula automáticamente (Kg × Precio); esta columna no se valida ni se usa al importar.'],
    [''],
    ['GENERAL'],
    ['- Ningún valor de Material o Cliente fuera de catálogo se guarda en silencio: se reporta como "no reconocido" al final de la importación.']
  ]);

  XLSX.utils.book_append_sheet(libro, preciosGenerales, 'PreciosGenerales');
  XLSX.utils.book_append_sheet(libro, ajustesProveedor, 'AjustesProveedor');
  XLSX.utils.book_append_sheet(libro, destaraje, 'Destaraje');
  XLSX.utils.book_append_sheet(libro, pagos, 'Pagos');
  XLSX.utils.book_append_sheet(libro, saldosIniciales, 'SaldosIniciales');
  XLSX.utils.book_append_sheet(libro, inventarioInicial, 'InventarioInicial');
  XLSX.utils.book_append_sheet(libro, controlProduccion, 'ControlProduccion');
  XLSX.utils.book_append_sheet(libro, composiciones, 'Composiciones');
  XLSX.utils.book_append_sheet(libro, ventas, 'Ventas');
  XLSX.utils.book_append_sheet(libro, instrucciones, 'Instrucciones');
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
    inventarioInicial: libro.Sheets.InventarioInicial
      ? XLSX.utils.sheet_to_json(libro.Sheets.InventarioInicial, { defval: '' })
      : [],
    controlProduccion: libro.Sheets.ControlProduccion
      ? XLSX.utils.sheet_to_json(libro.Sheets.ControlProduccion, { defval: '' })
      : [],
    composiciones: libro.Sheets.Composiciones
      ? XLSX.utils.sheet_to_json(libro.Sheets.Composiciones, { defval: '' })
      : [],
    ventas: libro.Sheets.Ventas
      ? XLSX.utils.sheet_to_json(libro.Sheets.Ventas, { defval: '' })
      : [],
    preciosGenerales: libro.Sheets.PreciosGenerales
      ? XLSX.utils.sheet_to_json(libro.Sheets.PreciosGenerales, { defval: '' })
      : [],
    ajustesProveedor: libro.Sheets.AjustesProveedor
      ? XLSX.utils.sheet_to_json(libro.Sheets.AjustesProveedor, { defval: '' })
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
  saldosIniciales: procesarFilaSaldoInicial,
  inventarioInicial: procesarFilaInventarioInicial
};

const COLECCION_POR_HOJA = {
  destaraje: 'destaraje',
  pagos: 'pagos',
  saldosIniciales: 'cuentas_por_pagar',
  inventarioInicial: 'inventario_inicial',
  controlProduccion: 'control_produccion',
  composiciones: 'composiciones',
  ventas: 'ventas'
};

const HOJAS_CON_REEMPLAZO = ['destaraje', 'pagos'];
const HOJAS_A_IMPORTAR = [...Object.keys(PROCESADORES_HOJA), 'controlProduccion', 'composiciones', 'ventas', 'preciosGenerales', 'ajustesProveedor'];

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

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

// Sección separada, visualmente distinta de la tabla de errores: lista las filas
// válidas que sí se van a guardar pero traen una advertencia no bloqueante
// (ej. stock insuficiente a la fecha), para que se puedan revisar de un vistazo
// sin confundirlas con filas que fallaron la importación.
function renderizarSeccionAdvertencias(contenedor, etiqueta, filasProcesadas) {
  const filasConAdvertencia = filasProcesadas.filter((f) => f.valido && f.advertencia);
  if (filasConAdvertencia.length === 0) return;
  const envoltura = document.createElement('div');
  envoltura.className = 'ai-advertencias';
  const titulo = document.createElement('p');
  titulo.appendChild(crearChip(
    `${etiqueta}: ${filasConAdvertencia.length} fila(s) se guardarán con advertencia (no bloquea la importación)`,
    'chip-warn'
  ));
  envoltura.appendChild(titulo);
  const lista = document.createElement('ul');
  filasConAdvertencia.forEach((f) => {
    const item = document.createElement('li');
    const referencia = f.original.Folio || f.original['Grupo Venta'] || f.original.Cliente || '';
    item.textContent = `${referencia ? referencia + ': ' : ''}${f.advertencia}`;
    lista.appendChild(item);
  });
  envoltura.appendChild(lista);
  contenedor.appendChild(envoltura);
}

function renderizarTablaHoja(contenedor, etiqueta, filasProcesadas) {
  const resumen = contarResumenHoja(filasProcesadas);
  const titulo = document.createElement('p');
  const sufijoAdvertencias = resumen.conAdvertencia > 0 ? ` (${resumen.conAdvertencia} con advertencia)` : '';
  titulo.textContent = `${etiqueta}: ${resumen.validas} válidas${sufijoAdvertencias}, ${resumen.invalidas} con error`;
  contenedor.appendChild(titulo);

  if (filasProcesadas.length === 0) return;

  renderizarSeccionAdvertencias(contenedor, etiqueta, filasProcesadas);

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
    if (filaProcesada.valido && filaProcesada.advertencia) {
      celdaEstado.appendChild(crearChip(`⚠️ ${filaProcesada.advertencia}`, 'chip-warn'));
    } else if (filaProcesada.valido) {
      celdaEstado.textContent = filaProcesada.info ? `✓ ${filaProcesada.info}` : '✓';
    } else {
      celdaEstado.textContent = filaProcesada.motivo;
    }
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
  renderizarTablaHoja(contenedor, 'Precios Generales', resultadoParseo.preciosGenerales);
  renderizarTablaHoja(contenedor, 'Ajustes por Proveedor', resultadoParseo.ajustesProveedor);
  renderizarTablaHoja(contenedor, 'Destaraje', resultadoParseo.destaraje);
  renderizarTablaHoja(contenedor, 'Pagos', resultadoParseo.pagos);
  renderizarTablaHoja(contenedor, 'Saldos Iniciales', resultadoParseo.saldosIniciales);
  renderizarTablaHoja(contenedor, 'Inventario Inicial', resultadoParseo.inventarioInicial);
  renderizarTablaHoja(contenedor, 'Control Producción', resultadoParseo.controlProduccion);
  renderizarTablaHoja(contenedor, 'Composiciones', resultadoParseo.composiciones);
  renderizarTablaHoja(contenedor, 'Ventas', resultadoParseo.ventas);
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
        inventarioInicial: procesarHoja(datosHojas.inventarioInicial, PROCESADORES_HOJA.inventarioInicial),
        controlProduccion: procesarHojaControlProduccion(datosHojas.controlProduccion),
        composiciones: procesarHojaComposiciones(datosHojas.composiciones),
        ventas: procesarHojaVentas(datosHojas.ventas),
        preciosGenerales: procesarHojaPreciosGenerales(datosHojas.preciosGenerales),
        ajustesProveedor: procesarHojaAjustesProveedor(datosHojas.ajustesProveedor)
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

async function resincronizarPagosHuerfanos() {
  const [pagosFrescos, cuentasFrescas] = await Promise.all([
    window.cargarDatos('pagos'),
    window.cargarDatos('cuentas_por_pagar')
  ]);
  window.EVE.cuentasPorPagar = cuentasFrescas;

  const huerfanos = pagosFrescos.filter((p) => !p.grupoPagoId && !p.revertido);
  const abonosYaAsignados = new Set();
  const vinculados = [];
  const ambiguos = [];
  const sinMatch = [];

  for (const pago of huerfanos) {
    const ticketNormalizado = normalizarTicketComparacion(pago.ticket);
    const cxp = cuentasFrescas.find((c) => normalizarTicketComparacion(c.ticket) === ticketNormalizado);
    if (!cxp) {
      sinMatch.push({ ticket: pago.ticket, proveedor: pago.proveedor, monto: pago.pagado, detalle: 'Sin CxP con ese ticket' });
      continue;
    }
    try {
      // sincronizarPagosConCxP (importación original) nunca marcó grupoPagoId, así que un abono
      // ya existente sin grupoPagoId y con mismo monto/fecha es el que este pago generó en su momento;
      // solo hay que etiquetarlo, no crear uno nuevo (evita duplicar el abono). Si hay más de un
      // candidato no se puede saber con certeza cuál corresponde a este pago — se marca como ambiguo
      // en vez de asignar el primero disponible, para no arriesgar una trazabilidad incorrecta.
      const candidatos = (cxp.abonos || []).filter((a) =>
        !a.grupoPagoId && !abonosYaAsignados.has(a) && Number(a.monto) === Number(pago.pagado) && a.fecha === pago.fecha
      );
      if (candidatos.length > 1) {
        ambiguos.push({ ticket: pago.ticket, proveedor: pago.proveedor, monto: pago.pagado, fecha: pago.fecha, candidatos: candidatos.length });
        continue;
      }
      const grupoPagoId = window.EVE_CXP.generarGrupoPagoId();
      if (candidatos.length === 1) {
        const abonoExistente = candidatos[0];
        abonosYaAsignados.add(abonoExistente);
        const abonos = cxp.abonos.map((a) => (a === abonoExistente ? { ...a, grupoPagoId } : a));
        await window.actualizarDato('cuentas_por_pagar', cxp.id, { abonos });
        Object.assign(cxp, { abonos });
      } else {
        await window.EVE_CXP.actualizarAbonoCxP(cxp.id, {
          monto: pago.pagado,
          fecha: pago.fecha,
          referencia: 'Resincronizado (pago huérfano post-importación)',
          registradoPor: usuarioActual(),
          fechaRegistro: new Date().toISOString(),
          grupoPagoId
        });
      }
      await window.actualizarDato('pagos', pago.id, { grupoPagoId });
      pago.grupoPagoId = grupoPagoId;
      vinculados.push({ ticket: pago.ticket, proveedor: pago.proveedor, monto: pago.pagado });
    } catch (error) {
      sinMatch.push({ ticket: pago.ticket, proveedor: pago.proveedor, monto: pago.pagado, detalle: error.message });
    }
  }

  window.EVE.registrosPagos = pagosFrescos;

  return { totalHuerfanos: huerfanos.length, vinculados, ambiguos, sinMatch };
}

function construirTablaResincronizacion(columnas, filas, obtenerValores) {
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  const filaEncabezado = document.createElement('tr');
  columnas.forEach((nombreColumna) => {
    const celda = document.createElement('th');
    celda.textContent = nombreColumna;
    filaEncabezado.appendChild(celda);
  });
  const cabecera = document.createElement('thead');
  cabecera.appendChild(filaEncabezado);
  tabla.appendChild(cabecera);

  const tbody = document.createElement('tbody');
  filas.forEach((item) => {
    const fila = document.createElement('tr');
    obtenerValores(item).forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);

  const envoltura = document.createElement('div');
  envoltura.className = 'destaraje-tabla-wrapper';
  envoltura.appendChild(tabla);
  return envoltura;
}

function renderizarResumenResincronizacion(resultado) {
  const contenedor = document.getElementById('ai-resync-resultado');
  if (!contenedor) return;
  contenedor.innerHTML = '';
  const resumen = document.createElement('p');
  resumen.innerHTML = `<strong>${resultado.totalHuerfanos}</strong> pagos huérfanos encontrados — <strong>${resultado.vinculados.length}</strong> vinculados automáticamente, <strong>${resultado.ambiguos.length}</strong> ambiguos (requieren revisión manual), <strong>${resultado.sinMatch.length}</strong> sin match (huérfanos reales).`;
  contenedor.appendChild(resumen);

  if (resultado.ambiguos.length > 0) {
    const tituloAmbiguos = document.createElement('p');
    tituloAmbiguos.innerHTML = '<strong>⚠️ Ambiguos — no se asignaron automáticamente:</strong> más de un abono candidato con el mismo monto y fecha en la misma CxP, no se puede saber con certeza cuál corresponde a este pago. Revisa manualmente cuál abono corresponde a cada pago.';
    contenedor.appendChild(tituloAmbiguos);
    contenedor.appendChild(construirTablaResincronizacion(
      ['Ticket', 'Proveedor', 'Monto', 'Fecha', 'Abonos candidatos'],
      resultado.ambiguos,
      (item) => [item.ticket, item.proveedor, window.formatearMoneda(item.monto), item.fecha, item.candidatos]
    ));
  }

  if (resultado.sinMatch.length > 0) {
    const nota = document.createElement('p');
    nota.style.fontSize = '0.85em';
    nota.style.color = '#666';
    nota.textContent = 'Sin match: se esperan tickets de años previos a 2026 sin Destaraje cargado. Si aparece un ticket de 2026, hay un mismatch real de datos que requiere revisión caso por caso.';
    contenedor.appendChild(nota);
    contenedor.appendChild(construirTablaResincronizacion(
      ['Ticket', 'Proveedor', 'Monto', 'Detalle'],
      resultado.sinMatch,
      (item) => [item.ticket, item.proveedor, window.formatearMoneda(item.monto), item.detalle]
    ));
  }
}

async function manejarResincronizarPagosHuerfanos() {
  const boton = document.getElementById('ai-resincronizar');
  const contenedor = document.getElementById('ai-resync-resultado');
  boton.disabled = true;
  if (contenedor) contenedor.innerHTML = '<p>Resincronizando…</p>';
  try {
    const resultado = await resincronizarPagosHuerfanos();
    renderizarResumenResincronizacion(resultado);
    window.showSuccess(`Resincronización completada: ${resultado.vinculados.length} vinculados, ${resultado.ambiguos.length} ambiguos, ${resultado.sinMatch.length} sin match`);
  } catch (error) {
    if (contenedor) contenedor.innerHTML = '';
    window.showError(error.message);
  } finally {
    boton.disabled = false;
  }
}

async function manejarConfirmarImportacion() {
  document.getElementById('ai-confirmar-importacion').disabled = true;
  try {
    for (const hoja of HOJAS_A_IMPORTAR) {
      const filasProcesadas = resultadoParseo[hoja];
      if (hoja === 'composiciones') {
        await procesarConfirmacionComposiciones(filasProcesadas);
        continue;
      }
      if (hoja === 'preciosGenerales') {
        await procesarConfirmacionPreciosGenerales(filasProcesadas);
        continue;
      }
      if (hoja === 'ajustesProveedor') {
        await procesarConfirmacionAjustesProveedor(filasProcesadas);
        continue;
      }
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
    <p style="background:#fff3cd;border:1px solid #ffe08a;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85em;">⚠️ Orden de carga: Precios → Destaraje → <strong>Generar corte</strong> (en CxP) → Pagos. Verifica que ya diste clic en "Generar corte" en CxP para este periodo antes de importar Pagos — si no, los pagos no encontrarán su CxP y quedarán como "Sin CxP vinculada".</p>
    <input type="file" id="ai-archivo" accept=".xlsx">
    <div class="admin-importar-modo">
      <label><input type="radio" name="ai-modo" value="agregar" id="ai-modo-agregar" checked> Agregar</label>
      <label><input type="radio" name="ai-modo" value="reemplazar" id="ai-modo-reemplazar"> Reemplazar todo</label>
    </div>
    <p style="font-size:0.85em;color:#666;">Nota: las hojas "Saldos Iniciales" (cuentas por pagar históricas), "Inventario Inicial" (hoja opcional), "Control Producción", "Composiciones", "Ventas", "Precios Generales" y "Ajustes por Proveedor" siempre se agregan, nunca se reemplazan, sin importar el modo elegido.</p>
    <p style="background:#fff3cd;border:1px solid #ffe08a;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85em;">⚠️ <strong>Precios Generales:</strong> "Material" debe ser un material del catálogo. Cada fila crea un nuevo precio vigente desde "Fecha Vigencia" y cierra automáticamente el precio anterior de ese Material, igual que al crear uno manualmente.</p>
    <p style="background:#fff3cd;border:1px solid #ffe08a;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85em;">⚠️ <strong>Ajustes por Proveedor:</strong> "Tipo Ajuste" debe ser Monto o Porcentaje. Cada fila crea un ajuste vigente desde "Fecha Vigencia" para ese Material + Proveedor y cierra automáticamente el ajuste anterior de esa misma combinación, si existía.</p>
    <p style="background:#fff3cd;border:1px solid #ffe08a;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85em;">⚠️ <strong>Composiciones:</strong> cada Material Entrada debe repetirse en una fila por subproducto; "Es Merma" = Sí/No; si No, el Subproducto debe ser un material del catálogo; la suma de "%" por Material Entrada debe dar 100. Cada Material Entrada importado genera una nueva versión (cierra la vigente anterior), igual que al crear manualmente.</p>
    <p style="background:#fff3cd;border:1px solid #ffe08a;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.85em;">⚠️ <strong>Ventas:</strong> usa la misma "Grupo Venta" en varias filas para agrupar líneas de un mismo documento (deben compartir Fecha, Cliente y Ticket Relacionado). "Material" debe ser un producto de venta válido; "Ticket Relacionado" es opcional y no se valida contra tickets existentes. Consulta la hoja "Instrucciones" de la plantilla para el detalle completo.</p>
    <input type="text" id="ai-confirmar-texto" placeholder="Escribe CONFIRMAR" style="display:none">
    <div id="ai-vista-previa"></div>
    <button type="button" id="ai-confirmar-importacion" class="btn-primary" disabled>Confirmar importación</button>
    <hr>
    <div class="admin-importar-header">
      <h3>Resincronizar pagos huérfanos</h3>
      <button type="button" id="ai-resincronizar" class="btn-secondary">Resincronizar pagos huérfanos</button>
    </div>
    <p style="font-size:0.85em;color:#666;">Busca pagos ya guardados en Firestore que no quedaron vinculados a su Cuenta por Pagar (por ejemplo, porque el corte de CxP se generó después de importar los Pagos) e intenta vincularlos ahora, leyendo datos frescos de Firestore.</p>
    <div id="ai-resync-resultado"></div>
  `;
  tarjeta.querySelector('#ai-descargar-plantilla').addEventListener('click', manejarDescargarPlantilla);
  tarjeta.querySelector('#ai-archivo').addEventListener('change', manejarSeleccionArchivo);
  tarjeta.querySelector('#ai-modo-agregar').addEventListener('change', () => manejarCambioModo('agregar'));
  tarjeta.querySelector('#ai-modo-reemplazar').addEventListener('change', () => manejarCambioModo('reemplazar'));
  tarjeta.querySelector('#ai-confirmar-texto').addEventListener('input', actualizarBotonConfirmar);
  tarjeta.querySelector('#ai-confirmar-importacion').addEventListener('click', manejarConfirmarImportacion);
  tarjeta.querySelector('#ai-resincronizar').addEventListener('click', manejarResincronizarPagosHuerfanos);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_IMPORTAR, {
  crearVistaImportar
});

})();
