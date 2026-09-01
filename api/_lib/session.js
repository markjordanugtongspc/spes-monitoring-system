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

export async function requireAdmin(req, res, supabase) {
  return requireAdminOrAuthorized(req, res, supabase, "perm_edit_users");
}

export async function requireAdminOrAuthorized(req, res, supabase, requiredPerm = "perm_edit_users") {
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: "Your secure session is missing or expired. Please sign in again." });
    return null;
  }

  const { data: staff, error } = await supabase
    .from("staffs")
    .select("id, role_id, approved, archive_at, perm_edit_users, perm_view_users, perm_create_users, perm_delete_users, perm_view_other_offices")
    .eq("id", session.staffId)
    .maybeSingle();

  if (error || !staff) {
    res.status(401).json({ error: "Your staff account could not be verified." });
    return null;
  }

  const isAdmin = Number(staff.role_id) === 1;
  const hasPerm = Boolean(staff[requiredPerm]) || Boolean(staff.perm_edit_users);
  const isAuthorized = !staff.archive_at && staff.approved && (isAdmin || hasPerm);

  if (!isAuthorized) {
    res.status(403).json({ error: "You do not have permission to perform this administrative action." });
    return null;
  }

  return staff;
}

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

