(function () {

function construirBackupCompleto(datos) {
  return {
    destaraje: [...datos.registrosDestaraje, ...datos.registrosVentas],
    produccion: datos.registrosProduccion,
    pagos: datos.registrosPagos,
    ministraciones: datos.registrosMinistraciones,
    controlProduccion: datos.registrosControlProduccion
  };
}

window.EVE_ADMIN_BACKUP = {
  construirBackupCompleto
};

})();
