(function () {

// Módulo Cotizaciones: datos del emisor (config/emisor), folios consecutivos por año, cálculo y validación de la
// cotización, guardado atómico (folio + documento + cliente en una sola transacción) y la pantalla de captura y lista.
// El formulario del emisor vive en Admin → Configuración (js/admin-config.js).

// Valores con los que arranca config/emisor mientras Admin no lo capture. Los campos vacíos se llenan desde Admin; el PDF
// de la cotización toma SIEMPRE el emisor de obtenerEmisor(), nunca de constantes del código.
const EMISOR_DEFAULT = {
  razonSocial: 'RIVAL PLASTIC SAPI DE CV',
  rfc: '',
  domicilioFiscal: '',
  telefono: '',
  correo: '',
  condicionesPagoDefault: '',
  condicionesEntregaDefault: '',
  vigenciaDias: 15
};

const CAMPOS_EMISOR_TEXTO = ['razonSocial', 'rfc', 'domicilioFiscal', 'telefono', 'correo', 'condicionesPagoDefault', 'condicionesEntregaDefault'];
const VIGENCIA_DIAS_MAX = 365;

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor)).trim();

// Completa con los valores por omisión lo que falte en el documento (o todo, si config/emisor aún no existe).
function normalizarEmisor(datos) {
  const origen = datos && typeof datos === 'object' ? datos : {};
  const emisor = {};
  CAMPOS_EMISOR_TEXTO.forEach((campo) => {
    const valor = texto(origen[campo]);
    emisor[campo] = valor || EMISOR_DEFAULT[campo];
  });
  const vigencia = Number(origen.vigenciaDias);
  emisor.vigenciaDias = Number.isInteger(vigencia) && vigencia > 0 ? vigencia : EMISOR_DEFAULT.vigenciaDias;
  return emisor;
}

// Devuelve el mensaje del primer problema o null si el emisor se puede guardar.
function validarEmisor(datos) {
  const emisor = datos || {};
  if (!texto(emisor.razonSocial)) return 'La razón social del emisor es obligatoria';
  const correo = texto(emisor.correo);
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return 'El correo del emisor no es válido';
  const vigencia = Number(emisor.vigenciaDias);
  if (!Number.isInteger(vigencia) || vigencia < 1 || vigencia > VIGENCIA_DIAS_MAX) {
    return `La vigencia debe ser un número entero de días entre 1 y ${VIGENCIA_DIAS_MAX}`;
  }
  return null;
}

function construirPayloadEmisor(datos) {
  const payload = {};
  CAMPOS_EMISOR_TEXTO.forEach((campo) => { payload[campo] = texto(datos[campo]); });
  payload.vigenciaDias = Number(datos.vigenciaDias);
  return payload;
}

async function obtenerEmisor() {
  const documento = await window.db.collection('config').doc('emisor').get();
  return normalizarEmisor(documento.exists ? documento.data() : {});
}

async function guardarEmisor(datos) {
  const error = validarEmisor(datos);
  if (error) throw new Error(error);
  const payload = construirPayloadEmisor(datos);
  const ref = window.db.collection('config').doc('emisor');
  const anterior = await ref.get();
  await ref.set(payload, { merge: true });
  if (window.EVE_HISTORIAL && typeof window.EVE_HISTORIAL.registrar === 'function') {
    await window.EVE_HISTORIAL.registrar({
      coleccion: 'config',
      registroId: 'emisor',
      accion: 'edicion',
      valorAnterior: anterior.exists ? anterior.data() : null,
      valorNuevo: payload,
      motivo: 'Edición de los datos del emisor de cotizaciones'
    });
  }
  return payload;
}

// ── Folios consecutivos por año ─────────────────────────────────────────────────────────────────────────────────────
// Un documento por tipo y año en contadores/{PREFIJO-AAAA} con { ultimo }. El folio se toma dentro de una transacción de
// Firestore: si dos usuarios piden folio a la vez, uno de los dos reintenta y recibe el siguiente número (nunca el mismo).
const PREFIJOS_FOLIO = { cotizacion: 'COT', ordenCompra: 'OC' };
const DIGITOS_FOLIO = 4;

function anioActual() {
  return Number(window.obtenerFechaMexico().slice(0, 4));
}

function formatearFolio(prefijo, anio, numero) {
  return `${prefijo}-${anio}-${String(numero).padStart(DIGITOS_FOLIO, '0')}`;
}

function resolverTipoFolio(tipo, anio) {
  const prefijo = PREFIJOS_FOLIO[tipo];
  if (!prefijo) throw new Error(`Tipo de folio desconocido: ${JSON.stringify(tipo)}`);
  const anioFolio = anio === undefined ? anioActual() : Number(anio);
  if (!Number.isInteger(anioFolio) || anioFolio < 2000 || anioFolio > 9999) throw new Error(`Año de folio no válido: ${JSON.stringify(anio)}`);
  return { prefijo, anioFolio };
}

// Para usar DENTRO de la transacción que también guarda el documento (cotización u orden de compra): así el folio y el
// documento se confirman juntos y, si el guardado falla, no se pierde un número. Lee el contador y lo incrementa en tx.
async function tomarFolioEnTransaccion(tx, tipo, anio) {
  const { prefijo, anioFolio } = resolverTipoFolio(tipo, anio);
  const ref = window.db.collection(window.COLECCIONES.CONTADORES).doc(`${prefijo}-${anioFolio}`);
  const documento = await tx.get(ref);
  const ultimo = documento.exists ? Number(documento.data().ultimo) || 0 : 0;
  const siguiente = ultimo + 1;
  tx.set(ref, { ultimo: siguiente, prefijo, anio: anioFolio });
  return formatearFolio(prefijo, anioFolio, siguiente);
}

// Toma un folio suelto en su propia transacción (requiere red). Si no se va a guardar nada después, queda un hueco.
function generarFolio(tipo, anio) {
  resolverTipoFolio(tipo, anio);
  return window.db.runTransaction((tx) => tomarFolioEnTransaccion(tx, tipo, anio));
}

// ── Cálculo y validación de la cotización ──────────────────────────────────────────────────────────────────────────────
const IVA_TASA = 0.16;
const UNIDADES_COTIZACION = ['KG', 'PZ', 'LOTE', 'SERVICIO'];
const ESTADO_BORRADOR = 'Borrador';

// Redondeo único a 2 decimales (mitad hacia arriba) para importes, subtotal, IVA y total. Primero se quita el ruido de la
// coma flotante (2.5 × 33.33 da 83.32499999999999, no 83.325) y se redondea con notación exponencial, para que 83.325 y
// 1.005 suban como en papel en lugar de caer por un error binario.
function redondear2(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 0;
  return Number(`${Math.round(Number(`${Number(numero.toFixed(6))}e2`))}e-2`);
}

// Importe de una partida: cantidad × precio, menos el descuento %. Es lo que se suma al subtotal (ya redondeado).
function calcularImportePartida(partida) {
  const cantidad = Number(partida && partida.cantidad) || 0;
  const precio = Number(partida && partida.precioUnitario) || 0;
  const descuento = Number(partida && partida.descuentoPct) || 0;
  return redondear2(cantidad * precio * (100 - descuento) / 100);
}

// Subtotal = suma de importes (con descuento). El IVA se calcula sobre ese subtotal; total = subtotal + IVA.
function calcularTotales(partidas, aplicaIva) {
  const subtotal = redondear2((partidas || []).reduce((suma, partida) => suma + calcularImportePartida(partida), 0));
  const iva = aplicaIva ? redondear2(subtotal * IVA_TASA) : 0;
  return { subtotal, aplicaIva: !!aplicaIva, ivaTasa: IVA_TASA, iva, total: redondear2(subtotal + iva) };
}

function fechaIsoValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || '')) return false;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const f = new Date(Date.UTC(anio, mes - 1, dia));
  return f.getUTCFullYear() === anio && f.getUTCMonth() === mes - 1 && f.getUTCDate() === dia;
}

