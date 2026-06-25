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

})();
