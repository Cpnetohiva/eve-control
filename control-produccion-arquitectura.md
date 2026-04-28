# 🏭 CONTROL DE PRODUCCIÓN EXTENDIDO - ARQUITECTURA COMPLETA

## 🎯 OBJETIVO

Sistema completo de trazabilidad de procesos productivos con registro de inputs/outputs, cálculo automático de mermas y eficiencia por cada etapa del proceso.

---

## 📊 TIPOS DE PROCESOS

```javascript
PROCESOS = {
    SELECCION: {
        nombre: 'Selección',
        icono: '🔍',
        inputs: ['Material mezclado'],
        outputs: ['Material separado', 'Merma']
    },
    EMPACADO: {
        nombre: 'Empacado',
        icono: '📦',
        inputs: ['Material suelto'],
        outputs: ['Pacas']  // Sin merma
    },
    MOLIENDA: {
        nombre: 'Molienda',
        icono: '⚙️',
        inputs: ['Material entero'],
        outputs: ['Material molido', 'Merma']
    },
    LAVADO: {
        nombre: 'Lavado',
        icono: '💧',
        inputs: ['Material sucio'],
        outputs: ['Material limpio', 'Merma']
    },
    PELETIZADO: {
        nombre: 'Peletizado',
        icono: '🔵',
        inputs: ['Material molido/lavado'],
        outputs: ['Pellets', 'Merma']
    }
}
```

---

## 🗃️ ESTRUCTURA DE DATOS

### **Registro de Proceso**

```javascript
{
    id: 'PROC-001',
    ticket: 'P-12345',
    tipoProceso: 'PELETIZADO',
    
    // Materiales consumidos
    inputs: [
        {
            material: 'PET MOLIDO',
            kg: 1000,
            ticketOrigen: '9260'  // Trazabilidad
        },
        {
            material: 'ADITIVO AZUL',
            kg: 50,
            ticketOrigen: null
        }
    ],
    
    // Productos generados
    outputs: {
        principal: {
            material: 'PELLETS PET AZUL',
            kg: 900,
            ubicacion: 'Supersaco #45'
        },
        merma: {
            kg: 150,
            tipo: 'Polvillo + rebaba'
        }
    },
    
    // Datos operativos
    operador: 'Christian',
    turno: 'Matutino',
    fechaInicio: '2026-04-28T08:00:00',
    fechaFin: '2026-04-28T14:00:00',
    horasTrabajo: 6,
    
    // Métricas automáticas
    totalInput: 1050,
    totalOutput: 1050,  // 900 + 150
    eficiencia: 85.71,  // 900 / 1050 * 100
    porcentajeMerma: 14.29,  // 150 / 1050 * 100
    
    // Observaciones
    observaciones: 'Material de excelente calidad',
    problemas: '',
    
    // Metadata
    fechaRegistro: '2026-04-28T14:30:00',
    usuarioRegistro: 'admin'
}
```

---

## 🎨 INTERFAZ DE USUARIO

### **Formulario de Captura**

```
┌─────────────────────────────────────────┐
│ 🏭 NUEVO PROCESO DE PRODUCCIÓN          │
├─────────────────────────────────────────┤
│                                         │
│ Tipo de Proceso:                        │
│ [🔵 Peletizado ▼]                       │
│                                         │
│ 🔵 Conversión a pellets                 │
│                                         │
│ [Ticket: P-001] [Operador: Christian ▼]│
│ [Turno: Matutino ▼]                     │
│                                         │
│ 📥 MATERIALES DE ENTRADA                │
│ ┌─────────────────────────────────────┐ │
│ │ Material: [PET MOLIDO      ]        │ │
│ │ Cantidad: [1000            ] kg     │ │
│ │ Ticket:   [9260            ]        │ │
│ │ [+ Agregar Material]                │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ 📤 PRODUCTOS DE SALIDA                  │
│ ┌─────────────────────────────────────┐ │
│ │ Pellets:  [900             ] kg     │ │
│ │ Merma:    [100             ] kg     │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Inicio: 28/04 08:00] [Fin: 28/04 14:00]│
│                                         │
│ 📊 RESUMEN AUTOMÁTICO                   │
│ Input: 1,000 kg | Output: 1,000 kg     │
│ Merma: 100 kg (10%) | Eficiencia: 90%  │
│ Horas: 6.0                              │
│                                         │
│ Observaciones:                          │
│ [_________________________________]     │
│                                         │
│ [✅ Registrar Proceso] [🔄 Limpiar]    │
└─────────────────────────────────────────┘
```

---

## 📈 TABS DE VISUALIZACIÓN

### **1. HOY**
- Procesos del día actual
- Estadísticas: Total procesos, Kg procesados, Eficiencia promedio
- Tabla resumida

### **2. ESTA SEMANA**
- Procesos de la semana
- Comparativo por día
- Gráficas de tendencias (futuro)

### **3. TODOS LOS PROCESOS**
- Filtros:
  - Tipo de proceso
  - Rango de fechas
  - Operador
- Exportaciones: TXT, PDF, CSV
- Tabla completa con todas las métricas

### **4. TRAZABILIDAD** 🔍
- Buscar por ticket
- Mostrar cadena completa:
  ```
  ENTRADA (Destaraje)
  Ticket 9260: 1,000 kg PET
       ↓
  SELECCIÓN
  P-001: 950 kg separado, 50 kg merma
       ↓
  MOLIENDA
  P-002: 900 kg molido, 50 kg merma
       ↓
  LAVADO
  P-003: 850 kg lavado, 50 kg merma
       ↓
  PELETIZADO
  P-004: 800 kg pellets, 50 kg merma
       ↓
  VENTA
  Ticket V: 800 kg a Francisco
  
  RESUMEN:
  Entrada: 1,000 kg
  Salida: 800 kg
  Merma Total: 200 kg (20%)
  Eficiencia Global: 80%
  ```

