(function () {

const MODULOS_BORRABLES = {
  destaraje: { nombre: 'Destaraje', coleccion: 'destaraje', campoFecha: 'fechaSalida' },
  produccion: { nombre: 'Producción', coleccion: 'produccion', campoFecha: 'fechaSalida' },
  pagos: { nombre: 'Pagos', coleccion: 'pagos', campoFecha: 'fecha' },
  ministraciones: { nombre: 'Ministraciones', coleccion: 'ministraciones', campoFecha: 'fecha' },
  controlProduccion: { nombre: 'Control de Producción', coleccion: 'control_produccion', campoFecha: 'fechaFin' }
};

function obtenerRegistrosModulo(clave) {
  if (clave === 'destaraje') return [...(window.EVE.registrosDestaraje || []), ...(window.EVE.registrosVentas || [])];
  if (clave === 'produccion') return window.EVE.registrosProduccion || [];
  if (clave === 'pagos') return window.EVE.registrosPagos || [];
  if (clave === 'ministraciones') return window.EVE.registrosMinistraciones || [];
  if (clave === 'controlProduccion') return window.EVE.registrosControlProduccion || [];
  return [];
}

function normalizarFechaISO(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') return valor.substring(0, 10);
  if (typeof valor.toDate === 'function') return valor.toDate().toISOString().substring(0, 10);
  if (valor instanceof Date) return valor.toISOString().substring(0, 10);
  return String(valor).substring(0, 10);
}

function filtrarPorRango(registros, campoFecha, desde, hasta) {
  if (!desde && !hasta) return registros;
  return registros.filter((registro) => {
    const fechaISO = normalizarFechaISO(registro[campoFecha]);
    if (!fechaISO) return false;
    if (desde && fechaISO < desde) return false;
    if (hasta && fechaISO > hasta) return false;
    return true;
  });
}

function calcularVistaPrevia(clave, desde, hasta) {
  const modulo = MODULOS_BORRABLES[clave];
  if (!modulo) return 0;
  return filtrarPorRango(obtenerRegistrosModulo(clave), modulo.campoFecha, desde, hasta).length;
}

function calcularVistaPreviaTodos() {
  const desglose = {};
  let total = 0;
  Object.entries(MODULOS_BORRABLES).forEach(([clave, modulo]) => {
    const conteo = obtenerRegistrosModulo(clave).length;
    desglose[clave] = { nombre: modulo.nombre, conteo };
    total += conteo;
  });
  return { desglose, total };
}

function esConfirmarValido(texto) {
  return texto === 'CONFIRMAR';
}

window.EVE_ADMIN_DATOS = {
  calcularVistaPrevia,
  calcularVistaPreviaTodos,
  filtrarPorRango,
  esConfirmarValido
};

async function ejecutarBorradoEnLotes(coleccion, ids) {
  const TAMANO_LOTE = 500;
  for (let inicio = 0; inicio < ids.length; inicio += TAMANO_LOTE) {
    const grupo = ids.slice(inicio, inicio + TAMANO_LOTE);
    const lote = window.db.batch();
    grupo.forEach((id) => {
      lote.delete(window.db.collection(coleccion).doc(id));
    });
    await lote.commit();
  }
}

let vistaPrevia = null;

function el(id) {
  return document.getElementById(id);
}

function invalidarVistaPrevia() {
  vistaPrevia = null;
  const prev = el('ad-vista-previa');
  if (prev) prev.innerHTML = '';
  const seccionCheckbox = el('ad-seccion-checkbox');
  if (seccionCheckbox) seccionCheckbox.style.display = 'none';
  actualizarBotonEliminar();
}

function actualizarBotonEliminar() {
  const boton = el('ad-btn-eliminar');
  if (!boton) return;
  if (!vistaPrevia) {
    boton.style.display = 'none';
    return;
  }
  const confirmarValido = esConfirmarValido((el('ad-confirmar-texto') || {}).value || '');
  const conteo = vistaPrevia.tipo === 'todos' ? vistaPrevia.total : vistaPrevia.conteo;
  boton.textContent = `\u{1F5D1}️ Eliminar ${conteo} registros`;
  boton.style.display = '';
  if (vistaPrevia.tipo === 'todos') {
    const checkboxValido = !!(el('ad-checkbox-confirmar') && el('ad-checkbox-confirmar').checked);
    boton.disabled = !confirmarValido || !checkboxValido;
  } else {
    boton.disabled = !confirmarValido;
  }
}

function manejarVerCuantos() {
  const clave = (el('ad-selector-modulo') || {}).value || '';
  if (!clave) return;

  if (clave === 'todos') {
    const { desglose, total } = calcularVistaPreviaTodos();
    vistaPrevia = { tipo: 'todos', desglose, total };
    const lineas = Object.values(desglose).map((m) => `${m.nombre}: ${m.conteo}`).join(', ');
    const prev = el('ad-vista-previa');
    if (prev) prev.innerHTML = `<p class="ad-vista-previa-texto">${lineas} — Total: ${total}</p>`;
    const seccionCheckbox = el('ad-seccion-checkbox');
    if (seccionCheckbox) seccionCheckbox.style.display = '';
  } else if (MODULOS_BORRABLES[clave]) {
    const desde = (el('ad-fecha-desde') || {}).value || '';
    const hasta = (el('ad-fecha-hasta') || {}).value || '';
    const conteo = calcularVistaPrevia(clave, desde, hasta);
    vistaPrevia = { tipo: 'modulo', clave, conteo };
    const prev = el('ad-vista-previa');
    if (prev) prev.innerHTML = `<p class="ad-vista-previa-texto">Se eliminarán ${conteo} registros</p>`;
  }
  actualizarBotonEliminar();
}

async function manejarEliminar() {
  const boton = el('ad-btn-eliminar');
  if (!vistaPrevia || !boton) return;
  boton.disabled = true;
  try {
    let totalEliminados = 0;
    if (vistaPrevia.tipo === 'todos') {
      for (const [clave, modulo] of Object.entries(MODULOS_BORRABLES)) {
        const registros = obtenerRegistrosModulo(clave);
        const ids = registros.map((r) => r.id).filter(Boolean);
        if (ids.length > 0) {
          await ejecutarBorradoEnLotes(modulo.coleccion, ids);
          totalEliminados += ids.length;
        }
      }
    } else {
      const modulo = MODULOS_BORRABLES[vistaPrevia.clave];
      const desde = (el('ad-fecha-desde') || {}).value || '';
      const hasta = (el('ad-fecha-hasta') || {}).value || '';
      const registros = obtenerRegistrosModulo(vistaPrevia.clave);
      const filtrados = filtrarPorRango(registros, modulo.campoFecha, desde, hasta);
      const ids = filtrados.map((r) => r.id).filter(Boolean);
      if (ids.length > 0) {
        await ejecutarBorradoEnLotes(modulo.coleccion, ids);
      }
      totalEliminados = ids.length;
    }
    await window.cargarDatosEnParalelo();
    vistaPrevia = null;
    const textoConfirmar = el('ad-confirmar-texto');
    if (textoConfirmar) textoConfirmar.value = '';
    const checkboxConfirmar = el('ad-checkbox-confirmar');
    if (checkboxConfirmar) checkboxConfirmar.checked = false;
    const prev = el('ad-vista-previa');
    if (prev) prev.innerHTML = '';
    const seccionCheckbox = el('ad-seccion-checkbox');
    if (seccionCheckbox) seccionCheckbox.style.display = 'none';
    actualizarBotonEliminar();
    window.showSuccess(`${totalEliminados} registros eliminados`);
  } catch (error) {
    window.showError(error.message);
    actualizarBotonEliminar();
  }
}

function manejarCambioSelector() {
  invalidarVistaPrevia();
  const clave = (el('ad-selector-modulo') || {}).value || '';
  const seccionFechas = el('ad-seccion-fechas');
  const desdeInput = el('ad-fecha-desde');
  const hastaInput = el('ad-fecha-hasta');
  if (seccionFechas) seccionFechas.style.display = clave === 'todos' ? 'none' : '';
  if (desdeInput) desdeInput.value = '';
  if (hastaInput) hastaInput.value = '';
}

function crearVistaDatos() {
  vistaPrevia = null;
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-datos';
  tarjeta.innerHTML = `
    <h3>Gestión de Datos</h3>
    <div class="admin-datos-fila">
      <label class="admin-datos-label">Módulo:</label>
      <select id="ad-selector-modulo" class="admin-datos-select">
        <option value="">— Selecciona un módulo —</option>
        <option value="destaraje">Destaraje</option>
        <option value="produccion">Producción</option>
        <option value="pagos">Pagos</option>
        <option value="ministraciones">Ministraciones</option>
        <option value="controlProduccion">Control de Producción</option>
        <option value="todos">TODOS los módulos</option>
      </select>
    </div>
    <div id="ad-seccion-fechas" class="admin-datos-fechas">
      <label class="admin-datos-label">Desde: <input type="date" id="ad-fecha-desde"></label>
      <label class="admin-datos-label">Hasta: <input type="date" id="ad-fecha-hasta"></label>
    </div>
    <button type="button" id="ad-btn-ver" class="btn-secondary">🔍 Ver cuántos registros se eliminarán</button>
    <div id="ad-vista-previa" class="ad-vista-previa"></div>
    <div class="admin-datos-confirmar">
      <input type="text" id="ad-confirmar-texto" placeholder="Escribe CONFIRMAR para habilitar">
      <div id="ad-seccion-checkbox" style="display:none">
        <label class="admin-datos-checkbox-label">
          <input type="checkbox" id="ad-checkbox-confirmar">
          Entiendo que esta acción es irreversible y borrará TODOS los módulos
        </label>
      </div>
      <button type="button" id="ad-btn-eliminar" class="btn-danger" style="display:none" disabled>🗑️ Eliminar registros</button>
    </div>
  `;
  tarjeta.querySelector('#ad-selector-modulo').addEventListener('change', manejarCambioSelector);
  tarjeta.querySelector('#ad-fecha-desde').addEventListener('change', invalidarVistaPrevia);
  tarjeta.querySelector('#ad-fecha-hasta').addEventListener('change', invalidarVistaPrevia);
  tarjeta.querySelector('#ad-btn-ver').addEventListener('click', manejarVerCuantos);
  tarjeta.querySelector('#ad-confirmar-texto').addEventListener('input', actualizarBotonEliminar);
  tarjeta.querySelector('#ad-checkbox-confirmar').addEventListener('change', actualizarBotonEliminar);
  tarjeta.querySelector('#ad-btn-eliminar').addEventListener('click', manejarEliminar);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_DATOS, {
  crearVistaDatos
});

})();
