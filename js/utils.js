window.formatearKg = function (valor, material) {
  const mat = (material || '').toString().trim().toUpperCase();
  const unidad = window.MATERIALES_PZ.includes(mat) ? 'PZ' : 'KG';
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

window.obtenerPrecioVigente = function (material, fecha) {
  const mat = (material || '').toString().trim().toUpperCase();
  return (window.EVE.precios || []).find((p) =>
    p.material.toUpperCase() === mat &&
    p.fechaInicio <= fecha &&
    (p.fechaFin === null || p.fechaFin >= fecha)
  ) || null;
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
  const mat = (material || '').toString().trim().toUpperCase();
  return window.EVE_RENDIMIENTOS.composicionVigenteParaMaterial(window.EVE.composiciones || [], mat, fecha);
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
