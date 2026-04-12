import { describe, it, expect } from "vitest";
import { inferModelProvider } from "../providers.js";

describe("inferModelProvider", () => {
  it("returns anthropic for claude models", () => {
    expect(inferModelProvider("claude-sonnet-4-20250514")).toBe("anthropic");
    expect(inferModelProvider("claude-3-5-sonnet-20241022")).toBe("anthropic");
  });

  it("returns openai for gpt models", () => {
    expect(inferModelProvider("gpt-4o")).toBe("openai");
    expect(inferModelProvider("gpt-3.5-turbo")).toBe("openai");
  });

  it("returns openai for dall-e models", () => {
    expect(inferModelProvider("dall-e-3")).toBe("openai");
  });

  it("returns openai for text-embedding models", () => {
    expect(inferModelProvider("text-embedding-ada-002")).toBe("openai");
  });

  it("returns google for gemini models", () => {
    expect(inferModelProvider("gemini-1.5-pro")).toBe("google");
  });

  it("returns mistral for mistral and mixtral models", () => {
    expect(inferModelProvider("mistral-large")).toBe("mistral");
    expect(inferModelProvider("mixtral-8x7b")).toBe("mistral");
  });

  it("returns meta for llama models", () => {
    expect(inferModelProvider("llama-3.1-70b")).toBe("meta");
  });

  it("returns cohere for command models", () => {
    expect(inferModelProvider("command-r-plus")).toBe("cohere");
  });

  it("returns null for unknown models", () => {
    expect(inferModelProvider("some-random-model")).toBeNull();
    expect(inferModelProvider("phi-3")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(inferModelProvider(undefined)).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(inferModelProvider("GPT-4o")).toBe("openai");
    expect(inferModelProvider("Claude-3-5-sonnet-20241022")).toBe("anthropic");
  });

  it("is order-independent for keyword fallback", () => {
    expect(inferModelProvider("open-ai-gpt-o3")).toBe("openai");
    expect(inferModelProvider("o3-open-ai-gpt")).toBe("openai");
  });

  it("handles provider/model slug convention", () => {
    expect(inferModelProvider("openai/gpt-4o")).toBe("openai");
    expect(inferModelProvider("anthropic/claude-3-opus")).toBe("anthropic");
    expect(inferModelProvider("meta-llama/llama-3")).toBe("meta");
    expect(inferModelProvider("azure/gpt-4")).toBe("openai");
    expect(inferModelProvider("vertex_ai/gemini-1.5-pro")).toBe("google");
  });
});
