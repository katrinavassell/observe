import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "../tool-registry.js";

export const listDirectoryTool: ToolDefinition = {
  name: "list_directory",
  description: "List files and directories at the given path",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
    },
    required: ["path"],
  },
  async execute(input) {
    const dirPath = input.path as string;
    const entries = await readdir(dirPath);
    const lines: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const s = await stat(fullPath).catch(() => null);
      if (!s) continue;
      const prefix = s.isDirectory() ? "[dir]  " : "[file] ";
      lines.push(`${prefix}${entry}`);
    }

    return lines.join("\n") || "(empty directory)";
  },
};
