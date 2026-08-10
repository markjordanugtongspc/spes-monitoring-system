import ApexCharts from "apexcharts";
import { supabase } from "../../../../backend/api/supabase.js";
import { fetchGlobalStaffMetricRoster } from "../../../../backend/api/staff.js";
import { getOfficeAccessScope } from "../rbac/scope.js";

const BRAND_BLUE   = "#0038A8";
const BRAND_YELLOW = "#FCD116";
const BLUE_SHADES  = ["#0038A8", "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD", "#BFDBFE", "#DBEAFE"];

const fmt = (val) => Number(val).toLocaleString();
const compactCount = (val) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(Number(val) || 0).toLowerCase();
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#039;",
}[char]));

function _showNoData(el, msg = "No data available") {
  el.innerHTML = `<div class="flex h-full min-h-[160px] items-center justify-center text-xs font-bold uppercase tracking-widest text-gray-400 dark:text-white/30">${msg}</div>`;
}

function _tooltipClass() {
  const isDark = document.documentElement.classList.contains("dark");
  if (isDark) {
    return "p-2.5 bg-[#243447] text-white rounded-md shadow-lg border border-white/10 text-[11px] font-sans";
  } else {
    return "p-2.5 bg-white text-slate-800 rounded-md shadow-lg border border-gray-200 text-[11px] font-sans";
  }
}

// ── Export state — populated by each render function ──────────
const _xStat  = { totalImpl: 0, totalBenef: 0, male: 0, female: 0, yearData: {} };
const _xChart = {}; // keyed ApexCharts instances for dataURI() capture

let _cachedBeneficiaries = [];
// Chart 3 toggle — "NEW" (default) or "SPES BABY"
let _yearStatusMode = "NEW";

const PERIOD_MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];
const PERIOD_MONTH_INDEX = Object.fromEntries(PERIOD_MONTHS.map((month, index) => [month, index]));
let _dashboardDataset = { beneficiaries: [], genderBeneficiaries: [], topOfficeBeneficiaries: [], globalStaffs: [] };
let _dashboardPeriodFilter = { year: "all", month: "all" };

function _filterByDashboardPeriod(rows) {
  return rows.filter((row) => {
    const matchesYear = _dashboardPeriodFilter.year === "all" || String(row.year_period ?? "") === _dashboardPeriodFilter.year;
    const matchesMonth = _dashboardPeriodFilter.month === "all" || String(row.month_period ?? "").trim().toUpperCase() === _dashboardPeriodFilter.month;
    return matchesYear && matchesMonth;
  });
}

function _getDashboardPeriodOptions(rows) {
  const years = [...new Set(rows.map((row) => String(row.year_period ?? "").trim()).filter((year) => /^\d{4}$/.test(year)))].sort((a, b) => Number(b) - Number(a));
  const monthsByYear = {};
  years.forEach((year) => { monthsByYear[year] = []; });
  rows.forEach((row) => {
    const year = String(row.year_period ?? "").trim();
    const month = String(row.month_period ?? "").trim().toUpperCase();
    if (monthsByYear[year] && PERIOD_MONTH_INDEX[month] !== undefined && !monthsByYear[year].includes(month)) monthsByYear[year].push(month);
  });
  Object.values(monthsByYear).forEach((months) => months.sort((a, b) => PERIOD_MONTH_INDEX[a] - PERIOD_MONTH_INDEX[b]));
  const months = [...new Set(Object.values(monthsByYear).flat())].sort((a, b) => PERIOD_MONTH_INDEX[a] - PERIOD_MONTH_INDEX[b]);
  return { years, months, monthsByYear };
}

function _renderDashboardPeriodData() {
  const beneficiaries = _filterByDashboardPeriod(_dashboardDataset.beneficiaries);
  const genderBeneficiaries = _filterByDashboardPeriod(_dashboardDataset.genderBeneficiaries);
  const topOfficeBeneficiaries = _filterByDashboardPeriod(_dashboardDataset.topOfficeBeneficiaries);
  _cachedBeneficiaries = beneficiaries;
  _renderImplementorStatus(genderBeneficiaries, topOfficeBeneficiaries, _dashboardDataset.globalStaffs);
  _renderBeneficiariesByYear(beneficiaries);
  _renderEnrollmentByMonth(beneficiaries);
  return beneficiaries;
}

export function setDashboardPeriodFilter({ year = "all", month = "all" } = {}) {
  const normalizedMonth = String(month || "all").trim();
  _dashboardPeriodFilter = {
    year: String(year || "all"),
    month: normalizedMonth.toLowerCase() === "all" ? "all" : normalizedMonth.toUpperCase(),
  };
  const beneficiaries = _renderDashboardPeriodData();
  return { beneficiaries, periods: _getDashboardPeriodOptions(_dashboardDataset.beneficiaries) };
}

// Fill in return_status when the DB column is absent/null.
// SPES BABY = same full_name appears in an earlier year_period; else NEW.
function _deriveReturnStatus(beneficiaries) {
  const firstYearByName = {};
  beneficiaries.forEach(b => {
    const key = String(b.full_name ?? "").trim().toLowerCase();
    const yr  = b.year_period != null ? Number(b.year_period) : null;
    if (!key || yr == null) return;
    if (firstYearByName[key] == null || yr < firstYearByName[key]) firstYearByName[key] = yr;
  });
  beneficiaries.forEach(b => {
    if (b.return_status) { b.return_status = String(b.return_status).toUpperCase(); return; }
    const key = String(b.full_name ?? "").trim().toLowerCase();
    const yr  = b.year_period != null ? Number(b.year_period) : null;
    b.return_status = (key && yr != null && firstYearByName[key] != null && yr > firstYearByName[key])
      ? "SPES BABY" : "NEW";
  });
}

const CHART_PAGE_SIZE = 1000;

