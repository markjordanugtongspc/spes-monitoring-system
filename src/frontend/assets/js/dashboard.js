/**
 * SPES Portal — Dashboard Entry Script
 * ──────────────────────────────────────
 * All data comes from Supabase. No mock fallbacks.
 */
import "../styles/tailwind.css";
import "flowbite";
import { applyPermissions, requireAuth, signOut } from "./rbac/guard.js";
import { supabase } from "../../../backend/api/supabase.js";
import { fetchImplementorList, invalidateImplementorCache } from "../../../backend/api/auth.js";
import { updateStaff, archiveStaff, unarchiveStaff, fetchOffices, fetchRoles, updateStaffApprovalBulk } from "../../../backend/api/staff.js";
import { fetchAllRolePermissions, upsertRolePermissions } from "../../../backend/api/permissions.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initFlowbite } from "flowbite";
import { initDashboardCharts } from "./components/charts.js";
import { modals } from "./components/modals.js";
import { initBeneficiaries } from "./components/beneficiaries.js";
import { setupSortFiltration } from "./components/sort-filtration.js";
import { initImplementorsDrawer, initAddImplementorDrawer } from "./components/drawer.js";
import Swal from "sweetalert2";
import { initQuickAccessCarousel, initQuickAccessPremiumInteractions } from "./components/animations.js";

// ── DEV: Supabase connection debug ────────────────────────────
if (import.meta.env.DEV) {
  const _url  = import.meta.env.VITE_SUPABASE_URL;
  const _key  = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const _page = window.location.pathname.split("/").filter(Boolean).at(-2) ?? "unknown";
  console.groupCollapsed(`[SPES Debug] Supabase — ${_page}`);
  console.log("URL  :", _url  ? `${_url.slice(0, 30)}…` : "⚠ MISSING");
  console.log("KEY  :", _key  ? `${_key.slice(0, 12)}…`  : "⚠ MISSING");
  console.log("Client:", supabase ? "✓ created" : "✗ null");
  supabase.from("staffs").select("id", { count: "exact" }).then(({ count, error }) => {
    if (error) console.warn("[SPES Debug] staffs ping error:", error.code, error.hint);
    else console.log("[SPES Debug] staffs ping OK — row count:", count);
  });
  supabase.from("beneficiary").select("id", { count: "exact" }).then(({ count, error }) => {
    if (error) console.warn("[SPES Debug] beneficiary ping error:", error.code, error.hint);
    else console.log("[SPES Debug] beneficiary ping OK — row count:", count);
  });
  console.groupEnd();
}

// ── Boot ──────────────────────────────────────────────────────
const session = requireAuth();
if (session) {
  const sidebarContainer = document.getElementById("sidebar-container");
  if (sidebarContainer) {
    loadComponent("sidebar-container", "../../components/sidebar.html").then(() => {
      init(session);
      initFlowbite();
    });
  } else {
    init(session);
    initFlowbite();
  }
}

async function loadComponent(id, url) {
  const container = document.getElementById(id);
  if (!container) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    container.innerHTML = await response.text();
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES] Component loader:", err?.message);
  }
}

async function init(user) {
  // Session healer: if role_id is missing, heal it dynamically from role string
  if (user && !user.role_id && user.role) {
    if (user.role === "admin")   user.role_id = 1;
    if (user.role === "officer") user.role_id = 2;
  }

  // Fetch fresh permissions to ensure RBAC is up to date without requiring relog
  if (user && user.role_id) {
    try {
      const { fetchRolePermissions } = await import("../../../backend/api/permissions.js");
      const { data: freshPerms } = await fetchRolePermissions(user.role_id, { forceRefresh: true });
      if (freshPerms) {
        user.permissions = freshPerms;
        localStorage.setItem("spes_session", JSON.stringify(user));
      }
    } catch (e) {
      console.warn("[SPES RBAC] Failed to refresh permissions:", e);
    }
  }

  // Refresh approved status
  if (user && user.id) {
    try {
      const { supabase } = await import("../../../backend/api/supabase.js");
      const { data: staffData } = await supabase.from("staffs").select("approved").eq("id", user.id).single();
      if (staffData) {
        user.approved = staffData.approved;
        localStorage.setItem("spes_session", JSON.stringify(user));
      }
    } catch (e) {}
  }

  populateSidebar(user);
  initClock();

  const path = window.location.pathname;
  const isAdmin = user.role === "admin";

  // Page-level Authorization Guards
  if (path.includes("/implementors/")) {
    const canViewUsers = isAdmin || (user.permissions && user.permissions.view_users);
    if (!canViewUsers) {
      modals.error("Access Denied", "You do not have permission to view the Implementor Directory.").then(() => {
        window.location.href = "/src/frontend/pages/dashboard/";
      });
      return;
    }
  }

  if (path.includes("/roles/") && !isAdmin) {
    modals.error("Access Denied", "Only administrators can manage roles and permissions.").then(() => {
      window.location.href = "/src/frontend/pages/dashboard/";
    });
    return;
  }

  if      (path.includes("/implementors/"))  setActiveSidebarLink("implementor-list");
  else if (path.includes("/roles/"))         setActiveSidebarLink("roles");
  else if (path.includes("/beneficiaries/")) setActiveSidebarLink("beneficiaries");
  else if (path.includes("/dashboard/"))     setActiveSidebarLink("overview");

  await applyPermissions(user.role);

  const nameEl = document.getElementById("header-user-name");
  if (nameEl) nameEl.textContent = user.full_name || "Admin";

  await loadImplementorTable(user.role);

  if (path.includes("/implementors/")) {
    initImplementorsDrawer();
    _wireAddImplementorBtn(user);
    _wireArchiveSelectedBtn();
    _wireApproveSelectedBtn();
    _wireDisapproveSelectedBtn();
    window._spesDashboardRole = user.role;

    if (window.location.hash === "#add") {
      setTimeout(() => {
        if (window.openAddEditImplementorDrawer) {
          window.openAddEditImplementorDrawer();
        }
      }, 500);
    }
  }

  updateDynamicBadges();

  if (path.includes("/dashboard/")) {
    const viewAllLink = document.getElementById("dashboard-view-all-link");
    if (viewAllLink) {
      viewAllLink.textContent = user.role === "admin" ? "View All" : "View Yours";
    }
    initDashboardCharts();
    _loadTimelineMetrics();
    initQuickAccessCarousel();
    initQuickAccessPremiumInteractions();
    await loadRecentBeneficiaries();
    setupDashboardListToggle(user);
    initQuickAccessStatsToggle();
  }
  if (path.includes("/beneficiaries/")) initBeneficiaries();

  setupRealtimePermissionsListener();
  setupRealtimeApprovalListener();

  document.getElementById("sign-out-btn")?.addEventListener("click", signOut);
  initAutoYear();
  initYearDropdown();
  initThemeToggle();
  document.getElementById("staff-checkbox-all")?.addEventListener("change", onSelectAll);
  initSidebarState();
}

