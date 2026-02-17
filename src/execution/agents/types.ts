import type { AgentRole } from "../../intelligence/types";
import type { AgentOutput, ContextSubset } from "../../orchestration/contextCoordinator";
import type { SessionStatus } from "../../orchestration/types";

// ===========================================================================
// Execution Agent types
//
// Types shared by the base agent class and all agent subclasses.
// No VS Code imports — fully testable.
// ===========================================================================

// Re-export for consumer convenience
export type { AgentOutput, ContextSubset };

// ---------------------------------------------------------------------------
// Agent execution result
// ---------------------------------------------------------------------------

/** What an agent returns after successfully executing a task. */
export interface AgentExecutionResult {
  readonly output: AgentOutput;
  readonly sessionStatus: SessionStatus;
}

// ---------------------------------------------------------------------------
// Agent execution error
// ---------------------------------------------------------------------------

/** Thrown when an agent fails to produce usable output. */
export interface AgentExecutionError {
  readonly code:
    | "session-failed"
    | "session-cancelled"
    | "parse-error"
    | "empty-output";
  readonly message: string;
  readonly taskId: string;
  readonly agent: AgentRole;
  readonly sessionStatus: SessionStatus | null;
}

// ---------------------------------------------------------------------------
// Progress events
// ---------------------------------------------------------------------------

/** Stages of agent execution, emitted via progress callback. */
export type AgentExecutionStage =
  | "context-enrichment"
  | "session-created"
  | "streaming"
  | "post-processing"
  | "completed"
  | "failed";

/** Emitted by an agent as it progresses through execution stages. */
export interface AgentExecutionProgress {
  readonly taskId: string;
  readonly agent: AgentRole;
  readonly stage: AgentExecutionStage;
  readonly message: string;
}