async function _fetchAllBeneficiaryChartRows({ isGlobal, officeId, minimal = false }) {
  if (!isGlobal && !officeId) {
    return { data: [], error: "No office is assigned to this account." };
  }

  const fields = minimal
    ? "staff_id, gender_id, month_period, year_period"
    : "id, staff_id, full_name, relationship, month_period, year_period, created_at, educ_id, gender_id, return_status";
  const selectStr = fields + (isGlobal ? "" : ", staffs!staff_id!inner(office_id)");
  const rows = [];

  for (let from = 0; ; from += CHART_PAGE_SIZE) {
    let query = supabase
      .from("beneficiary")
      .select(selectStr);

    if (!isGlobal) query = query.eq("staffs.office_id", officeId);
    query = query
      .order("id", { ascending: true })
      .range(from, from + CHART_PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) return { data: [], error };

    rows.push(...(data ?? []));
    if (!data || data.length < CHART_PAGE_SIZE) break;
  }

  return { data: rows, error: null };
}
export async function initDashboardCharts() {
  const sessionStr = localStorage.getItem("spes_session");
  const session = sessionStr ? JSON.parse(sessionStr) : {};
  const access = getOfficeAccessScope(session);
  const officeId = session.office_id;
  const isApproved = access.isAdmin || session.approved === true;
  const hasRequiredOffice = access.isAdmin || officeId != null;

  if (!isApproved || !hasRequiredOffice) {
    const unavailableMessage = !isApproved
      ? "Account approval required"
      : "No office assigned";
    ["distribution-chart", "spes-gender-chart", "column-chart", "mini-trends"]
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((el) => _showNoData(el, unavailableMessage));

    ["distribution-summary", "gender-roster-summary"].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = "";
      el.classList.add("hidden");
    });
    _cachedBeneficiaries = [];
    _dashboardDataset = { beneficiaries: [], genderBeneficiaries: [], topOfficeBeneficiaries: [], globalStaffs: [] };
    return { totalImplementors: 0, beneficiaries: [], periods: { years: [], months: [], monthsByYear: {} } };
  }

  const [staffResult, beneficiaryResult, topOfficeResult] = await Promise.all([
    fetchGlobalStaffMetricRoster(),
    _fetchAllBeneficiaryChartRows({
      isGlobal: access.canViewGlobalStats,
      officeId,
    }),
    access.canViewGlobalStats
      ? Promise.resolve(null)
      : _fetchAllBeneficiaryChartRows({ isGlobal: true, officeId: null, minimal: true }),
  ]);

  if (beneficiaryResult.error && import.meta.env.DEV) {
    console.error("[SPES Charts] beneficiary fetch error:", beneficiaryResult.error);
  }
  if (staffResult.error && import.meta.env.DEV) {
    console.error("[SPES Charts] global implementor metric fetch error:", staffResult.error);
  }
  if (topOfficeResult?.error && import.meta.env.DEV) {
    console.error("[SPES Charts] top-office metric fetch error:", topOfficeResult.error);
  }

  const globalStaffs = staffResult.data ?? [];
  const beneficiaries = beneficiaryResult.data ?? [];
  // Total Implementors is an approved-user baseline global metric. The
  // `view_global_stats` permission only expands beneficiary analytics; it
  // must not narrow this roster card back to the viewer's assigned office.
  const chartStaffs = globalStaffs;
  const ownOfficeBeneficiaries = access.canViewGlobalStats && officeId != null
    ? beneficiaries.filter((beneficiary) => {
        const staff = globalStaffs.find((item) => String(item.id) === String(beneficiary.staff_id));
        return String(staff?.office_id) === String(officeId);
      })
    : beneficiaries;
  const topOfficeBeneficiaries = topOfficeResult?.data ?? beneficiaries;
  
  _deriveReturnStatus(beneficiaries);
  _dashboardDataset = {
    beneficiaries,
    // Admin sees all gender records; every other role's gender card remains
    // limited to its own office even when global analytics is permitted.
    genderBeneficiaries: access.isAdmin ? beneficiaries : ownOfficeBeneficiaries,
    topOfficeBeneficiaries,
    globalStaffs,
  };

  _renderImplementorsByOffice(chartStaffs);
  const filteredBeneficiaries = _renderDashboardPeriodData();
  _setupTrendsSwitcher();
  _setupYearStatusSwitcher();

  return {
    totalImplementors: chartStaffs.length,
    beneficiaries: filteredBeneficiaries,
    periods: _getDashboardPeriodOptions(beneficiaries),
  };
}

// NEW / SPES BABY toggle on the "Added SPES per Year" card (default NEW)
function _setupYearStatusSwitcher() {
  const btnNew  = document.getElementById("btn-year-status-new");
  const btnBaby = document.getElementById("btn-year-status-baby");
  if (!btnNew || !btnBaby) return;

  const activeNew   = "bg-white text-emerald-600 shadow-sm dark:bg-white/10 dark:text-emerald-400";
  const inactiveNew = "text-gray-500 hover:text-emerald-600 dark:text-gray-400 dark:hover:text-emerald-300";
  const activeBaby  = "bg-white text-red-500 shadow-sm dark:bg-white/10 dark:text-red-300";
  const inactiveBaby= "text-gray-500 hover:text-red-500 dark:text-gray-400 dark:hover:text-red-300";
  const base = "min-w-0 basis-1/2 flex-1 cursor-pointer rounded-full px-3 py-1 text-center text-[9px] font-black uppercase tracking-wider transition-all duration-200 sm:basis-auto sm:flex-none sm:rounded-md sm:px-2.5 sm:py-0.5 ";

  const apply = () => {
    const isNew = _yearStatusMode === "NEW";
    btnNew.className  = base + (isNew ? activeNew : inactiveNew);
    btnBaby.className = base + (isNew ? inactiveBaby : activeBaby);
  };

  btnNew.addEventListener("click", () => {
    if (_yearStatusMode === "NEW") return;
    _yearStatusMode = "NEW";
    apply();
    _renderBeneficiariesByYear(_cachedBeneficiaries);
  });
  btnBaby.addEventListener("click", () => {
    if (_yearStatusMode === "SPES BABY") return;
    _yearStatusMode = "SPES BABY";
    apply();
    _renderBeneficiariesByYear(_cachedBeneficiaries);
  });
  apply();
}

// Chart 1 — Implementors by Office (horizontal bar)
function _renderImplementorsByOffice(staffs) {
  const el = document.getElementById("distribution-chart");
  if (!el) return;
  el.innerHTML = "";

  const counts = {};
  staffs.forEach(s => {
    let name = s.offices?.name ?? "Unknown";
    if (name.includes("CITY GOVERNMENT OF ILIGAN (LGU)")) {
      name = "LGU - ILIGAN";
    }
    counts[name] = (counts[name] ?? 0) + 1;
  });

  const sorted   = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const categories = sorted.map(([k]) => k);
  const values     = sorted.map(([, v]) => v);

  if (!values.length) return _showNoData(el, "No implementors found");

  _xStat.totalImpl = staffs.length;
  const maxVal = Math.max(...values);

  const _c1 = new ApexCharts(el, {
    series: [{ name: "Implementors", data: values }],
    chart: { type: "bar", height: 220, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
    plotOptions: {
      bar: { horizontal: true, borderRadius: 0, barHeight: "38%", distributed: true, dataLabels: { position: "top" } }
    },
    colors: BLUE_SHADES.slice(0, values.length),
    dataLabels: {
      enabled: true,
      formatter: fmt,
      offsetX: -24,
      style: { fontSize: "11px", fontWeight: 900, colors: ["#fff"] }
    },
    xaxis: {
      categories,
      labels: { 
        show: true,
        style: { fontSize: "9px", fontWeight: 800, colors: "#64748b" }
      },
      axisBorder: { show: true, color: "rgba(100, 116, 139, 0.15)" },
      axisTicks: { show: true, color: "rgba(100, 116, 139, 0.15)" }
    },
    yaxis: { labels: { style: { fontSize: "9px", fontWeight: 800, colors: "#64748b" } } },
    grid: { 
      show: true,
      borderColor: "rgba(100, 116, 139, 0.1)",
      strokeDashArray: 4,
      xaxis: { lines: { show: true } },
      yaxis: { lines: { show: false } }
    },
    legend: { show: false },
    tooltip: {
      theme: "dark",
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const title = w.globals.labels[dataPointIndex];
        const val   = series[seriesIndex][dataPointIndex];
        const color = w.config.colors[dataPointIndex] ?? BLUE_SHADES[0];
        return `
          <div class="${_tooltipClass()}">
            <div class="font-bold mb-1">${title}</div>
            <div class="flex items-center gap-1.5">
              <span class="inline-block w-2.5 h-2.5 rounded-full" style="background-color: ${color}"></span>
              <span>Implementors: <strong class="font-black">${val}</strong></span>
            </div>
          </div>`;
      }
    }
  });
  _c1.render();
  _xChart.distribution = _c1;

  // Roster Summary below the chart
  const summaryEl = document.getElementById("distribution-summary");
  summaryEl?.classList.add("hidden", "md:block");
  if (summaryEl && sorted.length > 0) {
    const officeCount = sorted.length;
    const pills = sorted.map(([name, count], i) =>
      `<span class="inline-flex items-center gap-1">
         <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" style="background:${BLUE_SHADES[i % BLUE_SHADES.length]};"></span>
         <span>${name}: <strong>${count}</strong></span>
       </span>`
    ).join('<span class="mx-1 text-gray-200 dark:text-white/10">·</span>');

    summaryEl.innerHTML = `
      <div class="flex flex-col gap-1.5 mt-3 pt-3 border-t border-gray-100 dark:border-white/5">
        <p class="text-[10px] font-semibold text-spes-black/75 dark:text-spes-white/75">
          Roster Summary:
          <span class="font-extrabold text-spes-blue dark:text-spes-yellow">${staffs.length} implementors</span>
          across <strong>${officeCount}</strong> office${officeCount !== 1 ? "s" : ""}.
        </p>
        <div class="flex flex-wrap items-center gap-x-1 gap-y-1 text-[10px] text-spes-black/60 dark:text-spes-white/50">
          ${pills}
        </div>
      </div>`;
  }
}