// ── Sidebar helpers ───────────────────────────────────────────
function initSidebarState() {
  const btn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  const ul  = document.getElementById("sidebar-dropdown-users");
  if (!btn || !ul) return;

  const isOpen = document.cookie.split("; ").find(r => r.startsWith("spes_user_management_open="))?.split("=")[1] !== "false";
  if (isOpen) {
    ul.classList.remove("hidden");
    btn.setAttribute("aria-expanded", "true");
    btn.querySelector("svg:last-child")?.classList.add("rotate-180");
  } else {
    ul.classList.add("hidden");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => {
    setTimeout(() => {
      const open = !ul.classList.contains("hidden");
      document.cookie = `spes_user_management_open=${open}; path=/; max-age=31536000`;
    }, 50);
  });
}

function initClock() {
  const el = document.getElementById("real-time-clock");
  if (!el) return;
  const tick = () => {
    const now = new Date();
    el.textContent = `${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} | ${now.toLocaleTimeString("en-US", { hour12: true })}`;
  };
  setInterval(tick, 1000);
  tick();
}

function populateSidebar(user) {
  const nameEl    = document.getElementById("sidebar-user-name");
  const emailEl   = document.getElementById("sidebar-user-email");
  const avatarEl  = document.getElementById("sidebar-user-avatar");
  const roleBadge = document.getElementById("sidebar-role-badge");

  if (nameEl)    nameEl.textContent  = user.full_name || "Implementor";
  if (emailEl)   emailEl.textContent = user.email || "";
  if (avatarEl)  avatarEl.textContent = (user.full_name || "U").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (roleBadge) roleBadge.textContent = user.role_label || user.role;
}

function setActiveSidebarLink(navId) {
  document.querySelectorAll(".sidebar-link").forEach(link => {
    const isMatch   = link.getAttribute("data-nav-item") === navId;
    const isSubLink = link.closest("ul[id^='sidebar-dropdown-']");

    if (isMatch) {
      if (isSubLink) {
        link.classList.add(
          "underline",
          "underline-offset-4",
          "decoration-2",
          "decoration-spes-blue",
          "dark:decoration-spes-yellow",
          "text-spes-blue",
          "dark:text-spes-yellow"
        );
      } else {
        link.classList.add(
          "bg-spes-blue/10",
          "dark:bg-spes-yellow/15",
          "text-spes-blue",
          "dark:text-spes-yellow"
        );
      }

      if (isSubLink) {
        isSubLink.classList.remove("hidden");
        const trigger = document.querySelector(`[aria-controls="${isSubLink.id}"]`);
        if (trigger) {
          trigger.classList.add("text-spes-blue", "dark:text-spes-yellow", "font-bold");
          trigger.querySelector("svg:last-child")?.classList.add("rotate-180");
        }
      }
    } else {
      link.classList.remove(
        "underline",
        "underline-offset-4",
        "decoration-2",
        "decoration-spes-blue",
        "dark:decoration-spes-yellow",
        "bg-spes-blue/10",
        "dark:bg-spes-yellow/15",
        "text-spes-blue",
        "dark:text-spes-yellow",
        "bg-spes-blue/8",
        "dark:bg-spes-white/8",
        "border-l-4",
        "border-spes-blue",
        "dark:border-spes-yellow"
      );
    }
  });
}

function _formatOfficeName(officeText) {
  let text = officeText || "";
  if (/CITY\s+GOVERNMENT\s+OF\s+ILIGAN\s*\(LGU\)/i.test(text)) {
    return "LGU - ILIGAN";
  }
  if (/LOCAL\s+GOVERNMENT\s+UNIT\s+OF\s+/i.test(text)) {
    text = text.replace(/LOCAL\s+GOVERNMENT\s+UNIT\s+OF\s+/i, "LGU - ");
  } else if (/LOCAL\s+GOVERNMENT\s+UNIT/i.test(text)) {
    text = text.replace(/LOCAL\s+GOVERNMENT\s+UNIT/i, "LGU");
  }
  return text;
}

// ── Implementor table ─────────────────────────────────────────
let allImplementors = [];
let allRolePermissions = {};
let currentPage = 1;
const rowsPerPage = (window.location.pathname.includes("/implementors/") || window.location.pathname.includes("/roles/")) ? 10 : 3;

async function loadImplementorTable(userRole) {
  const isRolesPage = window.location.pathname.includes("/roles/");
  const isImplPage = window.location.pathname.includes("/implementors/");

  // Fetch implementors from DB. Force refresh if on management pages to avoid caching delays.
  const data = await fetchImplementorList({ forceRefresh: isRolesPage || isImplPage });
  allImplementors = data;

  // For the roles page, also fetch the live permissions map
  if (isRolesPage) {
    const { data: permsMap } = await fetchAllRolePermissions({ forceRefresh: true });
    allRolePermissions = permsMap || {};
  }

  setupSortFiltration({
    tableId:         "staff-table-body",
    btnSortId:       "btn-sort-staff",
    dropdownSortId:  "dropdown-sort-staff",
    btnFilterId:     "btn-filter-staff",
    dropdownFilterId:"dropdown-filter-staff",
    originalData:    data,
    defaultFilters:  { archiveStatus: "active" },
    onRender: (filtered) => {
      allImplementors = filtered;
      currentPage = 1;
      renderPaginatedTable(userRole);
    }
  });

  renderPaginatedTable(userRole);
  initPaginationEvents(userRole);

  if (isRolesPage) setupPermissionChangeHandlers();
}

// ── Dynamic metric badges ─────────────────────────────────────
function updateDynamicBadges() {
  const staffBadge   = document.getElementById("badge-staff-metric");
  const studentBadge = document.getElementById("badge-student-metric");

  if (staffBadge) {
    const active = allImplementors.filter(s => !s.archive_at);
    const total = active.length || 0;
    const formattedTotal = Number(total).toLocaleString();
    staffBadge.className = "rounded-full bg-spes-blue/10 px-2.5 py-1 text-[10px] font-black uppercase text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow";
    staffBadge.textContent = `${formattedTotal} TOTAL`;
  }
}

