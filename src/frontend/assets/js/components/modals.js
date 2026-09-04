import Swal from "sweetalert2";
import { flowDebug, flowDebugError, flowDebugSuccess } from "./flow-debugger.js";

const getThemeOpts = () => {
  const isDark = document.documentElement.classList.contains("dark");
  return {
    background: isDark ? "#111827" : "#ffffff", // Dark primary vs White
    color: isDark ? "#f3f4f6" : "#1f2937",
  };
};

let toastSequence = 0;

// ── Stacked Deck Toast Manager (Literal Card Stacking / Sonner pattern) ──
class StackedDeckToastManager {
  constructor() {
    this.toasts = [];
    this.container = null;
    this.isHovered = false;
  }

  getContainer(tone = "polite") {
    if (!this.container || !document.body.contains(this.container)) {
      this.container = document.createElement("div");
      this.container.id = "spes-flowbite-toast-container";
      this.container.className = "pointer-events-none fixed inset-x-3 bottom-4 z-[250] flex flex-col items-center sm:items-end sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-full sm:max-w-md min-h-[96px]";
      this.container.setAttribute("aria-live", tone === "danger" ? "assertive" : "polite");

      this.container.addEventListener("mouseenter", () => {
        this.isHovered = true;
        this.updateDeck();
      });
      this.container.addEventListener("mouseleave", () => {
        this.isHovered = false;
        this.updateDeck();
      });

      document.body.appendChild(this.container);
    }
    return this.container;
  }

  addToast(toastObj) {
    const container = this.getContainer(toastObj.tone || "polite");
    container.appendChild(toastObj.element);

    toastObj.element.addEventListener("mouseenter", () => {
      this.isHovered = true;
      this.updateDeck();
    });
    toastObj.element.addEventListener("mouseleave", (e) => {
      if (!this.container || !this.container.contains(e.relatedTarget)) {
        this.isHovered = false;
        this.updateDeck();
      }
    });

    if (toastObj.isUndo) {
      // The Undo toast is strictly positioned in the foreground (depth 0)
      this.toasts.unshift(toastObj);
    } else {
      // If an active Undo toast is currently in front, new standard toasts stack directly behind it at depth 1 (back-top)
      const undoIdx = this.toasts.findIndex((t) => t.isUndo && !t.dismissed);
      if (undoIdx !== -1) {
        this.toasts.splice(undoIdx + 1, 0, toastObj);
      } else {
        this.toasts.unshift(toastObj);
      }
    }

    // Limit visible deck depth to 3 cards
    while (this.toasts.length > 3) {
      const oldest = this.toasts.pop();
      oldest?.close?.({ immediate: true });
    }

    this.updateDeck();
    this.syncTimers();
  }

  removeToast(id) {
    const idx = this.toasts.findIndex((t) => t.id === id);
    if (idx !== -1) {
      this.toasts.splice(idx, 1);
      this.updateDeck();
      this.syncTimers();
    }
    if (this.toasts.length === 0 && this.container) {
      setTimeout(() => {
        if (this.toasts.length === 0 && this.container) {
          this.container.remove();
          this.container = null;
        }
      }, 350);
    }
  }

  syncTimers() {
    const hasActiveUndoInFront = this.toasts.some((t, idx) => t.isUndo && !t.dismissed && idx === 0);
    this.toasts.forEach((t, idx) => {
      if (idx === 0) {
        // Front toast runs its timer
        t.resume?.();
      } else if (hasActiveUndoInFront) {
        // Any toast behind an active undo toast is paused so it stays visible at the back-top!
        t.pause?.();
      }
    });
  }

  updateDeck() {
    const count = this.toasts.length;
    this.toasts.forEach((toast, depth) => {
      const el = toast.element;
      if (!el || !document.body.contains(el)) return;

      el.style.position = "absolute";
      el.style.bottom = "0";
      el.style.right = "0";
      el.style.left = "0";
      el.style.transformOrigin = "bottom center";
      el.style.transition = "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.32s ease, filter 0.32s ease, box-shadow 0.32s ease";

      if (this.isHovered && count > 1) {
        // Fanned out hover mode: cards smoothly spread upwards for clear reading and interaction
        const offset = depth * 80;
        el.style.transform = `translate3d(0, -${offset}px, 0) scale(1)`;
        el.style.zIndex = `${70 - depth * 10}`;
        el.style.opacity = "1";
        el.style.filter = "none";
        el.style.pointerEvents = "auto";
      } else {
        // Literal stacked deck of cards:
        // depth 0 (front): translateY(0), scale(1), zIndex 70
        // depth 1 (behind-top): translateY(-20px), scale(0.95), zIndex 60 (visibly peeking out from the back-top)
        // depth 2 (behind-top 2): translateY(-38px), scale(0.90), zIndex 50
        const translateY = depth === 0 ? 0 : -(depth * 20);
        const scale = depth === 0 ? 1 : Math.max(0.85, 1 - (depth * 0.05));
        const opacity = depth === 0 ? 1 : Math.max(0.85, 1 - (depth * 0.12));
        const zIndex = 70 - depth * 10;
        const filter = depth === 0 ? "none" : "brightness(0.96) contrast(1.02)";

        el.style.transform = `translate3d(0, ${translateY}px, 0) scale(${scale})`;
        el.style.zIndex = `${zIndex}`;
        el.style.opacity = `${opacity}`;
        el.style.filter = filter;
        el.style.pointerEvents = depth === 0 ? "auto" : "none";
      }
    });
  }
}

