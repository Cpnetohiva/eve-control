(function () {

function comprimirImagen(file, callback) {
  const MAX_W = 800;
  const CALIDAD = 0.7;
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const ratio = Math.min(1, MAX_W / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      callback(canvas.toDataURL('image/jpeg', CALIDAD));
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function parsearTXT(texto) {
  const lineas = texto.split('\n');
  const items = [];
  lineas.forEach(function (linea) {
    linea = linea.trim();
    if (!linea) return;

    const ticketMatch = linea.match(/\b(\d{3,5})\b/);
    if (!ticketMatch) return;
    const ticket = ticketMatch[1];

    let kg = null;
    const kgMatch = linea.match(/(\d+(?:[.,]\d+)?)\s*kg/i);
    if (kgMatch) {
      kg = parseFloat(kgMatch[1].replace(',', '.'));
    }

    let monto = null;
    const montoMatch = linea.match(/\$\s*([\d,]+(?:\.\d+)?)/) ||
      linea.match(/(?:pagado|total)[:\s]+([\d,]+(?:\.\d+)?)/i);
    if (montoMatch) {
      monto = parseFloat(montoMatch[1].replace(/,/g, ''));
    }

    items.push({ ticket: ticket, kg: kg, monto: monto, lineaOriginal: linea });
  });
  return items;
}

function compararConSistema(itemsTXT, registrosPagos) {
  const resultado = {
    coincidencias: [],
    discrepancias: [],
    soloEnTXT: [],
    soloEnSistema: []
  };

  const mapaSistema = {};
  registrosPagos.forEach(function (r) {
    mapaSistema[String(r.ticket)] = r;
  });

  const ticketsEnTXT = new Set();

  itemsTXT.forEach(function (item) {
    ticketsEnTXT.add(item.ticket);
    const regSistema = mapaSistema[item.ticket];
    if (!regSistema) {
      resultado.soloEnTXT.push(item);
      return;
    }
    const diferencias = [];
    if (item.kg !== null && Math.abs(item.kg - Number(regSistema.kg)) > 0.5) {
      diferencias.push({ campo: 'kg', txt: item.kg, sistema: regSistema.kg });
    }
    const montoSistema = Number(regSistema.pagado) || Number(regSistema.total) || 0;
    if (item.monto !== null && Math.abs(item.monto - montoSistema) > 1) {
      diferencias.push({ campo: 'monto', txt: item.monto, sistema: montoSistema });
    }
    if (diferencias.length > 0) {
      resultado.discrepancias.push({ item: item, regSistema: regSistema, diferencias: diferencias });
    } else {
      resultado.coincidencias.push({ item: item, regSistema: regSistema });
    }
  });

  registrosPagos.forEach(function (r) {
    if (!ticketsEnTXT.has(String(r.ticket))) {
      resultado.soloEnSistema.push(r);
    }
  });

  return resultado;
}

function crearChip(texto, clase) {
  const span = document.createElement('span');
  span.className = 'chip ' + clase;
  span.textContent = texto;
  return span;
}

function crearTablaDiscrepancias(discrepancias) {
  if (!discrepancias.length) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  const titulo = document.createElement('h5');
  titulo.textContent = 'Tickets con diferencias';
  titulo.style.cssText = 'margin-bottom:0.75rem;color:var(--azul-marino)';
  wrapper.appendChild(titulo);

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.style.fontSize = '0.85rem';
  tabla.innerHTML = '<thead><tr>' +
    '<th>Ticket</th><th>TXT kg</th><th>Sistema kg</th>' +
    '<th>TXT monto</th><th>Sistema monto</th><th>Diferencia</th><th></th>' +
    '</tr></thead>';
  const tbody = document.createElement('tbody');

  discrepancias.forEach(function (d) {
    const fila = document.createElement('tr');
    const kgTXT = d.item.kg !== null ? d.item.kg : '—';
    const kgSist = d.regSistema.kg;
    const montoTXT = d.item.monto !== null ? window.formatearMoneda(d.item.monto) : '—';
    const montoSist = window.formatearMoneda(Number(d.regSistema.pagado) || Number(d.regSistema.total) || 0);
    const detalleDiff = d.diferencias.map(function (df) {
      return df.campo + ': ' + df.txt + ' ≠ ' + df.sistema;
    }).join(', ');

    fila.innerHTML = '<td>' + d.item.ticket + '</td>' +
      '<td>' + kgTXT + '</td>' +
      '<td>' + kgSist + '</td>' +
      '<td>' + montoTXT + '</td>' +
      '<td>' + montoSist + '</td>' +
      '<td style="color:var(--rojo-error);font-size:0.8rem">' + detalleDiff + '</td>' +
      '<td></td>';

    const btnCorregir = document.createElement('button');
    btnCorregir.textContent = 'Corregir';
    btnCorregir.className = 'btn-secondary';
    btnCorregir.style.fontSize = '0.8rem';
    btnCorregir.style.padding = '0.3rem 0.6rem';
    btnCorregir.addEventListener('click', function () {
      if (window.EVE_PAGOS && window.EVE_PAGOS.abrirModalEdicion) {
        window.EVE_PAGOS.abrirModalEdicion(d.regSistema);
      } else {
        window.showError('Cambia al módulo Pagos para editar este registro');
      }
    });
    fila.querySelector('td:last-child').appendChild(btnCorregir);
    tbody.appendChild(fila);
  });

  tabla.appendChild(tbody);
  wrapper.appendChild(tabla);
  return wrapper;
}

function crearTablaSimple(registros, titulo, campos) {
  if (!registros.length) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'card';
  const h5 = document.createElement('h5');
  h5.textContent = titulo;
  h5.style.cssText = 'margin-bottom:0.75rem;color:var(--azul-marino)';
  wrapper.appendChild(h5);

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.style.fontSize = '0.85rem';
  const thead = '<thead><tr>' + campos.map(function (c) { return '<th>' + c.label + '</th>'; }).join('') + '</tr></thead>';
  tabla.innerHTML = thead;
  const tbody = document.createElement('tbody');
  registros.forEach(function (r) {
    const fila = document.createElement('tr');
    campos.forEach(function (c) {
      const td = document.createElement('td');
      td.textContent = c.fn ? c.fn(r) : (r[c.key] !== undefined ? r[c.key] : '—');
      fila.appendChild(td);
    });
    tbody.appendChild(fila);
  });
  tabla.appendChild(tbody);
  wrapper.appendChild(tabla);
  return wrapper;
}

function crearSeccionFoto() {
  const seccion = document.createElement('div');
  seccion.className = 'card auditoria-seccion';

  const titulo = document.createElement('h4');
  titulo.textContent = 'Auditoría por Foto — Destaraje';
  seccion.appendChild(titulo);

  // Upload
  const uploadGrid = document.createElement('div');
  uploadGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;margin-bottom:1rem';

  const inputTicket = document.createElement('input');
  inputTicket.type = 'text';
  inputTicket.id = 'aud-ticket-upload';
  inputTicket.placeholder = 'Número de ticket';
  inputTicket.style.cssText = 'padding:0.6rem;border:1px solid #ccc;border-radius:6px;font-size:0.95rem;width:160px';

  const inputFoto = document.createElement('input');
  inputFoto.type = 'file';
  inputFoto.accept = 'image/*';
  inputFoto.id = 'aud-foto-input';
  inputFoto.style.cssText = 'font-size:0.9rem';

  const infoSize = document.createElement('small');
  infoSize.textContent = 'Máx. 2MB';
  infoSize.style.color = '#666';

  const btnAdjuntar = document.createElement('button');
  btnAdjuntar.textContent = 'Adjuntar foto al ticket';
  btnAdjuntar.className = 'btn-primary';

  uploadGrid.appendChild(inputTicket);
  uploadGrid.appendChild(inputFoto);
  uploadGrid.appendChild(infoSize);
  uploadGrid.appendChild(btnAdjuntar);
  seccion.appendChild(uploadGrid);

  const statusUpload = document.createElement('div');
  statusUpload.id = 'aud-status-upload';
  seccion.appendChild(statusUpload);

  btnAdjuntar.addEventListener('click', async function () {
    const ticket = inputTicket.value.trim();
    const file = inputFoto.files[0];
    if (!ticket) { window.showError('Ingresa el número de ticket'); return; }
    if (!file) { window.showError('Selecciona una foto'); return; }
    if (file.size > 2 * 1024 * 1024) { window.showError('La foto excede 2MB'); return; }

    btnAdjuntar.disabled = true;
    btnAdjuntar.textContent = 'Comprimiendo...';

    comprimirImagen(file, async function (base64) {
      try {
        const registroDestaraje = (window.EVE.registrosDestaraje || []).find(function (r) {
          return String(r.ticket) === ticket;
        });
        const usuario = (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
        await window.db.collection('auditoria_fotos').add({
          ticket: ticket,
          fotoBase64: base64,
          registroId: registroDestaraje ? registroDestaraje.id : null,
          subidoPor: usuario,
          timestamp: new Date().toISOString()
        });
        statusUpload.innerHTML = '<p style="color:var(--verde-exito);font-weight:600">✅ Foto adjuntada al ticket ' + ticket + (registroDestaraje ? ' (registro vinculado)' : ' (sin registro en sistema)') + '</p>';
        inputTicket.value = '';
        inputFoto.value = '';
      } catch (e) {
        window.showError('Error al guardar foto: ' + e.message);
      } finally {
        btnAdjuntar.disabled = false;
        btnAdjuntar.textContent = 'Adjuntar foto al ticket';
      }
    });
  });

  // Separador
  const sep = document.createElement('hr');
  sep.style.cssText = 'border:none;border-top:1px solid #eee;margin:1rem 0';
  seccion.appendChild(sep);

  // Buscar
  const buscarGrid = document.createElement('div');
  buscarGrid.style.cssText = 'display:flex;gap:0.75rem;align-items:center;margin-bottom:0.75rem;flex-wrap:wrap';

  const inputBuscar = document.createElement('input');
  inputBuscar.type = 'text';
  inputBuscar.id = 'aud-ticket-buscar';
  inputBuscar.placeholder = 'Buscar ticket: número';
  inputBuscar.style.cssText = 'padding:0.6rem;border:1px solid #ccc;border-radius:6px;font-size:0.95rem;width:200px';

  const btnBuscar = document.createElement('button');
  btnBuscar.textContent = 'Buscar';
  btnBuscar.className = 'btn-secondary';

  buscarGrid.appendChild(inputBuscar);
  buscarGrid.appendChild(btnBuscar);
  seccion.appendChild(buscarGrid);

  const resultadoBuscar = document.createElement('div');
  resultadoBuscar.id = 'aud-resultado-buscar';
  seccion.appendChild(resultadoBuscar);

  btnBuscar.addEventListener('click', async function () {
    const ticket = inputBuscar.value.trim();
    if (!ticket) { window.showError('Ingresa el ticket a buscar'); return; }
    resultadoBuscar.innerHTML = '<p>Buscando...</p>';
    try {
      const snap = await window.db.collection('auditoria_fotos')
        .where('ticket', '==', ticket)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (snap.empty) {
        resultadoBuscar.innerHTML = '<p style="color:#666">No hay foto registrada para el ticket ' + ticket + '.</p>';
        return;
      }

      const datos = snap.docs[0].data();
      const registroDestaraje = (window.EVE.registrosDestaraje || []).find(function (r) {
        return String(r.ticket) === ticket;
      });

      resultadoBuscar.innerHTML = '';

      const img = document.createElement('img');
      img.src = datos.fotoBase64;
      img.className = 'auditoria-foto-preview';
      img.alt = 'Foto ticket ' + ticket;
      resultadoBuscar.appendChild(img);

      if (registroDestaraje) {
        const info = document.createElement('div');
        info.className = 'card';
        info.style.cssText = 'margin-top:0.75rem;font-size:0.9rem;line-height:1.8';
        info.innerHTML = '<strong>Registro en sistema:</strong><br>' +
          'Ticket: ' + registroDestaraje.ticket + '<br>' +
          'Proveedor: ' + registroDestaraje.proveedor + '<br>' +
          'Material: ' + registroDestaraje.material + '<br>' +
          'Kg: ' + registroDestaraje.kg + '<br>' +
          'Entrada: ' + (registroDestaraje.fechaEntrada || '—') + ' | Salida: ' + (registroDestaraje.fechaSalida || '—');
        resultadoBuscar.appendChild(info);
      } else {
        const info = document.createElement('p');
        info.style.cssText = 'color:#856404;margin-top:0.5rem;font-size:0.9rem';
        info.textContent = '⚠️ No se encontró este ticket en el sistema.';
        resultadoBuscar.appendChild(info);
      }

      const btnDesc = document.createElement('a');
      btnDesc.href = datos.fotoBase64;
      btnDesc.download = 'ticket_' + ticket + '.jpg';
      btnDesc.className = 'btn-secondary';
      btnDesc.style.cssText = 'display:inline-block;margin-top:0.75rem;text-decoration:none;padding:0.5rem 1rem;font-size:0.9rem';
      btnDesc.textContent = 'Descargar foto';
      resultadoBuscar.appendChild(btnDesc);

    } catch (e) {
      resultadoBuscar.innerHTML = '<p style="color:var(--rojo-error)">Error: ' + e.message + '</p>';
    }
  });

  return seccion;
}

function crearSeccionTXT() {
  const seccion = document.createElement('div');
  seccion.className = 'card auditoria-seccion';

  const titulo = document.createElement('h4');
  titulo.textContent = 'Auditoría por TXT — Pagos';
  seccion.appendChild(titulo);

  const textarea = document.createElement('textarea');
  textarea.className = 'auditoria-textarea';
  textarea.rows = 8;
  textarea.placeholder = 'Pega aquí el texto del mensaje con los pagos...\n\nEjemplo:\n9260 Jose Enrique mixto 650kg pagado 6500\n9261 Juana PET 800 kg $9600';
  seccion.appendChild(textarea);

  const acciones = document.createElement('div');
  acciones.className = 'auditoria-acciones';

  const btnAnalizar = document.createElement('button');
  btnAnalizar.textContent = 'Analizar';
  btnAnalizar.className = 'btn-primary';

  const btnLimpiar = document.createElement('button');
  btnLimpiar.textContent = 'Limpiar';
  btnLimpiar.className = 'btn-secondary';

  acciones.appendChild(btnAnalizar);
  acciones.appendChild(btnLimpiar);
  seccion.appendChild(acciones);

  const resultados = document.createElement('div');
  resultados.id = 'aud-txt-resultados';
  resultados.style.marginTop = '1rem';
  seccion.appendChild(resultados);

  btnLimpiar.addEventListener('click', function () {
    textarea.value = '';
    resultados.innerHTML = '';
  });

  btnAnalizar.addEventListener('click', function () {
    const texto = textarea.value.trim();
    if (!texto) { window.showError('Pega un texto para analizar'); return; }

    const registrosPagos = window.EVE && window.EVE.registrosPagos ? window.EVE.registrosPagos : [];
    const itemsTXT = parsearTXT(texto);

    if (!itemsTXT.length) {
      resultados.innerHTML = '<p style="color:#856404">⚠️ No se encontraron tickets en el texto. Verifica el formato.</p>';
      return;
    }

    const comparacion = compararConSistema(itemsTXT, registrosPagos);
    resultados.innerHTML = '';

    // Resumen chips
    const resumen = document.createElement('div');
    resumen.className = 'auditoria-resultado-resumen';
    resumen.appendChild(crearChip('✅ ' + comparacion.coincidencias.length + ' coinciden', 'chip-ok'));
    if (comparacion.discrepancias.length) {
      resumen.appendChild(crearChip('⚠️ ' + comparacion.discrepancias.length + ' con diferencias', 'chip-warn'));
    }
    if (comparacion.soloEnTXT.length) {
      resumen.appendChild(crearChip('❌ ' + comparacion.soloEnTXT.length + ' en TXT no encontrados en sistema', 'chip-error'));
    }
    if (comparacion.soloEnSistema.length) {
      resumen.appendChild(crearChip('⚠️ ' + comparacion.soloEnSistema.length + ' en sistema sin evidencia en TXT', 'chip-info'));
    }
    resultados.appendChild(resumen);

    // Tabla discrepancias
    const tablaDisc = crearTablaDiscrepancias(comparacion.discrepancias);
    if (tablaDisc) resultados.appendChild(tablaDisc);

    // Solo en TXT
    const tablaSTXT = crearTablaSimple(comparacion.soloEnTXT,
      'Tickets en TXT no capturados en sistema', [
        { label: 'Ticket', key: 'ticket' },
        { label: 'Kg (TXT)', fn: function (r) { return r.kg !== null ? r.kg : '—'; } },
        { label: 'Monto (TXT)', fn: function (r) { return r.monto !== null ? window.formatearMoneda(r.monto) : '—'; } },
        { label: 'Línea', key: 'lineaOriginal' }
      ]);
    if (tablaSTXT) resultados.appendChild(tablaSTXT);

    // Solo en sistema
    const tablaSS = crearTablaSimple(comparacion.soloEnSistema,
      'Registros en sistema sin evidencia en TXT', [
        { label: 'Ticket', key: 'ticket' },
        { label: 'Proveedor', key: 'proveedor' },
        { label: 'Material', key: 'material' },
        { label: 'Kg', key: 'kg' },
        { label: 'Pagado', fn: function (r) { return window.formatearMoneda(r.pagado); } },
        { label: 'Fecha', key: 'fecha' }
      ]);
    if (tablaSS) resultados.appendChild(tablaSS);
  });

  return seccion;
}

function crearVistaAuditoria() {
  const contenedor = document.createElement('div');
  contenedor.className = 'auditoria-contenedor';
  contenedor.appendChild(crearSeccionFoto());
  contenedor.appendChild(crearSeccionTXT());
  return contenedor;
}

window.EVE_ADMIN_AUDITORIA = {
  crearVistaAuditoria: crearVistaAuditoria
};

})();
