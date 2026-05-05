import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST ?? "0.0.0.0";

const distDir = path.join(__dirname, "..", "..", "dist");
const indexHtml = path.join(distDir, "index.html");

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString()
  });
});

if (fs.existsSync(indexHtml)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(indexHtml);
  });
}

app.listen(port, host, () => {
  console.log(`Backend http://localhost:${port}/api/health`);
  if (host === "0.0.0.0") {
    console.log(`Backend (LAN) http://<this-pc-ip>:${port}/api/health`);
  } else {
    console.log(`Backend http://${host}:${port}`);
  }
  if (fs.existsSync(indexHtml)) {
    console.log(`Serving SPA from dist/ on http://localhost:${port}/`);
  } else {
    console.log("dist/ not built yet — run npm run build for HR-style hosting on this port.");
  }
});
