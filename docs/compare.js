"use strict";

/* ---------------------------------------------------------------------
   Bit position comparison page — loads data/bit{0..3}/summary.csv side
   by side (whichever exist) and renders an overview table, three grouped
   bar charts (mean per bit position, grouped by variant), and a
   per-sensor pivot table so every condition's four bit-position results
   sit in one row. Each bit position is an independent single-bit-plane
   stream (bit 0 = LSB), not a cumulative multi-bit extraction — see the
   per-position vs. concatenated design note in modules/lsb_extraction.py.
   Shares CSV parsing / SVG primitives with the main dashboard via
   chart-utils.js.
   --------------------------------------------------------------------- */

const BIT_POSITIONS = [0, 1, 2, 3];

const METRICS = [
  { key: "Min-Entropy (bits/bit)", label: "Min-Entropy", percent: false },
  { key: "VN Min-Entropy (bits/bit)", label: "VN Min-Entropy", percent: false },
  { key: "VN Retention Rate", label: "VN Retention Rate", percent: true },
  { key: "SP 800-22 Pass Rate", label: "SP 800-22 Pass Rate", percent: true },
];

const state = {
  byBit: {}, // { 0: rows[], 1: rows[], ... } — only keys with data present
  metric: METRICS[0].key,
  pivotSearch: "",
};

function formatMetric(value, metricKey) {
  if (value == null || Number.isNaN(value)) return "—";
  const metric = METRICS.find((m) => m.key === metricKey);
  return metric && metric.percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(4);
}

async function boot() {
  const fetches = BIT_POSITIONS.map((n) =>
    fetch(`data/bit${n}/summary.csv`)
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => (text ? parseCsv(text) : null))
      .catch(() => null)
  );
  const results = await Promise.all(fetches);
  state.byBit = {};
  BIT_POSITIONS.forEach((n, i) => {
    if (results[i] && results[i].length) state.byBit[n] = results[i];
  });

  if (!Object.keys(state.byBit).length) {
    document.querySelector("main").innerHTML =
      '<div class="empty-state">No results found at data/bit0..3/summary.csv yet. Run the pipeline ' +
      'locally at each bit position (<code>python3 main.py</code>, or app.py\'s "Save results") ' +
      'and push docs/data/bit{N}/.</div>';
    return;
  }

  renderMetricSwitch();
  renderOverviewTable();
  renderGroupedBarChart(
    meansByBitVariant("Min-Entropy (bits/bit)"),
    "chart-entropy-compare",
    "Mean min-entropy (bits/bit)",
    { formatValue: (v) => v.toFixed(4), formatTick: (t) => t.toFixed(2) }
  );
  renderGroupedBarChart(
    meansByBitVariant("VN Retention Rate"),
    "chart-retention-compare",
    "Mean VN retention rate",
    PERCENT_OPTS
  );
  renderGroupedBarChart(
    meansByBitVariant("SP 800-22 Pass Rate"),
    "chart-passrate-compare",
    "Mean SP 800-22 pass rate",
    PERCENT_OPTS
  );
  renderPivotTable();
}

const PERCENT_OPTS = {
  domain: [0, 1],
  tickValues: [0, 0.25, 0.5, 0.75, 1],
  formatTick: (t) => `${Math.round(t * 100)}%`,
  formatValue: (v) => `${(v * 100).toFixed(2)}%`,
};

/* ---------------------------------------------------------------------
   Overview table
   --------------------------------------------------------------------- */

