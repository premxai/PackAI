import type { AgentRole } from "../intelligence/types";
import type { AgentOutput, ContextDomain } from "./contextCoordinator";

// ===========================================================================
// ConflictResolver
//
// Pure logic module that detects semantic/content conflicts in agent outputs
// and provides resolution strategies. Operates post-execution — the existing
// `Conflict` in dependencyResolver.ts handles pre-execution scheduling
// conflicts; this handles output-level disagreements.
//
// No VS Code dependency — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Discriminator for output conflict variants. */
export type OutputConflictType =
  | "api-contract"
  | "duplicate-work"
  | "file-merge"
  | "contradictory-impl";

/** Common fields shared by all output conflict variants. */
export interface BaseOutputConflict {
  readonly id: string;
  readonly type: OutputConflictType;
  readonly taskIds: readonly [string, string];
  readonly agents: readonly [AgentRole, AgentRole];
  readonly description: string;
  readonly severity: "low" | "medium" | "high";
  readonly detectedAt: string;
}

/** Two agents define the same API endpoint with different response/request schemas. */
export interface APIContractConflict extends BaseOutputConflict {
  readonly type: "api-contract";
  readonly endpoint: string;
  readonly schemaA: string;
  readonly schemaB: string;
}

/** Two agents create the same named artifact (component, model, function). */
export interface DuplicateWorkConflict extends BaseOutputConflict {
  readonly type: "duplicate-work";
  readonly componentName: string;
  readonly duplicateKind: "component" | "function" | "endpoint" | "model" | "generic";
}

/** Two agents produce different code blocks for the same file path. */
export interface FileMergeConflict extends BaseOutputConflict {
  readonly type: "file-merge";
  readonly filePath: string;
  readonly contentA: string;
  readonly contentB: string;
  readonly mergeMarkers: string;
}

/** Two agents make contradictory claims about the same topic. */
export interface ContradictoryImplConflict extends BaseOutputConflict {
  readonly type: "contradictory-impl";
  readonly topic: string;
  readonly statementA: string;
  readonly statementB: string;
}

/** Discriminated union of all output conflict types. */
export type OutputConflict =
  | APIContractConflict
  | DuplicateWorkConflict
  | FileMergeConflict
  | ContradictoryImplConflict;

// ---------------------------------------------------------------------------
// Resolution types
// ---------------------------------------------------------------------------

/** Strategy for resolving a conflict. */
export type ResolutionStrategy =
  | "use-a"
  | "use-b"
  | "merge"
  | "pause-agent"
  | "flag-for-review";

/** A concrete resolution applied to a conflict. */
export interface Resolution {
  readonly conflictId: string;
  readonly strategy: ResolutionStrategy;
  readonly resolvedBy: "auto" | "user";
  readonly notes: string;
  readonly appliedAt: string;
  readonly winningTaskId?: string;
  readonly mergedContent?: string;
  readonly pausedAgent?: AgentRole;
}

/** One option presented to the user for resolving a conflict. */
export interface ResolutionOption {
  readonly label: string;
  readonly description: string;
  readonly strategy: ResolutionStrategy;
  readonly winningTaskId?: string;
  readonly mergedContent?: string;
  readonly pausedAgent?: AgentRole;
}

/** History record pairing a conflict with its resolution. */
export interface ResolutionHistoryEntry {
  readonly conflict: OutputConflict;
  readonly resolution: Resolution;
}

// ---------------------------------------------------------------------------
// Diff view types (data only — UI renders separately)
// ---------------------------------------------------------------------------

/** A single line in a diff view. */
export interface DiffLine {
  readonly kind: "context" | "added" | "removed";
  readonly content: string;
  readonly lineNo: number;
}

