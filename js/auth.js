/* ==========================================
   EVE CONTROL v2.0 - AUTHENTICATION
   Login, usuarios y permisos
   ========================================== */

// ==========================================
// ESTADO DE AUTENTICACIÓN
// ==========================================
let currentUser = null;

// ==========================================
// INICIALIZACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', async function() {
    // Ocultar loading
    setTimeout(() => {
        document.getElementById('loadingScreen').classList.add('hidden');
    }, 1000);
    
    // Verificar sesión guardada
    const savedSession = localStorage.getItem('mehicaso_session');
    if (savedSession) {
        const session = JSON.parse(savedSession);
        const user = await buscarUsuario(session.username);
        
        if (user && user.active) {
            await loginUser(user);
        } else {
            mostrarLogin();
        }
    } else {
        mostrarLogin();
    }
});

// ==========================================
// LOGIN
// ==========================================
function mostrarLogin() {
    document.getElementById('loginScreen').classList.remove('hidden');
}

document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    
    console.log('=== INTENTO DE LOGIN ===');
    console.log('Usuario ingresado:', username);
    console.log('Password length:', password.length);
    
    const user = await validarCredenciales(username, password);
    
    if (user) {
        console.log('✅ Usuario validado:', user.username);
        
        if (!user.active) {
            console.log('❌ Usuario desactivado');
            showLoginError('Usuario desactivado. Contacte al administrador.');
            return;
        }
        
        console.log('✅ Usuario activo, procediendo con login...');
        await loginUser(user);
    } else {
        console.log('❌ Credenciales incorrectas');
        showLoginError('Usuario o contraseña incorrectos');
    }
});

async function validarCredenciales(username, password) {
    try {
        const snapshot = await db.collection(COLLECTIONS.USERS).get();
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        console.log('=== DEBUG LOGIN ===');
        console.log('Usuarios en BD:', users.length);
        console.log('Usuario ingresado:', username);
        console.log('Password length:', password.length);
        
        // Mostrar todos los usuarios en consola para debug
        users.forEach(u => {
            console.log(`- Usuario en BD: "${u.username}" (ID: ${u.id})`);
        });
        
        // Buscar usuario - EXACTO (case sensitive)
        const user = users.find(u => 
            u.username === username && 
            u.password === password
        );
        
        if (user) {
            console.log('✅ Usuario encontrado:', user.username);
            console.log('Permissions:', user.permissions);
            
            // Asegurar que permissions existe y tiene todos los campos
            if (!user.permissions) {
                console.log('⚠️ Creando permissions por defecto');
                user.permissions = {
                    destaraje: true,
                    produccion: true,
                    pagos: true,
                    reportes: true,
                    admin: true
                };
            } else {
                // Asegurar que reportes existe (puede no estar en usuarios viejos)
                if (user.permissions.reportes === undefined) {
                    console.log('⚠️ Agregando campo reportes faltante');
                    user.permissions.reportes = true;
                }
            }
            
            // Asegurar que active existe
            if (user.active === undefined) {
                console.log('⚠️ Agregando campo active faltante');
                user.active = true;
            }
            
            console.log('✅ Usuario validado correctamente');
        } else {
            console.log('❌ NO se encontró usuario que coincida');
            console.log('Verificar:');
            console.log('- Username exacto (case-sensitive)');
            console.log('- Password exacto');
        }
        
        return user || null;
    } catch (error) {
        console.error('❌ Error validando credenciales:', error);
        showLoginError('Error de conexión. Intente de nuevo.');
        return null;
    }
}

async function buscarUsuario(username) {
    try {
        const snapshot = await db.collection(COLLECTIONS.USERS).get();
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Case sensitive para compatibilidad con v1.1
        const user = users.find(u => u.username === username);
        
        if (user) {
            // Asegurar compatibilidad con estructura v1.1
            if (!user.permissions) {
                user.permissions = {
                    destaraje: true,
                    produccion: true,
                    pagos: true,
                    reportes: true,
                    admin: true
                };
            }
            if (user.active === undefined) {
                user.active = true;
            }
        }
        
        return user || null;
    } catch (error) {
        console.error('Error buscando usuario:', error);
        return null;
    }
}

