import { describe, it, expect } from "vitest";
import { SettingsService, DEFAULT_SETTINGS } from "./settingsService";
import type { WebFlowSettings, SettingsValidationError } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSettings(overrides: Record<string, unknown> = {}): WebFlowSettings {
  const service = new SettingsService();
  return service.resolve(overrides).settings;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SettingsService", () => {
  const service = new SettingsService();

  // ---- resolve() ----

  describe("resolve", () => {
    it("returns defaults when given empty raw config", () => {
      const { settings, errors } = service.resolve({});

      expect(errors).toHaveLength(0);
      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it("merges a single override without disturbing other defaults", () => {
      const { settings } = service.resolve({
        "agentPreferences.selectionStrategy": "roundRobin",
      });

      expect(settings.agentPreferences.selectionStrategy).toBe("roundRobin");
      expect(settings.agentPreferences.costOptimizationLevel).toBe("balanced");
      expect(settings.approval).toEqual(DEFAULT_SETTINGS.approval);
    });

    it("falls back to default for invalid enum and records error", () => {
      const { settings, errors } = service.resolve({
        "agentPreferences.selectionStrategy": "invalid",
      });

      expect(settings.agentPreferences.selectionStrategy).toBe("intelligent");
      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("agentPreferences.selectionStrategy");
    });

    it("handles undefined values gracefully", () => {
      const { settings, errors } = service.resolve({
        "agentPreferences.selectionStrategy": undefined,
        "ui.autoOpenDashboard": undefined,
      });

      expect(errors).toHaveLength(0);
      expect(settings.agentPreferences.selectionStrategy).toBe("intelligent");
      expect(settings.ui.autoOpenDashboard).toBe(true);
    });

    it("resolves valid integer within range", () => {
      const { settings, errors } = service.resolve({
        "agentPreferences.maxParallelSessions": 7,
      });

      expect(errors).toHaveLength(0);
      expect(settings.agentPreferences.maxParallelSessions).toBe(7);
    });

    it("falls back for integer out of range", () => {
      const { settings, errors } = service.resolve({
        "agentPreferences.maxParallelSessions": 99,
      });

      expect(settings.agentPreferences.maxParallelSessions).toBe(3);
      expect(errors).toHaveLength(1);
    });

    it("resolves boolean values", () => {
      const { settings } = service.resolve({
        "approval.devContainerMode": false,
        "approval.productionWorkspace": true,
      });

      expect(settings.approval.devContainerMode).toBe(false);
      expect(settings.approval.productionWorkspace).toBe(true);
    });

    it("resolves string values", () => {
      const { settings } = service.resolve({
        "advanced.customTemplatesDirectory": "/my/templates",
      });

      expect(settings.advanced.customTemplatesDirectory).toBe("/my/templates");
    });

    it("resolves valid tool type arrays", () => {
      const { settings, errors } = service.resolve({
        "approval.autoApproveTools": ["READ", "CREATE", "EDIT"],
      });

      expect(errors).toHaveLength(0);
      expect(settings.approval.autoApproveTools).toEqual(["READ", "CREATE", "EDIT"]);
    });

    it("filters invalid tool types and records errors", () => {
      const { settings, errors } = service.resolve({
        "approval.autoApproveTools": ["READ", "INVALID_TOOL"],
      });

      expect(settings.approval.autoApproveTools).toEqual(["READ"]);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain("INVALID_TOOL");
    });

    it("resolves agent trust levels with overrides", () => {
      const { settings, errors } = service.resolve({
        "approval.agentTrustLevels": { claude: "elevated", copilot: "full" },
      });

      expect(errors).toHaveLength(0);
      expect(settings.approval.agentTrustLevels.claude).toBe("elevated");
      expect(settings.approval.agentTrustLevels.copilot).toBe("full");
      expect(settings.approval.agentTrustLevels.codex).toBe("standard");
    });

    it("records error for invalid trust level", () => {
      const { settings, errors } = service.resolve({
        "approval.agentTrustLevels": { claude: "superpower" },
      });

      expect(errors).toHaveLength(1);
      expect(errors[0]!.field).toBe("approval.agentTrustLevels.claude");
      expect(settings.approval.agentTrustLevels.claude).toBe("standard");
    });

    it("resolves all cost optimization levels", () => {
      for (const level of ["economy", "balanced", "performance"] as const) {
        const { settings, errors } = service.resolve({
          "agentPreferences.costOptimizationLevel": level,
        });
        expect(errors).toHaveLength(0);
        expect(settings.agentPreferences.costOptimizationLevel).toBe(level);
      }
    });

    it("resolves all notification verbosity levels", () => {
      for (const level of ["silent", "minimal", "normal", "verbose"] as const) {
        const { settings, errors } = service.resolve({
          "ui.notificationVerbosity": level,
        });
        expect(errors).toHaveLength(0);
        expect(settings.ui.notificationVerbosity).toBe(level);
      }
    });

    it("resolves all dashboard themes", () => {
      for (const theme of ["auto", "light", "dark"] as const) {
        const { settings, errors } = service.resolve({
          "ui.dashboardTheme": theme,
        });
        expect(errors).toHaveLength(0);
        expect(settings.ui.dashboardTheme).toBe(theme);
      }
    });
  });

  // ---- validate() ----

  describe("validate", () => {
    it("returns no errors for DEFAULT_SETTINGS", () => {
      expect(service.validate(DEFAULT_SETTINGS)).toHaveLength(0);
    });

    it("rejects invalid selectionStrategy", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, selectionStrategy: "bad" as never },
      });
      expect(errors.some((e) => e.field === "agentPreferences.selectionStrategy")).toBe(true);
    });

    it("rejects invalid costOptimizationLevel", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, costOptimizationLevel: "turbo" as never },
      });
      expect(errors.some((e) => e.field === "agentPreferences.costOptimizationLevel")).toBe(true);
    });

    it("rejects maxParallelSessions below 1", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, maxParallelSessions: 0 },
      });
      expect(errors.some((e) => e.field === "agentPreferences.maxParallelSessions")).toBe(true);
    });

    it("rejects maxParallelSessions above 10", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, maxParallelSessions: 11 },
      });
      expect(errors.some((e) => e.field === "agentPreferences.maxParallelSessions")).toBe(true);
    });

    it("rejects non-integer maxParallelSessions", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, maxParallelSessions: 3.5 },
      });
      expect(errors.some((e) => e.field === "agentPreferences.maxParallelSessions")).toBe(true);
    });

    it("rejects overlapping auto-approve and deny lists", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        approval: {
          ...s.approval,
          autoApproveTools: ["READ", "DELETE"],
          alwaysDenyTools: ["DELETE"],
        },
      });
      expect(errors.some((e) => e.field === "approval" && e.message.includes("DELETE"))).toBe(true);
    });

    it("rejects invalid agentTrustLevel", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        approval: {
          ...s.approval,
          agentTrustLevels: { claude: "mega" as never, copilot: "standard", codex: "standard" },
        },
      });
      expect(errors.some((e) => e.field.includes("agentTrustLevels"))).toBe(true);
    });

    it("rejects invalid notificationVerbosity", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        ui: { ...s.ui, notificationVerbosity: "deafening" as never },
      });
      expect(errors.some((e) => e.field === "ui.notificationVerbosity")).toBe(true);
    });

    it("rejects invalid dashboardTheme", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        ui: { ...s.ui, dashboardTheme: "neon" as never },
      });
      expect(errors.some((e) => e.field === "ui.dashboardTheme")).toBe(true);
    });

    it("rejects activityLogLimit below 10", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        ui: { ...s.ui, activityLogLimit: 5 },
      });
      expect(errors.some((e) => e.field === "ui.activityLogLimit")).toBe(true);
    });

    it("rejects activityLogLimit above 500", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        ui: { ...s.ui, activityLogLimit: 999 },
      });
      expect(errors.some((e) => e.field === "ui.activityLogLimit")).toBe(true);
    });

    it("rejects negative sessionTimeoutMs", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        advanced: { ...s.advanced, sessionTimeoutMs: -1 },
      });
      expect(errors.some((e) => e.field === "advanced.sessionTimeoutMs")).toBe(true);
    });

    it("rejects maxRetries above 10", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        advanced: { ...s.advanced, maxRetries: 11 },
      });
      expect(errors.some((e) => e.field === "advanced.maxRetries")).toBe(true);
    });

    it("rejects retryBaseDelayMs below 100", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        advanced: { ...s.advanced, retryBaseDelayMs: 50 },
      });
      expect(errors.some((e) => e.field === "advanced.retryBaseDelayMs")).toBe(true);
    });

    it("rejects retryBaseDelayMs above 60000", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        advanced: { ...s.advanced, retryBaseDelayMs: 100_000 },
      });
      expect(errors.some((e) => e.field === "advanced.retryBaseDelayMs")).toBe(true);
    });

    it("accepts valid edge-case values", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, maxParallelSessions: 1 },
        ui: { ...s.ui, activityLogLimit: 10 },
        advanced: {
          ...s.advanced,
          sessionTimeoutMs: 0,
          maxRetries: 0,
          retryBaseDelayMs: 100,
        },
      });
      expect(errors).toHaveLength(0);
    });

    it("accepts max edge-case values", () => {
      const s = makeSettings();
      const errors = service.validate({
        ...s,
        agentPreferences: { ...s.agentPreferences, maxParallelSessions: 10 },
        ui: { ...s.ui, activityLogLimit: 500 },
        advanced: {
          ...s.advanced,
          sessionTimeoutMs: 3_600_000,
          maxRetries: 10,
          retryBaseDelayMs: 60_000,
        },
      });
      expect(errors).toHaveLength(0);
    });
  });
});
