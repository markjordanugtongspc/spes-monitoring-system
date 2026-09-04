import { inject } from "@vercel/analytics";

// --- FUNCTION: INITIALIZE VERCEL WEB ANALYTICS (START) ---
/**
 * Injects Vercel Web Analytics tracker once into the browser context.
 * Safely guards against duplicate initialization.
 * Deferred via requestIdleCallback to avoid web-vitals startTime race.
 */
export function initAnalytics() {
  if (typeof window === "undefined") return;
  if (window.__VERCEL_ANALYTICS_INJECTED__) return;
  window.__VERCEL_ANALYTICS_INJECTED__ = true;
  const init = () => { try { inject(); } catch { /* swallow web-vitals init errors */ } };
  (window.requestIdleCallback || ((cb) => setTimeout(cb, 200)))(init);
}
// --- FUNCTION: INITIALIZE VERCEL WEB ANALYTICS (END) ---

// Automatically initialize when this module is imported in browser environments
initAnalytics();
