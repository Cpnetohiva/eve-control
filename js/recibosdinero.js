(function () {

// Módulo Recibos de dinero (grupo Ventas): documento con folio y seguimiento de dinero recibido de un cliente (anticipo / pago a
// cuenta o pago de contado). Validación y cálculo, importe con letra, folio RD-DDMMAAAA-NNN con consecutivo diario, guardado
// atómico, estados (Emitido → Cancelado) y la pantalla de captura y lista.
//
// IMPORTANTE: es solo un documento. NO crea ni modifica cobros, anticipos, CxC, Flujo de efectivo ni ningún otro dato: lo único
// que escribe es recibos_dinero, el contador del día (contadores/RD-DDMMAAAA) y la bitácora historial_cambios. Un recibo Emitido
// no se edita ni se elimina: solo se cancela, con motivo, y su folio se conserva. El emisor y los totales salen de
// EVE_COTIZACIONES (mismo config/emisor y mismo redondeo); el importe con letra, de EVE_COTIZACIONES_PDF. Debe cargarse después de
// js/cotizaciones.js y js/cotizaciones-pdf.js. El PDF vive en js/recibosdinero-pdf.js.

const cot = () => window.EVE_COTIZACIONES;
const PERMISO = 'recibosDinero';

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor)).trim();
const clonar = (valor) => JSON.parse(JSON.stringify(valor === undefined ? null : valor));

// ── Catálogos ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const TIPO_ANTICIPO = 'Anticipo';
const TIPO_CONTADO = 'Pago de contado';
const TIPOS_RECIBO = [TIPO_ANTICIPO, TIPO_CONTADO];
const ETIQUETA_TIPO = { [TIPO_ANTICIPO]: 'Anticipo / pago a cuenta', [TIPO_CONTADO]: 'Pago de contado' };
const FORMAS_PAGO = ['Efectivo', 'Transferencia', 'Cheque', 'Otro'];
const MONEDAS = ['MXN', 'USD'];
const MONEDA_DEFAULT = 'MXN';

// ── Estados y transiciones ──────────────────────────────────────────────────────────────────────────────────────────────
// Espejo de las reglas de recibos_dinero en firestore.rules. Un recibo nace Emitido; Cancelado es final.
const ESTADO_EMITIDO = 'Emitido';
const ESTADO_CANCELADO = 'Cancelado';
const ESTADOS_RECIBO = [ESTADO_EMITIDO, ESTADO_CANCELADO];
const TRANSICIONES_RECIBO = {
  [ESTADO_EMITIDO]: [ESTADO_CANCELADO],
  [ESTADO_CANCELADO]: []
};
const transicionValida = (de, a) => (TRANSICIONES_RECIBO[de] || []).includes(a);

const LARGO_MAX = { nombre: 150, domicilio: 250, concepto: 500, referencia: 100, pedidoReferencia: 100, descripcion: 200, motivo: 300 };

