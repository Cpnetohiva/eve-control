(function () {

const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'importar', nombre: 'Importar Datos' },
  { id: 'backup', nombre: 'Backup' },
  { id: 'config', nombre: 'Configuración' },
  { id: 'datos', nombre: 'Gestión de Datos' },
  { id: 'auditoria', nombre: 'Auditoría' },
  { id: 'historial', nombre: 'Historial' }
];

let subpestanaActiva = 'usuarios';

function subpestanasVisibles() {
  const permissions = window.EVE.currentUser && window.EVE.currentUser.permissions;
  if (permissions && permissions.admin) return SUBPESTANAS;
  if (permissions && permissions.auditoria) return SUBPESTANAS.filter((sub) => sub.id === 'auditoria');
  return [];
}

function renderizarSubpestana(contenedor) {
  contenedor.innerHTML = '';
  if (subpestanaActiva === 'usuarios') {
    contenedor.appendChild(window.EVE_ADMIN_USUARIOS.crearVistaUsuarios());
  } else if (subpestanaActiva === 'importar') {
    contenedor.appendChild(window.EVE_ADMIN_IMPORTAR.crearVistaImportar());
  } else if (subpestanaActiva === 'backup') {
    contenedor.appendChild(window.EVE_ADMIN_BACKUP.crearVistaBackup());
  } else if (subpestanaActiva === 'config') {
    contenedor.appendChild(window.EVE_ADMIN_CONFIG.crearVistaConfig());
  } else if (subpestanaActiva === 'datos') {
    contenedor.appendChild(window.EVE_ADMIN_DATOS.crearVistaDatos());
  } else if (subpestanaActiva === 'auditoria') {
    contenedor.appendChild(window.EVE_ADMIN_AUDITORIA.crearVistaAuditoria());
  } else if (subpestanaActiva === 'historial') {
    contenedor.appendChild(window.EVE_HISTORIAL.crearVistaHistorial());
  }
}

function crearSubnav() {
  const nav = document.createElement('div');
  nav.className = 'tabs';
  subpestanasVisibles().forEach((sub) => {
    const boton = document.createElement('button');
    boton.className = 'tab' + (sub.id === subpestanaActiva ? ' active' : '');
    boton.textContent = sub.nombre;
    boton.dataset.subpestana = sub.id;
    boton.addEventListener('click', () => {
      subpestanaActiva = sub.id;
      nav.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.subpestana === sub.id));
      renderizarSubpestana(document.getElementById('admin-contenido'));
    });
    nav.appendChild(boton);
  });
  return nav;
}

function renderAdmin(container) {
  const visibles = subpestanasVisibles();
  subpestanaActiva = visibles.length > 0 ? visibles[0].id : 'usuarios';
  container.appendChild(crearSubnav());
  const contenido = document.createElement('div');
  contenido.id = 'admin-contenido';
  container.appendChild(contenido);
  renderizarSubpestana(contenido);
}

function mostrarPanelAdmin() {
  document.querySelectorAll('#tabs-container .tab').forEach((boton) => boton.classList.remove('active'));
  const contenedor = document.getElementById('main-content');
  contenedor.innerHTML = '';
  renderAdmin(contenedor);
}

window.EVE_ADMIN = {
  renderAdmin
};

document.getElementById('btn-admin').addEventListener('click', mostrarPanelAdmin);

})();
