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

const UMBRAL_CONFIANZA_OCR = 60;
const ESTADOS_AUDITORIA = {
  COINCIDE: 'COINCIDE',
  CON_DIFERENCIAS: 'CON_DIFERENCIAS',
  NO_VERIFICADO: 'NO_VERIFICADO',
  SIN_REGISTRO: 'SIN_REGISTRO',
  SIN_TICKET: 'SIN_TICKET',
  ERROR: 'ERROR'
};

let workerOCR = null;
async function obtenerWorkerOCR() {
  if (!workerOCR) {
    workerOCR = await Tesseract.createWorker('spa');
  }
  return workerOCR;
}

function normalizarTexto(valor) {
  return (valor || '').toString().trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function confianzaDeTexto(valorCrudo, palabras) {
  const tokens = (valorCrudo || '').split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const confianzas = tokens.map(function (t) {
    const limpio = t.replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/g, '');
    if (!limpio) return null;
    const palabra = palabras.find(function (p) { return p.text.replace(/[^A-Za-z0-9ÁÉÍÓÚÑáéíóúñ]/g, '') === limpio; });
    return palabra ? palabra.confidence : null;
  }).filter(function (c) { return c !== null; });
  if (!confianzas.length) return 0;
  return confianzas.reduce(function (a, b) { return a + b; }, 0) / confianzas.length;
}

function extraerTicket(texto, palabras) {
  const candidatos = palabras.filter(function (p) { return /^\d{3,5}$/.test(p.text.trim()); });
  if (candidatos.length) {
    candidatos.sort(function (a, b) {
      const altoA = a.bbox.y1 - a.bbox.y0;
      const altoB = b.bbox.y1 - b.bbox.y0;
      return altoB - altoA;
    });
    const mejor = candidatos[0];
    return { valor: mejor.text.trim(), confianza: mejor.confidence };
  }
  const porLabel = texto.match(/\b(?:ticket|folio)\b\s*[:\-]?\s*(\d{3,5})/i);
  if (porLabel) {
    const valor = porLabel[1];
    const palabra = palabras.find(function (p) { return p.text.replace(/\D/g, '') === valor; });
    return { valor: valor, confianza: palabra ? palabra.confidence : 70 };
  }
  return { valor: null, confianza: 0 };
}

function extraerPorEtiqueta(texto, etiquetas, palabras) {
  for (let i = 0; i < etiquetas.length; i++) {
    const regex = new RegExp('\\b' + etiquetas[i] + '\\b\\s*[:\\-]?\\s*([A-Za-zÁÉÍÓÚÑáéíóúñ .]{3,40})', 'i');
    const match = texto.match(regex);
    if (match) {
      const valor = match[1].split('\n')[0].trim();
      if (valor) return { valor: valor, confianza: confianzaDeTexto(valor, palabras) };
    }
  }
  return { valor: null, confianza: 0 };
}

function extraerPeso(texto, palabras) {
  const match = texto.match(/\b(?:peso|neto|bruto|kg)\b\s*[:\-]?\s*(\d+(?:[.,]\d+)?)/i);
  if (!match) return { valor: null, confianza: 0 };
  const valor = parseFloat(match[1].replace(',', '.'));
  return { valor: valor, confianza: confianzaDeTexto(match[1], palabras) };
}

function extraerFecha(texto, palabras) {
  const match = texto.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (!match) return { valor: null, confianza: 0 };
  return { valor: window.parsearFecha(match[0]), confianza: confianzaDeTexto(match[0], palabras) };
}

function extraerCampos(texto, palabras) {
  return {
    ticket: extraerTicket(texto, palabras),
    proveedor: extraerPorEtiqueta(texto, ['proveedor', 'nombre', 'de'], palabras),
    material: extraerPorEtiqueta(texto, ['material', 'producto', 'descripcion', 'descripción'], palabras),
    peso: extraerPeso(texto, palabras),
    fecha: extraerFecha(texto, palabras)
  };
}

async function detectarCamposEnImagen(file) {
  const worker = await obtenerWorkerOCR();
  const { data } = await worker.recognize(file);
  return extraerCampos(data.text || '', data.words || []);
}

