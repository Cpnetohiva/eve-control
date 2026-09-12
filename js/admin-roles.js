(function () {

const MODULOS_ROL = [
  { clave: 'destaraje', nombre: 'Báscula' },
  { clave: 'pagos', nombre: 'Pagos' },
  { clave: 'ventas', nombre: 'Ventas' },
  { clave: 'precios', nombre: 'Precios' },
  { clave: 'rendimientos', nombre: 'Rendimientos' },
  { clave: 'cxp', nombre: 'CxP' },
  { clave: 'control_produccion', nombre: 'Control Producción' },
  { clave: 'inventario', nombre: 'Inventario' },
  { clave: 'reportes', nombre: 'Reportes' },
  { clave: 'dashboard', nombre: 'Dashboard' },
  { clave: 'admin', nombre: 'Admin' }
];

const NOMBRE_ROL_SIN_ACCESO = 'Sin acceso';

let rolesCargados = [];
let usuariosCargados = [];
let editandoId = null;

async function cargarRolesYUsuarios() {
  const [roles, usuarios] = await Promise.all([
    window.cargarDatos(window.COLECCIONES.ROLES),
    window.cargarDatos(window.COLECCIONES.USERS)
  ]);
  rolesCargados = roles;
  usuariosCargados = usuarios;
}

// Garantiza que siempre exista un rol "Sin acceso" (todos los módulos en 'ninguno')
// para poder preseleccionarlo como default seguro al crear usuarios nuevos.
async function asegurarRolSinAcceso() {
  const existe = rolesCargados.some((r) => r.nombre === NOMBRE_ROL_SIN_ACCESO);
  if (existe) return;
  const permisos = {};
  MODULOS_ROL.forEach((m) => { permisos[m.clave] = 'ninguno'; });
  await window.db.collection(window.COLECCIONES.ROLES).add({
    nombre: NOMBRE_ROL_SIN_ACCESO,
    permisos,
    permisosExtra: { ventas_precios: false, cxp_reportes: false },
    activo: true,
    creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
    actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
  });
  rolesCargados = await window.cargarDatos(window.COLECCIONES.ROLES);
}

function usuariosActivosDelRol(rolId) {
  return usuariosCargados.filter((u) => u.rolId === rolId && u.active === true);
}

function resumenPermisos(rol) {
  const niveles = MODULOS_ROL.map((m) => (rol.permisos && rol.permisos[m.clave]) || 'ninguno');
  const escritura = niveles.filter((n) => n === 'escritura').length;
  const lectura = niveles.filter((n) => n === 'lectura').length;
  return `${escritura} escritura, ${lectura} lectura`;
}

// Reescribe el permisosResueltos denormalizado en cada usuario con este rolId,
// paginado en lotes de 500 (límite de un batch de Firestore).
async function sincronizarPermisosResueltosDeRol(rolId, permisosResueltos) {
  const snapshot = await window.db.collection(window.COLECCIONES.USERS).where('rolId', '==', rolId).get();
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const lote = docs.slice(i, i + 500);
    const batch = window.db.batch();
    lote.forEach((doc) => batch.update(doc.ref, { permisosResueltos }));
    await batch.commit();
  }
}

function renderizarTablaRoles() {
  const cuerpo = document.getElementById('admin-roles-tabla-body');
  if (!cuerpo) return;
  cuerpo.innerHTML = '';
  rolesCargados.forEach((rol) => {
    const fila = document.createElement('tr');

    const celdaNombre = document.createElement('td');
    celdaNombre.textContent = rol.nombre;

    const celdaResumen = document.createElement('td');
    celdaResumen.textContent = resumenPermisos(rol);

    const celdaActivo = document.createElement('td');
    celdaActivo.textContent = rol.activo ? '✓' : '✗';

    const celdaAcciones = document.createElement('td');
    const grupo = document.createElement('div');
    grupo.className = 'admin-usuarios-acciones';
    const botonEditar = document.createElement('button');
    botonEditar.type = 'button';
    botonEditar.textContent = 'Editar';
    botonEditar.className = 'btn-secondary';
    botonEditar.addEventListener('click', () => abrirModalRol(rol));
    const botonToggle = document.createElement('button');
    botonToggle.type = 'button';
    botonToggle.textContent = rol.activo ? 'Desactivar' : 'Activar';
    botonToggle.className = 'btn-secondary';
    botonToggle.addEventListener('click', () => manejarToggleActivoRol(rol));
    grupo.appendChild(botonEditar);
    grupo.appendChild(botonToggle);
    celdaAcciones.appendChild(grupo);

    fila.appendChild(celdaNombre);
    fila.appendChild(celdaResumen);
    fila.appendChild(celdaActivo);
    fila.appendChild(celdaAcciones);
    cuerpo.appendChild(fila);
  });
}

async function manejarToggleActivoRol(rol) {
  if (rol.activo) {
    const afectados = usuariosActivosDelRol(rol.id);
    if (afectados.length > 0) {
      const nombres = afectados.map((u) => u.username).join(', ');
      window.showError(`No se puede desactivar: ${afectados.length} usuario(s) activo(s) con este rol (${nombres}). Reasígnalos primero.`);
      return;
    }
  }
  if (!confirm(`¿${rol.activo ? 'Desactivar' : 'Activar'} el rol "${rol.nombre}"?`)) return;
  try {
    await window.actualizarDato(window.COLECCIONES.ROLES, rol.id, {
      activo: !rol.activo,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    await cargarRolesYUsuarios();
    renderizarTablaRoles();
    window.showSuccess(rol.activo ? 'Rol desactivado' : 'Rol activado');
  } catch (error) {
    window.showError(error.message);
  }
}

function construirSelectsModulos(rol) {
  return MODULOS_ROL.map((m) => {
    const valorActual = rol && rol.permisos ? rol.permisos[m.clave] : 'ninguno';
    const opciones = ['ninguno', 'lectura', 'escritura']
      .map((nivel) => `<option value="${nivel}"${nivel === valorActual ? ' selected' : ''}>${nivel}</option>`)
      .join('');
    return `<label class="admin-roles-modulo">${m.nombre}<select id="ar-modulo-${m.clave}">${opciones}</select></label>`;
  }).join('');
}

function crearModalRol() {
  const overlay = document.createElement('div');
  overlay.id = 'admin-roles-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3 id="ar-modal-titulo">Nuevo Rol</h3>
      <form id="admin-roles-form">
        <input type="text" id="ar-nombre" placeholder="Nombre del rol" required>
        <div class="admin-roles-modulos">${construirSelectsModulos(null)}</div>
        <label class="admin-usuarios-permiso"><input type="checkbox" id="ar-extra-ventas-precios"> Ventas - Ver Precios</label>
        <label class="admin-usuarios-permiso"><input type="checkbox" id="ar-extra-cxp-reportes"> CxP Reportes</label>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="ar-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#admin-roles-form').addEventListener('submit', manejarEnvioFormularioRol);
  overlay.querySelector('#ar-cancelar').addEventListener('click', cerrarModalRol);
  return overlay;
}

function abrirModalRol(rol) {
  editandoId = rol ? rol.id : null;
  document.getElementById('ar-modal-titulo').textContent = rol ? `Editar Rol: ${rol.nombre}` : 'Nuevo Rol';
  document.getElementById('ar-nombre').value = rol ? rol.nombre : '';
  MODULOS_ROL.forEach((m) => {
    document.getElementById(`ar-modulo-${m.clave}`).value = rol && rol.permisos ? (rol.permisos[m.clave] || 'ninguno') : 'ninguno';
  });
  document.getElementById('ar-extra-ventas-precios').checked = !!(rol && rol.permisosExtra && rol.permisosExtra.ventas_precios);
  document.getElementById('ar-extra-cxp-reportes').checked = !!(rol && rol.permisosExtra && rol.permisosExtra.cxp_reportes);
  document.getElementById('admin-roles-modal-overlay').classList.add('open');
}

function cerrarModalRol() {
  document.getElementById('admin-roles-modal-overlay').classList.remove('open');
  editandoId = null;
}

async function manejarEnvioFormularioRol(evento) {
  evento.preventDefault();
  const nombre = document.getElementById('ar-nombre').value.trim();
  if (!nombre) { window.showError('El nombre del rol es obligatorio'); return; }
  const duplicado = rolesCargados.some((r) => r.nombre === nombre && r.id !== editandoId);
  if (duplicado) { window.showError('Ya existe un rol con ese nombre'); return; }

  const permisos = {};
  MODULOS_ROL.forEach((m) => {
    permisos[m.clave] = document.getElementById(`ar-modulo-${m.clave}`).value;
  });
  const permisosExtra = {
    ventas_precios: document.getElementById('ar-extra-ventas-precios').checked === true,
    cxp_reportes: document.getElementById('ar-extra-cxp-reportes').checked === true
  };

  try {
    if (editandoId) {
      await window.actualizarDato(window.COLECCIONES.ROLES, editandoId, {
        nombre,
        permisos,
        permisosExtra,
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      await sincronizarPermisosResueltosDeRol(editandoId, { ...permisos, permisosExtra });
    } else {
      await window.db.collection(window.COLECCIONES.ROLES).add({
        nombre,
        permisos,
        permisosExtra,
        activo: true,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
    }
    cerrarModalRol();
    await cargarRolesYUsuarios();
    renderizarTablaRoles();
    window.showSuccess('Rol guardado');
  } catch (error) {
    window.showError(error.message);
  }
}

// ===== Migración de usuarios existentes (TAREA 1.4) =====

function firmaPermisosLegacy(permissions) {
  const claves = window.EVE_ADMIN_USUARIOS.PERMISOS_DISPLAY.map((p) => p.clave);
  return claves.map((clave) => ((permissions && permissions[clave] === true) ? '1' : '0')).join('');
}

// Solo agrupa usuarios que todavía no tienen rolId asignado (no toca a los ya migrados).
function agruparUsuariosPorFirma(usuarios) {
  const grupos = new Map();
  usuarios.filter((u) => !u.rolId).forEach((usuario) => {
    const firma = firmaPermisosLegacy(usuario.permissions);
    if (!grupos.has(firma)) grupos.set(firma, []);
    grupos.get(firma).push(usuario);
  });
  return Array.from(grupos.values()).map((usuariosDelGrupo, indice) => ({
    nombrePropuesto: `Rol migrado ${indice + 1}`,
    usuarios: usuariosDelGrupo,
    permisos: window.resolverPermisosDesdeLegacy(usuariosDelGrupo[0].permissions)
  }));
}

async function ejecutarMigracion(grupos) {
  for (const grupo of grupos) {
    const { permisosExtra, ...permisos } = grupo.permisos;
    const rolRef = await window.db.collection(window.COLECCIONES.ROLES).add({
      nombre: grupo.nombrePropuesto,
      permisos,
      permisosExtra,
      activo: true,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    const permisosResueltos = { ...permisos, permisosExtra };
    for (let i = 0; i < grupo.usuarios.length; i += 500) {
      const lote = grupo.usuarios.slice(i, i + 500);
      const batch = window.db.batch();
      lote.forEach((usuario) => {
        batch.update(window.db.collection(window.COLECCIONES.USERS).doc(usuario.id), {
          rolId: rolRef.id,
          permisosResueltos
        });
      });
      await batch.commit();
    }
  }
}

function renderizarVistaPreviaMigracion(contenedor, grupos) {
  contenedor.innerHTML = '';
  if (grupos.length === 0) {
    contenedor.innerHTML = '<p>No hay usuarios sin rol asignado pendientes de migrar.</p>';
    return;
  }
  const totalUsuarios = grupos.reduce((acc, g) => acc + g.usuarios.length, 0);
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead><tr><th>Rol propuesto</th><th>Usuarios</th><th>Módulos en escritura</th></tr></thead>
    <tbody>${grupos.map((g) => `
      <tr>
        <td>${g.nombrePropuesto}</td>
        <td>${g.usuarios.map((u) => u.username).join(', ')} (${g.usuarios.length})</td>
        <td>${MODULOS_ROL.filter((m) => g.permisos[m.clave] === 'escritura').map((m) => m.nombre).join(', ') || 'Ninguno'}</td>
      </tr>
    `).join('')}</tbody>
  `;
  const botonConfirmar = document.createElement('button');
  botonConfirmar.type = 'button';
  botonConfirmar.className = 'btn-primary';
  botonConfirmar.textContent = `Confirmar y crear ${grupos.length} rol(es) para ${totalUsuarios} usuario(s)`;
  botonConfirmar.addEventListener('click', async () => {
    if (!confirm(`Esto creará ${grupos.length} rol(es) nuevo(s) y asignará rolId a ${totalUsuarios} usuario(s). No se borra el campo "permissions" existente. ¿Continuar?`)) return;
    botonConfirmar.disabled = true;
    try {
      await ejecutarMigracion(grupos);
      contenedor.innerHTML = '';
      await cargarRolesYUsuarios();
      renderizarTablaRoles();
      window.showSuccess(`Migración completada: ${totalUsuarios} usuario(s) migrado(s)`);
    } catch (error) {
      window.showError(error.message);
      botonConfirmar.disabled = false;
    }
  });
  contenedor.appendChild(tabla);
  contenedor.appendChild(botonConfirmar);
}

function manejarGenerarMigracion(contenedorPreview) {
  const grupos = agruparUsuariosPorFirma(usuariosCargados);
  renderizarVistaPreviaMigracion(contenedorPreview, grupos);
}

function crearVistaRoles() {
  const wrapper = document.createElement('div');
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-usuarios';
  tarjeta.innerHTML = `
    <div class="admin-usuarios-header">
      <h3>Roles</h3>
      <div class="admin-usuarios-acciones">
        <button type="button" id="admin-roles-migrar" class="btn-secondary">Generar roles desde permisos actuales</button>
        <button type="button" id="admin-roles-nuevo" class="btn-primary">+ Nuevo Rol</button>
      </div>
    </div>
    <div class="destaraje-tabla-wrapper">
      <table class="tabla-destaraje">
        <thead><tr><th>Nombre</th><th>Resumen</th><th>Activo</th><th>Acciones</th></tr></thead>
        <tbody id="admin-roles-tabla-body"></tbody>
      </table>
    </div>
    <div id="admin-roles-preview-migracion"></div>
  `;
  tarjeta.querySelector('#admin-roles-nuevo').addEventListener('click', () => abrirModalRol(null));
  tarjeta.querySelector('#admin-roles-migrar').addEventListener('click', () => {
    manejarGenerarMigracion(tarjeta.querySelector('#admin-roles-preview-migracion'));
  });
  wrapper.appendChild(tarjeta);
  wrapper.appendChild(crearModalRol());
  (async () => {
    await cargarRolesYUsuarios();
    await asegurarRolSinAcceso();
    renderizarTablaRoles();
  })();
  return wrapper;
}

window.EVE_ADMIN_ROLES = {
  crearVistaRoles
};

})();