async function loginUser(user) {
    currentUser = user;
    window.EVE.currentUser = user;
    
    // Guardar sesión
    localStorage.setItem('mehicaso_session', JSON.stringify({
        username: user.username,
        loginTime: new Date().toISOString()
    }));
    
    // Ocultar login, mostrar app
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appScreen').classList.remove('hidden');
    document.getElementById('appScreen').classList.add('active');
    
    // Cargar todos los datos
    await cargarTodosLosDatos();
    
    // Configurar módulos según permisos
    setupUserModules();
    
    showSuccess(`¡Bienvenido ${user.username}!`);
}

function showLoginError(message) {
    const errorDiv = document.getElementById('loginError');
    errorDiv.textContent = message;
    errorDiv.classList.remove('hidden');
    setTimeout(() => errorDiv.classList.add('hidden'), 3000);
}

// ==========================================
// LOGOUT
// ==========================================
document.getElementById('btnLogout').addEventListener('click', function() {
    if (confirm('¿Cerrar sesión?')) {
        localStorage.removeItem('mehicaso_session');
        location.reload();
    }
});

// ==========================================
// CARGAR DATOS
// ==========================================
async function cargarTodosLosDatos() {
    try {
        // Cargar en paralelo
        const [destaraje, produccion, pagos, ministraciones, controlProduccion, usuarios] = await Promise.all([
            cargarDatos(COLLECTIONS.DESTARAJE),
            cargarDatos(COLLECTIONS.PRODUCCION),
            cargarDatos(COLLECTIONS.PAGOS),
            cargarDatos(COLLECTIONS.MINISTRACIONES),
            cargarDatos(COLLECTIONS.CONTROL_PRODUCCION),
            cargarDatos(COLLECTIONS.USERS)
        ]);
        
        window.EVE.registrosDestaraje = destaraje;
        window.EVE.registrosProduccion = produccion;
        window.EVE.registrosPagos = pagos;
        window.EVE.registrosMinistraciones = ministraciones;
        window.EVE.registrosControlProduccion = controlProduccion;
        window.EVE.usuarios = usuarios;
        
        console.log('✅ Datos cargados:', {
            destaraje: destaraje.length,
            produccion: produccion.length,
            pagos: pagos.length,
            ministraciones: ministraciones.length,
            controlProduccion: controlProduccion.length,
            usuarios: usuarios.length
        });
    } catch (error) {
        console.error('Error cargando datos:', error);
        showError('Error al cargar datos del sistema');
    }
}

// ==========================================
// CONFIGURAR MÓDULOS SEGÚN PERMISOS
// ==========================================
function setupUserModules() {
    const tabsContainer = document.getElementById('moduleTabs');
    tabsContainer.innerHTML = '';
    
    const modulosDisponibles = [];
    
    // Verificar permisos del usuario
    if (currentUser.permissions?.destaraje) {
        modulosDisponibles.push(MODULES.DESTARAJE);
    }
    
    if (currentUser.permissions?.produccion) {
        modulosDisponibles.push(MODULES.PRODUCCION);
    }
    
    if (currentUser.permissions?.pagos) {
        modulosDisponibles.push(MODULES.PAGOS);
    }
    
    if (currentUser.permissions?.controlProduccion) {
        modulosDisponibles.push(MODULES.CONTROL_PRODUCCION);
    }
    
    if (currentUser.permissions?.reportes) {
        modulosDisponibles.push(MODULES.REPORTES);
    }
    
    // Crear tabs
    modulosDisponibles.forEach((modulo, index) => {
        const tab = document.createElement('button');
        tab.className = 'tab' + (index === 0 ? ' active' : '');
        tab.textContent = `${modulo.icon} ${modulo.name}`;
        tab.dataset.module = `module${modulo.id.charAt(0).toUpperCase() + modulo.id.slice(1)}`;
        tab.addEventListener('click', () => switchModule(tab.dataset.module));
        tabsContainer.appendChild(tab);
    });
    
    // Mostrar botón admin si tiene permisos
    if (currentUser.permissions?.admin) {
        document.getElementById('btnAdminPanel').classList.remove('hidden');
    }
    
    // Activar primer módulo
    if (modulosDisponibles.length > 0) {
        const primerModulo = `module${modulosDisponibles[0].id.charAt(0).toUpperCase() + modulosDisponibles[0].id.slice(1)}`;
        switchModule(primerModulo);
    }
}

