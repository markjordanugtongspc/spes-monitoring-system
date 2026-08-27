// --- START: BENEFICIARY CSV TOOL IMPORTS ---
import "../assets/styles/tailwind.css";
import { requireAdmin } from "../assets/js/rbac/guard.js";
import { buildImportPlan, executeImportPlan, loadConverterContext } from "./beneficiary-csv-converter.js";
import { bulkDeleteBeneficiaries, fetchBeneficiaryDuplicateGroups } from "../../backend/api/beneficiary.js";
// --- END: BENEFICIARY CSV TOOL IMPORTS ---

const session = requireAdmin();
const elements = {
  session: document.getElementById("converter-session"),
  batch: document.getElementById("bdf-batch-id"),
  batchOptions: document.getElementById("bdf-batch-options"),
  staff: document.getElementById("bdf-assign-staff"),
  staffButton: document.getElementById("bdf-assign-staff-button"),
  staffLabel: document.getElementById("bdf-assign-staff-label"),
  staffMenu: document.getElementById("bdf-assign-staff-menu"),
  staffSearch: document.getElementById("bdf-assign-staff-search"),
  staffOptions: document.getElementById("bdf-assign-staff-options"),
  file: document.getElementById("converter-file"),
  csv: document.getElementById("converter-csv"),
  analyze: document.getElementById("converter-analyze"),
  apply: document.getElementById("converter-apply"),
  clear: document.getElementById("converter-clear"),
  refresh: document.getElementById("converter-refresh"),
  includeAll: document.getElementById("converter-include-all"),
  excludeAll: document.getElementById("converter-exclude-all"),
  selectionSummary: document.getElementById("converter-selection-summary"),
  confirm: document.getElementById("converter-confirm"),
  message: document.getElementById("converter-message"),
  stats: document.getElementById("converter-stats"),
  tbody: document.getElementById("converter-preview-body"),
  progress: document.getElementById("converter-progress"),
  progressBar: document.getElementById("converter-progress-bar"),
  checkDuplicates: document.getElementById("converter-check-duplicates"),
  duplicates: document.getElementById("converter-duplicates"),
  duplicatesSummary: document.getElementById("converter-duplicates-summary"),
  duplicatesCount: document.getElementById("converter-duplicates-count"),
  duplicatesBody: document.getElementById("converter-duplicates-body"),
  deleteDuplicates: document.getElementById("converter-delete-duplicates"),
  selectAllDuplicates: document.getElementById("converter-select-all-duplicates"),
  scrollTop: document.getElementById("converter-scroll-top"),
};

const FIELD_LABELS = Object.freeze({
  full_name: "Full name",
  gender_id: "Gender",
  address: "Address",
  contact_number: "Contact number",
  month_period: "Employment month",
  year_period: "Employment year",
  designated: "GSIS Beneficiary",
  relationship: "Relationship",
  birthday: "Birthday",
  age: "Age",
  educ_id: "Education category",
  education_level_id: "Grade / year level",
  batch_id: "Batch",
  staff_id: "Implementor",
  return_status: "Beneficiary status",
});

const INSERT_FIELDS = Object.keys(FIELD_LABELS);
let context = null;
let currentPlan = null;
let applying = false;
const duplicateSelectedIds = new Set();
let duplicateGroups = [];

// --- START: HTML ESCAPING HELPER ---
function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}
// --- END: HTML ESCAPING HELPER ---

// --- START: UI BANNER MESSAGE SETTER ---
function setMessage(text, tone = "info") {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-200",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200",
    warning: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200",
    error: "border-red-200 bg-red-50 text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200",
  };
  elements.message.className = `rounded-none border px-4 py-3 text-sm font-semibold ${tones[tone]}`;
  elements.message.textContent = text;
  elements.message.classList.remove("hidden");
}
// --- END: UI BANNER MESSAGE SETTER ---

// --- START: ACTIONABLE ROW CHECKER ---
function isActionable(row) {
  return row.action === "insert" || row.action === "update";
}
// --- END: ACTIONABLE ROW CHECKER ---

// --- START: SELECTED ROW CHECKER ---
function isSelected(row) {
  if (!isActionable(row) || row.included === false) return false;
  if (row.action === "insert") {
    if (!row.fieldSelections) return true;
    return INSERT_FIELDS.some(field => row.fieldSelections[field] !== false);
  }
  return row.differences.some(difference => difference.included !== false);
}
// --- END: SELECTED ROW CHECKER ---

// --- START: SELECTION SUMMARY CALCULATOR ---
function getSelectionSummary(plan = currentPlan) {
  const actionable = plan?.rows.filter(isActionable) ?? [];
  const selected = actionable.filter(isSelected);
  return {
    actionable: actionable.length,
    selected: selected.length,
    excluded: actionable.length - selected.length,
    selectedFields: selected.reduce((total, row) => {
      if (row.action === "update") {
        return total + row.differences.filter(difference => difference.included !== false).length;
      }
      if (row.action === "insert") {
        if (!row.fieldSelections) return total + INSERT_FIELDS.length;
        return total + INSERT_FIELDS.filter(field => row.fieldSelections[field] !== false).length;
      }
      return total;
    }, 0),
  };
}
// --- END: SELECTION SUMMARY CALCULATOR ---

// --- START: BUSY STATE TOGGLER ---
function setBusy(busy) {
  elements.analyze.disabled = busy;
  elements.file.disabled = busy;
  elements.csv.disabled = busy;
  elements.batch.disabled = busy;
  elements.batchOptions?.querySelectorAll("button").forEach(button => { button.disabled = busy; });
  const isAdmin = String(session?.role || "").toLowerCase() === "admin";
  elements.staff.disabled = busy || !isAdmin;
  elements.staffButton.disabled = busy || !isAdmin;
  elements.staffSearch.disabled = busy || !isAdmin;
  elements.refresh.disabled = busy;
  const hasActions = Boolean(currentPlan) && getSelectionSummary().actionable > 0;
  elements.clear.disabled = busy;
  elements.includeAll.disabled = busy || !hasActions;
  elements.excludeAll.disabled = busy || !hasActions;
  elements.checkDuplicates.disabled = busy || !context;
  elements.deleteDuplicates.disabled = busy || !context || duplicateSelectedIds.size === 0 || String(session?.role || "").toLowerCase() !== "admin";
  elements.selectAllDuplicates.disabled = busy || !duplicateGroups.length;
  elements.analyze.classList.toggle("opacity-50", busy);
}
// --- END: BUSY STATE TOGGLER ---

