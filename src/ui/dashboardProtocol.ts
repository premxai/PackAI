import type { AgentRole, ExecutionPlan, TaskStatus, PhaseStatus } from "../intelligence/types";
import type { SessionStatus, SessionProgress } from "../orchestration/types";
import type { OutputConflict, ResolutionOption } from "../orchestration/conflictResolver";

// ===========================================================================
// Dashboard Protocol
//
// Typed message contract between the extension host and the dashboard
// webview. All types are serializable (no functions or class instances).
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Extension → Webview messages
// ---------------------------------------------------------------------------

export type DashboardMessage =
  | { readonly type: "init"; readonly payload: DashboardState }
  | { readonly type: "phase-update"; readonly payload: PhaseSnapshot }
  | { readonly type: "task-update"; readonly payload: TaskSnapshot }
  | { readonly type: "agent-update"; readonly payload: AgentSnapshot }
  | { readonly type: "progress"; readonly payload: ProgressSnapshot }
  | { readonly type: "activity"; readonly payload: ActivityEntry }
  | { readonly type: "conflict"; readonly payload: ConflictSnapshot }
  | { readonly type: "conflict-resolved"; readonly payload: { readonly conflictId: string } }
  | { readonly type: "stats"; readonly payload: StatsSnapshot }
  | { readonly type: "agent-chat-token"; readonly agent: AgentRole; readonly token: string }
  | { readonly type: "agent-chat-done"; readonly agent: AgentRole }
  | { readonly type: "agent-chat-error"; readonly agent: AgentRole; readonly error: string };

// ---------------------------------------------------------------------------
// Webview → Extension messages
// ---------------------------------------------------------------------------

export type DashboardAction =
  | { readonly type: "pause"; readonly payload: { readonly taskId: string } }
  | { readonly type: "resume"; readonly payload: { readonly taskId: string } }
  | { readonly type: "cancel"; readonly payload: { readonly taskId: string } }
  | {
      readonly type: "resolve-conflict";
      readonly payload: {
        readonly conflictId: string;
        readonly strategy: string;
        readonly winningTaskId?: string;
      };
    }
  | { readonly type: "retry-task"; readonly payload: { readonly taskId: string } }
  | { readonly type: "request-state" }
  | { readonly type: "assign-agent"; readonly taskId: string; readonly agent: AgentRole }
  | { readonly type: "start-execution" }
  | { readonly type: "agent-chat-message"; readonly agent: AgentRole; readonly message: string };

// ---------------------------------------------------------------------------
// Snapshot types
// ---------------------------------------------------------------------------

/** Full dashboard state sent on init and request-state. */
export interface DashboardState {
  readonly mode: "review" | "running";
  readonly phases: readonly PhaseSnapshot[];
  readonly agents: readonly AgentSnapshot[];
  readonly activities: readonly ActivityEntry[];
  readonly conflicts: readonly ConflictSnapshot[];
  readonly stats: StatsSnapshot;
}

export interface PhaseSnapshot {
  readonly id: string;
  readonly label: string;
  readonly status: PhaseStatus;
  readonly tasks: readonly TaskSnapshot[];
}

export interface TaskSnapshot {
  readonly id: string;
  readonly label: string;
  readonly agent: AgentRole;
  readonly status: TaskStatus;
  readonly stage?: string;
  readonly progress?: number;
  readonly message?: string;
  readonly elapsedMs?: number;
}

export interface AgentSnapshot {
  readonly role: AgentRole;
  readonly status: "idle" | "busy" | "error";
  readonly currentTaskId?: string;
  readonly currentTaskLabel?: string;
  readonly tasksCompleted: number;
  readonly tasksFailed: number;
}

export interface ProgressSnapshot {
  readonly taskId: string;
  readonly percent: number;
  readonly message: string;
  readonly tokensGenerated: number;
  readonly elapsedMs: number;
}

export type ActivityLevel = "info" | "success" | "warning" | "error";

export interface ActivityEntry {
  readonly timestamp: number;
  readonly agent: string;
  readonly message: string;
  readonly level: ActivityLevel;
}

export interface ConflictSnapshot {
  readonly id: string;
  readonly type: string;
  readonly description: string;
  readonly severity: "low" | "medium" | "high";
  readonly options: readonly {
    readonly label: string;
    readonly strategy: string;
    readonly description: string;
  }[];
}

export interface StatsSnapshot {
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly failedTasks: number;
  readonly runningTasks: number;
  readonly estimatedMinutesRemaining: number;
  readonly elapsedMs: number;
}

// ---------------------------------------------------------------------------
// DashboardStateBuilder
// ---------------------------------------------------------------------------

/** Builds serializable dashboard state from domain objects. */
export class DashboardStateBuilder {
  private readonly agentStats: Map<
    AgentRole,
    { completed: number; failed: number; currentTaskId?: string; currentTaskLabel?: string }
  > = new Map([
    ["claude", { completed: 0, failed: 0 }],
    ["copilot", { completed: 0, failed: 0 }],
    ["codex", { completed: 0, failed: 0 }],
  ]);
  private readonly activities: ActivityEntry[] = [];
  private readonly conflicts: ConflictSnapshot[] = [];
  private startTime: number = Date.now();

