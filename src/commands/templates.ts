import * as vscode from "vscode";
import {
  getTemplates,
  registerTemplate,
} from "../intelligence";
import type { WorkflowTemplate } from "../intelligence/types";
import type { CommandDeps } from "./index";
import { normalizeError, getUserMessage } from "../utils";

// ===========================================================================
// Template Commands
//
// Browse, create, import, and export workflow templates.
// ===========================================================================

export function registerTemplateCommands(
  context: vscode.ExtensionContext,
  deps: CommandDeps
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("packai.browseTemplates", () =>
      browseTemplates(deps)
    ),
    vscode.commands.registerCommand("packai.createTemplate", () =>
      createTemplateFromPlan(deps)
    ),
    vscode.commands.registerCommand("packai.importTemplate", () =>
      importTemplate(deps)
    ),
    vscode.commands.registerCommand("packai.exportTemplate", () =>
      exportTemplate(deps)
    )
  );
}

// ---------------------------------------------------------------------------
// Browse templates
// ---------------------------------------------------------------------------

async function browseTemplates(deps: CommandDeps): Promise<void> {
  const { logger } = deps;

  try {
    const templates = getTemplates();
    const items = templates.map((t) => ({
      label: `$(file-code) ${t.name}`,
      description: `${t.phases.length} phases, ${t.phases.reduce((sum, p) => sum + p.tasks.length, 0)} tasks`,
      detail: t.description,
      template: t,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a template to view details",
      title: "PackAI: Browse Templates",
    });

    if (!picked) return;

    const template = picked.template;
    const lines: string[] = [
      `Template: ${template.name}`,
      `Description: ${template.description}`,
      `Project Types: ${template.forProjectTypes.join(", ")}`,
      `Default Stack: ${Object.entries(template.defaultStack).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
      "",
    ];

    for (const phase of template.phases) {
      lines.push(`Phase: ${phase.label}`);
      lines.push(`  ${phase.description}`);
      for (const task of phase.tasks) {
        const deps = task.dependsOn.length > 0 ? ` (after: ${task.dependsOn.join(", ")})` : "";
        lines.push(`  - [${task.agent}] ${task.label} (~${task.estimatedMinutes}min)${deps}`);
      }
      lines.push("");
    }

    logger.info(lines.join("\n"));
    logger.show();

    void vscode.window.showInformationMessage(
      `Template "${template.name}": ${template.phases.length} phases, ` +
        `${template.phases.reduce((sum, p) => sum + p.tasks.length, 0)} tasks`
    );
  } catch (err) {
    handleCommandError("browseTemplates", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Create template from current plan
// ---------------------------------------------------------------------------

async function createTemplateFromPlan(deps: CommandDeps): Promise<void> {
  const { logger, currentPlan, settingsAdapter } = deps;

  try {
    if (!currentPlan) {
      void vscode.window.showWarningMessage(
        "PackAI: No active plan. Start a project first."
      );
      return;
    }

    const name = await vscode.window.showInputBox({
      prompt: "Template name",
      placeHolder: "e.g., My E-commerce Template",
      validateInput: (v) => (v.trim().length < 3 ? "Name must be at least 3 characters" : undefined),
    });

    if (!name) return;

    const description = await vscode.window.showInputBox({
      prompt: "Template description",
      placeHolder: "Brief description of what this template does",
    });

    const template: WorkflowTemplate = {
      forProjectTypes: [currentPlan.intent.projectType],
      name,
      description: description ?? "",
      defaultStack: currentPlan.resolvedStack,
      phases: currentPlan.phases.map((p) => ({
        id: p.id,
        label: p.label,
        description: p.description,
        tasks: p.tasks.map((t) => ({
          id: t.id,
          label: t.label,
          prompt: t.prompt,
          agent: t.agent,
          dependsOn: [...t.dependsOn],
          estimatedMinutes: t.estimatedMinutes,
          parallelizable: t.parallelizable,
        })),
      })),
    };

    // Save to custom templates directory if configured
    const settings = settingsAdapter.getSettings();
    const dir = settings.advanced.customTemplatesDirectory;

    if (dir) {
      const fileName = name.toLowerCase().replace(/\s+/g, "-") + ".json";
      const uri = vscode.Uri.joinPath(vscode.Uri.file(dir), fileName);
      const content = Buffer.from(JSON.stringify(template, null, 2), "utf-8");
      await vscode.workspace.fs.writeFile(uri, content);
      logger.info(`Template saved to ${uri.fsPath}`);
    }

    // Register in memory
    registerTemplate(template);

    void vscode.window.showInformationMessage(
      `PackAI: Template "${name}" created${dir ? ` and saved to ${dir}` : ""}.`
    );
  } catch (err) {
    handleCommandError("createTemplate", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Import template from JSON file
// ---------------------------------------------------------------------------

async function importTemplate(deps: CommandDeps): Promise<void> {
  const { logger } = deps;

  try {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { "JSON files": ["json"] },
      title: "Import PackAI Template",
    });

    if (!files || files.length === 0) return;

    const content = await vscode.workspace.fs.readFile(files[0]!);
    const parsed = JSON.parse(Buffer.from(content).toString("utf-8")) as WorkflowTemplate;

    // Basic validation
    if (!parsed.name || !parsed.phases || !Array.isArray(parsed.phases)) {
      void vscode.window.showErrorMessage(
        "PackAI: Invalid template file. Must have 'name' and 'phases' fields."
      );
      return;
    }

    registerTemplate(parsed);
    logger.info(`Imported template: ${parsed.name}`);

    void vscode.window.showInformationMessage(
      `PackAI: Template "${parsed.name}" imported (${parsed.phases.length} phases).`
    );
  } catch (err) {
    handleCommandError("importTemplate", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Export template to JSON file
// ---------------------------------------------------------------------------

async function exportTemplate(deps: CommandDeps): Promise<void> {
  const { logger } = deps;

  try {
    const templates = getTemplates();
    const items = templates.map((t) => ({
      label: t.name,
      description: `${t.forProjectTypes.join(", ")}`,
      template: t,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Select a template to export",
      title: "PackAI: Export Template",
    });

    if (!picked) return;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(
        picked.template.name.toLowerCase().replace(/\s+/g, "-") + ".json"
      ),
      filters: { "JSON files": ["json"] },
      title: "Export PackAI Template",
    });

    if (!uri) return;

    const content = Buffer.from(
      JSON.stringify(picked.template, null, 2),
      "utf-8"
    );
    await vscode.workspace.fs.writeFile(uri, content);

    logger.info(`Exported template "${picked.template.name}" to ${uri.fsPath}`);
    void vscode.window.showInformationMessage(
      `PackAI: Template "${picked.template.name}" exported.`
    );
  } catch (err) {
    handleCommandError("exportTemplate", err, deps);
  }
}

// ---------------------------------------------------------------------------
// Shared error handler
// ---------------------------------------------------------------------------

function handleCommandError(
  command: string,
  err: unknown,
  deps: CommandDeps
): void {
  const normalized = normalizeError(err);
  deps.logger.error(`[${command}] ${normalized.code}: ${normalized.message}`);
  void vscode.window.showErrorMessage(getUserMessage(err));
}
