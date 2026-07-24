import { preferenceStorage } from "./storage.js";

/**
 * SPES Portal — General Sorting and Filtration Component
 * ────────────────────────────────────────────────────────
 */
export function setupSortFiltration({
  tableId,
  btnSortId,
  dropdownSortId,
  btnFilterId,
  dropdownFilterId,
  panelId,            // shared panel wrapping both sort + filter sections
  tabSortId,          // segmented "Sort" tab button
  tabFilterId,        // segmented "Filter" tab button
  originalData,
  defaultFilters = {},
  onRender
}) {
  let activeSort = "none";
  // Merge caller-supplied defaults (e.g. { archiveStatus: "active" } for implementors,
  // or { status: "active" } for beneficiaries) so archived rows are hidden by default.
  let activeFilters = { ...defaultFilters };

  const btnSort        = document.getElementById(btnSortId);
  const dropdownSort   = document.getElementById(dropdownSortId);
  const btnFilter      = document.getElementById(btnFilterId);
  const dropdownFilter = document.getElementById(dropdownFilterId);
  const panel          = panelId ? document.getElementById(panelId) : null;
  const tabSort        = tabSortId ? document.getElementById(tabSortId) : null;
  const tabFilter      = tabFilterId ? document.getElementById(tabFilterId) : null;

  if (!btnFilter || !dropdownFilter) return;

  // ── Highlight default filter options on first load ──────────
  Object.keys(activeFilters).forEach(key => {
    const val   = activeFilters[key];
    const match = dropdownFilter.querySelector(`[data-filter-key="${key}"][data-filter-val="${val}"]`);
    if (match) match.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");
  });

  // ── Tab switching (shared-panel mode) ───────────────────────
  const _tabActive   = ["bg-white", "text-spes-blue", "shadow-sm", "dark:bg-white/10", "dark:text-spes-yellow"];
  const _tabInactive = ["text-gray-500", "hover:text-spes-blue", "dark:text-gray-400", "dark:hover:text-spes-yellow"];
  function showSection(which) {
    if (!panel) return;
    const sort = which === "sort";
    if (dropdownSort) {
      dropdownSort.classList.toggle("hidden", !sort);
      dropdownSort.classList.toggle("flex", sort);
    }
    dropdownFilter.classList.toggle("hidden", sort);
    dropdownFilter.classList.toggle("flex", !sort);
    if (tabSort && tabFilter) {
      (sort ? tabSort : tabFilter).classList.add(..._tabActive);
      (sort ? tabSort : tabFilter).classList.remove(..._tabInactive);
      (sort ? tabFilter : tabSort).classList.add(..._tabInactive);
      (sort ? tabFilter : tabSort).classList.remove(..._tabActive);
    }
  }
  tabSort?.addEventListener("click",   (e) => { e.stopPropagation(); showSection("sort"); });
  tabFilter?.addEventListener("click", (e) => { e.stopPropagation(); showSection("filter"); });

  if (panel) {
    // Shared-panel mode: both triggers open the same panel, pre-selecting a tab.
    if (btnSort) {
      btnSort.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = panel.classList.contains("hidden");
        panel.classList.remove("hidden");
        showSection("sort");
        if (!willOpen) showSection("sort");
      });
    }
    btnFilter.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.remove("hidden");
      showSection("filter");
    });
    document.addEventListener("click", () => panel.classList.add("hidden"));
    panel.addEventListener("click", (e) => e.stopPropagation());
  } else {
    // Legacy two-dropdown mode
    if (btnSort && dropdownSort) {
      btnSort.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdownSort.classList.toggle("hidden");
        dropdownFilter.classList.add("hidden");
      });
    }
    btnFilter.addEventListener("click", (e) => {
      e.stopPropagation();
      dropdownFilter.classList.toggle("hidden");
      dropdownSort.classList.add("hidden");
    });
    document.addEventListener("click", () => {
      if (dropdownSort) dropdownSort.classList.add("hidden");
      dropdownFilter.classList.add("hidden");
    });
    if (dropdownSort) dropdownSort.addEventListener("click", (e) => e.stopPropagation());
    dropdownFilter.addEventListener("click", (e) => e.stopPropagation());
  }

  // Setup Sort Logic
  if (dropdownSort) {
    const sortOptions = dropdownSort.querySelectorAll("[data-sort-val]");
    sortOptions.forEach(opt => {
      opt.addEventListener("click", () => {
        activeSort = opt.getAttribute("data-sort-val");

        // Update checkmarks/active classes
        sortOptions.forEach(o => o.classList.remove("text-spes-blue", "font-bold", "dark:text-spes-yellow"));
        opt.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");

        if (!panel) dropdownSort.classList.add("hidden");
        applySortAndFilter();
      });
    });
  }

  // Setup Filter Logic via Event Delegation
  dropdownFilter.addEventListener("click", (e) => {
    const opt = e.target.closest("[data-filter-key]");
    if (!opt) return;

    const key = opt.getAttribute("data-filter-key");
    const val = opt.getAttribute("data-filter-val");

    if (val === "all") {
      delete activeFilters[key];
    } else {
      activeFilters[key] = val;
    }

    // Update active highlights for siblings in the same group
    const siblings = dropdownFilter.querySelectorAll(`[data-filter-key="${key}"]`);
    siblings.forEach(s => s.classList.remove("text-spes-blue", "font-bold", "dark:text-spes-yellow"));
    opt.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");

    applySortAndFilter();
  });

  // Setup Search Input Listener + reusable clear control
  const searchInput = document.getElementById("staff-search-input");
  let searchClearButton = null;
  const syncSearchClearVisibility = () => {
    if (!searchClearButton || !searchInput) return;
    const hasValue = searchInput.value.length > 0;
    searchClearButton.classList.toggle("hidden", !hasValue);
    searchClearButton.classList.toggle("flex", hasValue);
  };
  if (searchInput) {
    const searchWrap = searchInput.parentElement;
    if (searchWrap) {
      searchWrap.classList.add("relative");
      searchInput.classList.remove("pe-3", "pe-4");
      searchInput.classList.add("pe-10");
      searchClearButton = searchWrap.querySelector('[data-clear-for="staff-search-input"]');
      if (!searchClearButton) {
        searchClearButton = document.createElement("button");
        searchClearButton.type = "button";
        searchClearButton.dataset.clearFor = "staff-search-input";
        searchClearButton.className = "group absolute inset-y-0 end-2 hidden cursor-pointer items-center justify-center px-1 text-red-500 transition-colors hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500";
        searchClearButton.setAttribute("aria-label", "Clear search");
        searchClearButton.innerHTML = `
          <svg class="h-4 w-4" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18 18 6M6 6l12 12"/>
          </svg>
          <span class="pointer-events-none absolute bottom-full end-0 mb-1 whitespace-nowrap bg-red-600 px-2 py-1 text-[0.625rem] font-bold text-white opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Clear</span>
        `;
        searchWrap.appendChild(searchClearButton);
      }
      searchClearButton.addEventListener("click", () => {
        searchInput.value = "";
        searchInput.dispatchEvent(new Event("input", { bubbles: true }));
        searchInput.focus();
      });
    }
    searchInput.addEventListener("input", (e) => {
      const val = e.target.value.toLowerCase();
      if (val === "") {
        delete activeFilters["search"];
      } else {
        activeFilters["search"] = val;
      }
      applySortAndFilter();
      syncSearchClearVisibility();
    });
    syncSearchClearVisibility();
  }

  function applySortAndFilter() {
    let processed = [...originalData];

    // 1. Apply Filtering
    Object.keys(activeFilters).forEach(key => {
      const activeValue = activeFilters[key].toLowerCase();

      if (key === "search") {
        processed = processed.filter(item => {
          const nameVal   = (item.name || item.full_name || "").toLowerCase();
          const emailVal  = (item.email || "").toLowerCase();
          const officeVal = (item.office || "").toLowerCase();
          const addrVal   = (item.address || "").toLowerCase();
          const contactVal= (item.contact_number || "").toLowerCase();
          return (
            nameVal.includes(activeValue) ||
            emailVal.includes(activeValue) ||
            officeVal.includes(activeValue) ||
            addrVal.includes(activeValue) ||
            contactVal.includes(activeValue)
          );
        });
      } else if (key === "status") {
        // Beneficiaries — uses `archived_at` (with 'd')
        if (activeValue === "active") {
          processed = processed.filter(item => !item.archived_at);
        } else if (activeValue === "archived") {
          processed = processed.filter(item => !!item.archived_at);
        }
      } else if (key === "archiveStatus") {
        // Implementors — uses `archive_at` (no 'd')
        if (activeValue === "active") {
          processed = processed.filter(item => !item.archive_at);
        } else if (activeValue === "archived") {
          processed = processed.filter(item => !!item.archive_at);
        }
      } else if (key === "batch_number") {
        processed = processed.filter(item => {
          const num = item.batch?.batch_number;
          return num != null && String(num) === activeValue;
        });
      } else if (key === "return_status") {
        processed = processed.filter(item =>
          String(item.return_status || "NEW").toLowerCase() === activeValue
        );
      } else if (key === "period") {
        processed = processed.filter(item => {
          const p = [item.month_period, item.year_period].filter(Boolean).join(" ").toLowerCase();
          return p === activeValue;
        });
      } else if (key === "education_name") {
        processed = processed.filter(item => {
          const catName = (item.education?.name || "").toLowerCase().trim();
          let lvlName = (item.education_level?.name || "").toLowerCase().trim();
          const prefLvl = (preferenceStorage.getBeneficiaryEduLevel(item.id) || "").toLowerCase().trim();
          if (!lvlName && prefLvl) lvlName = prefLvl;

          const cleanLvl = lvlName.replace(/\s+college$/i, "").trim();
          const target = activeValue.replace(/\s+college$/i, "").trim();

          if (catName === target) return true;
          if (lvlName === target || cleanLvl === target) return true;
          if (lvlName.includes(target) || cleanLvl.includes(target)) return true;
          return false;
        });
      } else if (key === "gender_name") {
        processed = processed.filter(item => (item.gender?.name || "").toLowerCase() === activeValue);
      } else if (key === "bday_month") {
        const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
        processed = processed.filter(item => {
          if (!item.birthday) return false;
          const d = new Date(item.birthday);
          if (isNaN(d.getTime())) return false;
          return monthNames[d.getMonth()] === activeValue;
        });
      } else {
        processed = processed.filter(item => {
          const itemVal = (item[key] || "").toString().toLowerCase();
          return itemVal.includes(activeValue);
        });
      }
    });

    // 2. Apply Sorting
    if (activeSort === "none") {
      processed.sort((a, b) => {
        const aTime = Date.parse(a.created_at || a.createdAt || "");
        const bTime = Date.parse(b.created_at || b.createdAt || "");
        const safeATime = Number.isNaN(aTime) ? 0 : aTime;
        const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
        if (safeATime !== safeBTime) return safeBTime - safeATime;
        return (Number(b.id) || 0) - (Number(a.id) || 0);
      });
    } else if (activeSort === "name-asc") {
      processed.sort((a, b) => (a.name || a.full_name || "").localeCompare(b.name || b.full_name || ""));
    } else if (activeSort === "name-desc") {
      processed.sort((a, b) => (b.name || b.full_name || "").localeCompare(a.name || a.full_name || ""));
    } else if (activeSort === "id-asc") {
      processed.sort((a, b) => (a.id || 0) - (b.id || 0));
    } else if (activeSort === "amount-desc") {
      processed.sort((a, b) => (b.amount || 0) - (a.amount || 0));
    }

    onRender(processed);
  }

  // Initial render — populate table on first load
  applySortAndFilter();

  // Expose triggers in case search bar updates original data
  return {
    updateData(newData) {
      originalData = newData;
      applySortAndFilter();
    },
    resetFilters() {
      activeFilters = { ...defaultFilters };
      activeSort = "none";
      
      // Clear visual highlights in filter/sort dropdowns
      if (dropdownFilter) {
        dropdownFilter.querySelectorAll("[data-filter-key]").forEach(s => s.classList.remove("text-spes-blue", "font-bold", "dark:text-spes-yellow"));
        // Re-apply default filter highlights if any
        Object.keys(activeFilters).forEach(key => {
          const val = activeFilters[key];
          const match = dropdownFilter.querySelector(`[data-filter-key="${key}"][data-filter-val="${val}"]`);
          if (match) match.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");
        });
      }
      
      if (dropdownSort) {
        dropdownSort.querySelectorAll("[data-sort-val]").forEach(o => o.classList.remove("text-spes-blue", "font-bold", "dark:text-spes-yellow"));
        dropdownSort.querySelector('[data-sort-val="none"]')?.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");
      }
      
      // Clear search input
      const searchInput = document.getElementById("staff-search-input");
      if (searchInput) searchInput.value = "";
      syncSearchClearVisibility();
      
      applySortAndFilter();
    },
    setFilter(key, val) {
      if (val === "all" || val === null || val === undefined) {
        delete activeFilters[key];
      } else {
        activeFilters[key] = val.toString();
      }
      applySortAndFilter();
    }
  };
}

