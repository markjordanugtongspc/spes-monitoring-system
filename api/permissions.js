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

// --- START: PERMISSIONS API HANDLER - POST to update staff_permissions table ---
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

    // Build permission payload (only allowed fields, no perm_ prefix)
    const permPayload = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in (req.body?.updates || {})) {
        permPayload[field] = Boolean(req.body.updates[field]);
      }
    }
    if (!Object.keys(permPayload).length) {
      return res.status(400).json({ error: "At least one permission update is required." });
    }

    // Verify target staff accounts exist, not admin, not archived if granting
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
    const grantsPermission = Object.values(permPayload).some((v) => v === true);
    if (grantsPermission && targets.some((staff) => !staff.approved || staff.archive_at)) {
      return res.status(409).json({
        error: "Permissions can only be granted to approved, active staff accounts.",
      });
    }

    // Fetch existing staff_permissions to merge and avoid wiping other columns on partial upsert
    const { data: existingRows } = await supabase
      .from("staff_permissions")
      .select("*")
      .in("staff_id", staffIds);

    const existingMap = new Map((existingRows || []).map((r) => [Number(r.staff_id), r]));

    // UPSERT into staff_permissions (one row per staff_id, UNIQUE constraint)
    const now = new Date().toISOString();
    const rows = staffIds.map((id) => {
      const existing = existingMap.get(Number(id)) || {};
      const merged = {};
      for (const field of ALLOWED_FIELDS) {
        if (field in permPayload) {
          merged[field] = Boolean(permPayload[field]);
        } else if (field in existing) {
          merged[field] = Boolean(existing[field]);
        } else {
          merged[field] = false;
        }
      }
      return {
        staff_id: id,
        ...merged,
        updated_at: now,
      };
    });

    const { data, error } = await supabase
      .from("staff_permissions")
      .upsert(rows, { onConflict: "staff_id", ignoreDuplicates: false })
      .select(`
        staff_id,
        view_users,
        create_users,
        edit_users,
        delete_users,
        export_reports,
        view_other_offices,
        view_global_stats,
        view_payroll
      `);

    if (error) {
      console.error("[SPES API] staff_permissions upsert failed:", error.code, error.message);
      return res.status(500).json({ error: "Failed to update permissions." });
    }

    return res.status(200).json({ success: true, data: data || [] });
  } catch (error) {
    console.error("[SPES API] permissions configuration error:", error.message);
    return res.status(500).json({ error: "The secure permissions service is not configured." });
  }
}
// --- END: PERMISSIONS API HANDLER ---

