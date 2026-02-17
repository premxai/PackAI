import { describe, it, expect } from "vitest";
import { analyzeIntent, WorkflowGenerator, AgentSelector } from "../../intelligence";
import { DependencyResolver } from "../../orchestration/dependencyResolver";
import { QualityGateRunner } from "../../execution/qualityGates";
import type { AgentRole, ExecutionTask } from "../../intelligence/types";
import type { AgentOutput } from "../../orchestration/contextCoordinator";

// ---------------------------------------------------------------------------
// Project Scenario: E-commerce (end-to-end style)
// ---------------------------------------------------------------------------

describe("Project Scenario: E-commerce", () => {
  const intent = analyzeIntent(
    "Build an e-commerce store with Stripe payments and PostgreSQL database"
  );
  const generator = new WorkflowGenerator();
  const plan = generator.generate(intent);

  // Run agent selection
  const selector = new AgentSelector();
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      const rec = selector.recommend(task);
      (task as { agent: AgentRole }).agent = rec.agent;
    }
  }

  it("intent is recognized as ecommerce type", () => {
    expect(intent.projectType).toBe("ecommerce");
  });

  it("plan has at least 3 phases", () => {
    expect(plan.phases.length).toBeGreaterThanOrEqual(3);
  });

  it("scaffold phase first task has no dependencies", () => {
    const scaffoldPhase = plan.phases[0]!;
    expect(scaffoldPhase.label.toLowerCase()).toContain("setup");
    const firstTask = scaffoldPhase.tasks[0]!;
    expect(firstTask.dependsOn).toHaveLength(0);
  });

  it("database tasks depend on scaffold tasks", () => {
    const allTasks = plan.phases.flatMap((p) => p.tasks);
    const dbTasks = allTasks.filter(
      (t) =>
        t.label.toLowerCase().includes("database") ||
        t.label.toLowerCase().includes("prisma") ||
        t.label.toLowerCase().includes("schema")
    );
    // At least one database task
    expect(dbTasks.length).toBeGreaterThan(0);
    // Each should depend on something
    for (const task of dbTasks) {
      expect(task.dependsOn.length).toBeGreaterThan(0);
    }
  });

  it("agent assignments include claude for architecture tasks", () => {
    const allTasks = plan.phases.flatMap((p) => p.tasks);
    const architectureTasks = allTasks.filter(
      (t) =>
        t.label.toLowerCase().includes("design") ||
        t.label.toLowerCase().includes("schema") ||
        t.label.toLowerCase().includes("architect")
    );
    if (architectureTasks.length > 0) {
      const hasClaudeArchTask = architectureTasks.some((t) => t.agent === "claude");
      expect(hasClaudeArchTask).toBe(true);
    }
  });

  it("dependency graph is a valid DAG", () => {
    const allTasks = plan.phases.flatMap((p) => p.tasks);
    const resolver = new DependencyResolver();
    // topologicalSort throws on cycles
    const sorted = resolver.topologicalSort(allTasks);
    expect(sorted.length).toBe(allTasks.length);
  });

  it("no task depends on a later task within the topological order", () => {
    const allTasks = plan.phases.flatMap((p) => p.tasks);
    const resolver = new DependencyResolver();
    const sorted = resolver.topologicalSort(allTasks);
    const indexMap = new Map(sorted.map((t, i) => [t.id, i]));

    for (const task of sorted) {
      for (const dep of task.dependsOn) {
        const depIndex = indexMap.get(dep);
        const taskIndex = indexMap.get(task.id);
        expect(depIndex).toBeDefined();
        expect(taskIndex).toBeDefined();
        expect(depIndex!).toBeLessThan(taskIndex!);
      }
    }
  });

  it("estimated total minutes is reasonable (>30 for e-commerce)", () => {
    expect(plan.estimatedTotalMinutes).toBeGreaterThan(30);
  });

  it("plan stats match actual task counts", () => {
    const actualCount = plan.phases.reduce((sum, p) => sum + p.tasks.length, 0);
    expect(plan.stats.totalTasks).toBe(actualCount);
  });

  it("quality gates pass on well-formed output", () => {
    const runner = new QualityGateRunner();
    const task = plan.phases[0]!.tasks[0]!;
    const output: AgentOutput = {
      taskId: task.id,
      agent: task.agent,
      output: `
        // Initialize Next.js project
        import { createApp } from 'next/app';

        export default function App({ Component, pageProps }) {
          return <Component {...pageProps} />;
        }
      `,
    };
    const report = runner.check(output, {
      taskId: task.id,
      agent: task.agent,
      projectLanguage: "typescript",
      strictMode: false,
    });
    expect(report.passed).toBe(true);
  });

  it("quality gates detect security issues in code blocks", () => {
    const runner = new QualityGateRunner();
    const task = plan.phases[0]!.tasks[0]!;
    const output: AgentOutput = {
      taskId: task.id,
      agent: task.agent,
      output: [
        "Here is the config:",
        "```typescript",
        'const password = "hardcoded_secret_123";',
        'const token = "sk-live-abc12345678";',
        "```",
      ].join("\n"),
    };
    const report = runner.check(output, {
      taskId: task.id,
      agent: task.agent,
      projectLanguage: "typescript",
      strictMode: false,
    });
    expect(report.passed).toBe(false);
    expect(report.errorCount).toBeGreaterThan(0);
  });
});