const usuarioActual = () => (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema';
const sinConexion = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Minúsculas, sin acentos y espacios colapsados: sirve para buscar y agrupar clientes sin depender de cómo se escribió el nombre.
function normalizarBusqueda(valor) {
  return texto(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

// ── Importe con letra ───────────────────────────────────────────────────────────────────────────────────────────────────
// 30000 → "TREINTA MIL PESOS 00/100 MN"; en dólares, "... DÓLARES 00/100 USD". Reutiliza la conversión de Cotizaciones
// (totalEnLetra, que termina en "M.N.") y solo cambia la moneda y el cierre.
function importeConLetra(importe, moneda) {
  if (!window.EVE_COTIZACIONES_PDF) throw new Error('El módulo de PDF de cotizaciones no está cargado');
  const pesos = window.EVE_COTIZACIONES_PDF.totalEnLetra(importe).replace(/ M\.N\.$/, '');
  if (moneda === 'USD') return `${pesos.replace(/(DE )?PESOS?(?= \d{2}\/100$)/, (parte) => parte.replace('PESOS', 'DÓLARES').replace('PESO', 'DÓLAR'))} USD`;
  return `${pesos} MN`;
}

const formatoImporte = (importe, moneda) => `${window.formatearMoneda(importe)} ${moneda || MONEDA_DEFAULT}`;

// ── Folio RD-DDMMAAAA-NNN ───────────────────────────────────────────────────────────────────────────────────────────────
// Un contador por día en contadores/RD-DDMMAAAA con { ultimo }: el consecutivo reinicia cada día y el folio se toma dentro de la
// MISMA transacción que guarda el recibo (si el guardado falla no se pierde el número; si dos usuarios piden a la vez, uno
// reintenta y recibe el siguiente). Como un recibo no se elimina, un folio jamás se reutiliza. El día es el de emisión (hoy en
// México), no la fecha capturada en el recibo.
const PREFIJO_FOLIO = 'RD';
const DIGITOS_FOLIO = 3;

function diaDeFolio(fechaIso) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto(fechaIso));
  if (!partes) throw new Error(`Fecha de folio no válida: ${JSON.stringify(fechaIso)}`);
  return `${partes[3]}${partes[2]}${partes[1]}`;
}

function formatearFolio(fechaIso, numero) {
  return `${PREFIJO_FOLIO}-${diaDeFolio(fechaIso)}-${String(numero).padStart(DIGITOS_FOLIO, '0')}`;
}

async function tomarFolioEnTransaccion(tx, fechaIso) {
  const ref = window.db.collection(window.COLECCIONES.CONTADORES).doc(`${PREFIJO_FOLIO}-${diaDeFolio(fechaIso)}`);
  const documento = await tx.get(ref);
  const ultimo = documento.exists ? Number(documento.data().ultimo) || 0 : 0;
  const siguiente = ultimo + 1;
  tx.set(ref, { ultimo: siguiente, prefijo: PREFIJO_FOLIO, dia: fechaIso });
  return formatearFolio(fechaIso, siguiente);
}

// ── Validación y construcción ───────────────────────────────────────────────────────────────────────────────────────────
const RFC_VALIDO = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/;
const IMPORTE_VALIDO = /^\d{1,12}(\.\d{1,2})?$/;

// Una partida sin descripción, cantidad ni precio es una fila vacía del resumen (opcional): se ignora.
const partidaVacia = (p) => !texto(p && p.descripcion) && texto(p && p.cantidad) === '' && texto(p && p.precioUnitario) === '';
const partidasCapturadas = (datos) => (datos.tipo === TIPO_ANTICIPO && Array.isArray(datos.partidas) ? datos.partidas : []).filter((p) => !partidaVacia(p));

function importePartida(p) {
  return cot().redondear2((Number(p.cantidad) || 0) * (Number(p.precioUnitario) || 0));
}

// Total de la operación, importe recibido y saldo pendiente (total − recibido). Sin partidas capturadas no hay resumen (null).
function calcularResumen(partidas, importeRecibido) {
  const lista = (partidas || []).filter((p) => !partidaVacia(p));
  if (lista.length === 0) return null;
  const totalOperacion = cot().redondear2(lista.reduce((suma, p) => suma + importePartida(p), 0));
  const recibido = cot().redondear2(Number(importeRecibido) || 0);
  return { totalOperacion, importeRecibido: recibido, saldoPendiente: cot().redondear2(totalOperacion - recibido) };
}

// Devuelve { ok, errores } con un mensaje por campo. Claves: 'tipo', 'cliente.nombre|rfc|domicilio', 'fecha', 'importe',
// 'moneda', 'formaPago', 'referencia', 'concepto', 'pedidoReferencia' y 'partidas.N.descripcion|cantidad|unidad|precioUnitario'.
// No modifica los datos.
function validarRecibo(datos) {
  const errores = {};
  const d = datos || {};
  const cliente = d.cliente || {};
  if (!TIPOS_RECIBO.includes(d.tipo)) errores.tipo = 'Elige el tipo de recibo';
  if (!texto(cliente.nombre)) errores['cliente.nombre'] = 'Escribe de quién se recibe el dinero';
  else if (!normalizarBusqueda(cliente.nombre).replace(/[^a-z0-9]/g, '')) errores['cliente.nombre'] = 'El nombre debe llevar letras o números';
  else if (texto(cliente.nombre).length > LARGO_MAX.nombre) errores['cliente.nombre'] = `Máximo ${LARGO_MAX.nombre} caracteres`;
  if (texto(cliente.rfc) && !RFC_VALIDO.test(texto(cliente.rfc).toUpperCase())) errores['cliente.rfc'] = 'El RFC no es válido (12 o 13 caracteres)';
  if (texto(cliente.domicilio).length > LARGO_MAX.domicilio) errores['cliente.domicilio'] = `Máximo ${LARGO_MAX.domicilio} caracteres`;
  if (!cot().fechaIsoValida(d.fecha)) errores.fecha = 'La fecha no es válida (dd/mm/aaaa)';

  const importeTexto = texto(d.importe);
  if (!IMPORTE_VALIDO.test(importeTexto)) errores.importe = 'Escribe un importe con máximo 2 decimales';
  else if (!(Number(importeTexto) > 0)) errores.importe = 'El importe debe ser mayor a 0';
  if (!MONEDAS.includes(d.moneda)) errores.moneda = 'Elige la moneda';
  if (!FORMAS_PAGO.includes(d.formaPago)) errores.formaPago = 'Elige la forma de pago';
  if (texto(d.referencia).length > LARGO_MAX.referencia) errores.referencia = `Máximo ${LARGO_MAX.referencia} caracteres`;
  if (!texto(d.concepto)) errores.concepto = 'Escribe el concepto del pago';
  else if (texto(d.concepto).length > LARGO_MAX.concepto) errores.concepto = `Máximo ${LARGO_MAX.concepto} caracteres`;
  if (texto(d.pedidoReferencia).length > LARGO_MAX.pedidoReferencia) errores.pedidoReferencia = `Máximo ${LARGO_MAX.pedidoReferencia} caracteres`;

  const partidas = Array.isArray(d.partidas) ? d.partidas : [];
  partidas.forEach((p, i) => {
    if (d.tipo !== TIPO_ANTICIPO || partidaVacia(p)) return;
    const clave = (campo) => `partidas.${i}.${campo}`;
    if (!texto(p.descripcion)) errores[clave('descripcion')] = 'Escribe la descripción';
    else if (texto(p.descripcion).length > LARGO_MAX.descripcion) errores[clave('descripcion')] = `Máximo ${LARGO_MAX.descripcion} caracteres`;
    if (!(Number(p.cantidad) > 0)) errores[clave('cantidad')] = 'La cantidad debe ser mayor a 0';
    if (!cot().UNIDADES_COTIZACION.includes(texto(p.unidad))) errores[clave('unidad')] = 'Elige la unidad';
    if (!(Number(p.precioUnitario) > 0)) errores[clave('precioUnitario')] = 'El precio debe ser mayor a 0';
  });
  // El saldo pendiente no puede salir negativo: el dinero recibido no debe pasar del total de la operación descrita.
  if (!errores.importe && Object.keys(errores).every((clave) => !clave.startsWith('partidas.'))) {
    const resumen = calcularResumen(partidasCapturadas(d), importeTexto);
    if (resumen && resumen.saldoPendiente < 0) errores.importe = 'El importe recibido es mayor al total de la operación descrita';
  }
  return { ok: Object.keys(errores).length === 0, errores };
}

// Snapshot completo del recibo (sin folio, estado ni metadatos): cliente, importe con letra, resumen de la operación (solo
// Anticipo con partidas capturadas) y el emisor vigente al guardar. Supone datos ya validados.
function construirRecibo(datos, emisor) {
  const importe = cot().redondear2(Number(datos.importe));
  const capturadas = partidasCapturadas(datos);
  const partidas = capturadas.map((p) => ({
    descripcion: texto(p.descripcion),
    cantidad: Number(p.cantidad),
    unidad: texto(p.unidad),
    precioUnitario: Number(p.precioUnitario),
    importe: importePartida(p)
  }));
  const resumen = calcularResumen(capturadas, importe);
  const cliente = { nombre: texto(datos.cliente.nombre), rfc: texto(datos.cliente.rfc).toUpperCase(), domicilio: texto(datos.cliente.domicilio) };
  return {
    tipo: datos.tipo,
    cliente,
    clienteNormalizado: normalizarBusqueda(cliente.nombre),
    fecha: datos.fecha,
    importe,
    moneda: datos.moneda,
    importeLetra: importeConLetra(importe, datos.moneda),
    formaPago: datos.formaPago,
    referencia: texto(datos.referencia),
    concepto: texto(datos.concepto),
    pedidoReferencia: texto(datos.pedidoReferencia),
    resumen: resumen ? { partidas, ...resumen } : null,
    emisor: cot().normalizarEmisor(emisor)
  };
}

// ── Firestore ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Entrada de historial_cambios dentro de la transacción: se confirma o se descarta junto con el cambio que describe.
function registrarEnTransaccion(tx, { registroId, accion, valorAnterior, valorNuevo, motivo, usuario }) {
  tx.set(window.db.collection('historial_cambios').doc(), {
    coleccion: 'recibos_dinero', registroId, accion, valorAnterior, valorNuevo, motivo, usuario, timestamp: new Date().toISOString()
  });
}

const coleccionRecibos = () => window.db.collection(window.COLECCIONES.RECIBOS_DINERO);

// Guarda un recibo NUEVO en UNA transacción: folio (contadores/RD-DDMMAAAA) + documento en Emitido + historial. Si algo falla no
// se consume el folio. No hay edición: un recibo emitido solo se cancela. Requiere red. Devuelve { id, folio, documento }.
async function guardarRecibo(datos) {
  if (!window.puedeEscribir(PERMISO)) throw new Error('No tienes permiso para emitir recibos de dinero');
  const validacion = validarRecibo(datos);
  if (!validacion.ok) throw Object.assign(new Error('Revisa los campos marcados'), { errores: validacion.errores });
  if (sinConexion()) throw new Error('Sin conexión: el recibo solo se puede emitir con internet. No se guardó nada.');

  const recibo = construirRecibo(datos, await cot().obtenerEmisor());
  const usuario = usuarioActual();
  const ahora = new Date().toISOString();
  const hoy = window.obtenerFechaMexico();
  const ref = coleccionRecibos().doc();

  return window.db.runTransaction(async (tx) => {
    const folio = await tomarFolioEnTransaccion(tx, hoy);
    const documento = { ...recibo, folio, estado: ESTADO_EMITIDO, creadoPor: usuario, fechaRegistro: ahora, historialEstados: [{ de: null, a: ESTADO_EMITIDO, usuario, fecha: ahora }] };
    tx.set(ref, documento);
    registrarEnTransaccion(tx, {
      registroId: ref.id, accion: 'alta', valorAnterior: null, valorNuevo: { folio, importe: recibo.importe, moneda: recibo.moneda, estado: ESTADO_EMITIDO },
      motivo: `Alta del recibo de dinero ${folio}`, usuario
    });
    return { id: ref.id, folio, documento };
  });
}

// Cancela un recibo Emitido en UNA transacción con relectura fresca: la transición se valida contra el estado REAL del servidor
// (otro usuario pudo cancelarlo) y el motivo es obligatorio. Solo escribe los campos de la cancelación: el resto del recibo
// (importes, cliente, folio) no se toca. Si ya no procede, el error lleva `documentoActual`. Requiere red.
// Devuelve { id, folio, documento }.
async function cancelarRecibo(id, motivo) {
  if (!window.puedeEscribir(PERMISO)) throw new Error('No tienes permiso para cancelar recibos de dinero');
  const motivoLimpio = texto(motivo);
  if (!motivoLimpio) throw new Error('El motivo de la cancelación es obligatorio');
  if (motivoLimpio.length > LARGO_MAX.motivo) throw new Error(`El motivo no puede pasar de ${LARGO_MAX.motivo} caracteres`);
  if (sinConexion()) throw new Error('Sin conexión: el recibo solo se puede cancelar con internet. No se canceló nada.');

  const usuario = usuarioActual();
  const ref = coleccionRecibos().doc(id);
  return window.db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    if (!actual.exists) throw new Error('El recibo ya no existe');
    const datos = actual.data();
    if (!transicionValida(datos.estado, ESTADO_CANCELADO)) {
      throw Object.assign(new Error(`No se puede cancelar ${datos.folio}: ya está en estado ${datos.estado}. Se actualizó la lista`), { documentoActual: { id, ...datos } });
    }
    const ahora = new Date().toISOString();
    const historialEstados = [...(Array.isArray(datos.historialEstados) ? datos.historialEstados : []), { de: datos.estado, a: ESTADO_CANCELADO, usuario, fecha: ahora, motivo: motivoLimpio }];
    const cambios = { estado: ESTADO_CANCELADO, motivoCancelacion: motivoLimpio, canceladoPor: usuario, canceladoEn: ahora, historialEstados, actualizadoPor: usuario, actualizadoEn: ahora };
    tx.set(ref, cambios, { merge: true });
    registrarEnTransaccion(tx, {
      registroId: id, accion: 'cancelacion', valorAnterior: { folio: datos.folio, estado: datos.estado }, valorNuevo: { folio: datos.folio, estado: ESTADO_CANCELADO },
      motivo: `Cancelación de ${datos.folio}: ${motivoLimpio}`, usuario
    });
    return { id, folio: datos.folio, documento: { ...datos, ...cambios } };
  });
}

