(function () {

// ── Funciones puras ─────────────────────────────────────────────────────

// Los lookups comparan por nombre normalizado en ambos lados (window.normalizarMaterial): una
// composición guardada con un nombre anterior a un alias sigue empatando con el nombre oficial.
// No se reescribe ningún dato guardado.
function nombreMaterialNormalizado(material) {
  return window.normalizarMaterial(material);
}

function composicionVigentePorMaterial(composiciones, hoy) {
  const mapa = new Map();
  composiciones.forEach((c) => {
    if (c.fechaVigencia > hoy) return;
    if (c.fechaCierre !== null && c.fechaCierre !== undefined && c.fechaCierre < hoy) return;
    const clave = nombreMaterialNormalizado(c.materialEntrada);
    const actual = mapa.get(clave);
    if (!actual || c.fechaVigencia > actual.fechaVigencia) {
      mapa.set(clave, c);
    }
  });
  return Array.from(mapa.values()).sort((a, b) => a.materialEntrada.localeCompare(b.materialEntrada));
}

function composicionVigenteParaMaterial(composiciones, material, hoy) {
  const clave = nombreMaterialNormalizado(material);
  return composicionVigentePorMaterial(composiciones, hoy).find((c) => nombreMaterialNormalizado(c.materialEntrada) === clave) || null;
}

function composicionVigenteAbiertaPorMaterial(composiciones, material) {
  const clave = nombreMaterialNormalizado(material);
  return composiciones.find((c) => nombreMaterialNormalizado(c.materialEntrada) === clave && (c.fechaCierre === null || c.fechaCierre === undefined)) || null;
}

function materialesConComposicion(composiciones) {
  const set = new Set();
  composiciones.forEach((c) => set.add(nombreMaterialNormalizado(c.materialEntrada)));
  return Array.from(set);
}

function validarComponentes(componentes) {
  if (!Array.isArray(componentes) || componentes.length === 0) {
    throw new Error('Debe agregar al menos un componente');
  }
  let total = 0;
  componentes.forEach((c, i) => {
    const nombre = (c.subproducto || '').toString().trim();
    if (!nombre) {
      throw new Error(`El componente #${i + 1} necesita un nombre de subproducto`);
    }
    const porcentaje = Number(c.porcentaje);
    if (!Number.isFinite(porcentaje) || porcentaje <= 0) {
      throw new Error(`El porcentaje del componente "${nombre}" debe ser mayor a 0`);
    }
    total += porcentaje;
  });
  const totalRedondeado = Math.round(total * 100) / 100;
  if (totalRedondeado !== 100) {
    throw new Error(`La suma de porcentajes debe ser 100% (actual: ${totalRedondeado}%)`);
  }
  return totalRedondeado;
}

// Valida el subproducto de un componente y devuelve su nombre normalizado; lanza Error si no es válido.
// No merma: debe ser un material que sale de proceso (catálogo) o el propio material de entrada (cada
// composición incluye al propio material como componente). Merma: solo los tipos de merma de SELECCION,
// porque las composiciones describen la selección (en la práctica solo BASURA).
function validarSubproducto(nombre, esMerma, materialEntrada) {
  const limpio = (nombre || '').toString().trim();
  if (esMerma) {
    const mermas = window.tiposMermaParaProceso('SELECCION');
    const merma = limpio.toUpperCase();
    if (!mermas.includes(merma)) {
      throw new Error(`Merma "${limpio}" no válida: las composiciones solo usan ${mermas.join(', ')}`);
    }
    return merma;
  }
  const material = window.normalizarMaterial(limpio);
  const propio = window.normalizarMaterial(materialEntrada);
  if (!window.materialesProduciblesHistoricos().includes(material) && material !== propio) {
    throw new Error(`Subproducto "${limpio}" no está en el catálogo de materiales que salen de proceso (usa Es Merma = Sí solo para BASURA)`);
  }
  return material;
}

function construirNuevaComposicion(datos, composicionAnteriorVigente) {
  const materialEntrada = window.normalizarMaterial(datos.materialEntrada);
  if (!materialEntrada) {
    throw new Error('El material de entrada es obligatorio');
  }
  if (!window.materialesQueRequierenSeleccionHistoricos().includes(materialEntrada)) {
    throw new Error(window.materialesConStockHistoricos().includes(materialEntrada)
      ? `Material de entrada "${materialEntrada}" no requiere composición (solo los materiales crudos que pasan por Selección la tienen)`
      : `Material de entrada "${materialEntrada}" no está en el catálogo de materiales`);
  }
  const fechaVigencia = datos.fechaVigencia;
  if (!fechaVigencia) {
    throw new Error('La fecha de vigencia es obligatoria');
  }
  if (composicionAnteriorVigente && fechaVigencia <= composicionAnteriorVigente.fechaVigencia) {
    throw new Error(`La fecha debe ser posterior al inicio de la versión vigente actual (${window.formatearFecha(composicionAnteriorVigente.fechaVigencia)})`);
  }
  if (composicionAnteriorVigente && !(datos.motivo || '').toString().trim()) {
    throw new Error('El motivo del ajuste es obligatorio al actualizar una composición existente');
  }
  const componentes = (datos.componentes || []).map((c) => ({
    subproducto: (c.subproducto || '').toString().trim().toUpperCase(),
    porcentaje: Number(c.porcentaje),
    esMerma: !!c.esMerma,
    procesosValidos: c.esMerma ? [] : (Array.isArray(c.procesosValidos) ? c.procesosValidos : []),
    procesoSugerido: c.esMerma ? null : (c.procesoSugerido || null)
  }));
  const totalPorcentaje = validarComponentes(componentes);
  componentes.forEach((c) => { c.subproducto = validarSubproducto(c.subproducto, c.esMerma, materialEntrada); });
  const version = composicionAnteriorVigente ? (Number(composicionAnteriorVigente.version) || 1) + 1 : 1;
  const nuevo = {
    materialEntrada,
    descripcion: (datos.descripcion || '').toString().trim(),
    componentes,
    totalPorcentaje,
    version,
    fechaVigencia,
    fechaCierre: null,
    actualizadoPor: (datos.actualizadoPor || 'Admin').toString(),
    motivo: (datos.motivo || '').toString().trim()
  };
  const cierre = composicionAnteriorVigente
    ? { id: composicionAnteriorVigente.id, fechaCierre: window.restarUnDia(fechaVigencia) }
    : null;
  return { cierre, nuevo };
}

function historialPorMaterial(composiciones, material, hoy) {
  const clave = nombreMaterialNormalizado(material);
  return composiciones
    .filter((c) => nombreMaterialNormalizado(c.materialEntrada) === clave)
    .map((c) => {
      const fin = c.fechaCierre || hoy;
      const inicio = new Date(`${c.fechaVigencia}T00:00:00`);
      const finDate = new Date(`${fin}T00:00:00`);
      const duracionDias = Math.round((finDate - inicio) / 86400000) + 1;
      return { ...c, duracionDias };
    })
    .sort((a, b) => (a.fechaVigencia < b.fechaVigencia ? 1 : -1));
}

function simularLote(composicion, cantidad) {
  const cant = Number(cantidad);
  if (!composicion || !Number.isFinite(cant) || cant <= 0) return [];
  return composicion.componentes.map((c) => ({
    subproducto: c.subproducto,
    estimado: Math.round((cant * c.porcentaje / 100) * 100) / 100,
    esMerma: c.esMerma,
    procesoSugerido: c.procesoSugerido
  }));
}

function resumenSimulacion(filas) {
  let aprovechable = 0;
  let merma = 0;
  filas.forEach((f) => {
    if (f.esMerma) merma += f.estimado;
    else aprovechable += f.estimado;
  });
  return {
    aprovechable: Math.round(aprovechable * 100) / 100,
    merma: Math.round(merma * 100) / 100
  };
}

// Materiales crudos (requiereSeleccion=true) con tickets de Báscula que no quedan cubiertos por ninguna versión de
// composición a su fecha. Función pura: no lee Firestore ni el DOM.
// - material = normalizarMaterial(registro.material) y fecha = fechaSalida || fechaEntrada (mismo criterio que Reportes),
//   comparados contra composiciones normalizadas por materialEntrada (K1).
// - Solo cuentan los materiales de opciones.materialesRequeridos (por omisión window.materialesQueRequierenSeleccionHistoricos(), que incluye archivados con tickets):
//   quedan fuera molidos, peletizados, pellets, rechazos y MATERIAL VIRGEN; también las piezas (MATERIALES_PZ).
// - noEvaluables: tickets sin material, o de un material evaluable pero sin fecha o con kg <= 0.
// - tipo: 'SIN_COMPOSICION' (el material no tiene ninguna versión) o 'COBERTURA_INCOMPLETA' (tiene versiones pero hay
//   tickets anteriores o posteriores sin cobertura). inconsistencia: más de una versión abierta del mismo material.
// Devuelve { filas, noEvaluables } con las filas por kgPendientes descendente.
function calcularComposicionesPendientes(registrosDestaraje, composiciones, opciones) {
  const requeridos = new Set(((opciones && opciones.materialesRequeridos) || window.materialesQueRequierenSeleccionHistoricos())
    .map((m) => nombreMaterialNormalizado(m)));
  const piezas = new Set(window.materialesPZ().map((m) => nombreMaterialNormalizado(m)));

  const versionesPorMaterial = new Map();
  (composiciones || []).forEach((c) => {
    const clave = nombreMaterialNormalizado(c.materialEntrada);
    if (!versionesPorMaterial.has(clave)) versionesPorMaterial.set(clave, []);
    versionesPorMaterial.get(clave).push(c);
  });

  const porMaterial = new Map();
  let noEvaluables = 0;
  (registrosDestaraje || []).forEach((registro) => {
    const material = nombreMaterialNormalizado(registro.material);
    if (!material) { noEvaluables += 1; return; }
    if (!requeridos.has(material) || piezas.has(material)) return;
    const fecha = String(registro.fechaSalida || registro.fechaEntrada || '').slice(0, 10);
    const kg = Number(registro.kg);
    if (!fecha || !Number.isFinite(kg) || kg <= 0) { noEvaluables += 1; return; }
    if (!porMaterial.has(material)) porMaterial.set(material, { kgTotalRecibidos: 0, pendientes: [] });
    const acumulado = porMaterial.get(material);
    acumulado.kgTotalRecibidos += kg;
    const versiones = versionesPorMaterial.get(material) || [];
    if (!composicionVigenteParaMaterial(versiones, material, fecha)) acumulado.pendientes.push({ fecha, kg });
  });

  const redondear = (n) => Math.round(n * 100) / 100;
  const filas = [];
  porMaterial.forEach((acumulado, material) => {
    if (acumulado.pendientes.length === 0) return;
    const versiones = versionesPorMaterial.get(material) || [];
    const fechas = acumulado.pendientes.map((t) => t.fecha).sort();
    const vigencias = versiones.map((c) => c.fechaVigencia).filter(Boolean).sort();
    filas.push({
      material,
      tipo: versiones.length === 0 ? 'SIN_COMPOSICION' : 'COBERTURA_INCOMPLETA',
      kgPendientes: redondear(acumulado.pendientes.reduce((suma, t) => suma + t.kg, 0)),
      kgTotalRecibidos: redondear(acumulado.kgTotalRecibidos),
      tickets: acumulado.pendientes.length,
      primeraFecha: fechas[0],
      ultimaFecha: fechas[fechas.length - 1],
      primeraVigenciaExistente: vigencias.length > 0 ? vigencias[0] : null,
      inconsistencia: versiones.filter((c) => c.fechaCierre === null || c.fechaCierre === undefined).length > 1
    });
  });
  filas.sort((a, b) => b.kgPendientes - a.kgPendientes || a.material.localeCompare(b.material));
  return { filas, noEvaluables };
}

function sumarUnDiaISO(fechaISO) {
  const fecha = new Date(`${fechaISO}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + 1);
  return fecha.toISOString().slice(0, 10);
}

// Vigencia con la que se propone capturar la composición de un material pendiente: la fecha del primer ticket sin
// cobertura. construirNuevaComposicion exige que la fecha sea POSTERIOR al inicio de la versión abierta; si no lo es
// se usa el día siguiente a esa vigencia y se avisa de que los tickets anteriores no quedarán cubiertos.
// Devuelve { fecha, aviso } (aviso null si no hay ajuste).
function calcularVigenciaSugerida(primeraFecha, versionAbierta) {
  if (!versionAbierta || !versionAbierta.fechaVigencia || primeraFecha > versionAbierta.fechaVigencia) {
    return { fecha: primeraFecha, aviso: null };
  }
  const fecha = sumarUnDiaISO(versionAbierta.fechaVigencia);
  return {
    fecha,
    aviso: `La versión actual (v${versionAbierta.version}) vigente desde ${window.formatearFecha(versionAbierta.fechaVigencia)} ya cubre desde esa fecha: la nueva vigencia sugerida es ${window.formatearFecha(fecha)} y los tickets anteriores a esa fecha no quedarán cubiertos`
  };
}

// Nombres con los que pudo guardarse un material (el oficial y sus alias) para consultar Firestore con 'in'.
function nombresGuardadosDeMaterial(material) {
  const oficial = nombreMaterialNormalizado(material);
  const alias = window.MATERIALES_ALIAS || {};
  return Array.from(new Set([oficial, ...Object.keys(alias).filter((k) => alias[k] === oficial)]));
}

// Firma de las versiones de un material (id + cierre) para saber si lo que hay en memoria sigue siendo lo que hay en el servidor.
function firmaVersionesMaterial(composiciones, material) {
  const clave = nombreMaterialNormalizado(material);
  return (composiciones || [])
    .filter((c) => nombreMaterialNormalizado(c.materialEntrada) === clave)
    .map((c) => `${c.id}|${c.fechaCierre === null || c.fechaCierre === undefined ? '' : c.fechaCierre}`)
    .sort()
    .join(',');
}

function composicionesDifieren(composicionesMemoria, composicionesServidor, material) {
  return firmaVersionesMaterial(composicionesMemoria, material) !== firmaVersionesMaterial(composicionesServidor, material);
}

const estaAbierta = (c) => c.fechaCierre === null || c.fechaCierre === undefined;

// Plan para 'Deshacer última versión': solo la ÚLTIMA versión (mayor fechaVigencia) y solo si está abierta; nunca
// una intermedia. Devuelve { ok, motivoError, ultima, anterior, accion }. anterior es la versión inmediatamente previa
// (null si la última es la única: el material vuelve a pendiente). accion: borrar la última y, si hay anterior,
// ponerle fechaCierre = null.
function planificarDeshacerUltimaVersion(composiciones, material) {
  const fallo = (motivoError) => ({ ok: false, motivoError, ultima: null, anterior: null, accion: null });
  const clave = nombreMaterialNormalizado(material);
  const versiones = (composiciones || []).filter((c) => nombreMaterialNormalizado(c.materialEntrada) === clave);
  if (versiones.length === 0) return fallo('El material no tiene versiones de composición');
  if (versiones.filter(estaAbierta).length > 1) return fallo('El material tiene más de una versión abierta: corrígelo antes de deshacer');
  const porVigencia = versiones.slice().sort((a, b) => {
    if (a.fechaVigencia !== b.fechaVigencia) return a.fechaVigencia < b.fechaVigencia ? 1 : -1;
    return (Number(b.version) || 0) - (Number(a.version) || 0);
  });
  const ultima = porVigencia[0];
  if (!estaAbierta(ultima)) return fallo('La versión más reciente ya está cerrada: solo se puede deshacer la última versión abierta');
  const anterior = porVigencia[1] || null;
  return {
    ok: true,
    motivoError: null,
    ultima,
    anterior,
    accion: { borrarId: ultima.id, reabrirId: anterior ? anterior.id : null, fechaCierre: null }
  };
}

// Tickets y kg de Báscula del material con fecha >= la vigencia de la versión que se borraría (los que dejarían de
// usar esa versión).
function resumirImpactoDeshacer(registrosDestaraje, material, fechaVigencia) {
  const clave = nombreMaterialNormalizado(material);
  let tickets = 0;
  let kg = 0;
  (registrosDestaraje || []).forEach((r) => {
    if (nombreMaterialNormalizado(r.material) !== clave) return;
    const fecha = String(r.fechaSalida || r.fechaEntrada || '').slice(0, 10);
    if (!fecha || fecha < fechaVigencia) return;
    tickets += 1;
    kg += Number(r.kg) || 0;
  });
  return { tickets, kg: Math.round(kg * 100) / 100 };
}

function procesosDisponibles() {
  const procesos = (window.EVE_CONTROL_PRODUCCION && window.EVE_CONTROL_PRODUCCION.PROCESOS) || {};
  const nombresUI = window.NOMBRE_PROCESO_UI || {};
  const lista = Object.keys(procesos).map((clave) => ({ clave, nombre: nombresUI[clave] || procesos[clave].nombre }));
  lista.push({ clave: 'VENTA_DIRECTA', nombre: 'Venta Directa' });
  return lista;
}

function nombreProceso(clave) {
  if (!clave) return '—';
  const encontrado = procesosDisponibles().find((p) => p.clave === clave);
  return encontrado ? encontrado.nombre : clave;
}

window.EVE_RENDIMIENTOS = {
  composicionVigentePorMaterial,
  composicionVigenteParaMaterial,
  composicionVigenteAbiertaPorMaterial,
  materialesConComposicion,
  validarComponentes,
  validarSubproducto,
  construirNuevaComposicion,
  historialPorMaterial,
  simularLote,
  resumenSimulacion,
  calcularComposicionesPendientes,
  calcularVigenciaSugerida,
  nombresGuardadosDeMaterial,
  composicionesDifieren,
  planificarDeshacerUltimaVersion,
  resumirImpactoDeshacer,
  procesosDisponibles
};

// ── Estado del módulo ────────────────────────────────────────────────────

let vistaActiva = 'vigentes';
let materialHistorialSeleccionado = '';
let gestorComponentesModal = null;
let ultimaSimulacion = null; // { material, cantidad, filas, resumen } — llenado por calcularSimulacion,
                              // reutilizado por la vista para captura del modo Simulador de Lote.

function puedeEditarRendimientos() {
  return window.puedeEscribir('rendimientos');
}

// ── Editor de componentes (filas dinámicas) ─────────────────────────────

// Opciones del select de subproducto: con Merma, las mermas de SELECCION; si no, los materiales que salen de
// proceso más el propio material de entrada del modal.
function nombresSubproductoParaFila(esMerma) {
  if (esMerma) return window.tiposMermaParaProceso('SELECCION');
  const entrada = window.normalizarMaterial((document.getElementById('rd-material') || {}).value);
  const nombres = new Set(window.materialesProducibles());
  if (entrada) nombres.add(entrada);
  return Array.from(nombres);
}

// Reconstruye el select conservando el valor si sigue siendo válido. Con conservarLegado, un valor guardado
// que ya no está en la lista (composición anterior al catálogo) se mantiene visible con aviso; el validador
// lo rechazará al guardar hasta que se elija uno válido. Los datos guardados no se modifican.
function llenarSelectSubproducto(select, esMerma, valorActual, conservarLegado) {
  const nombres = nombresSubproductoParaFila(esMerma);
  const actual = (valorActual || '').toString().trim();
  const normalizado = esMerma ? actual.toUpperCase() : window.normalizarMaterial(actual);
  select.innerHTML = '<option value="">Subproducto…</option>' +
    nombres.map((m) => `<option value="${m}">${m}</option>`).join('');
  if (nombres.includes(normalizado)) {
    select.value = normalizado;
  } else if (!esMerma && actual && window.agregarOpcionSiArchivado(select, normalizado)) {
    select.value = normalizado;
  } else if (actual && conservarLegado) {
    const legado = document.createElement('option');
    legado.value = actual;
    legado.textContent = `⚠️ valor no reconocido: ${actual}`;
    select.appendChild(legado);
    select.value = actual;
  } else {
    select.value = '';
  }
}

function refrescarSubproductosDelModal() {
  document.querySelectorAll('#rd-componentes-contenedor .componente-fila').forEach((fila) => {
    const select = fila.querySelector('.cf-subproducto');
    llenarSelectSubproducto(select, fila.querySelector('.cf-merma').checked, select.value, false);
  });
}

function crearFilaComponente(componente, procesos) {
  const fila = document.createElement('div');
  fila.className = 'componente-fila';

  const inputSubproducto = document.createElement('select');
  inputSubproducto.className = 'cf-subproducto';

  const inputPorcentaje = document.createElement('input');
  inputPorcentaje.type = 'number';
  inputPorcentaje.className = 'cf-porcentaje';
  inputPorcentaje.placeholder = '%';
  inputPorcentaje.step = '0.01';
  inputPorcentaje.value = componente.porcentaje != null ? componente.porcentaje : '';

  const labelMerma = document.createElement('label');
  labelMerma.className = 'cf-merma-label';
  const checkMerma = document.createElement('input');
  checkMerma.type = 'checkbox';
  checkMerma.className = 'cf-merma';
  checkMerma.checked = !!componente.esMerma;
  labelMerma.appendChild(checkMerma);
  labelMerma.appendChild(document.createTextNode('Merma'));
  llenarSelectSubproducto(inputSubproducto, !!componente.esMerma, componente.subproducto, true);
  checkMerma.addEventListener('change', () => llenarSelectSubproducto(inputSubproducto, checkMerma.checked, inputSubproducto.value, false));

  const divProcesos = document.createElement('div');
  divProcesos.className = 'cf-procesos';

  const selectSugerido = document.createElement('select');
  selectSugerido.className = 'cf-sugerido';

  function actualizarOpcionesSugerido() {
    const seleccionado = selectSugerido.value;
    const marcados = Array.from(divProcesos.querySelectorAll('input:checked'));
    selectSugerido.innerHTML = '<option value="">Proceso sugerido…</option>';
    marcados.forEach((check) => {
      const opcion = document.createElement('option');
      opcion.value = check.value;
      opcion.textContent = check.dataset.nombre || check.value;
      selectSugerido.appendChild(opcion);
    });
    if (marcados.some((c) => c.value === seleccionado)) {
      selectSugerido.value = seleccionado;
    }
  }

  procesos.forEach((proceso) => {
    const label = document.createElement('label');
    label.className = 'cf-proceso-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.value = proceso.clave;
    check.dataset.nombre = proceso.nombre;
    check.checked = (componente.procesosValidos || []).includes(proceso.clave);
    check.addEventListener('change', actualizarOpcionesSugerido);
    label.appendChild(check);
    label.appendChild(document.createTextNode(proceso.nombre));
    divProcesos.appendChild(label);
  });

  actualizarOpcionesSugerido();
  if (componente.procesoSugerido) selectSugerido.value = componente.procesoSugerido;

  function actualizarDisponibilidadMerma() {
    const esMerma = checkMerma.checked;
    divProcesos.style.display = esMerma ? 'none' : '';
    selectSugerido.style.display = esMerma ? 'none' : '';
    if (esMerma) {
      divProcesos.querySelectorAll('input:checked').forEach((c) => { c.checked = false; });
      selectSugerido.value = '';
      actualizarOpcionesSugerido();
    }
  }
  checkMerma.addEventListener('change', actualizarDisponibilidadMerma);
  actualizarDisponibilidadMerma();

  const botonEliminar = document.createElement('button');
  botonEliminar.type = 'button';
  botonEliminar.className = 'btn-secondary';
  botonEliminar.textContent = '✕';
  botonEliminar.addEventListener('click', () => fila.remove());

  fila.appendChild(inputSubproducto);
  fila.appendChild(inputPorcentaje);
  fila.appendChild(labelMerma);
  fila.appendChild(divProcesos);
  fila.appendChild(selectSugerido);
  fila.appendChild(botonEliminar);

  return fila;
}

function leerComponenteDeFila(fila) {
  return {
    subproducto: fila.querySelector('.cf-subproducto').value,
    porcentaje: fila.querySelector('.cf-porcentaje').value,
    esMerma: fila.querySelector('.cf-merma').checked,
    procesosValidos: Array.from(fila.querySelectorAll('.cf-procesos input:checked')).map((c) => c.value),
    procesoSugerido: fila.querySelector('.cf-sugerido').value || null
  };
}

function crearGestorComponentes() {
  const contenedor = document.createElement('div');
  contenedor.className = 'componentes-wrapper';

  function agregarComponente(componente) {
    contenedor.appendChild(crearFilaComponente(componente || {}, procesosDisponibles()));
  }

  function obtenerComponentesFormulario() {
    return Array.from(contenedor.querySelectorAll('.componente-fila')).map(leerComponenteDeFila);
  }

  function limpiar() {
    contenedor.innerHTML = '';
  }

  return { contenedor, agregarComponente, obtenerComponentesFormulario, limpiar };
}

function actualizarTotalComponentes() {
  const span = document.getElementById('rd-total');
  if (!span || !gestorComponentesModal) return;
  const total = gestorComponentesModal.obtenerComponentesFormulario()
    .reduce((s, c) => s + (Number(c.porcentaje) || 0), 0);
  const totalRedondeado = Math.round(total * 100) / 100;
  span.textContent = `Total: ${totalRedondeado}%`;
  span.className = totalRedondeado === 100 ? 'chip chip-ok' : 'chip chip-warn';
}

// ── Datalist de materiales ───────────────────────────────────────────────

function materialesParaDatalistRendimientos() {
  return window.materialesQueRequierenSeleccion().slice().sort();
}

function llenarDatalistMaterialesRendimientos() {
  const datalist = document.getElementById('dl-rendimientos-materiales');
  if (!datalist) return;
  datalist.innerHTML = '';
  materialesParaDatalistRendimientos().forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    datalist.appendChild(opcion);
  });
}

// ── Modal: crear / actualizar composición ───────────────────────────────

function mostrarAvisoComposicionAnterior() {
  const material = document.getElementById('rd-material').value.trim().toUpperCase();
  const fecha = document.getElementById('rd-fecha').value;
  const aviso = document.getElementById('rd-aviso');
  const anterior = material ? composicionVigenteAbiertaPorMaterial(window.EVE.composiciones, material) : null;
  if (anterior) {
    aviso.style.display = '';
    aviso.textContent = `La versión actual (v${anterior.version}) quedará cerrada al ${window.formatearFecha(window.restarUnDia(fecha || window.obtenerFechaMexico()))}`;
  } else {
    aviso.style.display = 'none';
    aviso.textContent = '';
  }
}

function reemplazarComposicionesEnMemoria(material, docs) {
  const clave = nombreMaterialNormalizado(material);
  window.EVE.composiciones = [
    ...window.EVE.composiciones.filter((c) => nombreMaterialNormalizado(c.materialEntrada) !== clave),
    ...docs
  ];
}

// Antes de guardar se relee del servidor la composición del material: si otro dispositivo ya cambió sus versiones
// (se abrió, cerró o agregó una), no se guarda sobre una vista vieja. Sin conexión (o si la lectura falla) se
// sigue con lo que hay en memoria y no se bloquea. Devuelve false si se abortó.
async function verificarComposicionesFrescas(material) {
  let docs;
  try {
    const snapshot = await window.db.collection('composiciones')
      .where('materialEntrada', 'in', nombresGuardadosDeMaterial(material))
      .get({ source: 'server' });
    docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('No se pudo releer las composiciones del servidor; se continúa con la memoria:', error);
    return true;
  }
  if (!composicionesDifieren(window.EVE.composiciones, docs, material)) return true;
  const clave = nombreMaterialNormalizado(material);
  reemplazarComposicionesEnMemoria(material, docs);
  mostrarAvisoComposicionAnterior();
  renderizarVistaActiva();
  window.showError(`Las versiones de la composición de ${clave} cambiaron en otro dispositivo. Se actualizó la información: revisa la versión vigente y vuelve a guardar`);
  return false;
}

async function manejarEnvioComposicion(evento) {
  evento.preventDefault();
  const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  const datos = {
    materialEntrada: document.getElementById('rd-material').value,
    descripcion: document.getElementById('rd-descripcion').value,
    fechaVigencia: document.getElementById('rd-fecha').value,
    componentes: gestorComponentesModal.obtenerComponentesFormulario(),
    motivo: document.getElementById('rd-motivo').value,
    actualizadoPor: usuario
  };
  try {
    const materialUpper = (datos.materialEntrada || '').toString().trim().toUpperCase();
    if (materialUpper && !(await verificarComposicionesFrescas(materialUpper))) return;
    const anterior = composicionVigenteAbiertaPorMaterial(window.EVE.composiciones, materialUpper);
    const { cierre, nuevo } = construirNuevaComposicion(datos, anterior);
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
      accion: anterior ? 'edicion' : 'creacion',
      valorAnterior: anterior ? { version: anterior.version, componentes: anterior.componentes } : null,
      valorNuevo: { version: nuevo.version, componentes: nuevo.componentes },
      motivo: nuevo.motivo
    });
    cerrarModalComposicion();
    llenarDatalistMaterialesRendimientos();
    renderizarVistaActiva();
    window.showSuccess('Composición guardada');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalComposicion() {
  const overlay = document.createElement('div');
  overlay.id = 'rendimientos-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-ancho">
      <h3 id="rd-modal-titulo">Nueva Composición</h3>
      <form id="rendimientos-form">
        <div class="form-grid">
          <input type="text" id="rd-material" placeholder="Material de entrada" list="dl-rendimientos-materiales" required>
          <input type="date" id="rd-fecha" required>
        </div>
        <input type="text" id="rd-descripcion" placeholder="Descripción (opcional)">
        <div id="rd-aviso" class="chip chip-warn" style="display:none;margin:0.5rem 0"></div>
        <div id="rd-aviso-vigencia" class="chip chip-warn" style="display:none;margin:0.5rem 0"></div>
        <select id="rd-copiar-de" title="Copiar de otra composición"></select>
        <div id="rd-aviso-plantilla" class="chip chip-warn" style="display:none;margin:0.5rem 0"></div>
        <div id="rd-componentes-contenedor"></div>
        <div class="destaraje-exportar">
          <button type="button" id="rd-agregar-componente" class="btn-secondary">+ Agregar componente</button>
          <span id="rd-total" class="chip"></span>
        </div>
        <textarea id="rd-motivo" placeholder="Motivo del ajuste" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar nueva versión</button>
        <button type="button" id="rd-cancelar" class="btn-secondary">Cancelar</button>
      </form>
      <datalist id="dl-rendimientos-materiales"></datalist>
    </div>
  `;
  gestorComponentesModal = crearGestorComponentes();
  const contenedor = overlay.querySelector('#rd-componentes-contenedor');
  contenedor.appendChild(gestorComponentesModal.contenedor);
  contenedor.addEventListener('input', actualizarTotalComponentes);
  contenedor.addEventListener('change', actualizarTotalComponentes);
  overlay.querySelector('#rd-agregar-componente').addEventListener('click', () => {
    gestorComponentesModal.agregarComponente({});
    actualizarTotalComponentes();
  });
  overlay.querySelector('#rd-material').addEventListener('input', mostrarAvisoComposicionAnterior);
  overlay.querySelector('#rd-material').addEventListener('input', refrescarSubproductosDelModal);
  overlay.querySelector('#rd-material').addEventListener('change', refrescarSubproductosDelModal);
  overlay.querySelector('#rd-fecha').addEventListener('change', mostrarAvisoComposicionAnterior);
  overlay.querySelector('#rd-copiar-de').addEventListener('change', (evento) => copiarComposicionDe(evento.target.value));
  overlay.querySelector('#rendimientos-form').addEventListener('submit', manejarEnvioComposicion);
  overlay.querySelector('#rd-cancelar').addEventListener('click', () => cerrarModalComposicion());
  return overlay;
}

// Rellena las filas de componentes con los de la versión vigente de otra composición, como plantilla editable.
// Cada composición incluye al propio material, así que el componente que corresponde al material de entrada
// de la plantilla debe revisarse.
function copiarComposicionDe(materialOrigen) {
  const avisoPlantilla = document.getElementById('rd-aviso-plantilla');
  if (!materialOrigen) {
    avisoPlantilla.style.display = 'none';
    avisoPlantilla.textContent = '';
    return;
  }
  const origen = composicionVigenteParaMaterial(window.EVE.composiciones, materialOrigen, window.obtenerFechaMexico())
    || composicionVigenteAbiertaPorMaterial(window.EVE.composiciones, materialOrigen);
  if (!origen) {
    window.showError(`"${materialOrigen}" no tiene una composición vigente que copiar`);
    return;
  }
  gestorComponentesModal.limpiar();
  (origen.componentes || []).forEach((c) => gestorComponentesModal.agregarComponente({
    subproducto: c.subproducto,
    porcentaje: c.porcentaje,
    esMerma: c.esMerma,
    procesosValidos: c.procesosValidos,
    procesoSugerido: c.procesoSugerido
  }));
  actualizarTotalComponentes();
  refrescarSubproductosDelModal();
  avisoPlantilla.style.display = '';
  avisoPlantilla.textContent = 'Cada composición incluye al propio material: revisa el componente que corresponde al material de entrada';
}

function llenarSelectorCopiarDe(seleccionado) {
  const select = document.getElementById('rd-copiar-de');
  select.innerHTML = '';
  const vacio = document.createElement('option');
  vacio.value = '';
  vacio.textContent = '— Copiar de otra composición —';
  select.appendChild(vacio);
  materialesConComposicion(window.EVE.composiciones).slice().sort().forEach((material) => {
    const opcion = document.createElement('option');
    opcion.value = material;
    opcion.textContent = material;
    select.appendChild(opcion);
  });
  select.value = seleccionado || '';
}

// opciones (opcionales): { vigenciaSugerida, avisoVigencia, plantillaDe }. Sin opciones el comportamiento es el de siempre.
function abrirModalComposicion(materialPrefill, opciones) {
  const opts = opciones || {};
  document.getElementById('rendimientos-form').reset();
  document.getElementById('rd-fecha').value = opts.vigenciaSugerida || window.obtenerFechaMexico();
  gestorComponentesModal.limpiar();
  llenarDatalistMaterialesRendimientos();
  llenarSelectorCopiarDe('');
  document.getElementById('rd-aviso-plantilla').style.display = 'none';
  const avisoVigencia = document.getElementById('rd-aviso-vigencia');
  avisoVigencia.style.display = opts.avisoVigencia ? '' : 'none';
  avisoVigencia.textContent = opts.avisoVigencia || '';
  const anterior = materialPrefill ? composicionVigenteAbiertaPorMaterial(window.EVE.composiciones, materialPrefill) : null;
  document.getElementById('rd-modal-titulo').textContent = anterior ? `Actualizar Composición — ${materialPrefill}` : 'Nueva Composición';
  if (materialPrefill) {
    document.getElementById('rd-material').value = materialPrefill;
  }
  if (anterior) {
    document.getElementById('rd-descripcion').value = anterior.descripcion || '';
    anterior.componentes.forEach((c) => gestorComponentesModal.agregarComponente(c));
  } else {
    gestorComponentesModal.agregarComponente({});
  }
  actualizarTotalComponentes();
  mostrarAvisoComposicionAnterior();
  if (opts.plantillaDe) {
    llenarSelectorCopiarDe(opts.plantillaDe);
    copiarComposicionDe(opts.plantillaDe);
  }
  document.getElementById('rendimientos-modal-overlay').classList.add('open');
}

function cerrarModalComposicion() {
  document.getElementById('rendimientos-modal-overlay').classList.remove('open');
}

// ── Deshacer última versión ─────────────────────────────────────────────

let contextoDeshacer = null; // { material, plan } mientras el modal está abierto

function crearModalDeshacer() {
  const overlay = document.createElement('div');
  overlay.id = 'rendimientos-deshacer-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-ancho">
      <h3 id="rd-deshacer-titulo">Deshacer última versión</h3>
      <ul id="rd-deshacer-detalle"></ul>
      <textarea id="rd-deshacer-motivo" placeholder="Motivo (obligatorio)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
      <button type="button" id="rd-deshacer-confirmar" class="btn-primary">Deshacer última versión</button>
      <button type="button" id="rd-deshacer-cancelar" class="btn-secondary">Cancelar</button>
    </div>
  `;
  overlay.querySelector('#rd-deshacer-confirmar').addEventListener('click', confirmarDeshacerUltimaVersion);
  overlay.querySelector('#rd-deshacer-cancelar').addEventListener('click', cerrarModalDeshacer);
  return overlay;
}

function cerrarModalDeshacer() {
  document.getElementById('rendimientos-deshacer-overlay').classList.remove('open');
  contextoDeshacer = null;
}

function abrirModalDeshacer(material) {
  const plan = planificarDeshacerUltimaVersion(window.EVE.composiciones, material);
  if (!plan.ok) {
    window.showError(plan.motivoError);
    return;
  }
  contextoDeshacer = { material, plan };
  const { ultima, anterior } = plan;
  const impacto = resumirImpactoDeshacer(window.EVE.registrosDestaraje, material, ultima.fechaVigencia);
  const creada = ultima.fechaRegistro ? window.formatearFecha(String(ultima.fechaRegistro).slice(0, 10)) : '—';
  const lineas = [
    `Material: ${nombreMaterialNormalizado(material)}`,
    `Versión que se borrará: v${ultima.version}, vigente desde ${window.formatearFecha(ultima.fechaVigencia)}`,
    `Creada por: ${ultima.actualizadoPor || '—'} el ${creada}`,
    `Componentes: ${(ultima.componentes || []).map((c) => `${c.subproducto} ${c.porcentaje}%${c.esMerma ? ' (merma)' : ''}`).join(', ') || '—'}`,
    `Báscula: ${impacto.tickets} ticket(s) y ${impacto.kg.toLocaleString('es-MX')} kg de este material con fecha desde ${window.formatearFecha(ultima.fechaVigencia)} dejarán de usar esta versión`,
    anterior
      ? `Quedará vigente: v${anterior.version} (desde ${window.formatearFecha(anterior.fechaVigencia)}), reabierta sin fecha de cierre`
      : 'No hay versión anterior: el material volverá a Pendientes (sin composición)'
  ];
  const lista = document.getElementById('rd-deshacer-detalle');
  lista.innerHTML = '';
  lineas.forEach((texto) => {
    const item = document.createElement('li');
    item.textContent = texto;
    lista.appendChild(item);
  });
  document.getElementById('rd-deshacer-motivo').value = '';
  document.getElementById('rd-deshacer-confirmar').disabled = false;
  document.getElementById('rendimientos-deshacer-overlay').classList.add('open');
}

// Borra la última versión y reabre la anterior, con el registro de historial, en UNA transacción. Requiere conexión.
// Limitación del SDK web: una transacción solo puede LEER documentos (no consultas). Por eso las versiones del
// material se releen primero con una consulta al servidor y dentro de la transacción se vuelven a leer los dos
// documentos que se tocan (última y anterior): una versión nueva creada en otro dispositivo cierra la última
// (fechaCierre), así que la transacción lo detecta y aborta.
async function confirmarDeshacerUltimaVersion() {
  if (!contextoDeshacer) return;
  const { material, plan } = contextoDeshacer;
  const motivo = document.getElementById('rd-deshacer-motivo').value.trim();
  if (!motivo) {
    window.showError('El motivo es obligatorio');
    return;
  }
  if (!navigator.onLine) {
    window.showError('Requiere conexión: deshacer una versión solo funciona con internet. No se cambió nada');
    return;
  }
  const boton = document.getElementById('rd-deshacer-confirmar');
  boton.disabled = true;
  try {
    const snapshot = await window.db.collection('composiciones')
      .where('materialEntrada', 'in', nombresGuardadosDeMaterial(material))
      .get({ source: 'server' });
    const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const planServidor = planificarDeshacerUltimaVersion(docs, material);
    const mismaVersion = planServidor.ok
      && planServidor.ultima.id === plan.ultima.id
      && (planServidor.anterior ? planServidor.anterior.id : null) === (plan.anterior ? plan.anterior.id : null);
    if (!mismaVersion) {
      reemplazarComposicionesEnMemoria(material, docs);
      cerrarModalDeshacer();
      renderizarVistaActiva();
      window.showError(planServidor.ok
        ? 'La última versión cambió en otro dispositivo. Se actualizó la información: revisa y vuelve a intentarlo'
        : `No se puede deshacer: ${planServidor.motivoError}. Se actualizó la información`);
      return;
    }
    const { ultima, anterior } = planServidor;
    const refUltima = window.db.collection('composiciones').doc(ultima.id);
    const refAnterior = anterior ? window.db.collection('composiciones').doc(anterior.id) : null;
    const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema';
    await window.db.runTransaction(async (transaccion) => {
      const docUltima = await transaccion.get(refUltima);
      const docAnterior = refAnterior ? await transaccion.get(refAnterior) : null;
      if (!docUltima.exists || !estaAbierta(docUltima.data())) {
        throw new Error('La última versión ya no está abierta (otro dispositivo la cambió). No se modificó nada');
      }
      if (refAnterior) {
        const cierreActual = docAnterior.exists ? docAnterior.data().fechaCierre : undefined;
        if (!docAnterior.exists || cierreActual !== anterior.fechaCierre) {
          throw new Error('La versión anterior cambió en otro dispositivo. No se modificó nada');
        }
      }
      transaccion.delete(refUltima);
      if (refAnterior) transaccion.update(refAnterior, { fechaCierre: null });
      transaccion.set(window.db.collection('historial_cambios').doc(), {
        coleccion: 'composiciones',
        registroId: ultima.id,
        accion: 'eliminacion',
        valorAnterior: { version: ultima.version, fechaVigencia: ultima.fechaVigencia, componentes: ultima.componentes },
        valorNuevo: null,
        motivo,
        usuario,
        timestamp: new Date().toISOString()
      });
    });
    window.EVE.composiciones = window.EVE.composiciones.filter((c) => c.id !== ultima.id);
    if (anterior) {
      const enMemoria = window.EVE.composiciones.find((c) => c.id === anterior.id);
      if (enMemoria) enMemoria.fechaCierre = null;
    }
    cerrarModalDeshacer();
    llenarDatalistMaterialesRendimientos();
    renderizarVistaActiva();
    window.showSuccess(anterior ? `Se deshizo v${ultima.version}; vigente de nuevo v${anterior.version}` : `Se deshizo v${ultima.version}; el material volvió a Pendientes`);
  } catch (error) {
    window.showError(error.message);
    boton.disabled = false;
  }
}

function crearBotonDeshacer(material) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn-secondary';
  boton.textContent = 'Deshacer última versión';
  boton.addEventListener('click', () => abrirModalDeshacer(material));
  return boton;
}

// ── Modal: ver detalle de una composición (solo lectura) ────────────────

function crearModalDetalle() {
  const overlay = document.createElement('div');
  overlay.id = 'rendimientos-detalle-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal modal-ancho">
      <h3 id="rd-detalle-titulo">Composición</h3>
      <div class="destaraje-tabla-wrapper">
        <table class="tabla-destaraje">
          <thead><tr><th>Subproducto</th><th>%</th><th>Tipo</th><th>Procesos válidos</th><th>Sugerido</th></tr></thead>
          <tbody id="rd-detalle-tabla"></tbody>
        </table>
      </div>
      <button type="button" id="rd-detalle-cerrar" class="btn-secondary">Cerrar</button>
    </div>
  `;
  overlay.querySelector('#rd-detalle-cerrar').addEventListener('click', () => {
    overlay.classList.remove('open');
  });
  return overlay;
}

function abrirModalDetalle(composicion) {
  document.getElementById('rd-detalle-titulo').textContent = `${composicion.materialEntrada} — v${composicion.version}`;
  const tbody = document.getElementById('rd-detalle-tabla');
  tbody.innerHTML = '';
  composicion.componentes.forEach((c) => {
    const fila = document.createElement('tr');
    const valores = [
      c.subproducto,
      `${c.porcentaje}%`,
      c.esMerma ? 'Merma' : 'Aprovechable',
      c.esMerma ? '—' : ((c.procesosValidos || []).map(nombreProceso).join(', ') || '—'),
      c.esMerma ? '—' : nombreProceso(c.procesoSugerido)
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
  document.getElementById('rendimientos-detalle-overlay').classList.add('open');
}

// ── Exportar CSV ──────────────────────────────────────────────────────────

function construirFilasCSVComposiciones(composiciones) {
  const filas = [];
  const ordenadas = [...composiciones].sort((a, b) => {
    if (a.materialEntrada !== b.materialEntrada) return a.materialEntrada.localeCompare(b.materialEntrada);
    return (Number(a.version) || 0) - (Number(b.version) || 0);
  });
  ordenadas.forEach((c) => {
    (c.componentes || []).forEach((comp) => {
      filas.push({
        'Material Entrada': c.materialEntrada,
        'Versión': c.version,
        'Fecha Vigencia': c.fechaVigencia,
        'Fecha Cierre': c.fechaCierre ? c.fechaCierre : 'Vigente',
        'Subproducto': comp.subproducto,
        '%': comp.porcentaje,
        'Es Merma': comp.esMerma ? 'Sí' : 'No',
        'Procesos Válidos': (comp.procesosValidos || []).join(' | '),
        'Proceso Sugerido': comp.procesoSugerido || ''
      });
    });
  });
  return filas;
}

function exportarComposicionesCSV() {
  const filas = construirFilasCSVComposiciones(window.EVE.composiciones || []);
  window.exportarCSV(filas, `composiciones_historico_${window.obtenerFechaMexico()}.csv`);
}

// ── Barra de acciones y subtabs ──────────────────────────────────────────

function crearBarraAcciones() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  if (puedeEditarRendimientos()) {
    const btnNuevo = document.createElement('button');
    btnNuevo.textContent = '+ Nueva Composición';
    btnNuevo.className = 'btn-primary';
    btnNuevo.addEventListener('click', () => abrirModalComposicion());
    div.appendChild(btnNuevo);
  }
  const btnExportarCSV = document.createElement('button');
  btnExportarCSV.textContent = 'Exportar CSV';
  btnExportarCSV.className = 'btn-secondary';
  btnExportarCSV.addEventListener('click', () => exportarComposicionesCSV());
  div.appendChild(btnExportarCSV);
  const btnCaptura = document.createElement('button');
  btnCaptura.textContent = 'Vista para captura';
  btnCaptura.className = 'btn-secondary';
  btnCaptura.addEventListener('click', () => abrirVistaCapturaRendimientos());
  div.appendChild(btnCaptura);
  return div;
}

// ===== Vista para captura =====
// Un solo botón que captura lo que la pantalla muestra en el modo activo
// (vistaActiva): Composiciones vigentes, Historial (del material seleccionado)
// o Simulador de Lote (de la última simulación calculada) — sin recalcular ni
// hacer una consulta aparte, solo empaquetando lo que ya está en pantalla.

const COLUMNAS_CAPTURA_COMPOSICIONES = [
  { clave: 'materialEntrada', etiqueta: 'Material', ancho: '30%', truncar: false },
  { clave: 'componentes', etiqueta: 'Componentes', ancho: '18%', truncar: true, formato: (valor) => `${valor.length} componentes` },
  { clave: 'version', etiqueta: 'Versión', ancho: '12%', truncar: true, formato: (valor) => `v${valor}` },
  { clave: 'fechaVigencia', etiqueta: 'Vigente desde', ancho: '20%', truncar: true, formato: (valor) => window.formatearFecha(valor) },
  { clave: 'actualizadoPor', etiqueta: 'Actualizado por', ancho: '20%', truncar: true }
];

const COLUMNAS_CAPTURA_HISTORIAL = [
  { clave: 'version', etiqueta: 'Versión', ancho: '10%', truncar: true, formato: (valor) => `v${valor}` },
  { clave: 'fechaVigencia', etiqueta: 'Desde', ancho: '15%', truncar: true, formato: (valor) => window.formatearFecha(valor) },
  { clave: 'fechaCierre', etiqueta: 'Hasta', ancho: '15%', truncar: true, formato: (valor) => (valor ? window.formatearFecha(valor) : 'Vigente') },
  { clave: 'duracionDias', etiqueta: 'Duración (días)', ancho: '15%', alineacion: 'right', truncar: true },
  { clave: 'motivo', etiqueta: 'Motivo', ancho: '25%', truncar: false },
  { clave: 'actualizadoPor', etiqueta: 'Actualizado por', ancho: '20%', truncar: true }
];

const COLUMNAS_CAPTURA_SIMULADOR = [
  { clave: 'subproducto', etiqueta: 'Subproducto', ancho: '32%', truncar: false },
  { clave: 'estimado', etiqueta: 'Estimado (Kg)', ancho: '20%', alineacion: 'right', truncar: true, formato: (valor) => `${valor} Kg` },
  { clave: 'esMerma', etiqueta: 'Tipo', ancho: '20%', truncar: true, formato: (valor) => (valor ? 'Merma' : 'Aprovechable') },
  { clave: 'procesoSugerido', etiqueta: 'Proceso sugerido', ancho: '28%', truncar: false, formato: (valor, fila) => (fila.esMerma ? '—' : nombreProceso(valor)) }
];

function abrirVistaCapturaComposiciones() {
  const filas = composicionVigentePorMaterial(window.EVE.composiciones, window.obtenerFechaMexico());
  window.VistaCaptura.abrir({
    titulo: 'Rendimientos · Composiciones vigentes',
    periodo: window.formatearFecha(window.obtenerFechaMexico()),
    kpis: [{ label: 'Composiciones vigentes', valor: filas.length.toLocaleString('es-MX') }],
    columnas: COLUMNAS_CAPTURA_COMPOSICIONES,
    filas: filas.length > 0 ? filas : undefined,
    vacioMensaje: 'Sin composiciones registradas'
  });
}

function abrirVistaCapturaHistorial() {
  if (!materialHistorialSeleccionado) {
    window.VistaCaptura.abrir({
      titulo: 'Rendimientos · Historial',
      vacioMensaje: 'Selecciona un material para ver su historial de composiciones'
    });
    return;
  }
  const historial = historialPorMaterial(window.EVE.composiciones, materialHistorialSeleccionado, window.obtenerFechaMexico());
  window.VistaCaptura.abrir({
    titulo: 'Rendimientos · Historial',
    periodo: materialHistorialSeleccionado,
    kpis: [{ label: 'Versiones', valor: historial.length.toLocaleString('es-MX') }],
    columnas: COLUMNAS_CAPTURA_HISTORIAL,
    filas: historial.length > 0 ? historial : undefined,
    vacioMensaje: 'Sin historial para este material'
  });
}

function abrirVistaCapturaSimulador() {
  if (!ultimaSimulacion) {
    window.VistaCaptura.abrir({
      titulo: 'Rendimientos · Simulador de Lote',
      vacioMensaje: 'Calcula una simulación para poder capturarla'
    });
    return;
  }
  const { material, cantidad, filas, resumen } = ultimaSimulacion;
  const totalLote = resumen.aprovechable + resumen.merma;
  const pctAprovechable = totalLote > 0 ? (resumen.aprovechable / totalLote) * 100 : 0;
  const pctMerma = totalLote > 0 ? (resumen.merma / totalLote) * 100 : 0;

  window.VistaCaptura.abrir({
    titulo: 'Rendimientos · Simulador de Lote',
    periodo: `${material} · ${cantidad.toLocaleString('es-MX')} Kg`,
    kpis: [
      { label: 'Total aprovechable', valor: `${resumen.aprovechable} Kg (${pctAprovechable.toFixed(1)}%)` },
      { label: 'Total merma', valor: `${resumen.merma} Kg (${pctMerma.toFixed(1)}%)` }
    ],
    columnas: COLUMNAS_CAPTURA_SIMULADOR,
    filas,
    vacioMensaje: 'Sin subproductos calculados'
  });
}

function abrirVistaCapturaRendimientos() {
  if (vistaActiva === 'historial') {
    abrirVistaCapturaHistorial();
  } else if (vistaActiva === 'simulador') {
    abrirVistaCapturaSimulador();
  } else {
    abrirVistaCapturaComposiciones();
  }
}

function actualizarSubtabsActivos() {
  document.querySelectorAll('#rendimientos-subtabs .tab').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.tab === vistaActiva);
  });
}

function crearSubtabs() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  nav.id = 'rendimientos-subtabs';
  const definiciones = [
    { id: 'vigentes', nombre: 'Composiciones' },
    { id: 'historial', nombre: 'Historial' },
    { id: 'pendientes', nombre: 'Pendientes' },
    { id: 'simulador', nombre: 'Simulador de Lote' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === vistaActiva ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
    if (def.id === 'pendientes') {
      const insignia = document.createElement('span');
      insignia.id = 'rendimientos-pendientes-insignia';
      insignia.className = 'chip chip-warn';
      insignia.style.marginLeft = '0.4rem';
      insignia.style.padding = '0.1rem 0.5rem';
      boton.appendChild(insignia);
    }
    boton.addEventListener('click', () => {
      vistaActiva = def.id;
      actualizarSubtabsActivos();
      renderizarVistaActiva();
    });
    nav.appendChild(boton);
  });
  return nav;
}

// ── Vista: composiciones vigentes ────────────────────────────────────────

function crearVistaVigentes() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.id = 'rendimientos-vigentes-wrapper';
  return wrapper;
}