function esConfiable(campo) {
  if (!campo || campo.valor === null || campo.valor === undefined || campo.valor === '') return false;
  if (typeof campo.valor === 'number' && campo.valor <= 0) return false;
  return campo.confianza >= UMBRAL_CONFIANZA_OCR;
}

function compararCampos(leido, registrado) {
  const diferencias = [];
  const camposComparados = {};

  ['proveedor', 'material'].forEach(function (campo) {
    const c = leido[campo];
    camposComparados[campo] = esConfiable(c) ? 'verificado' : 'no_verificado';
    if (!esConfiable(c)) return;
    if (normalizarTexto(c.valor) !== normalizarTexto(registrado[campo])) {
      diferencias.push({ campo: campo, leido: c.valor, sistema: registrado[campo] });
    }
  });

  const peso = leido.peso;
  camposComparados.peso = esConfiable(peso) ? 'verificado' : 'no_verificado';
  if (esConfiable(peso)) {
    const pesoSistema = Number(registrado.kg);
    if (Math.abs(peso.valor - pesoSistema) > pesoSistema * 0.02) {
      diferencias.push({ campo: 'peso', leido: peso.valor, sistema: pesoSistema });
    }
  }

  const fecha = leido.fecha;
  camposComparados.fecha = esConfiable(fecha) ? 'verificado' : 'no_verificado';
  if (esConfiable(fecha) && fecha.valor !== registrado.fechaEntrada) {
    diferencias.push({ campo: 'fecha', leido: fecha.valor, sistema: registrado.fechaEntrada });
  }

  return { diferencias: diferencias, camposComparados: camposComparados };
}

function determinarEstado(registro, comparacion) {
  if (!registro) return ESTADOS_AUDITORIA.SIN_REGISTRO;
  if (comparacion.diferencias.length > 0) return ESTADOS_AUDITORIA.CON_DIFERENCIAS;
  const algunoNoVerificado = Object.keys(comparacion.camposComparados).some(function (k) {
    return comparacion.camposComparados[k] === 'no_verificado';
  });
  return algunoNoVerificado ? ESTADOS_AUDITORIA.NO_VERIFICADO : ESTADOS_AUDITORIA.COINCIDE;
}

async function procesarLoteFotos(files, onProgreso) {
  const resultados = [];
  for (let i = 0; i < files.length; i++) {
    onProgreso(i + 1, files.length);
    const file = files[i];
    try {
      const campos = await detectarCamposEnImagen(file);
      if (!campos.ticket.valor) {
        resultados.push({ archivo: file, campos: campos, estado: ESTADOS_AUDITORIA.SIN_TICKET, registro: null, comparacion: null });
        continue;
      }
      const registro = (window.EVE.registrosDestaraje || []).find(function (r) {
        return String(r.ticket) === String(campos.ticket.valor);
      });
      const comparacion = registro ? compararCampos(campos, registro) : { diferencias: [], camposComparados: {} };
      const estado = determinarEstado(registro, comparacion);
      resultados.push({ archivo: file, campos: campos, estado: estado, registro: registro, comparacion: comparacion });
    } catch (e) {
      resultados.push({ archivo: file, campos: null, estado: ESTADOS_AUDITORIA.ERROR, registro: null, comparacion: null, error: e.message });
    }
  }
  return resultados;
}