// --- START: BATCH AND STAFF OPTIONS RENDERER ---
function renderOptions(preferred = {}) {
  const batchPalettes = [
    {
      idle: "border-sky-500 bg-transparent text-sky-700 hover:bg-sky-600 hover:text-white dark:border-sky-400 dark:bg-transparent dark:text-sky-300 dark:hover:bg-sky-500 dark:hover:text-white",
      active: "border-sky-600 bg-sky-600 !text-white shadow-md ring-2 ring-sky-600/30 dark:border-sky-500 dark:bg-sky-500 dark:!text-white dark:ring-sky-400/40",
    },
    {
      idle: "border-amber-500 bg-transparent text-amber-700 hover:bg-amber-500 hover:text-white dark:border-amber-400 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500 dark:hover:text-white",
      active: "border-amber-600 bg-amber-600 !text-white shadow-md ring-2 ring-amber-600/30 dark:border-amber-500 dark:bg-amber-500 dark:!text-white dark:ring-amber-400/40",
    },
    {
      idle: "border-emerald-500 bg-transparent text-emerald-700 hover:bg-emerald-600 hover:text-white dark:border-emerald-400 dark:bg-transparent dark:text-emerald-300 dark:hover:bg-emerald-500 dark:hover:text-white",
      active: "border-emerald-600 bg-emerald-600 !text-white shadow-md ring-2 ring-emerald-600/30 dark:border-emerald-500 dark:bg-emerald-500 dark:!text-white dark:ring-emerald-400/40",
    },
  ];
  const defaultBatch = context.batches.find(batch => Number(batch.id) === 2) ?? context.batches[0];
  const preferredBatchExists = preferred.batchId && context.batches.some(batch => String(batch.id) === String(preferred.batchId));
  elements.batch.value = preferredBatchExists ? String(preferred.batchId) : (defaultBatch ? String(defaultBatch.id) : "");
  elements.batchOptions.innerHTML = context.batches.map((batch, index) => {
    const label = batch.batch_name || `Batch ${batch.id}`;
    const palette = batchPalettes[index % batchPalettes.length];
    const isSelectedBatch = String(batch.id) === String(elements.batch.value);
    const classes = isSelectedBatch ? palette.active : palette.idle;
    return `<button type="button" data-batch-option value="${batch.id}" class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-none border-2 px-4 py-2.5 text-sm font-bold transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${classes}">${label}</button>`;
  }).join("");

  const activeStaff = context.implementors.filter(item => !item.archive_at);
  const preferredStaffExists = preferred.staffId && activeStaff.some(item => String(item.id) === String(preferred.staffId));
  const defaultStaff = activeStaff.find(item => String(item.id) === String(session?.id)) ?? activeStaff[0];
  const selectedStaff = preferredStaffExists
    ? activeStaff.find(item => String(item.id) === String(preferred.staffId))
    : defaultStaff;

  selectStaff(selectedStaff ? String(selectedStaff.id) : "");
  renderStaffOptions(activeStaff);

  const isAdmin = String(session?.role || "").toLowerCase() === "admin";
  elements.staffButton.disabled = !isAdmin;
  if (!isAdmin && selectedStaff) {
    elements.staffLabel.textContent = `${selectedStaff.full_name}${selectedStaff.office ? ` (${selectedStaff.office})` : ""}`;
  }
}
// --- END: BATCH AND STAFF OPTIONS RENDERER ---

// --- START: STAFF SELECTION HANDLER ---
function selectStaff(staffId) {
  const staff = context?.implementors.find(item => String(item.id) === String(staffId));
  elements.staff.value = staff ? String(staff.id) : "";
  elements.staffLabel.textContent = staff
    ? `${staff.full_name}${staff.office ? ` (${staff.office})` : ""}`
    : "Select implementor...";
  closeStaffMenu();
}
// --- END: STAFF SELECTION HANDLER ---

// --- START: STAFF MENU CLOSER ---
function closeStaffMenu() {
  elements.staffMenu.hidden = true;
  elements.staffButton.setAttribute("aria-expanded", "false");
  elements.staffSearch.value = "";
}
// --- END: STAFF MENU CLOSER ---

// --- START: STAFF OPTIONS DROPDOWN RENDERER ---
function renderStaffOptions(staffList = []) {
  const search = elements.staffSearch.value.trim().toLowerCase();
  const filtered = staffList.filter(item =>
    !search ||
    String(item.full_name || "").toLowerCase().includes(search) ||
    String(item.office || "").toLowerCase().includes(search) ||
    String(item.username || "").toLowerCase().includes(search)
  );

  if (!filtered.length) {
    elements.staffOptions.innerHTML = '<li class="px-3 py-4 text-center text-xs font-semibold text-slate-400 dark:text-white/40">No implementors match your search.</li>';
    return;
  }

  elements.staffOptions.innerHTML = filtered.map(item => {
    const isSelectedStaff = String(item.id) === String(elements.staff.value);
    return `
      <li data-staff-option="${item.id}" class="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-xs font-bold text-slate-800 hover:bg-slate-100 dark:text-white dark:hover:bg-white/10 ${isSelectedStaff ? "bg-blue-50 text-blue-700 dark:bg-blue-400/10 dark:text-yellow-300" : ""}">
        <span class="truncate">${escapeHtml(item.full_name || item.username)}</span>
        <span class="shrink-0 text-[10px] font-semibold text-slate-400 dark:text-white/40">${escapeHtml(item.office || "No office")}</span>
      </li>`;
  }).join("");
}
// --- END: STAFF OPTIONS DROPDOWN RENDERER ---

// --- START: DUPLICATE RECORD IDENTIFIERS RETRIEVER ---
function getDuplicateRecordIds() {
  const all = duplicateGroups.flatMap(group => group.records.map(record => String(record.id)));
  const incomplete = duplicateGroups.flatMap(group =>
    group.records.filter(record => isBeneficiaryIncomplete(record)).map(record => String(record.id))
  );
  return { all, incomplete };
}
// --- END: DUPLICATE RECORD IDENTIFIERS RETRIEVER ---

// --- START: DUPLICATE SELECTION CONTROLS UPDATER ---
function updateDuplicateSelectionControls() {
  const selectedCount = duplicateSelectedIds.size;
  const { all, incomplete } = getDuplicateRecordIds();
  const isAdmin = String(session?.role || "").toLowerCase() === "admin";
  elements.deleteDuplicates.disabled = applying || !isAdmin || selectedCount === 0;
  elements.deleteDuplicates.textContent = selectedCount ? `Delete (${selectedCount})` : "Delete selected";
  elements.selectAllDuplicates.disabled = applying || duplicateGroups.length === 0;

  if (all.length > 0 && all.every(id => duplicateSelectedIds.has(id))) {
    elements.selectAllDuplicates.textContent = "Deselect all";
    elements.selectAllDuplicates.setAttribute("aria-pressed", "true");
  } else if (incomplete.length > 0 && incomplete.every(id => duplicateSelectedIds.has(id))) {
    elements.selectAllDuplicates.textContent = "Select all duplicates";
    elements.selectAllDuplicates.setAttribute("aria-pressed", "true");
  } else if (incomplete.length > 0) {
    elements.selectAllDuplicates.textContent = `Select ${incomplete.length} incomplete`;
    elements.selectAllDuplicates.setAttribute("aria-pressed", "false");
  } else {
    elements.selectAllDuplicates.textContent = "Select all";
    elements.selectAllDuplicates.setAttribute("aria-pressed", "false");
  }
}
// --- END: DUPLICATE SELECTION CONTROLS UPDATER ---

// --- START: BENEFICIARY INCOMPLETENESS CHECKER ---
function isBeneficiaryIncomplete(record) {
  const missing = [];
  if (!record.birthday) missing.push("birthday");
  if (!record.contact_number) missing.push("contact");
  if (!record.address) missing.push("address");
  if (!record.gender_id) missing.push("gender");
  if (!record.educ_id) missing.push("education");
  if (!record.month_period || !record.year_period) missing.push("period");
  return missing;
}
// --- END: BENEFICIARY INCOMPLETENESS CHECKER ---

