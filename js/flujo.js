(function () {

// Flujo de efectivo: lo que entró y salió realmente de caja, con saldo acumulado desde FLUJO_FECHA_INICIO.
//  - ENTRADAS: cobros no revertidos (colección cobros) y movimientos manuales de tipo entrada.
//  - SALIDAS: pagos a proveedores no revertidos (pagos; sin IVA, el anticipo cuenta completo), gastos (montoBase) y
//    movimientos manuales de tipo salida.
//  - RUBROS (clasificarMovimientoFlujo): cada movimiento es saldo_inicial, financiamiento u operacion. El saldo inicial solo
//    aporta al saldo acumulado: no cuenta en Entradas, Salidas ni Neto del periodo. Neto = Flujo operativo + Flujo de financiamiento.
// Los pagos de CxP ya viven en la colección pagos (cada abono genera su espejo), así que NO se leen de cuentas_por_pagar:
// hacerlo contaría cada pago dos veces. Solo los movimientos manuales se guardan en flujo_movimientos.

const PERMISO = 'flujo';
const FLUJO_FECHA_INICIO = '2026-10-01';
const TIPO_ENTRADA = 'Entrada';
const TIPO_SALIDA = 'Salida';
// Tipos de movimiento manual (se guardan en `tipo` del documento); la dirección sale del tipo.
const TIPOS_MANUAL = [
  { valor: 'Saldo inicial', direccion: TIPO_ENTRADA },
  { valor: 'Aportación o préstamo', direccion: TIPO_ENTRADA },
  { valor: 'Disposición de crédito', direccion: TIPO_ENTRADA },
  { valor: 'Anticipo de cliente', direccion: TIPO_ENTRADA },
  { valor: 'Otra entrada', direccion: TIPO_ENTRADA },
  { valor: 'Anticipo a proveedor', direccion: TIPO_SALIDA },
  { valor: 'Retiro o devolución a socio', direccion: TIPO_SALIDA },
  { valor: 'Otra salida', direccion: TIPO_SALIDA }
];
// Valores guardados antes de los rubros: se leen igual que su equivalente nuevo, sin migrar datos.
const TIPOS_HEREDADOS = {
  'entrada': 'Otra entrada',
  'salida': 'Otra salida',
  'aportacion de socio': 'Aportación o préstamo',
  'retiro de socio': 'Retiro o devolución a socio'
};
const TIPOS_FINANCIAMIENTO = ['Aportación o préstamo', 'Disposición de crédito', 'Retiro o devolución a socio'];
const RUBROS = { saldo_inicial: 'Saldo inicial', financiamiento: 'Financiamiento', operacion: 'Operación' };
const TEXTO_ALERTA_IVA = 'Cobro con IVA: revisa la venta';
// Los anticipos de CxP (pago general con sobrante) y de Pagos (Recibos de Pago) ya son salidas del flujo (origen 'anticipo' en pagos):
// capturarlos también como movimiento manual los contaría dos veces.
const TEXTO_AVISO_ANTICIPO = 'Anticipo a proveedor: usa un movimiento manual solo para dinero entregado fuera del sistema (sin pago en CxP ni en Recibos de Pago). '
  + 'Los anticipos hechos desde CxP o desde Pagos ya aparecen solos en el flujo; capturarlos aquí los contaría dos veces.';

// ── Datos (funciones puras) ──────────────────────────────────────────────────────────────────────────────────────────────

function texto(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function dentroDelFlujo(fecha) {
  return typeof fecha === 'string' && fecha >= FLUJO_FECHA_INICIO;
}

// Importes a centavos: el saldo se acumula sumando muchos movimientos y no debe arrastrar errores de punto flotante.
function redondear(valor) {
  return Math.round(valor * 100) / 100;
}

// Tipo manual al valor vigente (acepta los heredados y no distingue acentos ni mayúsculas); null si no existe.
function tipoManualCanonico(tipo) {
  const buscado = normalizarBusqueda(tipo);
  const vigente = TIPOS_MANUAL.find((t) => normalizarBusqueda(t.valor) === buscado);
  return vigente ? vigente.valor : (TIPOS_HEREDADOS[buscado] || null);
}

function direccionDeTipoManual(tipo) {
  const canonico = tipoManualCanonico(tipo);
  const vigente = TIPOS_MANUAL.find((t) => t.valor === canonico);
  return vigente ? vigente.direccion : TIPO_SALIDA;
}

// mov: movimiento del flujo con `tipoManual` (manuales) o `tipoGasto` (gastos). Devuelve saldo_inicial, financiamiento u operacion.
function clasificarMovimientoFlujo(mov) {
  const m = mov || {};
  const tipo = tipoManualCanonico(m.tipoManual);
  if (tipo === 'Saldo inicial') return 'saldo_inicial';
  if (TIPOS_FINANCIAMIENTO.includes(tipo) || m.tipoGasto === 'financiamiento') return 'financiamiento';
  return 'operacion';
}

function movimiento(base) {
  const m = { entrada: 0, salida: 0, alertaIva: false, manualId: null, folio: '', ...base };
  m.entrada = redondear(m.entrada);
  m.salida = redondear(m.salida);
  m.rubro = clasificarMovimientoFlujo(m);
  return m;
}

// datos: { cobros, pagos, gastos, movimientosManuales }. Devuelve los movimientos ordenados por fecha y luego por
// fechaRegistro (desempate estable por el orden de llegada), cada uno con su `saldo` acumulado desde FLUJO_FECHA_INICIO.
function construirMovimientosFlujo(datos) {
  const d = datos || {};
  const movimientos = [];

  (d.cobros || []).forEach((c) => {
    if (c.revertido || !dentroDelFlujo(c.fecha)) return;
    movimientos.push(movimiento({
      origen: 'cobro', tipo: TIPO_ENTRADA, fecha: c.fecha, fechaRegistro: texto(c.fechaRegistro),
      concepto: 'Cobro', contraparte: texto(c.cliente), folio: texto(c.folio),
      entrada: numero(c.pagado), alertaIva: numero(c.iva) > 0
    }));
  });

  (d.pagos || []).forEach((p) => {
    if (p.revertido || !dentroDelFlujo(p.fecha)) return;
    const esAnticipo = p.origen === 'anticipo';
    movimientos.push(movimiento({
      origen: esAnticipo ? 'anticipo' : 'pago', tipo: TIPO_SALIDA, fecha: p.fecha, fechaRegistro: texto(p.fechaRegistro),
      concepto: esAnticipo ? 'Anticipo a proveedor' : 'Pago a proveedor', contraparte: texto(p.proveedor), folio: texto(p.ticket),
      salida: esAnticipo ? numero(p.pagado) : numero(p.pagado) - numero(p.iva)
    }));
  });

  (d.gastos || []).forEach((g) => {
    if (!dentroDelFlujo(g.fecha)) return;
    movimientos.push(movimiento({
      origen: 'gasto', tipo: TIPO_SALIDA, fecha: g.fecha, fechaRegistro: texto(g.fechaRegistro),
      concepto: texto(g.concepto) || 'Gasto', contraparte: texto(g.beneficiario), tipoGasto: texto(g.tipoGasto),
      salida: numero(g.montoBase ?? g.total ?? g.monto)
    }));
  });

  (d.movimientosManuales || []).forEach((m) => {
    if (!dentroDelFlujo(m.fecha)) return;
    const esEntrada = direccionDeTipoManual(m.tipo) === TIPO_ENTRADA;
    movimientos.push(movimiento({
      origen: 'manual', tipo: esEntrada ? TIPO_ENTRADA : TIPO_SALIDA, tipoManual: texto(m.tipo), fecha: m.fecha, fechaRegistro: texto(m.fechaRegistro),
      concepto: texto(m.concepto) || 'Movimiento manual', contraparte: texto(m.contraparte), folio: texto(m.folio),
      entrada: esEntrada ? numero(m.importe) : 0, salida: esEntrada ? 0 : numero(m.importe),
      manualId: m.id || null, notas: texto(m.notas)
    }));
  });

  movimientos.forEach((m, indice) => { m.orden = indice; });
  movimientos.sort((a, b) => {
    if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
    if (a.fechaRegistro !== b.fechaRegistro) return a.fechaRegistro < b.fechaRegistro ? -1 : 1;
    return a.orden - b.orden;
  });
  let saldo = 0;
  movimientos.forEach((m) => {
    saldo = redondear(saldo + m.entrada - m.salida);
    m.saldo = saldo;
    delete m.orden;
  });
  return movimientos;
}

// El saldo inicial queda fuera de entradas, salidas y neto (solo aporta al saldo acumulado de cada movimiento).
// neto = operativo + financiamiento.
function calcularTotalesFlujo(movimientos) {
  const rubroDe = (m) => m.rubro || clasificarMovimientoFlujo(m);
  const periodo = (movimientos || []).filter((m) => rubroDe(m) !== 'saldo_inicial');
  const suma = (lista, campo) => redondear(lista.reduce((total, m) => total + m[campo], 0));
  const netoDe = (rubro) => {
    const lista = periodo.filter((m) => rubroDe(m) === rubro);
    return redondear(suma(lista, 'entrada') - suma(lista, 'salida'));
  };
  const entradas = suma(periodo, 'entrada');
  const salidas = suma(periodo, 'salida');
  return { entradas, salidas, neto: redondear(entradas - salidas), operativo: netoDe('operacion'), financiamiento: netoDe('financiamiento') };
}

// Saldo al cierre de la lista dada (el de su último movimiento); `respaldo` si la lista está vacía.
function saldoFinalFlujo(movimientos, respaldo) {
  return movimientos && movimientos.length > 0 ? movimientos[movimientos.length - 1].saldo : (respaldo || 0);
}

function normalizarBusqueda(valor) {
  return texto(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Hoy / Esta Semana / Este Mes filtran por fecha; Todos aplica la barra de filtros. El saldo de cada movimiento no se
// recalcula: siempre es el acumulado desde FLUJO_FECHA_INICIO aunque la vista esté filtrada.
function filtrarMovimientosFlujo(movimientos, vista, filtros, referencias) {
  const hoy = (referencias && referencias.hoy) || window.obtenerFechaMexico();
  const inicioSemana = (referencias && referencias.inicioSemana) || window.obtenerInicioSemana();
  const inicioMes = (referencias && referencias.inicioMes) || window.obtenerInicioMes();
  if (vista === 'hoy') return movimientos.filter((m) => m.fecha === hoy);
  if (vista === 'semana') return movimientos.filter((m) => m.fecha >= inicioSemana);
  if (vista === 'mes') return movimientos.filter((m) => m.fecha >= inicioMes);
  const f = filtros || {};
  const buscado = normalizarBusqueda(f.texto);
  return movimientos.filter((m) => {
    if (f.desde && m.fecha < f.desde) return false;
    if (f.hasta && m.fecha > f.hasta) return false;
    if (f.tipo && m.tipo !== f.tipo) return false;
    if (buscado && !normalizarBusqueda(`${m.contraparte} ${m.concepto}`).includes(buscado)) return false;
    return true;
  });
}

// Movimiento manual: fecha obligatoria (AAAA-MM-DD, desde FLUJO_FECHA_INICIO: antes no entra al flujo y quedaría invisible)
// e importe mayor a 0.
function construirMovimientoManualDesdeFormulario(datos) {
  const fecha = texto(datos.fecha);
  if (!fecha) throw new Error('La fecha es obligatoria');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('La fecha debe tener el formato AAAA-MM-DD');
  if (!dentroDelFlujo(fecha)) throw new Error(`La fecha debe ser ${FLUJO_FECHA_INICIO} o posterior: el flujo de efectivo empieza ese día`);
  const importe = Number(datos.importe);
  if (datos.importe === '' || datos.importe === null || datos.importe === undefined || !Number.isFinite(importe) || importe <= 0) {
    throw new Error('El importe debe ser un número mayor a 0');
  }
  const tipo = texto(datos.tipo);
  if (!tipoManualCanonico(tipo)) throw new Error('El tipo de movimiento no es válido');
  return {
    fecha,
    tipo,
    concepto: texto(datos.concepto),
    contraparte: texto(datos.contraparte),
    folio: texto(datos.folio),
    importe,
    notas: texto(datos.notas)
  };
}

window.EVE_FLUJO = {
  FLUJO_FECHA_INICIO,
  TEXTO_ALERTA_IVA,
  TEXTO_AVISO_ANTICIPO,
  TIPOS_MANUAL,
  construirMovimientosFlujo,
  clasificarMovimientoFlujo,
  calcularTotalesFlujo,
  saldoFinalFlujo,
  filtrarMovimientosFlujo,
  construirMovimientoManualDesdeFormulario
};

// ── UI ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

let tabActiva = 'hoy';
let filtros = { desde: '', hasta: '', texto: '', tipo: '' };
let editandoId = null;

function usuarioActual() {
  return (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function obtenerTodosLosMovimientos() {
  return construirMovimientosFlujo({
    cobros: window.EVE.cobros || [],
    pagos: window.EVE.registrosPagos || [],
    gastos: window.EVE.gastos || [],
    movimientosManuales: window.EVE.flujoMovimientos || []
  });
}

function obtenerMovimientosParaTab() {
  return filtrarMovimientosFlujo(obtenerTodosLosMovimientos(), tabActiva, filtros);
}

// Fuentes que el usuario no puede leer (sin permiso, su colección llega vacía y el flujo se vería incompleto).
function fuentesSinAcceso() {
  const fuentes = [
    { nombre: 'Cobros (CxC)', modulo: 'cxc' },
    { nombre: 'Pagos', modulo: 'pagos' },
    { nombre: 'Gastos', modulo: 'gastos' }
  ];
  return fuentes.filter((f) => !window.puedeLeer(f.modulo)).map((f) => f.nombre);
}

function formatearMonto(valor) {
  return valor > 0 ? window.formatearMoneda(valor) : '';
}

// Tabs, barra de filtros y KPIs

function crearTabsInternas() {
  const nav = document.createElement('div');
  nav.className = 'tabs destaraje-subtabs';
  [
    { id: 'hoy', nombre: 'Hoy' },
    { id: 'semana', nombre: 'Esta Semana' },
    { id: 'mes', nombre: 'Este Mes' },
    { id: 'todos', nombre: 'Todos' }
  ].forEach((def, indice) => {
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

function crearCampoFiltro(etiqueta, elemento) {
  const label = document.createElement('label');
  label.className = 'filtro-campo';
  const span = document.createElement('span');
  span.textContent = etiqueta;
  label.appendChild(span);
  label.appendChild(elemento);
  return label;
}

function crearBarraFiltros() {
  const div = document.createElement('div');
  div.id = 'flujo-filtros';
  div.className = 'card destaraje-filtros';
  div.style.display = 'none';

  const inputDesde = document.createElement('input');
  inputDesde.type = 'date';
  const inputHasta = document.createElement('input');
  inputHasta.type = 'date';
  const inputTexto = document.createElement('input');
  inputTexto.type = 'text';
  inputTexto.placeholder = 'Cliente, proveedor o concepto';
  const selectTipo = document.createElement('select');
  [['', 'Todos'], [TIPO_ENTRADA, 'Entrada'], [TIPO_SALIDA, 'Salida']].forEach(([valor, nombre]) => {
    const opcion = document.createElement('option');
    opcion.value = valor;
    opcion.textContent = nombre;
    selectTipo.appendChild(opcion);
  });

  const actualizar = () => {
    filtros = { desde: inputDesde.value, hasta: inputHasta.value, texto: inputTexto.value, tipo: selectTipo.value };
    renderizarVista();
  };
  [inputDesde, inputHasta, inputTexto].forEach((el) => el.addEventListener('input', actualizar));
  selectTipo.addEventListener('change', actualizar);

  div.appendChild(crearCampoFiltro('Desde', inputDesde));
  div.appendChild(crearCampoFiltro('Hasta', inputHasta));
  div.appendChild(crearCampoFiltro('Cliente / Proveedor / Concepto', inputTexto));
  div.appendChild(crearCampoFiltro('Tipo', selectTipo));
  return div;
}

function crearStats() {
  const div = document.createElement('div');
  div.id = 'flujo-stats';
  div.className = 'card destaraje-stats';
  return div;
}

function renderizarStats(movimientos, saldoActual) {
  const totales = calcularTotalesFlujo(movimientos);
  const contenedor = document.getElementById('flujo-stats');
  contenedor.innerHTML = '';
  [
    `Entradas: ${window.formatearMoneda(totales.entradas)}`,
    `Salidas: ${window.formatearMoneda(totales.salidas)}`,
    `Neto del periodo: ${window.formatearMoneda(totales.neto)}`,
    `Flujo operativo: ${window.formatearMoneda(totales.operativo)}`,
    `Flujo de financiamiento: ${window.formatearMoneda(totales.financiamiento)}`,
    `Saldo actual: ${window.formatearMoneda(saldoActual)}`
  ].forEach((contenidoTexto) => {
    const span = document.createElement('span');
    span.textContent = contenidoTexto;
    contenedor.appendChild(span);
  });
}

function crearAvisoFuentes() {
  const div = document.createElement('div');
  div.id = 'flujo-aviso';
  div.className = 'card';
  div.style.display = 'none';
  return div;
}

function renderizarAvisoFuentes() {
  const div = document.getElementById('flujo-aviso');
  const faltantes = fuentesSinAcceso();
  div.style.display = faltantes.length > 0 ? '' : 'none';
  div.textContent = faltantes.length > 0
    ? `Tu rol no puede leer: ${faltantes.join(', ')}. El flujo de efectivo se muestra incompleto.`
    : '';
}

// Tabla

function crearTabla() {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Concepto</th><th data-tipo="texto">Cliente / Proveedor</th><th data-tipo="texto">Folio</th><th data-tipo="texto">Rubro</th><th data-tipo="moneda">Entrada</th><th data-tipo="moneda">Salida</th><th data-tipo="moneda">Saldo</th><th></th></tr>
    </thead>
    <tbody id="flujo-tabla"></tbody>
  `;
  window.activarOrdenamiento(tabla);
  wrapper.appendChild(tabla);
  return wrapper;
}

function crearBotonAccion(textoBoton, alHacerClic) {
  const boton = document.createElement('button');
  boton.textContent = textoBoton;
  boton.className = 'btn-secondary';
  boton.addEventListener('click', alHacerClic);
  return boton;
}

function construirFilaTabla(m) {
  const fila = document.createElement('tr');
  const celdaConcepto = document.createElement('td');
  celdaConcepto.textContent = m.concepto;
  if (m.alertaIva) {
    const alerta = document.createElement('span');
    alerta.className = 'chip chip-warn';
    alerta.textContent = `⚠️ ${TEXTO_ALERTA_IVA}`;
    alerta.title = TEXTO_ALERTA_IVA;
    alerta.style.marginLeft = '0.5rem';
    celdaConcepto.appendChild(alerta);
  }
  const celdaTexto = (contenido) => {
    const celda = document.createElement('td');
    celda.textContent = contenido;
    return celda;
  };
  [
    celdaTexto(window.formatearFecha(m.fecha)), celdaConcepto, celdaTexto(m.contraparte), celdaTexto(m.folio),
    celdaTexto(RUBROS[m.rubro]), celdaTexto(formatearMonto(m.entrada)), celdaTexto(formatearMonto(m.salida)), celdaTexto(window.formatearMoneda(m.saldo))
  ].forEach((celda) => fila.appendChild(celda));
  const celdaAcciones = document.createElement('td');
  if (m.origen === 'manual' && m.manualId && window.puedeEscribir(PERMISO)) {
    celdaAcciones.appendChild(crearBotonAccion('Editar', () => {
      const registro = (window.EVE.flujoMovimientos || []).find((r) => r.id === m.manualId);
      if (registro) abrirModalEdicion(registro);
    }));
    celdaAcciones.appendChild(crearBotonAccion('Eliminar', () => confirmarEliminar(m.manualId)));
  }
  fila.appendChild(celdaAcciones);
  return fila;
}

function llenarTabla(movimientos) {
  const tbody = document.getElementById('flujo-tabla');
  tbody.innerHTML = '';
  if (movimientos.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 9;
    celda.textContent = 'Sin movimientos';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  movimientos.forEach((m) => tbody.appendChild(construirFilaTabla(m)));
}

function renderizarVista() {
  document.getElementById('flujo-filtros').style.display = tabActiva === 'todos' ? '' : 'none';
  const todos = obtenerTodosLosMovimientos();
  const movimientos = filtrarMovimientosFlujo(todos, tabActiva, filtros);
  renderizarAvisoFuentes();
  renderizarStats(movimientos, saldoFinalFlujo(todos));
  llenarTabla(movimientos);
}

// Movimientos manuales: alta, edición y eliminación

function opcionesTipoManual(direccion) {
  return TIPOS_MANUAL.filter((t) => t.direccion === direccion).map((t) => `<option value="${t.valor}">${t.valor}</option>`).join('');
}

function crearCamposMovimiento(prefijo) {
  const contenedor = document.createElement('div');
  contenedor.innerHTML = `
    <input type="date" id="${prefijo}-fecha" required>
    <select id="${prefijo}-tipo" title="Tipo de movimiento" required>
      <option value="" selected disabled>Tipo de movimiento…</option>
      <optgroup label="Entradas">${opcionesTipoManual(TIPO_ENTRADA)}</optgroup>
      <optgroup label="Salidas">${opcionesTipoManual(TIPO_SALIDA)}</optgroup>
    </select>
    <input type="text" id="${prefijo}-concepto" placeholder="Concepto">
    <input type="text" id="${prefijo}-contraparte" placeholder="Cliente / Proveedor (opcional)">
    <input type="text" id="${prefijo}-folio" placeholder="Folio (opcional)">
    <input type="number" id="${prefijo}-importe" placeholder="Importe" step="0.01" required>
    <input type="text" id="${prefijo}-notas" placeholder="Notas (opcional)">
  `;
  return contenedor;
}

function leerCamposMovimiento(prefijo) {
  const valor = (campo) => document.getElementById(`${prefijo}-${campo}`).value;
  return {
    fecha: valor('fecha'), tipo: valor('tipo'), concepto: valor('concepto'), contraparte: valor('contraparte'),
    folio: valor('folio'), importe: valor('importe'), notas: valor('notas')
  };
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  try {
    const movimientoManual = construirMovimientoManualDesdeFormulario(leerCamposMovimiento('fl'));
    movimientoManual.creadoPor = usuarioActual();
    movimientoManual.fechaRegistro = new Date().toISOString();
    const id = await window.guardarDato(window.COLECCIONES.FLUJO_MOVIMIENTOS, movimientoManual);
    window.EVE.flujoMovimientos.push({ id, ...movimientoManual });
    document.getElementById('flujo-form').reset();
    document.getElementById('fl-fecha').value = window.obtenerFechaMexico();
    renderizarVista();
    window.showSuccess('Movimiento guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearFormulario() {
  const form = document.createElement('form');
  form.id = 'flujo-form';
  form.className = 'card destaraje-form';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Movimiento manual';
  form.appendChild(titulo);
  const aviso = document.createElement('p');
  aviso.id = 'flujo-aviso-anticipo';
  aviso.className = 'chip chip-warn';
  aviso.style.cssText = 'display:block;white-space:normal;border-radius:8px;margin:0 0 0.75rem';
  aviso.textContent = TEXTO_AVISO_ANTICIPO;
  form.appendChild(aviso);
  const grid = crearCamposMovimiento('fl');
  grid.className = 'form-grid';
  form.appendChild(grid);
  const guardar = document.createElement('button');
  guardar.type = 'submit';
  guardar.className = 'btn-primary';
  guardar.textContent = 'Guardar';
  form.appendChild(guardar);
  grid.querySelector('#fl-fecha').value = window.obtenerFechaMexico();
  form.addEventListener('submit', manejarEnvioFormulario);
  return form;
}

async function manejarEnvioEdicion(evento) {
  evento.preventDefault();
  const anterior = (window.EVE.flujoMovimientos || []).find((r) => r.id === editandoId);
  const motivo = document.getElementById('fle-motivo').value.trim();
  try {
    if (!window.puedeEscribir(PERMISO)) throw new Error('No tienes permiso de escritura en Flujo de efectivo');
    const movimientoManual = construirMovimientoManualDesdeFormulario(leerCamposMovimiento('fle'));
    await window.actualizarDato(window.COLECCIONES.FLUJO_MOVIMIENTOS, editandoId, movimientoManual);
    window.EVE_HISTORIAL.registrar({
      coleccion: window.COLECCIONES.FLUJO_MOVIMIENTOS,
      registroId: editandoId,
      accion: 'edicion',
      valorAnterior: anterior
        ? { fecha: anterior.fecha, tipo: anterior.tipo, concepto: anterior.concepto, contraparte: anterior.contraparte, folio: anterior.folio, importe: anterior.importe, notas: anterior.notas }
        : null,
      valorNuevo: movimientoManual,
      motivo
    });
    document.getElementById('fle-motivo').value = '';
    const indice = window.EVE.flujoMovimientos.findIndex((r) => r.id === editandoId);
    if (indice !== -1) window.EVE.flujoMovimientos[indice] = { ...window.EVE.flujoMovimientos[indice], ...movimientoManual };
    cerrarModalEdicion();
    renderizarVista();
    window.showSuccess('Movimiento actualizado');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalEdicion() {
  const overlay = document.createElement('div');
  overlay.id = 'flujo-modal-overlay';
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal';
  const titulo = document.createElement('h3');
  titulo.textContent = 'Editar movimiento';
  modal.appendChild(titulo);
  const form = document.createElement('form');
  form.id = 'flujo-edit-form';
  form.appendChild(crearCamposMovimiento('fle'));
  const motivo = document.createElement('textarea');
  motivo.id = 'fle-motivo';
  motivo.placeholder = 'Motivo del cambio (opcional)';
  motivo.rows = 2;
  motivo.style.cssText = 'width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical';
  form.appendChild(motivo);
  const guardar = document.createElement('button');
  guardar.type = 'submit';
  guardar.className = 'btn-primary';
  guardar.textContent = 'Guardar cambios';
  form.appendChild(guardar);
  const cancelar = document.createElement('button');
  cancelar.type = 'button';
  cancelar.className = 'btn-secondary';
  cancelar.textContent = 'Cancelar';
  cancelar.addEventListener('click', () => cerrarModalEdicion());
  form.appendChild(cancelar);
  form.addEventListener('submit', manejarEnvioEdicion);
  modal.appendChild(form);
  overlay.appendChild(modal);
  return overlay;
}

function abrirModalEdicion(registro) {
  editandoId = registro.id;
  const poner = (campo, valor) => { document.getElementById(`fle-${campo}`).value = valor === undefined || valor === null ? '' : valor; };
  poner('fecha', registro.fecha);
  poner('tipo', tipoManualCanonico(registro.tipo) || '');
  poner('concepto', registro.concepto);
  poner('contraparte', registro.contraparte);
  poner('folio', registro.folio);
  poner('importe', registro.importe);
  poner('notas', registro.notas);
  document.getElementById('flujo-modal-overlay').classList.add('open');
}

function cerrarModalEdicion() {
  document.getElementById('flujo-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function confirmarEliminar(id) {
  if (!window.puedeEscribir(PERMISO)) {
    window.showError('No tienes permiso de escritura en Flujo de efectivo');
    return;
  }
  const registro = (window.EVE.flujoMovimientos || []).find((r) => r.id === id);
  const motivo = window.prompt('¿Motivo de la eliminación? (opcional)');
  if (motivo === null) return;
  try {
    await window.eliminarDato(window.COLECCIONES.FLUJO_MOVIMIENTOS, id);
    window.EVE_HISTORIAL.registrar({
      coleccion: window.COLECCIONES.FLUJO_MOVIMIENTOS,
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: registro
        ? { fecha: registro.fecha, tipo: registro.tipo, concepto: registro.concepto, contraparte: registro.contraparte, folio: registro.folio, importe: registro.importe, notas: registro.notas }
        : null,
      valorNuevo: null,
      motivo
    });
    const indice = window.EVE.flujoMovimientos.findIndex((r) => r.id === id);
    if (indice !== -1) window.EVE.flujoMovimientos.splice(indice, 1);
    renderizarVista();
    window.showSuccess('Movimiento eliminado');
  } catch (error) {
    window.showError(error.message);
  }
}

// ── Vista para captura ───────────────────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_CAPTURA_FLUJO = [
  { clave: 'fecha', etiqueta: 'Fecha', ancho: '14%', truncar: true, formato: (valor) => window.formatearFecha(valor) },
  { clave: 'concepto', etiqueta: 'Concepto', ancho: '24%', truncar: false },
  { clave: 'contraparte', etiqueta: 'Cliente / Proveedor', ancho: '22%', truncar: false },
  { clave: 'entrada', etiqueta: 'Entrada', ancho: '13%', alineacion: 'right', truncar: true, formato: (valor) => formatearMonto(valor) },
  { clave: 'salida', etiqueta: 'Salida', ancho: '13%', alineacion: 'right', truncar: true, formato: (valor) => formatearMonto(valor) },
  { clave: 'saldo', etiqueta: 'Saldo', ancho: '14%', alineacion: 'right', truncar: true, formato: (valor) => window.formatearMoneda(valor) }
];

function construirEtiquetaPeriodoCapturaFlujo() {
  const nombres = { hoy: 'Hoy', semana: 'Esta Semana', mes: 'Este Mes', todos: 'Todos' };
  const { desde, hasta } = window.obtenerRangoYEtiqueta(tabActiva, filtros);
  if (!desde && !hasta) return nombres[tabActiva] || 'Todos';
  const rango = desde === hasta ? window.formatearFecha(desde) : `${desde ? window.formatearFecha(desde) : '…'} al ${hasta ? window.formatearFecha(hasta) : '…'}`;
  return `${nombres[tabActiva] || 'Todos'} · ${rango}`;
}

function abrirVistaCapturaFlujo() {
  const todos = obtenerTodosLosMovimientos();
  const movimientos = filtrarMovimientosFlujo(todos, tabActiva, filtros);
  const hayMovimientos = movimientos.length > 0;
  const sinTabla = movimientos.length > 60;
  const totales = calcularTotalesFlujo(movimientos);

  window.VistaCaptura.abrir({
    titulo: 'Flujo de efectivo',
    periodo: construirEtiquetaPeriodoCapturaFlujo(),
    kpis: hayMovimientos ? [
      { label: 'Entradas', valor: window.formatearMoneda(totales.entradas) },
      { label: 'Salidas', valor: window.formatearMoneda(totales.salidas) },
      { label: 'Neto', valor: window.formatearMoneda(totales.neto) },
      { label: 'Flujo operativo', valor: window.formatearMoneda(totales.operativo) },
      { label: 'Flujo de financiamiento', valor: window.formatearMoneda(totales.financiamiento) },
      { label: 'Saldo final', valor: window.formatearMoneda(saldoFinalFlujo(movimientos, saldoFinalFlujo(todos))) }
    ] : undefined,
    columnas: COLUMNAS_CAPTURA_FLUJO,
    filas: (hayMovimientos && !sinTabla) ? movimientos : undefined,
    sinTabla: hayMovimientos && sinTabla,
    notaSinTabla: 'Lista completa disponible en pantalla',
    vacioMensaje: 'Sin movimientos en este periodo'
  });
}

// ── Exportaciones (TXT, PDF y CSV de la vista activa) ────────────────────────────────────────────────────────────────────

function construirResumenExportacion() {
  const todos = obtenerTodosLosMovimientos();
  const movimientos = filtrarMovimientosFlujo(todos, tabActiva, filtros);
  return {
    movimientos,
    periodo: window.obtenerRangoYEtiqueta(tabActiva, filtros),
    totales: calcularTotalesFlujo(movimientos),
    saldoFinal: saldoFinalFlujo(movimientos, saldoFinalFlujo(todos))
  };
}

function generarTXTFlujo(movimientos, periodo, totales, saldoFinal) {
  const lineas = [];
  lineas.push('REPORTE DE FLUJO DE EFECTIVO');
  lineas.push(`REPORTE: ${periodo.etiquetaReporte}`);
  lineas.push(`PERIODO: ${periodo.etiquetaPeriodo}`);
  lineas.push(`FECHA: ${window.formatearFecha(window.obtenerFechaMexico())}`);
  lineas.push('');
  lineas.push(`ENTRADAS: ${window.formatearMoneda(totales.entradas)}`);
  lineas.push(`SALIDAS: ${window.formatearMoneda(totales.salidas)}`);
  lineas.push(`NETO DEL PERIODO: ${window.formatearMoneda(totales.neto)}`);
  lineas.push(`FLUJO OPERATIVO: ${window.formatearMoneda(totales.operativo)}`);
  lineas.push(`FLUJO DE FINANCIAMIENTO: ${window.formatearMoneda(totales.financiamiento)}`);
  lineas.push(`SALDO FINAL: ${window.formatearMoneda(saldoFinal)}`);
  lineas.push('');
  lineas.push('DETALLE DE MOVIMIENTOS:');
  lineas.push('  FECHA  CONCEPTO  CLIENTE/PROVEEDOR  FOLIO  RUBRO  ENTRADA  SALIDA  SALDO');
  movimientos.forEach((m) => {
    lineas.push(`  ${window.formatearFecha(m.fecha)}  ${m.concepto}  ${m.contraparte}  ${m.folio}  ${RUBROS[m.rubro]}  ${formatearMonto(m.entrada)}  ${formatearMonto(m.salida)}  ${window.formatearMoneda(m.saldo)}`);
  });
  return lineas.join('\n');
}

function generarPDFFlujo(movimientos, periodo, totales, saldoFinal) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const anchoPagina = doc.internal.pageSize.getWidth();
  let y = 20;
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('REPORTE DE FLUJO DE EFECTIVO', anchoPagina / 2, y, { align: 'center' });
  y += 10;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`REPORTE: ${periodo.etiquetaReporte}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`PERIODO: ${periodo.etiquetaPeriodo}`, anchoPagina / 2, y, { align: 'center' });
  y += 6;
  doc.text(`FECHA: ${window.formatearFecha(window.obtenerFechaMexico())}`, anchoPagina / 2, y, { align: 'center' });
  y += 12;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`ENTRADAS: ${window.formatearMoneda(totales.entradas)}    SALIDAS: ${window.formatearMoneda(totales.salidas)}`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`NETO: ${window.formatearMoneda(totales.neto)}    SALDO FINAL: ${window.formatearMoneda(saldoFinal)}`, anchoPagina / 2, y, { align: 'center' });
  y += 8;
  doc.text(`FLUJO OPERATIVO: ${window.formatearMoneda(totales.operativo)}    FLUJO DE FINANCIAMIENTO: ${window.formatearMoneda(totales.financiamiento)}`, anchoPagina / 2, y, { align: 'center' });
  y += 10;
  doc.autoTable({
    startY: y,
    head: [['FECHA', 'CONCEPTO', 'CLIENTE/PROVEEDOR', 'FOLIO', 'RUBRO', 'ENTRADA', 'SALIDA', 'SALDO']],
    body: movimientos.map((m) => [window.formatearFecha(m.fecha), m.concepto, m.contraparte, m.folio, RUBROS[m.rubro], formatearMonto(m.entrada), formatearMonto(m.salida), window.formatearMoneda(m.saldo)]),
    foot: [['', '', '', '', 'TOTALES', window.formatearMoneda(totales.entradas), window.formatearMoneda(totales.salidas), window.formatearMoneda(saldoFinal)]],
    headStyles: { fillColor: [0, 29, 61] },
    footStyles: { fillColor: [230, 230, 230], textColor: [0, 0, 0] },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    styles: { fontSize: 8 }
  });
  return doc;
}

function construirFilasCSVFlujo(movimientos, totales, saldoFinal) {
  const filas = movimientos.map((m) => ({
    'Fecha': m.fecha,
    'Tipo': m.tipo,
    'Rubro': RUBROS[m.rubro],
    'Concepto': m.concepto,
    'Cliente/Proveedor': m.contraparte,
    'Folio': m.folio,
    'Entrada': m.entrada,
    'Salida': m.salida,
    'Saldo': m.saldo,
    'Origen': m.origen,
    'Alerta': m.alertaIva ? TEXTO_ALERTA_IVA : ''
  }));
  const resumen = (concepto, extra) => ({
    'Fecha': '', 'Tipo': '', 'Rubro': '', 'Concepto': concepto, 'Cliente/Proveedor': '', 'Folio': '', 'Entrada': '', 'Salida': '', 'Saldo': '', 'Origen': '', 'Alerta': '', ...extra
  });
  if (filas.length > 0) {
    filas.push(resumen('TOTAL ENTRADAS', { 'Entrada': totales.entradas }));
    filas.push(resumen('TOTAL SALIDAS', { 'Salida': totales.salidas }));
    filas.push(resumen('NETO DEL PERIODO', { 'Saldo': totales.neto }));
    filas.push(resumen('FLUJO OPERATIVO', { 'Saldo': totales.operativo }));
    filas.push(resumen('FLUJO DE FINANCIAMIENTO', { 'Saldo': totales.financiamiento }));
    filas.push(resumen('SALDO FINAL', { 'Saldo': saldoFinal }));
  }
  return filas;
}

function exportarFlujoTXT() {
  const { movimientos, periodo, totales, saldoFinal } = construirResumenExportacion();
  const blob = new Blob([generarTXTFlujo(movimientos, periodo, totales, saldoFinal)], { type: 'text/plain;charset=utf-8;' });
  window.descargarArchivo(blob, `Reporte_Flujo_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.txt`);
}

function exportarFlujoPDF() {
  const { movimientos, periodo, totales, saldoFinal } = construirResumenExportacion();
  generarPDFFlujo(movimientos, periodo, totales, saldoFinal).save(`Reporte_Flujo_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.pdf`);
}

function exportarFlujoCSV() {
  const { movimientos, periodo, totales, saldoFinal } = construirResumenExportacion();
  window.exportarCSV(construirFilasCSVFlujo(movimientos, totales, saldoFinal), `Reporte_Flujo_${periodo.etiquetaReporte}_${window.obtenerFechaMexico()}.csv`);
}

Object.assign(window.EVE_FLUJO, {
  generarTXTFlujo,
  construirFilasCSVFlujo
});

function crearBarraAcciones() {
  const div = document.createElement('div');
  div.className = 'destaraje-exportar';
  div.appendChild(crearBotonAccion('Exportar TXT', exportarFlujoTXT));
  div.appendChild(crearBotonAccion('Exportar PDF', exportarFlujoPDF));
  div.appendChild(crearBotonAccion('Exportar CSV', exportarFlujoCSV));
  const botonCaptura = crearBotonAccion('Vista para captura', abrirVistaCapturaFlujo);
  botonCaptura.id = 'btn-vista-captura-flujo';
  div.appendChild(botonCaptura);
  return div;
}

function renderFlujo(container) {
  tabActiva = 'hoy';
  filtros = { desde: '', hasta: '', texto: '', tipo: '' };
  editandoId = null;

  if (window.puedeEscribir(PERMISO)) container.appendChild(crearFormulario());
  container.appendChild(crearTabsInternas());
  container.appendChild(crearBarraFiltros());
  container.appendChild(crearAvisoFuentes());
  container.appendChild(crearStats());
  container.appendChild(crearBarraAcciones());
  container.appendChild(crearTabla());
  container.appendChild(crearModalEdicion());

  renderizarVista();
}

window.EVE_MODULES.flujo = { render: renderFlujo };

})();
