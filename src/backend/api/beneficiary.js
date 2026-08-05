import { supabase } from "./supabase.js";
import { getOfficeAccessScope } from "../../frontend/assets/js/rbac/scope.js";

const CACHE_KEY = "spes_beneficiaries_v6";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Batch cache ────────────────────────────────────────────────
const BATCH_CACHE_KEY = "spes_batches_v1";
const BATCH_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function _readBatchCache() {
  try {
    const raw = localStorage.getItem(BATCH_CACHE_KEY);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > BATCH_CACHE_TTL) { localStorage.removeItem(BATCH_CACHE_KEY); return null; }
    return data;
  } catch { return null; }
}

function _writeBatchCache(data) {
  try { localStorage.setItem(BATCH_CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateBatchCache() {
  try { localStorage.removeItem(BATCH_CACHE_KEY); } catch {}
}

export async function fetchBatches({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = _readBatchCache();
    if (cached) return { data: cached, fromCache: true };
  }

  const { data, error } = await supabase
    .from("batch")
    .select("*")
    .order("id", { ascending: true });

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] fetch error:", error.code, error.hint);
    return { data: [], error: "Unable to load batches." };
  }

  const records = data ?? [];
  _writeBatchCache(records);
  return { data: records };
}

export async function addBatch(payload = {}) {
  const batchName = typeof payload === "object" && payload !== null
    ? String(payload.batchName ?? "").trim()
    : "";
  const createdByCandidate = Number(payload?.created_by);
  const createdBy = Number.isInteger(createdByCandidate) && createdByCandidate > 0
    ? createdByCandidate
    : null;

  const insertData = {
    batch_name: batchName || null,
    created_by: createdBy,
  };

  const { data, error } = await supabase
    .from("batch")
    .insert([insertData])
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] insert error:", error.code, error.hint);
    return { success: false, error: "Failed to add batch. Please try again." };
  }

  invalidateBatchCache();
  return { success: true, data };
}

export async function updateBatch(id, payload = {}) {
  const updateData = {};
  if (payload.batchName !== undefined) updateData.batch_name = String(payload.batchName ?? "").trim() || null;

  if (Object.keys(updateData).length === 0) return { success: false, error: "No data to update." };

  const { data, error } = await supabase
    .from("batch")
    .update(updateData)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Batch] update error:", error.code, error.hint);
    return { success: false, error: "Failed to update batch. Please try again." };
  }

  invalidateBatchCache();
  return { success: true, data };
}
// -- Cache helpers ----------------------------------------------
function _readCache(cacheKey = CACHE_KEY) {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(cacheKey); return null; }
    return data;
  } catch { return null; }
}

function _writeCache(data, cacheKey = CACHE_KEY) {
  try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

export function invalidateBeneficiaryCache() {
  try {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(CACHE_KEY))
      .forEach((key) => localStorage.removeItem(key));
  } catch {}
}

function _getStoredSession() {
  try {
    return JSON.parse(localStorage.getItem("spes_session") || "{}");
  } catch {
    return {};
  }
}

async function _authorizeBeneficiaryMutation(beneficiaryId) {
  const session = _getStoredSession();
  const access = getOfficeAccessScope(session);
  if (access.isAdmin) return { allowed: true, session, access };
  if (session.approved !== true || access.ownOfficeId == null) {
    return { allowed: false, error: "Your account is not approved to manage beneficiaries." };
  }

  const { data, error } = await supabase
    .from("beneficiary")
    .select("id, staffs!staff_id!inner(office_id)")
    .eq("id", beneficiaryId)
    .maybeSingle();
  if (error || !data) {
    return { allowed: false, error: "The beneficiary record could not be verified." };
  }
  if (!access.canManageOffice(data.staffs?.office_id)) {
    return { allowed: false, error: "Other-office beneficiaries are read-only." };
  }
  return { allowed: true, session, access };
}

async function _authorizeBeneficiaryStaffTarget(staffId) {
  const session = _getStoredSession();
  const access = getOfficeAccessScope(session);
  if (access.isAdmin) return { allowed: true, session, access };
  if (session.approved !== true || access.ownOfficeId == null) {
    return { allowed: false, error: "Your account is not approved to manage beneficiaries." };
  }

  const targetStaffId = staffId ?? session.id;
  const { data, error } = await supabase
    .from("staffs")
    .select("id, office_id")
    .eq("id", targetStaffId)
    .is("archive_at", null)
    .maybeSingle();
  if (error || !data || !access.canManageOffice(data.office_id)) {
    return { allowed: false, error: "Beneficiaries may only be assigned within your own office." };
  }
  return { allowed: true, session, access, staffId: data.id };
}

