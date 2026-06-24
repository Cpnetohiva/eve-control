# 🤖 PROMPT INICIAL — EVE CONTROL v3.0 (Claude Code)

Eres el desarrollador principal de **EVE Control v3.0**, sistema de control operativo para **EVERPLASTIC (Mehicaso Group)**. Tienes acceso a GitHub y Firebase. Tu tarea es construir el sistema completo desde cero siguiendo estas especificaciones.

---

## 📁 REPOSITORIO Y DEPLOY

- **GitHub repo:** `cpnetohiva/eve-control-v2` (ya existente, reemplazar contenido)
- **Deploy:** GitHub Pages → `https://cpnetohiva.github.io/eve-control-v2/`
- **Alternativa:** Firebase Hosting → `https://everplastic.web.app`

### Firebase (ya configurado, usar estas credenciales)
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyCF_6UdCStIo2eq-BSDH-vHmSu6LvzX7gU",
  authDomain: "everplastic.firebaseapp.com",
  projectId: "everplastic",
  storageBucket: "everplastic.firebasestorage.app",
  messagingSenderId: "804807980304",
  appId: "1:804807980304:web:47466f961871b5b0a80c06"
};
```

### Firestore Collections (ya existentes con datos)
```
users               → usuarios del sistema
destaraje           → registros de entrada/salida de material
produccion          → registros de producción
pagos               → pagos a proveedores
ministraciones      → efectivo semanal entregado
control_produccion  → procesos de transformación (Selección, Molienda, Lavado, etc.)
```

### Telegram Bot (ya configurado)
```
Token: (leer de Firebase collection 'config' doc 'telegram')
Chat ID: 8687896128
Bot: @ControlEveBot
```

---

## 🏗️ ARQUITECTURA

```
eve-control-v2/
├── index.html
├── css/
│   └── styles.css
└── js/
    ├── config.js          → Firebase + constantes globales
    ├── utils.js           → Helpers: formatearKg, formatearMoneda, fechas, exports
    ├── auth.js            → Login, sesión, permisos, carga de datos
    ├── destaraje.js       → Módulo Destaraje y Ventas
    ├── produccion.js      → Módulo Producción simple
    ├── pagos.js           → Módulo Pagos + Ministraciones
    ├── control-produccion.js → Módulo Control de Producción extendido
    ├── reportes.js        → Módulo Reportes (PDF/TXT/CSV/Telegram)
    ├── admin.js           → Panel Admin (usuarios, datos, backup)
    └── voz.js             → Reconocimiento de voz (hold-to-record)
```

**Stack:** Vanilla JS · Firebase Firestore · jsPDF + autoTable · SheetJS · Web Speech API

---

## 🎨 DISEÑO

```css
/* Paleta */
--azul-marino:  #001D3D;
--oro:          #FFC300;
--azul-claro:   #0077B6;
--blanco:       #FFFFFF;
--gris-claro:   #F5F5F5;
--gris-oscuro:  #666666;

/* Tipografía */
DM Sans      → UI general
JetBrains Mono → números y datos

/* Componentes: cards con sombra, tabs, modales, toast notifications */
```

---

## 👥 USUARIOS Y PERMISOS

```javascript
// Estructura de usuario en Firestore (colección 'users')
{
  username: "Admin",
  password: "4W9EVE12",
  active: true,
  permissions: {
    destaraje: true,
    produccion: true,
    pagos: true,
    controlProduccion: true,
    reportes: true,
    admin: true
  }
}

