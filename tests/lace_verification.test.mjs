import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { _mapToRbacRole } from "../src/backend/api/auth.js";
import { isHrOrAdmin } from "../src/frontend/assets/js/rbac/guard.js";

describe("Lace Torregosa Arellano HR Role & Permissions Verification", () => {
  test("Lace role mapping resolves to 'hr'", () => {
    const roleFromDb = "HR";
    const roleIdFromDb = 2;
    const mappedRole = _mapToRbacRole(roleFromDb);
    const mappedRoleId = _mapToRbacRole(roleIdFromDb);

    assert.equal(mappedRole, "hr");
    assert.equal(mappedRoleId, "hr");
  });

  test("Lace session has HR status and access", () => {
    const laceSession = {
      id: 2,
      username: "lace_arellano",
      full_name: "Lace Torregosa Arellano",
      role: "hr",
      role_id: 2,
      role_label: "HR",
      approved: true,
      permissions: {
        view_users: true,
        create_users: true,
        edit_users: true,
        delete_users: true,
        export_reports: true,
        view_other_offices: true,
        view_global_stats: true,
        view_payroll: true,
      }
    };

    assert.equal(isHrOrAdmin(laceSession), true);

    const isAdmin = String(laceSession.role).toLowerCase() === "admin" || Number(laceSession.role_id) === 1;
    const isAutoImportAllowed = isAdmin && laceSession.approved === true;
    const isRolesManageAllowed = isHrOrAdmin(laceSession) && laceSession.approved === true;
    const isPayrollAllowed = laceSession.approved === true && (isHrOrAdmin(laceSession) || Boolean(laceSession.permissions.view_payroll));
    const isUsersAllowed = laceSession.approved === true && (isHrOrAdmin(laceSession) || Boolean(laceSession.permissions.view_users));
    const isReportsAllowed = laceSession.approved === true && (isHrOrAdmin(laceSession) || Boolean(laceSession.permissions.export_reports));

    assert.equal(isAutoImportAllowed, false, "Auto Import Tool must be inaccessible to Lace as HR");
    assert.equal(isRolesManageAllowed, true, "Roles & Permissions must be accessible to Lace as HR");
    assert.equal(isPayrollAllowed, true, "SPES Payroll must be accessible to Lace as HR");
    assert.equal(isUsersAllowed, true, "Implementor Directory must be accessible to Lace as HR");
    assert.equal(isReportsAllowed, true, "Exports & Reports must be accessible to Lace as HR");
  });
});
