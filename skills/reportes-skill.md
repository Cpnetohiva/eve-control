# 📊 SKILL: REPORTES Y FORMATOS - EVE CONTROL

## 🎯 OBJETIVO

Esta skill proporciona plantillas, funciones y mejores prácticas para generar reportes consistentes en formato TXT, PDF y CSV para el sistema EVE Control.

---

## 📋 FORMATO ESTÁNDAR v1.1

### **Plantilla Base de Reportes TXT**

```
================================
EVE CONTROL - EVERPLASTIC
================================

REPORTE: [NOMBRE DEL MÓDULO]
PERIODO: [DESCRIPCIÓN DEL PERIODO]
FECHA: DD-MM-YYYY HH:MM

--------------------------------
RESUMEN EJECUTIVO
--------------------------------
Total Registros: XXX
Total KG: XXX,XXX kg
[Métricas específicas adicionales]

--------------------------------
DESGLOSE POR [CATEGORÍA]
--------------------------------
[Tabla de datos agrupados]

--------------------------------
DETALLE DE REGISTROS
--------------------------------
[Tabla completa de registros]

================================
Generado: DD-MM-YYYY HH:MM
Sistema: EVE Control v2.0
================================
```

---

## 🔧 FUNCIONES DE GENERACIÓN

### **1. Exportar a TXT**

```javascript
function exportarModuloTXT(modulo, registros) {
    const fecha = obtenerFechaMexico();
    let contenido = `================================\n`;
    contenido += `EVE CONTROL - EVERPLASTIC\n`;
    contenido += `================================\n\n`;
    contenido += `REPORTE: ${modulo.toUpperCase()}\n`;
    contenido += `FECHA: ${fecha}\n`;
    contenido += `TOTAL REGISTROS: ${registros.length}\n\n`;
    
    // Encabezados según módulo
    if (modulo === 'Destaraje') {
        contenido += `TICKET\tPROVEEDOR\tMATERIAL\tKG\tF.ENTRADA\tF.SALIDA\n`;
        contenido += `${'='.repeat(80)}\n`;
        registros.forEach(r => {
            contenido += `${r.ticket}\t${r.proveedor}\t${r.material}\t${r.kg}\t${r.fechaEntrada}\t${r.fechaSalida}\n`;
        });
    } else if (modulo === 'Produccion') {
        contenido += `TICKET\tCLIENTE\tMATERIAL\tKG\tF.ENTRADA\tF.SALIDA\n`;
        contenido += `${'='.repeat(80)}\n`;
        registros.forEach(r => {
            contenido += `${r.ticket}\t${r.cliente}\t${r.material}\t${r.kg}\t${r.fechaEntrada}\t${r.fechaSalida}\n`;
        });
    } else if (modulo === 'Pagos') {
        contenido += `TICKET\tPROVEEDOR\tMATERIAL\tKG\tPRECIO/KG\tTOTAL\tPAGADO\tFECHA\n`;
        contenido += `${'='.repeat(100)}\n`;
        registros.forEach(r => {
            contenido += `${r.ticket}\t${r.proveedor}\t${r.material}\t${r.kg}\t$${r.precioKg}\t$${r.total}\t$${r.pagado}\t${r.fechaPago}\n`;
        });
    }
    
    contenido += `\n${'='.repeat(80)}\n`;
    contenido += `Generado: ${new Date().toLocaleString('es-MX')}\n`;
    contenido += `Sistema: EVE Control v2.0\n`;
    contenido += `================================\n`;
    
    const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
    descargarArchivo(blob, `${modulo}_${fecha}.txt`);
    showSuccess('Reporte TXT generado');
}
```

---

### **2. Exportar a PDF**

