import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DashboardStateBuilder,
  type DashboardMessage,
  type DashboardAction,
  type TaskSnapshot,
  type AgentSnapshot,
  type ProgressSnapshot,
  type ConflictSnapshot,
  type StatsSnapshot,
  type ActivityEntry,
} from "./dashboardProtocol";
import type {
  ExecutionPlan,
  ExecutionPhase,
  ExecutionTask,
  ProjectIntent,
} from "../intelligence/types";
import type { SessionStatus, SessionProgress } from "../orchestration/types";
import type { OutputConflict, ResolutionOption } from "../orchestration/conflictResolver";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeIntent(overrides?: Partial<ProjectIntent>): ProjectIntent {
  return {
    projectType: "fullstack",
    projectTypeConfidence: "high",
    features: ["auth"],
    stackHints: [],
    complexity: "moderate",
    rawInput: "test",
    normalizedInput: "test",
    ambiguities: [],
    ...overrides,
  };
}

function makeTask(overrides?: Partial<ExecutionTask>): ExecutionTask {
  return {
    id: "task-1",
    label: "Test Task",
    prompt: "Do something",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 5,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

function makePlan(overrides?: Partial<ExecutionPlan>): ExecutionPlan {
  const tasks = overrides?.phases?.[0]?.tasks ?? [
    makeTask({ id: "t1", label: "Task 1", agent: "claude", status: "completed" }),
    makeTask({ id: "t2", label: "Task 2", agent: "copilot", status: "running" }),
    makeTask({ id: "t3", label: "Task 3", agent: "codex", status: "pending" }),
  ];
  const phase: ExecutionPhase = {
    id: "phase-1",
    label: "Phase 1",
    description: "First phase",
    tasks: tasks as ExecutionTask[],
    status: "running",
  };
  return {
    templateName: "test-template",
    intent: makeIntent(),
    resolvedStack: { framework: "react" },
    phases: overrides?.phases ?? [phase],
    estimatedTotalMinutes: 15,
    stats: {
      totalTasks: tasks.length,
      tasksByAgent: { claude: 1, copilot: 1, codex: 1 },
      parallelizableTasks: 0,
    },
    ...overrides,
  };
}

function makeSessionStatus(overrides?: Partial<SessionStatus>): SessionStatus {
  return {
    sessionId: "sess-1",
    agent: "claude",
    taskId: "task-1",
    state: "running",
    progress: null,
    createdAt: 1000,
    startedAt: 2000,
    completedAt: null,
    error: null,
    retryCount: 0,
    output: "",
    ...overrides,
  };
}

function makeSessionProgress(overrides?: Partial<SessionProgress>): SessionProgress {
  return {
    sessionId: "sess-1",
    percent: 50,
    message: "Halfway done",
    tokensGenerated: 500,
    elapsedMs: 3000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardStateBuilder", () => {
  let builder: DashboardStateBuilder;

  beforeEach(() => {
    builder = new DashboardStateBuilder();
  });

  // ---- Phase snapshots ----

  describe("buildPhaseSnapshots", () => {
    it("maps plan phases to phase snapshots", () => {
      const plan = makePlan();
      const snapshots = builder.buildPhaseSnapshots(plan);

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]!.id).toBe("phase-1");
      expect(snapshots[0]!.label).toBe("Phase 1");
      expect(snapshots[0]!.status).toBe("running");
      expect(snapshots[0]!.tasks).toHaveLength(3);
    });

    it("maps task fields correctly", () => {
      const plan = makePlan();
      const tasks = builder.buildPhaseSnapshots(plan)[0]!.tasks;

      expect(tasks[0]).toEqual({
        id: "t1",
        label: "Task 1",
        agent: "claude",
        status: "completed",
      });
    });
  });

  // ---- Task snapshots from session status ----

  describe("buildTaskSnapshot", () => {
    it("maps running session to running task", () => {
      const status = makeSessionStatus({ state: "running", agent: "copilot" });
      const snap = builder.buildTaskSnapshot(status);

      expect(snap.status).toBe("running");
      expect(snap.agent).toBe("copilot");
    });

    it("maps completed session to completed task", () => {
      const snap = builder.buildTaskSnapshot(
        makeSessionStatus({ state: "completed" })
      );
      expect(snap.status).toBe("completed");
    });

    it("maps failed session to failed task", () => {
      const snap = builder.buildTaskSnapshot(
        makeSessionStatus({ state: "failed" })
      );
      expect(snap.status).toBe("failed");
    });

    it("maps cancelled session to skipped task", () => {
      const snap = builder.buildTaskSnapshot(
        makeSessionStatus({ state: "cancelled" })
      );
      expect(snap.status).toBe("skipped");
    });

    it("maps pending session to pending task", () => {
      const snap = builder.buildTaskSnapshot(
        makeSessionStatus({ state: "pending" })
      );
      expect(snap.status).toBe("pending");
    });

    it("includes progress fields when present", () => {
      const progress = makeSessionProgress({ percent: 75, message: "Almost there" });
      const snap = builder.buildTaskSnapshot(
        makeSessionStatus({ progress })
      );
      expect(snap.progress).toBe(75);
      expect(snap.message).toBe("Almost there");
    });
  });

  // ---- Progress snapshots ----

  describe("buildProgressSnapshot", () => {
    it("maps session progress to progress snapshot", () => {
      const progress = makeSessionProgress({
        sessionId: "s-42",
        percent: 80,
        message: "Generating code",
        tokensGenerated: 1200,
        elapsedMs: 5000,
      });
      const snap = builder.buildProgressSnapshot(progress);

      expect(snap.taskId).toBe("s-42");
      expect(snap.percent).toBe(80);
      expect(snap.message).toBe("Generating code");
      expect(snap.tokensGenerated).toBe(1200);
      expect(snap.elapsedMs).toBe(5000);
    });
  });

  // ---- Agent snapshots ----

  describe("buildAgentSnapshots", () => {
    it("returns all three agents initially idle", () => {
      const agents = builder.buildAgentSnapshots();

      expect(agents).toHaveLength(3);
      expect(agents.map((a) => a.role)).toEqual(["claude", "copilot", "codex"]);
      for (const agent of agents) {
        expect(agent.status).toBe("idle");
        expect(agent.tasksCompleted).toBe(0);
        expect(agent.tasksFailed).toBe(0);
      }
    });

    it("marks agent as busy after recordAgentStarted", () => {
      builder.recordAgentStarted("claude", "t1", "Build UI");
      const agents = builder.buildAgentSnapshots();

      const claude = agents.find((a) => a.role === "claude")!;
      expect(claude.status).toBe("busy");
      expect(claude.currentTaskId).toBe("t1");
      expect(claude.currentTaskLabel).toBe("Build UI");
    });

    it("increments completed count after recordAgentCompleted", () => {
      builder.recordAgentStarted("copilot", "t1", "Task");
      builder.recordAgentCompleted("copilot");

      const copilot = builder.buildAgentSnapshots().find((a) => a.role === "copilot")!;
      expect(copilot.status).toBe("idle");
      expect(copilot.tasksCompleted).toBe(1);
      expect(copilot.currentTaskId).toBeUndefined();
    });

    it("increments failed count after recordAgentFailed", () => {
      builder.recordAgentStarted("codex", "t1", "Task");
      builder.recordAgentFailed("codex");

      const codex = builder.buildAgentSnapshots().find((a) => a.role === "codex")!;
      expect(codex.status).toBe("idle");
      expect(codex.tasksFailed).toBe(1);
    });
  });

  // ---- Conflict snapshots ----

  describe("buildConflictSnapshot", () => {
    it("maps conflict and options to snapshot", () => {
      const conflict = {
        id: "c-1",
        type: "api-contract" as const,
        taskIds: ["t1", "t2"] as const,
        agents: ["claude", "copilot"] as const,
        description: "Mismatched API contract",
        detectedAt: Date.now(),
        affectedFiles: [],
        endpointPath: "/api/users",
        inconsistencies: [],
      };
      const options: ResolutionOption[] = [
        {
          label: "Use Claude's",
          strategy: "use-a",
          description: "Use Claude's API contract",
        },
        {
          label: "Use Copilot's",
          strategy: "use-b",
          description: "Use Copilot's API contract",
        },
      ];

      const snap = builder.buildConflictSnapshot(conflict, options);

      expect(snap.id).toBe("c-1");
      expect(snap.type).toBe("api-contract");
      expect(snap.description).toBe("Mismatched API contract");
      expect(snap.severity).toBe("medium");
      expect(snap.options).toHaveLength(2);
      expect(snap.options[0]!.strategy).toBe("use-a");
    });
  });

  // ---- Conflict management ----

  describe("conflict management", () => {
    const conflict: ConflictSnapshot = {
      id: "c-1",
      type: "file-merge",
      description: "Conflicting changes",
      severity: "high",
      options: [],
    };

    it("adds and retrieves conflicts", () => {
      builder.addConflict(conflict);
      expect(builder.getConflicts()).toHaveLength(1);
      expect(builder.getConflicts()[0]!.id).toBe("c-1");
    });

    it("removes a conflict by id", () => {
      builder.addConflict(conflict);
      builder.removeConflict("c-1");
      expect(builder.getConflicts()).toHaveLength(0);
    });

    it("no-ops when removing non-existent conflict", () => {
      builder.addConflict(conflict);
      builder.removeConflict("non-existent");
      expect(builder.getConflicts()).toHaveLength(1);
    });
  });

  // ---- Activity entries ----

  describe("createActivity", () => {
    it("creates an activity with correct fields", () => {
      const entry = builder.createActivity("claude", "Started task", "info");

      expect(entry.agent).toBe("claude");
      expect(entry.message).toBe("Started task");
      expect(entry.level).toBe("info");
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it("accumulates activities in order", () => {
      builder.createActivity("claude", "First", "info");
      builder.createActivity("copilot", "Second", "success");

      const activities = builder.getActivities();
      expect(activities).toHaveLength(2);
      expect(activities[0]!.message).toBe("First");
      expect(activities[1]!.message).toBe("Second");
    });

    it("respects activity limit", () => {
      for (let i = 0; i < 10; i++) {
        builder.createActivity("claude", `Activity ${i}`, "info");
      }
      const limited = builder.getActivities(3);
      expect(limited).toHaveLength(3);
      expect(limited[0]!.message).toBe("Activity 7");
    });
  });

  // ---- Stats ----

  describe("buildStats", () => {
    it("counts completed, failed, and running tasks", () => {
      const plan = makePlan();
      builder.setStartTime(Date.now() - 60000);

      const stats = builder.buildStats(plan);

      expect(stats.totalTasks).toBe(3);
      expect(stats.completedTasks).toBe(1);
      expect(stats.failedTasks).toBe(0);
      expect(stats.runningTasks).toBe(1);
      expect(stats.elapsedMs).toBeGreaterThanOrEqual(59000);
    });

    it("handles all-completed plan", () => {
      const plan = makePlan({
        phases: [{
          id: "p1",
          label: "Phase",
          description: "Done",
          status: "completed",
          tasks: [
            makeTask({ id: "t1", status: "completed" }),
            makeTask({ id: "t2", status: "completed" }),
          ],
        }],
        stats: { totalTasks: 2, tasksByAgent: { claude: 2, copilot: 0, codex: 0 }, parallelizableTasks: 0 },
      });
      builder.setStartTime(Date.now() - 10000);

      const stats = builder.buildStats(plan);
      expect(stats.completedTasks).toBe(2);
      expect(stats.estimatedMinutesRemaining).toBe(0);
    });

    it("estimates remaining time from average", () => {
      const plan = makePlan({
        phases: [{
          id: "p1",
          label: "Phase",
          description: "Mixed",
          status: "running",
          tasks: [
            makeTask({ id: "t1", status: "completed" }),
            makeTask({ id: "t2", status: "pending" }),
          ],
        }],
        stats: { totalTasks: 2, tasksByAgent: { claude: 2, copilot: 0, codex: 0 }, parallelizableTasks: 0 },
      });
      // 1 completed in 60s → 1 remaining ≈ 60s ≈ 1 min
      builder.setStartTime(Date.now() - 60000);

      const stats = builder.buildStats(plan);
      expect(stats.estimatedMinutesRemaining).toBe(1);
    });
  });

  // ---- Full state ----

  describe("buildState", () => {
    it("assembles full dashboard state", () => {
      const plan = makePlan();
      builder.createActivity("claude", "Hello", "info");
      builder.setStartTime(Date.now() - 5000);

      const state = builder.buildState(plan);

      expect(state.phases).toHaveLength(1);
      expect(state.agents).toHaveLength(3);
      expect(state.activities).toHaveLength(1);
      expect(state.conflicts).toHaveLength(0);
      expect(state.stats.totalTasks).toBe(3);
    });
  });

  // ---- Message type discrimination ----

  describe("message type discrimination", () => {
    it("DashboardMessage discriminates on type field", () => {
      const msg: DashboardMessage = {
        type: "task-update",
        payload: {
          id: "t1",
          label: "Task",
          agent: "claude",
          status: "running",
        },
      };
      expect(msg.type).toBe("task-update");
      expect(msg.payload.id).toBe("t1");
    });

    it("DashboardAction discriminates on type field", () => {
      const action: DashboardAction = {
        type: "resolve-conflict",
        payload: {
          conflictId: "c-1",
          strategy: "use-a",
          winningTaskId: "t1",
        },
      };
      expect(action.type).toBe("resolve-conflict");
      if (action.type === "resolve-conflict") {
        expect(action.payload.strategy).toBe("use-a");
      }
    });
  });
});
