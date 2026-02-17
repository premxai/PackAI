import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClaudeAgent } from "./claudeAgent";
import type { ExecutionTask } from "../../intelligence/types";
import type { ContextSubset } from "../../orchestration/contextCoordinator";
import type {
  ILanguageModelProvider,
  ILanguageModel,
  ILanguageModelMessage,
  ILanguageModelResponse,
  IEventEmitterFactory,
  IEventEmitter,
  ICancellationTokenSourceFactory,
} from "../../orchestration/types";
import { SessionManager } from "../../orchestration/sessionManager";

// ---------------------------------------------------------------------------
// Testable subclass to expose protected buildPrompt
// ---------------------------------------------------------------------------

class TestableClaudeAgent extends ClaudeAgent {
  public testBuildPrompt(
    task: ExecutionTask,
    context: ContextSubset
  ): string {
    return this.buildPrompt(task, context);
  }
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: "claude-task-1",
    label: "Design the database schema",
    prompt: "Design a normalized schema for users and products",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 15,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

function makeContext(
  summary = "No prior context available for this task."
): ContextSubset {
  return {
    taskId: "claude-task-1",
    entries: [],
    domains: ["project", "design"],
    summary,
  };
}

function makeMockEmitterFactory(): IEventEmitterFactory {
  return {
    create: <T>(): IEventEmitter<T> => ({
      event: () => ({ dispose: () => {} }),
      fire() {},
      dispose: vi.fn(),
    }),
  };
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

function makeCapturingSessionManager(
  responseChunks: string[] = ["Architecture decision made."]
): {
  sessionManager: SessionManager;
  capturedPrompts: string[];
} {
  const capturedPrompts: string[] = [];
  const model: ILanguageModel = {
    id: "claude-model",
    vendor: "copilot",
    family: "claude-sonnet-4.5",
    name: "Claude",
    maxInputTokens: 100000,
    sendRequest: vi.fn(
      async (
        messages: readonly ILanguageModelMessage[]
      ): Promise<ILanguageModelResponse> => {
        capturedPrompts.push(messages[0]!.content);
        return {
          text: (async function* () {
            for (const c of responseChunks) yield c;
          })(),
        };
      }
    ),
  };
  const lmProvider: ILanguageModelProvider = {
    selectModels: vi.fn(async () => [model]),
  };
  return {
    sessionManager: new SessionManager(
      lmProvider,
      makeMockEmitterFactory(),
      makeMockCancellationFactory()
    ),
    capturedPrompts,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("ClaudeAgent", () => {
  let agent: TestableClaudeAgent;

  beforeEach(() => {
    const { sessionManager } = makeCapturingSessionManager();
    agent = new TestableClaudeAgent(sessionManager);
  });

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  describe("buildPrompt", () => {
    it("includes the architectural preamble", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("software architect");
    });

    it("includes the task label and original prompt", () => {
      const task = makeTask({
        label: "Design auth flow",
        prompt: "Create JWT auth",
      });
      const prompt = agent.testBuildPrompt(task, makeContext());
      expect(prompt).toContain("Design auth flow");
      expect(prompt).toContain("Create JWT auth");
    });

    it("includes chain-of-thought scaffold", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("structure your response");
    });

    it("includes DECLARATIONS output instructions", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("DECLARATIONS");
    });

    it("injects context summary when context has entries", () => {
      const context: ContextSubset = {
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
      const prompt = agent.testBuildPrompt(makeTask(), context);
      expect(prompt).toContain("Shared Project Context");
      expect(prompt).toContain("Next.js");
    });

    it("omits context block when no entries", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).not.toContain("## Shared Project Context");
    });

    it("uses review scaffold for review tasks", () => {
      const task = makeTask({ label: "Review the API design" });
      const prompt = agent.testBuildPrompt(task, makeContext());
      expect(prompt).toContain("Current State Analysis");
      expect(prompt).toContain("Issues & Risks");
    });

    it("uses design scaffold for design tasks", () => {
      const task = makeTask({ label: "Design the authentication system" });
      const prompt = agent.testBuildPrompt(task, makeContext());
      expect(prompt).toContain("Design Options");
      expect(prompt).toContain("Recommended Design");
    });

    it("uses default scaffold for generic tasks", () => {
      const task = makeTask({ label: "Set up the project structure" });
      const prompt = agent.testBuildPrompt(task, makeContext());
      expect(prompt).toContain("Notes for other agents");
    });
  });

  // -------------------------------------------------------------------------
  // Execute with declarations
  // -------------------------------------------------------------------------

  describe("execute", () => {
    it("parses declarations from Claude output", async () => {
      const { sessionManager } = makeCapturingSessionManager([
        "I recommend feature-based folders.\n\n",
        "<!-- DECLARATIONS\ndesign:folder-structure:feature-based\n-->",
      ]);
      const a = new ClaudeAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());

      expect(result.output.declarations).toHaveLength(1);
      expect(result.output.declarations![0]!.domain).toBe("design");
      expect(result.output.declarations![0]!.key).toBe("folder-structure");
      expect(result.output.declarations![0]!.value).toBe("feature-based");
    });

    it("returns undefined declarations when none emitted", async () => {
      const { sessionManager } = makeCapturingSessionManager([
        "No declarations here.",
      ]);
      const a = new ClaudeAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.declarations).toBeUndefined();
    });

    it("output.agent is 'claude'", async () => {
      const { sessionManager } = makeCapturingSessionManager();
      const a = new ClaudeAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.agent).toBe("claude");
    });

    it("enriched prompt is sent to model, not original", async () => {
      const { sessionManager, capturedPrompts } =
        makeCapturingSessionManager();
      const a = new TestableClaudeAgent(sessionManager);

      await a.execute(
        makeTask({ prompt: "ORIGINAL_PROMPT" }),
        makeContext()
      );

      expect(capturedPrompts[0]).toContain("ORIGINAL_PROMPT");
      expect(capturedPrompts[0]).toContain("software architect");
    });
  });
});
