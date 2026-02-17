import type { ExecutionTask } from "../../intelligence/types";
import type { AgentOutput, ContextSubset } from "../../orchestration/contextCoordinator";
import type { SessionStatus } from "../../orchestration/types";
import type { SessionManager } from "../../orchestration/sessionManager";
import { BaseAgent } from "./baseAgent";

// ===========================================================================
// ClaudeAgent
//
// Architectural agent wrapper. Claude (claude-sonnet-4.5 via copilot vendor)
// is assigned design-heavy tasks: system architecture, data modelling,
// API contract definition, auth flow design, and cross-cutting concerns.
//
// Prompt style: chain-of-thought with explicit reasoning sections.
// Context injection: full design + project domains.
// Declarations: architectural decisions keyed to design/api/database domains.
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

/** Claude's architectural persona. */
const CLAUDE_PREAMBLE = `You are an expert software architect specializing in modern web development.
You reason through problems step by step, considering trade-offs before committing to decisions.
You produce precise, implementable architectural guidance that other developers can execute directly.`;

/** Instructions for structured output from Claude. */
const CLAUDE_OUTPUT_INSTRUCTIONS = `
## Output Instructions

After completing your response, emit any architectural decisions in this exact format so they can be recorded in the shared project context:

<!-- DECLARATIONS
design:architecture-decision-name:your decision here
api:endpoint-contract-name:your endpoint definition here
database:schema-decision-name:your schema decision here
-->

Only include declarations for decisions that other agents must know about to do their work correctly.
Do not include declarations for things already in the Shared Project Context above.`;

export class ClaudeAgent extends BaseAgent {
  constructor(sessionManager: SessionManager) {
    super("claude", sessionManager);
  }

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  protected buildPrompt(task: ExecutionTask, context: ContextSubset): string {
    const sections: string[] = [];

    sections.push(CLAUDE_PREAMBLE);

    const contextBlock = this.buildContextBlock(context);
    if (contextBlock) {
      sections.push(contextBlock);
    }

    sections.push(this.buildSectionSeparator("Architectural Task"));
    sections.push(`**Task:** ${task.label}`);
    sections.push("");
    sections.push("**Instructions:**");
    sections.push(task.prompt);
    sections.push("");

    sections.push(this.buildChainOfThoughtScaffold(task));
    sections.push(CLAUDE_OUTPUT_INSTRUCTIONS);

    return sections.join("\n");
  }

  // -------------------------------------------------------------------------
  // Output parsing
  // -------------------------------------------------------------------------

  protected parseOutput(
    taskId: string,
    sessionStatus: SessionStatus
  ): AgentOutput {
    const declarations = this.extractDeclarations(sessionStatus.output);
    return {
      taskId,
      agent: "claude",
      output: sessionStatus.output,
      declarations: declarations.length > 0 ? declarations : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Build a chain-of-thought scaffold that guides Claude to reason explicitly.
   * The scaffold varies based on the task type inferred from the label.
   */
  private buildChainOfThoughtScaffold(task: ExecutionTask): string {
    const labelLower = task.label.toLowerCase();

    if (labelLower.includes("review") || labelLower.includes("audit")) {
      return [
        "**Please structure your response as follows:**",
        "1. **Current State Analysis** — What exists and what are its strengths?",
        "2. **Issues & Risks** — What problems or risks do you identify?",
        "3. **Recommendations** — What specific changes do you recommend?",
        "4. **Implementation Guidance** — How should the recommended changes be made?",
      ].join("\n");
    }

    if (labelLower.includes("design") || labelLower.includes("architect")) {
      return [
        "**Please structure your response as follows:**",
        "1. **Problem Analysis** — What are the core requirements and constraints?",
        "2. **Design Options** — What are 2-3 viable approaches and their trade-offs?",
        "3. **Recommended Design** — Which approach do you recommend and why?",
        "4. **Implementation Plan** — What are the concrete next steps?",
      ].join("\n");
    }

    return [
      "**Please structure your response as follows:**",
      "1. **Context & Requirements** — What problem are we solving?",
      "2. **Approach** — How will you solve it?",
      "3. **Implementation** — Provide the concrete implementation.",
      "4. **Notes for other agents** — What do Copilot (UI) and Codex (testing) need to know?",
    ].join("\n");
  }
}
