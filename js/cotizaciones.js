(function () {

// Base del módulo Cotizaciones: datos del emisor (config/emisor) y folios consecutivos por año. Todavía no hay pantalla
// de cotizaciones; solo el formulario del emisor en Admin → Configuración (js/admin-config.js).

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
  generarFolio
};

})();