function renderOverviewTable() {
  const el = document.getElementById("overview-table");
  const headers = ["Bit Position", "Sensors", "Conditions", "Mean Min-Entropy", "Mean VN Min-Entropy", "Mean VN Retention", "Mean SP 800-22 Pass Rate"];

  const bodyRows = BIT_POSITIONS.map((n) => {
    const rows = state.byBit[n];
    if (!rows) {
      return `<tr class="pending-row"><td class="text-cell">Bit ${n}</td><td class="empty-cell" colspan="6">No data yet</td></tr>`;
    }
    const sensors = new Set(rows.map((r) => r.Sensor)).size;
    return `<tr>
      <td class="text-cell">Bit ${n}</td>
      <td>${sensors}</td>
      <td>${rows.length}</td>
      <td>${formatMetric(mean(rows, "Min-Entropy (bits/bit)"), "Min-Entropy (bits/bit)")}</td>
      <td>${formatMetric(mean(rows, "VN Min-Entropy (bits/bit)"), "VN Min-Entropy (bits/bit)")}</td>
      <td>${formatMetric(mean(rows, "VN Retention Rate"), "VN Retention Rate")}</td>
      <td>${formatMetric(mean(rows, "SP 800-22 Pass Rate"), "SP 800-22 Pass Rate")}</td>
    </tr>`;
  }).join("");

  el.innerHTML = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody>`;
}

/* ---------------------------------------------------------------------
   Grouped bar charts — x = bit position, clustered bars = variant
   --------------------------------------------------------------------- */

function meansByBitVariant(field) {
  const out = {};
  BIT_POSITIONS.forEach((n) => {
    const rows = state.byBit[n];
    if (!rows) return;
    const byVariant = groupBy(rows, "Variant");
    out[n] = {};
    Object.keys(byVariant).forEach((v) => {
      out[n][v] = mean(byVariant[v], field);
    });
  });
  return out;
}

function renderGroupedBarChart(dataByBitVariant, containerId, yLabel, opts = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const bitsPresent = BIT_POSITIONS.filter((n) => dataByBitVariant[n]);
  if (!bitsPresent.length) {
    container.innerHTML = '<div class="empty-state">No data recorded for any bit position yet.</div>';
    return;
  }

  const variantsPresent = [...new Set(bitsPresent.flatMap((n) => Object.keys(dataByBitVariant[n])))].sort();

  const width = Math.max(560, bitsPresent.length * 160);
  const height = 300;
  const margin = { top: 12, right: 16, bottom: 40, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const allValues = bitsPresent.flatMap((n) =>
    variantsPresent.map((v) => dataByBitVariant[n][v]).filter((v) => v != null && !Number.isNaN(v))
  );
  const dataMax = allValues.length ? Math.max(...allValues) : 1;
  const yMax = opts.domain ? opts.domain[1] : Math.max(...niceTicks(dataMax, 4));
  const yMin = opts.domain ? opts.domain[0] : 0;
  const tickValues = opts.tickValues || niceTicks(yMax, 5).filter((t) => t >= yMin && t <= yMax);
  const formatTick = opts.formatTick || ((t) => t.toFixed(2));
  const formatValue = opts.formatValue || ((v) => v.toFixed(4));

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(bitsPresent.map(String), [0, plotW]);
  const y = linearScale([yMin, yMax], [plotH, 0]);

  const yLabels = [];
  tickValues.forEach((t) => {
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = formatTick(t);
    yLabels.push(label);
  });
  g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: y(yMin), y2: y(yMin) }));

  const clusterWidth = Math.min(120, x.step * 0.7);
  const barWidth = clusterWidth / variantsPresent.length - 4;

  bitsPresent.forEach((n) => {
    const cx = x(String(n));
    variantsPresent.forEach((v, vi) => {
      const value = dataByBitVariant[n][v];
      const color = VARIANT_COLOR[v] || "var(--ink-muted)";
      const offset = (vi - (variantsPresent.length - 1) / 2) * (barWidth + 4);

      if (value == null || Number.isNaN(value)) {
        g.appendChild(svgEl("rect", {
          class: "mark-bar pending", x: cx + offset - barWidth / 2, y: margin.top, width: barWidth, height: plotH - margin.top, rx: 3,
        }));
        return;
      }

      const barH = Math.max(0, y(yMin) - y(value));
      const rect = svgEl("rect", {
        class: "mark-bar", x: cx + offset - barWidth / 2, y: y(value), width: barWidth, height: barH, rx: 3, fill: color,
      });
      g.appendChild(rect);

      const hit = svgEl("rect", { class: "hit-target", x: cx + offset - barWidth / 2, y: 0, width: barWidth, height: plotH });
      hit.addEventListener("pointerenter", (e) => {
        rect.setAttribute("opacity", "0.85");
        showTooltip(e.clientX, e.clientY,
          `<div class="tt-title">Bit ${n} — Variant ${escapeHtml(v)}</div>` +
          `<div class="tt-row"><span class="tt-key" style="background:${color}"></span>${escapeHtml(yLabel)}<span class="tt-value">${formatValue(value)}</span></div>`);
      });
      hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
      hit.addEventListener("pointerleave", () => { rect.removeAttribute("opacity"); hideTooltip(); });
      g.appendChild(hit);
    });

    const label = svgEl("text", { class: "axis-label", x: cx, y: plotH + 20, "text-anchor": "middle" });
    label.textContent = `Bit ${n}`;
    g.appendChild(label);
  });

  yLabels.forEach((label) => g.appendChild(label));

  container.appendChild(svg);
  container.appendChild(buildLegend(variantsPresent, "bar"));
}

/* ---------------------------------------------------------------------
   Per-sensor pivot table — one row per (Sensor, Temp, Voltage), one
   column per bit position, for whichever metric is selected.
   --------------------------------------------------------------------- */

function renderMetricSwitch() {
  const el = document.getElementById("metric-switch");
  el.innerHTML = "";
  METRICS.forEach((m) => {
    const btn = document.createElement("button");
    btn.className = "pill" + (state.metric === m.key ? " active" : "");
    btn.type = "button";
    btn.textContent = m.label;
    btn.addEventListener("click", () => {
      if (state.metric === m.key) return;
      state.metric = m.key;
      renderMetricSwitch();
      renderPivotTable();
    });
    el.appendChild(btn);
  });
}

function buildPivotRows() {
  const merged = new Map();
  BIT_POSITIONS.forEach((n) => {
    const rows = state.byBit[n];
    if (!rows) return;
    rows.forEach((r) => {
      const key = `${r.Sensor}|${r["Temp (C)"]}|${r["Voltage (V)"]}`;
      if (!merged.has(key)) {
        merged.set(key, { sensor: r.Sensor, variant: r.Variant, temp: r["Temp (C)"], voltage: r["Voltage (V)"], values: {} });
      }
      merged.get(key).values[n] = r[state.metric];
    });
  });
  return [...merged.values()].sort((a, b) =>
    String(a.variant).localeCompare(String(b.variant)) ||
    String(a.sensor).localeCompare(String(b.sensor), undefined, { numeric: true }) ||
    Number(a.temp) - Number(b.temp) ||
    Number(a.voltage) - Number(b.voltage)
  );
}

function renderPivotTable() {
  const el = document.getElementById("pivot-table");
  let rows = buildPivotRows();
  if (state.pivotSearch) {
    rows = rows.filter((r) =>
      String(r.sensor).toLowerCase().includes(state.pivotSearch) ||
      String(r.variant).toLowerCase().includes(state.pivotSearch)
    );
  }

  const headers = ["Sensor", "Variant", "Temp (C)", "Voltage (V)", ...BIT_POSITIONS.map((n) => `Bit ${n}`)];
  const thead = `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;

  const tbody = `<tbody>${rows.map((r) => {
    const bitCells = BIT_POSITIONS.map((n) => {
      if (!state.byBit[n]) return `<td class="empty-cell">—</td>`;
      return `<td>${formatMetric(r.values[n], state.metric)}</td>`;
    }).join("");
    return `<tr><td class="text-cell">${escapeHtml(r.sensor)}</td><td class="text-cell">${escapeHtml(r.variant)}</td>` +
      `<td>${r.temp}</td><td>${r.voltage}</td>${bitCells}</tr>`;
  }).join("")}</tbody>`;

  el.innerHTML = thead + tbody;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("pivot-search").addEventListener("input", (e) => {
    state.pivotSearch = e.target.value.toLowerCase();
    renderPivotTable();
  });
  boot();
});
