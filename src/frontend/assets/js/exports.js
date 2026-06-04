import "../styles/tailwind.css";
import "flowbite";
import { applyPermissions, requireAuth, signOut } from "./rbac/guard.js";
import { supabase } from "../../../backend/api/supabase.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initAutoYear } from "./components/year.js";
import { initFlowbite } from "flowbite";
import { fetchOffices } from "../../../backend/api/staff.js";
import { initExportButtonTilt } from "./components/animations.js";

// ── Column definitions ────────────────────────────────────────
// Beneficiary schema: id, full_name, age, gender_id, address, contact_number,
//   relationship, year_period, month_period, birthday, designated, batch_id,
//   education_id → education(name). NO office_id, NO archive column.
const BENEF_COLUMNS = [
  { key: "id_display",     label: "ID No.",          default: true  },
  { key: "full_name",      label: "Name",             default: true  },
  { key: "age",            label: "Age",              default: true  },
  { key: "gender",         label: "Gender",           default: true  },
  { key: "education",      label: "Education Level",  default: true  },
  { key: "address",        label: "Address",          default: false },
  { key: "contact_number", label: "Contact No.",      default: false },
  { key: "relationship",   label: "Relationship",     default: false },
  { key: "birthday",       label: "Birthday",         default: false },
  { key: "designated",     label: "Designated",       default: false },
  { key: "period",         label: "Period",           default: false },
];

const IMPL_COLUMNS = [
  { key: "id_display", label: "ID No.",      default: true  },
  { key: "full_name",  label: "Name",        default: true  },
  { key: "office",     label: "Office",      default: true  },
  { key: "role",       label: "Designation", default: true  },
  { key: "status",     label: "Status",      default: true  },
  { key: "phone",      label: "Phone",       default: false },
  { key: "email",      label: "Email",       default: false },
  { key: "address",    label: "Address",     default: false },
];

// ── App state ─────────────────────────────────────────────────
let _allBeneficiaries = [];
let _allImplementors  = [];
let _allOffices       = [];
let _filteredData     = [];
let _appVersion       = "0.2.0";

const _cfg = {
  reportType:   "beneficiaries",
  columns:      BENEF_COLUMNS.filter(c => c.default).map(c => c.key),
  officeFilter: [],
  genderFilter: "all",
  statusFilter: "active",
  yearFilter:   "all",
  ageMin:       "",
  ageMax:       "",
  searchQuery:  "",
  orientation:  "landscape",
  preparedBy:   "",
  approvedBy:   "",
};

// ── Boot ──────────────────────────────────────────────────────
const session = requireAuth();
if (session) _boot(session);

async function _boot(user) {
  // Session healer: sync role_id from role string if missing
  if (user && !user.role_id && user.role) {
    if (user.role === "admin")   user.role_id = 1;
    if (user.role === "officer") user.role_id = 2;
  }

  // Refresh permissions from DB
  if (user?.role_id) {
    try {
      const { fetchRolePermissions } = await import("../../../backend/api/permissions.js");
      const { data: perms } = await fetchRolePermissions(user.role_id, { forceRefresh: true });
      if (perms) { user.permissions = perms; localStorage.setItem("spes_session", JSON.stringify(user)); }
    } catch {}
  }

  // Refresh approved status + office info (needed for RBAC office scoping in drawer)
  if (user?.id) {
    try {
      const { data } = await supabase
        .from("staffs")
        .select("approved, office_id, offices(name)")
        .eq("id", user.id)
        .single();
      if (data) {
        user.approved    = data.approved;
        user.office_id   = data.office_id   ?? user.office_id;
        user.office_name = data.offices?.name ?? user.office_name ?? null;
        localStorage.setItem("spes_session", JSON.stringify(user));
      }
    } catch {}
  }

  _populateSidebar(user);
  initThemeToggle();
  initAutoYear();
  initFlowbite();
  _initClock();
  _setActiveSidebarLink("exports");

  const nameEl = document.getElementById("header-user-name");
  if (nameEl) nameEl.textContent = user.full_name || "Admin";
  document.getElementById("sign-out-btn")?.addEventListener("click", signOut);

  // Read version from Vite env
  const v = import.meta.env.VITE_APP_VERSION;
  if (v) {
    _appVersion = v;
    const verEl = document.getElementById("preview-version");
    if (verEl) verEl.textContent = v;
  }

  await applyPermissions(user.role);
  initExportButtonTilt();

  // RBAC: officers without export_reports are redirected
  const isAdmin = user.role === "admin";
  const canExport = isAdmin || Boolean(user.permissions?.export_reports);
  if (!canExport) {
    const { modals } = await import("./components/modals.js");
    modals.error("Access Denied", "You do not have permission to access Exports & Reports.").then(() => {
      window.location.href = "/src/frontend/pages/dashboard/";
    });
    return;
  }

  // Load data then render
  await _loadData(user);
  _applyFilters();
  _renderPreviewTable();
  _initDrawer(user);
  _wireButtons();
}

