# PackAI — Technical Feasibility Report

> Research date: February 16, 2026
> Target: VS Code Extension coordinating Claude, Codex, and Copilot agents for web development

---

## Executive Summary

**The landscape has shifted dramatically.** VS Code 1.107–1.109 (Nov 2025–Jan 2026) introduced **native multi-agent orchestration** — the ability to run Claude, Codex, and Copilot agents side-by-side with unified session management. This changes our strategy from "build everything from scratch" to **"build a specialized web-development orchestration layer on top of VS Code's native multi-agent infrastructure."**

### Key Finding
VS Code already provides the plumbing (agent sessions, handoffs, subagents, tool system). What's **missing** is an opinionated, web-development-focused orchestration layer that intelligently routes tasks to the right agent, manages project scaffolding, and automates multi-step web workflows.

---

## 1. VS Code Extension APIs — What's Available

### 1.1 Chat Participant API (Stable)

The primary API for creating AI-powered extensions. Our orchestrator would register as a chat participant.

**Registration (package.json):**
```json
{
  "contributes": {
    "chatParticipants": [{
      "id": "packai.orchestrator",
      "name": "packai",
      "fullName": "PackAI",
      "description": "Intelligent multi-agent web development coordinator",
      "isSticky": true
    }]
  }
}
```

**Handler implementation:**
```typescript
const handler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
): Promise<vscode.ChatResult> => {
  // Analyze intent, route to appropriate agent
  stream.progress('Analyzing task and selecting optimal agent...');
  stream.markdown('Delegating component scaffolding to Claude...');
  stream.button({ command: 'packai.viewPlan', title: 'View Execution Plan' });
  return { metadata: { agentUsed: 'claude', taskType: 'scaffold' } };
};

const participant = vscode.chat.createChatParticipant('packai.orchestrator', handler);
```

**Response streaming capabilities:**
```typescript
stream.progress(message)        // Status updates
stream.markdown(text)           // Rich text responses
stream.button(command, title)   // Interactive buttons
stream.reference(uri)           // File references
stream.anchor(location, title)  // Code locations
stream.filetree(tree, base)     // File tree visualization
```

**Slash commands for routing:**
```json
{
  "commands": [
    { "name": "scaffold", "description": "Generate project structure with optimal agent" },
    { "name": "component", "description": "Create a UI component" },
    { "name": "api", "description": "Build API endpoints" },
    { "name": "test", "description": "Generate and run tests" },
    { "name": "review", "description": "Multi-agent code review" },
    { "name": "deploy", "description": "Prepare for deployment" }
  ]
}
```

### 1.2 Language Model API (Stable)

