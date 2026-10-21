// Page logic for The Prosperity Gap: reads data.json (built by build.py) and
// draws the headline, the two national charts and the provinces-vs-states
// ranking. All figures come from data.json; nothing here is hard-coded.

const $ = (id) => document.getElementById(id);
const SVG = "http://www.w3.org/2000/svg";
let data;

// --- formatting ---

const usd = (v) => `US$${Math.round(v).toLocaleString("en-CA")}`;
const pct0 = (x) => `${Math.round(x * 100)}%`;
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
const round500 = (v) => Math.round(v / 500) * 500;
// Names and titles come from remote sources; escape them before using innerHTML.
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const list = (xs) => xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

// --- headline ---

function renderHeadline() {
  const n = data.national;
  const i = n.years.length - 1;
  const year = n.years[i];
  const share = (k) => n.canada[k] / n.us[k];
  const at = (y) => n.years.indexOf(y);

  $("cents").textContent = `${Math.round(share(i) * 100)}¢`;
  $("per-dollar").textContent = `for every dollar of GDP per person in the United States, ${year}`;

  const past = [2000, 1980].filter((y) => at(y) >= 0);
  const allLower = past.every((y) => share(i) < share(at(y)));
  const then = past.map((y) => `${pct0(share(at(y)))} in ${y}`).join(" and ");
  $("trend-line").innerHTML = `Canada's GDP per person was <strong>${pct0(share(i))} of the US level</strong> in ${year}${then ? `, ${allLower ? "down from" : "compared with"} ${then}` : ""}.`;

  const gapCad = round500((n.us[i] - n.canada[i]) * n.ppp[year]);
  $("gap-line").innerHTML = gapCad > 0
    ? `Closing the gap in ${year} would have meant about <strong>C$${gapCad.toLocaleString("en-CA")} more output</strong> per Canadian, at Canadian prices.`
    : "";
  const est = (n.latest_estimated || []).map((a) => (a === "USA" ? "US" : "Canadian"));
  $("estimate-note").textContent = est.length
    ? ` · ${year} ${list(est)} figure${est.length > 1 ? "s are OECD estimates" : " is an OECD estimate"}` : "";
  $("estimate-method").textContent = est.length
    ? ` (the ${year} ${list(est)} figure${est.length > 1 ? "s are" : " is"} one)` : "";
  $("caveat").hidden = false;
  $("details").hidden = false;
}

// --- charts: shared pieces ---

function el(name, attrs = {}, text) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text !== undefined) e.textContent = text;
  return e;
}

function niceTicks(min, max, n = 4) {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
  if (ticks[ticks.length - 1] < max) ticks.push(+(ticks[ticks.length - 1] + step).toFixed(10));
  return ticks;
}