// --- START: DUPLICATE RECORD CARD RENDERER ---
function renderDuplicateRecordCard(record, isFirst = false) {
  const missing = isBeneficiaryIncomplete(record);
  const isChecked = duplicateSelectedIds.has(String(record.id));
  const directoryParams = new URLSearchParams({ batch: String(record.batch_id ?? "") });
  if (record.id) directoryParams.set("b", String(record.id));
  const reviewUrl = `../pages/beneficiaries/?${directoryParams}`;
  const batchLabel = record.batch_name || (record.batch_id ? `Batch ${record.batch_id}` : "No batch");
  const implementorLabel = record.staff_name || record.staff_username || (record.staff_id ? `Staff ${record.staff_id}` : "Unassigned");
  const educationLabel = [record.educ_name, record.education_level_name].filter(Boolean).join(" · ") || "No education recorded";
  const periodLabel = [record.month_period, record.year_period].filter(Boolean).join(" ") || "No period recorded";

  return `
    <article class="rounded-none border p-3 shadow-xs transition-colors dark:border-white/10 ${isChecked ? "border-red-300 bg-red-50/70 dark:border-red-400/30 dark:bg-red-400/10" : "border-slate-200 bg-white dark:bg-[#071326]"}">
      <div class="flex items-start justify-between gap-3">
        <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
          <input type="checkbox" data-duplicate-toggle data-duplicate-id="${record.id}" ${isChecked ? "checked" : ""} class="mt-0.5 size-4 cursor-pointer rounded-none border-slate-300 text-red-600 focus:ring-red-500" />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="text-xs font-black text-slate-900 dark:text-white">ID ${record.id}</span>
              <span class="rounded-none bg-slate-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600 dark:bg-white/10 dark:text-white/60">${escapeHtml(batchLabel)}</span>
              ${isFirst ? '<span class="rounded-none bg-blue-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-700 dark:bg-blue-400/20 dark:text-yellow-300">Earliest record</span>' : ""}
              ${missing.length ? `<span class="rounded-none bg-amber-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">Missing: ${missing.join(", ")}</span>` : '<span class="rounded-none bg-emerald-100 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-300">Complete</span>'}
            </div>
            <p class="mt-1 truncate text-xs font-semibold text-slate-600 dark:text-white/70">${escapeHtml(record.address || "No address recorded")}</p>
          </div>
        </label>
        <a href="${reviewUrl}" target="_blank" class="shrink-0 cursor-pointer text-[10px] font-black uppercase tracking-wider text-blue-700 hover:underline dark:text-yellow-300">Review</a>
      </div>
      <dl class="mt-2.5 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-500 sm:grid-cols-4 dark:border-white/5 dark:text-white/50">
        <div><dt class="font-bold">Contact</dt><dd class="truncate font-semibold text-slate-700 dark:text-white/80">${escapeHtml(record.contact_number || "N/A")}</dd></div>
        <div><dt class="font-bold">Birthday / Age</dt><dd class="truncate font-semibold text-slate-700 dark:text-white/80">${escapeHtml(record.birthday || "N/A")}${record.age ? ` (${record.age})` : ""}</dd></div>
        <div><dt class="font-bold">Education</dt><dd class="truncate font-semibold text-slate-700 dark:text-white/80">${escapeHtml(educationLabel)}</dd></div>
        <div><dt class="font-bold">Period</dt><dd class="truncate font-semibold text-slate-700 dark:text-white/80">${escapeHtml(periodLabel)}</dd></div>
      </dl>
    </article>`;
}
// --- END: DUPLICATE RECORD CARD RENDERER ---

// --- START: SYSTEM DUPLICATES GROUP RENDERER ---
function renderDuplicateGroups(groups) {
  elements.duplicatesCount.textContent = `${groups.length} group${groups.length === 1 ? "" : "s"}`;
  if (!groups.length) {
    elements.duplicatesSummary.textContent = "No duplicates were found in the current Supabase records.";
    elements.duplicatesBody.innerHTML = '<div class="col-span-full rounded-none border border-emerald-200 bg-emerald-50/70 p-6 text-center text-xs font-bold text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">No duplicate name records exist across batches in Supabase.</div>';
    return;
  }

  const totalDuplicates = groups.reduce((total, group) => total + group.records.length, 0);
  const incompleteCount = groups.reduce((total, group) =>
    total + group.records.filter(record => isBeneficiaryIncomplete(record).length > 0).length, 0
  );
  elements.duplicatesSummary.textContent = `Found ${groups.length} duplicate name group(s) covering ${totalDuplicates} beneficiary rows (${incompleteCount} incomplete).`;

  elements.duplicatesBody.innerHTML = `
    <div class="space-y-4">
      ${groups.map((group, groupIndex) => {
    const [primary, ...others] = group.records;
    const targetId = `duplicate-group-others-${groupIndex}`;
    const hasOthers = others.length > 0;
    return `
          <div class="rounded-none border border-violet-200 bg-white/90 p-4 shadow-sm dark:border-violet-400/20 dark:bg-[#0d1d35]">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 class="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-white">${escapeHtml(group.name)}</h3>
                <p class="text-[10px] font-semibold text-slate-400">${group.records.length} records in Supabase</p>
              </div>
              ${hasOthers ? `
                <button type="button" data-duplicate-record-expand data-duplicate-record-target="${targetId}" data-duplicate-record-count="${others.length}" aria-expanded="false" class="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-none border border-violet-200 px-2.5 py-1 text-[10px] font-bold text-violet-700 hover:bg-violet-50 dark:border-violet-400/20 dark:text-violet-300 dark:hover:bg-violet-400/10">
                  <span data-duplicate-record-expand-label>Show ${others.length} other duplicate${others.length === 1 ? "" : "s"}</span>
                  <svg data-duplicate-record-expand-icon class="size-3.5 transition-transform" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m19 9-7 7-7-7"/></svg>
                </button>` : ""}
            </div>
            <div class="mt-3 space-y-2">
              ${renderDuplicateRecordCard(primary, true)}
              ${hasOthers ? `
                <div id="${targetId}" hidden class="space-y-2 border-t border-dashed border-violet-200 pt-2 dark:border-violet-400/20">
                  ${others.map(record => renderDuplicateRecordCard(record, false)).join("")}
                </div>` : ""}
            </div>
          </div>`;
  }).join("")}
    </div>
    <div class="space-y-4">
      <div class="rounded-none border border-violet-200 bg-white/90 p-4 shadow-sm dark:border-violet-400/20 dark:bg-[#0d1d35]">
        <h4 class="text-xs font-black uppercase tracking-widest text-violet-900 dark:text-violet-100">Review guidelines</h4>
        <ul class="mt-3 list-disc space-y-2 pl-4 text-xs font-medium text-slate-600 dark:text-white/75">
          <li>Rows with <span class="font-bold text-amber-700 dark:text-amber-300">Missing fields</span> are safe candidates for cleanup if an earlier complete row exists.</li>
          <li>Review each record link before deleting to verify batch and contract history.</li>
          <li>Deleting is permanent and removes the beneficiary row directly from Supabase.</li>
        </ul>
      </div>
    </div>`;
}
// --- END: SYSTEM DUPLICATES GROUP RENDERER ---

