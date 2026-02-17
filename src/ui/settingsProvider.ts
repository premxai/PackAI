import * as vscode from "vscode";
import type { SettingsAction, SettingsMessage } from "./settingsProtocol";
import { SettingsService, DEFAULT_SETTINGS } from "../settings";
import type { ISettingsProvider } from "../settings/vscodeSettingsAdapter";

// ===========================================================================
// Settings Provider
//
// Command-opened webview panel for configuring PackAI settings.
// Uses createWebviewPanel (full-tab editor) instead of WebviewViewProvider
// (sidebar) because settings are visited infrequently and need more space.
// ===========================================================================

/**
 * Command-opened webview panel for configuring PackAI settings.
 *
 * Uses `createWebviewPanel` (full-tab editor) instead of a sidebar view
 * because settings are visited infrequently and need more space.
 * Communicates with the webview via the {@link SettingsAction} protocol.
 */
export class SettingsProvider {
  private panel: vscode.WebviewPanel | undefined;
  private readonly service = new SettingsService();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly settingsProvider: ISettingsProvider
  ) {}

  /** Open the settings panel, or reveal it if already open. */
  open(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "packai.settingsPanel",
      "PackAI Settings",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
      }
    );

    this.panel.iconPath = new vscode.ThemeIcon("gear");
    this.panel.webview.html = this.getHtmlContent(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      (action: SettingsAction) => { void this.handleAction(action); },
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      for (const d of this.disposables) d.dispose();
      this.disposables.length = 0;
    });
  }

  dispose(): void {
    this.panel?.dispose();
  }

  // -----------------------------------------------------------------------
  // Message handling
  // -----------------------------------------------------------------------

  private async handleAction(action: SettingsAction): Promise<void> {
    switch (action.type) {
      case "request-state":
        this.sendState();
        break;
      case "update-setting":
        await this.updateSetting(action.payload.key, action.payload.value);
        break;
      case "reset-defaults":
        await this.resetToDefaults();
        break;
      case "reset-section":
        await this.resetSection(action.payload.section);
        break;
    }
  }

  private sendState(): void {
    const settings = this.settingsProvider.getSettings();
    const validationErrors = this.service.validate(settings);
    this.postMessage({ type: "init", payload: { settings, validationErrors } });
  }

  private async updateSetting(key: string, value: unknown): Promise<void> {
    const config = vscode.workspace.getConfiguration("packai");
    await config.update(key, value, vscode.ConfigurationTarget.Global);

    // Re-read and send updated state
    const settings = this.settingsProvider.getSettings();
    const validationErrors = this.service.validate(settings);
    if (validationErrors.length > 0) {
      this.postMessage({ type: "validation-errors", payload: validationErrors });
    } else {
      this.postMessage({ type: "save-success" });
    }
    this.postMessage({ type: "settings-updated", payload: { settings, validationErrors } });
  }

  private async resetToDefaults(): Promise<void> {
    const config = vscode.workspace.getConfiguration("packai");
    const keys = this.getAllSettingKeys();
    for (const key of keys) {
      await config.update(key, undefined, vscode.ConfigurationTarget.Global);
    }
    this.sendState();
  }

  private async resetSection(section: string): Promise<void> {
    const config = vscode.workspace.getConfiguration("packai");
    const sectionDefaults = this.getSectionDefaults(section);
    if (!sectionDefaults) return;

    for (const [key, value] of Object.entries(sectionDefaults)) {
      await config.update(`${section}.${key}`, value, vscode.ConfigurationTarget.Global);
    }
    this.sendState();
  }

  private getSectionDefaults(section: string): Record<string, unknown> | undefined {
    const d = DEFAULT_SETTINGS;
    switch (section) {
      case "agentPreferences": return { ...d.agentPreferences } as unknown as Record<string, unknown>;
      case "approval": return { ...d.approval } as unknown as Record<string, unknown>;
      case "ui": return { ...d.ui } as unknown as Record<string, unknown>;
      case "advanced": return { ...d.advanced } as unknown as Record<string, unknown>;
      default: return undefined;
    }
  }

  private getAllSettingKeys(): string[] {
    return [
      "agentPreferences.selectionStrategy",
      "agentPreferences.costOptimizationLevel",
      "agentPreferences.maxParallelSessions",
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
    ];
  }

  private postMessage(msg: SettingsMessage): void {
    void this.panel?.webview.postMessage(msg);
  }

  // -----------------------------------------------------------------------
  // HTML content
  // -----------------------------------------------------------------------

  private getHtmlContent(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "settings.css")
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "settings.js")
    );
    const nonce = getNonce();
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${csp}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${cssUri}">
  <title>PackAI Settings</title>
