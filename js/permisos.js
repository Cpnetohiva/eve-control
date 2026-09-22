// Módulos cubiertos por el esquema de Roles (12: los 11 de ORDEN_TABS + admin).
const MODULOS_PERMISOS = [
  'destaraje', 'pagos', 'ventas', 'precios', 'rendimientos', 'cxp',
  'control_produccion', 'inventario', 'reportes', 'dashboard', 'gastos', 'admin'
];

// Claves legacy que no coinciden con el nombre canónico del módulo (ver PERMISOS_DISPLAY
// en admin-usuarios.js). Solo control_produccion difiere: los datos existentes de
// usuarios usan 'controlProduccion' (camelCase).
const CLAVES_LEGACY = {
  control_produccion: 'controlProduccion'
};

// Misma lógica usada por la migración (TAREA 1.4) y como red de seguridad cuando
// un usuario aún no tiene rolId o el rol referenciado ya no existe (TAREA 1.5).
function resolverPermisosDesdeLegacy(permissions) {
  const permisos = {};
  MODULOS_PERMISOS.forEach((modulo) => {
    if (modulo === 'admin') return;
    const claveLegacy = CLAVES_LEGACY[modulo] || modulo;
    permisos[modulo] = permissions && permissions[claveLegacy] === true ? 'escritura' : 'ninguno';
  });
  if (permissions && permissions.admin === true) {
    permisos.admin = 'escritura';
  } else if (permissions && permissions.auditoria === true) {
    permisos.admin = 'lectura';
  } else {
    permisos.admin = 'ninguno';
  }
  permisos.permisosExtra = {
    ventas_precios: !!(permissions && permissions.ventas_precios === true),
    cxp_reportes: !!(permissions && permissions.cxp_reportes === true)
  };
  return permisos;
}

// Misma forma que resolverPermisosDesdeLegacy, pero a partir de un doc de roles/{rolId}.
// La comparten admin-roles.js (al guardar un rol) y admin-usuarios.js (al asignarle
// un rol a un usuario) para no duplicar el cálculo del permisosResueltos denormalizado.
function calcularPermisosResueltosDesdeRol(rol) {
  const permisos = {};
  MODULOS_PERMISOS.forEach((modulo) => {
    permisos[modulo] = (rol && rol.permisos && rol.permisos[modulo]) || 'ninguno';
  });
  permisos.permisosExtra = {
    ventas_precios: !!(rol && rol.permisosExtra && rol.permisosExtra.ventas_precios),
    cxp_reportes: !!(rol && rol.permisosExtra && rol.permisosExtra.cxp_reportes)
  };
  return permisos;
}

function puedeLeer(modulo) {
  const permisosResueltos = window.EVE.currentUser && window.EVE.currentUser.permisosResueltos;
  if (!permisosResueltos) return false;
  return permisosResueltos[modulo] === 'lectura' || permisosResueltos[modulo] === 'escritura';
}

function puedeEscribir(modulo) {
  const permisosResueltos = window.EVE.currentUser && window.EVE.currentUser.permisosResueltos;
  if (!permisosResueltos) return false;
  return permisosResueltos[modulo] === 'escritura';
}

function tienePermisoExtra(clave) {
  const permisosResueltos = window.EVE.currentUser && window.EVE.currentUser.permisosResueltos;
  return !!(permisosResueltos && permisosResueltos.permisosExtra && permisosResueltos.permisosExtra[clave] === true);
}

window.EVE_MODULOS_PERMISOS = MODULOS_PERMISOS;
window.resolverPermisosDesdeLegacy = resolverPermisosDesdeLegacy;
window.calcularPermisosResueltosDesdeRol = calcularPermisosResueltosDesdeRol;
window.puedeLeer = puedeLeer;
window.puedeEscribir = puedeEscribir;
window.tienePermisoExtra = tienePermisoExtra;
