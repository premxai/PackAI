# Template Creation Guide

Workflow templates define the phases and tasks for a project type. PackAI ships with 5 built-in templates and supports custom templates.

## Template Structure

A template is a JSON object with this shape:

```json
{
  "forProjectTypes": ["ecommerce"],
  "name": "My E-commerce Template",
  "description": "Custom e-commerce workflow with Stripe integration",
  "defaultStack": {
    "framework": "Next.js",
    "database": "PostgreSQL",
    "orm": "Prisma"
  },
  "phases": [
    {
      "id": "setup",
      "label": "Project Setup",
      "description": "Initialize project structure and dependencies",
      "tasks": [
        {
          "id": "init-project",
          "label": "Initialize Next.js project",
          "prompt": "Create a new Next.js 14 project with TypeScript, Tailwind CSS, and ESLint",
          "agent": "copilot",
          "dependsOn": [],
          "estimatedMinutes": 5,
          "parallelizable": false
        },
        {
          "id": "setup-database",
          "label": "Configure database",
          "prompt": "Set up PostgreSQL with Prisma ORM. Create initial schema with User model",
          "agent": "claude",
          "dependsOn": ["init-project"],
          "estimatedMinutes": 10,
          "parallelizable": false
        }
      ]
    }
  ]
}
```

## Field Reference

### Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `forProjectTypes` | `string[]` | Yes | Project types this template handles (e.g., `["ecommerce"]`, `["dashboard", "saas"]`) |
| `name` | `string` | Yes | Display name shown in quick picks |
| `description` | `string` | Yes | Short description of the template |
| `defaultStack` | `object` | Yes | Default technology stack. Must include `framework` key |
| `phases` | `Phase[]` | Yes | Ordered list of execution phases |

### Phase Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique phase identifier |
| `label` | `string` | Yes | Display name |
| `description` | `string` | Yes | What this phase accomplishes |
| `tasks` | `Task[]` | Yes | Tasks in this phase |

### Task Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique task ID (must be unique within the template) |
| `label` | `string` | Yes | Display name |
| `prompt` | `string` | Yes | The prompt sent to the assigned agent |
| `agent` | `string` | Yes | `"claude"`, `"copilot"`, or `"codex"` |
| `dependsOn` | `string[]` | Yes | IDs of tasks that must complete first |
| `estimatedMinutes` | `number` | Yes | Estimated execution time |
| `parallelizable` | `boolean` | Yes | Whether this task can run alongside others |
| `forFeatures` | `string[]` | No | Only include this task if these features are detected |

## Creating Templates

### Method 1: From an Active Plan

1. Start a project with **PackAI: Start Project**
2. Once the plan is generated, run **PackAI: Create Template from Plan**
3. Enter a name and description
4. The template is registered immediately and optionally saved to disk

### Method 2: From a JSON File

1. Create a `.json` file following the structure above
2. Run **PackAI: Import Template** and select the file
3. The template is validated and registered

### Method 3: Programmatically

In your extension code or a test:

```typescript
import { registerTemplate } from "./intelligence";

registerTemplate({
  forProjectTypes: ["portfolio"],
  name: "Portfolio Site",
  description: "Personal portfolio with projects showcase",
  defaultStack: { framework: "Astro" },
  phases: [
    {
      id: "setup",
      label: "Setup",
      description: "Initialize project",
      tasks: [
        {
          id: "init",
          label: "Initialize Astro project",
          prompt: "Create a new Astro project with TypeScript",
          agent: "copilot",
          dependsOn: [],
          estimatedMinutes: 3,
          parallelizable: false,
        },
      ],
    },
  ],
});
```

Custom templates registered via `registerTemplate()` take priority over built-in templates for the same project type.

## Best Practices

### Task Dependencies

- The first task in the first phase should have `dependsOn: []`
- Only reference task IDs that exist in the same template
- Avoid circular dependencies (A depends on B, B depends on A)
- Use `dependsOn` to create a DAG (directed acyclic graph)

### Agent Assignment

Choose agents based on task characteristics:

| Task Type | Best Agent | Why |
|-----------|-----------|-----|
| Architecture/schema design | `claude` | Best at complex reasoning and design decisions |
| Boilerplate/scaffolding | `copilot` | Fast at generating framework-specific code |
| Database setup | `claude` | Strong at schema design and ORM configuration |
| UI components | `copilot` | Trained on many UI component patterns |
| Test generation | `codex` | Good at batch generation tasks |
| Bulk operations | `codex` | Handles repetitive tasks well |

### Prompts

- Be specific about what the task should produce
- Mention the tech stack explicitly (e.g., "using Next.js 14 with App Router")
- Include expected output format (e.g., "Create files: `src/models/User.ts`, `prisma/schema.prisma`")
- Reference dependencies by name (e.g., "Use the Prisma schema from the database setup task")

### Parallelization

Set `parallelizable: true` for tasks that:
- Don't depend on each other
- Work on different files
- Can be merged without conflicts

Set `parallelizable: false` for tasks that:
- Modify shared files
- Produce outputs that other tasks depend on
- Require sequential execution (e.g., database migrations)

## Exporting and Sharing

### Export a Template

1. Run **PackAI: Export Template**
2. Select the template from the list
3. Choose a save location

### Share with Your Team

Add exported templates to your repository:

```
your-project/
└── .packai/
    └── templates/
        ├── ecommerce-custom.json
        └── dashboard-internal.json
```

Set `packai.advanced.customTemplatesDirectory` to `.packai/templates` so they're auto-loaded.

## Validation Rules

When importing or creating a template, PackAI validates:

1. `name` is non-empty
2. `phases` is a non-empty array
3. All tasks have `id`, `label`, `prompt`, `agent` fields
4. All `dependsOn` references point to existing task IDs
5. No circular dependencies
6. All `agent` values are `"claude"`, `"copilot"`, or `"codex"`
7. `defaultStack` includes a `framework` key
8. All task IDs are unique within the template

If validation fails, you'll see an error message describing the issue.
