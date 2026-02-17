import type { AgentRole } from "../intelligence/types";
import type { AgentOutput } from "../orchestration/contextCoordinator";

// ===========================================================================
// Quality Gates
//
// Verifies agent output for syntax errors, security issues, style violations,
// and import problems. Each gate is a class implementing the QualityGate
// interface. The QualityGateRunner orchestrates gates and supports retry
// logic with structured feedback for the agent.
//
// All checks are heuristic/pattern-based (no filesystem or compiler calls).
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Severity levels for quality violations. */
export type QualitySeverity = "error" | "warning" | "info";

/** A single quality issue found by a gate. */
export interface QualityViolation {
  readonly gate: string;
  readonly severity: QualitySeverity;
  readonly message: string;
  readonly line?: number;
  readonly codeSnippet?: string;
}

/** Result of running a single quality gate. */
export interface QualityResult {
  readonly gate: string;
  readonly passed: boolean;
  readonly violations: readonly QualityViolation[];
}

/** Aggregated report from all quality gates. */
export interface QualityReport {
  readonly passed: boolean;
  readonly results: readonly QualityResult[];
  readonly errorCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly feedback: string;
}

/** Interface for quality gates — implement to add custom checks. */
export interface QualityGate {
  readonly name: string;
  readonly severity: QualitySeverity;
  check(output: AgentOutput, context: QualityContext): QualityResult;
}

/** Context provided to quality gates for evaluation. */
export interface QualityContext {
  readonly taskId: string;
  readonly agent: AgentRole;
  readonly projectLanguage: string;
  readonly strictMode: boolean;
}

/** Tracks retry state across quality check iterations. */
export interface RetryState {
  readonly taskId: string;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly violations: readonly QualityViolation[];
}

/** Result of checkWithRetry including retry decision. */
export interface RetryCheckResult {
  readonly report: QualityReport;
  readonly shouldRetry: boolean;
  readonly retryFeedback: string;
  readonly nextRetryState: RetryState;
}

// ---------------------------------------------------------------------------
// Code extraction
// ---------------------------------------------------------------------------

/** Extracted code block from markdown output. */
interface CodeBlock {
  readonly language: string;
  readonly content: string;
}

/** Matches markdown code fences with optional language tag. */
const CODE_FENCE_PATTERN = /```(\w*)\n([\s\S]*?)```/g;

/** Extract code blocks from markdown output. */
function extractCodeBlocks(output: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  CODE_FENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CODE_FENCE_PATTERN.exec(output)) !== null) {
    blocks.push({
      language: match[1] ?? "",
      content: match[2] ?? "",
    });
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// SyntaxGate
// ---------------------------------------------------------------------------

/** Heuristic syntax checks on code blocks (bracket balancing, unterminated strings). */
export class SyntaxGate implements QualityGate {
  readonly name = "syntax";
  readonly severity: QualitySeverity = "error";

  check(output: AgentOutput, _context: QualityContext): QualityResult {
    const blocks = extractCodeBlocks(output.output);
    const violations: QualityViolation[] = [];

    for (const block of blocks) {
      this.checkBracketBalance(block.content, violations);
      this.checkUnterminatedStrings(block.content, violations);
    }

    return {
      gate: this.name,
      passed: violations.length === 0,
      violations,
    };
  }

  private checkBracketBalance(
    code: string,
    violations: QualityViolation[]
  ): void {
    const pairs: [string, string, string][] = [
      ["{", "}", "braces"],
      ["[", "]", "brackets"],
      ["(", ")", "parentheses"],
    ];

    for (const [open, close, label] of pairs) {
      let depth = 0;
      let inString: string | null = null;
      let escaped = false;

      for (let i = 0; i < code.length; i++) {
        const ch = code[i]!;

        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }

        // Track string boundaries
        if (!inString && (ch === '"' || ch === "'" || ch === "`")) {
          inString = ch;
          continue;
        }
        if (inString === ch) {
          inString = null;
          continue;
        }
        if (inString) continue;

        // Skip single-line comments
        if (ch === "/" && code[i + 1] === "/") {
          const newline = code.indexOf("\n", i);
          i = newline === -1 ? code.length : newline;
          continue;
        }

        if (ch === open) depth++;
        if (ch === close) depth--;
      }

      if (depth !== 0) {
        const lineNum = depth > 0
          ? this.findLastOccurrenceLine(code, open)
          : this.findLastOccurrenceLine(code, close);
        violations.push({
          gate: this.name,
          severity: "error",
          message: `Unbalanced ${label}: ${depth > 0 ? "missing closing" : "extra closing"} '${depth > 0 ? close : open}'`,
          line: lineNum,
          codeSnippet: depth > 0
            ? code.split("\n")[lineNum - 1]?.trim()
            : code.split("\n")[lineNum - 1]?.trim(),
        });
      }
    }
  }

  private checkUnterminatedStrings(
    code: string,
    violations: QualityViolation[]
  ): void {
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      // Skip comment-only lines
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;

      // Check for unterminated single/double quotes on a single line
      // (template literals can span lines, so skip backticks)
      for (const quote of ['"', "'"]) {
        let count = 0;
        let escaped = false;
        for (const ch of line) {
          if (escaped) {
            escaped = false;
            continue;
          }
          if (ch === "\\") {
            escaped = true;
            continue;
          }
          if (ch === quote) count++;
        }
        if (count % 2 !== 0) {
          violations.push({
            gate: this.name,
            severity: "error",
            message: `Possible unterminated string literal (${quote})`,
            line: i + 1,
            codeSnippet: line.trim(),
          });
        }
      }
    }
  }

  private findLastOccurrenceLine(code: string, char: string): number {
    const lines = code.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i]!.includes(char)) return i + 1;
    }
    return 1;
  }
}

