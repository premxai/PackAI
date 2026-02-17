import * as vscode from "vscode";
import type { SessionManager } from "../orchestration/sessionManager";
import type { SessionStatus, SessionProgress } from "../orchestration/types";
import type { DashboardAction, DashboardMessage } from "./dashboardProtocol";
import { DashboardStateBuilder } from "./dashboardProtocol";
import type { ExecutionPlan } from "../intelligence/types";

// ===========================================================================
// DashboardProvider
//
// VS Code WebviewViewProvider for the WebFlow orchestration dashboard.
// Subscribes to SessionManager events and posts typed messages to the
// webview. Handles user actions (pause/resume/cancel/resolve) from the
// webview.
//
// This is one of the few files that imports `vscode` directly (alongside
// vscodeAdapters.ts and extension.ts).
// ===========================================================================

/**
 * VS Code WebviewViewProvider for the orchestration dashboard.
 *
 * Subscribes to {@link SessionManager} events and posts typed messages
 * to the webview. Handles user actions (pause/resume/cancel/resolve)
 * from the webview via the {@link DashboardAction} protocol.
 */
export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "webflow.dashboardView";

  private view: vscode.WebviewView | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly stateBuilder: DashboardStateBuilder =
    new DashboardStateBuilder();
  private currentPlan: ExecutionPlan | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager
  ) {}

  // -------------------------------------------------------------------------
  // WebviewViewProvider lifecycle
  // -------------------------------------------------------------------------

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "media"),
      ],
    };

    webviewView.webview.html = this.getHtmlContent(webviewView.webview);

    // Wire session manager events → webview messages
    this.wireEvents(webviewView.webview);

    // Handle webview → extension actions
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg: DashboardAction) => {
        this.handleAction(msg);
      })
    );

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      for (const d of this.disposables) d.dispose();
      this.disposables.length = 0;
    });
  }

  // -------------------------------------------------------------------------
  // Public API for extension.ts
  // -------------------------------------------------------------------------

  /** Set the current execution plan (call when a plan starts). */
  setExecutionPlan(plan: ExecutionPlan): void {
    this.currentPlan = plan;
    this.stateBuilder.setStartTime(Date.now());
    this.postFullState();
  }

  // -------------------------------------------------------------------------
  // HTML generation
  // -------------------------------------------------------------------------

  private getHtmlContent(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "dashboard.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "dashboard.js")
    );
    const nonce = getNonce();

    // Read the HTML template and replace placeholders
    // We inline the template here to avoid filesystem reads at runtime
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>WebFlow Dashboard</title>
</head>
<body>
  <header class="dashboard-header">
    <h1>WebFlow Dashboard</h1>
    <div class="header-stats" id="header-stats">
      <span class="stat" id="stat-elapsed">0:00</span>
      <span class="stat" id="stat-remaining">~0 min left</span>
    </div>
  </header>

  <section class="progress-section">
    <div class="progress-bar-container">
      <div class="progress-bar" id="overall-progress" style="width: 0%"></div>
    </div>
    <div class="progress-label" id="progress-label">0 / 0 tasks</div>
  </section>

  <section class="agents-section">
    <h2>Agents</h2>
    <div class="agent-cards" id="agent-cards">
      <div class="agent-card agent-claude" id="agent-claude" data-role="claude">
        <div class="agent-name">Claude</div>
        <div class="agent-status" id="agent-claude-status">idle</div>
        <div class="agent-task" id="agent-claude-task"></div>
        <div class="agent-stats">
          <span class="completed" id="agent-claude-completed">0</span> done
          <span class="failed" id="agent-claude-failed">0</span> failed
        </div>
      </div>
      <div class="agent-card agent-copilot" id="agent-copilot" data-role="copilot">
        <div class="agent-name">Copilot</div>
        <div class="agent-status" id="agent-copilot-status">idle</div>
        <div class="agent-task" id="agent-copilot-task"></div>
        <div class="agent-stats">
          <span class="completed" id="agent-copilot-completed">0</span> done
          <span class="failed" id="agent-copilot-failed">0</span> failed
        </div>
      </div>
      <div class="agent-card agent-codex" id="agent-codex" data-role="codex">
        <div class="agent-name">Codex</div>
        <div class="agent-status" id="agent-codex-status">idle</div>
        <div class="agent-task" id="agent-codex-task"></div>
        <div class="agent-stats">
          <span class="completed" id="agent-codex-completed">0</span> done
          <span class="failed" id="agent-codex-failed">0</span> failed
        </div>
      </div>
    </div>
  </section>

  <section class="phases-section">
    <h2>Phases &amp; Tasks</h2>
    <div id="phases-container"></div>
    <div class="empty-state" id="phases-empty">No execution plan loaded</div>
  </section>

  <section class="conflicts-section" id="conflicts-section" style="display: none;">
    <h2>
      <span class="warning-icon">&#9888;</span>
      Conflicts (<span id="conflict-count">0</span>)
    </h2>
    <div id="conflicts-container"></div>
  </section>

  <section class="activity-section">
    <h2>Activity Log</h2>
    <div class="activity-log" id="activity-log">
      <div class="empty-state" id="activity-empty">Waiting for activity...</div>
    </div>
  </section>

  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  private wireEvents(webview: vscode.Webview): void {
    this.disposables.push(
      this.sessionManager.onSessionStarted.event((status: SessionStatus) => {
        this.stateBuilder.recordAgentStarted(
          status.agent,
          status.taskId,
          status.taskId
        );
        this.postMessage(webview, {
          type: "task-update",
          payload: this.stateBuilder.buildTaskSnapshot(status),
        });
        this.postMessage(webview, {
          type: "agent-update",
          payload: this.stateBuilder.buildAgentSnapshots().find(
            (a) => a.role === status.agent
          )!,
        });
        this.postMessage(webview, {
          type: "activity",
          payload: this.stateBuilder.createActivity(
            status.agent,
            `Started task "${status.taskId}"`,
            "info"
          ),
        });
      })
    );

    this.disposables.push(
      this.sessionManager.onProgress.event((progress: SessionProgress) => {
        this.postMessage(webview, {
          type: "progress",
          payload: this.stateBuilder.buildProgressSnapshot(progress),
        });
      })
    );

    this.disposables.push(
      this.sessionManager.onSessionCompleted.event(
        (status: SessionStatus) => {
          this.stateBuilder.recordAgentCompleted(status.agent);
          this.postMessage(webview, {
            type: "task-update",
            payload: this.stateBuilder.buildTaskSnapshot(status),
          });
          this.postMessage(webview, {
            type: "agent-update",
            payload: this.stateBuilder.buildAgentSnapshots().find(
              (a) => a.role === status.agent
            )!,
          });
          this.postMessage(webview, {
            type: "activity",
            payload: this.stateBuilder.createActivity(
              status.agent,
              `Completed task "${status.taskId}"`,
              "success"
            ),
          });
          if (this.currentPlan) {
            this.postMessage(webview, {
              type: "stats",
              payload: this.stateBuilder.buildStats(this.currentPlan),
            });
          }
        }
      )
    );

    this.disposables.push(
      this.sessionManager.onSessionFailed.event((status: SessionStatus) => {
        this.stateBuilder.recordAgentFailed(status.agent);
        this.postMessage(webview, {
          type: "task-update",
          payload: this.stateBuilder.buildTaskSnapshot(status),
        });
        this.postMessage(webview, {
          type: "agent-update",
          payload: this.stateBuilder.buildAgentSnapshots().find(
            (a) => a.role === status.agent
          )!,
        });
        this.postMessage(webview, {
          type: "activity",
          payload: this.stateBuilder.createActivity(
            status.agent,
            `Failed task "${status.taskId}": ${status.error?.message ?? "unknown error"}`,
            "error"
          ),
        });
      })
    );

    this.disposables.push(
      this.sessionManager.onSessionPaused.event((status: SessionStatus) => {
        this.postMessage(webview, {
          type: "task-update",
          payload: this.stateBuilder.buildTaskSnapshot(status),
        });
        this.postMessage(webview, {
          type: "activity",
          payload: this.stateBuilder.createActivity(
            status.agent,
            `Paused task "${status.taskId}"`,
            "warning"
          ),
        });
      })
    );

    this.disposables.push(
      this.sessionManager.onSessionResumed.event((status: SessionStatus) => {
        this.postMessage(webview, {
          type: "task-update",
          payload: this.stateBuilder.buildTaskSnapshot(status),
        });
        this.postMessage(webview, {
          type: "activity",
          payload: this.stateBuilder.createActivity(
            status.agent,
            `Resumed task "${status.taskId}"`,
            "info"
          ),
        });
      })
    );

    this.disposables.push(
      this.sessionManager.onSessionCancelled.event(
        (status: SessionStatus) => {
          this.postMessage(webview, {
            type: "task-update",
            payload: this.stateBuilder.buildTaskSnapshot(status),
          });
          this.postMessage(webview, {
            type: "activity",
            payload: this.stateBuilder.createActivity(
              status.agent,
              `Cancelled task "${status.taskId}"`,
              "warning"
            ),
          });
        }
      )
    );
  }

  // -------------------------------------------------------------------------
  // Action handling
  // -------------------------------------------------------------------------

  private handleAction(action: DashboardAction): void {
    switch (action.type) {
      case "pause":
        this.sessionManager.pauseSession(action.payload.taskId);
        break;
      case "resume":
        this.sessionManager.resumeSession(action.payload.taskId);
        break;
      case "cancel":
        this.sessionManager.cancelSession(action.payload.taskId);
        break;
      case "request-state":
        this.postFullState();
        break;
      case "resolve-conflict":
        // Conflict resolution is handled at the orchestration layer
        // Fire a VS Code command that the orchestrator can pick up
        void vscode.commands.executeCommand(
          "webflow.resolveConflict",
          action.payload
        );
        break;
      case "retry-task":
        void vscode.commands.executeCommand(
          "webflow.retryTask",
          action.payload
        );
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private postFullState(): void {
    if (!this.view || !this.currentPlan) return;
    const msg: DashboardMessage = {
      type: "init",
      payload: this.stateBuilder.buildState(this.currentPlan),
    };
    void this.view.webview.postMessage(msg);
  }

  private postMessage(
    webview: vscode.Webview,
    message: DashboardMessage
  ): void {
    void webview.postMessage(message);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function getNonce(): string {
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return nonce;
}
