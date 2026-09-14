import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load local .env file in Node development/testing runtimes if variables aren't pre-loaded
if (!process.env.SUPABASE_SERVICE_ROLE && !process.env.SUPABASE_SECRET_KEY && !process.env.SPES_SUPABASE_SERVICE_ROLE_KEY) {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    dotenv.config({ path: path.resolve(__dirname, "../../src/backend/.env") });
  } catch {
    // Non-critical: In production serverless environments (e.g. Vercel), process.env is injected by platform
  }
}

/* START REQUIRED ENVIRONMENT LOOKUP - Looks up first non-empty value among candidate variable names */
function requiredEnv(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required server environment variable: ${names.join(" or ")}`);
}
/* END REQUIRED ENVIRONMENT LOOKUP */

/* START CREATE SUPABASE ADMIN CLIENT - Instantiates privileged Supabase admin client strictly from environment */
export function createSupabaseAdmin() {
  const url = requiredEnv("SPES_SUPABASE_URL", "VITE_SPES_SUPABASE_URL", "SUPABASE_URL", "VITE_SUPABASE_URL");
  const secret = requiredEnv("SPES_SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE", "SUPABASE_SECRET_KEY");

  return createClient(url, secret, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
/* END CREATE SUPABASE ADMIN CLIENT */

/* START GET SERVER SECRET - Resolves HMAC session signing key from environment secrets */
export function getServerSecret() {
  return requiredEnv(
    "SPES_SESSION_SECRET",
    "SPES_SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE",
  );
}
/* END GET SERVER SECRET */