// --- START: SYSTEM DUPLICATES SCAN TRIGGER ---
async function checkSystemDuplicates() {
  setBusy(true);
  elements.duplicates.classList.remove("hidden");
  elements.duplicatesSummary.textContent = "Scanning Supabase beneficiaries for duplicate records...";
  elements.duplicatesBody.innerHTML = '<div class="col-span-full py-12 text-center text-xs font-bold text-slate-400">Loading system records...</div>';
  try {
    const result = await fetchBeneficiaryDuplicateGroups({ includeArchived: true });
    duplicateGroups = result.data ?? [];
    duplicateSelectedIds.clear();
    renderDuplicateGroups(duplicateGroups);
    updateDuplicateSelectionControls();
  } catch (error) {
    console.error("[SPES CSV Converter] Duplicate check failed", error);
    elements.duplicatesSummary.textContent = error.message || "Failed to scan system duplicates.";
    elements.duplicatesBody.innerHTML = `<div class="col-span-full rounded-none border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-800 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-200">${escapeHtml(error.message || "Failed to scan system duplicates.")}</div>`;
  } finally {
    setBusy(false);
  }
}
// --- END: SYSTEM DUPLICATES SCAN TRIGGER ---

// --- START: SELECTED DUPLICATES REMOVER ---
async function deleteSelectedDuplicates() {
  const ids = [...duplicateSelectedIds].map(Number).filter(Number.isInteger);
  if (!ids.length) return;
  const confirmed = window.confirm(`Are you sure you want to permanently delete ${ids.length} selected beneficiary duplicate record(s) from Supabase?`);
  if (!confirmed) return;

  setBusy(true);
  setMessage(`Deleting ${ids.length} beneficiary record(s) from Supabase...`, "warning");
  try {
    const result = await bulkDeleteBeneficiaries(ids);
    if (!result.success) throw new Error(result.error || "Failed to delete records.");
    setMessage(`Successfully deleted ${ids.length} duplicate record(s) from Supabase.`, "success");
    await checkSystemDuplicates();
  } catch (error) {
    console.error("[SPES CSV Converter] Bulk delete failed", error);
    setMessage(error.message || "Failed to delete duplicate records.", "error");
  } finally {
    setBusy(false);
  }
}
// --- END: SELECTED DUPLICATES REMOVER ---

// --- START: LOOKUP NAME HELPER ---
function lookupName(items, id, fallback = "") {
  const match = items?.find(item => Number(item.id) === Number(id));
  return match?.name || match?.full_name || fallback;
}
// --- END: LOOKUP NAME HELPER ---

// --- START: VALUE FORMATTER ---
function formatValue(field, value) {
  if (value == null || value === "") return "N/A";
  if (field === "birthday") {
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return `${match[2]}/${match[3]}/${match[1]}`;
  }
  if (field === "gender_id") return lookupName(context?.genders, value, `Gender ID ${value}`);
  if (field === "educ_id") return lookupName(context?.education, value, `Education ID ${value}`);
  if (field === "education_level_id") return lookupName(context?.educationLevels, value, `Level ID ${value}`);
  if (field === "batch_id") {
    const batch = context?.batches.find(item => Number(item.id) === Number(value));
    return batch?.batch_name || (batch ? `Batch ${batch.id}` : `Batch ID ${value}`);
  }
  if (field === "staff_id") return lookupName(context?.implementors, value, `Staff ID ${value}`);
  return String(value);
}
// --- END: VALUE FORMATTER ---

// --- START: ACTION BADGE GENERATOR ---
function actionBadge(row) {
  const selected = isSelected(row);
  const action = isActionable(row) && !selected ? "excluded" : row.action;
  const classes = {
    insert: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    update: "bg-amber-100 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
    skip: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60",
    invalid: "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300",
    ambiguous: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    excluded: "bg-slate-200 text-slate-500 line-through dark:bg-white/10 dark:text-white/40",
  };
  return `<div class="flex flex-col items-start gap-1">
    <span class="inline-flex rounded-none px-2 py-1 text-[10px] font-black uppercase tracking-wider ${classes[action]}">${action}</span>
    ${row.warnings?.length ? `<span class="inline-flex rounded-none bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:bg-amber-400/15 dark:text-amber-300">${row.warnings.length} warning${row.warnings.length === 1 ? "" : "s"}</span>` : ""}
  </div>`;
}
// --- END: ACTION BADGE GENERATOR ---

// --- START: ROW WARNINGS RENDERER ---
function renderWarnings(row) {
  if (!row.warnings?.length) return "";
  return `
    <div class="mb-2 rounded-none border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
      <div class="text-[10px] font-black uppercase tracking-wider">Skipped CSV fields · review before proceeding</div>
      <ul class="mt-1.5 list-disc space-y-1 pl-4 text-[11px] font-semibold leading-4">
        ${row.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("")}
      </ul>
      <div class="mt-2 text-[10px] font-bold opacity-75">Skipped fields preserve existing Supabase values. For new records they remain N/A, except database defaults.</div>
    </div>`;
}
// --- END: ROW WARNINGS RENDERER ---

// --- START: BLOCKED DETAILS RENDERER ---
function renderBlockedDetails(row) {
  const blockedFields = [
    ["full_name", "Name"],
    ["birthday", "Birthday"],
    ["age", "Age"],
    ["gender_id", "Gender"],
    ["address", "Address"],
    ["designated", "GSIS Beneficiary"],
    ["relationship", "Relationship"],
    ["month_period", "Employment month"],
    ["year_period", "Employment year"],
    ["return_status", "Beneficiary status"],
  ];
  const candidateHtml = row.candidates?.length
    ? `
      <div class="mt-3 border-t border-violet-200 pt-3 dark:border-violet-400/20">
        <div class="text-[9px] font-black uppercase tracking-wider text-violet-700 dark:text-violet-200">Possible Supabase matches</div>
        <ul class="mt-1.5 space-y-1 text-[11px] font-semibold text-violet-900 dark:text-violet-100">
          ${row.candidates.map(candidate => `<li>ID ${candidate.id} · ${escapeHtml(candidate.full_name || "Unnamed")} · Batch ${escapeHtml(candidate.batch_id ?? "N/A")}</li>`).join("")}
        </ul>
      </div>`
    : "";

  return `
    ${renderWarnings(row)}
    <div class="rounded-none border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-400/20 dark:bg-red-400/10 dark:text-red-100">
      <div class="text-[10px] font-black uppercase tracking-wider">Blocked record · will not be written to Supabase</div>
      <p class="mt-1 text-xs font-semibold leading-5">${escapeHtml(row.reason)}</p>
      <div class="mt-3 grid gap-2 sm:grid-cols-2">
        ${blockedFields.map(([field, label]) => `
          <div class="rounded-none border border-red-200/70 bg-white/70 p-2 dark:border-red-400/20 dark:bg-white/5">
            <span class="block text-[9px] font-black uppercase tracking-wider text-red-700 dark:text-red-300">${label}</span>
            <span class="block truncate text-xs font-bold text-slate-800 dark:text-white">${escapeHtml(formatValue(field, row.payload[field]))}</span>
          </div>`).join("")}
      </div>
      ${candidateHtml}
    </div>`;
}
// --- END: BLOCKED DETAILS RENDERER ---

