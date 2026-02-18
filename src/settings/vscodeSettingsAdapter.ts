import * as vscode from "vscode";
import { SettingsService } from "./settingsService";
import type { PackAISettings } from "./types";

// ===========================================================================
// VS Code Settings Adapter
//
// The only settings file that imports vscode. Reads/writes configuration
// via vscode.workspace.getConfiguration("packai").
// ===========================================================================

/** Abstraction over settings reading — enables testing without vscode. */
export interface ISettingsProvider {
  getSettings(): PackAISettings;
  onDidChangeSettings(
    listener: (settings: PackAISettings) => void
  ): { dispose(): void };
}

/**
 * Reads PackAI settings from VS Code's configuration API and validates
 * them via {@link SettingsService}. Emits change events when the user
 * modifies settings.
 */
export class VsCodeSettingsAdapter implements ISettingsProvider {
  private readonly service = new SettingsService();

  getSettings(): PackAISettings {
    const config = vscode.workspace.getConfiguration("packai");
    const raw: Record<string, unknown> = {};

    // Agent preferences
    raw["agentPreferences.selectionStrategy"] = config.get("agentPreferences.selectionStrategy");
    raw["agentPreferences.costOptimizationLevel"] = config.get("agentPreferences.costOptimizationLevel");
    raw["agentPreferences.maxParallelSessions"] = config.get("agentPreferences.maxParallelSessions");
    raw["agentPreferences.apiKeys"] = config.get("agentPreferences.apiKeys");

    // Approval
    raw["approval.autoApproveTools"] = config.get("approval.autoApproveTools");
    raw["approval.alwaysDenyTools"] = config.get("approval.alwaysDenyTools");
    raw["approval.agentTrustLevels"] = config.get("approval.agentTrustLevels");
    raw["approval.devContainerMode"] = config.get("approval.devContainerMode");
    // Support both nested and legacy flat key
    raw["approval.productionWorkspace"] =
      config.get("approval.productionWorkspace") ??
      config.get("productionWorkspace");

    // UI
    raw["ui.autoOpenDashboard"] = config.get("ui.autoOpenDashboard");
    raw["ui.notificationVerbosity"] = config.get("ui.notificationVerbosity");
    raw["ui.dashboardTheme"] = config.get("ui.dashboardTheme");
    raw["ui.activityLogLimit"] = config.get("ui.activityLogLimit");

    // Advanced
    raw["advanced.customTemplatesDirectory"] = config.get("advanced.customTemplatesDirectory");
    raw["advanced.benchmarkDataPath"] = config.get("advanced.benchmarkDataPath");
    raw["advanced.sessionTimeoutMs"] = config.get("advanced.sessionTimeoutMs");
    raw["advanced.maxRetries"] = config.get("advanced.maxRetries");
    raw["advanced.retryBaseDelayMs"] = config.get("advanced.retryBaseDelayMs");
    raw["advanced.telemetryEnabled"] = config.get("advanced.telemetryEnabled");
    raw["advanced.gitCheckpointEnabled"] = config.get("advanced.gitCheckpointEnabled");
    raw["advanced.stateCheckpointIntervalMs"] = config.get("advanced.stateCheckpointIntervalMs");

    const { settings } = this.service.resolve(raw);
    return settings;
  }

  onDidChangeSettings(
    listener: (settings: PackAISettings) => void
  ): { dispose(): void } {
    const disposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("packai")) {
        listener(this.getSettings());
      }
    });
    return { dispose: () => disposable.dispose() };
  }

  /** Write a single setting via VS Code's configuration API. */
  async updateSetting(
    key: string,
    value: unknown,
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("packai");
    await config.update(key, value, target);
  }
}
