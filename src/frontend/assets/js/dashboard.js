/**
 * SPES Portal — Dashboard Entry Script
 * ──────────────────────────────────────
 * All data comes from Supabase. No mock fallbacks.
 */
import "../styles/tailwind.css";
import "flowbite";
import { applyPermissions, highlightSidebarActiveLink, requireAuth, signOut } from "./rbac/guard.js";
import { getOfficeAccessScope } from "./rbac/scope.js";
import { supabase } from "../../../backend/api/supabase.js";
import { fetchImplementorList, invalidateImplementorCache } from "../../../backend/api/auth.js";
import { updateStaff, archiveStaff, unarchiveStaff, fetchOffices, fetchRoles, updateStaffApprovalBulk } from "../../../backend/api/staff.js";
import { fetchStaffPermissions, upsertStaffPermissions } from "../../../backend/api/permissions.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initFlowbite } from "flowbite";
import { initDashboardCharts, setDashboardPeriodFilter, exportDashboardStats } from "./components/charts.js";
import { modals } from "./components/modals.js";
import { initBeneficiaries } from "./components/beneficiaries.js";
import { setupSortFiltration } from "./components/sort-filtration.js";
import { initImplementorsDrawer, initAddImplementorDrawer } from "./components/drawer.js";
import Swal from "sweetalert2";
import { initQuickAccessCarousel, initQuickAccessPremiumInteractions } from "./components/animations.js";
import { applyTextSize } from "./components/settings.js";
import { flowDebug, flowDebugError, flowDebugSuccess } from "./components/flow-debugger.js";
import { preferenceStorage } from "./components/storage.js";

const ROLE_PERMISSION_DESCRIPTIONS = {
  "users:view": "View the implementor directory for the user’s assigned office.",
  "offices:view-other": "View implementors and beneficiaries from other offices in read-only mode.",
  "analytics:view-global": "View overall dashboard charts across all offices while the gender donut remains limited to the assigned office.",
  "users:create": "Create new implementor accounts only within the user’s assigned office.",
  "users:edit": "Edit and approve implementors only within the user’s assigned office.",
  "users:delete": "Archive implementors only within the user’s assigned office.",
  "reports:export": "Include other permitted offices in exports; approved users can always export their own office data.",
  "payroll:view": "View and access the SPES Payroll system for the user’s assigned office.",
};

function setDashboardDocumentTitle(user) {
  if (!window.location.pathname.includes("/dashboard/")) return;

  const rawRole = String(user?.role_label || user?.role || "Staff")
    .trim()
    .replace(/[_-]+/g, " ");
  const roleLabel = rawRole
    ? rawRole.replace(/\b\w/g, (character) => character.toUpperCase())
    : "Staff";

  document.title = `${roleLabel} Dashboard | SPES Portal`;
}

