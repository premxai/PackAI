import * as vscode from "vscode";
import type {
  ILanguageModelProvider,
  ILanguageModel,
  ILanguageModelMessage,
  ILanguageModelResponse,
  ICancellationToken,
  ICancellationTokenSource,
  IEventEmitter,
  IEventEmitterFactory,
  ICancellationTokenSourceFactory,
} from "./types";
import type { IEnvironmentDetector } from "../execution/toolApprover";
import type { ISettingsProvider } from "../settings/vscodeSettingsAdapter";
import type { IStateStore } from "../utils/errorRecovery";

// ===========================================================================
// VS Code API adapters
//
// Bridges the abstract interfaces used by Session/SessionManager to the real
// VS Code APIs. This is the ONLY file in the orchestration module that
// imports `vscode` directly. All other files depend on the interfaces in
// types.ts, making them testable with simple mocks.
// ===========================================================================

// ---------------------------------------------------------------------------
// Language Model Provider
// ---------------------------------------------------------------------------

export class VsCodeLanguageModelProvider implements ILanguageModelProvider {
  async selectModels(selector: {
    vendor: string;
    family?: string;
  }): Promise<ILanguageModel[]> {
    const models = await vscode.lm.selectChatModels(selector);
    return models.map((m) => new VsCodeLanguageModel(m));
  }
}

class VsCodeLanguageModel implements ILanguageModel {
  constructor(private readonly model: vscode.LanguageModelChat) {}

  get id(): string {
    return this.model.id;
  }
  get vendor(): string {
    return this.model.vendor;
  }
  get family(): string {
    return this.model.family;
  }
  get name(): string {
    return this.model.name;
  }
  get maxInputTokens(): number {
    return this.model.maxInputTokens;
  }

  async sendRequest(
    messages: readonly ILanguageModelMessage[],
    options: Record<string, unknown>,
    token: ICancellationToken
  ): Promise<ILanguageModelResponse> {
    const vscodeMessages = messages.map((m) =>
      m.role === "user"
        ? vscode.LanguageModelChatMessage.User(m.content)
        : vscode.LanguageModelChatMessage.Assistant(m.content)
    );

    const response = await this.model.sendRequest(
      vscodeMessages,
      options,
      token as unknown as vscode.CancellationToken
    );

    return { text: response.text };
  }
}

// ---------------------------------------------------------------------------
// Event Emitter Factory
// ---------------------------------------------------------------------------

export class VsCodeEventEmitterFactory implements IEventEmitterFactory {
  create<T>(): IEventEmitter<T> {
    return new VsCodeEventEmitterAdapter<T>();
  }
}

class VsCodeEventEmitterAdapter<T> implements IEventEmitter<T> {
  private readonly emitter = new vscode.EventEmitter<T>();

  get event(): (listener: (e: T) => void) => { dispose(): void } {
    return (listener: (e: T) => void) => this.emitter.event(listener);
  }

  fire(data: T): void {
    this.emitter.fire(data);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

// ---------------------------------------------------------------------------
// Cancellation Token Source Factory
// ---------------------------------------------------------------------------

export class VsCodeCancellationTokenSourceFactory
  implements ICancellationTokenSourceFactory
{
  create(): ICancellationTokenSource {
    const source = new vscode.CancellationTokenSource();
    return {
      token: {
        get isCancellationRequested() {
          return source.token.isCancellationRequested;
        },
        onCancellationRequested(listener: () => void) {
          return source.token.onCancellationRequested(listener);
        },
      },
      cancel: () => source.cancel(),
      dispose: () => source.dispose(),
    };
  }
}

// ---------------------------------------------------------------------------
// Environment Detector
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// State Store (for ExecutionStateManager checkpoint/resume)
// ---------------------------------------------------------------------------

export class VsCodeStateStoreAdapter implements IStateStore {
  constructor(private readonly globalState: vscode.Memento) {}

  async save(key: string, state: unknown): Promise<void> {
    await this.globalState.update(`webflow.state.${key}`, state);
  }

  async load<T>(key: string): Promise<T | null> {
    return this.globalState.get<T>(`webflow.state.${key}`) ?? null;
  }

  async delete(key: string): Promise<void> {
    await this.globalState.update(`webflow.state.${key}`, undefined);
  }
}

// ---------------------------------------------------------------------------
// Environment Detector
// ---------------------------------------------------------------------------

export class VsCodeEnvironmentDetector implements IEnvironmentDetector {
  constructor(private readonly settingsProvider?: ISettingsProvider) {}

  isDevContainer(): boolean {
    return (
      vscode.env.remoteName === "dev-container" ||
      !!process.env["REMOTE_CONTAINERS_IPC"]
    );
  }

  isProductionWorkspace(): boolean {
    if (this.settingsProvider) {
      return this.settingsProvider.getSettings().approval.productionWorkspace;
    }
    const config = vscode.workspace.getConfiguration("webflow");
    return config.get<boolean>("approval.productionWorkspace", false);
  }
}
