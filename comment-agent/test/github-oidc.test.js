import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { DAILY_REEL_AUDIENCE, verifyDailyReelOidc } from '../src/github-oidc.js';

test('accepts only a signed token for the precise reel-factory workflow', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const now = Date.now();
  const header = { alg: 'RS256', typ: 'JWT', kid: 'test-key' };
  const claims = {
    iss: 'https://token.actions.githubusercontent.com', aud: DAILY_REEL_AUDIENCE,
    repository: 'michaeladane13-dotcom/reel-factory', ref: 'refs/heads/main',
    workflow_ref: 'michaeladane13-dotcom/reel-factory/.github/workflows/unattended.yml@refs/heads/main',
    event_name: 'schedule', iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300,
    run_id: '12345',
  };
  const sign = (payload) => {
    const input = [header, payload].map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    return `${input}.${crypto.sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ keys: [{ ...jwk, kid: 'test-key' }] }) });
  assert.deepEqual(await verifyDailyReelOidc(`Bearer ${sign(claims)}`, { fetchImpl, now }),
    { runId: '12345', repository: 'michaeladane13-dotcom/reel-factory' });
  await assert.rejects(verifyDailyReelOidc(`Bearer ${sign({ ...claims, ref: 'refs/heads/other' })}`, { fetchImpl, now }));
  await assert.rejects(verifyDailyReelOidc(`Bearer ${sign({ ...claims, aud: 'elsewhere' })}`, { fetchImpl, now }));
  await assert.rejects(verifyDailyReelOidc(`Bearer ${sign({ ...claims, event_name: 'push' })}`, { fetchImpl, now }));
  await assert.rejects(verifyDailyReelOidc(`Bearer ${sign({ ...claims, exp: Math.floor(now / 1000) - 1 })}`, { fetchImpl, now }));
  const signed = sign(claims);
  const start = signed.lastIndexOf('.') + 1;
  const forged = signed.slice(0, start) + (signed[start] === 'A' ? 'B' : 'A') + signed.slice(start + 1);
  await assert.rejects(verifyDailyReelOidc(`Bearer ${forged}`, { fetchImpl, now }));
});
