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

// --- FIRST COMMENT SEPARATOR: EXCLUSIVE IMPLEMENTORS DRAWER LOGIC ---
export function initImplementorsDrawer() {
  const overlay = document.getElementById("implementors-drawer-overlay");
  const drawer = document.getElementById("implementors-drawer");
  const closeBtn = document.getElementById("close-impl-drawer");
  
  if (!drawer || !overlay) return;

  // Pagination Elements
  const prevBtn = document.getElementById("drawer-prev-page");
  const nextBtn = document.getElementById("drawer-next-page");
  const pageIndicator = document.getElementById("drawer-page-indicator");
  const page1 = document.getElementById("drawer-page-1");
  const page2 = document.getElementById("drawer-page-2");
  
  let currentPage = 1;

  const updatePaginationUI = () => {
    // Shared active classes for mobile view
    const mobileActiveClasses = ["max-sm:bg-spes-blue/10", "max-sm:text-spes-blue", "dark:max-sm:bg-spes-yellow/10", "dark:max-sm:text-spes-yellow"];

    if (currentPage === 1) {
      page1.classList.remove("hidden");
      page1.classList.add("block");
      page2.classList.remove("block");
      page2.classList.add("hidden");
      
      prevBtn.disabled = true;
      nextBtn.disabled = false;

      // Apply hover state to Next, remove from Prev
      prevBtn.classList.remove(...mobileActiveClasses);
      nextBtn.classList.add(...mobileActiveClasses);
    } else {
      page1.classList.remove("block");
      page1.classList.add("hidden");
      page2.classList.remove("hidden");
      page2.classList.add("block");
      
      prevBtn.disabled = false;
      nextBtn.disabled = true;

      // Apply hover state to Prev, remove from Next
      nextBtn.classList.remove(...mobileActiveClasses);
      prevBtn.classList.add(...mobileActiveClasses);
    }
    pageIndicator.textContent = currentPage;
  };

  prevBtn?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      updatePaginationUI();
    }
  });

  nextBtn?.addEventListener("click", () => {
    if (currentPage < 2) {
      currentPage++;
      updatePaginationUI();
    }
  });

  const closeDrawer = () => {
    drawer.classList.remove("translate-y-0", "sm:translate-x-0");
    drawer.classList.add("translate-y-full", "sm:translate-x-full");
    overlay.classList.add("hidden");
    overlay.classList.remove("block");
    document.body.classList.remove("overflow-hidden"); // Restore scrolling
  };

  const openDrawer = (implementorData) => {
    // Reset to page 1
    currentPage = 1;
    updatePaginationUI();

    // Populate Data
    document.getElementById("drawer-impl-name").textContent = implementorData.full_name || "Unknown";
    document.getElementById("drawer-impl-role").textContent = implementorData.role || "N/A";
    document.getElementById("drawer-impl-id").textContent = implementorData.id ? `DOLE-${implementorData.id.toString().padStart(4, '0')}` : "---";
    document.getElementById("drawer-impl-office").textContent = implementorData.office || "---";
    document.getElementById("drawer-impl-email").textContent = implementorData.email || "---";
    
    // New Fields (Using mock defaults since dashboard.js mock data doesn't have them all)
    document.getElementById("drawer-impl-address").textContent = implementorData.address || "Cagayan de Oro City, Misamis Oriental";
    document.getElementById("drawer-impl-religion").textContent = implementorData.religion || "Roman Catholic";
    document.getElementById("drawer-impl-language").textContent = implementorData.language || "English, Cebuano, Tagalog";
    document.getElementById("drawer-impl-blood").textContent = implementorData.blood_type || "O+";
    document.getElementById("drawer-impl-phone").textContent = implementorData.phone || "+63 917 123 4567";
    document.getElementById("drawer-impl-notes").textContent = implementorData.notes || "No recent notes or activities recorded for this implementor.";

    // Dynamic Status Badge (Dot Only)
    const statusText = (implementorData.status || "offline").toUpperCase();
    
    const badgeDiv = document.getElementById("drawer-impl-status-badge");
    const dotDiv = document.getElementById("drawer-impl-status-dot");
    
    // Reset classes
    badgeDiv.className = "flex items-center justify-center";
    dotDiv.className = "h-3 w-3 rounded-full";
    
    if (statusText === "ONLINE") {
      dotDiv.classList.add("bg-emerald-500", "animate-pulse", "shadow-[0_0_8px_rgba(16,185,129,0.8)]");
    } else if (statusText === "BUSY") {
      dotDiv.classList.add("bg-spes-red", "animate-pulse", "shadow-[0_0_8px_rgba(206,17,38,0.8)]");
    } else {
      dotDiv.classList.add("bg-gray-500");
    }

    // Show Drawer
    overlay.classList.remove("hidden");
    overlay.classList.add("block");
    drawer.classList.remove("translate-y-full", "sm:translate-x-full");
    drawer.classList.add("translate-y-0", "sm:translate-x-0");
    document.body.classList.add("overflow-hidden"); // Prevent background scrolling
  };

  // Close events
  closeBtn?.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);

  // Expose open function globally so dashboard.js can call it when a row is clicked
  window.openImplementorDrawer = openDrawer;
}
// --- END COMMENT SEPARATOR: EXCLUSIVE IMPLEMENTORS DRAWER LOGIC ---
