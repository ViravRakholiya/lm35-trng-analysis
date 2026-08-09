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

function renderAll() {
  renderFilterPills();
  const rows = filteredRows();
  renderStatTiles(rows);
  renderEntropyChart(rows);
  renderBarChart(rows, "VN Retention Rate", "chart-retention", "Mean VN Retention Rate", [0, null]);
  renderBarChart(rows, "SP 800-22 Pass Rate", "chart-passrate", "Mean SP 800-22 Pass Rate", [0, 1]);
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
  const step = n > 1 ? (r1 - r0) / (n - 1) : 0;
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

function renderBarChart(rows, field, containerId, yLabel, yDomainOverride) {
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

  const dataMax = Math.max(...bars.map((b) => b.value));
  const yMax = yDomainOverride && yDomainOverride[1] != null ? yDomainOverride[1] : Math.max(...niceTicks(dataMax, 4));
  const yMin = yDomainOverride && yDomainOverride[0] != null ? yDomainOverride[0] : 0;

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${height}` });
  const g = svgEl("g", { transform: `translate(${margin.left},${margin.top})` });
  svg.appendChild(g);

  const x = pointScale(bars.map((b) => b.sensor), [0, plotW]);
  const y = linearScale([yMin, yMax], [plotH, 0]);

  niceTicks(yMax, 5).forEach((t) => {
    if (t < yMin || t > yMax) return;
    g.appendChild(svgEl("line", { class: "gridline", x1: 0, x2: plotW, y1: y(t), y2: y(t) }));
    const label = svgEl("text", { class: "axis-label", x: -8, y: y(t) + 3, "text-anchor": "end" });
    label.textContent = t.toFixed(2);
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
        `<div class="tt-row"><span class="tt-key" style="background:${color}"></span>${escapeHtml(yLabel)}<span class="tt-value">${b.value.toFixed(4)}</span></div>`);
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
