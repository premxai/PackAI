import type {
  WebFlowSettings,
  AgentPreferencesSettings,
  ApprovalSettings,
  UiSettings,
  AdvancedSettings,
  AgentSelectionStrategy,
  CostOptimizationLevel,
  AgentTrustLevel,
  NotificationVerbosity,
  DashboardTheme,
  SettingsValidationError,
} from "./types";
import type { ToolType } from "../execution/toolApprover";

// ===========================================================================
// Settings Service
//
// Defaults, resolution (raw → typed), and validation.
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

// ---------------------------------------------------------------------------
// Valid value sets (used for validation)
// ---------------------------------------------------------------------------

const VALID_STRATEGIES: readonly AgentSelectionStrategy[] = [
  "intelligent", "roundRobin", "preferClaude", "preferCopilot", "preferCodex",
];

const VALID_COST_LEVELS: readonly CostOptimizationLevel[] = [
  "economy", "balanced", "performance",
];

const VALID_TRUST_LEVELS: readonly AgentTrustLevel[] = [
  "minimal", "standard", "elevated", "full",
];

const VALID_VERBOSITY: readonly NotificationVerbosity[] = [
  "silent", "minimal", "normal", "verbose",
];

const VALID_THEMES: readonly DashboardTheme[] = [
  "auto", "light", "dark",
];

