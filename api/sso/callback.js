import { createSupabaseAdmin } from '../_lib/supabase-admin.js';
import { createSessionCookie } from '../_lib/session.js';

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
    const externalUserId = Number(consumed?.data?.external_user_id);
    if (!consumeResponse.ok || !Number.isSafeInteger(externalUserId) || externalUserId < 1) {
      return renderError(res, 'This SPES sign-in link is invalid, expired, or already used.');
    }

    const supabase = createSupabaseAdmin();
    const { data: staff, error } = await supabase
      .from('staffs')
      .select(`
        id, username, full_name, email, role_id, office_id, approved, archive_at,
        perm_view_users, perm_create_users, perm_edit_users, perm_delete_users,
        perm_export_reports, perm_view_other_offices, perm_view_global_stats,
        roles(name)
      `)
      .eq('id', externalUserId)
      .maybeSingle();
    if (error || !staff || staff.archive_at || !staff.approved) {
      return renderError(res, 'The assigned SPES account is no longer active.');
    }

    const displaySession = {
      id: Number(staff.id),
      username: staff.username,
      email: staff.email || '',
      full_name: staff.full_name || staff.username,
      role: Number(staff.role_id) === 1 ? 'admin' : 'officer',
      role_label: staff.roles?.name || (Number(staff.role_id) === 1 ? 'Administrator' : 'Officer'),
      role_id: Number(staff.role_id),
      office_id: staff.office_id ?? null,
      status: 'ONLINE',
      approved: true,
      permissions: {
        view_users: Boolean(staff.perm_view_users),
        create_users: Boolean(staff.perm_create_users),
        edit_users: Boolean(staff.perm_edit_users),
        delete_users: Boolean(staff.perm_delete_users),
        export_reports: Boolean(staff.perm_export_reports),
        view_other_offices: Boolean(staff.perm_view_other_offices),
        view_global_stats: Boolean(staff.perm_view_global_stats)
      }
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