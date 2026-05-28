import ApexCharts from "apexcharts";

/**
 * SPES Portal — Charts Component (DOLE Command Center Edition)
 * ─────────────────────────────────────────────────────────────
 */

export function initDashboardCharts() {
  const brandColor = "#0038A8"; // spes-blue
  const brandSecondaryColor = "#FCD116"; // spes-yellow
  
  // Custom Gender Colors
  const maleColor = "#4F91FF"; // Professional Blue-ish
  const femaleColor = "#FF5B9B"; // Premium Red-Pink
  const officeColor = "#4F46E5"; // Deep Indigo for Offices

  const fmt = (val) => Number(val).toLocaleString();

  // 1. Total Implementors by Office (Horizontal Bar)
  const distributionEl = document.getElementById("distribution-chart");
  if (distributionEl) {
    distributionEl.innerHTML = "";
    new ApexCharts(distributionEl, {
      series: [{
        name: 'Implementors',
        data: [45, 32, 28, 20, 15]
      }],
      chart: { type: 'bar', height: 220, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 4,
          barHeight: '60%',
          distributed: true,
          dataLabels: { position: 'top' } // Forces it to the end of the bar
        }
      },
      colors: [brandColor, "#2563EB", "#3B82F6", "#60A5FA", "#93C5FD"],
      dataLabels: {
        enabled: true,
        formatter: (val) => fmt(val),
        offsetX: -15, // Adds a gap from the right edge
        style: { fontSize: '11px', fontWeight: 900, colors: ["#fff"] }
      },
      xaxis: {
        categories: ['DOLE REGION X', 'DOLE NCR', 'LGU CDO', 'PROVINCIAL HQ', 'MISOR OFFICE'],
        labels: { show: false },
        axisBorder: { show: false },
        axisTicks: { show: false }
      },
      yaxis: {
        labels: {
          style: { fontSize: '9px', fontWeight: 800, colors: ["#64748b"] }
        }
      },
      grid: { show: false },
      legend: { show: false }
    }).render();
  }

  // 2. Total SPES (Male vs Female)
  const genderEl = document.getElementById("spes-gender-chart");
  if (genderEl) {
    genderEl.innerHTML = "";
    new ApexCharts(genderEl, {
      series: [850, 720], // Total Hundreds
      chart: { type: 'donut', height: 250, toolbar: { show: false }, fontFamily: 'Inter, sans-serif' },
      labels: ['MALE', 'FEMALE'],
      colors: [maleColor, femaleColor],
      legend: { position: 'bottom', fontWeight: 800, fontSize: '11px' },
      stroke: { show: false },
      dataLabels: { enabled: false },
      plotOptions: { 
        pie: { 
          donut: { 
            size: '75%',
            labels: {
              show: true,
              name: { show: true, fontSize: '10px', fontWeight: 700, offsetY: -5, color: '#64748b' },
              value: { show: true, fontSize: '18px', fontWeight: 900, offsetY: 5, formatter: (val) => fmt(val) },
              total: {
                show: true,
                label: 'TOTAL SPES',
                fontSize: '9px',
                fontWeight: 900,
                color: brandColor,
                formatter: (w) => fmt(w.globals.seriesTotals.reduce((a, b) => a + b, 0))
              }
            }
          } 
        } 
      }
    }).render();
  }

  // 3. Students Added (Growth)
  const columnEl = document.getElementById("column-chart");
  if (columnEl) {
    columnEl.innerHTML = "";
    new ApexCharts(columnEl, {
      colors: [brandColor, brandSecondaryColor],
      series: [
        { name: "Direct", data: [120, 250, 180, 420, 310, 220, 480] },
        { name: "Referral", data: [80, 150, 120, 280, 190, 110, 250] }
      ],
      chart: { type: "bar", height: 180, toolbar: { show: false }, fontFamily: "Inter, sans-serif" },
      plotOptions: { bar: { columnWidth: "65%", borderRadius: 2 } },
      dataLabels: { enabled: false },
      xaxis: {
        categories: ["2020", "2021", "2022", "2023", "2024", "2025", "2026"],
        labels: { style: { fontSize: '9px', fontWeight: 700 } }
      },
      yaxis: { show: false, max: 550 },
      grid: { show: false },
      legend: { show: false }
    }).render();
  }

  // 4. Enrollment Timeline
  const trendEl = document.getElementById("mini-trends");
  if (trendEl) {
    trendEl.innerHTML = "";
    new ApexCharts(trendEl, {
      series: [{ name: 'Enrollment', data: [131, 240, 128, 420, 320, 109, 210, 312, 158, 295, 311, 413] }],
      chart: { type: 'area', height: 185, toolbar: { show: false } },
      colors: [brandColor],
      stroke: { curve: 'smooth', width: 3 },
      fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0 } },
      xaxis: { 
        categories: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
        labels: { style: { fontSize: '9px', fontWeight: 700 } }
      },
      yaxis: { show: false },
      grid: { show: false },
      dataLabels: { enabled: false }
    }).render();
  }
}
