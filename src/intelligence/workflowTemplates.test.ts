import { describe, it, expect } from "vitest";
import { getTemplates, findTemplate, registerTemplate } from "./workflowTemplates";
import type { WorkflowTemplate } from "./types";

// ---------------------------------------------------------------------------
// Registry tests
// ---------------------------------------------------------------------------

describe("workflowTemplates", () => {
  describe("getTemplates", () => {
    it("returns at least 5 built-in templates", () => {
      expect(getTemplates().length).toBeGreaterThanOrEqual(5);
    });

    it("includes ecommerce, landing, dashboard, blog, and fallback", () => {
      const names = getTemplates().map((t) => t.name);
      expect(names).toContain("E-commerce Store");
      expect(names).toContain("Landing Page");
      expect(names).toContain("SaaS Dashboard");
      expect(names).toContain("Blog / Content Site");
      // Fallback
      const fallback = getTemplates().find((t) =>
        t.forProjectTypes.includes("unknown")
      );
      expect(fallback).toBeDefined();
    });
  });

  describe("findTemplate", () => {
    it("finds ecommerce template for 'ecommerce'", () => {
      const t = findTemplate("ecommerce");
      expect(t.forProjectTypes).toContain("ecommerce");
    });

    it("finds landing template for 'landing'", () => {
      const t = findTemplate("landing");
      expect(t.forProjectTypes).toContain("landing");
    });

    it("finds dashboard template for 'dashboard'", () => {
      const t = findTemplate("dashboard");
      expect(t.forProjectTypes).toContain("dashboard");
    });

    it("finds dashboard template for 'saas'", () => {
      const t = findTemplate("saas");
      expect(t.forProjectTypes).toContain("saas");
    });

    it("finds blog template for 'blog'", () => {
      const t = findTemplate("blog");
      expect(t.forProjectTypes).toContain("blog");
    });

    it("returns fallback for unknown project type", () => {
      const t = findTemplate("some-random-type");
      // Fallback covers unknown
      expect(t.forProjectTypes).toContain("unknown");
    });
  });

  describe("registerTemplate", () => {
    it("custom template takes priority over built-in", () => {
      const custom: WorkflowTemplate = {
        forProjectTypes: ["ecommerce"],
        name: "Custom Ecommerce",
        description: "Custom version",
        defaultStack: { framework: "Remix" },
        phases: [
          {
            id: "custom-phase",
            label: "Custom Phase",
            description: "Custom phase",
            tasks: [
              {
                id: "custom-task",
                label: "Custom Task",
                prompt: "Do custom thing",
                agent: "claude",
                dependsOn: [],
                estimatedMinutes: 1,
                parallelizable: false,
              },
            ],
          },
        ],
      };
      registerTemplate(custom);

      const found = findTemplate("ecommerce");
      expect(found.name).toBe("Custom Ecommerce");

      // Clean up: remove the custom template so other tests aren't affected
      const templates = getTemplates() as WorkflowTemplate[];
      const idx = templates.indexOf(custom);
      if (idx !== -1) templates.splice(idx, 1);
    });
  });

  // -----------------------------------------------------------------------
  // Data integrity: validate every template's structure
  // -----------------------------------------------------------------------

  describe("template data integrity", () => {
    const templates = getTemplates();
    const validAgents = ["claude", "copilot", "codex"];

    it.each(templates)("$name has non-empty phases", (template) => {
      expect(template.phases.length).toBeGreaterThan(0);
    });

    it.each(templates)(
      "$name: all tasks have required fields",
      (template) => {
        for (const phase of template.phases) {
          for (const task of phase.tasks) {
            expect(task.id).toBeTruthy();
            expect(task.label).toBeTruthy();
            expect(task.prompt).toBeTruthy();
            expect(task.agent).toBeTruthy();
            expect(Array.isArray(task.dependsOn)).toBe(true);
            expect(typeof task.estimatedMinutes).toBe("number");
          }
        }
      }
    );

    it.each(templates)(
      "$name: all dependsOn references point to valid task IDs",
      (template) => {
        const allTaskIds = new Set(
          template.phases.flatMap((p) => p.tasks.map((t) => t.id))
        );
        for (const phase of template.phases) {
          for (const task of phase.tasks) {
            for (const dep of task.dependsOn) {
              expect(allTaskIds.has(dep)).toBe(true);
            }
          }
        }
      }
    );

    it.each(templates)("$name: no circular dependencies", (template) => {
      const allTasks = template.phases.flatMap((p) => p.tasks);
      const visited = new Set<string>();
      const inStack = new Set<string>();
      const taskMap = new Map(allTasks.map((t) => [t.id, t]));

      function hasCycle(taskId: string): boolean {
        if (inStack.has(taskId)) return true;
        if (visited.has(taskId)) return false;
        visited.add(taskId);
        inStack.add(taskId);
        const task = taskMap.get(taskId);
        if (task) {
          for (const dep of task.dependsOn) {
            if (hasCycle(dep)) return true;
          }
        }
        inStack.delete(taskId);
        return false;
      }

      for (const task of allTasks) {
        expect(hasCycle(task.id)).toBe(false);
      }
    });

    it.each(templates)(
      "$name: all agent assignments are valid",
      (template) => {
        for (const phase of template.phases) {
          for (const task of phase.tasks) {
            expect(validAgents).toContain(task.agent);
          }
        }
      }
    );

    it.each(templates)(
      "$name: has a defaultStack with framework",
      (template) => {
        expect(template.defaultStack).toBeDefined();
        expect(template.defaultStack.framework).toBeTruthy();
      }
    );

    it.each(templates)(
      "$name: all task IDs are unique",
      (template) => {
        const ids = template.phases.flatMap((p) => p.tasks.map((t) => t.id));
        expect(new Set(ids).size).toBe(ids.length);
      }
    );
  });
});
