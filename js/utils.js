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

window.obtenerInicioSemana = function () {
  const hoy = new Date(`${window.obtenerFechaMexico()}T00:00:00`);
  const diaSemana = hoy.getDay();
  const offset = diaSemana === 0 ? 6 : diaSemana - 1;
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - offset);
  const yyyy = lunes.getFullYear();
  const mm = String(lunes.getMonth() + 1).padStart(2, '0');
  const dd = String(lunes.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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

window.cargarDatos = async function (coleccion) {
  const snapshot = await window.db.collection(coleccion).get();
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
