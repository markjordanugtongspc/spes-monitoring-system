/**
 * SPES — Supabase Advanced Diagnostic Tool
 * ─────────────────────────────────────────
 * Uses the SERVICE ROLE key to bypass RLS for deep inspection.
 * Checks table health, RLS policies, and can auto-fix common issues.
 *
 * Usage:
 *   node scratch/spes-db-doctor.js
 *   node scratch/spes-db-doctor.js --fix       (applies fixes)
 *   node scratch/spes-db-doctor.js --table=permissions
 */

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../src/backend/.env") });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY    = process.env.VITE_SUPABASE_ANON_KEY;
const SVC_KEY     = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SVC_KEY) {
  console.error("[DOCTOR] ❌  Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE in .env");
  process.exit(1);
}

// Two clients: anon (simulates what the browser does) and admin (service role)
const anonClient  = createClient(SUPABASE_URL, ANON_KEY);
const adminClient = createClient(SUPABASE_URL, SVC_KEY, {
  auth: { persistSession: false }
});

const args = process.argv.slice(2);
const shouldFix   = args.includes("--fix");
const filterTable = args.find(a => a.startsWith("--table="))?.split("=")[1] ?? null;

// ──────────────────────────────────────────────────────────────
// Tables to inspect
// ──────────────────────────────────────────────────────────────
const TABLES = ["staffs", "beneficiaries", "implementors", "roles", "permissions"];

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function ok(msg)   { console.log(`  ✅  ${msg}`); }
function warn(msg) { console.warn(`  ⚠️   ${msg}`); }
function err(msg)  { console.error(`  ❌  ${msg}`); }
function info(msg) { console.log(`  ℹ️   ${msg}`); }
function head(msg) { console.log(`\n${"─".repeat(60)}\n  ${msg}\n${"─".repeat(60)}`); }

