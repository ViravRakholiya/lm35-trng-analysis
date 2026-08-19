"use strict";

/* ---------------------------------------------------------------------
   Raw data preview page. Loads docs/data/raw_preview.json (built by
   `python3 -m modules.raw_preview`, which reads only the first few rows
   of every source CSV) and renders a table of the first N readings for
   every sensor at one temperature/voltage condition at a time -- a quick
   eyeball check that the collected data looks sane, independent of the
   entropy pipeline.
   --------------------------------------------------------------------- */

const METRICS = [
  { id: "Raw_ADC", label: "Raw ADC", format: (v) => String(v) },
  { id: "Voltage_mV", label: "Voltage (mV)", format: (v) => v.toFixed(4) },
  { id: "Temperature_C", label: "Temperature (°C)", format: (v) => v.toFixed(2) },
];
const ROW_COUNT_OPTIONS = [3, 5, 10];

const state = {
  data: null,
  temp: null,
  voltage: null,
  metric: METRICS[0].id,
  rowCount: 5,
  search: "",
};

function conditionKey(temp, voltage) {
  return `${temp}_${voltage}`;
}

async function boot() {
  let data;
  try {
    const res = await fetch("data/raw_preview.json");
    if (!res.ok) throw new Error("not found");
    data = await res.json();
  } catch (e) {
    document.querySelector("main").innerHTML =
      '<div class="table-card"><p class="empty-state">No raw_preview.json yet. Run <code>python3 -m modules.raw_preview</code> and push docs/data/raw_preview.json.</p></div>';
    return;
  }

  state.data = data;
  state.rowCount = Math.min(state.rowCount, data.num_preview_rows);
  const temps = [...new Set(data.conditions.map((c) => c.temp))];
  const voltages = [...new Set(data.conditions.map((c) => String(c.voltage)))];
  state.temp = temps[0];
  state.voltage = voltages[0];

  buildPillGroup("filter-temp", temps, (t) => t === state.temp, (t) => {
    state.temp = t;
    renderAll();
  }, (t) => `${t}°C`);
  buildPillGroup("filter-voltage", voltages, (v) => v === state.voltage, (v) => {
    state.voltage = v;
    renderAll();
  }, (v) => `${v}V`);
  buildPillGroup("filter-metric", METRICS.map((m) => m.id), (m) => m === state.metric, (m) => {
    state.metric = m;
    renderAll();
  }, (m) => METRICS.find((x) => x.id === m).label);
  buildPillGroup("filter-rowcount", ROW_COUNT_OPTIONS, (n) => n === state.rowCount, (n) => {
    state.rowCount = n;
    renderAll();
  }, (n) => String(n));

  document.getElementById("table-search").addEventListener("input", (e) => {
    state.search = e.target.value.trim().toLowerCase();
    renderAll();
  });

  renderAll();
}

function buildPillGroup(containerId, values, isActive, onChange, formatLabel) {
  const el = document.getElementById(containerId);
  el.innerHTML = "";
  values.forEach((v) => {
    const btn = document.createElement("button");
    btn.className = "pill" + (isActive(v) ? " active" : "");
    btn.textContent = formatLabel(v);
    btn.addEventListener("click", () => onChange(v));
    el.appendChild(btn);
  });
}

function renderAll() {
  const data = state.data;
  const key = conditionKey(state.temp, state.voltage);
  const sensors = data.sensors.filter((s) => !state.search || s.toLowerCase().includes(state.search));

  const present = sensors.filter((s) => data.files[s] && data.files[s][key]);
  renderStatTiles(sensors.length, present.length, key);
  renderTable(sensors, key);
  renderExpectedNote(present.length, sensors.length, key);

  // Refresh pill active states without rebuilding search/rowcount handlers.
  [...document.querySelectorAll("#filter-temp .pill")].forEach((btn, i) => {
    const temps = [...new Set(data.conditions.map((c) => c.temp))];
    btn.classList.toggle("active", temps[i] === state.temp);
  });
  [...document.querySelectorAll("#filter-voltage .pill")].forEach((btn, i) => {
    const voltages = [...new Set(data.conditions.map((c) => String(c.voltage)))];
    btn.classList.toggle("active", voltages[i] === state.voltage);
  });
  [...document.querySelectorAll("#filter-metric .pill")].forEach((btn, i) => {
    btn.classList.toggle("active", METRICS[i].id === state.metric);
  });
  [...document.querySelectorAll("#filter-rowcount .pill")].forEach((btn, i) => {
    btn.classList.toggle("active", ROW_COUNT_OPTIONS[i] === state.rowCount);
  });

  const metricLabel = METRICS.find((m) => m.id === state.metric).label;
  document.getElementById("table-title").textContent =
    `${metricLabel} — ${state.temp}°C @ ${state.voltage}V`;
  document.getElementById("table-sub").textContent =
    `First ${state.rowCount} of ${data.num_preview_rows} previewed samples per sensor, straight from each source CSV (row order preserved)`;
}

function renderStatTiles(total, present, key) {
  const tiles = [
    { label: "Sensors with this condition", value: `${present} / ${total}` },
    { label: "Condition", value: `${state.temp}°C @ ${state.voltage}V` },
    { label: "Preview depth", value: `${state.data.num_preview_rows} rows/file` },
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

function renderExpectedNote(present, total, key) {
  const el = document.getElementById("expected-note");
  if (present === total) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML =
    `<strong>${total - present} sensor(s)</strong> have no CSV on record yet for ${state.temp}°C @ ${state.voltage}V ` +
    `(shown as — below). Data collection for the full 19-sensor × 6-condition matrix is still ongoing.`;
}

function metricDef() {
  return METRICS.find((m) => m.id === state.metric);
}

function renderTable(sensors, key) {
  const table = document.getElementById("preview-table");
  const data = state.data;
  const metric = metricDef();
  const n = state.rowCount;

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  ["Sensor", "Group", "File size (MB)"].forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h;
    headRow.appendChild(th);
  });
  for (let i = 0; i < n; i++) {
    const th = document.createElement("th");
    th.textContent = `#${i}`;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  if (!sensors.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.className = "empty-cell";
    td.colSpan = 3 + n;
    td.textContent = "No sensors match the search.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  sensors.forEach((sensor) => {
    const file = data.files[sensor] && data.files[sensor][key];
    const tr = document.createElement("tr");
    if (!file) tr.className = "pending-row";

    const variant = data.variants[sensor];
    const sensorTd = document.createElement("td");
    sensorTd.className = "text-cell";
    sensorTd.textContent = sensor;
    tr.appendChild(sensorTd);

    const groupTd = document.createElement("td");
    groupTd.innerHTML = `<span class="legend-swatch-rect" style="display:inline-block;background:${VARIANT_COLOR[variant] || "var(--ink-muted)"};border-radius:3px;margin-right:0.4rem;vertical-align:middle;"></span>${escapeHtml(variant)}`;
    tr.appendChild(groupTd);

    const sizeTd = document.createElement("td");
    sizeTd.textContent = file ? file.file_size_mb.toFixed(1) : "—";
    tr.appendChild(sizeTd);

    for (let i = 0; i < n; i++) {
      const td = document.createElement("td");
      if (file && file.rows[i] != null) {
        td.textContent = metric.format(file.rows[i][metric.id]);
      } else {
        td.textContent = "—";
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  table.innerHTML = "";
  table.appendChild(thead);
  table.appendChild(tbody);
}

boot();
