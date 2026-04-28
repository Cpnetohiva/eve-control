/* ==========================================
   EVE CONTROL v2.0 - RECONOCIMIENTO DE VOZ
   Captura de datos por voz
   ========================================== */

let recognition = null;
let isRecording = false;

// Inicializar reconocimiento de voz
function initVoiceRecognition() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.warn('⚠️ Reconocimiento de voz no soportado en este navegador');
        return false;
    }
    
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    
    recognition.lang = 'es-MX';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    
    recognition.onstart = function() {
        isRecording = true;
        console.log('🎤 Grabación iniciada');
    };
    
    recognition.onend = function() {
        isRecording = false;
        console.log('🎤 Grabación finalizada');
    };
    
    recognition.onerror = function(event) {
        console.error('Error de reconocimiento:', event.error);
        isRecording = false;
        
        if (event.error === 'no-speech') {
            showError('No se detectó audio. Intente de nuevo.');
        } else if (event.error === 'not-allowed') {
            showError('Permiso de micrófono denegado');
        } else {
            showError('Error en reconocimiento de voz: ' + event.error);
        }
    };
    
    return true;
}

// ==========================================
// BOTONES DE VOZ PARA CADA MÓDULO
// ==========================================
function agregarBotonVoz(moduloId, callback) {
    const form = document.querySelector(`#${moduloId} form`);
    if (!form) return;
    
    // Verificar si ya existe el botón
    if (document.querySelector(`#${moduloId} .voice-btn`)) return;
    
    const btnContainer = document.createElement('div');
    btnContainer.style.textAlign = 'center';
    btnContainer.style.marginTop = '1rem';
    
    const btnVoz = document.createElement('button');
    btnVoz.type = 'button';
    btnVoz.className = 'voice-btn';
    btnVoz.innerHTML = '🎤';
    btnVoz.title = 'Mantener presionado para grabar';
    
    // Desktop: mousedown/mouseup
    btnVoz.addEventListener('mousedown', function(e) {
        e.preventDefault();
        iniciarGrabacion(moduloId, btnVoz, callback);
    });
    
    btnVoz.addEventListener('mouseup', function(e) {
        e.preventDefault();
        detenerGrabacion(btnVoz);
    });
    
    btnVoz.addEventListener('mouseleave', function() {
        if (isRecording) {
            detenerGrabacion(btnVoz);
        }
    });
    
    // Mobile: touchstart/touchend
    btnVoz.addEventListener('touchstart', function(e) {
        e.preventDefault();
        iniciarGrabacion(moduloId, btnVoz, callback);
    });
    
    btnVoz.addEventListener('touchend', function(e) {
        e.preventDefault();
        detenerGrabacion(btnVoz);
    });
    
    btnContainer.appendChild(btnVoz);
    
    const instruccion = document.createElement('p');
    instruccion.style.fontSize = '0.875rem';
    instruccion.style.color = 'var(--gris-oscuro)';
    instruccion.style.marginTop = '0.5rem';
    instruccion.textContent = 'Mantén presionado para dictar';
    btnContainer.appendChild(instruccion);
    
    form.parentNode.insertBefore(btnContainer, form.nextSibling);
}

function iniciarGrabacion(moduloId, btnVoz, callback) {
    if (!recognition) {
        if (!initVoiceRecognition()) {
            showError('Reconocimiento de voz no disponible');
            return;
        }
    }
    
    if (isRecording) return;
    
    btnVoz.classList.add('recording');
    btnVoz.innerHTML = '⏺️';
    
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript;
        console.log('Transcripción:', transcript);
        callback(transcript);
    };
    
    try {
        recognition.start();
    } catch (error) {
        console.error('Error iniciando reconocimiento:', error);
        btnVoz.classList.remove('recording');
        btnVoz.innerHTML = '🎤';
    }
}

function detenerGrabacion(btnVoz) {
    if (!isRecording) return;
    
    try {
        recognition.stop();
    } catch (error) {
        console.error('Error deteniendo reconocimiento:', error);
    }
    
    btnVoz.classList.remove('recording');
    btnVoz.innerHTML = '🎤';
}

// ==========================================
// PARSEO DE DICTADO - DESTARAJE
// ==========================================
function parsearDictadoDestaraje(texto) {
    console.log('Parseando destaraje:', texto);
    
    // Ejemplo: "Ticket 1234 de Francisco, PET, 500, entrada 22 abril, salida 23 abril"
    const textoLimpio = texto.toLowerCase().trim();
    
    const datos = {
        ticket: '',
        proveedor: '',
        material: '',
        kg: '',
        fechaEntrada: '',
        fechaSalida: ''
    };
    
    // Extraer ticket (número o "v")
    const matchTicket = textoLimpio.match(/(?:ticket\s+)?(\d+|v)/i);
    if (matchTicket) {
        datos.ticket = matchTicket[1].toUpperCase();
    }
    
    // Extraer proveedor (después de "de")
    const matchProveedor = textoLimpio.match(/de\s+([a-záéíóúñ]+)/i);
    if (matchProveedor) {
        datos.proveedor = capitalizar(matchProveedor[1]);
    }
    
    // Extraer material (palabras comunes)
    const materiales = ['pet', 'pead', 'pp', 'bolsa', 'film', 'rafia', 'costal', 'garrafón', 'tambor', 'mixto', 'cristal', 'color'];
    for (const mat of materiales) {
        if (textoLimpio.includes(mat)) {
            datos.material = capitalizar(mat);
            if (textoLimpio.includes('cristal')) datos.material = 'PET Cristal';
            if (textoLimpio.includes('color')) datos.material = 'PET Color';
            break;
        }
    }
    
    // Extraer kg (números que NO sean el ticket)
    const numeros = textoLimpio.match(/\b\d+(?:\.\d+)?\b/g);
    if (numeros && numeros.length > 1) {
        // El primer número es el ticket, el segundo son los kg
        datos.kg = numeros[1];
    } else if (numeros && numeros.length === 1 && !datos.ticket) {
        datos.kg = numeros[0];
    }
    
    // Extraer fechas
    datos.fechaEntrada = extraerFecha(textoLimpio, 'entrada');
    datos.fechaSalida = extraerFecha(textoLimpio, 'salida');
    
    return datos;
}

