(function () {

const PROCESOS = {
  SELECCION:        { nombre: 'Selección',         icono: '🔍' },
  EMPACADO:         { nombre: 'Empacado',           icono: '📦' },
  MOLIENDA:         { nombre: 'Molienda',           icono: '⚙️' },
  LAVADO:           { nombre: 'Lavado',             icono: '💧' },
  PELETIZADO:       { nombre: 'Peletizado',         icono: '🔵' },
  PRODUCCION_CAJAS: { nombre: 'Producción Cajas',  icono: '📫' },
  PRODUCCION_TAMBOS:{ nombre: 'Producción Tambos', icono: '🛢️' },
  PRODUCCION_TAPONES:{ nombre: 'Producción de Tapones', icono: '🔩' }
};

// Procesos "de pieza": su output principal se mide en piezas (MATERIALES_PZ), no en kg,
// así que usan un indicador de Eficiencia distinto (velocidad real vs. velocidad objetivo
// por ciclo de segundos/pieza) en vez del kg-output / kg-input de los procesos de kg puro.
const PROCESOS_PZ = ['PRODUCCION_CAJAS', 'PRODUCCION_TAMBOS', 'PRODUCCION_TAPONES'];

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

// Eficiencia de procesos de pieza: velocidad real (piezas/hora) vs. velocidad objetivo
// derivada del ciclo configurado en Admin (segundosPorPieza). Devuelve null (nunca 0 ni
// un número engañoso) cuando no hay ciclo configurado para el material o no se puede calcular.
function calcularEficienciaPZ(piezasProducidas, horasTrabajo, segundosPorPieza) {
  if (!Number.isFinite(segundosPorPieza) || segundosPorPieza <= 0) return null;
  if (!(horasTrabajo > 0)) return null;
  const velocidadObjetivo = 3600 / segundosPorPieza;
  const velocidadReal = piezasProducidas / horasTrabajo;
  return (velocidadReal / velocidadObjetivo) * 100;
}

function formatearEficiencia(eficiencia) {
  return eficiencia === null || eficiencia === undefined ? 'Sin ciclo configurado' : `${eficiencia.toFixed(2)}%`;
}

// Desglose de outputs por unidad real (pz vs kg) para procesos de pieza — nunca se suman
// piezas y kg en un solo número. Reutiliza formatearKg (config.js/utils.js) por output.
function formatearOutputsDesglose(outputs) {
  const validos = (outputs || []).filter((o) => o.material && Number(o.kg) > 0);
  if (validos.length === 0) return '0 kg';
  return validos
    .map((o) => `${o.material}: ${window.formatearKg(Number(o.kg), o.material)}${o.esMerma ? ' (merma)' : ''}`)
    .join(' + ');
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

function filtrarPorMes(registros, inicioMes) {
  return registros.filter((r) => r.fechaFin.slice(0, 10) >= inicioMes);
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
  let totalMerma = 0;
  let sumaEficiencia = 0;
  let conteoEficiencia = 0;
  for (const registro of registros) {
    totalInput += Number(registro.totalInput) || 0;
    totalOutput += Number(registro.totalOutput) || 0;
    totalMerma += (registro.outputs || []).filter((o) => o.esMerma).reduce((s, o) => s + (Number(o.kg) || 0), 0);
    // Tickets PZ sin ciclo configurado tienen eficiencia:null — se excluyen del promedio
    // (ni suman ni cuentan) en vez de tratarse como 0%, para no sesgar el promedio a la baja.
    if (registro.eficiencia !== null && registro.eficiencia !== undefined) {
      sumaEficiencia += Number(registro.eficiencia);
      conteoEficiencia += 1;
    }
  }
  const eficienciaPromedio = conteoEficiencia > 0 ? sumaEficiencia / conteoEficiencia : null;
  return { totalRegistros: registros.length, totalInput, totalOutput, totalMerma, eficienciaPromedio };
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
      material: window.normalizarMaterial(input.material),
      kg,
      ticketOrigen: input.ticketOrigen ? input.ticketOrigen.trim() : ''
    };
  });
  if (!Array.isArray(datos.outputs) || datos.outputs.length === 0) {
    throw new Error('Agrega al menos un output');
  }
  const outputs = datos.outputs.map((output, indice) => {
    const material = window.normalizarMaterial(output.material);
    if (!material) {
      throw new Error(`El output #${indice + 1} necesita un material`);
    }
    const kg = Number(output.kg);
    if (!Number.isFinite(kg) || kg <= 0) {
      throw new Error(`Kg del output "${material}" debe ser un número mayor a 0`);
    }
    return { material, kg, esMerma: !!output.esMerma };
  });
  if (!outputs.some((o) => !o.esMerma)) {
    throw new Error('Debe haber al menos un output que no sea merma');
  }
  const esPZ = PROCESOS_PZ.includes(datos.tipoProceso);
  if (esPZ) {
    const outputsPzNoMerma = outputs.filter((o) => !o.esMerma && window.MATERIALES_PZ.includes(o.material));
    if (outputsPzNoMerma.length > 1) {
      throw new Error('Un ticket de este proceso solo puede producir un tipo de pieza — un molde distinto requiere un ticket separado');
    }
  }
  if (!datos.operador || !datos.turno || !datos.fechaInicio || !datos.fechaFin) {
    throw new Error('Operador, turno y fechas son obligatorios');
  }
  const horasTrabajo = calcularHorasTrabajo(datos.fechaInicio, datos.fechaFin);
  if (!Number.isFinite(horasTrabajo) || horasTrabajo <= 0) {
    throw new Error('La fecha de fin debe ser posterior a la fecha de inicio');
  }
  const totalInput = inputs.reduce((suma, input) => suma + input.kg, 0);
  const kgMerma = outputs.filter((o) => o.esMerma).reduce((suma, o) => suma + o.kg, 0);
  const porcentajeMerma = calcularPorcentajeMerma(kgMerma, totalInput);
  let totalOutput, eficiencia, productividad;
  if (esPZ) {
    // totalOutput para procesos de pieza NUNCA incluye el conteo de piezas — solo la
    // porción en kg (merma + outputs kg no-merma como pellet reutilizable). El conteo de
    // piezas se reporta aparte (desglose por output), nunca sumado a un total en "kg".
    const kgSalidaNoMerma = outputs
      .filter((o) => !o.esMerma && !window.MATERIALES_PZ.includes(o.material))
      .reduce((suma, o) => suma + o.kg, 0);
    totalOutput = kgSalidaNoMerma + kgMerma;
    const outputPrincipalPZ = outputs.find((o) => !o.esMerma && window.MATERIALES_PZ.includes(o.material)) || null;
    const segundosPorPieza = outputPrincipalPZ
      ? Number((window.EVE.segundosPorPiezaPZ || {})[outputPrincipalPZ.material])
      : NaN;
    eficiencia = outputPrincipalPZ ? calcularEficienciaPZ(outputPrincipalPZ.kg, horasTrabajo, segundosPorPieza) : null;
    productividad = outputPrincipalPZ ? outputPrincipalPZ.kg / horasTrabajo : null;
  } else {
    const kgPrincipal = outputs.filter((o) => !o.esMerma).reduce((suma, o) => suma + o.kg, 0);
    totalOutput = kgPrincipal + kgMerma;
    eficiencia = calcularEficiencia(kgPrincipal, totalInput);
    productividad = calcularProductividad(kgPrincipal, horasTrabajo);
  }
  return {
    tipoProceso: datos.tipoProceso,
    inputs,
    outputs,
    operador: datos.operador,
    turno: datos.turno,
    fechaInicio: datos.fechaInicio,
    fechaFin: datos.fechaFin,
    horasTrabajo,
    totalInput,
    totalOutput,
    eficiencia,
    porcentajeMerma,
    productividad,
    observaciones: datos.observaciones || ''
  };
}

