import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST ?? "0.0.0.0";

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "backend",
    timestamp: new Date().toISOString()
  });
});

app.listen(port, host, () => {
  console.log(`Backend http://localhost:${port}/api/health`);
  if (host === "0.0.0.0") {
    console.log(`Backend (LAN) http://<this-pc-ip>:${port}/api/health`);
  } else {
    console.log(`Backend http://${host}:${port}`);
  }
});
