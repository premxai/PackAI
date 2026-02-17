import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AgentFallbackCoordinator,
  RateLimitQueue,
  ExecutionStateManager,
} from "./errorRecovery";
import {
  AllAgentsExhaustedError,
  AgentFailureError,
  RateLimitError,
  StatePersistenceError,
} from "./errors";
import type { AgentRole, ExecutionPlan, ExecutionTask } from "../intelligence/types";
import type { AgentFactory } from "../execution/agents/agentFactory";
import type {
  AgentExecutionResult,
  AgentExecutionError,
} from "../execution/agents/types";
import type { IStateStore } from "./errorRecovery";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
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

function makeResult(overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    output: {
      taskId: "task-1",
      agent: "claude",
      content: "output",
      declarations: [],
      timestamp: Date.now(),
    },
    sessionStatus: {
      sessionId: "s1",
      agent: "claude",
      taskId: "task-1",
      state: "completed",
      progress: null,
      createdAt: 0,
      startedAt: 0,
      completedAt: 0,
      error: null,
      retryCount: 0,
      output: "output",
    },
    ...overrides,
  };
}

function makeAgentError(
  code: AgentExecutionError["code"] = "session-failed",
  agent: AgentRole = "claude"
): AgentExecutionError {
  return {
    code,
    message: "Test failure",
    taskId: "task-1",
    agent,
    sessionStatus: null,
  };
}

function makeMockFactory(
  behavior: Record<AgentRole, "success" | "fail" | "cancel">
): AgentFactory {
  return {
    create(role: AgentRole) {
      return {
        execute: vi.fn(async () => {
          const b = behavior[role];
          if (b === "success") return makeResult({ output: { ...makeResult().output, agent: role } });
          if (b === "cancel") throw makeAgentError("session-cancelled", role);
          throw makeAgentError("session-failed", role);
        }),
      } as unknown as ReturnType<AgentFactory["create"]>;
    },
  } as unknown as AgentFactory;
}

function makeStateStore(): IStateStore & {
  data: Map<string, unknown>;
  saveFn: ReturnType<typeof vi.fn>;
  loadFn: ReturnType<typeof vi.fn>;
  deleteFn: ReturnType<typeof vi.fn>;
} {
  const data = new Map<string, unknown>();
  const saveFn = vi.fn(async (key: string, state: unknown) => { data.set(key, state); });
  const loadFn = vi.fn(async <T>(key: string): Promise<T | null> => {
    return (data.get(key) as T) ?? null;
  });
  const deleteFn = vi.fn(async (key: string) => { data.delete(key); });

  return {
    data,
    saveFn,
    loadFn,
    deleteFn,
    save: saveFn,
    load: loadFn,
    delete: deleteFn,
  };
}

// ---------------------------------------------------------------------------
// AgentFallbackCoordinator
// ---------------------------------------------------------------------------

describe("AgentFallbackCoordinator", () => {
  it("succeeds on first agent", async () => {
    const factory = makeMockFactory({
      claude: "success",
      copilot: "success",
      codex: "success",
    });
    const coordinator = new AgentFallbackCoordinator(factory);

    const result = await coordinator.executeWithFallback(
      makeTask(),
      { entries: [], summary: "" },
      "claude"
    );
    expect(result.output.agent).toBe("claude");
  });

  it("falls back to second agent on failure", async () => {
    const factory = makeMockFactory({
      claude: "fail",
      copilot: "success",
      codex: "success",
    });
    const coordinator = new AgentFallbackCoordinator(factory);

    const result = await coordinator.executeWithFallback(
      makeTask(),
      { entries: [], summary: "" },
      "claude"
    );
    expect(result.output.agent).toBe("copilot");
  });

  it("falls back to third agent when second also fails", async () => {
    const factory = makeMockFactory({
      claude: "fail",
      copilot: "fail",
      codex: "success",
    });
    const coordinator = new AgentFallbackCoordinator(factory);

    const result = await coordinator.executeWithFallback(
      makeTask(),
      { entries: [], summary: "" },
      "claude"
    );
    expect(result.output.agent).toBe("codex");
  });

  it("throws AllAgentsExhaustedError when all agents fail", async () => {
    const factory = makeMockFactory({
      claude: "fail",
      copilot: "fail",
      codex: "fail",
    });
    const coordinator = new AgentFallbackCoordinator(factory);

    await expect(
      coordinator.executeWithFallback(
        makeTask(),
        { entries: [], summary: "" },
        "claude"
      )
    ).rejects.toBeInstanceOf(AllAgentsExhaustedError);
  });

  it("does NOT retry on session-cancelled", async () => {
    const factory = makeMockFactory({
      claude: "cancel",
      copilot: "success",
      codex: "success",
    });
    const coordinator = new AgentFallbackCoordinator(factory);

    await expect(
      coordinator.executeWithFallback(
        makeTask(),
        { entries: [], summary: "" },
        "claude"
      )
    ).rejects.toBeInstanceOf(AgentFailureError);
  });

  it("respects maxFallbackAttempts config", async () => {
    const factory = makeMockFactory({
      claude: "fail",
      copilot: "fail",
      codex: "success",
    });
    const coordinator = new AgentFallbackCoordinator(factory, {
      maxFallbackAttempts: 1,
    });

    // Only 1 fallback allowed: claude fails, copilot fails → exhausted
    await expect(
      coordinator.executeWithFallback(
        makeTask(),
        { entries: [], summary: "" },
        "claude"
      )
    ).rejects.toBeInstanceOf(AllAgentsExhaustedError);
  });

  it("uses custom fallback order", async () => {
    const factory = makeMockFactory({
      claude: "fail",
      copilot: "fail",
      codex: "success",
    });
    const coordinator = new AgentFallbackCoordinator(factory, {
      fallbackOrder: ["codex", "copilot", "claude"],
    });

    // Primary is "claude" which fails, then codex (from custom order) succeeds
    const result = await coordinator.executeWithFallback(
      makeTask(),
      { entries: [], summary: "" },
      "claude"
    );
    expect(result.output.agent).toBe("codex");
  });
});

