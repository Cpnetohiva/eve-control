/* ==========================================
   EVE CONTROL v2.0 - IMPORTACIÓN DE DATOS
   Importar desde archivos Excel (.xlsx, .xls)
   ========================================== */

function mostrarModalImportacion() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'modalImportacion';
    modal.style.display = 'flex';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 700px;">
            <div class="modal-header">
                <h2>📥 Importar Datos desde Excel</h2>
                <button class="btn-close" onclick="cerrarModalImportacion()">✕</button>
            </div>
            
            <div class="modal-body">
                <!-- INSTRUCCIONES -->
                <div class="card" style="background: #e7f3ff; margin-bottom: 1.5rem;">
                    <h3 style="color: var(--azul-marino); margin-bottom: 1rem;">📋 Estructura del Archivo Excel</h3>
                    
                    <p style="margin-bottom: 1rem;"><strong>Opción 1: Archivo único con 3 hojas (recomendado)</strong></p>
                    <ul style="margin-bottom: 1rem; padding-left: 1.5rem;">
                        <li><strong>Hoja "Destaraje":</strong> Ticket, Proveedor, Material, Kg, Fecha Entrada, Fecha Salida</li>
                        <li><strong>Hoja "Produccion":</strong> Ticket, Cliente, Material, Kg, Fecha Entrada, Fecha Salida</li>
                        <li><strong>Hoja "Pagos":</strong> Ticket, Proveedor, Material, Kg, Precio/Kg, Total, Pagado, Fecha</li>
                    </ul>
                    
                    <p style="margin-bottom: 0.5rem;"><strong>Opción 2: Archivos separados</strong></p>
                    <p style="font-size: 0.9rem; color: var(--gris-oscuro);">Importa un archivo por módulo (destaraje.xlsx, produccion.xlsx, pagos.xlsx)</p>
                    
                    <button class="btn btn-secondary" onclick="descargarPlantilla()" style="margin-top: 1rem;">
                        📄 Descargar Plantilla Excel
                    </button>
                </div>
                
                <!-- SELECTOR DE MÓDULO -->
                <div class="form-group">
                    <label>¿Qué deseas importar?</label>
                    <select id="importarTipo" class="form-control">
                        <option value="completo">📦 Archivo completo (con 3 hojas)</option>
                        <option value="destaraje">📦 Solo Destaraje</option>
                        <option value="produccion">🏭 Solo Producción</option>
                        <option value="pagos">💰 Solo Pagos</option>
                    </select>
                </div>
                
                <!-- ARCHIVO -->
                <div class="form-group">
                    <label>Seleccionar Archivo Excel</label>
                    <input type="file" id="archivoImportar" class="form-control" accept=".xlsx,.xls">
                    <small style="color: var(--gris-oscuro);">Formatos soportados: .xlsx, .xls</small>
                </div>
                
                <!-- OPCIONES -->
                <div class="form-group">
                    <label style="display: flex; align-items: center; gap: 0.5rem;">
                        <input type="checkbox" id="importarReemplazar">
                        <span>⚠️ Reemplazar datos existentes (elimina todo antes de importar)</span>
                    </label>
                </div>
                
                <!-- PREVIEW -->
                <div id="previewImportacion" style="display: none; margin-top: 1.5rem;">
                    <h3 style="margin-bottom: 1rem;">👁️ Vista Previa</h3>
                    <div id="previewContenido" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--gris); border-radius: 8px; padding: 1rem; background: white;"></div>
                </div>
            </div>
            
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="cerrarModalImportacion()">Cancelar</button>
                <button class="btn btn-primary" id="btnProcesarImportacion" disabled>📥 Importar Datos</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // Event listeners
    document.getElementById('archivoImportar').addEventListener('change', previsualizarArchivo);
    document.getElementById('btnProcesarImportacion').addEventListener('click', procesarImportacion);
}

function cerrarModalImportacion() {
    const modal = document.getElementById('modalImportacion');
    if (modal) modal.remove();
}

