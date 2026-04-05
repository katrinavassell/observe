import type {
  LLMAdapter,
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
  LLMToolDefinition,
} from "./base.js";

export class CopilotAdapter implements LLMAdapter {
  async chat(
    _messages: LLMMessage[],
    _tools?: LLMToolDefinition[],
  ): Promise<LLMResponse> {
    throw new Error(
      "CopilotAdapter is not implemented — no standard SDK available yet",
    );
  }

  async *stream(
    _messages: LLMMessage[],
    _tools?: LLMToolDefinition[],
  ): AsyncIterable<LLMStreamEvent> {
    throw new Error(
      "CopilotAdapter is not implemented — no standard SDK available yet",
    );
  }
}