window.EVE_CONTROL_PRODUCCION = {
  PROCESOS,
  PROCESOS_PZ,
  generarSiguienteTicket,
  calcularHorasTrabajo,
  calcularEficiencia,
  calcularEficienciaPZ,
  formatearEficiencia,
  formatearOutputsDesglose,
  calcularPorcentajeMerma,
  calcularProductividad,
  colorEficiencia,
  filtrarPorHoy,
  filtrarPorSemana,
  filtrarPorMes,
  aplicarFiltrosTodos,
  calcularStats,
  construirRegistroDesdeFormulario
};

let editandoId = null;
let editandoTicket = null;
let tipoProcesoSeleccionado = null;
let tipoProcesoSeleccionadoEdicion = null;

function catalogoMaterialesControlProduccion() {
  return window.MATERIALES_COMUNES.concat(window.MATERIALES_PZ);
}

function opcionesMaterialesControlProduccionHtml() {
  return '<option value="">-- Selecciona material --</option>' +
    catalogoMaterialesControlProduccion().map((m) => `<option value="${m}">${m}</option>`).join('');
}

// Al reabrir un registro guardado antes de que este campo fuera un <select> cerrado,
// el valor guardado puede no existir en el catálogo actual. Si no hay match ni por alias,
// NUNCA se deja el <select> en su primera opción real (defaultearía silenciosamente a un
// material incorrecto) — se inserta una opción de advertencia explícita y sin seleccionar
// para forzar al usuario a elegir el valor correcto a mano.
function establecerValorMaterialSelect(select, valorOriginal) {
  if (!valorOriginal) return;
  const normalizado = window.normalizarMaterial(valorOriginal);
  if (catalogoMaterialesControlProduccion().includes(normalizado)) {
    select.value = normalizado;
    return;
  }
  const opcionNoReconocida = document.createElement('option');
  opcionNoReconocida.value = '';
  opcionNoReconocida.textContent = `⚠️ valor original no reconocido: "${valorOriginal}" — elige uno`;
  select.insertBefore(opcionNoReconocida, select.firstChild);
  select.value = '';
}

