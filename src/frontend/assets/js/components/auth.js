import { preferenceStorage } from "./storage";

// --- FUNCTION: INITIALIZE PASSWORD VISIBILITY TOGGLE (START) ---
export function initPasswordVisibilityToggle() {
  const setupToggle = (inputId, buttonId, openIconId, closedIconId) => {
    const passwordInput = document.getElementById(inputId);
    const toggleButton = document.getElementById(buttonId);
    const eyeOpenIcon = document.getElementById(openIconId);
    const eyeClosedIcon = document.getElementById(closedIconId);
    if (!passwordInput || !toggleButton) return;

    toggleButton.addEventListener("click", () => {
      const revealPassword = passwordInput.type === "password";
      passwordInput.type = revealPassword ? "text" : "password";
      eyeOpenIcon?.classList.toggle("hidden", revealPassword);
      eyeClosedIcon?.classList.toggle("hidden", !revealPassword);
    });
  };

  // Main login password
  setupToggle("password", "toggle-password-button", "password-eye-open", "password-eye-closed");

  // Registration passwords (Synced)
  const regPassword = document.getElementById("reg-password");
  const regConfirmPassword = document.getElementById("reg-confirm-password");
  
  const regToggle = document.getElementById("toggle-reg-password-button");
  const regConfirmToggle = document.getElementById("toggle-reg-confirm-password-button");

  const regEyeOpen = document.getElementById("reg-password-eye-open");
  const regEyeClosed = document.getElementById("reg-password-eye-closed");
  
  const regConfirmEyeOpen = document.getElementById("reg-confirm-password-eye-open");
  const regConfirmEyeClosed = document.getElementById("reg-confirm-password-eye-closed");

  const syncToggle = () => {
    if (!regPassword || !regConfirmPassword) return;
    const reveal = regPassword.type === "password";
    const type = reveal ? "text" : "password";
    
    regPassword.type = type;
    regConfirmPassword.type = type;

    regEyeOpen?.classList.toggle("hidden", reveal);
    regEyeClosed?.classList.toggle("hidden", !reveal);
    
    regConfirmEyeOpen?.classList.toggle("hidden", reveal);
    regConfirmEyeClosed?.classList.toggle("hidden", !reveal);
  };

  regToggle?.addEventListener("click", syncToggle);
  regConfirmToggle?.addEventListener("click", syncToggle);
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
