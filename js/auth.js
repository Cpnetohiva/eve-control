window.EVE = {
  currentUser: null,
  registrosDestaraje: [],
  registrosVentas: [],
  registrosProduccion: [],
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
  comisionPorKg: 0.10,
  fechaCorteAuditoria: '2026-07-01',
  metaEficiencia: 90
};

window.EVE_MODULES = {};

const SESSION_KEY = 'eve_session';
const ORDEN_TABS = [
  { permiso: 'destaraje', id: 'destaraje', nombre: 'Destaraje' },
  { permiso: 'produccion', id: 'produccion', nombre: 'Producción' },
  { permiso: 'pagos', id: 'pagos', nombre: 'Pagos' },
  { permiso: 'ventas', id: 'ventas', nombre: 'Ventas' },
  { permiso: 'precios', id: 'precios', nombre: 'Precios' },
  { permiso: 'rendimientos', id: 'rendimientos', nombre: 'Rendimientos' },
  { permiso: 'cxp', id: 'cxp', nombre: 'CxP' },
  { permiso: 'controlProduccion', id: 'controlProduccion', nombre: 'Control Producción' },
  { permiso: 'inventario', id: 'inventario', nombre: 'Inventario' },
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
  const [destarajeRaw, produccion, pagos, ministraciones, controlProduccion, precios, cuentasPorPagar, auditorias, proveedores, comisiones, auditoriaFotos, ventasNuevas, composiciones, inventario, configSistemaDoc] = await Promise.all([
    window.cargarDatos(window.COLECCIONES.DESTARAJE),
    window.cargarDatos(window.COLECCIONES.PRODUCCION),
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
    window.db.collection('config').doc('sistema').get()
  ]);
  const { destaraje, ventas } = clasificarDestaraje(destarajeRaw);
  window.EVE.registrosDestaraje = destaraje;
  window.EVE.registrosVentas = ventas;
  window.EVE.registrosProduccion = produccion;
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
  window.EVE.precios = [];
  window.EVE.cuentasPorPagar = [];
  window.EVE.auditorias = [];
  window.EVE.proveedores = [];
  window.EVE.comisiones = [];
  window.EVE.auditoriaFotos = [];
  window.EVE.ventas = [];
  window.EVE.composiciones = [];
  window.EVE.inventario = [];
  window.EVE.comisionPorKg = 0.10;
  window.EVE.fechaCorteAuditoria = '2026-07-01';
  window.EVE.metaEficiencia = 90;
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
