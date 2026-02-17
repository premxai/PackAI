import { describe, it, expect, beforeEach, vi } from "vitest";
import { Session } from "./session";
import type { SessionEmitters } from "./session";
import type {
  SessionConfig,
  SessionStatus,
  SessionProgress,
  ILanguageModel,
  ILanguageModelMessage,
  ILanguageModelResponse,
  ICancellationToken,
  ICancellationTokenSource,
  IEventEmitter,
} from "./types";
import type { ExecutionTask } from "../intelligence/types";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: "task-1",
    label: "Test Task",
    prompt: "Build something amazing",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 10,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    agent: "claude",
    task: makeTask(),
    ...overrides,
  };
}

/** Create a mock model that yields given chunks. */
function makeMockModel(chunks: string[]): ILanguageModel {
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
      ): Promise<ILanguageModelResponse> => {
        return {
          text: (async function* () {
            for (const chunk of chunks) {
              yield chunk;
            }
          })(),
        };
      }
    ),
  };
}

/** Create a mock model that fails n times then succeeds. */
function makeFailThenSucceedModel(
  failCount: number,
  errorCode: string,
  successChunks: string[]
): ILanguageModel {
  let callCount = 0;
  return {
    id: "mock-model",
    vendor: "copilot",
    family: "test",
    name: "Mock Model",
    maxInputTokens: 4096,
    sendRequest: vi.fn(async () => {
      callCount++;
      if (callCount <= failCount) {
        throw { code: errorCode, message: `Fail attempt ${callCount}` };
      }
      return {
        text: (async function* () {
          for (const chunk of successChunks) {
            yield chunk;
          }
        })(),
      };
    }),
  };
}

/** Create a mock model that always fails. */
function makeFailingModel(errorCode: string, message: string): ILanguageModel {
  return {
    id: "mock-model",
    vendor: "copilot",
    family: "test",
    name: "Mock Model",
    maxInputTokens: 4096,
    sendRequest: vi.fn(async () => {
      throw { code: errorCode, message };
    }),
  };
}

function makeCancellationSource(): ICancellationTokenSource {
  let cancelled = false;
  const listeners: (() => void)[] = [];
  return {
    token: {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested(listener: () => void) {
        listeners.push(listener);
        return { dispose: () => {} };
      },
    },
    cancel() {
      cancelled = true;
      for (const l of listeners) l();
    },
    dispose() {},
  };
}

function makeMockEmitter<T>(): IEventEmitter<T> & { fired: T[] } {
  const fired: T[] = [];
  const eventListeners: ((e: T) => void)[] = [];
  return {
    fired,
    event: (listener: (e: T) => void) => {
      eventListeners.push(listener);
      return { dispose: () => {} };
    },
    fire(data: T) {
      fired.push(data);
      for (const l of eventListeners) l(data);
    },
    dispose() {},
  };
}