function crearFilaInput(prefijo) {
  const fila = document.createElement('div');
  fila.className = 'cp-fila-input';
  const material = document.createElement('select');
  material.className = 'cp-fila-material';
  material.innerHTML = opcionesMaterialesControlProduccionHtml();
  const kg = document.createElement('input');
  kg.type = 'number';
  kg.step = '0.01';
  kg.placeholder = 'Kg';
  kg.className = 'cp-fila-kg';
  const origen = document.createElement('input');
  origen.type = 'text';
  origen.placeholder = 'Ticket Origen';
  origen.className = 'cp-fila-origen';
  origen.setAttribute('list', 'dl-cp-tickets-origen');
  const botonQuitar = document.createElement('button');
  botonQuitar.type = 'button';
  botonQuitar.textContent = '−';
  botonQuitar.className = 'btn-secondary cp-fila-quitar';
  botonQuitar.addEventListener('click', () => {
    const lista = document.getElementById(`${prefijo}-inputs-lista`);
    if (lista.children.length > 1) {
      fila.remove();
      actualizarResumen(prefijo);
    }
  });
  material.addEventListener('change', () => actualizarResumen(prefijo));
  [kg, origen].forEach((campo) => campo.addEventListener('input', () => actualizarResumen(prefijo)));
  fila.appendChild(material);
  fila.appendChild(kg);
  fila.appendChild(origen);
  fila.appendChild(botonQuitar);
  return fila;
}

function leerInputsFormulario(prefijo) {
  const filas = document.querySelectorAll(`#${prefijo}-inputs-lista .cp-fila-input`);
  return Array.from(filas).map((fila) => ({
    material: fila.querySelector('.cp-fila-material').value.trim().toUpperCase(),
    kg: fila.querySelector('.cp-fila-kg').value,
    ticketOrigen: fila.querySelector('.cp-fila-origen').value.trim()
  }));
}

function crearFilaOutput(prefijo) {
  const fila = document.createElement('div');
  fila.className = 'cp-fila-output';
  const material = document.createElement('select');
  material.className = 'cp-fila-output-material';
  material.innerHTML = opcionesMaterialesControlProduccionHtml();
  const kg = document.createElement('input');
  kg.type = 'number';
  kg.step = '0.01';
  kg.placeholder = 'Kg';
  kg.className = 'cp-fila-output-kg';
  const labelMerma = document.createElement('label');
  labelMerma.className = 'cp-fila-output-merma-label';
  const merma = document.createElement('input');
  merma.type = 'checkbox';
  merma.className = 'cp-fila-output-merma';
  labelMerma.appendChild(merma);
  labelMerma.appendChild(document.createTextNode('Merma'));
  const botonQuitar = document.createElement('button');
  botonQuitar.type = 'button';
  botonQuitar.textContent = '−';
  botonQuitar.className = 'btn-secondary cp-fila-quitar';
  botonQuitar.addEventListener('click', () => {
    const lista = document.getElementById(`${prefijo}-outputs-lista`);
    if (lista.children.length > 1) {
      fila.remove();
      actualizarResumen(prefijo);
    }
  });
  material.addEventListener('change', () => actualizarResumen(prefijo));
  kg.addEventListener('input', () => actualizarResumen(prefijo));
  merma.addEventListener('change', () => actualizarResumen(prefijo));
  fila.appendChild(material);
  fila.appendChild(kg);
  fila.appendChild(labelMerma);
  fila.appendChild(botonQuitar);
  return fila;
}

function leerOutputsFormulario(prefijo) {
  const filas = document.querySelectorAll(`#${prefijo}-outputs-lista .cp-fila-output`);
  return Array.from(filas).map((fila) => ({
    material: fila.querySelector('.cp-fila-output-material').value.trim().toUpperCase(),
    kg: fila.querySelector('.cp-fila-output-kg').value,
    esMerma: fila.querySelector('.cp-fila-output-merma').checked
  }));
}

function tipoProcesoParaPrefijo(prefijo) {
  return prefijo === 'cpe' ? tipoProcesoSeleccionadoEdicion : tipoProcesoSeleccionado;
}

