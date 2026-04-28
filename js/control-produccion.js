/* ==========================================
   EVE CONTROL v2.0 - CONTROL DE PRODUCCIÓN EXTENDIDO
   Gestión de procesos con inputs/outputs y trazabilidad
   ========================================== */

// Definición de procesos disponibles
const PROCESOS = {
    SELECCION: {
        nombre: 'Selección',
        icono: '🔍',
        descripcion: 'Separación de material por tipo/color',
        outputs: ['Material separado', 'Merma']
    },
    EMPACADO: {
        nombre: 'Empacado',
        icono: '📦',
        descripcion: 'Empacado en pacas',
        outputs: ['Pacas']
    },
    MOLIENDA: {
        nombre: 'Molienda',
        icono: '⚙️',
        descripcion: 'Triturado de material',
        outputs: ['Material molido', 'Merma']
    },
    LAVADO: {
        nombre: 'Lavado',
        icono: '💧',
        descripcion: 'Limpieza de material',
        outputs: ['Material limpio', 'Merma']
    },
    PELETIZADO: {
        nombre: 'Peletizado',
        icono: '🔵',
        descripcion: 'Conversión a pellets',
        outputs: ['Pellets', 'Merma']
    }
};

const TURNOS = ['Matutino', 'Vespertino', 'Nocturno'];
let inputCounter = 0;

