/**
 * SPES Portal — Payroll Component & Interactive Controller
 * ─────────────────────────────────────────────────────────
 * Features:
 *  1. Top 4 Executive Statistic Cards with Flowbite ApexChart Mini-Graphs.
 *  2. Multi-tier hierarchy:
 *     - Tier 1: Implementors & Offices Summary (with dedicated Assigned Officer column).
 *     - Tier 2: Dynamic 50-Item Chunked Batches (Square-type enterprise cards, entire card clickable).
 *     - Tier 3: Individual Beneficiary Roster with larger typography (for 30+ users).
 *  3. Flowbite Offcanvas Drawer supporting both VIEW MODE (on row click) and EDIT MODE (on edit icon click).
 *  4. Full RBAC, Theme-toggle, search, filter, and pagination support.
 */

import ApexCharts from "apexcharts";
import { applyPermissions, requireAuth, signOut, getSession } from "../rbac/guard.js";
import { getOfficeAccessScope } from "../rbac/scope.js";
import { initThemeToggle } from "./theme-toggle.js";
import { modals } from "./modals.js";
import {
  DEFAULT_STIPEND_RATE,
  DEFAULT_WORK_DAYS,
  BATCH_CHUNK_SIZE,
  fetchBeneficiaryPayrollRoster,
  computePayrollExecutiveSummary,
  groupOfficeBeneficiariesIntoChunks,
  updateBeneficiaryPayrollRecord,
  bulkUpdatePayrollStatus
} from "../../../../backend/api/payroll.js";
import { fetchImplementorList } from "../../../../backend/api/auth.js";
import { fetchOffices } from "../../../../backend/api/staff.js";

const ROWS_PER_PAGE = 10;

// --- START: FORMAT CURRENCY HELPER ---
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
  }).format(Number(amount) || 0);
}
// --- END: FORMAT CURRENCY HELPER ---

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

let currentView = "implementors"; // "implementors" | "batches" | "beneficiaries"
let selectedOfficeId = null;
let selectedOfficeName = "";
let currentOfficeBatches = [];
let selectedBatchIndex = null;
let selectedBatchTitle = "";
let currentActiveBeneficiary = null;

let currentPage = 1;
const selectedBeneficiaryIds = new Set();

let sparklineBudgetChart = null;
let sparklinePaidChart = null;
let sparklinePendingChart = null;
let sparklineRemainingChart = null;

// --- START: INITIALIZE APEXCHARTS MINI SPARKLINES ---
function initMiniSparklineCharts() {
  const isDark = document.documentElement.classList.contains("dark");

  const commonSparklineOptions = {
    chart: {
      type: "area",
      height: 40,
      sparkline: { enabled: true },
      animations: { enabled: true, easing: "easeinout", speed: 600 },
    },
    stroke: { curve: "smooth", width: 2 },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.45,
        opacityTo: 0.05,
        stops: [0, 90, 100],
      },
    },
    tooltip: {
      theme: isDark ? "dark" : "light",
      x: { show: false },
      y: {
        formatter: (val) => formatCurrency(val),
      },
    },
  };

  // 1. Budget Chart (Blue)
  const budgetEl = document.getElementById("sparkline-budget");
  if (budgetEl && !sparklineBudgetChart) {
    sparklineBudgetChart = new ApexCharts(budgetEl, {
      ...commonSparklineOptions,
      colors: ["#0038A8"],
      series: [{ name: "Allocated", data: [45000, 62000, 58000, 85000, 105000, 140000, 180000] }],
    });
    sparklineBudgetChart.render();
  }

  // 2. Paid Chart (Emerald Green)
  const paidEl = document.getElementById("sparkline-paid");
  if (paidEl && !sparklinePaidChart) {
    sparklinePaidChart = new ApexCharts(paidEl, {
      ...commonSparklineOptions,
      colors: ["#10B981"],
      series: [{ name: "Disbursed", data: [15000, 28000, 42000, 60000, 82000, 110000, 135000] }],
    });
    sparklinePaidChart.render();
  }

  // 3. Pending Chart (Amber)
  const pendingEl = document.getElementById("sparkline-pending");
  if (pendingEl && !sparklinePendingChart) {
    sparklinePendingChart = new ApexCharts(pendingEl, {
      ...commonSparklineOptions,
      colors: ["#F59E0B"],
      series: [{ name: "Pending", data: [30000, 34000, 16000, 25000, 23000, 30000, 45000] }],
    });
    sparklinePendingChart.render();
  }

  // 4. Remaining Balance Chart (Red)
  const remainingEl = document.getElementById("sparkline-remaining");
  if (remainingEl && !sparklineRemainingChart) {
    sparklineRemainingChart = new ApexCharts(remainingEl, {
      ...commonSparklineOptions,
      colors: ["#EF4444"],
      series: [{ name: "Remaining", data: [45000, 40000, 32000, 28000, 20000, 15000, 10000] }],
    });
    sparklineRemainingChart.render();
  }

  // Listen to custom theme-changed event from theme-toggle.js
  window.addEventListener("theme-changed", () => {
    const isDarkNow = document.documentElement.classList.contains("dark");
    const newTooltipTheme = isDarkNow ? "dark" : "light";
    [sparklineBudgetChart, sparklinePaidChart, sparklinePendingChart, sparklineRemainingChart].forEach(chart => {
      if (chart) {
        chart.updateOptions({ tooltip: { theme: newTooltipTheme } });
      }
    });
  });
}
// --- END: INITIALIZE APEXCHARTS MINI SPARKLINES ---

