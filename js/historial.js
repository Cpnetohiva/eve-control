(function () {

const COLECCION = 'historial_cambios';

function formatearDiff(anterior, nuevo) {
  if (!anterior && !nuevo) return '—';
  const ignorar = new Set(['fechaRegistro', 'id']);
  const campos = new Set([
    ...Object.keys(anterior || {}),
    ...Object.keys(nuevo || {})
  ]);
  const diff = [];
  for (const campo of campos) {
    if (ignorar.has(campo)) continue;
    const va = anterior ? anterior[campo] : undefined;
    const vn = nuevo ? nuevo[campo] : undefined;
    if (String(va) !== String(vn)) {
      diff.push(`${campo}: ${va !== undefined ? va : '—'} → ${vn !== undefined ? vn : '—'}`);
    }
  }
  return diff.length ? diff.join(' | ') : 'Sin cambios de campo';
}

async function registrar({ coleccion, registroId, accion, valorAnterior, valorNuevo, motivo }) {
  const usuario = (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Sistema';
  const entrada = {
    coleccion,
    registroId: registroId || '',
    accion,
    valorAnterior: valorAnterior || null,
    valorNuevo: valorNuevo || null,
    motivo: motivo || '',
    usuario,
    timestamp: new Date().toISOString()
  };
  try {
    await window.db.collection(COLECCION).add(entrada);
  } catch (e) {
    console.warn('EVE historial: no se pudo guardar entrada', e);
  }
}

async function cargar(filtros) {
  filtros = filtros || {};
  let query = window.db.collection(COLECCION).orderBy('timestamp', 'desc').limit(200);
  const snapshot = await query.get();
  const todos = snapshot.docs.map(function (doc) { return Object.assign({ id: doc.id }, doc.data()); });
  if (filtros.coleccion) {
    return todos.filter(function (r) { return r.coleccion === filtros.coleccion; });
  }
  return todos;
}

function etiquetaAccion(accion) {
  var mapa = { edicion: 'Edición', eliminacion: 'Eliminación' };
  return mapa[accion] || accion;
}

function colorAccion(accion) {
  if (accion === 'eliminacion') return 'var(--rojo-error)';
  return 'var(--azul-claro)';
}

function renderizarTabla(registros, wrapper) {
  wrapper.innerHTML = '';
  if (!registros.length) {
    wrapper.innerHTML = '<p style="padding:1rem;color:#666">Sin registros en este período.</p>';
    return;
  }
  const resumen = document.createElement('p');
  resumen.style.cssText = 'padding:0.5rem 1rem;color:#666;font-size:0.85rem';
  resumen.textContent = registros.length + ' registros encontrados';
  wrapper.appendChild(resumen);

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.style.fontSize = '0.85rem';
  tabla.innerHTML = '<thead><tr>' +
    '<th>Fecha/Hora</th>' +
    '<th>Usuario</th>' +
    '<th>Módulo</th>' +
    '<th>Acción</th>' +
    '<th>Ticket</th>' +
    '<th>Motivo</th>' +
    '<th>Cambios</th>' +
    '</tr></thead>';
  const tbody = document.createElement('tbody');

  registros.forEach(function (r) {
    const fila = document.createElement('tr');
    const ticket = (r.valorAnterior && r.valorAnterior.ticket) ||
      (r.valorNuevo && r.valorNuevo.ticket) || '—';
    let fechaStr = r.timestamp;
    try {
      fechaStr = new Date(r.timestamp).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
    } catch (e) {}

    fila.innerHTML = '<td>' + fechaStr + '</td>' +
      '<td>' + (r.usuario || '—') + '</td>' +
      '<td>' + (r.coleccion || '—') + '</td>' +
      '<td><span style="color:' + colorAccion(r.accion) + ';font-weight:600">' + etiquetaAccion(r.accion) + '</span></td>' +
      '<td>' + ticket + '</td>' +
      '<td style="max-width:150px;word-break:break-word">' + (r.motivo || '—') + '</td>' +
      '<td style="max-width:250px;word-break:break-word;font-size:0.78rem">' + formatearDiff(r.valorAnterior, r.valorNuevo) + '</td>';
    tbody.appendChild(fila);
  });

  tabla.appendChild(tbody);
  wrapper.appendChild(tabla);
}

function crearVistaHistorial() {
  const contenedor = document.createElement('div');
  contenedor.className = 'historial-contenedor';

  const controles = document.createElement('div');
  controles.className = 'card historial-controles';

  const select = document.createElement('select');
  select.id = 'ht-coleccion';
  [
    { value: '', label: 'Todos los módulos' },
    { value: 'destaraje', label: 'Destaraje' },
    { value: 'pagos', label: 'Pagos' },
    { value: 'produccion', label: 'Producción' },
    { value: 'control_produccion', label: 'Control Producción' }
  ].forEach(function (op) {
    const opt = document.createElement('option');
    opt.value = op.value;
    opt.textContent = op.label;
    select.appendChild(opt);
  });

  const btnCargar = document.createElement('button');
  btnCargar.textContent = 'Cargar Historial';
  btnCargar.className = 'btn-primary';

  const btnCSV = document.createElement('button');
  btnCSV.textContent = 'Exportar CSV';
  btnCSV.className = 'btn-secondary';

  controles.appendChild(select);
  controles.appendChild(btnCargar);
  controles.appendChild(btnCSV);
  contenedor.appendChild(controles);

  const tabla = document.createElement('div');
  tabla.className = 'card';
  tabla.innerHTML = '<p style="padding:1rem;color:#666">Selecciona un módulo y presiona "Cargar Historial".</p>';
  contenedor.appendChild(tabla);

  var registrosCargados = [];

  btnCargar.addEventListener('click', async function () {
    const coleccion = document.getElementById('ht-coleccion').value;
    tabla.innerHTML = '<p style="padding:1rem">Cargando...</p>';
    try {
      registrosCargados = await cargar(coleccion ? { coleccion: coleccion } : {});
      renderizarTabla(registrosCargados, tabla);
    } catch (e) {
      tabla.innerHTML = '<p style="padding:1rem;color:var(--rojo-error)">Error al cargar: ' + e.message + '</p>';
    }
  });

  btnCSV.addEventListener('click', function () {
    if (!registrosCargados.length) {
      window.showError('Carga el historial primero');
      return;
    }
    const datos = registrosCargados.map(function (r) {
      const ticket = (r.valorAnterior && r.valorAnterior.ticket) ||
        (r.valorNuevo && r.valorNuevo.ticket) || '';
      return {
        Fecha: r.timestamp,
        Usuario: r.usuario || '',
        Modulo: r.coleccion || '',
        Accion: etiquetaAccion(r.accion),
        RegistroId: r.registroId || '',
        Ticket: ticket,
        Motivo: r.motivo || '',
        Cambios: formatearDiff(r.valorAnterior, r.valorNuevo)
      };
    });
    window.exportarCSV(datos, 'historial_' + window.obtenerFechaMexico() + '.csv');
  });

  return contenedor;
}

window.EVE_HISTORIAL = {
  registrar: registrar,
  crearVistaHistorial: crearVistaHistorial
};

})();