// Chart 2 — SPES Beneficiaries Gender Distribution (Male / Female)
function _renderImplementorStatus(beneficiaries, topOfficeBeneficiaries = [], globalStaffs = []) {
  const el = document.getElementById("spes-gender-chart");
  if (!el) return;
  _xChart.gender?.destroy();
  el.innerHTML = "";
  _renderTopOfficeSummary(topOfficeBeneficiaries, globalStaffs);

  let male   = 0;
  let female = 0;

  beneficiaries.forEach(b => {
    if (b.gender_id === 1) {
      male++;
    } else if (b.gender_id === 2) {
      female++;
    }
  });

  // Fallback removed, handled centrally in initDashboardCharts

  const labels = ["MALE", "FEMALE"];
  const series = [male, female];
  const total  = series.reduce((a, b) => a + b, 0);

  if (!total) {
    const studentBadge = document.getElementById("badge-student-metric");
    if (studentBadge) {
      studentBadge.innerHTML = `
          <span class="inline-flex items-center gap-1 rounded-full bg-[#4F91FF]/15 px-1.5 py-0.5 text-[8px] text-[#4F91FF] sm:px-2 sm:text-[9px]">
          <svg class="h-3 w-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 9V3h-6M14.5 9.5 21 3M10 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Male <span class="border-b-2 border-current pb-0.5 leading-none">0</span>
        </span>
        <span class="inline-flex items-center gap-1 rounded-full bg-[#FF5B9B]/15 px-1.5 py-0.5 text-[8px] text-[#FF5B9B] sm:px-2 sm:text-[9px]">
          <svg class="h-3 w-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 15V21M9 18h6M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
          Female <span class="border-b-2 border-current pb-0.5 leading-none">0</span>
        </span>`;
      studentBadge.className = "mt-3 flex w-fit max-w-full flex-nowrap items-center justify-start gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[8px] font-black uppercase leading-tight shadow-sm dark:bg-white/5 sm:mt-3 sm:justify-start sm:text-[9px]";
      studentBadge.title = "Male 0 | Female 0";
    }
    return _showNoData(el, "No beneficiaries found");
  }

  _xStat.totalBenef = beneficiaries.length;
  _xStat.male   = male;
  _xStat.female = female;

  // Show real counts in the header. This keeps the scope explicit: Admin sees
  // the full permitted roster while staff sees only its assigned-office roster.
  const studentBadge = document.getElementById("badge-student-metric");
  if (studentBadge) {
    studentBadge.innerHTML = `
      <span class="inline-flex items-center gap-1 rounded-full bg-[#4F91FF]/15 px-1.5 py-0.5 text-[8px] text-[#4F91FF] sm:px-2 sm:text-[9px]">
        <svg class="h-3 w-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M21 9V3h-6M14.5 9.5 21 3M10 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Male <span class="border-b-2 border-current pb-0.5 leading-none">${compactCount(male)}</span>
      </span>
      <span class="inline-flex items-center gap-1 rounded-full bg-[#FF5B9B]/15 px-1.5 py-0.5 text-[8px] text-[#FF5B9B] sm:px-2 sm:text-[9px]">
        <svg class="h-3 w-3" aria-hidden="true" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M12 15V21M9 18h6M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Female <span class="border-b-2 border-current pb-0.5 leading-none">${compactCount(female)}</span>
      </span>`;
    studentBadge.className = "mt-3 flex w-fit max-w-full flex-nowrap items-center justify-start gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-[8px] font-black uppercase leading-tight shadow-sm dark:bg-white/5 sm:mt-3 sm:justify-start sm:text-[9px]";
    studentBadge.title = `Male ${fmt(male)} | Female ${fmt(female)}`;
  }

  const chart = new ApexCharts(el, {
    series,
    chart: { type: "donut", height: 250, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
    labels,
    colors: ["#4F91FF", "#FF5B9B"], // Male Blue, Female Pink
    legend: { position: "bottom", fontWeight: 800, fontSize: "11px" },
    stroke: { show: false },
    dataLabels: { enabled: false },
    tooltip: { enabled: false },
    plotOptions: {
      pie: {
        startAngle: 225,
        endAngle: 585,
        donut: {
          size: "75%",
          labels: {
            show: true,
            name:  { show: true, fontSize: "10px", fontWeight: 700, offsetY: -5, color: "#64748b" },
            value: { show: true, fontSize: "18px", fontWeight: 900, offsetY: 5, formatter: fmt },
            total: {
              show: true,
              label: "TOTAL SPES",
              fontSize: "9px",
              fontWeight: 900,
              color: BRAND_BLUE,
              formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
            }
          }
        }
      }
    }
  });

  _xChart.gender = chart;
  chart.render().then(() => {
    _drawGenderConnectorLines(el, series, total);
  });

  if (!el.dataset.resizeListenerAttached) {
    el.dataset.resizeListenerAttached = "true";
    window.addEventListener("resize", () => {
      setTimeout(() => {
        _drawGenderConnectorLines(el, series, total);
      }, 150);
    });
  }

}

function _renderTopOfficeSummary(topOfficeBeneficiaries, globalStaffs) {
  const summaryEl = document.getElementById("gender-roster-summary");
  if (summaryEl) {
    const officeStats = {};
    topOfficeBeneficiaries.forEach(b => {
      if (b.staff_id) {
        const staff = globalStaffs.find(s => String(s.id) === String(b.staff_id));
        const officeName = staff?.offices?.name || "Unknown Office";
        if (!officeStats[officeName]) officeStats[officeName] = { male: 0, female: 0, total: 0 };
        if (b.gender_id === 1) officeStats[officeName].male++;
        else if (b.gender_id === 2) officeStats[officeName].female++;
        officeStats[officeName].total =
          officeStats[officeName].male + officeStats[officeName].female;
      }
    });

    const sortedOffices = Object.entries(officeStats)
      .sort((a, b) =>
        b[1].total - a[1].total ||
        b[1].female - a[1].female ||
        b[1].male - a[1].male ||
        a[0].localeCompare(b[0])
      )
      .slice(0, 3); // top 3
    const globalGenderTotal = Object.values(officeStats)
      .reduce((sum, stats) => sum + stats.total, 0);

    if (sortedOffices.length > 0) {
      summaryEl.innerHTML = `
        <h4 class="text-[10px] font-black uppercase tracking-widest text-spes-black/50 dark:text-white/40 mb-2">Global Top 3 Offices (Male + Female)</h4>
        <div class="flex flex-col gap-2">
          ${sortedOffices.map(([name, stats]) => {
            const percentage = globalGenderTotal > 0
              ? ((stats.total / globalGenderTotal) * 100).toFixed(1)
              : "0.0";
            return `
              <div class="flex items-center justify-between">
                <span class="text-[10px] font-bold text-spes-black/70 dark:text-white/60 truncate max-w-[150px]" title="${esc(name)}">${esc(name)}</span>
                <div class="flex items-center gap-2 text-[10px] font-black">
                  <span class="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:bg-emerald-400/10 dark:text-emerald-400 dark:ring-emerald-400/20">${percentage}%</span>
                  <span class="text-[#4F91FF]">${stats.male} M</span>
                  <span class="text-gray-300 dark:text-white/10">|</span>
                  <span class="text-[#FF5B9B]">${stats.female} F</span>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      `;
      summaryEl.classList.remove("hidden");
    } else {
      summaryEl.innerHTML = "";
      summaryEl.classList.add("hidden");
    }
  }
}

function _drawGenderConnectorLines(el, series, total) {
  const pieGroup = el.querySelector(".apexcharts-pie");
  if (!pieGroup) return;

  const rect = pieGroup.getBoundingClientRect();
  const containerRect = el.getBoundingClientRect();
  const containerWidth = Math.max(el.clientWidth, containerRect.width);
  const containerHeight = Math.max(el.clientHeight, containerRect.height);
  const centerX = (rect.left - containerRect.left) + rect.width / 2;
  const centerY = (rect.top - containerRect.top) + rect.height / 2;
  const radius = Math.min(rect.width, rect.height) / 2;

  el.querySelector(".custom-chart-overlay")?.remove();

  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  overlay.setAttribute("class", "custom-chart-overlay absolute inset-0 pointer-events-none h-full w-full z-20 overflow-visible");
  overlay.setAttribute("viewBox", `0 0 ${containerWidth} ${containerHeight}`);
  overlay.setAttribute("preserveAspectRatio", "none");
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";

  const startAngleDegrees = 225;
  let currentAngle = -Math.PI / 2 + (startAngleDegrees * Math.PI) / 180;
  series.forEach((val, idx) => {
    if (val === 0) return;
    const angleSpan = (val / total) * 2 * Math.PI;
    const midAngle = currentAngle + angleSpan / 2;
    currentAngle += angleSpan;

    const cos = Math.cos(midAngle);
    const sin = Math.sin(midAngle);
    const startX = centerX + cos * radius;
    const startY = centerY + sin * radius;
    const verticalOffset = idx === 0 ? -12 : 0;
    const endX = centerX + cos * (radius + 28);
    const endY = centerY + sin * (radius + 28) + verticalOffset;
    const isRightSide = cos > 0 || (Math.abs(cos) < 1e-5 && sin < 0);
    const estimatedLabelWidth = 64;
    const horizontalPadding = 8;
    let elbowY = Math.min(containerHeight - 22, Math.max(14, endY));
    let textX;
    let elbowX;

    if (isRightSide) {
      textX = Math.min(containerWidth - estimatedLabelWidth - horizontalPadding, endX + 30);
      textX = Math.max(centerX + 8, textX);
      elbowX = textX - 5;
    } else {
      textX = Math.max(estimatedLabelWidth + horizontalPadding, endX - 30);
      textX = Math.min(centerX - 8, textX);
      elbowX = textX + 5;
    }

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${startX} ${startY} L ${endX} ${endY} L ${elbowX} ${elbowY}`);
    path.setAttribute("stroke", "#94a3b8");
    path.setAttribute("stroke-width", "1");
    path.setAttribute("fill", "none");
    overlay.appendChild(path);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", textX);
    text.setAttribute("y", elbowY + 4);
    text.setAttribute("text-anchor", isRightSide ? "start" : "end");
    text.setAttribute("fill", idx === 0 ? "#4F91FF" : "#FF5B9B");
    text.style.fontFamily = "Inter, sans-serif";
    text.style.fontSize = "10px";
    text.style.fontWeight = "bold";
    text.style.paintOrder = "stroke";
    text.style.stroke = document.documentElement.classList.contains("dark") ? "#111827" : "#ffffff";
    text.style.strokeWidth = "3px";
    text.style.strokeLinejoin = "round";
    text.textContent = `${val} (${Math.round((val / total) * 100)}%)`;
    overlay.appendChild(text);
  });

  el.style.position = "relative";
  el.appendChild(overlay);
}
// Chart 3 — Added SPES per Year (colored column per year + trend line)
function _renderBeneficiariesByYear(beneficiaries) {
  const el = document.getElementById("column-chart");
  if (!el) return;
  _xChart.column?.destroy();
  el.innerHTML = "";

  const defaultYears = ["2024", "2025", "2026", "2027"];
  const detectedYears = beneficiaries.map((beneficiary) => String(beneficiary.year_period ?? "").trim()).filter((year) => /^\d{4}$/.test(year));
  // Keep zero-value year points so the trend remains visible around the active year.
  const targetYears = [...new Set([...defaultYears, ...detectedYears])].sort((a, b) => Number(a) - Number(b));
  const yearColors = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6"];
  const countsByYear = {};
  targetYears.forEach(yr => { countsByYear[yr] = 0; });

  // Only count rows matching the active status mode (NEW default, or SPES BABY)
  beneficiaries.forEach(b => {
    const yr = String(b.year_period ?? "");
    if (!targetYears.includes(yr)) return;
    if (String(b.return_status || "NEW").toUpperCase() !== _yearStatusMode) return;
    countsByYear[yr]++;
  });

  _xStat.yearData = { ...countsByYear };

  const totalData = targetYears.map(yr => countsByYear[yr]);
  const peak      = Math.max(...totalData);
  const modeTotal = totalData.reduce((a, b) => a + b, 0);

  // ── % of capacity badge ───────────────────────────────────────
  const percentageEl = document.getElementById("added-students-percentage");
  if (percentageEl) {
    const TARGET_CAPACITY = 200;
    const pct = Math.min(100, Math.round((beneficiaries.length / TARGET_CAPACITY) * 100));
    percentageEl.innerHTML = `
      <span class="flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black uppercase ${pct > 0 ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-500/10 text-gray-500'}" title="Based on target capacity of ${TARGET_CAPACITY}">
        <svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="${pct >= 100 ? 'M5 13l4 4L19 7' : 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6'}" />
        </svg>
        ${pct}% OF MAX
      </span>`;
  }

  // ── Summary ───────────────────────────────────────────────────
  const summaryEl = document.getElementById("chart-progress-summary");
  if (summaryEl) {
    const pills = targetYears.map((yr, i) =>
      `<span class="year-legend-item cursor-pointer inline-flex items-center gap-1 hover:text-spes-blue dark:hover:text-spes-yellow transition-colors duration-150">
         <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${yearColors[i]}"></span>
         ${yr}: <strong>${countsByYear[yr]}</strong>
       </span>`
    ).join('<span class="text-gray-300 dark:text-white/10">|</span>');

    const modeLabel = _yearStatusMode === "SPES BABY" ? "SPES Baby" : "New";
    summaryEl.innerHTML = `
      <div class="flex flex-col gap-1.5 mt-4 border-t border-gray-100 pt-3 dark:border-white/5">
        <p class="text-[10px] font-semibold text-spes-black/75 dark:text-spes-white/75">
          Roster Summary: <span class="font-extrabold text-spes-blue dark:text-spes-yellow">${modeTotal} ${modeLabel} students</span> across all years.
        </p>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-spes-black/60 dark:text-spes-white/50">
          ${pills}
        </div>
      </div>`;
  }

  // ── Chart ─────────────────────────────────────────────────────
  const isDark = document.documentElement.classList.contains("dark");
  const trendColor = isDark ? "#ffffff" : "#F87171";

  const chart = new ApexCharts(el, {
    series: [
      {
        name: "Added SPES",
        type: "column",
        data: targetYears.map((yr, i) => ({ x: yr, y: countsByYear[yr], fillColor: yearColors[i] }))
      },
      {
        name: "Trend",
        type: "line",
        data: targetYears.map(yr => ({ x: yr, y: countsByYear[yr] }))
      }
    ],
    chart: { type: "line", height: 180, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
    stroke: { width: [0, 3], curve: "smooth" },
    colors: ["#3B82F6", trendColor],
    plotOptions: {
      bar: {
        columnWidth: "32%",
        borderRadius: 4,
        borderRadiusApplication: "end",
        dataLabels: { position: "top" }
      }
    },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0],
      formatter: fmt,
      offsetY: -18,
      style: { fontSize: "10px", fontWeight: 800, colors: ["#64748b"] }
    },
    markers: {
      size: [0, 4],
      colors: [null, trendColor],
      strokeColors: "#fff",
      strokeWidth: 2,
      hover: { size: 6 }
    },
    xaxis: {
      categories: targetYears,
      labels: { style: { fontSize: "9px", fontWeight: 700, colors: "#64748b" } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      show: true,
      min: 0,
      labels: {
        style: { fontSize: "9px", fontWeight: 800, colors: "#64748b" },
        formatter: (v) => Math.round(v)
      },
      tickAmount: peak > 0 ? Math.min(4, peak) : 4,
      max: peak > 0 ? peak + Math.ceil(peak * 0.2) : 5
    },
    grid: {
      show: true,
      borderColor: "rgba(100, 116, 139, 0.1)",
      strokeDashArray: 4,
      padding: { left: 2, right: 2, top: 10 },
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } }
    },
    legend: { show: false },
    tooltip: {
      theme: "dark",
      shared: true,
      intersect: false,
      custom: function({ series, dataPointIndex, w }) {
        const year  = w.globals.labels[dataPointIndex];
        const val   = series[0][dataPointIndex];
        const color = yearColors[dataPointIndex] ?? "#3B82F6";
        return `
          <div class="${_tooltipClass()}">
            <div class="font-bold mb-1">${year}</div>
            <div class="flex items-center gap-1.5">
              <span class="inline-block w-2.5 h-2.5 rounded-full" style="background-color:${color}"></span>
              <span>Added SPES: <strong class="font-black">${val}</strong></span>
            </div>
          </div>`;
      }
    }
  });

  _xChart.column = chart;
  chart.render().then(() => {
    window.addEventListener("theme-changed", () => {
      const currentDark = document.documentElement.classList.contains("dark");
      const newTrend = currentDark ? "#ffffff" : "#F87171";
      chart.updateOptions({ colors: ["#3B82F6", newTrend] });
    });

    if (summaryEl) {
      const spans = summaryEl.querySelectorAll(".year-legend-item");
      spans.forEach((span, idx) => {
        span.addEventListener("mouseenter", () => {
          el.querySelectorAll("path.apexcharts-bar-area").forEach((p, pi) => {
            p.style.opacity = pi === idx ? "1" : "0.3";
          });
        });
        span.addEventListener("mouseleave", () => {
          el.querySelectorAll("path.apexcharts-bar-area").forEach(p => { p.style.opacity = "1"; });
        });
      });
    }
  });
}

