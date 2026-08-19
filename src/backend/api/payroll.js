/**
 * SPES Portal — Payroll API & Calculation Service
 * ────────────────────────────────────────────────
 * Provides budget analytics, stipend calculations, disbursement tracking,
 * dynamic 50-item chunked BATCH grouping with ET.AL headers, and database persistence.
 */

import { fetchBeneficiaries } from "./beneficiary.js";
import {
  fetchDbPayrollRecords,
  upsertDbPayrollRecord,
  bulkUpsertDbPayrollStatus,
  fetchDbPayrollBudgets,
  upsertDbPayrollBudget,
  invalidatePayrollCache,
} from "./payroll-db.js";

// Standard SPES stipend baseline
export const DEFAULT_STIPEND_RATE = 5133.00;
export const DEFAULT_WORK_DAYS = 20;
export const BATCH_CHUNK_SIZE = 50;

// Re-export budget & cache functions for components
export { fetchDbPayrollBudgets, upsertDbPayrollBudget, invalidatePayrollCache };

// --- START: ATTACH PAYROLL METADATA TO BENEFICIARY RECORD ---
/**
 * Enriches a beneficiary object with its corresponding database payroll record.
 * Contract period is cleanly derived from `month_period` and `year_period`.
 *
 * @param {object} beneficiary
 * @param {object|null} dbRecord
 * @returns {object}
 */
export function enrichBeneficiaryWithPayroll(beneficiary, dbRecord = null) {
  const stipendAmount = dbRecord?.stipend_amount !== undefined && dbRecord?.stipend_amount !== null
    ? Number(dbRecord.stipend_amount)
    : DEFAULT_STIPEND_RATE;

  const daysWorked = dbRecord?.days_worked !== undefined && dbRecord?.days_worked !== null
    ? Number(dbRecord.days_worked)
    : DEFAULT_WORK_DAYS;

  const ratePerDay = daysWorked > 0 ? (stipendAmount / daysWorked) : (DEFAULT_STIPEND_RATE / DEFAULT_WORK_DAYS);

  // If there's an explicit record in DB, use it; otherwise default is PENDING
  const paymentStatus = dbRecord?.payment_status || (beneficiary.is_paid ? "PAID" : "PENDING");
  const datePaid = dbRecord?.date_paid || (paymentStatus === "PAID" ? (beneficiary.updated_at || new Date().toISOString()) : null);
  const contractPeriod = [beneficiary.month_period, beneficiary.year_period].filter(Boolean).join(" ") || "JULY 2026";

  return {
    ...beneficiary,
    payroll: {
      id: dbRecord?.id || null,
      stipend_amount: stipendAmount,
      days_worked: daysWorked,
      rate_per_day: ratePerDay,
      payment_status: paymentStatus,
      date_paid: datePaid,
      contract_period: contractPeriod,
      notes: dbRecord?.notes || "",
    }
  };
}
// --- END: ATTACH PAYROLL METADATA TO BENEFICIARY RECORD ---

// --- START: FETCH ENRICHED BENEFICIARY PAYROLL ROSTER ---
/**
 * Fetches beneficiaries and merges their database payroll records in O(1) time via Map.
 *
 * @param {{ forceRefresh?: boolean, officeId?: string|number|null }} options
 * @returns {Promise<{ data: Array, error?: string }>}
 */
