import type {
  ExecutionPlan,
  ExecutionPhase,
  ExecutionTask,
  PhaseStatus,
} from "../intelligence/types";
import type { AgentFactory } from "../execution/agents/agentFactory";
import type { AgentProgressCallback } from "../execution/agents/baseAgent";
import type { AgentOutput } from "./contextCoordinator";
import type { ContextCoordinator } from "./contextCoordinator";
import type { DependencyResolver, ExecutionBatch } from "./dependencyResolver";
import type { QualityGateRunner, QualityReport, QualityContext } from "../execution/qualityGates";
import type { CodeWriter, CodeWriteResult } from "./codeWriter";
import type { AgentFallbackCoordinator } from "../utils/errorRecovery";
import type { ExecutionStateManager } from "../utils/errorRecovery";
import type { IEventEmitter, IEventEmitterFactory } from "./types";

// ===========================================================================
// ExecutionEngine
//
// Bridges the planning layer to the execution layer. Takes an ExecutionPlan
// and runs it phase by phase, batch by batch, dispatching tasks to agents,
// validating output, and writing code to the workspace.
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EngineState =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface EngineEvent {
  readonly state: EngineState;
  readonly phaseId: string | null;
  readonly completedTasks: number;
  readonly totalTasks: number;
  readonly message: string;
  readonly timestamp: number;
}

export interface TaskResult {
  readonly taskId: string;
  readonly success: boolean;
  readonly output?: AgentOutput;
  readonly qualityReport?: QualityReport;
  readonly filesWritten?: readonly string[];
  readonly error?: string;
  readonly retryCount: number;
}

export interface ExecutionSummary {
  readonly state: EngineState;
  readonly taskResults: readonly TaskResult[];
  readonly totalDurationMs: number;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
  readonly tasksSkipped: number;
  readonly filesWritten: readonly string[];
}

export interface EngineConfig {
  readonly workspaceRoot: string;
  readonly maxQualityRetries: number;
  readonly continueOnTaskFailure: boolean;
  readonly enableCheckpoints: boolean;
}

