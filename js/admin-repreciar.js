(function () {

// Admin > Repreciar CxP: corrige las CxP que congelaron un precio viejo porque el catálogo estaba desactualizado en el equipo que las
// creó (ver AUDITORIA_PRECIOS.md). Flujo: 1) Vista previa (solo lee), 2) confirmación explícita, 3) escritura con revalidación por
// cuenta (js/cxp.js: aplicarRepreciado). Nada se escribe sin el paso 2.

const esc = (valor) => window.escaparHtml(valor);
const mxn = (valor) => (valor === null || valor === undefined ? '—' : window.formatearMoneda(valor));
const kgTexto = (valor) => Number(valor).toLocaleString('es-MX', { maximumFractionDigits: 2 });

let ultimoPlan = null;

// Lee del servidor las CxP del rango (rango sobre un solo campo: no pide índice compuesto) y relee el catálogo completo.
async function cargarDatosFrescos(desde, hasta) {
  if (!navigator.onLine) throw new Error('Sin conexión: la vista previa necesita datos del servidor.');
  const sync = await window.EVE_PRECIOS_SYNC.sincronizar({ forzar: true, motivo: 'repreciar' });
  if (!sync.ok) {
    throw new Error(sync.motivo === 'cola_pendiente'
      ? 'Hay capturas sin conexión por subir. Espera a que se sincronicen y vuelve a intentarlo.'
      : `No se pudo releer el catálogo de precios (${sync.motivo}).`);
  }
  const snap = await window.db.collection('cuentas_por_pagar').where('fechaTicket', '>=', desde).where('fechaTicket', '<=', hasta).get({ source: 'server' });
  window.EVE_LECTURAS.contar('cuentas_por_pagar', snap);
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function tablaRepreciables(plan) {
  if (!plan.repreciables.length) return '<p>No hay CxP repreciables en este rango.</p>';
  const filas = plan.repreciables.map((i) => `<tr>
      <td>${esc(i.ticket)}</td><td>${esc(i.proveedor)}</td><td>${esc(window.formatearFecha(i.fechaTicket))}</td><td class="num">${kgTexto(i.kg)}</td>
      <td class="num">${mxn(i.precioActual)}</td><td class="num">${mxn(i.precioNuevo)}</td><td class="num">${mxn(i.diferenciaPesos)}</td>
      <td>${esc(i.creadoPor)}${i.precioDeCache ? ' <span class="chip chip-warn">precio de caché</span>' : ''}</td></tr>`).join('');
  return `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Ticket</th><th>Proveedor</th><th>Fecha</th><th>Kg</th><th>Precio actual</th><th>Precio nuevo</th><th>Diferencia $</th><th>Creada por</th></tr></thead>
    <tbody>${filas}</tbody></table></div>`;
}

function tablaNoRepreciables(plan) {
  if (!plan.noRepreciables.length) return '<p>Ninguna.</p>';
  const filas = plan.noRepreciables.map((i) => `<tr>
      <td>${esc(i.ticket)}</td><td>${esc(i.proveedor)}</td><td>${esc(window.formatearFecha(i.fechaTicket))}</td><td class="num">${kgTexto(i.kg)}</td>
      <td class="num">${mxn(i.precioActual)}</td><td class="num">${mxn(i.precioNuevo)}</td><td class="num">${mxn(i.diferenciaPesos)}</td><td>${esc(i.motivos.join('; '))}</td></tr>`).join('');
  const porProveedor = plan.porProveedorNoRepreciables.map((p) => `<tr><td>${esc(p.proveedor)}</td><td class="num">${p.cuentas}</td><td class="num">${mxn(p.diferenciaPesos)}</td></tr>`).join('');
  return `<div class="tabla-scroll"><table class="tabla"><thead><tr><th>Ticket</th><th>Proveedor</th><th>Fecha</th><th>Kg</th><th>Precio actual</th><th>Precio de catálogo</th><th>Diferencia $</th><th>Por qué no se toca</th></tr></thead>
    <tbody>${filas}</tbody></table></div>
    <h5>Diferencia por proveedor (no repreciables)</h5>
    <table class="tabla"><thead><tr><th>Proveedor</th><th>Cuentas</th><th>Diferencia $</th></tr></thead><tbody>${porProveedor}</tbody></table>`;
}

function pintarPlan(contenedor, plan) {
  const t = plan.totales;
  contenedor.innerHTML = `
    <h4>Se pueden repreciar: ${t.repreciables} CxP · diferencia ${mxn(t.diferenciaRepreciables)}</h4>
    ${tablaRepreciables(plan)}
    ${t.repreciables ? '<button type="button" id="rp-aplicar" class="btn-primary">Repreciar estas CxP…</button>' : ''}
    <h4>No se tocan: ${t.noRepreciables} CxP · diferencia ${mxn(t.diferenciaNoRepreciables)}</h4>
    ${tablaNoRepreciables(plan)}`;
}

async function manejarVistaPrevia(tarjeta) {
  const material = tarjeta.querySelector('#rp-material').value;
  const desde = tarjeta.querySelector('#rp-desde').value;
  const hasta = tarjeta.querySelector('#rp-hasta').value;
  const resultado = tarjeta.querySelector('#rp-resultado');
  if (!material || !desde || !hasta) {
    window.showError('Elige material y rango de fechas.');
    return;
  }
  if (desde > hasta) {
    window.showError('La fecha inicial no puede ser posterior a la final.');
    return;
  }
  resultado.textContent = 'Leyendo datos del servidor…';
  try {
    const cuentas = await cargarDatosFrescos(desde, hasta);
    ultimoPlan = window.EVE_CXP.planificarRepreciado(cuentas, { material, desde, hasta });
    pintarPlan(resultado, ultimoPlan);
    const boton = resultado.querySelector('#rp-aplicar');
    if (boton) boton.addEventListener('click', () => manejarAplicar(tarjeta));
  } catch (error) {
    ultimoPlan = null;
    resultado.textContent = '';
    window.showError(error.message);
  }
}

async function manejarAplicar(tarjeta) {
  if (!ultimoPlan || !ultimoPlan.repreciables.length) return;
  const plan = ultimoPlan;
  const t = plan.totales;
  const aceptado = window.confirm(
    `Se repreciarán ${t.repreciables} CxP del material seleccionado a su precio de catálogo vigente.\n` +
    `Diferencia total: ${window.formatearMoneda(t.diferenciaRepreciables)}.\n` +
    `Cada cuenta se vuelve a validar antes de escribir y queda registrado quién, cuándo y el precio anterior.\n\n¿Confirmas el repreciado?`
  );
  if (!aceptado) return;
  await window.protegerContraDobleRegistro('repreciar-cxp', async () => {
    try {
      const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
      const { repreciadas, omitidas } = await window.EVE_CXP.aplicarRepreciado(plan.repreciables, { usuario });
      ultimoPlan = null;
      const resultado = tarjeta.querySelector('#rp-resultado');
      resultado.innerHTML = `<h4>Resultado: ${repreciadas.length} repreciadas, ${omitidas.length} omitidas</h4>` +
        (omitidas.length ? `<ul>${omitidas.map((o) => `<li>Ticket ${esc(o.ticket)}: ${esc(o.motivo)}</li>`).join('')}</ul>` : '') +
        '<p>Vuelve a pulsar «Vista previa» para ver lo que queda pendiente.</p>';
      window.showSuccess(`Repreciadas: ${repreciadas.length}${omitidas.length ? ` · omitidas: ${omitidas.length}` : ''}`);
    } catch (error) {
      window.showError(error.message);
      return false;
    }
  });
}

// Material y rango con los que el aviso de «Revisar y repreciar» abre esta pantalla; se consume una sola vez al crearla.
let preseleccion = null;

// Aviso tras dar de alta un precio (Precios o importación). `avisos` sale de EVE_CXP.avisoRepreciadoTrasAlta. No escribe nada: el botón
// solo abre la vista previa; el repreciado sigue pidiendo su confirmación explícita ahí.
function mostrarAvisoTrasAlta(contenedor, avisos) {
  if (!contenedor) return;
  contenedor.innerHTML = '';
  if (!avisos || !avisos.length) return;
  const puedeAbrir = window.puedeEscribir('cxp') && window.EVE_ADMIN && window.EVE_ADMIN.subpestanasVisibles().some((s) => s.id === 'repreciar');
  avisos.forEach((a) => {
    const caja = document.createElement('div');
    caja.className = 'chip chip-warn';
    caja.style.cssText = 'display:block;margin:0.5rem 0;padding:0.5rem 0.75rem';
    const texto = document.createElement('span');
    texto.textContent = `${a.cantidad} CxP de ${a.material} desde ${window.formatearFecha(a.desde)} quedarían con precio distinto al nuevo (diferencia ${window.formatearMoneda(a.diferenciaPesos)}; ${a.repreciables} repreciables, ${a.noRepreciables} no se tocan). `;
    caja.appendChild(texto);
    if (puedeAbrir) {
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'btn-secondary';
      boton.textContent = 'Revisar y repreciar';
      boton.addEventListener('click', () => window.EVE_ADMIN.abrirRepreciar({ material: a.material, desde: a.desde, hasta: a.hasta }));
      caja.appendChild(boton);
    }
    contenedor.appendChild(caja);
  });
}

// Calcula y muestra el aviso. Nunca lanza.
async function avisarTrasAlta(contenedor, altas) {
  try {
    mostrarAvisoTrasAlta(contenedor, await window.EVE_CXP.avisoRepreciadoTrasAlta(altas));
  } catch (error) {
    console.warn('[repreciar] No se pudo mostrar el aviso:', error);
  }
}

function crearVistaRepreciar() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-repreciar';
  const hoy = window.obtenerFechaMexico();
  const inicial = preseleccion;
  preseleccion = null;
  const opciones = window.MATERIALES_COMUNES.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  tarjeta.innerHTML = `
    <h3>Repreciar CxP</h3>
    <p>Busca las CxP de un material cuyo precio base difiere del precio de catálogo vigente a la fecha de su ticket. La vista previa
    no escribe nada. Solo se repreciarán las pendientes sin abonos, sin precio negociado y sin ajuste de proveedor.</p>
    <div class="form-row">
      <select id="rp-material"><option value="">Material</option>${opciones}</select>
      <label>Desde <input type="date" id="rp-desde" value="${esc(hoy.slice(0, 7))}-01"></label>
      <label>Hasta <input type="date" id="rp-hasta" value="${esc(hoy)}"></label>
      <button type="button" id="rp-previa" class="btn-secondary">Vista previa</button>
    </div>
    <div id="rp-resultado"></div>`;
  tarjeta.querySelector('#rp-previa').addEventListener('click', () => manejarVistaPrevia(tarjeta));
  if (inicial) {
    // Material y rango ya cargados y la vista previa (solo lectura) corre sola. Escribir sigue pidiendo confirmar.
    tarjeta.querySelector('#rp-material').value = inicial.material;
    tarjeta.querySelector('#rp-desde').value = inicial.desde;
    tarjeta.querySelector('#rp-hasta').value = inicial.hasta;
    manejarVistaPrevia(tarjeta);
  }
  return tarjeta;
}

function fijarPreseleccion(datos) {
  preseleccion = datos || null;
}

window.EVE_ADMIN_REPRECIAR = { crearVistaRepreciar, mostrarAvisoTrasAlta, avisarTrasAlta, fijarPreseleccion };

})();