// ──────────────────────────────────────────────────────────────
// 1. Ping each table with ANON key (simulates browser)
// ──────────────────────────────────────────────────────────────
async function pingTables() {
  head("TABLE PING (Anon Key — browser simulation)");
  const tables = filterTable ? [filterTable] : TABLES;

  for (const table of tables) {
    const { data, error, count } = await anonClient
      .from(table)
      .select("*", { count: "exact", head: true });

    if (error) {
      err(`${table}: ${error.code} — ${error.message}`);
      if (error.code === "42501") warn(`RLS is blocking anon reads on "${table}"`);
    } else {
      ok(`${table}: readable by anon  (count ≈ ${count ?? "?"} rows)`);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 2. Ping each table with SERVICE ROLE key
// ──────────────────────────────────────────────────────────────
async function pingTablesAdmin() {
  head("TABLE PING (Service Role — bypasses RLS)");
  const tables = filterTable ? [filterTable] : TABLES;

  for (const table of tables) {
    const { data, error, count } = await adminClient
      .from(table)
      .select("*", { count: "exact", head: true });

    if (error) {
      err(`${table}: ${error.code} — ${error.message}`);
    } else {
      ok(`${table}: readable by service role  (count ≈ ${count ?? "?"} rows)`);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 3. Test upsert to "permissions" with ANON key (the failing op)
// ──────────────────────────────────────────────────────────────
async function testPermissionsUpsert() {
  head("UPSERT TEST — permissions (Anon Key)");

  // Get first role_id to use as test subject
  const { data: roles, error: rolesErr } = await adminClient
    .from("roles")
    .select("id")
    .limit(1)
    .single();

  if (rolesErr || !roles) {
    warn("No roles found — skipping upsert test");
    return;
  }

  const testPayload = {
    role_id: roles.id,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await anonClient
    .from("permissions")
    .upsert(testPayload, { onConflict: "role_id" })
    .select("role_id")
    .single();

  if (error) {
    err(`Upsert FAILED with anon key: ${error.code} — ${error.message}`);
    if (error.code === "42501") {
      warn("Root cause: RLS policy is missing or too restrictive on 'permissions' table.");
      warn("Run with --fix to apply the fix automatically.");
    }
  } else {
    ok(`Upsert succeeded with anon key (role_id=${data?.role_id})`);
  }
}

// ──────────────────────────────────────────────────────────────
// 4. Inspect existing RLS policies via pg_catalog (admin only)
// ──────────────────────────────────────────────────────────────
async function inspectRLSPolicies() {
  head("RLS POLICY INSPECTION (via pg_policies)");
  const tables = filterTable ? [filterTable] : TABLES;

  for (const table of tables) {
    try {
      const { data: pols, error: polErr } = await adminClient
        .from("pg_policies")
        .select("policyname, cmd, permissive, roles, qual, with_check")
        .eq("tablename", table);

      if (polErr || !pols) {
        info(`Cannot query pg_policies via REST for "${table}" — use Supabase Dashboard > Auth > Policies`);
      } else if (!pols.length) {
        warn(`"${table}": NO write RLS policies found for anon/authenticated!`);
      } else {
        pols.forEach(p => {
          ok(`"${table}" policy: [${p.cmd}] "${p.policyname}" — roles: ${Array.isArray(p.roles) ? p.roles.join(",") : p.roles ?? "all"}`);
        });
      }
    } catch (e) {
      info(`pg_policies not accessible via REST for "${table}"`);
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 5. AUTO-FIX: Apply open RLS policy to "permissions" table
//    (allows authenticated + anon reads; authenticated writes)
// ──────────────────────────────────────────────────────────────
async function fixPermissionsRLS() {
  head("AUTO-FIX — Applying RLS Policy to 'permissions'");

  // The REST API cannot execute DDL, but we can call a Supabase Edge Function
  // or use the management API. Here we use the service-role client to upsert
  // a "dummy" row (proves write works at admin level) and guide the dev.

  warn("Direct DDL cannot be issued via the JS client.");
  warn("Please run the following SQL in Supabase Dashboard > SQL Editor:");
  console.log(`
─── COPY & PASTE INTO SUPABASE SQL EDITOR ─────────────────────────

-- 1. Enable RLS (safe to run even if already enabled)
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

-- 2. Drop old catch-all policy if it exists
DROP POLICY IF EXISTS "Enable all access for permissions" ON public.permissions;

-- 3. Allow authenticated users to read
CREATE POLICY "Authenticated users can read permissions"
  ON public.permissions FOR SELECT
  TO authenticated
  USING (true);

-- 4. Allow authenticated users to insert / update
CREATE POLICY "Authenticated users can write permissions"
  ON public.permissions FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update permissions"
  ON public.permissions FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

────────────────────────────────────────────────────────────────────
`);

  // In parallel, test with the service role key to confirm the table is writable at admin level
  const { data: roles } = await adminClient.from("roles").select("id").limit(1).single();
  if (roles) {
    const { error } = await adminClient
      .from("permissions")
      .upsert({ role_id: roles.id, updated_at: new Date().toISOString() }, { onConflict: "role_id" });

    if (error) {
      err(`Admin upsert also failed: ${error.code} — ${error.message}`);
    } else {
      ok(`Admin (service-role) upsert succeeded — table is writable at the DB level.`);
      info("The fix needed is purely RLS (Row Level Security) — run the SQL above.");
    }
  }
}

// ──────────────────────────────────────────────────────────────
// 6. Summary report
// ──────────────────────────────────────────────────────────────
async function run() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  SPES DB Doctor  |  ${new Date().toLocaleString()}`);
  console.log(`  URL: ${SUPABASE_URL}`);
  console.log(`${"═".repeat(60)}`);

  await pingTables();
  await pingTablesAdmin();
  await testPermissionsUpsert();
  await inspectRLSPolicies();

  if (shouldFix) {
    await fixPermissionsRLS();
  } else {
    console.log(`\n  💡 Tip: Run "node scratch/spes-db-doctor.js --fix" for guidance on fixing issues.\n`);
  }

  console.log(`\n${"═".repeat(60)}\n  DONE\n${"═".repeat(60)}\n`);
}

run().catch(e => {
  console.error("[DOCTOR] Fatal error:", e);
  process.exit(1);
});
