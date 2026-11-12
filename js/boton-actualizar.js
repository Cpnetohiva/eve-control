(function () {

// Botón «↻ Actualizar» reutilizable (mismo gesto que el del Dashboard Ejecutivo, pero SIN recargar todo).
//
//  - El Dashboard Ejecutivo (`#btnRef`) vuelve a leer sus 10 colecciones completas. Aquí no: cada módulo entrega `alActualizar`, que
//    lee solo lo que su pestaña necesita, y el componente solo pone la interfaz: «↻ Actualizar», «Actualizado HH:MM», estado de
//    cargando, toast al terminar y scroll conservado.
//  - Nunca llama a cargarDatosEnParalelo ni recarga la página. Los filtros, la pestaña abierta y las preferencias (p. ej. «Incluir
//    material de socios») viven fuera del DOM que se repinta, así que el módulo solo vuelve a pintar sus tablas.
//  - Ventana de historial: el sistema no tiene una ventana por rol (la carga completa lee la colección entera de cada módulo que el rol
//    puede leer). Actualizar nunca lee más ancho que eso: respeta puedeLeer(módulo) y, para tickets, solo trae lo capturado desde
//    la última captura conocida (incremental por `fechaRegistro`).

// Colchón del incremental: se vuelve a leer lo capturado en las últimas 24 h antes del registro más reciente en memoria, para no perder
// capturas sin conexión que se sincronizaron tarde (su fechaRegistro es la de la captura, no la de la sincronización).
const MARGEN_INCREMENTAL_MS = 24 * 60 * 60 * 1000;

// Hora de México (HH:MM, 24 h) de un instante en milisegundos.
function formatearHora(ms) {
  return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/Mexico_City' }).format(new Date(ms));
}

const relojReal = { ahora: () => Date.now() };
const ultimaPorClave = new Map();

// opciones: { clave, alActualizar: async () => resultado, mensajeExito: (resultado) => texto, reloj: { ahora } }
function crear(opciones) {
  const { clave, alActualizar } = opciones;
  const reloj = opciones.reloj || relojReal;
  const mensajeExito = opciones.mensajeExito || (() => 'Datos actualizados');
  const cargaCompleta = Number(window.EVE && window.EVE.cargadoEn) || reloj.ahora();
  let ultima = Math.max(cargaCompleta, (clave && ultimaPorClave.get(clave)) || 0);
  // Único candado: la actualización en curso. Se toma de forma síncrona antes de cualquier await, así que un clic mientras carga
  // no dispara otra lectura; al terminar (bien o mal) el botón queda disponible de inmediato.
  let enCurso = false;

  const elemento = document.createElement('div');
  elemento.className = 'eve-actualizar';
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn-secondary';
  const hora = document.createElement('span');
  hora.className = 'eve-actualizar-hora';
  elemento.appendChild(boton);
  elemento.appendChild(hora);

  function pintar() {
    boton.textContent = enCurso ? '↻ Actualizando…' : '↻ Actualizar';
    boton.disabled = enCurso;
    if (enCurso) boton.setAttribute('aria-busy', 'true'); else boton.removeAttribute('aria-busy');
    hora.textContent = `Actualizado ${formatearHora(ultima)}`;
  }

  async function actualizar() {
    if (enCurso) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      window.showError('Sin conexión: no se puede actualizar. Los datos en pantalla son los últimos que se cargaron.');
      return;
    }
    enCurso = true;
    pintar();
    const x = window.scrollX;
    const y = window.scrollY;
    try {
      const resultado = await alActualizar();
      ultima = reloj.ahora();
      if (clave) ultimaPorClave.set(clave, ultima);
      window.showSuccess(mensajeExito(resultado));
    } catch (error) {
      window.showError(`No se pudo actualizar: ${(error && error.message) || error}`);
    } finally {
      enCurso = false;
      pintar();
      window.scrollTo(x, y);
    }
  }

  boton.addEventListener('click', actualizar);
  pintar();
  return { elemento, boton, actualizar, ultimaActualizacion: () => ultima };
}

// ── Lectura acotada ──────────────────────────────────────────────────────

// Une `nuevos` a `actuales` por id: reemplaza los que ya estaban y agrega los demás. No quita nada (el incremental no ve borrados).
function fusionarPorId(actuales, nuevos) {
  const lista = (actuales || []).slice();
  const posicion = new Map(lista.map((registro, indice) => [registro.id, indice]));
  let agregados = 0;
  (nuevos || []).forEach((registro) => {
    if (posicion.has(registro.id)) {
      lista[posicion.get(registro.id)] = registro;
    } else {
      posicion.set(registro.id, lista.length);
      lista.push(registro);
      agregados++;
    }
  });
  return { lista, agregados };
}

// Punto de partida del incremental: la captura más reciente en memoria menos el colchón. null si ningún registro trae fechaRegistro.
function desdeIncremental(registros) {
  let maxima = 0;
  (registros || []).forEach((registro) => {
    const t = Date.parse(registro && registro.fechaRegistro);
    if (Number.isFinite(t) && t > maxima) maxima = t;
  });
  return maxima ? new Date(maxima - MARGEN_INCREMENTAL_MS).toISOString() : null;
}

function unificar(registros) {
  if (typeof window.unificarProveedorEnRegistros === 'function') window.unificarProveedorEnRegistros(registros);
  return registros;
}

// Colección completa (una sola colección; cuenta sus lecturas como las demás cargas).
async function leerTodo(coleccion) {
  return unificar(await window.cargarDatos(coleccion));
}

// Solo lo capturado desde la última captura conocida. Sin ninguna referencia en memoria lee la colección completa.
async function leerNuevos(coleccion, enMemoria) {
  const desde = desdeIncremental(enMemoria);
  if (!desde) return { registros: await leerTodo(coleccion), completa: true };
  const snapshot = await window.db.collection(coleccion).where('fechaRegistro', '>=', desde).get();
  if (window.EVE_LECTURAS) window.EVE_LECTURAS.contar(coleccion, snapshot);
  return { registros: unificar(snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))), completa: false };
}

