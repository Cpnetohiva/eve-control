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
// así que no tienen Eficiencia por ticket (kg-output / kg-input solo aplica a procesos de kg):
// su eficiencia es null y se mostrará como 'Sin meta configurada'.
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

function calcularEficiencia(kgPrincipal, totalInput) {
  if (totalInput <= 0) return 0;
  return (kgPrincipal / totalInput) * 100;
}

function calcularPorcentajeMerma(kgMerma, totalInput) {
  if (totalInput <= 0) return 0;
  return (kgMerma / totalInput) * 100;
}

function formatearEficiencia(eficiencia) {
  return eficiencia === null || eficiencia === undefined ? 'Sin meta configurada' : `${eficiencia.toFixed(2)}%`;
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
  return registros.filter((r) => window.fechaProceso(r) === hoy);
}

// Semana y mes se acotan por ambos lados: un registro con fecha futura no debe contar en el periodo en curso.
function filtrarPorSemana(registros, inicioSemana) {
  const finSemana = new Date(`${inicioSemana}T00:00:00Z`);
  finSemana.setUTCDate(finSemana.getUTCDate() + 6);
  const fin = finSemana.toISOString().slice(0, 10);
  return registros.filter((r) => dentroDeRangoFecha(window.fechaProceso(r), inicioSemana, fin));
}

function filtrarPorMes(registros, inicioMes) {
  const [anio, mes] = inicioMes.split('-').map(Number);
  const fin = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
  return registros.filter((r) => dentroDeRangoFecha(window.fechaProceso(r), inicioMes, fin));
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
    if (!dentroDeRangoFecha(window.fechaProceso(r), filtros.desde, filtros.hasta)) return false;
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
    // Los tickets PZ tienen eficiencia:null — se excluyen del promedio
    // (ni suman ni cuentan) en vez de tratarse como 0%, para no sesgar el promedio a la baja.
    if (registro.eficiencia !== null && registro.eficiencia !== undefined) {
      sumaEficiencia += Number(registro.eficiencia);
      conteoEficiencia += 1;
    }
  }
  const eficienciaPromedio = conteoEficiencia > 0 ? sumaEficiencia / conteoEficiencia : null;
  return { totalRegistros: registros.length, totalInput, totalOutput, totalMerma, eficienciaPromedio };
}

