import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GitHubClientDirectory,
  normalizeSocialAlias,
  parseClientDirectory,
} from '../src/client-directory.js';

const FIXTURE = {
  version: 1,
  updatedAt: '2026-08-29',
  matching: 'exact_normalized_alias',
  profiles: [
    {
      id: 'natalie',
      clientLabel: 'Natalie',
      aliases: ['natalie_87'],
      relationship: 'regular',
      engagement: 'reply',
    },
  ],
};

test('normalizes aliases without fuzzy matching', () => {
  assert.equal(normalizeSocialAlias('  @Natalie_87  '), 'natalie_87');
  assert.equal(normalizeSocialAlias('natalie87'), 'natalie87');
  const directory = parseClientDirectory(FIXTURE);
  assert.equal(directory.aliases.get('natalie_87').clientLabel, 'Natalie');
  assert.equal(directory.aliases.has('natalie87'), false);
});

test('rejects duplicate aliases and private-context fields', () => {
  assert.throws(
    () => parseClientDirectory({
      ...FIXTURE,
      profiles: [FIXTURE.profiles[0], { ...FIXTURE.profiles[0], id: 'duplicate' }],
    }),
    /duplicate client alias/
  );
  assert.throws(
    () => parseClientDirectory({
      ...FIXTURE,
      profiles: [{ ...FIXTURE.profiles[0], privateContext: 'must never be loaded' }],
    }),
    /forbidden fields: privateContext/
  );
  assert.throws(
    () => parseClientDirectory({ ...FIXTURE, privateContext: 'must never be loaded' }),
    /client directory contains forbidden fields: privateContext/
  );
  assert.throws(
    () => parseClientDirectory({
      ...FIXTURE,
      profiles: [{ ...FIXTURE.profiles[0], relationship: 'friend_regular' }],
    }),
    /invalid relationship/
  );
});

test('syncs a private GitHub raw file and reuses its ETag', async () => {
  const requests = [];
  const responses = [
    new Response(JSON.stringify(FIXTURE), { status: 200, headers: { etag: '"abc"' } }),
    new Response(null, { status: 304 }),
  ];
  const directory = new GitHubClientDirectory({
    repository: 'michaeladane13-dotcom/chaya-client-handover',
    path: 'social-public-profiles.json',
    ref: 'main',
    token: 'test-token',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), headers: options.headers });
      return responses.shift();
    },
  });

  const first = await directory.sync();
  assert.equal(first.changed, true);
  assert.equal(directory.match('@NATALIE_87').id, 'natalie');
  assert.equal(directory.status().aliasesLoaded, 1);
  assert.match(requests[0].url, /social-public-profiles\.json\?ref=main$/);
  assert.equal(requests[0].headers.Authorization, 'Bearer test-token');

  const second = await directory.sync();
  assert.equal(second.changed, false);
  assert.equal(requests[1].headers['If-None-Match'], '"abc"');
});

test('retains the last good directory when a later sync fails', async () => {
  let call = 0;
  const directory = new GitHubClientDirectory({
    repository: 'michaeladane13-dotcom/chaya-client-handover',
    path: 'social-public-profiles.json',
    ref: 'main',
    token: 'test-token',
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return new Response(JSON.stringify(FIXTURE), { status: 200 });
      return new Response('unavailable', { status: 503 });
    },
  });

  await directory.sync();
  await assert.rejects(directory.sync(), /GitHub returned HTTP 503/);
  assert.equal(directory.match('natalie_87').id, 'natalie');
  assert.match(directory.status().error, /HTTP 503/);
});
