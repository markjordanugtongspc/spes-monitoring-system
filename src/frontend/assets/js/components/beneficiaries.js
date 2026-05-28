import { setupSortFiltration } from "./sort-filtration.js";

export function initBeneficiaries() {
  const tbody = document.getElementById("beneficiary-table-body");
  if (!tbody) return;

  const mockBeneficiaries = [
    { name: "Mark Jordan Ugtong", dob: "05/12/2004", age: 22, address: "Poblacion, Iligan City", beneficiary: "Maria Ugtong", relationship: "MOTHER", period: "MAY 2026", amount: 50 },
    { name: "Walleen Ates", dob: "11/24/2003", age: 22, address: "Tubod, Iligan City", beneficiary: "Roberto Ates", relationship: "FATHER", period: "MAY 2026", amount: 50 },
    { name: "Nurkeymar Abdul", dob: "08/03/2004", age: 21, address: "Del Carmen, Iligan City", beneficiary: "Amina Abdul", relationship: "MOTHER", period: "JUNE 2026", amount: 50 },
    { name: "Mark Lloyd Gelica", dob: "02/18/2004", age: 22, address: "Hinaplanon, Iligan City", beneficiary: "Gina Gelica", relationship: "MOTHER", period: "MAY 2026", amount: 50 },
    { name: "Leonor Rivera", dob: "10/05/2003", age: 22, address: "Tambacan, Iligan City", beneficiary: "Juan Rivera", relationship: "FATHER", period: "APRIL 2026", amount: 50 },
    { name: "Emilio Aguinaldo", dob: "03/22/2004", age: 22, address: "Pala-o, Iligan City", beneficiary: "Trinidad Aguinaldo", relationship: "MOTHER", period: "MAY 2026", amount: 50 },
    { name: "Gabriela Silang", dob: "09/19/2003", age: 22, address: "Kiaya, Iligan City", beneficiary: "Diego Silang", relationship: "FATHER", period: "JUNE 2026", amount: 50 },
    { name: "Jose Rizal", dob: "06/19/2004", age: 21, address: "Calamba, Laguna", beneficiary: "Teodora Alonzo", relationship: "MOTHER", period: "MAY 2026", amount: 50 },
    { name: "Andres Bonifacio", dob: "11/30/2003", age: 22, address: "Tondo, Manila", beneficiary: "Gregoria de Jesus", relationship: "SPOUSE", period: "MAY 2026", amount: 50 },
    { name: "Apolinario Mabini", dob: "07/23/2004", age: 21, address: "Tanauan, Batangas", beneficiary: "Dionisia Maranan", relationship: "MOTHER", period: "JUNE 2026", amount: 50 },
    { name: "Marcelo del Pilar", dob: "08/30/2003", age: 22, address: "Cupang, Bulacan", beneficiary: "Marciana Hilario", relationship: "SPOUSE", period: "MAY 2026", amount: 50 },
    { name: "Juan Luna", dob: "10/23/2003", age: 22, address: "Badoc, Ilocos Norte", beneficiary: "Laureana Novicio", relationship: "MOTHER", period: "APRIL 2026", amount: 50 },
    { name: "Melchora Aquino", dob: "01/06/2004", age: 22, address: "Balintawak, Quezon City", beneficiary: "Juan Aquino", relationship: "SON", period: "MAY 2026", amount: 50 },
    { name: "Teresa Magbanua", dob: "10/13/2003", age: 22, address: "Pototan, Iloilo", beneficiary: "Alejandro Balderas", relationship: "SPOUSE", period: "JUNE 2026", amount: 50 }
  ];

  let activeBeneficiaries = [...mockBeneficiaries];
  let currentPage = 1;
  const rowsPerPage = 10;

  // Drawer Elements
  const drawer = document.getElementById("drawer-beneficiary-details");
  const content = document.getElementById("drawer-beneficiary-content");
  const closeBtn = document.getElementById("btn-close-beneficiary-drawer");

  const openDrawer = (b, index) => {
    if (!drawer || !content) return;
    
    // Set Drawer Title to the dynamic name of assured with strict responsive, non-wrapping constraints
    const drawerLabel = document.getElementById("drawer-label");
    if (drawerLabel) {
      drawerLabel.textContent = b.name.toUpperCase();
      drawerLabel.className = "text-sm sm:text-base md:text-lg font-montserrat font-black text-spes-blue dark:text-white tracking-tight uppercase truncate whitespace-nowrap max-w-[190px] sm:max-w-[250px]";
    }

    // Determine gender dynamically
    const nameLower = b.name.toLowerCase();
    const isFemale = nameLower.includes("walleen") || nameLower.includes("leonor") || nameLower.includes("gabriela") || nameLower.includes("melchora") || nameLower.includes("teresa");
    const gender = isFemale ? "FEMALE" : "MALE";

    // Render layout with clean Designated Beneficiary & Relationship rows at the top (no border boxes/backgrounds)
    content.innerHTML = `
      <!-- Designated Beneficiary & Relationship Highlights (No Bg Color, Clean Rows) -->
      <div class="space-y-3 text-xs sm:text-sm mt-2 mb-4">
        <div class="flex justify-between items-start py-1.5">
          <span class="font-bold text-spes-black/55 dark:text-white/50 text-xs sm:text-sm">Designated Beneficiary</span>
          <span class="font-black text-right text-spes-black dark:text-white uppercase text-xs sm:text-sm">${b.beneficiary.toUpperCase()}</span>
        </div>
        
        <div class="flex justify-between items-center py-1.5">
          <span class="font-bold text-spes-black/55 dark:text-white/50 text-xs sm:text-sm">Relationship to Assured</span>
          <span class="font-black text-emerald-600 dark:text-emerald-400 uppercase text-xs sm:text-sm">${b.relationship.toUpperCase()}</span>
        </div>
      </div>
      
      <hr class="border-t-2 border-spes-black dark:border-white/20 my-4" />
      
      <!-- Personal Profile Section Header with Controls -->
      <div class="flex items-center justify-between mb-5">
        <h4 class="font-montserrat text-xs font-black uppercase tracking-wider text-spes-black/50 dark:text-white/50">Personal Profile</h4>
        <div class="flex items-center gap-1.5">
          <button id="btn-drawer-prev" class="cursor-pointer inline-flex items-center gap-1 rounded-md border border-spes-blue/20 bg-white dark:bg-transparent dark:border-white/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-spes-black/60 dark:text-white/70 hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
            Prev
          </button>
          <button id="btn-drawer-next" class="cursor-pointer inline-flex items-center gap-1 rounded-md bg-spes-blue px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-white hover:bg-spes-blue/90 shadow-md transition-all">
            Next
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
      
      <!-- Profile Detail Rows -->
      <div class="space-y-4 text-xs">
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Contact No.</span>
          <span class="font-black italic text-spes-black/30 dark:text-white/30 uppercase">Not Provided</span>
        </div>
        
        <div class="flex justify-between items-start py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Address</span>
          <span class="font-extrabold text-right text-spes-black dark:text-white max-w-[200px] uppercase">${b.address.toUpperCase()}</span>
        </div>
        
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Birthday</span>
          <span class="font-extrabold text-spes-black dark:text-white">${b.dob}</span>
        </div>
        
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Age</span>
          <span class="font-extrabold text-spes-black dark:text-white">${b.age}</span>
        </div>
        
        <div class="flex justify-between items-center py-1 border-b border-gray-50 dark:border-white/5">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Gender</span>
          <span class="font-extrabold text-spes-black dark:text-white uppercase">${gender}</span>
        </div>
        
        <div class="flex justify-between items-center py-1">
          <span class="font-bold text-spes-black/55 dark:text-white/50">Education</span>
          <span class="inline-flex items-center gap-1 rounded bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
            <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l9-5-9-5-9 5 9 5z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" /></svg>
            College Level
          </span>
        </div>
      </div>
    `;

    // Hook up Prev / Next slide controls in the drawer
    document.getElementById("btn-drawer-prev")?.addEventListener("click", () => {
      const prevIndex = (index - 1 + mockBeneficiaries.length) % mockBeneficiaries.length;
      openDrawer(mockBeneficiaries[prevIndex], prevIndex);
    });
    document.getElementById("btn-drawer-next")?.addEventListener("click", () => {
      const nextIndex = (index + 1) % mockBeneficiaries.length;
      openDrawer(mockBeneficiaries[nextIndex], nextIndex);
    });

    // Handle Backdrop Animation
    const backdrop = document.getElementById("drawer-backdrop");
    if (backdrop) {
      backdrop.classList.remove("hidden");
      setTimeout(() => {
        backdrop.classList.remove("opacity-0");
        backdrop.classList.add("opacity-100");
      }, 10);
      backdrop.addEventListener("click", closeDrawer);
    }

    // Open animations: Remove hidden states
    drawer.classList.remove("translate-y-full", "sm:translate-x-full");
    drawer.classList.add("translate-y-0", "sm:translate-x-0");
  };

  const closeDrawer = () => {
    if (!drawer) return;
    
    // Close Backdrop Animation
    const backdrop = document.getElementById("drawer-backdrop");
    if (backdrop) {
      backdrop.classList.remove("opacity-100");
      backdrop.classList.add("opacity-0");
      setTimeout(() => backdrop.classList.add("hidden"), 300);
    }

    drawer.classList.remove("translate-y-0", "sm:translate-x-0");
    drawer.classList.add("translate-y-full", "sm:translate-x-full");
  };

  if (closeBtn) closeBtn.addEventListener("click", closeDrawer);

  // Dynamic Pagination Renderer
  function renderPaginatedTable() {
    const start = (currentPage - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    const paginatedItems = activeBeneficiaries.slice(start, end);

    // Render Table Rows
    tbody.innerHTML = paginatedItems.map((b, idx) => {
      // Calculate absolute index in activeBeneficiaries array
      const absoluteIndex = start + idx;
      
      return `
        <tr class="border-b border-gray-100 dark:border-white/5 bg-white dark:bg-spes-dark-primary transition-all duration-200 hover:bg-spes-blue/8 dark:hover:bg-spes-yellow/8 hover:border-l-4 hover:border-spes-blue dark:hover:border-spes-yellow cursor-pointer" data-beneficiary-idx="${absoluteIndex}">
          <td class="p-4 text-center">
            <div class="flex items-center justify-center">
              <input type="checkbox" class="beneficiary-row-checkbox h-4 w-4 cursor-pointer rounded-full border-gray-300 text-spes-blue focus:ring-2 focus:ring-spes-blue/20 dark:border-white/20 dark:bg-spes-dark-secondary dark:text-spes-yellow">
            </div>
          </td>
          <td class="px-6 py-4 text-left font-extrabold text-spes-black dark:text-spes-white whitespace-nowrap">${b.name.toUpperCase()}</td>
          <td class="px-6 py-4 text-left font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${b.address}</td>
          <td class="px-6 py-4 text-center font-bold text-spes-black/70 dark:text-spes-white/70 whitespace-nowrap">${b.period}</td>
          <td class="px-6 py-4 text-center font-black text-emerald-600 dark:text-emerald-400 whitespace-nowrap">₱${b.amount}</td>
          <td class="px-6 py-4 text-center whitespace-nowrap">
            <button class="cursor-pointer inline-flex items-center justify-center rounded-lg p-2 text-spes-blue transition-colors hover:bg-spes-blue/10 dark:text-spes-yellow dark:hover:bg-spes-yellow/10" title="Edit">
              <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // Attach Row Clicks for Drawer Opening
    const rows = tbody.querySelectorAll("tr");
    rows.forEach(row => {
      const checkbox = row.querySelector(".beneficiary-row-checkbox");
      if (checkbox) {
        checkbox.addEventListener("click", (e) => e.stopPropagation());
      }
      
      row.addEventListener("click", () => {
        const absoluteIndex = parseInt(row.getAttribute("data-beneficiary-idx"), 10);
        openDrawer(activeBeneficiaries[absoluteIndex], absoluteIndex);
      });
    });

    // Update Pagination Info
    const totalEl = document.getElementById("pagination-total");
    const rangeEl = document.getElementById("pagination-range");
    if (totalEl) totalEl.textContent = activeBeneficiaries.length;
    if (rangeEl) rangeEl.textContent = `${start + 1}-${Math.min(end, activeBeneficiaries.length)}`;

    // Render Page Number Indicators
    const pageIndicatorsContainer = document.getElementById("page-indicators-container");
    if (pageIndicatorsContainer) {
      const totalPages = Math.ceil(activeBeneficiaries.length / rowsPerPage);
      let indicatorsHtml = "";
      for (let i = 1; i <= totalPages; i++) {
        const isActive = i === currentPage;
        const activeClasses = isActive 
          ? "bg-spes-blue/8 text-spes-blue dark:bg-white/10 dark:text-spes-yellow font-bold border-spes-blue/15" 
          : "bg-spes-white text-spes-black/60 hover:bg-spes-blue/8 hover:text-spes-blue dark:bg-spes-dark-primary dark:text-spes-white/60 dark:hover:bg-spes-white/8 dark:hover:text-spes-yellow border-spes-blue/15 dark:border-white/10";
        indicatorsHtml += `
          <li>
            <button class="cursor-pointer border px-3 py-2 text-sm font-medium ${activeClasses}" data-page="${i}">${i}</button>
          </li>
        `;
      }
      pageIndicatorsContainer.innerHTML = indicatorsHtml;

      // Add click listeners to page buttons
      pageIndicatorsContainer.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", (e) => {
          currentPage = parseInt(e.target.getAttribute("data-page"), 10);
          renderPaginatedTable();
        });
      });
    }
  }

  // Hook Up Next / Previous Controls
  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderPaginatedTable();
    }
  });

  document.getElementById("next-page")?.addEventListener("click", () => {
    const totalPages = Math.ceil(activeBeneficiaries.length / rowsPerPage);
    if (currentPage < totalPages) {
      currentPage++;
      renderPaginatedTable();
    }
  });

  // Select all checkboxes toggle
  const checkAll = document.getElementById("staff-checkbox-all");
  if (checkAll) {
    checkAll.addEventListener("change", (e) => {
      const isChecked = e.target.checked;
      const rowCbs = document.querySelectorAll(".beneficiary-row-checkbox");
      rowCbs.forEach(cb => cb.checked = isChecked);
    });
  }

  // Initialize sorting & filtration component
  setupSortFiltration({
    tableId: "beneficiary-table-body",
    btnSortId: "btn-sort-beneficiary",
    dropdownSortId: "dropdown-sort-beneficiary",
    btnFilterId: "btn-filter-beneficiary",
    dropdownFilterId: "dropdown-filter-beneficiary",
    originalData: mockBeneficiaries,
    onRender: (filteredData) => {
      activeBeneficiaries = filteredData;
      currentPage = 1;
      renderPaginatedTable();
    }
  });
}
