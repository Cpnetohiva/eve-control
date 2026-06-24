window.EVE = {
  currentUser: null,
  registrosDestaraje: [],
  registrosVentas: [],
  registrosProduccion: [],
  registrosPagos: [],
  registrosMinistraciones: [],
  registrosControlProduccion: []
};

window.EVE_MODULES = {};

const SESSION_KEY = 'eve_session';
const ORDEN_TABS = [
  { permiso: 'destaraje', id: 'destaraje', nombre: 'Destaraje' },
  { permiso: 'produccion', id: 'produccion', nombre: 'Producción' },
  { permiso: 'pagos', id: 'pagos', nombre: 'Pagos' },
  { permiso: 'controlProduccion', id: 'controlProduccion', nombre: 'Control Producción' },
  { permiso: 'reportes', id: 'reportes', nombre: 'Reportes' }
];

function clasificarDestaraje(registros) {
  const destaraje = [];
  const ventas = [];
  for (const registro of registros) {
    const ticket = String(registro.ticket ?? '');
    if (/^\d+$/.test(ticket)) {
      destaraje.push(registro);
    } else if (ticket === 'V') {
      ventas.push(registro);
    }
  }
  return { destaraje, ventas };
}

function tabsVisiblesPorPermiso(permissions) {
  if (!permissions) return [];
  return ORDEN_TABS.filter((tab) => permissions[tab.permiso] === true);
}

window.clasificarDestaraje = clasificarDestaraje;
window.tabsVisiblesPorPermiso = tabsVisiblesPorPermiso;

async function cargarDatosEnParalelo() {
  const [destarajeRaw, produccion, pagos, ministraciones, controlProduccion] = await Promise.all([
    window.cargarDatos(window.COLECCIONES.DESTARAJE),
    window.cargarDatos(window.COLECCIONES.PRODUCCION),
    window.cargarDatos(window.COLECCIONES.PAGOS),
    window.cargarDatos(window.COLECCIONES.MINISTRACIONES),
    window.cargarDatos(window.COLECCIONES.CONTROL_PRODUCCION)
  ]);
  const { destaraje, ventas } = clasificarDestaraje(destarajeRaw);
  window.EVE.registrosDestaraje = destaraje;
  window.EVE.registrosVentas = ventas;
  window.EVE.registrosProduccion = produccion;
  window.EVE.registrosPagos = pagos;
  window.EVE.registrosMinistraciones = ministraciones;
  window.EVE.registrosControlProduccion = controlProduccion;
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
  document.getElementById('btn-admin').style.display = permissions && permissions.admin ? '' : 'none';
  if (tabs.length > 0) activarTab(tabs[0].id);
}

function mostrarAppShell() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').classList.add('visible');
}

function mostrarLoginScreen() {
  document.getElementById('app-shell').classList.remove('visible');
  document.getElementById('login-screen').style.display = '';
  document.getElementById('login-error').textContent = '';
}

async function establecerSesionActiva(usuario) {
  window.EVE.currentUser = usuario;
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    userId: usuario.id,
    username: usuario.username,
    permissions: usuario.permissions
  }));
  await cargarDatosEnParalelo();
  mostrarAppShell();
  renderTabs(usuario.permissions);
}

async function iniciarSesion(username, password) {
  const usuarios = await window.cargarDatos(window.COLECCIONES.USERS);
  const usuario = usuarios.find((u) => u.username === username && u.password === password);
  if (!usuario) {
    throw new Error('Usuario o contraseña incorrectos');
  }
  if (usuario.active !== true) {
    throw new Error('Usuario desactivado. Contacta al administrador.');
  }
  await establecerSesionActiva(usuario);
}

function cerrarSesion() {
  localStorage.removeItem(SESSION_KEY);
  window.EVE.currentUser = null;
  window.EVE.registrosDestaraje = [];
  window.EVE.registrosVentas = [];
  window.EVE.registrosProduccion = [];
  window.EVE.registrosPagos = [];
  window.EVE.registrosMinistraciones = [];
  window.EVE.registrosControlProduccion = [];
  mostrarLoginScreen();
}

async function intentarAutoLogin() {
  const guardada = localStorage.getItem(SESSION_KEY);
  if (!guardada) return;
  document.getElementById('login-screen').style.display = 'none';
  try {
    const sesion = JSON.parse(guardada);
    const usuarios = await window.cargarDatos(window.COLECCIONES.USERS);
    const usuario = usuarios.find((u) => u.id === sesion.userId);
    if (!usuario || usuario.active !== true) {
      throw new Error('Sesión inválida');
    }
    await establecerSesionActiva(usuario);
  } catch {
    localStorage.removeItem(SESSION_KEY);
    mostrarLoginScreen();
  }
}

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

intentarAutoLogin();
