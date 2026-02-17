import { describe, it, expect, beforeEach, vi } from "vitest";
import { SessionManager } from "./sessionManager";
import type {
  SessionStatus,
  SessionProgress,
  ILanguageModelProvider,
  ILanguageModel,
  ILanguageModelMessage,
  ILanguageModelResponse,
  ICancellationToken,
  ICancellationTokenSource,
  IEventEmitter,
  IEventEmitterFactory,
  ICancellationTokenSourceFactory,
  AgentModelConfig,
} from "./types";
import type { ExecutionTask } from "../intelligence/types";

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
    estimatedMinutes: 10,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

function makeMockModel(chunks: string[] = ["ok"]): ILanguageModel {
  return {
    id: "mock-model",
    vendor: "copilot",
    family: "test",
    name: "Mock Model",
    maxInputTokens: 4096,
    sendRequest: vi.fn(
      async (
        _messages: readonly ILanguageModelMessage[],
        _options: Record<string, unknown>,
        _token: ICancellationToken
      ): Promise<ILanguageModelResponse> => ({
        text: (async function* () {
          for (const c of chunks) yield c;
        })(),
      })
    ),
  };
}

function makeMockLmProvider(
  modelsByVendor: Record<string, ILanguageModel[]> = {}
): ILanguageModelProvider {
  return {
    selectModels: vi.fn(
      async (selector: { vendor: string; family?: string }) => {
        return modelsByVendor[selector.vendor] ?? [];
      }
    ),
  };
}

function makeMockEmitter<T>(): IEventEmitter<T> & { fired: T[] } {
  const fired: T[] = [];
  return {
    fired,
    event: (listener: (e: T) => void) => {
      return { dispose: () => {} };
    },
    fire(data: T) {
      fired.push(data);
    },
    dispose: vi.fn(),
  };
}

function makeMockEmitterFactory(): IEventEmitterFactory & {
  created: IEventEmitter<unknown>[];
} {
  const created: IEventEmitter<unknown>[] = [];
  return {
    created,
    create<T>(): IEventEmitter<T> {
      const emitter = makeMockEmitter<T>();
      created.push(emitter as unknown as IEventEmitter<unknown>);
      return emitter;
    },
  };
}

function makeMockCancellationSource(): ICancellationTokenSource {
  let cancelled = false;
  return {
    token: {
      get isCancellationRequested() { return cancelled; },
      onCancellationRequested(listener: () => void) {
        return { dispose: () => {} };
      },
    },
    cancel() { cancelled = true; },
    dispose() {},
  };
}

