import { describe, it, expect, beforeEach } from "vitest";
import {
  SyntaxGate,
  SecurityGate,
  StyleGate,
  ImportGate,
  QualityGateRunner,
  type QualityGate,
  type QualityContext,
  type QualityViolation,
} from "./qualityGates";
import type { AgentOutput } from "../orchestration/contextCoordinator";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeOutput(code: string, wrap = true): AgentOutput {
  return {
    taskId: "task-1",
    agent: "claude",
    output: wrap ? "```typescript\n" + code + "\n```" : code,
  };
}

function makeContext(
  overrides: Partial<QualityContext> = {}
): QualityContext {
  return {
    taskId: "task-1",
    agent: "claude",
    projectLanguage: "typescript",
    strictMode: false,
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("SyntaxGate", () => {
  let gate: SyntaxGate;

  beforeEach(() => {
    gate = new SyntaxGate();
  });

  it("passes clean code", () => {
    const result = gate.check(
      makeOutput('function hello() {\n  return "world";\n}'),
      makeContext()
    );
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("catches unbalanced braces", () => {
    const result = gate.check(
      makeOutput("function broken() {\n  if (true) {\n    return 1;\n}"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.message.includes("braces"))).toBe(
      true
    );
  });

  it("catches unbalanced brackets", () => {
    const result = gate.check(
      makeOutput("const arr = [1, 2, 3;"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("brackets"))
    ).toBe(true);
  });

  it("catches unbalanced parentheses", () => {
    const result = gate.check(
      makeOutput("const x = foo(bar(baz);"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("parentheses"))
    ).toBe(true);
  });

  it("catches unterminated strings", () => {
    const result = gate.check(
      makeOutput('const s = "hello;'),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("unterminated"))
    ).toBe(true);
  });

  it("handles multiple code blocks", () => {
    const output: AgentOutput = {
      taskId: "task-1",
      agent: "claude",
      output: [
        "```typescript",
        "function a() {",
        "}",
        "```",
        "Some prose here.",
        "```typescript",
        "const x = [1, 2;",
        "```",
      ].join("\n"),
    };
    const result = gate.check(output, makeContext());
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("skips non-code output (no code fences)", () => {
    const output: AgentOutput = {
      taskId: "task-1",
      agent: "claude",
      output: "This is just prose with no code blocks.",
    };
    const result = gate.check(output, makeContext());
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("reports correct line numbers", () => {
    const result = gate.check(
      makeOutput('const a = 1;\nconst b = "hello;'),
      makeContext()
    );
    const violation = result.violations.find((v) =>
      v.message.includes("unterminated")
    );
    expect(violation).toBeDefined();
    expect(violation!.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// SecurityGate
// ---------------------------------------------------------------------------

describe("SecurityGate", () => {
  let gate: SecurityGate;

  beforeEach(() => {
    gate = new SecurityGate();
  });

  it("passes clean code", () => {
    const result = gate.check(
      makeOutput(
        'const config = {\n  host: process.env.DB_HOST,\n  port: 5432,\n};'
      ),
      makeContext()
    );
    expect(result.passed).toBe(true);
  });

  it("catches hardcoded passwords", () => {
    const result = gate.check(
      makeOutput('const password = "supersecret123";'),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("password"))
    ).toBe(true);
  });

  it("catches hardcoded API keys", () => {
    const result = gate.check(
      makeOutput('const apiKey = "sk-1234567890abcdef";'),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("API key"))
    ).toBe(true);
  });

  it("catches AWS access keys", () => {
    const result = gate.check(
      makeOutput("const awsKey = AKIAIOSFODNN7EXAMPLE;"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.message.includes("AWS"))).toBe(
      true
    );
  });

  it("catches private key blocks", () => {
    const result = gate.check(
      makeOutput("const key = `-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----`;"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("Private key"))
    ).toBe(true);
  });

  it("catches SQL injection via string concatenation", () => {
    const result = gate.check(
      makeOutput(
        'const query = "SELECT * FROM users WHERE id = " + userId;'
      ),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("SQL injection"))
    ).toBe(true);
  });

  it("catches XSS via innerHTML", () => {
    const result = gate.check(
      makeOutput("element.innerHTML = userInput;"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.message.includes("XSS"))).toBe(
      true
    );
  });

  it("catches eval usage", () => {
    const result = gate.check(
      makeOutput("const result = eval(userCode);"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.message.includes("eval"))).toBe(
      true
    );
  });

  it("catches dangerouslySetInnerHTML", () => {
    const result = gate.check(
      makeOutput(
        'return <div dangerouslySetInnerHTML={{ __html: data }} />;'
      ),
      makeContext()
    );
    // dangerouslySetInnerHTML is a warning, not error
    expect(
      result.violations.some((v) =>
        v.message.includes("dangerouslySetInnerHTML")
      )
    ).toBe(true);
    expect(result.violations[0]!.severity).toBe("warning");
  });

  it("catches insecure HTTP URLs but allows localhost", () => {
    const result = gate.check(
      makeOutput(
        'const api = "http://api.example.com";\nconst local = "http://localhost:3000";'
      ),
      makeContext()
    );
    expect(
      result.violations.some((v) => v.message.includes("HTTP"))
    ).toBe(true);
    // Only one violation — localhost is allowed
    const httpViolations = result.violations.filter((v) =>
      v.message.includes("HTTP")
    );
    expect(httpViolations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// StyleGate
// ---------------------------------------------------------------------------

describe("StyleGate", () => {
  let gate: StyleGate;

  beforeEach(() => {
    gate = new StyleGate();
  });

  it("passes clean modern code", () => {
    const result = gate.check(
      makeOutput(
        'const name = "hello";\nlet count = 0;\nif (name === "hello") {\n  count++;\n}'
      ),
      makeContext()
    );
    expect(result.passed).toBe(true);
  });

  it("catches var usage", () => {
    const result = gate.check(
      makeOutput("var name = 'hello';"),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.message.includes("var"))).toBe(
      true
    );
  });

  it("catches any type", () => {
    const result = gate.check(
      makeOutput("function process(data: any) { return data; }"),
      makeContext()
    );
    expect(
      result.violations.some((v) => v.message.includes("any"))
    ).toBe(true);
    expect(result.violations[0]!.severity).toBe("warning");
  });

  it("catches console.log as warning", () => {
    const result = gate.check(
      makeOutput('console.log("debug");'),
      makeContext()
    );
    expect(
      result.violations.some((v) => v.message.includes("console.log"))
    ).toBe(true);
    expect(
      result.violations.find((v) => v.message.includes("console.log"))!
        .severity
    ).toBe("warning");
  });

  it("catches == instead of ===", () => {
    const result = gate.check(
      makeOutput('if (x == "hello") {}'),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.message.includes("==="))).toBe(
      true
    );
  });

  it("catches missing readonly in strict mode", () => {
    const result = gate.check(
      makeOutput("interface User {\n  name: string;\n  age: number;\n}"),
      makeContext({ strictMode: true })
    );
    expect(
      result.violations.some((v) => v.message.includes("readonly"))
    ).toBe(true);
    expect(
      result.violations.filter((v) => v.message.includes("readonly"))
    ).toHaveLength(2);
    expect(
      result.violations.find((v) => v.message.includes("readonly"))!.severity
    ).toBe("info");
  });

  it("skips readonly check when not strict", () => {
    const result = gate.check(
      makeOutput("interface User {\n  name: string;\n}"),
      makeContext({ strictMode: false })
    );
    expect(
      result.violations.some((v) => v.message.includes("readonly"))
    ).toBe(false);
  });

  it("reports correct severity levels", () => {
    const result = gate.check(
      makeOutput(
        'var x = 1;\nfunction f(data: any) {}\nconsole.log("test");'
      ),
      makeContext()
    );
    const severities = result.violations.map((v) => v.severity);
    expect(severities).toContain("error"); // var
    expect(severities).toContain("warning"); // any, console.log
  });
});

// ---------------------------------------------------------------------------
// ImportGate
// ---------------------------------------------------------------------------

describe("ImportGate", () => {
  let gate: ImportGate;

  beforeEach(() => {
    gate = new ImportGate();
  });

  it("passes clean imports", () => {
    const result = gate.check(
      makeOutput(
        'import { useState } from "react";\nimport { Button } from "../components/Button";'
      ),
      makeContext()
    );
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("catches deep relative imports", () => {
    const result = gate.check(
      makeOutput(
        'import { helper } from "../../../../utils/helper";'
      ),
      makeContext()
    );
    expect(
      result.violations.some((v) => v.message.includes("Deep relative"))
    ).toBe(true);
  });

  it("catches direct vscode imports", () => {
    const result = gate.check(
      makeOutput('import * as vscode from "vscode";'),
      makeContext()
    );
    expect(result.passed).toBe(false);
    expect(
      result.violations.some((v) => v.message.includes("vscode"))
    ).toBe(true);
    expect(result.violations[0]!.severity).toBe("error");
  });

  it("handles no imports gracefully", () => {
    const result = gate.check(
      makeOutput("const x = 1;\nconst y = 2;"),
      makeContext()
    );
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("handles output with no code blocks", () => {
    const output: AgentOutput = {
      taskId: "task-1",
      agent: "claude",
      output: "Just some explanation with no code.",
    };
    const result = gate.check(output, makeContext());
    expect(result.passed).toBe(true);
  });

  it("reports correct severity for deep imports vs vscode imports", () => {
    const result = gate.check(
      makeOutput(
        'import * as vscode from "vscode";\nimport { x } from "../../../../deep";'
      ),
      makeContext()
    );
    const vscodeViolation = result.violations.find((v) =>
      v.message.includes("vscode")
    );
    const deepViolation = result.violations.find((v) =>
      v.message.includes("Deep")
    );
    expect(vscodeViolation!.severity).toBe("error");
    expect(deepViolation!.severity).toBe("warning");
  });
});

// ---------------------------------------------------------------------------
// QualityGateRunner
// ---------------------------------------------------------------------------

describe("QualityGateRunner", () => {
  let runner: QualityGateRunner;

  beforeEach(() => {
    runner = new QualityGateRunner();
  });

  it("runs all built-in gates", () => {
    const report = runner.check(
      makeOutput('const x = "hello";'),
      makeContext()
    );
    expect(report.results).toHaveLength(4);
    expect(report.results.map((r) => r.gate)).toEqual([
      "syntax",
      "security",
      "style",
      "imports",
    ]);
  });

  it("aggregates results from multiple gates", () => {
    // This has a var (style error) and console.log (style warning)
    const report = runner.check(
      makeOutput('var x = 1;\nconsole.log("test");'),
      makeContext()
    );
    expect(report.results.length).toBe(4);
    const styleResult = report.results.find((r) => r.gate === "style");
    expect(styleResult!.violations.length).toBeGreaterThan(0);
  });

  it("reports passed=true when no errors (warnings OK)", () => {
    // console.log is a warning, not error
    const report = runner.check(
      makeOutput('console.log("debug");'),
      makeContext()
    );
    expect(report.passed).toBe(true);
    expect(report.warningCount).toBeGreaterThan(0);
  });

  it("reports passed=false when any error exists", () => {
    const report = runner.check(
      makeOutput("var x = 1;"),
      makeContext()
    );
    expect(report.passed).toBe(false);
    expect(report.errorCount).toBeGreaterThan(0);
  });

  it("counts errors/warnings/info correctly", () => {
    // var → error, console.log → warning, any → warning
    const report = runner.check(
      makeOutput('var x: any = 1;\nconsole.log("test");'),
      makeContext()
    );
    expect(report.errorCount).toBeGreaterThan(0);
    expect(report.warningCount).toBeGreaterThan(0);
  });

  it("custom gates run alongside built-ins", () => {
    const customGate: QualityGate = {
      name: "custom",
      severity: "warning",
      check: () => ({
        gate: "custom",
        passed: false,
        violations: [
          {
            gate: "custom",
            severity: "warning",
            message: "Custom check failed",
          },
        ],
      }),
    };
    const customRunner = new QualityGateRunner([
      new SyntaxGate(),
      customGate,
    ]);
    const report = customRunner.check(
      makeOutput('const x = "hello";'),
      makeContext()
    );
    expect(report.results.some((r) => r.gate === "custom")).toBe(true);
    expect(report.results.some((r) => r.gate === "syntax")).toBe(true);
  });

  it("addGate adds a new gate", () => {
    const customGate: QualityGate = {
      name: "custom-added",
      severity: "info",
      check: () => ({ gate: "custom-added", passed: true, violations: [] }),
    };
    runner.addGate(customGate);
    expect(runner.getGates().length).toBe(5);
    const report = runner.check(makeOutput("const x = 1;"), makeContext());
    expect(report.results.some((r) => r.gate === "custom-added")).toBe(true);
  });

  it("removeGate removes a gate by name", () => {
    runner.removeGate("style");
    expect(runner.getGates().length).toBe(3);
    const report = runner.check(makeOutput("var x = 1;"), makeContext());
    expect(report.results.some((r) => r.gate === "style")).toBe(false);
  });

  it("getGates returns a defensive copy", () => {
    const gates1 = runner.getGates();
    const gates2 = runner.getGates();
    expect(gates1).not.toBe(gates2);
    expect(gates1.length).toBe(gates2.length);
  });
});

// ---------------------------------------------------------------------------
// Retry logic
// ---------------------------------------------------------------------------

describe("retry logic", () => {
  let runner: QualityGateRunner;

  beforeEach(() => {
    runner = new QualityGateRunner();
  });

  it("shouldRetry=true when errors exist and attempts < max", () => {
    const retryState = QualityGateRunner.createRetryState("task-1");
    const { shouldRetry, nextRetryState } = runner.checkWithRetry(
      makeOutput("var x = 1;"),
      makeContext(),
      retryState
    );
    expect(shouldRetry).toBe(true);
    expect(nextRetryState.attempt).toBe(1);
  });

  it("shouldRetry=false when no errors", () => {
    const retryState = QualityGateRunner.createRetryState("task-1");
    const { shouldRetry } = runner.checkWithRetry(
      makeOutput('const x = "hello";'),
      makeContext(),
      retryState
    );
    expect(shouldRetry).toBe(false);
  });

  it("shouldRetry=false when attempts >= max (escalate)", () => {
    const retryState = {
      taskId: "task-1",
      attempt: 3,
      maxAttempts: 3,
      violations: [],
    };
    const { shouldRetry } = runner.checkWithRetry(
      makeOutput("var x = 1;"),
      makeContext(),
      retryState
    );
    expect(shouldRetry).toBe(false);
  });

  it("retryFeedback contains violation descriptions", () => {
    const retryState = QualityGateRunner.createRetryState("task-1");
    const { retryFeedback } = runner.checkWithRetry(
      makeOutput("var x = 1;"),
      makeContext(),
      retryState
    );
    expect(retryFeedback).toContain("var");
    expect(retryFeedback).toContain("Quality Gate Failures");
  });

  it("nextRetryState increments attempt count", () => {
    const retryState = QualityGateRunner.createRetryState("task-1");
    const { nextRetryState } = runner.checkWithRetry(
      makeOutput("const x = 1;"),
      makeContext(),
      retryState
    );
    expect(nextRetryState.attempt).toBe(1);
    expect(nextRetryState.taskId).toBe("task-1");
  });
});

// ---------------------------------------------------------------------------
// buildRetryFeedback
// ---------------------------------------------------------------------------

describe("buildRetryFeedback", () => {
  it("formats error violations as numbered list", () => {
    const violations: QualityViolation[] = [
      { gate: "style", severity: "error", message: "Use const", line: 5 },
      {
        gate: "security",
        severity: "error",
        message: "Hardcoded secret",
        line: 10,
      },
    ];
    const feedback = QualityGateRunner.buildRetryFeedback(violations);
    expect(feedback).toContain("1.");
    expect(feedback).toContain("2.");
    expect(feedback).toContain("Use const");
    expect(feedback).toContain("Hardcoded secret");
  });

  it("includes code snippets when available", () => {
    const violations: QualityViolation[] = [
      {
        gate: "style",
        severity: "error",
        message: "Use const",
        codeSnippet: "var x = 1;",
      },
    ];
    const feedback = QualityGateRunner.buildRetryFeedback(violations);
    expect(feedback).toContain("var x = 1;");
  });

  it("returns empty string for no violations", () => {
    expect(QualityGateRunner.buildRetryFeedback([])).toBe("");
  });
});
