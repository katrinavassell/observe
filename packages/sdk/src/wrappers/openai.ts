import type { TansoObserve } from "../client.js";
import { OPENAI_PRICING } from "../providers.js";

interface WrapDefaults {
  customerReferenceId?: string;
  featureKey?: string;
}

function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | undefined {
  const pricing = OPENAI_PRICING[model];
  if (!pricing) return undefined;
  return pricing.input * promptTokens + pricing.output * completionTokens;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isStreamResponse(response: any): boolean {
  return (
    response &&
    (typeof response[Symbol.asyncIterator] === "function" ||
      typeof response.iterator === "function")
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function trackCompletion(
  observe: TansoObserve,
  response: any,
  defaults?: WrapDefaults,
): void {
  const model: string = response.model ?? "";
  const usage = response.usage;
  const promptTokens: number = usage?.prompt_tokens ?? 0;
  const completionTokens: number = usage?.completion_tokens ?? 0;
  const cost = estimateCost(model, promptTokens, completionTokens);

  observe.track({
    eventName: "llm.chat.completion",
    customerReferenceId: defaults?.customerReferenceId ?? "unknown",
    featureKey: defaults?.featureKey ?? "openai-chat",
    model,
    modelProvider: "openai",
    usageUnits: promptTokens + completionTokens,
    costAmount: cost,
    costUnit: "usd",
    properties: {
      promptTokens,
      completionTokens,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapStream(
  stream: any,
  observe: TansoObserve,
  defaults?: WrapDefaults,
): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let finalChunk: any = null;

  const originalIterator = stream[Symbol.asyncIterator].bind(stream);

  stream[Symbol.asyncIterator] = function () {
    const iterator = originalIterator();
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async next(): Promise<IteratorResult<any>> {
        const result = await iterator.next();
        if (!result.done) {
          finalChunk = result.value;
        } else if (finalChunk?.usage) {
          try {
            const model: string = finalChunk.model ?? "";
            const promptTokens: number = finalChunk.usage.prompt_tokens ?? 0;
            const completionTokens: number =
              finalChunk.usage.completion_tokens ?? 0;
            const cost = estimateCost(model, promptTokens, completionTokens);

            observe.track({
              eventName: "llm.chat.completion",
              customerReferenceId: defaults?.customerReferenceId ?? "unknown",
              featureKey: defaults?.featureKey ?? "openai-chat",
              model,
              modelProvider: "openai",
              usageUnits: promptTokens + completionTokens,
              costAmount: cost,
              costUnit: "usd",
              properties: {
                promptTokens,
                completionTokens,
              },
            });
          } catch (_) {
            // tracking failure should not break the caller's stream
          }
        }
        return result;
      },
    };
  };

  return stream;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapOpenAI(
  client: any,
  observe: TansoObserve,
  defaults?: WrapDefaults,
): any {
  const original = client.chat.completions.create.bind(client.chat.completions);

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "chat") return Reflect.get(target, prop, receiver);

      return new Proxy(target.chat, {
        get(chatTarget, chatProp, chatReceiver) {
          if (chatProp !== "completions")
            return Reflect.get(chatTarget, chatProp, chatReceiver);

          return new Proxy(chatTarget.completions, {
            get(compTarget, compProp, compReceiver) {
              if (compProp !== "create")
                return Reflect.get(compTarget, compProp, compReceiver);

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              return async function (...args: any[]) {
                const response = await original(...args);

                if (isStreamResponse(response)) {
                  return wrapStream(response, observe, defaults);
                }

                try {
                  trackCompletion(observe, response, defaults);
                } catch (_) {
                  // tracking failure should not break the caller
                }

                return response;
              };
            },
          });
        },
      });
    },
  });
}