// -- Read -------------------------------------------------------
/**
 * Fetch all active (non-archived) beneficiaries.
 * Results are cached for 5 minutes in localStorage.
 * NOTE: Requires `archived_at` column � run migration_beneficiary_archive.sql first.
 */
const ARCHIVE_COL_FLAG = "spes_bene_no_archive_col";

function _archiveColMissing() {
  return sessionStorage.getItem(ARCHIVE_COL_FLAG) === "1";
}

// PostgREST commonly limits a single response to 1,000 rows. Keep the UI's
// global Admin roster complete by walking deterministic pages until exhausted.
const BENEFICIARY_PAGE_SIZE = 1000;

async function _fetchBeneficiaryPages(selectStr, officeId, canViewOtherOffices) {
  const records = [];

  for (let page = 0; ; page += 1) {
    let query = supabase
      .from("beneficiary")
      .select(selectStr)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(page * BENEFICIARY_PAGE_SIZE, ((page + 1) * BENEFICIARY_PAGE_SIZE) - 1);

    if (!canViewOtherOffices && officeId) {
      query = query.eq("staffs.office_id", officeId);
    }

    const result = await query;
    if (result.error) return result;

    const pageData = Array.isArray(result.data) ? result.data : [];
    records.push(...pageData);
    if (pageData.length < BENEFICIARY_PAGE_SIZE) break;
  }

  return { data: records, error: null };
}
export async function fetchBeneficiaries({ forceRefresh = false } = {}) {
  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const access = getOfficeAccessScope(session);
  const officeId = session.office_id;
  const cacheKey = `${CACHE_KEY}:${access.canViewOtherOffices ? "global" : `office-${officeId ?? "none"}`}`;

  if (!forceRefresh) {
    const cached = _readCache(cacheKey);
    if (cached) return { data: cached, fromCache: true };
  }

  const isAdmin = access.isAdmin;
  const isApproved = session.approved === true;

  // Block unapproved staff
  if (!isAdmin && !isApproved) {
    return { data: [], error: "Account Not Approved. List is hidden." };
  }

  let selectStr = "*, batch:batch_id(id, batch_name), education:education!beneficiary_educ_id_fkey(id, name), education_level:education_levels!beneficiary_education_level_id_fkey(id, name), gender:gender_id(id, name)";
  if (!access.canViewOtherOffices && officeId) {
    selectStr += ", staffs!staff_id!inner(office_id, full_name)";
  } else {
    // Cross-office readers need office metadata for local read-only filtering.
    selectStr += ", staffs!staff_id(office_id, full_name)";
  }

  let result = await _fetchBeneficiaryPages(
    selectStr,
    officeId,
    access.canViewOtherOffices
  );

  // Preserve schema compatibility if a deployment reports a missing column.
  if (result.error?.code === "42703") {
    sessionStorage.setItem(ARCHIVE_COL_FLAG, "1");
    result = await _fetchBeneficiaryPages(
      selectStr,
      officeId,
      access.canViewOtherOffices
    );
  }
  // Derive return_status client-side as a fallback if the DB column is missing/null.
  // SPES BABY = same full_name appears in an earlier year_period (returnee); else NEW.
  if (!result.error && Array.isArray(result.data)) {
    processBeneficiaryReturnStatus(result.data);
  }

  if (result.error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] fetch error:", result.error.code, result.error.hint);
    return { data: [], error: "Unable to load beneficiaries. Please try again." };
  }

  const records = result.data ?? [];
  _writeCache(records, cacheKey);
  return { data: records };
}

// ── Create ─────────────────────────────────────────────────────
/**
 * Fetch the latest beneficiaries for dashboard snapshots.
 * This always queries Supabase directly so the dashboard does not reuse a stale full-list cache.
 */

