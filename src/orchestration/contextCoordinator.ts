import type { AgentRole, ExecutionTask, Feature } from "../intelligence/types";

// ===========================================================================
// ContextCoordinator
//
// Manages shared context between agents so each agent receives only the
// information relevant to its task — without pollution from unrelated
// domains. Tracks provenance (who contributed what, when) and supports
// persistent serialization to .packai/context.json.
//
// No VS Code dependency — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Categories of context knowledge. */
export type ContextDomain =
  | "project"    // tech stack, conventions, project type
  | "database"   // schema, migrations, ORM config
  | "api"        // endpoints, contracts, middleware
  | "frontend"   // components, pages, styling
  | "auth"       // auth flow, providers, permissions
  | "testing"    // test config, patterns, fixtures
  | "devops"     // CI/CD, Docker, deployment
  | "design"     // architecture decisions, patterns
  | "payment"    // payment flow, providers
  | "general";   // uncategorized

/** A single piece of context knowledge with provenance. */
export interface ContextEntry {
  /** Unique id for this entry. */
  readonly id: string;
  /** What domain this knowledge belongs to. */
  readonly domain: ContextDomain;
  /** Short summary key (e.g. "db-schema", "auth-provider"). */
  readonly key: string;
  /** The actual knowledge content. */
  readonly value: string;
  /** Which agent contributed this. */
  readonly source: AgentRole | "user" | "system";
  /** Task ID that produced this entry (null for user/system entries). */
  readonly taskId: string | null;
  /** ISO timestamp when this entry was created. */
  readonly createdAt: string;
  /** ISO timestamp when this entry was last updated. */
  readonly updatedAt: string;
  /** Whether this entry has been superseded by a newer one. */
  readonly superseded: boolean;
  /** ID of the entry that supersedes this one, if any. */
  readonly supersededBy: string | null;
  /** Version number — increments on updates to the same key. */
  readonly version: number;
}

/** A filtered subset of context for a specific task. */
export interface ContextSubset {
  /** The task this context was prepared for. */
  readonly taskId: string;
  /** Relevant context entries, ordered by domain then recency. */
  readonly entries: readonly ContextEntry[];
  /** Domains included in this subset. */
  readonly domains: readonly ContextDomain[];
  /** Summary text suitable for injecting into a prompt. */
  readonly summary: string;
}

/** A diff between two context snapshots. */
export interface ContextDiff {
  readonly fromSnapshot: string;
  readonly toSnapshot: string;
  readonly added: readonly ContextEntry[];
  readonly updated: readonly ContextEntry[];
  readonly superseded: readonly ContextEntry[];
}

/** Agent output that the coordinator can extract context from. */
export interface AgentOutput {
  readonly taskId: string;
  readonly agent: AgentRole;
  readonly output: string;
  /** Structured data the agent explicitly declared. */
  readonly declarations?: readonly ContextDeclaration[];
}

/** An explicit context declaration from an agent. */
export interface ContextDeclaration {
  readonly domain: ContextDomain;
  readonly key: string;
  readonly value: string;
}

/** The full persistent store shape (.packai/context.json). */
export interface ContextStore {
  readonly version: 1;
  readonly entries: readonly ContextEntry[];
  readonly snapshots: readonly ContextSnapshot[];
}

/** A named snapshot for diff calculation. */
export interface ContextSnapshot {
  readonly id: string;
  readonly label: string;
  readonly timestamp: string;
  readonly entryIds: readonly string[];
}

/** Abstraction over file persistence (for testability). */
export interface IContextPersistence {
  load(): Promise<ContextStore | null>;
  save(store: ContextStore): Promise<void>;
}

// ---------------------------------------------------------------------------
// Domain relevance matrix — which domains each task type needs
// ---------------------------------------------------------------------------

