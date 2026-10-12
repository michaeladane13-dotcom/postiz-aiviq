export function publicPromptInputForProvider(provider, input) {
  if (provider !== 'groq') return input;
  return {
    ...input,
    username: '',
    relationship: 'new_follower',
    relationshipNotes: '',
  };
}

export function inboxPromptInputForProvider(provider, input) {
  if (provider !== 'groq') return input;
  return {
    ...input,
    senderName: '',
    privateClientContext: '',
  };
}
