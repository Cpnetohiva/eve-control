(function () {

const PRODUCTOS_VENTA = [
  // PACAS
  'PACAS CRISTAL SIN ETIQUETA',
  'PACAS CRISTAL CON VERDE',
  'PACAS CRISTAL CON ETIQUETA',
  'PACAS SUERO',
  'PACAS LECHERO',
  'PACAS MULTICOLOR',
  'PACAS POLIETILENO',
  'PACAS POLIPROPILENO',
  // MOLIDOS
  'LECHERO MOLIDO',
  'SUERO MOLIDO',
  'POLIPROPILENO MOLIDO',
  'POLIETILENO MOLIDO',
  // PELETIZADOS
  'LECHERO PELETIZADO',
  'POLIETILENO PELETIZADO',
  'POLIPROPILENO PELETIZADO',
  // PRODUCTOS TERMINADOS (Inyección/Soplado)
  'CAJA CO30',
  'CAJA CH25',
  'CAJA AGRO20',
  'TAMBO'
];

const UNIDAD_POR_PRODUCTO = {
  'CAJA CO30': 'PZ',
  'CAJA CH25': 'PZ',
  'CAJA AGRO20': 'PZ',
  'TAMBO': 'PZ'
};

function unidadParaProducto(material) {
  const mat = (material || '').toString().trim().toUpperCase();
  return UNIDAD_POR_PRODUCTO[mat] || 'KG';
}

function calcularSubtotal(cantidad, precioUnitario) {
  const c = Number(cantidad);
  const p = Number(precioUnitario);
  return (Number.isFinite(c) ? c : 0) * (Number.isFinite(p) ? p : 0);
}

function calcularTotalVenta(lineas) {
  return (lineas || []).reduce((suma, l) => suma + (Number(l.subtotal) || 0), 0);
}

function construirLineasDesdeFormulario(lineasFormulario) {
  if (!lineasFormulario || lineasFormulario.length === 0) {
    throw new Error('Debe agregar al menos un producto');
  }
  return lineasFormulario.map((l) => {
    const material = (l.material || '').toString().trim().toUpperCase();
    if (!material) {
      throw new Error('Selecciona un material en todas las líneas');
    }
    const cantidad = Number(l.cantidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      throw new Error(`Cantidad inválida para ${material}`);
    }
    const precioUnitario = Number(l.precioUnitario);
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
      throw new Error(`Precio inválido para ${material}`);
    }
    const unidad = unidadParaProducto(material);
    return { material, cantidad, unidad, precioUnitario, subtotal: calcularSubtotal(cantidad, precioUnitario) };
  });
}

function construirVentaDesdeFormulario(datos) {
  if (!datos.cliente || !datos.cliente.toString().trim()) {
    throw new Error('El cliente es obligatorio');
  }
  if (!datos.fecha) {
    throw new Error('La fecha es obligatoria');
  }
  const lineas = construirLineasDesdeFormulario(datos.lineas);
  const venta = {
    cliente: datos.cliente.toString().trim().toUpperCase(),
    fecha: datos.fecha,
    lineas,
    totalVenta: calcularTotalVenta(lineas),
    observaciones: (datos.observaciones || '').toString().trim()
  };
  const ticketsOrigen = (datos.ticketsOrigen || '')
    .toString()
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  if (ticketsOrigen.length > 0) {
    venta.ticketsOrigen = ticketsOrigen;
  }
  return venta;
}

function generarFolio(ventas, fecha) {
  const anio = (fecha || window.obtenerFechaMexico()).split('-')[0];
  const prefijo = `V-${anio}-`;
  let maxN = 0;
  (ventas || []).forEach((v) => {
    if (v.folio && v.folio.startsWith(prefijo)) {
      const n = parseInt(v.folio.slice(prefijo.length), 10);
      if (Number.isFinite(n) && n > maxN) maxN = n;
    }
  });
  return `${prefijo}${String(maxN + 1).padStart(3, '0')}`;
}

function filtrarPorHoyVentas(ventas, hoy) {
  return ventas.filter((v) => v.fecha === hoy);
}

function filtrarPorSemanaVentas(ventas, inicioSemana) {
  return ventas.filter((v) => v.fecha >= inicioSemana);
}

function ventaContieneMaterial(venta, material) {
  const buscado = material.toLowerCase();
  return (venta.lineas || []).some((l) => l.material.toLowerCase().includes(buscado));
}

function dentroDeRangoFechaVenta(fecha, desde, hasta) {
  if (desde && fecha < desde) return false;
  if (hasta && fecha > hasta) return false;
  return true;
}

function aplicarFiltrosVentas(ventas, filtros) {
  const cliente = (filtros.cliente || '').toLowerCase();
  const material = (filtros.material || '').toLowerCase();
  const montoDesde = filtros.montoDesde !== '' && filtros.montoDesde !== undefined ? Number(filtros.montoDesde) : null;
  const montoHasta = filtros.montoHasta !== '' && filtros.montoHasta !== undefined ? Number(filtros.montoHasta) : null;
  return ventas.filter((v) => {
    if (cliente && !String(v.cliente).toLowerCase().includes(cliente)) return false;
    if (material && !ventaContieneMaterial(v, material)) return false;
    if (!dentroDeRangoFechaVenta(v.fecha, filtros.desde, filtros.hasta)) return false;
    if (montoDesde !== null && Number(v.totalVenta) < montoDesde) return false;
    if (montoHasta !== null && Number(v.totalVenta) > montoHasta) return false;
    return true;
  });
}

function agregarPorMaterialVentas(ventas) {
  const mapa = new Map();
  ventas.forEach((v) => {
    (v.lineas || []).forEach((l) => {
      const actual = mapa.get(l.material) || { cantidad: 0, unidad: l.unidad };
      actual.cantidad += Number(l.cantidad) || 0;
      mapa.set(l.material, actual);
    });
  });
  return Array.from(mapa.entries())
    .map(([material, info]) => ({ material, cantidad: info.cantidad, unidad: info.unidad }))
    .sort((a, b) => b.cantidad - a.cantidad);
}

function registrosDestarajeVentaSinMigrar() {
  return (window.EVE.registrosVentas || []).filter((r) => r.migrado !== true);
}

function construirVentaDesdeRegistroLegado(registro) {
  const material = (registro.material || '').toString().trim().toUpperCase();
  const linea = {
    material,
    cantidad: Number(registro.kg) || 0,
    unidad: unidadParaProducto(material),
    precioUnitario: 0,
    subtotal: 0
  };
  const venta = {
    cliente: (registro.proveedor || '').toString().trim().toUpperCase(),
    fecha: registro.fechaSalida || registro.fechaEntrada || window.obtenerFechaMexico(),
    lineas: [linea],
    totalVenta: 0,
    observaciones: 'Migrado desde Destaraje (ticket V). Verificar precio.',
    registradoPor: 'Migración'
  };
  if (registro.ticketOrigen) {
    venta.ticketsOrigen = [registro.ticketOrigen];
  }
  return venta;
}

window.unidadParaProducto = unidadParaProducto;
window.calcularSubtotal = calcularSubtotal;
window.calcularTotalVenta = calcularTotalVenta;
window.construirLineasDesdeFormulario = construirLineasDesdeFormulario;
window.construirVentaDesdeFormulario = construirVentaDesdeFormulario;
window.generarFolio = generarFolio;
window.filtrarPorHoyVentas = filtrarPorHoyVentas;
window.filtrarPorSemanaVentas = filtrarPorSemanaVentas;
window.aplicarFiltrosVentas = aplicarFiltrosVentas;
window.agregarPorMaterialVentas = agregarPorMaterialVentas;
window.registrosDestarajeVentaSinMigrar = registrosDestarajeVentaSinMigrar;
window.construirVentaDesdeRegistroLegado = construirVentaDesdeRegistroLegado;

// ── Migración de registros legados (Destaraje ticket "V") ───────────────────

async function migrarRegistroDestarajeAVenta(registro) {
  const venta = construirVentaDesdeRegistroLegado(registro);
  venta.folio = generarFolio(window.EVE.ventas, venta.fecha);
  const id = await window.guardarDato('ventas', venta);
  window.EVE.ventas.push({ id, ...venta, fechaRegistro: new Date().toISOString() });
  await window.actualizarDato('destaraje', registro.id, { migrado: true });
  registro.migrado = true;
}

async function migrarRegistrosDestaraje() {
  if (!navigator.onLine) {
    throw new Error('Necesitas conexión a internet para migrar los registros');
  }
  const pendientes = registrosDestarajeVentaSinMigrar();
  let migrados = 0;
  for (const registro of pendientes) {
    await migrarRegistroDestarajeAVenta(registro);
    migrados++;
  }
  return migrados;
}

// ── UI ────────────────────────────────────────────────────────────────────

let editandoId = null;
let gestorLineasFormulario = null;
let gestorLineasEdicion = null;
let tabActiva = 'hoy';
let filtros = { cliente: '', material: '', desde: '', hasta: '', montoDesde: '', montoHasta: '' };

function puedeVerPreciosActual() {
  const permissions = (window.EVE.currentUser && window.EVE.currentUser.permissions) || {};
  return permissions.ventas_precios === true;
}

function llenarDatalist(id, valores) {
  const datalist = document.getElementById(id);
  if (!datalist) return;
  datalist.innerHTML = '';
  valores.forEach((valor) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    datalist.appendChild(opcion);
  });
}