const VALID_TOOL_TYPES: readonly ToolType[] = [
  "READ", "CREATE", "EDIT", "DELETE", "TERMINAL", "WEB_SEARCH",
];

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: WebFlowSettings = {
  agentPreferences: {
    selectionStrategy: "intelligent",
    costOptimizationLevel: "balanced",
    maxParallelSessions: 3,
  },
  approval: {
    autoApproveTools: ["READ", "WEB_SEARCH"],
    alwaysDenyTools: ["DELETE"],
    agentTrustLevels: {
      claude: "standard",
      copilot: "standard",
      codex: "standard",
    },
    devContainerMode: true,
    productionWorkspace: false,
  },
  ui: {
    autoOpenDashboard: true,
    notificationVerbosity: "normal",
    dashboardTheme: "auto",
    activityLogLimit: 100,
  },
  advanced: {
    customTemplatesDirectory: "",
    benchmarkDataPath: "",
    sessionTimeoutMs: 300_000,
    maxRetries: 3,
    retryBaseDelayMs: 1000,
    telemetryEnabled: false,
    gitCheckpointEnabled: true,
    stateCheckpointIntervalMs: 30_000,
  },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Resolves raw configuration values into typed {@link WebFlowSettings}.
 *
 * Invalid values are replaced with defaults (best-effort, never throws).
 * Also provides {@link DEFAULT_SETTINGS} for initial bootstrapping.
 */
export class SettingsService {
  /**
   * Resolve raw configuration values into a typed `WebFlowSettings` object.
   *
   * Invalid individual values are replaced with their defaults and a
   * validation error is recorded — best-effort behaviour that never throws.
   */
  resolve(raw: Readonly<Record<string, unknown>>): {
    readonly settings: WebFlowSettings;
    readonly errors: readonly SettingsValidationError[];
  } {
    const errors: SettingsValidationError[] = [];

    const agentPreferences = this.resolveAgentPreferences(raw, errors);
    const approval = this.resolveApproval(raw, errors);
    const ui = this.resolveUi(raw, errors);
    const advanced = this.resolveAdvanced(raw, errors);

    return { settings: { agentPreferences, approval, ui, advanced }, errors };
  }

  /** Validate a fully-resolved settings object. */
  validate(settings: WebFlowSettings): readonly SettingsValidationError[] {
    const errors: SettingsValidationError[] = [];
    this.validateAgentPreferences(settings.agentPreferences, errors);
    this.validateApproval(settings.approval, errors);
    this.validateUi(settings.ui, errors);
    this.validateAdvanced(settings.advanced, errors);
    return errors;
  }

  // -----------------------------------------------------------------------
  // Resolve helpers
  // -----------------------------------------------------------------------

  private resolveAgentPreferences(
    raw: Readonly<Record<string, unknown>>,
    errors: SettingsValidationError[]
  ): AgentPreferencesSettings {
    const d = DEFAULT_SETTINGS.agentPreferences;
    return {
      selectionStrategy: this.resolveEnum(
        raw["agentPreferences.selectionStrategy"],
        VALID_STRATEGIES,
        d.selectionStrategy,
        "agentPreferences.selectionStrategy",
        errors
      ),
      costOptimizationLevel: this.resolveEnum(
        raw["agentPreferences.costOptimizationLevel"],
        VALID_COST_LEVELS,
        d.costOptimizationLevel,
        "agentPreferences.costOptimizationLevel",
        errors
      ),
      maxParallelSessions: this.resolveInt(
        raw["agentPreferences.maxParallelSessions"],
        1, 10,
        d.maxParallelSessions,
        "agentPreferences.maxParallelSessions",
        errors
      ),
    };
  }

  private resolveApproval(
    raw: Readonly<Record<string, unknown>>,
    errors: SettingsValidationError[]
  ): ApprovalSettings {
    const d = DEFAULT_SETTINGS.approval;
    return {
      autoApproveTools: this.resolveToolArray(
        raw["approval.autoApproveTools"],
        d.autoApproveTools,
        "approval.autoApproveTools",
        errors
      ),
      alwaysDenyTools: this.resolveToolArray(
        raw["approval.alwaysDenyTools"],
        d.alwaysDenyTools,
        "approval.alwaysDenyTools",
        errors
      ),
      agentTrustLevels: this.resolveTrustLevels(
        raw["approval.agentTrustLevels"],
        d.agentTrustLevels,
        errors
      ),
      devContainerMode: this.resolveBool(
        raw["approval.devContainerMode"],
        d.devContainerMode
      ),
      productionWorkspace: this.resolveBool(
        raw["approval.productionWorkspace"],
        d.productionWorkspace
      ),
    };
  }

  private resolveUi(
    raw: Readonly<Record<string, unknown>>,
    errors: SettingsValidationError[]
  ): UiSettings {
    const d = DEFAULT_SETTINGS.ui;
    return {
      autoOpenDashboard: this.resolveBool(
        raw["ui.autoOpenDashboard"],
        d.autoOpenDashboard
      ),
      notificationVerbosity: this.resolveEnum(
        raw["ui.notificationVerbosity"],
        VALID_VERBOSITY,
        d.notificationVerbosity,
        "ui.notificationVerbosity",
        errors
      ),
      dashboardTheme: this.resolveEnum(
        raw["ui.dashboardTheme"],
        VALID_THEMES,
        d.dashboardTheme,
        "ui.dashboardTheme",
        errors
      ),
      activityLogLimit: this.resolveInt(
        raw["ui.activityLogLimit"],
        10, 500,
        d.activityLogLimit,
        "ui.activityLogLimit",
        errors
      ),
    };
  }

  private resolveAdvanced(
    raw: Readonly<Record<string, unknown>>,
    errors: SettingsValidationError[]
  ): AdvancedSettings {
    const d = DEFAULT_SETTINGS.advanced;
    return {
      customTemplatesDirectory: this.resolveString(
        raw["advanced.customTemplatesDirectory"],
        d.customTemplatesDirectory
      ),
      benchmarkDataPath: this.resolveString(
        raw["advanced.benchmarkDataPath"],
        d.benchmarkDataPath
      ),
      sessionTimeoutMs: this.resolveInt(
        raw["advanced.sessionTimeoutMs"],
        0, 3_600_000,
        d.sessionTimeoutMs,
        "advanced.sessionTimeoutMs",
        errors
      ),
      maxRetries: this.resolveInt(
        raw["advanced.maxRetries"],
        0, 10,
        d.maxRetries,
        "advanced.maxRetries",
        errors
      ),
      retryBaseDelayMs: this.resolveInt(
        raw["advanced.retryBaseDelayMs"],
        100, 60_000,
        d.retryBaseDelayMs,
        "advanced.retryBaseDelayMs",
        errors
      ),
      telemetryEnabled: this.resolveBool(
        raw["advanced.telemetryEnabled"],
        d.telemetryEnabled
      ),
      gitCheckpointEnabled: this.resolveBool(
        raw["advanced.gitCheckpointEnabled"],
        d.gitCheckpointEnabled
      ),
      stateCheckpointIntervalMs: this.resolveInt(
        raw["advanced.stateCheckpointIntervalMs"],
        5_000, 300_000,
        d.stateCheckpointIntervalMs,
        "advanced.stateCheckpointIntervalMs",
        errors
      ),
    };
  }

  // -----------------------------------------------------------------------
  // Primitive resolvers
  // -----------------------------------------------------------------------

  private resolveEnum<T extends string>(
    value: unknown,
    valid: readonly T[],
    fallback: T,
    field: string,
    errors: SettingsValidationError[]
  ): T {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string" && (valid as readonly string[]).includes(value)) {
      return value as T;
    }
    errors.push({
      field,
      message: `Invalid value "${String(value)}". Must be one of: ${valid.join(", ")}`,
    });
    return fallback;
  }

  private resolveInt(
    value: unknown,
    min: number,
    max: number,
    fallback: number,
    field: string,
    errors: SettingsValidationError[]
  ): number {
    if (value === undefined || value === null) return fallback;
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < min || num > max) {
      errors.push({
        field,
        message: `Invalid value "${String(value)}". Must be an integer between ${min} and ${max}`,
      });
      return fallback;
    }
    return num;
  }

  private resolveBool(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    return fallback;
  }

  private resolveString(value: unknown, fallback: string): string {
    if (typeof value === "string") return value;
    return fallback;
  }

  private resolveToolArray(
    value: unknown,
    fallback: readonly ToolType[],
    field: string,
    errors: SettingsValidationError[]
  ): readonly ToolType[] {
    if (!Array.isArray(value)) return fallback;
    const result: ToolType[] = [];
    for (const item of value) {
      if (typeof item === "string" && (VALID_TOOL_TYPES as readonly string[]).includes(item)) {
        result.push(item as ToolType);
      } else {
        errors.push({
          field,
          message: `Unknown tool type: "${String(item)}"`,
        });
      }
    }
    return result;
  }

  private resolveTrustLevels(
    value: unknown,
    fallback: Readonly<Record<string, AgentTrustLevel>>,
    errors: SettingsValidationError[]
  ): Readonly<Record<string, AgentTrustLevel>> {
    if (value === undefined || value === null || typeof value !== "object") {
      return { ...fallback };
    }
    const raw = value as Record<string, unknown>;
    const result: Record<string, AgentTrustLevel> = { ...fallback };
    for (const [agent, level] of Object.entries(raw)) {
      if (
        typeof level === "string" &&
        (VALID_TRUST_LEVELS as readonly string[]).includes(level)
      ) {
        result[agent] = level as AgentTrustLevel;
      } else {
        errors.push({
          field: `approval.agentTrustLevels.${agent}`,
          message: `Invalid trust level "${String(level)}". Must be one of: ${VALID_TRUST_LEVELS.join(", ")}`,
        });
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Validate helpers
  // -----------------------------------------------------------------------

  private validateAgentPreferences(
    s: AgentPreferencesSettings,
    errors: SettingsValidationError[]
  ): void {
    if (!(VALID_STRATEGIES as readonly string[]).includes(s.selectionStrategy)) {
      errors.push({
        field: "agentPreferences.selectionStrategy",
        message: `Must be one of: ${VALID_STRATEGIES.join(", ")}`,
      });
    }
    if (!(VALID_COST_LEVELS as readonly string[]).includes(s.costOptimizationLevel)) {
      errors.push({
        field: "agentPreferences.costOptimizationLevel",
        message: `Must be one of: ${VALID_COST_LEVELS.join(", ")}`,
      });
    }
    if (
      !Number.isInteger(s.maxParallelSessions) ||
      s.maxParallelSessions < 1 ||
      s.maxParallelSessions > 10
    ) {
      errors.push({
        field: "agentPreferences.maxParallelSessions",
        message: "Must be an integer between 1 and 10",
      });
    }
  }

  private validateApproval(
    s: ApprovalSettings,
    errors: SettingsValidationError[]
  ): void {
    for (const tool of s.autoApproveTools) {
      if (!(VALID_TOOL_TYPES as readonly string[]).includes(tool)) {
        errors.push({
          field: "approval.autoApproveTools",
          message: `Unknown tool type: "${tool}"`,
        });
      }
    }
    for (const tool of s.alwaysDenyTools) {
      if (!(VALID_TOOL_TYPES as readonly string[]).includes(tool)) {
        errors.push({
          field: "approval.alwaysDenyTools",
          message: `Unknown tool type: "${tool}"`,
        });
      }
    }
    const overlap = s.autoApproveTools.filter((t) =>
      s.alwaysDenyTools.includes(t)
    );
    if (overlap.length > 0) {
      errors.push({
        field: "approval",
        message: `Tool types in both auto-approve and deny lists: ${overlap.join(", ")}`,
      });
    }
    for (const [agent, level] of Object.entries(s.agentTrustLevels)) {
      if (!(VALID_TRUST_LEVELS as readonly string[]).includes(level)) {
        errors.push({
          field: `approval.agentTrustLevels.${agent}`,
          message: `Must be one of: ${VALID_TRUST_LEVELS.join(", ")}`,
        });
      }
    }
  }

  private validateUi(
    s: UiSettings,
    errors: SettingsValidationError[]
  ): void {
    if (!(VALID_VERBOSITY as readonly string[]).includes(s.notificationVerbosity)) {
      errors.push({
        field: "ui.notificationVerbosity",
        message: `Must be one of: ${VALID_VERBOSITY.join(", ")}`,
      });
    }
    if (!(VALID_THEMES as readonly string[]).includes(s.dashboardTheme)) {
      errors.push({
        field: "ui.dashboardTheme",
        message: `Must be one of: ${VALID_THEMES.join(", ")}`,
      });
    }
    if (
      !Number.isInteger(s.activityLogLimit) ||
      s.activityLogLimit < 10 ||
      s.activityLogLimit > 500
    ) {
      errors.push({
        field: "ui.activityLogLimit",
        message: "Must be an integer between 10 and 500",
      });
    }
  }

  private validateAdvanced(
    s: AdvancedSettings,
    errors: SettingsValidationError[]
  ): void {
    if (s.sessionTimeoutMs < 0 || s.sessionTimeoutMs > 3_600_000) {
      errors.push({
        field: "advanced.sessionTimeoutMs",
        message: "Must be between 0 and 3600000",
      });
    }
    if (
      !Number.isInteger(s.maxRetries) ||
      s.maxRetries < 0 ||
      s.maxRetries > 10
    ) {
      errors.push({
        field: "advanced.maxRetries",
        message: "Must be an integer between 0 and 10",
      });
    }
    if (s.retryBaseDelayMs < 100 || s.retryBaseDelayMs > 60_000) {
      errors.push({
        field: "advanced.retryBaseDelayMs",
        message: "Must be between 100 and 60000",
      });
    }
    if (
      !Number.isInteger(s.stateCheckpointIntervalMs) ||
      s.stateCheckpointIntervalMs < 5_000 ||
      s.stateCheckpointIntervalMs > 300_000
    ) {
      errors.push({
        field: "advanced.stateCheckpointIntervalMs",
        message: "Must be an integer between 5000 and 300000",
      });
    }
  }
}
