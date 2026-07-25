/**
 * Resolve cross-office read access separately from write access.
 *
 * `view_global_stats` controls dashboard analytics only.
 * `view_other_offices` controls read-only access to other office rosters.
 * Neither permission grants cross-office create, edit, archive, or transfer access.
 */

// --- START: OFFICE ACCESS SCOPE FUNCTION ---
export function getOfficeAccessScope(session = {}) {
  const isAdmin = String(session?.role || "").trim().toLowerCase() === "admin";
  const permissions = session?.permissions || {};
  const ownOfficeId = session?.office_id ?? null;

  return {
    isAdmin,
    ownOfficeId,
    canViewGlobalStats: isAdmin || Boolean(permissions.view_global_stats),
    canViewOtherOffices: isAdmin || Boolean(permissions.view_other_offices),
    canManageOffice(targetOfficeId) {
      if (isAdmin) return true;
      if (ownOfficeId == null || targetOfficeId == null) return false;
      return String(ownOfficeId) === String(targetOfficeId);
    },
  };
}
// --- END: OFFICE ACCESS SCOPE FUNCTION ---
