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
        inputs: ['Material mezclado'],
        outputs: ['Material separado', 'Merma'],
        unidad: 'KG'
    },
    EMPACADO: {
        nombre: 'Empacado',
        icono: '📦',
        descripcion: 'Empacado en pacas',
        inputs: ['Material suelto'],
        outputs: ['Pacas'],
        unidad: 'PZ'
    },
    MOLIENDA: {
        nombre: 'Molienda',
        icono: '⚙️',
        descripcion: 'Triturado de material',
        inputs: ['Material entero'],
        outputs: ['Material molido', 'Merma'],
        unidad: 'KG'
    },
    LAVADO: {
        nombre: 'Lavado',
        icono: '💧',
        descripcion: 'Limpieza de material',
        inputs: ['Material sucio'],
        outputs: ['Material limpio', 'Merma'],
        unidad: 'KG'
    },
    PELETIZADO: {
        nombre: 'Peletizado',
        icono: '🔵',
        descripcion: 'Conversión a pellets',
        inputs: ['Material molido/lavado'],
        outputs: ['Pellets', 'Merma'],
        unidad: 'KG'
    }
};

const TURNOS = ['Matutino', 'Vespertino', 'Nocturno'];

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
                        <input type="text" id="ticketProduccion" required placeholder="P-001">
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Operador</label>
                        <input type="text" id="operador" list="operadores-list" required>
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
                        <input type="datetime-local" id="fechaInicio" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Fecha/Hora Fin</label>
                        <input type="datetime-local" id="fechaFin" required>
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
                <button class="tab" data-tab="trazabilidad">🔍 Trazabilidad</button>
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
                
                <!-- FILTROS -->
                <div class="card" style="background: var(--gris-claro); margin-bottom: 1rem;">
                    <h3 style="margin-bottom: 1rem;">🔍 Filtros</h3>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
                        <select id="filtroProceso" class="form-control">
                            <option value="">Todos los procesos</option>
                            ${Object.entries(PROCESOS).map(([key, p]) => 
                                `<option value="${key}">${p.icono} ${p.nombre}</option>`
                            ).join('')}
                        </select>
                        <input type="date" id="filtroFechaDesde" class="form-control">
                        <input type="date" id="filtroFechaHasta" class="form-control">
                        <input type="text" id="filtroOperador" class="form-control" placeholder="Operador">
                    </div>
                    <div style="margin-top: 1rem;">
                        <button class="btn btn-secondary" id="btnLimpiarFiltros">🔄 Limpiar Filtros</button>
                    </div>
                </div>
                
                <!-- EXPORTAR -->
                <div class="card" style="margin-bottom: 1rem;">
                    <h3 style="margin-bottom: 1rem;">📊 Exportar</h3>
                    <div class="btn-group">
                        <button class="btn btn-primary" id="btnExportarTXT">📄 TXT</button>
                        <button class="btn btn-primary" id="btnExportarPDF">📕 PDF</button>
                        <button class="btn btn-success" id="btnExportarCSV">📊 CSV</button>
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
            
            <!-- TRAZABILIDAD -->
            <div id="trazabilidad" class="tab-content">
                <div class="card" style="background: var(--gris-claro);">
                    <h3>🔍 Buscar Trazabilidad</h3>
                    <div style="display: flex; gap: 1rem; margin-top: 1rem;">
                        <input type="text" id="ticketTrazabilidad" class="form-control" placeholder="Número de ticket" style="flex: 1;">
                        <button class="btn btn-primary" id="btnBuscarTrazabilidad">🔍 Buscar</button>
                    </div>
                </div>
                
                <div id="resultadoTrazabilidad"></div>
            </div>
        </div>
        
        <!-- Datalists -->
        <datalist id="operadores-list"></datalist>
        <datalist id="materiales-input-list"></datalist>
    `;
    
    initControlProduccionModule();
}

// Continuará en siguiente mensaje...
console.log('✅ EVE Control v2.0 - Control de Producción Extendido (parte 1) cargado');

// ==========================================
// INICIALIZACIÓN
// ==========================================
function initControlProduccionModule() {
    // Event listeners
    document.getElementById('tipoProceso').addEventListener('change', cambiarTipoProceso);
    document.getElementById('controlProduccionForm').addEventListener('submit', registrarProceso);
    document.getElementById('btnAgregarInput').addEventListener('click', agregarInputField);
    document.getElementById('btnLimpiarForm').addEventListener('click', limpiarFormulario);
    document.getElementById('btnBuscarTrazabilidad').addEventListener('click', buscarTrazabilidad);
    
    // Tabs
    document.querySelectorAll('#moduleControlProduccion .tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabId = this.dataset.tab;
            document.querySelectorAll('#moduleControlProduccion .tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#moduleControlProduccion .tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabId).classList.add('active'));
        });
    });
    
    // Fechas por defecto
    const ahora = new Date();
    const ahoraStr = ahora.toISOString().slice(0, 16);
    document.getElementById('fechaInicio').value = ahoraStr;
    document.getElementById('fechaFin').value = ahoraStr;
    
    // Filtros
    document.getElementById('filtroProceso').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroFechaDesde').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroFechaHasta').addEventListener('change', aplicarFiltros);
    document.getElementById('filtroOperador').addEventListener('input', aplicarFiltros);
    document.getElementById('btnLimpiarFiltros').addEventListener('click', limpiarFiltros);
    
    // Exportaciones
    document.getElementById('btnExportarTXT').addEventListener('click', () => exportarProcesos('TXT'));
    document.getElementById('btnExportarPDF').addEventListener('click', () => exportarProcesos('PDF'));
    document.getElementById('btnExportarCSV').addEventListener('click', () => exportarProcesos('CSV'));
    
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
    
    // Agregar primer input
    agregarInputField();
    
    // Generar outputs según el proceso
    if (proceso.outputs.includes('Merma')) {
        // Output principal + Merma
        document.getElementById('outputsContainer').innerHTML = `
            <div class="form-grid">
                <div class="form-group">
                    <label class="form-label">${proceso.outputs[0]}</label>
                    <input type="number" id="outputPrincipal" class="output-field" step="0.1" min="0" required placeholder="kg">
                </div>
                <div class="form-group">
                    <label class="form-label">Merma</label>
                    <input type="number" id="outputMerma" class="output-field" step="0.1" min="0" required placeholder="kg">
                </div>
            </div>
        `;
    } else {
        // Solo output principal (ej: Empacado -> Pacas)
        document.getElementById('outputsContainer').innerHTML = `
            <div class="form-group">
                <label class="form-label">${proceso.outputs[0]}</label>
                <input type="number" id="outputPrincipal" class="output-field" step="0.1" min="0" required placeholder="${proceso.unidad}">
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
let inputCounter = 0;
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
                <input type="text" class="input-material" list="materiales-input-list" required placeholder="PET MOLIDO, etc.">
            </div>
            <div class="form-group">
                <label class="form-label">Cantidad (kg)</label>
                <input type="number" class="input-cantidad" step="0.1" min="0" required placeholder="0">
            </div>
            <div class="form-group">
                <label class="form-label">Ticket Origen</label>
                <input type="text" class="input-ticket" placeholder="Opcional">
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

