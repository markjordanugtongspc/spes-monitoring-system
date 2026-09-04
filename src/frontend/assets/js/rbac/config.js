/**
 * SPES Portal — RBAC Role Definitions
 * ─────────────────────────────────────
 * Uses @rbac/rbac (hierarchical role-based access control).
 *
 * Roles:
 *   student  → Basic portal access (attendance, profile)
 *   officer  → Inherits student + can view implementor data (read-only)
 *   admin    → Inherits officer + full management (create, edit, delete)

 *
 * Permission format:  "resource:action"
 *   e.g. "users:edit", "attendance:verify", "settings:manage"
 */
import RBAC from "@rbac/rbac";

const roles = {
  student: {
    can: [
      "dashboard:view",
      "profile:view",
      "profile:edit",
      "attendance:view",
      "attendance:create"
    ]
  },
  officer: {
    can: [
      "implementor-dashboard:view",
      "attendance:verify",
      "reports:view",
      "beneficiaries:view"
    ],
    inherits: ["student"]
  },
  hr: {
    can: [
      "users:create",
      "users:edit",
      "users:delete",
      "users:manage",
      "users:view",
      "offices:view-other",
      "analytics:view-global",
      "settings:manage",
      "reports:export",
      "beneficiaries:edit",
      "beneficiaries:delete",
      "payroll:view",
      "payroll:manage"
    ],
    inherits: ["officer"]
  },
  admin: {
    can: [
      "roles:manage",
      "services:manage",
      "services:access",
      "system:*"
    ],
    inherits: ["hr"]
  }
};

export const rbac = RBAC({ enableLogger: false })(roles);

/**
 * Convenience helper — returns true/false without throwing.
 * @param {string} role    – "admin" | "officer" | "student"
 * @param {string} action  – "users:edit", "attendance:verify", etc.
 */
export async function canDo(role, action) {
  try {
    return await rbac.can(role, action);
  } catch {
    return false;
  }
}
