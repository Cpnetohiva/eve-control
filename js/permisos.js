// Módulos cubiertos por el esquema de Roles (11: los 10 de ORDEN_TABS + admin).
const MODULOS_PERMISOS = [
  'destaraje', 'pagos', 'ventas', 'precios', 'rendimientos', 'cxp',
  'control_produccion', 'inventario', 'reportes', 'dashboard', 'admin'
];

// Misma lógica usada por la migración (TAREA 1.4) y como red de seguridad cuando
// un usuario aún no tiene rolId o el rol referenciado ya no existe (TAREA 1.5).
function resolverPermisosDesdeLegacy(permissions) {
  const permisos = {};
  MODULOS_PERMISOS.forEach((modulo) => {
    if (modulo === 'admin') return;
    permisos[modulo] = permissions && permissions[modulo] === true ? 'escritura' : 'ninguno';
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
window.puedeLeer = puedeLeer;
window.puedeEscribir = puedeEscribir;
window.tienePermisoExtra = tienePermisoExtra;
