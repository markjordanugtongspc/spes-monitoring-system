import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { requireAdmin } from "./_lib/session.js";

const ALLOWED_FIELDS = [
  "view_users",
  "create_users",
  "edit_users",
  "delete_users",
  "export_reports",
  "view_other_offices",
  "view_global_stats",
  "view_payroll",
];

const STAFF_PERMISSION_COLUMNS = Object.fromEntries(
  ALLOWED_FIELDS.map((field) => [field, `perm_${field}`])
);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const supabase = createSupabaseAdmin();
    if (!await requireAdmin(req, res, supabase)) return;

    const requestedIds = Array.isArray(req.body?.staffIds)
      ? req.body.staffIds
      : [req.body?.staffId];
    const staffIds = [...new Set(
      requestedIds
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isInteger(id) && id > 0)
    )];
    if (!staffIds.length || staffIds.length > 200) {
      return res.status(400).json({ error: "Select between 1 and 200 valid staff accounts." });
    }

    const payload = { updated_at: new Date().toISOString() };
    for (const field of ALLOWED_FIELDS) {
      if (field in (req.body?.updates || {})) {
        payload[STAFF_PERMISSION_COLUMNS[field]] = Boolean(req.body.updates[field]);
      }
    }
    const permissionUpdates = Object.entries(payload)
      .filter(([field]) => field !== "updated_at");
    if (!permissionUpdates.length) {
      return res.status(400).json({ error: "At least one permission update is required." });
    }

    const { data: targets, error: targetError } = await supabase
      .from("staffs")
      .select("id, role_id, approved, archive_at")
      .in("id", staffIds);
    if (targetError) {
      console.error("[SPES API] permission targets failed:", targetError.code, targetError.message);
      return res.status(500).json({ error: "Could not verify the selected staff accounts." });
    }
    if ((targets?.length || 0) !== staffIds.length) {
      return res.status(404).json({ error: "One or more selected staff accounts no longer exist." });
    }
    if (targets.some((staff) => Number(staff.role_id) === 1)) {
      return res.status(400).json({ error: "Administrator permissions cannot be modified." });
    }
    const grantsPermission = permissionUpdates.some(([, enabled]) => enabled);
    if (grantsPermission && targets.some((staff) => !staff.approved || staff.archive_at)) {
      return res.status(409).json({
        error: "Permissions can only be granted to approved, active staff accounts.",
      });
    }

    let { data, error } = await supabase
      .from("staffs")
      .update(payload)
      .in("id", staffIds)
      .select(`
        id,
        perm_view_users,
        perm_create_users,
        perm_edit_users,
        perm_delete_users,
        perm_export_reports,
        perm_view_other_offices,
        perm_view_global_stats,
        perm_view_payroll
      `);

    if (error && (error.code === "42703" || error.code === "PGRST204" || error.code === "PGRST100" || String(error.message || "").includes("perm_view_payroll"))) {
      delete payload.perm_view_payroll;
      const retry = await supabase
        .from("staffs")
        .update(payload)
        .in("id", staffIds)
        .select(`
          id,
          perm_view_users,
          perm_create_users,
          perm_edit_users,
          perm_delete_users,
          perm_export_reports,
          perm_view_other_offices,
          perm_view_global_stats
        `);
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      console.error("[SPES API] staff permissions update failed:", error.code, error.message);
      if (error.code === "42703" || error.code === "PGRST204") {
        return res.status(409).json({
          error: "The individual staff permissions migration has not been applied.",
        });
      }
      return res.status(500).json({ error: "Failed to update permissions." });
    }

    return res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    console.error("[SPES API] permissions configuration error:", error.message);
    return res.status(500).json({ error: "The secure permissions service is not configured." });
  }
}