// ---------------------------------------------------------------------------
// RateLimitQueue
// ---------------------------------------------------------------------------

describe("RateLimitQueue", () => {
  it("enqueues and resolves requests", async () => {
    vi.useFakeTimers();
    const queue = new RateLimitQueue({ drainIntervalMs: 100 });

    const promise = queue.enqueue("t1", async () => makeResult());
    expect(queue.getQueueDepth()).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result.sessionStatus.state).toBe("completed");

    queue.dispose();
    vi.useRealTimers();
  });

  it("throws RateLimitError when queue is full", async () => {
    const queue = new RateLimitQueue({ maxSize: 1 });
    // First enqueue succeeds — capture promise so dispose rejection is caught
    const p1 = queue.enqueue("t1", async () => makeResult());
    // Second enqueue should throw
    expect(() =>
      queue.enqueue("t2", async () => makeResult())
    ).toThrow(RateLimitError);

    queue.dispose();
    await expect(p1).rejects.toBeInstanceOf(RateLimitError);
  });

  it("drains in FIFO order", async () => {
    vi.useFakeTimers();
    const results: string[] = [];
    const queue = new RateLimitQueue({ drainIntervalMs: 50 });

    const p1 = queue.enqueue("t1", async () => {
      results.push("first");
      return makeResult();
    });
    const p2 = queue.enqueue("t2", async () => {
      results.push("second");
      return makeResult();
    });

    await vi.advanceTimersByTimeAsync(50);
    await p1;
    await vi.advanceTimersByTimeAsync(50);
    await p2;

    expect(results).toEqual(["first", "second"]);

    queue.dispose();
    vi.useRealTimers();
  });

  it("rejects queued requests on dispose", async () => {
    const queue = new RateLimitQueue();
    const promise = queue.enqueue("t1", async () => makeResult());
    queue.dispose();

    await expect(promise).rejects.toBeInstanceOf(RateLimitError);
  });
});

// ---------------------------------------------------------------------------
// ExecutionStateManager
// ---------------------------------------------------------------------------

describe("ExecutionStateManager", () => {
  let store: ReturnType<typeof makeStateStore>;
  let manager: ExecutionStateManager;

  const dummyPlan = { templateName: "test" } as unknown as ExecutionPlan;

  beforeEach(() => {
    store = makeStateStore();
    manager = new ExecutionStateManager(store);
  });

  it("checkpoint saves plan via store", async () => {
    await manager.checkpoint("plan-1", dummyPlan);
    expect(store.saveFn).toHaveBeenCalledWith("plan-plan-1", dummyPlan);
  });

  it("loadCheckpoint returns saved plan", async () => {
    await manager.checkpoint("plan-1", dummyPlan);
    const loaded = await manager.loadCheckpoint("plan-1");
    expect(loaded).toEqual(dummyPlan);
  });

  it("loadCheckpoint returns null when nothing saved", async () => {
    const loaded = await manager.loadCheckpoint("nonexistent");
    expect(loaded).toBeNull();
  });

  it("clearCheckpoint removes entry", async () => {
    await manager.checkpoint("plan-1", dummyPlan);
    await manager.clearCheckpoint("plan-1");
    const loaded = await manager.loadCheckpoint("plan-1");
    expect(loaded).toBeNull();
  });

  it("throws StatePersistenceError on save failure", async () => {
    const failStore: IStateStore = {
      save: vi.fn(async () => { throw new Error("disk full"); }),
      load: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
    };
    const failManager = new ExecutionStateManager(failStore);

    await expect(failManager.checkpoint("p", dummyPlan)).rejects.toBeInstanceOf(
      StatePersistenceError
    );
  });

  it("throws StatePersistenceError on load failure", async () => {
    const failStore: IStateStore = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => { throw new Error("corrupt"); }),
      delete: vi.fn(async () => {}),
    };
    const failManager = new ExecutionStateManager(failStore);

    await expect(failManager.loadCheckpoint("p")).rejects.toBeInstanceOf(
      StatePersistenceError
    );
  });

  it("autosave fires at interval", async () => {
    vi.useFakeTimers();
    const getPlan = vi.fn(() => dummyPlan);
    manager = new ExecutionStateManager(store, 100);

    manager.startAutosave("auto-plan", getPlan);
    await vi.advanceTimersByTimeAsync(350);

    // Should have saved 3 times (at 100, 200, 300)
    expect(store.saveFn).toHaveBeenCalledTimes(3);

    manager.dispose();
    vi.useRealTimers();
  });

  it("stopAutosave stops the timer", async () => {
    vi.useFakeTimers();
    const getPlan = vi.fn(() => dummyPlan);
    manager = new ExecutionStateManager(store, 100);

    manager.startAutosave("auto-plan", getPlan);
    await vi.advanceTimersByTimeAsync(150);
    expect(store.saveFn).toHaveBeenCalledTimes(1);

    manager.stopAutosave();
    await vi.advanceTimersByTimeAsync(200);
    // No additional saves after stop
    expect(store.saveFn).toHaveBeenCalledTimes(1);

    manager.dispose();
    vi.useRealTimers();
  });
});
