(function () {

// Reglas de proceso de la captura simplificada de Control Producción (K21). Funciones PURAS: sin DOM ni Firestore, y
// sin nombres de materiales. Lo que depende de un material (de qué molido sale, qué pellet consume una pieza, qué
// rechazo genera, en qué proceso se produce) se LEE de window.EVE_CATALOGO.reglasDe(); lo que depende del proceso, de
// window.REGLAS_PROCESO (config.js); las etapas de origen y los saldos, de window.EVE_INVENTARIO (K18, K21b).
// Las mezclas de pellet NO se modelan: en PELETIZADO la salida es libre (el operador elige los molidos y el pellet).

const UMBRAL_SALDO = 0.005;

function redondear2(valor) {
  return Math.round(valor * 100) / 100;
}

function nombreMaterial(material) {
  return window.normalizarMaterial(material);
}

function reglasProceso(proceso) {
  return (window.REGLAS_PROCESO || {})[proceso] || null;
}

function sumaKg(filas) {
  return (filas || []).reduce((suma, f) => suma + (Number(f.kg) || 0), 0);
}

function unicos(valores) {
  return Array.from(new Set(valores.filter(Boolean)));
}

// ── Reglas de material (del catálogo) ────────────────────────────────────

// Molido que resulta de moler el material (crudos y rechazos); null si no se muele.
function molidoDe(material) {
  return window.EVE_CATALOGO.reglasDe(material).muelePara || null;
}

// Pellets que consume una pieza: lista de opciones, la primera es la sugerida (los tapones eligen entre dos).
function pelletsParaProducto(producto) {
  const pellets = window.EVE_CATALOGO.reglasDe(producto).pelletUsado;
  if (!pellets) return [];
  return Array.isArray(pellets) ? pellets.slice() : [pellets];
}

// Rechazo recuperable que genera una pieza; null si no tiene (TAPON, ORING y SELLO).
function rechazoParaProducto(producto) {
  return window.EVE_CATALOGO.reglasDe(producto).rechazoGenerado || null;
}

// Piezas (PZ) que se producen en un proceso de pieza, en el orden del catálogo.
function productosDeProceso(proceso) {
  return window.EVE_CATALOGO.listar()
    .filter((m) => m.unidad === 'PZ' && m.reglas && m.reglas.procesoProduccion === proceso)
    .map((m) => m.nombre);
}

// Tipo de merma que se propone en un proceso (BASURA, LODOS o PIEDRAS según window.TIPOS_MERMA); null si el proceso
// no calcula merma (EMPACADO y las piezas).
function tipoMermaPorDefecto(proceso) {
  const regla = reglasProceso(proceso);
  if (!regla || regla.sinMerma) return null;
  return window.tiposMermaParaProceso(proceso)[0] || null;
}

// ── Entradas derivadas ───────────────────────────────────────────────────

function etiquetaEntrada(material, detalle, saldoTotal) {
  if (detalle.length === 0) return `${material} — sin saldo`;
  if (detalle.length === 1) return `${material} — ${redondear2(saldoTotal)} kg en ${detalle[0].etapa}`;
  return `${material} — ${redondear2(saldoTotal)} kg (${detalle.map((d) => `${redondear2(d.saldo)} ${d.etapa}`).join(' · ')})`;
}

// Materiales que se pueden ofrecer como entrada de un proceso: [{ material, saldoTotal, detalle[{etapa,saldo}], etiqueta }].
// saldosPorEtapa: { [material]: { [etapa]: saldo } } (EVE_INVENTARIO.calcularSaldosPorEtapaEnFecha). Por omisión solo
// los materiales con saldo > 0 en SUS etapas de origen (EVE_INVENTARIO.etapasOrigen: depende de requiereSeleccion).
// mostrarTodos: todos los materiales con existencias del catálogo, con o sin saldo y en cualquier etapa; solo quita el
// filtro de etapas y saldo: en un proceso con salida 'molido' (Molienda) sigue limitado a los materiales que se muelen
// (reglas.muelePara). Un material archivado solo aparece si tiene saldo; las piezas (PZ) nunca son entrada de kg.
function opcionesEntrada(proceso, saldosPorEtapa, opciones) {
  const mostrarTodos = !!(opciones && opciones.mostrarTodos);
  const saldos = saldosPorEtapa || {};
  const regla = reglasProceso(proceso);
  const piezas = new Set(window.materialesPZ());
  const candidatos = new Set(window.materialesConStock());
  Object.keys(saldos).forEach((material) => candidatos.add(material));
  const lista = [];
  candidatos.forEach((material) => {
    const estado = window.EVE_CATALOGO.estadoDe(material);
    if (estado === 'inexistente' || piezas.has(material)) return;
    if (regla && regla.reglaSalida === 'molido' && !molidoDe(material)) return;
    const porEtapa = saldos[material] || {};
    const etapas = mostrarTodos ? Object.keys(porEtapa) : window.EVE_INVENTARIO.etapasOrigen(proceso, material);
    const detalle = etapas
      .map((etapa) => ({ etapa, saldo: porEtapa[etapa] || 0 }))
      .filter((d) => d.saldo > UMBRAL_SALDO);
    if (detalle.length === 0 && (!mostrarTodos || estado === 'archivado')) return;
    const saldoTotal = detalle.reduce((suma, d) => suma + d.saldo, 0);
    lista.push({ material, saldoTotal, detalle, etiqueta: etiquetaEntrada(material, detalle, saldoTotal) });
  });
  return lista.sort((a, b) => a.material.localeCompare(b.material, 'es'));
}

// ── Salidas sugeridas ────────────────────────────────────────────────────

// Salidas que se precargan al elegir las entradas: { filas[{ material, kg:null, esMerma:false, origen }], avisos[
// { codigo, material?, mensaje }], merma: { material, porcentajeEsperado } | null }. inputs: [{ material, kg }].
// opciones: { composicion (la vigente del material de entrada, solo SELECCION), fecha, producto (solo piezas) }.
//   'composicion'    — subproductos NO merma de la composición; la merma esperada sale de sus componentes esMerma.
//                      Sin composición: sin filas y aviso 'falta_composicion'.
//   'mismo-material' — el mismo material de cada entrada.
//   'molido'         — el molido de cada entrada (reglas.muelePara).
//   'libre'          — sin sugerencia (PELETIZADO: el operador elige uno o varios molidos y el pellet de salida).
//   'pieza'          — el producto elegido (debe producirse en el proceso) y su rechazo derivado, si lo tiene.
// El kg va vacío: lo captura el operador. Una salida repetida entre entradas se sugiere una sola vez.
function salidasSugeridas(proceso, inputs, opciones) {
  opciones = opciones || {};
  const resultado = { filas: [], avisos: [], merma: null };
  const regla = reglasProceso(proceso);
  if (!regla) return resultado;
  const materiales = unicos((inputs || []).map((i) => nombreMaterial(i.material)));
  const agregar = (material, origen, extra) => {
    if (material && !resultado.filas.some((f) => f.material === material)) {
      resultado.filas.push({ material, kg: null, esMerma: false, origen, ...extra });
    }
  };

  if (regla.reglaSalida === 'composicion') {
    const composicion = opciones.composicion || null;
    if (!composicion) {
      if (materiales.length > 0) {
        resultado.avisos.push({ codigo: 'falta_composicion', material: materiales[0], mensaje: `Falta composición de ${materiales[0]}: captura las salidas a mano` });
      }
    } else {
      const componentes = composicion.componentes || [];
      componentes.filter((c) => !c.esMerma).forEach((c) => agregar(nombreMaterial(c.subproducto), 'composicion'));
      const mermas = componentes.filter((c) => c.esMerma);
      resultado.merma = {
        material: mermas.length > 0 ? nombreMaterial(mermas[0].subproducto) : tipoMermaPorDefecto(proceso),
        porcentajeEsperado: mermas.reduce((suma, c) => suma + (Number(c.porcentaje) || 0), 0)
      };
    }
  } else if (regla.reglaSalida === 'mismo-material') {
    materiales.forEach((material) => agregar(material, 'regla'));
  } else if (regla.reglaSalida === 'molido') {
    materiales.forEach((material) => agregar(molidoDe(material), 'regla'));
  } else if (regla.reglaSalida === 'pieza') {
    const producto = nombreMaterial(opciones.producto);
    if (producto && !productosDeProceso(proceso).includes(producto)) {
      resultado.avisos.push({ codigo: 'producto_fuera_de_proceso', material: producto, mensaje: `"${producto}" no se produce en este proceso` });
    } else if (producto) {
      agregar(producto, 'pieza', { unidad: 'PZ' });
      agregar(rechazoParaProducto(producto), 'rechazo');
    }
  }

  if (!resultado.merma) {
    const tipo = tipoMermaPorDefecto(proceso);
    resultado.merma = tipo ? { material: tipo, porcentajeEsperado: null } : null;
  }
  return resultado;
}

// ── Merma por diferencia y avisos (K21c) ─────────────────────────────────

// merma = suma de kg de entrada - suma de kg de salidas no merma, solo en los procesos de kg con tipo de merma. Devuelve
// { proceso, kgEntrada, kgSalida, diferencia, kgMerma, porcentaje, tipo, estado }. estado:
//   'merma'           — diferencia > 0: kgMerma = diferencia y porcentaje sobre la entrada.
//   'sin_diferencia'  — diferencia entre -0.01 y 0.01: kgMerma 0 (no se agrega fila de merma).
//   'salidas_exceden' — salidas mayores que la entrada: NO se inventa merma negativa (kgMerma 0); se avisa fuerte.
//   'sin_entrada'     — entrada en cero.
//   'sin_merma'       — proceso sin merma (EMPACADO y piezas); en EMPACADO evaluarAvisoMerma compara salida y entrada.
function calcularMermaPorDiferencia(inputs, outputsNoMerma, proceso) {
  const kgEntrada = redondear2(sumaKg(inputs));
  const kgSalida = redondear2(sumaKg(outputsNoMerma));
  const diferencia = redondear2(kgEntrada - kgSalida);
  const resultado = { proceso, kgEntrada, kgSalida, diferencia, kgMerma: 0, porcentaje: 0, tipo: tipoMermaPorDefecto(proceso), estado: 'sin_merma' };
  if (!resultado.tipo) return resultado;
  if (kgEntrada <= 0) return { ...resultado, estado: 'sin_entrada' };
  if (Math.abs(diferencia) <= 0.01 + 1e-9) return { ...resultado, estado: 'sin_diferencia' };
  if (diferencia < 0) return { ...resultado, estado: 'salidas_exceden' };
  return { ...resultado, kgMerma: diferencia, porcentaje: redondear2((diferencia / kgEntrada) * 100), estado: 'merma' };
}

// Umbral de % de merma a partir del cual se avisa, o null si todavía no hay con qué comparar:
// Selección con composición = su merma esperada + window.TOLERANCIA_MERMA_PUNTOS; si no, el umbral fijo del proceso
// (window.UMBRAL_MERMA_PROCESO); si no, el promedio histórico del proceso más window.TOLERANCIA_MERMA_HISTORICA_PUNTOS,
// pero solo con al menos window.MIN_REGISTROS_MERMA_HISTORICA registros con merma calculada (contexto.historico:
// { promedio, registros }; el promedio exacto como umbral avisaría cerca de la mitad de las veces). Sin datos suficientes
// no hay umbral. Un número suelto en contexto.historico no trae el conteo de registros, así que no cuenta.
function umbralMerma(proceso, contexto) {
  const regla = reglasProceso(proceso);
  if (regla && regla.reglaSalida === 'composicion' && contexto.composicion) {
    const esperado = (contexto.composicion.componentes || []).filter((c) => c.esMerma).reduce((suma, c) => suma + (Number(c.porcentaje) || 0), 0);
    return { valor: esperado + window.TOLERANCIA_MERMA_PUNTOS, descripcion: `la esperada de la composición (${redondear2(esperado)} %) más ${window.TOLERANCIA_MERMA_PUNTOS} puntos` };
  }
  const fijo = (window.UMBRAL_MERMA_PROCESO || {})[proceso];
  if (Number.isFinite(fijo)) return { valor: fijo, descripcion: `el umbral del proceso (${fijo} %)` };
  const historico = contexto.historico;
  if (historico && Number.isFinite(historico.promedio) && historico.registros >= window.MIN_REGISTROS_MERMA_HISTORICA) {
    return {
      valor: historico.promedio + window.TOLERANCIA_MERMA_HISTORICA_PUNTOS,
      descripcion: `el promedio histórico del proceso (${redondear2(historico.promedio)} %, ${historico.registros} registros) más ${window.TOLERANCIA_MERMA_HISTORICA_PUNTOS} puntos`
    };
  }
  return null;
}

// Aviso (nunca bloquea) para el resultado de calcularMermaPorDiferencia. contexto: { composicion, historico: { promedio, registros } }.
// Devuelve { nivel: 'ok' | 'aviso' | 'fuerte', mensaje }. 'fuerte' (salidas mayores que la entrada) se permite guardar
// con confirmación y motivo.
function evaluarAvisoMerma(resultado, contexto) {
  contexto = contexto || {};
  const ok = { nivel: 'ok', mensaje: '' };
  if (resultado.estado === 'salidas_exceden') {
    return {
      nivel: 'fuerte',
      mensaje: `Las salidas (${resultado.kgSalida} kg) superan la entrada (${resultado.kgEntrada} kg) por ${redondear2(-resultado.diferencia)} kg: revisa el pesaje o la captura. Se puede guardar con confirmación y motivo.`
    };
  }
  const regla = reglasProceso(resultado.proceso);
  if (regla && regla.comparaEntradaSalida) {
    if (resultado.kgEntrada <= 0) return ok;
    const diferenciaPct = (Math.abs(resultado.kgSalida - resultado.kgEntrada) / resultado.kgEntrada) * 100;
    if (diferenciaPct <= window.TOLERANCIA_EMPACADO_PCT + 1e-9) return ok;
    return { nivel: 'aviso', mensaje: `La salida (${resultado.kgSalida} kg) difiere de la entrada (${resultado.kgEntrada} kg) en ${redondear2(diferenciaPct)} %, más de la tolerancia de ${window.TOLERANCIA_EMPACADO_PCT} %.` };
  }
  if (resultado.estado !== 'merma') return ok;
  const umbral = umbralMerma(resultado.proceso, contexto);
  if (!umbral || resultado.porcentaje <= umbral.valor + 1e-9) return ok;
  return { nivel: 'aviso', mensaje: `La merma de ${resultado.porcentaje} % supera ${umbral.descripcion}.` };
}

// ── ticketOrigen automático (K21d) ───────────────────────────────────────

// Ticket de origen de una entrada: el ÚLTIMO ticket que produjo ese material en la etapa de origen a la fecha del
// proceso. Es una aproximación (v1): no hay FIFO ni lotes, por eso se devuelve { ticket, inferido:true } y el registro
// lo marca como inferido. Con varias etapas de origen se toma la de más saldo (empate: la primera de la lista).
//   RECEPCIÓN -> último ticket de Báscula DE ESE MATERIAL (fechaSalida, luego número). Un ticket de Báscula puede tener
//                renglones de materiales distintos y varios del mismo material: el origen es la pareja ticket + material,
//                y los renglones repetidos del mismo material en un ticket son un solo origen.
//   otra etapa -> último proceso P-### con ese material entre sus salidas no merma y esa etapa de destino.
// Devuelve null si no hay candidato. exclusiones.controlProduccionId: el registro que se edita. No modifica datos.
function resolverTicketOrigen(material, etapasOrigen, fecha, datos, exclusiones) {
  const inv = window.EVE_INVENTARIO;
  const clave = nombreMaterial(material);
  const dia = inv.fechaDia(fecha);
  if (!clave || !dia || !etapasOrigen || etapasOrigen.length === 0) return null;
  exclusiones = exclusiones || {};
  const saldos = inv.calcularSaldosPorEtapaEnFecha(datos, fecha, exclusiones)[clave] || {};
  let etapa = etapasOrigen[0];
  etapasOrigen.forEach((e) => { if ((saldos[e] || 0) > (saldos[etapa] || 0) + 1e-9) etapa = e; });

  let candidatos;
  if (etapa === 'RECEPCIÓN') {
    candidatos = (datos.registrosDestaraje || [])
      .filter((r) => r.ticket && nombreMaterial(r.material) === clave && inv.fechaDia(r.fechaSalida) <= dia)
      .map((r) => ({ ticket: r.ticket, dia: inv.fechaDia(r.fechaSalida) }))
      .sort((a, b) => (a.dia === b.dia ? inv.compararTicketsRecepcion(a, b) : (a.dia < b.dia ? -1 : 1)));
  } else {
    candidatos = (datos.registrosControlProduccion || [])
      .filter((r) => r.id !== exclusiones.controlProduccionId
        && inv.ETAPA_POR_PROCESO[r.tipoProceso] === etapa
        && inv.fechaDia(window.fechaProceso(r)) <= dia
        && (r.outputs || []).some((o) => !o.esMerma && nombreMaterial(o.material) === clave && Number(o.kg) > 0))
      .map((r) => ({ ticket: r.ticket, dia: inv.fechaDia(window.fechaProceso(r)) }))
      .sort((a, b) => (a.dia === b.dia ? inv.compararTicketsProceso(a, b) : (a.dia < b.dia ? -1 : 1)));
  }
  if (candidatos.length === 0) return null;
  return { ticket: String(candidatos[candidatos.length - 1].ticket), inferido: true };
}

// ── Apoyos de la captura simple (K21e a K21i) ────────────────────────────

// La captura simple cubre los procesos cuya salida se puede derivar de las entradas: composición (Selección), mismo
// material (Empacado, Lavado) y molido (Molienda). Peletizado (salida libre) y las piezas quedan en la captura completa.
function procesoSoportaCapturaSimple(proceso) {
  const regla = reglasProceso(proceso);
  return !!regla && ['composicion', 'mismo-material', 'molido'].includes(regla.reglaSalida);
}

// Si el proceso admite más de una fila de entrada y si, además, hay que avisar de la mezcla: Selección es de un material
// por ticket (la composición es por material de entrada), así que se puede agregar otro pero con aviso.
function reglaEntradasMultiples(proceso) {
  const regla = reglasProceso(proceso);
  if (!regla) return { permite: false, avisaMezcla: false };
  const avisaMezcla = regla.reglaSalida === 'composicion';
  return { permite: !!regla.multiInput || avisaMezcla, avisaMezcla };
}

// Promedio histórico de % de merma de un proceso, SOLO con los registros de merma calculada (mermaCalculada === true:
// los que guarda la captura simple). Alimenta contexto.historico de evaluarAvisoMerma.
function historicoMerma(registros, proceso) {
  const validos = (registros || []).filter((r) => r.tipoProceso === proceso && r.mermaCalculada === true && Number.isFinite(Number(r.porcentajeMerma)));
  if (validos.length === 0) return { promedio: null, registros: 0 };
  return { promedio: validos.reduce((suma, r) => suma + Number(r.porcentajeMerma), 0) / validos.length, registros: validos.length };
}

// Último registro de un proceso (por día y luego por número de ticket); null si no hay.
function ultimoRegistroDelProceso(registros, proceso) {
  const inv = window.EVE_INVENTARIO;
  const delProceso = (registros || []).filter((r) => r.tipoProceso === proceso);
  if (delProceso.length === 0) return null;
  return delProceso.reduce((ultimo, r) => {
    const diaUltimo = inv.fechaDia(window.fechaProceso(ultimo));
    const dia = inv.fechaDia(window.fechaProceso(r));
    if (dia !== diaUltimo) return dia > diaUltimo ? r : ultimo;
    return inv.compararTicketsProceso(r, ultimo) > 0 ? r : ultimo;
  });
}

// Arma lo que recibe construirRegistroDesdeFormulario a partir de lo que capturó el operador en el formulario simple.
// captura: { proceso, fecha, operador, turno, observaciones, inputs:[{ material, kg }], outputs:[{ material, kg }],
// merma: { material, kg, editada } | null }. El ticketOrigen de cada entrada se resuelve solo (resolverTicketOrigen) y
// queda marcado como inferido; las salidas sin kg se omiten (no son errores); la merma calculada va como un output de
// merma del tipo del proceso. Devuelve { datos, inferidos[bool por entrada], mermaCalculada: boolean | null }.
function armarDatosDesdeCapturaSimple(captura, datosLedger, exclusiones) {
  const inv = window.EVE_INVENTARIO;
  const conKg = (fila) => Number(fila.kg) > 0;
  const inputs = (captura.inputs || []).filter((i) => i.material || String(i.kg || '') !== '');
  const inferidos = [];
  const entradas = inputs.map((input) => {
    const material = nombreMaterial(input.material);
    const origen = material ? resolverTicketOrigen(material, inv.etapasOrigen(captura.proceso, material), captura.fecha, datosLedger, exclusiones) : null;
    inferidos.push(!!origen);
    return { material: input.material, kg: input.kg, ticketOrigen: origen ? origen.ticket : '' };
  });
  const outputs = (captura.outputs || []).filter(conKg).map((o) => ({ material: o.material, kg: o.kg, esMerma: false }));
  let mermaCalculada = null;
  if (captura.merma && conKg(captura.merma)) {
    outputs.push({ material: captura.merma.material, kg: captura.merma.kg, esMerma: true });
    mermaCalculada = !captura.merma.editada;
  }
  return {
    datos: {
      tipoProceso: captura.proceso,
      inputs: entradas,
      outputs,
      operador: captura.operador,
      turno: captura.turno,
      fecha: captura.fecha,
      observaciones: captura.observaciones || ''
    },
    inferidos,
    mermaCalculada
  };
}

window.EVE_CP_REGLAS = {
  procesoSoportaCapturaSimple,
  reglaEntradasMultiples,
  historicoMerma,
  ultimoRegistroDelProceso,
  armarDatosDesdeCapturaSimple,
  molidoDe,
  pelletsParaProducto,
  rechazoParaProducto,
  productosDeProceso,
  tipoMermaPorDefecto,
  opcionesEntrada,
  salidasSugeridas,
  calcularMermaPorDiferencia,
  evaluarAvisoMerma,
  resolverTicketOrigen
};

})();
