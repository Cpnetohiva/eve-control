# 📊 ESTADO DEL PROYECTO — EVE CONTROL v3.0
# EVERPLASTIC — Mehicaso Group
# Fecha: 01/09/2026

---

## 🌐 ACCESO Y REPOSITORIO

```
URL producción:   https://cpnetohiva.github.io/eve-control-v2/
GitHub repo:      cpnetohiva/eve-control-v2
Firebase:         Project ID: everplastic
Último commit:    6af2d5c (reportes de rendimiento + meta eficiencia configurable)
```

### Usuarios del sistema
```
Login vía Firebase Authentication (email = username@everplastic.local).
Contraseñas NO se documentan aquí (evitar texto plano en el repo):
ver docs/superpowers/credenciales-phase2.json (gitignored, local).

Admin     → permisos totales
Matilde   → destaraje + reportes
Christian → produccion + pagos + reportes
```

---

## ✅ MÓDULOS COMPLETADOS Y EN PRODUCCIÓN

### 1. Destaraje (`destaraje.js` — 482 líneas)
- CRUD + autocompletado dinámico
- 3 tabs: Hoy / Esta Semana / Todos
- Filtros en tiempo real + exportaciones TXT/PDF/CSV
- Reconocimiento de voz (hold-to-record, es-MX)
- Ya no muestra registros de Ventas (ticket "V"): commit `3e789ce`
  quitó del todo la lógica de venta-en-destaraje (formulario,
  datalist de clientes, reportes). Ventas vive solo en `ventas.js`.
- Bug de case-sensitivity corregido (01/09/2026): el ticket se
  normaliza a mayúscula al guardar y `clasificarDestaraje()` en
  `auth.js` compara con `ticket.toUpperCase() === 'V'`. El único
  registro huérfano por esto (ticket "v" minúscula, proveedor
  VENTAS, CAJA CO30, 1500 kg) fue migrado manualmente a `ventas`
  y marcado `migrado: true`.

### 2. Producción (`produccion.js` — 472 líneas)
- CRUD + filtros + exportaciones TXT/PDF/CSV
- 3 tabs: Hoy / Esta Semana / Todos

### 3. Pagos (`pagos.js` — 668 líneas)
- CRUD de pagos a proveedores
- Ministraciones semanales con control de flujo
- Integración automática con CxP al registrar pago
- 3 tabs + filtros + exportaciones TXT/PDF/CSV

### 4. Control de Producción (`control-produccion.js` — 663 líneas)
- Procesos: SELECCION, EMPACADO, MOLIENDA, LAVADO, PELETIZADO,
  PRODUCCION_CAJAS (=Inyección), PRODUCCION_TAMBOS (=Soplado)
- Formulario dinámico + cálculos automáticos de eficiencia
- Trazabilidad básica por ticket
- 3 tabs + filtros + exportación TXT

### 5. Auditoría OCR (`admin-auditoria.js` — 933 líneas) ✅
- Carga múltiple de fotos con Tesseract.js
- OCR lee: ticket, proveedor, material, peso, fecha
- 4 estados: COINCIDE / CON_DIFERENCIAS / NO_VERIFICADO / SIN_REGISTRO
- Botón "Generar CxP" (solo tickets COINCIDE)
- Dos colecciones vinculadas por ID:
  - `auditoria_fotos` → evidencia visual (base64)
  - `auditorias` → resultados por lote
- Regla de fecha de corte: 01/07/2026

### 6. Lista de Precios (`precios.js` — 368 líneas) ✅
- Histórico completo, precio nunca se sobreescribe
- `obtenerPrecioVigente(material, fecha)` en utils.js
- Colección Firebase: `precios`

### 7. Comisiones históricas ✅
- Mismo modelo que precios, con períodos
- Seed en Firestore: $0.10/kg hasta 31/08/2026,
  $0.00/kg desde 01/09/2026
- `obtenerComisionVigente(fecha)` en utils.js
- Configurable desde Admin
- Colección Firebase: `comisiones`

### 8. Cuentas por Pagar — CxP (`cxp.js` — 775 líneas) ✅
- Generación automática desde auditoría (tickets COINCIDE)
- Total = kg × (precioVigente + comisiónVigente)
- Tickets anteriores al 01/07/2026: CxP sin foto requerida
- Tickets desde 01/07/2026: requieren auditoría o aprobación
  manual Admin con motivo escrito
- Distribución FIFO para pagos generales
- Saldo a favor: excedente se aplica al siguiente lote
- 3 tipos de reporte: Estado de cuenta / Consolidado /
  Historial de pagos — exportaciones TXT/PDF/CSV/Telegram
