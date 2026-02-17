# WebFlow AI Orchestrator

A VS Code extension that intelligently coordinates **Claude**, **Copilot**, and **Codex** agents to build web projects faster. Instead of switching between AI tools, WebFlow analyzes your project, creates an execution plan, and assigns each task to the best agent automatically.

<!-- TODO: Replace with actual GIF recordings -->
<!-- ![Demo: Start Project](docs/assets/demo-start-project.gif) -->

## What It Does

1. **You describe a project** (e.g., "Build an e-commerce store with Stripe payments")
2. **WebFlow analyzes your intent** and detects project type, features, and complexity
3. **It generates an execution plan** with phased tasks and dependency ordering
4. **Each task is assigned to the optimal agent** based on task characteristics:
   - **Claude** -- architecture, database schemas, complex logic
   - **Copilot** -- boilerplate, UI components, quick edits
   - **Codex** -- background tasks, bulk operations, test generation
5. **A live dashboard** tracks progress, shows conflicts, and lets you pause/resume

## Prerequisites

- [VS Code](https://code.visualstudio.com/) 1.109 or later
- [Node.js](https://nodejs.org/) 20+
- [GitHub Copilot](https://marketplace.visualstudio.com/items?itemName=GitHub.copilot-chat) subscription (for language model access)

## Installation

### From Source (Development)

```bash
git clone https://github.com/your-org/webflow-ai-orchestrator.git
cd webflow-ai-orchestrator
npm install
npm run compile
```

Then press **F5** in VS Code to launch the Extension Development Host.

### From VSIX (Pre-built)

```bash
npm run package    # creates .vsix file
code --install-extension webflow-ai-orchestrator-0.1.0.vsix
```

## Quick Start

1. **Open a workspace** in VS Code (File > Open Folder)
2. **Start a project** via Command Palette: `Ctrl+Shift+P` > "WebFlow: Start Project"
3. **Pick a project type** (E-commerce, Landing Page, Dashboard, Blog, or Custom)
4. **View the execution plan** in the dashboard panel
5. **Use chat** for details: type `@webflow /scaffold Build an online store with Stripe` in the Chat panel

## Features

### Intelligent Intent Analysis

WebFlow parses natural language descriptions and extracts:

- Project type (e-commerce, landing, dashboard, blog, etc.)
- Features (auth, payments, real-time, search, etc.)
- Stack hints (React, Next.js, PostgreSQL, etc.)
- Complexity level (simple, moderate, complex, enterprise)

### Workflow Templates

5 built-in templates with pre-configured task dependencies:

| Template | Phases | Use Case |
|----------|--------|----------|
| E-commerce Store | 3 | Product catalog, cart, checkout, payments |
| Landing Page | 3 | Hero, features, CTA, responsive design |
| SaaS Dashboard | 3 | Auth, data viz, CRUD, real-time updates |
| Blog / Content Site | 3 | CMS, markdown, comments, SEO |
| Generic Web Project | 3 | Fallback for any web project |

You can also create, import, and export custom templates.

### Smart Agent Selection

The `AgentSelector` scores each task against agent capabilities using:

- Task category signals (architecture, UI, testing, etc.)
- Complexity and parallelizability
- Historical benchmark data (when available)
- User preference settings (strategy, cost level)

### Live Dashboard

A webview panel showing:

- Phase progress with task status indicators
- Per-agent stats (tasks completed, failed, in progress)
- Activity log with timestamped events
- Conflict detection and resolution UI

### Orchestration Controls

Manage running sessions from the Command Palette or dashboard:

- Pause / Resume / Cancel all sessions
- View individual session details
- Retry failed tasks
- Resolve conflicts between agent outputs

### Quality Gates

Every agent output is validated through 4 gates:

| Gate | Checks |
|------|--------|
| Syntax | Bracket balancing, unterminated strings |
| Security | Hardcoded secrets, eval() usage, SQL injection patterns |
| Style | Line length, console.log in production, readonly interfaces |
| Imports | Circular imports, wildcard imports, node: protocol |

### Error Recovery

- **Agent fallback**: if Claude fails, automatically tries Copilot, then Codex
- **Rate limit queue**: queues requests when API limits are hit
- **State checkpoints**: auto-saves plan state for crash recovery
- **Typed error hierarchy**: every error has a code, user message, and stack trace

## Command Palette

All commands are under the "WebFlow" category:

| Command | Keybinding | Description |
|---------|------------|-------------|
| Start Project | `Ctrl+Shift+W S` | Create a new project with guided setup |
| Open Dashboard | `Ctrl+Shift+W D` | Focus the orchestration dashboard |
| Open Settings | -- | Open the settings panel |
| Pause Orchestration | `Ctrl+Shift+W P` | Pause all running sessions |
| Resume Orchestration | `Ctrl+Shift+W R` | Resume paused sessions |
| Cancel Orchestration | -- | Cancel all active sessions |
| View Session Details | -- | Inspect individual sessions |
| Browse Templates | `Ctrl+Shift+W T` | View all workflow templates |
| Create Template | -- | Save current plan as a template |
| Import/Export Template | -- | Load or save template JSON files |
| Configure Agents | -- | Quick-pick for agent strategy/cost |
| Configure Approval | -- | Set per-agent trust levels |
| Reset Settings | -- | Restore all settings to defaults |

## Chat Commands

| Command | Description |
|---------|-------------|
| `@webflow` | Freeform web development help |
| `@webflow /scaffold` | Analyze intent and generate execution plan |
| `@webflow /component` | Create a UI component |
| `@webflow /api` | Build API endpoints |
| `@webflow /test` | Generate and run tests |
| `@webflow /review` | Multi-agent code review |

## Configuration

All settings are under the `webflow.*` namespace in VS Code settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `agentPreferences.selectionStrategy` | `intelligent` | How agents are chosen per task |
| `agentPreferences.costOptimizationLevel` | `balanced` | Cost vs. quality tradeoff |
| `agentPreferences.maxParallelSessions` | `3` | Max concurrent agent sessions |
| `approval.agentTrustLevels` | all `standard` | Per-agent approval strictness |
| `approval.devContainerMode` | `true` | Permissive mode in dev containers |
| `ui.autoOpenDashboard` | `true` | Auto-open dashboard on start |
| `ui.notificationVerbosity` | `normal` | Notification frequency |
| `advanced.sessionTimeoutMs` | `300000` | Session timeout (5 min) |
| `advanced.maxRetries` | `3` | Retry attempts on failure |

See [docs/user-guide.md](docs/user-guide.md) for the full settings reference.

## Project Structure

```
vsex/
├── src/
│   ├── commands/           # Command palette integrations
│   │   ├── index.ts        # registerAllCommands + CommandDeps
│   │   ├── startProject.ts # Project creation wizard
│   │   ├── manageOrchestration.ts  # Pause/resume/cancel
│   │   ├── templates.ts    # Template CRUD
│   │   └── settings.ts     # Quick-pick settings
│   ├── intelligence/       # NLP + planning (no vscode imports)
│   │   ├── intentAnalyzer.ts       # Natural language → ProjectIntent
│   │   ├── workflowGenerator.ts    # Intent → ExecutionPlan
│   │   ├── workflowTemplates.ts    # Template registry (5 built-in)
│   │   ├── agentSelector.ts        # Task → AgentRecommendation
│   │   └── types.ts
│   ├── orchestration/      # Session management + coordination
│   │   ├── sessionManager.ts       # Session lifecycle
│   │   ├── session.ts              # Individual session (run/pause/resume)
│   │   ├── contextCoordinator.ts   # Cross-agent context sharing
│   │   ├── conflictResolver.ts     # Output conflict detection
│   │   ├── dependencyResolver.ts   # DAG scheduling
│   │   ├── retry.ts                # Backoff + error classification
│   │   ├── sessionViewAdapter.ts   # State → chat status mapping
│   │   ├── vscodeAdapters.ts       # VS Code API wrappers
│   │   └── types.ts
│   ├── execution/          # Agent execution
│   │   ├── agents/
│   │   │   ├── baseAgent.ts        # Abstract base with shared logic
│   │   │   ├── claudeAgent.ts      # Claude-specific prompting
│   │   │   ├── copilotAgent.ts     # Copilot-specific prompting
│   │   │   ├── codexAgent.ts       # Codex-specific prompting
│   │   │   ├── agentFactory.ts     # Factory for agent creation
│   │   │   └── types.ts
│   │   ├── toolApprover.ts         # Tool use approval logic
│   │   └── qualityGates.ts         # Output validation gates
│   ├── ui/                 # Webview providers
│   │   ├── dashboardProvider.ts    # Dashboard webview
│   │   ├── dashboardProtocol.ts    # Dashboard message types
│   │   ├── settingsProvider.ts     # Settings webview
│   │   └── settingsProtocol.ts     # Settings message types
│   ├── settings/           # Configuration management
│   │   ├── settingsService.ts      # Defaults, validation, resolution
│   │   ├── vscodeSettingsAdapter.ts # VS Code config bridge
│   │   └── types.ts
│   ├── utils/              # Error handling + telemetry
│   │   ├── errors.ts               # Typed error hierarchy
│   │   ├── errorRecovery.ts        # Fallback, rate limiting, state
│   │   └── telemetry.ts            # Local error frequency tracking
│   ├── test/
│   │   ├── mocks/vscode.ts         # VS Code API mock
│   │   ├── fixtures.ts             # Shared test factories
│   │   └── integration/            # Cross-module integration tests
│   └── extension.ts        # Entry point + chat participant
├── media/                   # Webview assets (CSS, JS)
├── docs/                    # Documentation
├── examples/                # Example project configurations
├── package.json             # Extension manifest
├── tsconfig.json            # TypeScript config
└── vitest.config.ts         # Test + coverage config
```

## Testing

```bash
# Run all 741 tests
npm test

# Run with coverage report (requires >80%)
npm run test:coverage

# Run a specific test file
npx vitest run src/intelligence/intentAnalyzer.test.ts

# Watch mode
npx vitest --watch
```

## Troubleshooting

### "No language model available"

GitHub Copilot must be active and signed in. The extension uses the Copilot Language Model API to power all three agent types.

### Agent selection seems wrong

Check your `webflow.agentPreferences.selectionStrategy` setting. The default `intelligent` mode uses task signals; try `preferClaude` or `preferCopilot` to force a specific agent.

### Dashboard not updating

Run "WebFlow: Open Dashboard" from the Command Palette to focus the panel. The dashboard only receives events when it's visible.

### Extension not activating

Ensure your VS Code version is 1.109+ and the extension is enabled. Check the "WebFlow AI Orchestrator" output channel for logs.

### Tests failing after changes

Run `npx tsc --noEmit` first to check for TypeScript errors, then `npx vitest run` to see which tests fail. Integration tests in `src/test/integration/` test cross-module behavior.

## Documentation

- [Architecture Overview](docs/architecture.md) -- system design and module responsibilities
- [User Guide](docs/user-guide.md) -- detailed feature walkthrough
- [Template Creation Guide](docs/template-guide.md) -- creating custom workflow templates
- [Contributing Guide](docs/contributing.md) -- development workflow and conventions
- [API Reference](docs/api-reference.md) -- public API documentation
- [Changelog](CHANGELOG.md) -- version history

## License

MIT
