import { exec } from "node:child_process";
import type { ToolDefinition } from "../tool-registry.js";

export const searchFilesTool: ToolDefinition = {
  name: "search_files",
  description:
    "Search for a pattern in files using grep. Returns matching lines with file paths and line numbers.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regex pattern to search for" },
      path: {
        type: "string",
        description: "Directory to search in (default: cwd)",
      },
      glob: {
        type: "string",
        description: 'File glob to filter (e.g. "*.ts")',
      },
    },
    required: ["pattern"],
  },
  async execute(input) {
    const pattern = input.pattern as string;
    const searchPath = (input.path as string) ?? ".";
    const glob = input.glob as string | undefined;

    const includeFlag = glob ? `--include='${glob}'` : "";
    const cmd = `grep -rn ${includeFlag} -E '${pattern.replace(/'/g, "'\\''")}' '${searchPath}' 2>/dev/null | head -100`;

    return new Promise<string>((resolve) => {
      exec(cmd, { maxBuffer: 1024 * 1024 * 5 }, (_err, stdout) => {
        resolve(stdout.trim() || "No matches found");
      });
    });
  },
};
