/**
 * SPES Portal — Staff (Implementors) CRUD API
 * ─────────────────────────────────────────────
 * Handles add / edit / archive for the `staffs` table.
 * Offices and roles lists are cached in sessionStorage.
 */
import { supabase } from "./supabase.js";
import { upsertStaffPermissions } from "./permissions.js";
import { getOfficeAccessScope } from "../../frontend/assets/js/rbac/scope.js";
import { preferenceStorage } from "../../frontend/assets/js/components/storage.js";

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
    // Also clear implementor cache keys in auth
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith("spes_implementors")) {
        sessionStorage.removeItem(k);
      }
    }
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
    .select("id, name, location, type")
    .is("archived_at", null)
    .order("name");

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] fetchOffices error:", error.code);
    return { data: [], error: "Could not load offices." };
  }

  _ss_write(OFFICES_CACHE_KEY, data ?? []);
  return { data: data ?? [] };
}

export async function addOffice(name, type = "public") {
  const cleanName = String(name ?? "").trim();
  if (!cleanName) return { success: false, error: "Office name is required." };

  try {
    const response = await fetch("/api/offices", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName, type }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.error("[SPES Staff] addOffice API error:", response.status, result.error);
      }
      return { success: false, error: result.error || "Failed to add office." };
    }

    try { sessionStorage.removeItem(OFFICES_CACHE_KEY); } catch {}
    return { success: true, data: result.data };
  } catch (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] addOffice network error:", error?.message);
    return { success: false, error: "Could not reach the secure office service." };
  }
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

// --- START: ADD STAFF - creates a new staff record in the staffs table ---
/**
 * Insert a new staff member.
 * Password is stored as plain text here — the DB trigger
 * `hash_staff_password_trigger` runs bcrypt before INSERT.
 */
export async function addStaff(payload) {
  const clean = _sanitize(payload);
  const session = _getStoredSession();
  const access = getOfficeAccessScope(session);
  if (!_hasStaffMutationPermission(session, "create_users")) {
    return { success: false, error: "You do not have permission to create implementors." };
  }
  if (!access.isAdmin && !access.isHr) {
    if (access.ownOfficeId == null) {
      return { success: false, error: "Your account has no assigned office." };
    }
    clean.office_id = Number(access.ownOfficeId);
  }

  try {
    const raw = localStorage.getItem("spes_session");
    if (raw) {
      const sessionObj = JSON.parse(raw);
      if (sessionObj && sessionObj.id) {
        clean.created_by = parseInt(sessionObj.id, 10);
      }
    }
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[SPES Staff] Could not set created_by field:", e);
  }

  const required = ["full_name", "username", "email", "password"];
  for (const f of required) {
    if (!clean[f]) return { success: false, error: `${f.replace("_", " ")} is required.` };
  }

  const deployments = clean._batch_deployments;
  delete clean._batch_deployments;

  const isAutoGrantRole = Number(clean.role_id) === 1 || Number(clean.role_id) === 2 || Number(clean.role_id) === 4;
  if (isAutoGrantRole) {
    clean.approved = true;
    clean.office_id = null; // Global roles are not bound to a single local office
  }

  const { data, error } = await supabase
    .from("staffs")
    .insert([clean])
    .select("id, full_name, username, email, status, role_id, office_id, beneficiary_id, created_by, approved")
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] insert error:", error.code, error.hint);
    if (error.code === "23505") {
      return { success: false, error: "Username or email is already taken." };
    }
    return { success: false, error: "Failed to add implementor. Please try again." };
  }

  if (data?.id && Array.isArray(deployments) && deployments.length > 0) {
    preferenceStorage.saveImplementorDeployments(data.id, deployments);
    data.batch_deployments = deployments;
  }

  if (data?.id && isAutoGrantRole) {
    try {
      await upsertStaffPermissions(data.id, {
        view_users: true,
        create_users: true,
        edit_users: true,
        delete_users: true,
        export_reports: true,
        view_other_offices: true,
        view_global_stats: true,
        view_payroll: true,
      });
    } catch {}
  }

  invalidateStaffCache();
  return { success: true, data };
}
// --- END: ADD STAFF ---

// --- START: UPDATE STAFF - updates an existing staff member in the staffs table ---
/**
 * Update an existing staff member.
 * If `payload.password` is empty or omitted, the password is left unchanged.
 */