</head>
<body>

<div class="settings-header">
  <div>
    <h1>PackAI Settings</h1>
    <div class="subtitle">Configure AI orchestrator behavior</div>
  </div>
</div>

<div class="tab-bar">
  <button class="tab-btn active" data-tab="agent">Agent Preferences</button>
  <button class="tab-btn" data-tab="approval">Approval</button>
  <button class="tab-btn" data-tab="ui">UI Preferences</button>
  <button class="tab-btn" data-tab="advanced">Advanced</button>
</div>

<!-- Agent Preferences -->
<div id="tab-agent" class="tab-content active">
  <div class="settings-section">
    <h2>Agent Selection</h2>
    <p class="section-desc">Control how the orchestrator picks agents for tasks.</p>

    <div class="setting-row">
      <label for="selectionStrategy">Selection Strategy</label>
      <div class="setting-desc">How agents are chosen when multiple could handle a task.</div>
      <select id="selectionStrategy">
        <option value="intelligent">Intelligent (auto-select best agent)</option>
        <option value="roundRobin">Round Robin (distribute evenly)</option>
        <option value="preferClaude">Prefer Claude</option>
        <option value="preferCopilot">Prefer Copilot</option>
        <option value="preferCodex">Prefer Codex</option>
      </select>
    </div>

    <div class="setting-row">
      <label for="costOptimizationLevel">Cost Optimization</label>
      <div class="setting-desc">Balance between cost savings and output quality.</div>
      <select id="costOptimizationLevel">
        <option value="economy">Economy (minimize cost)</option>
        <option value="balanced">Balanced</option>
        <option value="performance">Performance (maximize quality)</option>
      </select>
    </div>

    <div class="setting-row">
      <label for="maxParallelSessions">Max Parallel Sessions</label>
      <div class="setting-desc">Maximum agent sessions running simultaneously (1–10).</div>
      <input type="number" id="maxParallelSessions" min="1" max="10" value="3">
    </div>
  </div>
</div>

<!-- Approval -->
<div id="tab-approval" class="tab-content">
  <div class="settings-section">
    <h2>Tool Approval</h2>
    <p class="section-desc">Control which tool operations require manual confirmation.</p>

    <div class="setting-row">
      <label>Auto-Approve Tools</label>
      <div class="setting-desc">Tool types that are always auto-approved without prompting.</div>
      <div class="tool-checkboxes">
        <label class="tool-checkbox"><input type="checkbox" id="autoApprove-READ"> READ</label>
        <label class="tool-checkbox"><input type="checkbox" id="autoApprove-CREATE"> CREATE</label>
        <label class="tool-checkbox"><input type="checkbox" id="autoApprove-EDIT"> EDIT</label>
        <label class="tool-checkbox"><input type="checkbox" id="autoApprove-DELETE"> DELETE</label>
        <label class="tool-checkbox"><input type="checkbox" id="autoApprove-TERMINAL"> TERMINAL</label>
        <label class="tool-checkbox"><input type="checkbox" id="autoApprove-WEB_SEARCH"> WEB_SEARCH</label>
      </div>
    </div>

    <div class="setting-row">
      <label>Always Deny Tools</label>
      <div class="setting-desc">Tool types that always require manual confirmation.</div>
      <div class="tool-checkboxes">
        <label class="tool-checkbox"><input type="checkbox" id="alwaysDeny-READ"> READ</label>
        <label class="tool-checkbox"><input type="checkbox" id="alwaysDeny-CREATE"> CREATE</label>
        <label class="tool-checkbox"><input type="checkbox" id="alwaysDeny-EDIT"> EDIT</label>
        <label class="tool-checkbox"><input type="checkbox" id="alwaysDeny-DELETE"> DELETE</label>
        <label class="tool-checkbox"><input type="checkbox" id="alwaysDeny-TERMINAL"> TERMINAL</label>
        <label class="tool-checkbox"><input type="checkbox" id="alwaysDeny-WEB_SEARCH"> WEB_SEARCH</label>
      </div>
    </div>
  </div>

  <div class="settings-section">
    <h2>Agent Trust Levels</h2>
    <p class="section-desc">Higher trust means fewer approval interruptions per agent.</p>

    <div class="trust-grid">
      <span class="agent-label claude">Claude</span>
      <select id="trust-claude">
        <option value="minimal">Minimal</option>
        <option value="standard">Standard</option>
        <option value="elevated">Elevated</option>
        <option value="full">Full</option>
      </select>

      <span class="agent-label copilot">Copilot</span>
      <select id="trust-copilot">
        <option value="minimal">Minimal</option>
        <option value="standard">Standard</option>
        <option value="elevated">Elevated</option>
        <option value="full">Full</option>
      </select>

      <span class="agent-label codex">Codex</span>
      <select id="trust-codex">
        <option value="minimal">Minimal</option>
        <option value="standard">Standard</option>
        <option value="elevated">Elevated</option>
        <option value="full">Full</option>
      </select>
    </div>
  </div>

  <div class="settings-section">
    <h2>Environment</h2>

    <div class="setting-row checkbox-row">
      <input type="checkbox" id="devContainerMode">
      <label for="devContainerMode">Dev Container Mode</label>
    </div>
    <div class="setting-desc" style="margin-left:24px;margin-bottom:12px;">
      Activate permissive approval mode when running in a dev container.
    </div>

    <div class="setting-row checkbox-row">
      <input type="checkbox" id="productionWorkspace">
      <label for="productionWorkspace">Production Workspace</label>
    </div>
    <div class="setting-desc" style="margin-left:24px;">
      Mark this workspace as production to activate restrictive approval mode.
    </div>
  </div>
