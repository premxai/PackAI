import * as path from "path";

// ===========================================================================
// CodeWriter
//
// Extracts fenced code blocks from agent markdown output that contain
// file-path comments, then writes them to the workspace.
// No VS Code imports — fully testable with Vitest.
// ===========================================================================

/** A single file extracted from agent output. */
export interface ExtractedFile {
  readonly relativePath: string;
  readonly content: string;
  readonly language: string;
}

/** Result of writing extracted files to disk. */
export interface CodeWriteResult {
  readonly filesWritten: readonly string[];
  readonly filesSkipped: readonly string[];
  readonly errors: readonly { path: string; error: string }[];
}

/** Abstraction over filesystem writes for testability. */
export interface IFileWriter {
  writeFile(absolutePath: string, content: string): Promise<void>;
  ensureDirectory(absolutePath: string): Promise<void>;
}

/** File names that should never be written for security reasons. */
const BLOCKED_FILES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  "secrets.json",
  "id_rsa",
  "id_ed25519",
]);

/**
 * Regex to match fenced code blocks with a file path on the first line.
 *
 * Supports these comment styles on the first content line:
 *   // path/to/file.ts
 *   /* path/to/file.css *​/
 *   # path/to/file.py
 *   <!-- path/to/file.html -->
 */
const CODE_BLOCK_RE =
  /```(\w+)\n(?:\/\/|\/\*|#|<!--)\s*(\S+\.[\w.]+)\s*(?:\*\/|-->)?\n([\s\S]*?)```/g;

export class CodeWriter {
  constructor(private readonly fileWriter: IFileWriter) {}

  /** Extract files from agent markdown output. */
  extractFiles(output: string): ExtractedFile[] {
    const files: ExtractedFile[] = [];
    let match: RegExpExecArray | null;

    // Reset regex state
    CODE_BLOCK_RE.lastIndex = 0;

    while ((match = CODE_BLOCK_RE.exec(output)) !== null) {
      const language = match[1]!;
      const relativePath = match[2]!;
      const content = match[3]!.trimEnd();

      if (this.isValidPath(relativePath)) {
        files.push({ relativePath, content, language });
      }
    }

    return files;
  }

  /** Write extracted files to the workspace root. */
  async writeFiles(
    workspaceRoot: string,
    files: readonly ExtractedFile[]
  ): Promise<CodeWriteResult> {
    const filesWritten: string[] = [];
    const filesSkipped: string[] = [];
    const errors: { path: string; error: string }[] = [];

    for (const file of files) {
      if (this.isBlocked(file.relativePath)) {
        filesSkipped.push(file.relativePath);
        continue;
      }

      const absolutePath = path.join(workspaceRoot, file.relativePath);

      // Ensure the resolved path is inside the workspace
      if (!absolutePath.startsWith(workspaceRoot)) {
        filesSkipped.push(file.relativePath);
        continue;
      }

      try {
        const dir = path.dirname(absolutePath);
        await this.fileWriter.ensureDirectory(dir);
        await this.fileWriter.writeFile(absolutePath, file.content);
        filesWritten.push(absolutePath);
      } catch (err) {
        errors.push({
          path: file.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { filesWritten, filesSkipped, errors };
  }

  /** Extract and write in one step. */
  async extractAndWrite(
    workspaceRoot: string,
    output: string
  ): Promise<CodeWriteResult> {
    const files = this.extractFiles(output);
    if (files.length === 0) {
      return { filesWritten: [], filesSkipped: [], errors: [] };
    }
    return this.writeFiles(workspaceRoot, files);
  }

  /** Check that a relative path is safe. */
  private isValidPath(relativePath: string): boolean {
    // Reject absolute paths
    if (path.isAbsolute(relativePath)) return false;
    // Reject directory traversal
    if (relativePath.includes("..")) return false;
    // Must have a file extension
    if (!relativePath.includes(".")) return false;
    return true;
  }

  /** Check if a file is in the blocklist. */
  private isBlocked(relativePath: string): boolean {
    const basename = path.basename(relativePath);
    return BLOCKED_FILES.has(basename);
  }
}
