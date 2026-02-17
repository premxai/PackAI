import { describe, it, expect } from "vitest";
import {
  WebFlowError,
  AgentFailureError,
  AllAgentsExhaustedError,
  RateLimitError,
  GitOperationError,
  StatePersistenceError,
  ConflictEscalationError,
  isAgentExecutionError,
  isWebFlowError,
  normalizeError,
  getUserMessage,
} from "./errors";
import type { AgentExecutionError } from "../execution/agents/types";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeAgentExecutionError(
  overrides: Partial<AgentExecutionError> = {}
): AgentExecutionError {
  return {
    code: "session-failed",
    message: "Model unavailable",
    taskId: "task-1",
    agent: "claude",
    sessionStatus: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebFlowError", () => {
  it("has code, message, userMessage, and stack", () => {
    const err = new WebFlowError("test-code", "Internal detail", "User-friendly msg");
    expect(err.code).toBe("test-code");
    expect(err.message).toBe("Internal detail");
    expect(err.userMessage).toBe("User-friendly msg");
    expect(err.stack).toBeDefined();
    expect(err).toBeInstanceOf(Error);
  });

  it("defaults userMessage when not provided", () => {
    const err = new WebFlowError("code", "detail");
    expect(err.userMessage).toBe("Something went wrong. Please try again.");
  });

  it("preserves cause", () => {
    const cause = new Error("original");
    const err = new WebFlowError("code", "msg", undefined, cause);
    expect(err.cause).toBe(cause);
  });
});

describe("AgentFailureError", () => {
  it("wraps AgentExecutionError plain object via fromPlainObject", () => {
    const plain = makeAgentExecutionError({
      code: "session-failed",
      agent: "copilot",
      taskId: "t-42",
    });
    const err = AgentFailureError.fromPlainObject(plain);

    expect(err).toBeInstanceOf(AgentFailureError);
    expect(err).toBeInstanceOf(WebFlowError);
    expect(err.agentCode).toBe("session-failed");
    expect(err.agent).toBe("copilot");
    expect(err.taskId).toBe("t-42");
    expect(err.code).toBe("agent-session-failed");
    expect(err.stack).toBeDefined();
  });

  it("produces user message for session-cancelled", () => {
    const err = AgentFailureError.fromPlainObject(
      makeAgentExecutionError({ code: "session-cancelled" })
    );
    expect(err.userMessage).toBe("The operation was cancelled.");
  });

  it("produces user message for empty-output", () => {
    const err = AgentFailureError.fromPlainObject(
      makeAgentExecutionError({ code: "empty-output", agent: "codex" })
    );
    expect(err.userMessage).toContain("codex");
    expect(err.userMessage).toContain("no output");
  });

  it("produces user message for parse-error", () => {
    const err = AgentFailureError.fromPlainObject(
      makeAgentExecutionError({ code: "parse-error", message: "bad JSON" })
    );
    expect(err.userMessage).toContain("bad JSON");
  });

  it("round-trips all four agent codes", () => {
    for (const code of [
      "session-failed",
      "session-cancelled",
      "parse-error",
      "empty-output",
    ] as const) {
      const err = AgentFailureError.fromPlainObject(
        makeAgentExecutionError({ code })
      );
      expect(err.agentCode).toBe(code);
    }
  });
});

describe("AllAgentsExhaustedError", () => {
  it("records tried agents and taskId", () => {
    const err = new AllAgentsExhaustedError("t-1", ["claude", "copilot"]);
    expect(err.taskId).toBe("t-1");
    expect(err.triedAgents).toEqual(["claude", "copilot"]);
    expect(err.code).toBe("all-agents-exhausted");
    expect(err.userMessage).toContain("claude");
    expect(err.userMessage).toContain("copilot");
  });
});

describe("RateLimitError", () => {
  it("records queue depth", () => {
    const err = new RateLimitError("Too many requests", 5);
    expect(err.queueDepth).toBe(5);
    expect(err.code).toBe("rate-limit");
    expect(err.userMessage).toContain("queued");
  });
});

