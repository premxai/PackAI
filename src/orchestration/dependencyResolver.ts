import type {
  ExecutionPlan,
  ExecutionTask,
  TaskStatus,
} from "../intelligence/types";

// ===========================================================================
// DependencyResolver
//
// Pure logic module that analyzes an ExecutionPlan's dependency graph to:
//   1. Topologically sort tasks into a valid execution order
//   2. Group tasks into parallel batches (respecting deps + conflicts)
//   3. Detect file conflicts between tasks
//   4. Dynamically recompute what's runnable/blocked after state changes
//   5. Provide ASCII visualization of the dependency graph
//
// No VS Code dependency — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A batch of tasks that can run concurrently. */
export interface ExecutionBatch {
  readonly index: number;
  readonly tasks: readonly ExecutionTask[];
  readonly estimatedMinutes: number;
}

/** A conflict between two tasks that prevents parallel execution. */
export interface Conflict {
  readonly taskA: string;
  readonly taskB: string;
  readonly reason: string;
  readonly type: "dependency" | "file" | "agent";
}

/** Snapshot of task readiness after dynamic recomputation. */
export interface ScheduleSnapshot {
  /** Tasks whose dependencies are all completed — ready to run now. */
  readonly ready: readonly ExecutionTask[];
  /** Tasks waiting on incomplete dependencies. */
  readonly blocked: readonly BlockedTask[];
  /** Tasks that cannot ever complete (depend on a failed task). */
  readonly unreachable: readonly ExecutionTask[];
  /** Tasks already completed or running. */
  readonly completed: readonly ExecutionTask[];
  readonly running: readonly ExecutionTask[];
  readonly failed: readonly ExecutionTask[];
}

/** A blocked task with details about what it's waiting on. */
export interface BlockedTask {
  readonly task: ExecutionTask;
  readonly waitingOn: readonly string[];
}

// ---------------------------------------------------------------------------
// File-path extraction patterns (heuristic — extracts from task prompts)
// ---------------------------------------------------------------------------

const FILE_PATH_PATTERNS: readonly RegExp[] = [
  // Explicit file paths: src/foo/bar.ts, ./components/Button.tsx, etc.
  /(?:^|\s)((?:\.\/|src\/|app\/|pages\/|components\/|lib\/|utils\/|api\/|styles\/|public\/|tests?\/)\S+\.\w{1,5})/gi,
  // Common config files (use non-word boundary for dotfiles)
  /(?:^|[\s,;(])(package\.json|tsconfig\.json|\.env(?:\.local)?|next\.config\.\w+|vite\.config\.\w+|tailwind\.config\.\w+|prisma\/schema\.prisma)(?=[\s,;).]|$)/gi,
];

/** Extract file paths mentioned in a task's prompt and label. */
export function extractFilePaths(task: ExecutionTask): string[] {
  const text = `${task.label} ${task.prompt}`;
  const paths = new Set<string>();

  for (const pattern of FILE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      paths.add(match[1]!.trim().toLowerCase());
    }
  }

  return [...paths];
}

/** Check if two file path sets overlap (exact match only). */
function hasFileOverlap(pathsA: string[], pathsB: string[]): string | null {
  for (const a of pathsA) {
    for (const b of pathsB) {
      if (a === b) return a;
    }
  }
  return null;
}

// ===========================================================================
// DependencyResolver class
// ===========================================================================

/**
 * Analyzes an execution plan's dependency graph to schedule tasks.
 *
 * Capabilities:
 * - Topological sort (Kahn's algorithm) with cycle detection
 * - Parallel batch grouping respecting deps, file conflicts, and parallelizability
 * - Dynamic schedule recomputation after state changes
 * - ASCII and DOT/Graphviz visualization
 */
export class DependencyResolver {
  /**
   * Flatten all tasks from an execution plan into a flat array.
   */
  flattenTasks(plan: ExecutionPlan): ExecutionTask[] {
    return plan.phases.flatMap((p) => p.tasks);
  }

  // -------------------------------------------------------------------------
  // Topological sort
  // -------------------------------------------------------------------------

  /**
   * Topologically sort tasks, respecting dependency edges.
   * Throws on cycles (though WorkflowGenerator should have caught them).
   */
  topologicalSort(tasks: readonly ExecutionTask[]): ExecutionTask[] {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    // Initialize
    for (const task of tasks) {
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    // Build graph
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (taskMap.has(dep)) {
          adjacency.get(dep)!.push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
        }
      }
    }

    // Kahn's algorithm
    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: ExecutionTask[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(taskMap.get(id)!);

      for (const neighbor of adjacency.get(id)!) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (sorted.length !== tasks.length) {
      const remaining = tasks
        .filter((t) => !sorted.some((s) => s.id === t.id))
        .map((t) => t.id);
      throw new Error(
        `Circular dependency detected involving: ${remaining.join(", ")}`
      );
    }

    return sorted;
  }

  // -------------------------------------------------------------------------
  // Batch grouping — parallel execution batches
  // -------------------------------------------------------------------------

