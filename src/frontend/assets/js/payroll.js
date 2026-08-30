/**
 * SPES Portal — Payroll Page Bootstrapper
 * ───────────────────────────────────────
 * Imports TailwindCSS, Flowbite, RBAC Guard, and launches the SPES Payroll Controller.
 */
import "../styles/tailwind.css";
import "./components/flow-debugger.js";
import "flowbite";
import { applyPermissions, highlightSidebarActiveLink, requirePayrollAccess, signOut, getSession } from "./rbac/guard.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initPayroll } from "./components/payroll.js";

// --- START: BOOT PAYROLL PAGE ---
async function bootPayrollPage() {
  const session = requirePayrollAccess();
  if (!session) return;

  initThemeToggle();
  initAutoYear();
  initFlowbite();

  // Populate user info in sidebar
  const user = getSession();
  if (user) {
    const nameEl    = document.getElementById("sidebar-user-name");
    const emailEl   = document.getElementById("sidebar-user-email");
    const roleBadge = document.getElementById("sidebar-role-badge");
    const avatarEl  = document.getElementById("sidebar-user-avatar");

    if (nameEl)    nameEl.textContent  = user.full_name || "Staff User";
    if (emailEl)   emailEl.textContent = user.email || "";
    if (roleBadge) roleBadge.textContent = user.role_label || user.role || "SPES Officer";
    if (avatarEl) {
      if (user.avatar_url) {
        avatarEl.innerHTML = `<img src="${user.avatar_url}" class="h-full w-full rounded-full object-cover" alt="User avatar" />`;
      } else {
        avatarEl.textContent = (user.full_name || user.email || "SA")
          .split(" ")
          .filter(Boolean)
          .map((n) => n[0])
          .join("")
          .slice(0, 2)
          .toUpperCase() || "SA";
      }
    }
  }

  // Active sidebar link styling (matching tree-branch design)
  highlightSidebarActiveLink("payroll");

  const signoutBtn = document.getElementById("sign-out-btn");
  if (signoutBtn) signoutBtn.addEventListener("click", signOut);

  await applyPermissions(user?.role);
  await initPayroll();
}
// --- END: BOOT PAYROLL PAGE ---

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootPayrollPage);
} else {
  bootPayrollPage();
}