// ── Data loading ──────────────────────────────────────────────
async function _loadData(user) {
  const isAdmin = user.role === "admin";

  const [officesRes] = await Promise.all([fetchOffices()]);
  _allOffices = officesRes.data ?? [];

  // ── Beneficiaries ──
  // Schema: NO office_id, NO archive_at. FK to education(name) via education_id.
  // Grouped by year_period in the preview since there is no office field.
  try {
    const { data, error } = await supabase
      .from("beneficiary")
      .select("id, full_name, age, gender_id, address, contact_number, relationship, year_period, month_period, birthday, designated, batch_id, education_id, education(name)")
      .order("id", { ascending: true });
    if (import.meta.env.DEV && error) console.warn("[SPES Exports] beneficiary fetch:", error.message);
    _allBeneficiaries = (data ?? []).map(b => ({
      ...b,
      id_display: `ROX-RD-ESIG-${String(b.year_period ?? new Date().getFullYear()).slice(-4)}-${String(b.id).padStart(4, "0")}`,
      gender:     b.gender_id === 1 ? "Male" : b.gender_id === 2 ? "Female" : "N/A",
      education:  b.education?.name ?? _eduLabel(b.education_id),
      period:     [b.month_period, b.year_period].filter(Boolean).join(" ") || "N/A",
      birthday:   b.birthday
                    ? new Date(b.birthday).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
                    : "N/A",
      // group_key used internally for preview/print grouping
      _group:     b.year_period ? `Year ${b.year_period}` : "Period N/A",
    }));
  } catch (e) {
    if (import.meta.env.DEV) console.error("[SPES Exports] beneficiary error:", e);
  }

  // ── Implementors — always fetch ALL, same RBAC scoping in drawer UI ──
  try {
    const { data, error } = await supabase
      .from("staffs")
      .select("id, full_name, email, phone, address, status, role_id, office_id, approved, archive_at, offices(name), roles(name)")
      .order("id", { ascending: true });
    if (import.meta.env.DEV && error) console.warn("[SPES Exports] staffs fetch:", error.message);
    _allImplementors = (data ?? []).map(s => ({
      ...s,
      id_display: `ROX-RD-IMPL-${String(s.id).padStart(4, "0")}`,
      office:     s.offices?.name ?? "N/A",
      role:       s.roles?.name ?? "N/A",
      status:     s.archive_at ? "Archived" : (s.status ?? "Offline"),
      _group:     s.offices?.name ?? "Unknown",
    }));
  } catch (e) {
    if (import.meta.env.DEV) console.error("[SPES Exports] staffs error:", e);
  }
}

function _eduLabel(id) {
  return { 1: "Senior High", 2: "College Graduate", 3: "College Level", 4: "High School" }[id] ?? "N/A";
}

// ── Filter engine ─────────────────────────────────────────────
function _applyFilters() {
  const isBenef = _cfg.reportType === "beneficiaries";
  let data = [...(isBenef ? _allBeneficiaries : _allImplementors)];

  // Office filter — implementors only (beneficiary table has no office_id)
  if (!isBenef && _cfg.officeFilter.length > 0)
    data = data.filter(r => _cfg.officeFilter.includes(r.office));

  if (isBenef && _cfg.genderFilter !== "all")
    data = data.filter(r => (r.gender ?? "").toLowerCase() === _cfg.genderFilter);

  // Status filter — implementors only (beneficiary table has no archive column)
  if (!isBenef) {
    if (_cfg.statusFilter === "active")    data = data.filter(r => !r.archive_at);
    else if (_cfg.statusFilter === "archived") data = data.filter(r => Boolean(r.archive_at));
  }

  if (isBenef && _cfg.yearFilter !== "all")
    data = data.filter(r => String(r.year_period) === _cfg.yearFilter);

  if (_cfg.ageMin) data = data.filter(r => Number(r.age) >= Number(_cfg.ageMin));
  if (_cfg.ageMax) data = data.filter(r => Number(r.age) <= Number(_cfg.ageMax));

  if (_cfg.searchQuery) {
    const q = _cfg.searchQuery.toLowerCase();
    data = data.filter(r =>
      (r.full_name ?? "").toLowerCase().includes(q) ||
      (r.id_display ?? "").toLowerCase().includes(q)
    );
  }

  _filteredData = data;

  // Update count badge
  const el = document.getElementById("preview-count");
  if (el) el.textContent = `${_filteredData.length.toLocaleString()} Record${_filteredData.length !== 1 ? "s" : ""}`;

  // Update filter summary
  const summary = document.getElementById("preview-filter-summary");
  if (summary) {
    const parts = [];
    const isBenef = _cfg.reportType === "beneficiaries";
    if (!isBenef) {
      parts.push(_cfg.officeFilter.length > 0 ? _cfg.officeFilter.join(", ") : "ALL OFFICES");
      if (_cfg.statusFilter !== "all") parts.push(`STATUS: ${_cfg.statusFilter.toUpperCase()}`);
    }
    if (_cfg.genderFilter !== "all") parts.push(`GENDER: ${_cfg.genderFilter.toUpperCase()}`);
    if (_cfg.yearFilter !== "all")   parts.push(`YEAR: ${_cfg.yearFilter}`);
    summary.textContent = parts.join(" · ") || (isBenef ? "ALL SPES BENEFICIARIES" : "ALL OFFICES");
  }

  // Update generated date
  const dateEl = document.getElementById("preview-generated-date");
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = `Generated: ${now.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" })} ${now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })}`;
  }
}

