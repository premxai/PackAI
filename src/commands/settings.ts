import * as vscode from "vscode";
import type { CommandDeps } from "./index";
import { normalizeError, getUserMessage } from "../utils";

// ===========================================================================
// Settings Commands
//
// Quick-pick shortcuts for configuring agent preferences, approval rules,
// and resetting settings to defaults.
// ===========================================================================

export function registerSettingsCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("packai.configureAgents", () =>
      configureAgents(deps)
    ),
    vscode.commands.registerCommand("packai.configureApproval", () =>
      configureApproval(deps)
    ),
    vscode.commands.registerCommand("packai.resetSettings", () =>
      resetSettings(deps)
    )
  );
}

// ---------------------------------------------------------------------------
// Configure agent preferences
// ---------------------------------------------------------------------------

async function configureAgents(deps: CommandDeps): Promise<void> {
  const { settingsAdapter, logger } = deps;

  try {
    const current = settingsAdapter.getSettings();

    // Selection strategy
    const strategies = [
      { label: "Intelligent", description: "AI selects the best agent per task", value: "intelligent" },
      { label: "Round Robin", description: "Rotate between agents equally", value: "roundRobin" },
      { label: "Prefer Claude", description: "Use Claude for most tasks", value: "preferClaude" },
      { label: "Prefer Copilot", description: "Use Copilot for most tasks", value: "preferCopilot" },
      { label: "Prefer Codex", description: "Use Codex for most tasks", value: "preferCodex" },
    ];

    const currentStrategy = strategies.find(
      (s) => s.value === current.agentPreferences.selectionStrategy
    );

    const pickedStrategy = await vscode.window.showQuickPick(strategies, {
      placeHolder: `Current: ${currentStrategy?.label ?? current.agentPreferences.selectionStrategy}`,
      title: "PackAI: Agent Selection Strategy",
    });

    if (pickedStrategy) {
      await settingsAdapter.updateSetting(
        "agentPreferences.selectionStrategy",
        pickedStrategy.value
      );
      logger.info(`Selection strategy updated to: ${pickedStrategy.value}`);
    }

    // Cost optimization
    const costLevels = [
      { label: "Economy", description: "Minimize cost, use smaller models", value: "economy" },
      { label: "Balanced", description: "Balance cost and quality", value: "balanced" },
      { label: "Performance", description: "Maximize quality, regardless of cost", value: "performance" },
    ];

    const pickedCost = await vscode.window.showQuickPick(costLevels, {
      placeHolder: `Current: ${current.agentPreferences.costOptimizationLevel}`,
      title: "PackAI: Cost Optimization Level",
    });

    if (pickedCost) {
      await settingsAdapter.updateSetting(
        "agentPreferences.costOptimizationLevel",
        pickedCost.value
      );
      logger.info(`Cost optimization updated to: ${pickedCost.value}`);
    }

    void vscode.window.showInformationMessage("PackAI: Agent preferences updated.");
  } catch (err) {
    handleCommandError("configureAgents", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Configure approval rules
// ---------------------------------------------------------------------------

async function configureApproval(deps: CommandDeps): Promise<void> {
  const { settingsAdapter, logger } = deps;

  try {
    const current = settingsAdapter.getSettings();

    // Trust level per agent
    const agents = ["claude", "copilot", "codex"] as const;
    const trustLevels = ["minimal", "standard", "elevated", "full"];

    for (const agent of agents) {
      const currentLevel = current.approval.agentTrustLevels[agent];
      const items = trustLevels.map((level) => ({
        label: level.charAt(0).toUpperCase() + level.slice(1),
        description: level === currentLevel ? "(current)" : undefined,
        value: level,
      }));

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: `Trust level for ${agent} (current: ${currentLevel})`,
        title: `PackAI: ${agent.charAt(0).toUpperCase() + agent.slice(1)} Trust Level`,
      });

      if (picked) {
        const levels = { ...current.approval.agentTrustLevels, [agent]: picked.value };
        await settingsAdapter.updateSetting("approval.agentTrustLevels", levels);
        logger.info(`Trust level for ${agent} updated to: ${picked.value}`);
      }
    }

    void vscode.window.showInformationMessage("PackAI: Approval rules updated.");
  } catch (err) {
    handleCommandError("configureApproval", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Reset settings to defaults
// ---------------------------------------------------------------------------

async function resetSettings(deps: CommandDeps): Promise<void> {
  const { logger } = deps;

  try {
    const confirm = await vscode.window.showWarningMessage(
      "Reset all PackAI settings to defaults? This cannot be undone.",
      { modal: true },
      "Reset All"
    );

    if (confirm !== "Reset All") return;

    const config = vscode.workspace.getConfiguration("packai");

    // Reset each section by setting to undefined (removes user overrides)
    const sections = [
      "agentPreferences.selectionStrategy",
      "agentPreferences.costOptimizationLevel",
      "agentPreferences.maxParallelSessions",
      "agentPreferences.apiKeys",
      "approval.autoApproveTools",
      "approval.alwaysDenyTools",
      "approval.agentTrustLevels",
      "approval.devContainerMode",
      "approval.productionWorkspace",
      "ui.autoOpenDashboard",
      "ui.notificationVerbosity",
      "ui.dashboardTheme",
      "ui.activityLogLimit",
      "advanced.customTemplatesDirectory",
      "advanced.benchmarkDataPath",
      "advanced.sessionTimeoutMs",
      "advanced.maxRetries",
      "advanced.retryBaseDelayMs",
      "advanced.telemetryEnabled",
      "advanced.gitCheckpointEnabled",
      "advanced.stateCheckpointIntervalMs",
    ];

    for (const key of sections) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }

    logger.info("All settings reset to defaults");
    void vscode.window.showInformationMessage("PackAI: All settings reset to defaults.");
  } catch (err) {
    handleCommandError("resetSettings", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Shared error handler
// ---------------------------------------------------------------------------

function handleCommandError(
  command: string,
  err: unknown,
  deps: CommandDeps
): void {
  const normalized = normalizeError(err);
  deps.logger.error(`[${command}] ${normalized.code}: ${normalized.message}`);
  void vscode.window.showErrorMessage(getUserMessage(err));
}
