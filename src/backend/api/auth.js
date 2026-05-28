/**
 * SPES Portal — Supabase Auth Handler
 * ────────────────────────────────────
 * Handles login, logout, and session management against the
 * Supabase `staffs` table. This is a simple username + password
 * lookup (not Supabase Auth — we query the table directly since
 * implementors uses a custom table with role_id/office_id).

 */
import { supabase } from "./supabase.js";

/**
 * Authenticate an implementor user by username and password.
 * Looks up the `staffs` table and resolves role/office names.

 *
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function loginImplementor(username, password) {

  try {
    // 1. Call the secure login RPC function
    // This function handles bcrypt verification on the database side
    const { data, error } = await supabase.rpc("login_staff", {

      p_username: username,
      p_password: password
    });

    if (error) {
      console.error("[SPES Auth] RPC Error:", error);

      return {
        success: false,
        error: "A system error occurred. Please try again."
      };
    }

    if (!data.success) {
      return {
        success: false,
        error: data.error || "Invalid username or password."
      };
    }

    // 2. Build session object from the returned user data
    const implementor = data.user;
    const roleName = mapToRbacRole(implementor.role_label ?? implementor.role);

    const session = {
      id: implementor.id,
      username: implementor.username,
      email: implementor.email || "",
      full_name: implementor.full_name || implementor.username,
      role: roleName,
      role_label: implementor.role_label || "Unknown",
      office_id: implementor.office_id || null,
      status: implementor.status || "ONLINE"
    };


    // 3. Persist to localStorage
    localStorage.setItem("spes_session", JSON.stringify(session));

    return { success: true, user: session };
  } catch (err) {
    console.error("[SPES Auth] Login catch error:", err);
    return { success: false, error: "An unexpected error occurred." };
  }
}



/**
 * Map the database role string to an RBAC role key.
 * Adjust these mappings to match your `roles` table values.
 *
 * @param {string | undefined} dbRole — e.g. "Administrator", "Officer", "Student"
 * @returns {"admin" | "officer" | "student"}
 */
function mapToRbacRole(role) {
  if (!role) return "student";
  
  // Handle numeric IDs if used
  if (typeof role === "number" || !isNaN(role)) {
    const id = parseInt(role);
    if (id === 1) return "admin";
    if (id === 2) return "officer";
    return "student";
  }

  const lower = String(role).toLowerCase();
  if (lower.includes("admin")) return "admin";
  if (lower.includes("officer")) return "officer";
  return "student";
}


/**
 * Fetch all implementors for the User Management table.
 * @returns {Promise<Array>}
 */
export async function fetchImplementorList() {
  try {
    const { data, error } = await supabase
      .from("staffs")
      .select(`
        *,
        roles (
          name
        ),
        offices (
          name
        )
      `)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[SPES] Failed to fetch implementor list:", error);
      return [];
    }

    return (data ?? []).map((s, index) => ({
      id: s.id,
      index: index + 1,
      full_name: s.full_name,
      email: s.email,
      office: s.offices?.name || "N/A",
      role: s.roles?.name || "OFFICER",
      status: s.status || "OFFLINE",
      address: s.address || "",
      phone: s.phone || "",
      religion: s.religion || "",
      language: s.language || "",
      blood_type: s.blood_type || ""
    }));
  } catch (err) {
    console.error("[SPES] fetchImplementorList catch error:", err);
    return [];
  }
}



/**
 * Sign out — clear session and redirect.
 */
export function logoutImplementor() {

  localStorage.removeItem("spes_session");
  localStorage.removeItem("spes_supabase_token");
  window.location.href = "/src/frontend/login/";
}