function actualizarDatalistsVentas() {
  const clientes = new Set();
  (window.EVE.ventas || []).forEach((v) => { if (v.cliente) clientes.add(v.cliente); });
  (window.EVE.registrosVentas || []).forEach((r) => { if (r.proveedor) clientes.add(String(r.proveedor).toUpperCase()); });
  llenarDatalist('dl-ventas-clientes', Array.from(clientes).sort());

  const materiales = new Set(PRODUCTOS_VENTA);
  (window.EVE.ventas || []).forEach((v) => (v.lineas || []).forEach((l) => materiales.add(l.material)));
  llenarDatalist('dl-productos-venta', Array.from(materiales).sort());
}

function leerLineaDesdeFila(fila) {
  return {
    material: fila.querySelector('.vl-material').value,
    cantidad: fila.querySelector('.vl-cantidad').value,
    precioUnitario: fila.querySelector('.vl-precio').value
  };
}

function leerLineasDesdeContenedor(contenedor) {
  return Array.from(contenedor.querySelectorAll('.venta-linea')).map(leerLineaDesdeFila);
}

function crearFilaLinea(puedeVerPrecios, onCambio, obtenerFechaActual, precarga) {
  const fila = document.createElement('div');
  fila.className = 'venta-linea';

  const inputMaterial = document.createElement('input');
  inputMaterial.type = 'text';
  inputMaterial.className = 'vl-material';
  inputMaterial.placeholder = 'Material';
  inputMaterial.setAttribute('list', 'dl-productos-venta');
  inputMaterial.required = true;
  if (precarga && precarga.material) inputMaterial.value = precarga.material;

  const inputCantidad = document.createElement('input');
  inputCantidad.type = 'number';
  inputCantidad.className = 'vl-cantidad';
  inputCantidad.placeholder = 'Cantidad';
  inputCantidad.step = '0.01';
  inputCantidad.required = true;
  if (precarga && precarga.cantidad !== undefined) inputCantidad.value = precarga.cantidad;

  const spanUnidad = document.createElement('span');
  spanUnidad.className = 'vl-unidad';

  const inputPrecio = document.createElement('input');
  inputPrecio.type = 'number';
  inputPrecio.className = 'vl-precio';
  inputPrecio.placeholder = 'Precio';
  inputPrecio.step = '0.01';
  inputPrecio.required = true;
  if (precarga && precarga.precioUnitario !== undefined) inputPrecio.value = precarga.precioUnitario;
  if (!puedeVerPrecios) {
    inputPrecio.style.display = 'none';
  }

  const spanSubtotal = document.createElement('span');
  spanSubtotal.className = 'vl-subtotal';

  const botonEliminar = document.createElement('button');
  botonEliminar.type = 'button';
  botonEliminar.className = 'btn-secondary';
  botonEliminar.textContent = '🗑️';
  botonEliminar.addEventListener('click', () => {
    fila.remove();
    onCambio();
  });

  function recalcular() {
    spanUnidad.textContent = unidadParaProducto(inputMaterial.value);
    if (!puedeVerPrecios) {
      const fecha = (obtenerFechaActual && obtenerFechaActual()) || window.obtenerFechaMexico();
      const precioInfo = window.obtenerPrecioVigente(inputMaterial.value, fecha);
      inputPrecio.value = precioInfo ? precioInfo.precio : 0;
    }
    spanSubtotal.textContent = window.formatearMoneda(calcularSubtotal(inputCantidad.value, inputPrecio.value));
    onCambio();
  }

  inputMaterial.addEventListener('input', recalcular);
  inputCantidad.addEventListener('input', recalcular);
  inputPrecio.addEventListener('input', recalcular);

  fila.appendChild(inputMaterial);
  fila.appendChild(inputCantidad);
  fila.appendChild(spanUnidad);
  fila.appendChild(inputPrecio);
  fila.appendChild(spanSubtotal);
  fila.appendChild(botonEliminar);

  recalcular();
  return fila;
}

