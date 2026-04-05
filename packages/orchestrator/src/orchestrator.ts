import { Agent } from "./agent.js";
import type { LLMAdapter } from "./adapters/base.js";
import {
  AnthropicAdapter,
  type AnthropicAdapterOptions,
} from "./adapters/anthropic.js";
import { OpenAIAdapter, type OpenAIAdapterOptions } from "./adapters/openai.js";
import { ToolRegistry } from "./tool-registry.js";
import { Team, type TeamAgentConfig, type TeamTaskDefinition } from "./team.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { runCommandTool } from "./tools/run-command.js";
import { searchFilesTool } from "./tools/search-files.js";
import { listDirectoryTool } from "./tools/list-directory.js";

export interface CreateTeamOptions {
  name?: string;
  agents: TeamAgentConfig[];
  maxConcurrency?: number;
}

export interface RunAgentOptions {
  model: string;
  prompt: string;
  systemPrompt?: string;
  tools?: ToolRegistry;
  maxTurns?: number;
}

export interface OrchestratorStatus {
  teams: Array<{
    name: string;
    agents: string[];
    tasks: Array<{
      id: string;
      name: string;
      status: string;
    }>;
  }>;
  adapters: string[];
}

export class OpenMultiAgent {
  private adapters = new Map<string, LLMAdapter>();
  private teams: Team[] = [];

  registerAdapter(modelPattern: string, adapter: LLMAdapter): void {
    this.adapters.set(modelPattern, adapter);
  }

  registerAnthropicModels(options?: AnthropicAdapterOptions): void {
    const adapter = new AnthropicAdapter(options);
    this.adapters.set(options?.model ?? "claude-sonnet-4-20250514", adapter);
  }

  registerOpenAIModels(options?: OpenAIAdapterOptions): void {
    const adapter = new OpenAIAdapter(options);
    this.adapters.set(options?.model ?? "gpt-4o", adapter);
  }

  createTeam(options: CreateTeamOptions): Team {
    const team = new Team({
      name: options.name,
      agents: options.agents,
      maxConcurrency: options.maxConcurrency,
      adapters: this.adapters,
    });
    this.teams.push(team);
    return team;
  }

  async runTasks(
    team: Team,
    tasks: TeamTaskDefinition[],
  ): Promise<Map<string, unknown>> {
    return team.runTasks(tasks);
  }

  async runAgent(options: RunAgentOptions): Promise<string> {
    const adapter = this.resolveAdapter(options.model);
    const tools = options.tools ?? this.createDefaultTools();

    const agent = new Agent({
      name: "solo-agent",
      model: options.model,
      systemPrompt: options.systemPrompt ?? "You are a helpful assistant.",
      adapter,
      tools,
      maxTurns: options.maxTurns,
    });

    return agent.run(options.prompt);
  }

  getStatus(): OrchestratorStatus {
    return {
      teams: this.teams.map((team) => ({
        name: team.name,
        agents: team.getAllAgents().map((a) => a.name),
        tasks: team.taskQueue.getAllTasks().map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
        })),
      })),
      adapters: Array.from(this.adapters.keys()),
    };
  }

  private resolveAdapter(model: string): LLMAdapter {
    const adapter = this.adapters.get(model);
    if (!adapter) {
      throw new Error(
        `No adapter for model "${model}". Register one with registerAdapter(), registerAnthropicModels(), or registerOpenAIModels().`,
      );
    }
    return adapter;
  }

  private createDefaultTools(): ToolRegistry {
    const registry = new ToolRegistry();
    registry.defineTool(readFileTool);
    registry.defineTool(writeFileTool);
    registry.defineTool(runCommandTool);
    registry.defineTool(searchFilesTool);
    registry.defineTool(listDirectoryTool);
    return registry;
  }
}
