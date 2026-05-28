// --- FUNCTION: INITIALIZE LANDING HERO VIDEO PLAYER (START) ---
export function initLandingVideoPlayer() {
  const videoElement = document.getElementById("landing-hero-video");
  if (!videoElement) return;

  videoElement.muted = true;
  videoElement.defaultMuted = true;
  videoElement.playsInline = true;
  videoElement.loop = true;

  const playPromise = videoElement.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      // Ignore autoplay-block errors; user can still manually start if browser blocks.
    });
  }
}
// --- FUNCTION: INITIALIZE LANDING HERO VIDEO PLAYER (END) ---