function makeMockCancellationFactory(): ICancellationTokenSourceFactory {
  return {
    create: vi.fn(() => makeMockCancellationSource()),
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("SessionManager", () => {
  let lmProvider: ReturnType<typeof makeMockLmProvider>;
  let emitterFactory: ReturnType<typeof makeMockEmitterFactory>;
  let cancellationFactory: ReturnType<typeof makeMockCancellationFactory>;
  let manager: SessionManager;

  beforeEach(() => {
    const model = makeMockModel(["hello"]);
    lmProvider = makeMockLmProvider({ copilot: [model] });
    emitterFactory = makeMockEmitterFactory();
    cancellationFactory = makeMockCancellationFactory();
    manager = new SessionManager(
      lmProvider,
      emitterFactory,
      cancellationFactory
    );
  });

  // -------------------------------------------------------------------------
  // Session creation
  // -------------------------------------------------------------------------

  describe("createSession", () => {
    it("creates a session with correct agent", async () => {
      const session = await manager.createSession("claude", makeTask());
      expect(session.agent).toBe("claude");
    });

    it("creates a session with correct task id", async () => {
      const task = makeTask({ id: "my-task" });
      const session = await manager.createSession("claude", task);
      expect(session.taskId).toBe("my-task");
    });

    it("generates unique session ids", async () => {
      const s1 = await manager.createSession("claude", makeTask());
      const s2 = await manager.createSession("copilot", makeTask());
      expect(s1.id).not.toBe(s2.id);
    });

    it("fires onSessionStarted event", async () => {
      await manager.createSession("claude", makeTask());
      const startedEmitter = emitterFactory.created[0] as ReturnType<
        typeof makeMockEmitter<SessionStatus>
      >;
      expect(startedEmitter.fired.length).toBe(1);
    });

    it("throws when no model available", async () => {
      const emptyProvider = makeMockLmProvider({ copilot: [] });
      const mgr = new SessionManager(
        emptyProvider,
        emitterFactory,
        cancellationFactory
      );
      await expect(mgr.createSession("claude", makeTask())).rejects.toThrow(
        /No language model available/
      );
    });

    it("selects model with correct vendor", async () => {
      await manager.createSession("claude", makeTask());
      expect(lmProvider.selectModels).toHaveBeenCalledWith(
        expect.objectContaining({ vendor: "copilot" })
      );
    });

    it("supports custom agent model config", async () => {
      const customConfig: AgentModelConfig = {
        claude: { vendor: "anthropic" },
        copilot: { vendor: "github" },
        codex: { vendor: "openai" },
      };
      const model = makeMockModel();
      const customProvider = makeMockLmProvider({ anthropic: [model] });
      const mgr = new SessionManager(
        customProvider,
        emitterFactory,
        cancellationFactory,
        customConfig
      );

      await mgr.createSession("claude", makeTask());
      expect(customProvider.selectModels).toHaveBeenCalledWith(
        expect.objectContaining({ vendor: "anthropic" })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Session status
  // -------------------------------------------------------------------------

  describe("getSessionStatus", () => {
    it("returns session status", async () => {
      const session = await manager.createSession("claude", makeTask());
      const status = manager.getSessionStatus(session.id);
      expect(status.sessionId).toBe(session.id);
      expect(status.state).toBe("pending");
    });

    it("throws for unknown session id", () => {
      expect(() => manager.getSessionStatus("nonexistent")).toThrow(
        /Session not found/
      );
    });
  });

  // -------------------------------------------------------------------------
  // Pause / Resume / Cancel
  // -------------------------------------------------------------------------

  describe("pauseSession", () => {
    it("delegates to session.pause()", async () => {
      const session = await manager.createSession("claude", makeTask());
      // Manually set to running to allow pause
      (session as unknown as { _state: string })._state = "running";

      await manager.pauseSession(session.id);
      expect(session.state).toBe("paused");
    });

    it("throws for unknown session", async () => {
      await expect(manager.pauseSession("nonexistent")).rejects.toThrow(
        /Session not found/
      );
    });
  });

  describe("resumeSession", () => {
    it("delegates to session.resume()", async () => {
      const session = await manager.createSession("claude", makeTask());
      (session as unknown as { _state: string })._state = "paused";

      await manager.resumeSession(session.id);
      expect(session.state).toBe("running");
    });
  });

  describe("cancelSession", () => {
    it("delegates to session.cancel()", async () => {
      const session = await manager.createSession("claude", makeTask());
      (session as unknown as { _state: string })._state = "running";

      await manager.cancelSession(session.id);
      expect(session.state).toBe("cancelled");
    });
  });

  // -------------------------------------------------------------------------
  // Availability checking
  // -------------------------------------------------------------------------

  describe("checkAvailability", () => {
    it("returns availability for all agents", async () => {
      const availability = await manager.checkAvailability();
      expect(availability).toHaveProperty("claude");
      expect(availability).toHaveProperty("copilot");
      expect(availability).toHaveProperty("codex");
    });

    it("detects available agents", async () => {
      const availability = await manager.checkAvailability();
      // Our mock provider returns models for "copilot" vendor
      // All three agents default to "copilot" vendor in DEFAULT_AGENT_MODEL_CONFIG
      expect(availability.claude).toBe(true);
      expect(availability.copilot).toBe(true);
      expect(availability.codex).toBe(true);
    });

    it("detects unavailable agents", async () => {
      const emptyProvider = makeMockLmProvider({});
      const mgr = new SessionManager(
        emptyProvider,
        emitterFactory,
        cancellationFactory
      );

      const availability = await mgr.checkAvailability();
      expect(availability.claude).toBe(false);
      expect(availability.copilot).toBe(false);
      expect(availability.codex).toBe(false);
    });

    it("caches results within TTL", async () => {
      await manager.checkAvailability();
      await manager.checkAvailability();

      // Should only call selectModels once per agent (3 total, not 6)
      expect(lmProvider.selectModels).toHaveBeenCalledTimes(3);
    });

    it("handles failed availability checks gracefully", async () => {
      const failingProvider: ILanguageModelProvider = {
        selectModels: vi.fn(async () => {
          throw new Error("Network error");
        }),
      };
      const mgr = new SessionManager(
        failingProvider,
        emitterFactory,
        cancellationFactory
      );

      const availability = await mgr.checkAvailability();
      // All should be false since checks failed
      expect(availability.claude).toBe(false);
      expect(availability.copilot).toBe(false);
      expect(availability.codex).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Active sessions
  // -------------------------------------------------------------------------

  describe("getActiveSessions", () => {
    it("returns empty array when no sessions exist", () => {
      expect(manager.getActiveSessions()).toHaveLength(0);
    });

    it("includes pending sessions", async () => {
      await manager.createSession("claude", makeTask());
      expect(manager.getActiveSessions()).toHaveLength(1);
    });

    it("excludes completed sessions", async () => {
      const session = await manager.createSession("claude", makeTask());
      await session.run();
      expect(manager.getActiveSessions()).toHaveLength(0);
    });

    it("excludes cancelled sessions", async () => {
      const session = await manager.createSession("claude", makeTask());
      session.cancel();
      expect(manager.getActiveSessions()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Get all sessions
  // -------------------------------------------------------------------------

  describe("getAllSessions", () => {
    it("returns all sessions including terminal", async () => {
      const s1 = await manager.createSession("claude", makeTask());
      await s1.run(); // completes
      await manager.createSession("copilot", makeTask()); // pending

      const all = manager.getAllSessions();
      expect(all).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  describe("dispose", () => {
    it("cancels active sessions", async () => {
      const session = await manager.createSession("claude", makeTask());
      (session as unknown as { _state: string })._state = "running";

      manager.dispose();

      expect(session.state).toBe("cancelled");
    });

    it("clears session map", async () => {
      await manager.createSession("claude", makeTask());
      manager.dispose();
      expect(manager.getAllSessions()).toHaveLength(0);
    });

    it("disposes all event emitters", () => {
      manager.dispose();
      // 7 emitters created in constructor
      for (const emitter of emitterFactory.created) {
        expect(emitter.dispose).toHaveBeenCalled();
      }
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end: create + run + complete
  // -------------------------------------------------------------------------

  describe("end-to-end", () => {
    it("creates session, runs to completion, and fires events", async () => {
      const session = await manager.createSession("claude", makeTask());

      const status = await session.run();

      expect(status.state).toBe("completed");
      expect(status.output).toBe("hello");

      // onSessionStarted fired during createSession
      const startedEmitter = emitterFactory.created[0] as ReturnType<
        typeof makeMockEmitter<SessionStatus>
      >;
      expect(startedEmitter.fired.length).toBe(1);
    });
  });
});