// --- START: SYSTEM BENEFICIARY DUPLICATE API ---
function _normalizeDuplicateBeneficiaryName(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[^\x00-\x7F]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the caller's authorized beneficiary records and groups exact normalized
 * full-name duplicates. This is diagnostic only and does not mutate data.
 */
export async function fetchBeneficiaryDuplicateGroups({ forceRefresh = true, includeArchived = true } = {}) {
  const result = await fetchBeneficiaries({ forceRefresh });
  if (result.error) return { data: [], error: result.error };

  const groups = new Map();
  (result.data ?? []).forEach(record => {
    if (!includeArchived && record.archived_at) return;
    const key = _normalizeDuplicateBeneficiaryName(record.full_name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });

  const data = [...groups.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => ({
      key,
      name: String(records[0]?.full_name ?? "").trim().toUpperCase(),
      records: [...records].sort((a, b) => Number(a.id) - Number(b.id)),
    }))
    .sort((a, b) => b.records.length - a.records.length || a.name.localeCompare(b.name));

  return { data, scanned: result.data?.length ?? 0 };
}
// --- END: SYSTEM BENEFICIARY DUPLICATE API ---
export async function fetchRecentBeneficiaries({ limit = 4 } = {}) {
  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const isAdmin = String(session.role || "").toLowerCase() === "admin";
  const officeId = session.office_id;
  const isApproved = isAdmin || String(session.approved).toLowerCase() === "true";
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(limit, 10) || 4));

  if (!isApproved) {
    return { data: [], error: "Account Not Approved. List is hidden." };
  }
  if (!isAdmin && !officeId) {
    return { data: [], error: "No office is assigned to this account." };
  }

  let selectStr = "id, full_name, address, month_period, year_period, contact_number, created_at";
  if (!isAdmin) selectStr += ", staffs!staff_id!inner(office_id)";

  let query = supabase
    .from("beneficiary")
    .select(selectStr);

  if (!isAdmin) query = query.eq("staffs.office_id", officeId);
  query = query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(safeLimit);

  const { data, error } = await query;
  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] recent fetch error:", error.code, error.hint);
    return { data: [], error: "Unable to load recent beneficiaries." };
  }

  return { data: data ?? [] };
}
export async function addBeneficiary(payload) {
  const clean = _sanitize(payload);
  const authorization = await _authorizeBeneficiaryStaffTarget(clean.staff_id);
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }
  if (!authorization.access.isAdmin && clean.staff_id == null) {
    clean.staff_id = authorization.staffId;
  }

  // If staff_id was not explicitly provided, try to assign it based on session (for Officers)
  if (clean.staff_id === undefined) {
    try {
      const raw = localStorage.getItem("spes_session");
      if (raw) {
        const session = JSON.parse(raw);
        // Admin doesn't auto-assign their own ID to beneficiaries
        if (session.role !== "admin") {
          clean.staff_id = session.id;
        }
      }
    } catch {}
  }

  if (!clean.full_name) return { success: false, error: "Name of Assured is required." };

  const { data, error } = await supabase
    .from("beneficiary")
    .insert([clean])
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] insert error:", error.code, error.hint);
    return { success: false, error: "Failed to add beneficiary. Please check your input and try again." };
  }

  invalidateBeneficiaryCache();
  return { success: true, data };
}

// ── Update ─────────────────────────────────────────────────────
export async function updateBeneficiary(id, payload) {
  const authorization = await _authorizeBeneficiaryMutation(id);
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }
  const clean = _sanitize(payload);
  if (!authorization.access.isAdmin) {
    if (clean.staff_id == null) {
      delete clean.staff_id;
    } else {
      const targetAuthorization = await _authorizeBeneficiaryStaffTarget(clean.staff_id);
      if (!targetAuthorization.allowed) {
        return { success: false, error: targetAuthorization.error };
      }
    }
  }

  if (!clean.full_name) return { success: false, error: "Name of Assured is required." };

  const { data, error } = await supabase
    .from("beneficiary")
    .update({ ...clean, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] update error:", error.code, error.hint);
    return { success: false, error: "Failed to update beneficiary. Please try again." };
  }

  invalidateBeneficiaryCache();
  return { success: true, data };
}

// --- START: BENEFICIARY BULK TRANSFER API ---
/**
 * Returns safe, minimal transfer destinations. A beneficiary is assigned to a
 * staff record, so offices and branches are resolved through that staff member.
 */
