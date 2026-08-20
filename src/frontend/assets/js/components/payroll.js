/**
 * SPES Portal — Payroll Component & Interactive Controller
 * ─────────────────────────────────────────────────────────
 * Features:
 *  1. Top 4 Executive Statistic Cards with Dynamic Money & Number Counter Animations.
 *  2. Multi-tier hierarchy:
 *     - Tier 1: Implementors & Offices Summary (with animated statistical metrics and Designated Officers).
 *     - Tier 2: Dynamic 50-Item Chunked Batches (Square-type enterprise cards with animated disbursement counters).
 *     - Tier 3: Individual Beneficiary Roster with animated stipend metrics and larger typography (for 30+ users).
 *  3. Flowbite Offcanvas Drawer supporting both VIEW MODE (on row click) and EDIT MODE (on edit icon click).
 *  4. Full RBAC, Theme-toggle, search, filter, and pagination support.
 */

import { applyPermissions, requireAuth, signOut, getSession } from "../rbac/guard.js";
import { getOfficeAccessScope } from "../rbac/scope.js";
import { initThemeToggle } from "./theme-toggle.js";
import { modals } from "./modals.js";
import { animateCounter } from "./animations.js";
import { preferenceStorage } from "./storage.js";
import { formatNumberWithCommas, parseNumberFromCommas, attachNumberCommaFormatter } from "./drawer.js";
import {
  DEFAULT_STIPEND_RATE,
  DEFAULT_WORK_DAYS,
  BATCH_CHUNK_SIZE,
  fetchBeneficiaryPayrollRoster,
  computePayrollExecutiveSummary,
  groupOfficeBeneficiariesIntoChunks,
  updateBeneficiaryPayrollRecord,
  bulkUpdatePayrollStatus,
  fetchDbPayrollBudgets,
  upsertDbPayrollBudget,
  subscribeToPayrollRealtime,
} from "../../../../backend/api/payroll.js";
import { fetchImplementorList } from "../../../../backend/api/auth.js";
import { fetchOffices } from "../../../../backend/api/staff.js";
import { initPayrollExportModal, openPayrollExportModal, updatePayrollExportData } from "./payroll-export.js";

const ROWS_PER_PAGE = 10;

// --- START: PURGE LEGACY PAYROLL MOCK STORAGE ---
function _purgeLegacyPayrollStorage() {
  try {
    localStorage.removeItem("spes_beneficiary_payroll_v3");
  } catch {}
}
// --- END: PURGE LEGACY PAYROLL MOCK STORAGE ---

// --- START: FORMAT CURRENCY HELPER ---
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(amount) || 0);
}
// --- END: FORMAT CURRENCY HELPER ---

// --- START: FORMAT PHILIPPINE TIMESTAMP HELPER ---
export function formatPhilippineTimestamp(isoOrDateString) {
  if (!isoOrDateString) return "";
  try {
    const d = new Date(isoOrDateString);
    if (isNaN(d.getTime())) return "";

    const formattedDate = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(d);

    const formattedTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }).format(d);

    return `${formattedDate}, ${formattedTime} (GMT+08)`;
  } catch {
    return "";
  }
}
// --- END: FORMAT PHILIPPINE TIMESTAMP HELPER ---

// --- START: ESCAPE HTML HELPER ---
function escHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
// --- END: ESCAPE HTML HELPER ---

// --- START: HIGHLIGHT MATCH TEXT HELPER ---
function highlightMatchText(text, query) {
  if (!text) return "";
  if (!query) return escHtml(text);
  const escaped = String(text);
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  return escHtml(escaped).replace(regex, `<mark class="bg-amber-300 dark:bg-amber-400 text-spes-black font-black px-1 py-0.5 rounded shadow-sm">$1</mark>`);
}
// --- END: HIGHLIGHT MATCH TEXT HELPER ---

// Global state
let allBeneficiaries = [];
let filteredBeneficiaries = [];
let allImplementors = [];
let allOffices = [];
let customGeneralBudget = null;
let customOfficeBudgets = {};

let currentView = "implementors"; // "implementors" | "batches" | "beneficiaries"
let selectedOfficeId = null;
let selectedOfficeName = "";
let currentOfficeBatches = [];
let selectedBatchIndex = null;
let selectedBatchTitle = "";
let currentActiveBeneficiary = null;
let isInlineEditMode = false;
let isBudgetCardEditing = false;
const editingOfficeIds = new Set();

let currentPage = 1;
const selectedBeneficiaryIds = new Set();

// --- START: UPDATE EXECUTIVE STATISTIC CARDS DATA ---
function updateExecutiveSummaryCards(beneficiaries, forceFromZero = false, isFirstVisit = false) {
  const stats = computePayrollExecutiveSummary(beneficiaries, customGeneralBudget);

  const budgetEl = document.getElementById("stat-total-budget");
  const paidEl = document.getElementById("stat-total-paid");
  const pendingEl = document.getElementById("stat-total-pending");
  const remainingEl = document.getElementById("stat-remaining-balance");

  const beneCountEl = document.getElementById("stat-beneficiary-count");
  const paidCountEl = document.getElementById("stat-paid-count");
  const pendingCountEl = document.getElementById("stat-pending-count");
  const disburseRateEl = document.getElementById("stat-disbursement-rate");
  const inputBudget = document.getElementById("input-edit-total-budget");

  if (inputBudget && !isInlineEditMode) {
    inputBudget.value = formatNumberWithCommas(stats.totalBudget, true);
  }

  const paidCount = beneficiaries.filter(b => b.payroll?.payment_status === "PAID").length;
  const pendingCount = beneficiaries.filter(b => b.payroll?.payment_status === "PENDING").length;

  // First visit has grand cinematic duration and sequential delay; returning visits have fast snappy rolls
  const cardDuration = isFirstVisit ? 2000 : 750;
  const subDuration = isFirstVisit ? 1600 : 600;

  const budgetDelay = isFirstVisit ? 100 : 0;
  const paidDelay = isFirstVisit ? 220 : 0;
  const pendingDelay = isFirstVisit ? 340 : 0;
  const remainingDelay = isFirstVisit ? 460 : 0;

  if (budgetEl) animateCounter(budgetEl, stats.totalBudget, { isCurrency: true, duration: cardDuration, delay: budgetDelay, forceFromZero });
  if (paidEl) animateCounter(paidEl, stats.totalPaid, { isCurrency: true, duration: cardDuration, delay: paidDelay, forceFromZero });
  if (pendingEl) animateCounter(pendingEl, stats.totalPending, { isCurrency: true, duration: cardDuration, delay: pendingDelay, forceFromZero });
  if (remainingEl) animateCounter(remainingEl, stats.remainingBalance, { isCurrency: true, duration: cardDuration, delay: remainingDelay, forceFromZero });

  // Animate subtitle counts and percentages
  if (beneCountEl) animateCounter(beneCountEl, stats.totalBeneficiaries, { suffix: " Beneficiaries", duration: subDuration, delay: isFirstVisit ? 150 : 0, forceFromZero });
  if (paidCountEl) animateCounter(paidCountEl, paidCount, { suffix: " Paid Accounts", duration: subDuration, delay: isFirstVisit ? 270 : 0, forceFromZero });
  if (pendingCountEl) animateCounter(pendingCountEl, pendingCount, { suffix: " In Processing", duration: subDuration, delay: isFirstVisit ? 390 : 0, forceFromZero });
  if (disburseRateEl) animateCounter(disburseRateEl, stats.disbursementRate, { suffix: "% Disbursed", decimals: 0, duration: subDuration, delay: isFirstVisit ? 510 : 0, forceFromZero });
}
// --- END: UPDATE EXECUTIVE STATISTIC CARDS DATA ---

