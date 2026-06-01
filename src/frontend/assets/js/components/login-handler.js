/**
 * SPES Portal — Login Handler
 * ────────────────────────────
 * Handles the sign-in button click on the login page.
 * Authenticates via Supabase staffs table and redirects
 * to the appropriate dashboard based on the user's role.
 */
import { loginImplementor } from "../../../../backend/api/auth.js";
import { modals } from "./modals.js";

export function initLoginHandler() {
  const signInBtn = document.getElementById("sign-in-button");
  const usernameInput = document.getElementById("username");
  const passwordInput = document.getElementById("password");

  if (!signInBtn || !usernameInput || !passwordInput) return;

  // Handle sign-in click
  signInBtn.addEventListener("click", handleLogin);

  // Handle Enter key on inputs
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleLogin();
  });
  usernameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") passwordInput.focus();
  });

  async function handleLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      modals.error("Missing Credentials", "Please enter both username and password.");
      return;
    }

    // Disable button and show loading
    signInBtn.disabled = true;
    signInBtn.textContent = "Signing in...";
    signInBtn.classList.add("opacity-70", "pointer-events-none");
    
    modals.loading("Authenticating", "Please wait while we verify your credentials...");

    try {
      const result = await loginImplementor(username, password);


      modals.close();

      if (result.success) {
        // Redirect directly to the unified dashboard
        window.location.href = "../pages/dashboard/";
      } else {
        modals.error("Login Failed", result.error || "Invalid username or password.");
        signInBtn.disabled = false;
        signInBtn.textContent = "Sign In";
        signInBtn.classList.remove("opacity-70", "pointer-events-none");
      }
    } catch (err) {
      modals.close();
      console.error("[SPES] Login handler error:", err);
      modals.error("System Error", "An unexpected error occurred. Please try again later.");
      signInBtn.disabled = false;
      signInBtn.textContent = "Sign In";
      signInBtn.classList.remove("opacity-70", "pointer-events-none");
    }
  }
}



