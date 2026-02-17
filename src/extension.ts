import * as vscode from "vscode";
import { analyzeIntent, WorkflowGenerator, AgentSelector } from "./intelligence";
import type { ExecutionPlan } from "./intelligence";
import {
  SessionManager,
  VsCodeLanguageModelProvider,
  VsCodeEventEmitterFactory,
  VsCodeCancellationTokenSourceFactory,
  VsCodeStateStoreAdapter,
} from "./orchestration";
import { DashboardProvider, SettingsProvider } from "./ui";
import { VsCodeSettingsAdapter } from "./settings/vscodeSettingsAdapter";
import {
  normalizeError,
  getUserMessage,
  ExecutionStateManager,
  ErrorFrequencyTracker,
} from "./utils";
import { registerAllCommands } from "./commands";
import type { CommandDeps } from "./commands";

const PARTICIPANT_ID = "packai.orchestrator";

let logger: vscode.LogOutputChannel;
let sessionManager: SessionManager;
let stateManager: ExecutionStateManager;
let errorTracker: ErrorFrequencyTracker;

export function activate(context: vscode.ExtensionContext): void {
  logger = vscode.window.createOutputChannel("PackAI AI Orchestrator", {
    log: true,
  });
  context.subscriptions.push(logger);
  logger.info("PackAI AI Orchestrator activating...");

  // Initialize the session manager
  sessionManager = new SessionManager(
    new VsCodeLanguageModelProvider(),
    new VsCodeEventEmitterFactory(),
    new VsCodeCancellationTokenSourceFactory()
  );
  context.subscriptions.push({ dispose: () => sessionManager.dispose() });

  // Initialize error tracking and state management
  errorTracker = new ErrorFrequencyTracker();
  const settingsAdapter = new VsCodeSettingsAdapter();
  const stateStore = new VsCodeStateStoreAdapter(context.globalState);
  const settings = settingsAdapter.getSettings();
  stateManager = new ExecutionStateManager(
    stateStore,
    settings.advanced.stateCheckpointIntervalMs
  );
  context.subscriptions.push({ dispose: () => stateManager.dispose() });

  // Register the dashboard webview
  const dashboardProvider = new DashboardProvider(
    context.extensionUri,
    sessionManager
  );
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DashboardProvider.viewType,
      dashboardProvider
    )
  );

  // Register the settings panel
  const settingsProvider = new SettingsProvider(
    context.extensionUri,
    settingsAdapter
  );
  context.subscriptions.push({ dispose: () => settingsProvider.dispose() });

  // Register all commands (start project, orchestration, templates, settings)
  const commandDeps: CommandDeps = {
    sessionManager,
    dashboardProvider,
    settingsAdapter,
    stateManager,
    logger,
    currentPlan: null,
  };
  registerAllCommands(context, commandDeps);

  // Register dashboard and settings shortcut commands
  context.subscriptions.push(
    vscode.commands.registerCommand("packai.openDashboard", () => {
      void vscode.commands.executeCommand("packai.dashboardView.focus");
    }),
    vscode.commands.registerCommand("packai.openSettings", () => {
      settingsProvider.open();
    })
  );

  // Register the chat participant
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    handleChatRequest
  );
  participant.iconPath = new vscode.ThemeIcon("rocket");
  participant.followupProvider = { provideFollowups };
  context.subscriptions.push(participant);

  logger.info("PackAI AI Orchestrator activated");
}

export function deactivate(): void {
  logger?.info("PackAI AI Orchestrator deactivated");
}

// ---------------------------------------------------------------------------
// Chat Participant
// ---------------------------------------------------------------------------

interface PackAIChatResult extends vscode.ChatResult {
  metadata: {
    command: string;
    agentUsed?: string;
    nextSteps?: string[];
  };
}

