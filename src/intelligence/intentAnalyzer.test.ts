import { describe, it, expect } from "vitest";
import { analyzeIntent } from "./intentAnalyzer";
import type { Feature, ProjectType, StackCategory } from "./types";

// ---------------------------------------------------------------------------
// Helpers — keep assertions readable
// ---------------------------------------------------------------------------

function hasFeature(input: string, feature: Feature): void {
  const intent = analyzeIntent(input);
  expect(intent.features, `"${input}" should have feature "${feature}"`).toContain(feature);
}

function hasStack(input: string, name: string, category?: StackCategory): void {
  const intent = analyzeIntent(input);
  const match = intent.stackHints.find((h) => h.name === name);
  expect(match, `"${input}" should detect stack "${name}"`).toBeDefined();
  if (category) {
    expect(match!.category).toBe(category);
  }
}

function hasProjectType(input: string, type: ProjectType): void {
  const intent = analyzeIntent(input);
  expect(intent.projectType, `"${input}" → expected type "${type}" but got "${intent.projectType}"`).toBe(type);
}

// ===========================================================================
// Test suite
// ===========================================================================

describe("analyzeIntent", () => {
  // -------------------------------------------------------------------------
  // Core example inputs from the requirements
  // -------------------------------------------------------------------------

  describe("example inputs", () => {
    it("Build an e-commerce site with Stripe", () => {
      const intent = analyzeIntent("Build an e-commerce site with Stripe");

      expect(intent.projectType).toBe("ecommerce");
      expect(intent.projectTypeConfidence).not.toBe("low");
      expect(intent.features).toContain("payments");
      expect(intent.stackHints).toContainEqual(
        expect.objectContaining({ name: "Stripe", category: "payment" })
      );
      expect(intent.complexity).not.toBe("trivial");
    });

    it("I need a landing page for my SaaS product", () => {
      const intent = analyzeIntent("I need a landing page for my SaaS product");

      // "landing page" is a stronger signal than "SaaS" here
      expect(intent.projectType).toBe("landing");
      expect(intent.features.length).toBeGreaterThanOrEqual(0);
    });

    it("Create a dashboard with charts and user authentication", () => {
      const intent = analyzeIntent(
        "Create a dashboard with charts and user authentication"
      );

      expect(intent.projectType).toBe("dashboard");
      expect(intent.features).toContain("charts");
      expect(intent.features).toContain("auth");
    });

    it("Blog with MDX support", () => {
      const intent = analyzeIntent("Blog with MDX support");

      expect(intent.projectType).toBe("blog");
      expect(intent.features).toContain("cms");
    });
  });

  // -------------------------------------------------------------------------
  // Project type classification
  // -------------------------------------------------------------------------

  describe("project type classification", () => {
    const cases: [string, ProjectType][] = [
      ["online store for handmade crafts", "ecommerce"],
      ["product catalog with shopping cart", "ecommerce"],
      ["marketplace for digital assets", "ecommerce"],
      ["admin dashboard for managing users", "dashboard"],
      ["analytics dashboard with real-time data", "dashboard"],
      ["marketing landing page", "landing"],
      ["coming soon page with email signup", "landing"],
      ["personal blog with tags and categories", "blog"],
      ["news site with articles and editors", "blog"],
      ["SaaS platform with multi-tenant support", "saas"],
      ["subscription-based service", "saas"],
      ["personal portfolio showcasing projects", "portfolio"],
      ["API documentation site", "docs"],
      ["knowledge base for our product", "docs"],
      ["REST API backend only", "api-only"],
      ["GraphQL API microservice", "api-only"],
      ["full-stack web app with auth", "fullstack"],
    ];

    it.each(cases)('"%s" → %s', (input, expectedType) => {
      hasProjectType(input, expectedType);
    });
  });

  // -------------------------------------------------------------------------
  // Feature extraction
  // -------------------------------------------------------------------------

  describe("feature extraction", () => {
    it("detects auth from various phrasings", () => {
      hasFeature("app with user login", "auth");
      hasFeature("add sign up and sign in", "auth");
      hasFeature("OAuth integration", "auth");
      hasFeature("JWT-based authentication", "auth");
      hasFeature("SSO support", "auth");
    });

    it("detects payments", () => {
      hasFeature("with checkout flow", "payments");
      hasFeature("billing and invoices", "payments");
      hasFeature("subscription pricing page", "payments");
    });

    it("detects database needs", () => {
      hasFeature("needs a database", "database");
      hasFeature("with data persistence", "database");
    });

    it("detects CMS features", () => {
      hasFeature("headless CMS integration", "cms");
      hasFeature("MDX content", "cms");
      hasFeature("content management system", "cms");
    });

    it("detects realtime features", () => {
      hasFeature("real-time notifications", "realtime");
      hasFeature("live updates via websocket", "realtime");
      hasFeature("streaming data", "realtime");
    });

    it("detects i18n", () => {
      hasFeature("i18n support for 5 languages", "i18n");
      hasFeature("multi-language site", "i18n");
      hasFeature("internationalization required", "i18n");
    });

    it("detects search", () => {
      hasFeature("with full-text search", "search");
      hasFeature("algolia search integration", "search");
    });

    it("detects file upload", () => {
      hasFeature("image upload to S3", "file-upload");
      hasFeature("drag and drop file upload", "file-upload");
    });

    it("infers features from stack hints", () => {
      // Stripe → payments
      const withStripe = analyzeIntent("site with Stripe");
      expect(withStripe.features).toContain("payments");

      // Prisma → database
      const withPrisma = analyzeIntent("app using Prisma");
      expect(withPrisma.features).toContain("database");

      // Clerk → auth
      const withClerk = analyzeIntent("site with Clerk");
      expect(withClerk.features).toContain("auth");
    });
  });

  // -------------------------------------------------------------------------
  // Tech stack extraction
  // -------------------------------------------------------------------------

  describe("stack extraction", () => {
    it("detects frameworks", () => {
      hasStack("build with Next.js", "Next.js", "framework");
      hasStack("using remix and tailwind", "Remix", "framework");
      hasStack("nuxt 3 project", "Nuxt", "framework");
      hasStack("sveltekit app", "SvelteKit", "framework");
      hasStack("astro static site", "Astro", "framework");
      hasStack("vue.js frontend", "Vue", "framework");
      hasStack("angular dashboard", "Angular", "framework");
    });

    it("detects styling libraries", () => {
      hasStack("styled with tailwindcss", "Tailwind CSS", "styling");
      hasStack("using shadcn/ui components", "shadcn/ui", "styling");
      hasStack("material ui design", "Material UI", "styling");
      hasStack("sass stylesheets", "Sass", "styling");
    });

    it("detects databases", () => {
      hasStack("postgres database", "PostgreSQL", "database");
      hasStack("mongodb backend", "MongoDB", "database");
      hasStack("supabase for data", "Supabase", "database");
      hasStack("firebase app", "Firebase", "database");
    });

    it("detects ORMs", () => {
      hasStack("using prisma ORM", "Prisma", "orm");
      hasStack("drizzle for queries", "Drizzle", "orm");
    });

    it("detects payment providers", () => {
      hasStack("stripe integration", "Stripe", "payment");
      hasStack("paypal checkout", "PayPal", "payment");
    });

    it("detects auth providers", () => {
      hasStack("clerk authentication", "Clerk", "auth");
      hasStack("using next-auth", "NextAuth", "auth");
      hasStack("auth0 login", "Auth0", "auth");
    });

    it("detects hosting/deployment", () => {
      hasStack("deploy to vercel", "Vercel", "hosting");
      hasStack("netlify hosting", "Netlify", "hosting");
      hasStack("docker container", "Docker", "hosting");
    });

    it("detects testing frameworks", () => {
      hasStack("jest unit tests", "Jest", "testing");
      hasStack("playwright e2e", "Playwright", "testing");
      hasStack("vitest for testing", "Vitest", "testing");
    });

    it("detects multiple stacks from one input", () => {
      const intent = analyzeIntent(
        "Next.js app with Tailwind, Prisma, PostgreSQL, and Stripe"
      );

      const names = intent.stackHints.map((h) => h.name);
      expect(names).toContain("Next.js");
      expect(names).toContain("Tailwind CSS");
      expect(names).toContain("Prisma");
      expect(names).toContain("PostgreSQL");
      expect(names).toContain("Stripe");
    });

    it("does not double-count the same technology", () => {
      const intent = analyzeIntent("react react react nextjs next next.js");
      const reactCount = intent.stackHints.filter((h) => h.name === "React").length;
      const nextCount = intent.stackHints.filter((h) => h.name === "Next.js").length;
      expect(reactCount).toBe(1);
      expect(nextCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Complexity assessment
  // -------------------------------------------------------------------------

  describe("complexity", () => {
    it("trivial for minimal requests", () => {
      const intent = analyzeIntent("simple page");
      expect(intent.complexity).toBe("trivial");
    });

    it("simple for basic projects", () => {
      const intent = analyzeIntent("blog with MDX");
      expect(intent.complexity).toBe("simple");
    });

    it("moderate for multi-feature projects", () => {
      const intent = analyzeIntent(
        "dashboard with charts, auth, and search"
      );
      expect(["moderate", "complex"]).toContain(intent.complexity);
    });

    it("complex for enterprise-grade requests", () => {
      const intent = analyzeIntent(
        "enterprise multi-tenant SaaS with real-time collaboration, " +
          "i18n, payments, auth, admin panel, and analytics dashboard"
      );
      expect(intent.complexity).toBe("complex");
    });

    it("complexity increases with stack diversity", () => {
      const minimal = analyzeIntent("a website");
      const loaded = analyzeIntent(
        "Next.js with Tailwind, Prisma, PostgreSQL, Stripe, Clerk, Vitest"
      );
      expect(complexityRank(loaded.complexity)).toBeGreaterThan(
        complexityRank(minimal.complexity)
      );
    });
  });

  // -------------------------------------------------------------------------
  // Ambiguity detection
  // -------------------------------------------------------------------------

  describe("ambiguity detection", () => {
    it("flags unknown project type", () => {
      const intent = analyzeIntent("build something cool");
      expect(intent.ambiguities.some((a) => a.includes("project type"))).toBe(true);
    });

    it("flags missing framework", () => {
      const intent = analyzeIntent("e-commerce site with Stripe");
      expect(intent.ambiguities.some((a) => a.includes("framework"))).toBe(true);
    });

    it("does NOT flag missing framework when one is specified", () => {
      const intent = analyzeIntent("Next.js e-commerce site with Stripe");
      expect(intent.ambiguities.some((a) => a.includes("No framework"))).toBe(false);
    });

    it("flags multiple frameworks", () => {
      const intent = analyzeIntent("app with React and Vue");
      expect(
        intent.ambiguities.some((a) => a.includes("Multiple frameworks"))
      ).toBe(true);
    });

    it("flags auth without provider", () => {
      const intent = analyzeIntent("app with user login");
      expect(
        intent.ambiguities.some((a) => a.includes("auth provider"))
      ).toBe(true);
    });

    it("does NOT flag auth when provider is given", () => {
      const intent = analyzeIntent("app with Clerk authentication");
      expect(
        intent.ambiguities.some((a) => a.includes("auth provider"))
      ).toBe(false);
    });

    it("flags conflicting static + realtime", () => {
      const intent = analyzeIntent("static site with real-time updates");
      expect(
        intent.ambiguities.some((a) => a.includes("Static") || a.includes("static"))
      ).toBe(true);
    });

    it("flags very short prompts", () => {
      const intent = analyzeIntent("a website");
      expect(intent.ambiguities.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles empty string", () => {
      const intent = analyzeIntent("");
      expect(intent.projectType).toBe("unknown");
      expect(intent.features).toHaveLength(0);
      expect(intent.stackHints).toHaveLength(0);
      expect(intent.ambiguities.length).toBeGreaterThan(0);
    });

    it("handles whitespace-only input", () => {
      const intent = analyzeIntent("   \n\t  ");
      expect(intent.projectType).toBe("unknown");
    });

    it("handles very long input", () => {
      const longInput =
        "I want to build a really comprehensive e-commerce platform. " +
        "It should have user authentication with OAuth and SSO, " +
        "Stripe payments with subscription support, " +
        "a PostgreSQL database with Prisma ORM, " +
        "real-time inventory updates via WebSocket, " +
        "full-text search with Algolia, " +
        "image uploads to S3, email notifications via SendGrid, " +
        "i18n for 12 languages, SEO optimization, " +
        "an admin dashboard with charts and analytics, " +
        "deploy to Vercel with Docker containers. " +
        "Use Next.js with TypeScript and Tailwind CSS.";

      const intent = analyzeIntent(longInput);

      expect(intent.projectType).toBe("ecommerce");
      expect(intent.complexity).toBe("complex");
      expect(intent.features.length).toBeGreaterThan(5);
      expect(intent.stackHints.length).toBeGreaterThan(5);
    });

    it("handles mixed case and smart quotes", () => {
      const intent = analyzeIntent("Build a \u201CNExt.JS\u201D App with \u2018Tailwind\u2019");
      const names = intent.stackHints.map((h) => h.name);
      expect(names).toContain("Next.js");
      expect(names).toContain("Tailwind CSS");
    });

    it("handles punctuation-heavy input", () => {
      const intent = analyzeIntent(
        "e-commerce!!! with stripe... and auth?? (next.js)"
      );
      expect(intent.projectType).toBe("ecommerce");
      expect(intent.stackHints.map((h) => h.name)).toContain("Stripe");
    });

    it("preserves rawInput exactly", () => {
      const raw = "  Build a Blog  ";
      const intent = analyzeIntent(raw);
      expect(intent.rawInput).toBe(raw);
      expect(intent.normalizedInput).toBe("build a blog");
    });

    it("does not crash on special regex characters in input", () => {
      expect(() =>
        analyzeIntent("app with [brackets] and (parens) and $dollars")
      ).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Inference from signals (no direct keywords)
  // -------------------------------------------------------------------------

  describe("type inference from signals", () => {
    it("infers ecommerce from Stripe without explicit type keyword", () => {
      const intent = analyzeIntent("website with Stripe payments");
      expect(intent.projectType).toBe("ecommerce");
    });

    it("infers dashboard from charts + analytics", () => {
      const intent = analyzeIntent("app with charts and analytics tracking");
      expect(intent.projectType).toBe("dashboard");
    });

    it("infers blog from CMS hint", () => {
      const intent = analyzeIntent("site using Sanity for content");
      expect(intent.projectType).toBe("blog");
    });
  });
});

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function complexityRank(c: string): number {
  return { trivial: 0, simple: 1, moderate: 2, complex: 3 }[c] ?? -1;
}
