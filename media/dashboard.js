// ===========================================================================
// WebFlow Dashboard — Client-side logic
//
// Runs inside the VS Code webview. Receives typed messages from the
// extension host and renders updates via DOM manipulation.
// ===========================================================================

// @ts-check
/* global acquireVsCodeApi */

(function () {
  "use strict";

  const vscode = acquireVsCodeApi();

  /** @type {{ phases: any[], agents: any[], activities: any[], conflicts: any[], stats: any }} */
  let state = {
    phases: [],
    agents: [
      { role: "claude", status: "idle", tasksCompleted: 0, tasksFailed: 0 },
      { role: "copilot", status: "idle", tasksCompleted: 0, tasksFailed: 0 },
      { role: "codex", status: "idle", tasksCompleted: 0, tasksFailed: 0 },
    ],
    activities: [],
    conflicts: [],
    stats: { totalTasks: 0, completedTasks: 0, failedTasks: 0, runningTasks: 0, estimatedMinutesRemaining: 0, elapsedMs: 0 },
  };

  // -------------------------------------------------------------------------
  // Message handler
  // -------------------------------------------------------------------------

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
        state = msg.payload;
        renderAll();
        break;
      case "phase-update":
        updatePhaseInState(msg.payload);
        renderPhases();
        break;
      case "task-update":
        updateTaskInState(msg.payload);
        renderPhases();
        break;
      case "agent-update":
        updateAgentInState(msg.payload);
        renderAgents();
        break;
      case "progress":
        updateProgressBar(msg.payload);
        break;
      case "activity":
        addActivityToState(msg.payload);
        renderActivities();
        break;
      case "conflict":
        addConflictToState(msg.payload);
        renderConflicts();
        break;
      case "conflict-resolved":
        removeConflictFromState(msg.payload.conflictId);
        renderConflicts();
        break;
      case "stats":
        state.stats = msg.payload;
        renderStats();
        break;
    }
  });

  // -------------------------------------------------------------------------
  // State mutations
  // -------------------------------------------------------------------------

  function updatePhaseInState(phase) {
    const idx = state.phases.findIndex((p) => p.id === phase.id);
    if (idx !== -1) state.phases[idx] = phase;
    else state.phases.push(phase);
  }

  function updateTaskInState(task) {
    for (const phase of state.phases) {
      const idx = phase.tasks.findIndex((t) => t.id === task.id);
      if (idx !== -1) {
        phase.tasks[idx] = { ...phase.tasks[idx], ...task };
        return;
      }
    }
  }

  function updateAgentInState(agent) {
    const idx = state.agents.findIndex((a) => a.role === agent.role);
    if (idx !== -1) state.agents[idx] = agent;
  }

  function addActivityToState(entry) {
    state.activities.push(entry);
    if (state.activities.length > 100) state.activities.shift();
  }

  function addConflictToState(conflict) {
    state.conflicts.push(conflict);
  }

  function removeConflictFromState(conflictId) {
    state.conflicts = state.conflicts.filter((c) => c.id !== conflictId);
  }

  // -------------------------------------------------------------------------
  // Renderers
  // -------------------------------------------------------------------------

  function renderAll() {
    renderStats();
    renderAgents();
    renderPhases();
    renderConflicts();
    renderActivities();
  }

  function renderStats() {
    const s = state.stats;
    const pct = s.totalTasks > 0
      ? Math.round((s.completedTasks / s.totalTasks) * 100)
      : 0;

    const bar = document.getElementById("overall-progress");
    if (bar) bar.style.width = pct + "%";

    const label = document.getElementById("progress-label");
    if (label) label.textContent = `${s.completedTasks} / ${s.totalTasks} tasks (${pct}%)`;

    const elapsed = document.getElementById("stat-elapsed");
    if (elapsed) elapsed.textContent = formatDuration(s.elapsedMs);

    const remaining = document.getElementById("stat-remaining");
    if (remaining) remaining.textContent = `~${s.estimatedMinutesRemaining} min left`;
  }

  function renderAgents() {
    for (const agent of state.agents) {
      const card = document.getElementById(`agent-${agent.role}`);
      if (!card) continue;

      card.setAttribute("data-status", agent.status);

      const statusEl = document.getElementById(`agent-${agent.role}-status`);
      if (statusEl) {
        statusEl.textContent = agent.status;
        statusEl.className = `agent-status ${agent.status}`;
      }

      const taskEl = document.getElementById(`agent-${agent.role}-task`);
      if (taskEl) {
        taskEl.textContent = agent.currentTaskLabel || "";
        taskEl.title = agent.currentTaskLabel || "";
      }

      const compEl = document.getElementById(`agent-${agent.role}-completed`);
      if (compEl) compEl.textContent = String(agent.tasksCompleted);

      const failEl = document.getElementById(`agent-${agent.role}-failed`);
      if (failEl) failEl.textContent = String(agent.tasksFailed);
    }
  }

  function renderPhases() {
    const container = document.getElementById("phases-container");
    const empty = document.getElementById("phases-empty");
    if (!container) return;

    if (state.phases.length === 0) {
      container.innerHTML = "";
      if (empty) empty.style.display = "";
      return;
    }
    if (empty) empty.style.display = "none";

    container.innerHTML = state.phases.map((phase) => {
      const tasksHtml = phase.tasks.map((task) => {
        const icon = taskIcon(task.status);
        const actions = task.status === "running"
          ? `<div class="task-actions">
              <button onclick="onPause('${esc(task.id)}')" title="Pause">&#10074;&#10074;</button>
              <button onclick="onCancel('${esc(task.id)}')" title="Cancel">&#10005;</button>
             </div>`
          : task.status === "pending"
            ? ""
            : "";
        return `<div class="task-row">
          <span class="task-icon ${task.status}">${icon}</span>
          <span class="task-label" title="${esc(task.label)}">${esc(task.label)}</span>
          <span class="task-agent">${esc(task.agent)}</span>
          ${actions}
        </div>`;
      }).join("");

      const isRunning = phase.status === "running";
      return `<div class="phase">
        <div class="phase-header" onclick="togglePhase(this)">
          <span class="phase-chevron ${isRunning ? "" : "collapsed"}">&#9660;</span>
          <span class="phase-label">${esc(phase.label)}</span>
          <span class="phase-status ${phase.status}">${phase.status}</span>
        </div>
        <div class="phase-tasks ${isRunning ? "" : "hidden"}">${tasksHtml}</div>
      </div>`;
    }).join("");
  }

  function renderConflicts() {
    const section = document.getElementById("conflicts-section");
    const container = document.getElementById("conflicts-container");
    const countEl = document.getElementById("conflict-count");
    if (!section || !container) return;

    if (state.conflicts.length === 0) {
      section.style.display = "none";
      return;
    }

    section.style.display = "";
    if (countEl) countEl.textContent = String(state.conflicts.length);

    container.innerHTML = state.conflicts.map((c) => {
      const btns = c.options.map((opt, i) => {
        const cls = i === 0 ? "conflict-btn primary" : "conflict-btn";
        return `<button class="${cls}" onclick="onResolveConflict('${esc(c.id)}', '${esc(opt.strategy)}')" title="${esc(opt.description)}">${esc(opt.label)}</button>`;
      }).join("");
      return `<div class="conflict-card severity-${c.severity}">
        <div class="conflict-type">${esc(c.type)}</div>
        <div class="conflict-description">${esc(c.description)}</div>
        <div class="conflict-actions">${btns}</div>
      </div>`;
    }).join("");
  }

  function renderActivities() {
    const log = document.getElementById("activity-log");
    const empty = document.getElementById("activity-empty");
    if (!log) return;

    if (state.activities.length === 0) {
      if (empty) empty.style.display = "";
      return;
    }
    if (empty) empty.style.display = "none";

    // Keep only the rendered entries, append new ones
    const existing = log.querySelectorAll(".activity-entry").length;
    const newEntries = state.activities.slice(existing);

    for (const entry of newEntries) {
      const el = document.createElement("div");
      el.className = `activity-entry level-${entry.level}`;
      el.innerHTML = `<span class="activity-time">${formatTime(entry.timestamp)}</span>` +
        `<span class="activity-agent ${esc(entry.agent)}">[${esc(entry.agent)}]</span>` +
        `<span class="activity-message">${esc(entry.message)}</span>`;
      log.appendChild(el);
    }

    // Auto-scroll to bottom
    log.scrollTop = log.scrollHeight;
  }

  // -------------------------------------------------------------------------
  // Progress bar update (incremental, no full re-render)
  // -------------------------------------------------------------------------

  function updateProgressBar(progress) {
    // Update the task's progress in state
    for (const phase of state.phases) {
      const task = phase.tasks.find((t) => t.id === progress.taskId);
      if (task) {
        task.progress = progress.percent;
        task.message = progress.message;
        task.elapsedMs = progress.elapsedMs;
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // User actions (exposed globally for onclick handlers)
  // -------------------------------------------------------------------------

  window.onPause = function (taskId) {
    vscode.postMessage({ type: "pause", payload: { taskId: taskId } });
  };

  window.onResume = function (taskId) {
    vscode.postMessage({ type: "resume", payload: { taskId: taskId } });
  };

  window.onCancel = function (taskId) {
    vscode.postMessage({ type: "cancel", payload: { taskId: taskId } });
  };

  window.onResolveConflict = function (conflictId, strategy) {
    vscode.postMessage({
      type: "resolve-conflict",
      payload: { conflictId: conflictId, strategy: strategy },
    });
  };

  window.togglePhase = function (headerEl) {
    const chevron = headerEl.querySelector(".phase-chevron");
    const tasks = headerEl.nextElementSibling;
    if (chevron && tasks) {
      chevron.classList.toggle("collapsed");
      tasks.classList.toggle("hidden");
    }
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function taskIcon(status) {
    switch (status) {
      case "completed": return "\u2713";  // ✓
      case "running":   return "\u25CF";  // ●
      case "failed":    return "\u2717";  // ✗
      case "skipped":   return "\u2014";  // —
      default:          return "\u25CB";  // ○
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, "0")}`;
  }

  function esc(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // -------------------------------------------------------------------------
  // Initial state request
  // -------------------------------------------------------------------------

  vscode.postMessage({ type: "request-state" });
})();
