// Errors
export {
  PackAIError,
  AgentFailureError,
  AllAgentsExhaustedError,
  RateLimitError,
  GitOperationError,
  StatePersistenceError,
  ConflictEscalationError,
  isAgentExecutionError,
  isPackAIError,
  normalizeError,
  getUserMessage,
} from "./errors";

// Telemetry
export type { TelemetryEvent, ITelemetryReporter, ErrorFrequencyEntry } from "./telemetry";
export { NullTelemetryReporter, ErrorFrequencyTracker } from "./telemetry";

// Error recovery
export type {
  AgentFallbackConfig,
  RateLimitQueueConfig,
  IStateStore,
  GitLogEntry,
  IGitService,
} from "./errorRecovery";
export {
  AgentFallbackCoordinator,
  RateLimitQueue,
  ExecutionStateManager,
  NodeGitService,
} from "./errorRecovery";
