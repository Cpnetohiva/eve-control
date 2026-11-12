window.formatearKg = function (valor, material) {
  const mat = (material || '').toString().trim().toUpperCase();
  const unidad = window.materialesPZ().includes(mat) ? 'PZ' : 'KG';
  const numero = Number(valor);
  return `${(Number.isFinite(numero) ? numero : 0).toLocaleString('es-MX')} ${unidad}`;
};

window.formatearMoneda = function (valor) {
  const numero = Number(valor);
  return (Number.isFinite(numero) ? numero : 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
};

window.formatearFecha = function (fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
};

window.parsearFecha = function (fechaTexto) {
  const match = (fechaTexto || '').match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return null;
  const [, dia, mes, anio] = match;
  return `${anio}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;
};

window.obtenerFechaMexico = function () {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
};

// Fecha (AAAA-MM-DD) y hora (HH:mm, 24 h) en zona horaria de México de un timestamp ISO; null si no es una fecha válida.
window.fechaYHoraMexico = function (iso) {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const dato = (tipo) => partes.find((p) => p.type === tipo).value;
  return { fecha: `${dato('year')}-${dato('month')}-${dato('day')}`, hora: `${dato('hour')}:${dato('minute')}` };
};

// La semana es de lunes a domingo en todos los módulos. Devuelve { inicio, fin } (AAAA-MM-DD) de la semana de fechaStr
// (por defecto hoy en México). Aritmética con fecha local sin hora, para que un cambio de horario no mueva el día.
window.obtenerRangoSemana = function (fechaStr) {
  const base = fechaStr || window.obtenerFechaMexico();
  const [anio, mes, dia] = base.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  const offset = (fecha.getDay() + 6) % 7;
  const formatear = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const lunes = new Date(anio, mes - 1, dia - offset);
  const domingo = new Date(anio, mes - 1, dia - offset + 6);
  return { inicio: formatear(lunes), fin: formatear(domingo) };
};

window.obtenerInicioSemana = function () {
  return window.obtenerRangoSemana().inicio;
};

// Últimos 30 días = de hoy menos 29 días a hoy, ambos incluidos (30 días corridos), con la misma fecha de hoy (zona horaria de
// México) que usan Hoy, Esta Semana y Este Mes. Aritmética en UTC para que un cambio de horario no mueva el día.
window.obtenerInicioUltimos30Dias = function () {
  const fecha = new Date(`${window.obtenerFechaMexico()}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - 29);
  return fecha.toISOString().slice(0, 10);
};
window.dentroDeUltimos30Dias = function (fecha) {
  return typeof fecha === 'string' && fecha >= window.obtenerInicioUltimos30Dias() && fecha <= window.obtenerFechaMexico();
};

window.obtenerInicioMes = function () {
  const hoy = window.obtenerFechaMexico();
  return `${hoy.slice(0, 7)}-01`;
};

window.obtenerSemanaISO = function (fechaISO) {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  const diaSemanaISO = fecha.getDay() || 7;
  fecha.setDate(fecha.getDate() + (4 - diaSemanaISO));
  const inicioAnio = new Date(fecha.getFullYear(), 0, 1);
  const numeroSemana = Math.ceil((((fecha - inicioAnio) / 86400000) + 1) / 7);
  return `${fecha.getFullYear()}-W${String(numeroSemana).padStart(2, '0')}`;
};

// Fecha (YYYY-MM-DD) en que ocurrió un registro de Control Producción. Los registros nuevos traen
// `fecha`; los anteriores solo `fechaFin`, que lleva hora y se recorta al día.
window.fechaProceso = function (registro) {
  const r = registro || {};
  return r.fecha || String(r.fechaFin || '').slice(0, 10);
};

window.obtenerPrecioVigente = function (material, fecha, proveedor) {
  // Se compara por nombre normalizado en ambos lados: un precio guardado con un nombre anterior a
  // un alias (p. ej. 'P.P MOLIDO') sigue empatando con el nombre oficial ('P.P. MOLIDO').
  const mat = window.normalizarMaterial(material);
  const base = (window.EVE.precios || []).find((p) =>
    window.normalizarMaterial(p.material) === mat &&
    p.fechaInicio <= fecha &&
    (p.fechaFin === null || p.fechaFin >= fecha)
  ) || null;
  if (!base || !proveedor) return base;

  const ajuste = window.obtenerAjusteProveedorVigente(mat, proveedor, fecha);
  if (!ajuste) return base;

  const precioBase = base.precio;
  const precioFinal = ajuste.tipoAjuste === 'monto'
    ? precioBase + ajuste.valorAjuste
    : precioBase * (1 + ajuste.valorAjuste / 100);

  return {
    ...base,
    precio: precioFinal,
    precioBase,
    ajusteProveedorAplicado: { tipo: ajuste.tipoAjuste, valor: ajuste.valorAjuste }
  };
};

window.obtenerComisionVigente = function (fecha) {
  const f = fecha || window.obtenerFechaMexico();
  const vigente = (window.EVE.comisiones || []).find((c) =>
    c.fechaInicio <= f &&
    (c.fechaFin === null || c.fechaFin >= f)
  );
  return vigente ? Number(vigente.valor) || 0 : 0;
};

window.obtenerComposicionVigente = function (material, fecha) {
  const mat = window.normalizarMaterial(material);
  return window.EVE_RENDIMIENTOS.composicionVigenteParaMaterial(window.EVE.composiciones || [], mat, fecha);
};

// Al editar un registro existente cuyo material ya fue archivado, los selectores de ALTA no lo ofrecen y el valor se
// perdería. Agrega al select una opción con ese valor SOLO si el material está archivado y la opción no existe.
// Devuelve true si la agregó.
window.agregarOpcionSiArchivado = function (select, valor) {
  const texto = (valor || '').toString().trim();
  if (!texto || !select || !window.EVE_CATALOGO || window.EVE_CATALOGO.estadoDe(texto) !== 'archivado') return false;
  const yaEsta = Array.from(select.options || select.children || []).some((o) => o.value === texto);
  if (yaEsta) return false;
  const opcion = document.createElement('option');
  opcion.value = texto;
  opcion.textContent = texto + ' (archivado)';
  select.appendChild(opcion);
  return true;
};

