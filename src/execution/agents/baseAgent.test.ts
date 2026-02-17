import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseAgent } from "./baseAgent";
import type { AgentProgressCallback } from "./baseAgent";
import { AgentFactory, createAgent } from "./agentFactory";
import type { ExecutionTask } from "../../intelligence/types";
import type {
  AgentOutput,
  ContextSubset,
} from "../../orchestration/contextCoordinator";
import type {
  SessionStatus,
  ILanguageModelProvider,
  ILanguageModel,
  ILanguageModelMessage,
  ILanguageModelResponse,
  ICancellationToken,
  IEventEmitterFactory,
  IEventEmitter,
  ICancellationTokenSourceFactory,
} from "../../orchestration/types";
import { SessionManager } from "../../orchestration/sessionManager";
import type { AgentExecutionError, AgentExecutionProgress } from "./types";

// ---------------------------------------------------------------------------
// Concrete TestAgent subclass for testing BaseAgent in isolation
// ---------------------------------------------------------------------------

class TestAgent extends BaseAgent {
  public testBuildContextBlock(context: ContextSubset): string {
    return this.buildContextBlock(context);
  }
  public testExtractDeclarations(output: string) {
    return this.extractDeclarations(output);
  }
  public testBuildSectionSeparator(label: string): string {
    return this.buildSectionSeparator(label);
  }

  protected buildPrompt(task: ExecutionTask, context: ContextSubset): string {
    return `TEST:${task.prompt}:${context.summary}`;
  }

  protected parseOutput(
    taskId: string,
    sessionStatus: SessionStatus
  ): AgentOutput {
    return {
      taskId,
      agent: this.role,
      output: sessionStatus.output,
    };
  }
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: "task-1",
    label: "Test Task",
    prompt: "Build something",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 5,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

function makeContext(
  summary = "No prior context available for this task."
): ContextSubset {
  return {
    taskId: "task-1",
    entries: [],
    domains: ["project"],
    summary,
  };
}

function makeMockEmitter<T>(): IEventEmitter<T> {
  return {
    event: () => ({ dispose: () => {} }),
    fire() {},
    dispose: vi.fn(),
  };
}

function makeMockEmitterFactory(): IEventEmitterFactory {
  return { create: <T>() => makeMockEmitter<T>() };
}

function makeMockCancellationFactory(): ICancellationTokenSourceFactory {
  return {
    create: vi.fn(() => ({
      token: {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose: () => {} }),
      },
      cancel() {},
      dispose() {},
    })),
  };
}

