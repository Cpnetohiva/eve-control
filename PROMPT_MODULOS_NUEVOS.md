# PROMPT — MÓDULOS NUEVOS: AUDITORÍA + PRECIOS + CxP
# EVE Control v3.0 — EVERPLASTIC

## CONTEXTO

Estás trabajando en EVE Control v3.0 para EVERPLASTIC (Mehicaso Group).
El sistema ya tiene implementados los módulos base: Destaraje, Producción,
Pagos, Control de Producción, Reportes y Admin.

### ⚠️ REGLA GLOBAL DE FECHAS — OBLIGATORIA

En la UI siempre mostrar fechas como dd/mm/aaaa (28/04/2026).
En Firebase y JavaScript interno usar YYYY-MM-DD (2026-04-28).

Funciones requeridas en utils.js:
  formatearFecha("2026-04-28")  →  "28/04/2026"  // para mostrar
  parsearFecha("28/04/2026")    →  "2026-04-28"  // para guardar

Aplicar en tablas, modales, reportes, OCR, historial precios y CxP.

---

Firebase Project ID: `everplastic`
Colecciones existentes: users, destaraje, produccion, pagos,
ministraciones, control_produccion

Ahora se agregan 3 módulos nuevos que trabajan en cadena:

```
AUDITORÍA DE TICKETS (OCR)
        ↓
LISTA DE PRECIOS (histórico por fecha)
        ↓
CUENTAS POR PAGAR (CxP)
```

---

## MÓDULO 1: AUDITORÍA DE TICKETS (`js/auditoria.js`)

### Propósito
Comparar lo que dice físicamente un ticket físico (via foto + OCR)
contra lo que está capturado en Destaraje. Detectar diferencias
antes de generar cuentas por pagar.

### Flujo completo

```
1. Usuario sube varias fotos a la vez (múltiple selección)
2. Por cada foto:
   a. OCR lee el número de ticket (dato grande/prominente del ticket)
   b. Con ese número, busca el registro en window.EVE.registrosDestaraje
   c. OCR intenta leer del cuerpo del ticket: Proveedor, Material,
      Peso Neto, Fecha de Entrada
   d. Compara cada campo leído vs el registro de Destaraje
   e. Asigna resultado al ticket
3. Muestra resumen del lote completo
```

### Implementación OCR

Usar **Tesseract.js** (CDN, no requiere backend):
```html
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"></script>
```

Estrategia de lectura:
```javascript
// Para cada imagen:
const result = await Tesseract.recognize(imagenFile, 'spa', {
  logger: m => actualizarProgreso(m)
});
const textoCompleto = result.data.text;

// 1. Extraer número de ticket:
//    Buscar el número más prominente (usualmente el más grande
//    o el que sigue a "TICKET", "FOLIO", "#", o está solo en una línea)
//    Regex: /(?:ticket|folio|#|no\.?)[\s:]*(\d+)/i
//    O simplemente el primer número de 4+ dígitos encontrado

// 2. Extraer campos del cuerpo:
//    Proveedor: línea que sigue a "PROVEEDOR:", "NOMBRE:", "DE:"
//    Material:  línea que sigue a "MATERIAL:", "PRODUCTO:", "DESCRIPCION:"
//    Peso:      número que sigue a "PESO", "KG", "NETO", "BRUTO"
//    Fecha:     patrón de fecha DD/MM/YYYY o DD-MM-YYYY

// IMPORTANTE: marcar confianza baja si:
//    - El campo no se encontró
//    - El valor extraído parece inválido (ej. peso = 0 o negativo)
//    - La imagen tiene baja calidad (score < 60 en Tesseract)
```

### Estados de resultado por ticket

```javascript
// COINCIDE: todos los campos leídos con confianza coinciden con Destaraje
// CON_DIFERENCIAS: al menos un campo difiere (con confianza alta)
// NO_VERIFICADO: OCR no pudo leer algún campo con suficiente confianza
// SIN_REGISTRO: el número de ticket no existe en registrosDestaraje
```

### Comparación de campos