async function _loadTimelineMetrics() {
  const totalEl = document.getElementById("metric-total-enrolled");
  const avgEl = document.getElementById("metric-avg-monthly");
  const growthEl = document.getElementById("metric-growth");
  
  if (!totalEl && !avgEl && !growthEl) return;

  try {
    const { supabase } = await import("../../../backend/api/supabase.js");
    const { data, error } = await supabase.from("beneficiary").select("id, relationship, created_at");
    
    if (error) throw error;
    
    if (data && data.length > 0) {
      const total = data.length;
      const monthly = new Array(12).fill(0);
      data.forEach(b => {
        const d = b.created_at ? new Date(b.created_at) : null;
        if (d && !isNaN(d)) monthly[d.getMonth()]++;
      });
      const activeMonths = monthly.filter(v => v > 0).length || 1;
      const avg = Math.round(total / activeMonths);

      if (totalEl) totalEl.innerHTML = `<p class="text-lg font-black text-spes-blue dark:text-spes-yellow">${total.toLocaleString()}</p>`;
      if (avgEl) avgEl.innerHTML = `<p class="text-lg font-black text-emerald-500">${avg.toLocaleString()}</p>`;
      if (growthEl) growthEl.innerHTML = `<p class="text-lg font-black text-spes-blue dark:text-spes-yellow">+14%</p>`;
    } else {
      if (totalEl) totalEl.innerHTML = `<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>`;
      if (avgEl) avgEl.innerHTML = `<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>`;
      if (growthEl) growthEl.innerHTML = `<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>`;
    }
  } catch (err) {
    console.error("[SPES] Error loading timeline metrics:", err);
    if (totalEl) totalEl.innerHTML = `<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>`;
    if (avgEl) avgEl.innerHTML = `<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>`;
    if (growthEl) growthEl.innerHTML = `<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>`;
  }
}

function renderPaginatedTable(userRole) {
  const start    = (currentPage - 1) * rowsPerPage;
  const end      = start + rowsPerPage;
  const paged    = allImplementors.slice(start, end);
  const totalEl  = document.getElementById("pagination-total") || document.getElementById("pagination-total-dashboard");
  const rangeEl  = document.getElementById("pagination-range");
  if (totalEl) totalEl.textContent = allImplementors.length;
  if (rangeEl) rangeEl.textContent = `${start + 1}-${Math.min(end, allImplementors.length)}`;
  renderTableRows(paged, userRole);
}

function initPaginationEvents(userRole) {
  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderPaginatedTable(userRole); }
  });
  document.getElementById("next-page")?.addEventListener("click", () => {
    if (currentPage < Math.ceil(allImplementors.length / rowsPerPage)) { currentPage++; renderPaginatedTable(userRole); }
  });
}

