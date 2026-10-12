export function publicPromptInputForProvider(provider, input) {
  if (provider !== 'groq') return input;
  return {
    ...input,
    relationship: 'new_follower',
    relationshipNotes: '',
  };
}

export function inboxPromptInputForProvider(provider, input) {
  if (provider !== 'groq') return input;
  return {
    ...input,
    privateClientContext: '',
  };
}