Extensions can access language models (including Copilot's models) via `vscode.lm`:

```typescript
// Select a model
const [model] = await vscode.lm.selectChatModels({
  vendor: 'copilot',
  family: 'gpt-4o'
});

// Send a request
const messages = [vscode.LanguageModelChatMessage.User('Analyze this code...')];
const response = await model.sendRequest(messages, {}, token);

// Stream the response
for await (const chunk of response.text) {
  stream.markdown(chunk);
}
```

**Available model families (as of Feb 2026):**
- Copilot: GPT-4o, GPT-5.2, o1, o3-mini
- Claude: Opus 4.5, Sonnet 4.5
- Codex: Various OpenAI models

### 1.3 Language Model Chat Provider API (Stable)

Register custom language model providers — useful if we want to add models not natively supported:

```typescript
// package.json
{
  "contributes": {
    "languageModelChatProviders": [{
      "vendor": "packai-custom",
      "displayName": "PackAI Custom Models"
    }]
  }
}

// Extension code
vscode.lm.registerLanguageModelChatProvider('packai-custom', {
  async provideLanguageModelChatInformation(options, token) {
    return [{
      id: 'packai-specialized',
      name: 'PackAI Web Dev Specialist',
      family: 'custom',
      version: '1.0.0',
      maxInputTokens: 128000,
      maxOutputTokens: 8192,
      capabilities: { toolCalling: true, imageInput: true }
    }];
  },
  async provideLanguageModelChatResponse(model, messages, options, progress, token) {
    // Route to appropriate backend
    progress.report(new LanguageModelTextPart("Response text"));
  },
  async provideTokenCount(model, text, token) {
    return Math.ceil(text.toString().length / 4);
  }
});
```

### 1.4 Chat Sessions Provider API (Proposed/Experimental)

This is the key API for integrating with VS Code's Agent Sessions view.

**Status:** Proposed — requires `"enabledApiProposals": ["chatSessionsProvider"]` in package.json and use of `@vscode/dts` to get type definitions.

**Core types:**
```typescript
enum ChatSessionStatus {
  Failed = 0,
  Completed = 1,
  InProgress = 2,
  NeedsInput = 3
}

interface ChatSessionItem {
  resource: Uri;
  label: string;
  status: ChatSessionStatus;
  timing: { startTime: number; endTime?: number };
  changes: ChatSessionChangedFile2[];
  metadata: Record<string, unknown>;
}

interface ChatSessionCapabilities {
  supportsInterruptions: boolean;
}
```

**Registration:**
```typescript
// Create a session controller
const controller = vscode.chat.createChatSessionItemController(
  'packai-orchestrator',
  'PackAI Sessions'
);

// Add sessions
controller.items.add(sessionItem);

// Register content provider
vscode.chat.registerChatSessionContentProvider('packai-orchestrator', {
  async provideChatSessionContent(session, token) {
    return {
      history: [...],
      options: { model: 'claude-opus-4.5' },
      requestHandler: async (request) => { /* handle */ }
    };
  }
});
```

**Risk assessment:** This API is proposed and may change. However, it's actively used by the Claude and Codex integrations, making it likely to stabilize.

### 1.5 Custom Agent Files (.agent.md)

VS Code now supports declarative agent definitions:

```markdown
<!-- .github/agents/web-planner.agent.md -->
---
name: web-planner
description: Plans web application architecture
tools: ['fetch', 'githubRepo', 'codebase', 'search']
agents: ['web-implementer', 'web-reviewer']
model: ['Claude Opus 4.5', 'GPT-5.2']
handoffs:
  - label: Start Implementation
    agent: web-implementer
    prompt: Implement the plan outlined above.
    send: false
  - label: Review Code
    agent: web-reviewer
    prompt: Review the implementation for best practices.
---

You are a web application architecture planner. When given a feature request:

1. Analyze the existing codebase structure using #tool:codebase
2. Research best practices using #tool:fetch
3. Create a detailed implementation plan
4. Suggest which files need to be created or modified
```

**Agent handoffs** enable workflow transitions:
- Planner → Implementer → Reviewer
- Each agent can have different tools and model preferences

### 1.6 Agent Tools System

**Built-in tools:** `#fetch`, `#githubRepo`, `#problems`, `#codebase`, `#changes`, `#usages`

**Tool sets (for grouping):**
```json
{
  "contributes": {
    "chatToolSets": {
      "web-dev": {
        "tools": ["fetch", "codebase", "problems", "changes"],
        "description": "Web development tools",
        "icon": "globe"
      }
    }
  }
}
```

**MCP (Model Context Protocol) integration:**
Extensions can register MCP servers to provide additional tools. This is how we'd integrate external services (design systems, CI/CD, deployment platforms).

### 1.7 Workspace & File System APIs (Stable)

```typescript
// File operations
await vscode.workspace.fs.readFile(uri);
await vscode.workspace.fs.writeFile(uri, content);
await vscode.workspace.fs.createDirectory(uri);
await vscode.workspace.fs.stat(uri);

// Workspace edits (atomic multi-file changes)
const edit = new vscode.WorkspaceEdit();
edit.createFile(uri, { contents: buffer });
edit.replace(uri, range, newText);
await vscode.workspace.applyEdit(edit);

// File watchers
const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx,vue}');
watcher.onDidChange(uri => { /* react to changes */ });
```

---

## 2. Claude Code Architecture

### 2.1 Tool System

Claude Code (the CLI/VS Code extension) has access to these tools:
| Tool | Purpose |
|------|---------|
| `Read` | Read files from filesystem |
| `Write` | Create/overwrite files |
| `Edit` | Exact string replacements in files |
| `Bash` | Execute shell commands |
| `Glob` | Fast file pattern matching |
| `Grep` | Content search (ripgrep-based) |
| `WebFetch` | Fetch and process web content |
| `WebSearch` | Search the web |
| `Task` | Launch subagents for parallel work |
| `TodoWrite` | Manage task lists |
| `NotebookEdit` | Edit Jupyter notebooks |
| `AskUserQuestion` | Get user input during execution |

### 2.2 Session Management
- Conversations have automatic context compression as they approach limits
- Subagents (via `Task` tool) run with isolated contexts
- Background agents can run in parallel
- Sessions persist across interactions

### 2.3 .claude/ Directory Structure
```
.claude/
├── CLAUDE.md           # Project-level instructions (loaded into system prompt)
├── settings.json       # Extension settings, permissions
├── agents/             # Custom agent definitions
│   └── *.md            # Agent instruction files
└── projects/           # Project-specific memory
    └── <project>/
        └── memory/
            └── MEMORY.md  # Persistent memory across sessions
```

### 2.4 Claude Agent SDK
- Enables building custom agents using Claude as the backbone
- Supports tool definitions, session management, streaming
- Can be used to create specialized agents (e.g., a web-dev-focused agent)
- VS Code integration allows Claude agents to appear in the Agent Sessions view

---

## 3. Existing Multi-Agent Extensions

### 3.1 What Already Exists

| Extension | Installs | Approach | Limitation |
|-----------|----------|----------|------------|
| **Continue.dev** | 1.6M | Open-source, multi-provider | Not agent-orchestrating; single-agent with provider switching |
| **Cline** | High | Agentic coding in VS Code | Single-agent (Claude-focused), no multi-agent coordination |
| **Roo Code** | Growing | Fork of Cline with enhancements | Still single-agent paradigm |
| **Kilo Code** | Growing | AI coding agent | Single agent, no orchestration |
| **Multi Agents** | New | A2A protocol multi-agent | Early stage, generic (not web-dev focused) |
| **CodeCrew** | New | Multi-agent with chat rewind | Multi-branch conversations, not role-based orchestration |
| **CodeGPT** | Moderate | Multi-provider chat | Basic provider switching, not intelligent routing |
| **VS Code Native** | Built-in | Agent Sessions + Claude/Codex | Generic — no domain-specific orchestration logic |

### 3.2 What's Missing (Our Opportunity)

1. **Intelligent task routing** — No extension analyzes a web development task and routes it to the optimal agent based on task type
2. **Web-development-specific workflows** — No opinionated scaffolding, component generation, API building pipelines
3. **Cross-agent context sharing** — Extensions don't share relevant context between agents intelligently
4. **Quality gates** — No automated review → fix → verify loops using multiple agents
5. **Framework awareness** — No agent that understands React vs Vue vs Svelte patterns and adapts accordingly
6. **Design-to-code pipelines** — No integration of design tokens/Figma with multi-agent code generation

---

## 4. Technical Feasibility Assessment

### 4.1 What's Fully Possible Today (Green Light)

| Capability | API | Status |
|------------|-----|--------|
| Register as a chat participant | `vscode.chat.createChatParticipant` | Stable |
| Access language models (Copilot, Claude) | `vscode.lm.selectChatModels` | Stable |
| Define slash commands for routing | `chatParticipants.commands` | Stable |
| Stream rich responses | `ChatResponseStream` | Stable |
| Read/write workspace files | `vscode.workspace.fs` | Stable |
| Multi-file atomic edits | `WorkspaceEdit` | Stable |
| File watching for live feedback | `FileSystemWatcher` | Stable |
| Tool calling with LM | `vscode.lm.tools` | Stable |
| Register custom tools via extension | Language Model Tools API | Stable |
| Define custom agent files | `.github/agents/*.agent.md` | Stable |
| Define agent handoffs | Handoff YAML config | Stable |
| Provide follow-up suggestions | `participant.followupProvider` | Stable |
| Participant detection/routing | `disambiguation` config | Stable |
| Register custom LM provider | `registerLanguageModelChatProvider` | Stable |

### 4.2 What's Possible with Proposed APIs (Yellow Light)

| Capability | API | Risk |
|------------|-----|------|
| Integrate with Agent Sessions view | `chatSessionsProvider` | Medium — proposed but actively used by Claude/Codex integrations |
| Track session status/changes | `ChatSessionItem` | Medium — API is actively evolving |
| Session content management | `ChatSessionContentProvider` | Medium — may change shape |

### 4.3 What Requires Workarounds (Orange)

| Capability | Challenge | Workaround |
|------------|-----------|------------|
| Direct agent-to-agent communication | No API for inter-agent messaging | Use shared workspace files or custom MCP server as message bus |
| Programmatic agent session creation | Can't spawn Claude/Codex sessions from code | Use `vscode.commands.executeCommand` to trigger chat commands, or use agent handoffs |
| Access other agents' output | No API to read another agent's response stream | Use file system as intermediary; agents write to shared files |
| Model-specific routing at runtime | `selectChatModels` returns available models but can't force agent mode | Use `LanguageModelChatProvider` to proxy requests to specific backends |

### 4.4 Blockers and Limitations (Red)

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Copilot subscription required** | LM API only works with active Copilot subscription | Document requirement; provide fallback for API-key-based access via custom LM provider |
| **One chat participant per extension** | Can't register planner + implementer + reviewer as separate participants | Use slash commands to switch roles within single participant; use `.agent.md` for sub-agents |
| **Proposed API instability** | `chatSessionsProvider` may change | Abstract behind interface; be ready to adapt |
| **128 tool limit per request** | Can't overwhelm with tools | Curate tool sets per task type |
| **No cross-extension agent communication** | Can't directly call Cline, Continue, etc. | Stick to VS Code native agents (Copilot, Claude, Codex) |
| **Terminal sandboxing** | macOS/Linux only for now | Use VS Code's built-in tools instead of shell commands where possible |

---

## 5. Recommended Architecture

### 5.1 High-Level Design

```
┌──────────────────────────────────────────────────────┐
│                    VS Code                            │
│  ┌────────────────────────────────────────────────┐  │
│  │        PackAI Extension        │  │
│  │                                                 │  │
│  │  ┌──────────┐  ┌───────────┐  ┌─────────────┐ │  │
│  │  │  Chat     │  │  Task     │  │  Workflow    │ │  │
│  │  │  Partici- │  │  Router   │  │  Engine      │ │  │
│  │  │  pant     │  │           │  │              │ │  │
│  │  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘ │  │
│  │        │              │               │         │  │
│  │  ┌─────▼──────────────▼───────────────▼──────┐  │  │
│  │  │           Agent Coordinator                │  │  │
│  │  │  ┌─────────┐ ┌─────────┐ ┌──────────────┐│  │  │
│  │  │  │ Claude  │ │ Copilot │ │    Codex     ││  │  │
│  │  │  │ Agent   │ │ Agent   │ │    Agent     ││  │  │
│  │  │  │ Bridge  │ │ Bridge  │ │    Bridge    ││  │  │
│  │  │  └─────────┘ └─────────┘ └──────────────┘│  │  │
│  │  └───────────────────────────────────────────┘  │  │
│  │                                                 │  │
│  │  ┌──────────┐  ┌───────────┐  ┌─────────────┐ │  │
│  │  │  Web Dev  │  │  Context  │  │  Quality    │ │  │
│  │  │  Tools    │  │  Manager  │  │  Gates      │ │  │
│  │  └──────────┘  └───────────┘  └─────────────┘ │  │
│  └────────────────────────────────────────────────┘  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  .github/agents/  (Declarative Agent Configs)    │ │
│  │  ├── web-planner.agent.md                        │ │
│  │  ├── web-implementer.agent.md                    │ │
│  │  ├── web-reviewer.agent.md                       │ │
│  │  ├── web-tester.agent.md                         │ │
│  │  └── web-deployer.agent.md                       │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

### 5.2 Component Breakdown

#### A. Chat Participant (Entry Point)
- Single `@packai` participant with slash commands
- Analyzes user intent, determines workflow
- Streams progress and results back to user

#### B. Task Router (Intelligence Layer)
- Classifies tasks: scaffold, component, API, test, review, deploy
- Selects optimal agent per task type:
  - **Claude** → Complex architecture, refactoring, multi-file changes
  - **Copilot** → Inline completions, quick fixes, framework-specific patterns
  - **Codex** → Async/background tasks, large-scale changes, CI integration
- Considers: task complexity, model strengths, user preference, cost

#### C. Workflow Engine
- Predefined web-dev workflows:
  - `scaffold` → Plan → Generate → Lint → Test
  - `feature` → Plan → Implement → Test → Review
  - `fix` → Diagnose → Fix → Verify → Document
- Custom workflows via `.agent.md` handoff chains

#### D. Agent Bridges
- Abstraction layer per agent type
- Uses `vscode.lm.selectChatModels` for model access
- Falls back to custom `LanguageModelChatProvider` if needed
- Handles agent-specific prompt formatting

#### E. Context Manager
- Shares relevant project context between agent invocations
- Tracks which files each agent has read/modified
- Prevents duplicate work across agents
- Maintains conversation history for multi-step workflows

#### F. Web Dev Tools (MCP + Extension Tools)
- Framework detection (React, Vue, Svelte, Next.js, etc.)
- Component template library
- Design token integration
- Package.json analysis
- Route structure analysis

#### G. Quality Gates
- Automated linting after generation
- Type-checking validation
- Test execution
- Cross-agent code review

### 5.3 Recommended Implementation Strategy

**Phase 1 — Foundation (Weeks 1-2)**
1. Extension scaffold with chat participant registration
2. Task classifier (intent detection from user prompts)
3. Basic agent routing to Claude/Copilot via `vscode.lm`
4. Simple slash commands: `/scaffold`, `/component`, `/api`

**Phase 2 — Agent Orchestration (Weeks 3-4)**
5. `.agent.md` workflow definitions (planner → implementer → reviewer)
6. Agent handoff chains
7. Context manager for cross-agent state
8. Quality gate integration (lint, typecheck, test)

**Phase 3 — Web Dev Intelligence (Weeks 5-6)**
9. Framework detection and template system
10. MCP server for web dev tools (component analysis, route mapping)
11. Design-to-code pipeline
12. Project scaffolding workflows

**Phase 4 — Advanced Features (Weeks 7-8)**
13. Background agent integration for async tasks
14. Session management via proposed `chatSessionsProvider`
15. Cost/performance optimization (smart model selection)
16. User preference learning

### 5.4 Extension Entry Point Skeleton

```typescript
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // 1. Register the main chat participant
  const participant = vscode.chat.createChatParticipant(
    'packai.orchestrator',
    orchestratorHandler
  );

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'icon.svg');

  participant.followupProvider = {
    provideFollowups(result, context, token) {
      const meta = result.metadata as { nextSteps?: string[] };
      return (meta?.nextSteps ?? []).map(step => ({
        prompt: step,
        label: step
      }));
    }
  };

  // 2. Register web dev tools
  context.subscriptions.push(
    vscode.lm.registerTool('packai-detect-framework', new FrameworkDetectorTool()),
    vscode.lm.registerTool('packai-analyze-routes', new RouteAnalyzerTool()),
    vscode.lm.registerTool('packai-scaffold', new ScaffoldTool()),
  );

  // 3. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('packai.viewPlan', showExecutionPlan),
    vscode.commands.registerCommand('packai.selectAgent', selectPreferredAgent),
  );

  context.subscriptions.push(participant);
}