function makeEmitters(): SessionEmitters & {
  progressFired: SessionProgress[];
  completedFired: SessionStatus[];
  failedFired: SessionStatus[];
  cancelledFired: SessionStatus[];
  pausedFired: SessionStatus[];
  resumedFired: SessionStatus[];
} {
  const onProgress = makeMockEmitter<SessionProgress>();
  const onCompleted = makeMockEmitter<SessionStatus>();
  const onFailed = makeMockEmitter<SessionStatus>();
  const onCancelled = makeMockEmitter<SessionStatus>();
  const onPaused = makeMockEmitter<SessionStatus>();
  const onResumed = makeMockEmitter<SessionStatus>();

  return {
    onProgress,
    onCompleted,
    onFailed,
    onCancelled,
    onPaused,
    onResumed,
    get progressFired() { return onProgress.fired; },
    get completedFired() { return onCompleted.fired; },
    get failedFired() { return onFailed.fired; },
    get cancelledFired() { return onCancelled.fired; },
    get pausedFired() { return onPaused.fired; },
    get resumedFired() { return onResumed.fired; },
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("Session", () => {
  let emitters: ReturnType<typeof makeEmitters>;
  let cancellation: ICancellationTokenSource;

  beforeEach(() => {
    emitters = makeEmitters();
    cancellation = makeCancellationSource();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("initial state", () => {
    it("starts in pending state", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      expect(session.state).toBe("pending");
    });

    it("has empty output", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      expect(session.output).toBe("");
    });

    it("stores id, agent, and taskId", () => {
      const config = makeConfig({ agent: "codex", task: makeTask({ id: "my-task" }) });
      const session = new Session(
        "s-42", config, makeMockModel([]), cancellation, emitters
      );
      expect(session.id).toBe("s-42");
      expect(session.agent).toBe("codex");
      expect(session.taskId).toBe("my-task");
    });

    it("getStatus returns correct initial snapshot", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      const status = session.getStatus();
      expect(status.state).toBe("pending");
      expect(status.retryCount).toBe(0);
      expect(status.error).toBeNull();
      expect(status.output).toBe("");
      expect(status.startedAt).toBeNull();
      expect(status.completedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Successful execution
  // -------------------------------------------------------------------------

  describe("successful execution", () => {
    it("transitions to completed on success", async () => {
      const model = makeMockModel(["Hello", " World"]);
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.state).toBe("completed");
      expect(session.state).toBe("completed");
      expect(status.output).toBe("Hello World");
      expect(status.completedAt).not.toBeNull();
    });

    it("emits progress events for each chunk", async () => {
      const model = makeMockModel(["a", "b", "c"]);
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      await session.run();

      expect(emitters.progressFired.length).toBe(3);
    });

    it("fires onCompleted event", async () => {
      const model = makeMockModel(["done"]);
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      await session.run();

      expect(emitters.completedFired.length).toBe(1);
      expect(emitters.completedFired[0]!.state).toBe("completed");
    });

    it("sends correct messages to the model", async () => {
      const task = makeTask({ prompt: "Build a widget" });
      const model = makeMockModel(["ok"]);
      const session = new Session(
        "s-1", makeConfig({ task }), model, cancellation, emitters
      );

      await session.run();

      expect(model.sendRequest).toHaveBeenCalledWith(
        [{ role: "user", content: "Build a widget" }],
        {},
        cancellation.token
      );
    });
  });

  // -------------------------------------------------------------------------
  // Retry logic
  // -------------------------------------------------------------------------

  describe("retry logic", () => {
    it("retries on retryable error and succeeds", async () => {
      const model = makeFailThenSucceedModel(2, "rate_limit_exceeded", ["ok"]);
      const config = makeConfig({
        retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
      });
      const session = new Session(
        "s-1", config, model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.state).toBe("completed");
      expect(status.retryCount).toBe(2);
      expect(model.sendRequest).toHaveBeenCalledTimes(3);
    });

    it("fails after exhausting retries", async () => {
      const model = makeFailingModel("rate_limit_exceeded", "Rate limited");
      const config = makeConfig({
        retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
      });
      const session = new Session(
        "s-1", config, model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.state).toBe("failed");
      expect(status.error).not.toBeNull();
      expect(status.error!.code).toBe("rate_limited");
      expect(model.sendRequest).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it("does not retry non-retryable errors", async () => {
      const model = makeFailingModel("off_topic", "Off topic");
      const config = makeConfig({
        retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
      });
      const session = new Session(
        "s-1", config, model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.state).toBe("failed");
      expect(status.error!.code).toBe("off_topic");
      expect(model.sendRequest).toHaveBeenCalledTimes(1);
    });

    it("fires onFailed event on failure", async () => {
      const model = makeFailingModel("off_topic", "Off topic");
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      await session.run();

      expect(emitters.failedFired.length).toBe(1);
      expect(emitters.failedFired[0]!.state).toBe("failed");
    });

    it("resets output between retry attempts", async () => {
      const model = makeFailThenSucceedModel(1, "rate_limit_exceeded", ["final"]);
      const config = makeConfig({
        retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
      });
      const session = new Session(
        "s-1", config, model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.output).toBe("final");
    });
  });

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  describe("cancellation", () => {
    it("cancel() transitions to cancelled", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      // Move to a non-terminal state first
      (session as unknown as { _state: string })._state = "running";

      session.cancel();

      expect(session.state).toBe("cancelled");
    });

    it("cancel() fires onCancelled event", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      (session as unknown as { _state: string })._state = "running";

      session.cancel();

      expect(emitters.cancelledFired.length).toBe(1);
    });

    it("cancel() is no-op for completed sessions", async () => {
      const model = makeMockModel(["done"]);
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      await session.run();
      session.cancel();

      expect(session.state).toBe("completed");
      expect(emitters.cancelledFired.length).toBe(0);
    });

    it("pre-cancelled token prevents execution", async () => {
      cancellation.cancel();
      const model = makeMockModel(["should not run"]);
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.state).toBe("cancelled");
      expect(model.sendRequest).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Pause / Resume
  // -------------------------------------------------------------------------

  describe("pause / resume", () => {
    it("pause() transitions running → paused", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      (session as unknown as { _state: string })._state = "running";

      session.pause();

      expect(session.state).toBe("paused");
    });

    it("pause() fires onPaused event", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      (session as unknown as { _state: string })._state = "running";

      session.pause();

      expect(emitters.pausedFired.length).toBe(1);
    });

    it("pause() is no-op when not running", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );

      session.pause(); // state is "pending"

      expect(session.state).toBe("pending");
      expect(emitters.pausedFired.length).toBe(0);
    });

    it("resume() transitions paused → running", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      (session as unknown as { _state: string })._state = "paused";

      session.resume();

      expect(session.state).toBe("running");
    });

    it("resume() fires onResumed event", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );
      (session as unknown as { _state: string })._state = "paused";

      session.resume();

      expect(emitters.resumedFired.length).toBe(1);
    });

    it("resume() is no-op when not paused", () => {
      const session = new Session(
        "s-1", makeConfig(), makeMockModel([]), cancellation, emitters
      );

      session.resume(); // state is "pending"

      expect(session.state).toBe("pending");
      expect(emitters.resumedFired.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Status snapshot
  // -------------------------------------------------------------------------

  describe("status snapshot", () => {
    it("completed status has all fields populated", async () => {
      const model = makeMockModel(["hello"]);
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.sessionId).toBe("s-1");
      expect(status.agent).toBe("claude");
      expect(status.taskId).toBe("task-1");
      expect(status.state).toBe("completed");
      expect(status.progress).not.toBeNull();
      expect(status.progress!.percent).toBe(100);
      expect(status.createdAt).toBeGreaterThan(0);
      expect(status.startedAt).toBeGreaterThan(0);
      expect(status.completedAt).toBeGreaterThan(0);
      expect(status.error).toBeNull();
      expect(status.retryCount).toBe(0);
      expect(status.output).toBe("hello");
    });

    it("failed status has error populated", async () => {
      const model = makeFailingModel("off_topic", "Off topic");
      const session = new Session(
        "s-1", makeConfig(), model, cancellation, emitters
      );

      const status = await session.run();

      expect(status.error).not.toBeNull();
      expect(status.error!.code).toBe("off_topic");
      expect(status.error!.retryable).toBe(false);
    });
  });
});