// ── DEV: Supabase connection debug ────────────────────────────
if (import.meta.env.DEV) {
  const debugUrl = import.meta.env.VITE_SUPABASE_URL;
  const debugKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const debugPage = window.location.pathname.split("/").filter(Boolean).at(-2) ?? "unknown";
  const debugStartedAt = performance.now();

  console.group(`[SPES Debug] Supabase — ${debugPage}`);
  console.log("[config] Environment:", import.meta.env.MODE);
  console.log("[config] Page:", debugPage);
  console.log("[config] Route:", window.location.pathname);
  console.log("[config] URL:", debugUrl ? `${debugUrl.slice(0, 30)}…` : "⚠ MISSING");
  console.log("[config] Key:", debugKey ? `${debugKey.slice(0, 12)}…` : "⚠ MISSING");
  console.log("[client] Supabase client:", supabase ? "✓ created" : "✗ null");
  console.log("[workflow] Boot sequence:", [
    "create Supabase client",
    "ping staffs and beneficiary tables",
    "authenticate session",
    "load permissions and page data",
    "render the current page",
  ]);

  const runDebugPing = async (table, label) => {
    const startedAt = performance.now();
    console.group(`[query] ${label}`);
    console.log("function:", "supabase.from().select()", "table:", table);
    console.log("request:", { table, select: "id", count: "exact" });
    try {
      const response = await supabase.from(table).select("id", { count: "exact" });
      const durationMs = Math.round(performance.now() - startedAt);
      if (response.error) {
        console.error("result: ERROR", {
          table,
          durationMs,
          error: response.error,
        });
      } else {
        console.log("result: OK", {
          table,
          rowCount: response.count,
          durationMs,
          dataRowsReturned: response.data?.length ?? 0,
        });
      }
      console.groupEnd();
      return { table, ...response, durationMs };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      console.error("result: EXCEPTION", { table, durationMs, error });
      console.groupEnd();
      return { table, error, durationMs };
    }
  };

  Promise.all([
    runDebugPing("staffs", "Staffs table health check"),
    runDebugPing("beneficiary", "Beneficiary table health check"),
  ]).then((results) => {
    console.log("[workflow] Supabase debug completed", {
      totalDurationMs: Math.round(performance.now() - debugStartedAt),
      results: results.map(({ table, count, error, durationMs }) => ({
        table,
        rowCount: count,
        status: error ? "error" : "ok",
        durationMs,
      })),
    });
    console.groupEnd();
  });
}
// ── Boot ──────────────────────────────────────────────────────
const session = requireAuth();
if (session) {
  setDashboardDocumentTitle(session);
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

  // Fetch this staff account's current individual permissions without requiring relog.
  if (user && user.id) {
    try {
      const { data: freshPerms } = await fetchStaffPermissions(user.id, { forceRefresh: true });
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
  const isApproved = isAdmin || user.approved === true;

  if (path.includes("/beneficiaries/")) {
    if (!isApproved) {
      modals.error("Access Restricted", "Your account is pending approval. You do not have permission to view the Beneficiary Directory.").then(() => {
        window.location.href = "/src/frontend/pages/dashboard/";
      });
      return;
    }
  }

  if (path.includes("/implementors/")) {
    const canViewUsers = isApproved && (isAdmin || (user.permissions && user.permissions.view_users));
    if (!canViewUsers) {
      modals.error("Access Denied", "You do not have permission to view the Implementor Directory.").then(() => {
        window.location.href = "/src/frontend/pages/dashboard/";
      });
      return;
    }
  }

  if (path.includes("/roles/")) {
    const canManageRoles = isApproved && (isAdmin || (user.permissions && (user.permissions.edit_users || user.permissions.view_users || user.permissions.create_users)));
    if (!canManageRoles) {
      modals.error("Access Denied", "You do not have permission to view or manage roles and permissions.").then(() => {
        window.location.href = "/src/frontend/pages/dashboard/";
      });
      return;
    }
  }

  if      (path.includes("/implementors/"))  setActiveSidebarLink("implementor-list");
  else if (path.includes("/roles/"))         setActiveSidebarLink("roles");
  else if (path.includes("/beneficiaries/")) setActiveSidebarLink("beneficiaries");
  else if (path.includes("/dashboard/"))     setActiveSidebarLink("overview");

  await applyPermissions(user.role);

  const nameEl = document.getElementById("header-user-name");
  if (nameEl) nameEl.textContent = user.full_name || "Admin";

  await loadImplementorTable(user.role);
  initStaffActionDropdown();
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

  if (path.includes("/dashboard/")) {
    const viewAllLink = document.getElementById("dashboard-view-all-link");
    if (viewAllLink) {
      if (!isApproved) {
        viewAllLink.classList.add("hidden");
      } else {
        viewAllLink.textContent = user.role === "admin" ? "View All" : "View Yours";
      }
    }
    try {
      const chartMetrics = await initDashboardCharts();
      updateDynamicBadges(chartMetrics?.totalImplementors);
      _loadTimelineMetrics(chartMetrics?.beneficiaries || []);
      initDashboardPeriodSelector(chartMetrics?.periods);
      flowDebugSuccess("Dashboard metrics loaded", {
        totalImplementors: chartMetrics?.totalImplementors ?? 0,
        implementorScope: "global",
        remainingDashboardScope: isAdmin ? "global" : "assigned office",
      });
    } catch (error) {
      flowDebugError("Dashboard metrics failed to load", error);
      updateDynamicBadges();
    }
    _wireExportStatsButtons();
    _wireExportsPageButtons();
    initQuickAccessCarousel();
    initQuickAccessPremiumInteractions();
    await loadRecentBeneficiaries();
    setupDashboardListToggle(user);
    initQuickAccessStatsToggle();
  }
  else {
    updateDynamicBadges();
  }
  if (path.includes("/beneficiaries/")) initBeneficiaries();

  setupRealtimePermissionsListener();
  setupRealtimeApprovalListener();

  document.getElementById("sign-out-btn")?.addEventListener("click", signOut);
  initAutoYear();
  initThemeToggle();
  
  // Apply saved global text size scale
  const savedTextSize = parseInt(localStorage.getItem("spes-text-size") ?? "0", 10) || 0;
  applyTextSize(savedTextSize);

  document.getElementById("staff-checkbox-all")?.addEventListener("change", onSelectAll);
  initSidebarState();
}

// --- START: SIDEBAR STATE INITIALIZER ---
function initSidebarState() {
  // Beneficiaries dropdown: open by default unless cookie explicitly set to false
  const beneBtn = document.querySelector('[aria-controls="sidebar-dropdown-beneficiaries"]');
  const beneUl  = document.getElementById("sidebar-dropdown-beneficiaries");
  if (beneBtn && beneUl) {
    const isBeneOpen = document.cookie.split("; ").find(r => r.startsWith("spes_beneficiaries_open="))?.split("=")[1] !== "false";
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
        const open = !beneUl.classList.contains("hidden");
        document.cookie = `spes_beneficiaries_open=${open}; path=/; max-age=31536000`;
      }, 50);
    });
  }

  // User Management dropdown: closed by default unless cookie explicitly set to true
  const userBtn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  const userUl  = document.getElementById("sidebar-dropdown-users");
  if (userBtn && userUl) {
    const isUserOpen = document.cookie.split("; ").find(r => r.startsWith("spes_user_management_open="))?.split("=")[1] === "true";
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
        const open = !userUl.classList.contains("hidden");
        document.cookie = `spes_user_management_open=${open}; path=/; max-age=31536000`;
      }, 50);
    });
  }
}
// --- END: SIDEBAR STATE INITIALIZER ---

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
  highlightSidebarActiveLink(navId);
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
function isLguIliganOffice(officeName) {
  const normalized = String(officeName || "").toLowerCase().replace(/\(lgu\)/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return normalized === "lgu iligan" || normalized.includes("city government of iligan") || normalized.includes("lace");
}

function isIliganLguOffice(officeName) {
  return isLguIliganOffice(officeName) || String(officeName || "").trim().toLowerCase() === "lace" || String(officeName || "").trim().toLowerCase().includes("lace iligan");
}

function pinSystemAdministratorFirst(items, shouldPin, groupApproval = false, lguOfficeIds = null) {
  const ordered = [...items];
  if (!shouldPin) return ordered;

  const pinned = [];
  const pinnedIds = new Set();
  const takeFirst = (predicate) => {
    const index = ordered.findIndex((item) => !pinnedIds.has(String(item.id)) && predicate(item));
    if (index >= 0) {
      const [item] = ordered.splice(index, 1);
      pinned.push(item);
      pinnedIds.add(String(item.id));
    }
  };

  // 1. Top Pinned: Admin
  takeFirst((item) => 
    String(item.full_name || "").trim().toLowerCase() === "system administrator" || 
    String(item.username || "").trim().toLowerCase() === "admin" ||
    String(item.role || "").toUpperCase() === "ADMIN"
  );

  // 2. Second Pinned: HR / @lace_arrellano
  takeFirst((item) => 
    String(item.username || "").trim().toLowerCase() === "lace_arrellano" ||
    String(item.username || "").trim().toLowerCase().includes("lace") ||
    (lguOfficeIds instanceof Set
      ? lguOfficeIds.has(String(item.office_id)) || isLguIliganOffice(item.office)
      : isIliganLguOffice(item.office))
  );

  if (!groupApproval) return [...pinned, ...ordered];

  // Approved users first (A-Z), then unapproved users (A-Z)
  const approved = ordered
    .filter((item) => item.approved === true)
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), undefined, { sensitivity: "base" }));
  const unapproved = ordered
    .filter((item) => item.approved !== true)
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || ""), undefined, { sensitivity: "base" }));

  return [...pinned, ...approved, ...unapproved];
}
let allImplementors = [];
let allStaffPermissions = {};
const selectedPermissionStaffIds = new Set();
const paginationStorageKey = window.location.pathname.includes("/roles/")
  ? "roles"
  : "implementors";
let currentPage = preferenceStorage.getPaginationPage(paginationStorageKey) || 1;
let rowsPerPage = 10;

