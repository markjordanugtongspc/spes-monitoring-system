import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { clearSessionCookie, createSessionCookie } from "./_lib/session.js";

const STAFF_PERMISSION_SELECT = `
  perm_view_users,
  perm_create_users,
  perm_edit_users,
  perm_delete_users,
  perm_export_reports,
  perm_view_other_offices,
  perm_view_global_stats
`;

function normalizeStaffPermissions(row = {}) {
  return {
    view_users: Boolean(row.perm_view_users),
    create_users: Boolean(row.perm_create_users),
    edit_users: Boolean(row.perm_edit_users),
    delete_users: Boolean(row.perm_delete_users),
    export_reports: Boolean(row.perm_export_reports),
    view_other_offices: Boolean(row.perm_view_other_offices),
    view_global_stats: Boolean(row.perm_view_global_stats),
  };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.rpc("login_staff", {
      p_username: username,
      p_password: password,
    });

    if (error) {
      console.error("[SPES API] login_staff failed:", error.code);
      return res.status(500).json({ success: false, error: "A system error occurred. Please try again." });
    }
    if (!data?.success || !data?.user?.id) {
      return res.status(401).json({
        success: false,
        error: data?.error || "Invalid username or password.",
      });
    }

    const { data: staffAccess, error: accessError } = await supabase
      .from("staffs")
      .select(STAFF_PERMISSION_SELECT)
      .eq("id", data.user.id)
      .single();
    if (accessError) {
      console.error("[SPES API] staff permission lookup failed:", accessError.code);
      return res.status(500).json({
        success: false,
        error: accessError.code === "42703"
          ? "The individual staff permissions migration has not been applied."
          : "Could not load account permissions.",
      });
    }
    data.user.permissions = normalizeStaffPermissions(staffAccess);

    res.setHeader("Set-Cookie", createSessionCookie(data.user));
    return res.status(200).json({ success: true, user: data.user });
  } catch (error) {
    console.error("[SPES API] session configuration error:", error.message);
    return res.status(500).json({ success: false, error: "Server authentication is not configured." });
  }
}
