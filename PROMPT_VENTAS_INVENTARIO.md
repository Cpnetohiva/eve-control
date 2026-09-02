# PROMPT — MÓDULOS: VENTAS + RENDIMIENTOS + INVENTARIO + TRAZABILIDAD
# EVE Control v3.0 — EVERPLASTIC
# Complemento a PROMPT_MODULOS_NUEVOS.md

## CONTEXTO

Sistema EVE Control v3.0 ya tiene implementado:
- Destaraje, Producción, Pagos, Control de Producción
- Auditoría OCR, Lista de Precios, CxP, Comisiones históricas
- PWA / Modo offline

Se agregan 3 módulos nuevos que cierran el ciclo operativo completo:

```
DESTARAJE → RENDIMIENTOS/SUBPRODUCTOS → CONTROL PRODUCCIÓN
                                                ↓
                                           INVENTARIO
                                                ↓
                                            VENTAS
                                                ↓
                                         TRAZABILIDAD
```

---

## REGLAS GLOBALES (heredadas del sistema)

```
Fechas en UI:        dd/mm/aaaa
Fechas en Firebase:  YYYY-MM-DD
Funciones:           formatearFecha() / parsearFecha() en utils.js
Paleta:              --azul-marino: #001D3D | --oro: #FFC300
Tipografía:          DM Sans (UI) | JetBrains Mono (números)
Permisos:            por módulo, configurables desde Admin
```

---

## MÓDULO 1: VENTAS (`js/ventas.js`)

### Propósito
Registrar todas las salidas de producto terminado hacia clientes.
Reemplaza completamente el ticket "V" en Destaraje.

### Migración de datos históricos
```javascript
// Al activar el módulo, migrar registros de destaraje donde ticket === 'V'
// a la colección 'ventas' con la estructura nueva.
// Los registros migrados se marcan en destaraje como migrado: true
// NO se eliminan de destaraje para preservar histórico.
```

### Colección Firebase: `ventas`
```javascript
{
  folio: "V-2026-001",          // auto-generado: V-YYYY-NNN
  cliente: "FRANCISCO",
  fecha: "2026-08-30",
  lineas: [                      // array: permite múltiples productos por folio
    {
      material: "PACAS CRISTAL SIN ETIQUETA",
      cantidad: 21500,
      unidad: "KG",              // KG | PZ
      precioUnitario: 12.50,
      subtotal: 268750           // calculado: cantidad × precioUnitario
    },
    {
      material: "PACAS CRISTAL CON VERDE",
      cantidad: 2500,
      unidad: "KG",
      precioUnitario: 11.00,
      subtotal: 27500
    }
  ],
  totalVenta: 296250,            // suma de subtotales
  ticketsOrigen: ["9260","9251"], // opcional: trazabilidad
  observaciones: "",
  registradoPor: "Admin",
  fechaRegistro: "2026-08-30T..."
}
```

### Productos disponibles (lista maestra, editable desde Admin)
```javascript
const PRODUCTOS_VENTA = [
  // PACAS
  "PACAS CRISTAL SIN ETIQUETA",
  "PACAS CRISTAL CON VERDE",
  "PACAS CRISTAL CON ETIQUETA",
  "PACAS SUERO",
  "PACAS LECHERO",
  "PACAS MULTICOLOR",
  "PACAS POLIETILENO",
  "PACAS POLIPROPILENO",
  // MOLIDOS
  "LECHERO MOLIDO",
  "SUERO MOLIDO",
  "POLIPROPILENO MOLIDO",
  "POLIETILENO MOLIDO",
  // PELETIZADOS
  "LECHERO PELETIZADO",
  "POLIETILENO PELETIZADO",
  "POLIPROPILENO PELETIZADO",
  // PRODUCTOS TERMINADOS (Inyección/Soplado)
  "CAJA CO30",
  "CAJA CH25",
  "CAJA AGRO20",
  "TAMBO"
];

// Unidad por producto:
const UNIDAD_POR_PRODUCTO = {
  "CAJA CO30": "PZ",
  "CAJA CH25": "PZ",
  "CAJA AGRO20": "PZ",
  "TAMBO": "PZ",
  // Todo lo demás: "KG"
};
```

### UI del módulo

