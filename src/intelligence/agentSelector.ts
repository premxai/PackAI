import type {
  AgentAggregate,
  AgentAvailability,
  AgentRecommendation,
  AgentRole,
  BenchmarkEntry,
  BenchmarkStore,
  Complexity,
  ExecutionTask,
  TaskSignals,
} from "./types";

// ===========================================================================
// AgentSelector
//
// Intelligent agent selection system that picks the best AI agent for each
// task based on:
//   1. A static decision matrix (task characteristics → agent affinity)
//   2. Historical benchmark data (learning from past performance)
//   3. Agent availability (fallback when preferred agent is unavailable)
//
// Scoring formula per agent:
//   finalScore = (matrixScore * MATRIX_WEIGHT) + (benchmarkScore * BENCHMARK_WEIGHT)
//
// The matrix score comes from keyword/signal matching. The benchmark score
// comes from historical success rate and quality for similar tasks.
// ===========================================================================

const MATRIX_WEIGHT = 0.7;
const BENCHMARK_WEIGHT = 0.3;

// ---------------------------------------------------------------------------
// Decision matrix — static affinity scores per signal
// ---------------------------------------------------------------------------

/** Each rule maps a signal predicate to per-agent affinity boosts (0–1). */
interface MatrixRule {
  readonly name: string;
  readonly test: (signals: TaskSignals) => boolean;
  readonly scores: Readonly<Record<AgentRole, number>>;
  readonly weight: number;
}

const DECISION_MATRIX: readonly MatrixRule[] = [
  // Architecture & design → Claude excels
  {
    name: "architectural",
    test: (s) => s.isArchitectural,
    scores: { claude: 0.95, copilot: 0.3, codex: 0.5 },
    weight: 1.5,
  },
  // Boilerplate / UI generation → Copilot excels
  {
    name: "boilerplate",
    test: (s) => s.isBoilerplate,
    scores: { claude: 0.4, copilot: 0.9, codex: 0.5 },
    weight: 1.2,
  },
  // Testing → Codex excels
  {
    name: "testing",
    test: (s) => s.isTesting,
    scores: { claude: 0.5, copilot: 0.4, codex: 0.9 },
    weight: 1.3,
  },
  // Async / batch tasks → Codex excels
  {
    name: "async",
    test: (s) => s.isAsync,
    scores: { claude: 0.4, copilot: 0.3, codex: 0.85 },
    weight: 1.0,
  },
  // Complex tasks → Claude excels
  {
    name: "complex",
    test: (s) => s.taskComplexity === "complex" || s.taskComplexity === "moderate",
    scores: { claude: 0.85, copilot: 0.5, codex: 0.6 },
    weight: 1.1,
  },
  // Simple/trivial tasks → Copilot is fast and efficient
  {
    name: "simple",
    test: (s) => s.taskComplexity === "trivial" || s.taskComplexity === "simple",
    scores: { claude: 0.5, copilot: 0.8, codex: 0.6 },
    weight: 0.8,
  },
  // Keyword: security, auth, encryption → Claude
  {
    name: "security-keywords",
    test: (s) =>
      s.keywords.some((k) =>
        /\b(security|auth|encrypt|permission|rbac|jwt|oauth|credential)\b/i.test(k)
      ),
    scores: { claude: 0.9, copilot: 0.3, codex: 0.4 },
    weight: 1.2,
  },
  // Keyword: component, page, layout, style, UI → Copilot
  {
    name: "ui-keywords",
    test: (s) =>
      s.keywords.some((k) =>
        /\b(component|page|layout|style|css|tailwind|ui|button|form|modal|card)\b/i.test(k)
      ),
    scores: { claude: 0.4, copilot: 0.9, codex: 0.3 },
    weight: 1.0,
  },
  // Keyword: test, spec, coverage, assert → Codex
  {
    name: "test-keywords",
    test: (s) =>
      s.keywords.some((k) =>
        /\b(test|spec|coverage|assert|mock|stub|fixture|e2e|integration)\b/i.test(k)
      ),
    scores: { claude: 0.4, copilot: 0.3, codex: 0.9 },
    weight: 1.0,
  },
  // Keyword: database, schema, migration, seed → Claude (design) + Codex (execution)
  {
    name: "database-keywords",
    test: (s) =>
      s.keywords.some((k) =>
        /\b(database|schema|migration|seed|prisma|drizzle|sql|postgres|mongo)\b/i.test(k)
      ),
    scores: { claude: 0.7, copilot: 0.3, codex: 0.7 },
    weight: 1.0,
  },
  // Keyword: API, endpoint, route, middleware → Claude
  {
    name: "api-keywords",
    test: (s) =>
      s.keywords.some((k) =>
        /\b(api|endpoint|route|middleware|handler|controller|rest|graphql)\b/i.test(k)
      ),
    scores: { claude: 0.8, copilot: 0.5, codex: 0.5 },
    weight: 1.0,
  },
  // Keyword: deploy, CI, Docker, config → Codex
  {
    name: "devops-keywords",
    test: (s) =>
      s.keywords.some((k) =>
        /\b(deploy|ci|cd|docker|dockerfile|nginx|vercel|netlify|config|env)\b/i.test(k)
      ),
    scores: { claude: 0.5, copilot: 0.3, codex: 0.8 },
    weight: 0.9,
  },
];