// Lee un recibo del servidor. Devuelve { id, ...datos } o null si no existe.
async function obtenerRecibo(id) {
  const documento = await coleccionRecibos().doc(id).get();
  return documento.exists ? { id, ...documento.data() } : null;
}

// Vuelve a leer recibos_dinero del servidor y rehace window.EVE.recibosDinero.
async function cargarDatos() {
  window.EVE.recibosDinero = window.puedeLeer(PERMISO) ? await window.cargarDatos(window.COLECCIONES.RECIBOS_DINERO) : [];
  return window.EVE.recibosDinero;
}

// ── Lista: filtros, totales y autocompletado ────────────────────────────────────────────────────────────────────────────
// filtros: { buscar (folio o cliente, sin distinguir mayúsculas ni acentos), tipo ('' = todos), estado ('' = todos),
// desde / hasta (YYYY-MM-DD, '' = abierto) }
function filtrarRecibos(lista, filtros) {
  const f = filtros || {};
  const buscado = normalizarBusqueda(f.buscar);
  const desde = texto(f.desde);
  const hasta = texto(f.hasta);
  return (lista || []).filter((r) => {
    if (f.tipo && r.tipo !== f.tipo) return false;
    if (f.estado && r.estado !== f.estado) return false;
    if (buscado) {
      const folio = normalizarBusqueda(r.folio);
      const cliente = r.clienteNormalizado || normalizarBusqueda(r.cliente && r.cliente.nombre);
      if (!folio.includes(buscado) && !cliente.includes(buscado)) return false;
    }
    if (desde || hasta) {
      const fecha = texto(r.fecha);
      if (!fecha || (desde && fecha < desde) || (hasta && fecha > hasta)) return false;
    }
    return true;
  });
}

