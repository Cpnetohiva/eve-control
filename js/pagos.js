(function () {

function calcularStats(registros) {
  let totalKg = 0;
  for (const registro of registros) {
    totalKg += Number(registro.kg) || 0;
  }
  return { totalRegistros: registros.length, totalKg };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fecha === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fecha >= inicioSemana);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const ticket = (filtros.ticket || '').toLowerCase();
  const proveedor = (filtros.proveedor || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (ticket && !String(r.ticket).toLowerCase().includes(ticket)) return false;
    if (proveedor && !String(r.proveedor).toLowerCase().includes(proveedor)) return false;
    if (material && !String(r.material).toLowerCase().includes(material)) return false;
    if (!dentroDeRangoFecha(r.fecha, filtros.desde, filtros.hasta)) return false;
    return true;
  });
}

function valoresUnicos(arraysDeRegistros, campo, semillas) {
  const set = new Set(semillas || []);
  for (const registros of arraysDeRegistros) {
    for (const registro of registros) {
      const valor = registro[campo];
      if (valor) set.add(String(valor).toUpperCase());
    }
  }
  return Array.from(set).sort();
}

function construirRegistroDesdeFormulario(datos) {
  if (!datos.ticket || !datos.proveedor || !datos.material || !datos.fecha) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  const precioPorKg = Number(datos.precioPorKg);
  if (!Number.isFinite(precioPorKg) || precioPorKg <= 0) {
    throw new Error('Precio/Kg debe ser un número mayor a 0');
  }
  const pagado = Number(datos.pagado);
  if (!Number.isFinite(pagado) || pagado < 0) {
    throw new Error('Pagado debe ser un número mayor o igual a 0');
  }
  return {
    ticket: datos.ticket,
    proveedor: datos.proveedor,
    material: datos.material,
    kg,
    precioPorKg,
    total: kg * precioPorKg,
    pagado,
    fecha: datos.fecha
  };
}

function construirMinistracionDesdeFormulario(datos) {
  if (!datos.fecha) {
    throw new Error('La fecha es obligatoria');
  }
  const monto = Number(datos.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new Error('Monto debe ser un número mayor a 0');
  }
  return {
    monto,
    fecha: datos.fecha,
    semana: window.obtenerSemanaISO(datos.fecha)
  };
}

function calcularControlFlujo(pagosSemana, ministracionesSemana) {
  let totalMinistrado = 0;
  for (const m of ministracionesSemana) {
    totalMinistrado += Number(m.monto) || 0;
  }
  let totalPagado = 0;
  for (const p of pagosSemana) {
    totalPagado += Number(p.pagado) || 0;
  }
  const saldoDisponible = totalMinistrado - totalPagado;
  const porcentajeEjecutado = totalMinistrado > 0 ? (totalPagado / totalMinistrado) * 100 : 0;
  return { totalMinistrado, totalPagado, saldoDisponible, porcentajeEjecutado };
}

window.EVE_PAGOS = {
  calcularStats,
  filtrarPorHoy,
  filtrarPorSemana,
  aplicarFiltrosTodos,
  valoresUnicos,
  construirRegistroDesdeFormulario,
  construirMinistracionDesdeFormulario,
  calcularControlFlujo
};

let editandoId = null;

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
  const proveedores = valoresUnicos([window.EVE.registrosPagos], 'proveedor', window.PROVEEDORES_COMUNES);
  const materiales = valoresUnicos([window.EVE.registrosPagos], 'material', window.MATERIALES_COMUNES);
  llenarDatalist('dl-pagos-proveedores', proveedores);
  llenarDatalist('dl-pagos-materiales', materiales);
}

function insertarRegistroEnMemoria(registro) {
  window.EVE.registrosPagos.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos) {
  const lista = window.EVE.registrosPagos;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista[indice] = { ...lista[indice], ...datos };
  }
}

function eliminarRegistroEnMemoria(id) {
  const lista = window.EVE.registrosPagos;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista.splice(indice, 1);
  }
}