export async function updateStaff(id, payload) {
  const authorization = await _authorizeStaffMutation(id, "edit_users");
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }
  const clean = _sanitize(payload);
  if (!authorization.access.isAdmin && !authorization.access.isHr) {
    clean.office_id = Number(authorization.access.ownOfficeId);
  }

  const isAutoGrantRole = Number(clean.role_id) === 1 || Number(clean.role_id) === 2 || Number(clean.role_id) === 4;
  if (isAutoGrantRole) {
    clean.approved = true;
    clean.office_id = null; // Global roles are not bound to a single local office
  }

  const deployments = clean._batch_deployments;
  delete clean._batch_deployments;

  // Only send password if the admin explicitly supplied a new one
  if (!clean.password) delete clean.password;

  const { data, error } = await supabase
    .from("staffs")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("archive_at", null)
    .select("id, full_name, username, email, status, role_id, office_id, beneficiary_id, approved")
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Staff] update error:", error.code, error.hint);
    if (error.code === "23505") {
      return { success: false, error: "Username or email is already taken by another account." };
    }
    return { success: false, error: "Failed to update implementor. Please try again." };
  }

  if (Array.isArray(deployments)) {
    preferenceStorage.saveImplementorDeployments(id, deployments);
    if (data) data.batch_deployments = deployments;
  }

  if (isAutoGrantRole) {
    try {
      await upsertStaffPermissions(id, {
        view_users: true,
        create_users: true,
        edit_users: true,
        delete_users: true,
        export_reports: true,
        view_other_offices: true,
        view_global_stats: true,
        view_payroll: true,
      });
    } catch {}
  }

  invalidateStaffCache();
  return { success: true, data };
}
// --- END: UPDATE STAFF ---

// --- START: ARCHIVE STAFF - soft deletes a staff member by setting archive_at ---
export async function archiveStaff(id) {
  const authorization = await _authorizeStaffMutation(id, "delete_users");
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }
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
// --- END: ARCHIVE STAFF ---

// --- START: UNARCHIVE STAFF - restores an archived staff member ---
export async function unarchiveStaff(id) {
  const authorization = await _authorizeStaffMutation(id, "edit_users");
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }
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
// --- END: UNARCHIVE STAFF ---

// --- START: UPDATE STAFF APPROVAL BULK - updates approval status for an array of staff ids ---
export async function updateStaffApprovalBulk(ids, approved) {
  if (!ids || ids.length === 0) return { success: true };
  const authorization = await _authorizeStaffMutation(ids, "edit_users");
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }

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
// --- END: UPDATE STAFF APPROVAL BULK ---

// --- START: STAFF INPUT SANITISER ---
function _sanitize(p) {
  const str = (v) => String(v ?? "").trim() || null;
  let deployments = [];
  if (Array.isArray(p.batch_deployments) && p.batch_deployments.length > 0) {
    deployments = p.batch_deployments.map((d, i) => ({
      batch_id: d.batch_id ? Number(d.batch_id) : (i + 1),
      batch_name: d.batch_name ? String(d.batch_name).trim() : `BATCH ${i + 1}`,
      started_at: d.started_at ? new Date(d.started_at).toISOString() : null,
      ended_at: d.ended_at ? new Date(d.ended_at).toISOString() : null,
    }));
  }

  const firstBatch = deployments[0];
  const startedAt = p.started_at
    ? new Date(p.started_at).toISOString()
    : (firstBatch?.started_at ?? null);
  const endedAt = p.ended_at
    ? new Date(p.ended_at).toISOString()
    : (firstBatch?.ended_at ?? null);

  return {
    full_name:          String(p.full_name ?? "").trim(),
    username:           String(p.username ?? "").trim().toLowerCase(),
    email:              String(p.email ?? "").trim().toLowerCase(),
    password:           String(p.password ?? "").trim(),
    phone:              str(p.phone),
    religion:           str(p.religion),
    language:           str(p.language),
    started_at:         startedAt,
    ended_at:           endedAt,
    role_id:            p.role_id    ? parseInt(p.role_id, 10)    : null,
    office_id:          p.office_id  ? parseInt(p.office_id, 10)  : null,
    beneficiary_id:     p.beneficiary_id ? parseInt(p.beneficiary_id, 10) : null,
    ...(p.status !== undefined ? { status: str(p.status) ?? "OFFLINE" } : {}),
    approved:           Boolean(p.approved),
    _batch_deployments: deployments,
  };
}
// --- END: STAFF INPUT SANITISER ---
// ── Fetch ──────────────────────────────────────────────────────
/**
 * Fetch the minimal global roster needed by Dashboard Card 1.
 * This intentionally does not return staff contact/profile fields.
 */