// Id del documento de clientes_cotizacion: la Razón Social normalizada (sin acentos, mayúsculas, solo letras y números
// separados por guion). Es determinista, así que dos usuarios que capturan el mismo cliente escriben el MISMO documento.
function claveCliente(razonSocial) {
  return texto(razonSocial).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const CAMPOS_CLIENTE = [
  { campo: 'razonSocial', etiqueta: 'Razón Social', mensaje: 'La Razón Social es obligatoria' },
  { campo: 'contacto', etiqueta: 'Contacto', mensaje: 'El Contacto es obligatorio' },
  { campo: 'telefono', etiqueta: 'Teléfono', mensaje: 'El Teléfono es obligatorio' },
  { campo: 'direccion', etiqueta: 'Dirección', mensaje: 'La Dirección es obligatoria' }
];

const descuentoDe = (p) => (p.descuentoPct === '' || p.descuentoPct === undefined || p.descuentoPct === null ? 0 : Number(p.descuentoPct));

// Devuelve { ok, errores } con un mensaje por campo. Claves: 'cliente.razonSocial', 'fecha', 'vigenciaDias', 'partidas'
// (lista vacía) y 'partidas.N.producto|cantidad|unidad|precioUnitario|descuentoPct'. No modifica los datos.
function validarCotizacion(datos) {
  const errores = {};
  const d = datos || {};
  const cliente = d.cliente || {};
  CAMPOS_CLIENTE.forEach(({ campo, mensaje }) => {
    if (!texto(cliente[campo])) errores[`cliente.${campo}`] = mensaje;
  });
  if (texto(cliente.razonSocial) && !claveCliente(cliente.razonSocial)) errores['cliente.razonSocial'] = 'La Razón Social debe llevar letras o números';

  if (!fechaIsoValida(d.fecha)) errores.fecha = 'La fecha no es válida (dd/mm/aaaa)';
  const vigencia = Number(d.vigenciaDias);
  if (!Number.isInteger(vigencia) || vigencia < 1 || vigencia > VIGENCIA_DIAS_MAX) errores.vigenciaDias = `La vigencia debe ser un entero entre 1 y ${VIGENCIA_DIAS_MAX} días`;

  const partidas = Array.isArray(d.partidas) ? d.partidas : [];
  if (partidas.length === 0) errores.partidas = 'Agrega al menos una partida';
  partidas.forEach((p, i) => {
    const clave = (campo) => `partidas.${i}.${campo}`;
    if (!texto(p.producto) && !texto(p.descripcion)) errores[clave('producto')] = 'Elige un producto o escribe una descripción';
    if (!(Number(p.cantidad) > 0)) errores[clave('cantidad')] = 'La cantidad debe ser mayor a 0';
    if (!UNIDADES_COTIZACION.includes(texto(p.unidad))) errores[clave('unidad')] = 'Elige la unidad';
    if (!(Number(p.precioUnitario) > 0)) errores[clave('precioUnitario')] = 'El precio debe ser mayor a 0';
    const descuento = descuentoDe(p);
    if (!Number.isFinite(descuento) || descuento < 0 || descuento > 100) errores[clave('descuentoPct')] = 'El descuento debe estar entre 0 y 100';
  });
  return { ok: Object.keys(errores).length === 0, errores };
}

// Snapshot completo de la cotización (sin folio, estado ni metadatos de alta): cliente, partidas con su importe, totales y
// el emisor vigente al momento de guardar. Supone datos ya validados.
function construirCotizacion(datos, emisor) {
  const partidas = datos.partidas.map((p) => {
    const partida = {
      producto: texto(p.producto) || null,
      descripcion: texto(p.descripcion),
      cantidad: Number(p.cantidad),
      unidad: texto(p.unidad),
      precioUnitario: Number(p.precioUnitario),
      descuentoPct: descuentoDe(p)
    };
    return { ...partida, importe: calcularImportePartida(partida) };
  });
  const cliente = {};
  CAMPOS_CLIENTE.forEach(({ campo }) => { cliente[campo] = texto(datos.cliente[campo]); });
  return {
    cliente,
    clienteId: claveCliente(cliente.razonSocial),
    fecha: datos.fecha,
    vigenciaDias: Number(datos.vigenciaDias),
    condicionesPago: texto(datos.condicionesPago),
    condicionesEntrega: texto(datos.condicionesEntrega),
    notas: texto(datos.notas),
    partidas,
    totales: calcularTotales(partidas, datos.aplicaIva),
    emisor: normalizarEmisor(emisor)
  };
}

// Guarda una cotización en UNA transacción: alta = folio (tomarFolioEnTransaccion) + documento + cliente; edición de un
// Borrador = documento + cliente, SIN tocar folio ni estado. Si algo falla no se consume el folio ni queda nada a medias.
// Requiere red. Devuelve { id, folio, documento } con el documento tal como quedó.
async function guardarCotizacion(datos, id) {
  if (!window.puedeEscribir('cotizaciones')) throw new Error('No tienes permiso para guardar cotizaciones');
  const validacion = validarCotizacion(datos);
  if (!validacion.ok) throw Object.assign(new Error('Revisa los campos marcados'), { errores: validacion.errores });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('Sin conexión: la cotización solo se puede guardar con internet. No se guardó nada.');

  const emisor = await obtenerEmisor();
  const cotizacion = construirCotizacion(datos, emisor);
  const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema';
  const ahora = new Date().toISOString();
  const coleccion = window.db.collection(window.COLECCIONES.COTIZACIONES);
  const refCotizacion = id ? coleccion.doc(id) : coleccion.doc();
  const refCliente = window.db.collection(window.COLECCIONES.CLIENTES_COTIZACION).doc(cotizacion.clienteId);

  return window.db.runTransaction(async (tx) => {
    let documento;
    if (id) {
      const actual = await tx.get(refCotizacion);
      if (!actual.exists) throw new Error('La cotización ya no existe');
      if (actual.data().estado !== ESTADO_BORRADOR) throw new Error('Solo se puede editar una cotización en Borrador');
      documento = { ...actual.data(), ...cotizacion, actualizadoPor: usuario, actualizadoEn: ahora };
    } else {
      const folio = await tomarFolioEnTransaccion(tx, 'cotizacion');
      documento = { ...cotizacion, folio, estado: ESTADO_BORRADOR, creadoPor: usuario, fechaRegistro: ahora };
    }
    tx.set(refCotizacion, documento);
    tx.set(refCliente, { ...cotizacion.cliente, actualizadoEn: ahora }, { merge: true });
    return { id: refCotizacion.id, folio: documento.folio, documento };
  });
}

// ── Estados, transiciones y revisiones ──────────────────────────────────────────────────────────────────────────────────
// Definición cerrada: Borrador → Enviada → Aceptada | Rechazada | Cancelada; Aceptada → Cancelada. Rechazada, Cancelada y
// Reemplazada son finales. Reemplazada solo se alcanza al crear una revisión (y se deshace solo al eliminar esa revisión).
const ESTADO_ENVIADA = 'Enviada';
const ESTADO_ACEPTADA = 'Aceptada';
const ESTADO_RECHAZADA = 'Rechazada';
const ESTADO_CANCELADA = 'Cancelada';
const ESTADO_REEMPLAZADA = 'Reemplazada';
const ESTADOS = [ESTADO_BORRADOR, ESTADO_ENVIADA, ESTADO_ACEPTADA, ESTADO_RECHAZADA, ESTADO_CANCELADA, ESTADO_REEMPLAZADA];
const TRANSICIONES = {
  [ESTADO_BORRADOR]: [ESTADO_ENVIADA],
  [ESTADO_ENVIADA]: [ESTADO_ACEPTADA, ESTADO_RECHAZADA, ESTADO_CANCELADA],
  [ESTADO_ACEPTADA]: [ESTADO_CANCELADA],
  [ESTADO_RECHAZADA]: [],
  [ESTADO_CANCELADA]: [],
  [ESTADO_REEMPLAZADA]: []
};
const ESTADOS_CON_REVISION = [ESTADO_ENVIADA, ESTADO_RECHAZADA];
const ESTADOS_CON_CONFIRMACION = [ESTADO_RECHAZADA, ESTADO_CANCELADA];

const transicionValida = (de, a) => (TRANSICIONES[de] || []).includes(a);

// Las cotizaciones anteriores a las revisiones no traen revision ni folioBase: son la revisión 1 de su propio folio.
function revisionDe(cotizacion) {
  const numero = Number(cotizacion && cotizacion.revision);
  return Number.isInteger(numero) && numero >= 1 ? numero : 1;
}
const folioBaseDe = (cotizacion) => texto(cotizacion && cotizacion.folioBase) || texto(cotizacion && cotizacion.folio);
const folioDeRevision = (folioBase, revision) => `${folioBase}-R${revision}`;

const usuarioActual = () => (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema';
const sinConexion = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Entrada de historial_cambios dentro de la transacción (tx.set directo, no EVE_HISTORIAL.registrar): se confirma o se
// descarta junto con el cambio que describe.
function registrarEnTransaccion(tx, { registroId, accion, valorAnterior, valorNuevo, motivo, usuario }) {
  tx.set(window.db.collection('historial_cambios').doc(), {
    coleccion: 'cotizaciones', registroId, accion, valorAnterior, valorNuevo, motivo, usuario, timestamp: new Date().toISOString()
  });
}

// Copia del documento con el nuevo estado y la entrada {de, a, usuario, fecha} agregada a historialEstados.
function conEstado(datos, a, usuario, ahora, extra) {
  const historialEstados = [...(Array.isArray(datos.historialEstados) ? datos.historialEstados : []), { de: datos.estado, a, usuario, fecha: ahora }];
  return { ...datos, ...extra, estado: a, historialEstados, actualizadoPor: usuario, actualizadoEn: ahora };
}

const clonar = (valor) => JSON.parse(JSON.stringify(valor === undefined ? null : valor));

// Pasa una cotización de `esperado` a `nuevo` en UNA transacción con relectura fresca. Si el estado real ya no es `esperado`
// (otro usuario lo cambió) rechaza con `documentoActual` en el error para que la pantalla refresque su copia. Requiere red.
// Devuelve { id, folio, documento }.
async function cambiarEstado(id, esperado, nuevo) {
  if (!window.puedeEscribir('cotizaciones')) throw new Error('No tienes permiso para cambiar el estado de cotizaciones');
  if (!transicionValida(esperado, nuevo)) throw new Error(`Transición no permitida: ${esperado} → ${nuevo}`);
  if (sinConexion()) throw new Error('Sin conexión: el estado solo se puede cambiar con internet. No se cambió nada.');

  const usuario = usuarioActual();
  const ref = window.db.collection(window.COLECCIONES.COTIZACIONES).doc(id);
  return window.db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    if (!actual.exists) throw new Error('La cotización ya no existe');
    const datos = actual.data();
    if (datos.estado !== esperado) {
      throw Object.assign(new Error(`No se puede pasar ${datos.folio} a ${nuevo}: ya está en estado ${datos.estado}. Se actualizó la lista`), { documentoActual: { id, ...datos } });
    }
    const ahora = new Date().toISOString();
    const documento = conEstado(datos, nuevo, usuario, ahora);
    tx.set(ref, documento);
    registrarEnTransaccion(tx, {
      registroId: id,
      accion: 'cambio_estado',
      valorAnterior: { folio: datos.folio, estado: esperado },
      valorNuevo: { folio: datos.folio, estado: nuevo },
      motivo: `Cambio de estado de ${datos.folio}: ${esperado} → ${nuevo}`,
      usuario
    });
    return { id, folio: datos.folio, documento };
  });
}

