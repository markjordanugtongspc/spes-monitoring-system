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
  fetchBeneficiaryTransferDestinations,
  fetchBeneficiaryBatchDestinations,
  bulkTransferBeneficiaries,
  bulkArchiveBeneficiaries,
  bulkRestoreBeneficiaries,
  bulkDeleteBeneficiaries,
  restoreBeneficiary,
} from "../../../../backend/api/beneficiary.js";
import { fetchImplementorList } from "../../../../backend/api/auth.js";
import { fetchOffices, fetchGlobalStaffMetricRoster } from "../../../../backend/api/staff.js";
import { getSession } from "../rbac/guard.js";
import { getOfficeAccessScope } from "../rbac/scope.js";
import { supabase } from "../../../../backend/api/supabase.js";
import { setupSortFiltration } from "./sort-filtration.js";
import { modals } from "./modals.js";
import { preferenceStorage } from "./storage.js";
import { initBatchFormDrawer } from "./drawer.js";
import { flowDebug, flowDebugError, flowDebugSuccess } from "./flow-debugger.js";

const DEFAULT_EDU_LEVELS = [
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

function formatEducationDisplay(b) {
  const categoryName = String(b?.education?.name ?? "").trim();
  const joinedLevelName = String(b?.education_level?.name ?? "").trim();
  const idLevelName = DEFAULT_EDU_LEVELS.find(
    level => Number(level.id) === Number(b?.education_level_id)
  )?.name ?? "";
  const levelName = joinedLevelName || idLevelName;

  if (!categoryName && !levelName) return "N/A";
  if (!levelName) return escHtml(categoryName.toUpperCase());
  if (!categoryName) return escHtml(levelName.toUpperCase());

  return `${escHtml(categoryName.toUpperCase())} - <u class="underline decoration-amber-500 font-extrabold decoration-2 underline-offset-2">${escHtml(levelName.toUpperCase())}</u>`;
}


// ── Office badge color palette (cycles through offices) ───────────
const OFFICE_BADGE_PALETTES = [
  { bg: "bg-sky-100 dark:bg-sky-900/80",       text: "text-sky-900 dark:text-sky-100",       border: "border-sky-300 dark:border-sky-500/70",       ring: "ring-sky-500/70" },
  { bg: "bg-emerald-100 dark:bg-emerald-900/80", text: "text-emerald-900 dark:text-emerald-100", border: "border-emerald-300 dark:border-emerald-500/70", ring: "ring-emerald-500/70" },
  { bg: "bg-amber-100 dark:bg-amber-900/80",     text: "text-amber-900 dark:text-amber-100",     border: "border-amber-300 dark:border-amber-500/70",     ring: "ring-amber-500/70" },
  { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/80", text: "text-fuchsia-900 dark:text-fuchsia-100", border: "border-fuchsia-300 dark:border-fuchsia-500/70", ring: "ring-fuchsia-500/70" },
  { bg: "bg-rose-100 dark:bg-rose-900/80",       text: "text-rose-900 dark:text-rose-100",       border: "border-rose-300 dark:border-rose-500/70",       ring: "ring-rose-500/70" },
  { bg: "bg-violet-100 dark:bg-violet-900/80",   text: "text-violet-900 dark:text-violet-100",   border: "border-violet-300 dark:border-violet-500/70",   ring: "ring-violet-500/70" },
  { bg: "bg-cyan-100 dark:bg-cyan-900/80",       text: "text-cyan-900 dark:text-cyan-100",       border: "border-cyan-300 dark:border-cyan-500/70",       ring: "ring-cyan-500/70" },
  { bg: "bg-orange-100 dark:bg-orange-900/80",   text: "text-orange-900 dark:text-orange-100",   border: "border-orange-300 dark:border-orange-500/70",   ring: "ring-orange-500/70" },
];

// ── Constants ─────────────────────────────────────────────────
let rowsPerPage = 10;

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

function formatOfficeShort(name) {
  if (!name) return "N/A";
  const value = String(name).toUpperCase();
  if (value.includes("CITY GOVERNMENT OF") && value.includes("(LGU)")) {
    return "LGU - " + value.replace("CITY GOVERNMENT OF ", "").replace(" (LGU)", "").trim();
  }
  if (value.includes("MUNICIPALITY OF") && value.includes("(LGU)")) {
    return "LGU - " + value.replace("MUNICIPALITY OF ", "").replace(" (LGU)", "").trim();
  }
  return name;
}

function _bdfCollect() {
  const g = (id) => document.getElementById(id)?.value?.trim() ?? "";
  const eduLvlVal = g("bdf-edulevel");
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
    education_level_id: eduLvlVal !== "" && eduLvlVal != null && !isNaN(parseInt(eduLvlVal, 10)) ? parseInt(eduLvlVal, 10) : null,
    edulevel: eduLvlVal,
    batch_id: g("bdf-batch-id") || null,
    staff_id: g("bdf-assign-staff") !== "" && g("bdf-assign-staff") != null ? parseInt(g("bdf-assign-staff"), 10) : null,
    return_status: g("bdf-return-status") || "NEW",
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
  set("bdf-return-status", defaults.return_status ? String(defaults.return_status).toUpperCase() : "NEW");

  const catId = defaults.educ_id ?? defaults.education?.id ?? "";
  set("bdf-education", catId);
  set("bdf-batch-id", defaults.batch_id);

  const levelVal = defaults.education_level_id ?? defaults.education_level?.id ?? (defaults.id ? preferenceStorage.getBeneficiaryEduLevel(defaults.id) : "");
  set("bdf-edulevel", levelVal ?? "");

  // Sync custom education dropdown visually
  const eduInput = document.getElementById("bdf-education");
  const selectedContent = document.getElementById("education-selected-content");
  const eduMenu = document.getElementById("menu-education-dropdown");

  if (eduInput && selectedContent && eduMenu) {
    const val = eduInput.value;
    const option = Array.from(eduMenu.querySelectorAll(".edu-option")).find(opt => opt.getAttribute("data-value") === String(val));
    if (option) {
      selectedContent.innerHTML = option.innerHTML;
    } else {
      selectedContent.innerHTML = `
        <svg class="h-4 w-4 text-spes-black/40 dark:text-spes-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222" />
        </svg>
        <span class="text-spes-black/50 dark:text-spes-white/50" id="education-selected-text">— Select Category —</span>
      `;
    }
    if (typeof window._updateEduSubLevelDropdown === "function") {
      window._updateEduSubLevelDropdown(val, levelVal);
    }
  }
}

function _patchedBdfFill(defaults = {}, isEdit = false) {
  _bdfFill(defaults);
  const batchBadgeEl = document.getElementById("bdf-batch-badge");
  const batchNoneEl  = document.getElementById("bdf-batch-none");
  if (batchBadgeEl) { batchBadgeEl.textContent = ""; batchBadgeEl.classList.add("hidden"); }
  if (batchNoneEl)  batchNoneEl.classList.remove("hidden");
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
    const searchWrap = searchInput.parentElement;
    let clearBtn = null;
    if (searchWrap) {
      searchWrap.classList.add("relative");
      searchInput.classList.add("pr-7");
      clearBtn = searchWrap.querySelector(`[data-clear-for="${config.searchInputId}"]`);
      if (!clearBtn) {
        clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.dataset.clearFor = config.searchInputId;
        clearBtn.className = "group absolute inset-y-0 end-1.5 hidden cursor-pointer items-center justify-center px-1 text-white/70 transition-colors hover:text-white focus-visible:outline-none";
        clearBtn.setAttribute("aria-label", "Clear search");
        clearBtn.title = "Clear search";
        clearBtn.innerHTML = `
          <svg class="h-3.5 w-3.5" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12"/>
          </svg>
          <span class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[0.625rem] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-800">
            Clear
            <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></span>
          </span>
        `;
        searchWrap.appendChild(clearBtn);
      }
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.focus();
      });
    }

    const syncClearBtn = () => {
      if (!clearBtn) return;
      const hasVal = searchInput.value.length > 0;
      clearBtn.classList.toggle("hidden", !hasVal);
      clearBtn.classList.toggle("flex", hasVal);
    };

    searchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      badgesList.querySelectorAll(".anim-badge").forEach(b => {
        const label = (b.dataset.label || "").toLowerCase();
        b.style.display = label.includes(q) ? "" : "none";
      });
      syncClearBtn();
    });
    // Support pressing Enter to automatically select the first matching search result
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const visibleBadges = Array.from(badgesList.querySelectorAll(".anim-badge")).filter(b => b.style.display !== "none");
        if (visibleBadges.length > 0) {
          // If the first is 'all' and there are other filtered results, pick the first specific match
          const targetBadge = (visibleBadges.length > 1 && visibleBadges[0].dataset.badgeId === "all" && searchInput.value.trim()) 
            ? visibleBadges[1] 
            : visibleBadges[0];
          targetBadge.click();
        }
      }
    });
    // Stop panel close on input click
    searchInput.addEventListener("click", e => e.stopPropagation());
    syncClearBtn();
  }

  const CHECK_ICON = `<svg class="h-2.5 w-2.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>`;

  function setActiveBadge(badge) {
    // Clear all badges back to their resting state
    badgesList.querySelectorAll(".anim-badge").forEach(b => {
      const isAll = b.dataset.badgeId === "all";
      b.classList.remove(
        "ring-2", "ring-white/60", "ring-offset-1", "ring-offset-transparent",
        "scale-105", "brightness-125", "shadow-lg",
        "bg-spes-yellow", "text-spes-blue", "border-spes-yellow", "border-spes-yellow/70", "ring-spes-yellow/60",
        "bg-white", "bg-spes-yellow/25"
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
      badge.classList.remove("bg-white/15", "text-white", "border-white/30");
      badge.classList.add("bg-spes-yellow", "text-spes-blue", "border-spes-yellow/70", "ring-2", "ring-spes-yellow/60", "ring-offset-1", "scale-105");
    } else {
      badge.classList.add("ring-2", "ring-spes-yellow/80", "ring-offset-1", "scale-105", "shadow-lg", "bg-spes-yellow", "text-spes-blue", "border-spes-yellow");
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
      "anim-badge snap-start cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider transition-all duration-200 opacity-0 scale-75 " +
      "bg-spes-yellow text-spes-blue border-spes-yellow/70 ring-2 ring-spes-yellow/60 ring-offset-1";
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
        `anim-badge snap-start cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[0.5625rem] font-black uppercase tracking-wider transition-all duration-200 opacity-0 scale-75 ` +
        `${pal.bg} ${pal.text} ${pal.border} hover:brightness-125 hover:scale-105`;
      const displayLabel = config.getLabel(item);
      const searchLabel = config.getSearchLabel?.(item) || displayLabel;
      badge.dataset.badgeId = config.getId(item);
      badge.dataset.label = `${displayLabel} ${searchLabel}`.toLowerCase();
      badge.title = config.getTitle?.(item) || searchLabel;
      badge.textContent = displayLabel;
      badgesList.appendChild(badge);
    });

    const activeBadge = badgesList.querySelector(
      `.anim-badge[data-badge-id="${CSS.escape(String(activeId))}"]`
    ) || allBadge;
    setActiveBadge(activeBadge);

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
    wrap.classList.add("max-w-[calc(100vw-2rem)]", "sm:max-w-[900px]", "opacity-100");

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
    btn.classList.add("bg-yellow-300", "text-spes-blue", "ring-2", "ring-spes-yellow/80");
    config.onOpen?.();
  }

  function closePanel(resetFilter = config.resetFilterOnClose ?? true) {
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
      wrap.classList.remove("max-w-[calc(100vw-2rem)]", "sm:max-w-[900px]", "opacity-100");
      badgesList.innerHTML = "";
      if (searchInput) searchInput.value = "";
    }, total * 35 + 180);

    panelOpen = false;
    btn.classList.remove("bg-yellow-300", "text-spes-blue", "ring-2", "ring-spes-yellow/80");
    if (resetFilter) {
      activeId = "all";
      config.onFilter(null);
    }
    config.onClose?.();
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    panelOpen ? closePanel() : openPanel();
  });
  document.addEventListener("click", (event) => {
    if (panelOpen && !panel.contains(event.target)) closePanel();
  });


  return {
    show()    { panel.classList.remove("hidden"); panel.classList.add("flex"); },
    hide()    { if (panelOpen) closePanel(false); panel.classList.add("hidden"); panel.classList.remove("flex"); },
    rebuild() { if (panelOpen) { closePanel(false); openPanel(); } },
    setActive(id) {
      activeId = id == null ? "all" : String(id);
      const badge = badgesList.querySelector(
        `.anim-badge[data-badge-id="${CSS.escape(activeId)}"]`
      );
      if (badge) setActiveBadge(badge);
    },
  };
}

