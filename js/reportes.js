/* ==========================================
   EVE CONTROL v2.0 - REPORTES
   Formato v1.1 con CSV, TXT, PDF
   ========================================== */

function loadReportesModule() {
    const container = document.getElementById('moduleReportes');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">📊 Centro de Reportes</h2>
            </div>
            
            <div style="display: grid; gap: 1.5rem;">
                <!-- REPORTE SEMANAL DESTARAJE -->
                <div class="card" style="box-shadow: none; border: 2px solid var(--azul-claro);">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">📦 Reporte Semanal Destaraje</h3>
                    <p style="color: var(--gris-oscuro); margin-bottom: 1rem;">
                        Reporte completo en formato v1.1
                    </p>
                    <div class="btn-group">
                        <button class="btn btn-success" id="btnGenerarTXT">📄 TXT</button>
                        <button class="btn btn-primary" id="btnGenerarPDF">📕 PDF</button>
                        <button class="btn btn-secondary" id="btnGenerarCSV">📊 CSV</button>
                        <button class="btn btn-warning" id="btnEnviarTelegram">📤 Telegram</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    initReportesModule();
}

function initReportesModule() {
    document.getElementById('btnGenerarTXT').addEventListener('click', () => generarReporte('txt'));
    document.getElementById('btnGenerarPDF').addEventListener('click', () => generarReporte('pdf'));
    document.getElementById('btnGenerarCSV').addEventListener('click', () => generarReporte('csv'));
    document.getElementById('btnEnviarTelegram').addEventListener('click', enviarReporteTelegram);
}

// ==========================================
// OBTENER DATOS PARA REPORTE
// ==========================================
function obtenerDatosReporteSemanal() {
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    
    const finSemana = new Date(inicioSemana);
    finSemana.setDate(finSemana.getDate() + 6);
    const finSemanaStr = finSemana.toISOString().split('T')[0];
    
    const destaraje = window.EVE.registrosDestaraje.filter(r => 
        r.fechaSalida >= inicioSemana && r.fechaSalida <= hoy
    );
    const produccion = window.EVE.registrosProduccion.filter(r => 
        r.fechaSalida >= inicioSemana && r.fechaSalida <= hoy
    );
    
    const esDestaraje = (ticket) => /^\d+$/.test(ticket.trim());
    const esProduccion = (ticket) => ticket.trim().toUpperCase().startsWith('P');
    const esVenta = (ticket) => ticket.trim().toUpperCase() === 'V' || ticket.trim().toUpperCase().startsWith('V');
    
    const registrosDestaraje = destaraje.filter(r => esDestaraje(r.ticket));
    const registrosProduccion = [...produccion, ...destaraje.filter(r => esProduccion(r.ticket))];
    const registrosVentas = destaraje.filter(r => esVenta(r.ticket));
    
    return {
        inicioSemana,
        finSemanaStr,
        hoy,
        registrosDestaraje,
        registrosProduccion,
        registrosVentas
    };
}

// ==========================================
// GENERAR REPORTES
// ==========================================
async function generarReporte(formato) {
    try {
        const datos = obtenerDatosReporteSemanal();
        
        if (formato === 'txt') {
            generarReporteTXT(datos);
        } else if (formato === 'pdf') {
            await generarReportePDF(datos);
        } else if (formato === 'csv') {
            generarReporteCSV(datos);
        }
        
        showSuccess(`Reporte ${formato.toUpperCase()} generado correctamente`);
    } catch (error) {
        console.error('Error generando reporte:', error);
        showError('Error al generar reporte');
    }
}

// ==========================================
// GENERAR TXT (formato v1.1)
// ==========================================
function generarReporteTXT(datos) {
    const contenido = generarContenidoReporte(datos);
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    descargarArchivo(blob, `DESTARAJE_SEMANA_${datos.hoy}.txt`);
}

// ==========================================
// GENERAR PDF (formato v1.1)
// ==========================================
async function generarReportePDF(datos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const contenido = generarContenidoReporte(datos);
    const lineas = contenido.split('\n');
    
    let y = 20;
    doc.setFontSize(10);
    
    lineas.forEach(linea => {
        if (y > 280) {
            doc.addPage();
            y = 20;
        }
        
        // Títulos en negrita
        if (linea.includes('DESTARAJE GENERAL') || 
            linea.includes('REPORTE:') || 
            linea.includes('PERIODO:') || 
            linea.includes('DESGLOSE')) {
            doc.setFont(undefined, 'bold');
        } else {
            doc.setFont(undefined, 'normal');
        }
        
        doc.text(linea, 15, y);
        y += 5;
    });
    
    doc.save(`DESTARAJE_SEMANA_${datos.hoy}.pdf`);
}

