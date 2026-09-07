/**
 * SPES Portal — Supabase Auth Handler
 * ────────────────────────────────────
 * Handles login, logout, and session management against the
 * Supabase `staffs` table via a secure RPC function that runs
 * bcrypt verification on the database side (never client-side).
 */
import { supabase } from "./supabase.js";
import { getOfficeAccessScope } from "../../frontend/assets/js/rbac/scope.js";
import { initPresence, destroyPresence } from "../../frontend/assets/js/components/presence.js";
import { preferenceStorage } from "../../frontend/assets/js/components/storage.js";

const IMPL_CACHE_KEY = "spes_implementors_v1";
const IMPL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Cache helpers ──────────────────────────────────────────────
function _readImplCache(cacheKey = IMPL_CACHE_KEY) {
  try {
    const raw = sessionStorage.getItem(cacheKey);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > IMPL_CACHE_TTL) { sessionStorage.removeItem(cacheKey); return null; }
    return data;
  } catch { return null; }
}

function _writeImplCache(cacheKey, data) {
  try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateImplementorCache() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(IMPL_CACHE_KEY)) sessionStorage.removeItem(key);
    }
  } catch {}
}

// ── Login ──────────────────────────────────────────────────────
// --- START: LOGIN IMPLEMENTOR - Authenticates staff, resolves role and permissions, and establishes session ---
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
    const response = await fetch("/api/session", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.success) {
      if (import.meta.env.DEV) console.error("[SPES Auth] session API status:", response.status);
      return { success: false, error: data?.error || "Invalid username or password." };
    }

    const implementor = data.user;
    const resolvedRoleId = Number(implementor.role_id) || (typeof implementor.role === "number" ? implementor.role : null);
    const roleName = _mapToRbacRole(implementor.role_label ?? implementor.role ?? resolvedRoleId);
    const finalRoleId = resolvedRoleId || (roleName === "admin" ? 1 : (roleName === "hr" ? 2 : 3));

    // The secure session endpoint resolves permissions for this individual
    // staff account. Optional grants no longer inherit from the shared role.
    const isHrOrAdminUser = roleName === "admin" || roleName === "hr" || finalRoleId === 1 || finalRoleId === 2;
    const dbPermissions = implementor.permissions || {
      view_users: isHrOrAdminUser,
      create_users: isHrOrAdminUser,
      edit_users: isHrOrAdminUser,
      delete_users: isHrOrAdminUser,
      export_reports: isHrOrAdminUser,
      view_other_offices: isHrOrAdminUser,
      view_global_stats: isHrOrAdminUser,
      view_payroll: isHrOrAdminUser,
    };

    const session = {
      id:          implementor.id,
      username:    implementor.username,
      email:       implementor.email || "",
      full_name:   implementor.full_name || implementor.username,
      role:        roleName,
      role_label:  implementor.role_label || (roleName === "admin" ? "Admin" : (roleName === "hr" ? "HR" : "Officer")),
      role_id:     finalRoleId,
      office_id:   implementor.office_id || null,
      status:      "ONLINE",
      started_at:  implementor.started_at || null,
      ended_at:    implementor.ended_at || null,
      permissions: dbPermissions,
      portal_url:  getPortalDashboardUrl({ role: roleName, role_id: finalRoleId })
    };

    // Update status to ONLINE in Supabase and fetch approved status, office_id, and latest role
    if (implementor.id) {
      const { data: updatedStaff } = await supabase
        .from("staffs")
        .update({ status: "ONLINE" })
        .eq("id", implementor.id)
        .select("approved, office_id, role_id, roles!role_id(id, name)")
        .single();
      session.approved = updatedStaff?.approved ?? session.approved ?? false;
      if (updatedStaff?.office_id != null && !session.office_id) {
        session.office_id = updatedStaff.office_id;
      }
      if (updatedStaff?.role_id != null) {
        session.role_id = Number(updatedStaff.role_id);
        session.role = _mapToRbacRole(updatedStaff.roles?.name || session.role_id);
        session.role_label = updatedStaff.roles?.name || (session.role_id === 1 ? "Admin" : (session.role_id === 2 ? "HR" : "Officer"));
      }
      invalidateImplementorCache();
    }

    localStorage.setItem("spes_session", JSON.stringify(session));

    // Subscribe to Presence channel for real-time status tracking
    initPresence(session.id);

    return { success: true, user: session };
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Auth] catch:", err?.message);
    return { success: false, error: "An unexpected error occurred." };
  }
}
// --- END: LOGIN IMPLEMENTOR ---

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
// --- START: REGISTER IMPLEMENTOR - Creates new staff account with default Officer role (role_id: 3) ---
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
          phone: staffData.phone || null,
          religion: staffData.religion || null,
          language: staffData.language || null,
          status: "OFFLINE", // Default status
          role_id: 3, // 3 = Officer role by default (1 = Admin, 2 = HR, 3 = Officer)
          approved: false, // New accounts must be explicitly approved
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
// --- END: REGISTER IMPLEMENTOR ---

