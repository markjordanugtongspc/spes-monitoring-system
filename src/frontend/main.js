import "./assets/style.css";
import "flowbite";

const apiBase =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function pingHealth() {
  const url = `${apiBase}/api/health`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    console.info("[SPES] API health:", body);
  } catch (err) {
    console.warn(
      "[SPES] API not reachable at",
      url,
      "— run npm run dev (starts API + Vite) or npm run dev:backend",
      err
    );
  }
}

pingHealth();
