/**
 * Resolve cross-office read access separately from write access.
 *
 * `view_global_stats` controls dashboard analytics only.
 * `view_other_offices` controls read-only access to other office rosters.
 * Neither permission grants cross-office create, edit, archive, or transfer access.
 */

// --- START: OFFICE ACCESS SCOPE FUNCTION ---
export function getOfficeAccessScope(session = {}) {
  const role = String(session?.role || "").trim().toLowerCase();
  const roleId = Number(session?.role_id);
  const isAdmin = role === "admin" || roleId === 1;
  const isHr = role === "hr" || roleId === 2;
  const isExecutive = isAdmin || isHr;
  const isOfficer = role === "officer" || roleId === 3;
  const permissions = session?.permissions || {};
  const ownOfficeId = session?.office_id ?? null;

  return {
    isAdmin,
    isHr,
    isExecutive,
    isOfficer,
    ownOfficeId,
    // Admin and HR can see all global stats and other offices.
    // Officers check their individual permission grants.
    canViewGlobalStats: isExecutive || Boolean(permissions.view_global_stats),
    canViewOtherOffices: isExecutive || Boolean(permissions.view_other_offices),
    canManageOffice(targetOfficeId) {
      if (isExecutive) return true;
      if (isOfficer) {
        if (targetOfficeId == null) return true;
        if (ownOfficeId == null) return false;
        return String(ownOfficeId) === String(targetOfficeId);
      }
      if (Boolean(permissions.view_other_offices)) return true;
      if (targetOfficeId == null) return true;
      if (ownOfficeId == null) return false;
      return String(ownOfficeId) === String(targetOfficeId);
    },
  };
}
// --- END: OFFICE ACCESS SCOPE FUNCTION ---
