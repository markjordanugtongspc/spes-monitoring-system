// --- FUNCTION: AUTO INPUT CURRENT YEAR (START) ---
export function initAutoYear() {
  const yearElements = Array.from(document.querySelectorAll("[data-auto-year]"));
  if (!yearElements.length) return;
  const currentYear = String(new Date().getFullYear());
  yearElements.forEach((element) => {
    element.textContent = currentYear;
  });
}
// --- FUNCTION: AUTO INPUT CURRENT YEAR (END) ---
