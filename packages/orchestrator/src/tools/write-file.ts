import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ToolDefinition } from "../tool-registry.js";

export const writeFileTool: ToolDefinition = {
  name: "write_file",
  description: "Write content to a file, creating directories as needed",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write to" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  },
  async execute(input) {
    const path = input.path as string;
    const content = input.content as string;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf-8");
    return `Wrote ${content.length} bytes to ${path}`;
  },
};
