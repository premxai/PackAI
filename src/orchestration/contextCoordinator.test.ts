import { describe, it, expect, beforeEach, vi } from "vitest";
import { ContextCoordinator } from "./contextCoordinator";
import type {
  AgentOutput,
  ContextDomain,
  ContextStore,
  IContextPersistence,
} from "./contextCoordinator";
import type { ExecutionTask } from "../intelligence/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let coordinator: ContextCoordinator;

beforeEach(() => {
  coordinator = new ContextCoordinator();
});

function task(id: string, overrides: Partial<ExecutionTask> = {}): ExecutionTask {
  return {
    id,
    label: id,
    prompt: "Do something",
    agent: "claude",
    dependsOn: [],
    estimatedMinutes: 10,
    parallelizable: true,
    status: "pending",
    ...overrides,
  };
}

function seedProjectContext(): void {
  coordinator.addEntry("project", "framework", "Next.js 14 with App Router", "system");
  coordinator.addEntry("project", "language", "TypeScript strict mode", "system");
  coordinator.addEntry("project", "styling", "Tailwind CSS v3", "system");
  coordinator.addEntry("database", "orm", "Prisma with PostgreSQL", "system");
  coordinator.addEntry("database", "db-schema", "Users, Products, Orders tables", "claude");
  coordinator.addEntry("api", "api-style", "REST with /api/ prefix", "system");
  coordinator.addEntry("api", "endpoint-users", "GET/POST /api/users", "claude");
  coordinator.addEntry("api", "endpoint-products", "GET/POST /api/products", "claude");
  coordinator.addEntry("auth", "auth-provider", "NextAuth with Google OAuth", "claude");
  coordinator.addEntry("auth", "auth-middleware", "Middleware protects /dashboard/*", "claude");
  coordinator.addEntry("frontend", "component-lib", "shadcn/ui components", "system");
  coordinator.addEntry("frontend", "component-ProductCard", "ProductCard component in src/components/", "copilot");
  coordinator.addEntry("testing", "test-framework", "Vitest + React Testing Library", "system");
  coordinator.addEntry("devops", "hosting", "Vercel deployment", "system");
  coordinator.addEntry("payment", "payment-provider", "Stripe with checkout sessions", "claude");
  coordinator.addEntry("design", "architecture", "Feature-based folder structure", "claude");
}

// ===========================================================================
// Tests
// ===========================================================================