#### Formulario de nueva venta
```
┌─────────────────────────────────────────────────────┐
│ 🛒 NUEVA VENTA                                      │
├─────────────────────────────────────────────────────┤
│ Folio:    [V-2026-001] (auto)                       │
│ Cliente:  [FRANCISCO ▼] (autocompletado)            │
│ Fecha:    [30/08/2026]                              │
├─────────────────────────────────────────────────────┤
│ PRODUCTOS:                                          │
│                                                     │
│ Material: [PACAS CRISTAL SIN ETIQUETA ▼]            │
│ Cantidad: [21500    ] KG   Precio: [$12.50]         │
│ Subtotal: $268,750.00                    [🗑️]       │
│                                                     │
│ Material: [PACAS CRISTAL CON VERDE ▼]               │
│ Cantidad: [2500     ] KG   Precio: [$11.00]         │
│ Subtotal: $27,500.00                     [🗑️]       │
│                                                     │
│ [+ Agregar otro producto]                           │
├─────────────────────────────────────────────────────┤
│ TOTAL VENTA: $296,250.00                            │
├─────────────────────────────────────────────────────┤
│ Tickets origen: [9260, 9251] (opcional)             │
│ Observaciones: [___________]                        │
│                                                     │
│ [🎤 Dictar] [✅ Registrar Venta]                    │
└─────────────────────────────────────────────────────┘
```

#### Reglas UI
- Al seleccionar producto, la unidad (KG/PZ) se asigna automáticamente
- Subtotal = cantidad × precio (calculado en tiempo real)
- Total venta = suma de subtotales (calculado en tiempo real)
- Mínimo 1 línea de producto, máximo sin límite
- Cliente: dropdown dinámico desde ventas anteriores en Firebase

#### 3 Tabs de visualización
- **HOY:** ventas del día con total
- **ESTA SEMANA:** ventas de la semana con total
- **TODAS:** con filtros por cliente, material, fechas, rango de monto

#### Exportaciones
TXT / PDF / CSV / Telegram (incluir en reporte general)

#### Reconocimiento de voz
```
"Venta a Francisco, Pacas Cristal, 21500 kilos, a 12.50"
→ { cliente: "Francisco", material: "PACAS CRISTAL SIN ETIQUETA",
    cantidad: 21500, precioUnitario: 12.50 }
```

#### Permisos
```javascript
permissions: { ventas: true, ventas_precios: true }
// ventas: registrar ventas (sin ver precios si no tiene ventas_precios)
// ventas_precios: ver y editar precios de venta
```

---

## MÓDULO 2: RENDIMIENTOS Y SUBPRODUCTOS (`js/rendimientos.js`)

### Propósito
Definir y mantener la composición porcentual histórica de cada material
de entrada (lo que se obtiene al destarar/seleccionar un material).
Permite calcular automáticamente cuánto de cada subproducto se espera
obtener de un lote de material.

### Concepto clave: Tabla de composición por material

```
MATERIAL: MIXTO
Composición histórica:
  Cristal sin etiqueta   50%
  Lechero                10%
  Verde (cristal verde)  10%
  Multicolor             10%
  Suero                   5%
  Etiqueta               10%  ← merma (no vendible)
  Basura                  5%  ← merma (descarte)
  TOTAL                 100%
```