// Usuarios existentes:
// Admin / 4W9EVE12     → acceso total
// Matilde / 1357       → destaraje + reportes
// Christian / 8642     → produccion + pagos + reportes
```

---

## 📦 MÓDULO 1: DESTARAJE Y VENTAS (`destaraje.js`)

### Estructura de registro en Firestore
```javascript
{
  ticket: "9260",        // numérico = compra, "V" = venta, "P" = producción interna
  proveedor: "JOSE ENRIQUE",
  material: "MIXTO",
  kg: 650,
  fechaEntrada: "2026-04-23",
  fechaSalida: "2026-04-24",
  fechaRegistro: "2026-04-24T..."
}
```

### Reglas de negocio
- Ticket numérico → compra de material a proveedor
- Ticket "V" → venta de material (usar campo `proveedor` como cliente)
- Ticket "P" → producción interna
- TAMBOS y CAJAS → unidad = "PZ" (piezas), resto = "KG"
- Los registros con ticket "V" se separan del destaraje general en reportes

### UI requerida
- Formulario con autocompletado dinámico (proveedores y materiales aprendidos de Firebase)
- Reconocimiento de voz: mantener presionado, formato:
  `"Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 abril, salida 24 abril"`
- 3 tabs: HOY / ESTA SEMANA / TODOS
- En cada tab: estadísticas en tiempo real (total registros, total KG)
- Tab "TODOS": filtros en tiempo real por Ticket, Fecha Desde/Hasta, Proveedor, Material
- Exportaciones por tab activo: TXT / PDF / CSV
- Editar y eliminar registros

---

## 🏭 MÓDULO 2: PRODUCCIÓN (`produccion.js`)

### Estructura de registro
```javascript
{
  ticket: "P",
  cliente: "Produccion",    // tipo de proceso genérico
  material: "PELETIZADO",
  kg: 1800,
  fechaEntrada: "2026-04-24",
  fechaSalida: "2026-04-24",
  fechaRegistro: "2026-04-24T..."
}
```

### UI requerida
- Idéntico a Destaraje pero con campo "Cliente" en vez de "Proveedor"
- Ticket siempre "P"
- Reconocimiento de voz:
  `"Ticket P de Produccion, Peletizado, 1800, entrada 24 abril, salida 24 abril"`
- 3 tabs: HOY / ESTA SEMANA / TODOS
- Filtros, exportaciones, editar/eliminar

---

## 💰 MÓDULO 3: PAGOS (`pagos.js`)

### Estructura de registro
```javascript
{
  ticket: "9260",
  proveedor: "JOSE ENRIQUE",
  material: "MIXTO",
  kg: 650,
  precioPorKg: 10.0,
  total: 6500,          // calculado automáticamente: kg × precioPorKg
  pagado: 6500,
  fecha: "2026-04-24",
  fechaRegistro: "2026-04-24T..."
}
```

### Ministraciones (colección `ministraciones`)
```javascript
{
  monto: 10000,
  fecha: "2026-04-28",
  semana: "2026-W17",   // ISO week
  fechaRegistro: "..."
}
```

### UI requerida
- Formulario con autocompletado
- Total = kg × precio/kg (calculado automáticamente)
- Reconocimiento de voz:
  `"Ticket 9260 de Jose Enrique, Mixto, 650, a 10, pagado 6500"`
- 3 tabs: HOY / ESTA SEMANA / TODOS

#### Tab "ESTA SEMANA" — Control de Flujo
```
┌─────────────────────────────────┐
│ CONTROL DE FLUJO SEMANAL        │
│ Total Ministrado:  $20,000.00   │
│ Total Pagado:      $15,000.00   │
│ Saldo Disponible:  $5,000.00    │
│ % Ejecutado:       75%          │
│                                 │
│ Detalle ministraciones:         │
│ • 28/04 - $10,000 [🗑️]         │
│ • 25/04 - $10,000 [🗑️]         │
│                                 │
│ [💵 Registrar Ministración]     │
└─────────────────────────────────┘
```
- Filtros, exportaciones, editar/eliminar

---

## ⚙️ MÓDULO 4: CONTROL DE PRODUCCIÓN (`control-produccion.js`)

### Procesos disponibles
```javascript
const PROCESOS = {
  SELECCION:  { nombre: 'Selección',  icono: '🔍', outputs: ['Material separado', 'Merma'] },
  EMPACADO:   { nombre: 'Empacado',   icono: '📦', outputs: ['Pacas'] },
  MOLIENDA:   { nombre: 'Molienda',   icono: '⚙️', outputs: ['Material molido', 'Merma'] },
  LAVADO:     { nombre: 'Lavado',     icono: '💧', outputs: ['Material limpio', 'Merma'] },
  PELETIZADO: { nombre: 'Peletizado', icono: '🔵', outputs: ['Pellets', 'Merma'] }
};
```

### Estructura de registro
```javascript
{
  ticket: "P-001",
  tipoProceso: "PELETIZADO",
  inputs: [{ material: "PET MOLIDO", kg: 1000, ticketOrigen: "9260" }],
  outputs: {
    principal: { material: "Pellets", kg: 900 },
    merma: { kg: 100 }
  },
  operador: "Christian",
  turno: "Matutino",          // Matutino | Vespertino | Nocturno
  fechaInicio: "2026-04-28T08:00",
  fechaFin:    "2026-04-28T14:00",
  horasTrabajo: 6.0,
  totalInput: 1000,
  totalOutput: 1000,
  eficiencia: 90.00,          // (output principal / totalInput) * 100
  porcentajeMerma: 10.00,
  observaciones: "",
  fechaRegistro: "..."
}
```

### Cálculos automáticos en tiempo real
- `eficiencia = (outputPrincipal / totalInput) * 100`
- `porcentajeMerma = (merma / totalInput) * 100`
- `horasTrabajo = (fechaFin - fechaInicio) en horas`
- `productividad = outputPrincipal / horasTrabajo  (kg/hora)`

### UI requerida
- Formulario dinámico: al seleccionar proceso aparecen campos específicos
- Inputs múltiples (botón "+ Agregar Material")
- Resumen automático visible mientras se llena el formulario
- Color de eficiencia: verde ≥90%, naranja ≥80%, rojo <80%
- 4 tabs: HOY / ESTA SEMANA / TODOS / TRAZABILIDAD

#### Tab TRAZABILIDAD
- Input: buscar por número de ticket
- Muestra cadena: ENTRADA → PROCESO1 → PROCESO2 → ... → VENTA
- Cada etapa muestra eficiencia y kg
- Resumen global: kg entrada, kg salida, merma total, eficiencia global

---

## 📊 MÓDULO 5: REPORTES (`reportes.js`)

### UI requerida

#### Filtros
```
Módulo:    [Reporte General ▼]           ← incluye opción "Control de Producción"
Ticket:    [_______________]
Desde:     [fecha]   Hasta: [fecha]
Proveedor: [_____ ▼]  ← DROPDOWN dinámico (lista de proveedores únicos de Firebase)
Material:  [_____ ▼]  ← DROPDOWN dinámico (lista de materiales únicos de Firebase)
Cliente:   [_____ ▼]  ← DROPDOWN dinámico (lista de clientes únicos de Firebase)

