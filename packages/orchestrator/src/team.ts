import { Agent } from "./agent.js";
import type { AgentConfig } from "./agent.js";
import { AgentPool } from "./agent-pool.js";
import { MessageBus } from "./message-bus.js";
import { SharedMemory } from "./shared-memory.js";
import { TaskQueue, type TaskDefinition } from "./task-queue.js";
import { ToolRegistry } from "./tool-registry.js";
import { readFileTool } from "./tools/read-file.js";
import { writeFileTool } from "./tools/write-file.js";
import { runCommandTool } from "./tools/run-command.js";
import { searchFilesTool } from "./tools/search-files.js";
import { listDirectoryTool } from "./tools/list-directory.js";
import type { LLMAdapter } from "./adapters/base.js";

export interface TeamAgentConfig {
  name: string;
  model: string;
  systemPrompt: string;
  tools?: ToolRegistry;
}

export interface TeamConfig {
  name?: string;
  agents: TeamAgentConfig[];
  maxConcurrency?: number;
  adapters: Map<string, LLMAdapter>;
}

export interface TeamTaskDefinition {
  id: string;
  name: string;
  agent: string;
  dependsOn?: string[];
  handler: (
    agent: Agent,
    memory: SharedMemory,
    bus: MessageBus,
  ) => Promise<unknown>;
}

export class Team {
  readonly name: string;
  readonly bus: MessageBus;
  readonly memory: SharedMemory;
  readonly taskQueue: TaskQueue;
  readonly pool: AgentPool;
  private agents = new Map<string, Agent>();

  constructor(config: TeamConfig) {
    this.name = config.name ?? `team-${Date.now()}`;
    this.bus = new MessageBus();
    this.memory = new SharedMemory();
    this.taskQueue = new TaskQueue();
    this.pool = new AgentPool(config.maxConcurrency ?? 3);

    for (const agentDef of config.agents) {
      const adapter = config.adapters.get(agentDef.model);
      if (!adapter) {
        throw new Error(`No adapter registered for model: ${agentDef.model}`);
      }

      const tools = agentDef.tools ?? this.createDefaultTools();

      const agent = new Agent({
        name: agentDef.name,
        model: agentDef.model,
        systemPrompt: agentDef.systemPrompt,
        adapter,
        tools,
      });
      this.agents.set(agentDef.name, agent);
    }
  }

  getAgent(name: string): Agent {
    const agent = this.agents.get(name);
    if (!agent) throw new Error(`Agent not found: ${name}`);
    return agent;
  }

  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  async runTasks(tasks: TeamTaskDefinition[]): Promise<Map<string, unknown>> {
    for (const task of tasks) {
      this.taskQueue.addTask({
        id: task.id,
        name: task.name,
        dependsOn: task.dependsOn,
        handler: async () => {
          const agent = this.getAgent(task.agent);
          return task.handler(agent, this.memory, this.bus);
        },
      });
    }

    const results = new Map<string, unknown>();

    while (!this.taskQueue.isComplete()) {
      const ready = this.taskQueue.getReady();
      if (ready.length === 0) {
        // All remaining tasks are either running or blocked by failures
        const allTasks = this.taskQueue.getAllTasks();
        const hasRunning = allTasks.some((t) => t.status === "running");
        if (!hasRunning) break;
        // Wait for running tasks to finish
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }

      const executions = ready.map((task) => async () => {
        this.taskQueue.markRunning(task.id);
        try {
          const result = await task.handler(undefined);
          this.taskQueue.complete(task.id, result);
          results.set(task.id, result);
        } catch (err) {
          this.taskQueue.fail(
            task.id,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
      });

      await this.pool.runParallel(executions);
    }

    return results;
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