function actualizarResumen(prefijo) {
  const inputs = leerInputsFormulario(prefijo);
  const totalInput = inputs.reduce((suma, i) => suma + (Number(i.kg) || 0), 0);
  const outputs = leerOutputsFormulario(prefijo);
  const kgMerma = outputs.filter((o) => o.esMerma).reduce((suma, o) => suma + (Number(o.kg) || 0), 0);
  const porcentajeMerma = calcularPorcentajeMerma(kgMerma, totalInput);
  const fechaInicio = document.getElementById(`${prefijo}-fecha-inicio`).value;
  const fechaFin = document.getElementById(`${prefijo}-fecha-fin`).value;
  let horasTrabajo = 0;
  if (fechaInicio && fechaFin) {
    const horas = calcularHorasTrabajo(fechaInicio, fechaFin);
    horasTrabajo = Number.isFinite(horas) && horas > 0 ? horas : 0;
  }

  const esPZ = PROCESOS_PZ.includes(tipoProcesoParaPrefijo(prefijo));
  let totalOutputTexto, eficiencia, productividadTexto;
  if (esPZ) {
    const outputPrincipalPZ = outputs.find((o) => !o.esMerma && window.MATERIALES_PZ.includes(o.material)) || null;
    const piezas = outputPrincipalPZ ? Number(outputPrincipalPZ.kg) || 0 : 0;
    totalOutputTexto = formatearOutputsDesglose(outputs);
    const segundosPorPieza = outputPrincipalPZ
      ? Number((window.EVE.segundosPorPiezaPZ || {})[outputPrincipalPZ.material])
      : NaN;
    eficiencia = outputPrincipalPZ ? calcularEficienciaPZ(piezas, horasTrabajo, segundosPorPieza) : null;
    productividadTexto = outputPrincipalPZ && horasTrabajo > 0 ? `${(piezas / horasTrabajo).toFixed(2)} piezas/h` : '—';
  } else {
    const kgPrincipal = outputs.filter((o) => !o.esMerma).reduce((suma, o) => suma + (Number(o.kg) || 0), 0);
    totalOutputTexto = `${(kgPrincipal + kgMerma).toLocaleString('es-MX')} kg`;
    eficiencia = calcularEficiencia(kgPrincipal, totalInput);
    productividadTexto = `${calcularProductividad(kgPrincipal, horasTrabajo).toFixed(2)} kg/h`;
  }
  const color = eficiencia === null ? null : colorEficiencia(eficiencia);
  const resumen = document.getElementById(`${prefijo}-resumen`);
  resumen.innerHTML = '';
  const agregarLinea = (texto, claseColor) => {
    const span = document.createElement('span');
    span.textContent = texto;
    if (claseColor) span.className = `cp-eficiencia-${claseColor}`;
    resumen.appendChild(span);
  };
  agregarLinea(`Total Input: ${totalInput.toLocaleString('es-MX')} kg`);
  agregarLinea(`Total Output: ${totalOutputTexto}`);
  agregarLinea(`Eficiencia: ${formatearEficiencia(eficiencia)}`, color);
  agregarLinea(`% Merma: ${porcentajeMerma.toFixed(2)}%`);
  agregarLinea(`Horas Trabajo: ${horasTrabajo.toFixed(2)} h`);
  agregarLinea(`Productividad: ${productividadTexto}`);
}

// Verifica, input por input, que exista saldo suficiente del material considerando
// solo eventos con fecha <= a fechaFin del proceso (mismo criterio de corte que usa
// construirEventos para este tipo de registro). No bloquea: si falta saldo, pide
// confirmación explícita al usuario.
function verificarStockSuficienteProceso(registro, excluirRegistroId) {
  const datosLedger = {
    inventarioInicial: window.EVE.inventarioInicial,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    ventas: window.EVE.ventas
  };
  const saldosRestantes = new Map();
  for (const input of registro.inputs) {
    if (!saldosRestantes.has(input.material)) {
      const saldo = window.EVE_INVENTARIO.calcularSaldoDisponibleEnFecha(
        datosLedger, input.material, registro.fechaFin, { controlProduccionId: excluirRegistroId }
      );
      saldosRestantes.set(input.material, saldo);
    }
    const saldoDisponible = saldosRestantes.get(input.material);
    if (saldoDisponible + 1e-6 < input.kg) {
      const continuar = window.confirm(
        `"${input.material}" no tiene stock suficiente registrado antes del ${window.formatearFecha(registro.fechaFin.slice(0, 10))} ` +
        `(disponible: ${saldoDisponible} Kg, requerido: ${input.kg} Kg). ` +
        '¿Continuar de todas formas?'
      );
      if (!continuar) return false;
    }
    saldosRestantes.set(input.material, saldoDisponible - input.kg);
  }
  return true;
}

function valoresUnicosLocal(valores, semillas) {
  const set = new Set(semillas || []);
  valores.forEach((valor) => { if (valor) set.add(String(valor).toUpperCase()); });
  return Array.from(set).sort();
}

function llenarDatalist(id, valores) {
  const datalist = document.getElementById(id);
  datalist.innerHTML = '';
  valores.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    datalist.appendChild(opcion);
  });
}

function actualizarDatalists() {
  const operadores = valoresUnicosLocal(window.EVE.registrosControlProduccion.map((r) => r.operador), []);
  const ticketsOrigen = [
    ...window.EVE.registrosDestaraje.map((r) => r.ticket),
    ...window.EVE.registrosControlProduccion.map((r) => r.ticket)
  ];
  llenarDatalist('dl-cp-operadores', operadores);
  llenarDatalist('dl-cp-tickets-origen', ticketsOrigen.sort());
}

function insertarRegistroEnMemoria(registro) {
  window.EVE.registrosControlProduccion.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos) {
  const lista = window.EVE.registrosControlProduccion;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista[indice] = { ...lista[indice], ...datos };
  }
}

function eliminarRegistroEnMemoria(id) {
  const lista = window.EVE.registrosControlProduccion;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista.splice(indice, 1);
  }
}

function seleccionarProceso(tipo) {
  tipoProcesoSeleccionado = tipo;
  document.querySelectorAll('.cp-proceso-boton').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.tipo === tipo);
  });
}

