/**
 * SPES Portal — Payroll Page Bootstrapper
 * ───────────────────────────────────────
 * Imports TailwindCSS, Flowbite, RBAC Guard, and launches the SPES Payroll Controller.
 */
import "../styles/tailwind.css";
import "./components/flow-debugger.js";
import "flowbite";
import { initFlowbite } from "flowbite";
import { applyPermissions, requireAuth, signOut, getSession } from "./rbac/guard.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initPayroll } from "./components/payroll.js";

// --- START: BOOT PAYROLL PAGE ---
async function bootPayrollPage() {
  const session = requireAuth();
  if (!session) return;

  initThemeToggle();
  initAutoYear();
  initFlowbite();

  // Populate user info in sidebar
  const user = getSession();
  if (user) {
    const nameEl = document.getElementById("sidebar-user-name");
    const roleEl = document.getElementById("sidebar-user-role");
    const avatarEl = document.getElementById("sidebar-user-avatar");
    if (nameEl) nameEl.textContent = user.full_name || user.email || "Staff User";
    if (roleEl) roleEl.textContent = user.role_label || user.role || "SPES Officer";
    if (avatarEl && user.avatar_url) avatarEl.src = user.avatar_url;
  }

  // Active sidebar link styling (matching tree-branch design)
  document.querySelectorAll(".sidebar-link").forEach((link) => {
    const isTarget = link.getAttribute("data-nav-item") === "payroll";
    const isSubLink = link.classList.contains("sidebar-sub-link");
    const parentLi = link.closest("li");
    const dot = parentLi ? parentLi.querySelector(".tree-dot") : null;

    if (isTarget) {
      if (isSubLink) {
        link.classList.add("text-spes-blue", "font-black", "dark:text-spes-yellow");
        link.classList.remove("text-spes-black/70", "dark:text-spes-white/70", "bg-spes-blue/10", "dark:bg-spes-white/10");
        if (dot) {
          dot.classList.add("bg-spes-blue", "border-spes-blue", "dark:bg-spes-yellow", "dark:border-spes-yellow");
          dot.classList.remove("bg-spes-white", "border-spes-blue/30", "dark:bg-spes-dark-secondary", "dark:border-white/30");
        }
      } else {
        link.classList.add("bg-spes-blue/10", "text-spes-blue", "dark:bg-spes-white/10", "dark:text-spes-yellow");
        link.classList.remove("text-spes-black/80", "dark:text-spes-white/80");
      }

      // Expand parent dropdown if inside one
      const parentDropdown = link.closest("ul[id^='sidebar-dropdown-']");
      if (parentDropdown) {
        parentDropdown.classList.remove("hidden");
        const triggerBtn = document.querySelector(`[data-collapse-toggle='${parentDropdown.id}']`);
        if (triggerBtn) {
          triggerBtn.classList.add("bg-spes-blue/10", "text-spes-blue", "dark:bg-spes-white/10", "dark:text-spes-yellow");
          const arrow = triggerBtn.querySelector("svg:last-child");
          if (arrow) arrow.classList.add("rotate-180");
        }
      }
    }
  });

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
