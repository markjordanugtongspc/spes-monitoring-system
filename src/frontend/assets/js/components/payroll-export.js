/**
 * SPES Portal — Payroll Export Report Service & Modal Controller
 * ──────────────────────────────────────────────────────────────
 * Provides modern Flowbite/TailwindCSS export modal, rich ExcelJS spreadsheet
 * generator with color highlights, DOLE header banners, financial summaries,
 * and custom CSV generator with developer credits to Mark Jordan Ugtong.
 */

import { modals } from "./modals.js";

// Column Definitions for Payroll Export
export const PAYROLL_EXPORT_COLUMNS = [
  // Core Payroll
  { key: "id_display",     label: "ID No.",                 default: true,  group: "payroll" },
  { key: "full_name",      label: "Beneficiary Name",       default: true,  group: "payroll" },
  { key: "office_name",    label: "Office / Implementor",   default: true,  group: "payroll" },
  { key: "contract_period",label: "Contract Period",        default: true,  group: "payroll" },
  { key: "days_worked",    label: "Days Worked",            default: true,  group: "payroll" },
  { key: "stipend_amount", label: "Stipend Amount (₱)",     default: true,  group: "payroll" },
  { key: "payment_status", label: "Payment Status",         default: true,  group: "payroll" },
  { key: "date_paid",      label: "Date Paid (GMT+08)",     default: true,  group: "payroll" },
  { key: "notes",          label: "Auditing Remarks / Notes", default: true, group: "payroll" },
  
  // Demographics & Profile Settings
  { key: "gender",         label: "Gender",                 default: false, group: "demographics" },
  { key: "age",            label: "Age",                    default: false, group: "demographics" },
  { key: "birthday",       label: "Birthday",               default: false, group: "demographics" },
  { key: "contact_number", label: "Contact Number",         default: false, group: "demographics" },
  { key: "address",        label: "Permanent Address",      default: false, group: "demographics" },
  { key: "education",      label: "Education Level",        default: false, group: "demographics" },
  { key: "designated",     label: "Designated Position",    default: false, group: "demographics" },
  { key: "return_status",  label: "SPES Status (Baby/New)", default: false, group: "demographics" },
  { key: "relationship",   label: "Relationship",           default: false, group: "demographics" },
];

// --- START: RESOLVE BENEFICIARY FIELD HELPERS ---
function _eduLabel(id) {
  return { 1: "Senior High", 2: "College Graduate", 3: "College Level", 4: "High School" }[id] ?? "N/A";
}

function _resolveGender(b) {
  if (b.gender_id === 1 || String(b.gender).toLowerCase() === "male" || b.gender?.name === "Male") return "Male";
  if (b.gender_id === 2 || String(b.gender).toLowerCase() === "female" || b.gender?.name === "Female") return "Female";
  return b.gender?.name || (b.gender_id ? `Gender #${b.gender_id}` : "N/A");
}

function _resolveEducation(b) {
  return b.education?.name ?? b.education_level?.name ?? _eduLabel(b.educ_id);
}

function _resolveBirthday(b) {
  if (!b.birthday) return "N/A";
  try {
    return new Date(b.birthday).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  } catch {
    return String(b.birthday);
  }
}
// --- END: RESOLVE BENEFICIARY FIELD HELPERS ---

// Excel Palette Constants (Matching DOLE Enterprise Theme)
const _XL = {
  blue:       "FF0038A8", // DOLE Blue
  blueDark:   "FF002878", // Deep Dark Blue
  blueLight:  "FFEBF5FF", // Light Blue Tint
  red:        "FFDC2626", // DOLE Red
  white:      "FFFFFFFF",
  ink:        "FF111827",
  muted:      "FF6B7280",
  faint:      "FFE5E7EB",
  zebra:      "FFF9FAFB",
  paidBg:     "FFECFDF5", // Light Emerald
  paidText:   "FF059669", // Emerald 600
  pendingBg:  "FFFFFBEB", // Light Amber
  pendingText:"FFD97706", // Amber 600
  unpaidBg:   "FFF3F4F6", // Slate
  unpaidText: "FF4B5563",
};

let _allBeneficiaries = [];
let _allOffices = [];
let _formatCurrencyHelper = (v) => `₱${Number(v || 0).toLocaleString()}`;
let _formatTimestampHelper = (v) => v || "";
let _currentOfficeScope = "all";

// --- START: ESCAPE CSV FIELD HELPER ---
function escCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}
// --- END: ESCAPE CSV FIELD HELPER ---

