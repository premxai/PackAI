# User Guide

A step-by-step guide to using the WebFlow AI Orchestrator.

## Getting Started

### 1. Open a Workspace

WebFlow needs an open folder to work in. Go to **File > Open Folder** and select (or create) your project directory.

### 2. Start a Project

Open the Command Palette (`Ctrl+Shift+P`) and run **WebFlow: Start Project**, or use the keybinding `Ctrl+Shift+W S`.

You'll see a quick pick with project types:

- **E-commerce Store** -- products, cart, checkout, payments
- **Landing Page** -- hero sections, CTAs, responsive design
- **SaaS Dashboard** -- admin panels, data visualization, CRUD
- **Blog / Content Site** -- CMS, markdown rendering, comments
- **Custom Project** -- describe anything in your own words

If you pick "Custom Project", you'll be asked to type a description like:

> Build a recipe sharing app with user accounts, image uploads, and a rating system

### 3. View the Execution Plan

After selecting a project type, WebFlow will:

1. Analyze your intent (detect project type, features, complexity)
2. Generate a multi-phase execution plan
3. Assign each task to the best AI agent
4. Open the dashboard (if `autoOpenDashboard` is enabled)

The dashboard shows phases, tasks, and agent assignments.

### 4. Use Chat for Details

In the VS Code Chat panel, type:

```
@webflow /scaffold Build an e-commerce store with Stripe payments and PostgreSQL
```

This runs the full analysis and renders a detailed execution plan in the chat, including:

- Project analysis table (type, complexity, features, stack)
- Phase-by-phase task breakdown with agent assignments
- Estimated time per task
- Dependency chains

## Chat Commands

### `/scaffold` -- Generate Project Plan

```
@webflow /scaffold Build a real-time dashboard with WebSocket updates
```

Produces a full execution plan. This is the primary command for starting a new project.

### `/component` -- Create a Component

```
@webflow /component A sortable data table with pagination
```

*(Coming in Phase 2)* Will generate a complete UI component with the appropriate framework.

### `/api` -- Build API Endpoints

```
@webflow /api RESTful user management with CRUD operations
```

*(Coming in Phase 2)* Will generate API route handlers, validation, and tests.

### `/test` -- Generate Tests

```
@webflow /test Cover the authentication module
```

*(Coming in Phase 2)* Will create unit and integration tests for the specified code.

### `/review` -- Code Review

```
@webflow /review Check the checkout flow for security issues
```

*(Coming in Phase 2)* Will run a multi-agent review with different perspectives.

### Freeform Chat

```
@webflow How should I structure my Next.js app for SSR?
```

Routes to a language model for general web development assistance. Suggests relevant slash commands when appropriate.

## Managing Orchestration

### Pause All Sessions

Command Palette: **WebFlow: Pause Orchestration** or `Ctrl+Shift+W P`

Pauses all currently running agent sessions. Useful when you want to review intermediate results before continuing.

### Resume All Sessions

Command Palette: **WebFlow: Resume Orchestration** or `Ctrl+Shift+W R`

Resumes all paused sessions from where they left off.

### Cancel All Sessions

Command Palette: **WebFlow: Cancel Orchestration**

Cancels all active sessions after a confirmation dialog. This cannot be undone.

### View Session Details

Command Palette: **WebFlow: View Session Details**

Shows a quick pick of all sessions with their current state. Selecting one displays full details in the output channel.

Session states:

| State | Icon | Meaning |
|-------|------|---------|
| Pending | Clock | Queued, waiting for dependencies |
| Running | Sync | Actively streaming from LLM |
| Paused | Pause | User-paused |
| Completed | Check | Successfully finished |
| Failed | Error | Error occurred |
| Cancelled | Slash | User-cancelled |

## Working with Templates

### Browse Templates

Command Palette: **WebFlow: Browse Templates** or `Ctrl+Shift+W T`

Lists all available templates (built-in + custom). Selecting one shows:

- Phase structure and task breakdown
- Agent assignments
- Dependency chains
- Estimated time

### Create a Template from Current Plan

Command Palette: **WebFlow: Create Template from Plan**

Saves the current execution plan as a reusable template. You'll be asked for a name and description. If `advanced.customTemplatesDirectory` is set, the template is also saved as a JSON file.

### Import a Template

Command Palette: **WebFlow: Import Template**

Opens a file picker for a `.json` template file. The template is validated and registered for immediate use.

### Export a Template

Command Palette: **WebFlow: Export Template**

Pick a template from the list and save it as a `.json` file that can be shared or version-controlled.

## Configuring Settings

### Quick Configuration

Command Palette: **WebFlow: Configure Agent Preferences**

