// Helper de solo lectura/escritura contra la Firebase Rules API (firebaserules.googleapis.com)
// usando la cuenta de servicio, sin depender de firebase-tools (no instalado en este proyecto).
//
// Uso:
//   node scripts/firebase-rules-api.js --key <ruta-service-account.json> --get-release
//   node scripts/firebase-rules-api.js --key <ruta-service-account.json> --deploy-rules firestore.rules

const fs = require('fs');
const { GoogleAuth } = require('google-auth-library');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--key') { out.key = args[++i]; }
    else if (args[i] === '--get-release') { out.getRelease = true; }
    else if (args[i] === '--deploy-rules') { out.deployRules = args[++i]; }
  }
  return out;
}

async function obtenerToken(keyPath) {
  const auth = new GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/cloud-platform']
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const projectId = await auth.getProjectId();
  return { token, projectId };
}

async function llamarApi(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const texto = await res.text();
  let json;
  try { json = JSON.parse(texto); } catch { json = texto; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  const { key, getRelease, deployRules } = parseArgs();
  if (!key) {
    console.error('Falta --key <ruta-service-account.json>');
    process.exit(1);
  }
  const { token, projectId } = await obtenerToken(key);
  console.log(`Proyecto: ${projectId}`);

  if (getRelease) {
    const url = `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`;
    const release = await llamarApi(token, 'GET', url);
    console.log('Release actual:', JSON.stringify(release, null, 2));
    if (release.rulesetName) {
      const rulesetUrl = `https://firebaserules.googleapis.com/v1/${release.rulesetName}`;
      const ruleset = await llamarApi(token, 'GET', rulesetUrl);
      console.log('Ruleset actual:', JSON.stringify(ruleset, null, 2));
    }
    process.exit(0);
  }

  if (deployRules) {
    const contenido = fs.readFileSync(deployRules, 'utf8');
    const createUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`;
    const nuevoRuleset = await llamarApi(token, 'POST', createUrl, {
      source: { files: [{ name: 'firestore.rules', content: contenido }] }
    });
    console.log('Ruleset creado:', nuevoRuleset.name);

    const releaseUrl = `https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`;
    const releaseActualizado = await llamarApi(token, 'PATCH', releaseUrl, {
      release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: nuevoRuleset.name },
      updateMask: 'rulesetName'
    });
    console.log('Release actualizado:', JSON.stringify(releaseActualizado, null, 2));
    process.exit(0);
  }

  console.error('Nada que hacer: usa --get-release o --deploy-rules <archivo>');
  process.exit(1);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
