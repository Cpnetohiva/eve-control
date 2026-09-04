(function () {

const PERMISOS_DISPLAY = [
  { clave: 'destaraje', nombre: 'Destaraje' },
  { clave: 'pagos', nombre: 'Pagos' },
  { clave: 'ventas', nombre: 'Ventas' },
  { clave: 'ventas_precios', nombre: 'Ventas - Ver Precios' },
  { clave: 'controlProduccion', nombre: 'Control Producción' },
  { clave: 'precios', nombre: 'Precios' },
  { clave: 'rendimientos', nombre: 'Rendimientos' },
  { clave: 'rendimientos_editar', nombre: 'Rendimientos - Editar' },
  { clave: 'cxp', nombre: 'CxP' },
  { clave: 'cxp_reportes', nombre: 'CxP Reportes' },
  { clave: 'inventario', nombre: 'Inventario' },
  { clave: 'inventario_ajuste', nombre: 'Inventario - Ajuste Manual' },
  { clave: 'reportes', nombre: 'Reportes' },
  { clave: 'auditoria', nombre: 'Auditoría' },
  { clave: 'admin', nombre: 'Admin' }
];

function listarNombresPermisos(permissions) {
  if (!permissions) return [];
  return PERMISOS_DISPLAY.filter((p) => permissions[p.clave] === true).map((p) => p.nombre);
}

function construirPayloadUsuario(datos) {
  return {
    permissions: { ...datos.permissions },
    active: datos.active === true
  };
}

function esUsuarioActual(usuario, currentUserId) {
  return usuario.id === currentUserId;
}

function validarUsername(username, usuarios) {
  const limpio = (username || '').trim();
  if (!limpio) return 'El nombre de usuario es obligatorio';
  const duplicado = usuarios.some((u) => u.username === limpio);
  if (duplicado) return 'Ya existe un usuario con ese nombre';
  return null;
}

function validarPassword(password) {
  if (!password || password.length < 6) return 'La contraseña debe tener al menos 6 caracteres';
  return null;
}

function mensajeErrorCreacion(error) {
  const mensajes = {
    'auth/email-already-in-use': 'Ya existe una cuenta con ese nombre de usuario',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    'auth/invalid-email': 'Nombre de usuario inválido'
  };
  return mensajes[error.code] || error.message;
}

async function obtenerAppSecundaria() {
  const existente = firebase.apps.find((app) => app.name === 'Secondary');
  if (existente) await existente.delete();
  return firebase.initializeApp(window.firebaseConfig, 'Secondary');
}

// Crea la cuenta en Firebase Auth desde una app secundaria para no cerrar la sesión
// del admin logueado en la app principal, luego escribe el doc en Firestore con la
// sesión principal (así el doc queda escrito por el admin, no por el usuario nuevo).
async function crearUsuarioNuevo(username, password, permissions, active) {
  const usernameLimpio = username.trim();
  const email = window.emailDesdeUsername(usernameLimpio);
  const secondaryApp = await obtenerAppSecundaria();
  try {
    const credenciales = await secondaryApp.auth().createUserWithEmailAndPassword(email, password);
    const uid = credenciales.user.uid;
    await secondaryApp.auth().signOut();
    await window.db.collection(window.COLECCIONES.USERS).doc(uid).set({
      username: usernameLimpio,
      email,
      authUid: uid,
      permissions,
      active
    });
    return uid;
  } finally {
    await secondaryApp.delete();
  }
}

window.EVE_ADMIN_USUARIOS = {
  PERMISOS_DISPLAY,
  listarNombresPermisos,
  construirPayloadUsuario,
  esUsuarioActual
};

let usuariosCargados = [];
let editandoId = null;

async function cargarUsuarios() {
  usuariosCargados = await window.cargarDatos(window.COLECCIONES.USERS);
  renderizarTabla();
}

function renderizarTabla() {
  const cuerpo = document.getElementById('admin-usuarios-tabla-body');
  if (!cuerpo) return;
  cuerpo.innerHTML = '';
  usuariosCargados.forEach((usuario) => {
    const fila = document.createElement('tr');
    fila.dataset.userId = usuario.id;

    const celdaUsername = document.createElement('td');
    celdaUsername.textContent = usuario.username;

    const celdaPermisos = document.createElement('td');
    const nombres = listarNombresPermisos(usuario.permissions);
    celdaPermisos.textContent = nombres.length > 0 ? nombres.join(', ') : 'Ninguno';

    const celdaActivo = document.createElement('td');
    celdaActivo.textContent = usuario.active ? '✓' : '✗';

    const celdaAcciones = document.createElement('td');
    const grupoAcciones = document.createElement('div');
    grupoAcciones.className = 'admin-usuarios-acciones';
    const botonEditar = document.createElement('button');
    botonEditar.type = 'button';
    botonEditar.textContent = 'Editar';
    botonEditar.className = 'btn-secondary';
    botonEditar.addEventListener('click', () => abrirModalUsuario(usuario));
    const botonToggle = document.createElement('button');
    botonToggle.type = 'button';
    botonToggle.textContent = usuario.active ? 'Desactivar' : 'Activar';
    botonToggle.className = 'btn-secondary';
    botonToggle.disabled = esUsuarioActual(usuario, window.EVE.currentUser.id);
    botonToggle.addEventListener('click', () => manejarToggleActivo(usuario));
    grupoAcciones.appendChild(botonEditar);
    grupoAcciones.appendChild(botonToggle);
    celdaAcciones.appendChild(grupoAcciones);

    fila.appendChild(celdaUsername);
    fila.appendChild(celdaPermisos);
    fila.appendChild(celdaActivo);
    fila.appendChild(celdaAcciones);
    cuerpo.appendChild(fila);
  });
}

async function manejarToggleActivo(usuario) {
  const accion = usuario.active ? 'Desactivar' : 'Activar';
  if (!confirm(`¿${accion} a ${usuario.username}?`)) return;
  try {
    await window.actualizarDato(window.COLECCIONES.USERS, usuario.id, { active: !usuario.active });
    await cargarUsuarios();
    window.showSuccess(usuario.active ? 'Usuario desactivado' : 'Usuario activado');
  } catch (error) {
    window.showError(error.message);
  }
}

function construirCheckboxesPermisos() {
  return PERMISOS_DISPLAY
    .map((p) => `<label class="admin-usuarios-permiso"><input type="checkbox" id="au-permiso-${p.clave}"> ${p.nombre}</label>`)
    .join('');
}

function crearModalUsuario() {
  const overlay = document.createElement('div');
  overlay.id = 'admin-usuarios-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3 id="au-modal-titulo">Nuevo Usuario</h3>
      <form id="admin-usuarios-form">
        <input type="text" id="au-username" placeholder="Username" required>
        <div id="au-password-grupo">
          <input type="password" id="au-password" placeholder="Password (mínimo 6 caracteres)">
        </div>
        <div class="admin-usuarios-permisos">${construirCheckboxesPermisos()}</div>
        <label class="admin-usuarios-permiso"><input type="checkbox" id="au-activo" checked> Activo</label>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="au-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#admin-usuarios-form').addEventListener('submit', manejarEnvioFormulario);
  overlay.querySelector('#au-cancelar').addEventListener('click', cerrarModalUsuario);
  return overlay;
}

function abrirModalUsuario(usuario) {
  editandoId = usuario ? usuario.id : null;
  document.getElementById('au-modal-titulo').textContent = usuario ? `Editar Usuario: ${usuario.username}` : 'Nuevo Usuario';
  const usernameInput = document.getElementById('au-username');
  usernameInput.value = usuario ? usuario.username : '';
  usernameInput.disabled = !!usuario;
  document.getElementById('au-password-grupo').style.display = usuario ? 'none' : '';
  document.getElementById('au-password').value = '';
  PERMISOS_DISPLAY.forEach((p) => {
    const checkbox = document.getElementById(`au-permiso-${p.clave}`);
    checkbox.checked = usuario ? usuario.permissions[p.clave] === true : false;
    checkbox.disabled = false;
  });
  const activoCheckbox = document.getElementById('au-activo');
  activoCheckbox.checked = usuario ? usuario.active === true : true;
  activoCheckbox.disabled = false;
  if (usuario && esUsuarioActual(usuario, window.EVE.currentUser.id)) {
    document.getElementById('au-permiso-admin').disabled = true;
    activoCheckbox.disabled = true;
  }
  document.getElementById('admin-usuarios-modal-overlay').classList.add('open');
}

function cerrarModalUsuario() {
  document.getElementById('admin-usuarios-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const esEdicion = editandoId !== null;

  const permissions = {};
  PERMISOS_DISPLAY.forEach((p) => {
    permissions[p.clave] = document.getElementById(`au-permiso-${p.clave}`).checked === true;
  });
  const active = document.getElementById('au-activo').checked === true;

  if (esEdicion) {
    const payload = construirPayloadUsuario({ permissions, active });
    try {
      await window.actualizarDato(window.COLECCIONES.USERS, editandoId, payload);
      cerrarModalUsuario();
      await cargarUsuarios();
      window.showSuccess('Usuario actualizado');
    } catch (error) {
      window.showError(error.message);
    }
    return;
  }

  const username = document.getElementById('au-username').value;
  const password = document.getElementById('au-password').value;
  const errorUsername = validarUsername(username, usuariosCargados);
  if (errorUsername) { window.showError(errorUsername); return; }
  const errorPassword = validarPassword(password);
  if (errorPassword) { window.showError(errorPassword); return; }

  try {
    await crearUsuarioNuevo(username, password, permissions, active);
    cerrarModalUsuario();
    await cargarUsuarios();
    window.showSuccess('Usuario creado');
  } catch (error) {
    window.showError(mensajeErrorCreacion(error));
  }
}

function crearVistaUsuarios() {
  const wrapper = document.createElement('div');
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-usuarios';
  tarjeta.innerHTML = `
    <div class="admin-usuarios-header">
      <h3>Usuarios</h3>
      <button type="button" id="admin-usuarios-nuevo" class="btn-primary">+ Nuevo Usuario</button>
    </div>
    <div class="destaraje-tabla-wrapper">
      <table class="tabla-destaraje">
        <thead><tr><th>Username</th><th>Permisos</th><th>Activo</th><th>Acciones</th></tr></thead>
        <tbody id="admin-usuarios-tabla-body"></tbody>
      </table>
    </div>
  `;
  tarjeta.querySelector('#admin-usuarios-nuevo').addEventListener('click', () => abrirModalUsuario(null));
  wrapper.appendChild(tarjeta);
  wrapper.appendChild(crearModalUsuario());
  cargarUsuarios();
  return wrapper;
}

Object.assign(window.EVE_ADMIN_USUARIOS, {
  crearVistaUsuarios
});

})();
