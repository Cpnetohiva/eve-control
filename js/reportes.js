/* ==========================================
   EVE CONTROL v2.0 - REPORTES
   Formato EXACTO de v1.1
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
                        Reporte en formato v1.1 (DESTARAJE GENERAL)
                    </p>
                    <div class="btn-group">
                        <button class="btn btn-primary" id="btnGenerarReporteSemanal">📄 Generar TXT</button>
                        <button class="btn btn-success" id="btnEnviarReporteSemanal">📤 Enviar a Telegram</button>
                    </div>
                </div>
                
                <!-- EXPORTACIÓN CSV -->
                <div class="card" style="box-shadow: none; border: 2px solid var(--verde);">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">📊 Exportación Rápida</h3>
                    <p style="color: var(--gris-oscuro); margin-bottom: 1rem;">
                        Exportar datos en formato CSV para Excel
                    </p>
                    <div class="btn-group">
                        <button class="btn btn-success" id="btnExportarDestarajeCSV">📦 Destaraje CSV</button>
                        <button class="btn btn-success" id="btnExportarProduccionCSV">🏭 Producción CSV</button>
                        <button class="btn btn-success" id="btnExportarPagosCSV">💰 Pagos CSV</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    initReportesModule();
}

function initReportesModule() {
    // Event listeners
    document.getElementById('btnGenerarReporteSemanal').addEventListener('click', generarReporteSemanalV11);
    document.getElementById('btnEnviarReporteSemanal').addEventListener('click', enviarReporteSemanalTelegram);
    document.getElementById('btnExportarDestarajeCSV').addEventListener('click', () => exportarCSVSimple('destaraje'));
    document.getElementById('btnExportarProduccionCSV').addEventListener('click', () => exportarCSVSimple('produccion'));
    document.getElementById('btnExportarPagosCSV').addEventListener('click', () => exportarCSVSimple('pagos'));
}

// ==========================================
// REPORTE SEMANAL FORMATO V1.1
// ==========================================
async function generarReporteSemanalV11() {
    try {
        const btn = document.getElementById('btnGenerarReporteSemanal');
        btn.disabled = true;
        btn.textContent = 'Generando...';
        
        const hoy = obtenerFechaMexico();
        const inicioSemana = obtenerInicioSemana();
        
        // Calcular fin de semana (domingo)
        const finSemana = new Date(inicioSemana);
        finSemana.setDate(finSemana.getDate() + 6);
        const finSemanaStr = finSemana.toISOString().split('T')[0];
        
        // Obtener datos
        const destaraje = window.EVE.registrosDestaraje.filter(r => 
            r.fechaSalida >= inicioSemana && r.fechaSalida <= hoy
        );
        const produccion = window.EVE.registrosProduccion.filter(r => 
            r.fechaSalida >= inicioSemana && r.fechaSalida <= hoy
        );
        
        // Filtrar por tipo de ticket
        const esDestaraje = (ticket) => /^\d+$/.test(ticket.trim());
        const esProduccion = (ticket) => ticket.trim().toUpperCase().startsWith('P');
        const esVenta = (ticket) => ticket.trim().toUpperCase() === 'V' || ticket.trim().toUpperCase().startsWith('V');
        
        const registrosDestaraje = destaraje.filter(r => esDestaraje(r.ticket));
        const registrosProduccion = [...produccion, ...destaraje.filter(r => esProduccion(r.ticket))];
        const registrosVentas = destaraje.filter(r => esVenta(r.ticket));
        
        // Generar TXT (formato v1.1)
        const contenido = generarContenidoTXTV11(
            inicioSemana, 
            finSemanaStr, 
            hoy,
            registrosDestaraje,
            registrosProduccion,
            registrosVentas
        );
        
        // Descargar como TXT
        const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `DESTARAJE_SEMANA_${hoy}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        showSuccess('Reporte generado en formato v1.1');
        
    } catch (error) {
        console.error('Error generando reporte:', error);
        showError('Error al generar reporte');
    } finally {
        const btn = document.getElementById('btnGenerarReporteSemanal');
        btn.disabled = false;
        btn.textContent = '📄 Generar TXT';
    }
}

function generarContenidoTXTV11(inicio, fin, fecha, destaraje, produccion, ventas) {
    // Convertir fechas a formato legible
    const formatoFecha = (f) => {
        const [y, m, d] = f.split('-');
        return `${d}-${m}-${y}`;
    };
    
    const diaInicio = new Date(inicio).getDate();
    const diaFin = new Date(fin).getDate();
    const mes = new Date(inicio).toLocaleDateString('es-MX', { month: 'long' }).toUpperCase();
    const anio = new Date(inicio).getFullYear();
    
    // Calcular totales
    const totalKgDestaraje = destaraje.reduce((sum, r) => sum + r.kg, 0);
    const totalKgProduccion = produccion.reduce((sum, r) => sum + r.kg, 0);
    
    // Desgloses
    const desgloseMaterial = {};
    destaraje.forEach(r => {
        const mat = r.material.toUpperCase();
        desgloseMaterial[mat] = (desgloseMaterial[mat] || 0) + r.kg;
    });
    
    const desgloseProduccion = {};
    produccion.forEach(r => {
        const mat = r.material || r.cliente || 'SIN ESPECIFICAR';
        const matUpper = mat.toUpperCase();
        desgloseProduccion[matUpper] = (desgloseProduccion[matUpper] || 0) + r.kg;
    });
    
    const desgloseVentas = {};
    ventas.forEach(r => {
        const mat = r.material.toUpperCase();
        // Detectar si son piezas (TAMBO, CAJA, etc)
        const esPiezas = mat.includes('TAMBO') || mat.includes('CAJA') || mat.includes('GARRAFON');
        if (esPiezas) {
            desgloseVentas[mat] = (desgloseVentas[mat] || 0) + r.kg;
        } else {
            desgloseVentas[mat] = (desgloseVentas[mat] || 0) + r.kg;
        }
    });
    
    // Desglose por proveedor
    const desgloseProveedor = {};
    destaraje.forEach(r => {
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
    txt += `FECHA: ${formatoFecha(fecha)}\n\n`;
    
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
    const todosRegistros = [...destaraje, ...produccion, ...ventas];
    todosRegistros
        .sort((a, b) => b.fechaSalida.localeCompare(a.fechaSalida))
        .forEach(r => {
            txt += `TICKET ${r.ticket}\t${(r.proveedor || r.cliente || 'PRODUCCION').toUpperCase()}\t${r.material.toUpperCase()}\t${Math.round(r.kg)}\t${formatoFecha(r.fechaEntrada)}\t${formatoFecha(r.fechaSalida)}\n`;
        });
    
    return txt;
}

// ==========================================
// EXPORTACIONES CSV SIMPLES
// ==========================================
function exportarCSVSimple(modulo) {
    let datos = [];
    let nombre = '';
    
    if (modulo === 'destaraje') {
        datos = window.EVE.registrosDestaraje.map(r => ({
            Ticket: r.ticket,
            Proveedor: r.proveedor,
            Material: r.material,
            Kg: r.kg,
            'Fecha Entrada': r.fechaEntrada,
            'Fecha Salida': r.fechaSalida
        }));
        nombre = 'destaraje';
    } else if (modulo === 'produccion') {
        datos = window.EVE.registrosProduccion.map(r => ({
            Ticket: r.ticket,
            Cliente: r.cliente,
            Material: r.material,
            Kg: r.kg,
            'Fecha Entrada': r.fechaEntrada,
            'Fecha Salida': r.fechaSalida
        }));
        nombre = 'produccion';
    } else if (modulo === 'pagos') {
        datos = window.EVE.registrosPagos.map(r => ({
            Ticket: r.ticket,
            Proveedor: r.proveedor,
            Material: r.material,
            Kg: r.kg,
            'Precio/Kg': r.precioKg,
            Total: r.total,
            Pagado: r.pagado,
            Fecha: r.fechaPago
        }));
        nombre = 'pagos';
    }
    
    if (datos.length === 0) {
        showError('No hay datos para exportar');
        return;
    }
    
    const fecha = new Date().toISOString().split('T')[0];
    exportarCSV(datos, `${nombre}_${fecha}.csv`);
    showSuccess('Exportación CSV completada');
}

// ==========================================
// ENVÍO A TELEGRAM
// ==========================================
async function enviarReporteSemanalTelegram() {
    try {
        const btn = document.getElementById('btnEnviarReporteSemanal');
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        
        const hoy = obtenerFechaMexico();
        const inicioSemana = obtenerInicioSemana();
        
        const destaraje = window.EVE.registrosDestaraje.filter(r => r.fechaSalida >= inicioSemana);
        const produccion = window.EVE.registrosProduccion.filter(r => r.fechaSalida >= inicioSemana);
        const pagos = window.EVE.registrosPagos.filter(r => r.fechaPago >= inicioSemana);
        
        const totalKgDestaraje = sumarCampo(destaraje, 'kg');
        const totalKgProduccion = sumarCampo(produccion, 'kg');
        const totalPagado = sumarCampo(pagos, 'pagado');
        
        const mensaje = `
📊 <b>REPORTE SEMANAL</b>

📦 <b>DESTARAJE:</b>
Registros: ${destaraje.length}
Total KG: ${formatearKg(totalKgDestaraje)}

🏭 <b>PRODUCCIÓN:</b>
Registros: ${produccion.length}
Total KG: ${formatearKg(totalKgProduccion)}

💰 <b>PAGOS:</b>
Registros: ${pagos.length}
Total Pagado: ${formatearMoneda(totalPagado)}

<i>Sistema EVE Control v2.0 - EVERPLASTIC</i>
        `.trim();
        
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
        const btn = document.getElementById('btnEnviarReporteSemanal');
        btn.disabled = false;
        btn.textContent = '📤 Enviar a Telegram';
    }
}

console.log('✅ EVE Control v2.0 - Reportes v1.1 Format cargado');
