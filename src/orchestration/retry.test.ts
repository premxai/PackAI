import { describe, it, expect, vi } from "vitest";
import {
  resolveRetryConfig,
  computeBackoffDelay,
  isRetryableError,
  classifyError,
  delay,
} from "./retry";
import type { RetryConfig, SessionError } from "./types";

// ===========================================================================
// retry.ts tests
// ===========================================================================

describe("retry utilities", () => {
  // -------------------------------------------------------------------------
  // resolveRetryConfig
  // -------------------------------------------------------------------------

  describe("resolveRetryConfig", () => {
    it("returns defaults when called with no argument", () => {
      const config = resolveRetryConfig();
      expect(config.maxRetries).toBe(3);
      expect(config.baseDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
      expect(config.jitter).toBe(true);
    });

    it("returns defaults when called with empty object", () => {
      const config = resolveRetryConfig({});
      expect(config.maxRetries).toBe(3);
    });

    it("overrides specified fields", () => {
      const config = resolveRetryConfig({ maxRetries: 5, jitter: false });
      expect(config.maxRetries).toBe(5);
      expect(config.jitter).toBe(false);
      // Non-overridden fields keep defaults
      expect(config.baseDelayMs).toBe(1000);
      expect(config.maxDelayMs).toBe(30000);
    });
  });

  // -------------------------------------------------------------------------
  // computeBackoffDelay
  // -------------------------------------------------------------------------

  describe("computeBackoffDelay", () => {
    const noJitter: RetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      jitter: false,
    };

    it("returns base delay for attempt 0 (no jitter)", () => {
      expect(computeBackoffDelay(0, noJitter)).toBe(1000);
    });

    it("doubles delay for each subsequent attempt (no jitter)", () => {
      expect(computeBackoffDelay(1, noJitter)).toBe(2000);
      expect(computeBackoffDelay(2, noJitter)).toBe(4000);
      expect(computeBackoffDelay(3, noJitter)).toBe(8000);
    });

    it("clamps at maxDelayMs (no jitter)", () => {
      const config: RetryConfig = { ...noJitter, maxDelayMs: 5000 };
      expect(computeBackoffDelay(10, config)).toBe(5000);
    });

    it("with jitter, returns value between 0 and clamped exponential", () => {
      const config: RetryConfig = { ...noJitter, jitter: true };
      // Run multiple times to check range
      for (let i = 0; i < 50; i++) {
        const d = computeBackoffDelay(2, config); // clamped = 4000
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(4000);
      }
    });
  });

  // -------------------------------------------------------------------------
  // isRetryableError
  // -------------------------------------------------------------------------

  describe("isRetryableError", () => {
    it("returns true for rate_limited", () => {
      expect(
        isRetryableError({ code: "rate_limited", message: "", retryable: true })
      ).toBe(true);
    });

    it("returns true for timeout", () => {
      expect(
        isRetryableError({ code: "timeout", message: "", retryable: true })
      ).toBe(true);
    });

    it("returns true for transient", () => {
      expect(
        isRetryableError({ code: "transient", message: "", retryable: true })
      ).toBe(true);
    });

    it("returns true for model_busy", () => {
      expect(
        isRetryableError({ code: "model_busy", message: "", retryable: true })
      ).toBe(true);
    });

    it("returns true for network_error", () => {
      expect(
        isRetryableError({ code: "network_error", message: "", retryable: true })
      ).toBe(true);
    });

    it("returns false for cancelled", () => {
      expect(
        isRetryableError({ code: "cancelled", message: "", retryable: false })
      ).toBe(false);
    });

    it("returns false for off_topic", () => {
      expect(
        isRetryableError({ code: "off_topic", message: "", retryable: false })
      ).toBe(false);
    });

    it("returns false for model_unavailable", () => {
      expect(
        isRetryableError({ code: "model_unavailable", message: "", retryable: false })
      ).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // classifyError
  // -------------------------------------------------------------------------

  describe("classifyError", () => {
    it("classifies rate limit error (code-based)", () => {
      const err = { code: "rate_limit_exceeded", message: "Too many requests" };
      const result = classifyError(err);
      expect(result.code).toBe("rate_limited");
      expect(result.retryable).toBe(true);
    });

    it("classifies rate limit error (message-based 429)", () => {
      const err = { code: "error", message: "HTTP 429 Too Many Requests" };
      const result = classifyError(err);
      expect(result.code).toBe("rate_limited");
      expect(result.retryable).toBe(true);
    });

    it("classifies off_topic error", () => {
      const err = { code: "off_topic", message: "Off topic" };
      const result = classifyError(err);
      expect(result.code).toBe("off_topic");
      expect(result.retryable).toBe(false);
    });

    it("classifies model not found error", () => {
      const err = { code: "not_found", message: "Model not found" };
      const result = classifyError(err);
      expect(result.code).toBe("model_unavailable");
      expect(result.retryable).toBe(false);
    });

    it("classifies model not available error (message-based)", () => {
      const err = { code: "error", message: "Model is not available" };
      const result = classifyError(err);
      expect(result.code).toBe("model_unavailable");
      expect(result.retryable).toBe(false);
    });

    it("classifies generic LM error", () => {
      const err = { code: "internal", message: "Something broke" };
      const result = classifyError(err);
      expect(result.code).toBe("lm_error");
      expect(result.retryable).toBe(true);
    });

    it("classifies cancelled Error", () => {
      const result = classifyError(new Error("Request was cancelled"));
      expect(result.code).toBe("cancelled");
      expect(result.retryable).toBe(false);
    });

    it("classifies abort Error", () => {
      const result = classifyError(new Error("abort signal triggered"));
      expect(result.code).toBe("cancelled");
      expect(result.retryable).toBe(false);
    });

    it("classifies generic Error as retryable", () => {
      const result = classifyError(new Error("Network failure"));
      expect(result.code).toBe("unknown");
      expect(result.retryable).toBe(true);
    });

    it("classifies string error", () => {
      const result = classifyError("something went wrong");
      expect(result.code).toBe("unknown");
      expect(result.message).toBe("something went wrong");
      expect(result.retryable).toBe(true);
    });

    it("preserves original error", () => {
      const original = new Error("test");
      const result = classifyError(original);
      expect(result.originalError).toBe(original);
    });
  });

  // -------------------------------------------------------------------------
  // delay
  // -------------------------------------------------------------------------

  describe("delay", () => {
    it("resolves after specified time", async () => {
      vi.useFakeTimers();
      const promise = delay(100);
      vi.advanceTimersByTime(100);
      await promise;
      vi.useRealTimers();
    });
  });
});
