import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { requireAdminOrAuthorized } from "./_lib/session.js";

/**
 * SPES Portal — Batch Deletion Endpoint (Admin / HR)
 * ──────────────────────────────────────────────────
 * Permanently deletes a batch from the `batch` table using the
 * Supabase service role admin client to bypass client RLS restrictions.
 * Soft-archives any active beneficiaries belonging to this batch.
 *
 * DELETE /api/batch
 * Body: { batchId: number }
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "DELETE" && req.method !== "POST") {
    res.setHeader("Allow", "DELETE, POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const batchId = Number(req.body?.batchId || req.query?.id);
  if (!batchId || isNaN(batchId) || batchId <= 0) {
    return res.status(400).json({ error: "Invalid batch ID." });
  }

  try {
    const supabase = createSupabaseAdmin();
    const caller = await requireAdminOrAuthorized(req, res, supabase, "delete_users");
    if (!caller) return;

    // 1. Soft-archive beneficiaries belonging to this batch & unlink batch_id
    const nowIso = new Date().toISOString();
    const { error: beneError } = await supabase
      .from("beneficiary")
      .update({ archive_at: nowIso, updated_at: nowIso, batch_id: null })
      .eq("batch_id", batchId);

    if (beneError) {
      console.error("[SPES API] archive batch beneficiaries failed:", beneError.code, beneError.message);
    }

    // 2. Hard-delete batch row from batch table
    const { error: batchError } = await supabase
      .from("batch")
      .delete()
      .eq("id", batchId);

    if (batchError) {
      console.error("[SPES API] batch deletion failed:", batchError.code, batchError.message);
      return res.status(500).json({ error: "Failed to delete batch from database. " + (batchError.message || "") });
    }

    return res.status(200).json({ success: true, batchId });
  } catch (error) {
    console.error("[SPES API] batch deletion error:", error.message);
    return res.status(500).json({ error: "The secure batch deletion service encountered an error." });
  }
}
