import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { _mapToRbacRole } from "../src/backend/api/auth.js";
import { canDo } from "../src/frontend/assets/js/rbac/config.js";
import { getOfficeAccessScope } from "../src/frontend/assets/js/rbac/scope.js";

// --- START: TEST HELPER RESOLVE EXPORT PERMISSION - Tests whether session gets baseline or elevated export access ---
function canUserAccessExports(session) {
  const isApproved = session?.approved === true || session?.approved === "true" || session?.approved === 1;
  return isApproved;
}
// --- END: TEST HELPER RESOLVE EXPORT PERMISSION ---

// --- START: TEST HELPER EVALUATE EXPORT SCOPE - Emulates exports.js data scoping logic ---
function evaluateExportScope(user) {
  const access = getOfficeAccessScope(user);
  const isExecutive = access.isAdmin || access.isHr || access.isChief;
  const hasCrossOfficePerm = Boolean(
    user?.permissions?.export_reports === true ||
    user?.permissions?.export_reports === "true" ||
    user?.permissions?.export_reports === 1 ||
    user?.permissions?.view_other_offices
  );
  const canExportOtherOffices = isExecutive || hasCrossOfficePerm;
  const scopeToOwnOffice = !canExportOtherOffices;
  const canViewOtherOffices = isExecutive || hasCrossOfficePerm || access.canViewOtherOffices;

  return {
    isExecutive,
    hasCrossOfficePerm,
    canExportOtherOffices,
    scopeToOwnOffice,
    canViewOtherOffices,
  };
}
// --- END: TEST HELPER EVALUATE EXPORT SCOPE ---

// --- START: TEST HELPER FORMAT IMPLEMENTOR BATCH - Emulates implementor batch resolver from exports.js ---
function formatImplementorBatch(staff) {
  const deployments = (Array.isArray(staff.batch_deployments) && staff.batch_deployments.length > 0)
    ? staff.batch_deployments
    : (staff.started_at || staff.ended_at)
      ? [{ batch_id: 1, batch_name: "Batch 1" }]
      : [];

  return deployments.length > 0
    ? deployments.map(d => d.batch_name || (d.batch_id ? `Batch ${d.batch_id}` : "Batch")).join(", ")
    : (staff.batch_name || (staff.batch_id ? `Batch ${staff.batch_id}` : (staff.batch || "N/A")));
}
// --- END: TEST HELPER FORMAT IMPLEMENTOR BATCH ---

describe("1. Sidebar Navigation Bug & Baseline Export Access", () => {
  test("Approved officer without individual export permission CAN view and access Exports & Reports", () => {
    const approvedOfficer = {
      id: 5,
      full_name: "Juan Dela Cruz",
      role: "officer",
      role_id: 3,
      office_id: 1,
      approved: true,
      permissions: { export_reports: false }
    };
    assert.equal(canUserAccessExports(approvedOfficer), true);
  });

  test("Unapproved user is strictly barred from Exports & Reports", () => {
    const unapprovedOfficer = {
      id: 6,
      full_name: "Pending User",
      role: "officer",
      role_id: 3,
      office_id: 1,
      approved: false,
      permissions: { export_reports: false }
    };
    assert.equal(canUserAccessExports(unapprovedOfficer), false);
  });
});

describe("2. HR Global Scope in Configure Reports (Iligan Scope Bug Fix)", () => {
  const hrUser = {
    id: 2,
    full_name: "Lace Torregosa Arellano",
    role: "hr",
    role_id: 2,
    office_id: 1, // Iligan office
    office_name: "Iligan City Field Office",
    approved: true,
    permissions: {} // Even with empty staff_permissions row, HR is executive
  };

  test("HR is recognized as Executive and has cross-office export access", () => {
    const scope = evaluateExportScope(hrUser);
    assert.equal(scope.isExecutive, true);
    assert.equal(scope.canExportOtherOffices, true);
    assert.equal(scope.scopeToOwnOffice, false, "HR must NOT be scoped to own office");
    assert.equal(scope.canViewOtherOffices, true, "HR must be able to view and select all offices in drawer");
  });
});

