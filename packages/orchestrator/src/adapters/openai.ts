import OpenAI from "openai";
import type {
  LLMAdapter,
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
  LLMToolDefinition,
} from "./base.js";

export interface OpenAIAdapterOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export class OpenAIAdapter implements LLMAdapter {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;

  constructor(options: OpenAIAdapterOptions = {}) {
    this.client = new OpenAI({ apiKey: options.apiKey });
    this.model = options.model ?? "gpt-4o";
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const params: OpenAI.ChatCompletionCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: this.convertMessages(messages),
    };
    if (tools?.length) {
      params.tools = this.convertTools(tools);
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? []).map(
      (tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }),
    );

    const stopReason =
      choice.finish_reason === "tool_calls"
        ? "tool_use"
        : choice.finish_reason === "length"
          ? "max_tokens"
          : "end_turn";

    return {
      content: choice.message.content ?? "",
      toolCalls,
      stopReason,
    };
  }

  async *stream(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): AsyncIterable<LLMStreamEvent> {
    const params: OpenAI.ChatCompletionCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: this.convertMessages(messages),
      stream: true,
    };
    if (tools?.length) {
      params.tools = this.convertTools(tools);
    }

    const stream = await this.client.chat.completions.create(params);

    for await (const chunk of stream as AsyncIterable<OpenAI.ChatCompletionChunk>) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        yield { type: "text", content: delta.content };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (tc.id) {
            yield {
              type: "tool_call_start",
              toolCall: {
                id: tc.id,
                name: tc.function?.name,
                arguments: tc.function?.arguments ?? "",
              },
            };
          } else if (tc.function?.arguments) {
            yield {
              type: "tool_call_delta",
              toolCall: { arguments: tc.function.arguments },
            };
          }
        }
      }

      if (chunk.choices[0]?.finish_reason) {
        yield { type: "done" };
      }
    }
  }

  private convertMessages(
    messages: LLMMessage[],
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (msg.role === "assistant" && msg.tool_calls?.length) {
        return {
          role: "assistant" as const,
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }

      if (msg.role === "tool") {
        return {
          role: "tool" as const,
          content: msg.content,
          tool_call_id: msg.tool_call_id!,
        };
      }

      return {
        role: msg.role as "system" | "user" | "assistant",
        content: msg.content,
      };
    });
  }

  private convertTools(
    tools: LLMToolDefinition[],
  ): OpenAI.ChatCompletionTool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }
}
