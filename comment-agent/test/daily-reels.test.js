import assert from 'node:assert/strict';
import test from 'node:test';
import { DAILY_REEL_ROUTES, captionFor, selectTodayAssets, vancouverDay } from '../src/daily-reels.js';

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
