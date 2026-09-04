import { createSupabaseAdmin } from "./_lib/supabase-admin.js";

/**
 * SPES Portal — Beacon Endpoint (Browser Close Fallback)
 * ───────────────────────────────────────────────────────
 * Lightweight POST endpoint that sets a staff member's status
 * to OFFLINE. Used by navigator.sendBeacon() during page unload.
 *
 * POST /api/beacon
 * Body: { staff_id: number }
 * Returns: 204 No Content
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const staffId = Number(req.body?.staff_id);
  if (!staffId || isNaN(staffId) || staffId <= 0) {
    return res.status(400).json({ error: "Invalid staff_id." });
  }

  try {
    const supabase = createSupabaseAdmin();
    await supabase
      .from("staffs")
      .update({ status: "OFFLINE" })
      .eq("id", staffId);

    return res.status(204).end();
  } catch (error) {
    console.error("[SPES API] beacon error:", error?.message);
    return res.status(500).json({ error: "Failed to update status." });
  }
}