```javascript
function compararCampos(leido, registrado) {
  // Proveedor: comparar ignorando mayúsculas/minúsculas y acentos
  // Material: comparar ignorando mayúsculas/minúsculas
  // Peso: diferencia permitida ±2% (variación por tara del vehículo)
  // Fecha: comparar exacto (YYYY-MM-DD)
}
```

### UI del módulo

#### Panel de carga
```
┌─────────────────────────────────────────────────────┐
│ 📷 AUDITORÍA DE TICKETS                             │
├─────────────────────────────────────────────────────┤
│                                                     │
│   [📂 Seleccionar fotos del lote]                   │
│   Puedes seleccionar varias fotos a la vez          │
│                                                     │
│   Formatos: JPG, PNG, HEIC (fotos de celular)       │
│                                                     │
│   [🔍 Iniciar Auditoría]                            │
└─────────────────────────────────────────────────────┘
```

#### Progreso mientras procesa
```
┌─────────────────────────────────────────────────────┐
│ Procesando foto 3 de 8...                           │
│ ████████████░░░░░░░░ 37%                            │
│ Leyendo: ticket_9260.jpg                            │
└─────────────────────────────────────────────────────┘
```

#### Resultado por ticket
```
┌─────────────────────────────────────────────────────┐
│ ✅ TICKET 9260 — COINCIDE                           │
├──────────────┬──────────────┬───────────────────────┤
│ Campo        │ Foto (OCR)   │ Sistema (Destaraje)   │
├──────────────┼──────────────┼───────────────────────┤
│ Proveedor    │ Jose Enrique │ JOSE ENRIQUE     ✅   │
│ Material     │ Mixto        │ MIXTO            ✅   │
│ Peso         │ 650 kg       │ 650 kg           ✅   │
│ Fecha        │ 23/04/2026   │ 2026-04-23       ✅   │
└──────────────┴──────────────┴───────────────────────┘

┌─────────────────────────────────────────────────────┐
│ ⚠️ TICKET 9251 — CON DIFERENCIAS                   │
├──────────────┬──────────────┬───────────────────────┤
│ Campo        │ Foto (OCR)   │ Sistema (Destaraje)   │
├──────────────┼──────────────┼───────────────────────┤
│ Proveedor    │ Jose Enrique │ JOSE ENRIQUE     ✅   │
│ Material     │ Mixto        │ MIXTO            ✅   │
│ Peso         │ 770 kg       │ 750 kg           ❌   │
│ Fecha        │ 23/04/2026   │ 2026-04-23       ✅   │
├─────────────────────────────────────────────────────┤
│ Diferencia en Peso: foto=770kg, sistema=750kg       │
│ [✏️ Corregir registro en Destaraje]                 │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ ❓ TICKET 9252 — NO SE PUDO VERIFICAR DEL TODO      │
├──────────────┬──────────────┬───────────────────────┤
│ Campo        │ Foto (OCR)   │ Sistema (Destaraje)   │
├──────────────┼──────────────┼───────────────────────┤
│ Proveedor    │ ?            │ Juana                 │
│ Material     │ PET          │ PET              ✅   │
│ Peso         │ ?            │ 1000 kg               │
│ Fecha        │ 23/04/2026   │ 2026-04-23       ✅   │
├─────────────────────────────────────────────────────┤
│ ⚠️ OCR no pudo leer con confianza: Proveedor, Peso  │
│ Foto de baja calidad o campo ilegible               │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ ❌ TICKET 9999 — SIN REGISTRO EN SISTEMA            │
├─────────────────────────────────────────────────────┤
│ El ticket 9999 no existe en Destaraje               │
│ [➕ Crear registro en Destaraje]                    │
└─────────────────────────────────────────────────────┘
```

#### Resumen del lote
```
┌─────────────────────────────────────────────────────┐
│ 📊 RESUMEN DEL LOTE (8 fotos)                       │
├─────────────────────────────────────────────────────┤
│ ✅ Coinciden:          5 tickets                    │
│ ⚠️ Con diferencias:   1 ticket                     │
│ ❓ No verificados:    1 ticket                     │
│ ❌ Sin registro:       1 ticket                     │
├─────────────────────────────────────────────────────┤
│ [💰 Generar CxP de tickets COINCIDEN]               │
│ Solo los 5 tickets que coinciden generarán CxP.     │
│ Resuelve las diferencias primero para incluirlos.   │
└─────────────────────────────────────────────────────┘
```

