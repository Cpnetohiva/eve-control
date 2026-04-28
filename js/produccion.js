/* ==========================================
   EVE CONTROL v2.0 - PRODUCCIÓN
   Gestión de producción diaria
   ========================================== */

function loadProduccionModule() {
    const container = document.getElementById('moduleProduccion');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🏭 Nuevo Registro de Producción</h2>
            </div>
            
            <form id="produccionForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Ticket</label>
                        <input type="text" id="produccionTicket" required placeholder="Número de ticket">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Cliente</label>
                        <input type="text" id="produccionCliente" list="clientes-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Material</label>
                        <input type="text" id="produccionMaterial" list="materiales-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Kg</label>
                        <input type="number" id="produccionKg" step="0.1" min="0" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha Entrada</label>
                        <input type="date" id="produccionFechaEntrada" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha Salida</label>
                        <input type="date" id="produccionFechaSalida" required>
                    </div>
                </div>
                
                <div class="btn-group mt-2">
                    <button type="submit" class="btn btn-success">✅ Agregar Registro</button>
                    <button type="button" class="btn btn-secondary" id="btnProduccionExportCSV">📥 Exportar CSV</button>
                </div>
            </form>
        </div>
        
        <div class="card">
            <div class="tabs">
                <button class="tab active" data-tab="produccionHoy">Hoy</button>
                <button class="tab" data-tab="produccionSemana">Esta Semana</button>
                <button class="tab" data-tab="produccionTodos">Todos los Registros</button>
            </div>
            
            <!-- HOY -->
            <div id="produccionHoy" class="tab-content active">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Registros hoy</div>
                        <div class="stat-value" id="produccionStatsHoyRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total kg</div>
                        <div class="stat-value" id="produccionStatsHoyKg">0</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Cliente</th>
                                <th>Material</th>
                                <th>Kg</th>
                                <th>F. Entrada</th>
                                <th>F. Salida</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="produccionTableHoy"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- SEMANA -->
            <div id="produccionSemana" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Registros semana</div>
                        <div class="stat-value" id="produccionStatsSemanaRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total kg</div>
                        <div class="stat-value" id="produccionStatsSemanaKg">0</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Cliente</th>
                                <th>Material</th>
                                <th>Kg</th>
                                <th>F. Entrada</th>
                                <th>F. Salida</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="produccionTableSemana"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- TODOS -->
            <div id="produccionTodos" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Total registros</div>
                        <div class="stat-value" id="produccionStatsTotalRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total kg</div>
                        <div class="stat-value" id="produccionStatsTotalKg">0</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Cliente</th>
                                <th>Material</th>
                                <th>Kg</th>
                                <th>F. Entrada</th>
                                <th>F. Salida</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="produccionTableTodos"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    initProduccionModule();
}

