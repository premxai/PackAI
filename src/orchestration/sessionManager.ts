import type { AgentRole, AgentAvailability, ExecutionTask } from "../intelligence/types";
import type {
  SessionId,
  SessionStatus,
  SessionProgress,
  SessionConfig,
  AgentModelConfig,
  ILanguageModelProvider,
  IEventEmitter,
  IEventEmitterFactory,
  ICancellationTokenSourceFactory,
} from "./types";
import { Session } from "./session";

// ===========================================================================
// SessionManager
//
// Orchestrates agent session lifecycles. Owns model selection, session
// creation, availability detection, and event emission. All VS Code API
// access is behind injected interfaces for testability.
// ===========================================================================

/** Default mapping from agent roles to language model vendor/family. */
const DEFAULT_AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: { vendor: "copilot", family: "claude-sonnet-4.5" },
  copilot: { vendor: "copilot", family: "gpt-4o" },
  codex: { vendor: "copilot", family: "o3-mini" },
};

/**
 * Orchestrates agent session lifecycles.
 *
 * Owns language model selection, session creation, availability detection,
 * and event emission. All VS Code API access is behind injected interfaces
 * so the class is fully testable without a running VS Code instance.
 */
export class SessionManager {
  private readonly sessions = new Map<SessionId, Session>();
  private sessionCounter = 0;

  // Availability cache (30s TTL)
  private availabilityCache: {
    data: AgentAvailability;
    expiry: number;
  } | null = null;
  private readonly availabilityCacheTtlMs = 30_000;

  // Public event emitters for UI subscribers
  readonly onSessionStarted: IEventEmitter<SessionStatus>;
  readonly onProgress: IEventEmitter<SessionProgress>;
  readonly onSessionCompleted: IEventEmitter<SessionStatus>;
  readonly onSessionFailed: IEventEmitter<SessionStatus>;
  readonly onSessionCancelled: IEventEmitter<SessionStatus>;
  readonly onSessionPaused: IEventEmitter<SessionStatus>;
  readonly onSessionResumed: IEventEmitter<SessionStatus>;

  // Injected dependencies
  private readonly lmProvider: ILanguageModelProvider;
  private readonly cancellationFactory: ICancellationTokenSourceFactory;
  private readonly agentModelConfig: AgentModelConfig;

  constructor(
    lmProvider: ILanguageModelProvider,
    emitterFactory: IEventEmitterFactory,
    cancellationFactory: ICancellationTokenSourceFactory,
    agentModelConfig?: AgentModelConfig
  ) {
    this.lmProvider = lmProvider;
    this.cancellationFactory = cancellationFactory;
    this.agentModelConfig = agentModelConfig ?? DEFAULT_AGENT_MODEL_CONFIG;

    this.onSessionStarted = emitterFactory.create<SessionStatus>();
    this.onProgress = emitterFactory.create<SessionProgress>();
    this.onSessionCompleted = emitterFactory.create<SessionStatus>();
    this.onSessionFailed = emitterFactory.create<SessionStatus>();
    this.onSessionCancelled = emitterFactory.create<SessionStatus>();
    this.onSessionPaused = emitterFactory.create<SessionStatus>();
    this.onSessionResumed = emitterFactory.create<SessionStatus>();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Create a new session for the given agent and task.
   * Selects the appropriate language model and prepares the session.
   * Call `session.run()` to start execution.
   */
  async createSession(
    agent: AgentRole,
    task: ExecutionTask
  ): Promise<Session> {
    const modelMapping = this.agentModelConfig[agent];
    const models = await this.lmProvider.selectModels({
      vendor: modelMapping.vendor,
      family: modelMapping.family,
    });

    if (models.length === 0) {
      throw new Error(
        `No language model available for agent "${agent}" ` +
          `(vendor: ${modelMapping.vendor}` +
          (modelMapping.family ? `, family: ${modelMapping.family}` : "") +
          ")"
      );
    }

    const model = models[0]!;
    const sessionId = this.generateSessionId(agent);
    const cancellationSource = this.cancellationFactory.create();
    const config: SessionConfig = { agent, task };

    const session = new Session(sessionId, config, model, cancellationSource, {
      onProgress: this.onProgress,
      onCompleted: this.onSessionCompleted,
      onFailed: this.onSessionFailed,
      onCancelled: this.onSessionCancelled,
      onPaused: this.onSessionPaused,
      onResumed: this.onSessionResumed,
    });

    this.sessions.set(sessionId, session);
    this.onSessionStarted.fire(session.getStatus());

    return session;
  }

  /** Get the current status of a session. */
  getSessionStatus(sessionId: SessionId): SessionStatus {
    return this.getSessionOrThrow(sessionId).getStatus();
  }

  /** Pause a running session. */
  async pauseSession(sessionId: SessionId): Promise<void> {
    this.getSessionOrThrow(sessionId).pause();
  }

  /** Resume a paused session. */
  async resumeSession(sessionId: SessionId): Promise<void> {
    this.getSessionOrThrow(sessionId).resume();
  }

  /** Cancel a session. */
  async cancelSession(sessionId: SessionId): Promise<void> {
    this.getSessionOrThrow(sessionId).cancel();
  }

  /**
   * Check which agents have language models currently available.
   * Results are cached for 30 seconds.
   */
  async checkAvailability(): Promise<AgentAvailability> {
    if (this.availabilityCache && Date.now() < this.availabilityCache.expiry) {
      return this.availabilityCache.data;
    }

    const results = await Promise.allSettled(
      (["claude", "copilot", "codex"] as AgentRole[]).map(async (agent) => {
        const mapping = this.agentModelConfig[agent];
        const models = await this.lmProvider.selectModels({
          vendor: mapping.vendor,
          family: mapping.family,
        });
        return { agent, available: models.length > 0 };
      })
    );

    const availability: Record<string, boolean> = {
      claude: false,
      copilot: false,
      codex: false,
    };

    for (const result of results) {
      if (result.status === "fulfilled") {
        availability[result.value.agent] = result.value.available;
      }
    }

    const data = availability as unknown as AgentAvailability;
    this.availabilityCache = {
      data,
      expiry: Date.now() + this.availabilityCacheTtlMs,
    };

    return data;
  }

  /** Get all sessions in non-terminal states. */
  getActiveSessions(): SessionStatus[] {
    const active: SessionStatus[] = [];
    for (const session of this.sessions.values()) {
      const state = session.state;
      if (state === "pending" || state === "running" || state === "paused") {
        active.push(session.getStatus());
      }
    }
    return active;
  }

  /** Get all sessions (including terminal). */
  getAllSessions(): SessionStatus[] {
    return [...this.sessions.values()].map((s) => s.getStatus());
  }

  /** Dispose all sessions and event emitters. */
  dispose(): void {
    for (const session of this.sessions.values()) {
      session.cancel();
    }
    this.sessions.clear();
    this.onSessionStarted.dispose();
    this.onProgress.dispose();
    this.onSessionCompleted.dispose();
    this.onSessionFailed.dispose();
    this.onSessionCancelled.dispose();
    this.onSessionPaused.dispose();
    this.onSessionResumed.dispose();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private generateSessionId(agent: AgentRole): SessionId {
    return `${agent}-${++this.sessionCounter}-${Date.now()}`;
  }

  private getSessionOrThrow(sessionId: SessionId): Session {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }
}
