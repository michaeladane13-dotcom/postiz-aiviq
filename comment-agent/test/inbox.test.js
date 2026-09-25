import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInboxReplyPrompt,
  buildSafeInboxTemplateReply,
  classifyInboxMessage,
  isApprovedInboxAccount,
  validateInboxReply,
} from '../src/inbox.js';

test('locks inbox handling to the six exact Chaya, Ren, Nadja and David integrations', () => {
  assert.equal(isApprovedInboxAccount({ integrationId: 'cmt0qpsu7000bmsb2oga61nh4' }), true);
  assert.equal(isApprovedInboxAccount({ integrationId: 'cmt3axpg50003l6pa5i2lf62b' }), false);
  assert.equal(isApprovedInboxAccount({ integrationId: 'unknown' }), false);
});

test('templates greetings, thanks and reading inquiries while escalating risky messages', () => {
  assert.deepEqual(classifyInboxMessage('hello'), { action: 'template', category: 'greeting' });
  assert.deepEqual(classifyInboxMessage('thank you 💜'), { action: 'template', category: 'gratitude' });
  assert.deepEqual(classifyInboxMessage('How do I book a reading?'), {
    action: 'template', category: 'reading_inquiry',
  });
  assert.equal(classifyInboxMessage('Are you a real person or a bot?').action, 'review');
  assert.equal(classifyInboxMessage('I need legal advice').action, 'review');
  assert.equal(classifyInboxMessage('My order never arrived').action, 'review');
});

test('produces persona-specific inbox replies and rejects forbidden model output', () => {
  assert.match(buildSafeInboxTemplateReply('nadja', 'reading_inquiry'), /guidance/);
  const sanitize = (value) => value.replace(/[\u2013\u2014]/g, ',');
  assert.equal(validateInboxReply('Warm and human.', sanitize), 'Warm and human.');
  assert.equal(validateInboxReply('This was automated.', sanitize), null);
  assert.equal(validateInboxReply('No fluff here.', sanitize), null);
});

test('prompt isolates exact private context and forbids introducing it', () => {
  const prompt = buildInboxReplyPrompt({
    displayName: 'Chaya',
    voice: 'Warm and direct.',
    message: 'Hello',
    privateClientContext: 'PRIVATE CONTEXT: exact match only',
  });
  assert.match(prompt, /exact match only/);
  assert.match(prompt, /Never reveal it/);
  assert.match(prompt, /Never use an em dash/);
});
