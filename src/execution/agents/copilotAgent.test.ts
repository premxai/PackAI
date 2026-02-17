import { describe, it, expect, beforeEach, vi } from "vitest";
import { CopilotAgent } from "./copilotAgent";
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

class TestableCopilotAgent extends CopilotAgent {
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
    id: "copilot-task-1",
    label: "Create ProductCard component",
    prompt: "Build a ProductCard component with image, title, price",
    agent: "copilot",
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
    taskId: "copilot-task-1",
    entries,
    domains: ["project", "frontend"],
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
  responseChunks: string[] = ["export function ProductCard() { ... }"]
): {
  sessionManager: SessionManager;
  capturedPrompts: string[];
} {
  const capturedPrompts: string[] = [];
  const model: ILanguageModel = {
    id: "copilot-model",
    vendor: "copilot",
    family: "gpt-4o",
    name: "Copilot",
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

describe("CopilotAgent", () => {
  let agent: TestableCopilotAgent;

  beforeEach(() => {
    const { sessionManager } = makeCapturingSessionManager();
    agent = new TestableCopilotAgent(sessionManager);
  });

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  describe("buildPrompt", () => {
    it("includes the frontend developer preamble", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("frontend developer");
    });

    it("includes the task label and original prompt", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("Create ProductCard component");
      expect(prompt).toContain("image, title, price");
    });

    it("includes DECLARATIONS output instructions", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("DECLARATIONS");
      expect(prompt).toContain("frontend:component-name");
    });

    it("includes code quality reminders", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).toContain("TypeScript strict mode");
      expect(prompt).toContain("readonly");
    });

    it("injects stack guidance when framework entry exists", () => {
      const entries: ContextSubset["entries"] = [
        {
          id: "e1",
          domain: "project",
          key: "framework",
          value: "Next.js 14",
          source: "system",
          taskId: null,
          createdAt: "",
          updatedAt: "",
          superseded: false,
          supersededBy: null,
          version: 1,
        },
        {
          id: "e2",
          domain: "frontend",
          key: "component-lib",
          value: "shadcn/ui",
          source: "system",
          taskId: null,
          createdAt: "",
          updatedAt: "",
          superseded: false,
          supersededBy: null,
          version: 1,
        },
      ];
      const context = makeContext("Summary with entries", entries);
      const prompt = agent.testBuildPrompt(makeTask(), context);
      expect(prompt).toContain("Framework: Next.js 14");
      expect(prompt).toContain("Component library: shadcn/ui");
    });

    it("omits stack guidance when no relevant entries", () => {
      const prompt = agent.testBuildPrompt(makeTask(), makeContext());
      expect(prompt).not.toContain("Tech Stack Requirements");
    });

    it("includes styling entry in stack guidance", () => {
      const entries: ContextSubset["entries"] = [
        {
          id: "e1",
          domain: "project",
          key: "styling",
          value: "Tailwind CSS v3",
          source: "system",
          taskId: null,
          createdAt: "",
          updatedAt: "",
          superseded: false,
          supersededBy: null,
          version: 1,
        },
      ];
      const context = makeContext("Summary", entries);
      const prompt = agent.testBuildPrompt(makeTask(), context);
      expect(prompt).toContain("Styling: Tailwind CSS v3");
    });
  });

  // -------------------------------------------------------------------------
  // Execute
  // -------------------------------------------------------------------------

  describe("execute", () => {
    it("output.agent is 'copilot'", async () => {
      const { sessionManager } = makeCapturingSessionManager();
      const a = new CopilotAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.agent).toBe("copilot");
    });

    it("parses component declarations from output", async () => {
      const { sessionManager } = makeCapturingSessionManager([
        "export function ProductCard() { ... }\n",
        "<!-- DECLARATIONS\nfrontend:component-name:ProductCard in src/components/ProductCard.tsx\n-->",
      ]);
      const a = new CopilotAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());

      expect(result.output.declarations).toHaveLength(1);
      expect(result.output.declarations![0]!.domain).toBe("frontend");
      expect(result.output.declarations![0]!.key).toBe("component-name");
    });

    it("returns undefined declarations when none emitted", async () => {
      const { sessionManager } = makeCapturingSessionManager([
        "Just some code output.",
      ]);
      const a = new CopilotAgent(sessionManager);

      const result = await a.execute(makeTask(), makeContext());
      expect(result.output.declarations).toBeUndefined();
    });
  });
});
