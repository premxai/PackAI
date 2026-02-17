# Contributing Guide

Thank you for contributing to the PackAI. This guide covers the development workflow, code conventions, and testing requirements.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/your-org/packai.git
cd packai

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test
```

## Running the Extension

1. Open the project in VS Code
2. Press **F5** to launch the Extension Development Host
3. The extension activates in the new window
4. Open the Command Palette (`Ctrl+Shift+P`) and run "PackAI: Start Project"

## Project Architecture

See [architecture.md](architecture.md) for the full system design. Key points:

- **Business logic never imports `vscode`** -- only boundary files (`extension.ts`, `vscodeAdapters.ts`, `ui/*.ts`, `commands/*.ts`) touch VS Code APIs
- **Dependency injection** via interfaces (e.g., `ILanguageModelProvider`, `IStateStore`)
- **Test mocks** live in `src/test/mocks/vscode.ts` and are aliased via `vitest.config.ts`

## Code Conventions

### TypeScript

- Strict mode (`strict: true` in tsconfig.json)
- No `any` types in production code (use `unknown` and narrow)
- `readonly` on all interface properties
- Explicit return types on exported functions
- Import types with `import type` when only used as types

### File Organization

- One module per file, one test file per module
- Test files are co-located: `foo.ts` / `foo.test.ts`
- Integration tests go in `src/test/integration/`
- Shared test helpers go in `src/test/fixtures.ts`

### Naming

- Files: `camelCase.ts`
- Classes: `PascalCase`
- Interfaces: `PascalCase` (no `I` prefix, except DI interfaces: `ILanguageModelProvider`)
- Functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE` for module-level constants
- Types: `PascalCase`

### Error Handling

- Extend `PackAIError` for new error types (see `src/utils/errors.ts`)
- Every error must have a `code` (machine-readable) and `userMessage` (display-safe)
- Use `normalizeError()` to wrap unknown errors
- Use `getUserMessage()` to extract safe display text
- Wrap command handlers in try/catch with `handleCommandError()`

## Adding a New Feature

### Adding a New Command

1. Choose the appropriate command module in `src/commands/`:
   - `startProject.ts` -- project creation
   - `manageOrchestration.ts` -- session lifecycle
   - `templates.ts` -- template CRUD
   - `settings.ts` -- configuration
   - Or create a new module

2. Register the command in the module's `register*Commands()` function:

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand("packai.myCommand", () =>
    myCommandHandler(deps)
  )
);
```

3. Add the command to `package.json` under `contributes.commands`:

```json
{
  "command": "packai.myCommand",
  "title": "My Command",
  "category": "PackAI",
  "icon": "$(icon-name)"
}
```

4. Optionally add a keybinding under `contributes.keybindings`.

### Adding a New Quality Gate

1. Implement the `QualityGate` interface in `src/execution/qualityGates.ts`:

```typescript
export class MyGate implements QualityGate {
  readonly name = "my-gate";
  readonly severity: QualitySeverity = "error";

  check(output: AgentOutput, context: QualityContext): QualityResult {
    const violations: QualityViolation[] = [];
    // ... check logic ...
    return { gate: this.name, passed: violations.length === 0, violations };
  }
}
```

2. Add it to the `QualityGateRunner` constructor defaults.
3. Write tests for the new gate.

### Adding a New Workflow Template

See [template-guide.md](template-guide.md) for the full template structure.

1. Add the template definition in `src/intelligence/workflowTemplates.ts`
2. Push it to `TEMPLATE_REGISTRY`
3. Add tests in `workflowTemplates.test.ts` (the `it.each` data-driven tests will automatically cover it)

## Testing

### Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Single file
npx vitest run src/intelligence/intentAnalyzer.test.ts

# Watch mode
npx vitest --watch

# Pattern matching
npx vitest run -t "quality gates"
```

### Coverage Requirements

The project enforces **80% minimum** on statements, branches, functions, and lines via `vitest.config.ts`. The CI build will fail if coverage drops below these thresholds.

Current coverage: **88% statements, 94% branches, 96% functions**.

### Writing Tests

Use shared factories from `src/test/fixtures.ts`:

```typescript
import { makeTask, makePlan, makeMockSessionManager } from "../test/fixtures";

it("does something", () => {
  const task = makeTask({ id: "my-task", agent: "claude" });
  const plan = makePlan({ templateName: "test" });
  expect(task.agent).toBe("claude");
});
```

For async tests with timers:

```typescript
import { vi, beforeEach, afterEach } from "vitest";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("drains after interval", async () => {
  await vi.advanceTimersByTimeAsync(1000);
  // assertions...
});
```

### Integration Tests

Integration tests in `src/test/integration/` compose multiple real modules. They use the mock infrastructure but exercise real business logic:

- `projectScenario.test.ts` -- full project lifecycle
- `orchestrationFlow.test.ts` -- intent through execution to dashboard
- `errorRecoveryFlow.test.ts` -- fallback, rate limiting, state recovery

## Pull Request Guidelines

1. **One concern per PR** -- don't mix features with refactors
2. **Write tests** -- new code needs tests, bug fixes need regression tests
3. **Run the full suite** before submitting: `npx tsc --noEmit && npm test`
4. **Keep coverage above 80%** -- check with `npm run test:coverage`
5. **Follow existing patterns** -- look at similar code for conventions
6. **Update docs** if you're adding user-facing features

## Release Process

1. Update `version` in `package.json`
2. Update `CHANGELOG.md` with changes
3. Run `npm run compile && npm test`
4. Package: `npx @vscode/vsce package`
5. Test the `.vsix` in a fresh VS Code instance
6. Publish: `npx @vscode/vsce publish`
