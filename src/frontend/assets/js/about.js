/**
 * SPES Portal — About Page Entry
 * Boots the About Contributors page: auth guard, sidebar, theme toggle,
 * clock, RBAC permissions, and binds touch/tap toggle on mobile cards.
 * Available to every authenticated role without permission gate.
 */
import "../styles/tailwind.css";
import "./components/flow-debugger.js";
import "flowbite";
import { initFlowbite } from "flowbite";
import { applyPermissions, requireAuth, signOut, getSession } from "./rbac/guard.js";
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
  document.querySelectorAll(".sidebar-link").forEach(link => {
    if (link.getAttribute("data-nav-item") === navId) {
      link.classList.add("bg-spes-blue/10", "dark:bg-spes-yellow/15", "text-spes-blue", "dark:text-spes-yellow");
    }
  });
}

function _initSidebarDropdown() {
  const btn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  const ul = document.getElementById("sidebar-dropdown-users");
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

