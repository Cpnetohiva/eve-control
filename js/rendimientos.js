(function () {

// ── Funciones puras ─────────────────────────────────────────────────────

function composicionVigentePorMaterial(composiciones, hoy) {
  const mapa = new Map();
  composiciones.forEach((c) => {
    if (c.fechaVigencia > hoy) return;
    if (c.fechaCierre !== null && c.fechaCierre !== undefined && c.fechaCierre < hoy) return;
    const actual = mapa.get(c.materialEntrada);
    if (!actual || c.fechaVigencia > actual.fechaVigencia) {
      mapa.set(c.materialEntrada, c);
    }
  });
  return Array.from(mapa.values()).sort((a, b) => a.materialEntrada.localeCompare(b.materialEntrada));
}

function composicionVigenteParaMaterial(composiciones, material, hoy) {
  return composicionVigentePorMaterial(composiciones, hoy).find((c) => c.materialEntrada === material) || null;
}

function composicionVigenteAbiertaPorMaterial(composiciones, material) {
  return composiciones.find((c) => c.materialEntrada === material && (c.fechaCierre === null || c.fechaCierre === undefined)) || null;
}

function materialesConComposicion(composiciones) {
  const set = new Set();
  composiciones.forEach((c) => set.add(c.materialEntrada));
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

function construirNuevaComposicion(datos, composicionAnteriorVigente) {
  const materialEntrada = (datos.materialEntrada || '').toString().trim().toUpperCase();
  if (!materialEntrada) {
    throw new Error('El material de entrada es obligatorio');
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
  return composiciones
    .filter((c) => c.materialEntrada === material)
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
  construirNuevaComposicion,
  historialPorMaterial,
  simularLote,
  resumenSimulacion,
  procesosDisponibles
};

// ── Estado del módulo ────────────────────────────────────────────────────

let vistaActiva = 'vigentes';
let materialHistorialSeleccionado = '';
let gestorComponentesModal = null;

function puedeEditarRendimientos() {
  const permisos = window.EVE.currentUser && window.EVE.currentUser.permissions;
  return !!(permisos && permisos.rendimientos_editar);
}

// ── Editor de componentes (filas dinámicas) ─────────────────────────────

function crearFilaComponente(componente, procesos) {
  const fila = document.createElement('div');
  fila.className = 'componente-fila';

  const inputSubproducto = document.createElement('input');
  inputSubproducto.type = 'text';
  inputSubproducto.className = 'cf-subproducto';
  inputSubproducto.placeholder = 'Subproducto';
  inputSubproducto.value = componente.subproducto || '';

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
  const set = new Set(window.MATERIALES_COMUNES);
  window.EVE.composiciones.forEach((c) => set.add(c.materialEntrada));
  return Array.from(set).sort();
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
  overlay.querySelector('#rd-fecha').addEventListener('change', mostrarAvisoComposicionAnterior);
  overlay.querySelector('#rendimientos-form').addEventListener('submit', manejarEnvioComposicion);
  overlay.querySelector('#rd-cancelar').addEventListener('click', () => cerrarModalComposicion());
  return overlay;
}

function abrirModalComposicion(materialPrefill) {
  document.getElementById('rendimientos-form').reset();
  document.getElementById('rd-fecha').value = window.obtenerFechaMexico();
  gestorComponentesModal.limpiar();
  llenarDatalistMaterialesRendimientos();
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
  document.getElementById('rendimientos-modal-overlay').classList.add('open');
}

function cerrarModalComposicion() {
  document.getElementById('rendimientos-modal-overlay').classList.remove('open');
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
  return div;
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
    { id: 'simulador', nombre: 'Simulador de Lote' }
  ];
  definiciones.forEach((def) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (def.id === vistaActiva ? ' active' : '');
    boton.textContent = def.nombre;
    boton.dataset.tab = def.id;
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
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Material</th><th>Componentes</th><th>Versión</th><th>Vigente desde</th><th>Actualizado por</th><th></th></tr>
    </thead>
    <tbody id="rendimientos-vigentes-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
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
    fila.appendChild(celdaAcciones);
    tbody.appendChild(fila);
  });
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
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Versión</th><th>Desde</th><th>Hasta</th><th>Duración (días)</th><th>Motivo</th><th>Actualizado por</th><th></th></tr>
    </thead>
    <tbody id="rendimientos-historial-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
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
}

// ── Orquestación de vistas ────────────────────────────────────────────────

function renderizarVistaActiva() {
  document.getElementById('rendimientos-vigentes-wrapper').style.display = vistaActiva === 'vigentes' ? '' : 'none';
  document.getElementById('rendimientos-historial-wrapper').style.display = vistaActiva === 'historial' ? '' : 'none';
  document.getElementById('rendimientos-simulador-wrapper').style.display = vistaActiva === 'simulador' ? '' : 'none';
  if (vistaActiva === 'vigentes') {
    llenarVistaVigentes();
  } else if (vistaActiva === 'historial') {
    llenarSelectorHistorial();
    llenarVistaHistorial();
  } else {
    llenarSelectorSimulador();
  }
}

function renderRendimientos(container) {
  vistaActiva = 'vigentes';
  materialHistorialSeleccionado = '';

  container.appendChild(crearBarraAcciones());
  container.appendChild(crearSubtabs());
  container.appendChild(crearVistaVigentes());
  container.appendChild(crearVistaHistorial());
  container.appendChild(crearVistaSimulador());
  if (puedeEditarRendimientos()) {
    container.appendChild(crearModalComposicion());
  }
  container.appendChild(crearModalDetalle());

  renderizarVistaActiva();
}

window.EVE_MODULES.rendimientos = { render: renderRendimientos };

})();
