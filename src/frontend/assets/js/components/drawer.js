import { Drawer } from "flowbite";
import {
  animateMobileSplashVisibility,
  applyDrawerAnimationClasses
} from "./animation";

// --- FUNCTION: MOBILE SPLASH + FLOWBITE DRAWER BRIDGE (START) ---
export function initMobileSplashDrawer() {
  const splash = document.getElementById("mobile-splash");
  const openButton = document.getElementById("mobile-splash-open-login");
  const drawer = document.getElementById("drawer-top-example");
  if (!drawer) return;

  const mobileQuery = window.matchMedia("(max-width: 1023px)");
  applyDrawerAnimationClasses(splash, drawer);

  const drawerInstance = new Drawer(
    drawer,
    {
      placement: "top",
      backdrop: false,
      bodyScrolling: true
    },
    {
      id: "drawer-top-example",
      override: true
    }
  );

  const showSplash = () => {
    if (splash) animateMobileSplashVisibility(splash, true);
  };
  const hideSplash = () => {
    if (splash) animateMobileSplashVisibility(splash, false);
  };

  if (mobileQuery.matches) {
    hideSplash();
    drawerInstance.show();
  } else {
    hideSplash();
    drawerInstance.hide();
  }

  openButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if (mobileQuery.matches) hideSplash();
    drawerInstance.show();
  });

  const closeDrawer = () => {
    drawerInstance.hide();
    if (mobileQuery.matches) showSplash();
  };

  // --- INTERACTION: TAP ANYWHERE TO CLOSE DRAWER (START) ---
  drawer.addEventListener("click", () => {
    if (!mobileQuery.matches) return;
    closeDrawer();
  });
  // --- INTERACTION: TAP ANYWHERE TO CLOSE DRAWER (END) ---

  // --- INTERACTION: SWIPE UP TO CLOSE DRAWER (START) ---
  let touchStartY = 0;
  let touchEndY = 0;

  drawer.addEventListener(
    "touchstart",
    (event) => {
      if (!mobileQuery.matches) return;
      touchStartY = event.changedTouches[0].clientY;
      touchEndY = touchStartY;
    },
    { passive: true }
  );

  drawer.addEventListener(
    "touchmove",
    (event) => {
      if (!mobileQuery.matches) return;
      touchEndY = event.changedTouches[0].clientY;
    },
    { passive: true }
  );

  drawer.addEventListener(
    "touchend",
    () => {
      if (!mobileQuery.matches) return;
      const swipeDistance = touchStartY - touchEndY;
      if (swipeDistance > 50) closeDrawer();
    },
    { passive: true }
  );
  // --- INTERACTION: SWIPE UP TO CLOSE DRAWER (END) ---

  mobileQuery.addEventListener("change", (event) => {
    if (event.matches) {
      hideSplash();
      drawerInstance.show();
    } else {
      hideSplash();
      drawerInstance.hide();
    }
  });
}
// --- FUNCTION: MOBILE SPLASH + FLOWBITE DRAWER BRIDGE (END) ---
