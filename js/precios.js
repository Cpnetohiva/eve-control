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

function encontrarPrecioContenedor(precios, material, fecha) {
  return precios.find((p) =>
    p.material === material &&
    p.fechaInicio < fecha &&
    (p.fechaFin === null || p.fechaFin >= fecha)
  ) || null;
}

function construirNuevoPrecio(datos, precios) {
  const material = window.normalizarMaterial(datos.material);
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

  const historial = (precios || []).filter((p) => p.material === material);

  const coincidenciaExacta = historial.find((p) => p.fechaInicio === fechaInicio);
  if (coincidenciaExacta) {
    throw new Error(`Ya existe un precio para ${material} que inicia exactamente el ${window.formatearFecha(fechaInicio)}. Elimínalo desde el historial si quieres reemplazarlo.`);
  }

  const contenedor = encontrarPrecioContenedor(historial, material, fechaInicio);

  let cierre = null;
  let fechaFin = null;

  if (contenedor) {
    // La nueva fecha cae dentro del rango de un precio existente (vigente o histórico):
    // se cierra ese precio un día antes y el nuevo hereda el resto de su rango original.
    cierre = { id: contenedor.id, fechaFin: window.restarUnDia(fechaInicio) };
    fechaFin = contenedor.fechaFin;
  } else {
    const siguiente = historial
      .filter((p) => p.fechaInicio > fechaInicio)
      .sort((a, b) => (a.fechaInicio < b.fechaInicio ? -1 : 1))[0];
    fechaFin = siguiente ? window.restarUnDia(siguiente.fechaInicio) : null;
  }

  const nuevo = {
    material,
    precio,
    fechaInicio,
    fechaFin,
    notas: (datos.notas || '').toString().trim()
  };
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

// ── Ajustes de precio por Proveedor ─────────────────────────────────────
// Mismo criterio de vigencia y encadenamiento fechaInicio/fechaFin que los
// precios generales (construirNuevoPrecio), pero con clave Material+Proveedor
// en vez de solo Material, y sin version/actualizadoPor.

function ajusteProveedorVigente(ajustes, material, proveedor, fecha) {
  return (ajustes || []).find((a) =>
    a.material === material &&
    a.proveedor === proveedor &&
    a.fechaInicio <= fecha &&
    (a.fechaFin === null || a.fechaFin >= fecha)
  ) || null;
}

function encontrarAjusteContenedor(ajustes, material, proveedor, fecha) {
  return ajustes.find((a) =>
    a.material === material &&
    a.proveedor === proveedor &&
    a.fechaInicio < fecha &&
    (a.fechaFin === null || a.fechaFin >= fecha)
  ) || null;
}

function ajustesVigentes(ajustes, hoy) {
  return (ajustes || [])
    .filter((a) => a.fechaInicio <= hoy && (a.fechaFin === null || a.fechaFin >= hoy))
    .sort((a, b) => (a.material === b.material ? a.proveedor.localeCompare(b.proveedor) : a.material.localeCompare(b.material)));
}

function construirNuevoAjustePrecio(datos, ajustes) {
  const material = window.normalizarMaterial(datos.material);
  if (!material) {
    throw new Error('El material es obligatorio');
  }
  const proveedor = window.normalizarProveedor(datos.proveedor);
  if (!proveedor) {
    throw new Error('El proveedor es obligatorio');
  }
  const tipoAjuste = datos.tipoAjuste;
  if (tipoAjuste !== 'monto' && tipoAjuste !== 'porcentaje') {
    throw new Error('El tipo de ajuste debe ser "Monto Fijo" o "Porcentaje"');
  }
  const valorAjuste = Number(datos.valorAjuste);
  if (!Number.isFinite(valorAjuste) || valorAjuste === 0) {
    throw new Error('El valor del ajuste debe ser un número distinto de 0');
  }
  const fechaInicio = datos.fechaInicio;
  if (!fechaInicio) {
    throw new Error('La fecha de vigencia es obligatoria');
  }

  const historial = (ajustes || []).filter((a) => a.material === material && a.proveedor === proveedor);

  const coincidenciaExacta = historial.find((a) => a.fechaInicio === fechaInicio);
  if (coincidenciaExacta) {
    throw new Error(`Ya existe un ajuste de ${material} / ${proveedor} que inicia exactamente el ${window.formatearFecha(fechaInicio)}. Elimínalo desde el historial si quieres reemplazarlo.`);
  }

  const contenedor = encontrarAjusteContenedor(historial, material, proveedor, fechaInicio);

  let cierre = null;
  let fechaFin = null;

  if (contenedor) {
    cierre = { id: contenedor.id, fechaFin: window.restarUnDia(fechaInicio) };
    fechaFin = contenedor.fechaFin;
  } else {
    const siguiente = historial
      .filter((a) => a.fechaInicio > fechaInicio)
      .sort((a, b) => (a.fechaInicio < b.fechaInicio ? -1 : 1))[0];
    fechaFin = siguiente ? window.restarUnDia(siguiente.fechaInicio) : null;
  }

  const nuevo = { material, proveedor, tipoAjuste, valorAjuste, fechaInicio, fechaFin };
  return { cierre, nuevo };
}

window.obtenerAjusteProveedorVigente = function (material, proveedor, fecha) {
  const mat = window.normalizarMaterial(material);
  const prov = window.normalizarProveedor(proveedor);
  return ajusteProveedorVigente(window.EVE.ajustesPrecioProveedor, mat, prov, fecha);
};

window.EVE_PRECIOS = {
  precioVigentePorMaterial,
  precioVigenteAbiertoPorMaterial,
  encontrarPrecioContenedor,
  materialesConPrecio,
  construirNuevoPrecio,
  historialPorMaterial,
  ajusteProveedorVigente,
  encontrarAjusteContenedor,
  ajustesVigentes,
  construirNuevoAjustePrecio
};

let vistaActiva = 'vigentes';
let materialHistorialSeleccionado = '';

function opcionesMaterialesHtml() {
  return '<option value="">Material</option>' +
    window.MATERIALES_COMUNES.map((m) => `<option value="${m}">${m}</option>`).join('');
}

function mostrarAvisoPrecioAnterior() {
  const material = document.getElementById('pr-material').value.trim().toUpperCase();
  const fecha = document.getElementById('pr-fecha').value;
  const aviso = document.getElementById('pr-aviso');
  if (!material || !fecha) {
    aviso.style.display = 'none';
    aviso.textContent = '';
    return;
  }
  const coincidenciaExacta = window.EVE.precios.find((p) => p.material === material && p.fechaInicio === fecha);
  if (coincidenciaExacta) {
    aviso.style.display = '';
    aviso.textContent = `Ya existe un precio de ${material} que inicia exactamente el ${window.formatearFecha(fecha)}. Cambia la fecha o elimínalo desde el historial para reemplazarlo.`;
    return;
  }
  const contenedor = encontrarPrecioContenedor(window.EVE.precios, material, fecha);
  if (contenedor) {
    aviso.style.display = '';
    const etiqueta = contenedor.fechaFin === null ? 'vigente' : 'histórico';
    aviso.textContent = `El precio ${etiqueta} de ${material} (${window.formatearMoneda(contenedor.precio)}, desde ${window.formatearFecha(contenedor.fechaInicio)}) quedará cerrado al ${window.formatearFecha(window.restarUnDia(fecha))}.`;
    return;
  }
  aviso.style.display = 'none';
  aviso.textContent = '';
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
    const { cierre, nuevo } = construirNuevoPrecio(datos, window.EVE.precios);
    if (cierre) {
      await window.actualizarDato('precios', cierre.id, { fechaFin: cierre.fechaFin });
      const registroCerrado = window.EVE.precios.find((p) => p.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaFin = cierre.fechaFin;
    }
    const nuevoConMeta = { ...nuevo, creadoPor: usuario };
    const id = await window.guardarDato('precios', nuevoConMeta);
    window.EVE.precios.push({ id, ...nuevoConMeta, fechaRegistro: new Date().toISOString() });
    cerrarModalPrecio();
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
        <select id="pr-material" required>${opcionesMaterialesHtml()}</select>
        <input type="number" id="pr-precio" placeholder="Precio por Kg" step="0.01" required>
        <input type="date" id="pr-fecha" required>
        <textarea id="pr-notas" placeholder="Notas (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <div id="pr-aviso" class="chip chip-warn" style="display:none;margin:0.5rem 0"></div>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="pr-cancelar" class="btn-secondary">Cancelar</button>
      </form>
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
  if (materialPrefill) {
    document.getElementById('pr-material').value = materialPrefill;
  }
  mostrarAvisoPrecioAnterior();
  document.getElementById('precios-modal-overlay').classList.add('open');
}

function cerrarModalPrecio() {
  document.getElementById('precios-modal-overlay').classList.remove('open');
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto == null ? '' : String(texto);
  return div.innerHTML;
}

function abrirVistaImpresionPrecios() {
  const porMaterial = new Map();
  (window.EVE.precios || []).forEach((p) => {
    if (!porMaterial.has(p.material)) porMaterial.set(p.material, []);
    porMaterial.get(p.material).push(p);
  });
  const materiales = Array.from(porMaterial.keys()).sort((a, b) => a.localeCompare(b));

  const filasHtml = materiales.map((material) => {
    const entradas = porMaterial.get(material).slice().sort((a, b) => (a.fechaInicio < b.fechaInicio ? -1 : 1));
    return entradas.map((p, idx) => `
      <tr class="${idx === 0 ? 'grupo-inicio' : ''}">
        <td>${idx === 0 ? escaparHtml(material) : ''}</td>
        <td>${escaparHtml(window.formatearMoneda(p.precio))}</td>
        <td>${escaparHtml(window.formatearFecha(p.fechaInicio))}</td>
        <td>${p.fechaFin ? escaparHtml(window.formatearFecha(p.fechaFin)) : 'Vigente'}</td>
      </tr>
    `).join('');
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Lista de Precios Vigente</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; padding: 24px; color: #222; }
  h1 { font-size: 1.3rem; margin: 0 0 0.25rem; }
  p.subtitulo { color: #666; margin: 0 0 1.5rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
  th { background: #f0f0f0; }
  tr.grupo-inicio td { border-top: 2px solid #888; }
  @media print {
    @page { size: letter; margin: 1.5cm; }
    body { padding: 0; }
  }
</style>
</head>
<body>
  <h1>Lista de Precios Vigente</h1>
  <p class="subtitulo">Generado el ${escaparHtml(window.formatearFecha(window.obtenerFechaMexico()))}</p>
  <table>
    <thead><tr><th>Material</th><th>Precio</th><th>Fecha Inicio</th><th>Fecha Fin</th></tr></thead>
    <tbody>${filasHtml}</tbody>
  </table>
</body>
</html>`;

  const ventana = window.open('', '_blank');
  if (!ventana) {
    window.showError('El navegador bloqueó la ventana de impresión. Habilita pop-ups para este sitio.');
    return;
  }
  ventana.document.write(html);
  ventana.document.close();
  ventana.focus();
  ventana.print();
}

function crearBarraAcciones() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const btnNuevo = document.createElement('button');
  btnNuevo.textContent = '+ Nuevo Precio';
  btnNuevo.className = 'btn-primary';
  btnNuevo.addEventListener('click', () => abrirModalPrecio());
  const btnNuevoAjuste = document.createElement('button');
  btnNuevoAjuste.textContent = '+ Nuevo Ajuste por Proveedor';
  btnNuevoAjuste.className = 'btn-primary';
  btnNuevoAjuste.addEventListener('click', () => abrirModalAjuste());
  const btnImprimir = document.createElement('button');
  btnImprimir.textContent = 'Imprimir lista de precios';
  btnImprimir.className = 'btn-secondary';
  btnImprimir.addEventListener('click', () => abrirVistaImpresionPrecios());
  div.appendChild(btnNuevo);
  div.appendChild(btnNuevoAjuste);
  div.appendChild(btnImprimir);
  return div;
}

function crearTabsVista() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'vigentes', nombre: 'Precios Vigentes' },
    { id: 'historial', nombre: 'Historial Completo' },
    { id: 'ajustes', nombre: 'Ajustes por Proveedor' }
  ];
  definiciones.forEach((def, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = def.nombre;
    boton.addEventListener('click', () => {
      vistaActiva = def.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === boton));
      renderizarVistaActiva();
    });
    nav.appendChild(boton);
  });
  return nav;
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
      <tr><th>Precio</th><th>Desde</th><th>Hasta</th><th>Duración (días)</th><th>Notas</th><th></th></tr>
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
    const celdaAccion = document.createElement('td');
    const btnEliminar = document.createElement('button');
    btnEliminar.className = 'btn-secondary';
    btnEliminar.textContent = 'Eliminar';
    btnEliminar.addEventListener('click', () => eliminarPrecio(p.id));
    celdaAccion.appendChild(btnEliminar);
    fila.appendChild(celdaAccion);
    tbody.appendChild(fila);
  });
}

function tipoAjusteEtiqueta(tipo) {
  return tipo === 'monto' ? 'Monto Fijo' : 'Porcentaje';
}

function valorAjusteEtiqueta(ajuste) {
  return ajuste.tipoAjuste === 'monto'
    ? window.formatearMoneda(ajuste.valorAjuste)
    : `${ajuste.valorAjuste > 0 ? '+' : ''}${ajuste.valorAjuste}%`;
}

function crearVistaAjustes() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.id = 'precios-ajustes-wrapper';
  wrapper.style.display = 'none';
  return wrapper;
}

function llenarVistaAjustes() {
  const wrapper = document.getElementById('precios-ajustes-wrapper');
  if (!wrapper) return;
  const filas = ajustesVigentes(window.EVE.ajustesPrecioProveedor, window.obtenerFechaMexico());
  wrapper.innerHTML = '';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Material</th><th>Proveedor</th><th>Tipo de Ajuste</th><th>Valor</th><th>Vigente desde</th><th></th></tr>
    </thead>
    <tbody id="precios-ajustes-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  const tbody = tabla.querySelector('#precios-ajustes-tabla');
  if (filas.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 6;
    celda.textContent = 'Sin ajustes por proveedor registrados';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  filas.forEach((a) => {
    const fila = document.createElement('tr');
    const valores = [a.material, a.proveedor, tipoAjusteEtiqueta(a.tipoAjuste), valorAjusteEtiqueta(a), window.formatearFecha(a.fechaInicio)];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    const celdaAccion = document.createElement('td');
    const boton = document.createElement('button');
    boton.textContent = 'Desactivar';
    boton.className = 'btn-secondary';
    boton.addEventListener('click', () => desactivarAjusteProveedor(a.id));
    celdaAccion.appendChild(boton);
    fila.appendChild(celdaAccion);
    tbody.appendChild(fila);
  });
}

async function desactivarAjusteProveedor(id) {
  const confirmado = window.confirm('¿Desactivar este ajuste? Dejará de aplicarse a partir de hoy. Los CxP ya generados no se ven afectados, porque el ajuste queda copiado en cada CxP al generarse.');
  if (!confirmado) return;
  try {
    const fechaFin = window.restarUnDia(window.obtenerFechaMexico());
    await window.actualizarDato('ajustes_precio_proveedor', id, { fechaFin });
    const registro = window.EVE.ajustesPrecioProveedor.find((a) => a.id === id);
    if (registro) registro.fechaFin = fechaFin;
    llenarVistaAjustes();
    window.showSuccess('Ajuste desactivado');
  } catch (error) {
    window.showError(error.message);
  }
}

async function manejarEnvioAjuste(evento) {
  evento.preventDefault();
  const datos = {
    material: document.getElementById('aj-material').value,
    proveedor: document.getElementById('aj-proveedor').value,
    tipoAjuste: document.getElementById('aj-tipo').value,
    valorAjuste: document.getElementById('aj-valor').value,
    fechaInicio: document.getElementById('aj-fecha').value
  };
  try {
    const { cierre, nuevo } = construirNuevoAjustePrecio(datos, window.EVE.ajustesPrecioProveedor);
    if (cierre) {
      await window.actualizarDato('ajustes_precio_proveedor', cierre.id, { fechaFin: cierre.fechaFin });
      const registroCerrado = window.EVE.ajustesPrecioProveedor.find((a) => a.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaFin = cierre.fechaFin;
    }
    const id = await window.guardarDato('ajustes_precio_proveedor', nuevo);
    window.EVE.ajustesPrecioProveedor.push({ id, ...nuevo, fechaRegistro: new Date().toISOString() });
    cerrarModalAjuste();
    llenarVistaAjustes();
    window.showSuccess('Ajuste guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalAjuste() {
  const overlay = document.createElement('div');
  overlay.id = 'ajustes-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Nuevo Ajuste de Precio por Proveedor</h3>
      <form id="ajustes-form">
        <select id="aj-material" required>${opcionesMaterialesHtml()}</select>
        <input type="text" id="aj-proveedor" placeholder="Proveedor" list="ajustes-proveedores-datalist" required>
        <datalist id="ajustes-proveedores-datalist">
          ${window.PROVEEDORES_COMUNES.map((p) => `<option value="${p}">`).join('')}
        </datalist>
        <select id="aj-tipo" required>
          <option value="monto">Monto Fijo</option>
          <option value="porcentaje">Porcentaje</option>
        </select>
        <input type="number" id="aj-valor" placeholder="Valor del ajuste (negativo si es más barato)" step="0.01" required>
        <input type="date" id="aj-fecha" required>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="aj-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#ajustes-form').addEventListener('submit', manejarEnvioAjuste);
  overlay.querySelector('#aj-cancelar').addEventListener('click', () => cerrarModalAjuste());
  return overlay;
}

function abrirModalAjuste() {
  document.getElementById('ajustes-form').reset();
  document.getElementById('aj-fecha').value = window.obtenerFechaMexico();
  document.getElementById('ajustes-modal-overlay').classList.add('open');
}

function cerrarModalAjuste() {
  document.getElementById('ajustes-modal-overlay').classList.remove('open');
}

async function eliminarPrecio(id) {
  const confirmado = window.confirm('¿Eliminar este precio del historial? Los precios ya aplicados a cuentas por pagar existentes no se ven afectados, porque quedan copiados en cada CxP al generarse.');
  if (!confirmado) return;
  try {
    await window.eliminarDato('precios', id);
    window.EVE.precios = window.EVE.precios.filter((p) => p.id !== id);
    llenarSelectorHistorial();
    llenarVistaHistorial();
    window.showSuccess('Precio eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

function renderizarVistaActiva() {
  document.getElementById('precios-vigentes-wrapper').style.display = vistaActiva === 'vigentes' ? '' : 'none';
  document.getElementById('precios-historial-wrapper').style.display = vistaActiva === 'historial' ? '' : 'none';
  document.getElementById('precios-ajustes-wrapper').style.display = vistaActiva === 'ajustes' ? '' : 'none';
  if (vistaActiva === 'vigentes') {
    llenarVistaVigentes();
  } else if (vistaActiva === 'historial') {
    llenarSelectorHistorial();
    llenarVistaHistorial();
  } else {
    llenarVistaAjustes();
  }
}

function renderPrecios(container) {
  vistaActiva = 'vigentes';
  materialHistorialSeleccionado = '';

  container.appendChild(crearBarraAcciones());
  container.appendChild(crearTabsVista());
  container.appendChild(crearVistaVigentes());
  container.appendChild(crearVistaHistorial());
  container.appendChild(crearVistaAjustes());
  container.appendChild(crearModalPrecio());
  container.appendChild(crearModalAjuste());

  renderizarVistaActiva();
}

window.EVE_MODULES.precios = { render: renderPrecios };

})();