// ==========================================
// DESCARGAR PLANTILLA
// ==========================================
function descargarPlantilla() {
    const wb = XLSX.utils.book_new();
    
    // Hoja 1: Destaraje
    const dataDestaraje = [
        ['Ticket', 'Proveedor', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
        ['9260', 'Jose Enrique', 'MIXTO', 650, '2026-04-23', '2026-04-24'],
        ['9251', 'Juana', 'PET', 1000, '2026-04-23', '2026-04-24'],
        ['V', 'Venta', 'TAMBO', 400, '2026-04-24', '2026-04-24']
    ];
    const wsDestaraje = XLSX.utils.aoa_to_sheet(dataDestaraje);
    XLSX.utils.book_append_sheet(wb, wsDestaraje, 'Destaraje');
    
    // Hoja 2: Produccion
    const dataProduccion = [
        ['Ticket', 'Cliente', 'Material', 'Kg', 'Fecha Entrada', 'Fecha Salida'],
        ['P', 'Produccion', 'PELETIZADO', 1800, '2026-04-24', '2026-04-24'],
        ['P', 'Lavado', 'LECHERO LAVADO', 800, '2026-04-24', '2026-04-24']
    ];
    const wsProduccion = XLSX.utils.aoa_to_sheet(dataProduccion);
    XLSX.utils.book_append_sheet(wb, wsProduccion, 'Produccion');
    
    // Hoja 3: Pagos
    const dataPagos = [
        ['Ticket', 'Proveedor', 'Material', 'Kg', 'Precio/Kg', 'Total', 'Pagado', 'Fecha'],
        ['9260', 'Jose Enrique', 'MIXTO', 650, 10, 6500, 6500, '2026-04-24']
    ];
    const wsPagos = XLSX.utils.aoa_to_sheet(dataPagos);
    XLSX.utils.book_append_sheet(wb, wsPagos, 'Pagos');
    
    // Descargar
    XLSX.writeFile(wb, 'PLANTILLA_EVE_CONTROL.xlsx');
    showSuccess('Plantilla descargada correctamente');
}

// ==========================================
// PREVISUALIZAR ARCHIVO
// ==========================================
async function previsualizarArchivo(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const tipo = document.getElementById('importarTipo').value;
    
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        
        let preview = '';
        let totalRegistros = 0;
        
        if (tipo === 'completo') {
            // Verificar que existan las 3 hojas
            const hojasRequeridas = ['Destaraje', 'Produccion', 'Pagos'];
            const hojasExistentes = workbook.SheetNames;
            
            hojasRequeridas.forEach(hoja => {
                if (hojasExistentes.includes(hoja)) {
                    const worksheet = workbook.Sheets[hoja];
                    const jsonData = XLSX.utils.sheet_to_json(worksheet);
                    totalRegistros += jsonData.length;
                    preview += `<h4>${hoja}: ${jsonData.length} registros</h4>`;
                    preview += `<pre style="font-size: 0.8rem;">${JSON.stringify(jsonData.slice(0, 3), null, 2)}</pre>`;
                } else {
                    preview += `<p style="color: red;">⚠️ Hoja "${hoja}" no encontrada</p>`;
                }
            });
        } else {
            // Importar solo una hoja específica
            const nombreHoja = tipo.charAt(0).toUpperCase() + tipo.slice(1);
            
            if (workbook.SheetNames.includes(nombreHoja)) {
                const worksheet = workbook.Sheets[nombreHoja];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                totalRegistros = jsonData.length;
                preview += `<h4>${nombreHoja}: ${jsonData.length} registros</h4>`;
                preview += `<pre style="font-size: 0.8rem;">${JSON.stringify(jsonData.slice(0, 5), null, 2)}</pre>`;
            } else {
                // Si no tiene el nombre exacto, usar la primera hoja
                const firstSheet = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheet];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                totalRegistros = jsonData.length;
                preview += `<h4>Hoja: ${firstSheet} (${jsonData.length} registros)</h4>`;
                preview += `<pre style="font-size: 0.8rem;">${JSON.stringify(jsonData.slice(0, 5), null, 2)}</pre>`;
            }
        }
        
        document.getElementById('previewContenido').innerHTML = preview;
        document.getElementById('previewImportacion').style.display = 'block';
        document.getElementById('btnProcesarImportacion').disabled = false;
        
        showSuccess(`Vista previa: ${totalRegistros} registros totales`);
        
    } catch (error) {
        console.error('Error leyendo archivo:', error);
        showError('Error al leer el archivo Excel');
        document.getElementById('btnProcesarImportacion').disabled = true;
    }
}

