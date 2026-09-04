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
import { initPresence, destroyPresence } from "../components/presence.js";

/**
 * Check if the session belongs to Admin or HR role.
 * Both roles enjoy full baseline capability across the portal.
 */
export function isHrOrAdmin(session) {
  if (!session) return false;
  const role = String(session.role || "").trim().toLowerCase();
  const roleId = Number(session.role_id);
  return role === "admin" || role === "hr" || roleId === 1 || roleId === 2;
}

// Map permission strings used in HTML → DB column names in session.permissions
const DB_PERM_MAP = {
  // Navigation groups on sidebar
  "beneficiaries:group": (_p, session) => session?.approved === true,
  "beneficiaries:view":  (_p, session) => session?.approved === true,
  "payroll:view":        (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_payroll)),
  "payroll:manage":      (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_payroll)),

  "users:group":         (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_users)),
  "users:view":          (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_users)),
  "users:create":        (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.create_users)),
  "users:manage":        (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.create_users || p?.edit_users)),
  "users:edit":          (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.edit_users)),
  "users:delete":        (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.delete_users)),

  "offices:view-other":   (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_other_offices)),
  "analytics:view-global":(p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_global_stats)),

  // Roles & Permissions: STRICTLY ADMIN ONLY (No Officer, No HR)
  "roles:manage":        (_p, session) => session?.approved === true && (String(session?.role || "").toLowerCase() === "admin" || Number(session?.role_id) === 1),

  // Approved users may export their own office.
  "reports:export":      (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.export_reports)),
  "reports:view":        (p, session) => session?.approved === true && (isHrOrAdmin(session) || Boolean(p?.view_users || p?.export_reports)),

  // Auto Import Tool: STRICTLY ADMIN ONLY (No Officer, No HR)
  "services:manage":     (_p, session) => session?.approved === true && (String(session?.role || "").toLowerCase() === "admin" || Number(session?.role_id) === 1),
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
 * Admins and HR always win via static RBAC (all true).
 * Officers/students use DB permissions first, then static RBAC.
 */
async function _hasPermission(userRole, permission, session) {
  const isAdmin = String(session?.role || userRole || "").toLowerCase() === "admin" || Number(session?.role_id) === 1;

  // Strict Admin-only permissions (Auto Import Tool & Roles & Permissions)
  if (permission === "roles:manage" || permission === "services:manage") {
    return isAdmin && session?.approved === true;
  }

  // Any unapproved user (approved !== true) is strictly blocked from all protected navigation and resources
  const isApproved = session?.approved === true || session?.approved === "true" || session?.approved === 1;
  if (!isApproved) {
    return false;
  }

  // Admin and HR who are approved enjoy full baseline capability across the portal
  if (isHrOrAdmin(session) || userRole === "admin" || userRole === "hr") return true;

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

  // Dynamically update DOLE Portal links based on authenticated role
  const portalTargetUrl = (userRole === "admin" || session?.role === "admin" || Number(session?.role_id) === 1)
    ? "https://dole-portal.vercel.app/src/pages/user/admin/dashboard/"
    : "https://dole-portal.vercel.app/src/pages/user/staff/dashboard/";

  document.querySelectorAll("#sidebar-portal-link, [data-nav-item='portal'], a[href*='dole-portal.vercel.app']").forEach(link => {
    link.setAttribute("href", portalTargetUrl);
  });
}

/**
 * Highlight and style the active sidebar navigation item, active tree dot,
 * and expand parent dropdowns if inside a nested branch.
 *
 * @param {string} [navId] - e.g. "overview", "beneficiaries", "payroll", "implementor-list", "roles", "exports", "settings", "about-developer", "auto-import"
 */
export function highlightSidebarActiveLink(navId) {
  const session = getSession();
  const portalTargetUrl = (session?.role === "admin" || Number(session?.role_id) === 1)
    ? "https://dole-portal.vercel.app/src/pages/user/admin/dashboard/"
    : "https://dole-portal.vercel.app/src/pages/user/staff/dashboard/";

  document.querySelectorAll("#sidebar-portal-link, [data-nav-item='portal'], a[href*='dole-portal.vercel.app']").forEach(link => {
    link.setAttribute("href", portalTargetUrl);
  });

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
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (session && session.role) {
      const role = String(session.role).trim().toLowerCase();
      // Enforce correct role_id mapping (Admin: 1, HR: 2, Officer: 3)
      if (role === "admin" && session.role_id !== 1) {
        session.role_id = 1;
        try { localStorage.setItem("spes_session", JSON.stringify(session)); } catch {}
      } else if (role === "hr" && session.role_id !== 2) {
        session.role_id = 2;
        try { localStorage.setItem("spes_session", JSON.stringify(session)); } catch {}
      } else if (role === "officer" && session.role_id !== 3) {
        session.role_id = 3;
        try { localStorage.setItem("spes_session", JSON.stringify(session)); } catch {}
      }
    }
    return session;
  } catch {
    return null;
  }
}

