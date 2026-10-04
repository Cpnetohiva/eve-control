(function () {

// Navegación de módulos en grupos. Recibe las pestañas YA filtradas por permiso (tabsVisiblesPorPermiso, js/auth.js: patrón
// whitelist 'lectura' | 'escritura'), así que aquí no se decide ningún permiso: un grupo existe solo si le queda algún
// módulo visible. El grupo de cada módulo se declara en ORDEN_TABS (campo `grupo`); el orden dentro de un grupo es el de
// ORDEN_TABS. Dos modos, elegidos por dispositivo en localStorage: 'filas' (grupos arriba, módulos del grupo activo abajo)
// y 'desplegable' (grupos en una fila; cada uno abre un menú con sus módulos).

const GRUPOS_NAV = [
  { id: 'compras', nombre: 'Compras' },
  { id: 'ventas', nombre: 'Ventas' },
  { id: 'planta', nombre: 'Planta' },
  { id: 'finanzas', nombre: 'Finanzas' }
];
// Red de seguridad: un módulo con `grupo` ausente o desconocido no desaparece de la barra, cae en este grupo.
const GRUPO_OTROS = { id: 'otros', nombre: 'Otros' };

const CLAVE_MODO = 'eve-nav-modo';
const CLAVE_ULTIMOS = 'eve-nav-ultimo-por-grupo';
const MODO_FILAS = 'filas';
const MODO_DESPLEGABLE = 'desplegable';

function leerAlmacen(clave) {
  try { return window.localStorage.getItem(clave); } catch (error) { return null; }
}

function escribirAlmacen(clave, valor) {
  try { window.localStorage.setItem(clave, valor); } catch (error) { /* modo privado o cuota: se sigue sin recordar */ }
}

function obtenerModo() {
  return leerAlmacen(CLAVE_MODO) === MODO_DESPLEGABLE ? MODO_DESPLEGABLE : MODO_FILAS;
}

function leerUltimos() {
  try {
    const datos = JSON.parse(leerAlmacen(CLAVE_ULTIMOS) || '{}');
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
  } catch (error) {
    return {};
  }
}

// Agrupa las pestañas visibles: devuelve [{ id, nombre, tabs }] en el orden de GRUPOS_NAV, sin los grupos vacíos.
function agruparTabs(tabs) {
  const conocidos = new Set(GRUPOS_NAV.map((g) => g.id));
  const grupos = GRUPOS_NAV.map((g) => ({ ...g, tabs: tabs.filter((t) => t.grupo === g.id) }));
  const sueltas = tabs.filter((t) => !conocidos.has(t.grupo));
  if (sueltas.length > 0) grupos.push({ ...GRUPO_OTROS, tabs: sueltas });
  return grupos.filter((g) => g.tabs.length > 0);
}

// Último módulo abierto del grupo si sigue visible para este usuario; si no, el primero del grupo.
function ultimoModuloDe(grupo) {
  const recordado = leerUltimos()[grupo.id];
  return grupo.tabs.some((t) => t.id === recordado) ? recordado : grupo.tabs[0].id;
}

let contenedorNav = null;
let alElegirModulo = null;
let estado = { grupos: [], grupoActivoId: null, moduloActivoId: null, menuAbiertoId: null };
let escuchasInstaladas = false;

function crearBoton(texto, clave, clase) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = clase ? `tab ${clase}` : 'tab';
  boton.textContent = texto;
  boton.dataset.navKey = clave;
  return boton;
}

function crearBotonModulo(tab) {
  const boton = crearBoton(tab.nombre, `m:${tab.id}`);
  boton.dataset.modulo = tab.id;
  boton.classList.toggle('active', tab.id === estado.moduloActivoId);
  boton.addEventListener('click', () => elegirModulo(tab.id));
  return boton;
}

function elegirModulo(moduloId) {
  estado.menuAbiertoId = null;
  if (alElegirModulo) alElegirModulo(moduloId);
}

function aplicarMenuAbierto() {
  if (!contenedorNav) return;
  contenedorNav.querySelectorAll('.nav-grupo-envoltura').forEach((envoltura) => {
    const abierto = envoltura.dataset.grupo === estado.menuAbiertoId;
    envoltura.classList.toggle('abierto', abierto);
    const boton = envoltura.querySelector('.nav-grupo');
    if (boton) boton.setAttribute('aria-expanded', abierto ? 'true' : 'false');
  });
}

function crearBotonGrupo(grupo, modo) {
  const varios = grupo.tabs.length > 1;
  const desplegable = modo === MODO_DESPLEGABLE && varios;
  const boton = crearBoton(desplegable ? `${grupo.nombre} ▾` : grupo.nombre, `g:${grupo.id}`, 'nav-grupo');
  boton.classList.toggle('active', grupo.id === estado.grupoActivoId);
  if (!desplegable) {
    // Un grupo con un solo módulo visible abre ese módulo directo; en 'filas', abre el último módulo usado del grupo.
    boton.addEventListener('click', () => elegirModulo(ultimoModuloDe(grupo)));
    return boton;
  }
  boton.setAttribute('aria-haspopup', 'true');
  boton.setAttribute('aria-expanded', 'false');
  boton.addEventListener('click', (evento) => {
    evento.stopPropagation();
    estado.menuAbiertoId = estado.menuAbiertoId === grupo.id ? null : grupo.id;
    contenedorNav.classList.remove('nav-oculto');
    aplicarMenuAbierto();
  });
  const envoltura = document.createElement('div');
  envoltura.className = 'nav-grupo-envoltura';
  envoltura.dataset.grupo = grupo.id;
  envoltura.addEventListener('mouseleave', () => contenedorNav.classList.remove('nav-oculto'));
  const menu = document.createElement('div');
  menu.className = 'nav-menu';
  grupo.tabs.forEach((tab) => menu.appendChild(crearBotonModulo(tab)));
  envoltura.append(boton, menu);
  return envoltura;
}

function repintar() {
  if (!contenedorNav) return;
  const enfocado = document.activeElement && contenedorNav.contains(document.activeElement) ? document.activeElement.dataset.navKey : null;
  const modo = obtenerModo();
  contenedorNav.innerHTML = '';
  contenedorNav.classList.toggle('nav-desplegable', modo === MODO_DESPLEGABLE);

  const filaGrupos = document.createElement('div');
  filaGrupos.className = 'tabs nav-fila nav-grupos';
  estado.grupos.forEach((grupo) => filaGrupos.appendChild(crearBotonGrupo(grupo, modo)));
  // El interruptor solo tiene sentido si algún grupo tiene más de un módulo (si no, ambos modos se ven igual).
  if (estado.grupos.some((g) => g.tabs.length > 1)) {
    const interruptor = crearBoton(modo === MODO_FILAS ? 'Menú' : '2 filas', 'modo', 'nav-modo');
    interruptor.classList.remove('tab');
    interruptor.title = modo === MODO_FILAS ? 'Cambiar a menú desplegable' : 'Cambiar a dos filas';
    interruptor.setAttribute('aria-label', interruptor.title);
    interruptor.addEventListener('click', () => {
      escribirAlmacen(CLAVE_MODO, modo === MODO_FILAS ? MODO_DESPLEGABLE : MODO_FILAS);
      estado.menuAbiertoId = null;
      repintar();
    });
    filaGrupos.appendChild(interruptor);
  }
  contenedorNav.appendChild(filaGrupos);

  const activo = estado.grupos.find((g) => g.id === estado.grupoActivoId);
  if (modo === MODO_FILAS && activo && activo.tabs.length > 1) {
    const filaModulos = document.createElement('div');
    filaModulos.className = 'tabs nav-fila nav-modulos-fila';
    activo.tabs.forEach((tab) => filaModulos.appendChild(crearBotonModulo(tab)));
    contenedorNav.appendChild(filaModulos);
  }
  aplicarMenuAbierto();
  if (enfocado) {
    const destino = Array.from(contenedorNav.querySelectorAll('[data-nav-key]')).find((b) => b.dataset.navKey === enfocado);
    if (destino) destino.focus();
  }
}

function instalarEscuchas() {
  if (escuchasInstaladas) return;
  escuchasInstaladas = true;
  document.addEventListener('click', (evento) => {
    if (estado.menuAbiertoId && !evento.target.closest('.nav-grupo-envoltura')) {
      estado.menuAbiertoId = null;
      aplicarMenuAbierto();
    }
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Escape' || !contenedorNav) return;
    // Un menú abierto por el cursor (:hover) también se descarta con Escape: queda oculto hasta que el cursor salga del grupo.
    // Solo si hay un menú abierto o bajo el cursor; con otro Escape (p. ej. cerrar un modal) no se toca nada.
    const bajoCursor = contenedorNav.querySelector('.nav-grupo-envoltura:hover');
    if (!estado.menuAbiertoId && !bajoCursor) return;
    estado.menuAbiertoId = null;
    if (bajoCursor) contenedorNav.classList.add('nav-oculto');
    aplicarMenuAbierto();
  });
}

// Dibuja la navegación para estas pestañas visibles. `alElegir(moduloId)` es lo que abre un módulo (activarTab en auth.js).
// Devuelve el módulo con el que se debe arrancar (último abierto del primer grupo) o null si no hay módulos visibles.
function render(contenedor, tabs, alElegir) {
  contenedorNav = contenedor;
  alElegirModulo = alElegir;
  estado = { grupos: agruparTabs(tabs), grupoActivoId: null, moduloActivoId: null, menuAbiertoId: null };
  instalarEscuchas();
  repintar();
  return estado.grupos.length > 0 ? ultimoModuloDe(estado.grupos[0]) : null;
}

// Marca el módulo y su grupo como activos y recuerda el módulo como el último abierto de ese grupo.
function marcarActivo(moduloId) {
  const grupo = estado.grupos.find((g) => g.tabs.some((t) => t.id === moduloId));
  if (!grupo) return;
  estado.grupoActivoId = grupo.id;
  estado.moduloActivoId = moduloId;
  estado.menuAbiertoId = null;
  const ultimos = leerUltimos();
  ultimos[grupo.id] = moduloId;
  escribirAlmacen(CLAVE_ULTIMOS, JSON.stringify(ultimos));
  repintar();
}

// Para vistas fuera de la barra (panel Admin): ningún grupo ni módulo queda marcado.
function limpiarActivo() {
  estado.grupoActivoId = null;
  estado.moduloActivoId = null;
  estado.menuAbiertoId = null;
  repintar();
}

window.EVE_NAV = {
  GRUPOS_NAV,
  agruparTabs,
  ultimoModuloDe,
  obtenerModo,
  render,
  marcarActivo,
  limpiarActivo,
  estado: () => ({ modo: obtenerModo(), grupoActivoId: estado.grupoActivoId, moduloActivoId: estado.moduloActivoId, grupos: estado.grupos.map((g) => g.id) })
};

})();