  /**
   * Group tasks into execution batches. Each batch contains tasks whose
   * dependencies are all satisfied by previous batches, that are marked
   * parallelizable, and that have no file conflicts with each other.
   *
   * Non-parallelizable tasks always get their own single-task batch.
   */
  resolveExecutionOrder(plan: ExecutionPlan): ExecutionBatch[] {
    const tasks = this.flattenTasks(plan);
    return this.buildBatches(tasks);
  }

  /**
   * Build batches from a flat task array (useful for testing without a full plan).
   */
  buildBatches(tasks: readonly ExecutionTask[]): ExecutionBatch[] {
    const sorted = this.topologicalSort(tasks);
    const batches: ExecutionBatch[] = [];
    const assigned = new Set<string>();

    // Track which batch each task ends up in (for dependency checking)
    const taskBatch = new Map<string, number>();

    while (assigned.size < sorted.length) {
      const batch: ExecutionTask[] = [];
      const batchFilePaths: Map<string, string[]> = new Map();

      for (const task of sorted) {
        if (assigned.has(task.id)) continue;

        // All dependencies must be in earlier batches
        const depsReady = task.dependsOn.every((dep) => assigned.has(dep));
        if (!depsReady) continue;

        // Non-parallelizable tasks get their own batch
        if (!task.parallelizable) {
          if (batch.length === 0) {
            batch.push(task);
            break; // This task is alone in its batch
          }
          continue; // Skip for now — will be in a later batch
        }

        // Check for file conflicts with tasks already in this batch
        const taskPaths = extractFilePaths(task);
        let hasConflict = false;
        for (const [, existingPaths] of batchFilePaths) {
          if (hasFileOverlap(taskPaths, existingPaths)) {
            hasConflict = true;
            break;
          }
        }
        if (hasConflict) continue;

        batch.push(task);
        batchFilePaths.set(task.id, taskPaths);
      }

      if (batch.length === 0) {
        // Safety: if no tasks can be added but some remain, there's a problem.
        // This shouldn't happen if topological sort succeeded.
        break;
      }

      const batchIndex = batches.length;
      for (const task of batch) {
        assigned.add(task.id);
        taskBatch.set(task.id, batchIndex);
      }

      batches.push({
        index: batchIndex,
        tasks: batch,
        estimatedMinutes: Math.max(...batch.map((t) => t.estimatedMinutes)),
      });
    }

    return batches;
  }

  // -------------------------------------------------------------------------
  // Parallel compatibility check
  // -------------------------------------------------------------------------

  /**
   * Check whether two tasks can run in parallel.
   * They cannot if: one depends on the other, they share file paths,
   * or either is marked non-parallelizable.
   */
  canRunInParallel(taskA: ExecutionTask, taskB: ExecutionTask): boolean {
    // Either is non-parallelizable
    if (!taskA.parallelizable || !taskB.parallelizable) return false;

    // Direct dependency
    if (taskA.dependsOn.includes(taskB.id)) return false;
    if (taskB.dependsOn.includes(taskA.id)) return false;

    // File conflict
    const pathsA = extractFilePaths(taskA);
    const pathsB = extractFilePaths(taskB);
    if (hasFileOverlap(pathsA, pathsB)) return false;

    return true;
  }

  // -------------------------------------------------------------------------
  // Conflict detection
  // -------------------------------------------------------------------------

  /**
   * Detect all conflicts among a set of tasks.
   * Useful for debugging and UI display.
   */
  detectConflicts(tasks: readonly ExecutionTask[]): Conflict[] {
    const conflicts: Conflict[] = [];

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i]!;
        const b = tasks[j]!;

        // Dependency conflicts
        if (a.dependsOn.includes(b.id)) {
          conflicts.push({
            taskA: a.id,
            taskB: b.id,
            reason: `"${a.id}" depends on "${b.id}"`,
            type: "dependency",
          });
        }
        if (b.dependsOn.includes(a.id)) {
          conflicts.push({
            taskA: a.id,
            taskB: b.id,
            reason: `"${b.id}" depends on "${a.id}"`,
            type: "dependency",
          });
        }

