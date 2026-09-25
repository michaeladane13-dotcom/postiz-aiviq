import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAYA_FACEBOOK_PAGE_ID,
  CHAYA_INSTAGRAM_ACCOUNT_ID,
  CHAYA_YES_THANK_YOU,
  PrivateReplyRateLimiter,
  buildChayaPrivateSalesReply,
  buildChayaSalesPublicReply,
  buildMetaPrivateReplyRequest,
  isChayaSalesAccount,
  isChayaSalesTrigger,
  isWithinStandardMessagingWindow,
  isYesOptIn,
} from '../src/sales-private-replies.js';

test('sales replies are locked to Chaya Facebook and Instagram', () => {
  assert.equal(isChayaSalesAccount({ persona: 'chaya', platform: 'facebook', metaAccountId: CHAYA_FACEBOOK_PAGE_ID }), true);
  assert.equal(isChayaSalesAccount({ persona: 'chaya', platform: 'instagram', metaAccountId: CHAYA_INSTAGRAM_ACCOUNT_ID }), true);
  assert.equal(isChayaSalesAccount({ persona: 'ren', platform: 'facebook', metaAccountId: CHAYA_FACEBOOK_PAGE_ID }), false);
  assert.equal(isChayaSalesAccount({ persona: 'chaya', platform: 'facebook', metaAccountId: 'wrong' }), false);
});

test('required keywords and reading questions trigger the private offer', () => {
  for (const comment of [
    'READ',
    'I am ready 💜',
    'YES please',
    'Can you help me?',
    'Could I have a reading?',
    'How can I book a reading',
    'Will you read for someone in Canada?',
  ]) {
    assert.equal(isChayaSalesTrigger(comment), true, comment);
  }
  for (const comment of ['Beautiful message', 'Already booked', 'I loved this']) {
    assert.equal(isChayaSalesTrigger(comment), false, comment);
  }
});

test('the three approved private openings rotate deterministically', () => {
  const replies = Array.from({ length: 30 }, (_, index) => buildChayaPrivateSalesReply(`comment-${index}`));
  assert.deepEqual(new Set(replies.map((reply) => reply.openingVariant)), new Set([1, 2, 3]));
  for (const reply of replies) {
    assert.match(reply.message, /CA\$39/);
    assert.match(reply.message, /promo=REELS33/);
    assert.match(reply.message, /reply YES\.$/);
    assert.doesNotMatch(reply.message, /\u2014|\bAI\b|automation|\bfluff\b/i);
  }
});

test('public acknowledgements never contain a price or sales link', () => {
  for (let index = 0; index < 20; index += 1) {
    const reply = buildChayaSalesPublicReply(`comment-${index}`);
    assert.match(reply, /private message/i);
    assert.doesNotMatch(reply, /\$|CA\$|https?:|REELS33|price/i);
    assert.doesNotMatch(reply, /\u2014|\bAI\b|automation|\bfluff\b/i);
  }
});

test('Facebook and Instagram use their required private-reply transports', () => {
  assert.deepEqual(buildMetaPrivateReplyRequest({
    platform: 'facebook', commentId: 'fb-comment', message: 'Private message',
  }), {
    path: 'fb-comment/private_replies',
    form: { message: 'Private message' },
  });
  assert.deepEqual(buildMetaPrivateReplyRequest({
    platform: 'instagram', commentId: 'ig-comment', message: 'Private message',
  }), {
    path: `${CHAYA_FACEBOOK_PAGE_ID}/messages`,
    json: {
      recipient: { comment_id: 'ig-comment' },
      message: { text: 'Private message' },
    },
  });
});

test('YES opt-ins are strict and the thank-you stays one line', () => {
  for (const text of ['YES', 'yes!', ' Yes 💜 ']) assert.equal(isYesOptIn(text), true, text);
  for (const text of ['yes please', 'yesterday', 'I said yes and need help']) {
    assert.equal(isYesOptIn(text), false, text);
  }
  assert.equal(CHAYA_YES_THANK_YOU.includes('\n'), false);
  assert.doesNotMatch(CHAYA_YES_THANK_YOU, /\u2014|\bAI\b|automation|\bfluff\b/i);
});

test('standard follow-up messages are limited to 24 hours', () => {
  const now = Date.UTC(2026, 8, 25, 12);
  assert.equal(isWithinStandardMessagingWindow(now - 23 * 60 * 60 * 1000, now), true);
  assert.equal(isWithinStandardMessagingWindow(now - 25 * 60 * 60 * 1000, now), false);
  assert.equal(isWithinStandardMessagingWindow(now + 10 * 60 * 1000, now), false);
});

test('private replies are conservatively rate limited per account', () => {
  let now = 1_000_000;
  const limiter = new PrivateReplyRateLimiter({ perMinute: 2, perDay: 3, now: () => now });
  assert.equal(limiter.take('chaya-facebook').allowed, true);
  assert.equal(limiter.take('chaya-facebook').allowed, true);
  assert.deepEqual(limiter.take('chaya-facebook'), { allowed: false, reason: 'per_minute' });
  now += 61_000;
  assert.equal(limiter.take('chaya-facebook').allowed, true);
  assert.deepEqual(limiter.take('chaya-facebook'), { allowed: false, reason: 'per_day' });
  assert.equal(limiter.take('chaya-instagram').allowed, true);
});
