import { describe, it, expect } from "vitest";
import { SESSION_STATE_TO_CHAT_STATUS } from "./sessionViewAdapter";
import type { SessionState } from "./types";

describe("SESSION_STATE_TO_CHAT_STATUS", () => {
  it("maps 'pending' to 3 (NeedsInput)", () => {
    expect(SESSION_STATE_TO_CHAT_STATUS.pending).toBe(3);
  });

  it("maps 'running' to 2 (InProgress)", () => {
    expect(SESSION_STATE_TO_CHAT_STATUS.running).toBe(2);
  });

  it("maps 'paused' to 3 (NeedsInput)", () => {
    expect(SESSION_STATE_TO_CHAT_STATUS.paused).toBe(3);
  });

  it("maps 'completed' to 1 (Completed)", () => {
    expect(SESSION_STATE_TO_CHAT_STATUS.completed).toBe(1);
  });

  it("maps 'failed' to 0 (Failed)", () => {
    expect(SESSION_STATE_TO_CHAT_STATUS.failed).toBe(0);
  });

  it("maps 'cancelled' to 0 (Failed)", () => {
    expect(SESSION_STATE_TO_CHAT_STATUS.cancelled).toBe(0);
  });

  it("covers all 6 SessionState values", () => {
    const expectedStates: SessionState[] = [
      "pending",
      "running",
      "paused",
      "completed",
      "failed",
      "cancelled",
    ];
    const mappedStates = Object.keys(SESSION_STATE_TO_CHAT_STATUS);
    expect(mappedStates.sort()).toEqual(expectedStates.sort());
  });
});