[🔍 Vista Previa]  [🔄 Limpiar]
```

#### Botones de exportación
```
[📄 TXT]  [📕 PDF]  [📊 CSV]  [📤 Telegram]
```

#### Vista Previa (botón "🔍 Vista Previa")
- Muestra un panel dentro de la página con el reporte renderizado ANTES de descargar
- Permite ver cómo quedan los datos con los filtros aplicados
- Botón "✕ Cerrar Vista Previa"

### Formato TXT/PDF — ESTRUCTURA EXACTA

Basado en el archivo `DESTARAJE_SEMANA.pdf` adjunto, el reporte debe seguir **exactamente** este orden y formato:

```
DESTARAJE GENERAL                          ← Título 18pt bold (PDF) / mayúsculas (TXT)
REPORTE: SEMANA                            ← 10pt
PERIODO: 20 AL 25 DE ABRIL DE 2026        ← 10pt
FECHA: 24-04-2026                          ← 10pt

TOTAL KG: 24,294                           ← 16pt bold (PDF) / separar miles con coma
TOTAL PRODUCCION KG: 3,850                 ← 16pt bold

DESGLOSE POR MATERIAL:                     ← 14pt bold, línea separadora
  MIXTO         18,584 KG                  ← sangría 4 espacios, alineado en columna
  PET            2,560 KG
  MIXTO 2        1,720 KG
  MULTICOLOR     1,430 KG

DESGLOSE PRODUCCION:                       ← 14pt bold, línea separadora
  PELETIZADO              1,800 KG
  LECHERO LAVADO            800 KG
  PACAS CRISTAL CON ETIQUETA 750 KG
  PP MOLIDO                 500 KG

DESGLOSE VENTAS:                           ← 14pt bold, línea separadora
  PACAS CRISTAL CON ETIQUETA  17,500 KG
  LECHERO MOLIDO               2,200 KG
  TAMBO                          400 PZ    ← PZ para TAMBOS y CAJAS
  CAJA CO30                      220 PZ

DESGLOSE POR PROVEEDOR + MATERIAL:         ← 14pt bold, línea separadora
  JOSE ENRIQUE: 8,440 KG                   ← nombre proveedor bold
    MIXTO       7,240 KG                   ← sangría doble en materiales
    PET         1,200 KG
  JUANA: 5,360 KG
    MIXTO       3,350 KG
    PET         1,360 KG
    MIXTO 2       650 KG
  FRANCISCO: 3,974 KG
    MIXTO       3,974 KG
  ...

RESUMEN PAGOS:                             ← solo si incluye módulo pagos
  TOTAL PAGADO: $15,000.00
  TOTAL DEUDA: $110.00

DETALLE DE TICKETS:                        ← TABLA con autoTable (PDF)
  TICKET  PROVEEDOR      MATERIAL     KG    F.ENTRADA   F.SALIDA
  9260    JOSE ENRIQUE   MIXTO       650   23-04-2026  24-04-2026
  9251    JOSE ENRIQUE   MIXTO       920   23-04-2026  24-04-2026
  ...
  P       PRODUCCION     PELETIZADO 1800   24-04-2026  24-04-2026
  V       VENTA          TAMBO       400   24-04-2026  24-04-2026

DETALLE DE PAGOS:                          ← TABLA con autoTable (PDF)
  TICKET  PROVEEDOR      MATERIAL  KG   PRECIO/KG  TOTAL    PAGADO   DEUDA   FECHA
  9260    JOSE ENRIQUE   MIXTO    650   $10.00    $6,500  $6,500     $0   24-04-2026
  ...
```

### Estilo visual PDF
- Título principal: 18pt bold, centrado
- Encabezados de sección (DESGLOSE, DETALLE): 14pt bold, con línea separadora debajo
- Totales destacados: 16pt bold, centrados
- Datos de desglose: 12pt, sangría 4 espacios para materiales, doble sangría en proveedor+material
- Tablas (DETALLE DE TICKETS, DETALLE DE PAGOS): `doc.autoTable()` con header azul marino `#001D3D`
- Separadores horizontales entre secciones

### Mensaje Telegram (conciso, con PDF adjunto)
```
📊 REPORTE
Periodo: 20 al 25 de abril

DESTARAJE:
• Total: 24,294 kg
• Mixto 18,584 kg, PET 2,560 kg     ← top 2 materiales

PRODUCCIÓN:
• Total: 3,850 kg
• Peletizado 1,800 kg, Lechero Lavado 800 kg

VENTAS:
• Total: 20,320 kg
• Pacas Cristal 17,500 kg, Lechero Molido 2,200 kg

PAGOS:
• Total Pagado: $15,000.00
• Jose Enrique $8,440, Juana $5,360   ← todos los proveedores con monto

CONTROL DE PRODUCCIÓN:
• Procesos: 3
• Material procesado: 1,500 kg
• Eficiencia promedio: 92.5%

📄 Ver PDF adjunto
```

