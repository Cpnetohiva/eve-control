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

function validarComision(comisionPorKg) {
  const numero = Number(comisionPorKg);
  if (!Number.isFinite(numero) || numero < 0) return 'La comisión por kg debe ser un número mayor o igual a 0';
  return null;
}

window.EVE_ADMIN_CONFIG = {
  validarConfiguracion,
  construirPayloadConfig,
  validarComision
};

const HORA_DEFAULT = '20:00';
const COMISION_DEFAULT = 0.10;

async function cargarConfiguracion() {
  const configDoc = await window.db.collection('config').doc('telegram').get();
  const inputToken = document.getElementById('ac-token');
  if (!inputToken) return;
  const datos = configDoc.exists ? configDoc.data() : {};
  inputToken.value = datos.token || '';
  document.getElementById('ac-chatid').value = datos.chatId || '';
  document.getElementById('ac-horario').value = datos.horaReporte || HORA_DEFAULT;
}

async function cargarConfiguracionComision() {
  const inputComision = document.getElementById('ac-comision');
  if (!inputComision) return;
  const comisionDoc = await window.db.collection('config').doc('sistema').get();
  const datos = comisionDoc.exists ? comisionDoc.data() : {};
  const comisionPorKg = Number.isFinite(Number(datos.comisionPorKg)) ? Number(datos.comisionPorKg) : COMISION_DEFAULT;
  inputComision.value = comisionPorKg;
  window.EVE.comisionPorKg = comisionPorKg;
}

async function manejarGuardarComision(evento) {
  evento.preventDefault();
  const comisionPorKg = document.getElementById('ac-comision').value;

  const errorValidacion = validarComision(comisionPorKg);
  if (errorValidacion) {
    window.showError(errorValidacion);
    return;
  }

  const payload = { comisionPorKg: Number(comisionPorKg) };
  try {
    await window.db.collection('config').doc('sistema').set(payload, { merge: true });
    window.EVE.comisionPorKg = payload.comisionPorKg;
    window.showSuccess('Comisión guardada');
  } catch (error) {
    window.showError(error.message);
  }
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
    <form id="admin-config-comision-form">
      <label class="admin-config-campo">
        Comisión por kg ($)
        <input type="number" id="ac-comision" step="0.01" min="0" value="${COMISION_DEFAULT}">
      </label>
      <button type="submit" class="btn-primary">Guardar Comisión</button>
    </form>
  `;
  tarjeta.querySelector('#admin-config-form').addEventListener('submit', manejarGuardar);
  tarjeta.querySelector('#admin-config-comision-form').addEventListener('submit', manejarGuardarComision);
  cargarConfiguracion();
  cargarConfiguracionComision();
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_CONFIG, {
  cargarConfiguracion,
  manejarGuardar,
  cargarConfiguracionComision,
  manejarGuardarComision,
  crearVistaConfig
});

})();
