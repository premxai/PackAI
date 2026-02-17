import type { WorkflowTemplate } from "./types";

// ===========================================================================
// Workflow Templates
//
// Each template is a full DAG of phases → tasks with agent assignments,
// dependency edges, and feature-gated conditional tasks.
//
// Agent assignment rationale:
//   claude  — architecture, complex multi-file generation, refactoring, review
//   copilot — quick single-file generation, boilerplate, framework patterns
//   codex   — async/background tasks, large-scale generation, CI pipelines
//
// To add a custom template: push it to TEMPLATE_REGISTRY via registerTemplate()
// ===========================================================================

// ---------------------------------------------------------------------------
// E-commerce template
// ---------------------------------------------------------------------------

const ecommerceTemplate: WorkflowTemplate = {
  forProjectTypes: ["ecommerce"],
  name: "E-commerce Store",
  description: "Full e-commerce application with products, cart, checkout, and payments",
  defaultStack: {
    framework: "Next.js",
    styling: "Tailwind CSS",
    database: "PostgreSQL",
    payment: "Stripe",
    cms: undefined,
    hosting: "Vercel",
    testing: "Vitest",
    language: "TypeScript",
    runtime: "Node.js",
    orm: "Prisma",
    auth: "Auth.js",
    api: undefined,
  },
  phases: [
    // ── Phase 1: Project scaffold ──────────────────────────────────────
    {
      id: "scaffold",
      label: "Project Setup",
      description: "Initialize project structure, install dependencies, configure tooling",
      tasks: [
        {
          id: "init-project",
          label: "Initialize project",
          prompt:
            "Create a new Next.js project with TypeScript, ESLint, and the app router. " +
            "Set up the directory structure: app/, components/, lib/, types/, and public/. " +
            "Configure tsconfig.json with strict mode.",
          agent: "copilot",
          dependsOn: [],
          estimatedMinutes: 2,
          parallelizable: false,
        },
        {
          id: "setup-styling",
          label: "Configure styling",
          prompt:
            "Install and configure Tailwind CSS with a custom theme. " +
            "Set up a design token system with CSS variables for colors, spacing, and typography. " +
            "Create a globals.css with base styles.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "setup-db",
          label: "Set up database",
          prompt:
            "Install Prisma and configure it for PostgreSQL. " +
            "Create the initial schema with models: User, Product, Category, CartItem, Order, OrderItem. " +
            "Set up relations and indexes. Generate the Prisma client.",
          agent: "claude",
          dependsOn: ["init-project"],
          forFeatures: ["database"],
          estimatedMinutes: 5,
          parallelizable: true,
        },
        {
          id: "setup-auth",
          label: "Configure authentication",
          prompt:
            "Set up Auth.js (NextAuth) with email/password and OAuth providers (Google, GitHub). " +
            "Create the auth configuration, middleware for protected routes, " +
            "and session provider wrapper component.",
          agent: "claude",
          dependsOn: ["setup-db"],
          forFeatures: ["auth"],
          estimatedMinutes: 5,
          parallelizable: true,
        },
      ],
    },

    // ── Phase 2: Core features ─────────────────────────────────────────
    {
      id: "core",
      label: "Core Features",
      description: "Build product catalog, cart, and checkout flow",
      tasks: [
        {
          id: "product-listing",
          label: "Product listing page",
          prompt:
            "Create the product listing page with: grid/list view toggle, " +
            "category filtering, price sorting, pagination, and search. " +
            "Use server components for the initial load with client-side filtering. " +
            "Include product card components with image, title, price, and add-to-cart button.",
          agent: "claude",
          dependsOn: ["setup-db", "setup-styling"],
          estimatedMinutes: 8,
          parallelizable: true,
        },
        {
          id: "product-detail",
          label: "Product detail page",
          prompt:
            "Create the product detail page with: image gallery, description, " +
            "variant selector (size/color), quantity picker, add-to-cart, " +
            "related products section, and breadcrumb navigation.",
          agent: "claude",
          dependsOn: ["setup-db", "setup-styling"],
          estimatedMinutes: 6,
          parallelizable: true,
        },
        {
          id: "cart",
          label: "Shopping cart",
          prompt:
            "Implement the shopping cart: cart context/store for state management, " +
            "cart drawer/page with item list, quantity controls, remove button, " +
            "subtotal calculation, and proceed-to-checkout button. " +
            "Persist cart in localStorage for guests, database for authenticated users.",
          agent: "claude",
          dependsOn: ["product-listing"],
          estimatedMinutes: 6,
          parallelizable: true,
        },
        {
          id: "checkout",
          label: "Checkout flow",
          prompt:
            "Build the multi-step checkout: shipping address form, " +
            "shipping method selection, order summary review, and payment step. " +
            "Integrate Stripe Elements for card input. " +
            "Create the server action for processing payments via Stripe API. " +
            "Handle success/failure states and order confirmation page.",
          agent: "claude",
          dependsOn: ["cart", "setup-auth"],
          forFeatures: ["payments"],
          estimatedMinutes: 10,
          parallelizable: false,
        },
        {
          id: "search-feature",
          label: "Product search",
          prompt:
            "Implement full-text product search with debounced input, " +
            "search results dropdown, and dedicated search results page. " +
            "Use PostgreSQL full-text search via Prisma or integrate Algolia.",
          agent: "copilot",
          dependsOn: ["product-listing"],
          forFeatures: ["search"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
      ],
    },

    // ── Phase 3: Admin & supporting features ───────────────────────────
    {
      id: "admin",
      label: "Admin & Extras",
      description: "Admin panel, email notifications, and supporting features",
      tasks: [
        {
          id: "admin-dashboard",
          label: "Admin dashboard",
          prompt:
            "Create an admin dashboard at /admin with: order management table " +
            "(status, filter, search), product CRUD interface, " +
            "basic analytics cards (revenue, orders, customers). " +
            "Protect with role-based auth middleware.",
          agent: "claude",
          dependsOn: ["checkout"],
          forFeatures: ["admin"],
          estimatedMinutes: 8,
          parallelizable: true,
        },
        {
          id: "email-notifications",
          label: "Email notifications",
          prompt:
            "Set up transactional email for: order confirmation, shipping update, " +
            "and password reset. Create React Email templates. " +
            "Configure Resend or SendGrid as the transport.",
          agent: "copilot",
          dependsOn: ["checkout"],
          forFeatures: ["email"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
        {
          id: "seo-setup",
          label: "SEO optimization",
          prompt:
            "Add SEO metadata to all pages: dynamic titles, descriptions, Open Graph tags. " +
            "Generate a sitemap.xml and robots.txt. " +
            "Add structured data (JSON-LD) for products.",
          agent: "copilot",
          dependsOn: ["product-listing", "product-detail"],
          forFeatures: ["seo"],
          estimatedMinutes: 3,
          parallelizable: true,
        },
      ],
    },

    // ── Phase 4: Testing & polish ──────────────────────────────────────
    {
      id: "test",
      label: "Testing & Review",
      description: "Generate tests, run quality checks, final review",
      tasks: [
        {
          id: "unit-tests",
          label: "Unit tests",
          prompt:
            "Write unit tests for: cart logic, price calculations, " +
            "auth helpers, and API route handlers. Use Vitest with React Testing Library. " +
            "Aim for coverage on all business logic.",
          agent: "codex",
          dependsOn: ["checkout"],
          estimatedMinutes: 8,
          parallelizable: true,
        },
        {
          id: "e2e-tests",
          label: "E2E tests",
          prompt:
            "Write Playwright E2E tests for the critical user flows: " +
            "browse products → add to cart → checkout → order confirmation. " +
            "Include tests for auth flow and admin panel access.",
          agent: "codex",
          dependsOn: ["checkout"],
          estimatedMinutes: 6,
          parallelizable: true,
        },
        {
          id: "code-review",
          label: "Multi-agent code review",
          prompt:
            "Review all generated code for: security vulnerabilities (XSS, CSRF, SQL injection), " +
            "accessibility issues (ARIA, keyboard nav), performance (bundle size, lazy loading), " +
            "and code quality (type safety, error handling). Provide a report with fixes.",
          agent: "claude",
          dependsOn: ["unit-tests", "e2e-tests"],
          estimatedMinutes: 5,
          parallelizable: false,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Landing page template
// ---------------------------------------------------------------------------

const landingTemplate: WorkflowTemplate = {
  forProjectTypes: ["landing"],
  name: "Landing Page",
  description: "Marketing landing page with hero, features, social proof, and CTA",
  defaultStack: {
    framework: "Next.js",
    styling: "Tailwind CSS",
    database: undefined,
    payment: undefined,
    cms: undefined,
    hosting: "Vercel",
    testing: "Vitest",
    language: "TypeScript",
    runtime: "Node.js",
    orm: undefined,
    auth: undefined,
    api: undefined,
  },
  phases: [
    {
      id: "scaffold",
      label: "Project Setup",
      description: "Initialize project with framework and styling",
      tasks: [
        {
          id: "init-project",
          label: "Initialize project",
          prompt:
            "Create a new Next.js project with TypeScript and the app router. " +
            "Minimal structure: app/, components/, public/. " +
            "Install and configure Tailwind CSS with a brand-ready theme.",
          agent: "copilot",
          dependsOn: [],
          estimatedMinutes: 2,
          parallelizable: false,
        },
      ],
    },
    {
      id: "sections",
      label: "Page Sections",
      description: "Build each section of the landing page",
      tasks: [
        {
          id: "hero",
          label: "Hero section",
          prompt:
            "Create a hero section with: headline, subheadline, primary CTA button, " +
            "secondary CTA link, and a hero image/illustration placeholder. " +
            "Make it responsive with a mobile-first layout. " +
            "Add subtle entrance animations with CSS transitions.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 3,
          parallelizable: true,
        },
        {
          id: "features",
          label: "Features grid",
          prompt:
            "Create a features section with a 3-column (desktop) / 1-column (mobile) grid. " +
            "Each feature card has: icon, title, and description. " +
            "Use a reusable FeatureCard component. Include at least 6 placeholder features.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "social-proof",
          label: "Social proof",
          prompt:
            "Create a social proof section with: customer testimonial cards (avatar, quote, name, role), " +
            "logo bar of partner/client logos, and an optional stats bar (users, uptime, etc.).",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "pricing",
          label: "Pricing section",
          prompt:
            "Create a pricing section with 2-3 tier cards. Each card has: " +
            "plan name, price, feature list with check/x icons, and a CTA button. " +
            "Highlight the recommended plan. Support monthly/annual toggle.",
          agent: "copilot",
          dependsOn: ["init-project"],
          forFeatures: ["payments"],
          estimatedMinutes: 3,
          parallelizable: true,
        },
        {
          id: "cta-section",
          label: "CTA section",
          prompt:
            "Create a final CTA section with a compelling headline, short description, " +
            "and a prominent sign-up button or email capture form.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 1,
          parallelizable: true,
        },
        {
          id: "contact-form",
          label: "Contact form",
          prompt:
            "Create a contact form with: name, email, message fields, " +
            "client-side validation, and a server action to handle submissions. " +
            "Include success/error states and rate limiting.",
          agent: "copilot",
          dependsOn: ["init-project"],
          forFeatures: ["forms"],
          estimatedMinutes: 3,
          parallelizable: true,
        },
      ],
    },
    {
      id: "layout",
      label: "Layout & Navigation",
      description: "Header, footer, and page assembly",
      tasks: [
        {
          id: "header",
          label: "Navigation header",
          prompt:
            "Create a responsive navigation header with: logo, nav links, " +
            "mobile hamburger menu with slide-out drawer, and a CTA button. " +
            "Sticky on scroll with background blur effect.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "footer",
          label: "Footer",
          prompt:
            "Create a footer with: logo, link columns (Product, Company, Resources), " +
            "social media icons, and copyright notice. Responsive layout.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 1,
          parallelizable: true,
        },
        {
          id: "assemble-page",
          label: "Assemble page",
          prompt:
            "Compose all sections into the main page in order: " +
            "Header → Hero → Features → Social Proof → Pricing → CTA → Footer. " +
            "Ensure smooth scroll between sections. Add scroll-based reveal animations.",
          agent: "copilot",
          dependsOn: ["hero", "features", "social-proof", "cta-section", "header", "footer"],
          estimatedMinutes: 2,
          parallelizable: false,
        },
      ],
    },
    {
      id: "polish",
      label: "Polish & SEO",
      description: "SEO, performance, and final review",
      tasks: [
        {
          id: "seo-meta",
          label: "SEO & metadata",
          prompt:
            "Add comprehensive SEO: page title, meta description, Open Graph tags, " +
            "Twitter card, favicon, and robots.txt. Generate a sitemap.xml.",
          agent: "copilot",
          dependsOn: ["assemble-page"],
          forFeatures: ["seo"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "analytics-setup",
          label: "Analytics setup",
          prompt:
            "Add analytics tracking: set up a lightweight analytics provider " +
            "(Plausible, Fathom, or Vercel Analytics). Track page views and CTA clicks.",
          agent: "copilot",
          dependsOn: ["assemble-page"],
          forFeatures: ["analytics"],
          estimatedMinutes: 1,
          parallelizable: true,
        },
        {
          id: "landing-review",
          label: "Final review",
          prompt:
            "Review the complete landing page for: responsive design across breakpoints, " +
            "accessibility (contrast, ARIA, keyboard), performance (image optimization, " +
            "font loading), and copy consistency.",
          agent: "claude",
          dependsOn: ["assemble-page"],
          estimatedMinutes: 3,
          parallelizable: false,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// SaaS Dashboard template
// ---------------------------------------------------------------------------

const dashboardTemplate: WorkflowTemplate = {
  forProjectTypes: ["dashboard", "saas"],
  name: "SaaS Dashboard",
  description: "Admin dashboard with data tables, charts, auth, and RBAC",
  defaultStack: {
    framework: "Next.js",
    styling: "Tailwind CSS",
    database: "PostgreSQL",
    payment: undefined,
    cms: undefined,
    hosting: "Vercel",
    testing: "Vitest",
    language: "TypeScript",
    runtime: "Node.js",
    orm: "Prisma",
    auth: "Auth.js",
    api: undefined,
  },
  phases: [
    {
      id: "scaffold",
      label: "Project Setup",
      description: "Initialize project with auth and database",
      tasks: [
        {
          id: "init-project",
          label: "Initialize project",
          prompt:
            "Create a Next.js project with TypeScript, app router, and a dashboard layout. " +
            "Set up sidebar navigation with collapsible sections, " +
            "top bar with user menu, and a main content area. " +
            "Install Tailwind CSS and shadcn/ui.",
          agent: "claude",
          dependsOn: [],
          estimatedMinutes: 4,
          parallelizable: false,
        },
        {
          id: "setup-db",
          label: "Database setup",
          prompt:
            "Configure Prisma for PostgreSQL. Create models: User, Team, " +
            "TeamMember (with roles), and an AuditLog. " +
            "Set up row-level security patterns via Prisma middleware.",
          agent: "claude",
          dependsOn: ["init-project"],
          forFeatures: ["database"],
          estimatedMinutes: 5,
          parallelizable: true,
        },
        {
          id: "setup-auth",
          label: "Auth + RBAC",
          prompt:
            "Set up Auth.js with role-based access control. " +
            "Roles: admin, member, viewer. " +
            "Create middleware that checks roles per route. " +
            "Build login/register pages and team invite flow.",
          agent: "claude",
          dependsOn: ["setup-db"],
          forFeatures: ["auth"],
          estimatedMinutes: 6,
          parallelizable: false,
        },
      ],
    },
    {
      id: "core",
      label: "Dashboard Features",
      description: "Data tables, charts, and key dashboard pages",
      tasks: [
        {
          id: "overview-page",
          label: "Overview dashboard",
          prompt:
            "Build the main dashboard overview with: KPI stat cards (revenue, users, " +
            "growth, active sessions), a line chart for trends over time, " +
            "and a recent activity feed. Use recharts or chart.js.",
          agent: "claude",
          dependsOn: ["setup-auth"],
          forFeatures: ["charts"],
          estimatedMinutes: 6,
          parallelizable: true,
        },
        {
          id: "data-table",
          label: "Data table component",
          prompt:
            "Create a reusable data table component with: sortable columns, " +
            "search/filter, pagination, row selection, bulk actions, " +
            "and column visibility toggle. Use @tanstack/react-table.",
          agent: "claude",
          dependsOn: ["init-project"],
          estimatedMinutes: 5,
          parallelizable: true,
        },
        {
          id: "users-page",
          label: "User management",
          prompt:
            "Build a user management page using the data table component. " +
            "Include: user list with role badges, invite user dialog, " +
            "edit role dropdown, and deactivate/delete actions.",
          agent: "copilot",
          dependsOn: ["data-table", "setup-auth"],
          forFeatures: ["admin"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
        {
          id: "settings-page",
          label: "Settings pages",
          prompt:
            "Create settings pages: profile (name, avatar, email), " +
            "team settings (name, billing), notification preferences, " +
            "and API keys management. Use a tabbed layout.",
          agent: "copilot",
          dependsOn: ["setup-auth"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
        {
          id: "realtime-updates",
          label: "Real-time data",
          prompt:
            "Add real-time data updates to the dashboard overview. " +
            "Use Server-Sent Events or WebSocket for live KPI updates " +
            "and activity feed. Show connection status indicator.",
          agent: "claude",
          dependsOn: ["overview-page"],
          forFeatures: ["realtime"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
      ],
    },
    {
      id: "test",
      label: "Testing & Review",
      description: "Generate tests and perform code review",
      tasks: [
        {
          id: "unit-tests",
          label: "Unit tests",
          prompt:
            "Write unit tests for: RBAC logic, data table filtering/sorting, " +
            "API route handlers, and auth middleware. Use Vitest.",
          agent: "codex",
          dependsOn: ["users-page", "overview-page"],
          estimatedMinutes: 6,
          parallelizable: true,
        },
        {
          id: "code-review",
          label: "Security review",
          prompt:
            "Review all code for: auth bypass risks, data leakage between tenants, " +
            "XSS in data tables, CSRF on mutations, and proper error handling. " +
            "Verify role checks on every API route.",
          agent: "claude",
          dependsOn: ["unit-tests"],
          estimatedMinutes: 4,
          parallelizable: false,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Blog / CMS template
// ---------------------------------------------------------------------------

const blogTemplate: WorkflowTemplate = {
  forProjectTypes: ["blog"],
  name: "Blog / Content Site",
  description: "Content-focused site with posts, tags, RSS, and optional CMS integration",
  defaultStack: {
    framework: "Next.js",
    styling: "Tailwind CSS",
    database: undefined,
    payment: undefined,
    cms: undefined,
    hosting: "Vercel",
    testing: "Vitest",
    language: "TypeScript",
    runtime: "Node.js",
    orm: undefined,
    auth: undefined,
    api: undefined,
  },
  phases: [
    {
      id: "scaffold",
      label: "Project Setup",
      description: "Initialize project with content pipeline",
      tasks: [
        {
          id: "init-project",
          label: "Initialize project",
          prompt:
            "Create a Next.js project with TypeScript and app router. " +
            "Set up Tailwind CSS with a typography plugin for prose styling. " +
            "Create directory structure: app/, components/, content/, lib/.",
          agent: "copilot",
          dependsOn: [],
          estimatedMinutes: 2,
          parallelizable: false,
        },
        {
          id: "content-pipeline",
          label: "Content pipeline",
          prompt:
            "Set up the content pipeline: configure MDX with next-mdx-remote or contentlayer. " +
            "Support frontmatter (title, date, tags, excerpt, coverImage). " +
            "Create helper functions for listing posts, getting by slug, and filtering by tag.",
          agent: "claude",
          dependsOn: ["init-project"],
          forFeatures: ["cms"],
          estimatedMinutes: 5,
          parallelizable: false,
        },
      ],
    },
    {
      id: "pages",
      label: "Pages & Components",
      description: "Build blog pages and shared components",
      tasks: [
        {
          id: "post-list",
          label: "Post listing page",
          prompt:
            "Create the blog index page with: post cards (title, date, excerpt, cover image), " +
            "tag filter sidebar/pills, pagination, and a featured post hero at the top.",
          agent: "copilot",
          dependsOn: ["content-pipeline"],
          estimatedMinutes: 3,
          parallelizable: true,
        },
        {
          id: "post-detail",
          label: "Post detail page",
          prompt:
            "Create the individual post page with: rendered MDX content with syntax highlighting, " +
            "table of contents sidebar, reading time estimate, " +
            "author card, share buttons, and previous/next navigation.",
          agent: "claude",
          dependsOn: ["content-pipeline"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
        {
          id: "tag-page",
          label: "Tag pages",
          prompt:
            "Create dynamic tag pages at /tags/[tag]. " +
            "List all posts with the given tag. " +
            "Also create a /tags index page showing all tags with post counts.",
          agent: "copilot",
          dependsOn: ["content-pipeline"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "search-blog",
          label: "Blog search",
          prompt:
            "Add client-side blog search: index post titles, excerpts, and tags. " +
            "Use a lightweight search library (fuse.js or minisearch). " +
            "Show results in a dropdown with highlighting.",
          agent: "copilot",
          dependsOn: ["post-list"],
          forFeatures: ["search"],
          estimatedMinutes: 3,
          parallelizable: true,
        },
        {
          id: "header-footer",
          label: "Header & footer",
          prompt:
            "Create a site header with logo, nav links (Home, Blog, Tags, About), " +
            "dark mode toggle, and mobile menu. " +
            "Create a footer with links, RSS icon, and copyright.",
          agent: "copilot",
          dependsOn: ["init-project"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
      ],
    },
    {
      id: "polish",
      label: "SEO & Feeds",
      description: "RSS, sitemap, SEO, and final polish",
      tasks: [
        {
          id: "rss-feed",
          label: "RSS feed",
          prompt:
            "Generate an RSS 2.0 feed at /feed.xml with all posts. " +
            "Include title, link, description, pubDate, and content snippet.",
          agent: "copilot",
          dependsOn: ["content-pipeline"],
          estimatedMinutes: 1,
          parallelizable: true,
        },
        {
          id: "seo-blog",
          label: "SEO optimization",
          prompt:
            "Add comprehensive SEO: per-post meta tags from frontmatter, " +
            "Open Graph images, JSON-LD for articles, sitemap.xml, and robots.txt.",
          agent: "copilot",
          dependsOn: ["post-detail"],
          forFeatures: ["seo"],
          estimatedMinutes: 2,
          parallelizable: true,
        },
        {
          id: "blog-review",
          label: "Final review",
          prompt:
            "Review the blog for: responsive design, accessibility, " +
            "syntax highlighting themes, image optimization, and loading performance. " +
            "Ensure all MDX features render correctly.",
          agent: "claude",
          dependsOn: ["post-list", "post-detail", "tag-page"],
          estimatedMinutes: 3,
          parallelizable: false,
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Fallback template — for unknown or unmatched project types
// ---------------------------------------------------------------------------

const fallbackTemplate: WorkflowTemplate = {
  forProjectTypes: ["portfolio", "docs", "api-only", "fullstack", "unknown"],
  name: "Generic Web Project",
  description: "Flexible starting point for any web project",
  defaultStack: {
    framework: "Next.js",
    styling: "Tailwind CSS",
    database: undefined,
    payment: undefined,
    cms: undefined,
    hosting: "Vercel",
    testing: "Vitest",
    language: "TypeScript",
    runtime: "Node.js",
    orm: undefined,
    auth: undefined,
    api: undefined,
  },
  phases: [
    {
      id: "scaffold",
      label: "Project Setup",
      description: "Initialize project and install dependencies",
      tasks: [
        {
          id: "init-project",
          label: "Initialize project",
          prompt:
            "Create a new web project with TypeScript. " +
            "Set up the directory structure, linting, and formatting. " +
            "Install and configure the styling solution.",
          agent: "copilot",
          dependsOn: [],
          estimatedMinutes: 2,
          parallelizable: false,
        },
        {
          id: "setup-db",
          label: "Database setup",
          prompt:
            "Set up the database with an ORM. " +
            "Create initial schema based on the project requirements. " +
            "Configure migrations.",
          agent: "claude",
          dependsOn: ["init-project"],
          forFeatures: ["database"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
        {
          id: "setup-auth",
          label: "Auth setup",
          prompt:
            "Set up authentication with the chosen provider. " +
            "Create login/register pages and protected route middleware.",
          agent: "claude",
          dependsOn: ["init-project"],
          forFeatures: ["auth"],
          estimatedMinutes: 4,
          parallelizable: true,
        },
      ],
    },
    {
      id: "core",
      label: "Core Implementation",
      description: "Build the main features",
      tasks: [
        {
          id: "main-feature",
          label: "Main feature",
          prompt:
            "Implement the primary feature described in the project requirements. " +
            "Follow the framework's conventions and best practices.",
          agent: "claude",
          dependsOn: ["init-project"],
          estimatedMinutes: 8,
          parallelizable: false,
        },
      ],
    },
    {
      id: "test",
      label: "Testing",
      description: "Write tests and review",
      tasks: [
        {
          id: "tests",
          label: "Tests",
          prompt:
            "Write unit and integration tests for the implemented features. " +
            "Cover the critical user flows and edge cases.",
          agent: "codex",
          dependsOn: ["main-feature"],
          estimatedMinutes: 5,
          parallelizable: true,
        },
        {
          id: "review",
          label: "Code review",
          prompt:
            "Review all code for security, accessibility, performance, and best practices.",
          agent: "claude",
          dependsOn: ["tests"],
          estimatedMinutes: 3,
          parallelizable: false,
        },
      ],
    },
  ],
};

// ===========================================================================
// Template Registry
// ===========================================================================

const TEMPLATE_REGISTRY: WorkflowTemplate[] = [
  ecommerceTemplate,
  landingTemplate,
  dashboardTemplate,
  blogTemplate,
  fallbackTemplate,
];

/**
 * Register a custom workflow template. It will be checked before the
 * built-in templates, so custom templates can override defaults.
 */
export function registerTemplate(template: WorkflowTemplate): void {
  // Prepend so custom templates take priority
  TEMPLATE_REGISTRY.unshift(template);
}

/** Return all registered templates. */
export function getTemplates(): readonly WorkflowTemplate[] {
  return TEMPLATE_REGISTRY;
}

/**
 * Find the best-matching template for a given project type.
 * Custom templates are checked first (they're prepended by registerTemplate).
 */
export function findTemplate(projectType: string): WorkflowTemplate {
  return (
    TEMPLATE_REGISTRY.find((t) =>
      t.forProjectTypes.includes(projectType as never)
    ) ?? fallbackTemplate
  );
}
