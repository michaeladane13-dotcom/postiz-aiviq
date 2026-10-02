import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GitHubClientData,
  parseClientData,
  privateClientContext,
} from '../src/client-data.js';

const RECORDS = [
  {
    id: 'ops-1',
    first_name: 'Natalie',
    full_name: 'Natalie Example',
    dob: '1990-01-02',
    dob_text: '2 January 1990',
    emails: 'natalie@example.test',
    etsy_handles: 'Natalie_87',
    etsy_buyer_ids: 'buyer-1',
    etsy_conversation_ids: 'conversation-1',
    socials: '',
    brands: 'chaya | ren',
    orders_count: 3,
    lifetime_spend: '120.00',
    first_order_at: '2025-01-01',
    last_order_at: '2026-09-01',
    last_order_type: 'written reading',
    package_status: '',
    current_situation: 'A dated private situation.',
    situation_updated_at: '2026-09-01',
    standing_instructions: '',
    people: 'A person previously mentioned.',
  },
  {
    id: 'ops-2',
    first_name: '',
    full_name: '',
    etsy_handles: 'handle_is_not_a_name',
    socials: 'instagram: exact_social',
    brands: 'chaya',
    orders_count: 1,
    standing_instructions: 'Human only. No offers.',
  },
];

test('matches only exact social and Etsy identifiers without treating a handle as a name', () => {
  const data = parseClientData(RECORDS);
  assert.equal(data.etsyAliases.get('natalie_87').firstName, 'Natalie');
  assert.equal(data.etsyAliases.has('natalie87'), false);
  assert.equal(data.socialAliases.get('exact_social').id, 'ops-2');
  assert.equal(data.etsyAliases.get('handle_is_not_a_name').firstName, '');
});

test('turns explicit client rules into hard engagement and sales controls', () => {
  const data = parseClientData(RECORDS);
  const profile = data.socialAliases.get('exact_social');
  assert.equal(profile.engagement, 'manual_review');
  assert.equal(profile.noSales, true);
  const context = privateClientContext(profile, 'Hello');
  assert.match(context, /Do not sell or offer anything/);
  assert.doesNotMatch(context, /handle_is_not_a_name/);
});

test('keeps private context out of public identity matching and only includes birth data when raised', () => {
  const data = parseClientData(RECORDS);
  const profile = data.etsyAliases.get('natalie_87');
  const ordinary = privateClientContext(profile, 'I want a love reading');
  assert.match(ordinary, /A dated private situation/);
  assert.doesNotMatch(ordinary, /1990-01-02|2 January 1990/);
  assert.doesNotMatch(ordinary, /natalie@example\.test|buyer-1|conversation-1|120\.00/);
  assert.match(privateClientContext(profile, 'Can you check my date of birth?'), /1990-01-02/);
});

test('reads README before the private export, reports safe counts, and reuses ETags', async () => {
  const requests = [];
  const first = new Map([
    ['README.md', new Response('# Private\nRead-only export.', { headers: { etag: '"readme"' } })],
    ['README.txt', new Response('Chaya Ops client database export, 2026-10-02 18:50 UTC. 2 clients.', { headers: { etag: '"meta"' } })],
    ['clients.json', new Response(JSON.stringify(RECORDS), { headers: { etag: '"data"' } })],
  ]);
  let initial = true;
  const clientData = new GitHubClientData({
    repository: 'owner/chaya-client-data',
    token: 'secret',
    fetchImpl: async (input, options) => {
      const path = decodeURIComponent(new URL(input).pathname.split('/contents/')[1]);
      requests.push({ path, headers: options.headers });
      if (initial) return first.get(path);
      return new Response(null, { status: 304 });
    },
  });

  await clientData.sync();
  assert.deepEqual(requests.map((request) => request.path), ['README.md', 'README.txt', 'clients.json']);
  assert.equal(clientData.matchSocial({ username: '@NATALIE_87' }).id, 'ops-1');
  assert.deepEqual(clientData.status(), {
    configured: true,
    loaded: true,
    recordsLoaded: 2,
    matchableProfiles: 2,
    exactAliasesLoaded: 3,
    ambiguousAliases: 0,
    refreshHours: 3,
    lastCheckedAt: clientData.status().lastCheckedAt,
    lastSuccessfulSyncAt: clientData.status().lastSuccessfulSyncAt,
    sourceExportedAt: '2026-10-02 18:50 UTC',
    readmeVerified: true,
    error: null,
  });

  initial = false;
  await clientData.sync();
  assert.equal(requests[3].headers['If-None-Match'], '"readme"');
  assert.equal(clientData.matchSocial({ username: 'natalie_87' }).id, 'ops-1');
});

