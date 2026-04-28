/* ==========================================
   EVE CONTROL v2.0 - REPORTES
   Generación y envío de reportes
   ========================================== */

function loadReportesModule() {
    const container = document.getElementById('moduleReportes');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">📊 Centro de Reportes</h2>
            </div>
            
            <div style="display: grid; gap: 1.5rem;">
                <!-- REPORTE DIARIO -->
                <div class="card" style="box-shadow: none; border: 2px solid var(--azul-claro);">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">📅 Reporte Diario</h3>
                    <p style="color: var(--gris-oscuro); margin-bottom: 1rem;">
                        Resumen consolidado de todas las operaciones del día
                    </p>
                    <div class="btn-group">
                        <button class="btn btn-primary" id="btnGenerarReporteDiario">📄 Generar PDF</button>
                        <button class="btn btn-success" id="btnEnviarReporteDiario">📤 Enviar a Telegram</button>
                    </div>
                </div>
                
                <!-- REPORTE SEMANAL -->
                <div class="card" style="box-shadow: none; border: 2px solid var(--verde);">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">📆 Reporte Semanal</h3>
                    <p style="color: var(--gris-oscuro); margin-bottom: 1rem;">
                        Análisis completo de la semana con desgloses por material y proveedor
                    </p>
                    <div class="btn-group">
                        <button class="btn btn-primary" id="btnGenerarReporteSemanal">📄 Generar PDF</button>
                        <button class="btn btn-success" id="btnEnviarReporteSemanal">📤 Enviar a Telegram</button>
                    </div>
                </div>
                
                <!-- REPORTE PERSONALIZADO -->
                <div class="card" style="box-shadow: none; border: 2px solid var(--oro);">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">🎯 Reporte Personalizado</h3>
                    
                    <div class="form-grid" style="margin-bottom: 1rem;">
                        <div class="form-group">
                            <label class="form-label">Fecha Inicio</label>
                            <input type="date" id="reporteFechaInicio">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha Fin</label>
                            <input type="date" id="reporteFechaFin">
                        </div>
                    </div>
                    
                    <div class="form-group" style="margin-bottom: 1rem;">
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="reporteIncluirDestaraje" checked>
                            <span>Incluir Destaraje</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="reporteIncluirProduccion" checked>
                            <span>Incluir Producción</span>
                        </label>
                        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                            <input type="checkbox" id="reporteIncluirPagos" checked>
                            <span>Incluir Pagos</span>
                        </label>
                    </div>
                    
                    <button class="btn btn-warning" id="btnGenerarReportePersonalizado">🎯 Generar Reporte</button>
                </div>
                
                <!-- PROGRAMACIÓN AUTOMÁTICA -->
                <div class="card" style="box-shadow: none; border: 2px solid var(--celeste);">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">⏰ Reporte Automático</h3>
                    <p style="color: var(--gris-oscuro); margin-bottom: 1rem;">
                        Envío automático diario a Telegram a las 8:00 PM
                    </p>
                    <div id="estadoReporteAutomatico" class="alert alert-info">
                        Reporte automático programado para hoy a las 20:00
                    </div>
                </div>
            </div>
        </div>
    `;
    
    initReportesModule();
}

function initReportesModule() {
    // Configurar fechas por defecto para reporte personalizado
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    document.getElementById('reporteFechaInicio').value = inicioSemana;
    document.getElementById('reporteFechaFin').value = hoy;
    
    // Event listeners
    document.getElementById('btnGenerarReporteDiario').addEventListener('click', generarReporteDiarioPDF);
    document.getElementById('btnEnviarReporteDiario').addEventListener('click', enviarReporteDiarioTelegram);
    document.getElementById('btnGenerarReporteSemanal').addEventListener('click', generarReporteSemanalPDF);
    document.getElementById('btnEnviarReporteSemanal').addEventListener('click', enviarReporteSemanalTelegram);
    document.getElementById('btnGenerarReportePersonalizado').addEventListener('click', generarReportePersonalizado);
    
    // Programar reporte automático
    programarReporteAutomatico();
}

// ==========================================
// REPORTE DIARIO
// ==========================================
async function generarReporteDiarioPDF() {
    try {
        const btn = document.getElementById('btnGenerarReporteDiario');
        btn.disabled = true;
        btn.textContent = 'Generando...';
        
        const hoy = obtenerFechaMexico();
        const datosReporte = obtenerDatosReporte(hoy, hoy);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Título
        doc.setFontSize(20);
        doc.setTextColor(0, 29, 61);
        doc.text('REPORTE DIARIO', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setTextColor(0, 119, 182);
        doc.text(`${formatearFechaLarga(hoy)}`, 105, 30, { align: 'center' });
        
        let yPos = 45;
        
        // Resumen general
        doc.setFontSize(14);
        doc.setTextColor(0, 29, 61);
        doc.text('Resumen General', 20, yPos);
        yPos += 10;
        
        doc.autoTable({
            startY: yPos,
            head: [['Módulo', 'Registros', 'Total KG', 'Total $']],
            body: [
                ['Destaraje', datosReporte.destaraje.length, formatearKg(datosReporte.totalKgDestaraje), '-'],
                ['Producción', datosReporte.produccion.length, formatearKg(datosReporte.totalKgProduccion), '-'],
                ['Pagos', datosReporte.pagos.length, '-', formatearMoneda(datosReporte.totalPagado)]
            ],
            theme: 'grid',
            headStyles: { fillColor: [0, 119, 182] }
        });
        
        // Guardar
        doc.save(`reporte_diario_${hoy}.pdf`);
        showSuccess('Reporte PDF generado correctamente');
        
    } catch (error) {
        console.error('Error generando PDF:', error);
        showError('Error al generar PDF');
    } finally {
        const btn = document.getElementById('btnGenerarReporteDiario');
        btn.disabled = false;
        btn.textContent = '📄 Generar PDF';
    }
}

async function enviarReporteDiarioTelegram() {
    try {
        const btn = document.getElementById('btnEnviarReporteDiario');
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        
        const hoy = obtenerFechaMexico();
        const datosReporte = obtenerDatosReporte(hoy, hoy);
        
        const mensaje = generarMensajeTelegram('DIARIO', hoy, datosReporte);
        
        const result = await sendTelegramMessage(mensaje);
        
        if (result.ok) {
            showSuccess('✅ Reporte enviado a Telegram');
        } else {
            showError('❌ Error al enviar: ' + result.description);
        }
        
    } catch (error) {
        console.error('Error enviando a Telegram:', error);
        showError('Error al enviar reporte');
    } finally {
        const btn = document.getElementById('btnEnviarReporteDiario');
        btn.disabled = false;
        btn.textContent = '📤 Enviar a Telegram';
    }
}

// ==========================================
// REPORTE SEMANAL
// ==========================================
async function generarReporteSemanalPDF() {
    try {
        const btn = document.getElementById('btnGenerarReporteSemanal');
        btn.disabled = true;
        btn.textContent = 'Generando...';
        
        const hoy = obtenerFechaMexico();
        const inicioSemana = obtenerInicioSemana();
        const datosReporte = obtenerDatosReporte(inicioSemana, hoy);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Título
        doc.setFontSize(20);
        doc.setTextColor(0, 29, 61);
        doc.text('REPORTE SEMANAL', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setTextColor(0, 119, 182);
        doc.text(`Del ${formatearFechaReporte(inicioSemana)} al ${formatearFechaReporte(hoy)}`, 105, 30, { align: 'center' });
        
        let yPos = 45;
        
        // Resumen general
        doc.setFontSize(14);
        doc.setTextColor(0, 29, 61);
        doc.text('Resumen General', 20, yPos);
        yPos += 10;
        
        doc.autoTable({
            startY: yPos,
            head: [['Módulo', 'Registros', 'Total KG', 'Total $']],
            body: [
                ['Destaraje', datosReporte.destaraje.length, formatearKg(datosReporte.totalKgDestaraje), '-'],
                ['Producción', datosReporte.produccion.length, formatearKg(datosReporte.totalKgProduccion), '-'],
                ['Pagos', datosReporte.pagos.length, '-', formatearMoneda(datosReporte.totalPagado)]
            ],
            theme: 'grid',
            headStyles: { fillColor: [0, 119, 182] }
        });
        
        // Desglose por material
        yPos = doc.lastAutoTable.finalY + 15;
        doc.setFontSize(14);
        doc.text('Desglose por Material', 20, yPos);
        yPos += 10;
        
        const desgloseMaterial = datosReporte.desglosePorMaterial;
        const rowsMaterial = Object.entries(desgloseMaterial).map(([material, kg]) => [material, formatearKg(kg) + ' kg']);
        
        doc.autoTable({
            startY: yPos,
            head: [['Material', 'Total KG']],
            body: rowsMaterial,
            theme: 'striped',
            headStyles: { fillColor: [6, 214, 160] }
        });
        
        // Guardar
        doc.save(`reporte_semanal_${hoy}.pdf`);
        showSuccess('Reporte semanal PDF generado correctamente');
        
    } catch (error) {
        console.error('Error generando PDF:', error);
        showError('Error al generar PDF');
    } finally {
        const btn = document.getElementById('btnGenerarReporteSemanal');
        btn.disabled = false;
        btn.textContent = '📄 Generar PDF';
    }
}

async function enviarReporteSemanalTelegram() {
    try {
        const btn = document.getElementById('btnEnviarReporteSemanal');
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        
        const hoy = obtenerFechaMexico();
        const inicioSemana = obtenerInicioSemana();
        const datosReporte = obtenerDatosReporte(inicioSemana, hoy);
        
        const mensaje = generarMensajeTelegram('SEMANAL', `${formatearFechaReporte(inicioSemana)} - ${formatearFechaReporte(hoy)}`, datosReporte);
        
        const result = await sendTelegramMessage(mensaje);
        
        if (result.ok) {
            showSuccess('✅ Reporte semanal enviado a Telegram');
        } else {
            showError('❌ Error al enviar: ' + result.description);
        }
        
    } catch (error) {
        console.error('Error enviando a Telegram:', error);
        showError('Error al enviar reporte');
    } finally {
        const btn = document.getElementById('btnEnviarReporteSemanal');
        btn.disabled = false;
        btn.textContent = '📤 Enviar a Telegram';
    }
}

// ==========================================
// REPORTE PERSONALIZADO
// ==========================================
async function generarReportePersonalizado() {
    try {
        const fechaInicio = document.getElementById('reporteFechaInicio').value;
        const fechaFin = document.getElementById('reporteFechaFin').value;
        
        if (!fechaInicio || !fechaFin) {
            showError('Debe seleccionar fechas de inicio y fin');
            return;
        }
        
        if (fechaInicio > fechaFin) {
            showError('La fecha de inicio debe ser anterior a la fecha de fin');
            return;
        }
        
        const incluirDestaraje = document.getElementById('reporteIncluirDestaraje').checked;
        const incluirProduccion = document.getElementById('reporteIncluirProduccion').checked;
        const incluirPagos = document.getElementById('reporteIncluirPagos').checked;
        
        const datosReporte = obtenerDatosReporte(fechaInicio, fechaFin);
        
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Título
        doc.setFontSize(20);
        doc.setTextColor(0, 29, 61);
        doc.text('REPORTE PERSONALIZADO', 105, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setTextColor(0, 119, 182);
        doc.text(`Del ${formatearFechaReporte(fechaInicio)} al ${formatearFechaReporte(fechaFin)}`, 105, 30, { align: 'center' });
        
        let yPos = 45;
        const rows = [];
        
        if (incluirDestaraje) {
            rows.push(['Destaraje', datosReporte.destaraje.length, formatearKg(datosReporte.totalKgDestaraje), '-']);
        }
        if (incluirProduccion) {
            rows.push(['Producción', datosReporte.produccion.length, formatearKg(datosReporte.totalKgProduccion), '-']);
        }
        if (incluirPagos) {
            rows.push(['Pagos', datosReporte.pagos.length, '-', formatearMoneda(datosReporte.totalPagado)]);
        }
        
        if (rows.length > 0) {
            doc.setFontSize(14);
            doc.text('Resumen', 20, yPos);
            yPos += 10;
            
            doc.autoTable({
                startY: yPos,
                head: [['Módulo', 'Registros', 'Total KG', 'Total $']],
                body: rows,
                theme: 'grid',
                headStyles: { fillColor: [255, 195, 0] }
            });
        }
        
        // Guardar
        doc.save(`reporte_personalizado_${fechaInicio}_${fechaFin}.pdf`);
        showSuccess('Reporte personalizado generado correctamente');
        
    } catch (error) {
        console.error('Error generando reporte:', error);
        showError('Error al generar reporte');
    }
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================
function obtenerDatosReporte(fechaInicio, fechaFin) {
    const destaraje = window.EVE.registrosDestaraje.filter(r => 
        r.fechaSalida >= fechaInicio && r.fechaSalida <= fechaFin
    );
    const produccion = window.EVE.registrosProduccion.filter(r => 
        r.fechaSalida >= fechaInicio && r.fechaSalida <= fechaFin
    );
    const pagos = window.EVE.registrosPagos.filter(r => 
        r.fechaPago >= fechaInicio && r.fechaPago <= fechaFin
    );
    
    const totalKgDestaraje = sumarCampo(destaraje, 'kg');
    const totalKgProduccion = sumarCampo(produccion, 'kg');
    const totalPagado = sumarCampo(pagos, 'pagado');
    
    // Desglose por material
    const desglosePorMaterial = {};
    [...destaraje, ...produccion].forEach(r => {
        if (!desglosePorMaterial[r.material]) {
            desglosePorMaterial[r.material] = 0;
        }
        desglosePorMaterial[r.material] += r.kg;
    });
    
    return {
        destaraje,
        produccion,
        pagos,
        totalKgDestaraje,
        totalKgProduccion,
        totalPagado,
        desglosePorMaterial
    };
}

function generarMensajeTelegram(tipo, fecha, datos) {
    return `
📊 <b>REPORTE ${tipo} - ${fecha}</b>

📦 <b>DESTARAJE:</b>
Registros: ${datos.destaraje.length}
Total KG: ${formatearKg(datos.totalKgDestaraje)}

🏭 <b>PRODUCCIÓN:</b>
Registros: ${datos.produccion.length}
Total KG: ${formatearKg(datos.totalKgProduccion)}

💰 <b>PAGOS:</b>
Registros: ${datos.pagos.length}
Total Pagado: ${formatearMoneda(datos.totalPagado)}

<i>Sistema EVE Control v2.0 - EVERPLASTIC</i>
    `.trim();
}

// ==========================================
// PROGRAMACIÓN AUTOMÁTICA
// ==========================================
function programarReporteAutomatico() {
    const ahora = new Date();
    const horaReporte = new Date();
    horaReporte.setHours(20, 0, 0, 0); // 8:00 PM
    
    // Si ya pasó la hora, programar para mañana
    if (ahora > horaReporte) {
        horaReporte.setDate(horaReporte.getDate() + 1);
    }
    
    const tiempoHastaReporte = horaReporte - ahora;
    
    setTimeout(async () => {
        try {
            await enviarReporteDiarioTelegram();
        } catch (error) {
            console.error('Error en reporte automático:', error);
        }
        
        // Reprogramar para mañana
        programarReporteAutomatico();
    }, tiempoHastaReporte);
    
    console.log('📅 Reporte automático programado para:', horaReporte.toLocaleString('es-MX'));
}

console.log('✅ EVE Control v2.0 - Reportes cargado');
