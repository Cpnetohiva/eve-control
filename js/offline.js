(function () {

const DB_NOMBRE = 'EVEControlOffline';
const DB_VERSION = 1;
let dbPromesa = null;

function abrirDB() {
  if (dbPromesa) return dbPromesa;
  dbPromesa = new Promise(function (resolve, reject) {
    var req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = function (e) {
      var d = e.target.result;
      if (!d.objectStoreNames.contains('cola_pendiente')) {
        d.createObjectStore('cola_pendiente', { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains('cache_datos')) {
        d.createObjectStore('cache_datos', { keyPath: 'coleccion' });
      }
    };
    req.onsuccess = function (e) { resolve(e.target.result); };
    req.onerror = function () { reject(req.error); };
  });
  return dbPromesa;
}

function idbReq(req) {
  return new Promise(function (resolve, reject) {
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

async function obtenerStore(nombre, modo) {
  var db = await abrirDB();
  return db.transaction(nombre, modo).objectStore(nombre);
}

async function encolarOperacion(coleccion, datos) {
  var store = await obtenerStore('cola_pendiente', 'readwrite');
  return idbReq(store.add({
    coleccion: coleccion,
    datos: datos,
    timestamp: new Date().toISOString(),
    intentos: 0,
    estado: 'pendiente'
  }));
}

async function obtenerPendientes() {
  var db = await abrirDB();
  return new Promise(function (resolve, reject) {
    var tx = db.transaction('cola_pendiente', 'readonly');
    var store = tx.objectStore('cola_pendiente');
    var req = store.getAll();
    req.onsuccess = function () {
      resolve((req.result || []).filter(function (item) {
        return item.estado === 'pendiente';
      }));
    };
    req.onerror = function () { reject(req.error); };
  });
}

async function eliminarDeCola(id) {
  var store = await obtenerStore('cola_pendiente', 'readwrite');
  return idbReq(store.delete(id));
}

async function contarPendientes() {
  var store = await obtenerStore('cola_pendiente', 'readonly');
  return idbReq(store.count());
}

async function marcarError(item) {
  var db = await abrirDB();
  var tx = db.transaction('cola_pendiente', 'readwrite');
  tx.objectStore('cola_pendiente').put(Object.assign({}, item, {
    intentos: item.intentos + 1,
    estado: 'error'
  }));
  return new Promise(function (res) { tx.oncomplete = res; tx.onerror = res; });
}

// Una operación encolada que coincide con un registro existente (o ya subido en esta sincronización) no se sube ni se descarta: queda en
// estado 'revision' hasta que alguien decida en el panel de pendientes.
async function marcarRevision(item, duplicado) {
  var db = await abrirDB();
  var tx = db.transaction('cola_pendiente', 'readwrite');
  var existente = duplicado.registro || {};
  tx.objectStore('cola_pendiente').put(Object.assign({}, item, {
    estado: 'revision',
    duplicadoDe: { id: existente.id || '', folio: existente.folio || existente.ticket || '', fecha: existente.fecha || '', coincidencias: duplicado.coincidencias || [] }
  }));
  return new Promise(function (res) { tx.oncomplete = res; tx.onerror = res; });
}

async function obtenerEnRevision() {
  var db = await abrirDB();
  return new Promise(function (resolve, reject) {
    var req = db.transaction('cola_pendiente', 'readonly').objectStore('cola_pendiente').getAll();
    req.onsuccess = function () { resolve((req.result || []).filter(function (item) { return item.estado === 'revision'; })); };
    req.onerror = function () { reject(req.error); };
  });
}

// «Es otro registro»: se confirma el duplicado y vuelve a la cola para subirse en la siguiente sincronización.
async function confirmarItemRevision(item) {
  var db = await abrirDB();
  var tx = db.transaction('cola_pendiente', 'readwrite');
  tx.objectStore('cola_pendiente').put(Object.assign({}, item, { estado: 'pendiente', datos: Object.assign({}, item.datos, { duplicadoConfirmado: true }) }));
  await new Promise(function (res) { tx.oncomplete = res; tx.onerror = res; });
  await actualizarPanelPendientes();
  if (navigator.onLine) sincronizarCola();
}

async function descartarItemRevision(item) {
  if (!window.confirm('¿Descartar este registro? No se subirá y no se podrá recuperar.')) return;
  await eliminarDeCola(item.id);
  await actualizarPanelPendientes();
}

window.EVE_COLA_OFFLINE = { obtenerPendientes: obtenerPendientes, obtenerEnRevision: obtenerEnRevision };

async function guardarCacheDatos() {
  if (!window.EVE) return;
  var db = await abrirDB();
  // Sin sesión no hay datos que guardar (K24d): evita que una escritura pendiente reponga la caché ya limpiada al cerrar
  // sesión, o la pise con colecciones vacías si el evento 'online' llega antes de que Firebase restaure la sesión.
  if (!window.EVE.currentUser) return;
  var ts = new Date().toISOString();
  var entradas = [
    { coleccion: 'destaraje',          registros: window.EVE.registrosDestaraje || [] },
    { coleccion: 'ventas_legacy',      registros: window.EVE.registrosVentas || [] },
    { coleccion: 'ventas',             registros: window.EVE.ventas || [] },
    { coleccion: 'pagos',              registros: window.EVE.registrosPagos || [] },
    { coleccion: 'ministraciones',     registros: window.EVE.registrosMinistraciones || [] },
    { coleccion: 'control_produccion', registros: window.EVE.registrosControlProduccion || [] },
    { coleccion: 'comisiones',         registros: window.EVE.comisiones || [] },
    { coleccion: 'precios',            registros: window.EVE.precios || [] },
    { coleccion: 'cuentas_por_pagar',  registros: window.EVE.cuentasPorPagar || [] },
    { coleccion: 'auditorias',         registros: window.EVE.auditorias || [] },
    { coleccion: 'auditoria_fotos',    registros: window.EVE.auditoriaFotos || [] },
    { coleccion: 'composiciones',      registros: window.EVE.composiciones || [] },
    { coleccion: 'inventario',         registros: window.EVE.inventario || [] },
    { coleccion: 'proveedores',        registros: window.EVE.proveedores || [] },
    { coleccion: 'config',             registros: [{ fechaCorteAuditoria: window.EVE.fechaCorteAuditoria, metaEficiencia: window.EVE.metaEficiencia, metaPiezasDia: window.EVE.metaPiezasDia, catalogoExtra: window.EVE.catalogoExtra }] }
  ];
  var tx = db.transaction('cache_datos', 'readwrite');
  var store = tx.objectStore('cache_datos');
  entradas.forEach(function (e) {
    store.put(Object.assign({}, e, { ultimaSync: ts }));
  });
  return new Promise(function (resolve, reject) {
    tx.oncomplete = resolve;
    tx.onerror = function () { reject(tx.error); };
  });
}

// Vacía la caché de datos (colecciones y config) al cerrar sesión de forma EXPLÍCITA (K24d): los documentos completos
// (incluidos los inputs de PELETIZADO) no deben quedar en el dispositivo. NO toca cola_pendiente (son registros que el usuario
// capturó sin red y aún no se suben: borrarlos los perdería) ni el service worker ni APP_SHELL. Solo la llama el botón
// Cerrar sesión: una sesión expirada o la pérdida de red no limpian nada, para no dejar la app sin datos en planta.
async function limpiarCacheDatos() {
  var db = await abrirDB();
  var tx = db.transaction('cache_datos', 'readwrite');
  tx.objectStore('cache_datos').clear();
  return new Promise(function (resolve, reject) {
    tx.oncomplete = resolve;
    tx.onerror = function () { reject(tx.error); };
  });
}

async function cargarCacheDatos() {
  var store = await obtenerStore('cache_datos', 'readonly');
  var todo = await idbReq(store.getAll());
  if (!todo.length || !window.EVE) return false;
  var mapa = {};
  todo.forEach(function (e) { mapa[e.coleccion] = e.registros; });
  window.EVE.registrosDestaraje          = mapa.destaraje || [];
  window.EVE.registrosVentas             = mapa.ventas_legacy || [];
  window.EVE.ventas                      = mapa.ventas || [];
  window.EVE.registrosPagos              = mapa.pagos || [];
  window.EVE.registrosMinistraciones     = mapa.ministraciones || [];
  window.EVE.registrosControlProduccion  = mapa.control_produccion || [];
  window.EVE.comisiones                  = mapa.comisiones || [];
  window.EVE.precios                     = mapa.precios || [];
  window.EVE.cuentasPorPagar             = mapa.cuentas_por_pagar || [];
  window.EVE.auditorias                  = mapa.auditorias || [];
  window.EVE.auditoriaFotos              = mapa.auditoria_fotos || [];
  window.EVE.composiciones               = mapa.composiciones || [];
  window.EVE.inventario                  = mapa.inventario || [];
  window.EVE.proveedores                 = mapa.proveedores || [];
  // La caché puede traerse de una versión previa a PROVEEDORES_ALIAS: se unifica igual que al cargar de Firestore (auth.js).
  [window.EVE.registrosDestaraje, window.EVE.registrosVentas, window.EVE.registrosPagos, window.EVE.registrosMinistraciones,
    window.EVE.cuentasPorPagar, window.EVE.auditorias, window.EVE.auditoriaFotos, window.EVE.precios].forEach(function (lista) {
    window.unificarProveedorEnRegistros(lista);
  });
  window.EVE.proveedores = window.fusionarProveedoresDuplicados(window.EVE.proveedores);
  var configCacheado = (mapa.config && mapa.config[0]) || {};
  window.EVE.fechaCorteAuditoria         = configCacheado.fechaCorteAuditoria || window.EVE.fechaCorteAuditoria || '2026-07-01';
  window.EVE.metaEficiencia              = Number(configCacheado.metaEficiencia) || window.EVE.metaEficiencia || 90;
  window.EVE.metaPiezasDia               = configCacheado.metaPiezasDia || window.EVE.metaPiezasDia || {};
  // Extensión del catálogo (K22b): se reaplica con la misma validación por entrada y sin poder tumbar el arranque.
  window.EVE.catalogoExtra               = configCacheado.catalogoExtra;
  try {
    window.EVE_CATALOGO.aplicar(configCacheado.catalogoExtra);
  } catch (error) {
    console.warn('[catalogo] No se pudo reaplicar la extensión del catálogo desde la caché; se usa el catálogo base:', error);
  }
  return true;
}

// ── Header: 4 estados ──────────────────────────────────────────────────────
function actualizarEstadoConexion(estado, extra) {
  var el = document.getElementById('estado-conexion');
  if (!el) return;
  var cfg = {
    online:  { texto: '🟢 En línea',                              color: 'var(--verde-exito)', cursor: 'default'  },
    offline: { texto: '🔴 Sin conexión — ' + (extra || 0) + ' pendientes', color: 'var(--rojo-error)', cursor: 'pointer' },
    syncing: { texto: '🔄 Sincronizando... (' + (extra || '0/0') + ')',    color: 'var(--oro)',         cursor: 'default'  },
    synced:  { texto: '✅ Sincronizado',                           color: 'var(--verde-exito)', cursor: 'default'  }
  }[estado] || { texto: '🟢 En línea', color: 'var(--verde-exito)', cursor: 'default' };
  el.textContent = cfg.texto;
  el.style.color = cfg.color;
  el.style.cursor = cfg.cursor;
}

// ── Panel de pendientes ────────────────────────────────────────────────────
function crearPanelPendientes() {
  if (document.getElementById('panel-pendientes')) return;
  var panel = document.createElement('div');
  panel.id = 'panel-pendientes';
  panel.innerHTML = [
    '<div class="pp-header">',
    '  <span>📴 REGISTROS PENDIENTES DE SYNC</span>',
    '  <button id="pp-cerrar">✕</button>',
    '</div>',
    '<div id="pp-lista"></div>',
    '<p class="pp-nota">Se subirán al recuperar conexión.</p>'
  ].join('');
  document.body.appendChild(panel);
  document.getElementById('pp-cerrar').addEventListener('click', function () {
    panel.classList.remove('open');
  });
}

async function actualizarPanelPendientes() {
  var panel = document.getElementById('panel-pendientes');
  var lista = document.getElementById('pp-lista');
  if (!panel || !lista) return;
  var pendientes = await obtenerPendientes();
  var enRevision = await obtenerEnRevision();
  // Los nodos se construyen con createElement + textContent: ticket, folio y colección vienen de lo que capturó la persona (o de un
  // dispositivo) y NUNCA se interpretan como HTML.
  lista.textContent = '';
  if (!pendientes.length) {
    var vacio = document.createElement('p');
    vacio.className = 'pp-vacio';
    vacio.textContent = 'Sin registros pendientes';
    lista.appendChild(vacio);
  } else {
    pendientes.forEach(function (item) {
      var hora = new Date(item.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
      var ticket = (item.datos && (item.datos.ticket || item.datos.folio)) || '—';
      var fila = document.createElement('div');
      fila.className = 'pp-item';
      [item.coleccion, 'Ticket ' + ticket, hora].forEach(function (texto) {
        var celda = document.createElement('span');
        celda.textContent = String(texto);
        fila.appendChild(celda);
      });
      lista.appendChild(fila);
    });
  }
  if (!enRevision.length) return;
  var seccion = document.createElement('div');
  var titulo = document.createElement('p');
  titulo.className = 'pp-nota';
  titulo.textContent = '⚠️ En revisión por posible duplicado (no se subieron):';
  seccion.appendChild(titulo);
  enRevision.forEach(function (item) {
    var fila = document.createElement('div');
    fila.className = 'pp-item';
    var datos = item.datos || {};
    var existente = item.duplicadoDe || {};
    var texto = document.createElement('span');
    texto.textContent = item.coleccion + ' ' + (datos.folio || datos.ticket || '') + ' ' + (datos.fecha || '') + ' · parecido a ' + (existente.folio || existente.id || 'un registro existente');
    var subir = document.createElement('button');
    subir.type = 'button';
    subir.textContent = 'Es otro registro, subir';
    subir.addEventListener('click', function () { confirmarItemRevision(item); });
    var descartar = document.createElement('button');
    descartar.type = 'button';
    descartar.textContent = 'Descartar';
    descartar.addEventListener('click', function () { descartarItemRevision(item); });
    fila.appendChild(texto);
    fila.appendChild(subir);
    fila.appendChild(descartar);
    seccion.appendChild(fila);
  });
  lista.appendChild(seccion);
}

// ── Sincronización ─────────────────────────────────────────────────────────
var sincronizando = false;

async function sincronizarCola() {
  if (sincronizando) return;
  sincronizando = true;
  try {
    var pendientes = await obtenerPendientes();
    if (!pendientes.length) {
      await guardarCacheDatos().catch(function () {});
      actualizarEstadoConexion('synced');
      setTimeout(function () { actualizarEstadoConexion('online'); }, 3000);
      return;
    }
    actualizarEstadoConexion('syncing', '0/' + pendientes.length);
    var hecho = 0;
    var mapaFolios = {};
    var subidos = {};
    var enRevisionAhora = 0;
    for (var i = 0; i < pendientes.length; i++) {
      var item = pendientes[i];
      try {
        // Posible duplicado de un registro existente (o ya subido en esta sincronización): queda en revisión, sin subir ni descartar.
        var posibleDuplicado = window.revisarItemColaDuplicado ? window.revisarItemColaDuplicado(item.coleccion, item.datos, subidos) : null;
        if (posibleDuplicado) {
          await marcarRevision(item, posibleDuplicado);
          enRevisionAhora++;
          continue;
        }
        var datosASubir = item.datos;
        // Ventas capturadas sin conexión llevan un folio provisional: si ya existe se reasigna uno definitivo (ver ventas.js).
        if (window.EVE_FOLIOS_VENTAS) {
          datosASubir = await window.EVE_FOLIOS_VENTAS.resolverFolioAlSincronizar(item.coleccion, item.datos, mapaFolios);
        }
        await window.guardarDatoFirebase(item.coleccion, datosASubir);
        await eliminarDeCola(item.id);
        var moduloSubido = window.moduloDuplicadoDeColeccion ? window.moduloDuplicadoDeColeccion(item.coleccion) : null;
        if (moduloSubido) (subidos[moduloSubido] = subidos[moduloSubido] || []).push(datosASubir);
        hecho++;
        actualizarEstadoConexion('syncing', hecho + '/' + pendientes.length);
      } catch (err) {
        await marcarError(item);
      }
    }
    if (typeof window.cargarDatosEnParalelo === 'function') {
      await window.cargarDatosEnParalelo();
    }
    await guardarCacheDatos().catch(function () {});
    actualizarEstadoConexion('synced');
    setTimeout(function () { actualizarEstadoConexion('online'); }, 3000);
    if (enRevisionAhora > 0) {
      await actualizarPanelPendientes();
      window.showError(enRevisionAhora + ' registro(s) quedaron en revisión por posible duplicado. Revísalos en el panel de pendientes.');
    }
  } finally {
    sincronizando = false;
  }
}

// ── Interceptar guardarDato ────────────────────────────────────────────────
var _guardarDatoOriginal = window.guardarDato;
window.guardarDatoFirebase = _guardarDatoOriginal;

window.guardarDato = async function (coleccion, datos) {
  if (!navigator.onLine) {
    var datosCompletos = Object.assign({}, datos);
    if (!datosCompletos.fechaRegistro) {
      datosCompletos.fechaRegistro = new Date().toISOString();
    }
    await encolarOperacion(coleccion, datosCompletos);
    var localId = 'offline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    var n = await contarPendientes();
    actualizarEstadoConexion('offline', n);
    await actualizarPanelPendientes();
    return localId;
  }
  return _guardarDatoOriginal(coleccion, datos);
};

// actualizarDato y eliminarDato sin conexión → showError
var _actualizarDatoOriginal = window.actualizarDato;
window.actualizarDato = async function (coleccion, id, datos) {
  if (!navigator.onLine) {
    window.showError('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
    return;
  }
  return _actualizarDatoOriginal(coleccion, id, datos);
};

var _eliminarDatoOriginal = window.eliminarDato;
window.eliminarDato = async function (coleccion, id) {
  if (!navigator.onLine) {
    window.showError('Sin conexión. Vuelve a intentarlo cuando tengas internet.');
    return;
  }
  return _eliminarDatoOriginal(coleccion, id);
};

// ── Inicialización ─────────────────────────────────────────────────────────
abrirDB()
  .then(async function () {
    crearPanelPendientes();
    if (!navigator.onLine) {
      var n = await contarPendientes();
      actualizarEstadoConexion('offline', n);
    }
  })
  .catch(function (err) { console.error('EVE offline: IndexedDB init error:', err); });

window.addEventListener('online', function () { sincronizarCola(); });
window.addEventListener('offline', async function () {
  var n = await contarPendientes();
  actualizarEstadoConexion('offline', n);
});

// Después de todos los scripts: envolver cargarDatosEnParalelo + click del header
window.addEventListener('load', function () {
  if (typeof window.cargarDatosEnParalelo === 'function') {
    var _cargarOriginal = window.cargarDatosEnParalelo;
    window.cargarDatosEnParalelo = async function () {
      var result = await _cargarOriginal();
      if (navigator.onLine) { await guardarCacheDatos().catch(function () {}); }
      return result;
    };
  }

  var estadoEl = document.getElementById('estado-conexion');
  if (estadoEl) {
    estadoEl.addEventListener('click', async function () {
      if (estadoEl.style.cursor !== 'pointer') return;
      var panel = document.getElementById('panel-pendientes');
      if (!panel) return;
      await actualizarPanelPendientes();
      panel.classList.toggle('open');
    });
  }
});

window.EVE_OFFLINE = {
  actualizarEstadoConexion: actualizarEstadoConexion,
  sincronizarCola: sincronizarCola,
  contarPendientes: contarPendientes,
  cargarCacheDatos: cargarCacheDatos,
  guardarCacheDatos: guardarCacheDatos,
  limpiarCacheDatos: limpiarCacheDatos
};

})();
