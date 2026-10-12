import assert from 'node:assert/strict';
import test from 'node:test';
import {
  asksWhereChayaCardLink,
  buildChayaCardReadingFollowUp,
  chayaCardKeyword,
  conversationHasChayaCardBotMessage,
  isChayaCardBotMessage,
  isChayaCardKeywordComment,
  validateChayaCardFollowUpReply,
} from '../src/chaya-card-handoff.js';

test('matches only the five whole-word card keywords', () => {
  for (const keyword of ['moon', 'TOWER', 'Death', 'devil', 'SWORDS']) {
    assert.equal(chayaCardKeyword(`Please send ${keyword}!`), keyword.toUpperCase());
  }
  assert.equal(chayaCardKeyword('moonlight'), null);
  assert.equal(chayaCardKeyword('swordsmith'), null);
  assert.equal(chayaCardKeyword('ready'), null);
});

test('delegates card keywords only on Chaya Facebook and Instagram', () => {
  const event = { kind: 'comment', text: 'MOON please' };
  assert.equal(isChayaCardKeywordComment(event, { persona: 'chaya', platform: 'facebook' }), true);
  assert.equal(isChayaCardKeywordComment(event, { persona: 'chaya', platform: 'instagram' }), true);
  assert.equal(isChayaCardKeywordComment(event, { persona: 'ren', platform: 'facebook' }), false);
});

test('recognizes only an outbound Chaya card marker from the brand account', () => {
  const messages = [
    { from: { id: 'customer' }, message: 'Chaya here.\n\nPretending' },
    { from: { id: 'page' }, message: 'Chaya here.\n\nYour Moon card note' },
  ];
  assert.equal(isChayaCardBotMessage(messages[1].message), true);
  assert.equal(conversationHasChayaCardBotMessage(messages, ['page']), true);
  assert.equal(conversationHasChayaCardBotMessage(messages, ['other']), false);
});

test('card follow-ups do not repeat the link unless it is requested', () => {
  const reply = buildChayaCardReadingFollowUp('Can you tell me if he is coming back?');
  assert.match(reply, /reading/i);
  assert.doesNotMatch(reply, /https?:\/\/|chayathemedium\.org/i);
  assert.equal(validateChayaCardFollowUpReply(reply), reply);
  assert.equal(validateChayaCardFollowUpReply('Go to https://chayathemedium.org'), null);

  assert.equal(asksWhereChayaCardLink('Where is the link?'), true);
  const linkReply = buildChayaCardReadingFollowUp('Where is the link?');
  assert.match(linkReply, /chayathemedium\.org/);
  assert.equal(validateChayaCardFollowUpReply(linkReply, { linkRequested: true }), linkReply);
});
