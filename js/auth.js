const SEGUNDOS_POR_PIEZA_PZ_DEFAULT = {
  TAMBO: 210, 'CAJA CO30': 58, 'CAJA CH25': 45, 'CAJA AGRO20': 37, ORING: null, SELLO: null, TAPON: null
};

window.EVE = {
  currentUser: null,
  registrosDestaraje: [],
  registrosVentas: [],
  registrosPagos: [],
  registrosMinistraciones: [],
  registrosControlProduccion: [],
  precios: [],
  ajustesPrecioProveedor: [],
  cuentasPorPagar: [],
  auditorias: [],
  proveedores: [],
  comisiones: [],
  auditoriaFotos: [],
  ventas: [],
  composiciones: [],
  cuentasPorCobrar: [],
  cobros: [],
  gastos: [],
  inventario: [],
  inventarioInicial: [],
  comisionPorKg: 0.10,
  fechaCorteAuditoria: '2026-07-01',
  metaEficiencia: 90,
  segundosPorPiezaPZ: SEGUNDOS_POR_PIEZA_PZ_DEFAULT
};

window.EVE_MODULES = {};

const DOMINIO_AUTH = '@everplastic.local';
const ORDEN_TABS = [
  { permiso: 'destaraje', id: 'destaraje', nombre: 'Báscula' },
  { permiso: 'pagos', id: 'pagos', nombre: 'Pagos' },
  { permiso: 'ventas', id: 'ventas', nombre: 'Ventas' },
  { permiso: 'precios', id: 'precios', nombre: 'Precios' },
  { permiso: 'rendimientos', id: 'rendimientos', nombre: 'Rendimientos' },
  { permiso: 'cxp', id: 'cxp', nombre: 'CxP' },
  { permiso: ['cxp', 'pagos'], id: 'recibosPago', nombre: 'Recibos de Pago' },
  { permiso: 'ventas', id: 'cxc', nombre: 'CxC' },
  { permiso: 'ventas', id: 'cobros', nombre: 'Cobros' },
  { permiso: 'gastos', id: 'gastos', nombre: 'Gastos' },
  { permiso: 'control_produccion', id: 'controlProduccion', nombre: 'Control Producción' },
  { permiso: 'inventario', id: 'inventario', nombre: 'Inventario' },
  { permiso: 'reportes', id: 'reportes', nombre: 'Reportes' },
  { permiso: 'dashboard', id: 'dashboard', nombre: 'Dashboard' }
];

function clasificarDestaraje(registros) {
  const destaraje = [];
  const ventas = [];
  for (const registro of registros) {
    const ticket = String(registro.ticket ?? '');
    if (/^\d+$/.test(ticket)) {
      destaraje.push(registro);
    } else if (ticket.toUpperCase() === 'V') {
      ventas.push(registro);
    }
  }
  return { destaraje, ventas };
}

function tabsVisiblesPorPermiso(permisosResueltos) {
  if (!permisosResueltos) return [];
  return ORDEN_TABS.filter((tab) => {
    const permisos = Array.isArray(tab.permiso) ? tab.permiso : [tab.permiso];
    // Whitelist (igual que puedeLeer en js/permisos.js), no blacklist de 'ninguno':
    // un módulo sin key en permisosResueltos (ej. gastos sin re-sincronizar el rol
    // tras agregarse) debe ocultarse, no mostrarse por default.
    return permisos.some((permiso) => permisosResueltos[permiso] === 'lectura' || permisosResueltos[permiso] === 'escritura');
  });
}

function emailDesdeUsername(username) {
  return `${String(username).trim().toLowerCase()}${DOMINIO_AUTH}`;
}

window.clasificarDestaraje = clasificarDestaraje;
window.tabsVisiblesPorPermiso = tabsVisiblesPorPermiso;
window.emailDesdeUsername = emailDesdeUsername;

