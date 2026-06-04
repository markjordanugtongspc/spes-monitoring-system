/**
 * SPES Portal — Animations & UI Effects (Unified)
 * ─────────────────────────────────────────────────────────────
 * Merged from: animation.js + animations.js
 *
 * Exports:
 *  - applyDrawerAnimationClasses
 *  - animateMobileSplashVisibility
 *  - initLandingHeroAnimation
 *  - initLandingActiveNavHighlight
 *  - initStickyCardHoverAnimation
 *  - initGuidedAnchorEffects
 *  - initDropdownAutoClose
 *  - initRoutePageLinks
 *  - applyCarouselSmoothness
 *  - initQuickAccessCarousel  (dashboard mobile swipe — legacy no-op if removed)
 *  - initQuickAccessPremiumInteractions
 */


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 1 — DRAWER & SPLASH ANIMATIONS (from animation.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 2 — LANDING PAGE ANIMATIONS (from animation.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 3 — GUIDED ANCHOR + DROPDOWN (from animation.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function closeAllDropdowns() {
  const dropdowns = Array.from(document.querySelectorAll("[id$='dropdown'], [id$='Dropdown']"));
  dropdowns.forEach(dropdown => {
    if (!dropdown.classList.contains("hidden")) {
      dropdown.classList.add("hidden");
    }
  });
}

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
    guideCursor.style.left = `${fromX}px`;
    guideCursor.style.top = `${fromY}px`;
    guideCursor.classList.remove("opacity-0", "duration-500", "scale-90", "scale-110", "scale-150");
    guideCursor.classList.add("opacity-100", "scale-100");

    window.requestAnimationFrame(() => {
      const rect = targetElement.getBoundingClientRect();
      const toX = rect.left + rect.width / 2;
      const toY = rect.top + 20;

      guideCursor.classList.add("duration-500");
      guideCursor.style.left = `${toX}px`;
      guideCursor.style.top = `${toY}px`;

      window.setTimeout(() => {
        guideCursor.classList.remove("duration-500");
        guideCursor.classList.add("duration-150", "scale-90");

        window.setTimeout(() => {
          guideCursor.classList.remove("scale-90");
          guideCursor.classList.add("scale-110");

          blinkIndicator.style.left = `${toX}px`;
          blinkIndicator.style.top = `${toY}px`;
          blinkIndicator.classList.remove("opacity-0", "scale-150");
          blinkIndicator.classList.add("opacity-100", "scale-100");

          window.setTimeout(() => {
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


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 4 — ROUTING & CAROUSEL HELPERS (from animation.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 5 — QUICK ACCESS HUB (from animations.js)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- FUNCTION: INITIALIZE QUICK ACCESS CAROUSEL (START) ---
/**
 * Legacy carousel wrapper. The mobile view now uses native CSS snap scroll,
 * so this function is kept for backwards compatibility but is essentially a no-op
 * if the #quick-access-carousel element is absent.
 */
export function initQuickAccessCarousel() {
  const carousel = document.getElementById("quick-access-carousel");
  if (!carousel) return; // No-op: mobile now uses snap-scroll flex list

  const items = Array.from(carousel.querySelectorAll("[data-carousel-item]"));
  if (items.length === 0) return;

  let activeIndex = 0;

  const showSlide = (index) => {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.remove("hidden");
        item.classList.add("flex");
      } else {
        item.classList.add("hidden");
        item.classList.remove("flex");
      }
    });
  };

  showSlide(activeIndex);

  carousel.querySelector("[data-carousel-prev]")?.addEventListener("click", () => {
    activeIndex = (activeIndex - 1 + items.length) % items.length;
    showSlide(activeIndex);
  });

  carousel.querySelector("[data-carousel-next]")?.addEventListener("click", () => {
    activeIndex = (activeIndex + 1) % items.length;
    showSlide(activeIndex);
  });
}
// --- FUNCTION: INITIALIZE QUICK ACCESS CAROUSEL (END) ---


// --- FUNCTION: INITIALIZE QUICK ACCESS PREMIUM INTERACTIONS (START) ---
/**
 * Attaches a premium particle blast and smooth hover scaling to Quick Access buttons.
 */
export function initQuickAccessPremiumInteractions() {
  const buttons = document.querySelectorAll(
    "#quick-add-implementor, #quick-add-beneficiary, #quick-add-implementor-mob, #quick-add-beneficiary-mob"
  );

  buttons.forEach(button => {
    const wrapper = button.parentElement;
    if (wrapper) wrapper.style.position = "relative";

    button.addEventListener("click", (e) => {
      createPremiumParticles(e, button);
    });
  });
}

function createPremiumParticles(event, element) {
  const particleContainer = document.createElement("div");
  particleContainer.style.cssText = "position:absolute;pointer-events:none;top:0;left:0;width:100%;height:100%;z-index:999;";
  element.appendChild(particleContainer);

  const colors = ["#0038A8", "#FCD116", "#10B981", "#3B82F6"]; // Brand colors

  for (let i = 0; i < 12; i++) {
    const particle = document.createElement("div");
    particle.style.cssText = `
      position:absolute;
      width:${Math.random() * 4 + 3}px;
      height:${Math.random() * 4 + 3}px;
      border-radius:50%;
      background-color:${colors[Math.floor(Math.random() * colors.length)]};
      top:50%;left:50%;
      transform:translate(-50%,-50%);
      transition:all 0.6s cubic-bezier(0.1,0.8,0.3,1);
    `;
    particleContainer.appendChild(particle);

    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 40 + 20;
    const x = Math.cos(angle) * distance;
    const y = Math.sin(angle) * distance;

    requestAnimationFrame(() => {
      particle.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px)) scale(0)`;
      particle.style.opacity = "0";
    });
  }

  setTimeout(() => particleContainer.remove(), 700);
}
// --- FUNCTION: INITIALIZE QUICK ACCESS PREMIUM INTERACTIONS (END) ---

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 6 — LOGIN DOUBLE SLIDER ANIMATION
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- FUNCTION: INITIALIZE LOGIN SLIDER (START) ---
export function initLoginSignupSlider() {
  const btnShowRegister = document.getElementById('btn-show-register');
  const btnShowLogin = document.getElementById('btn-show-login');
  const leftTrack = document.getElementById('left-overlay-track');
  const rightTrack = document.getElementById('right-form-track');
  
  const panelLeft = document.getElementById('panel-left');
  const panelRight = document.getElementById('panel-right');
  const loginContainer = document.getElementById('login-form-container');
  const signupContainer = document.getElementById('signup-form-container');

  if (!btnShowRegister || !btnShowLogin || !leftTrack || !rightTrack || !panelLeft || !panelRight) return;

  btnShowRegister.addEventListener('click', () => {
    // Pause the background image slider for 3 seconds to prevent motion sickness during swap
    window.dispatchEvent(new CustomEvent('pause-login-carousel', { detail: { duration: 3000 } }));

    const isMobile = window.innerWidth < 1024;

    if (isMobile) {
      // Mobile View: Custom Pop out / Pop up
      panelLeft.style.transform = 'none';
      panelRight.style.transform = 'none';
      leftTrack.style.transform = 'none';
      rightTrack.style.transform = 'none';

      if (loginContainer && signupContainer) {
        // Pop out login: scale down, fade out
        loginContainer.classList.add('scale-95', 'opacity-0', 'pointer-events-none');
        
        setTimeout(() => {
          loginContainer.classList.add('max-lg:hidden', 'absolute', 'top-2', 'left-0', 'right-0');
          
          // Pop up signup in front: prepare initial state, make visible, and scale up
          signupContainer.classList.remove('max-lg:hidden');
          signupContainer.style.zIndex = '30';
          
          // Micro-tick for browser paint animation
          requestAnimationFrame(() => {
            signupContainer.classList.remove('max-lg:opacity-0', 'max-lg:scale-95', 'max-lg:pointer-events-none');
            signupContainer.classList.add('scale-100', 'opacity-100', 'pointer-events-auto');
          });
        }, 300);
      }
    } else {
      // Desktop View: Sliding animation
      if (loginContainer && signupContainer) {
        loginContainer.classList.remove('scale-95', 'opacity-0', 'pointer-events-none', 'max-lg:hidden', 'absolute', 'top-2', 'left-0', 'right-0');
        signupContainer.classList.remove('scale-100', 'opacity-100', 'pointer-events-auto', 'max-lg:hidden', 'scale-95', 'max-lg:opacity-0', 'max-lg:pointer-events-none');
        signupContainer.style.zIndex = '';
      }

      panelLeft.style.transform = 'translateX(100%)';
      panelRight.style.transform = 'translateX(-100%)';
      leftTrack.style.transform = 'translateX(-50%)';
      rightTrack.style.transform = 'translateX(-50%)';
    }
  });

  btnShowLogin.addEventListener('click', () => {
    // Pause the background image slider for 3 seconds to prevent motion sickness during swap
    window.dispatchEvent(new CustomEvent('pause-login-carousel', { detail: { duration: 3000 } }));

    const isMobile = window.innerWidth < 1024;

    if (isMobile) {
      panelLeft.style.transform = 'none';
      panelRight.style.transform = 'none';
      leftTrack.style.transform = 'none';
      rightTrack.style.transform = 'none';

      if (loginContainer && signupContainer) {
        // Pop out signup
        signupContainer.classList.remove('scale-100', 'opacity-100', 'pointer-events-auto');
        signupContainer.classList.add('max-lg:opacity-0', 'max-lg:scale-95', 'max-lg:pointer-events-none');
        
        setTimeout(() => {
          signupContainer.classList.add('max-lg:hidden');
          
          // Pop up login
          loginContainer.classList.remove('max-lg:hidden', 'absolute', 'top-2', 'left-0', 'right-0');
          requestAnimationFrame(() => {
            loginContainer.classList.remove('scale-95', 'opacity-0', 'pointer-events-none');
            loginContainer.classList.add('scale-100', 'opacity-100', 'pointer-events-auto');
          });
        }, 300);
      }
    } else {
      if (loginContainer && signupContainer) {
        loginContainer.classList.remove('scale-95', 'opacity-0', 'pointer-events-none', 'max-lg:hidden', 'absolute', 'top-2', 'left-0', 'right-0');
        signupContainer.classList.remove('scale-100', 'opacity-100', 'pointer-events-auto', 'max-lg:hidden', 'scale-95', 'max-lg:opacity-0', 'max-lg:pointer-events-none');
        signupContainer.style.zIndex = '';
      }

      panelLeft.style.transform = 'translateX(0)';
      panelRight.style.transform = 'translateX(0)';
      leftTrack.style.transform = 'translateX(0)';
      rightTrack.style.transform = 'translateX(0)';
    }
  });
}
// --- FUNCTION: INITIALIZE LOGIN SLIDER (END) ---

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SECTION 7 — EXPORT BUTTON TILT EFFECT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// --- FUNCTION: INIT EXPORT BUTTON TILT (START) ---
/**
 * Applies a skew-tilt hover effect to any element with [data-tilt-btn].
 * On mouseenter: skews left (parallelogram lean) + lifts slightly.
 * On mouseleave: resets to flat.
 */
export function initExportButtonTilt() {
  const TILT_STYLE  = "skewX(-6deg) translateY(-2px)";
  const RESET_STYLE = "skewX(0deg) translateY(0)";
  const TRANSITION  = "transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1)";

  document.querySelectorAll("[data-tilt-btn]").forEach(btn => {
    btn.style.transition = TRANSITION;

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = TILT_STYLE;
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = RESET_STYLE;
    });
    btn.addEventListener("mousedown", () => {
      btn.style.transform = "skewX(-3deg) translateY(1px) scale(0.97)";
    });
    btn.addEventListener("mouseup", () => {
      btn.style.transform = TILT_STYLE;
    });
  });
}
// --- FUNCTION: INIT EXPORT BUTTON TILT (END) ---

// --- FUNCTION: DYNAMIC PASSWORD REVEAL (START) ---
export function initPasswordConfirmReveal() {
  const regPassword = document.getElementById('reg-password');
  const confirmContainer = document.getElementById('reg-confirm-password-container');

  if (!regPassword || !confirmContainer) return;

  regPassword.addEventListener('input', () => {
    if (regPassword.value.length > 0) {
      confirmContainer.classList.remove('hidden');
      setTimeout(() => {
        confirmContainer.classList.remove('opacity-0', 'translate-y-2');
        confirmContainer.classList.add('opacity-100', 'translate-y-0');
      }, 10);
    } else {
      confirmContainer.classList.remove('opacity-100', 'translate-y-0');
      confirmContainer.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => {
        if (regPassword.value.length === 0) {
          confirmContainer.classList.add('hidden');
        }
      }, 300);
    }
  });
}
// --- FUNCTION: DYNAMIC PASSWORD REVEAL (END) ---
