import assert from 'node:assert/strict';
import test from 'node:test';
import { DAILY_REEL_ROUTES, DailyReelPublisher, captionFor, publicFacebookReelMatches, selectTodayAssets, vancouverDay } from '../src/daily-reels.js';

test('daily routes never include the personal Facebook integration', () => {
  const ids = Object.values(DAILY_REEL_ROUTES).flatMap((routes) => Object.values(routes));
  assert.equal(ids.includes('cmuhnbkiw0001mtddcb6vugex'), false);
  assert.equal(DAILY_REEL_ROUTES.david.instagram, undefined);
  assert.equal(DAILY_REEL_ROUTES.chaya.facebook, 'cmt1vavvs0007myc1cbsep0dd');
});

test('today selection excludes old and unapproved assets', () => {
  const base = {
    state: 'READY', brand: 'chaya', content_sha256: 'a'.repeat(64),
    asset_locator: 'github-release:media-123-1/2026-09-30-chaya-aaaaaaaaaaaa.mp4',
    recorded_at: '2026-09-30T16:00:00Z',
  };
  const selected = selectTodayAssets([
    base,
    { ...base, recorded_at: '2026-09-30T17:00:00Z', content_sha256: 'b'.repeat(64) },
    { ...base, asset_locator: 'github-release:media-122-1/2026-09-29-chaya-aaaaaaaaaaaa.mp4' },
    { ...base, brand: 'michaela' },
  ], '2026-09-30');
  assert.equal(selected.length, 1);
  assert.equal(selected[0].content_sha256, 'b'.repeat(64));
});

test('Vancouver day and caption are deterministic and branded', () => {
  assert.equal(vancouverDay(new Date('2026-10-01T03:00:00Z')), '2026-09-30');
  assert.equal(captionFor('ren', { brand: 'ren', state: 'DRAFT', caption: 'Listen  carefully.' }),
    'Listen carefully.\n\nExplore the link on this page. Use code REELS33 at checkout.');
  assert.throws(() => captionFor('ren', { brand: 'chaya', state: 'DRAFT', caption: 'No' }));
});

test('public Facebook verification requires the exact Page, video and caption', () => {
  const caption = "It wasn't anxiety. Use code REELS33 at checkout.";
  const html = '<meta property="og:title" content="It wasn&#039;t anxiety. Use code REELS33 at checkout. | Chayathemedium" />' +
    '<meta property="og:url" content="https://www.facebook.com/61558711176843/videos/it-wasnt-anxiety/1652851206851749/" />';
  assert.equal(publicFacebookReelMatches(html, '1652851206851749', '61558711176843', caption), true);
  assert.equal(publicFacebookReelMatches(html, '1652851206851750', '61558711176843', caption), false);
  assert.equal(publicFacebookReelMatches(html, '1652851206851749', '61558711176844', caption), false);
  assert.equal(publicFacebookReelMatches(html, '1652851206851749', '61558711176843', 'Different caption'), false);
});

test('public Facebook probe is read-only and refuses unrelated pages', async () => {
  const caption = 'A quiet sign. Use code REELS33 at checkout.';
  const html = '<meta property="og:title" content="A quiet sign. Use code REELS33 at checkout. | Chayathemedium" />' +
    '<meta property="og:url" content="https://www.facebook.com/61558711176843/videos/quiet-sign/1652851206851749/" />';
  const calls = [];
  const publisher = new DailyReelPublisher({ pool: null, token: '', fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: true, url, headers: new Headers({ 'content-type': 'text/html' }), text: async () => html };
  } });
  assert.equal(await publisher.publicFacebookReel('1652851206851749', { accountId: '61558711176843' }, caption), true);
  assert.equal(await publisher.publicFacebookReel('1652851206851749', { accountId: '999' }, caption), false);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.method === undefined && !call.url.includes('access_token')));
});

test('Meta upload errors preserve a bounded message without printing tokens', async () => {
  const publisher = new DailyReelPublisher({ pool: null, token: '', fetchImpl: async () =>
    new Response(JSON.stringify({ error: 'Video upload was rejected' }), { status: 400 }) });
  await assert.rejects(
    () => publisher.upload('https://rupload.facebook.com/ig-api-upload/v26.0/123', 'secret', Buffer.from('x')),
    /Meta binary upload: Video upload was rejected \(400\)/,
  );
});

test('reservation permits one upload-stage retry but guards published media', async () => {
  const queries = [];
  const publisher = new DailyReelPublisher({
    pool: { query: async (sql) => {
      queries.push(sql);
      return { rows: queries.length === 1 ? [] : [{ status: 'reserved' }] };
    } },
    token: '',
  });
  const reserved = await publisher.reserve({ asset_id: 'asset', brand: 'chaya', content_sha256: 'a'.repeat(64) },
    'instagram', DAILY_REEL_ROUTES.chaya.instagram, 'caption', '2026-10-02');
  assert.equal(reserved, true);
  assert.match(queries[1], /error LIKE 'Meta binary upload:%'/);
  assert.match(queries[1], /"uploadRetryCount" < 1/);
  assert.match(queries[1], /"mediaId" IS NULL/);
});