```javascript
function exportarModuloPDF(modulo, registros) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    // Header
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('EVE CONTROL - EVERPLASTIC', 105, 15, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`REPORTE: ${modulo.toUpperCase()}`, 105, 25, { align: 'center' });
    
    doc.setFontSize(10);
    doc.text(`Fecha: ${obtenerFechaMexico()}`, 105, 32, { align: 'center' });
    doc.text(`Total Registros: ${registros.length}`, 105, 38, { align: 'center' });
    
    // Tabla
    let headers, body;
    
    if (modulo === 'Destaraje') {
        headers = [['Ticket', 'Proveedor', 'Material', 'Kg', 'F. Entrada', 'F. Salida']];
        body = registros.map(r => [
            r.ticket,
            r.proveedor,
            r.material,
            Math.round(r.kg),
            r.fechaEntrada,
            r.fechaSalida
        ]);
    } else if (modulo === 'Produccion') {
        headers = [['Ticket', 'Cliente', 'Material', 'Kg', 'F. Entrada', 'F. Salida']];
        body = registros.map(r => [
            r.ticket,
            r.cliente,
            r.material,
            Math.round(r.kg),
            r.fechaEntrada,
            r.fechaSalida
        ]);
    } else if (modulo === 'Pagos') {
        headers = [['Ticket', 'Proveedor', 'Material', 'Kg', '$/Kg', 'Total', 'Pagado', 'Fecha']];
        body = registros.map(r => [
            r.ticket,
            r.proveedor,
            r.material,
            Math.round(r.kg),
            `$${r.precioKg}`,
            `$${Math.round(r.total)}`,
            `$${Math.round(r.pagado)}`,
            r.fechaPago
        ]);
    }
    
    doc.autoTable({
        head: headers,
        body: body,
        startY: 45,
        theme: 'grid',
        headStyles: { 
            fillColor: [0, 119, 182],
            fontSize: 9,
            fontStyle: 'bold'
        },
        styles: { 
            fontSize: 8,
            cellPadding: 2
        },
        columnStyles: {
            0: { cellWidth: 20 },  // Ticket
        }
    });
    
    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(
            `Sistema EVE Control v2.0 - Página ${i} de ${pageCount}`,
            105,
            doc.internal.pageSize.height - 10,
            { align: 'center' }
        );
    }
    
    const fecha = obtenerFechaMexico();
    doc.save(`${modulo}_${fecha}.pdf`);
    showSuccess('Reporte PDF generado');
}
```

---

### **3. Exportar a CSV**

```javascript
function exportarModuloCSV(modulo, registros) {
    let datos;
    
    if (modulo === 'Destaraje') {
        datos = registros.map(r => ({
            Ticket: r.ticket,
            Proveedor: r.proveedor,
            Material: r.material,
            Kg: r.kg,
            'Fecha Entrada': r.fechaEntrada,
            'Fecha Salida': r.fechaSalida
        }));
    } else if (modulo === 'Produccion') {
        datos = registros.map(r => ({
            Ticket: r.ticket,
            Cliente: r.cliente,
            Material: r.material,
            Kg: r.kg,
            'Fecha Entrada': r.fechaEntrada,
            'Fecha Salida': r.fechaSalida
        }));
    } else if (modulo === 'Pagos') {
        datos = registros.map(r => ({
            Ticket: r.ticket,
            Proveedor: r.proveedor,
            Material: r.material,
            Kg: r.kg,
            'Precio/Kg': r.precioKg,
            Total: r.total,
            Pagado: r.pagado,
            Fecha: r.fechaPago
        }));
    }
    
    const fecha = obtenerFechaMexico();
    exportarCSV(datos, `${modulo}_${fecha}.csv`);
    showSuccess('Reporte CSV generado');
}
```

---

## 📊 REPORTES CON DESGLOSES

### **Desglose por Proveedor/Cliente**

```javascript
function generarDesgloseProveedor(registros) {
    const desglose = {};
    
    registros.forEach(r => {
        const proveedor = r.proveedor || r.cliente;
        if (!desglose[proveedor]) {
            desglose[proveedor] = {
                registros: 0,
                totalKg: 0,
                materiales: new Set()
            };
        }
        desglose[proveedor].registros++;
        desglose[proveedor].totalKg += r.kg;
        desglose[proveedor].materiales.add(r.material);
    });
    
    let texto = '\n--------------------------------\n';
    texto += 'DESGLOSE POR PROVEEDOR\n';
    texto += '--------------------------------\n';
    
    Object.entries(desglose)
        .sort((a, b) => b[1].totalKg - a[1].totalKg)
        .forEach(([proveedor, datos]) => {
            texto += `\n${proveedor}:\n`;
            texto += `  Registros: ${datos.registros}\n`;
            texto += `  Total kg: ${formatearKg(datos.totalKg)}\n`;
            texto += `  Materiales: ${Array.from(datos.materiales).join(', ')}\n`;
        });
    
    return texto;
}
```

### **Desglose por Material**

```javascript
function generarDesgloseMaterial(registros) {
    const desglose = {};
    
    registros.forEach(r => {
        if (!desglose[r.material]) {
            desglose[r.material] = {
                registros: 0,
                totalKg: 0
            };
        }
        desglose[r.material].registros++;
        desglose[r.material].totalKg += r.kg;
    });
    
    let texto = '\n--------------------------------\n';
    texto += 'DESGLOSE POR MATERIAL\n';
    texto += '--------------------------------\n';
    
    Object.entries(desglose)
        .sort((a, b) => b[1].totalKg - a[1].totalKg)
        .forEach(([material, datos]) => {
            texto += `\n${material}:\n`;
            texto += `  Registros: ${datos.registros}\n`;
            texto += `  Total kg: ${formatearKg(datos.totalKg)}\n`;
        });
    
    return texto;
}
```

---

## 🎨 BEST PRACTICES

### **1. Nomenclatura de Archivos**