// Crea la siguiente revisión (Borrador) de una cotización Enviada o Rechazada y deja la anterior en Reemplazada, en UNA
// transacción. El folio es folioBase-R<n> y NO toca contadores. Con relectura fresca solo puede existir una revisión viva:
// si la anterior ya está Reemplazada o ya tiene reemplazadaPor (otro usuario se adelantó) se rechaza. Requiere red.
// Devuelve { id, folio, documento, anterior } (el documento nuevo y la anterior ya actualizada, ambos con id).
async function crearRevision(id) {
  if (!window.puedeEscribir('cotizaciones')) throw new Error('No tienes permiso para crear revisiones de cotizaciones');
  if (sinConexion()) throw new Error('Sin conexión: la revisión solo se puede crear con internet. No se creó nada.');

  const usuario = usuarioActual();
  const coleccion = window.db.collection(window.COLECCIONES.COTIZACIONES);
  const refAnterior = coleccion.doc(id);
  const refNueva = coleccion.doc();
  return window.db.runTransaction(async (tx) => {
    const actual = await tx.get(refAnterior);
    if (!actual.exists) throw new Error('La cotización ya no existe');
    const datos = actual.data();
    if (datos.estado === ESTADO_REEMPLAZADA || datos.reemplazadaPor) {
      throw Object.assign(new Error(`${datos.folio} ya tiene una revisión (otro usuario la creó). Se actualizó la lista`), { documentoActual: { id, ...datos } });
    }
    if (!ESTADOS_CON_REVISION.includes(datos.estado)) {
      throw Object.assign(new Error(`Solo se puede crear revisión de una cotización Enviada o Rechazada: ${datos.folio} está ${datos.estado}. Se actualizó la lista`), { documentoActual: { id, ...datos } });
    }
    const ahora = new Date().toISOString();
    const folioBase = folioBaseDe(datos);
    const revision = revisionDe(datos) + 1;
    const folio = folioDeRevision(folioBase, revision);
    const nueva = {
      cliente: clonar(datos.cliente),
      clienteId: datos.clienteId,
      fecha: window.obtenerFechaMexico(),
      vigenciaDias: datos.vigenciaDias,
      condicionesPago: datos.condicionesPago || '',
      condicionesEntrega: datos.condicionesEntrega || '',
      notas: datos.notas || '',
      partidas: clonar(datos.partidas),
      totales: clonar(datos.totales),
      emisor: clonar(datos.emisor),
      folio,
      folioBase,
      revision,
      cotizacionOrigenId: id,
      estado: ESTADO_BORRADOR,
      creadoPor: usuario,
      fechaRegistro: ahora,
      historialEstados: [{ de: null, a: ESTADO_BORRADOR, usuario, fecha: ahora }]
    };
    const anterior = conEstado(datos, ESTADO_REEMPLAZADA, usuario, ahora, { folioBase, revision: revisionDe(datos), reemplazadaPor: refNueva.id, estadoAntesReemplazo: datos.estado });
    tx.set(refNueva, nueva);
    tx.set(refAnterior, anterior);
    registrarEnTransaccion(tx, {
      registroId: id,
      accion: 'cambio_estado',
      valorAnterior: { folio: datos.folio, estado: datos.estado },
      valorNuevo: { folio: datos.folio, estado: ESTADO_REEMPLAZADA },
      motivo: `${datos.folio} reemplazada por la revisión ${folio}`,
      usuario
    });
    registrarEnTransaccion(tx, {
      registroId: refNueva.id,
      accion: 'revision',
      valorAnterior: { folio: datos.folio },
      valorNuevo: { folio, revision, estado: ESTADO_BORRADOR },
      motivo: `Revisión ${folio} creada a partir de ${datos.folio}`,
      usuario
    });
    return { id: refNueva.id, folio, documento: nueva, anterior: { id, ...anterior } };
  });
}

