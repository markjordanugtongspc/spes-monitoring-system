import "../styles/tailwind.css";
import "flowbite";
import { initThemeToggle } from "./components/theme-toggle";
import { initMobileSplashDrawer } from "./components/drawer";
import {
  initPasswordVisibilityToggle,
  initRememberMePreferences
} from "./components/auth";

const apiBase =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function pingHealth() {
  if (typeof window !== "undefined" && window.location.protocol === "file:")
    return;
  const url = `${apiBase}/api/health`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    console.info("[SPES] API health:", body);
  } catch (err) {
    console.warn(
      "[SPES] API not reachable at",
      url,
      "— run npm run dev (Vite) or set VITE_API_BASE_URL if using a separate API",
      err
    );
  }
}

pingHealth();

// --- FUNCTION: SWAP BRANDING FLAT ICONS (START) ---
function initLogoSwap() {
  const logos = [
    "/src/frontend/assets/img/logos/spes.png",
    "/src/frontend/assets/img/logos/bph.png"
  ];
  const logoElements = Array.from(document.querySelectorAll(".js-swappable-logo"));
  if (!logoElements.length) return;
  let current = 0;

  logoElements.forEach((logoElement) => {
    logoElement.classList.add("rounded-full");
    logoElement.addEventListener("click", () => {
      current = (current + 1) % logos.length;
      logoElements.forEach((element) => {
        element.src = logos[current];
      });
    });
  });
}
// --- FUNCTION: SWAP BRANDING FLAT ICONS (END) ---

// --- FUNCTION: AUTO INPUT CURRENT YEAR (START) ---
function initAutoYear() {
  const yearElement = document.getElementById("current-year");
  if (!yearElement) return;
  yearElement.textContent = String(new Date().getFullYear());
}
// --- FUNCTION: AUTO INPUT CURRENT YEAR (END) ---

initThemeToggle();
initLogoSwap();
initAutoYear();
initMobileSplashDrawer();
initPasswordVisibilityToggle();
initRememberMePreferences();
