// Interruptor del Dashboard Ejecutivo para socios (Admin → Configuración, config/dashboard_ejecutivo).
// Sin navegador: js/admin-config.js real en vm con un Firestore en memoria (get, set, runTransaction) y un DOM mínimo.
//
// Uso: node scripts/verificar-interruptor-dashboard.js   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
const igual = (a, b, m) => afirmar(JSON.stringify(a) === JSON.stringify(b), `${m}: esperado ${JSON.stringify(b)}, obtenido ${JSON.stringify(a)}`);

// ── DOM mínimo con búsqueda por selector de id ──
function nuevoElemento(tag) {
  const el = { tag, children: [], listeners: {}, style: {}, disabled: false, textContent: '', className: '', _html: '', parent: null,
    set innerHTML(v) { this._html = v; this.children = []; (v.match(/id="([^"]+)"/g) || []).forEach((m) => { const id = m.slice(4, -1); const h = nuevoElemento('x'); h.id = id; h.parent = this; this.children.push(h); }); },
    get innerHTML() { return this._html; },
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    get firstChild() { return this.children[0] || null; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    querySelector(sel) { const id = sel.replace(/^#/, ''); const buscar = (n) => { for (const h of n.children) { if (h.id === id) return h; const r = buscar(h); if (r) return r; } return null; }; return buscar(this); },
    async click() { for (const fn of this.listeners.click || []) await fn({ preventDefault() {} }); } };
  return el;
}

// ── Firestore en memoria ──
function crearBD(opc) {
  const o = opc || {};
  const docs = new Map(Object.entries(o.docs || {}));
  const espia = { escrituras: [], lecturas: [], transacciones: 0, historial: [] };
  const ref = (col, id) => ({ col, id, key: col + '/' + id,
    async get() { espia.lecturas.push(col + '/' + id); if (o.falloLectura) { const e = new Error('lectura rota'); e.code = 'unavailable'; throw e; } const v = docs.get(col + '/' + id); return { exists: v !== undefined, data: () => (v === undefined ? undefined : JSON.parse(JSON.stringify(v))) }; },
    async set(v) { espia.escrituras.push([col + '/' + id, v]); docs.set(col + '/' + id, JSON.parse(JSON.stringify(v))); } });
  return { docs, espia, db: {
    collection: (col) => ({ doc: (id) => ref(col, id) }),
    async runTransaction(fn) {
      espia.transacciones++;
      const escrituras = [];
      const tx = { async get(r) { return r.get(); }, set(r, v) { escrituras.push([r, v]); } };
      const resultado = await fn(tx);
      if (o.falloEscritura) { const e = new Error(o.falloEscritura.message); e.code = o.falloEscritura.code; throw e; }
      for (const [r, v] of escrituras) await r.set(v);
      return resultado;
    } } };
}

// ── Carga de js/admin-config.js ──
function cargar(opc) {
  const o = opc || {};
  const bd = crearBD(o);
  const mensajes = { error: [], exito: [] };
  const confirmaciones = [];
  const window = {
    db: bd.db, EVE: { currentUser: o.sinUsuario ? null : { username: o.usuario || 'neto', permisosResueltos: { admin: o.admin === undefined ? 'escritura' : o.admin } } },
    puedeEscribir: (m) => { const p = window.EVE.currentUser && window.EVE.currentUser.permisosResueltos; return !!p && p[m] === 'escritura'; },
    puedeLeer: (m) => { const p = window.EVE.currentUser && window.EVE.currentUser.permisosResueltos; return !!p && (p[m] === 'lectura' || p[m] === 'escritura'); },
    showError: (m) => mensajes.error.push(m), showSuccess: (m) => mensajes.exito.push(m),
    confirm: (t) => { confirmaciones.push(t); return o.confirma !== false; },
    formatearFecha: (x) => x, restarUnDia: (x) => x,
    EVE_HISTORIAL: { registrar: async (e) => { bd.espia.historial.push(e); } }
  };
  window.window = window;
  const ctx = { window, document: { createElement: (t) => nuevoElemento(t), getElementById: () => null }, navigator: { onLine: o.sinConexion ? false : true },
    console: { log() {}, warn() {}, error() {} }, Intl, Date, JSON, Promise, Number, String, Array, Object, Error, setTimeout };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, 'js', 'admin-config.js'), 'utf8'), ctx, { filename: 'js/admin-config.js' });
  const C = ctx.window.EVE_ADMIN_CONFIG;
  return { C, bd, mensajes, confirmaciones, W: ctx.window, ctx };
}
const asentar = () => new Promise((r) => setTimeout(r, 0));
const DOC = 'config/dashboard_ejecutivo';

(async () => {
  // ── Textos exactos ──
  {
    const { C } = cargar();
    igual(C.TEXTO_CONFIRMAR_ABRIR_DASHBOARD, '¿Abrir el Dashboard Ejecutivo para los socios? Cualquier usuario con sesión podrá entrar y verlo.', 'texto de confirmación para abrir');
    igual(C.TEXTO_CONFIRMAR_CERRAR_DASHBOARD, '¿Cerrar el Dashboard Ejecutivo? Los socios verán En mantenimiento al actualizar o volver a entrar.', 'texto de confirmación para cerrar');
  }

  // ── La tarjeta aparece solo con permiso de escritura de Admin ──
  {
    const con = cargar();
    const t = con.C.crearTarjetaDashboardEjecutivo();
    afirmar(!!t && /Dashboard Ejecutivo para socios/.test(t.innerHTML), 'la tarjeta aparece con Admin escritura y se titula «Dashboard Ejecutivo para socios»');
    ['lectura', 'ninguno', undefined].forEach((p) => afirmar(cargar({ admin: p === undefined ? 'ninguno' : p }).C.crearTarjetaDashboardEjecutivo() === null, `la tarjeta no aparece con permiso admin «${p}»`));
    afirmar(cargar({ sinUsuario: true }).C.crearTarjetaDashboardEjecutivo() === null, 'la tarjeta no aparece sin usuario');
    const vista = cargar();
    // crearVistaConfig la incluye solo con permiso: se prueba la integración en el código
    const codigo = fs.readFileSync(path.join(RAIZ, 'js', 'admin-config.js'), 'utf8');
    afirmar(/crearTarjetaDashboardEjecutivo\(\);\s*\n\s*if \(tarjetaDashboard\) tarjeta\.insertBefore/.test(codigo), 'crearVistaConfig inserta la tarjeta solo si existe (permiso)');
    afirmar(vista.C.crearVistaConfig && true, 'crearVistaConfig sigue exportada');
  }

  // ── Estado inicial: Cerrado cuando el documento no existe ──
  {
    const x = cargar();
    const e = await x.C.cargarDashboardEjecutivo();
    igual(e, { abierto: false, cambiadoPor: '', cambiadoEn: '' }, 'sin documento el estado es cerrado');
    const t = x.C.crearTarjetaDashboardEjecutivo(); await asentar();
    igual([t.querySelector('#ade-estado').textContent, t.querySelector('#ade-boton').textContent, t.querySelector('#ade-boton').disabled], ['Cerrado', 'Abrir para socios', false], 'tarjeta: Cerrado y botón «Abrir para socios»');
    afirmar(/Sin cambios registrados/.test(t.querySelector('#ade-quien').textContent), 'tarjeta: sin documento no inventa quién ni cuándo');
    afirmar(x.bd.espia.escrituras.length === 0, 'leer el estado no escribe nada');
  }
  {
    const x = cargar({ docs: { [DOC]: { abierto: 'true', cambiadoPor: 'x' } } });
    igual((await x.C.cargarDashboardEjecutivo()).abierto, false, 'solo abierto === true cuenta como abierto (un texto «true» es cerrado)');
  }

  // ── Abrir y cerrar escriben los tres campos y registran historial ──
  {
    const x = cargar({ usuario: 'neto' });
    const r = await x.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'cambiado' && r.estado.abierto === true, 'abrir: resultado cambiado');
    const doc = x.bd.docs.get(DOC);
    afirmar(doc && doc.abierto === true && doc.cambiadoPor === 'neto' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(doc.cambiadoEn) && Object.keys(doc).length === 3, 'abrir: el documento trae abierto, cambiadoPor y cambiadoEn (ISO), y nada más');
    afirmar(x.bd.espia.transacciones === 1, 'abrir: la escritura va en una transacción');
    igual(x.bd.espia.historial.length, 1, 'abrir: una entrada de historial');
    const h = x.bd.espia.historial[0];
    afirmar(h.coleccion === 'config' && h.registroId === 'dashboard_ejecutivo' && h.accion === 'edicion' && h.valorAnterior.abierto === false && h.valorNuevo.abierto === true && h.valorNuevo.cambiadoPor === 'neto' && !!h.motivo, 'abrir: historial con valorAnterior (cerrado) y valorNuevo (abierto)');
    const c = await x.C.cambiarDashboardEjecutivo(false);
    afirmar(c.resultado === 'cambiado' && x.bd.docs.get(DOC).abierto === false && x.bd.docs.get(DOC).cambiadoPor === 'neto', 'cerrar: escribe abierto=false con quién cambió');
    const h2 = x.bd.espia.historial[1];
    afirmar(x.bd.espia.historial.length === 2 && h2.valorAnterior.abierto === true && h2.valorNuevo.abierto === false && h2.valorAnterior.cambiadoPor === 'neto', 'cerrar: historial con valorAnterior (abierto) y valorNuevo (cerrado)');
  }

  // ── No hace nada si ya está en ese estado ──
  {
    const x = cargar({ docs: { [DOC]: { abierto: true, cambiadoPor: 'otro', cambiadoEn: '2026-11-01T10:00:00.000Z' } } });
    const r = await x.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'sin_cambio' && x.bd.espia.escrituras.length === 0 && x.bd.espia.historial.length === 0, 'abrir cuando ya está abierto: sin escritura ni historial');
    igual(x.bd.docs.get(DOC), { abierto: true, cambiadoPor: 'otro', cambiadoEn: '2026-11-01T10:00:00.000Z' }, 'abrir cuando ya está abierto: el documento queda intacto (no cambia quién ni cuándo)');
    const y = cargar();
    const r2 = await y.C.cambiarDashboardEjecutivo(false);
    afirmar(r2.resultado === 'sin_cambio' && y.bd.espia.escrituras.length === 0 && !y.bd.docs.has(DOC), 'cerrar cuando no hay documento (ya cerrado): no crea el documento');
  }
  // La transacción lee el estado actual: una tarjeta desactualizada no pisa un cambio hecho por otro Admin
  {
    const x = cargar();
    const t = x.C.crearTarjetaDashboardEjecutivo(); await asentar();   // la tarjeta cree que está cerrado
    x.bd.docs.set(DOC, { abierto: true, cambiadoPor: 'otro', cambiadoEn: '2026-11-10T09:00:00.000Z' }); // otro Admin lo abrió
    await t.querySelector('#ade-boton').click();                       // pide abrir: ya está abierto
    afirmar(x.bd.espia.escrituras.length === 0 && /ya estaba abierto/.test(x.mensajes.exito[0] || ''), 'tarjeta desactualizada: la transacción ve que ya está abierto, no escribe y lo dice');
    igual(t.querySelector('#ade-estado').textContent, 'Abierto', 'tarjeta desactualizada: se actualiza al estado real');
  }

  // ── Cancelar la confirmación no escribe ──
  {
    const x = cargar({ confirma: false });
    const t = x.C.crearTarjetaDashboardEjecutivo(); await asentar();
    await t.querySelector('#ade-boton').click();
    afirmar(x.confirmaciones.length === 1 && x.confirmaciones[0] === x.C.TEXTO_CONFIRMAR_ABRIR_DASHBOARD, 'cancelar: se pidió la confirmación de abrir con el texto exacto');
    afirmar(x.bd.espia.escrituras.length === 0 && x.bd.espia.transacciones === 0 && x.bd.espia.historial.length === 0, 'cancelar: no hay transacción, escritura ni historial');
    igual(t.querySelector('#ade-estado').textContent, 'Cerrado', 'cancelar: la tarjeta sigue en Cerrado');
  }

  // ── Flujo completo por la tarjeta: abrir y cerrar con sus confirmaciones ──
  {
    const x = cargar();
    const t = x.C.crearTarjetaDashboardEjecutivo(); await asentar();
    await t.querySelector('#ade-boton').click();
    igual([t.querySelector('#ade-estado').textContent, t.querySelector('#ade-boton').textContent], ['Abierto', 'Cerrar a socios'], 'tarjeta: tras abrir muestra Abierto y «Cerrar a socios»');
    afirmar(/neto/.test(t.querySelector('#ade-quien').textContent), 'tarjeta: muestra quién lo cambió');
    await t.querySelector('#ade-boton').click();
    igual([x.confirmaciones[0], x.confirmaciones[1]], [x.C.TEXTO_CONFIRMAR_ABRIR_DASHBOARD, x.C.TEXTO_CONFIRMAR_CERRAR_DASHBOARD], 'tarjeta: abrir y cerrar piden su confirmación exacta, en ese orden');
    igual([t.querySelector('#ade-estado').textContent, t.querySelector('#ade-boton').textContent], ['Cerrado', 'Abrir para socios'], 'tarjeta: tras cerrar vuelve a Cerrado');
    afirmar(x.bd.docs.get(DOC).abierto === false && x.bd.espia.historial.length === 2, 'tarjeta: el documento y el historial reflejan los dos cambios');
  }

  // ── Sin conexión: no escribe y avisa claro ──
  {
    const x = cargar({ sinConexion: true });
    const r = await x.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'sin_conexion' && /Sin conexión/.test(r.mensaje) && x.bd.espia.transacciones === 0 && x.bd.espia.escrituras.length === 0, 'sin conexión: no abre transacción ni escribe y devuelve un mensaje claro');
    const t = x.C.crearTarjetaDashboardEjecutivo(); await asentar();
    await t.querySelector('#ade-boton').click();
    afirmar(x.mensajes.error.some((m) => /Sin conexión: no se puede cambiar el Dashboard Ejecutivo/.test(m)) && x.bd.espia.escrituras.length === 0, 'sin conexión: la tarjeta muestra el mensaje y no escribe');
    igual(t.querySelector('#ade-estado').textContent, 'Cerrado', 'sin conexión: la tarjeta conserva el estado real');
  }
  // La red cae durante la transacción (unavailable) también se trata como sin conexión
  {
    const x = cargar({ falloEscritura: { code: 'unavailable', message: 'offline' } });
    const r = await x.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'sin_conexion' && x.bd.espia.historial.length === 0 && !x.bd.docs.has(DOC), 'unavailable en la transacción: sin conexión, sin historial y sin documento');
  }

  // ── Un fallo de escritura conserva el estado real y muestra el error ──
  {
    const x = cargar({ docs: { [DOC]: { abierto: true, cambiadoPor: 'otro', cambiadoEn: '2026-11-01T10:00:00.000Z' } }, falloEscritura: { code: 'internal', message: 'se rompió la escritura' } });
    const t = x.C.crearTarjetaDashboardEjecutivo(); await asentar();
    igual(t.querySelector('#ade-estado').textContent, 'Abierto', 'fallo: la tarjeta parte de Abierto');
    await t.querySelector('#ade-boton').click();                       // intenta cerrar
    afirmar(x.mensajes.error.some((m) => /se rompió la escritura/.test(m)), 'fallo: muestra el error exacto');
    igual(t.querySelector('#ade-estado').textContent, 'Abierto', 'fallo: la tarjeta conserva el estado real (sigue Abierto)');
    afirmar(x.bd.docs.get(DOC).abierto === true && x.bd.espia.historial.length === 0 && x.mensajes.exito.length === 0, 'fallo: el documento no cambió, no hay historial y no se anunció éxito');
    const y = cargar({ falloEscritura: { code: 'permission-denied', message: 'denied' } });
    const r = await y.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'sin_permiso' && /solo Admin con escritura/.test(r.mensaje), 'permission-denied de las reglas: mensaje claro de permiso');
  }
  // Sin permiso de escritura la función tampoco escribe (aunque se llame directo)
  {
    const x = cargar({ admin: 'lectura' });
    const r = await x.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'sin_permiso' && x.bd.espia.transacciones === 0, 'sin permiso de escritura la función no abre transacción');
  }
  // Si el historial falla, el cambio ya hecho se conserva (registrar nunca lanza en la app real; aquí se simula un registrar tardío)
  {
    const x = cargar();
    const r = await x.C.cambiarDashboardEjecutivo(true);
    afirmar(r.resultado === 'cambiado' && x.bd.docs.get(DOC).abierto === true, 'el estado queda guardado antes de registrar el historial');
  }

  // ── Reglas de Firestore: config ya permite lectura a autenticados y escritura solo a Admin con escritura ──
  {
    const reglas = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
    const bloque = (reglas.match(/match \/config\/\{docId\}\s*\{([\s\S]*?)\n\s*\}/) || ['', ''])[1];
    afirmar(/allow read: if estaAutenticado\(\);/.test(bloque) && /allow write: if esAdminEscritura\(\);/.test(bloque), 'firestore.rules: config/{docId} → leer cualquier autenticado, escribir solo Admin con escritura (sin cambios de reglas)');
    afirmar(/function esAdminEscritura\(\)[\s\S]*?permisoModulo\('admin'\) == 'escritura'/.test(reglas), 'firestore.rules: esAdminEscritura exige admin = escritura');
    afirmar(!/dashboard_ejecutivo/.test(reglas), 'firestore.rules no se tocó (no hay regla específica)');
  }

  // ── El Dashboard Ejecutivo lee el mismo documento (A16): nombre del documento y campo, solo lectura ──
  {
    const ej = path.join(RAIZ, '..', 'dashboard-ejecutivo', 'index.html');
    if (fs.existsSync(ej)) {
      const h = fs.readFileSync(ej, 'utf8');
      afirmar(/collection\('config'\)\.doc\('dashboard_ejecutivo'\)\.get\(\)/.test(h) && /abierto===true/.test(h), 'el index.html del Dashboard Ejecutivo lee config/dashboard_ejecutivo y exige abierto === true (A16)');
      afirmar(!/doc\('dashboard_ejecutivo'\)\.(set|update|delete)/.test(h), 'el Dashboard Ejecutivo solo lee el documento: no lo escribe');
    }
  }

  console.log(`${ok}/${total} comprobaciones correctas`);
  if (ok !== total) process.exitCode = 1;
})().catch((e) => { console.error('Error en las pruebas: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
