/**
 * SPES Portal — Force Delete Chief / Test Account Script
 * ──────────────────────────────────────────────────────
 * Deletes any test Chief account from `staff_permissions`, `staffs`,
 * and Supabase Auth (`auth.users`), restoring the latest active staff sequence.
 */

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../src/backend/.env") });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SECRET_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration in src/backend/.env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// --- START: FORCE DELETE CHIEF ACCOUNT - Deletes Chief account and cleans related permissions/auth records ---
export async function forceDeleteChiefAccount(identifier = "chief_criste") {
  console.log(`[SPES Cleanup] Searching for account matching: "${identifier}" or role_id: 4...`);

  // 1. Locate the staff member
  let query = supabase.from("staffs").select("id, full_name, username, email, role_id");
  const parsedId = Number.parseInt(identifier, 10);

  if (Number.isInteger(parsedId) && parsedId > 0) {
    query = query.eq("id", parsedId);
  } else {
    query = query.or(`username.eq.${identifier},email.eq.${identifier},role_id.eq.4`);
  }

  const { data: matchedStaffs, error: fetchErr } = await query;
  if (fetchErr) {
    console.error("[SPES Cleanup] Error fetching staff:", fetchErr.message);
    return { success: false, error: fetchErr.message };
  }

  if (!matchedStaffs || matchedStaffs.length === 0) {
    console.log("[SPES Cleanup] No matching Chief or test accounts found to delete.");
  } else {
    for (const staff of matchedStaffs) {
      console.log(`[SPES Cleanup] Found target staff: ID ${staff.id} (${staff.full_name}, @${staff.username}, Role: ${staff.role_id})`);

      // 2. Delete from staff_permissions
      const { error: permErr } = await supabase
        .from("staff_permissions")
        .delete()
        .eq("staff_id", staff.id);
      if (permErr) {
        console.warn(`[SPES Cleanup] Warning deleting staff_permissions for staff_id ${staff.id}:`, permErr.message);
      } else {
        console.log(`[SPES Cleanup] Deleted staff_permissions for staff_id: ${staff.id}`);
      }

      // 3. Delete from staffs table
      const { error: staffErr } = await supabase
        .from("staffs")
        .delete()
        .eq("id", staff.id);
      if (staffErr) {
        console.error(`[SPES Cleanup] Error deleting staff record ID ${staff.id}:`, staffErr.message);
      } else {
        console.log(`[SPES Cleanup] Successfully deleted staff record ID: ${staff.id}`);
      }

      // 4. Delete from Supabase Auth if email exists
      if (staff.email) {
        try {
          const { data: { users } } = await supabase.auth.admin.listUsers();
          const authUser = users?.find(u => u.email?.toLowerCase() === staff.email.toLowerCase());
          if (authUser) {
            await supabase.auth.admin.deleteUser(authUser.id);
            console.log(`[SPES Cleanup] Deleted Supabase Auth user: ${authUser.id} (${authUser.email})`);
          }
        } catch (authErr) {
          console.warn("[SPES Cleanup] Auth delete check notice:", authErr.message);
        }
      }
    }
  }

  // 5. Ensure HR and Admin roles have office_id = null (N/A)
  await supabase
    .from("staffs")
    .update({ office_id: null })
    .in("role_id", [1, 2]);

  // 6. Check latest remaining staff IDs
  const { data: remainingStaffs } = await supabase
    .from("staffs")
    .select("id, full_name, username, role_id, office_id")
    .order("id", { ascending: false })
    .limit(5);

  console.log("\n[SPES Cleanup] Current Top Staff Records in Database:");
  console.table(remainingStaffs);

  return { success: true, remainingStaffs };
}
// --- END: FORCE DELETE CHIEF ACCOUNT ---

// Execute if run directly
const arg = process.argv[2] || "chief_criste";
forceDeleteChiefAccount(arg)
  .then(() => {
    console.log("[SPES Cleanup] Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[SPES Cleanup] Fatal error:", err);
    process.exit(1);
  });