// --- START: UPDATE EXECUTIVE STATISTIC CARDS DATA ---
function updateExecutiveSummaryCards(beneficiaries) {
  const stats = computePayrollExecutiveSummary(beneficiaries);

  const budgetEl = document.getElementById("stat-total-budget");
  const paidEl = document.getElementById("stat-total-paid");
  const pendingEl = document.getElementById("stat-total-pending");
  const remainingEl = document.getElementById("stat-remaining-balance");

  const beneCountEl = document.getElementById("stat-beneficiary-count");
  const paidCountEl = document.getElementById("stat-paid-count");
  const pendingCountEl = document.getElementById("stat-pending-count");
  const disburseRateEl = document.getElementById("stat-disbursement-rate");

  if (budgetEl) budgetEl.textContent = formatCurrency(stats.totalBudget);
  if (paidEl) paidEl.textContent = formatCurrency(stats.totalPaid);
  if (pendingEl) pendingEl.textContent = formatCurrency(stats.totalPending);
  if (remainingEl) remainingEl.textContent = formatCurrency(stats.remainingBalance);

  if (beneCountEl) beneCountEl.textContent = `${stats.totalBeneficiaries.toLocaleString()} Beneficiaries`;
  
  const paidCount = beneficiaries.filter(b => b.payroll?.payment_status === "PAID").length;
  const pendingCount = beneficiaries.filter(b => b.payroll?.payment_status === "PENDING").length;

  if (paidCountEl) paidCountEl.textContent = `${paidCount.toLocaleString()} Paid Accounts`;
  if (pendingCountEl) pendingCountEl.textContent = `${pendingCount.toLocaleString()} In Processing`;
  if (disburseRateEl) disburseRateEl.textContent = `${stats.disbursementRate}% Disbursed`;
}
// --- END: UPDATE EXECUTIVE STATISTIC CARDS DATA ---