// ---------------------------------------------------------------------------
// Keyword extraction patterns for task prompts
// ---------------------------------------------------------------------------

const KEYWORD_PATTERNS: readonly RegExp[] = [
  /\b(auth|authentication|authorization|login|signup|register|oauth|jwt|session|permission|rbac|credential|encrypt)\b/gi,
  /\b(component|page|layout|style|css|tailwind|ui|button|form|modal|card|responsive|theme)\b/gi,
  /\b(test|spec|coverage|assert|mock|stub|fixture|e2e|integration|unit)\b/gi,
  /\b(database|schema|migration|seed|prisma|drizzle|sql|postgres|mongo|redis)\b/gi,
  /\b(api|endpoint|route|middleware|handler|controller|rest|graphql|webhook)\b/gi,
  /\b(deploy|ci|cd|docker|dockerfile|nginx|vercel|netlify|config|env)\b/gi,
  /\b(security|sanitize|validate|xss|csrf|cors|rate.limit)\b/gi,
  /\b(search|index|elasticsearch|algolia|full.text)\b/gi,
  /\b(email|smtp|sendgrid|notification|push)\b/gi,
  /\b(payment|stripe|checkout|invoice|subscription|billing)\b/gi,
  /\b(scaffold|init|setup|install|configure|boilerplate)\b/gi,
  /\b(refactor|optimize|performance|cache|lazy|bundle)\b/gi,
  /\b(review|audit|analyze|lint|format)\b/gi,
];

// ---------------------------------------------------------------------------
// Signal patterns for boolean flags
// ---------------------------------------------------------------------------

const ARCHITECTURAL_PATTERNS =
  /\b(architect|design|plan|structure|schema|model|api\s+design|system\s+design|data\s+model|review|audit|security)\b/i;

const BOILERPLATE_PATTERNS =
  /\b(scaffold|boilerplate|generate|create\s+component|create\s+page|stub|template|layout|ui\s+component|form|crud)\b/i;

const TESTING_PATTERNS =
  /\b(test|spec|coverage|e2e|integration\s+test|unit\s+test|assert|mock)\b/i;

const ASYNC_PATTERNS =
  /\b(batch|background|async|queue|cron|schedule|migrate|seed|deploy|ci|lint|format)\b/i;

// ===========================================================================
// AgentSelector class
// ===========================================================================

/**
 * Scores tasks against agent capabilities using a weighted decision matrix
 * and optional historical benchmark data to select the optimal AI agent.
 *
 * Scoring formula: `finalScore = (matrixScore * 0.7) + (benchmarkScore * 0.3)`
 *
 * @see {@link extractSignals} for how task characteristics are detected.
 */
export class AgentSelector {
  private benchmarks: BenchmarkStore;

  constructor(benchmarks?: BenchmarkStore) {
    this.benchmarks = benchmarks ?? createEmptyStore();
  }

  /**
   * Recommend the best agent for a given task.
   * Takes agent availability into account for fallback logic.
   */
  recommend(
    task: ExecutionTask,
    availability: AgentAvailability = { claude: true, copilot: true, codex: true }
  ): AgentRecommendation {
    const signals = extractSignals(task);
    const matrixScores = this.computeMatrixScores(signals);
    const benchmarkScores = this.computeBenchmarkScores(task.id, signals);

    // Combine matrix and benchmark scores
    const finalScores: Record<AgentRole, number> = {
      claude:
        matrixScores.claude * MATRIX_WEIGHT +
        benchmarkScores.claude * BENCHMARK_WEIGHT,
      copilot:
        matrixScores.copilot * MATRIX_WEIGHT +
        benchmarkScores.copilot * BENCHMARK_WEIGHT,
      codex:
        matrixScores.codex * MATRIX_WEIGHT +
        benchmarkScores.codex * BENCHMARK_WEIGHT,
    };

    // Sort agents by score descending
    const ranked = (Object.entries(finalScores) as [AgentRole, number][]).sort(
      (a, b) => b[1] - a[1]
    );

    // Pick the best available agent
    let bestAgent: AgentRole = ranked[0]![0];
    let bestScore = ranked[0]![1];

    for (const [agent, score] of ranked) {
      if (availability[agent]) {
        bestAgent = agent;
        bestScore = score;
        break;
      }
    }

    // Build fallback list (other available agents, ordered by score)
    const fallbacks: AgentRole[] = [];
    for (const [agent] of ranked) {
      if (agent !== bestAgent && availability[agent]) {
        fallbacks.push(agent);
      }
    }

    // Compute confidence: high score + big gap from runner-up = high confidence
    const scores = ranked.map(([, s]) => s);
    const gap = scores.length >= 2 ? scores[0]! - scores[1]! : 0;
    const confidence = Math.min(1, bestScore * 0.6 + gap * 2);

    const reason = this.buildExplanation(bestAgent, signals, matrixScores, benchmarkScores);

    return {
      agent: bestAgent,
      confidence: Math.round(confidence * 100) / 100,
      reason,
      fallbacks,
    };
  }

