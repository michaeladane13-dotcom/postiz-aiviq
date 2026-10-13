import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildGenerationRequest,
  extractGeneratedText,
  selectGenerationProvider,
} from '../src/generation-provider.js';

test('Anthropic is preferred when its key is configured', () => {
  const config = selectGenerationProvider({
    ANTHROPIC_API_KEY: 'anthropic-secret',
    GROQ_API_KEY: 'groq-secret',
    OPENAI_API_KEY: 'openai-secret',
  });

  assert.equal(config.provider, 'anthropic');
  assert.equal(config.model, 'claude-sonnet-5-5');
  assert.equal(config.endpoint, 'https://api.anthropic.com/v1/messages');
});

test('Anthropic request uses the Messages API contract', () => {
  const request = buildGenerationRequest({
    provider: 'anthropic',
    apiKey: 'anthropic-secret',
    model: 'claude-sonnet-5-5',
  }, 'Reply warmly', 180);

  assert.equal(request.headers.Authorization, 'Bearer anthropic-secret');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(request.body, {
    model: 'claude-sonnet-5-5',
    max_tokens: 180,
    thinking: { type: 'between_tools' },
    messages: [{ role: 'user', content: 'Reply warmly' }],
  });
});

test('Anthropic text response is extracted without thinking blocks', () => {
  const text = extractGeneratedText('anthropic', {
    content: [
      { type: 'thinking', thinking: 'private' },
      { type: 'text', text: 'Hello lovely' },
    ],
  });

  assert.equal(text, 'Hello lovely');
});

test('OpenAI-compatible providers retain their response contract', () => {
  const text = extractGeneratedText('groq', {
    output: [{ content: [{ type: 'output_text', text: 'Warm reply' }] }],
  });

  assert.equal(text, 'Warm reply');
});
