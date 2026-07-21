/**
 * SPES Portal — Beneficiary Directory Component
 * ───────────────────────────────────────────────
 * Reads from / writes to the `beneficiary` Supabase table.
 * Features: paginated table, side drawer, add / edit / archive modals.
 *
 * Requires: migration_beneficiary_archive.sql applied to add `archived_at`.
 */
import {
  fetchBeneficiaries,
  addBeneficiary,
  updateBeneficiary,
  archiveBeneficiary,
  fetchBatches,
  addBatch,
  updateBatch,
  invalidateBatchCache,
} from "../../../../backend/api/beneficiary.js";
import { fetchImplementorList } from "../../../../backend/api/auth.js";
import { getSession } from "../rbac/guard.js";
import { supabase } from "../../../../backend/api/supabase.js";
import { setupSortFiltration } from "./sort-filtration.js";
import { modals } from "./modals.js";

// ── Office badge color palette (cycles through offices) ───────────
const OFFICE_BADGE_PALETTES = [
  { bg: "bg-sky-500/20",     text: "text-sky-200",     border: "border-sky-400/30",     ring: "ring-sky-400/60",     activeBg: "bg-sky-500/40"     },
  { bg: "bg-emerald-500/20", text: "text-emerald-200", border: "border-emerald-400/30", ring: "ring-emerald-400/60", activeBg: "bg-emerald-500/40" },
  { bg: "bg-amber-500/20",   text: "text-amber-200",   border: "border-amber-400/30",   ring: "ring-amber-400/60",   activeBg: "bg-amber-500/40"   },
  { bg: "bg-fuchsia-500/20", text: "text-fuchsia-200", border: "border-fuchsia-400/30", ring: "ring-fuchsia-400/60", activeBg: "bg-fuchsia-500/40" },
  { bg: "bg-rose-500/20",    text: "text-rose-200",    border: "border-rose-400/30",    ring: "ring-rose-400/60",    activeBg: "bg-rose-500/40"    },
  { bg: "bg-violet-500/20",  text: "text-violet-200",  border: "border-violet-400/30",  ring: "ring-violet-400/60",  activeBg: "bg-violet-500/40"  },
  { bg: "bg-cyan-500/20",    text: "text-cyan-200",    border: "border-cyan-400/30",    ring: "ring-cyan-400/60",    activeBg: "bg-cyan-500/40"    },
  { bg: "bg-orange-500/20",  text: "text-orange-200",  border: "border-orange-400/30",  ring: "ring-orange-400/60",  activeBg: "bg-orange-500/40"  },
];

// ── Constants ─────────────────────────────────────────────────
const ROWS_PER_PAGE = 10;

// ── URL state helpers ─────────────────────────────────────────
function _getUrlParam(key) {
  return new URLSearchParams(window.location.search).get(key);
}

function _setUrlParam(key, val) {
  const params = new URLSearchParams(window.location.search);
  if (val === null || val === undefined) {
    params.delete(key);
  } else {
    params.set(key, val);
  }
  const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
  history.replaceState(null, "", newUrl);
}

function _clearUrlParam(key) {
  _setUrlParam(key, null);
}


// ── Helpers ───────────────────────────────────────────────────
function formatPeriod(row) {
  const parts = [row.month_period, row.year_period].filter(Boolean);
  return parts.join(" ") || "N/A";
}


function formatDate(iso) {
  if (!iso) return "N/A";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function _bdfCollect() {
  const g = (id) => document.getElementById(id)?.value?.trim() ?? "";
  return {
    full_name: g("bdf-full-name"),
    designated: g("bdf-designated"),
    relationship: g("bdf-relationship"),
    address: g("bdf-address"),
    month_period: g("bdf-month-period"),
    year_period: g("bdf-year-period"),
    contact_number: g("bdf-contact"),
    gender_id: g("bdf-gender") !== "" && g("bdf-gender") != null ? parseInt(g("bdf-gender"), 10) : null,
    birthday: g("bdf-birthday") || null,
    age: g("bdf-age") || null,
    educ_id: g("bdf-education") !== "" && g("bdf-education") != null ? parseInt(g("bdf-education"), 10) : null,
    batch_id: g("bdf-batch-id") || null,
    staff_id: g("bdf-assign-staff") !== "" && g("bdf-assign-staff") != null ? parseInt(g("bdf-assign-staff"), 10) : null,
  };
}

function _bdfFill(defaults = {}) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  set("bdf-full-name", defaults.full_name);
  set("bdf-designated", defaults.designated);
  set("bdf-relationship", defaults.relationship);
  set("bdf-address", defaults.address);
  set("bdf-month-period", defaults.month_period);
  set("bdf-year-period", defaults.year_period ?? new Date().getFullYear());
  set("bdf-contact", defaults.contact_number);
  set("bdf-gender", defaults.gender_id);
  set("bdf-birthday", defaults.birthday);
  set("bdf-age", defaults.age);
  set("bdf-education", defaults.educ_id);
  set("bdf-batch-id", defaults.batch_id);

  // Sync custom education dropdown visually
  const eduInput = document.getElementById("bdf-education");
  const selectedContent = document.getElementById("education-selected-content");
  const eduMenu = document.getElementById("menu-education-dropdown");

  if (eduInput && selectedContent && eduMenu) {
    const val = eduInput.value;
    const option = Array.from(eduMenu.querySelectorAll(".edu-option")).find(opt => opt.getAttribute("data-value") === val);
    if (option) {
      selectedContent.innerHTML = option.innerHTML;
    } else {
      selectedContent.innerHTML = `
        <svg class="h-4 w-4 text-spes-black/40 dark:text-spes-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
        </svg>
        <span class="text-spes-black/50 dark:text-spes-white/50" id="education-selected-text">— Select —</span>
      `;
    }
  }
}

// ── Generic animated badge panel factory ─────────────────────
// Used for both "Sort Offices" and "Sort Batch" panels.
// config: { panelId, btnId, wrapId, searchWrapId, searchInputId, badgesListId,
//           fetchItems, getLabel, getId, getPalette, onFilter, searchPlaceholder }
function initAnimatedBadgePanel(config) {
  const panel      = document.getElementById(config.panelId);
  const btn        = document.getElementById(config.btnId);
  const wrap       = document.getElementById(config.wrapId);
  const searchWrap = document.getElementById(config.searchWrapId);
  const badgesList = document.getElementById(config.badgesListId);
  if (!panel || !btn || !wrap || !badgesList) return { show: () => {}, hide: () => {}, rebuild: () => {} };

  let items       = [];
  let panelOpen   = false;
  let activeId    = "all";

  // Wire search to filter visible badges
  const searchInput = document.getElementById(config.searchInputId);
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      badgesList.querySelectorAll(".anim-badge").forEach(b => {
        const label = (b.dataset.label || "").toLowerCase();
        b.style.display = label.includes(q) ? "" : "none";
      });
    });
    // Stop panel close on input click
    searchInput.addEventListener("click", e => e.stopPropagation());
  }

  const CHECK_ICON = `<svg class="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>`;

  function setActiveBadge(badge) {
    // Clear all badges back to their resting state
    badgesList.querySelectorAll(".anim-badge").forEach(b => {
      const isAll = b.dataset.badgeId === "all";
      b.classList.remove(
        "ring-2", "ring-white/60", "ring-offset-1", "ring-offset-transparent",
        "scale-105", "brightness-125", "shadow-lg",
        "bg-white", "text-spes-blue",           // "all" active
        "bg-white/40"                            // item active overlay
      );
      // Restore check icon area (remove injected icon)
      const icon = b.querySelector(".badge-check");
      if (icon) icon.remove();

      if (isAll) {
        b.classList.add("bg-white/15", "text-white", "border-white/30");
      }
    });

    // Apply active state to selected badge
    const isAll = badge.dataset.badgeId === "all";
    if (isAll) {
      badge.classList.remove("bg-white/15");
      badge.classList.add("bg-white", "text-spes-blue", "ring-2", "ring-white/60", "ring-offset-1", "scale-105");
    } else {
      badge.classList.add("ring-2", "ring-white/60", "ring-offset-1", "scale-105", "brightness-125", "shadow-lg", "bg-white/40");
    }

    // Inject checkmark icon
    const iconEl = document.createElement("span");
    iconEl.className = "badge-check";
    iconEl.innerHTML = CHECK_ICON;
    badge.insertBefore(iconEl, badge.firstChild);
  }

  function buildBadges() {
    badgesList.innerHTML = "";

    // "ALL" badge — starts active by default
    const allBadge = document.createElement("button");
    allBadge.type = "button";
    allBadge.className =
      "anim-badge cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider transition-all duration-200 opacity-0 scale-75 " +
      "bg-white text-spes-blue border-white/50 ring-2 ring-white/60 ring-offset-1";
    allBadge.dataset.badgeId = "all";
    allBadge.dataset.label   = "all";
    // Pre-inject checkmark for default-active state
    allBadge.innerHTML = `<span class="badge-check">${CHECK_ICON}</span>${config.allLabel || "All"}`;
    badgesList.appendChild(allBadge);

    items.forEach((item, i) => {
      const pal   = config.getPalette(item, i);
      const badge = document.createElement("button");
      badge.type  = "button";
      badge.className =
        `anim-badge cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider transition-all duration-200 opacity-0 scale-75 ` +
        `${pal.bg} ${pal.text} ${pal.border} hover:brightness-125 hover:scale-105`;
      badge.dataset.badgeId = config.getId(item);
      badge.dataset.label   = config.getLabel(item).toLowerCase();
      badge.textContent     = config.getLabel(item);
      badgesList.appendChild(badge);
    });

    // Wire badge clicks
    badgesList.querySelectorAll(".anim-badge").forEach(badge => {
      badge.addEventListener("click", () => {
        activeId = badge.dataset.badgeId;
        setActiveBadge(badge);
        config.onFilter(activeId === "all" ? null : activeId);
      });
    });
  }

  async function openPanel() {
    items = await config.fetchItems();
    buildBadges();

    wrap.classList.remove("max-w-0", "opacity-0");
    wrap.classList.add("max-w-[900px]", "opacity-100");

    if (searchWrap) {
      setTimeout(() => searchWrap.classList.replace("opacity-0", "opacity-100"), 80);
    }

    badgesList.querySelectorAll(".anim-badge").forEach((badge, i) => {
      setTimeout(() => {
        badge.classList.remove("opacity-0", "scale-75");
        badge.classList.add("opacity-100", "scale-100");
      }, 60 + i * 50);
    });

    panelOpen = true;
    btn.classList.add("bg-white/25", "ring-2", "ring-white/30");
    config.onOpen?.();
  }

  function closePanel(resetFilter = true) {
    const badges = badgesList.querySelectorAll(".anim-badge");
    const total  = badges.length;

    if (searchWrap) searchWrap.classList.replace("opacity-100", "opacity-0");

    badges.forEach((badge, i) => {
      setTimeout(() => {
        badge.classList.add("opacity-0", "scale-75");
        badge.classList.remove("opacity-100", "scale-100");
      }, (total - 1 - i) * 35);
    });

    setTimeout(() => {
      wrap.classList.add("max-w-0", "opacity-0");
      wrap.classList.remove("max-w-[900px]", "opacity-100");
      badgesList.innerHTML = "";
      if (searchInput) searchInput.value = "";
    }, total * 35 + 180);

    panelOpen = false;
    activeId  = "all";
    btn.classList.remove("bg-white/25", "ring-2", "ring-white/30");
    if (resetFilter) config.onFilter(null);
    config.onClose?.();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panelOpen ? closePanel() : openPanel();
  });

  document.addEventListener("click", (e) => {
    if (panelOpen && !panel.contains(e.target)) closePanel();
  });

  return {
    show()    { panel.classList.remove("hidden"); panel.classList.add("flex"); },
    hide()    { if (panelOpen) closePanel(false); panel.classList.add("hidden"); panel.classList.remove("flex"); },
    rebuild() { if (panelOpen) { closePanel(false); openPanel(); } },
  };
}