### Colección Firebase: `composiciones`
```javascript
{
  materialEntrada: "MIXTO",
  descripcion: "Composición estándar MIXTO",
  componentes: [
    {
      subproducto: "CRISTAL SIN ETIQUETA",
      porcentaje: 50,
      esMerma: false,
      procesosValidos: ["EMPACADO", "VENTA DIRECTA"],
      procesoSugerido: "EMPACADO"   // default más común, solo referencia
    },
    {
      subproducto: "LECHERO",
      porcentaje: 10,
      esMerma: false,
      procesosValidos: ["MOLIENDA", "LAVADO", "PELETIZADO", "VENTA DIRECTA"],
      procesoSugerido: "MOLIENDA"
    },
    {
      subproducto: "VERDE",
      porcentaje: 10,
      esMerma: false,
      procesosValidos: ["EMPACADO", "MOLIENDA", "VENTA DIRECTA"],
      procesoSugerido: "EMPACADO"
    },
    {
      subproducto: "MULTICOLOR",
      porcentaje: 10,
      esMerma: false,
      procesosValidos: ["MOLIENDA", "LAVADO", "PELETIZADO", "INYECCIÓN", "VENTA DIRECTA"],
      procesoSugerido: "MOLIENDA"
    },
    {
      subproducto: "SUERO",
      porcentaje: 5,
      esMerma: false,
      procesosValidos: ["MOLIENDA", "LAVADO", "VENTA DIRECTA"],
      procesoSugerido: "MOLIENDA"
    },
    {
      subproducto: "ETIQUETA",
      porcentaje: 10,
      esMerma: true,        // merma no aprovechable
      procesosValidos: [],
      procesoSugerido: null
    },
    {
      subproducto: "BASURA",
      porcentaje: 5,
      esMerma: true,
      procesosValidos: [],
      procesoSugerido: null
    }
  ],
  totalPorcentaje: 100,     // validación: siempre debe sumar 100
  version: 1,               // se incrementa al editar
  fechaVigencia: "2026-01-01",
  actualizadoPor: "Admin",
  fechaRegistro: "2026-08-30T..."
}
```

### Regla clave sobre procesoDestino
```
procesosValidos  → todos los procesos a los que PUEDE ir ese subproducto
procesoSugerido  → el más frecuente, solo como valor default en el formulario

El destino real se decide en Control de Producción al momento de registrar.
Al seleccionar un material de entrada en Control de Producción, el sistema
muestra SOLO los procesosValidos de ese subproducto como opciones del dropdown,
no todos los procesos del sistema.
```

### Historial de composiciones
Igual que precios: nunca se sobreescribe. Al actualizar:
1. Se cierra la versión anterior (fechaCierre = hoy)
2. Se crea versión nueva con fechaVigencia = hoy
3. El histórico queda completo para auditoría

### UI del módulo

#### Vista principal — lista de materiales con composición
```
┌─────────────────────────────────────────────────────┐
│ 📊 RENDIMIENTOS Y SUBPRODUCTOS                      │
│                      [+ Nueva Composición]          │
├───────────────────┬─────────────────────────────────┤
│ MIXTO             │ 7 componentes | v.3              │
│                   │ Actualizado: 15/06/2026          │
│                   │ [Ver] [Editar] [Historial]       │
├───────────────────┼─────────────────────────────────┤
│ PET               │ 3 componentes | v.1              │
│                   │ Actualizado: 01/01/2026          │
│                   │ [Ver] [Editar] [Historial]       │
├───────────────────┼─────────────────────────────────┤
│ MULTICOLOR        │ 5 componentes | v.2              │
│                   │ [Ver] [Editar] [Historial]       │
└───────────────────┴─────────────────────────────────┘
```

#### Modal edición de composición
```
┌──────────────────────────────────────────────────────────────────────┐
│ ✏️ EDITAR COMPOSICIÓN — MIXTO                                        │
├──────────────────────────────────────────────────────────────────────┤
│ Subproducto            %    Merma  Procesos válidos     Sugerido     │
│                                                                      │
│ [CRISTAL SIN ETIQ.] [50] [ ]  [☑EMPACADO ☑VENTA DIR.  [EMPACADO▼]🗑│
│                               ☐MOLIENDA ☐LAVADO]                    │
│                                                                      │
│ [LECHERO          ] [10] [ ]  [☑MOLIENDA ☑LAVADO       [MOLIENDA▼]🗑│
│                               ☑PELETIZADO ☑VENTA DIR.               │
│                               ☐EMPACADO ☐INYECCIÓN]                 │
│                                                                      │
│ [VERDE            ] [10] [ ]  [☑EMPACADO ☑MOLIENDA     [EMPACADO▼]🗑│
│                               ☑VENTA DIR. ☐LAVADO]                  │
│                                                                      │
│ [MULTICOLOR       ] [10] [ ]  [☑MOLIENDA ☑LAVADO       [MOLIENDA▼]🗑│
│                               ☑PELETIZADO ☑INYECCIÓN                │
│                               ☑VENTA DIR. ☐SOPLADO]                 │
│                                                                      │
│ [SUERO            ] [ 5] [ ]  [☑MOLIENDA ☑LAVADO       [MOLIENDA▼]🗑│
│                               ☑VENTA DIR. ☐PELETIZADO]              │
│                                                                      │
│ [ETIQUETA         ] [10] [✓]  (merma — sin proceso)              🗑 │
│ [BASURA           ] [ 5] [✓]  (merma — sin proceso)              🗑 │
│                                                                      │
│ [+ Agregar componente]                                               │
├──────────────────────────────────────────────────────────────────────┤
│ Total: 100% ✅  (⚠️ debe sumar exactamente 100%)                     │
├──────────────────────────────────────────────────────────────────────┤
│ Motivo del ajuste: [___________________________]                     │
│                                                                      │
│ [Cancelar]  [💾 Guardar nueva versión]                               │
└──────────────────────────────────────────────────────────────────────┘
```

