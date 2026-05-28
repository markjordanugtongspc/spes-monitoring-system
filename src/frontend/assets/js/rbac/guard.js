/**
 * SPES Portal — RBAC DOM Guard
 * ─────────────────────────────
 * Scans the page for elements with `data-permission` attributes
 * and removes / disables them based on the current user's role.
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

/**
 * Apply RBAC permissions to the DOM.
 * Call once after page load with the authenticated user's role.
 *
 * @param {string} userRole – "admin" | "officer" | "student"
 */
export async function applyPermissions(userRole) {
  const els = document.querySelectorAll("[data-permission]");

  for (const el of els) {
    const permission = el.getAttribute("data-permission");
    const mode = el.getAttribute("data-permission-mode") || "remove";
    const allowed = await canDo(userRole, permission);

    if (allowed) {
      // Make sure element is visible
      el.classList.remove("hidden");
      continue;
    }

    // Not allowed — apply restriction
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
 * @returns {{ id: string, role: string, full_name: string, email: string } | null}
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
 * Sign out — clear session and redirect to login.
 */
export function signOut() {
  modals.confirm(
    "Sign Out",
    "Are you sure you want to log out of the SPES Portal?",
    "Yes, Sign Out",
    "Cancel"
  ).then((result) => {
    if (result.isConfirmed) {
      localStorage.removeItem("spes_session");
      localStorage.removeItem("spes_supabase_token");
      window.location.href = "/src/frontend/login/";
    }
  });
}