// ── Preview table renderer ────────────────────────────────────
function _renderPreviewTable() {
  const colDefs = _cfg.reportType === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS;
  const cols    = colDefs.filter(c => _cfg.columns.includes(c.key));

  const thead = document.getElementById("preview-thead");
  if (thead) {
    thead.innerHTML = `<tr class="bg-[#0038A8] dark:bg-[#002878]">
      ${cols.map(c => `<th class="px-4 py-3 text-center text-[10px] font-black uppercase tracking-[0.15em] text-white whitespace-nowrap">${c.label}</th>`).join("")}
    </tr>`;
  }

  const tbody = document.getElementById("preview-tbody");
  if (!tbody) return;

  if (_filteredData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${cols.length}" class="text-center py-12 text-sm text-gray-400 dark:text-white/30 font-bold uppercase tracking-wider">No records found matching your filters.</td></tr>`;
    return;
  }

  // Group rows — beneficiaries → by year period; implementors → by office
  const isBenef    = _cfg.reportType === "beneficiaries";
  const groupLabel = (key) => isBenef ? `PERIOD: ${key}` : `OFFICE: ${key}`;
  const groups = {};
  _filteredData.forEach(r => {
    const k = r._group || "Unknown";
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  tbody.innerHTML = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const groupRow = `<tr class="bg-blue-50/50 dark:bg-white/[0.03]">
        <td colspan="${cols.length}" class="px-4 py-2 text-[9.5px] font-black uppercase tracking-[0.25em] text-spes-blue/70 dark:text-spes-yellow/60">
          ${groupLabel(_esc(key))}
        </td>
      </tr>`;
      const dataRows = rows.map((r, idx) => `
        <tr class="${idx % 2 === 0 ? "bg-white dark:bg-spes-dark-primary" : "bg-gray-50/50 dark:bg-white/[0.025]"} border-b border-gray-100 dark:border-white/5 hover:bg-spes-blue/5 dark:hover:bg-spes-yellow/5 transition-colors duration-150">
          ${cols.map(c => `<td class="px-4 py-3 text-[11px] font-${c.key === "full_name" ? "extrabold" : "medium"} text-${c.key === "full_name" ? "left" : "center"} whitespace-nowrap">${_cellHtml(r, c.key)}</td>`).join("")}
        </tr>`).join("");
      return groupRow + dataRows;
    }).join("");
}

function _cellHtml(row, key) {
  const raw = row[key];
  if (raw === null || raw === undefined || raw === "") return `<span class="text-gray-300 dark:text-white/20">—</span>`;
  const val = String(raw);
  if (key === "status") {
    const isArchived = val.toLowerCase() === "archived";
    return isArchived
      ? `<span class="inline-flex rounded px-2 py-0.5 text-[9.5px] font-black uppercase tracking-wider bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">${_esc(val)}</span>`
      : `<span class="inline-flex rounded px-2 py-0.5 text-[9.5px] font-black uppercase tracking-wider bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400">${_esc(val.toUpperCase())}</span>`;
  }
  if (key === "gender") {
    const isMale = val.toLowerCase() === "male";
    return `<span class="font-black ${isMale ? "text-sky-600 dark:text-sky-400" : "text-pink-600 dark:text-pink-400"}">${_esc(val)}</span>`;
  }
  if (key === "id_display") return `<span class="font-bold tabular-nums text-spes-blue dark:text-spes-yellow">${_esc(val)}</span>`;
  if (key === "full_name") return `<span class="font-extrabold text-spes-black dark:text-spes-white">${_esc(val.toUpperCase())}</span>`;
  return `<span class="text-spes-black/80 dark:text-spes-white/80">${_esc(val)}</span>`;
}

