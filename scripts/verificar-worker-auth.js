// W1 — Autenticación del Worker de Cloudflare con el ID token de Firebase.
//
// Carga el Worker REAL (cloudflare-worker/src/index.js, auth.js y firebase.js; se copian a una carpeta temporal como .mjs porque
// el package.json raíz es CommonJS) y reemplaza solo `fetch` por un Google falso: las claves públicas JWK de securetoken, el
// intercambio OAuth de la cuenta de servicio, Firestore REST (users/{uid} y users/{uid}/dispositivos) e Identity Toolkit. Los
// JWT se firman con una clave de prueba. Comprueba que:
//  - /admin/devices (GET y DELETE) y /admin/reset-password: un token válido de Admin con escritura pasa; un token válido sin
//    rol Admin con escritura (lectura, ninguno, sin documento) recibe 403 y no ejecuta nada; token expirado, firma inválida,
//    aud o iss incorrectos, iat futuro, alg distinto de RS256, kid desconocido, sin sub o sin header reciben 401;
//  - el secreto compartido anterior (x-device-check-secret) ya no abre ningún endpoint, aunque siga definido en el entorno;
//  - /device-check usa el uid del token (un usuario solo registra sus propios dispositivos) y conserva su lógica de límite;
//  - /health sigue abierto; el CORS permite Authorization; la autenticación va antes de validar el cuerpo;
//  - las claves de Google se descargan una vez y se reutilizan según Cache-Control, se rotan y toleran una caída de Google.
// No se llama a ningún servicio real ni se usa ningún secreto real.
//
// Uso: node scripts/verificar-worker-auth.js   (código de salida 1 si algún caso falla)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const RAIZ = path.join(__dirname, '..');
const { subtle } = globalThis.crypto;

const URL_CLAVES = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const BASE_DOCS = 'https://firestore.googleapis.com/v1/projects/everplastic/databases/(default)/documents/';
const SECRETO_ANTIGUO_DE_PRUEBA = 'secreto-antiguo-solo-para-pruebas';
const ALGORITMO = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const b64url = (datos) => Buffer.from(datos).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (objeto) => b64url(JSON.stringify(objeto));

