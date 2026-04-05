export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskDefinition {
  id: string;
  name: string;
  dependsOn?: string[];
  handler: (context: unknown) => Promise<unknown>;
}

export interface TaskEntry {
  id: string;
  name: string;
  status: TaskStatus;
  dependencies: Set<string>;
  dependents: Set<string>;
  handler: (context: unknown) => Promise<unknown>;
  result?: unknown;
  error?: Error;
}

export class TaskQueue {
  private tasks = new Map<string, TaskEntry>();

  addTask(def: TaskDefinition): void {
    if (this.tasks.has(def.id)) {
      throw new Error(`Task already exists: ${def.id}`);
    }

    const deps = new Set(def.dependsOn ?? []);
    for (const depId of deps) {
      if (depId === def.id) {
        throw new Error(`Task cannot depend on itself: ${def.id}`);
      }
    }

    this.tasks.set(def.id, {
      id: def.id,
      name: def.name,
      status: "pending",
      dependencies: deps,
      dependents: new Set(),
      handler: def.handler,
    });

    // Register this task as a dependent of its dependencies
    for (const depId of deps) {
      const dep = this.tasks.get(depId);
      if (dep) {
        dep.dependents.add(def.id);
      }
    }

    // Check for cycles after adding
    this.detectCycles();
  }

  getReady(): TaskEntry[] {
    const ready: TaskEntry[] = [];
    for (const task of this.tasks.values()) {
      if (task.status !== "pending") continue;
      const allDepsCompleted = [...task.dependencies].every((depId) => {
        const dep = this.tasks.get(depId);
        return dep && dep.status === "completed";
      });
      if (allDepsCompleted) {
        ready.push(task);
      }
    }
    return ready;
  }

  markRunning(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    task.status = "running";
  }

  complete(taskId: string, result?: unknown): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    task.status = "completed";
    task.result = result;
  }

  fail(taskId: string, error: Error): void {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    task.status = "failed";
    task.error = error;
    this.cascadeFail(taskId, error);
  }

  getTask(taskId: string): TaskEntry | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): TaskEntry[] {
    return Array.from(this.tasks.values());
  }

  isComplete(): boolean {
    return this.getAllTasks().every(
      (t) => t.status === "completed" || t.status === "failed",
    );
  }

  private cascadeFail(failedId: string, rootError: Error): void {
    const task = this.tasks.get(failedId);
    if (!task) return;

    for (const depId of task.dependents) {
      const dep = this.tasks.get(depId);
      if (dep && dep.status === "pending") {
        dep.status = "failed";
        dep.error = new Error(
          `Dependency "${failedId}" failed: ${rootError.message}`,
        );
        this.cascadeFail(depId, rootError);
      }
    }
  }

  private detectCycles(): void {
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const dfs = (taskId: string): void => {
      if (inStack.has(taskId)) {
        throw new Error(`Cycle detected involving task: ${taskId}`);
      }
      if (visited.has(taskId)) return;

      visited.add(taskId);
      inStack.add(taskId);

      const task = this.tasks.get(taskId);
      if (task) {
        for (const depId of task.dependencies) {
          if (this.tasks.has(depId)) {
            dfs(depId);
          }
        }
      }

      inStack.delete(taskId);
    };

    for (const taskId of this.tasks.keys()) {
      dfs(taskId);
    }
  }
}