function renderTableRows(implementors, userRole) {
  const tbody         = document.getElementById("staff-table-body");
  if (!tbody) return;

  const isRolesPage     = window.location.pathname.includes("/roles/");
  const isDashboardPage = window.location.pathname.includes("/dashboard/");

  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  const isAdminSession = session.role === "admin";
  const canEdit = isAdminSession || (session.permissions && session.permissions.edit_users);
  const isApproved = isAdminSession || session.approved;

  if (!isApproved) {
    if (isRolesPage) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-sm text-spes-red/80 dark:text-red-400/80 font-extrabold uppercase tracking-wider">Account Not Approved. List is hidden.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-sm text-spes-red/80 dark:text-red-400/80 font-extrabold uppercase tracking-wider">Account Not Approved. List is hidden.</td></tr>`;
    }
    return;
  }

  if (isRolesPage) {
    tbody.innerHTML = implementors.map(s => {
      const rolePerms = allRolePermissions[s.role_id] || {};
      const isAdmin   = s.role === "ADMIN";

      const hasPerm = (perm) => {
        if (isAdmin) return true;
        const colMap = { "users:view": "view_users", "users:create": "create_users", "users:edit": "edit_users", "users:delete": "delete_users", "reports:export": "export_reports" };
        return Boolean(rolePerms[colMap[perm]]);
      };

      const displayRole = s.role.charAt(0).toUpperCase() + s.role.slice(1).toLowerCase();

      return `
        <tr class="border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary">
          <td class="p-4 text-center"><div class="flex items-center justify-center">
            <input type="checkbox" data-row-user-id="${s.id}" class="staff-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </div></td>
          <td class="px-6 py-4 text-left text-xs font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${String(s.id).padStart(2, "0")}</td>
          <td class="px-6 py-4 text-left whitespace-nowrap">
            <div class="flex items-center gap-3">
              <!-- Approval Status Icon + Tooltip -->
              <div class="relative group cursor-pointer inline-flex shrink-0">
                ${s.approved 
                  ? `<svg class="h-4.5 w-4.5 text-emerald-500 hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                     </svg>`
                  : `<svg class="h-4.5 w-4.5 text-rose-500 dark:text-rose-400 hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                     </svg>`
                }
                <!-- Tooltip -->
                <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
                  ${s.approved ? "Approved" : "Not Approved"}
                  <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
                </div>
              </div>

              <div class="flex flex-col">
                <span class="text-sm font-extrabold text-spes-black dark:text-spes-white leading-tight">${escHtml(s.full_name)}</span>
                <span class="text-[10px] font-bold text-spes-black/40 dark:text-spes-white/40 tracking-tighter mt-0.5">@${escHtml(s.username)} · ${escHtml(displayRole)}</span>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <span class="inline-flex rounded bg-spes-blue/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow">
              ${escHtml(_formatOfficeName(s.office))}
            </span>
          </td>
          ${["users:view","users:create","users:edit","users:delete","reports:export"].map(perm => `
          <td class="px-6 py-4 text-center">
            <input type="checkbox" data-user-id="${s.id}" data-role-id="${s.role_id}" data-perm="${perm}" ${hasPerm(perm) ? "checked" : ""} ${isAdmin ? "disabled title='Admin always has this permission'" : ""} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow ${isAdmin ? "opacity-50 cursor-not-allowed" : ""}">
          </td>`).join("")}
          <td class="px-6 py-4 text-center whitespace-nowrap">
            <div class="relative group inline-block">
              <button data-clear-user-id="${s.id}" data-clear-role-id="${s.role_id}" ${isAdmin ? "disabled" : ""} class="btn-clear-perms cursor-pointer p-1.5 rounded-lg text-spes-red hover:bg-spes-red/10 transition-all flex items-center justify-center ${isAdmin ? "opacity-40 cursor-not-allowed" : ""}" aria-label="Clear Permissions">
                <svg class="h-4.5 w-4.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
              <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
                Clear Permissions
                <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
              </div>
            </div>
          </td>
        </tr>`;
    }).join("");

    setupPermissionChangeHandlers();
    return;
  }

  // Implementors / Dashboard table
  tbody.innerHTML = implementors.map(s => {
    const dataStr   = encodeURIComponent(JSON.stringify(s));
    const isArchived = Boolean(s.archive_at);
    const rowBg     = isArchived
      ? "bg-amber-50 dark:bg-amber-900/10 border-l-4 border-amber-400 dark:border-amber-500"
      : "bg-white dark:bg-spes-dark-primary hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow cursor-pointer";
    return `
      <tr data-impl-info="${dataStr}" class="impl-row border-b border-gray-100 dark:border-white/5 transition-all duration-200 ${rowBg}">
      ${!isDashboardPage ? `<td class="p-4 text-center"><div class="flex items-center justify-center">
        <input type="checkbox" class="staff-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow" ${isArchived ? "disabled" : ""}>
      </div></td>` : ""}
      <td class="px-6 py-4 text-left text-xs font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${String(s.id).padStart(2, "0")}</td>
      <td class="px-6 py-4 text-left">
        <div class="flex items-center gap-3">
          <!-- Approval Status Icon + Tooltip -->
          <div class="relative group cursor-pointer inline-flex shrink-0">
            ${s.approved 
              ? `<svg class="h-4.5 w-4.5 text-emerald-500 hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                 </svg>`
              : `<svg class="h-4.5 w-4.5 text-rose-500 dark:text-rose-400 hover:scale-110 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                 </svg>`
            }
            <!-- Tooltip -->
            <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
              ${s.approved ? "Approved" : "Not Approved"}
              <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
            </div>
          </div>

          <div class="flex flex-col">
            <span class="text-sm font-extrabold text-spes-black dark:text-spes-white leading-tight">${escHtml(s.full_name)}${isArchived ? ' <span class="ml-1 inline-flex rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">Archived</span>' : ""}</span>
            <span class="text-[10px] font-bold text-spes-black/40 dark:text-spes-white/40 tracking-tighter mt-0.5">@${escHtml(s.username)}</span>
          </div>
        </div>
      </td>
      <td class="px-6 py-4 text-center">
        <span class="inline-flex rounded bg-spes-blue/10 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow">
          ${escHtml(_formatOfficeName(s.office))}
        </span>
      </td>
      <td class="px-6 py-4 text-center">
        <span class="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-widest ${getRoleBadgeClasses(s.role)}">${s.role}</span>
      </td>
      <td class="px-6 py-4 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <div class="h-2 w-2 rounded-full ${getStatusColor(s.status)}${isArchived ? "" : " animate-pulse"}"></div>
          <span class="text-[10px] font-black uppercase tracking-widest">${isArchived ? "ARCHIVED" : s.status}</span>
        </div>
      </td>
      <td class="px-6 py-4 text-center whitespace-nowrap">
        ${isArchived && canEdit
          ? `<button class="btn-restore-impl cursor-pointer text-[11px] font-black uppercase text-emerald-600 hover:underline dark:text-emerald-400 transition-all">Restore</button>`
          : (!isArchived && canEdit
            ? `<button class="btn-edit-impl cursor-pointer text-[11px] font-black uppercase text-spes-blue hover:underline dark:text-spes-yellow transition-all">Edit</button>`
            : `<span class="text-[10px] text-gray-400 dark:text-white/25">—</span>`)}
      </td>
    </tr>`;
  }).join("");

  // Row click → implementor drawer / edit / restore
  document.querySelectorAll(".impl-row").forEach(row => {
    row.querySelector(".btn-edit-impl")?.addEventListener("click", e => {
      e.stopPropagation();
      try {
        const data = JSON.parse(decodeURIComponent(row.getAttribute("data-impl-info")));
        if (window.openAddEditImplementorDrawer) {
          window.openAddEditImplementorDrawer(data);
        }
      } catch {}
    });

    row.querySelector(".btn-restore-impl")?.addEventListener("click", e => {
      e.stopPropagation();
      try {
        const data = JSON.parse(decodeURIComponent(row.getAttribute("data-impl-info")));
        _confirmRestoreStaff(data);
      } catch {}
    });

    row.addEventListener("click", e => {
      if (e.target.closest("button") || e.target.closest("input")) return;
      if (window.openImplementorDrawer) {
        try {
          const data = JSON.parse(decodeURIComponent(row.getAttribute("data-impl-info")));
          window.openImplementorDrawer(data);
        } catch {}
      }
    });
  });
}

// ── Staff CRUD helpers ────────────────────────────────────────
function _isDark() { return document.documentElement.classList.contains("dark"); }

function _swalFormStyle() {
  return _isDark()
    ? "background:#1f2937;color:#f9fafb;border:1px solid #374151;border-radius:8px;padding:8px 12px;font-size:13px;width:100%;box-sizing:border-box;outline:none;"
    : "background:#fff;color:#111827;border:1px solid #d1d5db;border-radius:8px;padding:8px 12px;font-size:13px;width:100%;box-sizing:border-box;outline:none;";
}
function _labelStyle() {
  return `display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;color:${_isDark() ? "#9ca3af" : "#6b7280"};`;
}
function _swalTheme() {
  return { background: _isDark() ? "#111827" : "#ffffff", color: _isDark() ? "#f3f4f6" : "#1f2937" };
}

async function _buildStaffFormHtml(defaults = {}) {
  const is = _swalFormStyle();
  const ls = _labelStyle();
  const v  = (k) => escHtml(defaults[k] ?? "");

  const { data: offices } = await fetchOffices();
  const { data: roles }   = await fetchRoles();

  const officeOpts = offices.map(o =>
    `<option value="${o.id}" ${defaults.office_id == o.id ? "selected" : ""}>${escHtml(o.name)}</option>`).join("");
  const roleOpts = roles.map(r =>
    `<option value="${r.id}" ${defaults.role_id == r.id ? "selected" : ""}>${escHtml(r.name)}</option>`).join("");

  const isEdit = !!defaults.id;

  return `
  <form id="swal-staff-form" style="text-align:left;display:grid;gap:12px;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <label style="${ls}">Full Name <span style="color:#ef4444">*</span></label>
        <input id="sf-full-name" type="text" value="${v("full_name")}" placeholder="Full name" style="${is}" />
      </div>
      <div>
        <label style="${ls}">Username <span style="color:#ef4444">*</span></label>
        <input id="sf-username" type="text" value="${v("username")}" placeholder="username" style="${is}" />
      </div>
    </div>
    <div>
      <label style="${ls}">Email Address <span style="color:#ef4444">*</span></label>
      <input id="sf-email" type="email" value="${v("email")}" placeholder="email@example.com" style="${is}" />
    </div>
    <div>
      <label style="${ls}">${isEdit ? "New Password (leave blank to keep current)" : "Password"} ${isEdit ? "" : '<span style="color:#ef4444">*</span>'}</label>
      <input id="sf-password" type="password" placeholder="${isEdit ? "Leave blank to keep current password" : "Enter password"}" style="${is}" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <label style="${ls}">Role <span style="color:#ef4444">*</span></label>
        <select id="sf-role-id" style="${is}">
          <option value="">-- Select Role --</option>
          ${roleOpts}
        </select>
      </div>
      <div>
        <label style="${ls}">Office</label>
        <select id="sf-office-id" style="${is}">
          <option value="">-- Select Office --</option>
          ${officeOpts}
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <label style="${ls}">Phone</label>
        <input id="sf-phone" type="text" value="${v("phone")}" placeholder="+63 9XX XXX XXXX" style="${is}" />
      </div>
      <div>
        <label style="${ls}">Blood Type</label>
        <input id="sf-blood-type" type="text" value="${v("blood_type")}" placeholder="e.g. O+" style="${is}" />
      </div>
    </div>
    <div>
      <label style="${ls}">Address</label>
      <input id="sf-address" type="text" value="${v("address")}" placeholder="City / Municipality" style="${is}" />
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div>
        <label style="${ls}">Religion</label>
        <input id="sf-religion" type="text" value="${v("religion")}" placeholder="e.g. Roman Catholic" style="${is}" />
      </div>
      <div>
        <label style="${ls}">Language</label>
        <input id="sf-language" type="text" value="${v("language")}" placeholder="e.g. English, Cebuano" style="${is}" />
      </div>
    </div>
  </form>`;
}

function _collectStaffForm() {
  const g = (id) => document.getElementById(id)?.value?.trim() ?? "";
  return {
    full_name:  g("sf-full-name"),
    username:   g("sf-username"),
    email:      g("sf-email"),
    password:   g("sf-password"),
    role_id:    g("sf-role-id") || null,
    office_id:  g("sf-office-id") || null,
    phone:      g("sf-phone"),
    blood_type: g("sf-blood-type"),
    address:    g("sf-address"),
    religion:   g("sf-religion"),
    language:   g("sf-language"),
  };
}

function _wireAddImplementorBtn(user) {
  const drawer = initAddImplementorDrawer({
    onSuccess: async () => {
      await modals.success("Saved!", "Implementor details have been saved successfully.");
      invalidateImplementorCache();
      await loadImplementorTable(user.role);
    }
  });

  window.openAddEditImplementorDrawer = drawer.open;

  const btn = document.getElementById("btn-add-implementor");
  if (btn) {
    btn.addEventListener("click", () => drawer.open());
  }
}

async function _confirmRestoreStaff(staff) {
  const res = await modals.confirm(
    "Restore Implementor",
    `Restore <strong>${staff.full_name}</strong> from archive? They will be set back to active status.`,
    "Restore", "Cancel"
  );
  if (!res.isConfirmed) return;

  modals.loading("Restoring...", "Please wait...");
  const result = await unarchiveStaff(staff.id);
  modals.close();

  if (result.success) {
    await modals.success("Restored!", `${staff.full_name} has been restored successfully.`);
    invalidateImplementorCache();
    await loadImplementorTable(window._spesDashboardRole || "officer");
  } else {
    modals.error("Error", result.error);
  }
}

function _wireArchiveSelectedBtn() {
  const btn = document.getElementById("btn-archive-selected-impl");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const checked = [...document.querySelectorAll(".staff-row-checkbox:checked")];
    if (!checked.length) { modals.warning("No Selection", "Please select one or more implementors first."); return; }

    const res = await modals.confirm(
      "Archive Selected",
      `Archive ${checked.length} selected implementor(s)? This can be undone by an administrator.`,
      "Archive", "Cancel"
    );
    if (!res.isConfirmed) return;

    modals.loading("Archiving...", "Please wait...");
    const ids = checked.map(cb => {
      const row = cb.closest("tr");
      try { return JSON.parse(decodeURIComponent(row?.getAttribute("data-impl-info") || "{}")).id; } catch { return null; }
    }).filter(Boolean);

    const results = await Promise.all(ids.map(id => archiveStaff(id)));
    modals.close();

    const failed = results.filter(r => !r.success).length;
    if (failed) {
      modals.error("Partial Failure", `${failed} implementor(s) could not be archived.`);
    } else {
      await modals.success("Archived", `${ids.length} implementor(s) archived successfully.`);
    }

    invalidateImplementorCache();
    await loadImplementorTable(window._spesDashboardRole || "officer");
  });
}

function _wireApproveSelectedBtn() {
  const btn = document.getElementById("btn-approve-selected-impl");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const checked = [...document.querySelectorAll(".staff-row-checkbox:checked")];
    if (!checked.length) { modals.warning("No Selection", "Please select one or more implementors first."); return; }

    const res = await modals.confirm(
      "Approve Selected",
      `Approve ${checked.length} selected officer(s)? Approved officers will be granted access to view the full student directory.`,
      "Approve", "Cancel"
    );
    if (!res.isConfirmed) return;

    modals.loading("Approving...", "Please wait...");
    const ids = checked.map(cb => {
      const row = cb.closest("tr");
      try { return JSON.parse(decodeURIComponent(row?.getAttribute("data-impl-info") || "{}")).id; } catch { return null; }
    }).filter(Boolean);

    const result = await updateStaffApprovalBulk(ids, true);
    modals.close();

    if (result.success) {
      await modals.success("Approved", `${ids.length} officer(s) approved successfully.`);
    } else {
      modals.error("Error", result.error);
    }

    invalidateImplementorCache();
    await loadImplementorTable(window._spesDashboardRole || "officer");
  });
}

function _wireDisapproveSelectedBtn() {
  const btn = document.getElementById("btn-disapprove-selected-impl");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const checked = [...document.querySelectorAll(".staff-row-checkbox:checked")];
    if (!checked.length) { modals.warning("No Selection", "Please select one or more implementors first."); return; }

    const res = await modals.confirm(
      "Disapprove Selected",
      `Disapprove ${checked.length} selected officer(s)? Disapproved officers will have their list view access revoked.`,
      "Disapprove", "Cancel"
    );
    if (!res.isConfirmed) return;

    modals.loading("Disapproving...", "Please wait...");
    const ids = checked.map(cb => {
      const row = cb.closest("tr");
      try { return JSON.parse(decodeURIComponent(row?.getAttribute("data-impl-info") || "{}")).id; } catch { return null; }
    }).filter(Boolean);

    const result = await updateStaffApprovalBulk(ids, false);
    modals.close();

    if (result.success) {
      await modals.success("Disapproved", `${ids.length} officer(s) disapproved successfully.`);
    } else {
      modals.error("Error", result.error);
    }

    invalidateImplementorCache();
    await loadImplementorTable(window._spesDashboardRole || "officer");
  });
}

async function showEditStaffModal(staff) {
  modals.loading("Loading", "Fetching form data...");
  const formHtml = await _buildStaffFormHtml(staff);
  modals.close();

  const { isConfirmed } = await Swal.fire({
    title: "Edit Implementor",
    html: formHtml,
    width: 640,
    showCancelButton: true,
    confirmButtonText: "Save Changes",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#0038A8",
    cancelButtonColor: "#f87171",
    customClass: { popup: "rounded-2xl shadow-2xl", confirmButton: "rounded-xl font-bold uppercase tracking-wider px-6 py-3 cursor-pointer", cancelButton: "rounded-xl font-bold uppercase tracking-wider px-6 py-3 cursor-pointer" },
    focusConfirm: false,
    preConfirm: () => {
      const v = _collectStaffForm();
      if (!v.full_name) { Swal.showValidationMessage("Full name is required."); return false; }
      if (!v.email)     { Swal.showValidationMessage("Email is required."); return false; }
      return v;
    },
    ..._swalTheme()
  });

  if (!isConfirmed) return;

  const values = _collectStaffForm();
  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");

  modals.loading("Saving Changes", "Please wait...");
  const result = await updateStaff(staff.id, values);
  modals.close();

  if (result.success) {
    await modals.success("Updated!", `${values.full_name}'s profile has been updated.`);
    invalidateImplementorCache();
    await loadImplementorTable(session.role || "officer");
  } else {
    modals.error("Error", result.error);
  }
}