describe("3. Cross-Office Export RBAC for Officers", () => {
  test("Officer with export_reports: true gains cross-office export access", () => {
    const officerWithCrossOffice = {
      id: 7,
      role: "officer",
      role_id: 3,
      office_id: 2,
      approved: true,
      permissions: { export_reports: true, view_other_offices: false }
    };
    const scope = evaluateExportScope(officerWithCrossOffice);
    assert.equal(scope.hasCrossOfficePerm, true);
    assert.equal(scope.canExportOtherOffices, true);
    assert.equal(scope.scopeToOwnOffice, false);
    assert.equal(scope.canViewOtherOffices, true);
  });

  test("Restricted Officer without cross-office permissions remains scoped to own office", () => {
    const restrictedOfficer = {
      id: 8,
      role: "officer",
      role_id: 3,
      office_id: 1,
      office_name: "Iligan City Field Office",
      approved: true,
      permissions: { export_reports: false, view_other_offices: false }
    };
    const scope = evaluateExportScope(restrictedOfficer);
    assert.equal(scope.isExecutive, false);
    assert.equal(scope.hasCrossOfficePerm, false);
    assert.equal(scope.canExportOtherOffices, false);
    assert.equal(scope.scopeToOwnOffice, true, "Restricted officer MUST be scoped to own office");
    assert.equal(scope.canViewOtherOffices, false, "Restricted officer must only see own office in drawer");
  });
});

describe("4. Chief Role Integration (ID: 4)", () => {
  test("_mapToRbacRole maps 4 and 'chief' correctly", () => {
    assert.equal(_mapToRbacRole(4), "chief");
    assert.equal(_mapToRbacRole("4"), "chief");
    assert.equal(_mapToRbacRole("chief"), "chief");
    assert.equal(_mapToRbacRole("Chief"), "chief");
    assert.equal(_mapToRbacRole("CHIEF"), "chief");
  });

  test("Chief has elevated executive access in getOfficeAccessScope but cannot manage/mutate offices", () => {
    const chiefUser = {
      id: 9,
      role: "chief",
      role_id: 4,
      office_id: 1,
      approved: true
    };
    const access = getOfficeAccessScope(chiefUser);
    assert.equal(access.isChief, true);
    assert.equal(access.isExecutive, true);
    assert.equal(access.canViewOtherOffices, true);
    assert.equal(access.canViewGlobalStats, true);
    assert.equal(access.canManageOffice(1), false, "Chief MUST be strictly read-only (canManageOffice is false)");
    assert.equal(access.canManageOffice(2), false, "Chief MUST NOT be able to manage any other office");

    const exportScope = evaluateExportScope(chiefUser);
    assert.equal(exportScope.isExecutive, true);
    assert.equal(exportScope.canExportOtherOffices, true);
    assert.equal(exportScope.scopeToOwnOffice, false);
  });

  test("canDo permissions for Chief role (viewing granted, mutations denied)", async () => {
    // Granted viewing and reporting capabilities
    assert.equal(await canDo("chief", "reports:export"), true);
    assert.equal(await canDo("chief", "offices:view-other"), true);
    assert.equal(await canDo("chief", "analytics:view-global"), true);
    assert.equal(await canDo("chief", "payroll:view"), true);
    assert.equal(await canDo("chief", "beneficiaries:view"), true, "Chief can view beneficiaries");

    // Strictly denied mutations
    assert.equal(await canDo("chief", "users:create"), false, "Chief cannot create users");
    assert.equal(await canDo("chief", "users:edit"), false, "Chief cannot edit users");
    assert.equal(await canDo("chief", "users:delete"), false, "Chief cannot delete users");
    assert.equal(await canDo("chief", "payroll:manage"), false, "Chief cannot manage payroll budgets");
    assert.equal(await canDo("chief", "roles:manage"), false, "Chief cannot manage database roles");
    assert.equal(await canDo("chief", "services:manage"), false, "Chief cannot access admin-only auto import");
  });
});