// Por estado: cantidad y total por moneda (MXN y USD no se suman entre sí).
function totalesPorEstado(lista) {
  return ESTADOS_RECIBO.map((estado) => {
    const delEstado = (lista || []).filter((r) => r.estado === estado);
    const porMoneda = MONEDAS.map((moneda) => ({
      moneda,
      total: cot().redondear2(delEstado.filter((r) => (r.moneda || MONEDA_DEFAULT) === moneda).reduce((suma, r) => suma + (Number(r.importe) || 0), 0)),
      cantidad: delEstado.filter((r) => (r.moneda || MONEDA_DEFAULT) === moneda).length
    })).filter((t) => t.cantidad > 0);
    return { estado, cantidad: delEstado.length, porMoneda };
  });
}

// Clientes para el autocompletado de "Recibimos de": los de recibos anteriores (el más reciente gana, con su RFC y domicilio) y,
// si el usuario puede leerlos, los clientes de Cotizaciones. Ordenados por nombre.
function clientesParaAutocompletar(recibos, clientesCotizacion) {
  const porClave = new Map();
  (clientesCotizacion || []).forEach((c) => {
    const nombre = texto(c.razonSocial);
    const clave = normalizarBusqueda(nombre);
    if (clave) porClave.set(clave, { nombre, rfc: '', domicilio: texto(c.direccion) });
  });
  (recibos || []).slice().sort((a, b) => texto(a.fecha).localeCompare(texto(b.fecha))).forEach((r) => {
    const nombre = texto(r.cliente && r.cliente.nombre);
    const clave = normalizarBusqueda(nombre);
    if (!clave) return;
    const previo = porClave.get(clave) || { rfc: '', domicilio: '' };
    porClave.set(clave, { nombre, rfc: texto(r.cliente.rfc) || previo.rfc, domicilio: texto(r.cliente.domicilio) || previo.domicilio });
  });
  return Array.from(porClave.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
}

window.EVE_RECIBOS_DINERO = {
  TIPO_ANTICIPO,
  TIPO_CONTADO,
  TIPOS_RECIBO,
  ETIQUETA_TIPO,
  FORMAS_PAGO,
  MONEDAS,
  ESTADO_EMITIDO,
  ESTADO_CANCELADO,
  ESTADOS_RECIBO,
  TRANSICIONES_RECIBO,
  transicionValida,
  normalizarBusqueda,
  importeConLetra,
  formatoImporte,
  diaDeFolio,
  formatearFolio,
  calcularResumen,
  validarRecibo,
  construirRecibo,
  guardarRecibo,
  cancelarRecibo,
  obtenerRecibo,
  cargarDatos,
  filtrarRecibos,
  totalesPorEstado,
  clientesParaAutocompletar
};

// ── Pantalla: captura y lista de recibos de dinero ──────────────────────────────────────────────────────────────────────
// Reutiliza las clases cot-* de css/styles.css (mismo aspecto que Cotizaciones y Órdenes de Compra).
function crearElemento(etiqueta, clase, contenido) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (contenido !== undefined) nodo.textContent = contenido;
  return nodo;
}

function crearInput(tipo, atributos) {
  const input = document.createElement('input');
  input.type = tipo;
  Object.keys(atributos || {}).forEach((nombre) => input.setAttribute(nombre, atributos[nombre]));
  return input;
}

function crearSelect(opciones, valor) {
  const select = document.createElement('select');
  opciones.forEach((opcion) => {
    const nodo = document.createElement('option');
    nodo.value = opcion.valor;
    nodo.textContent = opcion.texto;
    select.appendChild(nodo);
  });
  select.value = valor;
  return select;
}

// Campo con etiqueta, el control y un hueco para el mensaje de error (se llena en marcarErrores).
function crearCampo(etiqueta, control, claveError) {
  const campo = crearElemento('label', 'cot-campo');
  campo.appendChild(crearElemento('span', 'cot-etiqueta', etiqueta));
  campo.appendChild(control);
  const error = crearElemento('small', 'cot-error');
  error.dataset.error = claveError;
  campo.appendChild(error);
  control.dataset.campo = claveError;
  return campo;
}

function marcar(control, nodoError, mensaje) {
  if (control) control.classList.toggle('campo-invalido', !!mensaje);
  if (nodoError) nodoError.textContent = mensaje || '';
}

const CAMPOS_PARTIDA = ['descripcion', 'cantidad', 'unidad', 'precioUnitario'];

function marcarErrores(form, errores) {
  form.querySelectorAll('[data-campo]').forEach((control) => marcar(control, form.querySelector(`[data-error="${control.dataset.campo}"]`), errores[control.dataset.campo]));
  form.querySelectorAll('.cot-partida').forEach((fila, i) => {
    CAMPOS_PARTIDA.forEach((nombre) => {
      marcar(fila.querySelector(`[data-f="${nombre}"]`), fila.querySelector(`[data-e="${nombre}"]`), errores[`partidas.${i}.${nombre}`]);
    });
  });
  const primero = form.querySelector('.campo-invalido');
  if (primero && typeof primero.focus === 'function') primero.focus();
}

