# 🔧 GUÍA DE INTEGRACIÓN - FILTROS Y REPORTES LOCALES

## 📦 ARCHIVOS CREADOS

1. **modulos-comunes.js** - Funciones reutilizables
2. **index.html** (actualizado) - Carga modulos-comunes.js

---

## ✅ QUÉ AGREGAR A CADA MÓDULO

### **PASO 1: Agregar HTML de Filtros y Botones**

En el tab "Todos los Registros" de cada módulo, agregar ANTES de la tabla:

```html
<!-- FILTROS -->
<div class="card" style="background: var(--gris-claro); margin-bottom: 1rem;">
    <h3 style="margin-bottom: 1rem;">🔍 Filtros</h3>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem;">
        <input type="text" id="filtroDestarajeTicket" class="form-control" placeholder="Ticket">
        <input type="date" id="filtroDestara jeFechaDesde" class="form-control">
        <input type="date" id="filtroDestarajeFechaHasta" class="form-control">
        <input type="text" id="filtroDestarajeProveedor" class="form-control" placeholder="Proveedor">
        <input type="text" id="filtroDestarajeMaterial" class="form-control" placeholder="Material">
    </div>
    <div style="margin-top: 1rem; display: flex; gap: 0.5rem; align-items: center;">
        <button class="btn btn-secondary" id="btnLimpiarFiltrosDestaraje">🔄 Limpiar Filtros</button>
        <span id="statsDestarajeFiltrados" style="margin-left: auto; font-weight: 600;"></span>
    </div>
</div>

<!-- EXPORTAR MÓDULO -->
<div class="card" style="margin-bottom: 1rem;">
    <h3 style="margin-bottom: 1rem;">📊 Exportar Este Módulo</h3>
    <div class="btn-group">
        <button class="btn btn-primary" id="btnExportarTXT_Destaraje">📄 TXT</button>
        <button class="btn btn-primary" id="btnExportarPDF_Destaraje">📕 PDF</button>
        <button class="btn btn-success" id="btnExportarCSV_Destaraje">📊 CSV</button>
    </div>
    <p style="margin-top: 0.5rem; font-size: 0.9rem; color: var(--gris-oscuro);">
        Exporta solo los datos de este módulo (respeta filtros aplicados)
    </p>
</div>
```

**⚠️ IMPORTANTE:** Reemplazar "Destaraje" con el nombre del módulo:
- Destaraje → destaraje.js
- Produccion → produccion.js (cambiar "Proveedor" por "Cliente")
- Pagos → pagos.js

---

### **PASO 2: Agregar Datalists para Autocompletado**

Al final del HTML de cada módulo, antes de cerrar el container:

```html
<!-- Autocompletado -->
<datalist id="destaraje-proveedores-list"></datalist>
<datalist id="destaraje-materiales-list"></datalist>
```

Y actualizar los inputs del formulario:

```html
<input type="text" id="destarajeProveedor" list="destaraje-proveedores-list" required>
<input type="text" id="destarajeMaterial" list="destaraje-materiales-list" required>
```

---

### **PASO 3: Agregar Event Listeners**

En la función `initDestarajeModule()` (o equivalente), agregar:

