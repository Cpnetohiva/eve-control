/* ==========================================
   EVE CONTROL v2.0 - DESTARAJE Y VENTAS
   Gestión de entrada/salida de material
   ========================================== */

function loadDestarajeModule() {
    const container = document.getElementById('moduleDestaraje');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">📦 Nuevo Registro de Destaraje</h2>
            </div>
            
            <form id="destarajeForm">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Ticket</label>
                        <input type="text" id="destarajeTicket" required placeholder="Número o 'V'">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Proveedor</label>
                        <input type="text" id="destarajeProveedor" list="proveedores-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Material</label>
                        <input type="text" id="destarajeMaterial" list="materiales-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Kg</label>
                        <input type="number" id="destarajeKg" step="0.1" min="0" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha Entrada</label>
                        <input type="date" id="destarajeFechaEntrada" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha Salida</label>
                        <input type="date" id="destarajeFechaSalida" required>
                    </div>
                </div>
                
                <div class="btn-group mt-2">
                    <button type="submit" class="btn btn-success">✅ Agregar Registro</button>
                    <button type="button" class="btn btn-secondary" id="btnDestarajeExportCSV">📥 Exportar CSV</button>
                </div>
            </form>
        </div>
        
        <div class="card">
            <div class="tabs">
                <button class="tab active" data-tab="destarajeHoy">Hoy</button>
                <button class="tab" data-tab="destarajeSemana">Esta Semana</button>
                <button class="tab" data-tab="destarajeTodos">Todos los Registros</button>
            </div>
            
            <!-- HOY -->
            <div id="destarajeHoy" class="tab-content active">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Registros hoy</div>
                        <div class="stat-value" id="destarajeStatsHoyRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total kg</div>
                        <div class="stat-value" id="destarajeStatsHoyKg">0</div>
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
                                <th>F. Entrada</th>
                                <th>F. Salida</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="destarajeTableHoy"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- SEMANA -->
            <div id="destarajeSemana" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Registros semana</div>
                        <div class="stat-value" id="destarajeStatsSemanaRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total kg</div>
                        <div class="stat-value" id="destarajeStatsSemanaKg">0</div>
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
                                <th>F. Entrada</th>
                                <th>F. Salida</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="destarajeTableSemana"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- TODOS -->
            <div id="destarajeTodos" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Total registros</div>
                        <div class="stat-value" id="destarajeStatsTotalRegistros">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Total kg</div>
                        <div class="stat-value" id="destarajeStatsTotalKg">0</div>
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
                                <th>F. Entrada</th>
                                <th>F. Salida</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="destarajeTableTodos"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
    
    initDestarajeModule();
}