export interface EngineDeps {
  readonly agentFactory: AgentFactory;
  readonly dependencyResolver: DependencyResolver;
  readonly contextCoordinator: ContextCoordinator;
  readonly qualityGateRunner: QualityGateRunner;
  readonly codeWriter: CodeWriter;
  readonly stateManager: ExecutionStateManager;
  readonly fallbackCoordinator: AgentFallbackCoordinator;
  readonly emitterFactory: IEventEmitterFactory;
  readonly logger: { info(msg: string): void; error(msg: string): void };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export class ExecutionEngine {
  private _state: EngineState = "idle";
  private plan: ExecutionPlan | null = null;
  private readonly taskResults = new Map<string, TaskResult>();
  private startTime = 0;

  // Pause mechanics
  private pauseResolver: (() => void) | null = null;

  // Public events
  readonly onStateChange: IEventEmitter<EngineEvent>;
  readonly onTaskComplete: IEventEmitter<TaskResult>;
  readonly onPhaseComplete: IEventEmitter<{ phaseId: string; status: PhaseStatus }>;

  constructor(
    private readonly config: EngineConfig,
    private readonly deps: EngineDeps
  ) {
    this.onStateChange = deps.emitterFactory.create<EngineEvent>();
    this.onTaskComplete = deps.emitterFactory.create<TaskResult>();
    this.onPhaseComplete = deps.emitterFactory.create<{ phaseId: string; status: PhaseStatus }>();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  get state(): EngineState {
    return this._state;
  }

  async execute(plan: ExecutionPlan): Promise<ExecutionSummary> {
    if (this._state !== "idle") {
      throw new Error(`Engine is already in state "${this._state}"`);
    }

    this.plan = plan;
    this.startTime = Date.now();
    this.taskResults.clear();
    this.setState("running", "Execution started");

    // Start periodic checkpoints
    const planId = `${plan.templateName}-${this.startTime}`;
    if (this.config.enableCheckpoints) {
      this.deps.stateManager.startAutosave(planId, () => plan);
    }

    try {
      await this.executePhases();

      const hasFailures = [...this.taskResults.values()].some((r) => !r.success);
      this.setState(
        hasFailures ? "failed" : "completed",
        hasFailures ? "Execution finished with failures" : "All tasks completed successfully"
      );
    } catch {
      if ((this._state as EngineState) !== "cancelled") {
        this.setState("failed", "Execution failed with unexpected error");
      }
    } finally {
      this.deps.stateManager.stopAutosave();
      if (this.config.enableCheckpoints) {
        try {
          await this.deps.stateManager.clearCheckpoint(planId);
        } catch {
          // Non-critical
        }
      }
    }

    return this.buildSummary();
  }

  pause(): void {
    if (this._state === "running") {
      this.setState("paused", "Execution paused");
    }
  }

  resume(): void {
    if (this._state === "paused") {
      this.setState("running", "Execution resumed");
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
    }
  }

  cancel(): void {
    if (this._state === "running" || this._state === "paused") {
      this.setState("cancelled", "Execution cancelled");
      // Unblock if paused
      if (this.pauseResolver) {
        this.pauseResolver();
        this.pauseResolver = null;
      }
    }
  }

  getPartialResults(): readonly TaskResult[] {
    return [...this.taskResults.values()];
  }

  dispose(): void {
    this.onStateChange.dispose();
    this.onTaskComplete.dispose();
    this.onPhaseComplete.dispose();
  }

  // -------------------------------------------------------------------------
  // Private — Phase/Batch execution
  // -------------------------------------------------------------------------

  private async executePhases(): Promise<void> {
    const plan = this.plan!;

    for (const phase of plan.phases) {
      if ((this._state as EngineState) === "cancelled") break;

      phase.status = "running";
      this.deps.logger.info(`Phase "${phase.label}" started`);

      await this.executePhase(phase);

      // Determine phase outcome
      const taskStatuses = phase.tasks.map((t) => t.status);
      if (taskStatuses.every((s) => s === "completed")) {
        phase.status = "completed";
      } else if (taskStatuses.some((s) => s === "failed")) {
        phase.status = "failed";
      } else {
        phase.status = "completed";
      }

      this.onPhaseComplete.fire({ phaseId: phase.id, status: phase.status });
      this.deps.logger.info(`Phase "${phase.label}" → ${phase.status}`);
    }
  }

  private async executePhase(phase: ExecutionPhase): Promise<void> {
    const batches = this.deps.dependencyResolver.buildBatches(phase.tasks);

    for (const batch of batches) {
      if ((this._state as EngineState) === "cancelled") break;

      // Pause check between batches
      await this.checkPausePoint();
      if ((this._state as EngineState) === "cancelled") break;

      await this.executeBatch(batch, phase);
    }
  }

  private async executeBatch(
    batch: ExecutionBatch,
    phase: ExecutionPhase
  ): Promise<void> {
    this.deps.logger.info(
      `Batch ${batch.index}: ${batch.tasks.length} task(s) in parallel`
    );

    // Filter to only tasks that are still pending (not failed upstream)
    const runnableTasks = batch.tasks.filter((t) => t.status === "pending");

    const results = await Promise.allSettled(
      runnableTasks.map((task) => this.executeTask(task))
    );

    // Record results
    for (let i = 0; i < runnableTasks.length; i++) {
      const task = runnableTasks[i]!;
      const result = results[i]!;

      if (result.status === "fulfilled") {
        this.taskResults.set(task.id, result.value);
        this.onTaskComplete.fire(result.value);
      } else {
        const taskResult: TaskResult = {
          taskId: task.id,
          success: false,
          error: result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
          retryCount: 0,
        };
        this.taskResults.set(task.id, taskResult);
        this.onTaskComplete.fire(taskResult);
      }
    }

    // Mark downstream tasks as skipped if dependencies failed
    this.markUnreachableTasks(phase);

    // Checkpoint after each batch
    if (this.config.enableCheckpoints && this.plan) {
      const planId = `${this.plan.templateName}-${this.startTime}`;
      try {
        await this.deps.stateManager.checkpoint(planId, this.plan);
      } catch {
        // Non-critical
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private — Single task execution
  // -------------------------------------------------------------------------

  private async executeTask(task: ExecutionTask): Promise<TaskResult> {
    task.status = "running";
    this.emitStateChange(`Task "${task.label}" started`);

    try {
      // 1. Get context for this task
      const context = this.deps.contextCoordinator.getContextForTask(task);

      // 2. Execute with agent fallback
      const onProgress: AgentProgressCallback = (progress) => {
        this.deps.logger.info(
          `[${task.id}] ${progress.stage}: ${progress.message}`
        );
      };

      const result = await this.deps.fallbackCoordinator.executeWithFallback(
        task,
        context,
        task.agent,
        onProgress
      );

      // 3. Run quality gates
      const qualityContext: QualityContext = {
        taskId: task.id,
        agent: task.agent,
        projectLanguage: "typescript",
        strictMode: false,
      };

      let finalOutput = result.output;
      let qualityReport = this.deps.qualityGateRunner.check(finalOutput, qualityContext);

      // Quality gate retry loop
      let qualityRetries = 0;
      while (
        !qualityReport.passed &&
        qualityReport.errorCount > 0 &&
        qualityRetries < this.config.maxQualityRetries
      ) {
        qualityRetries++;
        this.deps.logger.info(
          `[${task.id}] Quality gate failed (${qualityReport.errorCount} errors), retry ${qualityRetries}/${this.config.maxQualityRetries}`
        );

        // Re-execute with quality feedback appended to prompt
        const feedbackTask: ExecutionTask = {
          ...task,
          prompt: `${task.prompt}\n\n--- QUALITY FEEDBACK (fix these issues) ---\n${qualityReport.feedback}`,
        };

        try {
          const retryResult = await this.deps.fallbackCoordinator.executeWithFallback(
            feedbackTask,
            context,
            task.agent,
            onProgress
          );
          finalOutput = retryResult.output;
          qualityReport = this.deps.qualityGateRunner.check(finalOutput, qualityContext);
        } catch {
          // If retry fails, keep the original output
          break;
        }
      }

      // 4. Update shared context with agent output
      this.deps.contextCoordinator.updateFromAgentOutput(finalOutput);

      // 5. Extract code and write to workspace
      let codeResult: CodeWriteResult = {
        filesWritten: [],
        filesSkipped: [],
        errors: [],
      };

      try {
        codeResult = await this.deps.codeWriter.extractAndWrite(
          this.config.workspaceRoot,
          finalOutput.output
        );

        if (codeResult.filesWritten.length > 0) {
          this.deps.logger.info(
            `[${task.id}] Wrote ${codeResult.filesWritten.length} file(s)`
          );
        }
      } catch (err) {
        this.deps.logger.error(
          `[${task.id}] Code write error: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      // 6. Mark task completed
      task.status = "completed";
      this.emitStateChange(`Task "${task.label}" completed`);

      return {
        taskId: task.id,
        success: true,
        output: finalOutput,
        qualityReport,
        filesWritten: codeResult.filesWritten,
        retryCount: qualityRetries,
      };
    } catch (err) {
      task.status = "failed";
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.deps.logger.error(`[${task.id}] Failed: ${errorMessage}`);
      this.emitStateChange(`Task "${task.label}" failed`);

      if (!this.config.continueOnTaskFailure) {
        throw err;
      }

      return {
        taskId: task.id,
        success: false,
        error: errorMessage,
        retryCount: 0,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Private — Helpers
  // -------------------------------------------------------------------------

  private async checkPausePoint(): Promise<void> {
    if (this._state !== "paused") return;

    await new Promise<void>((resolve) => {
      this.pauseResolver = resolve;
    });
  }

  private markUnreachableTasks(phase: ExecutionPhase): void {
    const failedIds = new Set(
      phase.tasks.filter((t) => t.status === "failed").map((t) => t.id)
    );

    if (failedIds.size === 0) return;

    for (const task of phase.tasks) {
      if (task.status !== "pending") continue;
      const blockedByFailed = task.dependsOn.some((depId) => failedIds.has(depId));
      if (blockedByFailed) {
        task.status = "skipped";
        this.deps.logger.info(
          `[${task.id}] Skipped — depends on failed task`
        );
      }
    }
  }

  private setState(state: EngineState, message: string): void {
    this._state = state;
    this.emitStateChange(message);
  }

  private emitStateChange(message: string): void {
    const completed = [...this.taskResults.values()].filter((r) => r.success).length;
    const total = this.plan?.stats.totalTasks ?? 0;

    this.onStateChange.fire({
      state: this._state,
      phaseId: this.plan?.phases.find((p) => p.status === "running")?.id ?? null,
      completedTasks: completed,
      totalTasks: total,
      message,
      timestamp: Date.now(),
    });
  }

  private buildSummary(): ExecutionSummary {
    const results = [...this.taskResults.values()];
    const allFilesWritten = results.flatMap((r) => r.filesWritten ?? []);

    return {
      state: this._state,
      taskResults: results,
      totalDurationMs: Date.now() - this.startTime,
      tasksCompleted: results.filter((r) => r.success).length,
      tasksFailed: results.filter((r) => !r.success).length,
      tasksSkipped: this.plan?.phases
        .flatMap((p) => p.tasks)
        .filter((t) => t.status === "skipped").length ?? 0,
      filesWritten: allFilesWritten,
    };
  }
}
