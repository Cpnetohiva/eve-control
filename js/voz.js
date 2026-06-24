(function () {

const MESES_VOZ = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12
};

function parsearFechaVoz(texto) {
  const limpio = texto.trim().toLowerCase();
  const match = limpio.match(/(\d{1,2})\s+(?:de\s+)?(\w+)/);
  if (!match) {
    throw new Error(`No se pudo reconocer la fecha: "${texto}"`);
  }
  const dia = Number(match[1]);
  const mes = MESES_VOZ[match[2]];
  if (!mes) {
    throw new Error(`No se reconoció el mes: "${match[2]}"`);
  }
  const anio = Number(window.obtenerFechaMexico().split('-')[0]);
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function parsearTicketYNombre(segmento) {
  const match = segmento.trim().match(/^ticket\s+(\S+)\s+de\s+(.+)$/i);
  if (!match) {
    throw new Error(`No se reconoció "ticket ... de ...": "${segmento}"`);
  }
  return { ticket: match[1].toUpperCase(), nombre: match[2].trim() };
}

function dividirSegmentos(texto, minimo) {
  const segmentos = texto.split(',').map((s) => s.trim()).filter(Boolean);
  if (segmentos.length < minimo) {
    throw new Error(`No se reconocieron todos los datos esperados (se reconocieron ${segmentos.length} de ${minimo})`);
  }
  return segmentos;
}

function parsearNumero(segmento) {
  const match = segmento.match(/(\d+(?:\.\d+)?)/);
  if (!match) {
    throw new Error(`No se reconoció la cantidad: "${segmento}"`);
  }
  return Number(match[1]);
}

function parseDestaraje(texto) {
  const segmentos = dividirSegmentos(texto, 5);
  const { ticket, nombre: proveedor } = parsearTicketYNombre(segmentos[0]);
  const material = segmentos[1];
  const kg = parsearNumero(segmentos[2]);
  const fechaEntrada = parsearFechaVoz(segmentos[3]);
  const fechaSalida = parsearFechaVoz(segmentos[4]);
  return { ticket, proveedor, material, kg, fechaEntrada, fechaSalida };
}

function parseProduccion(texto) {
  const segmentos = dividirSegmentos(texto, 5);
  const { ticket, nombre: cliente } = parsearTicketYNombre(segmentos[0]);
  const material = segmentos[1];
  const kg = parsearNumero(segmentos[2]);
  const fechaEntrada = parsearFechaVoz(segmentos[3]);
  const fechaSalida = parsearFechaVoz(segmentos[4]);
  return { ticket, cliente, material, kg, fechaEntrada, fechaSalida };
}

function parsePagos(texto) {
  const segmentos = dividirSegmentos(texto, 5);
  const { ticket, nombre: proveedor } = parsearTicketYNombre(segmentos[0]);
  const material = segmentos[1];
  const kg = parsearNumero(segmentos[2]);
  const precioPorKg = parsearNumero(segmentos[3]);
  const pagado = parsearNumero(segmentos[4]);
  const total = kg * precioPorKg;
  return { ticket, proveedor, material, kg, precioPorKg, pagado, total };
}

window.parsearFechaVoz = parsearFechaVoz;
window.parsearTicketYNombre = parsearTicketYNombre;
window.parseDestaraje = parseDestaraje;
window.parseProduccion = parseProduccion;
window.parsePagos = parsePagos;

function crearBotonVoz(onResultado) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'btn-voz';
  boton.textContent = '🎤';
  let reconocimiento = null;

  function iniciar(evento) {
    evento.preventDefault();
    const Constructor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Constructor) {
      window.showError('Tu navegador no soporta reconocimiento de voz');
      return;
    }
    reconocimiento = new Constructor();
    reconocimiento.lang = 'es-MX';
    reconocimiento.continuous = false;
    reconocimiento.interimResults = false;
    reconocimiento.onresult = (eventoResultado) => {
      const texto = eventoResultado.results[0][0].transcript;
      onResultado(texto);
    };
    reconocimiento.onerror = () => {
      window.showError('No se pudo reconocer el audio, intenta de nuevo');
    };
    reconocimiento.onend = () => {
      boton.classList.remove('grabando');
    };
    boton.classList.add('grabando');
    reconocimiento.start();
  }

  function detener() {
    boton.classList.remove('grabando');
    if (reconocimiento) {
      reconocimiento.stop();
    }
  }

  boton.addEventListener('mousedown', iniciar);
  boton.addEventListener('touchstart', iniciar);
  boton.addEventListener('mouseup', detener);
  boton.addEventListener('touchend', detener);
  boton.addEventListener('mouseleave', detener);

  return boton;
}

window.crearBotonVoz = crearBotonVoz;

})();
