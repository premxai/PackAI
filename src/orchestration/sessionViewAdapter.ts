// ===========================================================================
// Session View Adapter — PROPOSED API integration
//
// This module provides optional integration with VS Code's Agent Sessions
// view via the proposed `chatSessionsProvider` API. It is NOT required for
// the core SessionManager to function.
//
// Status: PROPOSED / EXPERIMENTAL
// API: chatSessionsProvider (vscode.proposed.chatSessionsProvider.d.ts)
// Feature flag: "enabledApiProposals": ["chatSessionsProvider"] in package.json
// Risk: Medium — actively used by Claude and Codex extensions but may change
//
// Required devDependency for types:
//   "@vscode/dts": "^0.x.x"
//
// Usage:
//   Only instantiate if the proposed API is available. The adapter listens
//   to SessionManager events and mirrors them to the VS Code Agent Sessions
//   view. If the API is not available, it gracefully becomes a no-op.
//
// Proposed API surface (from VS Code 1.107+):
//
//   enum ChatSessionStatus {
//     Failed = 0,
//     Completed = 1,
//     InProgress = 2,
//     NeedsInput = 3
//   }
//
//   interface ChatSessionItem {
//     resource: Uri;
//     label: string;
//     status: ChatSessionStatus;
//     timing: { startTime: number; endTime?: number };
//     changes: ChatSessionChangedFile2[];
//     metadata: Record<string, unknown>;
//   }
//
//   function createChatSessionItemController(
//     id: string, label: string
//   ): ChatSessionItemController;
//
//   function registerChatSessionContentProvider(
//     id: string, provider: ChatSessionContentProvider
//   ): Disposable;
//
// State mapping:
//   SessionState "pending"   → ChatSessionStatus.NeedsInput (3)
//   SessionState "running"   → ChatSessionStatus.InProgress (2)
//   SessionState "paused"    → ChatSessionStatus.NeedsInput (3)
//   SessionState "completed" → ChatSessionStatus.Completed  (1)
//   SessionState "failed"    → ChatSessionStatus.Failed     (0)
//   SessionState "cancelled" → ChatSessionStatus.Failed     (0)
//
// Implementation will be added in a future phase when the API stabilizes
// or when native Agent Sessions view integration is prioritized.
// ===========================================================================

import type { SessionState } from "./types";

/** Map SessionState to the proposed ChatSessionStatus enum values. */
export const SESSION_STATE_TO_CHAT_STATUS: Readonly<
  Record<SessionState, number>
> = {
  pending: 3, // NeedsInput
  running: 2, // InProgress
  paused: 3, // NeedsInput
  completed: 1, // Completed
  failed: 0, // Failed
  cancelled: 0, // Failed
};
