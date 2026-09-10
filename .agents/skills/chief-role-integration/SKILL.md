---
name: chief-role-integration
description: >
  Standard operating procedure and architectural guide for integrating the "Chief" database
  role (ID 4) as a Global Read-Only Executive and standardizing HR (ID 2) as Global Multi-Office
  across DOLE Portal, GIP, and SPES subsystems.
---

# Chief Role & Executive RBAC Integration Guide

This skill provides comprehensive architectural standards and step-by-step implementation instructions for integrating the **Chief** role (`id: 4`, `name: "Chief"`) as a **Global Read-Only Executive** and updating **HR** (`id: 2`, `name: "HR"`) as **Global Multi-Office Executive** across the DOLE Portal, GIP (Government Internship Program), and SPES systems.

---

## 1. Executive Role Hierarchy & Capability Matrix

| Role | Role ID | Office Scope | Read / Search / Filter | Export / Print | Create Support Tickets | Mutate / Edit / Delete / Archive |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Admin** | `1` | `null` (Global / N/A) | ✅ All Offices & Systems | ✅ Yes | ✅ Yes | ✅ Full System Access |
| **HR** | `2` | `null` (Global / N/A) | ✅ All Offices & Rosters | ✅ Yes | ✅ Yes | ✅ Staff, Roles & Rosters |
| **Chief** | `4` | `null` (Global / N/A) | ✅ **All Offices & Rosters** | ✅ **Yes** | ✅ **Yes** | ❌ **Strictly Prohibited** |
| **Officer** | `3` | Assigned Office | 🔒 Own Office Only | 🔒 Own Office | ✅ Yes | 🔒 Own Office (if permitted) |

> [!IMPORTANT]
> - **HR (`role_id: 2`):** Is a **Global Regional Role**. HR is not bound to a single local municipal office; their `office_id` MUST be stored as `null` (displaying as `N/A (Global)`), preventing conflicts with local designated implementors.
> - **Chief (`role_id: 4`):** Possesses **Complete Global Read-Only Oversight**. The Chief can inspect all implementor rosters, beneficiary directories, GIP batches, analytics charts, payroll allocations, and generate exports/tickets, but **CANNOT** create, modify, archive, delete, or disburse records.

---

## 2. Database Tier (PostgreSQL / Supabase)

### 2.1 `roles` Table Insertion
The system uses static integer identifiers for core roles to ensure deterministic RBAC resolution across all connected portals:
- `1`: **Admin**
- `2`: **HR**
- `3`: **Officer** / **Staff**
- `4`: **Chief**

```sql
-- Ensure Chief role exists with ID 4
INSERT INTO roles (id, name)
VALUES (4, 'Chief')
ON CONFLICT (id) DO UPDATE 
SET name = EXCLUDED.name;
```

### 2.2 Automatic Office N/A Nullification
When a user is assigned or updated to **Admin** (1), **HR** (2), or **Chief** (4), `office_id` must be set to `NULL`:

```sql
-- Align existing Executive accounts in database
UPDATE staffs
SET office_id = NULL
WHERE role_id IN (1, 2, 4);
```

---

## 3. Frontend RBAC Configuration (`config.js`)

Define the role hierarchy and capability tokens. The Chief inherits basic viewing capabilities from the officer role and gains global viewing/exporting rights, but does **NOT** receive mutation tokens:

```javascript
// --- START: RBAC ROLES CONFIGURATION ---
export const ROLES = {
  admin: {
    label: "Administrator",
    permissions: ["*"], // Global bypass
  },
  hr: {
    inherits: "officer",
    label: "HR",
    permissions: [
      "users:view", "users:create", "users:edit", "users:delete",
      "reports:export", "offices:view-other", "analytics:view-global", "payroll:view"
    ],
  },
  chief: {
    inherits: "officer",
    label: "Chief",
    permissions: [
      "reports:export",        // Global Excel & Print exports
      "offices:view-other",     // Cross-office roster visibility
      "analytics:view-global",  // Global dashboard statistics
      "payroll:view",          // Global payroll oversight
      "tickets:create"         // Support ticket creation
    ],
  },
  officer: {
    label: "Officer",
    permissions: [
      "beneficiaries:view",
      "reports:view",
      "tickets:create"
    ],
  },
};
// --- END: RBAC ROLES CONFIGURATION ---
```

