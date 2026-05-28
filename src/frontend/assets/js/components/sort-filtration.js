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

  if (!btnSort || !dropdownSort || !btnFilter || !dropdownFilter) return;

  // ── Highlight default filter options on first load ──────────
  Object.keys(activeFilters).forEach(key => {
    const val   = activeFilters[key];
    const match = dropdownFilter.querySelector(`[data-filter-key="${key}"][data-filter-val="${val}"]`);
    if (match) match.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");
  });

  // Toggle dropdowns on click
  btnSort.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownSort.classList.toggle("hidden");
    dropdownFilter.classList.add("hidden");
  });

  btnFilter.addEventListener("click", (e) => {
    e.stopPropagation();
    dropdownFilter.classList.toggle("hidden");
    dropdownSort.classList.add("hidden");
  });

  // Close dropdowns on outside click
  document.addEventListener("click", () => {
    dropdownSort.classList.add("hidden");
    dropdownFilter.classList.add("hidden");
  });

  dropdownSort.addEventListener("click", (e) => e.stopPropagation());
  dropdownFilter.addEventListener("click", (e) => e.stopPropagation());

  // Setup Sort Logic
  const sortOptions = dropdownSort.querySelectorAll("[data-sort-val]");
  sortOptions.forEach(opt => {
    opt.addEventListener("click", () => {
      activeSort = opt.getAttribute("data-sort-val");

      // Update checkmarks/active classes
      sortOptions.forEach(o => o.classList.remove("text-spes-blue", "font-bold", "dark:text-spes-yellow"));
      opt.classList.add("text-spes-blue", "font-bold", "dark:text-spes-yellow");

      dropdownSort.classList.add("hidden");
      applySortAndFilter();
    });
  });

  // Setup Filter Logic
  const filterOptions = dropdownFilter.querySelectorAll("[data-filter-key]");
  filterOptions.forEach(opt => {
    opt.addEventListener("click", () => {
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
  });

  // Setup Search Input Listener
  const searchInput = document.getElementById("staff-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const val = e.target.value.toLowerCase();
      if (val === "") {
        delete activeFilters["search"];
      } else {
        activeFilters["search"] = val;
      }
      applySortAndFilter();
    });
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
          return (
            nameVal.includes(activeValue) ||
            emailVal.includes(activeValue) ||
            officeVal.includes(activeValue) ||
            addrVal.includes(activeValue)
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
      } else {
        processed = processed.filter(item => {
          const itemVal = (item[key] || "").toString().toLowerCase();
          return itemVal.includes(activeValue);
        });
      }
    });

    // 2. Apply Sorting
    if (activeSort === "name-asc") {
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
    }
  };
}