window.restarUnDia = function (fechaISO) {
  const fecha = new Date(`${fechaISO}T00:00:00`);
  fecha.setDate(fecha.getDate() - 1);
  const yyyy = fecha.getFullYear();
  const mm = String(fecha.getMonth() + 1).padStart(2, '0');
  const dd = String(fecha.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

window.descargarArchivo = function (blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

window.exportarCSV = function (datos, nombre) {
  if (!datos.length) {
    window.showError('No hay datos para exportar');
    return;
  }
  const headers = Object.keys(datos[0]);
  const filas = datos.map((fila) => headers.map((h) => JSON.stringify(fila[h] ?? '')).join(','));
  const csv = [headers.join(','), ...filas].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  window.descargarArchivo(blob, nombre);
};

// Redondea a centavos (2 decimales). toPrecision(15) quita el ruido de punto flotante antes de redondear, así 1.005 da 1.01 y
// 1.1 * 1.1 da 1.21. Valores no numéricos dan 0 y nunca devuelve -0.
window.redondearCentavos = function (valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return 0;
  const redondeado = Math.round(Number((n * 100).toPrecision(15))) / 100;
  return redondeado === 0 ? 0 : redondeado;
};

// Criterio único de saldo de CxP: menos de un centavo se considera liquidado (residuos de decimales). Solo decide si el saldo
// cuenta como pendiente; no cambia cómo se suman los saldos ni los datos guardados. El 1e-9 absorbe el error de punto flotante
// en 0.01. Vive aquí (y no en cxp.js) para que Pagos y CxP lo usen sin depender del orden de carga.
window.SALDO_MINIMO_PENDIENTE_CXP = 0.01;
window.esLiquidadoCxP = function (saldo) {
  return (Number(saldo) || 0) + 1e-9 < window.SALDO_MINIMO_PENDIENTE_CXP;
};

window.calcularIvaProrrateado = function (montoMovimiento, totalDocumento, ivaDocumento) {
  const total = Number(totalDocumento) || 0;
  return total > 0 ? (Number(montoMovimiento) / total) * (Number(ivaDocumento) || 0) : 0;
};

// Orden del DETALLE de Báscula y Pagos (Vista para captura, CSV, TXT y PDF): proveedor A-Z y luego ticket ascendente, sin
// agrupar por fecha. DEVUELVE UNA COPIA ordenada: nunca modifica `registros`, para no alterar el orden de la tabla en pantalla.
//  - Proveedor: se compara el nombre ya resuelto por PROVEEDORES_ALIAS (window.normalizarProveedor), así las variantes del
//    mismo proveedor quedan juntas, con localeCompare('es', { sensitivity: 'base' }) (sin distinguir mayúsculas ni acentos).
//  - Ticket: como número cuando AMBOS son enteros (999 < 1000 < 1010; se compara por dígitos, sin perder precisión ni tropezar
//    con ceros a la izquierda); un ticket no numérico va después de todos los numéricos y entre ellos se ordena como texto.
//  - Desempate estable: por fecha (campoFecha, por omisión 'fechaSalida'; Pagos usa 'fecha') y, si aún empatan, por la
//    posición original.
window.ordenarPorProveedorTicket = function (registros, campoProveedor, campoTicket, campoFecha) {
  const proveedorDe = campoProveedor || 'proveedor';
  const ticketDe = campoTicket || 'ticket';
  const fechaDe = campoFecha || 'fechaSalida';
  const comparar = (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' });
  const enteroSinCeros = (ticket) => (/^\d+$/.test(ticket) ? (ticket.replace(/^0+/, '') || '0') : null);
  return (registros || [])
    .map((registro, posicion) => {
      const ticket = String(registro[ticketDe] === undefined || registro[ticketDe] === null ? '' : registro[ticketDe]).trim();
      return {
        registro,
        posicion,
        proveedor: window.normalizarProveedor(registro[proveedorDe]),
        ticket,
        entero: enteroSinCeros(ticket),
        fecha: String(registro[fechaDe] === undefined || registro[fechaDe] === null ? '' : registro[fechaDe])
      };
    })
    .sort((a, b) => {
      const porProveedor = comparar(a.proveedor, b.proveedor);
      if (porProveedor !== 0) return porProveedor;
      if (a.entero !== null && b.entero !== null) {
        if (a.entero.length !== b.entero.length) return a.entero.length - b.entero.length;
        if (a.entero !== b.entero) return a.entero < b.entero ? -1 : 1;
      } else if (a.entero !== null) {
        return -1;
      } else if (b.entero !== null) {
        return 1;
      } else {
        const porTexto = comparar(a.ticket, b.ticket);
        if (porTexto !== 0) return porTexto;
      }
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
      return a.posicion - b.posicion;
    })
    .map((item) => item.registro);
};

// Orden cronológico por captura (del más antiguo al más reciente) según `fechaRegistro`, el timestamp ISO que guardarDato
// agrega a todo registro nuevo. Los registros que no lo tienen (anteriores a ese campo) van al inicio, en su orden original,
// sin intentar reconstruirlo. DEVUELVE UNA COPIA: nunca modifica `registros`. Desempate estable por posición original.
window.ordenarPorCaptura = function (registros) {
  const marcaDe = (registro) => {
    const valor = registro && registro.fechaRegistro;
    if (valor && typeof valor.toMillis === 'function') return valor.toMillis();
    const ms = typeof valor === 'string' ? Date.parse(valor) : NaN;
    return Number.isFinite(ms) ? ms : null;
  };
  return (registros || [])
    .map((registro, posicion) => ({ registro, posicion, marca: marcaDe(registro) }))
    .sort((a, b) => {
      if (a.marca === null && b.marca === null) return a.posicion - b.posicion;
      if (a.marca === null) return -1;
      if (b.marca === null) return 1;
      return a.marca - b.marca || a.posicion - b.posicion;
    })
    .map((item) => item.registro);
};

// Logo institucional de los PDF (window.LOGO_EMPRESA, js/config.js) como data URL PNG, con caché en memoria. Devuelve null si
// no se puede leer (sin red o archivo ausente): el PDF sale entonces solo con texto.
let logoEmpresaEnCache = null;
window.cargarLogoEmpresa = async function () {
  if (logoEmpresaEnCache) return logoEmpresaEnCache;
  try {
    if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return null;
    const respuesta = await fetch(window.LOGO_EMPRESA.archivo);
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    logoEmpresaEnCache = await new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(lector.error);
      lector.readAsDataURL(blob);
    });
  } catch (error) {
    return null;
  }
  return logoEmpresaEnCache;
};

// Medidas { ancho, alto } (en la unidad del PDF) con las que cabe el logo dentro de una caja anchoMax × altoMax sin deformarlo.
window.medidasLogoEmpresa = function (anchoMax, altoMax) {
  const { ancho, alto } = window.LOGO_EMPRESA;
  const escala = Math.min(anchoMax / ancho, altoMax / alto);
  return { ancho: ancho * escala, alto: alto * escala };
};

window.guardarDato = async function (coleccion, datos) {
  const datosCompletos = { ...datos };
  if (!datosCompletos.fechaRegistro) {
    datosCompletos.fechaRegistro = new Date().toISOString();
  }
  const ref = await window.db.collection(coleccion).add(datosCompletos);
  return ref.id;
};

window.actualizarDato = async function (coleccion, id, datos) {
  await window.db.collection(coleccion).doc(id).update(datos);
};

window.eliminarDato = async function (coleccion, id) {
  await window.db.collection(coleccion).doc(id).delete();
};

// Contador diario de lecturas a Firestore (plan Spark: tope de 50,000 al día). Solo mide: suma los documentos que
// devuelve el servidor (lo que viene de la caché local, metadata.fromCache, no se factura y no se cuenta) y no cambia
// la carga. El acumulado del día vive en localStorage con clave por fecha local ('eve_lecturas_AAAA-MM-DD'): total,
// número de cargas y desglose por colección y por motivo. Las claves de días anteriores se borran solas.
// Motivos: 'login' (inicio de sesión), 'recarga' (la página cargó con la sesión ya activa), 'actualizacion-sw' (recarga
// al aceptar el aviso de actualización del service worker; index.html deja la bandera en sessionStorage) y 'consulta'
// (lecturas posteriores a la carga inicial: Admin, importadores...). Ver window.verLecturas().
window.EVE_LECTURAS = (function () {
  const PREFIJO = 'eve_lecturas_';
  const BANDERA_MOTIVO = 'eve_motivo_carga';
  const TOPE_DIARIO = 50000;

  function claveDeHoy() {
    const d = new Date();
    return PREFIJO + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  let motivo = 'recarga';
  try {
    if (window.sessionStorage.getItem(BANDERA_MOTIVO) === 'actualizacion-sw') motivo = 'actualizacion-sw';
    window.sessionStorage.removeItem(BANDERA_MOTIVO);
  } catch (error) { /* sessionStorage no disponible: queda 'recarga' */ }

  function leerHoy() {
    const clave = claveDeHoy();
    let datos = null;
    try {
      datos = JSON.parse(window.localStorage.getItem(clave));
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const otra = window.localStorage.key(i);
        if (otra && otra.indexOf(PREFIJO) === 0 && otra !== clave) window.localStorage.removeItem(otra);
      }
    } catch (error) { /* localStorage no disponible o JSON dañado: se empieza de cero */ }
    if (!datos || typeof datos !== 'object') datos = {};
    return { clave, total: Number(datos.total) || 0, cargas: Number(datos.cargas) || 0, porColeccion: datos.porColeccion || {}, porMotivo: datos.porMotivo || {} };
  }

  function guardar(datos) {
    try {
      window.localStorage.setItem(datos.clave, JSON.stringify({ fecha: datos.clave.slice(PREFIJO.length), total: datos.total, cargas: datos.cargas, porColeccion: datos.porColeccion, porMotivo: datos.porMotivo }));
    } catch (error) { /* localStorage no disponible: no se acumula */ }
  }

  function entradaDeMotivo(datos) {
    if (!datos.porMotivo[motivo]) datos.porMotivo[motivo] = { lecturas: 0, cargas: 0 };
    return datos.porMotivo[motivo];
  }

  return {
    TOPE_DIARIO,
    // snapshot de una consulta (size) o de un documento (cuenta 1). Nunca lanza: medir no debe romper la carga.
    contar(coleccion, snapshot) {
      try {
        if (!snapshot || (snapshot.metadata && snapshot.metadata.fromCache)) return;
        const n = typeof snapshot.size === 'number' ? snapshot.size : 1;
        if (n <= 0) return;
        const datos = leerHoy();
        datos.total += n;
        datos.porColeccion[coleccion] = (Number(datos.porColeccion[coleccion]) || 0) + n;
        entradaDeMotivo(datos).lecturas += n;
        guardar(datos);
      } catch (error) { /* solo mide */ }
    },
    iniciarCarga() {
      try {
        const datos = leerHoy();
        datos.cargas += 1;
        entradaDeMotivo(datos).cargas += 1;
        guardar(datos);
      } catch (error) { /* solo mide */ }
    },
    marcarMotivo(nuevo) { motivo = nuevo; },
    terminarCarga() { motivo = 'consulta'; },
    resumen() { return leerHoy(); }
  };
})();

window.verLecturas = function () {
  const datos = window.EVE_LECTURAS.resumen();
  const porColeccion = {};
  Object.keys(datos.porColeccion).sort((a, b) => datos.porColeccion[b] - datos.porColeccion[a])
    .forEach((c) => { porColeccion[c] = { lecturas: datos.porColeccion[c] }; });
  console.table(porColeccion);
  console.table(datos.porMotivo);
  const porcentaje = (datos.total / window.EVE_LECTURAS.TOPE_DIARIO) * 100;
  console.log('Lecturas de hoy: ' + datos.total.toLocaleString('en-US') + ' en ' + datos.cargas + ' cargas completas — '
    + porcentaje.toFixed(1) + '% de ' + window.EVE_LECTURAS.TOPE_DIARIO.toLocaleString('en-US'));
  return datos;
};

window.cargarDatos = async function (coleccion) {
  const snapshot = await window.db.collection(coleccion).get();
  window.EVE_LECTURAS.contar(coleccion, snapshot);
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
};

function mostrarToast(mensaje, claseTipo, duracionMs) {
  const contenedor = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${claseTipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);
  setTimeout(() => toast.remove(), duracionMs);
}

window.showSuccess = function (mensaje) {
  mostrarToast(mensaje, 'toast-success', 3000);
};

window.showError = function (mensaje) {
  mostrarToast(mensaje, 'toast-error', 4000);
};

// Protección contra doble registro de un formulario de alta. Un doble clic (o un clic impaciente tras guardar) no debe crear
// dos registros ni consumir dos folios. `clave` es única por formulario ('bascula', 'pagos', 'ventas'...); `accion` es la
// función async que valida lo necesario y guarda. Dos candados:
//  1) Mientras la acción está en curso se ignora en silencio cualquier clic adicional. El candado se toma de forma síncrona
//     en la primera llamada, antes de cualquier await.
//  2) Tras un guardado exitoso, esa misma clave rechaza nuevos registros durante ENFRIAMIENTO_DOBLE_REGISTRO_MS y avisa con
//     un toast breve.
// Una acción falla si lanza error (se relanza tras liberar el candado) o si devuelve exactamente false, para los handlers
// que atrapan su propio error y muestran un mensaje: en ambos casos se libera de inmediato y no hay enfriamiento. El
// enfriamiento es por clave, no global. Devuelve lo que devuelva la acción, o undefined si la llamada se ignoró.
const registrosEnCurso = new Set();
const enfriamientoHasta = new Map();

window.protegerContraDobleRegistro = async function (clave, accion) {
  if (registrosEnCurso.has(clave)) return undefined;
  if (Date.now() < (enfriamientoHasta.get(clave) || 0)) {
    mostrarToast('Registro ya guardado, espera un momento', 'toast-success', 2000);
    return undefined;
  }
  registrosEnCurso.add(clave);
  let resultado;
  try {
    resultado = await accion();
  } finally {
    registrosEnCurso.delete(clave);
  }
  if (resultado !== false) {
    enfriamientoHasta.set(clave, Date.now() + window.ENFRIAMIENTO_DOBLE_REGISTRO_MS);
  }
  return resultado;
};

// No se auto-elimina: espera a que la persona decida recargar, para no
// interrumpirla a mitad de una captura.
window.showUpdateAvailable = function (alActualizar) {
  const contenedor = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast toast-update';
  const texto = document.createElement('span');
  texto.textContent = '🔄 Nueva versión disponible';
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.textContent = 'Actualizar';
  boton.addEventListener('click', function () {
    toast.remove();
    alActualizar();
  });
  toast.appendChild(texto);
  toast.appendChild(boton);
  contenedor.appendChild(toast);
};

// Orden de las ventas más recientes primero: fecha descendente y, si dos ventas tienen la misma fecha, folio descendente (comparación
// numérica: V-2026-048 antes que V-2026-046). Lo usan la tabla de Ventas y el reporte compartido de js/reportes.js, así que ambos
// salen en el mismo orden y el empate ya no depende del navegador.
window.compararVentasRecientes = function (a, b) {
  const fechaA = String((a && a.fecha) || '');
  const fechaB = String((b && b.fecha) || '');
  if (fechaA !== fechaB) return fechaA < fechaB ? 1 : -1;
  return String((b && b.folio) || '').localeCompare(String((a && a.folio) || ''), 'es', { numeric: true, sensitivity: 'base' });
};

// ── Alerta de posible duplicado en la captura ───────────────────────────────────────────────────────────────────────────────
// Es un AVISO, no un bloqueo: antes de guardar un registro nuevo se compara contra lo que ya está cargado en memoria (últimos 30
// días, sin lecturas nuevas a Firestore) y contra lo pendiente en la cola offline. Si coinciden 4 o más campos independientes se
// muestra el modal «Posible duplicado» con el registro existente y se deja elegir. Los campos derivados (el total de una venta) no
// cuentan. Un campo vacío de cualquiera de los dos lados nunca cuenta como coincidencia.
(function () {
  const MODULOS_DUPLICADO = {
    ventas: { coleccion: 'ventas', nombre: 'venta', memoria: () => window.EVE.ventas },
    pagos: { coleccion: 'pagos', nombre: 'pago', memoria: () => window.EVE.registrosPagos },
    cobros: { coleccion: 'cobros', nombre: 'cobro', memoria: () => window.EVE.cobros },
    gastos: { coleccion: 'gastos', nombre: 'gasto', memoria: () => window.EVE.gastos },
    recibos: { coleccion: 'recibos_dinero', nombre: 'recibo de dinero', memoria: () => window.EVE.recibosDinero },
    oc: { coleccion: 'ordenes_compra', nombre: 'orden de compra', memoria: () => window.EVE.ordenesCompra }
  };

  const MINIMO_COINCIDENCIAS = 4;
  const TOLERANCIA_FECHA_DIAS = 1; // Ventas y Gastos: una diferencia de ±1 día cuenta como la misma fecha

  // Criterio contra falsos positivos con compras y ventas recurrentes. Cada módulo tiene campos OBLIGATORIOS: sin ellos no hay alerta,
  // y con ellos hacen falta además campos suficientes para llegar a 4 coincidencias en total.
  //   Ventas: cantidad de la línea + fecha (±1 día) | resto: cliente, material, precio unitario (al menos 2 de los 3)
  //   Gastos: monto + fecha (±1 día) | resto: proveedor, concepto, categoría (al menos 2 de los 3)
  //   Cobros: monto | resto: fecha, cliente, folio, forma de pago (al menos 3 de los 4)
  //   Recibos: monto | resto: fecha, cliente, concepto, categoría (al menos 3 de los 4)
  //   Órdenes de compra: sus 4 campos deben coincidir (el monto es uno de ellos)
  //   Pagos (reglas propias, ver abajo): kg obligatorio | resto: fecha, proveedor, material, precio, monto pagado, ticket
  //     - Si AMBOS registros traen ticket y los tickets son distintos: NO es duplicado (aunque todo lo demás coincida).
  //     - Mismo ticket con distinto material: NO es duplicado.
  //     - Mismo ticket + proveedor + material: un ticket puede tener dos pagos legítimos (p. ej. primero con anticipo aplicado y luego
  //       la liquidación, con los mismos kg y precio), así que NO se alerta por eso solo. Alerta únicamente si además coincide el MONTO
  //       PAGADO, y no si el ticket aún tiene saldo pendiente (su CxP o la suma de sus pagos queda por debajo del total) ni si el pago
  //       nuevo se captura aplicando anticipo o saldo a favor.
  //     - Si falta el ticket en alguno de los dos: regla general, 4 o más campos con kg obligatorio.
  //     - Los anticipos (origen 'anticipo') y los abonos a saldo inicial no son tickets: nunca se comparan.
  const CAMPOS_OBLIGATORIOS = { ventas: ['cantidad', 'fecha'], gastos: ['monto', 'fecha'], pagos: ['kg'], cobros: ['monto'], recibos: ['monto'] };

  function textoDup(valor) {
    return String(valor === undefined || valor === null ? '' : valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function numeroDup(valor) {
    if (valor === '' || valor === undefined || valor === null) return null;
    const n = Number(valor);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  // Días desde 1970 de una fecha ISO (aaaa-mm-dd); null si no lo es.
  function diasDe(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : null;
  }

  // Valor normalizado de un campo ('t' texto, 'n' número, 'f' fecha con tolerancia). null = vacío: no cuenta como coincidencia.
  function valorDup(campo, registro) {
    const bruto = campo[1](registro);
    if (campo[2] === 'n') return numeroDup(bruto);
    const t = textoDup(bruto);
    return t === '' ? null : t;
  }

  function igualDup(campo, a, b) {
    if (a === null || b === null) return false;
    if (campo[2] === 'f') {
      const dia1 = diasDe(a);
      const dia2 = diasDe(b);
      return dia1 !== null && dia2 !== null && Math.abs(dia1 - dia2) <= TOLERANCIA_FECHA_DIAS;
    }
    return a === b;
  }

  const coincideCampo = (campo, x, y) => igualDup(campo, valorDup(campo, x), valorDup(campo, y));

  const nombreDe = (valor) => (valor && typeof valor === 'object' ? valor.nombre : valor);
  const conceptoOC = (r) => (Array.isArray(r.partidas) ? r.partidas.map((p) => (p && (p.producto || p.descripcion)) || '').filter(Boolean).join(' | ') : r.concepto);

  // Campos independientes por módulo: [clave, extractor, tipo]
  const CAMPOS_DUPLICADO = {
    pagos: [
      ['fecha', (r) => r.fecha, 't'], ['proveedor', (r) => r.proveedor, 't'], ['material', (r) => r.material, 't'],
      ['kg', (r) => r.kg, 'n'], ['precio', (r) => r.precioPorKg, 'n'], ['pagado', (r) => r.pagado, 'n'], ['ticket', (r) => r.ticket, 't']
    ],
    cobros: [
      ['fecha', (r) => r.fecha, 't'], ['cliente', (r) => r.cliente, 't'], ['folio', (r) => r.folio, 't'],
      ['monto', (r) => r.pagado, 'n'], ['formaPago', (r) => r.referencia, 't']
    ],
    gastos: [
      ['fecha', (r) => r.fecha, 'f'], ['proveedor', (r) => r.beneficiario, 't'], ['monto', (r) => r.montoBase, 'n'],
      ['concepto', (r) => r.concepto, 't'], ['categoria', (r) => r.tipoGasto, 't']
    ],
    recibos: [
      ['fecha', (r) => r.fecha, 't'], ['cliente', (r) => nombreDe(r.cliente), 't'], ['monto', (r) => r.importe, 'n'],
      ['concepto', (r) => r.concepto, 't'], ['categoria', (r) => r.tipo, 't']
    ],
    // La orden de compra no tiene categoría: se comparan 4 campos y deben coincidir los cuatro.
    oc: [
      ['fecha', (r) => r.fecha, 't'], ['proveedor', (r) => nombreDe(r.proveedor), 't'],
      ['monto', (r) => (r.totales ? r.totales.total : r.monto), 'n'], ['concepto', conceptoOC, 't']
    ]
  };

  // Ventas: fecha (±1 día) y cliente de la venta + la mejor pareja de líneas (material, cantidad, precio unitario). El total no cuenta.
  // Solo se consideran parejas de líneas con la MISMA cantidad (campo obligatorio): sin ella no hay coincidencias.
  function coincidenciasVenta(nuevo, existente) {
    const camposVenta = [['fecha', (r) => r.fecha, 'f'], ['cliente', (r) => r.cliente, 't']];
    const coincidencias = camposVenta.filter((c) => coincideCampo(c, nuevo, existente)).map((c) => c[0]);
    const camposLinea = [['material', (l) => l.material, 't'], ['cantidad', (l) => l.cantidad, 'n'], ['precioUnitario', (l) => l.precioUnitario, 'n']];
    let mejor = [];
    (nuevo.lineas || []).forEach((ln) => {
      (existente.lineas || []).forEach((le) => {
        const iguales = camposLinea.filter((c) => coincideCampo(c, ln, le)).map((c) => c[0]);
        if (!iguales.includes('cantidad')) return;
        if (iguales.length > mejor.length) mejor = iguales;
      });
    });
    return mejor.length === 0 ? [] : coincidencias.concat(mejor);
  }

  function coincidenciasGenerico(modulo, nuevo, existente) {
    return CAMPOS_DUPLICADO[modulo].filter((c) => coincideCampo(c, nuevo, existente)).map((c) => c[0]);
  }

  const estaExcluido = (r) => !r || r.revertido === true || r.eliminado === true || /^cancelad/i.test(String(r.estado || ''));

  // Pagos: un anticipo (origen 'anticipo') y un abono a saldo inicial no son tickets.
  const esAnticipoOSaldoInicial = (r) => !!r && (r.origen === 'anticipo' || r.abonoSaldoInicial === true);
  // Pago que se captura aplicando anticipo o saldo a favor del proveedor.
  const aplicaAnticipoOSaldo = (r) => !!r && (r.origen === 'anticipo' || r.aplicaAnticipo === true || r.aplicaSaldoAFavor === true
    || Number(r.saldoAFavorAplicado) > 0 || /^saldo a favor/i.test(String(r.referencia || '')));

  // ¿El ticket aún debe algo? Sí si la suma de sus pagos (sin revertidos) no alcanza su total, o si su cuenta por pagar tiene saldo.
  function ticketConSaldoPendiente(ticket, proveedor, referencia) {
    const t = textoDup(ticket);
    const p = textoDup(proveedor);
    const pagos = (referencia || []).filter((r) => !estaExcluido(r) && !esAnticipoOSaldoInicial(r) && textoDup(r.ticket) === t && textoDup(r.proveedor) === p);
    const total = pagos.reduce((mayor, r) => Math.max(mayor, Number(r.total) || 0), 0);
    const pagado = pagos.reduce((suma, r) => suma + (Number(r.pagado) || 0), 0);
    if (total > 0 && pagado < total - 0.005) return true;
    const cuentas = (window.EVE && window.EVE.cuentasPorPagar) || [];
    const cxp = cuentas.find((c) => textoDup(c.ticket) === t && textoDup(c.proveedor) === p);
    return !!cxp && Number(cxp.saldo) > 0.005;
  }

  // Un cobro de CxC reparte un mismo monto en un documento por partida (mismo grupoPagoId): se compara la SUMA del grupo.
  function agruparCobros(lista) {
    const grupos = new Map();
    lista.forEach((c) => {
      const clave = c.grupoPagoId || c.id || Math.random();
      if (!grupos.has(clave)) grupos.set(clave, { ...c, pagado: 0, _folios: new Set() });
      const g = grupos.get(clave);
      g.pagado += Number(c.pagado) || 0;
      if (c.folio) g._folios.add(c.folio);
    });
    return Array.from(grupos.values()).map((g) => ({ ...g, folio: g._folios.size === 1 ? Array.from(g._folios)[0] : '' }));
  }

  // Devuelve null si no hay un posible duplicado, o { registro, coincidencias, directa } con el existente más parecido.
  // `existentes` son los registros contra los que se compara (memoria + cola offline); aquí se aplican la ventana de 30 días (o ±1 día
  // de la fecha del nuevo) y los descartes de revertidos, eliminados y cancelados. `contexto` (opcional, por omisión `existentes`) es la
  // lista completa con la que Pagos decide si el ticket aún tiene saldo pendiente.
  window.detectarPosibleDuplicado = function (modulo, registroNuevo, existentes, contexto) {
    if (!MODULOS_DUPLICADO[modulo] || !registroNuevo) return null;
    if (modulo === 'pagos' && (esAnticipoOSaldoInicial(registroNuevo) || aplicaAnticipoOSaldo(registroNuevo))) return null;
    const referencia = contexto || existentes || [];
    const inicio = window.obtenerInicioUltimos30Dias();
    const diaNuevo = diasDe(registroNuevo.fecha);
    const cercaDeLaFecha = (r) => {
      const dia = diasDe(r.fecha);
      return diaNuevo !== null && dia !== null && Math.abs(dia - diaNuevo) <= TOLERANCIA_FECHA_DIAS;
    };
    let lista = (existentes || []).filter((r) => !estaExcluido(r) && r !== registroNuevo && !(modulo === 'pagos' && esAnticipoOSaldoInicial(r))
      && (String(r.fecha || '') >= inicio || cercaDeLaFecha(r)));
    if (modulo === 'cobros') lista = agruparCobros(lista);
    let mejor = null;
    lista.forEach((existente) => {
      const coincidencias = modulo === 'ventas' ? coincidenciasVenta(registroNuevo, existente) : coincidenciasGenerico(modulo, registroNuevo, existente);
      let directa = false;
      if (modulo === 'pagos') {
        const ticketNuevo = textoDup(registroNuevo.ticket);
        const ticketExistente = textoDup(existente.ticket);
        if (ticketNuevo && ticketExistente) {
          // Tickets distintos: otro pago, aunque coincida todo lo demás.
          if (ticketNuevo !== ticketExistente) return;
          // Un mismo ticket con otro material es un pago distinto y válido.
          const materialNuevo = textoDup(registroNuevo.material);
          const materialExistente = textoDup(existente.material);
          if (materialNuevo && materialExistente && materialNuevo !== materialExistente) return;
          if (coincidencias.includes('proveedor') && coincidencias.includes('material')) {
            // Mismo ticket, proveedor y material: solo es duplicado si también coincide el monto pagado y el ticket ya no debe nada.
            if (!coincidencias.includes('pagado')) return;
            if (ticketConSaldoPendiente(registroNuevo.ticket, registroNuevo.proveedor, referencia)) return;
            directa = true;
          }
        }
      }
      if (!directa) {
        if (coincidencias.length < MINIMO_COINCIDENCIAS) return;
        // Sin los campos obligatorios (cantidad, monto, fecha) no hay alerta.
        if (!(CAMPOS_OBLIGATORIOS[modulo] || []).every((c) => coincidencias.includes(c))) return;
      }
      if (!mejor || (directa && !mejor.directa) || (directa === mejor.directa && coincidencias.length > mejor.coincidencias.length)) {
        mejor = { registro: existente, coincidencias, directa };
      }
    });
    return mejor;
  };

  window.moduloDuplicadoDeColeccion = function (coleccion) {
    return Object.keys(MODULOS_DUPLICADO).find((m) => MODULOS_DUPLICADO[m].coleccion === coleccion) || null;
  };

  // Registros en memoria del módulo SIN los capturados sin conexión (id 'offline_…'): esos se leen de la cola, que los trae completos.
  window.obtenerExistentesEnMemoria = function (modulo) {
    const definicion = MODULOS_DUPLICADO[modulo];
    const lista = (definicion && definicion.memoria()) || [];
    return lista.filter((r) => !String(r.id || '').startsWith('offline_'));
  };

  async function recopilarExistentes(modulo) {
    const existentes = window.obtenerExistentesEnMemoria(modulo).slice();
    if (window.EVE_COLA_OFFLINE) {
      try {
        const pendientes = await window.EVE_COLA_OFFLINE.obtenerPendientes();
        pendientes.filter((p) => p.coleccion === MODULOS_DUPLICADO[modulo].coleccion).forEach((p) => existentes.push({ ...p.datos, _pendienteOffline: true }));
      } catch (error) { /* sin cola legible: se compara solo contra memoria */ }
    }
    return existentes;
  }

  // Para la sincronización de la cola offline: ¿este registro encolado coincide con uno ya existente o ya subido en esta sincronización?
  window.revisarItemColaDuplicado = function (coleccion, datos, subidosEnEstaSincronizacion) {
    const modulo = window.moduloDuplicadoDeColeccion(coleccion);
    if (!modulo || !datos || datos.duplicadoConfirmado) return null;
    const subidos = (subidosEnEstaSincronizacion && subidosEnEstaSincronizacion[modulo]) || [];
    return window.detectarPosibleDuplicado(modulo, datos, window.obtenerExistentesEnMemoria(modulo).concat(subidos));
  };

  const ETIQUETAS_CAMPO = { fecha: 'fecha', cliente: 'cliente', proveedor: 'proveedor', material: 'material', cantidad: 'cantidad', precioUnitario: 'precio unitario',
    kg: 'kg', precio: 'precio', pagado: 'monto pagado', ticket: 'ticket', folio: 'folio', monto: 'monto', formaPago: 'forma de pago', concepto: 'concepto', categoria: 'categoría' };

  function elemento(tag, texto, estilo) {
    const el = document.createElement(tag);
    if (texto !== undefined) el.textContent = texto;
    if (estilo) el.style.cssText = estilo;
    return el;
  }

  function cuandoCapturado(registro) {
    if (registro._pendienteOffline) return 'pendiente de sincronizar (capturado sin conexión)';
    if (!registro.fechaRegistro) return '—';
    const fecha = new Date(registro.fechaRegistro);
    return Number.isNaN(fecha.getTime()) ? String(registro.fechaRegistro) : fecha.toLocaleString('es-MX');
  }

  // Modal «Posible duplicado». Devuelve una promesa: true = «Es otro registro, guardar», false = «Cancelar» (también con Escape).
  function mostrarModalDuplicado(modulo, duplicado) {
    return new Promise((resolver) => {
      const r = duplicado.registro;
      const fondo = elemento('div', undefined, 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:1rem;');
      fondo.id = 'modal-posible-duplicado';
      fondo.setAttribute('role', 'dialog');
      fondo.setAttribute('aria-modal', 'true');
      const caja = elemento('div', undefined, 'background:#fff;color:#222;border-radius:8px;max-width:30rem;width:100%;padding:1.25rem;box-shadow:0 8px 30px rgba(0,0,0,.35);');
      caja.appendChild(elemento('h3', 'Posible duplicado', 'margin:0 0 .5rem 0;'));
      caja.appendChild(elemento('p', `Ya existe un ${MODULOS_DUPLICADO[modulo].nombre} muy parecido. Revisa antes de guardar.`));
      const lista = elemento('ul', undefined, 'margin:.5rem 0;padding-left:1.1rem;');
      const folio = r.folio || r.ticket || '—';
      [
        `Folio / ticket: ${folio}`,
        `Fecha: ${r.fecha ? window.formatearFecha(r.fecha) : '—'}`,
        `Capturó: ${r.registradoPor || r.creadoPor || r.usuario || '—'}`,
        `Cuándo: ${cuandoCapturado(r)}`,
        `Coinciden: ${duplicado.coincidencias.map((c) => ETIQUETAS_CAMPO[c] || c).join(', ')}${duplicado.directa ? ' (mismo ticket, proveedor, material y monto pagado)' : ''}`
      ].forEach((linea) => lista.appendChild(elemento('li', linea)));
      caja.appendChild(lista);
      const botones = elemento('div', undefined, 'display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:1rem;');
      const cancelar = elemento('button', 'Cancelar');
      cancelar.type = 'button';
      cancelar.className = 'btn-secondary';
      const guardar = elemento('button', 'Es otro registro, guardar');
      guardar.type = 'button';
      guardar.className = 'btn-primary';
      const cerrar = (valor) => { document.removeEventListener('keydown', alTeclear, true); fondo.remove(); resolver(valor); };
      const alTeclear = (evento) => { if (evento.key === 'Escape') { evento.preventDefault(); cerrar(false); } };
      cancelar.addEventListener('click', () => cerrar(false));
      guardar.addEventListener('click', () => cerrar(true));
      document.addEventListener('keydown', alTeclear, true);
      botones.appendChild(cancelar);
      botones.appendChild(guardar);
      caja.appendChild(botones);
      fondo.appendChild(caja);
      document.body.appendChild(fondo);
      cancelar.focus();
    });
  }

  // Punto de entrada para los formularios. Devuelve { continuar, confirmado }: continuar=false si la persona cancela; confirmado=true
  // si guardó a pesar del aviso (el llamador agrega duplicadoConfirmado: true al registro). Un fallo interno nunca bloquea el guardado.
  window.revisarPosibleDuplicado = async function (modulo, registroNuevo) {
    let duplicado = null;
    try {
      duplicado = window.detectarPosibleDuplicado(modulo, registroNuevo, await recopilarExistentes(modulo));
    } catch (error) {
      console.warn('[alerta de duplicados] No se pudo revisar; se guarda sin aviso:', error);
      return { continuar: true, confirmado: false };
    }
    if (!duplicado) return { continuar: true, confirmado: false };
    const guardar = await mostrarModalDuplicado(modulo, duplicado);
    return { continuar: guardar, confirmado: guardar };
  };
})();

// Escapa un valor para ponerlo DENTRO de una cadena que se asigna a innerHTML (texto de una celda, de un <h3>, de un mensaje…): lo que
// escribe una persona (cliente, ticket, motivo, usuario) o trae un mensaje de error se muestra tal cual como texto y nunca se interpreta
// como HTML. Escapa & < > " ' (sirve también dentro de un atributo entre comillas). null y undefined dan ''. Preferible a innerHTML:
// construir los nodos con createElement + textContent; úsala solo donde el HTML ya estaba armado como cadena.
window.escaparHtml = function (valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// ── Montos sin IVA (regla de negocio: ventas, cobrado y pagado se muestran siempre sin IVA) ──────────────────────────────
// Una sola definición para Ventas, Reportes, Dashboard y Flujo. Los cobros se convierten a base prorrateando:
// pagado × subtotal / total de la cuenta por cobrar (cubre también el IVA retenido).
const numeroSinIva = (valor) => { const n = Number(valor); return Number.isFinite(n) ? n : 0; };

// Descuentos posteriores a la venta (venta.descuentos, ver EVE_CXC.aplicarDescuentoVenta). Un descuento revertido no cuenta.
// Se atribuyen al mes de la FECHA DE LA VENTA (no al de la fecha del descuento) y a la partida indicada: el descuento no es un cobro,
// así que Flujo de efectivo no lo ve; solo restan de las ventas netas.
window.descuentosActivosVenta = function (venta) {
  return (venta && Array.isArray(venta.descuentos) ? venta.descuentos : []).filter((d) => d && d.revertido !== true);
};

// Descuento activo de una partida (línea) de la venta. Sin lineaIndex en el descuento, cae en la primera línea del mismo material.
window.descuentoLineaVenta = function (venta, indice) {
  const lineas = venta && Array.isArray(venta.lineas) ? venta.lineas : [];
  return window.descuentosActivosVenta(venta).reduce((suma, d) => {
    const destino = Number.isInteger(d.lineaIndex) ? d.lineaIndex : lineas.findIndex((l) => l && l.material === d.material);
    return destino === indice ? suma + numeroSinIva(d.monto) : suma;
  }, 0);
};

// Subtotal (sin IVA) de una línea de venta: su subtotal guardado o, si falta, cantidad × precioUnitario. Si se pasa la venta y el
// índice de la línea, el resultado es NETO: resta los descuentos no revertidos de esa partida.
window.subtotalLineaVenta = function (linea, venta, indice) {
  const l = linea || {};
  const bruto = l.subtotal !== undefined && l.subtotal !== null ? numeroSinIva(l.subtotal) : numeroSinIva(l.cantidad) * numeroSinIva(l.precioUnitario);
  return venta && Number.isInteger(indice) ? bruto - window.descuentoLineaVenta(venta, indice) : bruto;
};

// Subtotal (sin IVA) NETO de una venta: suma de los subtotales de sus líneas menos los descuentos no revertidos. Una venta sin
// líneas devuelve null para poder marcarla (no se suma en silencio).
window.subtotalVenta = function (venta) {
  const lineas = venta && Array.isArray(venta.lineas) ? venta.lineas : [];
  if (lineas.length === 0) return null;
  return lineas.reduce((suma, l, indice) => suma + window.subtotalLineaVenta(l, venta, indice), 0);
};

// Subtotal de una cuenta por cobrar: el guardado o total − IVA trasladado + IVA retenido.
function subtotalCuentaPorCobrar(cuenta) {
  return cuenta.subtotal !== undefined && cuenta.subtotal !== null
    ? numeroSinIva(cuenta.subtotal)
    : numeroSinIva(cuenta.total) - numeroSinIva(cuenta.ivaTrasladado) + numeroSinIva(cuenta.ivaRetenido);
}

// Parte sin IVA de un abono o cobro de una cuenta por cobrar: monto × subtotal / total de la cuenta.
window.montoSinIvaDeAbono = function (abono, cuenta) {
  const monto = numeroSinIva(abono && abono.monto);
  if (cuenta && numeroSinIva(cuenta.total) > 0) return monto * subtotalCuentaPorCobrar(cuenta) / numeroSinIva(cuenta.total);
  return monto;
};

// Cobro (colección cobros) sin IVA. Un anticipo de cliente (origen 'anticipo') cuenta completo. Si no, por cxcId:
// pagado × subtotal / total de la cuenta; si no hay cuenta, la línea de venta (pagado × subtotal / totalLinea); si tampoco, pagado − iva.
window.cobroSinIva = function (cobro, cuentasPorCobrar, ventas) {
  const c = cobro || {};
  if (c.pagado === undefined || c.pagado === null) {
    const alterno = [c.monto, c.cobrado, c.total].find((v) => v !== undefined && v !== null);
    return numeroSinIva(alterno);
  }
  const pagado = numeroSinIva(c.pagado);
  if (c.origen === 'anticipo') return pagado;
  const cuenta = (cuentasPorCobrar || []).find((x) => x.id === c.cxcId);
  if (cuenta && numeroSinIva(cuenta.total) > 0) return pagado * subtotalCuentaPorCobrar(cuenta) / numeroSinIva(cuenta.total);
  const venta = (ventas || []).find((v) => v.id === c.ventaId);
  const normalizar = (m) => String(m || '').trim().toUpperCase();
  const linea = venta && (venta.lineas || []).find((l) => normalizar(l.material) === normalizar(c.material));
  if (linea && numeroSinIva(linea.totalLinea) > 0) return pagado * window.subtotalLineaVenta(linea) / numeroSinIva(linea.totalLinea);
  return pagado - numeroSinIva(c.iva);
};