  /** Build phase snapshots from an execution plan. */
  buildPhaseSnapshots(plan: ExecutionPlan): readonly PhaseSnapshot[] {
    return plan.phases.map((phase) => ({
      id: phase.id,
      label: phase.label,
      status: phase.status,
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        label: task.label,
        agent: task.agent,
        status: task.status,
      })),
    }));
  }

  /** Build a task snapshot from a session status. */
  buildTaskSnapshot(sessionStatus: SessionStatus): TaskSnapshot {
    return {
      id: sessionStatus.taskId,
      label: sessionStatus.taskId,
      agent: sessionStatus.agent,
      status: sessionStatus.state === "completed"
        ? "completed"
        : sessionStatus.state === "failed"
          ? "failed"
          : sessionStatus.state === "cancelled"
            ? "skipped"
            : sessionStatus.state === "running"
              ? "running"
              : "pending",
      progress: sessionStatus.progress?.percent,
      message: sessionStatus.progress?.message,
      elapsedMs: sessionStatus.progress?.elapsedMs,
    };
  }

  /** Build a progress snapshot from a session progress event. */
  buildProgressSnapshot(progress: SessionProgress): ProgressSnapshot {
    return {
      taskId: progress.sessionId,
      percent: progress.percent,
      message: progress.message,
      tokensGenerated: progress.tokensGenerated,
      elapsedMs: progress.elapsedMs,
    };
  }

  /** Build agent snapshots from current tracking state. */
  buildAgentSnapshots(): readonly AgentSnapshot[] {
    const roles: AgentRole[] = ["claude", "copilot", "codex"];
    return roles.map((role) => {
      const stats = this.agentStats.get(role)!;
      const isBusy = stats.currentTaskId !== undefined;
      return {
        role,
        status: isBusy ? "busy" as const : "idle" as const,
        currentTaskId: stats.currentTaskId,
        currentTaskLabel: stats.currentTaskLabel,
        tasksCompleted: stats.completed,
        tasksFailed: stats.failed,
      };
    });
  }

  /** Build a conflict snapshot from a domain conflict. */
  buildConflictSnapshot(
    conflict: OutputConflict,
    options: readonly ResolutionOption[]
  ): ConflictSnapshot {
    return {
      id: conflict.id,
      type: conflict.type,
      description: conflict.description,
      severity: "severity" in conflict
        ? (conflict as { severity: "low" | "medium" | "high" }).severity
        : "medium",
      options: options.map((o) => ({
        label: o.label,
        strategy: o.strategy,
        description: o.description,
      })),
    };
  }

  /** Build stats from current tracking state. */
  buildStats(plan: ExecutionPlan): StatsSnapshot {
    let completed = 0;
    let failed = 0;
    let running = 0;
    const total = plan.stats.totalTasks;

    for (const phase of plan.phases) {
      for (const task of phase.tasks) {
        if (task.status === "completed") completed++;
        else if (task.status === "failed") failed++;
        else if (task.status === "running") running++;
      }
    }

    const elapsed = Date.now() - this.startTime;
    const avgTimePerTask =
      completed > 0 ? elapsed / completed : plan.estimatedTotalMinutes * 60000 / total;
    const remaining = (total - completed - failed) * avgTimePerTask;

    return {
      totalTasks: total,
      completedTasks: completed,
      failedTasks: failed,
      runningTasks: running,
      estimatedMinutesRemaining: Math.max(0, Math.round(remaining / 60000)),
      elapsedMs: elapsed,
    };
  }

  /** Create an activity entry. */
  createActivity(
    agent: string,
    message: string,
    level: ActivityLevel
  ): ActivityEntry {
    const entry: ActivityEntry = {
      timestamp: Date.now(),
      agent,
      message,
      level,
    };
    this.activities.push(entry);
    return entry;
  }

  /** Record that an agent started a task. */
  recordAgentStarted(agent: AgentRole, taskId: string, taskLabel: string): void {
    const stats = this.agentStats.get(agent);
    if (stats) {
      stats.currentTaskId = taskId;
      stats.currentTaskLabel = taskLabel;
    }
  }

  /** Record that an agent completed a task. */
  recordAgentCompleted(agent: AgentRole): void {
    const stats = this.agentStats.get(agent);
    if (stats) {
      stats.completed++;
      stats.currentTaskId = undefined;
      stats.currentTaskLabel = undefined;
    }
  }

  /** Record that an agent failed a task. */
  recordAgentFailed(agent: AgentRole): void {
    const stats = this.agentStats.get(agent);
    if (stats) {
      stats.failed++;
      stats.currentTaskId = undefined;
      stats.currentTaskLabel = undefined;
    }
  }

  /** Add a conflict. */
  addConflict(snapshot: ConflictSnapshot): void {
    this.conflicts.push(snapshot);
  }

  /** Remove a resolved conflict. */
  removeConflict(conflictId: string): void {
    const idx = this.conflicts.findIndex((c) => c.id === conflictId);
    if (idx !== -1) this.conflicts.splice(idx, 1);
  }

  /** Get current activities (most recent first, limited). */
  getActivities(limit: number = 50): readonly ActivityEntry[] {
    return this.activities.slice(-limit);
  }

  /** Get current conflicts. */
  getConflicts(): readonly ConflictSnapshot[] {
    return [...this.conflicts];
  }

  /** Set the execution start time. */
  setStartTime(time: number): void {
    this.startTime = time;
  }

  /** Build the full dashboard state. */
  buildState(plan: ExecutionPlan, mode: "review" | "running" = "running"): DashboardState {
    return {
      mode,
      phases: this.buildPhaseSnapshots(plan),
      agents: this.buildAgentSnapshots(),
      activities: this.getActivities(),
      conflicts: this.getConflicts(),
      stats: this.buildStats(plan),
    };
  }
}