async function loadImplementorTable(userRole) {
  const isRolesPage = window.location.pathname.includes("/roles/");
  const isImplPage = window.location.pathname.includes("/implementors/");

  flowDebug("FLOW", "loadImplementorTable started", {
    function: "loadImplementorTable",
    page: isRolesPage ? "roles" : (isImplPage ? "implementors" : "dashboard"),
    userRole: String(userRole || "unknown"),
    rowsPerPage,
  });

  // Fetch implementors from DB. Force refresh if on management pages to avoid caching delays.
  const data = await fetchImplementorList({ forceRefresh: isRolesPage || isImplPage });
  let rolesLguOfficeIds = null;
  if (isRolesPage) {
    const { data: offices = [] } = await fetchOffices({ forceRefresh: true });
    rolesLguOfficeIds = new Set(
      (offices || [])
        .filter((office) => isLguIliganOffice(office.name))
        .map((office) => String(office.id))
    );
  }

  const compareStaffNames = (a, b) => String(a.full_name || "").localeCompare(
    String(b.full_name || ""),
    undefined,
    { sensitivity: "base" }
  );
  const defaultStaffData = isRolesPage
    ? [...data].sort(compareStaffNames)
    : data;

  // Roles has no filter trigger, so its sort-filtration setup can return early.
  // Prepare the complete ordered list here so pinned rows are paginated correctly.
  allImplementors = isRolesPage
    ? pinSystemAdministratorFirst(defaultStaffData, true, true, rolesLguOfficeIds)
    : data;

  flowDebug("DATA", "Implementor list prepared", {
    function: "loadImplementorTable",
    fetchedCount: data.length,
    lguOfficeIds: rolesLguOfficeIds ? [...rolesLguOfficeIds] : [],
    firstRows: allImplementors.slice(0, rowsPerPage).map((staff) => ({
      id: staff.id,
      name: staff.full_name,
      office: staff.office,
    })),
  });
  // The implementor query includes each staff account's individual permissions.
  if (isRolesPage) {
    allStaffPermissions = Object.fromEntries(
      data.map((staff) => [staff.id, staff.permissions || {}])
    );
  }

  setupSortFiltration({
    tableId:         "staff-table-body",
    btnSortId:       "btn-sort-staff",
    dropdownSortId:  "dropdown-sort-staff",
    btnFilterId:     "btn-filter-staff",
    dropdownFilterId:"dropdown-filter-staff",
    originalData:    defaultStaffData,
    defaultFilters:  { archiveStatus: "active" },
    initialSort: isRolesPage ? "name-asc" : "none",
    sortComparator: (a, b, sort) => {
      if (sort !== "name-asc" && sort !== "name-desc") return 0;
      const aValue = isRolesPage ? String(a.full_name || "") : String(a.office || "");
      const bValue = isRolesPage ? String(b.full_name || "") : String(b.office || "");
      const result = aValue.localeCompare(bValue, undefined, { sensitivity: "base" });
      return sort === "name-desc" ? -result : result;
    },
    onRender: (filtered) => {
      allImplementors = pinSystemAdministratorFirst(
        filtered,
        isImplPage || isRolesPage,
        isRolesPage || (isImplPage && String(userRole || "").toLowerCase() === "admin"),
        rolesLguOfficeIds
      );
      currentPage = preferenceStorage.getPaginationPage(paginationStorageKey) || 1;

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

}

// ── Dynamic metric badges ─────────────────────────────────────
function updateDynamicBadges(globalImplementorTotal = null) {
  const staffBadge   = document.getElementById("badge-staff-metric");
  const studentBadge = document.getElementById("badge-student-metric");

  if (staffBadge) {
    const active = allImplementors.filter(s => !s.archive_at);
    const total = Number.isFinite(globalImplementorTotal)
      ? globalImplementorTotal
      : active.length || 0;
    const formattedTotal = Number(total).toLocaleString();
    staffBadge.className = "rounded-full bg-spes-blue/10 px-2.5 py-1 text-[0.625rem] font-black uppercase text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow";
    staffBadge.textContent = `${formattedTotal} TOTAL`;
    flowDebug("OUTPUT", "Total Implementors badge updated", {
      total,
      scope: Number.isFinite(globalImplementorTotal) ? "global" : "current RBAC list",
    });
  }
}

function _loadTimelineMetrics(beneficiaries = []) {
  const totalEl = document.getElementById("metric-total-enrolled");
  const avgEl = document.getElementById("metric-avg-monthly");
  const growthEl = document.getElementById("metric-growth");
  if (!totalEl && !avgEl && !growthEl) return;

  const monthOrder = {
    JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
    JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
  };
  const setUnavailable = () => {
    const empty = '<p class="text-lg font-black text-spes-black/50 dark:text-spes-white/50">N/A</p>';
    if (totalEl) totalEl.innerHTML = empty;
    if (avgEl) avgEl.innerHTML = empty;
    if (growthEl) growthEl.innerHTML = empty;
  };
  if (!Array.isArray(beneficiaries) || beneficiaries.length === 0) {
    setUnavailable();
    return;
  }

  const periodCounts = new Map();
  beneficiaries.forEach((beneficiary) => {
    const year = String(beneficiary.year_period ?? "").trim();
    const month = String(beneficiary.month_period ?? "").trim().toUpperCase();
    if (!/^\d{4}$/.test(year) || monthOrder[month] === undefined) return;
    const key = `${year}-${String(monthOrder[month] + 1).padStart(2, "0")}`;
    periodCounts.set(key, (periodCounts.get(key) || 0) + 1);
  });

  const total = beneficiaries.length;
  const activePeriods = periodCounts.size;
  const average = activePeriods > 0 ? Math.round(total / activePeriods) : null;
  const orderedPeriods = [...periodCounts.entries()].sort(([left], [right]) => left.localeCompare(right));
  const latest = orderedPeriods.at(-1)?.[1];
  const previous = orderedPeriods.at(-2)?.[1];
  const growth = previous > 0 ? Math.round(((latest - previous) / previous) * 100) : null;

  if (totalEl) totalEl.innerHTML = `<p class="text-lg font-black text-spes-blue dark:text-spes-yellow">${total.toLocaleString()}</p>`;
  if (avgEl) avgEl.innerHTML = `<p class="text-lg font-black text-emerald-500">${average == null ? "N/A" : average.toLocaleString()}</p>`;
  if (growthEl) {
    const value = growth == null ? "N/A" : `${growth >= 0 ? "+" : ""}${growth}%`;
    const color = growth == null || growth >= 0 ? "text-spes-blue dark:text-spes-yellow" : "text-rose-500";
    growthEl.innerHTML = `<p class="text-lg font-black ${color}">${value}</p>`;
    growthEl.title = previous > 0 ? "Compared with the preceding recorded employment period" : "Growth requires two recorded employment periods";
  }
}

// --- START: DYNAMIC PAGE SIZE FORMULA (MIN, MED, MAX) ---
function calculatePageSizeOptions(totalCount) {
  const count = Math.max(0, Number(totalCount) || 0);
  const tiers = [5, 10, 25, 50, 100];
  
  let validTiers = tiers.filter(t => t < count);
  if (count > 0 && !validTiers.includes(10) && count >= 10) validTiers.push(10);
  if (count > 5 && count <= 15 && !validTiers.includes(5)) validTiers.push(5);
  
  if (count > 0 && !validTiers.includes(count)) {
    validTiers.push(count);
  }
  
  validTiers = validTiers.filter((val, idx, arr) => arr.indexOf(val) === idx && val > 0).sort((a, b) => a - b);
  
  if (validTiers.length === 0) {
    return [10];
  }
  if (validTiers.length === 1 && count > 0) {
    validTiers.unshift(Math.min(5, count));
    validTiers = validTiers.filter((val, idx, arr) => arr.indexOf(val) === idx);
  }
  
  return validTiers;
}

function renderPageSizeSelector(totalCount, onChangeCallback) {
  const container = document.getElementById("page-size-selector-container");
  const select = document.getElementById("page-size-select");
  if (!container || !select) return;

  const count = Math.max(0, Number(totalCount) || 0);
  if (count === 0) {
    container.classList.add("hidden");
    container.classList.remove("flex");
    return;
  }

  container.classList.remove("hidden");
  container.classList.add("flex");

  const options = calculatePageSizeOptions(count);

  if (!options.includes(rowsPerPage) && rowsPerPage !== count) {
    rowsPerPage = options.includes(10) ? 10 : (options[0] || 10);
  }

  select.innerHTML = options
    .map(opt => {
      const isSelected = opt === rowsPerPage || (rowsPerPage >= count && opt === count);
      const label = opt === count ? `All (${opt})` : opt;
      return `<option value="${opt}" ${isSelected ? "selected" : ""}>${label}</option>`;
    })
    .join("");

  if (select.dataset.listenerBound !== "true") {
    select.dataset.listenerBound = "true";
    select.addEventListener("change", (e) => {
      const val = Number(e.target.value);
      rowsPerPage = val > 0 ? val : (count || 10);
      currentPage = 1;
      if (typeof onChangeCallback === "function") onChangeCallback();
    });
  }
}
// --- END: DYNAMIC PAGE SIZE FORMULA (MIN, MED, MAX) ---

// --- START: UPDATE STAFF PAGE INDICATORS WITH LEFT-1, 2, INPUT, AND RIGHT-LAST ---
function updateStaffPageIndicators(totalCount) {
  const indicatorsEl = document.getElementById("page-indicators-container");
  if (!indicatorsEl) return;
  const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
  currentPage = Math.min(totalPages, Math.max(1, currentPage));
  preferenceStorage.savePaginationPage(paginationStorageKey, currentPage);

  // Update disabled state of Previous and Next buttons
  const prevBtn = document.getElementById("prev-page");
  const nextBtn = document.getElementById("next-page");
  if (prevBtn) prevBtn.toggleAttribute("disabled", currentPage <= 1 || totalPages <= 1);
  if (nextBtn) nextBtn.toggleAttribute("disabled", currentPage >= totalPages || totalPages <= 1);

  let html = "";
  if (totalPages <= 4) {
    for (let p = 1; p <= totalPages; p++) {
      const active = p === currentPage
        ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
        : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
      html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${active}" data-page="${p}" aria-label="Go to page ${p}">${p}</button></li>`;
    }
  } else {
    // Left: Page 1
    const p1Active = currentPage === 1
      ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
      : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
    html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${p1Active}" data-page="1" aria-label="Go to page 1">1</button></li>`;

    // Page 2
    const p2Active = currentPage === 2
      ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
      : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
    html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${p2Active}" data-page="2" aria-label="Go to page 2">2</button></li>`;

    // Middle: Jump Input Field
    const isMidActive = currentPage > 2 && currentPage < totalPages;
    const midActiveClass = isMidActive
      ? "border-spes-blue ring-2 ring-spes-blue/50 dark:border-spes-yellow dark:ring-spes-yellow/50 bg-spes-blue/5 dark:bg-spes-yellow/5"
      : "border-gray-200 bg-white dark:border-white/10 dark:bg-spes-dark-secondary";

    html += `<li class="flex items-center border ${midActiveClass} transition-all">
      <input id="staff-page-jump" type="number" min="1" max="${totalPages}" value="${isMidActive ? currentPage : ""}" placeholder="..." aria-label="Jump to page"
        class="w-14 bg-transparent px-1.5 py-1.5 text-center text-xs sm:text-sm font-black text-spes-blue outline-none dark:text-spes-yellow [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        style="-moz-appearance: textfield" title="Type page number (1-${totalPages}) and press Enter" />
    </li>`;

    // Right: Last Page (totalPages)
    const pLastActive = currentPage === totalPages
      ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
      : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
    html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${pLastActive}" data-page="${totalPages}" aria-label="Go to page ${totalPages}">${totalPages}</button></li>`;
  }

  indicatorsEl.innerHTML = html;

  indicatorsEl.querySelectorAll(".page-btn").forEach((button) => button.addEventListener("click", () => {
    currentPage = Number(button.dataset.page) || 1;
    renderPaginatedTable(window._spesDashboardRole || "officer");
  }));

  const jumpInput = document.getElementById("staff-page-jump");
  const jump = () => {
    const rawVal = jumpInput?.value?.trim();
    if (!rawVal) return;
    const requested = Number.parseInt(rawVal, 10);
    if (!Number.isFinite(requested)) return;
    currentPage = Math.min(totalPages, Math.max(1, requested));
    renderPaginatedTable(window._spesDashboardRole || "officer");
  };
  jumpInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      jump();
    }
  });
  jumpInput?.addEventListener("blur", () => {
    if (jumpInput.value && jumpInput.value !== String(currentPage)) {
      jump();
    }
  });
}
// --- END: UPDATE STAFF PAGE INDICATORS WITH LEFT-1, 2, INPUT, AND RIGHT-LAST ---

