/**
 * SPES Portal — Supabase Realtime Presence Manager
 * ─────────────────────────────────────────────────
 * Tracks staff ONLINE/OFFLINE status via Supabase Presence.
 * Detects idle timeout and browser close to set status OFFLINE.
 *
 * Exports:
 *   initPresence(staffId)    — Subscribe to Presence channel
 *   destroyPresence()        — Untrack + unsubscribe
 *   getIdleTimeoutMs()       — Returns configured idle timeout
 */
import { supabase } from "../../../../backend/api/supabase.js";

// ── Configuration ──────────────────────────────────────────────
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
const CHANNEL_NAME = "spes_staff_presence";
const ACTIVITY_EVENTS = ["mousemove", "keydown", "scroll", "touchstart", "click", "pointerdown"];
const ACTIVITY_THROTTLE_MS = 30_000; // Only reset timer at most every 30s to avoid thrashing

// ── Module State ───────────────────────────────────────────────
let _channel = null;
let _staffId = null;
let _idleTimer = null;
let _lastActivityTs = 0;
let _activityHandler = null;
let _beforeUnloadHandler = null;
let _initialized = false;

// ── Public API ─────────────────────────────────────────────────

/**
 * Subscribe to the Presence channel and start idle detection.
 * Idempotent: calling multiple times with the same staffId is safe.
 *
 * @param {string|number} staffId
 */
export function initPresence(staffId) {
  if (!staffId) return;
  const id = Number(staffId);
  if (isNaN(id) || id <= 0) return;

  // Already initialized for this staff — no-op
  if (_initialized && _staffId === id) return;

  // Tear down any previous subscription first
  if (_initialized) destroyPresence();

  _staffId = id;
  _initialized = true;

  // 1. Subscribe to Presence channel
  _channel = supabase.channel(CHANNEL_NAME);

  _channel
    .on("presence", { event: "sync" }, () => {
      if (import.meta.env.DEV) {
        const state = _channel.presenceState();
        console.debug("[SPES Presence] sync", Object.keys(state).length, "keys");
      }
    })
    .on("presence", { event: "join" }, ({ key, newPresences }) => {
      if (import.meta.env.DEV) console.debug("[SPES Presence] join", key, newPresences);
    })
    .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
      if (import.meta.env.DEV) console.debug("[SPES Presence] leave", key, leftPresences);
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await _channel.track({
          staff_id: _staffId,
          status: "ONLINE",
          online_at: new Date().toISOString(),
        });
        if (import.meta.env.DEV) console.debug("[SPES Presence] Tracked as ONLINE", _staffId);
      }
    });

  // 2. Start idle detection
  _resetIdleTimer();
  _lastActivityTs = Date.now();

  _activityHandler = () => {
    const now = Date.now();
    if (now - _lastActivityTs < ACTIVITY_THROTTLE_MS) return;
    _lastActivityTs = now;
    _resetIdleTimer();
  };

  ACTIVITY_EVENTS.forEach((evt) => {
    document.addEventListener(evt, _activityHandler, { passive: true, capture: true });
  });

  // 3. Browser close / navigate away detection
  _beforeUnloadHandler = () => {
    _setOfflineBeacon();
  };
  window.addEventListener("beforeunload", _beforeUnloadHandler);
  window.addEventListener("pagehide", _beforeUnloadHandler);
}

/**
 * Untrack from Presence, stop idle detection, remove listeners.
 */
export function destroyPresence() {
  // Stop idle timer
  if (_idleTimer) {
    clearTimeout(_idleTimer);
    _idleTimer = null;
  }

  // Remove activity listeners
  if (_activityHandler) {
    ACTIVITY_EVENTS.forEach((evt) => {
      document.removeEventListener(evt, _activityHandler, { capture: true });
    });
    _activityHandler = null;
  }

  // Remove beforeunload/pagehide
  if (_beforeUnloadHandler) {
    window.removeEventListener("beforeunload", _beforeUnloadHandler);
    window.removeEventListener("pagehide", _beforeUnloadHandler);
    _beforeUnloadHandler = null;
  }

  // Untrack + unsubscribe from channel
  if (_channel) {
    try { _channel.untrack(); } catch { /* best-effort */ }
    try { supabase.removeChannel(_channel); } catch { /* best-effort */ }
    _channel = null;
  }

  _staffId = null;
  _initialized = false;
}

/**
 * Returns the configured idle timeout in milliseconds.
 * @returns {number}
 */
export function getIdleTimeoutMs() {
  return IDLE_TIMEOUT_MS;
}

// ── Internal Helpers ───────────────────────────────────────────

/**
 * Reset (or start) the idle countdown timer.
 * When the timer fires, the user is considered idle → trigger offline + redirect.
 */
function _resetIdleTimer() {
  if (_idleTimer) clearTimeout(_idleTimer);
  _idleTimer = setTimeout(_handleIdleTimeout, IDLE_TIMEOUT_MS);
}

/**
 * Called when the user has been idle for IDLE_TIMEOUT_MS.
 * Sets status OFFLINE, clears session, redirects to login.
 */
async function _handleIdleTimeout() {
  if (import.meta.env.DEV) console.warn("[SPES Presence] Idle timeout reached — setting OFFLINE");

  // 1. Untrack from Presence
  if (_channel) {
    try { await _channel.untrack(); } catch { /* best-effort */ }
  }

  // 2. Set OFFLINE in DB
  if (_staffId) {
    try {
      await supabase.from("staffs").update({ status: "OFFLINE" }).eq("id", _staffId);
    } catch { /* best-effort */ }
  }

  // 3. Clear server session cookie
  try {
    await fetch("/api/session", { method: "DELETE", credentials: "same-origin" });
  } catch { /* best-effort */ }

  // 4. Clear local session
  localStorage.removeItem("spes_session");
  localStorage.removeItem("spes_supabase_token");
  sessionStorage.clear();

  // 5. Clean up presence internals
  destroyPresence();

  // 6. Redirect to login
  window.location.href = "/src/frontend/login/";
}

/**
 * Fire-and-forget beacon to set status OFFLINE on browser close.
 * Uses sendBeacon for reliability during page unload, with direct
 * Supabase REST PATCH as fallback.
 */
function _setOfflineBeacon() {
  if (!_staffId) return;

  // Primary: sendBeacon to our serverless endpoint
  const beaconUrl = "/api/beacon";
  const payload = JSON.stringify({ staff_id: _staffId });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    const sent = navigator.sendBeacon(beaconUrl, blob);
    if (sent) return;
  }

  // Fallback: synchronous XHR (last resort for older browsers)
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", beaconUrl, false); // synchronous
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.send(payload);
  } catch { /* swallow — page is unloading anyway */ }
}
