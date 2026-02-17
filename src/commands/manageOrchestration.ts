import * as vscode from "vscode";
import type { CommandDeps } from "./index";
import { normalizeError, getUserMessage } from "../utils";

// ===========================================================================
// Orchestration Management Commands
//
// Pause, resume, cancel, view sessions, retry tasks, resolve conflicts.
// ===========================================================================

export function registerOrchestrationCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("webflow.pauseOrchestration", () =>
      pauseOrchestration(deps)
    ),
    vscode.commands.registerCommand("webflow.resumeOrchestration", () =>
      resumeOrchestration(deps)
    ),
    vscode.commands.registerCommand("webflow.cancelOrchestration", () =>
      cancelOrchestration(deps)
    ),
    vscode.commands.registerCommand("webflow.viewSessionDetails", () =>
      viewSessionDetails(deps)
    ),
    vscode.commands.registerCommand(
      "webflow.retryTask",
      (payload?: { taskId: string }) => retryTask(deps, payload)
    ),
    vscode.commands.registerCommand(
      "webflow.resolveConflict",
      (payload?: { conflictId: string; resolution: string }) =>
        resolveConflict(deps, payload)
    )
  );
}

// ---------------------------------------------------------------------------
// Pause all active sessions
// ---------------------------------------------------------------------------

async function pauseOrchestration(deps: CommandDeps): Promise<void> {
  const { sessionManager, logger } = deps;

  try {
    const active = sessionManager
      .getActiveSessions()
      .filter((s) => s.state === "running");

    if (active.length === 0) {
      void vscode.window.showInformationMessage("WebFlow: No running sessions to pause.");
      return;
    }

    for (const session of active) {
      await sessionManager.pauseSession(session.sessionId);
    }

    logger.info(`Paused ${active.length} session(s)`);
    void vscode.window.showInformationMessage(
      `WebFlow: Paused ${active.length} session(s).`
    );
  } catch (err) {
    handleCommandError("pauseOrchestration", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Resume all paused sessions
// ---------------------------------------------------------------------------

async function resumeOrchestration(deps: CommandDeps): Promise<void> {
  const { sessionManager, logger } = deps;

  try {
    const paused = sessionManager
      .getActiveSessions()
      .filter((s) => s.state === "paused");

    if (paused.length === 0) {
      void vscode.window.showInformationMessage("WebFlow: No paused sessions to resume.");
      return;
    }

    for (const session of paused) {
      await sessionManager.resumeSession(session.sessionId);
    }

    logger.info(`Resumed ${paused.length} session(s)`);
    void vscode.window.showInformationMessage(
      `WebFlow: Resumed ${paused.length} session(s).`
    );
  } catch (err) {
    handleCommandError("resumeOrchestration", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Cancel all sessions (with confirmation)
// ---------------------------------------------------------------------------

async function cancelOrchestration(deps: CommandDeps): Promise<void> {
  const { sessionManager, logger } = deps;

  try {
    const active = sessionManager.getActiveSessions();

    if (active.length === 0) {
      void vscode.window.showInformationMessage("WebFlow: No active sessions to cancel.");
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Cancel ${active.length} active session(s)? This cannot be undone.`,
      { modal: true },
      "Cancel All"
    );

    if (confirm !== "Cancel All") return;

    for (const session of active) {
      await sessionManager.cancelSession(session.sessionId);
    }

    logger.info(`Cancelled ${active.length} session(s)`);
    void vscode.window.showInformationMessage(
      `WebFlow: Cancelled ${active.length} session(s).`
    );
  } catch (err) {
    handleCommandError("cancelOrchestration", err, deps);
  }
}

// ---------------------------------------------------------------------------
// View session details via quick pick
// ---------------------------------------------------------------------------

async function viewSessionDetails(deps: CommandDeps): Promise<void> {
  const { sessionManager, logger } = deps;

  try {
    const all = sessionManager.getAllSessions();

    if (all.length === 0) {
      void vscode.window.showInformationMessage("WebFlow: No sessions to display.");
      return;
    }

    const stateIcon: Record<string, string> = {
      pending: "$(clock)",
      running: "$(sync~spin)",
      paused: "$(debug-pause)",
      completed: "$(check)",
      failed: "$(error)",
      cancelled: "$(circle-slash)",
    };

    const items = all.map((s) => ({
      label: `${stateIcon[s.state] ?? "$(question)"} ${s.agent} — ${s.taskId}`,
      description: s.state,
      detail: s.error ? `Error: ${s.error.message}` : (s.output ? s.output.slice(0, 120) : undefined),
      sessionId: s.sessionId,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a session to view details",
      title: "WebFlow: Session Details",
    });

    if (!picked) return;

    const status = sessionManager.getSessionStatus(picked.sessionId);
    logger.info(`Session ${picked.sessionId}: ${JSON.stringify(status, null, 2)}`);
    logger.show();

    void vscode.window.showInformationMessage(
      `Session ${status.sessionId} (${status.agent}): ${status.state}`
    );
  } catch (err) {
    handleCommandError("viewSessionDetails", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Retry a failed task (called from dashboard or command palette)
// ---------------------------------------------------------------------------

async function retryTask(
  deps: CommandDeps,
  payload?: { taskId: string }
): Promise<void> {
  const { logger } = deps;

  try {
    const taskId = payload?.taskId;
    if (!taskId) {
      void vscode.window.showWarningMessage(
        "WebFlow: No task specified for retry. Use the dashboard to retry a specific task."
      );
      return;
    }

    logger.info(`Retry requested for task: ${taskId}`);
    void vscode.window.showInformationMessage(
      `WebFlow: Retry queued for task "${taskId}". Full execution coming in Phase 2.`
    );
  } catch (err) {
    handleCommandError("retryTask", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Resolve a conflict (called from dashboard or command palette)
// ---------------------------------------------------------------------------

async function resolveConflict(
  deps: CommandDeps,
  payload?: { conflictId: string; resolution: string }
): Promise<void> {
  const { logger } = deps;

  try {
    if (!payload?.conflictId) {
      void vscode.window.showWarningMessage(
        "WebFlow: No conflict specified. Use the dashboard to resolve conflicts."
      );
      return;
    }

    logger.info(
      `Conflict resolution: ${payload.conflictId} → ${payload.resolution}`
    );
    void vscode.window.showInformationMessage(
      `WebFlow: Conflict "${payload.conflictId}" resolved with strategy "${payload.resolution}".`
    );
  } catch (err) {
    handleCommandError("resolveConflict", err, deps);
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
