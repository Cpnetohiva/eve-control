(function () {

// Módulo Órdenes de Compra (OC a proveedor): validación y cálculo, folio OC-AAAA-nnnn, guardado atómico, estados
// (Emitida → Recibida | Cancelada, Recibida → Cancelada) y la pantalla de captura y lista. Los totales, el emisor y el folio
// se toman de EVE_COTIZACIONES (mismo redondeo, mismo config/emisor y mismo contador contadores/OC-AAAA). Debe cargarse
// después de js/cotizaciones.js. El PDF vive en js/ordenescompra-pdf.js.

const cot = () => window.EVE_COTIZACIONES;
const PERMISO = 'ordenesCompra';

const texto = (valor) => (valor === undefined || valor === null ? '' : String(valor)).trim();
const clonar = (valor) => JSON.parse(JSON.stringify(valor === undefined ? null : valor));

// ── Estados y transiciones ──────────────────────────────────────────────────────────────────────────────────────────────
// Espejo de transicionOrdenCompraValida en firestore.rules. Una OC nace Emitida y solo se edita o elimina mientras lo sigue
// estando; Cancelada es final.
const ESTADO_EMITIDA = 'Emitida';
const ESTADO_RECIBIDA = 'Recibida';
const ESTADO_CANCELADA = 'Cancelada';
const ESTADOS_OC = [ESTADO_EMITIDA, ESTADO_RECIBIDA, ESTADO_CANCELADA];
const TRANSICIONES_OC = {
  [ESTADO_EMITIDA]: [ESTADO_RECIBIDA, ESTADO_CANCELADA],
  [ESTADO_RECIBIDA]: [ESTADO_CANCELADA],
  [ESTADO_CANCELADA]: []
};
const transicionValida = (de, a) => (TRANSICIONES_OC[de] || []).includes(a);

const usuarioActual = () => (window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema';
const sinConexion = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// ── Proveedor ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Minúsculas, sin acentos y espacios colapsados: sirve para buscar y agrupar sin depender de cómo se escribió el nombre.
function normalizarProveedor(nombre) {
  return texto(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

// Una entrada por proveedor (la OC más reciente gana), ordenada por nombre. No hay colección de proveedores de OC: salen de
// las propias órdenes.
function proveedoresDeOrdenes(lista) {
  const porClave = new Map();
  (lista || []).forEach((orden) => {
    const clave = orden.proveedorNormalizado || normalizarProveedor(orden.proveedor && orden.proveedor.nombre);
    if (!clave) return;
    const previo = porClave.get(clave);
    if (!previo || texto(orden.fecha) >= texto(previo.fecha)) porClave.set(clave, { clave, fecha: orden.fecha, ...clonar(orden.proveedor) });
  });
  return Array.from(porClave.values()).sort((a, b) => texto(a.nombre).localeCompare(texto(b.nombre)));
}

// ── Validación y construcción ───────────────────────────────────────────────────────────────────────────────────────────
const CAMPOS_PROVEEDOR = ['nombre', 'telefono', 'email', 'domicilio'];

// Devuelve { ok, errores } con un mensaje por campo. Claves: 'proveedor.nombre|email', 'fecha', 'partidas' (lista vacía) y
// 'partidas.N.producto|cantidad|unidad|precioUnitario|descuentoPct'. No modifica los datos.
function validarOrden(datos) {
  const errores = {};
  const d = datos || {};
  const proveedor = d.proveedor || {};
  if (!texto(proveedor.nombre)) errores['proveedor.nombre'] = 'El nombre del proveedor es obligatorio';
  else if (!normalizarProveedor(proveedor.nombre).replace(/[^a-z0-9]/g, '')) errores['proveedor.nombre'] = 'El proveedor debe llevar letras o números';
  if (texto(proveedor.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto(proveedor.email))) errores['proveedor.email'] = 'El correo no es válido';
  if (!cot().fechaIsoValida(d.fecha)) errores.fecha = 'La fecha no es válida (dd/mm/aaaa)';

  const partidas = Array.isArray(d.partidas) ? d.partidas : [];
  if (partidas.length === 0) errores.partidas = 'Agrega al menos una partida';
  partidas.forEach((p, i) => {
    const clave = (campo) => `partidas.${i}.${campo}`;
    if (!texto(p.producto) && !texto(p.descripcion)) errores[clave('producto')] = 'Escribe el producto o la descripción';
    if (!(Number(p.cantidad) > 0)) errores[clave('cantidad')] = 'La cantidad debe ser mayor a 0';
    if (!cot().UNIDADES_COTIZACION.includes(texto(p.unidad))) errores[clave('unidad')] = 'Elige la unidad';
    if (!(Number(p.precioUnitario) > 0)) errores[clave('precioUnitario')] = 'El precio debe ser mayor a 0';
    const descuento = p.descuentoPct === '' || p.descuentoPct === undefined || p.descuentoPct === null ? 0 : Number(p.descuentoPct);
    if (!Number.isFinite(descuento) || descuento < 0 || descuento > 100) errores[clave('descuentoPct')] = 'El descuento debe estar entre 0 y 100';
  });
  return { ok: Object.keys(errores).length === 0, errores };
}

// Snapshot completo de la OC (sin folio, estado ni metadatos): proveedor, partidas con su importe, totales y el emisor vigente
// al guardar. Supone datos ya validados.
function construirOrden(datos, emisor) {
  const partidas = datos.partidas.map((p) => {
    const partida = {
      producto: texto(p.producto) || null,
      descripcion: texto(p.descripcion),
      cantidad: Number(p.cantidad),
      unidad: texto(p.unidad),
      precioUnitario: Number(p.precioUnitario),
      descuentoPct: p.descuentoPct === '' || p.descuentoPct === undefined || p.descuentoPct === null ? 0 : Number(p.descuentoPct)
    };
    return { ...partida, importe: cot().calcularImportePartida(partida) };
  });
  const proveedor = {};
  CAMPOS_PROVEEDOR.forEach((campo) => { proveedor[campo] = texto(datos.proveedor[campo]); });
  return {
    proveedor,
    proveedorNormalizado: normalizarProveedor(proveedor.nombre),
    fecha: datos.fecha,
    condicionesPago: texto(datos.condicionesPago),
    condicionesEntrega: texto(datos.condicionesEntrega),
    notas: texto(datos.notas),
    partidas,
    totales: cot().calcularTotales(partidas, datos.aplicaIva),
    emisor: cot().normalizarEmisor(emisor)
  };
}

// ── Firestore ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Entrada de historial_cambios dentro de la transacción: se confirma o se descarta junto con el cambio que describe.
function registrarEnTransaccion(tx, { registroId, accion, valorAnterior, valorNuevo, motivo, usuario }) {
  tx.set(window.db.collection('historial_cambios').doc(), {
    coleccion: 'ordenes_compra', registroId, accion, valorAnterior, valorNuevo, motivo, usuario, timestamp: new Date().toISOString()
  });
}

const coleccionOC = () => window.db.collection(window.COLECCIONES.ORDENES_COMPRA);

// Guarda una OC en UNA transacción: alta = folio (contadores/OC-AAAA) + documento en Emitida; edición de una Emitida =
// documento, SIN tocar folio ni estado. Si algo falla no se consume el folio. Requiere red. Devuelve { id, folio, documento }.
async function guardarOrden(datos, id) {
  if (!window.puedeEscribir(PERMISO)) throw new Error('No tienes permiso para guardar órdenes de compra');
  const validacion = validarOrden(datos);
  if (!validacion.ok) throw Object.assign(new Error('Revisa los campos marcados'), { errores: validacion.errores });
  if (sinConexion()) throw new Error('Sin conexión: la orden de compra solo se puede guardar con internet. No se guardó nada.');

  const orden = construirOrden(datos, await cot().obtenerEmisor());
  const usuario = usuarioActual();
  const ahora = new Date().toISOString();
  const ref = id ? coleccionOC().doc(id) : coleccionOC().doc();

  return window.db.runTransaction(async (tx) => {
    let documento;
    if (id) {
      const actual = await tx.get(ref);
      if (!actual.exists) throw new Error('La orden de compra ya no existe');
      const previa = actual.data();
      if (previa.estado !== ESTADO_EMITIDA) {
        throw Object.assign(new Error(`Solo se puede editar una orden Emitida: ${previa.folio} está ${previa.estado}. Se actualizó la lista`), { documentoActual: { id, ...previa } });
      }
      documento = { ...previa, ...orden, actualizadoPor: usuario, actualizadoEn: ahora };
      registrarEnTransaccion(tx, {
        registroId: id, accion: 'edicion', valorAnterior: { folio: previa.folio, total: previa.totales && previa.totales.total },
        valorNuevo: { folio: previa.folio, total: orden.totales.total }, motivo: `Edición de la orden de compra ${previa.folio}`, usuario
      });
    } else {
      const folio = await cot().tomarFolioEnTransaccion(tx, 'ordenCompra');
      documento = { ...orden, folio, estado: ESTADO_EMITIDA, creadoPor: usuario, fechaRegistro: ahora, historialEstados: [{ de: null, a: ESTADO_EMITIDA, usuario, fecha: ahora }] };
      registrarEnTransaccion(tx, {
        registroId: ref.id, accion: 'alta', valorAnterior: null, valorNuevo: { folio, total: orden.totales.total, estado: ESTADO_EMITIDA },
        motivo: `Alta de la orden de compra ${folio}`, usuario
      });
    }
    tx.set(ref, documento);
    return { id: ref.id, folio: documento.folio, documento };
  });
}

// Lee una OC del servidor. Devuelve { id, ...datos } o null si no existe.
async function obtenerOC(id) {
  const documento = await coleccionOC().doc(id).get();
  return documento.exists ? { id, ...documento.data() } : null;
}

// Todas las OC (sin filtro), ordenadas por folio descendente.
async function listarOCs() {
  const consulta = await coleccionOC().get();
  const lista = [];
  consulta.forEach((documento) => lista.push({ id: documento.id, ...documento.data() }));
  return lista.sort((a, b) => texto(b.folio).localeCompare(texto(a.folio)));
}

// OC con fecha entre `desde` y `hasta` (YYYY-MM-DD, ambos incluidos; '' = sin límite de ese lado).
async function listarOCsPorRango(desde, hasta) {
  let consulta = coleccionOC();
  if (texto(desde)) consulta = consulta.where('fecha', '>=', texto(desde));
  if (texto(hasta)) consulta = consulta.where('fecha', '<=', texto(hasta));
  const resultado = await consulta.get();
  const lista = [];
  resultado.forEach((documento) => lista.push({ id: documento.id, ...documento.data() }));
  return lista.sort((a, b) => texto(b.folio).localeCompare(texto(a.folio)));
}

// Pasa una OC a `nuevo` en UNA transacción con relectura fresca: la transición se valida contra el estado REAL del servidor
// (otro usuario pudo cambiarlo) y queda en historialEstados y en historial_cambios. Si ya no procede, el error lleva
// `documentoActual` para que la pantalla refresque su copia. Requiere red. Devuelve { id, folio, documento }.
async function cambiarEstado(id, nuevo) {
  if (!window.puedeEscribir(PERMISO)) throw new Error('No tienes permiso para cambiar el estado de órdenes de compra');
  if (!ESTADOS_OC.includes(nuevo)) throw new Error(`Estado desconocido: ${JSON.stringify(nuevo)}`);
  if (sinConexion()) throw new Error('Sin conexión: el estado solo se puede cambiar con internet. No se cambió nada.');

  const usuario = usuarioActual();
  const ref = coleccionOC().doc(id);
  return window.db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    if (!actual.exists) throw new Error('La orden de compra ya no existe');
    const datos = actual.data();
    if (!transicionValida(datos.estado, nuevo)) {
      throw Object.assign(new Error(`No se puede pasar ${datos.folio} a ${nuevo}: está en estado ${datos.estado}. Se actualizó la lista`), { documentoActual: { id, ...datos } });
    }
    const ahora = new Date().toISOString();
    const historialEstados = [...(Array.isArray(datos.historialEstados) ? datos.historialEstados : []), { de: datos.estado, a: nuevo, usuario, fecha: ahora }];
    const documento = { ...datos, estado: nuevo, historialEstados, actualizadoPor: usuario, actualizadoEn: ahora };
    tx.set(ref, documento);
    registrarEnTransaccion(tx, {
      registroId: id, accion: 'cambio_estado', valorAnterior: { folio: datos.folio, estado: datos.estado }, valorNuevo: { folio: datos.folio, estado: nuevo },
      motivo: `Cambio de estado de ${datos.folio}: ${datos.estado} → ${nuevo}`, usuario
    });
    return { id, folio: datos.folio, documento };
  });
}

// Elimina una OC Emitida en UNA transacción (relectura fresca + registro en historial_cambios). NO toca el contador: el folio
// no se reutiliza. Si el estado ya no es Emitida, el error lleva `documentoActual`. Requiere red.
// Devuelve { id, folio, proveedor, total }.
async function eliminarOC(id) {
  if (!window.puedeEscribir(PERMISO)) throw new Error('No tienes permiso para eliminar órdenes de compra');
  if (!id) throw new Error('Falta la orden de compra a eliminar');
  if (sinConexion()) throw new Error('Sin conexión: la orden de compra solo se puede eliminar con internet. No se eliminó nada.');

  const usuario = usuarioActual();
  const ref = coleccionOC().doc(id);
  return window.db.runTransaction(async (tx) => {
    const actual = await tx.get(ref);
    if (!actual.exists) throw new Error('La orden de compra ya no existe');
    const datos = actual.data();
    if (datos.estado !== ESTADO_EMITIDA) {
      throw Object.assign(new Error(`No se puede eliminar ${datos.folio}: ya está en estado ${datos.estado} (solo se elimina una orden Emitida)`), { documentoActual: { id, ...datos } });
    }
    const proveedor = (datos.proveedor && datos.proveedor.nombre) || '';
    const total = datos.totales ? datos.totales.total : null;
    tx.delete(ref);
    registrarEnTransaccion(tx, {
      registroId: id, accion: 'eliminacion', valorAnterior: { folio: datos.folio, proveedor, total, estado: datos.estado }, valorNuevo: null,
      motivo: `Eliminación de la orden de compra ${datos.folio}`, usuario
    });
    return { id, folio: datos.folio, proveedor, total };
  });
}

// Vuelve a leer ordenes_compra del servidor y rehace window.EVE.ordenesCompra y window.EVE.ordenesCompraProveedores.
async function cargarDatos() {
  window.EVE.ordenesCompra = window.puedeLeer(PERMISO) ? await window.cargarDatos(window.COLECCIONES.ORDENES_COMPRA) : [];
  window.EVE.ordenesCompraProveedores = proveedoresDeOrdenes(window.EVE.ordenesCompra);
  return window.EVE.ordenesCompra;
}

// ── Lista: filtros y totales ────────────────────────────────────────────────────────────────────────────────────────────
// filtros: { proveedor (texto sin distinguir mayúsculas ni acentos), estado ('' = todos), desde / hasta (YYYY-MM-DD, '' = abierto) }
function filtrarOrdenes(lista, filtros) {
  const f = filtros || {};
  const buscado = normalizarProveedor(f.proveedor);
  const desde = texto(f.desde);
  const hasta = texto(f.hasta);
  return (lista || []).filter((o) => {
    if (f.estado && o.estado !== f.estado) return false;
    if (buscado && !(o.proveedorNormalizado || normalizarProveedor(o.proveedor && o.proveedor.nombre)).includes(buscado)) return false;
    if (desde || hasta) {
      const fecha = texto(o.fecha);
      if (!fecha || (desde && fecha < desde) || (hasta && fecha > hasta)) return false;
    }
    return true;
  });
}

function totalesPorEstado(lista) {
  return ESTADOS_OC.map((estado) => {
    const delEstado = (lista || []).filter((o) => o.estado === estado);
    return { estado, cantidad: delEstado.length, total: cot().redondear2(delEstado.reduce((suma, o) => suma + (Number(o.totales && o.totales.total) || 0), 0)) };
  });
}

window.EVE_ORDENES_COMPRA = {
  ESTADOS_OC,
  TRANSICIONES_OC,
  transicionValida,
  normalizarProveedor,
  proveedoresDeOrdenes,
  validarOrden,
  construirOrden,
  guardarOrden,
  obtenerOC,
  listarOCs,
  listarOCsPorRango,
  cambiarEstado,
  eliminarOC,
  cargarDatos,
  filtrarOrdenes,
  totalesPorEstado
};

// ── Pantalla: captura y lista de órdenes de compra ──────────────────────────────────────────────────────────────────────
// Reutiliza las clases cot-* de css/styles.css (mismo aspecto que Cotizaciones).
function crearElemento(etiqueta, clase, contenido) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (contenido !== undefined) nodo.textContent = contenido;
  return nodo;
}

function crearInput(tipo, atributos) {
  const input = document.createElement('input');
  input.type = tipo;
  Object.keys(atributos || {}).forEach((nombre) => input.setAttribute(nombre, atributos[nombre]));
  return input;
}

function crearSelect(opciones, valor) {
  const select = document.createElement('select');
  opciones.forEach((opcion) => {
    const nodo = document.createElement('option');
    nodo.value = opcion.valor;
    nodo.textContent = opcion.texto;
    select.appendChild(nodo);
  });
  select.value = valor;
  return select;
}

// Campo con etiqueta, el control y un hueco para el mensaje de error (se llena en marcarErrores).
function crearCampo(etiqueta, control, claveError) {
  const campo = crearElemento('label', 'cot-campo');
  campo.appendChild(crearElemento('span', 'cot-etiqueta', etiqueta));
  campo.appendChild(control);
  const error = crearElemento('small', 'cot-error');
  error.dataset.error = claveError;
  campo.appendChild(error);
  control.dataset.campo = claveError;
  return campo;
}

function marcar(control, nodoError, mensaje) {
  if (control) control.classList.toggle('campo-invalido', !!mensaje);
  if (nodoError) nodoError.textContent = mensaje || '';
}

function marcarErrores(form, errores) {
  form.querySelectorAll('[data-campo]').forEach((control) => marcar(control, form.querySelector(`[data-error="${control.dataset.campo}"]`), errores[control.dataset.campo]));
  marcar(null, form.querySelector('[data-error="partidas"]'), errores.partidas);
  form.querySelectorAll('.cot-partida').forEach((fila, i) => {
    ['producto', 'cantidad', 'unidad', 'precioUnitario', 'descuentoPct'].forEach((nombre) => {
      marcar(fila.querySelector(`[data-f="${nombre}"]`), fila.querySelector(`[data-e="${nombre}"]`), errores[`partidas.${i}.${nombre}`]);
    });
  });
  const primero = form.querySelector('.campo-invalido');
  if (primero && typeof primero.focus === 'function') primero.focus();
}

function fechaDesdeTexto(textoFecha) {
  return /^\s*\d{1,2}[/-]\d{1,2}[/-]\d{4}\s*$/.test(textoFecha || '') ? (window.parsearFecha(textoFecha) || '') : '';
}

// Una partida es una sola descripción (producto o material comprado): se guarda en `descripcion`.
function crearFilaPartida(partida, soloLectura) {
  const valores = partida || { descripcion: '', cantidad: '', unidad: 'KG', precioUnitario: '', descuentoPct: 0 };
  const fila = document.createElement('tr');
  fila.className = 'cot-partida';
  const controles = [
    ['producto', crearInput('text', { maxlength: '200', placeholder: 'Producto o descripción' }), [texto(valores.producto), texto(valores.descripcion)].filter(Boolean).join(' - ')],
    ['cantidad', crearInput('number', { min: '0', step: 'any', inputmode: 'decimal' }), valores.cantidad],
    ['unidad', crearSelect(cot().UNIDADES_COTIZACION.map((u) => ({ valor: u, texto: u })), cot().UNIDADES_COTIZACION.includes(valores.unidad) ? valores.unidad : 'KG'), null],
    ['precioUnitario', crearInput('number', { min: '0', step: 'any', inputmode: 'decimal' }), valores.precioUnitario],
    ['descuentoPct', crearInput('number', { min: '0', max: '100', step: 'any', inputmode: 'decimal' }), valores.descuentoPct]
  ];
  controles.forEach(([nombre, control, valor]) => {
    const celda = document.createElement('td');
    control.dataset.f = nombre;
    if (valor !== null && valor !== undefined) control.value = valor;
    const error = crearElemento('small', 'cot-error');
    error.dataset.e = nombre;
    celda.append(control, error);
    fila.appendChild(celda);
  });
  fila.appendChild(crearElemento('td', 'cot-importe mono'));
  const celdaQuitar = document.createElement('td');
  const quitar = crearElemento('button', 'btn-secondary cot-quitar', '✕');
  quitar.type = 'button';
  quitar.title = 'Quitar partida';
  quitar.setAttribute('aria-label', 'Quitar partida');
  celdaQuitar.appendChild(quitar);
  fila.appendChild(celdaQuitar);
  if (soloLectura) {
    fila.querySelectorAll('input, select').forEach((control) => { control.disabled = true; });
    quitar.style.display = 'none';
  }
  return fila;
}

function leerFila(fila) {
  const valor = (nombre) => fila.querySelector(`[data-f="${nombre}"]`).value;
  return { producto: '', descripcion: valor('producto'), cantidad: valor('cantidad'), unidad: valor('unidad'), precioUnitario: valor('precioUnitario'), descuentoPct: valor('descuentoPct') };
}

function leerFormulario(form) {
  const valor = (clave) => form.querySelector(`[data-campo="${clave}"]`).value;
  return {
    proveedor: { nombre: valor('proveedor.nombre'), telefono: valor('proveedor.telefono'), email: valor('proveedor.email'), domicilio: valor('proveedor.domicilio') },
    fecha: fechaDesdeTexto(valor('fecha')),
    condicionesPago: valor('condicionesPago'),
    condicionesEntrega: valor('condicionesEntrega'),
    notas: valor('notas'),
    aplicaIva: form.querySelector('[data-campo="aplicaIva"]').checked,
    partidas: Array.from(form.querySelectorAll('.cot-partida')).map(leerFila)
  };
}

function recalcular(form) {
  const filas = Array.from(form.querySelectorAll('.cot-partida'));
  const partidas = filas.map(leerFila);
  filas.forEach((fila, i) => { fila.querySelector('.cot-importe').textContent = window.formatearMoneda(cot().calcularImportePartida(partidas[i])); });
  const totales = cot().calcularTotales(partidas, form.querySelector('[data-campo="aplicaIva"]').checked);
  form.querySelector('[data-total="subtotal"]').textContent = window.formatearMoneda(totales.subtotal);
  form.querySelector('[data-total="iva"]').textContent = window.formatearMoneda(totales.iva);
  form.querySelector('[data-total="total"]').textContent = window.formatearMoneda(totales.total);
  form.querySelectorAll('.cot-quitar').forEach((boton) => { boton.disabled = filas.length <= 1; });
}

// Reemplaza (o agrega) un documento en la copia en memoria y rehace la lista de proveedores.
function refrescarEnMemoria(documento) {
  const lista = window.EVE.ordenesCompra;
  const indice = lista.findIndex((o) => o.id === documento.id);
  if (indice === -1) lista.push(documento); else lista[indice] = documento;
  window.EVE.ordenesCompraProveedores = proveedoresDeOrdenes(lista);
}

function quitarDeMemoria(id) {
  const lista = window.EVE.ordenesCompra;
  const indice = lista.findIndex((o) => o.id === id);
  if (indice !== -1) lista.splice(indice, 1);
  window.EVE.ordenesCompraProveedores = proveedoresDeOrdenes(lista);
}

const proveedorDe = (orden) => texto(orden.proveedor && orden.proveedor.nombre);
const puedeEditar = (orden) => window.puedeEscribir(PERMISO) && orden.estado === ESTADO_EMITIDA;

async function exportarPDF(orden, boton) {
  boton.disabled = true;
  try {
    if (!window.EVE_ORDENES_COMPRA_PDF) throw new Error('El módulo de PDF no está cargado');
    const nombre = await window.EVE_ORDENES_COMPRA_PDF.generarPdfOrdenCompra(orden.id, orden);
    if (nombre) window.showSuccess(`PDF ${nombre} generado`);
  } catch (error) {
    window.showError(`No se pudo generar el PDF: ${error.message}`);
  } finally {
    boton.disabled = false;
  }
}

// Ejecuta una acción de estado desde la lista: avisa, actualiza la copia en memoria (también cuando el servidor rechaza porque
// el documento ya cambió) y devuelve true si la lista hay que volver a pintarla.
async function ejecutarCambioEstado(boton, orden, nuevo) {
  boton.disabled = true;
  try {
    const resultado = await cambiarEstado(orden.id, nuevo);
    refrescarEnMemoria({ id: resultado.id, ...resultado.documento });
    window.showSuccess(`Orden ${resultado.folio}: ${nuevo}`);
    return true;
  } catch (error) {
    window.showError(error.message);
    boton.disabled = false;
    if (!error.documentoActual) return false;
    refrescarEnMemoria(error.documentoActual);
    return true;
  }
}

async function pedirCambioEstado(orden, nuevo, boton) {
  if (nuevo === ESTADO_CANCELADA && !window.confirm(`¿Cancelar ${orden.folio} de ${proveedorDe(orden)}?\n\nCancelada es un estado final: la orden ya no podrá cambiar.`)) return false;
  return ejecutarCambioEstado(boton, orden, nuevo);
}

// Pide confirmación (folio + proveedor) y elimina. Devuelve 'eliminada', 'actualizada' (el estado cambió en otro lado: se
// refrescó la copia y no se borró nada) o null (cancelada o con error; el error ya se mostró).
async function eliminarConConfirmacion(orden, boton) {
  if (!window.confirm(`¿Eliminar ${orden.folio} de ${proveedorDe(orden)}?\n\nEsta acción no se puede deshacer. El folio no se vuelve a usar.`)) return null;
  boton.disabled = true;
  try {
    const resultado = await eliminarOC(orden.id);
    quitarDeMemoria(resultado.id);
    window.showSuccess(`Orden ${resultado.folio} eliminada`);
    return 'eliminada';
  } catch (error) {
    window.showError(error.message);
    boton.disabled = false;
    if (!error.documentoActual) return null;
    refrescarEnMemoria(error.documentoActual);
    return 'actualizada';
  }
}

function crearFormulario({ orden, soloLectura, alTerminar }) {
  const editando = !!orden;
  const form = crearElemento('form', 'cot-form card');
  form.noValidate = true;
  const titulo = !editando ? 'Nueva orden de compra' : `${soloLectura ? 'Orden de compra' : 'Editar'} ${orden.folio}`;
  form.appendChild(crearElemento('h3', `cot-titulo${editando ? ' mono' : ''}`, titulo));

  const proveedor = (orden && orden.proveedor) || {};
  const gridProveedor = crearElemento('div', 'cot-grid');
  const nombre = crearInput('text', { maxlength: '150', autocomplete: 'off' });
  const telefono = crearInput('tel', { maxlength: '30' });
  const email = crearInput('text', { maxlength: '100', inputmode: 'email' });
  const domicilio = crearInput('text', { maxlength: '250' });
  nombre.value = proveedor.nombre || '';
  telefono.value = proveedor.telefono || '';
  email.value = proveedor.email || '';
  domicilio.value = proveedor.domicilio || '';
  gridProveedor.append(
    crearCampo('Proveedor *', nombre, 'proveedor.nombre'),
    crearCampo('Teléfono', telefono, 'proveedor.telefono'),
    crearCampo('Correo', email, 'proveedor.email'),
    crearCampo('Domicilio', domicilio, 'proveedor.domicilio')
  );
  form.appendChild(gridProveedor);

  const gridDatos = crearElemento('div', 'cot-grid');
  const fecha = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  fecha.value = window.formatearFecha(orden ? orden.fecha : window.obtenerFechaMexico());
  const pago = crearInput('text', { maxlength: '250' });
  const entrega = crearInput('text', { maxlength: '250' });
  pago.value = orden ? orden.condicionesPago || '' : '';
  entrega.value = orden ? orden.condicionesEntrega || '' : '';
  gridDatos.append(crearCampo('Fecha *', fecha, 'fecha'), crearCampo('Condiciones de pago', pago, 'condicionesPago'), crearCampo('Condiciones de entrega', entrega, 'condicionesEntrega'));
  form.appendChild(gridDatos);

  form.appendChild(crearElemento('h4', 'cot-subtitulo', 'Partidas'));
  const envoltura = crearElemento('div', 'destaraje-tabla-wrapper');
  const tabla = crearElemento('table', 'tabla-destaraje cot-tabla');
  tabla.innerHTML = '<thead><tr><th>Producto / descripción</th><th>Cantidad</th><th>Unidad</th><th>Precio unit.</th><th>Desc. %</th><th>Importe</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  form.appendChild(envoltura);
  const errorPartidas = crearElemento('small', 'cot-error');
  errorPartidas.dataset.error = 'partidas';
  form.appendChild(errorPartidas);
  (orden ? orden.partidas : [null]).forEach((p) => cuerpo.appendChild(crearFilaPartida(p, soloLectura)));
  const agregar = crearElemento('button', 'btn-secondary', '+ Agregar partida');
  agregar.type = 'button';
  agregar.style.display = soloLectura ? 'none' : '';
  agregar.addEventListener('click', () => { cuerpo.appendChild(crearFilaPartida(null, false)); recalcular(form); });
  form.appendChild(agregar);
  cuerpo.addEventListener('click', (evento) => {
    const boton = evento.target.closest('.cot-quitar');
    if (!boton || cuerpo.children.length <= 1) return;
    boton.closest('tr').remove();
    recalcular(form);
  });
  form.addEventListener('input', () => recalcular(form));
  form.addEventListener('change', () => recalcular(form));

  const iva = crearInput('checkbox');
  iva.checked = orden ? !!orden.totales.aplicaIva : false;
  iva.dataset.campo = 'aplicaIva';
  const etiquetaIva = crearElemento('label', 'cot-iva');
  etiquetaIva.append(iva, document.createTextNode(' Aplicar IVA 16%'));
  const totales = crearElemento('div', 'cot-totales');
  [['subtotal', 'Subtotal'], ['iva', 'IVA 16%'], ['total', 'Total']].forEach(([clave, rotulo]) => {
    const linea = crearElemento('div', `cot-total-linea cot-total-${clave}`);
    linea.appendChild(crearElemento('span', '', rotulo));
    const monto = crearElemento('span', 'mono');
    monto.dataset.total = clave;
    linea.appendChild(monto);
    totales.appendChild(linea);
  });
  form.append(etiquetaIva, totales);

  const notas = document.createElement('textarea');
  notas.rows = 3;
  notas.maxLength = 1000;
  notas.value = orden ? orden.notas || '' : '';
  form.appendChild(crearCampo('Notas', notas, 'notas'));

  const acciones = crearElemento('div', 'cot-acciones');
  if (!soloLectura) {
    const guardar = crearElemento('button', 'btn-primary', editando ? 'Guardar cambios' : 'Emitir orden');
    guardar.type = 'submit';
    acciones.appendChild(guardar);
  }
  const cancelar = crearElemento('button', 'btn-secondary', soloLectura ? 'Cerrar' : 'Cancelar');
  cancelar.type = 'button';
  cancelar.addEventListener('click', () => alTerminar(false));
  acciones.appendChild(cancelar);
  if (editando) {
    const pdf = crearElemento('button', 'btn-secondary cot-pdf', 'PDF');
    pdf.type = 'button';
    pdf.title = 'Descargar la orden guardada en PDF';
    pdf.addEventListener('click', () => exportarPDF(orden, pdf));
    acciones.appendChild(pdf);
  }
  if (editando && !soloLectura && puedeEditar(orden)) {
    const eliminar = crearElemento('button', 'btn-danger cot-eliminar', 'Eliminar');
    eliminar.type = 'button';
    eliminar.addEventListener('click', async () => {
      const resultado = await eliminarConConfirmacion(orden, eliminar);
      if (resultado) alTerminar(true);
    });
    acciones.appendChild(eliminar);
  }
  form.appendChild(acciones);

  if (soloLectura) form.querySelectorAll('input, textarea').forEach((control) => { control.disabled = true; });
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    if (soloLectura) return;
    const datos = leerFormulario(form);
    const validacion = validarOrden(datos);
    marcarErrores(form, validacion.errores);
    if (!validacion.ok) {
      window.showError('Revisa los campos marcados');
      return;
    }
    const botonGuardar = form.querySelector('button[type="submit"]');
    botonGuardar.disabled = true;
    try {
      const resultado = await guardarOrden(datos, editando ? orden.id : undefined);
      refrescarEnMemoria({ id: resultado.id, ...resultado.documento });
      window.showSuccess(`Orden de compra ${resultado.folio} guardada`);
      alTerminar(true);
    } catch (error) {
      if (error.errores) marcarErrores(form, error.errores);
      if (error.documentoActual) refrescarEnMemoria(error.documentoActual);
      window.showError(error.message);
      botonGuardar.disabled = false;
    }
  });

  recalcular(form);
  return form;
}