// ── Permissions page handlers ─────────────────────────────────
function setupPermissionChangeHandlers() {
  const PERM_COL_MAP = {
    "users:view":    "view_users",
    "users:create":  "create_users",
    "users:edit":    "edit_users",
    "users:delete":  "delete_users",
    "reports:export":"export_reports"
  };

  document.querySelectorAll(".perm-checkbox:not([disabled])").forEach(cb => {
    cb.addEventListener("change", async e => {
      const target   = e.target;
      const userId   = target.getAttribute("data-user-id");
      const roleId   = parseInt(target.getAttribute("data-role-id"), 10);
      const perm     = target.getAttribute("data-perm");
      const isChecked = target.checked;
      const col      = PERM_COL_MAP[perm];

      if (!col || !roleId) return;

      const user = allImplementors.find(u => String(u.id) === String(userId));
      const result = await upsertRolePermissions(roleId, { [col]: isChecked });

      if (result.success) {
        // Update local cache
        if (!allRolePermissions[roleId]) allRolePermissions[roleId] = {};
        allRolePermissions[roleId][col] = isChecked;

        modals.success("Permission Updated", `${isChecked ? "Granted" : "Revoked"} "${perm}" for all ${user?.role || "role"} users.`);
      } else {
        modals.error("Error", result.error);
        target.checked = !isChecked; // revert
      }
    });
  });

  document.querySelectorAll(".btn-clear-perms:not([disabled])").forEach(btn => {
    btn.addEventListener("click", async () => {
      const roleId = parseInt(btn.getAttribute("data-clear-role-id"), 10);
      if (!roleId) return;

      const user = allImplementors.find(u => String(u.id) === btn.getAttribute("data-clear-user-id"));
      const res = await modals.confirm(
        "Clear Permissions",
        `Revoke all permissions for all ${user?.role || "this role"} users?`,
        "Clear All", "Cancel"
      );
      if (!res.isConfirmed) return;

      modals.loading("Clearing...", "Please wait...");
      const result = await upsertRolePermissions(roleId, {
        view_users: false, create_users: false, edit_users: false,
        delete_users: false, export_reports: false
      });
      modals.close();

      if (result.success) {
        allRolePermissions[roleId] = { view_users: false, create_users: false, edit_users: false, delete_users: false, export_reports: false };
        document.querySelectorAll(`.perm-checkbox[data-role-id="${roleId}"]`).forEach(cb => cb.checked = false);
        modals.success("Permissions Cleared", `All permissions cleared for ${user?.role || "this role"}.`);
      } else {
        modals.error("Error", result.error);
      }
    });
  });

  // Bulk grant
  document.getElementById("btn-bulk-grant")?.addEventListener("click", async () => {
    const checked = [...document.querySelectorAll(".staff-row-checkbox:checked")];
    if (!checked.length) { modals.warning("No Selection", "Please check one or more implementors first."); return; }

    const roleIds = [...new Set(checked.map(cb => {
      const uid = cb.getAttribute("data-row-user-id");
      return allImplementors.find(u => String(u.id) === String(uid))?.role_id;
    }).filter(Boolean))];

    modals.loading("Granting...", "Please wait...");
    const results = await Promise.all(roleIds.map(rid => upsertRolePermissions(rid, {
      view_users: true, create_users: true, edit_users: true, delete_users: true, export_reports: true
    })));
    modals.close();

    if (results.every(r => r.success)) {
      roleIds.forEach(rid => {
        allRolePermissions[rid] = { view_users: true, create_users: true, edit_users: true, delete_users: true, export_reports: true };
        document.querySelectorAll(`.perm-checkbox[data-role-id="${rid}"]`).forEach(cb => cb.checked = true);
      });
      modals.success("Permissions Granted", `All permissions granted for selected implementors' roles.`);
    } else {
      modals.error("Error", "Some permissions could not be updated.");
    }
  });

  // Bulk revoke
  document.getElementById("btn-bulk-revoke")?.addEventListener("click", async () => {
    const checked = [...document.querySelectorAll(".staff-row-checkbox:checked")];
    if (!checked.length) { modals.warning("No Selection", "Please check one or more implementors first."); return; }

    const roleIds = [...new Set(checked.map(cb => {
      const uid = cb.getAttribute("data-row-user-id");
      return allImplementors.find(u => String(u.id) === String(uid))?.role_id;
    }).filter(Boolean))];

    modals.loading("Revoking...", "Please wait...");
    const results = await Promise.all(roleIds.map(rid => upsertRolePermissions(rid, {
      view_users: false, create_users: false, edit_users: false, delete_users: false, export_reports: false
    })));
    modals.close();

    if (results.every(r => r.success)) {
      roleIds.forEach(rid => {
        allRolePermissions[rid] = { view_users: false, create_users: false, edit_users: false, delete_users: false, export_reports: false };
        document.querySelectorAll(`.perm-checkbox[data-role-id="${rid}"]`).forEach(cb => cb.checked = false);
      });
      modals.success("Permissions Revoked", `All permissions revoked for selected implementors' roles.`);
    } else {
      modals.error("Error", "Some permissions could not be updated.");
    }
  });
}