// Cada colección se gatea por el permiso del módulo que la controla en firestore.rules
// (ver docs/superpowers/plans/2026-09-08-roles-permisos-firestore.md, sección 3.3).
// Si el usuario no tiene lectura de ese módulo, ni siquiera se intenta el get() —
// evita que un solo permiso denegado tumbe el Promise.all completo y cierre la sesión.
const CARGAS_MODULO = [
  { campo: 'registrosDestarajeRaw', coleccion: window.COLECCIONES.DESTARAJE, modulo: 'destaraje' },
  { campo: 'registrosPagos', coleccion: window.COLECCIONES.PAGOS, modulo: 'pagos' },
  { campo: 'registrosMinistraciones', coleccion: window.COLECCIONES.MINISTRACIONES, modulo: 'pagos' },
  { campo: 'registrosControlProduccion', coleccion: window.COLECCIONES.CONTROL_PRODUCCION, modulo: 'control_produccion' },
  { campo: 'precios', coleccion: window.COLECCIONES.PRECIOS, modulo: 'precios' },
  { campo: 'ajustesPrecioProveedor', coleccion: window.COLECCIONES.AJUSTES_PRECIO_PROVEEDOR, modulo: 'precios' },
  { campo: 'cuentasPorPagar', coleccion: window.COLECCIONES.CUENTAS_POR_PAGAR, modulo: 'cxp' },
  { campo: 'auditorias', coleccion: window.COLECCIONES.AUDITORIAS, modulo: 'cxp' },
  { campo: 'proveedores', coleccion: window.COLECCIONES.PROVEEDORES, modulo: 'cxp' },
  { campo: 'comisiones', coleccion: window.COLECCIONES.COMISIONES, modulo: 'cxp' },
  { campo: 'auditoriaFotos', coleccion: window.COLECCIONES.AUDITORIA_FOTOS, modulo: 'cxp' },
  { campo: 'ventas', coleccion: window.COLECCIONES.VENTAS, modulo: 'ventas' },
  { campo: 'composiciones', coleccion: window.COLECCIONES.COMPOSICIONES, modulo: 'ventas' },
  { campo: 'cuentasPorCobrar', coleccion: window.COLECCIONES.CUENTAS_POR_COBRAR, modulo: 'ventas' },
  { campo: 'cobros', coleccion: window.COLECCIONES.COBROS, modulo: 'ventas' },
  { campo: 'gastos', coleccion: window.COLECCIONES.GASTOS, modulo: 'gastos' },
  { campo: 'inventario', coleccion: window.COLECCIONES.INVENTARIO, modulo: 'inventario' },
  { campo: 'inventarioInicial', coleccion: window.COLECCIONES.INVENTARIO_INICIAL, modulo: 'inventario' }
];

async function cargarDatosEnParalelo() {
  // Promise.allSettled (no Promise.all): si el usuario SÍ tiene permiso y se
  // intenta la lectura pero esta falla (p. ej. una regla de Firestore aún no
  // desplegada para esa colección), esa colección específica se degrada a []
  // en vez de tumbar el login completo. El camino de "sin permiso" ya resolvía
  // a Promise.resolve([]) y sigue igual, sin pasar nunca por rejected.
  const resultadosSettled = await Promise.allSettled(
    CARGAS_MODULO.map((carga) => (
      window.puedeLeer(carga.modulo) ? window.cargarDatos(carga.coleccion) : Promise.resolve([])
    ))
  );
  const resultados = resultadosSettled.map((resultado, indice) => {
    if (resultado.status === 'fulfilled') return resultado.value;
    const carga = CARGAS_MODULO[indice];
    console.warn(`[cargarDatosEnParalelo] Falló la carga de "${carga.coleccion}" (módulo "${carga.modulo}"):`, resultado.reason);
    window.showError(`No se pudo cargar el módulo "${carga.modulo}". Repórtalo a soporte.`);
    return [];
  });
  // config/sistema es de lectura libre para cualquier usuario autenticado (ver firestore.rules).
  const configSistemaDoc = await window.db.collection('config').doc('sistema').get();

  const datos = {};
  CARGAS_MODULO.forEach((carga, indice) => { datos[carga.campo] = resultados[indice]; });

  const { destaraje, ventas } = clasificarDestaraje(datos.registrosDestarajeRaw);
  window.EVE.registrosDestaraje = destaraje;
  window.EVE.registrosVentas = ventas;
  window.EVE.registrosPagos = datos.registrosPagos;
  window.EVE.registrosMinistraciones = datos.registrosMinistraciones;
  window.EVE.registrosControlProduccion = datos.registrosControlProduccion;
  window.EVE.precios = datos.precios;
  window.EVE.ajustesPrecioProveedor = datos.ajustesPrecioProveedor;
  window.EVE.cuentasPorPagar = datos.cuentasPorPagar;
  window.EVE.auditorias = datos.auditorias;
  window.EVE.proveedores = datos.proveedores;
  window.EVE.comisiones = datos.comisiones;
  window.EVE.auditoriaFotos = datos.auditoriaFotos;
  window.EVE.ventas = datos.ventas;
  window.EVE.composiciones = datos.composiciones;
  window.EVE.cuentasPorCobrar = datos.cuentasPorCobrar;
  window.EVE.cobros = datos.cobros;
  window.EVE.gastos = datos.gastos;
  window.EVE.inventario = datos.inventario;
  window.EVE.inventarioInicial = datos.inventarioInicial;
  window.EVE.comisionPorKg = window.obtenerComisionVigente(window.obtenerFechaMexico());
  const configSistema = configSistemaDoc.exists ? configSistemaDoc.data() : {};
  window.EVE.fechaCorteAuditoria = configSistema.fechaCorteAuditoria || '2026-07-01';
  window.EVE.metaEficiencia = Number(configSistema.metaEficiencia) || 90;
  window.EVE.segundosPorPiezaPZ = configSistema.segundosPorPiezaPZ || SEGUNDOS_POR_PIEZA_PZ_DEFAULT;
}

