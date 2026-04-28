# 🎯 EVE CONTROL v2.0 - SISTEMA DE CONTROL OPERATIVO

## 📊 EVERPLASTIC - MEHICASO GROUP

Sistema modular completo para control de **Destaraje**, **Producción**, **Pagos** y **Reportes** con arquitectura escalable y Firebase como backend.

---

## 🚀 CARACTERÍSTICAS PRINCIPALES

### ✅ **ARQUITECTURA MODULAR**
- 8 archivos JavaScript independientes
- 1 archivo CSS centralizado
- Fácil mantenimiento y escalabilidad
- Código organizado por funcionalidad

### ✅ **MÓDULOS IMPLEMENTADOS**

#### 📦 **Destaraje y Ventas**
- Registro de entrada/salida de material
- Filtrado por proveedor y material
- Vistas: Hoy, Esta Semana, Todos
- Exportación CSV
- Autocompletado inteligente

#### 🏭 **Producción**
- Control de producción diaria
- Seguimiento de clientes
- Estadísticas en tiempo real
- Vistas temporales (día/semana/total)

#### 💰 **Pagos a Proveedores**
- Control de pagos con ministraciones semanales
- Cálculo automático de totales
- Flujo de efectivo semanal
- Saldo disponible y % ejecutado

#### 📊 **Reportes**
- Reporte diario automático
- Reporte semanal consolidado
- Reportes personalizados por rango de fechas
- Exportación PDF con jsPDF
- Envío automático a Telegram (8:00 PM)

### ✅ **SISTEMA DE USUARIOS**
- Autenticación con Firebase
- Roles y permisos por módulo
- Panel de administración
- Gestión de usuarios activos/inactivos
- Sesión persistente

### ✅ **RECONOCIMIENTO DE VOZ**
- Captura de datos por voz (español México)
- Modo "mantener presionado"
- Parseo inteligente de dictado
- Compatible desktop y móvil
- Disponible en todos los módulos

### ✅ **TELEGRAM INTEGRATION**
- Envío de reportes automáticos
- Notificaciones en tiempo real
- Prueba de conexión
- Formato HTML

---

## 📁 ESTRUCTURA DE ARCHIVOS

```
eve-control-v2/
├── index.html                 # HTML principal
├── css/
│   └── styles.css            # Estilos completos
└── js/
    ├── config.js             # Firebase + constantes
    ├── utils.js              # Utilidades generales
    ├── auth.js               # Autenticación y usuarios
    ├── destaraje.js          # Módulo de destaraje
    ├── produccion.js         # Módulo de producción
    ├── pagos.js              # Módulo de pagos
    ├── reportes.js           # Módulo de reportes
    └── voz.js                # Reconocimiento de voz
```

---

## 🔧 CONFIGURACIÓN INICIAL

### 1️⃣ **Subir a GitHub Pages**

```bash
# 1. Crear repositorio en GitHub
# 2. Clonar localmente
git clone https://github.com/[usuario]/eve-control-v2.git
cd eve-control-v2

# 3. Copiar archivos
# Copiar index.html, css/, js/ a la raíz del repo

# 4. Commit y push
git add .
git commit -m "EVE Control v2.0 - Sistema completo"
git push origin main

# 5. Activar GitHub Pages
# Settings > Pages > Source: main branch
```

**URL final:** `https://[usuario].github.io/eve-control-v2/`

### 2️⃣ **Firebase (Ya configurado)**

El sistema ya está conectado a Firebase:
- **Project ID:** control-evecontrol
- **Colecciones:** users, destaraje, produccion, pagos, ministraciones

**⚠️ Credenciales en:** `js/config.js` (líneas 10-17)

### 3️⃣ **Telegram (Ya configurado)**

- **Bot Token:** Configurado en `js/config.js`
- **Chat ID:** 8687896128
- Reporte automático: 8:00 PM diario

---

## 👥 USUARIOS Y PERMISOS

### **Usuario Administrador (crear primero)**

Acceder a Firebase Console y crear manualmente:

```json
{
  "username": "admin",
  "password": "tu_password_seguro",
  "permissions": {
    "destaraje": true,
    "produccion": true,
    "pagos": true,
    "reportes": true,
    "admin": true
  },
  "active": true
}
```

Luego, desde el panel admin, crear usuarios adicionales.

### **Permisos Disponibles**
- ✅ **Destaraje:** Ver y agregar registros de destaraje
- ✅ **Producción:** Ver y agregar registros de producción
- ✅ **Pagos:** Ver y agregar pagos + ministraciones
- ✅ **Reportes:** Generar y enviar reportes
- ✅ **Admin:** Acceso al panel de administración

---

## 🎤 USO DE RECONOCIMIENTO DE VOZ

### **Activación**
1. Hacer clic en el botón 🎤 debajo de cada formulario
2. **Mantener presionado** mientras hablas
3. Soltar para procesar

### **Formatos de Dictado**

#### **Destaraje:**
```
"Ticket 1234 de Francisco, PET Cristal, 500, entrada 22 abril, salida 23 abril"
```

#### **Producción:**
```
"Ticket 5678 de Cliente A, PEAD, 800, entrada hoy, salida hoy"
```

#### **Pagos:**
```
"Ticket 9012 de Juan, Mixto, 700, a 8.50, pagado 5000"
```

### **Compatibilidad**
- ✅ Chrome / Edge (desktop y móvil)
- ✅ Safari (iOS/macOS)
- ❌ Firefox (no soporta Web Speech API)

---

## 📊 EXPORTACIONES

### **CSV** (todos los módulos)
- Formato tabular con headers
- Abre en Excel
- Apto para análisis

### **PDF** (reportes)
- Formato profesional con jsPDF
- Tablas con autoTable
- Logo y colores corporativos

