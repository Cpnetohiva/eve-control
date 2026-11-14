(function () {

// Admin > Traslapes de precios: detector de vigencias traslapadas del catálogo de precios.
// El detector (EVE_PRECIOS.detectarTraslapes) es de SOLO LECTURA. Las dos acciones, cerrar un registro o eliminar un duplicado exacto,
// solo escriben tras una confirmación explícita y dejan registro de quién y cuándo (historial_cambios y, al cerrar, campos en el propio
// precio). Nunca se elimina el único registro de una fecha de inicio: solo se ofrece eliminar cuando hay otro idéntico en fecha.

const esc = (valor) => window.escaparHtml(valor);

function usuarioActual() {
  return (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
}

function descripcionRegistro(p) {
  return `${p.material} ${window.formatearMoneda(p.precio)} desde ${window.formatearFecha(p.fechaInicio)} hasta ${p.fechaFin ? window.formatearFecha(p.fechaFin) : 'abierto'}`;
}

// Cierra un precio en `fechaFin`. Revalida contra la memoria (que la pantalla acaba de releer del servidor).
async function cerrarRegistro(id, fechaFin, opciones) {
  const usuario = (opciones && opciones.usuario) || usuarioActual();
  const registro = (window.EVE.precios || []).find((p) => p.id === id);
  if (!registro) throw new Error('El precio ya no existe. Vuelve a buscar traslapes.');
  if (!fechaFin || fechaFin < registro.fechaInicio) throw new Error('La fecha de cierre no puede ser anterior al inicio del precio.');
  const anterior = { fechaFin: registro.fechaFin === undefined ? null : registro.fechaFin };
  const cambios = { fechaFin, cierreTraslapePor: usuario, cierreTraslapeEn: new Date().toISOString() };
  await window.actualizarDato('precios', id, cambios);
  Object.assign(registro, cambios);
  window.EVE_HISTORIAL.registrar({
    coleccion: 'precios', registroId: id, accion: 'edicion',
    valorAnterior: { material: registro.material, precio: registro.precio, fechaInicio: registro.fechaInicio, ...anterior },
    valorNuevo: { material: registro.material, precio: registro.precio, fechaInicio: registro.fechaInicio, fechaFin },
    motivo: 'Cierre por traslape de vigencias'
  });
}

// Elimina un precio SOLO si hay otro registro del mismo material con la misma fechaInicio (duplicado exacto).
async function eliminarDuplicado(id, opciones) {
  const registro = (window.EVE.precios || []).find((p) => p.id === id);
  if (!registro) throw new Error('El precio ya no existe. Vuelve a buscar traslapes.');
  const hermano = (window.EVE.precios || []).find((p) => p.id !== id && window.normalizarMaterial(p.material) === window.normalizarMaterial(registro.material) && p.fechaInicio === registro.fechaInicio);
  if (!hermano) throw new Error('No es un duplicado: es el único precio con esa fecha de inicio y no se elimina desde aquí.');
  await window.eliminarDato('precios', id);
  window.EVE.precios = window.EVE.precios.filter((p) => p.id !== id);
  window.EVE_HISTORIAL.registrar({
    coleccion: 'precios', registroId: id, accion: 'eliminacion',
    valorAnterior: { material: registro.material, precio: registro.precio, fechaInicio: registro.fechaInicio, fechaFin: registro.fechaFin === undefined ? null : registro.fechaFin, creadoPor: registro.creadoPor || '' },
    valorNuevo: null,
    motivo: `Duplicado exacto eliminado por ${(opciones && opciones.usuario) || usuarioActual()} (se conserva ${hermano.id})`
  });
}

function pintar(contenedor) {
  const grupos = window.EVE_PRECIOS.detectarTraslapes(window.EVE.precios);
  if (!grupos.length) {
    contenedor.innerHTML = '<p>No hay vigencias traslapadas en el catálogo de precios.</p>';
    return;
  }
  contenedor.innerHTML = '';
  const resumen = document.createElement('p');
  resumen.textContent = `${grupos.length} material(es) con vigencias traslapadas.`;
  contenedor.appendChild(resumen);
  grupos.forEach((grupo) => {
    const acciones = window.EVE_PRECIOS.accionesDeTraslape(grupo);
    const bloque = document.createElement('div');
    bloque.className = 'card';
    const filas = grupo.registros.map((p) => {
      const a = acciones.get(p.id);
      const botones = [
        a.cerrarA ? `<button type="button" class="btn-secondary" data-accion="cerrar" data-id="${esc(p.id)}" data-fecha="${esc(a.cerrarA)}">Cerrar al ${esc(window.formatearFecha(a.cerrarA))}</button>` : '',
        a.puedeEliminar ? `<button type="button" class="btn-secondary" data-accion="eliminar" data-id="${esc(p.id)}">Eliminar duplicado</button>` : ''
      ].join(' ');
      return `<tr><td>${esc(window.formatearFecha(p.fechaInicio))}</td><td>${p.fechaFin ? esc(window.formatearFecha(p.fechaFin)) : 'abierto'}</td>
        <td class="num">${esc(window.formatearMoneda(p.precio))}</td><td>${esc(p.creadoPor || '')}</td><td>${esc(String(p.fechaRegistro || '').slice(0, 10))}</td><td>${botones}</td></tr>`;
    }).join('');
    bloque.innerHTML = `<h4>${esc(grupo.material)}${grupo.duplicadoExacto ? ' · duplicado exacto' : ''}</h4>
      <div class="tabla-scroll"><table class="tabla"><thead><tr><th>Inicio</th><th>Fin</th><th>Precio</th><th>Creado por</th><th>Capturado</th><th>Acción</th></tr></thead><tbody>${filas}</tbody></table></div>`;
    bloque.querySelectorAll('button[data-accion]').forEach((boton) => {
      boton.addEventListener('click', () => manejarAccion(contenedor, boton.dataset.accion, boton.dataset.id, boton.dataset.fecha));
    });
    contenedor.appendChild(bloque);
  });
}

async function manejarAccion(contenedor, accion, id, fecha) {
  const registro = (window.EVE.precios || []).find((p) => p.id === id);
  if (!registro) return;
  const texto = accion === 'cerrar'
    ? `Se cerrará este precio al ${window.formatearFecha(fecha)}:\n${descripcionRegistro(registro)}\n\nQuedará registrado quién y cuándo. ¿Confirmas?`
    : `Se eliminará este precio duplicado:\n${descripcionRegistro(registro)}\n\nQuedará registrado quién y cuándo. ¿Confirmas?`;
  if (!window.confirm(texto)) return;
  await window.protegerContraDobleRegistro('traslapes-precios', async () => {
    try {
      if (accion === 'cerrar') await cerrarRegistro(id, fecha);
      else await eliminarDuplicado(id);
      window.showSuccess(accion === 'cerrar' ? 'Precio cerrado' : 'Duplicado eliminado');
      pintar(contenedor);
    } catch (error) {
      window.showError(error.message);
      return false;
    }
  });
}

async function buscar(contenedor) {
  contenedor.textContent = 'Leyendo el catálogo del servidor…';
  const sync = await window.EVE_PRECIOS_SYNC.sincronizar({ forzar: true, motivo: 'traslapes' });
  if (!sync.ok) {
    contenedor.textContent = '';
    window.showError(sync.motivo === 'cola_pendiente'
      ? 'Hay capturas sin conexión por subir. Espera a que se sincronicen y vuelve a buscar.'
      : `No se pudo releer el catálogo de precios (${sync.motivo}).`);
    return;
  }
  pintar(contenedor);
}

function crearVistaTraslapes() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-traslapes';
  tarjeta.innerHTML = `
    <h3>Traslapes de precios</h3>
    <p>Busca materiales con dos o más precios cuya vigencia se traslapa (por ejemplo, un duplicado que quedó abierto). Buscar solo lee.
    Cerrar o eliminar un registro pide confirmación y deja registro de quién y cuándo.</p>
    <button type="button" id="tr-buscar" class="btn-secondary">Buscar traslapes</button>
    <div id="tr-resultado"></div>`;
  tarjeta.querySelector('#tr-buscar').addEventListener('click', () => buscar(tarjeta.querySelector('#tr-resultado')));
  return tarjeta;
}

window.EVE_ADMIN_TRASLAPES = { crearVistaTraslapes, cerrarRegistro, eliminarDuplicado };

})();