const CLASE_ESTADO = { Emitida: 'enviada', Recibida: 'aceptada', Cancelada: 'cancelada' };
const ETIQUETA_TRANSICION = { [ESTADO_RECIBIDA]: 'Marcar Recibida', [ESTADO_CANCELADA]: 'Cancelar orden' };

function crearEtiquetaEstado(estado) {
  const clase = CLASE_ESTADO[estado];
  return crearElemento('span', `cot-estado${clase ? ` cot-estado-${clase}` : ''}`, texto(estado));
}

// Botones de la fila. `acciones`: { abrir, eliminar, cambiarEstado }; los de escritura solo para quien puede.
function crearCeldaAcciones(orden, acciones) {
  const celda = document.createElement('td');
  const caja = crearElemento('div', 'cot-acciones-fila');
  const editable = puedeEditar(orden);
  const abrir = crearElemento('button', 'btn-secondary', editable ? 'Editar' : 'Ver');
  abrir.type = 'button';
  abrir.addEventListener('click', () => acciones.abrir(orden, !editable));
  caja.appendChild(abrir);
  const pdf = crearElemento('button', 'btn-secondary cot-pdf', 'PDF');
  pdf.type = 'button';
  pdf.title = 'Descargar la orden en PDF';
  pdf.addEventListener('click', () => exportarPDF(orden, pdf));
  caja.appendChild(pdf);
  if (window.puedeEscribir(PERMISO)) {
    (TRANSICIONES_OC[orden.estado] || []).forEach((nuevo) => {
      const boton = crearElemento('button', 'btn-secondary cot-transicion', ETIQUETA_TRANSICION[nuevo]);
      boton.type = 'button';
      boton.dataset.nuevoEstado = nuevo;
      boton.addEventListener('click', () => acciones.cambiarEstado(orden, nuevo, boton));
      caja.appendChild(boton);
    });
    const eliminar = crearElemento('button', 'btn-danger cot-eliminar', 'Eliminar');
    eliminar.type = 'button';
    caja.appendChild(eliminar);
    if (editable) {
      eliminar.addEventListener('click', () => acciones.eliminar(orden, eliminar));
    } else {
      eliminar.disabled = true;
      eliminar.title = 'Solo se puede eliminar una orden Emitida';
      caja.appendChild(crearElemento('small', 'cot-nota', 'Solo Emitida'));
    }
  }
  celda.appendChild(caja);
  return celda;
}