// --- START: RENDER VIEW 1 (IMPLEMENTORS / OFFICES SUMMARY WITH MULTI-TIER SEARCH) ---
function renderImplementorsView(isFirstVisit = false, updateUrl = true) {
  currentView = "implementors";
  selectedOfficeId = null;
  selectedBatchIndex = null;
  selectedBeneficiaryIds.clear();

  const titleEl = document.getElementById("payroll-table-title");
  if (titleEl) titleEl.textContent = "Implementors Payroll Directory";

  // Hide Back button completely on root view
  const backBtn = document.getElementById("btn-back-to-payroll-implementors");
  if (backBtn) {
    backBtn.classList.add("hidden");
    backBtn.classList.remove("inline-flex", "flex");
  }

  const implView = document.getElementById("payroll-implementors-view");
  const batchView = document.getElementById("payroll-batches-view");
  const beneView = document.getElementById("payroll-beneficiaries-view");
  const pagination = document.getElementById("payroll-pagination");

  if (implView) implView.classList.remove("hidden");
  if (batchView) batchView.classList.add("hidden");
  if (beneView) beneView.classList.add("hidden");
  if (pagination) pagination.classList.add("hidden");

  updateBulkDisburseButtonState();
  if (updateUrl) syncUrlState(false);

  const tbody = document.getElementById("payroll-implementors-tbody");
  if (!tbody) return;

  const searchQ = (document.getElementById("payroll-search-input")?.value || "").trim().toLowerCase();

  // Group beneficiaries by office
  const officeMap = new Map();

  allOffices.forEach(o => {
    // Find assigned implementors
    const assignedStaff = allImplementors.filter(
      s => String(s.office_id) === String(o.id) || String(s.office || "").toLowerCase() === String(o.name || "").toLowerCase()
    );

    officeMap.set(String(o.id), {
      officeId: o.id,
      officeName: o.name,
      location: o.location || "ILIGAN CITY",
      assignedStaffNames: assignedStaff.map(s => s.full_name || s.username).filter(Boolean),
      beneficiaries: [],
    });
  });

  allBeneficiaries.forEach(b => {
    const offId = String(b.staffs?.office_id || "");
    if (officeMap.has(offId)) {
      officeMap.get(offId).beneficiaries.push(b);
    } else {
      if (!officeMap.has("other")) {
        officeMap.set("other", {
          officeId: "other",
          officeName: "Other / Unassigned Office",
          location: "ILIGAN CITY",
          assignedStaffNames: [],
          beneficiaries: []
        });
      }
      officeMap.get("other").beneficiaries.push(b);
    }
  });

  const officeOverrides = customOfficeBudgets;
  let rows = [];
  officeMap.forEach((item) => {
    if (item.beneficiaries.length === 0 && item.officeId === "other") return;
    const customOfficeBudget = officeOverrides[String(item.officeId)] || null;
    const stats = computePayrollExecutiveSummary(item.beneficiaries, customOfficeBudget);
    
    // Check search matches
    const nameMatch = item.officeName.toLowerCase().includes(searchQ);
    const officerMatch = item.assignedStaffNames.some(s => s.toLowerCase().includes(searchQ));
    const matchedBeneficiaries = item.beneficiaries.filter(b => 
      String(b.full_name || "").toLowerCase().includes(searchQ) ||
      String(b.id || "").includes(searchQ) ||
      String(b.payroll?.contract_period || "").toLowerCase().includes(searchQ)
    );

    const isMatch = !searchQ || nameMatch || officerMatch || matchedBeneficiaries.length > 0;

    if (isMatch) {
      rows.push({
        ...item,
        stats,
        matchedCount: matchedBeneficiaries.length,
        hasDirectMatch: nameMatch || officerMatch
      });
    }
  });

  // Sort by count descending
  rows.sort((a, b) => b.stats.totalBeneficiaries - a.stats.totalBeneficiaries);

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-16 text-sm font-bold uppercase tracking-wider text-spes-black/40 dark:text-white/40">
          No implementors or offices match "${escHtml(searchQ)}".
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = rows.map((r) => {
    const matchBadge = (searchQ && r.matchedCount > 0)
      ? `<span class="ml-2 inline-flex items-center gap-1 rounded bg-spes-blue/10 dark:bg-spes-yellow/15 px-2 py-0.5 text-xs font-black text-spes-blue dark:text-spes-yellow animate-pulse border border-spes-blue/20 dark:border-spes-yellow/30">
           <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
           ${r.matchedCount} Matched SPES
         </span>`
      : "";

    const staffBadge = r.assignedStaffNames.length > 0
      ? `<div class="flex items-center gap-2">
           <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-spes-blue/10 text-spes-blue dark:bg-spes-yellow/10 dark:text-spes-yellow">
             <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
             </svg>
           </span>
           <div>
             <span class="font-extrabold text-sm text-spes-black dark:text-white uppercase block">${highlightMatchText(r.assignedStaffNames.join(", "), searchQ)}</span>
             <span class="text-xs font-semibold text-spes-blue dark:text-spes-yellow">Designated Officer</span>
           </div>
         </div>`
      : `<span class="text-xs text-spes-black/40 dark:text-white/40 italic">Unassigned</span>`;

    const highlightRowClass = searchQ ? "ring-2 ring-spes-blue/40 dark:ring-spes-yellow/40 bg-spes-blue/[0.02] dark:bg-spes-yellow/[0.02]" : "";

    const isRowEditing = isInlineEditMode && editingOfficeIds.has(String(r.officeId));

    const budgetCellContent = isRowEditing
      ? `<div class="flex items-center justify-end gap-1.5" onclick="event.stopPropagation()">
           <span class="text-xs font-bold text-spes-blue dark:text-spes-yellow">₱</span>
           <input type="text" inputmode="decimal" data-office-id="${escHtml(String(r.officeId))}"
             class="input-edit-office-budget w-28 rounded-none border border-spes-blue/30 bg-white px-2 py-1 font-mono text-xs font-bold text-spes-black focus:border-spes-blue focus:outline-none dark:border-white/20 dark:bg-spes-dark-secondary dark:text-white"
             value="${formatNumberWithCommas(r.stats.totalBudget, true)}" />
           <button type="button" class="btn-save-row-budget cursor-pointer inline-flex items-center justify-center p-1 bg-emerald-500 hover:bg-emerald-400 text-white rounded-none shadow transition" title="Save Office Budget" data-office-id="${escHtml(String(r.officeId))}">
             <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
           </button>
           <button type="button" class="btn-reset-row-budget cursor-pointer inline-flex items-center justify-center p-1 bg-slate-200 hover:bg-rose-500 hover:text-white text-slate-700 rounded-none shadow transition dark:bg-white/10 dark:text-white" title="Cancel Office Edit" data-office-id="${escHtml(String(r.officeId))}">
             <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"/></svg>
           </button>
         </div>`
      : `<span class="impl-currency-cell" data-target="${r.stats.totalBudget}">₱0.00</span>`;

    return `
      <tr class="cursor-pointer border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary hover:bg-spes-blue/5 dark:hover:bg-spes-yellow/5 transition-all duration-200 ${highlightRowClass}"
          data-office-id="${escHtml(String(r.officeId))}" data-office-name="${escHtml(r.officeName)}">
        <td class="px-6 py-5 font-black text-spes-black dark:text-white uppercase whitespace-nowrap">
          <div class="flex items-center gap-2">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-spes-blue dark:bg-spes-yellow"></span>
            <span class="text-base font-black hover:underline hover:text-spes-blue dark:hover:text-spes-yellow">${highlightMatchText(r.officeName, searchQ)}</span>
            ${matchBadge}
          </div>
          <span class="text-xs font-bold text-spes-black/50 dark:text-white/40 ml-4.5 block mt-1">${escHtml(r.location)}</span>
        </td>
        <td class="px-6 py-5 whitespace-nowrap">
          ${staffBadge}
        </td>
        <td class="px-6 py-5 text-center font-black text-base text-spes-black dark:text-white whitespace-nowrap tabular-nums">
          <span class="impl-count-cell" data-target="${r.stats.totalBeneficiaries}">0</span>
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-spes-blue dark:text-spes-yellow whitespace-nowrap tabular-nums">
          ${budgetCellContent}
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-emerald-600 dark:text-emerald-400 whitespace-nowrap tabular-nums">
          <span class="impl-currency-cell" data-target="${r.stats.totalPaid}">₱0.00</span>
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-amber-600 dark:text-amber-400 whitespace-nowrap tabular-nums">
          <span class="impl-currency-cell" data-target="${r.stats.totalPending}">₱0.00</span>
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-red-600 dark:text-red-400 whitespace-nowrap tabular-nums">
          <span class="impl-currency-cell" data-target="${r.stats.remainingBalance}">₱0.00</span>
        </td>
      </tr>
    `;
  }).join("");

  const countDuration = isFirstVisit ? 1400 : 600;
  const currDuration = isFirstVisit ? 1500 : 650;
  const baseDelay = isFirstVisit ? 150 : 0;
  const stepDelay = isFirstVisit ? 30 : 10;

  // Animate implementors table statistics with staggered roll
  tbody.querySelectorAll(".impl-count-cell").forEach((el, idx) => {
    const target = Number(el.dataset.target) || 0;
    animateCounter(el, target, { duration: countDuration, delay: baseDelay + Math.min(idx * stepDelay, 300), forceFromZero: true });
  });
  tbody.querySelectorAll(".impl-currency-cell").forEach((el, idx) => {
    const target = Number(el.dataset.target) || 0;
    animateCounter(el, target, { isCurrency: true, duration: currDuration, delay: baseDelay + Math.min(idx * stepDelay, 300), forceFromZero: true });
  });

  // Attach live comma formatting to row inputs
  tbody.querySelectorAll(".input-edit-office-budget").forEach(input => {
    attachNumberCommaFormatter(input, { allowDecimals: true });
  });

  tbody.querySelectorAll("tr[data-office-id]").forEach(row => {
    row.addEventListener("click", () => {
      if (isInlineEditMode) return;
      const officeId = row.dataset.officeId;
      const officeName = row.dataset.officeName;
      switchToBatchesView(officeId, officeName);
    });
  });

  // Individual Row-level Specific Save and Cancel Handlers
  tbody.querySelectorAll(".btn-save-row-budget").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const officeId = btn.dataset.officeId;
      const input = tbody.querySelector(`.input-edit-office-budget[data-office-id="${officeId}"]`);
      if (input && officeId) {
        const val = parseNumberFromCommas(input.value);
        customOfficeBudgets[String(officeId)] = val;
        preferenceStorage.saveCustomOfficeBudget(officeId, val);

        const session = getSession();
        upsertDbPayrollBudget(officeId, val, session?.id);

        editingOfficeIds.delete(String(officeId));
        checkAndSyncEditModeState();
        updateExecutiveSummaryCards(allBeneficiaries);
        renderImplementorsView(false, false);
        modals.flowbiteToast("Office Budget Saved", `Office allocation updated to ${formatCurrency(val)}.`, "success");
      }
    });
  });

  tbody.querySelectorAll(".btn-reset-row-budget").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const officeId = btn.dataset.officeId;
      if (officeId) {
        editingOfficeIds.delete(String(officeId));
        checkAndSyncEditModeState();
        renderImplementorsView(false, false);
      }
    });
  });
}
// --- END: RENDER VIEW 1 (IMPLEMENTORS / OFFICES SUMMARY WITH MULTI-TIER SEARCH) ---

// --- START: RENDER VIEW 2 (SQUARE-TYPE 50-RECORD CHUNKED BATCHES & ET. AL) ---
function switchToBatchesView(officeId, officeName, updateUrl = true) {
  currentView = "batches";
  selectedOfficeId = officeId;
  selectedOfficeName = officeName;
  selectedBatchIndex = null;
  selectedBeneficiaryIds.clear();

  const titleEl = document.getElementById("payroll-table-title");
  if (titleEl) titleEl.textContent = `Batches & ET.AL Payroll — ${officeName.toUpperCase()}`;

  // Reveal Back Button
  const backBtn = document.getElementById("btn-back-to-payroll-implementors");
  if (backBtn) {
    backBtn.classList.remove("hidden");
    backBtn.classList.add("inline-flex");
  }

  const implView = document.getElementById("payroll-implementors-view");
  const batchView = document.getElementById("payroll-batches-view");
  const beneView = document.getElementById("payroll-beneficiaries-view");
  const pagination = document.getElementById("payroll-pagination");

  if (implView) implView.classList.add("hidden");
  if (batchView) batchView.classList.remove("hidden");
  if (beneView) beneView.classList.add("hidden");
  if (pagination) pagination.classList.add("hidden");

  updateBulkDisburseButtonState();
  if (updateUrl) syncUrlState(false);

  render50ItemChunkedBatchCards();
}

