/**
 * SPES Portal — Diagnostic & Chief/Test Account Cleaner
 * ─────────────────────────────────────────────────────
 * Inspects all staff roles, verifies office assignments (ensures HR & Admin
 * have office_id: null / N/A), and cleans up any Chief test accounts.
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

// --- START: CHECK AND CLEAN CHIEF - Verifies staff roles, nullifies executive offices, and deletes target Chief records ---
export async function checkAndCleanChief(options = { deleteChief: true }) {
  console.log("=== SPES Staff & Role Diagnostic ===");

  // 1. Fetch current staff roster
  const { data: staffs, error: staffErr } = await supabase
    .from("staffs")
    .select("id, full_name, username, email, role_id, office_id, approved, roles(id, name), offices(id, name)")
    .order("id");

  if (staffErr) {
    console.error("Error fetching staffs:", staffErr.message);
    return;
  }

  console.log(`\nFound ${staffs.length} total staff records:`);
  console.table(
    staffs.map((s) => ({
      ID: s.id,
      Name: s.full_name,
      Username: `@${s.username}`,
      Role: s.roles?.name || `Role ${s.role_id}`,
      Office: s.offices?.name || "N/A (Global)",
      Approved: s.approved ? "YES" : "NO",
    }))
  );

  // 2. Ensure HR (ID: 2) and Admin (ID: 1) have office_id = null so they do not conflict with local offices
  const executivesWithOffice = staffs.filter(
    (s) => (s.role_id === 1 || s.role_id === 2 || s.role_id === 4) && s.office_id !== null
  );

  if (executivesWithOffice.length > 0) {
    console.log(`\nAligning ${executivesWithOffice.length} Executive accounts to have Office: N/A (null)...`);
    for (const exec of executivesWithOffice) {
      await supabase.from("staffs").update({ office_id: null }).eq("id", exec.id);
      console.log(`  ✓ Set office_id to null for ${exec.full_name} (${exec.roles?.name})`);
    }
  }

  // 3. If deleteChief is requested, remove Chief / Criste test records so the user can test clean registration
  if (options.deleteChief) {
    const chiefRecords = staffs.filter(
      (s) =>
        s.role_id === 4 ||
        String(s.username).toLowerCase().includes("chief") ||
        String(s.full_name).toLowerCase().includes("criste")
    );

    if (chiefRecords.length > 0) {
      console.log(`\nDeleting ${chiefRecords.length} Chief/Test account(s)...`);
      for (const chief of chiefRecords) {
        // Delete permissions
        await supabase.from("staff_permissions").delete().eq("staff_id", chief.id);
        // Delete staff row
        await supabase.from("staffs").delete().eq("id", chief.id);
        console.log(`  ✓ Removed staff record ID: ${chief.id} (${chief.full_name})`);

        // Delete from Auth if present
        if (chief.email) {
          try {
            const { data: { users } } = await supabase.auth.admin.listUsers();
            const authUser = users?.find((u) => u.email?.toLowerCase() === chief.email.toLowerCase());
            if (authUser) {
              await supabase.auth.admin.deleteUser(authUser.id);
              console.log(`  ✓ Removed Supabase Auth user: ${authUser.id} (${authUser.email})`);
            }
          } catch (e) {
            console.warn(`  ! Auth cleanup note: ${e.message}`);
          }
        }
      }
    } else {
      console.log("\nNo Chief records found to delete.");
    }
  }

  // 4. Print final state
  const { data: finalStaffs } = await supabase
    .from("staffs")
    .select("id, full_name, username, role_id, office_id, roles(name), offices(name)")
    .order("id");

  console.log("\n=== Final Staff Roster ===");
  console.table(
    (finalStaffs || []).map((s) => ({
      ID: s.id,
      Name: s.full_name,
      Username: `@${s.username}`,
      Role: s.roles?.name || `Role ${s.role_id}`,
      Office: s.offices?.name || "N/A (Global)",
    }))
  );
}
// --- END: CHECK AND CLEAN CHIEF ---

// Run if called directly
checkAndCleanChief({ deleteChief: true })
  .then(() => {
    console.log("\n[SPES Cleaner] Operation completed successfully.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[SPES Cleaner] Fatal error:", err);
    process.exit(1);
  });
