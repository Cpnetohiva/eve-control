(function () {

function precioVigentePorMaterial(precios, hoy) {
  const mapa = new Map();
  precios.forEach((p) => {
    if (p.fechaInicio > hoy) return;
    if (p.fechaFin !== null && p.fechaFin < hoy) return;
    const actual = mapa.get(p.material);
    if (!actual || p.fechaInicio > actual.fechaInicio) {
      mapa.set(p.material, p);
    }
  });
  return Array.from(mapa.values()).sort((a, b) => a.material.localeCompare(b.material));
}

function precioVigenteAbiertoPorMaterial(precios, material) {
  return precios.find((p) => p.material === material && p.fechaFin === null) || null;
}

function materialesConPrecio(precios) {
  const set = new Set();
  precios.forEach((p) => set.add(p.material));
  return Array.from(set);
}

function construirNuevoPrecio(datos, precioAnteriorVigente) {
  const material = (datos.material || '').toString().trim().toUpperCase();
  if (!material) {
    throw new Error('El material es obligatorio');
  }
  const precio = Number(datos.precio);
  if (!Number.isFinite(precio) || precio <= 0) {
    throw new Error('El precio debe ser un número mayor a 0');
  }
  const fechaInicio = datos.fechaInicio;
  if (!fechaInicio) {
    throw new Error('La fecha de vigencia es obligatoria');
  }
  if (precioAnteriorVigente && fechaInicio <= precioAnteriorVigente.fechaInicio) {
    throw new Error(`La fecha debe ser posterior al inicio del precio vigente actual (${window.formatearFecha(precioAnteriorVigente.fechaInicio)})`);
  }
  const nuevo = {
    material,
    precio,
    fechaInicio,
    fechaFin: null,
    notas: (datos.notas || '').toString().trim()
  };
  const cierre = precioAnteriorVigente
    ? { id: precioAnteriorVigente.id, fechaFin: window.restarUnDia(fechaInicio) }
    : null;
  return { cierre, nuevo };
}

function historialPorMaterial(precios, material, hoy) {
  return precios
    .filter((p) => p.material === material)
    .map((p) => {
      const fin = p.fechaFin || hoy;
      const inicio = new Date(`${p.fechaInicio}T00:00:00`);
      const finDate = new Date(`${fin}T00:00:00`);
      const duracionDias = Math.round((finDate - inicio) / 86400000) + 1;
      return { ...p, duracionDias };
    })
    .sort((a, b) => (a.fechaInicio < b.fechaInicio ? 1 : -1));
}

window.EVE_PRECIOS = {
  precioVigentePorMaterial,
  precioVigenteAbiertoPorMaterial,
  materialesConPrecio,
  construirNuevoPrecio,
  historialPorMaterial
};

let vistaActiva = 'vigentes';
let materialHistorialSeleccionado = '';

function materialesParaDatalist() {
  const set = new Set(window.MATERIALES_COMUNES);
  window.EVE.precios.forEach((p) => set.add(p.material));
  return Array.from(set).sort();
}

function llenarDatalistMateriales() {
  const datalist = document.getElementById('dl-precios-materiales');
  if (!datalist) return;
  datalist.innerHTML = '';
  materialesParaDatalist().forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    datalist.appendChild(opcion);
  });
}

function mostrarAvisoPrecioAnterior() {
  const material = document.getElementById('pr-material').value.trim().toUpperCase();
  const fecha = document.getElementById('pr-fecha').value;
  const aviso = document.getElementById('pr-aviso');
  const anterior = material ? precioVigenteAbiertoPorMaterial(window.EVE.precios, material) : null;
  if (anterior) {
    aviso.style.display = '';
    aviso.textContent = `El precio anterior (${window.formatearMoneda(anterior.precio)}) quedará cerrado al ${window.formatearFecha(window.restarUnDia(fecha || window.obtenerFechaMexico()))}`;
  } else {
    aviso.style.display = 'none';
    aviso.textContent = '';
  }
}