const _deckManager = new StackedDeckToastManager();

function showFlowbiteToast(title, message, tone = "success") {
  flowDebug("MODAL", "Opening Flowbite toast", { title, message, tone });

  const isDanger = tone === "danger" || tone === "error";
  const id = `spes-toast-${Date.now()}-${toastSequence += 1}`;
  const toast = document.createElement("div");
  toast.id = id;
  toast.className = `spes-toast-card pointer-events-auto flex w-full items-center gap-3.5 rounded-2xl border ${
    isDanger
      ? "border-rose-500/40 dark:border-rose-500/50"
      : "border-emerald-500/40 dark:border-emerald-500/50"
  } bg-white dark:bg-spes-dark-primary p-4 text-slate-800 dark:text-white shadow-[0_12px_32px_rgba(0,0,0,0.18)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.6)] backdrop-blur-md`;
  toast.setAttribute("role", "alert");
  toast.innerHTML = `
    <div class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
      isDanger
        ? "border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400"
        : "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    }">
      ${isDanger
        ? '<svg class="h-5 w-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v4m0 4h.01M10.3 4.6 2.8 17.5A1.7 1.7 0 0 0 4.3 20h15.4a1.7 1.7 0 0 0 1.5-2.5L13.7 4.6a2 2 0 0 0-3.4 0Z"/></svg>'
        : '<svg class="h-5 w-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="m5 12 4 4L19 7"/></svg>'}
      <span class="sr-only">${isDanger ? "Error" : "Success"}</span>
    </div>
    <div class="min-w-0 flex-1">
      <h3 data-toast-title class="text-xs font-black uppercase tracking-wider ${isDanger ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}"></h3>
      <p data-toast-message class="mt-0.5 text-xs font-bold leading-relaxed text-spes-black/80 dark:text-white/80"></p>
    </div>
    <button type="button" data-dismiss-target="#${id}" class="ms-1 inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300 dark:hover:bg-white/10 dark:hover:text-white transition-colors" aria-label="Close">
      <span class="sr-only">Close</span>
      <svg class="h-4 w-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12"/></svg>
    </button>`;
  toast.querySelector("[data-toast-title]").textContent = title;
  toast.querySelector("[data-toast-message]").textContent = message;

  let dismissed = false;
  let remainingMs = isDanger ? 6000 : 4500;
  let timerId = null;
  let lastStarted = Date.now();
  let isPaused = false;

  const close = ({ immediate = false } = {}) => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timerId);
    flowDebug("MODAL", "Closing Flowbite toast", { title, tone });
    toast.style.transform = "translate3d(0, 16px, 0) scale(0.95)";
    toast.style.opacity = "0";
    toast.style.pointerEvents = "none";
    if (immediate) {
      toast.remove();
      _deckManager.removeToast(id);
    } else {
      setTimeout(() => {
        toast.remove();
        _deckManager.removeToast(id);
      }, 300);
    }
  };

  const pause = () => {
    if (isPaused || dismissed) return;
    isPaused = true;
    clearTimeout(timerId);
    const elapsed = Date.now() - lastStarted;
    remainingMs = Math.max(3000, remainingMs - elapsed);
  };

  const resume = () => {
    if (!isPaused || dismissed) return;
    isPaused = false;
    remainingMs = Math.max(3000, remainingMs);
    lastStarted = Date.now();
    clearTimeout(timerId);
    timerId = setTimeout(() => close(), remainingMs);
  };

  toast.querySelector("button").addEventListener("click", () => close());
  timerId = setTimeout(() => close(), remainingMs);

  _deckManager.addToast({
    id,
    element: toast,
    isUndo: false,
    tone,
    close,
    pause,
    resume,
    get dismissed() { return dismissed; },
    get isPaused() { return isPaused; }
  });

  return { close, pause, resume, element: toast };
}