function reiniciarFormulario() {
  document.getElementById('control-produccion-form').reset();
  tipoProcesoSeleccionado = null;
  document.querySelectorAll('.cp-proceso-boton').forEach((boton) => boton.classList.remove('active'));
  const listaInputs = document.getElementById('cp-inputs-lista');
  listaInputs.innerHTML = '';
  listaInputs.appendChild(crearFilaInput('cp'));
  const listaOutputs = document.getElementById('cp-outputs-lista');
  listaOutputs.innerHTML = '';
  listaOutputs.appendChild(crearFilaOutput('cp'));
  actualizarResumen('cp');
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    tipoProceso: tipoProcesoSeleccionado,
    inputs: leerInputsFormulario('cp'),
    outputs: leerOutputsFormulario('cp'),
    operador: document.getElementById('cp-operador').value.trim().toUpperCase(),
    turno: document.getElementById('cp-turno').value,
    fechaInicio: document.getElementById('cp-fecha-inicio').value,
    fechaFin: document.getElementById('cp-fecha-fin').value,
    observaciones: document.getElementById('cp-observaciones').value.trim()
  };
  try {
    const registroSinTicket = construirRegistroDesdeFormulario(datos);
    if (!verificarStockSuficienteProceso(registroSinTicket)) return;
    const ticket = generarSiguienteTicket(window.EVE.registrosControlProduccion);
    const registro = { ticket, ...registroSinTicket };
    const id = await window.guardarDato('control_produccion', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    reiniciarFormulario();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess(`Registro ${ticket} guardado`);
  } catch (error) {
    window.showError(error.message);
  }
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'control-produccion-form';
  form.className = 'card cp-form';
  const botonesProceso = Object.keys(PROCESOS)
    .map((clave) => `<button type="button" class="cp-proceso-boton" data-tipo="${clave}">${PROCESOS[clave].icono} ${PROCESOS[clave].nombre}</button>`)
    .join('');
  form.innerHTML = `
    <div class="cp-procesos">${botonesProceso}</div>
    <div id="cp-inputs-lista" class="cp-inputs-lista"></div>
    <button type="button" id="cp-agregar-material" class="btn-secondary">+ Agregar Material</button>
    <div id="cp-outputs-lista" class="cp-inputs-lista"></div>
    <button type="button" id="cp-agregar-output" class="btn-secondary">+ Agregar Output</button>
    <div class="form-grid">
      <input type="text" id="cp-operador" placeholder="Operador" list="dl-cp-operadores" required>
      <select id="cp-turno" required>
        <option value="">Turno</option>
        <option value="Matutino">Matutino</option>
        <option value="Vespertino">Vespertino</option>
        <option value="Nocturno">Nocturno</option>
      </select>
      <input type="datetime-local" id="cp-fecha-inicio" required>
      <input type="datetime-local" id="cp-fecha-fin" required>
    </div>
    <textarea id="cp-observaciones" placeholder="Observaciones (opcional)"></textarea>
    <datalist id="dl-cp-operadores"></datalist>
    <datalist id="dl-cp-tickets-origen"></datalist>
    <div id="cp-resumen" class="card cp-resumen"></div>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelectorAll('.cp-proceso-boton').forEach((boton) => {
    boton.addEventListener('click', () => seleccionarProceso(boton.dataset.tipo));
  });
  form.querySelector('#cp-inputs-lista').appendChild(crearFilaInput('cp'));
  form.querySelector('#cp-agregar-material').addEventListener('click', () => {
    form.querySelector('#cp-inputs-lista').appendChild(crearFilaInput('cp'));
  });
  form.querySelector('#cp-outputs-lista').appendChild(crearFilaOutput('cp'));
  form.querySelector('#cp-agregar-output').addEventListener('click', () => {
    form.querySelector('#cp-outputs-lista').appendChild(crearFilaOutput('cp'));
    actualizarResumen('cp');
  });
  ['cp-fecha-inicio', 'cp-fecha-fin'].forEach((id) => {
    form.querySelector(`#${id}`).addEventListener('input', () => actualizarResumen('cp'));
  });
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}