**Regla UI:** Al marcar "Merma" se ocultan los checkboxes de procesos válidos
y el dropdown de sugerido. Solo los subproductos no-merma tienen destinos.

#### Simulador de lote
```
┌─────────────────────────────────────────────────────┐
│ 🔢 SIMULADOR                                        │
│ Material: [MIXTO ▼]  Cantidad: [10,000] KG          │
├─────────────────────────────────────────────────────┤
│ Subproducto             Estimado    Tipo             │
│ Cristal sin etiqueta    5,000 kg    Aprovechable     │
│ Lechero                 1,000 kg    Aprovechable     │
│ Verde                   1,000 kg    Aprovechable     │
│ Multicolor              1,000 kg    Aprovechable     │
│ Suero                     500 kg    Aprovechable     │
│ Etiqueta                1,000 kg    Merma            │
│ Basura                    500 kg    Merma            │
├─────────────────────────────────────────────────────┤
│ Total aprovechable:     8,500 kg (85%)              │
│ Total merma:            1,500 kg (15%)              │
└─────────────────────────────────────────────────────┘
```

#### Permisos
```javascript
permissions: {
  rendimientos: true,        // ver composiciones y simulador
  rendimientos_editar: true  // editar composiciones (supervisor/admin)
}
```

---

## MÓDULO 3: INVENTARIO (`js/inventario.js`)

### Propósito
Control en tiempo real del material disponible en cada etapa del proceso.
Se calcula automáticamente cruzando Destaraje + Control de Producción + Ventas,
con capacidad de ajuste manual por Admin con justificación obligatoria.

### Cómo se calcula el inventario (automático)

```javascript
// Para cada material y etapa:
inventario[material][etapa] =
  entradas(material, etapa)     // lo que llegó a esa etapa
  - salidas(material, etapa)    // lo que salió (a otra etapa o venta)
  - mermas(material, etapa)     // merma registrada en Control Producción
  + ajustes(material, etapa)    // ajustes manuales de Admin

// Fuentes de datos:
// Destaraje → genera inventario en etapa "RECEPCIÓN"
// Control Producción → mueve material entre etapas, registra mermas
// Ventas → reduce inventario de la etapa final correspondiente
```

### Etapas del inventario
```javascript
const ETAPAS_INVENTARIO = [
  "RECEPCIÓN",      // material recibido en Destaraje, sin procesar
  "SELECCIÓN",      // en proceso o pendiente de selección
  "EMPACADO",       // material empacado (pacas listas)
  "MOLIENDA",       // en proceso o pendiente de molienda
  "LAVADO",         // en proceso o pendiente de lavado
  "MEZCLADO",       // en proceso de mezcla
  "PELETIZADO",     // en proceso o listo como pellets
  "INYECCIÓN",      // en proceso de inyección
  "SOPLADO",        // en proceso de soplado
  "PRODUCTO TERMINADO", // listo para venta
  "VENDIDO"         // ya vendido (histórico)
];
```

### Colección Firebase: `inventario`
```javascript
// Un documento por material+etapa
{
  material: "LECHERO",
  etapa: "MOLIENDA",
  cantidadCalculada: 850,   // calculada automáticamente
  cantidadReal: 830,        // después de ajustes manuales
  unidad: "KG",
  ultimaActualizacion: "2026-08-30T...",
  ajustes: [                // historial de ajustes manuales
    {
      fecha: "2026-08-28",
      cantidadAntes: 870,
      cantidadDespues: 830,
      diferencia: -40,
      motivo: "Merma por humedad en almacén",
      ajustadoPor: "Admin"
    }
  ]
}
```