function syncStaffActionDropdown() {
  const actionButton = document.getElementById("staff-action-dropdown-btn");
  if (!actionButton) return;
  const hasSelection = selectedPermissionStaffIds.size > 0 || document.querySelector(".staff-row-checkbox:checked") !== null;
  const isMobile = window.matchMedia("(max-width: 639px)").matches;
  actionButton.classList.toggle("hidden", isMobile && !hasSelection);
  actionButton.setAttribute("aria-hidden", String(isMobile && !hasSelection));
  if (isMobile && !hasSelection) document.getElementById("staff-action-dropdown")?.classList.add("hidden");
}

function initStaffActionDropdown() {
  const actionButton = document.getElementById("staff-action-dropdown-btn");
  const actionMenu = document.getElementById("staff-action-dropdown");
  if (!actionButton || !actionMenu || actionButton.dataset.outsideCloseBound === "true") return;
  actionButton.dataset.outsideCloseBound = "true";
  actionButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const willOpen = actionMenu.classList.contains("hidden");
    actionMenu.classList.toggle("hidden", !willOpen);
    if (willOpen) positionStaffActionMenu(actionMenu, actionButton);
  });
  document.addEventListener("click", (event) => {
    if (!actionButton.contains(event.target) && !actionMenu.contains(event.target)) actionMenu.classList.add("hidden");
  });
  window.addEventListener("resize", syncStaffActionDropdown);
  syncStaffActionDropdown();
}

function positionStaffActionMenu(menu, trigger) {
  const viewportPadding = 8;
  const placement = trigger.dataset.dropdownPlacement || "bottom";
  const [side, align = "start"] = placement.split("-");
  const triggerRect = trigger.getBoundingClientRect();
  const isMobile = window.matchMedia("(max-width: 639px)").matches;
  menu.style.width = isMobile ? `${Math.round(triggerRect.width)}px` : "";
  const menuRect = menu.getBoundingClientRect();
  const menuWidth = Math.min(menuRect.width, window.innerWidth - (viewportPadding * 2));
  const menuHeight = Math.min(menuRect.height, window.innerHeight - (viewportPadding * 2));
  let left = triggerRect.left;
  let top = triggerRect.bottom + viewportPadding;

  if (side === "top") top = triggerRect.top - menuHeight - viewportPadding;
  if (side === "left") {
    left = triggerRect.left - menuWidth - viewportPadding;
    top = align === "end" ? triggerRect.bottom - menuHeight : triggerRect.top;
  }
  if (side === "right") {
    left = triggerRect.right + viewportPadding;
    top = align === "end" ? triggerRect.bottom - menuHeight : triggerRect.top;
  }
  if (side === "bottom" && align === "end") left = triggerRect.right - menuWidth;

  Object.assign(menu.style, {
    position: "fixed",
    left: `${Math.round(Math.min(Math.max(viewportPadding, left), window.innerWidth - menuWidth - viewportPadding))}px`,
    top: `${Math.round(Math.min(Math.max(viewportPadding, top), window.innerHeight - menuHeight - viewportPadding))}px`,
    right: "auto",
    bottom: "auto",
    transform: "none",
  });
}

