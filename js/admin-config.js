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

window.EVE_ADMIN_CONFIG = {
  validarConfiguracion,
  construirPayloadConfig
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
  `;
  tarjeta.querySelector('#admin-config-form').addEventListener('submit', manejarGuardar);
  cargarConfiguracion();
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_CONFIG, {
  cargarConfiguracion,
  manejarGuardar,
  crearVistaConfig
});

})();