function loadControlProduccionModule() {
    const container = document.getElementById('moduleControlProduccion');
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">🏭 Nuevo Proceso de Producción</h2>
            </div>
            
            <form id="controlProduccionForm">
                <!-- TIPO DE PROCESO -->
                <div class="form-group">
                    <label class="form-label">Tipo de Proceso</label>
                    <select id="tipoProceso" class="form-control" required>
                        <option value="">Seleccionar proceso...</option>
                        ${Object.entries(PROCESOS).map(([key, p]) => 
                            `<option value="${key}">${p.icono} ${p.nombre}</option>`
                        ).join('')}
                    </select>
                </div>
                
                <div id="descripcionProceso" style="display: none; margin-bottom: 1rem; padding: 1rem; background: #e7f3ff; border-radius: 8px;">
                    <p id="textoDescripcion" style="margin: 0; color: var(--azul-marino);"></p>
                </div>
                
                <!-- DATOS BÁSICOS -->
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label">Ticket Producción</label>
                        <input type="text" id="ticketProduccion" class="form-control" required placeholder="P-001">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Operador</label>
                        <input type="text" id="operador" class="form-control" list="operadores-list" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Turno</label>
                        <select id="turno" class="form-control" required>
                            ${TURNOS.map(t => `<option value="${t}">${t}</option>`).join('')}
                        </select>
                    </div>
                </div>
                
                <!-- INPUTS (MATERIALES CONSUMIDOS) -->
                <div id="seccionInputs" style="display: none;">
                    <h3 style="margin: 1.5rem 0 1rem 0;">📥 Materiales de Entrada (Inputs)</h3>
                    <div id="inputsContainer"></div>
                    <button type="button" class="btn btn-secondary" id="btnAgregarInput">+ Agregar Material</button>
                </div>
                
                <!-- OUTPUTS (PRODUCTOS GENERADOS) -->
                <div id="seccionOutputs" style="display: none;">
                    <h3 style="margin: 1.5rem 0 1rem 0;">📤 Productos de Salida (Outputs)</h3>
                    <div id="outputsContainer"></div>
                </div>
                
                <!-- FECHAS Y HORAS -->
                <div class="form-grid" style="margin-top: 1.5rem;">
                    <div class="form-group">
                        <label class="form-label">Fecha/Hora Inicio</label>
                        <input type="datetime-local" id="fechaInicio" class="form-control" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha/Hora Fin</label>
                        <input type="datetime-local" id="fechaFin" class="form-control" required>
                    </div>
                </div>
                
                <!-- RESUMEN AUTOMÁTICO -->
                <div id="resumenProceso" style="display: none; margin-top: 1rem; padding: 1rem; background: var(--gris-claro); border-radius: 8px;">
                    <h4>📊 Resumen Automático</h4>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 0.5rem;">
                        <div>
                            <strong>Total Input:</strong>
                            <span id="totalInput">0 kg</span>
                        </div>
                        <div>
                            <strong>Total Output:</strong>
                            <span id="totalOutput">0 kg</span>
                        </div>
                        <div>
                            <strong>Merma:</strong>
                            <span id="totalMerma">0 kg (0%)</span>
                        </div>
                        <div>
                            <strong>Eficiencia:</strong>
                            <span id="eficiencia">0%</span>
                        </div>
                        <div>
                            <strong>Horas Trabajo:</strong>
                            <span id="horasTrabajo">0</span>
                        </div>
                    </div>
                </div>
                
                <!-- OBSERVACIONES -->
                <div class="form-group" style="margin-top: 1rem;">
                    <label class="form-label">Observaciones</label>
                    <textarea id="observaciones" rows="3" class="form-control" placeholder="Calidad del material, problemas encontrados, etc."></textarea>
                </div>
                
                <div class="btn-group mt-2">
                    <button type="submit" class="btn btn-success">✅ Registrar Proceso</button>
                    <button type="button" class="btn btn-secondary" id="btnLimpiarForm">🔄 Limpiar</button>
                </div>
            </form>
        </div>
        
        <!-- TABS DE VISUALIZACIÓN -->
        <div class="card">
            <div class="tabs">
                <button class="tab active" data-tab="procesosHoy">Hoy</button>
                <button class="tab" data-tab="procesosSemana">Esta Semana</button>
                <button class="tab" data-tab="procesosTodos">Todos los Procesos</button>
            </div>
            
            <!-- HOY -->
            <div id="procesosHoy" class="tab-content active">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Procesos hoy</div>
                        <div class="stat-value" id="statsHoyProcesos">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Material procesado</div>
                        <div class="stat-value" id="statsHoyKg">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Eficiencia promedio</div>
                        <div class="stat-value" id="statsHoyEficiencia">0%</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Proceso</th>
                                <th>Operador</th>
                                <th>Input</th>
                                <th>Output</th>
                                <th>Merma</th>
                                <th>Eficiencia</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="tablaProcesosHoy"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- SEMANA -->
            <div id="procesosSemana" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Procesos semana</div>
                        <div class="stat-value" id="statsSemanaProcesos">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Material procesado</div>
                        <div class="stat-value" id="statsSemanaKg">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Eficiencia promedio</div>
                        <div class="stat-value" id="statsSemanaEficiencia">0%</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Proceso</th>
                                <th>Operador</th>
                                <th>Input</th>
                                <th>Output</th>
                                <th>Merma</th>
                                <th>Eficiencia</th>
                                <th>Fecha</th>
                            </tr>
                        </thead>
                        <tbody id="tablaProcesosSemana"></tbody>
                    </table>
                </div>
            </div>
            
            <!-- TODOS -->
            <div id="procesosTodos" class="tab-content">
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-label">Total procesos</div>
                        <div class="stat-value" id="statsTotalProcesos">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Material procesado</div>
                        <div class="stat-value" id="statsTotalKg">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Eficiencia promedio</div>
                        <div class="stat-value" id="statsTotalEficiencia">0%</div>
                    </div>
                </div>
                
                <div class="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Ticket</th>
                                <th>Proceso</th>
                                <th>Operador</th>
                                <th>Turno</th>
                                <th>Input</th>
                                <th>Output</th>
                                <th>Merma</th>
                                <th>Eficiencia</th>
                                <th>Fecha</th>
                                <th>Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="tablaProcesosTodos"></tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <!-- Datalists -->
        <datalist id="operadores-list"></datalist>
        <datalist id="materiales-input-list"></datalist>
    `;
    
    initControlProduccionModule();
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
function initControlProduccionModule() {
    // Event listeners básicos
    document.getElementById('tipoProceso').addEventListener('change', cambiarTipoProceso);
    document.getElementById('controlProduccionForm').addEventListener('submit', registrarProceso);
    document.getElementById('btnLimpiarForm').addEventListener('click', limpiarFormulario);
    
    const btnAgregarInput = document.getElementById('btnAgregarInput');
    if (btnAgregarInput) {
        btnAgregarInput.addEventListener('click', agregarInputField);
    }
    
    // Tabs
    document.querySelectorAll('#moduleControlProduccion .tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('#moduleControlProduccion .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#moduleControlProduccion .tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
    
    // Fechas por defecto
    const ahora = new Date();
    const ahoraStr = ahora.toISOString().slice(0, 16);
    document.getElementById('fechaInicio').value = ahoraStr;
    document.getElementById('fechaFin').value = ahoraStr;
    
    // Auto-cálculo en tiempo real
    document.getElementById('fechaInicio').addEventListener('change', calcularResumen);
    document.getElementById('fechaFin').addEventListener('change', calcularResumen);
    
    renderizarProcesos();
}

// ==========================================
// CAMBIO DE TIPO DE PROCESO
// ==========================================
function cambiarTipoProceso() {
    const tipoProceso = document.getElementById('tipoProceso').value;
    
    if (!tipoProceso) {
        document.getElementById('seccionInputs').style.display = 'none';
        document.getElementById('seccionOutputs').style.display = 'none';
        document.getElementById('descripcionProceso').style.display = 'none';
        return;
    }
    
    const proceso = PROCESOS[tipoProceso];
    
    // Mostrar descripción
    document.getElementById('descripcionProceso').style.display = 'block';
    document.getElementById('textoDescripcion').textContent = `${proceso.icono} ${proceso.descripcion}`;
    
    // Mostrar secciones
    document.getElementById('seccionInputs').style.display = 'block';
    document.getElementById('seccionOutputs').style.display = 'block';
    
    // Limpiar containers
    document.getElementById('inputsContainer').innerHTML = '';
    document.getElementById('outputsContainer').innerHTML = '';
    inputCounter = 0;
    
    // Agregar primer input
    agregarInputField();
    
    // Generar outputs según el proceso
    if (proceso.outputs.includes('Merma')) {
        document.getElementById('outputsContainer').innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">${proceso.outputs[0]}</label>
                    <input type="number" id="outputPrincipal" class="output-field form-control" step="0.1" min="0" required placeholder="kg">
                </div>
                <div class="form-group">
                    <label class="form-label">Merma</label>
                    <input type="number" id="outputMerma" class="output-field form-control" step="0.1" min="0" required placeholder="kg">
                </div>
            </div>
        `;
    } else {
        document.getElementById('outputsContainer').innerHTML = `
            <div class="form-group">
                <label class="form-label">${proceso.outputs[0]}</label>
                <input type="number" id="outputPrincipal" class="output-field form-control" step="0.1" min="0" required placeholder="unidades">
            </div>
        `;
    }
    
    // Event listeners para recalcular
    document.querySelectorAll('.output-field').forEach(field => {
        field.addEventListener('input', calcularResumen);
    });
    
    document.getElementById('resumenProceso').style.display = 'block';
}

