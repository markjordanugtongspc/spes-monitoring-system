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
}

export const preferenceStorage = new PreferenceStorage();
