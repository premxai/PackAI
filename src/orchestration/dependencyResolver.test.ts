import { describe, it, expect, beforeEach } from "vitest";
import {
  DependencyResolver,
  extractFilePaths,
} from "./dependencyResolver";
import type {
  ExecutionBatch,
  Conflict,
  ScheduleSnapshot,
} from "./dependencyResolver";
import type { ExecutionTask, ExecutionPlan, TaskStatus } from "../intelligence/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let resolver: DependencyResolver;

beforeEach(() => {
  resolver = new DependencyResolver();
});

/** Build a minimal ExecutionTask. */
function task(
  id: string,
  overrides: Partial<ExecutionTask> = {}
): ExecutionTask {
  return {
    id,
    label: id,
    prompt: `Do ${id}`,
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 5,
    parallelizable: true,
    status: "pending",
    ...overrides,
  };
}

/** Build a minimal ExecutionPlan from flat tasks. */
function planFromTasks(tasks: ExecutionTask[]): ExecutionPlan {
  return {
    templateName: "Test Plan",
    intent: {
      projectType: "unknown",
      projectTypeConfidence: "high",
      features: [],
      stackHints: [],
      complexity: "moderate",
      rawInput: "test",
      normalizedInput: "test",
      ambiguities: [],
    },
    resolvedStack: {},
    phases: [
      {
        id: "phase-1",
        label: "Phase 1",
        description: "Test phase",
        tasks,
        status: "pending",
      },
    ],
    estimatedTotalMinutes: tasks.reduce((s, t) => s + t.estimatedMinutes, 0),
    stats: {
      totalTasks: tasks.length,
      tasksByAgent: { claude: tasks.length, copilot: 0, codex: 0 },
      parallelizableTasks: tasks.filter((t) => t.parallelizable).length,
    },
  };
}

/** Collect task IDs from batches. */
function batchIds(batches: readonly ExecutionBatch[]): string[][] {
  return batches.map((b) => b.tasks.map((t) => t.id).sort());
}

// ===========================================================================
// Tests
// ===========================================================================