### Colección Firebase: `auditorias`
```javascript
{
  fecha: "2026-04-28",
  totalFotos: 8,
  resultados: [
    {
      ticket: "9260",
      estado: "COINCIDE",       // COINCIDE | CON_DIFERENCIAS | NO_VERIFICADO | SIN_REGISTRO
      camposLeidos: { proveedor, material, peso, fecha },
      camposSistema: { proveedor, material, kg, fechaEntrada },
      diferencias: [],          // array vacío si coincide
      imagenNombre: "ticket_9260.jpg"
    },
    {
      ticket: "9251",
      estado: "CON_DIFERENCIAS",
      diferencias: [
        { campo: "peso", valorFoto: 770, valorSistema: 750 }
      ]
    }
  ],
  creadoPor: "Admin",
  fechaRegistro: "2026-04-28T..."
}
```

### Permisos
```javascript
permissions: { auditoria: true }
// Solo Admin y supervisores
```

---

## MÓDULO 2: LISTA DE PRECIOS (`js/precios.js`)

### Propósito
Mantener un histórico de precios por material que permita saber
exactamente qué precio aplicaba en cualquier fecha pasada o presente.

### Regla de negocio fundamental
```
Un precio NUNCA se sobreescribe.
Cuando cambia el precio de un material:
  1. Se cierra el período anterior (fechaFin = hoy - 1 día)
  2. Se crea un nuevo registro con fechaInicio = hoy y fechaFin = null
  3. El histórico completo queda preservado

Para obtener el precio de un ticket:
  Buscar el registro donde:
  material === ticket.material
  AND fechaInicio <= ticket.fechaEntrada
  AND (fechaFin === null OR fechaFin >= ticket.fechaEntrada)
```

### Colección Firebase: `precios`
```javascript
{
  material: "MIXTO",
  precio: 10.50,              // precio por KG
  fechaInicio: "2026-04-21", // vigente desde (inclusive)
  fechaFin: null,             // null = vigente actualmente
                              // "2026-04-20" = cerrado ese día
  notas: "Ajuste por mercado",
  creadoPor: "Admin",
  fechaRegistro: "2026-04-21T..."
}
```

### Función central (en `utils.js`)
```javascript
async function obtenerPrecioVigente(material, fecha) {
  // Busca en window.EVE.precios el registro que:
  // - material coincide (case insensitive)
  // - fechaInicio <= fecha
  // - fechaFin === null OR fechaFin >= fecha
  // Retorna: { precio, fechaInicio, fechaFin } o null si no hay precio
}
```

### UI del módulo

#### Vista principal
```
┌─────────────────────────────────────────────────────┐
│ 💲 LISTA DE PRECIOS                                 │
│                          [+ Nuevo Precio]           │
├─────────────────────────────────────────────────────┤
│ PRECIOS VIGENTES HOY (28/04/2026)                   │
├──────────────────┬──────────────┬───────────────────┤
│ Material         │ Precio/KG    │ Vigente Desde      │
├──────────────────┼──────────────┼───────────────────┤
│ MIXTO            │ $10.50       │ 21/04/2026         │
│ MIXTO 2          │ $9.80        │ 01/04/2026         │
│ PET              │ $8.50        │ 01/01/2026         │
│ MULTICOLOR       │ $7.00        │ 15/03/2026         │
│ PELETIZADO       │ $15.00       │ 01/04/2026         │
│ LECHERO LAVADO   │ $13.50       │ 01/04/2026         │
└──────────────────┴──────────────┴───────────────────┘

  [📋 Ver Historial Completo]
```

#### Modal nuevo precio / actualizar precio
```
┌─────────────────────────────────────────────────────┐
│ 💲 ACTUALIZAR PRECIO                                │
├─────────────────────────────────────────────────────┤
│ Material:   [MIXTO ▼]                               │
│ Nuevo Precio/KG: [$10.50]                           │
│ Vigente desde:   [2026-04-28] (default: hoy)        │
│ Notas:      [Ajuste semanal]                        │
│                                                     │
│ ⚠️ El precio anterior ($10.00) quedará cerrado      │
│    al 27/04/2026                                    │
│                                                     │
│ [Cancelar] [💾 Guardar Precio]                      │
└─────────────────────────────────────────────────────┘
```