```
[modulo]_[fecha].ext

Ejemplos:
- Destaraje_2026-04-28.txt
- Produccion_2026-04-28.pdf
- Pagos_2026-04-28.csv
```

### **2. Formato de Fechas**

```javascript
// En archivos: YYYY-MM-DD
const fecha = obtenerFechaMexico(); // "2026-04-28"

// En reportes: DD-MM-YYYY HH:MM
const fechaReporte = new Date().toLocaleString('es-MX');
```

### **3. Formato de Números**

```javascript
// Kilogramos con separador de miles
function formatearKg(kg) {
    return kg.toLocaleString('es-MX', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    }) + ' kg';
}

// Moneda
function formatearMoneda(cantidad) {
    return '$' + cantidad.toLocaleString('es-MX', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}
```

### **4. Validación Antes de Exportar**

```javascript
function validarAntesDeExportar(registros, modulo) {
    if (!registros || registros.length === 0) {
        showError(`No hay registros de ${modulo} para exportar`);
        return false;
    }
    
    if (registros.length > 10000) {
        if (!confirm(`Hay ${registros.length} registros. ¿Continuar?`)) {
            return false;
        }
    }
    
    return true;
}
```

---

## 📝 EJEMPLOS DE USO

### **Ejemplo 1: Exportar registros filtrados**

```javascript
// Obtener registros filtrados
const filtrados = obtenerRegistrosFiltradosDestaraje();

// Validar
if (!validarAntesDeExportar(filtrados, 'Destaraje')) return;

// Exportar
exportarModuloTXT('Destaraje', filtrados);
```

### **Ejemplo 2: Reporte completo con desgloses**

```javascript
function generarReporteCompleto(modulo, registros) {
    let contenido = generarHeaderReporte(modulo, registros);
    contenido += generarResumenEjecutivo(registros);
    contenido += generarDesgloseMaterial(registros);
    contenido += generarDesglose Proveedor(registros);
    contenido += generarTablaDetalle(modulo, registros);
    contenido += generarFooterReporte();
    
    return contenido;
}
```

### **Ejemplo 3: Exportar con fecha personalizada**

```javascript
function exportarPorPeriodo(modulo, fechaInicio, fechaFin) {
    const registros = obtenerRegistrosPorPeriodo(fechaInicio, fechaFin);
    const nombreArchivo = `${modulo}_${fechaInicio}_a_${fechaFin}.pdf`;
    
    exportarModuloPDF(modulo, registros, nombreArchivo);
}
```

---

## 🔄 INTEGRACIÓN CON EL SISTEMA

### **Ubicación de Funciones**

```
js/
├── modulos-comunes.js     → Funciones base de exportación
├── reportes.js            → Reportes consolidados
├── destaraje.js          → obtenerRegistrosFiltradosDestaraje()
├── produccion.js         → obtenerRegistrosFiltradosProduccion()
└── pagos.js              → obtenerRegistrosFiltradosPagos()
```

### **Flujo de Exportación**

```
1. Usuario hace click en botón exportar
   ↓
2. Se llama a obtenerRegistrosFiltrados()
   ↓
3. Se valida que haya registros
   ↓
4. Se llama a exportarModulo[TXT|PDF|CSV]()
   ↓
5. Se genera el archivo
   ↓
6. Se descarga automáticamente
   ↓
7. Se muestra mensaje de éxito
```

---

## 🎯 CHECKLIST DE CALIDAD

Antes de generar un reporte, verificar:

- [ ] Los datos están ordenados (por fecha, ticket, etc.)
- [ ] Los números tienen formato correcto (separadores de miles)
- [ ] Las fechas tienen formato consistente
- [ ] El header incluye toda la información necesaria
- [ ] El footer incluye timestamp de generación
- [ ] El nombre del archivo es descriptivo
- [ ] No hay datos sensibles innecesarios
- [ ] El archivo se puede abrir correctamente
- [ ] Los totales cuadran

---

## 📚 REFERENCIA RÁPIDA

### **Funciones Principales**

```javascript
exportarModuloTXT(modulo, registros)
exportarModuloPDF(modulo, registros)
exportarModuloCSV(modulo, registros)
generarDesgloseMaterial(registros)
generarDesglose Proveedor(registros)
validarAntesDeExportar(registros, modulo)
formatearKg(numero)
formatearMoneda(numero)
```

### **Módulos Disponibles**

- `'Destaraje'`
- `'Produccion'`
- `'Pagos'`

### **Campos por Módulo**

**Destaraje:**
- ticket, proveedor, material, kg, fechaEntrada, fechaSalida

**Producción:**
- ticket, cliente, material, kg, fechaEntrada, fechaSalida

**Pagos:**
- ticket, proveedor, material, kg, precioKg, total, pagado, fechaPago

---

**Sistema EVE Control v2.0 - Skill de Reportes v1.1**