// Cumplimiento de la meta diaria de piezas por producto. Suma, por (día, producto PZ), los outputs
// no merma de TODOS los registros y turnos del día. Un output en kg que no es pieza (p. ej. un
// rechazo) no pertenece a MATERIALES_PZ, así que no suma. cumplimiento = null si el producto no
// tiene meta (vacía o <= 0), nunca 0.
function calcularCumplimientoDiarioPZ(registros, metaPiezasDia) {
  const metas = metaPiezasDia || {};
  const mapa = new Map();
  (registros || []).forEach((r) => {
    const fecha = window.fechaProceso(r);
    (r.outputs || []).forEach((o) => {
      const producto = window.normalizarMaterial(o.material);
      if (o.esMerma || !window.MATERIALES_PZ.includes(producto)) return;
      const clave = `${fecha}|${producto}`;
      if (!mapa.has(clave)) mapa.set(clave, { fecha, producto, piezas: 0 });
      mapa.get(clave).piezas += Number(o.kg) || 0;
    });
  });
  return Array.from(mapa.values())
    .map(({ fecha, producto, piezas }) => {
      const valorMeta = Number(metas[producto]);
      const meta = Number.isFinite(valorMeta) && valorMeta > 0 ? valorMeta : null;
      return { fecha, producto, piezas, meta, cumplimiento: meta === null ? null : (piezas / meta) * 100 };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.producto.localeCompare(b.producto));
}

// 'Piezas de <fecha> <producto>: X de Y (Z%)' o 'Sin meta configurada'; sin la fecha si se omite.
function formatearCumplimientoPZ(item, conFecha) {
  const prefijo = conFecha ? `${window.formatearFecha(item.fecha)} ` : '';
  const piezas = item.piezas.toLocaleString('es-MX');
  if (item.cumplimiento === null) return `${prefijo}${item.producto}: ${piezas} pz — ${formatearEficiencia(null)}`;
  return `${prefijo}${item.producto}: ${piezas} de ${item.meta.toLocaleString('es-MX')} pz (${item.cumplimiento.toFixed(1)}%)`;
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
  const nombreProceso = PROCESOS[datos.tipoProceso].nombre;
  const mermasPermitidas = window.tiposMermaParaProceso(datos.tipoProceso);
  const todasLasMermas = window.nombresTiposMerma();
  outputs.forEach((o) => {
    if (!o.esMerma && todasLasMermas.includes(o.material)) {
      throw new Error(`"${o.material}" es un tipo de merma: márcalo como Merma en vez de capturarlo como material`);
    }
    if (o.esMerma && !mermasPermitidas.includes(o.material)) {
      throw new Error(mermasPermitidas.length > 0
        ? `"${o.material}" no es una merma válida para ${nombreProceso} (tipos permitidos: ${mermasPermitidas.join(', ')})`
        : `${nombreProceso} no tiene merma: el desperdicio recuperable se captura como material de rechazo, no como merma`);
    }
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
  if (!datos.operador || !datos.turno || !datos.fecha) {
    throw new Error('Operador, turno y fecha son obligatorios');
  }
  const totalInput = inputs.reduce((suma, input) => suma + input.kg, 0);
  const kgMerma = outputs.filter((o) => o.esMerma).reduce((suma, o) => suma + o.kg, 0);
  const porcentajeMerma = calcularPorcentajeMerma(kgMerma, totalInput);
  let totalOutput, eficiencia;
  if (esPZ) {
    // totalOutput para procesos de pieza NUNCA incluye el conteo de piezas — solo la
    // porción en kg (merma + outputs kg no-merma como pellet reutilizable). El conteo de
    // piezas se reporta aparte (desglose por output), nunca sumado a un total en "kg".
    const kgSalidaNoMerma = outputs
      .filter((o) => !o.esMerma && !window.MATERIALES_PZ.includes(o.material))
      .reduce((suma, o) => suma + o.kg, 0);
    totalOutput = kgSalidaNoMerma + kgMerma;
    // Sin horas no se puede medir velocidad: la eficiencia de piezas queda en null.
    eficiencia = null;
  } else {
    const kgPrincipal = outputs.filter((o) => !o.esMerma).reduce((suma, o) => suma + o.kg, 0);
    totalOutput = kgPrincipal + kgMerma;
    eficiencia = calcularEficiencia(kgPrincipal, totalInput);
  }
  return {
    tipoProceso: datos.tipoProceso,
    inputs,
    outputs,
    operador: datos.operador,
    turno: datos.turno,
    fecha: datos.fecha,
    totalInput,
    totalOutput,
    eficiencia,
    porcentajeMerma,
    observaciones: datos.observaciones || ''
  };
}

window.EVE_CONTROL_PRODUCCION = {
  PROCESOS,
  PROCESOS_PZ,
  generarSiguienteTicket,
  calcularEficiencia,
  formatearEficiencia,
  formatearOutputsDesglose,
  calcularPorcentajeMerma,
  colorEficiencia,
  filtrarPorHoy,
  filtrarPorSemana,
  filtrarPorMes,
  aplicarFiltrosTodos,
  calcularStats,
  calcularCumplimientoDiarioPZ,
  construirRegistroDesdeFormulario
};

let editandoId = null;
let editandoTicket = null;
let tipoProcesoSeleccionado = null;
let tipoProcesoSeleccionadoEdicion = null;

// Materiales que se pueden usar como input: todo lo que puede tener existencias; en SELECCION solo los
// crudos que requieren selección (los molidos, pellets, MATERIAL VIRGEN y piezas no se seleccionan).
function nombresInputParaProceso(tipoProceso) {
  return tipoProceso === 'SELECCION' ? window.materialesQueRequierenSeleccion() : window.materialesConStock();
}

// Materiales que se pueden capturar como output no merma: los que salen de proceso MÁS los materiales ya
// capturados como input del mismo ticket (cada composición incluye al propio material como componente, y al
// seleccionar puede salir el mismo material; p. ej. Empacado de PET CRISTAL tiene salida PET CRISTAL).
function nombresOutputNoMerma(prefijo) {
  const deInputs = leerInputsFormulario(prefijo).map((i) => i.material).filter(Boolean);
  return Array.from(new Set(window.materialesProducibles().concat(deInputs)));
}

// Reconstruye un select de material con la lista dada y conserva el valor actual solo si sigue siendo válido.
function llenarSelectMaterial(select, nombres, valorActual) {
  select.innerHTML = '<option value="">-- Selecciona material --</option>' +
    nombres.map((m) => `<option value="${m}">${m}</option>`).join('');
  select.value = nombres.includes(valorActual) ? valorActual : '';
}

// Al cambiar el proceso del ticket se refresca la lista de inputs de cada fila.
function refrescarInputsPorProceso(prefijo) {
  const nombres = nombresInputParaProceso(tipoProcesoParaPrefijo(prefijo));
  document.querySelectorAll(`#${prefijo}-inputs-lista .cp-fila-material`).forEach((select) => {
    llenarSelectMaterial(select, nombres, select.value);
  });
}

// Al cambiar los inputs se refresca la lista de outputs de cada fila (los valores que dejan de ser válidos se limpian).
function refrescarOutputsDelTicket(prefijo) {
  document.querySelectorAll(`#${prefijo}-outputs-lista .cp-fila-output`).forEach((fila) => sincronizarFilaOutput(prefijo, fila));
}

// Al reabrir un registro guardado antes de que este campo fuera un <select> cerrado,
// el valor guardado puede no existir en el catálogo actual. Si no hay match ni por alias,
// NUNCA se deja el <select> en su primera opción real (defaultearía silenciosamente a un
// material incorrecto) — se inserta una opción de advertencia explícita y sin seleccionar
// para forzar al usuario a elegir el valor correcto a mano.
function establecerValorMaterialSelect(select, valorOriginal) {
  if (!valorOriginal) return;
  const normalizado = window.normalizarMaterial(valorOriginal);
  if (Array.from(select.options).some((o) => o.value !== '' && o.value === normalizado)) {
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
  llenarSelectMaterial(material, nombresInputParaProceso(tipoProcesoParaPrefijo(prefijo)), '');
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
      refrescarOutputsDelTicket(prefijo);
      actualizarResumen(prefijo);
    }
  });
  material.addEventListener('change', () => {
    refrescarOutputsDelTicket(prefijo);
    actualizarResumen(prefijo);
  });
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

// Tipos de merma que admite el proceso del ticket en captura (vacío mientras no haya proceso).
function tiposMermaDelTicket(prefijo) {
  const proceso = tipoProcesoParaPrefijo(prefijo);
  return proceso ? window.tiposMermaParaProceso(proceso) : [];
}

// Lista del select de un output: con Merma marcada, los tipos de merma del proceso; si no, los materiales.
function nombresOutputParaFila(prefijo, esMerma) {
  return esMerma ? tiposMermaDelTicket(prefijo) : nombresOutputNoMerma(prefijo);
}

// Deja la fila coherente con el proceso y su casilla Merma: reconstruye la lista del select (conserva el
// valor si sigue siendo válido) y deshabilita Merma si el proceso no tiene tipos de merma. Una fila ya
// marcada como merma (registro histórico) conserva su casilla habilitada para poder desmarcarla.
function sincronizarFilaOutput(prefijo, fila) {
  const select = fila.querySelector('.cp-fila-output-material');
  const merma = fila.querySelector('.cp-fila-output-merma');
  const sinTipos = tiposMermaDelTicket(prefijo).length === 0;
  merma.disabled = sinTipos && !merma.checked;
  fila.querySelector('.cp-fila-output-merma-label').title = !merma.disabled ? ''
    : (tipoProcesoParaPrefijo(prefijo)
      ? 'Este proceso no tiene merma: el desperdicio recuperable se captura como material de rechazo'
      : 'Selecciona primero el proceso');
  llenarSelectMaterial(select, nombresOutputParaFila(prefijo, merma.checked), select.value);
}

// Al cambiar el proceso del ticket: las filas de merma se revalidan. Si el nuevo proceso no tiene merma
// se desmarcan; la merma que ya no corresponde queda sin valor y hay que elegir de nuevo.
function revalidarFilasOutput(prefijo) {
  document.querySelectorAll(`#${prefijo}-outputs-lista .cp-fila-output`).forEach((fila) => {
    const merma = fila.querySelector('.cp-fila-output-merma');
    if (merma.checked && tiposMermaDelTicket(prefijo).length === 0) merma.checked = false;
    sincronizarFilaOutput(prefijo, fila);
  });
}

function crearFilaOutput(prefijo) {
  const fila = document.createElement('div');
  fila.className = 'cp-fila-output';
  const material = document.createElement('select');
  material.className = 'cp-fila-output-material';
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
  merma.addEventListener('change', () => {
    sincronizarFilaOutput(prefijo, fila);
    actualizarResumen(prefijo);
  });
  fila.appendChild(material);
  fila.appendChild(kg);
  fila.appendChild(labelMerma);
  fila.appendChild(botonQuitar);
  sincronizarFilaOutput(prefijo, fila);
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
  const esPZ = PROCESOS_PZ.includes(tipoProcesoParaPrefijo(prefijo));
  let totalOutputTexto, eficiencia, lineaPiezasDia = null;
  if (esPZ) {
    totalOutputTexto = formatearOutputsDesglose(outputs);
    eficiencia = null;
    lineaPiezasDia = construirLineaPiezasDia(prefijo, outputs);
  } else {
    const kgPrincipal = outputs.filter((o) => !o.esMerma).reduce((suma, o) => suma + (Number(o.kg) || 0), 0);
    totalOutputTexto = `${(kgPrincipal + kgMerma).toLocaleString('es-MX')} kg`;
    eficiencia = calcularEficiencia(kgPrincipal, totalInput);
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
  if (esPZ) {
    if (lineaPiezasDia) agregarLinea(lineaPiezasDia.texto, lineaPiezasDia.color);
  } else {
    agregarLinea(`Eficiencia: ${formatearEficiencia(eficiencia)}`, color);
  }
  agregarLinea(`% Merma: ${porcentajeMerma.toFixed(2)}%`);
}

// Piezas del día del producto en captura, incluyendo el ticket que se está capturando (y, al editar,
// sin contar la versión guardada de ese mismo ticket). null si aún falta producto o fecha.
function construirLineaPiezasDia(prefijo, outputs) {
  const principal = outputs.find((o) => !o.esMerma && window.MATERIALES_PZ.includes(window.normalizarMaterial(o.material)));
  const fecha = document.getElementById(`${prefijo}-fecha`).value;
  if (!principal || !fecha) return null;
  const producto = window.normalizarMaterial(principal.material);
  const otros = window.EVE.registrosControlProduccion.filter((r) => !(prefijo === 'cpe' && r.id === editandoId));
  const enCaptura = { fecha, outputs: [{ material: producto, kg: Number(principal.kg) || 0, esMerma: false }] };
  const item = calcularCumplimientoDiarioPZ([...otros, enCaptura], window.EVE.metaPiezasDia)
    .find((i) => i.fecha === fecha && i.producto === producto);
  const avance = fecha === window.obtenerFechaMexico() ? ' — avance parcial' : '';
  const base = item.cumplimiento === null
    ? `Piezas del día de ${producto}: ${item.piezas.toLocaleString('es-MX')} — ${formatearEficiencia(null)}`
    : `Piezas del día de ${producto}: ${item.piezas.toLocaleString('es-MX')} de ${item.meta.toLocaleString('es-MX')} (${item.cumplimiento.toFixed(1)}%)`;
  return { texto: base + avance, color: item.cumplimiento === null ? null : colorEficiencia(item.cumplimiento) };
}

// Verifica, input por input, que exista saldo suficiente del material considerando
// solo eventos con fecha <= a la fecha del proceso (mismo criterio de corte que usa
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
        datosLedger, input.material, window.fechaProceso(registro), { controlProduccionId: excluirRegistroId }
      );
      saldosRestantes.set(input.material, saldo);
    }
    const saldoDisponible = saldosRestantes.get(input.material);
    if (saldoDisponible + 1e-6 < input.kg) {
      const continuar = window.confirm(
        `"${input.material}" no tiene stock suficiente registrado antes del ${window.formatearFecha(window.fechaProceso(registro))}` +
        `(disponible: ${saldoDisponible} Kg, requerido: ${input.kg} Kg). ` +
        '¿Continuar de todas formas?'
      );
      if (!continuar) return false;
    }
    saldosRestantes.set(input.material, saldoDisponible - input.kg);
  }
  return true;
}