function renderModulo(moduloId) {
  const contenedor = document.getElementById('main-content');
  contenedor.innerHTML = '';
  const modulo = window.EVE_MODULES[moduloId];
  if (modulo && typeof modulo.render === 'function') {
    modulo.render(contenedor);
  } else {
    const mensaje = document.createElement('p');
    mensaje.textContent = 'Módulo en construcción';
    contenedor.appendChild(mensaje);
  }
}

function activarTab(moduloId) {
  document.querySelectorAll('#tabs-container .tab').forEach((boton) => {
    boton.classList.toggle('active', boton.dataset.modulo === moduloId);
  });
  renderModulo(moduloId);
}

function renderTabs(permisosResueltos) {
  const contenedor = document.getElementById('tabs-container');
  contenedor.innerHTML = '';
  const tabs = tabsVisiblesPorPermiso(permisosResueltos);
  tabs.forEach((tab, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = tab.nombre;
    boton.dataset.modulo = tab.id;
    boton.addEventListener('click', () => activarTab(tab.id));
    contenedor.appendChild(boton);
  });
  document.getElementById('btn-admin').style.display = permisosResueltos && permisosResueltos.admin !== 'ninguno' ? '' : 'none';
  if (tabs.length > 0) activarTab(tabs[0].id);
}

function mostrarAppShell() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').classList.add('visible');
}

function mostrarLoginScreen() {
  document.getElementById('app-shell').classList.remove('visible');
  document.getElementById('login-screen').style.display = '';
}

function limpiarEstadoLocal() {
  window.EVE.currentUser = null;
  window.EVE.registrosDestaraje = [];
  window.EVE.registrosVentas = [];
  window.EVE.registrosPagos = [];
  window.EVE.registrosMinistraciones = [];
  window.EVE.registrosControlProduccion = [];
  window.EVE.precios = [];
  window.EVE.ajustesPrecioProveedor = [];
  window.EVE.cuentasPorPagar = [];
  window.EVE.auditorias = [];
  window.EVE.proveedores = [];
  window.EVE.comisiones = [];
  window.EVE.auditoriaFotos = [];
  window.EVE.ventas = [];
  window.EVE.composiciones = [];
  window.EVE.cuentasPorCobrar = [];
  window.EVE.cobros = [];
  window.EVE.inventario = [];
  window.EVE.inventarioInicial = [];
  window.EVE.comisionPorKg = 0.10;
  window.EVE.fechaCorteAuditoria = '2026-07-01';
  window.EVE.metaEficiencia = 90;
  window.EVE.segundosPorPiezaPZ = SEGUNDOS_POR_PIEZA_PZ_DEFAULT;
}

function resolverPermisosUsuario(usuario) {
  // usuario.permisosResueltos ya viene denormalizado en el doc de users/{uid}
  // (sincronizarPermisosResueltosDeRol lo mantiene al día en cada edición de rol).
  // No se lee roles/{rolId} aquí: firestore.rules solo permite ese read a
  // esAdminEscritura(), así que leerlo en el login tumbaría a cualquier no-admin.
  if (usuario.permisosResueltos) {
    return usuario.permisosResueltos;
  }
  // Red de seguridad: usuario migrado sin permisosResueltos todavía.
  return window.resolverPermisosDesdeLegacy(usuario.permissions);
}

async function establecerSesionActiva(usuario) {
  usuario.permisosResueltos = resolverPermisosUsuario(usuario);
  window.EVE.currentUser = usuario;
  await cargarDatosEnParalelo();
  mostrarAppShell();
  renderTabs(usuario.permisosResueltos);
}

