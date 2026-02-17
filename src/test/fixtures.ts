/**
 * Shared test factory helpers.
 *
 * Every factory accepts a Partial<T> override and returns a valid default.
 * Import from here instead of duplicating factories in each test file.
 */

import { vi } from "vitest";
import type {
  ProjectIntent,
  ExecutionTask,
  ExecutionPlan,
  ExecutionPhase,
  AgentRole,
} from "../intelligence/types";
import type {
  SessionStatus,
  SessionProgress,
  ILanguageModelProvider,
  ILanguageModel,
  ILanguageModelMessage,
  ILanguageModelResponse,
  IEventEmitterFactory,
  IEventEmitter,
  ICancellationTokenSourceFactory,
} from "../orchestration/types";
import type {
  AgentOutput,
  ContextEntry,
  ContextSubset,
  ContextDomain,
} from "../orchestration/contextCoordinator";
import type {
  OutputConflict,
  APIContractConflict,
  ResolutionOption,
} from "../orchestration/conflictResolver";
import type {
  AgentExecutionResult,
  AgentExecutionError,
} from "../execution/agents/types";
import type { IStateStore } from "../utils/errorRecovery";
import type { WebFlowSettings } from "../settings/types";
import { SessionManager } from "../orchestration/sessionManager";
import { DEFAULT_SETTINGS } from "../settings/settingsService";
import { analyzeIntent, WorkflowGenerator, AgentSelector } from "../intelligence";

// ---------------------------------------------------------------------------
// Domain object factories
// ---------------------------------------------------------------------------

export function makeIntent(overrides?: Partial<ProjectIntent>): ProjectIntent {
  return {
    projectType: "fullstack",
    projectTypeConfidence: "high",
    features: ["auth"],
    stackHints: [],
    complexity: "moderate",
    rawInput: "test",
    normalizedInput: "test",
    ambiguities: [],
    ...overrides,
  };
}

export function makeTask(overrides?: Partial<ExecutionTask>): ExecutionTask {
  return {
    id: "task-1",
    label: "Test Task",
    prompt: "Do something",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 5,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

export function makePhase(overrides?: Partial<ExecutionPhase>): ExecutionPhase {
  return {
    id: "phase-1",
    label: "Phase 1",
    description: "First phase",
    tasks: [makeTask()],
    status: "pending",
    ...overrides,
  };
}

export function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const phases = overrides?.phases ?? [
    makePhase({
      tasks: [
        makeTask({ id: "t1", label: "Task 1", agent: "claude", status: "completed" }),
        makeTask({ id: "t2", label: "Task 2", agent: "copilot", status: "running" }),
        makeTask({ id: "t3", label: "Task 3", agent: "codex", status: "pending" }),
      ],
      status: "running",
    }),
  ];
  return {
    templateName: "test-template",
    intent: makeIntent(),
    resolvedStack: { framework: "react" },
    phases,
    estimatedTotalMinutes: 15,
    stats: {
      totalTasks: phases.reduce((sum, p) => sum + p.tasks.length, 0),
      tasksByAgent: { claude: 1, copilot: 1, codex: 1 },
      parallelizableTasks: 0,
    },
    ...overrides,
  };
}

export function makeSessionStatus(overrides?: Partial<SessionStatus>): SessionStatus {
  return {
    sessionId: "sess-1",
    agent: "claude",
    taskId: "task-1",
    state: "running",
    progress: null,
    createdAt: 1000,
    startedAt: 2000,
    completedAt: null,
    error: null,
    retryCount: 0,
    output: "",
    ...overrides,
  };
}

export function makeSessionProgress(overrides?: Partial<SessionProgress>): SessionProgress {
  return {
    sessionId: "sess-1",
    percent: 50,
    message: "Halfway done",
    tokensGenerated: 500,
    elapsedMs: 3000,
    ...overrides,
  };
}

export function makeAgentExecutionResult(
  overrides?: Partial<AgentExecutionResult>
): AgentExecutionResult {
  return {
    output: {
      taskId: "task-1",
      agent: "claude",
      output: "Generated output",
      declarations: [],
    },
    sessionStatus: makeSessionStatus({ state: "completed", completedAt: Date.now() }),
    ...overrides,
  };
}

export function makeAgentExecutionError(
  overrides?: Partial<AgentExecutionError>
): AgentExecutionError {
  return {
    code: "session-failed",
    message: "Test failure",
    taskId: "task-1",
    agent: "claude",
    sessionStatus: null,
    ...overrides,
  };
}

export function makeContextEntry(overrides?: Partial<ContextEntry>): ContextEntry {
  return {
    id: "entry-1",
    domain: "project" as ContextDomain,
    key: "framework",
    value: "Next.js",
    source: "claude",
    taskId: "task-1",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    superseded: false,
    supersededBy: null,
    version: 1,
    ...overrides,
  };
}

export function makeContextSubset(overrides?: Partial<ContextSubset>): ContextSubset {
  return {
    taskId: "task-1",
    entries: [],
    domains: ["project"],
    summary: "No prior context available for this task.",
    ...overrides,
  };
}

export function makeOutputConflict(
  overrides?: Partial<APIContractConflict>
): OutputConflict {
  return {
    id: "conflict-1",
    type: "api-contract",
    taskIds: ["t1", "t2"],
    agents: ["claude", "copilot"],
    description: "Both agents defined /api/users with different schemas",
    severity: "high",
    detectedAt: new Date().toISOString(),
    endpoint: "/api/users",
    schemaA: '{ id: number, name: string }',
    schemaB: '{ userId: string, displayName: string }',
    ...overrides,
  } as APIContractConflict;
}

export function makeResolutionOption(
  overrides?: Partial<ResolutionOption>
): ResolutionOption {
  return {
    label: "Use Agent A's version",
    description: "Keep the first schema",
    strategy: "use-a",
    winningTaskId: "t1",
    ...overrides,
  };
}

export function makeSettings(
  overrides?: Partial<WebFlowSettings>
): WebFlowSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    agentPreferences: {
      ...DEFAULT_SETTINGS.agentPreferences,
      ...overrides?.agentPreferences,
    },
    approval: {
      ...DEFAULT_SETTINGS.approval,
      ...overrides?.approval,
    },
    ui: {
      ...DEFAULT_SETTINGS.ui,
      ...overrides?.ui,
    },
    advanced: {
      ...DEFAULT_SETTINGS.advanced,
      ...overrides?.advanced,
    },
  };
}