function render50ItemChunkedBatchCards(isFirstVisit = false) {
  const grid = document.getElementById("payroll-batches-grid");
  if (!grid) return;

  const searchQ = (document.getElementById("payroll-search-input")?.value || "").trim().toLowerCase();

  const officeBeneficiaries = selectedOfficeId === "ALL"
    ? allBeneficiaries
    : allBeneficiaries.filter(b => String(b.staffs?.office_id) === String(selectedOfficeId));

  // Dynamic 50-item chunk grouping
  currentOfficeBatches = groupOfficeBeneficiariesIntoChunks(officeBeneficiaries, BATCH_CHUNK_SIZE);

  if (currentOfficeBatches.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-sm font-bold uppercase tracking-wider text-spes-black/40 dark:text-white/40">
        No active beneficiaries found for this office.
      </div>`;
    return;
  }

  let batchesToDisplay = currentOfficeBatches;
  if (searchQ) {
    batchesToDisplay = currentOfficeBatches.filter(b => {
      const bNameMatch = String(b.batchName || "").toLowerCase().includes(searchQ);
      const dbBatchMatch = String(b.dbBatchName || "").toLowerCase().includes(searchQ);
      const payrollLabelMatch = String(b.payrollLabel || "").toLowerCase().includes(searchQ);
      const etAlMatch = String(b.etAlName || "").toLowerCase().includes(searchQ);
      const periodMatch = String(b.contractPeriod || "").toLowerCase().includes(searchQ);
      const beneMatch = b.beneficiaries.some(bene => 
        String(bene.full_name || "").toLowerCase().includes(searchQ) ||
        String(bene.id || "").includes(searchQ)
      );
      return bNameMatch || dbBatchMatch || payrollLabelMatch || etAlMatch || periodMatch || beneMatch;
    });
  }

  if (batchesToDisplay.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center text-sm font-bold uppercase tracking-wider text-spes-black/40 dark:text-white/40">
        No batches match "${escHtml(searchQ)}".
      </div>`;
    return;
  }

  grid.innerHTML = batchesToDisplay.map((batch) => {
    const totalCount = batch.beneficiaries.length;
    const paidCount = batch.beneficiaries.filter(b => b.payroll?.payment_status === "PAID").length;
    const pendingCount = batch.beneficiaries.filter(b => b.payroll?.payment_status === "PENDING").length;
    const progress = totalCount > 0 ? Math.round((batch.totalPaid / batch.totalPrincipal) * 100) : 0;

    const matchedInBatch = searchQ ? batch.beneficiaries.filter(bene => 
      String(bene.full_name || "").toLowerCase().includes(searchQ) ||
      String(bene.id || "").includes(searchQ)
    ).length : 0;

    const highlightBatchClass = (searchQ && matchedInBatch > 0)
      ? "ring-4 ring-spes-blue dark:ring-spes-yellow shadow-xl animate-pulse"
      : "";

    const matchBadge = (searchQ && matchedInBatch > 0)
      ? `<span class="ml-2 inline-flex items-center gap-1 rounded bg-amber-400/20 text-amber-800 dark:text-amber-300 px-2 py-0.5 text-xs font-black">
           ${matchedInBatch} Match(es)
         </span>`
      : "";

    return `
      <!-- SQUARE TYPE ENTERPRISE CARD WITH SOLID BACKGROUND -->
      <div class="batch-card group relative cursor-pointer overflow-visible rounded-none border-2 border-spes-blue/20 bg-white p-6 shadow-md transition-all duration-300 hover:-translate-y-1 hover:border-spes-blue hover:shadow-xl dark:border-white/15 dark:bg-spes-dark-primary dark:hover:border-spes-yellow flex flex-col justify-between hover:z-30 ${highlightBatchClass}"
           data-batch-idx="${batch.batchIndex}" data-batch-id="${escHtml(batch.batchId)}" data-batch-name="${escHtml(batch.batchName)}">
        
        <div>
          <!-- Card Header & Badge -->
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center flex-wrap gap-1.5">
                <!-- Compact Badge (e.g. B1 - P1) with Interactive Hover Tooltip (BATCH 1 - PAYROLL 1) -->
                <div class="group/batchtip relative inline-flex z-20 hover:z-50">
                  <span class="cursor-pointer inline-flex items-center gap-1.5 rounded-none bg-spes-blue/10 px-2.5 py-1 text-xs font-black uppercase tracking-wider text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow border border-spes-blue/20 dark:border-spes-yellow/30 hover:bg-spes-blue/20 dark:hover:bg-spes-yellow/25 transition-colors">
                    ${escHtml(batch.shortCode || batch.batchName)} (Max ${BATCH_CHUNK_SIZE})
                  </span>
                  <div role="tooltip"
                    class="pointer-events-none absolute bottom-full left-0 mb-2.5 z-50 invisible opacity-0 group-hover/batchtip:visible group-hover/batchtip:opacity-100 transition-all duration-200 whitespace-nowrap rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white shadow-2xl dark:bg-slate-800 border border-spes-blue/40 dark:border-spes-yellow/40 flex items-center gap-2 drop-shadow-2xl">
                    <span class="inline-block h-2 w-2 rounded-full bg-spes-blue dark:bg-spes-yellow shrink-0"></span>
                    <span class="tracking-wide">${escHtml(batch.batchName)} — Max ${BATCH_CHUNK_SIZE}</span>
                    <div class="absolute -bottom-1 left-4 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></div>
                  </div>
                </div>
                ${matchBadge}
              </div>
              <!-- ET. AL Main Principal Header (e.g. ABA-A, CARLIA ANN P. ET. AL.) -->
              <h4 class="mt-2.5 font-montserrat text-lg font-black uppercase text-spes-black dark:text-white leading-snug group-hover:text-spes-blue dark:group-hover:text-spes-yellow transition-colors">
                ${highlightMatchText(batch.etAlName, searchQ)}
              </h4>
              <p class="text-xs sm:text-sm font-bold text-spes-black/60 dark:text-white/60 mt-1">
                Contract Period: <span class="text-spes-blue dark:text-spes-yellow font-black uppercase">${escHtml(batch.contractPeriod)}</span>
              </p>
            </div>
            
            <div class="text-right shrink-0">
              <span class="block text-xs font-extrabold uppercase tracking-widest text-spes-black/50 dark:text-white/50">Batch Principal</span>
              <span class="batch-principal-val font-mono text-xl sm:text-2xl font-black text-spes-blue dark:text-spes-yellow tabular-nums" data-target="${batch.totalPrincipal}">
                ₱0.00
              </span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="mt-5 space-y-2">
            <div class="flex justify-between text-xs font-black uppercase text-spes-black/60 dark:text-white/60">
              <span>Disbursed: <span class="batch-paid-val font-mono tabular-nums font-bold text-spes-black dark:text-white" data-target="${batch.totalPaid}">₱0.00</span></span>
              <span class="batch-progress-val text-emerald-600 dark:text-emerald-400 font-mono font-bold" data-target="${progress}">0%</span>
            </div>
            <div class="h-2.5 w-full overflow-hidden bg-gray-200 dark:bg-black/40">
              <div class="h-full bg-emerald-500 transition-all duration-500" style="width: ${progress}%"></div>
            </div>
          </div>

          <!-- Stats Mini Grid with Neutral Fills & Literal Number Fonts -->
          <div class="mt-4 grid grid-cols-3 gap-2.5 text-center">
            <div class="rounded-none bg-slate-100 dark:bg-[#141D26] p-3 border border-slate-300 dark:border-white/10">
              <span class="block text-xs font-black uppercase tracking-wider text-spes-black/70 dark:text-white/70">TOTAL</span>
              <span class="batch-stat-count font-mono font-black text-lg sm:text-xl text-spes-black dark:text-white tabular-nums" data-target="${totalCount}">0</span>
            </div>
            <div class="rounded-none bg-emerald-50 dark:bg-emerald-950/40 p-3 border border-emerald-300 dark:border-emerald-500/40">
              <span class="block text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">PAID</span>
              <span class="batch-stat-count font-mono font-black text-lg sm:text-xl text-emerald-700 dark:text-emerald-300 tabular-nums" data-target="${paidCount}">0</span>
            </div>
            <div class="rounded-none bg-amber-50 dark:bg-amber-950/40 p-3 border border-amber-300 dark:border-amber-500/40">
              <span class="block text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">PENDING</span>
              <span class="batch-stat-count font-mono font-black text-lg sm:text-xl text-amber-700 dark:text-amber-300 tabular-nums" data-target="${pendingCount}">0</span>
            </div>
          </div>
        </div>

        <!-- Action Card Footer -->
        <div class="mt-5 pt-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-between">
          <span class="text-xs font-mono font-extrabold uppercase tracking-wider text-spes-black/60 dark:text-white/60 tabular-nums">
            Records ${batch.startIndex + 1}–${batch.endIndex}
          </span>
          <div class="inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow group-hover:translate-x-1 transition-transform">
            <span>View Roster</span>
            <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>

      </div>
    `;
  }).join("");

  const batchDuration = isFirstVisit ? 1500 : 650;
  const baseDelay = isFirstVisit ? 150 : 0;
  const stepDelay = isFirstVisit ? 35 : 10;

  // Animate batch cards metrics with adaptive delays
  grid.querySelectorAll(".batch-principal-val").forEach((el, idx) => {
    animateCounter(el, Number(el.dataset.target) || 0, { isCurrency: true, duration: batchDuration, delay: baseDelay + Math.min(idx * stepDelay, 300), forceFromZero: true });
  });
  grid.querySelectorAll(".batch-paid-val").forEach((el, idx) => {
    animateCounter(el, Number(el.dataset.target) || 0, { isCurrency: true, duration: batchDuration, delay: baseDelay + 40 + Math.min(idx * stepDelay, 300), forceFromZero: true });
  });
  grid.querySelectorAll(".batch-progress-val").forEach((el, idx) => {
    animateCounter(el, Number(el.dataset.target) || 0, { suffix: "%", duration: batchDuration - 100, delay: baseDelay + 60 + Math.min(idx * stepDelay, 300), forceFromZero: true });
  });
  grid.querySelectorAll(".batch-stat-count").forEach((el, idx) => {
    animateCounter(el, Number(el.dataset.target) || 0, { duration: batchDuration - 100, delay: baseDelay + Math.min(idx * stepDelay, 300), forceFromZero: true });
  });

  grid.querySelectorAll(".batch-card").forEach(card => {
    card.addEventListener("click", () => {
      const idx = Number(card.dataset.batchIdx) || card.dataset.batchIdx;
      const batchName = card.dataset.batchName;
      switchToBeneficiariesView(idx, batchName);
    });
  });
}
// --- END: RENDER VIEW 2 (SQUARE-TYPE 50-RECORD CHUNKED BATCHES & ET. AL) ---

// --- START: RENDER VIEW 3 (INDIVIDUAL BENEFICIARY PAYROLL TABLE WITH LARGER FONTS) ---
function switchToBeneficiariesView(batchIndex, batchName, updateUrl = true) {
  currentView = "beneficiaries";
  selectedBatchIndex = batchIndex;
  selectedBatchTitle = batchName;
  currentPage = 1;
  selectedBeneficiaryIds.clear();

  const titleEl = document.getElementById("payroll-table-title");
  if (titleEl) {
    titleEl.textContent = `${selectedOfficeName.toUpperCase()} — ${batchName.toUpperCase()} ROSTER`;
  }

  // Ensure Back Button is visible
  const backBtn = document.getElementById("btn-back-to-payroll-implementors");
  if (backBtn) {
    backBtn.classList.remove("hidden");
    backBtn.classList.add("inline-flex");
  }

  const implView = document.getElementById("payroll-implementors-view");
  const batchView = document.getElementById("payroll-batches-view");
  const beneView = document.getElementById("payroll-beneficiaries-view");
  const pagination = document.getElementById("payroll-pagination");

  if (implView) implView.classList.add("hidden");
  if (batchView) batchView.classList.add("hidden");
  if (beneView) beneView.classList.remove("hidden");
  if (pagination) pagination.classList.remove("hidden");

  updateBulkDisburseButtonState();
  if (updateUrl) syncUrlState(false);

  applyBeneficiaryFiltersAndRender();
}

