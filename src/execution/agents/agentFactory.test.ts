import { describe, it, expect } from "vitest";
import { AgentFactory, createAgent } from "./agentFactory";
import { ClaudeAgent } from "./claudeAgent";
import { CopilotAgent } from "./copilotAgent";
import { CodexAgent } from "./codexAgent";
import { BaseAgent } from "./baseAgent";
import { makeMockSessionManager } from "../../test/fixtures";

describe("AgentFactory", () => {
  const { sessionManager } = makeMockSessionManager();
  const factory = new AgentFactory(sessionManager);

  describe("create", () => {
    it("returns a ClaudeAgent for 'claude'", () => {
      expect(factory.create("claude")).toBeInstanceOf(ClaudeAgent);
    });

    it("returns a CopilotAgent for 'copilot'", () => {
      expect(factory.create("copilot")).toBeInstanceOf(CopilotAgent);
    });

    it("returns a CodexAgent for 'codex'", () => {
      expect(factory.create("codex")).toBeInstanceOf(CodexAgent);
    });

    it("each call returns a new instance", () => {
      const a = factory.create("claude");
      const b = factory.create("claude");
      expect(a).not.toBe(b);
    });

    it("created agents are instanceof BaseAgent", () => {
      expect(factory.create("claude")).toBeInstanceOf(BaseAgent);
      expect(factory.create("copilot")).toBeInstanceOf(BaseAgent);
      expect(factory.create("codex")).toBeInstanceOf(BaseAgent);
    });
  });
});

describe("createAgent", () => {
  const { sessionManager } = makeMockSessionManager();

  it("returns a ClaudeAgent for 'claude'", () => {
    expect(createAgent("claude", sessionManager)).toBeInstanceOf(ClaudeAgent);
  });

  it("returns a CopilotAgent for 'copilot'", () => {
    expect(createAgent("copilot", sessionManager)).toBeInstanceOf(CopilotAgent);
  });

  it("returns a CodexAgent for 'codex'", () => {
    expect(createAgent("codex", sessionManager)).toBeInstanceOf(CodexAgent);
  });
});
