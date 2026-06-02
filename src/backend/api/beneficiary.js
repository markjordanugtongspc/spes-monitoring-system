import { supabase } from "./supabase.js";

const CACHE_KEY = "spes_beneficiaries_v1";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

  let query = supabase.from("beneficiary").select("*").order("created_at", { ascending: false });

  let result = await query;

  // Column doesn't exist yet (migration not run) — cache the flag and retry without filter
  if (result.error?.code === "42703") {
    sessionStorage.setItem(ARCHIVE_COL_FLAG, "1");
    result = await supabase.from("beneficiary").select("*").order("created_at", { ascending: false });
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
  return {
    full_name:      String(p.full_name ?? "").trim(),
    address:        str(p.address),
    month_period:   str(p.month_period)?.toUpperCase() ?? null,
    year_period:    str(p.year_period),
    gender:         str(p.gender),
    designated:     str(p.designated),
    relationship:   str(p.relationship)?.toUpperCase() ?? null,
    contact_number: str(p.contact_number),
    birthday:       p.birthday || null,
    age:            p.age !== "" && p.age != null ? parseInt(p.age, 10) : null,
    education:      str(p.education),
    batch:          p.batch !== "" && p.batch != null ? parseInt(p.batch, 10) : null,
  };
}
