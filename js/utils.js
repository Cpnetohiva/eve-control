window.formatearKg = function (valor, material) {
  const mat = (material || '').toString().trim().toUpperCase();
  const unidad = window.MATERIALES_PZ.includes(mat) ? 'PZ' : 'KG';
  return `${Number(valor).toLocaleString('es-MX')} ${unidad}`;
};

window.formatearMoneda = function (valor) {
  return Number(valor).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
};

window.formatearFecha = function (fechaISO) {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}/${mes}/${anio}`;
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