describe("DependencyResolver", () => {
  // -------------------------------------------------------------------------
  // Topological sort
  // -------------------------------------------------------------------------

  describe("topologicalSort", () => {
    it("sorts independent tasks in order", () => {
      const tasks = [task("a"), task("b"), task("c")];
      const sorted = resolver.topologicalSort(tasks);
      expect(sorted.map((t) => t.id)).toEqual(["a", "b", "c"]);
    });

    it("sorts linear chain correctly", () => {
      const tasks = [
        task("c", { dependsOn: ["b"] }),
        task("a"),
        task("b", { dependsOn: ["a"] }),
      ];
      const sorted = resolver.topologicalSort(tasks);
      const ids = sorted.map((t) => t.id);
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("c"));
    });

    it("handles diamond dependency", () => {
      //     a
      //    / \
      //   b   c
      //    \ /
      //     d
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["a"] }),
        task("d", { dependsOn: ["b", "c"] }),
      ];
      const sorted = resolver.topologicalSort(tasks);
      const ids = sorted.map((t) => t.id);
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("b"));
      expect(ids.indexOf("a")).toBeLessThan(ids.indexOf("c"));
      expect(ids.indexOf("b")).toBeLessThan(ids.indexOf("d"));
      expect(ids.indexOf("c")).toBeLessThan(ids.indexOf("d"));
    });

    it("throws on circular dependency", () => {
      const tasks = [
        task("a", { dependsOn: ["b"] }),
        task("b", { dependsOn: ["a"] }),
      ];
      expect(() => resolver.topologicalSort(tasks)).toThrow(
        /Circular dependency/
      );
    });

    it("throws on 3-node cycle", () => {
      const tasks = [
        task("a", { dependsOn: ["c"] }),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["b"] }),
      ];
      expect(() => resolver.topologicalSort(tasks)).toThrow(
        /Circular dependency/
      );
    });

    it("handles single task", () => {
      const tasks = [task("solo")];
      const sorted = resolver.topologicalSort(tasks);
      expect(sorted).toHaveLength(1);
      expect(sorted[0]!.id).toBe("solo");
    });

    it("handles empty list", () => {
      expect(resolver.topologicalSort([])).toHaveLength(0);
    });

    it("ignores dependencies on tasks not in the list", () => {
      const tasks = [task("a", { dependsOn: ["missing"] })];
      const sorted = resolver.topologicalSort(tasks);
      expect(sorted).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Batch grouping
  // -------------------------------------------------------------------------

  describe("resolveExecutionOrder / buildBatches", () => {
    it("groups independent parallelizable tasks into one batch", () => {
      const tasks = [task("a"), task("b"), task("c")];
      const batches = resolver.buildBatches(tasks);
      expect(batches).toHaveLength(1);
      expect(batches[0]!.tasks).toHaveLength(3);
    });

    it("separates tasks with dependencies into sequential batches", () => {
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["b"] }),
      ];
      const batches = resolver.buildBatches(tasks);
      expect(batches).toHaveLength(3);
      expect(batches[0]!.tasks[0]!.id).toBe("a");
      expect(batches[1]!.tasks[0]!.id).toBe("b");
      expect(batches[2]!.tasks[0]!.id).toBe("c");
    });

    it("diamond dependency produces 3 batches", () => {
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["a"] }),
        task("d", { dependsOn: ["b", "c"] }),
      ];
      const batches = resolver.buildBatches(tasks);
      const ids = batchIds(batches);

      expect(ids[0]).toEqual(["a"]);
      expect(ids[1]).toEqual(expect.arrayContaining(["b", "c"]));
      expect(ids[1]).toHaveLength(2);
      expect(ids[2]).toEqual(["d"]);
    });

    it("non-parallelizable tasks get their own batch", () => {
      const tasks = [
        task("a", { parallelizable: false }),
        task("b", { parallelizable: false }),
      ];
      const batches = resolver.buildBatches(tasks);
      expect(batches).toHaveLength(2);
      expect(batches[0]!.tasks).toHaveLength(1);
      expect(batches[1]!.tasks).toHaveLength(1);
    });

    it("mixes parallelizable and non-parallelizable correctly", () => {
      const tasks = [
        task("init", { parallelizable: false }),
        task("a", { dependsOn: ["init"] }),
        task("b", { dependsOn: ["init"] }),
        task("final", { dependsOn: ["a", "b"], parallelizable: false }),
      ];
      const batches = resolver.buildBatches(tasks);
      const ids = batchIds(batches);

      // init alone → a,b parallel → final alone
      expect(ids[0]).toEqual(["init"]);
      expect(ids[1]).toEqual(expect.arrayContaining(["a", "b"]));
      expect(ids[2]).toEqual(["final"]);
    });

    it("estimates batch time as max of task times", () => {
      const tasks = [
        task("a", { estimatedMinutes: 5 }),
        task("b", { estimatedMinutes: 10 }),
        task("c", { estimatedMinutes: 3 }),
      ];
      const batches = resolver.buildBatches(tasks);
      expect(batches[0]!.estimatedMinutes).toBe(10);
    });

    it("sets correct batch index", () => {
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
      ];
      const batches = resolver.buildBatches(tasks);
      expect(batches[0]!.index).toBe(0);
      expect(batches[1]!.index).toBe(1);
    });

    it("works through resolveExecutionOrder with full plan", () => {
      const tasks = [task("a"), task("b", { dependsOn: ["a"] })];
      const plan = planFromTasks(tasks);
      const batches = resolver.resolveExecutionOrder(plan);
      expect(batches).toHaveLength(2);
    });

    it("separates tasks with file conflicts into different batches", () => {
      const tasks = [
        task("a", { prompt: "Edit src/components/Button.tsx" }),
        task("b", { prompt: "Refactor src/components/Button.tsx" }),
      ];
      const batches = resolver.buildBatches(tasks);
      expect(batches).toHaveLength(2);
    });

    it("handles wide fan-out graph", () => {
      //   root
      //  / | | \
      // a  b c  d
      const tasks = [
        task("root", { parallelizable: false }),
        task("a", { dependsOn: ["root"] }),
        task("b", { dependsOn: ["root"] }),
        task("c", { dependsOn: ["root"] }),
        task("d", { dependsOn: ["root"] }),
      ];
      const batches = resolver.buildBatches(tasks);
      expect(batches).toHaveLength(2);
      expect(batches[0]!.tasks).toHaveLength(1);
      expect(batches[1]!.tasks).toHaveLength(4);
    });

    it("handles complex real-world-like graph", () => {
      // init → setup-db, setup-styling (parallel)
      // setup-db → setup-auth
      // setup-db, setup-styling → product-listing
      // product-listing → cart
      // cart, setup-auth → checkout
      const tasks = [
        task("init", { parallelizable: false }),
        task("setup-db", { dependsOn: ["init"] }),
        task("setup-styling", { dependsOn: ["init"] }),
        task("setup-auth", { dependsOn: ["setup-db"] }),
        task("product-listing", { dependsOn: ["setup-db", "setup-styling"] }),
        task("cart", { dependsOn: ["product-listing"] }),
        task("checkout", { dependsOn: ["cart", "setup-auth"] }),
      ];
      const batches = resolver.buildBatches(tasks);

      // Verify ordering constraints
      const taskToBatch = new Map<string, number>();
      for (const batch of batches) {
        for (const t of batch.tasks) {
          taskToBatch.set(t.id, batch.index);
        }
      }

      expect(taskToBatch.get("init")).toBe(0);
      expect(taskToBatch.get("setup-db")!).toBeGreaterThan(taskToBatch.get("init")!);
      expect(taskToBatch.get("setup-auth")!).toBeGreaterThan(taskToBatch.get("setup-db")!);
      expect(taskToBatch.get("product-listing")!).toBeGreaterThan(taskToBatch.get("setup-db")!);
      expect(taskToBatch.get("product-listing")!).toBeGreaterThan(taskToBatch.get("setup-styling")!);
      expect(taskToBatch.get("checkout")!).toBeGreaterThan(taskToBatch.get("cart")!);
      expect(taskToBatch.get("checkout")!).toBeGreaterThan(taskToBatch.get("setup-auth")!);
    });
  });

  // -------------------------------------------------------------------------
  // canRunInParallel
  // -------------------------------------------------------------------------

  describe("canRunInParallel", () => {
    it("returns true for independent parallelizable tasks", () => {
      expect(resolver.canRunInParallel(task("a"), task("b"))).toBe(true);
    });

    it("returns false when A depends on B", () => {
      const a = task("a", { dependsOn: ["b"] });
      const b = task("b");
      expect(resolver.canRunInParallel(a, b)).toBe(false);
    });

    it("returns false when B depends on A", () => {
      const a = task("a");
      const b = task("b", { dependsOn: ["a"] });
      expect(resolver.canRunInParallel(a, b)).toBe(false);
    });

    it("returns false when A is not parallelizable", () => {
      const a = task("a", { parallelizable: false });
      const b = task("b");
      expect(resolver.canRunInParallel(a, b)).toBe(false);
    });

    it("returns false when B is not parallelizable", () => {
      const a = task("a");
      const b = task("b", { parallelizable: false });
      expect(resolver.canRunInParallel(a, b)).toBe(false);
    });

    it("returns false when tasks share file paths", () => {
      const a = task("a", { prompt: "Edit src/components/Button.tsx" });
      const b = task("b", { prompt: "Update src/components/Button.tsx" });
      expect(resolver.canRunInParallel(a, b)).toBe(false);
    });

    it("returns true when tasks touch different files", () => {
      const a = task("a", { prompt: "Edit src/components/Button.tsx" });
      const b = task("b", { prompt: "Edit src/components/Card.tsx" });
      expect(resolver.canRunInParallel(a, b)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Conflict detection
  // -------------------------------------------------------------------------

  describe("detectConflicts", () => {
    it("returns empty for independent tasks", () => {
      const tasks = [task("a"), task("b")];
      expect(resolver.detectConflicts(tasks)).toHaveLength(0);
    });

    it("detects dependency conflicts", () => {
      const tasks = [
        task("a", { dependsOn: ["b"] }),
        task("b"),
      ];
      const conflicts = resolver.detectConflicts(tasks);
      expect(conflicts.some((c) => c.type === "dependency")).toBe(true);
    });

    it("detects file conflicts", () => {
      const tasks = [
        task("a", { prompt: "Edit src/utils/auth.ts helpers" }),
        task("b", { prompt: "Refactor src/utils/auth.ts module" }),
      ];
      const conflicts = resolver.detectConflicts(tasks);
      expect(conflicts.some((c) => c.type === "file")).toBe(true);
    });

    it("detects both dependency and file conflicts", () => {
      const tasks = [
        task("a", { dependsOn: ["b"], prompt: "Edit src/db.ts schema" }),
        task("b", { prompt: "Update src/db.ts migrations" }),
      ];
      const conflicts = resolver.detectConflicts(tasks);
      expect(conflicts.length).toBeGreaterThanOrEqual(2);
      expect(conflicts.some((c) => c.type === "dependency")).toBe(true);
      expect(conflicts.some((c) => c.type === "file")).toBe(true);
    });

    it("includes reason in conflict", () => {
      const tasks = [
        task("a", { dependsOn: ["b"] }),
        task("b"),
      ];
      const conflicts = resolver.detectConflicts(tasks);
      expect(conflicts[0]!.reason).toContain("depends on");
    });
  });

  // -------------------------------------------------------------------------
  // File path extraction
  // -------------------------------------------------------------------------

  describe("extractFilePaths", () => {
    it("extracts src/ paths", () => {
      const t = task("a", {
        prompt: "Edit src/components/Button.tsx and src/utils/format.ts",
      });
      const paths = extractFilePaths(t);
      expect(paths).toContain("src/components/button.tsx");
      expect(paths).toContain("src/utils/format.ts");
    });

    it("extracts config file names", () => {
      const t = task("a", { prompt: "Update package.json and tsconfig.json" });
      const paths = extractFilePaths(t);
      expect(paths).toContain("package.json");
      expect(paths).toContain("tsconfig.json");
    });

    it("extracts .env files", () => {
      const t = task("a", { prompt: "Configure .env.local variables" });
      const paths = extractFilePaths(t);
      expect(paths).toContain(".env.local");
    });

    it("extracts prisma schema", () => {
      const t = task("a", {
        prompt: "Update prisma/schema.prisma with new models",
      });
      const paths = extractFilePaths(t);
      expect(paths).toContain("prisma/schema.prisma");
    });

    it("extracts next.config file", () => {
      const t = task("a", {
        prompt: "Update next.config.mjs with new settings",
      });
      const paths = extractFilePaths(t);
      expect(paths).toContain("next.config.mjs");
    });

    it("returns empty for generic prompts", () => {
      const t = task("a", { prompt: "Set up the database" });
      const paths = extractFilePaths(t);
      expect(paths).toHaveLength(0);
    });

    it("deduplicates paths", () => {
      const t = task("a", {
        prompt:
          "First edit src/index.ts, then update src/index.ts with exports",
      });
      const paths = extractFilePaths(t);
      const indexCount = paths.filter((p) => p === "src/index.ts").length;
      expect(indexCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Dynamic recomputation
  // -------------------------------------------------------------------------

  describe("recomputeSchedule", () => {
    it("marks all independent tasks as ready when pending", () => {
      const tasks = [task("a"), task("b"), task("c")];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.ready).toHaveLength(3);
      expect(snapshot.blocked).toHaveLength(0);
    });

    it("correctly identifies blocked tasks", () => {
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.ready).toHaveLength(1);
      expect(snapshot.ready[0]!.id).toBe("a");
      expect(snapshot.blocked).toHaveLength(1);
      expect(snapshot.blocked[0]!.task.id).toBe("b");
      expect(snapshot.blocked[0]!.waitingOn).toEqual(["a"]);
    });

    it("unblocks tasks when dependency completes", () => {
      const tasks = [
        task("a", { status: "completed" }),
        task("b", { dependsOn: ["a"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.ready).toHaveLength(1);
      expect(snapshot.ready[0]!.id).toBe("b");
      expect(snapshot.completed).toHaveLength(1);
    });

    it("marks tasks as unreachable when dependency fails", () => {
      const tasks = [
        task("a", { status: "failed" }),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["b"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.failed).toHaveLength(1);
      expect(snapshot.unreachable).toHaveLength(2);
      expect(snapshot.unreachable.map((t) => t.id).sort()).toEqual(["b", "c"]);
    });

    it("tracks running tasks", () => {
      const tasks = [
        task("a", { status: "running" }),
        task("b", { dependsOn: ["a"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.running).toHaveLength(1);
      expect(snapshot.blocked).toHaveLength(1);
    });

    it("handles mixed states in diamond dependency", () => {
      const tasks = [
        task("a", { status: "completed" }),
        task("b", { dependsOn: ["a"], status: "completed" }),
        task("c", { dependsOn: ["a"], status: "failed" }),
        task("d", { dependsOn: ["b", "c"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      // d depends on c which failed → d is unreachable
      expect(snapshot.unreachable).toHaveLength(1);
      expect(snapshot.unreachable[0]!.id).toBe("d");
    });

    it("handles partial failure — unrelated branches still run", () => {
      // a → b (fails)
      // a → c (independent of b)
      const tasks = [
        task("a", { status: "completed" }),
        task("b", { dependsOn: ["a"], status: "failed" }),
        task("c", { dependsOn: ["a"] }),
        task("d", { dependsOn: ["b"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.ready.map((t) => t.id)).toEqual(["c"]);
      expect(snapshot.unreachable.map((t) => t.id)).toEqual(["d"]);
    });

    it("treats skipped tasks as completed for dependency purposes", () => {
      const tasks = [
        task("a", { status: "skipped" }),
        task("b", { dependsOn: ["a"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.ready).toHaveLength(1);
      expect(snapshot.ready[0]!.id).toBe("b");
    });

    it("handles empty task list", () => {
      const snapshot = resolver.recomputeSchedule([]);
      expect(snapshot.ready).toHaveLength(0);
      expect(snapshot.blocked).toHaveLength(0);
      expect(snapshot.unreachable).toHaveLength(0);
    });

    it("handles all tasks completed", () => {
      const tasks = [
        task("a", { status: "completed" }),
        task("b", { status: "completed", dependsOn: ["a"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.completed).toHaveLength(2);
      expect(snapshot.ready).toHaveLength(0);
    });

    it("cascading failure marks deep chain as unreachable", () => {
      // a(fail) → b → c → d → e
      const tasks = [
        task("a", { status: "failed" }),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["b"] }),
        task("d", { dependsOn: ["c"] }),
        task("e", { dependsOn: ["d"] }),
      ];
      const snapshot = resolver.recomputeSchedule(tasks);
      expect(snapshot.unreachable).toHaveLength(4);
    });
  });

  // -------------------------------------------------------------------------
  // Visualization
  // -------------------------------------------------------------------------

  describe("visualizeBatches", () => {
    it("renders batch labels with task ids", () => {
      const batches: ExecutionBatch[] = [
        { index: 0, tasks: [task("init")], estimatedMinutes: 5 },
        {
          index: 1,
          tasks: [
            task("db", { dependsOn: ["init"] }),
            task("css", { dependsOn: ["init"] }),
          ],
          estimatedMinutes: 10,
        },
      ];
      const output = resolver.visualizeBatches(batches);
      expect(output).toContain("[Batch 0]");
      expect(output).toContain("[Batch 1]");
      expect(output).toContain("init");
      expect(output).toContain("db");
      expect(output).toContain("css");
      expect(output).toContain("(parallel)");
    });

    it("shows dependency info", () => {
      const batches: ExecutionBatch[] = [
        { index: 0, tasks: [task("a")], estimatedMinutes: 5 },
        {
          index: 1,
          tasks: [task("b", { dependsOn: ["a"] })],
          estimatedMinutes: 5,
        },
      ];
      const output = resolver.visualizeBatches(batches);
      expect(output).toContain("after: a");
    });

    it("shows task status when non-pending", () => {
      const batches: ExecutionBatch[] = [
        {
          index: 0,
          tasks: [task("a", { status: "completed" })],
          estimatedMinutes: 5,
        },
      ];
      const output = resolver.visualizeBatches(batches);
      expect(output).toContain("[completed]");
    });
  });

  describe("visualizeDot", () => {
    it("produces valid DOT output", () => {
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
      ];
      const dot = resolver.visualizeDot(tasks);
      expect(dot).toContain("digraph dependencies {");
      expect(dot).toContain('"a"');
      expect(dot).toContain('"b"');
      expect(dot).toContain('"a" -> "b"');
      expect(dot).toContain("}");
    });

    it("includes agent and time in labels", () => {
      const tasks = [task("setup", { agent: "claude", estimatedMinutes: 15 })];
      const dot = resolver.visualizeDot(tasks);
      expect(dot).toContain("[C]");
      expect(dot).toContain("~15m");
    });

    it("colors completed tasks green", () => {
      const tasks = [task("done", { status: "completed" })];
      const dot = resolver.visualizeDot(tasks);
      expect(dot).toContain("lightgreen");
    });

    it("colors failed tasks red", () => {
      const tasks = [task("broken", { status: "failed" })];
      const dot = resolver.visualizeDot(tasks);
      expect(dot).toContain("lightcoral");
    });
  });

  describe("visualizeSnapshot", () => {
    it("renders all sections", () => {
      const snapshot: ScheduleSnapshot = {
        ready: [task("r1")],
        running: [task("run1", { status: "running" })],
        blocked: [{ task: task("b1"), waitingOn: ["run1"] }],
        unreachable: [task("u1")],
        completed: [task("c1", { status: "completed" })],
        failed: [task("f1", { status: "failed" })],
      };
      const output = resolver.visualizeSnapshot(snapshot);
      expect(output).toContain("Ready: r1");
      expect(output).toContain("Running: run1");
      expect(output).toContain("Blocked: b1 (waiting: run1)");
      expect(output).toContain("Unreachable: u1");
      expect(output).toContain("Completed: c1");
      expect(output).toContain("Failed: f1");
    });

    it("omits empty sections", () => {
      const snapshot: ScheduleSnapshot = {
        ready: [task("a")],
        running: [],
        blocked: [],
        unreachable: [],
        completed: [],
        failed: [],
      };
      const output = resolver.visualizeSnapshot(snapshot);
      expect(output).toContain("Ready: a");
      expect(output).not.toContain("Running");
      expect(output).not.toContain("Blocked");
    });
  });

  // -------------------------------------------------------------------------
  // Complex integration scenarios
  // -------------------------------------------------------------------------

  describe("complex scenarios", () => {
    it("e-commerce-like workflow batches correctly", () => {
      const tasks = [
        task("init-project", { parallelizable: false }),
        task("setup-db", { dependsOn: ["init-project"] }),
        task("setup-styling", { dependsOn: ["init-project"] }),
        task("setup-auth", { dependsOn: ["setup-db"] }),
        task("product-listing", {
          dependsOn: ["setup-db", "setup-styling"],
          prompt: "Create product listing with src/components/ProductList.tsx",
        }),
        task("product-detail", {
          dependsOn: ["setup-db", "setup-styling"],
          prompt: "Create product detail page src/components/ProductDetail.tsx",
        }),
        task("cart", { dependsOn: ["product-listing"] }),
        task("checkout", { dependsOn: ["cart", "setup-auth"] }),
        task("search-feature", { dependsOn: ["product-listing"] }),
        task("unit-tests", {
          dependsOn: ["checkout"],
          agent: "codex",
          prompt: "Write tests in tests/ directory",
        }),
        task("e2e-tests", {
          dependsOn: ["checkout"],
          agent: "codex",
          prompt: "Write e2e tests in tests/e2e/ directory",
        }),
        task("deploy", {
          dependsOn: ["unit-tests", "e2e-tests"],
          parallelizable: false,
        }),
      ];

      const batches = resolver.buildBatches(tasks);
      const taskToBatch = new Map<string, number>();
      for (const batch of batches) {
        for (const t of batch.tasks) {
          taskToBatch.set(t.id, batch.index);
        }
      }

      // Verify all tasks assigned
      expect(taskToBatch.size).toBe(12);

      // init must be first
      expect(taskToBatch.get("init-project")).toBe(0);

      // db and styling can be parallel after init
      expect(taskToBatch.get("setup-db")).toBe(taskToBatch.get("setup-styling"));

      // product-listing and product-detail can be parallel (different files)
      expect(taskToBatch.get("product-listing")).toBe(
        taskToBatch.get("product-detail")
      );

      // deploy must be last
      const maxBatch = Math.max(...[...taskToBatch.values()]);
      expect(taskToBatch.get("deploy")).toBe(maxBatch);
    });

    it("progressive schedule recomputation as tasks complete", () => {
      const tasks = [
        task("a"),
        task("b", { dependsOn: ["a"] }),
        task("c", { dependsOn: ["a"] }),
        task("d", { dependsOn: ["b", "c"] }),
      ];

      // Initial: only a is ready
      let snap = resolver.recomputeSchedule(tasks);
      expect(snap.ready.map((t) => t.id)).toEqual(["a"]);

      // a completes → b and c become ready
      tasks[0]!.status = "completed";
      snap = resolver.recomputeSchedule(tasks);
      expect(snap.ready.map((t) => t.id).sort()).toEqual(["b", "c"]);

      // b completes, c still pending → d still blocked
      tasks[1]!.status = "completed";
      snap = resolver.recomputeSchedule(tasks);
      expect(snap.ready.map((t) => t.id)).toEqual(["c"]);
      expect(snap.blocked.map((b) => b.task.id)).toEqual(["d"]);

      // c completes → d becomes ready
      tasks[2]!.status = "completed";
      snap = resolver.recomputeSchedule(tasks);
      expect(snap.ready.map((t) => t.id)).toEqual(["d"]);

      // d completes → all done
      tasks[3]!.status = "completed";
      snap = resolver.recomputeSchedule(tasks);
      expect(snap.ready).toHaveLength(0);
      expect(snap.completed).toHaveLength(4);
    });

    it("failure mid-execution cascades correctly", () => {
      // a → b → d
      // a → c → d
      const tasks = [
        task("a", { status: "completed" }),
        task("b", { dependsOn: ["a"], status: "running" }),
        task("c", { dependsOn: ["a"] }),
        task("d", { dependsOn: ["b", "c"] }),
      ];

      // b is running, c is ready, d is blocked
      let snap = resolver.recomputeSchedule(tasks);
      expect(snap.running.map((t) => t.id)).toEqual(["b"]);
      expect(snap.ready.map((t) => t.id)).toEqual(["c"]);

      // b fails → d becomes unreachable
      tasks[1]!.status = "failed";
      snap = resolver.recomputeSchedule(tasks);
      expect(snap.failed.map((t) => t.id)).toEqual(["b"]);
      expect(snap.unreachable.map((t) => t.id)).toEqual(["d"]);
      // c is still ready (doesn't depend on b)
      expect(snap.ready.map((t) => t.id)).toEqual(["c"]);
    });

    it("multiple independent chains execute fully in parallel", () => {
      // Chain 1: a1 → b1 → c1
      // Chain 2: a2 → b2 → c2
      const tasks = [
        task("a1"),
        task("a2"),
        task("b1", { dependsOn: ["a1"] }),
        task("b2", { dependsOn: ["a2"] }),
        task("c1", { dependsOn: ["b1"] }),
        task("c2", { dependsOn: ["b2"] }),
      ];

      const batches = resolver.buildBatches(tasks);
      const ids = batchIds(batches);

      // a1 and a2 in batch 0
      expect(ids[0]).toEqual(expect.arrayContaining(["a1", "a2"]));
      // b1 and b2 in batch 1
      expect(ids[1]).toEqual(expect.arrayContaining(["b1", "b2"]));
      // c1 and c2 in batch 2
      expect(ids[2]).toEqual(expect.arrayContaining(["c1", "c2"]));
    });
  });
});
