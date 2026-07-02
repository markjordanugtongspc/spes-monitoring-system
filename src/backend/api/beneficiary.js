import { supabase } from "./supabase.js";

const CACHE_KEY = "spes_beneficiaries_v3";
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

export async function fetchBatches({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readBatchCache();
    if (cached) return { data: cached, fromCache: true };
  }
  const { data, error } = await supabase
    .from("batch")
    .select("*")
    .order("batch_number", { ascending: true });
  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] fetch error:", error.code, error.hint);
    return { data: [], error: "Unable to load batches." };
  }
  const records = data ?? [];
  _writeBatchCache(records);
  return { data: records };
}

export async function addBatch(batchNumber) {
  const num = parseInt(batchNumber, 10);
  if (!num || num < 1) return { success: false, error: "Invalid batch number." };
  const { data, error } = await supabase
    .from("batch")
    .insert([{ batch_number: num }])
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

  let selectStr = "*, batch:batch_id(id, batch_number), education:educ_id(id, name), gender:gender_id(id, name)";
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
    const firstYearByName = {};
    result.data.forEach(b => {
      const key = String(b.full_name ?? "").trim().toLowerCase();
      const yr  = b.year_period != null ? Number(b.year_period) : null;
      if (!key || yr == null) return;
      if (firstYearByName[key] == null || yr < firstYearByName[key]) firstYearByName[key] = yr;
    });
    result.data.forEach(b => {
      if (b.return_status) { b.return_status = String(b.return_status).toUpperCase(); return; }
      const key = String(b.full_name ?? "").trim().toLowerCase();
      const yr  = b.year_period != null ? Number(b.year_period) : null;
      b.return_status = (key && yr != null && firstYearByName[key] != null && yr > firstYearByName[key])
        ? "SPES BABY" : "NEW";
    });
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

// ── Input sanitiser ────────────────────────────────────────────
function _sanitize(p) {
  const str = (v) => String(v ?? "").trim() || null;
  
  let currentStaffId = null;
  try {
    const raw = localStorage.getItem("spes_session");
    if (raw) currentStaffId = JSON.parse(raw).id;
  } catch {}

  const sanitizeEdu = p.educ_id !== undefined ? p.educ_id : p.education_id;

  const result = {
    full_name:      String(p.full_name ?? "").trim(),
    address:        str(p.address),
    month_period:   str(p.month_period)?.toUpperCase() ?? null,
    year_period:    str(p.year_period),
    gender_id:      p.gender_id !== "" && p.gender_id != null ? parseInt(p.gender_id, 10) : null,
    designated:     str(p.designated),
    relationship:   str(p.relationship)?.toUpperCase() ?? null,
    contact_number: str(p.contact_number),
    birthday:       p.birthday || null,
    age:            p.age !== "" && p.age != null ? parseInt(p.age, 10) : null,
    educ_id:        sanitizeEdu !== "" && sanitizeEdu != null ? parseInt(sanitizeEdu, 10) : null,
    batch_id:       p.batch_id !== "" && p.batch_id != null ? parseInt(p.batch_id, 10) : null,
  };

  // If a staff_id is explicitly provided (e.g., Admin adding to a specific implementor)
  if (p.staff_id !== undefined) {
    result.staff_id = p.staff_id;
  }

  return result;
}
