const SCOPE_STORAGE_KEYS = {
  landing: "spes_landing_flow_copy_seen",
  login: "spes_login_welcome_copy_seen"
};

function wasReload() {
  if (typeof performance === "undefined") return false;
  const entry = performance.getEntriesByType?.("navigation")?.[0];
  if (entry && "type" in entry) return entry.type === "reload";
  const legacyNav = performance.navigation;
  if (legacyNav && typeof legacyNav.type === "number") return legacyNav.type === 1;
  return false;
}

function revealScopeRoots(roots) {
  roots.forEach((root) => {
    root.querySelector("[data-text-placeholder-skeleton]")?.classList.add("hidden");
    root.querySelector("[data-text-placeholder-content]")?.classList.remove("hidden");
    root.removeAttribute("aria-busy");
  });
}

function markScopeSeen(scope) {
  const key = SCOPE_STORAGE_KEYS[scope];
  if (!key) return;
  try {
    localStorage.setItem(key, "1");
  } catch {
    /* ignore */
  }
}

function shouldSkipSkeleton(scope) {
  const key = SCOPE_STORAGE_KEYS[scope];
  if (!key) return true;
  let seen = false;
  try {
    seen = localStorage.getItem(key) === "1";
  } catch {
    seen = false;
  }
  return seen && !wasReload();
}

export function initScopedTextPlaceholders() {
  const roots = Array.from(document.querySelectorAll("[data-text-placeholder-root]"));
  if (!roots.length) return;

  const byScope = new Map();
  roots.forEach((root) => {
    const scope = root.getAttribute("data-text-placeholder-scope") || "landing";
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(root);
  });

  const delayMs = 820;

  byScope.forEach((scopeRoots, scope) => {
    if (!SCOPE_STORAGE_KEYS[scope]) {
      revealScopeRoots(scopeRoots);
      return;
    }

    if (shouldSkipSkeleton(scope)) {
      revealScopeRoots(scopeRoots);
      return;
    }

    scopeRoots.forEach((root) => {
      root.setAttribute("aria-busy", "true");
      root.querySelector("[data-text-placeholder-skeleton]")?.classList.remove("hidden");
      root.querySelector("[data-text-placeholder-content]")?.classList.add("hidden");
    });

    window.setTimeout(() => {
      revealScopeRoots(scopeRoots);
      markScopeSeen(scope);
    }, delayMs);
  });
}
