import * as vscode from "vscode";
import type { IFileWriter } from "./codeWriter";

// ===========================================================================
// VsCodeFileWriter
//
// VS Code filesystem adapter for CodeWriter.
// ===========================================================================

export class VsCodeFileWriter implements IFileWriter {
  async writeFile(absolutePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    const bytes = Buffer.from(content, "utf8");
    await vscode.workspace.fs.writeFile(uri, bytes);
  }

  async ensureDirectory(absolutePath: string): Promise<void> {
    const uri = vscode.Uri.file(absolutePath);
    try {
      await vscode.workspace.fs.createDirectory(uri);
    } catch {
      // Directory may already exist — ignore
    }
  }
}