#### Vista historial por material
```
HISTORIAL DE PRECIOS — MIXTO

  Período                    Precio    Duración
  21/04/2026 → hoy          $10.50   8 días (actual)
  01/04/2026 → 20/04/2026  $10.00   20 días
  15/02/2026 → 31/03/2026  $9.80    45 días
  01/01/2026 → 14/02/2026  $9.50    45 días
```

### Materiales con precio inicial (semilla)
```javascript
// Al no encontrar precio para un material, mostrar:
// "⚠️ Sin precio registrado para MIXTO.
//  Agrega el precio en Lista de Precios antes de generar CxP."
```

---

## MÓDULO 3: CUENTAS POR PAGAR (`js/cxp.js`)

### Propósito
Llevar el control exacto de lo que se debe pagar a cada proveedor,
basado en tickets auditados y precios históricos. Registrar pagos
y mantener el saldo actualizado.

### Colección Firebase: `cuentas_por_pagar`
```javascript
{
  ticket: "9260",
  proveedor: "JOSE ENRIQUE",
  material: "MIXTO",
  kg: 650,
  fechaTicket: "2026-04-23",    // fechaEntrada del ticket en Destaraje
  precioAplicado: 10.50,         // precio vigente a esa fecha (histórico)
  total: 6825,                   // kg × precioAplicado (calculado al crear)
  pagado: 6500,                  // suma de todos los abonos
  saldo: 325,                    // total - pagado
  estado: "parcial",             // pendiente | parcial | liquidado
  origenAuditoria: true,         // true = vino de auditoría verificada
  idAuditoria: "abc123",         // referencia al documento en 'auditorias'
  abonos: [                      // historial de pagos parciales
    {
      monto: 6500,
      fecha: "2026-04-24",
      referencia: "Efectivo",    // Efectivo | Transferencia | Cheque
      registradoPor: "Admin"
    }
  ],
  fechaCreacion: "2026-04-28T...",
  creadoPor: "Admin"
}
```

### Generación automática desde Auditoría

Cuando el usuario hace click en "Generar CxP" desde el resumen de auditoría:

```javascript
async function generarCxPDesdeAuditoria(resultadosAuditoria) {
  const ticketsCoinciden = resultadosAuditoria.filter(r => r.estado === 'COINCIDE');

  for (const resultado of ticketsCoinciden) {
    // 1. Obtener registro de Destaraje
    const registro = window.EVE.registrosDestaraje
      .find(d => d.ticket === resultado.ticket);

    // 2. Obtener precio vigente a la fecha del ticket
    const precioInfo = await obtenerPrecioVigente(
      registro.material,
      registro.fechaEntrada
    );

    if (!precioInfo) {
      // Avisar: "Sin precio para MIXTO al 23-04-2026. Agrégalo en Lista de Precios."
      continue;
    }

    // 3. Verificar que no exista ya CxP para este ticket
    const yaExiste = window.EVE.cuentasPorPagar
      .find(c => c.ticket === resultado.ticket);
    if (yaExiste) continue; // No duplicar

    // 4. Crear CxP
    const cxp = {
      ticket: registro.ticket,
      proveedor: registro.proveedor,
      material: registro.material,
      kg: registro.kg,
      fechaTicket: registro.fechaEntrada,
      precioAplicado: precioInfo.precio,
      total: registro.kg * precioInfo.precio,
      pagado: 0,
      saldo: registro.kg * precioInfo.precio,
      estado: 'pendiente',
      origenAuditoria: true,
      abonos: []
    };

    await guardarDato('cuentas_por_pagar', cxp);
  }
}
```

### UI del módulo — Vistas