function seleccionarProcesoEdicion(tipo) {
  tipoProcesoSeleccionadoEdicion = tipo;
  document.querySelectorAll('.cpe-proceso-boton').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.tipo === tipo);
  });
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    tipoProceso: tipoProcesoSeleccionadoEdicion,
    inputs: leerInputsFormulario('cpe'),
    outputs: leerOutputsFormulario('cpe'),
    operador: document.getElementById('cpe-operador').value.trim().toUpperCase(),
    turno: document.getElementById('cpe-turno').value,
    fechaInicio: document.getElementById('cpe-fecha-inicio').value,
    fechaFin: document.getElementById('cpe-fecha-fin').value,
    observaciones: document.getElementById('cpe-observaciones').value.trim()
  };
  const anterior = window.EVE.registrosControlProduccion.find((r) => r.id === editandoId);
  const motivo = document.getElementById('cpe-motivo').value.trim();
  try {
    const registroSinTicket = construirRegistroDesdeFormulario(datos);
    if (!verificarStockSuficienteProceso(registroSinTicket, editandoId)) return;
    const registro = { ticket: editandoTicket, ...registroSinTicket };
    await window.actualizarDato('control_produccion', editandoId, registro);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'control_produccion',
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior ? { ticket: anterior.ticket, tipoProceso: anterior.tipoProceso, outputs: anterior.outputs, operador: anterior.operador, turno: anterior.turno, fechaInicio: anterior.fechaInicio, fechaFin: anterior.fechaFin } : null,
      valorNuevo: { ticket: registro.ticket, tipoProceso: registro.tipoProceso, outputs: registro.outputs, operador: registro.operador, turno: registro.turno, fechaInicio: registro.fechaInicio, fechaFin: registro.fechaFin },
      motivo
    });
    document.getElementById('cpe-motivo').value = '';
    reemplazarRegistroEnMemoria(editandoId, registro);
    cerrarModalEdicion();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'control-produccion-modal-overlay';
  overlay.className = 'modal-overlay';
  const botonesProceso = Object.keys(PROCESOS)
    .map((clave) => `<button type="button" class="cpe-proceso-boton" data-tipo="${clave}">${PROCESOS[clave].icono} ${PROCESOS[clave].nombre}</button>`)
    .join('');
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar registro</h3>
      <form id="control-produccion-edit-form">
        <div class="cp-procesos">${botonesProceso}</div>
        <div id="cpe-inputs-lista" class="cp-inputs-lista"></div>
        <button type="button" id="cpe-agregar-material" class="btn-secondary">+ Agregar Material</button>
        <div id="cpe-outputs-lista" class="cp-inputs-lista"></div>
        <button type="button" id="cpe-agregar-output" class="btn-secondary">+ Agregar Output</button>
        <input type="text" id="cpe-operador" placeholder="Operador" required>
        <select id="cpe-turno" required>
          <option value="">Turno</option>
          <option value="Matutino">Matutino</option>
          <option value="Vespertino">Vespertino</option>
          <option value="Nocturno">Nocturno</option>
        </select>
        <input type="datetime-local" id="cpe-fecha-inicio" required>
        <input type="datetime-local" id="cpe-fecha-fin" required>
        <textarea id="cpe-observaciones" placeholder="Observaciones (opcional)"></textarea>
        <div id="cpe-resumen" class="card cp-resumen"></div>
        <textarea id="cpe-motivo" placeholder="Motivo del cambio (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="cpe-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelectorAll('.cpe-proceso-boton').forEach((boton) => {
    boton.addEventListener('click', () => seleccionarProcesoEdicion(boton.dataset.tipo));
  });
  overlay.querySelector('#cpe-agregar-material').addEventListener('click', () => {
    overlay.querySelector('#cpe-inputs-lista').appendChild(crearFilaInput('cpe'));
  });
  overlay.querySelector('#cpe-agregar-output').addEventListener('click', () => {
    overlay.querySelector('#cpe-outputs-lista').appendChild(crearFilaOutput('cpe'));
    actualizarResumen('cpe');
  });
  ['cpe-fecha-inicio', 'cpe-fecha-fin'].forEach((id) => {
    overlay.querySelector(`#${id}`).addEventListener('input', () => actualizarResumen('cpe'));
  });
  overlay.querySelector('#control-produccion-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#cpe-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  editandoTicket = registro.ticket;
  seleccionarProcesoEdicion(registro.tipoProceso);
  const lista = document.getElementById('cpe-inputs-lista');
  lista.innerHTML = '';
  registro.inputs.forEach((input) => {
    const fila = crearFilaInput('cpe');
    establecerValorMaterialSelect(fila.querySelector('.cp-fila-material'), input.material);
    fila.querySelector('.cp-fila-kg').value = input.kg;
    fila.querySelector('.cp-fila-origen').value = input.ticketOrigen || '';
    lista.appendChild(fila);
  });
  const listaOutputs = document.getElementById('cpe-outputs-lista');
  listaOutputs.innerHTML = '';
  registro.outputs.forEach((output) => {
    const fila = crearFilaOutput('cpe');
    establecerValorMaterialSelect(fila.querySelector('.cp-fila-output-material'), output.material);
    fila.querySelector('.cp-fila-output-kg').value = output.kg;
    fila.querySelector('.cp-fila-output-merma').checked = !!output.esMerma;
    listaOutputs.appendChild(fila);
  });
  document.getElementById('cpe-operador').value = registro.operador;
  document.getElementById('cpe-turno').value = registro.turno;
  document.getElementById('cpe-fecha-inicio').value = registro.fechaInicio;
  document.getElementById('cpe-fecha-fin').value = registro.fechaFin;
  document.getElementById('cpe-observaciones').value = registro.observaciones || '';
  actualizarResumen('cpe');
  document.getElementById('control-produccion-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('control-produccion-modal-overlay').classList.remove('open');
  editandoId = null;
  editandoTicket = null;
}

async function confirmarEliminar(id) {
  const registro = window.EVE.registrosControlProduccion.find((r) => r.id === id);
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato('control_produccion', id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'control_produccion',
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: registro ? { ticket: registro.ticket, tipoProceso: registro.tipoProceso, outputs: registro.outputs, operador: registro.operador, turno: registro.turno, fechaInicio: registro.fechaInicio, fechaFin: registro.fechaFin } : null,
      valorNuevo: null,
      motivo
    });
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

function abrirTrazabilidad(criterio, valor, origen) {
  tabActiva = 'trazabilidad';
  document.querySelectorAll('#cp-tabs-internas .tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === 'trazabilidad');
  });
  renderizarVista();
  window.EVE_TRAZABILIDAD.buscarPorCriterio(criterio, valor, origen);
}