// ── Configure Drawer ──────────────────────────────────────────
function _initDrawer(user) {
  const isAdmin = user.role === "admin";

  // An officer can view ALL offices in the filter only if they have `users:view` permission.
  // Without it the export is scoped to their own office and the filter is hidden.
  const canViewOtherOffices = isAdmin || Boolean(user.permissions?.view_users);

  // Hide Implementors tab for non-admins without users:view
  if (!isAdmin && !Boolean(user.permissions?.view_users)) {
    document.getElementById("cfg-tab-implementors")?.classList.add("hidden");
  }

  // Populate office checkboxes (always render all offices)
  const officeList    = document.getElementById("cfg-office-list");
  const officeSection = document.getElementById("cfg-office-section");

  if (officeList && _allOffices.length > 0) {
    officeList.innerHTML = _allOffices.map(o => `
      <label class="cursor-pointer flex items-center gap-2.5 px-3 py-2 hover:bg-spes-blue/5 dark:hover:bg-white/5 transition-colors">
        <input type="checkbox" class="cfg-office-check h-3.5 w-3.5 rounded border-gray-300 text-spes-blue cursor-pointer focus:ring-spes-blue/20 dark:border-white/20 dark:text-spes-yellow"
          value="${_esc(o.name)}" data-office-id="${o.id}" />
        <span class="text-xs font-semibold text-spes-black dark:text-spes-white leading-tight">${_esc(o.name)}</span>
      </label>`).join("");
  } else if (officeList) {
    officeList.innerHTML = `<p class="px-3 py-3 text-center text-[10px] text-gray-400 dark:text-white/30 italic">No offices available.</p>`;
  }

  // Beneficiaries tab is the default — office/status sections irrelevant for that schema
  officeSection?.classList.add("hidden");
  document.getElementById("cfg-status-wrapper")?.classList.add("hidden");

  if (!canViewOtherOffices) {
    // ── Restricted officer: pre-set their office so implementors tab is auto-scoped ──
    const officeName = user.office_name ?? null;
    const officeId   = user.office_id   ?? null;

    if (officeName) {
      _cfg.officeFilter = [officeName];
      const cb = officeList?.querySelector(
        officeId ? `.cfg-office-check[data-office-id="${officeId}"]` : `.cfg-office-check[value="${_esc(officeName)}"]`
      );
      if (cb) cb.checked = true;
    }
    // officeSection stays hidden for restricted officers even on implementors tab
  }

  _renderColumnCheckboxes();
}

function _renderColumnCheckboxes() {
  const colDefs = _cfg.reportType === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS;
  const container = document.getElementById("cfg-columns-list");
  if (!container) return;
  container.innerHTML = colDefs.map(c => `
    <label class="cursor-pointer flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-spes-blue/5 dark:hover:bg-white/5 transition-colors">
      <input type="checkbox" class="cfg-col-check h-3.5 w-3.5 rounded border-gray-300 text-spes-blue cursor-pointer focus:ring-spes-blue/20 dark:border-white/20 dark:text-spes-yellow" value="${c.key}" ${_cfg.columns.includes(c.key) ? "checked" : ""} />
      <span class="text-xs font-semibold text-spes-black dark:text-spes-white">${c.label}</span>
      ${c.default ? `<span class="ml-auto text-[8px] font-black uppercase tracking-wider text-spes-blue/50 dark:text-spes-yellow/40">Default</span>` : ""}
    </label>`).join("");
}

