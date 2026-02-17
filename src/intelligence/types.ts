// ---------------------------------------------------------------------------
// Project types — the vocabulary of web projects we recognize
// ---------------------------------------------------------------------------

export type ProjectType =
  | "ecommerce"
  | "landing"
  | "dashboard"
  | "blog"
  | "portfolio"
  | "saas"
  | "docs"
  | "api-only"
  | "fullstack"
  | "unknown";

// ---------------------------------------------------------------------------
// Feature categories — capabilities a project might need
// ---------------------------------------------------------------------------

export type Feature =
  | "auth"
  | "payments"
  | "database"
  | "cms"
  | "analytics"
  | "charts"
  | "search"
  | "file-upload"
  | "email"
  | "notifications"
  | "i18n"
  | "seo"
  | "api"
  | "realtime"
  | "admin"
  | "forms"
  | "media"
  | "social"
  | "maps";

// ---------------------------------------------------------------------------
// Tech stack — frameworks, libraries, and services the user mentioned
// ---------------------------------------------------------------------------

export type StackCategory =
  | "framework"
  | "styling"
  | "database"
  | "payment"
  | "cms"
  | "hosting"
  | "testing"
  | "language"
  | "runtime"
  | "orm"
  | "auth"
  | "api";

export interface StackHint {
  readonly name: string;
  readonly category: StackCategory;
  /** The raw token that matched (e.g. "tailwind", "stripe") */
  readonly matchedToken: string;
}

// ---------------------------------------------------------------------------
// Complexity — drives which agent(s) we pick and how deep the plan is
// ---------------------------------------------------------------------------

export type Complexity = "trivial" | "simple" | "moderate" | "complex";

// ---------------------------------------------------------------------------
// Confidence — how sure we are about each extracted field
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";

// ---------------------------------------------------------------------------
// ProjectIntent — the fully-analyzed output of the intent analyzer
// ---------------------------------------------------------------------------

export interface ProjectIntent {
  /** Best-guess project type */
  readonly projectType: ProjectType;
  /** How confident we are in the project type classification */
  readonly projectTypeConfidence: Confidence;
  /** Detected features the user wants */
  readonly features: readonly Feature[];
  /** Technology stack hints extracted from the prompt */
  readonly stackHints: readonly StackHint[];
  /** Overall complexity assessment */
  readonly complexity: Complexity;
  /** The original user input, preserved for downstream use */
  readonly rawInput: string;
  /** Normalized (lowercased, trimmed) input used for analysis */
  readonly normalizedInput: string;
  /** Ambiguities or things we couldn't resolve — useful for follow-up questions */
  readonly ambiguities: readonly string[];
}

// ===========================================================================
// Workflow & Execution Plan types
// ===========================================================================

/** Which AI agent is best suited for a given task */
export type AgentRole = "claude" | "copilot" | "codex";

/** Task lifecycle state */
export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

/** Phase lifecycle state */
export type PhaseStatus = "pending" | "running" | "completed" | "failed";

// ---------------------------------------------------------------------------
// Task — the atomic unit of work an agent performs
// ---------------------------------------------------------------------------

export interface TaskDefinition {
  /** Unique id within the workflow (e.g. "setup-db") */
  readonly id: string;
  /** Human-readable label shown in the UI */
  readonly label: string;
  /** Detailed instruction prompt sent to the agent */
  readonly prompt: string;
  /** Which agent should execute this task */
  readonly agent: AgentRole;
  /** IDs of tasks that must finish before this one starts */
  readonly dependsOn: readonly string[];
  /** Which features this task implements — used for conditional inclusion */
  readonly forFeatures?: readonly Feature[];
  /** Estimated minutes (for UI progress display) */
  readonly estimatedMinutes: number;
  /** If true, this task runs in parallel with siblings that share no deps */
  readonly parallelizable: boolean;
}

// ---------------------------------------------------------------------------
// Phase — a logical stage grouping related tasks
// ---------------------------------------------------------------------------

export interface PhaseDefinition {
  /** Unique id (e.g. "scaffold", "implement", "test") */
  readonly id: string;
  /** Display label */
  readonly label: string;
  /** Description shown as progress context */
  readonly description: string;
  /** Ordered tasks within this phase */
  readonly tasks: readonly TaskDefinition[];
}