function applyBeneficiaryFiltersAndRender() {
  const searchQ = (document.getElementById("payroll-search-input")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("payroll-status-filter")?.value || "all";

  const targetBatch = currentOfficeBatches.find(b => 
    b.batchIndex === selectedBatchIndex ||
    b.batchId === selectedBatchIndex ||
    String(b.batchName).toLowerCase() === String(selectedBatchTitle || "").toLowerCase()
  );
  let list = targetBatch ? targetBatch.beneficiaries : [];

  if (statusFilter !== "all") {
    list = list.filter(b => (b.payroll?.payment_status || "PENDING") === statusFilter);
  }

  if (searchQ) {
    list = list.filter(b => {
      const name = String(b.full_name || "").toLowerCase();
      const id = String(b.id || "").toLowerCase();
      const period = String(b.payroll?.contract_period || "").toLowerCase();
      const status = String(b.return_status || "").toLowerCase();
      return name.includes(searchQ) || id.includes(searchQ) || period.includes(searchQ) || status.includes(searchQ);
    });
  }

  filteredBeneficiaries = list;
  renderBeneficiariesPaginatedTable();
}

function renderBeneficiariesPaginatedTable(isFirstVisit = false) {
  const tbody = document.getElementById("payroll-beneficiaries-tbody");
  if (!tbody) return;

  const searchQ = (document.getElementById("payroll-search-input")?.value || "").trim().toLowerCase();

  const total = filteredBeneficiaries.length;
  const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE));
  currentPage = Math.min(totalPages, Math.max(1, currentPage));

  const start = (currentPage - 1) * ROWS_PER_PAGE;
  const end = start + ROWS_PER_PAGE;
  const pageItems = filteredBeneficiaries.slice(start, end);

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-16 text-sm font-bold uppercase tracking-wider text-spes-black/40 dark:text-white/40">
          No payroll records match the criteria.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = pageItems.map((b) => {
      const p = b.payroll || {};
      const isSelected = selectedBeneficiaryIds.has(String(b.id));
      const isPaid = p.payment_status === "PAID";
      const isPending = p.payment_status === "PENDING";

      const datePaidFormatted = isPaid && p.date_paid ? formatPhilippineTimestamp(p.date_paid) : "";
      const tooltipText = isPaid
        ? (datePaidFormatted ? `Disbursed on: ${datePaidFormatted}` : `Disbursed to Beneficiary (PAID)`)
        : "";

      const statusBadge = isPaid
        ? `<span class="group/status relative inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400 cursor-help transition-all duration-200 hover:bg-emerald-500/25 hover:shadow-md hover:shadow-emerald-500/20"
             title="${escHtml(tooltipText)}">
             <span class="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
             PAID
             ${datePaidFormatted ? `
             <div role="tooltip" class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 invisible opacity-0 group-hover/status:visible group-hover/status:opacity-100 transition-all duration-200 whitespace-nowrap rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white shadow-2xl dark:bg-slate-800 border border-emerald-500/30 flex items-center gap-2">
               <svg class="h-4 w-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
               </svg>
               <div>
                 <span class="text-[10px] uppercase tracking-wider text-emerald-400 font-black block">Disbursement Timestamp</span>
                 <span class="font-mono text-white text-xs">${escHtml(datePaidFormatted)}</span>
               </div>
               <div class="absolute -bottom-1 left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></div>
             </div>` : ''}
           </span>`
        : isPending
        ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-600 dark:text-amber-400 transition-all duration-200">
             <span class="h-2 w-2 rounded-full bg-amber-500"></span>
             PENDING
           </span>`
        : `<span class="inline-flex items-center gap-1.5 rounded-full bg-gray-500/15 px-3 py-1 text-xs font-black text-gray-600 dark:text-gray-400 transition-all duration-200">
             <span class="h-2 w-2 rounded-full bg-gray-400"></span>
             UNPAID
           </span>`;

      const studentStatusBadge = String(b.return_status || "NEW").toUpperCase() === "SPES BABY"
        ? `<span class="ml-2 inline-flex items-center rounded bg-red-500/10 px-2 py-0.5 text-xs font-black text-red-600 dark:text-red-400 uppercase">SPES Baby</span>`
        : `<span class="ml-2 inline-flex items-center rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-black text-emerald-600 dark:text-emerald-400 uppercase">New</span>`;

      const highlightMatchedRow = searchQ ? "bg-amber-400/10 dark:bg-amber-400/10 ring-2 ring-amber-400/50 dark:ring-amber-400/50" : "";

      return `
        <tr class="beneficiary-row cursor-pointer border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary hover:bg-spes-blue/5 dark:hover:bg-spes-yellow/5 transition-all duration-300 text-sm sm:text-base ${highlightMatchedRow}"
            data-bene-id="${b.id}">
          <td class="p-5 text-center" onclick="event.stopPropagation()">
            <input type="checkbox" data-checkbox-bene-id="${b.id}" ${isSelected ? "checked" : ""}
              class="payroll-row-checkbox h-5 w-5 cursor-pointer rounded-full border-spes-blue/25 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/25 dark:bg-spes-dark-secondary dark:text-spes-yellow" />
          </td>
          <td class="px-6 py-5 font-black text-base text-spes-black dark:text-white uppercase whitespace-nowrap">
            <span class="hover:underline hover:text-spes-blue dark:hover:text-spes-yellow">${highlightMatchText(b.full_name || "—", searchQ)}</span>
            ${studentStatusBadge}
          </td>
          <td class="px-6 py-5 text-center font-bold text-sm text-spes-blue dark:text-spes-yellow whitespace-nowrap uppercase">
            ${highlightMatchText(p.contract_period || "JULY 2026", searchQ)}
          </td>
          <td class="px-6 py-5 text-right font-bold text-sm text-spes-black dark:text-white whitespace-nowrap tabular-nums">
            <span class="bene-days-val" data-target="${p.days_worked || DEFAULT_WORK_DAYS}">${p.days_worked || DEFAULT_WORK_DAYS}</span> Days
          </td>
          <td class="px-6 py-5 text-right font-black text-base text-spes-black dark:text-white whitespace-nowrap tabular-nums">
            <span class="bene-stipend-val" data-target="${p.stipend_amount || DEFAULT_STIPEND_RATE}">₱0.00</span>
          </td>
          <td class="px-6 py-5 text-center whitespace-nowrap">
            ${statusBadge}
          </td>
          <td class="px-6 py-5 text-center whitespace-nowrap" onclick="event.stopPropagation()">
            <div class="inline-flex items-center gap-2">
              <button type="button" class="btn-quick-edit-row cursor-pointer rounded-xl p-2 text-spes-blue hover:bg-spes-blue/10 dark:text-spes-yellow dark:hover:bg-spes-yellow/10 transition-colors" title="Edit Payroll Record in Drawer">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button type="button" class="btn-toggle-pay-row cursor-pointer rounded-xl p-2 ${isPaid ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-500/10'} transition-colors" title="${isPaid ? 'Mark as Pending / Unpaid' : 'Quick Disburse / Mark Paid'}">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    const rosterDuration = isFirstVisit ? 1000 : 500;
    const rosterDelay = isFirstVisit ? 20 : 10;

    // Animate stipend amounts and days in roster table with smooth roll
    tbody.querySelectorAll(".bene-days-val").forEach((el, idx) => {
      const target = Number(el.dataset.target) || 0;
      animateCounter(el, target, { duration: rosterDuration, delay: Math.min(idx * rosterDelay, 250), forceFromZero: true });
    });
    tbody.querySelectorAll(".bene-stipend-val").forEach((el, idx) => {
      const target = Number(el.dataset.target) || 0;
      animateCounter(el, target, { isCurrency: true, duration: rosterDuration + 100, delay: Math.min(idx * rosterDelay, 250), forceFromZero: true });
    });
  }

  // Sync Select All checkbox state (checked, unchecked, or indeterminate)
  const selectAllCb = document.getElementById("payroll-checkbox-all");
  if (selectAllCb) {
    const totalFiltered = filteredBeneficiaries.length;
    const selectedInFiltered = filteredBeneficiaries.filter(b => selectedBeneficiaryIds.has(String(b.id))).length;
    if (totalFiltered > 0 && selectedInFiltered === totalFiltered) {
      selectAllCb.checked = true;
      selectAllCb.indeterminate = false;
    } else if (selectedInFiltered > 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = true;
    } else {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
    }
  }

  // Update pagination info
  const rangeEl = document.getElementById("payroll-pagination-range");
  const totalEl = document.getElementById("payroll-pagination-total");
  if (rangeEl) rangeEl.textContent = total === 0 ? "0" : `${start + 1}–${Math.min(end, total)}`;
  if (totalEl) totalEl.textContent = total.toLocaleString();

  updatePaginationIndicators(total);
  updateBulkDisburseButtonState();
  wireTableActions();
}
// --- END: RENDER VIEW 3 (INDIVIDUAL BENEFICIARY PAYROLL TABLE WITH LARGER FONTS) ---

