/**
 * SPES Portal — Account Settings Component
 * ─────────────────────────────────────────
 * Self-service profile editor available to EVERY logged-in role.
 * Lets a user update: Full Name, Address, Religion, Language,
 * Blood Type and Password. Username / email / role / office are
 * read-only here (admin-managed elsewhere).
 *
 * Mirrors the field set of the Edit Implementor drawer but writes
 * only to the caller's own record via backend/api/settings.js.
 */
import { fetchOwnProfile, updateOwnProfile } from "../../../../backend/api/settings.js";
import { getSession } from "../rbac/guard.js";
import { modals } from "./modals.js";
import { animateCounter, isCounterAnimationEnabled, setCounterAnimationEnabled } from "./animations.js";

const _g = (id) => document.getElementById(id);

function _setVal(id, val) {
  const el = _g(id);
  if (el) el.value = val ?? "";
}

function _initials(name) {
  return (name || "U").split(" ").filter(Boolean).map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

// ── Password show/hide toggles ────────────────────────────────
function _wirePasswordToggle(btnId, inputId) {
  const btn = _g(btnId);
  const input = _g(inputId);
  if (!btn || !input) return;
  btn.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    btn.querySelector("[data-eye-open]")?.classList.toggle("hidden", show);
    btn.querySelector("[data-eye-closed]")?.classList.toggle("hidden", !show);
  });
}