// Elimina una cotización en Borrador en UNA transacción: relee el documento del servidor (otro usuario pudo cambiarle el
// estado), lo borra y registra la eliminación en historial_cambios; si algo falla no queda uno sin el otro. NO toca el
// contador (el folio no se reutiliza) ni clientes_cotizacion. Si es una revisión (R2 o mayor), en la misma transacción la
// cotización anterior vuelve al estado que tenía antes de ser reemplazada (estadoAntesReemplazo) y se limpia su
// reemplazadaPor. Requiere red. Si el estado ya no es Borrador, el error lleva `documentoActual` para que la pantalla
// refresque su copia. Devuelve { id, folio, cliente, total, restaurada } (restaurada: la anterior ya actualizada, o null).
async function eliminarCotizacion(id) {
  if (!window.puedeEscribir('cotizaciones')) throw new Error('No tienes permiso para eliminar cotizaciones');
  if (!id) throw new Error('Falta la cotización a eliminar');
  if (sinConexion()) throw new Error('Sin conexión: la cotización solo se puede eliminar con internet. No se eliminó nada.');

  const usuario = usuarioActual();
  const coleccion = window.db.collection(window.COLECCIONES.COTIZACIONES);
  const ref = coleccion.doc(id);
  return window.db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    if (!actual.exists) throw new Error('La cotización ya no existe');
    const datos = actual.data();
    if (datos.estado !== ESTADO_BORRADOR) {
      throw Object.assign(new Error(`No se puede eliminar ${datos.folio}: ya está en estado ${datos.estado} (solo se elimina un Borrador)`), { documentoActual: { id, ...datos } });
    }
    // Todas las lecturas antes de cualquier escritura.
    const refOrigen = revisionDe(datos) >= 2 && datos.cotizacionOrigenId ? coleccion.doc(datos.cotizacionOrigenId) : null;
    const origen = refOrigen ? await tx.get(refOrigen) : null;

    const cliente = (datos.cliente && datos.cliente.razonSocial) || '';
    const total = datos.totales ? datos.totales.total : null;
    tx.delete(ref);
    registrarEnTransaccion(tx, {
      registroId: id,
      accion: 'eliminacion',
      valorAnterior: { folio: datos.folio, cliente, total, estado: datos.estado },
      valorNuevo: null,
      motivo: `Eliminación de la cotización ${datos.folio}`,
      usuario
    });

    let restaurada = null;
    const previa = origen && origen.exists ? origen.data() : null;
    if (previa && previa.estado === ESTADO_REEMPLAZADA && previa.reemplazadaPor === id) {
      const { reemplazadaPor, estadoAntesReemplazo, ...resto } = previa;
      const destino = ESTADOS_CON_REVISION.includes(estadoAntesReemplazo) ? estadoAntesReemplazo : ESTADO_ENVIADA;
      const documento = conEstado(resto, destino, usuario, new Date().toISOString());
      tx.set(refOrigen, documento);
      registrarEnTransaccion(tx, {
        registroId: refOrigen.id,
        accion: 'cambio_estado',
        valorAnterior: { folio: previa.folio, estado: ESTADO_REEMPLAZADA },
        valorNuevo: { folio: previa.folio, estado: destino },
        motivo: `Se eliminó la revisión ${datos.folio}: ${previa.folio} vuelve a ${destino}`,
        usuario
      });
      restaurada = { id: refOrigen.id, ...documento };
    }
    return { id, folio: datos.folio, cliente, total, restaurada };
  });
}

// ── Lista de seguimiento: filtros y totales por estado ──────────────────────────────────────────────────────────────────
const normalizarBusqueda = (valor) => texto(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// filtros: { cliente (texto sin distinguir mayúsculas ni acentos), estado ('' = todos), desde / hasta (YYYY-MM-DD, '' =
// abierto), verReemplazadas }. Las Reemplazadas se ocultan salvo que se active el interruptor o se pida ese estado.
function filtrarCotizaciones(lista, filtros) {
  const f = filtros || {};
  const buscado = normalizarBusqueda(f.cliente);
  const desde = texto(f.desde);
  const hasta = texto(f.hasta);
  return (lista || []).filter((c) => {
    if (f.estado) {
      if (c.estado !== f.estado) return false;
    } else if (c.estado === ESTADO_REEMPLAZADA && !f.verReemplazadas) {
      return false;
    }
    if (buscado && !normalizarBusqueda(c.cliente && c.cliente.razonSocial).includes(buscado)) return false;
    if (desde || hasta) {
      const fecha = texto(c.fecha);
      if (!fecha) return false;
      if (desde && fecha < desde) return false;
      if (hasta && fecha > hasta) return false;
    }
    return true;
  });
}

// Cantidad e importe total por estado, en el orden de ESTADOS. Se calcula sobre la lista ya filtrada.
function totalesPorEstado(lista) {
  return ESTADOS.map((estado) => {
    const delEstado = (lista || []).filter((c) => c.estado === estado);
    return { estado, cantidad: delEstado.length, total: redondear2(delEstado.reduce((suma, c) => suma + (Number(c.totales && c.totales.total) || 0), 0)) };
  });
}

// Por cada folio base: cuántas cotizaciones tiene (revisiones incluidas) y cuál es la vigente (la más reciente que no está
// Reemplazada). Se calcula sobre TODAS las cotizaciones, no sobre las filtradas.
function infoRevisiones(lista) {
  const cadenas = new Map();
  (lista || []).forEach((c) => {
    const base = folioBaseDe(c);
    const cadena = cadenas.get(base) || { cantidad: 0, vigenteId: null, vigenteRevision: 0 };
    cadena.cantidad++;
    if (c.estado !== ESTADO_REEMPLAZADA && revisionDe(c) >= cadena.vigenteRevision) {
      cadena.vigenteId = c.id;
      cadena.vigenteRevision = revisionDe(c);
    }
    cadenas.set(base, cadena);
  });
  return cadenas;
}

window.EVE_COTIZACIONES = {
  EMISOR_DEFAULT,
  PREFIJOS_FOLIO,
  normalizarEmisor,
  validarEmisor,
  construirPayloadEmisor,
  obtenerEmisor,
  guardarEmisor,
  formatearFolio,
  tomarFolioEnTransaccion,
  generarFolio,
  IVA_TASA,
  UNIDADES_COTIZACION,
  ESTADO_BORRADOR,
  redondear2,
  calcularImportePartida,
  calcularTotales,
  fechaIsoValida,
  claveCliente,
  validarCotizacion,
  construirCotizacion,
  guardarCotizacion,
  ESTADOS,
  TRANSICIONES,
  transicionValida,
  revisionDe,
  folioBaseDe,
  cambiarEstado,
  crearRevision,
  eliminarCotizacion,
  filtrarCotizaciones,
  totalesPorEstado,
  infoRevisiones
};

// ── Pantalla: captura y lista de cotizaciones ───────────────────────────────────────────────────────────────────────────
const PRODUCTO_LIBRE = '__LIBRE__';

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

function opcionesUnidad() {
  return UNIDADES_COTIZACION.map((u) => ({ valor: u, texto: u }));
}

function unidadDeCatalogo(producto) {
  const entrada = window.EVE_CATALOGO && window.EVE_CATALOGO.buscar(producto);
  return entrada && UNIDADES_COTIZACION.includes(entrada.unidad) ? entrada.unidad : 'KG';
}

function crearFilaPartida(partida, soloLectura) {
  const valores = partida || { producto: '', descripcion: '', cantidad: '', unidad: 'KG', precioUnitario: '', descuentoPct: 0 };
  const esLibre = !texto(valores.producto) && !!texto(valores.descripcion);
  const fila = document.createElement('tr');
  fila.className = 'cot-partida';

  const celdaProducto = document.createElement('td');
  const productos = window.productosVenta();
  const select = crearSelect([
    { valor: '', texto: 'Elegir producto…' },
    ...productos.map((p) => ({ valor: p, texto: p })),
    { valor: PRODUCTO_LIBRE, texto: 'Descripción libre' }
  ], '');
  if (texto(valores.producto) && !productos.includes(valores.producto)) {
    const extra = document.createElement('option');
    extra.value = valores.producto;
    extra.textContent = valores.producto;
    select.appendChild(extra);
  }
  select.value = esLibre ? PRODUCTO_LIBRE : texto(valores.producto);
  select.dataset.f = 'producto';
  const descripcion = crearInput('text', { placeholder: 'Descripción', maxlength: '200' });
  descripcion.dataset.f = 'descripcion';
  descripcion.value = valores.descripcion || '';
  descripcion.style.display = esLibre ? '' : 'none';
  const errorProducto = crearElemento('small', 'cot-error');
  errorProducto.dataset.e = 'producto';
  celdaProducto.append(select, descripcion, errorProducto);
  fila.appendChild(celdaProducto);

  const campos = [
    ['cantidad', crearInput('number', { min: '0', step: 'any', inputmode: 'decimal' }), valores.cantidad],
    ['unidad', crearSelect(opcionesUnidad(), UNIDADES_COTIZACION.includes(valores.unidad) ? valores.unidad : 'KG'), null],
    ['precioUnitario', crearInput('number', { min: '0', step: 'any', inputmode: 'decimal' }), valores.precioUnitario],
    ['descuentoPct', crearInput('number', { min: '0', max: '100', step: 'any', inputmode: 'decimal' }), valores.descuentoPct]
  ];
  campos.forEach(([nombre, control, valor]) => {
    const celda = document.createElement('td');
    control.dataset.f = nombre;
    if (valor !== null && valor !== undefined) control.value = valor;
    const error = crearElemento('small', 'cot-error');
    error.dataset.e = nombre;
    celda.append(control, error);
    fila.appendChild(celda);
  });

  const celdaImporte = document.createElement('td');
  celdaImporte.className = 'cot-importe mono';
  fila.appendChild(celdaImporte);
  const celdaQuitar = document.createElement('td');
  const quitar = crearElemento('button', 'btn-secondary cot-quitar', '✕');
  quitar.type = 'button';
  quitar.title = 'Quitar partida';
  quitar.setAttribute('aria-label', 'Quitar partida');
  celdaQuitar.appendChild(quitar);
  fila.appendChild(celdaQuitar);

  select.addEventListener('change', () => {
    const libre = select.value === PRODUCTO_LIBRE;
    descripcion.style.display = libre ? '' : 'none';
    if (!libre) descripcion.value = '';
    if (select.value && !libre) fila.querySelector('[data-f="unidad"]').value = unidadDeCatalogo(select.value);
  });

  if (soloLectura) {
    fila.querySelectorAll('input, select').forEach((control) => { control.disabled = true; });
    quitar.style.display = 'none';
  }
  return fila;
}

function leerFila(fila) {
  const valor = (nombre) => fila.querySelector(`[data-f="${nombre}"]`).value;
  const producto = valor('producto');
  const libre = producto === PRODUCTO_LIBRE;
  return {
    producto: libre ? '' : producto,
    descripcion: libre ? valor('descripcion') : '',
    cantidad: valor('cantidad'),
    unidad: valor('unidad'),
    precioUnitario: valor('precioUnitario'),
    descuentoPct: valor('descuentoPct')
  };
}

// fecha: se captura como dd/mm/aaaa y se guarda como YYYY-MM-DD ('' si no tiene ese formato).
function fechaDesdeTexto(textoFecha) {
  return /^\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}\s*$/.test(textoFecha || '') ? (window.parsearFecha(textoFecha) || '') : '';
}

