# 🚀 GUÍA RÁPIDA DE INICIO - EVE CONTROL v2.0

## ⏱️ INICIO RÁPIDO (5 MINUTOS)

### 1️⃣ **DESPLIEGUE EN GITHUB PAGES**

```bash
# En tu computadora:
1. Ir a https://github.com/new
2. Nombre del repositorio: eve-control-v2
3. Public, sin README

# En la terminal:
git clone https://github.com/[TU-USUARIO]/eve-control-v2.git
cd eve-control-v2

# Copiar todos los archivos de esta carpeta a la raíz del repo
# (index.html, css/, js/)

git add .
git commit -m "v2.0 - Sistema completo"
git push origin main

# En GitHub:
Settings > Pages > Source: main branch > Save
```

**Tu URL:** `https://[TU-USUARIO].github.io/eve-control-v2/`

---

### 2️⃣ **CREAR PRIMER USUARIO (ADMIN)**

Ir a: https://console.firebase.google.com/project/control-evecontrol/firestore

1. Abrir colección `users`
2. Clic en "Add document"
3. Document ID: (auto)
4. Fields:

```
username (string):    admin
password (string):    tu_password_aqui
active (boolean):     true
permissions (map):
  ├─ destaraje (boolean):  true
  ├─ produccion (boolean): true
  ├─ pagos (boolean):      true
  ├─ reportes (boolean):   true
  └─ admin (boolean):      true
```

5. Save

---

### 3️⃣ **ACCEDER AL SISTEMA**

1. Ir a tu URL de GitHub Pages
2. Login con:
   - Usuario: `admin`
   - Password: `[la que pusiste]`

---

### 4️⃣ **CREAR USUARIOS DESDE EL SISTEMA**

1. Clic en "🔧 Admin" (arriba derecha)
2. Tab "👥 Usuarios"
3. Clic en "+ Nuevo Usuario"
4. Llenar formulario:
   - Usuario
   - Contraseña
   - Seleccionar permisos
   - ✅ Usuario Activo
5. Guardar

---

## 🎯 FLUJO DE TRABAJO DIARIO

### **OPERADORES**

#### Destaraje:
1. Login → Módulo Destaraje
2. Llenar formulario O usar 🎤 voz
3. Clic "Agregar Registro"
4. Ver estadísticas del día

#### Producción:
1. Login → Módulo Producción
2. Registrar salidas de producción
3. Exportar CSV si necesario

#### Pagos:
1. Login → Módulo Pagos
2. Registrar pagos del día
3. Clic "📊 Ministraciones" para ver flujo semanal

### **ADMINISTRADOR**

#### Al inicio de semana:
1. Registrar ministración semanal
2. Revisar saldo disponible

#### Diariamente:
- Revisar Telegram a las 8 PM (reporte automático)

#### Al final de semana:
- Generar reporte semanal PDF
- Enviar a dirección si necesario

---

## 🎤 EJEMPLOS DE DICTADO

### Destaraje:
```
🎤 "Ticket 1234 de Francisco, PET Cristal, 500, entrada 22 abril, salida 23 abril"
```

### Producción:
```
🎤 "Ticket 5678 de Cliente A, PEAD, 800, entrada hoy, salida hoy"
```

### Pagos:
```
🎤 "Ticket 9012 de Juan, Mixto, 700, a 8.50, pagado 5000"
```

**Tip:** Hablar claro y pausado. Esperar 1 segundo entre cada dato.

---

## 📊 DASHBOARDS RÁPIDOS

### Ver totales del día:
- Tab "Hoy" en cualquier módulo
- Estadísticas en tiempo real

### Ver totales de la semana:
- Tab "Esta Semana"
- Desglose por material

### Exportar datos:
- Clic "📥 Exportar CSV"
- Abre en Excel

---

## 🆘 PROBLEMAS COMUNES

### "No puedo hacer login"
✅ Verificar que creaste el usuario en Firebase  
✅ Revisar mayúsculas/minúsculas  
✅ Verificar que `active: true`

### "No aparecen mis módulos"
✅ Revisar que el usuario tenga permisos  
✅ Cerrar sesión y volver a entrar

### "Voz no funciona"
✅ Usar Chrome o Edge  
✅ Dar permisos de micrófono  
✅ Mantener presionado el botón

### "No se guardan datos"
✅ Verificar conexión a internet  
✅ Revisar consola del navegador (F12)

---

## 📞 AYUDA

**README completo:** Ver `README.md`  
**Código fuente:** Revisar comentarios en archivos JS  
**Firebase Console:** https://console.firebase.google.com/project/control-evecontrol

---

**¡Listo para empezar! 🚀**
