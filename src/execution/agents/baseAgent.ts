import type { AgentRole, ExecutionTask } from "../../intelligence/types";
import type { AgentOutput, ContextSubset } from "../../orchestration/contextCoordinator";
import type { ContextDeclaration } from "../../orchestration/contextCoordinator";
import type { SessionStatus } from "../../orchestration/types";
import type { SessionManager } from "../../orchestration/sessionManager";
import type {
  AgentExecutionResult,
  AgentExecutionError,
  AgentExecutionProgress,
  AgentExecutionStage,
} from "./types";

// ===========================================================================
// BaseAgent
//
// Abstract base class for all agent wrappers. Implements the shared
// execution lifecycle: context enrichment → session creation → session.run()
// → post-processing → AgentOutput. Subclasses provide buildPrompt and
// parseOutput to differentiate their behaviour.
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

/** Callback for progress events emitted during agent execution. */
export type AgentProgressCallback = (
  progress: AgentExecutionProgress
) => void;

/**
 * Abstract base class for all agent wrappers.
 *
 * Implements the shared execution lifecycle:
 * context enrichment → session creation → `session.run()` →
 * post-processing → {@link AgentOutput}.
 *
 * Subclasses implement {@link buildPrompt} and {@link parseOutput}
 * to differentiate their behaviour per agent role.
 */
export abstract class BaseAgent {
  protected readonly role: AgentRole;
  protected readonly sessionManager: SessionManager;

  constructor(role: AgentRole, sessionManager: SessionManager) {
    this.role = role;
    this.sessionManager = sessionManager;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Execute a task with context injection.
   *
   * Flow:
   *  1. Build enriched prompt (abstract: role-specific)
   *  2. Clone task with enriched prompt replacing original
   *  3. Create session via SessionManager
   *  4. Run session, watching for failures/cancellations
   *  5. Post-process raw output into AgentOutput (abstract: role-specific)
   */
  async execute(
    task: ExecutionTask,
    context: ContextSubset,
    onProgress?: AgentProgressCallback
  ): Promise<AgentExecutionResult> {
    // Stage 1: enrich prompt
    this.emitProgress(
      onProgress,
      task.id,
      "context-enrichment",
      `Building ${this.role} prompt for "${task.label}"`
    );
    const enrichedPrompt = this.buildPrompt(task, context);
    const enrichedTask: ExecutionTask = {
      ...task,
      prompt: enrichedPrompt,
    };

    // Stage 2: create session
    const session = await this.sessionManager.createSession(
      this.role,
      enrichedTask
    );
    this.emitProgress(
      onProgress,
      task.id,
      "session-created",
      `Session ${session.id} created for "${task.label}"`
    );

    // Stage 3: run session
    this.emitProgress(
      onProgress,
      task.id,
      "streaming",
      `${this.role}: streaming response...`
    );
    const sessionStatus = await session.run();

    // Handle non-completed states
    if (sessionStatus.state === "cancelled") {
      throw this.makeError(
        "session-cancelled",
        `Session cancelled for task "${task.id}"`,
        task.id,
        sessionStatus
      );
    }
    if (sessionStatus.state === "failed") {
      throw this.makeError(
        "session-failed",
        sessionStatus.error?.message ?? "Session failed",
        task.id,
        sessionStatus
      );
    }
    if (sessionStatus.output.trim() === "") {
      throw this.makeError(
        "empty-output",
        `${this.role} produced no output for task "${task.id}"`,
        task.id,
        sessionStatus
      );
    }

    // Stage 4: post-process
    this.emitProgress(
      onProgress,
      task.id,
      "post-processing",
      `Parsing ${this.role} output for declarations`
    );
    const agentOutput = this.parseOutput(task.id, sessionStatus);

    // Stage 5: done
    this.emitProgress(
      onProgress,
      task.id,
      "completed",
      `${this.role} completed "${task.label}"`
    );

    return { output: agentOutput, sessionStatus };
  }

  // -------------------------------------------------------------------------
  // Abstract — subclasses implement these
  // -------------------------------------------------------------------------

  /** Build the full enriched prompt for this agent's role. */
  protected abstract buildPrompt(
    task: ExecutionTask,
    context: ContextSubset
  ): string;

  /** Parse the raw session output into an AgentOutput. */
  protected abstract parseOutput(
    taskId: string,
    sessionStatus: SessionStatus
  ): AgentOutput;

  // -------------------------------------------------------------------------
  // Shared prompt construction helpers
  // -------------------------------------------------------------------------

  /** Build the standard context block that all agents prepend. */
  protected buildContextBlock(context: ContextSubset): string {
    if (
      context.entries.length === 0 ||
      context.summary === "No prior context available for this task."
    ) {
      return "";
    }
    return [
      "## Shared Project Context",
      "",
      context.summary,
      "",
    ].join("\n");
  }

  /** Build a section separator line. */
  protected buildSectionSeparator(label: string): string {
    return `\n---\n## ${label}\n`;
  }

  // -------------------------------------------------------------------------
  // Shared output parsing helpers
  // -------------------------------------------------------------------------

  /**
   * Extract ContextDeclarations from a DECLARATIONS block in agent output.
   *
   * Agents are instructed to emit declarations in this format:
   *   <!-- DECLARATIONS
   *   domain:key:value
   *   -->
   */
  protected extractDeclarations(
    output: string
  ): readonly ContextDeclaration[] {
    const pattern = /<!--\s*DECLARATIONS\s*([\s\S]*?)-->/i;
    const match = pattern.exec(output);
    if (!match?.[1]) return [];

    const declarations: ContextDeclaration[] = [];
    const lines = match[1].trim().split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const firstColon = trimmed.indexOf(":");
      if (firstColon === -1) continue;
      const secondColon = trimmed.indexOf(":", firstColon + 1);
      if (secondColon === -1) continue;

      const domain = trimmed.slice(0, firstColon).trim();
      const key = trimmed.slice(firstColon + 1, secondColon).trim();
      const value = trimmed.slice(secondColon + 1).trim();

      if (domain && key && value) {
        declarations.push({
          domain: domain as ContextDeclaration["domain"],
          key,
          value,
        });
      }
    }

    return declarations;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private emitProgress(
    callback: AgentProgressCallback | undefined,
    taskId: string,
    stage: AgentExecutionStage,
    message: string
  ): void {
    if (!callback) return;
    callback({ taskId, agent: this.role, stage, message });
  }

  private makeError(
    code: AgentExecutionError["code"],
    message: string,
    taskId: string,
    sessionStatus: SessionStatus | null
  ): AgentExecutionError {
    return { code, message, taskId, agent: this.role, sessionStatus };
  }
}
