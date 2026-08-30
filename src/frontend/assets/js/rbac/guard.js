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
  "users:view":    (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.view_users)),
  "users:create":  (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.create_users)),
  "users:manage":  (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.create_users || p?.edit_users)),
  "users:edit":    (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.edit_users)),
  "users:delete":  (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.delete_users)),
  "offices:view-other": (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.view_other_offices)),
  "analytics:view-global": (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.view_global_stats)),
  "payroll:view":  (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.view_payroll)),
  "payroll:manage":(p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.view_payroll)),
  // Approved users may export their own office.
  "reports:export":(_p, session) => String(session?.role || "").toLowerCase() === "admin" || session?.approved === true,
  "reports:view":  (p, session) => String(session?.role || "").toLowerCase() === "admin" || (session?.approved === true && Boolean(p?.view_users || p?.export_reports)),
  "beneficiaries:view": (_p, session) => String(session?.role || "").toLowerCase() === "admin" || session?.approved === true,
  "services:manage": (_p, session) => String(session?.role || "").toLowerCase() === "admin",
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

  // Unapproved accounts cannot view beneficiaries, implementors, payroll, or export reports
  if (session?.approved !== true) {
    return false;
  }

  // Baseline approved access for exports and beneficiaries
  if (permission === "reports:export" || permission === "beneficiaries:view") {
    return true;
  }

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

  highlightSidebarActiveLink();
}

/**
 * Highlight and style the active sidebar navigation item, active tree dot,
 * and expand parent dropdowns if inside a nested branch.
 *
 * @param {string} [navId] - e.g. "overview", "beneficiaries", "payroll", "implementor-list", "roles", "exports", "settings", "about-developer", "auto-import"
 */
export function highlightSidebarActiveLink(navId) {
  let targetNavId = navId;
  if (!targetNavId) {
    const path = window.location.pathname;
    if (path.includes("/dashboard/")) targetNavId = "overview";
    else if (path.includes("/beneficiaries/")) targetNavId = "beneficiaries";
    else if (path.includes("/payroll/")) targetNavId = "payroll";
    else if (path.includes("/implementors/")) targetNavId = "implementor-list";
    else if (path.includes("/roles/")) targetNavId = "roles";
    else if (path.includes("/exports/")) targetNavId = "exports";
    else if (path.includes("/settings/")) targetNavId = "settings";
    else if (path.includes("/about/")) targetNavId = "about-developer";
    else if (path.includes("beneficiary-csv-import-review")) targetNavId = "auto-import";
  }

  if (!targetNavId) return;

  // Reset all dropdown triggers
  document.querySelectorAll(".sidebar-dropdown-btn").forEach(trigger => {
    trigger.classList.remove("active", "bg-spes-blue/10", "dark:bg-spes-white/10", "text-spes-blue", "dark:text-spes-yellow", "font-bold");
    trigger.removeAttribute("data-active");
    const outlineIcon = trigger.querySelector(".icon-outline");
    const solidIcon = trigger.querySelector(".icon-solid");
    if (outlineIcon) outlineIcon.classList.remove("!hidden");
    if (solidIcon) {
      solidIcon.classList.remove("!block");
      solidIcon.classList.add("hidden");
    }
  });

  // Reset all sub-items & dots
  document.querySelectorAll("ul[id^='sidebar-dropdown-'] > li").forEach(item => {
    item.removeAttribute("data-active");
    item.classList.remove(
      "before:border-spes-blue", "before:bg-spes-blue",
      "dark:before:border-spes-yellow", "dark:before:bg-spes-yellow"
    );
    const dot = item.querySelector(".tree-dot");
    if (dot) {
      dot.classList.remove("bg-spes-blue", "border-spes-blue", "dark:bg-spes-yellow", "dark:border-spes-yellow");
      dot.classList.add("bg-spes-white", "border-spes-blue/30", "dark:bg-spes-dark-secondary", "dark:border-white/30");
    }
  });

  document.querySelectorAll(".sidebar-link").forEach(link => {
    const isMatch = link.getAttribute("data-nav-item") === targetNavId;
    const isSubLink = link.closest("ul[id^='sidebar-dropdown-']");
    const subItem = link.closest("li");
    const outlineIcon = link.querySelector(".icon-outline");
    const solidIcon = link.querySelector(".icon-solid");

    if (isMatch) {
      link.classList.add("active");
      link.setAttribute("data-active", "true");

      if (outlineIcon) outlineIcon.classList.add("!hidden");
      if (solidIcon) {
        solidIcon.classList.remove("hidden");
        solidIcon.classList.add("!block");
      }

      if (isSubLink) {
        link.classList.add("text-spes-blue", "dark:text-spes-yellow", "font-bold");
        link.classList.remove("text-spes-black/70", "dark:text-spes-white/70", "bg-spes-blue/10", "dark:bg-spes-white/10");

        if (subItem) {
          subItem.setAttribute("data-active", "true");
          subItem.classList.add(
            "before:border-spes-blue", "before:bg-spes-blue",
            "dark:before:border-spes-yellow", "dark:before:bg-spes-yellow"
          );
          const dot = subItem.querySelector(".tree-dot");
          if (dot) {
            dot.classList.add("bg-spes-blue", "border-spes-blue", "dark:bg-spes-yellow", "dark:border-spes-yellow");
            dot.classList.remove("bg-spes-white", "border-spes-blue/30", "dark:bg-spes-dark-secondary", "dark:border-white/30");
          }
        }

        // Expand parent dropdown and style trigger button
        isSubLink.classList.remove("hidden");
        const trigger = document.querySelector(`[aria-controls="${isSubLink.id}"]`);
        if (trigger) {
          trigger.classList.add(
            "active",
            "bg-spes-blue/10", "dark:bg-spes-white/10",
            "text-spes-blue", "dark:text-spes-yellow",
            "font-bold"
          );
          trigger.setAttribute("data-active", "true");
          trigger.setAttribute("aria-expanded", "true");
          trigger.querySelector("svg:last-child")?.classList.add("rotate-180");
          const trgOutline = trigger.querySelector(".icon-outline");
          const trgSolid = trigger.querySelector(".icon-solid");
          if (trgOutline) trgOutline.classList.add("!hidden");
          if (trgSolid) {
            trgSolid.classList.remove("hidden");
            trgSolid.classList.add("!block");
          }
        }
      } else {
        link.classList.add(
          "bg-spes-blue/10", "dark:bg-spes-white/10",
          "text-spes-blue", "dark:text-spes-yellow",
          "font-bold"
        );
        link.classList.remove("text-spes-black/80", "dark:text-spes-white/80");
      }
    } else {
      link.classList.remove(
        "active",
        "bg-spes-blue/10", "dark:bg-spes-white/10", "dark:bg-spes-yellow/15",
        "text-spes-blue", "dark:text-spes-yellow",
        "font-bold"
      );
      link.removeAttribute("data-active");

      if (outlineIcon) outlineIcon.classList.remove("!hidden");
      if (solidIcon) {
        solidIcon.classList.remove("!block");
        solidIcon.classList.add("hidden");
      }

      if (isSubLink) {
        link.classList.add("text-spes-black/70", "dark:text-spes-white/70");
      } else {
        link.classList.add("text-spes-black/80", "dark:text-spes-white/80");
      }
    }
  });
}