#### Vista 1: Por Proveedor (default)
```
┌─────────────────────────────────────────────────────┐
│ 💰 CUENTAS POR PAGAR                               │
│ Semana: 21-27 de abril 2026       [Filtros ▼]      │
├─────────────────────────────────────────────────────┤
│                                                     │
│ JOSE ENRIQUE                          [Ver detalle] │
│ ├─ Total semana:    $21,315.00                      │
│ ├─ Pagado:          $15,000.00                      │
│ └─ Saldo:            $6,315.00  🔴                  │
│                                                     │
│ JUANA                                 [Ver detalle] │
│ ├─ Total semana:    $14,280.00                      │
│ ├─ Pagado:          $14,280.00                      │
│ └─ Saldo:                $0.00  ✅                  │
│                                                     │
│ FRANCISCO                             [Ver detalle] │
│ ├─ Total semana:     $8,400.00                      │
│ ├─ Pagado:               $0.00                      │
│ └─ Saldo:            $8,400.00  🔴                  │
│                                                     │
├─────────────────────────────────────────────────────┤
│ TOTALES SEMANA                                      │
│ Por pagar:  $43,995.00                              │
│ Pagado:     $29,280.00                              │
│ Saldo:      $14,715.00                              │
└─────────────────────────────────────────────────────┘
```

#### Vista 2: Detalle por proveedor
```
JOSE ENRIQUE — Semana 21-27 abril 2026

Ticket  Material  Kg    Precio   Total      Pagado   Saldo    Estado
9260    MIXTO     650   $10.50   $6,825     $6,500   $325     Parcial [💳]
9251    MIXTO     920   $10.50   $9,660     $8,500   $1,160   Parcial [💳]
9264    MIXTO     980   $10.50   $10,290    $0       $10,290  Pendiente [💳]
9279    PET       1200  $8.50    $10,200    $0       $10,200  Pendiente [💳]

                         Total:  $36,975    $15,000  $21,975

[💳 Registrar pago a Jose Enrique]
```

#### Modal: Registrar abono
```
┌─────────────────────────────────────────────────────┐
│ 💳 REGISTRAR PAGO                                   │
│ Proveedor: JOSE ENRIQUE                             │
├─────────────────────────────────────────────────────┤
│ Ticket específico: [9260 ▼] o [Pago general]        │
│ Monto:    [$6,500.00]                               │
│ Fecha:    [24/04/2026]                              │
│ Referencia: [Efectivo ▼]                            │
│                                                     │
│ ⚠️ Pago general: se distribuye proporcionalmente    │
│    entre los tickets pendientes del proveedor       │
│                                                     │
│ [Cancelar] [💾 Registrar Pago]                      │
└─────────────────────────────────────────────────────┘
```

#### Vista 3: Tab "Todos" con filtros
```
Filtros: [Proveedor ▼] [Material ▼] [Estado ▼] [Desde] [Hasta]

Estado disponibles: Todos | Pendiente | Parcial | Liquidado
```

### Regla de distribución de pagos generales
```javascript
// Si el pago es "general" (no a un ticket específico):
// Distribuir el monto entre los tickets pendientes del proveedor
// Orden: primero el más antiguo (fechaTicket ASC)
// Hasta agotar el monto del pago o liquidar todos los tickets

function distribuirPago(proveedor, monto, fecha) {
  const pendientes = window.EVE.cuentasPorPagar
    .filter(c => c.proveedor === proveedor && c.saldo > 0)
    .sort((a, b) => a.fechaTicket.localeCompare(b.fechaTicket));

  let montoRestante = monto;
  for (const cxp of pendientes) {
    if (montoRestante <= 0) break;
    const abono = Math.min(montoRestante, cxp.saldo);
    // Agregar abono al ticket
    // Actualizar pagado, saldo, estado
    montoRestante -= abono;
  }
}
```

---

## INTEGRACIÓN CON MÓDULO PAGOS EXISTENTE

El módulo Pagos actual (ministraciones + pagos manuales) convive con CxP.
Cuando se registra un pago en el módulo Pagos:

```javascript
// Verificar si existe CxP para ese ticket
const cxpExistente = window.EVE.cuentasPorPagar
  .find(c => c.ticket === pagoNuevo.ticket);

if (cxpExistente) {
  // Actualizar el CxP automáticamente con el monto pagado
  await actualizarAbonoCxP(cxpExistente.id, {
    monto: pagoNuevo.pagado,
    fecha: pagoNuevo.fecha,
    referencia: "Registrado desde Pagos"
  });
}
```