// ── Implementor list (for dashboard tables) ────────────────────
/**
 * Fetch all active implementors with their role and office names.
 * Results are cached in sessionStorage for 5 minutes.
 *
 * @param {{ forceRefresh?: boolean }} options
 * @returns {Promise<Array>}
 */
export async function fetchImplementorList({ forceRefresh = false } = {}) {
  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const access = getOfficeAccessScope(session);
  const officeId = session.office_id;
  const cacheKey = `${IMPL_CACHE_KEY}:${access.canViewOtherOffices ? "global" : `office-${officeId ?? "none"}`}`;

  if (!forceRefresh) {
    const cached = _readImplCache(cacheKey);
    if (cached && cached.length > 0) return cached;
  }

  try {
    const buildSelect = (tbl = "staff_permissions") => `
        id, full_name, username, email, phone, created_at,
        religion, language, status, approved, started_at, ended_at,
        archive_at, role_id, office_id, beneficiary_id,
        ${tbl}!staff_id(
          view_users, create_users, edit_users, delete_users,
          export_reports, view_other_offices, view_global_stats, view_payroll
        ),
        roles   ( id, name ),
        offices ( id, name, location ),
        beneficiary!beneficiary_id(full_name, return_status)
    `;

    let query = supabase
      .from("staffs")
      .select(buildSelect("staff_permissions"))
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });

    if (!access.canViewOtherOffices && officeId) {
      query = query.eq("office_id", officeId);
    }
    let { data, error } = await query;

    if (error) {
      if (import.meta.env.DEV) console.error("[SPES Auth] fetchImplementorList error:", error.code, error.message);
      return [];
    }

    const list = (data ?? []).map((s) => {
      const rawSp = s.permissions || s.staff_permissions;
      const sp = Array.isArray(rawSp)
        ? (rawSp[0] ?? {})
        : (rawSp ?? {});
      const isAdmin = Number(s.role_id) === 1 || String(s.roles?.name || "").toUpperCase() === "ADMIN";
      const isHr = Number(s.role_id) === 2 || String(s.roles?.name || "").toUpperCase() === "HR";
      const autoAllTrue = isAdmin || (isHr && s.approved === true);

      const savedDeployments = preferenceStorage.getImplementorDeployments(s.id);
      const batchDeployments = (savedDeployments && savedDeployments.length > 0)
        ? savedDeployments
        : ((s.started_at || s.ended_at)
            ? [{ batch_id: 1, batch_name: "BATCH 1", started_at: s.started_at, ended_at: s.ended_at }]
            : []);

      return {
        id:              s.id,
        created_at:      s.created_at,
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
        started_at:      s.started_at || null,
        ended_at:        s.ended_at || null,
        batch_deployments: batchDeployments,
        phone:           s.phone || "",
        religion:        s.religion || "",
        language:        s.language || "",
        approved:        s.approved || false,
        permissions: {
          view_users:         autoAllTrue || Boolean(sp.view_users),
          create_users:       autoAllTrue || Boolean(sp.create_users),
          edit_users:         autoAllTrue || Boolean(sp.edit_users),
          delete_users:       autoAllTrue || Boolean(sp.delete_users),
          export_reports:     autoAllTrue || Boolean(sp.export_reports),
          view_other_offices: autoAllTrue || Boolean(sp.view_other_offices),
          view_global_stats:  autoAllTrue || Boolean(sp.view_global_stats),
          view_payroll:       autoAllTrue || Boolean(sp.view_payroll),
        },
      };
    });

    _writeImplCache(cacheKey, list);
    return list;
  } catch (err) {
    if (import.meta.env.DEV) console.error("[SPES Auth] fetchImplementorList catch:", err?.message);
    return [];
  }
}

