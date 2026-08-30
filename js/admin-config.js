(function () {

function validarConfiguracion(token, chatId) {
  if (!token || !token.trim()) return 'El token de Telegram es obligatorio';
  if (!chatId || !chatId.trim()) return 'El Chat ID es obligatorio';
  return null;
}

function construirPayloadConfig(datos) {
  return {
    token: datos.token.trim(),
    chatId: datos.chatId.trim(),
    horaReporte: datos.horaReporte
  };
}

function comisionVigenteAbierta(comisiones) {
  return comisiones.find((c) => c.fechaFin === null) || null;
}

function historialComisiones(comisiones, hoy) {
  return comisiones
    .map((c) => {
      const fin = c.fechaFin || hoy;
      const inicio = new Date(`${c.fechaInicio}T00:00:00`);
      const finDate = new Date(`${fin}T00:00:00`);
      const duracionDias = Math.round((finDate - inicio) / 86400000) + 1;
      return { ...c, duracionDias };
    })
    .sort((a, b) => (a.fechaInicio < b.fechaInicio ? 1 : -1));
}

function construirNuevaComision(datos, comisionAnteriorVigente) {
  const valor = Number(datos.valor);
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error('La comisión por kg debe ser un número mayor o igual a 0');
  }
  const fechaInicio = datos.fechaInicio;
  if (!fechaInicio) {
    throw new Error('La fecha de vigencia es obligatoria');
  }
  if (comisionAnteriorVigente && fechaInicio <= comisionAnteriorVigente.fechaInicio) {
    throw new Error(`La fecha debe ser posterior al inicio de la comisión vigente actual (${window.formatearFecha(comisionAnteriorVigente.fechaInicio)})`);
  }
  const nuevo = {
    valor,
    fechaInicio,
    fechaFin: null,
    notas: (datos.notas || '').toString().trim()
  };
  const cierre = comisionAnteriorVigente
    ? { id: comisionAnteriorVigente.id, fechaFin: window.restarUnDia(fechaInicio) }
    : null;
  return { cierre, nuevo };
}

window.EVE_ADMIN_CONFIG = {
  validarConfiguracion,
  construirPayloadConfig,
  comisionVigenteAbierta,
  historialComisiones,
  construirNuevaComision
};

const HORA_DEFAULT = '20:00';

async function cargarConfiguracion() {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  const inputToken = document.getElementById('ac-token');
  if (!inputToken) return;
  const datos = configDoc.exists ? configDoc.data() : {};
  inputToken.value = datos.token || '';
  document.getElementById('ac-chatid').value = datos.chatId || '';
  document.getElementById('ac-horario').value = datos.horaReporte || HORA_DEFAULT;
}

async function manejarGuardar(evento) {
  evento.preventDefault();
  const token = document.getElementById('ac-token').value;
  const chatId = document.getElementById('ac-chatid').value;
  const horaReporte = document.getElementById('ac-horario').value;

  const errorValidacion = validarConfiguracion(token, chatId);
  if (errorValidacion) {
    window.showError(errorValidacion);
    return;
  }

  const payload = construirPayloadConfig({ token, chatId, horaReporte });
  try {
    await window.db.collection('config').doc('telegram').set(payload, { merge: true });
    window.showSuccess('Configuración guardada');
  } catch (error) {
    window.showError(error.message);
  }
}

function mostrarAvisoComisionAnterior() {
  const fecha = document.getElementById('cc-fecha').value;
  const aviso = document.getElementById('cc-aviso');
  const anterior = comisionVigenteAbierta(window.EVE.comisiones || []);
  if (anterior) {
    aviso.style.display = '';
    aviso.textContent = `La comisión anterior (${window.formatearMoneda(anterior.valor)}) quedará cerrada al ${window.formatearFecha(window.restarUnDia(fecha || window.obtenerFechaMexico()))}`;
  } else {
    aviso.style.display = 'none';
    aviso.textContent = '';
  }
}

async function manejarEnvioComision(evento) {
  evento.preventDefault();
  const datos = {
    valor: document.getElementById('cc-valor').value,
    fechaInicio: document.getElementById('cc-fecha').value,
    notas: document.getElementById('cc-notas').value
  };
  const usuario = (window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  try {
    const anterior = comisionVigenteAbierta(window.EVE.comisiones || []);
    const { cierre, nuevo } = construirNuevaComision(datos, anterior);
    if (cierre) {
      await window.actualizarDato('comisiones', cierre.id, { fechaFin: cierre.fechaFin });
      const registroCerrado = window.EVE.comisiones.find((c) => c.id === cierre.id);
      if (registroCerrado) registroCerrado.fechaFin = cierre.fechaFin;
    }
    const nuevoConMeta = { ...nuevo, creadoPor: usuario };
    const id = await window.guardarDato('comisiones', nuevoConMeta);
    window.EVE.comisiones.push({ id, ...nuevoConMeta, fechaRegistro: new Date().toISOString() });
    window.EVE.comisionPorKg = window.obtenerComisionVigente(window.obtenerFechaMexico());
    cerrarModalComision();
    renderizarComision();
    window.showSuccess('Comisión guardada');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearModalComision() {
  const overlay = document.createElement('div');
  overlay.id = 'comision-modal-overlay';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Nueva Comisión</h3>
      <form id="comision-form">
        <input type="number" id="cc-valor" placeholder="Comisión por Kg ($)" step="0.01" min="0" required>
        <input type="date" id="cc-fecha" required>
        <textarea id="cc-notas" placeholder="Notas (opcional)" rows="2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical"></textarea>
        <div id="cc-aviso" class="chip chip-warn" style="display:none;margin:0.5rem 0"></div>
        <button type="submit" class="btn-primary">Guardar</button>
        <button type="button" id="cc-cancelar" class="btn-secondary">Cancelar</button>
      </form>
    </div>
  `;
  overlay.querySelector('#cc-fecha').addEventListener('change', mostrarAvisoComisionAnterior);
  overlay.querySelector('#comision-form').addEventListener('submit', manejarEnvioComision);
  overlay.querySelector('#cc-cancelar').addEventListener('click', () => cerrarModalComision());
  return overlay;
}

function abrirModalComision() {
  document.getElementById('comision-form').reset();
  document.getElementById('cc-fecha').value = window.obtenerFechaMexico();
  mostrarAvisoComisionAnterior();
  document.getElementById('comision-modal-overlay').classList.add('open');
}

function cerrarModalComision() {
  document.getElementById('comision-modal-overlay').classList.remove('open');
}

function llenarInfoVigente() {
  const chip = document.getElementById('cc-vigente-chip');
  if (!chip) return;
  const valorVigente = window.obtenerComisionVigente(window.obtenerFechaMexico());
  chip.textContent = `Comisión vigente hoy: ${window.formatearMoneda(valorVigente)}`;
}

function llenarHistorialComisiones() {
  const wrapper = document.getElementById('comision-historial-wrapper');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  const historial = historialComisiones(window.EVE.comisiones || [], window.obtenerFechaMexico());
  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.innerHTML = `
    <thead>
      <tr><th>Valor</th><th>Desde</th><th>Hasta</th><th>Duración (días)</th><th>Notas</th></tr>
    </thead>
    <tbody id="comision-historial-tabla"></tbody>
  `;
  wrapper.appendChild(tabla);
  const tbody = tabla.querySelector('#comision-historial-tabla');
  if (historial.length === 0) {
    const fila = document.createElement('tr');
    const celda = document.createElement('td');
    celda.colSpan = 5;
    celda.textContent = 'Sin comisiones registradas';
    fila.appendChild(celda);
    tbody.appendChild(fila);
    return;
  }
  historial.forEach((c) => {
    const fila = document.createElement('tr');
    const valores = [
      window.formatearMoneda(c.valor),
      window.formatearFecha(c.fechaInicio),
      c.fechaFin ? window.formatearFecha(c.fechaFin) : 'Vigente',
      String(c.duracionDias),
      c.notas || ''
    ];
    valores.forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });
    tbody.appendChild(fila);
  });
}

function renderizarComision() {
  llenarInfoVigente();
  llenarHistorialComisiones();
}

function crearVistaConfig() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-config';
  tarjeta.innerHTML = `
    <h3>Configuración del Sistema</h3>
    <form id="admin-config-form">
      <input type="text" id="ac-token" placeholder="Token de Telegram">
      <input type="text" id="ac-chatid" placeholder="Chat ID">
      <label class="admin-config-campo">
        Horario de reporte automático
        <input type="time" id="ac-horario" value="${HORA_DEFAULT}">
      </label>
      <button type="submit" class="btn-primary">Guardar</button>
    </form>
    <h3>Comisión sobre Precio (CxP)</h3>
    <div id="cc-vigente-chip" class="chip"></div>
    <div class="destaraje-exportar" style="margin:0.75rem 0">
      <button type="button" id="comision-btn-nueva" class="btn-primary">+ Nueva Comisión</button>
    </div>
    <div id="comision-historial-wrapper" class="destaraje-tabla-wrapper"></div>
  `;
  tarjeta.querySelector('#admin-config-form').addEventListener('submit', manejarGuardar);
  tarjeta.querySelector('#comision-btn-nueva').addEventListener('click', () => abrirModalComision());
  tarjeta.appendChild(crearModalComision());
  cargarConfiguracion();
  Promise.resolve().then(renderizarComision);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_CONFIG, {
  cargarConfiguracion,
  manejarGuardar,
  renderizarComision,
  crearVistaConfig
});

})();