        // File conflicts
        const pathsA = extractFilePaths(a);
        const pathsB = extractFilePaths(b);
        const overlap = hasFileOverlap(pathsA, pathsB);
        if (overlap) {
          conflicts.push({
            taskA: a.id,
            taskB: b.id,
            reason: `Both touch "${overlap}"`,
            type: "file",
          });
        }
      }
    }

    return conflicts;
  }

  // -------------------------------------------------------------------------
  // Dynamic recomputation
  // -------------------------------------------------------------------------

  /**
   * Recompute the schedule snapshot given current task states.
   * Called after a task completes or fails to determine what to run next.
   */
  recomputeSchedule(tasks: readonly ExecutionTask[]): ScheduleSnapshot {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // First pass: find all tasks that are transitively blocked by failures
    const failedIds = new Set(
      tasks.filter((t) => t.status === "failed").map((t) => t.id)
    );
    const unreachableIds = this.findUnreachable(tasks, failedIds);

    const ready: ExecutionTask[] = [];
    const blocked: BlockedTask[] = [];
    const unreachable: ExecutionTask[] = [];
    const completed: ExecutionTask[] = [];
    const running: ExecutionTask[] = [];
    const failed: ExecutionTask[] = [];

    for (const task of tasks) {
      switch (task.status) {
        case "completed":
        case "skipped":
          completed.push(task);
          break;
        case "running":
          running.push(task);
          break;
        case "failed":
          failed.push(task);
          break;
        case "pending": {
          if (unreachableIds.has(task.id)) {
            unreachable.push(task);
            break;
          }

          const waitingOn: string[] = [];
          for (const dep of task.dependsOn) {
            const depTask = taskMap.get(dep);
            if (depTask && depTask.status !== "completed" && depTask.status !== "skipped") {
              waitingOn.push(dep);
            }
          }

          if (waitingOn.length === 0) {
            ready.push(task);
          } else {
            blocked.push({ task, waitingOn });
          }
          break;
        }
      }
    }

    return { ready, blocked, unreachable, completed, running, failed };
  }

  /**
   * Find task IDs that are transitively unreachable due to failed dependencies.
   */
  private findUnreachable(
    tasks: readonly ExecutionTask[],
    failedIds: Set<string>
  ): Set<string> {
    const unreachable = new Set<string>();

    // Build reverse dependency map: for each task, who depends on it
    const dependents = new Map<string, string[]>();
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep)!.push(task.id);
      }
    }

    // BFS from failed tasks to find all transitively blocked tasks
    const queue = [...failedIds];
    while (queue.length > 0) {
      const id = queue.shift()!;
      const deps = dependents.get(id);
      if (!deps) continue;
      for (const depId of deps) {
        if (!unreachable.has(depId) && !failedIds.has(depId)) {
          unreachable.add(depId);
          queue.push(depId);
        }
      }
    }

    return unreachable;
  }

  // -------------------------------------------------------------------------
  // Visualization
  // -------------------------------------------------------------------------

  /**
   * Render the dependency graph as an ASCII diagram for debugging.
   *
   * Example output:
   *   [Batch 0] init-project
   *   [Batch 1] setup-db ║ setup-styling
   *   [Batch 2] setup-auth (after: setup-db)
   *   [Batch 3] product-listing (after: setup-db, setup-styling)
   */
  visualizeBatches(batches: readonly ExecutionBatch[]): string {
    const lines: string[] = [];

    for (const batch of batches) {
      const taskStrs = batch.tasks.map((t) => {
        const deps =
          t.dependsOn.length > 0
            ? ` (after: ${t.dependsOn.join(", ")})`
            : "";
        const status = t.status !== "pending" ? ` [${t.status}]` : "";
        return `${t.id}${deps}${status}`;
      });

      const parallel = batch.tasks.length > 1 ? " (parallel)" : "";
      lines.push(
        `[Batch ${batch.index}]${parallel} ~${batch.estimatedMinutes}min\n` +
          taskStrs.map((s) => `  ${s}`).join("\n")
      );
    }

    return lines.join("\n\n");
  }

  /**
   * Render the dependency graph as a DOT/Graphviz-compatible string.
   * Useful for generating visual diagrams externally.
   */
  visualizeDot(tasks: readonly ExecutionTask[]): string {
    const lines: string[] = ["digraph dependencies {", '  rankdir=LR;'];

    // Node definitions with status colors
    const statusColors: Record<TaskStatus, string> = {
      pending: "white",
      running: "lightyellow",
      completed: "lightgreen",
      failed: "lightcoral",
      skipped: "lightgray",
    };

    for (const task of tasks) {
      const color = statusColors[task.status];
      const agent = task.agent[0]!.toUpperCase();
      lines.push(
        `  "${task.id}" [label="${task.id}\\n[${agent}] ~${task.estimatedMinutes}m" ` +
          `style=filled fillcolor="${color}"];`
      );
    }

    // Edges
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        lines.push(`  "${dep}" -> "${task.id}";`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }

  /**
   * Render a compact schedule snapshot for logging.
   */
  visualizeSnapshot(snapshot: ScheduleSnapshot): string {
    const sections: string[] = [];

    if (snapshot.ready.length > 0) {
      sections.push(`Ready: ${snapshot.ready.map((t) => t.id).join(", ")}`);
    }
    if (snapshot.running.length > 0) {
      sections.push(`Running: ${snapshot.running.map((t) => t.id).join(", ")}`);
    }
    if (snapshot.blocked.length > 0) {
      const blockedStrs = snapshot.blocked.map(
        (b) => `${b.task.id} (waiting: ${b.waitingOn.join(", ")})`
      );
      sections.push(`Blocked: ${blockedStrs.join("; ")}`);
    }
    if (snapshot.unreachable.length > 0) {
      sections.push(
        `Unreachable: ${snapshot.unreachable.map((t) => t.id).join(", ")}`
      );
    }
    if (snapshot.completed.length > 0) {
      sections.push(
        `Completed: ${snapshot.completed.map((t) => t.id).join(", ")}`
      );
    }
    if (snapshot.failed.length > 0) {
      sections.push(`Failed: ${snapshot.failed.map((t) => t.id).join(", ")}`);
    }

    return sections.join("\n");
  }
}
