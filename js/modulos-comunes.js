/* ==========================================
   EVE CONTROL v2.0 - FUNCIONES COMUNES
   Filtros y Reportes Locales para Módulos
   ========================================== */

// ==========================================
// AUTOCOMPLETADO DINÁMICO
// ==========================================
window.inicializarAutocompletado = function(moduloId) {
    const container = document.getElementById(`module${moduloId.charAt(0).toUpperCase() + moduloId.slice(1)}`);
    
    // Crear datalists si no existen
    if (!document.getElementById(`${moduloId}-proveedores-list`)) {
        const datalistProveedores = document.createElement('datalist');
        datalistProveedores.id = `${moduloId}-proveedores-list`;
        container.appendChild(datalistProveedores);
    }
    
    if (!document.getElementById(`${moduloId}-materiales-list`)) {
        const datalistMateriales = document.createElement('datalist');
        datalistMateriales.id = `${moduloId}-materiales-list`;
        container.appendChild(datalistMateriales);
    }
    
    if (!document.getElementById(`${moduloId}-clientes-list`)) {
        const datalistClientes = document.createElement('datalist');
        datalistClientes.id = `${moduloId}-clientes-list`;
        container.appendChild(datalistClientes);
    }
};

window.actualizarAutocompletadoModulo = function(listId, nuevoValor) {
    const datalist = document.getElementById(listId);
    if (!datalist) return;
    
    // Verificar si ya existe
    const opciones = Array.from(datalist.options).map(opt => opt.value);
    if (!opciones.includes(nuevoValor)) {
        const option = document.createElement('option');
        option.value = nuevoValor;
        datalist.appendChild(option);
    }
};

// ==========================================
// FILTROS POR MÓDULO
// ==========================================
window.aplicarFiltrosModulo = function(modulo, registros, renderFunc, tbodyId) {
    const ticket = document.getElementById(`filtro${modulo}Ticket`)?.value.toLowerCase() || '';
    const fechaDesde = document.getElementById(`filtro${modulo}FechaDesde`)?.value || '';
    const fechaHasta = document.getElementById(`filtro${modulo}FechaHasta`)?.value || '';
    const proveedor = document.getElementById(`filtro${modulo}Proveedor`)?.value.toLowerCase() || '';
    const material = document.getElementById(`filtro${modulo}Material`)?.value.toLowerCase() || '';
    
    const filtrados = registros.filter(r => {
        // Ticket
        if (ticket && !r.ticket.toString().toLowerCase().includes(ticket)) return false;
        
        // Fechas
        const fechaRegistro = r.fechaSalida || r.fechaPago || r.fecha;
        if (fechaDesde && fechaRegistro < fechaDesde) return false;
        if (fechaHasta && fechaRegistro > fechaHasta) return false;
        
        // Proveedor/Cliente
        const proveedorCliente = (r.proveedor || r.cliente || '').toLowerCase();
        if (proveedor && !proveedorCliente.includes(proveedor)) return false;
        
        // Material
        if (material && !r.material.toLowerCase().includes(material)) return false;
        
        return true;
    });
    
    renderFunc(tbodyId, filtrados);
    
    // Actualizar estadísticas filtradas
    const totalKg = filtrados.reduce((sum, r) => sum + (r.kg || 0), 0);
    const statEl = document.getElementById(`stats${modulo}Filtrados`);
    if (statEl) {
        statEl.textContent = `${filtrados.length} registros | ${formatearKg(totalKg)}`;
    }
};

window.limpiarFiltrosModulo = function(modulo) {
    const campos = ['Ticket', 'FechaDesde', 'FechaHasta', 'Proveedor', 'Material'];
    campos.forEach(campo => {
        const el = document.getElementById(`filtro${modulo}${campo}`);
        if (el) el.value = '';
    });
};