// ── Button wiring ─────────────────────────────────────────────
function _wireButtons() {
  const drawer  = document.getElementById("configure-drawer");
  const overlay = document.getElementById("configure-drawer-overlay");

  const openDrawer = () => {
    drawer?.classList.remove("translate-x-full");
    drawer?.classList.add("translate-x-0");
    overlay?.classList.remove("hidden");
    document.body.classList.add("overflow-hidden");
  };

  const closeDrawer = () => {
    drawer?.classList.add("translate-x-full");
    drawer?.classList.remove("translate-x-0");
    overlay?.classList.add("hidden");
    document.body.classList.remove("overflow-hidden");
  };

  document.getElementById("btn-configure-reports")?.addEventListener("click", openDrawer);
  document.getElementById("btn-close-config-drawer")?.addEventListener("click", closeDrawer);
  overlay?.addEventListener("click", closeDrawer);

  // Report type tabs
  const _switchTab = (type) => {
    _cfg.reportType = type;
    _cfg.columns = (type === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS)
      .filter(c => c.default).map(c => c.key);
    _renderColumnCheckboxes();
    _syncFromDrawer();
    _applyFilters();
    _renderPreviewTable();
    _updateTabUI();

    const isBenef = type === "beneficiaries";
    // Gender + year + age filters — beneficiaries only
    document.getElementById("cfg-gender-wrapper")?.classList.toggle("hidden", !isBenef);
    document.getElementById("cfg-year-wrapper")?.classList.toggle("hidden", !isBenef);
    document.getElementById("cfg-age-wrapper")?.classList.toggle("hidden", !isBenef);
    // Office + status filters — implementors only (beneficiary table has no office/archive)
    document.getElementById("cfg-office-section")?.classList.toggle("hidden", isBenef);
    document.getElementById("cfg-status-wrapper")?.classList.toggle("hidden", isBenef);
  };

  document.getElementById("cfg-tab-beneficiaries")?.addEventListener("click", () => _switchTab("beneficiaries"));
  document.getElementById("cfg-tab-implementors")?.addEventListener("click",  () => _switchTab("implementors"));

  // Apply config
  document.getElementById("btn-apply-config")?.addEventListener("click", () => {
    _syncFromDrawer();
    _applyFilters();
    _renderPreviewTable();
    closeDrawer();
  });

  // Reset config
  document.getElementById("btn-reset-config")?.addEventListener("click", () => {
    _cfg.officeFilter = [];
    _cfg.genderFilter = "all";
    _cfg.statusFilter = "active";
    _cfg.yearFilter   = "all";
    _cfg.ageMin       = "";
    _cfg.ageMax       = "";
    _cfg.searchQuery  = "";
    _cfg.orientation  = "landscape";
    _cfg.preparedBy   = "";
    _cfg.approvedBy   = "";
    _cfg.columns = (_cfg.reportType === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS)
      .filter(c => c.default).map(c => c.key);
    _resetDrawerUI();
    _renderColumnCheckboxes();
    _applyFilters();
    _renderPreviewTable();
  });

  // Select all columns
  document.getElementById("btn-select-all-cols")?.addEventListener("click", () => {
    document.querySelectorAll(".cfg-col-check").forEach(cb => { cb.checked = true; });
    _cfg.columns = (_cfg.reportType === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS).map(c => c.key);
    _applyFilters();
    _renderPreviewTable();
  });

  // Live: search
  document.getElementById("cfg-search")?.addEventListener("input", e => {
    _cfg.searchQuery = e.target.value.trim();
    _applyFilters();
    _renderPreviewTable();
  });

  // Live: office search filter input
  document.getElementById("cfg-office-search")?.addEventListener("input", e => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll("#cfg-office-list label").forEach(lbl => {
      const txt = lbl.querySelector("span")?.textContent?.toLowerCase() ?? "";
      lbl.style.display = (!q || txt.includes(q)) ? "" : "none";
    });
  });

  // Select All / Clear All offices toggle
  const btnSelectAllOffices = document.getElementById("btn-select-all-offices");
  if (btnSelectAllOffices) {
    btnSelectAllOffices.addEventListener("click", () => {
      const boxes = [...document.querySelectorAll(".cfg-office-check")];
      // Visible boxes only (respects office search filter)
      const visibleBoxes = boxes.filter(cb => (cb.closest("label")?.style.display ?? "") !== "none");
      const allChecked = visibleBoxes.length > 0 && visibleBoxes.every(cb => cb.checked);

      if (allChecked) {
        // Deselect all visible
        visibleBoxes.forEach(cb => { cb.checked = false; });
        btnSelectAllOffices.textContent = "Select All";
      } else {
        // Select all visible
        visibleBoxes.forEach(cb => { cb.checked = true; });
        btnSelectAllOffices.textContent = "Clear All";
      }

      _cfg.officeFilter = [...document.querySelectorAll(".cfg-office-check:checked")].map(cb => cb.value);
      _applyFilters();
      _renderPreviewTable();
    });
  }

  // Live: column checkboxes
  document.getElementById("cfg-columns-list")?.addEventListener("change", () => {
    _cfg.columns = [...document.querySelectorAll(".cfg-col-check:checked")].map(cb => cb.value);
    _applyFilters();
    _renderPreviewTable();
  });

  // Live: office checkboxes — also updates the Select All button label
  document.getElementById("cfg-office-list")?.addEventListener("change", () => {
    _cfg.officeFilter = [...document.querySelectorAll(".cfg-office-check:checked")].map(cb => cb.value);
    _applyFilters();
    _renderPreviewTable();
    // Sync button label
    const boxes = [...document.querySelectorAll(".cfg-office-check")];
    const allChecked = boxes.length > 0 && boxes.every(cb => cb.checked);
    const btn = document.getElementById("btn-select-all-offices");
    if (btn) btn.textContent = allChecked ? "Clear All" : "Select All";
  });

  // Live: select/radio inputs
  ["cfg-gender", "cfg-status", "cfg-year"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", e => {
      if (id === "cfg-gender") _cfg.genderFilter = e.target.value;
      if (id === "cfg-status") _cfg.statusFilter = e.target.value;
      if (id === "cfg-year")   _cfg.yearFilter   = e.target.value;
      _applyFilters();
      _renderPreviewTable();
    });
  });

  document.getElementById("cfg-age-min")?.addEventListener("input", e => { _cfg.ageMin = e.target.value; _applyFilters(); _renderPreviewTable(); });
  document.getElementById("cfg-age-max")?.addEventListener("input", e => { _cfg.ageMax = e.target.value; _applyFilters(); _renderPreviewTable(); });

  document.getElementById("cfg-orientation-landscape")?.addEventListener("change", () => { _cfg.orientation = "landscape"; });
  document.getElementById("cfg-orientation-portrait")?.addEventListener("change",  () => { _cfg.orientation = "portrait"; });

  document.getElementById("cfg-prepared-by")?.addEventListener("input", e => { _cfg.preparedBy = e.target.value; });
  document.getElementById("cfg-approved-by")?.addEventListener("input", e => { _cfg.approvedBy = e.target.value; });

  // Export buttons
  document.getElementById("btn-export-excel")?.addEventListener("click", _exportCSV);
  document.getElementById("btn-print-paper")?.addEventListener("click", _print);
}