const orchestratorHandler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  const taskType = classifyTask(request.prompt, request.command);
  const agent = selectAgent(taskType);

  stream.progress(`Routing to ${agent.name} for ${taskType}...`);

  // Select the appropriate model
  const [model] = await vscode.lm.selectChatModels({
    vendor: agent.vendor,
    family: agent.family
  });

  if (!model) {
    stream.markdown(`**Error:** ${agent.name} model not available. Falling back...`);
    // Fallback logic
    return { metadata: { error: 'model_unavailable' } };
  }

  // Build context-aware prompt
  const systemPrompt = buildWebDevPrompt(taskType, request.prompt);
  const messages = [
    vscode.LanguageModelChatMessage.User(systemPrompt)
  ];

  // Execute with the selected model
  const response = await model.sendRequest(messages, {}, token);

  for await (const chunk of response.text) {
    stream.markdown(chunk);
  }

  return {
    metadata: {
      agentUsed: agent.name,
      taskType,
      nextSteps: getNextSteps(taskType)
    }
  };
};

function classifyTask(prompt: string, command?: string): TaskType {
  if (command) return commandToTaskType(command);
  // NLP-based classification using keywords and patterns
  // ...
}

function selectAgent(taskType: TaskType): AgentConfig {
  const routing: Record<TaskType, AgentConfig> = {
    'scaffold':  { name: 'Claude', vendor: 'copilot', family: 'claude-opus-4.5' },
    'component': { name: 'Copilot', vendor: 'copilot', family: 'gpt-4o' },
    'api':       { name: 'Claude', vendor: 'copilot', family: 'claude-sonnet-4.5' },
    'test':      { name: 'Codex', vendor: 'copilot', family: 'o3-mini' },
    'review':    { name: 'Claude', vendor: 'copilot', family: 'claude-opus-4.5' },
    'deploy':    { name: 'Copilot', vendor: 'copilot', family: 'gpt-4o' },
  };
  return routing[taskType];
}
```

### 5.5 Example Agent Definition Files

**`.github/agents/web-planner.agent.md`:**
```markdown
---
name: web-planner
description: Plan web application features and architecture
tools: ['codebase', 'fetch', 'githubRepo', 'packai-detect-framework', 'packai-analyze-routes']
model: ['Claude Opus 4.5', 'GPT-5.2']
agents: ['web-implementer']
handoffs:
  - label: Implement Plan
    agent: web-implementer
    prompt: "Implement the architecture plan above. Follow the file structure and patterns specified."
    send: false