function leerFormulario(form) {
  const valor = (clave) => form.querySelector(`[data-campo="${clave}"]`).value;
  return {
    cliente: { razonSocial: valor('cliente.razonSocial'), contacto: valor('cliente.contacto'), telefono: valor('cliente.telefono'), direccion: valor('cliente.direccion') },
    fecha: fechaDesdeTexto(valor('fecha')),
    vigenciaDias: valor('vigenciaDias'),
    condicionesPago: valor('condicionesPago'),
    condicionesEntrega: valor('condicionesEntrega'),
    notas: valor('notas'),
    aplicaIva: form.querySelector('[data-campo="aplicaIva"]').checked,
    partidas: Array.from(form.querySelectorAll('.cot-partida')).map(leerFila)
  };
}

function recalcular(form) {
  const filas = Array.from(form.querySelectorAll('.cot-partida'));
  const partidas = filas.map(leerFila);
  filas.forEach((fila, i) => { fila.querySelector('.cot-importe').textContent = window.formatearMoneda(calcularImportePartida(partidas[i])); });
  const totales = calcularTotales(partidas, form.querySelector('[data-campo="aplicaIva"]').checked);
  form.querySelector('[data-total="subtotal"]').textContent = window.formatearMoneda(totales.subtotal);
  form.querySelector('[data-total="iva"]').textContent = window.formatearMoneda(totales.iva);
  form.querySelector('[data-total="total"]').textContent = window.formatearMoneda(totales.total);
  form.querySelectorAll('.cot-quitar').forEach((boton) => { boton.disabled = filas.length <= 1; });
}

function marcar(control, nodoError, mensaje) {
  if (control) control.classList.toggle('campo-invalido', !!mensaje);
  if (nodoError) nodoError.textContent = mensaje || '';
}

// Limpia y vuelve a pintar el marcado visual y el mensaje de cada campo según { clave: mensaje }.
function marcarErrores(form, errores) {
  form.querySelectorAll('[data-campo]').forEach((control) => marcar(control, form.querySelector(`[data-error="${control.dataset.campo}"]`), errores[control.dataset.campo]));
  marcar(null, form.querySelector('[data-error="partidas"]'), errores.partidas);
  form.querySelectorAll('.cot-partida').forEach((fila, i) => {
    ['producto', 'cantidad', 'unidad', 'precioUnitario', 'descuentoPct'].forEach((nombre) => {
      marcar(fila.querySelector(`[data-f="${nombre}"]`), fila.querySelector(`[data-e="${nombre}"]`), errores[`partidas.${i}.${nombre}`]);
    });
  });
  const primero = form.querySelector('.campo-invalido');
  if (primero && typeof primero.focus === 'function') primero.focus();
}

function actualizarMemoria(resultado) {
  const documento = { id: resultado.id, ...resultado.documento };
  const cotizaciones = window.EVE.cotizaciones;
  const indice = cotizaciones.findIndex((c) => c.id === resultado.id);
  if (indice === -1) cotizaciones.push(documento); else cotizaciones[indice] = documento;
  const clientes = window.EVE.clientesCotizacion;
  const cliente = { ...documento.cliente, id: documento.clienteId };
  const posicion = clientes.findIndex((c) => c.id === cliente.id);
  if (posicion === -1) clientes.push(cliente); else clientes[posicion] = { ...clientes[posicion], ...cliente };
}

const puedeEliminar = (cotizacion) => window.puedeEscribir('cotizaciones') && cotizacion.estado === ESTADO_BORRADOR;

// Reemplaza (o agrega) un documento en la copia en memoria que usa la lista.
function refrescarEnMemoria(documento) {
  const cotizaciones = window.EVE.cotizaciones;
  const indice = cotizaciones.findIndex((c) => c.id === documento.id);
  if (indice === -1) cotizaciones.push(documento); else cotizaciones[indice] = documento;
}

const razonSocialDe = (cotizacion) => (cotizacion.cliente && cotizacion.cliente.razonSocial) || '';

// Descarga el PDF de la cotización guardada (cualquier estado, también en solo lectura). Relee el documento para que el
// estado y los datos del PDF sean los reales; si no se puede leer (sin red ni caché) usa la copia en pantalla. Solo lee.
async function exportarPDF(cotizacion, boton) {
  boton.disabled = true;
  try {
    if (!window.EVE_COTIZACIONES_PDF) throw new Error('El módulo de PDF no está cargado');
    let fresca = cotizacion;
    try {
      const documento = await window.db.collection(window.COLECCIONES.COTIZACIONES).doc(cotizacion.id).get();
      if (documento.exists) fresca = { id: cotizacion.id, ...documento.data() };
    } catch (errorLectura) { /* sin red ni caché: se usa la copia en pantalla */ }
    const nombre = await window.EVE_COTIZACIONES_PDF.generarPDF(fresca);
    if (nombre) window.showSuccess(`PDF ${nombre} generado`);
  } catch (error) {
    window.showError(`No se pudo generar el PDF: ${error.message}`);
  } finally {
    boton.disabled = false;
  }
}

