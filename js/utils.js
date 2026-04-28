/* ==========================================
   EVE CONTROL v2.0 - UTILITIES
   Funciones de uso común
   ========================================== */

// ==========================================
// FECHA Y HORA
// ==========================================
function obtenerFechaMexico() {
    const ahora = new Date();
    const opciones = { timeZone: 'America/Mexico_City' };
    const fechaMexico = new Date(ahora.toLocaleString('en-US', opciones));
    return fechaMexico.toISOString().split('T')[0];
}

function obtenerInicioSemana(fecha = null) {
    const date = fecha ? new Date(fecha) : new Date();
    const dia = date.getDay();
    const diff = date.getDate() - dia + (dia === 0 ? -6 : 1);
    return new Date(date.setDate(diff)).toISOString().split('T')[0];
}

function formatearFechaReporte(fecha) {
    if (!fecha) return '';
    const [year, month, day] = fecha.split('-');
    return `${day}-${month}-${year}`;
}

function formatearFechaLarga(fecha) {
    const opciones = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        timeZone: 'America/Mexico_City'
    };
    return new Date(fecha).toLocaleDateString('es-MX', opciones);
}

// ==========================================
// FORMATO DE NÚMEROS
// ==========================================
function formatearMoneda(cantidad) {
    return new Intl.NumberFormat('es-MX', {
        style: 'currency',
        currency: 'MXN'
    }).format(cantidad);
}

function formatearKg(kg) {
    return Math.round(kg).toLocaleString('es-MX');
}

function formatearNumero(num) {
    return num.toLocaleString('es-MX');
}

// ==========================================
// NOTIFICACIONES
// ==========================================
function mostrarNotificacion(mensaje, tipo = 'info') {
    const notif = document.createElement('div');
    notif.className = `alert alert-${tipo}`;
    notif.textContent = mensaje;
    notif.style.position = 'fixed';
    notif.style.top = '20px';
    notif.style.right = '20px';
    notif.style.zIndex = '9999';
    notif.style.minWidth = '300px';
    notif.style.animation = 'slideIn 0.3s ease';
    
    document.body.appendChild(notif);
    
    setTimeout(() => {
        notif.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

function showError(mensaje) {
    mostrarNotificacion(mensaje, 'error');
}

function showSuccess(mensaje) {
    mostrarNotificacion(mensaje, 'success');
}

// Agregar estilos de animación
if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
        @keyframes slideIn {
            from {
                transform: translateX(400px);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(400px);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
}

// ==========================================
// MODALES
// ==========================================
function abrirModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function cerrarModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

// ==========================================
// EXPORTACIONES
// ==========================================
function exportarCSV(datos, nombreArchivo) {
    if (!datos || datos.length === 0) {
        showError('No hay datos para exportar');
        return;
    }
    
    const headers = Object.keys(datos[0]);
    const csvContent = [
        headers.join(','),
        ...datos.map(row => headers.map(h => {
            const value = row[h] || '';
            return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
        }).join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    descargarArchivo(blob, nombreArchivo);
}

function exportarTXT(contenido, nombreArchivo) {
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8;' });
    descargarArchivo(blob, nombreArchivo);
}

function descargarArchivo(blob, nombreArchivo) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==========================================
// TELEGRAM API
// ==========================================
async function sendTelegramMessage(text) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: TELEGRAM_CHAT_ID,
                text: text,
                parse_mode: 'HTML'
            })
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error enviando a Telegram:', error);
        throw error;
    }
}

async function sendTelegramDocument(pdfBlob, caption) {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`;
    
    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    formData.append('document', pdfBlob, 'reporte.pdf');
    formData.append('caption', caption);
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            body: formData
        });
        
        return await response.json();
    } catch (error) {
        console.error('Error enviando documento a Telegram:', error);
        throw error;
    }
}

// ==========================================
// AUTOCOMPLETADO
// ==========================================
function configurarAutocompletado(inputId, sugerencias) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    const datalistId = `${inputId}-datalist`;
    let datalist = document.getElementById(datalistId);
    
    if (!datalist) {
        datalist = document.createElement('datalist');
        datalist.id = datalistId;
        input.setAttribute('list', datalistId);
        input.parentNode.appendChild(datalist);
    }
    
    datalist.innerHTML = sugerencias.map(s => `<option value="${s}">`).join('');
}

function actualizarSugerencias(inputId, nuevoValor) {
    const datalist = document.getElementById(`${inputId}-datalist`);
    if (!datalist) return;
    
    const existe = Array.from(datalist.options).some(opt => opt.value === nuevoValor);
    if (!existe && nuevoValor) {
        const option = document.createElement('option');
        option.value = nuevoValor;
        datalist.appendChild(option);
    }
}

// ==========================================
// VALIDACIONES
// ==========================================
function validarNumero(valor, min = 0) {
    const num = parseFloat(valor);
    return !isNaN(num) && num >= min;
}

function validarFecha(fecha) {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    return regex.test(fecha);
}

function validarCamposRequeridos(campos) {
    for (const [nombre, valor] of Object.entries(campos)) {
        if (!valor || valor.toString().trim() === '') {
            showError(`El campo ${nombre} es requerido`);
            return false;
        }
    }
    return true;
}

// ==========================================
// FILTROS Y BÚSQUEDA
// ==========================================
function filtrarPorTexto(registros, texto, campos) {
    if (!texto) return registros;
    
    const textoBusqueda = texto.toLowerCase();
    return registros.filter(reg => 
        campos.some(campo => 
            reg[campo] && reg[campo].toString().toLowerCase().includes(textoBusqueda)
        )
    );
}

function filtrarPorFecha(registros, campoFecha, fechaInicio, fechaFin) {
    return registros.filter(reg => {
        const fecha = reg[campoFecha];
        if (!fecha) return false;
        
        if (fechaInicio && fecha < fechaInicio) return false;
        if (fechaFin && fecha > fechaFin) return false;
        
        return true;
    });
}

// ==========================================
// AGRUPACIONES
// ==========================================
function agruparPor(registros, campo) {
    return registros.reduce((acc, reg) => {
        const clave = reg[campo] || 'Sin categoría';
        if (!acc[clave]) acc[clave] = [];
        acc[clave].push(reg);
        return acc;
    }, {});
}

function sumarCampo(registros, campo) {
    return registros.reduce((sum, reg) => sum + (parseFloat(reg[campo]) || 0), 0);
}

// ==========================================
// CARGA DE DATOS
// ==========================================
async function cargarDatos(coleccion) {
    try {
        const snapshot = await db.collection(coleccion).get();
        return snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error(`Error cargando ${coleccion}:`, error);
        showError(`Error al cargar datos de ${coleccion}`);
        return [];
    }
}

async function guardarDato(coleccion, dato) {
    try {
        const docRef = await db.collection(coleccion).add(dato);
        return docRef.id;
    } catch (error) {
        console.error(`Error guardando en ${coleccion}:`, error);
        showError(`Error al guardar en ${coleccion}`);
        throw error;
    }
}

async function actualizarDato(coleccion, id, dato) {
    try {
        await db.collection(coleccion).doc(id).update(dato);
    } catch (error) {
        console.error(`Error actualizando ${coleccion}:`, error);
        showError(`Error al actualizar ${coleccion}`);
        throw error;
    }
}

async function eliminarDato(coleccion, id) {
    try {
        await db.collection(coleccion).doc(id).delete();
    } catch (error) {
        console.error(`Error eliminando de ${coleccion}:`, error);
        showError(`Error al eliminar de ${coleccion}`);
        throw error;
    }
}

console.log('✅ EVE Control v2.0 - Utils cargado');