function llenarVistaVigentes() {
  const wrapper = document.getElementById('rendimientos-vigentes-wrapper');
  if (!wrapper) return;
  const filas = composicionVigentePorMaterial(window.EVE.composiciones, window.obtenerFechaMexico());
  wrapper.innerHTML = '';
  const resultadoPendientes = calcularPendientesActuales();
  actualizarInsigniaPendientes(resultadoPendientes);
  if (resultadoPendientes.filas.length > 0) {
    const chipPendientes = document.createElement('button');
    chipPendientes.type = 'button';
    chipPendientes.className = 'chip chip-warn';
    chipPendientes.style.border = 'none';
    chipPendientes.style.cursor = 'pointer';
    chipPendientes.style.marginBottom = '0.75rem';
    chipPendientes.textContent = `${resultadoPendientes.filas.length} materiales sin composición`;
    chipPendientes.title = 'Ver los materiales con tickets sin composición vigente';
    chipPendientes.addEventListener('click', () => {
      vistaActiva = 'pendientes';
      actualizarSubtabsActivos();
      renderizarVistaActiva();
    });
    wrapper.appendChild(chipPendientes);
  }
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="texto">Material</th><th>Componentes</th><th data-tipo="texto">Versión</th><th data-tipo="fecha">Vigente desde</th><th data-tipo="texto">Actualizado por</th><th></th></tr>
    </thead>
    <tbody id="rendimientos-vigentes-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  window.activarOrdenamiento(tabla);
  const tbody = tabla.querySelector('#rendimientos-vigentes-tabla');
  if (filas.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 6;
    celda.textContent = 'Sin composiciones registradas';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  const puedeEditar = puedeEditarRendimientos();
  filas.forEach((c) => {
    const fila = document.createElement('tr');
    const valores = [
      c.materialEntrada,
      `${c.componentes.length} componentes`,
      `v${c.version}`,
      window.formatearFecha(c.fechaVigencia),
      c.actualizadoPor || ''
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    const celdaAcciones = document.createElement('td');
    const botonVer = document.createElement('button');
    botonVer.textContent = 'Ver';
    botonVer.className = 'btn-secondary';
    botonVer.addEventListener('click', () => abrirModalDetalle(c));
    celdaAcciones.appendChild(botonVer);
    if (puedeEditar) {
      const botonEditar = document.createElement('button');
      botonEditar.textContent = 'Editar';
      botonEditar.className = 'btn-secondary';
      botonEditar.addEventListener('click', () => abrirModalComposicion(c.materialEntrada));
      celdaAcciones.appendChild(botonEditar);
    }
    const botonHistorial = document.createElement('button');
    botonHistorial.textContent = 'Historial';
    botonHistorial.className = 'btn-secondary';
    botonHistorial.addEventListener('click', () => {
      materialHistorialSeleccionado = c.materialEntrada;
      vistaActiva = 'historial';
      actualizarSubtabsActivos();
      renderizarVistaActiva();
    });
    celdaAcciones.appendChild(botonHistorial);
    if (puedeEditar && planificarDeshacerUltimaVersion(window.EVE.composiciones, c.materialEntrada).ok) {
      celdaAcciones.appendChild(crearBotonDeshacer(c.materialEntrada));
    }
    fila.appendChild(celdaAcciones);
    tbody.appendChild(fila);
  });
}

// ── Vista: composiciones pendientes ──────────────────────────────────────

// Tickets de Báscula de materiales crudos sin una composición vigente a su fecha (K20). Se recalcula cada vez
// que se dibuja, a partir de lo que hay en memoria.
function calcularPendientesActuales() {
  return window.EVE_RENDIMIENTOS.calcularComposicionesPendientes(window.EVE.registrosDestaraje || [], window.EVE.composiciones || []);
}

function actualizarInsigniaPendientes(resultado) {
  const insignia = document.getElementById('rendimientos-pendientes-insignia');
  if (!insignia) return;
  const cantidad = (resultado || calcularPendientesActuales()).filas.length;
  insignia.textContent = String(cantidad);
  insignia.className = 'chip ' + (cantidad > 0 ? 'chip-warn' : 'chip-ok');
}

function crearVistaPendientes() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.id = 'rendimientos-pendientes-wrapper';
  wrapper.style.display = 'none';
  return wrapper;
}

const ETIQUETA_TIPO_PENDIENTE = { SIN_COMPOSICION: 'Sin composición', COBERTURA_INCOMPLETA: 'Cobertura incompleta' };

function formatearKgPendientes(kg) {
  return `${Number(kg).toLocaleString('es-MX', { maximumFractionDigits: 2 })} kg`;
}

function llenarVistaPendientes() {
  const wrapper = document.getElementById('rendimientos-pendientes-wrapper');
  if (!wrapper) return;
  const resultado = calcularPendientesActuales();
  const { filas, noEvaluables } = resultado;
  wrapper.innerHTML = '';
  actualizarInsigniaPendientes(resultado);

  const totales = document.createElement('p');
  const kgPendientes = filas.reduce((suma, f) => suma + f.kgPendientes, 0);
  totales.textContent = `Materiales pendientes: ${filas.length} · Kg pendientes: ${formatearKgPendientes(kgPendientes)}`;
  totales.style.fontWeight = '600';
  wrapper.appendChild(totales);

  if (noEvaluables > 0) {
    const aviso = document.createElement('p');
    aviso.style.fontSize = '0.85em';
    aviso.style.color = '#666';
    aviso.textContent = `ℹ️ ${noEvaluables} ticket(s) de Báscula no se pudieron evaluar (sin material, sin fecha o con kg menor o igual a 0) y no se cuentan aquí.`;
    wrapper.appendChild(aviso);
  }

  if (filas.length === 0) {
    const vacio = document.createElement('p');
    vacio.textContent = 'No hay composiciones pendientes';
    wrapper.appendChild(vacio);
    return;
  }

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="texto">Material</th><th data-tipo="texto">Tipo</th><th data-tipo="numero">Kg pendientes</th><th data-tipo="numero">% de lo recibido</th><th data-tipo="numero">Tickets</th><th data-tipo="fecha">Primera fecha</th><th></th></tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  filas.forEach((f) => {
    const fila = document.createElement('tr');
    const porcentaje = f.kgTotalRecibidos > 0 ? (f.kgPendientes / f.kgTotalRecibidos) * 100 : 0;
    const celdaMaterial = document.createElement('td');
    celdaMaterial.textContent = f.material;
    fila.appendChild(celdaMaterial);
    const celdaTipo = document.createElement('td');
    celdaTipo.textContent = ETIQUETA_TIPO_PENDIENTE[f.tipo] || f.tipo;
    if (f.inconsistencia) {
      const chip = document.createElement('span');
      chip.className = 'chip chip-warn';
      chip.style.marginLeft = '0.4rem';
      chip.textContent = '⚠️ Más de una versión abierta';
      chip.title = 'Este material tiene más de una versión de composición sin cerrar: revisa el Historial';
      celdaTipo.appendChild(chip);
    }
    fila.appendChild(celdaTipo);
    [formatearKgPendientes(f.kgPendientes), `${porcentaje.toFixed(1)}%`, String(f.tickets), window.formatearFecha(f.primeraFecha)].forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    const celdaAcciones = document.createElement('td');
    if (puedeEditarRendimientos()) {
      const botonCapturar = document.createElement('button');
      botonCapturar.type = 'button';
      botonCapturar.className = 'btn-primary';
      botonCapturar.textContent = 'Capturar';
      botonCapturar.title = 'Capturar la composición de este material con vigencia desde su primer ticket';
      botonCapturar.addEventListener('click', () => {
        const sugerencia = calcularVigenciaSugerida(f.primeraFecha, composicionVigenteAbiertaPorMaterial(window.EVE.composiciones, f.material));
        abrirModalComposicion(f.material, { vigenciaSugerida: sugerencia.fecha, avisoVigencia: sugerencia.aviso });
      });
      celdaAcciones.appendChild(botonCapturar);
    }
    fila.appendChild(celdaAcciones);
    tbody.appendChild(fila);
  });
  wrapper.appendChild(tabla);
  window.activarOrdenamiento(tabla);
}

// ── Vista: historial de versiones ────────────────────────────────────────

function crearVistaHistorial() {
  const wrapper = document.createElement('div');
  wrapper.id = 'rendimientos-historial-wrapper';
  wrapper.style.display = 'none';

  const selectorCard = document.createElement('div');
  selectorCard.className = 'card';
  selectorCard.innerHTML = `
    <label class="admin-config-campo">
      Material
      <select id="rh-material"></select>
    </label>
  `;
  wrapper.appendChild(selectorCard);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.id = 'rendimientos-historial-tabla-wrapper';
  wrapper.appendChild(tablaWrapper);

  selectorCard.querySelector('#rh-material').addEventListener('change', (evento) => {
    materialHistorialSeleccionado = evento.target.value;
    llenarVistaHistorial();
  });

  return wrapper;
}

function llenarSelectorHistorial() {
  const select = document.getElementById('rh-material');
  if (!select) return;
  const materiales = materialesConComposicion(window.EVE.composiciones).sort();
  select.innerHTML = '<option value="">Selecciona un material…</option>';
  materiales.forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m;
    opcion.textContent = m;
    select.appendChild(opcion);
  });
  if (materialHistorialSeleccionado && materiales.includes(materialHistorialSeleccionado)) {
    select.value = materialHistorialSeleccionado;
  }
}

