/**
 * SPES Portal — Payroll Database Access Service
 * ──────────────────────────────────────────────
 * Provides direct Supabase CRUD access for `payroll_records` and `payroll_budgets`
 * tables with high-performance local caching and optimistic response support.
 */

import { supabase } from "./supabase.js";

// Cache Keys & TTL (5 minutes)
const PAYROLL_RECORDS_CACHE_KEY = "spes_payroll_records_v1";
const PAYROLL_BUDGETS_CACHE_KEY = "spes_payroll_budgets_v1";
const PAYROLL_CACHE_TTL = 5 * 60 * 1000;

// --- START: READ / WRITE PAYROLL LOCAL CACHE HELPERS ---
function _readLocalCache(key, ttl = PAYROLL_CACHE_TTL) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function _writeLocalCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

export function invalidatePayrollCache() {
  try {
    localStorage.removeItem(PAYROLL_RECORDS_CACHE_KEY);
    localStorage.removeItem(PAYROLL_BUDGETS_CACHE_KEY);
    localStorage.removeItem("spes_beneficiary_payroll_v3"); // legacy mock key cleanup
  } catch {}
}
// --- END: READ / WRITE PAYROLL LOCAL CACHE HELPERS ---

// --- START: FETCH PAYROLL RECORDS FROM DATABASE ---
/**
 * Fetches all saved beneficiary payroll records from Supabase.
 * Uses local caching to provide instant UI loads with background revalidation.
 *
 * @param {{ forceRefresh?: boolean, officeId?: string|number|null }} options
 * @returns {Promise<{ data: Array, error?: string }>}
 */
export async function fetchDbPayrollRecords({ forceRefresh = false, officeId = null } = {}) {
  const cacheKey = `${PAYROLL_RECORDS_CACHE_KEY}:${officeId || "all"}`;
  
  if (!forceRefresh) {
    const cached = _readLocalCache(cacheKey);
    if (cached && Array.isArray(cached)) {
      return { data: cached, fromCache: true };
    }
  }

  try {
    let query = supabase
      .from("payroll_records")
      .select("id, beneficiary_id, office_id, stipend_amount, days_worked, payment_status, date_paid, paid_at, paid_by, notes, created_at, updated_at")
      .order("id", { ascending: true });

    if (officeId && officeId !== "ALL" && officeId !== "all") {
      query = query.eq("office_id", officeId);
    }

    const { data, error } = await query;

    if (error) {
      // If table does not exist yet (code 42P01), fail gracefully to let app function
      if (error.code === "42P01") {
        if (import.meta.env.DEV) {
          console.warn("[SPES Payroll DB] payroll_records table not found. Please run the migration script.");
        }
        return { data: [], error: "Table not migrated yet." };
      }
      if (import.meta.env.DEV) {
        console.error("[SPES Payroll DB] fetchDbPayrollRecords error:", error.code, error.message);
      }
      return { data: [], error: error.message };
    }

    const records = data || [];
    _writeLocalCache(cacheKey, records);
    return { data: records, error: null };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[SPES Payroll DB] fetchDbPayrollRecords catch:", err?.message);
    }
    return { data: [], error: "Failed to connect to payroll database." };
  }
}
// --- END: FETCH PAYROLL RECORDS FROM DATABASE ---