function crearGestorLineas(puedeVerPrecios, obtenerFechaActual, onCambioTotal) {
  const contenedor = document.createElement('div');
  contenedor.className = 'venta-lineas-wrapper';

  function recalcularTotal() {
    const lineas = leerLineasDesdeContenedor(contenedor).map((l) => ({
      subtotal: calcularSubtotal(l.cantidad, l.precioUnitario)
    }));
    onCambioTotal(calcularTotalVenta(lineas));
  }

  function agregarLinea(precarga) {
    contenedor.appendChild(crearFilaLinea(puedeVerPrecios, recalcularTotal, obtenerFechaActual, precarga));
    recalcularTotal();
  }

  function obtenerLineasFormulario() {
    return leerLineasDesdeContenedor(contenedor);
  }

  function limpiar() {
    contenedor.innerHTML = '';
  }

  return { contenedor, agregarLinea, obtenerLineasFormulario, limpiar, recalcularTotal };
}

function resumenMateriales(venta) {
  return (venta.lineas || [])
    .map((l) => `${l.material} (${Number(l.cantidad).toLocaleString('es-MX')} ${l.unidad})`)
    .join(', ');
}

// ── Formulario de nueva venta ────────────────────────────────────────────

function aplicarResultadoVoz(texto) {
  let datos;
  try {
    datos = window.parseVenta(texto);
  } catch (error) {
    window.showError(error.message);
    return;
  }
  document.getElementById('vt-cliente').value = datos.cliente.toUpperCase();
  if (!document.getElementById('vt-fecha').value) {
    document.getElementById('vt-fecha').value = window.obtenerFechaMexico();
  }
  gestorLineasFormulario.limpiar();
  gestorLineasFormulario.agregarLinea({
    material: datos.material.toUpperCase(),
    cantidad: datos.cantidad,
    precioUnitario: datos.precioUnitario
  });
  window.showSuccess('Datos reconocidos, revisa y guarda');
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  try {
    const datos = {
      cliente: document.getElementById('vt-cliente').value,
      fecha: document.getElementById('vt-fecha').value,
      lineas: gestorLineasFormulario.obtenerLineasFormulario(),
      ticketsOrigen: document.getElementById('vt-ticketsorigen').value,
      observaciones: document.getElementById('vt-observaciones').value
    };
    const venta = construirVentaDesdeFormulario(datos);
    venta.folio = generarFolio(window.EVE.ventas, venta.fecha);
    venta.registradoPor = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
    const id = await window.guardarDato('ventas', venta);
    window.EVE.ventas.push({ id, ...venta, fechaRegistro: new Date().toISOString() });

    document.getElementById('ventas-form').reset();
    gestorLineasFormulario.limpiar();
    gestorLineasFormulario.agregarLinea();
    document.getElementById('vt-fecha').value = window.obtenerFechaMexico();
    document.getElementById('vt-folio-preview').innerHTML = `<strong>Folio:</strong> ${generarFolio(window.EVE.ventas, window.obtenerFechaMexico())}`;

    actualizarDatalistsVentas();
    renderizarVista();
    window.showSuccess('Venta registrada');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearFormulario() {
  const puedeVerPrecios = puedeVerPreciosActual();

  const form = document.createElement('form');
  form.id = 'ventas-form';
  form.className = 'card destaraje-form';

  const folioPreview = document.createElement('p');
  folioPreview.id = 'vt-folio-preview';
  folioPreview.innerHTML = `<strong>Folio:</strong> ${generarFolio(window.EVE.ventas, window.obtenerFechaMexico())}`;
  form.appendChild(folioPreview);

  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.innerHTML = `
    <input type="text" id="vt-cliente" placeholder="Cliente" list="dl-ventas-clientes" required>
    <input type="date" id="vt-fecha" required>
  `;
  form.appendChild(grid);

  const gestor = crearGestorLineas(
    puedeVerPrecios,
    () => document.getElementById('vt-fecha').value,
    (total) => { document.getElementById('vt-total').textContent = window.formatearMoneda(total); }
  );
  gestorLineasFormulario = gestor;
  form.appendChild(gestor.contenedor);

  const botonAgregar = document.createElement('button');
  botonAgregar.type = 'button';
  botonAgregar.className = 'btn-secondary';
  botonAgregar.textContent = '+ Agregar otro producto';
  botonAgregar.addEventListener('click', () => gestor.agregarLinea());
  form.appendChild(botonAgregar);

  const total = document.createElement('p');
  total.className = 'venta-total';
  total.innerHTML = 'TOTAL VENTA: <span id="vt-total">$0.00</span>';
  form.appendChild(total);

  const gridExtra = document.createElement('div');
  gridExtra.className = 'form-grid';
  gridExtra.innerHTML = `
    <input type="text" id="vt-ticketsorigen" placeholder="Tickets origen (opcional, separados por coma)">
    <input type="text" id="vt-observaciones" placeholder="Observaciones (opcional)">
  `;
  form.appendChild(gridExtra);

  form.addEventListener('submit', manejarEnvioFormulario);
  form.appendChild(window.crearBotonVoz(aplicarResultadoVoz));

  const botonSubmit = document.createElement('button');
  botonSubmit.type = 'submit';
  botonSubmit.className = 'btn-primary';
  botonSubmit.textContent = 'Registrar Venta';
  form.appendChild(botonSubmit);

  return form;
}

// ── Edición ───────────────────────────────────────────────────────────────

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'ventas-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Editar venta</h3>
      <form id="ventas-edit-form">
        <p><strong>Folio:</strong> <span id="ve-folio"></span></p>
        <div class="form-grid">
          <input type="text" id="ve-cliente" placeholder="Cliente" list="dl-ventas-clientes" required>
          <input type="date" id="ve-fecha" required>
        </div>
      </form>
    </div>
  `;
  const form = overlay.querySelector('#ventas-edit-form');

  const gestor = crearGestorLineas(
    true,
    () => document.getElementById('ve-fecha').value,
    (total) => { document.getElementById('ve-total').textContent = window.formatearMoneda(total); }
  );
  gestorLineasEdicion = gestor;
  form.appendChild(gestor.contenedor);

  const botonAgregar = document.createElement('button');
  botonAgregar.type = 'button';
  botonAgregar.className = 'btn-secondary';
  botonAgregar.textContent = '+ Agregar otro producto';
  botonAgregar.addEventListener('click', () => gestor.agregarLinea());
  form.appendChild(botonAgregar);

  const total = document.createElement('p');
  total.className = 'venta-total';
  total.innerHTML = 'TOTAL VENTA: <span id="ve-total">$0.00</span>';
  form.appendChild(total);

  const gridExtra = document.createElement('div');
  gridExtra.className = 'form-grid';
  gridExtra.innerHTML = `
    <input type="text" id="ve-ticketsorigen" placeholder="Tickets origen (opcional, separados por coma)">
    <input type="text" id="ve-observaciones" placeholder="Observaciones (opcional)">
  `;
  form.appendChild(gridExtra);

  const motivo = document.createElement('textarea');
  motivo.id = 've-motivo';
  motivo.placeholder = 'Motivo del cambio (opcional)';
  motivo.rows = 2;
  motivo.style.cssText = 'width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical';
  form.appendChild(motivo);

  const botonGuardar = document.createElement('button');
  botonGuardar.type = 'submit';
  botonGuardar.className = 'btn-primary';
  botonGuardar.textContent = 'Guardar cambios';
  form.appendChild(botonGuardar);

  const botonCancelar = document.createElement('button');
  botonCancelar.type = 'button';
  botonCancelar.id = 've-cancelar';
  botonCancelar.className = 'btn-secondary';
  botonCancelar.textContent = 'Cancelar';
  botonCancelar.addEventListener('click', () => cerrarModalEdicion());
  form.appendChild(botonCancelar);

  form.addEventListener('submit', manejarEnvioEdicion);
  return overlay;
}

function abrirModalEdicion(venta) {
  editandoId = venta.id;
  document.getElementById('ve-folio').textContent = venta.folio;
  document.getElementById('ve-cliente').value = venta.cliente;
  document.getElementById('ve-fecha').value = venta.fecha;
  document.getElementById('ve-ticketsorigen').value = (venta.ticketsOrigen || []).join(', ');
  document.getElementById('ve-observaciones').value = venta.observaciones || '';
  gestorLineasEdicion.limpiar();
  (venta.lineas || []).forEach((l) => gestorLineasEdicion.agregarLinea(l));
  document.getElementById('ventas-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('ventas-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const anterior = (window.EVE.ventas || []).find((v) => v.id === editandoId);
  const motivo = document.getElementById('ve-motivo').value.trim();
  try {
    const datos = {
      cliente: document.getElementById('ve-cliente').value,
      fecha: document.getElementById('ve-fecha').value,
      lineas: gestorLineasEdicion.obtenerLineasFormulario(),
      ticketsOrigen: document.getElementById('ve-ticketsorigen').value,
      observaciones: document.getElementById('ve-observaciones').value
    };
    const ventaConstruida = construirVentaDesdeFormulario(datos);
    await window.actualizarDato('ventas', editandoId, ventaConstruida);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'ventas',
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior ? { cliente: anterior.cliente, fecha: anterior.fecha, lineas: anterior.lineas, totalVenta: anterior.totalVenta } : null,
      valorNuevo: ventaConstruida,
      motivo
    });
    const indice = window.EVE.ventas.findIndex((v) => v.id === editandoId);
    if (indice !== -1) {
      window.EVE.ventas[indice] = { ...window.EVE.ventas[indice], ...ventaConstruida };
    }
    document.getElementById('ve-motivo').value = '';
    cerrarModalEdicion();
    actualizarDatalistsVentas();
    renderizarVista();
    window.showSuccess('Venta actualizada');
  } catch (error) {
    window.showError(error.message);
  }
}

async function confirmarEliminar(id) {
  const venta = (window.EVE.ventas || []).find((v) => v.id === id);
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato('ventas', id);
    window.EVE_HISTORIAL.registrar({
      coleccion: 'ventas',
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: venta ? { cliente: venta.cliente, fecha: venta.fecha, lineas: venta.lineas, totalVenta: venta.totalVenta } : null,
      valorNuevo: null,
      motivo
    });
    const indice = window.EVE.ventas.findIndex((v) => v.id === id);
    if (indice !== -1) window.EVE.ventas.splice(indice, 1);
    renderizarVista();
    window.showSuccess('Venta eliminada');
  } catch (error) {
    window.showError(error.message);
  }
}

// ── Migración: botón ─────────────────────────────────────────────────────

function crearBotonMigracion() {
  const boton = document.createElement('button');
  boton.id = 'ventas-btn-migrar';
  boton.className = 'btn-secondary';
  boton.style.display = 'none';
  boton.addEventListener('click', async () => {
    const pendientes = registrosDestarajeVentaSinMigrar();
    if (!pendientes.length) return;
    const confirmado = window.confirm(
      `¿Migrar ${pendientes.length} registro(s) de ventas antiguas (ticket V de Destaraje) a la nueva colección Ventas? Los registros originales se conservarán marcados como migrados.`
    );
    if (!confirmado) return;
    boton.disabled = true;
    try {
      const n = await migrarRegistrosDestaraje();
      window.showSuccess(`${n} registro(s) migrado(s) a Ventas`);
      actualizarDatalistsVentas();
      renderizarVista();
    } catch (error) {
      window.showError(error.message);
    } finally {
      boton.disabled = false;
    }
  });
  return boton;
}

function actualizarBotonMigracion() {
  const boton = document.getElementById('ventas-btn-migrar');
  if (!boton) return;
  const pendientes = registrosDestarajeVentaSinMigrar().length;
  boton.style.display = pendientes > 0 ? '' : 'none';
  boton.textContent = `⚠️ Migrar ${pendientes} registro(s) antiguos de Destaraje`;
}

// ── Tabs, filtros y tabla ────────────────────────────────────────────────

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  const definiciones = [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'todas', nombre: 'Todas' }
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
  div.id = 'ventas-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';
  const campos = [
    { id: 'vf-cliente', etiqueta: 'Cliente', tipo: 'text' },
    { id: 'vf-material', etiqueta: 'Material', tipo: 'text' },
    { id: 'vf-desde', etiqueta: 'Desde', tipo: 'date' },
    { id: 'vf-hasta', etiqueta: 'Hasta', tipo: 'date' },
    { id: 'vf-montodesde', etiqueta: 'Monto desde', tipo: 'number' },
    { id: 'vf-montohasta', etiqueta: 'Monto hasta', tipo: 'number' }
  ];
  campos.forEach((campo) => {
    const contenedor = document.createElement('label');
    contenedor.className = 'filtro-campo';
    const etiqueta = document.createElement('span');
    etiqueta.textContent = campo.etiqueta;
    contenedor.appendChild(etiqueta);
    const input = document.createElement('input');
    input.type = campo.tipo;
    input.id = campo.id;
    input.addEventListener('input', () => {
      filtros = {
        cliente: document.getElementById('vf-cliente').value,
        material: document.getElementById('vf-material').value,
        desde: document.getElementById('vf-desde').value,
        hasta: document.getElementById('vf-hasta').value,
        montoDesde: document.getElementById('vf-montodesde').value,
        montoHasta: document.getElementById('vf-montohasta').value
      };
      renderizarVista();
    });
    contenedor.appendChild(input);
    div.appendChild(contenedor);
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
      <tr><th>Folio</th><th>Cliente</th><th>Fecha</th><th>Materiales</th><th>Total</th><th></th></tr>
    </thead>
    <tbody id="ventas-tabla-body"></tbody>
  `;
  wrapper.appendChild(tabla);
  return wrapper;
}

function construirFilaTabla(venta) {
  const fila = document.createElement('tr');
  const valores = [venta.folio, venta.cliente, window.formatearFecha(venta.fecha), resumenMateriales(venta), window.formatearMoneda(venta.totalVenta)];
  valores.forEach((valor) => {
    const celda = document.createElement('td');
    celda.textContent = valor;
    fila.appendChild(celda);
  });
  const celdaAcciones = document.createElement('td');
  const botonEditar = document.createElement('button');
  botonEditar.textContent = 'Editar';
  botonEditar.className = 'btn-secondary';
  botonEditar.addEventListener('click', () => abrirModalEdicion(venta));
  const botonEliminar = document.createElement('button');
  botonEliminar.textContent = 'Eliminar';
  botonEliminar.className = 'btn-secondary';
  botonEliminar.addEventListener('click', () => confirmarEliminar(venta.id));
  celdaAcciones.appendChild(botonEditar);
  celdaAcciones.appendChild(botonEliminar);
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(ventas) {
  const tbody = document.getElementById('ventas-tabla-body');
  tbody.innerHTML = '';
  if (ventas.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 6;
    celda.textContent = 'Sin ventas';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  ventas.forEach((v) => tbody.appendChild(construirFilaTabla(v)));
}

function obtenerVentasParaTab() {
  let ventas = window.EVE.ventas || [];
  if (tabActiva === 'hoy') {
    ventas = filtrarPorHoyVentas(ventas, window.obtenerFechaMexico());
  } else if (tabActiva === 'semana') {
    ventas = filtrarPorSemanaVentas(ventas, window.obtenerInicioSemana());
  } else {
    ventas = aplicarFiltrosVentas(ventas, filtros);
  }
  return ventas.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

function renderizarStats(ventas) {
  const total = ventas.reduce((s, v) => s + (Number(v.totalVenta) || 0), 0);
  const contenedor = document.getElementById('ventas-stats');
  contenedor.innerHTML = '';
  [`Ventas: ${ventas.length}`, `Total: ${window.formatearMoneda(total)}`].forEach((texto) => {
    const span = document.createElement('span');
    span.textContent = texto;
    contenedor.appendChild(span);
  });
}

function renderizarVista() {
  document.getElementById('ventas-filtros').style.display = tabActiva === 'todas' ? '' : 'none';
  const ventas = obtenerVentasParaTab();
  renderizarStats(ventas);
  llenarTabla(ventas);
  actualizarBotonMigracion();
}

// ── Exportaciones ────────────────────────────────────────────────────────

function generarTXTVentas(ventas, periodo) {
  const lineas = [];
  lineas.push('REPORTE DE VENTAS');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.formatearFecha(window.obtenerFechaMexico())}`);
  lineas.push('');
  const total = ventas.reduce((s, v) => s + (Number(v.totalVenta) || 0), 0);
  lineas.push(`NUMERO DE VENTAS: ${ventas.length}`);
  lineas.push(`TOTAL VENTAS: ${window.formatearMoneda(total)}`);
  lineas.push('');
  lineas.push('DESGLOSE POR MATERIAL:');
  agregarPorMaterialVentas(ventas).forEach((item) => {
    lineas.push(`  ${item.material}  ${item.cantidad.toLocaleString('es-MX')} ${item.unidad}`);
  });
  lineas.push('');
  lineas.push('DETALLE DE VENTAS:');
  lineas.push('  FOLIO  CLIENTE  FECHA  MATERIALES  TOTAL');
  ventas.forEach((v) => {
    lineas.push(`  ${v.folio}  ${v.cliente}  ${window.formatearFecha(v.fecha)}  ${resumenMateriales(v)}  ${window.formatearMoneda(v.totalVenta)}`);
  });
  return lineas.join('\n');
}

function generarPDFVentas(ventas, periodo) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('REPORTE DE VENTAS', anchoPagina / 2, y, { align: 'center' });
  y += 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.formatearFecha(window.obtenerFechaMexico())}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;
  const total = ventas.reduce((s, v) => s + (Number(v.totalVenta) || 0), 0);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(`TOTAL VENTAS: ${window.formatearMoneda(total)}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;
  doc.autoTable({
    startY: y,
    head: [['FOLIO', 'CLIENTE', 'FECHA', 'MATERIALES', 'TOTAL']],
    body: ventas.map((v) => [v.folio, v.cliente, window.formatearFecha(v.fecha), resumenMateriales(v), window.formatearMoneda(v.totalVenta)]),
    headStyles: { fillColor: [0, 29, 61] }
  });
  return doc;
}

function construirFilasCSVVentas(ventas) {
  const filas = [];
  ventas.forEach((v) => {
    (v.lineas || []).forEach((l) => {
      filas.push({
        folio: v.folio,
        cliente: v.cliente,
        fecha: v.fecha,
        material: l.material,
        cantidad: l.cantidad,
        unidad: l.unidad,
        precioUnitario: l.precioUnitario,
        subtotal: l.subtotal,
        totalVenta: v.totalVenta
      });
    });
  });
  return filas;
}

function exportarVentasTXT() {
  const periodo = window.obtenerRangoYEtiqueta(tabActiva, filtros);
  const ventas = obtenerVentasParaTab();
  const texto = generarTXTVentas(ventas, periodo);
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, `Reporte_Ventas_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.txt`);
}

function exportarVentasPDF() {
  const periodo = window.obtenerRangoYEtiqueta(tabActiva, filtros);
  const ventas = obtenerVentasParaTab();
  const doc = generarPDFVentas(ventas, periodo);
  doc.save(`Reporte_Ventas_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
}

function exportarVentasCSV() {
  const periodo = window.obtenerRangoYEtiqueta(tabActiva, filtros);
  const ventas = obtenerVentasParaTab();
  window.exportarCSV(construirFilasCSVVentas(ventas), `Reporte_Ventas_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`);
}

async function exportarVentasTelegram() {
  const periodo = window.obtenerRangoYEtiqueta(tabActiva, filtros);
  const ventas = obtenerVentasParaTab();
  try {
    const configDoc = await window.db.collection('config').doc('telegram').get();
    if (!configDoc.exists) throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
    const { token, chatId } = configDoc.data();
    if (!token || !chatId) throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');

    const total = ventas.reduce((s, v) => s + (Number(v.totalVenta) || 0), 0);
    const mensaje = [
      '🛒 REPORTE DE VENTAS',
      `Periodo: ${periodo.etiquetaPeriodo}`,
      '',
      `Total: ${window.formatearMoneda(total)}`,
      `Número de ventas: ${ventas.length}`
    ].join('\n');
    const formDataMensaje = new FormData();
    formDataMensaje.append('chat_id', chatId);
    formDataMensaje.append('text', mensaje);
    const respuestaMensaje = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', body: formDataMensaje });
    const resultadoMensaje = await respuestaMensaje.json();
    if (!resultadoMensaje.ok) throw new Error(`Telegram rechazó el mensaje: ${resultadoMensaje.description || 'error desconocido'}`);

    const doc = generarPDFVentas(ventas, periodo);
    const pdfBlob = doc.output('blob');
    const formData = new FormData();
    formData.append('chat_id', chatId);
    formData.append('document', pdfBlob, `Reporte_Ventas_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
    const respuestaDocumento = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: formData });
    const resultadoDocumento = await respuestaDocumento.json();
    if (!resultadoDocumento.ok) throw new Error(`Telegram rechazó el PDF: ${resultadoDocumento.description || 'error desconocido'}`);

    window.showSuccess('Reporte enviado a Telegram');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearBotonesExportar() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  const acciones = [
    { texto: 'TXT', fn: exportarVentasTXT },
    { texto: 'PDF', fn: exportarVentasPDF },
    { texto: 'CSV', fn: exportarVentasCSV },
    { texto: 'Telegram', fn: exportarVentasTelegram }
  ];
  acciones.forEach((accion) => {
    const boton = document.createElement('button');
    boton.textContent = accion.texto;
    boton.className = 'btn-secondary';
    boton.addEventListener('click', accion.fn);
    div.appendChild(boton);
  });
  return div;
}

// ── Registro del módulo ──────────────────────────────────────────────────

function renderVentas(container) {
  tabActiva = 'hoy';
  filtros = { cliente: '', material: '', desde: '', hasta: '', montoDesde: '', montoHasta: '' };
  editandoId = null;

  const dlProductos = document.createElement('datalist');
  dlProductos.id = 'dl-productos-venta';
  const dlClientes = document.createElement('datalist');
  dlClientes.id = 'dl-ventas-clientes';
  container.appendChild(dlProductos);
  container.appendChild(dlClientes);

  container.appendChild(crearFormulario());
  container.appendChild(crearBotonMigracion());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  const stats = document.createElement('div');
  stats.id = 'ventas-stats';
  stats.className = 'card destaraje-stats';
  container.appendChild(stats);
  container.appendChild(crearBotonesExportar());
  container.appendChild(crearTabla());
  container.appendChild(crearModalEdicion());

  document.getElementById('vt-fecha').value = window.obtenerFechaMexico();
  gestorLineasFormulario.agregarLinea();

  actualizarDatalistsVentas();
  renderizarVista();
}

window.EVE_MODULES.ventas = { render: renderVentas };

})();