// --- START: POPULATE EXPORT MODAL OFFICE SCOPE OPTIONS ---
function populateOfficeScopeOptions() {
  const select = document.getElementById("export-office-scope");
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = '<option value="all">All Implementors & Offices</option>';

  _allOffices.forEach(office => {
    const opt = document.createElement("option");
    opt.value = String(office.id);
    opt.textContent = office.name || `Office #${office.id}`;
    select.appendChild(opt);
  });

  if (_currentOfficeScope && _currentOfficeScope !== "all") {
    select.value = String(_currentOfficeScope);
  } else if (currentVal) {
    select.value = currentVal;
  }
}
// --- END: POPULATE EXPORT MODAL OFFICE SCOPE OPTIONS ---

// --- START: COMPUTE FILTERED EXPORT BENEFICIARIES ---
function getFilteredExportBeneficiaries() {
  const officeScope = document.getElementById("export-office-scope")?.value || "all";
  const statusFilter = document.getElementById("export-status-filter")?.value || "all";

  let list = [..._allBeneficiaries].filter(b => !b.archived_at);

  if (officeScope !== "all") {
    list = list.filter(b => String(b.staffs?.office_id) === String(officeScope));
  }

  if (statusFilter !== "all") {
    list = list.filter(b => (b.payroll?.payment_status || "PENDING") === statusFilter);
  }

  return list;
}
// --- END: COMPUTE FILTERED EXPORT BENEFICIARIES ---

// --- START: UPDATE LIVE EXPORT PREVIEW COUNT ---
function updateExportPreviewCount() {
  const countEl = document.getElementById("export-preview-count");
  if (!countEl) return;
  const list = getFilteredExportBeneficiaries();
  countEl.textContent = list.length.toLocaleString();
}
// --- END: UPDATE LIVE EXPORT PREVIEW COUNT ---

import { Modal, initFlowbite } from "flowbite";

let _exportModalInstance = null;

// --- START: GET OR CREATE FLOWBITE MODAL INSTANCE ---
function getExportModalInstance() {
  const modalEl = document.getElementById("modal-export-payroll");
  if (!modalEl) return null;
  if (!_exportModalInstance) {
    try {
      _exportModalInstance = new Modal(modalEl, {
        backdrop: "dynamic",
        closable: true,
      });
    } catch (e) {
      if (import.meta.env.DEV) console.warn("[SPES Export Modal] Flowbite modal init fallback:", e);
      _exportModalInstance = null;
    }
  }
  return _exportModalInstance;
}
// --- END: GET OR CREATE FLOWBITE MODAL INSTANCE ---

// --- START: OPEN PAYROLL EXPORT MODAL ---
export function openPayrollExportModal(currentOfficeId = null) {
  if (currentOfficeId) {
    _currentOfficeScope = currentOfficeId;
  }
  populateOfficeScopeOptions();
  updateExportPreviewCount();

  const instance = getExportModalInstance();
  if (instance) {
    instance.show();
  } else {
    const modal = document.getElementById("modal-export-payroll");
    if (modal) {
      modal.classList.remove("hidden");
      modal.classList.add("flex");
    }
  }
}
// --- END: OPEN PAYROLL EXPORT MODAL ---

// --- START: CLOSE PAYROLL EXPORT MODAL ---
export function closePayrollExportModal() {
  const instance = getExportModalInstance();
  if (instance) {
    instance.hide();
  } else {
    const modal = document.getElementById("modal-export-payroll");
    if (modal) {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
    }
  }
}
// --- END: CLOSE PAYROLL EXPORT MODAL ---

