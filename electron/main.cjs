const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu, dialog, shell } = require("electron");

const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const appVersion = pkg.version ?? "";
const updateManifestUrl = pkg.spes?.updateManifestUrl ?? "";

function parseVersion(versionString) {
  return String(versionString)
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const maxLen = Math.max(av.length, bv.length);
  for (let i = 0; i < maxLen; i += 1) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }
  return 0;
}

async function checkForUpdates() {
  if (!updateManifestUrl) {
    await dialog.showMessageBox({
      type: "info",
      title: "Check for Updates",
      message: "No update URL configured yet.",
      detail:
        "Set package.json -> spes.updateManifestUrl to a JSON URL like { version, notes, downloadUrl }."
    });
    return;
  }

  try {
    const response = await fetch(updateManifestUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const manifest = await response.json();
    const latestVersion = manifest.version ?? "";
    const releaseNotes = manifest.notes ?? "No release notes.";
    const downloadUrl = manifest.downloadUrl ?? "";

    if (!latestVersion) {
      throw new Error("Missing 'version' in update manifest.");
    }

    const hasUpdate = compareVersions(latestVersion, appVersion) > 0;
    if (!hasUpdate) {
      await dialog.showMessageBox({
        type: "info",
        title: "Check for Updates",
        message: `You're up to date (v${appVersion}).`,
        detail: "No newer version is available."
      });
      return;
    }

    const result = await dialog.showMessageBox({
      type: "info",
      title: "Update Available",
      message: `New version found: v${latestVersion}`,
      detail: `${releaseNotes}${downloadUrl ? `\n\nDownload: ${downloadUrl}` : ""}`,
      buttons: downloadUrl ? ["Open Download Page", "Later"] : ["OK"],
      defaultId: 0,
      cancelId: downloadUrl ? 1 : 0
    });

    if (downloadUrl && result.response === 0) {
      await shell.openExternal(downloadUrl);
    }
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "Check for Updates",
      message: "Update check failed.",
      detail: String(error?.message ?? error)
    });
  }
}

function resolveIconPath() {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "app-icon.png");
    if (fs.existsSync(bundled)) return bundled;
  }
  const devLogo = path.join(
    __dirname,
    "..",
    "src",
    "frontend",
    "assets",
    "img",
    "logos",
    "c_spes.png"
  );
  if (fs.existsSync(devLogo)) return devLogo;
  return undefined;
}

function createWindow() {
  const icon = resolveIconPath();
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: true,
    title: `SPES Login — v${appVersion}`,
    ...(icon ? { icon } : {}),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setTitle(`SPES Login — v${appVersion}`);
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.whenReady().then(() => {
  const menu = Menu.buildFromTemplate([
    {
      label: "File",
      submenu: [{ role: "quit", label: "Exit" }]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "About DOLE SPES Portal",
              message: "DOLE SPES Portal",
              detail: `Version ${appVersion}\nCreated by: Mark Jordan Ugtong, Software Developer`
            });
          }
        },
        {
          label: "Version",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "Version",
              message: `DOLE SPES Portal v${appVersion}`
            });
          }
        },
        {
          label: "Check for Updates",
          click: checkForUpdates
        },
        {
          label: "Credits",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "Credits",
              message: "Created by Other",
              detail: "Built with Electron, Vite, Tailwind CSS, and Supabase."
            });
          }
        }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