// --- START: UPSERT SINGLE BENEFICIARY PAYROLL RECORD ---
/**
 * Creates or updates a single beneficiary's payroll record in Supabase.
 *
 * @param {string|number} beneficiaryId
 * @param {string|number|null} officeId
 * @param {object} payload
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export async function upsertDbPayrollRecord(beneficiaryId, officeId = null, payload = {}) {
  const bId = Number(beneficiaryId);
  if (!bId || isNaN(bId)) {
    return { success: false, error: "Invalid beneficiary ID." };
  }

  const cleanOfficeId = officeId ? Number(officeId) : null;
  const paymentStatus = payload.payment_status || "PENDING";
  const stipendAmount = payload.stipend_amount !== undefined ? Number(payload.stipend_amount) : 5133.00;
  const daysWorked = payload.days_worked !== undefined ? Number(payload.days_worked) : 20;
  const datePaid = paymentStatus === "PAID" ? (payload.date_paid || new Date().toISOString()) : null;
  const paidAt = paymentStatus === "PAID" ? (payload.paid_at || payload.date_paid || new Date().toISOString()) : null;
  const notes = payload.notes !== undefined ? String(payload.notes).trim() : null;
  const updatedBy = payload.updated_by ? Number(payload.updated_by) : null;
  const paidBy = paymentStatus === "PAID" ? (payload.paid_by ? Number(payload.paid_by) : updatedBy) : null;

  const recordPayload = {
    beneficiary_id: bId,
    office_id: cleanOfficeId,
    stipend_amount: stipendAmount,
    days_worked: daysWorked,
    payment_status: paymentStatus,
    date_paid: datePaid,
    paid_at: paidAt,
    notes: notes,
    updated_at: new Date().toISOString(),
  };

  if (updatedBy) {
    recordPayload.updated_by = updatedBy;
  }
  if (paidBy) {
    recordPayload.paid_by = paidBy;
  }

  try {
    const { data, error } = await supabase
      .from("payroll_records")
      .upsert(recordPayload, { onConflict: "beneficiary_id" })
      .select()
      .single();

    if (error) {
      if (import.meta.env.DEV) {
        console.error("[SPES Payroll DB] upsertDbPayrollRecord error:", error.code, error.message);
      }
      return { success: false, error: error.message };
    }

    invalidatePayrollCache();
    return { success: true, data };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[SPES Payroll DB] upsertDbPayrollRecord catch:", err?.message);
    }
    return { success: false, error: "An unexpected database error occurred." };
  }
}
// --- END: UPSERT SINGLE BENEFICIARY PAYROLL RECORD ---

// --- START: BULK UPSERT BENEFICIARY PAYROLL STATUS ---
/**
 * Batch updates or inserts payment statuses (e.g. PAID or PENDING) for multiple beneficiaries.
 *
 * @param {Array<{ beneficiaryId: string|number, officeId?: string|number|null }>} items
 * @param {string} newStatus
 * @param {string|number|null} staffId
 * @returns {Promise<{ success: boolean, updatedCount?: number, error?: string }>}
 */
export async function bulkUpsertDbPayrollStatus(items = [], newStatus = "PAID", staffId = null) {
  if (!items || items.length === 0) {
    return { success: false, error: "No beneficiaries selected." };
  }

  const now = new Date().toISOString();
  const datePaid = newStatus === "PAID" ? now : null;
  const paidAt = newStatus === "PAID" ? now : null;
  const cleanStaffId = staffId ? Number(staffId) : null;

  const recordsToUpsert = items.map(item => {
    const bId = typeof item === "object" ? Number(item.beneficiaryId || item.id) : Number(item);
    const offId = typeof item === "object" ? (item.officeId ? Number(item.officeId) : null) : null;
    const stipend = typeof item === "object" && item.stipend_amount !== undefined ? Number(item.stipend_amount) : 5133.00;
    const days = typeof item === "object" && item.days_worked !== undefined ? Number(item.days_worked) : 20;

    const row = {
      beneficiary_id: bId,
      office_id: offId,
      stipend_amount: stipend,
      days_worked: days,
      payment_status: newStatus,
      date_paid: datePaid,
      paid_at: paidAt,
      updated_at: now,
    };

    if (cleanStaffId) {
      row.updated_by = cleanStaffId;
      if (newStatus === "PAID") {
        row.paid_by = cleanStaffId;
      }
    }
    return row;
  }).filter(r => Boolean(r.beneficiary_id));

  if (recordsToUpsert.length === 0) {
    return { success: false, error: "No valid beneficiary records to update." };
  }

  try {
    // Process in chunks of 100 for maximum performance
    const CHUNK_SIZE = 100;
    for (let i = 0; i < recordsToUpsert.length; i += CHUNK_SIZE) {
      const chunk = recordsToUpsert.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from("payroll_records")
        .upsert(chunk, { onConflict: "beneficiary_id" });

      if (error) {
        if (import.meta.env.DEV) {
          console.error("[SPES Payroll DB] bulkUpsertDbPayrollStatus error:", error.code, error.message);
        }
        return { success: false, error: error.message };
      }
    }

    invalidatePayrollCache();
    return { success: true, updatedCount: recordsToUpsert.length };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[SPES Payroll DB] bulkUpsertDbPayrollStatus catch:", err?.message);
    }
    return { success: false, error: "Failed to batch update payroll records in database." };
  }
}
// --- START: BULK UPSERT BENEFICIARY PAYROLL RECORDS ---
/**
 * Batch updates or inserts arbitrary payroll fields (stipend_amount, days_worked, notes, payment_status) in Supabase.
 *
 * @param {Array<{ beneficiaryId: string|number, officeId?: string|number|null, stipend_amount?: number, days_worked?: number, payment_status?: string, notes?: string }>} items
 * @param {object} commonUpdates
 * @param {string|number|null} staffId
 * @returns {Promise<{ success: boolean, updatedCount?: number, error?: string }>}
 */
