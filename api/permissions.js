import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { requireAdmin } from "./_lib/session.js";

const ALLOWED_FIELDS = [
  "view_users",
  "create_users",
  "edit_users",
  "delete_users",
  "export_reports",
];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const supabase = createSupabaseAdmin();
    if (!await requireAdmin(req, res, supabase)) return;

    const roleId = Number.parseInt(req.body?.roleId, 10);
    if (!Number.isInteger(roleId) || roleId < 1) {
      return res.status(400).json({ error: "A valid role is required." });
    }

    const payload = { role_id: roleId, updated_at: new Date().toISOString() };
    for (const field of ALLOWED_FIELDS) {
      if (field in (req.body?.updates || {})) payload[field] = Boolean(req.body.updates[field]);
    }

    const { data, error } = await supabase
      .from("permissions")
      .upsert(payload, { onConflict: "role_id" })
      .select("role_id, view_users, create_users, edit_users, delete_users, export_reports")
      .single();

    if (error) {
      console.error("[SPES API] permissions upsert failed:", error.code);
      return res.status(500).json({ error: "Failed to update permissions." });
    }

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("[SPES API] permissions configuration error:", error.message);
    return res.status(500).json({ error: "The secure permissions service is not configured." });
  }
}
