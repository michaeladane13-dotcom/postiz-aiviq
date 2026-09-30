import crypto from 'node:crypto';

export const DAILY_REEL_AUDIENCE =
  'https://meta-comment-agent-production.up.railway.app/internal/daily-reel';
const ISSUER = 'https://token.actions.githubusercontent.com';
const WORKFLOW_REF =
  'michaeladane13-dotcom/reel-factory/.github/workflows/unattended.yml@refs/heads/main';
const JWKS_URL = 'https://token.actions.githubusercontent.com/.well-known/jwks';

let cachedKeys = null;
let cachedUntil = 0;

function decodePart(encoded) {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
}

export async function verifyDailyReelOidc(authorization, { fetchImpl = fetch, now = Date.now() } = {}) {
  const token = /^Bearer ([A-Za-z0-9._-]+)$/.exec(String(authorization || ''))?.[1];
  if (!token) throw new Error('Missing GitHub Actions identity');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed GitHub Actions identity');
  const [header, claims] = parts.slice(0, 2).map(decodePart);
  if (header.alg !== 'RS256' || !header.kid || claims.iss !== ISSUER ||
      claims.aud !== DAILY_REEL_AUDIENCE ||
      claims.repository !== 'michaeladane13-dotcom/reel-factory' ||
      claims.ref !== 'refs/heads/main' || claims.workflow_ref !== WORKFLOW_REF ||
      !['schedule', 'workflow_dispatch'].includes(claims.event_name) ||
      !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      claims.iat > now / 1000 + 30 || claims.exp < now / 1000 ||
      claims.exp - claims.iat > 600) {
    throw new Error('GitHub Actions identity claims do not match the approved workflow');
  }
  if (!cachedKeys || cachedUntil < now) {
    const response = await fetchImpl(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('GitHub signing keys are unavailable');
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new Error('Invalid GitHub signing key set');
    cachedKeys = body.keys;
    cachedUntil = now + 60 * 60 * 1000;
  }
  const jwk = cachedKeys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error('Unknown GitHub signing key');
  const valid = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!valid) throw new Error('Invalid GitHub Actions identity signature');
  return { runId: String(claims.run_id || ''), repository: claims.repository };
}
