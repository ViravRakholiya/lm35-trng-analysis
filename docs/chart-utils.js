"use strict";

/* ---------------------------------------------------------------------
   Shared helpers used by both the main dashboard (app.js) and the bit
   position comparison page (compare.js) — CSV parsing, SVG chart primitives, and
   small data-shaping utilities. Load this before either page script.
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

const VARIANT_COLOR = { A: "var(--series-a)", B: "var(--series-b)", C: "var(--series-c)" };

function mean(rows, key) {
  const vals = rows.map((r) => Number(r[key])).filter((v) => !Number.isNaN(v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

function groupBy(rows, key) {
  return rows.reduce((acc, r) => {
    const k = r[key];
    (acc[k] = acc[k] || []).push(r);
    return acc;
  }, {});
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