async function iniciarSesion(username, password) {
  const email = emailDesdeUsername(username);
  try {
    await firebase.auth().signInWithEmailAndPassword(email, password);
  } catch (error) {
    if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(error.code)) {
      throw new Error('Usuario o contraseña incorrectos');
    }
    throw new Error(error.message);
  }
  // El resto del flujo (cargar permisos, mostrar app-shell) lo maneja onAuthStateChanged.
}

function cerrarSesion() {
  firebase.auth().signOut();
}

const DEVICE_CHECK_URL = 'https://eve-control-worker.cpnetohiva.workers.dev/device-check';
const DEVICE_CHECK_SECRET = '75fbe5a9-84ec-4456-82b8-80d1fe91efd7';
const DEVICE_CHECK_TIMEOUT_MS = 5000;

function obtenerTokenDispositivo() {
  let token = localStorage.getItem('eve_device_token');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('eve_device_token', token);
  }
  return token;
}

// Candado de dispositivos: consulta al Worker si este uid+dispositivo puede
// continuar. Fail-open deliberado — un fallo del propio chequeo (red, Worker
// caído, timeout) NUNCA debe bloquear un login legítimo.
async function verificarDispositivo(uid) {
  try {
    const token = obtenerTokenDispositivo();

    let fingerprint = null;
    try {
      const fp = await FingerprintJS.load();
      const resultado = await fp.get();
      fingerprint = resultado.visitorId;
    } catch (errorFingerprint) {
      console.warn('[verificarDispositivo] No se pudo obtener el fingerprint:', errorFingerprint);
    }

    const controlador = new AbortController();
    const timeoutId = setTimeout(() => controlador.abort(), DEVICE_CHECK_TIMEOUT_MS);
    let respuesta;
    try {
      respuesta = await fetch(DEVICE_CHECK_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-device-check-secret': DEVICE_CHECK_SECRET
        },
        body: JSON.stringify({ uid, token, fingerprint, userAgent: navigator.userAgent }),
        signal: controlador.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (respuesta.status === 403) {
      return {
        allowed: false,
        mensaje: 'Este usuario ya tiene el número máximo de dispositivos registrados. Contacta al administrador para liberar uno.'
      };
    }

    const datos = await respuesta.json();
    if (respuesta.ok && datos.allowed === true) {
      return { allowed: true };
    }

    console.warn('[verificarDispositivo] Respuesta inesperada del Worker:', respuesta.status, datos);
    return { allowed: true, fallback: true };
  } catch (error) {
    console.warn('[verificarDispositivo] Error al verificar dispositivo, se permite por fallback:', error);
    return { allowed: true, fallback: true };
  }
}

// Firebase Auth restaura la sesión de forma asíncrona: ocultamos el login de inmediato
// para evitar un parpadeo, y dejamos que onAuthStateChanged decida qué pantalla mostrar.
document.getElementById('login-screen').style.display = 'none';

firebase.auth().onAuthStateChanged(async (authUser) => {
  const errorDiv = document.getElementById('login-error');
  if (!authUser) {
    limpiarEstadoLocal();
    mostrarLoginScreen();
    return;
  }
  // A partir de aquí ningún read está condicionado a un permiso que el usuario
  // pueda no tener: el propio doc de users es siempre legible por su dueño, y
  // cargarDatosEnParalelo ya filtra por puedeLeer() antes de pedir cada colección.
  // Si este catch se dispara, es un error real de auth/perfil, no un permiso esperado.
  try {
    const usuarioDoc = await window.db.collection(window.COLECCIONES.USERS).doc(authUser.uid).get();
    if (!usuarioDoc.exists) {
      throw new Error('No existe un perfil en Firestore para este usuario. Contacta al administrador.');
    }
    const usuario = { id: usuarioDoc.id, ...usuarioDoc.data() };
    if (usuario.active !== true) {
      throw new Error('Usuario desactivado. Contacta al administrador.');
    }
    const chequeoDispositivo = await verificarDispositivo(authUser.uid);
    if (!chequeoDispositivo.allowed) {
      throw new Error(chequeoDispositivo.mensaje);
    }
    await establecerSesionActiva(usuario);
  } catch (error) {
    errorDiv.textContent = error.message;
    await firebase.auth().signOut();
    limpiarEstadoLocal();
    mostrarLoginScreen();
  }
});

document.getElementById('login-form').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  errorDiv.textContent = '';
  try {
    await iniciarSesion(username, password);
  } catch (error) {
    errorDiv.textContent = error.message;
  }
});

document.getElementById('btn-salir').addEventListener('click', cerrarSesion);
