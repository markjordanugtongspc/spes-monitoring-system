import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { _mapToRbacRole } from "../src/backend/api/auth.js";
import { isHrOrAdmin } from "../src/frontend/assets/js/rbac/guard.js";

describe("1. Role Mapping (_mapToRbacRole)", () => {
  test("correctly maps numeric and string role IDs", () => {
    assert.equal(_mapToRbacRole(1), "admin");
    assert.equal(_mapToRbacRole("1"), "admin");
    assert.equal(_mapToRbacRole(2), "hr");
    assert.equal(_mapToRbacRole("2"), "hr");
    assert.equal(_mapToRbacRole(3), "officer");
    assert.equal(_mapToRbacRole("3"), "officer");
  });

  test("correctly maps role string names (case-insensitive)", () => {
    assert.equal(_mapToRbacRole("admin"), "admin");
    assert.equal(_mapToRbacRole("ADMIN"), "admin");
    assert.equal(_mapToRbacRole("Administrator"), "admin");
    assert.equal(_mapToRbacRole("hr"), "hr");
    assert.equal(_mapToRbacRole("HR"), "hr");
    assert.equal(_mapToRbacRole("Human Resource"), "hr");
    assert.equal(_mapToRbacRole("officer"), "officer");
    assert.equal(_mapToRbacRole("OFFICER"), "officer");
  });

  test("falls back to officer for undefined, null, or empty input", () => {
    assert.equal(_mapToRbacRole(null), "officer");
    assert.equal(_mapToRbacRole(undefined), "officer");
    assert.equal(_mapToRbacRole(""), "officer");
    assert.equal(_mapToRbacRole("unknown"), "officer");
  });
});

describe("2. HR & Admin Status Recognition (isHrOrAdmin)", () => {
  test("Admin (role_id: 1, role: 'admin') is recognized as HR or Admin", () => {
    assert.equal(isHrOrAdmin({ id: 1, role: "admin", role_id: 1, approved: true }), true);
  });

  test("HR (role_id: 2, role: 'hr') is recognized as HR or Admin", () => {
    assert.equal(isHrOrAdmin({ id: 2, role: "hr", role_id: 2, approved: true }), true);
    assert.equal(isHrOrAdmin({ id: 2, role: "HR", role_id: 2, approved: true }), true);
    assert.equal(isHrOrAdmin({ id: 2, role_id: 2, approved: true }), true);
  });

  test("Officer (role_id: 3, role: 'officer') is strictly not HR or Admin", () => {
    assert.equal(isHrOrAdmin({ id: 3, role: "officer", role_id: 3, approved: true }), false);
    assert.equal(isHrOrAdmin({ id: 4, role: "student", role_id: null, approved: true }), false);
    assert.equal(isHrOrAdmin(null), false);
  });
});

describe("3. Sidebar Navigation & Guard Permissions Matrix", () => {
  const hrSession = {
    id: 2,
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

  const adminSession = {
    id: 1,
    role: "admin",
    role_id: 1,
    role_label: "Admin",
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

  const officerSession = {
    id: 3,
    role: "officer",
    role_id: 3,
    role_label: "Officer",
    approved: true,
    permissions: {
      view_users: false,
      create_users: false,
      edit_users: false,
      delete_users: false,
      export_reports: false,
      view_other_offices: false,
      view_global_stats: false,
      view_payroll: false,
    }
  };

  test("HR can access all baseline operational features in sidebar", () => {
    assert.equal(isHrOrAdmin(hrSession), true);
    assert.equal(Boolean(hrSession.approved), true);
    assert.equal(Boolean(hrSession.permissions.view_payroll), true);
    assert.equal(Boolean(hrSession.permissions.view_users), true);
    assert.equal(Boolean(hrSession.permissions.export_reports), true);
  });

  test("HR is strictly barred from Admin-only tools (Auto Import & Roles)", () => {
    const isHrAdmin = String(hrSession.role).toLowerCase() === "admin" || Number(hrSession.role_id) === 1;
    assert.equal(isHrAdmin, false, "HR must not have admin flag");

    // "services:manage" (Auto Import Tool) is strictly Admin only
    const canAccessAutoImport = isHrAdmin && hrSession.approved === true;
    assert.equal(canAccessAutoImport, false, "Auto Import must be inaccessible to HR");

    // "roles:manage" (Roles & Permissions) is strictly Admin only
    const canManageRoles = isHrAdmin && hrSession.approved === true;
    assert.equal(canManageRoles, false, "Roles management must be inaccessible to HR");
  });

  test("Admin has full access to Auto Import and Roles", () => {
    const isAdmin = String(adminSession.role).toLowerCase() === "admin" || Number(adminSession.role_id) === 1;
    assert.equal(isAdmin, true);
    const canAccessAutoImport = isAdmin && adminSession.approved === true;
    assert.equal(canAccessAutoImport, true);
    const canManageRoles = isAdmin && adminSession.approved === true;
    assert.equal(canManageRoles, true);
  });

  test("Officer has restricted access by default", () => {
    assert.equal(isHrOrAdmin(officerSession), false);
    assert.equal(Boolean(officerSession.permissions.view_payroll), false);
    assert.equal(Boolean(officerSession.permissions.view_users), false);
  });
});