Object.assign(window.EVE_CONTROL_PRODUCCION, {
  crearFormulario,
  crearModalEdicion,
  abrirModalEdicion,
  actualizarDatalists,
  confirmarEliminar,
  abrirTrazabilidad
});

let tabActiva = 'hoy';
let filtros = { tipoProceso: '', operador: '', turno: '', desde: '', hasta: '' };

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.id = 'cp-tabs-internas';
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' },
    { id: 'trazabilidad', nombre: 'Trazabilidad' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
    boton.addEventListener('click', () => {
      tabActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      // Click manual en una subtab (no via abrirTrazabilidad): ya no venimos de
      // Historial por Material, así que el botón "Regresar" no debe mostrarse.
      if (window.EVE_TRAZABILIDAD) window.EVE_TRAZABILIDAD.limpiarOrigenHistorialMaterial();
      renderizarVista();
    });
    nav.appendChild(boton);
  });
  return nav;
}

function actualizarFiltrosDesdeUI() {
  filtros = {
    tipoProceso: document.getElementById('cpf-proceso').value,
    turno: document.getElementById('cpf-turno').value,
    operador: document.getElementById('cpf-operador').value,
    desde: document.getElementById('cpf-desde').value,
    hasta: document.getElementById('cpf-hasta').value
  };
  renderizarVista();
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'control-produccion-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';

  const procesoSelect = document.createElement('select');
  procesoSelect.id = 'cpf-proceso';
  const opcionTodos = document.createElement('option');
  opcionTodos.value = '';
  opcionTodos.textContent = 'Todos los procesos';
  procesoSelect.appendChild(opcionTodos);
  Object.keys(PROCESOS).forEach((clave) => {
    const opcion = document.createElement('option');
    opcion.value = clave;
    opcion.textContent = PROCESOS[clave].nombre;
    procesoSelect.appendChild(opcion);
  });

  const turnoSelect = document.createElement('select');
  turnoSelect.id = 'cpf-turno';
  [['', 'Todos los turnos'], ['Matutino', 'Matutino'], ['Vespertino', 'Vespertino'], ['Nocturno', 'Nocturno']]
    .forEach(([valor, texto]) => {
      const opcion = document.createElement('option');
      opcion.value = valor;
      opcion.textContent = texto;
      turnoSelect.appendChild(opcion);
    });

  const operadorInput = document.createElement('input');
  operadorInput.type = 'text';
  operadorInput.id = 'cpf-operador';
  operadorInput.placeholder = 'Operador';

  const desdeInput = document.createElement('input');
  desdeInput.type = 'date';
  desdeInput.id = 'cpf-desde';

  const hastaInput = document.createElement('input');
  hastaInput.type = 'date';
  hastaInput.id = 'cpf-hasta';

  const campos = [
    { campo: procesoSelect, etiqueta: 'Proceso' },
    { campo: turnoSelect, etiqueta: 'Turno' },
    { campo: operadorInput, etiqueta: 'Operador' },
    { campo: desdeInput, etiqueta: 'Desde' },
    { campo: hastaInput, etiqueta: 'Hasta' }
  ];
  campos.forEach(({ campo, etiqueta }) => {
    const contenedor = document.createElement('label');
    contenedor.className = 'filtro-campo';
    const span = document.createElement('span');
    span.textContent = etiqueta;
    contenedor.appendChild(span);
    contenedor.appendChild(campo);
    campo.addEventListener('input', actualizarFiltrosDesdeUI);
    div.appendChild(contenedor);
  });
  return div;
}

