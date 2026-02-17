import { describe, it, expect, beforeEach, vi } from "vitest";
import { CodexAgent } from "./codexAgent";
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
// Testable subclass
// ---------------------------------------------------------------------------

class TestableCodexAgent extends CodexAgent {
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
    id: "codex-task-1",
    label: "Write unit tests for UserService",
    prompt: "Write comprehensive tests for the UserService class",
    agent: "codex",
    dependsOn: [],
    estimatedMinutes: 10,
    parallelizable: true,
    status: "pending",
    ...overrides,
  };
}

function makeContext(
  summary = "No prior context available for this task.",
  entries: ContextSubset["entries"] = []
): ContextSubset {
  return {
    taskId: "codex-task-1",
    entries,
    domains: ["project", "testing"],
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
  responseChunks: string[] = ["describe('UserService', () => { ... })"]
): {
  sessionManager: SessionManager;
  capturedPrompts: string[];
} {
  const capturedPrompts: string[] = [];
  const model: ILanguageModel = {
    id: "codex-model",
    vendor: "copilot",
    family: "o3-mini",
    name: "Codex",
    maxInputTokens: 8192,
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

describe("CodexAgent", () => {
  let agent: TestableCodexAgent;

  beforeEach(() => {
    const { sessionManager } = makeCapturingSessionManager();
    agent = new TestableCodexAgent(sessionManager);
  });

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  describe("buildPrompt", () => {
    it("includes the testing persona preamble", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("testing");
      expect(prompt).toContain("async patterns");
    });

    it("includes the task label and original prompt", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("Write unit tests for UserService");
      expect(prompt).toContain("comprehensive tests");
    });

    it("includes DECLARATIONS output instructions", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("DECLARATIONS");
      expect(prompt).toContain("testing:test-file");
    });

    it("includes unit test coverage requirements for generic tasks", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("Test each function/component in isolation");
      expect(prompt).toContain("factory helpers");
    });

    it("includes e2e coverage requirements when task mentions e2e", () => {
      const task = makeTask({
        label: "Write e2e tests for checkout",
        prompt: "Create end-to-end tests for the checkout flow",
      });
      const prompt = agent.testBuildPrompt(task, makeContext());
      expect(prompt).toContain("complete user journey");
      expect(prompt).toContain("Mock external services");
    });

    it("includes integration coverage requirements when task mentions api", () => {
      const task = makeTask({
        label: "Write API integration tests",
        prompt: "Test the user API endpoints",
      });
      const prompt = agent.testBuildPrompt(task, makeContext());
      expect(prompt).toContain("endpoint");
      expect(prompt).toContain("error responses");
    });

    it("injects test framework from context when entry exists", () => {
      const entries: ContextSubset["entries"] = [
        {
          id: "e1",
          domain: "testing",
          key: "test-framework",
          value: "Vitest + React Testing Library",
          source: "system",
          taskId: null,
          createdAt: "",
          updatedAt: "",
          superseded: false,
          supersededBy: null,
          version: 1,
        },
      ];
      const context = makeContext("Summary with test framework", entries);
      const prompt = agent.testBuildPrompt(makeTask(), context);
      expect(prompt).toContain("Vitest + React Testing Library");
      expect(prompt).toContain("Test Framework");
    });

    it("omits test framework section when no entry exists", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).not.toContain("Test Framework");
    });
  });

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------

  describe("execute", () => {
    it("output.agent is 'codex'", async () => {
      const { sessionManager } = makeCapturingSessionManager();
      const a = new CodexAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.agent).toBe("codex");
    });

    it("parses test declarations from output", async () => {
      const { sessionManager } = makeCapturingSessionManager([
        "describe('UserService', () => { it('works') });\n",
        "<!-- DECLARATIONS\ntesting:test-file:src/tests/UserService.test.ts\ntesting:coverage-target:UserService CRUD operations\n-->",
      ]);
      const a = new CodexAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());

      expect(result.output.declarations).toHaveLength(2);
      expect(result.output.declarations![0]!.domain).toBe("testing");
      expect(result.output.declarations![0]!.key).toBe("test-file");
      expect(result.output.declarations![1]!.key).toBe("coverage-target");
    });

    it("returns undefined declarations when none emitted", async () => {
      const { sessionManager } = makeCapturingSessionManager([
        "Just test code.",
      ]);
      const a = new CodexAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.declarations).toBeUndefined();
    });

    it("enriched prompt contains codex preamble and original prompt", async () => {
      const { sessionManager, capturedPrompts } =
        makeCapturingSessionManager();
      const a = new TestableCodexAgent(sessionManager);

      await a.execute(
        makeTask({ prompt: "TEST_THE_THING" }),
        makeContext()
      );

      expect(capturedPrompts[0]).toContain("TEST_THE_THING");
      expect(capturedPrompts[0]).toContain("testing");
    });
  });
});