/** Maps task signal keywords to the domains they need access to. */
const DOMAIN_RELEVANCE: ReadonlyMap<string, readonly ContextDomain[]> = new Map([
  // Frontend tasks need project + frontend + design + auth (for protected routes)
  ["component",  ["project", "frontend", "design", "auth"]],
  ["page",       ["project", "frontend", "design", "auth", "api"]],
  ["layout",     ["project", "frontend", "design"]],
  ["style",      ["project", "frontend"]],
  ["ui",         ["project", "frontend", "design"]],
  ["form",       ["project", "frontend", "api"]],

  // API tasks need api + database + auth + design
  ["api",        ["project", "api", "database", "auth", "design"]],
  ["endpoint",   ["project", "api", "database", "auth"]],
  ["route",      ["project", "api", "auth"]],
  ["middleware",  ["project", "api", "auth"]],
  ["controller",  ["project", "api", "database"]],
  ["graphql",    ["project", "api", "database", "auth"]],

  // Database tasks
  ["database",   ["project", "database", "design"]],
  ["schema",     ["project", "database", "design"]],
  ["migration",  ["project", "database"]],
  ["seed",       ["project", "database"]],
  ["prisma",     ["project", "database"]],
  ["orm",        ["project", "database"]],

  // Auth tasks
  ["auth",       ["project", "auth", "api", "database"]],
  ["login",      ["project", "auth", "api", "frontend"]],
  ["permission",  ["project", "auth", "api"]],
  ["oauth",      ["project", "auth", "api"]],
  ["jwt",        ["project", "auth", "api"]],

  // Testing tasks need everything — they validate all components
  ["test",       ["project", "frontend", "api", "database", "auth", "testing", "design"]],
  ["spec",       ["project", "frontend", "api", "database", "auth", "testing"]],
  ["e2e",        ["project", "frontend", "api", "database", "auth", "testing"]],
  ["coverage",   ["project", "testing"]],

  // DevOps
  ["deploy",     ["project", "devops"]],
  ["docker",     ["project", "devops"]],
  ["ci",         ["project", "devops", "testing"]],
  ["config",     ["project", "devops"]],

  // Design/architecture
  ["architect",  ["project", "design", "database", "api", "frontend", "auth"]],
  ["design",     ["project", "design"]],
  ["review",     ["project", "design", "frontend", "api", "database", "auth"]],

  // Payment
  ["payment",    ["project", "payment", "api", "auth"]],
  ["stripe",     ["project", "payment", "api"]],
  ["checkout",   ["project", "payment", "api", "frontend", "auth"]],
]);

/** Feature-to-domain mapping. */
const FEATURE_DOMAINS: ReadonlyMap<Feature, ContextDomain> = new Map([
  ["auth", "auth"],
  ["payments", "payment"],
  ["database", "database"],
  ["api", "api"],
  ["charts", "frontend"],
  ["search", "api"],
  ["forms", "frontend"],
  ["admin", "frontend"],
  ["realtime", "api"],
  ["seo", "frontend"],
  ["analytics", "frontend"],
  ["email", "api"],
  ["notifications", "api"],
  ["i18n", "frontend"],
  ["file-upload", "api"],
  ["cms", "api"],
  ["media", "frontend"],
  ["social", "frontend"],
  ["maps", "frontend"],
]);

// ---------------------------------------------------------------------------
// Heuristic extraction patterns — pull structured context from raw output
// ---------------------------------------------------------------------------

interface ExtractionRule {
  readonly pattern: RegExp;
  readonly domain: ContextDomain;
  readonly keyPrefix: string;
}

const EXTRACTION_RULES: readonly ExtractionRule[] = [
  // Database schema mentions
  { pattern: /(?:model|table|schema)\s+(\w+)/gi, domain: "database", keyPrefix: "model" },
  // API endpoints
  { pattern: /(?:GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/:.-]+)/gi, domain: "api", keyPrefix: "endpoint" },
  // Component names
  { pattern: /(?:component|export\s+(?:default\s+)?function)\s+(\w+)/gi, domain: "frontend", keyPrefix: "component" },
  // Environment variables
  { pattern: /(?:process\.env\.|import\.meta\.env\.)(\w+)/gi, domain: "devops", keyPrefix: "env-var" },
  // Auth provider mentions
  { pattern: /(?:NextAuth|Clerk|Auth0|Supabase Auth|Firebase Auth)/gi, domain: "auth", keyPrefix: "auth-provider" },
  // Package installations
  { pattern: /(?:npm install|pnpm add|yarn add)\s+([\w@/.-]+(?:\s+[\w@/.-]+)*)/gi, domain: "project", keyPrefix: "packages" },
];

// ===========================================================================
// ContextCoordinator class
// ===========================================================================

let entryCounter = 0;

function generateEntryId(): string {
  return `ctx-${++entryCounter}-${Date.now()}`;
}

/**
 * Manages shared context between agents so each agent receives only
 * the information relevant to its task.
 *
 * Tracks provenance (who contributed what, when), supports versioning
 * with supersede semantics, snapshots for diffing, and persistent
 * serialization via an injectable {@link IContextPersistence} adapter.
 */
export class ContextCoordinator {
  private entries: ContextEntry[] = [];
  private snapshots: ContextSnapshot[] = [];
  private persistence: IContextPersistence | null;

  constructor(persistence?: IContextPersistence) {
    this.persistence = persistence ?? null;
  }

  // -------------------------------------------------------------------------
  // Core API
  // -------------------------------------------------------------------------

