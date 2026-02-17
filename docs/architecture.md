# Architecture Overview

This document describes the system design of the PackAI VS Code extension.

## Design Principles

1. **Dependency inversion** -- Business logic never imports `vscode`. Only three boundary files touch VS Code APIs: `extension.ts`, `src/orchestration/vscodeAdapters.ts`, and `src/ui/*.ts`. Everything else is pure TypeScript, fully testable with Vitest.

2. **Layered architecture** -- The codebase has 6 layers. Each layer only depends on layers below it:

```
┌──────────────────────────────────────────────────┐
│  extension.ts  +  src/commands/                  │  VS Code entry point
├──────────────────────────────────────────────────┤
│  src/ui/                                         │  Webview providers
├──────────────────────────────────────────────────┤
│  src/execution/                                  │  Agent execution + quality
├──────────────────────────────────────────────────┤
│  src/orchestration/                              │  Sessions + coordination
├──────────────────────────────────────────────────┤
│  src/intelligence/                               │  NLP + planning
├──────────────────────────────────────────────────┤
│  src/settings/  +  src/utils/                    │  Config + error handling
└──────────────────────────────────────────────────┘
```

3. **Interface-driven DI** -- Core services accept interfaces (e.g., `ILanguageModelProvider`, `IEventEmitterFactory`, `IStateStore`) injected via constructors. Tests inject mocks; production injects VS Code adapters.

4. **Typed protocols** -- All webview communication uses discriminated union message types (`DashboardMessage`, `DashboardAction`, `SettingsMessage`, `SettingsAction`). No `any` types in the protocol layer.

## Module Responsibilities

### `src/intelligence/` -- Natural Language Processing and Planning

**No VS Code imports.** Pure business logic.

| File | Responsibility |
|------|---------------|
| `intentAnalyzer.ts` | Parses natural language into a `ProjectIntent` (project type, features, complexity, stack hints, ambiguities) using keyword matching and scoring heuristics |
| `workflowGenerator.ts` | Takes a `ProjectIntent` and produces an `ExecutionPlan` by selecting a `WorkflowTemplate`, resolving the stack, and computing stats |
| `workflowTemplates.ts` | Registry of 5 built-in templates (e-commerce, landing, dashboard, blog, fallback). Supports `registerTemplate()` for custom templates |
| `agentSelector.ts` | Scores each task against agent capabilities using task signals (category, complexity, parallelizability) and optional benchmark data. Returns an `AgentRecommendation` with confidence and fallbacks |
| `types.ts` | All shared types: `ProjectIntent`, `ExecutionPlan`, `ExecutionPhase`, `ExecutionTask`, `WorkflowTemplate`, `AgentRole`, etc. |

**Data flow:**

```
User prompt  ──►  analyzeIntent()  ──►  ProjectIntent
                                            │
                          WorkflowGenerator.generate()
                                            │
                                      ExecutionPlan
                                            │
                            AgentSelector.recommend()
                                            │
                              Tasks with agent assignments
```

### `src/orchestration/` -- Session Management and Coordination

| File | Responsibility |
|------|---------------|
| `sessionManager.ts` | Creates and manages `Session` instances. Provides lifecycle methods (`pauseSession`, `resumeSession`, `cancelSession`) and event emitters for all state transitions |
| `session.ts` | Individual session execution. Handles streaming LLM responses, retry logic, pause/resume buffering, cancellation via tokens |
| `contextCoordinator.ts` | Maintains a versioned `ContextStore` of key-value entries scoped by domain (project, database, api, auth). Agents declare outputs; downstream tasks receive relevant context subsets |
| `conflictResolver.ts` | Detects conflicts between agent outputs: API contract mismatches, duplicate work, file merge conflicts, contradictory implementations. Provides resolution options |
| `dependencyResolver.ts` | Topological sort of tasks respecting `dependsOn` edges. Detects cycles, computes execution batches for parallelization, and tracks blocked tasks |
| `retry.ts` | Error classification (transient vs. permanent), exponential backoff with jitter, retry config resolution |
| `sessionViewAdapter.ts` | Maps `SessionState` to VS Code chat participant status codes |
| `vscodeAdapters.ts` | Thin adapters wrapping VS Code APIs behind interfaces: `VsCodeLanguageModelProvider`, `VsCodeEventEmitterFactory`, `VsCodeCancellationTokenSourceFactory`, `VsCodeStateStoreAdapter` |
| `types.ts` | `SessionStatus`, `SessionProgress`, `SessionConfig`, `RetryConfig`, all DI interfaces |

**Session lifecycle:**

```
SessionManager.createSession(agent, task)
        │
        ▼
    Session (pending)
        │  .run()
        ▼
    Session (running)  ──── streams LLM response ────►  output buffer
        │                                                    │
   pause() / resume()                                   on complete
        │                                                    │
        ▼                                                    ▼
    Session (paused)                              Session (completed)
        │                                                or
    resume()                                     Session (failed)
```

### `src/execution/` -- Agent Execution and Quality

