const STORAGE_KEY = "spes_program_overview_cards_seen";

function wasReload() {
  if (typeof performance === "undefined") return false;
  const entry = performance.getEntriesByType?.("navigation")?.[0];
  if (entry && "type" in entry) return entry.type === "reload";
  const legacyNav = performance.navigation;
  if (legacyNav && typeof legacyNav.type === "number") return legacyNav.type === 1;
  return false;
}

function revealCards(cards) {
  cards.forEach((card) => {
    card.querySelector("[data-program-card-skeleton]")?.classList.add("hidden");
    card.querySelector("[data-program-card-content]")?.classList.remove("hidden");
    card.removeAttribute("aria-busy");
  });
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function initProgramOverviewCards() {
  const cards = document.querySelectorAll("[data-program-overview-card]");
  if (!cards.length) return;

  let seen = false;
  try {
    seen = localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    seen = false;
  }

  const reload = wasReload();
  const skipSkeleton = seen && !reload;

  if (skipSkeleton) {
    revealCards(cards);
    return;
  }

  cards.forEach((card) => {
    card.setAttribute("aria-busy", "true");
    card.querySelector("[data-program-card-skeleton]")?.classList.remove("hidden");
    card.querySelector("[data-program-card-content]")?.classList.add("hidden");
  });

  window.setTimeout(() => revealCards(cards), 820);
}
