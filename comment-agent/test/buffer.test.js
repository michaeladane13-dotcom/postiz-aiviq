import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferApi, TIKTOK_CHANNELS, validateTikTokSchedule } from '../src/buffer.js';

test('validates and routes known TikTok brands', () => {
  const schedule = validateTikTokSchedule({
    brand: 'Chaya',
    caption: 'Trust the signs.',
    mediaUrl: 'https://media.example/chaya.mp4',
    dueAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(schedule.channelId, TIKTOK_CHANNELS.chaya);
  assert.equal(schedule.brand, 'chaya');
});

test('rejects unknown brands and non-HTTPS media', () => {
  const dueAt = new Date(Date.now() + 60_000).toISOString();
  assert.throws(() => validateTikTokSchedule({ brand: 'david', mediaUrl: 'https://x/a.mp4', dueAt }), /Unknown/);
  assert.throws(() => validateTikTokSchedule({ brand: 'ren', mediaUrl: 'http://x/a.mp4', dueAt }), /HTTPS/);
});

test('creates an automatic custom-scheduled video post', async () => {
  let request;
  const api = new BufferApi('secret', async (_url, options) => {
    request = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { data: { createPost: { __typename: 'PostActionSuccess', post: {
          id: 'post-1', status: 'scheduled', channelId: TIKTOK_CHANNELS.ren,
        } } } };
      },
    };
  });
  const post = await api.scheduleTikTok({
    brand: 'ren',
    caption: 'Caption',
    mediaUrl: 'https://media.example/ren.mp4',
    dueAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal(post.id, 'post-1');
  assert.equal(request.variables.input.mode, 'customScheduled');
  assert.equal(request.variables.input.schedulingType, 'automatic');
  assert.equal(request.variables.input.assets[0].video.url, 'https://media.example/ren.mp4');
});