---

## 4. Office Access Scope Resolver (`scope.js`)

In multi-office subsystems (SPES, GIP, Portal), data is office-scoped by default unless the user is an **Executive** (Admin, HR, Chief). However, only Admin and HR possess mutation authority (`canManageOffice`):

```javascript
// --- START: OFFICE ACCESS SCOPE FUNCTION ---
export function getOfficeAccessScope(session = {}) {
  const role = String(session?.role || "").trim().toLowerCase();
  const roleId = Number(session?.role_id);

  const isAdmin = role === "admin" || roleId === 1;
  const isHr = role === "hr" || roleId === 2;
  const isChief = role === "chief" || roleId === 4;
  const isExecutive = isAdmin || isHr || isChief;
  const isOfficer = role === "officer" || roleId === 3;
  const permissions = session?.permissions || {};
  const ownOfficeId = session?.office_id ?? null;

  return {
    isAdmin,
    isHr,
    isChief,
    isExecutive,
    isOfficer,
    ownOfficeId,
    // Admin, HR, and Chief can inspect all global stats and other offices.
    canViewGlobalStats: isExecutive || Boolean(permissions.view_global_stats),
    canViewOtherOffices: isExecutive || Boolean(permissions.view_other_offices),
    
    // Mutation authority: Chief is strictly read-only and cannot mutate office records.
    canManageOffice(targetOfficeId) {
      if (isChief) return false; // Chief is strictly global read-only
      if (isAdmin || isHr) return true;
      if (isOfficer) {
        if (targetOfficeId == null) return true;
        if (ownOfficeId == null) return false;
        return String(ownOfficeId) === String(targetOfficeId);
      }
      if (Boolean(permissions.view_other_offices)) return true;
      if (targetOfficeId == null) return true;
      if (ownOfficeId == null) return false;
      return String(ownOfficeId) === String(targetOfficeId);
    },
  };
}
// --- END: OFFICE ACCESS SCOPE FUNCTION ---
```

---

## 5. Dynamic DOM Permissions Guard (`guard.js`)

Ensure mutation buttons (Add Implementor, Edit, Delete, Payroll Manage, Roles Manage) remain hidden or disabled for Chief:

```javascript
// Map permission strings used in HTML -> evaluator functions
const DB_PERM_MAP = {
  // Viewing permissions: Open to Chief
  "beneficiaries:view":  (_p, session) => session?.approved === true,
  "users:view":          (p, session) => session?.approved === true && (isHrOrAdmin(session) || isChief(session) || Boolean(p?.view_users)),
  "payroll:view":        (p, session) => session?.approved === true && (isHrOrAdmin(session) || isChief(session) || Boolean(p?.view_payroll)),
  "offices:view-other":   (p, session) => session?.approved === true && (isHrOrAdmin(session) || isChief(session) || Boolean(p?.view_other_offices)),
  "analytics:view-global":(p, session) => session?.approved === true && (isHrOrAdmin(session) || isChief(session) || Boolean(p?.view_global_stats)),
  "reports:export":      (_p, session) => session?.approved === true,

  // Mutation permissions: Strictly denied to Chief
  "beneficiaries:create": (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.create_beneficiaries)),
  "beneficiaries:edit":   (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.edit_beneficiaries)),
  "beneficiaries:delete": (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.delete_beneficiaries)),
  "users:create":        (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.create_users)),
  "users:edit":          (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.edit_users)),
  "users:delete":        (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.delete_users)),
  "payroll:manage":      (p, session) => session?.approved === true && !isChief(session) && (isHrOrAdmin(session) || Boolean(p?.view_payroll)),
  "roles:manage":        (p, session) => session?.approved === true && isHrOrAdmin(session) && !isChief(session),
  "services:manage":     (_p, session) => session?.approved === true && (String(session?.role || "").toLowerCase() === "admin" || Number(session?.role_id) === 1),
};
```

---

## 6. Table Pinning Order (Admin -> Chief -> HR)

Across all directory tables (Roles, Implementors, Beneficiaries), maintain deterministic top-pinned ranking:

```javascript
// --- START: PIN SYSTEM ADMINISTRATOR FIRST ---
function pinSystemAdministratorFirst(items, shouldPin, groupApproval = false) {
  const ordered = [...items];
  if (!shouldPin) return ordered;

  const pinned = [];
  const pinnedIds = new Set();
  const takeFirst = (predicate) => {
    const index = ordered.findIndex((item) => !pinnedIds.has(String(item.id)) && predicate(item));
    if (index >= 0) {
      const [item] = ordered.splice(index, 1);
      pinned.push(item);
      pinnedIds.add(String(item.id));
    }
  };

  // 1. Position 1: System Administrator
  takeFirst((item) => Number(item.role_id) === 1 || String(item.role || "").toUpperCase() === "ADMIN");

  // 2. Position 2: Chief Role
  takeFirst((item) => Number(item.role_id) === 4 || String(item.role || "").toUpperCase() === "CHIEF" || String(item.username || "").toLowerCase().includes("chief"));

  // 3. Position 3: HR / Lace Torregosa Arellano
  takeFirst((item) => Number(item.role_id) === 2 || String(item.role || "").toUpperCase() === "HR" || String(item.username || "").toLowerCase().includes("lace"));

  if (!groupApproval) return [...pinned, ...ordered];

  const approved = ordered
    .filter((item) => item.approved === true)
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));
  const unapproved = ordered
    .filter((item) => item.approved !== true)
    .sort((a, b) => String(a.full_name || "").localeCompare(String(b.full_name || "")));

  return [...pinned, ...approved, ...unapproved];
}
// --- END: PIN SYSTEM ADMINISTRATOR FIRST ---
```

---

## 7. Roles & Permissions Table Matrix (`roles/index.html`)

On the Roles page:
- **Admin (`role_id: 1`):** All permissions checked, row toggle disabled.
- **HR (`role_id: 2`):** All permissions automatically checked upon approval, row toggle disabled.
- **Chief (`role_id: 4`):** Listed in **Rank 3** (read-only):
  - Viewing permissions (`users:view`, `offices:view-other`, `analytics:view-global`, `reports:export`, `payroll:view`) are **checked**.
  - Mutation permissions (`users:create`, `users:edit`, `users:delete`) are **unchecked**.
  - Checkboxes and Clear Permissions buttons are **disabled** (`disabled`, `opacity-50`, `cursor-not-allowed`).
  - Tooltip: `"Chief role has global read-only permissions."`

---

## 8. Realtime Permission & Presence Sync (No-Reload Pattern)

To avoid infinite modal loops and high CPU usage:
1. Target `table: "staff_permissions"` with filter `staff_id=eq.${session.id}` (NOT `staffs`).
2. Exclude Executives (`isAdmin || isHr || isChief`) from individual permission polling.
3. Apply permissions in-place using `await applyPermissions(session.role)` instead of `window.location.reload()`.

---

## 9. Checklist for Porting to Portal & GIP

- [ ] Insert `(4, 'Chief')` in PostgreSQL `roles` table.
- [ ] Set `office_id = NULL` for all Admin (1), HR (2), and Chief (4) accounts in `staffs`.
- [ ] Add `chief` definition to `ROLES` in `config.js` (with viewing and reporting permissions only).
- [ ] Update `getOfficeAccessScope` in `scope.js`: set `canViewOtherOffices: true`, `canViewGlobalStats: true`, but `canManageOffice: false` for Chief.
- [ ] Update `_mapToRbacRole` in `auth.js` to map `4` and `"chief"` to `"chief"`.
- [ ] In `guard.js`, add `isChief(session)` and disallow mutation permissions (`users:create`, `users:edit`, `users:delete`, `beneficiaries:create`, `beneficiaries:edit`, `beneficiaries:delete`, `payroll:manage`, `roles:manage`).
- [ ] Update `pinSystemAdministratorFirst` to guarantee sequence: 1. Admin, 2. HR, 3. Chief.
- [ ] Update Roles matrix to display Chief with read-only badges and disabled checkboxes.
- [ ] Verify Configure Reports / Analytics data loaders check `isExecutive` before applying `office_id` scopes.
- [ ] Ensure Payroll allows global office selection and export for Chief while keeping editing read-only.
- [ ] Add unit tests verifying `canDo("chief", ...)`, `getOfficeAccessScope({ role: "chief", role_id: 4 })`, and payroll export scopes.
