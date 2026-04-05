import type {
  LLMAdapter,
  LLMMessage,
  LLMResponse,
  LLMStreamEvent,
} from "./adapters/base.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface AgentConfig {
  name: string;
  model: string;
  systemPrompt: string;
  adapter: LLMAdapter;
  tools?: ToolRegistry;
  maxTurns?: number;
}

export class Agent {
  readonly name: string;
  readonly model: string;
  private adapter: LLMAdapter;
  private tools: ToolRegistry | undefined;
  private systemPrompt: string;
  private maxTurns: number;
  private history: LLMMessage[] = [];

  constructor(config: AgentConfig) {
    this.name = config.name;
    this.model = config.model;
    this.adapter = config.adapter;
    this.tools = config.tools;
    this.systemPrompt = config.systemPrompt;
    this.maxTurns = config.maxTurns ?? 20;
  }

  async prompt(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });
    const response = await this.adapter.chat(
      this.buildMessages(),
      this.tools?.toLLMTools(),
    );
    this.history.push({
      role: "assistant",
      content: response.content,
      tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
    });
    return response.content;
  }

  async run(userMessage: string): Promise<string> {
    this.history.push({ role: "user", content: userMessage });

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.adapter.chat(
        this.buildMessages(),
        this.tools?.toLLMTools(),
      );

      this.history.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
      });

      if (response.stopReason !== "tool_use" || !response.toolCalls.length) {
        return response.content;
      }

      await this.executeToolCalls(response);
    }

    return this.history[this.history.length - 1].content;
  }

  async *stream(userMessage: string): AsyncIterable<LLMStreamEvent> {
    this.history.push({ role: "user", content: userMessage });
    yield* this.adapter.stream(this.buildMessages(), this.tools?.toLLMTools());
  }

  getHistory(): LLMMessage[] {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  private buildMessages(): LLMMessage[] {
    return [{ role: "system", content: this.systemPrompt }, ...this.history];
  }

  private async executeToolCalls(response: LLMResponse): Promise<void> {
    if (!this.tools) return;

    for (const tc of response.toolCalls) {
      let result: string;
      try {
        const input = JSON.parse(tc.arguments);
        result = await this.tools.dispatch(tc.name, input);
      } catch (err) {
        result = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }

      this.history.push({
        role: "tool",
        content: result,
        tool_call_id: tc.id,
      });
    }
  }
}