function showFlowbiteUndoToast({ message, durationMs = 5000, onUndo, onExpire }) {
  flowDebug("MODAL", "Opening Flowbite Undo toast", { message, durationMs });

  const id = `spes-undo-toast-${Date.now()}-${toastSequence += 1}`;
  const toast = document.createElement("div");
  toast.id = id;
  toast.className = "spes-toast-card spes-undo-card pointer-events-auto flex w-full items-center gap-3.5 rounded-2xl border border-rose-500/40 dark:border-rose-500/50 bg-white dark:bg-spes-dark-primary p-4 text-slate-800 dark:text-white shadow-[0_14px_36px_-4px_rgba(244,63,94,0.18),0_10px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_16px_40px_-4px_rgba(244,63,94,0.22),0_12px_28px_rgba(0,0,0,0.7)] backdrop-blur-md";
  toast.setAttribute("role", "alert");

  const radius = 13;
  const circumference = 2 * Math.PI * radius; // ~81.68
  const initialSecs = Math.max(1, Math.round(durationMs / 1000));
  let currentDisplayed = initialSecs;

  toast.innerHTML = `
    <div class="relative flex h-8 w-8 shrink-0 items-center justify-center">
      <svg class="h-8 w-8 -rotate-90 transform" viewBox="0 0 32 32">
        <circle cx="16" cy="16" r="${radius}" fill="none" stroke="currentColor" stroke-width="2.5" class="text-rose-500/20 dark:text-rose-500/20" />
        <circle data-progress cx="16" cy="16" r="${radius}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
          stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="0"
          class="text-rose-600 dark:text-rose-400 transition-[stroke-dashoffset] ease-linear" style="transition-duration: ${durationMs}ms;" />
      </svg>
      <span data-countdown class="absolute text-[11px] font-black tabular-nums text-rose-600 dark:text-rose-400 select-none transition-transform duration-150 transform inline-block">${initialSecs}</span>
    </div>
    <div class="ms-1 min-w-0 flex-1">
      <p data-undo-message class="text-xs font-black leading-tight text-spes-black dark:text-white"></p>
      <p class="mt-0.5 text-[10px] font-bold text-spes-black/50 dark:text-white/50">Click Undo to restore before countdown ends.</p>
    </div>
    <button type="button" data-btn-undo class="ms-2 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow-md hover:bg-rose-700 active:scale-95 transition-all">
      <span class="font-black">Undo</span>
    </button>`;

  toast.querySelector("[data-undo-message]").textContent = message;

  const countdownEl = toast.querySelector("[data-countdown]");
  const circle = toast.querySelector("[data-progress]");
  const undoBtn = toast.querySelector("[data-btn-undo]");

  let dismissed = false;
  let timer;
  let intervalId;
  const startTime = Date.now();

  const updateCountdownDisplay = (val) => {
    if (!countdownEl) return;
    countdownEl.textContent = String(val);
    countdownEl.classList.remove("scale-125");
    void countdownEl.offsetWidth; // trigger reflow for pop animation
    countdownEl.classList.add("scale-125");
    setTimeout(() => {
      countdownEl.classList.remove("scale-125");
    }, 150);
  };

  const close = ({ immediate = false } = {}) => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(timer);
    clearInterval(intervalId);
    toast.style.transform = "translate3d(0, 16px, 0) scale(0.95)";
    toast.style.opacity = "0";
    toast.style.pointerEvents = "none";
    if (immediate) {
      toast.remove();
      _deckManager.removeToast(id);
    } else {
      setTimeout(() => {
        toast.remove();
        _deckManager.removeToast(id);
      }, 300);
    }
  };

  _deckManager.addToast({
    id,
    element: toast,
    isUndo: true,
    tone: "assertive",
    close,
    get dismissed() { return dismissed; }
  });

  if (circle) {
    void circle.getBoundingClientRect(); // trigger layout reflow
    requestAnimationFrame(() => {
      circle.style.strokeDashoffset = `${circumference.toFixed(2)}`;
    });
  }

  // Active high-precision ticker to ensure numbers transition smoothly 5 -> 4 -> 3 -> 2 -> 1 -> 0
  intervalId = setInterval(() => {
    if (dismissed) {
      clearInterval(intervalId);
      return;
    }

    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));

    if (remaining !== currentDisplayed) {
      currentDisplayed = remaining;
      updateCountdownDisplay(currentDisplayed);
    }

    if (elapsed >= durationMs) {
      clearInterval(intervalId);
      if (currentDisplayed !== 0) {
        currentDisplayed = 0;
        updateCountdownDisplay(0);
      }
      // Hold "0" on screen for 500ms so user visibly sees the countdown complete at 0
      timer = setTimeout(() => {
        if (!dismissed) {
          close();
          if (typeof onExpire === "function") onExpire();
        }
      }, 500);
    }
  }, 100);

  undoBtn?.addEventListener("click", () => {
    if (dismissed) return;
    clearTimeout(timer);
    clearInterval(intervalId);
    undoBtn.disabled = true;
    undoBtn.classList.add("opacity-70", "pointer-events-none");
    undoBtn.innerHTML = `
      <span class="inline-flex items-center gap-1 font-black">
        <svg class="h-3.5 w-3.5 text-white animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span>Undone</span>
      </span>`;

    if (typeof onUndo === "function") onUndo();

    setTimeout(() => {
      close({ immediate: true });
    }, 200);
  });

  return { close, element: toast };
}