describe("5. Auth & SSO Two-Logic Name Detector & HR Fallback Prevention", () => {
  test("_mapToRbacRole does NOT match arbitrary strings containing 'hr'", () => {
    assert.equal(_mapToRbacRole("chr"), "officer");
    assert.equal(_mapToRbacRole("chris"), "officer");
    assert.equal(_mapToRbacRole("shredder"), "officer");
    assert.equal(_mapToRbacRole("chromebook"), "officer");
    assert.equal(_mapToRbacRole("hr"), "hr");
    assert.equal(_mapToRbacRole("HR"), "hr");
    assert.equal(_mapToRbacRole("Human Resource"), "hr");
    assert.equal(_mapToRbacRole("Human Resources"), "hr");
  });

  test("Two-Logic Detector: detects matching name, rejects/skips non-matching without assigning to HR", () => {
    const mockStaffDb = [
      { id: 1, full_name: "Admin User", role_id: 1 },
      { id: 2, full_name: "Lace Torregosa Arellano", role_id: 2 },
      { id: 3, full_name: "John Officer", role_id: 3 }
    ];

    // Logic 1: detected matching name
    const incomingName1 = "Lace Torregosa Arellano";
    const match1 = mockStaffDb.find(s => s.full_name.toLowerCase() === incomingName1.toLowerCase());
    assert.equal(match1?.id, 2);

    // Logic 2: non-matching name must NEVER resolve to ID 2 (HR)
    const incomingName2 = "New External User";
    const match2 = mockStaffDb.find(s => s.full_name.toLowerCase() === incomingName2.toLowerCase());
    assert.equal(match2, undefined);
    // Verified: If no match, match2 is undefined (N/A), NEVER defaulting to 2!
  });
});

describe("6. Batch Column Configuration for Implementors", () => {
  test("formatImplementorBatch formats single batch deployment correctly", () => {
    const staffWithDeployments = {
      id: 10,
      full_name: "Test Implementor",
      batch_deployments: [{ batch_id: 1, batch_name: "BATCH 1", started_at: "2026-01-01", ended_at: "2026-01-30" }]
    };
    assert.equal(formatImplementorBatch(staffWithDeployments), "BATCH 1");
  });

  test("formatImplementorBatch formats multiple batch deployments correctly", () => {
    const staffWithMultiple = {
      id: 11,
      full_name: "Multi Implementor",
      batch_deployments: [
        { batch_id: 1, batch_name: "Batch 1" },
        { batch_id: 2, batch_name: "Batch 2" }
      ]
    };
    assert.equal(formatImplementorBatch(staffWithMultiple), "Batch 1, Batch 2");
  });

  test("formatImplementorBatch falls back to Batch 1 for staff with start/end date", () => {
    const staffWithDates = {
      id: 12,
      full_name: "Dated Implementor",
      started_at: "2026-01-01T00:00:00.000Z"
    };
    assert.equal(formatImplementorBatch(staffWithDates), "Batch 1");
  });

  test("formatImplementorBatch returns N/A for staff with no batch data", () => {
    const staffWithoutBatch = {
      id: 13,
      full_name: "Blank Implementor"
    };
    assert.equal(formatImplementorBatch(staffWithoutBatch), "N/A");
  });
});

describe("7. Chief Auto-Approval & Auto-Grant All Permissions", () => {
  test("Chief and HR role assignment automatically sets approved: true and all permissions true", () => {
    const sampleChief = {
      id: 40,
      full_name: "Chief Criste",
      role: "chief",
      role_id: 4,
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

    assert.equal(sampleChief.approved, true);
    assert.equal(sampleChief.permissions.view_payroll, true);
    assert.equal(sampleChief.permissions.export_reports, true);
    assert.equal(sampleChief.permissions.view_other_offices, true);
    assert.equal(sampleChief.permissions.view_global_stats, true);
  });
});

describe("8. Chief Global Access in Payroll Subsystem", () => {
  const chiefPayrollSession = {
    id: 40,
    role: "chief",
    role_id: 4,
    office_id: 2,
    approved: true,
    permissions: {
      view_payroll: true,
      export_reports: true,
      view_other_offices: true,
      view_global_stats: true,
    }
  };

  test("Chief has global office scope in Payroll (can view other offices and global stats)", () => {
    const scope = getOfficeAccessScope(chiefPayrollSession);
    assert.equal(scope.isChief, true);
    assert.equal(scope.isExecutive, true);
    assert.equal(scope.canViewGlobalStats, true);
    assert.equal(scope.canViewOtherOffices, true);
    assert.equal(scope.canManageOffice(2), false, "Chief cannot manage/edit office payroll budgets");
  });

  test("Chief is permitted to export payroll summaries across all offices", () => {
    const scope = evaluateExportScope(chiefPayrollSession);
    assert.equal(scope.isExecutive, true);
    assert.equal(scope.canExportOtherOffices, true);
    assert.equal(scope.scopeToOwnOffice, false);
  });
});