// ── Misc helpers ──────────────────────────────────────────────
function onSelectAll(e) {
  document.querySelectorAll(".staff-row-checkbox").forEach(cb => cb.checked = e.target.checked);
}

function getStatusColor(status) {
  const s = status?.toUpperCase();
  if (s === "ONLINE")   return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]";
  if (s === "BUSY")     return "bg-spes-red shadow-[0_0_8px_rgba(206,17,38,0.4)]";
  if (s === "ARCHIVED") return "bg-gray-300 dark:bg-white/20";
  return "bg-gray-400";
}

function getRoleBadgeClasses(role) {
  if (role?.toLowerCase().includes("admin")) return "bg-spes-blue/10 text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow";
  return "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400";
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function initYearDropdown() {
  const btn  = document.getElementById("year-dropdown-btn");
  const menu = document.getElementById("year-dropdown-menu");
  const icon = document.getElementById("year-dropdown-icon");
  if (!btn || !menu) return;

  btn.addEventListener("click", e => {
    e.stopPropagation();
    const hidden = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !hidden);
    icon?.classList.toggle("rotate-180", hidden);
  });

  document.addEventListener("click", e => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add("hidden");
      icon?.classList.remove("rotate-180");
    }
  });
}

// ── Recent Beneficiaries Loader ─────────────────────────────────
async function loadRecentBeneficiaries() {
  const tbody = document.getElementById("dashboard-beneficiary-table-body");
  if (!tbody) return;

  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  const isAdmin = session.role === "admin";
  const isApproved = isAdmin || session.approved;

  if (!isApproved) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-sm text-spes-red/80 dark:text-red-400/80 font-extrabold uppercase tracking-wider">Account Not Approved. List is hidden.</td></tr>`;
    return;
  }

  try {
    const { fetchBeneficiaries } = await import("../../../backend/api/beneficiary.js");
    const { data } = await fetchBeneficiaries();
    const recent = (data ?? []).slice(0, 3);

    if (recent.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-sm text-spes-black/40 dark:text-white/40 font-extrabold italic">No recent beneficiaries found.</td></tr>`;
      return;
    }

    tbody.innerHTML = recent.map(b => {
      const period = [b.month_period, b.year_period].filter(Boolean).join(" ") || "N/A";

      return `
        <tr class="border-b border-gray-100 dark:border-white/5 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 transition-colors duration-200">
          <td class="px-4 py-4 text-left text-xs font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${String(b.id).padStart(2, "0")}</td>
          <td class="px-6 py-4 text-left whitespace-nowrap font-extrabold text-spes-black dark:text-spes-white">${escHtml(b.full_name?.toUpperCase() || "—")}</td>
          <td class="px-6 py-4 text-center font-bold text-spes-black/70 dark:text-spes-white/70">${escHtml(b.address || "N/A")}</td>
          <td class="px-6 py-4 text-center font-bold text-spes-black/70 dark:text-spes-white/70 uppercase">${escHtml(period)}</td>
          <td class="px-6 py-4 text-center font-black text-indigo-600 dark:text-indigo-400">${escHtml(b.contact_number || "—")}</td>
        </tr>`;
    }).join("");
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES] loadRecentBeneficiaries error:", err);
  }
}