function switchModule(moduleId) {
    // Desactivar todos
    document.querySelectorAll('#moduleTabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.app-container .tab-content').forEach(c => c.classList.remove('active'));
    
    // Activar seleccionado
    const tab = document.querySelector(`[data-module="${moduleId}"]`);
    if (tab) tab.classList.add('active');
    
    const content = document.getElementById(moduleId);
    if (content) content.classList.add('active');
    
    // Cargar contenido del módulo
    cargarContenidoModulo(moduleId);
}

function cargarContenidoModulo(moduleId) {
    if (moduleId === 'moduleDestaraje' && typeof loadDestarajeModule === 'function') {
        loadDestarajeModule();
    } else if (moduleId === 'moduleProduccion' && typeof loadProduccionModule === 'function') {
        loadProduccionModule();
    } else if (moduleId === 'modulePagos' && typeof loadPagosModule === 'function') {
        loadPagosModule();
    } else if (moduleId === 'moduleControlProduccion' && typeof loadControlProduccionModule === 'function') {
        loadControlProduccionModule();
    } else if (moduleId === 'moduleReportes' && typeof loadReportesModule === 'function') {
        loadReportesModule();
    }
}

// ==========================================
// PANEL DE ADMINISTRACIÓN
// ==========================================
document.getElementById('btnAdminPanel').addEventListener('click', function() {
    abrirModal('adminModal');
    cargarUsuarios();
});

document.getElementById('closeAdminModal').addEventListener('click', function() {
    cerrarModal('adminModal');
});

// Tabs del admin panel
document.querySelectorAll('[data-admin-tab]').forEach(tab => {
    tab.addEventListener('click', function() {
        const tabId = this.dataset.adminTab;
        
        document.querySelectorAll('[data-admin-tab]').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('#adminModal .tab-content').forEach(c => c.classList.remove('active'));
        
        this.classList.add('active');
        document.getElementById(tabId).classList.add('active');
    });
});

// ==========================================
// GESTIÓN DE USUARIOS
// ==========================================
async function cargarUsuarios() {
    const tbody = document.querySelector('#tableUsers tbody');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center">Cargando...</td></tr>';
    
    try {
        const usuarios = await cargarDatos(COLLECTIONS.USERS);
        window.EVE.usuarios = usuarios;
        
        tbody.innerHTML = '';
        
        usuarios.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${user.username}</strong></td>
                <td>${user.permissions?.destaraje ? '✅' : '❌'}</td>
                <td>${user.permissions?.produccion ? '✅' : '❌'}</td>
                <td>${user.permissions?.pagos ? '✅' : '❌'}</td>
                <td>${user.permissions?.reportes ? '✅' : '❌'}</td>
                <td>${user.active ? '✅' : '❌'}</td>
                <td class="actions">
                    <button class="btn-icon" onclick="editarUsuario('${user.id}')" title="Editar">✏️</button>
                    <button class="btn-icon" onclick="eliminarUsuario('${user.id}')" title="Eliminar">🗑️</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (error) {
        console.error('Error cargando usuarios:', error);
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Error al cargar usuarios</td></tr>';
    }
}

document.getElementById('btnNewUser').addEventListener('click', function() {
    abrirFormularioUsuario();
});

function abrirFormularioUsuario(userId = null) {
    abrirModal('userModal');
    
    const titulo = document.getElementById('userModalTitle');
    const form = document.getElementById('userForm');
    
    if (userId) {
        titulo.textContent = 'Editar Usuario';
        const user = window.EVE.usuarios.find(u => u.id === userId);
        if (user) {
            document.getElementById('userFormUsername').value = user.username;
            document.getElementById('userFormPassword').value = user.password;
            document.getElementById('permDestaraje').checked = user.permissions?.destaraje || false;
            document.getElementById('permProduccion').checked = user.permissions?.produccion || false;
            document.getElementById('permPagos').checked = user.permissions?.pagos || false;
            document.getElementById('permReportes').checked = user.permissions?.reportes || false;
            document.getElementById('userActive').checked = user.active !== false;
            form.dataset.userId = userId;
        }
    } else {
        titulo.textContent = 'Nuevo Usuario';
        form.reset();
        document.getElementById('userActive').checked = true;
        delete form.dataset.userId;
    }
}

window.editarUsuario = function(userId) {
    abrirFormularioUsuario(userId);
};

document.getElementById('userForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    
    const userId = this.dataset.userId;
    const userData = {
        username: document.getElementById('userFormUsername').value.trim(),
        password: document.getElementById('userFormPassword').value,
        permissions: {
            destaraje: document.getElementById('permDestaraje').checked,
            produccion: document.getElementById('permProduccion').checked,
            pagos: document.getElementById('permPagos').checked,
            reportes: document.getElementById('permReportes').checked,
            admin: false // Solo el admin principal tiene este permiso
        },
        active: document.getElementById('userActive').checked
    };
    
    try {
        if (userId) {
            await actualizarDato(COLLECTIONS.USERS, userId, userData);
            showSuccess('Usuario actualizado correctamente');
        } else {
            await guardarDato(COLLECTIONS.USERS, userData);
            showSuccess('Usuario creado correctamente');
        }
        
        cerrarModal('userModal');
        await cargarUsuarios();
    } catch (error) {
        console.error('Error guardando usuario:', error);
        showError('Error al guardar usuario');
    }
});