function initDestarajeModule() {
    // Configurar autocompletado
    configurarAutocompletado('destarajeProveedor', PROVEEDORES_COMUNES);
    configurarAutocompletado('destarajeMaterial', MATERIALES_COMUNES);
    
    // Fechas por defecto
    const hoy = obtenerFechaMexico();
    document.getElementById('destarajeFechaEntrada').value = hoy;
    document.getElementById('destarajeFechaSalida').value = hoy;
    
    // Event listeners
    document.getElementById('destarajeForm').addEventListener('submit', agregarDestaraje);
    document.getElementById('btnDestarajeExportCSV').addEventListener('click', exportarDestarajeCSV);
    
    // Tabs
    document.querySelectorAll('#moduleDestaraje .tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('#moduleDestaraje .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#moduleDestaraje .tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
    
    // Renderizar datos
    renderizarDestaraje();
}

async function agregarDestaraje(e) {
    e.preventDefault();
    
    const registro = {
        ticket: document.getElementById('destarajeTicket').value.trim(),
        proveedor: document.getElementById('destarajeProveedor').value.trim(),
        material: document.getElementById('destarajeMaterial').value.trim(),
        kg: parseFloat(document.getElementById('destarajeKg').value),
        fechaEntrada: document.getElementById('destarajeFechaEntrada').value,
        fechaSalida: document.getElementById('destarajeFechaSalida').value,
        timestamp: new Date().toISOString()
    };
    
    // Validación
    if (!validarCamposRequeridos({
        Ticket: registro.ticket,
        Proveedor: registro.proveedor,
        Material: registro.material,
        Kg: registro.kg
    })) return;
    
    if (!validarNumero(registro.kg, 0)) {
        showError('Los kg deben ser un número positivo');
        return;
    }
    
    try {
        const id = await guardarDato(COLLECTIONS.DESTARAJE, registro);
        registro.id = id;
        window.EVE.registrosDestaraje.push(registro);
        
        // Actualizar autocompletado
        actualizarSugerencias('destarajeProveedor', registro.proveedor);
        actualizarSugerencias('destarajeMaterial', registro.material);
        
        renderizarDestaraje();
        document.getElementById('destarajeForm').reset();
        
        const hoy = obtenerFechaMexico();
        document.getElementById('destarajeFechaEntrada').value = hoy;
        document.getElementById('destarajeFechaSalida').value = hoy;
        
        showSuccess('Registro de destaraje agregado correctamente');
    } catch (error) {
        console.error('Error agregando destaraje:', error);
        showError('Error al agregar registro');
    }
}

function renderizarDestaraje() {
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    
    const registrosHoy = window.EVE.registrosDestaraje.filter(r => r.fechaSalida === hoy);
    const registrosSemana = window.EVE.registrosDestaraje.filter(r => r.fechaSalida >= inicioSemana);
    
    // Filtrar solo tickets numéricos o "V" (destaraje real, no ventas)
    const esDestaraje = (ticket) => /^\d+$/.test(ticket.trim()) || ticket.trim().toUpperCase() === 'V';
    
    const hoyDest = registrosHoy.filter(r => esDestaraje(r.ticket));
    const semanaDest = registrosSemana.filter(r => esDestaraje(r.ticket));
    const todosDest = window.EVE.registrosDestaraje.filter(r => esDestaraje(r.ticket));
    
    // Estadísticas
    const totalKgHoy = sumarCampo(hoyDest, 'kg');
    const totalKgSemana = sumarCampo(semanaDest, 'kg');
    const totalKgTodos = sumarCampo(todosDest, 'kg');
    
    document.getElementById('destarajeStatsHoyRegistros').textContent = hoyDest.length;
    document.getElementById('destarajeStatsHoyKg').textContent = formatearKg(totalKgHoy);
    document.getElementById('destarajeStatsSemanaRegistros').textContent = semanaDest.length;
    document.getElementById('destarajeStatsSemanaKg').textContent = formatearKg(totalKgSemana);
    document.getElementById('destarajeStatsTotalRegistros').textContent = todosDest.length;
    document.getElementById('destarajeStatsTotalKg').textContent = formatearKg(totalKgTodos);
    
    // Tablas
    renderTablaDestaraje('destarajeTableHoy', hoyDest);
    renderTablaDestaraje('destarajeTableSemana', semanaDest);
    renderTablaDestaraje('destarajeTableTodos', todosDest);
}

function renderTablaDestaraje(tbodyId, datos) {
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
            <td>${registro.proveedor}</td>
            <td>${registro.material}</td>
            <td style="font-family: var(--font-mono); font-weight: 600;">${formatearKg(registro.kg)} kg</td>
            <td>${formatearFechaReporte(registro.fechaEntrada)}</td>
            <td>${formatearFechaReporte(registro.fechaSalida)}</td>
            <td class="actions">
                <button class="btn-icon" onclick="editarDestaraje('${registro.id}')" title="Editar">✏️</button>
                <button class="btn-icon" onclick="eliminarDestaraje('${registro.id}')" title="Eliminar">🗑️</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

window.eliminarDestaraje = async function(id) {
    if (!confirm('¿Eliminar este registro de destaraje?')) return;
    
    try {
        await eliminarDato(COLLECTIONS.DESTARAJE, id);
        window.EVE.registrosDestaraje = window.EVE.registrosDestaraje.filter(r => r.id !== id);
        renderizarDestaraje();
        showSuccess('Registro eliminado');
    } catch (error) {
        console.error('Error eliminando destaraje:', error);
        showError('Error al eliminar registro');
    }
};

window.editarDestaraje = async function(id) {
    const registro = window.EVE.registrosDestaraje.find(r => r.id === id);
    if (!registro) return;
    
    // Llenar formulario
    document.getElementById('destarajeTicket').value = registro.ticket;
    document.getElementById('destarajeProveedor').value = registro.proveedor;
    document.getElementById('destarajeMaterial').value = registro.material;
    document.getElementById('destarajeKg').value = registro.kg;
    document.getElementById('destarajeFechaEntrada').value = registro.fechaEntrada;
    document.getElementById('destarajeFechaSalida').value = registro.fechaSalida;
    
    // Cambiar botón a modo edición
    const btnAgregar = document.getElementById('btnAgregarDestaraje');
    btnAgregar.textContent = '✅ Guardar Cambios';
    btnAgregar.onclick = async function(e) {
        e.preventDefault();
        
        // Actualizar registro
        const actualizado = {
            ticket: document.getElementById('destarajeTicket').value.trim(),
            proveedor: document.getElementById('destarajeProveedor').value.trim(),
            material: document.getElementById('destarajeMaterial').value.trim(),
            kg: parseFloat(document.getElementById('destarajeKg').value),
            fechaEntrada: document.getElementById('destarajeFechaEntrada').value,
            fechaSalida: document.getElementById('destarajeFechaSalida').value
        };
        
        if (!validarCamposRequeridos({
            Ticket: actualizado.ticket,
            Proveedor: actualizado.proveedor,
            Material: actualizado.material,
            Kg: actualizado.kg
        })) return;
        
        try {
            await actualizarDato(COLLECTIONS.DESTARAJE, id, actualizado);
            const index = window.EVE.registrosDestaraje.findIndex(r => r.id === id);
            window.EVE.registrosDestaraje[index] = { ...actualizado, id };
            
            renderizarDestaraje();
            document.getElementById('destarajeForm').reset();
            
            const hoy = obtenerFechaMexico();
            document.getElementById('destarajeFechaEntrada').value = hoy;
            document.getElementById('destarajeFechaSalida').value = hoy;
            
            btnAgregar.textContent = '➕ Agregar Registro';
            btnAgregar.onclick = null;
            
            showSuccess('Registro actualizado correctamente');
        } catch (error) {
            console.error('Error actualizando:', error);
            showError('Error al actualizar registro');
        }
    };
    
    // Scroll al formulario
    document.getElementById('destarajeForm').scrollIntoView({ behavior: 'smooth' });
};

function exportarDestarajeCSV() {
    const datos = window.EVE.registrosDestaraje.map(r => ({
        Ticket: r.ticket,
        Proveedor: r.proveedor,
        Material: r.material,
        Kg: r.kg,
        'Fecha Entrada': r.fechaEntrada,
        'Fecha Salida': r.fechaSalida
    }));
    
    const fecha = new Date().toISOString().split('T')[0];
    exportarCSV(datos, `destaraje_${fecha}.csv`);
    showSuccess('Exportación CSV completada');
}

console.log('✅ EVE Control v2.0 - Destaraje cargado');
