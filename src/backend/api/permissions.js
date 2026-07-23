/**
 * SPES Portal — Role Permissions API
 * ─────────────────────────────────────
 * Manages the `permissions` table which is keyed by role_id.
 * Each role has exactly one permissions row.
 */
import { supabase } from "./supabase.js";

const CACHE_KEY = "spes_role_permissions_v1";
const CACHE_TTL = 10 * 60 * 1000; // 10 min

// ── Cache helpers ──────────────────────────────────────────────
function _readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function _writeCache(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidatePermissionsCache() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}

// ── Read — all roles ───────────────────────────────────────────
/**
 * Returns a map: { [role_id]: { view_users, create_users, edit_users, delete_users, export_reports } }
 */
export async function fetchAllRolePermissions({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readCache();
    if (cached) return { data: cached };
  }

  const { data, error } = await supabase
    .from("permissions")
    .select("role_id, view_users, create_users, edit_users, delete_users, export_reports")
    .is("archived_at", null);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Permissions] fetchAll error:", error.code);
    return { data: {}, error: "Could not load role permissions." };
  }

  const map = {};
  for (const row of data ?? []) {
    if (row.role_id != null) map[row.role_id] = row;
  }

  _writeCache(map);
  return { data: map };
}

// ── Read — single role ─────────────────────────────────────────
export async function fetchRolePermissions(roleId, options = {}) {
  const { data: all } = await fetchAllRolePermissions(options);
  return { data: all[roleId] ?? null };
}

// ── Upsert ─────────────────────────────────────────────────────
/**
 * Update or insert a permissions row for the given role.
 * `updates` is an object with any subset of the five boolean columns.
 *
 * @param {number} roleId
 * @param {Partial<{view_users,create_users,edit_users,delete_users,export_reports}>} updates
 */
export async function upsertRolePermissions(roleId, updates) {
  const allowed = ["view_users", "create_users", "edit_users", "delete_users", "export_reports"];
  const payload = { role_id: roleId, updated_at: new Date().toISOString() };

  for (const key of allowed) {
    if (key in updates) payload[key] = Boolean(updates[key]);
  }

  try {
    const response = await fetch("/api/permissions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId, updates: payload }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (import.meta.env.DEV) {
        console.error("[SPES Permissions] API error:", response.status, result.error);
      }
      return { success: false, error: result.error || "Failed to update permissions. Please try again." };
    }

    invalidatePermissionsCache();
    return { success: true, data: result.data };
  } catch (error) {
    if (import.meta.env.DEV) console.error("[SPES Permissions] network error:", error?.message);
    return { success: false, error: "Could not reach the secure permissions service." };
  }
}