export async function fetchBeneficiaryTransferDestinations() {
  const session = _getStoredSession();
  const access = getOfficeAccessScope(session);
  let query = supabase
    .from("staffs")
    .select("id, full_name, office_id, offices!office_id(id, name, location)")
    .is("archive_at", null)
    .neq("role_id", 1)
    .order("full_name", { ascending: true });
  if (!access.isAdmin && access.ownOfficeId != null) {
    query = query.eq("office_id", access.ownOfficeId);
  }
  const { data, error } = await query;

  if (error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Beneficiary] transfer destinations error:", error.code, error.hint);
    }
    return { data: [], error: "Unable to load transfer destinations." };
  }

  const destinations = (data ?? [])
    .filter((staff) => staff.office_id && staff.offices)
    .map((staff) => ({
      staff_id: staff.id,
      staff_name: staff.full_name,
      office_id: staff.office_id,
      office_name: staff.offices?.name || "Unnamed Office",
      branch_name: staff.offices?.location || "Unspecified Branch",
    }));

  return { data: destinations };
}

/**
 * Returns the available beneficiary batches for bulk assignment.
 */
export async function fetchBeneficiaryBatchDestinations() {
  const { data, error } = await supabase
    .from("batch")
    .select("id, batch_name")
    .order("id", { ascending: true });

  if (error) {
    if (import.meta.env.DEV) {
      console.error("[SPES Beneficiary] batch destinations error:", error.code, error.hint);
    }
    return { data: [], error: "Unable to load available batches." };
  }

  return {
    data: (data ?? []).map((batch) => ({
      id: batch.id,
      batch_name: batch.batch_name,
    })),
  };
}

/**
 * Bulk-transfers selected beneficiaries to another return status, office, or
 * batch. Non-admin users may mutate only rows from their assigned office.
 */
export async function bulkTransferBeneficiaries(ids, {
  returnStatus = undefined,
  destinationStaffId = undefined,
  destinationBatchId = undefined,
} = {}) {
  const safeIds = _normalizeBulkBeneficiaryIds(ids);

  if (!safeIds.length) {
    return { success: false, error: "Select at least one beneficiary." };
  }

  let session = {};
  try {
    session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  } catch {}

  const isAdmin = String(session.role || "").toLowerCase() === "admin";
  if (!isAdmin && session.approved !== true) {
    return { success: false, error: "Your account is not approved for beneficiary transfers." };
  }
  if (!isAdmin && !session.office_id) {
    return { success: false, error: "Your account has no assigned office." };
  }

  let authorizedCount = 0;
  for (const idChunk of _chunkIds(safeIds)) {
    let sourceQuery = supabase
      .from("beneficiary")
      .select(isAdmin ? "id, staff_id" : "id, staff_id, staffs!staff_id!inner(office_id)")
      .in("id", idChunk);
    if (!isAdmin) sourceQuery = sourceQuery.eq("staffs.office_id", session.office_id);

    const { data: authorizedRows, error: sourceError } = await sourceQuery;
    if (sourceError) {
      if (import.meta.env.DEV) {
        console.error("[SPES Beneficiary] transfer authorization error:", sourceError.code, sourceError.hint);
      }
      return { success: false, error: "Could not verify the selected beneficiaries." };
    }
    authorizedCount += (authorizedRows ?? []).length;
  }
  if (authorizedCount !== safeIds.length) {
    return { success: false, error: "One or more selected beneficiaries are outside your authorized office." };
  }

  const updates = { updated_at: new Date().toISOString() };
  if (returnStatus !== undefined) {
    const normalizedStatus = String(returnStatus).trim().toUpperCase();
    if (!["NEW", "SPES BABY"].includes(normalizedStatus)) {
      return { success: false, error: "Invalid beneficiary transfer status." };
    }
    updates.return_status = normalizedStatus;
  }

  if (destinationStaffId !== undefined) {
    const safeDestinationId = Number.parseInt(destinationStaffId, 10);
    if (!Number.isInteger(safeDestinationId) || safeDestinationId < 1) {
      return { success: false, error: "Invalid transfer destination." };
    }

    const { data: destination, error: destinationError } = await supabase
      .from("staffs")
      .select("id, office_id")
      .eq("id", safeDestinationId)
      .is("archive_at", null)
      .neq("role_id", 1)
      .maybeSingle();

    if (destinationError || !destination?.office_id) {
      return { success: false, error: "The selected destination is unavailable." };
    }
    if (!isAdmin && String(destination.office_id) !== String(session.office_id)) {
      return { success: false, error: "Other-office transfer destinations are read-only." };
    }

    updates.staff_id = destination.id;
    // Batches belong to the previous staff/office context and must not leak
    // across destinations.
    updates.batch_id = null;
  }

  if (destinationBatchId !== undefined) {
    const safeBatchId = Number.parseInt(destinationBatchId, 10);
    if (!Number.isInteger(safeBatchId) || safeBatchId < 1) {
      return { success: false, error: "Invalid batch destination." };
    }

    const { data: destinationBatch, error: destinationBatchError } = await supabase
      .from("batch")
      .select("id")
      .eq("id", safeBatchId)
      .maybeSingle();

    if (destinationBatchError || !destinationBatch) {
      return { success: false, error: "The selected batch is unavailable." };
    }
    updates.batch_id = destinationBatch.id;
  }

  if (updates.return_status === undefined && updates.staff_id === undefined && updates.batch_id === undefined) {
    return { success: false, error: "Choose a status, office, or batch destination." };
  }

  const updatedRows = [];
  for (const idChunk of _chunkIds(safeIds)) {
    const { data, error: updateError } = await supabase
      .from("beneficiary")
      .update(updates)
      .in("id", idChunk)
      .select("id");

    if (updateError) {
      if (import.meta.env.DEV) {
        console.error("[SPES Beneficiary] bulk transfer error:", updateError.code, updateError.hint);
      }
      return { success: false, error: "The beneficiary transfer could not be completed." };
    }
    updatedRows.push(...(data ?? []));
  }
  if ((updatedRows ?? []).length !== safeIds.length) {
    return { success: false, error: "Some selected beneficiaries were not transferred." };
  }

  invalidateBeneficiaryCache();
  return { success: true, data: updatedRows, transferred: updatedRows.length };
}
// --- END: BENEFICIARY BULK TRANSFER API ---

