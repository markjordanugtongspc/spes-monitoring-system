import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { clearSessionCookie, createSessionCookie } from "./_lib/session.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSessionCookie());
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, DELETE");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) {
    return res.status(400).json({ success: false, error: "Username and password are required." });
  }

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.rpc("login_staff", {
      p_username: username,
      p_password: password,
    });

    if (error) {
      console.error("[SPES API] login_staff failed:", error.code);
      return res.status(500).json({ success: false, error: "A system error occurred. Please try again." });
    }
    if (!data?.success || !data?.user?.id) {
      return res.status(401).json({
        success: false,
        error: data?.error || "Invalid username or password.",
      });
    }

    res.setHeader("Set-Cookie", createSessionCookie(data.user));
    return res.status(200).json({ success: true, user: data.user });
  } catch (error) {
    console.error("[SPES API] session configuration error:", error.message);
    return res.status(500).json({ success: false, error: "Server authentication is not configured." });
  }
}