export async function fetchGlobalStaffMetricRoster() {
  const { data, error } = await supabase
    .from("staffs")
    .select("id, full_name, username, office_id, started_at, ended_at, created_at, offices!office_id(id, name, location)")
    .is("archive_at", null)
    .neq("role_id", 1)
    .order("id", { ascending: true });

  if (error) {
    console.error(
      "[SPES Staff] fetchGlobalStaffMetricRoster error:",
      error.code,
      error.message,
      error.hint,
      error.details
    );
    return { data: [], error: "Could not load the global implementor metric." };
  }

  const enriched = (data ?? []).map(staff => {
    const saved = preferenceStorage.getImplementorDeployments(staff.id);
    if (saved && saved.length > 0) {
      return { ...staff, batch_deployments: saved };
    }
    const defaultBatch = (staff.started_at || staff.ended_at)
      ? [{ batch_id: 1, batch_name: "BATCH 1", started_at: staff.started_at, ended_at: staff.ended_at }]
      : [];
    return { ...staff, batch_deployments: defaultBatch };
  });

  return { data: enriched };
}

function _getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem("spes_session") || "{}");
  } catch {
    return {};
  }
}

// --- START: HAS STAFF MUTATION PERMISSION - checks if session has permission to mutate staff records ---
function _hasStaffMutationPermission(session, permissionColumn) {
  const access = getOfficeAccessScope(session);
  if (access.isChief) return false; // Chief is strictly read-only
  return access.isAdmin || access.isHr || (
    session.approved === true &&
    Boolean(session.permissions?.[permissionColumn])
  );
}
// --- END: HAS STAFF MUTATION PERMISSION ---

// --- START: AUTHORIZE STAFF MUTATION - validates session permissions and office scope for mutating staff records ---
async function _authorizeStaffMutation(ids, permissionColumn) {
  const session = _getStoredSession();
  const access = getOfficeAccessScope(session);
  if (access.isChief) {
    return { allowed: false, error: "Chief role has global read-only access. Modifying implementor records is not permitted." };
  }
  if (!_hasStaffMutationPermission(session, permissionColumn)) {
    return { allowed: false, error: "You do not have permission to manage implementors." };
  }
  if (access.isAdmin || access.isHr) return { allowed: true, session, access };

  const safeIds = (Array.isArray(ids) ? ids : [ids]).filter((id) => id != null);
  const { data, error } = await supabase
    .from("staffs")
    .select("id, office_id")
    .in("id", safeIds);
  if (error || (data ?? []).length !== safeIds.length) {
    return { allowed: false, error: "The selected implementor records could not be verified." };
  }
  if ((data ?? []).some((staff) => !access.canManageOffice(staff.office_id))) {
    return { allowed: false, error: "Other-office implementors are read-only." };
  }
  return { allowed: true, session, access };
}
// --- END: AUTHORIZE STAFF MUTATION ---

// --- START: FETCH STAFFS with office and role join ---
export async function fetchStaffs(options = {}) {
  let query = supabase
    .from("staffs")
    .select("id, role_id, office_id, offices!office_id(id, name, location), full_name, username, email, phone, status, approved, created_at, archive_at, beneficiary_id, started_at, ended_at, roles!role_id(id, name)")
    .is("archive_at", null)
    .neq("role_id", 1)
    .order("id", { ascending: true });

  if (options.officeId) {
    query = query.eq("office_id", options.officeId);
  }

  const { data, error } = await query;
  
  if (error) {
    console.error("[SPES Staff] fetchStaffs error:", error.code, error.message, error.hint, error.details);
    return { data: [], error: "Could not load implementors." };
  }

  const enriched = (data ?? []).map(staff => {
    const saved = preferenceStorage.getImplementorDeployments(staff.id);
    if (saved && saved.length > 0) {
      return { ...staff, batch_deployments: saved };
    }
    const defaultBatch = (staff.started_at || staff.ended_at)
      ? [{ batch_id: 1, batch_name: "BATCH 1", started_at: staff.started_at, ended_at: staff.ended_at }]
      : [];
    return { ...staff, batch_deployments: defaultBatch };
  });

  return { data: enriched };
}
// --- END: FETCH STAFFS ---

// --- START: FETCH OFFICE BATCHES - detects which batches are active for an office based on beneficiary records ---
export async function fetchOfficeBatches(officeId) {
  if (!officeId) return { data: [1] };
  try {
    const { data, error } = await supabase
      .from("beneficiary")
      .select("batch_id, staffs!staff_id!inner(office_id)")
      .eq("staffs.office_id", officeId)
      .is("archived_at", null);

    if (error || !Array.isArray(data)) {
      return { data: [1] };
    }

    const uniqueBatchIds = Array.from(new Set(
      data.map(b => Number(b.batch_id)).filter(id => Number.isInteger(id) && id > 0)
    )).sort((a, b) => a - b);

    return { data: uniqueBatchIds.length > 0 ? uniqueBatchIds : [1] };
  } catch (err) {
    if (import.meta.env.DEV) console.warn("[SPES Staff] fetchOfficeBatches error:", err);
    return { data: [1] };
  }
}
// --- END: FETCH OFFICE BATCHES ---