// ==========================================
// REPORTES LOCALES POR MÓDULO
// ==========================================
window.exportarModuloTXT = function(modulo, registros) {
    const fecha = obtenerFechaMexico();
    let contenido = `${modulo.toUpperCase()} - REPORTE LOCAL\n`;
    contenido += `FECHA: ${fecha}\n`;
    contenido += `TOTAL REGISTROS: ${registros.length}\n\n`;
    
    if (modulo === 'Destaraje') {
        contenido += `TICKET\tPROVEEDOR\tMATERIAL\tKG\tF.ENTRADA\tF.SALIDA\n`;
        registros.forEach(r => {
            contenido += `${r.ticket}\t${r.proveedor}\t${r.material}\t${r.kg}\t${r.fechaEntrada}\t${r.fechaSalida}\n`;
        });
    } else if (modulo === 'Produccion') {
        contenido += `TICKET\tCLIENTE\tMATERIAL\tKG\tF.ENTRADA\tF.SALIDA\n`;
        registros.forEach(r => {
            contenido += `${r.ticket}\t${r.cliente}\t${r.material}\t${r.kg}\t${r.fechaEntrada}\t${r.fechaSalida}\n`;
        });
    } else if (modulo === 'Pagos') {
        contenido += `TICKET\tPROVEEDOR\tMATERIAL\tKG\tPRECIO/KG\tTOTAL\tPAGADO\tFECHA\n`;
        registros.forEach(r => {
            contenido += `${r.ticket}\t${r.proveedor}\t${r.material}\t${r.kg}\t$${r.precioKg}\t$${r.total}\t$${r.pagado}\t${r.fechaPago}\n`;
        });
    }
    
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    descargarArchivo(blob, `${modulo}_${fecha}.txt`);
    showSuccess('Reporte TXT generado');
};

window.exportarModuloPDF = function(modulo, registros) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(16);
    doc.text(`${modulo.toUpperCase()} - REPORTE LOCAL`, 105, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Fecha: ${obtenerFechaMexico()}`, 105, 30, { align: 'center' });
    doc.text(`Total Registros: ${registros.length}`, 105, 36, { align: 'center' });
    
    let headers, body;
    
    if (modulo === 'Destaraje') {
        headers = [['Ticket', 'Proveedor', 'Material', 'Kg', 'F. Entrada', 'F. Salida']];
        body = registros.map(r => [
            r.ticket,
            r.proveedor,
            r.material,
            Math.round(r.kg),
            r.fechaEntrada,
            r.fechaSalida
        ]);
    } else if (modulo === 'Produccion') {
        headers = [['Ticket', 'Cliente', 'Material', 'Kg', 'F. Entrada', 'F. Salida']];
        body = registros.map(r => [
            r.ticket,
            r.cliente,
            r.material,
            Math.round(r.kg),
            r.fechaEntrada,
            r.fechaSalida
        ]);
    } else if (modulo === 'Pagos') {
        headers = [['Ticket', 'Proveedor', 'Material', 'Kg', '$/Kg', 'Total', 'Pagado', 'Fecha']];
        body = registros.map(r => [
            r.ticket,
            r.proveedor,
            r.material,
            Math.round(r.kg),
            `$${r.precioKg}`,
            `$${Math.round(r.total)}`,
            `$${Math.round(r.pagado)}`,
            r.fechaPago
        ]);
    }
    
    doc.autoTable({
        head: headers,
        body: body,
        startY: 45,
        theme: 'grid',
        headStyles: { fillColor: [0, 119, 182] },
        styles: { fontSize: 8 }
    });
    
    const fecha = obtenerFechaMexico();
    doc.save(`${modulo}_${fecha}.pdf`);
    showSuccess('Reporte PDF generado');
};

window.exportarModuloCSV = function(modulo, registros) {
    let datos;
    
    if (modulo === 'Destaraje') {
        datos = registros.map(r => ({
            Ticket: r.ticket,
            Proveedor: r.proveedor,
            Material: r.material,
            Kg: r.kg,
            'Fecha Entrada': r.fechaEntrada,
            'Fecha Salida': r.fechaSalida
        }));
    } else if (modulo === 'Produccion') {
        datos = registros.map(r => ({
            Ticket: r.ticket,
            Cliente: r.cliente,
            Material: r.material,
            Kg: r.kg,
            'Fecha Entrada': r.fechaEntrada,
            'Fecha Salida': r.fechaSalida
        }));
    } else if (modulo === 'Pagos') {
        datos = registros.map(r => ({
            Ticket: r.ticket,
            Proveedor: r.proveedor,
            Material: r.material,
            Kg: r.kg,
            'Precio/Kg': r.precioKg,
            Total: r.total,
            Pagado: r.pagado,
            Fecha: r.fechaPago
        }));
    }
    
    const fecha = obtenerFechaMexico();
    exportarCSV(datos, `${modulo}_${fecha}.csv`);
    showSuccess('Reporte CSV generado');
};

console.log('✅ EVE Control v2.0 - Funciones comunes de módulos cargadas');
