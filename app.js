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
const DAY = 86400;

// Selectable time ranges. `days: null` means the full available history.
const RANGES = {
  "3m": { label: "3M", days: 90 },
  "6m": { label: "6M", days: 182 },
  "1y": { label: "1Y", days: 365 },
  "5y": { label: "5Y", days: 365 * 5 },
  "all": { label: "All", days: null }
};
const DEFAULT_RANGE = "1y";

let chart;
const state = { data: null, range: DEFAULT_RANGE };

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

function setActiveRange() {
  document.querySelectorAll("[data-range]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.range === state.range);
  });
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

function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

// Build aligned, base-100 datasets for the selected window.
//
// Coins can start on different dates (e.g. SOL vs BTC), so we align every
// series onto the union of all daily timestamps in the window and leave gaps
// (null) before each coin exists. Each series is re-anchored to 100 at its
// first available point within the window.
function buildSeries(data, cutoffTs) {
  const perCoin = [];
  const failed = [];
  const allTimes = new Set();

  Object.entries(coins).forEach(([id, label], index) => {
    const history = data.coins[id]?.history;
    if (!Array.isArray(history) || history.length === 0) {
      failed.push(label);
      return;
    }

    const points = history
      // close > 0 drops pre-inception padding (CryptoCompare reports 0 before
      // a coin existed), which would otherwise make the base-100 anchor zero.
      .filter(p => typeof p?.time === "number" && typeof p?.close === "number" && p.close > 0 &&
        (cutoffTs === null || p.time >= cutoffTs))
      .sort((a, b) => a.time - b.time);

    if (points.length === 0) {
      failed.push(label);
      return;
    }

    points.forEach(p => allTimes.add(p.time));
    perCoin.push({ label, color: palette[index % palette.length], points });
  });

  const times = [...allTimes].sort((a, b) => a - b);
  const indexByTime = new Map(times.map((t, i) => [t, i]));
  const labels = times.map(formatDate);

  const datasets = perCoin.map(coin => {
    const base = coin.points[0].close;
    const series = new Array(times.length).fill(null);
    for (const p of coin.points) {
      series[indexByTime.get(p.time)] = (p.close / base) * 100;
    }
    return {
      label: coin.label,
      data: series,
      borderColor: coin.color,
      backgroundColor: coin.color,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      spanGaps: false,
      fill: false,
      tension: 0.1
    };
  });

  return { labels, datasets, failed };
}

async function loadData() {
  setLoading(true);
  setStatus("Loading data from local file...");

  try {
    state.data = await loadLocalData();
  } catch (err) {
    console.error(err);
    setStatus("Could not read crypto-data.json. Refresh or generate the local file.", true);
    setLoading(false);
    return;
  }

  render();
  setLoading(false);
}

function render() {
  if (!state.data) return;

  const cfg = RANGES[state.range] ?? RANGES[DEFAULT_RANGE];
  const nowTs = Math.floor(Date.now() / 1000);
  const cutoffTs = cfg.days === null ? null : nowTs - cfg.days * DAY;

  const { labels, datasets, failed } = buildSeries(state.data, cutoffTs);

  if (datasets.length === 0) {
    if (chart) { chart.destroy(); chart = null; }
    setStatus("No data available for this range.", true);
    return;
  }

  renderChart(labels, datasets, state.range);

  if (failed.length > 0) {
    setStatus(`Showing ${cfg.label} · base 100. Failed: ${failed.join(", ")}`, true);
  } else {
    const snapshot = state.data.generatedAt
      ? ` (snapshot: ${formatDate(Date.parse(state.data.generatedAt) / 1000)})`
      : "";
    setStatus(`Showing ${cfg.label} · base 100${snapshot}.`);
  }
}

function renderChart(labels, datasets, range) {
  if (chart) chart.destroy();

  const ctx = document.getElementById("chart");
  const theme = document.documentElement.getAttribute("data-theme") || "light";

  // "All" spans very different magnitudes (coins start at different dates),
  // so a log axis keeps every series readable.
  const isAll = range === "all";

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
            label: (item) => item.parsed.y == null
              ? null
              : `${item.dataset.label}: ${item.parsed.y.toFixed(1)}`
          }
        }
      },
      scales: {
        y: {
          type: isAll ? "logarithmic" : "linear",
          title: { display: true, text: isAll ? "Base 100 (log)" : "Base 100" },
          ticks: {},
          grid: {}
        },
        x: {
          title: { display: true, text: "Date" },
          ticks: { maxTicksLimit: 10, autoSkip: true, maxRotation: 0 },
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

document.querySelectorAll("[data-range]").forEach(btn => {
  btn.addEventListener("click", () => {
    state.range = btn.dataset.range;
    setActiveRange();
    render();
  });
});
setActiveRange();

// Follow the system theme change if the user has not chosen manually.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
  if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? "dark" : "light");
});

loadData();