// --- START: WIRE TABLE ACTIONS (ROW CLICK = VIEW, EDIT ICON = EDIT) ---
function wireTableActions() {
  const tbody = document.getElementById("payroll-beneficiaries-tbody");
  if (!tbody) return;

  // 1. Checkbox row toggles
  tbody.querySelectorAll(".payroll-row-checkbox").forEach(cb => {
    cb.addEventListener("change", () => {
      const bId = String(cb.dataset.checkboxBeneId);
      if (cb.checked) {
        selectedBeneficiaryIds.add(bId);
      } else {
        selectedBeneficiaryIds.delete(bId);
      }
      updateBulkDisburseButtonState();
    });
  });

  // 2. Row Click -> Opens VIEW ONLY MODE in Drawer
  tbody.querySelectorAll(".beneficiary-row").forEach(row => {
    row.addEventListener("click", () => {
      const bId = row.dataset.beneId;
      const bene = allBeneficiaries.find(b => String(b.id) === String(bId));
      if (bene) openPayrollDrawer(bene, "view");
    });
  });

  // 3. Edit Icon Click -> Opens EDIT MODE in Drawer
  tbody.querySelectorAll(".btn-quick-edit-row").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = btn.closest("tr");
      const bId = row.dataset.beneId;
      const bene = allBeneficiaries.find(b => String(b.id) === String(bId));
      if (bene) openPayrollDrawer(bene, "edit");
    });
  });

  // 4. Quick Toggle Payment Status
  tbody.querySelectorAll(".btn-toggle-pay-row").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const row = btn.closest("tr");
      const bId = row.dataset.beneId;
      const bene = allBeneficiaries.find(b => String(b.id) === String(bId));
      if (!bene) return;

      const currentStatus = bene.payroll?.payment_status || "PENDING";
      const nextStatus = currentStatus === "PAID" ? "PENDING" : "PAID";
      const nowStr = new Date().toISOString();
      const nextDatePaid = nextStatus === "PAID" ? nowStr : null;
      const session = getSession();

      await updateBeneficiaryPayrollRecord(bene.id, {
        payment_status: nextStatus,
        date_paid: nextDatePaid,
        updated_by: session?.id || null,
      }, bene.staffs?.office_id || null);

      bene.payroll.payment_status = nextStatus;
      bene.payroll.date_paid = nextDatePaid;

      const timestampLog = nextStatus === "PAID" ? ` (Logged: ${formatPhilippineTimestamp(nowStr)})` : "";
      modals.flowbiteToast(
        "Payroll Updated",
        `${bene.full_name} status is now ${nextStatus}.${timestampLog}`,
        nextStatus === "PAID" ? "success" : "warning"
      );

      updateExecutiveSummaryCards(allBeneficiaries);
      applyBeneficiaryFiltersAndRender();
    });
  });
}
// --- END: WIRE TABLE ACTIONS (ROW CLICK = VIEW, EDIT ICON = EDIT) ---

// --- START: OFFCANVAS DRAWER VIEW / EDIT LOGIC ---
function openPayrollDrawer(beneficiary, mode = "view") {
  const overlay = document.getElementById("drawer-payroll-edit-overlay");
  const drawer = document.getElementById("drawer-payroll-edit");
  if (!drawer || !overlay) return;

  currentActiveBeneficiary = beneficiary;
  const p = beneficiary.payroll || {};

  const viewContainer = document.getElementById("pd-view-container");
  const editForm = document.getElementById("form-payroll-drawer");
  const titleEl = document.getElementById("drawer-payroll-title");
  const subtitleEl = document.getElementById("drawer-payroll-subtitle");
  const saveBtn = document.getElementById("btn-save-payroll-drawer");

  const footer = document.getElementById("drawer-payroll-footer");

  if (mode === "view") {
    // Populate View fields
    titleEl.textContent = "Payroll Disbursement Details";
    subtitleEl.textContent = "Review individual beneficiary stipend and payment record.";
    
    document.getElementById("pd-view-student-name").textContent = beneficiary.full_name || "—";
    document.getElementById("pd-view-contract-period").textContent = p.contract_period || "JULY 2026";
    document.getElementById("pd-view-return-status").textContent = beneficiary.return_status || "NEW";
    document.getElementById("pd-view-stipend-amount").textContent = formatCurrency(p.stipend_amount || DEFAULT_STIPEND_RATE);
    document.getElementById("pd-view-days-worked").textContent = `${p.days_worked || DEFAULT_WORK_DAYS} Days`;
    document.getElementById("pd-view-notes").textContent = p.notes || "No notes recorded.";

    const pStatus = p.payment_status || "PENDING";
    const datePaidFormatted = pStatus === "PAID" && p.date_paid ? formatPhilippineTimestamp(p.date_paid) : null;

    const statusBadgeHtml = pStatus === "PAID"
      ? `<div>
           <span class="inline-flex items-center gap-1.5 rounded-none bg-emerald-500/15 px-3.5 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
             <span class="h-2 w-2 rounded-full bg-emerald-500"></span> PAID (Disbursed)
           </span>
           ${datePaidFormatted ? `
           <p class="mt-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
             <svg class="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
             </svg>
             Logged: <span class="font-mono">${escHtml(datePaidFormatted)}</span>
           </p>` : ''}
         </div>`
      : pStatus === "PENDING"
      ? `<span class="inline-flex items-center gap-1.5 rounded-none bg-amber-500/15 px-3.5 py-1 text-xs font-black text-amber-600 dark:text-amber-400 border border-amber-500/20">
           <span class="h-2 w-2 rounded-full bg-amber-500"></span> PENDING (In Processing)
         </span>`
      : `<span class="inline-flex items-center gap-1.5 rounded-none bg-gray-500/15 px-3.5 py-1 text-xs font-black text-gray-600 dark:text-gray-400 border border-gray-500/20">
           <span class="h-2 w-2 rounded-full bg-gray-400"></span> UNPAID
         </span>`;
    document.getElementById("pd-view-payment-status").innerHTML = statusBadgeHtml;

    viewContainer.classList.remove("hidden");
    editForm.classList.add("hidden");
    saveBtn.classList.add("hidden");
    if (footer) {
      footer.classList.add("hidden");
      footer.classList.remove("flex");
    }
  } else {
    // Populate Edit fields
    titleEl.textContent = "Edit Payroll Record";
    subtitleEl.textContent = "Update stipend amount, days rendered, and payment status.";

    document.getElementById("pd-beneficiary-id").value = beneficiary.id;
    document.getElementById("pd-student-name").textContent = beneficiary.full_name || "—";
    document.getElementById("pd-contract-period").textContent = p.contract_period || "JULY 2026";
    const rawStipend = p.stipend_amount || DEFAULT_STIPEND_RATE;
    document.getElementById("pd-stipend-amount").value = formatNumberWithCommas(rawStipend, true);
    document.getElementById("pd-days-worked").value = p.days_worked || DEFAULT_WORK_DAYS;
    document.getElementById("pd-notes").value = p.notes || "";
    
    // Set 3-Grid Payment Status Buttons State
    setPayrollDrawerStatus(p.payment_status || "PENDING");

    viewContainer.classList.add("hidden");
    editForm.classList.remove("hidden");
    saveBtn.classList.remove("hidden");
    saveBtn.classList.add("inline-flex");
    if (footer) {
      footer.classList.remove("hidden");
      footer.classList.add("flex");
    }
  }

  // Animate open
  overlay.classList.remove("hidden");
  drawer.classList.remove("hidden");
  requestAnimationFrame(() => {
    overlay.classList.remove("opacity-0");
    drawer.classList.remove("translate-y-full", "sm:translate-x-full");
  });
}

function closePayrollDrawer() {
  const overlay = document.getElementById("drawer-payroll-edit-overlay");
  const drawer = document.getElementById("drawer-payroll-edit");
  if (!drawer || !overlay) return;

  overlay.classList.add("opacity-0");
  drawer.classList.add("translate-y-full", "sm:translate-x-full");

  setTimeout(() => {
    overlay.classList.add("hidden");
    drawer.classList.add("hidden");
  }, 300);
}

// --- START: SET PAYROLL DRAWER PAYMENT STATUS BUTTON STATE ---
function setPayrollDrawerStatus(status = "PENDING") {
  const normalizedStatus = (status || "PENDING").toUpperCase();
  const hiddenInput = document.getElementById("pd-payment-status");
  if (hiddenInput) hiddenInput.value = normalizedStatus;

  const btnPaid = document.getElementById("pd-status-btn-paid");
  const btnPending = document.getElementById("pd-status-btn-pending");
  const btnUnpaid = document.getElementById("pd-status-btn-unpaid");

  const configs = [
    {
      btn: btnPaid,
      val: "PAID",
      activeClasses: [
        "bg-emerald-600",
        "border-emerald-600",
        "text-white",
        "shadow-lg",
        "shadow-emerald-600/25",
        "ring-2",
        "ring-emerald-500/40",
        "dark:bg-emerald-600",
        "dark:border-emerald-500"
      ],
      inactiveClasses: [
        "bg-emerald-50/50",
        "border-emerald-200/60",
        "text-emerald-800",
        "hover:bg-emerald-100/70",
        "hover:border-emerald-400",
        "dark:bg-emerald-950/20",
        "dark:border-emerald-500/25",
        "dark:text-emerald-300",
        "dark:hover:bg-emerald-900/30"
      ],
      dotActive: "bg-white",
      dotInactive: "bg-emerald-500"
    },
    {
      btn: btnPending,
      val: "PENDING",
      activeClasses: [
        "bg-amber-500",
        "border-amber-500",
        "text-white",
        "shadow-lg",
        "shadow-amber-500/25",
        "ring-2",
        "ring-amber-400/40",
        "dark:bg-amber-600",
        "dark:border-amber-500"
      ],
      inactiveClasses: [
        "bg-amber-50/50",
        "border-amber-200/60",
        "text-amber-800",
        "hover:bg-amber-100/70",
        "hover:border-amber-400",
        "dark:bg-amber-950/20",
        "dark:border-amber-500/25",
        "dark:text-amber-400",
        "dark:hover:bg-amber-900/30"
      ],
      dotActive: "bg-white",
      dotInactive: "bg-amber-500"
    },
    {
      btn: btnUnpaid,
      val: "UNPAID",
      activeClasses: [
        "bg-slate-700",
        "border-slate-800",
        "text-white",
        "shadow-lg",
        "shadow-slate-700/25",
        "ring-2",
        "ring-slate-500/40",
        "dark:bg-slate-600",
        "dark:border-slate-500"
      ],
      inactiveClasses: [
        "bg-slate-100/60",
        "border-slate-200",
        "text-slate-700",
        "hover:bg-slate-200/70",
        "hover:border-slate-300",
        "dark:bg-slate-800/30",
        "dark:border-white/10",
        "dark:text-slate-300",
        "dark:hover:bg-slate-800/60"
      ],
      dotActive: "bg-white",
      dotInactive: "bg-slate-400"
    }
  ];

  configs.forEach(c => {
    if (!c.btn) return;
    const isSelected = c.val === normalizedStatus;
    const dot = c.btn.querySelector(".pd-status-dot");

    c.activeClasses.forEach(cls => c.btn.classList.toggle(cls, isSelected));
    c.inactiveClasses.forEach(cls => c.btn.classList.toggle(cls, !isSelected));

    if (dot) {
      dot.classList.toggle(c.dotActive, isSelected);
      dot.classList.toggle(c.dotInactive, !isSelected);
    }
  });
}
// --- END: SET PAYROLL DRAWER PAYMENT STATUS BUTTON STATE ---
// --- END: OFFCANVAS DRAWER VIEW / EDIT LOGIC ---

