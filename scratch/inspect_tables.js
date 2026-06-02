import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: "./src/backend/.env" });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function inspect() {
  console.log("Querying one beneficiary...");
  const { data: bene, error: err1 } = await supabase.from("beneficiary").select("*").limit(1);
  if (err1) {
    console.error("Error querying beneficiary:", err1);
  } else {
    console.log("Beneficiary columns/keys:", bene && bene[0] ? Object.keys(bene[0]) : "Empty table");
    console.log("Beneficiary sample row:", bene && bene[0] ? bene[0] : "None");
  }

  console.log("\nQuerying one staff...");
  const { data: staff, error: err2 } = await supabase.from("staffs").select("*").limit(1);
  if (err2) {
    console.error("Error querying staffs:", err2);
  } else {
    console.log("Staff columns/keys:", staff && staff[0] ? Object.keys(staff[0]) : "Empty table");
    console.log("Staff sample row:", staff && staff[0] ? staff[0] : "None");
  }
}

inspect();
