import type { TansoObserve } from '../client.js';

interface WrapDefaults {
  customerReferenceId?: string;
  featureKey?: string;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
  'gpt-3.5-turbo': { input: 0.5 / 1_000_000, output: 1.5 / 1_000_000 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number | undefined {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return undefined;
  return pricing.input * promptTokens + pricing.output * completionTokens;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapOpenAI(client: any, observe: TansoObserve, defaults?: WrapDefaults): void {
  const original = client.chat.completions.create.bind(client.chat.completions);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.chat.completions.create = async function (...args: any[]) {
    const response = await original(...args);

    try {
      const model: string = response.model ?? '';
      const usage = response.usage;
      const promptTokens: number = usage?.prompt_tokens ?? 0;
      const completionTokens: number = usage?.completion_tokens ?? 0;
      const cost = estimateCost(model, promptTokens, completionTokens);

      observe.track({
        eventName: 'llm.chat.completion',
        customerReferenceId: defaults?.customerReferenceId ?? 'unknown',
        featureKey: defaults?.featureKey ?? 'openai-chat',
        model,
        modelProvider: 'openai',
        usageUnits: promptTokens + completionTokens,
        costAmount: cost,
        costUnit: 'usd',
        properties: {
          promptTokens,
          completionTokens,
        },
      });
    } catch {
      // Never throw to user code
    }

    return response;
  };
}