/** Data for rendering a side-by-side or inline diff in the UI. */
export interface ConflictDiffView {
  readonly conflictId: string;
  readonly labelA: string;
  readonly labelB: string;
  readonly lines: readonly DiffLine[];
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

/** Matches HTTP verb + path in agent output. */
const API_ENDPOINT_PATTERN =
  /(GET|POST|PUT|PATCH|DELETE)\s+(\/[\w/:.-]+)/gi;

/** Matches exported function/const/class declarations. */
const COMPONENT_EXPORT_PATTERN =
  /export\s+(?:default\s+)?(?:function|const|class)\s+(\w+)/gi;

/** Matches database model/table/schema declarations. */
const MODEL_DECLARATION_PATTERN =
  /(?:model|table|schema)\s+(\w+)/gi;

/** Matches code fences with optional language tag. */
const CODE_FENCE_PATTERN =
  /```[\w]*\n([\s\S]*?)```/g;

/** File paths mentioned in output text. */
const FILE_PATH_PATTERNS: readonly RegExp[] = [
  /(?:^|\s)((?:\.\/|src\/|app\/|pages\/|components\/|lib\/|utils\/|api\/|styles\/|public\/|tests?\/)[\w/.:-]+\.[\w]{1,5})/gi,
  /(?:^|[\s,;(])(package\.json|tsconfig\.json|\.env(?:\.local)?|next\.config\.\w+|vite\.config\.\w+|tailwind\.config\.\w+|prisma\/schema\.prisma)(?=[\s,;).:]|$)/gi,
];

/** High-severity API paths. */
const HIGH_SEVERITY_ENDPOINTS = ["/api/auth", "/api/users", "/api/login"];

/** High-severity config files for file-merge conflicts. */
const HIGH_SEVERITY_FILES = ["package.json", "tsconfig.json", ".env", "prisma/schema.prisma"];

// ===========================================================================
// ConflictResolver class
// ===========================================================================

/**
 * Detects semantic and content conflicts in agent outputs and provides
 * resolution strategies.
 *
 * Runs four independent detectors: API contract mismatches, duplicate work,
 * file merge conflicts, and contradictory implementation decisions.
 * Supports automatic resolution for simple cases and generates user-facing
 * resolution options for complex ones.
 */
export class ConflictResolver {
  private readonly history: ResolutionHistoryEntry[] = [];
  private conflictCounter = 0;

  // -------------------------------------------------------------------------
  // Primary API
  // -------------------------------------------------------------------------

  /**
   * Detect all semantic/content conflicts among a set of agent outputs.
   * Runs four independent detectors and concatenates results.
   */
  detectConflicts(outputs: AgentOutput[]): OutputConflict[] {
    if (outputs.length < 2) return [];

    return [
      ...this.detectAPIContractConflicts(outputs),
      ...this.detectDuplicateWorkConflicts(outputs),
      ...this.detectFileMergeConflicts(outputs),
      ...this.detectContradictoryImplConflicts(outputs),
    ];
  }

  /**
   * Attempt automatic resolution for simple/clear-cut conflicts.
   * Returns null when human judgment is required.
   */
  autoResolve(conflict: OutputConflict): Resolution | null {
    const now = new Date().toISOString();

    switch (conflict.type) {
      case "duplicate-work": {
        // Claude (architectural agent) wins over copilot/codex
        const claudeIndex = conflict.agents.indexOf("claude");
        if (claudeIndex !== -1 && conflict.agents[0] !== conflict.agents[1]) {
          const winnerIdx = claudeIndex as 0 | 1;
          return {
            conflictId: conflict.id,
            strategy: winnerIdx === 0 ? "use-a" : "use-b",
            resolvedBy: "auto",
            notes: `Auto-resolved: Claude (architectural agent) output preferred for "${conflict.componentName}"`,
            appliedAt: now,
            winningTaskId: conflict.taskIds[winnerIdx],
          };
        }
        // Same agent, different tasks — newer task wins
        if (conflict.agents[0] === conflict.agents[1]) {
          return {
            conflictId: conflict.id,
            strategy: "use-b",
            resolvedBy: "auto",
            notes: `Auto-resolved: later task "${conflict.taskIds[1]}" preferred (same agent)`,
            appliedAt: now,
            winningTaskId: conflict.taskIds[1],
          };
        }
        return null;
      }

      case "contradictory-impl": {
        if (conflict.severity === "low") {
          return {
            conflictId: conflict.id,
            strategy: "flag-for-review",
            resolvedBy: "auto",
            notes: `Auto-flagged: low-severity contradiction on "${conflict.topic}" — "${conflict.statementA}" vs "${conflict.statementB}"`,
            appliedAt: now,
          };
        }
        return null;
      }

      case "api-contract":
      case "file-merge":
        return null;
    }
  }

