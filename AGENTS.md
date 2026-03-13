# AGENTS.md

## Cursor Cloud specific instructions

This is a VS Code extension (PackAI) — a pure TypeScript project with no external services, databases, or Docker dependencies. All business logic is testable without VS Code.

### Quick reference

| Action | Command |
|---|---|
| Install deps | `npm install` |
| Type check | `npm run compile:check` |
| Lint | `npm run lint` |
| Run tests | `npm test` (743 tests via Vitest) |
| Run tests + coverage | `npm run test:coverage` (80% threshold) |
| Build bundle | `npm run package` (type-check + esbuild → `dist/extension.js`) |
| Watch mode | `npm run bundle:watch` |

### Known issues

- **ESLint config missing**: The project specifies ESLint v9 as a devDependency but has no `eslint.config.js`. The `npm run lint` command fails. CI marks this step as `continue-on-error: true`. This is a pre-existing repo issue, not an environment problem.
- **Coverage threshold**: `npm run test:coverage` may fail the 80% threshold because VS Code adapter files (commands, UI providers, vscode adapters) are at 0% coverage — they require the actual VS Code runtime and are excluded from unit testing. All 743 tests pass.

### Architecture note

Business logic (under `src/intelligence/`, `src/orchestration/`, `src/execution/`, `src/utils/`, `src/settings/`) never imports `vscode` directly. The `vscode` module is mocked via `vitest.config.ts` alias → `src/test/mocks/vscode.ts`. Only boundary files (`extension.ts`, `commands/`, `ui/`, `vscodeAdapters.ts`) touch VS Code APIs.

### Running the extension in VS Code

The extension requires VS Code 1.109+ with a GitHub Copilot subscription. Press F5 in VS Code to launch the Extension Development Host. This is not possible in the cloud agent environment.