// ── Drag + wheel-to-scroll helper ────────────────────────────
function addDragScroll(el) {
  if (!el) return;
  let isDown = false, startX = 0, scrollLeft = 0;
  el.addEventListener("mousedown",  (e) => { isDown = true; startX = e.pageX - el.offsetLeft; scrollLeft = el.scrollLeft; });
  el.addEventListener("mouseleave", ()  => { isDown = false; });
  el.addEventListener("mouseup",    ()  => { isDown = false; });
  el.addEventListener("mousemove",  (e) => { if (!isDown) return; e.preventDefault(); const x = e.pageX - el.offsetLeft; el.scrollLeft = scrollLeft - (x - startX); });
  el.addEventListener("wheel",      (e) => { if (e.deltaY === 0) return; e.preventDefault(); el.scrollLeft += e.deltaY; }, { passive: false });
}

// ── Office Sort Panel ─────────────────────────────────────────
function initOfficeSortPanel(onFilter) {
  let _cached = [];
  const panel = initAnimatedBadgePanel({
    panelId:      "sort-offices-panel",
    btnId:        "btn-sort-offices",
    wrapId:       "office-badges-container",
    searchWrapId: "office-search-wrap",
    searchInputId:"office-search-input",
    badgesListId: "office-badges-list",
    allLabel:     "All Offices",
    fetchItems: async () => {
      if (_cached.length) return _cached;
      const { data, error } = await supabase.from("offices").select("id, name").order("name");
      if (!error && data) _cached = data;
      return _cached;
    },
    getLabel:   (o) => o.name,
    getId:      (o) => String(o.id),
    getPalette: (_o, i) => OFFICE_BADGE_PALETTES[i % OFFICE_BADGE_PALETTES.length],
    onFilter,
  });
  addDragScroll(document.getElementById("office-badges-list"));
  return panel;
}