const handleChatRequest: vscode.ChatRequestHandler = async (
  request,
  context,
  stream,
  token
): Promise<PackAIChatResult> => {
  const command = request.command ?? "chat";
  logger.info(`Chat request: command=${command}, prompt="${request.prompt}"`);

  try {
    switch (command) {
      case "scaffold":
        return await handleScaffold(request, context, stream, token);
      case "component":
        return await handleComponent(request, context, stream, token);
      case "api":
        return await handleApi(request, context, stream, token);
      case "test":
        return await handleTest(request, context, stream, token);
      case "review":
        return await handleReview(request, context, stream, token);
      default:
        return await handleFreeform(request, context, stream, token);
    }
  } catch (err) {
    return handleError(err, stream);
  }
};

// ---------------------------------------------------------------------------
// Slash-command handlers (stubs — will be fleshed out in later phases)
// ---------------------------------------------------------------------------

async function handleScaffold(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken
): Promise<PackAIChatResult> {
  stream.progress("Analyzing project requirements...");

  const intent = analyzeIntent(request.prompt);
  logger.info(
    `Intent: type=${intent.projectType} (${intent.projectTypeConfidence}), ` +
      `complexity=${intent.complexity}, features=[${intent.features.join(", ")}], ` +
      `stack=[${intent.stackHints.map((s) => s.name).join(", ")}]`
  );

  // Generate the execution plan
  stream.progress("Generating execution plan...");
  const generator = new WorkflowGenerator();
  const executionPlan = generator.generate(intent);
  logger.info(
    `Plan: template="${executionPlan.templateName}", ` +
      `phases=${executionPlan.phases.length}, tasks=${executionPlan.stats.totalTasks}, ` +
      `est=${executionPlan.estimatedTotalMinutes}min`
  );

  // Run intelligent agent selection on each task
  stream.progress("Selecting optimal agents for each task...");
  const agentSelector = new AgentSelector();
  for (const phase of executionPlan.phases) {
    for (const task of phase.tasks) {
      const rec = agentSelector.recommend(task);
      // Override template agent with intelligent recommendation
      (task as { agent: string }).agent = rec.agent;
      logger.info(
        `Agent selection: ${task.id} → ${rec.agent} ` +
          `(confidence=${rec.confidence}, fallbacks=[${rec.fallbacks.join(",")}])`
      );
    }
  }

  // Render the analysis
  stream.markdown(`### Project Analysis\n\n`);
  stream.markdown(`| Field | Value |\n|---|---|\n`);
  stream.markdown(`| **Type** | ${intent.projectType} (${intent.projectTypeConfidence} confidence) |\n`);
  stream.markdown(`| **Complexity** | ${intent.complexity} |\n`);
  stream.markdown(
    `| **Features** | ${intent.features.length > 0 ? intent.features.join(", ") : "none detected"} |\n`
  );
  stream.markdown(
    `| **Stack** | ${Object.entries(executionPlan.resolvedStack).map(([k, v]) => `${k}: ${v}`).join(", ")} |\n`
  );

  // Render the execution plan
  renderExecutionPlan(stream, executionPlan);

  if (intent.ambiguities.length > 0) {
    stream.markdown(`\n### Needs Clarification\n\n`);
    for (const a of intent.ambiguities) {
      stream.markdown(`- ${a}\n`);
    }
  }

  const nextSteps = intent.ambiguities.length > 0
    ? [intent.ambiguities[0]!]
    : ["Looks good — start building"];

  return result("scaffold", { nextSteps });
}

function renderExecutionPlan(
  stream: vscode.ChatResponseStream,
  plan: ExecutionPlan
): void {
  const agentIcon: Record<string, string> = {
    claude: "C",
    copilot: "G",
    codex: "X",
  };

  stream.markdown(
    `\n### Execution Plan — ${plan.templateName}\n\n` +
      `**${plan.stats.totalTasks} tasks** across **${plan.phases.length} phases** ` +
      `(~${plan.estimatedTotalMinutes} min est.) | ` +
      `Claude: ${plan.stats.tasksByAgent.claude}, ` +
      `Copilot: ${plan.stats.tasksByAgent.copilot}, ` +
      `Codex: ${plan.stats.tasksByAgent.codex}\n\n`
  );

  for (const phase of plan.phases) {
    stream.markdown(`#### ${phase.label}\n_${phase.description}_\n\n`);
    for (const task of phase.tasks) {
      const agent = agentIcon[task.agent] ?? "?";
      const par = task.parallelizable ? " ||" : "";
      const deps =
        task.dependsOn.length > 0
          ? ` (after: ${task.dependsOn.join(", ")})`
          : "";
      stream.markdown(
        `- \\[${agent}\\] **${task.label}**${par}${deps} — ${task.estimatedMinutes}min\n`
      );
    }
    stream.markdown("\n");
  }
}

