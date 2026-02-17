import type { AgentRole } from "../intelligence/types";
import type {
  SessionId,
  SessionState,
  SessionStatus,
  SessionProgress,
  SessionError,
  SessionConfig,
  RetryConfig,
  ILanguageModel,
  ILanguageModelMessage,
  ICancellationTokenSource,
  IEventEmitter,
} from "./types";
import {
  resolveRetryConfig,
  computeBackoffDelay,
  isRetryableError,
  classifyError,
  delay,
} from "./retry";

// ===========================================================================
// Session
//
// Represents a single agent session executing one task. Wraps LM API calls
// with retry logic, stream consumption, pause/resume buffering, and
// cancellation. Fires events via injected emitters for UI updates.
// ===========================================================================

/** Emitters the Session fires into (owned by SessionManager). */
export interface SessionEmitters {
  readonly onProgress: IEventEmitter<SessionProgress>;
  readonly onCompleted: IEventEmitter<SessionStatus>;
  readonly onFailed: IEventEmitter<SessionStatus>;
  readonly onCancelled: IEventEmitter<SessionStatus>;
  readonly onPaused: IEventEmitter<SessionStatus>;
  readonly onResumed: IEventEmitter<SessionStatus>;
}

export class Session {
  readonly id: SessionId;
  readonly agent: AgentRole;
  readonly taskId: string;

  private _state: SessionState = "pending";
  private _output = "";
  private _tokensGenerated = 0;
  private _retryCount = 0;
  private _error: SessionError | null = null;
  private _createdAt: number;
  private _startedAt: number | null = null;
  private _completedAt: number | null = null;

  // Pause/resume
  private _paused = false;
  private _pauseBuffer: string[] = [];

  // Dependencies
  private readonly model: ILanguageModel;
  private readonly prompt: string;
  private readonly retryConfig: RetryConfig;
  private readonly cancellationSource: ICancellationTokenSource;
  private readonly emitters: SessionEmitters;

  constructor(
    id: SessionId,
    config: SessionConfig,
    model: ILanguageModel,
    cancellationSource: ICancellationTokenSource,
    emitters: SessionEmitters,
    now = Date.now()
  ) {
    this.id = id;
    this.agent = config.agent;
    this.taskId = config.task.id;
    this.prompt = config.task.prompt;
    this.model = model;
    this.retryConfig = resolveRetryConfig(config.retry);
    this.cancellationSource = cancellationSource;
    this.emitters = emitters;
    this._createdAt = now;
  }

  /** Current state. */
  get state(): SessionState {
    return this._state;
  }

  /** Accumulated output text. */
  get output(): string {
    return this._output;
  }

  /** Build a full status snapshot. */
  getStatus(): SessionStatus {
    return {
      sessionId: this.id,
      agent: this.agent,
      taskId: this.taskId,
      state: this._state,
      progress: this.buildProgress(),
      createdAt: this._createdAt,
      startedAt: this._startedAt,
      completedAt: this._completedAt,
      error: this._error,
      retryCount: this._retryCount,
      output: this._output,
    };
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /** Execute the session with retry logic. Returns final status. */
  async run(): Promise<SessionStatus> {
    this._state = "running";
    this._startedAt = Date.now();

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      if (this.cancellationSource.token.isCancellationRequested) {
        return this.handleCancel();
      }

      try {
        await this.executeRequest();
        this._state = "completed";
        this._completedAt = Date.now();
        const status = this.getStatus();
        this.emitters.onCompleted.fire(status);
        return status;
      } catch (err) {
        const sessionError = classifyError(err);

        if (sessionError.code === "cancelled") {
          return this.handleCancel();
        }

        if (
          isRetryableError(sessionError) &&
          attempt < this.retryConfig.maxRetries
        ) {
          this._retryCount = attempt + 1;
          const backoff = computeBackoffDelay(attempt, this.retryConfig);
          await delay(backoff);
          // Reset output for retry
          this._output = "";
          this._tokensGenerated = 0;
          continue;
        }

        // Non-retryable or retries exhausted
        this._state = "failed";
        this._error = sessionError;
        this._completedAt = Date.now();
        const status = this.getStatus();
        this.emitters.onFailed.fire(status);
        return status;
      }
    }

    // Safety net — should not be reached
    return this.getStatus();
  }

  // -------------------------------------------------------------------------
  // Pause / Resume / Cancel
  // -------------------------------------------------------------------------

  /** Pause the session — buffers chunks instead of emitting progress. */
  pause(): void {
    if (this._state !== "running") return;
    this._paused = true;
    this._state = "paused";
    this.emitters.onPaused.fire(this.getStatus());
  }

  /** Resume from pause — flushes buffered progress events. */
  resume(): void {
    if (this._state !== "paused") return;
    this._paused = false;
    this._state = "running";
    // Flush buffered progress
    for (const _chunk of this._pauseBuffer) {
      this.emitProgress();
    }
    this._pauseBuffer = [];
    this.emitters.onResumed.fire(this.getStatus());
  }

  /** Cancel the session via the cancellation token. */
  cancel(): void {
    if (this._state === "completed" || this._state === "failed" || this._state === "cancelled") {
      return;
    }
    this.cancellationSource.cancel();
    this.handleCancel();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async executeRequest(): Promise<void> {
    const messages: ILanguageModelMessage[] = [
      { role: "user", content: this.prompt },
    ];

    const response = await this.model.sendRequest(
      messages,
      {},
      this.cancellationSource.token
    );

    for await (const chunk of response.text) {
      if (this.cancellationSource.token.isCancellationRequested) {
        throw new Error("cancelled");
      }

      this._output += chunk;
      this._tokensGenerated += 1;

      if (this._paused) {
        this._pauseBuffer.push(chunk);
      } else {
        this.emitProgress();
      }
    }
  }

  private emitProgress(): void {
    this.emitters.onProgress.fire(this.buildProgress());
  }

  private buildProgress(): SessionProgress {
    return {
      sessionId: this.id,
      percent: this._state === "completed" ? 100 : Math.min(99, this._tokensGenerated),
      message: `${this.agent}: generating response...`,
      tokensGenerated: this._tokensGenerated,
      elapsedMs: Date.now() - (this._startedAt ?? this._createdAt),
    };
  }

  private handleCancel(): SessionStatus {
    this._state = "cancelled";
    this._completedAt = Date.now();
    this._error = {
      code: "cancelled",
      message: "Session cancelled by user",
      retryable: false,
    };
    const status = this.getStatus();
    this.emitters.onCancelled.fire(status);
    return status;
  }
}
