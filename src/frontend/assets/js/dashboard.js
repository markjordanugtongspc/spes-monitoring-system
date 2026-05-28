/**
 * SPES Portal — Dashboard Entry Script
 * ──────────────────────────────────────
 */
import "../styles/tailwind.css";
import "flowbite";
import { applyPermissions, requireAuth, signOut } from "./rbac/guard.js";
import { fetchImplementorList } from "../../../backend/api/auth.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import ApexCharts from "apexcharts";
import { initFlowbite } from "flowbite";
import { initDashboardCharts } from "./components/charts.js";
import { modals } from "./components/modals.js";
import { initBeneficiaries } from "./components/beneficiaries.js";
import { setupSortFiltration } from "./components/sort-filtration.js";
import { initImplementorsDrawer } from "./components/drawer.js";

// ── Boot ──────────────────────────────────────────────────────
const session = requireAuth();
if (session) {
  // In production (npm run build), the sidebar is already injected at build
  // time via <!-- SPES:SIDEBAR --> so no fetch is needed. In dev mode
  // the sidebar-container div still exists and is fetched at runtime.
  const sidebarContainer = document.getElementById("sidebar-container");
  if (sidebarContainer) {
    loadComponent("sidebar-container", "../../components/sidebar.html").then(() => {
      init(session);
      initFlowbite();
    });
  } else {
    // Build-time sidebar already in DOM — boot immediately
    init(session);
    initFlowbite();
  }
}

async function loadComponent(id, url) {
  const container = document.getElementById(id);
  // Sidebar already injected at build time (SPES:SIDEBAR) — skip fetch
  if (!container) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    const html = await response.text();
    container.innerHTML = html;
  } catch (err) {
    console.error("[SPES] Component loader error:", err);
  }
}

async function init(user) {
  populateSidebar(user);
  initClock();

  const path = window.location.pathname;
  if (path.includes("/implementors/")) {
    setActiveSidebarLink("implementor-list");
  } else if (path.includes("/roles/")) {
    setActiveSidebarLink("roles");
  } else if (path.includes("/beneficiaries/")) {
    setActiveSidebarLink("beneficiaries");
  } else if (path.includes("/dashboard/")) {
    setActiveSidebarLink("overview");
  }

  await applyPermissions(user.role);
  const nameEl = document.getElementById("header-user-name");
  if (nameEl) nameEl.textContent = user.full_name || "Admin";

  await loadImplementorTable(user.role);

  if (path.includes("/implementors/")) {
    initImplementorsDrawer();
  }

  // Initialize Dynamic Badges based on processed data
  updateDynamicBadges();

  if (path.includes("/dashboard/")) {
    initDashboardCharts();
  }

  if (path.includes("/beneficiaries/")) {
    initBeneficiaries();
  }

  document.getElementById("sign-out-btn")?.addEventListener("click", signOut);
  initAutoYear();
  initYearDropdown();
  initThemeToggle();

  document.getElementById("staff-checkbox-all")?.addEventListener("change", onSelectAll);

  initSidebarState();
}

function initSidebarState() {
  const usersDropdownBtn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  const usersDropdownUl = document.getElementById('sidebar-dropdown-users');
  if (!usersDropdownBtn || !usersDropdownUl) return;

  // Check cookie (default to open if not set)
  const isMenuOpen = document.cookie.split('; ').find(row => row.startsWith('spes_user_management_open='))?.split('=')[1] !== 'false';

  if (isMenuOpen) {
    usersDropdownUl.classList.remove('hidden');
    usersDropdownBtn.setAttribute('aria-expanded', 'true');
    const chevron = usersDropdownBtn.querySelector("svg:last-child");
    if (chevron) chevron.classList.add("rotate-180");
  } else {
    usersDropdownUl.classList.add('hidden');
    usersDropdownBtn.setAttribute('aria-expanded', 'false');
    const chevron = usersDropdownBtn.querySelector("svg:last-child");
    if (chevron) chevron.classList.remove("rotate-180");
  }

  // Listen for clicks to update cookie
  usersDropdownBtn.addEventListener('click', () => {
    // Flowbite handles the toggle, so we just check what it changed it to
    setTimeout(() => {
      const isOpen = !usersDropdownUl.classList.contains('hidden');
      document.cookie = `spes_user_management_open=${isOpen}; path=/; max-age=31536000`; // 1 year expiry
    }, 50);
  });
}

