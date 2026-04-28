/* ==========================================
   EVE CONTROL v2.0 - REPORTES COMPLETO
   Con filtros, selector de módulo y formato v1.1
   ========================================== */

function loadReportesModule() {
    const container = document.getElementById('moduleReportes');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">📊 Centro de Reportes</h2>
            </div>
            
            <!-- SELECTOR DE MÓDULO -->
            <div class="form-group">
                <label>Seleccionar Módulo</label>
                <select id="reporteModulo" class="form-control">
                    <option value="general">📦 Reporte General (Todos los módulos)</option>
                    <option value="destaraje">📦 Solo Destaraje</option>
                    <option value="produccion">🏭 Solo Producción</option>
                    <option value="pagos">💰 Solo Pagos</option>
                </select>
            </div>
            
            <!-- FILTROS -->
            <div class="card" style="background: var(--gris-claro); margin-top: 1rem;">
                <h3 style="margin-bottom: 1rem;">🔍 Filtros</h3>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
                    <div class="form-group">
                        <label>Ticket</label>
                        <input type="text" id="filtroTicket" class="form-control" placeholder="Ej: 9260">
                    </div>
                    <div class="form-group">
                        <label>Fecha Desde</label>
                        <input type="date" id="filtroFechaDesde" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Fecha Hasta</label>
                        <input type="date" id="filtroFechaHasta" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Proveedor/Cliente</label>
                        <input type="text" id="filtroProveedor" class="form-control" placeholder="Ej: Juan">
                    </div>
                    <div class="form-group">
                        <label>Material</label>
                        <input type="text" id="filtroMaterial" class="form-control" placeholder="Ej: PET">
                    </div>
                </div>
                <button class="btn btn-secondary" id="btnLimpiarFiltros" style="margin-top: 1rem;">🔄 Limpiar Filtros</button>
            </div>
            
            <!-- BOTONES DE EXPORTACIÓN -->
            <div class="card" style="margin-top: 1rem;">
                <h3 style="margin-bottom: 1rem;">📄 Generar Reporte</h3>
                <div class="btn-group">
                    <button class="btn btn-primary" id="btnGenerarTXT">📄 TXT</button>
                    <button class="btn btn-primary" id="btnGenerarPDF">📕 PDF</button>
                    <button class="btn btn-primary" id="btnGenerarCSV">📊 CSV</button>
                    <button class="btn btn-success" id="btnEnviarTelegram">📤 Telegram</button>
                </div>
            </div>
        </div>
    `;
    
    initReportesModule();
}

function initReportesModule() {
    // Inicializar fechas por defecto (inicio de semana a hoy)
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    
    document.getElementById('filtroFechaDesde').value = inicioSemana;
    document.getElementById('filtroFechaHasta').value = hoy;
    
    // Event listeners
    document.getElementById('btnGenerarTXT').addEventListener('click', () => generarReporte('txt'));
    document.getElementById('btnGenerarPDF').addEventListener('click', () => generarReporte('pdf'));
    document.getElementById('btnGenerarCSV').addEventListener('click', () => generarReporte('csv'));
    document.getElementById('btnEnviarTelegram').addEventListener('click', enviarReporteTelegram);
    document.getElementById('btnLimpiarFiltros').addEventListener('click', limpiarFiltros);
}

function limpiarFiltros() {
    document.getElementById('filtroTicket').value = '';
    document.getElementById('filtroProveedor').value = '';
    document.getElementById('filtroMaterial').value = '';
    
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    document.getElementById('filtroFechaDesde').value = inicioSemana;
    document.getElementById('filtroFechaHasta').value = hoy;
    
    showSuccess('Filtros limpiados');
}

// ==========================================
// OBTENER DATOS CON FILTROS
// ==========================================
function obtenerDatosFiltrados() {
    const modulo = document.getElementById('reporteModulo').value;
    const ticket = document.getElementById('filtroTicket').value.trim().toLowerCase();
    const fechaDesde = document.getElementById('filtroFechaDesde').value;
    const fechaHasta = document.getElementById('filtroFechaHasta').value;
    const proveedor = document.getElementById('filtroProveedor').value.trim().toLowerCase();
    const material = document.getElementById('filtroMaterial').value.trim().toLowerCase();
    
    let destaraje = [];
    let produccion = [];
    let pagos = [];
    
    // Filtrar por módulo
    if (modulo === 'general' || modulo === 'destaraje') {
        destaraje = window.EVE.registrosDestaraje.filter(r => {
            if (ticket && !r.ticket.toLowerCase().includes(ticket)) return false;
            if (fechaDesde && r.fechaSalida < fechaDesde) return false;
            if (fechaHasta && r.fechaSalida > fechaHasta) return false;
            if (proveedor && !r.proveedor.toLowerCase().includes(proveedor)) return false;
            if (material && !r.material.toLowerCase().includes(material)) return false;
            return true;
        });
    }
    
    if (modulo === 'general' || modulo === 'produccion') {
        produccion = window.EVE.registrosProduccion.filter(r => {
            if (ticket && !r.ticket.toLowerCase().includes(ticket)) return false;
            if (fechaDesde && r.fechaSalida < fechaDesde) return false;
            if (fechaHasta && r.fechaSalida > fechaHasta) return false;
            if (proveedor && !r.cliente.toLowerCase().includes(proveedor)) return false;
            if (material && !r.material.toLowerCase().includes(material)) return false;
            return true;
        });
    }
    
    if (modulo === 'general' || modulo === 'pagos') {
        pagos = window.EVE.registrosPagos.filter(r => {
            if (ticket && !r.ticket.toLowerCase().includes(ticket)) return false;
            if (fechaDesde && r.fechaPago < fechaDesde) return false;
            if (fechaHasta && r.fechaPago > fechaHasta) return false;
            if (proveedor && !r.proveedor.toLowerCase().includes(proveedor)) return false;
            if (material && !r.material.toLowerCase().includes(material)) return false;
            return true;
        });
    }
    
    // Separar destaraje por tipo de ticket
    const esDestaraje = (t) => /^\d+$/.test(t.trim());
    const esProduccion = (t) => t.trim().toUpperCase().startsWith('P');
    const esVenta = (t) => t.trim().toUpperCase().startsWith('V');
    
    const registrosDestaraje = destaraje.filter(r => esDestaraje(r.ticket));
    const registrosProduccion = [...produccion, ...destaraje.filter(r => esProduccion(r.ticket))];
    const registrosVentas = destaraje.filter(r => esVenta(r.ticket));
    
    return {
        modulo,
        fechaDesde,
        fechaHasta,
        registrosDestaraje,
        registrosProduccion,
        registrosVentas,
        registrosPagos: pagos
    };
}

// ==========================================
// GENERAR REPORTES
// ==========================================
async function generarReporte(formato) {
    try {
        const datos = obtenerDatosFiltrados();
        
        if (formato === 'txt') {
            generarTXT(datos);
        } else if (formato === 'pdf') {
            await generarPDF(datos);
        } else if (formato === 'csv') {
            generarCSV(datos);
        }
        
        showSuccess(`Reporte ${formato.toUpperCase()} generado`);
    } catch (error) {
        console.error('Error generando reporte:', error);
        showError('Error al generar reporte');
    }
}

// ==========================================
// GENERAR TXT (formato v1.1 EXACTO)
// ==========================================
function generarTXT(datos) {
    const contenido = generarContenidoReporte(datos);
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    const fecha = obtenerFechaMexico();
    const nombreModulo = datos.modulo === 'general' ? 'GENERAL' : datos.modulo.toUpperCase();
    descargarArchivo(blob, `${nombreModulo}_REPORTE_${fecha}.txt`);
}

// ==========================================
// GENERAR PDF (formato v1.1)
// ==========================================
async function generarPDF(datos) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const contenido = generarContenidoReporte(datos);
    const lineas = contenido.split('\n');
    
    let y = 15;
    doc.setFontSize(9);
    
    lineas.forEach(linea => {
        if (y > 280) {
            doc.addPage();
            y = 15;
        }
        
        // Títulos y secciones en negrita
        if (linea.includes('DESTARAJE GENERAL') || 
            linea.includes('REPORTE:') || 
            linea.includes('PERIODO:') ||
            linea.includes('FECHA:') ||
            linea.includes('TOTAL') ||
            linea.includes('DESGLOSE')) {
            doc.setFont(undefined, 'bold');
        } else {
            doc.setFont(undefined, 'normal');
        }
        
        doc.text(linea, 10, y);
        y += 4;
    });
    
    const fecha = obtenerFechaMexico();
    const nombreModulo = datos.modulo === 'general' ? 'GENERAL' : datos.modulo.toUpperCase();
    doc.save(`${nombreModulo}_REPORTE_${fecha}.pdf`);
}

// ==========================================
// GENERAR CSV
// ==========================================
function generarCSV(datos) {
    const registros = [
        ...datos.registrosDestaraje.map(r => ({ ...r, tipo: 'DESTARAJE' })),
        ...datos.registrosProduccion.map(r => ({ ...r, tipo: 'PRODUCCION' })),
        ...datos.registrosVentas.map(r => ({ ...r, tipo: 'VENTA' })),
        ...datos.registrosPagos.map(r => ({ ...r, tipo: 'PAGO' }))
    ];
    
    const csv = registros.map(r => ({
        Tipo: r.tipo,
        Ticket: r.ticket,
        'Proveedor/Cliente': r.proveedor || r.cliente || '',
        Material: r.material,
        Kg: r.kg,
        'Precio/Kg': r.precioKg || '',
        Total: r.total || '',
        Pagado: r.pagado || '',
        'Fecha Entrada': r.fechaEntrada || '',
        'Fecha Salida': r.fechaSalida || r.fechaPago || ''
    }));
    
    const fecha = obtenerFechaMexico();
    const nombreModulo = datos.modulo === 'general' ? 'GENERAL' : datos.modulo.toUpperCase();
    exportarCSV(csv, `${nombreModulo}_REPORTE_${fecha}.csv`);
}

// ==========================================
// GENERAR CONTENIDO DEL REPORTE (formato v1.1)
// ==========================================
function generarContenidoReporte(datos) {
    const { fechaDesde, fechaHasta, registrosDestaraje, registrosProduccion, registrosVentas, registrosPagos } = datos;
    
    const formatoFecha = (f) => {
        const [y, m, d] = f.split('-');
        return `${d}-${m}-${y}`;
    };
    
    const diaInicio = new Date(fechaDesde).getDate();
    const diaFin = new Date(fechaHasta).getDate();
    const mes = new Date(fechaDesde).toLocaleDateString('es-MX', { month: 'long' }).toUpperCase();
    const anio = new Date(fechaDesde).getFullYear();
    const hoy = obtenerFechaMexico();
    
    // Calcular totales
    const totalKgDestaraje = registrosDestaraje.reduce((sum, r) => sum + r.kg, 0);
    const totalKgProduccion = registrosProduccion.reduce((sum, r) => sum + r.kg, 0);
    const totalKgVentas = registrosVentas.reduce((sum, r) => sum + r.kg, 0);
    const totalPagado = registrosPagos.reduce((sum, r) => sum + r.pagado, 0);
    const totalDeuda = registrosPagos.reduce((sum, r) => sum + (r.total - r.pagado), 0);
    
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
    
    const desglosePagosProveedor = {};
    registrosPagos.forEach(r => {
        const prov = r.proveedor.toUpperCase();
        if (!desglosePagosProveedor[prov]) {
            desglosePagosProveedor[prov] = { total: 0, pagado: 0 };
        }
        desglosePagosProveedor[prov].total += r.total;
        desglosePagosProveedor[prov].pagado += r.pagado;
    });
    
    // Generar contenido
    let txt = `DESTARAJE GENERAL\n`;
    txt += `REPORTE: SEMANA\n`;
    txt += `PERIODO: ${diaInicio} AL ${diaFin} DE ${mes} DE ${anio}\n`;
    txt += `FECHA: ${formatoFecha(hoy)}\n`;
    txt += `\n`;
    
    txt += `TOTAL KG: ${Math.round(totalKgDestaraje).toLocaleString()}\n`;
    txt += `TOTAL PRODUCCION KG: ${Math.round(totalKgProduccion)}\n`;
    txt += `\n`;
    
    // Desglose por material
    if (Object.keys(desgloseMaterial).length > 0) {
        txt += `DESGLOSE POR MATERIAL:\n`;
        Object.entries(desgloseMaterial)
            .sort((a, b) => b[1] - a[1])
            .forEach(([mat, kg]) => {
                txt += `${mat} ${Math.round(kg).toLocaleString()} KG\n`;
            });
        txt += `\n`;
    }
    
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
    if (Object.keys(desgloseProveedor).length > 0) {
        txt += `DESGLOSE POR PROVEEDOR + MATERIAL:\n`;
        Object.entries(desgloseProveedor)
            .sort((a, b) => b[1].total - a[1].total)
            .forEach(([prov, data]) => {
                txt += `${prov}: ${Math.round(data.total).toLocaleString()} KG\n`;
                Object.entries(data.materiales)
                    .sort((a, b) => b[1] - a[1])
                    .forEach(([mat, kg]) => {
                        txt += ` ${mat} ${Math.round(kg).toLocaleString()} KG\n`;
                    });
            });
        txt += `\n`;
    }
    
    // Desglose de pagos
    if (Object.keys(desglosePagosProveedor).length > 0) {
        txt += `DESGLOSE PAGOS POR PROVEEDOR:\n`;
        Object.entries(desglosePagosProveedor)
            .sort((a, b) => b[1].total - a[1].total)
            .forEach(([prov, data]) => {
                const deuda = data.total - data.pagado;
                txt += `${prov}: TOTAL $${Math.round(data.total).toLocaleString()} | PAGADO $${Math.round(data.pagado).toLocaleString()} | DEUDA $${Math.round(deuda).toLocaleString()}\n`;
            });
        txt += `\n`;
        txt += `RESUMEN PAGOS:\n`;
        txt += `TOTAL PAGADO: $${Math.round(totalPagado).toLocaleString()}\n`;
        txt += `TOTAL DEUDA: $${Math.round(totalDeuda).toLocaleString()}\n`;
        txt += `\n`;
    }
    
    // Detalle de tickets
    txt += `DETALLE DE TICKETS:\n`;
    
    // Header para tickets
    if (registrosDestaraje.length > 0 || registrosProduccion.length > 0 || registrosVentas.length > 0) {
        txt += `TICKET\tPROVEEDOR\tMATERIAL\tKG\tF. ENTRADA\tF. SALIDA\n`;
        
        const todosRegistros = [...registrosDestaraje, ...registrosProduccion, ...registrosVentas];
        todosRegistros
            .sort((a, b) => b.fechaSalida.localeCompare(a.fechaSalida))
            .forEach(r => {
                txt += `${r.ticket}\t${(r.proveedor || r.cliente || 'PRODUCCION').toUpperCase()}\t${r.material.toUpperCase()}\t${Math.round(r.kg)}\t${formatoFecha(r.fechaEntrada)}\t${formatoFecha(r.fechaSalida)}\n`;
            });
    }
    
    // Detalle de pagos
    if (registrosPagos.length > 0) {
        txt += `\n`;
        txt += `DETALLE DE PAGOS:\n`;
        txt += `TICKET\tPROVEEDOR\tMATERIAL\tKG\tPRECIO/KG\tTOTAL\tPAGADO\tDEUDA\tFECHA\n`;
        registrosPagos
            .sort((a, b) => b.fechaPago.localeCompare(a.fechaPago))
            .forEach(r => {
                const deuda = r.total - r.pagado;
                txt += `${r.ticket}\t${r.proveedor.toUpperCase()}\t${r.material.toUpperCase()}\t${Math.round(r.kg)}\t$${r.precioKg}\t$${Math.round(r.total)}\t$${Math.round(r.pagado)}\t$${Math.round(deuda)}\t${formatoFecha(r.fechaPago)}\n`;
            });
    }
    
    return txt;
}

// ==========================================
// ENVIAR A TELEGRAM
// ==========================================
async function enviarReporteTelegram() {
    try {
        const btn = document.getElementById('btnEnviarTelegram');
        btn.disabled = true;
        btn.textContent = 'Generando PDF...';
        
        const datos = obtenerDatosFiltrados();
        
        // Generar PDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const contenido = generarContenidoReporte(datos);
        const lineas = contenido.split('\n');
        
        let y = 15;
        doc.setFontSize(9);
        
        lineas.forEach(linea => {
            if (y > 280) {
                doc.addPage();
                y = 15;
            }
            if (linea.includes('DESTARAJE GENERAL') || linea.includes('REPORTE:') || linea.includes('PERIODO:') || linea.includes('DESGLOSE') || linea.includes('TOTAL')) {
                doc.setFont(undefined, 'bold');
            } else {
                doc.setFont(undefined, 'normal');
            }
            doc.text(linea, 10, y);
            y += 4;
        });
        
        const pdfBlob = doc.output('blob');
        
        // Generar resumen
        const totalKgDestaraje = datos.registrosDestaraje.reduce((sum, r) => sum + r.kg, 0);
        const totalKgProduccion = datos.registrosProduccion.reduce((sum, r) => sum + r.kg, 0);
        const totalKgVentas = datos.registrosVentas.reduce((sum, r) => sum + r.kg, 0);
        const totalPagado = datos.registrosPagos.reduce((sum, r) => sum + r.pagado, 0);
        
        const diaInicio = new Date(datos.fechaDesde).getDate();
        const diaFin = new Date(datos.fechaHasta).getDate();
        const mes = new Date(datos.fechaDesde).toLocaleDateString('es-MX', { month: 'long' });
        
        const mensaje = `
📊 <b>REPORTE SEMANAL</b>

📅 Periodo: ${diaInicio} al ${diaFin} de ${mes}

📦 <b>DESTARAJE:</b>
• Registros: ${datos.registrosDestaraje.length}
• Total: ${formatearKg(totalKgDestaraje)}

🏭 <b>PRODUCCIÓN:</b>
• Registros: ${datos.registrosProduccion.length}
• Total: ${formatearKg(totalKgProduccion)}

💼 <b>VENTAS:</b>
• Registros: ${datos.registrosVentas.length}
• Total: ${formatearKg(totalKgVentas)}

💰 <b>PAGOS:</b>
• Registros: ${datos.registrosPagos.length}
• Total Pagado: ${formatearMoneda(totalPagado)}

📄 Ver PDF adjunto para detalles completos

<i>Sistema EVE Control v2.0 - EVERPLASTIC</i>
        `.trim();
        
        btn.textContent = 'Enviando...';
        
        const result = await sendTelegramDocument(pdfBlob, mensaje);
        
        if (result.ok) {
            showSuccess('✅ Reporte enviado a Telegram');
        } else {
            showError('❌ Error: ' + result.description);
        }
        
    } catch (error) {
        console.error('Error enviando a Telegram:', error);
        showError('Error al enviar reporte');
    } finally {
        const btn = document.getElementById('btnEnviarTelegram');
        btn.disabled = false;
        btn.textContent = '📤 Telegram';
    }
}

console.log('✅ EVE Control v2.0 - Reportes completo cargado');