function showTip(html, x, y) {
  const tip = $("tooltip");
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(x + 14, innerWidth - w - 8)}px`;
  tip.style.top = `${Math.max(8, y - h - 12)}px`;
}
const hideTip = () => { $("tooltip").hidden = true; };

const chartWidth = (id) => Math.max(300, Math.round($(id).clientWidth || 640));

// A line chart over years with a crosshair: series = [{key, values, colour, label}].
function lineChart(id, years, series, { format, ticksFormat, tip, endLabels = true, yMin, shadeFrom }) {
  const W = chartWidth(id), H = 260, top = 12, bottom = 26, left = 46;
  const right = endLabels ? 74 : 12;
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  const ticks = niceTicks(yMin ?? Math.min(...all), Math.max(...all), 4);
  const [min, max] = [ticks[0], ticks[ticks.length - 1]];
  const x = (i) => left + (i / (years.length - 1)) * (W - left - right);
  const y = (v) => top + (1 - (v - min) / (max - min)) * (H - top - bottom);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": series.map((s) => s.label).join(" and ") });

  ticks.forEach((t) => {
    svg.appendChild(el("line", { x1: left, x2: W - right, y1: y(t), y2: y(t), stroke: "var(--grid)" }));
    svg.appendChild(el("text", { x: left - 8, y: y(t) + 4, "text-anchor": "end", "font-size": 11 }, ticksFormat(t)));
  });
  // Year labels: wider spacing on narrow charts so they never touch.
  const perLabel = (W - left - right) / years.length;
  const step = [2, 5, 10, 20, 25].find((k) => k * perLabel >= 44) ?? 25;
  years.forEach((yr, i) => {
    if (yr % step === 0 || i === years.length - 1 && yr % step > step / 2) {
      svg.appendChild(el("text", { x: x(i), y: H - 8, "text-anchor": "middle", "font-size": 11 }, yr));
    }
  });
  // Years after shadeFrom are a scenario, not data: shade them.
  if (shadeFrom != null && shadeFrom < years.length - 1) {
    svg.appendChild(el("rect", { x: x(shadeFrom), y: top, width: x(years.length - 1) - x(shadeFrom), height: H - top - bottom,
      style: "fill: var(--accent-bg)", opacity: 0.6 }));
    svg.appendChild(el("text", { x: x(shadeFrom) + 6, y: top + 13, "font-size": 11, class: "muted-label" }, "Scenario"));
  }
  // End labels sit at each series' last value, nudged apart when two finish close together.
  const lastOf = (s) => s.values.reduce((a, v, i) => (v == null ? a : i), -1);
  const labelled = series.filter((s) => endLabels && s.endLabel !== false);
  const labelY = labelled.map((s) => y(s.values[lastOf(s)]));
  if (labelY.length === 2 && Math.abs(labelY[0] - labelY[1]) < 15) {
    const mid = (labelY[0] + labelY[1]) / 2, up = labelY[0] <= labelY[1] ? 0 : 1;
    labelY[up] = mid - 7.5; labelY[1 - up] = mid + 7.5;
  }
  series.forEach((s) => {
    let d = "", pen = false;
    s.values.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const dash = s.dotted ? { "stroke-dasharray": "1 5", "stroke-linecap": "round", "stroke-width": 3 } : s.dashed ? { "stroke-dasharray": "5 4" } : {};
    svg.appendChild(el("path", { d, fill: "none", style: `stroke: var(${s.colour})`, "stroke-width": 2, "stroke-linejoin": "round", ...dash }));
    const li = lastOf(s);
    if (s.endLabel !== false) {
      svg.appendChild(el("circle", { cx: x(li), cy: y(s.values[li]), r: 4, style: `fill: var(${s.colour}); stroke: var(--paper)`, "stroke-width": 2 }));
    }
    const k = labelled.indexOf(s);
    if (k >= 0) {
      svg.appendChild(el("text", { x: x(li) + 8, y: labelY[k] + 4, "font-size": 12, class: "value" }, `${s.short ?? ""}${format(s.values[li])}`));
    }
  });
  // Crosshair and tooltip.
  const cross = el("line", { y1: top, y2: H - bottom, stroke: "var(--ink-faint)", "stroke-width": 1, visibility: "hidden" });
  const dots = series.map((s) => el("circle", { r: 4, style: `fill: var(${s.colour}); stroke: var(--paper)`, "stroke-width": 2, visibility: "hidden" }));
  svg.appendChild(cross);
  dots.forEach((d) => svg.appendChild(d));
  const hit = el("rect", { x: left, y: top, width: W - left - right, height: H - top - bottom, class: "hit", tabindex: 0 });
  const move = (i, cx, cy) => {
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    dots.forEach((d, k) => {
      const v = series[k].values[i];
      d.setAttribute("visibility", v == null ? "hidden" : "visible");
      if (v != null) { d.setAttribute("cx", x(i)); d.setAttribute("cy", y(v)); }
    });
    showTip(tip(i), cx, cy);
  };
  const leave = () => { cross.setAttribute("visibility", "hidden"); dots.forEach((d) => d.setAttribute("visibility", "hidden")); hideTip(); };
  hit.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (W / r.width);
    const i = Math.max(0, Math.min(years.length - 1, Math.round(((px - left) / (W - left - right)) * (years.length - 1))));
    move(i, e.clientX, e.clientY);
  });
  hit.addEventListener("pointerleave", leave);
  let kb = years.length - 1;
  hit.addEventListener("focus", () => { const r = hit.getBoundingClientRect(); move(kb, r.right - 40, r.top + 20); });
  hit.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    kb = Math.max(0, Math.min(years.length - 1, kb + (e.key === "ArrowRight" ? 1 : -1)));
    const r = hit.getBoundingClientRect(); move(kb, r.left + (x(kb) - left) * (r.width / (W - left - right)), r.top + 20);
    e.preventDefault();
  });
  hit.addEventListener("blur", leave);
  svg.appendChild(hit);
  $(id).replaceChildren(svg);
}

// --- national charts ---

function drawShare() {
  const n = data.national;
  const share = n.years.map((_, i) => (n.canada[i] / n.us[i]) * 100);
  const constant = n.years.map((_, i) => (n.canada_volume[i] / n.us_volume[i]) * 100);
  // Extend the timeline to the scenario's target year.
  const sc = scenario();
  const B = n.years.length - 1;
  const future = Array.from({ length: sc.target - n.years[B] }, (_, k) => n.years[B] + k + 1);
  const years = [...n.years, ...future];
  const pad = (arr) => [...arr, ...future.map(() => null)];
  const path = [...n.years.map((_, i) => (i === B ? constant[B] : null)), ...future.map((y) => sc.shareAt(y) * 100)];
  lineChart("share-chart", years, [
    { values: pad(share), colour: "--canada", label: "At each year's prices", endLabel: false },
    { values: pad(constant), colour: "--ink-faint", label: "At constant 2020 prices", dashed: true, endLabel: false },
    { values: path, colour: "--canada", label: "Scenario", dotted: true },
  ], {
    yMin: 50,
    shadeFrom: B,
    format: (v) => `${Math.round(v)}%`,
    ticksFormat: (t) => `${t}%`,
    tip: (i) => i <= B
      ? `<strong>${years[i]}</strong>At each year's prices: ${Math.round(share[i])}%<br>At constant 2020 prices: ${Math.round(constant[i])}%<br><span class="muted">${usd(n.canada[i])} vs ${usd(n.us[i])} per person</span>`
      : `<strong>${years[i]} (scenario)</strong>${Math.round(path[i])}% of the US<br><span class="muted">Canada ${pctg(sc.gc)}, US ${pctg(sc.gu)} a year</span>`,
  });
  const i = n.years.length - 1, i0 = n.years.indexOf(2000);
  $("share-caption").textContent = i0 >= 0
    ? `At constant 2020 prices, the better guide to the trend, Canada's share fell from ${Math.round(constant[i0])}% in 2000 to ${Math.round(constant[i])}% in ${n.years[i]}.`
    : "";
  $("share-legend").innerHTML = `<span><i class="swatch line" style="background:var(--canada)"></i>At each year's prices</span><span><i class="swatch line dashed"></i>At constant 2020 prices</span><span><i class="swatch line dotted"></i>Scenario</span>`;
  srTable("share-chart", ["Year", "At each year's prices", "At constant 2020 prices"],
    n.years.map((y, k) => [y, `${share[k].toFixed(1)}%`, `${constant[k].toFixed(1)}%`]));
}