---

## 🔧 PANEL ADMIN (`admin.js`)

Accesible solo para usuarios con `permissions.admin = true`.

### Secciones requeridas

#### 1. Gestión de Usuarios
- CRUD completo de usuarios
- Activar/desactivar
- Resetear contraseña
- Asignar permisos por módulo con checkboxes

#### 2. Importación de Datos ← NUEVO
```
Importar desde Excel (.xlsx)
├── Descargar plantilla (3 hojas: Destaraje | Produccion | Pagos)
├── Seleccionar archivo
├── Vista previa de registros a importar
├── Modo: [Agregar] o [Reemplazar todo]
└── Confirmar importación

Plantilla Excel - formato de columnas:
  Hoja Destaraje:  Ticket | Proveedor | Material | Kg | Fecha Entrada | Fecha Salida
  Hoja Produccion: Ticket | Cliente | Material | Kg | Fecha Entrada | Fecha Salida
  Hoja Pagos:      Ticket | Proveedor | Material | Kg | Precio/Kg | Total | Pagado | Fecha
```

#### 3. Gestión de Datos ← NUEVO (borrado total o parcial)
```
Borrar datos por módulo:
┌─────────────────────────────────────────────┐
│ ⚠️ GESTIÓN DE DATOS                         │
│                                             │
│ Módulo:  [Destaraje ▼]                      │
│ Período: [Desde ____] [Hasta ____]          │
│          (vacío = borrar TODO el módulo)    │
│                                             │
│ [🔍 Ver cuántos registros se eliminarán]    │
│ [🗑️ Eliminar X registros]                  │
│                                             │
│ Confirmar escribiendo "CONFIRMAR":          │
│ [__________________]                        │
└─────────────────────────────────────────────┘

Opciones de borrado:
- Borrar Destaraje (total o por rango de fechas)
- Borrar Producción (total o por rango de fechas)
- Borrar Pagos (total o por rango de fechas)
- Borrar Ministraciones (total o por rango de fechas)
- Borrar Control de Producción (total o por rango de fechas)
- Borrar TODOS los módulos (requiere confirmación doble)
```

#### 4. Backup / Exportación
- Exportar todos los datos a JSON (backup completo)
- Exportar a Excel con una hoja por módulo
- Botón "Probar Telegram" (envía mensaje de prueba)

#### 5. Configuración del Sistema
- Editar token de Telegram y Chat ID
- Configurar horario de reporte automático (por defecto 20:00 hora México)

---

## 🎤 RECONOCIMIENTO DE VOZ (`voz.js`)

- **Patrón:** hold-to-record (mousedown/touchstart → grabar, mouseup/touchend → procesar)
- **Idioma:** es-MX
- **No usar** `continuous: true` (causa cortes en pausas largas)
- Un botón 🎤 por módulo operativo (Destaraje, Producción, Pagos)

### Parseo por módulo

**Destaraje:**
```
Input:  "Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 abril, salida 24 abril"
Output: { ticket: "9260", proveedor: "Jose Enrique", material: "Mixto",
          kg: 650, fechaEntrada: "2026-04-23", fechaSalida: "2026-04-24" }
```

**Producción:**
```
Input:  "Ticket P de Produccion, Peletizado, 1800, entrada 24 abril, salida 24 abril"
Output: { ticket: "P", cliente: "Produccion", material: "Peletizado",
          kg: 1800, fechaEntrada: "2026-04-24", fechaSalida: "2026-04-24" }
```

**Pagos:**
```
Input:  "Ticket 9260 de Jose Enrique, Mixto, 650, a 10, pagado 6500"
Output: { ticket: "9260", proveedor: "Jose Enrique", material: "Mixto",
          kg: 650, precioPorKg: 10, pagado: 6500, total: 6500 }
```

### Reconocimiento de fechas en español
```javascript
// Mapear meses en español a número
"enero"→1, "febrero"→2, "marzo"→3, "abril"→4, "mayo"→5, "junio"→6,
"julio"→7, "agosto"→8, "septiembre"→9, "octubre"→10, "noviembre"→11, "diciembre"→12

// Patrones: "27 abril" → 2026-04-27 | "27 de abril" → 2026-04-27
```

---

## 🔁 AUTOCOMPLETADO

- Usar `<datalist>` HTML nativo con IDs únicos por módulo
- Aprender de registros existentes en Firebase al cargar el módulo
- Actualizar datalist con cada nuevo registro
- Proveedores, materiales y clientes: obtener valores únicos de Firestore

---

## ⚙️ UTILIDADES (`utils.js`)