</div>

<!-- UI Preferences -->
<div id="tab-ui" class="tab-content">
  <div class="settings-section">
    <h2>Dashboard</h2>

    <div class="setting-row checkbox-row">
      <input type="checkbox" id="autoOpenDashboard">
      <label for="autoOpenDashboard">Auto-open dashboard when a workflow starts</label>
    </div>

    <div class="setting-row" style="margin-top:16px;">
      <label for="dashboardTheme">Dashboard Theme</label>
      <div class="setting-desc">Override the dashboard color scheme.</div>
      <select id="dashboardTheme">
        <option value="auto">Auto (follow VS Code)</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>

    <div class="setting-row">
      <label for="activityLogLimit">Activity Log Limit</label>
      <div class="setting-desc">Maximum entries shown in the activity log (10–500).</div>
      <input type="number" id="activityLogLimit" min="10" max="500" value="100">
    </div>
  </div>

  <div class="settings-section">
    <h2>Notifications</h2>

    <div class="setting-row">
      <label for="notificationVerbosity">Notification Verbosity</label>
      <div class="setting-desc">How many VS Code notifications the extension shows.</div>
      <select id="notificationVerbosity">
        <option value="silent">Silent (errors only in output channel)</option>
        <option value="minimal">Minimal (errors and important warnings)</option>
        <option value="normal">Normal (task completion and warnings)</option>
        <option value="verbose">Verbose (every agent action)</option>
      </select>
    </div>
  </div>
</div>

<!-- Advanced -->
<div id="tab-advanced" class="tab-content">
  <div class="settings-section">
    <h2>Workflow Templates</h2>

    <div class="setting-row">
      <label for="customTemplatesDirectory">Custom Templates Directory</label>
      <div class="setting-desc">Path to a directory with custom workflow templates. Leave empty for built-in templates.</div>
      <input type="text" id="customTemplatesDirectory" placeholder="/path/to/templates">
    </div>
  </div>

  <div class="settings-section">
    <h2>Benchmarks</h2>

    <div class="setting-row">
      <label for="benchmarkDataPath">Benchmark Data Path</label>
      <div class="setting-desc">Path to benchmark JSON file. Leave empty for default (.packai/benchmarks.json).</div>
      <input type="text" id="benchmarkDataPath" placeholder=".packai/benchmarks.json">
    </div>
  </div>

  <div class="settings-section">
    <h2>Session Behavior</h2>

    <div class="setting-row">
      <label for="sessionTimeoutMs">Session Timeout (ms)</label>
      <div class="setting-desc">Timeout for agent sessions in milliseconds. 0 = no timeout (max 3,600,000).</div>
      <input type="number" id="sessionTimeoutMs" min="0" max="3600000" value="300000">
    </div>

    <div class="setting-row">
      <label for="maxRetries">Max Retries</label>
      <div class="setting-desc">Maximum retry attempts on session failure (0–10).</div>
      <input type="number" id="maxRetries" min="0" max="10" value="3">
    </div>

    <div class="setting-row">
      <label for="retryBaseDelayMs">Retry Base Delay (ms)</label>
      <div class="setting-desc">Base delay between retries with exponential backoff (100–60,000).</div>
      <input type="number" id="retryBaseDelayMs" min="100" max="60000" value="1000">
    </div>
  </div>
</div>

<ul id="validation-errors" class="validation-errors"></ul>

<div class="settings-footer">
  <div class="footer-left">
    <button class="btn btn-secondary" onclick="onResetDefaults()">Reset to Defaults</button>
  </div>
  <div class="footer-right">
    <button class="btn btn-primary" onclick="onSaveSettings()">Save Settings</button>
  </div>
</div>

<div id="toast" class="toast success"></div>

<script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