// ---------------------------------------------------------------------------
// Mock infrastructure helpers
// ---------------------------------------------------------------------------

export function makeMockEmitterFactory(): IEventEmitterFactory {
  return {
    create: <T>(): IEventEmitter<T> => ({
      event: () => ({ dispose: () => {} }),
      fire() {},
      dispose: vi.fn(),
    }),
  };
}

export function makeMockCancellationFactory(): ICancellationTokenSourceFactory {
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

export function makeMockLanguageModelProvider(
  responseChunks: string[] = ["Done."]
): { provider: ILanguageModelProvider; capturedPrompts: string[] } {
  const capturedPrompts: string[] = [];
  const model: ILanguageModel = {
    id: "mock-model",
    vendor: "copilot",
    family: "mock-family",
    name: "Mock Model",
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
  return {
    provider: { selectModels: vi.fn(async () => [model]) },
    capturedPrompts,
  };
}

export function makeMockSessionManager(
  responseChunks: string[] = ["Done."]
): { sessionManager: SessionManager; capturedPrompts: string[] } {
  const { provider, capturedPrompts } = makeMockLanguageModelProvider(responseChunks);
  return {
    sessionManager: new SessionManager(
      provider,
      makeMockEmitterFactory(),
      makeMockCancellationFactory()
    ),
    capturedPrompts,
  };
}

export function makeMockStateStore(): IStateStore & {
  data: Map<string, unknown>;
  saveFn: ReturnType<typeof vi.fn>;
  loadFn: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
} {
  const data = new Map<string, unknown>();
  const saveFn = vi.fn(async (key: string, state: unknown) => {
    data.set(key, state);
  });
  const loadFn = vi.fn(async (key: string) => {
    return data.get(key) ?? null;
  });
  const deleteFn = vi.fn(async (key: string) => {
    data.delete(key);
  });

  return {
    data,
    saveFn,
    loadFn,
    deleteFn,
    save: saveFn,
    load: loadFn as IStateStore["load"],
    delete: deleteFn,
  };
}

// ---------------------------------------------------------------------------
// Scenario builders (for integration tests)
// ---------------------------------------------------------------------------

/** Generate a realistic e-commerce plan via the real intelligence layer. */
export function makeEcommercePlan(): ExecutionPlan {
  const intent = analyzeIntent(
    "Build an e-commerce store with Stripe payments and PostgreSQL database"
  );
  const generator = new WorkflowGenerator();
  const plan = generator.generate(intent);

  // Run agent selection on each task
  const selector = new AgentSelector();
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const rec = selector.recommend(task);
      (task as { agent: AgentRole }).agent = rec.agent;
    }
  }

  return plan;
}

/** Create agent outputs that will cause cross-agent context sharing. */
export function makeMultiAgentResults(): AgentOutput[] {
  return [
    {
      taskId: "init-project",
      agent: "copilot",
      output: "Created Next.js project with TypeScript. Framework: Next.js 14.",
      declarations: [
        { domain: "project" as ContextDomain, key: "framework", value: "Next.js 14" },
        { domain: "project" as ContextDomain, key: "language", value: "TypeScript" },
      ],
    },
    {
      taskId: "setup-database",
      agent: "claude",
      output: "Configured PostgreSQL with Prisma ORM.\nModel User { id Int @id }",
      declarations: [
        { domain: "database" as ContextDomain, key: "orm", value: "Prisma" },
        { domain: "database" as ContextDomain, key: "schema", value: "User { id Int @id }" },
      ],
    },
    {
      taskId: "build-auth",
      agent: "claude",
      output: "Implemented Auth.js with JWT strategy.\nPOST /api/auth/login",
      declarations: [
        { domain: "auth" as ContextDomain, key: "provider", value: "Auth.js" },
        { domain: "api" as ContextDomain, key: "endpoint-auth", value: "POST /api/auth/login" },
      ],
    },
  ];
}