// Chart 4 — Enrollment by Month (area)
function _renderEnrollmentByMonth(beneficiaries) {
  const el = document.getElementById("mini-trends");
  if (!el) return;
  _xChart.trends?.destroy();
  el.innerHTML = "";

  const monthLabels = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  const monthly     = new Array(12).fill(0);

  const monthMap = {
    "JANUARY": 0, "FEBRUARY": 1, "MARCH": 2, "APRIL": 3,
    "MAY": 4, "JUNE": 5, "JULY": 6, "AUGUST": 7,
    "SEPTEMBER": 8, "OCTOBER": 9, "NOVEMBER": 10, "DECEMBER": 11
  };

  beneficiaries.forEach(b => {
    const mStr = String(b.month_period || "").toUpperCase();
    if (monthMap[mStr] !== undefined) {
      monthly[monthMap[mStr]]++;
    }
  });

  const hasData = monthly.some(v => v > 0);
  if (!hasData) return _showNoData(el, "No enrollment data");

  const _c4 = new ApexCharts(el, {
    series: [{ name: "Enrollment", data: monthly }],
    chart: { type: "area", height: 185, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
    colors: [BRAND_BLUE],
    stroke: { curve: "smooth", width: 3 },
    fill: { type: "gradient", gradient: { opacityFrom: 0.4, opacityTo: 0 } },
    xaxis: {
      categories: monthLabels,
      labels: { style: { fontSize: "9px", fontWeight: 700 } }
    },
    yaxis: { 
      show: true,
      labels: { 
        style: { fontSize: "9px", fontWeight: 800, colors: "#64748b" },
        formatter: (v) => Math.round(v)
      },
      tickAmount: Math.max(...monthly) > 0 ? Math.min(4, Math.max(...monthly)) : 1
    },
    grid: { 
      show: true, 
      borderColor: "rgba(100, 116, 139, 0.1)", 
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } }
    },
    dataLabels: { enabled: false },
    tooltip: {
      theme: "dark",
      custom: function({ series, seriesIndex, dataPointIndex, w }) {
        const title = w.globals.labels[dataPointIndex];
        const val = series[seriesIndex][dataPointIndex];
        return `
          <div class="${_tooltipClass()}">
            <div class="font-bold mb-1">${title}</div>
            <div class="flex items-center gap-1.5">
              <span class="inline-block w-2.5 h-2.5 rounded-full bg-[#0038A8]"></span>
              <span>Enrollment: <strong class="font-black">${val} students</strong></span>
            </div>
          </div>
        `;
      }
    }
  });
  _c4.render();
  _xChart.trends = _c4;
}