document.getElementById('cancelUserForm').addEventListener('click', function() {
    cerrarModal('userModal');
});

document.getElementById('closeUserModal').addEventListener('click', function() {
    cerrarModal('userModal');
});

window.eliminarUsuario = async function(userId) {
    const user = window.EVE.usuarios.find(u => u.id === userId);
    if (!user) return;
    
    if (!confirm(`¿Eliminar al usuario "${user.username}"?`)) return;
    
    try {
        await eliminarDato(COLLECTIONS.USERS, userId);
        showSuccess('Usuario eliminado correctamente');
        await cargarUsuarios();
    } catch (error) {
        console.error('Error eliminando usuario:', error);
        showError('Error al eliminar usuario');
    }
};

// ==========================================
// BACKUP DE BASE DE DATOS
// ==========================================
document.getElementById('btnExportDB').addEventListener('click', async function() {
    try {
        this.disabled = true;
        this.textContent = 'Exportando...';
        
        const backup = {
            fecha: new Date().toISOString(),
            version: '2.0',
            users: window.EVE.usuarios,
            destaraje: window.EVE.registrosDestaraje,
            produccion: window.EVE.registrosProduccion,
            pagos: window.EVE.registrosPagos,
            ministraciones: window.EVE.registrosMinistraciones
        };
        
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const fecha = new Date().toISOString().split('T')[0];
        descargarArchivo(blob, `backup_eve_control_${fecha}.json`);
        
        showSuccess('Backup exportado correctamente');
    } catch (error) {
        console.error('Error exportando backup:', error);
        showError('Error al exportar backup');
    } finally {
        this.disabled = false;
        this.textContent = '📥 Exportar BD Completa';
    }
});

document.getElementById('btnImportDB').addEventListener('click', function() {
    document.getElementById('fileImportDB').click();
});

document.getElementById('fileImportDB').addEventListener('change', async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (!confirm('¿Restaurar base de datos? Esto sobrescribirá todos los datos actuales.')) {
        e.target.value = '';
        return;
    }
    
    try {
        const text = await file.text();
        const backup = JSON.parse(text);
        
        // Aquí iría la lógica de restauración con batch writes
        // Por simplicidad, mostramos solo el concepto
        showSuccess('Funcionalidad de importación en desarrollo');
        
    } catch (error) {
        console.error('Error importando backup:', error);
        showError('Error al importar backup: ' + error.message);
    }
    
    e.target.value = '';
});

// ==========================================
// TEST TELEGRAM
// ==========================================
document.getElementById('btnTestTelegram').addEventListener('click', async function() {
    try {
        this.disabled = true;
        this.textContent = 'Enviando...';
        
        const result = await sendTelegramMessage(
            '🧪 <b>Prueba de conexión</b>\n\nSistema EVE Control v2.0 conectado correctamente a Telegram.'
        );
        
        if (result.ok) {
            showSuccess('✅ Mensaje enviado correctamente a Telegram');
        } else {
            showError('❌ Error: ' + result.description);
        }
    } catch (error) {
        showError('❌ Error al enviar mensaje: ' + error.message);
    } finally {
        this.disabled = false;
        this.textContent = '🧪 Probar Telegram';
    }
});

console.log('✅ EVE Control v2.0 - Auth cargado');
