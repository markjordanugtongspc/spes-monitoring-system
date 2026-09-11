import { createClient } from '@supabase/supabase-js';
import { createSessionCookie } from '../_lib/session.js';

// Executive roles that have global scope and valid null office_id
const EXECUTIVE_ROLE_IDS = new Set([1, 2, 4]); // 1 = Admin, 2 = HR, 4 = Chief

/* START CREATE SPES SUPABASE ADMIN CLIENT - Initializes privileged Supabase client for SSO verification */
const createSpesAdmin = () => {
    const url = process.env.SPES_SUPABASE_URL || process.env.VITE_SPES_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://pprmqnrevuyllhkxejbu.supabase.co';
    const serviceKey = process.env.SPES_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SPES_SUPABASE_ANON_KEY || process.env.VITE_SPES_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBwcm1xbnJldnV5bGxoa3hlamJ1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTc2ODI3MywiZXhwIjoyMDk1MzQ0MjczfQ.PzskDM5K_6kIwk4cas91gR0285bxxP631V5ZzZRRqkk';
    if (!url || !serviceKey) {
        throw new Error('SPES Supabase credentials are not configured in environment variables.');
    }
    return createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
};
/* END CREATE SPES SUPABASE ADMIN CLIENT */

/* START CONSUME PORTAL SSO TOKEN - Validates authorization code with Portal SSO API */
const consumePortalToken = async (code, state) => {
    let portalBaseUrl = (process.env.PORTAL_SSO_CONSUME_URL || process.env.PORTAL_API_URL || process.env.PORTAL_URL || 'https://dole-portal.vercel.app').replace(/\/$/, '');
    if (portalBaseUrl.includes('localhost:5173')) {
        portalBaseUrl = 'https://dole-portal.vercel.app';
    }
    const consumeEndpoint = portalBaseUrl.endsWith('/api/sso/consume') ? portalBaseUrl : `${portalBaseUrl}/api/sso/consume`;
    const clientSecret = (
        process.env.PORTAL_SSO_CLIENT_SECRET ||
        process.env.SSO_SPES_CLIENT_SECRET ||
        process.env.SPES_CLIENT_SECRET ||
        process.env.PORTAL_CLIENT_SECRET ||
        process.env.SSO_CLIENT_SECRET ||
        'yKPrAiC3YVJ6Au5nKInSzq7HzcYwqfnjv4f9EeZ4um92aq0hq4vAInaYtV2LJluD'
    ).trim();
    
    const response = await fetch(consumeEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-sso-client-secret': clientSecret,
            'X-SSO-Client-Secret': clientSecret
        },
        body: JSON.stringify({
            system_key: 'SPES',
            code: String(code || '').trim(),
            state: String(state || '').trim()
        })
    });
    
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data) {
        throw new Error(payload?.error || `Portal SSO validation failed with HTTP ${response.status}.`);
    }
    return payload.data;
};
/* END CONSUME PORTAL SSO TOKEN */