---

## NUEVAS COLECCIONES FIREBASE

```
precios              → lista de precios con histórico
cuentas_por_pagar    → CxP generadas desde auditorías
auditorias           → resultados de lotes de auditoría
```

## NUEVOS PERMISOS DE USUARIO

```javascript
permissions: {
  // ... permisos existentes ...
  auditoria: true,    // puede auditar tickets con OCR
  precios: true,      // puede ver y editar lista de precios
  cxp: true           // puede ver y registrar pagos en CxP
}
```

## CARGA INICIAL DE DATOS (agregar en `auth.js`)

```javascript
const [
  // ... cargas existentes ...
  precios,
  cuentasPorPagar,
  auditorias
] = await Promise.all([
  // ... fetches existentes ...
  cargarDatos('precios'),
  cargarDatos('cuentas_por_pagar'),
  cargarDatos('auditorias')
]);

window.EVE.precios = precios;
window.EVE.cuentasPorPagar = cuentasPorPagar;
window.EVE.auditorias = auditorias;
```

---

## ORDEN DE IMPLEMENTACIÓN

1. `js/precios.js` + colección `precios` en Firebase
   → Primero porque todo lo demás depende del precio

2. Función `obtenerPrecioVigente()` en `utils.js`
   → Función central que usan auditoría y CxP

3. `js/auditoria.js` + CDN de Tesseract.js
   → Incluir `<script src="tesseract CDN">` en index.html

4. `js/cxp.js` + colección `cuentas_por_pagar`
   → Conectar con resultado de auditoría

5. Integración con módulo Pagos existente
   → Al registrar pago, verificar y actualizar CxP

6. Actualizar `auth.js`: carga de precios, CxP, auditorías
7. Actualizar `admin.js`: permisos nuevos para los 3 módulos
8. Actualizar `index.html`: scripts y tabs nuevos

---

## CHECKLIST

- [ ] Lista de Precios: CRUD completo con histórico
- [ ] obtenerPrecioVigente(material, fecha) funciona correctamente
- [ ] Auditoría: carga múltiple de imágenes
- [ ] Auditoría: OCR extrae número de ticket correctamente
- [ ] Auditoría: comparación vs Destaraje funciona
- [ ] Auditoría: 4 estados de resultado correctos
- [ ] Auditoría: botón "Corregir en Destaraje" abre el registro
- [ ] Auditoría: botón "Generar CxP" solo para tickets COINCIDEN
- [ ] CxP: generación automática con precio histórico correcto
- [ ] CxP: vista por proveedor con totales
- [ ] CxP: registro de abonos (específico o general)
- [ ] CxP: distribución proporcional de pago general
- [ ] CxP: estados actualizados (pendiente/parcial/liquidado)
- [ ] Integración Pagos → CxP automática
- [ ] Permisos nuevos en panel Admin
- [ ] Datos cargados al iniciar sesión

---

Lee primero todos los archivos existentes del proyecto para entender
lo que ya está implementado. Luego comienza con el Paso 1: Lista de Precios.
Confirma al terminar cada módulo antes de continuar al siguiente.

---

## ✅ DECISIONES DE NEGOCIO — DEFINITIVAS

Estas decisiones ya fueron tomadas. No preguntar, implementar directamente.

### 1. Comisión sobre precio

La comisión es de **+$0.10 por kg** y se SUMA al precio vigente del material.
Es una constante del sistema, configurable desde Admin.

```
Precio vigente MIXTO:  $10.50/kg  (de Lista de Precios)
Comisión:              +$0.10/kg  (constante del sistema)
Precio efectivo CxP:   $10.60/kg  (lo que se usa para calcular)
CxP calcula:           650 kg × $10.60 = $6,890.00
```

En la UI de CxP mostrar desglose:
```
Material:   650 kg × $10.50  =  $6,825.00
Comisión:   650 kg × $0.10   =     $65.00
Total CxP:                       $6,890.00
```

La comisión se configura en Admin → Configuración del Sistema:
```javascript
// En Firebase, colección 'config', documento 'sistema':
{ comisionPorKg: 0.10 }
// Default: 0.10. Editable solo por Admin.
```

