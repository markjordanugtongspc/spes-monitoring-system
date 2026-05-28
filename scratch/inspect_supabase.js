import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../src/backend/.env") });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function inspectSchema() {
  console.log("Inspecting 'staffs' table...");
  // Try to fetch one row to see columns
  const { data, error } = await supabase.from("staffs").select("*").limit(1);
  
  if (error) {
    console.error("Error fetching staffs:", error);
  } else {
    console.log("Staffs sample row columns:", Object.keys(data[0] || {}));
  }

  // Try to see if roles table exists
  const { data: roles, error: roleError } = await supabase.from("roles").select("*").limit(1);
  if (roleError) {
    console.error("Error fetching roles:", roleError);
  } else {
    console.log("Roles columns:", Object.keys(roles[0] || {}));
  }
}

inspectSchema();