// --- START: PAGINATION CONTROLS & INDICATORS ---
function updatePaginationIndicators(totalCount) {
  const indicatorsEl = document.getElementById("payroll-page-indicators");
  if (!indicatorsEl) return;

  const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE));
  let html = "";

  for (let p = 1; p <= totalPages; p++) {
    if (totalPages > 6 && p > 3 && p < totalPages - 1) {
      if (p === 4) html += `<li class="px-2 text-xs font-bold text-spes-black/40 dark:text-white/40">...</li>`;
      continue;
    }
    const isActive = p === currentPage;
    const activeClass = isActive
      ? "bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue font-black"
      : "bg-white text-spes-black hover:bg-spes-blue/10 dark:bg-spes-dark-primary dark:text-white dark:hover:bg-white/10 font-bold border border-gray-200 dark:border-white/10";

    html += `
      <li>
        <button type="button" class="cursor-pointer page-indicator-btn h-9 min-w-9 rounded-xl px-2.5 text-xs sm:text-sm transition-colors ${activeClass}" data-page="${p}">
          ${p}
        </button>
      </li>
    `;
  }

  indicatorsEl.innerHTML = html;

  indicatorsEl.querySelectorAll(".page-indicator-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentPage = Number(btn.dataset.page) || 1;
      renderBeneficiariesPaginatedTable();
    });
  });
}
// --- END: PAGINATION CONTROLS & INDICATORS ---

// --- START: EXPORT PAYROLL REPORT SUMMARY ---
function exportPayrollReport(e) {
  if (e) {
    e.preventDefault();
  }
  updatePayrollExportData({
    allBeneficiaries,
    allOffices,
    formatCurrency,
    formatPhilippineTimestamp
  });
  openPayrollExportModal(selectedOfficeId || null);
}
// --- END: EXPORT PAYROLL REPORT SUMMARY ---
// --- START: SKELETON LOADERS ---
function renderImplementorsSkeleton() {
  const tbody = document.getElementById("payroll-implementors-tbody");
  if (!tbody) return;
  tbody.innerHTML = `
    <tr class="animate-pulse border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary">
      <td class="px-6 py-5"><div class="h-4 w-48 rounded bg-gray-200 dark:bg-white/10"></div><div class="mt-2 h-3 w-32 rounded bg-gray-100 dark:bg-white/5"></div></td>
      <td class="px-6 py-5"><div class="h-4 w-36 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-center"><div class="mx-auto h-6 w-16 rounded-full bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
    </tr>
    <tr class="animate-pulse border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary">
      <td class="px-6 py-5"><div class="h-4 w-44 rounded bg-gray-200 dark:bg-white/10"></div><div class="mt-2 h-3 w-28 rounded bg-gray-100 dark:bg-white/5"></div></td>
      <td class="px-6 py-5"><div class="h-4 w-32 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-center"><div class="mx-auto h-6 w-16 rounded-full bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-24 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-24 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-24 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-24 rounded bg-gray-200 dark:bg-white/10"></div></td>
    </tr>
    <tr class="animate-pulse border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary">
      <td class="px-6 py-5"><div class="h-4 w-52 rounded bg-gray-200 dark:bg-white/10"></div><div class="mt-2 h-3 w-36 rounded bg-gray-100 dark:bg-white/5"></div></td>
      <td class="px-6 py-5"><div class="h-4 w-40 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-center"><div class="mx-auto h-6 w-16 rounded-full bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
      <td class="px-6 py-5 text-right"><div class="ml-auto h-4 w-28 rounded bg-gray-200 dark:bg-white/10"></div></td>
    </tr>
  `;
}
// --- END: SKELETON LOADERS ---

// --- START: UPDATE BULK DISBURSE ACTION BUTTON STATE ---
function updateBulkDisburseButtonState() {
  const btn = document.getElementById("btn-bulk-disburse");
  const labelEl = document.getElementById("btn-bulk-disburse-label");
  const iconEl = document.getElementById("btn-bulk-disburse-icon");
  const editDataBtn = document.getElementById("btn-toggle-inline-edit");

  // Edit Data button: STRICTLY visible only in View 1 (Implementors Root View)
  if (editDataBtn) {
    if (currentView === "implementors") {
      editDataBtn.classList.remove("hidden");
      editDataBtn.classList.add("inline-flex");
    } else {
      editDataBtn.classList.add("hidden");
      editDataBtn.classList.remove("inline-flex");
      if (isInlineEditMode) toggleInlineEditMode(false);
    }
  }

  if (!btn) return;

  // Only visible when in View 3 (Beneficiary Roster)
  if (currentView !== "beneficiaries") {
    btn.classList.add("hidden");
    btn.classList.remove("inline-flex");
    return;
  }

  btn.classList.remove("hidden");
  btn.classList.add("inline-flex");

  const selectedItems = allBeneficiaries.filter(b => selectedBeneficiaryIds.has(String(b.id)));
  const count = selectedItems.length;

  if (count > 0) {
    btn.disabled = false;
    btn.removeAttribute("disabled");
    btn.classList.remove("opacity-40", "cursor-not-allowed", "pointer-events-none");
    btn.classList.add("cursor-pointer");

    // Auto-detect: if ALL selected beneficiaries are already marked as PAID, switch button to Pending/Unpaid
    const allSelectedArePaid = selectedItems.every(b => (b.payroll?.payment_status || "PENDING") === "PAID");

    if (allSelectedArePaid) {
      // Morph button to Amber / UNPAID (Revert to Pending)
      btn.dataset.batchMode = "pending";
      btn.className = "cursor-pointer inline-flex items-center justify-center gap-2 rounded-none border border-amber-500/50 bg-amber-600 px-4 sm:px-5 py-2.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider sm:tracking-widest text-white shadow-lg transition-all duration-300 hover:rounded-xl hover:bg-amber-500 hover:border-amber-400 hover:shadow-amber-500/30 active:scale-95";
      if (labelEl) labelEl.textContent = `Mark Selected (${count}) Pending`;
      if (iconEl) {
        iconEl.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />`;
      }
    } else {
      // Morph button to Emerald / MARK PAID
      btn.dataset.batchMode = "paid";
      btn.className = "cursor-pointer inline-flex items-center justify-center gap-2 rounded-none border border-emerald-500/50 bg-emerald-600 px-4 sm:px-5 py-2.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider sm:tracking-widest text-white shadow-lg transition-all duration-300 hover:rounded-xl hover:bg-emerald-500 hover:border-emerald-400 hover:shadow-emerald-500/30 active:scale-95";
      if (labelEl) labelEl.textContent = `Mark Selected (${count}) Paid`;
      if (iconEl) {
        iconEl.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />`;
      }
    }
  } else {
    btn.disabled = true;
    btn.setAttribute("disabled", "true");
    btn.dataset.batchMode = "paid";
    btn.className = "hidden items-center justify-center gap-2 rounded-none border border-emerald-500/50 bg-emerald-600 px-4 sm:px-5 py-2.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider sm:tracking-widest text-white shadow-lg transition-all duration-300 hover:rounded-xl hover:bg-emerald-500 hover:border-emerald-400 hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none inline-flex";
    if (labelEl) labelEl.textContent = "Mark Batch Paid";
    if (iconEl) {
      iconEl.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />`;
    }
  }
}
// --- END: UPDATE BULK DISBURSE ACTION BUTTON STATE ---

// --- START: TOGGLE INLINE EDIT MODE FOR PAYROLL DIRECTORY & BUDGET ---
function toggleInlineEditMode(forceActive = null) {
  isInlineEditMode = forceActive !== null ? forceActive : !isInlineEditMode;

  const btnToggle = document.getElementById("btn-toggle-inline-edit");
  const labelEl = document.getElementById("btn-toggle-inline-edit-label");
  const iconEl = document.getElementById("icon-inline-edit");
  const displayBudgetContainer = document.getElementById("stat-total-budget-display-container");
  const editBudgetContainer = document.getElementById("stat-total-budget-edit-container");
  const inputBudget = document.getElementById("input-edit-total-budget");

  if (isInlineEditMode) {
    isBudgetCardEditing = true;
    allOffices.forEach(o => editingOfficeIds.add(String(o.id)));

    // Switch button to "SAVE DATA"
    if (labelEl) labelEl.textContent = "Save Data";
    if (btnToggle) {
      btnToggle.className = "cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-none border border-emerald-400 bg-emerald-600 px-4 py-2.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider text-white shadow-lg transition-all duration-300 hover:rounded-xl hover:bg-emerald-500 active:scale-95";
    }
    if (iconEl) {
      iconEl.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" />`;
    }

    if (displayBudgetContainer) displayBudgetContainer.classList.add("hidden");
    if (editBudgetContainer) {
      editBudgetContainer.classList.remove("hidden");
      if (inputBudget) {
        const customBudget = customGeneralBudget;
        const stats = computePayrollExecutiveSummary(allBeneficiaries, customBudget);
        inputBudget.value = formatNumberWithCommas(stats.totalBudget, true);
        inputBudget.focus();
      }
    }
  } else {
    isBudgetCardEditing = false;
    editingOfficeIds.clear();

    // Revert button to "EDIT DATA"
    if (labelEl) labelEl.textContent = "Edit Data";
    if (btnToggle) {
      btnToggle.className = "cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-none border border-cyan-400/40 bg-cyan-900/30 px-4 py-2.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider text-cyan-100 shadow-md transition-all duration-300 hover:rounded-xl hover:bg-cyan-600 hover:border-cyan-500 hover:text-white hover:shadow-lg hover:shadow-cyan-600/30 active:scale-95";
    }
    if (iconEl) {
      iconEl.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />`;
    }

    if (displayBudgetContainer) displayBudgetContainer.classList.remove("hidden");
    if (editBudgetContainer) editBudgetContainer.classList.add("hidden");
  }

  // Re-render implementors table to show/hide inline edit inputs
  renderImplementorsView(false, false);
}

function checkAndSyncEditModeState() {
  if (editingOfficeIds.size === 0 && !isBudgetCardEditing) {
    isInlineEditMode = false;
    const btnToggle = document.getElementById("btn-toggle-inline-edit");
    const labelEl = document.getElementById("btn-toggle-inline-edit-label");
    const iconEl = document.getElementById("icon-inline-edit");
    if (labelEl) labelEl.textContent = "Edit Data";
    if (btnToggle) {
      btnToggle.className = "cursor-pointer inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-none border border-cyan-400/40 bg-cyan-900/30 px-4 py-2.5 text-center text-xs sm:text-sm font-black uppercase tracking-wider text-cyan-100 shadow-md transition-all duration-300 hover:rounded-xl hover:bg-cyan-600 hover:border-cyan-500 hover:text-white hover:shadow-lg hover:shadow-cyan-600/30 active:scale-95";
    }
    if (iconEl) {
      iconEl.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />`;
    }
  }
}