// --- START: Registration Office Combobox Logic ---
export function setupRegOfficeCombobox() {
  const officeSearch = document.getElementById("reg-office-search");
  const officeDropdown = document.getElementById("reg-office-dropdown");
  const officeHiddenInput = document.getElementById("reg-office");
  const officeNotFound = document.getElementById("reg-office-not-found");
  const officeOptionsContainer = document.getElementById("reg-office-options");

  const tabPublic = document.getElementById("reg-tab-public");
  const tabAcademic = document.getElementById("reg-tab-academic");

  if (!officeSearch || !officeDropdown) return;

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
      o.name.toLowerCase().includes(query)
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
        btn.className = "reg-office-option cursor-pointer flex w-full items-center px-3.5 py-2 hover:bg-spes-blue/10 dark:hover:bg-white/5 text-sm text-left transition-colors duration-150";
        btn.textContent = o.name;
        btn.dataset.value = o.id;
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

  const loadOffices = async () => {
    try {
      const { supabase } = await import("../../../../backend/api/supabase.js");
      const { data, error } = await supabase
        .from("offices")
        .select("id, name, type")
        .order("name");

      if (!error && data) {
        allOffices = data;
        renderOfficeOptions();
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error("[SPES] Failed to fetch offices:", err?.message);
    }
  };

  loadOffices();

  officeSearch.addEventListener("focus", () => {
    officeDropdown.classList.remove("hidden");
  });
  
  officeSearch.addEventListener("input", () => {
    renderOfficeOptions();
  });

  officeOptionsContainer.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) {
      if (officeHiddenInput) officeHiddenInput.value = btn.dataset.value;
      officeSearch.value = btn.textContent;
      officeDropdown.classList.add("hidden");
      if (officeNotFound) officeNotFound.classList.add("hidden");
    }
  });

  tabPublic?.addEventListener("click", (e) => {
    e.stopPropagation();
    setTabActive("public");
    officeSearch.focus();
  });

  tabAcademic?.addEventListener("click", (e) => {
    e.stopPropagation();
    setTabActive("academic");
    officeSearch.focus();
  });

  document.addEventListener("click", (e) => {
    if (!officeSearch.contains(e.target) && !officeDropdown.contains(e.target)) {
      officeDropdown.classList.add("hidden");
    }
  });
}
// --- END: Registration Office Combobox Logic ---
