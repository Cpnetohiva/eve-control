/* ==========================================
   EVE CONTROL v2.0 - PAGOS A PROVEEDORES
   Control de pagos y ministraciones semanales
   ========================================== */

function loadPagosModule() {
    const container = document.getElementById('modulePagos');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">💰 Nuevo Pago</h2>
                <button class="btn btn-warning" id="btnAbrirMinistraciones">📊 Ministraciones</button>
            </div>
            
            <form id="pagosForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Ticket</label>
                        <input type="text" id="pagosTicket" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Proveedor</label>
                        <input type="text" id="pagosProveedor" list="proveedores-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Material</label>
                        <input type="text" id="pagosMaterial" list="materiales-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Kg</label>
                        <input type="number" id="pagosKg" step="0.1" min="0" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Precio/Kg ($)</label>
                        <input type="number" id="pagosPrecioKg" step="0.01" min="0" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Total ($)</label>
                        <input type="number" id="pagosTotal" step="0.01" readonly style="background: var(--gris-claro);">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Pagado ($)</label>
                        <input type="number" id="pagosPagado" step="0.01" min="0" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha de Pago</label>
                        <input type="date" id="pagosFecha" required>
                    </div>
                </div>
                
                <div class="btn-group mt-2">
                    <button type="submit" class="btn btn-success">✅ Agregar Pago</button>
                    <button type="button" class="btn btn-secondary" id="btnPagosExportCSV">📥 Exportar CSV</button>
                </div>
            </form>
        </div>
        
        <div class="card">
            <div class="tabs">
                <button class="tab active" data-tab="pagosHoy">Hoy</button>
                <button class="tab" data-tab="pagosSemana">Esta Semana</button>
                <button class="tab" data-tab="pagosTodos">Todos los Pagos</button>
            </div>
            
            <!-- HOY -->
            <div id="pagosHoy" class="tab-content active">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Pagos hoy</div>
                        <div class="stat-value" id="pagosStatsHoyRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total pagado</div>
                        <div class="stat-value" id="pagosStatsHoyTotal">$0</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Proveedor</th>
                                <th>Material</th>
                                <th>Kg</th>
                                <th>$/Kg</th>
                                <th>Total</th>
                                <th>Pagado</th>
                                <th>Fecha</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="pagosTableHoy"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- SEMANA -->
            <div id="pagosSemana" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Pagos semana</div>
                        <div class="stat-value" id="pagosStatsSemanaRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total pagado</div>
                        <div class="stat-value" id="pagosStatsSemanaTotal">$0</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Proveedor</th>
                                <th>Material</th>
                                <th>Kg</th>
                                <th>$/Kg</th>
                                <th>Total</th>
                                <th>Pagado</th>
                                <th>Fecha</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="pagosTableSemana"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- TODOS -->
            <div id="pagosTodos" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Total pagos</div>
                        <div class="stat-value" id="pagosStatsTotalRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total pagado</div>
                        <div class="stat-value" id="pagosStatsTotalPagado">$0</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Proveedor</th>
                                <th>Material</th>
                                <th>Kg</th>
                                <th>$/Kg</th>
                                <th>Total</th>
                                <th>Pagado</th>
                                <th>Fecha</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="pagosTableTodos"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    // Modal de ministraciones
    if (!document.getElementById('ministracionesModal')) {
        const modal = document.createElement('div');
        modal.id = 'ministracionesModal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h2 class="modal-title">📊 Control de Ministraciones Semanales</h2>
                    <button class="modal-close" id="closeMinistracionesModal">×</button>
                </div>
                
                <div class="card" style="box-shadow: none;">
                    <h3 style="margin-bottom: 1rem;">Nueva Ministración</h3>
                    <form id="ministracionForm" style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 1rem; align-items: end;">
                        <div class="form-group">
                            <label class="form-label">Monto ($)</label>
                            <input type="number" id="ministracionMonto" step="0.01" min="0" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Fecha</label>
                            <input type="date" id="ministracionFecha" required>
                        </div>
                        <button type="submit" class="btn btn-success">+ Agregar</button>
                    </form>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Total ministrado</div>
                        <div class="stat-value" id="statTotalMinistrado">$0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total pagado</div>
                        <div class="stat-value" id="statTotalPagado">$0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Saldo disponible</div>
                        <div class="stat-value" id="statSaldoDisponible">$0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">% Ejecutado</div>
                        <div class="stat-value" id="statPorcentajeEjecutado">0%</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Fecha</th>
                                <th>Monto</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="ministracionesTable"></tbody>
                    </table>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    
    initPagosModule();
}

function initPagosModule() {
    // Configurar autocompletado
    configurarAutocompletado('pagosProveedor', PROVEEDORES_COMUNES);
    configurarAutocompletado('pagosMaterial', MATERIALES_COMUNES);
    
    // Fecha por defecto
    const hoy = obtenerFechaMexico();
    document.getElementById('pagosFecha').value = hoy;
    document.getElementById('ministracionFecha').value = hoy;
    
    // Cálculo automático del total
    document.getElementById('pagosKg').addEventListener('input', calcularTotalPago);
    document.getElementById('pagosPrecioKg').addEventListener('input', calcularTotalPago);
    
    // Event listeners
    document.getElementById('pagosForm').addEventListener('submit', agregarPago);
    document.getElementById('btnPagosExportCSV').addEventListener('click', exportarPagosCSV);
    document.getElementById('btnAbrirMinistraciones').addEventListener('click', abrirMinistraciones);
    document.getElementById('closeMinistracionesModal').addEventListener('click', cerrarMinistraciones);
    document.getElementById('ministracionForm').addEventListener('submit', agregarMinistracion);
    
    // Tabs
    document.querySelectorAll('#modulePagos .tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('#modulePagos .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#modulePagos .tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
    
    // Renderizar datos
    renderizarPagos();
}

function calcularTotalPago() {
    const kg = parseFloat(document.getElementById('pagosKg').value) || 0;
    const precioKg = parseFloat(document.getElementById('pagosPrecioKg').value) || 0;
    const total = kg * precioKg;
    document.getElementById('pagosTotal').value = total.toFixed(2);
}

async function agregarPago(e) {
    e.preventDefault();
    
    const registro = {
        ticket: document.getElementById('pagosTicket').value.trim(),
        proveedor: document.getElementById('pagosProveedor').value.trim(),
        material: document.getElementById('pagosMaterial').value.trim(),
        kg: parseFloat(document.getElementById('pagosKg').value),
        precioKg: parseFloat(document.getElementById('pagosPrecioKg').value),
        total: parseFloat(document.getElementById('pagosTotal').value),
        pagado: parseFloat(document.getElementById('pagosPagado').value),
        fechaPago: document.getElementById('pagosFecha').value,
        timestamp: new Date().toISOString()
    };
    
    // Validación
    if (!validarCamposRequeridos({
        Ticket: registro.ticket,
        Proveedor: registro.proveedor,
        Material: registro.material
    })) return;
    
    if (!validarNumero(registro.kg, 0) || !validarNumero(registro.precioKg, 0) || !validarNumero(registro.pagado, 0)) {
        showError('Los valores numéricos deben ser positivos');
        return;
    }
    
    try {
        const id = await guardarDato(COLLECTIONS.PAGOS, registro);
        registro.id = id;
        window.EVE.registrosPagos.push(registro);
        
        // Actualizar autocompletado
        actualizarSugerencias('pagosProveedor', registro.proveedor);
        actualizarSugerencias('pagosMaterial', registro.material);
        
        renderizarPagos();
        document.getElementById('pagosForm').reset();
        
        const hoy = obtenerFechaMexico();
        document.getElementById('pagosFecha').value = hoy;
        
        showSuccess('Pago registrado correctamente');
    } catch (error) {
        console.error('Error agregando pago:', error);
        showError('Error al registrar pago');
    }
}

function renderizarPagos() {
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    
    const pagosHoy = window.EVE.registrosPagos.filter(r => r.fechaPago === hoy);
    const pagosSemana = window.EVE.registrosPagos.filter(r => r.fechaPago >= inicioSemana);
    const todosPagos = window.EVE.registrosPagos;
    
    // Estadísticas
    const totalHoy = sumarCampo(pagosHoy, 'pagado');
    const totalSemana = sumarCampo(pagosSemana, 'pagado');
    const totalTodos = sumarCampo(todosPagos, 'pagado');
    
    document.getElementById('pagosStatsHoyRegistros').textContent = pagosHoy.length;
    document.getElementById('pagosStatsHoyTotal').textContent = formatearMoneda(totalHoy);
    document.getElementById('pagosStatsSemanaRegistros').textContent = pagosSemana.length;
    document.getElementById('pagosStatsSemanaTotal').textContent = formatearMoneda(totalSemana);
    document.getElementById('pagosStatsTotalRegistros').textContent = todosPagos.length;
    document.getElementById('pagosStatsTotalPagado').textContent = formatearMoneda(totalTodos);
    
    // Tablas
    renderTablaPagos('pagosTableHoy', pagosHoy);
    renderTablaPagos('pagosTableSemana', pagosSemana);
    renderTablaPagos('pagosTableTodos', todosPagos);
}

function renderTablaPagos(tbodyId, datos) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    
    if (datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 2rem; color: var(--gris-oscuro);">No hay registros</td></tr>';
        return;
    }
    
    datos.sort((a, b) => b.fechaPago.localeCompare(a.fechaPago));
    
    datos.forEach(pago => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${pago.ticket}</strong></td>
            <td>${pago.proveedor}</td>
            <td>${pago.material}</td>
            <td style="font-family: var(--font-mono);">${formatearKg(pago.kg)} kg</td>
            <td style="font-family: var(--font-mono);">${formatearMoneda(pago.precioKg)}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${formatearMoneda(pago.total)}</td>
            <td style="font-family: var(--font-mono); color: var(--verde); font-weight: 600;">${formatearMoneda(pago.pagado)}</td>
            <td>${formatearFechaReporte(pago.fechaPago)}</td>
            <td class="actions">
                <button class="btn-icon" onclick="editarPago('${pago.id}')" title="Editar">✏️</button>
                <button class="btn-icon" onclick="eliminarPago('${pago.id}')" title="Eliminar">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.eliminarPago = async function(id) {
    if (!confirm('¿Eliminar este pago?')) return;
    
    try {
        await eliminarDato(COLLECTIONS.PAGOS, id);
        window.EVE.registrosPagos = window.EVE.registrosPagos.filter(r => r.id !== id);
        renderizarPagos();
        showSuccess('Pago eliminado');
    } catch (error) {
        console.error('Error eliminando pago:', error);
        showError('Error al eliminar pago');
    }
};

window.editarPago = async function(id) {
    const pago = window.EVE.registrosPagos.find(r => r.id === id);
    if (!pago) return;
    
    document.getElementById('pagoTicket').value = pago.ticket;
    document.getElementById('pagoProveedor').value = pago.proveedor;
    document.getElementById('pagoMaterial').value = pago.material;
    document.getElementById('pagoKg').value = pago.kg;
    document.getElementById('pagoPrecioKg').value = pago.precioKg;
    document.getElementById('pagoTotal').value = pago.total;
    document.getElementById('pagoPagado').value = pago.pagado;
    document.getElementById('pagoFecha').value = pago.fechaPago;
    
    const btnAgregar = document.getElementById('btnAgregarPago');
    btnAgregar.textContent = '✅ Guardar Cambios';
    btnAgregar.onclick = async function(e) {
        e.preventDefault();
        
        const actualizado = {
            ticket: document.getElementById('pagoTicket').value.trim(),
            proveedor: document.getElementById('pagoProveedor').value.trim(),
            material: document.getElementById('pagoMaterial').value.trim(),
            kg: parseFloat(document.getElementById('pagoKg').value),
            precioKg: parseFloat(document.getElementById('pagoPrecioKg').value),
            total: parseFloat(document.getElementById('pagoTotal').value),
            pagado: parseFloat(document.getElementById('pagoPagado').value),
            fechaPago: document.getElementById('pagoFecha').value
        };
        
        if (!validarCamposRequeridos({
            Ticket: actualizado.ticket,
            Proveedor: actualizado.proveedor,
            Material: actualizado.material,
            Kg: actualizado.kg,
            'Precio/Kg': actualizado.precioKg
        })) return;
        
        try {
            await actualizarDato(COLLECTIONS.PAGOS, id, actualizado);
            const index = window.EVE.registrosPagos.findIndex(r => r.id === id);
            window.EVE.registrosPagos[index] = { ...actualizado, id };
            
            renderizarPagos();
            document.getElementById('pagoForm').reset();
            
            const hoy = obtenerFechaMexico();
            document.getElementById('pagoFecha').value = hoy;
            
            btnAgregar.textContent = '➕ Agregar Pago';
            btnAgregar.onclick = null;
            
            showSuccess('Pago actualizado correctamente');
        } catch (error) {
            console.error('Error actualizando:', error);
            showError('Error al actualizar pago');
        }
    };
    
    document.getElementById('pagoForm').scrollIntoView({ behavior: 'smooth' });
};

function exportarPagosCSV() {
    const datos = window.EVE.registrosPagos.map(r => ({
        Ticket: r.ticket,
        Proveedor: r.proveedor,
        Material: r.material,
        Kg: r.kg,
        'Precio/Kg': r.precioKg,
        Total: r.total,
        Pagado: r.pagado,
        Fecha: r.fechaPago
    }));
    
    const fecha = new Date().toISOString().split('T')[0];
    exportarCSV(datos, `pagos_${fecha}.csv`);
    showSuccess('Exportación CSV completada');
}

// MINISTRACIONES
function abrirMinistraciones() {
    abrirModal('ministracionesModal');
    renderizarMinistraciones();
}

function cerrarMinistraciones() {
    cerrarModal('ministracionesModal');
}

async function agregarMinistracion(e) {
    e.preventDefault();
    
    const ministracion = {
        monto: parseFloat(document.getElementById('ministracionMonto').value),
        fecha: document.getElementById('ministracionFecha').value,
        timestamp: new Date().toISOString()
    };
    
    if (!validarNumero(ministracion.monto, 0)) {
        showError('El monto debe ser un número positivo');
        return;
    }
    
    try {
        const id = await guardarDato(COLLECTIONS.MINISTRACIONES, ministracion);
        ministracion.id = id;
        window.EVE.registrosMinistraciones.push(ministracion);
        
        renderizarMinistraciones();
        document.getElementById('ministracionForm').reset();
        document.getElementById('ministracionFecha').value = obtenerFechaMexico();
        
        showSuccess('Ministración registrada');
    } catch (error) {
        console.error('Error agregando ministración:', error);
        showError('Error al registrar ministración');
    }
}

function renderizarMinistraciones() {
    const inicioSemana = obtenerInicioSemana();
    
    // Ministraciones de la semana
    const ministracionesSemana = window.EVE.registrosMinistraciones.filter(m => m.fecha >= inicioSemana);
    const pagosSemana = window.EVE.registrosPagos.filter(p => p.fechaPago >= inicioSemana);
    
    const totalMinistrado = sumarCampo(ministracionesSemana, 'monto');
    const totalPagado = sumarCampo(pagosSemana, 'pagado');
    const saldo = totalMinistrado - totalPagado;
    const porcentaje = totalMinistrado > 0 ? ((totalPagado / totalMinistrado) * 100).toFixed(1) : 0;
    
    document.getElementById('statTotalMinistrado').textContent = formatearMoneda(totalMinistrado);
    document.getElementById('statTotalPagado').textContent = formatearMoneda(totalPagado);
    document.getElementById('statSaldoDisponible').textContent = formatearMoneda(saldo);
    document.getElementById('statPorcentajeEjecutado').textContent = `${porcentaje}%`;
    
    // Tabla
    const tbody = document.getElementById('ministracionesTable');
    tbody.innerHTML = '';
    
    if (ministracionesSemana.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 2rem;">No hay ministraciones esta semana</td></tr>';
        return;
    }
    
    ministracionesSemana.sort((a, b) => b.fecha.localeCompare(a.fecha));
    
    ministracionesSemana.forEach(min => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatearFechaReporte(min.fecha)}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${formatearMoneda(min.monto)}</td>
            <td class="actions">
                <button class="btn-icon" onclick="eliminarMinistracion('${min.id}')" title="Eliminar">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.eliminarMinistracion = async function(id) {
    if (!confirm('¿Eliminar esta ministración?')) return;
    
    try {
        await eliminarDato(COLLECTIONS.MINISTRACIONES, id);
        window.EVE.registrosMinistraciones = window.EVE.registrosMinistraciones.filter(m => m.id !== id);
        renderizarMinistraciones();
        showSuccess('Ministración eliminada');
    } catch (error) {
        console.error('Error eliminando ministración:', error);
        showError('Error al eliminar ministración');
    }
};

console.log('✅ EVE Control v2.0 - Pagos cargado');
