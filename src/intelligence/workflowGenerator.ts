import type {
  AgentRole,
  ExecutionPlan,
  ExecutionPhase,
  ExecutionTask,
  Feature,
  PhaseDefinition,
  ProjectIntent,
  StackCategory,
  TaskDefinition,
  WorkflowTemplate,
} from "./types";
import { findTemplate, registerTemplate, getTemplates } from "./workflowTemplates";

// ===========================================================================
// WorkflowGenerator
//
// Takes a ProjectIntent and produces a concrete ExecutionPlan by:
//   1. Selecting the best-matching template
//   2. Filtering tasks by detected features (conditional inclusion)
//   3. Resolving the tech stack (user hints > template defaults)
//   4. Rewriting prompts to reference the resolved stack
//   5. Validating the dependency graph
//   6. Computing summary statistics
// ===========================================================================

/**
 * Produces a concrete {@link ExecutionPlan} from a {@link ProjectIntent}.
 *
 * Selects the best-matching template, filters tasks by detected features,
 * resolves the technology stack, rewrites prompts, validates dependencies,
 * and computes summary statistics.
 */
export class WorkflowGenerator {
  /**
   * Generate an execution plan from a project intent.
   * Throws if the resulting plan has broken dependency edges.
   */
  generate(intent: ProjectIntent): ExecutionPlan {
    const template = findTemplate(intent.projectType);
    const resolvedStack = this.resolveStack(intent, template);
    const phases = this.buildPhases(template.phases, intent.features, resolvedStack);

    this.validateDependencies(phases);

    const allTasks = phases.flatMap((p) => p.tasks);
    const estimatedTotalMinutes = allTasks.reduce(
      (sum, t) => sum + t.estimatedMinutes,
      0
    );

    return {
      templateName: template.name,
      intent,
      resolvedStack,
      phases,
      estimatedTotalMinutes,
      stats: {
        totalTasks: allTasks.length,
        tasksByAgent: this.countByAgent(allTasks),
        parallelizableTasks: allTasks.filter((t) => t.parallelizable).length,
      },
    };
  }

  // Expose template management for extensibility
  registerTemplate = registerTemplate;
  getTemplates = getTemplates;

  // -------------------------------------------------------------------------
  // Stack resolution — user hints override template defaults
  // -------------------------------------------------------------------------

  private resolveStack(
    intent: ProjectIntent,
    template: WorkflowTemplate
  ): Record<string, string> {
    const resolved: Record<string, string> = {};

    // Start with template defaults (skip undefined entries)
    for (const [cat, value] of Object.entries(template.defaultStack)) {
      if (value !== undefined) {
        resolved[cat] = value;
      }
    }

    // Override with user-specified stack hints
    for (const hint of intent.stackHints) {
      resolved[hint.category] = hint.name;
    }

    return resolved;
  }

  // -------------------------------------------------------------------------
  // Phase/task filtering and prompt rewriting
  // -------------------------------------------------------------------------

  private buildPhases(
    phaseDefinitions: readonly PhaseDefinition[],
    detectedFeatures: readonly Feature[],
    resolvedStack: Record<string, string>
  ): ExecutionPhase[] {
    const featureSet = new Set(detectedFeatures);

    const result: ExecutionPhase[] = [];

    for (const phaseDef of phaseDefinitions) {
      const tasks = this.filterAndRewriteTasks(
        phaseDef.tasks,
        featureSet,
        resolvedStack
      );

      // Drop phases that end up with zero tasks after filtering
      if (tasks.length === 0) continue;

      result.push({
        id: phaseDef.id,
        label: phaseDef.label,
        description: phaseDef.description,
        tasks,
        status: "pending",
      });
    }

    return result;
  }

  private filterAndRewriteTasks(
    taskDefs: readonly TaskDefinition[],
    featureSet: Set<Feature>,
    resolvedStack: Record<string, string>
  ): ExecutionTask[] {
    // Collect IDs of tasks that survive filtering, so we can fix dangling deps
    const includedIds = new Set<string>();
    const tasks: ExecutionTask[] = [];

    for (const def of taskDefs) {
      if (!this.shouldIncludeTask(def, featureSet)) continue;
      includedIds.add(def.id);
    }

    for (const def of taskDefs) {
      if (!includedIds.has(def.id)) continue;

      // Remove dependency edges pointing to excluded tasks
      const prunedDeps = def.dependsOn.filter((dep) => includedIds.has(dep));

      tasks.push({
        ...def,
        dependsOn: prunedDeps,
        prompt: this.rewritePrompt(def.prompt, resolvedStack),
        status: "pending",
      });
    }

    return tasks;
  }

  /**
   * A task is included if:
   *   - It has no forFeatures constraint (always included), OR
   *   - At least one of its forFeatures is in the detected features set
   */
  private shouldIncludeTask(
    def: TaskDefinition,
    featureSet: Set<Feature>
  ): boolean {
    if (!def.forFeatures || def.forFeatures.length === 0) return true;
    return def.forFeatures.some((f) => featureSet.has(f));
  }

  /**
   * Replace generic technology references in prompts with the resolved stack.
   * E.g. "Install Prisma and configure it for PostgreSQL" stays as-is if
   * those are the resolved choices, but "Set up the ORM" becomes
   * "Set up Prisma" based on the resolved stack.
   *
   * We use simple token replacement for known placeholders.
   */
  private rewritePrompt(
    prompt: string,
    resolvedStack: Record<string, string>
  ): string {
    const replacements: Record<string, StackCategory> = {
      "the framework": "framework",
      "the styling solution": "styling",
      "the database": "database",
      "the ORM": "orm",
      "the auth provider": "auth",
      "the payment provider": "payment",
      "the CMS": "cms",
      "the hosting platform": "hosting",
      "the testing framework": "testing",
      "the chosen provider": "auth",
    };

    let result = prompt;
    for (const [placeholder, category] of Object.entries(replacements)) {
      const resolved = resolvedStack[category];
      if (resolved) {
        result = result.replace(placeholder, resolved);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Dependency validation
  // -------------------------------------------------------------------------

  /**
   * Verify that every dependsOn reference points to an existing task
   * and that there are no cycles.
   */
  private validateDependencies(phases: readonly ExecutionPhase[]): void {
    const allTasks = phases.flatMap((p) => p.tasks);
    const taskIds = new Set(allTasks.map((t) => t.id));

    // Check for dangling references
    for (const task of allTasks) {
      for (const dep of task.dependsOn) {
        if (!taskIds.has(dep)) {
          throw new Error(
            `Task "${task.id}" depends on "${dep}" which does not exist in the plan`
          );
        }
      }
    }

    // Check for cycles via topological sort
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving task "${id}"`);
      }

      visiting.add(id);
      const task = taskMap.get(id);
      if (task) {
        for (const dep of task.dependsOn) {
          visit(dep);
        }
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const task of allTasks) {
      visit(task.id);
    }
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  private countByAgent(
    tasks: readonly ExecutionTask[]
  ): Record<AgentRole, number> {
    const counts: Record<AgentRole, number> = {
      claude: 0,
      copilot: 0,
      codex: 0,
    };
    for (const task of tasks) {
      counts[task.agent]++;
    }
    return counts;
  }
}
