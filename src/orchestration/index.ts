export { SessionManager } from "./sessionManager";
export { Session } from "./session";
export type { SessionEmitters } from "./session";
export {
  DependencyResolver,
  extractFilePaths,
} from "./dependencyResolver";
export type {
  ExecutionBatch,
  Conflict,
  ScheduleSnapshot,
  BlockedTask,
} from "./dependencyResolver";
export {
  VsCodeLanguageModelProvider,
  VsCodeEventEmitterFactory,
  VsCodeCancellationTokenSourceFactory,
  VsCodeStateStoreAdapter,
} from "./vscodeAdapters";
export {
  classifyError,
  isRetryableError,
  computeBackoffDelay,
  resolveRetryConfig,
} from "./retry";
export { SESSION_STATE_TO_CHAT_STATUS } from "./sessionViewAdapter";
export { ContextCoordinator } from "./contextCoordinator";
export type {
  ContextDomain,
  ContextEntry,
  ContextSubset,
  ContextDiff,
  AgentOutput,
  ContextDeclaration,
  ContextStore,
  ContextSnapshot,
  IContextPersistence,
} from "./contextCoordinator";
export { ConflictResolver } from "./conflictResolver";
export type {
  OutputConflictType,
  BaseOutputConflict,
  APIContractConflict,
  DuplicateWorkConflict,
  FileMergeConflict,
  ContradictoryImplConflict,
  OutputConflict,
  ResolutionStrategy,
  Resolution,
  ResolutionOption,
  ResolutionHistoryEntry,
  DiffLine,
  ConflictDiffView,
} from "./conflictResolver";
export { ExecutionEngine } from "./executionEngine";
export type {
  EngineState,
  EngineEvent,
  TaskResult,
  ExecutionSummary,
  EngineConfig,
  EngineDeps,
} from "./executionEngine";
export { CodeWriter } from "./codeWriter";
export type { ExtractedFile, CodeWriteResult, IFileWriter } from "./codeWriter";
export { VsCodeFileWriter } from "./vscodeFileWriter";
export type {
  SessionId,
  SessionState,
  SessionStatus,
  SessionProgress,
  SessionError,
  SessionConfig,
  RetryConfig,
  AgentModelMapping,
  AgentModelConfig,
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
