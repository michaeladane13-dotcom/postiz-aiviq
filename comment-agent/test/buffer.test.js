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

test('validates the three approved Buffer TikTok channels', async () => {
  let call = 0;
  const api = new BufferApi('secret', async () => {
    call += 1;
    return {
      ok: true,
      async json() {
        if (call === 1) return { data: { account: { organizations: [{ id: 'org-1' }] } } };
        return { data: { channels: [
          { id: TIKTOK_CHANNELS.chaya, name: 'chayamedium', service: 'tiktok' },
          { id: TIKTOK_CHANNELS.iris, name: 'iris09852', service: 'tiktok' },
          { id: TIKTOK_CHANNELS.ren, name: 'renlevymclarnon', service: 'tiktok' },
          { id: 'ig-1', name: 'chaya', service: 'instagram' },
        ] } };
      },
    };
  });
  const channels = await api.connectedTikTokChannels();
  assert.deepEqual(channels.map((channel) => channel.id), Object.values(TIKTOK_CHANNELS));
});
