export function publicPromptInputForProvider(provider, input) {
  if (!['groq', 'anthropic'].includes(provider)) return input;
  return {
    ...input,
    username: '',
    relationship: 'new_follower',
    relationshipNotes: '',
  };
}

export function inboxPromptInputForProvider(provider, input) {
  if (!['groq', 'anthropic'].includes(provider)) return input;
  return {
    ...input,
    senderName: '',
    privateClientContext: '',
  };
}