// --- START: RENDER VIEW 1 (IMPLEMENTORS / OFFICES SUMMARY WITH MULTI-TIER SEARCH) ---
function renderImplementorsView() {
  currentView = "implementors";
  selectedOfficeId = null;
  selectedBatchIndex = null;

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

  let rows = [];
  officeMap.forEach((item) => {
    if (item.beneficiaries.length === 0 && item.officeId === "other") return;
    const stats = computePayrollExecutiveSummary(item.beneficiaries);
    
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
          ${r.stats.totalBeneficiaries.toLocaleString()}
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-spes-blue dark:text-spes-yellow whitespace-nowrap tabular-nums">
          ${formatCurrency(r.stats.totalBudget)}
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-emerald-600 dark:text-emerald-400 whitespace-nowrap tabular-nums">
          ${formatCurrency(r.stats.totalPaid)}
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-amber-600 dark:text-amber-400 whitespace-nowrap tabular-nums">
          ${formatCurrency(r.stats.totalPending)}
        </td>
        <td class="px-6 py-5 text-right font-black text-base text-red-600 dark:text-red-400 whitespace-nowrap tabular-nums">
          ${formatCurrency(r.stats.remainingBalance)}
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("tr[data-office-id]").forEach(row => {
    row.addEventListener("click", () => {
      const officeId = row.dataset.officeId;
      const officeName = row.dataset.officeName;
      switchToBatchesView(officeId, officeName);
    });
  });
}
// --- END: RENDER VIEW 1 (IMPLEMENTORS / OFFICES SUMMARY WITH MULTI-TIER SEARCH) ---

// --- START: RENDER VIEW 2 (SQUARE-TYPE 50-RECORD CHUNKED BATCHES & ET. AL) ---
function switchToBatchesView(officeId, officeName) {
  currentView = "batches";
  selectedOfficeId = officeId;
  selectedOfficeName = officeName;
  selectedBatchIndex = null;

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

  render50ItemChunkedBatchCards();
}

function render50ItemChunkedBatchCards() {
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
      const bNameMatch = b.batchName.toLowerCase().includes(searchQ);
      const etAlMatch = b.etAlName.toLowerCase().includes(searchQ);
      const periodMatch = b.contractPeriod.toLowerCase().includes(searchQ);
      const beneMatch = b.beneficiaries.some(bene => 
        String(bene.full_name || "").toLowerCase().includes(searchQ) ||
        String(bene.id || "").includes(searchQ)
      );
      return bNameMatch || etAlMatch || periodMatch || beneMatch;
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
      <div class="batch-card group relative cursor-pointer overflow-hidden rounded-none border-2 border-spes-blue/20 bg-white p-6 shadow-md transition-all duration-300 hover:-translate-y-1 hover:border-spes-blue hover:shadow-xl dark:border-white/15 dark:bg-spes-dark-primary dark:hover:border-spes-yellow flex flex-col justify-between ${highlightBatchClass}"
           data-batch-idx="${batch.batchIndex}" data-batch-name="${escHtml(batch.batchName)}">
        
        <div>
          <!-- Card Header & Badge -->
          <div class="flex items-start justify-between gap-3">
            <div>
              <div class="flex items-center">
                <span class="inline-flex items-center gap-1.5 rounded-none bg-spes-blue/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-spes-blue dark:bg-spes-yellow/15 dark:text-spes-yellow border border-spes-blue/20 dark:border-spes-yellow/30">
                  ${escHtml(batch.batchName)} (Max ${BATCH_CHUNK_SIZE})
                </span>
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
              <span class="font-mono text-xl sm:text-2xl font-black text-spes-blue dark:text-spes-yellow tabular-nums">
                ${formatCurrency(batch.totalPrincipal)}
              </span>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="mt-5 space-y-2">
            <div class="flex justify-between text-xs font-black uppercase text-spes-black/60 dark:text-white/60">
              <span>Disbursed: <span class="font-mono tabular-nums font-bold text-spes-black dark:text-white">${formatCurrency(batch.totalPaid)}</span></span>
              <span class="text-emerald-600 dark:text-emerald-400 font-mono font-bold">${progress}%</span>
            </div>
            <div class="h-2.5 w-full overflow-hidden bg-gray-200 dark:bg-black/40">
              <div class="h-full bg-emerald-500 transition-all duration-500" style="width: ${progress}%"></div>
            </div>
          </div>

          <!-- Stats Mini Grid with Neutral Fills & Literal Number Fonts -->
          <div class="mt-4 grid grid-cols-3 gap-2.5 text-center">
            <div class="rounded-none bg-slate-100 dark:bg-[#141D26] p-3 border border-slate-300 dark:border-white/10">
              <span class="block text-xs font-black uppercase tracking-wider text-spes-black/70 dark:text-white/70">TOTAL</span>
              <span class="font-mono font-black text-lg sm:text-xl text-spes-black dark:text-white tabular-nums">${totalCount}</span>
            </div>
            <div class="rounded-none bg-emerald-50 dark:bg-emerald-950/40 p-3 border border-emerald-300 dark:border-emerald-500/40">
              <span class="block text-xs font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">PAID</span>
              <span class="font-mono font-black text-lg sm:text-xl text-emerald-700 dark:text-emerald-300 tabular-nums">${paidCount}</span>
            </div>
            <div class="rounded-none bg-amber-50 dark:bg-amber-950/40 p-3 border border-amber-300 dark:border-amber-500/40">
              <span class="block text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">PENDING</span>
              <span class="font-mono font-black text-lg sm:text-xl text-amber-700 dark:text-amber-300 tabular-nums">${pendingCount}</span>
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

  grid.querySelectorAll(".batch-card").forEach(card => {
    card.addEventListener("click", () => {
      const idx = Number(card.dataset.batchIdx);
      const batchName = card.dataset.batchName;
      switchToBeneficiariesView(idx, batchName);
    });
  });
}
// --- END: RENDER VIEW 2 (SQUARE-TYPE 50-RECORD CHUNKED BATCHES & ET. AL) ---

// --- START: RENDER VIEW 3 (INDIVIDUAL BENEFICIARY PAYROLL TABLE WITH LARGER FONTS) ---
function switchToBeneficiariesView(batchIndex, batchName) {
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

  applyBeneficiaryFiltersAndRender();
}

function applyBeneficiaryFiltersAndRender() {
  const searchQ = (document.getElementById("payroll-search-input")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("payroll-status-filter")?.value || "all";

  const targetBatch = currentOfficeBatches.find(b => b.batchIndex === selectedBatchIndex);
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

function renderBeneficiariesPaginatedTable() {
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

      const statusBadge = isPaid
        ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400">
             <span class="h-2 w-2 rounded-full bg-emerald-500"></span> PAID
           </span>`
        : isPending
        ? `<span class="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-black text-amber-600 dark:text-amber-400">
             <span class="h-2 w-2 rounded-full bg-amber-500"></span> PENDING
           </span>`
        : `<span class="inline-flex items-center gap-1.5 rounded-full bg-gray-500/15 px-3 py-1 text-xs font-black text-gray-600 dark:text-gray-400">
             <span class="h-2 w-2 rounded-full bg-gray-400"></span> UNPAID
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
            ${p.days_worked || DEFAULT_WORK_DAYS} Days
          </td>
          <td class="px-6 py-5 text-right font-black text-base text-spes-black dark:text-white whitespace-nowrap tabular-nums">
            ${formatCurrency(p.stipend_amount || DEFAULT_STIPEND_RATE)}
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
              <button type="button" class="btn-toggle-pay-row cursor-pointer rounded-xl p-2 ${isPaid ? 'text-emerald-600 hover:bg-emerald-500/10' : 'text-gray-400 hover:text-emerald-600 hover:bg-emerald-500/10'} transition-colors" title="${isPaid ? 'Mark as Unpaid' : 'Quick Disburse / Mark Paid'}">
                <svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  // Update pagination info
  const rangeEl = document.getElementById("payroll-pagination-range");
  const totalEl = document.getElementById("payroll-pagination-total");
  if (rangeEl) rangeEl.textContent = total === 0 ? "0" : `${start + 1}–${Math.min(end, total)}`;
  if (totalEl) totalEl.textContent = total.toLocaleString();

  updatePaginationIndicators(total);
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

      await updateBeneficiaryPayrollRecord(bene.id, {
        payment_status: nextStatus,
      });

      bene.payroll.payment_status = nextStatus;
      modals.flowbiteToast(
        "Payroll Updated",
        `${bene.full_name} status is now ${nextStatus}.`,
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
    const statusBadgeHtml = pStatus === "PAID"
      ? `<span class="inline-flex items-center gap-1.5 rounded-none bg-emerald-500/15 px-3.5 py-1 text-xs font-black text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
           <span class="h-2 w-2 rounded-full bg-emerald-500"></span> PAID (Disbursed)
         </span>`
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
    document.getElementById("pd-stipend-amount").value = p.stipend_amount || DEFAULT_STIPEND_RATE;
    document.getElementById("pd-days-worked").value = p.days_worked || DEFAULT_WORK_DAYS;
    document.getElementById("pd-payment-status").value = p.payment_status || "PENDING";
    document.getElementById("pd-notes").value = p.notes || "";

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
function exportPayrollReport() {
  const rows = filteredBeneficiaries.map((b, i) => {
    const p = b.payroll || {};
    return {
      "No.": i + 1,
      "Beneficiary Name": b.full_name || "",
      "Office": b.staffs?.office_id ? (allOffices.find(o => String(o.id) === String(b.staffs.office_id))?.name || "N/A") : "N/A",
      "Contract Period": p.contract_period || "JULY 2026",
      "Days Worked": p.days_worked || DEFAULT_WORK_DAYS,
      "Stipend Amount": p.stipend_amount || DEFAULT_STIPEND_RATE,
      "Payment Status": p.payment_status || "PENDING",
      "Date Paid": p.date_paid || "",
    };
  });

  if (rows.length === 0) {
    modals.warning("Export Payroll", "No records available to export.");
    return;
  }

  const headers = Object.keys(rows[0]).join(",");
  const csvContent = [
    headers,
    ...rows.map(row => Object.values(row).map(val => `"${String(val).replace(/"/g, '""')}"`).join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `SPES_Payroll_Export_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  modals.flowbiteToast("Export Successful", "Payroll summary CSV file downloaded.", "success");
}
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

// --- START: MAIN PAYROLL INITIALIZATION ---
export async function initPayroll() {
  const session = getSession();
  requireAuth();
  applyPermissions();
  initThemeToggle();

  initMiniSparklineCharts();
  renderImplementorsSkeleton();

  try {
    const [beneRes, officeRes, implRes] = await Promise.all([
      fetchBeneficiaryPayrollRoster({ forceRefresh: false }),
      fetchOffices({ forceRefresh: false }),
      fetchImplementorList({ forceRefresh: false }),
    ]);

    allBeneficiaries = beneRes.data || [];
    allOffices = officeRes.data || [];
    allImplementors = implRes || [];

    updateExecutiveSummaryCards(allBeneficiaries);
    renderImplementorsView();

  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Payroll] Init error:", err);
    modals.error("Load Failed", "Could not load payroll data. Please refresh and try again.");
  }

  // Back button navigation
  document.getElementById("btn-back-to-payroll-implementors")?.addEventListener("click", () => {
    if (currentView === "beneficiaries") {
      switchToBatchesView(selectedOfficeId, selectedOfficeName);
    } else {
      renderImplementorsView();
    }
  });

  // Search input - live dynamic auto filtering on ALL views
  document.getElementById("payroll-search-input")?.addEventListener("input", () => {
    if (currentView === "implementors") {
      renderImplementorsView();
    } else if (currentView === "batches") {
      render50ItemChunkedBatchCards();
    } else if (currentView === "beneficiaries") {
      currentPage = 1;
      applyBeneficiaryFiltersAndRender();
    }
  });

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

  // Bulk Disburse / Mark Paid Button
  document.getElementById("btn-bulk-disburse")?.addEventListener("click", async () => {
    const ids = [...selectedBeneficiaryIds];
    if (ids.length === 0) {
      modals.warning("Bulk Disbursement", "Please select at least one beneficiary to mark as PAID.");
      return;
    }

    const confirm = await modals.confirm(
      "Disburse Payroll",
      `Mark ${ids.length} selected beneficiar${ids.length === 1 ? "y" : "ies"} as PAID?`,
      "Confirm Paid",
      "Cancel"
    );

    if (!confirm.isConfirmed) return;

    modals.loading("Processing Disbursements", "Updating payroll records...");
    await bulkUpdatePayrollStatus(ids, "PAID");
    modals.close();

    // Update memory
    allBeneficiaries.forEach(b => {
      if (ids.includes(String(b.id))) {
        b.payroll.payment_status = "PAID";
        b.payroll.date_paid = new Date().toISOString();
      }
    });

    selectedBeneficiaryIds.clear();
    updateExecutiveSummaryCards(allBeneficiaries);
    applyBeneficiaryFiltersAndRender();

    modals.flowbiteToast("Disbursement Recorded", `${ids.length} beneficiaries marked as PAID.`, "success");
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

  // Drawer submit listener
  document.getElementById("form-payroll-drawer")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("pd-beneficiary-id")?.value;
    const stipendAmount = document.getElementById("pd-stipend-amount")?.value;
    const daysWorked = document.getElementById("pd-days-worked")?.value;
    const paymentStatus = document.getElementById("pd-payment-status")?.value;
    const notes = document.getElementById("pd-notes")?.value;

    if (!id) return;

    await updateBeneficiaryPayrollRecord(id, {
      stipend_amount: stipendAmount,
      days_worked: daysWorked,
      payment_status: paymentStatus,
      notes: notes,
    });

    const targetBene = allBeneficiaries.find(b => String(b.id) === String(id));
    if (targetBene) {
      targetBene.payroll.stipend_amount = Number(stipendAmount);
      targetBene.payroll.days_worked = Number(daysWorked);
      targetBene.payroll.payment_status = paymentStatus;
      targetBene.payroll.notes = notes;
    }

    closePayrollDrawer();
    updateExecutiveSummaryCards(allBeneficiaries);
    applyBeneficiaryFiltersAndRender();

    modals.flowbiteToast("Record Saved", "Disbursement details updated successfully.", "success");
  });
}
// --- END: MAIN PAYROLL INITIALIZATION ---