describe("GitOperationError", () => {
  it("records git command and exit code", () => {
    const err = new GitOperationError("git commit", 128, "not a repository");
    expect(err.gitCommand).toBe("git commit");
    expect(err.exitCode).toBe(128);
    expect(err.code).toBe("git-error");
    expect(err.message).toContain("128");
  });
});

describe("StatePersistenceError", () => {
  it("records operation type", () => {
    const err = new StatePersistenceError("save", "disk full");
    expect(err.code).toBe("state-persistence");
    expect(err.message).toContain("save");
    expect(err.message).toContain("disk full");
  });
});

describe("ConflictEscalationError", () => {
  it("records conflict info", () => {
    const err = new ConflictEscalationError("c-1", "api-contract", "mismatched endpoints");
    expect(err.conflictId).toBe("c-1");
    expect(err.conflictType).toBe("api-contract");
    expect(err.code).toBe("conflict-escalation");
    expect(err.userMessage).toContain("mismatched endpoints");
  });
});

describe("isAgentExecutionError", () => {
  it("recognizes valid AgentExecutionError shape", () => {
    expect(isAgentExecutionError(makeAgentExecutionError())).toBe(true);
  });

  it("rejects null", () => {
    expect(isAgentExecutionError(null)).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isAgentExecutionError(undefined)).toBe(false);
  });

  it("rejects plain Error", () => {
    expect(isAgentExecutionError(new Error("oops"))).toBe(false);
  });

  it("rejects object with wrong code", () => {
    expect(
      isAgentExecutionError({
        code: "not-a-valid-code",
        message: "x",
        taskId: "t",
        agent: "claude",
      })
    ).toBe(false);
  });

  it("rejects object with missing fields", () => {
    expect(isAgentExecutionError({ code: "session-failed" })).toBe(false);
  });
});

describe("isWebFlowError", () => {
  it("recognizes WebFlowError", () => {
    expect(isWebFlowError(new WebFlowError("x", "y"))).toBe(true);
  });

  it("recognizes subclasses", () => {
    expect(isWebFlowError(new RateLimitError("x"))).toBe(true);
  });

  it("rejects plain Error", () => {
    expect(isWebFlowError(new Error("oops"))).toBe(false);
  });
});

describe("normalizeError", () => {
  it("passes through WebFlowError", () => {
    const err = new WebFlowError("x", "y");
    expect(normalizeError(err)).toBe(err);
  });

  it("converts AgentExecutionError plain-object to AgentFailureError", () => {
    const plain = makeAgentExecutionError();
    const normalized = normalizeError(plain);
    expect(normalized).toBeInstanceOf(AgentFailureError);
    expect(normalized.code).toBe("agent-session-failed");
  });

  it("wraps native Error", () => {
    const err = new Error("boom");
    const normalized = normalizeError(err);
    expect(normalized).toBeInstanceOf(WebFlowError);
    expect(normalized.code).toBe("unknown");
    expect(normalized.message).toBe("boom");
    expect(normalized.cause).toBe(err);
  });

  it("wraps string", () => {
    const normalized = normalizeError("something broke");
    expect(normalized.code).toBe("unknown");
    expect(normalized.message).toBe("something broke");
  });

  it("wraps undefined", () => {
    const normalized = normalizeError(undefined);
    expect(normalized.code).toBe("unknown");
  });
});

describe("getUserMessage", () => {
  it("returns userMessage from WebFlowError", () => {
    const err = new WebFlowError("x", "internal", "User sees this");
    expect(getUserMessage(err)).toBe("User sees this");
  });

  it("returns generic message for plain Error", () => {
    const msg = getUserMessage(new Error("crash"));
    expect(msg).toContain("crash");
  });

  it("returns generic message for string", () => {
    const msg = getUserMessage("oops");
    expect(msg).toContain("oops");
  });
});
