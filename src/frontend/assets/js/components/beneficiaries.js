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
  invalidateBeneficiaryCache
} from "../../../../backend/api/beneficiary.js";
import { getSession } from "../rbac/guard.js";
import { supabase } from "../../../../backend/api/supabase.js";
import { setupSortFiltration } from "./sort-filtration.js";
import { modals } from "./modals.js";

// ── Constants ─────────────────────────────────────────────────
const ROWS_PER_PAGE = 10;

const MONTHS = [
  "JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
  "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"
];

// ── Helpers ───────────────────────────────────────────────────
function formatPeriod(row) {
  const parts = [row.month_period, row.year_period].filter(Boolean);
  return parts.join(" ") || "N/A";
}

function formatInsurance(val) {
  if (!val) return "N/A";
  const num = parseFloat(String(val).replace(/[^0-9.]/g, ""));
  if (!isNaN(num)) return `₱${num.toFixed(2)}`;
  return String(val);
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
    full_name:      g("bdf-full-name"),
    designated:     g("bdf-designated"),
    relationship:   g("bdf-relationship"),
    address:        g("bdf-address"),
    month_period:   g("bdf-month-period"),
    year_period:    g("bdf-year-period"),
    contact_number: g("bdf-contact"),
    gender:         g("bdf-gender"),
    birthday:       g("bdf-birthday") || null,
    age:            g("bdf-age") || null,
    education:      g("bdf-education"),
  };
}

function _bdfFill(defaults = {}) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ""; };
  set("bdf-full-name",    defaults.full_name);
  set("bdf-designated",   defaults.designated);
  set("bdf-relationship", defaults.relationship);
  set("bdf-address",      defaults.address);
  set("bdf-month-period", defaults.month_period);
  set("bdf-year-period",  defaults.year_period ?? new Date().getFullYear());
  set("bdf-contact",      defaults.contact_number);
  set("bdf-gender",       defaults.gender);
  set("bdf-birthday",     defaults.birthday);
  set("bdf-age",          defaults.age);
  set("bdf-education",    defaults.education);
}

