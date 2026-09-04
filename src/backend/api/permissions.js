/**
 * SPES Portal — Individual Staff Permissions API
 * Reads/writes from the `staff_permissions` table (FK to staffs.id).
 * Migrated from flat `perm_*` columns on `staffs`.
 */
import { supabase } from "./supabase.js";
import { invalidateImplementorCache } from "./auth.js";

const CACHE_KEY = "spes_staff_permissions_v4";
const CACHE_TTL = 10 * 60 * 1000;
const PERMISSION_FIELDS = [
  "view_users",
  "create_users",
  "edit_users",
  "delete_users",
  "export_reports",
  "view_other_offices",
  "view_global_stats",
  "view_payroll",
];

// --- START: NORMALIZE STAFF PERMISSIONS from staff_permissions row ---
/**
 * Maps a staff_permissions row to a normalized permissions object.
 * Fields on `staff_permissions` use plain names (no perm_ prefix).
 * @param {object} row
 * @returns {Record<string, boolean>}
 */
function normalizeStaffPermissions(row = {}) {
  return Object.fromEntries(
    PERMISSION_FIELDS.map((field) => [field, Boolean(row[field])])
  );
}
// --- END: NORMALIZE STAFF PERMISSIONS ---

// --- START: PERMISSIONS CACHE HELPERS ---
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
// --- END: PERMISSIONS CACHE HELPERS ---

// --- START: INVALIDATE PERMISSIONS CACHE ---
export function invalidatePermissionsCache() {
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {}
  try {
    invalidateImplementorCache();
  } catch {}
}
// --- END: INVALIDATE PERMISSIONS CACHE ---

// --- START: FETCH ALL STAFF PERMISSIONS (staff_permissions table) ---
/** Returns a permission map keyed by staff_id. */
export async function fetchAllStaffPermissions({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readCache();
    if (cached) return { data: cached };
  }

  // 1. Try secure API endpoint first (uses Supabase service-role admin client to bypass client RLS)
  try {
    const res = await fetch("/api/permissions", {
      method: "GET",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json.success && json.data) {
        _writeCache(json.data);
        return { data: json.data };
      }
    }
  } catch (apiErr) {
    if (import.meta.env.DEV) {
      console.warn("[SPES Permissions] API GET fetch error, falling back to direct client:", apiErr?.message);
    }
  }

  // 2. Direct client fallback
  let result = await supabase
    .from("staff_permissions")
    .select(`
      staff_id,
      view_users,
      create_users,
      edit_users,
      delete_users,
      export_reports,
      view_other_offices,
      view_global_stats,
      view_payroll
    `);

  if (result.error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Permissions] fetchAllStaff error:", result.error.code, result.error.message);
    }
    return { data: {}, error: "Could not load individual staff permissions." };
  }

  const map = {};
  for (const row of result.data ?? []) {
    if (row.staff_id != null) map[row.staff_id] = normalizeStaffPermissions(row);
  }

  _writeCache(map);
  return { data: map };
}
// --- END: FETCH ALL STAFF PERMISSIONS ---

// --- START: FETCH SINGLE STAFF PERMISSIONS by staff_id ---
export async function fetchStaffPermissions(staffId, options = {}) {
  const numericId = Number.parseInt(staffId, 10);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return { data: null, error: "A valid staff account is required." };
  }

  if (!options.forceRefresh) {
    const cached = _readCache();
    if (cached?.[numericId]) return { data: cached[numericId] };
  }

  // 1. Try secure API endpoint first
  try {
    const allRes = await fetchAllStaffPermissions({ forceRefresh: Boolean(options.forceRefresh) });
    if (allRes.data && allRes.data[numericId]) {
      return { data: allRes.data[numericId] };
    }
  } catch (apiErr) {
    if (import.meta.env.DEV) console.warn("[SPES Permissions] fetchStaff API error, trying direct:", apiErr?.message);
  }

  // 2. Direct client fallback
  const { data: row, error } = await supabase
    .from("staff_permissions")
    .select(`
      staff_id,
      view_users,
      create_users,
      edit_users,
      delete_users,
      export_reports,
      view_other_offices,
      view_global_stats,
      view_payroll
    `)
    .eq("staff_id", numericId)
    .maybeSingle();

  if (error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Permissions] fetchStaff error:", error.code, error.message);
    }
    return { data: null, error: "Could not load this staff account's permissions." };
  }

  const permissions = row ? normalizeStaffPermissions(row) : null;
  const cached = _readCache() || {};
  if (permissions) {
    cached[numericId] = permissions;
    _writeCache(cached);
  }
  return { data: permissions };
}
// --- END: FETCH SINGLE STAFF PERMISSIONS ---

// --- START: UPSERT STAFF PERMISSIONS via /api/permissions route ---
/**
 * Update optional permissions for one or more selected staff accounts.
 * The secure API route writes to `staff_permissions` table.
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

    // Broadcast live permission change over Supabase Realtime channel
    try {
      const existing = supabase.getChannels().find(ch => ch.topic === "realtime:spes-permissions-sync");
      const channel = existing || supabase.channel("spes-permissions-sync");
      const sendPayload = {
        type: "broadcast",
        event: "permissions_updated",
        payload: { staffIds: ids, updates: payload, data: result.data },
      };

      if (channel.state === "joined" || channel.state === "joined_and_ready") {
        channel.send(sendPayload);
      } else {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") {
            channel.send(sendPayload);
          }
        });
      }
    } catch {}

    return { success: true, data: result.data };
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Permissions] network error:", error?.message);
    }
    return { success: false, error: "Could not reach the secure permissions service." };
  }
}
