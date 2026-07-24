/**
 * SPES Portal — Settings Page Entry
 * ───────────────────────────────────
 * Boots the Account Settings page: auth guard, sidebar, theme toggle,
 * clock, then hands control to the settings component.
 * Available to every authenticated role (no permission gate).
 */
import "../styles/tailwind.css";
import "./components/flow-debugger.js";
import "flowbite";
import { initFlowbite } from "flowbite";
import { applyPermissions, requireAuth, signOut, getSession } from "./rbac/guard.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initExportButtonTilt } from "./components/animations.js";
import { initSettings, initAppearancePrefs } from "./components/settings.js";

const session = requireAuth();
if (session) {
  const sidebarContainer = document.getElementById("sidebar-container");
  if (sidebarContainer) {
    loadComponent("sidebar-container", "../../components/sidebar.html").then(boot);
  } else {
    boot();
  }
}

async function loadComponent(id, url) {
  const container = document.getElementById(id);
  if (!container) return;
  try {
    const res = await fetch(url);
    if (res.ok) container.innerHTML = await res.text();
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Settings] sidebar load:", err?.message);
  }
}

async function boot() {
  const user = getSession();
  if (!user) return;

  // Session healer (mirrors other entries)
  if (!user.role_id && user.role) {
    if (user.role === "admin")   user.role_id = 1;
    if (user.role === "officer") user.role_id = 2;
  }

  _populateSidebar(user);
  initThemeToggle();
  initAutoYear();
  initFlowbite();
  _initClock();
  _setActiveSidebarLink("settings");
  initAppearancePrefs();   // text-size slider + theme button label sync
  initExportButtonTilt();  // skew-tilt hover on [data-tilt-btn]

  // Settings is open to every role — still run applyPermissions so the
  // rest of the sidebar's data-permission items resolve correctly.
  await applyPermissions(user.role);

  const nameEl = document.getElementById("header-user-name");
  if (nameEl) nameEl.textContent = user.full_name || "User";
  document.getElementById("sign-out-btn")?.addEventListener("click", signOut);

  const v = import.meta.env.VITE_APP_VERSION;
  if (v) { const verEl = document.getElementById("preview-version"); if (verEl) verEl.textContent = v; }

  _initSidebarDropdown();
  await initSettings();
}

// ── Sidebar / chrome helpers (shared shape with dashboard.js) ──
function _populateSidebar(user) {
  const nameEl    = document.getElementById("sidebar-user-name");
  const emailEl   = document.getElementById("sidebar-user-email");
  const avatarEl  = document.getElementById("sidebar-user-avatar");
  const roleBadge = document.getElementById("sidebar-role-badge");
  if (nameEl)    nameEl.textContent  = user.full_name || "User";
  if (emailEl)   emailEl.textContent = user.email || "";
  if (avatarEl)  avatarEl.textContent = (user.full_name || "U").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (roleBadge) roleBadge.textContent = user.role_label || user.role;
}

function _setActiveSidebarLink(navId) {
  document.querySelectorAll(".sidebar-link").forEach(link => {
    if (link.getAttribute("data-nav-item") === navId) {
      link.classList.add("bg-spes-blue/10", "dark:bg-spes-yellow/15", "text-spes-blue", "dark:text-spes-yellow");
    }
  });
}

function _initSidebarDropdown() {
  const btn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  const ul  = document.getElementById("sidebar-dropdown-users");
  if (!btn || !ul) return;
  const isOpen = document.cookie.includes("spes_user_management_open=true");
  if (isOpen) {
    ul.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
    btn.querySelector("svg:last-child")?.classList.add("rotate-180");
  }
  btn.addEventListener("click", () => {
    setTimeout(() => {
      document.cookie = `spes_user_management_open=${!ul.classList.contains("hidden")}; path=/; max-age=31536000`;
    }, 50);
  });
}

function _initClock() {
  const el = document.getElementById("real-time-clock");
  if (!el) return;
  const tick = () => {
    const n = new Date();
    el.textContent = `${n.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} | ${n.toLocaleTimeString("en-US", { hour12: true })}`;
  };
  setInterval(tick, 1000);
  tick();
}