// --- START: RENDER PAGINATED TABLE WITH DYNAMIC PAGE SIZE ---
function renderPaginatedTable(userRole) {
  const total = allImplementors.length;
  renderPageSizeSelector(total, () => renderPaginatedTable(userRole));

  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  currentPage = Math.min(totalPages, Math.max(1, currentPage));
  const start = total === 0 ? 0 : (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const paged = allImplementors.slice(start, end);
  const totalEl = document.getElementById("pagination-total") || document.getElementById("pagination-total-dashboard");
  const rangeEl = document.getElementById("pagination-range");
  if (totalEl) totalEl.textContent = total;
  if (rangeEl) rangeEl.textContent = total === 0 ? "0" : `${start + 1}-${Math.min(end, total)}`;
  document.getElementById("prev-page")?.toggleAttribute("disabled", currentPage <= 1 || total === 0);
  document.getElementById("next-page")?.toggleAttribute("disabled", currentPage >= totalPages || total === 0);
  flowDebug("PAGINATION", "Rendering staff page", {
    function: "renderPaginatedTable",
    currentPage,
    totalPages,
    rowsPerPage,
    range: total === 0 ? "0" : `${start + 1}-${Math.min(end, total)}`,
    rowIds: paged.map((staff) => staff.id),
    rowNames: paged.map((staff) => staff.full_name),
  });
  renderTableRows(paged, userRole);
  updateStaffPageIndicators(total);
}
// --- END: RENDER PAGINATED TABLE WITH DYNAMIC PAGE SIZE ---

// --- START: DRAG SCROLL HELPER FOR DASHBOARD / IMPLEMENTORS / ROLES ---
function addDragScroll(el) {
  if (!el || el.dataset.dragScrollBound === "true") return;
  el.dataset.dragScrollBound = "true";
  let isDown = false, startX = 0, scrollLeft = 0;

  const checkOverflow = () => {
    if (el.scrollWidth > el.clientWidth) {
      el.classList.add("cursor-grab");
    } else {
      el.classList.remove("cursor-grab", "cursor-grabbing");
    }
  };

  window.addEventListener("resize", checkOverflow);
  setTimeout(checkOverflow, 400);

  el.addEventListener("mousedown", (e) => {
    if (e.target.closest("button, input, select, a, svg")) return;
    isDown = true;
    el.classList.add("cursor-grabbing");
    el.classList.remove("cursor-grab");
    startX = e.pageX - el.offsetLeft;
    scrollLeft = el.scrollLeft;
  });
  el.addEventListener("mouseleave", () => {
    isDown = false;
    el.classList.remove("cursor-grabbing");
    checkOverflow();
  });
  el.addEventListener("mouseup", () => {
    isDown = false;
    el.classList.remove("cursor-grabbing");
    checkOverflow();
  });
  el.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startX) * 1.5;
    el.scrollLeft = scrollLeft - walk;
  });
  el.addEventListener("wheel", (e) => {
    if (!e.shiftKey) return;
    if (e.deltaY !== 0 || e.deltaX !== 0) {
      e.preventDefault();
      el.scrollLeft += (e.deltaY || e.deltaX);
    }
  }, { passive: false });
}
// --- END: DRAG SCROLL HELPER FOR DASHBOARD / IMPLEMENTORS / ROLES ---

function initPaginationEvents(userRole) {
  const previousButton = document.getElementById("prev-page");
  const nextButton = document.getElementById("next-page");
  if (previousButton && previousButton.dataset.paginationBound !== "true") {
    previousButton.dataset.paginationBound = "true";
    previousButton.addEventListener("click", () => {
      if (currentPage > 1) { currentPage--; renderPaginatedTable(userRole); }
    });
  }
  if (nextButton && nextButton.dataset.paginationBound !== "true") {
    nextButton.dataset.paginationBound = "true";
    nextButton.addEventListener("click", () => {
      if (currentPage < Math.ceil(allImplementors.length / rowsPerPage)) { currentPage++; renderPaginatedTable(userRole); }
    });
  }

  const tableWrapper = document.getElementById("staff-table-wrapper") || document.getElementById("roles-table-wrapper") || document.querySelector(".overflow-x-auto");
  if (tableWrapper) addDragScroll(tableWrapper);
}

function renderTableRows(implementors, userRole) {
  const tbody         = document.getElementById("staff-table-body");
  if (!tbody) return;

  const isRolesPage     = window.location.pathname.includes("/roles/");
  const isDashboardPage = window.location.pathname.includes("/dashboard/");

  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  const isAdminSession = session.role === "admin";
  const access = getOfficeAccessScope(session);
  const isApproved = isAdminSession || session.approved;

  if (!isApproved) {
    if (isRolesPage) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center py-6 text-sm text-spes-red/80 dark:text-red-400/80 font-extrabold uppercase tracking-wider">Account Not Approved. List is hidden.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-6 text-sm text-spes-red/80 dark:text-red-400/80 font-extrabold uppercase tracking-wider">Account Not Approved. List is hidden.</td></tr>`;
    }
    return;
  }

  if (isRolesPage) {
    tbody.innerHTML = implementors.map(s => {
      const staffPerms = allStaffPermissions[s.id] || {};
      const isAdmin   = s.role === "ADMIN";
      const canSelectPermissions = !isAdmin && s.approved === true;

      const hasPerm = (perm) => {
        if (isAdmin) return true;
        if (!s.approved) return false;
        const colMap = {
          "users:view": "view_users",
          "offices:view-other": "view_other_offices",
          "analytics:view-global": "view_global_stats",
          "users:create": "create_users",
          "users:edit": "edit_users",
          "users:delete": "delete_users",
          "reports:export": "export_reports",
          "payroll:view": "view_payroll",
        };
        return Boolean(staffPerms[colMap[perm]]);
      };

      const displayRole = s.role.charAt(0).toUpperCase() + s.role.slice(1).toLowerCase();

      const isTarget = new URLSearchParams(window.location.search).get("id") === String(s.id);
      const rowClass = isTarget 
        ? "border-b border-gray-100 dark:border-white/5 bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse" 
        : "border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow";

      return `
        <tr class="${rowClass}">
          <td class="p-4 text-center"><div class="flex items-center justify-center">
            <input type="checkbox" data-row-user-id="${s.id}" ${selectedPermissionStaffIds.has(Number(s.id)) ? "checked" : ""} ${canSelectPermissions ? "" : "disabled"} class="staff-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow ${canSelectPermissions ? "" : "cursor-not-allowed opacity-40"}">
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
          ${["users:view","offices:view-other","analytics:view-global","users:create","users:edit","users:delete","reports:export","payroll:view"].map(perm => {
            const description = ROLE_PERMISSION_DESCRIPTIONS[perm];
            return `
              <td class="px-6 py-4 text-center">
                <div class="relative group inline-flex items-center justify-center">
                  <input type="checkbox" data-user-id="${s.id}" data-perm="${perm}" aria-label="${escHtml(description)}" ${hasPerm(perm) ? "checked" : ""} ${canSelectPermissions ? "" : "disabled"} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow ${canSelectPermissions ? "" : "opacity-50 cursor-not-allowed"}">
                  <div role="tooltip" class="pointer-events-none absolute bottom-full left-1/2 z-[70] mb-2 w-64 -translate-x-1/2 whitespace-normal break-words rounded-lg border border-white/10 bg-spes-blue px-3 py-2 text-left text-[10px] font-semibold normal-case leading-relaxed tracking-normal text-white opacity-0 shadow-xl transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-spes-dark-primary">
                    ${escHtml(isAdmin ? `${description} Administrators always have this permission.` : !s.approved ? `${description} Approve this account before assigning optional permissions.` : description)}
                    <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></span>
                  </div>
                </div>
              </td>`;
          }).join("")}
          <td class="px-6 py-4 text-center whitespace-nowrap">
            <div class="relative group inline-block">
              <button data-clear-user-id="${s.id}" ${canSelectPermissions ? "" : "disabled"} class="btn-clear-perms cursor-pointer p-1.5 rounded-lg text-spes-red hover:bg-spes-red/10 transition-all flex items-center justify-center ${canSelectPermissions ? "" : "opacity-40 cursor-not-allowed"}" aria-label="Clear Permissions">
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
    const canEdit = (
      isAdminSession ||
      (Boolean(session.permissions?.edit_users) && access.canManageOffice(s.office_id))
    );
    const canDelete = (
      isAdminSession ||
      (Boolean(session.permissions?.delete_users) && access.canManageOffice(s.office_id))
    );
    const isTarget = new URLSearchParams(window.location.search).get("id") === String(s.id);
    const rowBg     = isTarget
      ? "bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse cursor-pointer"
      : isArchived
        ? "bg-amber-50 dark:bg-amber-900/10 border-l-4 border-amber-400 dark:border-amber-500"
        : "bg-white dark:bg-spes-dark-primary hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow cursor-pointer";
    return `
      <tr data-impl-info="${dataStr}" class="impl-row border-b border-gray-100 dark:border-white/5 transition-all duration-200 ${rowBg}">
      ${!isDashboardPage ? `<td class="p-4 text-center"><div class="flex items-center justify-center">
        <input type="checkbox" data-row-user-id="${s.id}" class="staff-row-checkbox h-4 w-4 rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow ${canDelete ? "cursor-pointer" : "cursor-not-allowed opacity-40"}" ${isArchived || !canDelete ? "disabled" : ""}>
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
            : `<span class="text-[0.625rem] text-gray-400 dark:text-white/25">${access.canManageOffice(s.office_id) ? "—" : "Read only"}</span>`)}
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
  document.querySelectorAll(".staff-row-checkbox").forEach((checkbox) => {
    if (checkbox.dataset.actionVisibilityBound === "true") return;
    checkbox.dataset.actionVisibilityBound = "true";
    checkbox.addEventListener("change", syncStaffActionDropdown);
  });
  syncStaffActionDropdown();

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
const PERM_COL_MAP = {
  "users:view": "view_users",
  "offices:view-other": "view_other_offices",
  "analytics:view-global": "view_global_stats",
  "users:create": "create_users",
  "users:edit": "edit_users",
  "users:delete": "delete_users",
  "reports:export": "export_reports",
  "payroll:view": "view_payroll",
};
const ALL_PERMISSIONS_GRANTED = Object.fromEntries(
  Object.values(PERM_COL_MAP).map((column) => [column, true])
);
const ALL_PERMISSIONS_REVOKED = Object.fromEntries(
  Object.values(PERM_COL_MAP).map((column) => [column, false])
);