```javascript
function initDestarajeModule() {
    // ... código existente ...
    
    // AUTOCOMPLETADO
    inicializarAutocompletado('destaraje');
    
    // Poblar con datos existentes
    window.EVE.registrosDestaraje.forEach(r => {
        actualizarAutocompletadoModulo('destaraje-proveedores-list', r.proveedor);
        actualizarAutocompletadoModulo('destaraje-materiales-list', r.material);
    });
    
    // FILTROS
    const camposFiltro = ['Ticket', 'FechaDesde', 'FechaHasta', 'Proveedor', 'Material'];
    camposFiltro.forEach(campo => {
        const el = document.getElementById(`filtroDestaraje${campo}`);
        if (el) {
            el.addEventListener('input', () => {
                aplicarFiltrosModulo('Destaraje', window.EVE.registrosDestaraje, renderTablaDestaraje, 'destarajeTableTodos');
            });
        }
    });
    
    document.getElementById('btnLimpiarFiltrosDestaraje')?.addEventListener('click', () => {
        limpiarFiltrosModulo('Destaraje');
        renderizarDestaraje();
    });
    
    // EXPORTACIONES LOCALES
    document.getElementById('btnExportarTXT_Destaraje')?.addEventListener('click', () => {
        const filtrados = obtenerRegistrosFiltrados('Destaraje');
        exportarModuloTXT('Destaraje', filtrados);
    });
    
    document.getElementById('btnExportarPDF_Destaraje')?.addEventListener('click', () => {
        const filtrados = obtenerRegistrosFiltrados('Destaraje');
        exportarModuloPDF('Destaraje', filtrados);
    });
    
    document.getElementById('btnExportarCSV_Destaraje')?.addEventListener('click', () => {
        const filtrados = obtenerRegistrosFiltrados('Destaraje');
        exportarModuloCSV('Destaraje', filtrados);
    });
}

// Función helper para obtener registros filtrados
function obtenerRegistrosFiltrados(modulo) {
    const ticket = document.getElementById(`filtroDestarajeTicket`)?.value.toLowerCase() || '';
    const fechaDesde = document.getElementById(`filtroDestarajeFechaDesde`)?.value || '';
    const fechaHasta = document.getElementById(`filtroDestarajeFechaHasta`)?.value || '';
    const proveedor = document.getElementById(`filtroDestarajeProveedor`)?.value.toLowerCase() || '';
    const material = document.getElementById(`filtroDestarajeMaterial`)?.value.toLowerCase() || '';
    
    return window.EVE.registrosDestaraje.filter(r => {
        if (ticket && !r.ticket.toString().toLowerCase().includes(ticket)) return false;
        if (fechaDesde && r.fechaSalida < fechaDesde) return false;
        if (fechaHasta && r.fechaSalida > fechaHasta) return false;
        if (proveedor && !r.proveedor.toLowerCase().includes(proveedor)) return false;
        if (material && !r.material.toLowerCase().includes(material)) return false;
        return true;
    });
}
```

---

### **PASO 4: Actualizar Autocompletado al Agregar Registro**

En la función `agregarDestaraje()` (o equivalente), después de guardar el registro:

```javascript
async function agregarDestaraje() {
    // ... código existente de creación del registro ...
    
    try {
        const id = await guardarDato(COLLECTIONS.DESTARAJE, registro);
        registro.id = id;
        window.EVE.registrosDestaraje.push(registro);
        
        // ACTUALIZAR AUTOCOMPLETADO
        actualizarAutocompletadoModulo('destaraje-proveedores-list', registro.proveedor);
        actualizarAutocompletadoModulo('destaraje-materiales-list', registro.material);
        
        renderizarDestaraje();
        // ... resto del código ...
    }
}
```

---

## 📝 RESUMEN DE CAMBIOS POR ARCHIVO

### **destaraje.js**
1. Agregar HTML de filtros en tab "Todos"
2. Agregar HTML de botones de exportación
3. Agregar datalists
4. Event listeners de filtros
5. Event listeners de exportación
6. Actualizar autocompletado en agregarDestaraje()

### **produccion.js**
1. Mismos pasos que destaraje.js
2. Cambiar "Proveedor" por "Cliente"
3. Usar `destaraje-clientes-list` en lugar de proveedores

### **pagos.js**
1. Mismos pasos que destaraje.js
2. Filtro adicional por rango de montos (opcional)

---

## 🎨 RESULTADO VISUAL ESPERADO

```
┌────────────────────────────────────────────┐
│ [HOY] [ESTA SEMANA] [TODOS LOS REGISTROS] │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ 🔍 Filtros                                 │
├────────────────────────────────────────────┤
│ [Ticket___] [Desde____] [Hasta____]       │
│ [Proveedor] [Material_]                    │
│                                            │
│ [🔄 Limpiar] │        45 registros | 2,300 kg
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ 📊 Exportar Este Módulo                    │
├────────────────────────────────────────────┤
│ [📄 TXT] [📕 PDF] [📊 CSV]                 │
│ Exporta solo los datos de este módulo     │
└────────────────────────────────────────────┘

┌────────────────────────────────────────────┐
│ TABLA DE REGISTROS                         │
│ (filtrada en tiempo real)                  │
└────────────────────────────────────────────┘
```

---

## ⚡ FUNCIONALIDADES FINALES

✅ **Autocompletado:**
- Se puebla automáticamente con cada registro
- Sugiere valores mientras escribes
- Funciona en los 3 módulos

✅ **Filtros:**
- Búsqueda en tiempo real
- Múltiples criterios combinados
- Muestra contador de resultados
- Botón para limpiar

✅ **Exportaciones Locales:**
- TXT, PDF, CSV por módulo
- Respeta filtros aplicados
- Descarga inmediata
- No necesita ir a Reportes central

---

**¿Quieres que actualice los 3 archivos con estos cambios o prefieres hacerlo tú manualmente siguiendo esta guía?**
