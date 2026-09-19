(function () {

function formatearFormaPago(recibo) {
  return recibo.formaPago === 'transferencia' ? 'Transferencia' : 'Efectivo';
}

async function cargarRecibosPago() {
  const snapshot = await window.db.collection('recibos_pago').orderBy('fecha', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

function construirFilaRecibo(recibo) {
  const fila = document.createElement('tr');
  [recibo.proveedor, window.formatearMoneda(recibo.totalPago), window.formatearFecha(recibo.fecha), formatearFormaPago(recibo)]
    .forEach((valor) => {
      const celda = document.createElement('td');
      celda.textContent = valor;
      fila.appendChild(celda);
    });

  const celdaAccion = document.createElement('td');
  const boton = document.createElement('button');
  boton.className = 'btn-secondary';
  boton.textContent = 'Descargar PDF';
  boton.addEventListener('click', () => {
    window.EVE_CXP.generarPDFRecibo(recibo, true);
  });
  celdaAccion.appendChild(boton);
  fila.appendChild(celdaAccion);
  return fila;
}

async function renderizarTablaRecibosPago(tbody, vacio) {
  tbody.innerHTML = '';
  const recibos = await cargarRecibosPago();
  if (recibos.length === 0) {
    vacio.style.display = '';
    return;
  }
  vacio.style.display = 'none';
  recibos.forEach((recibo) => tbody.appendChild(construirFilaRecibo(recibo)));
}

function renderRecibosPago(container) {
  const wrapper = document.createElement('div');
  wrapper.className = 'card destaraje-tabla-wrapper';
  wrapper.innerHTML = `
    <h3>Recibos de Pago</h3>
    <p id="rpg-vacio" style="display:none">Sin recibos de pago registrados</p>
    <table class="tabla-destaraje">
      <thead>
        <tr><th data-tipo="texto">Proveedor</th><th data-tipo="moneda">Monto</th><th data-tipo="fecha">Fecha</th><th data-tipo="texto">Forma de pago</th><th></th></tr>
      </thead>
      <tbody id="rpg-tabla"></tbody>
    </table>
  `;
  container.appendChild(wrapper);

  const tbody = wrapper.querySelector('#rpg-tabla');
  const vacio = wrapper.querySelector('#rpg-vacio');
  window.activarOrdenamiento(wrapper.querySelector('table'));
  renderizarTablaRecibosPago(tbody, vacio).catch((error) => window.showError(error.message));
}

window.EVE_MODULES.recibosPago = { render: renderRecibosPago };

})();
