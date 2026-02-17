import type { AgentRole } from "../intelligence/types";

// ===========================================================================
// ToolApprover
//
// Intelligent tool approval system that reduces user interruptions by
// auto-approving safe operations while gating destructive ones. Rules are
// priority-based and customizable. Environment modifiers adjust behaviour
// for dev containers (more permissive) and production workspaces (more
// restrictive).
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Categories of tool operations the approver evaluates. */
export type ToolType =
  | "READ"
  | "CREATE"
  | "EDIT"
  | "DELETE"
  | "TERMINAL"
  | "WEB_SEARCH";

/** A tool invocation that needs approval. */
export interface ToolInvocation {
  readonly type: ToolType;
  /** The file path or command string, depending on type. */
  readonly target: string;
  /** Which agent is requesting this action. */
  readonly agent: AgentRole;
  /** Human-readable description of what the tool will do. */
  readonly description: string;
}

/** Contextual information used to evaluate approval rules. */
export interface ApprovalContext {
  /** Files that the requesting agent has created in this session. */
  readonly agentOwnedFiles: readonly string[];
  /** The workspace root path (for resolving relative paths). */
  readonly workspaceRoot: string;
  /** Whether the workspace is running inside a dev container. */
  readonly isDevContainer: boolean;
  /** Whether the workspace is marked as a production workspace. */
  readonly isProductionWorkspace: boolean;
}

/** The result of an approval check. */
export interface ApprovalDecision {
  readonly approved: boolean;
  readonly reason: string;
  /** Which rule produced this decision. */
  readonly ruleId: string;
}

/** A single approval rule definition. */
export interface ApprovalRule {
  readonly id: string;
  readonly toolType: ToolType;
  /** Optional pattern to match against the target (prefix match). */
  readonly targetPattern?: string;
  /** Whether this rule auto-approves (true) or requires confirmation (false). */
  readonly autoApprove: boolean;
  /** Human-readable description of what this rule does. */
  readonly description: string;
  /** Priority — higher numbers take precedence when multiple rules match. */
  readonly priority: number;
}

/** A recorded entry in the audit log. */
export interface AuditEntry {
  readonly timestamp: number;
  readonly invocation: ToolInvocation;
  readonly decision: ApprovalDecision;
  readonly context: ApprovalContext;
}

/**
 * Injected environment detector — abstracts away vscode workspace APIs.
 * Provided by vscodeAdapters.ts at the composition root.
 */
export interface IEnvironmentDetector {
  isDevContainer(): boolean;
  isProductionWorkspace(): boolean;
}

// ---------------------------------------------------------------------------
// ToolApprover
// ---------------------------------------------------------------------------

/** Tool types that are always safe regardless of environment. */
const ENVIRONMENT_IMMUNE_APPROVE: ReadonlySet<ToolType> = new Set([
  "READ",
  "WEB_SEARCH",
]);

/** Tool types that should never be promoted in a dev container. */
const CONTAINER_PROMOTION_BLOCKED: ReadonlySet<ToolType> = new Set(["DELETE"]);

export class ToolApprover {
  private rules: ApprovalRule[];
  private readonly auditLog: AuditEntry[] = [];
  private readonly trustedAgents: Set<AgentRole> = new Set();

