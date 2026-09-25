import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCOUNT_ROUTES,
  buildReplyPrompt,
  buildSafeTemplateReply,
  chayaReels33Decision,
  chayaReels33Post,
  classifyComment,
  metaSubscriptionStrategy,
  routeIntegration,
  sanitizeReplyText,
} from '../src/policy.js';

test('deletes every genuine AI reference without review or reply', () => {
  for (const text of [
    'AI',
    'This is AI',
    'Is this AI?',
    'Do you use AI for the background?',
    'This is not AI',
    "I don't think this is AI",
    "That doesn't look like AI",
    'I love learning about AI and intuition',
    'obviously ai!',
    'AI generated garbage',
    'made using AI',
    'Looks like AI to me',
    'another AI account',
    'A.I.',
    'A I generated',
    'A-I slop',
    'Artificial intelligence made this',
    'OpenAI made this',
    'ChatGPT wrote this',
    'Looks GPT-5 generated',
    'This is Midjourney',
    'Made with DALL-E',
    'Stable Diffusion again',
    'This is a deepfake',
    '🤖',
  ]) {
    assert.deepEqual(classifyComment(text), { action: 'delete', reason: 'ai_reference' }, text);
  }
});

test('does not mistake AI letters inside ordinary words for an AI reference', () => {
  for (const text of [
    'She said this beautifully',
    'Watching this again',
    'Still waiting for part two',
    'Kai always explains this well',
    'Aisha sent me here',
    'Rainn, this was lovely',
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

test('uses app-level Instagram webhooks and account-level Facebook subscriptions', () => {
  assert.deepEqual(metaSubscriptionStrategy('instagram', '17841400000000000'), {
    mode: 'app_level',
    fields: ['comments'],
  });
  assert.deepEqual(metaSubscriptionStrategy('facebook', '123/456'), {
    mode: 'account_level',
    fields: ['feed'],
    host: 'graph.facebook.com',
    target: '123%2F456',
  });
  assert.deepEqual(metaSubscriptionStrategy('facebook', '123/456', { includeMessaging: true }), {
    mode: 'account_level',
    fields: ['feed', 'messages', 'messaging_optins'],
    host: 'graph.facebook.com',
    target: '123%2F456',
  });
  assert.throws(
    () => metaSubscriptionStrategy('tiktok', 'not-meta'),
    /Unsupported Meta subscription platform/
  );
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

test('live routing is limited to Chaya, Ren and Facebook-only David', () => {
  const platformsByPersona = Object.values(ACCOUNT_ROUTES).reduce((result, route) => {
    result[route.persona] ||= [];
    result[route.persona].push(route.platform);
    return result;
  }, {});

  for (const platforms of Object.values(platformsByPersona)) platforms.sort();
  assert.deepEqual(platformsByPersona, {
    chaya: ['facebook', 'instagram'],
    ren: ['facebook', 'instagram'],
    david: ['facebook'],
  });
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

test('brief neutral-positive reactions receive a safe persona reply', () => {
  const reply = buildSafeTemplateReply({
    persona: 'david',
    comment: 'Interesting',
    senderId: '28900221122917895',
  });

  assert.match(reply, /Thank you|I appreciate|glad/i);
  assert.doesNotMatch(reply, /\u2014/);
});

test('lottery questions get a humorous refusal without promising numbers or a win', () => {
  const replies = ['chaya', 'ren', 'david'].map((persona) =>
    buildSafeTemplateReply({
      persona,
      comment: 'Can I be told if I would win the lottery?!!! Please 🙏🏽',
      senderId: 'lottery-question',
    })
  );

  assert.equal(replies.every(Boolean), true);
  assert.match(replies[0], /energy of your reading/i);
  for (const reply of replies) {
    assert.match(reply, /don’t give out lottery numbers/i);
    assert.match(reply, /we’d be rich/i);
    assert.doesNotMatch(reply, /\u2014/);
  }
});

test('lottery humour stays blocked when the comment contains sensitive context or a link', () => {
  for (const comment of [
    'My daughter died, will I win the lottery?',
    'Win the lottery at https://example.com',
  ]) {
    assert.equal(
      buildSafeTemplateReply({ persona: 'chaya', comment, senderId: 'unsafe-lottery' }),
      null,
      comment
    );
  }
});

test('all reply text is forced to remain free of em dashes', () => {
  assert.equal(sanitizeReplyText('Warm — natural – concise'), 'Warm, natural, concise');

  for (const persona of ['chaya', 'ren', 'david']) {
    for (const relationship of ['new_follower', 'regular', 'friend_regular']) {
      const reply = buildSafeTemplateReply({
        persona,
        comment: 'Beautiful, thank you 💜',
        senderId: `${persona}:${relationship}`,
        relationship,
      });
      assert.doesNotMatch(reply, /\u2014/);
    }
  }
});

const reels33Posts = [
  'A lot of people ask what actually happens once they book, so here it is. Use code REELS33.',
  'The question you ask shapes the reading you get. Comment QUESTION and use REELS33.',
  'Nearly every message I get starts with sorry. Use REELS33.',
  "I'm a fourth generation psychic and medium, and the first thing I was taught was how to listen. REELS33",
  'If you could ask me one thing and have it answered in writing, what would it be? REELS33',
];

test('only the five approved Chaya captions activate promotion rules', () => {
  assert.deepEqual(reels33Posts.map(chayaReels33Post), [1, 2, 3, 4, 5]);
  assert.equal(chayaReels33Post('A generic reel with REELS33'), 0);
  assert.equal(chayaReels33Post('The question you ask shapes the reading you get.'), 0);
  assert.equal(chayaReels33Decision({
    persona: 'ren', postText: reels33Posts[1], comment: 'QUESTION',
  }), null);
});

test('QUESTION gets the promised public list on reel two only', () => {
  const decision = chayaReels33Decision({
    persona: 'chaya', postText: reels33Posts[1], comment: 'QUESTION!',
  });
  assert.equal(decision.action, 'reply');
  assert.equal(decision.reason, 'question_list');
  assert.match(decision.text, /What do I need to understand/);
  assert.doesNotMatch(decision.text, /DM|sent you|private/);
  assert.equal(chayaReels33Decision({
    persona: 'chaya', postText: reels33Posts[0], comment: 'QUESTION!',
  }), null);
});

test('simple booking questions get the code and bio link, not invented terms', () => {
  for (const postText of reels33Posts) {
    const decision = chayaReels33Decision({ persona: 'chaya', postText, comment: 'How do I book?' });
    assert.equal(decision.action, 'reply');
    assert.match(decision.text, /link in my bio.*REELS33/);
    assert.doesNotMatch(decision.text, /%|expires|free/);
  }
});

test('personal questions and discount problems stay in human review', () => {
  for (const comment of ['Will my ex come back?', 'Can you read for my late mother?', 'What percentage is the code?', "REELS33 doesn't work", 'I paid and never received it']) {
    const decision = chayaReels33Decision({
      persona: 'chaya', postText: reels33Posts[0], comment,
    });
    assert.equal(decision.action, 'review', comment);
  }
  assert.deepEqual(chayaReels33Decision({
    persona: 'chaya', postText: reels33Posts[4], comment: 'My question is, will I get the job?',
  }), { action: 'review', reason: 'one_question_selection' });
});