function _syncFromDrawer() {
  _cfg.columns      = [...document.querySelectorAll(".cfg-col-check:checked")].map(cb => cb.value);
  _cfg.officeFilter = [...document.querySelectorAll(".cfg-office-check:checked")].map(cb => cb.value);
  const g = document.getElementById("cfg-gender");   if (g) _cfg.genderFilter = g.value;
  const s = document.getElementById("cfg-status");   if (s) _cfg.statusFilter = s.value;
  const y = document.getElementById("cfg-year");     if (y) _cfg.yearFilter   = y.value;
  const amin = document.getElementById("cfg-age-min"); if (amin) _cfg.ageMin  = amin.value;
  const amax = document.getElementById("cfg-age-max"); if (amax) _cfg.ageMax  = amax.value;
  const pb = document.getElementById("cfg-prepared-by"); if (pb) _cfg.preparedBy = pb.value;
  const ab = document.getElementById("cfg-approved-by"); if (ab) _cfg.approvedBy = ab.value;
  const lc = document.getElementById("cfg-orientation-landscape");
  if (lc) _cfg.orientation = lc.checked ? "landscape" : "portrait";
}

function _resetDrawerUI() {
  document.querySelectorAll(".cfg-office-check").forEach(cb => { cb.checked = false; });
  const selAllBtn = document.getElementById("btn-select-all-offices");
  if (selAllBtn) selAllBtn.textContent = "Select All";
  const g = document.getElementById("cfg-gender"); if (g) g.value = "all";
  const s = document.getElementById("cfg-status"); if (s) s.value = "active";
  const y = document.getElementById("cfg-year");   if (y) y.value = "all";
  const amin = document.getElementById("cfg-age-min"); if (amin) amin.value = "";
  const amax = document.getElementById("cfg-age-max"); if (amax) amax.value = "";
  const lc = document.getElementById("cfg-orientation-landscape"); if (lc) lc.checked = true;
  const lp = document.getElementById("cfg-orientation-portrait");  if (lp) lp.checked = false;
  const pb = document.getElementById("cfg-prepared-by"); if (pb) pb.value = "";
  const ab = document.getElementById("cfg-approved-by"); if (ab) ab.value = "";
  const qs = document.getElementById("cfg-search");      if (qs) qs.value = "";
}

function _updateTabUI() {
  const isBenef = _cfg.reportType === "beneficiaries";
  const tabB = document.getElementById("cfg-tab-beneficiaries");
  const tabI = document.getElementById("cfg-tab-implementors");
  const active   = ["bg-spes-blue","text-white","dark:bg-spes-yellow","dark:text-spes-dark-primary","shadow-sm"];
  const inactive = ["text-spes-black/60","dark:text-white/60","hover:text-spes-blue","dark:hover:text-spes-yellow"];
  if (isBenef) {
    tabB?.classList.add(...active);    tabB?.classList.remove(...inactive);
    tabI?.classList.remove(...active); tabI?.classList.add(...inactive);
  } else {
    tabI?.classList.add(...active);    tabI?.classList.remove(...inactive);
    tabB?.classList.remove(...active); tabB?.classList.add(...inactive);
  }
}