function _normalizeBulkBeneficiaryIds(ids) {
  return [...new Set(
    (Array.isArray(ids) ? ids : [])
      .map((id) => Number.parseInt(id, 10))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];
}

function _chunkIds(ids, chunkSize = 400) {
  const chunks = [];
  for (let index = 0; index < ids.length; index += chunkSize) {
    chunks.push(ids.slice(index, index + chunkSize));
  }
  return chunks;
}

async function _authorizeBulkBeneficiaryMutation(ids, { requireAdmin = false, onlyActive = true, onlyArchived = false } = {}) {
  const session = _getStoredSession();
  const access = getOfficeAccessScope(session);
  if (requireAdmin && !access.isAdmin) {
    return { allowed: false, error: "Only administrators can permanently delete beneficiaries." };
  }
  if (!access.isAdmin && (session.approved !== true || access.ownOfficeId == null)) {
    return { allowed: false, error: "Your account is not approved to manage beneficiaries." };
  }

  for (const idChunk of _chunkIds(ids)) {
    let query = supabase
      .from("beneficiary")
      .select(access.isAdmin ? "id" : "id, staffs!staff_id!inner(office_id)")
      .in("id", idChunk);
    if (onlyActive) query = query.is("archived_at", null);
    if (!access.isAdmin) query = query.eq("staffs.office_id", access.ownOfficeId);

    const { data, error } = await query;
    if (error) {
      const message = error.code === "42703"
        ? "Archive is not available yet. Please run the database migration first."
        : "Could not verify the selected beneficiaries.";
      return { allowed: false, error: message };
    }
    if ((data ?? []).length !== idChunk.length) {
      return { allowed: false, error: "One or more selected beneficiaries are outside your authorized active roster." };
    }
  }

  return { allowed: true, session, access };
}

// --- START: BENEFICIARY BULK ARCHIVE API ---
/**
 * Soft-archives every selected active beneficiary after verifying each record
 * is within the caller's allowed office scope.
 */
export async function bulkArchiveBeneficiaries(ids) {
  const safeIds = _normalizeBulkBeneficiaryIds(ids);
  if (!safeIds.length) return { success: false, error: "Select at least one beneficiary." };

  const authorization = await _authorizeBulkBeneficiaryMutation(safeIds);
  if (!authorization.allowed) return { success: false, error: authorization.error };

  let archived = 0;
  for (const idChunk of _chunkIds(safeIds)) {
    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from("beneficiary")
      .update({ archived_at: timestamp, updated_at: timestamp })
      .in("id", idChunk)
      .is("archived_at", null)
      .select("id");

    if (error || (data ?? []).length !== idChunk.length) {
      if (import.meta.env.DEV) console.error("[SPES Beneficiary] bulk archive error:", error?.code, error?.hint);
      return { success: false, error: "Some selected beneficiaries could not be archived." };
    }
    archived += data.length;
  }

  invalidateBeneficiaryCache();
  return { success: true, archived };
}
// --- END: BENEFICIARY BULK ARCHIVE API ---
// --- START: BENEFICIARY BULK RESTORE API ---
/** Restores selected archived beneficiaries by clearing archived_at. */
export async function bulkRestoreBeneficiaries(ids) {
  const safeIds = _normalizeBulkBeneficiaryIds(ids);
  if (!safeIds.length) return { success: false, error: "Select at least one beneficiary." };

  const authorization = await _authorizeBulkBeneficiaryMutation(safeIds, { onlyActive: false, onlyArchived: true });
  if (!authorization.allowed) return { success: false, error: authorization.error };

  let restored = 0;
  for (const idChunk of _chunkIds(safeIds)) {
    const timestamp = new Date().toISOString();
    const { data, error } = await supabase
      .from("beneficiary")
      .update({ archived_at: null, updated_at: timestamp })
      .in("id", idChunk)
      .not("archived_at", "is", null)
      .select("id");

    if (error || (data ?? []).length !== idChunk.length) {
      if (import.meta.env.DEV) console.error("[SPES Beneficiary] bulk restore error:", error?.code, error?.hint);
      return { success: false, error: "Some selected beneficiaries could not be restored." };
    }
    restored += data.length;
  }

  invalidateBeneficiaryCache();
  return { success: true, restored };
}
// --- END: BENEFICIARY BULK RESTORE API ---

// --- START: BENEFICIARY BULK PERMANENT DELETE API ---
/**
 * Permanently removes selected active beneficiaries. This is intentionally
 * restricted to administrators and cannot be undone.
 */
export async function bulkDeleteBeneficiaries(ids) {
  const safeIds = _normalizeBulkBeneficiaryIds(ids);
  if (!safeIds.length) return { success: false, error: "Select at least one beneficiary." };

  const authorization = await _authorizeBulkBeneficiaryMutation(safeIds, { requireAdmin: true, onlyActive: false });
  if (!authorization.allowed) return { success: false, error: authorization.error };

  let deleted = 0;
  for (const idChunk of _chunkIds(safeIds)) {
    const { data, error } = await supabase
      .from("beneficiary")
      .delete()
      .in("id", idChunk)
      .select("id");

    if (error || (data ?? []).length !== idChunk.length) {
      if (import.meta.env.DEV) console.error("[SPES Beneficiary] bulk delete error:", error?.code, error?.hint);
      return { success: false, error: "Some selected beneficiaries could not be permanently deleted." };
    }
    deleted += data.length;
  }

  invalidateBeneficiaryCache();
  return { success: true, deleted };
}
// --- END: BENEFICIARY BULK PERMANENT DELETE API ---

// ── Archive (soft delete) ──────────────────────────────────────
/**
 * Soft-deletes a beneficiary by setting archived_at.
 * Requires the archived_at column added by migration_beneficiary_archive.sql.
 */
export async function archiveBeneficiary(id) {
  const authorization = await _authorizeBeneficiaryMutation(id);
  if (!authorization.allowed) {
    return { success: false, error: authorization.error };
  }
  const { error } = await supabase
    .from("beneficiary")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] archive error:", error.code, error.hint);
    const msg = error.code === "42703"
      ? "Archive is not available yet. Please run the database migration first."
      : "Failed to archive beneficiary. Please try again.";
    return { success: false, error: msg };
  }

  invalidateBeneficiaryCache();
  return { success: true };
}

