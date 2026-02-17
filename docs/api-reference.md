# API Reference

Public API reference for the WebFlow AI Orchestrator. This covers the main classes and functions available for extension development and customization.

## Intelligence Layer

### `analyzeIntent(input: string): ProjectIntent`

**File:** `src/intelligence/intentAnalyzer.ts`

Parses a natural language project description into a structured intent.

```typescript
const intent = analyzeIntent("Build an e-commerce store with Stripe payments");
// intent.projectType === "ecommerce"
// intent.features === ["payments"]
// intent.complexity === "moderate"
```

**Returns:** `ProjectIntent`

| Field | Type | Description |
|-------|------|-------------|
| `projectType` | `ProjectType` | Detected type: `ecommerce`, `landing`, `dashboard`, `blog`, `portfolio`, `api-only`, `fullstack`, `unknown` |
| `projectTypeConfidence` | `Confidence` | `high`, `medium`, `low` |
| `features` | `Feature[]` | Detected features: `auth`, `payments`, `realtime`, `search`, `cms`, `i18n`, etc. |
| `stackHints` | `StackHint[]` | Detected technologies: `{ name, category, confidence }` |
| `complexity` | `Complexity` | `simple`, `moderate`, `complex`, `enterprise` |
| `rawInput` | `string` | Original input |
| `normalizedInput` | `string` | Lowercased, trimmed input |
| `ambiguities` | `string[]` | Questions the system couldn't resolve |

---

### `WorkflowGenerator`

**File:** `src/intelligence/workflowGenerator.ts`

Generates an execution plan from a project intent.

#### `generate(intent: ProjectIntent): ExecutionPlan`

```typescript
const generator = new WorkflowGenerator();
const plan = generator.generate(intent);
```

**Returns:** `ExecutionPlan`

| Field | Type | Description |
|-------|------|-------------|
| `templateName` | `string` | Name of the selected template |
| `intent` | `ProjectIntent` | The input intent |
| `resolvedStack` | `Record<string, string>` | Resolved technology stack |
| `phases` | `ExecutionPhase[]` | Ordered phases with tasks |
| `estimatedTotalMinutes` | `number` | Total estimated time |
| `stats` | `PlanStats` | `{ totalTasks, tasksByAgent, parallelizableTasks }` |

---

### `AgentSelector`

**File:** `src/intelligence/agentSelector.ts`

Selects the optimal agent for a task based on signals and benchmarks.

#### `recommend(task: ExecutionTask, benchmarks?: BenchmarkStore): AgentRecommendation`

```typescript
const selector = new AgentSelector();
const rec = selector.recommend(task);
// rec.agent === "claude"
// rec.confidence === "high"
// rec.fallbacks === ["copilot", "codex"]
```

**Returns:** `AgentRecommendation`

| Field | Type | Description |
|-------|------|-------------|
| `agent` | `AgentRole` | Recommended agent: `claude`, `copilot`, `codex` |
| `confidence` | `Confidence` | `high`, `medium`, `low` |
| `reasoning` | `string` | Why this agent was chosen |
| `fallbacks` | `AgentRole[]` | Ordered fallback agents |

---

### Template Functions

**File:** `src/intelligence/workflowTemplates.ts`

#### `getTemplates(): readonly WorkflowTemplate[]`

Returns all registered templates (built-in + custom).

#### `findTemplate(projectType: string): WorkflowTemplate`

Finds the best-matching template for a project type. Falls back to the generic template for unknown types.

#### `registerTemplate(template: WorkflowTemplate): void`

Registers a custom template. Custom templates take priority over built-in templates for the same project type.

---

## Orchestration Layer

### `SessionManager`

**File:** `src/orchestration/sessionManager.ts`

Manages the lifecycle of agent sessions.

#### Constructor

```typescript
new SessionManager(
  lmProvider: ILanguageModelProvider,
  emitterFactory: IEventEmitterFactory,
  cancellationFactory: ICancellationTokenSourceFactory,
  agentModelConfig?: AgentModelConfig
)
```

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `createSession(agent, task)` | `Promise<Session>` | Create a new session (does not start it) |
| `pauseSession(sessionId)` | `Promise<void>` | Pause a running session |
| `resumeSession(sessionId)` | `Promise<void>` | Resume a paused session |
| `cancelSession(sessionId)` | `Promise<void>` | Cancel a session |
| `getSessionStatus(id)` | `SessionStatus` | Get current status of a session |
| `getActiveSessions()` | `SessionStatus[]` | Get all active (pending/running/paused) sessions |
| `getAllSessions()` | `SessionStatus[]` | Get all sessions including terminal states |
| `checkAvailability()` | `Promise<AgentAvailability>` | Check which agents have available models |
| `dispose()` | `void` | Clean up all sessions |

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `onSessionStarted` | `SessionStatus` | Session began executing |
| `onProgress` | `SessionProgress` | Streaming progress update |
| `onSessionCompleted` | `SessionStatus` | Session finished successfully |
| `onSessionFailed` | `SessionStatus` | Session failed with error |
| `onSessionCancelled` | `SessionStatus` | Session was cancelled |
| `onSessionPaused` | `SessionStatus` | Session was paused |
| `onSessionResumed` | `SessionStatus` | Session was resumed |

---

### `ContextCoordinator`

