import type { AgentRole, ExecutionTask } from "../intelligence/types";

// ===========================================================================
// Session management types
// ===========================================================================

/** Unique session identifier */
export type SessionId = string;

/** Session lifecycle states */
export type SessionState =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/** Progress information emitted during a session */
export interface SessionProgress {
  readonly sessionId: SessionId;
  /** Estimated percentage (0–100) */
  readonly percent: number;
  readonly message: string;
  readonly tokensGenerated: number;
  readonly elapsedMs: number;
}

/** Full session status snapshot */
export interface SessionStatus {
  readonly sessionId: SessionId;
  readonly agent: AgentRole;
  readonly taskId: string;
  readonly state: SessionState;
  readonly progress: SessionProgress | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly error: SessionError | null;
  readonly retryCount: number;
  readonly output: string;
}

/** Structured error from a session */
export interface SessionError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly originalError?: unknown;
}

/** Configuration for session retry behavior */
export interface RetryConfig {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: boolean;
}

/** Configuration for creating a session */
export interface SessionConfig {
  readonly agent: AgentRole;
  readonly task: ExecutionTask;
  readonly systemPrompt?: string;
  readonly retry?: Partial<RetryConfig>;
  readonly timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Agent ↔ model mapping
// ---------------------------------------------------------------------------

/** Maps an agent role to a language model vendor/family */
export interface AgentModelMapping {
  readonly vendor: string;
  readonly family?: string;
}

/** Complete agent → model configuration table */
export type AgentModelConfig = Readonly<Record<AgentRole, AgentModelMapping>>;

// ===========================================================================
// Dependency inversion interfaces — abstractions over VS Code APIs
// ===========================================================================

/** Abstraction over vscode.lm.selectChatModels */
export interface ILanguageModelProvider {
  selectModels(selector: {
    vendor: string;
    family?: string;
  }): Promise<ILanguageModel[]>;
}

/** Abstraction over a vscode.LanguageModelChat instance */
export interface ILanguageModel {
  readonly id: string;
  readonly vendor: string;
  readonly family: string;
  readonly name: string;
  readonly maxInputTokens: number;
  sendRequest(
    messages: readonly ILanguageModelMessage[],
    options: Record<string, unknown>,
    token: ICancellationToken
  ): Promise<ILanguageModelResponse>;
}

/** Abstraction over LanguageModelChatMessage */
export interface ILanguageModelMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Abstraction over the response from sendRequest */
export interface ILanguageModelResponse {
  readonly text: AsyncIterable<string>;
}

/** Abstraction over CancellationToken */
export interface ICancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** Abstraction over CancellationTokenSource */
export interface ICancellationTokenSource {
  readonly token: ICancellationToken;
  cancel(): void;
  dispose(): void;
}

/** Typed event emitter (abstracts vscode.EventEmitter) */
export interface IEventEmitter<T> {
  readonly event: (listener: (e: T) => void) => { dispose(): void };
  fire(data: T): void;
  dispose(): void;
}

/** Factory for creating IEventEmitter instances */
export interface IEventEmitterFactory {
  create<T>(): IEventEmitter<T>;
}

/** Factory for creating ICancellationTokenSource instances */
export interface ICancellationTokenSourceFactory {
  create(): ICancellationTokenSource;
}