// Ejecuta un cambio de estado o una revisión desde la lista: avisa, actualiza la copia en memoria (también cuando el servidor
// rechaza porque el documento ya cambió) y devuelve true si la lista hay que volver a pintarla.
async function ejecutarAccionEstado(boton, ejecutar, mensajeExito) {
  boton.disabled = true;
  try {
    const resultado = await ejecutar();
    refrescarEnMemoria({ id: resultado.id, ...resultado.documento });
    if (resultado.anterior) refrescarEnMemoria(resultado.anterior);
    window.showSuccess(mensajeExito(resultado));
    return true;
  } catch (error) {
    window.showError(error.message);
    boton.disabled = false;
    if (!error.documentoActual) return false;
    refrescarEnMemoria(error.documentoActual);
    return true;
  }
}

const ETIQUETA_TRANSICION = { [ESTADO_ENVIADA]: 'Marcar Enviada', [ESTADO_ACEPTADA]: 'Aceptar', [ESTADO_RECHAZADA]: 'Rechazar', [ESTADO_CANCELADA]: 'Cancelar cotización' };

async function pedirCambioEstado(cotizacion, nuevo, boton) {
  if (ESTADOS_CON_CONFIRMACION.includes(nuevo) && !window.confirm(`¿Marcar ${cotizacion.folio} de ${razonSocialDe(cotizacion)} como ${nuevo}?\n\n${nuevo} es un estado final: la cotización ya no podrá cambiar.`)) return false;
  return ejecutarAccionEstado(boton, () => cambiarEstado(cotizacion.id, cotizacion.estado, nuevo), (r) => `Cotización ${r.folio}: ${nuevo}`);
}

async function pedirRevision(cotizacion, boton) {
  const folioNuevo = folioDeRevision(folioBaseDe(cotizacion), revisionDe(cotizacion) + 1);
  if (!window.confirm(`¿Crear la revisión ${folioNuevo}?\n\n${cotizacion.folio} pasará a Reemplazada y la revisión quedará en Borrador.`)) return false;
  return ejecutarAccionEstado(boton, () => crearRevision(cotizacion.id), (r) => `Revisión ${r.folio} creada en Borrador`);
}

// Pide confirmación (folio + Razón Social) y elimina. Devuelve 'eliminada', 'actualizada' (el estado cambió en otro lado:
// se refrescó la copia en memoria y no se borró nada) o null (cancelada o con error; el error ya se mostró).
async function eliminarConConfirmacion(cotizacion, boton) {
  const razon = (cotizacion.cliente && cotizacion.cliente.razonSocial) || '';
  if (!window.confirm(`¿Eliminar ${cotizacion.folio} de ${razon}?\n\nEsta acción no se puede deshacer. El folio no se vuelve a usar.`)) return null;
  boton.disabled = true;
  try {
    const resultado = await eliminarCotizacion(cotizacion.id);
    const cotizaciones = window.EVE.cotizaciones;
    const indice = cotizaciones.findIndex((c) => c.id === resultado.id);
    if (indice !== -1) cotizaciones.splice(indice, 1);
    if (resultado.restaurada) refrescarEnMemoria(resultado.restaurada);
    window.showSuccess(resultado.restaurada
      ? `Cotización ${resultado.folio} eliminada: ${resultado.restaurada.folio} vuelve a ${resultado.restaurada.estado}`
      : `Cotización ${resultado.folio} eliminada`);
    return 'eliminada';
  } catch (error) {
    window.showError(error.message);
    boton.disabled = false;
    if (!error.documentoActual) return null;
    const cotizaciones = window.EVE.cotizaciones;
    const indice = cotizaciones.findIndex((c) => c.id === error.documentoActual.id);
    if (indice !== -1) cotizaciones[indice] = error.documentoActual;
    return 'actualizada';
  }
}