  /**
   * Generate resolution options for user decision.
   * Each conflict type gets tailored options with readable labels.
   */
  getUserResolutionOptions(conflict: OutputConflict): ResolutionOption[] {
    const agentA = conflict.agents[0];
    const agentB = conflict.agents[1];

    switch (conflict.type) {
      case "api-contract":
        return [
          {
            label: `Use ${agentA}'s schema`,
            description: `Accept the API contract defined by ${agentA} (${conflict.taskIds[0]}) for ${conflict.endpoint}`,
            strategy: "use-a",
            winningTaskId: conflict.taskIds[0],
          },
          {
            label: `Use ${agentB}'s schema`,
            description: `Accept the API contract defined by ${agentB} (${conflict.taskIds[1]}) for ${conflict.endpoint}`,
            strategy: "use-b",
            winningTaskId: conflict.taskIds[1],
          },
          {
            label: "Flag for manual review",
            description: `Mark the ${conflict.endpoint} contract mismatch for manual review and merging`,
            strategy: "flag-for-review",
          },
        ];

      case "duplicate-work":
        return [
          {
            label: `Keep ${agentA}'s ${conflict.componentName}`,
            description: `Use ${agentA}'s implementation and discard ${agentB}'s`,
            strategy: "use-a",
            winningTaskId: conflict.taskIds[0],
          },
          {
            label: `Keep ${agentB}'s ${conflict.componentName}`,
            description: `Use ${agentB}'s implementation and discard ${agentA}'s`,
            strategy: "use-b",
            winningTaskId: conflict.taskIds[1],
          },
          {
            label: `Pause ${agentB}`,
            description: `Pause ${agentB}'s downstream tasks and use ${agentA}'s output`,
            strategy: "pause-agent",
            pausedAgent: agentB,
          },
        ];

      case "file-merge":
        return [
          {
            label: `Use ${agentA}'s version of ${conflict.filePath}`,
            description: `Accept the file content from ${agentA} (${conflict.taskIds[0]})`,
            strategy: "use-a",
            winningTaskId: conflict.taskIds[0],
          },
          {
            label: `Use ${agentB}'s version of ${conflict.filePath}`,
            description: `Accept the file content from ${agentB} (${conflict.taskIds[1]})`,
            strategy: "use-b",
            winningTaskId: conflict.taskIds[1],
          },
          {
            label: "Merge with conflict markers",
            description: `Insert git-style conflict markers into ${conflict.filePath} for manual resolution`,
            strategy: "merge",
            mergedContent: conflict.mergeMarkers,
          },
        ];

      case "contradictory-impl":
        return [
          {
            label: `Accept ${agentA}'s: "${truncate(conflict.statementA, 40)}"`,
            description: `Use ${agentA}'s decision on ${conflict.topic}`,
            strategy: "use-a",
            winningTaskId: conflict.taskIds[0],
          },
          {
            label: `Accept ${agentB}'s: "${truncate(conflict.statementB, 40)}"`,
            description: `Use ${agentB}'s decision on ${conflict.topic}`,
            strategy: "use-b",
            winningTaskId: conflict.taskIds[1],
          },
          {
            label: "Flag for review",
            description: `Mark "${conflict.topic}" contradiction for later review`,
            strategy: "flag-for-review",
          },
        ];
    }
  }

