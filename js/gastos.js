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

// Deriva Monto Base e IVA a partir de un Monto Total Pagado, asumiendo
// IVA del 16% incluido en el total (montoBase = total / 1.16). El IVA se
// calcula como el residuo (total - base), no como total*0.16/1.16, para
// garantizar que base + iva === total exacto en los 2 decimales mostrados.
function calcularBaseIvaDesdeTotal(totalPagado) {
  const total = Number(totalPagado) || 0;
  const base = Math.round((total / 1.16) * 100) / 100;
  const iva = Math.round((total - base) * 100) / 100;
  return { base, iva };
}

// Sin campo `total` persistido — se calcula al vuelo donde se necesite.
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
  calcularBaseIvaDesdeTotal,
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
    iva: document.getElementById('ga-iva').value,
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
    document.getElementById('ga-total').value = '';
    alternarModoIvaFormulario();
    renderizarVista();
    window.showSuccess('Gasto guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function actualizarTotalFormulario() {
  const montoBase = Number(document.getElementById('ga-monto-base').value) || 0;
  const iva = Number(document.getElementById('ga-iva').value) || 0;
  document.getElementById('ga-total').value = window.formatearMoneda(montoBase + iva);
}

function alternarModoIvaFormulario() {
  const auto = document.getElementById('ga-iva-auto').checked;
  const inputMontoBase = document.getElementById('ga-monto-base');
  const inputIva = document.getElementById('ga-iva');
  const inputTotalPagado = document.getElementById('ga-total-pagado');
  inputMontoBase.style.display = auto ? 'none' : '';
  inputIva.style.display = auto ? 'none' : '';
  inputTotalPagado.style.display = auto ? '' : 'none';
  inputMontoBase.required = !auto;
  inputTotalPagado.required = auto;
}

function manejarTotalPagadoFormulario() {
  const { base, iva } = calcularBaseIvaDesdeTotal(document.getElementById('ga-total-pagado').value);
  document.getElementById('ga-monto-base').value = base;
  document.getElementById('ga-iva').value = iva;
  actualizarTotalFormulario();
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
      <label class="admin-usuarios-permiso"><input type="checkbox" id="ga-iva-auto"> Calcular IVA automático (16%)</label>
      <input type="number" id="ga-monto-base" placeholder="Monto Base" step="0.01" required>
      <input type="number" id="ga-iva" placeholder="IVA (opcional)" step="0.01">
      <input type="number" id="ga-total-pagado" placeholder="Monto Total Pagado" step="0.01" style="display:none">
      <input type="text" id="ga-total" placeholder="Total" disabled>
      <input type="text" id="ga-notas" placeholder="Notas (opcional)">
    </div>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelector('#ga-fecha').value = window.obtenerFechaMexico();
  form.querySelector('#ga-monto-base').addEventListener('input', actualizarTotalFormulario);
  form.querySelector('#ga-iva').addEventListener('input', actualizarTotalFormulario);
  form.querySelector('#ga-iva-auto').addEventListener('change', alternarModoIvaFormulario);
  form.querySelector('#ga-total-pagado').addEventListener('input', manejarTotalPagadoFormulario);
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    montoBase: document.getElementById('gae-monto-base').value,
    iva: document.getElementById('gae-iva').value,
    concepto: document.getElementById('gae-concepto').value,
    beneficiario: document.getElementById('gae-beneficiario').value,
    fecha: document.getElementById('gae-fecha').value,
    notas: document.getElementById('gae-notas').value
  };
  const anterior = window.EVE.gastos.find((r) => r.id === editandoId);
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

function actualizarTotalFormularioEdicion() {
  const montoBase = Number(document.getElementById('gae-monto-base').value) || 0;
  const iva = Number(document.getElementById('gae-iva').value) || 0;
  document.getElementById('gae-total').value = window.formatearMoneda(montoBase + iva);
}

function alternarModoIvaEdicion() {
  const auto = document.getElementById('gae-iva-auto').checked;
  const inputMontoBase = document.getElementById('gae-monto-base');
  const inputIva = document.getElementById('gae-iva');
  const inputTotalPagado = document.getElementById('gae-total-pagado');
  inputMontoBase.style.display = auto ? 'none' : '';
  inputIva.style.display = auto ? 'none' : '';
  inputTotalPagado.style.display = auto ? '' : 'none';
  inputMontoBase.required = !auto;
  inputTotalPagado.required = auto;
}

function manejarTotalPagadoEdicion() {
  const { base, iva } = calcularBaseIvaDesdeTotal(document.getElementById('gae-total-pagado').value);
  document.getElementById('gae-monto-base').value = base;
  document.getElementById('gae-iva').value = iva;
  actualizarTotalFormularioEdicion();
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
        <label class="admin-usuarios-permiso"><input type="checkbox" id="gae-iva-auto"> Calcular IVA automático (16%)</label>
        <input type="number" id="gae-monto-base" placeholder="Monto Base" step="0.01" required>
        <input type="number" id="gae-iva" placeholder="IVA (opcional)" step="0.01">
        <input type="number" id="gae-total-pagado" placeholder="Monto Total Pagado" step="0.01" style="display:none">
        <input type="text" id="gae-total" placeholder="Total" disabled>
        <input type="text" id="gae-notas" placeholder="Notas (opcional)">
        <textarea id="gae-motivo" placeholder="Motivo del cambio (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="gae-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#gae-monto-base').addEventListener('input', actualizarTotalFormularioEdicion);
  overlay.querySelector('#gae-iva').addEventListener('input', actualizarTotalFormularioEdicion);
  overlay.querySelector('#gae-iva-auto').addEventListener('change', alternarModoIvaEdicion);
  overlay.querySelector('#gae-total-pagado').addEventListener('input', manejarTotalPagadoEdicion);
  overlay.querySelector('#gastos-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#gae-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('gae-monto-base').value = registro.montoBase;
  document.getElementById('gae-iva').value = registro.iva || 0;
  document.getElementById('gae-concepto').value = registro.concepto || '';
  document.getElementById('gae-beneficiario').value = registro.beneficiario || '';
  document.getElementById('gae-fecha').value = registro.fecha;
  document.getElementById('gae-notas').value = registro.notas || '';
  document.getElementById('gae-iva-auto').checked = false;
  document.getElementById('gae-total-pagado').value = '';
  alternarModoIvaEdicion();
  actualizarTotalFormularioEdicion();
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
      <tr><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Beneficiario</th><th data-tipo="texto">Concepto</th><th data-tipo="moneda">Monto Base</th><th data-tipo="moneda">IVA</th><th data-tipo="moneda">Total</th><th data-tipo="texto">Notas</th><th></th></tr>
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
    window.formatearMoneda(registro.iva || 0),
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
    celda.colSpan = 8;
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

function renderGastos(container) {
  tabActiva = 'hoy';
  filtros = { beneficiario: '', concepto: '', desde: '', hasta: '' };
  editandoId = null;

  if (window.puedeEscribir('gastos')) container.appendChild(crearFormulario());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearStats());
  container.appendChild(crearTabla());
  container.appendChild(crearModalEdicion());

  renderizarVista();
}

window.EVE_MODULES.gastos = { render: renderGastos };

})();