async function generarClave() {
  return subtle.generateKey({ ...ALGORITMO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['sign', 'verify']);
}

async function firmar(claveFirma, encabezado, claims) {
  const sinFirma = `${b64urlJson(encabezado)}.${b64urlJson(claims)}`;
  const firma = await subtle.sign(ALGORITMO, claveFirma.privateKey, new TextEncoder().encode(sinFirma));
  return `${sinFirma}.${b64url(new Uint8Array(firma))}`;
}

// ── Entorno falso: Google, OAuth, Firestore, Identity Toolkit ──────────────

const estado = {};

function aCampos(objeto) {
  const campos = {};
  for (const [k, v] of Object.entries(objeto)) {
    if (typeof v === 'string') campos[k] = { stringValue: v };
    else if (typeof v === 'boolean') campos[k] = { booleanValue: v };
    else if (typeof v === 'number') campos[k] = { integerValue: String(v) };
    else if (v && typeof v === 'object') campos[k] = { mapValue: { fields: aCampos(v) } };
  }
  return campos;
}

function respuestaJson(datos, estadoHttp = 200, cabeceras = {}) {
  return new Response(JSON.stringify(datos), { status: estadoHttp, headers: { 'content-type': 'application/json', ...cabeceras } });
}

async function fetchFalso(url, opciones = {}) {
  url = String(url);
  const metodo = (opciones.method || 'GET').toUpperCase();
  estado.llamadas.push({ metodo, url });
  if (url === URL_CLAVES) {
    estado.descargasClaves += 1;
    if (estado.googleCaido) return new Response('caído', { status: 503 });
    return respuestaJson({ keys: estado.clavesPublicas }, 200, { 'cache-control': estado.cacheControl });
  }
  if (url === 'https://oauth2.googleapis.com/token') return respuestaJson({ access_token: 'acceso-de-prueba' });
  if (url === 'https://identitytoolkit.googleapis.com/v1/accounts:update') {
    const cuerpo = JSON.parse(opciones.body);
    estado.cambiosPassword.push({ uid: cuerpo.localId, longitud: String(cuerpo.password).length });
    return respuestaJson({ localId: cuerpo.localId });
  }
  if (url.startsWith(BASE_DOCS)) {
    const ruta = url.slice(BASE_DOCS.length).split('?')[0].split('/');
    if (ruta[0] === 'users' && ruta.length === 2) {
      const usuario = estado.usuarios[ruta[1]];
      return usuario ? respuestaJson({ name: `x/users/${ruta[1]}`, fields: aCampos(usuario) }) : respuestaJson({ error: 'no existe' }, 404);
    }
    if (ruta[0] === 'users' && ruta[2] === 'dispositivos' && ruta.length === 3) {
      const lista = estado.dispositivos[ruta[1]] || {};
      return respuestaJson({ documents: Object.entries(lista).map(([id, d]) => ({ name: `x/users/${ruta[1]}/dispositivos/${id}`, fields: aCampos(d) })) });
    }
    if (ruta[0] === 'users' && ruta[2] === 'dispositivos' && ruta.length === 4) {
      if (metodo === 'DELETE') {
        estado.borrados.push({ uid: ruta[1], id: ruta[3] });
        return respuestaJson({});
      }
      if (metodo === 'PATCH') {
        estado.escrituras.push({ uid: ruta[1], id: ruta[3] });
        return respuestaJson({});
      }
    }
  }
  return respuestaJson({ error: `fetch no simulado: ${metodo} ${url}` }, 500);
}

let Worker;
let AuthModulo;
let carpetaTemporal;
let claveGoogle;
let claveAtacante;
let jwkPublico;
let cuentaServicioJson;
let desfaseMs = 0;
const ahoraReal = Date.now.bind(Date);

const ahoraSeg = () => Math.floor(Date.now() / 1000);

async function prepararEntorno() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worker-auth-'));
  carpetaTemporal = tmp;
  for (const archivo of ['index', 'auth', 'firebase']) {
    const fuente = fs.readFileSync(path.join(RAIZ, 'cloudflare-worker/src', `${archivo}.js`), 'utf8').replace(/from '\.\/(\w+)\.js'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(tmp, `${archivo}.mjs`), fuente);
  }
  Worker = (await import(pathToFileURL(path.join(tmp, 'index.mjs')).href)).default;
  AuthModulo = await import(pathToFileURL(path.join(tmp, 'auth.mjs')).href);

  claveGoogle = await generarClave();
  claveAtacante = await generarClave();
  const jwk = await subtle.exportKey('jwk', claveGoogle.publicKey);
  jwkPublico = { kid: 'kid-prueba', kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig' };

  const claveServicio = await generarClave();
  const pkcs8 = Buffer.from(await subtle.exportKey('pkcs8', claveServicio.privateKey)).toString('base64');
  cuentaServicioJson = JSON.stringify({
    client_email: 'prueba@everplastic.iam.gserviceaccount.com',
    project_id: 'everplastic',
    private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`
  });
  Date.now = () => ahoraReal() + desfaseMs;
  globalThis.fetch = fetchFalso;
}

function reiniciar() {
  desfaseMs = 0;
  AuthModulo.reiniciarCacheClaves();
  Object.assign(estado, {
    llamadas: [], descargasClaves: 0, googleCaido: false, cacheControl: 'public, max-age=3600, must-revalidate',
    clavesPublicas: [jwkPublico], cambiosPassword: [], borrados: [], escrituras: [],
    usuarios: {
      uidAdmin: { username: 'Admin', permisosResueltos: { admin: 'escritura', control_produccion: 'escritura' } },
      uidLectura: { username: 'Lector', permisosResueltos: { admin: 'lectura', destaraje: 'escritura' } },
      uidSinAdmin: { username: 'Operador', permisosResueltos: { destaraje: 'escritura', admin: 'ninguno' } },
      uidSinPermisos: { username: 'Viejo' }
    },
    dispositivos: { uidSinAdmin: {} }
  });
}

const env = () => ({ FIREBASE_SERVICE_ACCOUNT_JSON: cuentaServicioJson, DEVICE_CHECK_SECRET: SECRETO_ANTIGUO_DE_PRUEBA });

async function token(uid, cambios = {}, { clave = claveGoogle, encabezado } = {}) {
  const ahora = ahoraSeg();
  const claims = { iss: 'https://securetoken.google.com/everplastic', aud: 'everplastic', auth_time: ahora - 30, iat: ahora - 30, exp: ahora + 3600, sub: uid, user_id: uid, ...cambios };
  for (const [k, v] of Object.entries(claims)) if (v === undefined) delete claims[k];
  return firmar(clave, encabezado || { alg: 'RS256', kid: 'kid-prueba', typ: 'JWT' }, claims);
}

function solicitud(metodo, ruta, { bearer, cabeceras = {}, cuerpo } = {}) {
  const headers = { ...cabeceras };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (cuerpo !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://worker.test${ruta}`, { method: metodo, headers, body: cuerpo === undefined ? undefined : (typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo)) });
}

const llamar = (req) => Worker.fetch(req, env());
const sinEfectos = () => estado.borrados.length === 0 && estado.cambiosPassword.length === 0 && estado.escrituras.length === 0;

const ENDPOINTS_ADMIN = [
  { nombre: 'GET /admin/devices', hacer: (bearer, cabeceras) => solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer, cabeceras }) },
  { nombre: 'DELETE /admin/devices', hacer: (bearer, cabeceras) => solicitud('DELETE', '/admin/devices', { bearer, cabeceras, cuerpo: { uid: 'uidSinAdmin', deviceId: 'd1' } }) },
  { nombre: 'POST /admin/reset-password', hacer: (bearer, cabeceras) => solicitud('POST', '/admin/reset-password', { bearer, cabeceras, cuerpo: { uid: 'uidSinAdmin' } }) }
];

