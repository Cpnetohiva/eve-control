// Dashboard Ejecutivo (A16): el acceso de los socios lo decide el documento config/dashboard_ejecutivo (interruptor de EVE Control → Admin).
// Admin (CORREOS_PERMITIDOS) entra siempre sin consultarlo; cualquier otro usuario entra solo si DASHBOARD_PUBLICO es true o abierto === true;
// documento inexistente, error o valor distinto de true = cerrado. Se comprueba en arrancar, revisarSesionGuardada, el botón Actualizar y cargarYRender.
// Sin navegador: extracción por texto de dashboard-ejecutivo/index.html y vm, con un Firestore y un Auth falsos que espían las lecturas.
//
// Uso: node scripts/verificar-interruptor-dashboard-lectura.js [ruta/index.html] [ruta/respaldo-anterior]   (código de salida 1 si algo falla)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const RAIZ = path.join(__dirname, '..');
const CARPETA = path.join(RAIZ, '..', 'dashboard-ejecutivo');
const HTML_RUTA = path.resolve(process.argv[2] || path.join(CARPETA, 'index.html'));
let ok = 0, total = 0;
const afirmar = (c, m) => { total++; if (!c) { console.error('FALLA: ' + m); process.exitCode = 1; } else ok++; };
if (!fs.existsSync(HTML_RUTA)) { console.error('No existe ' + HTML_RUTA); process.exit(1); }
const html = fs.readFileSync(HTML_RUTA, 'utf8');

