import type { ExecutionTask } from "../../intelligence/types";
import type { AgentOutput, ContextSubset } from "../../orchestration/contextCoordinator";
import type { SessionStatus } from "../../orchestration/types";
import type { SessionManager } from "../../orchestration/sessionManager";
import { BaseAgent } from "./baseAgent";

// ===========================================================================
// CodexAgent
//
// Testing/async agent wrapper. Codex (o3-mini via copilot vendor) handles
// test generation, async operations, validation logic, and API contract
// testing.
//
// Prompt style: systematic, contract-first with explicit test coverage goals.
// Context injection: testing + api + database + auth domains.
// Declarations: test patterns and coverage targets keyed to testing domain.
//
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

/** Codex's testing/validation persona. */
const CODEX_PREAMBLE = `You are an expert software engineer specializing in testing, async patterns, and validation.
You write comprehensive, maintainable tests that cover edge cases and failure modes.
You follow the principle that tests should be independent, deterministic, and fast.`;

/** Instructions for structured output from Codex. */
const CODEX_OUTPUT_INSTRUCTIONS = `
## Output Instructions

After your tests, emit any important test configuration or coverage information:

<!-- DECLARATIONS
testing:test-file:src/tests/ComponentName.test.ts
testing:coverage-target:describe what is being covered
testing:test-pattern:describe the testing pattern used
-->

Only declare information that helps other agents understand what has been tested.`;

export class CodexAgent extends BaseAgent {
  constructor(sessionManager: SessionManager) {
    super("codex", sessionManager);
  }

  // -------------------------------------------------------------------------
  // Prompt construction
  // -------------------------------------------------------------------------

  protected buildPrompt(task: ExecutionTask, context: ContextSubset): string {
    const sections: string[] = [];

    sections.push(CODEX_PREAMBLE);

    const contextBlock = this.buildContextBlock(context);
    if (contextBlock) {
      sections.push(contextBlock);
    }

    const testFramework = this.extractTestFramework(context);
    if (testFramework) {
      sections.push(this.buildSectionSeparator("Test Framework"));
      sections.push(testFramework);
    }

    sections.push(this.buildSectionSeparator("Testing Task"));
    sections.push(`**Task:** ${task.label}`);
    sections.push("");
    sections.push("**Instructions:**");
    sections.push(task.prompt);
    sections.push("");

    sections.push(this.buildCoverageExpectations(task));
    sections.push(CODEX_OUTPUT_INSTRUCTIONS);

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
      agent: "codex",
      output: sessionStatus.output,
      declarations: declarations.length > 0 ? declarations : undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Extract the test framework from context entries so Codex uses the
   * correct import statements and assertion API.
   */
  private extractTestFramework(context: ContextSubset): string {
    const testEntry = context.entries.find(
      (e) => e.domain === "testing" && e.key === "test-framework"
    );
    if (!testEntry) return "";

    return [
      `Use this test framework: **${testEntry.value}**`,
      "Match the import style and assertion patterns from this framework.",
    ].join("\n");
  }

  /**
   * Build coverage expectations based on task type.
   */
  private buildCoverageExpectations(task: ExecutionTask): string {
    const text = `${task.label} ${task.prompt}`.toLowerCase();

    if (text.includes("e2e") || text.includes("end-to-end")) {
      return [
        "**Coverage Requirements:**",
        "- Test the complete user journey from start to finish",
        "- Include happy path and at least 2 error/edge cases",
        "- Mock external services (payment, email, auth) at the boundary",
      ].join("\n");
    }

    if (text.includes("integration") || text.includes("api")) {
      return [
        "**Coverage Requirements:**",
        "- Test each endpoint with valid and invalid inputs",
        "- Test authentication and authorization boundaries",
        "- Test error responses (400, 401, 403, 404, 500)",
      ].join("\n");
    }

    return [
      "**Coverage Requirements:**",
      "- Test each function/component in isolation",
      "- Cover the happy path, edge cases, and error conditions",
      "- Use factory helpers (make* functions) for test data",
    ].join("\n");
  }
}
