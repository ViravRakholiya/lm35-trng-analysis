"use strict";

/* ---------------------------------------------------------------------
   Data loading
   --------------------------------------------------------------------- */

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      const raw = cells[i];
      const num = Number(raw);
      row[h] = raw !== "" && !Number.isNaN(num) ? num : raw;
    });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

const state = {
  rows: [],
  details: [],
  filters: { variant: new Set(), sensor: new Set(), temp: new Set(), voltage: new Set() },
  sort: { column: "Sensor", dir: 1 },
  search: "",
  detailKey: null,
  subtestSearch: "",
};

const VARIANT_COLOR = { A: "var(--series-a)", B: "var(--series-b)", C: "var(--series-c)" };

async function boot() {
  try {
    const [summaryText, detailsJson] = await Promise.all([
      fetch("data/summary.csv").then((r) => (r.ok ? r.text() : Promise.reject(r.status))),
      fetch("data/full_details.json").then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    state.rows = parseCsv(summaryText);
    state.details = detailsJson;
    renderAll();
  } catch (err) {
    document.querySelector("main").innerHTML =
      '<div class="empty-state">No results found at data/summary.csv yet. Run the pipeline locally ' +
      '(<code>python3 main.py</code>, or "Save results" in app.py) and push docs/data/.</div>';
    console.error("Failed to load dashboard data", err);
  }
}

/* ---------------------------------------------------------------------
   Filtering
   --------------------------------------------------------------------- */

function filteredRows() {
  const f = state.filters;
  return state.rows.filter((r) => {
    if (f.variant.size && !f.variant.has(String(r.Variant))) return false;
    if (f.sensor.size && !f.sensor.has(String(r.Sensor))) return false;
    if (f.temp.size && !f.temp.has(String(r["Temp (C)"]))) return false;
    if (f.voltage.size && !f.voltage.has(String(r["Voltage (V)"]))) return false;
    return true;
  });
}

function uniqueSorted(rows, key) {
  return [...new Set(rows.map((r) => String(r[key])))].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
}

/* ---------------------------------------------------------------------
   Render orchestration
   --------------------------------------------------------------------- */

const PERCENT_AXIS_OPTS = {
  domain: [0, 1],
  tickValues: [0, 0.25, 0.5, 0.75, 1],
  formatTick: (t) => `${Math.round(t * 100)}%`,
  formatValue: (v) => `${(v * 100).toFixed(2)}%`,
};

function renderAll() {
  renderFilterPills();
  const rows = filteredRows();
  renderStatTiles(rows);
  renderEntropyChart(rows);
  renderBarChart(rows, "VN Retention Rate", "chart-retention", "Mean VN Retention Rate", PERCENT_AXIS_OPTS);
  renderBarChart(rows, "SP 800-22 Pass Rate", "chart-passrate", "Mean SP 800-22 Pass Rate", PERCENT_AXIS_OPTS);
  renderTempVoltageChart(rows);
  renderRawVsProcessedChart(rows);
  renderHeatmap(rows);
  renderBoxPlot(rows);
  renderAyyadaChart(rows);
  renderTable(rows);
  renderDetailSelect();
}

/* ---------------------------------------------------------------------
   Filter pills
   --------------------------------------------------------------------- */

function renderFilterPills() {
  const variantScope = state.rows;
  const sensorScope = state.filters.variant.size
    ? state.rows.filter((r) => state.filters.variant.has(String(r.Variant)))
    : state.rows;

  buildPillGroup("filter-variant", uniqueSorted(variantScope, "Variant"), state.filters.variant, () => {
    state.filters.sensor.clear();
    renderAll();
  });
  buildPillGroup("filter-sensor", uniqueSorted(sensorScope, "Sensor"), state.filters.sensor, renderAll);
  buildPillGroup("filter-temp", uniqueSorted(state.rows, "Temp (C)"), state.filters.temp, renderAll, (v) => `${v}°C`);
  buildPillGroup("filter-voltage", uniqueSorted(state.rows, "Voltage (V)"), state.filters.voltage, renderAll, (v) => `${v}V`);
}

function buildPillGroup(containerId, values, activeSet, onChange, formatLabel) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  values.forEach((v) => {
    const btn = document.createElement("button");
    btn.className = "pill" + (activeSet.has(v) ? " active" : "");
    btn.type = "button";
    btn.textContent = formatLabel ? formatLabel(v) : v;
    btn.addEventListener("click", () => {
      if (activeSet.has(v)) activeSet.delete(v);
      else activeSet.add(v);
      onChange();
    });
    el.appendChild(btn);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("reset-filters").addEventListener("click", () => {
    state.filters.variant.clear();
    state.filters.sensor.clear();
    state.filters.temp.clear();
    state.filters.voltage.clear();
    renderAll();
  });
  document.getElementById("table-search").addEventListener("input", (e) => {
    state.search = e.target.value.toLowerCase();
    renderTable(filteredRows());
  });
  document.getElementById("subtest-search").addEventListener("input", (e) => {
    state.subtestSearch = e.target.value.toLowerCase();
    renderDetail();
  });
  document.getElementById("detail-select").addEventListener("change", (e) => {
    state.detailKey = e.target.value;
    renderDetail();
  });
  document.getElementById("download-summary").addEventListener("click", () => {
    const link = document.createElement("a");
    link.href = "data/summary.csv";
    link.download = "summary.csv";
    link.click();
  });
  boot();
});

/* ---------------------------------------------------------------------
   Stat tiles
   --------------------------------------------------------------------- */

function mean(rows, key) {
  const vals = rows.map((r) => Number(r[key])).filter((v) => !Number.isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

function renderStatTiles(rows) {
  const sensors = new Set(rows.map((r) => r.Sensor)).size;
  const tiles = [
    { label: "Sensors", value: String(sensors) },
    { label: "Conditions", value: String(rows.length) },
    { label: "Mean min-entropy (bits/bit)", value: mean(rows, "Min-Entropy (bits/bit)").toFixed(4) },
    { label: "Mean SP 800-22 pass rate", value: mean(rows, "SP 800-22 Pass Rate").toFixed(4) },
  ];
  const el = document.getElementById("stat-row");
  el.innerHTML = "";
  tiles.forEach((t) => {
    const div = document.createElement("div");
    div.className = "stat-tile";
    div.innerHTML = `<div class="stat-label">${escapeHtml(t.label)}</div><div class="stat-value">${escapeHtml(t.value)}</div>`;
    el.appendChild(div);
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

/* ---------------------------------------------------------------------
   SVG chart primitives
   --------------------------------------------------------------------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function linearScale(domain, range) {
  const [d0, d1] = domain, [r0, r1] = range;
  const scale = (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
  scale.invert = (px) => d0 + ((px - r0) / (r1 - r0)) * (d1 - d0);
  return scale;
}

function pointScale(domainValues, range) {
  const [r0, r1] = range;
  const n = domainValues.length;
  // For a single category there's no "distance between points" to derive a
  // step from — fall back to the full range so bar/box width calculations
  // downstream (which read x.step) don't collapse to zero and vanish.
  const step = n > 1 ? (r1 - r0) / (n - 1) : (r1 - r0);
  const scale = (v) => {
    const i = domainValues.indexOf(v);
    return n > 1 ? r0 + i * step : (r0 + r1) / 2;
  };
  scale.step = step;
  scale.domainValues = domainValues;
  return scale;
}

function niceTicks(max, count = 5) {
  if (max <= 0) return [0];
  const rough = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const ticks = [];
  for (let t = 0; t <= max + step / 2; t += step) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

function showTooltip(x, y, html) {
  const tt = document.getElementById("tooltip");
  tt.innerHTML = html;
  tt.hidden = false;
  const pad = 14;
  let left = x + pad, top = y + pad;
  const rect = tt.getBoundingClientRect();
  if (left + rect.width > window.innerWidth) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight) top = y - rect.height - pad;
  tt.style.left = `${left}px`;
  tt.style.top = `${top}px`;
}
function hideTooltip() {
  document.getElementById("tooltip").hidden = true;
}

/* ---------------------------------------------------------------------
   Entropy line chart — small multiples by voltage, one line per sensor
   --------------------------------------------------------------------- */

function renderEntropyChart(rows) {
  const container = document.getElementById("chart-entropy");
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No data for the current filters.</div>';
    return;
  }

  const voltages = uniqueSorted(rows, "Voltage (V)");
  const temps = uniqueSorted(rows, "Temp (C)");
  const variantsPresent = uniqueSorted(rows, "Variant");

  const wrap = document.createElement("div");
  wrap.className = "chart-facets";

  const values = rows.map((r) => r["Min-Entropy (bits/bit)"]);
  const yMin = Math.min(...values), yMax = Math.max(...values);
  const yPad = (yMax - yMin) * 0.15 || 0.01;
  const yDomain = [yMin - yPad, yMax + yPad];

  const facetWidth = 340, height = 260;
  const margin = { top: 12, right: 16, bottom: 32, left: 46 };
  const plotW = facetWidth - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  voltages.forEach((voltage) => {
    const facetRows = rows.filter((r) => String(r["Voltage (V)"]) === voltage);
    const facetTemps = uniqueSorted(facetRows, "Temp (C)").length ? temps : [];

    const col = document.createElement("div");
    const title = document.createElement("div");
    title.className = "facet-title";
    title.textContent = `${voltage} V`;
    col.appendChild(title);

    const svg = svgEl("svg", { viewBox: `0 0 ${facetWidth} ${height}` });
    const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
    svg.appendChild(g);

    const x = pointScale(facetTemps, [0, plotW]);
    const y = linearScale(yDomain, [plotH, 0]);

    const yTicks = niceTicks(yDomain[1], 5).filter((t) => t >= yDomain[0] && t <= yDomain[1]);
    yTicks.forEach((t) => {
      g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
      const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
      label.textContent = t.toFixed(3);
      g.appendChild(label);
    });
    g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: plotH, y2: plotH }));
    facetTemps.forEach((t) => {
      const label = svgEl("text", { class: "axis-label", x: x(t), y: plotH + 20, "text-anchor": "middle" });
      label.textContent = `${t}°C`;
      g.appendChild(label);
    });

    const bySensor = groupBy(facetRows, "Sensor");
    Object.keys(bySensor).forEach((sensor) => {
      const pts = bySensor[sensor]
        .slice()
        .sort((a, b) => Number(a["Temp (C)"]) - Number(b["Temp (C)"]))
        .filter((r) => facetTemps.includes(String(r["Temp (C)"])));
      if (!pts.length) return;
      const variant = pts[0].Variant;
      const color = VARIANT_COLOR[variant] || "var(--ink-muted)";
      const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(String(p["Temp (C)"]))} ${y(p["Min-Entropy (bits/bit)"])}`).join(" ");
      g.appendChild(svgEl("path", { class: "mark-line", d, stroke: color }));
      pts.forEach((p) => {
        const cx = x(String(p["Temp (C)"])), cy = y(p["Min-Entropy (bits/bit)"]);
        g.appendChild(svgEl("circle", { class: "mark-dot", cx, cy, r: 4, fill: color }));
        const hit = svgEl("circle", { class: "hit-target", cx, cy, r: 12 });
        hit.addEventListener("pointerenter", (e) => {
          showTooltip(e.clientX, e.clientY,
            `<div class="tt-title">${escapeHtml(sensor)} (${escapeHtml(variant)}) — ${p["Temp (C)"]}°C @ ${voltage}V</div>` +
            `<div class="tt-row"><span class="tt-key" style="background:${color}"></span>Min-entropy<span class="tt-value">${p["Min-Entropy (bits/bit)"].toFixed(4)}</span></div>`);
        });
        hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
        hit.addEventListener("pointerleave", hideTooltip);
        g.appendChild(hit);
      });
    });

    col.appendChild(svg);
    wrap.appendChild(col);
  });

  container.appendChild(wrap);
  container.appendChild(buildLegend(variantsPresent));
}

function groupBy(rows, key) {
  return rows.reduce((acc, r) => {
    const k = r[key];
    (acc[k] = acc[k] || []).push(r);
    return acc;
  }, {});
}

function buildLegend(variants, markType = "line") {
  const el = document.createElement("div");
  el.className = "legend";
  variants.forEach((v) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    const swatchClass = markType === "bar" ? "legend-swatch legend-swatch-rect" : "legend-swatch";
    item.innerHTML = `<span class="${swatchClass}" style="background:${VARIANT_COLOR[v] || "var(--ink-muted)"}"></span>Variant ${escapeHtml(v)}`;
    el.appendChild(item);
  });
  return el;
}

/* ---------------------------------------------------------------------
   Bar chart — mean of a field per sensor, colored by variant
   --------------------------------------------------------------------- */

function renderBarChart(rows, field, containerId, yLabel, opts = {}) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No data for the current filters.</div>';
    return;
  }

  const bySensor = groupBy(rows, "Sensor");
  const sensors = Object.keys(bySensor).sort();
  const bars = sensors.map((s) => ({
    sensor: s,
    variant: bySensor[s][0].Variant,
    value: mean(bySensor[s], field),
  }));

  const width = Math.max(560, bars.length * 64);
  const height = 300;
  const margin = { top: 12, right: 16, bottom: 40, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Fixed domain by default (opts.domain), never auto-ranged — so bar heights
  // stay honestly comparable across charts with very different value ranges
  // (e.g. ~25% retention vs ~98% pass rate both filling the same axis).
  const dataMax = Math.max(...bars.map((b) => b.value));
  const yMax = opts.domain ? opts.domain[1] : Math.max(...niceTicks(dataMax, 4));
  const yMin = opts.domain ? opts.domain[0] : 0;
  const tickValues = opts.tickValues || niceTicks(yMax, 5).filter((t) => t >= yMin && t <= yMax);
  const formatTick = opts.formatTick || ((t) => t.toFixed(2));
  const formatValue = opts.formatValue || ((v) => v.toFixed(4));

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(bars.map((b) => b.sensor), [0, plotW]);
  const y = linearScale([yMin, yMax], [plotH, 0]);

  tickValues.forEach((t) => {
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = formatTick(t);
    g.appendChild(label);
  });
  g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: y(yMin), y2: y(yMin) }));

  const barWidth = Math.min(24, x.step * 0.55);
  bars.forEach((b) => {
    const cx = x(b.sensor);
    const barH = Math.max(0, y(yMin) - y(b.value));
    const color = VARIANT_COLOR[b.variant] || "var(--ink-muted)";
    const rect = svgEl("rect", {
      class: "mark-bar",
      x: cx - barWidth / 2,
      y: y(b.value),
      width: barWidth,
      height: barH,
      rx: 4,
      fill: color,
    });
    g.appendChild(rect);

    const label = svgEl("text", { class: "axis-label", x: cx, y: plotH + 20, "text-anchor": "middle" });
    label.textContent = b.sensor;
    g.appendChild(label);

    const hit = svgEl("rect", {
      class: "hit-target",
      x: cx - Math.max(barWidth, 24) / 2,
      y: 0,
      width: Math.max(barWidth, 24),
      height: plotH,
    });
    hit.addEventListener("pointerenter", (e) => {
      rect.setAttribute("opacity", "0.85");
      showTooltip(e.clientX, e.clientY,
        `<div class="tt-title">${escapeHtml(b.sensor)} (${escapeHtml(b.variant)})</div>` +
        `<div class="tt-row"><span class="tt-key" style="background:${color}"></span>${escapeHtml(yLabel)}<span class="tt-value">${formatValue(b.value)}</span></div>`);
    });
    hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
    hit.addEventListener("pointerleave", () => { rect.removeAttribute("opacity"); hideTooltip(); });
    g.appendChild(hit);
  });

  container.appendChild(svg);
  container.appendChild(buildLegend(uniqueSorted(rows, "Variant"), "bar"));
}

/* ---------------------------------------------------------------------
   Results table
   --------------------------------------------------------------------- */

const TABLE_COLUMNS = [
  "Sensor", "Variant", "Temp (C)", "Voltage (V)", "Min-Entropy (bits/bit)",
  "VN Retention Rate", "Post-VN One Fraction", "SP 800-22 Pass Rate",
];

function renderTable(rows) {
  const el = document.getElementById("results-table");
  let data = rows;
  if (state.search) {
    data = data.filter((r) =>
      TABLE_COLUMNS.some((c) => String(r[c]).toLowerCase().includes(state.search))
    );
  }
  const { column, dir } = state.sort;
  data = data.slice().sort((a, b) => {
    const av = a[column], bv = b[column];
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return cmp * dir;
  });

  const thead = `<thead><tr>${TABLE_COLUMNS.map((c) =>
    `<th data-col="${escapeHtml(c)}" class="${c === column ? "sorted" : ""}" data-dir="${c === column ? (dir === 1 ? "▲" : "▼") : ""}">${escapeHtml(c)}</th>`
  ).join("")}</tr></thead>`;

  const tbody = `<tbody>${data.map((r) =>
    `<tr>${TABLE_COLUMNS.map((c) => `<td class="${c === "Sensor" || c === "Variant" ? "text-cell" : ""}">${formatCell(r[c])}</td>`).join("")}</tr>`
  ).join("")}</tbody>`;

  el.innerHTML = thead + tbody;

  el.querySelectorAll("th").forEach((th) => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (state.sort.column === col) state.sort.dir *= -1;
      else state.sort = { column: col, dir: 1 };
      renderTable(filteredRows());
    });
  });
}

function formatCell(v) {
  if (typeof v === "number") return escapeHtml(Number.isInteger(v) ? v : v.toFixed(4));
  return escapeHtml(v);
}

/* ---------------------------------------------------------------------
   Full details drill-down
   --------------------------------------------------------------------- */

function detailLabel(d) {
  return `${d.sensor_id} (${d.variant}) — ${d.temperature_c}°C @ ${d.voltage_v}V`;
}

function renderDetailSelect() {
  const el = document.getElementById("detail-select");
  const visibleKeys = new Set(filteredRows().map((r) => `${r.Sensor}|${r["Temp (C)"]}|${r["Voltage (V)"]}`));
  const options = state.details.filter((d) =>
    visibleKeys.has(`${d.sensor_id}|${d.temperature_c}|${d.voltage_v}`)
  );

  if (!options.length) {
    el.innerHTML = "";
    document.querySelector(".detail-card").querySelector(".detail-stats").innerHTML =
      '<div class="empty-state">No detailed records for the current filters yet.</div>';
    document.getElementById("estimator-table").innerHTML = "";
    document.getElementById("subtest-table").innerHTML = "";
    return;
  }

  const keyOf = (d) => `${d.sensor_id}|${d.temperature_c}|${d.voltage_v}`;
  if (!state.detailKey || !options.some((d) => keyOf(d) === state.detailKey)) {
    state.detailKey = keyOf(options[0]);
  }

  el.innerHTML = options
    .map((d) => `<option value="${keyOf(d)}" ${keyOf(d) === state.detailKey ? "selected" : ""}>${escapeHtml(detailLabel(d))}</option>`)
    .join("");

  renderDetail();
}

function renderDetail() {
  const keyOf = (d) => `${d.sensor_id}|${d.temperature_c}|${d.voltage_v}`;
  const d = state.details.find((x) => keyOf(x) === state.detailKey);
  const statsEl = document.getElementById("detail-stats");
  const estEl = document.getElementById("estimator-table");
  const subEl = document.getElementById("subtest-table");

  if (!d) {
    statsEl.innerHTML = '<div class="empty-state">No detailed record for this selection.</div>';
    estEl.innerHTML = "";
    subEl.innerHTML = "";
    return;
  }

  statsEl.innerHTML = [
    ["Min-entropy (bits/bit)", d.min_entropy.min_entropy_per_bit.toFixed(4)],
    ["VN retention rate", d.debias.retention_rate.toFixed(4)],
    ["SP 800-22 pass rate", d.sp800_22.pass_rate.toFixed(4)],
  ].map(([label, value]) => `<div class="stat-tile"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`).join("");

  const estCols = ["hOriginal", "mcvEstimateMode", "mcvEstimatePHat", "mcvEstimatePU", "tTupleRes", "lrsRes"];
  const estRows = Object.entries(d.min_entropy.estimators);
  estEl.innerHTML =
    `<thead><tr><th>Estimator</th>${estCols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>` +
    `<tbody>${estRows.map(([name, vals]) =>
      `<tr><td class="text-cell">${escapeHtml(name)}</td>${estCols.map((c) => `<td>${vals[c] != null ? formatCell(vals[c]) : "—"}</td>`).join("")}</tr>`
    ).join("")}</tbody>`;

  let subRows = d.sp800_22.sub_tests;
  if (state.subtestSearch) {
    subRows = subRows.filter((t) => t.test_name.toLowerCase().includes(state.subtestSearch));
  }
  subEl.innerHTML =
    `<thead><tr><th>Test</th><th>Uniformity p-value</th><th>Passed</th><th>Result</th></tr></thead>` +
    `<tbody>${subRows.map((t) =>
      `<tr><td class="text-cell">${escapeHtml(t.test_name)}</td>` +
      `<td>${t.uniformity_p_value != null ? t.uniformity_p_value.toFixed(4) : "—"}</td>` +
      `<td>${t.num_passed}/${t.num_total}</td>` +
      `<td><span class="badge ${t.passed ? "pass" : "fail"}">${t.passed ? "Pass" : "Fail"}</span></td></tr>`
    ).join("")}</tbody>`;
}

/* ---------------------------------------------------------------------
   Shared helpers: css var reads, color interpolation, percentiles
   --------------------------------------------------------------------- */

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function interpolateColor(hexA, hexB, t) {
  const tt = Math.max(0, Math.min(1, t));
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * tt));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function percentile(sortedValues, p) {
  const n = sortedValues.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedValues[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

function ensureHatchPattern(svg) {
  const defs = svgEl("defs", {});
  const pattern = svgEl("pattern", {
    id: "hatch-pattern", width: 6, height: 6, patternTransform: "rotate(45)", patternUnits: "userSpaceOnUse",
  });
  pattern.appendChild(svgEl("rect", { width: 6, height: 6, fill: "var(--page)" }));
  pattern.appendChild(svgEl("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--border-strong)", "stroke-width": 2 }));
  defs.appendChild(pattern);
  svg.appendChild(defs);
}

/* ---------------------------------------------------------------------
   Temperature/voltage trend — one line per voltage, mean entropy across
   whichever sensors are in view
   --------------------------------------------------------------------- */

function renderTempVoltageChart(rows) {
  const container = document.getElementById("chart-tempvoltage");
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No data for the current filters.</div>';
    return;
  }

  const temps = uniqueSorted(rows, "Temp (C)");
  const voltages = uniqueSorted(rows, "Voltage (V)");
  const voltColorSlots = ["var(--series-volt-1)", "var(--series-volt-2)", "var(--series-a)", "var(--series-b)"];
  const voltColor = {};
  voltages.forEach((v, i) => { voltColor[v] = voltColorSlots[i % voltColorSlots.length]; });

  const values = rows.map((r) => r["Min-Entropy (bits/bit)"]);
  const yMin = Math.min(...values), yMax = Math.max(...values);
  const yPad = (yMax - yMin) * 0.15 || 0.01;
  const yDomain = [yMin - yPad, yMax + yPad];

  const width = 620, height = 300;
  const margin = { top: 12, right: 16, bottom: 36, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(temps, [0, plotW]);
  const y = linearScale(yDomain, [plotH, 0]);

  niceTicks(yDomain[1], 5).filter((t) => t >= yDomain[0] && t <= yDomain[1]).forEach((t) => {
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = t.toFixed(3);
    g.appendChild(label);
  });
  g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: plotH, y2: plotH }));
  temps.forEach((t) => {
    const label = svgEl("text", { class: "axis-label", x: x(t), y: plotH + 20, "text-anchor": "middle" });
    label.textContent = `${t}°C`;
    g.appendChild(label);
  });

  voltages.forEach((voltage) => {
    const voltRows = rows.filter((r) => String(r["Voltage (V)"]) === voltage);
    const pts = temps
      .filter((t) => voltRows.some((r) => String(r["Temp (C)"]) === t))
      .map((t) => ({ temp: t, value: mean(voltRows.filter((r) => String(r["Temp (C)"]) === t), "Min-Entropy (bits/bit)") }));
    if (!pts.length) return;
    const color = voltColor[voltage];
    const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.temp)} ${y(p.value)}`).join(" ");
    g.appendChild(svgEl("path", { class: "mark-line", d, stroke: color }));
    pts.forEach((p) => {
      const cx = x(p.temp), cy = y(p.value);
      g.appendChild(svgEl("circle", { class: "mark-dot", cx, cy, r: 4, fill: color }));
      const hit = svgEl("circle", { class: "hit-target", cx, cy, r: 12 });
      hit.addEventListener("pointerenter", (e) => {
        showTooltip(e.clientX, e.clientY,
          `<div class="tt-title">${escapeHtml(voltage)}V — ${escapeHtml(p.temp)}°C</div>` +
          `<div class="tt-row"><span class="tt-key" style="background:${color}"></span>Mean min-entropy<span class="tt-value">${p.value.toFixed(4)}</span></div>`);
      });
      hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
      hit.addEventListener("pointerleave", hideTooltip);
      g.appendChild(hit);
    });
  });

  container.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "legend";
  voltages.forEach((v) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.innerHTML = `<span class="legend-swatch" style="background:${voltColor[v]}"></span>${escapeHtml(v)} V`;
    legend.appendChild(item);
  });
  container.appendChild(legend);
}

/* ---------------------------------------------------------------------
   Raw vs Von Neumann-processed entropy — RQ4. SP 800-90B only runs on the
   raw bitstream by design (see modules/nist_90b.py / report_export.py's
   RQ4 note), so this chart is data-ready but shows an explanatory empty
   state until a conditioned-mode assessment is added to the pipeline.
   --------------------------------------------------------------------- */

const PROCESSED_ENTROPY_FIELD = "VN Min-Entropy (bits/bit)";

function renderRawVsProcessedChart(rows) {
  const container = document.getElementById("chart-raw-vs-processed");
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No data for the current filters.</div>';
    return;
  }

  const hasProcessed = rows.some((r) => r[PROCESSED_ENTROPY_FIELD] != null && !Number.isNaN(r[PROCESSED_ENTROPY_FIELD]));
  if (!hasProcessed) {
    container.innerHTML =
      '<div class="pending-note">Post-debiasing min-entropy isn’t computed by this pipeline yet — ' +
      'SP 800-90B intentionally runs only on the <strong>raw</strong> bitstream by design (see the RQ4 note in ' +
      '<code>modules/report_export.py</code>), since that’s what min-entropy estimation is meant to characterize. ' +
      'To populate this chart: extend <code>modules/nist_90b.py</code> with a conditioned-mode ' +
      '(<code>ea_non_iid -c</code>) run on the Von Neumann output, store it as a ' +
      '<code>' + escapeHtml(PROCESSED_ENTROPY_FIELD) + '</code> column in summary.csv, and re-run the pipeline — ' +
      'this chart will render automatically once that column exists. Until then, see the min-entropy chart above ' +
      'and the retention/pass-rate figures for what Von Neumann debiasing does to the bitstream.</div>';
    return;
  }

  const bySensor = groupBy(rows, "Sensor");
  const sensors = Object.keys(bySensor).sort();
  const width = Math.max(560, sensors.length * 80);
  const height = 300;
  const margin = { top: 12, right: 16, bottom: 40, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const rawVals = sensors.map((s) => mean(bySensor[s], "Min-Entropy (bits/bit)"));
  const procVals = sensors.map((s) => mean(bySensor[s], PROCESSED_ENTROPY_FIELD));
  const yMax = Math.max(...niceTicks(Math.max(...rawVals, ...procVals), 4));

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(sensors, [0, plotW]);
  const y = linearScale([0, yMax], [plotH, 0]);

  niceTicks(yMax, 5).forEach((t) => {
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = t.toFixed(3);
    g.appendChild(label);
  });
  g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: y(0), y2: y(0) }));

  const pairWidth = Math.min(40, x.step * 0.7);
  const barW = pairWidth / 2 - 1;
  sensors.forEach((s, i) => {
    const cx = x(s);
    [
      { value: rawVals[i], color: "var(--series-volt-1)", offset: -barW / 2 - 1 },
      { value: procVals[i], color: "var(--series-volt-2)", offset: barW / 2 + 1 },
    ].forEach((bar) => {
      const barH = Math.max(0, y(0) - y(bar.value));
      g.appendChild(svgEl("rect", {
        class: "mark-bar", x: cx + bar.offset - barW / 2, y: y(bar.value), width: barW, height: barH, rx: 3, fill: bar.color,
      }));
    });
    const label = svgEl("text", { class: "axis-label", x: cx, y: plotH + 20, "text-anchor": "middle" });
    label.textContent = s;
    g.appendChild(label);
  });

  container.appendChild(svg);
  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML =
    '<div class="legend-item"><span class="legend-swatch-rect" style="background:var(--series-volt-1)"></span>Raw</div>' +
    '<div class="legend-item"><span class="legend-swatch-rect" style="background:var(--series-volt-2)"></span>VN-processed</div>';
  container.appendChild(legend);
}

