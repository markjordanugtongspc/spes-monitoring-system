import { createSupabaseAdmin } from '../_lib/supabase-admin.js';
import { createSessionCookie, getPortalRedirectUrl } from '../_lib/session.js';

const portalConsumeUrl = () => String(process.env.PORTAL_SSO_CONSUME_URL || '').trim();
const portalClientSecret = () => String(process.env.PORTAL_SSO_CLIENT_SECRET || '').trim();

const safeJsonForScript = (value) => JSON.stringify(value)
  .replace(/</g, '\\u003c')
  .replace(/>/g, '\\u003e')
  .replace(/&/g, '\\u0026');

const renderError = (res, message) => {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`<!doctype html><title>SPES SSO</title><p>${message}</p><p><a href="/src/frontend/login/">Return to SPES login</a></p>`);
};

/* START SPES PORTAL SSO CALLBACK - Exchanges a Portal one-time code and starts the mapped SPES account session. */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const code = String(requestUrl.searchParams.get('code') || '');
  const state = String(requestUrl.searchParams.get('state') || '');
  if (!code || !state || !portalConsumeUrl() || !portalClientSecret()) {
    return renderError(res, 'This SPES SSO request is incomplete or not configured.');
  }

  try {
    const consumeResponse = await fetch(portalConsumeUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SSO-Client-Secret': portalClientSecret()
      },
      body: JSON.stringify({ system_key: 'SPES', code, state })
    });
    const consumed = await consumeResponse.json().catch(() => ({}));
    const payloadData = consumed?.data || {};
    const externalUserId = Number(payloadData.external_user_id);
    const incomingName = String(payloadData.full_name || payloadData.name || '').trim();
    const incomingUsername = String(payloadData.username || '').trim();
    const incomingEmail = String(payloadData.email || '').trim().toLowerCase();

    if (!consumeResponse.ok || (!Number.isSafeInteger(externalUserId) && !incomingName && !incomingUsername)) {
      return renderError(res, 'This SPES sign-in link is invalid, expired, or already used.');
    }

    const supabase = createSupabaseAdmin();
    let staff = null;

    // --- TWO-LOGIC FUNCTION: AUTOMATIC ASSIGNMENT BY DETECTED SAME NAME ---
    // LOGIC 1: Detect staff with the SAME NAME (case-insensitive) or matching email/username
    if (incomingName) {
      const { data: nameMatches } = await supabase
        .from('staffs')
        .select(`
          id, username, full_name, email, role_id, office_id, approved, archive_at,
          staff_permissions!staff_id(
            view_users, create_users, edit_users, delete_users,
            export_reports, view_other_offices, view_global_stats, view_payroll
          ),
          roles(name)
        `)
        .ilike('full_name', incomingName)
        .limit(1);

      if (nameMatches && nameMatches.length > 0) {
        staff = nameMatches[0];
      }
    }

    if (!staff && incomingEmail) {
      const { data: emailMatches } = await supabase
        .from('staffs')
        .select(`
          id, username, full_name, email, role_id, office_id, approved, archive_at,
          staff_permissions!staff_id(
            view_users, create_users, edit_users, delete_users,
            export_reports, view_other_offices, view_global_stats, view_payroll
          ),
          roles(name)
        `)
        .eq('email', incomingEmail)
        .limit(1);

      if (emailMatches && emailMatches.length > 0) {
        staff = emailMatches[0];
      }
    }

    if (!staff && incomingUsername) {
      const { data: userMatches } = await supabase
        .from('staffs')
        .select(`
          id, username, full_name, email, role_id, office_id, approved, archive_at,
          staff_permissions!staff_id(
            view_users, create_users, edit_users, delete_users,
            export_reports, view_other_offices, view_global_stats, view_payroll
          ),
          roles(name)
        `)
        .eq('username', incomingUsername)
        .limit(1);

      if (userMatches && userMatches.length > 0) {
        staff = userMatches[0];
      }
    }

    // LOGIC 2: If no staff with the same name was detected, skip assigning to any staff (never default to HR / ID 2)
    if (!staff) {
      return renderError(res, 'No registered SPES account was detected matching your name. Access is set to N/A. Please request an administrator to register and approve your account.');
    }

    if (staff.archive_at || !staff.approved) {
      return renderError(res, 'The assigned SPES account is pending approval or no longer active.');
    }

    const sp = Array.isArray(staff.staff_permissions)
      ? (staff.staff_permissions[0] ?? {})
      : (staff.staff_permissions ?? {});
    const roleId = Number(staff.role_id);
    const roleName = String(staff.roles?.name || "").trim().toLowerCase();
    let resolvedRole = 'officer';
    let resolvedLabel = 'Officer';
    if (roleId === 1 || roleName === 'admin') {
      resolvedRole = 'admin';
      resolvedLabel = 'Admin';
    } else if (roleId === 2 || roleName === 'hr') {
      resolvedRole = 'hr';
      resolvedLabel = 'HR';
    } else if (roleId === 4 || roleName === 'chief') {
      resolvedRole = 'chief';
      resolvedLabel = 'Chief';
    }

    const isHrOrAdmin = resolvedRole === 'admin' || resolvedRole === 'hr';
    const displaySession = {
      id: Number(staff.id),
      username: staff.username,
      email: staff.email || '',
      full_name: staff.full_name || staff.username,
      role: resolvedRole,
      role_label: staff.roles?.name || resolvedLabel,
      role_id: roleId,
      office_id: staff.office_id ?? null,
      status: 'ONLINE',
      approved: true,
      permissions: {
        view_users: isHrOrAdmin || Boolean(sp.view_users),
        create_users: isHrOrAdmin || Boolean(sp.create_users),
        edit_users: isHrOrAdmin || Boolean(sp.edit_users),
        delete_users: isHrOrAdmin || Boolean(sp.delete_users),
        export_reports: isHrOrAdmin || Boolean(sp.export_reports),
        view_other_offices: isHrOrAdmin || Boolean(sp.view_other_offices),
        view_global_stats: isHrOrAdmin || Boolean(sp.view_global_stats),
        view_payroll: isHrOrAdmin || Boolean(sp.view_payroll),
      },
      portal_url: getPortalRedirectUrl(staff)
    };

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Set-Cookie', createSessionCookie(staff));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).end(`<!doctype html><title>Opening SPES</title><script>sessionStorage.setItem('spes_session', JSON.stringify(${safeJsonForScript(displaySession)}));location.replace('/src/frontend/pages/dashboard/');</script>`);
  } catch (error) {
    console.error('[SPES SSO] Callback failed:', error.message);
    return renderError(res, 'SPES could not complete the Portal sign-in.');
  }
}
/* END SPES PORTAL SSO CALLBACK */