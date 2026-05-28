// --- FUNCTION: INITIALIZE DARK MODE TOGGLE (START) ---
export function initThemeToggle() {
  const root = document.documentElement;
  const toggleButtons = Array.from(document.querySelectorAll("#theme-toggle, #theme-toggle-mobile"));
  const darkIcon = document.getElementById("theme-toggle-dark-icon");
  const lightIcon = document.getElementById("theme-toggle-light-icon");

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

  toggleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      root.classList.toggle("dark");
      localStorage.setItem("color-theme", root.classList.contains("dark") ? "dark" : "light");
      updateIcons();
    });
  });
}
// --- FUNCTION: INITIALIZE DARK MODE TOGGLE (END) ---