// ---------------------------------------------------------------------------
// WorkflowTemplate — a reusable recipe for a project type
// ---------------------------------------------------------------------------

export interface WorkflowTemplate {
  /** Which project type(s) this template applies to */
  readonly forProjectTypes: readonly ProjectType[];
  /** Human-readable name */
  readonly name: string;
  /** One-line description */
  readonly description: string;
  /** Ordered phases */
  readonly phases: readonly PhaseDefinition[];
  /** Default stack recommendations when the user didn't specify */
  readonly defaultStack: Readonly<Record<StackCategory, string | undefined>>;
}

// ---------------------------------------------------------------------------
// ExecutionPlan — a concrete, customized plan ready to execute
// ---------------------------------------------------------------------------

export interface ExecutionTask extends TaskDefinition {
  status: TaskStatus;
}

export interface ExecutionPhase {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly tasks: ExecutionTask[];
  status: PhaseStatus;
}

export interface ExecutionPlan {
  /** Where this plan came from */
  readonly templateName: string;
  /** The intent that produced it */
  readonly intent: ProjectIntent;
  /** Resolved stack (user hints merged with template defaults) */
  readonly resolvedStack: Readonly<Record<string, string>>;
  /** Concrete phases with mutable status */
  readonly phases: ExecutionPhase[];
  /** Total estimated minutes across all tasks */
  readonly estimatedTotalMinutes: number;
  /** Summary statistics */
  readonly stats: {
    readonly totalTasks: number;
    readonly tasksByAgent: Readonly<Record<AgentRole, number>>;
    readonly parallelizableTasks: number;
  };
}

// ===========================================================================
// Agent Selection types
// ===========================================================================

/** Signals extracted from a task that influence agent selection */
export interface TaskSignals {
  /** The task's declared agent preference from the template */
  readonly templateAgent: AgentRole;
  /** Keywords found in the task prompt */
  readonly keywords: readonly string[];
  /** Whether the task involves architecture/design decisions */
  readonly isArchitectural: boolean;
  /** Whether the task involves boilerplate/repetitive code generation */
  readonly isBoilerplate: boolean;
  /** Whether the task involves testing */
  readonly isTesting: boolean;
  /** Whether the task can run asynchronously (no user interaction) */
  readonly isAsync: boolean;
  /** Estimated complexity from the task's estimated minutes */
  readonly taskComplexity: Complexity;
}

/** A single agent recommendation with reasoning */
export interface AgentRecommendation {
  /** The recommended agent */
  readonly agent: AgentRole;
  /** Confidence in this recommendation (0–1) */
  readonly confidence: number;
  /** Human-readable explanation of why this agent was chosen */
  readonly reason: string;
  /** Ranked alternatives if primary is unavailable */
  readonly fallbacks: readonly AgentRole[];
}

/** A single benchmark data point recording how an agent performed */
export interface BenchmarkEntry {
  /** Which agent executed the task */
  readonly agent: AgentRole;
  /** Task ID for correlation */
  readonly taskId: string;
  /** Task type category (e.g. "setup-auth", "generate-ui") */
  readonly taskType: string;
  /** Whether the task succeeded */
  readonly success: boolean;
  /** Execution time in seconds */
  readonly durationSeconds: number;
  /** Quality score assigned by user or heuristic (0–1) */
  readonly qualityScore: number;
  /** ISO timestamp */
  readonly timestamp: string;
}

/** Persistent benchmark store shape (serialized to .packai/benchmarks.json) */
export interface BenchmarkStore {
  readonly version: 1;
  readonly entries: readonly BenchmarkEntry[];
  /** Aggregated win rates per agent per task type */
  readonly aggregates: Readonly<
    Record<string, Readonly<Record<AgentRole, AgentAggregate>>>
  >;
}

/** Per-agent aggregate stats for a task type */
export interface AgentAggregate {
  readonly attempts: number;
  readonly successes: number;
  readonly avgDurationSeconds: number;
  readonly avgQualityScore: number;
}

/** Which agents are currently available in the environment */
export interface AgentAvailability {
  readonly claude: boolean;
  readonly copilot: boolean;
  readonly codex: boolean;
}
