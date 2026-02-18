import type { PackAISettings, SettingsValidationError } from "../settings/types";

// ===========================================================================
// Settings Protocol
//
// Typed message contract between the extension host and the settings
// webview panel. No VS Code imports — fully testable.
// ===========================================================================

// ---------------------------------------------------------------------------
// Extension → Webview messages
// ---------------------------------------------------------------------------

export type SettingsMessage =
  | { readonly type: "init"; readonly payload: SettingsState }
  | { readonly type: "settings-updated"; readonly payload: SettingsState }
  | { readonly type: "validation-errors"; readonly payload: readonly SettingsValidationError[] }
  | { readonly type: "save-success" };

// ---------------------------------------------------------------------------
// Webview → Extension messages
// ---------------------------------------------------------------------------

export type SettingsAction =
  | { readonly type: "request-state" }
  | { readonly type: "update-setting"; readonly payload: { readonly key: string; readonly value: unknown } }
  | { readonly type: "reset-defaults" }
  | { readonly type: "reset-section"; readonly payload: { readonly section: string } }
  | { readonly type: "open-external"; readonly payload: { readonly url: string } };

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SettingsState {
  readonly settings: PackAISettings;
  readonly validationErrors: readonly SettingsValidationError[];
}
