import type {
  Complexity,
  Confidence,
  Feature,
  ProjectIntent,
  ProjectType,
  StackCategory,
  StackHint,
} from "./types";

// ===========================================================================
// Intent Analyzer
//
// Pure heuristic engine — no LLM calls, no async, no side effects.
// Takes a user prompt and returns a structured ProjectIntent describing
// what the user wants to build.
//
// Strategy:
//   1. Normalize the input (lowercase, collapse whitespace)
//   2. Tokenize into words for exact matching
//   3. Run each extractor independently (project type, features, stack, etc.)
//   4. Cross-reference results (e.g. Stripe implies "payments" feature)
//   5. Assess complexity from the combined signals
//   6. Flag ambiguities for follow-up questions
// ===========================================================================

/**
 * Parse a natural language project description into a structured intent.
 *
 * Uses keyword matching and scoring heuristics (no LLM calls) to detect
 * project type, features, stack hints, complexity, and ambiguities.
 *
 * @param rawInput - The user's free-form project description.
 * @returns A fully populated {@link ProjectIntent}.
 */
export function analyzeIntent(rawInput: string): ProjectIntent {
  const normalizedInput = normalize(rawInput);
  const tokens = tokenize(normalizedInput);

  const stackHints = extractStackHints(tokens);
  const features = extractFeatures(tokens, stackHints);
  const { projectType, projectTypeConfidence } = classifyProjectType(
    tokens,
    features,
    stackHints
  );
  const complexity = assessComplexity(features, stackHints, tokens);
  const ambiguities = detectAmbiguities(
    projectType,
    projectTypeConfidence,
    features,
    stackHints,
    tokens
  );

  return {
    projectType,
    projectTypeConfidence,
    features,
    stackHints,
    complexity,
    rawInput,
    normalizedInput,
    ambiguities,
  };
}