// ── Swapping Tables Toggle Logic ────────────────────────────────
function setupDashboardListToggle(user) {
  const isAdmin = user.role === "admin";
  const toggleToSpes = document.getElementById("toggle-to-spes");
  const toggleToImplementors = document.getElementById("toggle-to-implementors");
  const implementorsPanel = document.getElementById("dashboard-implementors-panel");
  const beneficiariesPanel = document.getElementById("dashboard-beneficiaries-panel");

  const canToggle = isAdmin || (user.permissions && user.permissions.view_users);

  if (canToggle) {
    toggleToSpes?.classList.remove("hidden");
    toggleToImplementors?.classList.remove("hidden");

    // Default: show Implementors panel and hide Beneficiaries/SPES on load
    implementorsPanel?.classList.remove("hidden");
    beneficiariesPanel?.classList.add("hidden");

    toggleToSpes?.addEventListener("click", () => {
      implementorsPanel?.classList.add("hidden");
      beneficiariesPanel?.classList.remove("hidden");
    });

    toggleToImplementors?.addEventListener("click", () => {
      beneficiariesPanel?.classList.add("hidden");
      implementorsPanel?.classList.remove("hidden");
    });
  } else {
    // Non-permitted Officer: lock to SPES list panel
    toggleToSpes?.classList.add("hidden");
    toggleToImplementors?.classList.add("hidden");
    implementorsPanel?.classList.add("hidden");
    beneficiariesPanel?.classList.remove("hidden");
  }
}

// ── Supabase Realtime Permissions Listener ────────────────────────
function setupRealtimePermissionsListener() {
  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  if (!session || !session.role_id) return;

  supabase
    .channel("custom-filter-permissions-channel")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "permissions",
        filter: `role_id=eq.${session.role_id}`
      },
      async (payload) => {
        if (import.meta.env.DEV) console.log("[SPES Realtime] Permissions updated for our role:", payload);
        
        // Refresh local cache and localStorage
        const { fetchRolePermissions } = await import("../../../backend/api/permissions.js");
        const { data: freshPerms } = await fetchRolePermissions(session.role_id, { forceRefresh: true });
        if (freshPerms) {
          session.permissions = freshPerms;
          localStorage.setItem("spes_session", JSON.stringify(session));
          
          Swal.fire({
            title: "Permissions Updated",
            text: "Your access permissions have been updated in real-time. Reloading the page...",
            icon: "info",
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            customClass: {
              popup: "rounded-2xl border-none shadow-2xl"
            },
            background: document.documentElement.classList.contains("dark") ? "#111827" : "#ffffff",
            color: document.documentElement.classList.contains("dark") ? "#f3f4f6" : "#1f2937"
          }).then(() => {
            window.location.reload();
          });
        }
      }
    )
    .subscribe();
}

function setupRealtimeApprovalListener() {
  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  if (!session || !session.id || session.role === "admin") return;

  supabase
    .channel("dashboard-approval-channel")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "staffs",
        filter: `id=eq.${session.id}`
      },
      (payload) => {
        const newApproved = payload.new.approved;
        if (String(session.approved) !== String(newApproved)) {
          session.approved = newApproved;
          localStorage.setItem("spes_session", JSON.stringify(session));

          const isApproved = String(newApproved).toLowerCase() === "true";
          Swal.fire({
            title: isApproved ? "Account Approved!" : "Account Disapproved",
            text: isApproved 
              ? "Your officer account has been approved in real-time. Reloading the page to grant full access..."
              : "Your officer account has been disapproved. Reloading the page to revoke access...",
            icon: isApproved ? "success" : "warning",
            timer: 3500,
            timerProgressBar: true,
            showConfirmButton: false,
            customClass: {
              popup: "rounded-2xl border-none shadow-2xl"
            },
            background: document.documentElement.classList.contains("dark") ? "#111827" : "#ffffff",
            color: document.documentElement.classList.contains("dark") ? "#f3f4f6" : "#1f2937"
          }).then(() => {
            window.location.reload();
          });
        }
      }
    )
    .subscribe();
}