  /**
   * Get a filtered context subset relevant to a specific task.
   * Uses the task's prompt, label, and features to determine which
   * domains are relevant, then returns only matching entries.
   */
  getContextForTask(task: ExecutionTask): ContextSubset {
    const domains = this.resolveRelevantDomains(task);
    const entries = this.filterEntries(domains);

    return {
      taskId: task.id,
      entries,
      domains,
      summary: this.buildSummary(entries, domains),
    };
  }

  /**
   * Update context after an agent completes work.
   * Extracts structured knowledge from the agent's output and
   * any explicit declarations, then merges into the store.
   */
  updateFromAgentOutput(output: AgentOutput): void {
    const now = new Date().toISOString();

    // Process explicit declarations first
    if (output.declarations) {
      for (const decl of output.declarations) {
        this.upsertEntry(decl.domain, decl.key, decl.value, output.agent, output.taskId, now);
      }
    }

    // Extract implicit context from raw output
    const extracted = this.extractFromOutput(output.output);
    for (const item of extracted) {
      this.upsertEntry(item.domain, item.key, item.value, output.agent, output.taskId, now);
    }
  }

  /**
   * Get the diff between two named snapshots.
   */
  getContextDiff(fromId: string, toId: string): ContextDiff {
    const fromSnap = this.snapshots.find((s) => s.id === fromId);
    const toSnap = this.snapshots.find((s) => s.id === toId);

    if (!fromSnap) throw new Error(`Snapshot not found: ${fromId}`);
    if (!toSnap) throw new Error(`Snapshot not found: ${toId}`);

    const fromIds = new Set(fromSnap.entryIds);
    const toIds = new Set(toSnap.entryIds);
    const entryMap = new Map(this.entries.map((e) => [e.id, e]));

    const added: ContextEntry[] = [];
    const updated: ContextEntry[] = [];
    const superseded: ContextEntry[] = [];

    for (const id of toIds) {
      const entry = entryMap.get(id);
      if (!entry) continue;
      if (!fromIds.has(id)) {
        if (entry.version > 1) {
          updated.push(entry);
        } else {
          added.push(entry);
        }
      }
    }

    for (const id of fromIds) {
      const entry = entryMap.get(id);
      if (!entry) continue;
      if (entry.superseded) {
        superseded.push(entry);
      }
    }

    return {
      fromSnapshot: fromId,
      toSnapshot: toId,
      added,
      updated,
      superseded,
    };
  }

  // -------------------------------------------------------------------------
  // Manual context management
  // -------------------------------------------------------------------------

  /** Add a context entry directly (e.g. from user preferences or system). */
  addEntry(
    domain: ContextDomain,
    key: string,
    value: string,
    source: AgentRole | "user" | "system" = "system"
  ): ContextEntry {
    const now = new Date().toISOString();
    return this.upsertEntry(domain, key, value, source, null, now);
  }

  /** Get all current (non-superseded) entries. */
  getCurrentEntries(): readonly ContextEntry[] {
    return this.entries.filter((e) => !e.superseded);
  }

  /** Get all entries for a specific domain. */
  getEntriesForDomain(domain: ContextDomain): readonly ContextEntry[] {
    return this.entries.filter((e) => e.domain === domain && !e.superseded);
  }

  /** Get entry by key (returns latest non-superseded version). */
  getEntry(key: string): ContextEntry | undefined {
    return this.entries.find((e) => e.key === key && !e.superseded);
  }

