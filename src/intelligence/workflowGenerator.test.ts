import { describe, it, expect, beforeEach } from "vitest";
import { WorkflowGenerator } from "./workflowGenerator";
import { analyzeIntent } from "./intentAnalyzer";
import { registerTemplate } from "./workflowTemplates";
import type {
  ExecutionPlan,
  Feature,
  ProjectIntent,
  WorkflowTemplate,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let gen: WorkflowGenerator;

beforeEach(() => {
  gen = new WorkflowGenerator();
});

/** Shortcut: analyze intent and generate plan in one step. */
function plan(input: string): ExecutionPlan {
  return gen.generate(analyzeIntent(input));
}

/** Build a minimal ProjectIntent for targeted tests. */
function makeIntent(overrides: Partial<ProjectIntent> = {}): ProjectIntent {
  return {
    projectType: "ecommerce",
    projectTypeConfidence: "high",
    features: ["auth", "payments", "database"],
    stackHints: [],
    complexity: "moderate",
    rawInput: "test input",
    normalizedInput: "test input",
    ambiguities: [],
    ...overrides,
  };
}

/** Collect all task IDs across all phases. */
function allTaskIds(p: ExecutionPlan): string[] {
  return p.phases.flatMap((ph) => ph.tasks.map((t) => t.id));
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("WorkflowGenerator", () => {
  // -------------------------------------------------------------------------
  // Template selection
  // -------------------------------------------------------------------------

  describe("template selection", () => {
    it("selects e-commerce template for ecommerce intent", () => {
      const p = plan("Build an e-commerce site with Stripe");
      expect(p.templateName).toBe("E-commerce Store");
    });

    it("selects landing template for landing page intent", () => {
      const p = plan("Marketing landing page for my product");
      expect(p.templateName).toBe("Landing Page");
    });

    it("selects dashboard template for dashboard intent", () => {
      const p = plan("Admin dashboard with charts and user auth");
      expect(p.templateName).toBe("SaaS Dashboard");
    });

    it("selects dashboard template for SaaS intent", () => {
      const p = plan("SaaS platform with multi-tenant support");
      expect(p.templateName).toBe("SaaS Dashboard");
    });

    it("selects blog template for blog intent", () => {
      const p = plan("Blog with MDX and tags");
      expect(p.templateName).toBe("Blog / Content Site");
    });

    it("selects fallback for unknown project type", () => {
      const p = gen.generate(makeIntent({ projectType: "unknown" }));
      expect(p.templateName).toBe("Generic Web Project");
    });

    it("selects fallback for portfolio", () => {
      const p = plan("Personal portfolio site");
      expect(p.templateName).toBe("Generic Web Project");
    });
  });

  // -------------------------------------------------------------------------
  // Feature-based task filtering
  // -------------------------------------------------------------------------

  describe("feature-based filtering", () => {
    it("includes auth tasks when auth feature is detected", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "payments", "database"] })
      );
      expect(allTaskIds(p)).toContain("setup-auth");
    });

    it("excludes auth tasks when auth feature is NOT detected", () => {
      const p = gen.generate(
        makeIntent({ features: ["database"] })
      );
      expect(allTaskIds(p)).not.toContain("setup-auth");
    });

    it("includes database tasks when database feature is detected", () => {
      const p = gen.generate(
        makeIntent({ features: ["database"] })
      );
      expect(allTaskIds(p)).toContain("setup-db");
    });

    it("excludes search tasks when search feature is NOT detected", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "database"] })
      );
      expect(allTaskIds(p)).not.toContain("search-feature");
    });

    it("includes search tasks when search feature IS detected", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "database", "search"] })
      );
      expect(allTaskIds(p)).toContain("search-feature");
    });

    it("always includes tasks without forFeatures constraint", () => {
      // init-project has no forFeatures — always included
      const p = gen.generate(makeIntent({ features: [] }));
      expect(allTaskIds(p)).toContain("init-project");
    });

    it("drops empty phases after filtering", () => {
      // E-commerce with no features → some phases may lose all tasks
      const p = gen.generate(
        makeIntent({ features: [] })
      );
      for (const phase of p.phases) {
        expect(phase.tasks.length).toBeGreaterThan(0);
      }
    });

    it("prunes dangling dependencies when tasks are excluded", () => {
      // If setup-db is excluded (no database feature), tasks depending on it
      // should have that dependency removed
      const p = gen.generate(
        makeIntent({ features: ["auth"] })
      );
      for (const phase of p.phases) {
        for (const task of phase.tasks) {
          for (const dep of task.dependsOn) {
            expect(
              allTaskIds(p),
              `Task "${task.id}" depends on "${dep}" which should exist`
            ).toContain(dep);
          }
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Stack resolution
  // -------------------------------------------------------------------------

  describe("stack resolution", () => {
    it("uses template defaults when user specifies nothing", () => {
      const p = gen.generate(makeIntent({ stackHints: [] }));
      expect(p.resolvedStack["framework"]).toBe("Next.js");
      expect(p.resolvedStack["styling"]).toBe("Tailwind CSS");
    });

    it("overrides defaults with user-specified stack", () => {
      const p = gen.generate(
        makeIntent({
          stackHints: [
            { name: "Remix", category: "framework", matchedToken: "remix" },
            { name: "Sass", category: "styling", matchedToken: "sass" },
          ],
        })
      );
      expect(p.resolvedStack["framework"]).toBe("Remix");
      expect(p.resolvedStack["styling"]).toBe("Sass");
    });

    it("preserves defaults for categories user didn't specify", () => {
      const p = gen.generate(
        makeIntent({
          stackHints: [
            { name: "Vue", category: "framework", matchedToken: "vue" },
          ],
        })
      );
      expect(p.resolvedStack["framework"]).toBe("Vue");
      // Styling should still be template default
      expect(p.resolvedStack["styling"]).toBe("Tailwind CSS");
    });

    it("does not include undefined defaults", () => {
      // Landing template has no default database
      const p = plan("Landing page for my product");
      expect(p.resolvedStack["database"]).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Prompt rewriting
  // -------------------------------------------------------------------------

  describe("prompt rewriting", () => {
    it("replaces generic placeholders with resolved stack names", () => {
      const intent = makeIntent({
        projectType: "unknown",
        features: ["auth"],
        stackHints: [
          { name: "Clerk", category: "auth", matchedToken: "clerk" },
        ],
      });
      const p = gen.generate(intent);
      const authTask = p.phases
        .flatMap((ph) => ph.tasks)
        .find((t) => t.id === "setup-auth");

      expect(authTask).toBeDefined();
      // "the chosen provider" should be replaced with "Clerk"
      expect(authTask!.prompt).toContain("Clerk");
      expect(authTask!.prompt).not.toContain("the chosen provider");
    });
  });

  // -------------------------------------------------------------------------
  // Dependency graph validation
  // -------------------------------------------------------------------------

  describe("dependency validation", () => {
    it("all task dependencies exist in the plan", () => {
      // Test across all project types
      const inputs = [
        "e-commerce site with Stripe, auth, database, search, admin, email, seo",
        "landing page with forms, analytics, seo",
        "dashboard with auth, database, charts, admin, realtime",
        "blog with MDX, search, seo",
      ];

      for (const input of inputs) {
        const p = plan(input);
        const ids = new Set(allTaskIds(p));

        for (const phase of p.phases) {
          for (const task of phase.tasks) {
            for (const dep of task.dependsOn) {
              expect(
                ids.has(dep),
                `[${input}] Task "${task.id}" depends on "${dep}" which doesn't exist`
              ).toBe(true);
            }
          }
        }
      }
    });

    it("throws on circular dependency", () => {
      const cyclicTemplate: WorkflowTemplate = {
        forProjectTypes: ["unknown"],
        name: "Cyclic Test",
        description: "Test",
        defaultStack: {
          framework: undefined, styling: undefined, database: undefined,
          payment: undefined, cms: undefined, hosting: undefined,
          testing: undefined, language: undefined, runtime: undefined,
          orm: undefined, auth: undefined, api: undefined,
        },
        phases: [{
          id: "p1",
          label: "Phase 1",
          description: "Test",
          tasks: [
            {
              id: "a", label: "A", prompt: "A",
              agent: "claude", dependsOn: ["b"],
              estimatedMinutes: 1, parallelizable: false,
            },
            {
              id: "b", label: "B", prompt: "B",
              agent: "claude", dependsOn: ["a"],
              estimatedMinutes: 1, parallelizable: false,
            },
          ],
        }],
      };

      // Temporarily register the cyclic template
      registerTemplate(cyclicTemplate);

      const intent = makeIntent({ projectType: "unknown", features: [] });
      expect(() => gen.generate(intent)).toThrow("Circular dependency");
    });
  });

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  describe("statistics", () => {
    it("counts total tasks correctly", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "payments", "database"] })
      );
      const actual = p.phases.reduce((sum, ph) => sum + ph.tasks.length, 0);
      expect(p.stats.totalTasks).toBe(actual);
    });

    it("counts tasks by agent", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "payments", "database"] })
      );
      const { claude, copilot, codex } = p.stats.tasksByAgent;
      expect(claude + copilot + codex).toBe(p.stats.totalTasks);
    });

    it("counts parallelizable tasks", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "payments", "database"] })
      );
      const actual = p.phases
        .flatMap((ph) => ph.tasks)
        .filter((t) => t.parallelizable).length;
      expect(p.stats.parallelizableTasks).toBe(actual);
    });

    it("calculates estimated total minutes", () => {
      const p = gen.generate(
        makeIntent({ features: ["auth", "payments", "database"] })
      );
      const actual = p.phases
        .flatMap((ph) => ph.tasks)
        .reduce((sum, t) => sum + t.estimatedMinutes, 0);
      expect(p.estimatedTotalMinutes).toBe(actual);
    });

    it("estimated time is reasonable", () => {
      const p = plan("e-commerce site with Stripe and auth");
      expect(p.estimatedTotalMinutes).toBeGreaterThan(10);
      expect(p.estimatedTotalMinutes).toBeLessThan(200);
    });
  });

  // -------------------------------------------------------------------------
  // Initial status
  // -------------------------------------------------------------------------

  describe("initial status", () => {
    it("all phases start as pending", () => {
      const p = plan("e-commerce site with Stripe");
      for (const phase of p.phases) {
        expect(phase.status).toBe("pending");
      }
    });

    it("all tasks start as pending", () => {
      const p = plan("e-commerce site with Stripe");
      for (const phase of p.phases) {
        for (const task of phase.tasks) {
          expect(task.status).toBe("pending");
        }
      }
    });
  });

  // -------------------------------------------------------------------------
  // Intent preservation
  // -------------------------------------------------------------------------

  describe("intent preservation", () => {
    it("stores the original intent in the plan", () => {
      const intent = analyzeIntent("e-commerce site with Stripe");
      const p = gen.generate(intent);
      expect(p.intent).toBe(intent);
    });
  });

  // -------------------------------------------------------------------------
  // Custom template registration
  // -------------------------------------------------------------------------

  describe("custom templates", () => {
    it("custom templates override built-in ones", () => {
      const custom: WorkflowTemplate = {
        forProjectTypes: ["landing"],
        name: "Custom Landing",
        description: "My custom landing template",
        defaultStack: {
          framework: "Astro", styling: "Tailwind CSS", database: undefined,
          payment: undefined, cms: undefined, hosting: "Netlify",
          testing: "Vitest", language: "TypeScript", runtime: "Node.js",
          orm: undefined, auth: undefined, api: undefined,
        },
        phases: [{
          id: "build",
          label: "Build",
          description: "Build everything",
          tasks: [{
            id: "do-it",
            label: "Build it all",
            prompt: "Build the landing page",
            agent: "claude",
            dependsOn: [],
            estimatedMinutes: 10,
            parallelizable: false,
          }],
        }],
      };

      registerTemplate(custom);

      const p = plan("landing page for my startup");
      expect(p.templateName).toBe("Custom Landing");
      expect(p.resolvedStack["framework"]).toBe("Astro");
      expect(p.resolvedStack["hosting"]).toBe("Netlify");
    });
  });

  // -------------------------------------------------------------------------
  // Full integration: end-to-end from user input to plan
  // -------------------------------------------------------------------------

  describe("end-to-end", () => {
    it("e-commerce with full features produces a complete plan", () => {
      const p = plan(
        "Next.js e-commerce with Stripe, Prisma, PostgreSQL, auth, search, admin, email, SEO"
      );

      expect(p.templateName).toBe("E-commerce Store");
      expect(p.phases.length).toBeGreaterThanOrEqual(3);
      expect(p.stats.totalTasks).toBeGreaterThan(10);
      expect(p.resolvedStack["framework"]).toBe("Next.js");
      expect(p.resolvedStack["payment"]).toBe("Stripe");
      expect(p.resolvedStack["orm"]).toBe("Prisma");
      expect(p.resolvedStack["database"]).toBe("PostgreSQL");

      // Should have tasks from multiple agents
      expect(p.stats.tasksByAgent.claude).toBeGreaterThan(0);
      expect(p.stats.tasksByAgent.copilot).toBeGreaterThan(0);
      expect(p.stats.tasksByAgent.codex).toBeGreaterThan(0);
    });

    it("minimal landing page produces a lean plan", () => {
      // Use a non-landing type to avoid collision with custom template test
      const p = plan("simple blog with MDX");

      expect(p.stats.totalTasks).toBeGreaterThan(2);
      // Blog pages are mostly copilot work
      expect(p.stats.tasksByAgent.copilot).toBeGreaterThanOrEqual(
        p.stats.tasksByAgent.claude
      );
    });

    it("dashboard with realtime includes realtime task", () => {
      const p = plan("dashboard with charts, auth, database, and real-time updates");
      const ids = allTaskIds(p);
      expect(ids).toContain("realtime-updates");
    });

    it("blog without search excludes search task", () => {
      const p = plan("simple blog with MDX");
      const ids = allTaskIds(p);
      expect(ids).not.toContain("search-blog");
    });

    it("blog with search includes search task", () => {
      const p = plan("blog with MDX and full-text search");
      const ids = allTaskIds(p);
      expect(ids).toContain("search-blog");
    });
  });
});
