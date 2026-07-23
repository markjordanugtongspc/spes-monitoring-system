import { createSupabaseAdmin } from "./_lib/supabase-admin.js";
import { requireAdmin } from "./_lib/session.js";

const VALID_TYPES = new Set(["public", "academic"]);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const supabase = createSupabaseAdmin();
    if (!await requireAdmin(req, res, supabase)) return;

    const name = String(req.body?.name || "").trim();
    const type = String(req.body?.type || "public").trim().toLowerCase();

    if (!name) return res.status(400).json({ error: "Office name is required." });
    if (name.length > 150) return res.status(400).json({ error: "Office name is too long." });
    if (!VALID_TYPES.has(type)) return res.status(400).json({ error: "Invalid office type." });

    const { data: existing, error: lookupError } = await supabase
      .from("offices")
      .select("id, name, type, location")
      .ilike("name", name)
      .is("archived_at", null)
      .maybeSingle();

    if (lookupError) {
      console.error("[SPES API] office lookup failed:", lookupError.code);
      return res.status(500).json({ error: "Could not check the office name." });
    }
    if (existing) return res.status(409).json({ error: `"${existing.name}" already exists.` });

    const { data, error } = await supabase
      .from("offices")
      .insert([{ name, type, location: "ILIGAN CITY" }])
      .select("id, name, type, location")
      .single();

    if (error) {
      console.error("[SPES API] office insert failed:", error.code);
      return res.status(error.code === "23505" ? 409 : 500).json({
        error: error.code === "23505" ? "That office already exists." : "Failed to add office.",
      });
    }

    return res.status(201).json({ success: true, data });
  } catch (error) {
    console.error("[SPES API] office configuration error:", error.message);
    return res.status(500).json({ error: "The secure office service is not configured." });
  }
}
