import assert from 'node:assert/strict';
import test from 'node:test';
import { GitHubHandoverKnowledge, extractClientSection } from '../src/handover-knowledge.js';

const MARKDOWN = `# Chaya Regular-Client Handover

Last updated 2026-09-25.

## Natalie - long-standing

PRIVATE CONTEXT: Follow her lead and be warm.

## David Smith - website client

PRIVATE CONTEXT: Never invent delivery status.

# Standing rules

Never expose private context.`;

test('extracts only the exact client section', () => {
  assert.match(extractClientSection(MARKDOWN, 'Natalie'), /Follow her lead/);
  assert.doesNotMatch(extractClientSection(MARKDOWN, 'Natalie'), /David Smith/);
  assert.equal(extractClientSection(MARKDOWN, 'Nat'), '');
  assert.equal(extractClientSection(MARKDOWN, 'Identity unresolved'), '');
});

test('syncs confidential handover knowledge without exposing it in status', async () => {
  const knowledge = new GitHubHandoverKnowledge({
    repository: 'michaeladane13-dotcom/chaya-client-handover',
    path: 'README.md',
    ref: 'main',
    token: 'token',
    fetchImpl: async () => new Response(MARKDOWN, { headers: { etag: '"v1"' } }),
  });
  await knowledge.sync();
  const context = knowledge.contextFor({ id: 'natalie', clientLabel: 'Natalie', engagement: 'reply' });
  assert.match(context, /Follow her lead/);
  assert.equal(Object.hasOwn(knowledge.status(), 'markdown'), false);
  assert.equal(knowledge.status().sourceUpdatedAt, '2026-09-25');
});

test('never supplies private context for unresolved or do-not-engage identities', async () => {
  const knowledge = new GitHubHandoverKnowledge({
    repository: 'owner/repo', path: 'README.md', ref: 'main', token: 'token',
    fetchImpl: async () => new Response(MARKDOWN),
  });
  await knowledge.sync();
  assert.equal(knowledge.contextFor({
    id: 'ems-lassie-unresolved', clientLabel: 'Identity unresolved', engagement: 'reply',
  }), '');
  assert.equal(knowledge.contextFor({
    id: 'natalie', clientLabel: 'Natalie', engagement: 'do_not_engage',
  }), '');
});