// ==========================================
// PROCESAR IMPORTACIÓN
// ==========================================
async function procesarImportacion() {
    const file = document.getElementById('archivoImportar').files[0];
    const tipo = document.getElementById('importarTipo').value;
    const reemplazar = document.getElementById('importarReemplazar').checked;
    
    if (!file) {
        showError('Selecciona un archivo');
        return;
    }
    
    const btn = document.getElementById('btnProcesarImportacion');
    btn.disabled = true;
    btn.textContent = 'Procesando...';
    
    try {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        
        let registrosImportados = 0;
        
        // Si reemplazar, eliminar datos existentes
        if (reemplazar) {
            if (tipo === 'completo' || tipo === 'destaraje') {
                await eliminarTodosLosRegistros(COLLECTIONS.DESTARAJE);
                window.EVE.registrosDestaraje = [];
            }
            if (tipo === 'completo' || tipo === 'produccion') {
                await eliminarTodosLosRegistros(COLLECTIONS.PRODUCCION);
                window.EVE.registrosProduccion = [];
            }
            if (tipo === 'completo' || tipo === 'pagos') {
                await eliminarTodosLosRegistros(COLLECTIONS.PAGOS);
                window.EVE.registrosPagos = [];
            }
        }
        
        // Importar datos
        if (tipo === 'completo') {
            // Importar todas las hojas
            if (workbook.SheetNames.includes('Destaraje')) {
                registrosImportados += await importarHojaDestaraje(workbook.Sheets['Destaraje']);
            }
            if (workbook.SheetNames.includes('Produccion')) {
                registrosImportados += await importarHojaProduccion(workbook.Sheets['Produccion']);
            }
            if (workbook.SheetNames.includes('Pagos')) {
                registrosImportados += await importarHojaPagos(workbook.Sheets['Pagos']);
            }
        } else if (tipo === 'destaraje') {
            const hoja = workbook.Sheets[workbook.SheetNames[0]];
            registrosImportados = await importarHojaDestaraje(hoja);
        } else if (tipo === 'produccion') {
            const hoja = workbook.Sheets[workbook.SheetNames[0]];
            registrosImportados = await importarHojaProduccion(hoja);
        } else if (tipo === 'pagos') {
            const hoja = workbook.Sheets[workbook.SheetNames[0]];
            registrosImportados = await importarHojaPagos(hoja);
        }
        
        showSuccess(`✅ ${registrosImportados} registros importados correctamente`);
        
        // Refrescar vistas
        if (window.currentModule === 'destaraje') renderizarDestaraje();
        if (window.currentModule === 'produccion') renderizarProduccion();
        if (window.currentModule === 'pagos') renderizarPagos();
        
        cerrarModalImportacion();
        
    } catch (error) {
        console.error('Error importando:', error);
        showError('Error al importar datos: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '📥 Importar Datos';
    }
}

// ==========================================
// IMPORTAR HOJAS INDIVIDUALES
// ==========================================
async function importarHojaDestaraje(worksheet) {
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    let count = 0;
    
    for (const row of jsonData) {
        const registro = {
            ticket: String(row.Ticket || '').trim(),
            proveedor: String(row.Proveedor || '').trim(),
            material: String(row.Material || '').trim(),
            kg: parseFloat(row.Kg || 0),
            fechaEntrada: convertirFechaExcel(row['Fecha Entrada']),
            fechaSalida: convertirFechaExcel(row['Fecha Salida'])
        };
        
        if (registro.ticket && registro.proveedor && registro.kg > 0) {
            const id = await guardarDato(COLLECTIONS.DESTARAJE, registro);
            window.EVE.registrosDestaraje.push({ ...registro, id });
            count++;
        }
    }
    
    return count;
}

async function importarHojaProduccion(worksheet) {
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    let count = 0;
    
    for (const row of jsonData) {
        const registro = {
            ticket: String(row.Ticket || '').trim(),
            cliente: String(row.Cliente || '').trim(),
            material: String(row.Material || '').trim(),
            kg: parseFloat(row.Kg || 0),
            fechaEntrada: convertirFechaExcel(row['Fecha Entrada']),
            fechaSalida: convertirFechaExcel(row['Fecha Salida'])
        };
        
        if (registro.ticket && registro.cliente && registro.kg > 0) {
            const id = await guardarDato(COLLECTIONS.PRODUCCION, registro);
            window.EVE.registrosProduccion.push({ ...registro, id });
            count++;
        }
    }
    
    return count;
}

async function importarHojaPagos(worksheet) {
    const jsonData = XLSX.utils.sheet_to_json(worksheet);
    let count = 0;
    
    for (const row of jsonData) {
        const registro = {
            ticket: String(row.Ticket || '').trim(),
            proveedor: String(row.Proveedor || '').trim(),
            material: String(row.Material || '').trim(),
            kg: parseFloat(row.Kg || 0),
            precioKg: parseFloat(row['Precio/Kg'] || 0),
            total: parseFloat(row.Total || 0),
            pagado: parseFloat(row.Pagado || 0),
            fechaPago: convertirFechaExcel(row.Fecha)
        };
        
        if (registro.ticket && registro.proveedor && registro.kg > 0) {
            const id = await guardarDato(COLLECTIONS.PAGOS, registro);
            window.EVE.registrosPagos.push({ ...registro, id });
            count++;
        }
    }
    
    return count;
}

// ==========================================
// UTILIDADES
// ==========================================
function convertirFechaExcel(fecha) {
    if (!fecha) return obtenerFechaMexico();
    
    // Si ya es string en formato YYYY-MM-DD
    if (typeof fecha === 'string' && fecha.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return fecha;
    }
    
    // Si es número de Excel (días desde 1900-01-01)
    if (typeof fecha === 'number') {
        const fechaExcel = new Date((fecha - 25569) * 86400 * 1000);
        return fechaExcel.toISOString().split('T')[0];
    }
    
    // Si es objeto Date
    if (fecha instanceof Date) {
        return fecha.toISOString().split('T')[0];
    }
    
    return obtenerFechaMexico();
}

async function eliminarTodosLosRegistros(coleccion) {
    const snapshot = await db.collection(coleccion).get();
    const batch = db.batch();
    
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });
    
    await batch.commit();
}

console.log('✅ EVE Control v2.0 - Módulo de importación cargado');