// --- what would it take? ---
// Pure compounding on the OECD's constant-price GDP per person: the share in year
// t is today's share times ((1 + Canada's growth) / (1 + US growth)) ^ years.

const pctg = (g) => `${g < 0 ? "\u2212" : ""}${Math.abs(g * 100).toFixed(1)}%`;

function recentTrend(years = 10) {
  const n = data.national, B = n.years.length - 1;
  const rate = (arr) => (arr[B] / arr[B - years]) ** (1 / years) - 1;
  return { from: n.years[B - years], to: n.years[B], gc: rate(n.canada_volume), gu: rate(n.us_volume) };
}

function scenario() {
  const n = data.national, B = n.years.length - 1;
  const gc = Number($("g-ca").value) / 100, gu = Number($("g-us").value) / 100, target = Number($("target").value);
  const s0 = n.canada_volume[B] / n.us_volume[B];
  const base = n.years[B];
  return { gc, gu, target, s0, base, shareAt: (y) => s0 * ((1 + gc) / (1 + gu)) ** (y - base) };
}

// Canada's best stretch of `len` years since the data begin, as growth faster than the US a year.
function bestStretch(len) {
  const n = data.national, c = n.canada_volume, u = n.us_volume;
  let best = null;
  for (let e = len; e < n.years.length; e++) {
    const edge = ((c[e] / c[e - len]) / (u[e] / u[e - len])) ** (1 / len) - 1;
    if (!best || edge > best.edge) best = { edge, from: n.years[e - len], to: n.years[e] };
  }
  return best;
}

