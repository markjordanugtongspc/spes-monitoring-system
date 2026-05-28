# DOLE SPES — Electron deployment instructions

## What each release file means

- `DOLE SPES Portal 0.1.8.exe`  
  Portable build. No installer. Copy and run directly on one Windows PC.
- `DOLE SPES Portal Setup 0.1.8.exe`  
  Installer build (NSIS). Installs app in Program Files and creates shortcuts.
- `DOLE SPES Portal Setup 0.1.8.exe.blockmap`  
  Metadata for differential updates. Keep it with the setup artifact for release/update tooling.

## Important update rule

If you change the web app code, your old `.exe` does **not** auto-update.  
You must build again and send/share the new `.exe` or new installer.

---

## First-time setup (step by step)

1. Install [Node.js LTS](https://nodejs.org/) on the build PC.
2. Open this repo folder.
3. Right-click `install-dole-spes.bat` and run as **Administrator**.
4. Wait for completion. It will:
   - run `npm install`
   - run `npm run build`
   - generate app icon file
   - package installer + portable exe in `release/`
   - configure firewall and hosts helpers
5. Use artifacts from `release/`:
   - installer: `DOLE SPES Portal Setup *.exe`
   - portable: `DOLE SPES Portal *.exe` (non-Setup)

---

## How to update an existing app release

When you edit frontend/electron code:

1. Update code.
2. Fast way (recommended):

```bat
update-dole-spes.bat
```

This does all of these automatically:
- `npm install`
- bump version (patch by default)
- `npm run build`
- `npm run dist`

Use a bigger bump when needed:

```bat
update-dole-spes.bat minor
update-dole-spes.bat major
```

3. Manual way (if you prefer):

```bat
npm install
npm run version:patch
npm run build
npm run dist
```

4. Upload/share the newly generated files from `release/`.
5. Target PC installs/runs the newer `.exe`.

---

## Scripts and folders

- Root scripts:
  - `install-dole-spes.bat` (main all-in-one setup)
  - `update-dole-spes.bat` (automated rebuild + version bump)
  - `kill-dev-ports.bat` (optional helper)
- `installers/` folder:
  - `setup-dev-firewall.bat`
  - `setup-dev-hosts.bat`
  - `run-lan-preview.bat`
  - `run-system.bat`

---

## LAN access for phones/other devices

Electron `.exe` runs locally on one PC.  
To expose the web build to phones on same router:

1. On host PC run `installers\setup-dev-firewall.bat` once (Admin).
2. Build app: `npm run build`.
3. Start LAN preview: `installers\run-lan-preview.bat`.
4. On phone/laptop open: `http://<host-pc-ipv4>:5173`.

Wired desktop and Wi-Fi phones still work together if both are on the same router/subnet.