let _permChannel = null;
let _isInitializingPerms = false;

/**
 * Subscribe to realtime permission updates for the current staff session.
 */
export function initStaffPermissionsRealtime(staffId) {
  if (!staffId || _permChannel || _isInitializingPerms) return;
  _isInitializingPerms = true;

  import("../../../../backend/api/supabase.js").then(({ supabase }) => {
    try {
      // Clean up any existing channel with same name to prevent "cannot add callbacks after subscribe"
      const existing = supabase.getChannels().find(ch => ch.topic === "realtime:spes-permissions-sync");
      if (existing) {
        supabase.removeChannel(existing);
      }

      _permChannel = supabase
        .channel("spes-permissions-sync")
        .on(
          "broadcast",
          { event: "permissions_updated" },
          async ({ payload }) => {
            const currentStaffId = Number(staffId);
            const affectedIds = (payload?.staffIds || []).map(Number);
            if (affectedIds.includes(currentStaffId) || (payload?.data && payload.data[currentStaffId])) {
              const fresh = (payload.data && payload.data[currentStaffId]) || payload.updates;
              const session = getSession();
              if (session) {
                session.permissions = {
                  ...(session.permissions || {}),
                  ...fresh,
                };
                try {
                  localStorage.setItem("spes_session", JSON.stringify(session));
                  sessionStorage.setItem("spes_session", JSON.stringify(session));
                } catch {}
                await applyPermissions(session.role);
                if (window.location.pathname.includes("/dashboard/")) {
                  try {
                    const { initDashboardCharts } = await import("../components/charts.js");
                    await initDashboardCharts();
                  } catch {}
                }
              }
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "staff_permissions",
            filter: `staff_id=eq.${staffId}`,
          },
          async (payload) => {
            if (payload.new) {
              const session = getSession();
              if (session) {
                session.permissions = {
                  view_users: Boolean(payload.new.view_users),
                  create_users: Boolean(payload.new.create_users),
                  edit_users: Boolean(payload.new.edit_users),
                  delete_users: Boolean(payload.new.delete_users),
                  export_reports: Boolean(payload.new.export_reports),
                  view_other_offices: Boolean(payload.new.view_other_offices),
                  view_global_stats: Boolean(payload.new.view_global_stats),
                  view_payroll: Boolean(payload.new.view_payroll),
                };
                try {
                  localStorage.setItem("spes_session", JSON.stringify(session));
                  sessionStorage.setItem("spes_session", JSON.stringify(session));
                } catch {}
                await applyPermissions(session.role);
                if (window.location.pathname.includes("/dashboard/")) {
                  try {
                    const { initDashboardCharts } = await import("../components/charts.js");
                    await initDashboardCharts();
                  } catch {}
                }
              }
            }
          }
        )
        .subscribe();
    } catch (err) {
      if (import.meta.env.DEV) console.warn("[SPES Realtime] Perm channel init error:", err);
      _permChannel = null;
    } finally {
      _isInitializingPerms = false;
    }
  }).catch(() => {
    _isInitializingPerms = false;
  });
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
  // Auto-establish Presence channel on every protected page load (idempotent)
  if (session.id) {
    initPresence(session.id);
    initStaffPermissionsRealtime(session.id);
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
  const roleId = Number(session.role_id);
  const isApproved = session.approved === true || session.approved === "true" || session.approved === 1;
  const isAdmin = (role === "admin" || roleId === 1) && isApproved;
  if (!isAdmin) {
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
  const isExecutive = isHrOrAdmin(session);
  const isApproved = session.approved === true;

  if (!isExecutive && !isApproved) {
    window.location.href = "/src/frontend/pages/dashboard/";
    return null;
  }
  return session;
}

/**
 * Require payroll access permission (Admin, HR, or approved staff with view_payroll permission).
 * Redirects unauthorized users to the dashboard.
 */
export function requirePayrollAccess() {
  const session = requireAuth();
  if (!session) return null;
  const isExecutive = isHrOrAdmin(session);
  const isApproved = session.approved === true;
  const hasPayrollPerm = isApproved && Boolean(session.permissions?.view_payroll);

  if (!isExecutive && !hasPayrollPerm) {
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
      // Tear down Presence channel before clearing session
      destroyPresence();

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