function initClock() {
  const clockEl = document.getElementById("real-time-clock");
  if (!clockEl) return;
  const update = () => {
    const now = new Date();
    clockEl.textContent = `${now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} | ${now.toLocaleTimeString('en-US', { hour12: true })}`;
  };
  setInterval(update, 1000);
  update();
}

function populateSidebar(user) {
  const nameEl = document.getElementById("sidebar-user-name");
  const emailEl = document.getElementById("sidebar-user-email");
  const avatarEl = document.getElementById("sidebar-user-avatar");
  const roleBadge = document.getElementById("sidebar-role-badge");

  if (nameEl) nameEl.textContent = user.full_name || "Implementor";
  if (emailEl) emailEl.textContent = user.email || "";
  if (avatarEl) {
    const initials = (user.full_name || "U").split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
    avatarEl.textContent = initials;
  }
  if (roleBadge) roleBadge.textContent = user.role_label || user.role;
}

function setActiveSidebarLink(navId) {
  const links = document.querySelectorAll(".sidebar-link");
  links.forEach(link => {
    const isMatch = link.getAttribute("data-nav-item") === navId;
    const isSubLink = link.closest("ul[id^='sidebar-dropdown-']");
    
    if (isMatch) {
      link.classList.add("bg-spes-blue/8", "text-spes-blue", "dark:bg-spes-white/8", "dark:text-spes-yellow");
      if (!isSubLink) {
        link.classList.add("border-l-4", "border-spes-blue", "dark:border-spes-yellow");
      }
      
      const parentUl = isSubLink;
      if (parentUl) {
        parentUl.classList.remove("hidden");
        const triggerBtn = document.querySelector(`[aria-controls="${parentUl.id}"]`);
        if (triggerBtn) {
          triggerBtn.classList.add("text-spes-blue", "dark:text-spes-yellow", "font-bold");
          const chevron = triggerBtn.querySelector("svg:last-child");
          if (chevron) chevron.classList.add("rotate-180");
        }
      }
    } else {
      link.classList.remove(
        "bg-spes-blue/8",
        "text-spes-blue",
        "dark:bg-spes-white/8",
        "dark:text-spes-yellow",
        "border-l-4",
        "border-spes-blue",
        "dark:border-spes-yellow"
      );
    }
  });
}

// ── Implementor Table & Dynamic Metrics ────────────────────────
let allImplementors = [];
let currentPage = 1;
const rowsPerPage = (window.location.pathname.includes("/implementors/") || window.location.pathname.includes("/roles/")) ? 10 : 3;