export async function bulkUpsertDbPayrollRecords(items = [], commonUpdates = {}, staffId = null) {
  if (!items || items.length === 0) {
    return { success: false, error: "No beneficiaries selected." };
  }

  const now = new Date().toISOString();
  const cleanStaffId = staffId ? Number(staffId) : null;

  const recordsToUpsert = items.map(item => {
    const bId = typeof item === "object" ? Number(item.beneficiaryId || item.id) : Number(item);
    const offId = typeof item === "object" ? (item.officeId ? Number(item.officeId) : null) : null;

    const stipend = commonUpdates.stipend_amount !== undefined
      ? Number(commonUpdates.stipend_amount)
      : (typeof item === "object" && item.stipend_amount !== undefined ? Number(item.stipend_amount) : 5133.00);

    const days = commonUpdates.days_worked !== undefined
      ? Number(commonUpdates.days_worked)
      : (typeof item === "object" && item.days_worked !== undefined ? Number(item.days_worked) : 20);

    const status = commonUpdates.payment_status !== undefined
      ? commonUpdates.payment_status
      : (typeof item === "object" && item.payment_status ? item.payment_status : "PENDING");

    const notes = commonUpdates.notes !== undefined
      ? String(commonUpdates.notes).trim()
      : (typeof item === "object" && item.notes !== undefined ? String(item.notes).trim() : null);

    const datePaid = status === "PAID"
      ? (typeof item === "object" && item.date_paid ? item.date_paid : now)
      : null;
    const paidAt = status === "PAID"
      ? (typeof item === "object" && item.paid_at ? item.paid_at : (typeof item === "object" && item.date_paid ? item.date_paid : now))
      : null;

    const row = {
      beneficiary_id: bId,
      office_id: offId,
      stipend_amount: stipend,
      days_worked: days,
      payment_status: status,
      date_paid: datePaid,
      paid_at: paidAt,
      notes: notes,
      updated_at: now,
    };

    if (cleanStaffId) {
      row.updated_by = cleanStaffId;
      if (status === "PAID") {
        row.paid_by = cleanStaffId;
      }
    }
    return row;
  }).filter(r => Boolean(r.beneficiary_id));

  if (recordsToUpsert.length === 0) {
    return { success: false, error: "No valid beneficiary records to update." };
  }

  try {
    const CHUNK_SIZE = 100;
    for (let i = 0; i < recordsToUpsert.length; i += CHUNK_SIZE) {
      const chunk = recordsToUpsert.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from("payroll_records")
        .upsert(chunk, { onConflict: "beneficiary_id" });

      if (error) {
        if (import.meta.env.DEV) {
          console.error("[SPES Payroll DB] bulkUpsertDbPayrollRecords error:", error.code, error.message);
        }
        return { success: false, error: error.message };
      }
    }

    invalidatePayrollCache();
    return { success: true, updatedCount: recordsToUpsert.length };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[SPES Payroll DB] bulkUpsertDbPayrollRecords catch:", err?.message);
    }
    return { success: false, error: "Failed to batch update payroll records in database." };
  }
}
// --- END: BULK UPSERT BENEFICIARY PAYROLL RECORDS ---

// --- START: FETCH PAYROLL BUDGETS (GENERAL & PER-OFFICE) ---
/**
 * Fetches general and per-office custom budget allocations from Supabase.
 *
 * @param {{ forceRefresh?: boolean }} options
 * @returns {Promise<{ generalBudget: number|null, officeBudgets: object, raw: Array, error?: string }>}
 */
export async function fetchDbPayrollBudgets({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readLocalCache(PAYROLL_BUDGETS_CACHE_KEY);
    if (cached && typeof cached === "object") {
      return { ...cached, fromCache: true };
    }
  }

  try {
    const { data, error } = await supabase
      .from("payroll_budgets")
      .select("id, office_id, amount, set_by, updated_at, modified_by, modified_at");

    if (error) {
      if (error.code === "42P01") {
        return { generalBudget: null, officeBudgets: {}, raw: [] };
      }
      if (import.meta.env.DEV) {
        console.error("[SPES Payroll DB] fetchDbPayrollBudgets error:", error.code, error.message);
      }
      return { generalBudget: null, officeBudgets: {}, raw: [], error: error.message };
    }

    let generalBudget = null;
    const officeBudgets = {};

    (data || []).forEach(row => {
      const amt = Number(row.amount);
      if (row.office_id === null || row.office_id === undefined) {
        generalBudget = Number.isFinite(amt) ? amt : null;
      } else {
        officeBudgets[String(row.office_id)] = Number.isFinite(amt) ? amt : null;
      }
    });

    const result = { generalBudget, officeBudgets, raw: data || [] };
    _writeLocalCache(PAYROLL_BUDGETS_CACHE_KEY, result);
    return result;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[SPES Payroll DB] fetchDbPayrollBudgets catch:", err?.message);
    }
    return { generalBudget: null, officeBudgets: {}, raw: [], error: "Failed to fetch budgets." };
  }
}
// --- END: FETCH PAYROLL BUDGETS (GENERAL & PER-OFFICE) ---

