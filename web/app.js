/* Compute Cost Atlas — prototype v0.2 front end. Model: model.js (port of the Python model; parity-tested). */
(function () {
  "use strict";

  // ---- palettes (same as the paper figures: src/make_maps.py, src/token_cost.py, src/tradeoff.py, src/equity.py) -----
  var BLUE_ARM = ["#0d366b", "#184f95", "#2a78d6", "#86b6ef", "#cde2fb"], NEUTRAL = "#f0efec",
      ORANGE_ARM = ["#fbdccb", "#f4a77f", "#eb6834", "#b8461b", "#7a2c0e"];
  var DIVERGING = BLUE_ARM.concat([NEUTRAL], ORANGE_ARM);
  var BLUE_SEQ = BLUE_ARM.slice().reverse();
  var GREY_SEQ = ["#ececec", "#bdbdbd", "#7f7f7f", "#454545", "#1a1a1a"];
  var PURPLE_SEQ = ["#efedf5", "#bcbddc", "#9e9ac8", "#756bb1", "#54278f", "#3f007d"];           // load (Fig. 5a)
  var TEAL_SEQ = ["#eef7f6", "#b7e1dc", "#6fbfb6", "#2f8f86", "#0f5a54"];                     // context layers
  var PRGN = ["#762a83", "#9970ab", "#c2a5cf", "#e7d4e8", "#f7f7f7", "#d9f0d3", "#a6dba0", "#5aae61", "#1b7837"]; // neutral (non-party) diverging
  var BIVAR = [["#e8e8e8", "#ace4e4", "#5ac8c8"], ["#dfb0d6", "#a5add3", "#5698b9"], ["#be64ac", "#8c62aa", "#3b4994"]]; // Fig. 4b
  var NODATA = "#d9d9d9";
  var DRIVER_COLORS = { "Construction (labor-adjusted)": "#0072B2", "Land": "#D55E00", "Electricity": "#E69F00",
    "Carbon": "#CC79A7", "Water (incl. stress surcharge)": "#56B4E9", "Operations labor": "#009E73",
    "Hazard premium": "#F0E442" };

  // ---- themes and metrics --------------------------------------------------------------------------------------------
  var THEMES = [
    { id: "cost", label: "Cost", metrics: ["tco", "costIndex", "driver"],
      explainer: "What it would cost to build and run a data center here for ten years, and which cost component makes the county cheaper or more expensive than the typical county." },
    { id: "token", label: "Token footprint", metrics: ["priceL1", "co2Kg", "waterSwL"],
      explainer: "What one million AI 'tokens' (word-pieces) served from this county would cost, emit and use in water. The price is cost-based, not what providers charge." },
    { id: "tradeoff", label: "Cheap vs clean", metrics: ["bivCo2", "bivWater"],
      explainer: "Each county is placed in a 3 × 3 grid: national thirds of facility cost against national thirds of carbon (or scarcity-weighted water) per token. Light grey = cheap and clean; dark = costly and dirty." },
    { id: "burden", label: "Who bears it", metrics: ["gridLoad", "socialShift"],
      explainer: "How large one campus is for the local grid, and how a county's ranking changes when the wider costs of carbon and water use are counted, not only the builder's costs." },
    { id: "context", label: "Context", metrics: ["svi", "income", "vote"],
      explainer: "Background information about the people who live in each county. Context, not causal: these layers are not used in the cost model and do not explain its results." },
    { id: "confidence", label: "Confidence", metrics: ["mcWidth"],
      explainer: "How sure the ranking is: the spread of a county's percentile across 2,000 simulations in which the uncertain assumptions vary together. Narrow = robust position." }
  ];

  function arr(name) { return function (o) { return o[name]; }; }
  function dataCol(name) { return function () { return data[name]; }; }
  var METRICS = {
    tco: { label: "10-year cost of a campus ($ bn)", short: "10-yr cost ($ bn)", kind: "div", values: arr("tco"),
      fmt: function (v) { return "$" + (v / 1e9).toFixed(2) + " bn"; }, tick: function (v) { return (v / 1e9).toFixed(2); },
      note: "Ten-year total cost of ownership; excludes IT hardware. Blue = cheaper than the national median, orange = more expensive." },
    costIndex: { label: "Cost Index (national median = 50)", short: "Cost Index", kind: "div", values: arr("costIndex"),
      fmt: function (v) { return v.toFixed(1); }, tick: function (v) { return v.toFixed(0); },
      note: "County cost ÷ national median × 50 (not capped at 100)." },
    driver: { label: "Main cost driver (vs national median)", short: "Main cost driver", kind: "cat",
      note: "Component that raises (dark) or lowers (light) the county's cost most relative to its own national median (as Fig. 1c)." },
    priceL1: { label: "Price per 1M tokens ($, cost-based)", short: "Price per 1M tokens ($)", kind: "div", values: arr("priceL1"),
      fmt: function (v) { return "$" + v.toFixed(2) + " (" + pctVsMedian(v) + ")"; }, tick: function (v) { return v.toFixed(3); },
      note: "Typical model price for the selected open-weight share plus the county's facility-cost difference (3 input : 1 output tokens)." },
    co2Kg: { label: "CO₂ per 1M tokens (kg)", short: "CO₂ per 1M tokens (kg)", kind: "seq", ramp: GREY_SEQ, values: arr("co2Kg"),
      fmt: function (v) { return v.toFixed(3) + " kg"; }, tick: function (v) { return v.toFixed(3); },
      note: "Facility electricity × grid emission rate (EPA eGRID 2023 subregion)." },
    waterSwL: { label: "Scarcity-weighted water per 1M tokens (L-eq, log)", short: "Water per 1M tokens (L-eq, log)", kind: "log",
      ramp: BLUE_SEQ, values: arr("waterSwL"), fmt: function (v) { return (v < 1 ? v.toFixed(2) : v.toFixed(1)) + " L-eq"; },
      tick: function (v) { return v >= 1 ? v.toFixed(0) : v.toFixed(1); },
      note: "On-site cooling water + water used to generate the electricity, weighted by local water stress (WRI Aqueduct; 1 = median county)." },
    bivCo2: { label: "Facility cost × CO₂ per token (national thirds)", short: "Cost × CO₂", kind: "bivar", yName: "CO₂",
      x: arr("costPerItMwh"), y: arr("co2Kg"), note: "Same 3 × 3 colour scheme as Fig. 4b." },
    bivWater: { label: "Facility cost × scarcity-weighted water per token (national thirds)", short: "Cost × water stress", kind: "bivar",
      yName: "Water", x: arr("costPerItMwh"), y: arr("waterSwL"), note: "Water axis: scarcity-weighted total water per 1M tokens (Fig. 4c)." },
    gridLoad: { label: "Campus electricity as % of balancing-authority sales (log)", short: "Load, % of grid sales (log)", kind: "log",
      ramp: PURPLE_SEQ, values: arr("gridLoadPct"), fmt: function (v) { return v.toFixed(2) + "% of grid sales"; },
      tick: function (v) { return v >= 1 ? v.toFixed(0) : v.toFixed(1); }, logTicks: [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50],
      note: "Annual electricity of one campus ÷ 2024 retail sales of the county's balancing authority (EIA-861; Alaska, Hawaii: state sales). Grey = no balancing authority matched." },
    socialShift: { label: "Rank change when social costs are counted (points)", short: "Social vs private rank", kind: "divzero",
      values: arr("socialRankShift"), fmt: function (v) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(0) + " percentile points"; },
      tick: function (v) { return (v > 0 ? "+" : "") + v.toFixed(0); },
      note: "Percentile by social cost (TCO + CO₂ at the EPA social cost of carbon, $190/t, minus the carbon price in TCO, + provisional water shadow price) minus percentile by private cost. Orange = dearer for society than for the builder." },
    svi: { label: "Social vulnerability (FEMA NRI, 0–100)", short: "Social vulnerability", kind: "seq", ramp: TEAL_SEQ,
      values: dataCol("svi"), fmt: function (v) { return v.toFixed(0) + " / 100"; }, tick: function (v) { return v.toFixed(0); },
      note: "Context, not causal. FEMA National Risk Index social vulnerability score (CDC/ATSDR SVI-based)." },
    income: { label: "Median household income ($000, Census SAIPE 2023)", short: "Median income ($000)", kind: "seq", ramp: TEAL_SEQ,
      values: dataCol("median_hh_income"), fmt: function (v) { return "$" + fmtInt(v); }, tick: function (v) { return (v / 1000).toFixed(0); },
      note: "Context, not causal. Census Small Area Income and Poverty Estimates, 2023." },
    vote: { label: "Vote share (information only)", short: "Vote share (information only)", kind: "vote" },
    mcWidth: { label: "Uncertainty of the county's percentile (5–95% width, points)", short: "Rank uncertainty (points)", kind: "seq",
      ramp: GREY_SEQ, values: function () { return data.mc_rank_p95.map(function (v, i) { return v - data.mc_rank_p5[i]; }); },
      fmt: function (v) { return v.toFixed(1) + " percentile points"; }, tick: function (v) { return v.toFixed(0); },
      note: "Baseline scenario (air cooling, 100 MW); does not change with the sliders. Source: Monte Carlo analysis, 2,000 draws." }
  };
  /* Election context layer (information only): one metric with a year selector (state.voteMode). */
  var VOTE_MODES = {
    p2024: { label: "2024 presidential: Democratic share of the two-party vote", short: "2024 presidential (two-party)",
      kind: "fixed", ramp: PRGN, lo: 0.2, hi: 0.8, center: 0.5, values: dataCol("vote_dem_two_party"),
      fmt: function (v) { return (v * 100).toFixed(0) + "% Democratic / " + (100 - v * 100).toFixed(0) + "% Republican (two-party)"; },
      tick: function (v) { return (v * 100).toFixed(0) + "%"; },
      race: function () { return params.election.p2024.race + " (" + params.election.p2024.source + ")."; } },
    m2026: { label: "2026 midterm, U.S. House: Democratic share of the two-party vote", short: "2026 midterm, U.S. House",
      kind: "fixed", ramp: PRGN, lo: 0.2, hi: 0.8, center: 0.5, values: dataCol("vote26_house_dem_two_party"),
      fmt: function (v) { return (v * 100).toFixed(0) + "% Democratic / " + (100 - v * 100).toFixed(0) + "% Republican (House, two-party)"; },
      tick: function (v) { return (v * 100).toFixed(0) + "%"; },
      race: function () { return params.election.m2026.race + "."; } },
    change: { label: "Change, 2024 presidential → 2026 House (points)", short: "Vote change 2024 → 2026 (points)",
      kind: "fixed", ramp: PRGN, lo: -20, hi: 20, center: 0, values: function () {
        return data.vote26_house_dem_two_party.map(function (v, i) {
          var p = data.vote_dem_two_party[i];
          return v === null || p === null ? null : (v - p) * 100; }); },
      fmt: function (v) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + " points Democratic share"; },
      tick: function (v) { return (v > 0 ? "+" : "") + v.toFixed(0); },
      race: function () { return "Different races (president vs U.S. House), so the change mixes real shifts with candidate and turnout effects; counties in uncontested House districts are excluded."; } }
  };
  function voteDef() {
    var v = VOTE_MODES[state.voteMode], pending = params.election.m2026.status !== "available" && state.voteMode !== "p2024";
    return Object.assign({}, v, { kind: "fixed", pending: pending,
      note: "Information only; not used in the cost model; context, not causal. " + v.race() +
        (pending ? " Certified county-level 2026 results are not yet available: this layer shows no data until they are added." : "") +
        " Neutral colours (not party colours): purple = higher Republican share, green = higher Democratic share." });
  }

  var DIFF = {
    tcoPct: { label: "Change in 10-year cost vs baseline (%)", short: "Cost change vs baseline (%)", kind: "divzero",
      fmt: function (v) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1) + "% vs baseline"; },
      tick: function (v) { return (v > 0 ? "+" : "") + v.toFixed(1) + "%"; },
      note: "Current slider settings vs the baseline scenario. Blue = cheaper than in the baseline, orange = more expensive." },
    rank: { label: "Change in percentile vs baseline (points)", short: "Percentile change (points)", kind: "divzero",
      fmt: function (v) { return (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(0) + " points vs baseline"; },
      tick: function (v) { return (v > 0 ? "+" : "") + v.toFixed(0); },
      note: "Current slider settings vs the baseline scenario. Orange = moves towards the expensive end of the ranking." }
  };

  var PRESETS = { baseline: {}, carbon: { carbonPrice: 190 }, liquid: { cooling: "liquid_dry_coolers" } };
  var BOUNDS = { l48: [[-125, 24], [-66.5, 49.6]], ak: [[-170, 51], [-129, 71.5]], hi: [[-160.6, 18.8], [-154.6, 22.4]] };
  var EXTRUDE_M = 220000;                       // metres of extrusion for the top of the colour scale (3D view)

  var state = { theme: "cost", metric: "tco", voteMode: "p2024", diff: null, extrude: false, scenario: null, out: null, base: null, selected: null,
                compare: [], hover: null, domain: null, cats: null };
  var data, params, prep, map, fipsIndex = {}, l48Mask = [], cityMarkers = [];

  // ---- helpers ------------------------------------------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function quantile(a, q) {
    var v = a.filter(function (x) { return x !== null && isFinite(x); }).sort(function (x, y) { return x - y; });
    var pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }
  function pctVsMedian(v) {                       // token price relative to the national median of the current scenario
    var med = CostModel.median(state.out.priceL1), d = (v / med - 1) * 100;
    return (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(1) + "% vs national median";
  }
  function fmtInt(v) { return Math.round(v).toLocaleString(); }
  function fmtMoney(v) { return Math.abs(v) >= 1e9 ? "$" + (v / 1e9).toFixed(2) + " bn" : "$" + (v / 1e6).toFixed(0) + " M"; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function rampColor(ramp, t) {                   // linear interpolation between equally spaced stops, as MapLibre did
    var x = Math.min(1, Math.max(0, t)) * (ramp.length - 1), k = Math.min(Math.floor(x), ramp.length - 2), f = x - k;
    var a = hexRgb(ramp[k]), b = hexRgb(ramp[k + 1]);
    return "rgb(" + [0, 1, 2].map(function (c) { return Math.round(a[c] + (b[c] - a[c]) * f); }).join(",") + ")";
  }
  function lighten(hex, a) { var c = hexRgb(hex); return "rgb(" + c.map(function (x) { return Math.round(x + (255 - x) * a); }).join(",") + ")"; }
  function tertiles(v) { return [quantile(v, 1 / 3), quantile(v, 2 / 3)]; }
  function tertileOf(v, cuts) { return v < cuts[0] ? 0 : v < cuts[1] ? 1 : 2; }

  function activeDef() { return state.diff ? DIFF[state.diff] : state.metric === "vote" ? voteDef() : METRICS[state.metric]; }
  function activeValues() {
    if (state.diff === "tcoPct") return state.out.tco.map(function (v, i) { return (v / state.base.tco[i] - 1) * 100; });
    if (state.diff === "rank") return state.out.percentile.map(function (v, i) { return v - state.base.percentile[i]; });
    var m = activeDef();
    return m.values ? m.values(state.out) : null;
  }

  // ---- colour domain (lower 48 + DC sets the scale, as in the paper; AK / HI clamp at the ends) -----------------------
  function domainFor(m, values) {
    var l48 = values.filter(function (v, i) { return l48Mask[i] && v !== null && isFinite(v); });
    if (m.kind === "div") {
      var center = CostModel.median(values.filter(function (v) { return v !== null; }));
      var half = quantile(l48.map(function (v) { return Math.abs(v - center); }), 0.98);
      return { kind: "div", center: center, lo: center - half, hi: center + half, ramp: DIVERGING };
    }
    if (m.kind === "divzero") {
      var h = Math.max(quantile(l48.map(Math.abs), 0.98), 0.05);
      return { kind: "div", center: 0, lo: -h, hi: h, ramp: DIVERGING };
    }
    if (m.kind === "fixed") return { kind: "div", center: m.center, lo: m.lo, hi: m.hi, ramp: m.ramp };
    var lo = quantile(l48, 0.02), hi = quantile(l48, 0.98);
    return { kind: m.kind, lo: lo, hi: hi, ramp: m.ramp };
  }
  function toT(d, v) {
    if (v === null || !isFinite(v)) return null;
    var t = d.kind === "log" ? (Math.log(v) - Math.log(d.lo)) / (Math.log(d.hi) - Math.log(d.lo)) : (v - d.lo) / (d.hi - d.lo);
    return Math.min(1, Math.max(0, t));
  }

  // ---- model -------------------------------------------------------------------------------------------------------
  function recompute() {
    state.out = CostModel.run(prep, state.scenario);
    paint();
    renderSummary();
    if (state.selected !== null) renderProfile(state.selected);
    renderCompare();
    writeHash();
  }

  /* Colour (and 3D height) per county as feature state; one paint expression serves every map type. */
  function paint() {
    if (!map || !map.getSource("counties")) return;
    var m = activeDef(), n = data.fips.length, cols = new Array(n), hts = new Array(n);
    state.domain = null; state.cats = null;
    if (m.kind === "cat") {
      state.out.driver.forEach(function (d, i) {
        cols[i] = d.side === "more expensive" ? DRIVER_COLORS[d.driver] : lighten(DRIVER_COLORS[d.driver], 0.55); hts[i] = 0;
      });
    } else if (m.kind === "bivar") {
      var x = m.x(state.out), y = m.y(state.out), cx = tertiles(x), cy = tertiles(y);
      state.cats = { cx: cx, cy: cy, x: x, y: y };
      for (var i = 0; i < n; i++) { cols[i] = BIVAR[tertileOf(y[i], cy)][tertileOf(x[i], cx)]; hts[i] = 0; }
    } else {
      var vals = activeValues();
      if (m.pending) vals = vals.map(function () { return null; });
      state.domain = domainFor(m, vals);
      for (var k = 0; k < n; k++) {
        var t = toT(state.domain, vals[k]);
        cols[k] = t === null ? NODATA : rampColor(state.domain.ramp, t);
        hts[k] = t === null ? 0 : t;
      }
    }
    for (var j = 0; j < n; j++) map.setFeatureState({ source: "counties", id: +data.fips[j] }, { col: cols[j], h: hts[j] });
    renderLegend();
  }

  function renderLegend() {
    var m = activeDef(), html = '<div class="caption"><b>' + esc(m.label) + "</b></div>", compact = "";
    if (m.pending) {
      html += '<p class="pending">2026 county results: <b>pending certification</b>. No 2026 numbers are shown or estimated.</p>' +
        '<div class="caption">' + esc(m.note) + "</div>";
      compact = "pending certification";
    } else if (m.kind === "cat") {
      var counts = {};
      state.out.driver.forEach(function (d) { var k = d.driver + "|" + d.side; counts[k] = (counts[k] || 0) + 1; });
      html += '<div class="cat-legend">' + Object.keys(DRIVER_COLORS).map(function (k) {
        var up = counts[k + "|more expensive"] || 0, dn = counts[k + "|cheaper"] || 0;
        if (!up && !dn) return "";
        return '<div><span class="sw" style="background:' + DRIVER_COLORS[k] + '"></span><span class="sw" style="background:' +
          lighten(DRIVER_COLORS[k], 0.55) + '"></span>' + esc(k) + " <small>(" + up + " / " + dn + ")</small></div>";
      }).join("") + '</div><div class="caption">Dark = raises cost (county above the median), light = lowers it; counties in brackets. ' + esc(m.note) + "</div>";
      compact = "dark = raises · light = lowers";
    } else if (m.kind === "bivar") {
      var c = state.cats, f = function (v) { return v < 0.1 ? v.toFixed(3) : v < 10 ? v.toFixed(2) : v.toFixed(0); };
      var grid = "";
      for (var r = 2; r >= 0; r--) for (var q = 0; q < 3; q++) grid += '<span style="background:' + BIVAR[r][q] + '"></span>';
      html += '<div class="bivar"><div class="grid" role="img" aria-label="' + esc("3 by 3 colour grid: columns are national thirds of facility cost (left cheap, right costly), rows are thirds of " + m.yName + " (bottom low, top high); light grey = cheap and low, dark blue-violet = costly and high") + '">' + grid + '</div><div class="axis-y">' + m.yName + ' →</div><div class="axis-x">Cost →</div>' +
        '<div class="cuts">Thirds: cost $' + c.cx[0].toFixed(0) + " / $" + c.cx[1].toFixed(0) + " per IT-MWh; " + m.yName + " " +
        f(c.cy[0]) + " / " + f(c.cy[1]) + " per 1M tokens</div></div>" + '<div class="caption">' + esc(m.note) + "</div>";
      compact = '<div class="mini-bivar">' + grid + "</div> cost → · " + m.yName + " ↑";
    } else {
      var d = state.domain, ticks = [];
      if (d.kind === "log") (m.logTicks || [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50]).forEach(function (v) { if (v >= d.lo && v <= d.hi) ticks.push(v); });
      else for (var k = 0; k <= 4; k++) ticks.push(d.lo + (d.hi - d.lo) * k / 4);
      var alt = "Colour scale for " + m.label + ": from " + m.tick(d.lo) + " (left) to " + m.tick(d.hi) + " (right)" +
        (d.kind === "div" ? ", centred on " + m.tick(d.center) : "") + (d.kind === "log" ? ", logarithmic" : "");
      html += '<div class="bar" role="img" aria-label="' + esc(alt) + '" style="background:linear-gradient(to right,' + d.ramp.join(",") + ')"></div><div class="ticks" aria-hidden="true">' +
        ticks.map(function (v) { return '<span style="left:' + (toT(d, v) * 100).toFixed(1) + '%">' + m.tick(v) + "</span>"; }).join("") +
        '</div><div class="caption">' + esc(m.note) + (m.kind === "div" ? " Centre = national median." : "") +
        (m.kind === "fixed" ? "" : " Scale: lower 48 + DC, 2nd–98th percentile; values beyond show the end colour.") + "</div>";
      compact = '<div class="bar" style="background:linear-gradient(to right,' + d.ramp.join(",") + ')"></div><div class="ends"><span>' +
        m.tick(d.lo) + "</span><span>" + (d.kind === "div" ? m.tick(d.center) : "") + "</span><span>" + m.tick(d.hi) + "</span></div>";
    }
    if (state.extrude) html += '<div class="caption note3d">3D view: height follows the mapped value' +
      (m.kind === "cat" || m.kind === "bivar" ? " (not available for this map type, shown flat)" : "") +
      ". Use 2D for precise comparison: perspective distorts heights and hides counties.</div>";
    $("legend").innerHTML = html;
    $("map-legend").innerHTML = '<div class="t">' + esc(m.short) + "</div>" + compact + layerLegendShort();
    var th = THEMES.filter(function (t) { return t.id === state.theme; })[0];
    $("explainer").textContent = state.diff ? "Change view: how the current slider settings move each county compared with the baseline scenario." :
      state.metric === "vote" ? "Election results are shown for information only. 2024 uses the presidential race; 2026 uses the U.S. House midterm (county totals of district results). They are not used in the cost model and do not explain it." :
      th.explainer;
    $("vote-mode").hidden = state.metric !== "vote" || !!state.diff;
  }

  /* Legend for the site layers: marker meaning and size (Epoch circle radius = 3.5 + 7 √(MW / 1000) px, as on the map). */
  function epochRadius(mw) { return 3.5 + 7 * Math.sqrt(mw / 1000); }
  function circleSvg(r, fill, stroke, sw) {
    var s = Math.ceil(2 * r + 4);
    return '<svg width="' + s + '" height="' + s + '" aria-hidden="true"><circle cx="' + s / 2 + '" cy="' + s / 2 + '" r="' + r +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"/></svg>';
  }
  function renderLayerLegend() {
    var pn = $("layer-pnnl").checked, ep = $("layer-epoch").checked, html = "";
    if (pn) html += '<div class="row">' + circleSvg(2.5, "#1a1a1a", "none", 0) + "Data center (PNNL IM3 atlas, from OpenStreetMap; one dot per facility)</div>";
    if (ep) {
      html += '<div class="row">' + [100, 500, 1000].map(function (mw) { return circleSvg(epochRadius(mw), "#CC79A7", "#fff", 1); }).join("") +
        "Frontier AI campus, operating: area grows with current power (100 / 500 / 1,000 MW)</div>" +
        '<div class="row">' + circleSvg(4, "none", "#CC79A7", 1.6) + "Hollow: planned or under construction (no current power)</div>";
    }
    $("layer-legend").innerHTML = html;
    $("layer-legend").hidden = !html;
    if (state.out) renderLegend();
  }
  function layerLegendShort() {
    var pn = $("layer-pnnl").checked, ep = $("layer-epoch").checked, parts = [];
    if (pn) parts.push("● data center");
    if (ep) parts.push('<span style="color:#CC79A7">●</span> frontier campus (size = MW) · <span style="color:#CC79A7">○</span> planned');
    return parts.length ? '<div class="lyr">' + parts.join(" · ") + "</div>" : "";
  }


  // ---- hover card (v0.4) ----------------------------------------------------------------------------------------------
  /* Aqueduct baseline water stress bands (bws_score 0-5): <1 low (<10% withdrawals/supply), 1-3 medium (10-40%),
     3-4 high (40-80%), >=4 extremely high (>80% or arid & low use). Aqueduct's low-medium and medium-high are merged. */
  function waterStressBand(score) {
    if (score === null || !isFinite(score)) return "no data";
    return score < 1 ? "Low" : score < 3 ? "Medium" : score < 4 ? "High" : "Extremely high";
  }
  function textOn(bg) {                           // dark or white text for a chip background (WCAG luminance)
    var c = bg.indexOf("rgb") === 0 ? bg.match(/\d+/g).map(Number) : hexRgb(bg);
    var l = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] > 0.22 ? "#1f1f1f" : "#ffffff";
  }
  function isBaseline() {
    var s = state.scenario, b = CostModel.baselineScenario(params);
    return ["mw", "carbonPrice", "surchargeMax", "cooling", "constructionPerMw", "staff", "discountRate", "landPremium"]
      .every(function (k) { return s[k] === b[k]; });          // open-weight share does not change cost
  }
  var DRIVER_SHORT = { "Construction (labor-adjusted)": "Construction labor", "Water (incl. stress surcharge)": "Water stress",
    "Operations labor": "Operations staff", "Hazard premium": "Natural hazards" };
  function tooltipCard(i, docked) {
    var o = state.out, d = o.driver[i], col = DRIVER_COLORS[d.driver];
    var chipBg = d.side === "more expensive" ? col : lighten(col, 0.55);
    var delta = "";
    if (!isBaseline()) {
      var dp = (o.tco[i] / state.base.tco[i] - 1) * 100;
      delta = '<span class="tc-delta">' + (dp >= 0 ? "+" : "−") + Math.abs(dp).toFixed(1) + "% vs baseline</span>";
    }
    var pct = o.percentile[i];
    // mini stats; the mapped metric (if not cost / index / driver) comes first, highlighted
    var stats = [
      { id: "price", k: "Electricity price", v: "$" + prep.price[i].toFixed(0) + " /MWh" },
      { id: "co2Kg", k: "CO₂ per 1M tokens", v: o.co2Kg[i].toFixed(3) + " kg" },
      { id: "water", k: "Water stress", v: waterStressBand(data.bws_score[i]) },
      { id: "dc", k: "Data centers", v: data.n_dc_pnnl[i] + (data.n_epoch[i] ? " · " + data.n_epoch[i] + " frontier AI campus" + (data.n_epoch[i] > 1 ? "es" : "") : "") }
    ];
    var layer = state.diff ? "diff" : state.metric;
    if (["tco", "costIndex", "driver"].indexOf(layer) < 0) {
      var m = activeDef(), v = tooltipValue(i);
      stats = stats.filter(function (st) { return st.id !== layer; });
      if (stats.length > 3) {
        var drop = ["vote", "svi", "income", "mcWidth"].indexOf(layer) >= 0 ? "co2Kg" : "price";
        stats = stats.filter(function (st) { return st.id !== drop; });
      }
      stats.unshift({ id: layer, k: m.short.replace(/ \((kg|\$|\$ bn)\)$/, ""), v: v, hl: true });
      stats = stats.slice(0, 4);
    }
    var flags = flagsOf(i);
    return '<div class="tc-head"><b>' + esc(data.name[i]) + ", " + esc(data.state[i]) + '</b><span>Population ' +
      fmtInt(data.population[i]) + "</span></div>" +
      '<div class="tc-hero"><div><div class="tc-big">$' + (o.tco[i] / 1e9).toFixed(2) + ' bn</div><div class="tc-lab">10-yr cost' +
      (delta ? " " + delta : "") + '</div></div><div><div class="tc-big">' + o.costIndex[i].toFixed(1) +
      ' <span class="tc-unit">Cost Index</span></div><div class="tc-lab">percentile ' + pct.toFixed(0) + "</div></div></div>" +
      '<div class="tc-pos" role="img" aria-label="Position among counties: percentile ' + pct.toFixed(0) + ' of 100, 0 = cheapest">' +
      '<div class="tc-bar" style="background:linear-gradient(to right,' + DIVERGING.join(",") + ')"></div>' +
      '<div class="tc-mark" style="left:' + pct.toFixed(1) + '%"></div><div class="tc-ends"><span>cheapest</span><span>most expensive</span></div></div>' +
      '<div class="tc-chip" style="background:' + chipBg + ";color:" + textOn(chipBg) + '">Main driver: <b>' +
      esc(DRIVER_SHORT[d.driver] || d.driver) + "</b> · " + (d.side === "more expensive" ? "raises" : "lowers") + "</div>" +
      '<div class="tc-stats">' + stats.map(function (st) {
        return '<div class="' + (st.hl ? "hl" : "") + '"><span>' + esc(st.k) + "</span><b>" + esc(st.v) + "</b></div>";
      }).join("") + "</div>" +
      (flags.length ? '<div class="tc-flag">ⓘ estimated inputs (' + flags.length + ")</div>" : "") +
      (docked ? '<div class="tc-foot"><button class="btn" id="tc-open">Full profile</button><button class="tc-x" id="tc-close" aria-label="Close">×</button></div>'
              : '<div class="tc-foot hint">Click the county for full profile</div>');
  }

  function tooltipValue(i) {
    var m = activeDef();
    if (m.kind === "cat") { var d = state.out.driver[i]; return d.driver + (d.side === "cheaper" ? " (lowers cost)" : " (raises cost)"); }
    if (m.kind === "bivar") {
      var c = state.cats, L = ["low", "middle", "high"];
      return "cost " + L[tertileOf(c.x[i], c.cx)] + " third · " + m.yName + " " + L[tertileOf(c.y[i], c.cy)] + " third";
    }
    var v = activeValues()[i];
    return v === null || !isFinite(v) ? "no data" : m.fmt(v);
  }

  function renderSummary() {
    var s = state.out.summary;
    $("scenario-summary").innerHTML = "National median: <b>" + fmtMoney(s.medianTco) + "</b> over 10 years · facility cost <b>$" +
      s.medianCostPerItMwh.toFixed(0) + "</b> per IT-MWh · token price <b>$" + s.priceMix.toFixed(2) + "</b> per 1M tokens.";
  }

  // ---- profile -------------------------------------------------------------------------------------------------------
  function componentsOf(i) {
    var o = state.out;
    return [
      ["Construction (labor-adjusted)", o.capexConstruction[i], DRIVER_COLORS["Construction (labor-adjusted)"]],
      ["Grid connection", o.capexGrid[i], "#9e9e9e"],
      ["Liquid-cooling premium", o.capexCooling[i], "#9e9ac8"],
      ["Land", o.capexLand[i], DRIVER_COLORS.Land],
      ["Hazard premium", o.capexHazard[i], DRIVER_COLORS["Hazard premium"]],
      ["Electricity (10 yr, PV)", o.pvElectricity[i], DRIVER_COLORS.Electricity],
      ["Carbon (10 yr, PV)", o.pvCarbon[i], DRIVER_COLORS.Carbon],
      ["Water + stress surcharge (10 yr, PV)", o.pvWater[i] + o.pvWaterPenalty[i], DRIVER_COLORS["Water (incl. stress surcharge)"]],
      ["Operations staff (10 yr, PV)", o.pvLabor[i], DRIVER_COLORS["Operations labor"]]
    ].filter(function (c) { return c[1] > 0; });
  }

  function flagsOf(i) {
    var f = [];
    if (data.flag_climate_estimated[i]) f.push("Climate inputs estimated (e.g. Alaska, Hawaii or a county missing from the NOAA crosswalk).");
    if (data.flag_price_state_average[i]) f.push("Electricity price set to the state average (local industrial price missing or unrepresentative).");
    if (data.flag_price_commercial_proxy[i]) f.push("No industrial electricity sales: commercial price used.");
    if (data.state[i] === "CT") f.push("Connecticut planning regions: some inputs mapped from legacy counties.");
    return f;
  }

  function renderProfile(i) {
    var o = state.out, d = o.driver[i], comps = componentsOf(i), total = o.tco[i];
    var el = $("profile");
    var stack = comps.map(function (c) {
      return '<div title="' + esc(c[0]) + '" style="width:' + (c[1] / total * 100).toFixed(2) + "%;background:" + c[2] + '"></div>';
    }).join("");
    var rows = comps.map(function (c) {
      return '<tr><td><span class="sw" style="background:' + c[2] + '"></span>' + esc(c[0]) + "</td><td class=num>" +
        fmtMoney(c[1]) + "</td><td>" + (c[1] / total * 100).toFixed(1) + "%</td></tr>";
    }).join("");
    var flags = flagsOf(i);
    var inCompare = state.compare.indexOf(i) >= 0;
    var mw = state.out.summary.scenario.mw;
    el.innerHTML = '<button class="close" aria-label="Close profile">×</button>' +
      "<h2>" + esc(data.name[i]) + ", " + esc(data.state[i]) + "</h2>" +
      '<div class="sub">Population ' + Number(data.population[i]).toLocaleString() + " · grid region " + esc(data.egrid_subregion[i]) +
      " · " + mw + " MW IT campus</div>" +
      '<div class="kpis">' +
      kpi("10-year cost", fmtMoney(o.tco[i]), "excl. IT hardware") +
      kpi("Cost Index", o.costIndex[i].toFixed(1), "percentile " + o.percentile[i].toFixed(0) + " (0 = cheapest)" +
          '</div><div class="s" title="' + esc(params.web.monte_carlo.note) + '">' + (isBaseline()
            ? "uncertainty (5–95%): percentile " + data.mc_rank_p5[i].toFixed(0) + "–" + data.mc_rank_p95[i].toFixed(0)
            : "Uncertainty interval available for the baseline scenario")) +
      kpi("Price per 1M tokens", "$" + o.priceL1[i].toFixed(2), pctVsMedian(o.priceL1[i]) +
          '</div><div class="s">facility $' + o.costPerItMwh[i].toFixed(0) + " per IT-MWh") +
      kpi("CO₂ per 1M tokens", o.co2Kg[i].toFixed(3) + " kg", "PUE " + o.pue[i].toFixed(2)) +
      kpi("Water per 1M tokens", o.waterTotalL[i].toFixed(2) + " L", "on-site " + o.waterDirectL[i].toFixed(2) + " + power plants " + o.waterIndirectL[i].toFixed(2)) +
      kpi("Scarcity-weighted water", o.waterSwL[i].toFixed(2) + " L-eq", "local stress factor " + data.cf_local[i].toFixed(2)) +
      "</div>" +
      '<div class="driver">Main reason this county is <b>' + d.side + "</b> than the national median: <b>" + esc(d.driver) +
      "</b> (" + (d.deviation >= 0 ? "+" : "−") + fmtMoney(Math.abs(d.deviation)) + " vs that component's median).</div>" +
      '<p class="note">The token price is cost-based: the typical model price plus this county\'s facility-cost difference. ' +
      "It is not what AI providers charge, which is set nationally.</p>" +
      campusQuestions(i) +
      "<h3>Where the money goes</h3><div class=stack>" + stack + "</div><table class=breakdown>" + rows +
      "<tr><td><b>Total</b></td><td class=num><b>" + fmtMoney(total) + "</b></td><td></td></tr></table>" +
      "<h3>Context</h3><table class=breakdown>" +
      "<tr><td>Electricity price (industrial)</td><td class=num>$" + prep.price[i].toFixed(0) + " /MWh</td></tr>" +
      "<tr><td>Grid emission rate</td><td class=num>" + Math.round(data.grid_co2_rate_lb_per_mwh[i]).toLocaleString() + " lb CO₂/MWh</td></tr>" +
      "<tr><td>Baseline water stress (Aqueduct, 0–5)</td><td class=num>" + data.bws_score[i].toFixed(2) + "</td></tr>" +
      "<tr><td>Data centers (PNNL IM3 atlas)</td><td class=num>" + data.n_dc_pnnl[i] + (data.n_hyperscaler[i] ? " (" + data.n_hyperscaler[i] + " hyperscaler/AI)" : "") + "</td></tr>" +
      "<tr><td>Frontier AI campuses (Epoch AI)</td><td class=num>" + data.n_epoch[i] + "</td></tr></table>" +
      "<h3>Who bears it</h3><table class=breakdown>" +
      "<tr><td>Campus electricity, % of grid sales (" + esc(data.balancing_authority[i] === "state" ? "state" : data.balancing_authority[i] || "no BA matched") +
      ")</td><td class=num>" + (o.gridLoadPct[i] === null ? "–" : o.gridLoadPct[i].toFixed(2) + "%") + "</td></tr>" +
      "<tr><td>Rank change with social costs</td><td class=num>" + (o.socialRankShift[i] >= 0 ? "+" : "−") + Math.abs(o.socialRankShift[i]).toFixed(0) + " points</td></tr></table>" +
      "<h3>Context (not causal; not in the model)</h3><table class=breakdown>" +
      "<tr><td>Social vulnerability (FEMA NRI)</td><td class=num>" + (data.svi[i] === null ? "–" : data.svi[i].toFixed(0) + " / 100") + "</td></tr>" +
      "<tr><td>Median household income (SAIPE 2023)</td><td class=num>" + (data.median_hh_income[i] === null ? "–" : "$" + fmtInt(data.median_hh_income[i])) + "</td></tr>" +
      "<tr><td>2024 presidential, Democratic two-party share (information only)</td><td class=num>" + (data.vote_dem_two_party[i] === null ? "–" : (data.vote_dem_two_party[i] * 100).toFixed(0) + "%") + "</td></tr>" +
      "<tr><td>2026 midterm, U.S. House, Democratic two-party share (information only)</td><td class=num>" +
      (params.election.m2026.status !== "available" ? "pending certification" : data.vote26_house_dem_two_party[i] === null ? "–" :
        (data.vote26_house_dem_two_party[i] * 100).toFixed(0) + "%" + (data.vote26_flag_uncontested[i] ? " (part uncontested)" : "")) +
      "</td></tr></table>" +
      "<h3>Data quality</h3>" + (flags.length ? '<ul class="flags">' + flags.map(function (f) { return "<li>" + esc(f) + "</li>"; }).join("") + "</ul>"
        : '<p class="note">All model inputs observed for this county.</p>') +
      '<p class="prof-actions"><button class="btn" id="add-compare"' + (inCompare || state.compare.length >= 3 ? " disabled" : "") + ">" +
      (inCompare ? "In comparison" : state.compare.length >= 3 ? "Compare is full (3)" : "Add to comparison") + "</button>" +
      '<button class="btn" id="prof-link">Copy link</button><button class="btn" id="prof-png">Download card (PNG)</button></p>' +
      '<p class="disclaimer">Descriptive information, not a siting recommendation; associations are not causal effects. ' +
      "All parameters are provisional. <a href=\"about.html#limits\">Limitations</a></p>";
    el.hidden = false;
    el.querySelector(".close").onclick = function () { el.hidden = true; select(null); writeHash(); };
    $("prof-link").onclick = copyLink;
    $("prof-png").onclick = function () { downloadCard(i); };
    var b = $("add-compare");
    if (b) b.onclick = function () { if (state.compare.length < 3 && state.compare.indexOf(i) < 0) { state.compare.push(i); renderCompare(); renderProfile(i); } };
    if (map) map.resize();
  }
  /* Plain-language equivalents; conversion factors and sources come from params.web (src/config_web.yaml). */
  function equivalents(i) {
    var s = state.out.summary.scenario, b = params.baseline, eq = params.web.equivalents;
    var mwh = s.mw * b.scale.hours_per_year * state.out.pue[i];                         // facility MWh per year
    var onsite = mwh * b.cooling_scenarios[s.cooling].water_m3_per_mwh;                  // m3 per year
    var total = onsite + mwh * data.indirect_m3_per_mwh[i];
    var homes = mwh * 1000 / eq.household_kwh_per_year;
    return '<div class="equiv">Electricity: <b>' + fmtInt(mwh / 1000) + " GWh</b> ≈ the use of <b>" + fmtInt(homes) +
      "</b> average US homes.<br>On-site cooling water: <b>" + fmtInt(onsite) + " m³</b> ≈ <b>" + fmtInt(onsite / eq.olympic_pool_m3) +
      "</b> Olympic pools; including water used at power plants: <b>" + fmtInt(total / eq.olympic_pool_m3) + "</b> pools." +
      '<div class="src">1 home = ' + fmtInt(eq.household_kwh_per_year) + " kWh/yr (" + esc(eq.household_source) + "); 1 pool = " +
      fmtInt(eq.olympic_pool_m3) + " m³. Sources: <a href=\"about.html#equivalents\">About</a>.</div></div>";
  }

  // ---- v0.5: "What would a campus here mean?" question cards (facts + everyday equivalents; factors in params.web) -----
  function pueFor(i, coolKey) {                   // same PUE formula as model.js, for the comparison cooling type
    var c = params.baseline.cooling_scenarios[coolKey], ov = prep.override[i];
    return ov !== null && !isNaN(ov) ? ov : c.pue_base + Math.min(Math.max(prep.cddExcess[i] * c.pue_slope_per_1000_cdd, 0), c.pue_max_uplift);
  }
  function fmtPct(v) { return v === null || !isFinite(v) ? "–" : v >= 10 ? v.toFixed(0) + "%" : v >= 1 ? v.toFixed(1) + "%" : v.toFixed(2) + "%"; }
  function signedPct(x) { return (x >= 0 ? "+" : "−") + Math.abs(x * 100).toFixed(0) + "%"; }
  function fmtBig(v) { return v >= 1e6 ? (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + " million" : fmtInt(v); }
  function qcard(q, rows, caveat) {
    return '<div class="qcard"><h4>' + esc(q) + "</h4>" + rows.map(function (r) {
      return '<div class="qrow"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>";
    }).join("") + (caveat ? '<p class="qcav">' + caveat + "</p>" : "") + "</div>";
  }
  function campusQuestions(i) {
    var o = state.out, s = o.summary.scenario, b = params.baseline, q = params.web.campus_questions, eq = params.web.equivalents;
    var mw = s.mw, mwh = o.facilityMwh[i], cool = b.cooling_scenarios[s.cooling];
    var otherKey = s.cooling === "air_evaporative" ? "liquid_dry_coolers" : "air_evaporative";
    var otherMwh = mw * b.scale.hours_per_year * pueFor(i, otherKey), otherCool = b.cooling_scenarios[otherKey];
    var onsite = mwh * cool.water_m3_per_mwh, total = onsite + mwh * data.indirect_m3_per_mwh[i];
    var otherOnsite = otherMwh * otherCool.water_m3_per_mwh, otherTotal = otherOnsite + otherMwh * data.indirect_m3_per_mwh[i];
    var ps = data.ps_withdrawal_m3[i], cap = data.local_capacity_mw[i], emp = data.employment[i];
    var p14 = data.state_res_price_2014[i], p24 = data.state_res_price_2024[i];
    var tCo2 = mwh * prep.co2tPerMwh[i], acres = b.capex.land.acres_per_mw * mw, ops = s.staff * mw / 100;
    var coolName = function (k) { return k === "air_evaporative" ? "air / evaporative" : "liquid / dry coolers"; };
    var gridName = data.balancing_authority[i] === "state" ? "state" : data.balancing_authority[i] || "";
    var html = '<h3 id="campus-q">What would a ' + mw + " MW campus here mean?</h3>" +
      '<p class="note">Facts and everyday equivalents for one ' + mw + " MW (IT load) campus, " + coolName(s.cooling) +
      " cooling, running all year. They follow the scenario settings.</p>";
    html += qcard("Would it raise electricity bills?", [
      ["Campus electricity, share of regional grid sales" + (gridName ? " (" + esc(gridName) + ")" : ""), fmtPct(o.gridLoadPct[i])],
      ["Local industrial electricity price", "$" + prep.price[i].toFixed(0) + " /MWh"],
      ["State residential price, 2014 → 2024", (p14 / 10).toFixed(1) + "¢ → " + (p24 / 10).toFixed(1) + "¢ /kWh (" +
        signedPct(p24 / p14 - 1) + " nominal; " + signedPct(p24 / p14 / (q.cpi_u[2024] / q.cpi_u[2014]) - 1) + " after inflation)"]],
      "Context only: these figures do not show the campus's effect on bills, which depends on contracts and utility rate decisions.");
    html += qcard("Can the grid handle it?", [
      ["Annual electricity", fmtInt(mwh / 1000) + " GWh ≈ " + fmtBig(mwh * 1000 / eq.household_kwh_per_year) + " US homes"],
      ["Share of regional grid sales", fmtPct(o.gridLoadPct[i])],
      ["Peak power vs power plants in the county", cap > 0 ? fmtPct(mw * o.pue[i] / cap * 100) + " of " + fmtInt(cap) + " MW" : "no power plants in the county"]],
      "Capacity in the county is not the same as grid capacity: power is shared across the regional grid.");
    html += qcard("How much water?", [
      ["On-site cooling water per year", fmtBig(onsite) + " m³ ≈ " + fmtInt(onsite / eq.olympic_pool_m3) + " Olympic pools"],
      ["Including water used at power plants", fmtBig(total) + " m³ ≈ " + fmtInt(total / eq.olympic_pool_m3) + " pools"],
      ["Share of county public water supply", ps > 0 ? fmtPct(onsite / ps * 100) + " (on-site) · " + fmtPct(total / ps * 100) + " (total)" : "no data"],
      ["Local water stress (WRI Aqueduct)", waterStressBand(data.bws_score[i])],
      ["With " + coolName(otherKey) + " cooling instead", fmtBig(otherOnsite) + " m³ on-site · " + fmtBig(otherTotal) + " m³ total"]],
      "Public-supply comparison uses USGS 2015 withdrawals; power-plant water is used where the electricity is generated, not necessarily in this county.");
    html += qcard("How much carbon?", [
      ["CO₂ per year (grid average)", fmtBig(tCo2) + " t ≈ " + fmtBig(tCo2 / q.car_t_co2_per_year) + " passenger cars"],
      ["CO₂ per 1M AI tokens", o.co2Kg[i].toFixed(3) + " kg"]],
      "Uses the regional grid's average emission rate (EPA eGRID 2023); a new load's actual effect depends on which plants run more.");
    html += qcard("How much land?", [
      ["Site area (model assumption)", fmtInt(acres) + " acres ≈ " + fmtInt(acres / q.football_field_acres) + " football fields"]],
      "Assumes " + b.capex.land.acres_per_mw + " acre per MW; real campuses vary widely.");
    html += qcard("What would it bring?", [
      ["Operations jobs", fmtInt(ops) + " (" + fmtPct(ops / emp * 100) + " of county employment)"],
      ["Construction-phase jobs (18–24 months)", "≈ " + fmtInt(q.construction_jobs) + " (" + fmtPct(q.construction_jobs / emp * 100) + " of county employment)"]],
      "Construction estimate from an industry-sponsored report (US Chamber of Commerce, 2017), including indirect jobs; operations staffing is a model assumption.");
    html += '<p class="note qnot">' + esc(q.not_covered) + "</p>";
    return html;
  }

  function kpi(k, v, s) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + "</div></div>"; }

  function renderCompare() {
    var el = $("compare");
    if (!state.compare.length) { el.hidden = true; return; }
    var o = state.out, cs = state.compare;
    var rows = [
      ["10-year cost", function (i) { return fmtMoney(o.tco[i]); }],
      ["Cost Index", function (i) { return o.costIndex[i].toFixed(1); }],
      ["Percentile (0 = cheapest)", function (i) { return o.percentile[i].toFixed(0); }],
      ["Uncertainty 5–95%", function (i) { return isBaseline() ? data.mc_rank_p5[i].toFixed(0) + "–" + data.mc_rank_p95[i].toFixed(0) : "baseline scenario only"; }],
      ["PUE", function (i) { return o.pue[i].toFixed(2); }],
      ["Electricity price ($/MWh)", function (i) { return prep.price[i].toFixed(0); }],
      ["CapEx", function (i) { return fmtMoney(o.capex[i]); }],
      ["Electricity (PV)", function (i) { return fmtMoney(o.pvElectricity[i]); }],
      ["Carbon (PV)", function (i) { return fmtMoney(o.pvCarbon[i]); }],
      ["Water + surcharge (PV)", function (i) { return fmtMoney(o.pvWater[i] + o.pvWaterPenalty[i]); }],
      ["Operations staff (PV)", function (i) { return fmtMoney(o.pvLabor[i]); }],
      ["Main driver", function (i) { return o.driver[i].driver + " (" + (o.driver[i].side === "cheaper" ? "lowers" : "raises") + ")"; }],
      ["Price per 1M tokens (cost-based)", function (i) { return "$" + o.priceL1[i].toFixed(2) + " (" + pctVsMedian(o.priceL1[i]).replace(" vs national median", "") + ")"; }],
      ["CO₂ per 1M tokens (kg)", function (i) { return o.co2Kg[i].toFixed(3); }],
      ["Water per 1M tokens (L)", function (i) { return o.waterTotalL[i].toFixed(2); }],
      ["Scarcity-weighted water (L-eq)", function (i) { return o.waterSwL[i].toFixed(2); }],
      ["Estimated inputs", function (i) { return flagsOf(i).length ? flagsOf(i).length + " flag(s)" : "none"; }],
      ["Data centers / frontier campuses", function (i) { return data.n_dc_pnnl[i] + " / " + data.n_epoch[i]; }]
    ];
    el.innerHTML = "<h3><span>Compare counties (" + cs.length + " of 3)</span><button class='rm' id='clear-compare'>Clear</button></h3>" +
      "<table><tr><th></th>" + cs.map(function (i, k) {
        return "<th>" + esc(data.name[i]) + ", " + esc(data.state[i]) + " <button class='rm' data-rm='" + k + "' aria-label='Remove'>×</button></th>";
      }).join("") + "</tr>" +
      rows.map(function (r) { return "<tr><td>" + r[0] + "</td>" + cs.map(function (i) { return "<td>" + esc(r[1](i)) + "</td>"; }).join("") + "</tr>"; }).join("") +
      "</table>";
    el.hidden = false;
    el.querySelectorAll("[data-rm]").forEach(function (b) {
      b.onclick = function () { state.compare.splice(+b.dataset.rm, 1); renderCompare(); if (state.selected !== null) renderProfile(state.selected); };
    });
    $("clear-compare").onclick = function () { state.compare = []; renderCompare(); if (state.selected !== null) renderProfile(state.selected); };
    if (map) map.resize();
  }

  function select(i) {
    if (!map || !map.getSource("counties")) { state.pendingCounty = i; return; }
    if (state.selected !== null) map.setFeatureState({ source: "counties", id: +data.fips[state.selected] }, { selected: false });
    state.selected = i;
    if (i !== null) {
      map.setFeatureState({ source: "counties", id: +data.fips[i] }, { selected: true });
      renderProfile(i);
      writeHash();
    }
  }

  // ---- controls ------------------------------------------------------------------------------------------------------
  function syncControls() {
    var s = state.scenario;
    $("openShare").value = Math.round(s.openShare * 100); $("openShare-out").textContent = Math.round(s.openShare * 100) + "%";
    $("carbonPrice").value = s.carbonPrice; $("carbonPrice-out").textContent = "$" + s.carbonPrice;
    $("surchargeMax").value = Math.round(s.surchargeMax * 100); $("surchargeMax-out").textContent = Math.round(s.surchargeMax * 100) + "%";
    document.querySelectorAll("input[name=cooling]").forEach(function (r) { r.checked = r.value === s.cooling; });
    document.querySelectorAll("input[name=mw]").forEach(function (r) { r.checked = +r.value === s.mw; });
    var base = CostModel.baselineScenario(params);
    Object.keys(PRESETS).forEach(function (k) {
      var target = Object.assign({}, base, PRESETS[k]);
      var same = Object.keys(target).every(function (key) { return target[key] === s[key]; });
      var btn = document.querySelector("[data-preset=" + k + "]");
      btn.classList.toggle("active", same);
      btn.setAttribute("aria-pressed", same);
    });
  }

  var pending = false;
  function schedule() {
    syncControls();
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; recompute(); }, 0);   // not rAF: it pauses in background tabs
  }

  function bindControls() {
    $("openShare").oninput = function (e) { state.scenario.openShare = +e.target.value / 100; schedule(); };
    $("carbonPrice").oninput = function (e) { state.scenario.carbonPrice = +e.target.value; schedule(); };
    $("surchargeMax").oninput = function (e) { state.scenario.surchargeMax = +e.target.value / 100; schedule(); };
    document.querySelectorAll("input[name=cooling]").forEach(function (r) { r.onchange = function () { state.scenario.cooling = r.value; schedule(); }; });
    document.querySelectorAll("input[name=mw]").forEach(function (r) { r.onchange = function () { state.scenario.mw = +r.value; schedule(); }; });
    document.querySelectorAll("[data-preset]").forEach(function (b) {
      b.onclick = function () { state.scenario = Object.assign(CostModel.baselineScenario(params), PRESETS[b.dataset.preset]); schedule(); };
    });
    document.querySelectorAll("[data-jump]").forEach(function (b) { b.onclick = function () { map.fitBounds(BOUNDS[b.dataset.jump], { padding: 20 }); }; });
    $("layer-pnnl").onchange = function (e) {
      if (map && map.getLayer("dc-pnnl")) map.setLayoutProperty("dc-pnnl", "visibility", e.target.checked ? "visible" : "none");
      renderLayerLegend();
    };
    $("layer-epoch").onchange = function (e) {
      ["epoch-op", "epoch-planned"].forEach(function (l) {
        if (map && map.getLayer(l)) map.setLayoutProperty(l, "visibility", e.target.checked ? "visible" : "none");
      });
      renderLayerLegend();
    };
    bindSearch();
    $("download-scenario").onclick = downloadScenario;
    $("copy-link").onclick = copyLink;
    $("download-map").onclick = downloadMap;
    $("toggle-controls").onclick = function () {
      var c = $("controls"), open = !c.classList.contains("open");
      c.classList.toggle("open", open); this.setAttribute("aria-expanded", open);
      setTimeout(function () { map.resize(); }, 50);
    };
  }

  function downloadScenario() {
    var o = state.out, s = o.summary.scenario;
    var cols = ["fips", "name", "state", "tco_usd", "cost_index", "percentile_rank", "pue", "capex_usd", "pv_electricity_usd",
                "pv_carbon_usd", "pv_water_usd", "pv_water_surcharge_usd", "pv_labor_usd", "facility_cost_usd_per_it_mwh",
                "price_usd_per_1m_tokens", "co2_kg_per_1m_tokens", "water_total_l_per_1m_tokens", "water_scarcity_weighted_leq_per_1m_tokens",
                "dominant_driver", "flag_climate_estimated", "flag_price_state_average", "flag_price_commercial_proxy",
                "scenario_mw_it", "scenario_carbon_usd_per_t", "scenario_water_surcharge_max", "scenario_cooling", "scenario_open_share"];
    var q = function (x) { x = String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
    var lines = [cols.join(",")];
    for (var i = 0; i < data.fips.length; i++) {
      lines.push([data.fips[i], data.name[i], data.state[i], o.tco[i].toFixed(0), o.costIndex[i].toFixed(3), o.percentile[i].toFixed(2),
        o.pue[i].toFixed(3), o.capex[i].toFixed(0), o.pvElectricity[i].toFixed(0), o.pvCarbon[i].toFixed(0), o.pvWater[i].toFixed(0),
        o.pvWaterPenalty[i].toFixed(0), o.pvLabor[i].toFixed(0), o.costPerItMwh[i].toFixed(2), o.priceL1[i].toFixed(5),
        o.co2Kg[i].toFixed(5), o.waterTotalL[i].toFixed(5), o.waterSwL[i].toFixed(5), o.driver[i].driver,
        data.flag_climate_estimated[i], data.flag_price_state_average[i], data.flag_price_commercial_proxy[i],
        s.mw, s.carbonPrice, s.surchargeMax, s.cooling, s.openShare].map(q).join(","));
    }
    var blob = new Blob([lines.join("\n")], { type: "text/csv" }), a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "compute_cost_atlas_" + s.mw + "MW_" + s.cooling + "_carbon" + s.carbonPrice + ".csv";
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }


  // ---- v0.5: share, guide, footer, image export --------------------------------------------------------------------
  function toast(msg) {
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function copyLink() {
    writeHash();
    var url = location.href;
    var done = function () { toast("Link copied: it opens this exact view"); };
    var fallback = function () {
      var ta = document.createElement("textarea"); ta.value = url; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { window.prompt("Copy this link:", url); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
  }
  var GUIDE_KEY = "cca_start_here_seen_v1";
  function setupGuide() {
    var seen = false;
    try { seen = localStorage.getItem(GUIDE_KEY) === "1"; } catch (e) { seen = false; }   // storage may be blocked
    if (!seen && !/(^|&)county=/.test(location.hash.slice(1))) $("guide").hidden = false;
    $("guide-ok").onclick = function () {
      $("guide").hidden = true;
      try { localStorage.setItem(GUIDE_KEY, "1"); } catch (e) { /* not remembered; harmless */ }
      $("search").focus();
    };
    $("open-guide").onclick = function () { $("guide").hidden = false; $("guide-ok").focus(); };
  }
  function renderFooter() {
    var w = params.web.site;
    $("site-footer").innerHTML = "<p><b>Compute Cost Atlas</b> · preview v" + esc(w.version) + " · last updated " + esc(w.last_updated) + "</p>" +
      "<p>Cite as: " + esc(w.citation) + "</p>" +
      '<p><a href="' + esc(w.feedback_url) + '" target="_blank" rel="noopener">Feedback and issues (GitHub)</a> · <a href="about.html">About &amp; methods</a></p>';
  }

  /* PNG export: the map canvas plus a title, the current legend and the attribution, drawn with the 2D canvas API. */
  function scenarioLine() {
    var s = state.scenario;
    return s.mw + " MW · " + (s.cooling === "air_evaporative" ? "air cooling" : "liquid cooling") + " · carbon $" + s.carbonPrice +
      "/t · water surcharge " + Math.round(s.surchargeMax * 100) + "% · open-weight share " + Math.round(s.openShare * 100) + "%";
  }
  function drawLegend(ctx, x, y, w) {
    var m = activeDef();
    ctx.fillStyle = "#1f1f1f"; ctx.font = "600 13px system-ui, sans-serif"; ctx.fillText(m.label, x, y); y += 10;
    if (m.pending) { ctx.font = "12px system-ui, sans-serif"; ctx.fillText("2026 results pending certification (no data shown)", x, y + 14); return y + 24; }
    if (m.kind === "cat") {
      ctx.font = "12px system-ui, sans-serif";
      var keys = Object.keys(DRIVER_COLORS), col = 0;
      keys.forEach(function (k, n) {
        var cx = x + (n % 2) * (w / 2), cy = y + 6 + Math.floor(n / 2) * 18;
        ctx.fillStyle = DRIVER_COLORS[k]; ctx.fillRect(cx, cy, 10, 10);
        ctx.fillStyle = lighten(DRIVER_COLORS[k], 0.55); ctx.fillRect(cx + 11, cy, 10, 10);
        ctx.fillStyle = "#1f1f1f"; ctx.fillText(k, cx + 26, cy + 9); col = cy;
      });
      ctx.fillStyle = "#555"; ctx.fillText("dark = raises cost, light = lowers cost (vs national median)", x, col + 30);
      return col + 40;
    }
    if (m.kind === "bivar") {
      for (var r = 0; r < 3; r++) for (var q = 0; q < 3; q++) { ctx.fillStyle = BIVAR[2 - r][q]; ctx.fillRect(x + q * 17, y + 6 + r * 17, 16, 16); }
      ctx.fillStyle = "#1f1f1f"; ctx.font = "12px system-ui, sans-serif";
      ctx.fillText("→ facility cost (national thirds)", x + 60, y + 52); ctx.fillText("↑ " + m.yName + " per 1M tokens", x + 60, y + 20);
      return y + 66;
    }
    var d = state.domain, g = ctx.createLinearGradient(x, 0, x + w, 0);
    d.ramp.forEach(function (c, k) { g.addColorStop(k / (d.ramp.length - 1), c); });
    ctx.fillStyle = g; ctx.fillRect(x, y + 4, w, 12);
    ctx.fillStyle = "#333"; ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "left"; ctx.fillText(m.tick(d.lo), x, y + 32);
    ctx.textAlign = "right"; ctx.fillText(m.tick(d.hi), x + w, y + 32);
    if (d.kind === "div") { ctx.textAlign = "center"; ctx.fillText(m.tick(d.center) + " (median)", x + w / 2, y + 32); }
    ctx.textAlign = "left";
    return y + 44;
  }
  function wrapText(ctx, text, x, y, maxW, lineH) {   // returns the y after the last line
    var words = text.split(" "), line = "";
    words.forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = w; } else line = t;
    });
    if (line) { ctx.fillText(line, x, y); y += lineH; }
    return y;
  }
  function savePng(canvas, name) {
    canvas.toBlob(function (b) {
      var a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = name; a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    }, "image/png");
  }
  function downloadMap() {
    map.once("render", function () {
      var src = map.getCanvas(), dpr = src.width / src.clientWidth, W = src.clientWidth, H = src.clientHeight, pad = 16;
      var out = document.createElement("canvas"); out.width = (W) * dpr; out.height = (H + 190) * dpr;
      var ctx = out.getContext("2d"); ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H + 190);
      ctx.fillStyle = "#1f1f1f"; ctx.font = "700 16px system-ui, sans-serif"; ctx.fillText("Compute Cost Atlas (preview)", pad, 24);
      ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#555"; wrapText(ctx, scenarioLine(), pad, 42, W - 2 * pad, 14);
      ctx.drawImage(src, 0, 0, src.width, src.height, 0, 52, W, H - 4);
      var y = drawLegend(ctx, pad, H + 66, Math.min(360, W - 2 * pad));
      ctx.fillStyle = "#666"; ctx.font = "10.5px system-ui, sans-serif";
      var ya = wrapText(ctx, "Boundaries: US Census Bureau · Basemap: Natural Earth · Data centers: PNNL IM3, © OpenStreetMap contributors (ODbL) · Frontier campuses: Epoch AI (CC BY 4.0)",
                        pad, Math.max(y + 8, H + 116), W - 2 * pad, 14);
      wrapText(ctx, params.web.site.citation + " Costs exclude IT hardware. Not a siting recommendation.", pad, ya, W - 2 * pad, 14);
      savePng(out, "compute_cost_atlas_map.png");
    });
    map.triggerRepaint();
  }
  function downloadCard(i) {
    var o = state.out, d = o.driver[i], W = 520, rows = [
      ["10-year cost (excl. IT hardware)", "$" + (o.tco[i] / 1e9).toFixed(2) + " bn"],
      ["Cost Index (median = 50)", o.costIndex[i].toFixed(1) + " · percentile " + o.percentile[i].toFixed(0)],
      ["Main driver", d.driver + " (" + (d.side === "more expensive" ? "raises" : "lowers") + " cost)"],
      ["Price per 1M tokens (cost-based)", "$" + o.priceL1[i].toFixed(2) + " (" + pctVsMedian(o.priceL1[i]) + ")"],
      ["CO₂ per 1M tokens", o.co2Kg[i].toFixed(3) + " kg"],
      ["Scarcity-weighted water per 1M tokens", o.waterSwL[i].toFixed(2) + " L-eq"],
      ["Electricity price (industrial)", "$" + prep.price[i].toFixed(0) + " /MWh"],
      ["Water stress", waterStressBand(data.bws_score[i])],
      ["Campus electricity, % of regional grid sales", fmtPct(o.gridLoadPct[i])],
      ["Data centers / frontier AI campuses", data.n_dc_pnnl[i] + " / " + data.n_epoch[i]]];
    var meas = document.createElement("canvas").getContext("2d");
    meas.font = "12px system-ui, sans-serif";
    var sub = "Population " + fmtInt(data.population[i]) + " · " + scenarioLine();
    var nSub = 1, line = "";
    sub.split(" ").forEach(function (w) { var t = line ? line + " " + w : w; if (meas.measureText(t).width > W - 40 && line) { nSub++; line = w; } else line = t; });
    var dy = (nSub - 1) * 16;                           // extra height for wrapped subtitle lines
    var H = 120 + dy + rows.length * 26 + 70, dpr = 2, c = document.createElement("canvas");
    c.width = W * dpr; c.height = H * dpr;
    var ctx = c.getContext("2d"); ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#1f1f1f"; ctx.font = "700 20px system-ui, sans-serif"; ctx.fillText(data.name[i] + ", " + data.state[i], 20, 36);
    ctx.font = "12px system-ui, sans-serif"; ctx.fillStyle = "#555";
    wrapText(ctx, sub, 20, 56, W - 40, 16);
    var g = ctx.createLinearGradient(20, 0, W - 20, 0);
    DIVERGING.forEach(function (col, k) { g.addColorStop(k / (DIVERGING.length - 1), col); });
    ctx.fillStyle = g; ctx.fillRect(20, 72 + dy, W - 40, 8);
    var mx = 20 + (W - 40) * o.percentile[i] / 100;
    ctx.fillStyle = "#1f1f1f"; ctx.fillRect(mx - 1.5, 67 + dy, 3, 18);
    ctx.font = "11px system-ui, sans-serif"; ctx.fillStyle = "#666"; ctx.fillText("cheapest", 20, 98 + dy);
    ctx.textAlign = "right"; ctx.fillText("most expensive", W - 20, 98 + dy); ctx.textAlign = "left";
    rows.forEach(function (r, k) {
      var y = 128 + dy + k * 26;
      ctx.fillStyle = "#555"; ctx.font = "13px system-ui, sans-serif"; ctx.fillText(r[0], 20, y);
      ctx.fillStyle = "#1f1f1f"; ctx.font = "600 13px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText(r[1], W - 20, y);
      ctx.textAlign = "left"; ctx.fillStyle = "#eee"; ctx.fillRect(20, y + 8, W - 40, 1);
    });
    ctx.fillStyle = "#666"; ctx.font = "11px system-ui, sans-serif";
    ctx.fillText("Compute Cost Atlas, preview v" + params.web.site.version + " · descriptive, not a siting recommendation", 20, H - 34);
    ctx.fillText(params.web.site.citation, 20, H - 18);
    savePng(c, "compute_cost_atlas_" + data.fips[i] + ".png");
  }

  // ---- search (local type-ahead over county + state names; no geocoder) ------------------------------------------------
  var STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado",
    CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho",
    IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
    MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska",
    NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina",
    ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
    SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
    WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  var searchIndex = [], countyBBox = {}, hits = [], active = -1;
  function norm(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " "); }

  function buildSearchIndex() {
    data.fips.forEach(function (f, i) {
      var st = data.state[i];
      searchIndex.push({ i: i, label: data.name[i] + ", " + st, name: norm(data.name[i]),
                         key: norm(data.name[i] + " " + st + " " + (STATE_NAMES[st] || "")) });
    });
  }
  function searchCounties(q) {
    var words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    var out = searchIndex.filter(function (r) {
      var toks = r.key.split(/\s+/);
      return words.every(function (w) { return toks.some(function (t) { return t.indexOf(w) === 0; }); });
    });
    out.sort(function (a, b) {                     // name starts with the query first, then larger population
      var sa = a.name.indexOf(words[0]) === 0 ? 0 : 1, sb = b.name.indexOf(words[0]) === 0 ? 0 : 1;
      return sa - sb || data.population[b.i] - data.population[a.i];
    });
    return out.slice(0, 8);
  }
  function renderHits() {
    var ul = $("search-results"), input = $("search");
    if (!input.value.trim()) { ul.hidden = true; input.setAttribute("aria-expanded", "false"); return; }
    ul.innerHTML = hits.length ? hits.map(function (h, k) {
      return '<li role="option" id="hit-' + k + '" data-k="' + k + '" aria-selected="' + (k === active) + '">' + esc(h.label) +
        "<small>pop. " + Number(data.population[h.i]).toLocaleString() + "</small></li>";
    }).join("") : '<li class="empty">No county found</li>';
    ul.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", active >= 0 ? "hit-" + active : "");
    ul.querySelectorAll("[data-k]").forEach(function (li) {
      li.onmousedown = function (e) { e.preventDefault(); };          // keep focus so blur does not close the list
      li.onclick = function () { choose(hits[+li.dataset.k].i); };
    });
  }
  function choose(i) {
    $("search").value = data.name[i] + ", " + data.state[i];
    hits = []; active = -1; renderHits(); $("search-results").hidden = true;
    zoomTo(i);
    select(i);
  }
  function zoomTo(i) {
    var bb = countyBBox[data.fips[i]];
    if (bb && map) map.fitBounds(bb, { padding: 60, maxZoom: 6.5, duration: 800 });   // keep neighbours in view
  }
  function bindSearch() {
    var input = $("search");
    input.oninput = function () { hits = searchCounties(input.value); active = hits.length ? 0 : -1; renderHits(); };
    input.onkeydown = function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!hits.length) return;
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
        renderHits();
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault(); choose(hits[active].i);
      } else if (e.key === "Escape") {
        input.value = ""; hits = []; renderHits();
      }
    };
    input.onblur = function () { setTimeout(function () { $("search-results").hidden = true; }, 150); };
  }
  function computeBBoxes(counties) {
    counties.features.forEach(function (f) {
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      (function walk(c) {
        if (typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }
        else c.forEach(walk);
      })(f.geometry.coordinates);
      countyBBox[f.properties.fips] = [[b[0], b[1]], [b[2], b[3]]];
    });
  }

  // ---- theme / view controls -----------------------------------------------------------------------------------------
  function fillThemes() {
    $("theme").innerHTML = THEMES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.label) + "</option>"; }).join("");
    $("theme").value = state.theme;
    fillMetrics();
  }
  function fillMetrics() {
    var th = THEMES.filter(function (t) { return t.id === state.theme; })[0];
    if (th.metrics.indexOf(state.metric) < 0) state.metric = th.metrics[0];
    $("metric").innerHTML = th.metrics.map(function (k) { return '<option value="' + k + '">' + esc(METRICS[k].label) + "</option>"; }).join("");
    $("metric").value = state.metric;
  }
  function bindViewControls() {
    $("theme").onchange = function (e) { state.theme = e.target.value; fillMetrics(); paint(); writeHash(); };
    $("metric").onchange = function (e) { state.metric = e.target.value; paint(); writeHash(); };
    $("diff-toggle").onchange = function (e) {
      state.diff = e.target.checked ? document.querySelector("input[name=diffmode]:checked").value : null;
      $("diff-mode").hidden = !e.target.checked; paint(); writeHash();
    };
    document.querySelectorAll("input[name=diffmode]").forEach(function (r) {
      r.onchange = function () { if (state.diff) { state.diff = r.value; paint(); writeHash(); } };
    });
    $("extrude-toggle").onchange = function (e) { setExtrude(e.target.checked); writeHash(); };
    document.querySelectorAll("input[name=votemode]").forEach(function (r) {
      r.onchange = function () { state.voteMode = r.value; paint(); writeHash(); };
    });
    $("layer-cities").onchange = function () { updateCities(); writeHash(); };
  }
  function setExtrude(on) {
    state.extrude = on;
    if (!map || !map.getLayer("county-3d")) return;
    map.setLayoutProperty("county-3d", "visibility", on ? "visible" : "none");
    if (on) { map.dragRotate.enable(); map.easeTo({ pitch: 52, bearing: -12, duration: 900 }); }
    else { map.easeTo({ pitch: 0, bearing: 0, duration: 600 }); map.dragRotate.disable(); }
    renderLegend();
  }

  // ---- URL state (shareable views; also used for reproducible screenshots) --------------------------------------------
  function writeHash() {
    if (!state.out) return;
    var s = state.scenario, b = CostModel.baselineScenario(params), h = { theme: state.theme, metric: state.metric };
    if (s.carbonPrice !== b.carbonPrice) h.carbon = s.carbonPrice;
    if (s.openShare !== b.openShare) h.open = Math.round(s.openShare * 100);
    if (s.surchargeMax !== b.surchargeMax) h.surcharge = Math.round(s.surchargeMax * 100);
    if (s.cooling !== b.cooling) h.cooling = s.cooling === "liquid_dry_coolers" ? "liquid" : "air";
    if (s.mw !== b.mw) h.mw = s.mw;
    if (state.diff) h.diff = state.diff;
    if (state.metric === "vote") h.vote = state.voteMode;
    if (state.extrude) h["3d"] = 1;
    var lay = ["pnnl", "epoch", "cities"].filter(function (k) { return $("layer-" + k).checked; });
    if (lay.length) h.layers = lay.join(",");
    if (state.selected !== null) h.county = data.fips[state.selected];
    history.replaceState(null, "", "#" + Object.keys(h).map(function (k) { return k + "=" + encodeURIComponent(h[k]); }).join("&"));
  }
  function readHash() {
    var h = {};
    location.hash.replace(/^#/, "").split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) h[p[0]] = decodeURIComponent(p[1] || ""); });
    if (h.theme && THEMES.some(function (t) { return t.id === h.theme; })) state.theme = h.theme;
    if (h.metric && METRICS[h.metric]) state.metric = h.metric;
    var s = state.scenario;
    if (h.carbon) s.carbonPrice = +h.carbon;
    if (h.open) s.openShare = +h.open / 100;
    if (h.surcharge) s.surchargeMax = +h.surcharge / 100;
    if (h.cooling) s.cooling = h.cooling === "liquid" ? "liquid_dry_coolers" : "air_evaporative";
    if (h.mw) s.mw = +h.mw;
    if (h.diff && DIFF[h.diff]) {
      state.diff = h.diff; $("diff-toggle").checked = true; $("diff-mode").hidden = false;
      document.querySelectorAll("input[name=diffmode]").forEach(function (r) { r.checked = r.value === h.diff; });
    }
    if (h.vote && VOTE_MODES[h.vote]) {
      state.voteMode = h.vote;
      document.querySelectorAll("input[name=votemode]").forEach(function (r) { r.checked = r.value === h.vote; });
    }
    if (h["3d"]) { state.extrude = true; $("extrude-toggle").checked = true; }
    (h.layers || "").split(",").forEach(function (k) { if ($("layer-" + k)) $("layer-" + k).checked = true; });
    return h;
  }

  // ---- basemap context: Natural Earth cities as HTML markers (no font server needed) -----------------------------------
  function buildCities(cities) {
    cityMarkers = cities.features.map(function (f) {
      var el = document.createElement("div");
      el.className = "city";
      el.innerHTML = '<span class="dot"></span><span class="lbl">' + esc(f.properties.name) + "</span>";
      return { pop: f.properties.pop_max, marker: new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat(f.geometry.coordinates) };
    });
  }
  function updateCities() {
    var on = $("layer-cities").checked, z = map ? map.getZoom() : 0;
    var minPop = z < 4 ? 2000000 : z < 5 ? 750000 : 0;          // fewer labels when zoomed out
    var placed = [];                                             // skip labels that would overlap a larger city's label
    cityMarkers.forEach(function (c) {                           // (cityMarkers is sorted by population, largest first)
      var show = on && c.pop >= minPop;
      if (show && map) {
        var pt = map.project(c.marker.getLngLat());
        show = !placed.some(function (q) { return Math.abs(q.x - pt.x) < 90 && Math.abs(q.y - pt.y) < 14; });
        if (show) placed.push(pt);
      }
      if (show && !c.added) { c.marker.addTo(map); c.added = true; }
      if (!show && c.added) { c.marker.remove(); c.added = false; }
    });
  }

  // ---- map -----------------------------------------------------------------------------------------------------------
  var OCEAN = "#e4e9ed", LAND = "#eeede9";
  function buildMap(counties, states, pnnl, epoch, land, lakes, borders) {
    map = new maplibregl.Map({
      container: "map",
      style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": OCEAN } }] },
      bounds: BOUNDS.l48, fitBoundsOptions: { padding: 10 }, attributionControl: false, dragRotate: false, pitchWithRotate: false,
      maxPitch: 70, preserveDrawingBuffer: true
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution:
      "Boundaries: US Census Bureau · Basemap: Natural Earth · Data centers: PNNL IM3 atlas, © OpenStreetMap contributors (ODbL) · Frontier campuses: Epoch AI (CC BY 4.0)" }));
    map.on("load", function () {
      [["land", land], ["lakes", lakes], ["borders", borders], ["counties", counties], ["states", states], ["pnnl", pnnl], ["epoch", epoch]]
        .forEach(function (s) { map.addSource(s[0], { type: "geojson", data: s[1] }); });
      map.addLayer({ id: "land", type: "fill", source: "land", paint: { "fill-color": LAND } });
      map.addLayer({ id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": OCEAN } });
      map.addLayer({ id: "borders", type: "line", source: "borders", paint: { "line-color": "#c4c2bc", "line-width": 0.7 } });
      var colorExpr = ["case", ["==", ["typeof", ["feature-state", "col"]], "string"], ["to-color", ["feature-state", "col"]], NODATA];
      map.addLayer({ id: "county-fill", type: "fill", source: "counties", paint: { "fill-color": colorExpr } });
      map.addLayer({ id: "county-line", type: "line", source: "counties",
        paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 0.1, 7, 0.6], "line-opacity": 0.7 } });
      map.addLayer({ id: "state-line", type: "line", source: "states", paint: { "line-color": "#6b6b6b", "line-width": 0.6 } });
      map.addLayer({ id: "county-3d", type: "fill-extrusion", source: "counties", layout: { visibility: "none" },
        paint: { "fill-extrusion-color": colorExpr, "fill-extrusion-opacity": 0.95, "fill-extrusion-base": 0,
                 "fill-extrusion-height": ["*", ["coalesce", ["feature-state", "h"], 0], EXTRUDE_M] } });
      map.addLayer({ id: "county-hover", type: "line", source: "counties",
        paint: { "line-color": "#1a1a1a", "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.2,
                                                         ["boolean", ["feature-state", "hover"], false], 1.2, 0] } });
      map.addLayer({ id: "dc-pnnl", type: "circle", source: "pnnl", layout: { visibility: "none" },
        paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 1.8, 8, 4], "circle-color": "#1a1a1a", "circle-opacity": 0.75 } });
      map.addLayer({ id: "epoch-op", type: "circle", source: "epoch", filter: ["==", ["get", "status"], "operating"], layout: { visibility: "none" },
        paint: { "circle-radius": ["+", 3.5, ["*", 7, ["sqrt", ["/", ["get", "mw"], 1000]]]], "circle-color": "#CC79A7",
                 "circle-stroke-color": "#ffffff", "circle-stroke-width": 1 } });
      map.addLayer({ id: "epoch-planned", type: "circle", source: "epoch", filter: ["==", ["get", "status"], "planned"], layout: { visibility: "none" },
        paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#CC79A7", "circle-stroke-width": 1.6 } });

      paint();
      $("loading").hidden = true;
      map.setLayoutProperty("dc-pnnl", "visibility", $("layer-pnnl").checked ? "visible" : "none");
      ["epoch-op", "epoch-planned"].forEach(function (l) { map.setLayoutProperty(l, "visibility", $("layer-epoch").checked ? "visible" : "none"); });
      renderLayerLegend();
      updateCities();
      map.on("moveend", updateCities);
      if (state.extrude) setExtrude(true);
      if (state.pendingCounty !== undefined) { select(state.pendingCounty); zoomTo(state.pendingCounty); }   // shared link
      var collapseAttrib = function () {                   // keep the attribution collapsed (the "i" button) on phones
        var at = document.querySelector(".maplibregl-ctrl-attrib");
        if (at && window.innerWidth < 860) at.classList.remove("maplibregl-compact-show");
      };
      collapseAttrib();
      window.addEventListener("resize", collapseAttrib);

      var tip = $("tooltip"), lastTip = null, touch = window.matchMedia("(hover: none)").matches, tapped = null;
      function placeTip(pt) {                     // beside the cursor, never under it, never off the map edges
        var W = map.getContainer().clientWidth, H = map.getContainer().clientHeight, w = tip.offsetWidth, h = tip.offsetHeight, g = 16;
        var x = pt.x + g + w > W - 4 ? pt.x - g - w : pt.x + g;
        var y = pt.y + g + h > H - 4 ? pt.y - g - h : pt.y + g;
        tip.style.left = Math.max(4, x) + "px";
        tip.style.top = Math.max(4, Math.min(y, H - h - 4)) + "px";
      }
      function showCounty(i, docked) {
        var key = i + "|" + (docked ? 1 : 0) + "|" + state.metric + "|" + state.diff + "|" + state.voteMode;
        if (key !== lastTip) {                    // rebuild only when the county (or layer) changes
          tip.innerHTML = tooltipCard(i, docked);
          tip.className = "tooltip tc" + (docked ? " docked" : "");
          lastTip = key;
          if (docked) {
            $("tc-open").onclick = function () { tip.hidden = true; lastTip = null; tapped = null; select(i); writeHash(); };
            $("tc-close").onclick = function () { tip.hidden = true; lastTip = null; tapped = null; };
          }
        }
        tip.hidden = false;
        if (docked) { tip.style.left = ""; tip.style.top = ""; }
      }
      var pendingMove = null;
      map.on("mousemove", function (e) {
        if (touch) return;
        if (pendingMove) { pendingMove.point = e.point; return; }
        pendingMove = { point: e.point };
        requestAnimationFrame(function () {       // at most one query per frame: no lag when sweeping across counties
          var pt = pendingMove.point; pendingMove = null;
          var f = map.queryRenderedFeatures(pt, { layers: ["epoch-op", "epoch-planned", "dc-pnnl", "county-fill"] })[0];
          if (!f) { tip.hidden = true; lastTip = null; setHover(null); return; }
          if (f.layer.id === "county-fill") {
            var i = fipsIndex[String(f.id).padStart(5, "0")];
            setHover(f.id);
            showCounty(i, false);
          } else {
            setHover(null);
            var p = f.properties;
            tip.className = "tooltip";
            lastTip = null;
            tip.innerHTML = f.layer.id === "dc-pnnl" ? "<b>Data center</b>" + esc(p.operator || "operator unknown") + "<br>" + esc(p["class"]) +
              "<br><small>PNNL IM3 / © OSM contributors</small>" :
              "<b>" + esc(p.name) + "</b>" + esc(p.owner) + "<br>" + (p.status === "operating" ? Math.round(p.mw) + " MW operating" : "planned") +
              "<br><small>Epoch AI (CC BY 4.0)</small>";
            tip.hidden = false;
          }
          placeTip(pt);
        });
      });
      map.getCanvas().addEventListener("mouseleave", function () { if (!touch) { tip.hidden = true; lastTip = null; setHover(null); } });
      map.on("click", "county-fill", function (e) {
        var i = fipsIndex[String(e.features[0].id).padStart(5, "0")];
        if (touch && tapped !== i) {              // phone: first tap shows the card docked at the bottom
          tapped = i; setHover(e.features[0].id); showCounty(i, true);
          var H = map.getContainer().clientHeight, free = H - tip.offsetHeight - 40;   // keep the county visible above the card
          if (e.point.y > free - 20) map.panBy([0, e.point.y - free / 2], { duration: 300 });
          return;
        }
        tapped = null; tip.hidden = true; lastTip = null;
        select(i); writeHash();
      });
      map.on("mouseenter", "county-fill", function () { map.getCanvas().style.cursor = "pointer"; });
      window.atlas.pointOf = function (fips) {   // page position of a pixel inside the county (tests / screenshots)
        var bb = countyBBox[fips], a = map.project(bb[0]), b = map.project(bb[1]), r = map.getCanvas().getBoundingClientRect();
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, best = null;
        for (var k = 0; k <= 12 && !best; k++) for (var dx = -k; dx <= k && !best; dx++) for (var dy = -k; dy <= k && !best; dy++) {
          var p = [cx + dx * Math.abs(b.x - a.x) / 26, cy + dy * Math.abs(b.y - a.y) / 26];
          var f = map.queryRenderedFeatures(p, { layers: ["county-fill"] })[0];
          if (f && String(f.id).padStart(5, "0") === fips) best = p;
        }
        best = best || [cx, cy];
        return { x: r.left + best[0], y: r.top + best[1] };
      };
      window.atlas.map = map;                     // for tests (timing, placement)
      window.atlas.card = tooltipCard;
      window.atlas.tapCounty = function (fips) { tapped = fipsIndex[fips]; showCounty(tapped, true); };
      document.body.dataset.ready = "1";             // for headless screenshots
    });
  }
  function setHover(id) {
    if (state.hover !== null) map.setFeatureState({ source: "counties", id: state.hover }, { hover: false });
    state.hover = id;
    if (id !== null) map.setFeatureState({ source: "counties", id: id }, { hover: true });
  }

  // ---- start ---------------------------------------------------------------------------------------------------------
  function getJSON(p) { return fetch(p).then(function (r) { if (!r.ok) throw new Error(p + " " + r.status); return r.json(); }); }
  Promise.all(["data/counties.json", "data/params.json", "data/counties.geojson", "data/states.geojson", "data/dc_pnnl.geojson",
               "data/dc_epoch.geojson", "data/land.geojson", "data/lakes.geojson", "data/borders.geojson", "data/cities.geojson"]
              .map(getJSON)).then(function (res) {
    data = res[0]; params = res[1];
    data.fips.forEach(function (f, i) { fipsIndex[f] = i; l48Mask.push(data.state[i] !== "AK" && data.state[i] !== "HI"); });
    prep = CostModel.prepare(data, params);
    buildSearchIndex();
    computeBBoxes(res[2]);
    state.scenario = CostModel.baselineScenario(params);
    state.base = CostModel.run(prep, CostModel.baselineScenario(params));
    var h = readHash();
    window.addEventListener("hashchange", function () { location.reload(); });   // pasted / edited links (replaceState does not fire it)
    if (h.county && fipsIndex[h.county] !== undefined) state.pendingCounty = fipsIndex[h.county];
    state.out = CostModel.run(prep, state.scenario);
    fillThemes();
    syncControls();
    renderSummary();
    bindControls();
    bindViewControls();
    renderFooter();
    setupGuide();
    buildCities(res[9]);
    buildMap(res[2], res[3], res[4], res[5], res[6], res[7], res[8]);
    window.atlas = { state: state, select: function (fips) { select(fipsIndex[fips]); }, compare: function (list) {
      state.compare = list.map(function (f) { return fipsIndex[f]; }); renderCompare(); } };
  }).catch(function (err) {
    $("loading").textContent = "Could not load data: " + err.message + ". Serve this folder over HTTP (see README).";
  });
})();