/* START RESOLVE SPES STAFF ACCOUNT - Finds active, approved staff record matching Portal identity */
const resolveSpesStaff = async (admin, identity = {}) => {
    const externalUserId = identity.external_user_id || identity.id || identity.user_id;
    const externalUsername = identity.external_username || identity.username;
    const externalFullName = identity.external_full_name || identity.full_name || identity.name;
    const externalEmail = identity.external_email || identity.email;

    const selectFields = `
        id, full_name, username, email, role_id, office_id, status, approved, archive_at,
        roles(id, name),
        offices(id, name, location),
        staff_permissions(view_users, create_users, edit_users, delete_users, export_reports, view_other_offices, view_global_stats, view_payroll)
    `;

    // 1. Try resolving by explicit SPES staff ID
    if (externalUserId && !isNaN(Number(externalUserId))) {
        const { data: staffById } = await admin
            .from('staffs')
            .select(selectFields)
            .eq('id', Number(externalUserId))
            .is('archive_at', null)
            .maybeSingle();
        if (staffById) return staffById;
    }

    // 2. Fallback: Try resolving by username
    if (externalUsername) {
        const { data: staffByUsername } = await admin
            .from('staffs')
            .select(selectFields)
            .eq('username', String(externalUsername).trim())
            .is('archive_at', null)
            .maybeSingle();
        if (staffByUsername) return staffByUsername;
    }

    // 3. Fallback: Try resolving by exact or case-insensitive full name
    if (externalFullName) {
        const { data: staffByName } = await admin
            .from('staffs')
            .select(selectFields)
            .ilike('full_name', String(externalFullName).trim())
            .is('archive_at', null)
            .maybeSingle();
        if (staffByName) return staffByName;
    }

    // 4. Fallback: Try resolving by email
    if (externalEmail) {
        const { data: staffByEmail } = await admin
            .from('staffs')
            .select(selectFields)
            .eq('email', String(externalEmail).trim().toLowerCase())
            .is('archive_at', null)
            .maybeSingle();
        if (staffByEmail) return staffByEmail;
    }

    return null;
};
/* END RESOLVE SPES STAFF ACCOUNT */