  /**
   * Record a benchmark entry and update aggregates.
   */
  recordBenchmark(entry: BenchmarkEntry): void {
    const entries = [...this.benchmarks.entries, entry];
    const aggregates = recomputeAggregates(entries);
    this.benchmarks = { version: 1, entries, aggregates };
  }

  /**
   * Get the current benchmark store (for serialization).
   */
  getBenchmarks(): BenchmarkStore {
    return this.benchmarks;
  }

  /**
   * Load benchmark data (e.g. from disk).
   */
  loadBenchmarks(store: BenchmarkStore): void {
    this.benchmarks = store;
  }

  // -------------------------------------------------------------------------
  // Matrix scoring
  // -------------------------------------------------------------------------

  private computeMatrixScores(
    signals: TaskSignals
  ): Record<AgentRole, number> {
    const scores: Record<AgentRole, number> = { claude: 0, copilot: 0, codex: 0 };
    let totalWeight = 0;

    for (const rule of DECISION_MATRIX) {
      if (rule.test(signals)) {
        scores.claude += rule.scores.claude * rule.weight;
        scores.copilot += rule.scores.copilot * rule.weight;
        scores.codex += rule.scores.codex * rule.weight;
        totalWeight += rule.weight;
      }
    }

    // Normalize to 0–1 range
    if (totalWeight > 0) {
      scores.claude /= totalWeight;
      scores.copilot /= totalWeight;
      scores.codex /= totalWeight;
    } else {
      // No rules matched — use template agent preference as baseline
      const base = signals.templateAgent;
      scores[base] = 0.7;
      const others = (["claude", "copilot", "codex"] as AgentRole[]).filter(
        (a) => a !== base
      );
      for (const other of others) {
        scores[other] = 0.3;
      }
    }

    return scores;
  }

  // -------------------------------------------------------------------------
  // Benchmark scoring
  // -------------------------------------------------------------------------

  private computeBenchmarkScores(
    taskId: string,
    _signals: TaskSignals
  ): Record<AgentRole, number> {
    const scores: Record<AgentRole, number> = { claude: 0.5, copilot: 0.5, codex: 0.5 };

    // Try exact task ID match first, then fall back to task type prefix
    const taskType = taskId.replace(/-\d+$/, "");
    const agg = this.benchmarks.aggregates[taskId] ?? this.benchmarks.aggregates[taskType];

    if (!agg) return scores;

    for (const agent of ["claude", "copilot", "codex"] as AgentRole[]) {
      const agentAgg = agg[agent];
      if (!agentAgg || agentAgg.attempts === 0) continue;

      // Weighted combination of success rate and quality
      const successRate = agentAgg.successes / agentAgg.attempts;
      const quality = agentAgg.avgQualityScore;
      scores[agent] = successRate * 0.6 + quality * 0.4;
    }

    return scores;
  }

  // -------------------------------------------------------------------------
  // Explanation builder
  // -------------------------------------------------------------------------