  constructor(
    _environmentDetector: IEnvironmentDetector,
    customRules?: readonly ApprovalRule[]
  ) {
    this.rules = customRules ? [...customRules] : ToolApprover.defaultRules();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Evaluate whether a tool invocation should be auto-approved.
   *
   * Decision flow:
   *  1. Trusted agent shortcut
   *  2. EDIT ownership check
   *  3. Rule matching (highest priority wins)
   *  4. Environment modifiers (production deny / container promote)
   *  5. Audit logging
   */
  shouldAutoApprove(
    invocation: ToolInvocation,
    context: ApprovalContext
  ): ApprovalDecision {
    // 1. Trusted agent shortcut
    if (this.trustedAgents.has(invocation.agent)) {
      const decision: ApprovalDecision = {
        approved: true,
        reason: `Agent "${invocation.agent}" is trusted for this session`,
        ruleId: "trusted-agent",
      };
      this.recordAudit(invocation, decision, context);
      return decision;
    }

    // 2. EDIT ownership check
    if (invocation.type === "EDIT") {
      const isOwned = this.isFileOwnedByAgent(invocation.target, context);
      if (isOwned) {
        const decision: ApprovalDecision = {
          approved: true,
          reason: `File "${invocation.target}" is owned by agent "${invocation.agent}"`,
          ruleId: "edit-owned-file",
        };
        this.recordAudit(invocation, decision, context);
        return decision;
      }
    }

    // 3. Find matching rules
    const matchingRules = this.rules
      .filter((rule) => rule.toolType === invocation.type)
      .filter((rule) => {
        if (!rule.targetPattern) return true;
        return this.matchesPattern(
          invocation.target,
          rule.targetPattern,
          context
        );
      })
      .sort((a, b) => b.priority - a.priority);

    const bestRule = matchingRules[0];
    if (!bestRule) {
      const decision: ApprovalDecision = {
        approved: false,
        reason: `No approval rule matches tool type "${invocation.type}"`,
        ruleId: "no-match-default-deny",
      };
      this.recordAudit(invocation, decision, context);
      return decision;
    }

    // 4. Apply environment modifiers
    let approved = bestRule.autoApprove;
    let reason = bestRule.description;
    let ruleId = bestRule.id;

    // Production workspace: override to deny (except safe-by-nature types)
    if (
      context.isProductionWorkspace &&
      approved &&
      !ENVIRONMENT_IMMUNE_APPROVE.has(invocation.type)
    ) {
      approved = false;
      reason = `Production workspace: ${bestRule.description} (overridden to require approval)`;
      ruleId = bestRule.id;
    }

    // Dev container: promote to approve (except always-deny types)
    if (
      context.isDevContainer &&
      !approved &&
      !CONTAINER_PROMOTION_BLOCKED.has(invocation.type)
    ) {
      approved = true;
      reason = `Dev container: ${bestRule.description} (promoted to auto-approve)`;
      ruleId = bestRule.id;
    }

    const decision: ApprovalDecision = { approved, reason, ruleId };
    this.recordAudit(invocation, decision, context);
    return decision;
  }

  /** Returns a defensive copy of the current rules. */
  getApprovalRules(): readonly ApprovalRule[] {
    return [...this.rules];
  }

  /** Replaces the current rules (for settings customization). */
  updateRules(newRules: readonly ApprovalRule[]): void {
    this.rules = [...newRules];
  }

  /** Trust an agent for the remainder of this session. */
  trustAgentForSession(agent: AgentRole): void {
    this.trustedAgents.add(agent);
  }

  /** Revoke session trust for an agent. */
  revokeTrust(agent: AgentRole): void {
    this.trustedAgents.delete(agent);
  }

  /** Check whether an agent is currently trusted. */
  isTrusted(agent: AgentRole): boolean {
    return this.trustedAgents.has(agent);
  }

  /** Returns a defensive copy of the audit log. */
  getAuditLog(): readonly AuditEntry[] {
    return [...this.auditLog];
  }

  /** Clears the audit log. */
  clearAuditLog(): void {
    this.auditLog.length = 0;
  }

  // -------------------------------------------------------------------------
  // Default rules
  // -------------------------------------------------------------------------

  /** Built-in rule set covering all tool types. */
  static defaultRules(): ApprovalRule[] {
    return [
      // READ: always auto-approve
      {
        id: "read-any",
        toolType: "READ",
        autoApprove: true,
        description: "Reading files is always safe",
        priority: 10,
      },

      // CREATE in /src: auto-approve
      {
        id: "create-src",
        toolType: "CREATE",
        targetPattern: "/src",
        autoApprove: true,
        description: "Creating files in /src is safe",
        priority: 20,
      },
      // CREATE elsewhere: require approval
      {
        id: "create-other",
        toolType: "CREATE",
        autoApprove: false,
        description: "Creating files outside /src requires approval",
        priority: 10,
      },

      // EDIT: default to require approval (ownership check is separate)
      {
        id: "edit-default",
        toolType: "EDIT",
        autoApprove: false,
        description: "Editing files requires approval unless owned by the agent",
        priority: 10,
      },

      // DELETE: never auto-approve
      {
        id: "delete-any",
        toolType: "DELETE",
        autoApprove: false,
        description: "Deleting files always requires approval",
        priority: 100,
      },

      // TERMINAL: safe commands
      {
        id: "terminal-safe-npm-install",
        toolType: "TERMINAL",
        targetPattern: "npm install",
        autoApprove: true,
        description: "npm install is safe",
        priority: 30,
      },
      {
        id: "terminal-safe-npm-run",
        toolType: "TERMINAL",
        targetPattern: "npm run",
        autoApprove: true,
        description: "npm run scripts are safe",
        priority: 30,
      },
      {
        id: "terminal-safe-npm-test",
        toolType: "TERMINAL",
        targetPattern: "npm test",
        autoApprove: true,
        description: "npm test is safe",
        priority: 30,
      },
      {
        id: "terminal-safe-npx",
        toolType: "TERMINAL",
        targetPattern: "npx",
        autoApprove: true,
        description: "npx commands are generally safe",
        priority: 20,
      },
      {
        id: "terminal-safe-git-status",
        toolType: "TERMINAL",
        targetPattern: "git status",
        autoApprove: true,
        description: "git status is safe",
        priority: 30,
      },
      {
        id: "terminal-safe-git-diff",
        toolType: "TERMINAL",
        targetPattern: "git diff",
        autoApprove: true,
        description: "git diff is safe",
        priority: 30,
      },

      // TERMINAL: risky commands
      {
        id: "terminal-risky-rm",
        toolType: "TERMINAL",
        targetPattern: "rm ",
        autoApprove: false,
        description: "rm commands require approval",
        priority: 50,
      },
      {
        id: "terminal-risky-sudo",
        toolType: "TERMINAL",
        targetPattern: "sudo",
        autoApprove: false,
        description: "sudo commands require approval",
        priority: 50,
      },

      // TERMINAL: default fallback
      {
        id: "terminal-default",
        toolType: "TERMINAL",
        autoApprove: false,
        description: "Unknown terminal commands require approval",
        priority: 1,
      },

      // WEB_SEARCH: always auto-approve
      {
        id: "web-search-any",
        toolType: "WEB_SEARCH",
        autoApprove: true,
        description: "Web searches are always safe",
        priority: 10,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Normalize a file path: strip workspace root, convert backslashes. */
  private normalizePath(filePath: string, workspaceRoot: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const root = workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
    if (normalized.startsWith(root)) {
      return normalized.slice(root.length);
    }
    return normalized;
  }

  /** Check if a target matches a rule's pattern. */
  private matchesPattern(
    target: string,
    pattern: string,
    context: ApprovalContext
  ): boolean {
    const normalizedTarget = this.normalizePath(target, context.workspaceRoot);
    return normalizedTarget.startsWith(pattern) || target.startsWith(pattern);
  }

  /** Check if a file is owned by the requesting agent. */
  private isFileOwnedByAgent(
    filePath: string,
    context: ApprovalContext
  ): boolean {
    const normalizedTarget = this.normalizePath(filePath, context.workspaceRoot);
    return context.agentOwnedFiles.some(
      (owned) =>
        this.normalizePath(owned, context.workspaceRoot) === normalizedTarget
    );
  }

  /** Record an approval decision to the audit log. */
  private recordAudit(
    invocation: ToolInvocation,
    decision: ApprovalDecision,
    context: ApprovalContext
  ): void {
    this.auditLog.push({
      timestamp: Date.now(),
      invocation,
      decision,
      context,
    });
  }
}