function makeSessionManager(
  chunks: string[] = ["output text"]
): SessionManager {
  const model: ILanguageModel = {
    id: "mock-model",
    vendor: "copilot",
    family: "test",
    name: "Mock",
    maxInputTokens: 4096,
    sendRequest: vi.fn(
      async (
        _messages: readonly ILanguageModelMessage[],
        _options: Record<string, unknown>,
        _token: ICancellationToken
      ): Promise<ILanguageModelResponse> => ({
        text: (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      })
    ),
  };
  const lmProvider: ILanguageModelProvider = {
    selectModels: vi.fn(async () => [model]),
  };
  return new SessionManager(
    lmProvider,
    makeMockEmitterFactory(),
    makeMockCancellationFactory()
  );
}

function makeCapturingSessionManager(): {
  sessionManager: SessionManager;
  capturedPrompts: string[];
} {
  const capturedPrompts: string[] = [];
  const model: ILanguageModel = {
    id: "capture-model",
    vendor: "copilot",
    family: "test",
    name: "Capture",
    maxInputTokens: 4096,
    sendRequest: vi.fn(
      async (
        messages: readonly ILanguageModelMessage[]
      ): Promise<ILanguageModelResponse> => {
        capturedPrompts.push(messages[0]!.content);
        return {
          text: (async function* () {
            yield "done";
          })(),
        };
      }
    ),
  };
  const lmProvider: ILanguageModelProvider = {
    selectModels: vi.fn(async () => [model]),
  };
  const sessionManager = new SessionManager(
    lmProvider,
    makeMockEmitterFactory(),
    makeMockCancellationFactory()
  );
  return { sessionManager, capturedPrompts };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("BaseAgent", () => {
  let sessionManager: SessionManager;
  let agent: TestAgent;

  beforeEach(() => {
    sessionManager = makeSessionManager();
    agent = new TestAgent("claude", sessionManager);
  });

  // -------------------------------------------------------------------------
  // execute() — happy path
  // -------------------------------------------------------------------------

  describe("execute", () => {
    it("returns AgentExecutionResult with correct taskId and agent", async () => {
      const result = await agent.execute(makeTask(), makeContext());
      expect(result.output.taskId).toBe("task-1");
      expect(result.output.agent).toBe("claude");
    });

    it("sessionStatus.state is completed on success", async () => {
      const result = await agent.execute(makeTask(), makeContext());
      expect(result.sessionStatus.state).toBe("completed");
    });

    it("passes enriched prompt (not original) to session", async () => {
      const { sessionManager: sm, capturedPrompts } =
        makeCapturingSessionManager();
      const spyAgent = new TestAgent("claude", sm);
      const task = makeTask({ prompt: "original-prompt" });
      const context = makeContext("context-summary");

      await spyAgent.execute(task, context);

      // TestAgent.buildPrompt returns "TEST:original-prompt:context-summary"
      expect(capturedPrompts[0]).toBe("TEST:original-prompt:context-summary");
    });

    it("emits progress events through all stages", async () => {
      const events: AgentExecutionProgress[] = [];
      const onProgress: AgentProgressCallback = (e) => events.push(e);

      await agent.execute(makeTask(), makeContext(), onProgress);

      const stages = events.map((e) => e.stage);
      expect(stages).toContain("context-enrichment");
      expect(stages).toContain("session-created");
      expect(stages).toContain("streaming");
      expect(stages).toContain("post-processing");
      expect(stages).toContain("completed");
    });

    it("works without progress callback", async () => {
      const result = await agent.execute(makeTask(), makeContext());
      expect(result.output.taskId).toBe("task-1");
    });

    it("output contains the model's streamed text", async () => {
      const sm = makeSessionManager(["hello ", "world"]);
      const a = new TestAgent("claude", sm);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.output).toBe("hello world");
    });
  });

  // -------------------------------------------------------------------------
  // execute() — error paths
  // -------------------------------------------------------------------------

  describe("execute — errors", () => {
    it("throws session-failed when model throws", async () => {
      const failModel: ILanguageModel = {
        id: "fail",
        vendor: "copilot",
        family: "test",
        name: "Fail",
        maxInputTokens: 4096,
        sendRequest: vi.fn(async () => {
          throw { code: "off_topic", message: "rejected" };
        }),
      };
      const lmProvider: ILanguageModelProvider = {
        selectModels: vi.fn(async () => [failModel]),
      };
      const sm = new SessionManager(
        lmProvider,
        makeMockEmitterFactory(),
        makeMockCancellationFactory()
      );
      const a = new TestAgent("claude", sm);

      try {
        await a.execute(makeTask(), makeContext());
        expect.unreachable("should have thrown");
      } catch (e) {
        const err = e as AgentExecutionError;
        expect(err.code).toBe("session-failed");
        expect(err.agent).toBe("claude");
        expect(err.taskId).toBe("task-1");
        expect(err.sessionStatus).not.toBeNull();
      }
    });

    it("throws empty-output when model returns only whitespace", async () => {
      const sm = makeSessionManager(["   ", "\n"]);
      const a = new TestAgent("claude", sm);

      try {
        await a.execute(makeTask(), makeContext());
        expect.unreachable("should have thrown");
      } catch (e) {
        const err = e as AgentExecutionError;
        expect(err.code).toBe("empty-output");
      }
    });
  });

  // -------------------------------------------------------------------------
  // buildContextBlock
  // -------------------------------------------------------------------------

  describe("buildContextBlock", () => {
    it("returns empty string for default no-context message", () => {
      const ctx = makeContext("No prior context available for this task.");
      expect(agent.testBuildContextBlock(ctx)).toBe("");
    });

    it("returns empty string when entries is empty", () => {
      const ctx = makeContext("Some summary");
      // entries is [] — the method checks entries.length
      expect(agent.testBuildContextBlock(ctx)).toBe("");
    });

    it("returns markdown block with summary when entries exist", () => {
      const ctx: ContextSubset = {
        taskId: "t",
        entries: [
          {
            id: "e1",
            domain: "project",
            key: "framework",
            value: "Next.js",
            source: "system",
            taskId: null,
            createdAt: "",
            updatedAt: "",
            superseded: false,
            supersededBy: null,
            version: 1,
          },
        ],
        domains: ["project"],
        summary: "## Project\n  - framework: Next.js",
      };
      const block = agent.testBuildContextBlock(ctx);
      expect(block).toContain("## Shared Project Context");
      expect(block).toContain("Next.js");
    });
  });

  // -------------------------------------------------------------------------
  // extractDeclarations
  // -------------------------------------------------------------------------

  describe("extractDeclarations", () => {
    it("returns empty array when no DECLARATIONS block present", () => {
      expect(
        agent.testExtractDeclarations("Some output without declarations.")
      ).toHaveLength(0);
    });

    it("parses valid declarations from HTML comment block", () => {
      const output = `Response text\n\n<!-- DECLARATIONS\ndesign:arch-pattern:feature-based folders\napi:user-endpoint:GET /api/users\n-->`;
      const result = agent.testExtractDeclarations(output);
      expect(result).toHaveLength(2);
      expect(result[0]!.domain).toBe("design");
      expect(result[0]!.key).toBe("arch-pattern");
      expect(result[0]!.value).toBe("feature-based folders");
      expect(result[1]!.domain).toBe("api");
      expect(result[1]!.key).toBe("user-endpoint");
      expect(result[1]!.value).toBe("GET /api/users");
    });

    it("skips malformed lines (missing second colon)", () => {
      const output = `<!-- DECLARATIONS\ngood:key:value\nbad-no-colon\nonly:one-colon\n-->`;
      const result = agent.testExtractDeclarations(output);
      expect(result).toHaveLength(1);
      expect(result[0]!.key).toBe("key");
    });

    it("ignores empty lines within the block", () => {
      const output = `<!-- DECLARATIONS\n\ndesign:pattern:CQRS\n\n-->`;
      const result = agent.testExtractDeclarations(output);
      expect(result).toHaveLength(1);
    });

    it("handles values containing colons", () => {
      const output = `<!-- DECLARATIONS\napi:endpoint:GET /api/users:id\n-->`;
      const result = agent.testExtractDeclarations(output);
      expect(result).toHaveLength(1);
      expect(result[0]!.value).toBe("GET /api/users:id");
    });
  });

  // -------------------------------------------------------------------------
  // buildSectionSeparator
  // -------------------------------------------------------------------------

  describe("buildSectionSeparator", () => {
    it("returns markdown separator with label", () => {
      const sep = agent.testBuildSectionSeparator("My Section");
      expect(sep).toContain("---");
      expect(sep).toContain("## My Section");
    });
  });
});

// ===========================================================================
// AgentFactory tests
// ===========================================================================

describe("AgentFactory", () => {
  let sessionManager: SessionManager;
  let factory: AgentFactory;

  beforeEach(() => {
    sessionManager = makeSessionManager();
    factory = new AgentFactory(sessionManager);
  });

  it("creates an agent for claude role", () => {
    expect(factory.create("claude")).toBeDefined();
  });

  it("creates an agent for copilot role", () => {
    expect(factory.create("copilot")).toBeDefined();
  });

  it("creates an agent for codex role", () => {
    expect(factory.create("codex")).toBeDefined();
  });

  it("creates new instance per call (not singleton)", () => {
    const a1 = factory.create("claude");
    const a2 = factory.create("claude");
    expect(a1).not.toBe(a2);
  });

  it("createAgent convenience function works", () => {
    const agent = createAgent("copilot", sessionManager);
    expect(agent).toBeDefined();
  });

  it("all three agents can execute successfully", async () => {
    for (const role of ["claude", "copilot", "codex"] as const) {
      const agent = factory.create(role);
      const result = await agent.execute(makeTask({ agent: role }), makeContext());
      expect(result.output.agent).toBe(role);
    }
  });
});
