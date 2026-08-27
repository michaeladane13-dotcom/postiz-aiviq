import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_ROUTES,
  buildReplyPrompt,
  classifyComment,
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
  assert.equal(metaSubscriptionTarget('instagram', '17841400000000000'), 'me');
  assert.equal(metaSubscriptionTarget('facebook', '123/456'), '123%2F456');
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