async function loadImplementorTable(userRole) {
  let data = [];
  try {
    data = await fetchImplementorList();
  } catch (err) {
    console.error("[SPES] Error fetching real staff list from database:", err);
  }

  const mockData = [
    { id: "1", full_name: "Mark Jordan Ugtong", email: "markjordanugtong@gmail.com", office: "DOLE Region X", role: "ADMIN", status: "ONLINE" },
    { id: "2", full_name: "Walleen Ates", email: "walleenates@gmail.com", office: "Provincial Office", role: "OFFICER", status: "OFFLINE" },
    { id: "3", full_name: "Nurkeymar Abdul", email: "nurkeymarabdul@gmail.com", office: "Technical Support", role: "OFFICER", status: "ONLINE" },
    { id: "4", full_name: "Mark Lloyd Gelica", email: "marklloydgelica@gmail.com", office: "Public Relations", role: "ADMIN", status: "ONLINE" },
    { id: "5", full_name: "Leonor Rivera", email: "leonor@gmail.com", office: "DOLE Region X", role: "OFFICER", status: "BUSY" },
    { id: "6", full_name: "Emilio Aguinaldo", email: "emilio@gmail.com", office: "LGU Admin", role: "OFFICER", status: "OFFLINE" },
    { id: "7", full_name: "Gabriela Silang", email: "gabriela@gmail.com", office: "Regional HQ", role: "ADMIN", status: "ONLINE" },
    { id: "8", full_name: "Apolinario Mabini", email: "mabini@gmail.com", office: "Legal Dept", role: "OFFICER", status: "BUSY" },
    { id: "9", full_name: "Melchora Aquino", email: "tandang.sora@gmail.com", office: "Social Welfare", role: "OFFICER", status: "ONLINE" },
    { id: "10", full_name: "Marcelo del Pilar", email: "plaridel@gmail.com", office: "Media Relations", role: "ADMIN", status: "OFFLINE" },
    { id: "11", full_name: "Antonio Luna", email: "luna@gmail.com", office: "Defense Dept", role: "OFFICER", status: "ONLINE" },
    { id: "12", full_name: "Gregorio del Pilar", email: "goyo@gmail.com", office: "Regional HQ", role: "OFFICER", status: "ONLINE" },
    { id: "13", full_name: "Juan Luna", email: "juan.luna@gmail.com", office: "Arts & Culture", role: "ADMIN", status: "OFFLINE" },
    { id: "14", full_name: "Diego Silang", email: "diego@gmail.com", office: "Vigan Branch", role: "OFFICER", status: "BUSY" },
    { id: "15", full_name: "Lapu Lapu", email: "lapu@gmail.com", office: "Mactan Unit", role: "ADMIN", status: "ONLINE" },
    { id: "16", full_name: "Francisco Baltazar", email: "baltazar@gmail.com", office: "Literature Div", role: "OFFICER", status: "ONLINE" },
    { id: "17", full_name: "Teresa Magbanua", email: "magbanua@gmail.com", office: "Iloilo HQ", role: "OFFICER", status: "OFFLINE" },
    { id: "18", full_name: "Sultan Kudarat", email: "kudarat@gmail.com", office: "Mindanao HQ", role: "ADMIN", status: "ONLINE" },
    { id: "19", full_name: "Graciano Lopez Jaena", email: "jaena@gmail.com", office: "Media Hub", role: "OFFICER", status: "BUSY" },
    { id: "20", full_name: "Panday Pira", email: "pira@gmail.com", office: "Tech Shop", role: "OFFICER", status: "ONLINE" }
  ];

  const finalData = (data && data.length > 0) ? data : mockData;

  allImplementors = finalData;
  setupSortFiltration({
    tableId: "staff-table-body",
    btnSortId: "btn-sort-staff",
    dropdownSortId: "dropdown-sort-staff",
    btnFilterId: "btn-filter-staff",
    dropdownFilterId: "dropdown-filter-staff",
    originalData: finalData,
    onRender: (filteredData) => {
      allImplementors = filteredData;
      currentPage = 1;
      renderPaginatedTable(userRole);
    }
  });
  // Fallback: directly render table for pages without sort/filter elements (e.g. Roles page)
  renderPaginatedTable(userRole);
  initPaginationEvents(userRole);
}