- Colección Firebase: `cuentas_por_pagar`

### 9. Rendimientos y Subproductos (`rendimientos.js`) ✅
- Composición porcentual por material con histórico de versiones
- Validación: suma siempre = 100%
- Motivo obligatorio al editar
- Simulador de lote
- `procesosValidos[]` + `procesoSugerido` por subproducto
  (el destino real lo decide el operador en cada proceso)
- Pseudo-procesos: VENTA_DIRECTA, INYECCIÓN (=PRODUCCION_CAJAS),
  SOPLADO (=PRODUCCION_TAMBOS)
- Colección Firebase: `composiciones`
- **Dato real en producción:** MIXTO v4 vigente con
  porcentajes reales (Cristal 50%, Lechero 10%, Verde 10%,
  Multicolor 10%, Suero 5%, Etiqueta 10%, Basura 5%)

### 10. PWA / Modo Offline ✅ (~90%)
- `manifest.json` + íconos generados con Canvas API
- `service-worker.js` cache-first + fallback a index.html
- `offline.js`: cola IndexedDB + 4 estados en header
  (🟢 En línea / 🔴 Sin conexión / 🔄 Sincronizando / ✅ Sincronizado)
- `db.enablePersistence({synchronizeTabs:true})`
- ⚠️ Caché offline incompleto (ver Pendientes)

### 11. Admin Panel ✅
- CRUD de usuarios con permisos por módulo
- Backup/restore JSON + importación Excel
- Borrado de datos con confirmación escrita ("CONFIRMAR")
- Panel de comisiones con histórico
- ⚠️ FECHA_CORTE no configurable desde UI (ver Pendientes)

### 12. Reportes (`reportes.js` — 538 líneas) ✅
- Incluye Control de Producción y CxP en selector
- Dropdowns dinámicos de Proveedor/Material/Cliente
- Vista previa antes de exportar
- TXT/PDF/CSV + Telegram con PDF adjunto

### 13. Utilidades (`utils.js` — 361 líneas) ✅
- `formatearFecha()` / `parsearFecha()`
- `obtenerPrecioVigente()` / `obtenerComisionVigente()`
- CRUD Firebase completo
- `sendTelegramMessage` / `sendTelegramDocument`

### 14. Ventas (`ventas.js` — 1014 líneas) ✅ — commit `7b34b7d`
- Colección Firebase: `ventas`. Folio auto-generado `V-YYYY-NNN`
- Múltiples líneas por folio, unidad automática KG/PZ por producto
- Precios variables por venta, totales calculados en tiempo real
- 3 tabs + filtros + exportaciones TXT/PDF/CSV
- Migración de registros `ticket="V"` desde Destaraje (botón manual
  "Migrar" + función `migrarRegistroDestarajeAVenta`)

### 15. Inventario (`inventario.js` — 606 líneas) ✅ — commit `60839c4`
- Cálculo automático cruzando Destaraje / Control de Producción / Ventas
- Etapas: RECEPCIÓN → SELECCIÓN → EMPACADO → MOLIENDA → LAVADO →
  MEZCLADO → PELETIZADO → INYECCIÓN → SOPLADO → PRODUCTO TERMINADO → VENDIDO
- Colores de estado, ajuste manual solo Admin con motivo obligatorio
- Colección Firebase: `inventario`

### 16. Trazabilidad (`trazabilidad.js` — 544 líneas) ✅ — commit `6b3c2c8`
- Búsqueda multi-criterio: ticket, proveedor, material, proceso, folio venta
- Cadena completa Destaraje → Composición → Procesos → Venta
- Resumen global: Entrada / Vendido / Merma / Inventario / Margen
- Exportable a PDF

### 17. Reportes de Rendimiento ✅ — commit `6af2d5c`
- Reporte por material (real vs. composición esperada)
- Reporte por operador (eficiencia vs. meta, meta configurable desde Admin)
- Reporte por ticket (trazabilidad completa)
- Integrados en módulo Reportes (`reportes.js`)

---

## 🟡 PENDIENTES MENORES (fixes al sistema existente)

### P1, P2, P3 — Resueltos (commit `60839c4`)
- Caché offline ahora incluye `precios`, `cuentas_por_pagar`,
  `auditorias`, `auditoria_fotos`, `composiciones`
- `FECHA_CORTE` se lee desde `Firestore config/sistema.fechaCorteAuditoria`,
  editable desde Admin
- `NOMBRE_PROCESO_UI` agregado en `config.js`

