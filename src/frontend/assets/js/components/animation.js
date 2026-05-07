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
