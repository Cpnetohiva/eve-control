(function () {

// ── Datos ────────────────────────────────────────────────────────────────

function calcularStats(registros) {
  let total = 0;
  for (const r of registros) {
    total += (Number(r.montoBase) || 0) + (Number(r.iva) || 0);
  }
  return { totalRegistros: registros.length, total };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fecha === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fecha >= inicioSemana);
}

function filtrarPorMes(registros, inicioMes) {
  return registros.filter((r) => r.fecha >= inicioMes);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const beneficiario = (filtros.beneficiario || '').toLowerCase();
  const concepto = (filtros.concepto || '').toLowerCase();
  return registros.filter((r) => {
    if (beneficiario && !String(r.beneficiario || '').toLowerCase().includes(beneficiario)) return false;
    if (concepto && !String(r.concepto || '').toLowerCase().includes(concepto)) return false;
    if (!dentroDeRangoFecha(r.fecha, filtros.desde, filtros.hasta)) return false;
    return true;
  });
}

// Sin campo `total` persistido — se calcula al vuelo donde se necesite (montoBase + iva).
// El monto capturado se guarda siempre como montoBase con iva 0; el iva solo llega distinto de 0 cuando se edita un
// gasto antiguo que ya lo tenía y se conserva tal cual (ver manejarEnvioEdicion).
function construirGastoDesdeFormulario(datos) {
  if (!datos.fecha) {
    throw new Error('La fecha es obligatoria');
  }
  const montoBase = Number(datos.montoBase);
  if (!Number.isFinite(montoBase) || montoBase <= 0) {
    throw new Error('Monto base debe ser un número mayor a 0');
  }
  const iva = datos.iva === '' || datos.iva === undefined || datos.iva === null ? 0 : Number(datos.iva);
  if (!Number.isFinite(iva) || iva < 0) {
    throw new Error('IVA debe ser un número mayor o igual a 0');
  }
  return {
    montoBase,
    iva,
    concepto: (datos.concepto || '').trim(),
    beneficiario: (datos.beneficiario || '').trim(),
    fecha: datos.fecha,
    notas: (datos.notas || '').trim()
  };
}

window.EVE_GASTOS = {
  calcularStats,
  filtrarPorHoy,
  filtrarPorSemana,
  filtrarPorMes,
  aplicarFiltrosTodos,
  construirGastoDesdeFormulario
};

// ── UI ───────────────────────────────────────────────────────────────────

let tabActiva = 'hoy';
let filtros = { beneficiario: '', concepto: '', desde: '', hasta: '' };
let editandoId = null;

function usuarioActual() {
  return (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function insertarRegistroEnMemoria(registro) {
  window.EVE.gastos.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos) {
  const indice = window.EVE.gastos.findIndex((r) => r.id === id);
  if (indice !== -1) window.EVE.gastos[indice] = { ...window.EVE.gastos[indice], ...datos };
}

function eliminarRegistroEnMemoria(id) {
  const indice = window.EVE.gastos.findIndex((r) => r.id === id);
  if (indice !== -1) window.EVE.gastos.splice(indice, 1);
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    montoBase: document.getElementById('ga-monto-base').value,
    iva: 0,
    concepto: document.getElementById('ga-concepto').value,
    beneficiario: document.getElementById('ga-beneficiario').value,
    fecha: document.getElementById('ga-fecha').value,
    notas: document.getElementById('ga-notas').value
  };
  try {
    const gasto = construirGastoDesdeFormulario(datos);
    gasto.creadoPor = usuarioActual();
    const id = await window.guardarDato('gastos', gasto);
    insertarRegistroEnMemoria({ id, ...gasto, fechaRegistro: new Date().toISOString() });
    document.getElementById('gastos-form').reset();
    document.getElementById('ga-fecha').value = window.obtenerFechaMexico();
    renderizarVista();
    window.showSuccess('Gasto guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'gastos-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-grid">
      <input type="date" id="ga-fecha" required>
      <input type="text" id="ga-beneficiario" placeholder="Beneficiario (opcional)">
      <input type="text" id="ga-concepto" placeholder="Concepto (opcional)">
      <input type="number" id="ga-monto-base" placeholder="Monto" step="0.01" required>
      <input type="text" id="ga-notas" placeholder="Notas (opcional)">
    </div>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelector('#ga-fecha').value = window.obtenerFechaMexico();
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const anterior = window.EVE.gastos.find((r) => r.id === editandoId);
  // Un gasto que ya tenía IVA conserva su iva y su montoBase tal cual (solo lectura); el resto se guarda con iva 0.
  const conservaIva = tieneIvaGuardado(anterior);
  const datos = {
    montoBase: conservaIva ? anterior.montoBase : document.getElementById('gae-monto-base').value,
    iva: conservaIva ? anterior.iva : 0,
    concepto: document.getElementById('gae-concepto').value,
    beneficiario: document.getElementById('gae-beneficiario').value,
    fecha: document.getElementById('gae-fecha').value,
    notas: document.getElementById('gae-notas').value
  };
  const motivo = document.getElementById('gae-motivo').value.trim();
  try {
    const gasto = construirGastoDesdeFormulario(datos);
    await window.actualizarDato('gastos', editandoId, gasto);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'gastos',
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior
        ? { montoBase: anterior.montoBase, iva: anterior.iva, concepto: anterior.concepto, beneficiario: anterior.beneficiario, fecha: anterior.fecha, notas: anterior.notas }
        : null,
      valorNuevo: gasto,
      motivo
    });
    document.getElementById('gae-motivo').value = '';
    reemplazarRegistroEnMemoria(editandoId, gasto);
    cerrarModalEdicion();
    renderizarVista();
    window.showSuccess('Gasto actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function tieneIvaGuardado(gasto) {
  return !!gasto && Number(gasto.iva) > 0;
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'gastos-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar gasto</h3>
      <form id="gastos-edit-form">
        <input type="date" id="gae-fecha" required>
        <input type="text" id="gae-beneficiario" placeholder="Beneficiario (opcional)">
        <input type="text" id="gae-concepto" placeholder="Concepto (opcional)">
        <input type="number" id="gae-monto-base" placeholder="Monto" step="0.01" required>
        <input type="text" id="gae-iva-lectura" placeholder="IVA" title="IVA capturado antes; se conserva y no se puede editar" disabled style="display:none">
        <input type="text" id="gae-total" placeholder="Total" disabled style="display:none">
        <input type="text" id="gae-notas" placeholder="Notas (opcional)">
        <textarea id="gae-motivo" placeholder="Motivo del cambio (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="gae-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#gastos-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#gae-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  const conservaIva = tieneIvaGuardado(registro);
  const inputMontoBase = document.getElementById('gae-monto-base');
  inputMontoBase.value = registro.montoBase;
  inputMontoBase.disabled = conservaIva;
  inputMontoBase.title = conservaIva ? 'Este gasto ya tenía IVA: su monto base se conserva y no se puede editar' : '';
  const inputIvaLectura = document.getElementById('gae-iva-lectura');
  const inputTotal = document.getElementById('gae-total');
  inputIvaLectura.style.display = conservaIva ? '' : 'none';
  inputTotal.style.display = conservaIva ? '' : 'none';
  inputIvaLectura.value = conservaIva ? `IVA ${window.formatearMoneda(registro.iva)}` : '';
  inputTotal.value = conservaIva ? `Total ${window.formatearMoneda((Number(registro.montoBase) || 0) + (Number(registro.iva) || 0))}` : '';
  document.getElementById('gae-concepto').value = registro.concepto || '';
  document.getElementById('gae-beneficiario').value = registro.beneficiario || '';
  document.getElementById('gae-fecha').value = registro.fecha;
  document.getElementById('gae-notas').value = registro.notas || '';
  document.getElementById('gastos-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('gastos-modal-overlay').classList.remove('open');
  editandoId = null;
}

// Un gasto no tiene vínculos con otros módulos (sin abonos, sin estado) —
// eliminar/editar no requiere guard de integridad, a diferencia de Pagos/Ventas.
async function confirmarEliminar(id) {
  const registro = window.EVE.gastos.find((r) => r.id === id);
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato('gastos', id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'gastos',
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: registro
        ? { montoBase: registro.montoBase, iva: registro.iva, concepto: registro.concepto, beneficiario: registro.beneficiario, fecha: registro.fecha, notas: registro.notas }
        : null,
      valorNuevo: null,
      motivo
    });
    eliminarRegistroEnMemoria(id);
    renderizarVista();
    window.showSuccess('Gasto eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' }
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

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'gastos-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';

  const campoBeneficiario = document.createElement('label');
  campoBeneficiario.className = 'filtro-campo';
  campoBeneficiario.innerHTML = '<span>Beneficiario</span>';
  const inputBeneficiario = document.createElement('input');
  inputBeneficiario.type = 'text';
  inputBeneficiario.id = 'gaf-beneficiario';
  inputBeneficiario.placeholder = 'Beneficiario';
  campoBeneficiario.appendChild(inputBeneficiario);

  const campoConcepto = document.createElement('label');
  campoConcepto.className = 'filtro-campo';
  campoConcepto.innerHTML = '<span>Concepto</span>';
  const inputConcepto = document.createElement('input');
  inputConcepto.type = 'text';
  inputConcepto.id = 'gaf-concepto';
  inputConcepto.placeholder = 'Concepto';
  campoConcepto.appendChild(inputConcepto);

  const campoDesde = document.createElement('label');
  campoDesde.className = 'filtro-campo';
  campoDesde.innerHTML = '<span>Desde</span>';
  const inputDesde = document.createElement('input');
  inputDesde.type = 'date';
  inputDesde.id = 'gaf-desde';
  campoDesde.appendChild(inputDesde);

  const campoHasta = document.createElement('label');
  campoHasta.className = 'filtro-campo';
  campoHasta.innerHTML = '<span>Hasta</span>';
  const inputHasta = document.createElement('input');
  inputHasta.type = 'date';
  inputHasta.id = 'gaf-hasta';
  campoHasta.appendChild(inputHasta);

  const actualizarFiltros = () => {
    filtros = {
      beneficiario: inputBeneficiario.value,
      concepto: inputConcepto.value,
      desde: inputDesde.value,
      hasta: inputHasta.value
    };
    renderizarVista();
  };
  inputBeneficiario.addEventListener('input', actualizarFiltros);
  inputConcepto.addEventListener('input', actualizarFiltros);
  inputDesde.addEventListener('input', actualizarFiltros);
  inputHasta.addEventListener('input', actualizarFiltros);

  div.appendChild(campoBeneficiario);
  div.appendChild(campoConcepto);
  div.appendChild(campoDesde);
  div.appendChild(campoHasta);
  return div;
}

function crearTabla() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Beneficiario</th><th data-tipo="texto">Concepto</th><th data-tipo="moneda">Monto Base</th><th data-tipo="moneda">Total</th><th data-tipo="texto">Notas</th><th></th></tr>
    </thead>
    <tbody id="gastos-tabla"></tbody>
  `;
  window.activarOrdenamiento(tabla);
  wrapper.appendChild(tabla);
  return wrapper;
}

function construirFilaTabla(registro) {
  const fila = document.createElement('tr');
  const total = (Number(registro.montoBase) || 0) + (Number(registro.iva) || 0);
  const valores = [
    registro.fecha,
    registro.beneficiario || '',
    registro.concepto || '',
    window.formatearMoneda(registro.montoBase),
    window.formatearMoneda(total),
    registro.notas || ''
  ];
  valores.forEach((valor) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
  if (window.puedeEscribir('gastos')) {
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
  const tbody = document.getElementById('gastos-tabla');
  tbody.innerHTML = '';
  if (registros.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 7;
    celda.textContent = 'Sin registros';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  registros.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1)).forEach((registro) => tbody.appendChild(construirFilaTabla(registro)));
}

function obtenerRegistrosParaTab() {
  let registros = window.EVE.gastos || [];
  if (tabActiva === 'hoy') {
    registros = filtrarPorHoy(registros, window.obtenerFechaMexico());
  } else if (tabActiva === 'semana') {
    registros = filtrarPorSemana(registros, window.obtenerInicioSemana());
  } else if (tabActiva === 'mes') {
    registros = filtrarPorMes(registros, window.obtenerInicioMes());
  } else {
    registros = aplicarFiltrosTodos(registros, filtros);
  }
  return registros;
}

function renderizarStats(registros) {
  const stats = calcularStats(registros);
  const contenedor = document.getElementById('gastos-stats');
  contenedor.innerHTML = '';
  const partes = [
    `Registros: ${stats.totalRegistros}`,
    `Total General: ${window.formatearMoneda(stats.total)}`
  ];
  partes.forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function renderizarVista() {
  document.getElementById('gastos-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const registros = obtenerRegistrosParaTab();
  renderizarStats(registros);
  llenarTabla(registros);
}

function crearStats() {
  const div = document.createElement('div');
  div.id = 'gastos-stats';
  div.className = 'card destaraje-stats';
  return div;
}

// ===== Vista para captura =====

const COLUMNAS_CAPTURA_GASTOS = [
  { clave: 'fecha', etiqueta: 'Fecha', ancho: '16%', truncar: true, formato: (valor) => window.formatearFecha(valor) },
  { clave: 'beneficiario', etiqueta: 'Beneficiario', ancho: '26%', truncar: false },
  { clave: 'concepto', etiqueta: 'Concepto', ancho: '26%', truncar: false },
  { clave: 'montoBase', etiqueta: 'Monto Base', ancho: '16%', alineacion: 'right', truncar: true, formato: (valor) => window.formatearMoneda(valor) },
  {
    clave: 'total', etiqueta: 'Total', ancho: '16%', alineacion: 'right', truncar: true,
    formato: (valor, fila) => window.formatearMoneda((Number(fila.montoBase) || 0) + (Number(fila.iva) || 0))
  }
];

function construirEtiquetaPeriodoCapturaGastos(tabId) {
  const nombres = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes', todos: 'Todos' };
  const { desde, hasta } = window.obtenerRangoYEtiqueta(tabId, filtros);
  if (!desde && !hasta) return nombres[tabId] || 'Todos';
  const rango = desde === hasta ? window.formatearFecha(desde) : `${desde ? window.formatearFecha(desde) : '…'} al ${hasta ? window.formatearFecha(hasta) : '…'}`;
  return `${nombres[tabId] || 'Todos'} · ${rango}`;
}

function construirResumenBeneficiarioCapturaGastos(registros) {
  const mapa = new Map();
  registros.forEach((registro) => {
    const total = (Number(registro.montoBase) || 0) + (Number(registro.iva) || 0);
    const clave = registro.beneficiario || '(sin beneficiario)';
    mapa.set(clave, (mapa.get(clave) || 0) + total);
  });
  return Array.from(mapa.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([beneficiario, total]) => ({ label: beneficiario, valor: window.formatearMoneda(total) }));
}

function abrirVistaCapturaGastos() {
  const registros = obtenerRegistrosParaTab().slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  const hayRegistros = registros.length > 0;
  const sinTabla = registros.length > 60;
  const stats = calcularStats(registros);
  const base = registros.reduce((suma, r) => suma + (Number(r.montoBase) || 0), 0);

  window.VistaCaptura.abrir({
    titulo: 'Gastos',
    periodo: construirEtiquetaPeriodoCapturaGastos(tabActiva),
    kpis: hayRegistros ? [
      { label: 'Registros', valor: stats.totalRegistros.toLocaleString('es-MX') },
      { label: 'Base', valor: window.formatearMoneda(base) },
      { label: 'Total General', valor: window.formatearMoneda(stats.total) }
    ] : undefined,
    resumenTitulo: 'Total por beneficiario',
    resumenFilas: hayRegistros ? construirResumenBeneficiarioCapturaGastos(registros) : undefined,
    resumenEtiquetaLabel: 'Beneficiario',
    resumenEtiquetaValor: 'Total',
    columnas: COLUMNAS_CAPTURA_GASTOS,
    filas: (hayRegistros && !sinTabla) ? registros : undefined,
    sinTabla: hayRegistros && sinTabla,
    notaSinTabla: 'Lista completa disponible en pantalla',
    vacioMensaje: 'Sin registros en este periodo'
  });
}

function crearBarraCapturaGastos() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const boton = document.createElement('button');
  boton.id = 'btn-vista-captura-gastos';
  boton.textContent = 'Vista para captura';
  boton.className = 'btn-secondary';
  boton.addEventListener('click', abrirVistaCapturaGastos);
  div.appendChild(boton);
  return div;
}

function renderGastos(container) {
  tabActiva = 'hoy';
  filtros = { beneficiario: '', concepto: '', desde: '', hasta: '' };
  editandoId = null;

  if (window.puedeEscribir('gastos')) container.appendChild(crearFormulario());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearStats());
  container.appendChild(crearBarraCapturaGastos());
  container.appendChild(crearTabla());
  container.appendChild(crearModalEdicion());

  renderizarVista();
}

window.EVE_MODULES.gastos = { render: renderGastos };

})();