// ==========================================
// GENERAR CSV
// ==========================================
function generarReporteCSV(datos) {
    const todosRegistros = [
        ...datos.registrosDestaraje,
        ...datos.registrosProduccion,
        ...datos.registrosVentas
    ];
    
    const csv = todosRegistros.map(r => ({
        Ticket: r.ticket,
        Proveedor: r.proveedor || r.cliente || 'PRODUCCION',
        Material: r.material,
        Kg: r.kg,
        'Fecha Entrada': r.fechaEntrada,
        'Fecha Salida': r.fechaSalida
    }));
    
    exportarCSV(csv, `DESTARAJE_SEMANA_${datos.hoy}.csv`);
}

// ==========================================
// GENERAR CONTENIDO DEL REPORTE
// ==========================================
function generarContenidoReporte(datos) {
    const { inicioSemana, finSemanaStr, hoy, registrosDestaraje, registrosProduccion, registrosVentas } = datos;
    
    const formatoFecha = (f) => {
        const [y, m, d] = f.split('-');
        return `${d}-${m}-${y}`;
    };
    
    const diaInicio = new Date(inicioSemana).getDate();
    const diaFin = new Date(finSemanaStr).getDate();
    const mes = new Date(inicioSemana).toLocaleDateString('es-MX', { month: 'long' }).toUpperCase();
    const anio = new Date(inicioSemana).getFullYear();
    
    const totalKgDestaraje = registrosDestaraje.reduce((sum, r) => sum + r.kg, 0);
    const totalKgProduccion = registrosProduccion.reduce((sum, r) => sum + r.kg, 0);
    
    // Desgloses
    const desgloseMaterial = {};
    registrosDestaraje.forEach(r => {
        const mat = r.material.toUpperCase();
        desgloseMaterial[mat] = (desgloseMaterial[mat] || 0) + r.kg;
    });
    
    const desgloseProduccion = {};
    registrosProduccion.forEach(r => {
        const mat = (r.material || r.cliente || 'SIN ESPECIFICAR').toUpperCase();
        desgloseProduccion[mat] = (desgloseProduccion[mat] || 0) + r.kg;
    });
    
    const desgloseVentas = {};
    registrosVentas.forEach(r => {
        const mat = r.material.toUpperCase();
        desgloseVentas[mat] = (desgloseVentas[mat] || 0) + r.kg;
    });
    
    const desgloseProveedor = {};
    registrosDestaraje.forEach(r => {
        const prov = r.proveedor.toUpperCase();
        if (!desgloseProveedor[prov]) {
            desgloseProveedor[prov] = { total: 0, materiales: {} };
        }
        desgloseProveedor[prov].total += r.kg;
        const mat = r.material.toUpperCase();
        desgloseProveedor[prov].materiales[mat] = (desgloseProveedor[prov].materiales[mat] || 0) + r.kg;
    });
    
    // Generar contenido
    let txt = `DESTARAJE GENERAL\n`;
    txt += `REPORTE: SEMANA\n`;
    txt += `PERIODO: ${diaInicio} AL ${diaFin} DE ${mes} DE ${anio}\n`;
    txt += `FECHA: ${formatoFecha(hoy)}\n\n`;
    
    txt += `TOTAL KG: ${Math.round(totalKgDestaraje).toLocaleString()}\n`;
    txt += `TOTAL PRODUCCION KG: ${Math.round(totalKgProduccion)}\n\n`;
    
    // Desglose por material
    txt += `DESGLOSE POR MATERIAL:\n`;
    Object.entries(desgloseMaterial)
        .sort((a, b) => b[1] - a[1])
        .forEach(([mat, kg]) => {
            txt += `${mat} ${Math.round(kg).toLocaleString()} KG\n`;
        });
    txt += `\n`;
    
    // Desglose producción
    if (Object.keys(desgloseProduccion).length > 0) {
        txt += `DESGLOSE PRODUCCION:\n`;
        Object.entries(desgloseProduccion)
            .sort((a, b) => b[1] - a[1])
            .forEach(([mat, kg]) => {
                txt += `${mat} ${Math.round(kg)} KG\n`;
            });
        txt += `\n`;
    }
    
    // Desglose ventas
    if (Object.keys(desgloseVentas).length > 0) {
        txt += `DESGLOSE VENTAS:\n`;
        Object.entries(desgloseVentas)
            .sort((a, b) => b[1] - a[1])
            .forEach(([mat, kg]) => {
                const esPiezas = mat.includes('TAMBO') || mat.includes('CAJA') || mat.includes('GARRAFON');
                if (esPiezas) {
                    txt += `${mat} ${Math.round(kg)} PZ\n`;
                } else {
                    txt += `${mat} ${Math.round(kg).toLocaleString()} KG\n`;
                }
            });
        txt += `\n`;
    }
    
    // Desglose por proveedor
    txt += `DESGLOSE POR PROVEEDOR + MATERIAL:\n`;
    Object.entries(desgloseProveedor)
        .sort((a, b) => b[1].total - a[1].total)
        .forEach(([prov, data]) => {
            txt += `${prov}: ${Math.round(data.total).toLocaleString()} KG\n`;
            Object.entries(data.materiales)
                .sort((a, b) => b[1] - a[1])
                .forEach(([mat, kg]) => {
                    txt += `  ${mat} ${Math.round(kg).toLocaleString()} KG\n`;
                });
        });
    txt += `\n`;
    
    // Detalle de tickets
    txt += `DETALLE DE TICKETS:\n`;
    const todosRegistros = [...registrosDestaraje, ...registrosProduccion, ...registrosVentas];
    todosRegistros
        .sort((a, b) => b.fechaSalida.localeCompare(a.fechaSalida))
        .forEach(r => {
            txt += `TICKET ${r.ticket}\t${(r.proveedor || r.cliente || 'PRODUCCION').toUpperCase()}\t${r.material.toUpperCase()}\t${Math.round(r.kg)}\t${formatoFecha(r.fechaEntrada)}\t${formatoFecha(r.fechaSalida)}\n`;
        });
    
    return txt;
}

