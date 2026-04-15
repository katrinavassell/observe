import type { TansoObserve } from "../client.js";
import { ANTHROPIC_PRICING } from "../providers.js";

interface WrapDefaults {
  customerReferenceId?: string;
  featureKey?: string;
}

function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = ANTHROPIC_PRICING[model];
  if (!pricing) return undefined;
  return pricing.input * inputTokens + pricing.output * outputTokens;
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
function trackMessage(
  observe: TansoObserve,
  response: any,
  defaults?: WrapDefaults,
): void {
  const model: string = response.model ?? "";
  const inputTokens: number = response.usage?.input_tokens ?? 0;
  const outputTokens: number = response.usage?.output_tokens ?? 0;
  const cost = estimateCost(model, inputTokens, outputTokens);

  observe.track({
    eventName: "llm.messages.create",
    customerReferenceId: defaults?.customerReferenceId ?? "unknown",
    featureKey: defaults?.featureKey ?? "anthropic-messages",
    model,
    modelProvider: "anthropic",
    usageUnits: inputTokens + outputTokens,
    costAmount: cost,
    costUnit: "usd",
    properties: {
      inputTokens,
      outputTokens,
    },
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function wrapStream(
  stream: any,
  observe: TansoObserve,
  defaults?: WrapDefaults,
): any {
  let model = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const originalIterator = stream[Symbol.asyncIterator].bind(stream);

  stream[Symbol.asyncIterator] = function () {
    const iterator = originalIterator();
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async next(): Promise<IteratorResult<any>> {
        const result = await iterator.next();
        if (!result.done) {
          const event = result.value;
          if (event.type === "message_start" && event.message) {
            model = event.message.model ?? model;
            inputTokens = event.message.usage?.input_tokens ?? inputTokens;
          } else if (event.type === "message_delta" && event.usage) {
            outputTokens = event.usage.output_tokens ?? outputTokens;
          }
        } else if (inputTokens > 0 || outputTokens > 0) {
          try {
            const cost = estimateCost(model, inputTokens, outputTokens);
            observe.track({
              eventName: "llm.messages.create",
              customerReferenceId: defaults?.customerReferenceId ?? "unknown",
              featureKey: defaults?.featureKey ?? "anthropic-messages",
              model,
              modelProvider: "anthropic",
              usageUnits: inputTokens + outputTokens,
              costAmount: cost,
              costUnit: "usd",
              properties: {
                inputTokens,
                outputTokens,
              },
            });
          } catch (err) {
            // tracking failure should not break the caller's stream
            console.warn("Observe: anthropic stream tracking failed", err);
          }
        }
        return result;
      },
    };
  };

  return stream;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function wrapAnthropic(
  client: any,
  observe: TansoObserve,
  defaults?: WrapDefaults,
): any {
  const original = client.messages.create.bind(client.messages);

  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop !== "messages") return Reflect.get(target, prop, receiver);

      return new Proxy(target.messages, {
        get(msgTarget, msgProp, msgReceiver) {
          if (msgProp !== "create")
            return Reflect.get(msgTarget, msgProp, msgReceiver);

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return async function (...args: any[]) {
            const response = await original(...args);

            if (isStreamResponse(response)) {
              return wrapStream(response, observe, defaults);
            }

            try {
              trackMessage(observe, response, defaults);
            } catch (err) {
              // tracking failure should not break the caller
              console.warn("Observe: anthropic tracking failed", err);
            }

            return response;
          };
        },
      });
    },
  });
}