// ── Main export ───────────────────────────────────────────────
export function initBeneficiaries() {
  const tbody = document.getElementById("beneficiary-table-body");
  if (!tbody) return;

  const session = getSession();
  let officerOffice = null;

  const loadOfficerOffice = async () => {
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
          const officeInfoBottom = document.getElementById("officer-assigned-office-info-bottom");
          const officeNameEl = document.getElementById("assigned-office-name");
          const officeLocEl = document.getElementById("assigned-office-location");
          if (officeNameEl) officeNameEl.textContent = data.name.toUpperCase();
          if (officeLocEl) officeLocEl.textContent = data.location.toUpperCase();
          if (officeInfoTop) officeInfoTop.classList.remove("hidden");
          if (officeInfoBottom) officeInfoBottom.classList.remove("hidden");
        }
      } catch (err) {
        console.warn("[SPES] loadOfficerOffice error:", err);
      }
    }
  };

  // State
  let allBeneficiaries  = [];
  let activeBeneficiaries = [];
  let currentPage = 1;
  let sortFilterInstance = null;

  // Drawer DOM
  const drawer    = document.getElementById("drawer-beneficiary-details");
  const content   = document.getElementById("drawer-beneficiary-content");
  const closeBtn  = document.getElementById("btn-close-beneficiary-drawer");
  const addBtn    = document.getElementById("btn-add-beneficiary");

  // ── Drawer ──────────────────────────────────────────────────
  const openDrawer = (b, index) => {
    if (!drawer || !content) return;

    const drawerLabel = document.getElementById("drawer-label");
    if (drawerLabel) {
      drawerLabel.textContent = (b.full_name || "").toUpperCase();
      drawerLabel.className =
        "text-sm sm:text-base md:text-lg font-montserrat font-black text-spes-blue dark:text-white tracking-tight uppercase truncate whitespace-nowrap max-w-[190px] sm:max-w-[250px]";
    }

    const period     = formatPeriod(b);
    const insurance  = formatInsurance(b.insurance);
    const bday       = formatDate(b.birthday);

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
          <span class="font-extrabold text-spes-black dark:text-white uppercase">${escHtml(b.gender || "N/A")}</span>
        </div>
        <div class="flex justify-between items-center py-1">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Education</span>
          <span class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
            ${escHtml(b.education || "Not Provided")}
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
    const end   = start + ROWS_PER_PAGE;
    const page  = activeBeneficiaries.slice(start, end);

    tbody.innerHTML = page.map((b, idx) => {
      const absIdx   = start + idx;
      const period   = formatPeriod(b);
      return `
        <tr class="border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow cursor-pointer"
            data-bene-idx="${absIdx}">
          <td class="p-4 text-center">
            <div class="flex items-center justify-center">
              <input type="checkbox" class="beneficiary-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
            </div>
          </td>
          <td class="px-6 py-4 text-left font-extrabold text-spes-black dark:text-spes-white whitespace-nowrap">${escHtml(b.full_name?.toUpperCase() || "—")}</td>
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

    // Page indicator buttons
    const indicatorsEl = document.getElementById("page-indicators-container");
    if (indicatorsEl) {
      const totalPages = Math.max(1, Math.ceil(activeBeneficiaries.length / ROWS_PER_PAGE));
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
    const total = Math.ceil(activeBeneficiaries.length / ROWS_PER_PAGE);
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
        tableId:         "beneficiary-table-body",
        btnSortId:       "btn-sort-beneficiary",
        dropdownSortId:  "dropdown-sort-beneficiary",
        btnFilterId:     "btn-filter-beneficiary",
        dropdownFilterId:"dropdown-filter-beneficiary",
        originalData:    data,
        onRender: (filtered) => {
          activeBeneficiaries = filtered;
          currentPage = 1;
          renderPaginatedTable();
        }
      });
    }
  }

  // ── Data loading ─────────────────────────────────────────────
  async function loadData(forceRefresh = false) {
    const { data, error } = await fetchBeneficiaries({ forceRefresh });
    if (error) {
      modals.error("Load Error", error);
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-sm text-spes-black/40 dark:text-white/40">Failed to load data.</td></tr>`;
      return;
    }

    let filteredData = data;
    if (session && session.role !== "admin" && officerOffice && officerOffice.location) {
      const locLower = officerOffice.location.trim().toLowerCase();
      filteredData = data.filter(b => b.address && b.address.trim().toLowerCase() === locLower);
    }

    allBeneficiaries = filteredData;
    setupSortFilter(filteredData);
  }

  // ── Add / Edit drawer ────────────────────────────────────────
  const bdfOverlay   = document.getElementById("drawer-bene-form-overlay");
  const bdfDrawer    = document.getElementById("drawer-bene-form");
  const bdfTitle     = document.getElementById("drawer-bene-form-title");
  const bdfSubtitle  = document.getElementById("drawer-bene-form-subtitle");
  const bdfError     = document.getElementById("bdf-error");
  const bdfForm      = document.getElementById("form-bene-drawer");
  const bdfCloseBtn  = document.getElementById("btn-close-bene-form-drawer");
  const bdfCancelBtn = document.getElementById("btn-cancel-bene-form");
  const bdfSubmitBtn = document.getElementById("btn-submit-bene-form");
  const bdfLabel     = document.getElementById("btn-submit-bene-label");

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

  const openBdfDrawer = (defaults = null) => {
    if (!bdfDrawer || !bdfOverlay) return;
    _bdfEditId = defaults?.id ?? null;
    _bdfHideError();
    _bdfSetLoading(false);
    if (bdfForm) bdfForm.reset();
    
    if (defaults) {
      _bdfFill(defaults);
      if (session && session.role !== "admin" && officerOffice && officerOffice.location) {
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
      _bdfFill({ year_period: new Date().getFullYear() });
      if (session && session.role !== "admin" && officerOffice && officerOffice.location) {
        const addressInput = document.getElementById("bdf-address");
        if (addressInput) {
          addressInput.value = officerOffice.location;
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

  window.openAddBeneficiaryDrawer = openBdfDrawer;

  if (window.location.hash === "#add") {
    setTimeout(() => {
      if (window.openAddBeneficiaryDrawer) window.openAddBeneficiaryDrawer();
    }, 500);
  }

  // ── Bootstrap ────────────────────────────────────────────────
  (async () => {
    await loadOfficerOffice();
    await loadData();
  })();
}
