/**
 * SPES Portal — Individual Staff Permissions API
 * Optional RBAC grants are stored on each `staffs` row.
 */
import { supabase } from "./supabase.js";

const CACHE_KEY = "spes_staff_permissions_v2";
const CACHE_TTL = 10 * 60 * 1000;
const PERMISSION_FIELDS = [
  "view_users",
  "create_users",
  "edit_users",
  "delete_users",
  "export_reports",
  "view_other_offices",
  "view_global_stats",
];

function normalizeStaffPermissions(row = {}) {
  return Object.fromEntries(
    PERMISSION_FIELDS.map((field) => [field, Boolean(row[`perm_${field}`])])
  );
}

function _readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function _writeCache(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
  } catch {}
}

export function invalidatePermissionsCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {}
}

/** Returns a permission map keyed by staff id. */
export async function fetchAllStaffPermissions({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readCache();
    if (cached) return { data: cached };
  }

  const result = await supabase
    .from("staffs")
    .select(`
      id,
      perm_view_users,
      perm_create_users,
      perm_edit_users,
      perm_delete_users,
      perm_export_reports,
      perm_view_other_offices,
      perm_view_global_stats
    `)
    .is("archive_at", null);

  if (result.error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Permissions] fetchAllStaff error:", result.error.code);
    }
    return { data: {}, error: "Could not load individual staff permissions." };
  }

  const map = {};
  for (const row of result.data ?? []) {
    if (row.id != null) map[row.id] = normalizeStaffPermissions(row);
  }

  _writeCache(map);
  return { data: map };
}

export async function fetchStaffPermissions(staffId, options = {}) {
  const numericId = Number.parseInt(staffId, 10);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return { data: null, error: "A valid staff account is required." };
  }

  if (!options.forceRefresh) {
    const cached = _readCache();
    if (cached?.[numericId]) return { data: cached[numericId] };
  }

  const result = await supabase
    .from("staffs")
    .select(`
      id,
      perm_view_users,
      perm_create_users,
      perm_edit_users,
      perm_delete_users,
      perm_export_reports,
      perm_view_other_offices,
      perm_view_global_stats
    `)
    .eq("id", numericId)
    .maybeSingle();

  if (result.error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Permissions] fetchStaff error:", result.error.code);
    }
    return { data: null, error: "Could not load this staff account's permissions." };
  }

  const permissions = result.data ? normalizeStaffPermissions(result.data) : null;
  const cached = _readCache() || {};
  if (permissions) {
    cached[numericId] = permissions;
    _writeCache(cached);
  }
  return { data: permissions };
}

/**
 * Update optional permissions for one or more selected staff accounts.
 *
 * @param {number|number[]} staffIds
 * @param {Partial<Record<string, boolean>>} updates
 */
export async function upsertStaffPermissions(staffIds, updates) {
  const ids = [...new Set(
    (Array.isArray(staffIds) ? staffIds : [staffIds])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
  const payload = {};

  for (const key of PERMISSION_FIELDS) {
    if (key in updates) payload[key] = Boolean(updates[key]);
  }

  try {
    const response = await fetch("/api/permissions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffIds: ids, updates: payload }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.error("[SPES Permissions] API error:", response.status, result.error);
      }
      return {
        success: false,
        error: result.error || "Failed to update permissions. Please try again.",
      };
    }

    invalidatePermissionsCache();
    return { success: true, data: result.data };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Permissions] network error:", error?.message);
    }
    return { success: false, error: "Could not reach the secure permissions service." };
  }
}