---

You are an expert web application architect. When given a feature request:

1. Detect the project's framework using #tool:packai-detect-framework
2. Analyze existing route structure using #tool:packai-analyze-routes
3. Review the codebase for patterns using #tool:codebase
4. Create a detailed, step-by-step implementation plan including:
   - Files to create/modify
   - Component hierarchy
   - State management approach
   - API endpoints needed
   - Testing strategy
```

**`.github/agents/web-implementer.agent.md`:**
```markdown
---
name: web-implementer
description: Implement web features following the plan
tools: ['codebase', 'changes', 'problems', 'packai-scaffold']
model: ['Claude Sonnet 4.5', 'GPT-4o']
agents: ['web-reviewer']
handoffs:
  - label: Review Implementation
    agent: web-reviewer
    prompt: "Review the changes made above for code quality, accessibility, and best practices."
---

You are an expert web developer. Follow the implementation plan exactly.
Use the project's existing patterns, naming conventions, and file structure.
After making changes, verify there are no problems using #tool:problems.
```

---

## 6. Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| `chatSessionsProvider` API changes | Medium | High | Abstract behind interface; implement without it first |
| Copilot subscription dependency | Low | High | Document requirement; provide API-key fallback |
| Model availability varies by plan tier | Medium | Medium | Implement graceful fallback chain |
| Performance with multi-model routing | Medium | Medium | Cache model selections; prefer faster models for classification |
| Rate limiting across multiple models | Low | Medium | Implement request queuing and throttling |
| User confusion with multi-agent output | Medium | Medium | Clear attribution and progress streaming |

---

## 7. Conclusion & Recommendation

**Build it as a "smart layer" on top of VS Code's native multi-agent infrastructure.**

The extension should:
1. **Not rebuild** session management, agent running, or tool execution — VS Code handles that
2. **Focus on** intelligent task routing, web-dev-specific tools, and opinionated workflows
3. **Start with** the stable Chat Participant + Language Model APIs (Phase 1-2)
4. **Adopt proposed APIs** (`chatSessionsProvider`) in Phase 4 when they stabilize
5. **Use `.agent.md`** files for declarative workflow definitions (portable, version-controllable)

This approach minimizes risk while delivering unique value: no existing extension provides web-development-focused multi-agent orchestration with intelligent routing, quality gates, and framework-aware tooling.

---

## Sources

- [VS Code Multi-Agent Development Blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development)
- [VS Code Unified Agent Experience Blog](https://code.visualstudio.com/blogs/2025/11/03/unified-agent-experience)
- [VS Code Agents Overview](https://code.visualstudio.com/docs/copilot/agents/overview)
- [Chat Participant API](https://code.visualstudio.com/api/extension-guides/ai/chat)
- [Language Model Chat Provider API](https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider)
- [Agent Tools Documentation](https://code.visualstudio.com/docs/copilot/agents/agent-tools)
- [Custom Agents Documentation](https://code.visualstudio.com/docs/copilot/customization/custom-agents)
- [VS Code 1.107 Multi-Agent Orchestration (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2025/12/12/vs-code-1-107-november-2025-update-expands-multi-agent-orchestration-model-management.aspx)
- [VS Code 1.108 Agent Skills (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2026/01/12/vs-code-december-2025-update-puts-ai-agent-skills-front-and-center.aspx)
- [VS Code Multi-Agent Orchestration (InfoWorld)](https://www.infoworld.com/article/4105879/visual-studio-code-adds-multi-agent-orchestration.html)
- [Claude Opus 4.5 in Copilot (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2025/12/04/claude-opus-4-5-lands-in-github-copilot-for-visual-studio-and-vs-code.aspx)
- [Copilot Studio Extension GA](https://www.microsoft.com/en-us/microsoft-copilot/blog/copilot-studio/copilot-studio-extension-for-visual-studio-code-generally-available/)
- [Proposed chatSessionsProvider API (GitHub)](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.chatSessionsProvider.d.ts)
- [vscode-chat-extension-utils (GitHub)](https://github.com/microsoft/vscode-chat-extension-utils)
- [Top Agentic AI Tools for VS Code (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2025/10/07/top-agentic-ai-tools-for-vs-code-according-to-installs.aspx)
- [Multi Agents Extension (VS Code Marketplace)](https://marketplace.visualstudio.com/items?itemName=llong.multi-agents)
- [CodeCrew Extension (VS Code Marketplace)](https://marketplace.visualstudio.com/items?itemName=TofighNaghibi.CodeCrew)
