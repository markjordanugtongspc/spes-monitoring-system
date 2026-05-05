# DOLE SPES Attendance System — Cursor AI Agent Instructions

## Project Goal
LAN-focused attendance app for DOLE Office SPES students. Devices on the same WiFi reach the app; **Supabase** stays in the cloud (needs internet).

---

## Development mode (your laptop)

### Install once
```
npm install
```

### Local friendly URL on this PC only
1. **`setup-dev-hosts.bat`** → right-click → **Run as administrator** (once).  
   Adds `127.0.0.1   dole-spes.local`
2. Open **`http://dole-spes.local:5173`**

### Phone cannot connect / “This site can’t be reached” on LAN IP

Most common fix on Windows: **firewall**.

**Option A — script (recommended)**  
Right-click **`setup-dev-firewall.bat`** → **Run as administrator** once.  
Opens inbound **TCP 5173** (Vite) and **3000** (API) on **Private** profile.

**Option B — manual (Windows Firewall)**

1. Press **Win + R**, type **`wf.msc`**, Enter.
2. **Inbound Rules** → **New Rule…**
3. **Port** → **TCP** → **Specific local ports:** `5173` → **Next**
4. **Allow the connection** → **Next**
5. Check **Private** only (recommended) → **Next**
6. Name e.g. **`DOLE SPES Dev Vite 5173`** → **Finish**
7. Repeat steps 2–6 for port **`3000`** (name e.g. **`DOLE SPES Dev API 3000`**).

**Also check**

- **Wi‑Fi profile:** **Settings → Network & Internet → Wi‑Fi → [your network]** → set **Network profile** to **Private** (not Public), or add the same rules for **Public**.
- **Correct IP:** On the laptop run `ipconfig`, use the **IPv4** under the adapter that is actually on **the same Wi‑Fi** as the phone (often `192.168.x.x`). Ignore Hyper‑V / virtual adapters unless that’s your LAN.
- **AP / guest isolation:** Some routers’ **Guest** SSID blocks phone ↔ laptop. Use the main office Wi‑Fi if that happens.
- **Dev server running:** `npm run dev` must be active while testing **5173**.

### One command: Vite + API + HMR
```
npm run dev
```
- Browser uses **`/api/*`** → proxied to **`http://127.0.0.1:3000`**
- **Phone:** use Vite’s printed **Network** URL, e.g. `http://192.168.1.102:5173`

Optional:

```
npm run dev:vite
npm run dev:backend
```

### Env
- **`src/backend/.env`** — copy from **`src/backend/.env.example`** (`PORT`, `HOST`)
- Root **`.env`** — optional **`VITE_*`** for Supabase

### Production-style static files
```
npm run build
```
Output: **`dist/`**. After build, **Express** serves **`dist/`** when **`index.html`** exists (same port as API, default **3000**).

---

## Production mode (HR PC)

1. Copy the whole project folder to the HR machine (any path).
2. **`install-dole-spes.bat`** → **Run as administrator** (from inside that folder).  
   It uses **`%~dp0`** (this folder), **not** a fixed `C:\dole-spes` path: installs deps, **`npm run build`**, adds **hosts**, opens firewall **3000**, starts **`src/backend/server.js`** under **PM2**, **`pm2 save`**, **`pm2 startup`**.

3. Put **`run-system.bat`** in **Startup** folder if you want a safety net after reboot (PM2 usually restores via **`pm2 startup`**):  
   **Win + R** → `shell:startup` → place a shortcut to **`run-system.bat`**.

HR browser on that PC: **`http://dole-spes.local:3000/`** (hosts maps to **127.0.0.1** on HR PC only).

Students on LAN: **`http://<HR-PC-LAN-IP>:3000/`**, or DNS/hosts **`dole-spes.local` → HR PC LAN IP**.

If you change **`PORT`** in **`src/backend/.env`**, update the firewall rule in **`install-dole-spes.bat`** (`SPES_PORT`) to match.

---

## Scripts summary

| Script | Use |
|--------|-----|
| **`setup-dev-hosts.bat`** | Dev: `dole-spes.local` → localhost on **this PC** |
| **`setup-dev-firewall.bat`** | Dev: allow LAN to reach **5173** + **3000** |
| **`install-dole-spes.bat`** | HR: full install + build + PM2 + firewall **3000** |
| **`run-system.bat`** | HR: `pm2 resurrect` or start app after reboot |

---

## Workflow summary

| Goal | Steps |
|------|--------|
| Laptop dev | `npm install` → **`setup-dev-hosts.bat`** (Admin) → **`setup-dev-firewall.bat`** (Admin) → **`npm run dev`** |
| Phone on Wi‑Fi | Firewall OK → **Private** profile → use **Network** URL from Vite |
| HR production | Folder on HR PC → **`install-dole-spes.bat`** (Admin) → optional Startup shortcut for **`run-system.bat`** |
