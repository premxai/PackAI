import { describe, it, expect, beforeEach } from "vitest";
import { ConflictResolver } from "./conflictResolver";
import type {
  OutputConflict,
  APIContractConflict,
  DuplicateWorkConflict,
  FileMergeConflict,
  ContradictoryImplConflict,
  Resolution,
} from "./conflictResolver";
import type { AgentOutput } from "./contextCoordinator";
import type { AgentRole } from "../intelligence/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let resolver: ConflictResolver;

beforeEach(() => {
  resolver = new ConflictResolver();
});

function output(
  taskId: string,
  agent: AgentRole,
  text: string,
  declarations?: AgentOutput["declarations"]
): AgentOutput {
  return { taskId, agent, output: text, declarations };
}

function findByType<T extends OutputConflict>(
  conflicts: OutputConflict[],
  type: T["type"]
): T[] {
  return conflicts.filter((c) => c.type === type) as T[];
}

// ===========================================================================
// Tests
// ===========================================================================

describe("ConflictResolver", () => {
  // -------------------------------------------------------------------------
  // detectConflicts — empty / no-conflict cases
  // -------------------------------------------------------------------------

  describe("detectConflicts — empty / no-conflict cases", () => {
    it("returns empty array for empty inputs", () => {
      expect(resolver.detectConflicts([])).toEqual([]);
    });

    it("returns empty array for single output", () => {
      const out = output("task-1", "claude", "GET /api/users returns user list");
      expect(resolver.detectConflicts([out])).toEqual([]);
    });

    it("returns empty array when two outputs share no endpoints, names, or files", () => {
      const a = output("task-1", "claude", "Designed the database schema for orders");
      const b = output("task-2", "copilot", "Created CSS styles for the landing page");
      expect(resolver.detectConflicts([a, b])).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // detectConflicts — api-contract
  // -------------------------------------------------------------------------

  describe("detectConflicts — api-contract", () => {
    it("detects mismatch when two agents define the same endpoint with different schemas", () => {
      const backend = output(
        "build-api",
        "claude",
        'GET /api/users returns { data: User[], total: number, page: number }'
      );
      const frontend = output(
        "build-ui",
        "copilot",
        'GET /api/users returns { users: User[] }'
      );

      const conflicts = findByType<APIContractConflict>(
        resolver.detectConflicts([backend, frontend]),
        "api-contract"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.endpoint).toBe("GET /api/users");
      expect(conflicts[0]!.agents).toEqual(["claude", "copilot"]);
    });

    it("does NOT flag when two agents define the same endpoint with the same schema", () => {
      const a = output(
        "task-a",
        "claude",
        "GET /api/products returns { items: Product[] }"
      );
      const b = output(
        "task-b",
        "copilot",
        "GET /api/products returns { items: Product[] }"
      );

      const conflicts = findByType<APIContractConflict>(
        resolver.detectConflicts([a, b]),
        "api-contract"
      );

      expect(conflicts.length).toBe(0);
    });

    it("does NOT flag when two agents define different endpoints", () => {
      const a = output("task-a", "claude", "GET /api/users returns user list");
      const b = output("task-b", "copilot", "POST /api/orders creates a new order");

      const conflicts = findByType<APIContractConflict>(
        resolver.detectConflicts([a, b]),
        "api-contract"
      );

      expect(conflicts.length).toBe(0);
    });

    it("sets severity to 'high' for /api/auth endpoints", () => {
      const a = output(
        "task-a",
        "claude",
        'POST /api/auth/login returns { token: string, user: User }'
      );
      const b = output(
        "task-b",
        "codex",
        'POST /api/auth/login returns { accessToken: string, refreshToken: string }'
      );

      const conflicts = findByType<APIContractConflict>(
        resolver.detectConflicts([a, b]),
        "api-contract"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.severity).toBe("high");
    });

    it("sets severity to 'medium' for /api/products endpoints", () => {
      const a = output(
        "task-a",
        "claude",
        'GET /api/products returns { items: Product[], count: number }'
      );
      const b = output(
        "task-b",
        "copilot",
        'GET /api/products returns { products: Product[] }'
      );

      const conflicts = findByType<APIContractConflict>(
        resolver.detectConflicts([a, b]),
        "api-contract"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.severity).toBe("medium");
    });

    it("includes schemaA and schemaB fields with surrounding text", () => {
      const a = output(
        "task-a",
        "claude",
        'GET /api/users -> { data: User[] }'
      );
      const b = output(
        "task-b",
        "copilot",
        'GET /api/users -> { users: User[], total: number }'
      );

      const conflicts = findByType<APIContractConflict>(
        resolver.detectConflicts([a, b]),
        "api-contract"
      );

      expect(conflicts[0]!.schemaA).toContain("data: User[]");
      expect(conflicts[0]!.schemaB).toContain("users: User[]");
    });
  });

  // -------------------------------------------------------------------------
  // detectConflicts — duplicate-work
  // -------------------------------------------------------------------------

  describe("detectConflicts — duplicate-work", () => {
    it("detects two agents exporting a PascalCase component with the same name", () => {
      const a = output(
        "task-ui-a",
        "copilot",
        "export default function ProductCard() { return <div>...</div> }"
      );
      const b = output(
        "task-ui-b",
        "claude",
        "export function ProductCard({ product }: Props) { return <Card>...</Card> }"
      );

      const conflicts = findByType<DuplicateWorkConflict>(
        resolver.detectConflicts([a, b]),
        "duplicate-work"
      );

      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      const pcConflict = conflicts.find((c) => c.componentName === "ProductCard");
      expect(pcConflict).toBeDefined();
      expect(pcConflict!.duplicateKind).toBe("component");
    });

    it("detects two agents declaring the same database model", () => {
      const a = output(
        "task-schema-a",
        "claude",
        "model User {\n  id Int @id\n  email String @unique\n}"
      );
      const b = output(
        "task-schema-b",
        "codex",
        "model User {\n  id Int @id\n  name String\n  email String\n}"
      );

      const conflicts = findByType<DuplicateWorkConflict>(
        resolver.detectConflicts([a, b]),
        "duplicate-work"
      );

      const modelConflict = conflicts.find((c) => c.componentName === "User");
      expect(modelConflict).toBeDefined();
      expect(modelConflict!.duplicateKind).toBe("model");
    });

    it("does NOT flag when same-named component is in only one output", () => {
      const a = output(
        "task-a",
        "copilot",
        "export function ProductCard() { ... }"
      );
      const b = output(
        "task-b",
        "claude",
        "Reviewed the database schema and approved it."
      );

      const conflicts = findByType<DuplicateWorkConflict>(
        resolver.detectConflicts([a, b]),
        "duplicate-work"
      );

      const pcConflict = conflicts.find((c) => c.componentName === "ProductCard");
      expect(pcConflict).toBeUndefined();
    });

    it("classifies PascalCase export as 'component' duplicateKind", () => {
      const a = output("t1", "copilot", "export function NavBar() { ... }");
      const b = output("t2", "claude", "export const NavBar = () => { ... }");

      const conflicts = findByType<DuplicateWorkConflict>(
        resolver.detectConflicts([a, b]),
        "duplicate-work"
      );

      const c = conflicts.find((c) => c.componentName === "NavBar");
      expect(c).toBeDefined();
      expect(c!.duplicateKind).toBe("component");
    });

    it("classifies model/table match as 'model' duplicateKind", () => {
      const a = output("t1", "claude", "table Order { id, userId, total }");
      const b = output("t2", "codex", "table Order { id, user_id, amount }");

      const conflicts = findByType<DuplicateWorkConflict>(
        resolver.detectConflicts([a, b]),
        "duplicate-work"
      );

      const c = conflicts.find((c) => c.componentName === "Order");
      expect(c).toBeDefined();
      expect(c!.duplicateKind).toBe("model");
    });

    it("classifies endpoint duplicate as 'endpoint' duplicateKind", () => {
      const a = output("t1", "claude", "POST /api/orders creates order");
      const b = output("t2", "codex", "POST /api/orders validates and stores order");

      const conflicts = resolver.detectConflicts([a, b]);
      // Should have at least an API contract conflict or endpoint duplicate
      const dupEndpoint = findByType<DuplicateWorkConflict>(
        conflicts,
        "duplicate-work"
      ).find((c) => c.duplicateKind === "endpoint");
      expect(dupEndpoint).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // detectConflicts — file-merge
  // -------------------------------------------------------------------------

  describe("detectConflicts — file-merge", () => {
    it("detects two outputs mentioning the same file path with different code fences", () => {
      const a = output(
        "task-a",
        "claude",
        'Created src/lib/auth.ts:\n```typescript\nexport function login() { return jwt.sign(user) }\n```'
      );
      const b = output(
        "task-b",
        "copilot",
        'Updated src/lib/auth.ts:\n```typescript\nexport async function login() { return await session.create(user) }\n```'
      );

      const conflicts = findByType<FileMergeConflict>(
        resolver.detectConflicts([a, b]),
        "file-merge"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.filePath).toBe("src/lib/auth.ts");
    });

    it("includes mergeMarkers with standard git conflict format", () => {
      const a = output(
        "task-a",
        "claude",
        'Created src/utils/helpers.ts:\n```ts\nexport const add = (a: number, b: number) => a + b;\n```'
      );
      const b = output(
        "task-b",
        "copilot",
        'Updated src/utils/helpers.ts:\n```ts\nexport function add(a: number, b: number): number { return a + b; }\n```'
      );

      const conflicts = findByType<FileMergeConflict>(
        resolver.detectConflicts([a, b]),
        "file-merge"
      );

      expect(conflicts[0]!.mergeMarkers).toContain("<<<<<<< claude (task-a)");
      expect(conflicts[0]!.mergeMarkers).toContain("=======");
      expect(conflicts[0]!.mergeMarkers).toContain(">>>>>>> copilot (task-b)");
    });

    it("sets severity to 'high' for package.json conflicts", () => {
      const a = output(
        "task-a",
        "claude",
        'Updated package.json:\n```json\n{ "dependencies": { "next": "14.0.0" } }\n```'
      );
      const b = output(
        "task-b",
        "copilot",
        'Modified package.json:\n```json\n{ "dependencies": { "next": "13.5.0", "react": "18.2.0" } }\n```'
      );

      const conflicts = findByType<FileMergeConflict>(
        resolver.detectConflicts([a, b]),
        "file-merge"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.severity).toBe("high");
    });

    it("sets severity to 'medium' for component file conflicts", () => {
      const a = output(
        "task-a",
        "claude",
        'Created src/components/Header.tsx:\n```tsx\nexport function Header() { return <h1>App</h1> }\n```'
      );
      const b = output(
        "task-b",
        "copilot",
        'Updated src/components/Header.tsx:\n```tsx\nexport function Header() { return <header><h1>App</h1></header> }\n```'
      );

      const conflicts = findByType<FileMergeConflict>(
        resolver.detectConflicts([a, b]),
        "file-merge"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.severity).toBe("medium");
    });

    it("does NOT flag when both code fences have identical content", () => {
      const code = "export const API_URL = '/api';";
      const a = output(
        "task-a",
        "claude",
        `Created src/lib/config.ts:\n\`\`\`ts\n${code}\n\`\`\``
      );
      const b = output(
        "task-b",
        "copilot",
        `Updated src/lib/config.ts:\n\`\`\`ts\n${code}\n\`\`\``
      );

      const conflicts = findByType<FileMergeConflict>(
        resolver.detectConflicts([a, b]),
        "file-merge"
      );

      expect(conflicts.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // detectConflicts — contradictory-impl
  // -------------------------------------------------------------------------

  describe("detectConflicts — contradictory-impl", () => {
    it("detects contradictory explicit declarations for the same domain:key", () => {
      const a = output("task-a", "claude", "Setup auth", [
        { domain: "auth", key: "auth-provider", value: "NextAuth with Google OAuth" },
      ]);
      const b = output("task-b", "codex", "Setup auth", [
        { domain: "auth", key: "auth-provider", value: "Clerk" },
      ]);

      const conflicts = findByType<ContradictoryImplConflict>(
        resolver.detectConflicts([a, b]),
        "contradictory-impl"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.topic).toBe("auth:auth-provider");
      expect(conflicts[0]!.statementA).toBe("NextAuth with Google OAuth");
      expect(conflicts[0]!.statementB).toBe("Clerk");
    });

    it("does NOT flag when both agents declare the same value for the same key", () => {
      const a = output("task-a", "claude", "Setup database", [
        { domain: "database", key: "orm", value: "Prisma" },
      ]);
      const b = output("task-b", "codex", "Setup database", [
        { domain: "database", key: "orm", value: "Prisma" },
      ]);

      const conflicts = findByType<ContradictoryImplConflict>(
        resolver.detectConflicts([a, b]),
        "contradictory-impl"
      );

      expect(conflicts.length).toBe(0);
    });

    it("is case-insensitive when comparing declaration values", () => {
      const a = output("task-a", "claude", "Setup", [
        { domain: "database", key: "orm", value: "prisma" },
      ]);
      const b = output("task-b", "codex", "Setup", [
        { domain: "database", key: "orm", value: "Prisma" },
      ]);

      const conflicts = findByType<ContradictoryImplConflict>(
        resolver.detectConflicts([a, b]),
        "contradictory-impl"
      );

      expect(conflicts.length).toBe(0);
    });

    it("sets severity to 'high' for auth domain contradictions", () => {
      const a = output("task-a", "claude", "Auth setup", [
        { domain: "auth", key: "session-strategy", value: "JWT tokens" },
      ]);
      const b = output("task-b", "copilot", "Auth setup", [
        { domain: "auth", key: "session-strategy", value: "Server-side sessions" },
      ]);

      const conflicts = findByType<ContradictoryImplConflict>(
        resolver.detectConflicts([a, b]),
        "contradictory-impl"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.severity).toBe("high");
    });

    it("sets severity to 'low' for general domain contradictions", () => {
      const a = output("task-a", "claude", "Project setup", [
        { domain: "general", key: "package-manager", value: "npm" },
      ]);
      const b = output("task-b", "copilot", "Project setup", [
        { domain: "general", key: "package-manager", value: "pnpm" },
      ]);

      const conflicts = findByType<ContradictoryImplConflict>(
        resolver.detectConflicts([a, b]),
        "contradictory-impl"
      );

      expect(conflicts.length).toBe(1);
      expect(conflicts[0]!.severity).toBe("low");
    });
  });

  // -------------------------------------------------------------------------
  // autoResolve
  // -------------------------------------------------------------------------

  describe("autoResolve", () => {
    it("returns null for api-contract conflicts", () => {
      const conflict: APIContractConflict = {
        id: "oc-1",
        type: "api-contract",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        endpoint: "GET /api/users",
        schemaA: "{ data: User[] }",
        schemaB: "{ users: User[] }",
        description: "API mismatch",
        severity: "high",
        detectedAt: new Date().toISOString(),
      };

      expect(resolver.autoResolve(conflict)).toBeNull();
    });

    it("returns null for file-merge conflicts", () => {
      const conflict: FileMergeConflict = {
        id: "oc-2",
        type: "file-merge",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        filePath: "src/lib/auth.ts",
        contentA: "code A",
        contentB: "code B",
        mergeMarkers: "<<<<<<< ...",
        description: "File conflict",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      expect(resolver.autoResolve(conflict)).toBeNull();
    });

    it("resolves duplicate-work by picking claude over copilot", () => {
      const conflict: DuplicateWorkConflict = {
        id: "oc-3",
        type: "duplicate-work",
        taskIds: ["task-copilot", "task-claude"],
        agents: ["copilot", "claude"],
        componentName: "ProductCard",
        duplicateKind: "component",
        description: "Duplicate component",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const resolution = resolver.autoResolve(conflict);
      expect(resolution).not.toBeNull();
      expect(resolution!.strategy).toBe("use-b");
      expect(resolution!.winningTaskId).toBe("task-claude");
    });

    it("resolves duplicate-work by picking newer task when same agent", () => {
      const conflict: DuplicateWorkConflict = {
        id: "oc-4",
        type: "duplicate-work",
        taskIds: ["task-old", "task-new"],
        agents: ["copilot", "copilot"],
        componentName: "NavBar",
        duplicateKind: "component",
        description: "Duplicate component",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const resolution = resolver.autoResolve(conflict);
      expect(resolution).not.toBeNull();
      expect(resolution!.strategy).toBe("use-b");
      expect(resolution!.winningTaskId).toBe("task-new");
    });

    it("resolves low-severity contradictory-impl as flag-for-review", () => {
      const conflict: ContradictoryImplConflict = {
        id: "oc-5",
        type: "contradictory-impl",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        topic: "general:package-manager",
        statementA: "npm",
        statementB: "pnpm",
        description: "Contradictory choice",
        severity: "low",
        detectedAt: new Date().toISOString(),
      };

      const resolution = resolver.autoResolve(conflict);
      expect(resolution).not.toBeNull();
      expect(resolution!.strategy).toBe("flag-for-review");
    });

    it("returns null for high-severity contradictory-impl", () => {
      const conflict: ContradictoryImplConflict = {
        id: "oc-6",
        type: "contradictory-impl",
        taskIds: ["t1", "t2"],
        agents: ["claude", "codex"],
        topic: "auth:provider",
        statementA: "NextAuth",
        statementB: "Clerk",
        description: "Contradictory auth",
        severity: "high",
        detectedAt: new Date().toISOString(),
      };

      expect(resolver.autoResolve(conflict)).toBeNull();
    });

    it("returned resolution has resolvedBy: 'auto' and correct conflictId", () => {
      const conflict: DuplicateWorkConflict = {
        id: "oc-7",
        type: "duplicate-work",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        componentName: "Footer",
        duplicateKind: "component",
        description: "Duplicate",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const resolution = resolver.autoResolve(conflict)!;
      expect(resolution.resolvedBy).toBe("auto");
      expect(resolution.conflictId).toBe("oc-7");
    });
  });

  // -------------------------------------------------------------------------
  // getUserResolutionOptions
  // -------------------------------------------------------------------------

  describe("getUserResolutionOptions", () => {
    it("returns 3 options for api-contract conflict including use-a, use-b, flag-for-review", () => {
      const conflict: APIContractConflict = {
        id: "oc-1",
        type: "api-contract",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        endpoint: "GET /api/users",
        schemaA: "{ data: User[] }",
        schemaB: "{ users: User[] }",
        description: "mismatch",
        severity: "high",
        detectedAt: new Date().toISOString(),
      };

      const options = resolver.getUserResolutionOptions(conflict);
      expect(options).toHaveLength(3);

      const strategies = options.map((o) => o.strategy);
      expect(strategies).toContain("use-a");
      expect(strategies).toContain("use-b");
      expect(strategies).toContain("flag-for-review");
    });

    it("returns 3 options for duplicate-work conflict including pause-agent option", () => {
      const conflict: DuplicateWorkConflict = {
        id: "oc-2",
        type: "duplicate-work",
        taskIds: ["t1", "t2"],
        agents: ["copilot", "claude"],
        componentName: "ProductCard",
        duplicateKind: "component",
        description: "Duplicate",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const options = resolver.getUserResolutionOptions(conflict);
      expect(options).toHaveLength(3);

      const pauseOption = options.find((o) => o.strategy === "pause-agent");
      expect(pauseOption).toBeDefined();
      expect(pauseOption!.pausedAgent).toBe("claude");
    });

    it("returns 3 options for file-merge conflict including merge with mergeMarkers content", () => {
      const conflict: FileMergeConflict = {
        id: "oc-3",
        type: "file-merge",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        filePath: "src/lib/auth.ts",
        contentA: "code A",
        contentB: "code B",
        mergeMarkers: "<<<<<<< claude\ncode A\n=======\ncode B\n>>>>>>> copilot",
        description: "File conflict",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const options = resolver.getUserResolutionOptions(conflict);
      expect(options).toHaveLength(3);

      const mergeOption = options.find((o) => o.strategy === "merge");
      expect(mergeOption).toBeDefined();
      expect(mergeOption!.mergedContent).toContain("<<<<<<<");
    });

    it("returns 3 options for contradictory-impl conflict", () => {
      const conflict: ContradictoryImplConflict = {
        id: "oc-4",
        type: "contradictory-impl",
        taskIds: ["t1", "t2"],
        agents: ["claude", "codex"],
        topic: "auth:provider",
        statementA: "NextAuth",
        statementB: "Clerk",
        description: "Contradictory",
        severity: "high",
        detectedAt: new Date().toISOString(),
      };

      const options = resolver.getUserResolutionOptions(conflict);
      expect(options).toHaveLength(3);
      expect(options.map((o) => o.strategy)).toEqual(
        expect.arrayContaining(["use-a", "use-b", "flag-for-review"])
      );
    });

    it("labels include human-readable agent names and component names", () => {
      const conflict: DuplicateWorkConflict = {
        id: "oc-5",
        type: "duplicate-work",
        taskIds: ["t1", "t2"],
        agents: ["copilot", "claude"],
        componentName: "UserProfile",
        duplicateKind: "component",
        description: "Duplicate",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const options = resolver.getUserResolutionOptions(conflict);
      expect(options[0]!.label).toContain("copilot");
      expect(options[0]!.label).toContain("UserProfile");
      expect(options[1]!.label).toContain("claude");
      expect(options[1]!.label).toContain("UserProfile");
    });
  });

  // -------------------------------------------------------------------------
  // applyResolution + history
  // -------------------------------------------------------------------------

  describe("applyResolution + history", () => {
    const sampleConflict: DuplicateWorkConflict = {
      id: "oc-1",
      type: "duplicate-work",
      taskIds: ["t1", "t2"],
      agents: ["copilot", "claude"],
      componentName: "ProductCard",
      duplicateKind: "component",
      description: "Duplicate",
      severity: "medium",
      detectedAt: new Date().toISOString(),
    };

    const sampleResolution: Resolution = {
      conflictId: "oc-1",
      strategy: "use-b",
      resolvedBy: "user",
      notes: "User chose claude's implementation",
      appliedAt: new Date().toISOString(),
      winningTaskId: "t2",
    };

    it("getHistory returns empty array initially", () => {
      expect(resolver.getHistory()).toEqual([]);
    });

    it("adds resolution to history", () => {
      resolver.applyResolution(sampleConflict, sampleResolution);
      expect(resolver.getHistory()).toHaveLength(1);
    });

    it("getResolutionForConflict returns resolution by conflictId", () => {
      resolver.applyResolution(sampleConflict, sampleResolution);

      const found = resolver.getResolutionForConflict("oc-1");
      expect(found).toBeDefined();
      expect(found!.strategy).toBe("use-b");
      expect(found!.winningTaskId).toBe("t2");
    });

    it("getResolutionForConflict returns undefined for unknown conflictId", () => {
      expect(resolver.getResolutionForConflict("nonexistent")).toBeUndefined();
    });

    it("applying a second resolution for the same conflict overwrites the first", () => {
      resolver.applyResolution(sampleConflict, sampleResolution);

      const updatedResolution: Resolution = {
        ...sampleResolution,
        strategy: "use-a",
        winningTaskId: "t1",
      };
      resolver.applyResolution(sampleConflict, updatedResolution);

      expect(resolver.getHistory()).toHaveLength(1);
      expect(resolver.getResolutionForConflict("oc-1")!.strategy).toBe("use-a");
    });

    it("multiple resolutions for different conflicts accumulate in order", () => {
      const conflict2: APIContractConflict = {
        id: "oc-2",
        type: "api-contract",
        taskIds: ["t3", "t4"],
        agents: ["claude", "codex"],
        endpoint: "GET /api/orders",
        schemaA: "schema A",
        schemaB: "schema B",
        description: "API mismatch",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const resolution2: Resolution = {
        conflictId: "oc-2",
        strategy: "use-a",
        resolvedBy: "user",
        notes: "Chose claude's schema",
        appliedAt: new Date().toISOString(),
        winningTaskId: "t3",
      };

      resolver.applyResolution(sampleConflict, sampleResolution);
      resolver.applyResolution(conflict2, resolution2);

      expect(resolver.getHistory()).toHaveLength(2);
      expect(resolver.getHistory()[0]!.conflict.id).toBe("oc-1");
      expect(resolver.getHistory()[1]!.conflict.id).toBe("oc-2");
    });
  });

  // -------------------------------------------------------------------------
  // buildDiffView
  // -------------------------------------------------------------------------

  describe("buildDiffView", () => {
    it("returns DiffLine array with 'added', 'removed', 'context' kinds", () => {
      const conflict: APIContractConflict = {
        id: "oc-1",
        type: "api-contract",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        endpoint: "GET /api/users",
        schemaA: "{ data: User[] }",
        schemaB: "{ users: User[], total: number }",
        description: "mismatch",
        severity: "high",
        detectedAt: new Date().toISOString(),
      };

      const diff = resolver.buildDiffView(conflict);
      expect(diff.lines.length).toBeGreaterThan(0);

      const kinds = new Set(diff.lines.map((l) => l.kind));
      // Should have at least removed (from A) and added (from B) lines
      expect(kinds.has("removed") || kinds.has("added")).toBe(true);
    });

    it("labelA and labelB include agent role and taskId", () => {
      const conflict: FileMergeConflict = {
        id: "oc-2",
        type: "file-merge",
        taskIds: ["build-api", "build-ui"],
        agents: ["claude", "copilot"],
        filePath: "src/lib/auth.ts",
        contentA: "line A",
        contentB: "line B",
        mergeMarkers: "...",
        description: "File conflict",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const diff = resolver.buildDiffView(conflict);
      expect(diff.labelA).toContain("claude");
      expect(diff.labelA).toContain("build-api");
      expect(diff.labelB).toContain("copilot");
      expect(diff.labelB).toContain("build-ui");
    });

    it("works for api-contract conflict using schemaA/schemaB", () => {
      const conflict: APIContractConflict = {
        id: "oc-3",
        type: "api-contract",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        endpoint: "POST /api/auth",
        schemaA: "returns { token: string }",
        schemaB: "returns { accessToken: string, refreshToken: string }",
        description: "Auth API mismatch",
        severity: "high",
        detectedAt: new Date().toISOString(),
      };

      const diff = resolver.buildDiffView(conflict);
      expect(diff.conflictId).toBe("oc-3");

      // The removed line should reference schema A content
      const removed = diff.lines.filter((l) => l.kind === "removed");
      const added = diff.lines.filter((l) => l.kind === "added");
      expect(removed.length).toBeGreaterThan(0);
      expect(added.length).toBeGreaterThan(0);
    });

    it("works for file-merge conflict using contentA/contentB", () => {
      const conflict: FileMergeConflict = {
        id: "oc-4",
        type: "file-merge",
        taskIds: ["t1", "t2"],
        agents: ["claude", "copilot"],
        filePath: "src/lib/db.ts",
        contentA: "import { PrismaClient } from '@prisma/client'\nconst db = new PrismaClient()",
        contentB: "import { drizzle } from 'drizzle-orm'\nconst db = drizzle()",
        mergeMarkers: "...",
        description: "DB file conflict",
        severity: "medium",
        detectedAt: new Date().toISOString(),
      };

      const diff = resolver.buildDiffView(conflict);
      const allContent = diff.lines.map((l) => l.content).join("\n");
      expect(allContent).toContain("PrismaClient");
      expect(allContent).toContain("drizzle");
    });
  });

  // -------------------------------------------------------------------------
  // Real-world scenarios
  // -------------------------------------------------------------------------

  describe("real-world scenarios", () => {
    it("e-commerce: frontend expects different API response than backend provides", () => {
      const backend = output(
        "build-product-api",
        "claude",
        `Implemented product API:
         GET /api/products returns paginated response:
         { data: Product[], meta: { total: number, page: number, perPage: number } }

         GET /api/products/:id returns single product:
         { data: Product, relatedProducts: Product[] }`
      );

      const frontend = output(
        "build-product-page",
        "copilot",
        `Built product listing page:
         Fetches GET /api/products and expects:
         { products: Product[], totalCount: number }

         Product detail page fetches GET /api/products/:id and expects:
         { product: Product, reviews: Review[] }`
      );

      const conflicts = resolver.detectConflicts([backend, frontend]);

      const apiConflicts = findByType<APIContractConflict>(conflicts, "api-contract");
      // Should detect mismatch for GET /api/products
      expect(apiConflicts.length).toBeGreaterThanOrEqual(1);

      const productsConflict = apiConflicts.find((c) =>
        c.endpoint === "GET /api/products"
      );
      expect(productsConflict).toBeDefined();
      expect(productsConflict!.agents).toEqual(["claude", "copilot"]);
    });

    it("two agents implement the same component with different approaches", () => {
      const claude = output(
        "design-auth",
        "claude",
        `Created authentication flow:
         export function AuthProvider({ children }: Props) {
           return <SessionProvider>{children}</SessionProvider>
         }

         export function LoginForm() {
           return <form onSubmit={handleSubmit}>...</form>
         }`
      );

      const copilot = output(
        "build-auth-ui",
        "copilot",
        `Built authentication UI components:
         export function LoginForm() {
           return <Card><form>...</form></Card>
         }

         export function SignupForm() {
           return <Card><form>...</form></Card>
         }`
      );

      const conflicts = resolver.detectConflicts([claude, copilot]);

      const dupConflicts = findByType<DuplicateWorkConflict>(conflicts, "duplicate-work");
      const loginDup = dupConflicts.find((c) => c.componentName === "LoginForm");
      expect(loginDup).toBeDefined();
      expect(loginDup!.duplicateKind).toBe("component");
    });

    it("conflicting design decisions about authentication provider", () => {
      const claude = output("design-auth", "claude", "Architecture review complete", [
        { domain: "auth", key: "auth-provider", value: "NextAuth with Google OAuth" },
        { domain: "auth", key: "session-strategy", value: "JWT with httpOnly cookies" },
      ]);

      const codex = output("implement-auth", "codex", "Auth implementation complete", [
        { domain: "auth", key: "auth-provider", value: "Clerk" },
        { domain: "auth", key: "session-strategy", value: "Clerk managed sessions" },
      ]);

      const conflicts = resolver.detectConflicts([claude, codex]);

      const contradictions = findByType<ContradictoryImplConflict>(
        conflicts,
        "contradictory-impl"
      );

      // Should detect contradictions on both auth-provider and session-strategy
      expect(contradictions.length).toBe(2);
      expect(contradictions.every((c) => c.severity === "high")).toBe(true);
    });

    it("full pipeline: detect → auto-resolve → get user options for remainder", () => {
      const outputs: AgentOutput[] = [
        output("design", "claude", "Architecture designed", [
          { domain: "general", key: "css-framework", value: "Tailwind CSS" },
        ]),
        output("implement-ui", "copilot", "export function NavBar() { ... }"),
        output("implement-layout", "claude", "export function NavBar() { ... }"),
        output("style-setup", "codex", "Styling configured", [
          { domain: "general", key: "css-framework", value: "styled-components" },
        ]),
      ];

      const conflicts = resolver.detectConflicts(outputs);
      expect(conflicts.length).toBeGreaterThanOrEqual(2);

      let autoResolved = 0;
      let needsUser = 0;

      for (const conflict of conflicts) {
        const resolution = resolver.autoResolve(conflict);
        if (resolution) {
          resolver.applyResolution(conflict, resolution);
          autoResolved++;
        } else {
          const options = resolver.getUserResolutionOptions(conflict);
          expect(options.length).toBe(3);
          needsUser++;
        }
      }

      expect(autoResolved + needsUser).toBe(conflicts.length);
      expect(resolver.getHistory().length).toBe(autoResolved);
    });

    it("file merge conflict with realistic code blocks", () => {
      const claude = output(
        "setup-db",
        "claude",
        `Created the database configuration in src/lib/db.ts:
\`\`\`typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['query', 'error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
\`\`\``
      );

      const codex = output(
        "write-db-tests",
        "codex",
        `Created test database setup in src/lib/db.ts:
\`\`\`typescript
import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export async function resetDb() {
  await prisma.$executeRaw\`TRUNCATE TABLE "User" CASCADE\`
}
\`\`\``
      );

      const conflicts = resolver.detectConflicts([claude, codex]);

      const fileConflicts = findByType<FileMergeConflict>(conflicts, "file-merge");
      expect(fileConflicts.length).toBe(1);
      expect(fileConflicts[0]!.filePath).toBe("src/lib/db.ts");
      expect(fileConflicts[0]!.contentA).toContain("globalForPrisma");
      expect(fileConflicts[0]!.contentB).toContain("resetDb");
      expect(fileConflicts[0]!.mergeMarkers).toContain("=======");
    });
  });
});