  private buildExplanation(
    agent: AgentRole,
    signals: TaskSignals,
    matrixScores: Record<AgentRole, number>,
    benchmarkScores: Record<AgentRole, number>
  ): string {
    const reasons: string[] = [];

    const agentLabels: Record<AgentRole, string> = {
      claude: "Claude",
      copilot: "Copilot",
      codex: "Codex",
    };
    const label = agentLabels[agent];

    // Signal-based reasons
    if (agent === "claude") {
      if (signals.isArchitectural) reasons.push("task involves architecture/design decisions");
      if (signals.taskComplexity === "complex" || signals.taskComplexity === "moderate") {
        reasons.push("task is moderately-to-highly complex");
      }
    }
    if (agent === "copilot") {
      if (signals.isBoilerplate) reasons.push("task involves boilerplate/UI generation");
      if (signals.taskComplexity === "trivial" || signals.taskComplexity === "simple") {
        reasons.push("task is straightforward");
      }
    }
    if (agent === "codex") {
      if (signals.isTesting) reasons.push("task involves testing");
      if (signals.isAsync) reasons.push("task can run asynchronously");
    }

    // Template agreement
    if (signals.templateAgent === agent) {
      reasons.push("matches template recommendation");
    }

    // Benchmark-based reason
    const bmScore = benchmarkScores[agent];
    if (bmScore > 0.7) {
      reasons.push("strong historical performance on similar tasks");
    }

    // Matrix score dominance
    const mScore = matrixScores[agent];
    const otherMax = Math.max(
      ...( ["claude", "copilot", "codex"] as AgentRole[])
        .filter((a) => a !== agent)
        .map((a) => matrixScores[a])
    );
    if (mScore - otherMax > 0.2) {
      reasons.push("significantly outscores alternatives on signal analysis");
    }

    if (reasons.length === 0) {
      reasons.push("best overall score across decision criteria");
    }

    return `${label} selected: ${reasons.join("; ")}.`;
  }
}

// ===========================================================================
// Signal extraction
// ===========================================================================

/**
 * Extract scoring signals from a task's prompt, label, and metadata.
 *
 * Detects keywords (auth, component, test, etc.), boolean flags
 * (isArchitectural, isBoilerplate, isTesting, isAsync), and infers
 * complexity from the task's estimated duration.
 */
export function extractSignals(task: ExecutionTask): TaskSignals {
  const prompt = task.prompt;
  const label = task.label;
  const combined = `${label} ${prompt}`;

  // Extract keywords
  const keywordSet = new Set<string>();
  for (const pattern of KEYWORD_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(combined)) !== null) {
      keywordSet.add(match[1]!.toLowerCase());
    }
  }

  // Determine complexity from estimated minutes
  let taskComplexity: Complexity;
  if (task.estimatedMinutes <= 3) {
    taskComplexity = "trivial";
  } else if (task.estimatedMinutes <= 8) {
    taskComplexity = "simple";
  } else if (task.estimatedMinutes <= 20) {
    taskComplexity = "moderate";
  } else {
    taskComplexity = "complex";
  }

  return {
    templateAgent: task.agent,
    keywords: [...keywordSet],
    isArchitectural: ARCHITECTURAL_PATTERNS.test(combined),
    isBoilerplate: BOILERPLATE_PATTERNS.test(combined),
    isTesting: TESTING_PATTERNS.test(combined),
    isAsync: ASYNC_PATTERNS.test(combined),
    taskComplexity,
  };
}

// ===========================================================================
// Benchmark helpers
// ===========================================================================

/** Create an empty {@link BenchmarkStore} with no entries or aggregates. */
export function createEmptyStore(): BenchmarkStore {
  return { version: 1, entries: [], aggregates: {} };
}

/**
 * Recompute per-agent aggregate statistics from raw benchmark entries.
 *
 * Groups entries by task type and agent, then calculates success rate,
 * average duration, and average quality score for each combination.
 */
export function recomputeAggregates(
  entries: readonly BenchmarkEntry[]
): Record<string, Record<AgentRole, AgentAggregate>> {
  const groups = new Map<string, Map<AgentRole, BenchmarkEntry[]>>();

  for (const entry of entries) {
    if (!groups.has(entry.taskType)) {
      groups.set(entry.taskType, new Map());
    }
    const agentMap = groups.get(entry.taskType)!;
    if (!agentMap.has(entry.agent)) {
      agentMap.set(entry.agent, []);
    }
    agentMap.get(entry.agent)!.push(entry);
  }

  const result: Record<string, Record<AgentRole, AgentAggregate>> = {};

  for (const [taskType, agentMap] of groups) {
    const agentAggregates: Record<AgentRole, AgentAggregate> = {
      claude: { attempts: 0, successes: 0, avgDurationSeconds: 0, avgQualityScore: 0 },
      copilot: { attempts: 0, successes: 0, avgDurationSeconds: 0, avgQualityScore: 0 },
      codex: { attempts: 0, successes: 0, avgDurationSeconds: 0, avgQualityScore: 0 },
    };

    for (const [agent, agentEntries] of agentMap) {
      const attempts = agentEntries.length;
      const successes = agentEntries.filter((e) => e.success).length;
      const avgDuration =
        agentEntries.reduce((sum, e) => sum + e.durationSeconds, 0) / attempts;
      const avgQuality =
        agentEntries.reduce((sum, e) => sum + e.qualityScore, 0) / attempts;

      agentAggregates[agent] = {
        attempts,
        successes,
        avgDurationSeconds: Math.round(avgDuration * 10) / 10,
        avgQualityScore: Math.round(avgQuality * 100) / 100,
      };
    }

    result[taskType] = agentAggregates;
  }

  return result;
}
