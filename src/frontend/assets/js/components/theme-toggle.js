// --- FUNCTION: INITIALIZE DARK MODE TOGGLE (START) ---
export function initThemeToggle() {
  const root = document.documentElement;
  const toggleButtons = Array.from(document.querySelectorAll("#theme-toggle, #theme-toggle-mobile, #quick-settings, #quick-settings-mob"));
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

    // Dynamic text for Quick Access Theme Toggles
    const txtEls = document.querySelectorAll("#quick-settings-text, #quick-settings-mob-text");
    txtEls.forEach(el => {
      el.textContent = el.id.includes("mob") 
        ? (isDark ? "Light" : "Dark") 
        : (isDark ? "Light Mode" : "Dark Mode");
    });
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
