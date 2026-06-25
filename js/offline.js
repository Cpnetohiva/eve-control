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
  var store = await obtenerStore('cola_pendiente', 'readonly');
  return idbReq(store.getAll());
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

async function guardarCacheDatos() {
  if (!window.EVE) return;
  var store = await obtenerStore('cache_datos', 'readwrite');
  var ts = new Date().toISOString();
  var entradas = [
    { coleccion: 'destaraje',          registros: window.EVE.registrosDestaraje || [] },
    { coleccion: 'ventas',             registros: window.EVE.registrosVentas || [] },
    { coleccion: 'produccion',         registros: window.EVE.registrosProduccion || [] },
    { coleccion: 'pagos',              registros: window.EVE.registrosPagos || [] },
    { coleccion: 'ministraciones',     registros: window.EVE.registrosMinistraciones || [] },
    { coleccion: 'control_produccion', registros: window.EVE.registrosControlProduccion || [] }
  ];
  for (var i = 0; i < entradas.length; i++) {
    await idbReq(store.put(Object.assign({}, entradas[i], { ultimaSync: ts })));
  }
}

async function cargarCacheDatos() {
  var store = await obtenerStore('cache_datos', 'readonly');
  var todo = await idbReq(store.getAll());
  if (!todo.length || !window.EVE) return false;
  var mapa = {};
  todo.forEach(function (e) { mapa[e.coleccion] = e.registros; });
  window.EVE.registrosDestaraje          = mapa.destaraje || [];
  window.EVE.registrosVentas             = mapa.ventas || [];
  window.EVE.registrosProduccion         = mapa.produccion || [];
  window.EVE.registrosPagos              = mapa.pagos || [];
  window.EVE.registrosMinistraciones     = mapa.ministraciones || [];
  window.EVE.registrosControlProduccion  = mapa.control_produccion || [];
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
  if (!pendientes.length) {
    lista.innerHTML = '<p class="pp-vacio">Sin registros pendientes</p>';
    return;
  }
  lista.innerHTML = pendientes.map(function (item) {
    var hora = new Date(item.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    var ticket = (item.datos && (item.datos.ticket || item.datos.folio)) || '—';
    return '<div class="pp-item"><span>' + item.coleccion + '</span><span>Ticket ' + ticket + '</span><span>' + hora + '</span></div>';
  }).join('');
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
    for (var i = 0; i < pendientes.length; i++) {
      var item = pendientes[i];
      try {
        await window.guardarDatoFirebase(item.coleccion, item.datos);
        await eliminarDeCola(item.id);
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
  } finally {
    sincronizando = false;
  }
}

// ── Mapa colección → array de window.EVE ──────────────────────────────────
var MAPA_EVE = {
  destaraje:          function (r) { if (window.EVE) window.EVE.registrosDestaraje.push(r); },
  produccion:         function (r) { if (window.EVE) window.EVE.registrosProduccion.push(r); },
  pagos:              function (r) { if (window.EVE) window.EVE.registrosPagos.push(r); },
  ministraciones:     function (r) { if (window.EVE) window.EVE.registrosMinistraciones.push(r); },
  control_produccion: function (r) { if (window.EVE) window.EVE.registrosControlProduccion.push(r); }
};

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
    var mapear = MAPA_EVE[coleccion];
    if (mapear) mapear(Object.assign({ id: localId }, datosCompletos));
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
  cargarCacheDatos: cargarCacheDatos
};

})();