function saveInlineDataChanges() {
  let hasChanges = false;
  const session = getSession();

  if (isBudgetCardEditing) {
    const inputBudget = document.getElementById("input-edit-total-budget");
    const newBudgetVal = inputBudget ? parseNumberFromCommas(inputBudget.value) : null;
    const prevCustomBudget = customGeneralBudget;

    if (newBudgetVal !== null && Number.isFinite(newBudgetVal) && newBudgetVal > 0) {
      if (newBudgetVal !== prevCustomBudget) {
        customGeneralBudget = newBudgetVal;
        preferenceStorage.saveCustomGeneralBudget(newBudgetVal);
        upsertDbPayrollBudget(null, newBudgetVal, session?.id);
        hasChanges = true;
      }
    }
  }

  // Collect all currently open office row edits
  document.querySelectorAll(".input-edit-office-budget").forEach(input => {
    const officeId = input.dataset.officeId;
    const val = parseNumberFromCommas(input.value);
    if (officeId && Number.isFinite(val) && val >= 0) {
      customOfficeBudgets[String(officeId)] = val;
      preferenceStorage.saveCustomOfficeBudget(officeId, val);
      upsertDbPayrollBudget(officeId, val, session?.id);
      hasChanges = true;
    }
  });

  toggleInlineEditMode(false);
  updateExecutiveSummaryCards(allBeneficiaries);
  renderImplementorsView(false, false);

  if (hasChanges) {
    modals.flowbiteToast("Data Saved", "All active budget modifications saved successfully.", "success");
  } else {
    modals.flowbiteToast("No Changes", "Budget allocation remains unchanged.", "info");
  }
}
// --- END: TOGGLE INLINE EDIT MODE FOR PAYROLL DIRECTORY & BUDGET ---

// --- START: SYNC AND RESTORE VIEW STATE WITH URL QUERY PARAMETERS ---
function syncUrlState(replace = false) {
  const url = new URL(window.location);
  if (currentView === "implementors") {
    url.searchParams.delete("office");
    url.searchParams.delete("batch");
  } else if (currentView === "batches") {
    if (selectedOfficeId) url.searchParams.set("office", selectedOfficeId);
    url.searchParams.delete("batch");
  } else if (currentView === "beneficiaries") {
    if (selectedOfficeId) url.searchParams.set("office", selectedOfficeId);
    if (selectedBatchIndex !== null && selectedBatchIndex !== undefined) {
      url.searchParams.set("batch", selectedBatchIndex);
    }
  }

  const queryStr = url.searchParams.toString();
  const newUrl = url.pathname + (queryStr ? `?${queryStr}` : "");
  if (replace) {
    window.history.replaceState({ view: currentView, officeId: selectedOfficeId, batchIdx: selectedBatchIndex }, "", newUrl);
  } else {
    window.history.pushState({ view: currentView, officeId: selectedOfficeId, batchIdx: selectedBatchIndex }, "", newUrl);
  }
}

// --- START: SYNC AND RESTORE VIEW STATE WITH URL QUERY PARAMETERS ---
function restoreViewFromUrl(isFirstVisit = false) {
  const params = new URLSearchParams(window.location.search);
  const officeParam = params.get("office");
  const batchParam = params.get("batch");

  if (!officeParam) {
    renderImplementorsView(isFirstVisit, false);
    return;
  }

  // Find office by ID or name
  const foundOffice = allOffices.find(o => 
    String(o.id) === String(officeParam) || 
    String(o.name || "").toLowerCase() === String(officeParam).toLowerCase()
  );
  const officeId = foundOffice ? foundOffice.id : officeParam;
  const officeName = foundOffice ? foundOffice.name : String(officeParam).toUpperCase();

  if (batchParam) {
    selectedOfficeId = officeId;
    selectedOfficeName = officeName;
    const officeBeneficiaries = officeId === "ALL"
      ? allBeneficiaries
      : allBeneficiaries.filter(b => String(b.staffs?.office_id) === String(officeId));
    currentOfficeBatches = groupOfficeBeneficiariesIntoChunks(officeBeneficiaries, BATCH_CHUNK_SIZE);

    const targetBatch = currentOfficeBatches.find(b =>
      String(b.batchIndex) === String(batchParam) ||
      String(b.batchId) === String(batchParam) ||
      String(b.batchName).toLowerCase() === String(batchParam).toLowerCase()
    ) || currentOfficeBatches[0];

    const batchIdx = targetBatch ? targetBatch.batchIndex : 1;
    const batchName = targetBatch ? targetBatch.batchName : `BATCH ${batchParam}`;

    switchToBeneficiariesView(batchIdx, batchName, false);
  } else {
    switchToBatchesView(officeId, officeName, false);
  }
}
// --- END: SYNC AND RESTORE VIEW STATE WITH URL QUERY PARAMETERS ---

// --- START: REFRESH PAYROLL DATA HELPER ---
/**
 * Silently or explicitly synchronizes the entire payroll state with remote database.
 * Preserves current navigation view and sub-views without UI flashes.
 *
 * @param {{ silent?: boolean }} options
 */
async function refreshPayrollData({ silent = true } = {}) {
  try {
    const [beneRes, officeRes, implRes, budgetRes] = await Promise.all([
      fetchBeneficiaryPayrollRoster({ forceRefresh: true }),
      fetchOffices({ forceRefresh: true }),
      fetchImplementorList({ forceRefresh: true }),
      fetchDbPayrollBudgets({ forceRefresh: true }),
    ]);

    if (!beneRes.error && Array.isArray(beneRes.data)) {
      allBeneficiaries = beneRes.data;
    }
    if (!officeRes.error && Array.isArray(officeRes.data)) {
      allOffices = officeRes.data;
    }
    if (implRes && Array.isArray(implRes)) {
      allImplementors = implRes;
    }

    if (budgetRes) {
      if (budgetRes.generalBudget !== undefined && budgetRes.generalBudget !== null) {
        customGeneralBudget = budgetRes.generalBudget;
        preferenceStorage.saveCustomGeneralBudget(budgetRes.generalBudget);
      }
      if (budgetRes.officeBudgets && Object.keys(budgetRes.officeBudgets).length > 0) {
        customOfficeBudgets = { ...preferenceStorage.getCustomOfficeBudgets(), ...budgetRes.officeBudgets };
      }
    }

    preferenceStorage.savePayrollCache({
      beneficiaries: allBeneficiaries,
      offices: allOffices,
      implementors: allImplementors,
    });

    updateExecutiveSummaryCards(allBeneficiaries, false, false);

    if (currentView === "implementors") {
      renderImplementorsView(false, false);
    } else if (currentView === "batches") {
      render50ItemChunkedBatchCards(false);
    } else if (currentView === "beneficiaries") {
      const officeBeneficiaries = selectedOfficeId === "ALL"
        ? allBeneficiaries
        : allBeneficiaries.filter(b => String(b.staffs?.office_id) === String(selectedOfficeId));
      currentOfficeBatches = groupOfficeBeneficiariesIntoChunks(officeBeneficiaries, BATCH_CHUNK_SIZE);
      applyBeneficiaryFiltersAndRender();
    }

    updatePayrollExportData({
      allBeneficiaries,
      allOffices,
      formatCurrency,
      formatPhilippineTimestamp
    });
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Payroll Realtime] Sync error:", err);
  }
}
// --- END: REFRESH PAYROLL DATA HELPER ---