```javascript
// Funciones requeridas:
formatearKg(valor)         → "1,000 kg" o "400 PZ"
formatearMoneda(valor)     → "$15,000.00"
obtenerFechaMexico()       → "2026-04-28"  (YYYY-MM-DD, zona horaria México)
obtenerInicioSemana()      → "2026-04-20"  (lunes de la semana actual)
descargarArchivo(blob, nombre)
exportarCSV(datos, nombre)
guardarDato(coleccion, datos)    → Promise<id>
actualizarDato(coleccion, id, datos)
eliminarDato(coleccion, id)
cargarDatos(coleccion)           → Promise<array>
showSuccess(mensaje)     → toast verde 3 seg
showError(mensaje)       → toast rojo 4 seg
```

---

## 🔐 AUTENTICACIÓN (`auth.js`)

```javascript
// Flujo de login:
// 1. Cargar usuarios de Firebase (colección 'users')
// 2. Validar username + password
// 3. Verificar usuario.active === true
// 4. Guardar sesión en localStorage { userId, username, permissions }
// 5. Cargar datos según permisos (en paralelo con Promise.all)
// 6. Renderizar tabs solo de módulos con permiso
// 7. Auto-login si hay sesión válida en localStorage

// Carga de datos inicial (paralelo):
const [destaraje, produccion, pagos, ministraciones, controlProduccion] =
  await Promise.all([...]);

window.EVE = {
  currentUser: null,
  registrosDestaraje: [],      // tickets numéricos únicamente
  registrosVentas: [],         // tickets "V"
  registrosProduccion: [],     // tickets "P"
  registrosPagos: [],
  registrosMinistraciones: [],
  registrosControlProduccion: []
};
```

---

## 🚀 INSTRUCCIONES DE DESARROLLO

### Orden de implementación recomendado

1. **Setup inicial**
   - Clonar repo `cpnetohiva/eve-control-v2`
   - Crear estructura de carpetas
   - Configurar Firebase en `config.js`

2. **Base (`utils.js` + `auth.js`)**
   - Funciones de Firebase CRUD
   - Login, sesión, permisos
   - Carga paralela de datos

3. **Módulos operativos** (en este orden)
   - `destaraje.js`
   - `produccion.js`
   - `pagos.js`
   - `control-produccion.js`

4. **Reportes (`reportes.js`)**
   - Formato exacto según DESTARAJE_SEMANA.pdf
   - Dropdowns dinámicos de proveedor/material/cliente
   - Vista previa antes de exportar
   - Telegram con PDF adjunto

5. **Admin (`admin.js`)**
   - CRUD usuarios
   - Importación Excel
   - Borrado total/parcial con confirmación

6. **Voz (`voz.js`)**
   - Hold-to-record por módulo
   - Parseo es-MX

7. **CSS (`styles.css`)**
   - Paleta azul marino + oro
   - Responsive (mobile-first)
   - Animaciones suaves

8. **Deploy**
   - Push a GitHub
   - Verificar GitHub Pages activo

---

## ✅ CHECKLIST DE FUNCIONALIDADES

### Módulos operativos
- [ ] Destaraje: CRUD + voz + filtros + 3 tabs + exportaciones TXT/PDF/CSV
- [ ] Producción: CRUD + voz + filtros + 3 tabs + exportaciones
- [ ] Pagos: CRUD + voz + filtros + 3 tabs + ministraciones + flujo semanal + exportaciones
- [ ] Control Producción: CRUD + formulario dinámico + cálculos automáticos + trazabilidad + exportaciones

### Reportes
- [ ] Selector de módulo (incluye Control de Producción)
- [ ] Filtros: ticket, fecha, proveedor dropdown, material dropdown, cliente dropdown
- [ ] Botón "Vista Previa" antes de exportar
- [ ] Formato PDF exacto (estructura según DESTARAJE_SEMANA.pdf)
- [ ] Títulos 14-18pt bold, sangrías, tablas con autoTable
- [ ] Telegram: mensaje conciso + PDF adjunto

### Admin
- [ ] CRUD de usuarios con permisos por módulo
- [ ] Importación Excel con plantilla descargable + vista previa
- [ ] Borrado de datos: por módulo, por rango de fechas, con confirmación escrita
- [ ] Backup completo a JSON/Excel
- [ ] Prueba de Telegram
- [ ] Configuración de token/chatID

### Técnico
- [ ] Autocompletado dinámico desde Firebase en todos los módulos
- [ ] Reconocimiento de voz hold-to-record en Destaraje, Producción y Pagos
- [ ] Parseo de fechas en español (mes en texto)
- [ ] Sesión persistente en localStorage
- [ ] Carga de datos en paralelo al iniciar sesión
- [ ] Responsive mobile

---

## 📎 REFERENCIA DE FORMATO DE REPORTE (DESTARAJE_SEMANA.pdf)

El PDF adjunto muestra el formato exacto de reporte que debe replicarse:

**Página 1:**
- DESTARAJE GENERAL (título 18pt)
- REPORTE: SEMANA / PERIODO / FECHA (10pt)
- TOTAL KG: 24,294 y TOTAL PRODUCCION KG: 3,850 (16pt bold, centrado)
- DESGLOSE POR MATERIAL con tabla de materiales (12pt, fondo gris alternado)
- DESGLOSE PRODUCCION con tabla
- DESGLOSE VENTAS con tabla (TAMBOS y CAJAS en PZ, no KG)
- DESGLOSE POR PROVEEDOR + MATERIAL: proveedor en bold 11pt, materiales en 9pt con sangría

