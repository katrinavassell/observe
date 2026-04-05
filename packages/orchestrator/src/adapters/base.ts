export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  stopReason: "end_turn" | "tool_use" | "max_tokens";
}

export interface LLMStreamEvent {
  type: "text" | "tool_call_start" | "tool_call_delta" | "done";
  content?: string;
  toolCall?: Partial<LLMToolCall>;
}

export interface LLMAdapter {
  chat(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): Promise<LLMResponse>;

  stream(
    messages: LLMMessage[],
    tools?: LLMToolDefinition[],
  ): AsyncIterable<LLMStreamEvent>;
}
