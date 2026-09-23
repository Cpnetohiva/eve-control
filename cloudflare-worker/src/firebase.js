// Acceso de solo lectura a Firestore vía REST + Google OAuth, firmado con el
// service account usando Web Crypto (SubtleCrypto). No usa 'firebase-admin':
// su cliente de Firestore depende de gRPC/Node networking, incompatible con
// el runtime de Cloudflare Workers incluso con el flag nodejs_compat.

function base64UrlFromBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importPrivateKey(pem) {
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  return crypto.subtle.importKey(
    'pkcs8',
    bytesFromBase64(pemBody),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function obtenerAccessToken(serviceAccount, scope) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claimSet = {
    iss: serviceAccount.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600
  };

  const unsignedToken = `${base64UrlFromString(JSON.stringify(header))}.${base64UrlFromString(JSON.stringify(claimSet))}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsignedToken)
  );
  const jwt = `${unsignedToken}.${base64UrlFromBytes(new Uint8Array(signature))}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  });

  if (!response.ok) {
    throw new Error(`No se pudo obtener access_token (${response.status}): ${await response.text()}`);
  }

  const data = await response.json();
  return data.access_token;
}

// Cuenta documentos de una colección vía Firestore :runAggregationQuery
// (evita paginar todos los documentos solo para contar).
export async function contarDocumentosColeccion(serviceAccountJson, coleccion) {
  const serviceAccount = JSON.parse(serviceAccountJson);
  const accessToken = await obtenerAccessToken(serviceAccount, 'https://www.googleapis.com/auth/datastore');

  const url = `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents:runAggregationQuery`;
  const body = {
    structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: coleccion }] },
      aggregations: [{ alias: 'count', count: {} }]
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Firestore respondió ${response.status}: ${await response.text()}`);
  }

  const [result] = await response.json();
  const countValue = result?.result?.aggregateFields?.count?.integerValue;
  return Number(countValue ?? 0);
}
