import type { AgentRole } from "../intelligence/types";
import type { ToolType } from "../execution/toolApprover";

// ===========================================================================
// PackAI Settings Types
//
// Pure type definitions — no VS Code imports. Fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Agent Preferences
// ---------------------------------------------------------------------------

/** How the orchestrator picks agents when multiple could handle a task. */
export type AgentSelectionStrategy =
  | "intelligent"
  | "roundRobin"
  | "preferClaude"
  | "preferCopilot"
  | "preferCodex";

/** Cost-vs-quality tradeoff for model selection. */
export type CostOptimizationLevel = "economy" | "balanced" | "performance";

export interface AgentApiKeys {
  readonly claude: string;
  readonly copilot: string;
  readonly codex: string;
}

export interface AgentPreferencesSettings {
  /** Which selection strategy the orchestrator uses. */
  readonly selectionStrategy: AgentSelectionStrategy;
  /** Cost/quality tradeoff. */
  readonly costOptimizationLevel: CostOptimizationLevel;
  /** Maximum parallel agent sessions (1–10). */
  readonly maxParallelSessions: number;
  readonly apiKeys: AgentApiKeys;
}

// ---------------------------------------------------------------------------
// Approval Settings
// ---------------------------------------------------------------------------

/** Per-agent trust level. Higher trust = fewer approval interruptions. */
export type AgentTrustLevel = "minimal" | "standard" | "elevated" | "full";

export interface ApprovalSettings {
  /** Tool types to always auto-approve without rule evaluation. */
  readonly autoApproveTools: readonly ToolType[];
  /** Tool types to always require manual confirmation. */
  readonly alwaysDenyTools: readonly ToolType[];
  /** Per-agent trust level. */
  readonly agentTrustLevels: Readonly<Record<AgentRole, AgentTrustLevel>>;
  /** Whether dev container environment activates permissive mode. */
  readonly devContainerMode: boolean;
  /** Whether workspace is production (restrictive mode). */
  readonly productionWorkspace: boolean;
}

// ---------------------------------------------------------------------------
// UI Preferences
// ---------------------------------------------------------------------------

/** How chatty the extension is with VS Code notifications. */
export type NotificationVerbosity = "silent" | "minimal" | "normal" | "verbose";

/** Dashboard color theme override. */
export type DashboardTheme = "auto" | "light" | "dark";

export interface UiSettings {
  /** Auto-open dashboard when a workflow starts. */
  readonly autoOpenDashboard: boolean;
  /** Notification verbosity level. */
  readonly notificationVerbosity: NotificationVerbosity;
  /** Dashboard color theme. */
  readonly dashboardTheme: DashboardTheme;
  /** Maximum activity log entries displayed (10–500). */
  readonly activityLogLimit: number;
}

// ---------------------------------------------------------------------------
// Advanced Settings
// ---------------------------------------------------------------------------

export interface AdvancedSettings {
  /** Path to custom workflow templates directory. Empty = use built-ins. */
  readonly customTemplatesDirectory: string;
  /** Path to benchmark data JSON. Empty = default .packai/benchmarks.json. */
  readonly benchmarkDataPath: string;
  /** Session timeout in ms. 0 = no timeout. */
  readonly sessionTimeoutMs: number;
  /** Max retries on session failure (0–10). */
  readonly maxRetries: number;
  /** Base retry delay in ms (100–60000). */
  readonly retryBaseDelayMs: number;
  /** Whether opt-in telemetry is enabled (error frequency only). */
  readonly telemetryEnabled: boolean;
  /** Whether to auto-commit a git checkpoint after each phase. */
  readonly gitCheckpointEnabled: boolean;
  /** How often (ms) to auto-save execution state (5000–300000). */
  readonly stateCheckpointIntervalMs: number;
}

// ---------------------------------------------------------------------------
// Root settings shape
// ---------------------------------------------------------------------------

export interface PackAISettings {
  readonly agentPreferences: AgentPreferencesSettings;
  readonly approval: ApprovalSettings;
  readonly ui: UiSettings;
  readonly advanced: AdvancedSettings;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface SettingsValidationError {
  readonly field: string;
  readonly message: string;
}