// ==========================================
// AGREGAR INPUT DINÁMICO
// ==========================================
function agregarInputField() {
    inputCounter++;
    const container = document.getElementById('inputsContainer');
    
    const div = document.createElement('div');
    div.className = 'input-row';
    div.id = `input-${inputCounter}`;
    div.innerHTML = `
        <div class="form-grid" style="align-items: end;">
            <div class="form-group">
                <label class="form-label">Material</label>
                <input type="text" class="input-material form-control" list="materiales-input-list" required placeholder="PET MOLIDO, etc.">
            </div>
            <div class="form-group">
                <label class="form-label">Cantidad (kg)</label>
                <input type="number" class="input-cantidad form-control" step="0.1" min="0" required placeholder="0">
            </div>
            <div class="form-group">
                <label class="form-label">Ticket Origen</label>
                <input type="text" class="input-ticket form-control" placeholder="Opcional">
            </div>
            <div class="form-group">
                <button type="button" class="btn btn-danger" onclick="eliminarInput('input-${inputCounter}')">🗑️</button>
            </div>
        </div>
    `;
    
    container.appendChild(div);
    
    // Event listener para recalcular
    div.querySelector('.input-cantidad').addEventListener('input', calcularResumen);
}

window.eliminarInput = function(id) {
    document.getElementById(id).remove();
    calcularResumen();
};

