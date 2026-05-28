// --- FUNCTION: APPLY DRAWER + SPLASH ANIMATION CLASSES (START) ---
export function applyDrawerAnimationClasses(splashElement, drawerElement) {
  if (splashElement) {
    splashElement.classList.add("transition-all", "duration-500", "ease-out");
  }
  if (drawerElement) {
    drawerElement.classList.add("transition-transform", "duration-500", "ease-out");
  }
}
// --- FUNCTION: APPLY DRAWER + SPLASH ANIMATION CLASSES (END) ---

// --- FUNCTION: ANIMATE MOBILE SPLASH VISIBILITY (START) ---
export function animateMobileSplashVisibility(splashElement, shouldShow) {
  if (!splashElement) return;

  if (shouldShow) {
    splashElement.classList.remove("hidden", "opacity-0", "pointer-events-none");
    splashElement.classList.add("opacity-100");
    return;
  }

  splashElement.classList.remove("opacity-100");
  splashElement.classList.add("opacity-0", "pointer-events-none");
  window.setTimeout(() => {
    if (splashElement.classList.contains("opacity-0")) {
      splashElement.classList.add("hidden");
    }
  }, 320);
}
// --- FUNCTION: ANIMATE MOBILE SPLASH VISIBILITY (END) ---

// --- FUNCTION: INIT LANDING HERO REVEAL ANIMATION (START) ---
export function initLandingHeroAnimation() {
  const heroElements = Array.from(document.querySelectorAll("[data-animate-hero]"));
  if (!heroElements.length) return;

  heroElements.forEach((element) => {
    element.classList.add(
      "translate-y-4",
      "opacity-0",
      "transition-all",
      "duration-700",
      "ease-out"
    );
  });

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      heroElements.forEach((element, index) => {
        window.setTimeout(() => {
          element.classList.remove("translate-y-4", "opacity-0");
          element.classList.add("translate-y-0", "opacity-100");
        }, index * 130);
      });
    }, 120);
  });
}
// --- FUNCTION: INIT LANDING HERO REVEAL ANIMATION (END) ---

// --- FUNCTION: INIT ACTIVE NAV ITEM HIGHLIGHT (START) ---
const NAV_ACTIVE_CLASSES = [
  "underline",
  "underline-offset-4",
  "decoration-2",
  "decoration-spes-blue",
  "text-spes-blue",
  "dark:text-spes-yellow"
];

function setNavLinkActive(link, isActive) {
  NAV_ACTIVE_CLASSES.forEach((cls) => link.classList.toggle(cls, isActive));
}

export function initLandingActiveNavHighlight() {
  const navLinks = Array.from(document.querySelectorAll("[data-nav-link]"));
  if (!navLinks.length) return;

  const context = document.body?.dataset?.navContext || "landing";

  const applyActiveClass = () => {
    if (context === "contact") {
      navLinks.forEach((link) => {
        const isContact = link.getAttribute("data-nav-id") === "contact";
        setNavLinkActive(link, isContact);
      });
      return;
    }

    const currentHash = window.location.hash || "#home";
    navLinks.forEach((link) => {
      const href = link.getAttribute("href") || "";
      const isActive = href.startsWith("#") && href === currentHash;
      setNavLinkActive(link, isActive);
    });
  };

  applyActiveClass();
  window.addEventListener("hashchange", applyActiveClass);
}
// --- FUNCTION: INIT ACTIVE NAV ITEM HIGHLIGHT (END) ---

// --- FUNCTION: INIT STICKY CARD HOVER ANIMATION (START) ---
export function initStickyCardHoverAnimation() {
  const cards = Array.from(document.querySelectorAll("[data-hover-card]"));
  if (!cards.length) return;

  cards.forEach((card) => {
    card.classList.add(
      "transition-all",
      "duration-300",
      "ease-out",
      "hover:-translate-y-1",
      "hover:shadow-lg",
      "hover:shadow-spes-blue/10",
      "dark:hover:shadow-spes-black/50"
    );
  });
}
// --- FUNCTION: INIT STICKY CARD HOVER ANIMATION (END) ---