Two-step quick pick:
1. **Selection strategy**: Intelligent, Round Robin, Prefer Claude/Copilot/Codex
2. **Cost optimization**: Economy, Balanced, Performance

Command Palette: **WebFlow: Configure Approval Rules**

Set trust levels for each agent (minimal, standard, elevated, full). Higher trust means fewer approval prompts.

### Full Settings Panel

Command Palette: **WebFlow: Open Settings**

Opens a full settings panel with all configuration options organized by section.

### VS Code Settings (JSON)

You can also edit settings directly in `settings.json`:

```json
{
  "webflow.agentPreferences.selectionStrategy": "intelligent",
  "webflow.agentPreferences.costOptimizationLevel": "balanced",
  "webflow.agentPreferences.maxParallelSessions": 3,
  "webflow.approval.agentTrustLevels": {
    "claude": "elevated",
    "copilot": "standard",
    "codex": "standard"
  },
  "webflow.approval.devContainerMode": true,
  "webflow.ui.autoOpenDashboard": true,
  "webflow.ui.notificationVerbosity": "normal",
  "webflow.advanced.sessionTimeoutMs": 300000,
  "webflow.advanced.maxRetries": 3
}
```

### Reset to Defaults

Command Palette: **WebFlow: Reset Settings to Defaults**

Resets all `webflow.*` settings to their default values after a confirmation dialog.

## Settings Reference

### Agent Preferences

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `selectionStrategy` | enum | `intelligent` | `intelligent`, `roundRobin`, `preferClaude`, `preferCopilot`, `preferCodex` |
| `costOptimizationLevel` | enum | `balanced` | `economy`, `balanced`, `performance` |
| `maxParallelSessions` | integer | `3` | 1--10. Max concurrent agent sessions |

### Approval

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoApproveTools` | string[] | `["READ","WEB_SEARCH"]` | Tool types to auto-approve |
| `alwaysDenyTools` | string[] | `["DELETE"]` | Tool types to always block |
| `agentTrustLevels` | object | all `standard` | Per-agent trust: `minimal`, `standard`, `elevated`, `full` |
| `devContainerMode` | boolean | `true` | Permissive approvals in dev containers |
| `productionWorkspace` | boolean | `false` | Restrictive approvals for production |

### UI

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `autoOpenDashboard` | boolean | `true` | Open dashboard when a project starts |
| `notificationVerbosity` | enum | `normal` | `silent`, `minimal`, `normal`, `verbose` |
| `dashboardTheme` | enum | `auto` | `auto`, `light`, `dark` |
| `activityLogLimit` | integer | `100` | 10--500. Max activity log entries |

### Advanced

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `customTemplatesDirectory` | string | `""` | Path to custom template JSON files |
| `benchmarkDataPath` | string | `""` | Path to agent benchmark data |
| `sessionTimeoutMs` | integer | `300000` | 0--3600000. Session timeout in ms |
| `maxRetries` | integer | `3` | 0--10. Retry attempts on failure |
| `retryBaseDelayMs` | integer | `1000` | 100--60000. Base retry delay |
| `telemetryEnabled` | boolean | `false` | Local error frequency tracking |
| `gitCheckpointEnabled` | boolean | `true` | Git commits after each phase |
| `stateCheckpointIntervalMs` | integer | `30000` | 5000--300000. Autosave interval |

## Dashboard

The dashboard is a panel view that shows real-time orchestration status:

- **Phase cards**: each phase with its tasks and completion status
- **Agent stats**: per-agent task counts (completed, failed, in progress)
- **Activity log**: timestamped events showing what each agent is doing
- **Conflict alerts**: when agents produce incompatible outputs

### Dashboard Actions

From the dashboard, you can:

- **Pause** a specific session
- **Resume** a paused session
- **Cancel** a session
- **Retry** a failed task
- **Resolve** a detected conflict

## Quality Gates

Every agent output is automatically validated through 4 quality gates:

1. **Syntax**: checks bracket balancing and unterminated strings in code blocks
2. **Security**: scans for hardcoded passwords, tokens, eval(), SQL injection patterns
3. **Style**: line length, console.log in production code, readonly interface properties (strict mode)
4. **Imports**: circular imports, wildcard `*` imports, node: protocol in browser code

If a gate fails with error severity, the agent is asked to retry with specific feedback about what to fix. The max retry count is configurable via `advanced.maxRetries`.

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Shift+W S` | Start Project |
| `Ctrl+Shift+W D` | Open Dashboard |
| `Ctrl+Shift+W P` | Pause Orchestration |
| `Ctrl+Shift+W R` | Resume Orchestration |
| `Ctrl+Shift+W T` | Browse Templates |

All shortcuts use `Cmd` instead of `Ctrl` on macOS.