// --- START: DIFFERENCE DETAILS RENDERER ---
function renderDifferenceDetails(row, rowIndex) {
  if (row.action === "invalid" || row.action === "ambiguous") return renderBlockedDetails(row);

  if (row.action === "insert") {
    const isIncluded = isSelected(row);
    if (!row.fieldSelections) {
      row.fieldSelections = {};
      INSERT_FIELDS.forEach(field => { row.fieldSelections[field] = true; });
    }
    return `
      ${renderWarnings(row)}
      <div class="rounded-none border ${isIncluded ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-400/20 dark:bg-emerald-400/10" : "border-slate-200 bg-slate-50 opacity-60 dark:border-white/10 dark:bg-white/5"} p-3 transition">
        <label class="flex cursor-pointer items-center justify-between gap-2 border-b ${isIncluded ? "border-emerald-200/70 dark:border-emerald-400/20" : "border-slate-200 dark:border-white/10"} pb-2">
          <div class="flex items-center gap-2">
            <input type="checkbox" data-row-checkbox data-row-index="${rowIndex}" ${isIncluded ? "checked" : ""} class="size-4 cursor-pointer rounded-none border-emerald-400 text-emerald-600 focus:ring-emerald-500" />
            <span class="text-[10px] font-black uppercase tracking-wider ${isIncluded ? "text-emerald-800 dark:text-emerald-200" : "text-slate-500 dark:text-white/60"}">New Supabase record payload</span>
          </div>
          <span class="text-[10px] font-bold ${isIncluded ? "text-emerald-700 dark:text-emerald-300" : "text-slate-400"}">${isIncluded ? "Included" : "Excluded"}</span>
        </label>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">
          ${INSERT_FIELDS.map((field, fIdx) => {
      const fieldIncluded = isIncluded && row.fieldSelections[field] !== false;
      const isLeftCol = fIdx % 2 === 0;
      return `
              <div class="group/field relative flex items-start gap-2 rounded-none border ${fieldIncluded ? "border-emerald-200/90 bg-white dark:border-emerald-400/30 dark:bg-white/5" : "border-rose-300/60 bg-rose-50/40 opacity-75 dark:border-rose-500/20 dark:bg-rose-950/15"} p-2 transition">
                <input type="checkbox" data-insert-field-toggle data-row-index="${rowIndex}" data-field="${field}" ${fieldIncluded ? "checked" : ""} class="mt-0.5 size-3.5 cursor-pointer rounded-none border-emerald-400 text-emerald-600 focus:ring-emerald-500 shrink-0" />
                <label class="min-w-0 flex-1 cursor-pointer">
                  <div class="flex items-center justify-between gap-1">
                    <span class="block text-[9px] font-black uppercase tracking-wider text-slate-400">${FIELD_LABELS[field]}</span>
                    <span class="text-[8px] font-bold ${fieldIncluded ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}">${fieldIncluded ? "Included" : "Excluded"}</span>
                  </div>
                  <span class="block truncate text-xs font-bold text-slate-800 dark:text-white">${escapeHtml(formatValue(field, row.payload[field]))}</span>
                </label>
                ${!fieldIncluded ? `
                  <button type="button" data-field-bulk-toggle="${field}" data-field-action="exclude" data-action-type="insert" class="group/bulk absolute -top-2.5 ${isLeftCol ? "-left-1.5" : "-right-1.5"} z-20 inline-flex cursor-pointer items-center justify-center rounded-none border border-rose-600 bg-rose-600 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-white shadow-sm transition-all hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-400 active:scale-95">
                    Exclude All
                    <span class="pointer-events-none absolute bottom-full ${isLeftCol ? "left-0" : "right-0"} mb-1.5 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[0.625rem] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover/bulk:opacity-100 group-focus-visible/bulk:opacity-100 z-30 dark:bg-slate-800">
                      Exclude remaining same data across all records?
                      <span class="absolute ${isLeftCol ? "left-3" : "right-3"} top-full border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></span>
                    </span>
                  </button>
                ` : ""}
              </div>`;
    }).join("")}
        </div>
      </div>`;
  }

  if (row.action === "skip") {
    return `
      ${renderWarnings(row)}
      <div class="rounded-none border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-white/60">
        Existing record ID ${row.existingId} matches this CSV row completely. No changes are required.
      </div>`;
  }

  return `
    ${renderWarnings(row)}
    <div class="space-y-2">
      ${row.differences.map(difference => {
    const isIncluded = difference.included !== false;
    return `
          <div class="group/field relative flex items-start gap-3 rounded-none border p-2.5 transition dark:border-white/10 ${isIncluded ? "border-amber-200 bg-amber-50/60 dark:border-amber-400/20 dark:bg-amber-400/10" : "border-rose-300/60 bg-rose-50/40 opacity-75 dark:border-rose-500/20 dark:bg-rose-950/15"}">
            <input type="checkbox" data-difference-toggle data-row-index="${rowIndex}" data-field="${difference.field}" ${isIncluded ? "checked" : ""} class="mt-1 size-4 cursor-pointer rounded-none border-amber-400 text-amber-600 focus:ring-amber-500 shrink-0" />
            <label class="min-w-0 flex-1 cursor-pointer text-xs">
              <div class="flex items-center justify-between gap-2">
                <span class="font-black uppercase tracking-wider text-slate-700 dark:text-white">${FIELD_LABELS[difference.field] || difference.field}</span>
                <span class="text-[10px] font-bold ${isIncluded ? "text-amber-700 dark:text-amber-300" : "text-rose-600 dark:text-rose-400"}">${isIncluded ? "Included" : "Excluded"}</span>
              </div>
              <div class="mt-1 grid gap-2 sm:grid-cols-2">
                <div class="rounded-none bg-red-100/70 p-1.5 text-red-900 dark:bg-red-400/15 dark:text-red-200">
                  <span class="block text-[8px] font-black uppercase tracking-wider text-red-700 dark:text-red-300">Supabase</span>
                  <span class="block truncate font-bold">${escapeHtml(formatValue(difference.field, difference.current))}</span>
                </div>
                <div class="rounded-none bg-emerald-100/70 p-1.5 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200">
                  <span class="block text-[8px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">CSV Incoming</span>
                  <span class="block truncate font-bold">${escapeHtml(formatValue(difference.field, difference.incoming))}</span>
                </div>
              </div>
            </label>
            ${!isIncluded ? `
              <button type="button" data-field-bulk-toggle="${difference.field}" data-field-action="exclude" data-action-type="update" class="group/bulk absolute -top-2.5 right-2 z-20 inline-flex cursor-pointer items-center justify-center rounded-none border border-rose-600 bg-rose-600 px-2 py-0.5 text-[8px] font-black uppercase tracking-wider text-white shadow-sm transition-all hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-400 active:scale-95">
                Exclude All
                <span class="pointer-events-none absolute bottom-full right-0 mb-1.5 whitespace-nowrap rounded bg-slate-900 px-2 py-0.5 text-[0.625rem] font-bold text-white opacity-0 shadow-lg transition-opacity group-hover/bulk:opacity-100 group-focus-visible/bulk:opacity-100 z-30 dark:bg-slate-800">
                  Exclude remaining same data across all records?
                  <span class="absolute right-3 top-full border-4 border-transparent border-t-slate-900 dark:border-t-slate-800"></span>
                </span>
              </button>
            ` : ""}
          </div>`;
  }).join("")}
    </div>`;
}
// --- END: DIFFERENCE DETAILS RENDERER ---