function crearFormulario({ cotizacion, soloLectura, alTerminar }) {
  const editando = !!cotizacion;
  const form = crearElemento('form', 'cot-form card');
  form.noValidate = true;
  const titulo = !editando ? 'Nueva cotización' : `${soloLectura ? 'Cotización' : 'Editar'} ${cotizacion.folio}`;
  form.appendChild(crearElemento('h3', 'cot-titulo', titulo));
  if (editando) form.querySelector('.cot-titulo').classList.add('mono');

  // Cliente: la Razón Social ofrece los clientes ya capturados y, al elegir uno, rellena los otros tres campos.
  const lista = document.createElement('datalist');
  lista.id = 'cot-clientes-lista';
  (window.EVE.clientesCotizacion || []).forEach((c) => {
    const opcion = document.createElement('option');
    opcion.value = c.razonSocial || '';
    lista.appendChild(opcion);
  });
  form.appendChild(lista);
  const cliente = (cotizacion && cotizacion.cliente) || {};
  const gridCliente = crearElemento('div', 'cot-grid');
  const razon = crearInput('text', { maxlength: '150', list: lista.id, autocomplete: 'off' });
  const contacto = crearInput('text', { maxlength: '100' });
  const telefono = crearInput('tel', { maxlength: '30' });
  const direccion = crearInput('text', { maxlength: '250' });
  razon.value = cliente.razonSocial || '';
  contacto.value = cliente.contacto || '';
  telefono.value = cliente.telefono || '';
  direccion.value = cliente.direccion || '';
  gridCliente.append(
    crearCampo('Razón Social *', razon, 'cliente.razonSocial'),
    crearCampo('Contacto *', contacto, 'cliente.contacto'),
    crearCampo('Teléfono *', telefono, 'cliente.telefono'),
    crearCampo('Dirección *', direccion, 'cliente.direccion')
  );
  form.appendChild(gridCliente);
  razon.addEventListener('change', () => {
    const clave = claveCliente(razon.value);
    const existente = clave && (window.EVE.clientesCotizacion || []).find((c) => c.id === clave || claveCliente(c.razonSocial) === clave);
    if (!existente) return;
    contacto.value = existente.contacto || '';
    telefono.value = existente.telefono || '';
    direccion.value = existente.direccion || '';
  });

  // Fecha, vigencia y condiciones (los defaults salen de config/emisor vía obtenerEmisor()).
  const gridDatos = crearElemento('div', 'cot-grid');
  const fecha = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  fecha.value = window.formatearFecha(cotizacion ? cotizacion.fecha : window.obtenerFechaMexico());
  const vigencia = crearInput('number', { min: '1', max: String(VIGENCIA_DIAS_MAX), step: '1' });
  vigencia.value = cotizacion ? cotizacion.vigenciaDias : '';
  const pago = crearInput('text', { maxlength: '250' });
  const entrega = crearInput('text', { maxlength: '250' });
  pago.value = cotizacion ? cotizacion.condicionesPago || '' : '';
  entrega.value = cotizacion ? cotizacion.condicionesEntrega || '' : '';
  gridDatos.append(
    crearCampo('Fecha *', fecha, 'fecha'),
    crearCampo('Vigencia (días) *', vigencia, 'vigenciaDias'),
    crearCampo('Condiciones de pago', pago, 'condicionesPago'),
    crearCampo('Condiciones de entrega', entrega, 'condicionesEntrega')
  );
  form.appendChild(gridDatos);
  if (!editando) {
    obtenerEmisor().catch(() => normalizarEmisor({})).then((emisor) => {
      if (!vigencia.value) vigencia.value = emisor.vigenciaDias;
      if (!pago.value) pago.value = emisor.condicionesPagoDefault;
      if (!entrega.value) entrega.value = emisor.condicionesEntregaDefault;
    });
  }

  // Partidas
  form.appendChild(crearElemento('h4', 'cot-subtitulo', 'Partidas'));
  const envoltura = crearElemento('div', 'destaraje-tabla-wrapper');
  const tabla = crearElemento('table', 'tabla-destaraje cot-tabla');
  tabla.innerHTML = '<thead><tr><th>Producto</th><th>Cantidad</th><th>Unidad</th><th>Precio unit.</th><th>Desc. %</th><th>Importe</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  form.appendChild(envoltura);
  const errorPartidas = crearElemento('small', 'cot-error');
  errorPartidas.dataset.error = 'partidas';
  form.appendChild(errorPartidas);
  (cotizacion ? cotizacion.partidas : [null]).forEach((p) => cuerpo.appendChild(crearFilaPartida(p, soloLectura)));
  const agregar = crearElemento('button', 'btn-secondary', '+ Agregar partida');
  agregar.type = 'button';
  agregar.style.display = soloLectura ? 'none' : '';
  agregar.addEventListener('click', () => { cuerpo.appendChild(crearFilaPartida(null, false)); recalcular(form); });
  form.appendChild(agregar);
  cuerpo.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.cot-quitar');
    if (!boton || cuerpo.children.length <= 1) return;
    boton.closest('tr').remove();
    recalcular(form);
  });
  form.addEventListener('input', () => recalcular(form));
  form.addEventListener('change', () => recalcular(form));

  // Totales en vivo
  const iva = crearInput('checkbox');
  iva.checked = cotizacion ? !!cotizacion.totales.aplicaIva : false;
  iva.dataset.campo = 'aplicaIva';
  const etiquetaIva = crearElemento('label', 'cot-iva');
  etiquetaIva.append(iva, document.createTextNode(' Aplicar IVA 16%'));
  const totales = crearElemento('div', 'cot-totales');
  [['subtotal', 'Subtotal'], ['iva', 'IVA 16%'], ['total', 'Total']].forEach(([clave, rotulo]) => {
    const linea = crearElemento('div', `cot-total-linea cot-total-${clave}`);
    linea.appendChild(crearElemento('span', '', rotulo));
    const monto = crearElemento('span', 'mono');
    monto.dataset.total = clave;
    linea.appendChild(monto);
    totales.appendChild(linea);
  });
  form.append(etiquetaIva, totales);

  const notas = document.createElement('textarea');
  notas.rows = 3;
  notas.maxLength = 1000;
  notas.value = cotizacion ? cotizacion.notas || '' : '';
  form.appendChild(crearCampo('Notas', notas, 'notas'));

  const acciones = crearElemento('div', 'cot-acciones');
  if (!soloLectura) {
    const guardar = crearElemento('button', 'btn-primary', editando ? 'Guardar cambios' : 'Guardar Borrador');
    guardar.type = 'submit';
    acciones.appendChild(guardar);
  }
  const cancelar = crearElemento('button', 'btn-secondary', soloLectura ? 'Cerrar' : 'Cancelar');
  cancelar.type = 'button';
  cancelar.addEventListener('click', () => alTerminar(false));
  acciones.appendChild(cancelar);
  if (editando) {
    const pdf = crearElemento('button', 'btn-secondary cot-pdf', 'PDF');
    pdf.type = 'button';
    pdf.title = 'Descargar la cotización guardada en PDF';
    pdf.addEventListener('click', () => exportarPDF(cotizacion, pdf));
    acciones.appendChild(pdf);
  }
  if (editando && !soloLectura && puedeEliminar(cotizacion)) {
    const eliminar = crearElemento('button', 'btn-danger cot-eliminar', 'Eliminar');
    eliminar.type = 'button';
    eliminar.addEventListener('click', async () => {
      const resultado = await eliminarConConfirmacion(cotizacion, eliminar);
      if (resultado) alTerminar(true);
    });
    acciones.appendChild(eliminar);
  }
  form.appendChild(acciones);

  if (soloLectura) {
    form.querySelectorAll('input, textarea').forEach((control) => { control.disabled = true; });
  }
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (soloLectura) return;
    const datos = leerFormulario(form);
    const validacion = validarCotizacion(datos);
    marcarErrores(form, validacion.errores);
    if (!validacion.ok) {
      window.showError('Revisa los campos marcados');
      return;
    }
    const botonGuardar = form.querySelector('button[type="submit"]');
    botonGuardar.disabled = true;
    try {
      const resultado = await guardarCotizacion(datos, editando ? cotizacion.id : undefined);
      actualizarMemoria(resultado);
      if (window.EVE_HISTORIAL && typeof window.EVE_HISTORIAL.registrar === 'function') {
        await window.EVE_HISTORIAL.registrar({
          coleccion: 'cotizaciones',
          registroId: resultado.id,
          accion: editando ? 'edicion' : 'alta',
          valorAnterior: editando ? { folio: cotizacion.folio, total: cotizacion.totales.total } : null,
          valorNuevo: { folio: resultado.folio, total: resultado.documento.totales.total },
          motivo: editando ? `Edición de la cotización ${resultado.folio}` : `Alta de la cotización ${resultado.folio}`
        });
      }
      window.showSuccess(`Cotización ${resultado.folio} guardada`);
      alTerminar(true);
    } catch (error) {
      if (error.errores) marcarErrores(form, error.errores);
      window.showError(error.message);
      botonGuardar.disabled = false;
    }
  });

  recalcular(form);
  return form;
}

const CLASE_ESTADO = { Borrador: 'borrador', Enviada: 'enviada', Aceptada: 'aceptada', Rechazada: 'rechazada', Cancelada: 'cancelada', Reemplazada: 'reemplazada' };

// Etiqueta de color por estado (los colores salen de las variables --estado-* de :root).
function crearEtiquetaEstado(estado) {
  const clase = CLASE_ESTADO[estado];
  return crearElemento('span', `cot-estado${clase ? ` cot-estado-${clase}` : ''}`, texto(estado));
}

// Celda del folio: el folio y, si la cotización tiene revisiones, su número (R1, R2…) y cuál es la vigente.
function crearCeldaFolio(cotizacion, cadena) {
  const celda = crearElemento('td', 'mono', texto(cotizacion.folio));
  if (cadena && cadena.cantidad > 1) {
    celda.appendChild(crearElemento('span', 'cot-rev', `R${revisionDe(cotizacion)}`));
    if (cadena.vigenteId === cotizacion.id) celda.appendChild(crearElemento('span', 'cot-vigente', 'Vigente'));
  }
  return celda;
}

// Botones de la fila. `acciones`: { abrir, eliminar, cambiarEstado, crearRevision }; los de escritura solo para quien puede.
function crearCeldaAcciones(cotizacion, acciones) {
  const celda = document.createElement('td');
  const caja = crearElemento('div', 'cot-acciones-fila');
  const editable = window.puedeEscribir('cotizaciones') && cotizacion.estado === ESTADO_BORRADOR;
  const abrir = crearElemento('button', 'btn-secondary', editable ? 'Editar' : 'Ver');
  abrir.type = 'button';
  abrir.addEventListener('click', () => acciones.abrir(cotizacion, !editable));
  caja.appendChild(abrir);
  const pdf = crearElemento('button', 'btn-secondary cot-pdf', 'PDF');
  pdf.type = 'button';
  pdf.title = 'Descargar la cotización en PDF';
  pdf.addEventListener('click', () => exportarPDF(cotizacion, pdf));
  caja.appendChild(pdf);
  if (window.puedeEscribir('cotizaciones')) {
    (TRANSICIONES[cotizacion.estado] || []).forEach((nuevo) => {
      const boton = crearElemento('button', 'btn-secondary cot-transicion', ETIQUETA_TRANSICION[nuevo]);
      boton.type = 'button';
      boton.dataset.nuevoEstado = nuevo;
      boton.addEventListener('click', () => acciones.cambiarEstado(cotizacion, nuevo, boton));
      caja.appendChild(boton);
    });
    if (ESTADOS_CON_REVISION.includes(cotizacion.estado)) {
      const revision = crearElemento('button', 'btn-secondary cot-revision', 'Crear revisión');
      revision.type = 'button';
      revision.addEventListener('click', () => acciones.crearRevision(cotizacion, revision));
      caja.appendChild(revision);
    }
    const eliminar = crearElemento('button', 'btn-danger cot-eliminar', 'Eliminar');
    eliminar.type = 'button';
    caja.appendChild(eliminar);
    if (puedeEliminar(cotizacion)) {
      eliminar.addEventListener('click', () => acciones.eliminar(cotizacion, eliminar));
    } else {
      eliminar.disabled = true;
      eliminar.title = 'Solo se puede eliminar un Borrador';
      caja.appendChild(crearElemento('small', 'cot-nota', 'Solo Borrador'));
    }
  }
  celda.appendChild(caja);
  return celda;
}