// ---------------------------------------------------------------------------
// SecurityGate
// ---------------------------------------------------------------------------

/** Security patterns matched against code. */
interface SecurityPattern {
  readonly pattern: RegExp;
  readonly message: string;
  readonly severity: QualitySeverity;
}

const SECURITY_PATTERNS: readonly SecurityPattern[] = [
  // Hardcoded secrets
  {
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"']{3,}["']/gi,
    message: "Hardcoded password detected",
    severity: "error",
  },
  {
    pattern: /(?:api[_-]?key|apikey)\s*[=:]\s*["'][^"']{3,}["']/gi,
    message: "Hardcoded API key detected",
    severity: "error",
  },
  {
    pattern: /(?:secret|token)\s*[=:]\s*["'][^"']{8,}["']/gi,
    message: "Hardcoded secret or token detected",
    severity: "error",
  },
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    message: "AWS access key ID detected",
    severity: "error",
  },
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/g,
    message: "Private key block detected",
    severity: "error",
  },
  // SQL injection
  {
    pattern: /["'`]SELECT\s+.*FROM\s+.*["'`]\s*\+/gi,
    message: "Possible SQL injection: string concatenation in SQL query",
    severity: "error",
  },
  {
    pattern: /`SELECT\s+.*FROM\s+.*\$\{/gi,
    message: "Possible SQL injection: template literal interpolation in SQL query",
    severity: "error",
  },
  // XSS
  {
    pattern: /\.innerHTML\s*=/g,
    message: "Potential XSS: direct innerHTML assignment",
    severity: "error",
  },
  {
    pattern: /dangerouslySetInnerHTML/g,
    message: "Potential XSS: dangerouslySetInnerHTML usage",
    severity: "warning",
  },
  {
    pattern: /document\.write\s*\(/g,
    message: "Potential XSS: document.write usage",
    severity: "error",
  },
  {
    pattern: /\beval\s*\(/g,
    message: "Dangerous eval() usage",
    severity: "error",
  },
  // Insecure HTTP (exclude localhost)
  {
    pattern: /http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/g,
    message: "Insecure HTTP URL (use HTTPS)",
    severity: "warning",
  },
];

/** Scans agent output for security vulnerabilities. */
export class SecurityGate implements QualityGate {
  readonly name = "security";
  readonly severity: QualitySeverity = "error";

  check(output: AgentOutput, _context: QualityContext): QualityResult {
    const violations: QualityViolation[] = [];
    const blocks = extractCodeBlocks(output.output);
    const codeText = blocks.map((b) => b.content).join("\n");

    // Only scan code blocks (not prose)
    if (codeText.length === 0) {
      return { gate: this.name, passed: true, violations: [] };
    }

    for (const sp of SECURITY_PATTERNS) {
      sp.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = sp.pattern.exec(codeText)) !== null) {
        const lineNum = codeText.slice(0, match.index).split("\n").length;
        violations.push({
          gate: this.name,
          severity: sp.severity,
          message: sp.message,
          line: lineNum,
          codeSnippet: match[0],
        });
      }
    }

    const hasErrors = violations.some((v) => v.severity === "error");
    return { gate: this.name, passed: !hasErrors, violations };
  }
}

// ---------------------------------------------------------------------------
// StyleGate
// ---------------------------------------------------------------------------

/** Style patterns matched against code lines. */
interface StylePattern {
  readonly pattern: RegExp;
  readonly message: string;
  readonly severity: QualitySeverity;
  readonly strictOnly?: boolean;
}

const STYLE_PATTERNS: readonly StylePattern[] = [
  {
    pattern: /\bvar\s+\w/,
    message: "Use 'const' or 'let' instead of 'var'",
    severity: "error",
  },
  {
    pattern: /:\s*any\b/,
    message: "Avoid using 'any' type — use a specific type or 'unknown'",
    severity: "warning",
  },
  {
    pattern: /\bconsole\.log\s*\(/,
    message: "console.log statement — remove before production",
    severity: "warning",
  },
  {
    pattern: /[^!=<>]==[^=]/,
    message: "Use '===' instead of '=='",
    severity: "error",
  },
  {
    pattern: /!=[^=]/,
    message: "Use '!==' instead of '!='",
    severity: "error",
  },
];

/** Loose check for interface property lines missing readonly. */
const INTERFACE_PROPERTY_PATTERN =
  /^\s+(?!readonly\b)(\w+)(\?)?:\s+\w/;

/** Checks code blocks for style violations. */
export class StyleGate implements QualityGate {
  readonly name = "style";
  readonly severity: QualitySeverity = "warning";

  check(output: AgentOutput, context: QualityContext): QualityResult {
    const blocks = extractCodeBlocks(output.output);
    const violations: QualityViolation[] = [];

    for (const block of blocks) {
      const lines = block.content.split("\n");
      let inInterface = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        // Skip comment-only lines
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

        // Track interface blocks (for readonly checks)
        if (/\binterface\s+\w/.test(trimmed)) {
          inInterface = true;
        }
        if (inInterface && trimmed === "}") {
          inInterface = false;
        }

        // Standard style patterns
        for (const sp of STYLE_PATTERNS) {
          if (sp.pattern.test(line)) {
            violations.push({
              gate: this.name,
              severity: sp.severity,
              message: sp.message,
              line: i + 1,
              codeSnippet: trimmed,
            });
          }
        }

        // Readonly check (strict mode only)
        if (
          context.strictMode &&
          inInterface &&
          INTERFACE_PROPERTY_PATTERN.test(line) &&
          !trimmed.startsWith("//") &&
          !trimmed.startsWith("}") &&
          !trimmed.startsWith("{") &&
          !trimmed.startsWith("interface") &&
          !trimmed.startsWith("export")
        ) {
          violations.push({
            gate: this.name,
            severity: "info",
            message: "Interface property should be readonly",
            line: i + 1,
            codeSnippet: trimmed,
          });
        }
      }
    }

    const hasErrors = violations.some((v) => v.severity === "error");
    return { gate: this.name, passed: !hasErrors, violations };
  }
}

// ---------------------------------------------------------------------------
// ImportGate
// ---------------------------------------------------------------------------

/** Checks import statements for problematic patterns. */
export class ImportGate implements QualityGate {
  readonly name = "imports";
  readonly severity: QualitySeverity = "error";

  check(output: AgentOutput, _context: QualityContext): QualityResult {
    const blocks = extractCodeBlocks(output.output);
    const violations: QualityViolation[] = [];

    for (const block of blocks) {
      const lines = block.content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        if (!trimmed.startsWith("import ") && !trimmed.startsWith("import{")) {
          continue;
        }

        // Deep relative imports
        if (/from\s+["']\.\.\/\.\.\/\.\.\/\.\.\//.test(trimmed)) {
          violations.push({
            gate: this.name,
            severity: "warning",
            message:
              "Deep relative import (4+ levels) — consider path aliases",
            line: i + 1,
            codeSnippet: trimmed,
          });
        }

        // Direct vscode import (should use dependency inversion)
        if (/from\s+["']vscode["']/.test(trimmed)) {
          violations.push({
            gate: this.name,
            severity: "error",
            message:
              "Direct vscode import — use dependency inversion via interfaces",
            line: i + 1,
            codeSnippet: trimmed,
          });
        }
      }
    }

    const hasErrors = violations.some((v) => v.severity === "error");
    return { gate: this.name, passed: !hasErrors, violations };
  }
}

// ---------------------------------------------------------------------------
// QualityGateRunner
// ---------------------------------------------------------------------------

/** Default max retry attempts for quality gate failures. */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Orchestrates quality gates and supports retry logic with agent feedback.
 *
 * Runs all registered gates (syntax, security, style, imports by default)
 * against agent output. When errors are found, generates structured
 * feedback for the agent to fix and resubmit.
 *
 * Custom gates can be added via {@link addGate}.
 */
export class QualityGateRunner {
  private gates: QualityGate[];

  constructor(customGates?: readonly QualityGate[]) {
    this.gates = customGates
      ? [...customGates]
      : [
          new SyntaxGate(),
          new SecurityGate(),
          new StyleGate(),
          new ImportGate(),
        ];
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Run all gates against an agent output. */
  check(output: AgentOutput, context: QualityContext): QualityReport {
    const results: QualityResult[] = [];
    for (const gate of this.gates) {
      results.push(gate.check(output, context));
    }
    return this.buildReport(results);
  }

  /** Check with retry logic — returns whether to retry and feedback for the agent. */
  checkWithRetry(
    output: AgentOutput,
    context: QualityContext,
    retryState: RetryState
  ): RetryCheckResult {
    const report = this.check(output, context);

    const errorViolations = this.collectViolations(report).filter(
      (v) => v.severity === "error"
    );

    const shouldRetry =
      !report.passed && retryState.attempt < retryState.maxAttempts;

    const retryFeedback = shouldRetry
      ? QualityGateRunner.buildRetryFeedback(errorViolations)
      : "";

    const nextRetryState: RetryState = {
      taskId: retryState.taskId,
      attempt: retryState.attempt + 1,
      maxAttempts: retryState.maxAttempts,
      violations: errorViolations,
    };

    return { report, shouldRetry, retryFeedback, nextRetryState };
  }

  /** Returns a defensive copy of current gates. */
  getGates(): readonly QualityGate[] {
    return [...this.gates];
  }

  /** Add a custom gate. */
  addGate(gate: QualityGate): void {
    this.gates.push(gate);
  }

  /** Remove a gate by name. */
  removeGate(name: string): void {
    this.gates = this.gates.filter((g) => g.name !== name);
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /** Build a retry prompt from violations for agent feedback. */
  static buildRetryFeedback(
    violations: readonly QualityViolation[]
  ): string {
    const errors = violations.filter((v) => v.severity === "error");
    if (errors.length === 0) return "";

    const lines: string[] = [
      "## Quality Gate Failures — Please Fix",
      "",
      "Your output had the following issues that must be resolved:",
      "",
    ];

    for (let i = 0; i < errors.length; i++) {
      const v = errors[i]!;
      let entry = `${i + 1}. **[${v.gate}]** ${v.message}`;
      if (v.line) entry += ` (line ${v.line})`;
      if (v.codeSnippet) entry += `\n   \`${v.codeSnippet}\``;
      lines.push(entry);
    }

    lines.push("");
    lines.push("Please regenerate your output with these issues fixed.");

    return lines.join("\n");
  }

  /** Create an initial retry state for a task. */
  static createRetryState(
    taskId: string,
    maxAttempts: number = DEFAULT_MAX_ATTEMPTS
  ): RetryState {
    return {
      taskId,
      attempt: 0,
      maxAttempts,
      violations: [],
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private buildReport(results: readonly QualityResult[]): QualityReport {
    const allViolations = this.collectViolationsFromResults(results);
    const errorCount = allViolations.filter(
      (v) => v.severity === "error"
    ).length;
    const warningCount = allViolations.filter(
      (v) => v.severity === "warning"
    ).length;
    const infoCount = allViolations.filter(
      (v) => v.severity === "info"
    ).length;

    const feedback =
      errorCount > 0
        ? QualityGateRunner.buildRetryFeedback(allViolations)
        : "";

    return {
      passed: errorCount === 0,
      results,
      errorCount,
      warningCount,
      infoCount,
      feedback,
    };
  }

  private collectViolations(report: QualityReport): QualityViolation[] {
    return this.collectViolationsFromResults(report.results);
  }

  private collectViolationsFromResults(
    results: readonly QualityResult[]
  ): QualityViolation[] {
    const violations: QualityViolation[] = [];
    for (const r of results) {
      for (const v of r.violations) {
        violations.push(v);
      }
    }
    return violations;
  }
}