// Continuará...

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
        
        // Actualizar autocompletado
        actualizarAutocompletadoModulo('operadores-list', operador);
        inputs.forEach(input => {
            actualizarAutocompletadoModulo('materiales-input-list', input.material);
        });
        
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
                    <button class="btn-icon" onclick="verDetalleProceso('${p.id}')" title="Ver detalle">👁️</button>
                    <button class="btn-icon" onclick="eliminarProceso('${p.id}')" title="Eliminar">🗑️</button>
                </td>
            ` : ''}
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// VER DETALLE DE PROCESO
// ==========================================
window.verDetalleProceso = function(id) {
    const proceso = window.EVE.registrosControlProduccion.find(p => p.id === id);
    if (!proceso) return;
    
    const procesoInfo = PROCESOS[proceso.tipoProceso];
    
    let html = `
        <div class="modal" style="display: flex;">
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h2>${procesoInfo.icono} ${procesoInfo.nombre} - ${proceso.ticket}</h2>
                    <button class="btn-close" onclick="this.closest('.modal').remove()">✕</button>
                </div>
                <div class="modal-body">
                    <div class="card">
                        <h3>📋 Información General</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div><strong>Operador:</strong> ${proceso.operador}</div>
                            <div><strong>Turno:</strong> ${proceso.turno}</div>
                            <div><strong>Inicio:</strong> ${new Date(proceso.fechaInicio).toLocaleString('es-MX')}</div>
                            <div><strong>Fin:</strong> ${new Date(proceso.fechaFin).toLocaleString('es-MX')}</div>
                            <div><strong>Horas:</strong> ${proceso.horasTrabajo} hrs</div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3>📥 Materiales de Entrada</h3>
                        <table style="width: 100%;">
                            <thead>
                                <tr>
                                    <th>Material</th>
                                    <th>Cantidad</th>
                                    <th>Ticket Origen</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${proceso.inputs.map(input => `
                                    <tr>
                                        <td>${input.material}</td>
                                        <td>${formatearKg(input.kg)}</td>
                                        <td>${input.ticketOrigen || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                        <p style="margin-top: 0.5rem;"><strong>Total Input:</strong> ${formatearKg(proceso.totalInput)}</p>
                    </div>
                    
                    <div class="card">
                        <h3>📤 Productos de Salida</h3>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <div>
                                <strong>${proceso.outputs.principal.material}:</strong>
                                <span style="font-size: 1.2rem; color: green;">${formatearKg(proceso.outputs.principal.kg)}</span>
                            </div>
                            ${proceso.outputs.merma ? `
                                <div>
                                    <strong>Merma:</strong>
                                    <span style="font-size: 1.2rem; color: red;">${formatearKg(proceso.outputs.merma.kg)} (${proceso.porcentajeMerma.toFixed(1)}%)</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    
                    <div class="card">
                        <h3>📊 Métricas</h3>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                            <div class="stat-card">
                                <div class="stat-label">Eficiencia</div>
                                <div class="stat-value" style="color: ${proceso.eficiencia >= 90 ? 'green' : proceso.eficiencia >= 80 ? 'orange' : 'red'};">
                                    ${proceso.eficiencia.toFixed(1)}%
                                </div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Productividad</div>
                                <div class="stat-value">${(proceso.outputs.principal.kg / proceso.horasTrabajo).toFixed(1)} kg/hr</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-label">Total Output</div>
                                <div class="stat-value">${formatearKg(proceso.totalOutput)}</div>
                            </div>
                        </div>
                    </div>
                    
                    ${proceso.observaciones ? `
                        <div class="card">
                            <h3>📝 Observaciones</h3>
                            <p>${proceso.observaciones}</p>
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
};

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

// Continuará con filtros y trazabilidad...



// ==========================================
// FILTROS
// ==========================================
function aplicarFiltros() {
    const tipoProceso = document.getElementById('filtroProceso').value;
    const fechaDesde = document.getElementById('filtroFechaDesde').value;
    const fechaHasta = document.getElementById('filtroFechaHasta').value;
    const operador = document.getElementById('filtroOperador').value.toLowerCase();
    
    const filtrados = window.EVE.registrosControlProduccion.filter(p => {
        if (tipoProceso && p.tipoProceso !== tipoProceso) return false;
        if (fechaDesde && p.fechaInicio.split('T')[0] < fechaDesde) return false;
        if (fechaHasta && p.fechaInicio.split('T')[0] > fechaHasta) return false;
        if (operador && !p.operador.toLowerCase().includes(operador)) return false;
        return true;
    });
    
    renderTabla('tablaProcesosTodos', filtrados, true);
}

function limpiarFiltros() {
    document.getElementById('filtroProceso').value = '';
    document.getElementById('filtroFechaDesde').value = '';
    document.getElementById('filtroFechaHasta').value = '';
    document.getElementById('filtroOperador').value = '';
    renderizarProcesos();
}

// ==========================================
// TRAZABILIDAD
// ==========================================
function buscarTrazabilidad() {
    const ticketBuscar = document.getElementById('ticketTrazabilidad').value.trim();
    
    if (!ticketBuscar) {
        showError('Ingresa un ticket para buscar');
        return;
    }
    
    const container = document.getElementById('resultadoTrazabilidad');
    container.innerHTML = '<div class="card"><p>🔍 Buscando...</p></div>';
    
    const cadena = construirCadenaTrazabilidad(ticketBuscar);
    
    if (cadena.length === 0) {
        container.innerHTML = `
            <div class="card" style="background: #fff3cd;">
                <p>⚠️ No se encontró trazabilidad para el ticket <strong>${ticketBuscar}</strong></p>
            </div>
        `;
        return;
    }
    
    renderizarCadenaTrazabilidad(cadena, ticketBuscar);
}

function construirCadenaTrazabilidad(ticketInicial) {
    const cadena = [];
    
    const entrada = window.EVE.registrosDestaraje?.find(d => d.ticket === ticketInicial);
    if (entrada) {
        cadena.push({ tipo: 'ENTRADA', data: entrada, icono: '📥' });
    }
    
    const procesosConEsteTicket = window.EVE.registrosControlProduccion.filter(p =>
        p.inputs.some(input => input.ticketOrigen === ticketInicial)
    );
    
    procesosConEsteTicket.forEach(proceso => {
        cadena.push({ tipo: 'PROCESO', data: proceso, icono: PROCESOS[proceso.tipoProceso].icono });
    });
    
    return cadena;
}

function renderizarCadenaTrazabilidad(cadena, ticketInicial) {
    const container = document.getElementById('resultadoTrazabilidad');
    
    let html = `<div class="card"><h3>🔍 Trazabilidad del Ticket: ${ticketInicial}</h3></div>`;
    
    cadena.forEach((etapa, index) => {
        if (etapa.tipo === 'ENTRADA') {
            html += `
                <div class="card" style="background: #e7f3ff;">
                    <h4>${etapa.icono} ENTRADA</h4>
                    <p><strong>Ticket:</strong> ${etapa.data.ticket}</p>
                    <p><strong>Proveedor:</strong> ${etapa.data.proveedor}</p>
                    <p><strong>Material:</strong> ${etapa.data.material}</p>
                    <p><strong>Cantidad:</strong> ${formatearKg(etapa.data.kg)}</p>
                </div>
            `;
        } else if (etapa.tipo === 'PROCESO') {
            const proceso = PROCESOS[etapa.data.tipoProceso];
            html += `
                <div style="text-align: center; font-size: 2rem;">↓</div>
                <div class="card" style="background: #fff9e6;">
                    <h4>${etapa.icono} ${proceso.nombre}</h4>
                    <p><strong>Ticket:</strong> ${etapa.data.ticket}</p>
                    <p><strong>Operador:</strong> ${etapa.data.operador}</p>
                    <p><strong>Output:</strong> ${formatearKg(etapa.data.outputs.principal.kg)}</p>
                    <p><strong>Eficiencia:</strong> ${etapa.data.eficiencia.toFixed(1)}%</p>
                </div>
            `;
        }
    });
    
    container.innerHTML = html;
}

// ==========================================
// EXPORTACIONES
// ==========================================
function exportarProcesos(formato) {
    const procesos = window.EVE.registrosControlProduccion;
    
    if (procesos.length === 0) {
        showError('No hay procesos para exportar');
        return;
    }
    
    if (formato === 'TXT') {
        let contenido = `CONTROL DE PRODUCCIÓN\n`;
        contenido += `Total: ${procesos.length} procesos\n\n`;
        procesos.forEach(p => {
            contenido += `${p.ticket}\t${PROCESOS[p.tipoProceso].nombre}\t${p.operador}\t${p.totalInput}kg\n`;
        });
        const blob = new Blob([contenido], { type: 'text/plain' });
        descargarArchivo(blob, `produccion_${obtenerFechaMexico()}.txt`);
        showSuccess('TXT generado');
    }
}

console.log('✅ EVE Control v2.0 - Control de Producción Extendido COMPLETO');