function crearTablaOrdenes(lista, acciones) {
  const envoltura = crearElemento('div', 'destaraje-tabla-wrapper');
  const tabla = crearElemento('table', 'tabla-destaraje');
  tabla.innerHTML = '<thead><tr><th>Folio</th><th>Proveedor</th><th>Fecha</th><th>Total</th><th>Estado</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  const ordenadas = lista.slice().sort((a, b) => texto(b.folio).localeCompare(texto(a.folio)));
  if (ordenadas.length === 0) {
    const fila = document.createElement('tr');
    const celda = crearElemento('td', '', 'Sin órdenes de compra');
    celda.colSpan = 6;
    fila.appendChild(celda);
    cuerpo.appendChild(fila);
  }
  ordenadas.forEach((o) => {
    const fila = document.createElement('tr');
    fila.dataset.id = o.id;
    fila.appendChild(crearElemento('td', 'mono', texto(o.folio)));
    fila.appendChild(crearElemento('td', '', proveedorDe(o)));
    fila.appendChild(crearElemento('td', 'mono', texto(window.formatearFecha(o.fecha))));
    fila.appendChild(crearElemento('td', 'mono', texto(window.formatearMoneda(o.totales && o.totales.total))));
    const celdaEstado = document.createElement('td');
    celdaEstado.appendChild(crearEtiquetaEstado(o.estado));
    fila.appendChild(celdaEstado);
    fila.appendChild(crearCeldaAcciones(o, acciones));
    cuerpo.appendChild(fila);
  });
  tabla.appendChild(cuerpo);
  envoltura.appendChild(tabla);
  return envoltura;
}

