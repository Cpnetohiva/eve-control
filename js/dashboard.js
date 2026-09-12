function obtenerMesCalendario(fechaISO) {
  const fecha = String(fechaISO || '');
  return /^\d{4}-\d{2}-\d{2}/.test(fecha) ? fecha.slice(0, 7) : '';
}

function agruparPorMesY(registros, obtenerFecha, obtenerClave, obtenerValor) {
  const porMes = new Map();
  (registros || []).forEach((registro) => {
    const mes = obtenerMesCalendario(obtenerFecha(registro));
    if (!mes) return;
    const clave = obtenerClave(registro);
    const valor = obtenerValor(registro);
    if (!porMes.has(mes)) porMes.set(mes, new Map());
    const porClave = porMes.get(mes);
    porClave.set(clave, (porClave.get(clave) || 0) + valor);
  });
  return porMes;
}

// Arma la matriz con la clave (material/proveedor) en filas y el mes en columnas,
// más una columna _total por fila (suma de todos los meses para esa clave).
// catalogoBase (opcional): claves que siempre deben aparecer como fila aunque no
// tengan datos en ningún mes (p.ej. el catálogo completo de materiales), para que
// la tabla no dependa únicamente de qué apareció en los documentos existentes.
function construirMatrizMesClave(mapaPorMes, catalogoBase) {
  const meses = Array.from(mapaPorMes.keys()).sort();
  const clavesSet = new Set(catalogoBase || []);
  mapaPorMes.forEach((porClave) => {
    porClave.forEach((_, clave) => clavesSet.add(clave));
  });
  const claves = Array.from(clavesSet).sort();
  const filas = claves.map((clave) => {
    const fila = { clave };
    let total = 0;
    meses.forEach((mes) => {
      const porClave = mapaPorMes.get(mes);
      const valor = (porClave && porClave.get(clave)) || 0;
      fila[mes] = valor;
      total += valor;
    });
    fila._total = total;
    return fila;
  });
  return { meses, claves, filas };
}

function agregarCxPPorProveedorYMaterial(cuentas) {
  const porProveedor = new Map();
  (cuentas || []).filter((c) => Number(c.saldo) > 0).forEach((cuenta) => {
    const proveedor = window.normalizarProveedor(cuenta.proveedor) || '(Sin proveedor)';
    const material = window.normalizarMaterial(cuenta.material) || '(Sin material)';
    if (!porProveedor.has(proveedor)) porProveedor.set(proveedor, new Map());
    const porMaterial = porProveedor.get(proveedor);
    if (!porMaterial.has(material)) {
      porMaterial.set(material, { material, total: 0, pagado: 0, saldo: 0, cantidad: 0 });
    }
    const acumulado = porMaterial.get(material);
    acumulado.total += Number(cuenta.total) || 0;
    acumulado.pagado += Number(cuenta.pagado) || 0;
    acumulado.saldo += Number(cuenta.saldo) || 0;
    acumulado.cantidad += 1;
  });
  return Array.from(porProveedor.entries()).map(([proveedor, porMaterial]) => {
    const materiales = Array.from(porMaterial.values()).sort((a, b) => b.saldo - a.saldo);
    const totalProveedor = materiales.reduce((s, m) => s + m.total, 0);
    const pagadoProveedor = materiales.reduce((s, m) => s + m.pagado, 0);
    const saldoProveedor = materiales.reduce((s, m) => s + m.saldo, 0);
    const ticketsProveedor = materiales.reduce((s, m) => s + m.cantidad, 0);
    return { proveedor, materiales, totalProveedor, pagadoProveedor, saldoProveedor, ticketsProveedor };
  }).sort((a, b) => b.saldoProveedor - a.saldoProveedor);
}

function calcularVistaKgPorMesMaterial() {
  const porMes = agruparPorMesY(
    window.EVE.registrosDestaraje,
    (r) => r.fechaSalida,
    (r) => window.normalizarMaterial(r.material),
    (r) => Number(r.kg) || 0
  );
  return construirMatrizMesClave(porMes, window.MATERIALES_COMUNES);
}

function calcularVistaMontoPorMesMaterial() {
  const porMes = agruparPorMesY(
    window.EVE.cuentasPorPagar,
    (c) => c.fechaTicket,
    (c) => window.normalizarMaterial(c.material),
    (c) => Number(c.total) || 0
  );
  return construirMatrizMesClave(porMes, window.MATERIALES_COMUNES);
}

