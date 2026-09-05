window.EVE = {
  currentUser: null,
  registrosDestaraje: [],
  registrosVentas: [],
  registrosPagos: [],
  registrosMinistraciones: [],
  registrosControlProduccion: [],
  precios: [],
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
  { permiso: 'controlProduccion', id: 'controlProduccion', nombre: 'Control Producción' },
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

function tabsVisiblesPorPermiso(permissions) {
  if (!permissions) return [];
  return ORDEN_TABS.filter((tab) => permissions[tab.permiso] === true);
}

function emailDesdeUsername(username) {
  return `${String(username).trim().toLowerCase()}${DOMINIO_AUTH}`;
}

window.clasificarDestaraje = clasificarDestaraje;
window.tabsVisiblesPorPermiso = tabsVisiblesPorPermiso;
window.emailDesdeUsername = emailDesdeUsername;

async function cargarDatosEnParalelo() {
  const [destarajeRaw, pagos, ministraciones, controlProduccion, precios, cuentasPorPagar, auditorias, proveedores, comisiones, auditoriaFotos, ventasNuevas, composiciones, inventario, inventarioInicial, configSistemaDoc] = await Promise.all([
    window.cargarDatos(window.COLECCIONES.DESTARAJE),
    window.cargarDatos(window.COLECCIONES.PAGOS),
    window.cargarDatos(window.COLECCIONES.MINISTRACIONES),
    window.cargarDatos(window.COLECCIONES.CONTROL_PRODUCCION),
    window.cargarDatos(window.COLECCIONES.PRECIOS),
    window.cargarDatos(window.COLECCIONES.CUENTAS_POR_PAGAR),
    window.cargarDatos(window.COLECCIONES.AUDITORIAS),
    window.cargarDatos(window.COLECCIONES.PROVEEDORES),
    window.cargarDatos(window.COLECCIONES.COMISIONES),
    window.cargarDatos(window.COLECCIONES.AUDITORIA_FOTOS),
    window.cargarDatos(window.COLECCIONES.VENTAS),
    window.cargarDatos(window.COLECCIONES.COMPOSICIONES),
    window.cargarDatos(window.COLECCIONES.INVENTARIO),
    window.cargarDatos(window.COLECCIONES.INVENTARIO_INICIAL),
    window.db.collection('config').doc('sistema').get()
  ]);
  const { destaraje, ventas } = clasificarDestaraje(destarajeRaw);
  window.EVE.registrosDestaraje = destaraje;
  window.EVE.registrosVentas = ventas;
  window.EVE.registrosPagos = pagos;
  window.EVE.registrosMinistraciones = ministraciones;
  window.EVE.registrosControlProduccion = controlProduccion;
  window.EVE.precios = precios;
  window.EVE.cuentasPorPagar = cuentasPorPagar;
  window.EVE.auditorias = auditorias;
  window.EVE.proveedores = proveedores;
  window.EVE.comisiones = comisiones;
  window.EVE.auditoriaFotos = auditoriaFotos;
  window.EVE.ventas = ventasNuevas;
  window.EVE.composiciones = composiciones;
  window.EVE.inventario = inventario;
  window.EVE.inventarioInicial = inventarioInicial;
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

function renderTabs(permissions) {
  const contenedor = document.getElementById('tabs-container');
  contenedor.innerHTML = '';
  const tabs = tabsVisiblesPorPermiso(permissions);
  tabs.forEach((tab, indice) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (indice === 0 ? ' active' : '');
    boton.textContent = tab.nombre;
    boton.dataset.modulo = tab.id;
    boton.addEventListener('click', () => activarTab(tab.id));
    contenedor.appendChild(boton);
  });
  document.getElementById('btn-admin').style.display = permissions && (permissions.admin || permissions.auditoria) ? '' : 'none';
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

async function establecerSesionActiva(usuario) {
  window.EVE.currentUser = usuario;
  await cargarDatosEnParalelo();
  mostrarAppShell();
  renderTabs(usuario.permissions);
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
