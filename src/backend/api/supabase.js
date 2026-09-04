import { createClient } from "@supabase/supabase-js";

const env = (typeof import.meta !== "undefined" && import.meta.env)
  ? import.meta.env
  : (typeof process !== "undefined" && process.env ? process.env : {});

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || "https://pprmqnrevuyllhkxejbu.supabase.co";
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "sb_publishable_0sCQGxGm-VH-wDE6jN1CsA_UtJ3vvP3";

/**
 * Public (anon) client — used for all regular reads that respect RLS.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