// ── Drag + wheel-to-scroll helper ────────────────────────────
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
      const { data, error } = await fetchOffices({ forceRefresh: false });
      if (!error && Array.isArray(data)) {
        _cached = [...data].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      }
      return _cached;
    },
    getLabel:   (o) => formatOfficeShort(o.name),
    getSearchLabel: (o) => o.name,
    getTitle:   (o) => o.name,
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
    { bg: "bg-rose-100 dark:bg-rose-900/80",       text: "text-rose-900 dark:text-rose-100",       border: "border-rose-300 dark:border-rose-500/70" },
    { bg: "bg-sky-100 dark:bg-sky-900/80",         text: "text-sky-900 dark:text-sky-100",         border: "border-sky-300 dark:border-sky-500/70" },
    { bg: "bg-emerald-100 dark:bg-emerald-900/80", text: "text-emerald-900 dark:text-emerald-100", border: "border-emerald-300 dark:border-emerald-500/70" },
    { bg: "bg-amber-100 dark:bg-amber-900/80",     text: "text-amber-900 dark:text-amber-100",     border: "border-amber-300 dark:border-amber-500/70" },
    { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/80", text: "text-fuchsia-900 dark:text-fuchsia-100", border: "border-fuchsia-300 dark:border-fuchsia-500/70" },
    { bg: "bg-violet-100 dark:bg-violet-900/80",   text: "text-violet-900 dark:text-violet-100",   border: "border-violet-300 dark:border-violet-500/70" },
    { bg: "bg-cyan-100 dark:bg-cyan-900/80",       text: "text-cyan-900 dark:text-cyan-100",       border: "border-cyan-300 dark:border-cyan-500/70" },
    { bg: "bg-orange-100 dark:bg-orange-900/80",   text: "text-orange-900 dark:text-orange-100",   border: "border-orange-300 dark:border-orange-500/70" },
  ];

  const COLLAPSE_IDS = [];

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
    getLabel:      (b) => b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.id}`,
    getId:         (b) => String(b.id),
    getPalette:    (_b, i) => BATCH_PALETTES[i % BATCH_PALETTES.length],
    onFilter,
    resetFilterOnClose: false,
    onOpen: () => {},
    onClose: () => {},
  });

  addDragScroll(document.getElementById("batch-badges-list"));
  return inner;
}

// ── Main export ───────────────────────────────────────────────
export function initBeneficiaries() {
  const tbody = document.getElementById("beneficiary-table-body");
  if (!tbody) return;
  if (tbody.dataset.beneficiariesInitialized === "true") return;
  tbody.dataset.beneficiariesInitialized = "true";

  addDragScroll(document.getElementById("implementors-table-wrapper"));

  const session = getSession();
  const access = getOfficeAccessScope(session);
  const isAdmin = access.isAdmin;
  const isDirectoryViewer = access.canViewOtherOffices;
  let viewMode = isDirectoryViewer ? "implementors" : "beneficiaries";
  let officerOffice = null;

  // Admin view state
  let allImplementors = [];
  let activeImplementors = [];
  let currentOfficeLocation = "";
  let currentOfficeId = null;
  let currentStaffIdView = null;
  let allOffices = [];
  let globalImplementorMetric = null;

  const getPaginationStorageKey = () => viewMode === "implementors"
    ? "beneficiaries-implementors"
    : "beneficiaries";
  function getActiveBeneficiaryRecords(records = []) {
    return (records || []).filter((beneficiary) => !beneficiary.archived_at);
  }

  function renderOverallSpesSummary(records = [], { isGlobal = false, implementorCount = null } = {}) {
    const summaryShell = document.getElementById("global-spes-total-summary");
    const summaryContent = document.getElementById("overall-spes-total-summary");
    if (!summaryShell || !summaryContent) return;

    const activeRecords = getActiveBeneficiaryRecords(records);
    const totalNew = activeRecords.filter((beneficiary) =>
      String(beneficiary.return_status || "").trim().toUpperCase() === "NEW"
    ).length;
    const totalSpesBaby = activeRecords.filter((beneficiary) =>
      String(beneficiary.return_status || "").trim().toUpperCase() === "SPES BABY"
    ).length;
    const formatCount = (count) => new Intl.NumberFormat("en-US").format(count);
    const scopeLabel = isGlobal ? "Global Total of SPES" : "Total of SPES";
    const implementorsMarkup = isGlobal && implementorCount != null
      ? `
          <span class="text-slate-300 dark:text-white/25" aria-hidden="true">|</span>
          <p class="text-[0.625rem] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow">
            Implementors <span class="ml-1 tabular-nums">${formatCount(implementorCount)}</span>
          </p>`
      : "";

    summaryContent.innerHTML = `
      <div class="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border border-slate-200 bg-white px-4 py-2.5 text-center shadow-sm dark:border-white/10 dark:bg-white/5">
        <p class="font-montserrat text-xs font-black uppercase tracking-wider text-slate-700 dark:text-white/90">
          ${scopeLabel}: <span class="ml-1 text-base tabular-nums text-slate-950 dark:text-white">${formatCount(activeRecords.length)}</span>
        </p>
        <span class="text-slate-300 dark:text-white/25" aria-hidden="true">|</span>
        <p class="text-[0.625rem] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
          New <span class="ml-1 tabular-nums">${formatCount(totalNew)}</span>
        </p>
        ${implementorsMarkup}
        <span class="text-slate-300 dark:text-white/25" aria-hidden="true">|</span>
        <p class="text-[0.625rem] font-black uppercase tracking-wider text-red-600 dark:text-red-400">
          SPES Baby <span class="ml-1 tabular-nums">${formatCount(totalSpesBaby)}</span>
        </p>
      </div>
    `;
    summaryShell.classList.remove("hidden");
  }

  async function refreshGlobalSpesSummary(records = null) {
    const beneficiaryResult = records
      ? { data: records }
      : await fetchBeneficiaries({ forceRefresh: false });
    const staffResult = await fetchGlobalStaffMetricRoster();
    globalImplementorMetric = Array.isArray(staffResult.data) ? staffResult.data.length : 0;

    if (beneficiaryResult.error) {
      flowDebugError("Global summary failed to load beneficiaries", beneficiaryResult.error);
      return;
    }
    renderOverallSpesSummary(beneficiaryResult.data || [], {
      isGlobal: true,
      implementorCount: globalImplementorMetric,
    });
    flowDebugSuccess("Global beneficiary summary rendered", {
      beneficiaryCount: getActiveBeneficiaryRecords(beneficiaryResult.data || []).length,
      implementorCount: globalImplementorMetric,
      adminExcluded: true,
    });
  }


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
        const { data: offices, error } = await fetchOffices({ forceRefresh: false });
        const data = Array.isArray(offices)
          ? offices.find((office) => String(office.id) === String(session.office_id))
          : null;
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
  const officeSortPanel = initOfficeSortPanel((officeId) => {
    const filtered = officeId == null
      ? allImplementors
      : allImplementors.filter((staff) => String(staff.office_id) === String(officeId));
    sortFilterInstance?.updateData(filtered);
  });

  // State
  let allBeneficiaries = [];
  let activeBeneficiaries = [];
  let currentPage = 1;
  currentPage = preferenceStorage.getPaginationPage(getPaginationStorageKey()) || 1;
  let sortFilterInstance = null;
  let selectedBatchId = null;
  let currentOfficeName = "";
  let activeStatusMode = "NEW";
  let archiveStatusMode = "active";
  let beneficiarySortMode = "none";
  const selectedBeneficiaryIds = new Set();
  let beneficiaryBulkScope = "current-batch";

  const canManageCurrentOffice = () => (
    currentOfficeId !== "ALL" &&
    access.canManageOffice(currentOfficeId ?? access.ownOfficeId)
  );

  const canManageBeneficiary = (beneficiary) => (
    access.canManageOffice(
      beneficiary?.staffs?.office_id ?? currentOfficeId ?? access.ownOfficeId
    )
  );

  const getBranchBulkBeneficiaries = () => allBeneficiaries.filter(canManageBeneficiary);

  const getBulkScopeBeneficiaries = () => {
    const scope = beneficiaryBulkScope;
    const isArchivedView = archiveStatusMode === "archived";
    let rows = getBranchBulkBeneficiaries().filter((beneficiary) => Boolean(beneficiary.archived_at) === isArchivedView);
    if (scope === "all-batches" || selectedBatchId === null) return rows;
    if (selectedBatchId === "unassigned") {
      return rows.filter((beneficiary) => beneficiary.batch_id == null && beneficiary.batch?.id == null);
    }
    return rows.filter((beneficiary) => String(beneficiary.batch_id ?? beneficiary.batch?.id) === String(selectedBatchId));
  };

  // --- START: BENEFICIARY BULK ACTION TOOL FUNCTION ---
  function initBeneficiaryBulkTransferTools() {
    const toolsWrap = document.getElementById("beneficiary-bulk-tools");
    const trigger = document.getElementById("btn-beneficiary-bulk-tools");
    const menu = document.getElementById("beneficiary-bulk-tools-menu");
    const countEl = document.getElementById("beneficiary-bulk-count");
    const summaryEl = document.getElementById("beneficiary-bulk-summary");
    const actionsPanel = document.getElementById("beneficiary-bulk-actions");
    const destinationsPanel = document.getElementById("beneficiary-transfer-destinations");
    const destinationList = document.getElementById("beneficiary-transfer-destination-list");
    const destinationSearch = document.getElementById("beneficiary-transfer-search");
    const destinationHeading = document.getElementById("beneficiary-transfer-heading");
    const statusBtn = document.getElementById("btn-transfer-beneficiary-status");
    const officeTransferBtn = document.getElementById("btn-transfer-beneficiary-office");
    const batchTransferBtn = document.getElementById("btn-transfer-beneficiary-batch");
    const statusLabel = document.getElementById("beneficiary-transfer-status-label");
    const backBtn = document.getElementById("btn-back-transfer-actions");
    const archiveBtn = document.getElementById("btn-bulk-archive-beneficiaries");
    const archiveMenu = document.getElementById("beneficiary-bulk-archive-menu");
    const archiveActionBtn = document.getElementById("btn-bulk-archive-action");
    const archiveActionLabelEl = document.getElementById("beneficiary-bulk-archive-action-label");
    const archiveLabelEl = document.getElementById("beneficiary-bulk-archive-label");
    const deleteRevealBtn = document.getElementById("btn-reveal-bulk-delete-beneficiaries");

    if (
      !toolsWrap ||
      !trigger ||
      !menu ||
      !actionsPanel ||
      !destinationsPanel ||
      !destinationList ||
      !destinationSearch
    ) {
      flowDebug("BULK ACTIONS", "Beneficiary bulk-action tool skipped", {
        reason: "one or more bulk action controls are missing",
      });
      return {
        sync: () => {},
        clear: () => selectedBeneficiaryIds.clear(),
      };
    }

    let officeDestinations = null;
    let batchDestinations = null;
    let destinationMode = "office";
    let transferInFlight = false;
    let bulkActionInFlight = false;

    const getSelectedRows = () => allBeneficiaries.filter(
      (beneficiary) => selectedBeneficiaryIds.has(String(beneficiary.id))
    );

    const getTargetStatus = () => {
      const selectedRows = getSelectedRows();
      const allAreBaby = selectedRows.length > 0 && selectedRows.every(
        (beneficiary) => String(beneficiary.return_status || "NEW").toUpperCase() === "SPES BABY"
      );
      return allAreBaby ? "NEW" : "SPES BABY";
    };

    const closeMenu = () => {
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
      actionsPanel.classList.remove("hidden");
      destinationsPanel.classList.add("hidden");
      archiveMenu?.classList.add("hidden");
      archiveBtn?.setAttribute("aria-expanded", "false");
      officeTransferBtn?.setAttribute("aria-expanded", "false");
      batchTransferBtn?.setAttribute("aria-expanded", "false");
    };

    const sync = () => {
      const visibleCheckboxes = [...document.querySelectorAll(".beneficiary-row-checkbox")];
      visibleCheckboxes.forEach((checkbox) => {
        checkbox.checked = selectedBeneficiaryIds.has(String(checkbox.dataset.beneId));
      });

      const selectAll = document.getElementById("spes-checkbox-all");
      const scopeMenu = document.getElementById("beneficiary-bulk-scope-menu");
      const hasCurrentBatch = selectedBatchId !== null;
      if (!hasCurrentBatch && beneficiaryBulkScope === "current-batch") beneficiaryBulkScope = "all-batches";
      scopeMenu?.querySelectorAll("[data-bulk-scope]").forEach((button) => {
        const isCurrent = button.dataset.bulkScope === beneficiaryBulkScope;
        button.classList.toggle("bg-spes-blue/8", isCurrent);
        button.classList.toggle("dark:bg-white/8", isCurrent);
        button.disabled = button.dataset.bulkScope === "current-batch" && !hasCurrentBatch;
        button.classList.toggle("cursor-not-allowed", button.disabled);
        button.classList.toggle("opacity-45", button.disabled);
      });
      scopeMenu?.querySelectorAll("[data-bulk-scope-check]").forEach((check) => {
        check.classList.toggle("hidden", check.dataset.bulkScopeCheck !== beneficiaryBulkScope);
      });
      const allScopeRows = getBulkScopeBeneficiaries();
      const visibleIds = [...document.querySelectorAll(".beneficiary-row-checkbox")].map((checkbox) => String(checkbox.dataset.beneId));
      const selectedOnPage = visibleIds.filter((id) => selectedBeneficiaryIds.has(id)).length;
      if (selectAll) {
        selectAll.checked = visibleIds.length > 0 && selectedOnPage === visibleIds.length;
        selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < visibleIds.length;
      }
      const selectedInScope = allScopeRows.filter((beneficiary) =>
        selectedBeneficiaryIds.has(String(beneficiary.id))
      ).length;
      const selectAllScopeBtn = document.querySelector("[data-bulk-scope-action=\"toggle\"]");
      if (selectAllScopeBtn) {
        const allSelected = allScopeRows.length > 0 && selectedInScope === allScopeRows.length;
        const scopeLabel = beneficiaryBulkScope === "all-batches" ? "all batches" : "the current batch";
        const statusLabel = archiveStatusMode === "archived" ? "archived" : "active";
        selectAllScopeBtn.setAttribute("aria-pressed", String(allSelected));
        const actionLabel = selectAllScopeBtn.querySelector("[data-bulk-scope-action-label]");
        if (actionLabel) actionLabel.textContent = allSelected ? "Clear selection" : `Select all in ${scopeLabel}`;
        selectAllScopeBtn.title = allSelected
          ? `Clear the ${scopeLabel} selection`
          : `Select all ${allScopeRows.length} ${statusLabel} beneficiaries in ${scopeLabel}`;
      }

      const count = selectedBeneficiaryIds.size;
      if (countEl) countEl.textContent = String(count);
      if (summaryEl) {
        summaryEl.textContent = `${count} beneficiar${count === 1 ? "y" : "ies"} selected`;
      }
      if (statusLabel) statusLabel.textContent = `Transfer to ${getTargetStatus()}`;
      const isArchivedView = archiveStatusMode === "archived";
      if (archiveLabelEl) archiveLabelEl.textContent = isArchivedView ? "Restore & delete" : "Archive & delete";
      if (archiveActionLabelEl) archiveActionLabelEl.textContent = isArchivedView ? "Restore selected" : "Archive selected";
      archiveBtn?.classList.toggle("hover:bg-emerald-500/10", isArchivedView);
      archiveBtn?.classList.toggle("hover:text-emerald-700", isArchivedView);
      archiveBtn?.classList.toggle("dark:hover:bg-emerald-400/10", isArchivedView);
      archiveBtn?.classList.toggle("dark:hover:text-emerald-300", isArchivedView);
      officeTransferBtn?.classList.toggle("hidden", count === 0);
      batchTransferBtn?.classList.toggle("hidden", count === 0);
      deleteRevealBtn?.classList.toggle("hidden", !access.isAdmin);

      const tableIsVisible =
        viewMode === "beneficiaries" &&
        !document.getElementById("implementors-table-wrapper")?.classList.contains("hidden");
      const hasSelectableRows = allScopeRows.length > 0;
      toolsWrap.classList.toggle("hidden", count === 0 || !hasSelectableRows || !tableIsVisible);
      if (count === 0 || !hasSelectableRows || !tableIsVisible) closeMenu();
    };

    const clear = () => {
      selectedBeneficiaryIds.clear();
      sync();
    };

    const executeTransfer = async ({ title, message, payload }) => {
      const ids = [...selectedBeneficiaryIds];
      if (!ids.length || transferInFlight) return;

      const confirmation = await modals.confirm(title, message, "Transfer", "Cancel");
      if (!confirmation.isConfirmed) return;

      transferInFlight = true;
      flowDebug("BULK TRANSFER", "Submitting beneficiary transfer", {
        ids,
        payload,
        next: "bulkTransferBeneficiaries",
      });
      modals.loading("Transferring Beneficiaries", "Please wait while the selected records are updated...");
      let result;
      try {
        result = await bulkTransferBeneficiaries(ids, payload);
      } catch (error) {
        flowDebugError("Beneficiary bulk transfer threw an error", error, { ids, payload });
        result = { success: false, error: "The transfer request failed unexpectedly." };
      } finally {
        transferInFlight = false;
      }
      modals.close();

      if (!result.success) {
        flowDebugError("Beneficiary bulk transfer failed", result.error, { ids, payload });
        await modals.error("Transfer Failed", result.error);
        return;
      }

      flowDebugSuccess("Beneficiary bulk transfer completed", {
        transferred: result.transferred,
        payload,
      });
      clear();
      closeMenu();
      await loadData(true);
      await batchSortPanel?.rebuild?.();
      await modals.success(
        "Transfer Complete",
        `${result.transferred} beneficiar${result.transferred === 1 ? "y was" : "ies were"} transferred successfully.`
      );
    };

    const executeBulkMutation = async ({ title, message, loadingTitle, action, successTitle, successMessage, confirmLabel = title, cancelLabel = "Cancel" }) => {
      const ids = [...selectedBeneficiaryIds];
      if (!ids.length || bulkActionInFlight) return;

      const confirmation = await modals.confirm(title, message, confirmLabel, cancelLabel);
      if (!confirmation.isConfirmed) return;

      bulkActionInFlight = true;
      modals.loading(loadingTitle, "Please wait while the selected records are updated...");
      let result;
      try {
        result = await action(ids);
      } catch (error) {
        flowDebugError("Beneficiary bulk action threw an error", error, { ids, title });
        result = { success: false, error: "The bulk action failed unexpectedly." };
      } finally {
        bulkActionInFlight = false;
      }
      modals.close();

      if (!result.success) {
        await modals.error("Bulk Action Failed", result.error);
        return;
      }

      clear();
      closeMenu();
      await loadData(true);
      await batchSortPanel?.rebuild?.();
      await modals.success(successTitle, successMessage(result));
    };

    const renderDestinations = () => {
      const query = destinationSearch.value.trim().toLowerCase();
      const selectedRows = getSelectedRows();
      const selectedBatchIds = new Set(selectedRows.map((beneficiary) => String(beneficiary.batch_id ?? beneficiary.batch?.id ?? "")));
      const selectedOfficeIds = new Set(selectedRows.map((beneficiary) => String(beneficiary.staffs?.office_id ?? "")));
      if (destinationMode === "batch") {
        const filteredBatches = (batchDestinations ?? [])
          .filter((batch) => {
            if (!query) return true;
            return [batch.batch_name, batch.id, `batch ${batch.id}`]
              .some((value) => String(value || "").toLowerCase().includes(query));
          })
          .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

        if (!filteredBatches.length) {
          destinationList.innerHTML = `
            <div class="px-3 py-8 text-center text-xs font-semibold text-spes-black/40 dark:text-white/40">
              No matching batch destinations.
            </div>`;
          return;
        }

        destinationList.innerHTML = filteredBatches.map((batch) => {
          const batchLabel = batch.batch_name || `Batch ${batch.id}`;
          const isCurrentBatch = selectedBatchIds.has(String(batch.id));
          return `
            <button type="button" data-transfer-batch-id="${batch.id}" ${isCurrentBatch ? "disabled" : ""}
              class="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${isCurrentBatch ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-spes-blue/8 dark:hover:bg-white/8"}">
              <span class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400">
                <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M12 3v6m0 0H6m6 0h6M6 9v5m12-5v5M3 14h6v6H3v-6Zm12 0h6v6h-6v-6Z" />
                </svg>
              </span>
              <span class="min-w-0">
                <span class="block truncate text-xs font-black uppercase text-spes-black/80 dark:text-white/80">${escHtml(batchLabel)}${isCurrentBatch ? " (Current)" : ""}</span>
                <span class="mt-0.5 block truncate text-[0.625rem] font-semibold text-spes-black/45 dark:text-white/45">Batch ID ${escHtml(batch.id)}</span>
              </span>
            </button>`;
        }).join("");
        return;
      }

      const currentOffice = String(currentOfficeId || "");

      const filtered = (officeDestinations ?? [])
        .filter((destination) => {
          if (!query) return true;
          return [
            destination.office_name,
            destination.branch_name,
            destination.staff_name,
          ].some((value) => String(value || "").toLowerCase().includes(query));
        })
        .sort((a, b) => String(a.office_name).localeCompare(String(b.office_name)));

      if (!filtered.length) {
        destinationList.innerHTML = `
          <div class="px-3 py-8 text-center text-xs font-semibold text-spes-black/40 dark:text-white/40">
            No matching office destinations.
          </div>`;
        return;
      }

      destinationList.innerHTML = filtered.map((destination) => `
        <button type="button" data-transfer-staff-id="${destination.staff_id}" ${selectedOfficeIds.has(String(destination.office_id)) ? "disabled" : ""}
          class="flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${selectedOfficeIds.has(String(destination.office_id)) ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-spes-blue/8 dark:hover:bg-white/8"}">
          <span class="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
            <svg class="h-3.5 w-3.5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.25" d="M3 21h18M5 21V5l7-3 7 3v16" />
            </svg>
          </span>
          <span class="min-w-0">
            <span class="block truncate text-xs font-black uppercase text-spes-black/80 dark:text-white/80">${escHtml(destination.office_name)}${selectedOfficeIds.has(String(destination.office_id)) ? " (Current)" : ""}</span>
            <span class="mt-0.5 block truncate text-[0.625rem] font-semibold text-spes-black/45 dark:text-white/45">${escHtml(destination.branch_name)} | ${escHtml(destination.staff_name)}</span>
          </span>
        </button>
      `).join("");
    };

    const openDestinationPicker = async (mode) => {
      const activeButton = mode === "batch" ? batchTransferBtn : officeTransferBtn;
      const otherButton = mode === "batch" ? officeTransferBtn : batchTransferBtn;
      const isAlreadyOpen = !destinationsPanel.classList.contains("hidden") && destinationMode === mode;
      if (isAlreadyOpen) {
        destinationsPanel.classList.add("hidden");
        activeButton?.setAttribute("aria-expanded", "false");
        return;
      }

      destinationMode = mode;
      destinationsPanel.classList.remove("hidden");
      activeButton?.setAttribute("aria-expanded", "true");
      otherButton?.setAttribute("aria-expanded", "false");
      archiveMenu?.classList.add("hidden");
      archiveBtn?.setAttribute("aria-expanded", "false");
      destinationSearch.value = "";
      if (destinationHeading) destinationHeading.textContent = mode === "batch" ? "Batch destinations" : "Office destinations";
      destinationSearch.placeholder = mode === "batch"
        ? "Search batch number or name..."
        : "Search office or implementor...";
      destinationList.innerHTML = `
        <div class="px-3 py-8 text-center text-xs font-semibold text-spes-black/40 dark:text-white/40">
          Loading ${mode === "batch" ? "batches" : "destinations"}...
        </div>`;

      if (mode === "batch" && !batchDestinations) {
        const result = await fetchBeneficiaryBatchDestinations();
        if (result.error) {
          destinationList.innerHTML = `
            <div class="px-3 py-8 text-center text-xs font-semibold text-red-500">${escHtml(result.error)}</div>`;
          return;
        }
        batchDestinations = result.data;
      } else if (mode === "office" && !officeDestinations) {
        const result = await fetchBeneficiaryTransferDestinations();
        if (result.error) {
          destinationList.innerHTML = `
            <div class="px-3 py-8 text-center text-xs font-semibold text-red-500">${escHtml(result.error)}</div>`;
          return;
        }
        officeDestinations = result.data;
      }
      renderDestinations();
      destinationSearch.focus();
    };
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = menu.classList.contains("hidden");
      menu.classList.toggle("hidden", !willOpen);
      trigger.setAttribute("aria-expanded", String(willOpen));
      if (willOpen) {
        actionsPanel.classList.remove("hidden");
        destinationsPanel.classList.add("hidden");
      }
    });

    statusBtn?.addEventListener("click", () => {
      const targetStatus = getTargetStatus();
      executeTransfer({
        title: `Transfer to ${targetStatus}?`,
        message: `Update ${selectedBeneficiaryIds.size} selected beneficiar${selectedBeneficiaryIds.size === 1 ? "y" : "ies"} to ${targetStatus}?`,
        payload: { returnStatus: targetStatus },
      });
    });
    archiveActionBtn?.addEventListener("click", () => {
      const count = selectedBeneficiaryIds.size;
      executeBulkMutation({
        title: `${archiveStatusMode === "archived" ? "Restore" : "Archive"} ${count} Beneficiar${count === 1 ? "y" : "ies"}?`,
        message: archiveStatusMode === "archived"
          ? `Restore ${count} selected beneficiary record${count === 1 ? "" : "s"} to the active roster?`
          : `Archive ${count} selected beneficiary record${count === 1 ? "" : "s"}? They can be restored later.`,
        loadingTitle: archiveStatusMode === "archived" ? "Restoring Beneficiaries" : "Archiving Beneficiaries",
        action: archiveStatusMode === "archived" ? bulkRestoreBeneficiaries : bulkArchiveBeneficiaries,
        successTitle: archiveStatusMode === "archived" ? "Restore Complete" : "Archive Complete",
        successMessage: (result) => archiveStatusMode === "archived"
          ? `${result.restored} beneficiar${result.restored === 1 ? "y was" : "ies were"} restored.`
          : `${result.archived} beneficiar${result.archived === 1 ? "y was" : "ies were"} archived.`,
      });
    });
    archiveBtn?.addEventListener("click", () => {
      const expanded = archiveBtn.getAttribute("aria-expanded") === "true";
      archiveBtn.setAttribute("aria-expanded", String(!expanded));
      archiveMenu?.classList.toggle("hidden", expanded);
      destinationsPanel.classList.add("hidden");
      officeTransferBtn?.setAttribute("aria-expanded", "false");
      batchTransferBtn?.setAttribute("aria-expanded", "false");
    });
    document.getElementById("btn-beneficiary-bulk-scope")?.addEventListener("click", () => {
      const scopeButton = document.getElementById("btn-beneficiary-bulk-scope");
      const scopeMenu = document.getElementById("beneficiary-bulk-scope-menu");
      const expanded = scopeButton?.getAttribute("aria-expanded") === "true";
      scopeButton?.setAttribute("aria-expanded", String(!expanded));
      scopeMenu?.classList.toggle("hidden", expanded);
    });
    document.querySelectorAll("[data-bulk-scope]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.disabled) return;
        beneficiaryBulkScope = button.dataset.bulkScope || "current-batch";
        beneficiaryBulkTransferTools.sync();
      });
    });
    document.querySelector("[data-bulk-scope-action=\"toggle\"]")?.addEventListener("click", () => {
      const selectableRows = getBulkScopeBeneficiaries();
      const isFullySelected = selectableRows.length > 0 && selectableRows.every(
        (beneficiary) => selectedBeneficiaryIds.has(String(beneficiary.id))
      );
      selectableRows.forEach((beneficiary) => {
        const id = String(beneficiary.id);
        if (!isFullySelected) selectedBeneficiaryIds.add(id);
        else selectedBeneficiaryIds.delete(id);
      });
      beneficiaryBulkTransferTools.sync();
    });
    deleteRevealBtn?.addEventListener("click", () => {
      const count = selectedBeneficiaryIds.size;
      closeMenu();
      executeBulkMutation({
        title: `Permanently delete ${count} Beneficiar${count === 1 ? "y" : "ies"}?`,
        message: `This permanently removes ${count} selected beneficiary record${count === 1 ? "" : "s"} from Supabase. This cannot be undone.`,
        loadingTitle: "Deleting Beneficiaries",
        action: bulkDeleteBeneficiaries,
        successTitle: "Permanent Delete Complete",
        successMessage: (result) => `${result.deleted} beneficiar${result.deleted === 1 ? "y was" : "ies were"} permanently deleted.`,
        confirmLabel: "Continue",
        cancelLabel: "Cancel",
      });
    });
    document.querySelectorAll("[data-transfer-destination-mode]").forEach((button) => {
      button.addEventListener("click", () => openDestinationPicker(button.dataset.transferDestinationMode));
    });
    backBtn?.addEventListener("click", () => {
      destinationsPanel.classList.add("hidden");
      actionsPanel.classList.remove("hidden");
    });
    if (destinationSearch) {
      const destWrap = destinationSearch.parentElement;
      let clearDestBtn = null;
      if (destWrap) {
        destWrap.classList.add("relative");
        destinationSearch.classList.add("pr-8");
        clearDestBtn = destWrap.querySelector('[data-clear-for="beneficiary-transfer-search"]');
        if (!clearDestBtn) {
          clearDestBtn = document.createElement("button");
          clearDestBtn.type = "button";
          clearDestBtn.dataset.clearFor = "beneficiary-transfer-search";
          clearDestBtn.className = "group absolute inset-y-0 end-2 hidden cursor-pointer items-center justify-center px-1 text-spes-black/50 hover:text-spes-black dark:text-white/50 dark:hover:text-white transition-colors focus-visible:outline-none";
          clearDestBtn.setAttribute("aria-label", "Clear search");
          clearDestBtn.title = "Clear search";
          clearDestBtn.innerHTML = `
            <svg class="h-3.5 w-3.5" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12"/>
            </svg>
            <span class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[0.625rem] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-800">
              Clear
              <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></span>
            </span>
          `;
          destWrap.appendChild(clearDestBtn);
        }
        clearDestBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          destinationSearch.value = "";
          destinationSearch.dispatchEvent(new Event("input", { bubbles: true }));
          destinationSearch.focus();
        });
      }

      const syncDestClear = () => {
        if (!clearDestBtn) return;
        const hasVal = destinationSearch.value.length > 0;
        clearDestBtn.classList.toggle("hidden", !hasVal);
        clearDestBtn.classList.toggle("flex", hasVal);
      };

      destinationSearch.addEventListener("input", () => {
        renderDestinations();
        syncDestClear();
      });
      syncDestClear();
    }
    destinationList.addEventListener("click", (event) => {
      const batchButton = event.target.closest("[data-transfer-batch-id]");
      if (batchButton) {
        if (batchButton.disabled) return;
        const batch = (batchDestinations ?? []).find(
          (item) => String(item.id) === String(batchButton.dataset.transferBatchId)
        );
        if (!batch) return;
        const batchLabel = batch.batch_name || `Batch ${batch.id}`;
        executeTransfer({
          title: `Transfer to ${batchLabel}?`,
          message: `Move ${selectedBeneficiaryIds.size} selected beneficiar${selectedBeneficiaryIds.size === 1 ? "y" : "ies"} to ${batchLabel}? Their implementor assignment will remain unchanged.`,
          payload: { destinationBatchId: batch.id },
        });
        return;
      }

      const destinationButton = event.target.closest("[data-transfer-staff-id]");
      if (!destinationButton) return;
      const destination = (officeDestinations ?? []).find(
        (item) => String(item.staff_id) === String(destinationButton.dataset.transferStaffId)
      );
      if (!destination) return;

      executeTransfer({
        title: "Transfer to Office?",
        message: `Move ${selectedBeneficiaryIds.size} selected beneficiar${selectedBeneficiaryIds.size === 1 ? "y" : "ies"} to ${destination.office_name}? Their previous batch assignment will be cleared.`,
        payload: { destinationStaffId: destination.staff_id },
      });
    });

    tbody.addEventListener("change", (event) => {
      const checkbox = event.target.closest(".beneficiary-row-checkbox");
      if (!checkbox) return;
      const id = String(checkbox.dataset.beneId);
      if (checkbox.checked) selectedBeneficiaryIds.add(id);
      else selectedBeneficiaryIds.delete(id);
      sync();
    });

    document.addEventListener("click", (event) => {
      if (!toolsWrap.contains(event.target)) closeMenu();
    });

    sync();
    return { sync, clear };
  }
  // --- END: BENEFICIARY BULK ACTION TOOL FUNCTION ---

  const beneficiaryBulkTransferTools = initBeneficiaryBulkTransferTools();

  // ── Batch Sort Panel (admin + officer, beneficiary view) ─────
  const batchSortPanel = initBatchSortPanel((batchId) => {
    beneficiaryBulkTransferTools.clear();
    if (batchId === null || batchId === "all") {
      selectedBatchId = null;
      _clearUrlParam("batch");
    } else {
      selectedBatchId = batchId;
      _setUrlParam("batch", selectedBatchId);
    }
    currentPage = 1;
    renderPaginatedTable();
  });

  const batchFormDrawer = initBatchFormDrawer({
    onSuccess: async () => {
      await batchSortPanel?.rebuild?.();
      if (viewMode === "beneficiaries") renderPaginatedTable();
    }
  });
  const batchCardsWrap = document.getElementById("batches-kanban-wrapper");

  const openBatchForm = (trigger) => {
    if (!canManageCurrentOffice()) {
      modals.warning("Read-only Office", "You can view this office, but only your assigned office can be managed.");
      return;
    }
    const isEdit = trigger.classList.contains("btn-edit-batch");
    const batch = isEdit ? {
      id: trigger.dataset.batchId,
      batchId: trigger.dataset.batchId,
      batchName: trigger.dataset.batchName
    } : null;

    flowDebug("ACTION", isEdit ? "Edit Batch requested" : "Create Batch requested", {
      batch,
      next: "batchFormDrawer.open",
    });

    try {
      const opened = batchFormDrawer.open(batch);
      if (!opened) throw new Error("Batch drawer did not report a successful open.");
      flowDebugSuccess(isEdit ? "Edit Batch drawer request completed" : "Create Batch drawer request completed", {
        batchId: batch?.id ?? null,
      });
    } catch (error) {
      flowDebugError("Could not open the batch form drawer", error, { batch });
      modals.error("Batch Form Error", "The batch form could not be opened. Check the flow debugger for details.");
    }
  };

  document.getElementById("btn-create-batch")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openBatchForm(event.currentTarget);
  });

  batchCardsWrap?.addEventListener("click", (event) => {
    const editTrigger = event.target instanceof Element
      ? event.target.closest(".btn-edit-batch")
      : null;
    if (editTrigger && batchCardsWrap.contains(editTrigger)) {
      event.preventDefault();
      event.stopPropagation();
      openBatchForm(editTrigger);
      return;
    }

    const card = event.target.closest?.(".batch-card");
    if (!card || !batchCardsWrap.contains(card)) return;
    selectedBatchId = card.dataset.batchId;
    batchSortPanel?.setActive?.(selectedBatchId);
    currentPage = 1;
    _setUrlParam("batch", selectedBatchId);
    renderPaginatedTable();
  });

  // ── NEW / SPES BABY status switch ────────────────────────────
  const statusSwitch = document.getElementById("status-mode-switch");
  const statusButtons = [...document.querySelectorAll("[data-status-mode]")];

  function syncStatusButtons() {
    statusButtons.forEach((button) => {
      const isActive = button.dataset.statusMode === activeStatusMode;
      button.setAttribute("aria-pressed", String(isActive));
      button.classList.toggle("bg-emerald-500", isActive && activeStatusMode === "NEW");
      button.classList.toggle("bg-red-400", isActive && activeStatusMode === "SPES BABY");
      button.classList.toggle("bg-white/10", !isActive);
      button.classList.toggle("text-white", isActive);
      button.classList.toggle("text-white/70", !isActive);
    });
  }

  async function selectStatusMode(mode) {
    activeStatusMode = mode === "SPES BABY" ? "SPES BABY" : "NEW";
    syncStatusButtons();

    // Admins land on the implementors list. Selecting a beneficiary status
    // there opens the overall roster so the control always has an immediate,
    // visible filtering result.
    if (isDirectoryViewer && viewMode === "implementors") {
      await switchToBeneficiariesView("ALL SPES", "ALL", "ALL", null);
      return;
    }

    sortFilterInstance?.setFilter("return_status", activeStatusMode);
    if (viewMode === "beneficiaries" && selectedBatchId === null) renderBatchCards();
  }

  statusButtons.forEach((button) => {
    button.addEventListener("click", () => selectStatusMode(button.dataset.statusMode));
  });

  function _showStatusSwitch(show) {
    if (!statusSwitch) return;
    statusSwitch.classList.toggle("hidden", !show);
    statusSwitch.classList.toggle("inline-flex", show);
    syncStatusButtons();
    if (show && viewMode === "beneficiaries") {
      sortFilterInstance?.setFilter("return_status", activeStatusMode);
    }
  }


  // ── View Switching helpers ───────────────────────────────────
  function normalizeOfficeName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\(lgu\)/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function isIliganLguOffice(item) {
    if (!item) return false;
    const name = typeof item === "string" ? item : (item.office || item.offices?.name || "");
    const officeId = Number(item.office_id || item.offices?.id);
    if (officeId === 1) return true;
    const normalized = normalizeOfficeName(name);
    return (
      normalized === "iligan city" ||
      normalized === "iligan" ||
      normalized === "lgu iligan" ||
      normalized.includes("iligan city") ||
      normalized.includes("city government of iligan")
    );
  }

  function pinSystemAdministratorFirst(items) {
    const ordered = [...items];
    const pinned = [];
    const pinnedIds = new Set();
    const takeFirst = (predicate) => {
      const match = ordered.find((item) => !pinnedIds.has(String(item.id)) && predicate(item));
      if (match) {
        pinned.push(match);
        pinnedIds.add(String(match.id));
      }
    };

    // 1. Administrator first
    takeFirst((item) =>
      String(item.full_name || "").trim().toLowerCase() === "system administrator" ||
      String(item.username || "").trim().toLowerCase() === "admin" ||
      String(item.role || "").toLowerCase().includes("admin")
    );
    // 2. ILIGAN CITY second (below Administrator)
    takeFirst((item) => isIliganLguOffice(item));

    return [
      ...pinned,
      ...ordered.filter((item) => !pinnedIds.has(String(item.id))),
    ];
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

  async function switchToBeneficiariesView(officeName, officeLocation, officeId, staffId, initialBatchId = null) {
    if (!isDirectoryViewer) return;
    beneficiaryBulkTransferTools.clear();
    viewMode = "beneficiaries";
    currentOfficeLocation = officeLocation;
    currentOfficeId = officeId;
    currentStaffIdView = staffId;
    currentOfficeName = officeName;
    selectedBatchId = initialBatchId == null ? null : String(initialBatchId);
    batchSortPanel?.setActive?.(selectedBatchId);

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

    // Keep Add Beneficiary hidden on the BATCHES overview; it appears inside a literal batch.
    const addBtn = document.getElementById("btn-add-beneficiary");
    const createBatchBtn = document.getElementById("btn-create-batch");


      if (addBtn) {
      addBtn.classList.remove("inline-flex");
      addBtn.classList.add("hidden");
    }
    if (createBatchBtn) {
      if (canManageCurrentOffice()) {
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
    if (currentOfficeId === "ALL") {
      await refreshGlobalSpesSummary(filteredData);
    } else {
      renderOverallSpesSummary(filteredData);
    }
    currentPage = preferenceStorage.getPaginationPage(getPaginationStorageKey()) || 1;

    updateDynamicFilterDropdown(filteredData);

    const targetB = _getUrlParam("b");
    if (targetB) {
      const idx = filteredData.findIndex(item => String(item.id) === String(targetB));
      if (idx !== -1) {
        currentPage = Math.floor(idx / rowsPerPage) + 1;
      }
    }

    batchSortPanel?.show();
    setupSortFilter(filteredData);

    // Keep the status selector available for specific and overall rosters.
    _showStatusSwitch(true);
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

    const renderEduFilterSection = () => {
      const categories = [
        { name: "Senior Highschool", sub: ["Grade 11", "Grade 12"] },
        { name: "Highschool", sub: ["Grade 7", "Grade 8", "Grade 9", "Grade 10"] },
        { name: "College Level", sub: ["1st Year", "2nd Year", "3rd Year", "4th Year"] },
        { name: "College Graduate", sub: [] },
        { name: "OSY", sub: [] },
      ];

      let h = `
        <details class="group mb-1">
          <summary class="flex justify-between items-center cursor-pointer rounded-md p-2 hover:bg-spes-blue/10 dark:hover:bg-white/5 transition-colors">
            <span class="text-[0.5625rem] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow">Education Level</span>
            <svg class="h-3 w-3 text-spes-blue/50 dark:text-spes-yellow/50 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div class="pl-3 mt-1 flex flex-col space-y-1 mb-2">
            <button data-filter-key="education_name" data-filter-val="all" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left text-spes-blue font-bold">All Education</button>
      `;

      categories.forEach(cat => {
        const hasSub = cat.sub.length > 0;
        if (!hasSub) {
          h += `<button data-filter-key="education_name" data-filter-val="${cat.name.toLowerCase()}" class="cursor-pointer flex w-full items-center rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left uppercase text-xs font-bold">${cat.name}</button>`;
        } else {
          h += `
            <details class="group/sub">
              <summary class="flex items-center justify-between cursor-pointer rounded-md p-1.5 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 transition-colors">
                <button type="button" data-filter-key="education_name" data-filter-val="${cat.name.toLowerCase()}" class="cursor-pointer flex-1 text-left uppercase text-xs font-bold">${cat.name}</button>
                <svg class="h-3.5 w-3.5 text-spes-blue/40 dark:text-spes-yellow/40 transition-transform group-open/sub:rotate-180 p-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 9l-7 7-7-7" />
                </svg>
              </summary>
              <div class="pl-3.5 mt-0.5 flex flex-col space-y-0.5 border-l-2 border-spes-blue/15 dark:border-spes-yellow/20 ml-2 py-0.5">
          `;
          cat.sub.forEach(sVal => {
            h += `<button data-filter-key="education_name" data-filter-val="${sVal.toLowerCase()}" class="cursor-pointer flex w-full items-center rounded-md p-1 hover:bg-spes-blue/8 hover:text-spes-blue dark:hover:bg-white/8 text-left uppercase text-[0.6875rem] text-spes-black/70 dark:text-spes-white/70 font-semibold">• ${sVal}</button>`;
          });
          h += `</div></details>`;
        }
      });

      h += `</div></details>`;
      return h;
    };

    html += renderBtns("period", "Period", "All Periods", sortedPeriods);
    html += renderEduFilterSection();
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
    if (!isDirectoryViewer) return;
    beneficiaryBulkTransferTools.clear();
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

    // Status filters apply only after opening a beneficiary roster.
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
    const activeStaffs = pinSystemAdministratorFirst(staffs.filter(s => !s.archive_at));

    allImplementors = activeStaffs;
    currentPage = preferenceStorage.getPaginationPage(getPaginationStorageKey()) || 1;

    const targetId = _getUrlParam("id");
    if (targetId) {
      const idx = activeStaffs.findIndex(item => String(item.id) === String(targetId));
      if (idx !== -1) {
        currentPage = Math.floor(idx / rowsPerPage) + 1;
      }
    }
    setupSortFilter(activeStaffs);
    await refreshGlobalSpesSummary();
  }

  // Drawer DOM
  const drawer = document.getElementById("drawer-beneficiary-details");
  const content = document.getElementById("drawer-beneficiary-content");
  const closeBtn = document.getElementById("btn-close-beneficiary-drawer");
  const addBtn = document.getElementById("btn-add-beneficiary");

  // ── Drawer ──────────────────────────────────────────────────
  const getVisibleBeneficiaries = () => {
    if (selectedBatchId === null) return activeBeneficiaries;
    if (selectedBatchId === "unassigned") {
      return activeBeneficiaries.filter((item) => item.batch_id == null && item.batch?.id == null);
    }
    return activeBeneficiaries.filter(
      (item) => String(item.batch_id ?? item.batch?.id) === String(selectedBatchId)
    );
  };

  const openDrawer = (b, index) => {
    if (!drawer || !content) return;
    const drawerList = getVisibleBeneficiaries();
    const resolvedIndex = drawerList.findIndex((item) => String(item.id) === String(b.id));
    index = resolvedIndex >= 0 ? resolvedIndex : Math.max(0, index);

    // Persist drawer state to URL — short key "b" for beneficiary id
    _setUrlParam("b", b.id);

    const targetRow = document.querySelector(`tr[data-bene-id="${b.id}"]`);
    if (targetRow) {
      document.querySelectorAll("tr[data-bene-id]").forEach(r => r.classList.remove("border-l-4", "border-spes-blue", "dark:border-spes-yellow", "animate-pulse", "bg-spes-blue/10", "dark:bg-spes-yellow/10"));
      targetRow.classList.add("bg-spes-blue/10", "dark:bg-spes-yellow/10", "border-l-4", "border-spes-blue", "dark:border-spes-yellow", "animate-pulse");
    }

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
          <button id="btn-drawer-next" ${index === drawerList.length - 1 ? 'disabled' : ''} class="${index === drawerList.length - 1 ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-spes-blue/90'} inline-flex items-center gap-1 rounded-md bg-spes-blue px-3 py-1.5 text-[0.625rem] font-black uppercase tracking-wider text-white shadow-md transition-all">
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
        ${isDirectoryViewer ? `
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
          ${b.batch?.id != null
            ? `<span class="inline-flex items-center gap-1 bg-spes-blue/10 px-2.5 py-1 text-[0.625rem] font-black uppercase tracking-wide text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow">${escHtml(b.batch.batch_name ? b.batch.batch_name.toUpperCase() : `BATCH ${b.batch.id}`)}</span>`
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
            ${formatEducationDisplay(b)}
          </span>
        </div>
      </div>
    `;

    // Prev / Next within drawer
    document.getElementById("btn-drawer-prev")?.addEventListener("click", () => {
      if (index > 0) openDrawer(drawerList[index - 1], index - 1);
    });
    document.getElementById("btn-drawer-next")?.addEventListener("click", () => {
      if (index < drawerList.length - 1) openDrawer(drawerList[index + 1], index + 1);
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
    document.querySelectorAll("tr[data-bene-id]").forEach(r => r.classList.remove("border-l-4", "border-spes-blue", "dark:border-spes-yellow", "animate-pulse", "bg-spes-blue/10", "dark:bg-spes-yellow/10"));
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
    const visibleRows = viewMode === "implementors" ? activeImplementors : getVisibleBeneficiaries();
    renderPageSizeSelector(visibleRows.length, () => renderPaginatedTable());

    const totalPages = Math.max(1, Math.ceil(visibleRows.length / rowsPerPage));
    currentPage = Math.min(totalPages, Math.max(1, currentPage));
    preferenceStorage.savePaginationPage(getPaginationStorageKey(), currentPage);
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;

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
        const canManageRoster = getBranchBulkBeneficiaries().length > 0;
        headerRow.innerHTML = `
          <th scope="col" class="p-4 text-center w-4">
            <div class="flex items-center justify-center gap-1.5">
              ${canManageRoster ? `<input id="spes-checkbox-all" type="checkbox"
                class="h-4 w-4 cursor-pointer rounded-full border-spes-blue/25 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/25 dark:bg-spes-dark-secondary dark:text-spes-yellow"
                title="Select all active beneficiaries in this branch">
              ` : `<span class="text-[0.5625rem] font-black uppercase text-spes-black/35 dark:text-white/35">View</span>`}
            </div>
          </th>
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Name of Assured</th>
          ${showOfficeCol ? `<th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Office</th>` : ""}
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap" aria-sort="${beneficiarySortMode === "phone" ? "ascending" : "none"}">${beneficiarySortMode === "phone" ? `<span class="font-black text-spes-blue underline decoration-spes-blue decoration-2 underline-offset-4 dark:text-spes-yellow dark:decoration-spes-yellow">Phone Number</span>` : "Address"}</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Year Level</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Gender</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Actions</th>
        `;
        if (controlsContainer) controlsContainer.classList.remove("hidden");
        // Wire up check-all listener
        if (canManageRoster) wireBeneficiarySelectAll();
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
          ? `<span class="inline-flex items-center border border-spes-blue/15 bg-spes-blue/10 px-2.5 py-1 text-[0.625rem] font-black uppercase text-spes-blue dark:border-spes-yellow/20 dark:bg-spes-yellow/10 dark:text-spes-yellow" title="${escHtml(s.office)}">${escHtml(formatOfficeShort(s.office))}</span>`
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
            <td class="px-6 py-4 text-left font-bold text-spes-black/70 dark:text-spes-white/70">${escHtml(s.address || s.office_location || "N/A")}</td>
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
        } else if (isDirectoryViewer) {
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
        const matchBatch = activeBeneficiaries.find(b => String(b.batch_id ?? b.batch?.id) === String(selectedBatchId))?.batch;
        const archiveBatchLabel = matchBatch ? `BATCH ${matchBatch.id}` : selectedBatchId === null ? "ALL BATCHES" : selectedBatchId === "unassigned" ? "UNASSIGNED" : "BATCH LIST";
        if (archiveStatusMode === "archived") {
          tableTitle.textContent = `ARCHIVE LISTS - ${archiveBatchLabel} OF ${offName.toUpperCase()}`;
        } else if (selectedBatchId === null) {
          tableTitle.textContent = `BATCHES - ${offName.toUpperCase()}`;
        } else if (selectedBatchId === "unassigned") {
          tableTitle.textContent = `UNASSIGNED - ${offName.toUpperCase()}`;
        } else {
          const batchLabel = matchBatch ? (matchBatch.batch_name ? matchBatch.batch_name.toUpperCase() : archiveBatchLabel) : "BATCH LIST";
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
          if (canManageCurrentOffice()) {
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
        // In batch cards overview, keep the search bar visible so users can search across batches
        document.getElementById("staff-search-wrap")?.classList.remove("hidden");
        document.getElementById("sortfilter-wrap")?.classList.add("hidden");
        document.getElementById("beneficiary-bulk-tools")?.classList.add("hidden");

        if (tableWrap) tableWrap.classList.add("hidden");
        if (paginationControls) paginationControls.classList.add("hidden");
        if (kanbanWrap) {
          kanbanWrap.classList.remove("hidden");
        }
        renderBatchCards();
      } else {
        // Show Filtered Beneficiaries Table


  if (addBtn) {
          addBtn.classList.toggle("hidden", !canManageCurrentOffice());
          addBtn.classList.toggle("inline-flex", canManageCurrentOffice());
        }
        if (createBatchBtn) {
          createBatchBtn.classList.add("hidden");
          createBatchBtn.classList.remove("inline-flex");
        }
        if (sortBatchPanel) {
          sortBatchPanel.classList.add("hidden");
          sortBatchPanel.classList.remove("flex");
        }
        // Inside a batch table, restore search bar and filter tools
        document.getElementById("staff-search-wrap")?.classList.remove("hidden");
        document.getElementById("sortfilter-wrap")?.classList.remove("hidden");

        if (kanbanWrap) kanbanWrap.classList.add("hidden");
        document.getElementById("global-spes-total-summary")?.classList.add("hidden");
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
          const isArchivedRow = Boolean(b.archived_at);

          const canManageRow = canManageBeneficiary(b);
          const checkboxTd = canManageRow ? `
            <td class="p-4 text-center">
              <div class="flex items-center justify-center">
                <input type="checkbox" data-bene-id="${b.id}" ${selectedBeneficiaryIds.has(String(b.id)) ? "checked" : ""} class="beneficiary-row-checkbox h-4 w-4 cursor-pointer rounded-full border-spes-blue/25 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/25 dark:bg-spes-dark-secondary dark:text-spes-yellow">
              </div>
            </td>
          ` : `<td class="p-4 text-center"><span class="text-[0.5625rem] font-black uppercase text-spes-black/30 dark:text-white/30">View</span></td>`;

          const statusBadge = isBaby
            ? `<span class="ml-2 inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[0.5625rem] font-black uppercase text-red-600 dark:bg-red-500/20 dark:text-red-400">SPES Baby</span>`
            : `<span class="ml-2 inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-0.5 text-[0.5625rem] font-black uppercase text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">New</span>`;

          const searchQ = (document.getElementById('staff-search-input')?.value || "").trim().toLowerCase();
          const hasMatchedPhone = searchQ && b.contact_number && String(b.contact_number).toLowerCase().includes(searchQ);

          const contactTooltip = hasMatchedPhone
            ? `<span class="ml-2 inline-flex items-center gap-1 rounded bg-spes-blue/10 dark:bg-spes-yellow/10 px-2 py-0.5 text-[0.625rem] font-black uppercase text-spes-blue dark:text-spes-yellow border border-spes-blue/20 dark:border-spes-yellow/20">
                 <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                 ${escHtml(b.contact_number)}
               </span>`
            : "";

          const actionsTd = canManageRow ? `
            <td class="px-6 py-4 text-center whitespace-nowrap">
              <div class="inline-flex items-center gap-1">
                <button class="btn-edit-bene cursor-pointer p-1 text-spes-blue hover:text-spes-blue/80 dark:text-spes-yellow dark:hover:text-spes-yellow/80" title="Edit">
                  <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                </button>
                <button class="btn-archive-bene cursor-pointer rounded-md p-1 transition-colors ${isArchivedRow ? "text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-300" : "text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:bg-red-400/10 dark:hover:text-red-300"}" title="${isArchivedRow ? "Restore Archive" : "Archive"}" aria-label="${isArchivedRow ? "Restore Archive" : "Archive"}">
                  ${isArchivedRow
                    ? '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 lucide lucide-archive-restore-icon lucide-archive-restore"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h2"/><path d="M20 8v11a2 2 0 0 1-2 2h-2"/><path d="m9 15 3-3 3 3"/><path d="M12 12v9"/></svg>'
                    : '<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1 1v3M4 7h16"/></svg>'}
                </button>
              </div>
            </td>
          ` : `
            <td class="px-6 py-4 text-center whitespace-nowrap">
              <span class="text-[0.5625rem] font-black uppercase tracking-wider text-spes-black/35 dark:text-white/35">Read only</span>
            </td>
          `;

          const isTarget = new URLSearchParams(window.location.search).get("b") === String(b.id);
          const rowBg = isTarget
            ? "bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse cursor-pointer"
            : "bg-white dark:bg-spes-dark-primary hover:bg-spes-blue/5 dark:hover:bg-spes-yellow/5 transition-all duration-200 cursor-pointer";

          return `
            <tr title="Click for Details" class="border-b border-gray-100 dark:border-white/5 ${rowBg}" data-bene-id="${b.id}">
              ${checkboxTd}
              <td class="px-6 py-4 text-left font-extrabold text-spes-black dark:text-spes-white whitespace-nowrap">
                <span class="btn-open-drawer cursor-pointer hover:underline hover:text-spes-blue dark:hover:text-spes-yellow">${escHtml(b.full_name?.toUpperCase() || "—")}</span>
                ${statusBadge}
                ${contactTooltip}
              </td>
              <td class="px-6 py-4 text-left tabular-nums text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${escHtml(beneficiarySortMode === "phone" ? (b.contact_number || "N/A") : (b.address || "N/A"))}</td>
              <td class="px-6 py-4 text-center whitespace-nowrap">
                <span class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[0.625rem] font-black uppercase text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                  <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
                  ${formatEducationDisplay(b)}
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
            if (bData.archived_at) {
              confirmRestore(bData.id, bData.full_name);
            } else {
              confirmArchive(bData.id, bData.full_name);
            }
          });
        });
        beneficiaryBulkTransferTools.sync();

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
    kanbanWrap.innerHTML = "";
    kanbanWrap.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-4 pb-2 select-none items-start";

    // Fetch batches to know the columns
    const { data: batchesData } = await fetchBatches({ forceRefresh: false });
    const batches = batchesData || [];

    // Group active beneficiaries
    const grouped = { unassigned: [] };
    batches.forEach(b => { grouped[b.id] = []; });

    allBeneficiaries.forEach(bene => {
      const bid = bene.batch_id ?? bene.batch?.id;
      if (bid && grouped[bid]) {
        grouped[bid].push(bene);
      } else {
        grouped["unassigned"].push(bene);
      }
    });

    const BATCH_PALETTES = [
    { bg: "bg-rose-100 dark:bg-rose-900/80",       text: "text-rose-900 dark:text-rose-100",       border: "border-rose-300 dark:border-rose-500/70" },
    { bg: "bg-sky-100 dark:bg-sky-900/80",         text: "text-sky-900 dark:text-sky-100",         border: "border-sky-300 dark:border-sky-500/70" },
    { bg: "bg-emerald-100 dark:bg-emerald-900/80", text: "text-emerald-900 dark:text-emerald-100", border: "border-emerald-300 dark:border-emerald-500/70" },
    { bg: "bg-amber-100 dark:bg-amber-900/80",     text: "text-amber-900 dark:text-amber-100",     border: "border-amber-300 dark:border-amber-500/70" },
    { bg: "bg-fuchsia-100 dark:bg-fuchsia-900/80", text: "text-fuchsia-900 dark:text-fuchsia-100", border: "border-fuchsia-300 dark:border-fuchsia-500/70" },
    { bg: "bg-violet-100 dark:bg-violet-900/80",   text: "text-violet-900 dark:text-violet-100",   border: "border-violet-300 dark:border-violet-500/70" },
    { bg: "bg-cyan-100 dark:bg-cyan-900/80",       text: "text-cyan-900 dark:text-cyan-100",       border: "border-cyan-300 dark:border-cyan-500/70" },
    { bg: "bg-orange-100 dark:bg-orange-900/80",   text: "text-orange-900 dark:text-orange-100",   border: "border-orange-300 dark:border-orange-500/70" },
  ];

    const getBatchCapacity = (batchId) => [1, 2, 3].includes(Number(batchId)) ? 2000 : 350;

    const searchQ = (document.getElementById("staff-search-input")?.value || "").trim().toLowerCase();

    const createCard = (title, items, colId, pal, isUnassigned = false, batchId = "", batchName = "") => {
      const capacityTarget = getBatchCapacity(batchId);
      const totalCount = items.length;
      const newCount = items.filter(item =>
        String(item.return_status || "").trim().toUpperCase() === "NEW"
      ).length;
      const spesBabyCount = items.filter(item =>
        String(item.return_status || "").trim().toUpperCase() === "SPES BABY"
      ).length;
      const percentage = Math.min(100, Math.round((totalCount / capacityTarget) * 100));
      let progColor = "bg-emerald-500";
      if (percentage > 33 && percentage <= 66) progColor = "bg-orange-500";
      if (percentage > 66) progColor = "bg-red-500";

      // Live search matches in this batch
      let matchCount = 0;
      if (searchQ) {
        matchCount = items.filter(item => {
          const name = String(item.full_name || "").toLowerCase();
          const phone = String(item.contact_number || "").toLowerCase();
          const addr = String(item.address || "").toLowerCase();
          const desig = String(item.designated || "").toLowerCase();
          return name.includes(searchQ) || phone.includes(searchQ) || addr.includes(searchQ) || desig.includes(searchQ);
        }).length;
      }

      const matchBadge = searchQ && matchCount > 0
        ? `<span class="inline-flex items-center gap-1 rounded-full bg-amber-500 text-slate-950 px-2 py-0.5 text-[0.625rem] font-black uppercase tracking-wider shadow-sm animate-pulse">
             🔥 ${matchCount} match${matchCount > 1 ? "es" : ""}
           </span>`
        : "";

      const cardHighlightClass = searchQ 
        ? (matchCount > 0 
            ? "ring-2 ring-amber-500 shadow-xl scale-[1.01]" 
            : "opacity-40 grayscale hover:opacity-100 hover:grayscale-0 transition-opacity") 
        : "";

      const newStatClass = activeStatusMode === "NEW"
        ? "border-2 border-emerald-600/70 bg-emerald-500/25 ring-2 ring-emerald-500/25 shadow-md"
        : "border border-emerald-500/15 bg-emerald-500/10 shadow-sm";
      const spesBabyStatClass = activeStatusMode === "SPES BABY"
        ? "border-2 border-blue-600/70 bg-blue-500/25 ring-2 ring-blue-500/25 shadow-md"
        : "border border-blue-500/15 bg-blue-500/10 shadow-sm";

      return `
        <div class="batch-card cursor-pointer group flex flex-col justify-between p-5 rounded-xl border border-spes-blue/15 dark:border-white/10 bg-white dark:bg-spes-dark-primary shadow-sm hover:shadow-md hover:border-spes-blue/30 dark:hover:border-spes-yellow/30 active:scale-[0.99] transition-all duration-200 min-h-[170px] ${cardHighlightClass}" data-batch-id="${colId}">
          <div class="flex flex-col justify-between h-full w-full">
            <div class="flex items-start justify-between">
              <div class="space-y-1.5">
                <div class="flex items-center gap-2">
                  <span class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-black uppercase tracking-wider ${pal.bg} ${pal.text} border ${pal.border}">${title}</span>
                  ${matchBadge}
                </div>
                <p class="text-xs font-bold text-spes-black/50 dark:text-white/40 uppercase tracking-widest">${totalCount.toLocaleString()} of ${capacityTarget.toLocaleString()} beneficiaries</p>
              </div>
            ${canManageCurrentOffice() ? `<button type="button" class="btn-edit-batch relative z-20 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-spes-blue/10 bg-spes-blue/5 shadow-none transition-all hover:scale-105 hover:bg-spes-blue/10 active:scale-95 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 pointer-events-auto"
              data-batch-id="${escHtml(String(colId))}" data-batch-name="${escHtml(String(batchName || ""))}"
              aria-label="Edit ${escHtml(title)}" title="Edit Batch">
              <svg class="pointer-events-none h-4 w-4 text-spes-blue dark:text-spes-yellow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>` : `<span class="text-[0.5625rem] font-black uppercase tracking-wider text-spes-black/30 dark:text-white/30">Read only</span>`}
          </div>
          <div class="mt-4 grid grid-cols-3 gap-2" aria-label="${totalCount} total beneficiaries: ${newCount} new and ${spesBabyCount} SPES Baby">
            <div class="rounded-lg border border-spes-blue/10 bg-spes-blue/5 dark:border-white/10 dark:bg-white/5 px-2 py-2 text-center shadow-none">
              <div class="text-sm font-black text-spes-black dark:text-white">${totalCount}</div>
              <div class="mt-0.5 text-[0.5rem] font-black uppercase tracking-wider text-spes-black/45 dark:text-white/45">Total</div>
            </div>
            <div class="rounded-lg px-2 py-2 text-center transition-all ${newStatClass}" aria-current="${activeStatusMode === "NEW" ? "true" : "false"}">
              <div class="text-sm font-black text-emerald-700 dark:text-emerald-400">${newCount}</div>
              <div class="mt-0.5 text-[0.5rem] font-black uppercase tracking-wider text-emerald-700/70 dark:text-emerald-400/70">New</div>
            </div>
            <div class="rounded-lg px-2 py-2 text-center transition-all ${spesBabyStatClass}" aria-current="${activeStatusMode === "SPES BABY" ? "true" : "false"}">
              <div class="text-sm font-black text-blue-700 dark:text-blue-300">${spesBabyCount}</div>
              <div class="mt-0.5 text-[0.5rem] font-black uppercase tracking-wider text-blue-700/70 dark:text-blue-300/70">SPES Baby</div>
            </div>
          </div>
          <div class="space-y-1.5 mt-3.5">
            <div class="w-full bg-spes-blue/10 dark:bg-white/10 rounded-full h-2 overflow-hidden">
              <div class="${progColor} h-2 rounded-full transition-all duration-500" style="width: ${percentage}%"></div>
            </div>
            <div class="flex justify-between items-center text-[0.625rem] font-black uppercase tracking-wider text-spes-black/60 dark:text-white/50">
              <span>Batch capacity</span>
              <span>${percentage}% of ${capacityTarget.toLocaleString()}</span>
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
      const title = b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.id}`;
      cardsHtml += createCard(title, grouped[b.id] || [], b.id, pal, false, b.id, b.batch_name);
    });

    kanbanWrap.innerHTML = cardsHtml;

    // Card click → enter specific batch table
    kanbanWrap.querySelectorAll(".batch-card").forEach(card => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".btn-edit-batch")) return;
        const colId = card.getAttribute("data-batch-id");
        selectedBatchId = colId;
        _setUrlParam("batch", selectedBatchId);
        batchSortPanel?.setActive?.(selectedBatchId);
        currentPage = 1;
        renderPaginatedTable();
      });
    });

    if (currentOfficeId === "ALL" && globalImplementorMetric == null) {
      await refreshGlobalSpesSummary(allBeneficiaries);
    } else {
      renderOverallSpesSummary(allBeneficiaries, {
        isGlobal: currentOfficeId === "ALL",
        implementorCount: currentOfficeId === "ALL" ? globalImplementorMetric : null,
      });
    }

  }

  // --- START: BENEFICIARIES DYNAMIC PAGE SIZE FORMULA ---
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

  const targetVal = String(rowsPerPage >= count && options.includes(count) ? count : (options.includes(rowsPerPage) ? rowsPerPage : (options[0] || 10)));
  select.value = targetVal;

  const handlePageSizeChange = (e) => {
    const val = Number(e.target.value);
    rowsPerPage = val > 0 ? val : (count || 10);
    currentPage = 1;
    if (typeof onChangeCallback === "function") onChangeCallback();
  };

  select.onchange = handlePageSizeChange;
  select.oninput = handlePageSizeChange;
}
// --- END: BENEFICIARIES DYNAMIC PAGE SIZE FORMULA ---

  // ── Pagination Indicators (Left: 1 & 2, Middle: Input, Right: Last Page) ───
  function updatePageIndicators(totalCount) {
    const indicatorsEl = document.getElementById("page-indicators-container");
    if (!indicatorsEl) return;
    const totalPages = Math.max(1, Math.ceil(totalCount / rowsPerPage));
    currentPage = Math.min(totalPages, Math.max(1, currentPage));
    preferenceStorage.savePaginationPage(getPaginationStorageKey(), currentPage);

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
        html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${active}" data-page="${p}">${p}</button></li>`;
      }
    } else {
      // Left: Page 1
      const p1Active = currentPage === 1
        ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
        : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
      html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${p1Active}" data-page="1">1</button></li>`;

      // Page 2
      const p2Active = currentPage === 2
        ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
        : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
      html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${p2Active}" data-page="2">2</button></li>`;

      // Middle: Input
      const isMidActive = currentPage > 2 && currentPage < totalPages;
      const midActiveClass = isMidActive
        ? "border-spes-blue ring-2 ring-spes-blue/50 dark:border-spes-yellow dark:ring-spes-yellow/50 bg-spes-blue/5 dark:bg-spes-yellow/5"
        : "border-gray-200 bg-white dark:border-white/10 dark:bg-spes-dark-secondary";

      html += `<li class="flex items-center border ${midActiveClass} transition-all">
        <input type="number" min="1" max="${totalPages}" value="${isMidActive ? currentPage : ""}" placeholder="..."
               class="w-14 bg-transparent px-1.5 py-1.5 text-center text-xs sm:text-sm font-black text-spes-blue outline-none dark:text-spes-yellow [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
               style="-moz-appearance: textfield;" title="Type page number (1-${totalPages}) and press Enter" />
      </li>`;

      // Right: Last Page (totalPages)
      const pLastActive = currentPage === totalPages
        ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
        : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-secondary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";
      html += `<li><button type="button" class="page-btn cursor-pointer border border-gray-200 dark:border-white/10 px-3 py-2 text-sm font-medium transition-colors ${pLastActive}" data-page="${totalPages}">${totalPages}</button></li>`;
    }

    indicatorsEl.innerHTML = html;
    indicatorsEl.querySelectorAll(".page-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        currentPage = parseInt(e.currentTarget.getAttribute("data-page"), 10);
        renderPaginatedTable();
      });
    });

    const input = indicatorsEl.querySelector("input");
    if (input) {
      const jump = () => {
        const rawVal = input.value.trim();
        if (!rawVal) return;
        let val = parseInt(rawVal, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > totalPages) val = totalPages;
        currentPage = val;
        preferenceStorage.savePaginationPage(getPaginationStorageKey(), currentPage);
        renderPaginatedTable();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          jump();
        }
      });
      input.addEventListener("blur", () => {
        if (input.value && input.value !== String(currentPage)) {
          jump();
        }
      });
    }
  }

  // ── Pagination controls ──────────────────────────────────────
  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderPaginatedTable();
    }
  });
  document.getElementById("next-page")?.addEventListener("click", () => {
    const listLength = viewMode === "implementors" ? activeImplementors.length : getVisibleBeneficiaries().length;
    const total = Math.max(1, Math.ceil(listLength / rowsPerPage));
    if (currentPage < total) {
      currentPage++;
      renderPaginatedTable();
    }
  });

  // ── Select all ───────────────────────────────────────────────
  // --- START: BENEFICIARY SELECT-ALL FUNCTION ---
  function wireBeneficiarySelectAll() {
    const selectAll = document.getElementById("spes-checkbox-all");
    const setPageSelection = (shouldSelect) => {
      document.querySelectorAll(".beneficiary-row-checkbox").forEach((checkbox) => {
        const id = String(checkbox.dataset.beneId);
        if (shouldSelect) selectedBeneficiaryIds.add(id);
        else selectedBeneficiaryIds.delete(id);
      });
      beneficiaryBulkTransferTools.sync();
    };
    if (selectAll && selectAll.dataset.bulkSelectionWired !== "true") {
      selectAll.dataset.bulkSelectionWired = "true";
      selectAll.addEventListener("change", () => setPageSelection(selectAll.checked));
    }


  }
  wireBeneficiarySelectAll();
  // --- END: BENEFICIARY SELECT-ALL FUNCTION ---

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
        getDefaultFilters: () => viewMode === "beneficiaries"
          ? { status: "active", return_status: activeStatusMode }
         : {},
        onSortChange: (sortValue) => {
          beneficiarySortMode = sortValue;
        },
        onFilterChange: (key, value) => {
          if (key === "status") {
            archiveStatusMode = value === "archived" ? "archived" : "active";
            beneficiaryBulkTransferTools.sync();
          }
        },
        onRender: (filtered) => {
          if (viewMode === "implementors") {
            activeImplementors = pinSystemAdministratorFirst(filtered);
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
    if (isDirectoryViewer && viewMode === "implementors") {
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
    } else if (isDirectoryViewer && currentOfficeId && currentOfficeId !== "ALL") {
      filteredData = data.filter(b => b.staffs?.office_id == currentOfficeId);
    }

    allBeneficiaries = filteredData;
    renderOverallSpesSummary(filteredData);
    // Show controls container
    document.getElementById("table-controls-container")?.classList.remove("hidden");

    setupSortFilter(filteredData);

    // Officers see their own office roster directly — show the status switch for them.
    // Admin lands on the implementors list first (handled in the view switchers).
    if (!isDirectoryViewer) _showStatusSwitch(true);
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
    if (bdfError) {
      bdfError.textContent = "";
      bdfError.classList.add("hidden");
    }
    modals.flowbiteToast("Whoops! Something went wrong", msg, "danger");
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
    batchFormDrawer.close({ immediate: true });
    _bdfEditId = defaults?.id ?? null;
    _bdfHideError();
    _bdfSetLoading(false);
    if (bdfForm) bdfForm.reset();

    if (defaults) {
      await _patchedBdfFill(defaults, true);
    } else {
      await _patchedBdfFill({ year_period: new Date().getFullYear() });
    }

    const addressInput = document.getElementById("bdf-address");
    if (addressInput) {
      addressInput.removeAttribute("readonly");
      addressInput.classList.remove("bg-gray-100", "dark:bg-white/5", "pointer-events-none");
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
        const label = b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.id}`;
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

    const targetId = result.data?.id || _bdfEditId;
    if (targetId) {
      let levelText = document.getElementById("edulevel-selected-text")?.textContent?.trim() || values.edulevel;
      if (levelText && !isNaN(parseInt(levelText, 10))) {
        const match = DEFAULT_EDU_LEVELS.find(l => String(l.id) === String(levelText));
        if (match) levelText = match.name;
      }
      if (levelText && !levelText.includes("Select Level")) {
        preferenceStorage.saveBeneficiaryEduLevel(targetId, levelText);
      }
    }

    closeBdfDrawer();
    modals.flowbiteToast(
      _bdfEditId ? "Beneficiary updated" : "Beneficiary added",
      _bdfEditId ? `${values.full_name}'s record has been updated.` : `${values.full_name} has been added to the directory.`,
      "success"
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




// --- START: BENEFICIARY RESTORE CONFIRMATION ---
  async function confirmRestore(id, name) {
    const result = await modals.confirm(
      "Restore Archive",
      "Restore " + String(name || "").toUpperCase() + " to the active roster?",
      "Restore",
      "Cancel"
    );
    if (!result.isConfirmed) return;

    modals.loading("Restoring...", "Please wait...");
    const res = await restoreBeneficiary(id);
    modals.close();

    if (res.success) {
      await modals.success("Restored", String(name || "") + " has been restored to the active roster.");
      await loadData(true);
    } else {
      modals.error("Error", res.error);
    }
  }
// --- END: BENEFICIARY RESTORE CONFIRMATION ---
  if (addBtn) {
    addBtn.addEventListener("click", showAddModal);
  }

  // ── Wire Create Batch button ──────────────────────────────────
  document.getElementById("btn-back-to-implementors")?.addEventListener("click", () => {
    if (viewMode === "beneficiaries" && selectedBatchId !== null) {
      beneficiaryBulkTransferTools.clear();
      selectedBatchId = null;
      batchSortPanel?.setActive?.(null);
      currentPage = 1;
      _clearUrlParam("batch");
      renderPaginatedTable();
    } else {
      if (isDirectoryViewer) {
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

  // --- START: DB-Driven Education & Sub-Level Dropdown ---
  let _cachedEduLevels = null;
  async function _loadEduLevelsFromDb() {
    if (_cachedEduLevels) return _cachedEduLevels;
    try {
      const { fetchEducationLevels } = await import("../../../../backend/api/beneficiary.js");
      const res = await fetchEducationLevels();
      if (res.data && res.data.length > 0) {
        _cachedEduLevels = res.data;
        return _cachedEduLevels;
      }
    } catch (e) {
      console.warn("Failed to load education_levels from backend", e);
    }
    return [];
  }

  const eduSubContainer    = document.getElementById("container-edulevel-sub");
  const eduSubBtn          = document.getElementById("btn-edulevel-dropdown");
  const eduSubMenu         = document.getElementById("menu-edulevel-dropdown");
  const eduSubInput        = document.getElementById("bdf-edulevel");
  const eduSubSelectedText = document.getElementById("edulevel-selected-text");
  const eduSubSearchWrap   = document.getElementById("edulevel-search-wrap");
  const eduSubSearchInput  = document.getElementById("edulevel-search-input");
  const eduSubOptionsList  = document.getElementById("edulevel-options-list");

  function renderEduSubOptions(optionsArr) {
    if (!eduSubOptionsList) return;
    eduSubOptionsList.innerHTML = "";
    optionsArr.forEach(item => {
      const optVal = item.id != null ? item.id : item.name;
      const optText = item.name || item;
      const li = document.createElement("li");
      li.innerHTML = `
        <button type="button"
          class="edulevel-option cursor-pointer flex w-full items-center gap-2 px-3.5 py-2 hover:bg-spes-blue/8 dark:hover:bg-white/5 transition-colors"
          data-value="${optVal}" data-name="${escHtml(optText)}">
          <svg class="h-3.5 w-3.5 text-spes-blue dark:text-spes-yellow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="font-semibold text-xs">${escHtml(optText)}</span>
        </button>
      `;
      const btn = li.querySelector("button");
      btn.addEventListener("click", () => {
        if (eduSubInput) eduSubInput.value = optVal;
        if (eduSubSelectedText) eduSubSelectedText.textContent = optText;
        if (eduSubMenu) eduSubMenu.classList.add("hidden");
      });
      eduSubOptionsList.appendChild(li);
    });
  }

  const DEFAULT_EDU_LEVELS = [
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

  function _resolveCatId(val) {
    if (val == null || val === "") return null;
    const s = String(val).toLowerCase().trim();
    if (s === "1" || s.includes("senior")) return 1;
    if (s === "2" || s.includes("graduate")) return 2;
    if (s === "3" || s.includes("college level") || s === "college") return 3;
    if (s === "4" || s.includes("highschool") || s === "high school") return 4;
    if (s === "5" || s.includes("osy")) return 5;
    const n = parseInt(val, 10);
    return !isNaN(n) ? n : null;
  }

  window._updateEduSubLevelDropdown = async function(catVal, preservedSubVal = "") {
    if (!eduSubContainer || !eduSubOptionsList) return;
    const catId = _resolveCatId(catVal);
    let allDbLevels = await _loadEduLevelsFromDb();
    if (!allDbLevels || allDbLevels.length === 0) {
      allDbLevels = DEFAULT_EDU_LEVELS;
    }

    // Filter matching education_id
    const matchingLevels = allDbLevels.filter(lvl => lvl.education_id === catId);

    if (matchingLevels.length > 0) {
      eduSubContainer.classList.remove("hidden");

      // Mini-Search Visibility Rule: Show ONLY if more than 4 options (e.g. 5+ options)
      if (eduSubSearchWrap) {
        if (matchingLevels.length > 4) {
          eduSubSearchWrap.classList.remove("hidden");
        } else {
          eduSubSearchWrap.classList.add("hidden");
        }
      }

      renderEduSubOptions(matchingLevels);

      // Restore preserved value
      const found = matchingLevels.find(l => 
        String(l.id) === String(preservedSubVal) || 
        l.name.toLowerCase() === String(preservedSubVal).toLowerCase()
      );

      if (found) {
        if (eduSubInput) eduSubInput.value = found.id;
        if (eduSubSelectedText) eduSubSelectedText.textContent = found.name;
      } else {
        if (eduSubInput) eduSubInput.value = "";
        if (eduSubSelectedText) eduSubSelectedText.textContent = "— Select Level —";
      }
    } else {
      eduSubContainer.classList.add("hidden");
      if (eduSubInput) eduSubInput.value = "";
      if (eduSubSelectedText) eduSubSelectedText.textContent = "— Select Level —";
    }
  };

  if (eduSubSearchInput && eduSubOptionsList) {
    const wrap = eduSubSearchInput.parentElement;
    let clearBtn = null;
    if (wrap) {
      wrap.classList.add("relative");
      eduSubSearchInput.classList.add("pr-7");
      clearBtn = wrap.querySelector('[data-clear-for="edulevel-search-input"]');
      if (!clearBtn) {
        clearBtn = document.createElement("button");
        clearBtn.type = "button";
        clearBtn.dataset.clearFor = "edulevel-search-input";
        clearBtn.className = "group absolute inset-y-0 end-1.5 hidden cursor-pointer items-center justify-center px-1 text-spes-black/40 hover:text-spes-black dark:text-white/40 dark:hover:text-white transition-colors focus-visible:outline-none";
        clearBtn.setAttribute("aria-label", "Clear search");
        clearBtn.title = "Clear search";
        clearBtn.innerHTML = `
          <svg class="h-3 w-3" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12"/>
          </svg>
          <span class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[0.625rem] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-slate-800">
            Clear
            <span class="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></span>
          </span>
        `;
        wrap.appendChild(clearBtn);
      }
      clearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        eduSubSearchInput.value = "";
        eduSubSearchInput.dispatchEvent(new Event("input", { bubbles: true }));
        eduSubSearchInput.focus();
      });
    }

    const syncClearEdu = () => {
      if (!clearBtn) return;
      const hasVal = eduSubSearchInput.value.length > 0;
      clearBtn.classList.toggle("hidden", !hasVal);
      clearBtn.classList.toggle("flex", hasVal);
    };

    eduSubSearchInput.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      const items = eduSubOptionsList.querySelectorAll("li");
      items.forEach(li => {
        const text = li.textContent.toLowerCase();
        li.style.display = text.includes(q) ? "" : "none";
      });
      syncClearEdu();
    });
    syncClearEdu();
  }

  if (eduSubBtn && eduSubMenu) {
    eduSubBtn.addEventListener("click", () => {
      const isHidden = eduSubMenu.classList.contains("hidden");
      eduSubMenu.classList.toggle("hidden", !isHidden);
      if (isHidden && eduSubSearchInput) {
        eduSubSearchInput.value = "";
        if (eduSubOptionsList) eduSubOptionsList.querySelectorAll("li").forEach(li => li.style.display = "");
        setTimeout(() => eduSubSearchInput.focus(), 50);
      }
    });

    document.addEventListener("click", (e) => {
      if (!eduSubBtn.contains(e.target) && !eduSubMenu.contains(e.target)) {
        eduSubMenu.classList.add("hidden");
      }
    });
  }

  // Category Dropdown Listener in Form Drawer
  const mainEduBtn = document.getElementById("btn-education-dropdown");
  const mainEduMenu = document.getElementById("menu-education-dropdown");
  const mainEduInput = document.getElementById("bdf-education");

  if (mainEduBtn && mainEduMenu && mainEduInput) {
    mainEduBtn.addEventListener("click", () => {
      mainEduMenu.classList.toggle("hidden");
    });

    document.addEventListener("click", (e) => {
      if (!mainEduBtn.contains(e.target) && !mainEduMenu.contains(e.target)) {
        mainEduMenu.classList.add("hidden");
      }
    });

    const options = mainEduMenu.querySelectorAll(".edu-option");
    options.forEach(opt => {
      opt.addEventListener("click", () => {
        const val = opt.getAttribute("data-value");
        const htmlContent = opt.innerHTML;

        mainEduInput.value = val;

        const selectedContent = document.getElementById("education-selected-content");
        if (selectedContent) {
          selectedContent.innerHTML = htmlContent;
        }

        mainEduMenu.classList.add("hidden");
        window._updateEduSubLevelDropdown(val);
      });
    });
  }
  // --- END: DB-Driven Education & Sub-Level Dropdown ---

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
      const displayName = b.batch_name ? b.batch_name.toUpperCase() : `BATCH ${b.id}`;
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
      const { data: officesData } = await fetchOffices({ forceRefresh: false });
      if (Array.isArray(officesData)) allOffices = officesData;
    } catch (err) {
      console.warn("[SPES] Load offices error:", err);
    }

    await loadOfficerOffice();

    // ── Restore URL state ────────────────────────────────────────
    const urlOffice = _getUrlParam("office");
    const urlBene   = _getUrlParam("b");

    const urlBatch = _getUrlParam("batch");

    if (isDirectoryViewer && urlOffice) {
      if (urlOffice === "ALL") {
        await switchToBeneficiariesView("ALL SPES", "ALL", "ALL", null, urlBatch);
      } else {
        // Fetch implementors fresh to get correct office name + location
        const staffs = await fetchImplementorList({ forceRefresh: true });
        // Only match on office_id (never fall back to staff row id)
        const match = staffs
          .filter(s => !s.archive_at && s.office_id != null)
          .find(s => String(s.office_id) === String(urlOffice));
        if (match) {
          await switchToBeneficiariesView(match.office, match.office_location, urlOffice, match.id, urlBatch);
        } else {
          _clearUrlParam("office");
          _clearUrlParam("batch");
          _clearUrlParam("b");
          await loadData();
        }
      }
    } else {
      selectedBatchId = urlBatch ? String(urlBatch) : null;
      batchSortPanel?.setActive?.(selectedBatchId);
      await loadData();
    }

    // ── Restore beneficiary drawer & pulse-highlight ─────────────
    if (urlBene) {
      const { data: allFreshRecords } = await fetchBeneficiaries({ forceRefresh: false });
      const recordPool = (allFreshRecords && allFreshRecords.length > 0) ? allFreshRecords : allBeneficiaries;
      const targetBene = (recordPool || []).find(b => String(b.id) === String(urlBene));

      if (targetBene) {
        const targetBatchId = targetBene.batch_id ? String(targetBene.batch_id) : (targetBene.batch?.id ? String(targetBene.batch.id) : "unassigned");
        const targetOfficeId = targetBene.staffs?.office_id;
        const targetOfficeName = targetBene.staffs?.offices?.name || "SPES";

        if (isDirectoryViewer) {
          await switchToBeneficiariesView(targetOfficeName, "", targetOfficeId || "ALL", targetBene.staff_id, targetBatchId);
        } else {
          selectedBatchId = targetBatchId;
          batchSortPanel?.setActive?.(selectedBatchId);
          await loadData();
        }

        const visibleBeneficiaries = getVisibleBeneficiaries();
        const idx = visibleBeneficiaries.findIndex(b => String(b.id) === String(urlBene));
        if (idx !== -1) {
          currentPage = Math.floor(idx / rowsPerPage) + 1;
          renderPaginatedTable();

          setTimeout(() => {
            const row = document.querySelector(`tr[data-bene-id="${urlBene}"]`);
            if (row) {
              row.scrollIntoView({ behavior: "smooth", block: "center" });
              row.classList.add(
                "ring-4", "ring-spes-yellow", "dark:ring-spes-yellow",
                "bg-spes-yellow/20", "dark:bg-spes-yellow/20",
                "border-l-8", "border-spes-yellow",
                "animate-pulse", "transition-all", "duration-500"
              );
              setTimeout(() => {
                row.classList.remove("ring-4", "ring-spes-yellow", "dark:ring-spes-yellow", "animate-pulse");
              }, 4500);
            }
          }, 350);
        }
      } else {
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