// ==========================================
// PARSEO DE DICTADO - PRODUCCIÓN
// ==========================================
function parsearDictadoProduccion(texto) {
    console.log('Parseando producción:', texto);
    
    const textoLimpio = texto.toLowerCase().trim();
    
    const datos = {
        ticket: '',
        cliente: '',
        material: '',
        kg: '',
        fechaEntrada: '',
        fechaSalida: ''
    };
    
    // Similar a destaraje pero con "cliente" en lugar de "proveedor"
    const matchTicket = textoLimpio.match(/(?:ticket\s+)?(\d+)/i);
    if (matchTicket) {
        datos.ticket = matchTicket[1];
    }
    
    const matchCliente = textoLimpio.match(/(?:de|cliente)\s+([a-záéíóúñ\s]+?)(?:,|$|material|kg)/i);
    if (matchCliente) {
        datos.cliente = capitalizar(matchCliente[1].trim());
    }
    
    const materiales = ['pet', 'pead', 'pp', 'bolsa', 'film', 'rafia', 'costal', 'garrafón', 'tambor', 'mixto'];
    for (const mat of materiales) {
        if (textoLimpio.includes(mat)) {
            datos.material = capitalizar(mat);
            break;
        }
    }
    
    const numeros = textoLimpio.match(/\b\d+(?:\.\d+)?\b/g);
    if (numeros && numeros.length > 1) {
        datos.kg = numeros[1];
    }
    
    datos.fechaEntrada = extraerFecha(textoLimpio, 'entrada');
    datos.fechaSalida = extraerFecha(textoLimpio, 'salida');
    
    return datos;
}

// ==========================================
// PARSEO DE DICTADO - PAGOS
// ==========================================
function parsearDictadoPagos(texto) {
    console.log('Parseando pago:', texto);
    
    // Ejemplo: "Ticket 1234 de Francisco, Mixto, 800, a 8.20, pagado 6500"
    const textoLimpio = texto.toLowerCase().trim();
    
    const datos = {
        ticket: '',
        proveedor: '',
        material: '',
        kg: '',
        precioKg: '',
        pagado: ''
    };
    
    const matchTicket = textoLimpio.match(/(?:ticket\s+)?(\d+)/i);
    if (matchTicket) {
        datos.ticket = matchTicket[1];
    }
    
    const matchProveedor = textoLimpio.match(/de\s+([a-záéíóúñ]+)/i);
    if (matchProveedor) {
        datos.proveedor = capitalizar(matchProveedor[1]);
    }
    
    const materiales = ['pet', 'pead', 'pp', 'bolsa', 'film', 'rafia', 'costal', 'garrafón', 'tambor', 'mixto'];
    for (const mat of materiales) {
        if (textoLimpio.includes(mat)) {
            datos.material = capitalizar(mat);
            break;
        }
    }
    
    // Extraer números: ticket, kg, precio, pagado
    const numeros = textoLimpio.match(/\d+(?:\.\d+)?/g);
    if (numeros && numeros.length >= 3) {
        datos.kg = numeros[1]; // segundo número
        datos.precioKg = numeros[2]; // tercer número
        if (numeros.length >= 4) {
            datos.pagado = numeros[3]; // cuarto número
        }
    }
    
    // Si dice "pagado X", extraer ese número
    const matchPagado = textoLimpio.match(/pagado\s+(\d+(?:\.\d+)?)/i);
    if (matchPagado) {
        datos.pagado = matchPagado[1];
    }
    
    return datos;
}

// ==========================================
// UTILIDADES
// ==========================================
function extraerFecha(texto, tipo) {
    // Buscar fecha en formato "22 abril" o "22 de abril"
    const meses = {
        'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
        'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
        'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
    };
    
    const regexFecha = new RegExp(`${tipo}\\s+(\\d{1,2})\\s+(?:de\\s+)?([a-z]+)`, 'i');
    const match = texto.match(regexFecha);
    
    if (match) {
        const dia = match[1].padStart(2, '0');
        const mes = meses[match[2].toLowerCase()];
        if (mes) {
            const año = new Date().getFullYear();
            return `${año}-${mes}-${dia}`;
        }
    }
    
    return obtenerFechaMexico(); // Fecha actual por defecto
}

function capitalizar(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function llenarFormulario(moduloId, datos) {
    for (const [campo, valor] of Object.entries(datos)) {
        if (valor) {
            const input = document.getElementById(`${moduloId}${capitalizar(campo)}`);
            if (input) {
                input.value = valor;
                
                // Trigger change event para calculos automáticos
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    }
    
    showSuccess('Datos capturados por voz');
}

// ==========================================
// EXPORTAR FUNCIONES
// ==========================================
window.agregarBotonVoz = agregarBotonVoz;
window.parsearDictadoDestaraje = parsearDictadoDestaraje;
window.parsearDictadoProduccion = parsearDictadoProduccion;
window.parsearDictadoPagos = parsearDictadoPagos;
window.llenarFormulario = llenarFormulario;

console.log('✅ EVE Control v2.0 - Voz cargado');