// ── Casos ──────────────────────────────────────────────────────────────────

const casos = [];
function caso(nombre, fn) { casos.push({ nombre, fn }); }
function afirmar(condicion, mensaje) { if (!condicion) throw new Error(mensaje); }
function igual(real, esperado, mensaje) {
  const a = JSON.stringify(real);
  const b = JSON.stringify(esperado);
  afirmar(a === b, `${mensaje}: esperado ${b}, obtenido ${a}`);
}

caso('W1: token válido de Admin con escritura pasa en los tres endpoints /admin/*', async () => {
  const bearer = await token('uidAdmin');
  const lista = await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer }));
  igual([lista.status, await lista.json()], [200, []], 'GET /admin/devices');
  const borrar = await llamar(solicitud('DELETE', '/admin/devices', { bearer, cuerpo: { uid: 'uidSinAdmin', deviceId: 'd1' } }));
  igual([borrar.status, (await borrar.json()).success], [200, true], 'DELETE /admin/devices');
  igual(estado.borrados, [{ uid: 'uidSinAdmin', id: 'd1' }], 'se borró el dispositivo pedido');
  const reset = await llamar(solicitud('POST', '/admin/reset-password', { bearer, cuerpo: { uid: 'uidSinAdmin' } }));
  const datos = await reset.json();
  igual([reset.status, datos.success, typeof datos.nuevaPassword, datos.nuevaPassword.length], [200, true, 'string', 10], 'POST /admin/reset-password');
  igual(estado.cambiosPassword, [{ uid: 'uidSinAdmin', longitud: 10 }], 'se cambió la contraseña del uid pedido');
});

caso('W1: token válido SIN rol Admin con escritura recibe 403 y no ejecuta nada (admin lectura, ninguno, sin permisos o sin documento)', async () => {
  for (const uid of ['uidLectura', 'uidSinAdmin', 'uidSinPermisos', 'uidInexistente']) {
    const bearer = await token(uid);
    for (const ep of ENDPOINTS_ADMIN) {
      const respuesta = await llamar(ep.hacer(bearer));
      igual(respuesta.status, 403, `${ep.nombre} con ${uid}`);
    }
  }
  afirmar(sinEfectos(), 'ningún endpoint ejecutó su efecto');
});