// ==========================================
// CALCULAR RESUMEN AUTOMÁTICO
// ==========================================
function calcularResumen() {
    // Sumar inputs
    let totalInput = 0;
    document.querySelectorAll('.input-cantidad').forEach(input => {
        totalInput += parseFloat(input.value) || 0;
    });
    
    // Sumar outputs
    const outputPrincipal = parseFloat(document.getElementById('outputPrincipal')?.value) || 0;
    const outputMerma = parseFloat(document.getElementById('outputMerma')?.value) || 0;
    const totalOutput = outputPrincipal + outputMerma;
    
    // Calcular eficiencia y merma
    const eficiencia = totalInput > 0 ? ((outputPrincipal / totalInput) * 100) : 0;
    const porcentajeMerma = totalInput > 0 ? ((outputMerma / totalInput) * 100) : 0;
    
    // Calcular horas de trabajo
    const inicio = new Date(document.getElementById('fechaInicio').value);
    const fin = new Date(document.getElementById('fechaFin').value);
    const horasTrabajo = (fin - inicio) / (1000 * 60 * 60);
    
    // Actualizar UI
    document.getElementById('totalInput').textContent = `${totalInput.toFixed(1)} kg`;
    document.getElementById('totalOutput').textContent = `${totalOutput.toFixed(1)} kg`;
    document.getElementById('totalMerma').textContent = `${outputMerma.toFixed(1)} kg (${porcentajeMerma.toFixed(1)}%)`;
    document.getElementById('eficiencia').textContent = `${eficiencia.toFixed(1)}%`;
    document.getElementById('horasTrabajo').textContent = horasTrabajo > 0 ? horasTrabajo.toFixed(1) : '0';
}

// ==========================================
// REGISTRAR PROCESO
// ==========================================
async function registrarProceso(e) {
    e.preventDefault();
    
    const tipoProceso = document.getElementById('tipoProceso').value;
    const ticket = document.getElementById('ticketProduccion').value.trim();
    const operador = document.getElementById('operador').value.trim();
    const turno = document.getElementById('turno').value;
    
    // Recolectar inputs
    const inputs = [];
    document.querySelectorAll('.input-row').forEach(row => {
        const material = row.querySelector('.input-material').value.trim();
        const kg = parseFloat(row.querySelector('.input-cantidad').value) || 0;
        const ticketOrigen = row.querySelector('.input-ticket').value.trim();
        
        if (material && kg > 0) {
            inputs.push({ material, kg, ticketOrigen: ticketOrigen || null });
        }
    });
    
    if (inputs.length === 0) {
        showError('Debes agregar al menos un material de entrada');
        return;
    }
    
    // Recolectar outputs
    const outputPrincipal = parseFloat(document.getElementById('outputPrincipal').value) || 0;
    const outputMerma = parseFloat(document.getElementById('outputMerma')?.value) || 0;
    
    if (outputPrincipal === 0) {
        showError('El output principal no puede ser 0');
        return;
    }
    
    const proceso = PROCESOS[tipoProceso];
    const outputs = {
        principal: {
            material: proceso.outputs[0],
            kg: outputPrincipal
        }
    };
    
    if (proceso.outputs.includes('Merma')) {
        outputs.merma = {
            kg: outputMerma,
            tipo: 'Proceso de ' + proceso.nombre
        };
    }
    
    // Calcular totales y métricas
    const totalInput = inputs.reduce((sum, i) => sum + i.kg, 0);
    const totalOutput = outputPrincipal + outputMerma;
    const eficiencia = (outputPrincipal / totalInput) * 100;
    const porcentajeMerma = (outputMerma / totalInput) * 100;
    
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const inicio = new Date(fechaInicio);
    const fin = new Date(fechaFin);
    const horasTrabajo = (fin - inicio) / (1000 * 60 * 60);
    
    const registro = {
        ticket,
        tipoProceso,
        inputs,
        outputs,
        operador,
        turno,
        fechaInicio,
        fechaFin,
        horasTrabajo: parseFloat(horasTrabajo.toFixed(2)),
        totalInput,
        totalOutput,
        eficiencia: parseFloat(eficiencia.toFixed(2)),
        porcentajeMerma: parseFloat(porcentajeMerma.toFixed(2)),
        observaciones: document.getElementById('observaciones').value.trim(),
        fechaRegistro: new Date().toISOString()
    };
    
    try {
        const id = await guardarDato(COLLECTIONS.CONTROL_PRODUCCION, registro);
        registro.id = id;
        window.EVE.registrosControlProduccion.push(registro);
        
        showSuccess('Proceso registrado correctamente');
        limpiarFormulario();
        renderizarProcesos();
        
    } catch (error) {
        console.error('Error registrando proceso:', error);
        showError('Error al registrar proceso');
    }
}

