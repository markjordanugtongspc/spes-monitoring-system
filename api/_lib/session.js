import { createHmac, timingSafeEqual } from "node:crypto";
import { getServerSecret } from "./supabase-admin.js";

const COOKIE_NAME = "spes_admin_session";
const MAX_AGE_SECONDS = 8 * 60 * 60;

function encode(value) {
  return Buffer.from(value).toString("base64url");
}

function signature(payload) {
  return createHmac("sha256", getServerSecret()).update(payload).digest("base64url");
}

export function createSessionCookie(staff) {
  const payload = encode(JSON.stringify({
    staffId: Number(staff.id),
    expiresAt: Date.now() + MAX_AGE_SECONDS * 1000,
  }));
  const token = `${payload}.${signature(payload)}`;

  return [
    `${COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ].join("; ");
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function readCookie(req) {
  for (const cookie of String(req.headers.cookie || "").split(";")) {
    const [name, ...parts] = cookie.trim().split("=");
    if (name === COOKIE_NAME) return parts.join("=");
  }
  return null;
}

export function readSession(req) {
  const token = readCookie(req);
  if (!token) return null;

  const [payload, suppliedSignature] = token.split(".");
  if (!payload || !suppliedSignature) return null;

  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(signature(payload));
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!session.staffId || session.expiresAt <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export async function requireStrictAdmin(req, res, supabase) {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Your secure session is missing or expired. Please sign in again." });
    return null;
  }

  const { data: staff, error } = await supabase
    .from("staffs")
    .select("id, role_id, approved, archive_at")
    .eq("id", session.staffId)
    .maybeSingle();

  if (error || !staff) {
    res.status(401).json({ error: "Your staff account could not be verified." });
    return null;
  }

  const isAdmin = Number(staff.role_id) === 1;
  if (!isAdmin || !staff.approved || staff.archive_at) {
    res.status(403).json({ error: "Access Denied: Administrator role is strictly required." });
    return null;
  }

  return staff;
}

export async function requireAdmin(req, res, supabase) {
  return requireStrictAdmin(req, res, supabase);
}

// --- START: REQUIRE ADMIN OR AUTHORIZED - checks staff session and permissions from staff_permissions table ---
export async function requireAdminOrAuthorized(req, res, supabase, requiredPerm = "edit_users") {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Your secure session is missing or expired. Please sign in again." });
    return null;
  }

  let staff = null;
  let sp = {};

  // Try permissions table first, fallback to staff_permissions
  const permQuery = await supabase
    .from("staffs")
    .select(`
      id, role_id, approved, archive_at,
      permissions!staff_id(
        edit_users, view_users, create_users, delete_users, view_other_offices
      )
    `)
    .eq("id", session.staffId)
    .maybeSingle();

  if (!permQuery.error && permQuery.data) {
    staff = permQuery.data;
    sp = Array.isArray(staff.permissions) ? (staff.permissions[0] ?? {}) : (staff.permissions ?? {});
  } else {
    const fallbackQuery = await supabase
      .from("staffs")
      .select(`
        id, role_id, approved, archive_at,
        staff_permissions!staff_id(
          edit_users, view_users, create_users, delete_users, view_other_offices
        )
      `)
      .eq("id", session.staffId)
      .maybeSingle();
    staff = fallbackQuery.data;
    sp = Array.isArray(staff?.staff_permissions) ? (staff?.staff_permissions[0] ?? {}) : (staff?.staff_permissions ?? {});
  }

  if (!staff) {
    res.status(401).json({ error: "Your staff account could not be verified." });
    return null;
  }

  const isAdmin = Number(staff.role_id) === 1;
  const isHr = Number(staff.role_id) === 2;
  const hasPerm = Boolean(sp[requiredPerm]) || Boolean(sp["edit_users"]);
  const isAuthorized = !staff.archive_at && staff.approved && (isAdmin || isHr || hasPerm);

  if (!isAuthorized) {
    res.status(403).json({ error: "You do not have permission to perform this administrative action." });
    return null;
  }

  return staff;
}
// --- END: REQUIRE ADMIN OR AUTHORIZED ---

// --- START: GET PORTAL REDIRECT URL ---
/**
 * Resolves the appropriate destination DOLE Portal dashboard URL based on the staff account.
 * - Admin (role_id === 1) → https://dole-portal.vercel.app/src/pages/user/admin/dashboard/
 * - Staff / Officer (role_id !== 1) → https://dole-portal.vercel.app/src/pages/user/staff/dashboard/
 *
 * @param {object} staff - Staff record or user payload
 * @returns {string} Fully qualified Portal destination URL
 */
export function getPortalRedirectUrl(staff = {}) {
  const roleId = Number(staff?.role_id);
  const roleStr = String(staff?.role || staff?.role_label || "").toLowerCase();
  const isAdmin = roleId === 1 || roleStr.includes("admin");

  const baseUrl = process.env.PORTAL_BASE_URL || "https://dole-portal.vercel.app";
  return isAdmin
    ? `${baseUrl.replace(/\/+$/, "")}/src/pages/user/admin/dashboard/`
    : `${baseUrl.replace(/\/+$/, "")}/src/pages/user/staff/dashboard/`;
}
// --- END: GET PORTAL REDIRECT URL ---