  /** Create a named snapshot of the current state. */
  createSnapshot(label: string): ContextSnapshot {
    const snapshot: ContextSnapshot = {
      id: `snap-${this.snapshots.length + 1}-${Date.now()}`,
      label,
      timestamp: new Date().toISOString(),
      entryIds: this.entries.filter((e) => !e.superseded).map((e) => e.id),
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /** Load context from persistent storage. */
  async load(): Promise<void> {
    if (!this.persistence) return;
    const store = await this.persistence.load();
    if (store) {
      this.entries = [...store.entries];
      this.snapshots = [...store.snapshots];
    }
  }

  /** Save context to persistent storage. */
  async save(): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.save({
      version: 1,
      entries: this.entries,
      snapshots: this.snapshots,
    });
  }

  /** Export the full store (for serialization or debugging). */
  exportStore(): ContextStore {
    return {
      version: 1,
      entries: [...this.entries],
      snapshots: [...this.snapshots],
    };
  }

  /** Import a store (e.g. from deserialized JSON). */
  importStore(store: ContextStore): void {
    this.entries = [...store.entries];
    this.snapshots = [...store.snapshots];
  }

  // -------------------------------------------------------------------------
  // Domain resolution — determine which domains a task needs
  // -------------------------------------------------------------------------

  /**
   * Analyze a task's prompt, label, and features to determine which
   * context domains are relevant. Always includes "project".
   */
  resolveRelevantDomains(task: ExecutionTask): ContextDomain[] {
    const domains = new Set<ContextDomain>(["project"]);
    const text = `${task.label} ${task.prompt}`.toLowerCase();

    // Match against keyword → domain map (word-boundary matching to avoid
    // false positives like "build" containing "ui")
    for (const [keyword, relevantDomains] of DOMAIN_RELEVANCE) {
      const pattern = new RegExp(`\\b${keyword}s?\\b`);
      if (pattern.test(text)) {
        for (const d of relevantDomains) {
          domains.add(d);
        }
      }
    }

    // Match against task features
    if (task.forFeatures) {
      for (const feature of task.forFeatures) {
        const domain = FEATURE_DOMAINS.get(feature);
        if (domain) domains.add(domain);
      }
    }

    // Design domain is always relevant for claude tasks (architectural agent)
    if (task.agent === "claude") {
      domains.add("design");
    }

    // Testing always gets broad context
    if (/\btests?\b/.test(text) || /\bspecs?\b/.test(text) || /\be2e\b/.test(text)) {
      domains.add("frontend");
      domains.add("api");
      domains.add("database");
      domains.add("auth");
      domains.add("testing");
    }

    return [...domains];
  }

  // -------------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------------

  private filterEntries(domains: readonly ContextDomain[]): ContextEntry[] {
    const domainSet = new Set(domains);
    return this.entries
      .filter((e) => !e.superseded && domainSet.has(e.domain))
      .sort((a, b) => {
        // Sort by domain, then by recency (newest first)
        if (a.domain !== b.domain) return a.domain.localeCompare(b.domain);
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }

  // -------------------------------------------------------------------------
  // Summary generation
  // -------------------------------------------------------------------------

  private buildSummary(
    entries: readonly ContextEntry[],
    domains: readonly ContextDomain[]
  ): string {
    if (entries.length === 0) {
      return "No prior context available for this task.";
    }

    const sections: string[] = [];
    const byDomain = new Map<ContextDomain, ContextEntry[]>();

    for (const entry of entries) {
      if (!byDomain.has(entry.domain)) byDomain.set(entry.domain, []);
      byDomain.get(entry.domain)!.push(entry);
    }

    for (const domain of domains) {
      const domainEntries = byDomain.get(domain);
      if (!domainEntries || domainEntries.length === 0) continue;

      const label = domain.charAt(0).toUpperCase() + domain.slice(1);
      const items = domainEntries.map(
        (e) => `  - ${e.key}: ${truncate(e.value, 120)}`
      );
      sections.push(`## ${label}\n${items.join("\n")}`);
    }

    return sections.join("\n\n");
  }

  // -------------------------------------------------------------------------
  // Upsert logic with provenance tracking
  // -------------------------------------------------------------------------

  private upsertEntry(
    domain: ContextDomain,
    key: string,
    value: string,
    source: AgentRole | "user" | "system",
    taskId: string | null,
    now: string
  ): ContextEntry {
    // Check if an entry with this key already exists
    const existing = this.entries.find(
      (e) => e.key === key && e.domain === domain && !e.superseded
    );

    if (existing) {
      // Supersede the old entry
      const idx = this.entries.indexOf(existing);
      this.entries[idx] = { ...existing, superseded: true, supersededBy: null };

      const updated: ContextEntry = {
        id: generateEntryId(),
        domain,
        key,
        value,
        source,
        taskId,
        createdAt: existing.createdAt,
        updatedAt: now,
        superseded: false,
        supersededBy: null,
        version: existing.version + 1,
      };

      // Link the old entry to the new one
      this.entries[idx] = {
        ...this.entries[idx]!,
        supersededBy: updated.id,
      };

      this.entries.push(updated);
      return updated;
    }

    // New entry
    const entry: ContextEntry = {
      id: generateEntryId(),
      domain,
      key,
      value,
      source,
      taskId,
      createdAt: now,
      updatedAt: now,
      superseded: false,
      supersededBy: null,
      version: 1,
    };

    this.entries.push(entry);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Heuristic extraction from raw agent output
  // -------------------------------------------------------------------------

  private extractFromOutput(
    output: string
  ): { domain: ContextDomain; key: string; value: string }[] {
    const results: { domain: ContextDomain; key: string; value: string }[] = [];
    const seen = new Set<string>();

    for (const rule of EXTRACTION_RULES) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(output)) !== null) {
        const captured = match[1] ?? match[0]!;
        const key = `${rule.keyPrefix}-${captured.toLowerCase().replace(/\s+/g, "-")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          domain: rule.domain,
          key,
          value: captured.trim(),
        });
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