**Páginas 2-3:**
- Continuación DESGLOSE POR PROVEEDOR
- DETALLE DE TICKETS: tabla completa con columnas Ticket | Proveedor | Material | KG | F.Entrada | F.Salida
  - Incluye registros P (Producción) y V (Venta) al final
  - Para TAMBOS/CAJAS la columna KG muestra el número sin "KG" (solo el número)

---

Empieza por el **setup inicial** y la **estructura base**. Crea primero `index.html`, `css/styles.css` y `js/config.js`, luego continúa con `utils.js` y `auth.js`. Confirma en cada etapa antes de continuar al siguiente módulo.

---

## 📋 DATOS DE REFERENCIA DEL SISTEMA EXISTENTE

### ⚠️ NOTA CRÍTICA — Project ID correcto
El Project ID de Firebase es **`everplastic`** (NO `control-evecontrol`).
Usar siempre:
```javascript
projectId: "everplastic"
authDomain: "everplastic.firebaseapp.com"
```

---

### 🗂️ Materiales comunes (para autocompletado inicial)
```javascript
const MATERIALES_COMUNES = [
    'MIXTO', 'MIXTO 2', 'PET', 'PET CRISTAL', 'PET COLOR',
    'MULTICOLOR', 'PELETIZADO', 'LECHERO LAVADO', 'LECHERO MOLIDO',
    'PP MOLIDO', 'PACAS CRISTAL CON ETIQUETA', 'PEAD',
    'TAMBO', 'CAJA CO30'
];
// TAMBOS y CAJAS → unidad PZ (piezas). Todo lo demás → KG
const MATERIALES_PZ = ['TAMBO', 'CAJA CO30'];
```

### 👥 Proveedores comunes (para autocompletado inicial)
```javascript
const PROVEEDORES_COMUNES = [
    'JOSE ENRIQUE', 'JUANA', 'FRANCISCO',
    'FELIX LOZANO', 'ARTURO LARA', 'OLEGARIO', 'JESUS'
];
```

---

### 📥 Importación Excel — comportamiento UX detallado

El modal de importación debe manejar estos casos y mensajes:

```
ANTES de importar:
  "📄 Descargar Plantilla Excel" → descarga PLANTILLA_EVE_CONTROL.xlsx con datos de ejemplo

AL SELECCIONAR ARCHIVO:
  Mostrar vista previa:
  "Se encontraron:
   • Destaraje: 34 registros
   • Producción: 8 registros
   • Pagos: 22 registros"

CHECKBOX "Reemplazar datos existentes":
  Mostrar advertencia en rojo:
  "⚠️ Se eliminarán TODOS los registros actuales del módulo seleccionado"

AL COMPLETAR:
  "✅ 64 registros importados correctamente"

ERRORES COMUNES a manejar:
  - Fecha en formato incorrecto → convertir automáticamente o avisar fila específica
  - Kg no es número → avisar y saltar registro
  - Hoja no encontrada → "No se encontró la hoja 'Destaraje' en el archivo"
  - Archivo vacío → "El archivo no contiene datos"
```

---

### 🔒 Checklist de despliegue (para que Claude Code lo ejecute al final)

```
1. [ ] Todos los archivos subidos al repo cpnetohiva/eve-control-v2
2. [ ] GitHub Pages activo en branch main
3. [ ] Verificar URL: https://cpnetohiva.github.io/eve-control-v2/
4. [ ] Login con Admin funciona
5. [ ] Cada módulo carga sin errores en consola
6. [ ] Reconocimiento de voz responde
7. [ ] Se guarda un registro en Firebase y aparece en tabla
8. [ ] Reporte PDF se genera correctamente
9. [ ] Botón Telegram envía mensaje de prueba
10. [ ] Funciona en celular (Chrome Android)
```

---

## 📶 MODO OFFLINE (PWA)

Implementar capacidad offline completa para que los colaboradores puedan capturar datos sin conexión a internet y sincronizar automáticamente al recuperarla.

### Archivos requeridos

```
eve-control-v2/
├── manifest.json          ← PWA manifest
├── service-worker.js      ← Cache y estrategia offline
├── js/
│   └── offline.js         ← IndexedDB + cola de sincronización
└── (resto de archivos)
```

---

### 1. `manifest.json`

```json
{
  "name": "EVE Control - EVERPLASTIC",
  "short_name": "EVE Control",
  "description": "Sistema de Control Operativo EVERPLASTIC",
  "start_url": "/eve-control-v2/",
  "scope": "/eve-control-v2/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#001D3D",
  "theme_color": "#001D3D",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

Generar los íconos programáticamente con Canvas API en colores corporativos
(azul marino `#001D3D` con letras "EVE" en oro `#FFC300`). No depender de archivos
de imagen externos.

---

### 2. `service-worker.js` — Estrategia Cache First