// ── Education Levels Helper ────────────────────────────────────

// --- START: BENEFICIARY RESTORE API ---
/** Restores one archived beneficiary by clearing archived_at. */
export async function restoreBeneficiary(id) {
  const authorization = await _authorizeBeneficiaryMutation(id);
  if (!authorization.allowed) return { success: false, error: authorization.error };

  const { error } = await supabase
    .from("beneficiary")
    .update({ archived_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .not("archived_at", "is", null);

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES Beneficiary] restore error:", error.code, error.hint);
    const msg = error.code === "42703"
      ? "Archive is not available yet. Please run the database migration first."
      : "Failed to restore beneficiary. Please try again.";
    return { success: false, error: msg };
  }

  invalidateBeneficiaryCache();
  return { success: true };
}
// --- END: BENEFICIARY RESTORE API ---
const EDU_LEVEL_CACHE_KEY = "spes_edu_levels_v1";

export async function fetchEducationLevels({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const raw = localStorage.getItem(EDU_LEVEL_CACHE_KEY);
      if (raw) return { data: JSON.parse(raw) };
    } catch {}
  }
  const { data, error } = await supabase
    .from("education_levels")
    .select("*")
    .order("education_id", { ascending: true })
    .order("sort_order", { ascending: true });

  if (error) {
    if (import.meta.env.DEV) console.error("[SPES EduLevel] fetch error:", error);
    return { data: [] };
  }

  const records = data ?? [];
  try { localStorage.setItem(EDU_LEVEL_CACHE_KEY, JSON.stringify(records)); } catch {}
  return { data: records };
}