function crearTarjetaResultadoLote(resultado) {
  const card = document.createElement('div');
  card.className = 'card auditoria-resultado-ticket';

  const CFG_ESTADO = {
    COINCIDE: { texto: '✅ Coincide', clase: 'chip-ok' },
    CON_DIFERENCIAS: { texto: '⚠️ Con diferencias', clase: 'chip-warn' },
    NO_VERIFICADO: { texto: '❔ No verificado', clase: 'chip-info' },
    SIN_REGISTRO: { texto: '❌ Sin registro en sistema', clase: 'chip-error' },
    SIN_TICKET: { texto: '❌ Ticket no legible', clase: 'chip-error' },
    ERROR: { texto: '❌ Error al procesar', clase: 'chip-error' }
  };
  const cfgEstado = CFG_ESTADO[resultado.estado] || { texto: resultado.estado, clase: 'chip-info' };

  const encabezado = document.createElement('div');
  encabezado.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:0.75rem;margin-bottom:0.5rem;flex-wrap:wrap';
  const ticketTexto = document.createElement('strong');
  const ticketValor = resultado.campos && resultado.campos.ticket.valor ? resultado.campos.ticket.valor : '—';
  ticketTexto.textContent = 'Ticket ' + ticketValor + ' — ' + resultado.archivo.name;
  encabezado.appendChild(ticketTexto);
  encabezado.appendChild(crearChip(cfgEstado.texto, cfgEstado.clase));
  card.appendChild(encabezado);

  if (resultado.estado === ESTADOS_AUDITORIA.ERROR) {
    const p = document.createElement('p');
    p.style.color = 'var(--rojo-error)';
    p.textContent = resultado.error;
    card.appendChild(p);
    return card;
  }

  if (resultado.estado === ESTADOS_AUDITORIA.SIN_TICKET) {
    const p = document.createElement('p');
    p.style.color = '#856404';
    p.textContent = 'No se pudo leer con confianza un número de ticket en esta foto.';
    card.appendChild(p);
    return card;
  }

  if (resultado.estado === ESTADOS_AUDITORIA.SIN_REGISTRO) {
    const p = document.createElement('p');
    p.style.color = 'var(--rojo-error)';
    p.textContent = 'El ticket ' + ticketValor + ' no existe en los registros de Destaraje.';
    card.appendChild(p);
    return card;
  }

  const tabla = document.createElement('table');
  tabla.className = 'tabla-destaraje';
  tabla.style.fontSize = '0.85rem';
  tabla.innerHTML = '<thead><tr><th>Campo</th><th>Foto (OCR)</th><th>Sistema</th><th></th></tr></thead>';
  const tbody = document.createElement('tbody');

  [
    { key: 'proveedor', label: 'Proveedor', sistemaKey: 'proveedor' },
    { key: 'material', label: 'Material', sistemaKey: 'material' },
    { key: 'peso', label: 'Peso', sistemaKey: 'kg' },
    { key: 'fecha', label: 'Fecha entrada', sistemaKey: 'fechaEntrada' }
  ].forEach(function (c) {
    const campoLeido = resultado.campos[c.key];
    const verificado = resultado.comparacion.camposComparados[c.key] === 'verificado';
    const tieneDiferencia = resultado.comparacion.diferencias.some(function (d) { return d.campo === c.key; });
    const valorFotoCrudo = campoLeido && campoLeido.valor !== null && campoLeido.valor !== undefined ? campoLeido.valor : null;
    const valorFoto = valorFotoCrudo === null ? '—' : (c.key === 'fecha' ? window.formatearFecha(valorFotoCrudo) : valorFotoCrudo);
    const valorSistemaCrudo = resultado.registro[c.sistemaKey];
    const valorSistema = (valorSistemaCrudo === undefined || valorSistemaCrudo === null || valorSistemaCrudo === '') ? '—' :
      (c.key === 'fecha' ? window.formatearFecha(valorSistemaCrudo) : valorSistemaCrudo);
    let icono = '❔';
    if (verificado) icono = tieneDiferencia ? '❌' : '✅';

    const fila = document.createElement('tr');
    fila.innerHTML = '<td>' + c.label + '</td><td>' + valorFoto + '</td><td>' + valorSistema + '</td><td>' + icono + '</td>';
    tbody.appendChild(fila);
  });

  tabla.appendChild(tbody);
  card.appendChild(tabla);

  if (resultado.estado === ESTADOS_AUDITORIA.CON_DIFERENCIAS) {
    const btnCorregir = document.createElement('button');
    btnCorregir.textContent = 'Corregir registro en Destaraje';
    btnCorregir.className = 'btn-secondary';
    btnCorregir.style.cssText = 'margin-top:0.6rem;font-size:0.85rem;padding:0.4rem 0.8rem';
    btnCorregir.addEventListener('click', function () {
      if (window.abrirModalEdicion) {
        window.abrirModalEdicion(resultado.registro);
      } else {
        window.showError('Cambia al módulo Destaraje para editar este registro');
      }
    });
    card.appendChild(btnCorregir);
  }

  return card;
}