function calcularVistaPagadoPorMesProveedor() {
  const pagosVigentes = (window.EVE.registrosPagos || []).filter((p) => !p.revertido);
  const porMes = agruparPorMesY(
    pagosVigentes,
    (p) => p.fecha,
    (p) => window.normalizarProveedor(p.proveedor),
    (p) => Number(p.pagado) || 0
  );
  return construirMatrizMesClave(porMes);
}

// Materiales del catálogo de 20 que tienen tickets de destaraje con fechas no
// cubiertas por ningún precio vigente configurado — esos tickets no pueden
// generar su CxP correspondiente hasta que se configure el precio.
function calcularMaterialesSinPrecioVigente() {
  const tickets = window.EVE.registrosDestaraje || [];
  const precios = window.EVE.precios || [];
  const fechasPorMaterial = new Map();
  tickets.forEach((r) => {
    const material = window.normalizarMaterial(r.material);
    const fecha = r.fechaSalida;
    if (!material || !fecha) return;
    if (!fechasPorMaterial.has(material)) fechasPorMaterial.set(material, []);
    fechasPorMaterial.get(material).push(fecha);
  });

  const tieneCobertura = (material, fecha) => precios.some((p) =>
    p.material === material && p.fechaInicio <= fecha && (p.fechaFin === null || p.fechaFin >= fecha)
  );

  return window.MATERIALES_COMUNES.map((material) => {
    const fechas = fechasPorMaterial.get(material) || [];
    if (fechas.length === 0) return null;
    const sinCobertura = fechas.filter((fecha) => !tieneCobertura(material, fecha)).sort();
    if (sinCobertura.length === 0) return null;
    return {
      material,
      ticketsSinPrecio: sinCobertura.length,
      totalTickets: fechas.length,
      desde: sinCobertura[0],
      hasta: sinCobertura[sinCobertura.length - 1]
    };
  }).filter(Boolean).sort((a, b) => b.ticketsSinPrecio - a.ticketsSinPrecio);
}

window.EVE_DASHBOARD = {
  obtenerMesCalendario,
  agruparPorMesY,
  construirMatrizMesClave,
  agregarCxPPorProveedorYMaterial,
  calcularVistaKgPorMesMaterial,
  calcularVistaMontoPorMesMaterial,
  calcularVistaPagadoPorMesProveedor,
  calcularMaterialesSinPrecioVigente
};

let vistaActivaDashboard = 'kg-mes-material';

function crearSubtabsDashboard() {
  const contenedor = document.createElement('div');
  contenedor.className = 'tabs destaraje-subtabs';
  const opciones = [
    { id: 'kg-mes-material', nombre: 'KG por Mes y Material' },
    { id: 'monto-mes-material', nombre: '$ por Mes y Material' },
    { id: 'pagado-mes-proveedor', nombre: 'Pagado por Mes y Proveedor' },
    { id: 'exposicion-actual', nombre: 'Exposición Actual' }
  ];
  opciones.forEach((opcion) => {
    const boton = document.createElement('button');
    boton.className = 'tab';
    boton.textContent = opcion.nombre;
    boton.dataset.tab = opcion.id;
    boton.addEventListener('click', () => {
      vistaActivaDashboard = opcion.id;
      actualizarSubtabsActivosDashboard(contenedor);
      renderizarVistaActivaDashboard();
    });
    contenedor.appendChild(boton);
  });
  return contenedor;
}

function actualizarSubtabsActivosDashboard(contenedor) {
  contenedor.querySelectorAll('.tab').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.tab === vistaActivaDashboard);
  });
}

function renderizarTablaMatriz(wrapper, matriz, etiquetaClave, etiquetaTotal, formatearValor) {
  wrapper.innerHTML = '';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';

  const encabezado = document.createElement('thead');
  const filaEncabezado = document.createElement('tr');
  const thClave = document.createElement('th');
  thClave.textContent = etiquetaClave;
  filaEncabezado.appendChild(thClave);
  matriz.meses.forEach((mes) => {
    const th = document.createElement('th');
    th.textContent = mes;
    filaEncabezado.appendChild(th);
  });
  const thTotal = document.createElement('th');
  thTotal.textContent = etiquetaTotal;
  filaEncabezado.appendChild(thTotal);
  encabezado.appendChild(filaEncabezado);
  tabla.appendChild(encabezado);

  const cuerpo = document.createElement('tbody');
  if (matriz.filas.length === 0) {
    const filaVacia = document.createElement('tr');
    const celdaVacia = document.createElement('td');
    celdaVacia.textContent = 'Sin datos';
    celdaVacia.colSpan = matriz.meses.length + 2;
    filaVacia.appendChild(celdaVacia);
    cuerpo.appendChild(filaVacia);
  }
  matriz.filas.forEach((fila) => {
    const tr = document.createElement('tr');
    const celdaClave = document.createElement('td');
    celdaClave.textContent = fila.clave;
    tr.appendChild(celdaClave);
    matriz.meses.forEach((mes) => {
      const celda = document.createElement('td');
      celda.textContent = formatearValor(fila[mes]);
      tr.appendChild(celda);
    });
    const celdaTotal = document.createElement('td');
    celdaTotal.textContent = formatearValor(fila._total);
    celdaTotal.style.fontWeight = '600';
    tr.appendChild(celdaTotal);
    cuerpo.appendChild(tr);
  });
  tabla.appendChild(cuerpo);
  wrapper.appendChild(tabla);
}