/* ---------------------------------------------------------------------
   SP 800-22 pass rate heatmap — every sensor x every standard condition,
   fixed 0-1 color scale (sequential, single hue, light -> dark)
   --------------------------------------------------------------------- */

const HEATMAP_CONDITIONS = [
  { temp: "0", voltage: "3.3" }, { temp: "0", voltage: "5" },
  { temp: "24", voltage: "3.3" }, { temp: "24", voltage: "5" },
  { temp: "40", voltage: "3.3" }, { temp: "40", voltage: "5" },
];

// Fixed (non-adaptive — same value always maps to the same color, never
// re-ranged per render) but zoomed into where SP 800-22 pass rates actually
// live, since a literal 0-100% scale makes every real-world value land in
// the same dark few percent and become visually indistinguishable. Values
// below the floor still clamp to the lightest step, not off-scale.
const HEATMAP_COLOR_DOMAIN = [0.85, 1.0];

function renderHeatmap(rows) {
  const container = document.getElementById("chart-heatmap");
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No data for the current filters.</div>';
    return;
  }

  const bySensorAll = groupBy(rows, "Sensor");
  const sensors = Object.keys(bySensorAll).sort((a, b) => {
    const va = String(bySensorAll[a][0].Variant), vb = String(bySensorAll[b][0].Variant);
    return va.localeCompare(vb) || a.localeCompare(b, undefined, { numeric: true });
  });

  const cellW = 76, cellH = 26, labelW = 56, headerH = 46;
  const width = labelW + HEATMAP_CONDITIONS.length * cellW;
  const height = headerH + sensors.length * cellH;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  ensureHatchPattern(svg);

  HEATMAP_CONDITIONS.forEach((c, ci) => {
    const tempLabel = svgEl("text", { class: "heatmap-label", x: labelW + ci * cellW + cellW / 2, y: headerH - 26, "text-anchor": "middle" });
    tempLabel.textContent = `${c.temp}°C`;
    svg.appendChild(tempLabel);
    const voltLabel = svgEl("text", { class: "heatmap-label", x: labelW + ci * cellW + cellW / 2, y: headerH - 10, "text-anchor": "middle" });
    voltLabel.textContent = `${c.voltage}V`;
    svg.appendChild(voltLabel);
  });

  const seqLow = cssVar("--seq-100", "#cde2fb");
  const seqHigh = cssVar("--seq-700", "#0d366b");

  sensors.forEach((sensor, si) => {
    const sensorRows = bySensorAll[sensor];
    const variant = sensorRows[0].Variant;
    const rowY = headerH + si * cellH;

    const rowLabel = svgEl("text", {
      class: "heatmap-label", x: labelW - 8, y: rowY + cellH / 2 + 3, "text-anchor": "end", fill: VARIANT_COLOR[variant] || "var(--ink-muted)",
    });
    rowLabel.textContent = sensor;
    svg.appendChild(rowLabel);

    HEATMAP_CONDITIONS.forEach((c, ci) => {
      const cellX = labelW + ci * cellW;
      const match = sensorRows.find((r) => String(r["Temp (C)"]) === c.temp && String(r["Voltage (V)"]) === c.voltage);
      const [domainLo, domainHi] = HEATMAP_COLOR_DOMAIN;
      const t = match ? (match["SP 800-22 Pass Rate"] - domainLo) / (domainHi - domainLo) : 0;
      const rect = svgEl("rect", {
        class: "heatmap-cell" + (match ? "" : " no-data"),
        x: cellX, y: rowY, width: cellW, height: cellH,
        fill: match ? interpolateColor(seqLow, seqHigh, t) : "url(#hatch-pattern)",
      });
      svg.appendChild(rect);

      const hit = svgEl("rect", { class: "hit-target", x: cellX, y: rowY, width: cellW, height: cellH });
      hit.addEventListener("pointerenter", (e) => {
        showTooltip(e.clientX, e.clientY,
          `<div class="tt-title">${escapeHtml(sensor)} — ${c.temp}°C / ${c.voltage}V</div>` +
          (match
            ? `<div class="tt-row">SP 800-22 pass rate<span class="tt-value">${(match["SP 800-22 Pass Rate"] * 100).toFixed(2)}%</span></div>`
            : '<div class="tt-row">No data recorded yet</div>'));
      });
      hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
      hit.addEventListener("pointerleave", hideTooltip);
      svg.appendChild(hit);
    });
  });

  container.appendChild(svg);

  const legendWrap = document.createElement("div");
  legendWrap.className = "heatmap-legend";
  legendWrap.innerHTML =
    `<span>${Math.round(HEATMAP_COLOR_DOMAIN[0] * 100)}% or below</span><span class="heatmap-ramp"></span><span>${Math.round(HEATMAP_COLOR_DOMAIN[1] * 100)}%</span>` +
    '<span style="margin-left:1rem;display:inline-flex;align-items:center;gap:0.4rem;">' +
    '<span class="legend-swatch-hatch"></span>No data</span>';
  container.appendChild(legendWrap);
}

