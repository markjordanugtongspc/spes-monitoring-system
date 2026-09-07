import { Drawer, Datepicker, initDatepickers } from "flowbite";
import {
  animateMobileSplashVisibility,
  applyDrawerAnimationClasses
} from "./animations.js";
import { modals } from "./modals.js";
import { flowDebug, flowDebugError, flowDebugSuccess } from "./flow-debugger.js";
import { preferenceStorage } from "./storage.js";

// --- FUNCTION: MOBILE SPLASH + FLOWBITE DRAWER BRIDGE (START) ---
export function initMobileSplashDrawer() {
  const splash = document.getElementById("mobile-splash");
  const openButton = document.getElementById("mobile-splash-open-login");
  const drawer = document.getElementById("drawer-top-example");
  if (!drawer) {
    flowDebug("DRAWER", "Mobile splash drawer skipped", { reason: "drawer element not present" });
    return;
  }

  const mobileQuery = window.matchMedia("(max-width: 1023px)");
  applyDrawerAnimationClasses(splash, drawer);

  const drawerInstance = new Drawer(
    drawer,
    {
      placement: "top",
      backdrop: false,
      bodyScrolling: true
    },
    {
      id: "drawer-top-example",
      override: true
    }
  );

  const showSplash = () => {
    if (splash) animateMobileSplashVisibility(splash, true);
  };
  const hideSplash = () => {
    if (splash) animateMobileSplashVisibility(splash, false);
  };

  if (mobileQuery.matches) {
    hideSplash();
    drawerInstance.show();
  } else {
    hideSplash();
    drawerInstance.hide();
  }

  openButton?.addEventListener("click", (event) => {
    event.preventDefault();
    flowDebug("DRAWER", "Opening mobile splash drawer", { next: "Flowbite Drawer.show" });
    if (mobileQuery.matches) hideSplash();
    drawerInstance.show();
  });

  const closeDrawer = () => {
    flowDebug("DRAWER", "Closing mobile splash drawer", { next: "Flowbite Drawer.hide" });
    drawerInstance.hide();
    if (mobileQuery.matches) showSplash();
  };

  // --- INTERACTION: TAP ANYWHERE TO CLOSE DRAWER (START) ---
  drawer.addEventListener("click", () => {
    if (!mobileQuery.matches) return;
    closeDrawer();
  });
  // --- INTERACTION: TAP ANYWHERE TO CLOSE DRAWER (END) ---

  // --- INTERACTION: SWIPE UP TO CLOSE DRAWER (START) ---
  let touchStartY = 0;
  let touchEndY = 0;

  drawer.addEventListener(
    "touchstart",
    (event) => {
      if (!mobileQuery.matches) return;
      touchStartY = event.changedTouches[0].clientY;
      touchEndY = touchStartY;
    },
    { passive: true }
  );

  drawer.addEventListener(
    "touchmove",
    (event) => {
      if (!mobileQuery.matches) return;
      touchEndY = event.changedTouches[0].clientY;
    },
    { passive: true }
  );

  drawer.addEventListener(
    "touchend",
    () => {
      if (!mobileQuery.matches) return;
      const swipeDistance = touchStartY - touchEndY;
      if (swipeDistance > 50) closeDrawer();
    },
    { passive: true }
  );
  // --- INTERACTION: SWIPE UP TO CLOSE DRAWER (END) ---

  mobileQuery.addEventListener("change", (event) => {
    if (event.matches) {
      hideSplash();
      drawerInstance.show();
    } else {
      hideSplash();
      drawerInstance.hide();
    }
  });
}
// --- FUNCTION: MOBILE SPLASH + FLOWBITE DRAWER BRIDGE (END) ---

