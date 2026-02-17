import type { AgentRole } from "../intelligence/types";
import type { AgentExecutionError } from "../execution/agents/types";
import type { SessionStatus } from "../orchestration/types";
import type { OutputConflictType } from "../orchestration/conflictResolver";

// ===========================================================================
// WebFlow Error Hierarchy
//
// Typed Error classes with codes, user-friendly messages, and type guards.
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Base error
// ---------------------------------------------------------------------------

/** Base class for all WebFlow errors. Carries a machine-readable code and
 *  a user-facing message safe for display in the chat stream. */
export class WebFlowError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(code: string, message: string, userMessage?: string, cause?: unknown) {
    super(message);
    this.name = "WebFlowError";
    this.code = code;
    this.userMessage = userMessage ?? "Something went wrong. Please try again.";
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Concrete error types
// ---------------------------------------------------------------------------

/** Wraps the plain-object `AgentExecutionError` thrown by BaseAgent.execute()
 *  into a proper Error class with stack trace and instanceof narrowing. */
export class AgentFailureError extends WebFlowError {
  readonly agentCode: AgentExecutionError["code"];
  readonly taskId: string;
  readonly agent: AgentRole;
  readonly sessionStatus: SessionStatus | null;

  constructor(
    agentCode: AgentExecutionError["code"],
    message: string,
    taskId: string,
    agent: AgentRole,
    sessionStatus: SessionStatus | null,
    cause?: unknown
  ) {
    const userMsg = agentCode === "session-cancelled"
      ? "The operation was cancelled."
      : agentCode === "empty-output"
        ? `Agent ${agent} produced no output. Try rephrasing your request.`
        : `Agent ${agent} encountered an error: ${message}`;

    super(`agent-${agentCode}`, message, userMsg, cause);
    this.name = "AgentFailureError";
    this.agentCode = agentCode;
    this.taskId = taskId;
    this.agent = agent;
    this.sessionStatus = sessionStatus;
  }

  /** Convert the plain-object AgentExecutionError to a class instance. */
  static fromPlainObject(err: AgentExecutionError): AgentFailureError {
    return new AgentFailureError(
      err.code,
      err.message,
      err.taskId,
      err.agent,
      err.sessionStatus,
      err
    );
  }
}

/** Thrown when all fallback agents have been exhausted for a task. */
export class AllAgentsExhaustedError extends WebFlowError {
  readonly triedAgents: readonly AgentRole[];
  readonly taskId: string;

  constructor(taskId: string, triedAgents: readonly AgentRole[]) {
    super(
      "all-agents-exhausted",
      `All agents exhausted for task "${taskId}": tried ${triedAgents.join(", ")}`,
      `All available agents failed for this task. Tried: ${triedAgents.join(", ")}. Please try again or simplify the request.`
    );
    this.name = "AllAgentsExhaustedError";
    this.triedAgents = triedAgents;
    this.taskId = taskId;
  }
}

/** Thrown when rate limiting persists or the queue is at capacity. */
export class RateLimitError extends WebFlowError {
  readonly queueDepth: number;

  constructor(message: string, queueDepth: number = 0) {
    super(
      "rate-limit",
      message,
      "The AI service is rate-limited. Your request has been queued and will retry automatically."
    );
    this.name = "RateLimitError";
    this.queueDepth = queueDepth;
  }
}

/** Thrown when a git CLI operation fails. */
export class GitOperationError extends WebFlowError {
  readonly gitCommand: string;
  readonly exitCode: number;

  constructor(gitCommand: string, exitCode: number, stderr: string) {
    super(
      "git-error",
      `Git command "${gitCommand}" failed (exit ${exitCode}): ${stderr}`,
      `A git operation failed. Make sure git is installed and the workspace is a git repository.`
    );
    this.name = "GitOperationError";
    this.gitCommand = gitCommand;
    this.exitCode = exitCode;
  }
}

/** Thrown when state checkpoint save/load fails. Non-fatal — logged only. */
export class StatePersistenceError extends WebFlowError {
  constructor(operation: "save" | "load" | "delete", detail: string, cause?: unknown) {
    super(
      "state-persistence",
      `State ${operation} failed: ${detail}`,
      "Could not save orchestration state. Progress may not survive a restart.",
      cause
    );
    this.name = "StatePersistenceError";
  }
}

/** Thrown when a conflict cannot be auto-resolved and needs user input. */
export class ConflictEscalationError extends WebFlowError {
  readonly conflictId: string;
  readonly conflictType: OutputConflictType;

  constructor(conflictId: string, conflictType: OutputConflictType, description: string) {
    super(
      "conflict-escalation",
      `Conflict "${conflictId}" (${conflictType}) requires user resolution: ${description}`,
      `A conflict was detected that needs your input: ${description}`
    );
    this.name = "ConflictEscalationError";
    this.conflictId = conflictId;
    this.conflictType = conflictType;
  }
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/** Recognizes the plain-object AgentExecutionError shape (duck typing). */
export function isAgentExecutionError(err: unknown): err is AgentExecutionError {
  if (err === null || err === undefined || typeof err !== "object") return false;
  const obj = err as Record<string, unknown>;
  return (
    typeof obj["code"] === "string" &&
    typeof obj["message"] === "string" &&
    typeof obj["taskId"] === "string" &&
    typeof obj["agent"] === "string" &&
    ["session-failed", "session-cancelled", "parse-error", "empty-output"].includes(
      obj["code"] as string
    )
  );
}

/** Recognizes any WebFlowError class instance. */
export function isWebFlowError(err: unknown): err is WebFlowError {
  return err instanceof WebFlowError;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Converts any thrown value into a `WebFlowError`.
 *
 * - AgentExecutionError plain-objects → AgentFailureError
 * - Existing WebFlowError → passthrough
 * - Native Error → wrapped WebFlowError
 * - Anything else → stringified WebFlowError
 */
export function normalizeError(err: unknown): WebFlowError {
  if (err instanceof WebFlowError) return err;

  if (isAgentExecutionError(err)) {
    return AgentFailureError.fromPlainObject(err);
  }

  if (err instanceof Error) {
    return new WebFlowError(
      "unknown",
      err.message,
      `An unexpected error occurred: ${err.message}`,
      err
    );
  }

  const message = String(err);
  return new WebFlowError("unknown", message, `An unexpected error occurred: ${message}`, err);
}

/**
 * Returns a user-facing message string safe for display.
 * Uses the `userMessage` from WebFlowError or falls back to a generic message.
 */
export function getUserMessage(err: unknown): string {
  const normalized = normalizeError(err);
  return normalized.userMessage;
}