function renderizarTablaExposicionActual(wrapper) {
  wrapper.innerHTML = '';
  const grupos = agregarCxPPorProveedorYMaterial(window.EVE.cuentasPorPagar);
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';

  const encabezado = document.createElement('thead');
  const filaEncabezado = document.createElement('tr');
  ['Proveedor', 'Material', 'Total', 'Pagado', 'Saldo', 'Tickets'].forEach((texto) => {
    const th = document.createElement('th');
    th.textContent = texto;
    filaEncabezado.appendChild(th);
  });
  encabezado.appendChild(filaEncabezado);
  tabla.appendChild(encabezado);

  const cuerpo = document.createElement('tbody');
  if (grupos.length === 0) {
    const filaVacia = document.createElement('tr');
    const celdaVacia = document.createElement('td');
    celdaVacia.textContent = 'Sin cuentas por pagar con saldo pendiente';
    celdaVacia.colSpan = 6;
    filaVacia.appendChild(celdaVacia);
    cuerpo.appendChild(filaVacia);
  }

  let totalGeneral = 0;
  let pagadoGeneral = 0;
  let saldoGeneral = 0;
  let ticketsGeneral = 0;

  grupos.forEach((grupo, indiceGrupo) => {
    grupo.materiales.forEach((m, indice) => {
      const tr = document.createElement('tr');
      if (indiceGrupo > 0 && indice === 0) tr.classList.add('destaraje-fila-separador');
      const celdaProveedor = document.createElement('td');
      celdaProveedor.textContent = indice === 0 ? grupo.proveedor : '';
      const celdaMaterial = document.createElement('td');
      celdaMaterial.textContent = m.material;
      const celdaTotal = document.createElement('td');
      celdaTotal.textContent = window.formatearMoneda(m.total);
      const celdaPagado = document.createElement('td');
      celdaPagado.textContent = window.formatearMoneda(m.pagado);
      const celdaSaldo = document.createElement('td');
      celdaSaldo.textContent = window.formatearMoneda(m.saldo);
      const celdaCantidad = document.createElement('td');
      celdaCantidad.textContent = String(m.cantidad);
      tr.appendChild(celdaProveedor);
      tr.appendChild(celdaMaterial);
      tr.appendChild(celdaTotal);
      tr.appendChild(celdaPagado);
      tr.appendChild(celdaSaldo);
      tr.appendChild(celdaCantidad);
      cuerpo.appendChild(tr);

      totalGeneral += m.total;
      pagadoGeneral += m.pagado;
      saldoGeneral += m.saldo;
      ticketsGeneral += m.cantidad;
    });

    const filaSubtotal = document.createElement('tr');
    filaSubtotal.style.fontWeight = '700';
    const celdaEtiquetaSubtotal = document.createElement('td');
    celdaEtiquetaSubtotal.textContent = `Total ${grupo.proveedor}`;
    const celdaMaterialVacia = document.createElement('td');
    const celdaTotalSubtotal = document.createElement('td');
    celdaTotalSubtotal.textContent = window.formatearMoneda(grupo.totalProveedor);
    const celdaPagadoSubtotal = document.createElement('td');
    celdaPagadoSubtotal.textContent = window.formatearMoneda(grupo.pagadoProveedor);
    const celdaSaldoSubtotal = document.createElement('td');
    celdaSaldoSubtotal.textContent = window.formatearMoneda(grupo.saldoProveedor);
    const celdaCantidadSubtotal = document.createElement('td');
    celdaCantidadSubtotal.textContent = String(grupo.ticketsProveedor);
    filaSubtotal.appendChild(celdaEtiquetaSubtotal);
    filaSubtotal.appendChild(celdaMaterialVacia);
    filaSubtotal.appendChild(celdaTotalSubtotal);
    filaSubtotal.appendChild(celdaPagadoSubtotal);
    filaSubtotal.appendChild(celdaSaldoSubtotal);
    filaSubtotal.appendChild(celdaCantidadSubtotal);
    cuerpo.appendChild(filaSubtotal);
  });

  if (grupos.length > 0) {
    const filaTotal = document.createElement('tr');
    const celdaEtiqueta = document.createElement('td');
    celdaEtiqueta.textContent = 'TOTAL GENERAL';
    celdaEtiqueta.colSpan = 2;
    const celdaTotal = document.createElement('td');
    celdaTotal.textContent = window.formatearMoneda(totalGeneral);
    const celdaPagado = document.createElement('td');
    celdaPagado.textContent = window.formatearMoneda(pagadoGeneral);
    const celdaSaldo = document.createElement('td');
    celdaSaldo.textContent = window.formatearMoneda(saldoGeneral);
    const celdaCantidad = document.createElement('td');
    celdaCantidad.textContent = String(ticketsGeneral);
    filaTotal.appendChild(celdaEtiqueta);
    filaTotal.appendChild(celdaTotal);
    filaTotal.appendChild(celdaPagado);
    filaTotal.appendChild(celdaSaldo);
    filaTotal.appendChild(celdaCantidad);
    cuerpo.appendChild(filaTotal);
  }

  tabla.appendChild(cuerpo);
  wrapper.appendChild(tabla);
}

