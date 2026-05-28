import Swal from "sweetalert2";

const getThemeOpts = () => {
  const isDark = document.documentElement.classList.contains("dark");
  return {
    background: isDark ? "#111827" : "#ffffff", // Dark primary vs White
    color: isDark ? "#f3f4f6" : "#1f2937",
  };
};

export const modals = {
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