async function manejarEnvioPrecio(evento) {
  evento.preventDefault();
  const datos = {
    material: document.getElementById('pr-material').value,
    precio: document.getElementById('pr-precio').value,
    fechaInicio: document.getElementById('pr-fecha').value,
    notas: document.getElementById('pr-notas').value
  };
  const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  try {
    const materialUpper = (datos.material || '').toString().trim().toUpperCase();
    const anterior = precioVigenteAbiertoPorMaterial(window.EVE.precios, materialUpper);
    const { cierre, nuevo } = construirNuevoPrecio(datos, anterior);
    if (cierre) {
      await window.actualizarDato('precios', cierre.id, { fechaFin: cierre.fechaFin });
      const registroCerrado = window.EVE.precios.find((p) => p.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaFin = cierre.fechaFin;
    }
    const nuevoConMeta = { ...nuevo, creadoPor: usuario };
    const id = await window.guardarDato('precios', nuevoConMeta);
    window.EVE.precios.push({ id, ...nuevoConMeta, fechaRegistro: new Date().toISOString() });
    cerrarModalPrecio();
    llenarDatalistMateriales();
    renderizarVistaActiva();
    window.showSuccess('Precio guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalPrecio() {
  const overlay = document.createElement('div');
  overlay.id = 'precios-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Nuevo / Actualizar Precio</h3>
      <form id="precios-form">
        <input type="text" id="pr-material" placeholder="Material" list="dl-precios-materiales" required>
        <input type="number" id="pr-precio" placeholder="Precio por Kg" step="0.01" required>
        <input type="date" id="pr-fecha" required>
        <textarea id="pr-notas" placeholder="Notas (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <div id="pr-aviso" class="chip chip-warn" style="display:none;margin:0.5rem 0"></div>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="pr-cancelar" class="btn-secondary">Cancelar</button>
      </form>
      <datalist id="dl-precios-materiales"></datalist>
    </div>
  `;
  overlay.querySelector('#pr-material').addEventListener('input', mostrarAvisoPrecioAnterior);
  overlay.querySelector('#pr-fecha').addEventListener('change', mostrarAvisoPrecioAnterior);
  overlay.querySelector('#precios-form').addEventListener('submit', manejarEnvioPrecio);
  overlay.querySelector('#pr-cancelar').addEventListener('click', () => cerrarModalPrecio());
  return overlay;
}

function abrirModalPrecio(materialPrefill) {
  document.getElementById('precios-form').reset();
  document.getElementById('pr-fecha').value = window.obtenerFechaMexico();
  llenarDatalistMateriales();
  if (materialPrefill) {
    document.getElementById('pr-material').value = materialPrefill;
  }
  mostrarAvisoPrecioAnterior();
  document.getElementById('precios-modal-overlay').classList.add('open');
}

function cerrarModalPrecio() {
  document.getElementById('precios-modal-overlay').classList.remove('open');
}

function crearBarraAcciones() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btnNuevo = document.createElement('button');
  btnNuevo.textContent = '+ Nuevo Precio';
  btnNuevo.className = 'btn-primary';
  btnNuevo.addEventListener('click', () => abrirModalPrecio());
  const btnHistorial = document.createElement('button');
  btnHistorial.id = 'precios-btn-historial';
  btnHistorial.textContent = 'Ver Historial Completo';
  btnHistorial.className = 'btn-secondary';
  btnHistorial.addEventListener('click', () => {
    vistaActiva = vistaActiva === 'vigentes' ? 'historial' : 'vigentes';
    btnHistorial.textContent = vistaActiva === 'historial' ? 'Ver Precios Vigentes' : 'Ver Historial Completo';
    renderizarVistaActiva();
  });
  div.appendChild(btnNuevo);
  div.appendChild(btnHistorial);
  return div;
}

function crearVistaVigentes() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.id = 'precios-vigentes-wrapper';
  return wrapper;
}

function llenarVistaVigentes() {
  const wrapper = document.getElementById('precios-vigentes-wrapper');
  if (!wrapper) return;
  const comisionPorKg = Number(window.EVE.comisionPorKg) || 0;
  const filas = precioVigentePorMaterial(window.EVE.precios, window.obtenerFechaMexico());
  wrapper.innerHTML = '';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Material</th><th>Precio</th><th>Comisión</th><th>Precio Efectivo</th><th>Vigente desde</th><th>Notas</th><th></th></tr>
    </thead>
    <tbody id="precios-vigentes-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  const tbody = tabla.querySelector('#precios-vigentes-tabla');
  if (filas.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 7;
    celda.textContent = 'Sin precios registrados';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  filas.forEach((p) => {
    const fila = document.createElement('tr');
    const valores = [
      p.material,
      window.formatearMoneda(p.precio),
      window.formatearMoneda(comisionPorKg),
      window.formatearMoneda(p.precio + comisionPorKg),
      window.formatearFecha(p.fechaInicio),
      p.notas || ''
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    const celdaAccion = document.createElement('td');
    const boton = document.createElement('button');
    boton.textContent = 'Actualizar precio';
    boton.className = 'btn-secondary';
    boton.addEventListener('click', () => abrirModalPrecio(p.material));
    celdaAccion.appendChild(boton);
    fila.appendChild(celdaAccion);
    tbody.appendChild(fila);
  });
}

function crearVistaHistorial() {
  const wrapper = document.createElement('div');
  wrapper.id = 'precios-historial-wrapper';
  wrapper.style.display = 'none';

  const selectorCard = document.createElement('div');
  selectorCard.className = 'card';
  selectorCard.innerHTML = `
    <label class="admin-config-campo">
      Material
      <select id="ph-material"></select>
    </label>
  `;
  wrapper.appendChild(selectorCard);

  const tablaWrapper = document.createElement('div');
  tablaWrapper.className = 'card destaraje-tabla-wrapper';
  tablaWrapper.id = 'precios-historial-tabla-wrapper';
  wrapper.appendChild(tablaWrapper);

  selectorCard.querySelector('#ph-material').addEventListener('change', (evento) => {
    materialHistorialSeleccionado = evento.target.value;
    llenarVistaHistorial();
  });

  return wrapper;
}

function llenarSelectorHistorial() {
  const select = document.getElementById('ph-material');
  if (!select) return;
  const materiales = materialesConPrecio(window.EVE.precios).sort();
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
  const wrapper = document.getElementById('precios-historial-tabla-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  if (!materialHistorialSeleccionado) {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Selecciona un material para ver su historial de precios';
    wrapper.appendChild(mensaje);
    return;
  }
  const historial = historialPorMaterial(window.EVE.precios, materialHistorialSeleccionado, window.obtenerFechaMexico());
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Precio</th><th>Desde</th><th>Hasta</th><th>Duración (días)</th><th>Notas</th></tr>
    </thead>
    <tbody id="precios-historial-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  const tbody = tabla.querySelector('#precios-historial-tabla');
  historial.forEach((p) => {
    const fila = document.createElement('tr');
    const valores = [
      window.formatearMoneda(p.precio),
      window.formatearFecha(p.fechaInicio),
      p.fechaFin ? window.formatearFecha(p.fechaFin) : 'Vigente',
      String(p.duracionDias),
      p.notas || ''
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
}

function renderizarVistaActiva() {
  document.getElementById('precios-vigentes-wrapper').style.display = vistaActiva === 'vigentes' ? '' : 'none';
  document.getElementById('precios-historial-wrapper').style.display = vistaActiva === 'historial' ? '' : 'none';
  if (vistaActiva === 'vigentes') {
    llenarVistaVigentes();
  } else {
    llenarSelectorHistorial();
    llenarVistaHistorial();
  }
}

function renderPrecios(container) {
  vistaActiva = 'vigentes';
  materialHistorialSeleccionado = '';

  container.appendChild(crearBarraAcciones());
  container.appendChild(crearVistaVigentes());
  container.appendChild(crearVistaHistorial());
  container.appendChild(crearModalPrecio());

  renderizarVistaActiva();
}

window.EVE_MODULES.precios = { render: renderPrecios };

})();
