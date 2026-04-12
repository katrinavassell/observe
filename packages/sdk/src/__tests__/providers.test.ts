import { describe, it, expect } from "vitest";
import { inferModelProvider, parseModel } from "../providers.js";

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

describe("parseModel", () => {
  it("parses OpenAI gpt family with version", () => {
    expect(parseModel("gpt-4o")).toEqual({
      vendor: "openai",
      family: "gpt",
      version: "4o",
    });
    expect(parseModel("gpt-4o-mini")).toEqual({
      vendor: "openai",
      family: "gpt",
      version: "4o-mini",
    });
    expect(parseModel("gpt-3.5-turbo")).toEqual({
      vendor: "openai",
      family: "gpt",
      version: "3.5-turbo",
    });
  });

  it("parses OpenAI o-series families distinctly", () => {
    expect(parseModel("o1-pro")).toEqual({
      vendor: "openai",
      family: "o1",
      version: "pro",
    });
    expect(parseModel("o3-mini")).toEqual({
      vendor: "openai",
      family: "o3",
      version: "mini",
    });
    expect(parseModel("o4-mini")).toEqual({
      vendor: "openai",
      family: "o4",
      version: "mini",
    });
  });

  it("parses embedding and image families before gpt", () => {
    expect(parseModel("text-embedding-ada-002")).toEqual({
      vendor: "openai",
      family: "text-embedding",
      version: "ada-002",
    });
    expect(parseModel("dall-e-3")).toEqual({
      vendor: "openai",
      family: "dall-e",
      version: "3",
    });
  });

  it("parses Anthropic claude versions", () => {
    expect(parseModel("claude-3-5-sonnet-20241022")).toEqual({
      vendor: "anthropic",
      family: "claude",
      version: "3-5-sonnet-20241022",
    });
    expect(parseModel("claude-opus-4")).toEqual({
      vendor: "anthropic",
      family: "claude",
      version: "opus-4",
    });
  });

  it("parses Google gemini and Mistral variants", () => {
    expect(parseModel("gemini-1.5-pro")).toEqual({
      vendor: "google",
      family: "gemini",
      version: "1.5-pro",
    });
    expect(parseModel("mixtral-8x7b")).toEqual({
      vendor: "mistral",
      family: "mixtral",
      version: "8x7b",
    });
    expect(parseModel("codestral-latest")).toEqual({
      vendor: "mistral",
      family: "codestral",
      version: "latest",
    });
  });

  it("strips provider/ slug before parsing", () => {
    expect(parseModel("openai/gpt-4o")).toEqual({
      vendor: "openai",
      family: "gpt",
      version: "4o",
    });
    expect(parseModel("anthropic/claude-3-opus-20240229")).toEqual({
      vendor: "anthropic",
      family: "claude",
      version: "3-opus-20240229",
    });
    expect(parseModel("meta-llama/llama-3.1-70b")).toEqual({
      vendor: "meta",
      family: "llama",
      version: "3.1-70b",
    });
  });

  it("returns null for unknown models", () => {
    expect(parseModel("phi-3")).toBeNull();
    expect(parseModel(undefined)).toBeNull();
    expect(parseModel("")).toBeNull();
  });

  it("handles vendor-only with no family hit", () => {
    expect(parseModel("anthropic/mystery")).toEqual({
      vendor: "anthropic",
      family: null,
      version: null,
    });
  });

  it("handles family with empty version", () => {
    expect(parseModel("claude")).toEqual({
      vendor: "anthropic",
      family: "claude",
      version: null,
    });
  });
});
