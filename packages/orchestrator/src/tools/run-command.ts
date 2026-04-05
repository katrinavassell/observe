import { exec } from "node:child_process";
import type { ToolDefinition } from "../tool-registry.js";

export const runCommandTool: ToolDefinition = {
  name: "run_command",
  description: "Execute a shell command and return its output",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      cwd: { type: "string", description: "Working directory (optional)" },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default 30000)",
      },
    },
    required: ["command"],
  },
  async execute(input) {
    const command = input.command as string;
    const cwd = (input.cwd as string) ?? process.cwd();
    const timeout = (input.timeout as number) ?? 30000;

    return new Promise<string>((resolve, reject) => {
      exec(
        command,
        { cwd, timeout, maxBuffer: 1024 * 1024 * 10 },
        (err, stdout, stderr) => {
          if (err) {
            reject(
              new Error(
                `Command failed (exit ${err.code}): ${stderr || err.message}`,
              ),
            );
            return;
          }
          const output = stdout + (stderr ? `\n[stderr]: ${stderr}` : "");
          resolve(output || "(no output)");
        },
      );
    });
  },
};