// ── Live password strength meter ──────────────────────────────
function _scorePassword(pw) {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

function _renderStrength(pw) {
  const bar = _g("set-pw-strength-bar");
  const label = _g("set-pw-strength-label");
  if (!bar || !label) return;

  if (!pw) {
    bar.style.width = "0%";
    bar.className = "h-full rounded-full transition-all duration-300 w-0";
    label.textContent = "";
    return;
  }

  const score = _scorePassword(pw);
  const tiers = [
    { w: "25%", cls: "bg-red-500",     txt: "Weak" },
    { w: "50%", cls: "bg-amber-500",   txt: "Fair" },
    { w: "75%", cls: "bg-sky-500",     txt: "Good" },
    { w: "100%", cls: "bg-emerald-500", txt: "Strong" },
  ];
  const t = tiers[Math.max(0, score - 1)];
  bar.style.width = t.w;
  bar.className = `h-full rounded-full transition-all duration-300 ${t.cls}`;
  label.textContent = t.txt;
  label.className = `text-[10px] font-black uppercase tracking-wider ${
    t.txt === "Weak" ? "text-red-500" : t.txt === "Fair" ? "text-amber-500" : t.txt === "Good" ? "text-sky-500" : "text-emerald-500"
  }`;
}

// ── Appearance preferences (device-local) ─────────────────────
// Text size scales the root font-size so rem-based UI grows uniformly.
const TEXT_SIZES = [
  { key: "normal", label: "Normal",      pct: "100%" },
  { key: "large",  label: "Large",       pct: "112.5%" },
  { key: "xl",     label: "Extra Large", pct: "125%" },
];
const TEXT_SIZE_KEY = "spes-text-size";

export function applyTextSize(idx) {
  const tier = TEXT_SIZES[Math.max(0, Math.min(2, idx))] || TEXT_SIZES[0];
  document.documentElement.style.fontSize = tier.pct;
  document.documentElement.setAttribute("data-text-scale", tier.key);
  return tier;
}

export function initAppearancePrefs() {
  // ── Text size slider ──────────────────────────────────────
  const slider = _g("text-size-slider");
  const label  = _g("text-size-label");
  const saved  = parseInt(localStorage.getItem(TEXT_SIZE_KEY) ?? "0", 10) || 0;

  const sync = (idx) => {
    const tier = applyTextSize(idx);
    if (label) label.textContent = tier.label;
    if (slider) slider.value = String(idx);
  };
  sync(saved);

  slider?.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10) || 0;
    localStorage.setItem(TEXT_SIZE_KEY, String(idx));
    sync(idx);
  });

  // ── Theme button label sync (handler lives in theme-toggle.js) ──
  const themeText = _g("theme-toggle-text");
  const setThemeLabel = () => {
    if (themeText) themeText.textContent = document.documentElement.classList.contains("dark") ? "Light Mode" : "Dark Mode";
  };
  setThemeLabel();
  window.addEventListener("theme-changed", setThemeLabel);

  // ── Counter animations preference & interactive hover preview ──
  const toggleCounter = _g("toggle-counter-animations");
  const badgeCounter = _g("counter-anim-badge");
  const cardCounter = _g("counter-anim-setting-card");
  const previewCurrency = _g("counter-preview-currency");
  const previewPercent = _g("counter-preview-percent");
  const previewPulse = _g("counter-preview-pulse");
  const previewBox = _g("counter-anim-preview-box");

  const syncCounterUI = (enabled) => {
    if (toggleCounter) toggleCounter.checked = enabled;
    if (badgeCounter) {
      if (enabled) {
        badgeCounter.textContent = "Enabled (Smooth)";
        badgeCounter.className = "inline-flex shrink-0 bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded transition-colors";
      } else {
        badgeCounter.textContent = "Disabled (Fast)";
        badgeCounter.className = "inline-flex shrink-0 bg-gray-200 text-spes-black/60 dark:bg-white/10 dark:text-white/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded transition-colors";
      }
    }
  };

  syncCounterUI(isCounterAnimationEnabled());

  // Curated preview data cycles showing realistic SPES metrics
  const PREVIEW_CYCLES = [
    { currency: 5133.00, percent: 100, pulseColor: "bg-emerald-500" },
    { currency: 184788.00, percent: 94.2, pulseColor: "bg-spes-blue" },
    { currency: 1250000.00, percent: 98.5, pulseColor: "bg-spes-yellow" },
    { currency: 5133.00, percent: 100, pulseColor: "bg-emerald-500" }
  ];

  let hoverLoopCount = 0;
  let hoverTimer = null;
  let isHovering = false;

  const runPreviewAnimationCycle = (singleCycle = false) => {
    const cycleData = PREVIEW_CYCLES[hoverLoopCount % PREVIEW_CYCLES.length];
    hoverLoopCount++;

    if (previewPulse) {
      previewPulse.className = `flex h-2 w-2 rounded-full transition-all duration-300 ${cycleData.pulseColor} shadow-xs scale-110`;
      setTimeout(() => {
        if (previewPulse) previewPulse.classList.remove("scale-110");
      }, 350);
    }

    if (previewCurrency) {
      animateCounter(previewCurrency, cycleData.currency, {
        isCurrency: true,
        duration: 750,
        forceFromZero: true,
        forceAnimate: true,
      });
    }

    if (previewPercent) {
      animateCounter(previewPercent, cycleData.percent, {
        suffix: "%",
        decimals: cycleData.percent % 1 !== 0 ? 1 : 0,
        duration: 750,
        forceFromZero: true,
        forceAnimate: true,
      });
    }

    if (!singleCycle && isHovering && hoverLoopCount < 4) {
      hoverTimer = setTimeout(() => {
        if (isHovering) runPreviewAnimationCycle();
      }, 1250);
    }
  };

  toggleCounter?.addEventListener("change", (e) => {
    const enabled = e.target.checked;
    setCounterAnimationEnabled(enabled);
    syncCounterUI(enabled);

    // Instant micro-animation feedback when clicking the switch
    if (previewBox) {
      previewBox.classList.add("ring-2", "ring-spes-blue/30", "dark:ring-spes-yellow/30");
      setTimeout(() => previewBox.classList.remove("ring-2", "ring-spes-blue/30", "dark:ring-spes-yellow/30"), 600);
    }
    hoverLoopCount = 0;
    runPreviewAnimationCycle(true);
  });

  if (cardCounter) {
    cardCounter.addEventListener("mouseenter", () => {
      isHovering = true;
      hoverLoopCount = 0;
      if (hoverTimer) clearTimeout(hoverTimer);
      runPreviewAnimationCycle();
    });

    cardCounter.addEventListener("mouseleave", () => {
      isHovering = false;
      if (hoverTimer) clearTimeout(hoverTimer);
    });
  }
}

