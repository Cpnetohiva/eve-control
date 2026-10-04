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
    // Un solo material (opciones.composicion) o varios (opciones.composiciones: [{ material, kg, composicion|null }]): con
    // varios la precarga es la UNIÓN de los componentes de todas las composiciones y la merma esperada se pondera por kg.
    const varios = Array.isArray(opciones.composiciones);
    const composicion = varios ? combinarComposiciones(opciones.composiciones) : (opciones.composicion || null);
    if (varios) {
      opciones.composiciones.filter((i) => i && !i.composicion).forEach((i) => {
        const material = nombreMaterial(i.material);
        resultado.avisos.push({ codigo: 'falta_composicion', material, mensaje: `Falta composición de ${material}: captura las salidas a mano` });
      });
    } else if (!composicion && materiales.length > 0) {
      resultado.avisos.push({ codigo: 'falta_composicion', material: materiales[0], mensaje: `Falta composición de ${materiales[0]}: captura las salidas a mano` });
    }
    if (composicion) {
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

// ── Apoyos de la captura simple (K21e a K21k) ────────────────────────────

// La captura simple cubre todos los procesos con reglas: composición (Selección), mismo material (Empacado, Lavado),
// molido (Molienda), salida libre (Peletizado) y pieza (Inyección, Soplado y Tapones).
function procesoSoportaCapturaSimple(proceso) {
  const regla = reglasProceso(proceso);
  return !!regla && ['composicion', 'mismo-material', 'molido', 'libre', 'pieza'].includes(regla.reglaSalida);
}

function esProcesoDePieza(proceso) {
  const regla = reglasProceso(proceso);
  return !!regla && regla.reglaSalida === 'pieza';
}

// Pellets que el operador puede elegir como salida de un proceso de salida libre (Peletizado): los materiales KG que salen
// de proceso, no requieren selección y no son rechazo, subproducto vendible (p. ej. LECHERO LAVADO) ni molido (molido = lo
// que algún material indica en reglas.muelePara).
// Sale del catálogo, así que un pellet o un 'X PELETIZADO' nuevo aparece solo. Vacío en los demás procesos. NO hay
// sugerencia de mezcla ni de fórmula: solo la lista de salidas posibles.
function salidasLibresPermitidas(proceso) {
  const regla = reglasProceso(proceso);
  if (!regla || regla.reglaSalida !== 'libre') return [];
  const catalogo = window.EVE_CATALOGO.listar();
  const molidos = new Set(catalogo.map((m) => m.reglas && m.reglas.muelePara).filter(Boolean).map(nombreMaterial));
  return catalogo
    .filter((m) => m.unidad === 'KG' && m.seObtieneEnProduccion && m.requiereSeleccion === false && m.tipo !== 'rechazo' && m.tipo !== 'subproducto' && !molidos.has(m.nombre))
    .map((m) => m.nombre)
    .sort((a, b) => a.localeCompare(b, 'es'));
}

// Composición equivalente a varias: items = [{ material, kg, composicion|null }]. Los materiales sin composición no
// cuentan. Una sola devuelve esa composición tal cual. Con varias, cada subproducto (y cada tipo de merma) es el promedio de
// sus porcentajes ponderado por los kg de entrada de cada material (sin kg, todos pesan igual); los nombres no se duplican.
// Devuelve null si ninguno tiene composición.
function combinarComposiciones(items) {
  const con = (items || []).filter((i) => i && i.composicion);
  if (con.length === 0) return null;
  if (con.length === 1) return con[0].composicion;
  const kgs = con.map((i) => Math.max(Number(i.kg) || 0, 0));
  const pesos = kgs.some((k) => k > 0) ? kgs : con.map(() => 1);
  const total = pesos.reduce((suma, p) => suma + p, 0);
  const acumulado = new Map();
  con.forEach((item, indice) => {
    (item.composicion.componentes || []).forEach((c) => {
      const subproducto = nombreMaterial(c.subproducto);
      const esMerma = !!c.esMerma;
      const clave = `${esMerma ? 'merma' : 'salida'}|${subproducto}`;
      if (!acumulado.has(clave)) acumulado.set(clave, { subproducto, esMerma, porcentaje: 0 });
      acumulado.get(clave).porcentaje += ((Number(c.porcentaje) || 0) * pesos[indice]) / total;
    });
  });
  return { componentes: Array.from(acumulado.values()).map((c) => ({ ...c, porcentaje: redondear2(c.porcentaje) })), combinada: true };
}

// Entradas de un proceso de pieza para un producto: el pellet se deriva de reglas.pelletUsado del producto (una opción se
// preselecciona; los tapones eligen entre PELLET TAPON y MATERIAL VIRGEN). Devuelve { opciones, avisos, sugerida }.
//   - Con saldo en alguno de sus pellets: se ofrecen SOLO los pellets del producto (los sin saldo con la etiqueta "sin saldo").
//   - Sin saldo en ninguno: aviso 'sin_saldo_pellet' y, además, cualquier material con saldo en las etapas de origen de K18
//     (PELETIZADO, y RECEPCIÓN para los que no requieren selección).
//   - mostrarTodos: los pellets del producto primero y luego todo lo demás.
// sugerida: el primer pellet con saldo, o el primero. Sin producto devuelve vacío.
function opcionesEntradaPieza(proceso, producto, saldosPorEtapa, opciones) {
  const resultado = { opciones: [], avisos: [], sugerida: null };
  const clave = nombreMaterial(producto);
  if (!clave || !esProcesoDePieza(proceso)) return resultado;
  const base = opcionesEntrada(proceso, saldosPorEtapa, opciones);
  const pellets = pelletsParaProducto(clave);
  const preferidos = pellets.map((material) => base.find((o) => o.material === material)
    || { material, saldoTotal: 0, detalle: [], etiqueta: etiquetaEntrada(material, [], 0) });
  const hayPellet = preferidos.some((o) => o.saldoTotal > UMBRAL_SALDO);
  const otros = base.filter((o) => !pellets.includes(o.material));
  if (pellets.length > 0 && !hayPellet) {
    resultado.avisos.push({ codigo: 'sin_saldo_pellet', producto: clave, mensaje: `No hay saldo de ${pellets.join(' ni ')} para ${clave}: elige otro material con saldo` });
  }
  const soloPellets = pellets.length > 0 && hayPellet && !(opciones && opciones.mostrarTodos);
  resultado.opciones = pellets.length === 0 ? base : (soloPellets ? preferidos : preferidos.concat(otros));
  const conSaldo = preferidos.find((o) => o.saldoTotal > UMBRAL_SALDO);
  resultado.sugerida = (conSaldo || preferidos[0] || resultado.opciones[0] || {}).material || null;
  return resultado;
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
    // Al editar, una entrada con su material sin cambiar conserva el origen que ya tenía (aunque esté vacío o lo haya
    // escrito una persona): no se vuelve a resolver. Solo se marca inferido si ya lo estaba.
    if (input.origen && nombreMaterial(input.origen.material) === material) {
      inferidos.push(!!input.origen.inferido);
      return { material: input.material, kg: input.kg, ticketOrigen: input.origen.ticket || '' };
    }
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

// ── Edición y compatibilidad (K21l) ──────────────────────────────────────

// ¿Un registro guardado se puede editar en el formulario simple? Solo si su proceso está cubierto y su estructura cabe en él
// (lo que el formulario simple sabe pintar sin perder nada); si no, se edita con la captura completa de siempre.
// Devuelve { cabe, motivo }. No juzga fechas ni turno: un registro anterior (fechaInicio y fechaFin, turno Nocturno, sin
// mermaCalculada ni ticketOrigen) cabe y se conserva tal cual al editar.
function cabeEnCapturaSimple(registro) {
  const no = (motivo) => ({ cabe: false, motivo });
  const proceso = registro && registro.tipoProceso;
  if (!procesoSoportaCapturaSimple(proceso)) return no('el proceso no está cubierto por la captura simple');
  const inputs = registro.inputs || [];
  const outputs = registro.outputs || [];
  if (inputs.length === 0 || outputs.length === 0) return no('el registro no tiene entradas o salidas');
  const activo = (material) => window.EVE_CATALOGO.estadoDe(material) === 'activo';
  if (!inputs.every((i) => activo(i.material) && Number(i.kg) > 0)) return no('una entrada está fuera del catálogo, archivada o sin kg');
  if (reglasProceso(proceso).reglaSalida === 'molido' && !inputs.every((i) => molidoDe(i.material))) return no('la Molienda solo ofrece los materiales que se muelen');
  const entradas = reglaEntradasMultiples(proceso);
  if (inputs.length > 1 && !entradas.permite) return no('el proceso solo admite una entrada en la captura simple');
  const regla = reglasProceso(proceso);
  const mermas = outputs.filter((o) => o.esMerma);
  const noMerma = outputs.filter((o) => !o.esMerma);
  if (mermas.length > 1) return no('tiene más de una fila de merma');
  if (mermas.length > 0 && regla.sinMerma) return no('el proceso no tiene merma y el registro trae una');
  if (!mermas.every((o) => window.tiposMermaParaProceso(proceso).includes(nombreMaterial(o.material)))) return no('la merma no es un tipo de merma del proceso');
  if (!noMerma.every((o) => activo(o.material) && Number(o.kg) > 0)) return no('una salida está fuera del catálogo, archivada o sin kg');
  const piezas = new Set(window.materialesPZ());
  const salidasPieza = noMerma.filter((o) => piezas.has(nombreMaterial(o.material)));
  if (regla.reglaSalida === 'pieza') {
    if (inputs.length !== 1) return no('un proceso de pieza usa una sola entrada');
    if (salidasPieza.length !== 1) return no('un proceso de pieza produce un solo tipo de pieza');
    const producto = nombreMaterial(salidasPieza[0].material);
    if (!productosDeProceso(proceso).includes(producto)) return no(`${producto} no se produce en este proceso`);
    const otros = noMerma.filter((o) => !piezas.has(nombreMaterial(o.material)));
    const rechazo = rechazoParaProducto(producto);
    if (!otros.every((o) => rechazo && nombreMaterial(o.material) === rechazo) || otros.length > 1) return no('la salida en kg no es el rechazo derivado del producto');
    return { cabe: true, motivo: '' };
  }
  if (salidasPieza.length > 0) return no('un proceso de kg trae una pieza como salida');
  // Las salidas que la captura simple no deriva se pintan como filas manuales, cuyas opciones son estas.
  const libres = salidasLibresPermitidas(proceso);
  const disponibles = new Set(libres.length > 0 ? libres : window.materialesProducibles().concat(inputs.map((i) => nombreMaterial(i.material))));
  if (!noMerma.every((o) => disponibles.has(nombreMaterial(o.material)))) return no('una salida no está entre las que ofrece este proceso');
  return { cabe: true, motivo: '' };
}

// Advertencias (NUNCA errores) de un registro de Control Producción que no sigue la regla de su proceso. Las usa el importador:
// el archivo es explícito y se respeta tal cual (no se calcula merma ni ticketOrigen); esto solo avisa en la vista previa.
// Devuelve [texto]. La validación de catálogo (K12: materiales, tipos de merma por proceso) sigue siendo bloqueante en el
// importador y no se repite aquí.
function advertenciasDeReglasProceso(registro) {
  const proceso = registro && registro.tipoProceso;
  const regla = reglasProceso(proceso);
  if (!regla) return [];
  const avisos = [];
  const entradas = unicos((registro.inputs || []).map((i) => nombreMaterial(i.material)));
  const salidas = unicos((registro.outputs || []).filter((o) => !o.esMerma).map((o) => nombreMaterial(o.material)));
  const nombre = (window.NOMBRE_PROCESO_UI && window.NOMBRE_PROCESO_UI[proceso]) || proceso;
  if (regla.reglaSalida === 'mismo-material') {
    salidas.filter((s) => !entradas.includes(s)).forEach((s) => avisos.push(`Salida '${s}' no corresponde a ${nombre}: se espera el mismo material de la entrada`));
  } else if (regla.reglaSalida === 'molido') {
    entradas.filter((m) => !molidoDe(m)).forEach((m) => avisos.push(`'${m}' no se muele: la Molienda solo ofrece los materiales con molido definido`));
    const esperados = unicos(entradas.map(molidoDe));
    salidas.filter((s) => esperados.length > 0 && !esperados.includes(s)).forEach((s) => avisos.push(`Salida '${s}' no es el molido de la entrada (se espera ${esperados.join(' o ')})`));
  } else if (regla.reglaSalida === 'libre') {
    const permitidas = salidasLibresPermitidas(proceso);
    salidas.filter((s) => !permitidas.includes(s)).forEach((s) => avisos.push(`Salida '${s}' no es un pellet que salga de ${nombre}`));
  } else if (regla.reglaSalida === 'composicion') {
    const fecha = window.fechaProceso(registro);
    const esperadas = new Set();
    let hayComposicion = false;
    entradas.forEach((material) => {
      const composicion = window.obtenerComposicionVigente(material, fecha);
      if (!composicion) return;
      hayComposicion = true;
      (composicion.componentes || []).filter((c) => !c.esMerma).forEach((c) => esperadas.add(nombreMaterial(c.subproducto)));
    });
    if (hayComposicion) {
      salidas.filter((s) => !esperadas.has(s) && !entradas.includes(s)).forEach((s) => avisos.push(`Salida '${s}' no está en la composición vigente de la entrada`));
    }
  } else if (regla.reglaSalida === 'pieza') {
    const piezas = new Set(window.materialesPZ());
    const productos = salidas.filter((s) => piezas.has(s));
    productos.filter((p) => !productosDeProceso(proceso).includes(p)).forEach((p) => avisos.push(`'${p}' no se produce en ${nombre}`));
    productos.filter((p) => productosDeProceso(proceso).includes(p)).forEach((p) => {
      const pellets = pelletsParaProducto(p);
      entradas.filter((m) => pellets.length > 0 && !pellets.includes(m)).forEach((m) => avisos.push(`Para ${p} se espera ${pellets.join(' o ')} como material consumido, no '${m}'`));
      const rechazo = rechazoParaProducto(p);
      salidas.filter((s) => !piezas.has(s) && s !== rechazo).forEach((s) => avisos.push(`Salida '${s}' no es el rechazo de ${p}${rechazo ? ` (se espera ${rechazo})` : ' (este producto no genera rechazo)'}`));
    });
  }
  return avisos;
}

// Merma consistente con la diferencia entrada − salidas no merma (±0.01 kg): solo entonces sigue siendo "calculada".
function mermaConsistenteConDiferencia(registro) {
  const kgEntrada = sumaKg(registro.inputs);
  const kgSalida = sumaKg((registro.outputs || []).filter((o) => !o.esMerma));
  const kgMerma = sumaKg((registro.outputs || []).filter((o) => o.esMerma));
  return Math.abs((kgEntrada - kgSalida) - kgMerma) <= 0.01 + 1e-9;
}

// Al editar un registro con la captura COMPLETA los campos opcionales se conservan o se retiran, nunca se inventan:
//  - ticketOrigenInferido sigue en una entrada solo si el registro anterior la tenía marcada y NO se cambió su ticket de
//    origen (tampoco su material): editar el ticket quita la marca.
//  - mermaCalculada solo existe si el registro anterior la tenía; sigue true únicamente si la merma quedó igual y todavía
//    cuadra con la diferencia entrada − salidas, y pasa a false si no. Un registro anterior sin el campo no lo recibe.
// registroNuevo es el que arma construirRegistroDesdeFormulario; se devuelve el mismo objeto, ya ajustado.
function conservarOpcionalesAlEditar(anterior, registroNuevo) {
  const previos = (anterior && anterior.inputs) || [];
  const usados = new Set();
  registroNuevo.inputs.forEach((input) => {
    const indice = previos.findIndex((p, i) => !usados.has(i) && p.ticketOrigenInferido === true
      && nombreMaterial(p.material) === nombreMaterial(input.material) && String(p.ticketOrigen || '') === String(input.ticketOrigen || ''));
    if (indice >= 0) {
      usados.add(indice);
      input.ticketOrigenInferido = true;
    }
  });
  if (anterior && anterior.mermaCalculada !== undefined) {
    const mermas = (o) => (o || []).filter((x) => x.esMerma).map((x) => `${nombreMaterial(x.material)}|${Number(x.kg)}`).sort().join(',');
    const igual = mermas(anterior.outputs) === mermas(registroNuevo.outputs);
    registroNuevo.mermaCalculada = anterior.mermaCalculada === true && igual && mermaConsistenteConDiferencia(registroNuevo);
  }
  return registroNuevo;
}

window.EVE_CP_REGLAS = {
  advertenciasDeReglasProceso,
  cabeEnCapturaSimple,
  conservarOpcionalesAlEditar,
  procesoSoportaCapturaSimple,
  esProcesoDePieza,
  salidasLibresPermitidas,
  combinarComposiciones,
  opcionesEntradaPieza,
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