/**
 * Get stored session from localStorage.
 * @returns {{ id, role, role_id, full_name, email, permissions } | null}
 */
export function getSession() {
  try {
    // SSO writes only safe display data to this tab. Authentication remains the HttpOnly server cookie.
    const raw = sessionStorage.getItem("spes_session") || localStorage.getItem("spes_session");
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
 * Require an authenticated admin role.
 * Redirects non-admins to the dashboard and unauthenticated users to login.
 */
export function requireAdmin() {
  const session = requireAuth();
  if (!session) return null;
  const role = String(session.role || "").toLowerCase();
  if (role !== "admin") {
    window.location.href = "/src/frontend/pages/dashboard/";
    return null;
  }
  return session;
}

/**
 * Require beneficiary directory access permission (Admin or approved staff).
 * Redirects unapproved or unauthorized users to the dashboard.
 */
export function requireBeneficiariesAccess() {
  const session = requireAuth();
  if (!session) return null;
  const role = String(session.role || "").toLowerCase();
  const isAdmin = role === "admin" || Number(session.role_id) === 1;
  const isApproved = session.approved === true;

  if (!isAdmin && !isApproved) {
    window.location.href = "/src/frontend/pages/dashboard/";
    return null;
  }
  return session;
}

/**
 * Require payroll access permission (Admin or approved staff with view_payroll permission).
 * Redirects unauthorized users to the dashboard.
 */
export function requirePayrollAccess() {
  const session = requireAuth();
  if (!session) return null;
  const role = String(session.role || "").toLowerCase();
  const isAdmin = role === "admin" || Number(session.role_id) === 1;
  const isApproved = session.approved === true;
  const hasPayrollPerm = isApproved && Boolean(session.permissions?.view_payroll);

  if (!isAdmin && !hasPayrollPerm) {
    window.location.href = "/src/frontend/pages/dashboard/";
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
