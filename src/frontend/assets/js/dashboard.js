/**
 * SPES Portal — Dashboard Entry Script
 * ──────────────────────────────────────
 * All data comes from Supabase. No mock fallbacks.
 */
import "../styles/tailwind.css";
import "flowbite";
import ApexCharts from "apexcharts";
import { applyPermissions, requireAuth, signOut } from "./rbac/guard.js";
import { supabase } from "../../../backend/api/supabase.js";
import { fetchImplementorList, invalidateImplementorCache } from "../../../backend/api/auth.js";
import { updateStaff, archiveStaff, unarchiveStaff, fetchOffices, fetchRoles, updateStaffApprovalBulk } from "../../../backend/api/staff.js";
import { fetchAllRolePermissions, upsertRolePermissions } from "../../../backend/api/permissions.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initFlowbite } from "flowbite";
import { initDashboardCharts, exportDashboardStats } from "./components/charts.js";
import { modals } from "./components/modals.js";
import { initBeneficiaries } from "./components/beneficiaries.js";
import { setupSortFiltration } from "./components/sort-filtration.js";
import { initImplementorsDrawer, initAddImplementorDrawer } from "./components/drawer.js";
import Swal from "sweetalert2";
import { initQuickAccessCarousel, initQuickAccessPremiumInteractions } from "./components/animations.js";
import { applyTextSize } from "./components/settings.js";

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
      const { data: staffData } = await supabase.from("staffs").select("approved").eq("id", user.id).maybeSingle();
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
  initGlobalSearch(user);

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

    const editParams = new URLSearchParams(window.location.search);
    const editTargetId = editParams.get("id");
    if (editParams.get("edit") === "1" && editTargetId) {
      const editTarget = allImplementors.find(item => String(item.id) === String(editTargetId));
      if (editTarget) {
        setTimeout(() => {
          window.openAddEditImplementorDrawer?.(editTarget);
          editParams.delete("edit");
          const cleanSearch = editParams.toString();
          history.replaceState(null, "", `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ""}`);
        }, 250);
      }
    }
  }

  updateDynamicBadges();

  if (path.includes("/dashboard/")) {
    const viewAllLink = document.getElementById("dashboard-view-all-link");
    if (viewAllLink) {
      viewAllLink.textContent = user.role === "admin" ? "View All" : "View Yours";
    }
    initDashboardCharts();
    _wireExportStatsButtons();
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
  
  // Apply saved global text size scale
  const savedTextSize = parseInt(localStorage.getItem("spes-text-size") ?? "0", 10) || 0;
  applyTextSize(savedTextSize);

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
function pinSystemAdministratorFirst(items, shouldPin) {
  const ordered = [...items];
  if (!shouldPin) return ordered;

  const adminIndex = ordered.findIndex((item) =>
    String(item.full_name || "").trim().toLowerCase() === "system administrator" ||
    String(item.username || "").trim().toLowerCase() === "admin"
  );
  const systemAdministrator = adminIndex >= 0 ? ordered.splice(adminIndex, 1)[0] : null;
  const approved = ordered.filter((item) => item.approved === true);
  const unapproved = ordered.filter((item) => item.approved !== true);

  return [systemAdministrator, ...approved, ...unapproved].filter(Boolean);
}

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
      allImplementors = pinSystemAdministratorFirst(
        filtered,
        isImplPage && String(userRole || "").toLowerCase() === "admin"
      );
      currentPage = 1;

      // Jump to page if ?id= matches an implementor
      const urlId = new URLSearchParams(window.location.search).get("id");
      if (urlId) {
        const targetIdx = allImplementors.findIndex(s => String(s.id) === String(urlId));
        if (targetIdx !== -1) {
          currentPage = Math.floor(targetIdx / rowsPerPage) + 1;
        }
      }

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
    staffBadge.className = "rounded-full bg-spes-blue/10 px-2.5 py-1 text-[0.625rem] font-black uppercase text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow";
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

      // Real month-over-month growth: compare latest month vs previous month
      const now = new Date();
      const curMonthCount  = monthly[now.getMonth()];
      const prevMonthIdx   = (now.getMonth() - 1 + 12) % 12;
      const prevMonthCount = monthly[prevMonthIdx];
      let growthStr = "N/A";
      if (prevMonthCount > 0) {
        const pct = Math.round(((curMonthCount - prevMonthCount) / prevMonthCount) * 100);
        growthStr = `${pct >= 0 ? "+" : ""}${pct}%`;
      } else if (curMonthCount > 0) {
        growthStr = "+100%"; // brand new month with data
      }
      if (growthEl) growthEl.innerHTML = `<p class="text-lg font-black ${growthStr.startsWith("+") || growthStr === "N/A" ? "text-spes-blue dark:text-spes-yellow" : "text-rose-500"}">${growthStr}</p>`;
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

      const isTarget = new URLSearchParams(window.location.search).get("id") === String(s.id);
      const rowClass = isTarget 
        ? "border-b border-gray-100 dark:border-white/5 bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse" 
        : "border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow";

      return `
        <tr class="${rowClass}">
          <td class="p-4 text-center"><div class="flex items-center justify-center">
            <input type="checkbox" data-row-user-id="${s.id}" class="staff-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </div></td>
          <td class="px-6 py-4 text-left text-xs font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${String(s.id).padStart(2, "0")}</td>
          <td class="px-6 py-4 text-left whitespace-nowrap">
            <div class="flex items-center gap-3">
              <!-- Approval Status Icon + Tooltip -->
              <div class="relative group cursor-pointer inline-flex shrink-0">
                ${s.approved 
                  ? `<svg class="h-4.5 w-4.5 text-emerald-500 hover:scale-110 transition-transform cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                     </svg>`
                  : `<svg class="h-4.5 w-4.5 text-rose-500 dark:text-rose-400 hover:scale-110 transition-transform cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                       <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                     </svg>`
                }
                <!-- Tooltip -->
                <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
                  ${s.approved ? "Approved" : "Not Approved"}
                  <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
                </div>
              </div>

              <div class="flex flex-col">
                <span class="text-sm font-extrabold text-spes-black dark:text-spes-white leading-tight">${escHtml(s.full_name)}</span>
                <span class="text-[0.625rem] font-bold text-spes-black/40 dark:text-spes-white/40 tracking-tighter mt-0.5">@${escHtml(s.username)} · ${escHtml(displayRole)}</span>
              </div>
            </div>
          </td>
          <td class="px-6 py-4 text-center">
            <span class="inline-flex rounded bg-spes-blue/10 px-2.5 py-0.5 text-[0.625rem] font-black uppercase tracking-widest text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow whitespace-nowrap">
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
                <svg class="h-4.5 w-4.5 shrink-0 cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
              <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
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
    const isTarget = new URLSearchParams(window.location.search).get("id") === String(s.id);
    const rowBg     = isTarget
      ? "bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse cursor-pointer"
      : isArchived
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
              ? `<svg class="h-4.5 w-4.5 text-emerald-500 hover:scale-110 transition-transform cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                 </svg>`
              : `<svg class="h-4.5 w-4.5 text-rose-500 dark:text-rose-400 hover:scale-110 transition-transform cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                   <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                 </svg>`
            }
            <!-- Tooltip -->
            <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
              ${s.approved ? "Approved" : "Not Approved"}
              <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
            </div>
          </div>

          <div class="flex flex-col">
            <span class="text-sm font-extrabold text-spes-black dark:text-spes-white leading-tight">${escHtml(s.full_name)}${isArchived ? ' <span class="ml-1 inline-flex rounded px-1.5 py-0.5 text-[0.5625rem] font-black uppercase tracking-wider bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">Archived</span>' : ""}</span>
            <span class="text-[0.625rem] font-bold text-spes-black/40 dark:text-spes-white/40 tracking-tighter mt-0.5">@${escHtml(s.username)}</span>
          </div>
        </div>
      </td>
      <td class="px-6 py-4 text-center align-top">
        <span class="inline-flex border border-spes-blue/15 bg-spes-blue/10 px-2.5 py-0.5 text-[0.625rem] font-black uppercase tracking-widest text-spes-blue dark:border-spes-yellow/20 dark:bg-spes-yellow/15 dark:text-spes-yellow whitespace-nowrap">
          ${escHtml(_formatOfficeName(s.office))}
        </span>
      </td>
      <td class="px-6 py-4 text-center">
        <span class="inline-flex rounded-full px-2.5 py-0.5 text-[0.625rem] font-black tracking-widest ${getRoleBadgeClasses(s.role)}">${s.role}</span>
      </td>
      <td class="px-6 py-4 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <div class="h-2 w-2 rounded-full ${getStatusColor(s.status)}${isArchived ? "" : " animate-pulse"}"></div>
          <span class="text-[0.625rem] font-black uppercase tracking-widest">${isArchived ? "ARCHIVED" : s.status}</span>
        </div>
      </td>
      <td class="px-6 py-4 text-center whitespace-nowrap">
        <div class="flex items-center justify-center gap-2">
        ${isArchived && canEdit
          ? `<button class="btn-restore-impl cursor-pointer text-[0.6875rem] font-black uppercase text-emerald-600 hover:underline dark:text-emerald-400 transition-all">Restore</button>`
          : (!isArchived && canEdit
            ? `<div class="relative group cursor-pointer inline-flex">
                 <button class="btn-edit-impl p-1.5 rounded-lg text-spes-blue hover:bg-spes-blue/10 dark:text-spes-yellow dark:hover:bg-spes-yellow/10 transition-colors cursor-pointer" aria-label="Edit">
                   <svg class="w-4.5 h-4.5 cursor-pointer" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                     <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m14.304 4.844 2.852 2.852M7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-4.5m2.409-9.91a2.017 2.017 0 0 1 0 2.853l-6.844 6.844L8 14l.713-3.565 6.844-6.844a2.015 2.015 0 0 1 2.852 0Z"/>
                   </svg>
                 </button>
                 <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
                   Edit
                   <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
                 </div>
               </div>
               
               <div class="relative group cursor-pointer inline-flex">
                 <button data-impl-id="${s.id}" class="btn-approve-impl p-1.5 rounded-lg transition-colors cursor-pointer ${s.approved ? "text-emerald-500/40 cursor-not-allowed dark:text-emerald-400/40" : "text-emerald-500 hover:bg-emerald-500/10 dark:text-emerald-400 dark:hover:bg-emerald-400/10"}" ${s.approved ? "disabled" : ""} aria-label="Approve">
                   <svg class="w-4.5 h-4.5 cursor-pointer" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                     <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                   </svg>
                 </button>
                 <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
                   ${s.approved ? "Already Approved" : "Approve"}
                   <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
                 </div>
               </div>`
            : `<span class="text-[0.625rem] text-gray-400 dark:text-white/25">—</span>`)}
        </div>
      </td>
    </tr>`;
  }).join("");

  // Row click → implementor drawer / edit / restore
  document.querySelectorAll(".impl-row").forEach(row => {
    row.querySelector(".btn-edit-impl")?.addEventListener("click", e => {
      e.stopPropagation();
      try {
        const data = JSON.parse(decodeURIComponent(row.getAttribute("data-impl-info")));
        const isImplementorsPage = window.location.pathname.includes("/implementors/");
        if (isImplementorsPage && window.openAddEditImplementorDrawer) {
          window.openAddEditImplementorDrawer(data);
          return;
        }
        window.location.href = `../implementors/?id=${encodeURIComponent(data.id)}&edit=1`;
      } catch {}
    });

    row.querySelector(".btn-approve-impl")?.addEventListener("click", async e => {
      e.stopPropagation();
      const btn = e.currentTarget;
      const id = btn.getAttribute("data-impl-id");
      if (!id || btn.disabled) return;

      const originalHtml = btn.innerHTML;
      btn.innerHTML = `<svg class="w-4.5 h-4.5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>`;
      btn.disabled = true;

      try {
        const { updateStaffApprovalBulk } = await import("../../../backend/api/staff.js");
        const result = await updateStaffApprovalBulk([id], true);
        if (result.success) {
          await loadImplementorTable(window._spesDashboardRole || "officer");
          import("./components/modals.js").then(m => m.modals.toast("Implementor successfully approved.", "success"));
        } else {
          btn.innerHTML = originalHtml;
          btn.disabled = false;
          import("./components/modals.js").then(m => m.modals.error("Error", result.error || "Failed to approve implementor."));
        }
      } catch (err) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        console.error(err);
      }
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
  const isAdmin = String(session.role || "").toLowerCase() === "admin";
  const isApproved = isAdmin || session.approved;

  if (!isApproved) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-sm text-spes-red/80 dark:text-red-400/80 font-extrabold uppercase tracking-wider">Account Not Approved. List is hidden.</td></tr>`;
    return;
  }

  try {
    const { fetchRecentBeneficiaries } = await import("../../../backend/api/beneficiary.js");
    const { data, error } = await fetchRecentBeneficiaries({ limit: 4 });
    const recent = data ?? [];

    if (error) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-sm text-red-500/80 dark:text-red-400/80 font-extrabold">${escHtml(error)}</td></tr>`;
      return;
    }
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

      // Hide Normal Desktop, Show Expanded Desktop on large screens
      // We do NOT remove "hidden" so they remain hidden on mobile!
      normalDesktopGrid?.classList.remove("lg:grid");
      expandedDesktopGrid?.classList.add("lg:flex");

      // Hide Normal Mobile, Show Expanded Mobile on small screens
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

      // Show Normal Desktop, Hide Expanded Desktop on large screens
      normalDesktopGrid?.classList.add("lg:grid");
      expandedDesktopGrid?.classList.remove("lg:flex");

      // Show Normal Mobile, Hide Expanded Mobile on small screens
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

  let isHidden = localStorage.getItem("spes-dashboard-stats-hidden") === "true";
  applyState(isHidden);

  const toggle = () => {
    isHidden = !isHidden;
    localStorage.setItem("spes-dashboard-stats-hidden", isHidden);
    applyState(isHidden);
  };

  btnHeader?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats")?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats-expanded")?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats-mob")?.addEventListener("click", toggle);
  document.getElementById("quick-toggle-stats-expanded-mob")?.addEventListener("click", toggle);
}