### **Telegram** (reportes)
- Envío automático diario (8 PM)
- Envío manual desde panel de reportes
- Formato HTML con emojis

---

## 💾 BACKUP Y RESTAURACIÓN

### **Exportar Backup**
1. Panel Admin > Backup
2. Clic en "📥 Exportar BD Completa"
3. Descarga archivo `backup_eve_control_YYYY-MM-DD.json`

### **Importar Backup**
1. Panel Admin > Backup
2. Clic en "📤 Importar BD"
3. Seleccionar archivo JSON
4. ⚠️ **ADVERTENCIA:** Sobrescribe todos los datos

---

## 🎨 PERSONALIZACIÓN

### **Colores (en `css/styles.css`)**
```css
:root {
    --azul-marino: #001D3D;
    --azul-medianoche: #003566;
    --azul-claro: #0077B6;
    --celeste: #00B4D8;
    --oro: #FFC300;
    --verde: #06D6A0;
    --rojo: #EF476F;
}
```

### **Materiales Comunes (en `js/config.js`)**
```javascript
const MATERIALES_COMUNES = [
    'PET Cristal',
    'PET Color',
    'PEAD',
    'PP',
    // Agregar más...
];
```

### **Proveedores Comunes**
```javascript
const PROVEEDORES_COMUNES = [
    'Francisco',
    'Juan',
    // Agregar más...
];
```

---

## 🔒 SEGURIDAD

### ✅ **Implementado**
- Autenticación con Firebase
- Permisos por usuario/módulo
- Sesión persistente con localStorage
- Validación de datos en cliente
- HTTPS obligatorio (GitHub Pages)

### ⚠️ **Consideraciones**
- Contraseñas en texto plano en Firebase (mejorar con hash)
- Sin límite de intentos de login
- Sin timeout de sesión automático

### 🔐 **Recomendaciones**
1. Cambiar contraseñas regularmente
2. Usar contraseñas fuertes
3. No compartir credenciales
4. Revisar logs de Firebase

---

## 🐛 TROUBLESHOOTING

### **No carga la página**
- ✅ Verificar que todos los archivos estén en la estructura correcta
- ✅ Revisar consola del navegador (F12)
- ✅ Verificar que Firebase esté accesible

### **Reconocimiento de voz no funciona**
- ✅ Usar Chrome o Edge
- ✅ Dar permisos de micrófono
- ✅ En móvil: permitir micrófono en configuración del navegador

### **No se guardan datos**
- ✅ Verificar conexión a internet
- ✅ Revisar credenciales de Firebase en `config.js`
- ✅ Verificar reglas de seguridad en Firebase Console

### **Telegram no envía mensajes**
- ✅ Verificar Bot Token y Chat ID en `config.js`
- ✅ Probar con botón "🧪 Probar Telegram" en panel admin
- ✅ Verificar que el bot esté activo

---

## 📈 MÉTRICAS DEL CÓDIGO

```
Líneas totales:    ~12,000
Archivos JS:       8
Archivos CSS:      1
Archivos HTML:     1
Funciones:         80+
Colecciones DB:    5
```

---

## 🚀 ROADMAP v2.1

### **Alta Prioridad**
- [ ] Hash de contraseñas (bcrypt)
- [ ] Validación de datos en servidor (Cloud Functions)
- [ ] Edición de registros existentes
- [ ] Filtros avanzados en tablas
- [ ] Paginación en vistas "Todos"

### **Media Prioridad**
- [ ] Gráficas con Chart.js
- [ ] Dashboard ejecutivo
- [ ] Exportación a Excel con fórmulas
- [ ] Modo oscuro
- [ ] PWA (Progressive Web App)

### **Baja Prioridad**
- [ ] Multi-idioma
- [ ] Notificaciones push
- [ ] Chat interno entre usuarios
- [ ] Integración con SAT

---

## 📞 SOPORTE

### **Documentación**
- README.md (este archivo)
- Comentarios en código fuente
- Console.log para debugging

### **Contacto**
- GitHub Issues (recomendado)
- Email del administrador del sistema

---

## 📜 CHANGELOG

### **v2.0.0** (27-04-2026)
- ✅ Arquitectura modular completa
- ✅ 4 módulos operativos (Destaraje, Producción, Pagos, Reportes)
- ✅ Sistema de usuarios con permisos
- ✅ Reconocimiento de voz en español
- ✅ Exportaciones PDF y CSV
- ✅ Integración con Telegram
- ✅ Panel de administración
- ✅ Backup/Restore de base de datos

### **v1.1.0** (Backup histórico)
- Sistema monolítico funcional
- Base de código: `eve_control_v1_1__1_.html`

---

## 🎯 CRÉDITOS

**Desarrollado para:** EVERPLASTIC - Mehicaso Group  
**Sistema:** EVE Control (EVERPLASTIC Control System)  
**Versión:** 2.0.0  
**Fecha:** Abril 2026  
**Tecnologías:** HTML5, CSS3, JavaScript ES6+, Firebase, jsPDF, Web Speech API

---

## 📄 LICENCIA

Sistema propietario de EVERPLASTIC.  
Todos los derechos reservados © 2026

---

## ✅ CHECKLIST DE DESPLIEGUE

- [ ] Subir archivos a GitHub
- [ ] Activar GitHub Pages
- [ ] Crear usuario admin en Firebase
- [ ] Probar login
- [ ] Probar cada módulo
- [ ] Probar reconocimiento de voz
- [ ] Probar envío a Telegram
- [ ] Exportar backup inicial
- [ ] Documentar usuarios y contraseñas
- [ ] Capacitar usuarios finales

---

**🎉 ¡Sistema listo para producción!**

Para cualquier duda, revisar este README o consultar los comentarios en el código fuente.