function formatearKgRedondeado(valor) {
  return `${Math.round(valor || 0).toLocaleString('es-MX')} kg`;
}

function renderizarAlertaMaterialesSinPrecio(wrapper) {
  const faltantes = calcularMaterialesSinPrecioVigente();
  if (faltantes.length === 0) return;
  const aviso = document.createElement('div');
  aviso.style.marginTop = '1rem';
  aviso.appendChild(crearChipDashboard(`⚠️ ${faltantes.length} material(es) del catálogo con tickets sin precio vigente configurado (candidatos a CxP faltantes)`, 'chip-warn'));
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.style.marginTop = '0.5rem';
  tabla.innerHTML = `
    <thead><tr><th>Material</th><th>Tickets sin precio</th><th>De</th><th>A</th></tr></thead>
    <tbody></tbody>
  `;
  const tbody = tabla.querySelector('tbody');
  faltantes.forEach((f) => {
    const tr = document.createElement('tr');
    [f.material, `${f.ticketsSinPrecio} de ${f.totalTickets}`, window.formatearFecha(f.desde), window.formatearFecha(f.hasta)].forEach((valor) => {
      const td = document.createElement('td');
      td.textContent = valor;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  aviso.appendChild(tabla);
  wrapper.appendChild(aviso);
}

function crearChipDashboard(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

const wrappersDashboard = {};

function renderizarVistaActivaDashboard() {
  Object.keys(wrappersDashboard).forEach((id) => {
    wrappersDashboard[id].style.display = id === vistaActivaDashboard ? '' : 'none';
  });
  if (vistaActivaDashboard === 'kg-mes-material') {
    renderizarTablaMatriz(wrappersDashboard['kg-mes-material'], calcularVistaKgPorMesMaterial(), 'Material', 'Total KG', formatearKgRedondeado);
  } else if (vistaActivaDashboard === 'monto-mes-material') {
    renderizarTablaMatriz(wrappersDashboard['monto-mes-material'], calcularVistaMontoPorMesMaterial(), 'Material', 'Total $', window.formatearMoneda);
    renderizarAlertaMaterialesSinPrecio(wrappersDashboard['monto-mes-material']);
  } else if (vistaActivaDashboard === 'pagado-mes-proveedor') {
    renderizarTablaMatriz(wrappersDashboard['pagado-mes-proveedor'], calcularVistaPagadoPorMesProveedor(), 'Proveedor', 'Total Pagado', window.formatearMoneda);
  } else if (vistaActivaDashboard === 'exposicion-actual') {
    renderizarTablaExposicionActual(wrappersDashboard['exposicion-actual']);
  }
}

function renderDashboard(container) {
  container.innerHTML = '';
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Dashboard — Exposición Financiera y Producción';
  tarjeta.appendChild(titulo);

  const subtabs = crearSubtabsDashboard();
  tarjeta.appendChild(subtabs);

  ['kg-mes-material', 'monto-mes-material', 'pagado-mes-proveedor', 'exposicion-actual'].forEach((id) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'card destaraje-tabla-wrapper';
    wrappersDashboard[id] = wrapper;
    tarjeta.appendChild(wrapper);
  });

  container.appendChild(tarjeta);
  actualizarSubtabsActivosDashboard(subtabs);
  renderizarVistaActivaDashboard();
}

window.EVE_MODULES.dashboard = { render: renderDashboard };
