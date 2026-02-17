import type { AgentRole } from "../intelligence/types";

// ===========================================================================
// Telemetry
//
// Opt-in telemetry reporter interface + no-op implementation + local
// error frequency tracker. No VS Code imports — fully testable.
// ===========================================================================

// ---------------------------------------------------------------------------
// Telemetry reporter interface
// ---------------------------------------------------------------------------

/** Event data sent to telemetry. */
export interface TelemetryEvent {
  readonly eventName: string;
  readonly properties?: Readonly<Record<string, string>>;
  readonly measurements?: Readonly<Record<string, number>>;
}

/** Abstract reporter — implemented by VsCodeTelemetryAdapter when enabled. */
export interface ITelemetryReporter {
  readonly isEnabled: boolean;

  /** Report an error occurrence (code only — no PII). */
  sendErrorEvent(code: string, properties?: Readonly<Record<string, string>>): void;

  /** Report a recovery attempt outcome. */
  sendRecoveryEvent(strategy: string, succeeded: boolean): void;

  /** Report an agent session outcome. */
  sendSessionEvent(agent: AgentRole, outcome: "success" | "failure" | "fallback"): void;

  dispose(): void;
}

// ---------------------------------------------------------------------------
// No-op implementation (default when telemetry is disabled)
// ---------------------------------------------------------------------------

/** Silent reporter — all methods are no-ops. */
export class NullTelemetryReporter implements ITelemetryReporter {
  readonly isEnabled = false;
  sendErrorEvent(): void { /* no-op */ }
  sendRecoveryEvent(): void { /* no-op */ }
  sendSessionEvent(): void { /* no-op */ }
  dispose(): void { /* no-op */ }
}

// ---------------------------------------------------------------------------
// Error frequency tracker (always local, never transmitted)
// ---------------------------------------------------------------------------

export interface ErrorFrequencyEntry {
  readonly code: string;
  count: number;
  readonly firstSeenAt: number;
  lastSeenAt: number;
}

/**
 * In-memory counter for error codes. Runs regardless of telemetry opt-in.
 * Powers local diagnostics and the dashboard's error summary view.
 */
export class ErrorFrequencyTracker {
  private readonly entries = new Map<string, ErrorFrequencyEntry>();

  /** Record an error occurrence. */
  record(code: string): void {
    const now = Date.now();
    const existing = this.entries.get(code);
    if (existing) {
      existing.count++;
      existing.lastSeenAt = now;
    } else {
      this.entries.set(code, {
        code,
        count: 1,
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
  }

  /** Get all tracked error frequencies. */
  getFrequencies(): readonly ErrorFrequencyEntry[] {
    return [...this.entries.values()];
  }

  /** Get the top N most frequent errors. */
  getMostFrequent(topN: number = 5): readonly ErrorFrequencyEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }

  /** Get the frequency entry for a specific code. */
  getEntry(code: string): ErrorFrequencyEntry | undefined {
    return this.entries.get(code);
  }

  /** Get total error count across all codes. */
  getTotalCount(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.count;
    }
    return total;
  }

  /** Reset all counters. */
  reset(): void {
    this.entries.clear();
  }
}
