(function () {

function esMaterialPZProduccion(material) {
  return window.MATERIALES_PZ.includes((material || '').toString().trim().toUpperCase());
}

function calcularStatsProduccion(registros) {
  let totalKg = 0;
  let totalPz = 0;
  for (const registro of registros) {
    if (esMaterialPZProduccion(registro.material)) {
      totalPz += Number(registro.kg) || 0;
    } else {
      totalKg += Number(registro.kg) || 0;
    }
  }
  return { totalRegistros: registros.length, totalKg, totalPz };
}

function filtrarPorHoy(registros, hoy) {
  return registros.filter((r) => r.fechaSalida === hoy);
}

function filtrarPorSemana(registros, inicioSemana) {
  return registros.filter((r) => r.fechaSalida >= inicioSemana);
}

function dentroDeRangoFecha(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosTodos(registros, filtros) {
  const cliente = (filtros.cliente || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  return registros.filter((r) => {
    if (cliente && !String(r.cliente).toLowerCase().includes(cliente)) return false;
    if (material && !String(r.material).toLowerCase().includes(material)) return false;
    if (!dentroDeRangoFecha(r.fechaSalida, filtros.desde, filtros.hasta)) return false;
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
  if (!datos.cliente || !datos.material || !datos.fechaEntrada || !datos.fechaSalida) {
    throw new Error('Todos los campos son obligatorios');
  }
  const kg = Number(datos.kg);
  if (!Number.isFinite(kg) || kg <= 0) {
    throw new Error('Kg debe ser un número mayor a 0');
  }
  return {
    ticket: 'P',
    cliente: datos.cliente,
    material: datos.material,
    kg,
    fechaEntrada: datos.fechaEntrada,
    fechaSalida: datos.fechaSalida
  };
}

window.calcularStatsProduccion = calcularStatsProduccion;
window.filtrarPorHoyProduccion = filtrarPorHoy;
window.filtrarPorSemanaProduccion = filtrarPorSemana;
window.aplicarFiltrosTodosProduccion = aplicarFiltrosTodos;
window.valoresUnicosProduccion = valoresUnicos;
window.construirRegistroDesdeFormularioProduccion = construirRegistroDesdeFormulario;

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
  const clientes = valoresUnicos([window.EVE.registrosProduccion], 'cliente', []);
  const materiales = valoresUnicos([window.EVE.registrosProduccion], 'material', window.MATERIALES_COMUNES);
  llenarDatalist('prod-dl-clientes', clientes);
  llenarDatalist('prod-dl-materiales', materiales);
}

function insertarRegistroEnMemoria(registro) {
  window.EVE.registrosProduccion.push(registro);
}

function reemplazarRegistroEnMemoria(id, datos) {
  const lista = window.EVE.registrosProduccion;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista[indice] = { ...lista[indice], ...datos };
  }
}

function eliminarRegistroEnMemoria(id) {
  const lista = window.EVE.registrosProduccion;
  const indice = lista.findIndex((r) => r.id === id);
  if (indice !== -1) {
    lista.splice(indice, 1);
  }
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const datos = {
    cliente: document.getElementById('prod-cliente').value.trim().toUpperCase(),
    material: document.getElementById('prod-material').value.trim().toUpperCase(),
    kg: document.getElementById('prod-kg').value,
    fechaEntrada: document.getElementById('prod-entrada').value,
    fechaSalida: document.getElementById('prod-salida').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    const id = await window.guardarDato('produccion', registro);
    insertarRegistroEnMemoria({ id, ...registro, fechaRegistro: new Date().toISOString() });
    document.getElementById('produccion-form').reset();
    document.getElementById('prod-ticket').value = 'P';
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parseProduccion(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  document.getElementById('prod-cliente').value = datos.cliente;
  document.getElementById('prod-material').value = datos.material;
  document.getElementById('prod-kg').value = datos.kg;
  document.getElementById('prod-entrada').value = datos.fechaEntrada;
  document.getElementById('prod-salida').value = datos.fechaSalida;
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'produccion-form';
  form.className = 'card destaraje-form';
  form.innerHTML = `
    <div class="form-grid">
      <input type="text" id="prod-ticket" value="P" disabled>
      <input type="text" id="prod-cliente" placeholder="Cliente" list="prod-dl-clientes" required>
      <input type="text" id="prod-material" placeholder="Material" list="prod-dl-materiales" required>
      <input type="number" id="prod-kg" placeholder="Kg" step="0.01" required>
      <input type="date" id="prod-entrada" required>
      <input type="date" id="prod-salida" required>
    </div>
    <datalist id="prod-dl-clientes"></datalist>
    <datalist id="prod-dl-materiales"></datalist>
    <button type="submit" class="btn-primary">Guardar</button>
  `;
  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));
  return form;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const datos = {
    cliente: document.getElementById('prode-cliente').value.trim().toUpperCase(),
    material: document.getElementById('prode-material').value.trim().toUpperCase(),
    kg: document.getElementById('prode-kg').value,
    fechaEntrada: document.getElementById('prode-entrada').value,
    fechaSalida: document.getElementById('prode-salida').value
  };
  try {
    const registro = construirRegistroDesdeFormulario(datos);
    await window.actualizarDato('produccion', editandoId, registro);
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
  overlay.id = 'produccion-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar registro</h3>
      <form id="produccion-edit-form">
        <input type="text" id="prode-ticket" value="P" disabled>
        <input type="text" id="prode-cliente" placeholder="Cliente" required>
        <input type="text" id="prode-material" placeholder="Material" required>
        <input type="number" id="prode-kg" placeholder="Kg" step="0.01" required>
        <input type="date" id="prode-entrada" required>
        <input type="date" id="prode-salida" required>
        <button type="submit" class="btn-primary">Guardar cambios</button>
        <button type="button" id="prode-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#produccion-edit-form').addEventListener('submit', manejarEnvioEdicion);
  overlay.querySelector('#prode-cancelar').addEventListener('click', () => cerrarModalEdicion());
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  document.getElementById('prode-cliente').value = registro.cliente;
  document.getElementById('prode-material').value = registro.material;
  document.getElementById('prode-kg').value = registro.kg;
  document.getElementById('prode-entrada').value = registro.fechaEntrada;
  document.getElementById('prode-salida').value = registro.fechaSalida;
  document.getElementById('produccion-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('produccion-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function confirmarEliminar(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  try {
    await window.eliminarDato('produccion', id);
    eliminarRegistroEnMemoria(id);
    actualizarDatalists();
    renderizarVista();
    window.showSuccess('Registro eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

window.crearFormularioProduccion = crearFormulario;
window.crearModalEdicionProduccion = crearModalEdicion;
window.abrirModalEdicionProduccion = abrirModalEdicion;
window.actualizarDatalistsProduccion = actualizarDatalists;
window.confirmarEliminarProduccion = confirmarEliminar;

})();
