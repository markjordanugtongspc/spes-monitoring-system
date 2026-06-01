/**
 * SPES Portal — Staff (Implementors) CRUD API
 * ─────────────────────────────────────────────
 * Handles add / edit / archive for the `staffs` table.
 * Offices and roles lists are cached in sessionStorage.
 */
import { supabase } from "./supabase.js";

const STAFF_CACHE_KEY = "spes_staffs_v1";
const OFFICES_CACHE_KEY = "spes_offices_v1";
const ROLES_CACHE_KEY = "spes_roles_v1";
const STAFF_CACHE_TTL = 5 * 60 * 1000;   // 5 min
const META_CACHE_TTL  = 30 * 60 * 1000;  // 30 min for offices/roles

// ── Cache helpers ──────────────────────────────────────────────
function _ss_read(key, ttl) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function _ss_write(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateStaffCache() {
  try {
    sessionStorage.removeItem(STAFF_CACHE_KEY);
    localStorage.removeItem("spes_staffs_v1");
  } catch {}
}

// ── Reference data ─────────────────────────────────────────────
export async function fetchOffices(options = {}) {
  if (!options.forceRefresh) {
    const cached = _ss_read(OFFICES_CACHE_KEY, META_CACHE_TTL);
    if (cached && cached.length > 0) return { data: cached };
  }

  const { data, error } = await supabase
    .from("offices")
    .select("id, name")
    .is("archived_at", null)
    .order("name");

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] fetchOffices error:", error.code);
    return { data: [], error: "Could not load offices." };
  }

  _ss_write(OFFICES_CACHE_KEY, data ?? []);
  return { data: data ?? [] };
}

export async function fetchRoles(options = {}) {
  if (!options.forceRefresh) {
    const cached = _ss_read(ROLES_CACHE_KEY, META_CACHE_TTL);
    if (cached && cached.length > 0) return { data: cached };
  }

  const { data, error } = await supabase
    .from("roles")
    .select("id, name")
    .order("name");

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] fetchRoles error:", error.code);
    return { data: [], error: "Could not load roles." };
  }

  _ss_write(ROLES_CACHE_KEY, data ?? []);
  return { data: data ?? [] };
}

// ── Create ─────────────────────────────────────────────────────
/**
 * Insert a new staff member.
 * Password is stored as plain text here — the DB trigger
 * `hash_staff_password_trigger` runs bcrypt before INSERT.
 */
export async function addStaff(payload) {
  const clean = _sanitize(payload);

  const required = ["full_name", "username", "email", "password"];
  for (const f of required) {
    if (!clean[f]) return { success: false, error: `${f.replace("_", " ")} is required.` };
  }

  const { data, error } = await supabase
    .from("staffs")
    .insert([clean])
    .select("id, full_name, username, email, status, role_id, office_id")
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] insert error:", error.code, error.hint);
    if (error.code === "23505") {
      return { success: false, error: "Username or email is already taken." };
    }
    return { success: false, error: "Failed to add implementor. Please try again." };
  }

  invalidateStaffCache();
  return { success: true, data };
}

// ── Update ─────────────────────────────────────────────────────
/**
 * Update an existing staff member.
 * If `payload.password` is empty or omitted, the password is left unchanged.
 */
export async function updateStaff(id, payload) {
  const clean = _sanitize(payload);

  // Only send password if the admin explicitly supplied a new one
  if (!clean.password) delete clean.password;

  const { data, error } = await supabase
    .from("staffs")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("archive_at", null)
    .select("id, full_name, username, email, status, role_id, office_id")
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] update error:", error.code, error.hint);
    if (error.code === "23505") {
      return { success: false, error: "Username or email is already taken by another account." };
    }
    return { success: false, error: "Failed to update implementor. Please try again." };
  }

  invalidateStaffCache();
  return { success: true, data };
}

// ── Archive (soft delete) ──────────────────────────────────────
export async function archiveStaff(id) {
  const { error } = await supabase
    .from("staffs")
    .update({ archive_at: new Date().toISOString(), status: "OFFLINE" })
    .eq("id", id);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] archive error:", error.code, error.hint);
    return { success: false, error: "Failed to archive implementor. Please try again." };
  }

  invalidateStaffCache();
  return { success: true };
}

// ── Unarchive (restore) ────────────────────────────────────────
export async function unarchiveStaff(id) {
  const { error } = await supabase
    .from("staffs")
    .update({ archive_at: null, status: "OFFLINE" })
    .eq("id", id);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] unarchive error:", error.code, error.hint);
    return { success: false, error: "Failed to restore implementor. Please try again." };
  }

  invalidateStaffCache();
  return { success: true };
}

// ── Bulk approval / disapproval ──────────────────────────────────
export async function updateStaffApprovalBulk(ids, approved) {
  if (!ids || ids.length === 0) return { success: true };

  const { data, error } = await supabase
    .from("staffs")
    .update({ approved, updated_at: new Date().toISOString() })
    .in("id", ids);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] updateStaffApprovalBulk error:", error.code, error.hint);
    return { success: false, error: "Failed to update selection's approval status. Please try again." };
  }

  invalidateStaffCache();
  return { success: true, data };
}

// ── Input sanitiser ────────────────────────────────────────────
function _sanitize(p) {
  const str = (v) => String(v ?? "").trim() || null;
  return {
    full_name:  String(p.full_name ?? "").trim(),
    username:   String(p.username ?? "").trim().toLowerCase(),
    email:      String(p.email ?? "").trim().toLowerCase(),
    password:   String(p.password ?? "").trim(),
    address:    str(p.address),
    phone:      str(p.phone),
    religion:   str(p.religion),
    language:   str(p.language),
    blood_type: str(p.blood_type),
    role_id:    p.role_id ? parseInt(p.role_id, 10) : null,
    office_id:  p.office_id ? parseInt(p.office_id, 10) : null,
    status:     str(p.status) ?? "OFFLINE",
    approved:   Boolean(p.approved),
  };
}
