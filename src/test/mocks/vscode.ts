/**
 * Mock VS Code API for testing files that import `vscode` directly.
 *
 * Configured as a resolve alias in vitest.config.ts so that
 * `import * as vscode from "vscode"` resolves here in tests.
 */

import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
}

export enum ConfigurationTarget {
  Global = 1,
  Workspace = 2,
  WorkspaceFolder = 3,
}

// ---------------------------------------------------------------------------
// Uri
// ---------------------------------------------------------------------------

export class Uri {
  readonly scheme: string;
  readonly path: string;
  readonly fsPath: string;

  private constructor(scheme: string, path: string) {
    this.scheme = scheme;
    this.path = path;
    this.fsPath = path;
  }

  static file(path: string): Uri {
    return new Uri("file", path);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, [base.path, ...segments].join("/"));
  }

  toString(): string {
    return `${this.scheme}://${this.path}`;
  }

  with(_change: Record<string, string>): Uri {
    return this;
  }
}

// ---------------------------------------------------------------------------
// EventEmitter
// ---------------------------------------------------------------------------

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void): { dispose(): void } => {
    this.listeners.push(listener);
    return {
      dispose: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      },
    };
  };

  fire(data: T): void {
    for (const listener of this.listeners) {
      listener(data);
    }
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ---------------------------------------------------------------------------
// CancellationToken / CancellationTokenSource
// ---------------------------------------------------------------------------

export class CancellationTokenSource {
  private listeners: (() => void)[] = [];

  token = {
    isCancellationRequested: false,
    onCancellationRequested: (listener: () => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    },
  };

  cancel(): void {
    this.token.isCancellationRequested = true;
    for (const l of this.listeners) l();
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ---------------------------------------------------------------------------
// ThemeIcon
// ---------------------------------------------------------------------------

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

// ---------------------------------------------------------------------------
// LanguageModelChatMessage
// ---------------------------------------------------------------------------

export const LanguageModelChatMessage = {
  User: (content: string) => ({ role: "user" as const, content }),
  Assistant: (content: string) => ({ role: "assistant" as const, content }),
};

// ---------------------------------------------------------------------------
// LanguageModelError
// ---------------------------------------------------------------------------

export class LanguageModelError extends Error {
  readonly code: string;
  constructor(message: string, code = "unknown") {
    super(message);
    this.name = "LanguageModelError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Configuration mock
// ---------------------------------------------------------------------------

const configStore: Record<string, unknown> = {};

function createConfigMock() {
  return {
    get: vi.fn((key: string, defaultValue?: unknown) => configStore[key] ?? defaultValue),
    update: vi.fn(async (key: string, value: unknown) => {
      configStore[key] = value;
    }),
    has: vi.fn((key: string) => key in configStore),
    inspect: vi.fn(() => undefined),
  };
}

// ---------------------------------------------------------------------------
// Webview mock
// ---------------------------------------------------------------------------

function createWebviewMock() {
  return {
    html: "",
    options: {},
    cspSource: "mock-csp-source",
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn(async () => true),
    asWebviewUri: vi.fn((uri: Uri) => uri),
  };
}

function createWebviewPanelMock() {
  const webview = createWebviewMock();
  return {
    webview,
    title: "",
    visible: true,
    active: true,
    viewColumn: ViewColumn.One,
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(),
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Memento mock (for globalState)
// ---------------------------------------------------------------------------

export function createMementoMock(): {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Promise<void>;
  keys(): readonly string[];
} {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (store.get(key) as T) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      if (value === undefined) store.delete(key);
      else store.set(key, value);
    },
    keys: () => [...store.keys()],
  };
}

// ---------------------------------------------------------------------------
// Top-level API namespaces
// ---------------------------------------------------------------------------

export const workspace = {
  getConfiguration: vi.fn(() => createConfigMock()),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  workspaceFolders: undefined as { uri: Uri; name: string }[] | undefined,
};

export const window = {
  createWebviewPanel: vi.fn(() => createWebviewPanelMock()),
  registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
  showInformationMessage: vi.fn(async () => undefined),
  showWarningMessage: vi.fn(async () => undefined),
  showErrorMessage: vi.fn(async () => undefined),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    append: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  })),
};

export const lm = {
  selectChatModels: vi.fn(async () => []),
};

export const env = {
  remoteName: undefined as string | undefined,
};

export const chat = {
  createChatParticipant: vi.fn(() => ({
    iconPath: undefined,
    followupProvider: undefined,
    dispose: vi.fn(),
  })),
};

export const commands = {
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
};

// ---------------------------------------------------------------------------
// Helpers for test reset
// ---------------------------------------------------------------------------

export function resetVsCodeMocks(): void {
  vi.clearAllMocks();
  Object.keys(configStore).forEach((k) => delete configStore[k]);
  env.remoteName = undefined;
  workspace.workspaceFolders = undefined;
}