---

## 🔢 CÁLCULOS AUTOMÁTICOS

### **Eficiencia**
```javascript
eficiencia = (outputPrincipal / totalInput) * 100
```

### **Porcentaje de Merma**
```javascript
porcentajeMerma = (outputMerma / totalInput) * 100
```

### **Horas de Trabajo**
```javascript
horasTrabajo = (fechaFin - fechaInicio) / (1000 * 60 * 60)
```

### **Productividad**
```javascript
productividad = outputPrincipal / horasTrabajo  // kg/hora
```

---

## 📊 REPORTES

### **Reporte por Proceso**

```
================================
CONTROL DE PRODUCCIÓN - PELETIZADO
================================

PERIODO: 01-04-2026 a 28-04-2026
TOTAL PROCESOS: 45

--------------------------------
RESUMEN EJECUTIVO
--------------------------------
Total Input: 45,000 kg
Total Output: 40,500 kg
Merma Total: 4,500 kg (10%)
Eficiencia Promedio: 90%

--------------------------------
DESGLOSE POR OPERADOR
--------------------------------
Christian:
  Procesos: 25
  Input: 25,000 kg
  Output: 22,750 kg
  Eficiencia: 91%

Jose:
  Procesos: 20
  Input: 20,000 kg
  Output: 17,750 kg
  Eficiencia: 88.75%

--------------------------------
DETALLE DE PROCESOS
--------------------------------
[Tabla completa]
```

---

## 🔗 TRAZABILIDAD COMPLETA

### **Función de Búsqueda**

```javascript
function buscarTrazabilidad(ticketInicial) {
    const cadena = [];
    
    // 1. Buscar entrada en Destaraje
    const entrada = buscarEnDestaraje(ticketInicial);
    if (entrada) cadena.push({
        etapa: 'ENTRADA',
        data: entrada
    });
    
    // 2. Buscar procesos que usen ese ticket
    const procesos = buscarProcesosConInput(ticketInicial);
    procesos.forEach(p => {
        cadena.push({
            etapa: PROCESOS[p.tipoProceso].nombre,
            data: p
        });
        
        // Recursivo: buscar procesos que usen el output de este
        const siguientes = buscarProcesosConInput(p.ticket);
        siguientes.forEach(s => cadena.push(...));
    });
    
    // 3. Buscar venta final
    const venta = buscarVenta(ticketFinal);
    if (venta) cadena.push({
        etapa: 'VENTA',
        data: venta
    });
    
    return cadena;
}
```

---

## 📁 ESTRUCTURA DE ARCHIVOS

```
eve-control-v2/
├── index.html (actualizar para agregar módulo)
├── js/
│   ├── control-produccion.js (NUEVO - 800+ líneas)
│   ├── config.js (agregar COLLECTION)
│   ├── utils.js
│   ├── modulos-comunes.js
│   └── ...
└── docs/
    └── control-produccion-arquitectura.md (este archivo)
```

---

## ⚙️ CONFIGURACIÓN NECESARIA

### **1. Agregar a config.js**

```javascript
const COLLECTIONS = {
    // ... existentes ...
    CONTROL_PRODUCCION: 'control_produccion'
};
```

### **2. Agregar a index.html**

```html
<!-- Nuevo tab -->
<button class="menu-btn" data-module="controlProduccion">
    🏭 Control Producción
</button>

<!-- Nuevo container -->
<div id="moduleControlProduccion" class="module-container"></div>

<!-- Script -->
<script src="js/control-produccion.js"></script>
```

### **3. Inicializar en main.js**

```javascript
case 'controlProduccion':
    loadControlProduccionModule();
    break;
```

---

## 🚀 IMPLEMENTACIÓN POR FASES

### **FASE 1: Estructura Básica** (2-3 horas)
- ✅ Formulario con tipos de proceso
- ✅ Inputs/Outputs dinámicos
- ✅ Cálculos automáticos
- ✅ Registro en Firebase

### **FASE 2: Visualización** (2-3 horas)
- ✅ Tabs (Hoy/Semana/Todos)
- ✅ Tablas con datos
- ✅ Filtros
- ✅ Estadísticas

### **FASE 3: Trazabilidad** (3-4 horas)
- ✅ Búsqueda por ticket
- ✅ Cadena completa de procesos
- ✅ Visualización gráfica
- ✅ Reporte de trazabilidad

### **FASE 4: Reportes y Optimización** (2-3 horas)
- ✅ Exportaciones TXT/PDF/CSV
- ✅ Gráficas de tendencias
- ✅ Dashboard de producción
- ✅ Alertas de eficiencia baja

**TIEMPO TOTAL ESTIMADO: 10-15 horas**

---

## 💡 BENEFICIOS

1. **Trazabilidad Completa:** Seguir un ticket desde que entra hasta que sale
2. **Control de Mermas:** Identificar qué proceso genera más pérdida
3. **Eficiencia por Operador:** Comparar productividad
4. **Productividad:** kg/hora por proceso
5. **Costos:** Base para agregar costos por etapa (futuro)
6. **Inventario Automático:** Saber exactamente qué hay en cada etapa
7. **Reportes Ejecutivos:** Tomar decisiones basadas en datos

---

## 🎯 SIGUIENTE PASO

¿Quieres que implemente:
1. **FASE 1 completa** (formulario + registro + cálculos)
2. **TODO EL MÓDULO** de una vez (archivo control-produccion.js completo de 800-1000 líneas)
3. **Por fases** (ir probando cada fase antes de continuar)

**Recomendación:** Opción 2 - crear el módulo completo ahora para que sea funcional de inmediato.

¿Continúo con la implementación completa?
