/**
 * SPES Portal — RBAC DOM Guard
 * ─────────────────────────────
 * Scans the page for elements with `data-permission` attributes
 * and removes / disables / hides them based on the current user's role.
 *
 * Permission resolution order:
 *   1. Admin role → always granted (static RBAC)
 *   2. DB permissions (stored in session.permissions) → checked for officer
 *   3. Static RBAC config → fallback
 *
 * Usage in HTML:
 *   <div data-permission="users:edit">Edit button here</div>
 *   <button data-permission="users:delete" data-permission-mode="disable">Delete</button>
 *
 * Modes:
 *   "remove"  (default) — completely removes the element from the DOM
 *   "disable" — adds `pointer-events-none opacity-40` and sets disabled
 *   "hide"    — adds `hidden` class
 */
import { canDo } from "./config.js";
import { modals } from "../components/modals.js";

// Map permission strings used in HTML → DB column names in session.permissions
const DB_PERM_MAP = {
  "users:view":    (p) => p.view_users,
  "users:create":  (p) => p.create_users,
  "users:manage":  (p) => p.create_users || p.edit_users,
  "users:edit":    (p) => p.edit_users,
  "users:delete":  (p) => p.delete_users,
  "offices:view-other": (p) => p.view_other_offices,
  "analytics:view-global": (p) => p.view_global_stats,
  // Approved users may export their own office. `export_reports` only expands
  // that scope when paired with read-only cross-office access.
  "reports:export":(_p, session) => session?.approved === true,
  "reports:view":  (p) => p.view_users || p.export_reports,
  "beneficiaries:view": () => true,  // officers can always view beneficiaries
};

/**
 * Check whether the session's DB permissions cover a given permission string.
 * Returns `null` if the permission isn't mapped to a DB column (fall back to RBAC).
 */
function _checkDbPermission(dbPerms, permission, session) {
  if (!dbPerms || !(permission in DB_PERM_MAP)) return null;
  return Boolean(DB_PERM_MAP[permission](dbPerms, session));
}

/**
 * Resolve whether the current user has a given permission.
 * Admins always win via static RBAC.
 * Officers/students use DB permissions first, then static RBAC.
 */
async function _hasPermission(userRole, permission, session) {
  // Admin is fully handled by the static RBAC which grants everything
  if (userRole === "admin") return true;

  // Baseline approved access must not disappear when a permissions row is
  // missing or still using the pre-scope schema.
  if (permission === "reports:export") return session?.approved === true;

  // Check DB-stored permissions for officer / student
  const dbResult = _checkDbPermission(session?.permissions, permission, session);
  if (dbResult !== null) return dbResult;

  // Fallback to static RBAC config
  return canDo(userRole, permission);
}

/**
 * Apply RBAC permissions to the DOM.
 * Call once after page load with the authenticated user's role.
 *
 * @param {string} userRole – "admin" | "officer" | "student"
 */
export async function applyPermissions(userRole) {
  const session = getSession();
  const els = document.querySelectorAll("[data-permission]");

  for (const el of els) {
    const permission = el.getAttribute("data-permission");
    const mode = el.getAttribute("data-permission-mode") || "remove";
    const allowed = await _hasPermission(userRole, permission, session);

    if (allowed) {
      el.classList.remove("hidden");
      continue;
    }

    switch (mode) {
      case "disable":
        el.classList.add("pointer-events-none", "opacity-40");
        el.setAttribute("disabled", "true");
        el.setAttribute("tabindex", "-1");
        el.setAttribute("aria-disabled", "true");
        break;
      case "hide":
        el.classList.add("hidden");
        break;
      case "remove":
      default:
        el.remove();
        break;
    }
  }
}

/**
 * Get stored session from localStorage.
 * @returns {{ id, role, role_id, full_name, email, permissions } | null}
 */
export function getSession() {
  try {
    const raw = localStorage.getItem("spes_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Redirect to login if no valid session exists.
 * Call at the top of every protected page.
 */
export function requireAuth() {
  const session = getSession();
  if (!session || !session.role) {
    window.location.href = "/src/frontend/login/";
    return null;
  }
  return session;
}

/**
 * Sign out — set status OFFLINE in DB, clear session + all caches, redirect to login.
 */
export function signOut() {
  modals.confirm(
    "Sign Out",
    "Are you sure you want to log out of the SPES Portal?",
    "Yes, Sign Out",
    "Cancel"
  ).then(async (result) => {
    if (result.isConfirmed) {
      // Set staff status to OFFLINE in DB before clearing the session
      try {
        const raw = localStorage.getItem("spes_session");
        if (raw) {
          const s = JSON.parse(raw);
          if (s?.id) {
            const { supabase } = await import("../../../../backend/api/supabase.js");
            await supabase.from("staffs").update({ status: "OFFLINE" }).eq("id", s.id);
          }
        }
      } catch { /* non-critical — proceed with logout regardless */ }

      localStorage.removeItem("spes_session");
      localStorage.removeItem("spes_supabase_token");
      sessionStorage.clear();
      window.location.href = "/src/frontend/login/";
    }
  });
}