function crearTabla() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="ticket">Ticket</th><th data-tipo="texto">Proceso</th><th data-tipo="texto">Operador</th><th data-tipo="texto">Turno</th><th data-tipo="numero">Total Input</th><th data-tipo="numero">Total Output</th><th data-tipo="numero">Eficiencia</th><th data-tipo="fecha">F. Inicio</th><th data-tipo="fecha">F. Fin</th><th></th></tr>
    </thead>
    <tbody id="control-produccion-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  window.activarOrdenamiento(tabla);
  return wrapper;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const esPZ = PROCESOS_PZ.includes(registro.tipoProceso);
  const valores = [
    registro.ticket,
    `${PROCESOS[registro.tipoProceso].icono} ${PROCESOS[registro.tipoProceso].nombre}`,
    registro.operador,
    registro.turno,
    `${registro.totalInput.toLocaleString('es-MX')} kg`,
    esPZ ? formatearOutputsDesglose(registro.outputs) : `${registro.totalOutput.toLocaleString('es-MX')} kg`,
    formatearEficiencia(registro.eficiencia),
    registro.fechaInicio,
    registro.fechaFin
  ];
  valores.forEach((valor, indice) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    if (indice === 6 && registro.eficiencia !== null) celda.classList.add(`cp-eficiencia-${colorEficiencia(registro.eficiencia)}`);
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
  if (window.puedeEscribir('control_produccion')) {
    const botonEditar = document.createElement('button');
    botonEditar.textContent = 'Editar';
    botonEditar.className = 'btn-secondary';
    botonEditar.addEventListener('click', () => abrirModalEdicion(registro));
    const botonEliminar = document.createElement('button');
    botonEliminar.textContent = 'Eliminar';
    botonEliminar.className = 'btn-secondary';
    botonEliminar.addEventListener('click', () => confirmarEliminar(registro.id));
    celdaAcciones.appendChild(botonEditar);
    celdaAcciones.appendChild(botonEliminar);
  }
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(registros) {
  const tbody = document.getElementById('control-produccion-tabla');
  tbody.innerHTML = '';
  if (registros.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 10;
    celda.textContent = 'Sin registros';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  registros.forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let registros = window.EVE.registrosControlProduccion;
  if (tabActiva === 'hoy') {
    registros = filtrarPorHoy(registros, window.obtenerFechaMexico());
  } else if (tabActiva === 'semana') {
    registros = filtrarPorSemana(registros, window.obtenerInicioSemana());
  } else if (tabActiva === 'mes') {
    registros = filtrarPorMes(registros, window.obtenerInicioMes());
  } else if (tabActiva === 'todos') {
    registros = aplicarFiltrosTodos(registros, filtros);
  }
  return registros;
}

function renderizarStats(registros) {
  const stats = calcularStats(registros);
  const contenedor = document.getElementById('control-produccion-stats');
  contenedor.innerHTML = '';
  const partes = [
    `Registros: ${stats.totalRegistros}`,
    `Total Input: ${stats.totalInput.toLocaleString('es-MX')} kg`,
    `Total Output: ${stats.totalOutput.toLocaleString('es-MX')} kg`,
    `Eficiencia Promedio: ${formatearEficiencia(stats.eficienciaPromedio)}`
  ];
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function renderizarVista() {
  const esTrazabilidad = tabActiva === 'trazabilidad';
  document.getElementById('cp-vista-operativa').style.display = esTrazabilidad ? 'none' : '';
  document.getElementById('cp-vista-trazabilidad').style.display = esTrazabilidad ? '' : 'none';
  if (esTrazabilidad) return;
  document.getElementById('control-produccion-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const registros = obtenerRegistrosParaTab();
  renderizarStats(registros);
  llenarTabla(registros);
}

function construirFilasCSVControlProduccionHistorico(registros) {
  const filas = [];
  registros.forEach((r) => {
    const inputs = r.inputs && r.inputs.length ? r.inputs : [{ material: '', kg: '', ticketOrigen: '' }];
    const outputs = r.outputs && r.outputs.length ? r.outputs : [{ material: '', kg: '', esMerma: false }];
    inputs.forEach((input) => {
      outputs.forEach((output) => {
        filas.push({
          'Fecha': r.fechaInicio,
          'Tipo Proceso': r.tipoProceso,
          'Ticket Origen (input)': input.ticketOrigen || '',
          'Material Input': input.material,
          'Kg Input': input.kg,
          'Material Output': output.material,
          'Kg Output': output.kg,
          'Es Merma': output.esMerma ? 'Sí' : 'No'
        });
      });
    });
  });
  return filas;
}

function exportarControlProduccionCSV() {
  const filas = construirFilasCSVControlProduccionHistorico(window.EVE.registrosControlProduccion || []);
  window.exportarCSV(filas, `control_produccion_historico_${window.obtenerFechaMexico()}.csv`);
}

function crearBarraExportarControlProduccion() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btnExportarCSV = document.createElement('button');
  btnExportarCSV.textContent = 'Exportar CSV';
  btnExportarCSV.className = 'btn-secondary';
  btnExportarCSV.addEventListener('click', () => exportarControlProduccionCSV());
  div.appendChild(btnExportarCSV);
  return div;
}

function renderControlProduccion(container) {
  tabActiva = 'hoy';
  filtros = { tipoProceso: '', operador: '', turno: '', desde: '', hasta: '' };
  editandoId = null;
  editandoTicket = null;
  tipoProcesoSeleccionado = null;
  tipoProcesoSeleccionadoEdicion = null;

  container.appendChild(crearTabsInternas());

  const vistaOperativa = document.createElement('div');
  vistaOperativa.id = 'cp-vista-operativa';
  vistaOperativa.appendChild(crearBarraExportarControlProduccion());
  if (window.puedeEscribir('control_produccion')) {
    vistaOperativa.appendChild(crearFormulario());
  }
  vistaOperativa.appendChild(crearBarraFiltros());
  const stats = document.createElement('div');
  stats.id = 'control-produccion-stats';
  stats.className = 'card destaraje-stats';
  vistaOperativa.appendChild(stats);
  vistaOperativa.appendChild(crearTabla());
  vistaOperativa.appendChild(crearModalEdicion());
  container.appendChild(vistaOperativa);

  const vistaTrazabilidad = document.createElement('div');
  vistaTrazabilidad.id = 'cp-vista-trazabilidad';
  vistaTrazabilidad.style.display = 'none';
  vistaTrazabilidad.appendChild(window.EVE_TRAZABILIDAD.crearVistaTrazabilidad());
  container.appendChild(vistaTrazabilidad);

  actualizarDatalists();
  renderizarVista();
}

window.EVE_MODULES.controlProduccion = { render: renderControlProduccion };

})();