function crearResumenEstados(lista) {
  const resumen = crearElemento('div', 'cot-resumen');
  const conDatos = totalesPorEstado(lista).filter((t) => t.cantidad > 0);
  if (conDatos.length === 0) {
    resumen.appendChild(crearElemento('span', 'cot-nota', 'Sin órdenes con estos filtros'));
    return resumen;
  }
  conDatos.forEach((t) => {
    const item = crearElemento('div', 'cot-resumen-item');
    item.dataset.estado = t.estado;
    item.appendChild(crearEtiquetaEstado(t.estado));
    item.appendChild(crearElemento('span', 'cot-resumen-cantidad mono', `${t.cantidad} · ${window.formatearMoneda(t.total)}`));
    resumen.appendChild(item);
  });
  return resumen;
}

// Controles de filtro: proveedor, estado y Desde/Hasta (dd/mm/aaaa, vacío = abierto). Escribe en `filtros` (fechas ya en
// YYYY-MM-DD) y llama a `alCambiar` en cada cambio.
function crearFiltros(filtros, alCambiar) {
  const caja = crearElemento('div', 'card cot-filtros');
  const grid = crearElemento('div', 'cot-grid');
  const proveedor = crearInput('text', { maxlength: '150', placeholder: 'Buscar proveedor', autocomplete: 'off' });
  const estado = crearSelect([{ valor: '', texto: 'Todos' }, ...ESTADOS_OC.map((e) => ({ valor: e, texto: e }))], '');
  const desde = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  const hasta = crearInput('text', { placeholder: 'dd/mm/aaaa', inputmode: 'numeric', maxlength: '10' });
  grid.append(
    crearCampo('Proveedor', proveedor, 'filtro.proveedor'),
    crearCampo('Estado', estado, 'filtro.estado'),
    crearCampo('Desde', desde, 'filtro.desde'),
    crearCampo('Hasta', hasta, 'filtro.hasta')
  );
  caja.appendChild(grid);
  // Fecha vacía = sin límite; con texto debe ser dd/mm/aaaa válida (si no, se marca y ese límite no se aplica).
  const leerFecha = (control, clave) => {
    const textoFecha = control.value.trim();
    const iso = textoFecha ? fechaDesdeTexto(textoFecha) : '';
    marcar(control, caja.querySelector(`[data-error="${clave}"]`), textoFecha && !cot().fechaIsoValida(iso) ? 'Fecha no válida (dd/mm/aaaa)' : '');
    return cot().fechaIsoValida(iso) ? iso : '';
  };
  const actualizar = () => {
    filtros.proveedor = proveedor.value;
    filtros.estado = estado.value;
    filtros.desde = leerFecha(desde, 'filtro.desde');
    filtros.hasta = leerFecha(hasta, 'filtro.hasta');
    alCambiar();
  };
  caja.addEventListener('input', actualizar);
  caja.addEventListener('change', actualizar);
  return caja;
}

