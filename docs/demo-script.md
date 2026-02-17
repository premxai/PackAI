# Demo Video Script

A script for recording a walkthrough demo of the PackAI. Estimated runtime: 5--7 minutes.

---

## Scene 1: Introduction (30s)

**Narration:**
> "PackAI is a VS Code extension that coordinates Claude, Copilot, and Codex to build web projects together. Instead of switching between AI tools, you describe what you want and PackAI figures out the best agent for each task."

**On screen:**
- VS Code open with an empty workspace
- Show the extension in the Extensions panel

---

## Scene 2: Starting a Project (60s)

**Action:**
1. Open Command Palette (`Ctrl+Shift+P`)
2. Type "PackAI: Start Project"
3. Select "E-commerce Store"

**Narration:**
> "Let's build an e-commerce store. I'll start a new project from the Command Palette. PackAI gives me project types to choose from, or I can describe something custom."

**On screen:**
- Quick pick appears with 5 project types
- Select "E-commerce Store"
- Progress notification: "Analyzing requirements..."
- Progress notification: "Generating execution plan..."
- Progress notification: "Selecting optimal agents..."
- Dashboard opens automatically

**Narration:**
> "PackAI analyzed my request, generated a 3-phase execution plan with 10 tasks, and assigned each task to the best agent. Claude handles architecture and database design, Copilot handles UI components, and Codex handles test generation."

---

## Scene 3: Viewing the Plan in Chat (60s)

**Action:**
1. Open Chat panel
2. Type: `@packai /scaffold Build an e-commerce store with Stripe payments and PostgreSQL`

**Narration:**
> "I can also use the chat for a detailed view. The /scaffold command shows the full analysis: project type, detected features, resolved stack, and the complete task breakdown."

**On screen:**
- Chat renders the project analysis table
- Chat renders the execution plan with phases, tasks, agent icons, dependencies

**Narration:**
> "Each task shows which agent will handle it, its dependencies, and estimated time. Claude gets the database schema and Stripe integration because those need careful architecture decisions. Copilot gets the UI components because it's fast at generating framework-specific code."

---

## Scene 4: Dashboard Overview (45s)

**Action:**
1. Focus the dashboard panel
2. Point out the different sections

**Narration:**
> "The dashboard shows real-time orchestration status. Here are the phases with their tasks, agent stats showing completed and failed counts, and the activity log tracking everything that happens."

**On screen:**
- Dashboard with phase cards
- Agent status indicators
- Activity log entries

---

## Scene 5: Orchestration Controls (45s)

**Action:**
1. Open Command Palette, show "Pause Orchestration"
2. Show "Resume Orchestration"
3. Show "View Session Details"

**Narration:**
> "You have full control. Pause all sessions to review intermediate results, resume when ready, or cancel if you want to change direction. You can also inspect individual sessions to see their output and status."

**On screen:**
- Command palette showing PackAI commands
- Quick pick of session details

---

## Scene 6: Template Management (45s)

**Action:**
1. Run "Browse Templates" (`Ctrl+Shift+W T`)
2. Select a template, show the details in output channel
3. Run "Export Template"

**Narration:**
> "PackAI ships with 5 built-in templates, and you can create your own. Browse templates to see their phase structure, create templates from your current plan, or import and export JSON files to share with your team."

**On screen:**
- Template quick pick list
- Template details in output channel
- Export save dialog

---

## Scene 7: Configuration (30s)

**Action:**
1. Run "Configure Agent Preferences"
2. Show strategy selection
3. Show cost optimization selection

**Narration:**
> "Configure how agents are selected. The default 'intelligent' mode analyzes each task, but you can prefer a specific agent or use round-robin. You can also tune cost optimization from economy to performance."

**On screen:**
- Strategy quick pick
- Cost level quick pick

---

## Scene 8: Quality Gates (30s)

**Narration:**
> "Every agent output goes through 4 quality gates: syntax checking, security scanning, style validation, and import analysis. If something fails, the agent is asked to retry with specific feedback about what to fix."

**On screen:**
- Show the quality gates section in the docs or code
- Highlight: syntax, security, style, imports

---

## Scene 9: Error Recovery (30s)

**Narration:**
> "If an agent fails, PackAI automatically tries the next agent in line. Claude fails? It tries Copilot. Copilot fails? It tries Codex. The extension also queues requests when hitting rate limits and auto-saves plan state for crash recovery."

**On screen:**
- Show the error recovery flow diagram from architecture docs

---

## Scene 10: Closing (30s)

**Narration:**
> "PackAI: describe your project, get an intelligent execution plan, and let three AI agents build it together. Install from the VS Code marketplace or build from source."

**On screen:**
- README hero section
- GitHub repository link
- "Star on GitHub" call to action

---

## Recording Tips

- Use a clean VS Code theme (Dark+ or Light+)
- Set font size to 16+ for readability
- Use VS Code's built-in zoom (`Ctrl+=`) if needed
- Record at 1920x1080 resolution
- Use an external mic for clear narration
- Edit out long pauses (speed up loading/compilation)
- Add captions for accessibility
