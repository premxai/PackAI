import type { AgentRole, ExecutionPlan, ExecutionTask } from "../intelligence/types";
import type { AgentFactory } from "../execution/agents/agentFactory";
import type { AgentExecutionResult, ContextSubset } from "../execution/agents/types";
import type { AgentProgressCallback } from "../execution/agents/baseAgent";
import {
  isAgentExecutionError,
  AgentFailureError,
  AllAgentsExhaustedError,
  RateLimitError,
  GitOperationError,
  StatePersistenceError,
} from "./errors";

// ===========================================================================
// Error Recovery
//
// Agent fallback, rate limit queueing, state persistence, git service.
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Agent Fallback Coordinator
// ---------------------------------------------------------------------------

export interface AgentFallbackConfig {
  /** Maximum number of fallback attempts (excluding the primary). */
  readonly maxFallbackAttempts: number;
  /** Ordered list of agents to try (first = primary). */
  readonly fallbackOrder: readonly AgentRole[];
}

const DEFAULT_FALLBACK_CONFIG: AgentFallbackConfig = {
  maxFallbackAttempts: 2,
  fallbackOrder: ["claude", "copilot", "codex"],
};

/**
 * Wraps `AgentFactory` to attempt fallback agents on failure.
 *
 * When an agent fails with a retryable error (session-failed, parse-error,
 * empty-output), the coordinator tries the next agent in `fallbackOrder`.
 * Cancelled sessions are never retried.
 */
export class AgentFallbackCoordinator {
  private readonly config: AgentFallbackConfig;

  constructor(
    private readonly agentFactory: AgentFactory,
    config?: Partial<AgentFallbackConfig>
  ) {
    this.config = { ...DEFAULT_FALLBACK_CONFIG, ...config };
  }

  /**
   * Execute a task with automatic agent fallback.
   *
   * @returns AgentExecutionResult on success
   * @throws AllAgentsExhaustedError when all attempts fail
   */
  async executeWithFallback(
    task: ExecutionTask,
    context: ContextSubset,
    primaryAgent: AgentRole,
    onProgress?: AgentProgressCallback
  ): Promise<AgentExecutionResult> {
    const triedAgents: AgentRole[] = [];

    // Build the agent order: primary first, then remaining from fallbackOrder
    const agentOrder = this.buildAgentOrder(primaryAgent);

    for (let i = 0; i < agentOrder.length && i <= this.config.maxFallbackAttempts; i++) {
      const agentRole = agentOrder[i];
      if (agentRole === undefined) break;

      triedAgents.push(agentRole);

      try {
        const agent = this.agentFactory.create(agentRole);
        return await agent.execute(task, context, onProgress);
      } catch (err: unknown) {
        if (isAgentExecutionError(err)) {
          // Never retry user-initiated cancellation
          if (err.code === "session-cancelled") {
            throw AgentFailureError.fromPlainObject(err);
          }
          // Retryable codes: try next agent
          continue;
        }
        // "No language model available" is thrown as a plain Error by
        // SessionManager when vscode.lm.selectChatModels() returns [].
        // Treat it as retryable so the next agent in the fallback chain is tried.
        if (
          err instanceof Error &&
          err.message.startsWith("No language model available")
        ) {
          continue;
        }
        // Unknown error — don't retry, just throw
        throw err;
      }
    }

    throw new AllAgentsExhaustedError(task.id, triedAgents);
  }

  /** Build the ordered agent list: primary first, then others. */
  private buildAgentOrder(primary: AgentRole): readonly AgentRole[] {
    const order = [primary];
    for (const agent of this.config.fallbackOrder) {
      if (agent !== primary) {
        order.push(agent);
      }
    }
    return order;
  }
}

// ---------------------------------------------------------------------------
// Rate Limit Queue
// ---------------------------------------------------------------------------

interface QueueEntry {
  readonly taskId: string;
  readonly execute: () => Promise<AgentExecutionResult>;
  readonly resolve: (result: AgentExecutionResult) => void;
  readonly reject: (err: unknown) => void;
}

export interface RateLimitQueueConfig {
  /** Maximum queued requests. */
  readonly maxSize: number;
  /** Drain interval in milliseconds. */
  readonly drainIntervalMs: number;
}

const DEFAULT_QUEUE_CONFIG: RateLimitQueueConfig = {
  maxSize: 20,
  drainIntervalMs: 5000,
};

/**
 * FIFO queue for rate-limited requests.
 *
 * When a caller gets a rate-limit error, they can enqueue their request
 * here. The queue drains one request at a time at a configurable interval.
 */
export class RateLimitQueue {
  private readonly config: RateLimitQueueConfig;
  private readonly queue: QueueEntry[] = [];
  private drainTimer: ReturnType<typeof setInterval> | null = null;
  private draining = false;

  constructor(config?: Partial<RateLimitQueueConfig>) {
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
  }

  /**
   * Enqueue a request. Returns a Promise that resolves when the request
   * is eventually executed.
   *
   * @throws RateLimitError if the queue is at capacity.
   */
  enqueue(
    taskId: string,
    execute: () => Promise<AgentExecutionResult>
  ): Promise<AgentExecutionResult> {
    if (this.queue.length >= this.config.maxSize) {
      throw new RateLimitError(
        `Rate limit queue is full (${this.config.maxSize} entries)`,
        this.queue.length
      );
    }

    return new Promise<AgentExecutionResult>((resolve, reject) => {
      this.queue.push({ taskId, execute, resolve, reject });
      this.ensureDraining();
    });
  }

  /** Current number of queued requests. */
  getQueueDepth(): number {
    return this.queue.length;
  }

