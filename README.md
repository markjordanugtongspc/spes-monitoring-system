# 🇵🇭 DOLE SPES Portal — Command Center Edition

[![Licence](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Vite](https://img.shields.io/badge/Vite-v8.0-646CFF.svg?logo=vite)](https://vite.dev)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-v4.2-38B2AC.svg?logo=tailwind-css)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-v2.105-3ECF8E.svg?logo=supabase)](https://supabase.com)

The **DOLE SPES Portal (Special Program for Employment of Students)** is a state-of-the-art enterprise command center and management system. It serves as a high-performance web application designed to streamline SPES implementation, manage beneficiary databases, configure staff roles, and track live statistics across regional and provincial offices in the Philippines.

---

## 🚀 Key Features

*   **Premium Analytics Command Center**: Real-time interactive charts (ApexCharts) representing distribution patterns, student intake records, gender breakdowns, and regional timelines.
*   **Role-Based Access Control (RBAC)**: Secure, granular permissions implementation controlling CRUD access across the whole interface (Admin vs. Officer/Staff).
*   **Vibrant, Fluid Design System**: Rich, premium aesthetics leveraging **Tailwind CSS v4.2**, supporting dynamic animations, sleek card layouts, and zero-flash Dark Mode persistence (`theme-toggle` + blocking pre-paint execution).
*   **Flowbite Skeleton Loaders**: Polished visual skeletons for asynchronous operations, table rows, and dashboard metrics that resolve seamlessly when data loads.
*   **Enterprise Integrations**: Powered by a secure **Supabase (PostgreSQL)** backend with serverless API routes deployed on **Vercel**.

---

## 🛠️ Technology Stack

| Component | Technology | Description |
| :--- | :--- | :--- |
| **Framework & Bundler** | [Vite](https://vite.dev/) | Ultra-fast build tool and local development server |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) & [Flowbite](https://flowbite.com/) | Modern CSS classes & premium component UI library |
| **Database & Auth** | [Supabase SDK](https://supabase.com/) | Live PostgreSQL database, user management, and security RLS |
| **Data Visualization**| [ApexCharts](https://apexcharts.com/) | High-fidelity interactive chart and graph rendering |
| **Pop-ups & Feedback**| [Flowbite](https://flowbite.com/) | Off-canvas drawers, toast notifications, and modal dialogs |

---

## 📁 Repository Structure

```filepath
SPES/
├── .agents/                 # AI Assistant workspace configurations
├── api/                     # Vercel Serverless Functions (production)
├── scripts/                 # Utility scripts (version bumping, asset sync)
├── src/
│   ├── backend/             # Database and Auth services
│   │   ├── api/
│   │   │   ├── auth.js      # Backend staff auth and operations logic
│   │   │   └── supabase.js  # Supabase client instantiation
│   │   ├── .env             # Database credentials (gitignored — never committed)
│   │   └── .env.example     # Template for backend configuration
│   └── frontend/            # Web assets, styles, components, and pages
│       ├── assets/          # Static files (images, icons, styles, vanilla components)
│       │   ├── js/          # Shared components (modals, charts, theme handlers)
│       │   └── styles/      # Global styling sheet & Tailwind configs
│       ├── components/      # Reusable HTML snippets (Sidebar, header templates)
│       ├── login/           # Authentication portal page
│       └── pages/           # Internal views (Dashboard, Implementors, Roles, Beneficiaries, Payroll)
├── tests/                   # Unit test suite (Node built-in test runner)
│   ├── payroll.test.mjs             # Payroll calculation & logic tests
│   └── payroll_dom_and_ui.test.mjs  # Payroll DOM structure & UI element tests
├── package.json             # Scripts, metadata, and dependencies
└── README.md                # General project documentation (This file)
```

---

## 💻 Developer Guide

> **📘 Full system documentation** (architecture, RBAC, API endpoints, database schema, deployment, and more) is available in [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

Follow these steps to run, develop, or package the SPES application locally.

### Prerequisites
*   [Node.js](https://nodejs.org/) (v18.x or higher recommended)
*   [npm](https://www.npmjs.com/) (v9.x or higher)

### Setup & Installation

1.  **Clone the Repository**
    ```bash
    git clone https://github.com/markjordanugtongspc/spes-monitoring-system.git
    cd spes-monitoring-system
    ```

2.  **Install Dependencies**
    ```bash
    npm install
    ```
    This installs both production dependencies (Supabase SDK, Flowbite, ApexCharts, RBAC, ExcelJS, etc.) and development dependencies (Vite, TailwindCSS, PostCSS).

3.  **Configure Environment Variables**
    Copy the example environment template in `src/backend` and fill in your Supabase project keys:
    ```bash
    cp src/backend/.env.example src/backend/.env
    ```
    Open `src/backend/.env` and configure the following:
    ```env
    # ── Server ────────────────────────────────────────────────────
    PORT=3000
    HOST=0.0.0.0

    # ── Supabase (Frontend — Portal Unified Instance) ─────────────
    VITE_SUPABASE_URL=https://<your-project-id>.supabase.co
    VITE_SUPABASE_ANON_KEY=<your-publishable-anon-key>
    VITE_SUPABASE_SCHEMA=spes

    # ── Supabase (Backend — Direct DB Connection) ────────────────
    SUPABASE_DB_URL="postgresql://postgres.<your-project-id>:<YOUR-PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?options=--search_path%3Dspes,public"

    # ── Supabase (Service Role & Secrets) ────────────────────────
    SUPABASE_URL=https://<your-project-id>.supabase.co
    SUPABASE_SERVICE_ROLE=<your-service-role-key>
    SUPABASE_SECRET_KEY=<your-secret-key>
    SUPABASE_SCHEMA=spes

    # ── Portal SSO Integration ────────────────────────────────────
    PORTAL_SSO_CONSUME_URL=https://dole-portal.vercel.app/api/sso/consume
    PORTAL_SSO_CLIENT_SECRET=<your-portal-sso-client-secret>
    ```

    > **⚠️ Important**: The `.env` file is **gitignored** and must never be committed. To obtain full database credentials and access keys, contact the project maintainer — **Mark Jordan Ugtong** (`markjordanugtongspc`).

### Development Scripts

*   **Start Local Web Server (Vite)**
    ```bash
    npm run dev
    ```
    This launches the local server at `http://localhost:5174` with Hot Module Replacement (HMR), TailwindCSS JIT compilation, and serverless API route emulation.

*   **Preview Build Locally**
    ```bash
    npm run build
    npm run preview
    ```

*   **Preview on LAN (Accessible from Other Devices)**
    ```bash
    npm run build
    npm run preview:lan
    ```

### 🧪 Running Unit Tests

The project ships with a comprehensive test suite covering payroll logic, RBAC, security, and DOM structure. Tests run using Node's built-in `node:test` runner — **no extra dependencies required**.

```bash
npm test
```

This executes all `*.test.mjs` files inside the `tests/` directory:

| File | Coverage |
| :--- | :--- |
| `payroll.test.mjs` | Payroll computation, PAID/PENDING calculations, global vs. office budget logic, executive summary cards |
| `payroll_dom_and_ui.test.mjs` | DOM element presence, stat card IDs, toast/modal elements, role-based UI visibility |
| `auth_rbac_roles.test.mjs` | Authentication flows, RBAC role assignment, and permission validation |
| `rbac_exports_auth_fix.test.mjs` | RBAC-guarded export functionality and auth edge cases |
| `security_and_notepad.test.mjs` | Security controls, XSS prevention, and notepad feature validation |
| `lace_verification.test.mjs` | Data integrity verification and record validation |

> **Note**: The `supabase/` folder and `.env` files are intentionally excluded from this repository. Tests that require live database access must be run with a valid `.env` configured locally.

> **Test artifacts** such as coverage reports (`coverage/`) and snapshots are also gitignored — only the source test files are committed.

---

## 👥 User Guide

If you are an administrator, officer, or system user, here is how you interact with the portal:

### 1. Accessing the System
1.  Open the SPES Portal in your web browser.
2.  You will be greeted by the secure **SPES login page**.
3.  Enter your assigned credentials (e.g., standard credentials provided by your IT administrator).
4.  Upon successful login, your session is saved, and you are securely redirected to the **Command Center**.

### 2. Navigating the Command Center
*   **Dashboard**: Offers high-level visualization graphs of total implementors, male/female enrollment statistics, yearly target meters, and chronological registration timelines.
*   **User Management (Implementors)**: Add new officers/staff, search, sort, filter by department or branch, and check operational statuses (Online, Offline, Busy).
*   **Role Configuration (RBAC)**: Manage and audit access levels. You can check/uncheck modular permission flags (View, Create, Edit, Delete, Export) in real time.
*   **Beneficiaries**: Keep track of registered students, application files, and demographic information.

### 3. Preferences & Features
*   **Seamless Dark Mode Toggle**: Use the Sun/Moon icon in the top header or sidebar to toggle between Light Mode and Dark Mode. Your preference is persisted on refresh automatically.
*   **Interactive Notifications**: Clicking table row items opens high-fidelity details drawers, while success/warning operations trigger premium, theme-adaptive **SweetAlert2** modals.
*   **Logging Out**: The sign-out mechanism prompts a security confirmation modal, preventing accidental sessions expiration.

---

## 🏷️ Versioning Guidelines

The project strictly follows [Semantic Versioning (SemVer)](https://semver.org/):

*   **Patch Release** (Fixes, performance tunes, style polishes):
    ```bash
    npm run version:patch
    ```
*   **Minor Release** (New features, component additions, non-breaking modifications):
    ```bash
    npm run version:minor
    ```
*   **Major Release** (Breaking schema changes, core platform upgrades):
    ```bash
    npm run version:major
    ```

---

## ⚖️ License
Distributed under the MIT License. See [LICENSE](LICENSE) for more information.

*Department of Labor and Employment (DOLE) SPES Portal © 2026.*