### UI del módulo

#### Vista principal — tabla de inventario
```
┌─────────────────────────────────────────────────────────────────────┐
│ 📦 INVENTARIO EN TIEMPO REAL          [🔄 Actualizar] [⚙️ Ajustar] │
│ Última actualización: 30/08/2026 14:32                              │
├──────────────────────┬────────────┬───────────┬────────────────────┤
│ Material             │ Etapa      │ Cantidad  │ Estado             │
├──────────────────────┼────────────┼───────────┼────────────────────┤
│ MIXTO                │ RECEPCIÓN  │ 2,400 kg  │ 🟡 Pendiente proc. │
│ CRISTAL              │ EMPACADO   │   800 kg  │ 🟢 Listo venta     │
│ LECHERO              │ MOLIENDA   │   600 kg  │ 🔵 En proceso      │
│ LECHERO MOLIDO       │ LAVADO     │   400 kg  │ 🔵 En proceso      │
│ MULTICOLOR           │ MOLIENDA   │   350 kg  │ 🟡 Pendiente       │
│ PELLETS LECHERO      │ PROD. TERM.│ 1,200 kg  │ 🟢 Listo venta     │
│ SUERO                │ MOLIENDA   │   200 kg  │ 🔵 En proceso      │
├──────────────────────┴────────────┴───────────┴────────────────────┤
│ RESUMEN:                                                            │
│ Total en planta:     5,950 kg                                       │
│ Listo para venta:    2,000 kg                                       │
│ En proceso:          1,600 kg                                       │
│ Pendiente procesar:  2,350 kg                                       │
└─────────────────────────────────────────────────────────────────────┘
```

#### Colores de estado
```
🟢 Verde  → PRODUCTO TERMINADO / listo para venta
🔵 Azul   → en proceso activo (hay registro abierto en Control Producción)
🟡 Amarillo → en RECEPCIÓN o pendiente de asignación a proceso
🔴 Rojo   → inventario negativo (error de captura, requiere ajuste)
```

#### Modal de ajuste manual (solo Admin)
```
┌─────────────────────────────────────────────────────┐
│ ⚙️ AJUSTE MANUAL DE INVENTARIO                      │
├─────────────────────────────────────────────────────┤
│ Material: [LECHERO          ▼]                      │
│ Etapa:    [MOLIENDA         ▼]                      │
│                                                     │
│ Cantidad actual (calculada): 850 kg                 │
│ Cantidad real (física):      [830    ] kg           │
│ Diferencia:                   -20 kg                │
│                                                     │
│ Motivo (obligatorio):                               │
│ [Merma por humedad en almacén durante fin de semana]│
│                                                     │
│ ⚠️ Este ajuste queda registrado con tu usuario      │
│    y fecha. No se puede deshacer.                   │
│                                                     │
│ [Cancelar]  [⚙️ Aplicar Ajuste]                    │
└─────────────────────────────────────────────────────┘
```

#### Historial de ajustes (por material)
```
HISTORIAL DE AJUSTES — LECHERO / MOLIENDA

Fecha       Antes    Después  Diferencia  Motivo              Usuario
28/08/2026  870 kg   830 kg   -40 kg      Merma por humedad   Admin
15/08/2026  920 kg   870 kg   -50 kg      Diferencia física   Admin
```

#### Permisos
```javascript
permissions: {
  inventario: true,          // ver inventario
  inventario_ajuste: true    // hacer ajustes manuales (solo Admin)
}
```

---

## TRAZABILIDAD COMPLETA (integración entre módulos)

### Concepto
La trazabilidad no es un módulo separado — es una vista transversal
que cruza Destaraje + Rendimientos + Control Producción + Inventario + Ventas.

### Vista de trazabilidad por ticket