```javascript
const CACHE_NAME = 'eve-control-v3';

// Archivos a cachear en la instalación (App Shell)
const ARCHIVOS_ESTATICOS = [
  '/eve-control-v2/',
  '/eve-control-v2/index.html',
  '/eve-control-v2/css/styles.css',
  '/eve-control-v2/js/config.js',
  '/eve-control-v2/js/utils.js',
  '/eve-control-v2/js/auth.js',
  '/eve-control-v2/js/offline.js',
  '/eve-control-v2/js/destaraje.js',
  '/eve-control-v2/js/produccion.js',
  '/eve-control-v2/js/pagos.js',
  '/eve-control-v2/js/control-produccion.js',
  '/eve-control-v2/js/reportes.js',
  '/eve-control-v2/js/admin.js',
  '/eve-control-v2/js/voz.js',
  // CDN críticos — cachear en install
  'https://fonts.googleapis.com/css2?family=DM+Sans...',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore-compat.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'
];

// Estrategia:
// - App Shell (HTML/CSS/JS propios) → Cache First
// - Firebase API calls → Network First, con fallback a cola local
// - Fuentes y CDN externos → Cache First con revalidación en background
```

---

### 3. `js/offline.js` — IndexedDB + Cola de Sincronización

#### Base de datos local (IndexedDB)

```javascript
// Base de datos: 'EVEControlOffline'
// Versión: 1
// Object Stores:

'cola_pendiente'
  // Registros capturados sin conexión esperando subirse a Firebase
  {
    id:         auto-increment (clave primaria local),
    coleccion:  'destaraje' | 'produccion' | 'pagos' | 
                'ministraciones' | 'control_produccion',
    datos:      { ...registro completo },
    timestamp:  Date.toISOString(),
    intentos:   0,           // cuántas veces se intentó sincronizar
    estado:     'pendiente' | 'error'
  }

'cache_datos'
  // Copia local de los datos de Firebase para lectura offline
  {
    coleccion:  string (clave primaria),
    registros:  [...],
    ultimaSync: Date.toISOString()
  }
```

#### Flujo de escritura

```
Usuario guarda registro
        ↓
¿Hay internet?
   SÍ → guardarDato() en Firebase normalmente
         + actualizar cache_datos local
   NO → guardar en cola_pendiente (IndexedDB)
         + actualizar cache_datos local para que aparezca en tabla
         + incrementar contador de pendientes en UI
```

#### Flujo de lectura offline

```
Usuario abre módulo sin internet
        ↓
Firebase falla
        ↓
Leer de cache_datos en IndexedDB
        ↓
Mostrar datos con badge "📴 Datos en caché - [fecha última sync]"
```

#### Cola de sincronización automática

```javascript
// Escuchar reconexión a internet
window.addEventListener('online', sincronizarCola);

async function sincronizarCola() {
  // 1. Leer todos los registros de cola_pendiente
  // 2. Mostrar estado "🔄 Sincronizando... (X pendientes)"
  // 3. Para cada registro pendiente:
  //    a. Intentar guardar en Firebase
  //    b. Si éxito → eliminar de cola_pendiente
  //    c. Si error → incrementar intentos, dejar en cola
  // 4. Actualizar cache_datos con datos frescos de Firebase
  // 5. Mostrar "✅ Sincronizado" por 3 segundos
  // 6. Volver a "🟢 En línea"
}
```

#### Resolución de conflictos

```javascript
// Regla: Firebase gana siempre
// Si al sincronizar un ticket ya existe en Firebase:
//   - Conservar el registro de Firebase
//   - Descartar el local
//   - Notificar al usuario:
//     "⚠️ El ticket 9260 ya existía en el servidor.
//      Se conservó la versión del servidor."
//
// Excepción: si el registro local es más reciente (timestamp)
// Y NO existe en Firebase → subir normalmente
```

---

### 4. UI de Estado de Conexión (en el header)

Agregar indicador permanente visible en la barra superior, entre el título y los botones de Admin/Salir:

```
┌──────────────────────────────────────────────────────┐
│ EVE Control v3.0    🟢 En línea    [Admin] [Salir]   │
└──────────────────────────────────────────────────────┘
```

#### Estados y estilos

```javascript
// 4 estados posibles:

🟢 EN LÍNEA
  texto:  "En línea"
  color:  verde #06D6A0
  cuando: window.navigator.onLine === true
          y Firebase responde

🔴 SIN CONEXIÓN — 3 pendientes
  texto:  "Sin conexión — 3 registros pendientes"
  color:  rojo #EF476F
  cuando: window.navigator.onLine === false
  click:  abre panel con detalle de registros pendientes

🔄 SINCRONIZANDO...
  texto:  "Sincronizando... (3/5)"
  color:  oro #FFC300
  cuando: sincronizarCola() está en ejecución
  animación: icono giratorio

✅ SINCRONIZADO
  texto:  "✅ Sincronizado"
  color:  verde #06D6A0
  cuando: cola vacía tras reconexión
  duración: visible 3 segundos, luego vuelve a 🟢
```

#### Panel de registros pendientes (al hacer click en 🔴)