// ===========================================================================
// Normalization & tokenization
// ===========================================================================

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A]/g, "'")   // curly single quotes → ascii
    .replace(/[\u201C\u201D\u201E]/g, '"')   // curly double quotes → ascii
    .replace(/["']/g, "")                     // strip all remaining quotes
    .replace(/\s+/g, " ")                     // collapse whitespace
    .trim();
}

/**
 * Splits on word boundaries. Keeps hyphenated terms intact (e.g. "e-commerce")
 * and strips trailing punctuation from each token.
 */
function tokenize(normalized: string): readonly string[] {
  return normalized
    .split(/\s+/)
    .map((t) => t.replace(/[.,;:!?'"()[\]{}]+$/g, ""))
    .filter((t) => t.length > 0);
}

/** Check if any pattern matches anywhere in the normalized string. */
function matchesAny(
  normalized: string,
  patterns: readonly (string | RegExp)[]
): boolean {
  return patterns.some((p) =>
    typeof p === "string" ? normalized.includes(p) : p.test(normalized)
  );
}

/** Check if any token exactly equals one of the given words. */
function hasToken(tokens: readonly string[], words: readonly string[]): boolean {
  return tokens.some((t) => words.includes(t));
}

// ===========================================================================
// Project type classification
//
// We score each project type by counting how many of its indicator patterns
// appear in the input. The type with the highest score wins. Ties are broken
// by declaration order (first match wins).
// ===========================================================================

interface TypeRule {
  readonly type: ProjectType;
  /** Strong indicators — worth 3 points each (e.g. "e-commerce", "dashboard") */
  readonly primary: readonly (string | RegExp)[];
  /** Weaker/contextual signals — worth 1 point each (e.g. "checkout", "shop") */
  readonly secondary: readonly (string | RegExp)[];
}

const TYPE_RULES: readonly TypeRule[] = [
  {
    type: "ecommerce",
    primary: ["e-commerce", "ecommerce", "online store", "shopping cart", "storefront", "marketplace", /e-?commerce\s+platform/],
    secondary: ["product catalog", "shop", /\bstore\b/, "checkout"],
  },
  {
    type: "dashboard",
    primary: ["dashboard", "admin panel", "admin dashboard"],
    secondary: ["analytics dashboard", "control panel", "back office", "backoffice"],
  },
  {
    type: "landing",
    primary: ["landing page", "landing site"],
    secondary: ["one-page", "single page site", "marketing page", "coming soon", "waitlist", "launch page"],
  },
  {
    type: "blog",
    primary: ["blog", "blogging", "news site"],
    secondary: [/\bmdx\b/, "articles", "editorial", "content site", "publication"],
  },
  {
    type: "saas",
    primary: [/\bsaas\b/, "software as a service"],
    secondary: ["subscription", "multi-tenant", "multitenant", "tenant", "freemium"],
  },
  {
    type: "portfolio",
    primary: ["portfolio"],
    secondary: ["personal site", "personal website", "resume site", "showcase"],
  },
  {
    type: "docs",
    primary: ["documentation", /\bdocs\b/, "docsite", "knowledge base"],
    secondary: ["wiki", "api docs", "reference site"],
  },
  {
    type: "api-only",
    primary: ["api only", "api-only", "rest api", "graphql api", "backend only", "backend-only"],
    secondary: ["microservice"],
  },
  {
    type: "fullstack",
    primary: ["fullstack", "full-stack", "full stack"],
    secondary: [/web\s*app/, "application"],
  },
];

function classifyProjectType(
  tokens: readonly string[],
  features: readonly Feature[],
  stackHints: readonly StackHint[]
): { projectType: ProjectType; projectTypeConfidence: Confidence } {
  const normalized = tokens.join(" ");

  // Score each type using weighted pattern matching.
  // Primary patterns (strong indicators like "e-commerce") score 3 points.
  // Secondary patterns (contextual like "checkout") score 1 point.
  // A positional bonus (0–0.9) breaks ties in favor of earlier mentions.
  let bestType: ProjectType = "unknown";
  let bestScore = 0;

  for (const rule of TYPE_RULES) {
    let score = 0;
    let earliestPos = normalized.length;

    const scorePatterns = (
      patterns: readonly (string | RegExp)[],
      weight: number
    ): void => {
      for (const pattern of patterns) {
        let idx = -1;
        if (typeof pattern === "string") {
          idx = normalized.indexOf(pattern);
          if (idx !== -1) score += weight;
        } else {
          const m = pattern.exec(normalized);
          if (m) {
            score += weight;
            idx = m.index;
          }
        }
        if (idx !== -1 && idx < earliestPos) {
          earliestPos = idx;
        }
      }
    };

    scorePatterns(rule.primary, 3);
    scorePatterns(rule.secondary, 1);

    // Positional bonus: earlier mention gets up to +0.9
    if (score > 0 && normalized.length > 0) {
      score += 0.9 * (1 - earliestPos / normalized.length);
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = rule.type;
    }
  }

  // If nothing matched directly, try to infer from features/stack
  if (bestType === "unknown") {
    bestType = inferTypeFromSignals(features, stackHints);
  }

  const projectTypeConfidence = scoreToConfidence(bestScore);

  return { projectType: bestType, projectTypeConfidence };
}

/**
 * When no project-type keywords match, we infer from other signals.
 * E.g. if the user mentioned Stripe + auth, it's likely ecommerce.
 * If they mentioned charts + analytics, it's likely a dashboard.
 */
function inferTypeFromSignals(
  features: readonly Feature[],
  stackHints: readonly StackHint[]
): ProjectType {
  const featureSet = new Set(features);
  const hasPayment = stackHints.some((h) => h.category === "payment");

  if (hasPayment || featureSet.has("payments")) return "ecommerce";
  if (featureSet.has("charts") && featureSet.has("analytics")) return "dashboard";
  if (featureSet.has("cms")) return "blog";
  if (stackHints.some((h) => h.category === "cms")) return "blog";

  return "unknown";
}

function scoreToConfidence(score: number): Confidence {
  if (score >= 6) return "high";
  if (score >= 1) return "medium";
  return "low";
}

// ===========================================================================
// Feature extraction
//
// Each feature has a set of trigger patterns. We also cross-reference
// stack hints — e.g. mentioning "Stripe" implies the "payments" feature
// even if the user didn't say "payments" explicitly.
// ===========================================================================

interface FeatureRule {
  readonly feature: Feature;
  /** Patterns matched against the full normalized string */
  readonly patterns: readonly (string | RegExp)[];
  /** Stack categories that imply this feature */
  readonly impliedByStack?: readonly StackCategory[];
}

const FEATURE_RULES: readonly FeatureRule[] = [
  {
    feature: "auth",
    patterns: [
      "auth",
      "login",
      "sign up",
      "signup",
      "sign-up",
      "signin",
      "sign-in",
      "registration",
      /\boauth\b/,
      /\bjwt\b/,
      /\bsso\b/,
      "user account",
      "user management",
    ],
    impliedByStack: ["auth"],
  },
  {
    feature: "payments",
    patterns: [
      "payment",
      "checkout",
      "billing",
      "subscription",
      "pricing",
      "invoice",
      "charge",
    ],
    impliedByStack: ["payment"],
  },
  {
    feature: "database",
    patterns: ["database", /\bdb\b/, "data store", "persistence", "storage"],
    impliedByStack: ["database", "orm"],
  },
  {
    feature: "cms",
    patterns: [/\bcms\b/, "content management", "headless cms", /\bmdx\b/, "markdown"],
  },
  {
    feature: "analytics",
    patterns: ["analytics", "tracking", "metrics", "telemetry", "insights"],
  },
  {
    feature: "charts",
    patterns: ["chart", "graph", "visualization", "data viz", "plotting", "d3"],
  },
  {
    feature: "search",
    patterns: [
      "search",
      "full-text",
      "fulltext",
      "fuzzy search",
      "algolia",
      "elasticsearch",
      "meilisearch",
    ],
  },
  {
    feature: "file-upload",
    patterns: [
      "file upload",
      "upload",
      "image upload",
      "drag and drop",
      /\bs3\b/,
      "cloud storage",
    ],
  },
  {
    feature: "email",
    patterns: ["email", "newsletter", "mailing", "transactional email", "sendgrid", "resend"],
  },
  {
    feature: "notifications",
    patterns: ["notification", "push notification", "alert", "toast", "websocket"],
  },
  {
    feature: "i18n",
    patterns: [
      /\bi18n\b/,
      "internationalization",
      "localization",
      /\bl10n\b/,
      "multi-language",
      "multilingual",
      "translation",
    ],
  },
  {
    feature: "seo",
    patterns: [/\bseo\b/, "search engine", "meta tags", "sitemap", "open graph"],
  },
  {
    feature: "api",
    patterns: [
      /\bapi\b/,
      /\brest\b/,
      "graphql",
      "endpoint",
      /\btrpc\b/,
      "backend",
      "server",
    ],
  },
  {
    feature: "realtime",
    patterns: [
      "real-time",
      "realtime",
      "live update",
      "websocket",
      /\bws\b/,
      "live data",
      "streaming",
      "chat feature",
    ],
  },
  {
    feature: "admin",
    patterns: ["admin", "back office", "backoffice", "management panel", "control panel"],
  },
  {
    feature: "forms",
    patterns: ["form", "contact form", "survey", "input validation", "form builder"],
  },
  {
    feature: "media",
    patterns: [
      "image",
      "video",
      "gallery",
      "media library",
      "carousel",
      "slider",
      "lightbox",
    ],
  },
  {
    feature: "social",
    patterns: [
      "social",
      "share",
      "like",
      "comment",
      "follow",
      "feed",
      "social login",
      "oauth",
    ],
  },
  {
    feature: "maps",
    patterns: ["map", "geolocation", "location", "mapbox", "leaflet", "google maps"],
  },
];

function extractFeatures(
  tokens: readonly string[],
  stackHints: readonly StackHint[]
): readonly Feature[] {
  const normalized = tokens.join(" ");
  const found = new Set<Feature>();
  const stackCategories = new Set(stackHints.map((h) => h.category));

  for (const rule of FEATURE_RULES) {
    // Direct pattern match
    if (matchesAny(normalized, rule.patterns)) {
      found.add(rule.feature);
      continue;
    }
    // Implied by stack (e.g. Stripe → payments)
    if (rule.impliedByStack?.some((cat) => stackCategories.has(cat))) {
      found.add(rule.feature);
    }
  }

  return [...found];
}

// ===========================================================================
// Tech-stack extraction
//
// We recognize specific technology names and map them to categories.
// Each entry can match against exact tokens or substring patterns.
// ===========================================================================

interface StackRule {
  readonly name: string;
  readonly category: StackCategory;
  /** Exact tokens to match (checked against individual words) */
  readonly tokens?: readonly string[];
  /** Substring/regex patterns matched against the full string */
  readonly patterns?: readonly (string | RegExp)[];
}

const STACK_RULES: readonly StackRule[] = [
  // -- Frameworks --
  { name: "Next.js", category: "framework", tokens: ["next", "nextjs", "next.js"] },
  { name: "Nuxt", category: "framework", tokens: ["nuxt", "nuxtjs", "nuxt.js"] },
  { name: "Remix", category: "framework", tokens: ["remix"] },
  { name: "Astro", category: "framework", tokens: ["astro"] },
  { name: "SvelteKit", category: "framework", tokens: ["sveltekit", "svelte-kit"], patterns: ["svelte kit"] },
  { name: "Svelte", category: "framework", tokens: ["svelte"] },
  { name: "React", category: "framework", tokens: ["react", "reactjs", "react.js"] },
  { name: "Vue", category: "framework", tokens: ["vue", "vuejs", "vue.js"] },
  { name: "Angular", category: "framework", tokens: ["angular"] },
  { name: "Express", category: "framework", tokens: ["express", "expressjs"] },
  { name: "Fastify", category: "framework", tokens: ["fastify"] },
  { name: "Hono", category: "framework", tokens: ["hono"] },
  { name: "Gatsby", category: "framework", tokens: ["gatsby"] },
  { name: "Vite", category: "framework", tokens: ["vite"] },
  { name: "Django", category: "framework", tokens: ["django"] },
  { name: "Rails", category: "framework", tokens: ["rails"], patterns: ["ruby on rails"] },
  { name: "Laravel", category: "framework", tokens: ["laravel"] },
  { name: "Spring Boot", category: "framework", patterns: ["spring boot", "springboot"] },

  // -- Styling --
  { name: "Tailwind CSS", category: "styling", tokens: ["tailwind", "tailwindcss"] },
  { name: "CSS Modules", category: "styling", patterns: ["css modules"] },
  { name: "Styled Components", category: "styling", patterns: ["styled-components", "styled components"] },
  { name: "Sass", category: "styling", tokens: ["sass", "scss"] },
  { name: "shadcn/ui", category: "styling", tokens: ["shadcn"], patterns: ["shadcn/ui", "shadcn ui"] },
  { name: "Material UI", category: "styling", patterns: ["material ui", "material-ui", /\bmui\b/] },
  { name: "Chakra UI", category: "styling", patterns: ["chakra ui", "chakra-ui"] },
  { name: "Radix UI", category: "styling", patterns: ["radix", "radix-ui"] },

  // -- Databases --
  { name: "PostgreSQL", category: "database", tokens: ["postgres", "postgresql", "pg"] },
  { name: "MySQL", category: "database", tokens: ["mysql"] },
  { name: "MongoDB", category: "database", tokens: ["mongodb", "mongo"] },
  { name: "SQLite", category: "database", tokens: ["sqlite"] },
  { name: "Redis", category: "database", tokens: ["redis"] },
  { name: "Supabase", category: "database", tokens: ["supabase"] },
  { name: "Firebase", category: "database", tokens: ["firebase", "firestore"] },
  { name: "PlanetScale", category: "database", tokens: ["planetscale"] },
  { name: "Neon", category: "database", tokens: ["neon"] },
  { name: "Turso", category: "database", tokens: ["turso"] },

  // -- ORMs --
  { name: "Prisma", category: "orm", tokens: ["prisma"] },
  { name: "Drizzle", category: "orm", tokens: ["drizzle"] },
  { name: "TypeORM", category: "orm", tokens: ["typeorm"] },
  { name: "Sequelize", category: "orm", tokens: ["sequelize"] },

  // -- Payments --
  { name: "Stripe", category: "payment", tokens: ["stripe"] },
  { name: "PayPal", category: "payment", tokens: ["paypal"] },
  { name: "LemonSqueezy", category: "payment", tokens: ["lemonsqueezy"], patterns: ["lemon squeezy"] },

  // -- CMS --
  { name: "Contentful", category: "cms", tokens: ["contentful"] },
  { name: "Sanity", category: "cms", tokens: ["sanity"] },
  { name: "Strapi", category: "cms", tokens: ["strapi"] },
  { name: "WordPress", category: "cms", tokens: ["wordpress", "wp"] },
  { name: "Ghost", category: "cms", tokens: ["ghost"] },
  { name: "Payload CMS", category: "cms", tokens: ["payload"] },

  // -- Hosting --
  { name: "Vercel", category: "hosting", tokens: ["vercel"] },
  { name: "Netlify", category: "hosting", tokens: ["netlify"] },
  { name: "AWS", category: "hosting", tokens: ["aws"], patterns: [/\baws\b/] },
  { name: "Cloudflare", category: "hosting", tokens: ["cloudflare"], patterns: ["cloudflare workers", "cloudflare pages"] },
  { name: "Railway", category: "hosting", tokens: ["railway"] },
  { name: "Fly.io", category: "hosting", tokens: ["fly.io", "fly"] },
  { name: "Docker", category: "hosting", tokens: ["docker"] },

  // -- Testing --
  { name: "Jest", category: "testing", tokens: ["jest"] },
  { name: "Vitest", category: "testing", tokens: ["vitest"] },
  { name: "Playwright", category: "testing", tokens: ["playwright"] },
  { name: "Cypress", category: "testing", tokens: ["cypress"] },
  { name: "Testing Library", category: "testing", patterns: ["testing library", "testing-library"] },

  // -- Auth providers --
  { name: "NextAuth", category: "auth", tokens: ["nextauth", "next-auth"], patterns: ["next auth"] },
  { name: "Auth.js", category: "auth", tokens: ["auth.js", "authjs"] },
  { name: "Clerk", category: "auth", tokens: ["clerk"] },
  { name: "Auth0", category: "auth", tokens: ["auth0"] },
  { name: "Lucia", category: "auth", tokens: ["lucia"] },

  // -- API styles --
  { name: "tRPC", category: "api", tokens: ["trpc"], patterns: [/\btrpc\b/] },
  { name: "GraphQL", category: "api", tokens: ["graphql"] },
  { name: "REST", category: "api", patterns: [/\brest\s+api\b/, /\brestful\b/] },

  // -- Languages / runtimes --
  { name: "TypeScript", category: "language", tokens: ["typescript", "ts"] },
  { name: "JavaScript", category: "language", tokens: ["javascript", "js"] },
  { name: "Python", category: "language", tokens: ["python"] },
  { name: "Bun", category: "runtime", tokens: ["bun"] },
  { name: "Deno", category: "runtime", tokens: ["deno"] },
  { name: "Node.js", category: "runtime", tokens: ["node", "nodejs", "node.js"] },
];

function extractStackHints(tokens: readonly string[]): readonly StackHint[] {
  const normalized = tokens.join(" ");
  const found: StackHint[] = [];
  const seen = new Set<string>();

  for (const rule of STACK_RULES) {
    let matchedToken: string | undefined;

    // Try exact token matches first
    if (rule.tokens) {
      matchedToken = rule.tokens.find((rt) => hasToken(tokens, [rt]));
    }

    // Fall back to substring/regex patterns
    if (!matchedToken && rule.patterns) {
      for (const p of rule.patterns) {
        if (typeof p === "string" ? normalized.includes(p) : p.test(normalized)) {
          matchedToken = typeof p === "string" ? p : p.source;
          break;
        }
      }
    }

    if (matchedToken && !seen.has(rule.name)) {
      seen.add(rule.name);
      found.push({
        name: rule.name,
        category: rule.category,
        matchedToken,
      });
    }
  }

  return found;
}

// ===========================================================================
// Complexity assessment
//
// Scored by counting weighted signals:
//   - Feature count (each feature adds 1 point)
//   - Stack diversity (unique categories add 0.5 each)
//   - Complexity keywords in the prompt add extra weight
// ===========================================================================

const COMPLEXITY_KEYWORDS: readonly { pattern: string | RegExp; weight: number }[] = [
  { pattern: "multi-tenant", weight: 3 },
  { pattern: "multitenant", weight: 3 },
  { pattern: "microservice", weight: 3 },
  { pattern: "real-time", weight: 2 },
  { pattern: "realtime", weight: 2 },
  { pattern: /\bi18n\b/, weight: 2 },
  { pattern: "internationalization", weight: 2 },
  { pattern: "scalable", weight: 1 },
  { pattern: "enterprise", weight: 2 },
  { pattern: "production-ready", weight: 1 },
  { pattern: "ci/cd", weight: 1 },
  { pattern: "monorepo", weight: 2 },
  { pattern: "complex", weight: 1 },
  { pattern: "advanced", weight: 1 },
];

function assessComplexity(
  features: readonly Feature[],
  stackHints: readonly StackHint[],
  tokens: readonly string[]
): Complexity {
  const normalized = tokens.join(" ");

  let score = 0;

  // Feature count contribution
  score += features.length;

  // Stack diversity — unique categories
  const categories = new Set(stackHints.map((h) => h.category));
  score += categories.size * 0.5;

  // Complexity keywords
  for (const kw of COMPLEXITY_KEYWORDS) {
    if (typeof kw.pattern === "string") {
      if (normalized.includes(kw.pattern)) score += kw.weight;
    } else if (kw.pattern.test(normalized)) {
      score += kw.weight;
    }
  }

  if (score < 1) return "trivial";
  if (score <= 2) return "simple";
  if (score <= 6) return "moderate";
  return "complex";
}

// ===========================================================================
// Ambiguity detection
//
// Flags things the orchestrator should ask the user about before proceeding.
// ===========================================================================

function detectAmbiguities(
  projectType: ProjectType,
  confidence: Confidence,
  features: readonly Feature[],
  stackHints: readonly StackHint[],
  tokens: readonly string[]
): readonly string[] {
  const ambiguities: string[] = [];
  const normalized = tokens.join(" ");

  // Unknown or low-confidence project type
  if (projectType === "unknown") {
    ambiguities.push(
      "Could not determine the project type. What kind of web project is this? " +
        "(e.g. e-commerce, dashboard, blog, landing page, SaaS)"
    );
  } else if (confidence === "low") {
    ambiguities.push(
      `Detected project type "${projectType}" with low confidence. Please confirm.`
    );
  }

  // No framework specified
  if (!stackHints.some((h) => h.category === "framework")) {
    ambiguities.push(
      "No framework specified. Which framework would you like? " +
        "(e.g. Next.js, Nuxt, Remix, Astro, SvelteKit)"
    );
  }

  // Multiple frameworks detected — user probably means one
  const frameworks = stackHints.filter((h) => h.category === "framework");
  if (frameworks.length > 1) {
    const names = frameworks.map((f) => f.name).join(", ");
    ambiguities.push(
      `Multiple frameworks detected (${names}). Which one is the primary framework?`
    );
  }

  // Auth mentioned but no auth provider
  if (
    features.includes("auth") &&
    !stackHints.some((h) => h.category === "auth")
  ) {
    ambiguities.push(
      "Authentication is needed but no auth provider was specified. " +
        "Options: NextAuth/Auth.js, Clerk, Auth0, Lucia, Supabase Auth"
    );
  }

  // Database feature without a specific database
  if (
    features.includes("database") &&
    !stackHints.some((h) => h.category === "database")
  ) {
    ambiguities.push(
      "A database is needed but none was specified. " +
        "Options: PostgreSQL, MySQL, MongoDB, SQLite, Supabase, Firebase"
    );
  }

  // Vague input (very short prompt)
  if (tokens.length < 4 && ambiguities.length === 0) {
    ambiguities.push(
      "The request is brief. Could you provide more details about " +
        "the features, tech stack, or design requirements?"
    );
  }

  // Conflicting signals
  if (normalized.includes("static") && features.includes("realtime")) {
    ambiguities.push(
      '"Static" and "real-time" were both mentioned. Should parts of the ' +
        "site be static with real-time features, or is it fully dynamic?"
    );
  }

  return ambiguities;
}
