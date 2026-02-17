import type { ExecutionTask } from "../../intelligence/types";
import type { AgentOutput, ContextSubset } from "../../orchestration/contextCoordinator";
import type { SessionStatus } from "../../orchestration/types";
import type { SessionManager } from "../../orchestration/sessionManager";
import { BaseAgent } from "./baseAgent";

// ===========================================================================
// CopilotAgent
//
// UI/boilerplate agent wrapper. Copilot (gpt-4o via copilot vendor) handles
// component generation, page layouts, styling, and scaffolding tasks.
//
// Prompt style: direct, code-first with explicit file path targeting.
// Context injection: frontend + design + auth domains.
// Declarations: component names and file paths keyed to frontend domain.
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

/** Copilot's code-focused persona. */
const COPILOT_PREAMBLE = `You are an expert frontend developer and UI engineer specializing in modern React/Next.js applications.
You write clean, production-ready TypeScript code that follows the project's existing conventions.
Generate complete, working code files — not pseudocode or outlines.`;

/** Instructions for structured output from Copilot. */
const COPILOT_OUTPUT_INSTRUCTIONS = `
## Output Instructions

After your code, emit any important component or file information in this exact format:

<!-- DECLARATIONS
frontend:component-name:ComponentName in path/to/file.tsx
frontend:file-path:src/components/ComponentName.tsx
-->

Only declare new components or files that other agents (especially Codex for testing) need to know about.`;

export class CopilotAgent extends BaseAgent {
  constructor(sessionManager: SessionManager) {
    super("copilot", sessionManager);
  }

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  protected buildPrompt(task: ExecutionTask, context: ContextSubset): string {
    const sections: string[] = [];

    sections.push(COPILOT_PREAMBLE);

    const contextBlock = this.buildContextBlock(context);
    if (contextBlock) {
      sections.push(contextBlock);
    }

    sections.push(this.buildSectionSeparator("Implementation Task"));
    sections.push(`**Task:** ${task.label}`);
    sections.push("");

    const stackGuidance = this.extractStackGuidance(context);
    if (stackGuidance) {
      sections.push("**Tech Stack Requirements:**");
      sections.push(stackGuidance);
      sections.push("");
    }

    sections.push("**Instructions:**");
    sections.push(task.prompt);
    sections.push("");

    sections.push(this.buildCodeQualityReminders());
    sections.push(COPILOT_OUTPUT_INSTRUCTIONS);

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
      agent: "copilot",
      output: sessionStatus.output,
      declarations: declarations.length > 0 ? declarations : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract relevant stack information from context entries.
   */
  private extractStackGuidance(context: ContextSubset): string {
    const parts: string[] = [];

    for (const entry of context.entries) {
      if (entry.key === "framework") {
        parts.push(`- Framework: ${entry.value}`);
      } else if (entry.key === "component-lib") {
        parts.push(`- Component library: ${entry.value}`);
      } else if (entry.key === "styling") {
        parts.push(`- Styling: ${entry.value}`);
      }
    }

    return parts.join("\n");
  }

  /** Code quality reminders for TypeScript strict mode. */
  private buildCodeQualityReminders(): string {
    return [
      "**Code Requirements:**",
      "- Use TypeScript strict mode — all props must be typed",
      "- Use `readonly` for all interface properties",
      "- Export named exports (not default exports) for components",
      "- Follow the file naming convention already in the project",
    ].join("\n");
  }
}
