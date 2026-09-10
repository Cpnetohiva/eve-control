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
  inventario: [],
  inventarioInicial: [],
  comisionPorKg: 0.10,
  fechaCorteAuditoria: '2026-07-01',
  metaEficiencia: 90
};

window.EVE_MODULES = {};

const DOMINIO_AUTH = '@everplastic.local';
const ORDEN_TABS = [
  { permiso: 'destaraje', id: 'destaraje', nombre: 'Destaraje' },
  { permiso: 'pagos', id: 'pagos', nombre: 'Pagos' },
  { permiso: 'ventas', id: 'ventas', nombre: 'Ventas' },
  { permiso: 'precios', id: 'precios', nombre: 'Precios' },
  { permiso: 'rendimientos', id: 'rendimientos', nombre: 'Rendimientos' },
  { permiso: 'cxp', id: 'cxp', nombre: 'CxP' },
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
  return ORDEN_TABS.filter((tab) => permisosResueltos[tab.permiso] !== 'ninguno');
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
  { campo: 'proveedores', coleccion: window.COLECCIONES.PROVEEDORES, modulo: 'pagos' },
  { campo: 'comisiones', coleccion: window.COLECCIONES.COMISIONES, modulo: 'pagos' },
  { campo: 'auditoriaFotos', coleccion: window.COLECCIONES.AUDITORIA_FOTOS, modulo: 'cxp' },
  { campo: 'ventas', coleccion: window.COLECCIONES.VENTAS, modulo: 'ventas' },
  { campo: 'composiciones', coleccion: window.COLECCIONES.COMPOSICIONES, modulo: 'ventas' },
  { campo: 'inventario', coleccion: window.COLECCIONES.INVENTARIO, modulo: 'inventario' },
  { campo: 'inventarioInicial', coleccion: window.COLECCIONES.INVENTARIO_INICIAL, modulo: 'inventario' }
];

async function cargarDatosEnParalelo() {
  const resultados = await Promise.all(
    CARGAS_MODULO.map((carga) => (
      window.puedeLeer(carga.modulo) ? window.cargarDatos(carga.coleccion) : Promise.resolve([])
    ))
  );
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
  window.EVE.inventario = datos.inventario;
  window.EVE.inventarioInicial = datos.inventarioInicial;
  window.EVE.comisionPorKg = window.obtenerComisionVigente(window.obtenerFechaMexico());
  const configSistema = configSistemaDoc.exists ? configSistemaDoc.data() : {};
  window.EVE.fechaCorteAuditoria = configSistema.fechaCorteAuditoria || '2026-07-01';
  window.EVE.metaEficiencia = Number(configSistema.metaEficiencia) || 90;
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
  window.EVE.inventario = [];
  window.EVE.inventarioInicial = [];
  window.EVE.comisionPorKg = 0.10;
  window.EVE.fechaCorteAuditoria = '2026-07-01';
  window.EVE.metaEficiencia = 90;
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
