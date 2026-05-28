import "../styles/tailwind.css";
import "flowbite";
import { initThemeToggle } from "./components/theme-toggle";
import { initMobileSplashDrawer } from "./components/drawer";
import { initAutoYear } from "./components/year";
import {
  initPasswordVisibilityToggle,
  initRememberMePreferences
} from "./components/auth";
import { initScopedTextPlaceholders } from "./components/content-placeholders";
import { initLoginCarousel } from "./components/carousel";
import { initLoginHandler } from "./components/login-handler";
import { initBeneficiaries } from "./components/beneficiaries";



function initAppVersionLabel() {

  const el = document.getElementById("app-version");
  const v = import.meta.env.VITE_APP_VERSION;
  if (el && v) el.textContent = `Version ${v}`;
}

// --- FUNCTION: SWAP BRANDING FLAT ICONS (START) ---
function initLogoSwap() {
  const logos = [
    "/src/frontend/assets/img/logos/c_spes.png",
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

initThemeToggle();
initAppVersionLabel();
initLogoSwap();
initAutoYear();
initMobileSplashDrawer();
initPasswordVisibilityToggle();
initRememberMePreferences();
initScopedTextPlaceholders();
initLoginCarousel();
initLoginHandler();
initBeneficiaries();