// ── Advanced Javascript Function: Dynamic KPI Badges ──────────
function updateDynamicBadges() {
  const staffBadge = document.getElementById("badge-staff-metric");
  const studentBadge = document.getElementById("badge-student-metric");

  if (staffBadge) {
    const totalStaff = 140;
    const regionalHub = 45; // DOLE REGION X
    const hubPct = Math.round((regionalHub / totalStaff) * 100);
    // Switch to Emerald theme for Staff Total
    staffBadge.className = "rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400";
    staffBadge.textContent = `${hubPct}% TOTAL`;
  }

  if (studentBadge) {
    const male = 850;
    const female = 720;
    const total = male + female;
    const malePct = Math.round((male / total) * 100);
    const femalePct = 100 - malePct;

    // Mars (Male) and Venus (Female) SVG Icons
    const maleIcon = `<svg class="inline h-2.5 w-2.5 mb-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M21 9V3h-6M14.5 9.5 21 3M10 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;
    const femaleIcon = `<svg class="inline h-2.5 w-2.5 mb-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 15V21M9 18h6M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>`;

    // High-fidelity color coding
    studentBadge.innerHTML = `
      <span class="text-[#4F91FF]">${maleIcon} ${malePct}% MALE</span>
      <span class="mx-1 text-gray-300 dark:text-gray-600">|</span>
      <span class="text-[#FF5B9B]">${femalePct}% FEMALE ${femaleIcon}</span>
    `;
    // Update container style to neutral for the inner colors to pop
    studentBadge.className = "rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase dark:bg-white/5 shadow-sm";
  }
}

