const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, Menu } = require("electron");

const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const appVersion = pkg.version ?? "";

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
    "spes.png"
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
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
