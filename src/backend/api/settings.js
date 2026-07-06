/**
 * SPES Portal — Account Settings API
 * ───────────────────────────────────
 * Self-service profile editing for ANY logged-in staff member
 * (admin, officer, etc.). Scoped to the caller's own record.
 *
 * Only the fields a user is allowed to change about themselves are
 * touched here — username, email, role and office are intentionally
 * NOT updatable from Settings (those are admin-managed via staff.js).
 *
 * Password note: the `staffs` table has a DB trigger that bcrypt-hashes
 * the `password` column on write, so we send it as plain text and only
 * when the user actually supplied a new one.
 */
import { supabase } from "./supabase.js";
import { invalidateStaffCache } from "./staff.js";

// ── Fetch the caller's own profile ─────────────────────────────
export async function fetchOwnProfile(id) {
  if (!id) return { data: null, error: "Missing account id." };

  const { data, error } = await supabase
    .from("staffs")
    .select("id, full_name, username, email, address, religion, language, blood_type, phone, status, role_id, office_id, offices(name), roles(name)")
    .eq("id", id)
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Settings] fetchOwnProfile error:", error.code, error.hint);
    return { data: null, error: "Could not load your profile. Please try again." };
  }

  return { data };
}

// ── Update the caller's own profile ────────────────────────────
/**
 * @param {number|string} id      – the caller's staff id (from session)
 * @param {object} payload        – { full_name, address, religion, language, blood_type, phone, password? }
 *
 * Only whitelisted fields are written. `password` is included only when non-empty.
 * The UPDATE is scoped to `.eq("id", id)` which, combined with RLS policies on
 * the `staffs` table, ensures a user can only touch their own row.
 */
export async function updateOwnProfile(id, payload) {
  if (!id) return { success: false, error: "Missing account id." };

  // Verify the caller is only updating their own record by cross-checking the session
  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem("spes_session") : null;
    if (raw) {
      const session = JSON.parse(raw);
      // Strict equality check: session id must match the requested id
      if (session?.id && String(session.id) !== String(id)) {
        return { success: false, error: "Unauthorized: you may only edit your own profile." };
      }
    }
  } catch { /* If localStorage is unavailable (SSR/tests), skip the check */ }

  const str = (v) => String(v ?? "").trim() || null;

  const fullName = String(payload.full_name ?? "").trim();
  if (!fullName) return { success: false, error: "Full name is required." };

  // Whitelist — never touch username / email / role / office here.
  const update = {
    full_name:  fullName,
    address:    str(payload.address),
    religion:   str(payload.religion),
    language:   str(payload.language),
    blood_type: str(payload.blood_type),
    phone:      str(payload.phone),
    updated_at: new Date().toISOString(),
  };

  // Only change the password when the user typed a new one.
  const newPassword = String(payload.password ?? "").trim();
  if (newPassword) update.password = newPassword;

  const { data, error } = await supabase
    .from("staffs")
    .update(update)
    .eq("id", id)
    .select("id, full_name, address, religion, language, blood_type, phone")
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Settings] updateOwnProfile error:", error.code, error.hint);
    return { success: false, error: "Failed to save your changes. Please try again." };
  }

  // Keep the cached implementor list in sync so other pages reflect the change.
  invalidateStaffCache();
  return { success: true, data };
}
