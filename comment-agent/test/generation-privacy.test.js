import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inboxPromptInputForProvider,
  publicPromptInputForProvider,
} from '../src/generation-privacy.js';

test('Groq public prompts cannot receive private relationship fields', () => {
  const safe = publicPromptInputForProvider('groq', {
    comment: 'I had a dream last night',
    recentHistory: [{ inbound: 'Hello', reply: 'Hello lovely' }],
    brandContext: 'Public offer information',
    relationship: 'friend_regular',
    relationshipNotes: 'PRIVATE CLIENT NOTE',
  });

  assert.equal(safe.relationship, 'new_follower');
  assert.equal(safe.relationshipNotes, '');
  assert.equal(safe.comment, 'I had a dream last night');
  assert.equal(safe.brandContext, 'Public offer information');
  assert.equal(safe.recentHistory.length, 1);
});

test('Groq inbox prompts cannot receive private client records or notes', () => {
  const safe = inboxPromptInputForProvider('groq', {
    message: 'Can you tell me about a reading?',
    recentHistory: [{ inbound: 'Hello', reply: 'Hello lovely' }],
    brandContext: 'Public offer information',
    privateClientContext: 'PRIVATE CLIENT RECORD',
  });

  assert.equal(safe.privateClientContext, '');
  assert.equal(safe.message, 'Can you tell me about a reading?');
  assert.equal(safe.brandContext, 'Public offer information');
  assert.equal(safe.recentHistory.length, 1);
});

test('other providers retain their existing input contract', () => {
  const input = { privateClientContext: 'legacy context' };
  assert.equal(inboxPromptInputForProvider('openai', input), input);
});