// Avisa (sin bloquear) si algún input no tiene saldo en las etapas de origen de su proceso, o si se
// selecciona un material que no requiere selección. Mismo patrón que verificarStockSuficienteProceso.
function verificarOrigenProceso(registro, excluirRegistroId) {
  const datosLedger = {
    inventarioInicial: window.EVE.inventarioInicial,
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosControlProduccion: window.EVE.registrosControlProduccion,
    ventas: window.EVE.ventas
  };
  const avisos = window.EVE_INVENTARIO.calcularAvisosOrigen(datosLedger, registro, { controlProduccionId: excluirRegistroId });
  if (avisos.length === 0) return true;
  return window.confirm(`${avisos.join('\n')}\n¿Continuar de todas formas?`);
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
  refrescarInputsPorProceso('cp');
  revalidarFilasOutput('cp');
  actualizarResumen('cp');
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
    fecha: document.getElementById('cp-fecha').value,
    observaciones: document.getElementById('cp-observaciones').value.trim()
  };
  try {
    const registroSinTicket = construirRegistroDesdeFormulario(datos);
    if (!verificarStockSuficienteProceso(registroSinTicket)) return;
    if (!verificarOrigenProceso(registroSinTicket)) return;
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
      </select>
      <input type="date" id="cp-fecha" required>
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
  form.querySelector('#cp-fecha').addEventListener('input', () => actualizarResumen('cp'));
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}

