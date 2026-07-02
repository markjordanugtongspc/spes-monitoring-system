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
      "anim-badge cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all duration-200 opacity-0 scale-75 " +
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
        `anim-badge cursor-pointer shrink-0 inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[9px] font-black uppercase tracking-wider transition-all duration-200 opacity-0 scale-75 ` +
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

// ── Batch Sort Panel (DB-driven) ──────────────────────────────
function initBatchSortPanel(onFilter) {
  const BATCH_PALETTES = [
    { bg: "bg-rose-500/20",    text: "text-rose-200",    border: "border-rose-500/30"    },
    { bg: "bg-sky-500/20",     text: "text-sky-200",     border: "border-sky-500/30"     },
    { bg: "bg-emerald-500/20", text: "text-emerald-200", border: "border-emerald-500/30" },
    { bg: "bg-amber-500/20",   text: "text-amber-200",   border: "border-amber-500/30"   },
    { bg: "bg-fuchsia-500/20", text: "text-fuchsia-200", border: "border-fuchsia-500/30" },
    { bg: "bg-violet-500/20",  text: "text-violet-200",  border: "border-violet-500/30"  },
    { bg: "bg-cyan-500/20",    text: "text-cyan-200",    border: "border-cyan-500/30"    },
    { bg: "bg-orange-500/20",  text: "text-orange-200",  border: "border-orange-500/30"  },
  ];

  const COLLAPSE_IDS = ["sortfilter-wrap", "staff-search-wrap"];

  // Session role check — only admins can add batches
  const session = getSession();
  const _isAdmin = session && session.role === "admin";

  const inner = initAnimatedBadgePanel({
    panelId:       "sort-batch-panel",
    btnId:         "btn-sort-batch",
    wrapId:        "batch-badges-container",
    searchWrapId:  null,
    searchInputId: null,
    badgesListId:  "batch-badges-list",
    allLabel:      "All Batches",
    fetchItems:    async () => {
      const { data, error } = await fetchBatches({ forceRefresh: true });
      if (error && import.meta.env.DEV) console.error("[SPES] Sort Batch fetch error:", error);
      return data ?? [];
    },
    getLabel:      (b) => `BATCH ${b.batch_number}`,
    getId:         (b) => String(b.batch_number),
    getPalette:    (_b, i) => BATCH_PALETTES[i % BATCH_PALETTES.length],
    onFilter,
    onOpen() {
      const title = document.getElementById("table-title");
      if (title) { title.classList.add("truncate", "max-w-[120px]", "sm:max-w-[200px]"); }
      COLLAPSE_IDS.forEach(id => document.getElementById(id)?.classList.add("hidden"));

      // Append the "Add Batch" button after badges list renders (admin only)
      if (_isAdmin) {
        setTimeout(() => _appendAddBatchBtn(), 80);
      }
    },
    onClose() {
      const title = document.getElementById("table-title");
      if (title) { title.classList.remove("truncate", "max-w-[120px]", "sm:max-w-[200px]"); }
      COLLAPSE_IDS.forEach(id => document.getElementById(id)?.classList.remove("hidden"));
    },
  });

  addDragScroll(document.getElementById("batch-badges-list"));

  // ── Add Batch inline widget ───────────────────────────────────
  function _appendAddBatchBtn() {
    const badgesList = document.getElementById("batch-badges-list");
    if (!badgesList) return;
    // Remove existing if already appended
    badgesList.querySelector(".add-batch-widget")?.remove();

    const widget = document.createElement("div");
    widget.className = "add-batch-widget shrink-0 inline-flex items-center gap-1 opacity-0 scale-75 transition-all duration-200";

    // "+" add button
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.title = "Add Batch";
    addBtn.className =
      "add-batch-trigger cursor-pointer shrink-0 inline-flex items-center justify-center rounded border border-emerald-400/50 bg-emerald-500/20 px-2 py-1 text-emerald-300 hover:bg-emerald-500/40 hover:border-emerald-400/80 transition-all duration-200";
    addBtn.innerHTML = `<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M12 4v16m8-8H4"/></svg>`;

    // Inline input row (hidden by default)
    const inputRow = document.createElement("div");
    inputRow.className = "add-batch-input-row hidden items-center gap-1";
    inputRow.innerHTML = `
      <input type="number" min="1" max="99" placeholder="No."
        class="add-batch-num h-7 w-16 rounded border border-white/25 bg-white/10 px-2 text-[11px] text-white placeholder:text-white/40 focus:border-white/50 focus:bg-white/15 focus:outline-none transition-all"
        autocomplete="off" />
      <span class="text-[9px] font-black uppercase tracking-wider text-white/60 select-none">BATCH</span>
      <button type="button" title="Add Batch" class="add-batch-confirm cursor-pointer inline-flex items-center justify-center h-6 w-6 rounded border border-emerald-400/50 bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/40 transition-all">
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>
      </button>
      <button type="button" title="Cancel" class="add-batch-cancel cursor-pointer inline-flex items-center justify-center h-6 w-6 rounded border border-white/20 bg-white/10 text-white/60 hover:bg-white/20 transition-all">
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    `;

    widget.appendChild(addBtn);
    widget.appendChild(inputRow);
    badgesList.appendChild(widget);

    // Animate in
    setTimeout(() => {
      widget.classList.remove("opacity-0", "scale-75");
      widget.classList.add("opacity-100", "scale-100");
    }, 60);

    const numInput = widget.querySelector(".add-batch-num");
    const confirmBtn = widget.querySelector(".add-batch-confirm");
    const cancelBtn = widget.querySelector(".add-batch-cancel");

    const _showInput = () => {
      addBtn.classList.add("hidden");
      inputRow.classList.remove("hidden");
      inputRow.classList.add("flex");
      numInput.value = "";
      numInput.focus();
    };

    const _hideInput = () => {
      addBtn.classList.remove("hidden");
      inputRow.classList.add("hidden");
      inputRow.classList.remove("flex");
    };

    const _submit = async () => {
      const num = numInput.value.trim();
      if (!num) return;
      confirmBtn.disabled = true;
      const res = await addBatch(num);
      confirmBtn.disabled = false;
      if (!res.success) {
        modals.error("Add Batch Failed", res.error);
        return;
      }
      invalidateBatchCache();
      _hideInput();
      // Rebuild panel so new badge appears
      inner.rebuild();
    };

    addBtn.addEventListener("click", (e) => { e.stopPropagation(); _showInput(); });
    cancelBtn.addEventListener("click", (e) => { e.stopPropagation(); _hideInput(); });
    confirmBtn.addEventListener("click", (e) => { e.stopPropagation(); _submit(); });
    numInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") _submit();
      if (e.key === "Escape") _hideInput();
    });
    numInput.addEventListener("click", (e) => e.stopPropagation());
  }

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

  // ── Batch Sort Panel (admin + officer, beneficiary view) ─────
  const batchSortPanel = initBatchSortPanel(
    (batchId) => {
      if (batchId === null) {
        sortFilterInstance?.setFilter("batch_number", "all");
      } else {
        sortFilterInstance?.setFilter("batch_number", batchId);
      }
    }
  );

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

    // Show Add Beneficiary Button
    const addBtn = document.getElementById("btn-add-beneficiary");
    if (addBtn) {
      addBtn.classList.remove("hidden");
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

    const targetB = _getUrlParam("b");
    if (targetB) {
      const idx = filteredData.findIndex(item => String(item.id) === String(targetB));
      if (idx !== -1) {
        currentPage = Math.floor(idx / ROWS_PER_PAGE) + 1;
      }
    }

    batchSortPanel.show();
    batchSortPanel.rebuild();
    setupSortFilter(filteredData);

    // Status switch only for a specific implementor's roster (not the ALL aggregate)
    _showStatusSwitch(officeLocation !== "ALL");
  }

  async function switchToImplementorsView() {
    if (!isAdmin) return;
    viewMode = "implementors";
    currentOfficeLocation = "";
    currentOfficeId = null;
    currentStaffIdView = null;

    // Clear URL state — back to implementors list
    _clearUrlParam("office");
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

    // Hide Add Beneficiary Button
    document.getElementById("btn-add-beneficiary")?.classList.add("hidden");

    // Hide the whole table-controls-container (no search/filter needed for implementors list)
    document.getElementById("table-controls-container")?.classList.add("hidden");

    // Show Sort Offices panel; hide Sort Batch panel + status switch
    officeSortPanel.show();
    batchSortPanel.hide();
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
        "text-sm sm:text-base md:text-lg font-montserrat font-black text-spes-blue dark:text-white tracking-tight uppercase truncate whitespace-nowrap max-w-[190px] sm:max-w-[250px]";
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
          <button id="btn-drawer-prev" class="cursor-pointer inline-flex items-center gap-1 rounded-md border border-spes-blue/20 bg-white dark:bg-transparent dark:border-white/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-spes-black/60 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
            Prev
          </button>
          <button id="btn-drawer-next" class="cursor-pointer inline-flex items-center gap-1 rounded-md bg-spes-blue px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-spes-blue/90 shadow-md transition-all">
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
            ? `<span class="inline-flex items-center gap-1 bg-spes-blue/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow">BATCH ${escHtml(String(b.batch.batch_number))}</span>`
            : `<span class="italic text-[10px] text-spes-black/30 dark:text-white/30">Not Assigned</span>`
          }
        </div>
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Status</span>
          ${String(b.return_status || "NEW").toUpperCase() === "SPES BABY"
            ? `<span class="inline-flex items-center gap-1 bg-red-400/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-red-500 dark:bg-red-400/20 dark:text-red-300">SPES Baby</span>`
            : `<span class="inline-flex items-center gap-1 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">New</span>`
          }
        </div>
        <div class="flex justify-between items-center py-1">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Education</span>
          <span class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
            ${escHtml(b.education?.name || "Not Provided")}
          </span>
        </div>
      </div>
    `;

    // Prev / Next within drawer
    document.getElementById("btn-drawer-prev")?.addEventListener("click", () => {
      const prev = (index - 1 + activeBeneficiaries.length) % activeBeneficiaries.length;
      openDrawer(activeBeneficiaries[prev], prev);
    });
    document.getElementById("btn-drawer-next")?.addEventListener("click", () => {
      const next = (index + 1) % activeBeneficiaries.length;
      openDrawer(activeBeneficiaries[next], next);
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
          <th scope="col" class="px-6 py-3 text-left whitespace-nowrap">Address</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Period of Employment</th>
          <th scope="col" class="px-6 py-3 text-center whitespace-nowrap">Contact No.</th>
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
      const page = activeImplementors.slice(start, end);
      tbody.innerHTML = page.map((s, idx) => {
        const absIdx = start + idx;
        const officeBadge = s.office && s.office !== "N/A"
          ? `<span class="inline-flex items-center gap-1 rounded bg-spes-blue/10 px-2.5 py-1 text-[10px] font-black uppercase text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow" title="${escHtml(s.office)}">${escHtml(formatOfficeShort(s.office))}</span>`
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
              ${isRowAdmin ? '<span class="ml-2 inline-flex items-center gap-1 rounded bg-red-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-red-600 dark:bg-red-500/20 dark:text-red-400">Admin</span>' : ''}
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
      const BATCH_CHIP_PALETTES = {
        1: "bg-rose-100    text-rose-700    dark:bg-rose-500/20    dark:text-rose-300",
        2: "bg-sky-100     text-sky-700     dark:bg-sky-500/20     dark:text-sky-300",
        3: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
        4: "bg-amber-100   text-amber-700   dark:bg-amber-500/20   dark:text-amber-300",
        5: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/20 dark:text-fuchsia-300",
      };

      const page = activeBeneficiaries.slice(start, end);
      const showOfficeCol = currentOfficeLocation === "ALL";
      tbody.innerHTML = page.map((b, idx) => {
        const absIdx   = start + idx;
        const period   = formatPeriod(b);
        const batchNum = b.batch?.batch_number != null ? Number(b.batch.batch_number) : null;
        const chipCls  = batchNum !== null
          ? (BATCH_CHIP_PALETTES[batchNum] || "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-white/60")
          : "";
        const batchChip = batchNum !== null
          ? `<span class="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide ${chipCls}">B${batchNum}</span>`
          : "";

        const isBaby = String(b.return_status || "NEW").toUpperCase() === "SPES BABY";
        const statusChip = isBaby
          ? `<span class="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide bg-red-400/15 text-red-500 dark:bg-red-400/20 dark:text-red-300">SPES Baby</span>`
          : `<span class="ml-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">New</span>`;

        let officeName = "N/A";
        if (b.staffs && b.staffs.office_id) {
          const matchedOffice = allOffices.find(o => o.id === b.staffs.office_id);
          if (matchedOffice) {
            officeName = matchedOffice.name;
          }
        }
        // Fallback in case staff is missing office_id but has a name
        if (officeName === "N/A" && b.staffs && b.staffs.full_name) {
          officeName = b.staffs.full_name;
        }
        
        const officeNameShort = formatOfficeShort(officeName);
        const officeTd = showOfficeCol ? `<td class="px-6 py-4 text-left font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap" title="${escHtml(officeName)}">${escHtml(officeNameShort)}</td>` : '';

        const isTarget = new URLSearchParams(window.location.search).get("b") === String(b.id);
        const rowClass = isTarget 
          ? "border-b border-gray-100 dark:border-white/5 bg-spes-blue/10 dark:bg-spes-yellow/10 border-l-4 border-spes-blue dark:border-spes-yellow transition-all duration-500 animate-pulse cursor-pointer" 
          : "border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow cursor-pointer";

        return `
          <tr class="${rowClass}"
              data-bene-idx="${absIdx}">
            <td class="p-4 text-center">
              <div class="flex items-center justify-center">
                <input type="checkbox" class="beneficiary-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
              </div>
            </td>
            <td class="px-6 py-4 text-left whitespace-nowrap">
              <span class="font-extrabold text-spes-black dark:text-spes-white">${escHtml(b.full_name?.toUpperCase() || "—")}</span>${batchChip}${statusChip}
            </td>
            ${officeTd}
            <td class="px-6 py-4 text-left font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${escHtml(b.address || "N/A")}</td>
            <td class="px-6 py-4 text-center font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${escHtml(period)}</td>
            <td class="px-6 py-4 text-center font-black text-indigo-600 dark:text-indigo-400 whitespace-nowrap">${escHtml(b.contact_number || "—")}</td>
            <td class="px-6 py-4 text-center whitespace-nowrap">
              <button class="btn-edit-bene cursor-pointer inline-flex items-center justify-center rounded-lg p-2 text-spes-blue transition-colors hover:bg-spes-blue/10 dark:text-spes-yellow dark:hover:bg-spes-yellow/10" data-bene-idx="${absIdx}" title="Edit">
                <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              </button>
            </td>
          </tr>`;
      }).join("");

      // Row click → open drawer
      tbody.querySelectorAll("tr").forEach(row => {
        row.querySelector(".beneficiary-row-checkbox")?.addEventListener("click", e => e.stopPropagation());
        row.querySelector(".btn-edit-bene")?.addEventListener("click", e => {
          e.stopPropagation();
          const idx = parseInt(e.currentTarget.getAttribute("data-bene-idx"), 10);
          showEditModal(activeBeneficiaries[idx]);
        });
        row.addEventListener("click", () => {
          const idx = parseInt(row.getAttribute("data-bene-idx"), 10);
          openDrawer(activeBeneficiaries[idx], idx);
        });
      });

      // Pagination info
      const totalEl = document.getElementById("pagination-total");
      const rangeEl = document.getElementById("pagination-range");
      if (totalEl) totalEl.textContent = activeBeneficiaries.length;
      if (rangeEl) rangeEl.textContent = activeBeneficiaries.length === 0 ? "0" : `${start + 1}–${Math.min(end, activeBeneficiaries.length)}`;

      // Page indicators
      updatePageIndicators(activeBeneficiaries.length);
    }
  }

  function updatePageIndicators(totalCount) {
    const indicatorsEl = document.getElementById("page-indicators-container");
    if (indicatorsEl) {
      const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE));
      indicatorsEl.innerHTML = Array.from({ length: totalPages }, (_, i) => {
        const n = i + 1;
        const active = n === currentPage
          ? "bg-spes-blue/8 text-spes-blue dark:bg-white/10 dark:text-spes-yellow font-bold border-spes-blue/15"
          : "bg-spes-white text-spes-black/60 hover:bg-spes-blue/8 hover:text-spes-blue dark:bg-spes-dark-primary dark:text-spes-white/60 dark:hover:bg-spes-white/8 dark:hover:text-spes-yellow border-spes-blue/15 dark:border-white/10";
        return `<li><button class="cursor-pointer border px-3 py-2 text-sm font-medium ${active}" data-page="${n}">${n}</button></li>`;
      }).join("");

      indicatorsEl.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", e => {
          currentPage = parseInt(e.currentTarget.getAttribute("data-page"), 10);
          renderPaginatedTable();
        });
      });
    }
  }

  // ── Pagination controls ──────────────────────────────────────
  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderPaginatedTable(); }
  });
  document.getElementById("next-page")?.addEventListener("click", () => {
    const listLength = viewMode === "implementors" ? activeImplementors.length : activeBeneficiaries.length;
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
        btnSortId: "btn-sort-beneficiary",
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
    // Show controls container; Sort Batch lives inside it
    document.getElementById("table-controls-container")?.classList.remove("hidden");

    batchSortPanel.show();
    batchSortPanel.rebuild();
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

  if (isAdmin) {
    document.getElementById("btn-back-to-implementors")?.addEventListener("click", () => {
      switchToImplementorsView();
    });
  }

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
      btn.dataset.batchLabel = `BATCH ${b.batch_number}`;
      btn.textContent = `BATCH ${b.batch_number}`;
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

  if (batchDropdownBtn && batchDropdownMenu) {
    batchDropdownBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (batchDropdownMenu.classList.contains("hidden")) {
        await _populateBatchDropdown();
        _showBatchAddRow(_batchIsAddMode);
        batchDropdownMenu.classList.remove("hidden");
      } else {
        batchDropdownMenu.classList.add("hidden");
      }
    });

    document.addEventListener("click", (e) => {
      if (!batchDropdownBtn.contains(e.target) && !batchDropdownMenu.contains(e.target)) {
        batchDropdownMenu.classList.add("hidden");
      }
    });

    batchOptionsList?.addEventListener("click", (e) => {
      const btn = e.target.closest(".batch-option");
      if (!btn) return;
      _syncBatchDropdownDisplay(btn.dataset.batchId);
      batchDropdownMenu.classList.add("hidden");
    });

    // Add Batch confirm
    const _submitNewBatch = async () => {
      const num = batchAddInput?.value?.trim();
      if (!num) return;
      if (batchAddConfirm) batchAddConfirm.disabled = true;
      const res = await addBatch(num);
      if (batchAddConfirm) batchAddConfirm.disabled = false;
      if (!res.success) { modals.error("Add Batch Failed", res.error); return; }
      invalidateBatchCache();
      await _populateBatchDropdown();
      // Auto-select the newly added batch
      const newBtn = batchOptionsList?.querySelector(`[data-batch-id="${res.data.id}"]`);
      if (newBtn) { _syncBatchDropdownDisplay(res.data.id); }
      batchDropdownMenu.classList.add("hidden");
    };

    batchAddConfirm?.addEventListener("click", (e) => { e.stopPropagation(); _submitNewBatch(); });
    batchAddCancel?.addEventListener("click",  (e) => { 
      e.stopPropagation(); 
      if (batchAddForm) {
        batchAddForm.classList.remove("flex");
        batchAddForm.classList.add("hidden");
      }
      if (btnRevealBatchAdd) btnRevealBatchAdd.classList.remove("hidden");
    });
    
    if (btnRevealBatchAdd && batchAddForm) {
      btnRevealBatchAdd.addEventListener("click", (e) => {
        e.stopPropagation();
        btnRevealBatchAdd.classList.add("hidden");
        batchAddForm.classList.remove("hidden");
        batchAddForm.classList.add("flex");
        if (batchAddInput) { batchAddInput.value = ""; batchAddInput.focus(); }
      });
    }

    batchAddInput?.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") _submitNewBatch();
      if (e.key === "Escape") {
        if (batchAddForm) {
          batchAddForm.classList.remove("flex");
          batchAddForm.classList.add("hidden");
        }
        if (btnRevealBatchAdd) btnRevealBatchAdd.classList.remove("hidden");
      }
    });
    batchAddInput?.addEventListener("click", (e) => e.stopPropagation());
  }

  // Patch _bdfFill to also sync the batch dropdown visually
  const _origBdfFill = _bdfFill;
  const _patchedBdfFill = async (defaults = {}, isEdit = false) => {
    _origBdfFill(defaults);
    _batchIsAddMode = !isEdit;
    await _populateBatchDropdown();
    _syncBatchDropdownDisplay(defaults.batch_id ?? "");
  };
  // --- END: Batch Dropdown ---

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
        } else {
          _clearUrlParam("office");
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
        openDrawer(activeBeneficiaries[idx], idx);
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
        console.error("[SPES] Error fetching beneficiaries for count:", error);
        return 0;
      }
    }

    return count || 0;
  } catch (err) {
    console.error("[SPES] Exception in calculateTotalBeneficiariesByImplementor:", err);
    return 0;
  }
}
// --- END: Calculate Total Added Beneficiaries ---

