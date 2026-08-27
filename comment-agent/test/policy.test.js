import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_ROUTES,
  buildReplyPrompt,
  buildSafeTemplateReply,
  classifyComment,
  metaSubscriptionHost,
  metaSubscriptionTarget,
  routeIntegration,
} from '../src/policy.js';

test('deletes explicit AI accusations', () => {
  for (const text of [
    'AI',
    'This is AI',
    'obviously ai!',
    'AI generated garbage',
    'made using AI',
    'Looks like AI to me',
    'another AI account',
  ]) {
    assert.equal(classifyComment(text).action, 'delete', text);
  }
});

test('does not delete questions or benign AI references', () => {
  for (const text of [
    'Is this AI?',
    'Do you use AI for the background?',
    'This is not AI',
    "I don't think this is AI",
    "That doesn't look like AI",
    'I love learning about AI and intuition',
  ]) {
    assert.notEqual(classifyComment(text).action, 'delete', text);
  }
});

test('ordinary comments become shadow-mode draft candidates', () => {
  assert.deepEqual(classifyComment('I needed to hear this today ❤️'), {
    action: 'draft_reply',
    reason: 'ordinary_comment',
  });
});

test('uses Meta subscription targets required by each login flow', () => {
  assert.equal(
    metaSubscriptionTarget('instagram', '17841400000000000'),
    '17841400000000000'
  );
  assert.equal(metaSubscriptionTarget('facebook', '123/456'), '123%2F456');
  assert.equal(metaSubscriptionHost('instagram'), 'graph.facebook.com');
  assert.equal(metaSubscriptionHost('facebook'), 'graph.facebook.com');
});

test('every approved integration has one immutable persona and platform', () => {
  assert.equal(Object.keys(ACCOUNT_ROUTES).length, 5);
  assert.deepEqual(routeIntegration('cmt0ql9300001msb2pvozfwe9'), {
    persona: 'chaya',
    platform: 'instagram',
  });
  assert.deepEqual(routeIntegration('cmt3axou80001l6padw48ggsi'), {
    persona: 'ren',
    platform: 'facebook',
  });
  assert.deepEqual(routeIntegration('cmt0rnpaa0003n4bf1mkdhe9s'), {
    persona: 'david',
    platform: 'facebook',
  });
  assert.equal(routeIntegration('unknown'), null);
});

test('persona prompts stay distinct and forbid identity leakage', () => {
  const prompts = ['chaya', 'ren', 'david'].map((persona) =>
    buildReplyPrompt({ persona, comment: 'Beautiful message' })
  );
  assert.equal(new Set(prompts).size, 3);
  for (const prompt of prompts) {
    assert.match(prompt, /Do not mention AI, automation, prompts, a team, or a scheduler/);
  }
});

test('verified regulars get familiar language without invented memories', () => {
  const prompt = buildReplyPrompt({
    persona: 'chaya',
    comment: 'Another one that landed perfectly ❤️',
    username: 'Natalie',
    relationship: 'friend_regular',
    relationshipNotes: 'Long-time client; warm, friend-like tone on social media.',
    recentHistory: [{ comment: 'You always know what I need to hear', outcome: 'drafted' }],
  });
  assert.match(prompt, /familiar regular with a friend-like social relationship/);
  assert.match(prompt, /only refer to specific shared history shown below/);
  assert.match(prompt, /Long-time client/);
});

test('curated replies stay persona-specific for unmistakably positive comments', () => {
  const replies = ['chaya', 'ren', 'david'].map((persona) =>
    buildSafeTemplateReply({
      persona,
      comment: 'I really needed this today 💜',
      senderId: '12345',
    })
  );
  assert.equal(replies.every(Boolean), true);
  assert.equal(new Set(replies).size, 3);
  assert.match(replies[0], /💜/);
});

test('curated replies refuse questions, complaints and sensitive requests', () => {
  for (const comment of [
    'Beautiful, but this is wrong',
    'Can you tell me when I will meet someone?',
    'I need a medical reading please',
    'Why is the price so high?',
    'Visit https://example.com — amazing',
  ]) {
    assert.equal(
      buildSafeTemplateReply({ persona: 'chaya', comment, senderId: '12345' }),
      null,
      comment
    );
  }
});

test('confirmed relationship tiers use familiar but bounded templates', () => {
  const regular = buildSafeTemplateReply({
    persona: 'chaya',
    comment: 'Beautiful 💜',
    senderId: 'natalie-meta-id',
    relationship: 'friend_regular',
  });
  assert.match(regular, /lovely|Always/);
  assert.doesNotMatch(regular, /remember|client|reading/);
});