async function guardarResultadosLote(resultados) {
  const usuario = (window.EVE && window.EVE.currentUser && window.EVE.currentUser.username) || 'Admin';
  const resultadosGuardar = [];
  const resultadosConFoto = [];

  for (let i = 0; i < resultados.length; i++) {
    const r = resultados[i];
    if (!r.campos || !r.campos.ticket.valor) continue;
    const ticket = String(r.campos.ticket.valor);

    let idFotoAuditoria = null;
    await new Promise(function (resolve) {
      comprimirImagen(r.archivo, async function (base64) {
        try {
          const ref = await window.db.collection('auditoria_fotos').add({
            ticket: ticket,
            fotoBase64: base64,
            registroId: r.registro ? r.registro.id : null,
            subidoPor: usuario,
            timestamp: new Date().toISOString()
          });
          idFotoAuditoria = ref.id;
        } catch (e) {
          console.error('No se pudo guardar la foto del ticket ' + ticket, e);
        }
        resolve();
      });
    });

    resultadosGuardar.push({
      ticket: ticket,
      estado: r.estado,
      idFotoAuditoria: idFotoAuditoria,
      camposLeidos: {
        proveedor: r.campos.proveedor.valor,
        material: r.campos.material.valor,
        peso: r.campos.peso.valor,
        fecha: r.campos.fecha.valor
      },
      camposSistema: r.registro ? {
        proveedor: r.registro.proveedor,
        material: r.registro.material,
        peso: r.registro.kg,
        fecha: r.registro.fechaEntrada
      } : null,
      diferencias: r.comparacion ? r.comparacion.diferencias : [],
      imagenNombre: r.archivo.name
    });

    resultadosConFoto.push({
      ticket: ticket,
      estado: r.estado,
      registro: r.registro || null,
      idFotoAuditoria: idFotoAuditoria
    });
  }

  let idAuditoria = null;
  try {
    const auditoriaRef = await window.db.collection('auditorias').add({
      fecha: window.obtenerFechaMexico(),
      totalFotos: resultados.length,
      resultados: resultadosGuardar,
      creadoPor: usuario,
      fechaRegistro: new Date().toISOString()
    });
    idAuditoria = auditoriaRef.id;

    const idsFotos = resultadosGuardar.map((r) => r.idFotoAuditoria).filter(Boolean);
    await Promise.all(idsFotos.map((idFoto) =>
      window.db.collection('auditoria_fotos').doc(idFoto).update({ idLoteAuditoria: idAuditoria }).catch((e) => {
        console.error('No se pudo vincular la foto ' + idFoto + ' al lote', e);
      })
    ));
  } catch (e) {
    console.error('No se pudo guardar el resumen del lote de auditoría', e);
  }

  return { idAuditoria: idAuditoria, resultados: resultadosConFoto };
}

