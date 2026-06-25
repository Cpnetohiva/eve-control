(function () {

const PERMISOS_DISPLAY = [
  { clave: 'destaraje', nombre: 'Destaraje' },
  { clave: 'produccion', nombre: 'Producción' },
  { clave: 'pagos', nombre: 'Pagos' },
  { clave: 'controlProduccion', nombre: 'Control Producción' },
  { clave: 'reportes', nombre: 'Reportes' },
  { clave: 'admin', nombre: 'Admin' }
];

function listarNombresPermisos(permissions) {
  if (!permissions) return [];
  return PERMISOS_DISPLAY.filter((p) => permissions[p.clave] === true).map((p) => p.nombre);
}

function validarUsername(username, usuarios, idExcluir) {
  const limpio = (username || '').trim();
  if (!limpio) return 'El nombre de usuario es obligatorio';
  const duplicado = usuarios.some((u) => u.username === limpio && u.id !== idExcluir);
  if (duplicado) return 'Ya existe un usuario con ese nombre';
  return null;
}

function validarPassword(password, esEdicion) {
  if (!esEdicion && (!password || password.length === 0)) {
    return 'La contraseña es obligatoria para crear un usuario';
  }
  return null;
}

function construirPayloadUsuario(datos, esEdicion) {
  const payload = {
    username: datos.username.trim(),
    permissions: { ...datos.permissions },
    active: datos.active === true
  };
  if (!esEdicion || (datos.password && datos.password.length > 0)) {
    payload.password = datos.password;
  }
  return payload;
}

function esUsuarioActual(usuario, currentUserId) {
  return usuario.id === currentUserId;
}

window.EVE_ADMIN_USUARIOS = {
  PERMISOS_DISPLAY,
  listarNombresPermisos,
  validarUsername,
  validarPassword,
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
        <input type="password" id="au-password" placeholder="Password">
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
  document.getElementById('au-modal-titulo').textContent = usuario ? 'Editar Usuario' : 'Nuevo Usuario';
  document.getElementById('au-username').value = usuario ? usuario.username : '';
  const passwordInput = document.getElementById('au-password');
  passwordInput.value = '';
  passwordInput.placeholder = usuario ? 'Dejar vacío para no cambiar' : 'Password';
  PERMISOS_DISPLAY.forEach((p) => {
    const checkbox = document.getElementById(`au-permiso-${p.clave}`);
    checkbox.checked = usuario ? usuario.permissions[p.clave] === true : false;
    checkbox.disabled = false;
  });
  document.getElementById('au-activo').checked = usuario ? usuario.active === true : true;
  if (usuario && esUsuarioActual(usuario, window.EVE.currentUser.id)) {
    document.getElementById('au-permiso-admin').disabled = true;
  }
  document.getElementById('admin-usuarios-modal-overlay').classList.add('open');
}

function cerrarModalUsuario() {
  document.getElementById('admin-usuarios-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function manejarEnvioFormulario(evento) {
  evento.preventDefault();
  const username = document.getElementById('au-username').value;
  const password = document.getElementById('au-password').value;
  const esEdicion = editandoId !== null;

  const errorUsername = validarUsername(username, usuariosCargados, editandoId);
  if (errorUsername) { window.showError(errorUsername); return; }
  const errorPassword = validarPassword(password, esEdicion);
  if (errorPassword) { window.showError(errorPassword); return; }

  const permissions = {};
  PERMISOS_DISPLAY.forEach((p) => {
    permissions[p.clave] = document.getElementById(`au-permiso-${p.clave}`).checked === true;
  });
  const payload = construirPayloadUsuario({
    username,
    password,
    permissions,
    active: document.getElementById('au-activo').checked === true
  }, esEdicion);

  try {
    if (esEdicion) {
      await window.actualizarDato(window.COLECCIONES.USERS, editandoId, payload);
    } else {
      await window.guardarDato(window.COLECCIONES.USERS, payload);
    }
    cerrarModalUsuario();
    await cargarUsuarios();
    window.showSuccess(esEdicion ? 'Usuario actualizado' : 'Usuario creado');
  } catch (error) {
    window.showError(error.message);
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
