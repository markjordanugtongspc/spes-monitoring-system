class PreferenceStorage {
  constructor() {
    this.localKey = "spes-auth-preferences";
    this.cookieName = "spes_session_meta";
  }

  // --- FUNCTION: HASH SENSITIVE VALUE VIA SHA-256 (START) ---
  async hashValue(value) {
    const encoder = new TextEncoder();
    const data = encoder.encode(value);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }
  // --- FUNCTION: HASH SENSITIVE VALUE VIA SHA-256 (END) ---

  // --- FUNCTION: SAVE AUTH PREFERENCES TO LOCALSTORAGE (START) ---
  async saveRememberMePreferences({ username, password, remember }) {
    const safePayload = {
      username: remember ? username : "",
      remember: Boolean(remember),
      passwordHash: remember && password ? await this.hashValue(password) : "",
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(this.localKey, JSON.stringify(safePayload));
  }
  // --- FUNCTION: SAVE AUTH PREFERENCES TO LOCALSTORAGE (END) ---

  // --- FUNCTION: READ AUTH PREFERENCES FROM LOCALSTORAGE (START) ---
  readRememberMePreferences() {
    try {
      const raw = localStorage.getItem(this.localKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch {
      return null;
    }
  }
  // --- FUNCTION: READ AUTH PREFERENCES FROM LOCALSTORAGE (END) ---

  // --- FUNCTION: SAVE SESSION METADATA TO COOKIE (START) ---
  saveSessionCookie({ username, role, remember }) {
    const payload = encodeURIComponent(
      JSON.stringify({
        username,
        role: role ?? "user",
        remember: Boolean(remember),
        issuedAt: Date.now()
      })
    );
    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 8;
    document.cookie = `${this.cookieName}=${payload}; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
  }
  // --- FUNCTION: SAVE SESSION METADATA TO COOKIE (END) ---

  // --- FUNCTION: SAVE TEMPORARY BENEFICIARY EDU SUB-LEVEL (START) ---
  saveBeneficiaryEduLevel(id, edulevel) {
    if (!id) return;
    try {
      const key = "spes_edu_sublevels";
      const raw = localStorage.getItem(key);
      const data = raw ? JSON.parse(raw) : {};
      if (edulevel) {
        data[String(id)] = edulevel;
      } else {
        delete data[String(id)];
      }
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn("Failed to save edulevel in localStorage", e);
    }
  }

  getBeneficiaryEduLevel(id) {
    if (!id) return "";
    try {
      const raw = localStorage.getItem("spes_edu_sublevels");
      if (!raw) return "";
      const data = JSON.parse(raw);
      return data[String(id)] || "";
    } catch {
      return "";
    }
  }
  // --- FUNCTION: SAVE TEMPORARY BENEFICIARY EDU SUB-LEVEL (END) ---

  // --- FUNCTION: SAVE PAGINATION PAGE TO LOCALSTORAGE (START) ---
  savePaginationPage(pageKey, page) {
    if (!pageKey) return;
    const pageNumber = Number.parseInt(page, 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) return;
    try {
      const storageKey = "spes-pagination-pages";
      const raw = localStorage.getItem(storageKey);
      const pages = raw ? JSON.parse(raw) : {};
      pages[String(pageKey)] = pageNumber;
      localStorage.setItem(storageKey, JSON.stringify(pages));
    } catch (e) {
      console.warn("Failed to save pagination page in localStorage", e);
    }
  }
  // --- FUNCTION: SAVE PAGINATION PAGE TO LOCALSTORAGE (END) ---

  // --- FUNCTION: READ PAGINATION PAGE FROM LOCALSTORAGE (START) ---
  getPaginationPage(pageKey) {
    if (!pageKey) return 0;
    try {
      const raw = localStorage.getItem("spes-pagination-pages");
      if (!raw) return 0;
      const pages = JSON.parse(raw);
      const pageNumber = Number.parseInt(pages?.[String(pageKey)], 10);
      return Number.isInteger(pageNumber) && pageNumber > 0 ? pageNumber : 0;
    } catch {
      return 0;
    }
  }
  // --- FUNCTION: READ PAGINATION PAGE FROM LOCALSTORAGE (END) ---

  // --- FUNCTION: SAVE PAYROLL DATA TO CACHE (START) ---
  savePayrollCache(data) {
    if (!data) return;
    try {
      const payload = {
        data,
        timestamp: Date.now()
      };
      sessionStorage.setItem("spes-payroll-cache", JSON.stringify(payload));
    } catch (e) {
      console.warn("Failed to save payroll cache", e);
    }
  }
  // --- FUNCTION: SAVE PAYROLL DATA TO CACHE (END) ---

  // --- FUNCTION: READ PAYROLL DATA FROM CACHE (START) ---
  getPayrollCache(maxAgeMs = 5 * 60 * 1000) {
    try {
      const raw = sessionStorage.getItem("spes-payroll-cache");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data) return null;
      if (Date.now() - parsed.timestamp > maxAgeMs) {
        sessionStorage.removeItem("spes-payroll-cache");
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }
  // --- FUNCTION: READ PAYROLL DATA FROM CACHE (END) ---

  // --- FUNCTION: HAS SEEN PAYROLL INTRO ANIMATION (START) ---
  hasSeenPayrollIntro() {
    try {
      return sessionStorage.getItem("spes-payroll-intro-seen") === "true";
    } catch {
      return false;
    }
  }
  // --- FUNCTION: HAS SEEN PAYROLL INTRO ANIMATION (END) ---

  // --- FUNCTION: MARK PAYROLL INTRO ANIMATION AS SEEN (START) ---
  markPayrollIntroSeen() {
    try {
      sessionStorage.setItem("spes-payroll-intro-seen", "true");
    } catch (e) {
      console.warn("Failed to mark payroll intro seen", e);
    }
  }
  // --- FUNCTION: MARK PAYROLL INTRO ANIMATION AS SEEN (END) ---

  // --- FUNCTION: SAVE CUSTOM GENERAL BUDGET ALLOCATION (START) ---
  saveCustomGeneralBudget(amount) {
    try {
      const num = Number(amount);
      if (Number.isFinite(num) && num >= 0) {
        localStorage.setItem("spes_payroll_custom_general_budget", String(num));
      } else {
        localStorage.removeItem("spes_payroll_custom_general_budget");
      }
    } catch (e) {
      console.warn("Failed to save custom general budget", e);
    }
  }
  // --- FUNCTION: SAVE CUSTOM GENERAL BUDGET ALLOCATION (END) ---

  // --- FUNCTION: READ CUSTOM GENERAL BUDGET ALLOCATION (START) ---
  getCustomGeneralBudget() {
    try {
      const raw = localStorage.getItem("spes_payroll_custom_general_budget");
      if (!raw) return null;
      const num = Number(raw);
      return Number.isFinite(num) && num > 0 ? num : null;
    } catch {
      return null;
    }
  }
  // --- FUNCTION: READ CUSTOM GENERAL BUDGET ALLOCATION (END) ---

  // --- FUNCTION: SAVE CUSTOM OFFICE BUDGET OVERRIDES (START) ---
  saveCustomOfficeBudget(officeId, amount) {
    if (!officeId) return;
    try {
      const raw = localStorage.getItem("spes_payroll_custom_office_budgets");
      const data = raw ? JSON.parse(raw) : {};
      const num = Number(amount);
      if (Number.isFinite(num) && num >= 0) {
        data[String(officeId)] = num;
      } else {
        delete data[String(officeId)];
      }
      localStorage.setItem("spes_payroll_custom_office_budgets", JSON.stringify(data));
    } catch (e) {
      console.warn("Failed to save custom office budget", e);
    }
  }
  // --- FUNCTION: SAVE CUSTOM OFFICE BUDGET OVERRIDES (END) ---

  // --- FUNCTION: READ CUSTOM OFFICE BUDGET OVERRIDES (START) ---
  getCustomOfficeBudgets() {
    try {
      const raw = localStorage.getItem("spes_payroll_custom_office_budgets");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }
  // --- FUNCTION: READ CUSTOM OFFICE BUDGET OVERRIDES (END) ---
}

export const preferenceStorage = new PreferenceStorage();
