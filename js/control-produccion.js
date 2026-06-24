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

let editandoId = null;
let editandoTicket = null;
let tipoProcesoSeleccionado = null;
let tipoProcesoSeleccionadoEdicion = null;

function crearFilaInput(prefijo) {
  const fila = document.createElement('div');
  fila.className = 'cp-fila-input';
  const material = document.createElement('input');
  material.type = 'text';
  material.placeholder = 'Material';
  material.className = 'cp-fila-material';
  material.setAttribute('list', 'dl-cp-materiales');
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
  [material, kg, origen].forEach((campo) => campo.addEventListener('input', () => actualizarResumen(prefijo)));
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

function actualizarResumen(prefijo) {
  const inputs = leerInputsFormulario(prefijo);
  const totalInput = inputs.reduce((suma, i) => suma + (Number(i.kg) || 0), 0);
  const kgPrincipal = Number(document.getElementById(`${prefijo}-kg-principal`).value) || 0;
  const kgMerma = Number(document.getElementById(`${prefijo}-kg-merma`).value) || 0;
  const totalOutput = kgPrincipal + kgMerma;
  const eficiencia = calcularEficiencia(kgPrincipal, totalInput);
  const porcentajeMerma = calcularPorcentajeMerma(kgMerma, totalInput);
  const fechaInicio = document.getElementById(`${prefijo}-fecha-inicio`).value;
  const fechaFin = document.getElementById(`${prefijo}-fecha-fin`).value;
  let horasTrabajo = 0;
  if (fechaInicio && fechaFin) {
    const horas = calcularHorasTrabajo(fechaInicio, fechaFin);
    horasTrabajo = Number.isFinite(horas) && horas > 0 ? horas : 0;
  }
  const productividad = calcularProductividad(kgPrincipal, horasTrabajo);
  const color = colorEficiencia(eficiencia);
  const resumen = document.getElementById(`${prefijo}-resumen`);
  resumen.innerHTML = '';
  const agregarLinea = (texto, claseColor) => {
    const span = document.createElement('span');
    span.textContent = texto;
    if (claseColor) span.className = `cp-eficiencia-${claseColor}`;
    resumen.appendChild(span);
  };
  agregarLinea(`Total Input: ${totalInput.toLocaleString('es-MX')} kg`);
  agregarLinea(`Total Output: ${totalOutput.toLocaleString('es-MX')} kg`);
  agregarLinea(`Eficiencia: ${eficiencia.toFixed(2)}%`, color);
  agregarLinea(`% Merma: ${porcentajeMerma.toFixed(2)}%`);
  agregarLinea(`Horas Trabajo: ${horasTrabajo.toFixed(2)} h`);
  agregarLinea(`Productividad: ${productividad.toFixed(2)} kg/h`);
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
  const materiales = valoresUnicosLocal(
    window.EVE.registrosControlProduccion.flatMap((r) => [
      ...r.inputs.map((i) => i.material),
      r.outputs.principal.material
    ]),
    window.MATERIALES_COMUNES
  );
  const operadores = valoresUnicosLocal(window.EVE.registrosControlProduccion.map((r) => r.operador), []);
  const ticketsOrigen = [
    ...window.EVE.registrosDestaraje.map((r) => r.ticket),
    ...window.EVE.registrosControlProduccion.map((r) => r.ticket)
  ];
  llenarDatalist('dl-cp-materiales', materiales);
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
  const principal = document.getElementById('cp-material-principal');
  if (!principal.value) {
    principal.value = PROCESOS[tipo].outputPrincipal;
  }
}

function reiniciarFormulario() {
  document.getElementById('control-produccion-form').reset();
  tipoProcesoSeleccionado = null;
  document.querySelectorAll('.cp-proceso-boton').forEach((boton) => boton.classList.remove('active'));
  const lista = document.getElementById('cp-inputs-lista');
  lista.innerHTML = '';
  lista.appendChild(crearFilaInput('cp'));
  actualizarResumen('cp');
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    tipoProceso: tipoProcesoSeleccionado,
    inputs: leerInputsFormulario('cp'),
    materialPrincipal: document.getElementById('cp-material-principal').value.trim().toUpperCase(),
    kgPrincipal: document.getElementById('cp-kg-principal').value,
    kgMerma: document.getElementById('cp-kg-merma').value,
    operador: document.getElementById('cp-operador').value.trim().toUpperCase(),
    turno: document.getElementById('cp-turno').value,
    fechaInicio: document.getElementById('cp-fecha-inicio').value,
    fechaFin: document.getElementById('cp-fecha-fin').value,
    observaciones: document.getElementById('cp-observaciones').value.trim()
  };
  try {
    const registroSinTicket = construirRegistroDesdeFormulario(datos);
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
    <div class="form-grid">
      <input type="text" id="cp-material-principal" placeholder="Material principal" list="dl-cp-materiales" required>
      <input type="number" id="cp-kg-principal" placeholder="Kg principal" step="0.01" required>
      <input type="number" id="cp-kg-merma" placeholder="Kg merma" step="0.01" required>
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
    <datalist id="dl-cp-materiales"></datalist>
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
  ['cp-kg-principal', 'cp-kg-merma', 'cp-fecha-inicio', 'cp-fecha-fin'].forEach((id) => {
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
    materialPrincipal: document.getElementById('cpe-material-principal').value.trim().toUpperCase(),
    kgPrincipal: document.getElementById('cpe-kg-principal').value,
    kgMerma: document.getElementById('cpe-kg-merma').value,
    operador: document.getElementById('cpe-operador').value.trim().toUpperCase(),
    turno: document.getElementById('cpe-turno').value,
    fechaInicio: document.getElementById('cpe-fecha-inicio').value,
    fechaFin: document.getElementById('cpe-fecha-fin').value,
    observaciones: document.getElementById('cpe-observaciones').value.trim()
  };
  try {
    const registroSinTicket = construirRegistroDesdeFormulario(datos);
    const registro = { ticket: editandoTicket, ...registroSinTicket };
    await window.actualizarDato('control_produccion', editandoId, registro);
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
        <input type="text" id="cpe-material-principal" placeholder="Material principal" required>
        <input type="number" id="cpe-kg-principal" placeholder="Kg principal" step="0.01" required>
        <input type="number" id="cpe-kg-merma" placeholder="Kg merma" step="0.01" required>
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
  ['cpe-kg-principal', 'cpe-kg-merma', 'cpe-fecha-inicio', 'cpe-fecha-fin'].forEach((id) => {
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
    fila.querySelector('.cp-fila-material').value = input.material;
    fila.querySelector('.cp-fila-kg').value = input.kg;
    fila.querySelector('.cp-fila-origen').value = input.ticketOrigen || '';
    lista.appendChild(fila);
  });
  document.getElementById('cpe-material-principal').value = registro.outputs.principal.material;
  document.getElementById('cpe-kg-principal').value = registro.outputs.principal.kg;
  document.getElementById('cpe-kg-merma').value = registro.outputs.merma.kg;
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
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await window.eliminarDato('control_produccion', id);
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

Object.assign(window.EVE_CONTROL_PRODUCCION, {
  crearFormulario,
  crearModalEdicion,
  abrirModalEdicion,
  actualizarDatalists,
  confirmarEliminar
});

let tabActiva = 'hoy';
let filtros = { tipoProceso: '', operador: '', turno: '', desde: '', hasta: '' };

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
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

  [procesoSelect, turnoSelect, operadorInput, desdeInput, hastaInput].forEach((campo) => {
    div.appendChild(campo);
    campo.addEventListener('input', actualizarFiltrosDesdeUI);
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
      <tr><th>Ticket</th><th>Proceso</th><th>Operador</th><th>Turno</th><th>Total Input</th><th>Total Output</th><th>Eficiencia</th><th>F. Inicio</th><th>F. Fin</th><th></th></tr>
    </thead>
    <tbody id="control-produccion-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  return wrapper;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const valores = [
    registro.ticket,
    `${PROCESOS[registro.tipoProceso].icono} ${PROCESOS[registro.tipoProceso].nombre}`,
    registro.operador,
    registro.turno,
    `${registro.totalInput.toLocaleString('es-MX')} kg`,
    `${registro.totalOutput.toLocaleString('es-MX')} kg`,
    `${registro.eficiencia.toFixed(2)}%`,
    registro.fechaInicio,
    registro.fechaFin
  ];
  valores.forEach((valor, indice) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    if (indice === 6) celda.classList.add(`cp-eficiencia-${colorEficiencia(registro.eficiencia)}`);
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
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
    `Eficiencia Promedio: ${stats.eficienciaPromedio.toFixed(2)}%`
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
  vistaOperativa.appendChild(crearFormulario());
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
