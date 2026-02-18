import type { AgentRole, AgentAvailability, ExecutionTask } from "../intelligence/types";
import type {
  SessionId,
  SessionStatus,
  SessionProgress,
  SessionConfig,
  AgentModelConfig,
  ILanguageModelProvider,
  ILanguageModel,
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

/**
 * Default mapping from agent roles to language model vendor/family.
 *
 * Family names must match what VS Code's Language Model API reports for the
 * GitHub Copilot vendor. Correct Copilot family names (2025):
 *   gpt-4o            — GPT-4o via Copilot (always available)
 *   claude-3.5-sonnet — Claude 3.5 Sonnet via Copilot (requires Claude access)
 *   o3-mini           — o3-mini via Copilot
 *
 * NOTE: "claude-sonnet-4.5" is the Anthropic API model ID — it does NOT work
 * here. VS Code Copilot calls it "claude-3.5-sonnet".
 */
const DEFAULT_AGENT_MODEL_CONFIG: AgentModelConfig = {
  claude: { vendor: "copilot", family: "claude-3.5-sonnet" },
  copilot: { vendor: "copilot", family: "gpt-4o" },
  codex: { vendor: "copilot", family: "o3-mini" },
};

const MODEL_FAMILY_FALLBACKS: Readonly<Record<AgentRole, readonly string[]>> = {
  claude: ["claude-3.7-sonnet", "claude-3.5-sonnet", "claude-3-opus"],
  copilot: ["gpt-4o", "gpt-4.1", "gpt-4.1-mini"],
  codex: ["o3-mini", "o3", "gpt-5", "gpt-4.1"],
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
    const models = await this.selectModelsWithFallback(agent);

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
        // Availability is vendor-level: if any model is visible, the agent can run
        // via createSession() fallback selection even when preferred family changes.
        const models = await this.lmProvider.selectModels({
          vendor: mapping.vendor,
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

  private async selectModelsWithFallback(agent: AgentRole): Promise<readonly ILanguageModel[]> {
    const mapping = this.agentModelConfig[agent];

    if (mapping.family) {
      const direct = await this.lmProvider.selectModels({
        vendor: mapping.vendor,
        family: mapping.family,
      });
      if (direct.length > 0) return direct;
    }

    const candidateFamilies = MODEL_FAMILY_FALLBACKS[agent].filter(
      (f) => f !== mapping.family
    );
    for (const family of candidateFamilies) {
      const models = await this.lmProvider.selectModels({
        vendor: mapping.vendor,
        family,
      });
      if (models.length > 0) return models;
    }

    return this.lmProvider.selectModels({ vendor: mapping.vendor });
  }
}