export function initGuidedAnchorEffects() {
  const guidedLinks = Array.from(document.querySelectorAll("[data-guide-link]"));
  const guidedClicks = Array.from(document.querySelectorAll("[data-guide-click]"));
  if (!guidedLinks.length && !guidedClicks.length) return;

  // Cursor element (The Guide)
  let guideCursor = document.getElementById("guide-cursor");
  if (!guideCursor) {
    guideCursor = document.createElement("div");
    guideCursor.id = "guide-cursor";
    guideCursor.className =
      "pointer-events-none fixed z-[100] h-6 w-6 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-all duration-500 ease-out";
    guideCursor.innerHTML = `
      <div class="relative flex h-full w-full items-center justify-center">
        <div class="absolute h-3 w-3 rounded-full bg-spes-yellow shadow-[0_0_15px_rgba(252,209,22,0.8)]"></div>
        <div class="absolute h-6 w-6 animate-ping rounded-full border-2 border-spes-yellow/40"></div>
        <svg class="absolute -bottom-4 -right-4 h-6 w-6 text-spes-yellow drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
          <path d="M7 2l12 11.2-5.8.8 3.5 6-2.2 1.3-3.5-6-4 4.7V2z"/>
        </svg>
      </div>
    `;
    document.body.appendChild(guideCursor);
  }

  // Blinking indicator (The Target Highlight)
  let blinkIndicator = document.getElementById("blink-indicator");
  if (!blinkIndicator) {
    blinkIndicator = document.createElement("div");
    blinkIndicator.id = "blink-indicator";
    blinkIndicator.className =
      "pointer-events-none fixed z-[90] h-12 w-12 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-all duration-300";
    blinkIndicator.innerHTML = `
      <div class="relative flex h-full w-full items-center justify-center">
        <div class="absolute h-full w-full animate-ping rounded-full bg-spes-yellow/30"></div>
        <div class="absolute h-8 w-8 rounded-full border-4 border-spes-yellow/60"></div>
      </div>
    `;
    document.body.appendChild(blinkIndicator);
  }

  const pulseTarget = (target) => {
    if (!target) return;
    target.classList.add("ring-4", "ring-spes-yellow/55", "ring-offset-2", "dark:ring-offset-spes-dark-secondary", "transition-all", "duration-500");
    const content = target.querySelector("[data-text-placeholder-content]") || target;
    content.classList.add("animate-pulse");

    window.setTimeout(() => {
      target.classList.remove("ring-4", "ring-spes-yellow/55", "ring-offset-2");
      content.classList.remove("animate-pulse");
    }, 1500);
  };

  const animateToTarget = (fromX, fromY, targetElement, callback) => {
    // 1. Initial State
    guideCursor.style.left = `${fromX}px`;
    guideCursor.style.top = `${fromY}px`;
    guideCursor.classList.remove("opacity-0", "duration-500", "scale-90", "scale-110", "scale-150");
    guideCursor.classList.add("opacity-100", "scale-100");

    // 2. Move to Target
    window.requestAnimationFrame(() => {
      const rect = targetElement.getBoundingClientRect();
      const toX = rect.left + rect.width / 2;
      const toY = rect.top + 20;

      guideCursor.classList.add("duration-500");
      guideCursor.style.left = `${toX}px`;
      guideCursor.style.top = `${toY}px`;

      window.setTimeout(() => {
        // 3. Perform "Click" Animation
        guideCursor.classList.remove("duration-500");
        guideCursor.classList.add("duration-150", "scale-90"); // Press down

        window.setTimeout(() => {
          guideCursor.classList.remove("scale-90");
          guideCursor.classList.add("scale-110"); // Release up
          
          // Show indicator
          blinkIndicator.style.left = `${toX}px`;
          blinkIndicator.style.top = `${toY}px`;
          blinkIndicator.classList.remove("opacity-0", "scale-150");
          blinkIndicator.classList.add("opacity-100", "scale-100");

          window.setTimeout(() => {
            // 4. Smooth Exit
            guideCursor.classList.remove("duration-150");
            guideCursor.classList.add("duration-500", "opacity-0", "scale-75");
            blinkIndicator.classList.add("duration-500", "opacity-0", "scale-150");
            
            window.setTimeout(() => {
              guideCursor.classList.remove("scale-75", "opacity-100");
              blinkIndicator.classList.remove("opacity-100", "scale-150");
              if (callback) callback();
            }, 500);
          }, 400);
        }, 150);
      }, 500);
    });
  };

  guidedLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href") || "";
      if (!href.includes("#")) return;
      
      const targetId = href.split("#")[1];
      const target = document.getElementById(targetId) || document.querySelector(`#${targetId}`);
      if (!target) return;

      event.preventDefault();
      closeAllDropdowns();

      const linkRect = link.getBoundingClientRect();
      const fromX = linkRect.left + linkRect.width / 2;
      const fromY = linkRect.top + linkRect.height / 2;

      target.scrollIntoView({ behavior: "smooth", block: "center" });

      window.setTimeout(() => {
        // If it's program-overview, skip the main header click and go straight to cards
        if (targetId === "program-overview") {
          const cards = Array.from(target.querySelectorAll("[data-program-overview-card]"));
          if (cards.length) {
            let cardIndex = 0;
            const nextCard = () => {
              if (cardIndex >= cards.length) return;
              const card = cards[cardIndex];
              const curX = cardIndex === 0 ? fromX : (parseFloat(guideCursor.style.left) || window.innerWidth / 2);
              const curY = cardIndex === 0 ? fromY : (parseFloat(guideCursor.style.top) || window.innerHeight / 2);
              
              animateToTarget(curX, curY, card, () => {
                pulseTarget(card);
                cardIndex++;
                window.setTimeout(nextCard, 300);
              });
            };
            nextCard();
          }
        } else {
          // Standard behavior for other links
          animateToTarget(fromX, fromY, target, () => {
            pulseTarget(target);
          });
        }

        if (history.pushState) {
          history.pushState(null, "", `#${targetId}`);
          window.dispatchEvent(new HashChangeEvent("hashchange"));
        }
      }, 100);
    });
  });

  guidedClicks.forEach((link) => {
    link.addEventListener("click", () => {
      const linkRect = link.getBoundingClientRect();
      const fromX = linkRect.left + linkRect.width / 2;
      const fromY = linkRect.top + linkRect.height / 2;
      animateToTarget(fromX, fromY, link, () => pulseTarget(link));
    });
  });
}