async function handleComponent(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken
): Promise<PackAIChatResult> {
  stream.progress("Preparing component generation...");
  stream.markdown(
    `### Component\nCreating component: **${request.prompt}**\n\n` +
      "_Component generation coming in Phase 2._"
  );
  return result("component");
}

async function handleApi(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken
): Promise<PackAIChatResult> {
  stream.progress("Designing API endpoints...");
  stream.markdown(
    `### API\nBuilding endpoints for: **${request.prompt}**\n\n` +
      "_API generation coming in Phase 2._"
  );
  return result("api");
}

async function handleTest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken
): Promise<PackAIChatResult> {
  stream.progress("Setting up test generation...");
  stream.markdown(
    `### Test\nGenerating tests for: **${request.prompt}**\n\n` +
      "_Test generation coming in Phase 2._"
  );
  return result("test");
}

async function handleReview(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken
): Promise<PackAIChatResult> {
  stream.progress("Starting multi-agent review...");
  stream.markdown(
    `### Code Review\nReviewing: **${request.prompt}**\n\n` +
      "_Multi-agent review coming in Phase 2._"
  );
  return result("review");
}

async function handleFreeform(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<PackAIChatResult> {
  stream.progress("Selecting optimal agent...");

  // Attempt to get a language model and provide a helpful response
  const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
  const model = models[0];

  if (!model) {
    stream.markdown(
      "No language model available. Make sure GitHub Copilot is active.\n\n" +
        "Available commands: `/scaffold`, `/component`, `/api`, `/test`, `/review`"
    );
    return result("chat");
  }

  const messages = [
    vscode.LanguageModelChatMessage.User(
      "You are PackAI AI Orchestrator, a multi-agent coordinator for web development. " +
        "You help users by routing tasks to the best AI agent (Claude for architecture, " +
        "Copilot for quick edits, Codex for background tasks). " +
        "Keep responses concise. Suggest using slash commands when appropriate: " +
        "/scaffold, /component, /api, /test, /review.\n\n" +
        `User request: ${request.prompt}`
    ),
  ];

  const response = await model.sendRequest(messages, {}, token);
  for await (const chunk of response.text) {
    stream.markdown(chunk);
  }

  return result("chat", { agentUsed: model.family });
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

function provideFollowups(
  chatResult: vscode.ChatResult,
  _context: vscode.ChatContext,
  _token: vscode.CancellationToken
): vscode.ChatFollowup[] {
  const meta = chatResult.metadata as PackAIChatResult["metadata"] | undefined;
  if (!meta?.nextSteps?.length) {
    return [];
  }
  return meta.nextSteps.map((step) => ({ prompt: step, label: step }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function result(
  command: string,
  extra?: Partial<PackAIChatResult["metadata"]>
): PackAIChatResult {
  return { metadata: { command, ...extra } };
}

function handleError(
  err: unknown,
  stream: vscode.ChatResponseStream
): PackAIChatResult {
  const normalized = normalizeError(err);
  errorTracker.record(normalized.code);
  logger.error(`[${normalized.code}] ${normalized.message}`);

  if (err instanceof vscode.LanguageModelError) {
    if (err.cause instanceof Error && err.cause.message.includes("off_topic")) {
      stream.markdown("I can only help with web development tasks.");
    } else {
      stream.markdown(
        `A language model error occurred: ${err.message}\n\nPlease try again.`
      );
    }
  } else {
    stream.markdown(`${getUserMessage(err)}\n\nPlease try again.`);
  }
  return result("error");
}