// ==========================================
// ENVIAR A TELEGRAM
// ==========================================
async function enviarReporteTelegram() {
    try {
        const btn = document.getElementById('btnEnviarTelegram');
        btn.disabled = true;
        btn.textContent = 'Generando...';
        
        const datos = obtenerDatosReporteSemanal();
        
        // 1. Generar PDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        const contenido = generarContenidoReporte(datos);
        const lineas = contenido.split('\n');
        
        let y = 20;
        doc.setFontSize(10);
        
        lineas.forEach(linea => {
            if (y > 280) {
                doc.addPage();
                y = 20;
            }
            
            if (linea.includes('DESTARAJE GENERAL') || 
                linea.includes('REPORTE:') || 
                linea.includes('PERIODO:') || 
                linea.includes('DESGLOSE')) {
                doc.setFont(undefined, 'bold');
            } else {
                doc.setFont(undefined, 'normal');
            }
            
            doc.text(linea, 15, y);
            y += 5;
        });
        
        // 2. Convertir PDF a blob
        const pdfBlob = doc.output('blob');
        
        // 3. Generar mensaje de resumen
        const totalKgDestaraje = datos.registrosDestaraje.reduce((sum, r) => sum + r.kg, 0);
        const totalKgProduccion = datos.registrosProduccion.reduce((sum, r) => sum + r.kg, 0);
        
        const diaInicio = new Date(datos.inicioSemana).getDate();
        const diaFin = new Date(datos.finSemanaStr).getDate();
        const mes = new Date(datos.inicioSemana).toLocaleDateString('es-MX', { month: 'long' });
        
        const mensaje = `
📊 <b>REPORTE SEMANAL DESTARAJE</b>

📅 Periodo: ${diaInicio} al ${diaFin} de ${mes}

📦 <b>DESTARAJE:</b>
• Registros: ${datos.registrosDestaraje.length}
• Total: ${formatearKg(totalKgDestaraje)}

🏭 <b>PRODUCCIÓN:</b>
• Registros: ${datos.registrosProduccion.length}
• Total: ${formatearKg(totalKgProduccion)}

📄 Ver PDF adjunto para detalles completos

<i>Sistema EVE Control v2.0 - EVERPLASTIC</i>
        `.trim();
        
        btn.textContent = 'Enviando...';
        
        // 4. Enviar documento con caption
        const result = await sendTelegramDocument(pdfBlob, mensaje);
        
        if (result.ok) {
            showSuccess('✅ Reporte enviado a Telegram (PDF + resumen)');
        } else {
            showError('❌ Error al enviar: ' + result.description);
        }
        
    } catch (error) {
        console.error('Error enviando a Telegram:', error);
        showError('Error al enviar reporte: ' + error.message);
    } finally {
        const btn = document.getElementById('btnEnviarTelegram');
        btn.disabled = false;
        btn.textContent = '📤 Telegram';
    }
}

console.log('✅ EVE Control v2.0 - Reportes completos cargado');
