const { chromium } = require('playwright');
const path = require('path');

const MANUAL_USUARIO_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 10.5pt; line-height: 1.6; }

  .cover {
    background: linear-gradient(135deg, #001D3D 0%, #00366b 100%);
    color: #fff; height: 100vh; display: flex; flex-direction: column;
    justify-content: center; align-items: center; text-align: center;
    page-break-after: always;
  }
  .cover .logo { font-size: 64pt; font-weight: 700; color: #FFC300; letter-spacing: -2px; margin-bottom: 12px; }
  .cover h1 { font-size: 22pt; font-weight: 600; margin-bottom: 6px; letter-spacing: 1px; }
  .cover h2 { font-size: 14pt; font-weight: 300; opacity: 0.85; margin-bottom: 40px; }
  .cover .divider { width: 80px; height: 3px; background: #FFC300; margin: 0 auto 40px; border-radius: 2px; }
  .cover .meta { font-size: 9pt; opacity: 0.6; }

  .page { padding: 28mm 22mm 22mm; min-height: 100vh; }
  .page-break { page-break-before: always; }

  h1.section { color: #001D3D; font-size: 17pt; font-weight: 700; border-bottom: 3px solid #FFC300; padding-bottom: 8px; margin: 0 0 20px; }
  h2.sub { color: #001D3D; font-size: 13pt; font-weight: 600; margin: 22px 0 10px; }
  h3.mini { color: #0077B6; font-size: 11pt; font-weight: 600; margin: 16px 0 8px; }

  p { margin-bottom: 10px; }

  .tip { background: #e8f5e9; border-left: 4px solid #06D6A0; padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 12px 0; font-size: 9.5pt; }
  .warn { background: #fff8e1; border-left: 4px solid #FFC300; padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 12px 0; font-size: 9.5pt; }
  .danger { background: #fde8ec; border-left: 4px solid #EF476F; padding: 10px 14px; border-radius: 0 6px 6px 0; margin: 12px 0; font-size: 9.5pt; }

  table { width: 100%; border-collapse: collapse; margin: 14px 0; font-size: 9.5pt; }
  th { background: #001D3D; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; }
  td { padding: 7px 10px; border-bottom: 1px solid #e8e8e8; }
  tr:nth-child(even) td { background: #f8f9fa; }

  ol, ul { padding-left: 20px; margin-bottom: 12px; }
  li { margin-bottom: 5px; }

  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 8.5pt; font-weight: 600; }
  .badge-green { background: #dcfce7; color: #166534; }
  .badge-red { background: #fde8ec; color: #991b1b; }
  .badge-gold { background: #fef3c7; color: #92400e; }

  .screen-box { background: #001D3D; color: #FFC300; font-family: monospace; font-size: 9pt; padding: 12px 16px; border-radius: 8px; margin: 12px 0; }
  .screen-box .label { color: #aaa; font-size: 8pt; margin-bottom: 4px; }

  .toc { background: #f8f9fa; border-radius: 8px; padding: 20px 24px; margin-bottom: 30px; }
  .toc h2 { color: #001D3D; font-size: 13pt; margin-bottom: 14px; }
  .toc ol { padding-left: 20px; }
  .toc li { margin-bottom: 6px; font-size: 10pt; }
  .toc a { color: #0077B6; text-decoration: none; }

  .step { display: flex; gap: 12px; margin: 10px 0; align-items: flex-start; }
  .step-num { background: #001D3D; color: #FFC300; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9pt; font-weight: 700; flex-shrink: 0; }

  .header-demo { background: #001D3D; color: #fff; padding: 10px 18px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; margin: 14px 0; font-size: 9.5pt; }
  .header-demo .title { color: #FFC300; font-weight: 600; }
  .header-demo .status { font-size: 8.5pt; }

  .module-card { border: 1.5px solid #e8e8e8; border-radius: 8px; padding: 14px 16px; margin: 10px 0; }
  .module-card .mc-title { font-weight: 600; color: #001D3D; margin-bottom: 6px; font-size: 10.5pt; }

  .footer { position: fixed; bottom: 10mm; left: 22mm; right: 22mm; font-size: 8pt; color: #999; border-top: 1px solid #e8e8e8; padding-top: 6px; display: flex; justify-content: space-between; }
</style>
</head>
<body>

<!-- PORTADA -->
<div class="cover">
  <div class="logo">EVE</div>
  <h1>MANUAL DE USUARIO</h1>
  <h2>EVE Control v3.0 — Sistema Operativo EVERPLASTIC</h2>
  <div class="divider"></div>
  <p style="color:#aaa;font-size:9pt;">Para colaboradores de campo y oficina</p>
  <div class="meta" style="margin-top:40px;">Mehicaso Group &nbsp;·&nbsp; Junio 2026</div>
</div>

<!-- CONTENIDO -->
<div class="page">

  <h1 class="section">Contenido</h1>
  <div class="toc">
    <ol>
      <li>¿Qué es EVE Control?</li>
      <li>Cómo acceder — Login</li>
      <li>Pantalla principal</li>
      <li>Módulo Destaraje y Ventas</li>
      <li>Módulo Producción</li>
      <li>Módulo Pagos y Ministraciones</li>
      <li>Módulo Control de Producción</li>
      <li>Reportes</li>
      <li>Panel Admin</li>
      <li>Reconocimiento de voz</li>
      <li>Modo offline (sin internet)</li>
      <li>Preguntas frecuentes</li>
    </ol>
  </div>

  <!-- 1 -->
  <h1 class="section">1. ¿Qué es EVE Control?</h1>
  <p>EVE Control es el sistema de registro y control operativo de EVERPLASTIC. Permite capturar en tiempo real entradas de material (destaraje), producción, pagos, y procesos de transformación desde cualquier dispositivo con Chrome.</p>
  <p>Todos los datos se guardan automáticamente en la nube (Firebase Firestore). Si no hay internet, el sistema guarda los registros en el dispositivo y los sube automáticamente cuando vuelve la conexión.</p>

  <table>
    <tr><th>Módulo</th><th>¿Quién lo usa?</th><th>¿Qué registra?</th></tr>
    <tr><td>Destaraje</td><td>Bascula / Almacén</td><td>Entradas y salidas de material por ticket</td></tr>
    <tr><td>Producción</td><td>Operadores</td><td>Material producido (Peletizado, Pacas, etc.)</td></tr>
    <tr><td>Pagos</td><td>Administración</td><td>Pagos a proveedores y ministraciones</td></tr>
    <tr><td>Control Producción</td><td>Supervisores</td><td>Procesos completos con eficiencia y merma</td></tr>
    <tr><td>Reportes</td><td>Gerencia</td><td>PDF/Excel/Telegram de todos los módulos</td></tr>
    <tr><td>Admin</td><td>Administrador</td><td>Usuarios, datos, backups, configuración</td></tr>
  </table>

  <!-- 2 -->
  <h1 class="section page-break">2. Cómo acceder — Login</h1>

  <p>Abrir Chrome en el teléfono o computadora y entrar a:</p>
  <div class="screen-box">
    <div class="label">URL del sistema:</div>
    https://cpnetohiva.github.io/eve-control-v2/
  </div>

  <h2 class="sub">Iniciar sesión</h2>
  <div class="step"><div class="step-num">1</div><div>Escribir el nombre de usuario (ejemplo: <strong>Matilde</strong>)</div></div>
  <div class="step"><div class="step-num">2</div><div>Escribir la contraseña</div></div>
  <div class="step"><div class="step-num">3</div><div>Presionar <strong>Ingresar</strong></div></div>

  <div class="tip"><strong>Tip:</strong> La sesión se mantiene activa. No es necesario volver a iniciar sesión cada vez que se abre la app, a menos que alguien haya cerrado sesión manualmente.</div>

  <table>
    <tr><th>Usuario</th><th>Contraseña</th><th>Acceso</th></tr>
    <tr><td>Admin</td><td>4W9EVE12</td><td>Todo</td></tr>
    <tr><td>Matilde</td><td>1357</td><td>Destaraje + Reportes</td></tr>
    <tr><td>Christian</td><td>8642</td><td>Producción + Pagos + Reportes</td></tr>
  </table>

  <div class="warn"><strong>Importante:</strong> No compartir contraseñas. Si necesitas un usuario nuevo, solicitarlo al administrador desde el Panel Admin.</div>

  <!-- 3 -->
  <h1 class="section page-break">3. Pantalla principal</h1>

  <div class="header-demo">
    <span class="title">EVERPLASTIC — Mehicaso Group</span>
    <span class="status">🟢 En línea</span>
    <span>[Admin] [Salir]</span>
  </div>

  <p>La barra superior siempre muestra:</p>
  <ul>
    <li><strong>Estado de conexión</strong> — indica si el sistema está en línea u offline</li>
    <li><strong>Botón Admin</strong> — visible solo para el administrador</li>
    <li><strong>Botón Salir</strong> — cierra la sesión</li>
  </ul>

  <p>Debajo de la barra aparecen las pestañas de los módulos a los que tienes acceso. Solo se muestran los módulos permitidos para tu usuario.</p>

  <h2 class="sub">Estados de conexión</h2>
  <table>
    <tr><th>Indicador</th><th>Significado</th></tr>
    <tr><td>🟢 En línea</td><td>Conexión activa — los datos se guardan en Firebase</td></tr>
    <tr><td>🔴 Sin conexión — N pendientes</td><td>Sin internet — los registros se guardan localmente</td></tr>
    <tr><td>🔄 Sincronizando... (N/M)</td><td>Subiendo registros pendientes a la nube</td></tr>
    <tr><td>✅ Sincronizado</td><td>Todo subido correctamente (desaparece en 3 segundos)</td></tr>
  </table>

  <!-- 4 -->
  <h1 class="section page-break">4. Módulo Destaraje y Ventas</h1>

  <p>Registra todas las entradas de material de proveedores externos. También se usan las ventas de material (ticket "V").</p>

  <h2 class="sub">Registrar una entrada de material</h2>
  <div class="step"><div class="step-num">1</div><div>Ir a la pestaña <strong>Destaraje</strong></div></div>
  <div class="step"><div class="step-num">2</div><div>Llenar el formulario: <strong>Ticket, Proveedor, Material, Kg, Fecha Entrada, Fecha Salida</strong></div></div>
  <div class="step"><div class="step-num">3</div><div>Presionar <strong>Guardar</strong> — el registro aparece en la tabla inmediatamente</div></div>

  <h2 class="sub">Campos del formulario</h2>
  <table>
    <tr><th>Campo</th><th>Descripción</th><th>Ejemplo</th></tr>
    <tr><td>Ticket</td><td>Número de folio del proveedor. "V" para ventas, "P" para producción interna</td><td>9260</td></tr>
    <tr><td>Proveedor</td><td>Nombre del proveedor (autocompletado)</td><td>JOSE ENRIQUE</td></tr>
    <tr><td>Material</td><td>Tipo de material (autocompletado)</td><td>MIXTO</td></tr>
    <tr><td>Kg</td><td>Kilogramos. Para TAMBOS y CAJAS, poner número de piezas</td><td>650</td></tr>
    <tr><td>Fecha Entrada</td><td>Fecha en que entró el material</td><td>23-04-2026</td></tr>
    <tr><td>Fecha Salida</td><td>Fecha en que salió / se pesó</td><td>24-04-2026</td></tr>
  </table>

  <h2 class="sub">Pestañas de visualización</h2>
  <ul>
    <li><strong>HOY</strong> — Solo los registros del día actual</li>
    <li><strong>ESTA SEMANA</strong> — Desde el lunes de la semana en curso</li>
    <li><strong>TODOS</strong> — Todos los registros con filtros por ticket, proveedor, material y fechas</li>
  </ul>

  <h2 class="sub">Editar o eliminar un registro</h2>
  <p>En la tabla, cada registro tiene botones de editar (✏️) y eliminar (🗑️). Para eliminar se pedirá confirmación. Esta acción no se puede deshacer.</p>

  <div class="tip"><strong>Tip:</strong> El sistema aprende automáticamente los proveedores y materiales que usas con frecuencia y los sugiere con autocompletado.</div>

  <h2 class="sub">Exportar datos</h2>
  <p>Desde cualquier pestaña se pueden exportar los datos visibles:</p>
  <ul>
    <li><strong>TXT</strong> — Formato texto plano para imprimir</li>
    <li><strong>PDF</strong> — Reporte formateado con logo y tablas</li>
    <li><strong>CSV</strong> — Para abrir en Excel</li>
  </ul>

  <!-- 5 -->
  <h1 class="section page-break">5. Módulo Producción</h1>

  <p>Registra el material producido internamente (Peletizado, Pacas, etc.). Funciona igual que Destaraje pero el ticket siempre es <strong>"P"</strong> y el campo se llama <strong>Cliente</strong> en lugar de Proveedor.</p>

  <table>
    <tr><th>Campo</th><th>Descripción</th></tr>
    <tr><td>Ticket</td><td>Siempre "P" (fijo automáticamente)</td></tr>
    <tr><td>Cliente</td><td>Generalmente "Produccion"</td></tr>
    <tr><td>Material</td><td>Tipo producido: PELETIZADO, LECHERO LAVADO, PACAS, etc.</td></tr>
    <tr><td>Kg</td><td>Kilogramos producidos</td></tr>
    <tr><td>Fecha Entrada / Salida</td><td>Fechas del proceso</td></tr>
  </table>

  <!-- 6 -->
  <h1 class="section page-break">6. Módulo Pagos y Ministraciones</h1>

  <p>Registra los pagos realizados a proveedores y las ministraciones de efectivo semanales.</p>

  <h2 class="sub">Registrar un pago</h2>
  <table>
    <tr><th>Campo</th><th>Descripción</th></tr>
    <tr><td>Ticket</td><td>Número del ticket del proveedor al que se paga</td></tr>
    <tr><td>Proveedor</td><td>Nombre del proveedor</td></tr>
    <tr><td>Material</td><td>Material al que corresponde el pago</td></tr>
    <tr><td>Kg</td><td>Kilogramos pagados</td></tr>
    <tr><td>Precio/Kg</td><td>Precio por kilogramo acordado</td></tr>
    <tr><td>Total</td><td>Se calcula automáticamente: Kg × Precio/Kg</td></tr>
    <tr><td>Pagado</td><td>Monto efectivamente entregado (puede ser diferente al total)</td></tr>
  </table>

  <h2 class="sub">Control de Flujo Semanal</h2>
  <p>En la pestaña <strong>ESTA SEMANA</strong> aparece el panel de control de flujo:</p>
  <div class="module-card">
    <div class="mc-title">CONTROL DE FLUJO SEMANAL</div>
    <p style="font-size:9.5pt;margin:0;">
      Total Ministrado: dinero entregado esta semana<br>
      Total Pagado: suma de todos los pagos de la semana<br>
      Saldo Disponible: lo que queda por usar<br>
      % Ejecutado: qué porcentaje del presupuesto se gastó
    </p>
  </div>

  <h2 class="sub">Registrar una ministración</h2>
  <p>Presionar el botón <strong>💵 Registrar Ministración</strong> en el panel de flujo semanal e ingresar el monto y la fecha.</p>

  <!-- 7 -->
  <h1 class="section page-break">7. Módulo Control de Producción</h1>

  <p>Registra los procesos de transformación de material con seguimiento de eficiencia y merma.</p>

  <h2 class="sub">Procesos disponibles</h2>
  <table>
    <tr><th>Proceso</th><th>¿Qué hace?</th></tr>
    <tr><td>🔍 Selección</td><td>Separación de material por tipo</td></tr>
    <tr><td>📦 Empacado</td><td>Formación de pacas</td></tr>
    <tr><td>⚙️ Molienda</td><td>Trituración de material</td></tr>
    <tr><td>💧 Lavado</td><td>Limpieza de material</td></tr>
    <tr><td>🔵 Peletizado</td><td>Formación de pellets</td></tr>
  </table>

  <h2 class="sub">Cálculos automáticos</h2>
  <p>Al llenar el formulario, el sistema calcula en tiempo real:</p>
  <ul>
    <li><strong>Eficiencia</strong> = (Output principal ÷ Total Input) × 100</li>
    <li><strong>% Merma</strong> = (Merma ÷ Total Input) × 100</li>
    <li><strong>Horas trabajadas</strong> = Fecha Fin − Fecha Inicio</li>
    <li><strong>Productividad</strong> = Output principal ÷ Horas (kg/hora)</li>
  </ul>

  <h2 class="sub">Color de eficiencia</h2>
  <table>
    <tr><th>Color</th><th>Eficiencia</th></tr>
    <tr><td>🟢 Verde</td><td>90% o más</td></tr>
    <tr><td>🟡 Naranja</td><td>Entre 80% y 89%</td></tr>
    <tr><td>🔴 Rojo</td><td>Menos del 80%</td></tr>
  </table>

  <h2 class="sub">Pestaña Trazabilidad</h2>
  <p>Buscar un número de ticket para ver toda la cadena: desde que entró el material, pasó por cada proceso, hasta la venta final. Muestra eficiencia y kg en cada etapa.</p>

  <!-- 8 -->
  <h1 class="section page-break">8. Reportes</h1>

  <p>Genera reportes de todos los módulos en diferentes formatos.</p>

  <h2 class="sub">Cómo generar un reporte</h2>
  <div class="step"><div class="step-num">1</div><div>Ir a la pestaña <strong>Reportes</strong></div></div>
  <div class="step"><div class="step-num">2</div><div>Seleccionar el módulo (Destaraje, Producción, Pagos, etc.)</div></div>
  <div class="step"><div class="step-num">3</div><div>Aplicar filtros si se necesitan (fecha, proveedor, material, ticket)</div></div>
  <div class="step"><div class="step-num">4</div><div>Presionar <strong>Vista Previa</strong> para revisar antes de exportar</div></div>
  <div class="step"><div class="step-num">5</div><div>Elegir formato: <strong>PDF / TXT / CSV / Telegram</strong></div></div>

  <h2 class="sub">Envío por Telegram</h2>
  <p>Al presionar el botón Telegram, el sistema envía automáticamente al chat del grupo un resumen del reporte y el PDF adjunto. No se necesita hacer nada más.</p>

  <div class="tip"><strong>Tip:</strong> El <strong>Reporte General</strong> incluye todos los módulos en un solo documento. Es el más completo para reportes semanales a gerencia.</div>

  <!-- 9 -->
  <h1 class="section page-break">9. Panel Admin</h1>

  <p>Solo visible para el usuario Admin. Se accede con el botón <strong>[Admin]</strong> en la barra superior.</p>

  <h2 class="sub">Secciones del panel</h2>

  <div class="module-card">
    <div class="mc-title">Gestión de Usuarios</div>
    <p style="font-size:9.5pt;margin:0;">Crear, editar y eliminar usuarios. Activar o desactivar cuentas. Asignar permisos por módulo.</p>
  </div>
  <div class="module-card">
    <div class="mc-title">Importación de Datos (Excel)</div>
    <p style="font-size:9.5pt;margin:0;">Subir registros históricos desde un archivo .xlsx. Descarga la plantilla, llénala y sube el archivo. El sistema muestra una vista previa antes de confirmar.</p>
  </div>
  <div class="module-card">
    <div class="mc-title">Gestión de Datos</div>
    <p style="font-size:9.5pt;margin:0;">Borrar registros por módulo y rango de fechas. Siempre requiere escribir "CONFIRMAR" antes de proceder. No se puede deshacer.</p>
  </div>
  <div class="module-card">
    <div class="mc-title">Backup / Exportación</div>
    <p style="font-size:9.5pt;margin:0;">Exportar todos los datos a JSON o Excel. Enviar mensaje de prueba a Telegram. Cambiar el token o el Chat ID de Telegram.</p>
  </div>

  <div class="danger"><strong>Cuidado:</strong> Las acciones de borrado en Gestión de Datos son permanentes. Siempre hacer un backup antes de borrar datos en producción.</div>

  <!-- 10 -->
  <h1 class="section page-break">10. Reconocimiento de voz</h1>

  <p>Disponible en los módulos Destaraje, Producción y Pagos. Permite registrar datos hablando sin escribir.</p>

  <h2 class="sub">Cómo usar</h2>
  <div class="step"><div class="step-num">1</div><div>Presionar y <strong>mantener presionado</strong> el botón 🎤</div></div>
  <div class="step"><div class="step-num">2</div><div>Hablar claramente con el formato indicado abajo</div></div>
  <div class="step"><div class="step-num">3</div><div>Soltar el botón — el sistema rellena el formulario automáticamente</div></div>
  <div class="step"><div class="step-num">4</div><div>Verificar los datos y presionar <strong>Guardar</strong></div></div>

  <h2 class="sub">Formato por módulo</h2>
  <table>
    <tr><th>Módulo</th><th>Ejemplo de lo que se dice</th></tr>
    <tr><td>Destaraje</td><td>"Ticket 9260 de Jose Enrique, Mixto, 650, entrada 23 abril, salida 24 abril"</td></tr>
    <tr><td>Producción</td><td>"Ticket P de Produccion, Peletizado, 1800, entrada 24 abril, salida 24 abril"</td></tr>
    <tr><td>Pagos</td><td>"Ticket 9260 de Jose Enrique, Mixto, 650, a 10, pagado 6500"</td></tr>
  </table>

  <div class="tip"><strong>Tip:</strong> Hablar en voz normal, sin prisa. El sistema entiende los meses en español: "enero", "febrero", etc. Si el micrófono no funciona, verificar que Chrome tenga permiso de micrófono.</div>

  <!-- 11 -->
  <h1 class="section page-break">11. Modo offline (sin internet)</h1>

  <p>EVE Control funciona sin internet. Cuando no hay conexión:</p>

  <div class="step"><div class="step-num">1</div><div>El indicador en la barra superior cambia a <strong>🔴 Sin conexión</strong></div></div>
  <div class="step"><div class="step-num">2</div><div>Puedes seguir capturando registros normalmente</div></div>
  <div class="step"><div class="step-num">3</div><div>Los datos se guardan en el dispositivo (IndexedDB)</div></div>
  <div class="step"><div class="step-num">4</div><div>Al recuperar internet, el sistema sincroniza automáticamente — <strong>🔄 Sincronizando...</strong></div></div>
  <div class="step"><div class="step-num">5</div><div>Aparece <strong>✅ Sincronizado</strong> cuando todo se subió a Firebase</div></div>

  <h2 class="sub">Ver registros pendientes</h2>
  <p>Tocar el indicador <strong>🔴 Sin conexión</strong> para ver la lista de registros que están esperando enviarse. Muestra módulo, ticket, cantidad y hora.</p>

  <div class="warn"><strong>Importante:</strong> Para que el modo offline funcione, la primera vez se necesita internet para instalar la app. Después ya funciona sin conexión.</div>

  <h2 class="sub">Instalar la app en Android</h2>
  <div class="step"><div class="step-num">1</div><div>Abrir EVE Control en Chrome</div></div>
  <div class="step"><div class="step-num">2</div><div>Presionar el botón <strong>📲 Instalar App</strong> que aparece en la barra superior</div></div>
  <div class="step"><div class="step-num">3</div><div>Confirmar en el diálogo del sistema</div></div>
  <div class="step"><div class="step-num">4</div><div>La app aparece en la pantalla de inicio como cualquier aplicación</div></div>

  <!-- 12 -->
  <h1 class="section page-break">12. Preguntas frecuentes</h1>

  <h3 class="mini">¿Por qué no veo algún módulo?</h3>
  <p>Tu usuario no tiene permiso para ese módulo. Pedir al administrador que lo active en Gestión de Usuarios.</p>

  <h3 class="mini">Guardé un registro pero no aparece en la tabla</h3>
  <p>1) Verificar que el registro no quedó pendiente (offline). 2) Recargar la página. 3) Si el problema persiste, avisar al administrador.</p>

  <h3 class="mini">El reconocimiento de voz no funciona</h3>
  <p>Verificar que Chrome tiene permiso de micrófono: Chrome → Configuración → Privacidad → Permisos del sitio → Micrófono → Permitir para el sitio de EVE Control.</p>

  <h3 class="mini">La sesión se cerró sola</h3>
  <p>Puede pasar si se borraron los datos del navegador. Volver a iniciar sesión normalmente.</p>

  <h3 class="mini">¿Cómo sé si los datos están respaldados?</h3>
  <p>Todos los datos en Firebase (nube) están respaldados automáticamente. En Panel Admin → Backup se puede descargar un respaldo manual en cualquier momento.</p>

  <h3 class="mini">Aparece error en rojo al guardar</h3>
  <p>Revisar que todos los campos obligatorios estén llenos y que el formato sea correcto. Si hay conexión y el error persiste, avisar al administrador con una captura de pantalla.</p>

  <h3 class="mini">¿Puedo usar EVE Control en computadora?</h3>
  <p>Sí, funciona en cualquier navegador Chrome moderno, tanto en PC como en tablet o teléfono.</p>

  <div style="margin-top:40px;padding:16px;background:#001D3D;color:#fff;border-radius:8px;text-align:center;font-size:9pt;">
    <strong style="color:#FFC300;">EVE Control v3.0</strong> &nbsp;·&nbsp; EVERPLASTIC / Mehicaso Group &nbsp;·&nbsp; Soporte: administrador del sistema
  </div>

</div>
</body>
</html>`;

const MANUAL_GIT_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'DM Sans', Arial, sans-serif; color: #1a1a2e; background: #fff; font-size: 10.5pt; line-height: 1.65; }

  .cover {
    background: linear-gradient(135deg, #0a0a1a 0%, #001D3D 60%, #003166 100%);
    color: #fff; height: 100vh; display: flex; flex-direction: column;
    justify-content: center; align-items: center; text-align: center;
    page-break-after: always;
  }
  .cover .logo { font-size: 64pt; font-weight: 700; color: #FFC300; letter-spacing: -2px; margin-bottom: 12px; font-family: 'JetBrains Mono', monospace; }
  .cover h1 { font-size: 19pt; font-weight: 600; margin-bottom: 6px; letter-spacing: 1px; }
  .cover h2 { font-size: 12pt; font-weight: 300; opacity: 0.8; margin-bottom: 40px; }
  .cover .divider { width: 80px; height: 3px; background: #FFC300; margin: 0 auto 40px; border-radius: 2px; }
  .cover .meta { font-size: 9pt; opacity: 0.55; }

  .page { padding: 28mm 22mm 22mm; min-height: 100vh; }
  .page-break { page-break-before: always; }

  h1.section { color: #001D3D; font-size: 16pt; font-weight: 700; border-bottom: 3px solid #FFC300; padding-bottom: 8px; margin: 0 0 20px; }
  h2.sub { color: #001D3D; font-size: 12pt; font-weight: 600; margin: 22px 0 10px; }
  h3.mini { color: #0077B6; font-size: 10.5pt; font-weight: 600; margin: 16px 0 7px; }

  p { margin-bottom: 9px; }

  .tip { background: #e8f5e9; border-left: 4px solid #06D6A0; padding: 9px 13px; border-radius: 0 6px 6px 0; margin: 10px 0; font-size: 9.5pt; }
  .warn { background: #fff8e1; border-left: 4px solid #FFC300; padding: 9px 13px; border-radius: 0 6px 6px 0; margin: 10px 0; font-size: 9.5pt; }
  .danger { background: #fde8ec; border-left: 4px solid #EF476F; padding: 9px 13px; border-radius: 0 6px 6px 0; margin: 10px 0; font-size: 9.5pt; }

  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; }
  th { background: #001D3D; color: #fff; padding: 8px 10px; text-align: left; font-weight: 600; }
  td { padding: 7px 10px; border-bottom: 1px solid #e8e8e8; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f9fa; }

  ol, ul { padding-left: 20px; margin-bottom: 10px; }
  li { margin-bottom: 5px; }

  code { font-family: 'JetBrains Mono', monospace; background: #f1f3f5; padding: 1px 5px; border-radius: 3px; font-size: 9pt; color: #001D3D; }

  .cmd { background: #0d1117; color: #e6edf3; font-family: 'JetBrains Mono', monospace; font-size: 8.8pt; padding: 14px 18px; border-radius: 8px; margin: 10px 0; line-height: 1.8; }
  .cmd .comment { color: #8b949e; }
  .cmd .green { color: #3fb950; }
  .cmd .gold { color: #e3b341; }
  .cmd .blue { color: #79c0ff; }
  .cmd .red { color: #ff7b72; }

  .toc { background: #f8f9fa; border-radius: 8px; padding: 18px 22px; margin-bottom: 28px; }
  .toc h2 { color: #001D3D; font-size: 12pt; margin-bottom: 12px; }
  .toc ol { padding-left: 20px; }
  .toc li { margin-bottom: 5px; font-size: 9.5pt; }

  .step { display: flex; gap: 10px; margin: 8px 0; align-items: flex-start; }
  .step-num { background: #001D3D; color: #FFC300; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 8.5pt; font-weight: 700; flex-shrink: 0; margin-top: 1px; font-family: 'JetBrains Mono', monospace; }

  .error-card { border: 1.5px solid #fca5a5; border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
  .error-card .ec-title { font-weight: 600; color: #991b1b; margin-bottom: 5px; font-size: 10pt; }
  .error-card .ec-fix { color: #166534; margin-top: 6px; font-size: 9.5pt; }

  .success-card { border: 1.5px solid #86efac; border-radius: 8px; padding: 12px 14px; margin: 12px 0; }
  .success-card .sc-title { font-weight: 600; color: #166534; margin-bottom: 5px; font-size: 10pt; }
</style>
</head>
<body>

<!-- PORTADA -->
<div class="cover">
  <div class="logo">&gt;_</div>
  <h1>MANUAL TÉCNICO Y GIT</h1>
  <h2>EVE Control v3.0 — Resolución de Problemas y Despliegue</h2>
  <div class="divider"></div>
  <p style="color:#aaa;font-size:9pt;">Para el administrador y desarrollador del sistema</p>
  <div class="meta" style="margin-top:40px;">Mehicaso Group &nbsp;·&nbsp; Junio 2026</div>
</div>

<!-- CONTENIDO -->
<div class="page">

  <h1 class="section">Contenido</h1>
  <div class="toc">
    <ol>
      <li>Arquitectura del sistema</li>
      <li>Repositorio y despliegue (GitHub Pages)</li>
      <li>Comandos Git esenciales</li>
      <li>Flujo de trabajo para actualizar el sistema</li>
      <li>Actualizar el Service Worker (PWA)</li>
      <li>Firebase — acceso y gestión</li>
      <li>Resolución de problemas comunes</li>
      <li>Problemas de PWA / Service Worker</li>
      <li>Problemas de Firebase / Firestore</li>
      <li>Checklist de despliegue</li>
      <li>Referencia rápida de comandos</li>
    </ol>
  </div>

  <!-- 1 -->
  <h1 class="section">1. Arquitectura del sistema</h1>

  <p>EVE Control es una aplicación web estática (sin servidor propio). Todos los archivos son HTML/CSS/JS puros alojados en GitHub Pages.</p>

  <table>
    <tr><th>Componente</th><th>Tecnología</th><th>Ubicación</th></tr>
    <tr><td>Frontend</td><td>Vanilla JS ES2017+, sin bundler</td><td>GitHub Pages (cpnetohiva.github.io)</td></tr>
    <tr><td>Base de datos</td><td>Firebase Firestore (compat SDK v10.7.1)</td><td>Firebase project: everplastic</td></tr>
    <tr><td>Offline / PWA</td><td>Service Worker vanilla + IndexedDB</td><td>service-worker.js en raíz del repo</td></tr>
    <tr><td>PDF</td><td>jsPDF 2.5.1 + autoTable 3.5.31</td><td>CDN (cacheado por SW)</td></tr>
    <tr><td>Excel</td><td>SheetJS (xlsx.full.min.js)</td><td>CDN (cacheado por SW)</td></tr>
  </table>

  <h2 class="sub">Estructura de archivos</h2>
  <div class="cmd">
<span class="comment">eve-control-v2/</span>
├── <span class="gold">index.html</span>           <span class="comment">← App principal</span>
├── <span class="gold">manifest.json</span>        <span class="comment">← PWA manifest</span>
├── <span class="gold">service-worker.js</span>    <span class="comment">← Cache offline (Cache First)</span>
├── <span class="gold">css/styles.css</span>
├── <span class="gold">icons/</span>               <span class="comment">← icon-192.png, icon-512.png</span>
└── <span class="gold">js/</span>
    ├── config.js            <span class="comment">← Firebase + enablePersistence</span>
    ├── utils.js             <span class="comment">← CRUD Firebase, helpers</span>
    ├── auth.js              <span class="comment">← Login, sesión, carga de datos</span>
    ├── offline.js           <span class="comment">← IndexedDB, cola, estados header</span>
    ├── destaraje.js
    ├── produccion.js
    ├── pagos.js
    ├── control-produccion.js
    ├── trazabilidad.js
    ├── reportes.js
    ├── reportes-ui.js
    ├── voz.js
    ├── admin.js
    ├── admin-usuarios.js
    ├── admin-importar.js
    ├── admin-datos.js
    ├── admin-backup.js
    └── admin-config.js</div>

  <!-- 2 -->
  <h1 class="section page-break">2. Repositorio y despliegue (GitHub Pages)</h1>

  <table>
    <tr><th>Dato</th><th>Valor</th></tr>
    <tr><td>Repositorio</td><td>https://github.com/Cpnetohiva/eve-control-v2</td></tr>
    <tr><td>Rama de producción</td><td>master</td></tr>
    <tr><td>URL en producción</td><td>https://cpnetohiva.github.io/eve-control-v2/</td></tr>
    <tr><td>GitHub Pages</td><td>Settings → Pages → Branch: master, Folder: / (root)</td></tr>
    <tr><td>Firebase project</td><td>everplastic (console.firebase.google.com)</td></tr>
  </table>

  <p>GitHub Pages despliega automáticamente cada vez que se hace <code>git push</code> a <code>master</code>. El tiempo de despliegue es aproximadamente 1–2 minutos.</p>

  <!-- 3 -->
  <h1 class="section page-break">3. Comandos Git esenciales</h1>

  <h2 class="sub">Configuración inicial (una sola vez)</h2>
  <div class="cmd">
<span class="comment"># Clonar el repositorio</span>
<span class="green">git clone</span> https://github.com/Cpnetohiva/eve-control-v2.git
<span class="blue">cd</span> eve-control-v2

<span class="comment"># Configurar identidad (si no está configurada)</span>
<span class="green">git config</span> --global user.name <span class="gold">"Tu Nombre"</span>
<span class="green">git config</span> --global user.email <span class="gold">"tu@email.com"</span></div>

  <h2 class="sub">Comandos de estado</h2>
  <table>
    <tr><th>Comando</th><th>¿Qué hace?</th></tr>
    <tr><td><code>git status</code></td><td>Ver qué archivos cambiaron</td></tr>
    <tr><td><code>git log --oneline -10</code></td><td>Ver los últimos 10 commits</td></tr>
    <tr><td><code>git diff</code></td><td>Ver los cambios exactos línea por línea</td></tr>
    <tr><td><code>git branch</code></td><td>Ver en qué rama estás</td></tr>
    <tr><td><code>git remote -v</code></td><td>Ver el repositorio remoto configurado</td></tr>
  </table>

  <h2 class="sub">Guardar cambios</h2>
  <div class="cmd">
<span class="comment"># Ver qué cambió</span>
<span class="green">git status</span>

<span class="comment"># Agregar archivos específicos al commit</span>
<span class="green">git add</span> js/destaraje.js css/styles.css

<span class="comment"># O agregar todos los cambios (con cuidado)</span>
<span class="green">git add</span> -A

<span class="comment"># Crear el commit con mensaje descriptivo</span>
<span class="green">git commit</span> -m <span class="gold">"fix: corregir cálculo de eficiencia en control-produccion"</span>

<span class="comment"># Subir a GitHub (despliega automáticamente)</span>
<span class="green">git push</span> origin master</div>

  <h2 class="sub">Traer cambios del servidor</h2>
  <div class="cmd">
<span class="comment"># Descargar los últimos cambios de GitHub</span>
<span class="green">git pull</span> origin master</div>

  <h2 class="sub">Deshacer cambios</h2>
  <div class="cmd">
<span class="comment"># Descartar cambios en un archivo (antes de hacer commit)</span>
<span class="green">git checkout</span> -- js/destaraje.js

<span class="comment"># Volver al commit anterior (sin perder los archivos)</span>
<span class="green">git reset</span> --soft HEAD~1

<span class="comment"># Ver un commit antiguo sin modificar nada</span>
<span class="green">git show</span> abc1234:js/destaraje.js</div>

  <div class="danger"><strong>Nunca usar</strong> <code>git reset --hard</code> ni <code>git push --force</code> sin estar seguro. Estas operaciones destruyen trabajo permanentemente.</div>

  <!-- 4 -->
  <h1 class="section page-break">4. Flujo de trabajo para actualizar el sistema</h1>

  <p>Proceso estándar cada vez que se necesita modificar algo:</p>

  <div class="step"><div class="step-num">1</div><div><strong>Obtener los últimos cambios:</strong><br><code>git pull origin master</code></div></div>
  <div class="step"><div class="step-num">2</div><div><strong>Editar los archivos necesarios</strong> (con tu editor de código)</div></div>
  <div class="step"><div class="step-num">3</div><div><strong>Probar localmente:</strong> abrir <code>index.html</code> con un servidor local o directamente en Chrome</div></div>
  <div class="step"><div class="step-num">4</div><div><strong>Agregar y commitear:</strong><br><code>git add archivo.js</code><br><code>git commit -m "descripción del cambio"</code></div></div>
  <div class="step"><div class="step-num">5</div><div><strong>Subir a producción:</strong><br><code>git push origin master</code></div></div>
  <div class="step"><div class="step-num">6</div><div><strong>Esperar 1–2 minutos</strong> y verificar en https://cpnetohiva.github.io/eve-control-v2/</div></div>

  <h2 class="sub">Buenas prácticas para mensajes de commit</h2>
  <table>
    <tr><th>Prefijo</th><th>Cuándo usarlo</th><th>Ejemplo</th></tr>
    <tr><td><code>feat:</code></td><td>Nueva funcionalidad</td><td>feat: agregar filtro por proveedor en pagos</td></tr>
    <tr><td><code>fix:</code></td><td>Corrección de error</td><td>fix: corregir total en ministraciones semanales</td></tr>
    <tr><td><code>docs:</code></td><td>Documentación</td><td>docs: actualizar manual de usuario</td></tr>
    <tr><td><code>style:</code></td><td>Solo CSS / visual</td><td>style: ajustar color de botones en mobile</td></tr>
    <tr><td><code>refactor:</code></td><td>Reorganizar código</td><td>refactor: extraer función de parseo de fechas</td></tr>
  </table>

  <!-- 5 -->
  <h1 class="section page-break">5. Actualizar el Service Worker (PWA)</h1>

  <p>El Service Worker usa un nombre de cache versionado: <code>eve-control-v3-r1</code>. Cada vez que se hace un cambio significativo en la app, se debe incrementar la versión para que los usuarios reciban la actualización.</p>

  <h2 class="sub">Cuándo incrementar la versión</h2>
  <ul>
    <li>Cambios en <code>js/*.js</code> que afecten funcionalidad</li>
    <li>Cambios en <code>css/styles.css</code></li>
    <li>Cambios en <code>index.html</code></li>
    <li>Agregar nuevos archivos JS al proyecto</li>
  </ul>

  <h2 class="sub">Cómo actualizar la versión del cache</h2>
  <p>Editar <code>service-worker.js</code> en la primera línea:</p>
  <div class="cmd">
<span class="comment"># ANTES:</span>
const CACHE_NAME = <span class="gold">'eve-control-v3-r1'</span>;

<span class="comment"># DESPUÉS (incrementar el número de revisión):</span>
const CACHE_NAME = <span class="gold">'eve-control-v3-r2'</span>;</div>

  <p>El Service Worker detecta el nombre diferente, instala el nuevo cache y elimina el anterior automáticamente. Los usuarios recibirán la actualización al recargar la página.</p>

  <div class="tip"><strong>Tip:</strong> Si un usuario reporta que la app no muestra los cambios nuevos, primero pedirle que haga una recarga forzada: <strong>Ctrl + Shift + R</strong> (Windows) o <strong>Cmd + Shift + R</strong> (Mac). En Android Chrome: menú ⋮ → Recargar.</div>

  <h2 class="sub">Forzar actualización del SW en Chrome DevTools</h2>
  <div class="step"><div class="step-num">1</div><div>Abrir Chrome DevTools (F12)</div></div>
  <div class="step"><div class="step-num">2</div><div>Ir a la pestaña <strong>Application</strong></div></div>
  <div class="step"><div class="step-num">3</div><div>En el menú izquierdo: <strong>Service Workers</strong></div></div>
  <div class="step"><div class="step-num">4</div><div>Presionar <strong>Update</strong> o activar <strong>Update on reload</strong></div></div>

  <!-- 6 -->
  <h1 class="section page-break">6. Firebase — acceso y gestión</h1>

  <h2 class="sub">Consola de Firebase</h2>
  <p>Acceder en: <strong>console.firebase.google.com</strong> → Proyecto: <code>everplastic</code></p>

  <table>
    <tr><th>Sección</th><th>URL / Ruta en consola</th><th>Uso</th></tr>
    <tr><td>Firestore</td><td>Build → Firestore Database</td><td>Ver, editar y eliminar documentos directamente</td></tr>
    <tr><td>Autenticación</td><td>Build → Authentication</td><td>No se usa (auth es por Firestore/colección users)</td></tr>
    <tr><td>Storage</td><td>Build → Storage</td><td>No se usa actualmente</td></tr>
    <tr><td>Uso y cuotas</td><td>Project Overview → Usage</td><td>Verificar límites del plan gratuito</td></tr>
  </table>

  <h2 class="sub">Colecciones en Firestore</h2>
  <table>
    <tr><th>Colección</th><th>Contenido</th></tr>
    <tr><td><code>users</code></td><td>Usuarios del sistema con permisos</td></tr>
    <tr><td><code>destaraje</code></td><td>Registros de entrada/salida de material</td></tr>
    <tr><td><code>produccion</code></td><td>Producción (ticket "P")</td></tr>
    <tr><td><code>pagos</code></td><td>Pagos a proveedores</td></tr>
    <tr><td><code>ministraciones</code></td><td>Efectivo semanal entregado</td></tr>
    <tr><td><code>control_produccion</code></td><td>Procesos de transformación</td></tr>
    <tr><td><code>config</code></td><td>Token de Telegram y configuración</td></tr>
  </table>

  <h2 class="sub">Credenciales Firebase (config.js)</h2>
  <div class="cmd">
const firebaseConfig = {
  apiKey: <span class="gold">"AIzaSyCF_6UdCStIo2eq-BSDH-vHmSu6LvzX7gU"</span>,
  authDomain: <span class="gold">"everplastic.firebaseapp.com"</span>,
  projectId: <span class="gold">"everplastic"</span>,
  storageBucket: <span class="gold">"everplastic.firebasestorage.app"</span>,
  messagingSenderId: <span class="gold">"804807980304"</span>,
  appId: <span class="gold">"1:804807980304:web:47466f961871b5b0a80c06"</span>
};</div>

  <div class="warn"><strong>Importante:</strong> El Project ID correcto es <code>everplastic</code>. No confundir con nombres anteriores del proyecto.</div>

  <!-- 7 -->
  <h1 class="section page-break">7. Resolución de problemas comunes</h1>

  <div class="error-card">
    <div class="ec-title">❌ La página no carga / Error 404</div>
    <p>El push no se completó o GitHub Pages no ha terminado de desplegar.</p>
    <div class="ec-fix">✅ Solución: Esperar 2 minutos y recargar. Verificar en GitHub → Actions o Settings → Pages que el despliegue esté completo. Revisar que el push fue exitoso con <code>git log --oneline -3</code>.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ "Failed to fetch" al guardar</div>
    <p>Sin conexión a Firebase o cuota excedida.</p>
    <div class="ec-fix">✅ Solución: Verificar internet. Revisar console.firebase.google.com → Usage para ver si se alcanzó el límite del plan. El modo offline captura los datos localmente.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ Los cambios que subí no aparecen en producción</div>
    <p>El Service Worker está sirviendo la versión anterior desde caché.</p>
    <div class="ec-fix">✅ Solución: Incrementar la versión en <code>service-worker.js</code> (<code>r1</code> → <code>r2</code>), hacer commit y push. Esperar 2 minutos. En Chrome DevTools → Application → Service Workers → Update.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ "Permission denied" al hacer git push</div>
    <p>Sin acceso al repositorio o credenciales expiradas.</p>
    <div class="ec-fix">✅ Solución: Verificar que tienes acceso al repo en GitHub. En Windows, abrir Administrador de credenciales → Windows Credentials → actualizar la contraseña de GitHub. O usar token personal de acceso (Settings → Developer settings → Personal access tokens).</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ Conflicto al hacer git pull</div>
    <p>Alguien más modificó el mismo archivo.</p>
    <div class="ec-fix">✅ Solución: <code>git status</code> para ver los archivos en conflicto. Abrir el archivo, buscar los marcadores <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> y resolver manualmente. Luego <code>git add archivo</code> y <code>git commit</code>.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ Los datos no cargan (tabla vacía)</div>
    <p>Error de autenticación o reglas de Firestore.</p>
    <div class="ec-fix">✅ Solución: Abrir Chrome DevTools → Console y buscar errores de Firebase. Verificar en Firebase Console → Firestore → Rules que las reglas permiten lectura.</div>
  </div>

  <!-- 8 -->
  <h1 class="section page-break">8. Problemas de PWA / Service Worker</h1>

  <h2 class="sub">Diagnóstico en Chrome DevTools</h2>
  <div class="step"><div class="step-num">1</div><div>F12 → pestaña <strong>Application</strong></div></div>
  <div class="step"><div class="step-num">2</div><div><strong>Service Workers</strong>: ver estado, errores, fecha de instalación</div></div>
  <div class="step"><div class="step-num">3</div><div><strong>Cache Storage</strong>: ver qué archivos están en caché bajo <code>eve-control-v3-r1</code></div></div>
  <div class="step"><div class="step-num">4</div><div><strong>IndexedDB</strong>: ver <code>EVEControlOffline</code> → <code>cola_pendiente</code> y <code>cache_datos</code></div></div>
  <div class="step"><div class="step-num">5</div><div><strong>Manifest</strong>: verificar que carga sin errores</div></div>

  <div class="error-card">
    <div class="ec-title">❌ La app no funciona offline</div>
    <div class="ec-fix">✅ Verificar: 1) El SW está registrado (Application → Service Workers → Status: activated). 2) Los archivos están en Cache Storage. 3) Se visitó la app con internet al menos una vez. 4) El nombre del cache en SW coincide con lo que está en Cache Storage.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ Los registros offline no se sincronizan</div>
    <div class="ec-fix">✅ Verificar: 1) En IndexedDB → cola_pendiente, el campo <code>estado</code> debe ser <code>'pendiente'</code> (no <code>'error'</code>). 2) Si estado es <code>'error'</code>, hay un problema con el dato mismo. 3) Revisar Console por errores de Firebase al sincronizar.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ El botón "Instalar App" no aparece en Android</div>
    <div class="ec-fix">✅ Verificar: 1) Usar Chrome (no Safari, Firefox, etc.). 2) La app debe haberse cargado con HTTPS. 3) No haber instalado ya la app (<code>localStorage.eve-app-instalada</code>). 4) Esperar unos segundos después de cargar la página.</div>
  </div>

  <h2 class="sub">Limpiar todo y empezar de cero (diagnóstico extremo)</h2>
  <div class="cmd">
<span class="comment"># En Chrome DevTools → Application:</span>
<span class="comment"># 1. Service Workers → Unregister</span>
<span class="comment"># 2. Cache Storage → borrar cache eve-control-v3-r1</span>
<span class="comment"># 3. IndexedDB → borrar EVEControlOffline</span>
<span class="comment"># 4. Recargar la página</span>

<span class="comment"># O desde consola del navegador:</span>
caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
indexedDB.deleteDatabase(<span class="gold">'EVEControlOffline'</span>);
localStorage.clear();
location.reload();</div>

  <!-- 9 -->
  <h1 class="section page-break">9. Problemas de Firebase / Firestore</h1>

  <div class="error-card">
    <div class="ec-title">❌ "Failed precondition: offline persistence" en consola</div>
    <p>Hay múltiples pestañas del sistema abiertas simultáneamente.</p>
    <div class="ec-fix">✅ Normal y esperado. El sistema tiene <code>synchronizeTabs: true</code> que lo maneja automáticamente. No afecta el funcionamiento.</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ "Quota exceeded" en Firestore</div>
    <p>Se alcanzó el límite del plan gratuito (Spark). Firebase tiene límites diarios.</p>
    <div class="ec-fix">✅ Verificar en Firebase Console → Usage and billing. El plan gratuito permite 50,000 lecturas y 20,000 escrituras por día. Si se superan consistentemente, considerar el plan Blaze (pago por uso).</div>
  </div>

  <div class="error-card">
    <div class="ec-title">❌ Datos no aparecen o están desactualizados</div>
    <div class="ec-fix">✅ 1) Recargar la página. 2) Verificar en Firebase Console → Firestore que los datos existen. 3) Revisar que el campo <code>fechaSalida</code> esté en formato correcto (YYYY-MM-DD). 4) Los filtros de fecha usan fechaSalida para destaraje.</div>
  </div>

  <h2 class="sub">Verificar estado de Firebase desde la consola del navegador</h2>
  <div class="cmd">
<span class="comment"># Ver todos los registros de destaraje:</span>
window.db.collection(<span class="gold">'destaraje'</span>).get().then(s => console.log(s.size, <span class="gold">'registros'</span>));

<span class="comment"># Ver un documento específico:</span>
window.db.collection(<span class="gold">'destaraje'</span>).doc(<span class="gold">'ID_DEL_DOCUMENTO'</span>).get()
  .then(d => console.log(d.data()));

<span class="comment"># Ver estado de la cola offline:</span>
window.EVE_OFFLINE.contarPendientes().then(n => console.log(n, <span class="gold">'pendientes'</span>));</div>

  <!-- 10 -->
  <h1 class="section page-break">10. Checklist de despliegue</h1>

  <p>Ejecutar esta lista después de cada actualización importante:</p>

  <table>
    <tr><th>#</th><th>Verificación</th><th>Cómo comprobar</th></tr>
    <tr><td>1</td><td>Push completado sin errores</td><td><code>git log --oneline -3</code> muestra el commit</td></tr>
    <tr><td>2</td><td>GitHub Pages desplegó</td><td>URL carga y muestra la versión nueva</td></tr>
    <tr><td>3</td><td>Login funciona</td><td>Iniciar sesión con Admin</td></tr>
    <tr><td>4</td><td>Datos cargan en todos los módulos</td><td>Ver que las tablas tienen datos</td></tr>
    <tr><td>5</td><td>Guardar un registro de prueba</td><td>Aparecer en tabla y confirmarse en Firebase</td></tr>
    <tr><td>6</td><td>Reporte PDF se genera</td><td>Módulo Reportes → Vista Previa → PDF</td></tr>
    <tr><td>7</td><td>manifest.json accesible</td><td>Abrir /eve-control-v2/manifest.json</td></tr>
    <tr><td>8</td><td>Service Worker registrado</td><td>DevTools → Application → Service Workers</td></tr>
    <tr><td>9</td><td>Sin errores en consola</td><td>DevTools → Console (solo ignorar ERR_INTERNET_DISCONNECTED en prueba offline)</td></tr>
    <tr><td>10</td><td>Funciona en celular</td><td>Abrir en Chrome Android y probar captura</td></tr>
  </table>

  <h2 class="sub">Después de cambios en service-worker.js</h2>
  <table>
    <tr><th>#</th><th>Verificación adicional</th></tr>
    <tr><td>11</td><td>CACHE_NAME incrementado (r1 → r2 → ...)</td></tr>
    <tr><td>12</td><td>Cache Storage muestra el nuevo nombre en DevTools</td></tr>
    <tr><td>13</td><td>Modo avión: recargar app y abre desde caché</td></tr>
    <tr><td>14</td><td>Guardar registro offline → se sincroniza al volver internet</td></tr>
  </table>

  <!-- 11 -->
  <h1 class="section page-break">11. Referencia rápida de comandos</h1>

  <h2 class="sub">Git — día a día</h2>
  <div class="cmd">
<span class="green">git pull</span> origin master               <span class="comment"># Traer cambios</span>
<span class="green">git status</span>                            <span class="comment"># Ver archivos modificados</span>
<span class="green">git add</span> js/destaraje.js               <span class="comment"># Agregar archivo</span>
<span class="green">git add</span> -A                            <span class="comment"># Agregar todo</span>
<span class="green">git commit</span> -m <span class="gold">"fix: descripcion"</span>      <span class="comment"># Crear commit</span>
<span class="green">git push</span> origin master               <span class="comment"># Subir a GitHub / desplegar</span>
<span class="green">git log</span> --oneline -10                 <span class="comment"># Ver historial</span>
<span class="green">git diff</span> js/utils.js                  <span class="comment"># Ver cambios en archivo</span></div>

  <h2 class="sub">Git — recuperación</h2>
  <div class="cmd">
<span class="green">git checkout</span> -- js/utils.js           <span class="comment"># Descartar cambios en archivo</span>
<span class="green">git reset</span> --soft HEAD~1               <span class="comment"># Deshacer último commit (conserva cambios)</span>
<span class="green">git stash</span>                             <span class="comment"># Guardar cambios sin commitear</span>
<span class="green">git stash pop</span>                         <span class="comment"># Recuperar cambios guardados</span>
<span class="green">git show</span> HEAD:js/utils.js             <span class="comment"># Ver versión del archivo en HEAD</span></div>

  <h2 class="sub">Diagnóstico desde consola del navegador</h2>
  <div class="cmd">
<span class="comment"># Estado del sistema</span>
console.log(window.EVE);              <span class="comment"># Ver datos cargados</span>
console.log(navigator.onLine);        <span class="comment"># true/false</span>

<span class="comment"># Offline</span>
window.EVE_OFFLINE.contarPendientes().then(console.log);
window.EVE_OFFLINE.sincronizarCola();

<span class="comment"># Firebase</span>
window.db.collection(<span class="gold">'destaraje'</span>).get().then(s => console.log(s.size));

<span class="comment"># Service Worker</span>
navigator.serviceWorker.getRegistrations().then(console.log);
caches.keys().then(console.log);       <span class="comment"># Ver caches activos</span></div>

  <h2 class="sub">URLs importantes</h2>
  <table>
    <tr><th>Recurso</th><th>URL</th></tr>
    <tr><td>App en producción</td><td>https://cpnetohiva.github.io/eve-control-v2/</td></tr>
    <tr><td>Repositorio GitHub</td><td>https://github.com/Cpnetohiva/eve-control-v2</td></tr>
    <tr><td>Firebase Console</td><td>https://console.firebase.google.com → proyecto: everplastic</td></tr>
    <tr><td>GitHub Pages config</td><td>https://github.com/Cpnetohiva/eve-control-v2/settings/pages</td></tr>
  </table>

  <div style="margin-top:40px;padding:16px;background:#0d1117;color:#e6edf3;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:9pt;text-align:center;">
    <span style="color:#3fb950;">EVE Control v3.0</span> &nbsp;·&nbsp; <span style="color:#e3b341;">EVERPLASTIC / Mehicaso Group</span> &nbsp;·&nbsp; <span style="color:#8b949e;">Junio 2026</span>
  </div>

</div>
</body>
</html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Manual de Usuario
  console.log('Generando Manual de Usuario...');
  await page.setContent(MANUAL_USUARIO_HTML, { waitUntil: 'networkidle' });
  const pdfUsuario = path.resolve(__dirname, '../../MANUAL_USUARIO_EVE_CONTROL.pdf');
  await page.pdf({
    path: pdfUsuario,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
  console.log('✅ Manual de Usuario guardado en:', pdfUsuario);

  // Manual Técnico
  console.log('Generando Manual Técnico y Git...');
  await page.setContent(MANUAL_GIT_HTML, { waitUntil: 'networkidle' });
  const pdfTecnico = path.resolve(__dirname, '../../MANUAL_TECNICO_GIT.pdf');
  await page.pdf({
    path: pdfTecnico,
    format: 'A4',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });
  console.log('✅ Manual Técnico guardado en:', pdfTecnico);

  await browser.close();
  console.log('Listo.');
})();