```
┌─────────────────────────────────────────┐
│ 📴 REGISTROS PENDIENTES DE SYNC (3)     │
├─────────────────────────────────────────┤
│ Destaraje  Ticket 9260  650 kg  14:32  │
│ Destaraje  Ticket 9261  800 kg  14:45  │
│ Pagos      Ticket 9260  $6,500  15:01  │
├─────────────────────────────────────────┤
│ Se subirán automáticamente al           │
│ recuperar conexión a internet.          │
│                    [✕ Cerrar]           │
└─────────────────────────────────────────┘
```

---

### 5. Instalación como App (prompt de instalación)

```javascript
// Capturar el evento beforeinstallprompt
// Mostrar botón discreto en el header después del primer uso:
// [📲 Instalar App]
// Al hacer click → mostrar prompt nativo del navegador
// Una vez instalada → ocultar el botón permanentemente (localStorage)

// En móvil Android/Chrome:
// El usuario puede instalar EVE Control como app nativa
// Sin ir a la tienda de apps, directo desde el navegador
// Funciona offline desde el ícono en pantalla de inicio
```

---

### 6. Comportamiento por Escenario

```
ESCENARIO 1 — Primera visita (requiere internet):
  Abre URL → descarga app shell → queda cacheada → login normal

ESCENARIO 2 — Uso normal con internet:
  Abre app (desde caché, rápido) → datos de Firebase → todo normal
  Estado header: 🟢 En línea

ESCENARIO 3 — Se va el internet mientras trabaja:
  Registrando ticket → se va internet → sistema detecta en <2 segundos
  Estado header: 🔴 Sin conexión — 1 registro pendiente
  Sigue registrando → datos van a IndexedDB → siguen apareciendo en tablas
  
ESCENARIO 4 — Vuelve el internet:
  Sistema detecta reconexión automáticamente
  Estado header: 🔄 Sincronizando... (3/5)
  Sube todos los pendientes → Estado: ✅ Sincronizado → 🟢 En línea

ESCENARIO 5 — Abre app sin haber tenido internet nunca:
  No puede abrir (sin caché inicial)
  Mostrar página de error clara:
  "Sin conexión. Conéctate al menos una vez para instalar EVE Control."

ESCENARIO 6 — Sin internet desde cero (ya visitó antes):
  Abre desde caché → login desde caché de usuarios → 
  ve datos del cache_datos → puede capturar → cola local
```

---

### 7. Registro en `index.html`

```html
<!-- En el <head>, antes de cerrar </head> -->
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#001D3D">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="EVE Control">

<!-- Al final del <body>, antes de los otros scripts -->
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/eve-control-v2/service-worker.js')
        .then(reg => console.log('SW registrado:', reg.scope))
        .catch(err => console.error('SW error:', err));
    });
  }
</script>
```

---

### 8. Consideraciones técnicas importantes

```
SCOPE del Service Worker:
  Debe coincidir exactamente con la URL de GitHub Pages:
  scope: '/eve-control-v2/'
  Si se despliega en raíz: scope: '/'

CACHE de Firebase SDK:
  Los SDKs de Firebase son pesados (~200KB cada uno).
  Cachearlos en el install event para que funcionen offline.
  Firebase Firestore tiene soporte offline nativo —
  habilitar con: db.enablePersistence({ synchronizeTabs: true })
  Esto maneja automáticamente parte del offline con IndexedDB propio de Firebase.
  La cola personalizada (offline.js) cubre los casos que Firebase no maneja.

FIREBASE OFFLINE NATIVO vs COLA PROPIA:
  Usar AMBOS en capas:
  Capa 1: db.enablePersistence() de Firebase → maneja sync automático básico
  Capa 2: offline.js con IndexedDB propio → UI de estado, contador de pendientes,
           resolución de conflictos, panel de pendientes visible al usuario

TAMAÑO DEL CACHÉ:
  Estimar ~2MB para app shell completo.
  Bien dentro del límite de Storage del navegador (mínimo 50MB en móviles).

ACTUALIZACIÓN DEL SERVICE WORKER:
  Usar estrategia skipWaiting() + clients.claim() para que las 
  actualizaciones del sistema lleguen automáticamente al recargar.
  Mostrar notificación: "🔄 Nueva versión disponible. Recarga para actualizar."
```

---

### ✅ Checklist PWA (agregar al checklist de despliegue)

```
11. [ ] manifest.json accesible en /eve-control-v2/manifest.json
12. [ ] Service Worker registrado (ver en DevTools > Application > SW)
13. [ ] App instalable en Android Chrome (aparece botón "Añadir a pantalla inicio")
14. [ ] Funciona offline: activar modo avión, recargar, debe abrir
15. [ ] Capturar registro offline → aparece en tabla con datos locales
16. [ ] Desactivar modo avión → sincroniza automáticamente
17. [ ] Estado del header cambia correctamente entre los 4 estados
18. [ ] Panel de pendientes muestra registros correctos al hacer click en 🔴
19. [ ] Lighthouse PWA score ≥ 90 (verificar en DevTools > Lighthouse)
20. [ ] En iOS Safari: Compartir → Añadir a pantalla inicio → funciona
```
