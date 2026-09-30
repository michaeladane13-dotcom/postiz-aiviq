import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PrivateReplyRateLimiter,
  SALES_INTEGRATION_IDS,
  buildMetaPrivateReplyRequest,
  buildPrivateSalesReply,
  buildSalesOptInThankYou,
  buildSalesPublicReply,
  isSalesAccount,
  isSalesEligibleRelationship,
  isSalesTrigger,
  isWithinStandardMessagingWindow,
  isYesOptIn,
} from '../src/sales-private-replies.js';

const SALES_ACCOUNTS = Object.freeze([
  { integrationId: 'cmt0ql9300001msb2pvozfwe9', persona: 'chaya', platform: 'instagram' },
  { integrationId: 'cmt1vavvs0007myc1cbsep0dd', persona: 'chaya', platform: 'facebook' },
  { integrationId: 'cmt0qnn4j0005msb2y947wjgo', persona: 'ren', platform: 'instagram' },
  { integrationId: 'cmt3axou80001l6padw48ggsi', persona: 'ren', platform: 'facebook' },
  { integrationId: 'cmt0qpsu7000bmsb2oga61nh4', persona: 'nadja', platform: 'instagram' },
  { integrationId: 'cmt0rnpaa0003n4bf1mkdhe9s', persona: 'david', platform: 'facebook' },
]);

test('sales replies are locked to the six approved brand integrations', () => {
  assert.equal(SALES_INTEGRATION_IDS.length, 6);
  for (const account of SALES_ACCOUNTS) assert.equal(isSalesAccount(account), true);
  assert.equal(isSalesAccount({
    integrationId: 'cmt0rnpaa0003n4bf1mkdhe9s', persona: 'david', platform: 'instagram',
  }), false);
  assert.equal(isSalesAccount({
    integrationId: 'cmt0qpsu7000bmsb2oga61nh4', persona: 'nadja', platform: 'facebook',
  }), false);
  assert.equal(isSalesAccount({
    integrationId: 'cmt1vavvs0007myc1cbsep0dd', persona: 'ren', platform: 'facebook',
  }), false);
  assert.equal(isSalesAccount({
    integrationId: 'not-approved', persona: 'chaya', platform: 'facebook',
  }), false);
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
    assert.equal(isSalesTrigger(comment), true, comment);
  }
  for (const comment of ['Beautiful message', 'Already booked', 'I loved this']) {
    assert.equal(isSalesTrigger(comment), false, comment);
  }
});

test('known regulars stay on the normal relationship-aware reply path', () => {
  assert.equal(isSalesEligibleRelationship('new_follower'), true);
  assert.equal(isSalesEligibleRelationship('regular'), false);
  assert.equal(isSalesEligibleRelationship('friend_regular'), false);
});

test('every brand rotates three private openings and uses its own destination', () => {
  const destinations = Object.freeze({
    chaya: 'chayathemedium.org',
    ren: 'renlevyreadings.com/readings',
    nadja: 'nadjaromawitch.store/spell-casting/',
    david: 'davidthemystic.ca/offer',
  });
  for (const [persona, destination] of Object.entries(destinations)) {
    const replies = Array.from(
      { length: 30 },
      (_, index) => buildPrivateSalesReply(persona, `comment-${index}`)
    );
    assert.deepEqual(new Set(replies.map((reply) => reply.openingVariant)), new Set([1, 2, 3]));
    for (const reply of replies) {
      assert.match(reply.message, new RegExp(destination.replaceAll('.', '\\.')));
      assert.match(reply.message, /reply YES\.$/);
      assert.doesNotMatch(reply.message, /\u2014|\bAI\b|automation|\bfluff\b/i);
    }
  }
});

test('Chaya keeps the approved new-client offer in private only', () => {
  const reply = buildPrivateSalesReply('chaya', 'chaya-comment');
  assert.match(reply.message, /CA\$39/);
  assert.match(reply.message, /promo=REELS33/);
});

test('public acknowledgements never contain a price or sales link', () => {
  for (const persona of ['chaya', 'ren', 'nadja', 'david']) {
    for (let index = 0; index < 20; index += 1) {
      const reply = buildSalesPublicReply(persona, `comment-${index}`);
      assert.match(reply, /private/i);
      assert.doesNotMatch(reply, /\$|CA\$|https?:|REELS33|price/i);
      assert.doesNotMatch(reply, /\u2014|\bAI\b|automation|\bfluff\b/i);
    }
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
    platform: 'instagram',
    commentId: 'ig-comment',
    message: 'Private message',
    messagingEndpointId: 'brand-page-id',
  }), {
    path: 'brand-page-id/messages',
    json: {
      recipient: { comment_id: 'ig-comment' },
      message: { text: 'Private message' },
    },
  });
  assert.throws(
    () => buildMetaPrivateReplyRequest({
      platform: 'instagram', commentId: 'ig-comment', message: 'Private message',
    }),
    /messaging endpoint is not resolved/i
  );
});

test('YES opt-ins are strict and each thank-you stays safe and one line', () => {
  for (const text of ['YES', 'yes!', ' Yes 💜 ']) assert.equal(isYesOptIn(text), true, text);
  for (const text of ['yes please', 'yesterday', 'I said yes and need help']) {
    assert.equal(isYesOptIn(text), false, text);
  }
  for (const persona of ['chaya', 'ren', 'nadja', 'david']) {
    const thankYou = buildSalesOptInThankYou(persona);
    assert.equal(thankYou.includes('\n'), false);
    assert.doesNotMatch(thankYou, /\u2014|\bAI\b|automation|\bfluff\b/i);
  }
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
  assert.equal(limiter.take('ren-instagram').allowed, true);
});
