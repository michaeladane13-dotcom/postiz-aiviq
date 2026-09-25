import assert from 'node:assert/strict';
import test from 'node:test';
import { extractMetaEvents } from '../src/meta-events.js';

test('extracts Facebook comment and inbound YES message events', () => {
  const comment = extractMetaEvents({
    object: 'page',
    entry: [{
      id: '319309021256227',
      changes: [{ field: 'feed', value: {
        item: 'comment', verb: 'add', comment_id: 'comment-1', message: 'READ',
        sender_id: 'psid-1', sender_name: 'Reader', post_id: 'post-1', created_time: 1_800_000_000,
      } }],
    }],
  });
  assert.equal(comment[0].kind, 'comment');
  assert.equal(comment[0].commentId, 'comment-1');

  const message = extractMetaEvents({
    object: 'page',
    entry: [{
      id: '319309021256227',
      messaging: [{
        sender: { id: 'psid-1' }, recipient: { id: '319309021256227' }, timestamp: 1_800_000_000_000,
        message: { mid: 'mid-1', text: 'YES' },
      }],
    }],
  });
  assert.deepEqual(message.map(({ raw, ...event }) => event), [{
    kind: 'message', platform: 'facebook', metaAccountId: '319309021256227',
    messageId: 'mid-1', text: 'YES', senderId: 'psid-1', recipientId: '319309021256227',
    timestamp: 1_800_000_000_000,
  }]);
});

test('extracts Instagram messages and Meta marketing opt-in tokens', () => {
  const events = extractMetaEvents({
    object: 'instagram',
    entry: [{
      id: '17841466326798701',
      messaging: [
        {
          sender: { id: 'igsid-1' }, recipient: { id: '17841466326798701' }, timestamp: 1_800_000_000_000,
          message: { mid: 'ig-mid-1', text: 'YES' },
        },
        {
          sender: { id: 'igsid-1' }, recipient: { id: '17841466326798701' }, timestamp: 1_800_000_000_100,
          optin: { notification_messages_token: 'meta-token-1' },
        },
      ],
    }],
  });
  assert.deepEqual(events.map((event) => event.kind), ['message', 'marketing_optin']);
  assert.equal(events[1].marketingToken, 'meta-token-1');
});

test('ignores outbound message echoes and malformed events', () => {
  const events = extractMetaEvents({
    object: 'page',
    entry: [{
      id: '319309021256227',
      messaging: [{ sender: { id: 'page' }, message: { mid: 'echo', text: 'Thanks', is_echo: true } }],
    }],
  });
  assert.deepEqual(events, []);
});