// ── Logout ─────────────────────────────────────────────────────
export async function logoutImplementor() {
  const sessionStr = localStorage.getItem("spes_session");

  // Tear down Presence channel before clearing session
  destroyPresence();

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
  try {
    await fetch("/api/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // Local session is already cleared; the server cookie expires automatically.
  }
  window.location.href = "/src/frontend/login/";
}

// --- START: MAP TO RBAC ROLE - Converts DB role id or label to standard RBAC key (admin, hr, officer) ---
/**
 * Map DB role label/id → RBAC role key used throughout the portal.
 * Admin: 1 -> "admin"
 * HR: 2 -> "hr"
 * Officer: 3 -> "officer"
 */
export function _mapToRbacRole(role) {
  if (!role) return "officer";

  if (typeof role === "number" || (typeof role === "string" && !isNaN(role) && String(role).trim() !== "")) {
    const id = parseInt(role, 10);
    if (id === 1) return "admin";
    if (id === 2) return "hr";
    if (id === 3) return "officer";
    return "officer";
  }

  const lower = String(role).toLowerCase().trim();
  if (lower.includes("admin")) return "admin";
  if (lower === "hr" || lower.includes("human resource") || lower.includes("hr")) return "hr";
  if (lower.includes("officer")) return "officer";
  return "officer";
}
// --- END: MAP TO RBAC ROLE ---

// --- START: ADMIN ACCESS VALIDATOR ---
/**
 * Validates whether the active session has administrator authority.
 * @param {object} [customSession] Optional session override
 * @returns {{ allowed: boolean, session: object | null, error?: string }}
 */
export function validateAdminAccess(customSession = null) {
  let session = customSession;
  if (!session) {
    try {
      const raw = sessionStorage.getItem("spes_session") || localStorage.getItem("spes_session");
      session = raw ? JSON.parse(raw) : null;
    } catch {
      session = null;
    }
  }

  if (!session || !session.role) {
    return { allowed: false, session: null, error: "Authentication required." };
  }

  const role = String(session.role || "").toLowerCase();
  if (role !== "admin") {
    return { allowed: false, session, error: "Access denied. Administrator privileges required." };
  }

  return { allowed: true, session };
}
// --- END: ADMIN ACCESS VALIDATOR ---

// --- START: GET PORTAL DASHBOARD URL ---
/**
 * Resolves the exact DOLE Portal dashboard URL dynamically based on user role.
 * - Admin → /src/pages/user/admin/dashboard/
 * - Staff/Officer → /src/pages/user/staff/dashboard/
 *
 * @param {object|string|number} [userOrRole] - User session object or role string/id
 * @returns {string} Fully qualified Portal destination URL
 */
export function getPortalDashboardUrl(userOrRole = null) {
  let user = userOrRole;
  if (!user) {
    try {
      const raw = sessionStorage.getItem("spes_session") || localStorage.getItem("spes_session");
      user = raw ? JSON.parse(raw) : null;
    } catch {
      user = null;
    }
  }

  const roleStr = typeof user === "object"
    ? String(user?.role || user?.role_label || "").toLowerCase()
    : String(user || "").toLowerCase();
  const roleId = typeof user === "object" ? Number(user?.role_id) : NaN;

  const isAdmin = roleStr.includes("admin") || roleId === 1;
  const baseUrl = "https://dole-portal.vercel.app";

  return isAdmin
    ? `${baseUrl}/src/pages/user/admin/dashboard/`
    : `${baseUrl}/src/pages/user/staff/dashboard/`;
}
// --- END: GET PORTAL DASHBOARD URL ---

// --- START: REDIRECT TO PORTAL DASHBOARD ---
/**
 * Redirects the active user to their corresponding Portal dashboard path.
 * @param {object|string|number} [userOrRole]
 */
export function redirectToPortalDashboard(userOrRole = null) {
  const targetUrl = getPortalDashboardUrl(userOrRole);
  window.location.href = targetUrl;
}
// --- END: REDIRECT TO PORTAL DASHBOARD ---
