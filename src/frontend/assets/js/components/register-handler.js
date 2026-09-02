import { registerImplementor } from "../../../../backend/api/auth.js";
import { modals } from "./modals.js";

export function initRegisterHandler() {
  const registerForm = document.getElementById("form-register-implementor");
  const submitBtn = document.getElementById("register-submit-button");

  if (!registerForm || !submitBtn) return;

  const passwordInput = document.getElementById("reg-password");
  const confirmPasswordInput = document.getElementById("reg-confirm-password");
  const passwordError = document.getElementById("reg-password-error");

  const checkFormValidity = () => {
    // Check if passwords match
    const pwd = passwordInput?.value || "";
    const confirmPwd = confirmPasswordInput?.value || "";
    
    // Only show error if user has typed something in both
    const mismatch = pwd !== confirmPwd && confirmPwd.length > 0;
    
    if (mismatch) {
      passwordError?.classList.remove("hidden");
    } else {
      passwordError?.classList.add("hidden");
    }

    // Check overall form validity + password match
    const isValid = registerForm.checkValidity() && pwd === confirmPwd && pwd.length > 0;
    
    if (isValid) {
      submitBtn.disabled = false;
      submitBtn.classList.remove("opacity-50", "cursor-not-allowed");
    } else {
      submitBtn.disabled = true;
      submitBtn.classList.add("opacity-50", "cursor-not-allowed");
    }
  };

  // Add event listeners for real-time validation
  registerForm.addEventListener("input", checkFormValidity);
  
  // Initial check on load
  checkFormValidity();

  registerForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fullName = document.getElementById("reg-full-name")?.value.trim();
    const username = document.getElementById("reg-username")?.value.trim();
    const email = document.getElementById("reg-email")?.value.trim();
    const password = document.getElementById("reg-password")?.value;
    const confirmPassword = document.getElementById("reg-confirm-password")?.value;
    const officeId = document.getElementById("reg-office")?.value;
    const address = document.getElementById("reg-address")?.value.trim();
    const religion = document.getElementById("reg-religion")?.value.trim();
    const language = document.getElementById("reg-language")?.value.trim();
    const bloodType = document.getElementById("reg-blood-type")?.value;
    const phone = document.getElementById("reg-phone")?.value.trim();

    // Check validity on submit as a fallback
    if (!registerForm.checkValidity()) {
      registerForm.reportValidity();
      return;
    }

    // Basic Validation
    if (!fullName || !username || !email || !password || !confirmPassword || !officeId) {
      modals.error("Missing Fields", "Please fill in all required fields marked with an asterisk (*).");
      return;
    }

    if (password !== confirmPassword) {
      modals.error("Password Mismatch", "Your password and confirm password do not match.");
      return;
    }

    // Disable button and show loading modal
    submitBtn.disabled = true;
    submitBtn.textContent = "Registering...";
    submitBtn.classList.add("opacity-70", "pointer-events-none");
    
    modals.loading("Creating Account", "Please wait while we set up your implementor access...");

    const staffData = {
      full_name: fullName,
      username: username,
      email: email,
      password: password,
      office_id: parseInt(officeId, 10),
      phone: phone || null,
      religion: religion || null,
      language: language || null,
    };

    try {
      const result = await registerImplementor(staffData);

      modals.close();

      if (result.success) {
        await modals.success(
          "Registration Successful!",
          "Your account has been created. You can now sign in using your credentials."
        );
        
        // Clear the form safely only on success
        registerForm.reset();
        
        // Auto-switch back to the Sign In panel
        const btnShowLogin = document.getElementById('btn-show-login');
        if (btnShowLogin) btnShowLogin.click();
        
      } else {
        modals.error("Registration Failed", result.error || "Could not create your account.");
      }
    } catch (err) {
      modals.close();
      if (import.meta.env.DEV) console.error("[SPES] Register handler error");
      modals.error("System Error", "An unexpected error occurred. Please try again later.");
    } finally {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Registration";
      submitBtn.classList.remove("opacity-70", "pointer-events-none");
    }
  });
}