// Chart 5 — Education Levels (column + trend line, mirrors Chart 3 pattern)
function _renderEducationLevels(beneficiaries) {
  const el = document.getElementById("education-chart");
  if (!el) return;
  el.innerHTML = "";

  let basic = 0;
  let senior = 0;
  let level = 0;
  let grad = 0;

  beneficiaries.forEach(b => {
    const eduId = b.educ_id;
    if (eduId === 1) {
      senior++;
    } else if (eduId === 2) {
      grad++;
    } else if (eduId === 3) {
      level++;
    } else if (eduId === 4) {
      basic++;
    } else {
      basic++;
    }
  });

  // Default values to let user see how it displays if no data
  if (grad === 0 && level === 0 && senior === 0 && basic === 0) {
    basic = 12;
    senior = 25;
    level = 8;
    grad = 15;
  }

  const categories = ["High School", "Senior High", "College Level", "College Grad"];
  const eduColors  = ["#8B5CF6", "#A78BFA", "#6D28D9", "#C4B5FD"];
  const data       = [basic, senior, level, grad];
  const peak       = Math.max(...data);

  const isDark = document.documentElement.classList.contains("dark");
  const lineColor = isDark ? "#ffffff" : "#F87171";

  const _c5 = new ApexCharts(el, {
    series: [
      {
        name: "Total SPES",
        type: "column",
        data: data.map((y, i) => ({ x: categories[i], y, fillColor: eduColors[i] }))
      },
      {
        name: "Trend",
        type: "line",
        data: data.map((y, i) => ({ x: categories[i], y }))
      }
    ],
    chart: {
      type: "line",
      height: 185,
      toolbar: { show: false },
      fontFamily: "Inter, sans-serif",
      sparkline: { enabled: false }
    },
    stroke: { width: [0, 3], curve: "smooth" },
    colors: ["#8B5CF6", lineColor],
    plotOptions: {
      bar: {
        horizontal: false,
        columnWidth: "42%",
        borderRadius: 4,
        borderRadiusApplication: "end",
        dataLabels: { position: "top" }
      }
    },
    dataLabels: {
      enabled: true,
      enabledOnSeries: [0],
      formatter: fmt,
      offsetY: -18,
      style: { fontSize: "10px", fontWeight: 800, colors: ["#64748b"] }
    },
    xaxis: {
      categories,
      labels: { style: { fontSize: "9px", fontWeight: 700, colors: "#64748b" } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      show: true,
      min: 0,
      labels: {
        style: { fontSize: "9px", fontWeight: 700, colors: "#64748b" },
        formatter: (v) => Math.round(v)
      },
      tickAmount: peak > 0 ? Math.min(4, peak) : 4,
      max: peak > 0 ? peak + Math.ceil(peak * 0.2) : 5
    },
    grid: {
      show: true,
      borderColor: "rgba(100, 116, 139, 0.1)",
      strokeDashArray: 4,
      yaxis: { lines: { show: true } },
      xaxis: { lines: { show: false } }
    },
    legend: { show: false },
    fill: { opacity: 1 },
    tooltip: {
      theme: "dark",
      shared: true,
      intersect: false,
      custom: function({ series, dataPointIndex, w }) {
        const title = w.globals.labels[dataPointIndex];
        const val   = series[0][dataPointIndex];
        const color = eduColors[dataPointIndex] ?? "#8B5CF6";
        return `
          <div class="${_tooltipClass()}">
            <div class="font-bold mb-1">${title}</div>
            <div class="flex items-center gap-1.5">
              <span class="inline-block w-2.5 h-2.5 rounded-full" style="background-color:${color}"></span>
              <span>Total SPES: <strong class="font-black">${val} students</strong></span>
            </div>
          </div>
        `;
      }
    }
  });

  _xChart.education = _c5;
  return _c5.render().then(() => {
    window.addEventListener("theme-changed", () => {
      const currentDark = document.documentElement.classList.contains("dark");
      _c5.updateOptions({ colors: ["#8B5CF6", currentDark ? "#ffffff" : "#F87171"] });
    });
  });
}

// Wire up the switcher toggle behavior
function _setupTrendsSwitcher() {
  const btnTimeline = document.getElementById("btn-toggle-timeline");
  const btnEducation = document.getElementById("btn-toggle-education");
  const containerTimeline = document.getElementById("mini-trends");
  const containerEducation = document.getElementById("education-chart");
  const titleEl = document.getElementById("trends-title");

  if (!btnTimeline || !btnEducation || !containerTimeline || !containerEducation) return;

  const activeClass = "bg-white text-spes-blue shadow-sm dark:bg-white/10 dark:text-spes-yellow";
  const inactiveClass = "text-gray-500 hover:text-spes-blue dark:text-gray-400 dark:hover:text-spes-yellow";

  btnTimeline.addEventListener("click", () => {
    containerTimeline.classList.remove("hidden");
    containerEducation.classList.add("hidden");
    
    // Toggle active state classes
    btnTimeline.className = `cursor-pointer rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${activeClass}`;
    btnEducation.className = `cursor-pointer rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${inactiveClass}`;
    
    if (titleEl) titleEl.textContent = "Enrollment Timeline";
  });

  btnEducation.addEventListener("click", () => {
    containerTimeline.classList.add("hidden");
    containerEducation.classList.remove("hidden");
    
    // Toggle active state classes
    btnTimeline.className = `cursor-pointer rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${inactiveClass}`;
    btnEducation.className = `cursor-pointer rounded-md px-2 py-0.5 text-[9px] font-black uppercase tracking-wider transition-all duration-200 ${activeClass}`;
    
    if (titleEl) titleEl.textContent = "Education Levels";

    // Render the chart now that the container is visible (avoids 0-dimension height bug)
    _renderEducationLevels(_cachedBeneficiaries);
  });
}

// ══════════════════════════════════════════════════════════════
// DASHBOARD STATS EXPORT
// Captures all rendered ApexCharts via dataURI(), assembles a
// professional print page in a new window, and auto-prints it.
// ══════════════════════════════════════════════════════════════

async function _chartPng(key) {
  const inst = _xChart[key];
  if (!inst) return null;
  const isDark = document.documentElement.classList.contains("dark");
  try {
    const originalAnimations = inst.w.config.chart.animations?.enabled ?? true;

    // Temporarily disable animations for instant rendering, and override to light mode colors if in dark mode
    await inst.updateOptions({
      chart: { 
        background: isDark ? "#ffffff" : "transparent", 
        foreColor: isDark ? "#374151" : undefined,
        animations: { enabled: false } 
      },
      ...(isDark ? {
        xaxis:  { labels: { style: { colors: "#374151" } } },
        yaxis:  { labels: { style: { colors: "#374151" } } },
        grid:   { borderColor: "rgba(0,0,0,0.08)" },
      } : {})
    }, true, false);

    const { imgURI } = await inst.dataURI();

    // Restore original styles and animation settings
    await inst.updateOptions({
      chart: { 
        background: isDark ? "transparent" : "transparent", 
        foreColor: isDark ? "#ffffff" : undefined,
        animations: { enabled: originalAnimations } 
      },
      ...(isDark ? {
        xaxis:  { labels: { style: { colors: "#64748b" } } },
        yaxis:  { labels: { style: { colors: "#64748b" } } },
        grid:   { borderColor: "rgba(100,116,139,0.1)" },
      } : {})
    }, true, false);

    return imgURI ?? null;
  } catch { return null; }
}

function _chartPlaceholder(label) {
  return `<div style="height:190px;display:flex;flex-direction:column;align-items:center;
    justify-content:center;background:#F8FAFC;border:1.5px dashed #E2E8F0;gap:8px;">
    <svg width="28" height="28" fill="none" viewBox="0 0 24 24" stroke="#CBD5E1" stroke-width="1.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"/>
    </svg>
    <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#94A3B8;">${label} — Not Yet Loaded</span>
    <span style="font-size:8px;color:#CBD5E1;">Open the dashboard chart first</span>
  </div>`;
}

function _chartImg(src, label) {
  if (!src) return _chartPlaceholder(label).replace("height:190px", "height:220px");
  return `<img src="${src}" alt="${label}" style="width:100%;height:220px;object-fit:contain;display:block;background:#ffffff;">`;
}

export async function exportDashboardStats() {
  // ── Guard: only works on the dashboard page ───────────────────
  const printArea = document.getElementById("dashboard-print-area");
  if (!printArea) return;

  const containerEducation = document.getElementById("education-chart");
  const wasHidden = containerEducation?.classList.contains("hidden");

  // Force render of education levels in background if not yet loaded
  if (!_xChart.education && containerEducation) {
    if (wasHidden) containerEducation.classList.remove("hidden");
    await _renderEducationLevels(_cachedBeneficiaries);
  }

  const containerTrends = document.getElementById("mini-trends");
  const wasHiddenTrends = containerTrends?.classList.contains("hidden");

  // Force render of enrollment trends in background if not yet loaded
  if (!_xChart.trends && containerTrends) {
    if (wasHiddenTrends) containerTrends.classList.remove("hidden");
    await _renderEnrollmentByMonth(_cachedBeneficiaries);
  }

  // Dim the buttons while async chart capture runs
  const _btnIds = ["quick-export","quick-export-expanded","quick-export-expanded-mob","quick-export-mob"];
  const _btns   = _btnIds.map(id => document.getElementById(id)).filter(Boolean);
  _btns.forEach(b => { b.style.opacity = "0.4"; b.style.pointerEvents = "none"; });

  try {
    // ── Capture all chart images in parallel ──────────────────────
    const [imgDist, imgGender, imgCol, imgTrends, imgEdu] = await Promise.all([
      _chartPng("distribution"),
      _chartPng("gender"),
      _chartPng("column"),
      _chartPng("trends"),
      _chartPng("education"),
    ]);

    // ── Stats ────────────────────────────────────────────────────
    const total     = _xStat.male + _xStat.female || 1;
    const malePct   = Math.round((_xStat.male   / total) * 100);
    const femalePct = 100 - malePct;
    const curYear   = String(new Date().getFullYear());
    const ytd       = _xStat.yearData[curYear] ?? 0;
    const appVer    = import.meta.env?.VITE_APP_VERSION ?? "0.2.0";

    // Logo resolves correctly in development and production bundling
    const logo = new URL("../../../assets/img/logos/c_spes.png", import.meta.url).href;

  // ── Date / time ───────────────────────────────────────────────
  const now     = new Date();
  const dateStr = now.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  // ── Compact helpers ───────────────────────────────────────────
  // Stat card — gray bg, large readable number, SVG icon
  const _sc = (clr, icon, lbl, val, sub) =>
    `<div style="padding:12px 14px;border-left:4px solid ${clr};background:#E8EAED;box-sizing:border-box;">
       <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:5px;">
         <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#374151;">${lbl}</div>
         <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="${clr}" stroke-width="2" style="flex-shrink:0;opacity:.7;">${icon}</svg>
       </div>
       <div style="font-size:28px;font-weight:900;color:${clr};line-height:1;letter-spacing:-.02em;">${val}</div>
       <div style="font-size:9px;font-weight:600;color:#6B7280;margin-top:3px;">${sub}</div>
     </div>`;

  // Year pill
  const _yp = (yr, count, clr) =>
    `<div style="display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
       background:${clr}18;border:1px solid ${clr}35;">
       <span style="width:6px;height:6px;border-radius:50%;background:${clr};flex-shrink:0;"></span>
       <span style="font-size:8px;font-weight:700;color:#374151;">${yr}:</span>
       <span style="font-size:10px;font-weight:900;color:${clr};">${count}</span>
     </div>`;

  // Chart card
  const _cc = (clr, title, imgSrc, imgLbl) =>
    `<div style="border:1px solid #D4D6DA;border-top:3px solid ${clr};overflow:hidden;box-sizing:border-box;">
       <div style="padding:5px 9px;background:#F1F3F5;border-bottom:1px solid #D4D6DA;
         display:flex;align-items:center;gap:5px;">
         <div style="width:6px;height:6px;border-radius:50%;background:${clr};flex-shrink:0;"></div>
         <span style="font-size:7.5px;font-weight:900;text-transform:uppercase;letter-spacing:.13em;color:#374151;">${title}</span>
       </div>
       <div style="background:#ffffff;">${_chartImg(imgSrc, imgLbl)}</div>
     </div>`;

  // Section heading
  const _sh = (label) =>
    `<div style="font-size:8.5px;font-weight:900;text-transform:uppercase;letter-spacing:.18em;
       color:#0038A8;margin-bottom:8px;display:flex;align-items:center;gap:7px;">
       <div style="width:13px;height:2px;background:#0038A8;flex-shrink:0;"></div>
       ${label}
       <div style="flex:1;height:1px;background:#D4D6DA;"></div>
     </div>`;

  // ── Inject into #dashboard-print-area ────────────────────────
  printArea.innerHTML = `
  <div style="font-family:Inter,Arial,sans-serif;background:#fff;width:100%;box-sizing:border-box;">

    <!-- Watermark -->
    <div style="position:fixed;inset:0;z-index:0;display:flex;align-items:center;justify-content:center;
      pointer-events:none;overflow:hidden;opacity:0.03;filter:grayscale(1) blur(1.5px);">
      <img src="${logo}" style="width:50%;height:auto;object-fit:contain;" alt="">
    </div>

    <!-- Header -->
    <div style="position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;
      border-bottom:2.5px solid #0038A8;padding-bottom:8px;margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:11px;">
        <img src="${logo}" style="height:58px;width:58px;border-radius:50%;object-fit:contain;
          border:2px solid rgba(0,56,168,.15);flex-shrink:0;" alt="DOLE Logo">
        <div>
          <div style="font-size:16px;font-weight:900;color:#0038A8;text-transform:uppercase;
            letter-spacing:-.02em;line-height:1.1;margin-bottom:2px;">Department of Labor and Employment</div>
          <div style="font-size:8px;font-weight:700;color:#6B7280;text-transform:uppercase;
            letter-spacing:.16em;margin-bottom:1px;">Lanao del Norte Provincial Field Office</div>
          <div style="font-size:7.5px;color:#9CA3AF;font-weight:500;">
            OREDC Building, Badelles St. Extension, Barangay Ubaldo Laya, Iligan City</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:11px;">
        <div style="text-align:right;padding-top:2px;">
          <div style="font-size:12px;font-weight:900;color:#CE1126;text-transform:uppercase;
            letter-spacing:-.01em;margin-bottom:4px;">SPES Dashboard Statistics</div>
          <div style="display:inline-block;background:#F1F3F5;border-radius:9999px;
            padding:2px 10px;font-size:8px;font-weight:600;color:#6B7280;">
            Generated: <strong style="color:#374151;">${dateStr} ${timeStr}</strong>
          </div>
          <div style="margin-top:3px;font-size:7.5px;font-weight:700;text-transform:uppercase;
            letter-spacing:.1em;color:#9CA3AF;">System V${appVer}</div>
        </div>
        <img src="${logo}" style="height:58px;width:58px;border-radius:50%;object-fit:contain;
          border:2px solid rgba(206,17,38,.15);flex-shrink:0;" alt="SPES Logo">
      </div>
    </div>

    <!-- Summary Stats heading -->
    <div style="position:relative;z-index:1;">${_sh("Summary Statistics")}</div>

    <!-- Stat cards — large readable text on neutral gray bg -->
    <div style="position:relative;z-index:1;display:grid;grid-template-columns:repeat(5,1fr);
      gap:7px;margin-bottom:8px;">
      ${_sc("#0038A8",
        `<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/>`,
        "Total Implementors", _xStat.totalImpl.toLocaleString(), "Active staff members")}
      ${_sc("#6366F1",
        `<path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>`,
        "Total SPES", _xStat.totalBenef.toLocaleString(), "Registered beneficiaries")}
      ${_sc("#4F91FF",
        `<path stroke-linecap="round" stroke-linejoin="round" d="M21 9V3h-6M14.5 9.5 21 3M10 21a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"/>`,
        "Male Beneficiaries", _xStat.male.toLocaleString(), `${malePct}% of total SPES`)}
      ${_sc("#FF5B9B",
        `<path stroke-linecap="round" stroke-linejoin="round" d="M12 15V21M9 18h6M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"/>`,
        "Female Beneficiaries", _xStat.female.toLocaleString(), `${femalePct}% of total SPES`)}
      ${_sc("#10B981",
        `<path stroke-linecap="round" stroke-linejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/>`,
        `Added in ${curYear}`, ytd.toLocaleString(), "SPES enrolled YTD")}
    </div>

    <!-- Year breakdown pills — compact single row -->
    <div style="position:relative;z-index:1;display:flex;align-items:center;gap:6px;
      flex-wrap:wrap;margin-bottom:9px;">
      <span style="font-size:7.5px;font-weight:700;text-transform:uppercase;
        letter-spacing:.1em;color:#9CA3AF;flex-shrink:0;">Yearly:</span>
      ${_yp("2024", (_xStat.yearData["2024"] ?? 0).toLocaleString(), "#3B82F6")}
      ${_yp("2025", (_xStat.yearData["2025"] ?? 0).toLocaleString(), "#10B981")}
      ${_yp("2026", (_xStat.yearData["2026"] ?? 0).toLocaleString(), "#F59E0B")}
      ${_yp("2027", (_xStat.yearData["2027"] ?? 0).toLocaleString(), "#8B5CF6")}
    </div>

    <!-- Divider -->
    <div style="position:relative;z-index:1;border-top:1.5px solid #D4D6DA;margin:2px 0 9px;"></div>

    <!-- Charts heading -->
    <div style="position:relative;z-index:1;">${_sh("Dashboard Charts &amp; Analytics")}</div>

    <!-- Row 1: 3 charts (wider left for bar chart) -->
    <div style="position:relative;z-index:1;display:grid;grid-template-columns:2fr 1.3fr 1.7fr;
      gap:8px;margin-bottom:8px;">
      ${_cc("#0038A8", "Implementors by Office",     imgDist,   "Implementors by Office")}
      ${_cc("#4F91FF", "Gender Distribution (SPES)", imgGender, "Gender Distribution")}
      ${_cc("#10B981", "SPES Added per Year",         imgCol,    "SPES per Year")}
    </div>

    <!-- Row 2: 2 charts -->
    <div style="position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;
      gap:8px;margin-bottom:9px;">
      ${_cc("#3B82F6", "Enrollment by Month",          imgTrends, "Enrollment by Month")}
      ${_cc("#8B5CF6", "Education Level Distribution", imgEdu,    "Education Levels")}
    </div>

    <!-- Footer -->
    <div style="position:relative;z-index:1;border-top:1px solid #E5E7EB;padding-top:5px;
      text-align:center;">
      <p style="font-size:7px;color:#9CA3AF;font-weight:700;text-transform:uppercase;letter-spacing:.1em;">
        &copy; ${now.getFullYear()} System V${appVer}
        <span style="opacity:.5;"> Developed by </span>
        <span style="color:#0038A8;font-weight:900;">Mark Jordan Ugtong</span>
        <span style="margin:0 6px;color:#E5E7EB;">|</span>
        Exclusive Property of DOLE Iligan City
      </p>
    </div>

  </div>`;

  // ── Dynamic @page size ────────────────────────────────────────
  let _pStyle = document.getElementById("dashboard-print-page-style");
  if (!_pStyle) {
    _pStyle = document.createElement("style");
    _pStyle.id = "dashboard-print-page-style";
    document.head.appendChild(_pStyle);
  }
  _pStyle.textContent = `@media print { @page { size: landscape; margin: 8mm 10mm; } }`;

  // Clean up print area after the dialog closes
  window.addEventListener("afterprint", () => { printArea.innerHTML = ""; }, { once: true });

  // Give the browser 150ms to decode and paint the base64 chart images in the DOM before printing
  await new Promise(resolve => setTimeout(resolve, 150));
  window.print();

  } finally {
    if (wasHidden && containerEducation) {
      containerEducation.classList.add("hidden");
    }
    if (wasHiddenTrends && containerTrends) {
      containerTrends.classList.add("hidden");
    }
    _btns.forEach(b => { b.style.opacity = ""; b.style.pointerEvents = ""; });
  }
}