function crearSeccionCargaMasiva() {
  const bloque = document.createElement('div');

  const subtitulo = document.createElement('div');
  subtitulo.className = 'auditoria-subtitulo';
  subtitulo.textContent = 'Carga masiva — Auditoría automática';
  bloque.appendChild(subtitulo);

  const ayuda = document.createElement('p');
  ayuda.style.cssText = 'font-size:0.85rem;color:#666;margin-bottom:0.75rem';
  ayuda.textContent = 'Selecciona varias fotos de tickets. El sistema lee el ticket, proveedor, material, peso y fecha de cada foto y los compara automáticamente contra Destaraje.';
  bloque.appendChild(ayuda);

  const inputMasivo = document.createElement('input');
  inputMasivo.type = 'file';
  inputMasivo.accept = 'image/*';
  inputMasivo.multiple = true;
  inputMasivo.id = 'aud-fotos-masivo';
  inputMasivo.style.cssText = 'font-size:0.9rem';

  const btnIniciar = document.createElement('button');
  btnIniciar.textContent = 'Iniciar Auditoría';
  btnIniciar.className = 'btn-primary';
  btnIniciar.style.marginLeft = '0.75rem';

  const gridMasivo = document.createElement('div');
  gridMasivo.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;margin-bottom:0.5rem';
  gridMasivo.appendChild(inputMasivo);
  gridMasivo.appendChild(btnIniciar);
  bloque.appendChild(gridMasivo);

  const progreso = document.createElement('div');
  progreso.className = 'auditoria-lote-progreso';
  bloque.appendChild(progreso);

  const resumen = document.createElement('div');
  resumen.className = 'auditoria-resultado-resumen';
  bloque.appendChild(resumen);

  const listaResultados = document.createElement('div');
  bloque.appendChild(listaResultados);

  btnIniciar.addEventListener('click', async function () {
    const files = Array.from(inputMasivo.files || []);
    if (!files.length) { window.showError('Selecciona al menos una foto'); return; }
    if (typeof Tesseract === 'undefined') {
      window.showError('No se pudo cargar el motor de OCR. Verifica tu conexión a internet e intenta de nuevo.');
      return;
    }

    btnIniciar.disabled = true;
    progreso.textContent = 'Procesando foto 1 de ' + files.length + '…';
    resumen.innerHTML = '';
    listaResultados.innerHTML = '';

    try {
      const resultados = await procesarLoteFotos(files, function (actual, total) {
        progreso.textContent = 'Procesando foto ' + actual + ' de ' + total + '…';
      });

      resultados.forEach(function (r) {
        listaResultados.appendChild(crearTarjetaResultadoLote(r));
      });

      const conteos = { COINCIDE: 0, CON_DIFERENCIAS: 0, NO_VERIFICADO: 0, SIN_REGISTRO: 0 };
      resultados.forEach(function (r) {
        if (conteos[r.estado] !== undefined) conteos[r.estado]++;
      });
      resumen.appendChild(crearChip('✅ ' + conteos.COINCIDE + ' coinciden', 'chip-ok'));
      resumen.appendChild(crearChip('⚠️ ' + conteos.CON_DIFERENCIAS + ' con diferencias', 'chip-warn'));
      resumen.appendChild(crearChip('❔ ' + conteos.NO_VERIFICADO + ' no verificados', 'chip-info'));
      resumen.appendChild(crearChip('❌ ' + conteos.SIN_REGISTRO + ' sin registro', 'chip-error'));

      progreso.textContent = 'Auditoría completa. Guardando evidencia…';
      const loteGuardado = await guardarResultadosLote(resultados);
      progreso.textContent = 'Listo — ' + resultados.length + ' fotos procesadas.';

      if (conteos.COINCIDE > 0 && window.EVE_CXP && loteGuardado.idAuditoria) {
        const btnGenerarCxP = document.createElement('button');
        btnGenerarCxP.textContent = '💰 Generar CxP de tickets COINCIDEN';
        btnGenerarCxP.className = 'btn-primary';
        btnGenerarCxP.style.marginLeft = '0.5rem';
        btnGenerarCxP.addEventListener('click', async function () {
          btnGenerarCxP.disabled = true;
          try {
            const resumenCxP = await window.EVE_CXP.generarCxPDesdeAuditoria(loteGuardado.resultados, loteGuardado.idAuditoria);
            window.showSuccess(resumenCxP.generadas + ' cuentas generadas' + (resumenCxP.omitidas.length ? ', ' + resumenCxP.omitidas.length + ' omitidas' : ''));
            if (resumenCxP.omitidas.length) {
              console.warn('CxP omitidas:', resumenCxP.omitidas);
            }
          } catch (e) {
            window.showError('Error al generar CxP: ' + e.message);
          } finally {
            btnGenerarCxP.disabled = false;
          }
        });
        resumen.appendChild(btnGenerarCxP);
      }
    } catch (e) {
      window.showError('Error al procesar el lote: ' + e.message);
      progreso.textContent = '';
    } finally {
      btnIniciar.disabled = false;
      inputMasivo.value = '';
    }
  });

  return bloque;
}

function crearSeccionFoto() {
  const seccion = document.createElement('div');
  seccion.className = 'card auditoria-seccion';

  const titulo = document.createElement('h4');
  titulo.textContent = 'Auditoría por Foto — Destaraje';
  seccion.appendChild(titulo);

  seccion.appendChild(crearSeccionCargaMasiva());

  const sepMasivo = document.createElement('hr');
  sepMasivo.style.cssText = 'border:none;border-top:1px solid #eee;margin:1rem 0';
  seccion.appendChild(sepMasivo);

  const subtituloIndividual = document.createElement('div');
  subtituloIndividual.className = 'auditoria-subtitulo';
  subtituloIndividual.textContent = 'Carga individual';
  seccion.appendChild(subtituloIndividual);

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
