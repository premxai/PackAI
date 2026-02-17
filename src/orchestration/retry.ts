import type { RetryConfig, SessionError } from "./types";

// ===========================================================================
// Retry utilities — pure functions, no VS Code dependency
// ===========================================================================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: true,
};

/** Merge partial config with defaults. */
export function resolveRetryConfig(
  partial?: Partial<RetryConfig>
): RetryConfig {
  return { ...DEFAULT_RETRY_CONFIG, ...partial };
}

/**
 * Compute exponential backoff delay for a given attempt.
 * With jitter, returns a random value between 0 and the clamped exponential.
 */
export function computeBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponential = config.baseDelayMs * Math.pow(2, attempt);
  const clamped = Math.min(exponential, config.maxDelayMs);
  if (!config.jitter) return clamped;
  return Math.floor(Math.random() * clamped);
}

/** Error codes that are worth retrying. */
const RETRYABLE_CODES = new Set([
  "rate_limited",
  "timeout",
  "transient",
  "model_busy",
  "network_error",
]);

/** Whether a session error is worth retrying. */
export function isRetryableError(error: SessionError): boolean {
  return RETRYABLE_CODES.has(error.code);
}

/**
 * Classify a raw error into a structured SessionError.
 * Handles LanguageModelError-shaped objects, plain Errors, and unknowns.
 */
export function classifyError(err: unknown): SessionError {
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    const message =
      "message" in err
        ? String((err as { message: unknown }).message)
        : "Unknown error";

    if (code.includes("rate") || message.includes("429")) {
      return { code: "rate_limited", message, retryable: true, originalError: err };
    }
    if (code.includes("off_topic")) {
      return { code: "off_topic", message, retryable: false, originalError: err };
    }
    if (code.includes("not_found") || message.includes("not available")) {
      return { code: "model_unavailable", message, retryable: false, originalError: err };
    }
    return { code: "lm_error", message, retryable: true, originalError: err };
  }

  if (err instanceof Error) {
    if (err.message.includes("cancelled") || err.message.includes("abort")) {
      return { code: "cancelled", message: err.message, retryable: false, originalError: err };
    }
    return { code: "unknown", message: err.message, retryable: true, originalError: err };
  }

  return { code: "unknown", message: String(err), retryable: true, originalError: err };
}

/** Promisified setTimeout. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