// --- START: GENERATE RICH EXCEL (.XLSX) PAYROLL REPORT ---
export async function generateExcelPayrollReport(beneficiaries, selectedCols = []) {
  const now = new Date();
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "SPES Portal System";
  wb.lastModifiedBy = "Mark Jordan Ugtong";
  wb.created = now;
  wb.modified = now;

  const ws = wb.addWorksheet("Payroll Summary", {
    views: [{ state: "frozen", ySplit: 5 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
    },
  });

  const colsToExport = PAYROLL_EXPORT_COLUMNS.filter(c => selectedCols.includes(c.key));
  const colCount = Math.max(colsToExport.length, 1);

  const colLetter = (n) => {
    let s = "";
    while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const lastColLetter = colLetter(colCount);

  // Financial Statistics
  let totalPrincipal = 0;
  let totalPaid = 0;
  let totalPending = 0;
  beneficiaries.forEach(b => {
    const amt = Number(b.payroll?.stipend_amount) || 5133.00;
    totalPrincipal += amt;
    if (b.payroll?.payment_status === "PAID") totalPaid += amt;
    else totalPending += amt;
  });

  const officeSelect = document.getElementById("export-office-scope");
  const selectedOfficeName = officeSelect && officeSelect.value !== "all"
    ? officeSelect.options[officeSelect.selectedIndex].text
    : "ALL IMPLEMENTORS & OFFICES";

  // ── ROW 1: DOLE Enterprise Header Banner ──
  ws.mergeCells(`A1:${lastColLetter}1`);
  const r1 = ws.getCell("A1");
  r1.value = "DEPARTMENT OF LABOR AND EMPLOYMENT";
  r1.font = { name: "Calibri", size: 14, bold: true, color: { argb: _XL.white } };
  r1.alignment = { vertical: "middle", horizontal: "center" };
  r1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: _XL.blue } };
  ws.getRow(1).height = 26;

  // ── ROW 2: Subtitle ──
  ws.mergeCells(`A2:${lastColLetter}2`);
  const r2 = ws.getCell("A2");
  r2.value = "SPECIAL PROGRAM FOR EMPLOYMENT OF STUDENTS (SPES) — PAYROLL DISBURSEMENT REPORT";
  r2.font = { name: "Calibri", size: 10.5, bold: true, color: { argb: _XL.red } };
  r2.alignment = { vertical: "middle", horizontal: "center" };
  r2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: _XL.white } };
  ws.getRow(2).height = 18;

  // ── ROW 3: Date & Scope Line ──
  const dateFormatted = _formatTimestampHelper(now.toISOString()) || now.toLocaleString();
  ws.mergeCells(`A3:${lastColLetter}3`);
  const r3 = ws.getCell("A3");
  r3.value = `SCOPE: ${selectedOfficeName.toUpperCase()}   •   GENERATED: ${dateFormatted}   •   TOTAL BENEFICIARIES: ${beneficiaries.length.toLocaleString()}`;
  r3.font = { name: "Calibri", size: 9, italic: true, color: { argb: _XL.muted } };
  r3.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(3).height = 16;

  // ── ROW 4: Financial Summary Band ──
  ws.mergeCells(`A4:${lastColLetter}4`);
  const r4 = ws.getCell("A4");
  r4.value = `TOTAL ALLOCATED: ${_formatCurrencyHelper(totalPrincipal)}   •   DISBURSED (PAID): ${_formatCurrencyHelper(totalPaid)}   •   PENDING RELEASE: ${_formatCurrencyHelper(totalPending)}`;
  r4.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: _XL.blueDark } };
  r4.alignment = { vertical: "middle", horizontal: "center" };
  r4.fill = { type: "pattern", pattern: "solid", fgColor: { argb: _XL.blueLight } };
  ws.getRow(4).height = 18;

  // ── ROW 5: Column Headers ──
  const headerRow = ws.getRow(5);
  colsToExport.forEach((c, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = c.label.toUpperCase();
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: _XL.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: _XL.blueDark } };
    cell.alignment = { vertical: "middle", horizontal: c.key === "full_name" || c.key === "notes" ? "left" : "center" };
    cell.border = {
      top:    { style: "thin", color: { argb: _XL.blueDark } },
      bottom: { style: "thin", color: { argb: _XL.blueDark } },
      left:   { style: "thin", color: { argb: _XL.blueDark } },
      right:  { style: "thin", color: { argb: _XL.blueDark } },
    };
  });
  headerRow.height = 22;

  // Auto-filter
  ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: colCount } };

  // ── ROW 6+: Data Rows ──
  let rowIdx = 6;
  let zebra = 0;

  beneficiaries.forEach(b => {
    const row = ws.getRow(rowIdx);
    const tint = (zebra++ % 2 === 1);
    const p = b.payroll || {};
    const officeObj = b.staffs?.office_id ? _allOffices.find(o => String(o.id) === String(b.staffs.office_id)) : null;
    const officeName = officeObj ? officeObj.name : "N/A";
    const status = p.payment_status || "PENDING";
    const isPaid = status === "PAID";
    const isPending = status === "PENDING";

    colsToExport.forEach((c, idx) => {
      const cell = row.getCell(idx + 1);

      if (c.key === "id_display") {
        cell.value = b.id || "—";
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: _XL.blue } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "full_name") {
        cell.value = String(b.full_name || "—").toUpperCase();
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (c.key === "office_name") {
        cell.value = officeName;
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (c.key === "contract_period") {
        cell.value = p.contract_period || "JULY 2026";
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "days_worked") {
        cell.value = p.days_worked || 20;
        cell.font = { name: "Calibri", size: 10, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "stipend_amount") {
        cell.value = Number(p.stipend_amount) || 5133.00;
        cell.numFmt = "₱#,##0.00";
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: _XL.blueDark } };
        cell.alignment = { vertical: "middle", horizontal: "right" };
      } else if (c.key === "payment_status") {
        cell.value = status;
        const fontColor = isPaid ? _XL.paidText : (isPending ? _XL.pendingText : _XL.unpaidText);
        const bgColor = isPaid ? _XL.paidBg : (isPending ? _XL.pendingBg : _XL.unpaidBg);
        cell.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: fontColor } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "date_paid") {
        cell.value = p.date_paid ? _formatTimestampHelper(p.date_paid) : "—";
        cell.font = { name: "Calibri", size: 9, color: { argb: isPaid ? _XL.paidText : _XL.muted } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "notes") {
        cell.value = p.notes || "—";
        cell.font = { name: "Calibri", size: 9, italic: !p.notes, color: { argb: _XL.muted } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (c.key === "gender") {
        cell.value = _resolveGender(b);
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "age") {
        cell.value = b.age || "—";
        cell.font = { name: "Calibri", size: 10, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "birthday") {
        cell.value = _resolveBirthday(b);
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "contact_number") {
        cell.value = b.contact_number || b.phone || "—";
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "address") {
        cell.value = b.address || "—";
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (c.key === "education") {
        cell.value = _resolveEducation(b);
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (c.key === "designated") {
        cell.value = b.designated || "—";
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      } else if (c.key === "return_status") {
        const isBaby = String(b.return_status || "NEW").toUpperCase() === "SPES BABY";
        cell.value = isBaby ? "SPES Baby" : "New";
        cell.font = { name: "Calibri", size: 9.5, bold: true, color: { argb: isBaby ? "FFDC2626" : "FF059669" } };
        cell.alignment = { vertical: "middle", horizontal: "center" };
      } else if (c.key === "relationship") {
        cell.value = b.relationship || "—";
        cell.font = { name: "Calibri", size: 9.5, color: { argb: _XL.ink } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      }

      if (tint && c.key !== "payment_status") {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: _XL.zebra } };
      }

      cell.border = {
        bottom: { style: "hair", color: { argb: _XL.faint } },
        right:  { style: "hair", color: { argb: _XL.faint } },
      };
    });

    row.height = 18;
    rowIdx++;
  });

  // ── ROW: Developer Credit & Property Footer ──
  const footerRowIdx = rowIdx;
  ws.mergeCells(`A${footerRowIdx}:${lastColLetter}${footerRowIdx}`);
  const footerCell = ws.getCell(`A${footerRowIdx}`);
  footerCell.value = `TOTAL RECORDS: ${beneficiaries.length.toLocaleString()}   •   © ${now.getFullYear()} SPES Portal System   •   Developed by Mark Jordan Ugtong   •   Exclusive Property of DOLE Iligan City`;
  footerCell.font = { name: "Calibri", size: 8, color: { argb: _XL.muted } };
  footerCell.alignment = { vertical: "middle", horizontal: "center" };
  footerCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
  ws.getRow(footerRowIdx).height = 24;

  // Auto-clamp column widths
  colsToExport.forEach((c, idx) => {
    let max = c.label.length + 4;
    beneficiaries.slice(0, 100).forEach(b => {
      const p = b.payroll || {};
      let valStr = "";
      if (c.key === "full_name") valStr = String(b.full_name || "");
      else if (c.key === "office_name") valStr = b.staffs?.office_id ? (_allOffices.find(o => String(o.id) === String(b.staffs.office_id))?.name || "") : "";
      else if (c.key === "date_paid") valStr = p.date_paid ? _formatTimestampHelper(p.date_paid) : "";
      else if (c.key === "address") valStr = String(b.address || "");
      else if (c.key === "education") valStr = String(_resolveEducation(b));
      if (valStr.length > max) max = valStr.length;
    });
    ws.getColumn(idx + 1).width = Math.min(Math.max(max + 2, 12), 40);
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `SPES_Payroll_Report_${now.toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
// --- END: GENERATE RICH EXCEL (.XLSX) PAYROLL REPORT ---

// --- START: GENERATE FORMATTED CSV (.CSV) PAYROLL REPORT ---
export function generateCsvPayrollReport(beneficiaries, selectedCols = []) {
  const now = new Date();
  const colsToExport = PAYROLL_EXPORT_COLUMNS.filter(c => selectedCols.includes(c.key));

  const officeSelect = document.getElementById("export-office-scope");
  const selectedOfficeName = officeSelect && officeSelect.value !== "all"
    ? officeSelect.options[officeSelect.selectedIndex].text
    : "ALL IMPLEMENTORS & OFFICES";

  const dateFormatted = _formatTimestampHelper(now.toISOString()) || now.toLocaleString();

  const lines = [
    `# DEPARTMENT OF LABOR AND EMPLOYMENT — SPES PAYROLL MONITORING REPORT`,
    `# Scope: ${selectedOfficeName.toUpperCase()}`,
    `# Generated: ${dateFormatted}`,
    `# Total Beneficiaries: ${beneficiaries.length.toLocaleString()}`,
    `# Developed by Mark Jordan Ugtong — Exclusive Property of DOLE Iligan City`,
    ``,
    colsToExport.map(c => escCsvField(c.label)).join(","),
  ];

  beneficiaries.forEach(b => {
    const p = b.payroll || {};
    const officeObj = b.staffs?.office_id ? _allOffices.find(o => String(o.id) === String(b.staffs.office_id)) : null;
    const officeName = officeObj ? officeObj.name : "N/A";

    const row = colsToExport.map(c => {
      if (c.key === "id_display") return escCsvField(b.id || "");
      if (c.key === "full_name") return escCsvField(b.full_name || "");
      if (c.key === "office_name") return escCsvField(officeName);
      if (c.key === "contract_period") return escCsvField(p.contract_period || "JULY 2026");
      if (c.key === "days_worked") return escCsvField(p.days_worked || 20);
      if (c.key === "stipend_amount") return escCsvField(p.stipend_amount || 5133.00);
      if (c.key === "payment_status") return escCsvField(p.payment_status || "PENDING");
      if (c.key === "date_paid") return escCsvField(p.date_paid ? _formatTimestampHelper(p.date_paid) : "");
      if (c.key === "notes") return escCsvField(p.notes || "");
      if (c.key === "gender") return escCsvField(_resolveGender(b));
      if (c.key === "age") return escCsvField(b.age || "");
      if (c.key === "birthday") return escCsvField(_resolveBirthday(b));
      if (c.key === "contact_number") return escCsvField(b.contact_number || b.phone || "");
      if (c.key === "address") return escCsvField(b.address || "");
      if (c.key === "education") return escCsvField(_resolveEducation(b));
      if (c.key === "designated") return escCsvField(b.designated || "");
      if (c.key === "return_status") return escCsvField(String(b.return_status || "NEW").toUpperCase() === "SPES BABY" ? "SPES Baby" : "New");
      if (c.key === "relationship") return escCsvField(b.relationship || "");
      return '""';
    });

    lines.push(row.join(","));
  });

  // Footer credit line in CSV
  lines.push(``);
  lines.push(`# © ${now.getFullYear()} SPES Portal System • Developed by Mark Jordan Ugtong • Exclusive Property of DOLE Iligan City`);

  const csvContent = lines.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `SPES_Payroll_Report_${now.toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
// --- END: GENERATE FORMATTED CSV (.CSV) PAYROLL REPORT ---

let _isInitialized = false;
let _isExporting = false;

// --- START: UPDATE PAYROLL EXPORT DATA REFERENCES ---
export function updatePayrollExportData({ allBeneficiaries, allOffices, formatCurrency, formatPhilippineTimestamp } = {}) {
  if (allBeneficiaries) _allBeneficiaries = allBeneficiaries;
  if (allOffices) _allOffices = allOffices;
  if (formatCurrency) _formatCurrencyHelper = formatCurrency;
  if (formatPhilippineTimestamp) _formatTimestampHelper = formatPhilippineTimestamp;
}
// --- END: UPDATE PAYROLL EXPORT DATA REFERENCES ---

// --- START: INITIALIZE PAYROLL EXPORT MODAL LISTENERS ---
export function initPayrollExportModal({ allBeneficiaries = [], allOffices = [], formatCurrency, formatPhilippineTimestamp } = {}) {
  updatePayrollExportData({ allBeneficiaries, allOffices, formatCurrency, formatPhilippineTimestamp });

  if (_isInitialized) return;
  _isInitialized = true;

  try {
    initFlowbite();
  } catch {}

  // Format Card Selection Styling Toggle
  const formatCards = document.querySelectorAll(".format-card");
  const formatRadios = document.querySelectorAll(".export-format-radio");

  const syncFormatCardStyles = () => {
    const selectedFormat = document.querySelector(".export-format-radio:checked")?.value || "xlsx";
    formatCards.forEach(card => {
      const isCardSelected = card.dataset.format === selectedFormat;
      if (isCardSelected) {
        if (selectedFormat === "xlsx") {
          card.className = "cursor-pointer relative flex flex-col p-4 border-2 border-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/20 dark:border-emerald-500 rounded-xl transition-all shadow-md format-card";
        } else {
          card.className = "cursor-pointer relative flex flex-col p-4 border-2 border-purple-500 bg-purple-50/40 dark:bg-purple-950/20 dark:border-purple-500 rounded-xl transition-all shadow-md format-card";
        }
      } else {
        card.className = "cursor-pointer relative flex flex-col p-4 border-2 border-gray-200 dark:border-white/15 bg-white dark:bg-spes-dark-secondary rounded-xl transition-all hover:shadow-md format-card";
      }
    });
  };

  formatRadios.forEach(r => r.addEventListener("change", syncFormatCardStyles));
  syncFormatCardStyles();

  // Filters Live Count Listeners
  document.getElementById("export-office-scope")?.addEventListener("change", updateExportPreviewCount);
  document.getElementById("export-status-filter")?.addEventListener("change", updateExportPreviewCount);

  // Column Select All / Reset
  document.getElementById("btn-export-select-all-cols")?.addEventListener("click", () => {
    document.querySelectorAll(".export-col-cb").forEach(cb => { cb.checked = true; });
  });

  document.getElementById("btn-export-reset-cols")?.addEventListener("click", () => {
    document.querySelectorAll(".export-col-cb").forEach(cb => {
      const def = PAYROLL_EXPORT_COLUMNS.find(c => c.key === cb.value)?.default;
      cb.checked = Boolean(def);
    });
  });

  // Modal Close & Cancel
  document.getElementById("btn-close-export-payroll-modal")?.addEventListener("click", closePayrollExportModal);
  document.getElementById("btn-cancel-export-modal")?.addEventListener("click", closePayrollExportModal);

  // Download Trigger Button (Guarded to prevent duplicate triggers)
  document.getElementById("btn-confirm-export-payroll")?.addEventListener("click", async () => {
    if (_isExporting) return;

    const list = getFilteredExportBeneficiaries();
    if (list.length === 0) {
      modals.warning("No Records", "No payroll records match the selected export filters.");
      return;
    }

    const selectedCols = Array.from(document.querySelectorAll(".export-col-cb:checked")).map(cb => cb.value);
    if (selectedCols.length === 0) {
      modals.warning("Select Columns", "Please select at least one column to export.");
      return;
    }

    const selectedFormat = document.querySelector(".export-format-radio:checked")?.value || "xlsx";
    const downloadBtn = document.getElementById("btn-confirm-export-payroll");
    const downloadLabel = document.getElementById("btn-confirm-export-label");

    _isExporting = true;
    if (downloadBtn) {
      downloadBtn.disabled = true;
      downloadBtn.classList.add("opacity-70", "cursor-wait");
      if (downloadLabel) downloadLabel.textContent = "Generating...";
    }

    try {
      if (selectedFormat === "xlsx") {
        await generateExcelPayrollReport(list, selectedCols);
        modals.flowbiteToast("Excel Generated", `Exported ${list.length} records to Excel spreadsheet.`, "success");
      } else {
        generateCsvPayrollReport(list, selectedCols);
        modals.flowbiteToast("CSV Generated", `Exported ${list.length} records to CSV data file.`, "success");
      }
      closePayrollExportModal();
    } catch (err) {
      if (import.meta.env.DEV) console.error("[SPES Payroll Export] Error:", err);
      modals.error("Export Failed", "Could not generate report file. Please try again.");
    } finally {
      _isExporting = false;
      if (downloadBtn) {
        downloadBtn.disabled = false;
        downloadBtn.classList.remove("opacity-70", "cursor-wait");
        if (downloadLabel) downloadLabel.textContent = "Download Report";
      }
    }
  });
}
// --- END: INITIALIZE PAYROLL EXPORT MODAL LISTENERS ---
