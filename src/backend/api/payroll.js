/**
 * SPES Portal — Payroll API & Calculation Service
 * ────────────────────────────────────────────────
 * Provides budget analytics, stipend calculations, disbursement tracking,
 * dynamic 50-item chunked BATCH grouping with ET.AL headers, and database persistence.
 */

import { fetchBeneficiaries, fetchBatches } from "./beneficiary.js";
import {
  fetchDbPayrollRecords,
  upsertDbPayrollRecord,
  bulkUpsertDbPayrollStatus,
  bulkUpsertDbPayrollRecords,
  fetchDbPayrollBudgets,
  upsertDbPayrollBudget,
  invalidatePayrollCache,
  subscribeToPayrollRealtime,
} from "./payroll-db.js";

// Standard SPES stipend baseline
export const DEFAULT_STIPEND_RATE = 5133.00;
export const DEFAULT_WORK_DAYS = 20;
export const BATCH_CHUNK_SIZE = 50;

// Re-export budget, cache & realtime functions for components
export { fetchDbPayrollBudgets, upsertDbPayrollBudget, invalidatePayrollCache, subscribeToPayrollRealtime, fetchBatches };

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

    const status = String(p.payment_status || (b.is_paid ? "PAID" : "PENDING")).trim().toUpperCase();
    if (status === "PAID") {
      totalPaid += amount;
    } else {
      // Any beneficiary not yet paid is pending disbursement
      totalPending += amount;
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

// --- START: DYNAMIC SOFT-API BATCH & PAYROLL 50-ITEM CHUNKING ---
/**
 * Groups office beneficiaries by their assigned database Batch (from beneficiary API)
 * sorted alphabetically A-Z, chunking every 50 records into structured Payroll sheets:
 * e.g. "BATCH 1 - PAYROLL 1", "BATCH 1 - PAYROLL 1.2", "BATCH 2 - PAYROLL 2", "BATCH 2 - PAYROLL 2.2".
 *
 * @param {Array} officeBeneficiaries - Beneficiaries belonging to the selected office
 * @param {number} chunkSize - Maximum records per payroll sheet (default 50)
 * @returns {Array} List of structured payroll batch chunk cards
 */
export function groupOfficeBeneficiariesIntoChunks(officeBeneficiaries = [], chunkSize = BATCH_CHUNK_SIZE, sortMode = "default", customOrderIdsMap = {}) {
  if (!Array.isArray(officeBeneficiaries) || officeBeneficiaries.length === 0) {
    return [];
  }

  // 1. Group beneficiaries by assigned batch_id
  const batchGroupsMap = new Map();

  officeBeneficiaries.forEach((bene) => {
    const rawBatchId = bene.batch_id ?? bene.batch?.id ?? null;
    const rawBatchName = bene.batch?.batch_name
      ? String(bene.batch.batch_name).trim()
      : (rawBatchId !== null && rawBatchId !== undefined ? `BATCH ${rawBatchId}` : "UNASSIGNED");

    const groupKey = rawBatchId !== null && rawBatchId !== undefined ? String(rawBatchId) : "unassigned";

    if (!batchGroupsMap.has(groupKey)) {
      batchGroupsMap.set(groupKey, {
        batchId: rawBatchId,
        batchName: rawBatchName,
        beneficiaries: [],
      });
    }

    batchGroupsMap.get(groupKey).beneficiaries.push(bene);
  });

  // 2. Sort batches in logical sequence (Batch 1, Batch 2, ..., Unassigned at end)
  const sortedBatchGroups = Array.from(batchGroupsMap.values()).sort((a, b) => {
    if (a.batchId === null) return 1;
    if (b.batchId === null) return -1;
    const numA = Number(a.batchId);
    const numB = Number(b.batchId);
    if (!isNaN(numA) && !isNaN(numB)) {
      return numA - numB;
    }
    return String(a.batchName).localeCompare(String(b.batchName), undefined, { numeric: true, sensitivity: "base" });
  });

  // 3. For each DB Batch, sort or arrange beneficiaries and chunk into 50-item sheets
  const resultBatches = [];
  let globalSequentialIndex = 1;

  sortedBatchGroups.forEach((group) => {
    const groupKey = group.batchId !== null && group.batchId !== undefined ? String(group.batchId) : "unassigned";
    let sortedBene = [...group.beneficiaries];

    if (sortMode === "name_asc") {
      sortedBene.sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
    } else if (sortMode === "name_desc") {
      sortedBene.sort((a, b) => String(b.full_name || "").localeCompare(String(a.full_name || "")));
    } else if (sortMode === "default" && customOrderIdsMap && Array.isArray(customOrderIdsMap[groupKey])) {
      const orderIds = customOrderIdsMap[groupKey].map(String);
      sortedBene.sort((a, b) => {
        const idxA = orderIds.indexOf(String(a.id));
        const idxB = orderIds.indexOf(String(b.id));
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }

    const totalInBatch = sortedBene.length;
    if (totalInBatch === 0) return;

    // Parse base batch number for naming (e.g. "BATCH 1" -> 1, "Batch 2" -> 2)
    const matchNum = group.batchName.match(/\d+/);
    const baseBatchNum = matchNum ? parseInt(matchNum[0], 10) : (group.batchId ? parseInt(group.batchId, 10) : globalSequentialIndex);
    const normalizedBatchLabel = group.batchName.toUpperCase();

    let chunkIndex = 1;
    for (let i = 0; i < totalInBatch; i += chunkSize) {
      const chunk = sortedBene.slice(i, i + chunkSize);
      const firstBene = chunk[0];
      const rawFirstName = String(firstBene.full_name || "").trim().toUpperCase();
      const etAlName = chunk.length > 1 ? `${rawFirstName} ET. AL.` : rawFirstName;
      const contractPeriod = firstBene.payroll?.contract_period || "JULY 2026";

      let totalPrincipal = 0;
      let totalPaid = 0;
      let totalPending = 0;

      chunk.forEach((b) => {
        const amt = Number(b.payroll?.stipend_amount) || DEFAULT_STIPEND_RATE;
        totalPrincipal += amt;
        if (b.payroll?.payment_status === "PAID") {
          totalPaid += amt;
        } else {
          totalPending += amt;
        }
      });

      // Payroll numbering logic:
      // First chunk (1-50): "PAYROLL 1" / "P1" (or "PAYROLL 2" / "P2" for Batch 2)
      // Second chunk (51-100): "PAYROLL 1.2" / "P1.2" (or "PAYROLL 2.2" / "P2.2")
      // Third chunk (101-150): "PAYROLL 1.3" / "P1.3" (or "PAYROLL 2.3" / "P2.3")
      const payrollNum = chunkIndex === 1
        ? `${baseBatchNum || globalSequentialIndex}`
        : `${baseBatchNum || globalSequentialIndex}.${chunkIndex}`;

      const payrollLabel = `PAYROLL ${payrollNum}`;
      const shortPayrollLabel = `P${payrollNum}`;
      const shortBatchLabel = `B${baseBatchNum || globalSequentialIndex}`;
      const shortCode = `${shortBatchLabel} - ${shortPayrollLabel}`;
      const fullCardName = `${normalizedBatchLabel} - ${payrollLabel}`;

      resultBatches.push({
        batchId: `batch_${group.batchId ?? 'unassigned'}_p${chunkIndex}`,
        batchIndex: globalSequentialIndex,
        dbBatchId: group.batchId,
        dbBatchName: normalizedBatchLabel,
        payrollLabel,
        shortCode,
        shortLabel: shortCode,
        batchName: fullCardName,
        fullBatchTitle: fullCardName,
        etAlName,
        firstBeneficiary: firstBene,
        beneficiaries: chunk,
        totalPrincipal,
        totalPaid,
        totalPending,
        contractPeriod,
        startIndex: i,
        endIndex: Math.min(i + chunkSize, totalInBatch),
        totalInDbBatch: totalInBatch,
      });

      globalSequentialIndex++;
      chunkIndex++;
    }
  });

  return resultBatches;
}
// --- END: DYNAMIC SOFT-API BATCH & PAYROLL 50-ITEM CHUNKING ---

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

// --- START: BULK UPDATE BENEFICIARY PAYROLL RECORDS IN DATABASE ---
/**
 * Batch updates arbitrary payroll fields (stipend, work days, notes, payment status) in Supabase for selected beneficiaries.
 *
 * @param {Array<{ beneficiaryId: string|number, officeId?: string|number|null }|string|number>} beneficiaryItems
 * @param {object} commonUpdates
 * @param {string|number|null} staffId
 * @returns {Promise<{ success: boolean, updatedCount?: number, error?: string }>}
 */
export async function bulkUpdatePayrollRecords(beneficiaryItems = [], commonUpdates = {}, staffId = null) {
  return await bulkUpsertDbPayrollRecords(beneficiaryItems, commonUpdates, staffId);
}
// --- END: BULK UPDATE BENEFICIARY PAYROLL RECORDS IN DATABASE ---