function fechaDesdeTexto(textoFecha) {
  return /^\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}\s*$/.test(textoFecha || '') ? (window.parsearFecha(textoFecha) || '') : '';
}

function crearFilaPartida(partida, soloLectura) {
  const valores = partida || { descripcion: '', cantidad: '', unidad: 'PZ', precioUnitario: '' };
  const fila = document.createElement('tr');
  fila.className = 'cot-partida';
  const controles = [
    ['descripcion', crearInput('text', { maxlength: String(LARGO_MAX.descripcion), placeholder: 'Descripción del producto' }), valores.descripcion],
    ['cantidad', crearInput('number', { min: '0', step: 'any', inputmode: 'decimal' }), valores.cantidad],
    ['unidad', crearSelect(cot().UNIDADES_COTIZACION.map((u) => ({ valor: u, texto: u })), cot().UNIDADES_COTIZACION.includes(valores.unidad) ? valores.unidad : 'PZ'), null],
    ['precioUnitario', crearInput('number', { min: '0', step: 'any', inputmode: 'decimal' }), valores.precioUnitario]
  ];
  controles.forEach(([nombre, control, valor]) => {
    const celda = document.createElement('td');
    control.dataset.f = nombre;
    if (valor !== null && valor !== undefined) control.value = valor;
    const error = crearElemento('small', 'cot-error');
    error.dataset.e = nombre;
    celda.append(control, error);
    fila.appendChild(celda);
  });
  fila.appendChild(crearElemento('td', 'cot-importe mono'));
  const celdaQuitar = document.createElement('td');
  const quitar = crearElemento('button', 'btn-secondary cot-quitar', '✕');
  quitar.type = 'button';
  quitar.title = 'Quitar partida';
  quitar.setAttribute('aria-label', 'Quitar partida');
  celdaQuitar.appendChild(quitar);
  fila.appendChild(celdaQuitar);
  if (soloLectura) {
    fila.querySelectorAll('input, select').forEach((control) => { control.disabled = true; });
    quitar.style.display = 'none';
  }
  return fila;
}

function leerFila(fila) {
  const valor = (nombre) => fila.querySelector(`[data-f="${nombre}"]`).value;
  return { descripcion: valor('descripcion'), cantidad: valor('cantidad'), unidad: valor('unidad'), precioUnitario: valor('precioUnitario') };
}

function leerFormulario(form) {
  const valor = (clave) => form.querySelector(`[data-campo="${clave}"]`).value;
  return {
    tipo: valor('tipo'),
    cliente: { nombre: valor('cliente.nombre'), rfc: valor('cliente.rfc'), domicilio: valor('cliente.domicilio') },
    fecha: fechaDesdeTexto(valor('fecha')),
    importe: valor('importe'),
    moneda: valor('moneda'),
    formaPago: valor('formaPago'),
    referencia: valor('referencia'),
    concepto: valor('concepto'),
    pedidoReferencia: valor('pedidoReferencia'),
    partidas: Array.from(form.querySelectorAll('.cot-partida')).map(leerFila)
  };
}

// Importe con letra, importes de partida, total de la operación y saldo pendiente en vivo; el resumen solo se ve en Anticipo.
function recalcular(form) {
  const datos = leerFormulario(form);
  const importeTexto = texto(datos.importe);
  const importeValido = IMPORTE_VALIDO.test(importeTexto) && Number(importeTexto) > 0;
  form.querySelector('[data-campo="importeLetra"]').value = importeValido ? importeConLetra(Number(importeTexto), datos.moneda) : '';

  const esAnticipo = datos.tipo === TIPO_ANTICIPO;
  const seccion = form.querySelector('.rd-resumen');
  if (seccion) seccion.style.display = esAnticipo ? '' : 'none';
  const filas = Array.from(form.querySelectorAll('.cot-partida'));
  filas.forEach((fila, i) => { fila.querySelector('.cot-importe').textContent = partidaVacia(datos.partidas[i]) ? '' : window.formatearMoneda(importePartida(datos.partidas[i])); });
  form.querySelectorAll('.cot-quitar').forEach((boton) => { boton.disabled = filas.length <= 1; });
  const resumen = calcularResumen(datos.partidas, importeValido ? importeTexto : 0);
  form.querySelector('[data-total="totalOperacion"]').textContent = resumen ? window.formatearMoneda(resumen.totalOperacion) : '';
  form.querySelector('[data-total="importeRecibido"]').textContent = resumen ? window.formatearMoneda(resumen.importeRecibido) : '';
  form.querySelector('[data-total="saldoPendiente"]').textContent = resumen ? window.formatearMoneda(resumen.saldoPendiente) : '';
}

// Reemplaza (o agrega) un documento en la copia en memoria.
function refrescarEnMemoria(documento) {
  const lista = window.EVE.recibosDinero;
  const indice = lista.findIndex((r) => r.id === documento.id);
  if (indice === -1) lista.push(documento); else lista[indice] = documento;
}

const clienteDe = (recibo) => texto(recibo.cliente && recibo.cliente.nombre);
const puedeCancelar = (recibo) => window.puedeEscribir(PERMISO) && recibo.estado === ESTADO_EMITIDO;

// Pide el motivo y cancela. Devuelve true si la lista hay que volver a pintarla (cancelado, o el servidor dice que ya cambió);
// false si el usuario desistió o hubo otro error (ya se mostró).
async function cancelarConMotivo(recibo, boton) {
  const motivo = window.prompt(`Motivo de la cancelación de ${recibo.folio} (obligatorio).\n\nCancelado es un estado final: el recibo se conserva con su folio y ya no podrá cambiar.`);
  if (motivo === null) return false;
  if (!texto(motivo)) {
    window.showError('El motivo de la cancelación es obligatorio');
    return false;
  }
  boton.disabled = true;
  try {
    const resultado = await cancelarRecibo(recibo.id, motivo);
    refrescarEnMemoria({ id: resultado.id, ...resultado.documento });
    window.showSuccess(`Recibo ${resultado.folio} cancelado`);
    return true;
  } catch (error) {
    window.showError(error.message);
    boton.disabled = false;
    if (!error.documentoActual) return false;
    refrescarEnMemoria(error.documentoActual);
    return true;
  }
}

