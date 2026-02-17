import { describe, it, expect, beforeEach } from "vitest";
import {
  AgentSelector,
  extractSignals,
  createEmptyStore,
  recomputeAggregates,
} from "./agentSelector";
import type {
  AgentAvailability,
  AgentRole,
  BenchmarkEntry,
  BenchmarkStore,
  ExecutionTask,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let selector: AgentSelector;

beforeEach(() => {
  selector = new AgentSelector();
});

/** Build a minimal ExecutionTask for testing. */
function makeTask(overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id: "test-task",
    label: "Test Task",
    prompt: "Do something",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 10,
    parallelizable: false,
    status: "pending",
    ...overrides,
  };
}

/** Build a benchmark entry. */
function makeEntry(overrides: Partial<BenchmarkEntry> = {}): BenchmarkEntry {
  return {
    agent: "claude",
    taskId: "test-task",
    taskType: "test",
    success: true,
    durationSeconds: 60,
    qualityScore: 0.8,
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("AgentSelector", () => {
  // -------------------------------------------------------------------------
  // Signal extraction
  // -------------------------------------------------------------------------

  describe("extractSignals", () => {
    it("detects architectural signals", () => {
      const task = makeTask({
        prompt: "Design the system architecture and data model for the API",
      });
      const signals = extractSignals(task);
      expect(signals.isArchitectural).toBe(true);
    });

    it("detects boilerplate signals", () => {
      const task = makeTask({
        prompt: "Scaffold the UI components and create page layouts",
      });
      const signals = extractSignals(task);
      expect(signals.isBoilerplate).toBe(true);
    });

    it("detects testing signals", () => {
      const task = makeTask({
        prompt: "Write unit tests and integration tests for the auth module",
      });
      const signals = extractSignals(task);
      expect(signals.isTesting).toBe(true);
    });

    it("detects async signals", () => {
      const task = makeTask({
        prompt: "Run database migrations and seed initial data in background",
      });
      const signals = extractSignals(task);
      expect(signals.isAsync).toBe(true);
    });

    it("extracts keywords from prompt", () => {
      const task = makeTask({
        prompt: "Set up Prisma schema and PostgreSQL database with auth",
      });
      const signals = extractSignals(task);
      expect(signals.keywords).toContain("prisma");
      expect(signals.keywords).toContain("database");
      expect(signals.keywords).toContain("auth");
    });

    it("classifies trivial complexity for short tasks", () => {
      const signals = extractSignals(makeTask({ estimatedMinutes: 2 }));
      expect(signals.taskComplexity).toBe("trivial");
    });

    it("classifies simple complexity", () => {
      const signals = extractSignals(makeTask({ estimatedMinutes: 5 }));
      expect(signals.taskComplexity).toBe("simple");
    });

    it("classifies moderate complexity", () => {
      const signals = extractSignals(makeTask({ estimatedMinutes: 15 }));
      expect(signals.taskComplexity).toBe("moderate");
    });

    it("classifies complex for long tasks", () => {
      const signals = extractSignals(makeTask({ estimatedMinutes: 30 }));
      expect(signals.taskComplexity).toBe("complex");
    });

    it("preserves template agent", () => {
      const signals = extractSignals(makeTask({ agent: "codex" }));
      expect(signals.templateAgent).toBe("codex");
    });
  });

  // -------------------------------------------------------------------------
  // Agent recommendation — matrix-based
  // -------------------------------------------------------------------------

  describe("matrix-based recommendations", () => {
    it("recommends Claude for architectural tasks", () => {
      const task = makeTask({
        prompt: "Design the system architecture, plan the data model and review security",
        estimatedMinutes: 20,
      });
      const rec = selector.recommend(task);
      expect(rec.agent).toBe("claude");
      expect(rec.confidence).toBeGreaterThan(0.3);
    });

    it("recommends Copilot for UI boilerplate tasks", () => {
      const task = makeTask({
        id: "create-ui",
        label: "Create UI Components",
        agent: "copilot",
        prompt: "Create page layout with button, form, and card components using Tailwind CSS",
        estimatedMinutes: 5,
      });
      const rec = selector.recommend(task);
      expect(rec.agent).toBe("copilot");
    });

    it("recommends Codex for testing tasks", () => {
      const task = makeTask({
        agent: "codex",
        prompt: "Write unit tests and integration tests with full coverage assertions",
        estimatedMinutes: 15,
      });
      const rec = selector.recommend(task);
      expect(rec.agent).toBe("codex");
    });

    it("recommends Codex for async/devops tasks", () => {
      const task = makeTask({
        agent: "codex",
        prompt: "Set up Docker deployment, CI/CD pipeline, and environment config",
        estimatedMinutes: 10,
      });
      const rec = selector.recommend(task);
      expect(rec.agent).toBe("codex");
    });

    it("recommends Claude for security-related tasks", () => {
      const task = makeTask({
        id: "setup-auth",
        label: "Setup Authentication",
        prompt: "Implement authentication with OAuth, JWT tokens and permission-based authorization",
        estimatedMinutes: 15,
      });
      const rec = selector.recommend(task);
      expect(rec.agent).toBe("claude");
    });

    it("returns all three fallbacks when all agents available", () => {
      const task = makeTask({
        prompt: "Design the API architecture",
        estimatedMinutes: 15,
      });
      const rec = selector.recommend(task);
      // Primary + fallbacks should cover all available agents
      const allAgents = [rec.agent, ...rec.fallbacks];
      expect(allAgents).toHaveLength(3);
      expect(new Set(allAgents).size).toBe(3);
    });

    it("provides a non-empty reason", () => {
      const task = makeTask({ prompt: "Do something generic" });
      const rec = selector.recommend(task);
      expect(rec.reason.length).toBeGreaterThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // Fallback logic
  // -------------------------------------------------------------------------

  describe("fallback logic", () => {
    it("falls back when preferred agent is unavailable", () => {
      const task = makeTask({
        prompt: "Design the architecture and review security model",
        estimatedMinutes: 20,
      });
      // Claude would normally win, but make it unavailable
      const availability: AgentAvailability = {
        claude: false,
        copilot: true,
        codex: true,
      };
      const rec = selector.recommend(task, availability);
      expect(rec.agent).not.toBe("claude");
      expect(rec.fallbacks).not.toContain("claude");
    });

    it("uses second-best when only two agents available", () => {
      const task = makeTask({
        agent: "copilot",
        prompt: "Create UI components and page layouts",
        estimatedMinutes: 5,
      });
      const availability: AgentAvailability = {
        claude: true,
        copilot: false,
        codex: true,
      };
      const rec = selector.recommend(task, availability);
      expect(rec.agent).not.toBe("copilot");
      expect(rec.fallbacks).not.toContain("copilot");
    });

    it("uses only available agent when just one is available", () => {
      const task = makeTask({ prompt: "Do anything" });
      const availability: AgentAvailability = {
        claude: false,
        copilot: false,
        codex: true,
      };
      const rec = selector.recommend(task, availability);
      expect(rec.agent).toBe("codex");
      expect(rec.fallbacks).toHaveLength(0);
    });

    it("excludes unavailable agents from fallback list", () => {
      const task = makeTask({ prompt: "Generic task" });
      const availability: AgentAvailability = {
        claude: true,
        copilot: false,
        codex: true,
      };
      const rec = selector.recommend(task, availability);
      expect(rec.fallbacks).not.toContain("copilot");
    });
  });

  // -------------------------------------------------------------------------
  // Benchmark learning
  // -------------------------------------------------------------------------

  describe("benchmark learning", () => {
    it("records entries and updates store", () => {
      selector.recordBenchmark(makeEntry({ agent: "claude", taskType: "auth" }));
      selector.recordBenchmark(makeEntry({ agent: "copilot", taskType: "auth" }));

      const store = selector.getBenchmarks();
      expect(store.entries).toHaveLength(2);
      expect(store.aggregates["auth"]).toBeDefined();
    });

    it("benchmark data influences recommendations", () => {
      // Record strong copilot performance on "design" tasks
      for (let i = 0; i < 10; i++) {
        selector.recordBenchmark(
          makeEntry({
            agent: "copilot",
            taskType: "design",
            taskId: "design",
            success: true,
            qualityScore: 0.95,
            durationSeconds: 30,
          })
        );
      }
      // Record poor claude performance on "design" tasks
      for (let i = 0; i < 10; i++) {
        selector.recordBenchmark(
          makeEntry({
            agent: "claude",
            taskType: "design",
            taskId: "design",
            success: false,
            qualityScore: 0.2,
            durationSeconds: 120,
          })
        );
      }

      // Task ID matches "design" type — benchmark should boost copilot
      const task = makeTask({
        id: "design",
        prompt: "Simple layout task",
        estimatedMinutes: 3,
        agent: "copilot",
      });
      const rec = selector.recommend(task);
      // Copilot should win due to benchmark + boilerplate-ish simplicity
      expect(rec.agent).toBe("copilot");
    });

    it("loads external benchmark data", () => {
      const store: BenchmarkStore = {
        version: 1,
        entries: [makeEntry({ agent: "codex", taskType: "test" })],
        aggregates: recomputeAggregates([
          makeEntry({ agent: "codex", taskType: "test" }),
        ]),
      };

      selector.loadBenchmarks(store);
      expect(selector.getBenchmarks().entries).toHaveLength(1);
    });

    it("empty benchmarks don't crash recommendation", () => {
      const task = makeTask({ prompt: "Anything" });
      expect(() => selector.recommend(task)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Aggregate computation
  // -------------------------------------------------------------------------

  describe("recomputeAggregates", () => {
    it("groups entries by task type and agent", () => {
      const entries: BenchmarkEntry[] = [
        makeEntry({ agent: "claude", taskType: "auth", success: true, qualityScore: 0.9 }),
        makeEntry({ agent: "claude", taskType: "auth", success: true, qualityScore: 0.8 }),
        makeEntry({ agent: "copilot", taskType: "auth", success: false, qualityScore: 0.3 }),
        makeEntry({ agent: "claude", taskType: "ui", success: true, qualityScore: 0.7 }),
      ];

      const agg = recomputeAggregates(entries);

      expect(agg["auth"]!["claude"].attempts).toBe(2);
      expect(agg["auth"]!["claude"].successes).toBe(2);
      expect(agg["auth"]!["claude"].avgQualityScore).toBe(0.85);
      expect(agg["auth"]!["copilot"].attempts).toBe(1);
      expect(agg["auth"]!["copilot"].successes).toBe(0);
      expect(agg["ui"]!["claude"].attempts).toBe(1);
    });

    it("handles empty entries", () => {
      const agg = recomputeAggregates([]);
      expect(Object.keys(agg)).toHaveLength(0);
    });

    it("rounds averages for clean storage", () => {
      const entries: BenchmarkEntry[] = [
        makeEntry({ agent: "claude", taskType: "t", durationSeconds: 33, qualityScore: 0.333 }),
        makeEntry({ agent: "claude", taskType: "t", durationSeconds: 67, qualityScore: 0.667 }),
      ];
      const agg = recomputeAggregates(entries);
      // Duration: (33+67)/2 = 50 → 50.0
      expect(agg["t"]!["claude"].avgDurationSeconds).toBe(50);
      // Quality: (0.333+0.667)/2 = 0.5
      expect(agg["t"]!["claude"].avgQualityScore).toBe(0.5);
    });
  });

  // -------------------------------------------------------------------------
  // Empty store
  // -------------------------------------------------------------------------

  describe("createEmptyStore", () => {
    it("returns a valid empty store", () => {
      const store = createEmptyStore();
      expect(store.version).toBe(1);
      expect(store.entries).toHaveLength(0);
      expect(Object.keys(store.aggregates)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Confidence scoring
  // -------------------------------------------------------------------------

  describe("confidence scoring", () => {
    it("high confidence for clear-cut architectural tasks", () => {
      const task = makeTask({
        prompt: "Architect the system design, review security model, plan data structure",
        estimatedMinutes: 25,
      });
      const rec = selector.recommend(task);
      expect(rec.confidence).toBeGreaterThan(0.4);
    });

    it("lower confidence for ambiguous tasks", () => {
      const task = makeTask({
        prompt: "Do something with the project",
        estimatedMinutes: 10,
      });
      const rec = selector.recommend(task);
      // Generic tasks should have relatively lower confidence
      expect(rec.confidence).toBeLessThan(0.9);
    });

    it("confidence is between 0 and 1", () => {
      const tasks = [
        makeTask({ prompt: "Design architecture", estimatedMinutes: 25 }),
        makeTask({ prompt: "Create UI components", estimatedMinutes: 5 }),
        makeTask({ prompt: "Write tests", estimatedMinutes: 15 }),
        makeTask({ prompt: "Something vague", estimatedMinutes: 10 }),
      ];
      for (const task of tasks) {
        const rec = selector.recommend(task);
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Explanation quality
  // -------------------------------------------------------------------------

  describe("explanation", () => {
    it("mentions the agent name", () => {
      const task = makeTask({
        prompt: "Design the system architecture",
        estimatedMinutes: 20,
      });
      const rec = selector.recommend(task);
      expect(rec.reason).toMatch(/Claude|Copilot|Codex/);
    });

    it("mentions architectural reasoning for Claude", () => {
      const task = makeTask({
        prompt: "Architect the system and review security",
        estimatedMinutes: 20,
      });
      const rec = selector.recommend(task);
      if (rec.agent === "claude") {
        expect(rec.reason).toContain("architecture");
      }
    });

    it("mentions template match when applicable", () => {
      const task = makeTask({
        agent: "codex",
        prompt: "Run lint and format the codebase in batch mode",
        estimatedMinutes: 3,
      });
      const rec = selector.recommend(task);
      if (rec.agent === "codex") {
        expect(rec.reason).toContain("template");
      }
    });
  });

  // -------------------------------------------------------------------------
  // End-to-end with real-ish tasks
  // -------------------------------------------------------------------------

  describe("end-to-end with realistic tasks", () => {
    it("assigns diverse agents across a mixed workload", () => {
      const tasks: ExecutionTask[] = [
        makeTask({
          id: "setup-auth",
          prompt: "Design and implement authentication with OAuth and JWT, review security model",
          agent: "claude",
          estimatedMinutes: 20,
        }),
        makeTask({
          id: "create-ui",
          prompt: "Create page layouts, button components, and form elements with Tailwind CSS",
          agent: "copilot",
          estimatedMinutes: 5,
        }),
        makeTask({
          id: "write-tests",
          prompt: "Write unit tests and integration tests for all API endpoints with coverage",
          agent: "codex",
          estimatedMinutes: 15,
        }),
        makeTask({
          id: "deploy-setup",
          prompt: "Configure Docker, CI/CD pipeline, and deploy to Vercel",
          agent: "codex",
          estimatedMinutes: 10,
        }),
      ];

      const recommendations = tasks.map((t) => selector.recommend(t));
      const agents = new Set(recommendations.map((r) => r.agent));

      // At least 2 different agents should be recommended
      expect(agents.size).toBeGreaterThanOrEqual(2);

      // All recommendations should have valid structure
      for (const rec of recommendations) {
        expect(["claude", "copilot", "codex"]).toContain(rec.agent);
        expect(rec.confidence).toBeGreaterThanOrEqual(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
        expect(rec.reason.length).toBeGreaterThan(0);
        expect(rec.fallbacks.length).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
