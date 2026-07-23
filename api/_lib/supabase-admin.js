import { createClient } from "@supabase/supabase-js";

function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required server environment variable: ${names.join(" or ")}`);
}

export function createSupabaseAdmin() {
  const url = requiredEnv("SUPABASE_URL", "VITE_SUPABASE_URL");
  const secret = requiredEnv("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE");

  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function getServerSecret() {
  return requiredEnv(
    "SPES_SESSION_SECRET",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE",
  );
}