// ==========================================
// LIMPIAR FORMULARIO
// ==========================================
function limpiarFormulario() {
    document.getElementById('controlProduccionForm').reset();
    document.getElementById('tipoProceso').value = '';
    document.getElementById('seccionInputs').style.display = 'none';
    document.getElementById('seccionOutputs').style.display = 'none';
    document.getElementById('descripcionProceso').style.display = 'none';
    document.getElementById('resumenProceso').style.display = 'none';
    document.getElementById('inputsContainer').innerHTML = '';
    document.getElementById('outputsContainer').innerHTML = '';
    inputCounter = 0;
    
    const ahora = new Date().toISOString().slice(0, 16);
    document.getElementById('fechaInicio').value = ahora;
    document.getElementById('fechaFin').value = ahora;
}

// ==========================================
// RENDERIZAR PROCESOS
// ==========================================
function renderizarProcesos() {
    const hoy = obtenerFechaMexico();
    const inicioSemana = obtenerInicioSemana();
    
    const procesosHoy = window.EVE.registrosControlProduccion.filter(p => 
        p.fechaInicio.startsWith(hoy)
    );
    const procesosSemana = window.EVE.registrosControlProduccion.filter(p => 
        p.fechaInicio >= inicioSemana
    );
    const procesosTodos = window.EVE.registrosControlProduccion;
    
    // Estadísticas HOY
    actualizarEstadisticas('Hoy', procesosHoy);
    renderTabla('tablaProcesosHoy', procesosHoy, true);
    
    // Estadísticas SEMANA
    actualizarEstadisticas('Semana', procesosSemana);
    renderTabla('tablaProcesosSemana', procesosSemana, false);
    
    // Estadísticas TODOS
    actualizarEstadisticas('Total', procesosTodos);
    renderTabla('tablaProcesosTodos', procesosTodos, true);
}

function actualizarEstadisticas(periodo, procesos) {
    const totalProcesos = procesos.length;
    const totalKg = procesos.reduce((sum, p) => sum + p.totalInput, 0);
    const eficienciaPromedio = totalProcesos > 0 
        ? procesos.reduce((sum, p) => sum + p.eficiencia, 0) / totalProcesos 
        : 0;
    
    document.getElementById(`stats${periodo}Procesos`).textContent = totalProcesos;
    document.getElementById(`stats${periodo}Kg`).textContent = formatearKg(totalKg);
    document.getElementById(`stats${periodo}Eficiencia`).textContent = eficienciaPromedio.toFixed(1) + '%';
}

function renderTabla(tbodyId, procesos, conAcciones) {
    const tbody = document.getElementById(tbodyId);
    tbody.innerHTML = '';
    
    if (procesos.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align: center; color: var(--gris-oscuro);">No hay procesos registrados</td></tr>';
        return;
    }
    
    procesos.forEach(p => {
        const proceso = PROCESOS[p.tipoProceso];
        const fecha = p.fechaInicio.split('T')[0];
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${p.ticket}</strong></td>
            <td>${proceso.icono} ${proceso.nombre}</td>
            <td>${p.operador}</td>
            ${tbodyId === 'tablaProcesosTodos' ? `<td>${p.turno}</td>` : ''}
            <td>${formatearKg(p.totalInput)}</td>
            <td>${formatearKg(p.outputs.principal.kg)}</td>
            <td>${formatearKg(p.outputs.merma?.kg || 0)}</td>
            <td style="color: ${p.eficiencia >= 90 ? 'green' : p.eficiencia >= 80 ? 'orange' : 'red'};">
                <strong>${p.eficiencia.toFixed(1)}%</strong>
            </td>
            ${tbodyId !== 'tablaProcesosHoy' ? `<td>${fecha}</td>` : ''}
            ${conAcciones ? `
                <td>
                    <button class="btn-icon" onclick="eliminarProceso('${p.id}')" title="Eliminar">🗑️</button>
                </td>
            ` : ''}
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// ELIMINAR PROCESO
// ==========================================
window.eliminarProceso = async function(id) {
    if (!confirm('¿Eliminar este proceso? Esta acción no se puede deshacer.')) return;
    
    try {
        await eliminarDato(COLLECTIONS.CONTROL_PRODUCCION, id);
        window.EVE.registrosControlProduccion = window.EVE.registrosControlProduccion.filter(p => p.id !== id);
        renderizarProcesos();
        showSuccess('Proceso eliminado');
    } catch (error) {
        console.error('Error eliminando proceso:', error);
        showError('Error al eliminar proceso');
    }
};

console.log('✅ EVE Control v2.0 - Control de Producción Extendido cargado');