### 2. Colecciones de auditoría — coexisten y se vinculan

```
auditoria_fotos  → un documento por foto individual (evidencia visual, base64)
                   AGREGAR campo: { idLoteAuditoria: "abc123" }

auditorias       → un documento por lote (resultados de comparación)
                   AGREGAR en cada resultado: { idFotoAuditoria: "xyz789" }
```

Ambas colecciones se mantienen. Al auditar un lote se escriben ambas.

### 3. Tickets sin foto — regla por fecha de corte

```
FECHA DE CORTE: 01/07/2026

Tickets con fechaEntrada < 01/07/2026:
  → Pueden generar CxP directamente sin foto
  → Estado en CxP: "APROBADO SIN FOTO (anterior al corte)"
  → No aparecen en alertas de pendientes

Tickets con fechaEntrada >= 01/07/2026:
  → Requieren auditoría con foto para generar CxP
  → Si no tienen foto: aparecen en alerta en módulo CxP:
    "⚠️ X tickets sin auditar (requieren foto)"
  → Admin puede aprobar manualmente con justificación:
    Modal: "Motivo de aprobación sin foto: [___________]"
    Estado en CxP: "APROBADO MANUALMENTE — Motivo: [texto]"
```

### 4. Saldo a favor del proveedor

Si un pago general excede el total de tickets pendientes del proveedor:
```javascript
// El excedente queda como saldo a favor
proveedor.saldoAFavor += montoExcedente

// Se aplica automáticamente al siguiente lote de CxP del mismo proveedor
// Se muestra en vista del proveedor:
// ✅ JOSE ENRIQUE — Saldo a favor: $325.00 (se aplicará al próximo pago)

// Al generar nuevo CxP para ese proveedor:
// Si saldoAFavor >= nuevoCxP.total → se liquida automáticamente
// Si saldoAFavor < nuevoCxP.total  → se abona parcialmente
```

Guardar saldo a favor en colección `proveedores`:
```javascript
// Nueva colección 'proveedores' (o campo en 'cuentas_por_pagar'):
{
  nombre: "JOSE ENRIQUE",
  saldoAFavor: 325.00,
  ultimaActualizacion: "2026-04-28"
}
```

### 5. Orden de implementación — definitivo

```
1. Lista de Precios  (js/precios.js)
2. Auditoría OCR     (js/auditoria.js)  ← ya en curso, cerrar primero
3. CxP               (js/cxp.js)
4. Integración Pagos → CxP
```

### 6. Alcance temporal del sistema

El sistema contendrá todos los registros del año completo.
CxP debe mostrar siempre:
- Total acumulado a pagar (histórico)
- Total pagado a la fecha
- Saldo pendiente actual

Filtros mínimos obligatorios en CxP:
- Por semana
- Por mes
- Por rango de fechas personalizado
- Por proveedor
- Por estado (pendiente / parcial / liquidado)

---

## 📋 REPORTES DE CxP

### Reporte 1 — Estado de cuenta por proveedor

```
ESTADO DE CUENTA — JOSE ENRIQUE
Período: 01/04/2026 al 30/04/2026
Generado: 28/04/2026

Ticket  Fecha       Material  Kg     Precio   Comisión  Total       Pagado      Saldo
9260    23/04/2026  MIXTO     650    $10.50   $0.10     $6,890.00   $6,500.00   $390.00
9251    23/04/2026  MIXTO     920    $10.50   $0.10     $9,752.00   $9,752.00   $0.00
9264    23/04/2026  MIXTO     980    $10.50   $0.10     $10,388.00  $0.00       $10,388.00
9279    21/04/2026  PET       1200   $8.50    $0.10     $10,320.00  $0.00       $10,320.00

                                              Total:    $37,350.00  $16,252.00  $21,098.00
                                              Saldo a favor:                    ($325.00)
                                              SALDO NETO:                       $20,773.00

HISTORIAL DE PAGOS:
  28/04/2026   $6,500.00    Efectivo        Ticket 9260 (parcial)
  28/04/2026   $9,752.00    Transferencia   Ticket 9251 (liquidado)
  Total pagado: $16,252.00
```

