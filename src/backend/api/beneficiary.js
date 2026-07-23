import { supabase } from "./supabase.js";

const CACHE_KEY = "spes_beneficiaries_v4";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Batch cache ────────────────────────────────────────────────
const BATCH_CACHE_KEY = "spes_batches_v1";
const BATCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function _readBatchCache() {
  try {
    const raw = localStorage.getItem(BATCH_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > BATCH_CACHE_TTL) { localStorage.removeItem(BATCH_CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function _writeBatchCache(data) {
  try { localStorage.setItem(BATCH_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateBatchCache() {
  try { localStorage.removeItem(BATCH_CACHE_KEY); } catch {}
}

export async function fetchBatches({ forceRefresh = false, created_by_staff_id = undefined } = {}) {
  if (!forceRefresh && created_by_staff_id === undefined) {
    const cached = _readBatchCache();
    if (cached) return { data: cached, fromCache: true };
  }
  
  let query = supabase
    .from("batch")
    .select("*")
    .order("batch_number", { ascending: true });
    
  if (created_by_staff_id !== undefined) {
    query = query.or(`created_by_staff_id.is.null,created_by_staff_id.eq.${created_by_staff_id}`);
  }
  
  const { data, error } = await query;
  
  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] fetch error:", error.code, error.hint);
    return { data: [], error: "Unable to load batches." };
  }
  
  const records = data ?? [];
  if (created_by_staff_id === undefined) {
    _writeBatchCache(records);
  }
  return { data: records };
}

export async function addBatch(payload) {
  let num, name, staff_id;
  if (typeof payload === 'object' && payload !== null) {
      num = parseInt(payload.batchNumber, 10);
      name = payload.batchName || null;
      staff_id = payload.created_by_staff_id || null;
  } else {
      num = parseInt(payload, 10);
  }
  if (!num || num < 1) return { success: false, error: "Invalid batch number." };

  const insertData = { batch_number: num };
  if (name) insertData.batch_name = name;
  if (staff_id) insertData.created_by_staff_id = staff_id;

  const { data, error } = await supabase
    .from("batch")
    .insert([insertData])
    .select()
    .single();
    
  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] insert error:", error.code, error.hint);
    const msg = error.code === "23505"
      ? `Batch ${num} already exists.`
      : "Failed to add batch. Please try again.";
    return { success: false, error: msg };
  }
  
  invalidateBatchCache();
  return { success: true, data };
}

export async function updateBatch(id, payload) {
  const updateData = {};
  if (payload.batchNumber) updateData.batch_number = parseInt(payload.batchNumber, 10);
  if (payload.batchName !== undefined) updateData.batch_name = payload.batchName || null;
  
  if (Object.keys(updateData).length === 0) return { success: false, error: "No data to update." };

  const { data, error } = await supabase
    .from("batch")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();
    
  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] update error:", error.code, error.hint);
    const msg = error.code === "23505" 
      ? `Batch number already exists.`
      : "Failed to update batch. Please try again.";
    return { success: false, error: msg };
  }
  
  invalidateBatchCache();
  return { success: true, data };
}

// ── Cache helpers ──────────────────────────────────────────────
function _readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function _writeCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateBeneficiaryCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

// ── Read ───────────────────────────────────────────────────────
/**
 * Fetch all active (non-archived) beneficiaries.
 * Results are cached for 5 minutes in localStorage.
 * NOTE: Requires `archived_at` column — run migration_beneficiary_archive.sql first.
 */
const ARCHIVE_COL_FLAG = "spes_bene_no_archive_col";

function _archiveColMissing() {
  return sessionStorage.getItem(ARCHIVE_COL_FLAG) === "1";
}

export async function fetchBeneficiaries({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readCache();
    if (cached) return { data: cached, fromCache: true };
  }

  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const isAdmin = session.role === "admin";
  const officeId = session.office_id;
  const isApproved = session.approved === true;

  // Block unapproved staff
  if (!isAdmin && !isApproved) {
    return { data: [], error: "Account Not Approved. List is hidden." };
  }

  let selectStr = "*, batch:batch_id(id, batch_number, batch_name), education:education!beneficiary_educ_id_fkey(id, name), education_level:education_levels!beneficiary_education_level_id_fkey(id, name), gender:gender_id(id, name)";
  if (!isAdmin && officeId) {
    selectStr += ", staffs!staff_id!inner(office_id, full_name)";
  } else {
    // Admin needs this to filter by office later
    selectStr += ", staffs!staff_id(office_id, full_name)";
  }

  let query = supabase
    .from("beneficiary")
    .select(selectStr)
    .order("created_at", { ascending: false });

  if (!isAdmin && officeId) {
    query = query.eq("staffs.office_id", officeId);
  }

  let result = await query;

  // Column doesn't exist yet (migration not run) — cache the flag and retry without filter
  if (result.error?.code === "42703") {
    sessionStorage.setItem(ARCHIVE_COL_FLAG, "1");
    let fallbackQuery = supabase
      .from("beneficiary")
      .select(selectStr)
      .order("created_at", { ascending: false });
    if (!isAdmin && officeId) {
      fallbackQuery = fallbackQuery.eq("staffs.office_id", officeId);
    }
    result = await fallbackQuery;
  }

  // Derive return_status client-side as a fallback if the DB column is missing/null.
  // SPES BABY = same full_name appears in an earlier year_period (returnee); else NEW.
  if (!result.error && Array.isArray(result.data)) {
    processBeneficiaryReturnStatus(result.data);
  }

  if (result.error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] fetch error:", result.error.code, result.error.hint);
    return { data: [], error: "Unable to load beneficiaries. Please try again." };
  }

  const records = result.data ?? [];
  _writeCache(records);
  return { data: records };
}

