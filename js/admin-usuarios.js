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

})();