// `recibo`: null = recibo nuevo; con recibo = solo lectura (un recibo emitido no se edita).
function crearFormulario({ recibo, alTerminar, alCancelar }) {
  const soloLectura = !!recibo;
  const form = crearElemento('form', 'cot-form card');
  form.noValidate = true;
  form.appendChild(crearElemento('h3', `cot-titulo${recibo ? ' mono' : ''}`, recibo ? `Recibo de dinero ${recibo.folio}` : 'Nuevo recibo de dinero'));
  if (recibo && recibo.estado === ESTADO_CANCELADO) {
    const aviso = crearElemento('p', 'cot-nota rd-aviso-cancelado');
    aviso.textContent = `CANCELADO el ${window.formatearFecha(texto(recibo.canceladoEn).slice(0, 10))} por ${texto(recibo.canceladoPor)}. Motivo: ${texto(recibo.motivoCancelacion)}`;
    form.appendChild(aviso);
  }

  const cliente = (recibo && recibo.cliente) || {};
  const lista = document.createElement('datalist');
  lista.id = 'rd-clientes-lista';
  const conocidos = clientesParaAutocompletar(window.EVE.recibosDinero, window.EVE.clientesCotizacion);
  conocidos.forEach((c) => {
    const opcion = document.createElement('option');
    opcion.value = c.nombre;
    lista.appendChild(opcion);
  });
  form.appendChild(lista);

  const tipo = crearSelect(TIPOS_RECIBO.map((t) => ({ valor: t, texto: ETIQUETA_TIPO[t] })), recibo ? recibo.tipo : TIPO_ANTICIPO);
  const fecha = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  fecha.value = window.formatearFecha(recibo ? recibo.fecha : window.obtenerFechaMexico());
  const gridTipo = crearElemento('div', 'cot-grid');
  gridTipo.append(crearCampo('Tipo *', tipo, 'tipo'), crearCampo('Fecha *', fecha, 'fecha'));
  form.appendChild(gridTipo);

  const nombre = crearInput('text', { maxlength: String(LARGO_MAX.nombre), list: lista.id, autocomplete: 'off' });
  const rfc = crearInput('text', { maxlength: '13', autocomplete: 'off' });
  const domicilio = crearInput('text', { maxlength: String(LARGO_MAX.domicilio) });
  nombre.value = cliente.nombre || '';
  rfc.value = cliente.rfc || '';
  domicilio.value = cliente.domicilio || '';
  const gridCliente = crearElemento('div', 'cot-grid');
  gridCliente.append(
    crearCampo('Recibimos de *', nombre, 'cliente.nombre'),
    crearCampo('RFC (opcional)', rfc, 'cliente.rfc'),
    crearCampo('Domicilio / Ciudad', domicilio, 'cliente.domicilio')
  );
  form.appendChild(gridCliente);
  // Al elegir un cliente conocido se rellenan RFC y domicilio, sin pisar lo que ya se haya escrito.
  nombre.addEventListener('change', () => {
    const clave = normalizarBusqueda(nombre.value);
    const existente = clave && conocidos.find((c) => normalizarBusqueda(c.nombre) === clave);
    if (!existente) return;
    if (!rfc.value.trim()) rfc.value = existente.rfc;
    if (!domicilio.value.trim()) domicilio.value = existente.domicilio;
  });

  const importe = crearInput('number', { min: '0', step: '0.01', inputmode: 'decimal' });
  importe.value = recibo ? recibo.importe : '';
  const moneda = crearSelect(MONEDAS.map((m) => ({ valor: m, texto: m })), recibo ? recibo.moneda : MONEDA_DEFAULT);
  const gridImporte = crearElemento('div', 'cot-grid');
  gridImporte.append(crearCampo('Importe recibido *', importe, 'importe'), crearCampo('Moneda', moneda, 'moneda'));
  form.appendChild(gridImporte);
  const letra = crearInput('text', { readonly: 'readonly', tabindex: '-1' });
  letra.className = 'rd-letra';
  form.appendChild(crearCampo('Importe con letra', letra, 'importeLetra'));

  const formaPago = crearSelect(FORMAS_PAGO.map((f) => ({ valor: f, texto: f })), recibo ? recibo.formaPago : FORMAS_PAGO[0]);
  const referencia = crearInput('text', { maxlength: String(LARGO_MAX.referencia) });
  referencia.value = recibo ? recibo.referencia || '' : '';
  const gridPago = crearElemento('div', 'cot-grid');
  gridPago.append(crearCampo('Forma de pago', formaPago, 'formaPago'), crearCampo('Referencia', referencia, 'referencia'));
  form.appendChild(gridPago);

  const concepto = document.createElement('textarea');
  concepto.rows = 3;
  concepto.maxLength = LARGO_MAX.concepto;
  concepto.placeholder = 'Anticipo / pago a cuenta por compra de: ...';
  concepto.value = recibo ? recibo.concepto || '' : '';
  form.appendChild(crearCampo('Concepto del pago *', concepto, 'concepto'));
  const pedido = crearInput('text', { maxlength: String(LARGO_MAX.pedidoReferencia) });
  pedido.value = recibo ? recibo.pedidoReferencia || '' : '';
  form.appendChild(crearCampo('Pedido / cotización / OC No. (opcional)', pedido, 'pedidoReferencia'));

  // Resumen de la operación: solo en Anticipo y opcional (las filas vacías se ignoran). Varias partidas.
  const hayResumen = !!(recibo && recibo.resumen);
  const seccion = crearElemento('div', 'rd-resumen');
  seccion.appendChild(crearElemento('h4', 'cot-subtitulo', 'Resumen de la operación (opcional)'));
  const envoltura = crearElemento('div', 'destaraje-tabla-wrapper');
  const tabla = crearElemento('table', 'tabla-destaraje cot-tabla');
  tabla.innerHTML = '<thead><tr><th>Descripción del producto</th><th>Cantidad</th><th>Unidad</th><th>Precio unitario</th><th>Importe</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  seccion.appendChild(envoltura);
  (hayResumen ? recibo.resumen.partidas : [null]).forEach((p) => cuerpo.appendChild(crearFilaPartida(p, soloLectura)));
  const agregar = crearElemento('button', 'btn-secondary', '+ Agregar partida');
  agregar.type = 'button';
  agregar.style.display = soloLectura ? 'none' : '';
  agregar.addEventListener('click', () => { cuerpo.appendChild(crearFilaPartida(null, false)); recalcular(form); });
  seccion.appendChild(agregar);
  cuerpo.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.cot-quitar');
    if (!boton || cuerpo.children.length <= 1) return;
    boton.closest('tr').remove();
    recalcular(form);
  });
  const totales = crearElemento('div', 'cot-totales');
  [['totalOperacion', 'Total de la operación'], ['importeRecibido', 'Importe recibido'], ['saldoPendiente', 'Saldo pendiente']].forEach(([clave, rotulo]) => {
    const linea = crearElemento('div', `cot-total-linea${clave === 'saldoPendiente' ? ' cot-total-total' : ''}`);
    linea.appendChild(crearElemento('span', '', rotulo));
    const monto = crearElemento('span', 'mono');
    monto.dataset.total = clave;
    linea.appendChild(monto);
    totales.appendChild(linea);
  });
  seccion.appendChild(totales);
  form.appendChild(seccion);

  form.addEventListener('input', () => recalcular(form));
  form.addEventListener('change', () => recalcular(form));

  const acciones = crearElemento('div', 'cot-acciones');
  if (!soloLectura) {
    const guardar = crearElemento('button', 'btn-primary', 'Emitir recibo');
    guardar.type = 'submit';
    acciones.appendChild(guardar);
  }
  const cerrar = crearElemento('button', 'btn-secondary', soloLectura ? 'Cerrar' : 'Cancelar');
  cerrar.type = 'button';
  cerrar.addEventListener('click', () => alTerminar(false));
  acciones.appendChild(cerrar);
  if (recibo && puedeCancelar(recibo)) {
    const cancelar = crearElemento('button', 'btn-danger cot-eliminar', 'Cancelar recibo');
    cancelar.type = 'button';
    cancelar.addEventListener('click', async () => { if (await alCancelar(recibo, cancelar)) alTerminar(true); });
    acciones.appendChild(cancelar);
  }
  form.appendChild(acciones);

  if (soloLectura) form.querySelectorAll('input, textarea, select').forEach((control) => { control.disabled = true; });
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (soloLectura) return;
    const datos = leerFormulario(form);
    const validacion = validarRecibo(datos);
    marcarErrores(form, validacion.errores);
    if (!validacion.ok) {
      window.showError('Revisa los campos marcados');
      return;
    }
    const botonGuardar = form.querySelector('button[type="submit"]');
    botonGuardar.disabled = true;
    try {
      const resultado = await guardarRecibo(datos);
      refrescarEnMemoria({ id: resultado.id, ...resultado.documento });
      window.showSuccess(`Recibo de dinero ${resultado.folio} emitido`);
      alTerminar(true);
    } catch (error) {
      if (error.errores) marcarErrores(form, error.errores);
      window.showError(error.message);
      botonGuardar.disabled = false;
    }
  });

  recalcular(form);
  if (soloLectura && !hayResumen) seccion.style.display = 'none';
  return form;
}