// ── Create ─────────────────────────────────────────────────────
/**
 * Fetch the latest beneficiaries for dashboard snapshots.
 * This always queries Supabase directly so the dashboard does not reuse a stale full-list cache.
 */
export async function fetchRecentBeneficiaries({ limit = 4 } = {}) {
  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const isAdmin = String(session.role || "").toLowerCase() === "admin";
  const officeId = session.office_id;
  const isApproved = isAdmin || String(session.approved).toLowerCase() === "true";
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 4));

  if (!isApproved) {
    return { data: [], error: "Account Not Approved. List is hidden." };
  }
  if (!isAdmin && !officeId) {
    return { data: [], error: "No office is assigned to this account." };
  }

  let selectStr = "id, full_name, address, month_period, year_period, contact_number, created_at";
  if (!isAdmin) selectStr += ", staffs!staff_id!inner(office_id)";

  let query = supabase
    .from("beneficiary")
    .select(selectStr);

  if (!isAdmin) query = query.eq("staffs.office_id", officeId);
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  const { data, error } = await query;
  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] recent fetch error:", error.code, error.hint);
    return { data: [], error: "Unable to load recent beneficiaries." };
  }

  return { data: data ?? [] };
}
export async function addBeneficiary(payload) {
  const clean = _sanitize(payload);

  // If staff_id was not explicitly provided, try to assign it based on session (for Officers)
  if (clean.staff_id === undefined) {
    try {
      const raw = localStorage.getItem("spes_session");
      if (raw) {
        const session = JSON.parse(raw);
        // Admin doesn't auto-assign their own ID to beneficiaries
        if (session.role !== "admin") {
          clean.staff_id = session.id;
        }
      }
    } catch {}
  }

  if (!clean.full_name) return { success: false, error: "Name of Assured is required." };

  const { data, error } = await supabase
    .from("beneficiary")
    .insert([clean])
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] insert error:", error.code, error.hint);
    return { success: false, error: "Failed to add beneficiary. Please check your input and try again." };
  }

  invalidateBeneficiaryCache();
  return { success: true, data };
}

// ── Update ─────────────────────────────────────────────────────
export async function updateBeneficiary(id, payload) {
  const clean = _sanitize(payload);

  if (!clean.full_name) return { success: false, error: "Name of Assured is required." };

  const { data, error } = await supabase
    .from("beneficiary")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] update error:", error.code, error.hint);
    return { success: false, error: "Failed to update beneficiary. Please try again." };
  }

  invalidateBeneficiaryCache();
  return { success: true, data };
}

// ── Archive (soft delete) ──────────────────────────────────────
/**
 * Soft-deletes a beneficiary by setting archived_at.
 * Requires the archived_at column added by migration_beneficiary_archive.sql.
 */
export async function archiveBeneficiary(id) {
  const { error } = await supabase
    .from("beneficiary")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] archive error:", error.code, error.hint);
    const msg = error.code === "42703"
      ? "Archive is not available yet. Please run the database migration first."
      : "Failed to archive beneficiary. Please try again.";
    return { success: false, error: msg };
  }

  invalidateBeneficiaryCache();
  return { success: true };
}

// ── Education Levels Helper ────────────────────────────────────
const EDU_LEVEL_CACHE_KEY = "spes_edu_levels_v1";

export async function fetchEducationLevels({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(EDU_LEVEL_CACHE_KEY);
      if (raw) return { data: JSON.parse(raw) };
    } catch {}
  }
  const { data, error } = await supabase
    .from("education_levels")
    .select("*")
    .order("education_id", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES EduLevel] fetch error:", error);
    return { data: [] };
  }

  const records = data ?? [];
  try { localStorage.setItem(EDU_LEVEL_CACHE_KEY, JSON.stringify(records)); } catch {}
  return { data: records };
}

