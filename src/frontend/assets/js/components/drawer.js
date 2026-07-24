import { Drawer } from "flowbite";
import {
  animateMobileSplashVisibility,
  applyDrawerAnimationClasses
} from "./animations";
import { modals } from "./modals.js";

// --- FUNCTION: MOBILE SPLASH + FLOWBITE DRAWER BRIDGE (START) ---
export function initMobileSplashDrawer() {
  const splash = document.getElementById("mobile-splash");
  const openButton = document.getElementById("mobile-splash-open-login");
  const drawer = document.getElementById("drawer-top-example");
  if (!drawer) return;

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
    if (mobileQuery.matches) hideSplash();
    drawerInstance.show();
  });

  const closeDrawer = () => {
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
  
  if (!drawer || !overlay) return;

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
    
    document.getElementById("drawer-impl-address").textContent = implementorData.address || "—";
    document.getElementById("drawer-impl-religion").textContent = implementorData.religion || "—";
    document.getElementById("drawer-impl-language").textContent = implementorData.language || "—";
    document.getElementById("drawer-impl-blood").textContent = implementorData.blood_type || "—";
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

  if (!drawerEl || !overlay || !form) return { open: () => {}, close: () => {} };

  // --- START: Office Combobox Logic ---
  const officeSearch = document.getElementById("aif-office-search");
  const officeDropdown = document.getElementById("aif-office-dropdown");
  const officeHiddenInput = document.getElementById("aif-office");
  const officeMeta = document.getElementById("aif-office-subname");
  const officeNotFound = document.getElementById("aif-office-not-found");
  const officeOptionsContainer = document.getElementById("aif-office-options");

  const tabPublic = document.getElementById("aif-tab-public");
  const tabAcademic = document.getElementById("aif-tab-academic");

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
  let _updateStaff;
  let _addOffice;

  const _loadApis = async () => {
    if (_addStaff) return;
    const mod = await import("../../../../backend/api/staff.js");
    _addStaff = mod.addStaff;
    _updateStaff = mod.updateStaff;
    _fetchOffices = mod.fetchOffices;
    _fetchRoles = mod.fetchRoles;
    _addOffice = mod.addOffice;
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

  const _isMobile = () => window.innerWidth < 640;

  const openDrawer = async (staffData = null) => {
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
      document.getElementById("aif-address").value = staffData.address || "";
      document.getElementById("aif-religion").value = staffData.religion || "";
      document.getElementById("aif-language").value = staffData.language || "";
      document.getElementById("aif-blood-type").value = staffData.blood_type || "";
      document.getElementById("aif-phone").value = staffData.phone || "";
      
      const approvedToggle = document.getElementById("aif-approved");
      approvedToggle.checked = Boolean(staffData.approved);
      approvedToggle.disabled = false;
    } else {
      currentEditId = null;
      titleEl.textContent = "Add Implementor";
      descEl.textContent = "Fill in the details to create a new staff account.";
      submitBtn.innerHTML = `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Save Implementor`;
      pwdLabel.innerHTML = `Password <span class="text-red-500">*</span>`;
      confirmPwdLabel.innerHTML = `Confirm Password <span class="text-red-500">*</span>`;
      pwdInput.required = true;
      confirmPwdInput.required = true;
      
      const approvedToggle = document.getElementById("aif-approved");
      approvedToggle.checked = false;
      approvedToggle.disabled = false;
      
      const officeSearch = document.getElementById("aif-office-search");
      if (officeSearch) officeSearch.value = "";
      if (officeMeta) officeMeta.textContent = "Select an office to view its stored location.";
      setTabActive("public");
      const notFound = document.getElementById("aif-office-not-found");
      if(notFound) notFound.classList.add("hidden");
    }

    drawerEl.classList.remove("hidden");
    drawerEl.setAttribute("aria-hidden", "false");
    overlay.classList.remove("hidden");
    drawerEl.offsetHeight;
    requestAnimationFrame(() => {
      overlay.classList.remove("opacity-0");
      overlay.classList.add("opacity-100");
      if (_isMobile()) {
        drawerEl.classList.remove("translate-y-full");
        drawerEl.classList.add("translate-y-0");
      } else {
        drawerEl.classList.remove("sm:translate-x-full");
        drawerEl.classList.add("sm:translate-x-0");
      }
    });
    document.body.classList.add("overflow-hidden");
  };

  const closeDrawer = () => {
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

    const payload = {
      full_name:  document.getElementById("aif-full-name").value.trim(),
      username:   document.getElementById("aif-username").value.trim(),
      email:      document.getElementById("aif-email").value.trim() || null,
      office_id:  document.getElementById("aif-office").value || null,
      role_id:    document.getElementById("aif-role").value || null,
      address:    document.getElementById("aif-address").value.trim() || null,
      religion:   document.getElementById("aif-religion").value.trim() || null,
      language:   document.getElementById("aif-language").value.trim() || null,
      blood_type: document.getElementById("aif-blood-type").value || null,
      phone:      document.getElementById("aif-phone").value.trim() || null,
      approved:   document.getElementById("aif-approved")?.checked || false,
    };
    
    if (pwd && !currentEditId) {
      payload.password = pwd;
    }

    if (!payload.full_name) return _showError("Full name is required.");
    if (!payload.username) return _showError("Username is required.");
    if (!payload.office_id) return _showError("Please select an office.");
    if (!payload.role_id) return _showError("Please select a role.");

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
  const batchNumberInput = document.getElementById("batch-form-number");
  const batchNameInput = document.getElementById("batch-form-name");

  if (!drawerEl || !overlay || !form) {
    const missing = [
      !drawerEl && "#drawer-batch-form",
      !overlay && "#drawer-batch-form-overlay",
      !form && "#form-batch-drawer"
    ].filter(Boolean);
    console.error(`[SPES Batch Drawer] Cannot initialize. Missing: ${missing.join(", ")}`);
    return { open: () => false, close: () => false, isOpen: () => false };
  }

  let currentEditId = null;
  let closeTimer = null;
  let _addBatch;
  let _updateBatch;
  const _loadApis = async () => {
    if (_addBatch && _updateBatch) return;
    const mod = await import("../../../../backend/api/beneficiary.js");
    _addBatch = mod.addBatch;
    _updateBatch = mod.updateBatch;
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

  const _isMobile = () => window.innerWidth < 640;
  const _setDrawerTransform = (isOpen) => {
    drawerEl.style.transform = isOpen
      ? "translate3d(0, 0, 0)"
      : (_isMobile() ? "translate3d(0, 100%, 0)" : "translate3d(100%, 0, 0)");
  };

  const openDrawer = (batch = null) => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
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
    if (batchNumberInput) batchNumberInput.value = batch?.batchNumber ?? "";
    if (batchNameInput) batchNameInput.value = batch?.batchName ?? "";

    drawerEl.classList.remove("hidden");
    drawerEl.setAttribute("aria-hidden", "false");
    overlay.classList.remove("hidden");
    overlay.classList.add("block");
    _setDrawerTransform(false);
    drawerEl.offsetHeight;
    requestAnimationFrame(() => {
      overlay.classList.remove("opacity-0");
      overlay.classList.add("opacity-100");
      _setDrawerTransform(true);
    });
    document.body.classList.add("overflow-hidden");
    setTimeout(() => batchNumberInput?.focus(), 300);
    return true;
  };

  const closeDrawer = ({ immediate = false } = {}) => {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    drawerEl.setAttribute("aria-hidden", "true");
    _setDrawerTransform(false);
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

    const batchNumber = batchNumberInput?.value.trim() ?? "";
    const batchName = batchNameInput?.value.trim() ?? "";
    if (!batchNumber) return _showError("Batch Number is required.");

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving...";
    }
    await _loadApis();

    let sessionStaffId = null;
    try {
      const sessionRaw = localStorage.getItem("spes_session");
      if (sessionRaw) {
        const session = JSON.parse(sessionRaw);
        if (String(session.role).toLowerCase() !== "admin") sessionStaffId = session.id;
      }
    } catch {}

    const payload = {
      batchNumber,
      batchName: batchName || null,
      created_by_staff_id: sessionStaffId
    };
    const result = currentEditId
      ? await _updateBatch(currentEditId, payload)
      : await _addBatch(payload);

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = currentEditId ? "Update Batch" : "Save Batch";
    }
    if (!result.success) {
      return _showError(result.error || (currentEditId ? "Failed to update batch." : "Failed to create batch."));
    }

    const completedMode = currentEditId ? "updated" : "created";
    closeDrawer();
    import("./modals.js").then(({ modals }) => {
      modals.success(
        completedMode === "updated" ? "Batch Updated" : "Batch Created",
        `Batch ${batchNumber} has been ${completedMode} successfully.`
      );
    });
    if (typeof onSuccess === "function") onSuccess(result.data, { mode: completedMode });
  });

  return {
    open: openDrawer,
    close: closeDrawer,
    isOpen: () => drawerEl.getAttribute("aria-hidden") === "false"
  };
}// --- END: BATCH FORM DRAWER ---