function closeAllDropdowns() {
  const dropdowns = Array.from(document.querySelectorAll("[id$='dropdown'], [id$='Dropdown']"));
  dropdowns.forEach(dropdown => {
    if (!dropdown.classList.contains("hidden")) {
      dropdown.classList.add("hidden");
    }
  });
}

export function initDropdownAutoClose() {
  const navChoices = Array.from(document.querySelectorAll("#navbar-multi-level-dropdown a, #navbar-multi-level-dropdown button[data-modal-target]"));
  
  navChoices.forEach(choice => {
    choice.addEventListener("click", () => {
      closeAllDropdowns();
      const mobileMenu = document.getElementById("navbar-multi-level-dropdown");
      if (mobileMenu && !mobileMenu.classList.contains("hidden")) {
        mobileMenu.classList.add("hidden");
      }
    });
  });

  const modalTriggers = Array.from(document.querySelectorAll("[data-modal-target]"));
  modalTriggers.forEach(trigger => {
    trigger.addEventListener("click", () => {
      closeAllDropdowns();
      const modalId = trigger.getAttribute("data-modal-target");
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.add("flex", "items-center", "justify-center");
        modal.classList.remove("hidden");
      }
    });
  });
}
// --- FUNCTION: INIT GUIDED ANCHOR EFFECTS (END) ---

// --- FUNCTION: INIT ROUTE PAGE LINKS (START) ---
export function initRoutePageLinks() {
  const routeLinks = Array.from(document.querySelectorAll("[data-route-page]"));
  if (!routeLinks.length) return;

  routeLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetPage = link.getAttribute("data-route-page");
      if (!targetPage) return;
      event.preventDefault();
      window.location.href = targetPage;
    });
  });
}
// --- FUNCTION: INIT ROUTE PAGE LINKS (END) ---
// --- FUNCTION: APPLY CAROUSEL SMOOTHNESS (START) ---
export function applyCarouselSmoothness() {
  const items = Array.from(document.querySelectorAll("[data-carousel-item]"));
  items.forEach((item) => {
    item.classList.add("transition-opacity", "duration-1000", "ease-in-out");
  });
}
// --- FUNCTION: APPLY CAROUSEL SMOOTHNESS (END) ---
