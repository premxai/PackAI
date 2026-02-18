import * as vscode from "vscode";
import { analyzeIntent, WorkflowGenerator, AgentSelector } from "../intelligence";
import type { AgentRole } from "../intelligence/types";
import type { CommandDeps } from "./index";
import { normalizeError, getUserMessage } from "../utils";
import { ExecutionEngine } from "../orchestration/executionEngine";
import { AgentFactory } from "../execution/agents/agentFactory";
import {
  DependencyResolver,
  ContextCoordinator,
  VsCodeEventEmitterFactory,
} from "../orchestration";
import { QualityGateRunner } from "../execution/qualityGates";
import { CodeWriter } from "../orchestration/codeWriter";
import { VsCodeFileWriter } from "../orchestration/vscodeFileWriter";
import { AgentFallbackCoordinator } from "../utils/errorRecovery";

// ===========================================================================
// Start Project Command
//
// Shows a quick-pick for project type selection, analyzes intent, generates
// an execution plan, assigns agents, and feeds the plan to the dashboard.
// ===========================================================================

const PROJECT_TYPES: vscode.QuickPickItem[] = [
  { label: "$(shopping-cart) E-commerce Store", description: "Online store with products, cart, checkout" },
  { label: "$(browser) Landing Page", description: "Marketing or product landing page" },
  { label: "$(dashboard) SaaS Dashboard", description: "Admin dashboard with data visualizations" },
  { label: "$(book) Blog / Content Site", description: "Blog or content-driven website" },
  { label: "$(edit) Custom Project", description: "Describe your project in your own words" },
];

export function registerStartProjectCommand(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("packai.startProject", () => startProject(deps))
  );
}

async function startProject(deps: CommandDeps): Promise<void> {
  const { logger, dashboardProvider, settingsAdapter } = deps;
  logger.info("Start Project command invoked");

  // Verify workspace
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) {
    void vscode.window.showWarningMessage(
      "PackAI: Open a folder or workspace first."
    );
    return;
  }

  // Pick project type
  const picked = await vscode.window.showQuickPick(PROJECT_TYPES, {
    placeHolder: "What kind of project do you want to build?",
    title: "PackAI: Start Project",
  });

  if (!picked) return; // user cancelled

  let description: string;

  if (picked.label.includes("Custom Project")) {
    const input = await vscode.window.showInputBox({
      prompt: "Describe your project",
      placeHolder: "e.g., Build a recipe sharing app with user accounts and image uploads",
      validateInput: (v) => (v.trim().length < 5 ? "Please provide more detail" : undefined),
    });
    if (!input) return;
    description = input;
  } else {
    // Map label to a natural language description
    const label = picked.label.replace(/\$\([^)]+\)\s*/g, "");
    description = `Build a ${label}`;
  }

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "PackAI: Generating execution plan...",
        cancellable: false,
      },
      async (progress) => {
        // 1. Analyze intent
        progress.report({ message: "Analyzing requirements...", increment: 20 });
        const intent = analyzeIntent(description);
        logger.info(
          `Intent: type=${intent.projectType} (${intent.projectTypeConfidence}), ` +
            `complexity=${intent.complexity}, features=[${intent.features.join(", ")}]`
        );

        // 2. Generate plan
        progress.report({ message: "Generating execution plan...", increment: 30 });
        const generator = new WorkflowGenerator();
        const plan = generator.generate(intent);

        // 3. Assign agents
        progress.report({ message: "Selecting optimal agents...", increment: 30 });
        const selector = new AgentSelector();
        for (const phase of plan.phases) {
          for (const task of phase.tasks) {
            const rec = selector.recommend(task);
            (task as { agent: AgentRole }).agent = rec.agent;
          }
        }

        logger.info(
          `Plan: "${plan.templateName}", ${plan.phases.length} phases, ` +
            `${plan.stats.totalTasks} tasks, ~${plan.estimatedTotalMinutes}min`
        );

        // 4. Store plan and feed to dashboard
        deps.currentPlan = plan;
        dashboardProvider.setExecutionPlan(plan);

        progress.report({ message: "Launching execution...", increment: 10 });

        // 5. Auto-open dashboard
        const settings = settingsAdapter.getSettings();
        if (settings.ui.autoOpenDashboard) {
          await vscode.commands.executeCommand("packai.dashboardView.focus");
        }

        // 6. Create and launch execution engine
        const workspaceRoot = root.uri.fsPath;
        const agentFactory = new AgentFactory(deps.sessionManager);
        const engine = new ExecutionEngine(
          {
            workspaceRoot,
            maxQualityRetries: settings.advanced.maxRetries,
            continueOnTaskFailure: true,
            enableCheckpoints: settings.advanced.gitCheckpointEnabled,
          },
          {
            agentFactory,
            dependencyResolver: new DependencyResolver(),
            contextCoordinator: new ContextCoordinator(),
            qualityGateRunner: new QualityGateRunner(),
            codeWriter: new CodeWriter(new VsCodeFileWriter()),
            stateManager: deps.stateManager,
            fallbackCoordinator: new AgentFallbackCoordinator(agentFactory),
            emitterFactory: new VsCodeEventEmitterFactory(),
            logger: { info: (m) => logger.info(m), error: (m) => logger.error(m) },
          }
        );

        deps.executionEngine = engine;

        // Wire engine phase events to dashboard refresh
        engine.onPhaseComplete.event(({ phaseId, status }) => {
          const phase = plan.phases.find((p) => p.id === phaseId);
          if (phase) phase.status = status;
          dashboardProvider.setExecutionPlan(plan);
        });

        progress.report({ message: "Done!", increment: 10 });

        void vscode.window.showInformationMessage(
          `PackAI: Executing ${plan.stats.totalTasks} tasks across ${plan.phases.length} phases...`
        );

        // Fire-and-forget — execution runs in background, dashboard shows progress
        engine.execute(plan).then((summary) => {
          logger.info(
            `Execution complete: ${summary.tasksCompleted} succeeded, ` +
              `${summary.tasksFailed} failed, ${summary.tasksSkipped} skipped`
          );
          void vscode.window.showInformationMessage(
            `PackAI: Done — ${summary.tasksCompleted}/${summary.taskResults.length} tasks succeeded. ` +
              `${summary.filesWritten.length} files written.`
          );
          deps.executionEngine = null;
        }).catch((err) => {
          logger.error(`Execution error: ${normalizeError(err).message}`);
          void vscode.window.showErrorMessage(
            `PackAI: Execution failed. Check the output log for details.`
          );
          deps.executionEngine = null;
        });
      }
    );
  } catch (err) {
    const normalized = normalizeError(err);
    logger.error(`[startProject] ${normalized.code}: ${normalized.message}`);
    void vscode.window.showErrorMessage(getUserMessage(err));
  }
}