// ── Input sanitiser ────────────────────────────────────────────
function _sanitize(p) {
  const str = (v) => String(v ?? "").trim() || null;
  
  let currentStaffId = null;
  try {
    const raw = localStorage.getItem("spes_session");
    if (raw) currentStaffId = JSON.parse(raw).id;
  } catch {}

  const sanitizeEdu = p.educ_id !== undefined ? p.educ_id : p.education_id;
  const sanitizeEduLevel = p.education_level_id !== undefined ? p.education_level_id : (p.edulevel_id !== undefined ? p.edulevel_id : p.edulevel);

  const result = {
    full_name:          String(p.full_name ?? "").trim(),
    address:            str(p.address),
    month_period:       str(p.month_period)?.toUpperCase() ?? null,
    year_period:        str(p.year_period),
    gender_id:          p.gender_id !== "" && p.gender_id != null ? parseInt(p.gender_id, 10) : null,
    designated:         str(p.designated),
    relationship:       str(p.relationship)?.toUpperCase() ?? null,
    contact_number:     str(p.contact_number),
    birthday:           p.birthday || null,
    age:                p.age !== "" && p.age != null ? parseInt(p.age, 10) : null,
    educ_id:            sanitizeEdu !== "" && sanitizeEdu != null ? parseInt(sanitizeEdu, 10) : null,
    education_level_id: sanitizeEduLevel !== "" && sanitizeEduLevel != null && !isNaN(parseInt(sanitizeEduLevel, 10)) ? parseInt(sanitizeEduLevel, 10) : null,
    batch_id:           p.batch_id !== "" && p.batch_id != null ? parseInt(p.batch_id, 10) : null,
  };

  if (p.return_status !== undefined && p.return_status !== null && String(p.return_status).trim() !== "") {
    result.return_status = String(p.return_status).trim().toUpperCase();
  }

  // If a staff_id is explicitly provided (e.g., Admin adding to a specific implementor)
  if (p.staff_id !== undefined) {
    result.staff_id = p.staff_id;
  }

  return result;
}

// ── Standalone helper for return status ──────────────────────────
export function processBeneficiaryReturnStatus(data) {
  if (!Array.isArray(data)) return data;
  const firstYearByName = {};
  data.forEach(b => {
    const key = String(b.full_name ?? "").trim().toLowerCase();
    const yr  = b.year_period != null ? Number(b.year_period) : null;
    if (!key || yr == null) return;
    if (firstYearByName[key] == null || yr < firstYearByName[key]) firstYearByName[key] = yr;
  });
  data.forEach(b => {
    if (b.return_status && String(b.return_status).trim() !== "") {
      b.return_status = String(b.return_status).trim().toUpperCase();
    } else {
      const key = String(b.full_name ?? "").trim().toLowerCase();
      const yr  = b.year_period != null ? Number(b.year_period) : null;
      b.return_status = (key && yr != null && firstYearByName[key] != null && yr > firstYearByName[key])
        ? "SPES BABY" : "NEW";
    }
  });
  return data;
}
