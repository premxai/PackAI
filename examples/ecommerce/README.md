# Example: E-commerce Store

This example shows how PackAI generates an execution plan for an e-commerce project.

## Input

```
Build an e-commerce store with Stripe payments and PostgreSQL database
```

## What PackAI Detects

| Field | Value |
|-------|-------|
| Project Type | `ecommerce` (high confidence) |
| Features | `payments`, `database` |
| Stack Hints | Stripe (payment), PostgreSQL (database) |
| Complexity | `moderate` |

## Generated Plan

PackAI selects the **E-commerce Store** template and produces a 3-phase plan:

### Phase 1: Project Setup
| Task | Agent | Depends On | Est. |
|------|-------|-----------|------|
| Initialize Next.js project | Copilot | -- | 5 min |
| Configure PostgreSQL + Prisma | Claude | init-project | 10 min |
| Set up authentication | Claude | init-project | 10 min |

### Phase 2: Core Features
| Task | Agent | Depends On | Est. |
|------|-------|-----------|------|
| Product catalog models | Claude | setup-database | 15 min |
| Shopping cart logic | Claude | product-catalog | 10 min |
| Stripe integration | Claude | setup-database | 15 min |
| Product listing UI | Copilot | product-catalog | 10 min |

### Phase 3: Polish & Quality
| Task | Agent | Depends On | Est. |
|------|-------|-----------|------|
| Checkout flow | Claude | cart, stripe | 15 min |
| Test generation | Codex | all core tasks | 10 min |
| Responsive styling | Copilot | UI tasks | 5 min |

## How to Run

1. Open an empty folder in VS Code
2. Run **PackAI: Start Project** from the Command Palette
3. Select "E-commerce Store"
4. View the plan in the dashboard

Or use the chat:

```
@packai /scaffold Build an e-commerce store with Stripe payments and PostgreSQL database
```

## Template File

See [ecommerce-template.json](ecommerce-template.json) for the raw template that can be imported via **PackAI: Import Template**.