// ── Excel / CSV export ────────────────────────────────────────
function _exportCSV() {
  const colDefs = _cfg.reportType === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS;
  const cols    = colDefs.filter(c => _cfg.columns.includes(c.key));
  const q       = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header  = cols.map(c => q(c.label)).join(",");
  const rows    = _filteredData.map(r => cols.map(c => q(r[c.key] ?? "—")).join(","));
  const csv     = [header, ...rows].join("\r\n");
  const blob    = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url     = URL.createObjectURL(blob);
  const a       = Object.assign(document.createElement("a"), { href: url });
  const now     = new Date();
  a.download    = `SPES_${_cfg.reportType === "beneficiaries" ? "Beneficiaries" : "Implementors"}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Print ─────────────────────────────────────────────────────
function _print() {
  const colDefs = _cfg.reportType === "beneficiaries" ? BENEF_COLUMNS : IMPL_COLUMNS;
  const cols    = colDefs.filter(c => _cfg.columns.includes(c.key));
  const now     = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  // Filter summary line
  const isBenefPrint = _cfg.reportType === "beneficiaries";
  const parts = [];
  if (!isBenefPrint) {
    parts.push(_cfg.officeFilter.length > 0 ? _cfg.officeFilter.join(", ") : "ALL OFFICES");
    if (_cfg.statusFilter !== "all") parts.push(`STATUS: ${_cfg.statusFilter.toUpperCase()}`);
  }
  if (_cfg.genderFilter !== "all") parts.push(`GENDER: ${_cfg.genderFilter.toUpperCase()}`);
  if (_cfg.yearFilter   !== "all") parts.push(`YEAR: ${_cfg.yearFilter}`);
  if (parts.length === 0) parts.push(isBenefPrint ? "ALL SPES BENEFICIARIES" : "ALL OFFICES");

  // Group rows — beneficiaries by year period, implementors by office
  const printGroupLabel = (key) => isBenefPrint ? `PERIOD: ${key}` : `OFFICE: ${key}`;
  const groups = {};
  _filteredData.forEach(r => {
    const k = r._group || "Unknown";
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const tableBody = Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => {
      const officeRow = `<tr style="background:#EFF6FF;border-bottom:1px solid #DBEAFE;">
        <td colspan="${cols.length}" style="padding:7px 16px;font-size:9px;font-weight:900;letter-spacing:0.22em;text-transform:uppercase;color:#1D4ED8;">${printGroupLabel(key)}</td>
      </tr>`;
      const dataRows = rows.map((r, idx) => `
        <tr style="background:${idx % 2 === 0 ? "#FFFFFF" : "#F9FAFB"};border-bottom:1px solid #F3F4F6;">
          ${cols.map(c => {
            const val = String(r[c.key] ?? "—");
            const isName   = c.key === "full_name";
            const isStatus = c.key === "status";
            const isGender = c.key === "gender";
            const isId     = c.key === "id_display";
            let color  = "#111827";
            let weight = isName ? "700" : "500";
            if (isStatus) color = val.toLowerCase() === "archived" ? "#B45309" : "#059669";
            if (isGender) color = val.toLowerCase() === "male" ? "#0284C7" : "#DB2777";
            if (isId)     color = "#0038A8";
            return `<td style="padding:6px 14px;font-size:10px;font-weight:${weight};text-align:${isName ? "left" : "center"};color:${color};white-space:nowrap;">${val}</td>`;
          }).join("")}
        </tr>`).join("");
      return officeRow + dataRows;
    }).join("");

  const logoPath = "/c_spes.png";

  // NOTE: We use <div> throughout — NOT <header>/<main>/<footer>.
  // The page's print CSS rule `body > main > *:not(#print-area) { display:none }`
  // would also match <main> or <header> children inside #print-area via the generic
  // `main > *` selector, hiding the table. Plain divs are immune to that rule.
  document.getElementById("print-area").innerHTML = `
    <!-- Fixed watermark — repeats on every page -->
    <div style="position:fixed;inset:0;z-index:0;display:flex;align-items:center;justify-content:center;pointer-events:none;overflow:hidden;opacity:0.04;filter:grayscale(1) blur(1.5px);">
      <img src="${logoPath}" style="width:58%;height:auto;object-fit:contain;" alt="">
    </div>

    <!-- Content wrapper: flex column fills page so signatures stay at bottom -->
    <div style="position:relative;z-index:10;display:flex;flex-direction:column;flex:1;min-height:100%;width:100%;box-sizing:border-box;">

      <!-- Document header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:2.5px solid #0038A8;padding:8px 0 12px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:14px;">
          <img src="${logoPath}" style="height:72px;width:72px;border-radius:50%;padding:4px;background:#fff;object-fit:contain;border:2px solid rgba(0,56,168,0.15);" alt="DOLE Logo">
          <div>
            <div style="font-size:19px;font-weight:900;color:#0038A8;text-transform:uppercase;letter-spacing:-0.02em;line-height:1.1;margin:0 0 4px;">Department of Labor and Employment</div>
            <div style="font-size:9px;font-weight:700;color:#6B7280;text-transform:uppercase;letter-spacing:0.2em;margin:0 0 2px;">Lanao del Norte Provincial Field Office</div>
            <div style="font-size:8.5px;color:#9CA3AF;font-weight:500;margin:0;">OREDC Building, Badelles St. Extension, Barangay Ubaldo Laya, Iligan City</div>
          </div>
        </div>
        <div style="text-align:right;padding-top:2px;">
          <div style="font-size:14px;font-weight:900;color:#CE1126;text-transform:uppercase;letter-spacing:-0.01em;margin:0 0 6px;">SPES Monitoring Report</div>
          <div style="display:inline-block;background:#F3F4F6;border-radius:9999px;padding:3px 12px;font-size:9px;font-weight:600;color:#6B7280;">
            Generated: <strong style="color:#374151;">${dateStr} ${timeStr}</strong>
          </div>
          <div style="margin:5px 0 0;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:#9CA3AF;">${parts.join(" · ")}</div>
        </div>
      </div>

      <!-- Data table — grows to fill available space -->
      <div style="flex:1;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;font-family:Inter,Arial,sans-serif;">
          <thead>
            <tr style="background:#0038A8;">
              ${cols.map(c => `<th style="padding:10px 14px;text-align:center;font-size:9.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#FFFFFF;white-space:nowrap;">${c.label}</th>`).join("")}
            </tr>
          </thead>
          <tbody>${tableBody}</tbody>
        </table>
      </div>

      <!-- Signature lines — pinned after the table, avoids page break split -->
      <div style="margin-top:auto;display:flex;align-items:flex-start;justify-content:space-between;padding:0 48px;page-break-inside:avoid;">
        <div style="width:240px;">
          <p style="margin:0 0 18px;font-size:10px;font-weight:600;color:#000;font-style:italic;">Prepared by:</p>
          <div style="border-bottom:1px solid #000;padding:0 16px 4px;text-align:center;">
            <strong style="font-size:10px;display:block;min-height:1.4em;text-transform:uppercase;letter-spacing:0.05em;">${_cfg.preparedBy || ""}</strong>
          </div>
          <p style="font-size:8px;text-align:center;margin-top:4px;color:#000;font-weight:500;opacity:0.65;">Printed Name &amp; Signature</p>
        </div>
        <div style="width:240px;">
          <p style="margin:0 0 18px;font-size:10px;font-weight:600;color:#000;font-style:italic;">Approved by:</p>
          <div style="border-bottom:1px solid #000;padding:0 16px 4px;text-align:center;">
            <strong style="font-size:10px;display:block;min-height:1.4em;text-transform:uppercase;letter-spacing:0.05em;">${_cfg.approvedBy || ""}</strong>
          </div>
          <p style="font-size:8px;text-align:center;margin-top:4px;color:#000;font-weight:500;opacity:0.65;">Printed Name &amp; Signature</p>
        </div>
      </div>

      <!-- Footer -->
      <div style="text-align:center;border-top:1px solid #F3F4F6;padding:10px 16px;margin-top:16px;background:#fff;">
        <p style="font-size:8px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;margin:0;">
          &copy; ${now.getFullYear()} System V${_appVersion}
          <span style="opacity:0.5;"> Developed by </span>
          <span style="color:#0038A8;font-weight:900;">Mark Jordan Ugtong</span>
          <span style="margin:0 8px;color:#E5E7EB;">|</span>
          Exclusive Property of DOLE Iligan City
        </p>
      </div>

    </div>
  `;

  // Inject @page orientation style
  let styleEl = document.getElementById("spes-print-page-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "spes-print-page-style";
    document.head.appendChild(styleEl);
  }
  // Landscape: tighter side margins to maximise usable width (~277mm on A4)
  // Portrait:  slightly more breathing room on the sides
  const margin = _cfg.orientation === "landscape" ? "8mm 10mm" : "10mm 14mm";
  styleEl.textContent = `
    @media print { 
      @page { size: ${_cfg.orientation}; margin: ${margin}; } 
      #print-area { zoom: 0.92; } /* Shrinks layout to prevent margin collision */
    }
  `;

  window.print();
}

// ── Sidebar helpers ───────────────────────────────────────────
function _populateSidebar(user) {
  const nameEl    = document.getElementById("sidebar-user-name");
  const emailEl   = document.getElementById("sidebar-user-email");
  const avatarEl  = document.getElementById("sidebar-user-avatar");
  const roleBadge = document.getElementById("sidebar-role-badge");
  if (nameEl)    nameEl.textContent  = user.full_name || "Implementor";
  if (emailEl)   emailEl.textContent = user.email || "";
  if (avatarEl)  avatarEl.textContent = (user.full_name || "U").split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
  if (roleBadge) roleBadge.textContent = user.role_label || user.role;
}

function _setActiveSidebarLink(navId) {
  document.querySelectorAll(".sidebar-link").forEach(link => {
    const isMatch = link.getAttribute("data-nav-item") === navId;
    if (isMatch) {
      link.classList.add("bg-spes-blue/10", "dark:bg-spes-yellow/15", "text-spes-blue", "dark:text-spes-yellow");
    } else {
      link.classList.remove("bg-spes-blue/10", "dark:bg-spes-yellow/15", "text-spes-blue", "dark:text-spes-yellow",
        "bg-spes-blue/8", "dark:bg-spes-white/8");
    }
  });
  // Keep sidebar dropdown open if previously open
  const ul  = document.getElementById("sidebar-dropdown-users");
  const btn = document.querySelector('[aria-controls="sidebar-dropdown-users"]');
  if (ul && btn) {
    const wasOpen = document.cookie.includes("spes_user_management_open=true");
    if (wasOpen) {
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

function _esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}