```
TICKET 9260 — JOSE ENRIQUE — MIXTO — 650 kg — 23/04/2026

📥 RECEPCIÓN
   650 kg MIXTO → Destaraje 23/04/2026

🔍 SELECCIÓN (según composición MIXTO v.3)
   ├─ 325 kg CRISTAL SIN ETIQUETA → EMPACADO
   ├─  65 kg LECHERO               → MOLIENDA
   ├─  65 kg VERDE                 → EMPACADO
   ├─  65 kg MULTICOLOR            → MOLIENDA
   ├─  32 kg SUERO                 → MOLIENDA
   ├─  65 kg ETIQUETA              → MERMA
   └─  33 kg BASURA                → MERMA
   Proceso: P-001 | Operador: Christian | 24/04/2026
   Eficiencia: 85% (merma real 15%)

📦 EMPACADO (Cristal + Verde)
   390 kg → PACAS CRISTAL CON VERDE
   Proceso: P-002 | Operador: Christian | 24/04/2026

⚙️ MOLIENDA (Lechero + Multicolor + Suero)
   162 kg → MATERIAL MOLIDO MIXTO
   Merma: 12 kg (7.4%)
   Proceso: P-003 | Operador: Jose | 25/04/2026

💧 LAVADO
   150 kg → MATERIAL LAVADO
   Merma: 8 kg (5.3%)
   Proceso: P-004 | Operador: Christian | 25/04/2026

🔵 PELETIZADO
   142 kg → PELLETS
   Merma: 6 kg (4.2%)
   Proceso: P-005 | Operador: Christian | 25/04/2026

🛒 VENTA
   ├─ 390 kg PACAS CRISTAL CON VERDE → Francisco | V-2026-012 | $11.00/kg
   └─ 136 kg PELLETS → Exportación   | V-2026-015 | $18.00/kg
   Pendiente: 6 kg (pellets sin vender)

📊 RESUMEN GLOBAL TICKET 9260
   Entrada:           650 kg
   Vendido:           526 kg (80.9%)
   Merma total:        98 kg (15.1%)
   En inventario:       6 kg ( 0.9%)  ← pellets sin vender
   Ingreso generado:  $6,768.00
   Costo material:    $6,890.00 (CxP)
   Margen:            ($122.00)  ← negativo este ticket
```

### Búsqueda de trazabilidad

```
┌─────────────────────────────────────────────────────┐
│ 🔍 TRAZABILIDAD                                     │
├─────────────────────────────────────────────────────┤
│ Buscar por:                                         │
│ [Ticket ▼]  [9260          ]  [🔍 Buscar]          │
│                                                     │
│ O buscar por:                                       │
│ Proveedor: [JOSE ENRIQUE ▼]  Período: [semana ▼]   │
│ Material:  [MIXTO        ▼]                        │
│ Proceso:   [PELETIZADO   ▼]                        │
│ Folio venta: [V-2026-012 ]                         │
└─────────────────────────────────────────────────────┘
```

---

## REPORTES DE RENDIMIENTO

### Reporte 1 — Rendimiento por material (período)
```
RENDIMIENTO — MIXTO
Período: 01/08/2026 al 30/08/2026

Entrada total:    45,000 kg (28 tickets)

SUBPRODUCTOS OBTENIDOS:
  Cristal         22,050 kg  49.0%  (esperado 50.0%)  -1.0%
  Lechero          4,600 kg  10.2%  (esperado 10.0%)  +0.2%
  Verde            4,400 kg   9.8%  (esperado 10.0%)  -0.2%
  Multicolor       4,500 kg  10.0%  (esperado 10.0%)   0.0%
  Suero            2,200 kg   4.9%  (esperado  5.0%)  -0.1%
  Etiqueta         4,700 kg  10.4%  (esperado 10.0%)  +0.4%
  Basura           2,550 kg   5.7%  (esperado  5.0%)  +0.7%

Aprovechamiento real:   84.4%  (esperado 85.0%)
```

### Reporte 2 — Rendimiento por operador (período)
```
RENDIMIENTO POR OPERADOR — Agosto 2026

Operador    Procesos  Entrada    Salida    Eficiencia  vs. Meta
Christian   45        18,500 kg  16,835 kg  91.0%      +1.0%
Jose        38        15,200 kg  13,528 kg  89.0%      -1.0%
```

### Reporte 3 — Rendimiento por ticket
Ver trazabilidad completa de un ticket específico (vista descrita arriba).

---

## NUEVAS COLECCIONES FIREBASE

```
ventas           → registros de venta (reemplaza ticket V en destaraje)
composiciones    → tabla de rendimientos por material con histórico
inventario       → stock por material y etapa con ajustes
```

