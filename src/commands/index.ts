import * as vscode from "vscode";
import type { SessionManager } from "../orchestration/sessionManager";
import type { DashboardProvider } from "../ui/dashboardProvider";
import type { VsCodeSettingsAdapter } from "../settings/vscodeSettingsAdapter";
import type { ExecutionStateManager } from "../utils/errorRecovery";
import type { ExecutionPlan } from "../intelligence/types";
import { registerStartProjectCommand } from "./startProject";
import { registerOrchestrationCommands } from "./manageOrchestration";
import { registerTemplateCommands } from "./templates";
import { registerSettingsCommands } from "./settings";

// ===========================================================================
// Command Registration
//
// Aggregates all command modules into a single registration entry point.
// Called from extension.ts activate().
// ===========================================================================

/** Shared dependencies injected into every command module. */
export interface CommandDeps {
  readonly sessionManager: SessionManager;
  readonly dashboardProvider: DashboardProvider;
  readonly settingsAdapter: VsCodeSettingsAdapter;
  readonly stateManager: ExecutionStateManager;
  readonly logger: vscode.LogOutputChannel;
  /** Mutable reference so commands can read/write the current plan. */
  currentPlan: ExecutionPlan | null;
}

/** Register all PackAI commands on the extension context. */
export function registerAllCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  registerStartProjectCommand(context, deps);
  registerOrchestrationCommands(context, deps);
  registerTemplateCommands(context, deps);
  registerSettingsCommands(context, deps);
}