function eligiblePermissionStaff() {
  return allImplementors.filter(
    (staff) => staff.approved === true && String(staff.role).toUpperCase() !== "ADMIN"
  );
}

function updatePermissionSelectionControls() {
  const eligibleIds = new Set(eligiblePermissionStaff().map((staff) => Number(staff.id)));
  for (const selectedId of selectedPermissionStaffIds) {
    if (!eligibleIds.has(selectedId)) selectedPermissionStaffIds.delete(selectedId);
  }

  const count = selectedPermissionStaffIds.size;
  const selectAll = document.getElementById("staff-checkbox-all");
  if (selectAll) {
    selectAll.disabled = eligibleIds.size === 0;
    selectAll.checked = eligibleIds.size > 0 && count === eligibleIds.size;
    selectAll.indeterminate = count > 0 && count < eligibleIds.size;
  }

  for (const id of ["btn-bulk-grant", "btn-bulk-revoke"]) {
    const button = document.getElementById(id);
    if (!button) continue;
    button.disabled = count === 0;
    button.classList.toggle("pointer-events-none", count === 0);
    button.classList.toggle("cursor-not-allowed", count === 0);
    button.classList.toggle("opacity-40", count === 0);
    button.classList.toggle("cursor-pointer", count > 0);
    button.setAttribute("aria-disabled", String(count === 0));
    button.setAttribute(
      "aria-label",
      `${id === "btn-bulk-grant" ? "Grant" : "Revoke"} all optional permissions for ${count} selected staff account${count === 1 ? "" : "s"}`
    );
  }
}

function applyPermissionUpdatesLocally(staffIds, updates) {
  for (const staffId of staffIds) {
    allStaffPermissions[staffId] = {
      ...(allStaffPermissions[staffId] || {}),
      ...updates,
    };
    const implementor = allImplementors.find((staff) => Number(staff.id) === Number(staffId));
    if (implementor) {
      implementor.permissions = {
        ...(implementor.permissions || {}),
        ...updates,
      };
    }
    document.querySelectorAll(`.perm-checkbox[data-user-id="${staffId}"]`).forEach((checkbox) => {
      const column = PERM_COL_MAP[checkbox.dataset.perm];
      if (column in updates) checkbox.checked = Boolean(updates[column]);
    });
  }
}

function setupPermissionChangeHandlers() {
  document.querySelectorAll(".staff-row-checkbox:not([disabled])").forEach((checkbox) => {
    if (checkbox.dataset.permissionSelectionBound === "true") return;
    checkbox.dataset.permissionSelectionBound = "true";
    checkbox.addEventListener("change", () => {
      const staffId = Number(checkbox.dataset.rowUserId);
      if (checkbox.checked) selectedPermissionStaffIds.add(staffId);
      else selectedPermissionStaffIds.delete(staffId);
      updatePermissionSelectionControls();
    });
  });

  document.querySelectorAll(".perm-checkbox:not([disabled])").forEach((checkbox) => {
    checkbox.addEventListener("change", async () => {
      const staffId = Number(checkbox.dataset.userId);
      const permission = checkbox.dataset.perm;
      const column = PERM_COL_MAP[permission];
      const isChecked = checkbox.checked;
      if (!staffId || !column) return;

      checkbox.disabled = true;
      const result = await upsertStaffPermissions(staffId, { [column]: isChecked });
      checkbox.disabled = false;

      if (result.success) {
        applyPermissionUpdatesLocally([staffId], { [column]: isChecked });
        const staff = allImplementors.find((item) => Number(item.id) === staffId);
        modals.success(
          "Permission Updated",
          `${isChecked ? "Granted" : "Revoked"} "${permission}" for ${staff?.full_name || "the selected staff account"}.`
        );
      } else {
        checkbox.checked = !isChecked;
        modals.error("Error", result.error);
      }
    });
  });

  document.querySelectorAll(".btn-clear-perms:not([disabled])").forEach((button) => {
    button.addEventListener("click", async () => {
      const staffId = Number(button.dataset.clearUserId);
      const staff = allImplementors.find((item) => Number(item.id) === staffId);
      if (!staffId || !staff) return;

      const confirmation = await modals.confirm(
        "Clear Permissions",
        `Revoke every optional permission from ${staff.full_name}?`,
        "Clear All",
        "Cancel"
      );
      if (!confirmation.isConfirmed) return;

      modals.loading("Clearing...", "Please wait...");
      const result = await upsertStaffPermissions(staffId, ALL_PERMISSIONS_REVOKED);
      modals.close();

      if (result.success) {
        applyPermissionUpdatesLocally([staffId], ALL_PERMISSIONS_REVOKED);
        modals.success("Permissions Cleared", `All optional permissions were revoked from ${staff.full_name}.`);
      } else {
        modals.error("Error", result.error);
      }
    });
  });

  const bindBulkAction = (buttonId, grant) => {
    const button = document.getElementById(buttonId);
    if (!button || button.dataset.permissionActionBound === "true") return;
    button.dataset.permissionActionBound = "true";
    button.addEventListener("click", async () => {
      const staffIds = [...selectedPermissionStaffIds];
      if (!staffIds.length) return;

      const confirmation = await modals.confirm(
        grant ? "Grant All Permissions" : "Revoke All Permissions",
        `${grant ? "Grant" : "Revoke"} every optional permission ${grant ? "to" : "from"} ${staffIds.length} selected staff account${staffIds.length === 1 ? "" : "s"}?`,
        grant ? "Grant All" : "Revoke All",
        "Cancel"
      );
      if (!confirmation.isConfirmed) return;

      modals.loading(grant ? "Granting..." : "Revoking...", "Please wait...");
      const updates = grant ? ALL_PERMISSIONS_GRANTED : ALL_PERMISSIONS_REVOKED;
      const result = await upsertStaffPermissions(staffIds, updates);
      modals.close();

      if (result.success) {
        applyPermissionUpdatesLocally(staffIds, updates);
        modals.success(
          grant ? "Permissions Granted" : "Permissions Revoked",
          `All optional permissions were ${grant ? "granted to" : "revoked from"} only the ${staffIds.length} selected staff account${staffIds.length === 1 ? "" : "s"}.`
        );
      } else {
        modals.error("Error", result.error);
      }
    });
  };

  bindBulkAction("btn-bulk-grant", true);
  bindBulkAction("btn-bulk-revoke", false);
  updatePermissionSelectionControls();
}

