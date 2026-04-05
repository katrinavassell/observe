import type { LLMAdapter, LLMMessage } from "./adapters/base.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface AgentRunnerConfig {
  adapter: LLMAdapter;
  systemPrompt: string;
  tools?: ToolRegistry;
  maxTurns?: number;
  onToolCall?: (name: string, input: Record<string, unknown>) => void;
  onResponse?: (content: string, turnNumber: number) => void;
}

export class AgentRunner {
  private adapter: LLMAdapter;
  private tools: ToolRegistry | undefined;
  private systemPrompt: string;
  private maxTurns: number;
  private onToolCall: AgentRunnerConfig["onToolCall"];
  private onResponse: AgentRunnerConfig["onResponse"];

  constructor(config: AgentRunnerConfig) {
    this.adapter = config.adapter;
    this.tools = config.tools;
    this.systemPrompt = config.systemPrompt;
    this.maxTurns = config.maxTurns ?? 20;
    this.onToolCall = config.onToolCall;
    this.onResponse = config.onResponse;
  }

  async execute(
    userMessage: string,
  ): Promise<{ result: string; history: LLMMessage[] }> {
    const history: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: userMessage },
    ];

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.adapter.chat(
        history,
        this.tools?.toLLMTools(),
      );

      history.push({
        role: "assistant",
        content: response.content,
        tool_calls: response.toolCalls.length ? response.toolCalls : undefined,
      });

      this.onResponse?.(response.content, turn);

      if (response.stopReason !== "tool_use" || !response.toolCalls.length) {
        return { result: response.content, history };
      }

      // Dispatch tool calls
      for (const tc of response.toolCalls) {
        const input = JSON.parse(tc.arguments);
        this.onToolCall?.(tc.name, input);

        let result: string;
        try {
          if (!this.tools) {
            throw new Error(`No tool registry — cannot dispatch ${tc.name}`);
          }
          result = await this.tools.dispatch(tc.name, input);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        history.push({
          role: "tool",
          content: result,
          tool_call_id: tc.id,
        });
      }
    }

    const lastAssistant = history.filter((m) => m.role === "assistant").pop();
    return {
      result: lastAssistant?.content ?? "",
      history,
    };
  }
}