function llenarVistaHistorial() {
  const wrapper = document.getElementById('rendimientos-historial-tabla-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  if (!materialHistorialSeleccionado) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Selecciona un material para ver su historial de composiciones';
    wrapper.appendChild(mensaje);
    return;
  }
  const historial = historialPorMaterial(window.EVE.composiciones, materialHistorialSeleccionado, window.obtenerFechaMexico());
  if (puedeEditarRendimientos() && planificarDeshacerUltimaVersion(window.EVE.composiciones, materialHistorialSeleccionado).ok) {
    const barra = document.createElement('div');
    barra.style.marginBottom = '0.75rem';
    barra.appendChild(crearBotonDeshacer(materialHistorialSeleccionado));
    wrapper.appendChild(barra);
  }
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="texto">Versión</th><th data-tipo="fecha">Desde</th><th data-tipo="fecha">Hasta</th><th data-tipo="numero">Duración (días)</th><th>Motivo</th><th data-tipo="texto">Actualizado por</th><th></th></tr>
    </thead>
    <tbody id="rendimientos-historial-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  window.activarOrdenamiento(tabla);
  const tbody = tabla.querySelector('#rendimientos-historial-tabla');
  historial.forEach((c) => {
    const fila = document.createElement('tr');
    const valores = [
      `v${c.version}`,
      window.formatearFecha(c.fechaVigencia),
      c.fechaCierre ? window.formatearFecha(c.fechaCierre) : 'Vigente',
      String(c.duracionDias),
      c.motivo || '',
      c.actualizadoPor || ''
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    const celdaAccion = document.createElement('td');
    const boton = document.createElement('button');
    boton.textContent = 'Ver componentes';
    boton.className = 'btn-secondary';
    boton.addEventListener('click', () => abrirModalDetalle(c));
    celdaAccion.appendChild(boton);
    fila.appendChild(celdaAccion);
    tbody.appendChild(fila);
  });
}

// ── Vista: simulador de lote ──────────────────────────────────────────────

function crearVistaSimulador() {
  const wrapper = document.createElement('div');
  wrapper.id = 'rendimientos-simulador-wrapper';
  wrapper.style.display = 'none';

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="form-grid">
      <label class="admin-config-campo">
        Material
        <select id="rs-material"></select>
      </label>
      <label class="admin-config-campo">
        Cantidad (Kg)
        <input type="number" id="rs-cantidad" step="0.01" min="0">
      </label>
    </div>
    <button type="button" id="rs-calcular" class="btn-primary">Calcular</button>
    <div id="rs-resumen" style="margin:0.75rem 0"></div>
  `;
  wrapper.appendChild(card);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.id = 'rendimientos-simulador-tabla-wrapper';
  wrapper.appendChild(tablaWrapper);

  card.querySelector('#rs-calcular').addEventListener('click', calcularSimulacion);

  return wrapper;
}

function llenarSelectorSimulador() {
  const select = document.getElementById('rs-material');
  if (!select) return;
  const seleccionActual = select.value;
  const materiales = composicionVigentePorMaterial(window.EVE.composiciones, window.obtenerFechaMexico())
    .map((c) => c.materialEntrada)
    .sort();
  select.innerHTML = '<option value="">Selecciona un material…</option>';
  materiales.forEach((m) => {
    const opcion = document.createElement('option');
    opcion.value = m;
    opcion.textContent = m;
    select.appendChild(opcion);
  });
  if (materiales.includes(seleccionActual)) select.value = seleccionActual;
}

function calcularSimulacion() {
  const material = document.getElementById('rs-material').value;
  const cantidad = document.getElementById('rs-cantidad').value;
  const tablaWrapper = document.getElementById('rendimientos-simulador-tabla-wrapper');
  const resumenDiv = document.getElementById('rs-resumen');
  tablaWrapper.innerHTML = '';
  resumenDiv.innerHTML = '';
  if (!material) {
    window.showError('Selecciona un material');
    return;
  }
  const composicion = composicionVigenteParaMaterial(window.EVE.composiciones, material, window.obtenerFechaMexico());
  if (!composicion) {
    window.showError('No hay una composición vigente para ese material');
    return;
  }
  const filas = simularLote(composicion, cantidad);
  if (!filas.length) {
    ultimaSimulacion = null;
    window.showError('Ingresa una cantidad válida');
    return;
  }
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead><tr><th>Subproducto</th><th>Estimado (Kg)</th><th>Tipo</th><th>Proceso sugerido</th></tr></thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  filas.forEach((f) => {
    const fila = document.createElement('tr');
    const valores = [f.subproducto, `${f.estimado} Kg`, f.esMerma ? 'Merma' : 'Aprovechable', f.esMerma ? '—' : nombreProceso(f.procesoSugerido)];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
  tablaWrapper.appendChild(tabla);
  const resumen = resumenSimulacion(filas);
  [`Total aprovechable: ${resumen.aprovechable} Kg`, `Total merma: ${resumen.merma} Kg`].forEach((texto) => {
    const span = document.createElement('span');
    span.className = 'chip chip-info';
    span.style.marginRight = '0.5rem';
    span.textContent = texto;
    resumenDiv.appendChild(span);
  });
  ultimaSimulacion = { material, cantidad: Number(cantidad), filas, resumen };
}

// ── Orquestación de vistas ────────────────────────────────────────────────

function renderizarVistaActiva() {
  document.getElementById('rendimientos-vigentes-wrapper').style.display = vistaActiva === 'vigentes' ? '' : 'none';
  document.getElementById('rendimientos-historial-wrapper').style.display = vistaActiva === 'historial' ? '' : 'none';
  document.getElementById('rendimientos-pendientes-wrapper').style.display = vistaActiva === 'pendientes' ? '' : 'none';
  document.getElementById('rendimientos-simulador-wrapper').style.display = vistaActiva === 'simulador' ? '' : 'none';
  if (vistaActiva === 'vigentes') {
    llenarVistaVigentes();
  } else if (vistaActiva === 'historial') {
    llenarSelectorHistorial();
    llenarVistaHistorial();
  } else if (vistaActiva === 'pendientes') {
    llenarVistaPendientes();
  } else {
    llenarSelectorSimulador();
  }
  if (vistaActiva !== 'vigentes' && vistaActiva !== 'pendientes') actualizarInsigniaPendientes();
}

function renderRendimientos(container) {
  vistaActiva = 'vigentes';
  materialHistorialSeleccionado = '';

  container.appendChild(crearBarraAcciones());
  container.appendChild(crearSubtabs());
  container.appendChild(crearVistaVigentes());
  container.appendChild(crearVistaHistorial());
  container.appendChild(crearVistaPendientes());
  container.appendChild(crearVistaSimulador());
  if (puedeEditarRendimientos()) {
    container.appendChild(crearModalComposicion());
    container.appendChild(crearModalDeshacer());
  }
  container.appendChild(crearModalDetalle());

  renderizarVistaActiva();
}

window.EVE_MODULES.rendimientos = { render: renderRendimientos };

})();