## NUEVAS COLECCIONES EN config.js / COLLECTIONS

```javascript
VENTAS: 'ventas',
COMPOSICIONES: 'composiciones',
INVENTARIO: 'inventario'
```

## NUEVOS PERMISOS

```javascript
permissions: {
  ventas: true,
  ventas_precios: true,
  rendimientos: true,
  rendimientos_editar: true,
  inventario: true,
  inventario_ajuste: true   // solo Admin
}
```

## CARGA EN auth.js (cargarDatosEnParalelo)

```javascript
const [
  // ...existentes...
  ventas,
  composiciones,
  inventario
] = await Promise.all([
  // ...existentes...
  cargarDatos(COLLECTIONS.VENTAS),
  cargarDatos(COLLECTIONS.COMPOSICIONES),
  cargarDatos(COLLECTIONS.INVENTARIO)
]);

window.EVE.ventas = ventas;
window.EVE.composiciones = composiciones;
window.EVE.inventario = inventario;
```

## OFFLINE CACHE (offline.js)

Agregar a guardarCacheDatos() y cargarCacheDatos():
```javascript
'ventas', 'composiciones', 'inventario'
```

---

## ORDEN DE IMPLEMENTACIÓN

```
1. js/ventas.js + colección 'ventas'
   → Migrar registros V de destaraje
   → CRUD + UI completa

2. js/rendimientos.js + colección 'composiciones'
   → Tabla de composición por material
   → Historial de versiones
   → Simulador de lote

3. js/inventario.js + colección 'inventario'
   → Cálculo automático cruzando colecciones existentes
   → Ajustes manuales con historial
   → Vista por material y etapa

4. Vista de trazabilidad
   → Puede ser tab dentro de inventario.js o módulo propio
   → Cruza todas las colecciones para mostrar cadena completa

5. Reportes de rendimiento
   → Agregar a reportes.js o crear js/reportes-rendimiento.js
   → 3 tipos: por material, por operador, por ticket
```

---

## CHECKLIST

### Ventas
- [ ] CRUD con múltiples líneas por folio
- [ ] Folio auto-generado V-YYYY-NNN
- [ ] Unidad automática KG/PZ por producto
- [ ] Totales calculados en tiempo real
- [ ] Migración de registros V de destaraje
- [ ] 3 tabs con estadísticas
- [ ] Filtros y exportaciones TXT/PDF/CSV
- [ ] Reconocimiento de voz
- [ ] Incluido en reportes generales y Telegram

### Rendimientos y Subproductos
- [ ] CRUD de composiciones por material
- [ ] Historial de versiones (nunca sobreescribir)
- [ ] Validación: suma siempre = 100%
- [ ] Motivo obligatorio al editar
- [ ] Simulador de lote
- [ ] Permisos: ver vs. editar separados

### Inventario
- [ ] Cálculo automático desde Destaraje+CtrlProd+Ventas
- [ ] Vista por material y etapa con colores de estado
- [ ] Ajuste manual solo Admin con motivo obligatorio
- [ ] Historial de ajustes por material
- [ ] Inventario negativo marcado en rojo como error
- [ ] Resumen total en planta / listo / en proceso

### Trazabilidad
- [ ] Búsqueda por ticket, proveedor, material, proceso, folio venta
- [ ] Cadena completa: Destaraje → Procesos → Venta
- [ ] Merma identificada en cada etapa
- [ ] Resumen global por ticket (entrada/vendido/merma/inventario/margen)
- [ ] Exportable a PDF

### Reportes de rendimiento
- [ ] Por material vs. composición histórica esperada
- [ ] Por operador con eficiencia vs. meta
- [ ] Por ticket (trazabilidad completa)
- [ ] Integrados en módulo Reportes con selector y filtros

---

## NOTA SOBRE DATOS HISTÓRICOS

No se cargarán datos históricos en esta fase. El sistema arranca
con datos desde la fecha de activación. Los registros de prueba
existentes en Firestore (ticket 99999, precio MIXTO, auditoría y CxP
de prueba) permanecen como referencia de que el sistema funciona.

Lee primero todos los archivos existentes del proyecto para entender
lo que ya está implementado. Comienza con el Paso 1: Ventas.
Confirma al terminar cada módulo antes de continuar al siguiente.