caso('W1: token expirado, firma inválida, aud o iss incorrectos, iat futuro, alg distinto, kid desconocido o sin sub reciben 401', async () => {
  const ahora = ahoraSeg();
  const malos = {
    'expirado': await token('uidAdmin', { exp: ahora - 10 }),
    'sin exp': await token('uidAdmin', { exp: undefined }),
    'firma de otra clave (mismo kid)': await token('uidAdmin', {}, { clave: claveAtacante }),
    'aud incorrecto': await token('uidAdmin', { aud: 'otro-proyecto' }),
    'iss incorrecto': await token('uidAdmin', { iss: 'https://securetoken.google.com/otro-proyecto' }),
    'iss de otro emisor': await token('uidAdmin', { iss: 'https://accounts.google.com' }),
    'iat en el futuro': await token('uidAdmin', { iat: ahora + 3600 }),
    'auth_time en el futuro': await token('uidAdmin', { auth_time: ahora + 3600 }),
    'sin sub': await token('uidAdmin', { sub: undefined }),
    'sub vacío': await token('uidAdmin', { sub: '' }),
    'kid desconocido': await token('uidAdmin', {}, { encabezado: { alg: 'RS256', kid: 'kid-que-no-existe', typ: 'JWT' } }),
    'sin kid': await token('uidAdmin', {}, { encabezado: { alg: 'RS256', typ: 'JWT' } }),
    'alg none': `${b64urlJson({ alg: 'none', typ: 'JWT' })}.${b64urlJson({ iss: 'https://securetoken.google.com/everplastic', aud: 'everplastic', sub: 'uidAdmin', iat: ahora - 5, exp: ahora + 600 })}.`,
    'alg HS256': await token('uidAdmin', {}, { encabezado: { alg: 'HS256', kid: 'kid-prueba', typ: 'JWT' } }),
    'basura': 'esto.no.es-un-jwt',
    'solo dos partes': 'aaa.bbb'
  };
  for (const [motivo, bearer] of Object.entries(malos)) {
    for (const ep of ENDPOINTS_ADMIN) {
      const respuesta = await llamar(ep.hacer(bearer));
      igual(respuesta.status, 401, `${ep.nombre}: ${motivo}`);
    }
  }
  afirmar(sinEfectos(), 'ningún token inválido ejecutó nada');
});

caso('W1: sin header Authorization, o con otro esquema, recibe 401', async () => {
  for (const ep of ENDPOINTS_ADMIN) {
    igual((await llamar(ep.hacer(undefined))).status, 401, `${ep.nombre} sin header`);
    igual((await llamar(ep.hacer(undefined, { authorization: 'Basic dXNlcjpwYXNz' }))).status, 401, `${ep.nombre} con Basic`);
    igual((await llamar(ep.hacer(undefined, { authorization: 'Bearer' }))).status, 401, `${ep.nombre} Bearer vacío`);
  }
  afirmar(sinEfectos(), 'nada ejecutado');
});

caso('W1: el secreto compartido anterior ya no abre ningún endpoint (aunque siga definido en el entorno)', async () => {
  for (const ep of ENDPOINTS_ADMIN) {
    const respuesta = await llamar(ep.hacer(undefined, { 'x-device-check-secret': SECRETO_ANTIGUO_DE_PRUEBA }));
    igual(respuesta.status, 401, `${ep.nombre} con el secreto viejo`);
    // Tampoco sirve junto a un token válido de alguien sin rol.
    const conTokenSinRol = await llamar(ep.hacer(await token('uidSinAdmin'), { 'x-device-check-secret': SECRETO_ANTIGUO_DE_PRUEBA }));
    igual(conTokenSinRol.status, 403, `${ep.nombre}: secreto viejo + token sin rol`);
  }
  const cuerpoDevice = { uid: 'uidSinAdmin', token: 't1', fingerprint: 'f1', userAgent: 'ua' };
  const dc = await llamar(solicitud('POST', '/device-check', { cabeceras: { 'x-device-check-secret': SECRETO_ANTIGUO_DE_PRUEBA }, cuerpo: cuerpoDevice }));
  igual(dc.status, 401, 'POST /device-check con el secreto viejo');
  afirmar(sinEfectos(), 'nada ejecutado');
});

