/**
 * SPES Flow Debugger
 *
 * DEFAULT_FLOW_DEBUG_ENABLED is the long-term default.
 * TEMPORARY_FLOW_DEBUG_ENABLED is intentionally true while the current UI
 * flows are being diagnosed. Set it back to false when debugging is complete.
 */
const DEFAULT_FLOW_DEBUG_ENABLED = false;
const TEMPORARY_FLOW_DEBUG_ENABLED = false;
const STORAGE_KEY = "spes_flow_debug";

let initialized = false;
let sequence = 0;

function readStoredOverride() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch {}
  return null;
}

export function isFlowDebugEnabled() {
  const stored = readStoredOverride();
  if (stored !== null) return stored;
  return import.meta.env?.DEV ?? true;
}

export function setFlowDebugEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, String(Boolean(enabled)));
  } catch {}
  return Boolean(enabled);
}

function describeElement(element) {
  if (!(element instanceof Element)) return { element: "unknown" };

  const label = (
    element.getAttribute("aria-label") ||
    element.getAttribute("title") ||
    element.textContent ||
    ""
  ).replace(/\s+/g, " ").trim().slice(0, 120);

  return {
    element: element.tagName.toLowerCase(),
    id: element.id || undefined,
    action: element.dataset.flow || element.dataset.action || undefined,
    label: label || undefined,
    disabled: "disabled" in element ? Boolean(element.disabled) : undefined,
  };
}

// START: write - Core log writer with color-coded console output per level
function write(level, stage, message, details) {
  if (!isFlowDebugEnabled()) return;
  sequence += 1;
  const ts = new Date().toLocaleTimeString("en-PH", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // Color palette per stage/level
  const styles = {
    log:   "color:#2563eb;font-weight:700;",
    info:  "color:#059669;font-weight:800;",
    warn:  "color:#d97706;font-weight:700;",
    error: "color:#dc2626;font-weight:800;",
  };
  const stageColors = {
    "DATEPICKER": "background:#eff6ff;color:#1d4ed8;padding:1px 4px;border-radius:3px;font-weight:900;",
    "DRAWER":     "background:#f0fdf4;color:#166534;padding:1px 4px;border-radius:3px;font-weight:900;",
    "CLICK":      "background:#fefce8;color:#92400e;padding:1px 4px;border-radius:3px;font-weight:900;",
    "SUCCESS":    "background:#dcfce7;color:#15803d;padding:1px 4px;border-radius:3px;font-weight:900;",
    "ERROR":      "background:#fee2e2;color:#991b1b;padding:1px 4px;border-radius:3px;font-weight:900;",
    "OUTPUT":     "background:#f3e8ff;color:#6b21a8;padding:1px 4px;border-radius:3px;font-weight:900;",
    "INIT":       "background:#f0f9ff;color:#075985;padding:1px 4px;border-radius:3px;font-weight:900;",
  };

  const stageStyle = stageColors[stage] || "background:#f1f5f9;color:#334155;padding:1px 4px;border-radius:3px;font-weight:700;";
  const baseStyle  = styles[level] || styles.log;
  const method = console[level] || console.log;

  const prefix = `%c[SPES #${sequence}]%c ${ts} %c${stage}%c — ${message}`;
  const prefixStyles = [
    "color:#6b7280;font-size:10px;",
    "color:#9ca3af;font-size:10px;",
    stageStyle,
    baseStyle,
  ];

  if (details === undefined) method(prefix, ...prefixStyles);
  else method(prefix, ...prefixStyles, details);
}
// END: write

export function flowDebug(stage, message, details) {
  write("log", stage, message, details);
}

export function flowDebugSuccess(message, details) {
  write("info", "SUCCESS", message, details);
}

export function flowDebugError(message, error, details = {}) {
  write("error", "ERROR", message, {
    ...details,
    error: error?.message || String(error || "Unknown error"),
  });
}

function findInteractiveTarget(event) {
  const origin = event.target instanceof Element ? event.target : null;
  return origin?.closest(
    "button, a, input, [role='button'], [data-flow], [data-action], [datepicker], [date-rangepicker]"
  ) || null;
}

function snapshotOutcome(target) {
  const openLayers = [...document.querySelectorAll(
    "[role='dialog']:not(.hidden), [id*='drawer'][aria-hidden='false'], .swal2-container"
  )].map((element) => element.id || element.getAttribute("aria-label") || element.className)
    .slice(0, 8);

  return {
    target: describeElement(target),
    url: window.location.href,
    ariaExpanded: target?.getAttribute("aria-expanded") ?? undefined,
    ariaPressed: target?.getAttribute("aria-pressed") ?? undefined,
    openLayers,
  };
}

export function initFlowDebugger() {
  if (initialized) return;
  initialized = true;
  if (!isFlowDebugEnabled()) return;

  window.SPES_FLOW_DEBUG = Object.freeze({
    isEnabled: isFlowDebugEnabled,
    enable: () => setFlowDebugEnabled(true),
    disable: () => setFlowDebugEnabled(false),
    clearOverride: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      return isFlowDebugEnabled();
    },
  });

  if (isFlowDebugEnabled()) {
    flowDebug("INIT", "Flow debugger enabled", {
      defaultEnabled: DEFAULT_FLOW_DEBUG_ENABLED,
      temporaryEnabled: TEMPORARY_FLOW_DEBUG_ENABLED,
      storedOverride: readStoredOverride(),
      hint: "Run SPES_FLOW_DEBUG.disable() to disable or SPES_FLOW_DEBUG.enable() to enable.",
    });
  }

  document.addEventListener("click", (event) => {
    const target = findInteractiveTarget(event);
    if (!target) return;

    const clickId = `click-${Date.now()}-${sequence + 1}`;
    flowDebug("CLICK", "Interactive control activated", {
      clickId,
      ...describeElement(target),
      next: target.dataset.flowNext || target.getAttribute("href") || "waiting for registered click handler",
    });

    setTimeout(() => {
      flowDebug("OUTPUT", "Post-click UI state", {
        clickId,
        ...snapshotOutcome(target),
      });
    }, 0);
  }, true);

  window.addEventListener("error", (event) => {
    flowDebugError("Unhandled window error", event.error || event.message, {
      source: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    flowDebugError("Unhandled promise rejection", event.reason);
  });
}

initFlowDebugger();