  /**
   * Record a resolution in the history log.
   * If a resolution already exists for this conflict, it is replaced.
   */
  applyResolution(conflict: OutputConflict, resolution: Resolution): void {
    const existingIdx = this.history.findIndex(
      (h) => h.conflict.id === conflict.id
    );
    if (existingIdx !== -1) {
      this.history[existingIdx] = { conflict, resolution };
    } else {
      this.history.push({ conflict, resolution });
    }
  }

  // -------------------------------------------------------------------------
  // UI integration
  // -------------------------------------------------------------------------

  /**
   * Build a line-by-line diff view for rendering in the UI.
   */
  buildDiffView(conflict: OutputConflict): ConflictDiffView {
    let textA: string;
    let textB: string;
    let labelA: string;
    let labelB: string;

    switch (conflict.type) {
      case "api-contract":
        textA = conflict.schemaA;
        textB = conflict.schemaB;
        labelA = `${conflict.agents[0]} (${conflict.taskIds[0]})`;
        labelB = `${conflict.agents[1]} (${conflict.taskIds[1]})`;
        break;
      case "file-merge":
        textA = conflict.contentA;
        textB = conflict.contentB;
        labelA = `${conflict.agents[0]} (${conflict.taskIds[0]})`;
        labelB = `${conflict.agents[1]} (${conflict.taskIds[1]})`;
        break;
      case "duplicate-work":
        textA = `[${conflict.agents[0]}] ${conflict.componentName}`;
        textB = `[${conflict.agents[1]}] ${conflict.componentName}`;
        labelA = `${conflict.agents[0]} (${conflict.taskIds[0]})`;
        labelB = `${conflict.agents[1]} (${conflict.taskIds[1]})`;
        break;
      case "contradictory-impl":
        textA = conflict.statementA;
        textB = conflict.statementB;
        labelA = `${conflict.agents[0]} (${conflict.taskIds[0]})`;
        labelB = `${conflict.agents[1]} (${conflict.taskIds[1]})`;
        break;
    }

    const lines = this.computeLineDiff(textA, textB);

    return {
      conflictId: conflict.id,
      labelA,
      labelB,
      lines,
    };
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  /** Get the full resolution history. */
  getHistory(): readonly ResolutionHistoryEntry[] {
    return this.history;
  }

  /** Look up the resolution for a specific conflict by ID. */
  getResolutionForConflict(conflictId: string): Resolution | undefined {
    return this.history.find((h) => h.conflict.id === conflictId)?.resolution;
  }

  // -------------------------------------------------------------------------
  // Detectors (private)
  // -------------------------------------------------------------------------

  /**
   * Detect API contract mismatches: same endpoint, different schema snippets.
   */
  private detectAPIContractConflicts(
    outputs: AgentOutput[]
  ): APIContractConflict[] {
    const conflicts: APIContractConflict[] = [];

    // Build endpoint → [{ taskId, agent, snippet }] map
    const endpointMap = new Map<
      string,
      { taskId: string; agent: AgentRole; snippet: string }[]
    >();

    for (const out of outputs) {
      const endpoints = this.extractAPIEndpoints(out.output);
      for (const [endpoint, snippet] of endpoints) {
        if (!endpointMap.has(endpoint)) endpointMap.set(endpoint, []);
        endpointMap.get(endpoint)!.push({
          taskId: out.taskId,
          agent: out.agent,
          snippet,
        });
      }
    }

    // Check each endpoint for mismatches across different tasks
    for (const [endpoint, entries] of endpointMap) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i]!;
          const b = entries[j]!;

          // Skip same task
          if (a.taskId === b.taskId) continue;

          const normA = normalize(a.snippet);
          const normB = normalize(b.snippet);

          // Only flag if snippets are non-empty and different
          if (normA.length > 0 && normB.length > 0 && normA !== normB) {
            const isHighSeverity = HIGH_SEVERITY_ENDPOINTS.some((p) =>
              endpoint.toLowerCase().includes(p)
            );

            conflicts.push({
              id: this.generateConflictId(),
              type: "api-contract",
              taskIds: [a.taskId, b.taskId],
              agents: [a.agent, b.agent],
              endpoint,
              schemaA: a.snippet,
              schemaB: b.snippet,
              description: `API contract mismatch for ${endpoint}: ${a.agent} and ${b.agent} define different schemas`,
              severity: isHighSeverity ? "high" : "medium",
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect duplicate work: two agents producing the same named artifact.
   */
  private detectDuplicateWorkConflicts(
    outputs: AgentOutput[]
  ): DuplicateWorkConflict[] {
    const conflicts: DuplicateWorkConflict[] = [];

    // Build name → [{ taskId, agent, kind }] map
    const nameMap = new Map<
      string,
      { taskId: string; agent: AgentRole; kind: DuplicateWorkConflict["duplicateKind"] }[]
    >();

    for (const out of outputs) {
      const names = this.extractComponentNames(out.output);
      for (const [name, kind] of names) {
        if (!nameMap.has(name)) nameMap.set(name, []);
        nameMap.get(name)!.push({ taskId: out.taskId, agent: out.agent, kind });
      }

      // Also check endpoints as potential duplicates
      const endpoints = this.extractAPIEndpoints(out.output);
      for (const [ep] of endpoints) {
        if (!nameMap.has(ep)) nameMap.set(ep, []);
        nameMap.get(ep)!.push({
          taskId: out.taskId,
          agent: out.agent,
          kind: "endpoint",
        });
      }
    }

    // Flag names appearing in 2+ different tasks
    for (const [name, entries] of nameMap) {
      // Deduplicate by taskId within the same name
      const byTask = new Map<string, typeof entries[0]>();
      for (const entry of entries) {
        if (!byTask.has(entry.taskId)) byTask.set(entry.taskId, entry);
      }
      const unique = [...byTask.values()];

      for (let i = 0; i < unique.length; i++) {
        for (let j = i + 1; j < unique.length; j++) {
          const a = unique[i]!;
          const b = unique[j]!;

          conflicts.push({
            id: this.generateConflictId(),
            type: "duplicate-work",
            taskIds: [a.taskId, b.taskId],
            agents: [a.agent, b.agent],
            componentName: name,
            duplicateKind: a.kind === "model" || b.kind === "model" ? "model" : a.kind,
            description: `Duplicate ${a.kind}: "${name}" created by both ${a.agent} (${a.taskId}) and ${b.agent} (${b.taskId})`,
            severity: a.kind === "model" ? "high" : "medium",
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect file merge conflicts: same file path, different code blocks.
   */
  private detectFileMergeConflicts(
    outputs: AgentOutput[]
  ): FileMergeConflict[] {
    const conflicts: FileMergeConflict[] = [];

    // Build filePath → [{ taskId, agent, content }] map
    const fileMap = new Map<
      string,
      { taskId: string; agent: AgentRole; content: string }[]
    >();

    for (const out of outputs) {
      const files = this.extractFileContents(out.output);
      for (const [filePath, content] of files) {
        if (!fileMap.has(filePath)) fileMap.set(filePath, []);
        fileMap.get(filePath)!.push({
          taskId: out.taskId,
          agent: out.agent,
          content,
        });
      }
    }

    // Check for differing content across tasks
    for (const [filePath, entries] of fileMap) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i]!;
          const b = entries[j]!;

          if (a.taskId === b.taskId) continue;

          // Only flag if content actually differs
          if (normalize(a.content) !== normalize(b.content)) {
            const isHighSeverity = HIGH_SEVERITY_FILES.some((f) =>
              filePath.toLowerCase().includes(f.toLowerCase())
            );

            conflicts.push({
              id: this.generateConflictId(),
              type: "file-merge",
              taskIds: [a.taskId, b.taskId],
              agents: [a.agent, b.agent],
              filePath,
              contentA: a.content,
              contentB: b.content,
              mergeMarkers: this.buildMergeMarkers(
                a.content,
                b.content,
                `${a.agent} (${a.taskId})`,
                `${b.agent} (${b.taskId})`
              ),
              description: `File conflict in ${filePath}: different content from ${a.agent} and ${b.agent}`,
              severity: isHighSeverity ? "high" : "medium",
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }
    }

    return conflicts;
  }

  /**
   * Detect contradictory implementation decisions via declarations.
   */
  private detectContradictoryImplConflicts(
    outputs: AgentOutput[]
  ): ContradictoryImplConflict[] {
    const conflicts: ContradictoryImplConflict[] = [];

    // Build domain:key → [{ taskId, agent, value }] map from declarations
    const declMap = new Map<
      string,
      { taskId: string; agent: AgentRole; value: string }[]
    >();

    for (const out of outputs) {
      const decls = this.extractContextDeclarations(out);
      for (const [topicKey, value] of decls) {
        if (!declMap.has(topicKey)) declMap.set(topicKey, []);
        declMap.get(topicKey)!.push({
          taskId: out.taskId,
          agent: out.agent,
          value,
        });
      }
    }

    // Flag contradictions: same key, different values, different tasks
    for (const [topic, entries] of declMap) {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i]!;
          const b = entries[j]!;

          if (a.taskId === b.taskId) continue;
          if (a.value.toLowerCase() === b.value.toLowerCase()) continue;

          const domain = topic.split(":")[0] as ContextDomain;
          const isHighSeverity = domain === "auth" || domain === "api";

          conflicts.push({
            id: this.generateConflictId(),
            type: "contradictory-impl",
            taskIds: [a.taskId, b.taskId],
            agents: [a.agent, b.agent],
            topic,
            statementA: a.value,
            statementB: b.value,
            description: `Contradictory ${topic}: ${a.agent} says "${truncate(a.value, 50)}" but ${b.agent} says "${truncate(b.value, 50)}"`,
            severity: isHighSeverity ? "high" : "low",
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    return conflicts;
  }

  // -------------------------------------------------------------------------
  // Extraction helpers (private)
  // -------------------------------------------------------------------------

  /**
   * Extract API endpoints and their surrounding context (schema snippets).
   * Returns a Map of normalized "VERB /path" → snippet text (up to 200 chars after).
   */
  private extractAPIEndpoints(output: string): Map<string, string> {
    const result = new Map<string, string>();
    API_ENDPOINT_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = API_ENDPOINT_PATTERN.exec(output)) !== null) {
      const verb = match[1]!.toUpperCase();
      const path = match[2]!;
      const key = `${verb} ${path}`;

      // Grab up to 200 characters after the match as "schema snippet"
      const afterIdx = match.index + match[0].length;
      const snippet = output.slice(afterIdx, afterIdx + 200).trim();

      result.set(key, snippet);
    }

    return result;
  }

  /**
   * Extract named artifacts (components, functions, models) from output.
   * Returns a Map of name → kind.
   */
  private extractComponentNames(
    output: string
  ): Map<string, DuplicateWorkConflict["duplicateKind"]> {
    const result = new Map<string, DuplicateWorkConflict["duplicateKind"]>();

    // Exported components/functions/classes
    COMPONENT_EXPORT_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = COMPONENT_EXPORT_PATTERN.exec(output)) !== null) {
      const name = match[1]!;
      // PascalCase = component, camelCase = function
      const isPascal = /^[A-Z]/.test(name);
      result.set(name, isPascal ? "component" : "function");
    }

    // Database models
    MODEL_DECLARATION_PATTERN.lastIndex = 0;
    while ((match = MODEL_DECLARATION_PATTERN.exec(output)) !== null) {
      const name = match[1]!;
      result.set(name, "model");
    }

    return result;
  }

  /**
   * Extract file paths and their associated code fence contents.
   * Returns a Map of normalized path → code content.
   */
  private extractFileContents(output: string): Map<string, string> {
    const result = new Map<string, string>();

    // First extract all file paths with their positions
    const pathPositions: { path: string; index: number }[] = [];
    for (const pattern of FILE_PATH_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(output)) !== null) {
        pathPositions.push({
          path: match[1]!.trim().toLowerCase(),
          index: match.index,
        });
      }
    }

    // Extract all code fence contents with their positions
    const codeFences: { content: string; start: number; end: number }[] = [];
    CODE_FENCE_PATTERN.lastIndex = 0;
    let fenceMatch: RegExpExecArray | null;
    while ((fenceMatch = CODE_FENCE_PATTERN.exec(output)) !== null) {
      codeFences.push({
        content: fenceMatch[1]!.trim(),
        start: fenceMatch.index,
        end: fenceMatch.index + fenceMatch[0].length,
      });
    }

    // For each file path, find the nearest following code fence (within 500 chars)
    for (const pp of pathPositions) {
      let nearest: typeof codeFences[0] | null = null;
      let nearestDist = Infinity;

      for (const fence of codeFences) {
        const dist = fence.start - pp.index;
        if (dist >= 0 && dist < 500 && dist < nearestDist) {
          nearest = fence;
          nearestDist = dist;
        }
      }

      if (nearest && nearest.content.length > 0) {
        result.set(pp.path, nearest.content);
      }
    }

    return result;
  }

  /**
   * Extract context declarations from an agent output.
   * Uses explicit declarations first, then falls back to heuristic analysis.
   * Returns Map of "domain:key" → value.
   */
  private extractContextDeclarations(
    out: AgentOutput
  ): Map<string, string> {
    const result = new Map<string, string>();

    // Explicit declarations
    if (out.declarations) {
      for (const decl of out.declarations) {
        result.set(`${decl.domain}:${decl.key}`, decl.value);
      }
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Merge / diff helpers (private)
  // -------------------------------------------------------------------------

  /**
   * Build git-style conflict markers for two conflicting content blocks.
   */
  private buildMergeMarkers(
    contentA: string,
    contentB: string,
    labelA: string,
    labelB: string
  ): string {
    return [
      `<<<<<<< ${labelA}`,
      contentA,
      "=======",
      contentB,
      `>>>>>>> ${labelB}`,
    ].join("\n");
  }

  /**
   * Compute a simple line-by-line diff between two text blocks.
   * Uses a straightforward approach: lines only in A are "removed",
   * lines only in B are "added", lines in both are "context".
   */
  private computeLineDiff(textA: string, textB: string): DiffLine[] {
    const linesA = textA.split("\n");
    const linesB = textB.split("\n");
    const result: DiffLine[] = [];
    let lineNo = 1;

    const setB = new Set(linesB);
    const setA = new Set(linesA);

    // Removed lines (in A but not B)
    for (const line of linesA) {
      if (setB.has(line)) {
        result.push({ kind: "context", content: line, lineNo: lineNo++ });
      } else {
        result.push({ kind: "removed", content: line, lineNo: lineNo++ });
      }
    }

    // Added lines (in B but not A)
    for (const line of linesB) {
      if (!setA.has(line)) {
        result.push({ kind: "added", content: line, lineNo: lineNo++ });
      }
    }

    return result;
  }

  /** Generate a unique conflict ID. */
  private generateConflictId(): string {
    return `oc-${++this.conflictCounter}-${Date.now()}`;
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/** Normalize text for comparison: collapse whitespace, lowercase, trim. */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Truncate a string to maxLen characters with "…" suffix. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + "…";
}
