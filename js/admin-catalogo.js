(function () {

// Pantalla de Admin «Catálogo» de SOLO LECTURA (K22d). Muestra el catálogo de materiales ya fusionado (window.CATALOGO_MATERIALES:
// entradas base de js/config.js más las de la extensión config/sistema.catalogoExtra) con su origen, banderas, alias, reglas y
// uso, el mapa de transformaciones y, si la extensión trae entradas omitidas, el banner con sus motivos. No escribe en Firestore
// ni ofrece alta, edición ni archivado (eso es K22e y K22f): solo lee window.EVE, window.EVE_CATALOGO y window.CATALOGO_MATERIALES.
// Las mezclas de pellet no se modelan en el catálogo: el mapa no tiene el tramo molido -> pellet.

// ── Funciones puras ──────────────────────────────────────────────────────

const TIPOS_ORDEN = ['materia_prima', 'subproducto', 'intermedio', 'rechazo', 'producto_terminado'];
const ETIQUETA_TIPO = {
  materia_prima: 'Materia prima',
  subproducto: 'Subproducto',
  intermedio: 'Intermedio (molidos y pellets)',
  rechazo: 'Rechazo',
  producto_terminado: 'Producto terminado',
  'sin tipo': 'Sin tipo'
};
const BANDERAS = [
  { clave: 'recibible', etiqueta: 'Recibible' },
  { clave: 'requiereSeleccion', etiqueta: 'Requiere selección' },
  { clave: 'seObtieneEnProduccion', etiqueta: 'Se obtiene en producción' },
  { clave: 'compraHabitual', etiqueta: 'Compra habitual' }
];
const CAMPOS_REGLAS = ['muelePara', 'pelletUsado', 'rechazoGenerado', 'etapaRechazo', 'procesoProduccion'];

function claveNombre(valor) {
  return String(valor === undefined || valor === null ? '' : valor).trim().replace(/\s+/g, ' ').toUpperCase();
}

// Texto comparable: sin acentos, minúsculas y espacios simples.
function plano(valor) {
  return String(valor === undefined || valor === null ? '' : valor)
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function listaDe(valor) {
  return valor === undefined || valor === null ? [] : (Array.isArray(valor) ? valor : [valor]);
}

function esObjeto(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

// ¿La extensión del catálogo no trae nada? (campo ausente, vacío, o solo version). Una extensión que no es un objeto NO se
// considera vacía: es un error que reporta el banner.
function extensionVacia(extension) {
  if (extension === undefined || extension === null) return true;
  if (!esObjeto(extension)) return false;
  const materiales = esObjeto(extension.materiales) ? Object.keys(extension.materiales).length : 0;
  const overrides = esObjeto(extension.overrides) ? Object.keys(extension.overrides).length : 0;
  const mermas = Array.isArray(extension.mermas) ? extension.mermas.length : 0;
  return materiales + overrides + mermas === 0;
}

// Qué parte de la extensión SÍ se aplicó (la misma validación que usa el catálogo): nombres de los materiales de la extensión,
// los overrides y sus alias. Una entrada omitida por error no aparece aquí.
function extensionAplicada(extension) {
  const vacio = { materiales: {}, overrides: {}, alias: {} };
  if (extension === undefined || extension === null || !window.EVE_CATALOGO || typeof window.EVE_CATALOGO.validarExtension !== 'function') return vacio;
  const { validas } = window.EVE_CATALOGO.validarExtension(extension);
  const materiales = {};
  Object.keys(validas.materiales || {}).forEach((clave) => { materiales[claveNombre((validas.materiales[clave] || {}).nombre || clave)] = true; });
  const alias = {};
  Object.keys(validas.materiales || {}).forEach((clave) => listaDe((validas.materiales[clave] || {}).alias).forEach((a) => { alias[claveNombre(a)] = true; }));
  const overrides = {};
  Object.keys(validas.overrides || {}).forEach((clave) => {
    overrides[claveNombre(clave)] = validas.overrides[clave];
    listaDe(validas.overrides[clave].alias).forEach((a) => { alias[claveNombre(a)] = true; });
  });
  return { materiales, overrides, alias };
}

// Cuántos registros usan cada material, por nombre normalizado (los alias cuentan para el nombre oficial: un registro guardado
// como 'P.P MOLIDO' cuenta para 'P.P. MOLIDO'). Un registro cuenta UNA vez por material aunque lo repita (p. ej. entrada y salida
// de un mismo proceso). Solo ve lo que el usuario tiene cargado en window.EVE. Devuelve Map nombre -> { total, fuentes }.
function contarUsosPorMaterial(datos) {
  const usos = {};
  const normalizar = (m) => (window.normalizarMaterial ? window.normalizarMaterial(m) : claveNombre(m));
  const sumar = (fuente, materiales) => {
    new Set(materiales.map(normalizar).filter(Boolean)).forEach((material) => {
      if (!usos[material]) usos[material] = { total: 0, fuentes: {} };
      const actual = usos[material];
      actual.total += 1;
      actual.fuentes[fuente] = (actual.fuentes[fuente] || 0) + 1;
    });
  };
  const d = datos || {};
  (d.registrosDestaraje || []).forEach((r) => sumar('Báscula', [r.material]));
  (d.registrosVentas || []).forEach((r) => sumar('Ventas (Báscula)', [r.material]));
  (d.ventas || []).forEach((v) => sumar('Ventas', (v.lineas || []).map((l) => l.material)));
  (d.registrosPagos || []).forEach((r) => sumar('Pagos', [r.material]));
  (d.cuentasPorPagar || []).forEach((r) => sumar('CxP', [r.material]));
  (d.precios || []).forEach((r) => sumar('Precios', [r.material]));
  (d.ajustesPrecioProveedor || []).forEach((r) => sumar('Ajustes de precio', [r.material]));
  (d.composiciones || []).forEach((c) => sumar('Composiciones', [c.materialEntrada, ...(c.componentes || []).map((x) => x.subproducto)]));
  (d.registrosControlProduccion || []).forEach((r) => sumar('Control Producción', [...(r.inputs || []).map((i) => i.material), ...(r.outputs || []).filter((o) => !o.esMerma).map((o) => o.material)]));
  (d.inventarioInicial || []).forEach((r) => sumar('Inventario inicial', [r.material]));
  (d.inventario || []).forEach((r) => sumar('Ajustes de inventario', [r.material]));
  return usos;
}

// ¿A este material le falta su composición vigente? Solo aplica a los KG activos que requieren selección.
function faltaComposicion(entrada, composiciones, hoy) {
  if (entrada.unidad !== 'KG' || entrada.requiereSeleccion === false || entrada.activo === false) return false;
  const rend = window.EVE_RENDIMIENTOS;
  if (!rend || typeof rend.composicionVigenteParaMaterial !== 'function') return false;
  return !rend.composicionVigenteParaMaterial(composiciones || [], entrada.nombre, hoy);
}

// Una fila por material del catálogo fusionado, en el ORDEN del catálogo. contexto: { catalogo, extension, alias, datos, hoy }.
//   origen — 'extension' si la entrada viene de la extensión aplicada; 'base' si es de js/config.js.
//   archivadoPorExtension — una entrada base archivada por un override de la extensión.
//   alias — [{ alias, origen }] ('base' o 'extension').
function construirFilasCatalogo(contexto) {
  const catalogo = contexto.catalogo || [];
  const aplicada = extensionAplicada(contexto.extension);
  const usos = contarUsosPorMaterial(contexto.datos);
  const mapaAlias = contexto.alias || {};
  const aliasPorMaterial = {};
  Object.keys(mapaAlias).forEach((a) => {
    if (!aliasPorMaterial[mapaAlias[a]]) aliasPorMaterial[mapaAlias[a]] = [];
    aliasPorMaterial[mapaAlias[a]].push({ alias: a, origen: aplicada.alias[claveNombre(a)] === true ? 'extension' : 'base' });
  });
  const composiciones = (contexto.datos && contexto.datos.composiciones) || [];
  return catalogo.map((entrada, indice) => {
    const nombre = claveNombre(entrada.nombre);
    const override = aplicada.overrides[nombre];
    const uso = usos[entrada.nombre] || { total: 0, fuentes: {} };
    const reglas = {};
    CAMPOS_REGLAS.forEach((campo) => {
      const valor = entrada.reglas && entrada.reglas[campo];
      if (valor !== undefined && valor !== null && !(Array.isArray(valor) && valor.length === 0)) reglas[campo] = listaDe(valor);
    });
    return {
      indice,
      nombre: entrada.nombre,
      tipo: entrada.tipo || 'sin tipo',
      unidad: entrada.unidad,
      activo: entrada.activo !== false,
      recibible: entrada.recibible !== false,
      requiereSeleccion: entrada.requiereSeleccion !== false,
      seObtieneEnProduccion: entrada.seObtieneEnProduccion === true,
      compraHabitual: entrada.compraHabitual !== false,
      alias: (aliasPorMaterial[entrada.nombre] || []).slice().sort((a, b) => a.alias.localeCompare(b.alias, 'es')),
      reglas,
      origen: aplicada.materiales[nombre] === true ? 'extension' : 'base',
      archivadoPorExtension: !!override && override.activo === false,
      usos: uso.total,
      fuentesUso: uso.fuentes,
      faltaComposicion: faltaComposicion(entrada, composiciones, contexto.hoy)
    };
  });
}

// Filtros (todos opcionales y combinados con Y): { texto, tipo, unidad, estado: 'activos'|'archivados', origen: 'base'|'extension',
// banderas: { recibible, requiereSeleccion, seObtieneEnProduccion, compraHabitual } con 'si'|'no', faltaComposicion: boolean }.
// El texto busca (sin acentos ni mayúsculas) en nombre, alias, tipo, unidad y valores de reglas.
function filtrarFilas(filas, filtros) {
  const f = filtros || {};
  const texto = plano(f.texto);
  const banderas = f.banderas || {};
  return filas.filter((fila) => {
    if (texto) {
      const pajar = plano([fila.nombre, fila.tipo, ETIQUETA_TIPO[fila.tipo] || '', fila.unidad, ...fila.alias.map((a) => a.alias), ...Object.values(fila.reglas).flat()].join(' '));
      if (!pajar.includes(texto)) return false;
    }
    if (f.tipo && fila.tipo !== f.tipo) return false;
    if (f.unidad && fila.unidad !== f.unidad) return false;
    if (f.estado === 'activos' && !fila.activo) return false;
    if (f.estado === 'archivados' && fila.activo) return false;
    if (f.origen && fila.origen !== f.origen) return false;
    for (const bandera of BANDERAS) {
      const pedido = banderas[bandera.clave];
      if (pedido === 'si' && !fila[bandera.clave]) return false;
      if (pedido === 'no' && fila[bandera.clave]) return false;
    }
    if (f.faltaComposicion && !fila.faltaComposicion) return false;
    return true;
  });
}

// Orden: 'catalogo' (el del catálogo: es el orden en que se listan los materiales en toda la app), 'nombre' o 'usos' (más usados
// primero, desempate por catálogo). No modifica el arreglo recibido.
function ordenarFilas(filas, criterio) {
  const copia = filas.slice();
  if (criterio === 'nombre') return copia.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || a.indice - b.indice);
  if (criterio === 'usos') return copia.sort((a, b) => b.usos - a.usos || a.indice - b.indice);
  return copia.sort((a, b) => a.indice - b.indice);
}

// Agrupa por tipo en un orden fijo (los tipos conocidos primero y luego los demás); dentro de cada grupo conserva el orden recibido.
// Devuelve [{ tipo, etiqueta, filas }] sin grupos vacíos.
function agruparPorTipo(filas) {
  const grupos = {};
  filas.forEach((fila) => {
    if (!grupos[fila.tipo]) grupos[fila.tipo] = [];
    grupos[fila.tipo].push(fila);
  });
  const presentes = Object.keys(grupos);
  const conocidos = TIPOS_ORDEN.filter((t) => presentes.includes(t));
  const otros = presentes.filter((t) => !TIPOS_ORDEN.includes(t)).sort();
  return [...conocidos, ...otros].map((tipo) => ({ tipo, etiqueta: ETIQUETA_TIPO[tipo] || tipo, filas: grupos[tipo] }));
}

// Tipos presentes en el catálogo, en el mismo orden que usa agruparPorTipo (para el filtro).
function tiposPresentes(filas) {
  return agruparPorTipo(filas).map((g) => ({ tipo: g.tipo, etiqueta: g.etiqueta }));
}

// Mapa de transformaciones como listas indentadas ([{ nivel, texto, advertencia }]). Tres vistas:
//   crudos    — crudo -> subproductos (composición vigente) -> molido
//   pellets   — pieza -> pellet que consume
//   rechazos  — pieza -> rechazo -> molido
// El tramo molido -> pellet NO aparece: la mezcla se captura en Peletizado, no en el catálogo. advertencia marca donde la cadena
// se rompe (sin composición, sin pellet) para verla de un vistazo.
function construirMapaTransformaciones(catalogo, composiciones, hoy) {
  const porNombre = {};
  catalogo.forEach((m) => { porNombre[claveNombre(m.nombre)] = m; });
  const rend = window.EVE_RENDIMIENTOS;
  const composicionDe = (material) => (rend && typeof rend.composicionVigenteParaMaterial === 'function' ? rend.composicionVigenteParaMaterial(composiciones || [], material, hoy) : null);
  const molidoDe = (material) => {
    const entrada = porNombre[claveNombre(material)];
    return entrada && entrada.reglas && entrada.reglas.muelePara ? listaDe(entrada.reglas.muelePara)[0] : null;
  };
  const crudos = [];
  catalogo.filter((m) => m.unidad === 'KG' && m.requiereSeleccion !== false && m.activo !== false).forEach((m) => {
    const composicion = composicionDe(m.nombre);
    if (!composicion && m.tipo !== 'materia_prima') return;
    crudos.push({ nivel: 0, texto: m.nombre, advertencia: false });
    if (!composicion) {
      crudos.push({ nivel: 1, texto: 'sin composición vigente: no se puede seleccionar con la captura simple', advertencia: true });
      return;
    }
    (composicion.componentes || []).forEach((c) => {
      const pct = `${Number(c.porcentaje) || 0} %`;
      if (c.esMerma) {
        crudos.push({ nivel: 1, texto: `merma ${claveNombre(c.subproducto)} (${pct})`, advertencia: false });
        return;
      }
      crudos.push({ nivel: 1, texto: `${claveNombre(c.subproducto)} (${pct})`, advertencia: false });
      const molido = molidoDe(c.subproducto);
      crudos.push(molido
        ? { nivel: 2, texto: `se muele a ${molido}`, advertencia: false }
        : { nivel: 2, texto: 'sin molido definido', advertencia: false });
    });
  });
  const piezas = catalogo.filter((m) => m.unidad === 'PZ');
  const pellets = [];
  const rechazos = [];
  piezas.forEach((pieza) => {
    const reglas = pieza.reglas || {};
    const sufijo = `${pieza.activo === false ? ' (archivada)' : ''}${reglas.procesoProduccion ? ` — ${reglas.procesoProduccion}` : ''}`;
    pellets.push({ nivel: 0, texto: `${pieza.nombre}${sufijo}`, advertencia: false });
    const usados = listaDe(reglas.pelletUsado);
    if (usados.length === 0) pellets.push({ nivel: 1, texto: 'sin pellet definido', advertencia: true });
    usados.forEach((p) => pellets.push({ nivel: 1, texto: usados.length > 1 ? `consume ${p} (una de varias opciones)` : `consume ${p}`, advertencia: false }));
    rechazos.push({ nivel: 0, texto: `${pieza.nombre}${sufijo}`, advertencia: false });
    const rechazo = listaDe(reglas.rechazoGenerado)[0];
    if (!rechazo) {
      rechazos.push({ nivel: 1, texto: 'no genera rechazo recuperable', advertencia: false });
      return;
    }
    rechazos.push({ nivel: 1, texto: `genera ${rechazo}`, advertencia: false });
    const molido = molidoDe(rechazo);
    rechazos.push(molido
      ? { nivel: 2, texto: `se muele a ${molido}`, advertencia: false }
      : { nivel: 2, texto: 'sin molido definido', advertencia: true });
  });
  return { crudos, pellets, rechazos };
}

// Banner «Extensión del catálogo con errores». errores = window.EVE_CATALOGO.errores. Sin errores no hay banner.
function construirBanner(errores) {
  const lista = Array.isArray(errores) ? errores : [];
  if (lista.length === 0) return { visible: false, titulo: '', mensaje: '', lineas: [] };
  return {
    visible: true,
    titulo: 'Extensión del catálogo con errores',
    mensaje: 'Estas entradas NO están aplicadas: los registros que las usen aparecerán como no reconocidos.',
    lineas: lista.map((e) => `${e.nombre} — ${e.motivo}`)
  };
}

// Mensaje cuando la extensión no trae nada (catálogo solo base). null si la extensión tiene contenido.
function mensajeExtensionVacia(extension, totalBase) {
  if (!extensionVacia(extension)) return null;
  return `La extensión del catálogo está vacía: se usa solo el catálogo base (${totalBase} materiales).`;
}

window.EVE_ADMIN_CATALOGO = {
  BANDERAS,
  CAMPOS_REGLAS,
  extensionVacia,
  extensionAplicada,
  contarUsosPorMaterial,
  construirFilasCatalogo,
  filtrarFilas,
  ordenarFilas,
  agruparPorTipo,
  tiposPresentes,
  construirMapaTransformaciones,
  construirBanner,
  mensajeExtensionVacia
};

// ── Vista (solo lectura) ─────────────────────────────────────────────────

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function crearSelect(opciones, valorInicial) {
  const select = el('select');
  opciones.forEach(([valor, texto]) => {
    const opcion = el('option', '', texto);
    opcion.value = valor;
    select.appendChild(opcion);
  });
  select.value = valorInicial || '';
  return select;
}

function crearBanner(errores) {
  const info = construirBanner(errores);
  if (!info.visible) return null;
  // Sin botón de cerrar: no se puede ocultar mientras haya errores.
  const banner = el('div', 'acat-banner');
  banner.setAttribute('role', 'alert');
  banner.appendChild(el('strong', '', info.titulo));
  banner.appendChild(el('p', '', info.mensaje));
  const ul = el('ul');
  info.lineas.forEach((linea) => ul.appendChild(el('li', '', linea)));
  banner.appendChild(ul);
  return banner;
}

function crearChip(texto, clase) {
  return el('span', `acat-chip${clase ? ` ${clase}` : ''}`, texto);
}

function crearTablaGrupo(grupo) {
  const seccion = el('section', 'acat-grupo');
  seccion.appendChild(el('h4', '', `${grupo.etiqueta} (${grupo.filas.length})`));
  const envoltura = el('div', 'acat-tabla-wrapper');
  const tabla = el('table', 'tabla-destaraje acat-tabla');
  const encabezado = el('tr');
  ['Material', 'Unidad', 'Origen', 'Banderas', 'Alias', 'Reglas', 'Usos'].forEach((t) => encabezado.appendChild(el('th', '', t)));
  tabla.appendChild(el('thead')).appendChild(encabezado);
  const cuerpo = el('tbody');
  grupo.filas.forEach((fila) => {
    const tr = el('tr', fila.activo ? '' : 'acat-archivado');
    const celdaNombre = el('td');
    celdaNombre.appendChild(el('strong', '', fila.nombre));
    if (!fila.activo) celdaNombre.appendChild(crearChip(fila.archivadoPorExtension ? 'archivado (extensión)' : 'archivado', 'acat-chip-aviso'));
    if (fila.faltaComposicion) celdaNombre.appendChild(crearChip('falta composición', 'acat-chip-aviso'));
    tr.appendChild(celdaNombre);
    tr.appendChild(el('td', '', fila.unidad));
    tr.appendChild(el('td', '', fila.origen === 'extension' ? 'extensión' : 'base'));
    const celdaBanderas = el('td');
    BANDERAS.forEach((b) => celdaBanderas.appendChild(crearChip(`${b.etiqueta}: ${fila[b.clave] ? 'sí' : 'no'}`, fila[b.clave] ? 'acat-chip-si' : 'acat-chip-no')));
    tr.appendChild(celdaBanderas);
    tr.appendChild(el('td', '', fila.alias.map((a) => (a.origen === 'extension' ? `${a.alias} (extensión)` : a.alias)).join(', ') || '—'));
    const celdaReglas = el('td');
    const campos = Object.keys(fila.reglas);
    if (campos.length === 0) celdaReglas.textContent = '—';
    campos.forEach((campo) => celdaReglas.appendChild(el('div', '', `${campo}: ${fila.reglas[campo].join(', ')}`)));
    tr.appendChild(celdaReglas);
    const detalleUsos = Object.keys(fila.fuentesUso).map((f) => `${f}: ${fila.fuentesUso[f]}`).join(' · ');
    const celdaUsos = el('td', '', String(fila.usos));
    if (detalleUsos) celdaUsos.title = detalleUsos;
    tr.appendChild(celdaUsos);
    cuerpo.appendChild(tr);
  });
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  seccion.appendChild(envoltura);
  return seccion;
}

function crearLista(titulo, lineas) {
  const detalle = el('details', 'acat-mapa');
  detalle.appendChild(el('summary', '', titulo));
  const contenedor = el('div', 'acat-mapa-lista');
  lineas.forEach((l) => {
    const linea = el('div', `acat-mapa-linea${l.advertencia ? ' acat-mapa-advertencia' : ''}`, `${l.nivel > 0 ? '└ ' : ''}${l.texto}`);
    linea.style.paddingLeft = `${l.nivel * 1.25}rem`;
    contenedor.appendChild(linea);
  });
  if (lineas.length === 0) contenedor.appendChild(el('div', 'acat-mapa-linea', 'Sin elementos.'));
  detalle.appendChild(contenedor);
  return detalle;
}

function contextoActual() {
  return {
    catalogo: window.CATALOGO_MATERIALES,
    extension: window.EVE.catalogoExtra,
    alias: window.MATERIALES_ALIAS,
    datos: window.EVE,
    hoy: window.obtenerFechaMexico()
  };
}

function crearVistaCatalogo() {
  const raiz = el('div', 'admin-catalogo card');
  const permisos = window.EVE.currentUser && window.EVE.currentUser.permisosResueltos;
  // Mismo permiso que protege la configuración de Admin: Admin con escritura.
  if (!permisos || permisos.admin !== 'escritura') {
    raiz.appendChild(el('p', '', 'No tienes permiso para ver el catálogo.'));
    return raiz;
  }
  const contexto = contextoActual();
  const filas = construirFilasCatalogo(contexto);
  const estado = { texto: '', tipo: '', unidad: '', estado: '', origen: '', banderas: {}, faltaComposicion: false, orden: 'catalogo' };

  raiz.appendChild(el('h3', '', 'Catálogo de materiales'));
  raiz.appendChild(el('p', 'acat-nota', 'Solo lectura. El alta, la edición y el archivado llegan en una versión posterior.'));
  const banner = crearBanner(window.EVE_CATALOGO && window.EVE_CATALOGO.errores);
  if (banner) raiz.appendChild(banner);
  const totalBase = filas.filter((f) => f.origen === 'base').length;
  const vacia = mensajeExtensionVacia(contexto.extension, totalBase);
  if (vacia) raiz.appendChild(el('p', 'acat-extension-vacia', vacia));

  const barra = el('div', 'acat-filtros');
  const buscador = el('input');
  buscador.type = 'search';
  buscador.placeholder = 'Buscar material, alias, tipo o regla';
  const selectTipo = crearSelect([['', 'Todos los tipos'], ...tiposPresentes(filas).map((t) => [t.tipo, t.etiqueta])]);
  const selectUnidad = crearSelect([['', 'Todas las unidades'], ['KG', 'KG'], ['PZ', 'PZ']]);
  const selectEstado = crearSelect([['', 'Activos y archivados'], ['activos', 'Solo activos'], ['archivados', 'Solo archivados']]);
  const selectOrigen = crearSelect([['', 'Base y extensión'], ['base', 'Solo base'], ['extension', 'Solo extensión']]);
  const selectOrden = crearSelect([['catalogo', 'Orden del catálogo'], ['nombre', 'Por nombre'], ['usos', 'Más usados primero']]);
  const selectsBandera = BANDERAS.map((b) => ({ clave: b.clave, select: crearSelect([['', `${b.etiqueta}: todos`], ['si', `${b.etiqueta}: sí`], ['no', `${b.etiqueta}: no`]]) }));
  const casillaFalta = el('input');
  casillaFalta.type = 'checkbox';
  const etiquetaFalta = el('label', 'acat-falta');
  etiquetaFalta.appendChild(casillaFalta);
  etiquetaFalta.appendChild(document.createTextNode(' Falta composición'));
  [buscador, selectTipo, selectUnidad, selectEstado, selectOrigen, ...selectsBandera.map((s) => s.select), etiquetaFalta, selectOrden].forEach((c) => barra.appendChild(c));
  raiz.appendChild(barra);

  const conteo = el('p', 'acat-conteo');
  const listado = el('div', 'acat-listado');
  raiz.appendChild(conteo);
  raiz.appendChild(listado);

  const mapa = construirMapaTransformaciones(contexto.catalogo, contexto.datos.composiciones, contexto.hoy);
  const seccionMapa = el('div', 'acat-mapas');
  seccionMapa.appendChild(el('h4', '', 'Mapa de transformaciones'));
  seccionMapa.appendChild(el('p', 'acat-nota', 'La mezcla de los pellets no se modela en el catálogo: se captura en Peletizado.'));
  seccionMapa.appendChild(crearLista('Crudo → subproductos → molido', mapa.crudos));
  seccionMapa.appendChild(crearLista('Pieza → pellet que consume', mapa.pellets));
  seccionMapa.appendChild(crearLista('Pieza → rechazo → molido', mapa.rechazos));
  raiz.appendChild(seccionMapa);

  function pintar() {
    const visibles = ordenarFilas(filtrarFilas(filas, estado), estado.orden);
    conteo.textContent = `${visibles.length} de ${filas.length} materiales`;
    listado.replaceChildren();
    if (visibles.length === 0) listado.appendChild(el('p', '', 'Ningún material coincide con los filtros.'));
    agruparPorTipo(visibles).forEach((grupo) => listado.appendChild(crearTablaGrupo(grupo)));
  }
  const enlazar = (control, evento, aplicar) => control.addEventListener(evento, () => { aplicar(); pintar(); });
  enlazar(buscador, 'input', () => { estado.texto = buscador.value; });
  enlazar(selectTipo, 'change', () => { estado.tipo = selectTipo.value; });
  enlazar(selectUnidad, 'change', () => { estado.unidad = selectUnidad.value; });
  enlazar(selectEstado, 'change', () => { estado.estado = selectEstado.value; });
  enlazar(selectOrigen, 'change', () => { estado.origen = selectOrigen.value; });
  enlazar(selectOrden, 'change', () => { estado.orden = selectOrden.value; });
  enlazar(casillaFalta, 'change', () => { estado.faltaComposicion = casillaFalta.checked; });
  selectsBandera.forEach(({ clave, select }) => enlazar(select, 'change', () => { estado.banderas[clave] = select.value; }));
  pintar();
  return raiz;
}

window.EVE_ADMIN_CATALOGO.crearVistaCatalogo = crearVistaCatalogo;

})();