### P4 — Materiales y proveedores reales en config.js (pendiente)
`MATERIALES_COMUNES` en `config.js` todavía no incluye
`CAJA CH25` ni `CAJA AGRO20` (solo `CAJA CO30`).
**Fix:** agregar ambos materiales a la lista.

---

## 🗂️ COLECCIONES FIREBASE

| Colección | Estado |
|---|---|
| `users` | ✅ Con datos reales |
| `destaraje` | ✅ Con datos reales |
| `produccion` | ✅ Con datos reales |
| `pagos` | ✅ Con datos reales |
| `ministraciones` | ✅ Con datos reales |
| `control_produccion` | ✅ Con datos reales |
| `auditoria_fotos` | ✅ Con datos reales |
| `auditorias` | ✅ Con datos reales |
| `precios` | ✅ Con datos reales |
| `comisiones` | ✅ Con datos seed ($0.10 y $0.00) |
| `cuentas_por_pagar` | ✅ Con datos de prueba |
| `composiciones` | ✅ MIXTO v4 vigente (datos reales) |
| `proveedores` | ✅ Creada (saldo a favor) |
| `config` | ✅ Con `fechaCorteAuditoria` y `metaEficiencia` |
| `ventas` | ✅ Con datos reales |
| `inventario` | ✅ Creada |

---

## 📋 PROMPTS PARA CLAUDE CODE

| Archivo | Contenido |
|---|---|
| `PROMPT_CLAUDE_CODE.md` | Sistema base completo (1,120 líneas) |
| `PROMPT_MODULOS_NUEVOS.md` | Auditoría + Precios + CxP (880 líneas) |
| `PROMPT_VENTAS_INVENTARIO.md` | Ventas + Rendimientos + Inventario |

### Mensaje para retomar tras `/clear`
```
Lee estos archivos en orden:
1. PROMPT_CLAUDE_CODE.md
2. PROMPT_MODULOS_NUEVOS.md
3. PROMPT_VENTAS_INVENTARIO.md

Revisa el working tree para entender qué está implementado.

Pendientes antes de módulos nuevos:
  P1: Agregar a caché offline (offline.js):
      precios, cuentas_por_pagar, auditorias,
      auditoria_fotos, composiciones
  P2: FECHA_CORTE configurable en admin-config.js
      (hoy hardcodeada en cxp.js como '2026-07-01')
  P3: Agregar NOMBRE_PROCESO_UI en config.js:
      PRODUCCION_CAJAS → "Inyección"
      PRODUCCION_TAMBOS → "Soplado"

Después: js/ventas.js según PROMPT_VENTAS_INVENTARIO.md.
Confirmar al terminar cada módulo antes de continuar.
```

---

## 💡 DECISIONES DE NEGOCIO — DEFINITIVAS

| Decisión | Valor |
|---|---|
| Comisión/kg | +$0.10 hasta 31/08/2026, $0.00 desde 01/09/2026 |
| Fecha corte foto | 01/07/2026 (configurable en Admin) |
| Saldo a favor | Queda en `proveedores.saldoAFavor`, auto-aplica |
| Conflicto offline | Firebase gana siempre |
| Fechas UI | dd/mm/aaaa |
| Fechas Firebase | YYYY-MM-DD |
| PRODUCCION_CAJAS | = Inyección (cajas = inyección) |
| PRODUCCION_TAMBOS | = Soplado (tambos = soplado) |
| Composición destino | No es fijo: `procesosValidos[]` + `procesoSugerido` |
| Datos históricos | No se cargarán, sistema arranca desde activación |
| Inventario ajuste | Solo Admin, motivo obligatorio, con historial |
| Rendimientos edición | Supervisor o Admin, motivo obligatorio |
| Ventas folio | V-YYYY-NNN auto-generado |
| Ventas líneas | Múltiples productos por folio permitidos |

---

## 🗺️ ORDEN DE TRABAJO — LO QUE QUEDA

```
PENDIENTE:
  1. Materiales y proveedores reales en config.js (P4):
     agregar CAJA CH25 y CAJA AGRO20 a MATERIALES_COMUNES
  2. Caché offline: agregar 'ventas' e 'inventario' a
     guardarCacheDatos()/cargarCacheDatos()
  3. Verificación final PWA (Lighthouse ≥ 90)
  4. Firestore Security Rules: revisar reglas de producción
     (ver hallazgo de seguridad, 01/09/2026)
  5. Los 9 registros basura restantes en 'destaraje'
     (SF x2, ILEGIBLE-1/2/3, PRUEBA-8D x2, SIN_FOLIO)
```
