# Changelog

All notable changes to the WebFlow AI Orchestrator are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-17

### Added

#### Intelligence Layer
- Natural language intent analysis (`analyzeIntent`) with project type detection, feature extraction, stack hints, and complexity scoring
- Workflow generator that produces multi-phase execution plans from project intents
- 5 built-in workflow templates: E-commerce Store, Landing Page, SaaS Dashboard, Blog/Content Site, Generic Web Project
- Template registry with `registerTemplate()`, `getTemplates()`, `findTemplate()` for custom templates
- Intelligent agent selector with task signal extraction, scoring, and benchmark support

#### Orchestration Layer
- Session manager with full lifecycle (create, run, pause, resume, cancel)
- Individual session execution with LLM streaming, retry logic, and cancellation tokens
- Cross-agent context sharing via `ContextCoordinator` with versioned key-value store
- Conflict detection for API contracts, duplicate work, file merges, and contradictory implementations
- DAG-based dependency resolver with topological sort, batch scheduling, and cycle detection
- Retry logic with exponential backoff, jitter, and error classification
- Session state to VS Code chat status mapping

#### Execution Layer
- Agent base class with shared execute/parse/progress logic
- Claude agent with architecture-focused system prompts
- Copilot agent with code generation-focused prompts
- Codex agent with background task-focused prompts
- Agent factory pattern for role-based instantiation
- Tool approver with configurable trust levels and approval rules
- 4 quality gates: syntax, security, style, imports
- Quality gate runner with retry-with-feedback support

#### UI Layer
- Dashboard webview panel with real-time status updates
- Dashboard protocol with typed messages (phase, task, agent, progress, activity, conflict updates)
- Dashboard state builder for constructing snapshots
- Settings webview panel with full configuration UI
- Settings protocol with typed messages

#### Command Palette
- "Start Project" command with quick-pick project type selection
- Orchestration management: pause, resume, cancel, view sessions
- Retry task and resolve conflict commands (wired to dashboard actions)
- Template commands: browse, create from plan, import, export
- Settings commands: configure agents, configure approval, reset to defaults
- 5 keybindings with `Ctrl+Shift+W` chord prefix

#### Settings System
- 20 configuration keys across 4 sections (agent preferences, approval, UI, advanced)
- Settings service with defaults, resolution, and validation
- VS Code settings adapter for reading/writing configuration
- Settings webview panel for visual configuration

#### Error Handling
- Typed error hierarchy with `WebFlowError` base class and 6 specific error types
- Agent fallback coordinator (primary fails, automatically tries next agent)
- Rate limit queue with FIFO drain
- Execution state manager with checkpoint, resume, and autosave
- Git service interface for rollback support
- Error frequency tracker for local diagnostics
- `normalizeError()` and `getUserMessage()` utilities

#### Testing
- 741 tests across 26 test files
- 88% statement coverage, 94% branch coverage, 96% function coverage
- Shared test fixtures with 15 factory helpers and 5 mock infrastructure helpers
- VS Code API mock module (aliased in vitest.config.ts)
- 3 integration test suites: project scenario, orchestration flow, error recovery flow
- Coverage enforcement: 80% thresholds on statements, branches, functions, lines

#### Documentation
- Comprehensive README with quick start, features, commands, and troubleshooting
- Architecture overview documenting all 6 layers
- User guide with step-by-step feature walkthrough
- Template creation guide with field reference and best practices
- Contributing guide with code conventions and PR guidelines
- API reference for all public classes and functions
- 3 example project configurations
- Demo video script

[0.1.0]: https://github.com/your-org/webflow-ai-orchestrator/releases/tag/v0.1.0