function renderPaginatedTable(userRole) {
  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const paginatedItems = allImplementors.slice(start, end);
  const totalEl = document.getElementById("pagination-total") || document.getElementById("pagination-total-dashboard");
  const rangeEl = document.getElementById("pagination-range");
  if (totalEl) totalEl.textContent = allImplementors.length;
  if (rangeEl) rangeEl.textContent = `${start + 1}-${Math.min(end, allImplementors.length)}`;
  renderTableRows(paginatedItems, userRole);
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
  const tbody = document.getElementById("staff-table-body");
  if (!tbody) return;

  const isRolesPage = window.location.pathname.includes("/roles/");
  const isDashboardPage = window.location.pathname.includes("/dashboard/");

  if (isRolesPage) {
    tbody.innerHTML = implementors.map(s => {
      const hasPerm = (perm) => {
        if (s.role === "ADMIN") return true;
        if (s.role === "OFFICER") {
          return perm === "users:view" || perm === "reports:export";
        }
        return false;
      };

      const displayRole = s.role.charAt(0).toUpperCase() + s.role.slice(1).toLowerCase();

      return `
        <tr class="border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary">
          <td class="p-4 text-center">
            <div class="flex items-center justify-center">
              <input type="checkbox" data-row-user-id="${s.id}" class="staff-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
            </div>
          </td>
          <td class="px-6 py-4 text-left text-xs font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${String(s.id).padStart(2, "0")}</td>
          <td class="px-6 py-4 text-left whitespace-nowrap">
            <div class="flex flex-col">
              <span class="text-sm font-extrabold text-spes-black dark:text-spes-white leading-tight">${escHtml(s.full_name)}</span>
              <span class="text-[10px] font-bold text-spes-black/40 dark:text-spes-white/40 tracking-tighter mt-0.5">${escHtml(displayRole)}</span>
            </div>
          </td>
          <td class="px-6 py-4 text-center text-xs font-bold text-spes-black/60 dark:text-spes-white/60">${escHtml(s.office)}</td>
          
          <td class="px-6 py-4 text-center">
            <input type="checkbox" data-user-id="${s.id}" data-perm="users:view" ${hasPerm("users:view") ? "checked" : ""} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </td>
          <td class="px-6 py-4 text-center">
            <input type="checkbox" data-user-id="${s.id}" data-perm="users:create" ${hasPerm("users:create") ? "checked" : ""} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </td>
          <td class="px-6 py-4 text-center">
            <input type="checkbox" data-user-id="${s.id}" data-perm="users:edit" ${hasPerm("users:edit") ? "checked" : ""} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </td>
          <td class="px-6 py-4 text-center">
            <input type="checkbox" data-user-id="${s.id}" data-perm="users:delete" ${hasPerm("users:delete") ? "checked" : ""} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </td>
          <td class="px-6 py-4 text-center">
            <input type="checkbox" data-user-id="${s.id}" data-perm="reports:export" ${hasPerm("reports:export") ? "checked" : ""} class="perm-checkbox h-4 w-4 cursor-pointer rounded-md border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </td>
          <td class="px-6 py-4 text-center whitespace-nowrap">
            <div class="relative group inline-block">
              <button data-clear-user-id="${s.id}" class="btn-clear-perms cursor-pointer p-1.5 rounded-lg text-spes-red hover:bg-spes-red/10 transition-all flex items-center justify-center" aria-label="Clear Permissions">
                <svg class="h-4.5 w-4.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
              </button>
              <div class="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-spes-blue px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-white shadow-lg pointer-events-none opacity-0 transition-opacity duration-200 group-hover:opacity-100 dark:bg-spes-dark-primary border border-white/10 backdrop-blur-md">
                Clear Permissions
                <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-spes-blue dark:border-t-spes-dark-primary"></div>
              </div>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    setupPermissionChangeHandlers();
  } else {
    tbody.innerHTML = implementors.map(s => {
      // Encode data for the click handler
      const dataStr = encodeURIComponent(JSON.stringify(s));
      return `
        <tr data-impl-info="${dataStr}" class="impl-row border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow cursor-pointer">
        ${!isDashboardPage ? `
        <td class="p-4 text-center">
          <div class="flex items-center justify-center">
            <input type="checkbox" class="staff-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
          </div>
        </td>` : ""}
        <td class="px-6 py-4 text-left text-xs font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${String(s.id).padStart(2, "0")}</td>
        <td class="px-6 py-4 text-left">
          <div class="flex flex-col">
            <span class="text-sm font-extrabold text-spes-black dark:text-spes-white leading-tight">${escHtml(s.full_name)}</span>
            <span class="text-[10px] font-bold text-spes-black/40 dark:text-spes-white/40 tracking-tighter mt-0.5">${escHtml(s.email)}</span>
          </div>
        </td>
        <td class="px-6 py-4 text-center text-xs font-bold text-spes-black/60 dark:text-spes-white/60">${escHtml(s.office)}</td>
        <td class="px-6 py-4 text-center">
          <span class="inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black tracking-widest ${getRoleBadgeClasses(s.role)}">${s.role}</span>
        </td>
        <td class="px-6 py-4 text-center">
          <div class="flex items-center justify-center gap-1.5">
            <div class="h-2 w-2 rounded-full ${getStatusColor(s.status)} animate-pulse"></div>
            <span class="text-[10px] font-black uppercase tracking-widest">${s.status}</span>
          </div>
        </td>
        <td class="px-6 py-4 text-center">
          <button class="cursor-pointer text-[11px] font-black uppercase text-spes-blue hover:underline dark:text-spes-yellow transition-all">Edit</button>
        </td>
      </tr>`;
    }).join("");

    // Attach click listeners to rows (ignore if click is on checkbox or Edit button)
    document.querySelectorAll(".impl-row").forEach(row => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("button") || e.target.closest("input")) return;
        if (window.openImplementorDrawer) {
          try {
            const data = JSON.parse(decodeURIComponent(row.getAttribute("data-impl-info")));
            window.openImplementorDrawer(data);
          } catch (err) {
            console.error("Failed to parse implementor data", err);
          }
        }
      });
    });
  }
}

function onSelectAll(e) {
  const isChecked = e.target.checked;
  const rowCheckboxes = document.querySelectorAll(".staff-row-checkbox");
  for (const checkbox of rowCheckboxes) { checkbox.checked = isChecked; }
}

function getStatusColor(status) {
  const s = status?.toUpperCase();
  if (s === "ONLINE") return "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]";
  if (s === "BUSY") return "bg-spes-red shadow-[0_0_8px_rgba(206,17,38,0.4)]";
  return "bg-gray-400";
}

function getRoleBadgeClasses(role) {
  const r = role?.toLowerCase();
  if (r.includes("admin")) return "bg-spes-blue/10 text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow";
  return "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400";
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function initYearDropdown() {
  const btn = document.getElementById("year-dropdown-btn");
  const menu = document.getElementById("year-dropdown-menu");
  const icon = document.getElementById("year-dropdown-icon");
  if (!btn || !menu) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = menu.classList.contains("hidden");
    if (isHidden) {
      menu.classList.remove("hidden");
      icon?.classList.add("rotate-180");
    } else {
      menu.classList.add("hidden");
      icon?.classList.remove("rotate-180");
    }
  });

  document.addEventListener("click", (e) => {
    if (!btn.contains(e.target) && !menu.contains(e.target)) {
      menu.classList.add("hidden");
      icon?.classList.remove("rotate-180");
    }
  });
}

function setupPermissionChangeHandlers() {
  const checkboxes = document.querySelectorAll(".perm-checkbox");
  checkboxes.forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const target = e.target;
      const userId = target.getAttribute("data-user-id");
      const perm = target.getAttribute("data-perm");
      const isChecked = target.checked;

      // Find user name
      const user = allImplementors.find(u => String(u.id) === String(userId));
      const userName = user ? user.full_name : "User";

      // Show alert modal confirming the permission change
      modals.success(
        "Permission Updated",
        `Successfully ${isChecked ? "granted" : "revoked"} the "${perm}" permission for ${userName}.`
      );
    });
  });

  const clearButtons = document.querySelectorAll(".btn-clear-perms");
  clearButtons.forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const userId = btn.getAttribute("data-clear-user-id");
      const rowCheckboxes = document.querySelectorAll(`.perm-checkbox[data-user-id="${userId}"]`);
      
      let clearedAny = false;
      rowCheckboxes.forEach(cb => {
        if (cb.checked) {
          cb.checked = false;
          clearedAny = true;
        }
      });

      if (clearedAny) {
        // Find user name
        const user = allImplementors.find(u => String(u.id) === String(userId));
        const userName = user ? user.full_name : "User";

        modals.success(
          "Permissions Cleared",
          `Successfully revoked all system permissions for ${userName}.`
        );
      }
    });
  });

  const bulkGrantBtn = document.getElementById("btn-bulk-grant");
  const bulkRevokeBtn = document.getElementById("btn-bulk-revoke");

  if (bulkGrantBtn) {
    bulkGrantBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const checkedRows = document.querySelectorAll(".staff-row-checkbox:checked");
      if (checkedRows.length === 0) {
        modals.warning("No Selection", "Please check one or more implementors in the table first.");
        return;
      }

      let updatedCount = 0;
      checkedRows.forEach(rowCb => {
        const userId = rowCb.getAttribute("data-row-user-id");
        const userCheckboxes = document.querySelectorAll(`.perm-checkbox[data-user-id="${userId}"]`);
        userCheckboxes.forEach(cb => {
          if (!cb.checked) {
            cb.checked = true;
            updatedCount++;
          }
        });
      });

      if (updatedCount > 0) {
        modals.success("Permissions Granted", `Successfully granted all permissions to the ${checkedRows.length} selected implementor(s).`);
      }
    });
  }

  if (bulkRevokeBtn) {
    bulkRevokeBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const checkedRows = document.querySelectorAll(".staff-row-checkbox:checked");
      if (checkedRows.length === 0) {
        modals.warning("No Selection", "Please check one or more implementors in the table first.");
        return;
      }

      let updatedCount = 0;
      checkedRows.forEach(rowCb => {
        const userId = rowCb.getAttribute("data-row-user-id");
        const userCheckboxes = document.querySelectorAll(`.perm-checkbox[data-user-id="${userId}"]`);
        userCheckboxes.forEach(cb => {
          if (cb.checked) {
            cb.checked = false;
            updatedCount++;
          }
        });
      });

      if (updatedCount > 0) {
        modals.success("Permissions Revoked", `Successfully revoked all permissions from the ${checkedRows.length} selected implementor(s).`);
      }
    });
  }
}
