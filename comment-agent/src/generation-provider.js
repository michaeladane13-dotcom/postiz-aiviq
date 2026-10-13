const RESPONSES_API_ENDPOINTS = {
  groq: 'https://api.groq.com/openai/v1/responses',
  openai: 'https://api.openai.com/v1/responses',
};

export function selectGenerationProvider(env = process.env) {
  const anthropicKey = env.ANTHROPIC_API_KEY || '';
  const groqKey = env.GROQ_API_KEY || '';
  const openaiKey = env.OPENAI_API_KEY || '';

  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
      endpoint: 'https://api.anthropic.com/v1/messages',
    };
  }
  if (groqKey) {
    return {
      provider: 'groq',
      apiKey: groqKey,
      model: env.GROQ_MODEL || 'openai/gpt-oss-120b',
      endpoint: RESPONSES_API_ENDPOINTS.groq,
    };
  }
  if (openaiKey) {
    return {
      provider: 'openai',
      apiKey: openaiKey,
      model: env.OPENAI_MODEL || 'gpt-5-mini',
      endpoint: RESPONSES_API_ENDPOINTS.openai,
    };
  }
  return {
    provider: null,
    apiKey: '',
    model: null,
    endpoint: null,
  };
}

export function buildGenerationRequest(config, prompt, maxOutputTokens) {
  if (config.provider === 'anthropic') {
    return {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: {
        model: config.model,
        max_tokens: maxOutputTokens,
        thinking: { type: 'between_tools' },
        messages: [{ role: 'user', content: prompt }],
      },
    };
  }

  return {
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: {
      model: config.model,
      input: prompt,
      max_output_tokens: maxOutputTokens,
      store: false,
    },
  };
}

export function extractGeneratedText(provider, body) {
  if (provider === 'anthropic') {
    return (body?.content || [])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text || '')
      .join('')
      .trim();
  }

  return (body?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((part) => part?.type === 'output_text')
    .map((part) => part.text || '')
    .join('')
    .trim();
}
