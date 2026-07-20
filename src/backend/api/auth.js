/**
 * SPES Portal — Supabase Auth Handler
 * ────────────────────────────────────
 * Handles login, logout, and session management against the
 * Supabase `staffs` table via a secure RPC function that runs
 * bcrypt verification on the database side (never client-side).
 */
import { supabase } from "./supabase.js";

const IMPL_CACHE_KEY = "spes_implementors_v1";
const IMPL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Cache helpers ──────────────────────────────────────────────
function _readImplCache() {
  try {
    const raw = sessionStorage.getItem(IMPL_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > IMPL_CACHE_TTL) { sessionStorage.removeItem(IMPL_CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function _writeImplCache(data) {
  try { sessionStorage.setItem(IMPL_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateImplementorCache() {
  try { sessionStorage.removeItem(IMPL_CACHE_KEY); } catch {}
}

// ── Login ──────────────────────────────────────────────────────
/**
 * Authenticate a staff member by username + password.
 * The `login_staff` RPC function handles bcrypt on the DB side.
 * On success, stores session + DB permissions in localStorage.
 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function loginImplementor(username, password) {
  try {
    const { data, error } = await supabase.rpc("login_staff", {
      p_username: username,
      p_password: password
    });

    if (error) {
      // Log only the safe error code in DEV — never the full object
      if (import.meta.env.DEV) console.error("[SPES Auth] RPC code:", error.code);
      return { success: false, error: "A system error occurred. Please try again." };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || "Invalid username or password." };
    }

    const implementor = data.user;
    const roleName = _mapToRbacRole(implementor.role_label ?? implementor.role);

    const resolvedRoleId = implementor.role_id ?? implementor.role;

    // Fetch the role's DB permissions to store in the session
    // so guard.js can check without an additional round-trip.
    let dbPermissions = null;
    if (resolvedRoleId) {
      const { data: perms, error: permsError } = await supabase
        .from("permissions")
        .select("view_users, create_users, edit_users, delete_users, export_reports")
        .eq("role_id", resolvedRoleId)
        .is("archived_at", null)
        .maybeSingle();

      if (!permsError) dbPermissions = perms ?? null;
    }

    const session = {
      id:          implementor.id,
      username:    implementor.username,
      email:       implementor.email || "",
      full_name:   implementor.full_name || implementor.username,
      role:        roleName,
      role_label:  implementor.role_label || "Unknown",
      role_id:     resolvedRoleId || null,
      office_id:   implementor.office_id || null,
      status:      "ONLINE",
      permissions: dbPermissions
    };

    // Update status to ONLINE in Supabase and fetch approved status
    if (implementor.id) {
      const { data: updatedStaff } = await supabase.from("staffs").update({ status: "ONLINE" }).eq("id", implementor.id).select("approved").single();
      session.approved = updatedStaff?.approved || false;
      invalidateImplementorCache();
    }

    localStorage.setItem("spes_session", JSON.stringify(session));
    return { success: true, user: session };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Auth] catch:", err?.message);
    return { success: false, error: "An unexpected error occurred." };
  }
}

// ── Update Password ─────────────────────────────────────────────
/**
 * Update an implementor's password via the secure RPC function.
 * 
 * @param {string|number} staffId 
 * @param {string} newPassword 
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function updateImplementorPassword(staffId, newPassword) {
  try {
    const { data, error } = await supabase
      .from("staffs")
      .update({ 
        password: newPassword, 
        updated_at: new Date().toISOString() 
      })
      .eq("id", staffId)
      .select()
      .single();

    if (error) {
      if (import.meta.env.DEV) console.error("[SPES Auth] Update password error:", error.code);
      return { success: false, error: "Failed to update password. Please try again." };
    }

    return { success: true, data };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Auth] Update password catch:", err?.message);
    return { success: false, error: "An unexpected error occurred." };
  }
}

// ── Registration ────────────────────────────────────────────────
/**
 * Register a new staff member (Implementor).
 * Posts directly to the `staffs` table. Password hashing is 
 * handled by the DB trigger `hash_staff_password_trigger`.
 *
 * @param {object} staffData
 * @returns {Promise<{ success: boolean, data?: object, error?: string }>}
 */
export async function registerImplementor(staffData) {
  try {
    const { data, error } = await supabase
      .from("staffs")
      .insert([
        {
          full_name: staffData.full_name,
          username: staffData.username,
          email: staffData.email,
          password: staffData.password, // DB handles hashing
          office_id: staffData.office_id,
          address: staffData.address || null,
          phone: staffData.phone || null,
          religion: staffData.religion || null,
          language: staffData.language || null,
          blood_type: staffData.blood_type || null,
          status: "OFFLINE", // Default status
          role_id: 2, // 2 = Officer role by default
        }
      ])
      .select()
      .single();

    if (error) {
      if (import.meta.env.DEV) console.error("[SPES Auth] Register error code:", error.code);
      
      // Handle unique constraint violations
      if (error.code === '23505') {
        if (error.message.includes('staffs_email_key')) {
          return { success: false, error: "This email is already in use." };
        }
        if (error.message.includes('staffs_username_key')) {
          return { success: false, error: "This username is already taken." };
        }
      }
      return { success: false, error: "Failed to register. Please check your inputs and try again." };
    }

    return { success: true, data };
  } catch (err) {
    // DO NOT console.log the raw inputs or password for security
    if (import.meta.env.DEV) console.error("[SPES Auth] Register catch block error");
    return { success: false, error: "An unexpected error occurred during registration." };
  }
}

// ── Implementor list (for dashboard tables) ────────────────────
/**
 * Fetch all active implementors with their role and office names.
 * Results are cached in sessionStorage for 5 minutes.
 *
 * @param {{ forceRefresh?: boolean }} options
 * @returns {Promise<Array>}
 */
export async function fetchImplementorList({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readImplCache();
    if (cached && cached.length > 0) return cached;
  }

  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const isAdmin = session.role === "admin";
  const officeId = session.office_id;

  try {
    let query = supabase
      .from("staffs")
      .select(`
        id, full_name, username, email, address, phone,
        religion, language, blood_type, status, approved,
        archive_at, role_id, office_id, beneficiary_id,
        roles   ( id, name ),
        offices ( id, name, location ),
        beneficiary!beneficiary_id(full_name, return_status)
      `)
      .order("id", { ascending: true });

    if (!isAdmin && officeId) {
      query = query.eq("office_id", officeId);
    }
    const { data, error } = await query;

    if (error) {
      if (import.meta.env.DEV) console.error("[SPES Auth] fetchImplementorList error:", error.code);
      return [];
    }

    const list = (data ?? []).map((s) => ({
      id:              s.id,
      full_name:       s.full_name,
      username:        s.username,
      email:           s.email,
      office:          s.offices?.name || (s.office_id ? String(s.office_id) : "N/A"),
      office_location: s.offices?.location || "N/A",
      office_id:       s.office_id,
      role:            s.roles?.name ? s.roles.name.toUpperCase() : "N/A",
      role_id:         s.role_id,
      status:          s.archive_at ? "ARCHIVED" : (s.status || "OFFLINE"),
      archive_at:      s.archive_at,
      address:         s.address || "",
      phone:           s.phone || "",
      religion:        s.religion || "",
      language:        s.language || "",
      blood_type:      s.blood_type || "",
      approved:        s.approved || false,
    }));

    _writeImplCache(list);
    return list;
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Auth] fetchImplementorList catch:", err?.message);
    return [];
  }
}

// ── Logout ─────────────────────────────────────────────────────
export async function logoutImplementor() {
  const sessionStr = localStorage.getItem("spes_session");
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      if (session && session.id) {
        // Set status to OFFLINE before clearing local storage
        await supabase.from("staffs").update({ status: "OFFLINE" }).eq("id", session.id);
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  localStorage.removeItem("spes_session");
  localStorage.removeItem("spes_supabase_token");
  sessionStorage.clear();
  window.location.href = "/src/frontend/login/";
}

// ── Role mapping ───────────────────────────────────────────────
/**
 * Map DB role label/id → RBAC role key used throughout the portal.
 * Extend this if you add new roles to the `roles` table.
 */
function _mapToRbacRole(role) {
  if (!role) return "officer";

  if (typeof role === "number" || (typeof role === "string" && !isNaN(role))) {
    const id = parseInt(role, 10);
    if (id === 1) return "admin";
    if (id === 2) return "officer";
    return "officer";
  }

  const lower = String(role).toLowerCase();
  if (lower.includes("admin"))   return "admin";
  if (lower.includes("officer")) return "officer";
  return "officer";
}
