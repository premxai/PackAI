import { describe, it, expect, beforeEach, vi } from "vitest";
import { NullTelemetryReporter, ErrorFrequencyTracker } from "./telemetry";

describe("NullTelemetryReporter", () => {
  const reporter = new NullTelemetryReporter();

  it("isEnabled is false", () => {
    expect(reporter.isEnabled).toBe(false);
  });

  it("sendErrorEvent does not throw", () => {
    expect(() => reporter.sendErrorEvent("test-code")).not.toThrow();
  });

  it("sendRecoveryEvent does not throw", () => {
    expect(() => reporter.sendRecoveryEvent("agent-fallback", true)).not.toThrow();
  });

  it("sendSessionEvent does not throw", () => {
    expect(() => reporter.sendSessionEvent("claude", "success")).not.toThrow();
  });

  it("dispose does not throw", () => {
    expect(() => reporter.dispose()).not.toThrow();
  });
});

describe("ErrorFrequencyTracker", () => {
  let tracker: ErrorFrequencyTracker;

  beforeEach(() => {
    tracker = new ErrorFrequencyTracker();
  });

  it("starts empty", () => {
    expect(tracker.getFrequencies()).toHaveLength(0);
    expect(tracker.getTotalCount()).toBe(0);
  });

  it("records first occurrence with count 1", () => {
    tracker.record("rate-limit");
    const entry = tracker.getEntry("rate-limit");
    expect(entry).toBeDefined();
    expect(entry!.count).toBe(1);
    expect(entry!.firstSeenAt).toBeGreaterThan(0);
  });

  it("increments count on subsequent records", () => {
    tracker.record("timeout");
    tracker.record("timeout");
    tracker.record("timeout");
    expect(tracker.getEntry("timeout")!.count).toBe(3);
  });

  it("tracks multiple codes independently", () => {
    tracker.record("timeout");
    tracker.record("rate-limit");
    tracker.record("timeout");
    expect(tracker.getEntry("timeout")!.count).toBe(2);
    expect(tracker.getEntry("rate-limit")!.count).toBe(1);
    expect(tracker.getTotalCount()).toBe(3);
  });

  it("returns undefined for unknown code", () => {
    expect(tracker.getEntry("nonexistent")).toBeUndefined();
  });

  it("getMostFrequent returns sorted by count descending", () => {
    tracker.record("a");
    tracker.record("b");
    tracker.record("b");
    tracker.record("c");
    tracker.record("c");
    tracker.record("c");

    const top = tracker.getMostFrequent(2);
    expect(top).toHaveLength(2);
    expect(top[0]!.code).toBe("c");
    expect(top[0]!.count).toBe(3);
    expect(top[1]!.code).toBe("b");
    expect(top[1]!.count).toBe(2);
  });

  it("getMostFrequent(1) returns single highest entry", () => {
    tracker.record("x");
    tracker.record("y");
    tracker.record("y");
    const top = tracker.getMostFrequent(1);
    expect(top).toHaveLength(1);
    expect(top[0]!.code).toBe("y");
  });

  it("updates lastSeenAt on repeated records", () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    tracker.record("err");
    const first = tracker.getEntry("err")!;
    expect(first.firstSeenAt).toBe(t0);

    vi.advanceTimersByTime(1000);
    tracker.record("err");
    const updated = tracker.getEntry("err")!;
    expect(updated.firstSeenAt).toBe(t0);
    expect(updated.lastSeenAt).toBe(t0 + 1000);
    vi.useRealTimers();
  });

  it("reset clears all entries", () => {
    tracker.record("a");
    tracker.record("b");
    tracker.reset();
    expect(tracker.getFrequencies()).toHaveLength(0);
    expect(tracker.getTotalCount()).toBe(0);
  });

  it("getFrequencies returns all entries", () => {
    tracker.record("a");
    tracker.record("b");
    const all = tracker.getFrequencies();
    expect(all).toHaveLength(2);
    expect(all.map((e) => e.code).sort()).toEqual(["a", "b"]);
  });
});