function _wireExportStatsButtons() {
  ["quick-export", "quick-export-expanded", "quick-export-expanded-mob", "quick-export-mob"]
    .forEach(id => {
      document.getElementById(id)?.addEventListener("click", () => exportDashboardStats());
    });
}

function initGlobalSearch(user) {
  const overlay = document.getElementById("global-search-overlay");
  const form = document.getElementById("global-search-form");
  const input = document.getElementById("global-search-input");
  const closeBtn = document.getElementById("btn-close-search");
  const clearBtn = document.getElementById("btn-clear-global-search");
  const resultsContainer = document.getElementById("global-search-results");
  const searchContainer = document.getElementById("global-search-container");

  const searchButtons = [
    document.getElementById("quick-search"),
    document.getElementById("quick-search-expanded"),
    document.getElementById("quick-search-expanded-mob"),
    document.getElementById("quick-search-mob")
  ];

  let currentApexChart = null;

  const syncGlobalClearVisibility = () => {
    if (!clearBtn || !input) return;
    const hasValue = input.value.length > 0;
    clearBtn.classList.toggle("hidden", !hasValue);
    clearBtn.classList.toggle("flex", hasValue);
  };

  const clearGlobalSearch = () => {
    input.value = "";
    resultsContainer.classList.add("hidden");
    resultsContainer.innerHTML = "";
    searchContainer.classList.remove("max-w-5xl");
    searchContainer.classList.add("max-w-lg");
    if (currentApexChart) {
      currentApexChart.destroy();
      currentApexChart = null;
    }
    syncGlobalClearVisibility();
  };

  input?.addEventListener("input", syncGlobalClearVisibility);
  clearBtn?.addEventListener("click", () => {
    clearGlobalSearch();
    input.focus();
  });
  syncGlobalClearVisibility();

  const openSearch = () => {
    overlay.classList.remove("hidden");
    document.body.classList.add("overflow-hidden"); // Prevent background scrolling
    setTimeout(() => {
      overlay.classList.remove("opacity-0");
      searchContainer.classList.remove("scale-95");
      input.focus();
    }, 10);
  };

  const closeSearch = () => {
    overlay.classList.add("opacity-0");
    searchContainer.classList.add("scale-95");
    document.body.classList.remove("overflow-hidden"); // Restore background scrolling
    setTimeout(() => {
      overlay.classList.add("hidden");
      clearGlobalSearch();
    }, 300);
  };

  searchButtons.forEach(btn => {
    if (btn) btn.addEventListener("click", openSearch);
  });

  closeBtn?.addEventListener("click", closeSearch);
  
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeSearch();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
      closeSearch();
    }
  });

  input?.addEventListener("input", (e) => {
    const query = e.target.value.trim();

    if (query.length < 2) {
      resultsContainer.classList.add("hidden");
      resultsContainer.innerHTML = "";
      searchContainer.classList.remove("max-w-5xl");
      searchContainer.classList.add("max-w-lg");
      if (currentApexChart) {
        currentApexChart.destroy();
        currentApexChart = null;
      }
    }
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (query.length >= 2) {
      performSearch(query, user);
    }
  });

  async function performSearch(query, user) {
    const roleId = user.role_id;
    const officeId = user.office_id;
    try {
      resultsContainer.innerHTML = `
        <div class="p-8 text-center text-sm text-gray-500 dark:text-gray-400">
          <svg class="animate-spin h-8 w-8 mx-auto mb-3 text-spes-blue dark:text-spes-yellow" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span class="font-bold tracking-wider uppercase text-xs">Querying database...</span>
        </div>`;
      resultsContainer.classList.remove("hidden");
      searchContainer.classList.remove("max-w-lg");
      searchContainer.classList.add("max-w-5xl");

      // Clean query of characters that break PostgREST .or() syntax (like commas and quotes)
      const safeQuery = query.replace(/[,()"]/g, '').trim();

      // 1. Search offices matching query (by name or location)
      const { data: matchedOffices } = await supabase
        .from("offices")
        .select("id")
        .or(`name.ilike.%${safeQuery}%,location.ilike.%${safeQuery}%`);
      const officeIds = (matchedOffices || []).map(o => o.id);

      // 2. Setup Base Queries — includes education_level and education joins for grade/year level filtering
      let benQuery = supabase
        .from("beneficiary")
        .select(`
          id, full_name, gender_id, return_status, birthday, age, address, designated, month_period, year_period, staff_id, batch_id,
          education_level_id, educ_id,
          education_level:education_level_id(id, name, education_id),
          education:educ_id(id, name),
          staffs!staff_id${roleId === 2 ? '!inner' : ''}(office_id, full_name, offices(name))
        `);
      let staffSearchQuery = roleId === 1 ? supabase.from("staffs").select("id, full_name, approved, offices(name)") : null;

      // ─────────────────────────────────────────────────────────
      // ─────────────────────────────────────────────────────────────────────
      // 3. Smart Keyword Intercept
      //    Keywords → filter beneficiaries + optional groupBy for category view
      // ─────────────────────────────────────────────────────────────────────
      const qUpper = query.toUpperCase().trim();
      const qNorm  = qUpper.replace(/\s+/g, " ");
      let isKeyword = false;
      let searchGroupMode = null; // null | "EDUCATION_CAT" | "EDUCATION_LEVEL"
      let groupMeta = [];  // [{ id, name }] — the groups to display

      // `education_levels` is currently protected by RLS in production, so an
      // anon lookup can legitimately return an empty array even though
      // beneficiary.education_level_id contains valid foreign-key values.
      // Keep the production IDs as a fallback so quick search still resolves
      // the level filter. DB rows always take precedence when they are visible.
      const fallbackEducationLevels = [
        { id: 1, education_id: 1, name: "Grade 11" },
        { id: 2, education_id: 1, name: "Grade 12" },
        { id: 3, education_id: 3, name: "1st Year" },
        { id: 4, education_id: 3, name: "2nd Year" },
        { id: 5, education_id: 3, name: "3rd Year" },
        { id: 6, education_id: 3, name: "4th Year" },
        { id: 8, education_id: 4, name: "Grade 7" },
        { id: 9, education_id: 4, name: "Grade 8" },
        { id: 10, education_id: 4, name: "Grade 9" },
        { id: 11, education_id: 4, name: "Grade 10" },
      ];

      // ── DB helpers ──
      const fetchEducRows = async (nameLike) => {
        const { data, error } = await supabase
          .from("education")
          .select("id, name")
          .ilike("name", `%${nameLike}%`)
          .order("name");
        if (error) throw error;
        return data || [];
      };
      const fetchEduLevelRows = async (nameLike) => {
        const { data, error } = await supabase
          .from("education_levels")
          .select("id, education_id, name")
          .ilike("name", `%${nameLike}%`)
          .order("education_id")
          .order("sort_order");
        if (error) throw error;
        if (data?.length) return data;

        const needle = String(nameLike ?? "").trim().toLowerCase();
        return fallbackEducationLevels.filter(level =>
          level.name.toLowerCase().includes(needle)
        );
      };

      // ── TOTAL / ALL ──
      if (qNorm === "TOTAL" || qNorm === "ALL") {
        isKeyword = true;

      // ── GENDER ──
      } else if (qNorm === "MALE" || qNorm === "LALAKI") {
        isKeyword = true;
        benQuery = benQuery.eq("gender_id", 1);
        staffSearchQuery = null;

      } else if (qNorm === "FEMALE" || qNorm === "BABAE") {
        isKeyword = true;
        benQuery = benQuery.eq("gender_id", 2);
        staffSearchQuery = null;

      // ── SPES / BENEFICIARIES ──
      } else if (qNorm === "SPES" || qNorm === "BENEFICIARIES" || qNorm === "BENEFICIARY") {
        isKeyword = true;
        staffSearchQuery = null;

      // ── IMPLEMENTORS / STAFF ──
      } else if (["IMPLEMENTORS","IMPLEMENTOR","STAFF","STAFFS","OFFICER","OFFICERS"].includes(qNorm)) {
        isKeyword = true;
        benQuery = null;

      // ── RETURN STATUS: NEW ──
      } else if (qNorm === "NEW" || qNorm === "NEW BENEFICIARY" || qNorm === "FIRST TIME" || qNorm === "NEWCOMER") {
        isKeyword = true;
        benQuery = benQuery.eq("return_status", "NEW");
        staffSearchQuery = null;

      // ── RETURN STATUS: SPES BABY / RETURNING ──
      } else if (
        qNorm === "RETURNING" || qNorm === "SPES BABY" || qNorm === "RETURNEE" ||
        qNorm === "RETURN" || qNorm === "RETURNER" || qNorm === "BABY"
      ) {
        isKeyword = true;
        benQuery = benQuery.eq("return_status", "SPES BABY");
        staffSearchQuery = null;

      // ── ONGOING (not SPES BABY) ──
      } else if (qNorm === "ONGOING" || qNorm === "ACTIVE") {
        isKeyword = true;
        benQuery = benQuery.neq("return_status", "SPES BABY");
        staffSearchQuery = null;

      // ── IMPLEMENTOR APPROVAL STATUS ──
      } else if (qNorm === "APPROVED") {
        isKeyword = true;
        benQuery = null;
        if (staffSearchQuery) staffSearchQuery = staffSearchQuery.eq("approved", true);

      } else if (qNorm === "PENDING" || qNorm === "UNAPPROVED") {
        isKeyword = true;
        benQuery = null;
        if (staffSearchQuery) staffSearchQuery = staffSearchQuery.eq("approved", false);

      } else {
        // ─────────────────────────────────────────────────────────────────
        // EDUCATION-LEVEL GROUPED SEARCH  (education_levels table)
        // "grade" → shows ALL grades (7-12) grouped
        // "year"  → shows ALL year levels (1st-4th) grouped
        // "grade 7" → only Grade 7
        // ─────────────────────────────────────────────────────────────────

        // Map what user types → DB ILIKE search pattern for education_levels.name
        const levelPatternMap = [
          { test: /^GRADE\s*7$|^G\s*7$|^GR\s*7$/,    pattern: "Grade 7"    },
          { test: /^GRADE\s*8$|^G\s*8$|^GR\s*8$/,    pattern: "Grade 8"    },
          { test: /^GRADE\s*9$|^G\s*9$|^GR\s*9$/,    pattern: "Grade 9"    },
          { test: /^GRADE\s*10$|^G\s*10$|^GR\s*10$/, pattern: "Grade 10"   },
          { test: /^GRADE\s*11$|^G\s*11$|^GR\s*11$/, pattern: "Grade 11"   },
          { test: /^GRADE\s*12$|^G\s*12$|^GR\s*12$/, pattern: "Grade 12"   },
          { test: /^1ST\s*YEAR$|^FIRST\s*YEAR$|^1ST\s*YR$|^YEAR\s*1$|^FRESHMAN$/,  pattern: "1st Year"  },
          { test: /^2ND\s*YEAR$|^SECOND\s*YEAR$|^2ND\s*YR$|^YEAR\s*2$|^SOPHOMORE$/,pattern: "2nd Year"  },
          { test: /^3RD\s*YEAR$|^THIRD\s*YEAR$|^3RD\s*YR$|^YEAR\s*3$/,             pattern: "3rd Year"  },
          { test: /^4TH\s*YEAR$|^FOURTH\s*YEAR$|^4TH\s*YR$|^YEAR\s*4$|^GRADUATING$/,pattern: "4th Year" },
          // BROAD partial → all matching levels from DB (show grouped)
          { test: /^GRADE$|^GRADES$/,              pattern: "Grade",      grouped: true },
          { test: /^YEAR$|^YEARS$|^COL$|^COLL$/,  pattern: "Year",       grouped: true },
          { test: /^JHS$|^JUNIOR\s*HIGH$/,         pattern: "Grade",      grouped: true },
          { test: /^SHS$|^SENIOR\s*HIGH$/,         pattern: "Grade 1",    grouped: true }, // partial — catches G11, G12
          { test: /^VOCAT|^TVET$|^TECH.?VOC$|^TESDA$|^VOCATIONAL$|^NC[1-4]$/, pattern: "Vocational", grouped: false },
        ];

        let levelPattern = null;
        let levelGrouped = false;
        for (const lp of levelPatternMap) {
          if (lp.test.test(qNorm)) {
            levelPattern = lp.pattern;
            levelGrouped = !!lp.grouped;
            break;
          }
        }

        // ─────────────────────────────────────────────────────────────────
        // EDUCATION CATEGORY GROUPED SEARCH  (education table)
        // "college" → College Graduate, College Level grouped
        // "vocational" → all vocational categories grouped
        // ─────────────────────────────────────────────────────────────────
        const educCatPatternMap = [
          { test: /^COLLEGE$|^COLLEGIATE$|^TERTIARY$|^UNIVERSITY$/,       pattern: "College",     grouped: true  },
          { test: /^HIGH\s*SCHOOL$|^HIGHSCHOOL$|^SECONDARY$/,             pattern: "High School", grouped: true  },
          { test: /^ELEMENTARY$|^ELEM$|^PRIMARY$|^GRADE\s*SCHOOL$/,       pattern: "Elementary",  grouped: true  },
          { test: /^VOCATIONAL$|^VOCATION$|^TVET$|^TECH.?VOC$|^TESDA$/,  pattern: "Vocational",  grouped: true  },
          { test: /^EDUCATION$|^EDUC$|^CATEGORY$|^CATEGORIES$/,           pattern: "",            grouped: true  },
        ];

        let educCatPattern = null;
        let educCatGrouped = false;
        for (const ep of educCatPatternMap) {
          if (ep.test.test(qNorm)) {
            educCatPattern = ep.pattern;
            educCatGrouped = ep.grouped;
            break;
          }
        }

        if (levelPattern !== null) {
          isKeyword = true;
          staffSearchQuery = null;

          if (levelGrouped) {
            // Fetch ALL matching levels from DB and group display
            const rows = await fetchEduLevelRows(levelPattern);
            if (rows.length > 0) {
              groupMeta = rows; // [{id, name}]
              searchGroupMode = "EDUCATION_LEVEL";
              benQuery = benQuery.in("education_level_id", rows.map(r => r.id));
            } else {
              benQuery = benQuery.eq("education_level_id", -999);
            }
          } else {
            // Specific single level
            const rows = await fetchEduLevelRows(levelPattern);
            if (rows.length > 0) {
              groupMeta = rows;
              searchGroupMode = "EDUCATION_LEVEL";
              benQuery = benQuery.in("education_level_id", rows.map(r => r.id));
            } else {
              benQuery = benQuery.eq("education_level_id", -999);
            }
          }

        } else if (educCatPattern !== null) {
          isKeyword = true;
          staffSearchQuery = null;

          const rows = await fetchEducRows(educCatPattern);
          if (rows.length > 0) {
            groupMeta = rows;
            searchGroupMode = "EDUCATION_CAT";
            benQuery = benQuery.in("educ_id", rows.map(r => r.id));
          } else {
            benQuery = benQuery.eq("educ_id", -999);
          }

        } else {
          // ── Free-text: also search education/education_levels names in DB ──
          // This allows typing partial education names to be treated as edu search
          const [eduRows, lvlRows] = await Promise.all([
            fetchEducRows(safeQuery),
            fetchEduLevelRows(safeQuery),
          ]);

          if (eduRows.length > 0 || lvlRows.length > 0) {
            isKeyword = true;
            staffSearchQuery = null;

            if (lvlRows.length > 0 && eduRows.length === 0) {
              groupMeta = lvlRows;
              searchGroupMode = "EDUCATION_LEVEL";
              benQuery = benQuery.in("education_level_id", lvlRows.map(r => r.id));
            } else if (eduRows.length > 0 && lvlRows.length === 0) {
              groupMeta = eduRows;
              searchGroupMode = "EDUCATION_CAT";
              benQuery = benQuery.in("educ_id", eduRows.map(r => r.id));
            } else {
              // Both found — combine (flat list, show both badges)
              const allEduLvlIds = lvlRows.map(r => r.id);
              const allEduIds    = eduRows.map(r => r.id);
              groupMeta = [...eduRows, ...lvlRows];
              searchGroupMode = "EDUCATION_CAT";
              benQuery = benQuery.or(
                `educ_id.in.(${allEduIds.join(",")}),education_level_id.in.(${allEduLvlIds.join(",")})`
              );
            }
          }
        }
      } // end else (education level / category keywords)

      let beneficiaries = [];
      let staffResults  = [];

      // ── Execute Queries ──
      if (isKeyword) {
        if (benQuery) {
          if (roleId === 2) benQuery = benQuery.eq("staffs.office_id", officeId);
          const { data, error } = await benQuery.limit(2000);
          if (error) throw error;
          beneficiaries = data || [];
        }
        if (staffSearchQuery) {
          const { data, error } = await staffSearchQuery.limit(1000);
          if (error) throw error;
          staffResults = data || [];
        }
      } else {
        if (roleId === 2) {
          benQuery = benQuery.eq("staffs.office_id", officeId).or(`full_name.ilike.%${safeQuery}%,address.ilike.%${safeQuery}%,designated.ilike.%${safeQuery}%`);
        } else {
          if (officeIds.length > 0) {
            const { data: staffsInOffice } = await supabase.from("staffs").select("id").in("office_id", officeIds);
            const sIds = (staffsInOffice || []).map(s => s.id);
            if (sIds.length > 0) {
              benQuery = benQuery.or(`full_name.ilike.%${safeQuery}%,address.ilike.%${safeQuery}%,designated.ilike.%${safeQuery}%,staff_id.in.(${sIds.join(",")})`);
            } else {
              benQuery = benQuery.or(`full_name.ilike.%${safeQuery}%,address.ilike.%${safeQuery}%,designated.ilike.%${safeQuery}%`);
            }
          } else {
            benQuery = benQuery.or(`full_name.ilike.%${safeQuery}%,address.ilike.%${safeQuery}%,designated.ilike.%${safeQuery}%`);
          }
        }

        const { data: benData, error: benError } = await benQuery.limit(500);
        if (benError) throw benError;
        beneficiaries = benData || [];

        if (staffSearchQuery) {
          if (officeIds.length > 0) {
            staffSearchQuery = staffSearchQuery.or(`full_name.ilike.%${safeQuery}%,office_id.in.(${officeIds.join(",")})`).limit(10);
          } else {
            staffSearchQuery = staffSearchQuery.ilike("full_name", `%${safeQuery}%`).limit(10);
          }
          const { data: staffs } = await staffSearchQuery;
          if (staffs) staffResults = staffs;
        }
      }

      renderSearchDashboard(query, beneficiaries || [], staffResults, { searchGroupMode, groupMeta });

    } catch (err) {
      console.error("[Search Error]", err);
      resultsContainer.innerHTML = `<div class="p-4 text-center text-sm text-red-500 font-bold">Failed to perform search.</div>`;
    }
  }

  function renderSearchDashboard(query, beneficiaries, staffs, opts) {
    const searchGroupMode = opts?.searchGroupMode || null;
    const groupMeta       = opts?.groupMeta       || [];

    if (beneficiaries.length === 0 && staffs.length === 0) {
      // Build keyword hint chips — using string concatenation to avoid nested template literals
      const kwGroups = [
        { label: "Gender",      chips: ["Male", "Female"] },
        { label: "Status",      chips: ["New", "Returning", "Ongoing"] },
        { label: "Junior High", chips: ["Grade 7", "Grade 8", "Grade 9", "Grade 10"] },
        { label: "Senior High", chips: ["Grade 11", "Grade 12"] },
        { label: "College",     chips: ["1st Year", "2nd Year", "3rd Year", "4th Year"] },
        { label: "Category",    chips: ["Vocational", "JHS", "SHS", "College"] },
        { label: "Records",     chips: ["Total", "SPES", "Implementors"] },
        { label: "Approval",    chips: ["Approved", "Pending"] },
      ];
      let kwHtml = "";
      kwGroups.forEach(function(grp) {
        let chipHtml = "";
        grp.chips.forEach(function(c) {
          chipHtml += "<button data-kw-chip=\"" + c + "\""
            + " class=\"cursor-pointer text-[0.5625rem] px-2 py-0.5 rounded bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-600 dark:text-gray-300 font-bold hover:bg-spes-blue hover:text-white dark:hover:bg-spes-yellow dark:hover:text-spes-dark-primary transition-all uppercase tracking-wide\">"
            + c + "</button>";
        });
        kwHtml += "<div class=\"p-2 bg-gray-50 dark:bg-white/5 rounded-lg border border-gray-100 dark:border-white/5\">"
          + "<p class=\"text-[0.5rem] font-black uppercase tracking-widest text-spes-blue dark:text-spes-yellow mb-1.5\">" + grp.label + "</p>"
          + "<div class=\"flex flex-wrap gap-1\">" + chipHtml + "</div></div>";
      });

      resultsContainer.innerHTML =
        "<div class=\"bg-white dark:bg-spes-dark-secondary p-8 rounded-none shadow-2xl border border-gray-200 dark:border-white/10 w-full text-center\">"
        + "<svg class=\"h-12 w-12 mx-auto text-gray-400 mb-4\" fill=\"none\" viewBox=\"0 0 24 24\" stroke=\"currentColor\" stroke-width=\"1.5\">"
        + "<path stroke-linecap=\"round\" stroke-linejoin=\"round\" d=\"M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z\"/></svg>"
        + "<div class=\"text-sm text-gray-500 dark:text-gray-400 font-bold uppercase tracking-widest\">No results for &ldquo;" + query + "&rdquo;</div>"
        + "<p class=\"text-[0.625rem] text-gray-400 dark:text-white/40 mt-2 mb-5 font-semibold uppercase tracking-wider\">Try a keyword below for quick stats</p>"
        + "<div class=\"grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-left max-w-2xl mx-auto\">" + kwHtml + "</div>"
        + "</div>";

      // Attach click handlers to chips
      resultsContainer.querySelectorAll("[data-kw-chip]").forEach(function(btn) {
        btn.addEventListener("click", function() {
          var kw = btn.getAttribute("data-kw-chip");
          var inp = document.getElementById("global-search-input");
          if (inp) { inp.value = kw; inp.dispatchEvent(new Event("input")); }
          var frm = document.getElementById("global-search-form");
          if (frm) frm.dispatchEvent(new Event("submit"));
        });
      });
      return;
    }



    const timestamp = new Date().toLocaleString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true 
    });

    resultsContainer.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 w-full">
         <!-- Left Card: Chart (Output Visual) -->
         <div class="bg-white dark:bg-spes-dark-secondary p-8 rounded-none border border-gray-200 dark:border-white/10 shadow-2xl shadow-black/10 dark:shadow-black/40 flex flex-col justify-between">
            <div>
               <div class="flex items-center justify-between mb-6">
                  <h4 id="search-chart-title" class="text-xs font-black uppercase tracking-[0.2em] text-spes-blue dark:text-spes-yellow">Gender Distribution</h4>
                  <div class="flex items-center gap-2 bg-white dark:bg-spes-dark-secondary rounded-lg p-1 border border-gray-100 dark:border-white/5 shadow-xs">
                     <button id="btn-search-chart-gender" class="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[0.5625rem] font-black uppercase tracking-wider rounded-md transition-all bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-primary shadow-xs">
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                           <path stroke-linecap="round" stroke-linejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"/>
                        </svg>
                        <span>Gender</span>
                     </button>
                     <button id="btn-search-chart-total" class="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[0.5625rem] font-black uppercase tracking-wider rounded-md transition-all text-gray-500 hover:text-spes-blue dark:text-gray-400 dark:hover:text-spes-yellow">
                        <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                           <path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 002 2h2a2 2 0 002-2z"/>
                        </svg>
                        <span>Status</span>
                     </button>
                  </div>
               </div>
               
               <div class="relative flex items-center justify-center min-h-[250px] py-2">
                  <div id="search-donut-chart" class="w-full"></div>
               </div>
            </div>
            
            <p class="text-[0.5625rem] font-bold text-gray-400 dark:text-white/30 uppercase tracking-widest text-center mt-4 pt-4 border-t border-gray-100 dark:border-white/5 leading-relaxed">
               • Showing aggregated analytics based on your search criteria. Data is dynamically cached for optimized performance.
            </p>
         </div>
         
         <!-- Right Card: List Details (Modernized Box Cards) -->
         <div class="bg-spes-blue dark:bg-spes-dark-primary rounded-none shadow-2xl shadow-spes-blue/20 dark:shadow-black/40 border border-transparent overflow-hidden flex flex-col justify-between min-h-[420px]">
            <!-- Header -->
            <div class="p-6 text-white flex flex-col gap-1 border-b border-white/10 bg-linear-to-r from-spes-blue to-[#002878] dark:from-spes-dark-primary dark:to-[#0A0A0A]">
               <div class="flex items-center justify-between">
                  <div class="flex items-center gap-3">
                     <img src="/c_spes.png" class="h-10 w-10 rounded-full bg-white/10 p-1 object-cover" alt="Logo" />
                     <div>
                        <h4 class="text-base font-black uppercase tracking-wider font-montserrat">Extra Stats</h4>
                        <p class="text-[0.625rem] text-white/70 font-semibold tracking-wide">Keyword: "<span id="search-keyword-display" class="font-bold text-spes-yellow">${query}</span>"</p>
                     </div>
                  </div>
                  <div class="text-[0.5625rem] bg-white/10 px-2.5 py-1 rounded-sm font-bold uppercase tracking-wider text-right" id="search-timestamp">
                     ${timestamp}
                  </div>
               </div>
            </div>
            
            <!-- List Body -->
            <div id="search-results-list" class="flex-1 p-6 overflow-y-auto max-h-[320px] space-y-3 bg-white dark:bg-spes-dark-secondary">
               <!-- Injected items -->
            </div>
            
            <!-- Footer -->
            <div class="p-4 bg-gray-50 dark:bg-white/5 border-t border-gray-100 dark:border-white/5 text-center flex flex-col gap-1">
               <span class="text-[0.5625rem] font-black uppercase tracking-[0.2em] text-gray-400 dark:text-white/30">End of Report</span>
               <span class="text-[8px] font-bold uppercase tracking-widest text-gray-300 dark:text-white/20">Generated by 2026 GIP Monitor</span>
            </div>
         </div>
      </div>`;

    // Populate List
    const listContainer = document.getElementById("search-results-list");
    let listHtml = "";
    
    // Highlight helper
    const highlight = (text, q) => {
      if (!text) return "N/A";
      const regex = new RegExp(`(${q})`, "gi");
      return text.toString().replace(regex, `<mark class="search-highlight-match bg-spes-yellow text-spes-dark-primary px-1 rounded font-bold transition-all duration-500">$1</mark>`);
    };

    if (beneficiaries.length > 0) {
      if (searchGroupMode && groupMeta.length > 0) {
        // ── GROUPED MODE: show summary cards per education category / level ──
        // Map group id → array of beneficiaries
        const groupBuckets = {};
        const getBucketKey = (b) => {
          if (searchGroupMode === "EDUCATION_LEVEL") return b.education_level_id;
          return b.educ_id; // EDUCATION_CAT
        };
        const groupMetaMap = {};
        groupMeta.forEach(g => {
          groupBuckets[g.id] = [];
          groupMetaMap[g.id] = g.name;
        });
        // Uncategorized bucket
        let uncatBucket = [];

        beneficiaries.forEach(b => {
          const key = getBucketKey(b);
          if (key != null && groupBuckets[key] !== undefined) {
            groupBuckets[key].push(b);
          } else {
            uncatBucket.push(b);
          }
        });

        listHtml += `<h5 class="text-[0.625rem] font-black uppercase tracking-[0.2em] text-spes-blue dark:text-spes-yellow mb-3 mt-0">
          ${searchGroupMode === "EDUCATION_LEVEL" ? "By Grade / Year Level" : "By Education Category"}
          <span class="ml-2 font-normal text-gray-400">(Total: ${beneficiaries.length})</span>
        </h5>`;

        // Sort group meta by name for display
        const sortedMeta = [...groupMeta].sort((a, b) => a.name.localeCompare(b.name));

        sortedMeta.forEach(grp => {
          const bucket = groupBuckets[grp.id] || [];
          const total  = bucket.length;
          if (total === 0) return;
          const males   = bucket.filter(b => b.gender_id === 1).length;
          const females = bucket.filter(b => b.gender_id === 2).length;
          const newC    = bucket.filter(b => !b.return_status || b.return_status.toUpperCase() !== "SPES BABY").length;
          const retC    = bucket.filter(b => b.return_status && b.return_status.toUpperCase() === "SPES BABY").length;

          // Compact list preview (max 5)
          let previewHtml = "";
          bucket.slice(0, 5).forEach(b => {
            let officeName = "N/A";
            if (b.staffs && b.staffs.offices) {
              let ln = b.staffs.offices.name || "N/A";
              officeName = ln.includes("CITY GOVERNMENT OF ILIGAN (LGU)") ? "LGU" : ln.split(" ")[0];
            }
            let officeParam = b.staffs?.office_id ? `&office=${b.staffs.office_id}` : "";
            let batchParam  = b.batch_id ? `&batch=${b.batch_id}` : "";
            const isBaby    = b.return_status && b.return_status.toUpperCase() === "SPES BABY";
            const dotColor  = isBaby ? "bg-[#FF5B9B]" : "bg-emerald-500";
            previewHtml += `<a href="../beneficiaries/?b=${b.id}${officeParam}${batchParam}" class="cursor-pointer flex items-center gap-1.5 py-1 hover:opacity-75 transition-opacity">
              <span class="h-1.5 w-1.5 rounded-full ${dotColor} shrink-0"></span>
              <span class="text-[0.5625rem] font-bold uppercase text-spes-black dark:text-white truncate">${b.full_name}</span>
              <span class="text-[0.5rem] text-gray-400 dark:text-gray-500 shrink-0 ml-auto">${officeName}</span>
            </a>`;
          });
          if (bucket.length > 5) {
            previewHtml += `<p class="text-[0.5rem] text-gray-400 dark:text-white/30 font-bold uppercase tracking-widest mt-1">+ ${bucket.length - 5} more</p>`;
          }

          listHtml += `
            <div class="rounded-xl border border-gray-100 dark:border-white/5 overflow-hidden mb-3">
              <!-- Group Header -->
              <div class="flex items-center justify-between px-3 py-2 bg-spes-blue/5 dark:bg-spes-yellow/5 border-b border-gray-100 dark:border-white/5">
                <span class="text-[0.625rem] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow">${grp.name}</span>
                <span class="text-[0.625rem] font-black text-spes-black dark:text-white">${total.toLocaleString()} <span class="font-normal text-gray-400">beneficiaries</span></span>
              </div>
              <!-- Stats Row -->
              <div class="grid grid-cols-4 divide-x divide-gray-100 dark:divide-white/5 bg-gray-50 dark:bg-white/[0.02]">
                <div class="text-center py-1.5 px-1">
                  <p class="text-[0.5rem] font-bold uppercase tracking-widest text-gray-400 dark:text-white/30">Male</p>
                  <p class="text-xs font-black text-spes-black dark:text-white">${males}</p>
                </div>
                <div class="text-center py-1.5 px-1">
                  <p class="text-[0.5rem] font-bold uppercase tracking-widest text-gray-400 dark:text-white/30">Female</p>
                  <p class="text-xs font-black text-spes-black dark:text-white">${females}</p>
                </div>
                <div class="text-center py-1.5 px-1">
                  <p class="text-[0.5rem] font-bold uppercase tracking-widest text-emerald-400/80">New</p>
                  <p class="text-xs font-black text-emerald-600 dark:text-emerald-400">${newC}</p>
                </div>
                <div class="text-center py-1.5 px-1">
                  <p class="text-[0.5rem] font-bold uppercase tracking-widest text-[#FF5B9B]/80">Return</p>
                  <p class="text-xs font-black text-[#FF5B9B]">${retC}</p>
                </div>
              </div>
              <!-- Mini List Preview -->
              ${previewHtml ? `<div class="px-3 py-2 bg-white dark:bg-spes-dark-secondary space-y-0 divide-y divide-gray-50 dark:divide-white/5">${previewHtml}</div>` : ""}
            </div>`;
        });

        if (uncatBucket.length > 0) {
          listHtml += `<p class="text-[0.5rem] text-gray-400 dark:text-white/30 font-bold uppercase tracking-widest mt-2">+ ${uncatBucket.length} uncategorized</p>`;
        }

      } else {
        // ── FLAT MODE: original per-beneficiary list ──
        listHtml += `<h5 class="text-[0.625rem] font-black uppercase tracking-[0.2em] text-spes-blue dark:text-spes-yellow mb-2 mt-4 first:mt-0">SPES List (${beneficiaries.length})</h5>`;
        beneficiaries.forEach(b => {
          let officeName = "N/A";
          if (b.staffs && b.staffs.offices) {
            let longName = b.staffs.offices.name || "N/A";
            officeName = longName.includes("CITY GOVERNMENT OF ILIGAN (LGU)") ? "LGU - ILIGAN" : longName;
          }

          const isSpesBaby = b.return_status && b.return_status.toUpperCase() === "SPES BABY";
          const statusClass = isSpesBaby ? "bg-[#FF5B9B]/10 text-[#FF5B9B]" : "bg-emerald-500/10 text-emerald-500";
          const statusLabel = isSpesBaby ? "RETURNING" : "ONGOING";

          const eduLevelName = b.education_level?.name || null;
          const eduCatName   = b.education?.name || null;
          const eduBadge = eduLevelName
            ? `<span class="ml-1.5 text-[0.5rem] px-1.5 py-0.5 rounded bg-spes-blue/10 text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow font-black uppercase tracking-wider">${eduLevelName}</span>`
            : eduCatName
              ? `<span class="ml-1.5 text-[0.5rem] px-1.5 py-0.5 rounded bg-spes-blue/10 text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow font-black uppercase tracking-wider">${eduCatName}</span>`
              : "";

          let officeParam = "";
          if (b.staffs && b.staffs.office_id) officeParam = `&office=${b.staffs.office_id}`;
          let batchParam = "";
          if (b.batch_id) batchParam = `&batch=${b.batch_id}`;

          listHtml += `
            <a href="../beneficiaries/?b=${b.id}${officeParam}${batchParam}" class="cursor-pointer block flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 hover:border-spes-blue/40 hover:scale-[1.01] transition-all duration-200">
               <div class="flex-1 min-w-0 mr-2">
                  <div class="text-xs font-black uppercase text-spes-black dark:text-white tracking-wide truncate">${highlight(b.full_name, query)}</div>
                  <div class="flex items-center flex-wrap gap-x-1 text-[0.625rem] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider mt-0.5">
                    <span>${highlight(officeName, query)}</span>${eduBadge}
                  </div>
               </div>
               <span class="shrink-0 text-[0.5625rem] px-2.5 py-1 rounded font-black uppercase tracking-wider ${statusClass}">
                  SPES - ${statusLabel}
               </span>
            </a>`;
        });
      }
    }

    if (staffs.length > 0) {
      listHtml += `<h5 class="text-[0.625rem] font-black uppercase tracking-[0.2em] text-spes-blue dark:text-spes-yellow mb-2 mt-4 first:mt-0">Implementors (${staffs.length})</h5>`;
      staffs.forEach(s => {
        let officeName = "N/A";
        if (s.offices) {
          let longName = s.offices.name || "N/A";
          officeName = longName.includes("CITY GOVERNMENT OF ILIGAN (LGU)") ? "LGU - ILIGAN" : longName;
        }

        // Fix boolean TRUE showing instead of APPROVED
        const isApproved = s.approved === true || s.approved === "Approved" || s.approved === "TRUE";
        const statusClass = isApproved
          ? "bg-spes-blue/10 text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow"
          : "bg-amber-500/10 text-amber-500";
        const statusText = isApproved ? "APPROVED" : "PENDING";

        listHtml += `
          <a href="../implementors/?id=${s.id}" class="cursor-pointer block flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-100 dark:border-white/5 hover:border-spes-yellow/40 hover:scale-[1.01] transition-all duration-200">
             <div>
                <div class="text-xs font-black uppercase text-spes-black dark:text-white tracking-wide">${highlight(s.full_name, query)}</div>
                <div class="text-[0.625rem] text-gray-400 dark:text-gray-500 font-bold uppercase tracking-wider mt-0.5">${highlight(officeName, query)}</div>
             </div>
             <span class="text-[0.5625rem] px-2.5 py-1 rounded font-black uppercase tracking-wider ${statusClass}">
                STAFF - ${statusText}
             </span>
          </a>
        `;
      });
    }

    listContainer.innerHTML = listHtml;
    
    setTimeout(() => {
      document.querySelectorAll('.search-highlight-match').forEach(el => {
        el.className = "underline decoration-emerald-500 decoration-2 font-bold text-emerald-600 dark:text-emerald-400 bg-transparent transition-all duration-500";
      });
    }, 2000);

    // Chart Configuration Helper
    let chartMode = "GENDER"; // "GENDER" | "TOTAL" | "GROUP"

    // Color palette for group breakdown
    const groupColors = ["#0038A8","#EFB800","#4F91FF","#FF5B9B","#10B981","#F59E0B","#6366F1","#EC4899","#14B8A6","#F97316","#8B5CF6","#84CC16"];

    const getChartOptions = (mode) => {
      let series = [];
      let labels = [];
      let colors = [];
      let totalLabel = "TOTAL SPES";

      if (mode === "GROUP" && searchGroupMode && groupMeta.length > 0) {
        // Grouped mode: one slice per group
        const sortedMeta = [...groupMeta].sort((a, b) => a.name.localeCompare(b.name));
        sortedMeta.forEach((grp, idx) => {
          const cnt = beneficiaries.filter(b => {
            if (searchGroupMode === "EDUCATION_LEVEL") return b.education_level_id === grp.id;
            return b.educ_id === grp.id;
          }).length;
          if (cnt > 0) {
            series.push(cnt);
            labels.push(grp.name.toUpperCase());
            colors.push(groupColors[idx % groupColors.length]);
          }
        });
        totalLabel = "TOTAL";

      } else if (mode === "GENDER") {
        let male = 0;
        let female = 0;
        beneficiaries.forEach(b => {
          if (b.gender_id === 1) male++;
          else if (b.gender_id === 2) female++;
        });
        series = [male, female];
        labels = ["MALE", "FEMALE"];
        colors = ["#4F91FF", "#FF5B9B"];
        totalLabel = "TOTAL SPES";
      } else {
        // Status breakdown
        let news = 0;
        let returning = 0;
        beneficiaries.forEach(b => {
          if (b.return_status && b.return_status.toUpperCase() === "SPES BABY") returning++;
          else news++;
        });
        series = [news, returning];
        labels = ["NEW", "RETURNING"];
        colors = ["#10B981", "#EF4444"];
        totalLabel = "AGGREGATE";
      }

      return {
        series,
        chart: { type: "donut", height: 240, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
        labels,
        colors,
        legend: { position: "bottom", fontWeight: 800, fontSize: "10px" },
        stroke: { show: false },
        dataLabels: { enabled: false },
        tooltip: { enabled: false },
        plotOptions: {
          pie: {
            donut: {
              size: "72%",
              labels: {
                show: true,
                name:  { show: true, fontSize: "9px", fontWeight: 700, offsetY: -5, color: "#64748b" },
                value: { show: true, fontSize: "16px", fontWeight: 900, offsetY: 5, formatter: (v) => Number(v).toLocaleString() },
                total: {
                  show: true,
                  label: totalLabel,
                  fontSize: "8px",
                  fontWeight: 900,
                  color: "#0038A8",
                  formatter: (w) => w.globals.seriesTotals.reduce((a, b) => a + b, 0).toLocaleString()
                }
              }
            }
          }
        }
      };
    };

    const renderChartInstance = (mode) => {
      if (currentApexChart) {
        currentApexChart.destroy();
      }
      const el = document.getElementById("search-donut-chart");
      if (el) {
        currentApexChart = new ApexCharts(el, getChartOptions(mode));
        currentApexChart.render();
      }
    };

    // Render Initial Chart
    renderChartInstance(chartMode);

    // Switcher Logic
    const btnGender = document.getElementById("btn-search-chart-gender");
    const btnTotal = document.getElementById("btn-search-chart-total");
    const titleEl = document.getElementById("search-chart-title");

    const activeClass = "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-primary shadow-xs font-black";
    const inactiveClass = "text-gray-500 hover:text-spes-blue dark:text-gray-400 dark:hover:text-spes-yellow";

    btnGender?.addEventListener("click", () => {
      if (chartMode === "GENDER") return;
      chartMode = "GENDER";
      if (titleEl) titleEl.textContent = "Gender Distribution";
      btnGender.className = `cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[0.5625rem] uppercase tracking-wider rounded-md transition-all ${activeClass}`;
      btnTotal.className = `cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[0.5625rem] uppercase tracking-wider rounded-md transition-all ${inactiveClass}`;
      renderChartInstance(chartMode);
    });

    btnTotal?.addEventListener("click", () => {
      if (chartMode === "TOTAL") return;
      chartMode = "TOTAL";
      if (titleEl) titleEl.textContent = "Status Breakdown";
      btnGender.className = `cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[0.5625rem] uppercase tracking-wider rounded-md transition-all ${inactiveClass}`;
      btnTotal.className = `cursor-pointer flex items-center gap-1.5 px-3 py-1.5 text-[0.5625rem] uppercase tracking-wider rounded-md transition-all ${activeClass}`;
      renderChartInstance(chartMode);
    });
  }
}