export const modals = {
  flowbiteToast: showFlowbiteToast,
  undoToast: showFlowbiteUndoToast,
  toast: (title, icon = "success") => {
    flowDebug("MODAL", "Opening toast", { title, icon, next: "SweetAlert toast lifecycle" });
    const Toast = Swal.mixin({
      toast: true,
      position: "bottom-end",
      showConfirmButton: false,
      timer: 3000,
      timerProgressBar: true,
      didOpen: (toast) => {
        toast.addEventListener("mouseenter", Swal.stopTimer);
        toast.addEventListener("mouseleave", Swal.resumeTimer);
      },
      customClass: {
        popup: "rounded-xl border border-gray-100 dark:border-white/10 shadow-lg"
      },
      ...getThemeOpts()
    });
    return Toast.fire({
      icon: icon,
      title: title
    }).then((result) => {
      flowDebugSuccess("Toast lifecycle completed", { title, result });
      return result;
    }).catch((error) => {
      flowDebugError("Toast failed", error, { title });
      throw error;
    });
  },
  success: (title, text) => {
    flowDebug("MODAL", "Opening success modal", { title, text });
    return Swal.fire({
      icon: "success",
      title: title,
      text: text,
      showConfirmButton: false,
      timer: 2500,
      timerProgressBar: true,
      customClass: {
        popup: "rounded-2xl border-none shadow-2xl"
      },
      ...getThemeOpts()
    }).then((result) => {
      flowDebugSuccess("Success modal completed", { title, result });
      return result;
    });
  },
  error: (title, text) => {
    flowDebug("MODAL", "Opening error modal", { title, text });
    return Swal.fire({
      icon: "error",
      title: title,
      text: text,
      confirmButtonColor: "#CE1126",
      customClass: {
        confirmButton: "rounded-xl font-bold uppercase tracking-wider px-6 py-3 cursor-pointer",
        popup: "rounded-2xl border-none shadow-2xl"
      },
      ...getThemeOpts()
    });
  },
  warning: (title, text) => {
    flowDebug("MODAL", "Opening warning modal", { title, text });
    return Swal.fire({
      icon: "warning",
      title: title,
      text: text,
      confirmButtonColor: "#FCD116",
      customClass: {
        confirmButton: "rounded-xl font-bold uppercase tracking-wider px-6 py-3 cursor-pointer",
        popup: "rounded-2xl border-none shadow-2xl"
      },
      ...getThemeOpts()
    });
  },
  loading: (title, text) => {
    flowDebug("MODAL", "Opening loading modal", { title, text });
    return Swal.fire({
      title: title,
      text: text,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      },
      customClass: {
        popup: "rounded-2xl border-none shadow-2xl"
      },
      ...getThemeOpts()
    });
  },
  close: () => {
    flowDebug("MODAL", "Closing active SweetAlert modal");
    Swal.close();
  },
  confirm: (title, text, confirmText = "Confirm", cancelText = "Cancel") => {
    flowDebug("MODAL", "Opening confirmation modal", {
      title,
      text,
      confirmText,
      cancelText,
      next: "wait for confirm or cancel",
    });
    return Swal.fire({
      icon: "warning",
      title: title,
      text: text,
      showCancelButton: true,
      confirmButtonColor: "#0038A8", // SPES Blue
      cancelButtonColor: "#f87171", // Light red (Tailwind red-400)
      confirmButtonText: confirmText,
      cancelButtonText: cancelText,
      customClass: {
        confirmButton: "rounded-xl font-bold uppercase tracking-wider px-6 py-3 cursor-pointer",
        cancelButton: "rounded-xl font-bold uppercase tracking-wider px-6 py-3 cursor-pointer",
        popup: "rounded-2xl border-none shadow-2xl"
      },
      ...getThemeOpts()
    }).then((result) => {
      flowDebug("OUTPUT", "Confirmation modal resolved", {
        title,
        isConfirmed: result.isConfirmed,
        isDismissed: result.isDismissed,
        dismiss: result.dismiss,
      });
      return result;
    });
  }
};