function renderScenario() {
  const sc = scenario();
  $("g-ca-out").textContent = pctg(sc.gc);
  $("g-us-out").textContent = pctg(sc.gu);
  $("target-out").textContent = sc.target;
  const len = sc.target - sc.base;
  const at = sc.shareAt(sc.target);
  // When, if ever, the paths cross.
  let cross = null;
  if (sc.gc > sc.gu) cross = Math.ceil(sc.base + Math.log(1 / sc.s0) / Math.log((1 + sc.gc) / (1 + sc.gu)));
  $("sc-proj").innerHTML = at >= 1
    ? `At these rates, Canada would <strong>catch up with the US around ${cross}</strong>.`
    : `At these rates, Canada would be at <strong>${Math.round(at * 100)}% of the US</strong> in ${sc.target}${cross && cross <= 2100 ? `, catching up around ${cross}` : ""}.`;

  const need = (1 + sc.gu) * (1 / sc.s0) ** (1 / len) - 1;
  const edge = (1 + need) / (1 + sc.gu) - 1;
  $("sc-need").innerHTML = `To close the gap by ${sc.target}, Canada would need about <strong>${pctg(need)} a year</strong>, ${(edge * 100).toFixed(1)} percentage points a year faster than the US's ${pctg(sc.gu)}.`;

  const best = len < data.national.years.length ? bestStretch(len) : null;
  $("sc-history").innerHTML = !best ? ""
    : best.edge > 0
      ? `Canada's best ${len}-year stretch since ${data.national.years[0]} was ${(best.edge * 100).toFixed(2)} percentage points a year faster than the US (${best.from}–${best.to}).`
      : `In no ${len}-year stretch since ${data.national.years[0]} has Canada grown faster than the US; its best was ${(Math.abs(best.edge) * 100).toFixed(2)} percentage points a year slower (${best.from}–${best.to}).`;
  $("sc-caveat").textContent = `A scenario, not a forecast. Growth here means real GDP per person, so the path starts from the constant-price share (${Math.round(sc.s0 * 100)}% in ${sc.base}), not the ${Math.round(data.national.canada[data.national.years.length - 1] / data.national.us[data.national.us.length - 1] * 100)}% headline. Faster population growth can lower GDP per person even when the economy grows.`;
}

function resetScenario() {
  const t = recentTrend();
  $("g-ca").value = (t.gc * 100).toFixed(1);
  $("g-us").value = (t.gu * 100).toFixed(1);
  if (!$("target").value || $("target").dataset.touched !== "1") $("target").value = 2045;
}