describe("ContextCoordinator", () => {
  // -------------------------------------------------------------------------
  // Domain resolution
  // -------------------------------------------------------------------------

  describe("resolveRelevantDomains", () => {
    it("always includes 'project' domain", () => {
      const t = task("x", { prompt: "Do anything" });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("project");
    });

    it("resolves frontend domains for component tasks", () => {
      const t = task("create-ui", {
        prompt: "Create a responsive page layout with styled components",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("frontend");
      expect(domains).toContain("design");
    });

    it("resolves API + database domains for endpoint tasks", () => {
      const t = task("build-api", {
        prompt: "Build REST API endpoints for user management with database queries",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("api");
      expect(domains).toContain("database");
    });

    it("resolves database domain for schema tasks", () => {
      const t = task("setup-db", {
        prompt: "Define the Prisma schema and create migrations",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("database");
    });

    it("resolves auth domain for authentication tasks", () => {
      const t = task("setup-auth", {
        prompt: "Implement OAuth login with JWT tokens",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("auth");
      expect(domains).toContain("api");
    });

    it("resolves broad domains for testing tasks", () => {
      const t = task("write-tests", {
        prompt: "Write unit tests and e2e tests for all modules",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("testing");
      expect(domains).toContain("frontend");
      expect(domains).toContain("api");
      expect(domains).toContain("database");
      expect(domains).toContain("auth");
    });

    it("resolves devops domain for deployment tasks", () => {
      const t = task("deploy", {
        prompt: "Set up Docker and CI/CD pipeline for deployment",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("devops");
    });

    it("includes design domain for claude tasks", () => {
      const t = task("plan", { agent: "claude", prompt: "Plan something" });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("design");
    });

    it("resolves payment domain for checkout tasks", () => {
      const t = task("checkout", {
        prompt: "Build the Stripe checkout flow with payment processing",
      });
      const domains = coordinator.resolveRelevantDomains(t);
      expect(domains).toContain("payment");
      expect(domains).toContain("api");
    });
  });

  // -------------------------------------------------------------------------
  // Context filtering — smart injection per task type
  // -------------------------------------------------------------------------

  describe("getContextForTask", () => {
    beforeEach(seedProjectContext);

    it("frontend task gets frontend + project + design, NOT database details", () => {
      const t = task("build-ui", {
        prompt: "Create the product listing page with styled UI components",
        agent: "copilot",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.entries.map((e) => e.domain));
      expect(domains).toContain("project");
      expect(domains).toContain("frontend");
      expect(domains).toContain("design");
      // Should NOT include raw database schema details
      expect(domains).not.toContain("database");
      expect(domains).not.toContain("devops");
    });

    it("API task gets api + database + auth + design, NOT frontend components", () => {
      const t = task("build-endpoint", {
        prompt: "Build the API endpoint for product CRUD with database access",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.entries.map((e) => e.domain));
      expect(domains).toContain("api");
      expect(domains).toContain("database");
      expect(domains).toContain("design");
      // Should NOT include frontend component details
      expect(domains).not.toContain("frontend");
    });

    it("testing task gets ALL domains (broad context)", () => {
      const t = task("write-tests", {
        prompt: "Write comprehensive test coverage for the application",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.entries.map((e) => e.domain));
      expect(domains).toContain("project");
      expect(domains).toContain("frontend");
      expect(domains).toContain("api");
      expect(domains).toContain("database");
      expect(domains).toContain("auth");
      expect(domains).toContain("testing");
    });

    it("database task does NOT get frontend or payment context", () => {
      const t = task("setup-db", {
        prompt: "Set up the database schema and seed data with migrations",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.entries.map((e) => e.domain));
      expect(domains).toContain("database");
      expect(domains).toContain("project");
      expect(domains).not.toContain("frontend");
      expect(domains).not.toContain("payment");
    });

    it("returns a non-empty summary", () => {
      const t = task("build-ui", {
        prompt: "Create a component for the landing page",
      });
      const ctx = coordinator.getContextForTask(t);
      expect(ctx.summary.length).toBeGreaterThan(10);
      expect(ctx.summary).toContain("Project");
    });

    it("returns empty message when no context exists", () => {
      const fresh = new ContextCoordinator();
      const t = task("anything", { prompt: "Do stuff" });
      const ctx = fresh.getContextForTask(t);
      expect(ctx.entries).toHaveLength(0);
      expect(ctx.summary).toContain("No prior context");
    });

    it("excludes superseded entries", () => {
      // Update the framework entry
      coordinator.addEntry("project", "framework", "Remix instead of Next.js", "user");

      const t = task("x", { prompt: "Build a page component" });
      const ctx = coordinator.getContextForTask(t);

      const frameworks = ctx.entries.filter((e) => e.key === "framework");
      expect(frameworks).toHaveLength(1);
      expect(frameworks[0]!.value).toBe("Remix instead of Next.js");
    });

    it("context subset includes the taskId", () => {
      const t = task("my-task", { prompt: "Do something with components" });
      const ctx = coordinator.getContextForTask(t);
      expect(ctx.taskId).toBe("my-task");
    });
  });

  // -------------------------------------------------------------------------
  // Updating from agent output
  // -------------------------------------------------------------------------

  describe("updateFromAgentOutput", () => {
    it("adds explicit declarations to the store", () => {
      const output: AgentOutput = {
        taskId: "setup-db",
        agent: "claude",
        output: "Database setup complete.",
        declarations: [
          { domain: "database", key: "db-engine", value: "PostgreSQL 16" },
          { domain: "database", key: "orm-version", value: "Prisma 5.10" },
        ],
      };

      coordinator.updateFromAgentOutput(output);

      const entries = coordinator.getCurrentEntries();
      expect(entries.some((e) => e.key === "db-engine")).toBe(true);
      expect(entries.some((e) => e.key === "orm-version")).toBe(true);
    });

    it("extracts model names from agent output", () => {
      const output: AgentOutput = {
        taskId: "setup-db",
        agent: "claude",
        output: "Created Prisma models:\n  model User { ... }\n  model Product { ... }",
      };

      coordinator.updateFromAgentOutput(output);

      const entries = coordinator.getCurrentEntries();
      expect(entries.some((e) => e.key === "model-user")).toBe(true);
      expect(entries.some((e) => e.key === "model-product")).toBe(true);
    });

    it("extracts API endpoints from agent output", () => {
      const output: AgentOutput = {
        taskId: "build-api",
        agent: "claude",
        output: "Created endpoints:\n  GET /api/users\n  POST /api/users\n  DELETE /api/users/:id",
      };

      coordinator.updateFromAgentOutput(output);

      const entries = coordinator.getEntriesForDomain("api");
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    it("extracts component names from agent output", () => {
      const output: AgentOutput = {
        taskId: "build-ui",
        agent: "copilot",
        output: "export default function ProductCard({ product }) { ... }",
      };

      coordinator.updateFromAgentOutput(output);

      const entries = coordinator.getEntriesForDomain("frontend");
      expect(entries.some((e) => e.key.includes("productcard"))).toBe(true);
    });

    it("extracts env variables from agent output", () => {
      const output: AgentOutput = {
        taskId: "config",
        agent: "codex",
        output: "Used process.env.DATABASE_URL and process.env.NEXTAUTH_SECRET",
      };

      coordinator.updateFromAgentOutput(output);

      const entries = coordinator.getEntriesForDomain("devops");
      expect(entries.some((e) => e.key.includes("database_url"))).toBe(true);
      expect(entries.some((e) => e.key.includes("nextauth_secret"))).toBe(true);
    });

    it("deduplicates extracted entries within a single output", () => {
      const output: AgentOutput = {
        taskId: "x",
        agent: "claude",
        output: "model User { ... }\nUpdated the model User again",
      };

      coordinator.updateFromAgentOutput(output);

      const userEntries = coordinator
        .getCurrentEntries()
        .filter((e) => e.key === "model-user");
      expect(userEntries).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Provenance tracking
  // -------------------------------------------------------------------------

  describe("provenance", () => {
    it("tracks which agent contributed each entry", () => {
      coordinator.addEntry("database", "schema", "Users table", "claude");
      coordinator.addEntry("frontend", "component", "Button", "copilot");

      const entries = coordinator.getCurrentEntries();
      const dbEntry = entries.find((e) => e.key === "schema");
      const feEntry = entries.find((e) => e.key === "component");

      expect(dbEntry!.source).toBe("claude");
      expect(feEntry!.source).toBe("copilot");
    });

    it("tracks taskId for task-produced entries", () => {
      const output: AgentOutput = {
        taskId: "setup-db",
        agent: "claude",
        output: "",
        declarations: [{ domain: "database", key: "schema", value: "Users" }],
      };
      coordinator.updateFromAgentOutput(output);

      const entry = coordinator.getEntry("schema");
      expect(entry!.taskId).toBe("setup-db");
    });

    it("sets taskId to null for manual entries", () => {
      coordinator.addEntry("project", "framework", "Next.js", "user");
      const entry = coordinator.getEntry("framework");
      expect(entry!.taskId).toBeNull();
    });

    it("timestamps entries on creation", () => {
      coordinator.addEntry("project", "test-key", "test-value", "system");
      const entry = coordinator.getEntry("test-key");
      expect(entry!.createdAt).toBeTruthy();
      expect(entry!.updatedAt).toBeTruthy();
    });

    it("supersedes old entries when key is updated", () => {
      coordinator.addEntry("project", "framework", "Next.js", "system");
      coordinator.addEntry("project", "framework", "Remix", "user");

      const current = coordinator.getEntry("framework");
      expect(current!.value).toBe("Remix");
      expect(current!.version).toBe(2);

      // Old entry should be marked superseded
      const store = coordinator.exportStore();
      const oldEntry = store.entries.find(
        (e) => e.key === "framework" && e.superseded
      );
      expect(oldEntry).toBeDefined();
      expect(oldEntry!.supersededBy).toBe(current!.id);
    });

    it("increments version on each update", () => {
      coordinator.addEntry("project", "framework", "v1", "system");
      coordinator.addEntry("project", "framework", "v2", "system");
      coordinator.addEntry("project", "framework", "v3", "system");

      const entry = coordinator.getEntry("framework");
      expect(entry!.version).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Snapshots and diffs
  // -------------------------------------------------------------------------

  describe("snapshots and diffs", () => {
    it("creates a snapshot of current entries", () => {
      coordinator.addEntry("project", "framework", "Next.js", "system");
      coordinator.addEntry("database", "orm", "Prisma", "system");

      const snap = coordinator.createSnapshot("initial");
      expect(snap.label).toBe("initial");
      expect(snap.entryIds).toHaveLength(2);
    });

    it("computes diff between snapshots — added entries", () => {
      coordinator.addEntry("project", "framework", "Next.js", "system");
      const snap1 = coordinator.createSnapshot("before");

      coordinator.addEntry("database", "orm", "Prisma", "system");
      const snap2 = coordinator.createSnapshot("after");

      const diff = coordinator.getContextDiff(snap1.id, snap2.id);
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0]!.key).toBe("orm");
    });

    it("computes diff between snapshots — updated entries", () => {
      coordinator.addEntry("project", "framework", "Next.js", "system");
      const snap1 = coordinator.createSnapshot("before");

      coordinator.addEntry("project", "framework", "Remix", "user");
      const snap2 = coordinator.createSnapshot("after");

      const diff = coordinator.getContextDiff(snap1.id, snap2.id);
      expect(diff.updated).toHaveLength(1);
      expect(diff.updated[0]!.key).toBe("framework");
      expect(diff.updated[0]!.value).toBe("Remix");
    });

    it("computes diff — superseded entries", () => {
      coordinator.addEntry("project", "framework", "Next.js", "system");
      const snap1 = coordinator.createSnapshot("before");

      coordinator.addEntry("project", "framework", "Remix", "user");
      coordinator.createSnapshot("after");

      const diff = coordinator.getContextDiff(snap1.id, snap1.id);
      // The entry from snap1 has been superseded
      const store = coordinator.exportStore();
      const supersededEntry = store.entries.find(
        (e) => e.key === "framework" && e.superseded
      );
      expect(supersededEntry).toBeDefined();
    });

    it("throws for unknown snapshot IDs", () => {
      expect(() => coordinator.getContextDiff("bad", "worse")).toThrow(
        /Snapshot not found/
      );
    });
  });

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  describe("persistence", () => {
    it("saves and loads through persistence interface", async () => {
      let stored: ContextStore | null = null;
      const persistence: IContextPersistence = {
        load: vi.fn(async () => stored),
        save: vi.fn(async (store: ContextStore) => {
          stored = store;
        }),
      };

      const coord1 = new ContextCoordinator(persistence);
      coord1.addEntry("project", "framework", "Next.js", "system");
      coord1.addEntry("database", "orm", "Prisma", "system");
      await coord1.save();

      expect(persistence.save).toHaveBeenCalledTimes(1);

      // Load into a new coordinator
      const coord2 = new ContextCoordinator(persistence);
      await coord2.load();

      expect(persistence.load).toHaveBeenCalledTimes(1);
      const entries = coord2.getCurrentEntries();
      expect(entries).toHaveLength(2);
      expect(entries.some((e) => e.key === "framework")).toBe(true);
    });

    it("handles null from persistence (first run)", async () => {
      const persistence: IContextPersistence = {
        load: vi.fn(async () => null),
        save: vi.fn(async () => {}),
      };

      const coord = new ContextCoordinator(persistence);
      await coord.load();
      expect(coord.getCurrentEntries()).toHaveLength(0);
    });

    it("no-ops when no persistence configured", async () => {
      const coord = new ContextCoordinator();
      await coord.load(); // should not throw
      await coord.save(); // should not throw
    });
  });

  // -------------------------------------------------------------------------
  // Store import/export
  // -------------------------------------------------------------------------

  describe("import/export", () => {
    it("exports full store with entries and snapshots", () => {
      coordinator.addEntry("project", "a", "1", "system");
      coordinator.createSnapshot("snap1");

      const store = coordinator.exportStore();
      expect(store.version).toBe(1);
      expect(store.entries).toHaveLength(1);
      expect(store.snapshots).toHaveLength(1);
    });

    it("imports store and restores state", () => {
      coordinator.addEntry("project", "a", "1", "system");
      const store = coordinator.exportStore();

      const fresh = new ContextCoordinator();
      fresh.importStore(store);
      expect(fresh.getCurrentEntries()).toHaveLength(1);
      expect(fresh.getEntry("a")!.value).toBe("1");
    });
  });

  // -------------------------------------------------------------------------
  // Summary generation
  // -------------------------------------------------------------------------

  describe("summary generation", () => {
    beforeEach(seedProjectContext);

    it("groups entries by domain in summary", () => {
      const t = task("x", {
        prompt: "Build a component for the UI page layout",
      });
      const ctx = coordinator.getContextForTask(t);

      expect(ctx.summary).toContain("## Project");
      expect(ctx.summary).toContain("## Frontend");
    });

    it("truncates long values in summary", () => {
      coordinator.addEntry("project", "long-val", "x".repeat(200), "system");
      const t = task("x", { prompt: "Review the project architecture design" });
      const ctx = coordinator.getContextForTask(t);
      // 200 chars should be truncated to ~120 + ...
      expect(ctx.summary).toContain("...");
    });
  });

  // -------------------------------------------------------------------------
  // Real-world scenario examples
  // -------------------------------------------------------------------------

  describe("real-world scenarios", () => {
    it("e-commerce: auth task sees auth+api+db, not frontend/payment", () => {
      seedProjectContext();

      const t = task("setup-auth", {
        prompt: "Implement NextAuth authentication with Google OAuth provider and JWT sessions",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.domains);
      expect(domains).toContain("auth");
      expect(domains).toContain("api");
      expect(domains).toContain("database");
      expect(domains).not.toContain("payment");
    });

    it("e-commerce: checkout task sees payment+api+auth+frontend", () => {
      seedProjectContext();

      const t = task("build-checkout", {
        prompt: "Build the Stripe checkout page with payment form and auth protection",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.domains);
      expect(domains).toContain("payment");
      expect(domains).toContain("api");
      expect(domains).toContain("auth");
      expect(domains).toContain("frontend");
    });

    it("context accumulates across multiple agent outputs", () => {
      // Claude designs the schema
      coordinator.updateFromAgentOutput({
        taskId: "design-db",
        agent: "claude",
        output: "Designed the database:\n  model User { id, email, role }\n  model Order { id, userId, total }",
        declarations: [
          { domain: "database", key: "db-engine", value: "PostgreSQL" },
        ],
      });

      // Copilot builds the UI
      coordinator.updateFromAgentOutput({
        taskId: "build-ui",
        agent: "copilot",
        output: "Created components:\n  export default function UserProfile() { ... }\n  export default function OrderList() { ... }",
      });

      // Codex writes API endpoints
      coordinator.updateFromAgentOutput({
        taskId: "build-api",
        agent: "codex",
        output: "Created API routes:\n  GET /api/users\n  POST /api/orders\n  GET /api/orders/:id",
      });

      const entries = coordinator.getCurrentEntries();

      // Should have entries from all three agents
      const agents = new Set(entries.map((e) => e.source));
      expect(agents).toContain("claude");
      expect(agents).toContain("copilot");
      expect(agents).toContain("codex");

      // Should have entries across multiple domains
      const domains = new Set(entries.map((e) => e.domain));
      expect(domains).toContain("database");
      expect(domains).toContain("frontend");
      expect(domains).toContain("api");

      // Now a test task should see all of this context
      const testTask = task("write-tests", {
        prompt: "Write integration tests for the user and order modules",
      });
      const ctx = coordinator.getContextForTask(testTask);
      expect(ctx.entries.length).toBeGreaterThanOrEqual(5);
    });

    it("design decision supersedes earlier one", () => {
      coordinator.addEntry("design", "routing", "Pages Router", "claude");

      // Later, architecture changes
      coordinator.updateFromAgentOutput({
        taskId: "refactor",
        agent: "claude",
        output: "Migrated to App Router",
        declarations: [
          { domain: "design", key: "routing", value: "App Router with RSC" },
        ],
      });

      const entry = coordinator.getEntry("routing");
      expect(entry!.value).toBe("App Router with RSC");
      expect(entry!.version).toBe(2);
      expect(entry!.source).toBe("claude");
    });

    it("CI/CD task only gets project + devops context", () => {
      seedProjectContext();

      const t = task("setup-ci", {
        prompt: "Configure GitHub Actions CI pipeline for deployment",
      });
      const ctx = coordinator.getContextForTask(t);

      const domains = new Set(ctx.domains);
      expect(domains).toContain("project");
      expect(domains).toContain("devops");
      // Should NOT include database schema, frontend components, etc.
      expect(domains).not.toContain("database");
      expect(domains).not.toContain("frontend");
      expect(domains).not.toContain("payment");
    });
  });
});