/* ---------------------------------------------------------------------
   Box plot — min-entropy distribution per variant group
   --------------------------------------------------------------------- */

function renderBoxPlot(rows) {
  const container = document.getElementById("chart-boxplot");
  container.innerHTML = "";
  if (!rows.length) {
    container.innerHTML = '<div class="empty-state">No data for the current filters.</div>';
    return;
  }

  const variants = uniqueSorted(rows, "Variant");
  const groups = variants.map((v) => {
    const vals = rows.filter((r) => String(r.Variant) === v).map((r) => r["Min-Entropy (bits/bit)"]).sort((a, b) => a - b);
    return {
      variant: v, values: vals,
      min: vals[0], max: vals[vals.length - 1],
      q1: percentile(vals, 0.25), median: percentile(vals, 0.5), q3: percentile(vals, 0.75),
    };
  });

  const allVals = rows.map((r) => r["Min-Entropy (bits/bit)"]);
  const yMin = Math.min(...allVals), yMax = Math.max(...allVals);
  const yPad = (yMax - yMin) * 0.12 || 0.01;
  const yDomain = [yMin - yPad, yMax + yPad];

  const width = Math.max(420, groups.length * 180);
  const height = 320;
  const margin = { top: 12, right: 16, bottom: 36, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(groups.map((gr) => gr.variant), [0, plotW]);
  const y = linearScale(yDomain, [plotH, 0]);

  niceTicks(yDomain[1], 5).filter((t) => t >= yDomain[0] && t <= yDomain[1]).forEach((t) => {
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = t.toFixed(3);
    g.appendChild(label);
  });
  g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: plotH, y2: plotH }));

  const boxWidth = Math.min(64, x.step * 0.4);

  groups.forEach((gr) => {
    const cx = x(gr.variant);
    const color = VARIANT_COLOR[gr.variant] || "var(--ink-muted)";

    g.appendChild(svgEl("line", { class: "box-whisker", x1: cx, x2: cx, y1: y(gr.min), y2: y(gr.max) }));
    [gr.min, gr.max].forEach((v) => {
      g.appendChild(svgEl("line", { class: "box-cap", x1: cx - boxWidth / 4, x2: cx + boxWidth / 4, y1: y(v), y2: y(v) }));
    });

    g.appendChild(svgEl("rect", {
      class: "box-rect", x: cx - boxWidth / 2, y: y(gr.q3), width: boxWidth, height: Math.max(1, y(gr.q1) - y(gr.q3)),
      fill: color, "fill-opacity": 0.18, stroke: color, rx: 3,
    }));

    g.appendChild(svgEl("line", {
      class: "box-median", x1: cx - boxWidth / 2, x2: cx + boxWidth / 2, y1: y(gr.median), y2: y(gr.median), stroke: color,
    }));

    gr.values.forEach((v, i) => {
      const jitter = (((i % 9) - 4) / 4) * (boxWidth * 0.32);
      g.appendChild(svgEl("circle", { class: "box-jitter", cx: cx + jitter, cy: y(v), r: 2.5, fill: color }));
    });

    const hit = svgEl("rect", { class: "hit-target", x: cx - Math.max(boxWidth, 40) / 2, y: 0, width: Math.max(boxWidth, 40), height: plotH });
    hit.addEventListener("pointerenter", (e) => {
      showTooltip(e.clientX, e.clientY,
        `<div class="tt-title">Variant ${escapeHtml(gr.variant)} (n=${gr.values.length})</div>` +
        `<div class="tt-row">Median<span class="tt-value">${gr.median.toFixed(4)}</span></div>` +
        `<div class="tt-row">Q1 – Q3<span class="tt-value">${gr.q1.toFixed(4)} – ${gr.q3.toFixed(4)}</span></div>` +
        `<div class="tt-row">Min – Max<span class="tt-value">${gr.min.toFixed(4)} – ${gr.max.toFixed(4)}</span></div>`);
    });
    hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
    hit.addEventListener("pointerleave", hideTooltip);
    g.appendChild(hit);

    const label = svgEl("text", { class: "axis-label", x: cx, y: plotH + 20, "text-anchor": "middle" });
    label.textContent = `Variant ${gr.variant}`;
    g.appendChild(label);
  });

  container.appendChild(svg);
}

