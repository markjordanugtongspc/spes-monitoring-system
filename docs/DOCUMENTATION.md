# 📘 SPES Monitoring System — Full Documentation

> **Version**: 4.0.x &nbsp;|&nbsp; **Last Updated**: September 2026 &nbsp;|&nbsp; 🟢 **Production**  
> **Repository**: [github.com/markjordanugtongspc/spes-monitoring-system](https://github.com/markjordanugtongspc/spes-monitoring-system)

---

## 📑 Table of Contents

1. [System Overview](#1--system-overview)
2. [Setup Instructions](#2--setup-instructions) _(→ README)_
3. [Database Schema](#3--database-schema)
4. [API Endpoints / Modules](#4--api-endpoints--modules)
5. [Frontend / Backend Structure](#5--frontend--backend-structure)
6. [Role-Based Access Control (RBAC)](#6--role-based-access-control-rbac)
7. [Version Control & Auto-Versioning](#7--version-control--auto-versioning)
8. [Deployment Guide](#8--deployment-guide)
9. [Troubleshooting & FAQ](#9--troubleshooting--faq)

---

## 1. 🏛️ System Overview

### What is SPES?

The **SPES (Special Program for the Employment of Students) Monitoring Web System** is a purpose-built enterprise web application developed for the **Department of Labor and Employment (DOLE)**. It streamlines the monitoring, management, and reporting of the SPES program — providing instant access to categorized data, beneficiary lists, and payroll tracking across regional and provincial offices in the Philippines.

> 🟢 **Production Status**: This system is **actively deployed and in production use** by DOLE offices. It has been serving live operations — managing real beneficiary data, processing payroll records, and generating official reports. Treat all changes with production-grade care; test thoroughly before deploying.

### Code Architecture (OOP with Sub-Children)

> **⚡ Important for Developers**: The entire codebase is written following an **Object-Oriented Programming (OOP) pattern with sub-child functions**. Each major module (e.g., `payroll.js`, `beneficiaries.js`, `dashboard.js`) is structured as a parent controller that initializes and orchestrates multiple **sub-child functions** — each handling a specific responsibility within the module.

For example, a page bootstrapper like `payroll.js` acts as the **parent** that calls sub-children:

```
payroll.js (Parent Controller)
  ├── initPayroll()               ← Master initializer
  │   ├── loadPayrollRecords()    ← Fetches & renders payroll table
  │   ├── computeBudgetSummary()  ← Calculates PAID/PENDING totals
  │   ├── renderExecutiveCards()  ← Populates stat cards
  │   ├── bindFilterListeners()   ← Attaches sort/filter handlers
  │   └── setupExportActions()    ← Wires Excel export buttons
  └── bootPayrollPage()           ← Page-level bootstrap (RBAC, theme, sidebar)
```

This pattern is consistent across **all modules** — the parent function initializes the page/feature, and sub-children handle granular tasks. Every function is annotated with `START` and `END` comments documenting its name and purpose, making the call hierarchy easy to trace.

### Purpose & Scope

| Objective | Description |
| :--- | :--- |
| **Beneficiary Monitoring** | Track registered SPES students, their demographic data, application files, and enrollment status. |
| **Payroll Management** | Monitor payroll records, track disbursement status (PAID/PENDING), compute budgets per-office and globally, and generate executive summary reports. |
| **User & Staff Management** | Manage implementors (officers/staff) with full CRUD operations — add, search, sort, filter by department or branch. |
| **Role-Based Access Control** | Granular, hierarchical permission system controlling access across the entire interface (Admin, HR, Chief, Officer, Student). |
| **Reports & Exports** | Export beneficiary lists, payroll data, and analytics reports in various formats (Excel via ExcelJS). |
| **CSV Auto-Import** | Bulk import CSV data directly into the PostgreSQL Supabase database with automatic field mapping, normalization, and duplicate protection. |
| **Analytics Dashboard** | Real-time interactive charts (ApexCharts) for distribution patterns, student intake, gender breakdowns, and regional timelines. |
| **Configurable Settings** | System-wide settings for office management, branding, and operational configurations. |

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        SPES Portal                               │
│  ┌────────────┐  ┌────────────────┐  ┌───────────────────────┐  │
│  │  Landing    │  │  Login (Auth)  │  │  Portal Pages         │  │
│  │  Page       │  │  Portal        │  │  (Dashboard, Payroll, │  │
│  │  (Public)   │  │                │  │  Beneficiaries, etc.) │  │
│  └─────┬──────┘  └───────┬────────┘  └──────────┬────────────┘  │
│        │                 │                       │               │
│  ┌─────┴─────────────────┴───────────────────────┴────────────┐  │
│  │                    Vite (Bundler & Dev Server)              │  │
│  │              TailwindCSS v4.2 + Flowbite UI                │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │        Serverless API Routes (/api/*)                      │  │
│  │   session · offices · permissions · batch · beacon · sso   │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │              Backend Service Layer                         │  │
│  │   auth.js · staff.js · beneficiary.js · payroll.js         │  │
│  │   payroll-db.js · permissions.js · settings.js             │  │
│  └────────────────────────┬───────────────────────────────────┘  │
│                           │                                      │
│  ┌────────────────────────┴───────────────────────────────────┐  │
│  │           Supabase (PostgreSQL + Auth + RLS)               │  │
│  │      Schema: spes  |  Hosted: Supabase Cloud               │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Bundler & Dev Server** | [Vite v8.x](https://vite.dev/) | Ultra-fast build tool and local development server |
| **Styling** | [TailwindCSS v4.2](https://tailwindcss.com/) + [Flowbite v4](https://flowbite.com/) | Utility-first CSS framework + premium UI component library |
| **Database & Auth** | [Supabase SDK v2.105](https://supabase.com/) | PostgreSQL database, user management, Row-Level Security (RLS) |
| **Charts** | [ApexCharts](https://apexcharts.com/) | High-fidelity interactive chart and graph rendering |
| **RBAC** | [@rbac/rbac v2.1](https://github.com/phellipeandrade/rbac) | Hierarchical Role-Based Access Control library |
| **Rich Text** | [Tiptap v3](https://tiptap.dev/) | WYSIWYG notepad editor for internal notes |
| **Excel Export** | [ExcelJS](https://github.com/exceljs/exceljs) | Generate `.xlsx` reports and data exports |
| **Alerts & Modals** | [SweetAlert2](https://sweetalert2.github.io/) + [Flowbite Modals](https://flowbite.com/) | Premium confirmation dialogs, toast notifications, and modal pop-ups |
| **Deployment** | [Vercel](https://vercel.com/) | Serverless hosting with edge functions |
| **Analytics** | [@vercel/analytics](https://vercel.com/analytics) | Web analytics integration |

---

## 2. 🛠️ Setup Instructions

> **📖 Full setup and installation instructions are maintained in the project README.**  
> **→ [Read the Setup Guide on GitHub](https://github.com/markjordanugtongspc/spes-monitoring-system#-developer-guide)**

The README covers everything you need to get started:
- Cloning the repository
- Installing dependencies (`npm install`)
- Configuring environment variables (`.env`)
- Running the development server (`npm run dev`)
- Running unit tests (`npm test`)
- Previewing builds locally and on LAN

> **⚠️ Important**: To obtain the full database credentials and Supabase access keys required for `.env` configuration, contact the project maintainer — **Mark Jordan Ugtong** (`markjordanugtongspc`).

---

## 3. 🗄️ Database Schema

The system uses **Supabase PostgreSQL** with a dedicated `spes` schema. All tables reside within this schema and are protected by Supabase **Row-Level Security (RLS)** policies.

### Core Tables

| Table | Purpose |
| :--- | :--- |
| `staff` | Stores implementor/officer accounts — credentials, roles, assigned office, and operational status (online/offline/busy) |
| `beneficiaries` | Registered SPES students — personal data, demographics, enrollment status, and application details |
| `offices` | DOLE regional/provincial offices — used for data scoping across the portal |
| `permissions` | Granular permission flags per staff member (view, create, edit, delete, export, view_global_stats, view_other_offices) |
| `payroll_records` | Individual payroll entries — linked to beneficiaries and offices, tracks disbursement amounts and status |
| `payroll_summary` | Aggregated payroll data per period — total budgets, paid vs. pending, office-level breakdowns |
| `settings` | System-wide configuration key-value pairs |
| `roles` | Role definitions with hierarchical inheritance |

### Key Relationships

```
staff ──────┬──── offices (staff.office_id → offices.id)
            └──── permissions (staff.id → permissions.staff_id)

beneficiaries ──── offices (beneficiaries.office_id → offices.id)

payroll_records ──── beneficiaries (payroll.beneficiary_id → beneficiaries.id)
                └──── offices (payroll.office_id → offices.id)
```

### Connection Details

- **Host**: `aws-1-ap-southeast-1.pooler.supabase.com`
- **Port**: `5432`
- **Database**: `postgres`
- **Schema**: `spes`
- **SSL**: Required (`sslmode=require`)

> **Note**: Direct database access requires the Service Role key. Contact the project maintainer for credentials.

---

## 4. 🔌 API Endpoints / Modules

### Serverless API Routes (`/api/*`)

These routes are deployed as Vercel Serverless Functions and emulated locally by the Vite dev server plugin.

| Route | Method(s) | Description |
| :--- | :--- | :--- |
| `/api/session` | `GET`, `POST` | Retrieve or create authenticated user sessions |
| `/api/offices` | `GET` | Fetch list of DOLE offices for dropdowns and data scoping |
| `/api/permissions` | `GET`, `POST` | Read/update granular permission flags for staff members |
| `/api/batch` | `POST` | Batch operations for bulk data processing (CSV import pipeline) |
| `/api/beacon` | `POST` | Heartbeat/presence tracking for online status indicators |
| `/api/sso/callback` | `GET` | SSO authentication callback from the DOLE Portal (`/sso/callback` is rewritten to this route) |

### Backend Service Modules (`src/backend/api/`)

These modules handle business logic and database interactions:

| Module | Purpose |
| :--- | :--- |
| `supabase.js` | Supabase client instantiation and configuration |
| `auth.js` | Staff authentication — login, logout, session management, credential validation |
| `staff.js` | Staff/implementor CRUD operations — create, read, update, delete, search, filter |
| `beneficiary.js` | Beneficiary management — registration, listing, search, CSV import processing |
| `payroll.js` | Payroll computation logic — PAID/PENDING calculations, budget aggregation, executive summaries |
| `payroll-db.js` | Payroll database operations — record insertion, updates, queries, period management |
| `permissions.js` | Permission flag management — RBAC permission reads/writes per staff member |
| `settings.js` | System settings CRUD — key-value configuration management |

### Authentication Flow

1. User submits credentials via the Login page
2. `auth.js` validates credentials against the `staff` table in Supabase
3. On success, a session object is created and stored in `localStorage`
4. The session includes: `id`, `email`, `full_name`, `role`, `role_id`, `office_id`, `permissions`, `avatar_url`
5. The RBAC guard (`guard.js`) checks the session on every page load and enforces permission boundaries

### SSO Integration

The portal supports Single Sign-On (SSO) with the DOLE Portal system:
- **Callback URL**: `/sso/callback` → Vercel rewrites to `/api/sso/callback`
- **Consumer URL**: Configurable via `PORTAL_SSO_CONSUME_URL` in `.env`
- **Client Secret**: Set via `PORTAL_SSO_CLIENT_SECRET` in `.env`

---

## 5. 📂 Frontend / Backend Structure

### Complete File Organization

```
SPES/
├── api/                            # Vercel Serverless Functions (production)
│   ├── _lib/                       # Shared utilities for API routes
│   ├── batch.js                    # Batch operations endpoint
│   ├── beacon.js                   # Presence/heartbeat endpoint
│   ├── offices.js                  # Office listing endpoint
│   ├── permissions.js              # Permission management endpoint
│   ├── session.js                  # Session management endpoint
│   └── sso/
│       └── callback.js             # SSO callback handler
│
├── dist/                           # Production build output (generated by `npm run build`)
│
├── scripts/                        # Build & utility scripts
│   ├── custom-version.mjs          # Auto-increment patch version on build
│   └── sync-version.mjs            # Sync version string to login page UI
│
├── src/
│   ├── backend/
│   │   ├── .env                    # Database credentials (gitignored — NEVER committed)
│   │   ├── .env.example            # Template for backend configuration
│   │   └── api/
│   │       ├── supabase.js         # Supabase client instantiation
│   │       ├── auth.js             # Authentication logic
│   │       ├── staff.js            # Staff/implementor CRUD
│   │       ├── beneficiary.js      # Beneficiary management
│   │       ├── payroll.js          # Payroll computation logic
│   │       ├── payroll-db.js       # Payroll database operations
│   │       ├── permissions.js      # Permission flag management
│   │       └── settings.js         # System settings management
│   │
│   └── frontend/
│       ├── assets/
│       │   ├── img/                # Images, logos, icons
│       │   ├── vids/               # Video assets
│       │   ├── styles/
│       │   │   └── tailwind.css    # Global TailwindCSS v4.2 stylesheet
│       │   └── js/
│       │       ├── main.js         # Main portal page bootstrapper
│       │       ├── dashboard.js    # Dashboard analytics controller
│       │       ├── payroll.js      # Payroll page bootstrapper
│       │       ├── exports.js      # Export functionality controller
│       │       ├── settings.js     # Settings page controller
│       │       ├── about.js        # About page controller
│       │       ├── landing.js      # Public landing page controller
│       │       ├── rbac/
│       │       │   ├── config.js   # RBAC role definitions & hierarchy
│       │       │   ├── guard.js    # Permission enforcement & page guards
│       │       │   └── scope.js    # Cross-office access scope resolution
│       │       └── components/
│       │           ├── auth.js             # Frontend auth handlers
│       │           ├── animations.js       # UI micro-animations
│       │           ├── beneficiaries.js    # Beneficiary table & interactions
│       │           ├── charts.js           # ApexCharts dashboard graphs
│       │           ├── drawer.js           # Off-canvas detail drawers
│       │           ├── modals.js           # Flowbite modal management
│       │           ├── notepad.js          # Tiptap rich-text notepad
│       │           ├── payroll.js          # Payroll table & computation UI
│       │           ├── payroll-export.js   # Payroll Excel export
│       │           ├── settings.js         # Settings UI handlers
│       │           ├── sort-filtration.js  # Table sorting & filtering
│       │           ├── theme-toggle.js     # Dark/Light mode toggle
│       │           ├── presence.js         # Online presence indicators
│       │           ├── storage.js          # Local storage utilities
│       │           └── analytics.js        # Vercel analytics integration
│       │
│       ├── components/             # Reusable HTML partials (injected at build time)
│       │   ├── header.html         # Navigation header
│       │   ├── sidebar.html        # Portal sidebar navigation
│       │   ├── footer.html         # Page footer
│       │   ├── notes.html          # Floating notepad component
│       │   ├── about.html          # About page partial
│       │   ├── contact.html        # Contact page
│       │   └── exports.html        # Export UI partial
│       │
│       ├── login/
│       │   └── index.html          # Authentication portal login page
│       │
│       ├── pages/
│       │   ├── dashboard/index.html       # Analytics Command Center
│       │   ├── implementors/index.html    # Staff/Officer management
│       │   ├── beneficiaries/index.html   # SPES student records
│       │   ├── payroll/index.html         # Payroll monitoring system
│       │   ├── roles/index.html           # RBAC role configuration
│       │   ├── exports/index.html         # Data export center
│       │   ├── settings/index.html        # System settings
│       │   └── about/index.html           # About the system
│       │
│       └── services/
│           └── beneficiary-csv-import-review.html  # CSV import review page
│
├── tests/                          # Unit test suite
│   ├── payroll.test.mjs
│   ├── payroll_dom_and_ui.test.mjs
│   ├── auth_rbac_roles.test.mjs
│   ├── rbac_exports_auth_fix.test.mjs
│   ├── security_and_notepad.test.mjs
│   └── lace_verification.test.mjs
│
├── supabase/                       # Supabase configuration (gitignored)
├── index.html                      # Public landing page
├── package.json                    # Scripts, metadata, and dependencies
├── vite.config.js                  # Vite build configuration with custom plugins
├── vercel.json                     # Vercel deployment rewrites
├── postcss.config.js               # PostCSS configuration
└── tailwind.config.js              # TailwindCSS configuration
```

### Frameworks & Conventions

| Area | Convention |
| :--- | :--- |
| **Styling** | TailwindCSS v4.2 utility classes; Flowbite components for modals, drawers, and toasts |
| **Dark Mode** | Zero-flash dark mode via `theme-toggle.js` with blocking pre-paint execution; preference persisted in `localStorage` |
| **Modals** | All pop-up modals use Flowbite Modal API via `modals.js` — centralized modal management |
| **Components** | HTML partials in `src/frontend/components/` are injected at build-time via the `spes-site-partials` Vite plugin using comment tokens (e.g., `<!-- SPES:SIDEBAR -->`) |
| **Module Pattern** | ES Modules throughout (`"type": "module"` in `package.json`); page bootstrappers import and initialize required components |
| **Code Comments** | Every function includes `START` and `END` comments with the function name and its main purpose |

---

## 6. 🔐 Role-Based Access Control (RBAC)

### Overview

The system implements **Hierarchical Role-Based Access Control** using the [`@rbac/rbac`](https://github.com/phellipeandrade/rbac) library. Roles are defined with specific permission grants and inheritance chains.

### Role Hierarchy

```
                    ┌─────────┐
                    │  admin  │  Full system control (system:*)
                    └────┬────┘
                         │ inherits
                    ┌────┴────┐
                    │   hr    │  User management, payroll, settings, reports
                    └────┬────┘
                    ┌────┴────┐
              ┌─────┤ officer ├─────┐
              │     └─────────┘     │
         ┌────┴────┐          ┌─────┴─────┐
         │  chief  │          │  student  │
         └─────────┘          └───────────┘
    Global read-only         Basic portal access
    executive view
```

### Role Definitions

| Role | ID | Permissions | Inherits |
| :--- | :--- | :--- | :--- |
| **student** | — | `dashboard:view`, `profile:view`, `profile:edit`, `attendance:view`, `attendance:create` | — |
| **officer** | 3 | `implementor-dashboard:view`, `attendance:verify`, `reports:view`, `beneficiaries:view` | `student` |
| **chief** | 4 | `reports:export`, `offices:view-other`, `analytics:view-global`, `payroll:view` | `officer` |
| **hr** | 2 | `roles:manage`, `users:*`, `offices:view-other`, `analytics:view-global`, `settings:manage`, `reports:export`, `beneficiaries:edit/delete`, `payroll:view/manage`, `services:manage/access` | `officer` |
| **admin** | 1 | `services:manage`, `services:access`, `system:*` (wildcard — full control) | `hr` |

### How RBAC Works in the System

1. **Role Definitions** — Defined in `rbac/config.js` using the `@rbac/rbac` library's curried function pattern
2. **Permission Check** — The `canDo(role, action)` helper function returns `true`/`false` for any role-action combination
3. **Page Guard** — `rbac/guard.js` runs on every page load:
   - Validates the user session exists and is not expired
   - Checks if the user's role has permission to access the current page
   - Hides/shows UI elements based on permissions (e.g., delete buttons only visible to admins)
   - Redirects unauthorized users to the login page
4. **Office Scope** — `rbac/scope.js` resolves cross-office access:
   - **Admin & HR**: Can view and manage all offices globally
   - **Chief**: Can view all offices globally but **cannot** edit/manage data (read-only executive view)
   - **Officer**: Can only view and manage their own assigned office
   - **Student**: Limited to their own profile and attendance

### Permission Format

Permissions follow the `resource:action` convention:
- `users:edit` — Edit user accounts
- `payroll:manage` — Create/modify payroll records
- `beneficiaries:view` — View beneficiary listings
- `system:*` — Wildcard: full access to all system resources

### RBAC Workflow Diagram

```
User Login
    │
    ▼
Session Created (role, role_id, office_id, permissions)
    │
    ▼
Page Load → guard.js → Check Session
    │                       │
    │                 ┌─────┴──────┐
    │                 │  Valid?     │
    │                 └─────┬──────┘
    │                  Yes  │  No → Redirect to Login
    │                       │
    ▼                       ▼
canDo(role, action) → rbac.can(role, action)
    │                       │
    │                 ┌─────┴──────┐
    │                 │ Allowed?   │
    │                 └─────┬──────┘
    │                  Yes  │  No → Hide Element / Block Action
    │                       │
    ▼                       ▼
Render Page with Role-Scoped UI
```

---

## 7. 🔄 Version Control & Auto-Versioning

### How Automatic Versioning Works

The SPES system uses an **automated Semantic Versioning (SemVer)** pipeline that triggers every time you run `npm run build`. Here's how it works step by step:

#### The Build Command Pipeline

```bash
npm run build
```

This is an alias for:

```bash
npm run version:patch && vite build
```

Which in turn executes:

```bash
node scripts/custom-version.mjs && node scripts/sync-version.mjs && vite build
```

#### Step 1 — Version Bump (`custom-version.mjs`)

The `custom-version.mjs` script:

1. Reads the current version from `package.json` (e.g., `4.0.3`)
2. Increments the **patch** number by 1 (→ `4.0.4`)
3. If the patch reaches `10`, it resets to `0` and increments **minor** (e.g., `4.0.9` → `4.1.0`)
4. If the minor reaches `10`, it resets to `0` and increments **major** (e.g., `4.9.9` → `5.0.0`)
5. Writes the new version to both `package.json` and `package-lock.json`

```
Example progression:
  4.0.3 → 4.0.4 → 4.0.5 → ... → 4.0.9 → 4.1.0 → ... → 4.9.9 → 5.0.0
```

#### Step 2 — Version Sync (`sync-version.mjs`)

The `sync-version.mjs` script:

1. Reads the updated version from `package.json`
2. Finds the `<p id="app-version">` element in `src/frontend/login/index.html`
3. Replaces the version text to display the new version on the login page (e.g., `v4.0.4`)

This ensures the version displayed in the UI always matches the `package.json` version.

#### Step 3 — Production Build (Vite)

Finally, Vite builds the production bundle to the `dist/` directory with:
- Minified JavaScript and CSS
- HTML partial injection (header, sidebar, footer, notes)
- Static asset copying (images, videos)
- The version is also exposed via `import.meta.env.VITE_APP_VERSION` for programmatic access

#### Manual Version Commands

For non-patch releases, use these manual commands:

| Command | Effect | Example |
| :--- | :--- | :--- |
| `npm run build` | Auto patch bump + build | `4.0.3` → `4.0.4` |
| `npm run version:minor` | Bump minor version | `4.0.4` → `4.1.0` |
| `npm run version:major` | Bump major version | `4.1.0` → `5.0.0` |

> **Note**: Running `npm run build` is the standard way to ensure version control updates before committing. The updated `package.json` and `package-lock.json` should be committed with your changes.

---

## 8. 🚀 Deployment Guide

### Local Development

```bash
# 1. Clone & install
git clone https://github.com/markjordanugtongspc/spes-monitoring-system.git
cd spes-monitoring-system
npm install

# 2. Configure environment
cp src/backend/.env.example src/backend/.env
# Edit src/backend/.env with your Supabase credentials

# 3. Start development server
npm run dev
# → Available at http://localhost:5174
```

### LAN Preview (Accessible from Other Devices)

To share the preview build with other devices on the same network:

```bash
npm run build
npm run preview:lan
# → Available at http://<your-ip>:5173
```

### Production Build

```bash
npm run build
```

This outputs a fully optimized static site to the `dist/` folder:
- Auto-bumps the patch version
- Minifies all JavaScript and CSS
- Copies static assets (images, videos)
- Injects HTML partials into all pages

### Vercel Deployment (Production)

The system is deployed on **Vercel** as a static site with serverless API functions.

**How it works:**

1. The `api/` folder at the project root contains Vercel Serverless Functions
2. The `dist/` folder (from `npm run build`) serves the static frontend
3. `vercel.json` configures URL rewrites (e.g., `/sso/callback` → `/api/sso/callback`)

**Deployment steps:**

1. Push your changes to the `main` branch on GitHub
2. Vercel automatically detects changes and triggers a new deployment
3. The build command on Vercel runs `npm run build`, which:
   - Bumps the version
   - Syncs the version to the login page
   - Generates the optimized `dist/` output

**Environment Variables on Vercel:**

Set these environment variables in the Vercel project dashboard under **Settings → Environment Variables**:

| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | ✅ | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Supabase publishable anon key |
| `VITE_SUPABASE_SCHEMA` | ✅ | Database schema name (`spes`) |
| `SUPABASE_URL` | ✅ | Supabase project URL (for serverless functions) |
| `SUPABASE_SERVICE_ROLE` | ✅ | Supabase service role key |
| `SUPABASE_SECRET_KEY` | ✅ | Supabase secret key |
| `SUPABASE_SCHEMA` | ✅ | Database schema name (`spes`) |
| `SUPABASE_DB_URL` | ✅ | Direct PostgreSQL connection string |
| `PORTAL_SSO_CONSUME_URL` | ⚡ | SSO consumer URL for DOLE Portal integration |
| `PORTAL_SSO_CLIENT_SECRET` | ⚡ | SSO client secret |

---

## 9. ❓ Troubleshooting & FAQ

### Common Issues

#### ❌ `Error: Cannot find module '@supabase/supabase-js'`
**Cause**: Dependencies not installed.  
**Fix**: Run `npm install` in the project root.

#### ❌ `VITE_SUPABASE_URL is not defined` / Supabase connection errors
**Cause**: Missing or misconfigured `.env` file.  
**Fix**:
1. Ensure `src/backend/.env` exists (copy from `.env.example`)
2. Verify all Supabase keys are correctly filled in
3. Contact the project maintainer for valid credentials

#### ❌ `Port 5174 is already in use`
**Cause**: Another process is using the same port.  
**Fix**: Kill the process using the port, or change the port in `vite.config.js` under `server.port`.

#### ❌ Page loads but shows blank / white screen
**Cause**: Typically a JavaScript import error or missing session.  
**Fix**:
1. Open browser DevTools (F12) → Console tab
2. Check for import errors or missing modules
3. Verify the user is logged in (session exists in localStorage)
4. Ensure `.env` variables are correctly prefixed with `VITE_` for frontend access

#### ❌ `npm run build` fails with version error
**Cause**: Corrupted `package.json` version string.  
**Fix**: Ensure `"version"` in `package.json` follows SemVer format (e.g., `"4.0.4"`).

#### ❌ RBAC blocks access to a page unexpectedly
**Cause**: User's role doesn't have the required permission.  
**Fix**:
1. Check the user's role in the session (`localStorage`)
2. Verify the role's permissions in `rbac/config.js`
3. Ensure the role inherits from the correct parent role

#### ❌ Dark mode flashes white on page load
**Cause**: Theme toggle script not executing before paint.  
**Fix**: The `theme-toggle.js` script uses a blocking pre-paint execution strategy. If this issue occurs, verify the script is loaded in the `<head>` of the HTML page with no `defer` or `async` attribute.

#### ❌ CSV import skips all records
**Cause**: All records already exist in the database (duplicate protection).  
**Fix**: The system pre-scans for duplicates by full name. If records should be re-imported, either archive the existing records first or modify the CSV data.

#### ❌ Tests fail with `Error: connect ECONNREFUSED`
**Cause**: Tests requiring live database access cannot connect.  
**Fix**: Ensure `src/backend/.env` is properly configured with valid Supabase credentials.

### FAQ

**Q: How do I get access credentials for the system?**  
A: Contact the project maintainer — Mark Jordan Ugtong (`markjordanugtongspc`). You will receive your Supabase keys and a staff account.

**Q: Can I run the system without Supabase?**  
A: No. The entire backend (auth, data, permissions) relies on Supabase PostgreSQL. A valid Supabase instance is required.

**Q: How do I add a new portal page?**  
A: Create a new folder in `src/frontend/pages/<page-name>/` with an `index.html`, add the corresponding entry in `vite.config.js` under `rollupOptions.input`, create a bootstrapper JS file, and add the sidebar link.

**Q: Where are the modals managed?**  
A: All pop-up modals use the Flowbite Modal API and are centrally managed in `modals.js` (`src/frontend/assets/js/components/modals.js`).

**Q: How do I create a new user role?**  
A: Add the role definition in `rbac/config.js` with its `can` permissions array and optional `inherits` array, then update the UI guards in `guard.js` accordingly.

**Q: What happens when I run `npm run build`?**  
A: It auto-increments the patch version, syncs the version to the login page UI, and generates an optimized production build in the `dist/` folder. See [Section 7](#7--version-control--auto-versioning) for the full breakdown.

---

> **📝 Maintained by**: Mark Jordan Ugtong — DOLE SPES Portal Team  
> **📧 Contact**: `markjordanugtongspc` on GitHub  
> **⚖️ License**: MIT
