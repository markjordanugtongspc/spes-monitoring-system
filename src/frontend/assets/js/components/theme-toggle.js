// --- FUNCTION: INITIALIZE DARK MODE TOGGLE (START) ---
export function initThemeToggle() {
  const root = document.documentElement;
  const toggleButton = document.getElementById("theme-toggle");
  const darkIcon = document.getElementById("theme-toggle-dark-icon");
  const lightIcon = document.getElementById("theme-toggle-light-icon");
  if (!toggleButton) return;

  const savedTheme = localStorage.getItem("color-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initialDark = savedTheme ? savedTheme === "dark" : prefersDark;
  root.classList.toggle("dark", initialDark);

  const updateIcons = () => {
    const isDark = root.classList.contains("dark");
    darkIcon?.classList.toggle("hidden", isDark);
    lightIcon?.classList.toggle("hidden", !isDark);
  };

  updateIcons();

  toggleButton.addEventListener("click", () => {
    root.classList.toggle("dark");
    localStorage.setItem("color-theme", root.classList.contains("dark") ? "dark" : "light");
    updateIcons();
  });
}
// --- FUNCTION: INITIALIZE DARK MODE TOGGLE (END) ---
