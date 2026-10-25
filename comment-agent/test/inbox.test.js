import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildInboxReplyPrompt,
  buildSafeInboxTemplateReply,
  classifyInboxMessage,
  isApprovedInboxAccount,
  mayUseCuratedReplyFallback,
  shouldIgnoreInboxMessage,
  validateInboxReply,
} from '../src/inbox.js';

test('locks inbox handling to the nine exact active brand integrations', () => {
  assert.equal(isApprovedInboxAccount({ integrationId: 'cmt0qpsu7000bmsb2oga61nh4' }), true);
  assert.equal(isApprovedInboxAccount({ integrationId: 'cmt3axpg50003l6pa5i2lf62b' }), true);
  assert.equal(isApprovedInboxAccount({ integrationId: 'cmt3bncar0001l6silkp4gruh' }), true);
  assert.equal(isApprovedInboxAccount({ integrationId: 'cmuhnbkiw0001mtddcb6vugex' }), true);
  assert.equal(isApprovedInboxAccount({ integrationId: 'unknown' }), false);
});

test('ignores standalone ASK messages only in the Chaya inbox', () => {
  for (const message of ['ASK', 'ask', ' Ask ', 'aSk']) {
    assert.equal(shouldIgnoreInboxMessage('chaya', message), true);
  }
  assert.equal(shouldIgnoreInboxMessage('ren', 'ASK'), false);
  assert.equal(shouldIgnoreInboxMessage('chaya', 'Can I ask a question?'), false);
  assert.equal(shouldIgnoreInboxMessage('chaya', 'ASK PLEASE'), false);
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
  for (const message of [
    'where are you from',
    "Looking comfy, I'm from England and it's freezing",
    'tell me what would you like to do',
    'Can we chat?',
    'Are you single?',
    'You are so sexy',
    'Can I have your WhatsApp number?',
    'Send me a picture',
  ]) {
    assert.deepEqual(classifyInboxMessage(message), {
      action: 'review', category: 'personal_or_flirtatious',
    });
  }
});

test('produces persona-specific inbox replies and rejects forbidden model output', () => {
  assert.match(buildSafeInboxTemplateReply('nadja', 'reading_inquiry'), /guidance/);
  assert.match(buildSafeInboxTemplateReply('david', 'reading_inquiry'), /davidthemystic\.ca/);
  assert.match(buildSafeInboxTemplateReply('kumpania', 'reading_inquiry'), /thekumpania\.com/);
  assert.match(buildSafeInboxTemplateReply('daniel', 'reading_inquiry'), /danielpsychicartist\.space/);
  assert.equal(
    buildSafeInboxTemplateReply('chaya', 'greeting'),
    'Hi, how can I help with a reading or booking today? 💜'
  );
  assert.doesNotMatch(buildSafeInboxTemplateReply('chaya', 'greeting'), /lovely/i);
  for (const persona of ['chaya', 'ren', 'nadja', 'david', 'kumpania', 'daniel']) {
    const reply = buildSafeInboxTemplateReply(persona, 'ordinary');
    assert.match(reply, /tell (?:me|us) a little more/i);
    assert.doesNotMatch(reply, /\u2014/);
  }
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
    brandContext: 'Active brand account: chaya. Official booking page: https://chayathemedium.org/shop',
    privateClientContext: 'PRIVATE CONTEXT: exact match only',
    conversationRule: 'Do not repeat the card link.',
  });
  assert.match(prompt, /exact match only/);
  assert.match(prompt, /Never reveal it/);
  assert.match(prompt, /Official booking page/);
  assert.match(prompt, /Never borrow a fact/);
  assert.match(prompt, /Never use an em dash/);
  assert.match(prompt, /recommend the smallest suitable current offer/);
  assert.match(prompt, /Never encourage personal, romantic, flirtatious or sexual conversation/);
  assert.match(prompt, /Never recommend a first-time or new-client offer to a returning client/);
  assert.match(prompt, /Do not repeat the card link/);
});

test('no-sales inbox replies receive a hard owner rule', () => {
  const prompt = buildInboxReplyPrompt({
    displayName: 'Ren',
    voice: 'Warm and direct.',
    message: 'I can never keep a routine',
    salesBlocked: true,
  });
  assert.match(prompt, /must receive no sales pitch, offer, promotion/);
  assert.doesNotMatch(prompt, /recommend the smallest suitable current offer/);
});

test('sensitive-client inbox prompt requires a specific reply and forbids canned wording', () => {
  const prompt = buildInboxReplyPrompt({
    displayName: 'Ren',
    voice: 'Warm and direct.',
    message: 'That really made me laugh',
    recentHistory: [{ role: 'user', text: 'You know exactly what I mean' }],
    sensitiveClient: true,
  });
  assert.match(prompt, /sensitive known client/);
  assert.match(prompt, /specific, personal reply/);
  assert.match(prompt, /Never use a stock acknowledgement/);
  assert.match(prompt, /recent conversation/);
});

test('curated fallback is disabled whenever contextual generation is configured', () => {
  assert.equal(mayUseCuratedReplyFallback({ generationConfigured: true }), false);
  assert.equal(mayUseCuratedReplyFallback({ generationConfigured: false }), true);
  assert.equal(mayUseCuratedReplyFallback({
    generationConfigured: false,
    sensitiveClient: true,
  }), false);
});