// --- START: PLAN RENDERER ---
function renderPlan(plan, { resetConfirmation = true } = {}) {
  if (!plan) {
    elements.stats.innerHTML = "";
    elements.tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-12 text-center text-sm font-semibold text-slate-400">Paste CSV and click Analyze CSV.</td></tr>';
    elements.selectionSummary.textContent = "Analyze a CSV to choose which records and fields should be applied.";
    updateApplyState();
    return;
  }

  const selection = getSelectionSummary(plan);
  const stats = [
    ["Total CSV", plan.summary.total, "text-slate-900 dark:text-white"],
    ["Inserts", plan.summary.insert, "text-emerald-600 dark:text-emerald-300"],
    ["Updates", plan.summary.update, "text-amber-600 dark:text-amber-300"],
    ["No Change", plan.summary.skip, "text-slate-500 dark:text-white/60"],
    ["Warnings", plan.summary.warnings, "text-amber-600 dark:text-amber-300"],
    ["Blocked", plan.summary.invalid + plan.summary.ambiguous, "text-red-600 dark:text-red-300"],
    ["Selected", selection.selected, "text-blue-700 dark:text-yellow-300"],
  ];
  elements.stats.innerHTML = stats.map(([label, value, color]) => `
    <div class="rounded-none border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
      <div class="text-[10px] font-black uppercase tracking-widest text-slate-400">${label}</div>
      <div class="mt-1 text-2xl font-black ${color}">${value}</div>
    </div>`).join("");

  elements.selectionSummary.textContent = `${selection.selected} of ${selection.actionable} actionable records selected · ${selection.selectedFields} field values approved · ${selection.excluded} excluded`;
  elements.tbody.innerHTML = plan.rows.map((row, rowIndex) => {
    const selected = isSelected(row);
    const directoryParams = new URLSearchParams({ batch: String(plan.selection.batchId) });
    if (plan.selection.officeId) directoryParams.set("office", String(plan.selection.officeId));
    if (row.existingId) directoryParams.set("b", String(row.existingId));
    const reviewUrl = `../pages/beneficiaries/?${directoryParams}${row.existingId ? "" : "#add"}`;
    const toggleLabel = selected ? "Exclude" : "Include";
    const toggleClass = selected
      ? "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-400/10"
      : "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-400/20 dark:text-emerald-300 dark:hover:bg-emerald-400/10";
    return `
      <tr class="border-b border-slate-100 align-top transition-opacity dark:border-white/5 ${isActionable(row) && !selected ? "opacity-55" : ""}">
        <td class="px-3 py-3 text-xs font-bold text-slate-400">${row.sourceRow}</td>
        <td class="px-3 py-3">${actionBadge(row)}</td>
        <td class="px-3 py-3">
          <div class="text-xs font-black text-slate-900 dark:text-white">${escapeHtml(row.payload.full_name)}</div>
          <div class="mt-1 text-[10px] text-slate-400">${escapeHtml(row.matchedBy || "new record")}</div>
        </td>
        <td class="min-w-[30rem] px-3 py-3">${renderDifferenceDetails(row, rowIndex)}</td>
        <td class="px-3 py-3">
          <div class="flex min-w-24 flex-col items-start gap-2">
            ${isActionable(row) ? `<button type="button" data-row-toggle data-row-index="${rowIndex}" class="cursor-pointer rounded-none border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider ${toggleClass}">${toggleLabel}</button>` : ""}
            <a href="${reviewUrl}" target="_blank" class="text-[10px] font-black uppercase tracking-wider text-blue-700 hover:underline dark:text-yellow-300">${row.existingId ? "Review record" : "Open Add Drawer"}</a>
          </div>
        </td>
      </tr>`;
  }).join("");

  if (resetConfirmation) elements.confirm.checked = false;
  elements.clear.disabled = applying;
  elements.includeAll.disabled = selection.actionable === 0;
  elements.excludeAll.disabled = selection.actionable === 0;
  updateApplyState();
}
// --- END: PLAN RENDERER ---

// --- START: APPLY STATE UPDATER ---
function updateApplyState() {
  const selection = getSelectionSummary();
  const hasPlan = Boolean(currentPlan);
  const allowed = !applying && hasPlan && elements.confirm.checked && selection.selected > 0;
  elements.clear.disabled = applying;
  elements.includeAll.disabled = applying || !hasPlan || selection.actionable === 0;
  elements.excludeAll.disabled = applying || !hasPlan || selection.actionable === 0;
  elements.apply.disabled = !allowed;
  elements.apply.classList.toggle("opacity-50", !allowed);
  elements.apply.classList.toggle("cursor-not-allowed", !allowed);
}
// --- END: APPLY STATE UPDATER ---

// --- START: RESET APPROVAL AND RE-RENDER ---
function resetApprovalAndRender() {
  elements.confirm.checked = false;
  renderPlan(currentPlan, { resetConfirmation: false });
}
// --- END: RESET APPROVAL AND RE-RENDER ---

// --- START: WORKSPACE CLEARER ---
function clearWorkspace() {
  currentPlan = null;
  elements.csv.value = "";
  elements.file.value = "";
  elements.confirm.checked = false;
  elements.stats.innerHTML = "";
  elements.duplicates.classList.add("hidden");
  elements.duplicatesBody.innerHTML = "";
  duplicateSelectedIds.clear();
  duplicateGroups = [];
  updateDuplicateSelectionControls();
  elements.selectionSummary.textContent = "Analyze a CSV to choose which records and fields should be applied.";
  elements.tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-12 text-center text-sm font-semibold text-slate-400">CSV input and analysis cleared. Paste a new CSV when ready.</td></tr>';
  elements.progress.classList.add("hidden");
  elements.progressBar.style.width = "0%";
  elements.progress.setAttribute("aria-valuenow", "0");
  setMessage("CSV input and analysis cleared. No Supabase data was changed.", "info");
  setBusy(false);
  updateApplyState();
}
// --- END: WORKSPACE CLEARER ---

