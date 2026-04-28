# 📥 GUÍA DE IMPORTACIÓN DE DATOS - EVE CONTROL v2.0

## 🎯 CÓMO IMPORTAR DATOS

### **Ubicación del Botón**
En la barra superior del sistema, al lado del botón de Admin:
```
[📥 Importar Excel] [🔧 Admin] [🚪 Salir]
```

---

## 📋 ESTRUCTURA DEL ARCHIVO EXCEL

### **OPCIÓN 1: ARCHIVO ÚNICO CON 3 HOJAS (RECOMENDADO)**

Crea un archivo Excel con **3 hojas (tabs)**:

#### **Hoja 1: "Destaraje"**

| Ticket | Proveedor | Material | Kg | Fecha Entrada | Fecha Salida |
|--------|-----------|----------|----:|---------------:|-------------:|
| 9260 | Jose Enrique | MIXTO | 650 | 2026-04-23 | 2026-04-24 |
| 9251 | Juana | PET | 1000 | 2026-04-23 | 2026-04-24 |
| V | Venta | TAMBO | 400 | 2026-04-24 | 2026-04-24 |

**Columnas obligatorias:**
- ✅ Ticket (texto)
- ✅ Proveedor (texto)
- ✅ Material (texto)
- ✅ Kg (número)
- ✅ Fecha Entrada (formato: YYYY-MM-DD o fecha de Excel)
- ✅ Fecha Salida (formato: YYYY-MM-DD o fecha de Excel)

---

#### **Hoja 2: "Produccion"**

| Ticket | Cliente | Material | Kg | Fecha Entrada | Fecha Salida |
|--------|---------|----------|----:|---------------:|-------------:|
| P | Produccion | PELETIZADO | 1800 | 2026-04-24 | 2026-04-24 |
| P | Lavado | LECHERO LAVADO | 800 | 2026-04-24 | 2026-04-24 |

**Columnas obligatorias:**
- ✅ Ticket (texto, típicamente "P")
- ✅ Cliente (texto)
- ✅ Material (texto)
- ✅ Kg (número)
- ✅ Fecha Entrada (formato: YYYY-MM-DD)
- ✅ Fecha Salida (formato: YYYY-MM-DD)

---

#### **Hoja 3: "Pagos"**

| Ticket | Proveedor | Material | Kg | Precio/Kg | Total | Pagado | Fecha |
|--------|-----------|----------|----:|-----------:|-------:|--------:|------:|
| 9260 | Jose Enrique | MIXTO | 650 | 10 | 6500 | 6500 | 2026-04-24 |
| 9251 | Juana | PET | 1000 | 8.5 | 8500 | 8000 | 2026-04-24 |

**Columnas obligatorias:**
- ✅ Ticket (texto)
- ✅ Proveedor (texto)
- ✅ Material (texto)
- ✅ Kg (número)
- ✅ Precio/Kg (número)
- ✅ Total (número)
- ✅ Pagado (número)
- ✅ Fecha (formato: YYYY-MM-DD)

---

### **OPCIÓN 2: ARCHIVOS SEPARADOS**

Puedes importar archivos individuales:
- `destaraje.xlsx` → Solo con columnas de Destaraje
- `produccion.xlsx` → Solo con columnas de Producción
- `pagos.xlsx` → Solo con columnas de Pagos

En este caso, al importar selecciona:
```
¿Qué deseas importar?
[📦 Solo Destaraje]
```

---

## 🚀 PROCESO DE IMPORTACIÓN

### **Paso 1: Descargar Plantilla (Opcional)**

1. Click en **[📥 Importar Excel]**
2. Click en **[📄 Descargar Plantilla Excel]**
3. Se descargará `PLANTILLA_EVE_CONTROL.xlsx` con datos de ejemplo
4. Abre la plantilla y reemplaza los datos de ejemplo con tus datos reales

### **Paso 2: Preparar tu Archivo**

