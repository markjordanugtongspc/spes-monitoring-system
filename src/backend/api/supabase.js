import { createClient } from "@supabase/supabase-js";

const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Public (anon) client — used for all regular reads that respect RLS.
 */
export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");
