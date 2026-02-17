import type { AgentRole } from "../../intelligence/types";
import type { SessionManager } from "../../orchestration/sessionManager";
import type { BaseAgent } from "./baseAgent";
import { ClaudeAgent } from "./claudeAgent";
import { CopilotAgent } from "./copilotAgent";
import { CodexAgent } from "./codexAgent";

// ===========================================================================
// AgentFactory
//
// Creates agent instances for a given AgentRole. Agents are transient
// per-task objects — the factory creates a new instance per call.
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

/**
 * Creates {@link BaseAgent} instances for a given {@link AgentRole}.
 *
 * Agents are transient per-task objects — the factory creates a fresh
 * instance each time {@link create} is called.
 */
export class AgentFactory {
  private readonly sessionManager: SessionManager;

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  /** Create the correct agent subclass for the given role. */
  create(role: AgentRole): BaseAgent {
    switch (role) {
      case "claude":
        return new ClaudeAgent(this.sessionManager);
      case "copilot":
        return new CopilotAgent(this.sessionManager);
      case "codex":
        return new CodexAgent(this.sessionManager);
    }
  }
}

/** Convenience function for creating a single agent directly. */
export function createAgent(
  role: AgentRole,
  sessionManager: SessionManager
): BaseAgent {
  return new AgentFactory(sessionManager).create(role);
}