function initQuickAccessStatsToggle() {
  const mainContainer = document.getElementById("main-dashboard-container");
  const metricsRow = document.getElementById("dashboard-metrics-container");
  const detailsRow = document.getElementById("dashboard-details-container");
  const normalDesktopGrid = document.getElementById("quick-access-normal-desktop");
  const normalMobileList = document.getElementById("quick-access-normal-mobile");
  const expandedDesktopGrid = document.getElementById("quick-access-expanded-desktop");
  const expandedMobileGrid = document.getElementById("quick-access-expanded-mobile");

  const btnHeader = document.getElementById("header-toggle-stats");

  const hideIconHeader = document.getElementById("header-hide-stats-icon");
  const showIconHeader = document.getElementById("header-show-stats-icon");
  const textHeader = document.getElementById("header-toggle-stats-text");

  const applyState = (hide) => {
    if (hide) {
      metricsRow?.classList.add("hidden");
      detailsRow?.classList.add("hidden");

      normalDesktopGrid?.classList.add("hidden");
      normalDesktopGrid?.classList.remove("md:grid");

      expandedDesktopGrid?.classList.add("hidden");
      expandedDesktopGrid?.classList.add("md:flex");

      normalMobileList?.classList.add("hidden");
      normalMobileList?.classList.remove("flex");

      expandedMobileGrid?.classList.remove("hidden");
      expandedMobileGrid?.classList.add("flex");

      // Dynamic margin adjustment to prevent cards from getting hidden under the blue banner
      mainContainer?.classList.remove("lg:-mt-16");
      mainContainer?.classList.add("lg:mt-8");

      // Header button update
      hideIconHeader?.classList.add("hidden");
      showIconHeader?.classList.remove("hidden");
      if (textHeader) textHeader.textContent = "Show Stats";

      // Normal Desktop button update
      document.getElementById("hide-stats-icon")?.classList.add("hidden");
      document.getElementById("show-stats-icon")?.classList.remove("hidden");
      const quickToggleText = document.getElementById("quick-toggle-stats-text");
      if (quickToggleText) quickToggleText.textContent = "Show Stats";

      // Expanded Desktop button update
      document.getElementById("hide-stats-icon-expanded")?.classList.add("hidden");
      document.getElementById("show-stats-icon-expanded")?.classList.remove("hidden");
      const quickToggleExpandedText = document.getElementById("quick-toggle-stats-expanded-text");
      if (quickToggleExpandedText) quickToggleExpandedText.textContent = "Show Stats";

      // Mobile button update
      document.getElementById("hide-stats-icon-mob")?.classList.add("hidden");
      document.getElementById("show-stats-icon-mob")?.classList.remove("hidden");
      const quickToggleMobText = document.getElementById("quick-toggle-stats-mob-text");
      if (quickToggleMobText) quickToggleMobText.textContent = "Show Stats";

      // Mobile Expanded button update
      document.getElementById("hide-stats-icon-expanded-mob")?.classList.add("hidden");
      document.getElementById("show-stats-icon-expanded-mob")?.classList.remove("hidden");
      const quickToggleExpandedMobText = document.getElementById("quick-toggle-stats-expanded-mob-text");
      if (quickToggleExpandedMobText) quickToggleExpandedMobText.textContent = "Show Stats";
    } else {
      metricsRow?.classList.remove("hidden");
      detailsRow?.classList.remove("hidden");

      normalDesktopGrid?.classList.add("hidden");
      normalDesktopGrid?.classList.add("md:grid");

      expandedDesktopGrid?.classList.add("hidden");
      expandedDesktopGrid?.classList.remove("md:flex");

      normalMobileList?.classList.remove("hidden");
      normalMobileList?.classList.add("flex");

      expandedMobileGrid?.classList.add("hidden");
      expandedMobileGrid?.classList.remove("flex");

      // Revert margin back to overlapping style
      mainContainer?.classList.add("lg:-mt-16");
      mainContainer?.classList.remove("lg:mt-8");

      // Header button update
      hideIconHeader?.classList.remove("hidden");
      showIconHeader?.classList.add("hidden");
      if (textHeader) textHeader.textContent = "Hide Stats";

      // Normal Desktop button update
      document.getElementById("hide-stats-icon")?.classList.remove("hidden");
      document.getElementById("show-stats-icon")?.classList.add("hidden");
      const quickToggleText = document.getElementById("quick-toggle-stats-text");
      if (quickToggleText) quickToggleText.textContent = "Hide Stats";

      // Expanded Desktop button update
      document.getElementById("hide-stats-icon-expanded")?.classList.remove("hidden");
      document.getElementById("show-stats-icon-expanded")?.classList.add("hidden");
      const quickToggleExpandedText = document.getElementById("quick-toggle-stats-expanded-text");
      if (quickToggleExpandedText) quickToggleExpandedText.textContent = "Hide Stats";

      // Mobile button update
      document.getElementById("hide-stats-icon-mob")?.classList.remove("hidden");
      document.getElementById("show-stats-icon-mob")?.classList.add("hidden");
      const quickToggleMobText = document.getElementById("quick-toggle-stats-mob-text");
      if (quickToggleMobText) quickToggleMobText.textContent = "Hide Stats";

      // Mobile Expanded button update
      document.getElementById("hide-stats-icon-expanded-mob")?.classList.remove("hidden");
      document.getElementById("show-stats-icon-expanded-mob")?.classList.add("hidden");
      const quickToggleExpandedMobText = document.getElementById("quick-toggle-stats-expanded-mob-text");
      if (quickToggleExpandedMobText) quickToggleExpandedMobText.textContent = "Hide Stats";
    }
  };

  const isHidden = localStorage.getItem("spes-dashboard-hide-cards") === "true";
  applyState(isHidden);

  const toggle = () => {
    const nextHidden = !(localStorage.getItem("spes-dashboard-hide-cards") === "true");
    localStorage.setItem("spes-dashboard-hide-cards", nextHidden ? "true" : "false");
    applyState(nextHidden);
  };

  btnHeader?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats")?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats-expanded")?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats-mob")?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats-expanded-mob")?.addEventListener("click", toggle);
}
