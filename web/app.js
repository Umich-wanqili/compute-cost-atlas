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
          '</div><div class="s" title="' + esc(params.web.monte_carlo.note) + '">uncertainty (5–95%, baseline): ' +
          data.mc_rank_p5[i].toFixed(0) + "–" + data.mc_rank_p95[i].toFixed(0)) +
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
      "<h3>In everyday terms (one year of operation)</h3>" + equivalents(i) +
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
      '<p><button class="btn" id="add-compare"' + (inCompare || state.compare.length >= 3 ? " disabled" : "") + ">" +
      (inCompare ? "In comparison" : state.compare.length >= 3 ? "Compare is full (3)" : "Add to comparison") + "</button></p>" +
      '<p class="disclaimer">Descriptive information, not a siting recommendation; associations are not causal effects. ' +
      "All parameters are provisional. <a href=\"about.html#limits\">Limitations</a></p>";
    el.hidden = false;
    el.querySelector(".close").onclick = function () { el.hidden = true; select(null); };
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
  function kpi(k, v, s) { return '<div class="kpi"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + "</div></div>"; }

  function renderCompare() {
    var el = $("compare");
    if (!state.compare.length) { el.hidden = true; return; }
    var o = state.out, cs = state.compare;
    var rows = [
      ["10-year cost", function (i) { return fmtMoney(o.tco[i]); }],
      ["Cost Index", function (i) { return o.costIndex[i].toFixed(1); }],
      ["Percentile (0 = cheapest)", function (i) { return o.percentile[i].toFixed(0); }],
      ["Uncertainty 5–95% (baseline)", function (i) { return data.mc_rank_p5[i].toFixed(0) + "–" + data.mc_rank_p95[i].toFixed(0); }],
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
    if (bb && map) map.fitBounds(bb, { padding: 60, maxZoom: 8, duration: 800 });
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
      if (state.pendingCounty !== undefined) { select(state.pendingCounty); }
      var collapseAttrib = function () {                   // keep the attribution collapsed (the "i" button) on phones
        var at = document.querySelector(".maplibregl-ctrl-attrib");
        if (at && window.innerWidth < 860) at.classList.remove("maplibregl-compact-show");
      };
      collapseAttrib();
      window.addEventListener("resize", collapseAttrib);

      var tip = $("tooltip");
      map.on("mousemove", function (e) {
        var f = map.queryRenderedFeatures(e.point, { layers: ["epoch-op", "epoch-planned", "dc-pnnl", "county-fill"] })[0];
        if (!f) { tip.hidden = true; setHover(null); return; }
        if (f.layer.id === "county-fill") {
          var i = fipsIndex[String(f.id).padStart(5, "0")];
          setHover(f.id);
          tip.innerHTML = "<b>" + esc(data.name[i]) + ", " + esc(data.state[i]) + "</b><span class=v>" + esc(tooltipValue(i)) +
            "</span><br><span class=v>Cost Index " + state.out.costIndex[i].toFixed(1) + "</span>";
        } else {
          setHover(null);
          var p = f.properties;
          tip.innerHTML = f.layer.id === "dc-pnnl" ? "<b>Data center</b>" + esc(p.operator || "operator unknown") + "<br>" + esc(p["class"]) +
            "<br><small>PNNL IM3 / © OSM contributors</small>" :
            "<b>" + esc(p.name) + "</b>" + esc(p.owner) + "<br>" + (p.status === "operating" ? Math.round(p.mw) + " MW operating" : "planned") +
            "<br><small>Epoch AI (CC BY 4.0)</small>";
        }
        tip.style.left = Math.min(e.point.x + 14, map.getContainer().clientWidth - 250) + "px";
        tip.style.top = (e.point.y + 14) + "px";
        tip.hidden = false;
      });
      map.on("mouseleave", "county-fill", function () { tip.hidden = true; setHover(null); });
      map.on("click", "county-fill", function (e) { select(fipsIndex[String(e.features[0].id).padStart(5, "0")]); writeHash(); });
      map.on("mouseenter", "county-fill", function () { map.getCanvas().style.cursor = "pointer"; });
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
    buildCities(res[9]);
    buildMap(res[2], res[3], res[4], res[5], res[6], res[7], res[8]);
    window.atlas = { state: state, select: function (fips) { select(fipsIndex[fips]); }, compare: function (list) {
      state.compare = list.map(function (f) { return fipsIndex[f]; }); renderCompare(); } };
  }).catch(function (err) {
    $("loading").textContent = "Could not load data: " + err.message + ". Serve this folder over HTTP (see README).";
  });
})();