// ── Batch Sort Panel (DB-driven) ──────────────────────────────────
function initBatchSortPanel(onFilter) {
  const BATCH_PALETTES = [
    { bg: "bg-rose-500/25",    text: "text-rose-700 dark:text-rose-300",    border: "border-rose-500/40" },
    { bg: "bg-sky-500/25",     text: "text-sky-700 dark:text-sky-300",       border: "border-sky-500/40" },
    { bg: "bg-emerald-500/25", text: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-500/40" },
    { bg: "bg-amber-500/25",   text: "text-amber-700 dark:text-amber-300",   border: "border-amber-500/40" },
    { bg: "bg-fuchsia-500/25", text: "text-fuchsia-700 dark:text-fuchsia-300", border: "border-fuchsia-500/40" },
    { bg: "bg-violet-500/25",  text: "text-violet-700 dark:text-violet-300",  border: "border-violet-500/40" },
    { bg: "bg-cyan-500/25",    text: "text-cyan-700 dark:text-cyan-300",    border: "border-cyan-500/40" },
    { bg: "bg-orange-500/25",  text: "text-orange-700 dark:text-orange-300",  border: "border-orange-500/40" },
  ];

  const COLLAPSE_IDS = ["sortfilter-wrap", "staff-search-wrap"];

  const inner = initAnimatedBadgePanel({
    panelId:       "sort-batch-panel",
    btnId:         "btn-sort-batch",
    wrapId:        "batch-badges-container",
    searchWrapId:  "",
    searchInputId: "",
    badgesListId:  "batch-badges-list",
    allLabel:      "All Batches",
    fetchItems:    async () => {
      const { data } = await fetchBatches({ forceRefresh: false });
      return data || [];
    },
    getLabel:      (b) => b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.batch_number}`,
    getId:         (b) => String(b.id),
    getPalette:    (_b, i) => BATCH_PALETTES[i % BATCH_PALETTES.length],
    onFilter,
    onOpen:        () => COLLAPSE_IDS.forEach(id => document.getElementById(id)?.classList.add("hidden")),
    onClose:       () => COLLAPSE_IDS.forEach(id => document.getElementById(id)?.classList.remove("hidden")),
  });

  addDragScroll(document.getElementById("batch-badges-list"));
  return inner;
}

// ── Main export ───────────────────────────────────────────────
export function initBeneficiaries() {
  const tbody = document.getElementById("beneficiary-table-body");
  if (!tbody) return;

  const session = getSession();
  const isAdmin = session && session.role === "admin";
  let viewMode = isAdmin ? "implementors" : "beneficiaries";
  let officerOffice = null;

  // Admin view state
  let allImplementors = [];
  let activeImplementors = [];
  let currentOfficeLocation = "";
  let currentOfficeId = null;
  let currentStaffIdView = null;
  let allOffices = [];

  const loadOfficerOffice = async () => {
    if (isAdmin) {
      document.getElementById("officer-assigned-office-info-desktop")?.classList.add("hidden");
      document.getElementById("officer-assigned-office-info-desktop")?.classList.remove("sm:block");
      document.getElementById("officer-assigned-office-info-bottom")?.classList.add("hidden");
      document.getElementById("officer-assigned-office-info-top")?.classList.add("hidden");
      return;
    }

    if (session && session.role !== "admin" && session.office_id) {
      try {
        const { data, error } = await supabase
          .from("offices")
          .select("name, location")
          .eq("id", session.office_id)
          .single();
        if (!error && data) {
          officerOffice = data;
          currentOfficeName = data.name;
          currentOfficeId = session.office_id;
          currentOfficeLocation = data.location;

          const officeInfoTop = document.getElementById("officer-assigned-office-info-top");
          const officeInfoDesktop = document.getElementById("officer-assigned-office-info-desktop");
          const officeInfoBottom = document.getElementById("officer-assigned-office-info-bottom");
          const officeNameEl = document.getElementById("assigned-office-name");
          const officeNameDesktopEl = document.getElementById("assigned-office-name-desktop");
          const officeLocEl = document.getElementById("assigned-office-location");
          if (officeNameEl) officeNameEl.textContent = data.name.toUpperCase();
          if (officeNameDesktopEl) officeNameDesktopEl.textContent = data.name.toUpperCase();
          if (officeLocEl) officeLocEl.textContent = data.location.toUpperCase();
          if (officeInfoTop) officeInfoTop.classList.remove("hidden");
          if (officeInfoDesktop) officeInfoDesktop.classList.remove("hidden");
          if (officeInfoBottom) officeInfoBottom.classList.remove("hidden");
        }
      } catch (err) {
        console.warn("[SPES] loadOfficerOffice error:", err);
      }
    }
  };

  // ── Office Sort Panel (admin only) ──────────────────────────
  const officeSortPanel = initOfficeSortPanel((officeName) => {
    const filtered = officeName
      ? allImplementors.filter(s => s.office && s.office.trim().toLowerCase() === officeName.trim().toLowerCase())
      : allImplementors;
    sortFilterInstance?.updateData(filtered);
  });

  // State
  let allBeneficiaries = [];
  let activeBeneficiaries = [];
  let currentPage = 1;
  let sortFilterInstance = null;
  let selectedBatchId = null;
  let currentOfficeName = "";

  // ── Batch Sort Panel (admin + officer, beneficiary view) ─────
  const batchSortPanel = initBatchSortPanel((batchId) => {
    if (batchId === null || batchId === "all") {
      selectedBatchId = null;
    } else {
      selectedBatchId = batchId;
    }
    currentPage = 1;
    renderPaginatedTable();
  });

  // ── NEW / SPES BABY status switch (shown only on a specific implementor's roster) ─
  const statusSwitch    = document.getElementById("status-mode-switch");
  const statusSwitchCb  = document.getElementById("toggle-status-mode");
  // Unchecked = NEW, checked = SPES BABY. Filters the roster by return_status.
  statusSwitchCb?.addEventListener("change", (e) => {
    const mode = e.target.checked ? "SPES BABY" : "NEW";
    sortFilterInstance?.setFilter("return_status", mode);
  });
  function _showStatusSwitch(show) {
    if (!statusSwitch) return;
    statusSwitch.classList.toggle("hidden", !show);
    statusSwitch.classList.toggle("inline-flex", show);
    if (show) {
      // Reset to default NEW each time it's revealed
      if (statusSwitchCb) statusSwitchCb.checked = false;
      sortFilterInstance?.setFilter("return_status", "NEW");
    } else {
      if (statusSwitchCb) statusSwitchCb.checked = false;
      sortFilterInstance?.setFilter("return_status", "all");
    }
  }


  // ── View Switching helpers ───────────────────────────────────
  function formatOfficeShort(name) {
    if (!name) return "N/A";
    let s = String(name).toUpperCase();
    if (s.includes("CITY GOVERNMENT OF") && s.includes("(LGU)")) {
      return "LGU - " + s.replace("CITY GOVERNMENT OF ", "").replace(" (LGU)", "").trim();
    }
    if (s.includes("MUNICIPALITY OF") && s.includes("(LGU)")) {
      return "LGU - " + s.replace("MUNICIPALITY OF ", "").replace(" (LGU)", "").trim();
    }
    return name;
  }

  function showTableSkeleton(cols = 6) {
    let rowsHtml = "";
    for (let r = 0; r < 5; r++) {
      let tds = "";
      if (cols === 7) {
        tds = `
          <td class="p-4 text-center">
            <div class="h-4 w-4 bg-gray-200 dark:bg-white/10 rounded-full mx-auto"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-36 mb-2"></div>
            <div class="h-2 bg-gray-200 dark:bg-white/10 rounded-full w-48"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-32"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-56"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-24 mx-auto"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-20 mx-auto"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-12 mx-auto"></div>
          </td>
        `;
      } else if (cols === 6) {
        tds = `
          <td class="p-4 text-center">
            <div class="h-4 w-4 bg-gray-200 dark:bg-white/10 rounded-full mx-auto"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-36 mb-2"></div>
            <div class="h-2 bg-gray-200 dark:bg-white/10 rounded-full w-48"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-56"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-24 mx-auto"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-20 mx-auto"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-12 mx-auto"></div>
          </td>
        `;
      } else {
        tds = `
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-40 mb-2"></div>
            <div class="h-2 bg-gray-200 dark:bg-white/10 rounded-full w-24"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-32"></div>
          </td>
          <td class="px-6 py-4">
            <div class="h-2.5 bg-gray-200 dark:bg-white/10 rounded-full w-48"></div>
          </td>
        `;
      }
      rowsHtml += `<tr class="animate-pulse border-b border-spes-blue/10 bg-spes-white dark:border-spes-white/10 dark:bg-spes-dark-primary">${tds}</tr>`;
    }
    tbody.innerHTML = rowsHtml;
  }

  async function switchToBeneficiariesView(officeName, officeLocation, officeId, staffId) {
    if (!isAdmin) return;
    viewMode = "beneficiaries";
    currentOfficeLocation = officeLocation;
    currentOfficeId = officeId;
    currentStaffIdView = staffId;
    currentOfficeName = officeName;
    selectedBatchId = null;

    // Persist to URL — just the office id; location/name resolved from cache on restore
    _setUrlParam("office", officeId ?? officeLocation);

    // Hide Sort Offices panel when drilling into a specific office
    officeSortPanel.hide();

    // Update Title and show back button
    const tableTitle = document.getElementById("table-title");
    if (tableTitle) {
      tableTitle.textContent = `Total SPES List at - ${officeName.toUpperCase()}`;
    }

    const backBtn = document.getElementById("btn-back-to-implementors");
    if (backBtn) {
      backBtn.classList.remove("hidden");
      backBtn.classList.add("inline-flex");
    }

    // Swap Buttons: Hide Add Beneficiary until inside a batch, Show Create Batch
    const addBtn = document.getElementById("btn-add-beneficiary");
    const createBatchBtn = document.getElementById("btn-create-batch");
    if (addBtn) {
      addBtn.classList.remove("inline-flex");
      addBtn.classList.add("hidden");
    }
    if (createBatchBtn) {
      if (currentOfficeId && currentOfficeId !== "ALL") {
        createBatchBtn.classList.remove("hidden");
        createBatchBtn.classList.add("inline-flex");
      } else {
        createBatchBtn.classList.add("hidden");
        createBatchBtn.classList.remove("inline-flex");
      }
    }

    // Beneficiary view: show controls container with Sort Batch visible inside it
    document.getElementById("table-controls-container")?.classList.remove("hidden");
    // Restore inner controls in case Sort Batch was open before
    ["sortfilter-wrap", "staff-search-wrap"].forEach(id =>
      document.getElementById(id)?.classList.remove("hidden")
    );

    // Reset active filters
    sortFilterInstance?.resetFilters();

    // Set loading skeleton in table body
    const showOfficeCol = officeLocation === "ALL";
    showTableSkeleton(showOfficeCol ? 7 : 6);

    // Fetch and filter beneficiaries for this office location
    const { data, error } = await fetchBeneficiaries({ forceRefresh: false });
    if (error) {
      modals.error("Load Error", error);
      tbody.innerHTML = `<tr><td colspan="${showOfficeCol ? 7 : 6}" class="text-center py-8 text-sm text-spes-black/40 dark:text-white/40">Failed to load data.</td></tr>`;
      return;
    }

    const filteredData = (currentOfficeId && currentOfficeId !== "ALL") 
      ? data.filter(b => b.staffs?.office_id == currentOfficeId)
      : data;

    allBeneficiaries = filteredData;
    currentPage = 1;

    updateDynamicFilterDropdown(filteredData);

    const targetB = _getUrlParam("b");
    if (targetB) {
      const idx = filteredData.findIndex(item => String(item.id) === String(targetB));
      if (idx !== -1) {
        currentPage = Math.floor(idx / ROWS_PER_PAGE) + 1;
      }
    }

    batchSortPanel?.show();
    setupSortFilter(filteredData);

    // Status switch only for a specific implementor's roster (not the ALL aggregate)
    _showStatusSwitch(officeLocation !== "ALL");
  }

  function updateDynamicFilterDropdown(data) {
    const filterContainer = document.getElementById("dropdown-filter-beneficiary");
    if (!filterContainer) return;

    // 1. Periods (unique month_period + year_period)
    const periods = new Set();
    data.forEach(b => {
      const p = formatPeriod(b);
      if (p !== "N/A") periods.add(p);
    });
    const sortedPeriods = Array.from(periods).sort((a, b) => new Date(b) - new Date(a));

    // 2. Education
    const educations = new Set();
    data.forEach(b => {
      if (b.education?.name) educations.add(b.education.name);
    });
    const sortedEducations = Array.from(educations).sort();

    // 3. Gender
    const genders = new Set();
    data.forEach(b => {
      if (b.gender?.name) genders.add(b.gender.name);
    });
    const sortedGenders = Array.from(genders).sort();

    // 4. Birthday Months
    const bdayMonths = new Set();
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    data.forEach(b => {
      if (b.birthday) {
        const d = new Date(b.birthday);
        if (!isNaN(d.getTime())) bdayMonths.add(monthNames[d.getMonth()]);
      }
    });
    const sortedBdayMonths = Array.from(bdayMonths).sort((a, b) => monthNames.indexOf(a) - monthNames.indexOf(b));

    let html = "";
    const renderBtns = (key, label, allLabel, arr) => {
      if (arr.length === 0) return "";
      let h = `
        <details class="group mb-1">
          <summary class="flex justify-between items-center cursor-pointer rounded-md p-2 hover:bg-spes-blue/10 dark:hover:bg-white/5 transition-colors">
            <span class="text-[0.5625rem] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow">${label}</span>
            <svg class="h-3 w-3 text-spes-blue/50 dark:text-spes-yellow/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div class="pl-3 mt-1 flex flex-col space-y-0.5 mb-2">
            <button data-filter-key="${key}" data-filter-val="all" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-spes-blue font-bold">${allLabel}</button>
      `;
      arr.forEach(item => {
        h += `<button data-filter-key="${key}" data-filter-val="${item.toLowerCase()}" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left uppercase text-xs">${item}</button>`;
      });
      h += `</div></details>`;
      return h;
    };

    html += renderBtns("period", "Period", "All Periods", sortedPeriods);
    html += renderBtns("education_name", "Education Level", "All Education", sortedEducations);
    html += renderBtns("gender_name", "Gender", "All Genders", sortedGenders);
    html += renderBtns("bday_month", "Birthday Month", "All Months", sortedBdayMonths);

    // Static Status
    html += `
      <details class="group mb-1">
        <summary class="flex justify-between items-center cursor-pointer rounded-md p-2 hover:bg-spes-blue/10 dark:hover:bg-white/5 transition-colors">
          <span class="text-[0.5625rem] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow">Status</span>
          <svg class="h-3 w-3 text-spes-blue/50 dark:text-spes-yellow/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div class="pl-3 mt-1 flex flex-col space-y-0.5 mb-2">
          <button data-filter-key="return_status" data-filter-val="all" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-spes-blue font-bold">All Students</button>
          <button data-filter-key="return_status" data-filter-val="new" class="cursor-pointer flex w-full items-center gap-1.5 rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-xs"><span class="inline-block h-2 w-2 rounded-sm bg-emerald-500"></span>New</button>
          <button data-filter-key="return_status" data-filter-val="spes baby" class="cursor-pointer flex w-full items-center gap-1.5 rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-xs"><span class="inline-block h-2 w-2 rounded-sm bg-red-400"></span>SPES Baby</button>
        </div>
      </details>
    `;

    // Static Archive Status
    html += `
      <details class="group mb-1">
        <summary class="flex justify-between items-center cursor-pointer rounded-md p-2 hover:bg-spes-blue/10 dark:hover:bg-white/5 transition-colors">
          <span class="text-[0.5625rem] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow">Archive Status</span>
          <svg class="h-3 w-3 text-spes-blue/50 dark:text-spes-yellow/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div class="pl-3 mt-1 flex flex-col space-y-0.5 mb-2">
          <button data-filter-key="status" data-filter-val="active" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-spes-blue font-bold">Active Only</button>
          <button data-filter-key="status" data-filter-val="archived" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-xs">Archived Only</button>
        </div>
      </details>
    `;

    filterContainer.innerHTML = html;
  }

  async function switchToImplementorsView() {
    if (!isAdmin) return;
    viewMode = "implementors";
    currentOfficeLocation = "";
    currentOfficeId = null;
    currentStaffIdView = null;

    // Clear URL state — back to implementors list
    _clearUrlParam("office");
    _clearUrlParam("batch");
    _clearUrlParam("b");

    // Update Title and hide back button
    const tableTitle = document.getElementById("table-title");
    if (tableTitle) {
      tableTitle.textContent = "Implementors List";
      tableTitle.classList.remove("truncate", "max-w-[120px]", "sm:max-w-[200px]");
    }

    const backBtn = document.getElementById("btn-back-to-implementors");
    if (backBtn) {
      backBtn.classList.remove("inline-flex");
      backBtn.classList.add("hidden");
    }

    // Hide Add Beneficiary & Create Batch Buttons
    const addBtn = document.getElementById("btn-add-beneficiary");
    const createBatchBtn = document.getElementById("btn-create-batch");
    if (addBtn) {
      addBtn.classList.remove("inline-flex");
      addBtn.classList.add("hidden");
    }
    if (createBatchBtn) {
      createBatchBtn.classList.remove("inline-flex");
      createBatchBtn.classList.add("hidden");
    }

    // Hide the whole table-controls-container (no search/filter needed for implementors list)
    document.getElementById("table-controls-container")?.classList.add("hidden");

    // Show Sort Offices panel; hide Sort Batch panel + status switch
    officeSortPanel.show();
    batchSortPanel?.hide();
    _showStatusSwitch(false);

    // Clear batch buttons


    // Reset active filters
    sortFilterInstance?.resetFilters();

    // Set loading skeleton in table body
    showTableSkeleton(3);

    // Fetch and render implementors
    const staffs = await fetchImplementorList({ forceRefresh: false });
    const activeStaffs = staffs.filter(s => !s.archive_at);

    allImplementors = activeStaffs;
    currentPage = 1;

    const targetId = _getUrlParam("id");
    if (targetId) {
      const idx = activeStaffs.findIndex(item => String(item.id) === String(targetId));
      if (idx !== -1) {
        currentPage = Math.floor(idx / ROWS_PER_PAGE) + 1;
      }
    }
    setupSortFilter(activeStaffs);
  }

  // Drawer DOM
  const drawer = document.getElementById("drawer-beneficiary-details");
  const content = document.getElementById("drawer-beneficiary-content");
  const closeBtn = document.getElementById("btn-close-beneficiary-drawer");
  const addBtn = document.getElementById("btn-add-beneficiary");

  // ── Drawer ──────────────────────────────────────────────────
  const openDrawer = (b, index) => {
    if (!drawer || !content) return;

    // Persist drawer state to URL — short key "b" for beneficiary id
    _setUrlParam("b", b.id);

    const drawerLabel = document.getElementById("drawer-label");
    if (drawerLabel) {
      drawerLabel.textContent = (b.full_name || "").toUpperCase();
      drawerLabel.className =
        "text-sm sm:text-base md:text-lg font-montserrat font-black text-spes-blue dark:text-white tracking-tight uppercase";
    }

    const period = formatPeriod(b);

    const bday = formatDate(b.birthday);

    content.innerHTML = `
      <div class="space-y-3 text-xs sm:text-sm mt-2 mb-4">
        <div class="flex justify-between items-start py-1.5">
          <span class="font-bold text-spes-black/55 dark:text-white/50 text-xs sm:text-sm">Designated Beneficiary</span>
          <span class="font-black text-right text-spes-black dark:text-white uppercase text-xs sm:text-sm">${escHtml(b.designated || "N/A")}</span>
        </div>
        <div class="flex justify-between items-center py-1.5">
          <span class="font-bold text-spes-black/55 dark:text-white/50 text-xs sm:text-sm">Relationship to Assured</span>
          <span class="font-black text-emerald-600 dark:text-emerald-400 uppercase text-xs sm:text-sm">${escHtml(b.relationship || "N/A")}</span>
        </div>
      </div>

      <hr class="border-t-2 border-spes-black dark:border-white/20 my-4" />

      <div class="flex items-center justify-between mb-5">
        <h4 class="font-montserrat text-xs font-black uppercase tracking-wider text-spes-black/50 dark:text-white/50">Personal Profile</h4>
        <div class="flex items-center gap-1.5">
          <button id="btn-drawer-prev" ${index === 0 ? 'disabled' : ''} class="${index === 0 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5'} inline-flex items-center gap-1 rounded-md border border-spes-blue/20 bg-white dark:bg-transparent dark:border-white/10 px-2.5 py-1.5 text-[0.625rem] font-black uppercase tracking-wider text-spes-black/60 dark:text-white/70 transition-all">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
            Prev
          </button>
          <button id="btn-drawer-next" ${index === activeBeneficiaries.length - 1 ? 'disabled' : ''} class="${index === activeBeneficiaries.length - 1 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-spes-blue/90'} inline-flex items-center gap-1 rounded-md bg-spes-blue px-3 py-1.5 text-[0.625rem] font-black uppercase tracking-wider text-white shadow-md transition-all">
            Next
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      <div class="space-y-4 text-xs">
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Contact No.</span>
          <span class="font-black ${b.contact_number ? "text-indigo-600 dark:text-indigo-400" : "italic text-spes-black/30 dark:text-white/30"} uppercase">${escHtml(b.contact_number || "Not Provided")}</span>
        </div>
        ${isAdmin ? `
        <div class="flex justify-between items-start py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Office</span>
          <span class="font-extrabold text-right text-spes-black dark:text-white max-w-[200px] text-wrap uppercase">
            ${escHtml(b.staffs && b.staffs.office_id ? (allOffices.find(o => o.id === b.staffs.office_id)?.name || "N/A") : (b.staffs?.full_name || "N/A"))}
          </span>
        </div>
        ` : ''}
        <div class="flex justify-between items-start py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Address</span>
          <span class="font-extrabold text-right text-spes-black dark:text-white max-w-[200px] uppercase">${escHtml(b.address || "N/A")}</span>
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Birthday</span>
          <span class="font-extrabold text-spes-black dark:text-white">${escHtml(bday)}</span>
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Age</span>
          <span class="font-extrabold text-spes-black dark:text-white">${b.age ?? "N/A"}</span>
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Period</span>
          <span class="font-extrabold text-spes-black dark:text-white uppercase">${escHtml(period)}</span>
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Gender</span>
          <span class="font-extrabold text-spes-black dark:text-white uppercase">${escHtml(b.gender?.name || "N/A")}</span>
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Batch</span>
          ${b.batch?.batch_number != null
            ? `<span class="inline-flex items-center gap-1 bg-spes-blue/10 px-2.5 py-1 text-[0.625rem] font-black uppercase tracking-wide text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow">${escHtml(b.batch.batch_name ? b.batch.batch_name.toUpperCase() : `BATCH ${b.batch.batch_number}`)}</span>`
            : `<span class="italic text-[0.625rem] text-spes-black/30 dark:text-white/30">Not Assigned</span>`
          }
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Status</span>
          ${String(b.return_status || "NEW").toUpperCase() === "SPES BABY"
            ? `<span class="inline-flex items-center gap-1 bg-red-400/15 px-2.5 py-1 text-[0.625rem] font-black uppercase tracking-wide text-red-500 dark:bg-red-400/20 dark:text-red-300">SPES Baby</span>`
            : `<span class="inline-flex items-center gap-1 bg-emerald-500/15 px-2.5 py-1 text-[0.625rem] font-black uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">New</span>`
          }
        </div>
        <div class="flex justify-between items-center py-1">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Education</span>
          <span class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[0.625rem] font-black uppercase text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
            ${escHtml(b.education?.name || "Not Provided")}
          </span>
        </div>
      </div>
    `;

    // Prev / Next within drawer
    document.getElementById("btn-drawer-prev")?.addEventListener("click", () => {
      if (index > 0) openDrawer(activeBeneficiaries[index - 1], index - 1);
    });
    document.getElementById("btn-drawer-next")?.addEventListener("click", () => {
      if (index < activeBeneficiaries.length - 1) openDrawer(activeBeneficiaries[index + 1], index + 1);
    });

    // Edit
    document.getElementById("btn-drawer-edit")?.addEventListener("click", () => {
      closeDrawer();
      showEditModal(b);
    });

    // Archive
    document.getElementById("btn-drawer-archive")?.addEventListener("click", () => {
      closeDrawer();
      confirmArchive(b.id, b.full_name);
    });

    // Backdrop
    const backdrop = document.getElementById("drawer-backdrop");
    if (backdrop) {
      backdrop.classList.remove("hidden");
      requestAnimationFrame(() => {
        backdrop.classList.remove("opacity-0");
        backdrop.classList.add("opacity-100");
      });
      backdrop.onclick = closeDrawer;
    }

    drawer.classList.remove("hidden");
    drawer.offsetHeight;
    drawer.classList.remove("translate-y-full", "sm:translate-x-full");
    drawer.classList.add("translate-y-0", "sm:translate-x-0");
  };

  const closeDrawer = () => {
    if (!drawer) return;
    _clearUrlParam("b");
    const backdrop = document.getElementById("drawer-backdrop");
    if (backdrop) {
      backdrop.classList.remove("opacity-100");
      backdrop.classList.add("opacity-0");
      setTimeout(() => backdrop.classList.add("hidden"), 300);
      backdrop.onclick = null;
    }
    drawer.classList.remove("translate-y-0", "sm:translate-x-0");
    drawer.classList.add("translate-y-full", "sm:translate-x-full");
    setTimeout(() => {
      if (drawer.classList.contains("translate-y-full") || drawer.classList.contains("sm:translate-x-full")) {
        drawer.classList.add("hidden");
      }
    }, 300);
  };

  closeBtn?.addEventListener("click", closeDrawer);

  // ── Table rendering ─────────────────────────────────────────
  function renderPaginatedTable() {
    const start = (currentPage - 1) * ROWS_PER_PAGE;
    const end = start + ROWS_PER_PAGE;

    // Update headers and controls visibility first
    const headerRow = document.getElementById("table-header-row");
    const controlsContainer = document.getElementById("table-controls-container");
    if (headerRow) {
      if (viewMode === "implementors") {
        headerRow.innerHTML = `
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Name</th>
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Office</th>
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Office Location</th>
        `;
        if (controlsContainer) controlsContainer.classList.add("hidden");
      } else {
        const showOfficeCol = currentOfficeLocation === "ALL";
        headerRow.innerHTML = `
          <th scope="col" class="p-4 text-center w-4">
            <div class="flex items-center justify-center">
              <input id="staff-checkbox-all" type="checkbox"
                class="h-4 w-4 cursor-pointer rounded-full border-spes-blue/25 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/25 dark:bg-spes-dark-secondary dark:text-spes-yellow">
            </div>
          </th>
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Name of Assured</th>
          ${showOfficeCol ? `<th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Office</th>` : ""}
          <th scope="col" class="px-6 py-3 text-left pl-22 whitespace-nowrap">Address</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Year Level</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Gender</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Actions</th>
        `;
        if (controlsContainer) controlsContainer.classList.remove("hidden");
        // Wire up check-all listener
        document.getElementById("staff-checkbox-all")?.addEventListener("change", e => {
          document.querySelectorAll(".beneficiary-row-checkbox").forEach(cb => cb.checked = e.target.checked);
        });
      }
    }

    if (viewMode === "implementors") {
      const tableWrap = document.getElementById("implementors-table-wrapper");
      const kanbanWrap = document.getElementById("batches-kanban-wrapper");
      const paginationControls = document.querySelector("nav[aria-label='Table navigation']");

      if (tableWrap) tableWrap.classList.remove("hidden");
      if (paginationControls) paginationControls.classList.remove("hidden");
      if (kanbanWrap) kanbanWrap.classList.add("hidden");

      const page = activeImplementors.slice(start, end);
      tbody.innerHTML = page.map((s, idx) => {
        const absIdx = start + idx;
        const officeBadge = s.office && s.office !== "N/A"
          ? `<span class="inline-flex items-center gap-1 rounded bg-spes-blue/10 px-2.5 py-1 text-[0.625rem] font-black uppercase text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow" title="${escHtml(s.office)}">${escHtml(formatOfficeShort(s.office))}</span>`
          : `<span class="text-spes-black/30 dark:text-spes-white/30 italic text-xs">None</span>`;

        const isRowAdmin = String(s.role).toLowerCase().includes("admin") || String(s.full_name).toLowerCase().includes("system administrator");
        const isTarget = new URLSearchParams(window.location.search).get("id") === String(s.id);
        const clickableClass = isTarget 
          ? "cursor-pointer bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse" 
          : "cursor-pointer hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow";

        return `
          <tr class="border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 ${clickableClass}"
              data-impl-idx="${absIdx}">
            <td class="px-6 py-4 text-left font-extrabold text-spes-black dark:text-spes-white whitespace-nowrap">
              ${escHtml(s.full_name?.toUpperCase() || "—")}
              ${isRowAdmin ? '<span class="ml-2 inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[0.5625rem] font-black uppercase text-red-600 dark:bg-red-500/20 dark:text-red-400">Admin</span>' : ''}
            </td>
            <td class="px-6 py-4 text-left whitespace-nowrap">${officeBadge}</td>
            <td class="px-6 py-4 text-left font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${escHtml(s.office_location || "N/A")}</td>
          </tr>`;
      }).join("");

      // Row click → switch to beneficiaries view
      tbody.querySelectorAll("tr").forEach(row => {
        row.addEventListener("click", () => {
          const idx = parseInt(row.getAttribute("data-impl-idx"), 10);
          const impl = activeImplementors[idx];
          if (impl) {
            const isRowAdmin = String(impl.role).toLowerCase().includes("admin") || String(impl.full_name).toLowerCase().includes("system administrator");
            if (isRowAdmin) {
              switchToBeneficiariesView("ALL SPES", "ALL", "ALL", null);
            } else {
              switchToBeneficiariesView(impl.office, impl.office_location, impl.office_id ?? impl.id, impl.id);
            }
          }
        });
      });

      // Pagination info
      const totalEl = document.getElementById("pagination-total");
      const rangeEl = document.getElementById("pagination-range");
      if (totalEl) totalEl.textContent = activeImplementors.length;
      if (rangeEl) rangeEl.textContent = activeImplementors.length === 0 ? "0" : `${start + 1}–${Math.min(end, activeImplementors.length)}`;

      // Page indicators
      updatePageIndicators(activeImplementors.length);
    } else {
      // ── Beneficiaries View (Batches or Filtered List) ──
      const tableWrap = document.getElementById("implementors-table-wrapper");
      const kanbanWrap = document.getElementById("batches-kanban-wrapper");
      const paginationControls = document.querySelector("nav[aria-label='Table navigation']");

      // Dynamic back button visibility
      const backBtn = document.getElementById("btn-back-to-implementors");
      if (backBtn) {
        if (selectedBatchId !== null) {
          backBtn.classList.remove("hidden");
          backBtn.classList.add("inline-flex");
        } else if (isAdmin) {
          backBtn.classList.remove("hidden");
          backBtn.classList.add("inline-flex");
        } else {
          backBtn.classList.remove("inline-flex");
          backBtn.classList.add("hidden");
        }
      }

      // Title update based on selectedBatchId
      const tableTitle = document.getElementById("table-title");
      if (tableTitle) {
        const offName = currentOfficeName || "SPES";
        if (selectedBatchId === null) {
          tableTitle.textContent = `BATCHES - ${offName.toUpperCase()}`;
        } else if (selectedBatchId === "unassigned") {
          tableTitle.textContent = `UNASSIGNED - ${offName.toUpperCase()}`;
        } else {
          const matchBatch = activeBeneficiaries.find(b => String(b.batch_id ?? b.batch?.id) === String(selectedBatchId))?.batch;
          const batchLabel = matchBatch ? (matchBatch.batch_name ? matchBatch.batch_name.toUpperCase() : `BATCH ${matchBatch.batch_number}`) : "BATCH LIST";
          tableTitle.textContent = `${batchLabel} - ${offName.toUpperCase()}`;
        }
      }

      const addBtn = document.getElementById("btn-add-beneficiary");
      const createBatchBtn = document.getElementById("btn-create-batch");
      const sortBatchPanel = document.getElementById("sort-batch-panel");

      if (selectedBatchId === null) {
        // Show Batch Cards Grid
        if (addBtn) {
          addBtn.classList.remove("inline-flex");
          addBtn.classList.add("hidden");
        }
        if (createBatchBtn) {
          if (currentOfficeId && currentOfficeId !== "ALL") {
            createBatchBtn.classList.remove("hidden");
            createBatchBtn.classList.add("inline-flex");
          } else {
            createBatchBtn.classList.add("hidden");
            createBatchBtn.classList.remove("inline-flex");
          }
        }
        if (sortBatchPanel) {
          sortBatchPanel.classList.remove("hidden");
          sortBatchPanel.classList.add("flex");
        }
        if (tableWrap) tableWrap.classList.add("hidden");
        if (paginationControls) paginationControls.classList.add("hidden");
        if (kanbanWrap) {
          kanbanWrap.classList.remove("hidden");
        }
        renderBatchCards();
      } else {
        // Show Filtered Beneficiaries Table
        if (addBtn) {
          addBtn.classList.remove("hidden");
          addBtn.classList.add("inline-flex");
        }
        if (createBatchBtn) {
          createBatchBtn.classList.add("hidden");
          createBatchBtn.classList.remove("inline-flex");
        }
        if (sortBatchPanel) {
          sortBatchPanel.classList.add("hidden");
          sortBatchPanel.classList.remove("flex");
        }
        if (kanbanWrap) kanbanWrap.classList.add("hidden");
        if (tableWrap) tableWrap.classList.remove("hidden");
        if (paginationControls) paginationControls.classList.remove("hidden");

        // Filter activeBeneficiaries by selectedBatchId
        let filteredList = activeBeneficiaries;
        if (selectedBatchId === "unassigned") {
          filteredList = activeBeneficiaries.filter(b => b.batch_id === null || b.batch?.id === null);
        } else {
          filteredList = activeBeneficiaries.filter(b => String(b.batch_id ?? b.batch?.id) === String(selectedBatchId));
        }

        // Paginate and render
        const page = filteredList.slice(start, end);
        tbody.innerHTML = page.map((b, idx) => {
          const absIdx = start + idx;
          const period = formatPeriod(b);
          const isBaby = String(b.return_status || "NEW").toUpperCase() === "SPES BABY";

          const checkboxTd = `
            <td class="p-4 text-center">
              <div class="flex items-center justify-center">
                <input type="checkbox" data-bene-id="${b.id}" class="beneficiary-row-checkbox h-4 w-4 cursor-pointer rounded-full border-spes-blue/25 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/25 dark:bg-spes-dark-secondary dark:text-spes-yellow">
              </div>
            </td>
          `;

          const statusBadge = isBaby
            ? `<span class="ml-2 inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[0.5625rem] font-black uppercase text-red-600 dark:bg-red-500/20 dark:text-red-400">SPES Baby</span>`
            : `<span class="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[0.5625rem] font-black uppercase text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">New</span>`;

          const searchQ = (document.getElementById('staff-search-input')?.value || "").trim().toLowerCase();
          const hasMatchedPhone = searchQ && b.contact_number && b.contact_number.toLowerCase().includes(searchQ);

          const contactTooltip = hasMatchedPhone
            ? `<span class="ml-2 inline-flex items-center gap-1 rounded bg-spes-blue/10 dark:bg-spes-yellow/10 px-2 py-0.5 text-[0.625rem] font-black uppercase text-spes-blue dark:text-spes-yellow border border-spes-blue/20 dark:border-spes-yellow/20">
                 <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                 ${escHtml(b.contact_number)}
               </span>`
            : "";

          const actionsTd = `
            <td class="px-6 py-4 text-center whitespace-nowrap">
              <div class="inline-flex items-center gap-1">
                <button class="btn-edit-bene cursor-pointer p-1 text-spes-blue hover:text-spes-blue/80 dark:text-spes-yellow dark:hover:text-spes-yellow/80" title="Edit">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button class="btn-archive-bene cursor-pointer p-1 text-red-500 hover:text-red-600" title="Archive">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
              </div>
            </td>
          `;

          return `
            <tr title="Click for Details" class="cursor-pointer border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary hover:bg-spes-blue/5 dark:hover:bg-spes-yellow/5 transition-all duration-200" data-bene-id="${b.id}">
              ${checkboxTd}
              <td class="px-6 py-4 text-left font-extrabold text-spes-black dark:text-spes-white whitespace-nowrap">
                <span class="btn-open-drawer cursor-pointer hover:underline hover:text-spes-blue dark:hover:text-spes-yellow">${escHtml(b.full_name?.toUpperCase() || "—")}</span>
                ${statusBadge}
                ${contactTooltip}
              </td>
              <td class="px-6 py-4 text-left text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${escHtml(b.address || "N/A")}</td>
              <td class="px-6 py-4 text-center whitespace-nowrap">
                <span class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[0.625rem] font-black uppercase text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
                  ${escHtml(b.education?.name || "Not Provided")}
                </span>
              </td>
              <td class="px-6 py-4 text-center font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap uppercase">${escHtml(b.gender?.name || "—")}</td>
              ${actionsTd}
            </tr>
          `;
        }).join("");

        // Wire up row buttons
        tbody.querySelectorAll("tr").forEach(row => {
          const beneId = row.dataset.beneId;
          const bData = allBeneficiaries.find(b => String(b.id) === beneId);
          if (!bData) return;

          // Add click on the row itself
          row.addEventListener("click", (e) => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return;
            const idx = activeBeneficiaries.findIndex(b => String(b.id) === beneId);
            openDrawer(bData, idx === -1 ? 0 : idx);
          });

          row.querySelector(".btn-open-drawer")?.addEventListener("click", (e) => {
            e.stopPropagation();
            const idx = activeBeneficiaries.findIndex(b => String(b.id) === beneId);
            openDrawer(bData, idx === -1 ? 0 : idx);
          });

          row.querySelector(".btn-edit-bene")?.addEventListener("click", (e) => {
            e.stopPropagation();
            showEditModal(bData);
          });

          row.querySelector(".btn-archive-bene")?.addEventListener("click", (e) => {
            e.stopPropagation();
            confirmArchive(bData.id, bData.full_name);
          });
        });

        // Pagination info
        const totalEl = document.getElementById("pagination-total");
        const rangeEl = document.getElementById("pagination-range");
        if (totalEl) totalEl.textContent = filteredList.length;
        if (rangeEl) rangeEl.textContent = filteredList.length === 0 ? "0" : `${start + 1}–${Math.min(end, filteredList.length)}`;

        // Page indicators
        updatePageIndicators(filteredList.length);
      }
    }
  }

  async function renderBatchCards() {
    const kanbanWrap = document.getElementById("batches-kanban-wrapper");
    if (!kanbanWrap) return;
    kanbanWrap.innerHTML = "";
    kanbanWrap.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4 select-none min-h-[300px] items-start";

    // Fetch batches to know the columns
    const { data: batchesData } = await fetchBatches({ forceRefresh: false });
    const batches = batchesData || [];

    // Group active beneficiaries
    const grouped = { unassigned: [] };
    batches.forEach(b => { grouped[b.id] = []; });

    activeBeneficiaries.forEach(bene => {
      const bid = bene.batch_id ?? bene.batch?.id;
      if (bid && grouped[bid]) {
        grouped[bid].push(bene);
      } else {
        grouped["unassigned"].push(bene);
      }
    });

    const BATCH_PALETTES = [
      { bg: "bg-sky-500/20",     border: "border-sky-500/30",     text: "text-sky-600 dark:text-sky-400" },
      { bg: "bg-emerald-500/20", border: "border-emerald-500/30", text: "text-emerald-600 dark:text-emerald-400" },
      { bg: "bg-amber-500/20",   border: "border-amber-500/30",   text: "text-amber-600 dark:text-amber-400" },
      { bg: "bg-rose-500/20",    border: "border-rose-500/30",    text: "text-rose-600 dark:text-rose-400" },
      { bg: "bg-fuchsia-500/20", border: "border-fuchsia-500/30", text: "text-fuchsia-600 dark:text-fuchsia-400" },
      { bg: "bg-violet-500/20",  border: "border-violet-500/30",  text: "text-violet-600 dark:text-violet-400" },
      { bg: "bg-cyan-500/20",    border: "border-cyan-500/30",    text: "text-cyan-600 dark:text-cyan-400" },
      { bg: "bg-orange-500/20",  border: "border-orange-500/30",  text: "text-orange-600 dark:text-orange-400" },
    ];

    const totalBene = activeBeneficiaries.length || 1;

    const createCard = (title, items, colId, pal, isUnassigned = false, batchNumber = "", batchName = "") => {
      const percentage = Math.round((items.length / totalBene) * 100);
      let progColor = "bg-emerald-500";
      if (percentage > 33 && percentage <= 66) progColor = "bg-orange-500";
      if (percentage > 66) progColor = "bg-red-500";

      return `
        <div class="batch-card cursor-pointer group flex flex-col justify-between p-5 rounded-none border ${pal.border} ${pal.bg} bg-opacity-40 dark:bg-opacity-10 backdrop-blur-md shadow-md hover:shadow-xl hover:scale-[1.02] hover:skew-x-[-6deg] active:scale-95 transition-all duration-300 min-h-[160px]" data-batch-id="${colId}">
          <div class="flex flex-col justify-between h-full w-full group-hover:skew-x-[6deg] transition-all duration-300">
            <div class="flex items-start justify-between">
              <div class="space-y-1">
                <h3 class="font-montserrat font-black text-base uppercase tracking-wider ${pal.text}">${title}</h3>
                <p class="text-xs font-bold text-spes-black/50 dark:text-white/40 uppercase tracking-widest">${items.length} Beneficiaries</p>
              </div>
            <div class="h-8 w-8 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center shadow-inner hover:bg-white dark:hover:bg-black/40 transition-all z-10"
                 onclick="event.stopPropagation(); if (window.openEditBatchDrawer) window.openEditBatchDrawer('${colId}', '${batchNumber || ''}', '${batchName || ''}')">
              <svg class="h-4 w-4 ${pal.text}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
          </div>
          <div class="space-y-2 mt-4">
            <div class="w-full bg-black/5 dark:bg-white/5 rounded-full h-2 overflow-hidden">
              <div class="${progColor} h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
            </div>
            <div class="flex justify-between items-center text-[0.625rem] font-black uppercase tracking-wider text-spes-black/60 dark:text-white/50">
              <span>Progress</span>
              <span>${percentage}% of Total</span>
            </div>
          </div>
        </div>
      </div>
      `;
    };

    let cardsHtml = "";

    // Batches
    batches.forEach((b, i) => {
      const pal = BATCH_PALETTES[i % BATCH_PALETTES.length];
      const title = b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.batch_number}`;
      cardsHtml += createCard(title, grouped[b.id] || [], b.id, pal, false, b.batch_number, b.batch_name);
    });

    kanbanWrap.innerHTML = cardsHtml;

    // Click event to drill down
    kanbanWrap.querySelectorAll(".batch-card").forEach(card => {
      card.addEventListener("click", () => {
        selectedBatchId = card.dataset.batchId;
        currentPage = 1;
        _setUrlParam("batch", selectedBatchId);
        renderPaginatedTable();
      });
    });
  }

  // ── Pagination Indicators (Updated to compacted + responsive input) ──────
  function updatePageIndicators(totalCount) {
    const indicatorsEl = document.getElementById("page-indicators-container");
    if (indicatorsEl) {
      const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE));
      
      let pages = [];
      if (totalPages <= 5) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
      } else {
        pages = [1, 2, 3, 4, 'input', totalPages];
      }

      let html = "";
      pages.forEach(p => {
        if (p === 'input') {
          const showValue = (currentPage > 4 && currentPage < totalPages) ? currentPage : '';
          const activeClass = showValue !== '' ? 'bg-spes-blue/8 text-spes-blue dark:bg-white/10 dark:text-spes-yellow font-bold' : 'text-spes-black/60 dark:text-spes-white/60';
          
          html += `
            <li class="flex items-center border border-spes-blue/15 dark:border-white/10 bg-spes-white dark:bg-spes-dark-primary">
              <input type="number" min="1" max="${totalPages}" value="${showValue}" placeholder="..." 
                     class="w-12 py-2 text-center text-sm bg-transparent focus:outline-none focus:ring-1 focus:ring-spes-blue dark:focus:ring-spes-yellow transition-colors [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${activeClass}" 
                     style="-moz-appearance: textfield;" title="Type page and press Enter" />
            </li>
          `;
        } else {
          const active = p === currentPage
            ? "bg-spes-blue/8 text-spes-blue dark:bg-white/10 dark:text-spes-yellow font-bold border-spes-blue/15"
            : "bg-spes-white text-spes-black/60 hover:bg-spes-blue/8 hover:text-spes-blue dark:bg-spes-dark-primary dark:text-spes-white/60 dark:hover:bg-spes-white/8 dark:hover:text-spes-yellow border-spes-blue/15 dark:border-white/10";
          html += `<li><button class="page-btn cursor-pointer border px-3 py-2 text-sm font-medium ${active} transition-colors" data-page="${p}">${p}</button></li>`;
        }
      });
      
      indicatorsEl.innerHTML = html;
      
      indicatorsEl.querySelectorAll(".page-btn").forEach(btn => {
        btn.addEventListener("click", e => {
          currentPage = parseInt(e.currentTarget.getAttribute("data-page"), 10);
          renderPaginatedTable();
        });
      });
      
      const input = indicatorsEl.querySelector("input");
      if (input) {
        input.addEventListener("change", (e) => {
          let val = parseInt(e.target.value, 10);
          if (isNaN(val) || val < 1) val = 1;
          if (val > totalPages) val = totalPages;
          currentPage = val;
          renderPaginatedTable();
        });
        input.addEventListener("keyup", (e) => {
          if (e.key === "Enter") {
            input.blur();
          }
        });
      }
    }
  }

  // ── Pagination controls ──────────────────────────────────────
  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderPaginatedTable(); }
  });
  document.getElementById("next-page")?.addEventListener("click", () => {
    let listLength = 0;
    if (viewMode === "implementors") {
      listLength = activeImplementors.length;
    } else if (selectedBatchId === "unassigned") {
      listLength = activeBeneficiaries.filter(b => b.batch_id === null || b.batch?.id === null).length;
    } else if (selectedBatchId !== null) {
      listLength = activeBeneficiaries.filter(b => String(b.batch_id ?? b.batch?.id) === String(selectedBatchId)).length;
    } else {
      listLength = activeBeneficiaries.length;
    }
    const total = Math.ceil(listLength / ROWS_PER_PAGE);
    if (currentPage < total) { currentPage++; renderPaginatedTable(); }
  });

  // ── Select all ───────────────────────────────────────────────
  document.getElementById("staff-checkbox-all")?.addEventListener("change", e => {
    document.querySelectorAll(".beneficiary-row-checkbox").forEach(cb => cb.checked = e.target.checked);
  });

  // ── Sort / filter ────────────────────────────────────────────
  function setupSortFilter(data) {
    if (sortFilterInstance) {
      sortFilterInstance.updateData(data);
    } else {
      sortFilterInstance = setupSortFiltration({
        tableId: "beneficiary-table-body",
        dropdownSortId: "dropdown-sort-beneficiary",
        btnFilterId: "btn-filter-beneficiary",
        dropdownFilterId: "dropdown-filter-beneficiary",
        panelId: "dropdown-sortfilter-beneficiary",
        tabSortId: "sf-tab-sort",
        tabFilterId: "sf-tab-filter",
        originalData: data,
        onRender: (filtered) => {
          if (viewMode === "implementors") {
            activeImplementors = filtered;
          } else {
            activeBeneficiaries = filtered;
          }
          currentPage = 1;
          renderPaginatedTable();
        }
      });
    }
  }

  // ── Data loading ─────────────────────────────────────────────
  async function loadData(forceRefresh = false) {
    if (isAdmin && viewMode === "implementors") {
      await switchToImplementorsView();
      return;
    }

    const showOfficeCol = currentOfficeLocation === "ALL";
    showTableSkeleton(showOfficeCol ? 7 : 6);
    const { data, error } = await fetchBeneficiaries({ forceRefresh });
    if (error) {
      modals.error("Load Error", error);
      tbody.innerHTML = `<tr><td colspan="${showOfficeCol ? 7 : 6}" class="text-center py-8 text-sm text-spes-black/40 dark:text-white/40">Failed to load data.</td></tr>`;
      return;
    }

    let filteredData = data;
    if (session && session.role !== "admin" && officerOffice && officerOffice.location) {
      // Officer's data is already filtered by API
      filteredData = data;
    } else if (isAdmin && currentOfficeId && currentOfficeId !== "ALL") {
      filteredData = data.filter(b => b.staffs?.office_id == currentOfficeId);
    }

    allBeneficiaries = filteredData;
    // Show controls container
    document.getElementById("table-controls-container")?.classList.remove("hidden");

    setupSortFilter(filteredData);

    // Officers see their own office roster directly — show the status switch for them.
    // Admin lands on the implementors list first (handled in the view switchers).
    if (!isAdmin) _showStatusSwitch(true);
  }

  // ── Add / Edit drawer ────────────────────────────────────────
  const bdfOverlay = document.getElementById("drawer-bene-form-overlay");
  const bdfDrawer = document.getElementById("drawer-bene-form");
  const bdfTitle = document.getElementById("drawer-bene-form-title");
  const bdfSubtitle = document.getElementById("drawer-bene-form-subtitle");
  const bdfError = document.getElementById("bdf-error");
  const bdfForm = document.getElementById("form-bene-drawer");
  const bdfCloseBtn = document.getElementById("btn-close-bene-form-drawer");
  const bdfCancelBtn = document.getElementById("btn-cancel-bene-form");
  const bdfSubmitBtn = document.getElementById("btn-submit-bene-form");


  let _bdfEditId = null;

  const _bdfIsMobile = () => window.innerWidth < 640;

  const _bdfShowError = (msg) => {
    if (bdfError) { bdfError.textContent = msg; bdfError.classList.remove("hidden"); }
  };
  const _bdfHideError = () => {
    if (bdfError) { bdfError.textContent = ""; bdfError.classList.add("hidden"); }
  };
  const _bdfSetLoading = (loading) => {
    if (!bdfSubmitBtn) return;

    const isUnapprovedOfficer = session && session.role !== "admin" && String(session.approved).toLowerCase() === "false";
    bdfSubmitBtn.disabled = loading || isUnapprovedOfficer;

    if (isUnapprovedOfficer) {
      bdfSubmitBtn.title = "Action disabled. You are not yet approved.";
      bdfSubmitBtn.classList.add("cursor-not-allowed", "opacity-50");
    } else {
      bdfSubmitBtn.title = "";
      bdfSubmitBtn.classList.remove("cursor-not-allowed", "opacity-50");
    }

    bdfSubmitBtn.innerHTML = loading
      ? `<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Saving…`
      : `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> <span>${_bdfEditId ? "Save Changes" : "Save Beneficiary"}</span>`;
  };

  const openBdfDrawer = async (defaults = null) => {
    if (!bdfDrawer || !bdfOverlay) return;
    _bdfEditId = defaults?.id ?? null;
    _bdfHideError();
    _bdfSetLoading(false);
    if (bdfForm) bdfForm.reset();

    const activeOfficeLoc = isAdmin ? currentOfficeLocation : officerOffice?.location;
    if (defaults) {
      await _patchedBdfFill(defaults, true);
      if (activeOfficeLoc) {
        const addressInput = document.getElementById("bdf-address");
        if (addressInput) {
          addressInput.setAttribute("readonly", "true");
          addressInput.classList.add("bg-gray-100", "dark:bg-white/5", "pointer-events-none");
        }
      } else {
        const addressInput = document.getElementById("bdf-address");
        if (addressInput) {
          addressInput.removeAttribute("readonly");
          addressInput.classList.remove("bg-gray-100", "dark:bg-white/5", "pointer-events-none");
        }
      }
    } else {
      await _patchedBdfFill({ year_period: new Date().getFullYear() });
      if (activeOfficeLoc) {
        const addressInput = document.getElementById("bdf-address");
        if (addressInput) {
          addressInput.value = activeOfficeLoc;
          addressInput.setAttribute("readonly", "true");
          addressInput.classList.add("bg-gray-100", "dark:bg-white/5", "pointer-events-none");
        }
      } else {
        const addressInput = document.getElementById("bdf-address");
        if (addressInput) {
          addressInput.removeAttribute("readonly");
          addressInput.classList.remove("bg-gray-100", "dark:bg-white/5", "pointer-events-none");
        }
      }
    }

    // Populate and show Admin staff assignment dropdown if admin
    const assignContainer = document.getElementById("admin-assign-staff-container");
    const assignSelect = document.getElementById("bdf-assign-staff");
    if (isAdmin && assignContainer && assignSelect) {
      assignContainer.classList.remove("hidden");
      
      // Ensure we have implementors list
      let staffList = allImplementors;
      if (!staffList || staffList.length === 0) {
        staffList = await fetchImplementorList({ forceRefresh: false });
        staffList = staffList.filter(s => !s.archive_at);
      }
      
      assignSelect.innerHTML = `<option value="">— Unassigned (All SPES) —</option>` + 
        staffList.map(s => `<option value="${s.id}">${s.full_name} (${s.office || 'No Office'})</option>`).join("");
        
      if (defaults && defaults.staff_id) {
        assignSelect.value = defaults.staff_id;
      } else if (!_bdfEditId && currentStaffIdView) {
        assignSelect.value = currentStaffIdView;
      } else {
        assignSelect.value = "";
      }
    } else if (assignContainer) {
      assignContainer.classList.add("hidden");
    }
    // --- Auto-inject batch from selectedBatchId (Add mode) or from defaults (Edit mode) ---
    const batchIdSelect = document.getElementById("bdf-batch-id");
    if (batchIdSelect) {
      let resolvedBatchId = null;
      if (_bdfEditId && defaults?.batch_id) {
        // Edit mode — use the existing batch on the record
        resolvedBatchId = String(defaults.batch_id);
      } else if (!_bdfEditId && selectedBatchId && selectedBatchId !== "unassigned") {
        // Add mode — inherit the currently selected batch from the Kanban view
        resolvedBatchId = String(selectedBatchId);
      }

      // Fetch batch list
      const { fetchBatches: _fb } = await import("../../../../backend/api/beneficiary.js");
      const { data: batches } = await _fb({ forceRefresh: false });

      let html = `<option value="">— Unassigned —</option>`;
      (batches ?? []).forEach(b => {
        const label = b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.batch_number}`;
        html += `<option value="${b.id}">${label}</option>`;
      });
      batchIdSelect.innerHTML = html;
      batchIdSelect.value = resolvedBatchId ?? "";
    }
    // --- End batch auto-inject ---


    if (bdfTitle) bdfTitle.textContent = _bdfEditId ? "Edit Beneficiary" : "Add Beneficiary";
    if (bdfSubtitle) bdfSubtitle.textContent = _bdfEditId ? "Update the beneficiary record below." : "Fill in the details to register a new beneficiary.";

    bdfDrawer.classList.remove("hidden");
    bdfDrawer.setAttribute("aria-hidden", "false");
    bdfOverlay.classList.remove("hidden");
    bdfDrawer.offsetHeight;
    requestAnimationFrame(() => {
      bdfOverlay.classList.remove("opacity-0");
      bdfOverlay.classList.add("opacity-100");
      if (_bdfIsMobile()) {
        bdfDrawer.classList.remove("translate-y-full");
        bdfDrawer.classList.add("translate-y-0");
      } else {
        bdfDrawer.classList.remove("sm:translate-x-full");
        bdfDrawer.classList.add("sm:translate-x-0");
      }
    });
    document.body.classList.add("overflow-hidden");
  };

  const closeBdfDrawer = () => {
    if (!bdfDrawer || !bdfOverlay) return;
    bdfDrawer.setAttribute("aria-hidden", "true");
    if (_bdfIsMobile()) {
      bdfDrawer.classList.remove("translate-y-0");
      bdfDrawer.classList.add("translate-y-full");
    } else {
      bdfDrawer.classList.remove("sm:translate-x-0");
      bdfDrawer.classList.add("sm:translate-x-full");
    }
    bdfOverlay.classList.remove("opacity-100");
    bdfOverlay.classList.add("opacity-0");
    setTimeout(() => {
      bdfOverlay.classList.add("hidden");
      if (bdfDrawer.classList.contains("translate-y-full") || bdfDrawer.classList.contains("sm:translate-x-full")) {
        bdfDrawer.classList.add("hidden");
      }
      document.body.classList.remove("overflow-hidden");
    }, 300);
  };

  bdfCloseBtn?.addEventListener("click", closeBdfDrawer);
  bdfCancelBtn?.addEventListener("click", closeBdfDrawer);
  bdfOverlay?.addEventListener("click", closeBdfDrawer);

  bdfForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    _bdfHideError();

    const values = _bdfCollect();
    if (!values.full_name) return _bdfShowError("Name of Assured is required.");

    // If Admin is in a specific implementor's view, assign that staff_id when adding
    // Now handled by the dropdown! But we leave this as fallback if the dropdown wasn't rendered
    if (!_bdfEditId && isAdmin && currentStaffIdView && values.staff_id == null) {
      values.staff_id = currentStaffIdView;
    }

    _bdfSetLoading(true);

    let result;
    if (_bdfEditId) {
      result = await updateBeneficiary(_bdfEditId, values);
    } else {
      result = await addBeneficiary(values);
    }

    _bdfSetLoading(false);

    if (!result.success) return _bdfShowError(result.error ?? "Failed to save. Please try again.");

    closeBdfDrawer();
    await modals.success(
      _bdfEditId ? "Updated!" : "Added!",
      _bdfEditId ? `${values.full_name}'s record has been updated.` : `${values.full_name} has been added to the directory.`
    );
    await loadData(true);
  });

  function showAddModal() { openBdfDrawer(); }
  function showEditModal(b) { openBdfDrawer(b); }

  // ── Archive confirmation ──────────────────────────────────────
  async function confirmArchive(id, name) {
    const result = await modals.confirm(
      "Archive Beneficiary",
      `Archive ${name?.toUpperCase()}? They will be removed from the active roster. This action can be undone by an administrator.`,
      "Archive",
      "Cancel"
    );
    if (!result.isConfirmed) return;

    modals.loading("Archiving...", "Please wait...");
    const res = await archiveBeneficiary(id);
    modals.close();

    if (res.success) {
      await modals.success("Archived", `${name} has been archived.`);
      await loadData(true);
    } else {
      modals.error("Error", res.error);
    }
  }

  // ── Wire Add button ──────────────────────────────────────────
  if (addBtn) {
    addBtn.addEventListener("click", showAddModal);
  }

  // ── Wire Create Batch button (Admin only) ──────────────────────
  const createBatchBtn = document.getElementById("btn-create-batch");
  const batchDrawer = document.getElementById("drawer-batch-form");
  const batchDrawerOverlay = document.getElementById("drawer-batch-form-overlay");
  
  if (createBatchBtn && batchDrawer) {
    let currentEditBatchId = null;
    const batchFormTitle = document.getElementById("drawer-batch-form-title");

    const closeBatchDrawer = () => {
      batchDrawer.classList.remove("translate-y-0", "sm:translate-x-0");
      batchDrawer.classList.add("translate-y-full", "sm:translate-x-full");
      batchDrawerOverlay.classList.remove("opacity-100");
      batchDrawerOverlay.classList.add("opacity-0");
      document.body.classList.remove("overflow-hidden");
      setTimeout(() => {
        batchDrawerOverlay.classList.add("hidden");
        batchDrawerOverlay.classList.remove("block");
        batchDrawer.classList.add("hidden");
      }, 300);
    };

    const openBatchDrawer = () => {
      currentEditBatchId = null;
      if (batchFormTitle) batchFormTitle.textContent = "Create Batch";
      document.getElementById("form-batch-drawer")?.reset();
      document.getElementById("batch-form-error")?.classList.add("hidden");
      batchDrawer.classList.remove("hidden");
      batchDrawerOverlay.classList.remove("hidden");
      batchDrawerOverlay.classList.add("block");
      document.body.classList.add("overflow-hidden");
      
      // Trigger reflow
      void batchDrawer.offsetWidth;
      
      requestAnimationFrame(() => {
        batchDrawerOverlay.classList.remove("opacity-0");
        batchDrawerOverlay.classList.add("opacity-100");
        batchDrawer.classList.remove("translate-y-full", "sm:translate-x-full");
        batchDrawer.classList.add("translate-y-0", "sm:translate-x-0");
      });

      setTimeout(() => {
        document.getElementById("batch-form-number")?.focus();
      }, 300);
    };

    // --- START: Edit Batch Drawer ---
    window.openEditBatchDrawer = (batchId, batchNumber, batchName) => {
      currentEditBatchId = batchId;
      if (batchFormTitle) batchFormTitle.textContent = "Update Batch";
      document.getElementById("form-batch-drawer")?.reset();
      document.getElementById("batch-form-error")?.classList.add("hidden");
      
      const numInput = document.getElementById("batch-form-number");
      const nameInput = document.getElementById("batch-form-name");
      if (numInput) numInput.value = batchNumber;
      if (nameInput) nameInput.value = batchName !== "null" ? batchName : "";

      batchDrawer.classList.remove("hidden");
      batchDrawerOverlay.classList.remove("hidden");
      batchDrawerOverlay.classList.add("block");
      document.body.classList.add("overflow-hidden");
      
      // Trigger reflow
      void batchDrawer.offsetWidth;

      requestAnimationFrame(() => {
        batchDrawerOverlay.classList.remove("opacity-0");
        batchDrawerOverlay.classList.add("opacity-100");
        batchDrawer.classList.remove("translate-y-full", "sm:translate-x-full");
        batchDrawer.classList.add("translate-y-0", "sm:translate-x-0");
      });
    };
    // --- END: Edit Batch Drawer ---

    createBatchBtn.addEventListener("click", openBatchDrawer);
    document.getElementById("btn-close-batch-form-drawer")?.addEventListener("click", closeBatchDrawer);
    document.getElementById("btn-cancel-batch-form")?.addEventListener("click", closeBatchDrawer);
    batchDrawerOverlay?.addEventListener("click", closeBatchDrawer);

    // Save Batch
    const btnSaveBatch = document.getElementById("btn-save-batch-form");
    if (btnSaveBatch) {
      btnSaveBatch.addEventListener("click", async () => {
        const numInput = document.getElementById("batch-form-number").value.trim();
        const nameInput = document.getElementById("batch-form-name").value.trim();
        const errDiv = document.getElementById("batch-form-error");
        
        if (!numInput) {
          errDiv.textContent = "Batch Number is required.";
          errDiv.classList.remove("hidden");
          return;
        }

        btnSaveBatch.disabled = true;
        btnSaveBatch.innerHTML = `<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Saving...`;
        
        const payload = { batchNumber: numInput, batchName: nameInput };
        let res;
        
        if (currentEditBatchId) {
          res = await updateBatch(currentEditBatchId, payload);
        } else {
          res = await addBatch(payload);
        }
        
        btnSaveBatch.disabled = false;
        btnSaveBatch.innerHTML = "Save Batch";
        
        if (!res.success) {
          errDiv.textContent = res.error || (currentEditBatchId ? "Failed to update batch." : "Failed to add batch.");
          errDiv.classList.remove("hidden");
          return;
        }
        
        // Success
        modals.success("Success", `Batch ${numInput} ${currentEditBatchId ? "updated" : "added"} successfully!`);
        invalidateBatchCache();
        closeBatchDrawer();
        
        // Refresh view if in beneficiaries view
        if (viewMode === "beneficiaries") {
           batchSortPanel?.rebuild();
           renderPaginatedTable();
        }
      });
    }
  }

  document.getElementById("btn-back-to-implementors")?.addEventListener("click", () => {
    if (viewMode === "beneficiaries" && selectedBatchId !== null) {
      selectedBatchId = null;
      currentPage = 1;
      _clearUrlParam("batch");
      renderPaginatedTable();
    } else {
      if (isAdmin) {
        switchToImplementorsView();
      }
    }
  });

  window.openAddBeneficiaryDrawer = openBdfDrawer;

  if (window.location.hash === "#add") {
    setTimeout(() => {
      if (window.openAddBeneficiaryDrawer) window.openAddBeneficiaryDrawer();
    }, 500);
  }

  // --- START: Auto Calculate Age ---
  function setupAutoAgeCalculation() {
    const bdayInput = document.getElementById("bdf-birthday");
    const ageInput = document.getElementById("bdf-age");
    let timeoutId = null;

    if (bdayInput && ageInput) {
      bdayInput.addEventListener("input", (e) => {
        clearTimeout(timeoutId);

        const bdayVal = e.target.value;
        if (!bdayVal) return;

        // Wait 2 seconds to automatically calculate age
        timeoutId = setTimeout(() => {
          const birthDate = new Date(bdayVal);
          const today = new Date();
          let age = today.getFullYear() - birthDate.getFullYear();
          const m = today.getMonth() - birthDate.getMonth();

          if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
          }

          if (age >= 0) {
            ageInput.value = age;
          }
        }, 2000);
      });
    }
  }

  setupAutoAgeCalculation();
  // --- END: Auto Calculate Age ---

  // --- START: Custom Education Dropdown ---
  const eduBtn = document.getElementById("btn-education-dropdown");
  const eduMenu = document.getElementById("menu-education-dropdown");
  const eduInput = document.getElementById("bdf-education");

  if (eduBtn && eduMenu && eduInput) {
    eduBtn.addEventListener("click", () => {
      eduMenu.classList.toggle("hidden");
    });

    // Close on outside click
    document.addEventListener("click", (e) => {
      if (!eduBtn.contains(e.target) && !eduMenu.contains(e.target)) {
        eduMenu.classList.add("hidden");
      }
    });

    const options = eduMenu.querySelectorAll(".edu-option");
    options.forEach(opt => {
      opt.addEventListener("click", () => {
        const val = opt.getAttribute("data-value");
        const htmlContent = opt.innerHTML;

        eduInput.value = val;

        const selectedContent = document.getElementById("education-selected-content");
        if (selectedContent) {
          selectedContent.innerHTML = htmlContent;
        }

        eduMenu.classList.add("hidden");
      });
    });
  }
  // --- END: Custom Education Dropdown ---

  // --- START: Batch Dropdown (DB-driven) ---
  const batchDropdownBtn  = document.getElementById("btn-batch-dropdown");
  const batchDropdownMenu = document.getElementById("menu-batch-dropdown");
  const batchHiddenInput  = document.getElementById("bdf-batch-id");
  const batchSelectedText = document.getElementById("batch-selected-text");
  const batchOptionsList  = document.getElementById("batch-options-list");
  const batchAddRow       = document.getElementById("batch-add-row");
  const batchAddInput     = document.getElementById("batch-add-input");
  const batchAddConfirm   = document.getElementById("batch-add-confirm");
  const batchAddCancel    = document.getElementById("batch-add-cancel");

  // true = ADD mode (show "Add Batch" row), false = EDIT mode (read-only list)
  let _batchIsAddMode = true;

  async function _populateBatchDropdown() {
    if (!batchOptionsList) return;
    const { data } = await fetchBatches({ forceRefresh: false });
    batchOptionsList.innerHTML = "";

    // "— None —" option always first
    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.className = "batch-option cursor-pointer flex w-full items-center px-3.5 py-2 hover:bg-spes-blue/8 dark:hover:bg-white/5 transition-colors italic text-spes-black/40 dark:text-white/40 text-sm";
    noneBtn.dataset.batchId = "";
    noneBtn.dataset.batchLabel = "— None —";
    noneBtn.textContent = "— None —";
    const noneLi = document.createElement("li");
    noneLi.appendChild(noneBtn);
    batchOptionsList.appendChild(noneLi);

    (data ?? []).forEach(b => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "batch-option cursor-pointer flex w-full items-center px-3.5 py-2 hover:bg-spes-blue/8 dark:hover:bg-white/5 transition-colors font-bold text-sm";
      btn.dataset.batchId    = b.id;
      const displayName = b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.batch_number}`;
      btn.dataset.batchLabel = displayName;
      btn.textContent = displayName;
      li.appendChild(btn);
      batchOptionsList.appendChild(li);
    });
  }

  function _syncBatchDropdownDisplay(batchId) {
    if (!batchSelectedText || !batchHiddenInput) return;
    if (!batchId) {
      batchSelectedText.textContent = "— Select —";
      batchHiddenInput.value = "";
      return;
    }
    const match = batchOptionsList?.querySelector(`[data-batch-id="${batchId}"]`);
    if (match) {
      batchSelectedText.textContent = match.dataset.batchLabel;
      batchHiddenInput.value = batchId;
    }
  }

  const btnRevealBatchAdd = document.getElementById("btn-reveal-batch-add");
  const batchAddForm      = document.getElementById("batch-add-form");

  function _showBatchAddRow(show) {
    if (!batchAddRow) return;
    if (show) {
      batchAddRow.classList.remove("hidden");
      batchAddRow.classList.add("flex");
      // Reset state to show button, hide form
      if (btnRevealBatchAdd) btnRevealBatchAdd.classList.remove("hidden");
      if (batchAddForm) {
        batchAddForm.classList.remove("flex");
        batchAddForm.classList.add("hidden");
      }
    } else {
      batchAddRow.classList.add("hidden");
      batchAddRow.classList.remove("flex");
    }
  }

  // NOTE: Batch dropdown removed — batch is now auto-injected in openBdfDrawer from selectedBatchId.
  // The following dead-ref guard prevents crashes if any old code still references these elements.
  const _batchDropdownDeadGuard = (() => {
    const batchDropdownBtn  = document.getElementById("btn-batch-dropdown");
    // btn-batch-dropdown no longer exists in HTML — this is intentionally a no-op.
    if (batchDropdownBtn) {
      if (import.meta.env.DEV) console.warn("[SPES] btn-batch-dropdown found but should be removed from HTML.");
    }
  })();

  // Patch _bdfFill to also reset the batch badge on each open
  const _origBdfFill = _bdfFill;
  const _patchedBdfFill = (defaults = {}, isEdit = false) => {
    _origBdfFill(defaults);
    // Batch badge is now set in openBdfDrawer (async, after fetchBatches)
    // Reset it here so there's no stale label flicker while the async call runs
    const batchBadgeEl = document.getElementById("bdf-batch-badge");
    const batchNoneEl  = document.getElementById("bdf-batch-none");
    if (batchBadgeEl) { batchBadgeEl.textContent = ""; batchBadgeEl.classList.add("hidden"); }
    if (batchNoneEl)  batchNoneEl.classList.remove("hidden");
  };
  // --- END: Batch Display ---

  // ── Bootstrap ────────────────────────────────────────────────
  (async () => {
    try {
      const { data: officesData } = await supabase.from("offices").select("id, name, location");
      if (officesData) allOffices = officesData;
    } catch (err) {
      console.warn("[SPES] Load offices error:", err);
    }

    await loadOfficerOffice();

    // ── Restore URL state ────────────────────────────────────────
    const urlOffice = _getUrlParam("office");
    const urlBene   = _getUrlParam("b");

    if (isAdmin && urlOffice) {
      if (urlOffice === "ALL") {
        await switchToBeneficiariesView("ALL SPES", "ALL", "ALL");
      } else {
        // Fetch implementors fresh to get correct office name + location
        const staffs = await fetchImplementorList({ forceRefresh: true });
        // Only match on office_id (never fall back to staff row id)
        const match = staffs
          .filter(s => !s.archive_at && s.office_id != null)
          .find(s => String(s.office_id) === String(urlOffice));
        if (match) {
          await switchToBeneficiariesView(match.office, match.office_location, urlOffice);
          const urlBatch = _getUrlParam("batch");
          if (urlBatch) {
            selectedBatchId = urlBatch;
            renderPaginatedTable();
          }
        } else {
          _clearUrlParam("office");
          _clearUrlParam("batch");
          _clearUrlParam("b");
          await loadData();
        }
      }
    } else {
      await loadData();
    }

    // ── Restore beneficiary drawer ────────────────────────────────
    if (urlBene) {
      const idx = activeBeneficiaries.findIndex(b => String(b.id) === String(urlBene));
      if (idx !== -1) {
        // Go to the correct page
        currentPage = Math.floor(idx / ROWS_PER_PAGE) + 1;
        
        // renderPaginatedTable might not be in scope here if it's defined inside another block,
        // but wait, it is hoisted or accessible? We should check if we can call it.
        // But instead we can just click the pagination button or call renderPaginatedTable if it's available.
        // Actually, we can dispatch a custom event or just assume renderPaginatedTable is accessible.
        try {
          if (typeof renderPaginatedTable === 'function') {
             renderPaginatedTable();
          }
        } catch(e) {}

        setTimeout(() => {
          const row = document.querySelector(`tr[data-bene-id="${urlBene}"]`);
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Add highlight effect
            row.classList.add("bg-spes-blue/20", "dark:bg-spes-yellow/20", "border-l-4", "border-spes-blue", "dark:border-spes-yellow", "animate-pulse");
            
            // Wait for 1.5 seconds to let the user see the highlight before opening the drawer
            setTimeout(() => {
              row.classList.remove("bg-spes-blue/20", "dark:bg-spes-yellow/20", "border-l-4", "border-spes-blue", "dark:border-spes-yellow", "animate-pulse");
              openDrawer(activeBeneficiaries[idx], idx);
            }, 1500);
          } else {
            openDrawer(activeBeneficiaries[idx], idx);
          }
        }, 300);
      } else {
        // onRender is sync after fetch, so if not found the id is simply gone
        _clearUrlParam("b");
      }
    }
  })();
}

// --- START: Calculate Total Added Beneficiaries ---
/**
 * Calculate Total Added Beneficiaries for a specific implementor (staff).
 *
 * @param {number|string} staffId - The ID of the implementor (staff)
 * @returns {Promise<number>} The total count of beneficiaries added by this staff
 */
export async function calculateTotalBeneficiariesByImplementor(officeId) {
  if (!officeId) return 0;
  try {
    const skipArchive = sessionStorage.getItem("spes_bene_no_archive_col") === "1";
    
    let query = supabase
      .from("beneficiary")
      .select("*, staffs!staff_id!inner(office_id)", { count: "exact", head: false })
      .eq("staffs.office_id", officeId)
      .limit(0);

    if (!skipArchive) {
      query = query.is("archived_at", null);
    }

    let { count, error } = await query;

    if (error) {
      if (error.code === "42703") {
        // Fallback if archived_at doesn't exist
        const fallback = await supabase
          .from("beneficiary")
          .select("*, staffs!staff_id!inner(office_id)", { count: "exact", head: false })
          .eq("staffs.office_id", officeId)
          .limit(0);
        count = fallback.count;
        error = fallback.error;
      }
      
      if (error) {
        if (import.meta.env.DEV) console.error("[SPES] Error fetching beneficiaries for count:", error?.code);
        return 0;
      }
    }

    return count || 0;
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES] Exception in calculateTotalBeneficiariesByImplementor:", err?.message);
    return 0;
  }
}
// --- END: Calculate Total Added Beneficiaries ---

