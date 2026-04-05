import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMAdapter,
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
  LLMToolCall,
  LLMToolDefinition,
} from "./base.js";

export interface AnthropicAdapterOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export class AnthropicAdapter implements LLMAdapter {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;

  constructor(options: AnthropicAdapterOptions = {}) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? "claude-sonnet-4-20250514";
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    const { systemPrompt, apiMessages } = this.convertMessages(messages);

    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: apiMessages,
    };
    if (systemPrompt) params.system = systemPrompt;
    if (tools?.length) params.tools = this.convertTools(tools);

    const response = await this.client.messages.create(params);

    return this.parseResponse(response);
  }

  async *stream(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): AsyncIterable<LLMStreamEvent> {
    const { systemPrompt, apiMessages } = this.convertMessages(messages);

    const params: Anthropic.MessageCreateParams = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: apiMessages,
      stream: true,
    };
    if (systemPrompt) params.system = systemPrompt;
    if (tools?.length) params.tools = this.convertTools(tools);

    const stream = await this.client.messages.create(params);

    let currentToolId = "";
    let currentToolName = "";

    for await (const event of stream as AsyncIterable<Anthropic.MessageStreamEvent>) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "tool_use") {
          currentToolId = block.id;
          currentToolName = block.name;
          yield {
            type: "tool_call_start",
            toolCall: { id: block.id, name: block.name, arguments: "" },
          };
        }
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") {
          yield { type: "text", content: delta.text };
        } else if (delta.type === "input_json_delta") {
          yield {
            type: "tool_call_delta",
            toolCall: {
              id: currentToolId,
              name: currentToolName,
              arguments: delta.partial_json,
            },
          };
        }
      } else if (event.type === "message_stop") {
        yield { type: "done" };
      }
    }
  }

  private convertMessages(messages: LLMMessage[]): {
    systemPrompt: string | undefined;
    apiMessages: Anthropic.MessageParam[];
  } {
    let systemPrompt: string | undefined;
    const apiMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemPrompt = msg.content;
        continue;
      }

      if (msg.role === "assistant" && msg.tool_calls?.length) {
        const content: Anthropic.ContentBlockParam[] = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: JSON.parse(tc.arguments),
          });
        }
        apiMessages.push({ role: "assistant", content });
        continue;
      }

      if (msg.role === "tool") {
        apiMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id!,
              content: msg.content,
            },
          ],
        });
        continue;
      }

      apiMessages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    return { systemPrompt, apiMessages };
  }

  private convertTools(tools: LLMToolDefinition[]): Anthropic.Tool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));
  }

  private parseResponse(response: Anthropic.Message): LLMResponse {
    let content = "";
    const toolCalls: LLMToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
      }
    }

    const stopReason =
      response.stop_reason === "tool_use"
        ? "tool_use"
        : response.stop_reason === "max_tokens"
          ? "max_tokens"
          : "end_turn";

    return { content, toolCalls, stopReason };
  }
}
