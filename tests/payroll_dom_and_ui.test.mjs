import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("6. Payroll HTML Document Structure (src/frontend/pages/payroll/index.html)", () => {
  const htmlPath = path.resolve("src/frontend/pages/payroll/index.html");
  const htmlContent = fs.readFileSync(htmlPath, "utf-8");

  test("HTML file exists and is populated", () => {
    assert.ok(htmlContent.length > 1000);
  });

  test("Contains all 4 Executive Statistic Cards and elements", () => {
    assert.ok(htmlContent.includes('id="stat-total-budget"'), "Missing stat-total-budget");
    assert.ok(htmlContent.includes('id="stat-total-paid"'), "Missing stat-total-paid");
    assert.ok(htmlContent.includes('id="stat-total-pending"'), "Missing stat-total-pending");
    assert.ok(htmlContent.includes('id="stat-remaining-balance"'), "Missing stat-remaining-balance");
    assert.ok(htmlContent.includes('id="stat-beneficiary-count"'), "Missing stat-beneficiary-count");
    assert.ok(htmlContent.includes('id="stat-disbursement-rate"'), "Missing stat-disbursement-rate");
  });

  test("Contains all 3 Hierarchy Views containers", () => {
    assert.ok(htmlContent.includes('id="payroll-implementors-view"'), "Missing implementors view");
    assert.ok(htmlContent.includes('id="payroll-batches-view"'), "Missing batches view");
    assert.ok(htmlContent.includes('id="payroll-beneficiaries-view"'), "Missing beneficiaries view");
  });

  test("Contains Flowbite Offcanvas Drawer and Edit Form components", () => {
    assert.ok(htmlContent.includes('id="drawer-payroll-edit"'), "Missing drawer-payroll-edit");
    assert.ok(htmlContent.includes('id="drawer-payroll-edit-overlay"'), "Missing drawer overlay");
    assert.ok(htmlContent.includes('id="form-payroll-drawer"'), "Missing form-payroll-drawer");
    assert.ok(htmlContent.includes('id="pd-view-container"'), "Missing pd-view-container");
    assert.ok(htmlContent.includes('id="btn-switch-to-edit-drawer"'), "Missing btn-switch-to-edit-drawer");
    assert.ok(htmlContent.includes('id="btn-save-payroll-drawer"'), "Missing btn-save-payroll-drawer");
  });

  test("Contains Action Toolbar & Interactive Filters", () => {
    assert.ok(htmlContent.includes('id="payroll-search-input"'), "Missing search input");
    assert.ok(htmlContent.includes('id="btn-payroll-status-filter"'), "Missing status filter button");
    assert.ok(htmlContent.includes('id="btn-bulk-disburse"'), "Missing bulk disburse button");
    assert.ok(htmlContent.includes('id="btn-export-payroll-summary"'), "Missing export button");
  });
});

describe("7. Payroll Bootstrapper (src/frontend/assets/js/payroll.js)", () => {
  const bootstrapperPath = path.resolve("src/frontend/assets/js/payroll.js");
  const code = fs.readFileSync(bootstrapperPath, "utf-8");

  test("imports guard, styling, and initializes sub-modules", () => {
    assert.ok(code.includes('import { applyPermissions, highlightSidebarActiveLink, requirePayrollAccess, signOut, getSession } from "./rbac/guard.js"'));
    assert.ok(code.includes('import { initPayroll } from "./components/payroll.js"'));
    assert.ok(code.includes('requirePayrollAccess()'));
  });

  test("handles DOMContentLoaded and interactive readyState safely", () => {
    assert.ok(code.includes('document.readyState === "loading"'));
    assert.ok(code.includes('DOMContentLoaded'));
  });
});