caso('W1: la autenticación va antes de validar el cuerpo (sin token, un JSON inválido da 401 y no 400)', async () => {
  igual((await llamar(solicitud('POST', '/admin/reset-password', { cuerpo: '{no es json' }))).status, 401, 'reset sin token');
  igual((await llamar(solicitud('DELETE', '/admin/devices', { cuerpo: '{}' }))).status, 401, 'delete sin token');
  igual((await llamar(solicitud('POST', '/device-check', { cuerpo: '{no es json' }))).status, 401, 'device-check sin token');
  // Con token de Admin válido sí se llega a la validación del cuerpo.
  const bearer = await token('uidAdmin');
  igual((await llamar(solicitud('POST', '/admin/reset-password', { bearer, cuerpo: '{no es json' }))).status, 400, 'JSON inválido con token');
  igual((await llamar(solicitud('POST', '/admin/reset-password', { bearer, cuerpo: {} }))).status, 400, 'sin uid con token');
  igual((await llamar(solicitud('GET', '/admin/devices', { bearer }))).status, 400, 'sin query uid con token');
});

caso('W1: /device-check usa el uid del token: registra, respeta el límite y rechaza el uid de otro', async () => {
  const bearer = await token('uidSinAdmin');
  const cuerpo = { uid: 'uidSinAdmin', token: 't1', fingerprint: 'f1', userAgent: 'ua' };
  const ok = await llamar(solicitud('POST', '/device-check', { bearer, cuerpo }));
  igual([ok.status, (await ok.json()).allowed], [200, true], 'dispositivo nuevo');
  igual(estado.escrituras.map((e) => e.uid), ['uidSinAdmin'], 'se registró en SU subcolección');
  // Sin uid en el cuerpo: se toma el del token.
  estado.escrituras.length = 0;
  const sinUid = await llamar(solicitud('POST', '/device-check', { bearer, cuerpo: { token: 't2', fingerprint: 'f2', userAgent: 'ua' } }));
  igual(sinUid.status, 200, 'sin uid en el cuerpo');
  igual(estado.escrituras.map((e) => e.uid), ['uidSinAdmin'], 'usa el uid del token');
  // El uid de otro usuario es rechazado y no escribe nada.
  estado.escrituras.length = 0;
  const ajeno = await llamar(solicitud('POST', '/device-check', { bearer, cuerpo: { ...cuerpo, uid: 'uidAdmin' } }));
  igual(ajeno.status, 401, 'uid ajeno');
  afirmar(sinEfectos(), 'no escribió nada');
  // Límite: con 2 dispositivos (límite por omisión) el tercero recibe 403 limit_reached.
  estado.dispositivos.uidSinAdmin = { a: { token: 'x', fingerprint: 'fx', userAgent: 'ua' }, b: { token: 'y', fingerprint: 'fy', userAgent: 'ua' } };
  const tercero = await llamar(solicitud('POST', '/device-check', { bearer, cuerpo: { token: 't9', fingerprint: 'f9', userAgent: 'ua' } }));
  const datos = await tercero.json();
  igual([tercero.status, datos.allowed, datos.reason], [403, false, 'limit_reached'], 'límite alcanzado');
  // Un dispositivo ya registrado sigue entrando.
  const conocido = await llamar(solicitud('POST', '/device-check', { bearer, cuerpo: { token: 'x', fingerprint: 'fx', userAgent: 'ua' } }));
  igual([conocido.status, (await conocido.json()).reason], [200, 'token_match'], 'dispositivo conocido');
});

caso('W1: /device-check sigue siendo fail-open en el cliente: un token inválido da 401 (no 403, que significaría límite)', async () => {
  const respuesta = await llamar(solicitud('POST', '/device-check', { bearer: await token('uidSinAdmin', { exp: ahoraSeg() - 5 }), cuerpo: { token: 't', fingerprint: 'f', userAgent: 'ua' } }));
  igual(respuesta.status, 401, 'token expirado');
  afirmar(respuesta.status !== 403, 'js/auth.js interpreta 403 como "límite de dispositivos"');
});