function buscarRespaldo() {
  if (process.argv[3]) return path.resolve(process.argv[3]);
  const nums = fs.readdirSync(CARPETA).map((f) => (f.match(/^index\.html\.bak(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  for (const n of nums) {
    const r = path.join(CARPETA, 'index.html.bak' + n);
    if (!/leerEstadoSocios/.test(fs.readFileSync(r, 'utf8'))) return r;
  }
  return null;
}
const extraer = (texto) => ({
  funcion(nombre) {
    const ini = texto.indexOf('function ' + nombre + '(');
    if (ini < 0) return '';
    let i = texto.indexOf('{', ini), nivel = 0;
    for (; i < texto.length; i++) {
      if (texto[i] === '{') nivel++;
      else if (texto[i] === '}' && --nivel === 0) return texto.slice(texto.lastIndexOf('async ', ini) === ini - 6 ? ini - 6 : ini, i + 1);
    }
    return '';
  },
  linea(n) { const m = texto.match(new RegExp('^(?:const|let) ' + n + '\\s*=.*$', 'm')); return m ? m[0] : ''; }
});

const MENSAJE = '🛠 En mantenimiento. Estamos validando las cifras del dashboard. Lo habilitaremos en cuanto sean confiables.';
const COLECCIONES = ['destaraje', 'cuentas_por_pagar', 'ventas', 'cuentas_por_cobrar', 'cobros', 'pagos', 'gastos', 'flujo_movimientos', 'proveedores', 'clientes'];

// ── Código del acceso, extraído por texto ──
const NOMBRES_FUNC = ['leerEstadoSocios', 'accesoPermitido', 'bloquearAcceso', 'revisarSesionGuardada', 'arrancar', 'cargarYRender'];
const NOMBRES_LINEA = ['SUFIJO_USUARIO', 'DASHBOARD_PUBLICO', 'CORREOS_PERMITIDOS', 'MSG_EN_REVISION', 'esCorreoAdmin', 'correoPermitido'];
function cargar(ruta, { publico, usuario, demo, interruptor, interruptorFalla, sesion, sinDb }) {
  const texto = fs.readFileSync(ruta, 'utf8');
  const { funcion, linea } = extraer(texto);
  const funcs = NOMBRES_FUNC.map(funcion), lineas = NOMBRES_LINEA.map(linea);
  const estado = { lecturasDoc: [], colecciones: [], signOut: 0, usuario: usuario ? { email: usuario } : null, render: 0, interruptor, interruptorFalla: !!interruptorFalla };
  const elementos = {};
  const el = (id) => elementos[id] || (elementos[id] = { style: {}, innerHTML: '', textContent: '', value: '' });
  const firestore = () => ({ collection: (n) => ({
    get() { estado.colecciones.push(n); return Promise.resolve({ docs: [] }); },
    doc(id) { return { get() { estado.lecturasDoc.push(n + '/' + id); if (estado.interruptorFalla) return Promise.reject(new Error('permission-denied')); const v = estado.interruptor; return Promise.resolve({ exists: v !== undefined, data: () => v }); } }; }
  }) });
  const errores = [];
  const auth = { get currentUser() { return estado.usuario; }, signOut() { estado.signOut++; estado.usuario = null; return Promise.resolve(); },
    onAuthStateChanged(cb) { Promise.resolve().then(() => cb(estado.usuario)); return () => {}; } };
  const ctx = { console: { log() {}, info() {}, warn() {}, error: (...a) => errores.push(a.map(String).join(' ')) }, $: el, firebase: { apps: [{}], initializeApp() {}, auth: () => auth, firestore },
    getCfg: () => ({ apiKey: 'x', projectId: 'p' }), demoData: () => ({}), COL_FALLAS: [], renderAll: () => { estado.render++; }, omitirLectura: () => false,
    COLS: Object.fromEntries(COLECCIONES.map((c) => [c, c])), Promise };
  vm.createContext(ctx);
  const dashPublico = `const DASHBOARD_PUBLICO = ${publico ? 'true' : 'false'};`;
  vm.runInContext(`
    ${lineas.map((l) => (/^const DASHBOARD_PUBLICO/.test(l) ? dashPublico : l)).join('\n')}
    let DB = null, DEMO = ${demo ? 'true' : 'false'}, db = ${sinDb || sesion !== undefined ? 'null' : 'firebase.firestore()'}, auth = firebase.auth(), charts = {};
    ${funcs.join('\n')}
    globalThis.api = { arrancar, cargarYRender, revisarSesionGuardada, leerEstadoSocios, accesoPermitido, setDb: (v) => { db = v; }, getDB: () => DB, getDEMO: () => DEMO,
      setAuthFalso: (a) => { auth = a; }, iniciarFirestore: () => { db = firebase.firestore(); }, leerSub: () => $('subTitle').textContent };
  `, ctx);
  if (sesion !== undefined) ctx.api.iniciarFirestore();   // pruebas directas de leerEstadoSocios: con db ya creado, como tras el login
  return { api: ctx.api, estado, el, errores, faltan: [...NOMBRES_FUNC.filter((n, i) => !funcs[i]), ...NOMBRES_LINEA.filter((n, i) => !lineas[i])] };
}
const esperar = () => new Promise((r) => setTimeout(r, 5));

(async () => {
  // ── 0. El HTML trae las piezas ──
  const base = cargar(HTML_RUTA, { publico: false, usuario: 'otro@everplastic.local', interruptor: { abierto: true } });
  afirmar(base.faltan.length === 0, 'el HTML trae leerEstadoSocios, accesoPermitido, bloquearAcceso, revisarSesionGuardada, arrancar, cargarYRender y las constantes de acceso (faltan: ' + base.faltan.join(', ') + ')');
  afirmar(/const DASHBOARD_PUBLICO = false;/.test(html), 'DASHBOARD_PUBLICO se conserva en false');
  afirmar(/const CORREOS_PERMITIDOS = \['admin@everplastic\.local'\];/.test(html), 'CORREOS_PERMITIDOS sigue siendo solo admin@everplastic.local');
  afirmar(extraer(html).linea('MSG_EN_REVISION').includes('En mantenimiento'), 'el mensaje al cerrar sigue siendo MSG_EN_REVISION');
  const textoLeer = extraer(html).funcion('leerEstadoSocios');
  afirmar(/\.collection\('config'\)\.doc\('dashboard_ejecutivo'\)\.get\(\)/.test(textoLeer) && !/collection\((?!'config')/.test(textoLeer), 'leerEstadoSocios lee ÚNICAMENTE config/dashboard_ejecutivo');
  afirmar(!/collection\(/.test(extraer(html).funcion('bloquearAcceso')), 'bloquearAcceso no lee ninguna colección');

  const U = { socio: 'otro@everplastic.local', admin: 'admin@everplastic.local' };

  // ── 1. leerEstadoSocios: solo abierto === true es true ──
  const casos = [[{ abierto: true, cambiadoPor: 'neto', cambiadoEn: 'x' }, true, 'abierto true'], [{ abierto: false }, false, 'abierto false'], [undefined, false, 'documento inexistente'],
    [{ abierto: 'true' }, false, 'abierto es la cadena "true"'], [{ abierto: 1 }, false, 'abierto = 1'], [{ abierto: null }, false, 'abierto null'], [{}, false, 'documento sin abierto'], [{ Abierto: true }, false, 'campo con otro nombre']];
  for (const [doc, esperado, nombre] of casos) {
    const x = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: doc, sesion: 1 });
    const r = await x.api.leerEstadoSocios();
    afirmar(r === esperado, `leerEstadoSocios: ${nombre} → ${esperado}`);
    afirmar(x.estado.lecturasDoc.join() === 'config/dashboard_ejecutivo' && x.estado.colecciones.length === 0, `leerEstadoSocios (${nombre}): solo lee el documento, ninguna colección`);
  }
  {
    const x = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptorFalla: true, sesion: 1 });
    afirmar((await x.api.leerEstadoSocios()) === false && x.errores.length === 1 && /dashboard_ejecutivo/.test(x.errores[0]), 'leerEstadoSocios: ante un error devuelve false y deja el error en consola');
    const sinDb = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: { abierto: true } });
    sinDb.api.setDb({ collection() { throw new Error('sin firestore'); } });
    afirmar((await sinDb.api.leerEstadoSocios()) === false, 'leerEstadoSocios: si Firestore lanza al leer, devuelve false');
  }

  // ── 2. arrancar (después del login) ──
  {
    const x = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: { abierto: true } });
    await x.api.arrancar();
    afirmar(x.el('app').style.display === 'block' && x.estado.signOut === 0 && x.estado.colecciones.length === COLECCIONES.length, 'arrancar: abierto=true deja entrar a un usuario no admin y lee sus colecciones');
    afirmar(x.estado.lecturasDoc.length === 1, 'arrancar: el documento se lee una sola vez (no otra más en cargarYRender)');
    afirmar(/Conectado/.test(x.el('subTitle').textContent), 'arrancar: muestra Conectado');
  }
  for (const [doc, nombre, falla] of [[{ abierto: false }, 'abierto=false'], [undefined, 'documento inexistente'], [undefined, 'error de lectura', true], [{ abierto: 'true' }, 'valor "true" (cadena)'], [{ abierto: 1 }, 'valor 1']]) {
    const x = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: doc, interruptorFalla: !!falla });
    await x.api.arrancar();
    afirmar(x.el('app').style.display === 'none' && x.el('login').style.display === '' && x.el('loginErr').textContent === MENSAJE, `arrancar: ${nombre} bloquea con el mensaje de mantenimiento`);
    afirmar(x.estado.signOut === 1 && x.estado.colecciones.length === 0 && x.estado.lecturasDoc.join() === 'config/dashboard_ejecutivo', `arrancar: ${nombre} cierra la sesión y no lee ninguna colección (solo el documento)`);
    afirmar(x.api.getDB() === null, `arrancar: ${nombre} deja DB vacío`);
  }
  // Admin: entra siempre, sin consultar el documento
  for (const [doc, nombre, falla] of [[{ abierto: false }, 'cerrado'], [undefined, 'inexistente'], [undefined, 'ilegible', true], [{ abierto: true }, 'abierto']]) {
    const x = cargar(HTML_RUTA, { publico: false, usuario: 'Admin@EverPlastic.LOCAL', interruptor: doc, interruptorFalla: !!falla });
    await x.api.arrancar();
    afirmar(x.el('app').style.display === 'block' && x.estado.signOut === 0 && x.estado.colecciones.length === COLECCIONES.length && x.estado.lecturasDoc.length === 0, `admin entra con el documento ${nombre} y no lo consulta (aunque el correo venga en mayúsculas)`);
  }
  // DASHBOARD_PUBLICO true: abre sin leer el documento
  {
    const x = cargar(HTML_RUTA, { publico: true, usuario: U.socio, interruptor: { abierto: false } });
    await x.api.arrancar();
    afirmar(x.el('app').style.display === 'block' && x.estado.lecturasDoc.length === 0 && x.estado.signOut === 0, 'DASHBOARD_PUBLICO=true: abre a cualquiera sin leer el documento (aunque esté cerrado)');
  }
  // Modo demo: mismo criterio (solo admin o abierto)
  {
    const d1 = cargar(HTML_RUTA, { publico: false, demo: true, usuario: U.socio, interruptor: { abierto: false } });
    await d1.api.arrancar();
    afirmar(d1.el('app').style.display === 'none' && d1.el('loginErr').textContent === MENSAJE && d1.estado.colecciones.length === 0, 'demo con el interruptor cerrado: bloqueado');
    const d2 = cargar(HTML_RUTA, { publico: false, demo: true, usuario: U.admin, interruptor: { abierto: false } });
    await d2.api.arrancar();
    afirmar(d2.el('app').style.display === 'none', 'demo: ni siquiera el correo admin lo abre por ser demo (sigue el criterio abierto o público)');
    const d3 = cargar(HTML_RUTA, { publico: false, demo: true, usuario: U.socio, interruptor: { abierto: true } });
    await d3.api.arrancar();
    afirmar(d3.el('app').style.display === 'block' && /MODO DEMO/.test(d3.el('subTitle').textContent) && d3.estado.colecciones.length === 0, 'demo con el interruptor abierto: entra con datos ficticios y sin leer colecciones');
    const d4 = cargar(HTML_RUTA, { publico: true, demo: true, usuario: null, interruptor: undefined });
    await d4.api.arrancar();
    afirmar(d4.el('app').style.display === 'block' && d4.estado.lecturasDoc.length === 0, 'demo con DASHBOARD_PUBLICO=true: entra sin leer el documento');
  }

  // ── 3. Sesión guardada (revisarSesionGuardada) ──
  {
    const cerrado = cargar(HTML_RUTA, { sinDb: true, publico: false, usuario: U.socio, interruptor: { abierto: false } });
    cerrado.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(cerrado.estado.signOut === 1 && cerrado.el('loginErr').textContent === MENSAJE && cerrado.estado.colecciones.length === 0 && cerrado.estado.lecturasDoc.join() === 'config/dashboard_ejecutivo', 'sesión guardada de un socio con el documento cerrado: se cierra al cargar, con el aviso y sin leer colecciones');
    const inexistente = cargar(HTML_RUTA, { publico: false, usuario: U.socio, sinDb: true, interruptor: undefined });
    inexistente.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(inexistente.estado.signOut === 1, 'sesión guardada de un socio sin documento: se cierra');
    const falla = cargar(HTML_RUTA, { publico: false, usuario: U.socio, sinDb: true, interruptorFalla: true });
    falla.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(falla.estado.signOut === 1, 'sesión guardada de un socio con el documento ilegible: se cierra');
    const abierto = cargar(HTML_RUTA, { sinDb: true, publico: false, usuario: U.socio, interruptor: { abierto: true } });
    abierto.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(abierto.estado.signOut === 0 && abierto.el('loginErr').textContent === '', 'sesión guardada de un socio con el documento abierto: no se toca');
    const admin = cargar(HTML_RUTA, { sinDb: true, publico: false, usuario: U.admin, interruptor: { abierto: false } });
    admin.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(admin.estado.signOut === 0 && admin.estado.lecturasDoc.length === 0, 'sesión guardada del admin: no se toca y no consulta el documento');
    const publico = cargar(HTML_RUTA, { sinDb: true, publico: true, usuario: U.socio, interruptor: { abierto: false } });
    publico.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(publico.estado.signOut === 0 && publico.estado.lecturasDoc.length === 0, 'sesión guardada con DASHBOARD_PUBLICO=true: no se toca y no consulta el documento');
    const sinSesion = cargar(HTML_RUTA, { sinDb: true, publico: false, usuario: null, interruptor: { abierto: false } });
    sinSesion.api.revisarSesionGuardada(); await esperar(); await esperar();
    afirmar(sinSesion.estado.signOut === 0 && sinSesion.estado.lecturasDoc.length === 0, 'sin sesión guardada: no hace nada');
  }

  // ── 4. Actualizar (cargarYRender) vuelve a leer el documento ──
  {
    const x = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: { abierto: true } });
    await x.api.arrancar();
    afirmar(x.estado.lecturasDoc.length === 1 && x.estado.colecciones.length === COLECCIONES.length, 'Actualizar (preparación): el socio entró con el documento abierto');
    x.estado.interruptor = { abierto: false }; x.estado.colecciones.length = 0;
    await x.api.cargarYRender();             // lo que hace el botón Actualizar: cargarYRender() sin argumentos
    afirmar(x.estado.lecturasDoc.length === 2, 'Actualizar vuelve a leer el documento');
    afirmar(x.el('app').style.display === 'none' && x.estado.signOut === 1 && x.el('loginErr').textContent === MENSAJE && x.estado.colecciones.length === 0, 'Actualizar con el documento ya cerrado: cierra al socio, muestra el aviso y no lee ninguna colección');
    const y = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: { abierto: true } });
    await y.api.arrancar(); y.estado.colecciones.length = 0;
    await y.api.cargarYRender();
    afirmar(y.estado.colecciones.length === COLECCIONES.length && y.estado.signOut === 0 && y.estado.lecturasDoc.length === 2, 'Actualizar con el documento todavía abierto: recarga los datos');
    const a = cargar(HTML_RUTA, { publico: false, usuario: U.admin, interruptor: { abierto: false } });
    await a.api.arrancar(); a.estado.colecciones.length = 0;
    await a.api.cargarYRender();
    afirmar(a.estado.colecciones.length === COLECCIONES.length && a.estado.lecturasDoc.length === 0 && a.estado.signOut === 0, 'Actualizar del admin: recarga sin consultar el documento');
    const p = cargar(HTML_RUTA, { publico: true, usuario: U.socio, interruptor: { abierto: false } });
    await p.api.arrancar(); p.estado.colecciones.length = 0;
    await p.api.cargarYRender();
    afirmar(p.estado.colecciones.length === COLECCIONES.length && p.estado.lecturasDoc.length === 0, 'Actualizar con DASHBOARD_PUBLICO=true: recarga sin consultar el documento');
    const ya = cargar(HTML_RUTA, { publico: false, usuario: U.socio, interruptor: { abierto: false } });
    await ya.api.cargarYRender(true);        // con el acceso ya comprobado (lo usa arrancar) no vuelve a leer el documento
    afirmar(ya.estado.lecturasDoc.length === 0, 'cargarYRender(true) no vuelve a leer el documento (arrancar ya lo comprobó)');
  }
  // El botón Actualizar sigue llamando a cargarYRender sin argumentos
  afirmar(/\$\('btnRef'\)\.onclick = \(\) ?=> ?cargarYRender\(\);/.test(html), 'el botón Actualizar llama a cargarYRender() sin saltarse la comprobación');

  // ── 5. calc() devuelve JSON idéntico a la versión anterior ──
  const rutaRespaldo = buscarRespaldo();
  if (!rutaRespaldo) console.log('Nota: no hay un respaldo index.html.bakNN anterior; se omite la comparación de calc().');
  else {
    const LINEAS = ['num', 'fmt\\$', 'fmt\\$2', 'fmtN', 'fmtPct', 'esc', 'iso', 'fdate', 'norm', 'MATERIALES_ALIAS', 'normMat', 'PROVEEDORES_SOCIOS', 'limpiaSocio', 'sum', 'MESES', 'MESES_L', 'UNIDAD_PZ', 'dayDiff', 'inP', 'INCLUIR_SOCIOS'];
    const FUNCS = ['esProveedorSocio', 'incluirSocios', 'grp', 'aging', 'calc'];
    const calculo = (ruta) => {
      const t = fs.readFileSync(ruta, 'utf8'); const { funcion, linea } = extraer(t);
      const ctx = { console: { warn() {}, info() {}, error() {}, log() {} }, localStorage: { getItem: () => null, removeItem() {} }, COL_FALLAS: [] };
      vm.createContext(ctx);
      vm.runInContext(`const HOY = '2026-11-10'; let DB = null, PER = {desde:'',hasta:'',label:''};\n${LINEAS.map(linea).filter((l) => !/^let INCLUIR/.test(l)).join('\n')}\nlet INCLUIR_SOCIOS=false;\n${FUNCS.map(funcion).join('\n')}\nglobalThis.api = { calc: (db, per) => { DB = db; PER = per; return calc(); }, setIncluir: (v) => { INCLUIR_SOCIOS = v; } };`, ctx);
      return ctx.api;
    };
    const datos = () => ({ cxp: [{ id: 'x1', ticket: '1001', proveedor: 'PROV A', material: 'P.P MOLIDO', kg: 700, total: 3500, saldo: 1500, fechaTicket: '2026-10-05', abonos: [{ monto: 2000, fecha: '2026-10-10' }] },
      { id: 'x2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 300, total: 1800, saldo: 1800, fechaTicket: '2026-10-06', abonos: [] }],
      cxc: [{ id: 'c1', folio: 'V-1', cliente: 'C1', fechaVenta: '2026-10-03', subtotal: 10000, total: 11600, ivaTrasladado: 1600, saldo: 5800, cobrado: 5800, abonos: [{ monto: 5800, fecha: '2026-10-20' }] }],
      ventas: [{ id: 'v1', folio: 'V-1', fecha: '2026-10-03', cliente: 'C1', lineas: [{ material: 'PET MOLIDO', cantidad: 1000, unidad: 'KG', precioUnitario: 10, subtotal: 10000, totalLinea: 11600 }] }],
      destaraje: [{ id: 'd1', ticket: '1001', proveedor: 'PROV A', material: 'P.P MOLIDO', kg: 700, fechaSalida: '2026-10-05' }, { id: 'd2', ticket: '1002', proveedor: 'GERMAN', material: 'PET', kg: 300, fechaSalida: '2026-10-06' }],
      cobros: [{ id: 'k1', cxcId: 'c1', cliente: 'C1', pagado: 5800, iva: 800, fecha: '2026-10-20', origen: 'cxc_cobro' }], pagos: [{ id: 'p1', proveedor: 'PROV A', pagado: 2000, fecha: '2026-10-10', origen: 'pago' }],
      gastos: [{ id: 'g1', fecha: '2026-10-12', concepto: 'Renta', montoBase: 700, tipoGasto: 'operativo' }], flujo: [{ id: 'm1', tipo: 'Aportación o préstamo', fecha: '2026-10-15', importe: 2000 }],
      precios: [], invIni: [], inv: [], prod: [], proveedores: [], clientes: [] });
    const a = calculo(HTML_RUTA), b = calculo(rutaRespaldo);
    [false, true].forEach((s) => ['2026-10', '2026-09', 'todo'].forEach((m) => {
      a.setIncluir(s); b.setIncluir(s);
      const per = m === 'todo' ? { desde: '0000-00-00', hasta: '9999-99-99', label: m } : { desde: m + '-01', hasta: m + '-31', label: m };
      const ra = a.calc(datos(), per), rb = b.calc(datos(), per);
      afirmar(JSON.stringify(ra) === JSON.stringify(rb) && Object.keys(ra).length > 40, `calc() devuelve JSON idéntico de ${Object.keys(ra).length} R.* contra ${path.basename(rutaRespaldo)} (${m}, socios ${s ? 'incluidos' : 'excluidos'})`);
    }));
  }

  console.log(`${ok}/${total} comprobaciones correctas`);
  if (ok !== total) process.exitCode = 1;
})().catch((e) => { console.error('Error en las pruebas: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
