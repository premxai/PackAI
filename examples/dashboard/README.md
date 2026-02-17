# Example: SaaS Dashboard

This example shows how WebFlow generates an execution plan for a SaaS dashboard project.

## Input

```
Build a SaaS admin dashboard with user management, analytics charts, and role-based access
```

## What WebFlow Detects

| Field | Value |
|-------|-------|
| Project Type | `dashboard` (high confidence) |
| Features | `auth`, `realtime` |
| Stack Hints | -- |
| Complexity | `complex` |

## Generated Plan

WebFlow selects the **SaaS Dashboard** template:

### Phase 1: Foundation
| Task | Agent | Est. |
|------|-------|------|
| Initialize Next.js + shadcn/ui | Copilot | 5 min |
| Database schema (users, roles, orgs) | Claude | 12 min |
| Authentication + RBAC middleware | Claude | 15 min |

### Phase 2: Core Pages
| Task | Agent | Est. |
|------|-------|------|
| Dashboard overview with KPI cards | Copilot | 10 min |
| User management CRUD | Claude | 12 min |
| Analytics charts (Recharts) | Copilot | 10 min |
| Settings and profile pages | Copilot | 8 min |

### Phase 3: Quality
| Task | Agent | Est. |
|------|-------|------|
| API route tests | Codex | 10 min |
| Role-based access tests | Claude | 8 min |
| Responsive layout polish | Copilot | 5 min |

## How to Run

```
@webflow /scaffold Build a SaaS admin dashboard with user management, analytics charts, and role-based access
```