caso('W1: /health sigue abierto y el CORS permite Authorization (y ya no x-device-check-secret)', async () => {
  const salud = await llamar(solicitud('GET', '/health'));
  igual([salud.status, (await salud.json()).status], [200, 'ok'], '/health sin credenciales');
  const opciones = await llamar(solicitud('OPTIONS', '/admin/reset-password'));
  const permitidas = opciones.headers.get('access-control-allow-headers');
  igual(opciones.status, 204, 'preflight');
  afirmar(/authorization/i.test(permitidas) && !/x-device-check-secret/i.test(permitidas), `cabeceras permitidas: ${permitidas}`);
  igual((await llamar(solicitud('GET', '/no-existe'))).status, 404, 'ruta desconocida');
});

caso('W1: las claves de Google se descargan una vez y se reutilizan; se vuelven a pedir al vencer Cache-Control', async () => {
  const bearer = await token('uidAdmin');
  for (let i = 0; i < 4; i++) igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer }))).status, 200, `petición ${i + 1}`);
  igual(estado.descargasClaves, 1, 'una sola descarga');
  desfaseMs = 3600 * 1000 + 5000; // pasa el max-age de 3600 s
  const nuevo = await token('uidAdmin');
  igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer: nuevo }))).status, 200, 'tras vencer');
  igual(estado.descargasClaves, 2, 'se volvieron a descargar al vencer');
});

caso('W1: un kid desconocido no martilla a Google (máx. una descarga por minuto) y una rotación de claves se recoge', async () => {
  const desconocido = await token('uidAdmin', {}, { encabezado: { alg: 'RS256', kid: 'kid-nuevo', typ: 'JWT' } });
  igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer: await token('uidAdmin') }))).status, 200, 'calienta la caché');
  for (let i = 0; i < 3; i++) igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer: desconocido }))).status, 401, 'kid nuevo aún no publicado');
  igual(estado.descargasClaves, 1, 'no se pidió de nuevo dentro del minuto');
  desfaseMs = 120 * 1000; // pasaron 2 minutos y Google ya publicó la clave nueva
  estado.clavesPublicas = [jwkPublico, { ...jwkPublico, kid: 'kid-nuevo' }];
  igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer: await token('uidAdmin', {}, { encabezado: { alg: 'RS256', kid: 'kid-nuevo', typ: 'JWT' } }) }))).status, 200, 'con la clave rotada');
  igual(estado.descargasClaves, 2, 'una descarga más');
});

caso('W1: si Google no responde al vencer la caché se usan las claves anteriores; sin ninguna copia, 401', async () => {
  const bearer = await token('uidAdmin');
  igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer }))).status, 200, 'caché inicial');
  estado.googleCaido = true;
  desfaseMs = 3600 * 1000 + 5000;
  igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer: await token('uidAdmin') }))).status, 200, 'Google caído, copia vencida');
  AuthModulo.reiniciarCacheClaves();
  igual((await llamar(solicitud('GET', '/admin/devices?uid=uidSinAdmin', { bearer: await token('uidAdmin') }))).status, 401, 'Google caído y sin copia');
});

// ── Ejecución ────────────────────────────────────────────────────────────

(async () => {
  await prepararEntorno();
  let fallos = 0;
  for (const { nombre, fn } of casos) {
    reiniciar();
    try {
      await fn();
      console.log(`PASS  ${nombre}`);
    } catch (error) {
      fallos += 1;
      console.log(`FAIL  ${nombre}\n      ${error.stack ? error.stack.split('\n').slice(0, 3).join('\n      ') : error.message}`);
    }
  }
  fs.rmSync(carpetaTemporal, { recursive: true, force: true });
  console.log(`\n${casos.length - fallos}/${casos.length} casos correctos`);
  process.exit(fallos > 0 ? 1 : 0);
})();
