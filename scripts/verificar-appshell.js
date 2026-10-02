// K23 — Verificación de APP_SHELL de service-worker.js contra index.html (sin dependencias).
//
// service-worker.js guarda APP_SHELL con cache.addAll, que es ATÓMICO: una ruta inexistente rompe la instalación completa,
// y un script de index.html que falte en la lista no está disponible sin conexión (docs/auditoria_service_worker.md).
// Comprobaciones:
//   1. Todo <script src> LOCAL de index.html está en APP_SHELL.
//   2. Toda entrada LOCAL de APP_SHELL existe en disco con la ruta y las mayúsculas exactas (el alojamiento distingue
//      mayúsculas aunque Windows no).
//   3. APP_SHELL no tiene entradas duplicadas.
//   4. Los recursos de mejor esfuerzo (APP_SHELL_OPCIONAL) no repiten entradas de APP_SHELL.
// Las URL externas (https://...) no se buscan en disco.
//
// Uso: node scripts/verificar-appshell.js   (código de salida 1 si alguna comprobación falla)

const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(RAIZ, 'service-worker.js'), 'utf8');

function extraerLista(nombre, obligatoria) {
  const m = sw.match(new RegExp(`const ${nombre} = \\[([\\s\\S]*?)\\n\\];`));
  if (!m) {
    if (obligatoria === false) return [];
    throw new Error(`No se encontró ${nombre} en service-worker.js`);
  }
  return Array.from(m[1].matchAll(/^\s*'([^']+)',?\s*$/gm)).map((x) => x[1]);
}

const esExterna = (ruta) => /^https?:\/\//.test(ruta);
const quitarConsulta = (ruta) => ruta.split(/[?#]/)[0];

// Existe con el nombre exacto: se compara cada segmento contra el listado real del directorio.
function existeExacto(ruta) {
  const limpia = quitarConsulta(ruta).replace(/^\.\//, '');
  if (limpia === '') return fs.statSync(RAIZ).isDirectory();
  let actual = RAIZ;
  for (const segmento of limpia.split('/')) {
    if (!fs.existsSync(actual) || !fs.statSync(actual).isDirectory()) return false;
    if (!fs.readdirSync(actual).includes(segmento)) return false;
    actual = path.join(actual, segmento);
  }
  return true;
}

const appShell = extraerLista('APP_SHELL');
const opcional = extraerLista('APP_SHELL_OPCIONAL', false);
const scriptsHtml = Array.from(html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)).map((m) => m[1]);
const scriptsLocales = scriptsHtml.filter((s) => !esExterna(s)).map(quitarConsulta);
const normalizadas = new Set(appShell.map((e) => quitarConsulta(e).replace(/^\.\//, '')));

const comprobaciones = [];
function comprobar(nombre, faltas) {
  comprobaciones.push({ nombre, faltas });
}

comprobar('Todo script local de index.html está en APP_SHELL',
  scriptsLocales.filter((s) => !normalizadas.has(s)).map((s) => `${s} (index.html lo carga y APP_SHELL no lo tiene)`));

comprobar('Toda entrada local de APP_SHELL existe en disco (ruta y mayúsculas exactas)',
  appShell.filter((e) => !esExterna(e) && !existeExacto(e)).map((e) => `${e} (no existe en el repo; cache.addAll fallaría)`));

const vistas = new Set();
const duplicadas = [];
appShell.forEach((e) => {
  if (vistas.has(e)) duplicadas.push(`${e} (aparece más de una vez)`);
  vistas.add(e);
});
comprobar('APP_SHELL no tiene entradas duplicadas', duplicadas);

comprobar('APP_SHELL_OPCIONAL no repite entradas de APP_SHELL',
  opcional.filter((e) => vistas.has(e)).map((e) => `${e} (ya está en APP_SHELL, que es atómico)`));

comprobar('Los scripts externos de index.html están en APP_SHELL o en APP_SHELL_OPCIONAL',
  scriptsHtml.filter((s) => esExterna(s) && !vistas.has(s) && !opcional.includes(s)).map((s) => `${s} (no se guarda para uso sin conexión)`));

let fallos = 0;
for (const { nombre, faltas } of comprobaciones) {
  if (faltas.length === 0) {
    console.log(`PASS  ${nombre}`);
  } else {
    fallos += 1;
    console.log(`FAIL  ${nombre}`);
    faltas.forEach((f) => console.log(`      - ${f}`));
  }
}
console.log(`\nAPP_SHELL: ${appShell.length} entradas · APP_SHELL_OPCIONAL: ${opcional.length} · scripts de index.html: ${scriptsHtml.length} (${scriptsLocales.length} locales)`);
console.log(`${comprobaciones.length - fallos}/${comprobaciones.length} comprobaciones correctas`);
process.exit(fallos > 0 ? 1 : 0);
