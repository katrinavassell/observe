import { readFile } from "node:fs/promises";
import type { ToolDefinition } from "../tool-registry.js";

export const readFileTool: ToolDefinition = {
  name: "read_file",
  description: "Read the contents of a file at the given path",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
    },
    required: ["path"],
  },
  async execute(input) {
    const path = input.path as string;
    const content = await readFile(path, "utf-8");
    return content;
  },
};