// ── Misc helpers ──────────────────────────────────────────────
function onSelectAll(e) {
  if (!window.location.pathname.includes("/roles/")) {
    document.querySelectorAll(".staff-row-checkbox:not([disabled])").forEach((checkbox) => {
      checkbox.checked = e.target.checked;
    });
    syncStaffActionDropdown();
    return;
  }

  const eligible = eligiblePermissionStaff();
  if (e.target.checked) {
    eligible.forEach((staff) => selectedPermissionStaffIds.add(Number(staff.id)));
  } else {
    eligible.forEach((staff) => selectedPermissionStaffIds.delete(Number(staff.id)));
  }
  document.querySelectorAll(".staff-row-checkbox:not([disabled])").forEach((checkbox) => {
    checkbox.checked = selectedPermissionStaffIds.has(Number(checkbox.dataset.rowUserId));
  });
  updatePermissionSelectionControls();
  syncStaffActionDropdown();
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

function initDashboardPeriodSelector(periods = { years: [], months: [], monthsByYear: {} }) {
  const allButton = document.getElementById("dashboard-period-all");
  const yearButton = document.getElementById("dashboard-year-dropdown-btn");
  const monthButton = document.getElementById("dashboard-month-dropdown-btn");
  const clearButton = document.getElementById("dashboard-period-clear");
  const yearMenu = document.getElementById("dashboard-year-dropdown-menu");
  const monthMenu = document.getElementById("dashboard-month-dropdown-menu");
  const yearOptions = document.getElementById("dashboard-year-options");
  const monthOptions = document.getElementById("dashboard-month-options");
  const yearLabel = document.getElementById("dashboard-selected-year");
  const monthLabel = document.getElementById("dashboard-selected-month");
  const yearIcon = document.getElementById("dashboard-year-dropdown-icon");
  const monthIcon = document.getElementById("dashboard-month-dropdown-icon");
  if (!allButton || !yearButton || !monthButton || !clearButton || !yearMenu || !monthMenu || !yearOptions || !monthOptions) return;

  let state = { year: "all", month: "all" };
  const buttonClass = "cursor-pointer block w-full rounded px-3 py-2 text-left text-[10px] font-bold text-white transition-colors hover:bg-white/10";
  const closeMenus = () => {
    yearMenu.classList.add("hidden");
    monthMenu.classList.add("hidden");
    yearButton.setAttribute("aria-expanded", "false");
    monthButton.setAttribute("aria-expanded", "false");
    yearIcon?.classList.remove("rotate-180");
    monthIcon?.classList.remove("rotate-180");
  };
  const positionPeriodMenu = (menu, button) => {
    menu.classList.remove("left-0", "right-0", "left-1/2", "-translate-x-1/2", "top-full", "bottom-full", "mt-2", "mb-2");
    const rect = button.getBoundingClientRect();
    const estimatedHeight = Math.min(260, Math.max(120, menu.scrollHeight || 220));
    const estimatedWidth = Math.min(240, window.innerWidth - 16);
    if (rect.left + estimatedWidth > window.innerWidth - 8) menu.classList.add("right-0");
    else if (rect.left < 8) menu.classList.add("left-0");
    else menu.classList.add("left-1/2", "-translate-x-1/2");
    if (window.innerHeight - rect.bottom < estimatedHeight + 12 && rect.top > estimatedHeight + 12) menu.classList.add("bottom-full", "mb-2");
    else menu.classList.add("top-full", "mt-2");
  };
  const availableMonths = () => state.year === "all"
    ? periods.months
    : (periods.monthsByYear?.[state.year] || []);
  const apply = () => {
    const result = setDashboardPeriodFilter(state);
    _loadTimelineMetrics(result.beneficiaries);
    yearLabel.textContent = state.year === "all" ? "All Years" : state.year;
    monthLabel.textContent = state.month === "all" ? "All Months" : state.month.charAt(0) + state.month.slice(1).toLowerCase();
    const isAllTime = state.year === "all" && state.month === "all";
    allButton.classList.toggle("bg-spes-white", isAllTime);
    allButton.classList.toggle("text-spes-blue", isAllTime);
    allButton.classList.toggle("text-white", !isAllTime);
    clearButton.classList.toggle("hidden", isAllTime);
    clearButton.classList.toggle("flex", !isAllTime);
    renderOptions();
    closeMenus();
  };
  const renderOptions = () => {
    const yearChoices = ["all", ...(periods.years || [])];
    yearOptions.innerHTML = yearChoices.map((year) => `<button type="button" data-dashboard-year="${year}" class="${buttonClass} ${state.year === year ? "bg-white/15 text-spes-yellow" : ""}">${year === "all" ? "All Years" : year}</button>`).join("");
    const monthChoices = ["all", ...availableMonths()];
    monthOptions.innerHTML = monthChoices.map((month) => `<button type="button" data-dashboard-month="${month}" class="${buttonClass} ${state.month === month ? "bg-white/15 text-spes-yellow" : ""}">${month === "all" ? "All Months" : month.charAt(0) + month.slice(1).toLowerCase()}</button>`).join("");
    yearOptions.querySelectorAll("[data-dashboard-year]").forEach((button) => button.addEventListener("click", () => {
      const selectedYear = button.dataset.dashboardYear || "all";
      state.year = selectedYear !== "all" && state.year === selectedYear ? "all" : selectedYear;
      state.month = "all";
      apply();
    }));
    monthOptions.querySelectorAll("[data-dashboard-month]").forEach((button) => button.addEventListener("click", () => {
      const selectedMonth = button.dataset.dashboardMonth || "all";
      state.month = selectedMonth !== "all" && state.month === selectedMonth ? "all" : selectedMonth;
      apply();
    }));
  };

  const clearPeriodFilters = () => { state = { year: "all", month: "all" }; apply(); };
  allButton.addEventListener("click", clearPeriodFilters);
  clearButton.addEventListener("click", clearPeriodFilters);
  yearButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = yearMenu.classList.contains("hidden");
    closeMenus();
    if (open) positionPeriodMenu(yearMenu, yearButton);
    yearMenu.classList.toggle("hidden", !open);
    yearButton.setAttribute("aria-expanded", String(open));
    yearIcon?.classList.toggle("rotate-180", open);
  });
  monthButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = monthMenu.classList.contains("hidden");
    closeMenus();
    if (open) positionPeriodMenu(monthMenu, monthButton);
    monthMenu.classList.toggle("hidden", !open);
    monthButton.setAttribute("aria-expanded", String(open));
    monthIcon?.classList.toggle("rotate-180", open);
  });
  document.addEventListener("click", (event) => {
    if (!document.getElementById("dashboard-period-selector")?.contains(event.target)) closeMenus();
  });
  renderOptions();
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
  if (!session || !session.id || session.role === "admin") return;

  supabase
    .channel(`staff-permissions-${session.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "staffs",
        filter: `id=eq.${session.id}`
      },
      async (payload) => {
        const permissionChanged = Object.values(PERM_COL_MAP).some((field) => {
          return Boolean(payload.new?.[`perm_${field}`]) !== Boolean(session.permissions?.[field]);
        });
        if (!permissionChanged) return;
        if (import.meta.env.DEV) console.log("[SPES Realtime] Individual permissions updated:", payload);
        
        // Refresh local cache and localStorage
        const { data: freshPerms } = await fetchStaffPermissions(session.id, { forceRefresh: true });
        if (freshPerms) {
          session.permissions = freshPerms;
          localStorage.setItem("spes_session", JSON.stringify(session));
          
          Swal.fire({
            title: "Permissions Updated",
            text: "Your individual access permissions were updated and are being synchronized automatically.",
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

let approvalTransitionInProgress = false;

function normalizeApproval(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function applyRealtimeApprovalState(newApproved, source = "realtime") {
  if (approvalTransitionInProgress) return;

  const currentSession = JSON.parse(localStorage.getItem("spes_session") || "{}");
  const wasApproved = normalizeApproval(currentSession.approved);
  const isApproved = normalizeApproval(newApproved);
  if (wasApproved === isApproved) return;

  approvalTransitionInProgress = true;
  currentSession.approved = isApproved;
  localStorage.setItem("spes_session", JSON.stringify(currentSession));

  if (import.meta.env.DEV) {
    console.info(`[SPES Approval Sync] Status received via ${source}:`, isApproved);
  }

  Swal.fire({
    title: isApproved ? "Account Approved!" : "Account Disapproved",
    text: isApproved
      ? "Your account was approved and your dashboard access is being synchronized automatically."
      : "Your account was disapproved and your dashboard access is being revoked automatically.",
    icon: isApproved ? "success" : "warning",
    timer: 2200,
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

async function reconcileApprovalState(staffId) {
  const { data, error } = await supabase
    .from("staffs")
    .select("approved")
    .eq("id", staffId)
    .maybeSingle();

  if (error) {
    if (import.meta.env.DEV) {
      console.warn("[SPES Approval Sync] Reconciliation failed:", error.code);
    }
    return;
  }
  if (data) applyRealtimeApprovalState(data.approved, "reconciliation");
}

function setupRealtimeApprovalListener() {
  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  if (!session || !session.id || session.role === "admin") return;

  const channel = supabase
    .channel(`dashboard-approval-${session.id}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "staffs",
        filter: `id=eq.${session.id}`
      },
      (payload) => {
        applyRealtimeApprovalState(payload.new?.approved, "realtime");
      }
    )
    .subscribe((status) => {
      if (import.meta.env.DEV) {
        console.info("[SPES Approval Sync] Realtime channel:", status);
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        reconcileApprovalState(session.id);
      }
    });

  // Realtime remains the primary path. Reconciliation makes approval changes
  // self-healing when publication setup, connectivity, or tab suspension
  // causes a Postgres Changes event to be missed.
  const reconciliationTimer = window.setInterval(
    () => reconcileApprovalState(session.id),
    5000
  );

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      reconcileApprovalState(session.id);
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  window.addEventListener("beforeunload", () => {
    window.clearInterval(reconciliationTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    supabase.removeChannel(channel);
  }, { once: true });
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

// --- FUNCTION: WIRE QUICK ACCESS EXPORT PAGE BUTTONS (START) ---
function _wireExportsPageButtons() {
  ["quick-audit", "quick-audit-expanded", "quick-audit-expanded-mob", "quick-audit-mob"]
    .forEach(id => {
      document.getElementById(id)?.addEventListener("click", () => {
        window.location.href = "../exports/";
      });
    });
}
// --- FUNCTION: WIRE QUICK ACCESS EXPORT PAGE BUTTONS (END) ---

function initGlobalSearch(user) {
  const overlay = document.getElementById("global-search-overlay");
  const form = document.getElementById("global-search-form");
  const input = document.getElementById("global-search-input");
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
    const canSearchGlobal = getOfficeAccessScope(user).canViewGlobalStats;
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
          staffs!staff_id${!canSearchGlobal ? '!inner' : ''}(office_id, full_name, offices(name))
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
      // Composite period queries: e.g. "male total in july 2026".
      // Each detected facet becomes an exact database predicate, so the output
      // is a real aggregate of the matching beneficiary records.
      const searchMonths = {
        JAN: "JANUARY", JANUARY: "JANUARY", FEB: "FEBRUARY", FEBRUARY: "FEBRUARY",
        MAR: "MARCH", MARCH: "MARCH", APR: "APRIL", APRIL: "APRIL", MAY: "MAY",
        JUN: "JUNE", JUNE: "JUNE", JUL: "JULY", JULY: "JULY", AUG: "AUGUST", AUGUST: "AUGUST",
        SEP: "SEPTEMBER", SEPT: "SEPTEMBER", SEPTEMBER: "SEPTEMBER", OCT: "OCTOBER", OCTOBER: "OCTOBER",
        NOV: "NOVEMBER", NOVEMBER: "NOVEMBER", DEC: "DECEMBER", DECEMBER: "DECEMBER",
      };
      const requestedMonth = Object.entries(searchMonths).find(([term]) => new RegExp(`\\b${term}\\b`).test(qNorm))?.[1] || null;
      const requestedYear = qNorm.match(/\b(?:19|20)\d{2}\b/)?.[0] || null;
      const requestsMale = /\b(?:MALE|LALAKI)\b/.test(qNorm);
      const requestsFemale = /\b(?:FEMALE|BABAE)\b/.test(qNorm);
      const hasCompositePeriodQuery = Boolean(requestedMonth || requestedYear || requestsMale || requestsFemale);

      if (hasCompositePeriodQuery) {
        isKeyword = true;
        staffSearchQuery = null;
        if (requestsMale) benQuery = benQuery.eq("gender_id", 1);
        else if (requestsFemale) benQuery = benQuery.eq("gender_id", 2);
        if (requestedMonth) benQuery = benQuery.eq("month_period", requestedMonth);
        if (requestedYear) benQuery = benQuery.eq("year_period", requestedYear);

      // ── TOTAL / ALL ──
      } else if (qNorm === "TOTAL" || qNorm === "ALL") {
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
          if (!canSearchGlobal) benQuery = benQuery.eq("staffs.office_id", officeId);
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
        if (!canSearchGlobal) {
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