const CLASE_ESTADO = { Emitido: 'aceptada', Cancelado: 'cancelada' };

function crearEtiquetaEstado(estado) {
  const clase = CLASE_ESTADO[estado];
  return crearElemento('span', `cot-estado${clase ? ` cot-estado-${clase}` : ''}`, texto(estado));
}

// Botones de la fila. `acciones`: { abrir, cancelar }; Cancelar solo para quien puede escribir y mientras esté Emitido.
function crearCeldaAcciones(recibo, acciones) {
  const celda = document.createElement('td');
  const caja = crearElemento('div', 'cot-acciones-fila');
  const ver = crearElemento('button', 'btn-secondary', 'Ver');
  ver.type = 'button';
  ver.addEventListener('click', () => acciones.abrir(recibo));
  caja.appendChild(ver);
  if (puedeCancelar(recibo)) {
    const cancelar = crearElemento('button', 'btn-danger cot-eliminar', 'Cancelar recibo');
    cancelar.type = 'button';
    cancelar.addEventListener('click', () => acciones.cancelar(recibo, cancelar));
    caja.appendChild(cancelar);
  }
  celda.appendChild(caja);
  return celda;
}

function crearTablaRecibos(lista, acciones) {
  const envoltura = crearElemento('div', 'destaraje-tabla-wrapper');
  const tabla = crearElemento('table', 'tabla-destaraje');
  tabla.innerHTML = '<thead><tr><th>Folio</th><th>Fecha</th><th>Cliente</th><th>Tipo</th><th>Importe</th><th>Estado</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  const ordenados = lista.slice().sort((a, b) => texto(b.folio).localeCompare(texto(a.folio)));
  if (ordenados.length === 0) {
    const fila = document.createElement('tr');
    const celda = crearElemento('td', '', 'Sin recibos de dinero');
    celda.colSpan = 7;
    fila.appendChild(celda);
    cuerpo.appendChild(fila);
  }
  ordenados.forEach((r) => {
    const fila = document.createElement('tr');
    fila.dataset.id = r.id;
    fila.appendChild(crearElemento('td', 'mono', texto(r.folio)));
    fila.appendChild(crearElemento('td', 'mono', texto(window.formatearFecha(r.fecha))));
    fila.appendChild(crearElemento('td', '', clienteDe(r)));
    fila.appendChild(crearElemento('td', '', ETIQUETA_TIPO[r.tipo] || texto(r.tipo)));
    fila.appendChild(crearElemento('td', 'mono', formatoImporte(r.importe, r.moneda)));
    const celdaEstado = document.createElement('td');
    celdaEstado.appendChild(crearEtiquetaEstado(r.estado));
    fila.appendChild(celdaEstado);
    fila.appendChild(crearCeldaAcciones(r, acciones));
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  return envoltura;
}

function crearResumenEstados(lista) {
  const resumen = crearElemento('div', 'cot-resumen');
  const conDatos = totalesPorEstado(lista).filter((t) => t.cantidad > 0);
  if (conDatos.length === 0) {
    resumen.appendChild(crearElemento('span', 'cot-nota', 'Sin recibos con estos filtros'));
    return resumen;
  }
  conDatos.forEach((t) => {
    const item = crearElemento('div', 'cot-resumen-item');
    item.dataset.estado = t.estado;
    item.appendChild(crearEtiquetaEstado(t.estado));
    const montos = t.porMoneda.map((m) => formatoImporte(m.total, m.moneda)).join(' + ');
    item.appendChild(crearElemento('span', 'cot-resumen-cantidad mono', `${t.cantidad} · ${montos}`));
    resumen.appendChild(item);
  });
  return resumen;
}

// Controles de filtro: búsqueda por folio o cliente, tipo, estado y Desde/Hasta (dd/mm/aaaa, vacío = abierto). Escribe en
// `filtros` (fechas ya en YYYY-MM-DD) y llama a `alCambiar` en cada cambio.
function crearFiltros(filtros, alCambiar) {
  const caja = crearElemento('div', 'card cot-filtros');
  const grid = crearElemento('div', 'cot-grid');
  const buscar = crearInput('text', { maxlength: '150', placeholder: 'Folio o cliente', autocomplete: 'off' });
  const tipo = crearSelect([{ valor: '', texto: 'Todos' }, ...TIPOS_RECIBO.map((t) => ({ valor: t, texto: ETIQUETA_TIPO[t] }))], '');
  const estado = crearSelect([{ valor: '', texto: 'Todos' }, ...ESTADOS_RECIBO.map((e) => ({ valor: e, texto: e }))], '');
  const desde = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  const hasta = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  grid.append(
    crearCampo('Buscar', buscar, 'filtro.buscar'),
    crearCampo('Tipo', tipo, 'filtro.tipo'),
    crearCampo('Estado', estado, 'filtro.estado'),
    crearCampo('Desde', desde, 'filtro.desde'),
    crearCampo('Hasta', hasta, 'filtro.hasta')
  );
  caja.appendChild(grid);
  // Fecha vacía = sin límite; con texto debe ser dd/mm/aaaa válida (si no, se marca y ese límite no se aplica).
  const leerFecha = (control, clave) => {
    const textoFecha = control.value.trim();
    const iso = textoFecha ? fechaDesdeTexto(textoFecha) : '';
    marcar(control, caja.querySelector(`[data-error="${clave}"]`), textoFecha && !cot().fechaIsoValida(iso) ? 'Fecha no válida (dd/mm/aaaa)' : '');
    return cot().fechaIsoValida(iso) ? iso : '';
  };
  const actualizar = () => {
    filtros.buscar = buscar.value;
    filtros.tipo = tipo.value;
    filtros.estado = estado.value;
    filtros.desde = leerFecha(desde, 'filtro.desde');
    filtros.hasta = leerFecha(hasta, 'filtro.hasta');
    alCambiar();
  };
  caja.addEventListener('input', actualizar);
  caja.addEventListener('change', actualizar);
  return caja;
}

function renderRecibosDinero(container) {
  container.innerHTML = '';
  const raiz = crearElemento('div');
  raiz.id = 'modulo-recibosdinero';
  const encabezado = crearElemento('div', 'cot-encabezado');
  encabezado.appendChild(crearElemento('h2', 'cot-titulo', 'Recibos de dinero'));
  const zonaFormulario = document.createElement('div');
  const zonaResumen = document.createElement('div');
  const zonaLista = document.createElement('div');
  const filtros = { buscar: '', tipo: '', estado: '', desde: '', hasta: '' };

  // actualizarUI: vuelve a pintar el resumen por estado y la lista con los filtros y los datos en memoria.
  const actualizarUI = () => {
    const visibles = filtrarRecibos(window.EVE.recibosDinero || [], filtros);
    zonaResumen.innerHTML = '';
    zonaResumen.appendChild(crearResumenEstados(visibles));
    zonaLista.innerHTML = '';
    const tarjeta = crearElemento('div', 'card');
    tarjeta.appendChild(crearTablaRecibos(visibles, acciones));
    zonaLista.appendChild(tarjeta);
  };
  const cerrar = (huboCambios) => {
    zonaFormulario.innerHTML = '';
    if (huboCambios) actualizarUI();
  };
  function abrir(recibo) {
    zonaFormulario.innerHTML = '';
    zonaFormulario.appendChild(crearFormulario({ recibo, alTerminar: cerrar, alCancelar: cancelarConMotivo }));
    zonaFormulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const acciones = {
    abrir,
    cancelar: async (recibo, boton) => { if (await cancelarConMotivo(recibo, boton)) actualizarUI(); }
  };

  if (window.puedeEscribir(PERMISO)) {
    const nuevo = crearElemento('button', 'btn-primary', '+ Nuevo recibo de dinero');
    nuevo.type = 'button';
    nuevo.addEventListener('click', () => abrir(null));
    encabezado.appendChild(nuevo);
  }
  raiz.append(encabezado, zonaFormulario, crearFiltros(filtros, actualizarUI), zonaResumen, zonaLista);
  container.appendChild(raiz);
  actualizarUI();
}

// La pestaña se llama 'recibosDinero' en ORDEN_TABS (js/auth.js): renderModulo busca el módulo por ese mismo id.
window.EVE_MODULES.recibosDinero = { render: renderRecibosDinero };

})();
