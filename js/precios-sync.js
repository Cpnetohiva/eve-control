(function () {

// Sincronización del catálogo de precios (precios + ajustes_precio_proveedor) con Firestore.
//
// Por qué existe: window.EVE.precios se carga UNA vez al iniciar sesión (auth.js) o sale de la caché offline (offline.js) y no se
// refrescaba durante el día. Un precio dado de alta desde otro equipo (p. ej. PET a 9.70 con vigencia retroactiva) no llegaba a
// quien ya tenía la sesión abierta, y las CxP que creaba congelaban el precio viejo (ver AUDITORIA_PRECIOS.md).
//
// Dos mecanismos, sin listener en tiempo real (un onSnapshot lee la colección completa cada vez que se abre y no se puede acotar):
//  1) sincronizar(): relee las dos colecciones del catálogo (son pequeñas) al recuperar foco o conexión, con un mínimo de
//     INTERVALO_MIN_MS entre lecturas, así que como máximo 30 lecturas de catálogo por hora y por equipo, y 0 si no hay actividad.
//  2) asegurarPreciosFrescos(): justo antes de congelar un precio en una CxP, lee del SERVIDOR solo ese material (y sus ajustes).

const INTERVALO_MIN_MS = 2 * 60 * 1000;
const VIGENCIA_LECTURA_MS = 60 * 1000;
const COLECCION_PRECIOS = 'precios';
const COLECCION_AJUSTES = 'ajustes_precio_proveedor';

let ultimaSincronizacion = 0;
let enCurso = null;
let instalado = false;
const frescoHasta = new Map();

function contarLecturas(coleccion, snapshot) {
  if (window.EVE_LECTURAS && typeof window.EVE_LECTURAS.contar === 'function') window.EVE_LECTURAS.contar(coleccion, snapshot);
}

function unificar(lista) {
  if (typeof window.unificarProveedorEnRegistros === 'function') window.unificarProveedorEnRegistros(lista);
  return lista;
}

function docsAListas(snapshot) {
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

// Reemplaza por id los que ya estaban y agrega los demás; no quita nada.
function fusionarPorId(actuales, nuevos) {
  const lista = (actuales || []).slice();
  const posicion = new Map(lista.map((registro, indice) => [registro.id, indice]));
  nuevos.forEach((registro) => {
    if (posicion.has(registro.id)) {
      lista[posicion.get(registro.id)] = registro;
    } else {
      posicion.set(registro.id, lista.length);
      lista.push(registro);
    }
  });
  return lista;
}

function enLinea() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

async function hayEscriturasPendientes() {
  const offline = window.EVE_OFFLINE;
  if (!offline || typeof offline.contarPendientes !== 'function') return false;
  try {
    return (await offline.contarPendientes()) > 0;
  } catch (error) {
    return false;
  }
}

// Relee el catálogo completo. Devuelve { ok, motivo }. Nunca lanza: una falla deja la memoria como estaba.
async function sincronizar(opciones) {
  const forzar = !!(opciones && opciones.forzar);
  if (!window.db || !window.EVE || !window.EVE.currentUser) return { ok: false, motivo: 'sin_sesion' };
  if (typeof window.puedeLeer === 'function' && !window.puedeLeer('precios')) return { ok: false, motivo: 'sin_permiso' };
  if (!enLinea()) return { ok: false, motivo: 'sin_conexion' };
  if (!forzar && Date.now() - ultimaSincronizacion < INTERVALO_MIN_MS) return { ok: false, motivo: 'reciente' };
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      // Con capturas sin conexión por subir, la memoria puede traer precios que Firestore aún no tiene: releer los borraría.
      if (await hayEscriturasPendientes()) return { ok: false, motivo: 'cola_pendiente' };
      const [snapPrecios, snapAjustes] = await Promise.all([
        window.db.collection(COLECCION_PRECIOS).get({ source: 'server' }),
        window.db.collection(COLECCION_AJUSTES).get({ source: 'server' })
      ]);
      contarLecturas(COLECCION_PRECIOS, snapPrecios);
      contarLecturas(COLECCION_AJUSTES, snapAjustes);
      window.EVE.precios = unificar(docsAListas(snapPrecios));
      window.EVE.ajustesPrecioProveedor = unificar(docsAListas(snapAjustes));
      ultimaSincronizacion = Date.now();
      window.EVE.preciosSincronizadoEn = ultimaSincronizacion;
      frescoHasta.clear();
      // Que la próxima apertura sin conexión no arranque con el catálogo viejo.
      if (window.EVE_OFFLINE && typeof window.EVE_OFFLINE.guardarCacheDatos === 'function') {
        Promise.resolve(window.EVE_OFFLINE.guardarCacheDatos()).catch(() => {});
      }
      return { ok: true, motivo: (opciones && opciones.motivo) || 'manual' };
    } catch (error) {
      console.warn('[precios-sync] No se pudo sincronizar el catálogo de precios:', error);
      return { ok: false, motivo: 'error', error };
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

// Antes de congelar un precio: lee del servidor los precios y ajustes de ESE material y los mezcla en memoria.
// Devuelve { desdeCache, motivo }. desdeCache = true cuando no se pudo confirmar con el servidor (sin conexión o lectura fallida):
// quien llama puede seguir, pero debe marcar el resultado para revisión.
async function asegurarPreciosFrescos(material) {
  const mat = window.normalizarMaterial(material);
  if (!enLinea()) return { desdeCache: true, motivo: 'sin_conexion' };
  if ((frescoHasta.get(mat) || 0) > Date.now()) return { desdeCache: false, motivo: 'reciente' };
  const nombres = Array.from(new Set([mat, String(material || '').trim().toUpperCase()].filter(Boolean)));
  const consulta = (coleccion) => {
    const base = window.db.collection(coleccion);
    return (nombres.length === 1 ? base.where('material', '==', nombres[0]) : base.where('material', 'in', nombres)).get({ source: 'server' });
  };
  try {
    const [snapPrecios, snapAjustes] = await Promise.all([consulta(COLECCION_PRECIOS), consulta(COLECCION_AJUSTES)]);
    contarLecturas(COLECCION_PRECIOS, snapPrecios);
    contarLecturas(COLECCION_AJUSTES, snapAjustes);
    window.EVE.precios = fusionarPorId(window.EVE.precios, unificar(docsAListas(snapPrecios)));
    window.EVE.ajustesPrecioProveedor = fusionarPorId(window.EVE.ajustesPrecioProveedor, unificar(docsAListas(snapAjustes)));
    frescoHasta.set(mat, Date.now() + VIGENCIA_LECTURA_MS);
    return { desdeCache: false, motivo: 'servidor' };
  } catch (error) {
    console.warn('[precios-sync] No se pudo confirmar el precio con el servidor; se usa la memoria local:', error);
    return { desdeCache: true, motivo: 'error', error };
  }
}

// El inicio de sesión acaba de leer el catálogo completo: cuenta como sincronización.
function marcarCargaCompleta() {
  ultimaSincronizacion = Date.now();
  window.EVE.preciosSincronizadoEn = ultimaSincronizacion;
  frescoHasta.clear();
}

function instalar() {
  if (instalado) return;
  instalado = true;
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') sincronizar({ motivo: 'foco' });
    });
  }
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('focus', () => { sincronizar({ motivo: 'foco' }); });
    // Un momento de gracia: offline.js sube su cola al volver la conexión, y sincronizar() espera a que no quede nada pendiente.
    window.addEventListener('online', () => { setTimeout(() => { sincronizar({ motivo: 'conexion' }); }, 3000); });
  }
}

window.EVE_PRECIOS_SYNC = {
  INTERVALO_MIN_MS,
  VIGENCIA_LECTURA_MS,
  sincronizar,
  asegurarPreciosFrescos,
  marcarCargaCompleta,
  instalar,
  _reiniciarParaPruebas() { ultimaSincronizacion = 0; enCurso = null; frescoHasta.clear(); }
};

instalar();

})();
