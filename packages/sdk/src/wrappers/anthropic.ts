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
              return response;
            }

            try {
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
            } catch (_) {
              // tracking failure should not break the caller
            }

            return response;
          };
        },
      });
    },
  });
}
