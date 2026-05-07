# DOLE SPES — Project instructions

## What this repo is
LAN-first attendance-style web app: **Vite + vanilla JS frontend**, **Express API**, **Supabase** (cloud DB/auth — needs internet). Students reach the app over **office Wi‑Fi** using the **HR/host PC’s LAN IP** (share via **QR code** / poster). Custom hostname **`dole-spes.local`** is optional (hosts on the HR PC only, or DNS if IT adds it later).

**After this scaffold:** you keep coding (frontend under `src/frontend/`, API in `src/frontend/api/server.js`, Supabase client in `src/backend/api/supabase.js`) until features are done; then rebuild and redeploy on the HR PC as below.

---

## Batch files (what each is for)

| File | When | Admin? | Purpose |
|------|------|--------|---------|
| **`install-dole-spes.bat`** | **HR production PC — first deploy** | **Yes** | Installs deps, builds `dist/`, adds hosts entry, opens firewall for port **3000**, starts **`src/frontend/api/server.js`** with **PM2**, **`pm2 save`**, **`pm2 startup`**. **This is the main “make it run” installer.** |
| **`run-system.bat`** | HR PC — **after reboot** (optional safety net) | No | `cd` to project folder → **`pm2 resurrect`** or start **`dole-spes`** if needed. Use if PM2 does not auto-restore; shortcut in **Startup** is optional. |
| **`setup-dev-hosts.bat`** | **Your laptop — dev only** | Yes | Maps **`dole-spes.local` → 127.0.0.1** on **this PC** so you can open **`http://dole-spes.local:5173`**. **Not used on HR for student access.** |
| **`setup-dev-firewall.bat`** | **Your laptop — dev only** | Yes | Opens inbound **TCP 5173** (Vite) and **3000** (API) for **Private** profile so phones can hit **`http://<laptop-LAN-IP>:5173`** during development. |
| **`kill-dev-ports.bat`** | **Your laptop — dev only, optional** | No | Frees stuck **5173** / **3000** if **`npm run dev`** was started twice or Node stayed running. **Not part of HR production install.** |

There are **five** scripts; **none are duplicates**. Do **not** delete them unless you drop dev-on-phone or HR reboot helpers entirely.

---

## HR production PC — “does `install-dole-spes.bat` alone make it work?”

**Almost.** Run it **as Administrator** from the **project folder** (the folder that contains `package.json`).

It will:

1. Ensure **`127.0.0.1 dole-spes.local`** exists in the hosts file (for **browsers on that PC only**).
2. Allow inbound **TCP 3000** on **Domain, Private, and Public** Windows Firewall profiles (so mis-tagged networks still work).
3. Run **`npm install`** and **`npm run build`**.
4. Install/start **PM2** and run **`src/frontend/api/server.js`**, which serves **`dist/`** + **`/api/*`** on port **3000** (default).

**You must have installed [Node.js LTS](https://nodejs.org/) on the HR PC first** (includes `npm`). The script stops with a clear message if `npm` is missing.

**First run:** if **`src/backend/.env`** does not exist, the installer **copies `src/backend/.env.example` → `.env`**. Edit **`src/backend/.env`** later if you change **PORT** or need secrets — if you change **PORT**, update **`SPES_PORT`** inside **`install-dole-spes.bat`** so the firewall rule matches.

**After install:**

- On the **HR PC:** **`http://dole-spes.local:3000/`** or **`http://localhost:3000/`**
- **Students (BYOD):** **`http://<HR-PC-LAN-IPv4>:3000/`** — put that URL in a **QR code** on a poster (no router DNS required).

If **`pm2 startup`** prints an extra command, run that **once as Administrator** (PM2’s normal Windows behavior).

**Optional:** Shortcut **`run-system.bat`** in **`shell:startup`** if you want a reboot safety net.

---

## Updating the app on the HR PC later

On your dev machine: finish features → **`npm run build`**. On HR: pull/copy files → from project folder:

```bat
npm install
npm run build
pm2 restart dole-spes
```

(Or re-run **`install-dole-spes.bat`** if you prefer a full scripted pass — it will rebuild and restart PM2.)

---

## Development (your laptop)

1. **`npm install`**
2. Once as Admin: **`setup-dev-hosts.bat`** (nice URL on laptop only), **`setup-dev-firewall.bat`** (phones → LAN IP during dev).
3. **`npm run dev`** — Vite **5173** + API **3000**, **`/api`** proxied through Vite.
4. If ports stick: **`kill-dev-ports.bat`** then **`npm run dev`** again.

**Env:** **`src/backend/.env`** (see **`.env.example`**). Root **`.env`** for **`VITE_*`** Supabase vars when you wire the client.

### Access URLs (confirmed on your laptop)

When running **`npm run dev`**:

- Laptop: **`http://localhost:5173/`**
- Mobile (same Wi-Fi): **`http://192.168.1.102:5173/`**

When running **`npm run start:prod`**:

- Laptop: **`http://localhost:3000/`**
- Mobile (same Wi-Fi): **`http://192.168.1.102:3000/`**

---

## Summary

| Scenario | What to run |
|----------|-------------|
| **HR PC — go live** | Install **Node LTS** → copy project folder → **`install-dole-spes.bat`** as **Administrator** |
| **HR — reboot helper** | Optional **`run-system.bat`** or Startup shortcut |
| **Laptop — coding + phone test** | **`setup-dev-hosts.bat`** + **`setup-dev-firewall.bat`** (Admin, once) → **`npm run dev`** |
| **Laptop — stuck ports** | Optional **`kill-dev-ports.bat`** |

Students: **LAN IP + QR** to **`http://<host-IP>:3000/`** — final approach; no router access required.