// ── Input sanitiser ────────────────────────────────────────────
function _sanitize(p) {
  const str = (v) => String(v ?? "").trim() || null;
  
  let currentStaffId = null;
  try {
    const raw = localStorage.getItem("spes_session");
    if (raw) currentStaffId = JSON.parse(raw).id;
  } catch {}

  const sanitizeEdu = p.educ_id !== undefined ? p.educ_id : p.education_id;
  const sanitizeEduLevel = p.education_level_id !== undefined ? p.education_level_id : (p.edulevel_id !== undefined ? p.edulevel_id : p.edulevel);

  const result = {
    full_name:          String(p.full_name ?? "").trim(),
    address:            str(p.address),
    month_period:       str(p.month_period)?.toUpperCase() ?? null,
    year_period:        str(p.year_period),
    gender_id:          p.gender_id !== "" && p.gender_id != null ? parseInt(p.gender_id, 10) : null,
    designated:         str(p.designated),
    relationship:       str(p.relationship)?.toUpperCase() ?? null,
    contact_number:     str(p.contact_number),
    birthday:           p.birthday || null,
    age:                p.age !== "" && p.age != null ? parseInt(p.age, 10) : null,
    educ_id:            sanitizeEdu !== "" && sanitizeEdu != null ? parseInt(sanitizeEdu, 10) : null,
    education_level_id: sanitizeEduLevel !== "" && sanitizeEduLevel != null && !isNaN(parseInt(sanitizeEduLevel, 10)) ? parseInt(sanitizeEduLevel, 10) : null,
    batch_id:           p.batch_id !== "" && p.batch_id != null ? parseInt(p.batch_id, 10) : null,
  };

  if (p.return_status !== undefined && p.return_status !== null && String(p.return_status).trim() !== "") {
    result.return_status = String(p.return_status).trim().toUpperCase();
  }

  // If a staff_id is explicitly provided (e.g., Admin adding to a specific implementor)
  if (p.staff_id !== undefined) {
    result.staff_id = p.staff_id;
  }

  return result;
}

// ── Standalone helper for return status ──────────────────────────
export function processBeneficiaryReturnStatus(data) {
  if (!Array.isArray(data)) return data;
  const firstYearByName = {};
  data.forEach(b => {
    const key = String(b.full_name ?? "").trim().toLowerCase();
    const yr  = b.year_period != null ? Number(b.year_period) : null;
    if (!key || yr == null) return;
    if (firstYearByName[key] == null || yr < firstYearByName[key]) firstYearByName[key] = yr;
  });
  data.forEach(b => {
    if (b.return_status && String(b.return_status).trim() !== "") {
      b.return_status = String(b.return_status).trim().toUpperCase();
    } else {
      const key = String(b.full_name ?? "").trim().toLowerCase();
      const yr  = b.year_period != null ? Number(b.year_period) : null;
      b.return_status = (key && yr != null && firstYearByName[key] != null && yr > firstYearByName[key])
        ? "SPES BABY" : "NEW";
    }
  });
  return data;
}

// ── Cleanup Helper ──────────────────────────────────────────────
export async function cleanupExtraBatches() {
  // Fetch IDs of batches 3, 4, 5, 6
  const { data: batches, error } = await supabase
    .from("batch")
    .select("id, batch_number")
    .in("batch_number", [3, 4, 5, 6]);

  if (error || !batches) {
    if (import.meta.env.DEV) console.error("[SPES Batch] fetch for cleanup error:", error);
    return { success: false, error: "Failed to fetch batches for cleanup." };
  }

  const batch3 = batches.find(b => b.batch_number === 3);
  const badBatches = batches.filter(b => [4, 5, 6].includes(b.batch_number));

  if (!batch3) return { success: false, error: "Batch 3 does not exist to receive transfers." };
  if (badBatches.length === 0) return { success: true, message: "No batches 4, 5, or 6 found." };

  const badBatchIds = badBatches.map(b => b.id);

  // 1. Transfer beneficiaries from 4, 5, 6 to batch 3
  const { error: updateErr } = await supabase
    .from("beneficiary")
    .update({ batch_id: batch3.id })
    .in("batch_id", badBatchIds);

  if (updateErr) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] transfer error:", updateErr);
    return { success: false, error: "Failed to transfer beneficiaries to Batch 3." };
  }

  // 2. Delete batches 4, 5, 6
  const { error: delErr } = await supabase
    .from("batch")
    .delete()
    .in("id", badBatchIds);

  if (delErr) {
    if (import.meta.env.DEV) console.error("[SPES Batch] delete error:", delErr);
    return { success: false, error: "Failed to delete extra batches." };
  }

  invalidateBatchCache();
  invalidateBeneficiaryCache();
  return { success: true, message: "Successfully transferred beneficiaries to Batch 3 and deleted batches 4, 5, 6." };
}
