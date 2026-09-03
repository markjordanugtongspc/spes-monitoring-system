/**
 * SPES Portal — About Page Entry
 * Boots the About Contributors page: auth guard, sidebar, theme toggle,
 * clock, RBAC permissions, and binds touch/tap toggle on mobile cards.
 * Available to every authenticated role without permission gate.
 */
import "../styles/tailwind.css";
import "./components/flow-debugger.js";
import "./components/analytics.js";
import "flowbite";
import { applyPermissions, highlightSidebarActiveLink, requireAuth, signOut, getSession } from "./rbac/guard.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { applyTextSize } from "./components/settings.js";
import aboutTemplate from "../../components/about.html?raw";

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
    if (import.meta.env.DEV) console.error("[SPES About] sidebar load:", err?.message);
  }
}

async function boot() {
  const user = getSession();
  if (!user) return;

  // Session healer
  if (!user.role_id && user.role) {
    if (user.role === "admin") user.role_id = 1;
    if (user.role === "officer") user.role_id = 2;
  }

  _populateSidebar(user);
  initThemeToggle();
  initAutoYear();
  initFlowbite();
  _initClock();
  _setActiveSidebarLink("about-developer");

  // Apply saved global text size scale
  const savedTextSize = parseInt(localStorage.getItem("spes-text-size") ?? "0", 10) || 0;
  applyTextSize(savedTextSize);

  // Apply RBAC permissions across the sidebar (user management, beneficiaries, reports)
  await applyPermissions(user.role);

  document.getElementById("sign-out-btn")?.addEventListener("click", signOut);
  _initSidebarDropdown();

  // Inject the clean gallery & hero
  initAboutContent();
}

function initAboutContent() {
  const slot = document.getElementById("about-component-slot");
  if (!slot) return;
  slot.innerHTML = aboutTemplate;

  // Bind mobile card photo focus toggle
  const cards = slot.querySelectorAll('[data-about-card="true"]');
  cards.forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("a") || e.target.closest("button")) return;
      const isFocused = card.classList.contains("is-photo-focused");
      if (isFocused) {
        card.classList.remove("is-photo-focused");
      } else {
        cards.forEach((c) => c.classList.remove("is-photo-focused"));
        card.classList.add("is-photo-focused");
      }
    });
  });
}

function _populateSidebar(user) {
  const nameEl = document.getElementById("sidebar-user-name");
  const emailEl = document.getElementById("sidebar-user-email");
  const avatarEl = document.getElementById("sidebar-user-avatar");
  const roleBadge = document.getElementById("sidebar-role-badge");
  if (nameEl) nameEl.textContent = user.full_name || "User";
  if (emailEl) emailEl.textContent = user.email || "";
  if (avatarEl) avatarEl.textContent = (user.full_name || "U").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (roleBadge) roleBadge.textContent = user.role_label || user.role;
}

function _setActiveSidebarLink(navId) {
  highlightSidebarActiveLink(navId);
}

// --- START: SIDEBAR DROPDOWN INITIALIZER ---
function _initSidebarDropdown() {
  const beneBtn = document.querySelector('[aria-controls="sidebar-dropdown-beneficiaries"]');
  const beneUl  = document.getElementById("sidebar-dropdown-beneficiaries");
  if (beneBtn && beneUl) {
    const isBeneOpen = !document.cookie.includes("spes_beneficiaries_open=false");
    if (isBeneOpen) {
      beneUl.classList.remove("hidden");
      beneBtn.setAttribute("aria-expanded", "true");
      beneBtn.querySelector("svg:last-child")?.classList.add("rotate-180");
    } else {
      beneUl.classList.add("hidden");
      beneBtn.setAttribute("aria-expanded", "false");
      beneBtn.querySelector("svg:last-child")?.classList.remove("rotate-180");
    }
    beneBtn.addEventListener("click", () => {
      setTimeout(() => {
        document.cookie = `spes_beneficiaries_open=${!beneUl.classList.contains("hidden")}; path=/; max-age=31536000`;
      }, 50);
    });
  }

  const userBtn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  const userUl  = document.getElementById("sidebar-dropdown-users");
  if (userBtn && userUl) {
    const isUserOpen = document.cookie.includes("spes_user_management_open=true");
    if (isUserOpen) {
      userUl.classList.remove("hidden");
      userBtn.setAttribute("aria-expanded", "true");
      userBtn.querySelector("svg:last-child")?.classList.add("rotate-180");
    } else {
      userUl.classList.add("hidden");
      userBtn.setAttribute("aria-expanded", "false");
      userBtn.querySelector("svg:last-child")?.classList.remove("rotate-180");
    }
    userBtn.addEventListener("click", () => {
      setTimeout(() => {
        document.cookie = `spes_user_management_open=${!userUl.classList.contains("hidden")}; path=/; max-age=31536000`;
      }, 50);
    });
  }
}
// --- END: SIDEBAR DROPDOWN INITIALIZER ---

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