| File | Responsibility |
|------|---------------|
| `agents/baseAgent.ts` | Abstract base class with shared execute() logic: creates session, runs it, parses output, emits progress events. Subclasses override `buildSystemPrompt()` and `parseOutput()` |
| `agents/claudeAgent.ts` | Claude-specific system prompt (architecture focus, structured output format) and output parsing |
| `agents/copilotAgent.ts` | Copilot-specific system prompt (code generation focus, framework patterns) |
| `agents/codexAgent.ts` | Codex-specific system prompt (background tasks, batch operations) |
| `agents/agentFactory.ts` | Factory pattern: `create(role: AgentRole)` returns the correct agent subclass |
| `toolApprover.ts` | Evaluates tool use requests against approval settings and trust levels. Returns approve/deny/ask decisions |
| `qualityGates.ts` | 4 quality gates (SyntaxGate, SecurityGate, StyleGate, ImportGate) run against agent output. `QualityGateRunner` aggregates results and supports retry-with-feedback |

### `src/ui/` -- Webview Providers

| File | Responsibility |
|------|---------------|
| `dashboardProvider.ts` | `WebviewViewProvider` for the dashboard panel. Subscribes to SessionManager events and posts typed messages to the webview. Handles user actions (pause/resume/cancel) |
| `dashboardProtocol.ts` | `DashboardMessage` (extension-to-webview) and `DashboardAction` (webview-to-extension) union types. `DashboardStateBuilder` constructs state snapshots |
| `settingsProvider.ts` | Full-tab `WebviewPanel` for settings. Reads/writes via `ISettingsProvider` |
| `settingsProtocol.ts` | Settings message protocol types |

### `src/commands/` -- Command Palette Integration

| File | Responsibility |
|------|---------------|
| `index.ts` | `CommandDeps` interface and `registerAllCommands()` that wires all command modules |
| `startProject.ts` | Quick-pick project wizard: type selection, intent analysis, plan generation, dashboard feed |
| `manageOrchestration.ts` | Pause/resume/cancel sessions, view details, retry tasks, resolve conflicts |
| `templates.ts` | Browse, create, import, export workflow templates |
| `settings.ts` | Quick-pick shortcuts for agent preferences, approval rules, reset |

### `src/settings/` -- Configuration

| File | Responsibility |
|------|---------------|
| `settingsService.ts` | `DEFAULT_SETTINGS`, `resolveSettings()` (merges raw config with defaults), `validateSettings()` (returns validation errors) |
| `vscodeSettingsAdapter.ts` | Reads `packai.*` config keys via VS Code API, writes via `updateSetting()` |
| `types.ts` | `PackAISettings` with nested `AgentPreferencesSettings`, `ApprovalSettings`, `UiSettings`, `AdvancedSettings` |

### `src/utils/` -- Error Handling and Telemetry

| File | Responsibility |
|------|---------------|
| `errors.ts` | `PackAIError` base class with typed subclasses: `AgentFailureError`, `AllAgentsExhaustedError`, `RateLimitError`, `ConflictResolutionError`, `GitOperationError`, `StatePersistenceError`. Also: `normalizeError()`, `getUserMessage()`, `isAgentExecutionError()` |
| `errorRecovery.ts` | `AgentFallbackCoordinator` (tries fallback agents on failure), `RateLimitQueue` (FIFO drain queue), `ExecutionStateManager` (checkpoint/resume/autosave), `NodeGitService` (git operations for rollback) |
| `telemetry.ts` | `ErrorFrequencyTracker` for local error diagnostics (no external data sent) |

## Cross-Cutting Concerns

### Context Sharing Between Agents

When Agent A completes a task, it declares outputs (e.g., `{ domain: "database", key: "orm", value: "Prisma" }`). The `ContextCoordinator` stores these as versioned `ContextEntry` objects. When Agent B starts a dependent task, `getContextForTask()` builds a `ContextSubset` with relevant entries from domains the task needs.

### Conflict Detection

After multiple agents complete tasks, the `ConflictResolver` scans their outputs for:

- **API contract conflicts**: same endpoint with different request/response schemas
- **Duplicate work**: overlapping file paths or feature implementations
- **File merge conflicts**: conflicting changes to the same file
- **Contradictory implementations**: incompatible architectural decisions

Each conflict includes severity, involved agents, and resolution options.

### Error Recovery Chain

```
Task execution fails
        │
        ▼
AgentFallbackCoordinator
  try primary agent ──► fail ──► try fallback 1 ──► fail ──► try fallback 2
        │                                                          │
     success                                                  AllAgentsExhaustedError
        │
        ▼
Rate limit? ──► RateLimitQueue.enqueue() ──► drain on interval
        │
        ▼
ExecutionStateManager.checkpoint() ──► periodic autosave
```

## Testing Architecture

- **741 tests** across 26 files
- **88% statement coverage** (80% threshold enforced)
- **Unit tests**: one test file per source module, using shared factories from `src/test/fixtures.ts`
- **Integration tests** (`src/test/integration/`): compose real modules end-to-end
  - `projectScenario.test.ts` -- full e-commerce project from input to validated plan
  - `orchestrationFlow.test.ts` -- intent through agent execution to dashboard state
  - `errorRecoveryFlow.test.ts` -- fallback chains, rate limiting, state persistence
- **VS Code mock** (`src/test/mocks/vscode.ts`): aliased via `vitest.config.ts` so all `import * as vscode from "vscode"` resolves to the mock in tests
