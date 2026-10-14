import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { requireAdminOrAuthorized } from "./_lib/session.js";

// --- START: SPES PORTAL BATCH DELETION & ARCHIVAL ENDPOINT ---
/**
 * SPES Portal — Batch Deletion & Archival Endpoint (Admin / HR)
 * ────────────────────────────────────────────────────────────
 * - DELETE: Permanently deletes a batch from `batch` table.
 * - PATCH / POST (action='archive'): Soft-archives the batch (archived_at = now()).
 * In both cases, active beneficiaries in the batch are soft-archived.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  const method = req.method;
  if (method !== "DELETE" && method !== "PATCH" && method !== "POST") {
    res.setHeader("Allow", "DELETE, PATCH, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const batchId = Number(req.body?.batchId || req.query?.id || req.body?.id);
  if (!batchId || isNaN(batchId) || batchId <= 0) {
    return res.status(400).json({ error: "Invalid batch ID." });
  }

  const action = String(req.body?.action || req.query?.action || "").toLowerCase();
  const isArchive = method === "PATCH" || action === "archive";

  try {
    const supabase = createSupabaseAdmin();
    const caller = await requireAdminOrAuthorized(req, res, supabase, "delete_users");
    if (!caller) return;

    const nowIso = new Date().toISOString();

    // 1. Soft-archive beneficiaries belonging to this batch & unlink batch_id
    const { error: beneError } = await supabase
      .from("beneficiary")
      .update({ archive_at: nowIso, updated_at: nowIso, batch_id: null })
      .eq("batch_id", batchId);

    if (beneError) {
      console.error("[SPES API] archive batch beneficiaries failed:", beneError.code, beneError.message);
    }

    if (isArchive) {
      // 2a. Soft-archive batch row in batch table
      const { error: archiveError } = await supabase
        .from("batch")
        .update({ archived_at: nowIso })
        .eq("id", batchId);

      if (archiveError) {
        console.error("[SPES API] batch archival failed:", archiveError.code, archiveError.message);
        return res.status(500).json({ error: "Failed to archive batch. " + (archiveError.message || "") });
      }

      return res.status(200).json({ success: true, batchId, mode: "archived" });
    }

    // 2b. Hard-delete batch row from batch table
    const { error: batchError } = await supabase
      .from("batch")
      .delete()
      .eq("id", batchId);

    if (batchError) {
      console.error("[SPES API] batch deletion failed:", batchError.code, batchError.message);
      return res.status(500).json({ error: "Failed to delete batch from database. " + (batchError.message || "") });
    }

    return res.status(200).json({ success: true, batchId, mode: "deleted" });
  } catch (error) {
    console.error("[SPES API] batch operation error:", error.message);
    return res.status(500).json({ error: "The secure batch service encountered an error." });
  }
}
// --- END: SPES PORTAL BATCH DELETION & ARCHIVAL ENDPOINT ---