// --- FIRST COMMENT SEPARATOR: EXCLUSIVE IMPLEMENTORS DRAWER LOGIC ---
export function initImplementorsDrawer() {
  const overlay = document.getElementById("implementors-drawer-overlay");
  const drawer = document.getElementById("implementors-drawer");
  const closeBtn = document.getElementById("close-impl-drawer");
  
  if (!drawer || !overlay) {
    flowDebug("DRAWER", "Implementor details drawer skipped", {
      reason: "drawer or overlay element not present",
    });
    return;
  }

  // Pagination Elements
  const prevBtn = document.getElementById("drawer-prev-page");
  const nextBtn = document.getElementById("drawer-next-page");
  const pageIndicator = document.getElementById("drawer-page-indicator");
  const page1 = document.getElementById("drawer-page-1");
  const page2 = document.getElementById("drawer-page-2");
  
  let currentPage = 1;

  const updatePaginationUI = () => {
    // Shared active classes for mobile view
    const mobileActiveClasses = ["max-sm:bg-spes-blue/10", "max-sm:text-spes-blue", "dark:max-sm:bg-spes-yellow/10", "dark:max-sm:text-spes-yellow"];

    if (currentPage === 1) {
      page1.classList.remove("hidden");
      page1.classList.add("block");
      page2.classList.remove("block");
      page2.classList.add("hidden");
      
      prevBtn.disabled = true;
      nextBtn.disabled = false;

      // Apply hover state to Next, remove from Prev
      prevBtn.classList.remove(...mobileActiveClasses);
      nextBtn.classList.add(...mobileActiveClasses);
    } else {
      page1.classList.remove("block");
      page1.classList.add("hidden");
      page2.classList.remove("hidden");
      page2.classList.add("block");
      
      prevBtn.disabled = false;
      nextBtn.disabled = true;

      // Apply hover state to Prev, remove from Next
      nextBtn.classList.remove(...mobileActiveClasses);
      prevBtn.classList.add(...mobileActiveClasses);
    }
    pageIndicator.textContent = currentPage;
  };

  prevBtn?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      updatePaginationUI();
    }
  });

  nextBtn?.addEventListener("click", () => {
    if (currentPage < 2) {
      currentPage++;
      updatePaginationUI();
    }
  });

  const closeDrawer = () => {
    flowDebug("DRAWER", "Closing implementor details drawer");
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete("id");
      const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
      window.history.replaceState(null, "", newUrl);
      document.querySelectorAll(".impl-row, tr").forEach(r => r.classList.remove("border-l-4", "border-spes-blue", "dark:border-spes-yellow", "animate-pulse", "bg-spes-blue/10", "dark:bg-spes-yellow/10"));
    } catch {}
    drawer.classList.remove("translate-y-0", "sm:translate-x-0");
    drawer.classList.add("translate-y-full", "sm:translate-x-full");
    overlay.classList.add("hidden");
    overlay.classList.remove("block");
    document.body.classList.remove("overflow-hidden"); // Restore scrolling
    setTimeout(() => {
      if (drawer.classList.contains("translate-y-full") || drawer.classList.contains("sm:translate-x-full")) {
        drawer.classList.add("hidden");
      }
    }, 300);
  };

  const openDrawer = (implementorData) => {
    flowDebug("DRAWER", "Opening implementor details drawer", {
      implementorId: implementorData?.id ?? null,
      next: "populate details and reveal drawer",
    });
    if (implementorData?.id) {
      try {
        const params = new URLSearchParams(window.location.search);
        params.set("id", implementorData.id);
        window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
      } catch {}
    }
    // Reset to page 1
    currentPage = 1;
    updatePaginationUI();

    // Populate Data
    document.getElementById("drawer-impl-name").textContent = implementorData.full_name || "Unknown";
    document.getElementById("drawer-impl-role").textContent = implementorData.role || "N/A";
    document.getElementById("drawer-impl-id").textContent = implementorData.id ? `DOLE-${implementorData.id.toString().padStart(4, '0')}` : "---";
    const officeStr = implementorData.office || "---";
    const officeSubname = String(implementorData.office_subname || implementorData.address || "").trim();
    const officeEl = document.getElementById("drawer-impl-office");
    if (officeEl) {
      officeEl.replaceChildren();
      const wrapper = document.createElement("span");
      wrapper.className = "inline-flex max-w-72 flex-col items-end gap-1 text-right";
      const badge = document.createElement("span");
      badge.className = "inline-flex border border-spes-blue/15 bg-spes-blue/10 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest text-spes-blue dark:border-spes-yellow/20 dark:bg-spes-yellow/15 dark:text-spes-yellow";
      badge.textContent = officeStr;
      wrapper.appendChild(badge);
      if (officeSubname && officeSubname.toLowerCase() !== officeStr.toLowerCase()) {
        const subname = document.createElement("span");
        subname.className = "text-[10px] font-semibold leading-4 text-spes-black/45 dark:text-spes-white/45";
        subname.textContent = `(${officeSubname})`;
        wrapper.appendChild(subname);
      }
      officeEl.appendChild(wrapper);
    }
    document.getElementById("drawer-impl-office-location").textContent = implementorData.office_location || "—";
    document.getElementById("drawer-impl-email").textContent = implementorData.email || "---";

    // --- START: POPULATE USERNAME, STARTED, ENDED WITH DYNAMIC BATCH SWITCHER ---
    const usernameEl = document.getElementById("drawer-impl-username");
    if (usernameEl) usernameEl.textContent = implementorData.username || "---";

    const startedEl = document.getElementById("drawer-impl-started");
    const endedEl = document.getElementById("drawer-impl-ended");
    const batchSwitcherWrapper = document.getElementById("drawer-impl-batch-switcher-wrapper");
    const batchSwitcher = document.getElementById("drawer-impl-batch-switcher");

    const _fmtDateReadable = (iso) => {
      if (!iso) return "N/A";
      const d = new Date(iso);
      return isNaN(d.getTime()) ? "N/A" : d.toLocaleString("en-PH", {
        month: "short", day: "numeric", year: "numeric",
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Manila"
      });
    };

    const savedDeployments = implementorData?.id ? preferenceStorage.getImplementorDeployments(implementorData.id) : null;
    const deployments = (Array.isArray(implementorData?.batch_deployments) && implementorData.batch_deployments.length > 0)
      ? implementorData.batch_deployments
      : (Array.isArray(savedDeployments) && savedDeployments.length > 0)
        ? savedDeployments
        : ((implementorData.started_at || implementorData.ended_at)
            ? [{ batch_id: 1, batch_name: "BATCH 1", started_at: implementorData.started_at, ended_at: implementorData.ended_at }]
            : [{ batch_id: 1, batch_name: "BATCH 1", started_at: null, ended_at: null }]);

    let selectedBatchIndex = 0;

    const _updateSelectedBatchDates = (idx) => {
      selectedBatchIndex = idx;
      const targetBatch = deployments[idx] || deployments[0];
      if (startedEl) startedEl.textContent = _fmtDateReadable(targetBatch?.started_at);
      if (endedEl) endedEl.textContent = _fmtDateReadable(targetBatch?.ended_at);

      if (batchSwitcher) {
        // Update button tab highlights if in button mode
        batchSwitcher.querySelectorAll(".btn-impl-drawer-batch-tab").forEach((btn, bIdx) => {
          const isActive = bIdx === idx;
          btn.className = `btn-impl-drawer-batch-tab cursor-pointer rounded-none px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-all border ${
            isActive
              ? "bg-spes-blue text-white border-spes-blue dark:bg-spes-yellow dark:text-spes-dark-blue dark:border-spes-yellow shadow-xs"
              : "bg-spes-blue/5 text-spes-blue border-spes-blue/20 hover:bg-spes-blue/10 dark:bg-white/5 dark:text-spes-white/70 dark:border-white/10 dark:hover:bg-white/10"
          }`;
        });
        // Update select value if in dropdown mode
        const selectEl = batchSwitcher.querySelector("#drawer-impl-batch-select");
        if (selectEl && Number(selectEl.value) !== idx) {
          selectEl.value = String(idx);
        }
      }
    };

    if (batchSwitcher && batchSwitcherWrapper) {
      if (deployments.length === 2) {
        // 2 Batches: Clean Dual Button Switcher
        batchSwitcherWrapper.classList.remove("hidden");
        batchSwitcherWrapper.classList.add("flex");
        batchSwitcher.innerHTML = deployments.map((dep, dIdx) => {
          const bNum = dep.batch_id || (dIdx + 1);
          const bLabel = dep.batch_name || `BATCH ${bNum}`;
          return `
            <button type="button" data-batch-idx="${dIdx}" class="btn-impl-drawer-batch-tab cursor-pointer rounded-none px-2.5 py-1 text-[10px] font-black uppercase tracking-wider transition-all border">
              ${bLabel}
            </button>
          `;
        }).join("");

        batchSwitcher.querySelectorAll(".btn-impl-drawer-batch-tab").forEach(btn => {
          btn.addEventListener("click", () => {
            const idx = Number(btn.dataset.batchIdx);
            _updateSelectedBatchDates(idx);
          });
        });
      } else if (deployments.length >= 3) {
        // 3+ Batches: Clean Dropdown Selector to avoid layout overflow/redundancy
        batchSwitcherWrapper.classList.remove("hidden");
        batchSwitcherWrapper.classList.add("flex");
        batchSwitcher.innerHTML = `
          <div class="relative inline-block min-w-[130px]">
            <select id="drawer-impl-batch-select" class="cursor-pointer block w-full rounded-none border border-spes-blue/20 bg-white dark:bg-spes-dark-primary py-1 pe-7 ps-2.5 text-[10px] font-black uppercase tracking-wider text-spes-blue dark:text-spes-yellow focus:border-spes-blue focus:outline-none focus:ring-1 focus:ring-spes-blue/20 dark:border-white/15 dark:focus:border-spes-yellow transition">
              ${deployments.map((dep, dIdx) => {
                const bNum = dep.batch_id || (dIdx + 1);
                const bLabel = dep.batch_name || `BATCH ${bNum}`;
                return `<option value="${dIdx}" class="bg-white text-spes-black dark:bg-spes-dark-primary dark:text-spes-white font-bold py-1">${bLabel}</option>`;
              }).join("")}
            </select>
          </div>
        `;

        const selectEl = batchSwitcher.querySelector("#drawer-impl-batch-select");
        selectEl?.addEventListener("change", (e) => {
          const idx = Number(e.target.value);
          _updateSelectedBatchDates(idx);
        });
      } else {
        batchSwitcherWrapper.classList.add("hidden");
        batchSwitcherWrapper.classList.remove("flex");
        batchSwitcher.innerHTML = "";
      }
    }

    _updateSelectedBatchDates(0);
    // --- END: POPULATE USERNAME, STARTED, ENDED WITH DYNAMIC BATCH SWITCHER ---
    // Wire copy buttons
    const btnCopyUsername = document.getElementById("btn-copy-username");
    const btnCopyEmail = document.getElementById("btn-copy-email");
    const btnCopyPhone = document.getElementById("btn-copy-phone");

    // START: _flashCopied - Temporarily swap button icon to checkmark then restore
    const _flashCopied = (btn) => {
      const origHTML = btn.innerHTML;
      const origTitle = btn.getAttribute("title") || "";
      btn.innerHTML = `<svg class="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
      btn.setAttribute("title", "Copied!");
      setTimeout(() => { 
        btn.innerHTML = origHTML; 
        btn.setAttribute("title", origTitle);
      }, 1500);
    };
    // END: _flashCopied

    // START: copy-username-handler - Copy username to clipboard
    if (btnCopyUsername) {
      btnCopyUsername.onclick = () => {
        navigator.clipboard.writeText(implementorData.username || "")
          .then(() => {
            _flashCopied(btnCopyUsername);
            flowDebug("DRAWER", "Copied username to clipboard");
          })
          .catch(() => {});
      };
    }
    // END: copy-username-handler

    // START: copy-email-handler - Copy email address to clipboard
    if (btnCopyEmail) {
      btnCopyEmail.onclick = () => {
        navigator.clipboard.writeText(implementorData.email || "")
          .then(() => {
            _flashCopied(btnCopyEmail);
            flowDebug("DRAWER", "Copied email to clipboard");
          })
          .catch(() => {});
      };
    }
    // END: copy-email-handler

    // START: copy-phone-handler - Copy phone number to clipboard
    if (btnCopyPhone) {
      btnCopyPhone.onclick = () => {
        navigator.clipboard.writeText(implementorData.phone || "")
          .then(() => {
            _flashCopied(btnCopyPhone);
            flowDebug("DRAWER", "Copied phone to clipboard");
          })
          .catch(() => {});
      };
    }
    // END: copy-phone-handler
    // --- END: POPULATE USERNAME, EMAIL-DETAIL, STARTED ---

    document.getElementById("drawer-impl-religion").textContent = implementorData.religion || "—";
    document.getElementById("drawer-impl-language").textContent = implementorData.language || "—";
    document.getElementById("drawer-impl-phone").textContent = implementorData.phone || "—";

    const approvedEl = document.getElementById("drawer-impl-approved");
    if (approvedEl) {
      if (implementorData.approved) {
        approvedEl.innerHTML = `<span class="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
          <svg class="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
          </svg>
          Approved
        </span>`;
      } else {
        approvedEl.innerHTML = `<span class="inline-flex items-center gap-1 rounded bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
          <svg class="h-3.5 w-3.5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
          </svg>
          Not Approved
        </span>`;
      }
    }
    const notesEl = document.getElementById("drawer-impl-notes");
    if (notesEl) notesEl.closest(".space-y-6") && (notesEl.textContent = "—");

    // Calculate and display total beneficiaries
    const totalBenefEl = document.getElementById("drawer-impl-total-benef");
    if (totalBenefEl) {
      totalBenefEl.textContent = "Loading...";
      // Reset color classes to avoid stacking
      totalBenefEl.className = "text-sm font-black";

      import("./beneficiaries.js").then(mod => {
        mod.calculateTotalBeneficiariesByImplementor(implementorData.office_id)
          .then(count => {
            totalBenefEl.textContent = count;
            if (count >= 0 && count <= 13) {
              totalBenefEl.classList.add("text-rose-500", "dark:text-rose-400");
            } else if (count >= 14 && count <= 20) {
              totalBenefEl.classList.add("text-spes-blue", "dark:text-spes-yellow");
            } else {
              totalBenefEl.classList.add("text-emerald-600", "dark:text-emerald-400");
            }
          })
          .catch(() => {
            totalBenefEl.textContent = "0";
            totalBenefEl.classList.add("text-rose-500", "dark:text-rose-400");
          });
      }).catch(() => {
        totalBenefEl.textContent = "0";
        totalBenefEl.classList.add("text-rose-500", "dark:text-rose-400");
      });
    }

    // Dynamic Status Badge (Dot Only)
    const statusText = (implementorData.status || "offline").toUpperCase();
    
    const badgeDiv = document.getElementById("drawer-impl-status-badge");
    const dotDiv = document.getElementById("drawer-impl-status-dot");
    
    // Reset classes
    badgeDiv.className = "flex items-center justify-center";
    dotDiv.className = "h-3 w-3 rounded-full";
    
    if (statusText === "ONLINE") {
      dotDiv.classList.add("bg-emerald-500", "animate-pulse", "shadow-[0_0_8px_rgba(16,185,129,0.8)]");
    } else if (statusText === "BUSY") {
      dotDiv.classList.add("bg-spes-red", "animate-pulse", "shadow-[0_0_8px_rgba(206,17,38,0.8)]");
    } else {
      dotDiv.classList.add("bg-gray-500");
    }

    // Show Drawer
    overlay.classList.remove("hidden");
    overlay.classList.add("block");
    drawer.classList.remove("hidden");
    drawer.offsetHeight;
    drawer.classList.remove("translate-y-full", "sm:translate-x-full");
    drawer.classList.add("translate-y-0", "sm:translate-x-0");
    document.body.classList.add("overflow-hidden"); // Prevent background scrolling
    flowDebugSuccess("Implementor details drawer opened", {
      implementorId: implementorData?.id ?? null,
    });
  };

  // Close events
  closeBtn?.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);

  // Expose open function globally so dashboard.js can call it when a row is clicked
  window.openImplementorDrawer = openDrawer;
}
// --- END COMMENT SEPARATOR: EXCLUSIVE IMPLEMENTORS DRAWER LOGIC ---

// --- ADD IMPLEMENTOR BOTTOM OFFCANVAS DRAWER ---
export function initAddImplementorDrawer({ onSuccess } = {}) {
  const overlay = document.getElementById("drawer-add-impl-overlay");
  const drawerEl = document.getElementById("drawer-add-implementor");
  const form = document.getElementById("form-add-implementor");
  const errorBanner = document.getElementById("aif-error");
  const cancelBtn = document.getElementById("btn-cancel-add-impl");
  const closeBtn = document.getElementById("btn-close-add-impl-drawer");
  const submitBtn = document.getElementById("btn-submit-add-impl");

  if (!drawerEl || !overlay || !form) {
    flowDebug("DRAWER", "Add/Edit Implementor drawer skipped", {
      reason: "drawer, overlay, or form element not present",
    });
    return { open: () => {}, close: () => {} };
  }

  // --- START: Office Combobox Logic ---
  const officeSearch = document.getElementById("aif-office-search");
  const officeDropdown = document.getElementById("aif-office-dropdown");
  const officeHiddenInput = document.getElementById("aif-office");
  const officeMeta = document.getElementById("aif-office-subname");
  const officeNotFound = document.getElementById("aif-office-not-found");
  const officeOptionsContainer = document.getElementById("aif-office-options");

  const tabPublic = document.getElementById("aif-tab-public");
  const tabAcademic = document.getElementById("aif-tab-academic");

  // --- START: Approval Status Radio Helper ---
  const approvedToggle = document.getElementById("aif-approved");
  const radioApproved = document.getElementById("aif-radio-approved");
  const radioPending = document.getElementById("aif-radio-pending");
  const labelApproved = document.getElementById("aif-label-approved");
  const labelPending = document.getElementById("aif-label-pending");

  const setApprovalStatusUI = (isApproved) => {
    if (approvedToggle) approvedToggle.checked = Boolean(isApproved);
    if (radioApproved) radioApproved.checked = Boolean(isApproved);
    if (radioPending) radioPending.checked = !isApproved;

    if (labelApproved && labelPending) {
      if (isApproved) {
        labelApproved.className = "cursor-pointer relative flex items-center justify-center gap-2 rounded-none border-2 border-emerald-500 bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 dark:bg-emerald-500/25 px-4 py-2.5 text-sm font-black shadow-md ring-2 ring-emerald-500/30 transition-all opacity-100 scale-[1.01]";
        labelPending.className = "cursor-pointer relative flex items-center justify-center gap-2 rounded-none border-2 border-gray-200 dark:border-white/10 bg-transparent text-gray-500 dark:text-gray-400 px-4 py-2.5 text-sm font-bold opacity-60 transition-all hover:opacity-100 hover:border-amber-400/50";
      } else {
        labelPending.className = "cursor-pointer relative flex items-center justify-center gap-2 rounded-none border-2 border-amber-500 bg-amber-500/20 text-amber-800 dark:text-amber-200 dark:bg-amber-500/25 px-4 py-2.5 text-sm font-black shadow-md ring-2 ring-amber-500/30 transition-all opacity-100 scale-[1.01]";
        labelApproved.className = "cursor-pointer relative flex items-center justify-center gap-2 rounded-none border-2 border-gray-200 dark:border-white/10 bg-transparent text-gray-500 dark:text-gray-400 px-4 py-2.5 text-sm font-bold opacity-60 transition-all hover:opacity-100 hover:border-emerald-400/50";
      }
    }
  };

  radioApproved?.addEventListener("change", () => setApprovalStatusUI(true));
  radioPending?.addEventListener("change", () => setApprovalStatusUI(false));
  labelApproved?.addEventListener("click", () => setApprovalStatusUI(true));
  labelPending?.addEventListener("click", () => setApprovalStatusUI(false));
  // --- END: Approval Status Radio Helper ---

  let allOffices = [];
  let activeOfficeTab = "public"; // "public" or "academic"

  const renderOfficeOptions = () => {
    if (!officeOptionsContainer) return;
    officeOptionsContainer.innerHTML = "";

    const query = (officeSearch?.value ?? "").toLowerCase().trim();
    
    // Filter by type: 'academic' vs 'public'
    const filteredByType = allOffices.filter(o => {
      const isAcad = o.type === "academic";
      return activeOfficeTab === "academic" ? isAcad : !isAcad;
    });

    // Filter by search query
    const filteredBySearch = filteredByType.filter(o =>
      `${o.name} ${o.location || ""}`.toLowerCase().includes(query)
    );

    if (filteredBySearch.length === 0) {
      if (query !== "") {
        officeNotFound?.classList.remove("hidden");
      } else {
        officeNotFound?.classList.add("hidden");
        const li = document.createElement("li");
        li.className = "px-3.5 py-3 text-center text-xs text-spes-black/40 dark:text-white/30 italic";
        li.textContent = "No offices found.";
        officeOptionsContainer.appendChild(li);
      }
    } else {
      officeNotFound?.classList.add("hidden");
      filteredBySearch.forEach((o) => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "aif-office-option cursor-pointer flex w-full flex-col items-start px-3.5 py-2 text-left transition-colors duration-150 hover:bg-spes-blue/10 dark:hover:bg-white/5";
        const name = document.createElement("span");
        name.className = "text-sm font-bold text-spes-black dark:text-spes-white";
        name.textContent = o.name;
        btn.appendChild(name);
        if (o.location) {
          const location = document.createElement("span");
          location.className = "mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-spes-black/40 dark:text-spes-white/40";
          location.textContent = `(${o.location})`;
          btn.appendChild(location);
        }
        btn.dataset.id = o.id;
        btn.dataset.label = o.name;
        li.appendChild(btn);
        officeOptionsContainer.appendChild(li);
      });
    }
  };

  const setTabActive = (tabName) => {
    activeOfficeTab = tabName;
    
    const activeCls = ["bg-white", "text-spes-blue", "shadow-sm", "dark:bg-spes-yellow", "dark:text-spes-dark-primary"];
    const inactiveCls = ["text-spes-black/60", "dark:text-white/60", "hover:text-spes-blue", "dark:hover:text-spes-yellow"];

    if (tabName === "public") {
      tabPublic?.classList.add(...activeCls);
      tabPublic?.classList.remove(...inactiveCls);
      tabAcademic?.classList.remove(...activeCls);
      tabAcademic?.classList.add(...inactiveCls);
    } else {
      tabAcademic?.classList.add(...activeCls);
      tabAcademic?.classList.remove(...inactiveCls);
      tabPublic?.classList.remove(...activeCls);
      tabPublic?.classList.add(...inactiveCls);
    }

    renderOfficeOptions();
  };

  if (officeSearch && officeDropdown) {
    officeSearch.addEventListener("focus", () => {
      officeDropdown.classList.remove("hidden");
    });
    
    officeSearch.addEventListener("input", () => {
      renderOfficeOptions();
    });

    officeOptionsContainer?.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (btn) {
        const office = allOffices.find(item => String(item.id) === String(btn.dataset.id));
        officeHiddenInput.value = btn.dataset.id;
        officeSearch.value = btn.dataset.label || office?.name || "";
        if (officeMeta) officeMeta.textContent = office?.location ? `(${office.location})` : "No office location is stored.";
        officeDropdown.classList.add("hidden");
        officeNotFound?.classList.add("hidden");

        // Automatically detect active batches for this office if creating new implementor
        if (!currentEditId && _fetchOfficeBatches) {
          _fetchOfficeBatches(btn.dataset.id).then(res => {
            const batchIds = res?.data || [1];
            const currentInputs = _collectBatchDeploymentInputs();
            const hasDates = currentInputs.some(r => r.started_at || r.ended_at);
            if (!hasDates) {
              const detectedRows = batchIds.map(bId => ({
                batch_id: bId,
                batch_name: `BATCH ${bId}`,
                started_at: null,
                ended_at: null,
              }));
              renderBatchDeploymentRows(detectedRows);
            }
          });
        }
      }
    });

    tabPublic?.addEventListener("click", (e) => {
      e.stopPropagation();
      setTabActive("public");
    });

    tabAcademic?.addEventListener("click", (e) => {
      e.stopPropagation();
      setTabActive("academic");
    });

    const btnAddOffice = document.getElementById("btn-aif-add-office");
    if (btnAddOffice) {
      btnAddOffice.addEventListener("click", async () => {
        const newOfficeName = officeSearch.value.trim();
        if (!newOfficeName) return;

        btnAddOffice.disabled = true;
        const origText = btnAddOffice.textContent;
        btnAddOffice.textContent = "ADDING...";

        await _loadApis();
        const res = await _addOffice(newOfficeName, activeOfficeTab);
        
        btnAddOffice.disabled = false;
        btnAddOffice.textContent = origText;

        if (res.success && res.data) {
          allOffices.push(res.data);
          
          officeHiddenInput.value = res.data.id;
          officeSearch.value = res.data.name;
          if (officeMeta) officeMeta.textContent = res.data.location ? `(${res.data.location})` : "No office location is stored.";
          
          officeDropdown.classList.add("hidden");
          officeNotFound?.classList.add("hidden");
          renderOfficeOptions();

          await modals.success(
            "Office Added!",
            `"${res.data.name}" has been registered as an ${activeOfficeTab} office.`
          );
        } else {
          await modals.error(
            "Failed to add office",
            res.error || "Please try again."
          );
        }
      });
    }

    document.addEventListener("click", (e) => {
      if (!officeSearch.contains(e.target) && !officeDropdown.contains(e.target)) {
        officeDropdown.classList.add("hidden");
      }
    });
  }
  // --- END: Office Combobox Logic ---

  let _addStaff, _fetchOffices, _fetchRoles;
  let currentEditId = null;
  let currentEditData = null;
  let _updateStaff;
  let _addOffice;
  let _fetchOfficeBatches;

  const _loadApis = async () => {
    if (_addStaff) return;
    const mod = await import("../../../../backend/api/staff.js");
    _addStaff = mod.addStaff;
    _updateStaff = mod.updateStaff;
    _fetchOffices = mod.fetchOffices;
    _fetchRoles = mod.fetchRoles;
    _addOffice = mod.addOffice;
    _fetchOfficeBatches = mod.fetchOfficeBatches;
  };

  const _showError = (msg) => {
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
  };

  const _hideError = () => {
    errorBanner.textContent = "";
    errorBanner.classList.add("hidden");
  };

  const _setLoading = (loading) => {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? `<svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg> Saving…`
      : (currentEditId ? `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Update Implementor` : `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Save Implementor`);
  };

  const _populateDropdowns = async () => {
    await _loadApis();
    const roleSelect = document.getElementById("aif-role");

    const [officesResult, rolesResult] = await Promise.all([
      _fetchOffices({ forceRefresh: true }),
      _fetchRoles({ forceRefresh: true }),
    ]);

    allOffices = officesResult.data ?? [];
    renderOfficeOptions();

    roleSelect.innerHTML = `<option value="">— Select Role —</option>`;
    (rolesResult.data ?? []).forEach((r) => {
      if (r.name.toLowerCase() === "admin") return;
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.name;
      roleSelect.appendChild(opt);
    });
  };

  // --- START: DYNAMIC BATCH DEPLOYMENT ROWS LOGIC ---
  const batchDeploymentsList = document.getElementById("aif-batch-deployments-list");
  const btnAddBatchPeriod = document.getElementById("btn-aif-add-batch-period");
  let activeBatchDatepickers = [];

  const _fmtDateInput = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? "" : `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  };

  const _parseDate = (strVal) => {
    if (!strVal) return null;
    const d = new Date(strVal);
    return isNaN(d.getTime()) ? null : d.toISOString();
  };

  const _destroyAllBatchDatepickers = () => {
    activeBatchDatepickers.forEach(({ inp, handler, dp }) => {
      if (inp && handler) {
        inp.removeEventListener("focus", handler);
        inp.removeEventListener("click", handler);
      }
      if (dp) {
        try {
          dp.hide();
          dp.destroy?.();
        } catch {}
      }
    });
    activeBatchDatepickers = [];
    document.querySelectorAll(".datepicker").forEach(dp => {
      dp.classList.add("hidden");
      dp.classList.remove("active");
      dp.style.display = "none";
    });
  };

  const _collectBatchDeploymentInputs = () => {
    if (!batchDeploymentsList) return [];
    const rows = batchDeploymentsList.querySelectorAll(".aif-batch-deployment-row");
    return Array.from(rows).map((row, idx) => {
      const batchIdInput = row.querySelector(".aif-row-batch-id");
      const batchNameInput = row.querySelector(".aif-row-batch-name");
      const startInp = row.querySelector(".aif-batch-start");
      const endInp = row.querySelector(".aif-batch-end");
      const batchId = batchIdInput ? Number(batchIdInput.value) : (idx + 1);
      const batchName = batchNameInput?.value || `BATCH ${batchId}`;
      return {
        batch_id: batchId,
        batch_name: batchName,
        started_at: startInp?.value ? _parseDate(startInp.value) : null,
        ended_at: endInp?.value ? _parseDate(endInp.value) : null,
      };
    });
  };

  const _initBatchRowDatepickers = () => {
    if (!batchDeploymentsList) return;
    const rows = batchDeploymentsList.querySelectorAll(".aif-batch-deployment-row");
    rows.forEach(row => {
      const startInp = row.querySelector(".aif-batch-start");
      const endInp = row.querySelector(".aif-batch-end");
      if (!startInp || !endInp) return;

      const initInput = (inp, otherInp, label) => {
        try {
          if (inp._flowbiteDatepicker) {
            inp._flowbiteDatepicker.destroy?.();
            inp._flowbiteDatepicker = null;
          }
          const dp = new Datepicker(inp, {
            autohide: true,
            todayBtn: true,
            clearBtn: true,
            format: "mm/dd/yyyy",
          });
          inp._flowbiteDatepicker = dp;

          const onFocus = () => {
            if (otherInp?._flowbiteDatepicker) {
              try { otherInp._flowbiteDatepicker.hide(); } catch {}
            }
            document.querySelectorAll(".datepicker").forEach(dEl => {
              if (otherInp && dEl.parentElement === otherInp.parentElement) {
                dEl.classList.add("hidden");
                dEl.classList.remove("active");
                dEl.style.display = "none";
              }
            });
          };
          inp.addEventListener("focus", onFocus);
          inp.addEventListener("click", onFocus);
          activeBatchDatepickers.push({ inp, handler: onFocus, dp });
        } catch (err) {
          flowDebugError(`Failed to init dynamic ${label} datepicker`, err);
        }
      };

      initInput(startInp, endInp, "start");
      initInput(endInp, startInp, "end");
    });
  };

  const renderBatchDeploymentRows = (deployments = []) => {
    if (!batchDeploymentsList) return;
    _destroyAllBatchDatepickers();

    let items = Array.isArray(deployments) && deployments.length > 0
      ? deployments
      : [{ batch_id: 1, batch_name: "BATCH 1", started_at: null, ended_at: null }];

    let html = "";
    items.forEach((item, index) => {
      const bId = item.batch_id || (index + 1);
      const bName = item.batch_name || `BATCH ${bId}`;
      const startVal = _fmtDateInput(item.started_at);
      const endVal = _fmtDateInput(item.ended_at);

      html += `
        <div class="aif-batch-deployment-row border border-spes-blue/15 bg-spes-blue/5 p-3 dark:border-white/10 dark:bg-white/5 space-y-2.5" data-batch-index="${index}">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="inline-flex items-center rounded-none bg-spes-blue text-white dark:bg-spes-yellow dark:text-spes-dark-blue px-2.5 py-0.5 text-xs font-black uppercase tracking-wider">
                ${bName}
              </span>
              <input type="hidden" class="aif-row-batch-id" value="${bId}" />
              <input type="hidden" class="aif-row-batch-name" value="${bName}" />
            </div>
            ${index > 0 ? `
            <button type="button" class="btn-remove-batch-row cursor-pointer text-xs font-bold text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 inline-flex items-center gap-1 transition-colors" data-remove-index="${index}">
              <svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              Remove
            </button>` : ''}
          </div>
          <div class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
            <div class="relative flex-1">
              <div class="cursor-pointer absolute inset-y-0 start-0 flex items-center ps-3 z-10" onclick="document.getElementById('aif-batch-start-${index}')?.focus()">
                <svg class="h-4 w-4 text-spes-blue/50 dark:text-spes-yellow/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10h16m-8-3V4M7 7V4m10 3V4M5 20h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Zm3-7h.01v.01H8V13Zm4 0h.01v.01H12V13Zm4 0h.01v.01H16V13Zm-8 4h.01v.01H8V17Zm4 0h.01v.01H12V17Zm4 0h.01v.01H16V17Z"/></svg>
              </div>
              <input id="aif-batch-start-${index}" type="text" autocomplete="off"
                datepicker datepicker-autohide datepicker-buttons datepicker-orientation="bottom left" datepicker-format="mm/dd/yyyy"
                class="aif-batch-start cursor-pointer block w-full rounded-none border border-spes-blue/20 bg-white dark:bg-transparent ps-9 pe-3 py-2 text-sm text-spes-black placeholder:text-spes-black/30 focus:border-spes-blue focus:outline-none focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/15 dark:text-spes-white dark:placeholder:text-spes-white/25 dark:focus:border-spes-yellow dark:focus:ring-spes-yellow/20 transition"
                placeholder="Select start date" value="${startVal}" />
            </div>
            <span class="self-center text-xs font-bold uppercase tracking-wider text-spes-black/40 dark:text-spes-white/40 sm:mx-1">to</span>
            <div class="relative flex-1">
              <div class="cursor-pointer absolute inset-y-0 start-0 flex items-center ps-3 z-10" onclick="document.getElementById('aif-batch-end-${index}')?.focus()">
                <svg class="h-4 w-4 text-spes-blue/50 dark:text-spes-yellow/50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 10h16m-8-3V4M7 7V4m10 3V4M5 20h14a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1Zm3-7h.01v.01H8V13Zm4 0h.01v.01H12V13Zm4 0h.01v.01H16V13Zm-8 4h.01v.01H8V17Zm4 0h.01v.01H12V17Zm4 0h.01v.01H16V17Z"/></svg>
              </div>
              <input id="aif-batch-end-${index}" type="text" autocomplete="off"
                datepicker datepicker-autohide datepicker-buttons datepicker-orientation="bottom right" datepicker-format="mm/dd/yyyy"
                class="aif-batch-end cursor-pointer block w-full rounded-none border border-spes-blue/20 bg-white dark:bg-transparent ps-9 pe-3 py-2 text-sm text-spes-black placeholder:text-spes-black/30 focus:border-spes-blue focus:outline-none focus:ring-2 focus:ring-spes-blue/20 dark:border-spes-white/15 dark:text-spes-white dark:placeholder:text-spes-white/25 dark:focus:border-spes-yellow dark:focus:ring-spes-yellow/20 transition"
                placeholder="Select end date" value="${endVal}" />
            </div>
          </div>
        </div>
      `;
    });

    batchDeploymentsList.innerHTML = html;
    _initBatchRowDatepickers();
  };

  // Wire Add Batch Period button
  btnAddBatchPeriod?.addEventListener("click", () => {
    const current = _collectBatchDeploymentInputs();
    const nextId = current.length + 1;
    current.push({
      batch_id: nextId,
      batch_name: `BATCH ${nextId}`,
      started_at: null,
      ended_at: null,
    });
    renderBatchDeploymentRows(current);
  });

  // Wire Remove Batch Row event delegation
  batchDeploymentsList?.addEventListener("click", (e) => {
    const removeBtn = e.target.closest(".btn-remove-batch-row");
    if (!removeBtn) return;
    const removeIndex = Number(removeBtn.dataset.removeIndex);
    const current = _collectBatchDeploymentInputs();
    current.splice(removeIndex, 1);
    renderBatchDeploymentRows(current);
  });
  // --- END: DYNAMIC BATCH DEPLOYMENT ROWS LOGIC ---

  const _isMobile = () => window.innerWidth < 640;

  const openDrawer = async (staffData = null) => {
    flowDebug("DRAWER", "Opening Add/Edit Implementor drawer", {
      mode: staffData?.id == null ? "create" : "edit",
      implementorId: staffData?.id ?? null,
      next: "load form options and reveal drawer",
    });
    form.reset();
    _hideError();
    _setLoading(false);
    await _populateDropdowns();

    const titleEl = document.getElementById("drawer-add-impl-title");
    const descEl = titleEl.nextElementSibling;
    const pwdLabel = document.querySelector('label[for="aif-password"]');
    const confirmPwdLabel = document.querySelector('label[for="aif-confirm-password"]');

    const pwdInput = document.getElementById("aif-password");
    const confirmPwdInput = document.getElementById("aif-confirm-password");

    currentEditData = staffData || null;
    if (staffData) {
      currentEditId = staffData.id;
      titleEl.textContent = "Edit Implementor";
      descEl.textContent = "Update the implementor details below.";
      submitBtn.innerHTML = `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Update Implementor`;
      pwdLabel.innerHTML = `New Password <span class="text-gray-400 text-xs font-normal">(Leave blank to keep current)</span>`;
      confirmPwdLabel.innerHTML = `Confirm New Password`;
      pwdInput.required = false;
      confirmPwdInput.required = false;

      document.getElementById("aif-full-name").value = staffData.full_name || "";
      document.getElementById("aif-username").value = staffData.username || "";
      document.getElementById("aif-email").value = staffData.email || "";
      
      const offId = staffData.office_id || "";
      document.getElementById("aif-office").value = offId;
      const officeSearch = document.getElementById("aif-office-search");
      if (officeSearch) {
        const office = allOffices.find(o => String(o.id) === String(offId));
        officeSearch.value = office ? office.name : "";
        if (officeMeta) officeMeta.textContent = office?.location ? `(${office.location})` : "No office location is stored.";
        if (office) {
          setTabActive(office.type === "academic" ? "academic" : "public");
        }
      }

      document.getElementById("aif-role").value = staffData.role_id || "";
      document.getElementById("aif-religion").value = staffData.religion || "";
      document.getElementById("aif-language").value = staffData.language || "";
      document.getElementById("aif-phone").value = staffData.phone || "";

      // --- START: POPULATE BATCH DEPLOYMENTS (render dynamic batch deployment rows) ---
      const savedDeployments = preferenceStorage.getImplementorDeployments(staffData.id);
      const deployments = (Array.isArray(staffData.batch_deployments) && staffData.batch_deployments.length > 0)
        ? staffData.batch_deployments
        : (Array.isArray(savedDeployments) && savedDeployments.length > 0)
          ? savedDeployments
          : ((staffData.started_at || staffData.ended_at)
              ? [{ batch_id: 1, batch_name: "BATCH 1", started_at: staffData.started_at, ended_at: staffData.ended_at }]
              : [{ batch_id: 1, batch_name: "BATCH 1", started_at: null, ended_at: null }]);
      renderBatchDeploymentRows(deployments);
      // --- END: POPULATE BATCH DEPLOYMENTS ---
      
      setApprovalStatusUI(Boolean(staffData.approved));
    } else {
      currentEditId = null;
      currentEditData = null;
      titleEl.textContent = "Add Implementor";
      descEl.textContent = "Fill in the details to create a new staff account.";
      submitBtn.innerHTML = `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Save Implementor`;
      pwdLabel.innerHTML = `Password <span class="text-red-500">*</span>`;
      confirmPwdLabel.innerHTML = `Confirm Password <span class="text-red-500">*</span>`;
      pwdInput.required = true;
      confirmPwdInput.required = true;
      
      setApprovalStatusUI(false);
      
      const officeSearch = document.getElementById("aif-office-search");
      if (officeSearch) officeSearch.value = "";
      if (officeMeta) officeMeta.textContent = "Select an office to view its stored location.";
      setTabActive("public");
      const notFound = document.getElementById("aif-office-not-found");
      if(notFound) notFound.classList.add("hidden");

      // --- START: INIT BATCH DEPLOYMENTS FOR ADD MODE ---
      renderBatchDeploymentRows([{ batch_id: 1, batch_name: "BATCH 1", started_at: null, ended_at: null }]);
      // --- END: INIT BATCH DEPLOYMENTS FOR ADD MODE ---
    }

    // --- START: RESTRICT HR FROM MODIFYING ADMINISTRATOR ACCOUNTS ---
    const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
    const isCallerHr = session.role === "hr" || session.role === "HR" || Number(session.role_id) === 2;
    const isTargetAdmin = staffData && (Number(staffData.role_id) === 1 || String(staffData.role).toUpperCase() === "ADMIN");
    const isHrViewingAdmin = isCallerHr && isTargetAdmin;

    [
      "aif-full-name", "aif-username", "aif-email", "aif-office", "aif-office-search",
      "aif-role", "aif-religion", "aif-language", "aif-phone",
      "aif-password", "aif-confirm-password", "aif-approved"
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = isHrViewingAdmin;
        el.classList.toggle("opacity-60", isHrViewingAdmin);
        el.classList.toggle("cursor-not-allowed", isHrViewingAdmin);
      }
    });

    if (btnAddBatchPeriod) {
      btnAddBatchPeriod.disabled = isHrViewingAdmin;
      btnAddBatchPeriod.classList.toggle("opacity-60", isHrViewingAdmin);
      btnAddBatchPeriod.classList.toggle("cursor-not-allowed", isHrViewingAdmin);
    }
    if (batchDeploymentsList) {
      batchDeploymentsList.querySelectorAll("input, button").forEach(el => {
        el.disabled = isHrViewingAdmin;
        el.classList.toggle("opacity-60", isHrViewingAdmin);
        el.classList.toggle("cursor-not-allowed", isHrViewingAdmin);
      });
    }

    if (isHrViewingAdmin) {
      submitBtn.classList.add("hidden");
      _showError("Administrator accounts are protected. HR accounts cannot modify Administrator details, credentials, or permissions.");
    } else {
      submitBtn.classList.remove("hidden");
      _hideError();
    }
    // --- END: RESTRICT HR FROM MODIFYING ADMINISTRATOR ACCOUNTS ---

    drawerEl.classList.remove("hidden");
    drawerEl.setAttribute("aria-hidden", "false");
    overlay.classList.remove("hidden");
    drawerEl.offsetHeight;
    requestAnimationFrame(() => {
      overlay.classList.remove("opacity-100");
      overlay.classList.add("opacity-100");
      if (_isMobile()) {
        drawerEl.classList.remove("translate-y-full");
        drawerEl.classList.add("translate-y-0");
      } else {
        drawerEl.classList.remove("sm:translate-x-full");
        drawerEl.classList.add("sm:translate-x-0");
      }
      try {
        // START: _hideAllDatepickers - Force close all datepicker dropdowns
        const _hideAllDatepickers = () => {
          document.querySelectorAll(".datepicker").forEach(dp => {
            dp.classList.add("hidden");
            dp.classList.remove("active");
            dp.style.display = "none";
          });
        };
        drawerEl._hideAllDatepickers = _hideAllDatepickers;
        // END: _hideAllDatepickers

        // START: datepicker-scroll-autohide - Automatically hide datepicker dropdowns when user scrolls the drawer
        const drawerScrollEl = drawerEl.querySelector(".overflow-y-auto") || drawerEl;
        const _onDrawerScroll = () => {
          _hideAllDatepickers();
        };
        drawerScrollEl.addEventListener("scroll", _onDrawerScroll, { passive: true });
        drawerEl._dpScrollEl = drawerScrollEl;
        drawerEl._dpScrollHandler = _onDrawerScroll;
        // END: datepicker-scroll-autohide

        drawerEl._destroyDatepickers = () => {
          if (drawerEl._dpScrollEl && drawerEl._dpScrollHandler) {
            drawerEl._dpScrollEl.removeEventListener("scroll", drawerEl._dpScrollHandler);
            drawerEl._dpScrollEl = null;
            drawerEl._dpScrollHandler = null;
          }
          _destroyAllBatchDatepickers();
        };

        flowDebugSuccess("Batch deployment datepickers initialized with mutual exclusion");

      } catch (err) {
        flowDebugError("Failed to init datepickers", err);
      }
    });
    document.body.classList.add("overflow-hidden");
    flowDebugSuccess("Add/Edit Implementor drawer opened", {
      mode: currentEditId ? "edit" : "create",
      implementorId: currentEditId,
    });
  };

  const closeDrawer = () => {
    flowDebug("DRAWER", "Closing Add/Edit Implementor drawer", {
      implementorId: currentEditId,
    });

    // START: closeDrawer-datepicker-cleanup - Hide open datepickers, destroy instances, and remove document listeners
    _destroyAllBatchDatepickers();
    if (drawerEl._hideAllDatepickers) {
      try { drawerEl._hideAllDatepickers(); } catch {}
    }
    if (drawerEl._destroyDatepickers) {
      try { drawerEl._destroyDatepickers(); } catch {}
      drawerEl._destroyDatepickers = null;
    }
    if (drawerEl._dpOutsideClick) {
      document.removeEventListener("mousedown", drawerEl._dpOutsideClick);
      drawerEl._dpOutsideClick = null;
    }
    if (drawerEl._dpEscKey) {
      document.removeEventListener("keydown", drawerEl._dpEscKey);
      drawerEl._dpEscKey = null;
    }
    drawerEl._hideAllDatepickers = null;
    flowDebug("DATEPICKER", "Datepicker cleanup complete on drawer close");
    // END: closeDrawer-datepicker-cleanup

    drawerEl.setAttribute("aria-hidden", "true");
    if (_isMobile()) {
      drawerEl.classList.remove("translate-y-0");
      drawerEl.classList.add("translate-y-full");
    } else {
      drawerEl.classList.remove("sm:translate-x-0");
      drawerEl.classList.add("sm:translate-x-full");
    }
    overlay.classList.remove("opacity-100");
    overlay.classList.add("opacity-0");
    setTimeout(() => {
      overlay.classList.add("hidden");
      if (drawerEl.classList.contains("translate-y-full") || drawerEl.classList.contains("sm:translate-x-full")) {
        drawerEl.classList.add("hidden");
      }
      document.body.classList.remove("overflow-hidden");
    }, 300);
  };

  cancelBtn?.addEventListener("click", closeDrawer);
  closeBtn?.addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    _hideError();

    const pwd = document.getElementById("aif-password").value;
    const confirmPwd = document.getElementById("aif-confirm-password").value;

    if (!currentEditId && !pwd) return _showError("Password is required.");
    if (pwd && pwd !== confirmPwd) return _showError("Passwords do not match.");

    // --- START: BUILD EDIT/CREATE PAYLOAD (Collect batch deployments) ---
    const batchDeployments = _collectBatchDeploymentInputs();
    const primaryBatch = batchDeployments[0] || null;

    const payload = {
      full_name:  document.getElementById("aif-full-name").value.trim(),
      username:   document.getElementById("aif-username").value.trim(),
      email:      document.getElementById("aif-email").value.trim() || null,
      office_id:  document.getElementById("aif-office").value || null,
      role_id:    document.getElementById("aif-role").value || null,
      religion:   document.getElementById("aif-religion").value.trim() || null,
      language:   document.getElementById("aif-language").value.trim() || null,
      phone:      document.getElementById("aif-phone").value.trim() || null,
      started_at: primaryBatch?.started_at || null,
      ended_at:   primaryBatch?.ended_at || null,
      batch_deployments: batchDeployments,
      approved:   document.getElementById("aif-approved")?.checked || false,
    };
    // --- END: BUILD EDIT/CREATE PAYLOAD ---
    
    if (pwd && !currentEditId) {
      payload.password = pwd;
    }

    if (!payload.full_name) return _showError("Full name is required.");
    if (!payload.username) return _showError("Username is required.");
    if (!payload.office_id) return _showError("Please select an office.");
    if (!payload.role_id) return _showError("Please select a role.");

    const session = JSON.parse(localStorage.getItem("spes_session") || "{}");
    const isCallerHr = session.role === "hr" || session.role === "HR" || Number(session.role_id) === 2;
    if (currentEditId && isCallerHr && currentEditData) {
      if (Number(currentEditData.role_id) === 1 || String(currentEditData.role || "").toUpperCase() === "ADMIN") {
        return _showError("HR cannot modify Administrator details, credentials, or permissions.");
      }
    }

    _setLoading(true);
    await _loadApis();
    
    let result;
    if (currentEditId) {
      result = await _updateStaff(currentEditId, payload);
      if (result.success && pwd) {
        const auth = await import("../../../../backend/api/auth.js");
        const pwdResult = await auth.updateImplementorPassword(currentEditId, pwd);
        if (!pwdResult.success) {
           _setLoading(false);
           return _showError(pwdResult.error || "Failed to update password.");
        }
      }
    } else {
      payload.status = "OFFLINE";
      result = await _addStaff(payload);
    }
    
    _setLoading(false);

    if (!result.success) return _showError(result.error ?? (currentEditId ? "Failed to update implementor." : "Failed to add implementor."));

    if (currentEditId && Number(currentEditId) === Number(session.id) && payload.role_id) {
      session.role_id = Number(payload.role_id);
      if (session.role_id === 1) {
        session.role = "admin";
        session.role_label = "Admin";
      } else if (session.role_id === 2) {
        session.role = "hr";
        session.role_label = "HR";
      } else {
        session.role = "officer";
        session.role_label = "Officer";
      }
      try {
        localStorage.setItem("spes_session", JSON.stringify(session));
        sessionStorage.setItem("spes_session", JSON.stringify(session));
      } catch {}
    }

    closeDrawer();
    if (typeof onSuccess === "function") onSuccess(result.data);
  });

  return { open: openDrawer, close: closeDrawer };
}
// --- END: ADD IMPLEMENTOR BOTTOM OFFCANVAS DRAWER ---