function renderOrdenesCompra(container) {
  container.innerHTML = '';
  const raiz = crearElemento('div');
  raiz.id = 'modulo-ordenescompra';
  const encabezado = crearElemento('div', 'cot-encabezado');
  encabezado.appendChild(crearElemento('h2', 'cot-titulo', 'Órdenes de Compra'));
  const zonaFormulario = document.createElement('div');
  const zonaResumen = document.createElement('div');
  const zonaLista = document.createElement('div');
  const filtros = { proveedor: '', estado: '', desde: '', hasta: '' };

  let idAbierta = null;
  // actualizarUI: vuelve a pintar el resumen por estado y la lista con los filtros y los datos en memoria.
  const actualizarUI = () => {
    const visibles = filtrarOrdenes(window.EVE.ordenesCompra || [], filtros);
    zonaResumen.innerHTML = '';
    zonaResumen.appendChild(crearResumenEstados(visibles));
    zonaLista.innerHTML = '';
    const tarjeta = crearElemento('div', 'card');
    tarjeta.appendChild(crearTablaOrdenes(visibles, acciones));
    zonaLista.appendChild(tarjeta);
  };
  const cerrar = (huboCambios) => {
    zonaFormulario.innerHTML = '';
    idAbierta = null;
    if (huboCambios) actualizarUI();
  };
  function abrir(orden, soloLectura) {
    zonaFormulario.innerHTML = '';
    idAbierta = orden ? orden.id : null;
    zonaFormulario.appendChild(crearFormulario({ orden, soloLectura, alTerminar: cerrar }));
    zonaFormulario.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  const acciones = {
    abrir,
    eliminar: async (orden, boton) => {
      const resultado = await eliminarConConfirmacion(orden, boton);
      if (resultado === 'eliminada' && idAbierta === orden.id) cerrar(true);
      else if (resultado) actualizarUI();
    },
    cambiarEstado: async (orden, nuevo, boton) => { if (await pedirCambioEstado(orden, nuevo, boton)) actualizarUI(); }
  };

  if (window.puedeEscribir(PERMISO)) {
    const nueva = crearElemento('button', 'btn-primary', '+ Nueva orden de compra');
    nueva.type = 'button';
    nueva.addEventListener('click', () => abrir(null, false));
    encabezado.appendChild(nueva);
  }
  raiz.append(encabezado, zonaFormulario, crearFiltros(filtros, actualizarUI), zonaResumen, zonaLista);
  container.appendChild(raiz);
  actualizarUI();
}

// La pestaña se llama 'ordenesCompra' en ORDEN_TABS (js/auth.js): renderModulo busca el módulo por ese mismo id.
window.EVE_MODULES.ordenesCompra = { render: renderOrdenesCompra };

})();
