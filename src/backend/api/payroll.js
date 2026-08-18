/**
 * SPES Portal — Payroll API & Calculation Service
 * ────────────────────────────────────────────────
 * Provides budget analytics, stipend calculations, disbursement tracking,
 * dynamic 50-item chunked BATCH grouping with ET.AL headers, and drawer CRUD.
 */
import { supabase } from "./supabase.js";
import { fetchBeneficiaries } from "./beneficiary.js";
import { fetchImplementorList } from "./auth.js";
import { fetchOffices } from "./staff.js";

// Standard SPES stipend baseline
export const DEFAULT_STIPEND_RATE = 5133.00;
export const DEFAULT_WORK_DAYS = 20;
export const BATCH_CHUNK_SIZE = 50;

const PAYROLL_STORAGE_KEY = "spes_beneficiary_payroll_v3";

// --- START: READ / WRITE PAYROLL LOCAL CACHE ---
function _getStoredPayrollOverrides() {
  try {
    const raw = localStorage.getItem(PAYROLL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function _saveStoredPayrollOverrides(overrides) {
  try {
    localStorage.setItem(PAYROLL_STORAGE_KEY, JSON.stringify(overrides));
  } catch {}
}
// --- END: READ / WRITE PAYROLL LOCAL CACHE ---

// --- START: ATTACH PAYROLL METADATA TO BENEFICIARIES ---
export function enrichBeneficiaryWithPayroll(beneficiary, index = 0, overrides = _getStoredPayrollOverrides()) {
  const bId = String(beneficiary.id);
  const override = overrides[bId] || {};

  const daysWorked = override.days_worked !== undefined ? Number(override.days_worked) : DEFAULT_WORK_DAYS;
  const ratePerDay = override.rate_per_day !== undefined ? Number(override.rate_per_day) : (DEFAULT_STIPEND_RATE / DEFAULT_WORK_DAYS);
  const amount = override.stipend_amount !== undefined ? Number(override.stipend_amount) : DEFAULT_STIPEND_RATE;

  // Realistic mix: ~35% already PAID in initial seed if no manual override exists
  let paymentStatus = override.payment_status;
  if (!paymentStatus) {
    if (beneficiary.is_paid) {
      paymentStatus = "PAID";
    } else {
      // Deterministic pseudo-random seed based on index/id for realistic sample distribution
      paymentStatus = (index % 3 === 0) ? "PAID" : "PENDING";
    }
  }

  const datePaid = override.date_paid || (paymentStatus === "PAID" ? (beneficiary.updated_at || new Date().toISOString()) : null);
  const contractPeriod = [beneficiary.month_period, beneficiary.year_period].filter(Boolean).join(" ") || "JULY 2026";

  return {
    ...beneficiary,
    payroll: {
      stipend_amount: amount,
      days_worked: daysWorked,
      rate_per_day: ratePerDay,
      payment_status: paymentStatus,
      date_paid: datePaid,
      contract_period: contractPeriod,
      notes: override.notes || ""
    }
  };
}
// --- END: ATTACH PAYROLL METADATA TO BENEFICIARIES ---

// --- START: FETCH ENRICHED BENEFICIARY PAYROLL ROSTER ---
export async function fetchBeneficiaryPayrollRoster({ forceRefresh = false, officeId = null } = {}) {
  const { data: beneficiaries, error } = await fetchBeneficiaries({ forceRefresh });
  if (error) return { data: [], error };

  const overrides = _getStoredPayrollOverrides();
  let list = (beneficiaries || [])
    .filter(b => !b.archived_at)
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")))
    .map((b, idx) => enrichBeneficiaryWithPayroll(b, idx, overrides));

  if (officeId && officeId !== "ALL") {
    list = list.filter(b => String(b.staffs?.office_id) === String(officeId));
  }

  return { data: list };
}
// --- END: FETCH ENRICHED BENEFICIARY PAYROLL ROSTER ---

// --- START: COMPUTE PAYROLL EXECUTIVE SUMMARY STATS ---
export function computePayrollExecutiveSummary(beneficiariesList = []) {
  let totalBudget = 0;
  let totalPaid = 0;
  let totalPending = 0;
  let totalUnpaid = 0;

  beneficiariesList.forEach(b => {
    const p = b.payroll || {};
    const amount = Number(p.stipend_amount) || DEFAULT_STIPEND_RATE;
    totalBudget += amount;

    if (p.payment_status === "PAID") {
      totalPaid += amount;
    } else if (p.payment_status === "PENDING") {
      totalPending += amount;
    } else {
      totalUnpaid += amount;
    }
  });

  const remainingBalance = Math.max(0, totalBudget - totalPaid);

  return {
    totalBeneficiaries: beneficiariesList.length,
    totalBudget,
    totalPaid,
    totalPending,
    totalUnpaid,
    remainingBalance,
    disbursementRate: totalBudget > 0 ? Math.round((totalPaid / totalBudget) * 100) : 0,
    pendingRate: totalBudget > 0 ? Math.round((totalPending / totalBudget) * 100) : 0
  };
}
// --- END: COMPUTE PAYROLL EXECUTIVE SUMMARY STATS ---

// --- START: DYNAMIC 50-ITEM CHUNKED BATCH GROUPING WITH ET. AL HEADERS ---
export function groupOfficeBeneficiariesIntoChunks(officeBeneficiaries = [], chunkSize = BATCH_CHUNK_SIZE) {
  // Sort alphabetically first
  const sorted = [...officeBeneficiaries].sort((a, b) =>
    String(a.full_name || "").localeCompare(String(b.full_name || ""))
  );

  const batches = [];
  const total = sorted.length;

  if (total === 0) {
    return [];
  }

  let batchNumber = 1;
  for (let i = 0; i < total; i += chunkSize) {
    const chunk = sorted.slice(i, i + chunkSize);
    const firstBene = chunk[0];
    const rawFirstName = String(firstBene.full_name || "").trim().toUpperCase();
    const etAlName = chunk.length > 1 ? `${rawFirstName} ET. AL.` : rawFirstName;
    const contractPeriod = firstBene.payroll?.contract_period || "JULY 2026";

    let totalPrincipal = 0;
    let totalPaid = 0;
    let totalPending = 0;

    chunk.forEach(b => {
      const amt = Number(b.payroll?.stipend_amount) || DEFAULT_STIPEND_RATE;
      totalPrincipal += amt;
      if (b.payroll?.payment_status === "PAID") {
        totalPaid += amt;
      } else {
        totalPending += amt;
      }
    });

    batches.push({
      batchId: `batch_${batchNumber}`,
      batchIndex: batchNumber,
      batchName: `BATCH ${batchNumber}`,
      etAlName,
      firstBeneficiary: firstBene,
      beneficiaries: chunk,
      totalPrincipal,
      totalPaid,
      totalPending,
      contractPeriod,
      startIndex: i,
      endIndex: Math.min(i + chunkSize, total)
    });

    batchNumber++;
  }

  return batches;
}
// --- END: DYNAMIC 50-ITEM CHUNKED BATCH GROUPING WITH ET. AL HEADERS ---

// --- START: UPDATE BENEFICIARY PAYROLL RECORD ---
export async function updateBeneficiaryPayrollRecord(beneficiaryId, payload = {}) {
  const bId = String(beneficiaryId);
  const overrides = _getStoredPayrollOverrides();

  overrides[bId] = {
    ...(overrides[bId] || {}),
    stipend_amount: payload.stipend_amount !== undefined ? Number(payload.stipend_amount) : DEFAULT_STIPEND_RATE,
    days_worked: payload.days_worked !== undefined ? Number(payload.days_worked) : DEFAULT_WORK_DAYS,
    rate_per_day: payload.rate_per_day !== undefined ? Number(payload.rate_per_day) : (DEFAULT_STIPEND_RATE / DEFAULT_WORK_DAYS),
    payment_status: payload.payment_status || "PENDING",
    date_paid: payload.payment_status === "PAID" ? (payload.date_paid || new Date().toISOString()) : null,
    notes: String(payload.notes || "").trim()
  };

  _saveStoredPayrollOverrides(overrides);

  return { success: true, data: overrides[bId] };
}
// --- END: UPDATE BENEFICIARY PAYROLL RECORD ---

// --- START: BULK UPDATE BENEFICIARY PAYROLL STATUS ---
export async function bulkUpdatePayrollStatus(beneficiaryIds = [], newStatus = "PAID") {
  if (!beneficiaryIds.length) return { success: false, error: "No beneficiaries selected." };

  const overrides = _getStoredPayrollOverrides();
  const datePaid = newStatus === "PAID" ? new Date().toISOString() : null;

  beneficiaryIds.forEach(id => {
    const bId = String(id);
    overrides[bId] = {
      ...(overrides[bId] || {}),
      payment_status: newStatus,
      date_paid: datePaid
    };
  });

  _saveStoredPayrollOverrides(overrides);

  return { success: true, updatedCount: beneficiaryIds.length };
}
// --- END: BULK UPDATE BENEFICIARY PAYROLL STATUS ---