export async function fetchBeneficiaryPayrollRoster({ forceRefresh = false, officeId = null } = {}) {
  // Parallel fetch: beneficiaries and DB payroll records
  const [beneRes, payrollRes] = await Promise.all([
    fetchBeneficiaries({ forceRefresh }),
    fetchDbPayrollRecords({ forceRefresh, officeId }),
  ]);

  if (beneRes.error) {
    return { data: [], error: beneRes.error };
  }

  const beneficiaries = beneRes.data || [];
  const payrollRecords = payrollRes.data || [];

  // Create fast O(1) lookup Map by beneficiary_id
  const payrollMap = new Map();
  payrollRecords.forEach(rec => {
    if (rec.beneficiary_id) {
      payrollMap.set(String(rec.beneficiary_id), rec);
    }
  });

  // Filter out archived beneficiaries and enrich with payroll data
  let list = beneficiaries
    .filter(b => !b.archived_at)
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")))
    .map(b => {
      const dbRec = payrollMap.get(String(b.id)) || null;
      return enrichBeneficiaryWithPayroll(b, dbRec);
    });

  if (officeId && officeId !== "ALL" && officeId !== "all") {
    list = list.filter(b => String(b.staffs?.office_id) === String(officeId));
  }

  return { data: list };
}
// --- END: FETCH ENRICHED BENEFICIARY PAYROLL ROSTER ---

// --- START: COMPUTE PAYROLL EXECUTIVE SUMMARY STATS ---
/**
 * Computes global / office payroll statistics from an array of enriched beneficiaries.
 * Pure JS calculation to ensure lightweight, zero-drift aggregates.
 *
 * @param {Array} beneficiariesList
 * @param {number|null} customGeneralBudget
 * @returns {object}
 */
export function computePayrollExecutiveSummary(beneficiariesList = [], customGeneralBudget = null) {
  let calculatedBudget = 0;
  let totalPaid = 0;
  let totalPending = 0;
  let totalUnpaid = 0;

  beneficiariesList.forEach(b => {
    const p = b.payroll || {};
    const amount = Number(p.stipend_amount) || DEFAULT_STIPEND_RATE;
    calculatedBudget += amount;

    if (p.payment_status === "PAID") {
      totalPaid += amount;
    } else if (p.payment_status === "PENDING") {
      totalPending += amount;
    } else {
      totalUnpaid += amount;
    }
  });

  const customBudgetNum = Number(customGeneralBudget);
  const totalBudget = Number.isFinite(customBudgetNum) && customBudgetNum > 0 ? customBudgetNum : calculatedBudget;
  const remainingBalance = Math.max(0, totalBudget - totalPaid);

  return {
    totalBeneficiaries: beneficiariesList.length,
    totalBudget,
    calculatedBudget,
    isCustomBudget: Number.isFinite(customBudgetNum) && customBudgetNum > 0,
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
/**
 * Chunks office beneficiaries into standard 50-item batches with alphabetical ET.AL titling.
 *
 * @param {Array} officeBeneficiaries
 * @param {number} chunkSize
 * @returns {Array}
 */
export function groupOfficeBeneficiariesIntoChunks(officeBeneficiaries = [], chunkSize = BATCH_CHUNK_SIZE) {
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

// --- START: UPDATE BENEFICIARY PAYROLL RECORD IN DATABASE ---
/**
 * Persists an edited beneficiary payroll record to Supabase.
 *
 * @param {string|number} beneficiaryId
 * @param {object} payload
 * @param {string|number|null} officeId
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export async function updateBeneficiaryPayrollRecord(beneficiaryId, payload = {}, officeId = null) {
  return await upsertDbPayrollRecord(beneficiaryId, officeId, payload);
}
// --- END: UPDATE BENEFICIARY PAYROLL RECORD IN DATABASE ---

// --- START: BULK UPDATE BENEFICIARY PAYROLL STATUS IN DATABASE ---
/**
 * Batch updates payment statuses to Supabase (e.g. PAID or PENDING) for selected beneficiaries.
 *
 * @param {Array<{ beneficiaryId: string|number, officeId?: string|number|null }|string|number>} beneficiaryItems
 * @param {string} newStatus
 * @param {string|number|null} staffId
 * @returns {Promise<{ success: boolean, updatedCount?: number, error?: string }>}
 */
export async function bulkUpdatePayrollStatus(beneficiaryItems = [], newStatus = "PAID", staffId = null) {
  return await bulkUpsertDbPayrollStatus(beneficiaryItems, newStatus, staffId);
}
// --- END: BULK UPDATE BENEFICIARY PAYROLL STATUS IN DATABASE ---
