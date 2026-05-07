import { preferenceStorage } from "./storage";

// --- FUNCTION: INITIALIZE PASSWORD VISIBILITY TOGGLE (START) ---
export function initPasswordVisibilityToggle() {
  const passwordInput = document.getElementById("password");
  const toggleButton = document.getElementById("toggle-password-button");
  const eyeOpenIcon = document.getElementById("password-eye-open");
  const eyeClosedIcon = document.getElementById("password-eye-closed");
  if (!passwordInput || !toggleButton) return;

  toggleButton.addEventListener("click", () => {
    const revealPassword = passwordInput.type === "password";
    passwordInput.type = revealPassword ? "text" : "password";
    eyeOpenIcon?.classList.toggle("hidden", revealPassword);
    eyeClosedIcon?.classList.toggle("hidden", !revealPassword);
  });
}
// --- FUNCTION: INITIALIZE PASSWORD VISIBILITY TOGGLE (END) ---

// --- FUNCTION: INITIALIZE REMEMBER-ME PREFERENCES (START) ---
export async function initRememberMePreferences() {
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");
  const rememberCheckbox = document.getElementById("remember-me");
  const signInButton = document.getElementById("sign-in-button");
  if (!usernameInput || !passwordInput || !rememberCheckbox || !signInButton) return;

  const stored = preferenceStorage.readRememberMePreferences();
  if (stored?.remember && stored?.username) {
    usernameInput.value = stored.username;
    rememberCheckbox.checked = true;
  }

  const persistPreferences = async () => {
    await preferenceStorage.saveRememberMePreferences({
      username: usernameInput.value.trim(),
      password: passwordInput.value,
      remember: rememberCheckbox.checked
    });

    preferenceStorage.saveSessionCookie({
      username: usernameInput.value.trim(),
      role: "user",
      remember: rememberCheckbox.checked
    });
  };

  rememberCheckbox.addEventListener("change", persistPreferences);
  signInButton.addEventListener("click", persistPreferences);
}
// --- FUNCTION: INITIALIZE REMEMBER-ME PREFERENCES (END) ---
