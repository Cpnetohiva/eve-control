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

function calcularVistaKgPorMesMaterial() {
  const porMes = agruparPorMesY(
    window.EVE.registrosDestaraje,
    (r) => r.fechaSalida,
    (r) => window.normalizarMaterial(r.material),
    (r) => Number(r.kg) || 0
  );
  return construirMatrizMesClave(porMes);
}

function calcularVistaMontoPorMesMaterial() {
  const porMes = agruparPorMesY(
    (window.EVE.cuentasPorPagar || []).filter((c) => !window.esCuentaSaldoInicial(c)),
    (c) => c.fechaTicket,
    (c) => window.normalizarMaterial(c.material),
    (c) => Number(c.total) || 0
  );
  return construirMatrizMesClave(porMes);
}

function calcularVistaPagadoPorMesProveedor() {
  const pagosVigentes = (window.EVE.registrosPagos || []).filter((p) => !p.revertido);
  const porMes = agruparPorMesY(
    pagosVigentes,
    (p) => p.fecha,
    (p) => window.normalizarProveedor(p.proveedor),
    // Sin IVA, igual que Flujo de efectivo: pagado menos iva; el anticipo a proveedor cuenta completo.
    (p) => (p.origen === 'anticipo' ? Number(p.pagado) || 0 : (Number(p.pagado) || 0) - (Number(p.iva) || 0))
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

  // Se compara por nombre normalizado en ambos lados: un precio guardado con un nombre anterior a un alias
  // (p. ej. 'P.P MOLIDO') cubre al material oficial ('P.P. MOLIDO').
  const tieneCobertura = (material, fecha) => precios.some((p) =>
    window.normalizarMaterial(p.material) === window.normalizarMaterial(material) && p.fechaInicio <= fecha && (p.fechaFin === null || p.fechaFin >= fecha)
  );

  // Incluye los archivados: sus tickets históricos sin precio siguen siendo candidatos a CxP faltantes.
  return window.materialesRecibiblesHistoricos().map((material) => {
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

// La Posición de IVA se causa sobre la fecha real de movimiento de efectivo (cobros/pagos/gastos), nunca sobre la fecha de
// emisión de ventas/CxP — ver sección 5 de
// docs/superpowers/specs/2026-09-14-consistencia-financiera-iva-gastos-cxc-design.md.
function construirFilasPosicionIva(matriz) {
  const porClave = new Map(matriz.filas.map((f) => [f.clave, f]));
  const obtener = (clave, mes) => (porClave.has(clave) ? porClave.get(clave)[mes] || 0 : 0);
  return matriz.meses.map((mes) => {
    const trasladado = obtener('IVA Trasladado', mes);
    const acreditable = obtener('IVA Acreditable', mes);
    return { mes, trasladado, acreditable, neto: trasladado - acreditable };
  });
}

function calcularVistaPosicionIva() {
  const pagosVigentes = (window.EVE.registrosPagos || []).filter((p) => !p.revertido);
  const movimientos = [
    ...(window.EVE.cobros || []).filter((c) => !c.revertido).map((c) => ({ fecha: c.fecha, tipo: 'IVA Trasladado', iva: Number(c.iva) || 0 })),
    ...pagosVigentes.map((p) => ({ fecha: p.fecha, tipo: 'IVA Acreditable', iva: Number(p.iva) || 0 })),
    ...(window.EVE.gastos || []).map((g) => ({ fecha: g.fecha, tipo: 'IVA Acreditable', iva: Number(g.iva) || 0 }))
  ];
  const porMes = agruparPorMesY(movimientos, (m) => m.fecha, (m) => m.tipo, (m) => m.iva);
  const matriz = construirMatrizMesClave(porMes, ['IVA Trasladado', 'IVA Acreditable']);
  return construirFilasPosicionIva(matriz);
}

// Periodo de las vistas «Entradas de material vs Salidas» y «Cobrado por Mes y Cliente». Las vistas son mensuales, así que el periodo
// arranca siempre en día 1: «Últimos 6 meses» = el mes en curso y los 5 anteriores; «Año en curso» = desde el 1 de enero; «Todo» = sin
// límite. No hay tope superior: un registro con fecha de hoy en adelante del mismo periodo cuenta (igual que Este Mes en los módulos).
const PERIODOS_DASHBOARD = [
  { id: '6meses', nombre: 'Últimos 6 meses' },
  { id: 'anio', nombre: 'Año en curso' },
  { id: 'todo', nombre: 'Todo' }
];
const PERIODO_DASHBOARD_POR_DEFECTO = 'anio';

function obtenerRangoPeriodoDashboard(periodoId) {
  const hoy = window.obtenerFechaMexico();
  const anio = Number(hoy.slice(0, 4));
  const mes = Number(hoy.slice(5, 7));
  if (periodoId === 'anio') return { desde: `${anio}-01-01`, hasta: '' };
  if (periodoId === '6meses') {
    const inicio = new Date(Date.UTC(anio, mes - 1 - 5, 1));
    return { desde: `${inicio.getUTCFullYear()}-${String(inicio.getUTCMonth() + 1).padStart(2, '0')}-01`, hasta: '' };
  }
  return { desde: '', hasta: '' };
}

function redondearCentavosDashboard(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Entradas de material vs Salidas, por mes, con monto en pesos y KG.
// - Entradas: las mismas filas del reporte Entradas de material (tickets con cuenta por pagar generada, por fechaTicket; el monto es el
//   costo = material + comisión, sin IVA), vía window.filtrarEntradasMaterial.
// - Salidas: monto total de TODAS las ventas del mes (líneas en KG y en PZ), por fecha de la venta, con la misma fuente y el mismo
//   cálculo que el reporte de Ventas (window.obtenerVentasReporte y window.construirReporteVentas): el monto es su TOTAL VENTAS (sin IVA: suma de subtotales de las líneas) y las
//   cantidades su TOTAL KG y TOTAL PZ, siempre por separado (nunca se suma KG con PZ).
// - Diferencia = entradas - salidas, solo en pesos. Es solo el comparativo de movimiento: no es utilidad ni margen.
// Cada mes y el total salen de las mismas sumas, así que coinciden con los reportes del mismo periodo.
function calcularVistaEntradasVsSalidas(periodoId) {
  const { desde, hasta } = obtenerRangoPeriodoDashboard(periodoId || 'todo');
  const entradasPorMes = new Map();
  window.filtrarEntradasMaterial(window.EVE.cuentasPorPagar || [], { desde, hasta }).forEach((fila) => {
    const mes = obtenerMesCalendario(fila.fechaTicket);
    if (!mes) return;
    const actual = entradasPorMes.get(mes) || { kg: 0, monto: 0 };
    actual.kg += fila.kg;
    actual.monto += fila.costo;
    entradasPorMes.set(mes, actual);
  });
  const ventasPorMes = new Map();
  window.obtenerVentasReporte(desde, hasta, {}).forEach((venta) => {
    const mes = obtenerMesCalendario(venta.fecha);
    if (!mes) return;
    if (!ventasPorMes.has(mes)) ventasPorMes.set(mes, []);
    ventasPorMes.get(mes).push(venta);
  });
  const meses = Array.from(new Set([...entradasPorMes.keys(), ...ventasPorMes.keys()])).sort();
  const filas = meses.map((mes) => {
    const reporte = ventasPorMes.has(mes) ? window.construirReporteVentas(ventasPorMes.get(mes)) : { totalVentas: 0, totalKg: 0, totalPz: 0 };
    const entradas = entradasPorMes.get(mes) || { kg: 0, monto: 0 };
    const salidasMonto = redondearCentavosDashboard(reporte.totalVentas);
    const entradasMonto = redondearCentavosDashboard(entradas.monto);
    return {
      mes,
      entradasKg: entradas.kg, entradasMonto,
      salidasMonto, salidasKg: reporte.totalKg, salidasPz: reporte.totalPz,
      diferenciaMonto: redondearCentavosDashboard(entradasMonto - salidasMonto)
    };
  });
  const suma = (campo) => filas.reduce((total, fila) => total + fila[campo], 0);
  const entradasMonto = redondearCentavosDashboard(suma('entradasMonto'));
  const salidasMonto = redondearCentavosDashboard(suma('salidasMonto'));
  return {
    filas,
    totales: {
      entradasKg: suma('entradasKg'), entradasMonto, salidasMonto, salidasKg: suma('salidasKg'), salidasPz: suma('salidasPz'),
      diferenciaMonto: redondearCentavosDashboard(entradasMonto - salidasMonto)
    }
  };
}

// Cobrado por mes y cliente: cliente en filas, mes en columnas, con totales por fila y por columna. Sale de los abonos registrados en
// las cuentas por cobrar (por la fecha del cobro), sin los abonos revertidos y sin IVA: cada abono se prorratea a base con
// window.montoSinIvaDeAbono (monto × subtotal / total de la cuenta), la misma proporción que usa Flujo de efectivo.
// Devuelve la matriz de construirMatrizMesClave más `totales`.
function calcularVistaCobradoPorMesCliente(periodoId) {
  const { desde, hasta } = obtenerRangoPeriodoDashboard(periodoId || 'todo');
  const abonos = [];
  (window.EVE.cuentasPorCobrar || []).forEach((cuenta) => {
    (cuenta.abonos || []).forEach((abono) => {
      if (abono.revertido) return;
      if ((desde && abono.fecha < desde) || (hasta && abono.fecha > hasta)) return;
      abonos.push({ cliente: cuenta.cliente || '(Sin cliente)', fecha: abono.fecha, monto: window.montoSinIvaDeAbono(abono, cuenta) });
    });
  });
  const matriz = construirMatrizMesClave(agruparPorMesY(abonos, (a) => a.fecha, (a) => a.cliente, (a) => a.monto));
  const totales = { _total: 0 };
  matriz.meses.forEach((mes) => {
    totales[mes] = matriz.filas.reduce((suma, fila) => suma + (fila[mes] || 0), 0);
    totales._total += totales[mes];
  });
  return { ...matriz, totales };
}

window.EVE_DASHBOARD = {
  obtenerMesCalendario,
  agruparPorMesY,
  construirMatrizMesClave,
  calcularVistaKgPorMesMaterial,
  calcularVistaMontoPorMesMaterial,
  calcularVistaPagadoPorMesProveedor,
  calcularMaterialesSinPrecioVigente,
  calcularVistaPosicionIva,
  calcularVistaEntradasVsSalidas,
  calcularVistaCobradoPorMesCliente,
  obtenerRangoPeriodoDashboard,
  PERIODOS_DASHBOARD,
  PERIODO_DASHBOARD_POR_DEFECTO
};

let vistaActivaDashboard = 'kg-mes-material';
let periodoDashboard = PERIODO_DASHBOARD_POR_DEFECTO;

// Las vistas nuevas muestran datos de otros módulos: se respetan sus permisos de lectura (los mismos que piden el reporte de Entradas
// de material y el de Ventas en Finanzas > Reportes, y el módulo CxC).
function puedeVerVistaDashboard(id) {
  if (id === 'entradas-vs-salidas') return window.tienePermisoExtra('cxp_reportes') && window.puedeLeer('ventas');
  if (id === 'cobrado-mes-cliente') return window.puedeLeer('cxc');
  return true;
}

function crearSubtabsDashboard() {
  const contenedor = document.createElement('div');
  contenedor.className = 'tabs destaraje-subtabs';
  const opciones = [
    { id: 'kg-mes-material', nombre: 'KG por Mes y Material' },
    { id: 'monto-mes-material', nombre: '$ por Mes y Material' },
    { id: 'pagado-mes-proveedor', nombre: 'Pagado por Mes y Proveedor' },
    { id: 'entradas-vs-salidas', nombre: 'Entradas de material vs Salidas' },
    { id: 'cobrado-mes-cliente', nombre: 'Cobrado por Mes y Cliente' }
  ].filter((opcion) => puedeVerVistaDashboard(opcion.id));
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
  if (matriz.totales && matriz.filas.length > 0) {
    const trTotales = document.createElement('tr');
    trTotales.style.fontWeight = '700';
    const celdaEtiqueta = document.createElement('td');
    celdaEtiqueta.textContent = 'TOTAL';
    trTotales.appendChild(celdaEtiqueta);
    matriz.meses.forEach((mes) => {
      const celda = document.createElement('td');
      celda.textContent = formatearValor(matriz.totales[mes]);
      trTotales.appendChild(celda);
    });
    const celdaGeneral = document.createElement('td');
    celdaGeneral.textContent = formatearValor(matriz.totales._total);
    trTotales.appendChild(celdaGeneral);
    cuerpo.appendChild(trTotales);
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

function renderizarTablaGenerica(wrapper, columnas, filas, mensajeVacio) {
  wrapper.innerHTML = '';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';

  const encabezado = document.createElement('thead');
  const filaEncabezado = document.createElement('tr');
  columnas.forEach((columna) => {
    const th = document.createElement('th');
    th.textContent = columna.etiqueta;
    filaEncabezado.appendChild(th);
  });
  encabezado.appendChild(filaEncabezado);
  tabla.appendChild(encabezado);

  const cuerpo = document.createElement('tbody');
  if (filas.length === 0) {
    const filaVacia = document.createElement('tr');
    const celdaVacia = document.createElement('td');
    celdaVacia.textContent = mensajeVacio;
    celdaVacia.colSpan = columnas.length;
    filaVacia.appendChild(celdaVacia);
    cuerpo.appendChild(filaVacia);
  }
  filas.forEach((fila) => {
    const tr = document.createElement('tr');
    columnas.forEach((columna) => {
      const celda = document.createElement('td');
      const valor = fila[columna.campo];
      celda.textContent = columna.formato ? columna.formato(valor, fila) : valor;
      tr.appendChild(celda);
    });
    cuerpo.appendChild(tr);
  });
  tabla.appendChild(cuerpo);
  wrapper.appendChild(tabla);
}

function formatearKgConDecimales(valor) {
  return `${(Number(valor) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })} kg`;
}

// '$123,456.00 (12,345 kg)': monto en pesos y, entre paréntesis, los KG.
function formatearMontoConKg(monto, kg) {
  return `${window.formatearMoneda(monto)} (${formatearKgConDecimales(kg)})`;
}

// '$4,126,186.20 (287,560.6 kg · 6,919 pz)': monto en pesos y, entre paréntesis, los kg y las piezas por separado (nunca sumados).
function formatearMontoConKgYPz(monto, kg, pz) {
  return `${window.formatearMoneda(monto)} (${formatearKgConDecimales(kg)} · ${(Number(pz) || 0).toLocaleString('es-MX')} pz)`;
}

function renderizarEntradasVsSalidas(wrapper) {
  wrapper.innerHTML = '';
  const { filas, totales } = calcularVistaEntradasVsSalidas(periodoDashboard);
  const resumen = document.createElement('p');
  resumen.style.fontWeight = '700';
  resumen.textContent = `Total del periodo — Entradas: ${formatearMontoConKg(totales.entradasMonto, totales.entradasKg)} · Salidas: ${formatearMontoConKgYPz(totales.salidasMonto, totales.salidasKg, totales.salidasPz)} · Diferencia: ${window.formatearMoneda(totales.diferenciaMonto)}`;
  wrapper.appendChild(resumen);
  const nota = document.createElement('p');
  nota.style.fontSize = '0.85em';
  nota.textContent = 'Salidas: monto de todas las ventas (kg y piezas). Entradas: costo de tickets con cuenta por pagar generada.';
  wrapper.appendChild(nota);
  const subWrapper = document.createElement('div');
  wrapper.appendChild(subWrapper);
  const columna = (campo, etiqueta, campoKg) => ({ campo, etiqueta, formato: (valor, fila) => formatearMontoConKg(valor, fila[campoKg]) });
  const columnas = [
    { campo: 'mes', etiqueta: 'Mes' },
    columna('entradasMonto', 'Entradas', 'entradasKg'),
    { campo: 'salidasMonto', etiqueta: 'Salidas', formato: (valor, fila) => formatearMontoConKgYPz(valor, fila.salidasKg, fila.salidasPz) },
    { campo: 'diferenciaMonto', etiqueta: 'Diferencia (entradas − salidas)', formato: (valor) => window.formatearMoneda(valor) }
  ];
  const conTotal = filas.length > 0 ? [...filas, { mes: 'TOTAL', ...totales }] : filas;
  renderizarTablaGenerica(subWrapper, columnas, conTotal, 'Sin entradas ni ventas en el periodo');
}

function crearChipDashboard(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

const wrappersDashboard = {};

const VISTAS_CON_PERIODO = ['entradas-vs-salidas', 'cobrado-mes-cliente'];
let barraPeriodoDashboard = null;

function crearBarraPeriodoDashboard() {
  const barra = document.createElement('div');
  barra.id = 'dashboard-periodo';
  barra.style.margin = '0.5rem 0';
  const etiqueta = document.createElement('label');
  etiqueta.textContent = 'Periodo: ';
  etiqueta.htmlFor = 'dashboard-periodo-select';
  const select = document.createElement('select');
  select.id = 'dashboard-periodo-select';
  PERIODOS_DASHBOARD.forEach((p) => {
    const opcion = document.createElement('option');
    opcion.value = p.id;
    opcion.textContent = p.nombre;
    select.appendChild(opcion);
  });
  select.value = periodoDashboard;
  select.addEventListener('change', () => {
    periodoDashboard = select.value;
    renderizarVistaActivaDashboard();
  });
  barra.appendChild(etiqueta);
  barra.appendChild(select);
  return barra;
}

function renderizarVistaActivaDashboard() {
  Object.keys(wrappersDashboard).forEach((id) => {
    wrappersDashboard[id].style.display = id === vistaActivaDashboard ? '' : 'none';
  });
  if (barraPeriodoDashboard) barraPeriodoDashboard.style.display = VISTAS_CON_PERIODO.includes(vistaActivaDashboard) ? '' : 'none';
  if (vistaActivaDashboard === 'kg-mes-material') {
    renderizarTablaMatriz(wrappersDashboard['kg-mes-material'], calcularVistaKgPorMesMaterial(), 'Material', 'Total KG', formatearKgRedondeado);
  } else if (vistaActivaDashboard === 'monto-mes-material') {
    renderizarTablaMatriz(wrappersDashboard['monto-mes-material'], calcularVistaMontoPorMesMaterial(), 'Material', 'Total $', window.formatearMoneda);
    renderizarAlertaMaterialesSinPrecio(wrappersDashboard['monto-mes-material']);
  } else if (vistaActivaDashboard === 'pagado-mes-proveedor') {
    renderizarTablaMatriz(wrappersDashboard['pagado-mes-proveedor'], calcularVistaPagadoPorMesProveedor(), 'Proveedor', 'Total Pagado', window.formatearMoneda);
  } else if (vistaActivaDashboard === 'entradas-vs-salidas') {
    renderizarEntradasVsSalidas(wrappersDashboard['entradas-vs-salidas']);
  } else if (vistaActivaDashboard === 'cobrado-mes-cliente') {
    renderizarTablaMatriz(wrappersDashboard['cobrado-mes-cliente'], calcularVistaCobradoPorMesCliente(periodoDashboard), 'Cliente', 'Total cobrado', window.formatearMoneda);
  }
}

function renderDashboard(container) {
  container.innerHTML = '';
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Dashboard: Entradas, Ventas y Cobranza';
  tarjeta.appendChild(titulo);

  const subtabs = crearSubtabsDashboard();
  tarjeta.appendChild(subtabs);
  periodoDashboard = PERIODO_DASHBOARD_POR_DEFECTO;
  barraPeriodoDashboard = crearBarraPeriodoDashboard();
  tarjeta.appendChild(barraPeriodoDashboard);

  ['kg-mes-material', 'monto-mes-material', 'pagado-mes-proveedor', 'entradas-vs-salidas', 'cobrado-mes-cliente'].forEach((id) => {
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