✅ **Formato de fechas:** `YYYY-MM-DD` (Ej: 2026-04-24)
✅ **Números:** Sin comas, usar punto decimal (Ej: 1250.50)
✅ **Texto:** Sin caracteres especiales raros
✅ **Nombres de hojas:** Deben ser exactamente "Destaraje", "Produccion", "Pagos"

### **Paso 3: Importar**

1. Click en **[📥 Importar Excel]**
2. Seleccionar tipo de importación:
   - 📦 Archivo completo (con 3 hojas) ← **Recomendado**
   - 📦 Solo Destaraje
   - 🏭 Solo Producción
   - 💰 Solo Pagos

3. Click en **[Seleccionar Archivo Excel]**
4. Elegir tu archivo `.xlsx` o `.xls`
5. **Vista Previa:** Verás un resumen de los datos
6. **Opcional:** Marcar ⚠️ "Reemplazar datos existentes" si quieres borrar todo antes de importar
7. Click en **[📥 Importar Datos]**
8. ✅ Verás mensaje de confirmación

---

## ⚠️ OPCIÓN: REEMPLAZAR DATOS EXISTENTES

Si marcas la casilla **"Reemplazar datos existentes"**:
- ❌ Se **ELIMINARÁN** todos los registros actuales del módulo seleccionado
- ✅ Se importarán SOLO los datos del archivo Excel

**Ejemplo:**
```
Si seleccionas "Solo Destaraje" + "Reemplazar datos":
→ Se borrarán TODOS los registros de Destaraje
→ Se cargarán SOLO los del archivo Excel
→ Producción y Pagos NO se tocan
```

---

## 📝 EJEMPLO DE DATOS

### **Tickets numéricos (Destaraje normal):**
```
Ticket: 9260
Proveedor: Jose Enrique
Material: MIXTO
```

### **Tickets de Producción:**
```
Ticket: P
Cliente: Produccion
Material: PELETIZADO
```

### **Tickets de Venta:**
```
Ticket: V
Proveedor: Venta
Material: TAMBO (se marcará como PIEZAS automáticamente)
```

---

## 🔧 FORMATOS ACEPTADOS

✅ `.xlsx` (Excel moderno)
✅ `.xls` (Excel antiguo)

---

## 💡 CONSEJOS

1. **Descarga la plantilla primero** para ver la estructura exacta
2. **Valida fechas:** Usa formato YYYY-MM-DD
3. **Revisa números:** Sin símbolos de moneda, sin comas
4. **Nombres exactos:** Las hojas deben llamarse "Destaraje", "Produccion", "Pagos"
5. **Prueba con pocos datos** primero antes de importar todo
6. **Backup:** Exporta tus datos actuales antes de usar "Reemplazar datos"

---

## ❓ PREGUNTAS FRECUENTES

### **¿Qué pasa si mis fechas están en otro formato?**
El sistema intenta convertirlas automáticamente. Si están en formato de Excel (número de días desde 1900), se convertirán correctamente.

### **¿Puedo importar datos parciales?**
Sí. Si solo tienes Destaraje, importa solo esa hoja. No es necesario tener las 3.

### **¿Los datos se duplican si importo dos veces?**
Si NO marcas "Reemplazar datos", se **agregan** a los existentes.
Si SÍ marcas "Reemplazar datos", se **eliminan** los viejos.

### **¿Puedo editar después de importar?**
Sí. Todos los registros importados se pueden editar o eliminar normalmente desde el sistema.

---

## 🎓 FLUJO COMPLETO RECOMENDADO

```
1. Exportar datos actuales (backup) → CSV desde Reportes
2. Descargar plantilla Excel → Botón en modal de importación
3. Llenar plantilla con tus datos
4. Importar archivo completo → Sin "Reemplazar"
5. Verificar que todo se importó bien
6. Si hay errores, eliminar y volver a intentar
```

---

**Sistema EVE Control v2.0 - EVERPLASTIC**
