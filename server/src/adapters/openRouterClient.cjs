const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getApiKey() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required when AI_PROVIDER, SOCIAL_PROVIDER, or VISUAL_PROVIDER uses openrouter.');
  }
  return process.env.OPENROUTER_API_KEY;
}

function getMessageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        return part.text || '';
      })
      .join('');
  }
  return '';
}

function parseJsonContent(content) {
  const raw = getMessageText(content).trim();
  try {
    return JSON.parse(raw);
  } catch (error) {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) return JSON.parse(fenced[1]);
    const object = raw.match(/\{[\s\S]*\}/);
    if (object) return JSON.parse(object[0]);
    throw error;
  }
}

async function createChatCompletion({
  model,
  messages,
  responseFormat,
  temperature = 0.2,
  maxTokens = 4000,
}) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'http://localhost:3001',
      'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || 'Podcast Repurposing Engine',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: responseFormat,
      provider: {
        require_parameters: Boolean(responseFormat),
        sort: 'price',
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    const providerDetail = data?.error?.metadata?.raw
      || data?.error?.metadata?.provider_error
      || data?.error?.metadata?.provider_name;
    const primary = data?.error?.message || data?.error || `OpenRouter request failed with ${response.status}`;
    const detail = typeof providerDetail === 'string' ? providerDetail.slice(0, 800) : '';
    throw new Error(`${primary}${detail && !String(primary).includes(detail) ? `: ${detail}` : ''}`);
  }

  return data;
}

async function createJsonCompletion({ model, messages, schemaName, schema, temperature = 0.2, maxTokens = 4000 }) {
  const data = await createChatCompletion({
    model,
    messages,
    temperature,
    maxTokens,
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    },
  });

  return parseJsonContent(data.choices?.[0]?.message?.content || '');
}

module.exports = {
  createChatCompletion,
  createJsonCompletion,
};
