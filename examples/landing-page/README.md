# Example: Landing Page

This example shows how PackAI generates an execution plan for a landing page project.

## Input

```
Create a product landing page with hero section, feature highlights, and pricing table
```

## What PackAI Detects

| Field | Value |
|-------|-------|
| Project Type | `landing` (high confidence) |
| Features | -- |
| Stack Hints | -- |
| Complexity | `simple` |

## Generated Plan

PackAI selects the **Landing Page** template:

### Phase 1: Setup
| Task | Agent | Est. |
|------|-------|------|
| Initialize project with Vite + React | Copilot | 3 min |
| Configure Tailwind CSS | Copilot | 2 min |

### Phase 2: Sections
| Task | Agent | Est. |
|------|-------|------|
| Hero section with CTA | Copilot | 8 min |
| Feature highlights grid | Copilot | 8 min |
| Pricing table | Claude | 10 min |
| Testimonials | Copilot | 5 min |

### Phase 3: Polish
| Task | Agent | Est. |
|------|-------|------|
| Responsive design | Copilot | 5 min |
| SEO meta tags | Codex | 3 min |
| Performance optimization | Codex | 5 min |

## How to Run

```
@packai /scaffold Create a product landing page with hero section, feature highlights, and pricing table
```