// --- START: SUPABASE RE-SYNC HANDLER ---
async function refreshFromSupabase() {
  if (applying) return;
  const preferred = { batchId: elements.batch.value, staffId: elements.staff.value };
  setBusy(true);
  elements.refresh.querySelector("svg")?.classList.add("animate-spin");
  setMessage("Refreshing batches, implementors, education references, and beneficiary records from Supabase...", "info");
  try {
    context = await loadConverterContext();
    renderOptions(preferred);
    if (elements.csv.value.trim()) {
      currentPlan = buildImportPlan(elements.csv.value, context, {
        batchId: elements.batch.value,
        staffId: elements.staff.value,
      });
      renderPlan(currentPlan);
      setMessage("Supabase data resynced and the CSV analysis was rebuilt with current records.", "success");
    } else {
      currentPlan = null;
      elements.stats.innerHTML = "";
      elements.duplicates.classList.add("hidden");
      elements.duplicatesBody.innerHTML = "";
      duplicateSelectedIds.clear();
      duplicateGroups = [];
      updateDuplicateSelectionControls();
      elements.selectionSummary.textContent = "Supabase references refreshed. Paste a CSV to begin analysis.";
      elements.tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-12 text-center text-sm font-semibold text-slate-400">Supabase references refreshed. Paste CSV and click Analyze CSV.</td></tr>';
      setMessage("Supabase reference data refreshed successfully.", "success");
    }
  } catch (error) {
    console.error("[SPES CSV Converter] Refresh failed", error);
    setMessage(error.message || "Could not refresh data from Supabase.", "error");
  } finally {
    elements.refresh.querySelector("svg")?.classList.remove("animate-spin");
    setBusy(false);
    updateApplyState();
  }
}
// --- END: SUPABASE RE-SYNC HANDLER ---

// --- START: CSV ANALYZE ACTION ---
async function analyze() {
  const csvText = elements.csv.value.trim();
  if (!csvText) {
    setMessage("Paste CSV text or choose a .csv file first.", "warning");
    return;
  }

  setBusy(true);
  setMessage("Analyzing CSV against the current Supabase beneficiary records…", "warning");
  try {
    const preferred = { batchId: elements.batch.value, staffId: elements.staff.value };
    context = await loadConverterContext();
    renderOptions(preferred);
    currentPlan = buildImportPlan(csvText, context, {
      batchId: elements.batch.value,
      staffId: elements.staff.value,
    });
    renderPlan(currentPlan);
    const mutations = currentPlan.summary.insert + currentPlan.summary.update;
    setMessage(
      `Review ready (read-only): ${mutations} actionable record(s), ${currentPlan.summary.skip} exact match(es), ` +
      `${currentPlan.summary.warnings} row(s) with skipped-field warnings, and ` +
      `${currentPlan.summary.invalid + currentPlan.summary.ambiguous} blocked row(s). Expand each row before approval.`,
      mutations ? "warning" : "success"
    );
  } catch (error) {
    console.error("[SPES CSV Converter] Analyze failed", error);
    currentPlan = null;
    setMessage(error.message || "CSV analysis failed.", "error");
  } finally {
    setBusy(false);
    updateApplyState();
  }
}
// --- END: CSV ANALYZE ACTION ---

// --- START: IMPORT PLAN APPLY ACTION ---
async function applyPlan() {
  if (!currentPlan || applying || getSelectionSummary().selected === 0) return;
  applying = true;
  setBusy(true);
  updateApplyState();
  elements.progress.classList.remove("hidden");
  elements.progressBar.style.width = "0%";
  const beforeApply = getSelectionSummary();
  setMessage(`Applying ${beforeApply.selected} approved record(s) through the beneficiary API…`, "warning");

  try {
    const result = await executeImportPlan(currentPlan, {
      onProgress({ completed, total, outcome }) {
        const percent = total ? Math.round((completed / total) * 100) : 100;
        elements.progressBar.style.width = `${percent}%`;
        elements.progress.setAttribute("aria-valuenow", String(percent));
        console.log("[SPES CSV Converter] Progress", { completed, total, outcome });
      },
    });
    setMessage(
      `Finished: ${result.summary.success} succeeded, ${result.summary.failed} failed, ${result.summary.excluded} excluded, and ${result.summary.skipped} exact match(es).`,
      result.summary.failed ? "error" : "success"
    );

    context = await loadConverterContext();
    currentPlan = buildImportPlan(elements.csv.value, context, {
      batchId: elements.batch.value,
      staffId: elements.staff.value,
    });
    renderPlan(currentPlan);
  } catch (error) {
    console.error("[SPES CSV Converter] Apply failed", error);
    setMessage(error.message || "Import failed.", "error");
  } finally {
    applying = false;
    setBusy(false);
    updateApplyState();
  }
}
// --- END: IMPORT PLAN APPLY ACTION ---

// --- START: DOM EVENT LISTENERS REGISTRATION ---
elements.tbody?.addEventListener("change", event => {
  const insertFieldToggle = event.target.closest("[data-insert-field-toggle]");
  if (insertFieldToggle && currentPlan && !applying) {
    const row = currentPlan.rows[Number(insertFieldToggle.dataset.rowIndex)];
    if (row && row.action === "insert") {
      if (!row.fieldSelections) {
        row.fieldSelections = {};
        INSERT_FIELDS.forEach(field => { row.fieldSelections[field] = true; });
      }
      row.fieldSelections[insertFieldToggle.dataset.field] = insertFieldToggle.checked;
      const anyFieldSelected = INSERT_FIELDS.some(field => row.fieldSelections[field] !== false);
      row.included = anyFieldSelected;
      console.log("[SPES CSV Converter] Insert field selection changed", {
        name: row.payload.full_name,
        field: insertFieldToggle.dataset.field,
        included: insertFieldToggle.checked,
        rowIncluded: row.included,
      });
      resetApprovalAndRender();
      return;
    }
  }

  const checkbox = event.target.closest("[data-row-checkbox]");
  if (checkbox && currentPlan && !applying) {
    const row = currentPlan.rows[Number(checkbox.dataset.rowIndex)];
    if (row && isActionable(row)) {
      row.included = checkbox.checked;
      if (row.action === "insert") {
        if (!row.fieldSelections) row.fieldSelections = {};
        INSERT_FIELDS.forEach(field => { row.fieldSelections[field] = checkbox.checked; });
      } else if (row.action === "update") {
        row.differences.forEach(difference => { difference.included = checkbox.checked; });
      }
      console.log("[SPES CSV Converter] Row checkbox changed", {
        name: row.payload.full_name,
        included: row.included,
      });
      resetApprovalAndRender();
      return;
    }
  }

  const input = event.target.closest("[data-difference-toggle]");
  if (!input || !currentPlan || applying) return;
  const row = currentPlan.rows[Number(input.dataset.rowIndex)];
  const difference = row?.differences.find(item => item.field === input.dataset.field);
  if (!difference) return;
  difference.included = input.checked;
  if (input.checked) row.included = true;
  console.log("[SPES CSV Converter] Field selection changed", {
    name: row.payload.full_name,
    field: difference.field,
    included: difference.included,
  });
  resetApprovalAndRender();
});