// Las lecturas de una actualización se anotan aparte (window.verLecturas) y no se confunden con la carga completa.
async function conMotivoActualizar(accion) {
  if (window.EVE_LECTURAS) window.EVE_LECTURAS.marcarMotivo('actualizar');
  try {
    return await accion();
  } finally {
    if (window.EVE_LECTURAS) window.EVE_LECTURAS.terminarCarga();
  }
}

// Tickets de Báscula (window.EVE.registrosDestaraje y registrosVentas): solo los nuevos, repartidos como en la carga completa.
async function traerTicketsNuevos() {
  if (!window.puedeLeer('destaraje')) return 0;
  const enMemoria = [...(window.EVE.registrosDestaraje || []), ...(window.EVE.registrosVentas || [])];
  const { registros, completa } = await leerNuevos('destaraje', enMemoria);
  const { lista, agregados } = fusionarPorId(enMemoria, registros);
  const { destaraje, ventas } = window.clasificarDestaraje(lista);
  window.EVE.registrosDestaraje = destaraje;
  window.EVE.registrosVentas = ventas;
  return completa ? destaraje.length : agregados;
}

// Auditorías: pocas y con resultados que se completan después, así que se leen completas (no por fechaRegistro).
async function traerAuditorias() {
  if (!window.puedeLeer('cxp')) return;
  window.EVE.auditorias = await leerTodo('auditorias');
}

// Compras > Báscula: tickets nuevos y, si el rol lee CxP, las cuentas nuevas y las auditorías (deciden qué tickets quedan «sin auditar»).
async function recargarBascula() {
  return conMotivoActualizar(async () => {
    const tickets = await traerTicketsNuevos();
    let cuentas = 0;
    if (window.puedeLeer('cxp')) {
      const { registros } = await leerNuevos('cuentas_por_pagar', window.EVE.cuentasPorPagar);
      const fusion = fusionarPorId(window.EVE.cuentasPorPagar, registros);
      window.EVE.cuentasPorPagar = fusion.lista;
      cuentas = fusion.agregados;
      await traerAuditorias();
    }
    return { tickets, cuentas };
  });
}

// Compras > CxP: cuentas por pagar COMPLETAS (los saldos cambian en cuentas viejas con cada pago; no hay fecha de modificación para
// leer solo las tocadas), auditorías y tickets nuevos. No toca proveedores, precios, ventas ni nada fuera de la pestaña.
async function recargarCxP() {
  return conMotivoActualizar(async () => {
    if (!window.puedeLeer('cxp')) return { tickets: 0, cuentas: 0 };
    const antes = (window.EVE.cuentasPorPagar || []).length;
    window.EVE.cuentasPorPagar = await leerTodo('cuentas_por_pagar');
    await traerAuditorias();
    const tickets = await traerTicketsNuevos();
    return { tickets, cuentas: window.EVE.cuentasPorPagar.length - antes };
  });
}

window.EVE_BOTON_ACTUALIZAR = { formatearHora, crear, fusionarPorId, desdeIncremental, leerNuevos, recargarBascula, recargarCxP };

})();
