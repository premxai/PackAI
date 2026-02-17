// @ts-check
/// <reference lib="dom" />

/**
 * PackAI Settings — Client-side webview logic.
 *
 * Communicates with the extension host via postMessage / onmessage.
 * No external dependencies — vanilla JS, IIFE pattern.
 */
(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  /** @type {import("../src/settings/types").PackAISettings | null} */
  let currentSettings = null;

  const TOOL_TYPES = ["READ", "CREATE", "EDIT", "DELETE", "TERMINAL", "WEB_SEARCH"];
  const AGENTS = ["claude", "copilot", "codex"];

  // -----------------------------------------------------------------------
  // Message handler
  // -----------------------------------------------------------------------

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "init":
      case "settings-updated":
        currentSettings = msg.payload.settings;
        populateForm(msg.payload.settings);
        renderErrors(msg.payload.validationErrors || []);
        break;
      case "validation-errors":
        renderErrors(msg.payload);
        break;
      case "save-success":
        showToast("Settings saved");
        renderErrors([]);
        break;
    }
  });

  // -----------------------------------------------------------------------
  // Tab switching
  // -----------------------------------------------------------------------

  document.addEventListener("click", (e) => {
    const target = /** @type {HTMLElement} */ (e.target);
    if (target.classList.contains("tab-btn")) {
      const tabId = target.getAttribute("data-tab");
      if (tabId) switchTab(tabId);
    }
  });

  /**
   * @param {string} tabId
   */
  function switchTab(tabId) {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-tab") === tabId);
    });
    document.querySelectorAll(".tab-content").forEach((panel) => {
      panel.classList.toggle("active", panel.id === "tab-" + tabId);
    });
  }

  // -----------------------------------------------------------------------
  // Populate form from settings
  // -----------------------------------------------------------------------

  /**
   * @param {import("../src/settings/types").PackAISettings} s
   */
  function populateForm(s) {
    // Agent preferences
    setSelect("selectionStrategy", s.agentPreferences.selectionStrategy);
    setSelect("costOptimizationLevel", s.agentPreferences.costOptimizationLevel);
    setNumber("maxParallelSessions", s.agentPreferences.maxParallelSessions);

    // Approval
    setToolCheckboxes("autoApprove", s.approval.autoApproveTools);
    setToolCheckboxes("alwaysDeny", s.approval.alwaysDenyTools);
    for (const agent of AGENTS) {
      setSelect("trust-" + agent, s.approval.agentTrustLevels[agent] || "standard");
    }
    setCheckbox("devContainerMode", s.approval.devContainerMode);
    setCheckbox("productionWorkspace", s.approval.productionWorkspace);

    // UI
    setCheckbox("autoOpenDashboard", s.ui.autoOpenDashboard);
    setSelect("notificationVerbosity", s.ui.notificationVerbosity);
    setSelect("dashboardTheme", s.ui.dashboardTheme);
    setNumber("activityLogLimit", s.ui.activityLogLimit);

    // Advanced
    setText("customTemplatesDirectory", s.advanced.customTemplatesDirectory);
    setText("benchmarkDataPath", s.advanced.benchmarkDataPath);
    setNumber("sessionTimeoutMs", s.advanced.sessionTimeoutMs);
    setNumber("maxRetries", s.advanced.maxRetries);
    setNumber("retryBaseDelayMs", s.advanced.retryBaseDelayMs);
    setCheckbox("telemetryEnabled", s.advanced.telemetryEnabled);
    setCheckbox("gitCheckpointEnabled", s.advanced.gitCheckpointEnabled);
    setNumber("stateCheckpointIntervalMs", s.advanced.stateCheckpointIntervalMs);
  }

  // -----------------------------------------------------------------------
  // Collect form state
  // -----------------------------------------------------------------------

  function collectSettings() {
    /** @type {Record<AgentRole, string>} */
    const trustLevels = {};
    for (const agent of AGENTS) {
      trustLevels[agent] = getSelect("trust-" + agent);
    }

    return {
      agentPreferences: {
        selectionStrategy: getSelect("selectionStrategy"),
        costOptimizationLevel: getSelect("costOptimizationLevel"),
        maxParallelSessions: getNumber("maxParallelSessions"),
      },
      approval: {
        autoApproveTools: getToolCheckboxes("autoApprove"),
        alwaysDenyTools: getToolCheckboxes("alwaysDeny"),
        agentTrustLevels: trustLevels,
        devContainerMode: getCheckbox("devContainerMode"),
        productionWorkspace: getCheckbox("productionWorkspace"),
      },
      ui: {
        autoOpenDashboard: getCheckbox("autoOpenDashboard"),
        notificationVerbosity: getSelect("notificationVerbosity"),
        dashboardTheme: getSelect("dashboardTheme"),
        activityLogLimit: getNumber("activityLogLimit"),
      },
      advanced: {
        customTemplatesDirectory: getText("customTemplatesDirectory"),
        benchmarkDataPath: getText("benchmarkDataPath"),
        sessionTimeoutMs: getNumber("sessionTimeoutMs"),
        maxRetries: getNumber("maxRetries"),
        retryBaseDelayMs: getNumber("retryBaseDelayMs"),
        telemetryEnabled: getCheckbox("telemetryEnabled"),
        gitCheckpointEnabled: getCheckbox("gitCheckpointEnabled"),
        stateCheckpointIntervalMs: getNumber("stateCheckpointIntervalMs"),
      },
    };
  }

  // -----------------------------------------------------------------------
  // User action handlers (exposed globally for onclick)
  // -----------------------------------------------------------------------

  /** Save settings to extension. */
  window.onSaveSettings = function () {
    const settings = collectSettings();
    // Send individual updates for each flat key
    const flat = flattenSettings(settings);
    for (const [key, value] of Object.entries(flat)) {
      vscode.postMessage({
        type: "update-setting",
        payload: { key, value },
      });
    }
  };

  /** Reset all settings to defaults. */
  window.onResetDefaults = function () {
    vscode.postMessage({ type: "reset-defaults" });
  };

  /** Reset a single section to defaults. */
  window.onResetSection = function (/** @type {string} */ section) {
    vscode.postMessage({ type: "reset-section", payload: { section } });
  };

  // -----------------------------------------------------------------------
  // Flatten settings to dot-notated keys
  // -----------------------------------------------------------------------

  /**
   * @param {Record<string, unknown>} obj
   * @param {string} [prefix]
   * @returns {Record<string, unknown>}
   */
  function flattenSettings(obj, prefix) {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? prefix + "." + key : key;
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        // Don't recurse into agentTrustLevels — it's a leaf
        key !== "agentTrustLevels"
      ) {
        Object.assign(result, flattenSettings(/** @type {Record<string, unknown>} */ (value), fullKey));
      } else {
        result[fullKey] = value;
      }
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Validation error rendering
  // -----------------------------------------------------------------------

  /**
   * @param {Array<{field: string, message: string}>} errors
   */
  function renderErrors(errors) {
    const container = document.getElementById("validation-errors");
    if (!container) return;
    container.innerHTML = "";
    for (const err of errors) {
      const div = document.createElement("li");
      div.className = "validation-error";
      div.textContent = err.field + ": " + err.message;
      container.appendChild(div);
    }
  }

  // -----------------------------------------------------------------------
  // Toast
  // -----------------------------------------------------------------------

  /**
   * @param {string} message
   */
  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("visible");
    setTimeout(() => toast.classList.remove("visible"), 2500);
  }

  // -----------------------------------------------------------------------
  // DOM helpers
  // -----------------------------------------------------------------------

  /**
   * @param {string} id
   * @param {string} value
   */
  function setSelect(id, value) {
    const el = /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
    if (el) el.value = value;
  }

  /**
   * @param {string} id
   * @returns {string}
   */
  function getSelect(id) {
    const el = /** @type {HTMLSelectElement | null} */ (document.getElementById(id));
    return el ? el.value : "";
  }

  /**
   * @param {string} id
   * @param {number} value
   */
  function setNumber(id, value) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el) el.value = String(value);
  }

  /**
   * @param {string} id
   * @returns {number}
   */
  function getNumber(id) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    return el ? parseInt(el.value, 10) || 0 : 0;
  }

  /**
   * @param {string} id
   * @param {string} value
   */
  function setText(id, value) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el) el.value = value;
  }

  /**
   * @param {string} id
   * @returns {string}
   */
  function getText(id) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    return el ? el.value : "";
  }

  /**
   * @param {string} id
   * @param {boolean} value
   */
  function setCheckbox(id, value) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    if (el) el.checked = value;
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  function getCheckbox(id) {
    const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
    return el ? el.checked : false;
  }

  /**
   * @param {string} prefix
   * @param {readonly string[]} selected
   */
  function setToolCheckboxes(prefix, selected) {
    for (const tool of TOOL_TYPES) {
      const el = /** @type {HTMLInputElement | null} */ (
        document.getElementById(prefix + "-" + tool)
      );
      if (el) el.checked = selected.includes(tool);
    }
  }

  /**
   * @param {string} prefix
   * @returns {string[]}
   */
  function getToolCheckboxes(prefix) {
    /** @type {string[]} */
    const result = [];
    for (const tool of TOOL_TYPES) {
      const el = /** @type {HTMLInputElement | null} */ (
        document.getElementById(prefix + "-" + tool)
      );
      if (el && el.checked) result.push(tool);
    }
    return result;
  }

  // -----------------------------------------------------------------------
  // Request initial state on load
  // -----------------------------------------------------------------------

  vscode.postMessage({ type: "request-state" });
})();