  /** Stop the drain timer and reject all queued requests. */
  dispose(): void {
    if (this.drainTimer !== null) {
      clearInterval(this.drainTimer);
      this.drainTimer = null;
    }
    for (const entry of this.queue) {
      entry.reject(new RateLimitError("Queue disposed", this.queue.length));
    }
    this.queue.length = 0;
  }

  private ensureDraining(): void {
    if (this.drainTimer !== null) return;
    this.drainTimer = setInterval(() => {
      void this.drainOne();
    }, this.config.drainIntervalMs);
  }

  private async drainOne(): Promise<void> {
    if (this.draining || this.queue.length === 0) {
      if (this.queue.length === 0 && this.drainTimer !== null) {
        clearInterval(this.drainTimer);
        this.drainTimer = null;
      }
      return;
    }

    this.draining = true;
    const entry = this.queue.shift()!;

    try {
      const result = await entry.execute();
      entry.resolve(result);
    } catch (err) {
      entry.reject(err);
    } finally {
      this.draining = false;
    }
  }
}

// ---------------------------------------------------------------------------
// State Persistence
// ---------------------------------------------------------------------------

/** Interface for persisting orchestration state. */
export interface IStateStore {
  save(key: string, state: unknown): Promise<void>;
  load<T>(key: string): Promise<T | null>;
  delete(key: string): Promise<void>;
}

/**
 * Manages orchestration state checkpoints for crash recovery.
 *
 * Periodically serializes the current `ExecutionPlan` state so that
 * execution can resume after a crash or extension restart.
 */
export class ExecutionStateManager {
  private autosaveTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: IStateStore,
    private readonly autosaveIntervalMs: number = 30_000
  ) {}

  /** Save a checkpoint of the current execution plan. */
  async checkpoint(planId: string, plan: ExecutionPlan): Promise<void> {
    try {
      await this.store.save(`plan-${planId}`, plan);
    } catch (err) {
      throw new StatePersistenceError("save", String(err), err);
    }
  }

  /** Load the last checkpoint for a plan. Returns null if none exists. */
  async loadCheckpoint(planId: string): Promise<ExecutionPlan | null> {
    try {
      return await this.store.load<ExecutionPlan>(`plan-${planId}`);
    } catch (err) {
      throw new StatePersistenceError("load", String(err), err);
    }
  }

  /** Clear a checkpoint after successful completion. */
  async clearCheckpoint(planId: string): Promise<void> {
    try {
      await this.store.delete(`plan-${planId}`);
    } catch (err) {
      throw new StatePersistenceError("delete", String(err), err);
    }
  }

  /** Start periodic auto-save of the execution plan. */
  startAutosave(planId: string, getPlan: () => ExecutionPlan): void {
    this.stopAutosave();
    this.autosaveTimer = setInterval(() => {
      void this.checkpoint(planId, getPlan()).catch(() => {
        // Non-fatal — logged by the caller's error handler
      });
    }, this.autosaveIntervalMs);
  }

  /** Stop the auto-save timer. */
  stopAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }

  dispose(): void {
    this.stopAutosave();
  }
}

// ---------------------------------------------------------------------------
// Git Service
// ---------------------------------------------------------------------------

export interface GitLogEntry {
  readonly hash: string;
  readonly shortHash: string;
  readonly message: string;
  readonly timestamp: number;
}

/** Interface for git operations used in checkpoint/rollback. */
export interface IGitService {
  isGitRepo(workspaceRoot: string): Promise<boolean>;
  commit(workspaceRoot: string, message: string): Promise<void>;
  getLog(workspaceRoot: string, maxEntries?: number): Promise<readonly GitLogEntry[]>;
  rollbackToCommit(workspaceRoot: string, commitHash: string): Promise<void>;
  /** Soft rollback — resets to commit but keeps changes staged. */
  softRollback(workspaceRoot: string, commitHash: string): Promise<void>;
}

/**
 * Git service implementation using child_process.exec.
 * Throws `GitOperationError` on non-zero exit codes.
 */
export class NodeGitService implements IGitService {
  async isGitRepo(workspaceRoot: string): Promise<boolean> {
    try {
      await this.exec("git rev-parse --is-inside-work-tree", workspaceRoot);
      return true;
    } catch {
      return false;
    }
  }

  async commit(workspaceRoot: string, message: string): Promise<void> {
    await this.exec("git add -A", workspaceRoot);
    await this.exec(`git commit -m ${this.shellEscape(message)} --allow-empty`, workspaceRoot);
  }

  async getLog(workspaceRoot: string, maxEntries: number = 20): Promise<readonly GitLogEntry[]> {
    const output = await this.exec(
      `git log --format="%H|%h|%s|%ct" -n ${maxEntries}`,
      workspaceRoot
    );
    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split("|");
        return {
          hash: parts[0] ?? "",
          shortHash: parts[1] ?? "",
          message: parts[2] ?? "",
          timestamp: parseInt(parts[3] ?? "0", 10) * 1000,
        };
      });
  }

  async rollbackToCommit(workspaceRoot: string, commitHash: string): Promise<void> {
    await this.exec(`git reset --hard ${this.shellEscape(commitHash)}`, workspaceRoot);
  }

  async softRollback(workspaceRoot: string, commitHash: string): Promise<void> {
    await this.exec(`git reset --soft ${this.shellEscape(commitHash)}`, workspaceRoot);
  }

  private async exec(command: string, cwd: string): Promise<string> {
    const { exec } = await import("child_process");
    return new Promise<string>((resolve, reject) => {
      exec(command, { cwd }, (error, stdout, stderr) => {
        if (error) {
          reject(
            new GitOperationError(
              command.split(" ").slice(0, 2).join(" "),
              error.code ?? 1,
              stderr ?? error.message
            )
          );
          return;
        }
        resolve(stdout);
      });
    });
  }

  private shellEscape(str: string): string {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
}
