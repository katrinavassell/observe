import type { TansoObserve } from '../client.js';

interface WrapDefaults {
  customerReferenceId?: string;
  featureKey?: string;
}

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-haiku-4-20250414': { input: 0.8 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-3-5-sonnet-20241022': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return undefined;
  return pricing.input * inputTokens + pricing.output * outputTokens;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isStreamResponse(response: any): boolean {
  return response && (typeof response[Symbol.asyncIterator] === 'function' || typeof response.iterator === 'function');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapAnthropic(client: any, observe: TansoObserve, defaults?: WrapDefaults): void {
  const original = client.messages.create.bind(client.messages);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client.messages.create = async function (...args: any[]) {
    const response = await original(...args);

    // Skip tracking for streaming responses — usage data is not available on the stream object
    if (isStreamResponse(response)) {
      return response;
    }

    try {
      const model: string = response.model ?? '';
      const inputTokens: number = response.usage?.input_tokens ?? 0;
      const outputTokens: number = response.usage?.output_tokens ?? 0;
      const cost = estimateCost(model, inputTokens, outputTokens);

      observe.track({
        eventName: 'llm.messages.create',
        customerReferenceId: defaults?.customerReferenceId ?? 'unknown',
        featureKey: defaults?.featureKey ?? 'anthropic-messages',
        model,
        modelProvider: 'anthropic',
        usageUnits: inputTokens + outputTokens,
        costAmount: cost,
        costUnit: 'usd',
        properties: {
          inputTokens,
          outputTokens,
        },
      });
    } catch (err) {
      observe['options']?.onError?.(err instanceof Error ? err : new Error(String(err)));
    }

    return response;
  };
}