function seleccionarProcesoEdicion(tipo) {
  tipoProcesoSeleccionadoEdicion = tipo;
  document.querySelectorAll('.cpe-proceso-boton').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.tipo === tipo);
  });
  refrescarInputsPorProceso('cpe');
  revalidarFilasOutput('cpe');
  actualizarResumen('cpe');
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    tipoProceso: tipoProcesoSeleccionadoEdicion,
    inputs: leerInputsFormulario('cpe'),
    outputs: leerOutputsFormulario('cpe'),
    operador: document.getElementById('cpe-operador').value.trim().toUpperCase(),
    turno: document.getElementById('cpe-turno').value,
    fecha: document.getElementById('cpe-fecha').value,
    observaciones: document.getElementById('cpe-observaciones').value.trim()
  };
  const anterior = window.EVE.registrosControlProduccion.find((r) => r.id === editandoId);
  const motivo = document.getElementById('cpe-motivo').value.trim();
  try {
    const registroSinTicket = construirRegistroDesdeFormulario(datos);
    if (!verificarStockSuficienteProceso(registroSinTicket, editandoId)) return;
    if (!verificarOrigenProceso({ ticket: editandoTicket, ...registroSinTicket }, editandoId)) return;
    const registro = { ticket: editandoTicket, ...registroSinTicket };
    await window.actualizarDato('control_produccion', editandoId, registro);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'control_produccion',
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior ? { ticket: anterior.ticket, tipoProceso: anterior.tipoProceso, outputs: anterior.outputs, operador: anterior.operador, turno: anterior.turno, fecha: window.fechaProceso(anterior) } : null,
      valorNuevo: { ticket: registro.ticket, tipoProceso: registro.tipoProceso, outputs: registro.outputs, operador: registro.operador, turno: registro.turno, fecha: registro.fecha },
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
        </select>
        <input type="date" id="cpe-fecha" required>
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
  overlay.querySelector('#cpe-fecha').addEventListener('input', () => actualizarResumen('cpe'));
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
    fila.querySelector('.cp-fila-output-merma').checked = !!output.esMerma;
    sincronizarFilaOutput('cpe', fila);
    establecerValorMaterialSelect(fila.querySelector('.cp-fila-output-material'), output.material);
    fila.querySelector('.cp-fila-output-kg').value = output.kg;
    listaOutputs.appendChild(fila);
  });
  document.getElementById('cpe-operador').value = registro.operador;
  const selectTurno = document.getElementById('cpe-turno');
  selectTurno.querySelectorAll('option[data-legado]').forEach((o) => o.remove());
  // Turno que ya no se ofrece (p. ej. 'Nocturno' en registros antiguos): se conserva como opción para no perderlo al editar.
  if (registro.turno && !Array.from(selectTurno.options).some((o) => o.value === registro.turno)) {
    const opcionLegado = document.createElement('option');
    opcionLegado.value = registro.turno;
    opcionLegado.textContent = registro.turno;
    opcionLegado.dataset.legado = '1';
    selectTurno.appendChild(opcionLegado);
  }
  selectTurno.value = registro.turno;
  document.getElementById('cpe-fecha').value = window.fechaProceso(registro).slice(0, 10);
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
      valorAnterior: registro ? { ticket: registro.ticket, tipoProceso: registro.tipoProceso, outputs: registro.outputs, operador: registro.operador, turno: registro.turno, fecha: window.fechaProceso(registro) } : null,
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
  [['', 'Todos los turnos'], ['Matutino', 'Matutino'], ['Vespertino', 'Vespertino']]
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
      <tr><th data-tipo="ticket">Ticket</th><th data-tipo="texto">Proceso</th><th data-tipo="texto">Operador</th><th data-tipo="texto">Turno</th><th data-tipo="numero">Total Input</th><th data-tipo="numero">Total Output</th><th data-tipo="numero">Eficiencia</th><th data-tipo="fecha">Fecha</th><th></th></tr>
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
    window.fechaProceso(registro)
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
    celda.colSpan = 9;
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
  // Cumplimiento de la meta diaria por producto/día del conjunto visible (con filtros de operador o
  // turno solo cuenta lo visible, no todo el día).
  calcularCumplimientoDiarioPZ(registros, window.EVE.metaPiezasDia).forEach((item) => {
    partes.push({ texto: `Piezas ${formatearCumplimientoPZ(item, true)}`, color: item.cumplimiento === null ? null : colorEficiencia(item.cumplimiento) });
  });
  partes.forEach((parte) => {
    const span = document.createElement('span');
    span.textContent = typeof parte === 'string' ? parte : parte.texto;
    if (parte.color) span.className = `cp-eficiencia-${parte.color}`;
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
          'Fecha': window.fechaProceso(r),
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
