const coins = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  monero: "XMR",
  ripple: "XRP",
  cardano: "ADA",
  tron: "TRX",
  dogecoin: "DOGE"
};

// Fixed palette so each coin has a stable, distinguishable color.
const palette = [
  "#f7931a", // BTC orange
  "#627eea", // ETH blue
  "#14f195", // SOL green
  "#ff6600", // XMR dark orange
  "#23292f", // XRP
  "#0033ad", // ADA
  "#eb0029", // TRX red
  "#c2a633"  // DOGE gold
];

const DATA_FILE = "./crypto-data.json";
const THEME_KEY = "cryptos-graph-theme";

let chart;

/* ---------- Theme (light / dark) ---------- */

function getPreferredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  const icon = document.getElementById("theme-icon");
  const label = document.getElementById("theme-label");
  if (icon && label) {
    const goingDark = theme === "light"; // the button shows the next action
    icon.textContent = goingDark ? "🌙" : "☀️";
    label.textContent = goingDark ? "Dark" : "Light";
  }

  if (chart) applyChartTheme(chart, theme);
}

function toggleTheme() {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

function themeColors(theme) {
  return theme === "dark"
    ? { text: "#9aa0a8", grid: "rgba(255,255,255,0.08)" }
    : { text: "#5a6068", grid: "rgba(0,0,0,0.08)" };
}

function applyChartTheme(targetChart, theme) {
  const { text, grid } = themeColors(theme);
  const scales = targetChart.options.scales;
  for (const axis of [scales.x, scales.y]) {
    axis.ticks.color = text;
    axis.grid.color = grid;
    axis.title.color = text;
  }
  targetChart.options.plugins.legend.labels.color = text;
  targetChart.update("none");
}

/* ---------- Status / UI ---------- */

function setStatus(message, isError = false) {
  const statusEl = document.getElementById("status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function setLoading(isLoading) {
  const btn = document.getElementById("refresh");
  if (btn) btn.disabled = isLoading;
}

/* ---------- Data ---------- */

async function loadLocalData() {
  const res = await fetch(DATA_FILE, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not read ${DATA_FILE}: HTTP ${res.status}`);
  }

  const payload = await res.json();
  if (!payload?.coins || typeof payload.coins !== "object") {
    throw new Error("The local file is not in the expected format");
  }

  return payload;
}

// Base-100 normalization relative to the first value in the series.
function normalize(arr) {
  const base = arr[0];
  if (!base) return arr.map(() => null);
  return arr.map(v => (v / base) * 100);
}

function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

async function loadData() {
  setLoading(true);
  setStatus("Loading data from local file...");

  let localData;
  try {
    localData = await loadLocalData();
  } catch (err) {
    console.error(err);
    setStatus("Could not read crypto-data.json. Refresh or generate the local file.", true);
    setLoading(false);
    return;
  }

  let labels = [];
  const datasets = [];
  const failedCoins = [];

  Object.entries(coins).forEach(([id, label], index) => {
    try {
      const history = localData.coins[id]?.history;
      if (!Array.isArray(history) || history.length === 0) {
        throw new Error(`No history in file for ${label}`);
      }

      // The snapshot does not guarantee chronological order: sort by time
      // so the base 100 and the X axis are correct.
      const points = history
        .filter(p => typeof p?.time === "number" && typeof p?.close === "number")
        .sort((a, b) => a.time - b.time);

      if (points.length === 0) {
        throw new Error(`Invalid prices for ${label}`);
      }

      const norm = normalize(points.map(p => p.close));

      // Use the dates from the longest series as X-axis labels.
      if (points.length > labels.length) {
        labels = points.map(p => formatDate(p.time));
      }

      const color = palette[index % palette.length];
      datasets.push({
        label,
        data: norm,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: false,
        tension: 0.1
      });
    } catch (err) {
      failedCoins.push(label);
      console.error(`Error loading ${label}:`, err);
    }
  });

  if (datasets.length === 0) {
    setStatus("Could not load data. Try again in a few seconds.", true);
    setLoading(false);
    return;
  }

  renderChart(labels, datasets);

  if (failedCoins.length > 0) {
    setStatus(`Chart loaded partially. Failed: ${failedCoins.join(", ")}`, true);
  } else {
    const sourceTime = localData.generatedAt
      ? ` (snapshot: ${formatDate(Date.parse(localData.generatedAt) / 1000)})`
      : "";
    setStatus(`Local data loaded successfully${sourceTime}.`);
  }

  setLoading(false);
}

function renderChart(labels, datasets) {
  if (chart) chart.destroy();

  const ctx = document.getElementById("chart");
  const theme = document.documentElement.getAttribute("data-theme") || "light";

  chart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)}`
          }
        }
      },
      scales: {
        y: {
          title: { display: true, text: "Base 100" },
          ticks: {},
          grid: {}
        },
        x: {
          title: { display: true, text: "Date" },
          ticks: { maxTicksLimit: 12, autoSkip: true, maxRotation: 0 },
          grid: {}
        }
      }
    }
  });

  applyChartTheme(chart, theme);
}

/* ---------- Init ---------- */

applyTheme(getPreferredTheme());
document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

// Follow the system theme change if the user has not chosen manually.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? "dark" : "light");
});

loadData();
