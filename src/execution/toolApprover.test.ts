import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ToolApprover,
  type ToolInvocation,
  type ApprovalContext,
  type ApprovalRule,
  type IEnvironmentDetector,
} from "./toolApprover";
import type { AgentRole } from "../intelligence/types";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeInvocation(
  overrides: Partial<ToolInvocation> = {}
): ToolInvocation {
  return {
    type: "READ",
    target: "/src/index.ts",
    agent: "claude",
    description: "Read file",
    ...overrides,
  };
}

function makeContext(
  overrides: Partial<ApprovalContext> = {}
): ApprovalContext {
  return {
    agentOwnedFiles: [],
    workspaceRoot: "/workspace",
    isDevContainer: false,
    isProductionWorkspace: false,
    ...overrides,
  };
}

function makeDetector(
  overrides: Partial<IEnvironmentDetector> = {}
): IEnvironmentDetector {
  return {
    isDevContainer: () => false,
    isProductionWorkspace: () => false,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("ToolApprover", () => {
  let approver: ToolApprover;

  beforeEach(() => {
    approver = new ToolApprover(makeDetector());
  });

  // -------------------------------------------------------------------------
  // READ operations
  // -------------------------------------------------------------------------

  describe("READ operations", () => {
    it("auto-approves READ for any file path", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "READ", target: "/some/deep/path/file.ts" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("read-any");
    });

    it("auto-approves READ even in production workspace", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "READ" }),
        makeContext({ isProductionWorkspace: true })
      );
      expect(decision.approved).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // CREATE operations
  // -------------------------------------------------------------------------

  describe("CREATE operations", () => {
    it("auto-approves CREATE in /src directory", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "CREATE", target: "/src/components/Button.tsx" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("create-src");
    });

    it("requires approval for CREATE outside /src", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "CREATE", target: "/config/settings.json" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("create-other");
    });

    it("auto-approves CREATE outside /src in dev container", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "CREATE", target: "/config/settings.json" }),
        makeContext({ isDevContainer: true })
      );
      expect(decision.approved).toBe(true);
      expect(decision.reason).toContain("Dev container");
    });
  });

  // -------------------------------------------------------------------------
  // EDIT operations
  // -------------------------------------------------------------------------

  describe("EDIT operations", () => {
    it("auto-approves EDIT for files owned by the requesting agent", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({
          type: "EDIT",
          target: "/workspace/src/utils/helpers.ts",
          agent: "copilot",
        }),
        makeContext({
          agentOwnedFiles: ["/workspace/src/utils/helpers.ts"],
        })
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("edit-owned-file");
    });

    it("requires approval for EDIT on files not owned by the agent", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "EDIT", target: "/src/app.ts" }),
        makeContext({ agentOwnedFiles: [] })
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("edit-default");
    });

    it("normalizes paths when checking file ownership", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({
          type: "EDIT",
          target: "/workspace/src/index.ts",
        }),
        makeContext({
          workspaceRoot: "/workspace",
          agentOwnedFiles: ["/src/index.ts"],
        })
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("edit-owned-file");
    });

    it("handles backslash paths on Windows for ownership check", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({
          type: "EDIT",
          target: "C:\\workspace\\src\\index.ts",
        }),
        makeContext({
          workspaceRoot: "C:\\workspace",
          agentOwnedFiles: ["/src/index.ts"],
        })
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("edit-owned-file");
    });
  });

  // -------------------------------------------------------------------------
  // DELETE operations
  // -------------------------------------------------------------------------

  describe("DELETE operations", () => {
    it("never auto-approves DELETE", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/src/old-file.ts" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("delete-any");
    });

    it("does not auto-approve DELETE even in dev container", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/src/old-file.ts" }),
        makeContext({ isDevContainer: true })
      );
      expect(decision.approved).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // TERMINAL operations
  // -------------------------------------------------------------------------

  describe("TERMINAL operations", () => {
    it("auto-approves 'npm install'", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "npm install express" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("terminal-safe-npm-install");
    });

    it("auto-approves 'npm run build'", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "npm run build" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("terminal-safe-npm-run");
    });

    it("auto-approves 'npm test'", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "npm test" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("terminal-safe-npm-test");
    });

    it("auto-approves 'git status'", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "git status" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("terminal-safe-git-status");
    });

    it("auto-approves 'git diff'", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "git diff HEAD" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("terminal-safe-git-diff");
    });

    it("requires approval for 'rm -rf'", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "rm -rf node_modules" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("terminal-risky-rm");
    });

    it("requires approval for 'sudo' commands", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "sudo apt-get install" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("terminal-risky-sudo");
    });

    it("requires approval for unknown terminal commands", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "curl http://example.com" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("terminal-default");
    });
  });

  // -------------------------------------------------------------------------
  // WEB_SEARCH operations
  // -------------------------------------------------------------------------

  describe("WEB_SEARCH operations", () => {
    it("auto-approves WEB_SEARCH", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "WEB_SEARCH", target: "typescript generics" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("web-search-any");
    });
  });

  // -------------------------------------------------------------------------
  // Environment modifiers
  // -------------------------------------------------------------------------

  describe("environment modifiers", () => {
    it("overrides to deny in production workspace for non-read tools", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "CREATE", target: "/src/newFile.ts" }),
        makeContext({ isProductionWorkspace: true })
      );
      expect(decision.approved).toBe(false);
      expect(decision.reason).toContain("Production workspace");
    });

    it("promotes to approve in dev container for non-delete tools", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "curl http://api.example.com" }),
        makeContext({ isDevContainer: true })
      );
      expect(decision.approved).toBe(true);
      expect(decision.reason).toContain("Dev container");
    });

    it("production override takes no effect on READ", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "READ" }),
        makeContext({ isProductionWorkspace: true })
      );
      expect(decision.approved).toBe(true);
    });

    it("dev container promotion does not affect DELETE", () => {
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/src/file.ts" }),
        makeContext({ isDevContainer: true })
      );
      expect(decision.approved).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Trusted agent
  // -------------------------------------------------------------------------

  describe("trusted agent", () => {
    it("auto-approves all operations for trusted agent", () => {
      approver.trustAgentForSession("claude");
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/important-file.ts", agent: "claude" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
      expect(decision.ruleId).toBe("trusted-agent");
    });

    it("records trust rule in audit log", () => {
      approver.trustAgentForSession("copilot");
      approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "rm -rf /", agent: "copilot" }),
        makeContext()
      );
      const log = approver.getAuditLog();
      expect(log).toHaveLength(1);
      expect(log[0]!.decision.ruleId).toBe("trusted-agent");
    });

    it("revokeTrust stops auto-approval", () => {
      approver.trustAgentForSession("claude");
      approver.revokeTrust("claude");
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/file.ts", agent: "claude" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
    });

    it("isTrusted returns correct status", () => {
      expect(approver.isTrusted("claude")).toBe(false);
      approver.trustAgentForSession("claude");
      expect(approver.isTrusted("claude")).toBe(true);
      approver.revokeTrust("claude");
      expect(approver.isTrusted("claude")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Rules management
  // -------------------------------------------------------------------------

  describe("rules management", () => {
    it("getApprovalRules returns a copy of current rules", () => {
      const rules = approver.getApprovalRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it("updateRules replaces existing rules", () => {
      const customRules: ApprovalRule[] = [
        {
          id: "custom-read",
          toolType: "READ",
          autoApprove: false,
          description: "Deny all reads",
          priority: 10,
        },
      ];
      approver.updateRules(customRules);
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "READ" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
    });

    it("mutating returned rules does not affect internal state", () => {
      const rules = approver.getApprovalRules() as ApprovalRule[];
      const originalLength = rules.length;
      rules.push({
        id: "injected",
        toolType: "DELETE",
        autoApprove: true,
        description: "Injected",
        priority: 999,
      });
      expect(approver.getApprovalRules().length).toBe(originalLength);
    });

    it("custom rules override default behavior", () => {
      const customApprover = new ToolApprover(makeDetector(), [
        {
          id: "allow-delete",
          toolType: "DELETE",
          autoApprove: true,
          description: "Allow all deletes",
          priority: 10,
        },
      ]);
      const decision = customApprover.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/file.ts" }),
        makeContext()
      );
      expect(decision.approved).toBe(true);
    });

    it("higher priority rules take precedence", () => {
      approver.updateRules([
        {
          id: "low",
          toolType: "TERMINAL",
          autoApprove: true,
          description: "Low priority allow",
          priority: 1,
        },
        {
          id: "high",
          toolType: "TERMINAL",
          autoApprove: false,
          description: "High priority deny",
          priority: 100,
        },
      ]);
      const decision = approver.shouldAutoApprove(
        makeInvocation({ type: "TERMINAL", target: "npm install" }),
        makeContext()
      );
      expect(decision.approved).toBe(false);
      expect(decision.ruleId).toBe("high");
    });
  });

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  describe("audit log", () => {
    it("records every approval decision", () => {
      approver.shouldAutoApprove(makeInvocation(), makeContext());
      approver.shouldAutoApprove(
        makeInvocation({ type: "DELETE", target: "/file.ts" }),
        makeContext()
      );
      expect(approver.getAuditLog()).toHaveLength(2);
    });

    it("getAuditLog returns entries in chronological order", () => {
      approver.shouldAutoApprove(
        makeInvocation({ target: "/first.ts" }),
        makeContext()
      );
      approver.shouldAutoApprove(
        makeInvocation({ target: "/second.ts" }),
        makeContext()
      );
      const log = approver.getAuditLog();
      expect(log[0]!.invocation.target).toBe("/first.ts");
      expect(log[1]!.invocation.target).toBe("/second.ts");
    });

    it("clearAuditLog empties the log", () => {
      approver.shouldAutoApprove(makeInvocation(), makeContext());
      approver.clearAuditLog();
      expect(approver.getAuditLog()).toHaveLength(0);
    });

    it("audit entry contains invocation, decision, and context", () => {
      const inv = makeInvocation({ type: "CREATE", target: "/src/file.ts" });
      const ctx = makeContext();
      approver.shouldAutoApprove(inv, ctx);
      const entry = approver.getAuditLog()[0]!;
      expect(entry.invocation).toEqual(inv);
      expect(entry.decision.approved).toBe(true);
      expect(entry.context).toEqual(ctx);
      expect(typeof entry.timestamp).toBe("number");
    });

    it("getAuditLog returns a defensive copy", () => {
      approver.shouldAutoApprove(makeInvocation(), makeContext());
      const log1 = approver.getAuditLog();
      const log2 = approver.getAuditLog();
      expect(log1).not.toBe(log2);
      expect(log1).toEqual(log2);
    });
  });

  // -------------------------------------------------------------------------
  // Default rules
  // -------------------------------------------------------------------------

  describe("default rules", () => {
    it("defaultRules returns a non-empty array", () => {
      const rules = ToolApprover.defaultRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it("every default rule has a unique id", () => {
      const rules = ToolApprover.defaultRules();
      const ids = rules.map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("covers all ToolType values", () => {
      const rules = ToolApprover.defaultRules();
      const coveredTypes = new Set(rules.map((r) => r.toolType));
      expect(coveredTypes).toContain("READ");
      expect(coveredTypes).toContain("CREATE");
      expect(coveredTypes).toContain("EDIT");
      expect(coveredTypes).toContain("DELETE");
      expect(coveredTypes).toContain("TERMINAL");
      expect(coveredTypes).toContain("WEB_SEARCH");
    });
  });
});