**File:** `src/orchestration/contextCoordinator.ts`

Manages cross-agent context sharing via a versioned key-value store.

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `updateFromAgentOutput(output)` | `void` | Ingest declarations from agent output |
| `getContextForTask(task)` | `ContextSubset` | Get relevant context entries for a task |
| `exportStore()` | `ContextStore` | Export the full context store |

---

### `ConflictResolver`

**File:** `src/orchestration/conflictResolver.ts`

Detects conflicts between agent outputs.

#### `detectConflicts(outputs: AgentOutput[]): OutputConflict[]`

Scans outputs for API contract mismatches, duplicate work, file merge conflicts, and contradictory implementations.

---

### `DependencyResolver`

**File:** `src/orchestration/dependencyResolver.ts`

DAG-based task scheduling.

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `topologicalSort(tasks)` | `ExecutionTask[]` | Sort tasks respecting dependencies (throws on cycles) |
| `getExecutionBatches(tasks)` | `ExecutionBatch[]` | Group tasks into parallelizable batches |
| `getScheduleSnapshot(tasks)` | `ScheduleSnapshot` | Full schedule with ready/blocked/completed sets |

---

## Execution Layer

### `AgentFactory`

**File:** `src/execution/agents/agentFactory.ts`

#### `create(role: AgentRole): BaseAgent`

Creates the correct agent subclass for the given role.

```typescript
const factory = new AgentFactory(sessionManager);
const agent = factory.create("claude"); // returns ClaudeAgent
```

#### `createAgent(role: AgentRole, sessionManager: SessionManager): BaseAgent`

Convenience function (standalone, no factory instance needed).

---

### `BaseAgent` (abstract)

**File:** `src/execution/agents/baseAgent.ts`

Abstract base class for all agents.

#### `execute(task, context, onProgress?): Promise<AgentExecutionResult>`

Executes a task: creates session, runs it, parses output, returns result.

**Returns:** `AgentExecutionResult`

| Field | Type | Description |
|-------|------|-------------|
| `output` | `AgentOutput` | `{ taskId, agent, output, declarations? }` |
| `sessionStatus` | `SessionStatus` | Final session status |

---

### `QualityGateRunner`

**File:** `src/execution/qualityGates.ts`

#### `check(output, context): QualityReport`

Run all quality gates against an agent output.

#### `checkWithRetry(output, context, retryState): RetryCheckResult`

Check with retry logic. Returns whether to retry and feedback for the agent.

---

## Error Recovery

### `AgentFallbackCoordinator`

**File:** `src/utils/errorRecovery.ts`

#### `executeWithFallback(task, context, primaryAgent, onProgress?): Promise<AgentExecutionResult>`

Execute a task with automatic agent fallback. Tries agents in order; throws `AllAgentsExhaustedError` when all fail.

---

### `RateLimitQueue`

**File:** `src/utils/errorRecovery.ts`

#### `enqueue(taskId, execute): Promise<AgentExecutionResult>`

Queue a request for rate-limited execution. Throws `RateLimitError` if the queue is full.

#### `getQueueDepth(): number`

Current number of queued requests.

#### `dispose(): void`

Stop draining and reject all pending requests.

---

### `ExecutionStateManager`

**File:** `src/utils/errorRecovery.ts`

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `checkpoint(planId, plan)` | `Promise<void>` | Save a plan checkpoint |
| `loadCheckpoint(planId)` | `Promise<ExecutionPlan \| null>` | Load the last checkpoint |
| `clearCheckpoint(planId)` | `Promise<void>` | Remove a checkpoint |
| `startAutosave(planId, getPlan)` | `void` | Start periodic auto-save |
| `stopAutosave()` | `void` | Stop auto-save |
| `dispose()` | `void` | Clean up |

---

## Error Types

**File:** `src/utils/errors.ts`

All errors extend `WebFlowError`:

| Error Class | Code | Description |
|-------------|------|-------------|
| `WebFlowError` | varies | Base class with `code`, `message`, `userMessage` |
| `AgentFailureError` | `agent-*` | Agent execution failure (wraps `AgentExecutionError`) |
| `AllAgentsExhaustedError` | `all-agents-exhausted` | All fallback agents failed |
| `RateLimitError` | `rate-limit` | Queue full or disposed |
| `ConflictResolutionError` | `conflict-resolution-failed` | Conflict resolution failed |
| `GitOperationError` | `git-operation-failed` | Git command failed |
| `StatePersistenceError` | `state-persistence-failed` | State save/load failed |

### Utility Functions

| Function | Returns | Description |
|----------|---------|-------------|
| `normalizeError(err)` | `{ code, message }` | Normalize any thrown value to `{ code, message }` |
| `getUserMessage(err)` | `string` | Extract a user-safe display message |
| `isAgentExecutionError(err)` | `boolean` | Type guard for `AgentExecutionError` objects |

---

## Settings

### `SettingsService`

**File:** `src/settings/settingsService.ts`

#### `resolve(raw: Record<string, unknown>): { settings, errors }`

Merges raw configuration values with defaults and validates.

#### `validate(settings: WebFlowSettings): ValidationError[]`

Returns an array of validation errors (empty if valid).

#### `DEFAULT_SETTINGS: WebFlowSettings`

The complete default settings object.