/* ---------------------------------------------------------------------
   Head-to-head vs Ayyada's MCP3008 results, per variant. Raw (pre-VN)
   min-entropy, matching what this dashboard's own entropy chart measures
   (SP 800-90B is only run on the raw bitstream here — see the RQ4 note in
   the raw-vs-processed chart above). Mean across his 3 sensors x 2 voltages
   per variant, extracted from Table 6.1 of his thesis — see
   reference/ayyada_thesis_results.csv for the full per-sensor breakdown and
   reference/README.md for provenance/methodology notes.
   --------------------------------------------------------------------- */

const AYYADA_REFERENCE = {
  A: { raw: 0.2090 }, B: { raw: 0.2680 }, C: { raw: 0.4538 },
};

// His thesis states the climate chamber "was typically maintained at
// approximately 24C during the measurements" for the entire TRNG dataset —
// his numbers are single-temperature. Comparing them against our 0C/40C
// rows would be misleading, so this chart always restricts to our 24C rows
// regardless of the global temperature filter above.
const AYYADA_TEMPERATURE_C = "24";

function renderAyyadaChart(allRows) {
  const container = document.getElementById("chart-ayyada");
  container.innerHTML = "";

  const rows = allRows.filter((r) => String(r["Temp (C)"]) === AYYADA_TEMPERATURE_C);
  if (!rows.length) {
    container.innerHTML =
      '<div class="empty-state">No 24°C data in the current filter — Ayyada\'s thesis only tested at ' +
      '24°C, so this comparison isn\'t meaningful for other temperatures. Clear the temperature filter ' +
      'or select 24°C to see it.</div>';
    return;
  }

  const variants = uniqueSorted(rows, "Variant");
  const ours = variants.map((v) => ({
    variant: v,
    value: mean(rows.filter((r) => String(r.Variant) === v), "Min-Entropy (bits/bit)"),
  }));
  const hasAyyada = variants.some((v) => AYYADA_REFERENCE[v] && AYYADA_REFERENCE[v].raw != null);

  const width = Math.max(420, variants.length * 200);
  const height = 300;
  const margin = { top: 12, right: 16, bottom: 40, left: 52 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const dataMax = Math.max(...ours.map((o) => o.value), ...variants.map((v) => (AYYADA_REFERENCE[v]?.raw) || 0));
  const yMax = Math.max(...niceTicks(dataMax, 4));

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(variants, [0, plotW]);
  const y = linearScale([0, yMax], [plotH, 0]);

  niceTicks(yMax, 5).forEach((t) => {
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = t.toFixed(3);
    g.appendChild(label);
  });
  g.appendChild(svgEl("line", { class: "baseline", x1: 0, x2: plotW, y1: y(0), y2: y(0) }));

  const pairW = Math.min(70, x.step * 0.6);
  const barW = pairW / 2 - 2;

  variants.forEach((v) => {
    const cx = x(v);
    const ourValue = ours.find((o) => o.variant === v).value;
    const ayyadaValue = AYYADA_REFERENCE[v]?.raw;
    const color = VARIANT_COLOR[v] || "var(--ink-muted)";

    const ourH = Math.max(0, y(0) - y(ourValue));
    g.appendChild(svgEl("rect", { class: "mark-bar", x: cx - barW - 1, y: y(ourValue), width: barW, height: ourH, rx: 3, fill: color }));

    if (ayyadaValue != null) {
      const ayyH = Math.max(0, y(0) - y(ayyadaValue));
      g.appendChild(svgEl("rect", {
        class: "mark-bar", x: cx + 1, y: y(ayyadaValue), width: barW, height: ayyH, rx: 3, fill: color, "fill-opacity": 0.45,
      }));
    } else {
      g.appendChild(svgEl("rect", { class: "mark-bar pending", x: cx + 1, y: margin.top, width: barW, height: plotH - margin.top, rx: 3 }));
    }

    const label = svgEl("text", { class: "axis-label", x: cx, y: plotH + 20, "text-anchor": "middle" });
    label.textContent = `Variant ${v}`;
    g.appendChild(label);

    const hit = svgEl("rect", { class: "hit-target", x: cx - pairW / 2, y: 0, width: pairW, height: plotH });
    hit.addEventListener("pointerenter", (e) => {
      showTooltip(e.clientX, e.clientY,
        `<div class="tt-title">Variant ${escapeHtml(v)}</div>` +
        `<div class="tt-row"><span class="tt-key" style="background:${color}"></span>This study (ADS1115)<span class="tt-value">${ourValue.toFixed(4)}</span></div>` +
        (ayyadaValue != null
          ? `<div class="tt-row"><span class="tt-key" style="background:${color};opacity:.45"></span>Ayyada (MCP3008)<span class="tt-value">${ayyadaValue.toFixed(4)}</span></div>`
          : '<div class="tt-row">Ayyada (MCP3008)<span class="tt-value">pending</span></div>'));
    });
    hit.addEventListener("pointermove", (e) => showTooltip(e.clientX, e.clientY, document.getElementById("tooltip").innerHTML));
    hit.addEventListener("pointerleave", hideTooltip);
    g.appendChild(hit);
  });

  container.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML =
    '<div class="legend-item"><span class="legend-swatch-rect" style="background:var(--series-a)"></span>This study (ADS1115)</div>' +
    (hasAyyada
      ? '<div class="legend-item"><span class="legend-swatch-rect" style="background:var(--series-a);opacity:.45"></span>Ayyada (MCP3008)</div>'
      : '<div class="legend-item"><span class="legend-swatch-hatch"></span>Ayyada (MCP3008) — not yet available</div>');
  container.appendChild(legend);

  if (!hasAyyada) {
    const note = document.createElement("p");
    note.className = "card-sub";
    note.style.marginTop = "0.75rem";
    note.innerHTML =
      'Ayyada’s published per-variant min-entropy figures aren’t transcribed into the dashboard yet — his ' +
      'summary gives an overall range (~0.83–0.91 bits/bit after Von Neumann) but not broken out by A/B/C. Add ' +
      'them to the <code>AYYADA_REFERENCE</code> object in docs/app.js once available.';
    container.appendChild(note);
  }
}
