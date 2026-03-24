export function inferModelProvider(model: string | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith('claude-')) return 'anthropic';
  if (m.startsWith('gpt-')) return 'openai';
  if (m.startsWith('dall-e-')) return 'openai';
  if (m.startsWith('text-embedding-')) return 'openai';
  if (m.startsWith('gemini-')) return 'google';
  if (m.startsWith('mistral-') || m.startsWith('mixtral-')) return 'mistral';
  if (m.startsWith('llama-')) return 'meta';
  if (m.startsWith('command-')) return 'cohere';
  return null;
}
