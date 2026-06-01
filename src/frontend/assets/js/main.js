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
import { initRegisterHandler } from "./components/register-handler";
import { initBeneficiaries } from "./components/beneficiaries";
import { 
  initQuickAccessCarousel, 
  initQuickAccessPremiumInteractions,
  initLoginSignupSlider,
  initPasswordConfirmReveal
} from "./components/animations";


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

import { supabase } from "../../../backend/api/supabase.js";
import Swal from "sweetalert2";

document.addEventListener("DOMContentLoaded", () => {
  initThemeToggle();
  initAppVersionLabel();
  initLogoSwap();
  initAutoYear();
  initMobileSplashDrawer();
  initLoginHandler();
  initRegisterHandler();
  initPasswordVisibilityToggle();
  initRememberMePreferences();
  initScopedTextPlaceholders();
  initLoginCarousel();
  initBeneficiaries();
  initQuickAccessCarousel();
  initQuickAccessPremiumInteractions();
  initLoginSignupSlider();
  initPasswordConfirmReveal();
});

// ── Populate Registration Offices ───────────────────────────────
async function populateRegistrationOffices() {
  const officeSelect = document.getElementById("reg-office");
  if (!officeSelect) return;

  try {
    const { data, error } = await supabase
      .from("offices")
      .select("id, name")
      .order("name");

    if (!error && data && data.length > 0) {
      officeSelect.innerHTML = '<option value="">Select Office...</option>';
      data.forEach(office => {
        const option = document.createElement("option");
        option.value = office.id;
        option.textContent = office.name;
        officeSelect.appendChild(option);
      });
    }
  } catch (err) {
    console.error("Failed to fetch offices:", err);
  }
}
populateRegistrationOffices();

// ── Supabase Realtime Permissions Listener ────────────────────────
function setupRealtimePermissionsListener() {
  const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
  if (!session || !session.role_id) return;

  supabase
    .channel("global-main-permissions-channel")
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "permissions",
        filter: `role_id=eq.${session.role_id}`
      },
      async (payload) => {
        // Refresh local cache and localStorage
        const { fetchRolePermissions } = await import("../../../backend/api/permissions.js");
        const { data: freshPerms } = await fetchRolePermissions(session.role_id, { forceRefresh: true });
        if (freshPerms) {
          session.permissions = freshPerms;
          localStorage.setItem("spes_session", JSON.stringify(session));
          
          Swal.fire({
            title: "Permissions Updated",
            text: "Your access permissions have been updated in real-time. Reloading the page...",
            icon: "info",
            timer: 3000,
            timerProgressBar: true,
            showConfirmButton: false,
            customClass: {
              popup: "rounded-2xl border-none shadow-2xl"
            },
            background: document.documentElement.classList.contains("dark") ? "#111827" : "#ffffff",
            color: document.documentElement.classList.contains("dark") ? "#f3f4f6" : "#1f2937"
          }).then(() => {
            window.location.reload();
          });
        }
      }
    )
    .subscribe();
}

setupRealtimePermissionsListener();
