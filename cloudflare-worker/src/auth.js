// Autenticación de las peticiones al Worker con el ID token de Firebase (W1).
//
// El cliente manda `Authorization: Bearer <ID token>`. Aquí se verifica el JWT con Web Crypto y sin dependencias, como
// indica la guía de Firebase para verificar ID tokens con código propio:
//   - alg RS256 y un kid que exista en las claves públicas de Google (securetoken), con firma válida;
//   - iss = https://securetoken.google.com/<proyecto> y aud = <proyecto>;
//   - exp en el futuro, iat y auth_time no posteriores a ahora (con una holgura de reloj corta) y sub no vacío (el uid).
// Las claves públicas se descargan en formato JWK y se guardan en memoria según el max-age de su Cache-Control.
//
// Qué NO hace: no consulta si la cuenta fue deshabilitada o su sesión revocada (un ID token ya emitido sigue siendo
// válido hasta su exp, máximo una hora). Por eso el permiso real se lee de Firestore en cada petición.

export class ErrorAuth extends Error {
  constructor(status, mensaje) {
    super(mensaje);
    this.status = status;
  }
}

const URL_CLAVES_GOOGLE = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const PROYECTO_POR_OMISION = 'everplastic';
const HOLGURA_RELOJ_SEG = 60;
const CACHE_MIN_SEG = 60;
const CACHE_MAX_SEG = 24 * 3600;
const CACHE_POR_OMISION_SEG = 3600;
// Si llega un kid desconocido (rotación de claves) se vuelven a pedir las claves, pero no más de una vez por intervalo.
const REINTENTO_KID_DESCONOCIDO_MS = 60 * 1000;

let cacheClaves = null; // { claves: Map(kid -> CryptoKey), expiraEn: ms, descargadaEn: ms }
let descargaEnCurso = null;

export function reiniciarCacheClaves() {
  cacheClaves = null;
  descargaEnCurso = null;
}

function bytesDesdeBase64Url(texto) {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/');
  const relleno = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binario = atob(relleno);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

function jsonDesdeBase64Url(texto) {
  return JSON.parse(new TextDecoder().decode(bytesDesdeBase64Url(texto)));
}

function segundosDeCacheControl(cabecera) {
  const coincidencia = /max-age=(\d+)/i.exec(cabecera || '');
  const segundos = coincidencia ? Number(coincidencia[1]) : CACHE_POR_OMISION_SEG;
  return Math.min(Math.max(segundos, CACHE_MIN_SEG), CACHE_MAX_SEG);
}

async function descargarClaves() {
  const respuesta = await fetch(URL_CLAVES_GOOGLE);
  if (!respuesta.ok) throw new Error(`No se pudieron obtener las claves públicas de Google (${respuesta.status})`);
  const { keys } = await respuesta.json();
  const claves = new Map();
  for (const jwk of keys || []) {
    if (!jwk.kid || jwk.kty !== 'RSA') continue;
    const clave = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );
    claves.set(jwk.kid, clave);
  }
  const ahora = Date.now();
  return { claves, descargadaEn: ahora, expiraEn: ahora + segundosDeCacheControl(respuesta.headers.get('cache-control')) * 1000 };
}

async function refrescarClaves() {
  if (!descargaEnCurso) {
    descargaEnCurso = descargarClaves()
      .then((nuevo) => { cacheClaves = nuevo; return nuevo; })
      .finally(() => { descargaEnCurso = null; });
  }
  return descargaEnCurso;
}

async function obtenerClave(kid) {
  const ahora = Date.now();
  if (!cacheClaves || ahora >= cacheClaves.expiraEn) {
    try {
      await refrescarClaves();
    } catch (error) {
      // Sin red hacia Google: se usa la copia vencida si existe; si no, no hay forma de verificar la firma.
      if (!cacheClaves) throw new ErrorAuth(401, 'No se pudo verificar el token');
    }
  } else if (!cacheClaves.claves.has(kid) && ahora - cacheClaves.descargadaEn >= REINTENTO_KID_DESCONOCIDO_MS) {
    await refrescarClaves().catch(() => {});
  }
  const clave = cacheClaves && cacheClaves.claves.get(kid);
  if (!clave) throw new ErrorAuth(401, 'Token inválido');
  return clave;
}

