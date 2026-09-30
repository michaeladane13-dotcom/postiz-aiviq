import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BufferApi,
  TIKTOK_CHANNELS,
  parseBufferRateLimits,
  validateTikTokSchedule,
} from '../src/buffer.js';

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
  let request;
  let calls = 0;
  const api = new BufferApi('secret', async (_url, options) => {
    calls += 1;
    request = JSON.parse(options.body);
    return {
      ok: true,
      async json() {
        return { data: {
          chaya: { id: TIKTOK_CHANNELS.chaya, name: 'chayamedium', service: 'tiktok', isDisconnected: false, isLocked: false },
          iris: { id: TIKTOK_CHANNELS.iris, name: 'iris09852', service: 'tiktok', isDisconnected: false, isLocked: false },
          ren: { id: TIKTOK_CHANNELS.ren, name: 'renlevymclarnon', service: 'tiktok', isDisconnected: false, isLocked: false },
        } };
      },
    };
  });
  const channels = await api.connectedTikTokChannels();
  assert.deepEqual(channels.map((channel) => channel.id), Object.values(TIKTOK_CHANNELS));
  assert.equal(calls, 1);
  assert.deepEqual(request.variables, TIKTOK_CHANNELS);
  assert.match(request.query, /chaya: channel/);
});

test('parses Buffer quota windows and preserves Retry-After on a 429', async () => {
  const limits = parseBufferRateLimits(
    '"100-in-15min";r=12;t=500, "250-in-1day";r=0;t=7200'
  );
  assert.equal(limits.minimumRemaining, 0);
  assert.equal(limits.windows[1].resetsInSeconds, 7200);

  const api = new BufferApi('secret', async () => new Response(JSON.stringify({
    errors: [{
      message: 'Too many requests from this client. Please try again later.',
      extensions: { code: 'RATE_LIMIT_EXCEEDED', window: '24h' },
    }],
  }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      'retry-after': '7200',
      ratelimit: '"250-in-1day";r=0;t=7200',
    },
  }));
  await assert.rejects(
    api.connectedTikTokChannels(),
    (error) => error.status === 429 && error.retryAfterSeconds === 7200 && error.rateLimitWindow === '24h'
  );
  assert.equal(api.rateLimitStatus().minimumRemaining, 0);
});
