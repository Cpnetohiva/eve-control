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

function obtenerDatosActuales() {
  return {
    registrosDestaraje: window.EVE.registrosDestaraje,
    registrosVentas: window.EVE.registrosVentas,
    registrosProduccion: window.EVE.registrosProduccion,
    registrosPagos: window.EVE.registrosPagos,
    registrosMinistraciones: window.EVE.registrosMinistraciones,
    registrosControlProduccion: window.EVE.registrosControlProduccion
  };
}

function generarBackupJSON() {
  const backup = construirBackupCompleto(obtenerDatosActuales());
  const texto = JSON.stringify(backup, null, 2);
  const blob = new Blob([texto], { type: 'application/json;charset=utf-8;' });
  window.descargarArchivo(blob, `Backup_EVE_Control_${window.obtenerFechaMexico()}.json`);
}

function generarBackupExcel() {
  const backup = construirBackupCompleto(obtenerDatosActuales());
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.destaraje), 'Destaraje');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.produccion), 'Produccion');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.pagos), 'Pagos');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.ministraciones), 'Ministraciones');
  XLSX.utils.book_append_sheet(libro, XLSX.utils.json_to_sheet(backup.controlProduccion), 'ControlProduccion');
  XLSX.writeFile(libro, `Backup_EVE_Control_${window.obtenerFechaMexico()}.xlsx`);
}

async function probarTelegram() {
  try {
    const configDoc = await window.db.collection('config').doc('telegram').get();
    if (!configDoc.exists) {
      throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
    }
    const { token, chatId } = configDoc.data();
    if (!token || !chatId) {
      throw new Error('Configura el token de Telegram primero (Firestore: config/telegram)');
    }
    const respuesta = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: '✅ Prueba de conexión EVE Control' })
    });
    const resultado = await respuesta.json();
    if (!resultado.ok) {
      throw new Error(`Telegram rechazó el mensaje: ${resultado.description || 'error desconocido'}`);
    }
    window.showSuccess('Mensaje de prueba enviado a Telegram');
  } catch (error) {
    window.showError(error.message);
  }
}

function crearVistaBackup() {
  const tarjeta = document.createElement('div');
  tarjeta.className = 'card admin-backup';
  tarjeta.innerHTML = `
    <h3>Backup / Exportación</h3>
    <div class="admin-backup-botones">
      <button type="button" id="ab-backup-json" class="btn-secondary">Backup JSON completo</button>
      <button type="button" id="ab-backup-excel" class="btn-secondary">Backup Excel completo</button>
      <button type="button" id="ab-probar-telegram" class="btn-primary">📤 Probar Telegram</button>
    </div>
  `;
  tarjeta.querySelector('#ab-backup-json').addEventListener('click', generarBackupJSON);
  tarjeta.querySelector('#ab-backup-excel').addEventListener('click', generarBackupExcel);
  tarjeta.querySelector('#ab-probar-telegram').addEventListener('click', probarTelegram);
  return tarjeta;
}

Object.assign(window.EVE_ADMIN_BACKUP, {
  generarBackupJSON,
  generarBackupExcel,
  probarTelegram,
  crearVistaBackup
});

})();
