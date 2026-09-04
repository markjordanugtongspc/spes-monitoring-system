import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ── LIGHTWEIGHT DOM & STORAGE ENVIRONMENT MOCK FOR NODE TEST RUNNER ─────
const createStorageMock = () => {
  let store = {};
  return {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => { store[key] = String(val); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
};

if (!globalThis.localStorage) globalThis.localStorage = createStorageMock();
if (!globalThis.sessionStorage) globalThis.sessionStorage = createStorageMock();
if (!globalThis.window) globalThis.window = globalThis;
if (!globalThis.document) {
  globalThis.document = {
    readyState: "complete",
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({
      classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => {} },
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: () => {},
      style: {},
    }),
  };
}

// ── MODULE IMPORTS ────────────────────────────────────────────────────────
import {
  computePayrollExecutiveSummary,
  groupOfficeBeneficiariesIntoChunks,
  DEFAULT_STIPEND_RATE,
  DEFAULT_WORK_DAYS,
  BATCH_CHUNK_SIZE,
} from "../src/backend/api/payroll.js";

import {
  hasValidDeploymentDate,
  formatPhilippineTimestamp,
} from "../src/frontend/assets/js/components/payroll.js";

import { isHrOrAdmin } from "../src/frontend/assets/js/rbac/guard.js";
import { getOfficeAccessScope } from "../src/frontend/assets/js/rbac/scope.js";

describe("1. Deployment Date Validation (hasValidDeploymentDate)", () => {
  test("accepts valid ISO date strings", () => {
    assert.equal(hasValidDeploymentDate("2026-07-01"), true);
    assert.equal(hasValidDeploymentDate("2026-07-01T08:00:00.000Z"), true);
    assert.equal(hasValidDeploymentDate("2026-09-05 03:40:00"), true);
  });

  test("rejects null, undefined, and empty values", () => {
    assert.equal(hasValidDeploymentDate(null), false);
    assert.equal(hasValidDeploymentDate(undefined), false);
    assert.equal(hasValidDeploymentDate(""), false);
    assert.equal(hasValidDeploymentDate("   "), false);
  });

  test("rejects sentinel text values", () => {
    assert.equal(hasValidDeploymentDate("N/A"), false);
    assert.equal(hasValidDeploymentDate("null"), false);
    assert.equal(hasValidDeploymentDate("undefined"), false);
    assert.equal(hasValidDeploymentDate("none"), false);
    assert.equal(hasValidDeploymentDate("NONE"), false);
    assert.equal(hasValidDeploymentDate("invalid-date-string"), false);
  });
});

describe("2. Philippine Timestamp Formatter (formatPhilippineTimestamp)", () => {
  test("formats UTC ISO timestamps to Asia/Manila (GMT+08)", () => {
    // 2026-07-01T00:00:00Z is 8:00 AM Manila Time
    const formatted = formatPhilippineTimestamp("2026-07-01T00:00:00.000Z");
    assert.match(formatted, /July 1, 2026/);
    assert.match(formatted, /8:00:00 AM/);
    assert.match(formatted, /\(GMT\+08\)/);
  });

  test("returns empty string for null, undefined or invalid dates", () => {
    assert.equal(formatPhilippineTimestamp(null), "");
    assert.equal(formatPhilippineTimestamp(undefined), "");
    assert.equal(formatPhilippineTimestamp(""), "");
    assert.equal(formatPhilippineTimestamp("not-a-date"), "");
  });
});

describe("3. Executive Payroll Summary Computations (computePayrollExecutiveSummary)", () => {
  const sampleBeneficiaries = [
    {
      id: 1,
      full_name: "JUAN DELA CRUZ",
      staffs: { office_id: 1 },
      payroll: { stipend_amount: 5133.00, payment_status: "PAID" },
    },
    {
      id: 2,
      full_name: "MARIA SANTOS",
      staffs: { office_id: 1 },
      payroll: { stipend_amount: 5133.00, payment_status: "PAID" },
    },
    {
      id: 3,
      full_name: "PEDRO PENDUKO",
      staffs: { office_id: 1 },
      payroll: { stipend_amount: 5133.00, payment_status: "PENDING" },
    },
    {
      id: 4,
      full_name: "ANA REYES",
      staffs: { office_id: 2 },
      payroll: { stipend_amount: 6000.00, payment_status: "PENDING" },
    },
    {
      id: 5,
      full_name: "JOSE RIZAL",
      staffs: { office_id: 2 },
      payroll: { stipend_amount: 5133.00, payment_status: "UNPAID" },
    },
  ];

  test("computes baseline budget from sum of individual stipends when no custom budget is provided", () => {
    const stats = computePayrollExecutiveSummary(sampleBeneficiaries, null);
    const expectedCalculated = 5133 + 5133 + 5133 + 6000 + 5133; // 26,532
    assert.equal(stats.totalBeneficiaries, 5);
    assert.equal(stats.totalBudget, expectedCalculated);
    assert.equal(stats.calculatedBudget, expectedCalculated);
    assert.equal(stats.isCustomBudget, false);
    assert.equal(stats.totalPaid, 10266); // 5133 + 5133
    assert.equal(stats.totalPending, 16266); // 5133 + 6000 + 5133
    assert.equal(stats.remainingBalance, expectedCalculated - 10266);
    assert.equal(stats.disbursementRate, Math.round((10266 / expectedCalculated) * 100));
  });

  test("respects custom general budget allocation and correctly computes remaining balance", () => {
    const customBudget = 100000;
    const stats = computePayrollExecutiveSummary(sampleBeneficiaries, customBudget);
    assert.equal(stats.totalBudget, 100000);
    assert.equal(stats.isCustomBudget, true);
    assert.equal(stats.totalPaid, 10266);
    assert.equal(stats.remainingBalance, 100000 - 10266); // 89,734
    assert.equal(stats.disbursementRate, Math.round((10266 / 100000) * 100));
  });

  test("handles empty beneficiary list cleanly without NaN or division by zero", () => {
    const stats = computePayrollExecutiveSummary([], 50000);
    assert.equal(stats.totalBeneficiaries, 0);
    assert.equal(stats.totalBudget, 50000);
    assert.equal(stats.totalPaid, 0);
    assert.equal(stats.totalPending, 0);
    assert.equal(stats.remainingBalance, 50000);
    assert.equal(stats.disbursementRate, 0);
  });

  test("handles completely empty inputs (no beneficiaries, no budget)", () => {
    const stats = computePayrollExecutiveSummary([], null);
    assert.equal(stats.totalBeneficiaries, 0);
    assert.equal(stats.totalBudget, 0);
    assert.equal(stats.totalPaid, 0);
    assert.equal(stats.remainingBalance, 0);
    assert.equal(stats.disbursementRate, 0);
  });

  test("falls back to DEFAULT_STIPEND_RATE when stipend_amount is missing or invalid", () => {
    const missingStipends = [
      { id: 10, payroll: {} },
      { id: 11, is_paid: true },
    ];
    const stats = computePayrollExecutiveSummary(missingStipends, null);
    assert.equal(stats.totalBudget, DEFAULT_STIPEND_RATE * 2);
    assert.equal(stats.totalPaid, DEFAULT_STIPEND_RATE);
    assert.equal(stats.totalPending, DEFAULT_STIPEND_RATE);
  });
});

describe("4. 50-Item Batch & ET.AL Chunking (groupOfficeBeneficiariesIntoChunks)", () => {
  test("returns empty array for empty office list", () => {
    const chunks = groupOfficeBeneficiariesIntoChunks([]);
    assert.deepEqual(chunks, []);
  });

  test("chunks 75 beneficiaries into 2 sub-sheets (B1 - P1 [50] and B1 - P1.2 [25])", () => {
    const beneficiaries = Array.from({ length: 75 }, (_, i) => ({
      id: i + 1,
      full_name: `BENEFICIARY ${String(i + 1).padStart(3, "0")}`,
      batch_id: 1,
      batch: { id: 1, batch_name: "BATCH 1" },
      month_period: "JULY",
      year_period: 2026,
      payroll: {
        stipend_amount: DEFAULT_STIPEND_RATE,
        payment_status: i < 30 ? "PAID" : "PENDING",
      }
    }));

    const chunks = groupOfficeBeneficiariesIntoChunks(beneficiaries, BATCH_CHUNK_SIZE);
    assert.equal(chunks.length, 2);

    // Chunk 1: first 50
    assert.equal(chunks[0].batchName, "BATCH 1 - PAYROLL 1");
    assert.equal(chunks[0].shortCode, "B1 - P1");
    assert.equal(chunks[0].beneficiaries.length, 50);
    assert.equal(chunks[0].totalPaid, 30 * DEFAULT_STIPEND_RATE);
    assert.equal(chunks[0].totalPrincipal, 50 * DEFAULT_STIPEND_RATE);
    assert.match(chunks[0].etAlName, /BENEFICIARY 001 ET\. AL/);

    // Chunk 2: remaining 25
    assert.equal(chunks[1].batchName, "BATCH 1 - PAYROLL 1.2");
    assert.equal(chunks[1].shortCode, "B1 - P1.2");
    assert.equal(chunks[1].beneficiaries.length, 25);
    assert.equal(chunks[1].totalPaid, 0); // all paid were in first 30
    assert.equal(chunks[1].totalPrincipal, 25 * DEFAULT_STIPEND_RATE);
    assert.match(chunks[1].etAlName, /BENEFICIARY 051 ET\. AL/);
  });
});

describe("5. RBAC & Office Scope Rules (isHrOrAdmin & getOfficeAccessScope)", () => {
  test("Admin (role_id: 1) has global access scope", () => {
    const adminSession = { id: 1, role: "admin", role_id: 1, approved: true };
    assert.equal(isHrOrAdmin(adminSession), true);
    const scope = getOfficeAccessScope(adminSession);
    assert.equal(scope.isAdmin, true);
    assert.equal(scope.canViewOtherOffices, true);
    assert.equal(scope.canViewGlobalStats, true);
  });

  test("HR (role_id: 2) has global access scope but is not super-admin", () => {
    const hrSession = { id: 2, role: "hr", role_id: 2, approved: true };
    assert.equal(isHrOrAdmin(hrSession), true);
    const scope = getOfficeAccessScope(hrSession);
    assert.equal(scope.isHr, true);
    assert.equal(scope.canViewOtherOffices, true);
    assert.equal(scope.canViewGlobalStats, true);
  });

  test("Officer (role_id: 3) is strictly NOT HR or Admin and scoped to assigned office", () => {
    const officerSession = {
      id: 3,
      role: "officer",
      role_id: 3,
      office_id: 3,
      approved: true,
      permissions: { view_payroll: true, view_other_offices: false, view_global_stats: false }
    };
    assert.equal(isHrOrAdmin(officerSession), false);
    const scope = getOfficeAccessScope(officerSession);
    assert.equal(scope.isOfficer, true);
    assert.equal(scope.canViewOtherOffices, false);
    assert.equal(scope.canViewGlobalStats, false);
    assert.equal(scope.ownOfficeId, 3);
  });
});