function initProduccionModule() {
    // Configurar autocompletado
    configurarAutocompletado('produccionCliente', CLIENTES_COMUNES);
    configurarAutocompletado('produccionMaterial', MATERIALES_COMUNES);
    
    // Fechas por defecto
    const hoy = obtenerFechaMexico();
    document.getElementById('produccionFechaEntrada').value = hoy;
    document.getElementById('produccionFechaSalida').value = hoy;
    
    // Event listeners
    document.getElementById('produccionForm').addEventListener('submit', agregarProduccion);
    document.getElementById('btnProduccionExportCSV').addEventListener('click', exportarProduccionCSV);
    
    // Tabs
    document.querySelectorAll('#moduleProduccion .tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('#moduleProduccion .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#moduleProduccion .tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
    
    // Renderizar datos
    renderizarProduccion();
}

async function agregarProduccion(e) {
    e.preventDefault();
    
    const registro = {
        ticket: document.getElementById('produccionTicket').value.trim(),
        cliente: document.getElementById('produccionCliente').value.trim(),
        material: document.getElementById('produccionMaterial').value.trim(),
        kg: parseFloat(document.getElementById('produccionKg').value),
        fechaEntrada: document.getElementById('produccionFechaEntrada').value,
        fechaSalida: document.getElementById('produccionFechaSalida').value,
        timestamp: new Date().toISOString()
    };
    
    // Validación
    if (!validarCamposRequeridos({
        Ticket: registro.ticket,
        Cliente: registro.cliente,
        Material: registro.material,
        Kg: registro.kg
    })) return;
    
    if (!validarNumero(registro.kg, 0)) {
        showError('Los kg deben ser un número positivo');
        return;
    }
    
    try {
        const id = await guardarDato(COLLECTIONS.PRODUCCION, registro);
        registro.id = id;
        window.EVE.registrosProduccion.push(registro);
        
        // Actualizar autocompletado
        actualizarSugerencias('produccionCliente', registro.cliente);
        actualizarSugerencias('produccionMaterial', registro.material);
        
        renderizarProduccion();
        document.getElementById('produccionForm').reset();
        
        const hoy = obtenerFechaMexico();
        document.getElementById('produccionFechaEntrada').value = hoy;
        document.getElementById('produccionFechaSalida').value = hoy;
        
        showSuccess('Registro de producción agregado correctamente');
    } catch (error) {
        console.error('Error agregando producción:', error);
        showError('Error al agregar registro');
    }
}

function renderizarProduccion() {
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    
    const registrosHoy = window.EVE.registrosProduccion.filter(r => r.fechaSalida === hoy);
    const registrosSemana = window.EVE.registrosProduccion.filter(r => r.fechaSalida >= inicioSemana);
    const todosProd = window.EVE.registrosProduccion;
    
    // Estadísticas
    const totalKgHoy = sumarCampo(registrosHoy, 'kg');
    const totalKgSemana = sumarCampo(registrosSemana, 'kg');
    const totalKgTodos = sumarCampo(todosProd, 'kg');
    
    document.getElementById('produccionStatsHoyRegistros').textContent = registrosHoy.length;
    document.getElementById('produccionStatsHoyKg').textContent = formatearKg(totalKgHoy);
    document.getElementById('produccionStatsSemanaRegistros').textContent = registrosSemana.length;
    document.getElementById('produccionStatsSemanaKg').textContent = formatearKg(totalKgSemana);
    document.getElementById('produccionStatsTotalRegistros').textContent = todosProd.length;
    document.getElementById('produccionStatsTotalKg').textContent = formatearKg(totalKgTodos);
    
    // Tablas
    renderTablaProduccion('produccionTableHoy', registrosHoy);
    renderTablaProduccion('produccionTableSemana', registrosSemana);
    renderTablaProduccion('produccionTableTodos', todosProd);
}

function renderTablaProduccion(tbodyId, datos) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    
    if (datos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 2rem; color: var(--gris-oscuro);">No hay registros</td></tr>';
        return;
    }
    
    // Ordenar por fecha salida descendente
    datos.sort((a, b) => b.fechaSalida.localeCompare(a.fechaSalida));
    
    datos.forEach(registro => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${registro.ticket}</strong></td>
            <td>${registro.cliente}</td>
            <td>${registro.material}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${formatearKg(registro.kg)} kg</td>
            <td>${formatearFechaReporte(registro.fechaEntrada)}</td>
            <td>${formatearFechaReporte(registro.fechaSalida)}</td>
            <td class="actions">
                <button class="btn-icon" onclick="editarProduccion('${registro.id}')" title="Editar">✏️</button>
                <button class="btn-icon" onclick="eliminarProduccion('${registro.id}')" title="Eliminar">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.eliminarProduccion = async function(id) {
    if (!confirm('¿Eliminar este registro de producción?')) return;
    
    try {
        await eliminarDato(COLLECTIONS.PRODUCCION, id);
        window.EVE.registrosProduccion = window.EVE.registrosProduccion.filter(r => r.id !== id);
        renderizarProduccion();
        showSuccess('Registro eliminado');
    } catch (error) {
        console.error('Error eliminando producción:', error);
        showError('Error al eliminar registro');
    }
};

window.editarProduccion = async function(id) {
    const registro = window.EVE.registrosProduccion.find(r => r.id === id);
    if (!registro) return;
    
    document.getElementById('produccionTicket').value = registro.ticket;
    document.getElementById('produccionCliente').value = registro.cliente;
    document.getElementById('produccionMaterial').value = registro.material;
    document.getElementById('produccionKg').value = registro.kg;
    document.getElementById('produccionFechaEntrada').value = registro.fechaEntrada;
    document.getElementById('produccionFechaSalida').value = registro.fechaSalida;
    
    const btnAgregar = document.getElementById('btnAgregarProduccion');
    btnAgregar.textContent = '✅ Guardar Cambios';
    btnAgregar.onclick = async function(e) {
        e.preventDefault();
        
        const actualizado = {
            ticket: document.getElementById('produccionTicket').value.trim(),
            cliente: document.getElementById('produccionCliente').value.trim(),
            material: document.getElementById('produccionMaterial').value.trim(),
            kg: parseFloat(document.getElementById('produccionKg').value),
            fechaEntrada: document.getElementById('produccionFechaEntrada').value,
            fechaSalida: document.getElementById('produccionFechaSalida').value
        };
        
        if (!validarCamposRequeridos({
            Ticket: actualizado.ticket,
            Cliente: actualizado.cliente,
            Material: actualizado.material,
            Kg: actualizado.kg
        })) return;
        
        try {
            await actualizarDato(COLLECTIONS.PRODUCCION, id, actualizado);
            const index = window.EVE.registrosProduccion.findIndex(r => r.id === id);
            window.EVE.registrosProduccion[index] = { ...actualizado, id };
            
            renderizarProduccion();
            document.getElementById('produccionForm').reset();
            
            const hoy = obtenerFechaMexico();
            document.getElementById('produccionFechaEntrada').value = hoy;
            document.getElementById('produccionFechaSalida').value = hoy;
            
            btnAgregar.textContent = '➕ Agregar Registro';
            btnAgregar.onclick = null;
            
            showSuccess('Registro actualizado correctamente');
        } catch (error) {
            console.error('Error actualizando:', error);
            showError('Error al actualizar registro');
        }
    };
    
    document.getElementById('produccionForm').scrollIntoView({ behavior: 'smooth' });
};

function exportarProduccionCSV() {
    const datos = window.EVE.registrosProduccion.map(r => ({
        Ticket: r.ticket,
        Cliente: r.cliente,
        Material: r.material,
        Kg: r.kg,
        'Fecha Entrada': r.fechaEntrada,
        'Fecha Salida': r.fechaSalida
    }));
    
    const fecha = new Date().toISOString().split('T')[0];
    exportarCSV(datos, `produccion_${fecha}.csv`);
    showSuccess('Exportación CSV completada');
}

console.log('✅ EVE Control v2.0 - Producción cargado');