// --- START: BATCH FORM DRAWER ---
export function initBatchFormDrawer({ onSuccess } = {}) {
  const overlay = document.getElementById("drawer-batch-form-overlay");
  const drawerEl = document.getElementById("drawer-batch-form");
  const form = document.getElementById("form-batch-drawer");
  const title = document.getElementById("drawer-batch-form-title");
  const subtitle = document.getElementById("drawer-batch-form-subtitle");
  const errorBanner = document.getElementById("batch-form-error");
  const cancelBtn = document.getElementById("btn-cancel-batch-form");
  const closeBtn = document.getElementById("btn-close-batch-form-drawer");
  const submitBtn = document.getElementById("btn-save-batch-form");
  const batchNameInput = document.getElementById("batch-form-name");
  const deleteSection = document.getElementById("batch-delete-section");
  const deleteBtn = document.getElementById("btn-delete-batch-permanent");

  if (!drawerEl || !overlay || !form) {
    const missing = [
      !drawerEl && "#drawer-batch-form",
      !overlay && "#drawer-batch-form-overlay",
      !form && "#form-batch-drawer"
    ].filter(Boolean);
    console.error(`[SPES Batch Drawer] Cannot initialize. Missing: ${missing.join(", ")}`);
    flowDebugError("Batch drawer initialization failed", new Error("Required drawer elements are missing"), { missing });
    return { open: () => false, close: () => false, isOpen: () => false };
  }

  // --- START: BATCH DRAWER BODY PORTAL ---
  // A fixed drawer can still collapse to 0×0 when malformed surrounding HTML
  // or a hidden/contained ancestor changes the browser's parsed DOM tree.
  // Portal both layers to <body> so their layout context is always the viewport.
  if (overlay.parentElement !== document.body || drawerEl.parentElement !== document.body) {
    document.body.append(overlay, drawerEl);
    flowDebug("DRAWER", "Batch drawer layers portaled to document.body", {
      overlayParent: overlay.parentElement?.tagName,
      drawerParent: drawerEl.parentElement?.tagName,
    });
  }
  // --- END: BATCH DRAWER BODY PORTAL ---

  let currentEditId = null;
  let closeTimer = null;
  let openVerificationTimer = null;
  let _addBatch;
  let _updateBatch;
  let _deleteBatchPermanently;
  let _archiveBeneficiariesByBatch;
  const _loadApis = async () => {
    if (_addBatch && _updateBatch && _deleteBatchPermanently && _archiveBeneficiariesByBatch) return;
    const mod = await import("../../../../backend/api/beneficiary.js");
    _addBatch = mod.addBatch;
    _updateBatch = mod.updateBatch;
    _deleteBatchPermanently = mod.deleteBatchPermanently;
    _archiveBeneficiariesByBatch = mod.archiveBeneficiariesByBatch;
  };

  const _showError = (msg) => {
    if (!errorBanner) return;
    errorBanner.textContent = msg;
    errorBanner.classList.remove("hidden");
  };

  const _hideError = () => {
    if (!errorBanner) return;
    errorBanner.textContent = "";
    errorBanner.classList.add("hidden");
  };

  // --- START: RESPONSIVE BATCH DRAWER VISUAL STATE CONTROLLER ---
  // Tailwind v4 translate utilities use the CSS `translate` property. Mixing
  // those classes with an inline `transform` left the drawer off-screen even
  // when aria-hidden was false. Keep one class-driven source of truth.
  const _setDrawerVisualState = (isOpen) => {
    [
      "transform",
      "translate",
      "position",
      "top",
      "right",
      "bottom",
      "left",
      "width",
      "height",
      "max-height",
      "z-index",
    ].forEach((property) => drawerEl.style.removeProperty(property));
    drawerEl.dataset.drawerState = isOpen ? "open" : "closed";

    drawerEl.classList.toggle("translate-y-0", isOpen);
    drawerEl.classList.toggle("translate-y-full", !isOpen);
    drawerEl.classList.toggle("sm:translate-x-0", isOpen);
    drawerEl.classList.toggle("sm:translate-x-full", !isOpen);
  };

  const _getDrawerVisibilitySnapshot = () => {
    const rect = drawerEl.getBoundingClientRect();
    const styles = window.getComputedStyle(drawerEl);
    const ancestors = [];
    let ancestor = drawerEl.parentElement;
    while (ancestor && ancestors.length < 8) {
      const ancestorStyles = window.getComputedStyle(ancestor);
      ancestors.push({
        element: ancestor.tagName.toLowerCase(),
        id: ancestor.id || undefined,
        display: ancestorStyles.display,
        visibility: ancestorStyles.visibility,
        contentVisibility: ancestorStyles.contentVisibility,
        contain: ancestorStyles.contain,
      });
      ancestor = ancestor.parentElement;
    }
    const intersectsViewport =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight;

    return {
      visible:
        styles.display !== "none" &&
        styles.visibility !== "hidden" &&
        Number(styles.opacity) > 0 &&
        intersectsViewport,
      display: styles.display,
      visibility: styles.visibility,
      opacity: styles.opacity,
      position: styles.position,
      width: styles.width,
      height: styles.height,
      top: styles.top,
      right: styles.right,
      bottom: styles.bottom,
      left: styles.left,
      contentVisibility: styles.contentVisibility,
      contain: styles.contain,
      transform: styles.transform,
      translate: styles.translate,
      rect: {
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      state: drawerEl.dataset.drawerState,
      classes: drawerEl.className,
      ancestors,
    };
  };

  const _verifyDrawerOpened = () => {
    const snapshot = _getDrawerVisibilitySnapshot();
    if (snapshot.visible) {
      flowDebugSuccess("Batch form drawer is visible in the viewport", {
        mode: currentEditId ? "edit" : "create",
        batchId: currentEditId,
        ...snapshot,
      });
      return;
    }

    flowDebugError(
      "Batch form drawer was marked open but is not visible",
      new Error("Drawer failed its viewport visibility assertion."),
      snapshot
    );

    // Last-resort recovery for stale/generated CSS or collapsed layout. These
    // inline properties are removed by _setDrawerVisualState on open/close.
    drawerEl.classList.remove("hidden");
    drawerEl.style.setProperty("position", "fixed", "important");
    drawerEl.style.setProperty("top", "0", "important");
    drawerEl.style.setProperty("right", "0", "important");
    drawerEl.style.setProperty("bottom", "auto", "important");
    drawerEl.style.setProperty("left", "auto", "important");
    drawerEl.style.setProperty("width", "min(420px, 100vw)", "important");
    drawerEl.style.setProperty("height", "100dvh", "important");
    drawerEl.style.setProperty("max-height", "100dvh", "important");
    drawerEl.style.setProperty("z-index", "140", "important");
    drawerEl.style.setProperty("transform", "none", "important");
    drawerEl.style.setProperty("translate", "0 0", "important");

    requestAnimationFrame(() => {
      const recoveredSnapshot = _getDrawerVisibilitySnapshot();
      if (recoveredSnapshot.visible) {
        flowDebugSuccess("Batch form drawer recovered with safe viewport placement", recoveredSnapshot);
      } else {
        flowDebugError(
          "Batch form drawer recovery failed",
          new Error("Drawer is still outside the viewport after safe placement."),
          recoveredSnapshot
        );
      }
    });
  };
  // --- END: RESPONSIVE BATCH DRAWER VISUAL STATE CONTROLLER ---

  const openDrawer = (batch = null) => {
    flowDebug("DRAWER", "Opening batch form drawer", {
      mode: batch?.id == null ? "create" : "edit",
      batchId: batch?.id ?? null,
      next: "populate fields and reveal drawer",
    });
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (openVerificationTimer) {
      clearTimeout(openVerificationTimer);
      openVerificationTimer = null;
    }
    currentEditId = batch?.id ?? null;
    form.reset();
    _hideError();
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = currentEditId ? "Update Batch" : "Save Batch";
    }
    if (title) title.textContent = currentEditId ? "Edit Batch" : "Create Batch";
    if (subtitle) {
      subtitle.textContent = currentEditId
        ? "Update the batch details below."
        : "Define a new batch group.";
    }
    if (batchNameInput) batchNameInput.value = batch?.batchName ?? "";

    drawerEl.classList.remove("pointer-events-none", "opacity-60");

    // Show DELETE BATCH only in edit mode (currentEditId !== null) and only for Admin or HR
    if (deleteSection) {
      const sessionRaw = localStorage.getItem("spes_session");
      let isAdminOrHr = false;
      try {
        if (sessionRaw) {
          const s = JSON.parse(sessionRaw);
          const role = String(s?.role || "").toLowerCase();
          isAdminOrHr = role === "admin" || role === "hr" || Number(s?.role_id) === 1;
        }
      } catch {}

      if (currentEditId && isAdminOrHr) {
        deleteSection.classList.remove("hidden");
      } else {
        deleteSection.classList.add("hidden");
      }
    }

    drawerEl.classList.remove("hidden");
    drawerEl.setAttribute("aria-hidden", "false");
    drawerEl.inert = false;
    overlay.classList.remove("hidden");
    overlay.classList.add("block");
    _setDrawerVisualState(false);
    drawerEl.offsetHeight;
    requestAnimationFrame(() => {
      overlay.classList.remove("opacity-0");
      overlay.classList.add("opacity-100");
      _setDrawerVisualState(true);
      openVerificationTimer = setTimeout(() => {
        openVerificationTimer = null;
        _verifyDrawerOpened();
      }, 340);
    });
    document.body.classList.add("overflow-hidden");
    setTimeout(() => batchNameInput?.focus(), 300);
    flowDebug("DRAWER", "Batch form drawer open state applied", {
      mode: currentEditId ? "edit" : "create",
      batchId: currentEditId,
      ariaHidden: drawerEl.getAttribute("aria-hidden"),
      next: "verify drawer intersects the viewport",
    });
    return true;
  };

  const closeDrawer = ({ immediate = false } = {}) => {
    flowDebug("DRAWER", "Closing batch form drawer", { immediate, batchId: currentEditId });
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (openVerificationTimer) {
      clearTimeout(openVerificationTimer);
      openVerificationTimer = null;
    }
    drawerEl.setAttribute("aria-hidden", "true");
    drawerEl.inert = true;
    drawerEl.classList.remove("pointer-events-none", "opacity-60");
    _setDrawerVisualState(false);
    overlay.classList.remove("opacity-100");
    overlay.classList.add("opacity-0");

    const finishClose = () => {
      overlay.classList.add("hidden");
      overlay.classList.remove("block");
      drawerEl.classList.add("hidden");
      document.body.classList.remove("overflow-hidden");
      closeTimer = null;
    };

    if (immediate) finishClose();
    else closeTimer = setTimeout(finishClose, 300);
    return true;
  };

  cancelBtn?.addEventListener("click", () => closeDrawer());
  closeBtn?.addEventListener("click", () => closeDrawer());
  overlay.addEventListener("click", () => closeDrawer());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    _hideError();

    const batchName = batchNameInput?.value.trim() ?? "";
    flowDebug("FORM", "Batch form submitted", {
      mode: currentEditId ? "edit" : "create",
      batchId: currentEditId,
        batchName,
      next: currentEditId ? "updateBatch API" : "addBatch API",
    });
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";
    }
    try {
      await _loadApis();
    } catch (error) {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = currentEditId ? "Update Batch" : "Save Batch";
      }
      flowDebugError("Batch API module failed to load", error);
      return _showError("Could not load the batch service. Please refresh and try again.");
    }

    let sessionStaffId = null;
    try {
      const sessionRaw = localStorage.getItem("spes_session");
      if (sessionRaw) {
        const session = JSON.parse(sessionRaw);
        const candidate = Number(session?.id);
        if (Number.isInteger(candidate) && candidate > 0) sessionStaffId = candidate;
      }
    } catch {}

    const payload = {
      batchName: batchName || null,
      created_by: sessionStaffId
    };
    let result;
    try {
      result = currentEditId
        ? await _updateBatch(currentEditId, payload)
        : await _addBatch(payload);
    } catch (error) {
      flowDebugError("Batch save request threw an error", error, {
        mode: currentEditId ? "edit" : "create",
        batchId: currentEditId,
      });
      result = { success: false, error: "The batch request failed unexpectedly." };
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = currentEditId ? "Update Batch" : "Save Batch";
    }
    if (!result.success) {
      flowDebugError("Batch save was rejected", result.error, {
        mode: currentEditId ? "edit" : "create",
        batchId: currentEditId,
      });
      return _showError(result.error || (currentEditId ? "Failed to update batch." : "Failed to create batch."));
    }

    const completedMode = currentEditId ? "updated" : "created";
    const resolvedBatchId = currentEditId ?? result.data?.id;
    flowDebugSuccess(`Batch ${completedMode}`, { batchId: resolvedBatchId });
    closeDrawer();
    import("./modals.js").then(({ modals }) => {
      modals.success(
        completedMode === "updated" ? "Batch Updated" : "Batch Created",
        `Batch ID ${resolvedBatchId} has been ${completedMode} successfully.`
      );
    });
    if (typeof onSuccess === "function") onSuccess(result.data, { mode: completedMode });
  });

  // Wire DELETE BATCH permanent with 5-second Undo Toast
  deleteBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!currentEditId) return;

    const targetBatchId = currentEditId;
    const batchName = batchNameInput?.value.trim() || `ID #${targetBatchId}`;
    const cachedBatch = {
      id: targetBatchId,
      batchId: targetBatchId,
      batchName: batchNameInput?.value.trim() || ""
    };

    // 1. Temporarily close off-canvas drawer so underlying cards and undo toast are completely visible
    _hideError();
    closeDrawer();

    // 2. Trigger Flowbite Success Toast first
    const { modals } = await import("./modals.js");
    let isUndone = false;

    const successToast = modals.flowbiteToast(
      "Batch Deleted",
      `Batch "${batchName}" has been removed from view.`,
      "success"
    );

    // 3. Sequentially show Undo Toast in the front card (~350ms later)
    setTimeout(() => {
      if (isUndone) return;
      modals.undoToast({
        message: `Batch "${batchName}" has been deleted.`,
        durationMs: 5000,
        onUndo: () => {
          isUndone = true;
          successToast?.close?.({ immediate: true });
          openDrawer(cachedBatch);
          modals.flowbiteToast("Delete Undone", `Batch "${batchName}" was restored.`, "success");
        },
        onExpire: async () => {
          if (isUndone) return;
          try {
            await _loadApis();
            await _archiveBeneficiariesByBatch(targetBatchId);
            const delRes = await _deleteBatchPermanently(targetBatchId);

            if (!delRes.success) {
              openDrawer(cachedBatch);
              _showError(delRes.error || "Failed to delete batch.");
              modals.error("Delete Failed", delRes.error || "Could not delete batch.");
              return;
            }

            if (typeof onSuccess === "function") {
              onSuccess({ id: targetBatchId }, { mode: "deleted" });
            }
          } catch (err) {
            openDrawer(cachedBatch);
            console.error("[SPES Batch Delete] Expire error:", err);
            modals.error("Delete Error", "An error occurred while deleting the batch.");
          }
        }
      });
    }, 350);
  });

  return {
    open: openDrawer,
    close: closeDrawer,
    isOpen: () => drawerEl.getAttribute("aria-hidden") === "false"
  };
}
// --- END: BATCH FORM DRAWER ---

