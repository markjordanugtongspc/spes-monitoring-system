import { createClient } from "@supabase/supabase-js";

const env = (typeof import.meta !== "undefined" && import.meta.env)
  ? import.meta.env
  : (typeof process !== "undefined" && process.env ? process.env : {});

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "https://byrmafeczbxutgkicmtu.supabase.co";
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "sb_publishable_n0DMISxDJdkXH4Or3YoYog_tsR0u6av";
const targetSchema = env.VITE_SUPABASE_SCHEMA || env.SUPABASE_SCHEMA || "spes";

// --- START: SPES SUPABASE CLIENT INITIALIZATION - Configures client with 'spes' schema isolation ---
/**
 * Public (anon) client — used for all regular reads that respect RLS under 'spes' schema.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  db: {
    schema: targetSchema
  }
});
// --- END: SPES SUPABASE CLIENT INITIALIZATION ---
