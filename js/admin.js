(function () {

const SUBPESTANAS = [
  { id: 'usuarios', nombre: 'Usuarios' },
  { id: 'importar', nombre: 'Importar Datos' }
];

let subpestanaActiva = 'usuarios';

function renderizarSubpestana(contenedor) {
  contenedor.innerHTML = '';
  if (subpestanaActiva === 'usuarios') {
    contenedor.appendChild(window.EVE_ADMIN_USUARIOS.crearVistaUsuarios());
  } else if (subpestanaActiva === 'importar') {
    contenedor.appendChild(window.EVE_ADMIN_IMPORTAR.crearVistaImportar());
  }
}

function crearSubnav() {
  const nav = document.createElement('div');
  nav.className = 'tabs';
  SUBPESTANAS.forEach((sub) => {
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
  subpestanaActiva = 'usuarios';
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