// --- FUNCTION: FORMAT NUMBER WITH COMMAS (START) ---
/**
 * Formats a raw number string or number into a comma-separated string preserving decimals.
 * @param {string|number} val - Input value
 * @param {boolean} allowDecimals - Whether to allow floating point decimals
 * @returns {string} Formatted number string with commas
 */
export function formatNumberWithCommas(val, allowDecimals = true) {
  if (val === null || val === undefined || val === "") return "";
  const cleanStr = String(val).replace(/,/g, "").trim();
  if (!cleanStr) return "";

  if (allowDecimals) {
    const parts = cleanStr.split(".");
    const integerPart = parts[0].replace(/\D/g, "");
    if (integerPart === "" && parts.length > 1) {
      return "0." + parts.slice(1).join("").replace(/\D/g, "");
    }
    const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    if (parts.length > 1) {
      const decimalPart = parts.slice(1).join("").replace(/\D/g, "");
      return `${formattedInteger}.${decimalPart}`;
    }
    return formattedInteger;
  } else {
    const integerPart = cleanStr.replace(/\D/g, "");
    return integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
}
// --- FUNCTION: FORMAT NUMBER WITH COMMAS (END) ---

// --- FUNCTION: PARSE NUMBER FROM FORMATTED COMMA STRING (START) ---
/**
 * Parses numeric float or int from comma-formatted string.
 * @param {string|number} val - Formatted string with commas
 * @returns {number} Parsed numeric value
 */
export function parseNumberFromCommas(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const sanitized = String(val).replace(/,/g, "").trim();
  const num = Number(sanitized);
  return Number.isFinite(num) ? num : 0;
}
// --- FUNCTION: PARSE NUMBER FROM FORMATTED COMMA STRING (END) ---

// --- FUNCTION: ATTACH AUTOMATIC NUMBER COMMA FORMATTER (START) ---
/**
 * Automatically formats numeric text inputs with comma separators as the user types,
 * while accurately maintaining cursor caret position.
 * @param {HTMLInputElement} inputEl - Target input element
 * @param {Object} options - Configuration options
 * @param {boolean} options.allowDecimals - Whether decimal points are allowed
 * @param {Function} options.onInput - Optional callback fired when input changes
 */
export function attachNumberCommaFormatter(inputEl, { allowDecimals = true, onInput = null } = {}) {
  if (!inputEl) return;

  const handleInput = () => {
    const originalVal = inputEl.value;
    const selectionStart = inputEl.selectionStart || originalVal.length;

    // Count how many non-comma characters were before the cursor
    const rawBeforeCursor = originalVal.slice(0, selectionStart).replace(/,/g, "");

    // Format new value
    const formatted = formatNumberWithCommas(originalVal, allowDecimals);
    inputEl.value = formatted;

    // Restore caret position by finding the equivalent non-comma character index
    let newCursorPos = 0;
    let nonCommaCount = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (nonCommaCount === rawBeforeCursor.length) {
        newCursorPos = i;
        break;
      }
      if (formatted[i] !== ",") {
        nonCommaCount++;
      }
      if (nonCommaCount === rawBeforeCursor.length) {
        newCursorPos = i + 1;
        break;
      }
    }
    if (nonCommaCount < rawBeforeCursor.length) {
      newCursorPos = formatted.length;
    }

    inputEl.setSelectionRange(newCursorPos, newCursorPos);

    if (typeof onInput === "function") {
      onInput(parseNumberFromCommas(formatted), formatted);
    }
  };

  inputEl.addEventListener("input", handleInput);

  // Format initial value if already present
  if (inputEl.value) {
    inputEl.value = formatNumberWithCommas(inputEl.value, allowDecimals);
  }
}
// --- FUNCTION: ATTACH AUTOMATIC NUMBER COMMA FORMATTER (END) ---