// A visually hidden table so screen-reader users get the numbers behind a chart.
function srTable(id, head, rows) {
  const t = document.createElement("table");
  t.className = "visually-hidden";
  t.innerHTML = `<thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${
    rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  $(id).appendChild(t);
}

function drawGrowth() {
  const n = data.national;
  const base = Number($("base-year").value);
  const start = n.years.indexOf(base);
  const years = n.years.slice(start);
  const idx = (arr) => arr.slice(start).map((v) => (v / arr[start]) * 100);
  const ca = idx(n.canada_volume), us = idx(n.us_volume);
  $("base-year-label").textContent = base;
  lineChart("growth-chart", years, [
    { values: ca, colour: "--canada", label: "Canada", short: "Canada " },
    { values: us, colour: "--us", label: "United States", short: "US " },
  ], {
    format: (v) => `${Math.round(v)}`,
    ticksFormat: (t) => `${t}`,
    tip: (i) => `<strong>${years[i]}</strong>Canada: ${Math.round(ca[i])}<br>United States: ${Math.round(us[i])}<br><span class="muted">${base} = 100, inflation-adjusted</span>`,
  });
  $("growth-legend").innerHTML = `<span><i class="swatch line" style="background:var(--canada)"></i>Canada</span><span><i class="swatch line" style="background:var(--us)"></i>United States</span><span>${base} = 100</span>`;
}

// --- provinces and states ---

function regionalState() {
  const r = data.regional;
  const basis = document.querySelector('input[name="basis"]:checked').value;
  const all = $("show-all").checked;
  const places = r.places.filter((p) => all || !(p.territory || p.dc)).map((p) => ({ ...p, v: p[basis] }));
  places.sort((a, b) => b.v - a.v);
  const states = r.places.filter((p) => p.country === "US" && !p.dc).map((p) => p[basis]);
  const rankAmongStates = (v) => 1 + states.filter((s) => s > v).length;
  return { r, basis, places, rankAmongStates };
}

// Purchasing-power parities carry margins of several percent, so places within
// CLOSE of each other are described as "about level", never ranked precisely.
const CLOSE = 0.01;

function stateList(basis) {
  return data.regional.places.filter((p) => p.country === "US" && !p.dc).map((p) => ({ name: p.name, v: p[basis] }))
    .sort((a, b) => b.v - a.v);
}

const nearest = (v, states) => [...states].sort((a, b) => Math.abs(a.v - v) - Math.abs(b.v - v)).slice(0, 2).map((s) => s.name);

// How a province compares with the states, in words that don't overstate precision.
function standing(v, states) {
  const poorest = states[states.length - 1];
  if (v < poorest.v) {
    return Math.abs(v / poorest.v - 1) < CLOSE ? `About level with the poorest state, ${poorest.name}` : "Below every state";
  }
  const rank = 1 + states.filter((s) => s.v > v).length;
  return `Would rank about ${ordinal(rank)} of 50 states, level with ${list(nearest(v, states))}`;
}

function renderRegionLine() {
  const { r, basis } = regionalState();
  const states = stateList(basis);
  const middle = states[24].v, poorest = states[states.length - 1];
  const provs = r.places.filter((p) => p.country === "CA" && !p.territory).map((p) => ({ ...p, v: p[basis] }));
  const parts = [];
  const top = provs.filter((p) => p.v > middle).sort((a, b) => b.v - a.v);
  if (top.length) {
    const names = top.map((p) => (p.v / middle - 1 < CLOSE ? `${p.name} (narrowly)` : p.name));
    parts.push(`${top.length === 1 ? "Only " : ""}<strong>${esc(list(names))}</strong> would rank in the top half of US states.`);
  } else {
    parts.push("<strong>No province</strong> would rank in the top half of US states.");
  }
  const ont = provs.find((p) => p.name === "Ontario");
  if (ont) {
    const rank = 1 + states.filter((s) => s.v > ont.v).length;
    const where = rank > 50 ? "below every state" : rank >= 41 ? "among the ten poorest states"
      : rank > 25 ? "in the bottom half of states" : "in the top half of states";
    parts.push(`Ontario would sit <strong>${where}</strong>${rank <= 50 ? `, roughly level with ${esc(list(nearest(ont.v, states)))}` : ""}.`);
  }
  const others = provs.filter((p) => p.name !== "Ontario");
  const level = others.filter((p) => Math.abs(p.v / poorest.v - 1) < CLOSE).map((p) => p.name);
  const below = others.filter((p) => p.v < poorest.v && !level.includes(p.name)).map((p) => p.name);
  if (level.length) parts.push(`${esc(list(level))} would be about level with the poorest state, ${esc(poorest.name)}.`);
  if (below.length) parts.push(`${esc(list(below))} would rank below every state.`);
  $("region-line").innerHTML = parts.join(" ");
  $("region-year").textContent = r.year;
}

function drawRegions() {
  const { r, basis, places, rankAmongStates } = regionalState();
  const W = chartWidth("region-chart");
  const narrow = W < 520;
  const rowH = 19, top = 22, labelW = narrow ? 118 : 150, right = 70;
  const H = top + rowH * places.length + 8;
  const max = Math.max(...places.map((p) => p.v), r.us_total);
  const ticks = niceTicks(0, max, narrow ? 3 : 5);
  const x = (v) => labelW + (v / ticks[ticks.length - 1]) * (W - labelW - right);
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `GDP per person by province and state, ${r.year}` });

  ticks.forEach((t) => {
    svg.appendChild(el("line", { x1: x(t), x2: x(t), y1: top - 4, y2: H - 8, stroke: "var(--grid)" }));
    svg.appendChild(el("text", { x: x(t), y: top - 10, "text-anchor": "middle", "font-size": 11 }, t ? `$${t / 1000}k` : "$0"));
  });
  places.forEach((p, i) => {
    const y0 = top + i * rowH;
    const ca = p.country === "CA";
    const label = narrow && p.short ? p.name.length > 16 ? p.short : p.name : p.name;
    svg.appendChild(el("text", { x: labelW - 8, y: y0 + rowH / 2 + 4, "text-anchor": "end", "font-size": ca ? 12 : 11, class: ca ? "strong" : "muted-label" }, label));
    svg.appendChild(el("rect", { x: labelW, y: y0 + 3, width: Math.max(1, x(p.v) - labelW), height: rowH - 6, rx: 2,
      style: `fill: var(${ca ? "--canada" : "--other"})` }));
    if (ca) svg.appendChild(el("text", { x: x(p.v) + 6, y: y0 + rowH / 2 + 4, "font-size": 11, class: "value" }, `$${Math.round(p.v / 1000)}k`));
    const hit = el("rect", { x: 0, y: y0, width: W, height: rowH, class: "hit", tabindex: ca ? 0 : -1 });
    const rank = p.country === "US" && !p.dc ? `${ordinal(rankAmongStates(p.v))} of 50 states`
      : p.dc ? "A city: its GDP counts commuters who live in Maryland and Virginia" : standing(p.v, stateList(basis));
    const html = `<strong>${esc(p.name)}</strong>${usd(p.v)} per person<br><span class="muted">${esc(cap(rank))}</span>`;
    hit.addEventListener("pointermove", (e) => showTip(html, e.clientX, e.clientY));
    hit.addEventListener("pointerleave", hideTip);
    hit.addEventListener("focus", () => { const b = hit.getBoundingClientRect(); showTip(html, b.left + b.width / 2, b.top); });
    hit.addEventListener("blur", hideTip);
    svg.appendChild(hit);
  });
  // US average for reference.
  svg.appendChild(el("line", { x1: x(r.us_total), x2: x(r.us_total), y1: top - 4, y2: H - 8, style: "stroke: var(--us)", "stroke-width": 1.5, "stroke-dasharray": "4 3" }));
  $("region-chart").replaceChildren(svg);
  srTable("region-chart", ["Place", "GDP per person (US$)"], places.map((p) => [p.name, Math.round(p.v).toLocaleString("en-CA")]));
  const unit = basis === "ppp" ? "US dollars at purchasing-power parity" : "US dollars at the market exchange rate";
  $("region-legend").innerHTML = `<span><i class="swatch" style="background:var(--canada)"></i>Province${$("show-all").checked ? " or territory" : ""}</span><span><i class="swatch" style="background:var(--other)"></i>State</span><span><i class="swatch line" style="background:var(--us)"></i>US average</span><span>${unit}</span>`;
}
const cap = (s) => s[0].toUpperCase() + s.slice(1);

// --- methods ---

function renderMethods() {
  const r = data.regional;
  $("built").textContent = `data updated ${new Date(data.built + "T12:00").toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" })}`;
  $("method-year").textContent = r.year;
  $("method-ppp").textContent = r.ppp.toFixed(2);
  $("method-fx").textContent = r.fx.toFixed(2);
  $("sources").innerHTML = data.sources.map((s) =>
    `<li>${esc(s.source)}. <a href="${esc(s.url)}">${esc(s.url)}</a> (retrieved ${esc(s.retrieved)}).${s.notes ? ` ${esc(s.notes)}` : ""}</li>`).join("");
}

// --- start ---

function drawAll() {
  drawShare();
  drawGrowth();
  renderRegionLine();
  drawRegions();
}

async function init() {
  data = await (await fetch("data.json")).json();
  const n = data.national;
  const options = n.years.filter((y) => y % 10 === 0 || y === 2015 || y === 2019).filter((y) => y < n.years[n.years.length - 1] - 2);
  $("base-year").innerHTML = options.map((y) => `<option value="${y}"${y === 2000 ? " selected" : ""}>${y}</option>`).join("");
  const trend = recentTrend();
  $("trend-hint").textContent = `Sliders start at each country's average growth in real GDP per person, ${trend.from}–${trend.to}: Canada ${pctg(trend.gc)}, US ${pctg(trend.gu)} a year.`;
  resetScenario();
  renderHeadline();
  renderMethods();
  drawAll();
  renderScenario();
  for (const id of ["g-ca", "g-us", "target"]) {
    $(id).addEventListener("input", () => {
      if (id === "target") $("target").dataset.touched = "1";
      renderScenario();
      drawShare();
    });
  }
  $("reset-scenario").addEventListener("click", () => { resetScenario(); renderScenario(); drawShare(); });
  $("base-year").addEventListener("change", drawGrowth);
  document.querySelectorAll('input[name="basis"]').forEach((i) => i.addEventListener("change", () => { renderRegionLine(); drawRegions(); }));
  $("show-all").addEventListener("change", drawRegions);
  $("methods-link").addEventListener("click", (e) => {
    e.preventDefault();
    $("methods-details").open = true;
    $("methods").scrollIntoView({ block: "start" });
  });
  let t;
  addEventListener("resize", () => { clearTimeout(t); t = setTimeout(drawAll, 150); });
}

init().catch((err) => {
  $("cents").textContent = "Couldn't load";
  $("trend-line").textContent = `The page couldn't load its data (${err.message}).`;
});
