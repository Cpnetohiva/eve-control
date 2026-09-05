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

function construirMatrizMesClave(mapaPorMes) {
  const meses = Array.from(mapaPorMes.keys()).sort();
  const clavesSet = new Set();
  mapaPorMes.forEach((porClave) => {
    porClave.forEach((_, clave) => clavesSet.add(clave));
  });
  const claves = Array.from(clavesSet).sort();
  const filas = meses.map((mes) => {
    const porClave = mapaPorMes.get(mes);
    const fila = { mes };
    let total = 0;
    claves.forEach((clave) => {
      const valor = porClave.get(clave) || 0;
      fila[clave] = valor;
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
    const proveedor = cuenta.proveedor || '(Sin proveedor)';
    const material = cuenta.material || '(Sin material)';
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
    const saldoProveedor = materiales.reduce((s, m) => s + m.saldo, 0);
    return { proveedor, materiales, totalProveedor, saldoProveedor };
  }).sort((a, b) => b.saldoProveedor - a.saldoProveedor);
}

function calcularVistaKgPorMesMaterial() {
  const porMes = agruparPorMesY(
    window.EVE.registrosDestaraje,
    (r) => r.fechaSalida,
    (r) => r.material,
    (r) => Number(r.kg) || 0
  );
  return construirMatrizMesClave(porMes);
}

function calcularVistaMontoPorMesMaterial() {
  const porMes = agruparPorMesY(
    window.EVE.cuentasPorPagar,
    (c) => c.fechaTicket,
    (c) => c.material,
    (c) => Number(c.total) || 0
  );
  return construirMatrizMesClave(porMes);
}

function calcularVistaPagadoPorMesProveedor() {
  const pagosVigentes = (window.EVE.registrosPagos || []).filter((p) => !p.revertido);
  const porMes = agruparPorMesY(
    pagosVigentes,
    (p) => p.fecha,
    (p) => p.proveedor,
    (p) => Number(p.pagado) || 0
  );
  return construirMatrizMesClave(porMes);
}

window.EVE_DASHBOARD = {
  obtenerMesCalendario,
  agruparPorMesY,
  construirMatrizMesClave,
  agregarCxPPorProveedorYMaterial,
  calcularVistaKgPorMesMaterial,
  calcularVistaMontoPorMesMaterial,
  calcularVistaPagadoPorMesProveedor
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

function renderizarTablaMatriz(wrapper, matriz, etiquetaTotal, formatearValor) {
  wrapper.innerHTML = '';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';

  const encabezado = document.createElement('thead');
  const filaEncabezado = document.createElement('tr');
  const thMes = document.createElement('th');
  thMes.textContent = 'Mes';
  filaEncabezado.appendChild(thMes);
  matriz.claves.forEach((clave) => {
    const th = document.createElement('th');
    th.textContent = clave;
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
    celdaVacia.colSpan = matriz.claves.length + 2;
    filaVacia.appendChild(celdaVacia);
    cuerpo.appendChild(filaVacia);
  }
  matriz.filas.forEach((fila) => {
    const tr = document.createElement('tr');
    const celdaMes = document.createElement('td');
    celdaMes.textContent = fila.mes;
    tr.appendChild(celdaMes);
    matriz.claves.forEach((clave) => {
      const celda = document.createElement('td');
      celda.textContent = formatearValor(fila[clave]);
      tr.appendChild(celda);
    });
    const celdaTotal = document.createElement('td');
    celdaTotal.textContent = formatearValor(fila._total);
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

  grupos.forEach((grupo) => {
    grupo.materiales.forEach((m, indice) => {
      const tr = document.createElement('tr');
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

const wrappersDashboard = {};

function renderizarVistaActivaDashboard() {
  Object.keys(wrappersDashboard).forEach((id) => {
    wrappersDashboard[id].style.display = id === vistaActivaDashboard ? '' : 'none';
  });
  if (vistaActivaDashboard === 'kg-mes-material') {
    renderizarTablaMatriz(wrappersDashboard['kg-mes-material'], calcularVistaKgPorMesMaterial(), 'Total KG', formatearKgRedondeado);
  } else if (vistaActivaDashboard === 'monto-mes-material') {
    renderizarTablaMatriz(wrappersDashboard['monto-mes-material'], calcularVistaMontoPorMesMaterial(), 'Total $', window.formatearMoneda);
  } else if (vistaActivaDashboard === 'pagado-mes-proveedor') {
    renderizarTablaMatriz(wrappersDashboard['pagado-mes-proveedor'], calcularVistaPagadoPorMesProveedor(), 'Total Pagado', window.formatearMoneda);
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