// Verifica el JWT y devuelve sus claims. Lanza ErrorAuth(401) ante cualquier problema con el token.
export async function verificarIdToken(token, proyecto = PROYECTO_POR_OMISION) {
  const partes = typeof token === 'string' ? token.split('.') : [];
  if (partes.length !== 3 || partes.some((p) => !p)) throw new ErrorAuth(401, 'Token inválido');

  let encabezado;
  let claims;
  try {
    encabezado = jsonDesdeBase64Url(partes[0]);
    claims = jsonDesdeBase64Url(partes[1]);
  } catch {
    throw new ErrorAuth(401, 'Token inválido');
  }
  if (!encabezado || !claims || typeof encabezado !== 'object' || typeof claims !== 'object') throw new ErrorAuth(401, 'Token inválido');
  if (encabezado.alg !== 'RS256' || typeof encabezado.kid !== 'string') throw new ErrorAuth(401, 'Token inválido');

  const clave = await obtenerClave(encabezado.kid);
  let firmaValida = false;
  try {
    firmaValida = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      clave,
      bytesDesdeBase64Url(partes[2]),
      new TextEncoder().encode(`${partes[0]}.${partes[1]}`)
    );
  } catch {
    firmaValida = false;
  }
  if (!firmaValida) throw new ErrorAuth(401, 'Token inválido');

  const ahoraSeg = Math.floor(Date.now() / 1000);
  const numero = (valor) => typeof valor === 'number' && Number.isFinite(valor);
  if (claims.iss !== `https://securetoken.google.com/${proyecto}`) throw new ErrorAuth(401, 'Token inválido');
  if (claims.aud !== proyecto) throw new ErrorAuth(401, 'Token inválido');
  if (!numero(claims.exp) || claims.exp <= ahoraSeg) throw new ErrorAuth(401, 'Token expirado');
  if (!numero(claims.iat) || claims.iat > ahoraSeg + HOLGURA_RELOJ_SEG) throw new ErrorAuth(401, 'Token inválido');
  if (claims.auth_time !== undefined && (!numero(claims.auth_time) || claims.auth_time > ahoraSeg + HOLGURA_RELOJ_SEG)) throw new ErrorAuth(401, 'Token inválido');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new ErrorAuth(401, 'Token inválido');

  return claims;
}

function proyectoDe(env) {
  return (env && env.FIREBASE_PROJECT_ID) || PROYECTO_POR_OMISION;
}

// Lee `Authorization: Bearer <token>` y verifica el ID token. Devuelve { uid, claims }.
export async function autenticarSolicitud(request, env) {
  const cabecera = request.headers.get('authorization') || '';
  const coincidencia = /^Bearer\s+(\S+)$/i.exec(cabecera);
  if (!coincidencia) throw new ErrorAuth(401, 'Falta el token de autorización');
  const claims = await verificarIdToken(coincidencia[1], proyectoDe(env));
  return { uid: claims.sub, claims };
}

// Autentica y además exige que users/{uid}.permisosResueltos.admin sea 'escritura' (el mismo criterio que
// esAdminEscritura() en firestore.rules). `leerUsuario(uid)` devuelve el documento de usuario o null.
export async function exigirAdminEscritura(request, env, leerUsuario) {
  const { uid, claims } = await autenticarSolicitud(request, env);
  const usuario = await leerUsuario(uid);
  const admin = usuario && usuario.permisosResueltos && usuario.permisosResueltos.admin;
  if (admin !== 'escritura') throw new ErrorAuth(403, 'Se requiere el rol Admin con escritura');
  return { uid, claims, usuario };
}
