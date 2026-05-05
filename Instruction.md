# DOLE SPES Attendance System — Cursor AI Agent Instructions

## Project Goal
LAN-focused attendance app for DOLE Office SPES students. Designed so devices on the same WiFi can reach the app; Supabase stays in the cloud (needs internet).

---

## Development mode (your laptop) — current focus

### Install once
From the project folder:

```
npm install
```

### Custom domain on this laptop only
Windows maps names via the hosts file.

1. Right-click **`setup-dev-hosts.bat`** → **Run as administrator** (once).
2. That adds: `127.0.0.1   dole-spes.local`
3. Open **`http://dole-spes.local:5173`** on this PC — Vite dev server with hot reload.

### One command: frontend + API + HMR
```
npm run dev
```
This runs **Vite** and **`src/backend/server.js`** together. API is proxied from the browser as **`/api/*`** → `http://127.0.0.1:3000`.

- Frontend: port **5173** (HMR)
- Backend: port **3000**, listens on **`0.0.0.0`** so other devices on LAN can call it directly if needed

### Vite-only or backend-only (optional)
```
npm run dev:vite
npm run dev:backend
```

### Phone / tablet on same WiFi
- **Easiest:** use the **Network** URL Vite prints (e.g. `http://192.168.x.x:5173`). Same Wi‑Fi required.
- **`http://dole-spes.local` on the phone** only works if that device resolves the name to **this laptop’s LAN IP** (router DNS, manual hosts on that device, etc.). The laptop hosts file does **not** apply to your phone.

### Env files
- **`src/backend/.env`** — e.g. `PORT=3000` (optional `HOST=0.0.0.0`)
- Root **`.env`** — optional `VITE_*` for Supabase (`src/frontend/api/supabase.js`)

### Production build (when you want static files)
```
npm run build
```
Output: `dist/`

---

## Production mode (HR PC) — defer until deployment

Skipped while you develop only on the laptop. When needed:

- **`install-dole-spes.bat`** — hosts entry, PM2, paths under `C:\dole-spes` (adjust paths to match deployment).
- **`run-system.bat`** — PM2 start on boot.

Revise those scripts to match your real install directory before HR rollout.

---

## Cursor agent rules (summary)
- Dev: **`npm run dev`** + **`setup-dev-hosts.bat`** once for `dole-spes.local` on the laptop.
- LAN-only assumption; no cloud frontend hosting required.
- Avoid suggesting `npm run dev` for final HR production unless explicitly requested.

---

## Workflow summary
| Where | Command / step |
|-------|----------------|
| Laptop dev | `npm install` → run **`setup-dev-hosts.bat` as Admin** once → **`npm run dev`** → open **`http://dole-spes.local:5173`** |
| Phone test | Same WiFi → use Vite **Network** URL, or configure **`dole-spes.local` → laptop IP** on phone/router |
| Later prod | `npm run build` + HR scripts when ready |