function crearTablaCotizaciones(lista, acciones) {
  const envoltura = crearElemento('div', 'destaraje-tabla-wrapper');
  const tabla = crearElemento('table', 'tabla-destaraje');
  tabla.innerHTML = '<thead><tr><th>Folio</th><th>Cliente</th><th>Fecha</th><th>Total</th><th>Estado</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  const cadenas = infoRevisiones(window.EVE.cotizaciones || []);
  const ordenadas = lista.slice().sort((a, b) => folioBaseDe(b).localeCompare(folioBaseDe(a)) || revisionDe(b) - revisionDe(a));
  if (ordenadas.length === 0) {
    const fila = document.createElement('tr');
    const celda = crearElemento('td', '', 'Sin cotizaciones');
    celda.colSpan = 6;
    fila.appendChild(celda);
    cuerpo.appendChild(fila);
  }
  ordenadas.forEach((c) => {
    const fila = document.createElement('tr');
    fila.dataset.id = c.id;
    fila.appendChild(crearCeldaFolio(c, cadenas.get(folioBaseDe(c))));
    fila.appendChild(crearElemento('td', '', texto(c.cliente && c.cliente.razonSocial)));
    fila.appendChild(crearElemento('td', 'mono', texto(window.formatearFecha(c.fecha))));
    fila.appendChild(crearElemento('td', 'mono', texto(window.formatearMoneda(c.totales && c.totales.total))));
    const celdaEstado = document.createElement('td');
    celdaEstado.appendChild(crearEtiquetaEstado(c.estado));
    fila.appendChild(celdaEstado);
    fila.appendChild(crearCeldaAcciones(c, acciones));
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  return envoltura;
}

// Totales por estado (cantidad e importe) de lo que muestra la lista con los filtros aplicados.
function crearResumenEstados(lista) {
  const resumen = crearElemento('div', 'cot-resumen');
  const conDatos = totalesPorEstado(lista).filter((t) => t.cantidad > 0);
  if (conDatos.length === 0) {
    resumen.appendChild(crearElemento('span', 'cot-nota', 'Sin cotizaciones con estos filtros'));
    return resumen;
  }
  conDatos.forEach((t) => {
    const item = crearElemento('div', 'cot-resumen-item');
    item.dataset.estado = t.estado;
    item.appendChild(crearEtiquetaEstado(t.estado));
    item.appendChild(crearElemento('span', 'cot-resumen-cantidad mono', `${t.cantidad} · ${window.formatearMoneda(t.total)}`));
    resumen.appendChild(item);
  });
  return resumen;
}

// Controles de filtro: cliente, estado, Desde/Hasta (dd/mm/aaaa, vacío = abierto) y el interruptor de reemplazadas.
// Escribe en `filtros` (fechas ya en YYYY-MM-DD) y llama a `alCambiar` en cada cambio.
function crearFiltros(filtros, alCambiar) {
  const caja = crearElemento('div', 'card cot-filtros');
  const grid = crearElemento('div', 'cot-grid');
  const cliente = crearInput('text', { maxlength: '150', placeholder: 'Buscar cliente', autocomplete: 'off' });
  const estado = crearSelect([{ valor: '', texto: 'Todos' }, ...ESTADOS.map((e) => ({ valor: e, texto: e }))], '');
  const desde = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  const hasta = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  grid.append(
    crearCampo('Cliente', cliente, 'filtro.cliente'),
    crearCampo('Estado', estado, 'filtro.estado'),
    crearCampo('Desde', desde, 'filtro.desde'),
    crearCampo('Hasta', hasta, 'filtro.hasta')
  );
  const interruptor = crearInput('checkbox');
  interruptor.dataset.campo = 'filtro.verReemplazadas';
  const etiqueta = crearElemento('label', 'cot-iva');
  etiqueta.append(interruptor, document.createTextNode(' Ver reemplazadas'));
  caja.append(grid, etiqueta);

  // Fecha vacía = sin límite; con texto debe ser dd/mm/aaaa válida (si no, se marca y ese límite no se aplica).
  const leerFecha = (control, clave) => {
    const textoFecha = control.value.trim();
    const iso = textoFecha ? fechaDesdeTexto(textoFecha) : '';
    marcar(control, caja.querySelector(`[data-error="${clave}"]`), textoFecha && !fechaIsoValida(iso) ? 'Fecha no válida (dd/mm/aaaa)' : '');
    return fechaIsoValida(iso) ? iso : '';
  };
  const actualizar = () => {
    filtros.cliente = cliente.value;
    filtros.estado = estado.value;
    filtros.desde = leerFecha(desde, 'filtro.desde');
    filtros.hasta = leerFecha(hasta, 'filtro.hasta');
    filtros.verReemplazadas = interruptor.checked;
    alCambiar();
  };
  caja.addEventListener('input', actualizar);
  caja.addEventListener('change', actualizar);
  return caja;
}

function renderCotizaciones(container) {
  container.innerHTML = '';
  const encabezado = crearElemento('div', 'cot-encabezado');
  encabezado.appendChild(crearElemento('h2', 'cot-titulo', 'Cotizaciones'));
  const zonaFormulario = document.createElement('div');
  const zonaResumen = document.createElement('div');
  const zonaLista = document.createElement('div');
  const filtros = { cliente: '', estado: '', desde: '', hasta: '', verReemplazadas: false };

  let idAbierta = null;
  const alEliminar = async (cotizacion, boton) => {
    const resultado = await eliminarConConfirmacion(cotizacion, boton);
    if (resultado === 'eliminada' && idAbierta === cotizacion.id) cerrar(true);
    else if (resultado) pintarLista();
  };
  const acciones = {
    abrir: (cotizacion, soloLectura) => abrir(cotizacion, soloLectura),
    eliminar: alEliminar,
    cambiarEstado: async (cotizacion, nuevo, boton) => { if (await pedirCambioEstado(cotizacion, nuevo, boton)) pintarLista(); },
    crearRevision: async (cotizacion, boton) => { if (await pedirRevision(cotizacion, boton)) pintarLista(); }
  };
  const pintarLista = () => {
    const visibles = filtrarCotizaciones(window.EVE.cotizaciones || [], filtros);
    zonaResumen.innerHTML = '';
    zonaResumen.appendChild(crearResumenEstados(visibles));
    zonaLista.innerHTML = '';
    const tarjeta = crearElemento('div', 'card');
    tarjeta.appendChild(crearTablaCotizaciones(visibles, acciones));
    zonaLista.appendChild(tarjeta);
  };
  const cerrar = (huboCambios) => {
    zonaFormulario.innerHTML = '';
    idAbierta = null;
    if (huboCambios) pintarLista();
  };
  function abrir(cotizacion, soloLectura) {
    zonaFormulario.innerHTML = '';
    idAbierta = cotizacion ? cotizacion.id : null;
    zonaFormulario.appendChild(crearFormulario({ cotizacion, soloLectura, alTerminar: cerrar }));
    zonaFormulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (window.puedeEscribir('cotizaciones')) {
    const nueva = crearElemento('button', 'btn-primary', '+ Nueva cotización');
    nueva.type = 'button';
    nueva.addEventListener('click', () => abrir(null, false));
    encabezado.appendChild(nueva);
  }
  container.append(encabezado, zonaFormulario, crearFiltros(filtros, pintarLista), zonaResumen, zonaLista);
  pintarLista();
}

window.EVE_MODULES.cotizaciones = { render: renderCotizaciones };

})();