/* START RENDER ERROR HTML PAGE - Renders professional styled error page with Tailwind classes */
const renderErrorPage = (res, title, message) => {
    const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title} - SPES Monitoring</title>
            <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        </head>
        <body class="bg-gray-50 flex items-center justify-center min-h-screen p-4 dark:bg-gray-900 font-sans">
            <div class="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 p-6 sm:p-8 text-center">
                <div class="w-14 h-14 bg-red-100 dark:bg-red-950/50 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg class="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h1 class="text-xl font-bold text-gray-900 dark:text-white mb-2">${title}</h1>
                <p class="text-sm text-gray-600 dark:text-gray-300 leading-relaxed mb-6">${message}</p>
                <div class="space-y-3">
                    <a href="/src/frontend/login/" class="cursor-pointer inline-flex items-center justify-center w-full px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-300">
                        Return to SPES Login
                    </a>
                </div>
            </div>
        </body>
        </html>
    `;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (res.status && typeof res.status === 'function') {
        res.status(401);
    } else {
        res.statusCode = 401;
    }
    if (res.send && typeof res.send === 'function') {
        return res.send(html);
    }
    return res.end(html);
};
/* END RENDER ERROR HTML PAGE */

/* START SPES SSO CALLBACK HANDLER - Main route handler for receiving and finalizing SSO login */
export default async function handler(req, res) {
    // Extract query parameters across Vercel Serverless and Vite dev middleware
    let code = req.query?.code;
    let state = req.query?.state;
    if (!code || !state) {
        try {
            const parsedUrl = new URL(req.url || '/', 'http://localhost');
            code = code || parsedUrl.searchParams.get('code');
            state = state || parsedUrl.searchParams.get('state');
        } catch {}
    }

    if (!code || !state) {
        return renderErrorPage(res, 'Invalid Authorization Request', 'Missing required SSO authorization code or state token.');
    }

    try {
        const admin = createSpesAdmin();

        // 1. Consume token with DOLE Portal backend
        const portalIdentity = await consumePortalToken(code, state);

        // 2. Resolve SPES staff record
        const staff = await resolveSpesStaff(admin, portalIdentity);
        if (!staff) {
            const displayName = portalIdentity.external_full_name || portalIdentity.full_name || portalIdentity.external_username || portalIdentity.username || 'this user';
            return renderErrorPage(
                res,
                'Account Not Found',
                `No registered SPES account was detected for "${displayName}". Please request an administrator to register your account.`
            );
        }

        // 3. Verify Approval Status
        if (staff.approved !== true) {
            return renderErrorPage(
                res,
                'Account Pending Approval',
                `Your SPES account (${staff.full_name || staff.username}) is registered but currently awaiting administrator approval. Please contact a SPES Administrator.`
            );
        }

        // 4. Validate Role and Office scope
        const roleId = Number(staff.role_id);
        const isExecutive = EXECUTIVE_ROLE_IDS.has(roleId);

        // Officers (role_id: 3) must have an assigned office, whereas Executives (1, 2, 4) do not
        if (!isExecutive && !staff.office_id) {
            return renderErrorPage(
                res,
                'Office Assignment Required',
                `Your account is approved as an Officer, but has no designated municipal office assigned. Please contact an administrator to assign your office.`
            );
        }

        // 5. Update Online Status in SPES
        await admin
            .from('staffs')
            .update({ status: 'ONLINE', updated_at: new Date().toISOString() })
            .eq('id', staff.id);

        // 6. Build Permissions & Client Session Object
        const sp = Array.isArray(staff.staff_permissions)
            ? (staff.staff_permissions[0] ?? {})
            : (staff.staff_permissions ?? {});
        
        const isChief = roleId === 4;
        const resolvedRole = staff.roles?.name?.toLowerCase() || (roleId === 1 ? 'admin' : roleId === 2 ? 'hr' : roleId === 4 ? 'chief' : 'officer');
        const resolvedRoleLabel = staff.roles?.name || (roleId === 1 ? 'Admin' : roleId === 2 ? 'HR' : roleId === 4 ? 'Chief' : 'Officer');

        const permissions = isExecutive ? {
            view_users: true,
            create_users: !isChief,
            edit_users: !isChief,
            delete_users: !isChief,
            export_reports: true,
            view_other_offices: true,
            view_global_stats: true,
            view_payroll: true,
        } : {
            view_users: Boolean(sp.view_users),
            create_users: Boolean(sp.create_users),
            edit_users: Boolean(sp.edit_users),
            delete_users: Boolean(sp.delete_users),
            export_reports: Boolean(sp.export_reports),
            view_other_offices: Boolean(sp.view_other_offices),
            view_global_stats: Boolean(sp.view_global_stats),
            view_payroll: Boolean(sp.view_payroll),
        };

        const sessionUser = {
            id: staff.id,
            role_id: staff.role_id,
            role: resolvedRole,
            role_label: resolvedRoleLabel,
            full_name: staff.full_name || staff.username,
            username: staff.username,
            email: staff.email || '',
            office_id: staff.office_id || null,
            office_name: staff.offices?.name || (isExecutive ? 'Global / Regional' : 'N/A'),
            approved: true,
            is_executive: isExecutive,
            permissions
        };

        // 7. Serialize session to cookies
        const sessionJson = JSON.stringify(sessionUser);
        const encodedSession = Buffer.from(sessionJson).toString('base64');
        const targetDashboardUrl = '/src/frontend/pages/dashboard/';

        const cookies = [
            `spes_session=${encodedSession}; Path=/; SameSite=Lax; Max-Age=86400; HttpOnly`,
            `spes_user=${encodeURIComponent(sessionJson)}; Path=/; SameSite=Lax; Max-Age=86400`,
            createSessionCookie(staff)
        ];

        res.setHeader('Set-Cookie', cookies);
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');

        const safeSession = sessionJson.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
        
        return res.end(`<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Opening SPES Portal...</title>
</head>
<body style="background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
    <p>Authenticating session and opening SPES...</p>
    <script>
        try {
            const sessionData = ${safeSession};
            localStorage.setItem('spes_session', JSON.stringify(sessionData));
            sessionStorage.setItem('spes_session', JSON.stringify(sessionData));
        } catch (e) {}
        window.location.replace('${targetDashboardUrl}');
    </script>
</body>
</html>`);
    } catch (error) {
        console.error('[SPES SSO CALLBACK ERROR]:', error.message);
        return renderErrorPage(res, 'SSO Authentication Failed', error.message || 'An unexpected error occurred during SPES SSO authentication.');
    }
}
/* END SPES SSO CALLBACK HANDLER */