function actualizarTotalFormulario() {
  const kg = Number(document.getElementById('pg-kg').value) || 0;
  const precio = Number(document.getElementById('pg-precio').value) || 0;
  document.getElementById('pg-total').value = window.formatearMoneda(kg * precio);
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    ticket: document.getElementById('pg-ticket').value.trim(),
    proveedor: document.getElementById('pg-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('pg-material').value.trim().toUpperCase(),
    kg: document.getElementById('pg-kg').value,
    precioPorKg: document.getElementById('pg-precio').value,
    pagado: document.getElementById('pg-pagado').value,
    fecha: document.getElementById('pg-fecha').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    const id = await window.guardarDato('pagos', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    document.getElementById('pagos-form').reset();
    document.getElementById('pg-fecha').value = window.obtenerFechaMexico();
    document.getElementById('pg-total').value = '';
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Pago guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parsePagos(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  document.getElementById('pg-ticket').value = datos.ticket;
  document.getElementById('pg-proveedor').value = datos.proveedor;
  document.getElementById('pg-material').value = datos.material;
  document.getElementById('pg-kg').value = datos.kg;
  document.getElementById('pg-precio').value = datos.precioPorKg;
  document.getElementById('pg-pagado').value = datos.pagado;
  actualizarTotalFormulario();
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'pagos-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-grid">
      <input type="text" id="pg-ticket" placeholder="Ticket" required>
      <input type="text" id="pg-proveedor" placeholder="Proveedor" list="dl-pagos-proveedores" required>
      <input type="text" id="pg-material" placeholder="Material" list="dl-pagos-materiales" required>
      <input type="number" id="pg-kg" placeholder="Kg" step="0.01" required>
      <input type="number" id="pg-precio" placeholder="Precio/Kg" step="0.01" required>
      <input type="number" id="pg-pagado" placeholder="Pagado" step="0.01" required>
      <input type="date" id="pg-fecha" required>
      <input type="text" id="pg-total" placeholder="Total" disabled>
    </div>
    <datalist id="dl-pagos-proveedores"></datalist>
    <datalist id="dl-pagos-materiales"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.querySelector('#pg-fecha').value = window.obtenerFechaMexico();
  form.querySelector('#pg-kg').addEventListener('input', actualizarTotalFormulario);
  form.querySelector('#pg-precio').addEventListener('input', actualizarTotalFormulario);
  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));
  return form;
}

function actualizarTotalEdicion() {
  const kg = Number(document.getElementById('pge-kg').value) || 0;
  const precio = Number(document.getElementById('pge-precio').value) || 0;
  document.getElementById('pge-total').value = window.formatearMoneda(kg * precio);
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    ticket: document.getElementById('pge-ticket').value.trim(),
    proveedor: document.getElementById('pge-proveedor').value.trim().toUpperCase(),
    material: document.getElementById('pge-material').value.trim().toUpperCase(),
    kg: document.getElementById('pge-kg').value,
    precioPorKg: document.getElementById('pge-precio').value,
    pagado: document.getElementById('pge-pagado').value,
    fecha: document.getElementById('pge-fecha').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    await window.actualizarDato('pagos', editandoId, registro);
    reemplazarRegistroEnMemoria(editandoId, registro);
    cerrarModalEdicion();
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Pago actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'pagos-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar pago</h3>
      <form id="pagos-edit-form">
        <input type="text" id="pge-ticket" placeholder="Ticket" required>
        <input type="text" id="pge-proveedor" placeholder="Proveedor" required>
        <input type="text" id="pge-material" placeholder="Material" required>
        <input type="number" id="pge-kg" placeholder="Kg" step="0.01" required>
        <input type="number" id="pge-precio" placeholder="Precio/Kg" step="0.01" required>
        <input type="number" id="pge-pagado" placeholder="Pagado" step="0.01" required>
        <input type="date" id="pge-fecha" required>
        <input type="text" id="pge-total" placeholder="Total" disabled>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="pge-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#pge-kg').addEventListener('input', actualizarTotalEdicion);
  overlay.querySelector('#pge-precio').addEventListener('input', actualizarTotalEdicion);
  overlay.querySelector('#pagos-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#pge-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('pge-ticket').value = registro.ticket;
  document.getElementById('pge-proveedor').value = registro.proveedor;
  document.getElementById('pge-material').value = registro.material;
  document.getElementById('pge-kg').value = registro.kg;
  document.getElementById('pge-precio').value = registro.precioPorKg;
  document.getElementById('pge-pagado').value = registro.pagado;
  document.getElementById('pge-fecha').value = registro.fecha;
  actualizarTotalEdicion();
  document.getElementById('pagos-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('pagos-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este pago?')) return;
  try {
    await window.eliminarDato('pagos', id);
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Pago eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

Object.assign(window.EVE_PAGOS, {
  crearFormulario,
  crearModalEdicion,
  abrirModalEdicion,
  actualizarDatalists,
  confirmarEliminar
});

})();