// --- START: UPSERT PAYROLL BUDGET ALLOCATION ---
/**
 * Saves or updates a custom budget in Supabase.
 * If `officeId` is null, updates the General/Global Total Budget.
 * If `officeId` is provided, updates the specific Office Budget.
 *
 * @param {string|number|null} officeId
 * @param {number} amount
 * @param {string|number|null} staffId
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export async function upsertDbPayrollBudget(officeId = null, amount = 0, staffId = null) {
  const cleanAmount = Number(amount);
  if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
    return { success: false, error: "Invalid budget amount." };
  }

  const cleanOfficeId = officeId !== null && officeId !== undefined && officeId !== "general"
    ? Number(officeId)
    : null;

  const payload = {
    office_id: cleanOfficeId,
    amount: cleanAmount,
    updated_at: new Date().toISOString(),
    modified_at: new Date().toISOString(),
  };

  if (staffId) {
    payload.set_by = Number(staffId);
    payload.modified_by = Number(staffId);
  }

  try {
    const { data, error } = await supabase
      .from("payroll_budgets")
      .upsert(payload, { onConflict: "office_id" })
      .select()
      .single();

    if (error) {
      if (import.meta.env.DEV) {
        console.error("[SPES Payroll DB] upsertDbPayrollBudget error:", error.code, error.message);
      }
      return { success: false, error: error.message };
    }

    invalidatePayrollCache();
    return { success: true, data };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error("[SPES Payroll DB] upsertDbPayrollBudget catch:", err?.message);
    }
    return { success: false, error: "Failed to save budget in database." };
  }
}
// --- END: UPSERT PAYROLL BUDGET ALLOCATION ---

// --- START: REALTIME PAYROLL SYNCHRONIZATION SERVICE ---
/**
 * Sets up Supabase Realtime subscription on `payroll_records`, `payroll_budgets`,
 * `beneficiary`, and `batch` tables, along with cross-tab Storage and window focus listeners.
 * Includes proper lifecycle teardown for Back-Forward Cache (bfcache) compatibility.
 * 
 * @param {Function} onDataChange - Callback invoked when remote or local data changes
 * @returns {Function} Unsubscribe / teardown cleanup function
 */
export function subscribeToPayrollRealtime(onDataChange) {
  if (typeof onDataChange !== "function") return () => {};

  let debounceTimer = null;
  let isCleanedUp = false;

  const triggerSync = (origin = "realtime") => {
    if (isCleanedUp) return;
    invalidatePayrollCache();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!isCleanedUp) {
        onDataChange({ origin });
      }
    }, 200);
  };

  const channelId = `spes-payroll-sync-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let channel = supabase
    .channel(channelId)
    .on("postgres_changes", { event: "*", schema: "public", table: "payroll_records" }, () => triggerSync("payroll_records"))
    .on("postgres_changes", { event: "*", schema: "public", table: "payroll_budgets" }, () => triggerSync("payroll_budgets"))
    .on("postgres_changes", { event: "*", schema: "public", table: "beneficiary" }, () => triggerSync("beneficiary"))
    .on("postgres_changes", { event: "*", schema: "public", table: "batch" }, () => triggerSync("batch"))
    .subscribe((status) => {
      if (import.meta.env.DEV && status !== "CLOSED") {
        console.info("[SPES Payroll Realtime] Status:", status);
      }
    });

  // Cross-tab storage synchronization
  const handleStorageChange = (e) => {
    if (e.key && (e.key.startsWith("spes_payroll_") || e.key.startsWith("spes_beneficiaries_") || e.key.startsWith("spes_batches_"))) {
      triggerSync("storage");
    }
  };
  window.addEventListener("storage", handleStorageChange);

  // Tab visibility reconciliation
  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      triggerSync("visibility");
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // Back-Forward Cache (bfcache) & Page Lifecycle Handlers
  const handlePageHide = () => {
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch {}
    }
  };

  const handlePageShow = (e) => {
    if (e.persisted && !isCleanedUp) {
      triggerSync("bfcache-restore");
    }
  };

  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("beforeunload", handlePageHide);

  return () => {
    isCleanedUp = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    window.removeEventListener("storage", handleStorageChange);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("beforeunload", handlePageHide);
    if (channel) {
      try {
        supabase.removeChannel(channel);
      } catch {}
      channel = null;
    }
  };
}
// --- END: REALTIME PAYROLL SYNCHRONIZATION SERVICE ---