### Reporte 2 — CxP consolidado (todos los proveedores)

```
CUENTAS POR PAGAR — CONSOLIDADO
Semana: 21/04/2026 al 27/04/2026
Generado: 28/04/2026

Proveedor        Tickets  Total CxP     Pagado        Saldo         Estado
JOSE ENRIQUE     4        $37,350.00    $16,252.00    $21,098.00    Parcial
JUANA            3        $22,440.00    $22,440.00    $0.00         Liquidado ✅
FRANCISCO        2        $16,800.00    $0.00         $16,800.00    Pendiente 🔴
FELIX LOZANO     3        $14,700.00    $10,000.00    $4,700.00     Parcial
ARTURO LARA      2        $8,820.00     $8,820.00     $0.00         Liquidado ✅

TOTALES          14       $100,110.00   $57,512.00    $42,598.00
```

### Reporte 3 — Historial de pagos (período)

```
HISTORIAL DE PAGOS
Período: 21/04/2026 al 27/04/2026

Fecha       Proveedor        Monto         Referencia      Tickets afectados
24/04/2026  JOSE ENRIQUE     $6,500.00     Efectivo        9260 (parcial)
24/04/2026  JOSE ENRIQUE     $9,752.00     Transferencia   9251 (liquidado)
24/04/2026  JUANA            $22,440.00    Efectivo        9252, 9263, 9258
24/04/2026  ARTURO LARA      $8,820.00     Efectivo        9257, 9266
25/04/2026  FELIX LOZANO     $10,000.00    Transferencia   9253 (parcial)

Total pagado en el período: $57,512.00
```

### Exportaciones disponibles en CxP

Mismos 3 formatos del resto del sistema:

```
[📄 TXT]  [📕 PDF]  [📊 CSV]  [📤 Telegram]
```

El PDF sigue el mismo estilo visual que DESTARAJE_SEMANA.pdf:
- Título: 18pt bold centrado
- Encabezados de sección: 14pt bold con línea separadora
- Totales: 16pt bold
- Tablas con doc.autoTable(), header azul marino #001D3D
- Fechas siempre en dd/mm/aaaa

### Mensaje Telegram para CxP

```
💰 CxP SEMANAL
Período: 21 al 27 de abril

Por pagar:   $100,110.00
Pagado:       $57,512.00
Saldo:        $42,598.00

PENDIENTES:
• Francisco   $16,800.00
• Jose Enrique $21,098.00
• Felix Lozano  $4,700.00

📄 Ver estado de cuenta completo adjunto
```

### Filtros disponibles en módulo Reportes para CxP

```
Módulo:     [⚙️ CxP ▼]
Proveedor:  [Todos ▼]         ← dropdown dinámico
Estado:     [Todos ▼]         ← Pendiente | Parcial | Liquidado
Material:   [Todos ▼]         ← dropdown dinámico
Desde:      [dd/mm/aaaa]
Hasta:      [dd/mm/aaaa]
Tipo:       [Estado de Cuenta ▼]  ← Estado de Cuenta | Consolidado | Historial Pagos

[🔍 Vista Previa]  [🔄 Limpiar]
[📄 TXT] [📕 PDF] [📊 CSV] [📤 Telegram]
```

### Permisos

```javascript
permissions: {
  cxp: true,          // ver CxP y registrar pagos
  cxp_reportes: true  // generar y exportar reportes de CxP
}
// cxp_reportes solo para Admin y supervisores
```

### Checklist reportes CxP

- [ ] Reporte 1: Estado de cuenta por proveedor con desglose de comisión
- [ ] Reporte 2: Consolidado todos los proveedores con totales
- [ ] Reporte 3: Historial de pagos por período
- [ ] Exportación TXT con estructura correcta
- [ ] Exportación PDF con estilo visual del sistema
- [ ] Exportación CSV para análisis en Excel
- [ ] Mensaje Telegram conciso con PDF adjunto
- [ ] Filtros: proveedor, estado, material, fechas, tipo de reporte
- [ ] Vista previa antes de exportar
- [ ] Fechas siempre en dd/mm/aaaa en UI y reportes