// --- START: MAIN PAYROLL INITIALIZATION ---
export async function initPayroll() {
  const session = getSession();
  requireAuth();
  applyPermissions();
  initThemeToggle();

  _purgeLegacyPayrollStorage();

  const isFirstVisit = !preferenceStorage.hasSeenPayrollIntro();
  const cachedData = preferenceStorage.getPayrollCache();

  // If cached data is available in session, load it instantly with snappy counter animation
  if (cachedData && cachedData.beneficiaries) {
    allBeneficiaries = cachedData.beneficiaries || [];
    allOffices = cachedData.offices || [];
    allImplementors = cachedData.implementors || [];
    customGeneralBudget = preferenceStorage.getCustomGeneralBudget();
    customOfficeBudgets = preferenceStorage.getCustomOfficeBudgets();

    updateExecutiveSummaryCards(allBeneficiaries, false, isFirstVisit);
    restoreViewFromUrl(isFirstVisit);
    if (isFirstVisit) preferenceStorage.markPayrollIntroSeen();
  } else {
    renderImplementorsSkeleton();
  }

  try {
    const [beneRes, officeRes, implRes, budgetRes] = await Promise.all([
      fetchBeneficiaryPayrollRoster({ forceRefresh: false }),
      fetchOffices({ forceRefresh: false }),
      fetchImplementorList({ forceRefresh: false }),
      fetchDbPayrollBudgets({ forceRefresh: false }),
    ]);

    allBeneficiaries = beneRes.data || [];
    allOffices = officeRes.data || [];
    allImplementors = implRes || [];

    if (budgetRes) {
      if (budgetRes.generalBudget !== undefined && budgetRes.generalBudget !== null) {
        customGeneralBudget = budgetRes.generalBudget;
        preferenceStorage.saveCustomGeneralBudget(budgetRes.generalBudget);
      } else {
        customGeneralBudget = preferenceStorage.getCustomGeneralBudget();
      }

      if (budgetRes.officeBudgets && Object.keys(budgetRes.officeBudgets).length > 0) {
        customOfficeBudgets = { ...preferenceStorage.getCustomOfficeBudgets(), ...budgetRes.officeBudgets };
      } else {
        customOfficeBudgets = preferenceStorage.getCustomOfficeBudgets();
      }
    }

    // Save fetched data to session cache
    preferenceStorage.savePayrollCache({
      beneficiaries: allBeneficiaries,
      offices: allOffices,
      implementors: allImplementors,
    });

    const isStillFirstVisit = isFirstVisit && !cachedData;
    updateExecutiveSummaryCards(allBeneficiaries, !cachedData, isStillFirstVisit);
    restoreViewFromUrl(isStillFirstVisit);

    // Initialize Payroll Export Modal setup once
    initPayrollExportModal({
      allBeneficiaries,
      allOffices,
      formatCurrency,
      formatPhilippineTimestamp
    });

    if (isStillFirstVisit) {
      preferenceStorage.markPayrollIntroSeen();
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Payroll] Init error:", err);
    if (!cachedData) {
      modals.error("Load Failed", "Could not load payroll data. Please refresh and try again.");
    }
  }

  // Realtime Supabase live syncing for multi-tab and remote data changes
  const unsubscribeRealtime = subscribeToPayrollRealtime(async () => {
    await refreshPayrollData({ silent: true });
  });

  window.addEventListener("beforeunload", () => {
    unsubscribeRealtime();
  }, { once: true });

  // Back button navigation
  document.getElementById("btn-back-to-payroll-implementors")?.addEventListener("click", () => {
    if (currentView === "beneficiaries") {
      switchToBatchesView(selectedOfficeId, selectedOfficeName, true);
    } else {
      renderImplementorsView(false, true);
    }
  });

  // Browser forward / back history support
  window.addEventListener("popstate", () => {
    restoreViewFromUrl(false);
  });

  // Search input - live dynamic auto filtering on ALL views
  const searchInput = document.getElementById("payroll-search-input");
  const clearSearchBtn = document.getElementById("btn-clear-payroll-search");

  const syncClearSearchVisibility = () => {
    if (!clearSearchBtn) return;
    if (searchInput && searchInput.value.length > 0) {
      clearSearchBtn.classList.remove("hidden");
      clearSearchBtn.classList.add("flex");
    } else {
      clearSearchBtn.classList.add("hidden");
      clearSearchBtn.classList.remove("flex");
    }
  };

  const executeSearch = () => {
    syncClearSearchVisibility();
    if (currentView === "implementors") {
      renderImplementorsView(false, false);
    } else if (currentView === "batches") {
      render50ItemChunkedBatchCards();
    } else if (currentView === "beneficiaries") {
      currentPage = 1;
      applyBeneficiaryFiltersAndRender();
    }
  };

  searchInput?.addEventListener("input", executeSearch);

  clearSearchBtn?.addEventListener("click", () => {
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
      executeSearch();
    }
  });

  // Attach live comma formatting to Card 1 Total Budget editor and Drawer Stipend editor
  const inputBudgetEl = document.getElementById("input-edit-total-budget");
  if (inputBudgetEl) {
    attachNumberCommaFormatter(inputBudgetEl, { allowDecimals: true });
  }
  const inputStipendEl = document.getElementById("pd-stipend-amount");
  if (inputStipendEl) {
    attachNumberCommaFormatter(inputStipendEl, { allowDecimals: true });
  }

  // Status dropdown filter
  document.getElementById("payroll-status-filter")?.addEventListener("change", () => {
    if (currentView === "beneficiaries") {
      currentPage = 1;
      applyBeneficiaryFiltersAndRender();
    }
  });

  // Pagination Next / Prev
  document.getElementById("payroll-prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderBeneficiariesPaginatedTable();
    }
  });

  document.getElementById("payroll-next-page")?.addEventListener("click", () => {
    const totalPages = Math.ceil(filteredBeneficiaries.length / ROWS_PER_PAGE);
    if (currentPage < totalPages) {
      currentPage++;
      renderBeneficiariesPaginatedTable();
    }
  });

  // Checkbox Select-All
  document.getElementById("payroll-checkbox-all")?.addEventListener("change", (e) => {
    const isChecked = e.target.checked;
    filteredBeneficiaries.forEach(b => {
      if (isChecked) selectedBeneficiaryIds.add(String(b.id));
      else selectedBeneficiaryIds.delete(String(b.id));
    });
    renderBeneficiariesPaginatedTable();
  });

  // Smart Dynamic Bulk Action (Auto-toggles between Mark Paid and Mark Pending based on selection)
  document.getElementById("btn-bulk-disburse")?.addEventListener("click", async () => {
    const ids = [...selectedBeneficiaryIds];
    if (ids.length === 0) {
      modals.warning("Bulk Action", "Please select at least one beneficiary.");
      return;
    }

    const selectedItems = allBeneficiaries.filter(b => ids.includes(String(b.id)));
    const allSelectedArePaid = selectedItems.every(b => (b.payroll?.payment_status || "PENDING") === "PAID");
    const session = getSession();

    if (allSelectedArePaid) {
      // ── REVERT TO PENDING / UNPAID FLOW ──
      const confirm = await modals.confirm(
        "Revert Payment Status",
        `Unmark ${ids.length} selected beneficiar${ids.length === 1 ? "y" : "ies"} and revert status to PENDING?`,
        "Confirm Revert",
        "Cancel"
      );

      if (!confirm.isConfirmed) return;

      modals.loading("Reverting Status", "Updating payroll records to PENDING in database...");

      const payloadItems = selectedItems.map(b => ({
        beneficiaryId: b.id,
        officeId: b.staffs?.office_id || null,
        stipend_amount: b.payroll?.stipend_amount || DEFAULT_STIPEND_RATE,
        days_worked: b.payroll?.days_worked || DEFAULT_WORK_DAYS,
      }));

      await bulkUpdatePayrollStatus(payloadItems, "PENDING", session?.id);
      modals.close();

      // Update memory
      allBeneficiaries.forEach(b => {
        if (ids.includes(String(b.id))) {
          b.payroll.payment_status = "PENDING";
          b.payroll.date_paid = null;
        }
      });

      selectedBeneficiaryIds.clear();
      updateExecutiveSummaryCards(allBeneficiaries);
      applyBeneficiaryFiltersAndRender();

      modals.flowbiteToast(
        "Status Reverted",
        `${ids.length} beneficiaries reverted to PENDING status.`,
        "warning"
      );
    } else {
      // ── MARK AS PAID FLOW ──
      const confirm = await modals.confirm(
        "Disburse Payroll",
        `Mark ${ids.length} selected beneficiar${ids.length === 1 ? "y" : "ies"} as PAID? An audit timestamp (Asia/Manila GMT+08) will be recorded.`,
        "Confirm Paid",
        "Cancel"
      );

      if (!confirm.isConfirmed) return;

      modals.loading("Processing Disbursements", "Recording payments with Philippine GMT+08 timestamp logs in database...");

      const payloadItems = selectedItems.map(b => ({
        beneficiaryId: b.id,
        officeId: b.staffs?.office_id || null,
        stipend_amount: b.payroll?.stipend_amount || DEFAULT_STIPEND_RATE,
        days_worked: b.payroll?.days_worked || DEFAULT_WORK_DAYS,
      }));

      const nowStr = new Date().toISOString();
      await bulkUpdatePayrollStatus(payloadItems, "PAID", session?.id);
      modals.close();

      // Update memory
      allBeneficiaries.forEach(b => {
        if (ids.includes(String(b.id))) {
          b.payroll.payment_status = "PAID";
          b.payroll.date_paid = nowStr;
        }
      });

      selectedBeneficiaryIds.clear();
      updateExecutiveSummaryCards(allBeneficiaries);
      applyBeneficiaryFiltersAndRender();

      const timestampLabel = formatPhilippineTimestamp(nowStr);
      modals.flowbiteToast("Disbursement Recorded", `${ids.length} beneficiaries marked as PAID at ${timestampLabel}.`, "success");
    }
  });

  // Edit Data / Save Data Button in Header
  document.getElementById("btn-toggle-inline-edit")?.addEventListener("click", () => {
    if (isInlineEditMode) {
      saveInlineDataChanges();
    } else {
      toggleInlineEditMode(true);
    }
  });

  // Card 1: Save Budget Icon Button (Specific Item Save)
  document.getElementById("btn-save-inline-budget")?.addEventListener("click", () => {
    const input = document.getElementById("input-edit-total-budget");
    if (input) {
      const val = parseNumberFromCommas(input.value);
      if (Number.isFinite(val) && val > 0) {
        customGeneralBudget = val;
        preferenceStorage.saveCustomGeneralBudget(val);

        const session = getSession();
        upsertDbPayrollBudget(null, val, session?.id);

        isBudgetCardEditing = false;
        document.getElementById("stat-total-budget-edit-container")?.classList.add("hidden");
        document.getElementById("stat-total-budget-display-container")?.classList.remove("hidden");
        checkAndSyncEditModeState();
        updateExecutiveSummaryCards(allBeneficiaries);
        modals.flowbiteToast("Budget Saved", `Total allocated budget updated to ${formatCurrency(val)}.`, "success");
      }
    }
  });

  // Card 1: Cancel / Reset Budget Icon Button (Specific Item Cancel)
  document.getElementById("btn-cancel-inline-budget")?.addEventListener("click", () => {
    isBudgetCardEditing = false;
    document.getElementById("stat-total-budget-edit-container")?.classList.add("hidden");
    document.getElementById("stat-total-budget-display-container")?.classList.remove("hidden");
    checkAndSyncEditModeState();
    updateExecutiveSummaryCards(allBeneficiaries);
  });

  // Export report
  document.getElementById("btn-export-payroll-summary")?.addEventListener("click", exportPayrollReport);

  // Switch from View to Edit Drawer
  document.getElementById("btn-switch-to-edit-drawer")?.addEventListener("click", () => {
    if (currentActiveBeneficiary) {
      openPayrollDrawer(currentActiveBeneficiary, "edit");
    }
  });

  // Drawer close listeners
  document.getElementById("btn-close-payroll-drawer")?.addEventListener("click", closePayrollDrawer);
  document.getElementById("btn-cancel-payroll-drawer")?.addEventListener("click", closePayrollDrawer);
  document.getElementById("drawer-payroll-edit-overlay")?.addEventListener("click", closePayrollDrawer);

  // Status button group in Edit Drawer
  document.querySelectorAll(".pd-status-toggle").forEach(btn => {
    btn.addEventListener("click", () => {
      const statusVal = btn.dataset.statusVal;
      if (statusVal) setPayrollDrawerStatus(statusVal);
    });
  });

  // Drawer submit listener
  document.getElementById("form-payroll-drawer")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("pd-beneficiary-id")?.value;
    const rawStipend = document.getElementById("pd-stipend-amount")?.value;
    const stipendAmount = parseNumberFromCommas(rawStipend);
    const daysWorked = Number(document.getElementById("pd-days-worked")?.value) || DEFAULT_WORK_DAYS;
    const paymentStatus = document.getElementById("pd-payment-status")?.value;
    const notes = document.getElementById("pd-notes")?.value;

    if (!id) return;

    const targetBene = allBeneficiaries.find(b => String(b.id) === String(id));
    const officeId = targetBene?.staffs?.office_id || null;
    const session = getSession();

    let targetDatePaid = null;
    if (paymentStatus === "PAID") {
      targetDatePaid = targetBene?.payroll?.date_paid || new Date().toISOString();
    }

    await updateBeneficiaryPayrollRecord(id, {
      stipend_amount: stipendAmount,
      days_worked: daysWorked,
      payment_status: paymentStatus,
      date_paid: targetDatePaid,
      notes: notes,
      updated_by: session?.id || null,
    }, officeId);

    if (targetBene) {
      targetBene.payroll.stipend_amount = stipendAmount;
      targetBene.payroll.days_worked = daysWorked;
      targetBene.payroll.payment_status = paymentStatus;
      targetBene.payroll.date_paid = targetDatePaid;
      targetBene.payroll.notes = notes;
    }

    closePayrollDrawer();
    updateExecutiveSummaryCards(allBeneficiaries);
    applyBeneficiaryFiltersAndRender();

    const loggedTs = paymentStatus === "PAID" && targetDatePaid ? ` (Logged: ${formatPhilippineTimestamp(targetDatePaid)})` : "";
    modals.flowbiteToast("Record Saved", `Disbursement details updated successfully in database.${loggedTs}`, "success");
  });
}
// --- END: MAIN PAYROLL INITIALIZATION ---