// ── Main export ───────────────────────────────────────────────
export async function initSettings() {
  const form = _g("settings-form");
  if (!form) return;

  const session = getSession();
  if (!session?.id) {
    modals.error("Session Error", "We couldn't identify your account. Please sign in again.");
    return;
  }

  // ── Identity (read-only) header bits ────────────────────────
  const setText = (id, val) => { const el = _g(id); if (el) el.textContent = val; };
  setText("set-identity-name", session.full_name || "—");
  setText("set-identity-username", session.username ? `@${session.username}` : "");
  setText("set-identity-role", (session.role_label || session.role || "").toUpperCase());
  setText("set-avatar", _initials(session.full_name));

  // ── Load fresh profile from DB (session may be stale) ───────
  const { data, error } = await fetchOwnProfile(session.id);
  const profile = error ? session : (data || session);

  if (!error && data) {
    setText("set-identity-name", data.full_name || "—");
    setText("set-identity-username", data.username ? `@${data.username}` : "");
    setText("set-identity-role", (data.roles?.name || session.role || "").toUpperCase());
    setText("set-avatar", _initials(data.full_name));
    // Read-only context fields
    _setVal("set-username", data.username);
    _setVal("set-email", data.email);
    const offEl = _g("set-office");
    if (offEl) offEl.value = data.offices?.name ?? "—";
  } else {
    _setVal("set-username", session.username);
    _setVal("set-email", session.email);
  }

  // ── Editable fields ─────────────────────────────────────────
  _setVal("set-full-name", profile.full_name);
  _setVal("set-address", profile.address);
  _setVal("set-religion", profile.religion);
  _setVal("set-language", profile.language);
  _setVal("set-blood-type", profile.blood_type);

  // ── Password UX ─────────────────────────────────────────────
  _wirePasswordToggle("set-pw-toggle", "set-password");
  _wirePasswordToggle("set-pw-confirm-toggle", "set-password-confirm");
  _g("set-password")?.addEventListener("input", (e) => _renderStrength(e.target.value));

  // ── Inline error helpers ────────────────────────────────────
  const errBox = _g("settings-error");
  const showErr = (msg) => { if (errBox) { errBox.textContent = msg; errBox.classList.remove("hidden"); } };
  const hideErr = () => { if (errBox) { errBox.textContent = ""; errBox.classList.add("hidden"); } };

  // ── Reset button — restore from last-loaded profile & defaults ──
  _g("btn-settings-reset")?.addEventListener("click", () => {
    hideErr();
    _setVal("set-full-name", profile.full_name);
    _setVal("set-address", profile.address);
    _setVal("set-religion", profile.religion);
    _setVal("set-language", profile.language);
    _setVal("set-blood-type", profile.blood_type);
    _setVal("set-password", "");
    _setVal("set-password-confirm", "");
    _renderStrength("");

    // Reset local appearance preferences
    localStorage.removeItem(TEXT_SIZE_KEY);
    applyTextSize(0);
    const slider = _g("text-size-slider");
    const sizeLabel = _g("text-size-label");
    if (slider) slider.value = "0";
    if (sizeLabel) sizeLabel.textContent = "Normal";

    setCounterAnimationEnabled(false);
    const toggleCounter = _g("toggle-counter-animations");
    const badgeCounter = _g("counter-anim-badge");
    if (toggleCounter) toggleCounter.checked = false;
    if (badgeCounter) {
      badgeCounter.textContent = "Disabled (Fast)";
      badgeCounter.className = "inline-flex shrink-0 bg-gray-200 text-spes-black/60 dark:bg-white/10 dark:text-white/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider rounded";
    }
  });

  // ── Submit ──────────────────────────────────────────────────
  const submitBtn = _g("btn-settings-save");
  const setLoading = (loading) => {
    if (!submitBtn) return;
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("opacity-60", loading);
    submitBtn.classList.toggle("pointer-events-none", loading);
    submitBtn.innerHTML = loading
      ? `<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Saving…`
      : `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Save Changes`;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideErr();

    const values = {
      full_name:  _g("set-full-name")?.value.trim() ?? "",
      address:    _g("set-address")?.value.trim() ?? "",
      religion:   _g("set-religion")?.value.trim() ?? "",
      language:   _g("set-language")?.value.trim() ?? "",
      blood_type: _g("set-blood-type")?.value.trim() ?? "",
    };

    const pw  = _g("set-password")?.value ?? "";
    const pw2 = _g("set-password-confirm")?.value ?? "";

    if (!values.full_name) return showErr("Full name is required.");
    if (pw) {
      if (pw.length < 8)  return showErr("New password must be at least 8 characters.");
      if (pw !== pw2)     return showErr("Passwords do not match.");
      values.password = pw;
    }

    setLoading(true);
    const result = await updateOwnProfile(session.id, values);
    setLoading(false);

    if (!result.success) return showErr(result.error || "Failed to save. Please try again.");

    // Sync the cached session so the sidebar / header reflect the new name immediately.
    try {
      const updated = { ...session, full_name: values.full_name, address: values.address,
        religion: values.religion, language: values.language, blood_type: values.blood_type };
      localStorage.setItem("spes_session", JSON.stringify(updated));
    } catch {}

    // Update local copy so Reset uses fresh values + clear password inputs
    profile.full_name = values.full_name;
    profile.address = values.address;
    profile.religion = values.religion;
    profile.language = values.language;
    profile.blood_type = values.blood_type;
    _setVal("set-password", "");
    _setVal("set-password-confirm", "");
    _renderStrength("");

    // Reflect new name in this page's identity card + sidebar live
    setText("set-identity-name", values.full_name);
    setText("set-avatar", _initials(values.full_name));
    const sbName = _g("sidebar-user-name"); if (sbName) sbName.textContent = values.full_name;
    const sbAvatar = _g("sidebar-user-avatar"); if (sbAvatar) sbAvatar.textContent = _initials(values.full_name);

    await modals.success("Saved!", pw ? "Your profile and password have been updated." : "Your profile has been updated.");
  });
}