elements.tbody?.addEventListener("click", event => {
  const bulkFieldBtn = event.target.closest("[data-field-bulk-toggle]");
  if (bulkFieldBtn && currentPlan && !applying) {
    const field = bulkFieldBtn.dataset.fieldBulkToggle;
    const action = bulkFieldBtn.dataset.fieldAction; // "exclude" or "include"
    const targetState = action === "include";

    currentPlan.rows.forEach(row => {
      if (row.action === "insert") {
        if (!row.fieldSelections) {
          row.fieldSelections = {};
          INSERT_FIELDS.forEach(f => { row.fieldSelections[f] = true; });
        }
        row.fieldSelections[field] = targetState;
        const anyFieldSelected = INSERT_FIELDS.some(f => row.fieldSelections[f] !== false);
        row.included = anyFieldSelected;
      } else if (row.action === "update") {
        const diff = row.differences.find(d => d.field === field);
        if (diff) {
          diff.included = targetState;
          if (targetState) row.included = true;
        }
      }
    });

    console.log("[SPES CSV Converter] Bulk field toggle executed", {
      field,
      action,
      targetState,
    });
    resetApprovalAndRender();
    return;
  }

  const button = event.target.closest("[data-row-toggle]");
  if (!button || !currentPlan || applying) return;
  const row = currentPlan.rows[Number(button.dataset.rowIndex)];
  if (!row || !isActionable(row)) return;
  const shouldInclude = !isSelected(row);
  row.included = shouldInclude;
  if (row.action === "insert") {
    if (!row.fieldSelections) row.fieldSelections = {};
    INSERT_FIELDS.forEach(field => { row.fieldSelections[field] = shouldInclude; });
  } else if (row.action === "update") {
    row.differences.forEach(difference => { difference.included = shouldInclude; });
  }
  console.log("[SPES CSV Converter] Record selection changed", {
    name: row.payload.full_name,
    action: row.action,
    included: shouldInclude,
  });
  resetApprovalAndRender();
});

elements.includeAll?.addEventListener("click", () => {
  currentPlan?.rows.filter(isActionable).forEach(row => {
    row.included = true;
    if (row.action === "insert") {
      if (!row.fieldSelections) row.fieldSelections = {};
      INSERT_FIELDS.forEach(field => { row.fieldSelections[field] = true; });
    } else {
      row.differences.forEach(difference => { difference.included = true; });
    }
  });
  resetApprovalAndRender();
});

elements.excludeAll?.addEventListener("click", () => {
  currentPlan?.rows.filter(isActionable).forEach(row => {
    row.included = false;
    if (row.action === "insert") {
      if (!row.fieldSelections) row.fieldSelections = {};
      INSERT_FIELDS.forEach(field => { row.fieldSelections[field] = false; });
    } else {
      row.differences.forEach(difference => { difference.included = false; });
    }
  });
  resetApprovalAndRender();
});

elements.file?.addEventListener("change", async event => {
  const [file] = event.target.files ?? [];
  if (!file) return;
  elements.csv.value = await file.text();
  currentPlan = null;
  updateApplyState();
  setMessage(`Loaded ${file.name}. Click Analyze CSV to create a dry-run preview.`);
});

elements.csv?.addEventListener("input", () => { currentPlan = null; updateApplyState(); });
elements.batchOptions?.addEventListener("click", event => {
  const button = event.target.closest("[data-batch-option]");
  if (!button || applying) return;
  renderOptions({ batchId: button.value, staffId: elements.staff.value });
  currentPlan = null;
  updateApplyState();
});
elements.staffButton?.addEventListener("click", () => {
  if (elements.staffButton.disabled) return;
  const opening = elements.staffMenu.hidden;
  elements.staffMenu.hidden = !opening;
  elements.staffButton.setAttribute("aria-expanded", String(opening));
  if (opening) {
    elements.staffSearch.focus();
    renderStaffOptions(context?.implementors.filter(item => !item.archive_at) ?? []);
  }
});
elements.staffSearch?.addEventListener("input", () => renderStaffOptions(context?.implementors.filter(item => !item.archive_at) ?? []));
elements.staffOptions?.addEventListener("click", event => {
  const option = event.target.closest("[data-staff-option]");
  if (option && !applying) selectStaff(option.dataset.staffOption);
});
document.addEventListener("click", event => {
  if (!elements.staffMenu?.hidden && !event.target.closest("#bdf-assign-staff-button, #bdf-assign-staff-menu")) closeStaffMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !elements.staffMenu?.hidden) closeStaffMenu();
});
elements.confirm?.addEventListener("change", updateApplyState);
elements.analyze?.addEventListener("click", analyze);
elements.apply?.addEventListener("click", applyPlan);
elements.clear?.addEventListener("click", clearWorkspace);
elements.refresh?.addEventListener("click", refreshFromSupabase);
elements.checkDuplicates?.addEventListener("click", checkSystemDuplicates);
elements.duplicatesBody?.addEventListener("click", event => {
  const expand = event.target.closest("[data-duplicate-record-expand]");
  if (!expand) return;
  const target = document.getElementById(expand.dataset.duplicateRecordTarget);
  if (!target) return;
  const isOpening = target.hidden;
  target.hidden = !isOpening;
  expand.setAttribute("aria-expanded", String(isOpening));
  const label = expand.querySelector("[data-duplicate-record-expand-label]");
  const icon = expand.querySelector("[data-duplicate-record-expand-icon]");
  const remaining = Number(expand.dataset.duplicateRecordCount || 0);
  if (label) label.textContent = isOpening ? "Hide other duplicates" : "Show " + remaining + " other duplicate" + (remaining === 1 ? "" : "s");
  icon?.classList.toggle("rotate-180", isOpening);
});
elements.duplicatesBody?.addEventListener("change", event => {
  const input = event.target.closest("[data-duplicate-toggle]");
  if (!input) return;
  const id = String(input.dataset.duplicateId);
  if (input.checked) duplicateSelectedIds.add(id);
  else duplicateSelectedIds.delete(id);
  updateDuplicateSelectionControls();
});

elements.selectAllDuplicates?.addEventListener("click", () => {
  const { all, incomplete } = getDuplicateRecordIds();
  const allSelected = all.length > 0 && all.every(id => duplicateSelectedIds.has(id));
  const incompleteSelected = incomplete.length > 0 && incomplete.every(id => duplicateSelectedIds.has(id));
  if (allSelected) {
    duplicateSelectedIds.clear();
  } else if (incomplete.length && incompleteSelected) {
    all.forEach(id => duplicateSelectedIds.add(id));
  } else if (incomplete.length) {
    incomplete.forEach(id => duplicateSelectedIds.add(id));
  } else {
    all.forEach(id => duplicateSelectedIds.add(id));
  }
  elements.duplicatesBody.querySelectorAll("[data-duplicate-toggle]").forEach(input => {
    input.checked = duplicateSelectedIds.has(String(input.dataset.duplicateId));
  });
  updateDuplicateSelectionControls();
});
elements.deleteDuplicates?.addEventListener("click", deleteSelectedDuplicates);

function updateScrollTopControl() {
  elements.scrollTop?.classList.toggle("hidden", window.scrollY < 360);
}

elements.scrollTop?.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});
window.addEventListener("scroll", updateScrollTopControl, { passive: true });
updateScrollTopControl();
// --- END: DOM EVENT LISTENERS REGISTRATION ---

// --- START: PAGE INITIALIZATION ---
async function initialize() {
  if (!session) return;
  elements.session.textContent = `${session.full_name || session.username} (${session.role})`;
  setBusy(true);
  try {
    context = await loadConverterContext();
    renderOptions();
    setMessage("Ready. Batch 2 is preselected when available. Analyze is read-only; Apply remains a separate confirmation step.");
  } catch (error) {
    console.error("[SPES CSV Converter] Initialization failed", error);
    setMessage(error.message || "Could not load Supabase reference data.", "error");
  } finally {
    setBusy(false);
    updateApplyState();
  }
}

initialize();
// --- END: PAGE INITIALIZATION ---
