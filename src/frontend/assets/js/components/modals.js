import Swal from "sweetalert2";

const getThemeOpts = () => {
  const isDark = document.documentElement.classList.contains("dark");
  return {
    background: isDark ? "#111827" : "#ffffff", // Dark primary vs White
    color: isDark ? "#f3f4f6" : "#1f2937",
  };
};

let toastSequence = 0;

function showFlowbiteToast(title, message, tone = "success") {
  let container = document.getElementById("spes-flowbite-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "spes-flowbite-toast-container";
    container.className = "pointer-events-none fixed inset-x-3 bottom-3 z-[250] flex flex-col items-stretch gap-3 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-full sm:max-w-sm";
    container.setAttribute("aria-live", tone === "danger" ? "assertive" : "polite");
    document.body.appendChild(container);
  }

  const isDanger = tone === "danger" || tone === "error";
  const id = `spes-toast-${Date.now()}-${toastSequence += 1}`;
  const toast = document.createElement("div");
  toast.id = id;
  toast.className = `pointer-events-auto flex w-full translate-y-2 items-start border p-4 opacity-0 shadow-xl transition-all duration-200 ${
    isDanger
      ? "border-spes-red/30 bg-red-50 text-spes-red dark:border-red-400/30 dark:bg-red-950 dark:text-red-300"
      : "border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-950 dark:text-emerald-300"
  }`;
  toast.setAttribute("role", "alert");
  toast.innerHTML = `
    <div class="inline-flex h-8 w-8 shrink-0 items-center justify-center border ${isDanger ? "border-spes-red/25 bg-spes-red/10" : "border-emerald-500/25 bg-emerald-500/10"}">
      ${isDanger
        ? '<svg class="h-5 w-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v4m0 4h.01M10.3 4.6 2.8 17.5A1.7 1.7 0 0 0 4.3 20h15.4a1.7 1.7 0 0 0 1.5-2.5L13.7 4.6a2 2 0 0 0-3.4 0Z"/></svg>'
        : '<svg class="h-5 w-5" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="m5 12 4 4L19 7"/></svg>'}
      <span class="sr-only">${isDanger ? "Error" : "Success"}</span>
    </div>
    <div class="ms-3 min-w-0 flex-1">
      <h3 data-toast-title class="text-sm font-black uppercase tracking-wide"></h3>
      <p data-toast-message class="mt-1 text-xs font-semibold leading-5 opacity-80"></p>
    </div>
    <button type="button" data-dismiss-target="#${id}" class="ms-2 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border border-transparent bg-transparent hover:border-current hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-current/30 dark:hover:bg-white/10" aria-label="Close">
      <span class="sr-only">Close</span>
      <svg class="h-4 w-4" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12"/></svg>
    </button>`;
  toast.querySelector("[data-toast-title]").textContent = title;
  toast.querySelector("[data-toast-message]").textContent = message;
  container.appendChild(toast);

  let timer;
  const close = () => {
    clearTimeout(timer);
    toast.classList.add("translate-y-2", "opacity-0");
    setTimeout(() => {
      toast.remove();
      if (!container.children.length) container.remove();
    }, 200);
  };
  toast.querySelector("button").addEventListener("click", close);
  requestAnimationFrame(() => toast.classList.remove("translate-y-2", "opacity-0"));
  timer = setTimeout(close, isDanger ? 6500 : 4500);
  return { close, element: toast };
}

export const modals = {
  flowbiteToast: showFlowbiteToast,
  toast: (title, icon = "success") => {
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
    });
  },
  success: (title, text) => {
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
    });
  },
  error: (title, text) => {
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
    Swal.close();
  },
  confirm: (title, text, confirmText = "Confirm", cancelText = "Cancel") => {
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
    });
  }
};
