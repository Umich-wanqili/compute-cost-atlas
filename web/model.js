/* County data-center cost model + token layer, JavaScript port (prototype v0).
 *
 * Source of truth: src/cost_model.py (baseline TCO), src/monte_carlo.py Model.run (cooling scenarios, carbon price,
 * water-stress surcharge, scale) and src/token_cost.py (token layer). Every number comes from web/data/params.json,
 * exported from the YAML configs by src/export_web_data.py; this file holds no parameters.
 * Parity with Python: tests/test_web_parity.py (every county within 0.1%).
 *
 * Units: $ nominal; energy MWh; CO2 kg; water litres. CapEx excludes IT hardware (GPUs/servers).
 * Plain script (no modules) so it runs both in the browser (window.CostModel) and in the QuickJS parity test.
 */
var CostModel = (function () {
  "use strict";

  var DRIVERS = ["Construction (labor-adjusted)", "Land", "Hazard premium", "Electricity", "Carbon",
                 "Water (incl. stress surcharge)", "Operations labor"];

  function median(arr) {                        // pandas .median(): skips null/NaN, mean of the two middle values
    var v = arr.filter(function (x) { return x !== null && !isNaN(x); }).slice().sort(function (a, b) { return a - b; });
    var n = v.length;
    if (!n) return NaN;
    return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  }

  function clip(x, lo, hi) { return Math.min(Math.max(x, lo), hi); }

  function pvFactor(rate, years, delay) {       // $1/yr at the end of years delay+1 ... delay+years
    var s = 0;
    for (var t = delay + 1; t <= delay + years; t++) s += 1 / Math.pow(1 + rate, t);
    return s;
  }

  /* County constants that do not depend on scenario sliders (as monte_carlo.Model.__init__). */
  function prepare(data, params) {
    var b = params.baseline, n = data.fips.length, c = b.capex, p = b.pue, sp = b.water.stress_penalty;
    var lab = data[c.labor.column], labMed = median(lab);
    var risk = data[c.hazard.column], riskMed = median(risk);
    var prep = { n: n, data: data, params: params, cddExcess: [], override: [], laborMult: [], landFarmPerMw: [],
                 hazardRate: [], price: [], co2tPerMwh: [], wage: [], bwsFrac: [] };
    for (var i = 0; i < n; i++) {
      var cdd = data[p.cdd_column][i];
      prep.cddExcess.push(cdd === null ? NaN : (cdd - p.cdd_threshold) / 1000);
      prep.override.push(data[p.override_column][i]);
      prep.laborMult.push(clip(lab[i] / labMed, c.labor.clip[0], c.labor.clip[1]));
      prep.landFarmPerMw.push(c.land.acres_per_mw * data[c.land.rent_column][i] / c.land.cap_rate);  // $/MW at 1x
      prep.hazardRate.push(c.hazard.max_premium * clip((risk[i] - riskMed) / (100 - riskMed), 0, 1));
      prep.price.push(data[b.electricity.price_column][i]);                                        // $/MWh
      prep.co2tPerMwh.push(data[b.carbon.rate_column][i] / b.carbon.lb_per_tonne);                 // t/MWh
      prep.wage.push(data[b.labor_opex.wage_column][i] * b.labor_opex.overhead_multiplier);         // $/FTE/yr
      prep.bwsFrac.push(clip((data[sp.column][i] - sp.start_score) / (sp.full_score - sp.start_score), 0, 1));
    }
    return prep;
  }

  /* Scenario defaults = the baseline YAML. */
  function baselineScenario(params) {
    var b = params.baseline;
    return { mw: b.scale.it_load_mw, carbonPrice: b.carbon.price_per_tonne, surchargeMax: b.water.stress_penalty.max_penalty,
             cooling: "air_evaporative", openShare: params.tokens.mix.open_share,
             constructionPerMw: b.capex.base_per_mw, staff: b.labor_opex.staff, discountRate: b.finance.discount_rate,
             landPremium: b.capex.land.industrial_premium };
  }

  /* Run all counties for one scenario. Returns columnar arrays. */
  function run(prep, scenario) {
    var params = prep.params, b = params.baseline, s = Object.assign(baselineScenario(params), scenario || {});
    var cool = b.cooling_scenarios[s.cooling], n = prep.n, data = prep.data;
    var hours = b.scale.hours_per_year, mw = s.mw;
    var pv = pvFactor(s.discountRate, b.finance.years, b.finance.opex_delay_years);
    var surcharge = s.surchargeMax * cool.water_m3_per_mwh / b.water.m3_per_mwh;   // scaled by water use (as Python)
    var base = s.constructionPerMw * mw;
    var share = b.capex.labor.share_of_base;

    // token-layer constants (src/token_cost.py class_params / mix; median prices, central energy, 3:1 blend)
    var tk = params.tokens, en = tk.energy, lvl = tk.energy_level, so = s.openShare;
    var kBlend = 0.25 + 0.75 * en.input_token_energy_ratio;
    var eMix = (so * en.open_typical_wh_per_1M_out[lvl] + (1 - so) * en.closed_frontier_wh_per_1M_out[lvl]) * kBlend;
    var pMix = so * tk.pricing.open.median_per_1M + (1 - so) * tk.pricing.closed.median_per_1M;
    var itMwhYear = mw * hours * tk.facility_cost.utilization;

    // social cost (src/equity.py, config_equity.yaml social_cost): CO2 at the social cost of carbon minus the price already
    // in TCO, plus scarcity-weighted water at a shadow price calibrated to California's median scarcity factor
    var sc = params.equity.social_cost;
    var caCf = median(data.cf_local.filter(function (v, k) { return data.state[k] === "CA"; }));
    var waterPriceEq = sc.water_shadow_price.usd_per_m3_at_reference / caCf;            // $ per median-county m3-eq

    var o = { facilityMwh: [], socialCost: [], gridLoadPct: [], pue: [], capexConstruction: [], capexLand: [], capexHazard: [], capexGrid: [], capexCooling: [], capex: [],
              pvElectricity: [], pvCarbon: [], pvWater: [], pvLabor: [], pvWaterPenalty: [], tco: [],
              costPerItMwh: [], co2Kg: [], waterDirectL: [], waterIndirectL: [], waterTotalL: [], waterSwL: [] };
    for (var i = 0; i < n; i++) {
      var pue = prep.override[i] !== null && !isNaN(prep.override[i]) ? prep.override[i]
        : cool.pue_base + clip(prep.cddExcess[i] * cool.pue_slope_per_1000_cdd, 0, cool.pue_max_uplift);
      var mwh = mw * hours * pue;
      var capexConstruction = base * (1 - share) + base * share * prep.laborMult[i];
      var capexLand = prep.landFarmPerMw[i] * mw * s.landPremium;
      var capexHazard = base * b.capex.hazard.civil_share * prep.hazardRate[i];
      var capexCooling = cool.capex_premium_per_mw * mw;
      var capex = capexConstruction + capexLand + capexHazard + capexCooling + b.capex.grid_interconnection;
      var elec = mwh * prep.price[i];
      var carbon = mwh * prep.co2tPerMwh[i] * s.carbonPrice;
      var water = mwh * cool.water_m3_per_mwh * b.water.price_per_m3;
      var labor = s.staff * prep.wage[i];
      var pre = elec + carbon + water + labor;
      var penalty = pre * surcharge * prep.bwsFrac[i];
      var tco = capex + pv * (pre + penalty);
      o.pue.push(pue); o.capexConstruction.push(capexConstruction); o.capexLand.push(capexLand);
      o.capexHazard.push(capexHazard); o.capexGrid.push(b.capex.grid_interconnection); o.capexCooling.push(capexCooling);
      o.capex.push(capex); o.pvElectricity.push(pv * elec); o.pvCarbon.push(pv * carbon); o.pvWater.push(pv * water);
      o.pvLabor.push(pv * labor); o.pvWaterPenalty.push(pv * penalty); o.tco.push(tco);
      o.costPerItMwh.push(tco / (itMwhYear * pv));                                  // levelized $ per IT-MWh
      var facMwh = eMix / 1e6 * pue;                                                // facility MWh per 1M tokens
      var direct = facMwh * cool.water_m3_per_mwh * 1000;
      var indirect = facMwh * data.indirect_m3_per_mwh[i] * 1000;
      o.co2Kg.push(facMwh * data[b.carbon.rate_column][i] / (b.carbon.lb_per_tonne / 1000));
      o.waterDirectL.push(direct); o.waterIndirectL.push(indirect); o.waterTotalL.push(direct + indirect);
      o.waterSwL.push(direct * data.cf_local[i] + facMwh * data.indirect_m3eq_per_mwh_sw[i] * 1000);
      o.facilityMwh.push(mwh);
      var extCarbon = pv * mwh * prep.co2tPerMwh[i] * (sc.scc_per_tonne - s.carbonPrice);
      var swM3 = mwh * (cool.water_m3_per_mwh * data.cf_local[i] + data.indirect_m3eq_per_mwh_sw[i]);
      o.socialCost.push(tco + extCarbon + pv * swM3 * waterPriceEq);
      var den = data.grid_denominator_mwh[i];                                       // BA retail sales (AK, HI: state)
      o.gridLoadPct.push(den ? mwh / den * 100 : null);
    }
    var medTco = median(o.tco), medC = median(o.costPerItMwh);
    o.costIndex = o.tco.map(function (t) { return t / medTco * b.cost_index.median_value; });
    o.priceL1 = o.costPerItMwh.map(function (c) { return pMix + eMix / 1e6 * (c - medC); });   // derived-f Layer 1
    o.percentile = percentRank(o.tco);
    var socialPct = percentRank(o.socialCost);
    o.socialRankShift = socialPct.map(function (r, k) { return r - o.percentile[k]; });  // + = dearer for society
    o.driver = dominantDrivers(o);
    o.summary = { medianTco: medTco, medianCostPerItMwh: medC, priceMix: pMix, energyWhPer1M: eMix,
                  facilityShare: eMix / 1e6 * medC / pMix, pvFactor: pv, scenario: s };
    return o;
  }

  function percentRank(v) {                     // pandas rank(pct=True) * 100, average ties
    var idx = v.map(function (x, i) { return i; }).sort(function (a, b) { return v[a] - v[b]; });
    var r = new Array(v.length), i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && v[idx[j + 1]] === v[idx[i]]) j++;
      for (var k = i; k <= j; k++) r[idx[k]] = ((i + j) / 2 + 1) / v.length * 100;
      i = j + 1;
    }
    return r;
  }

  /* src/cost_drivers.py decompose(): each component minus its national median; largest cost-raising component for
   * counties above the median TCO, largest cost-lowering component otherwise. Cooling premium and grid are constant. */
  function components(o, i) {
    return [o.capexConstruction[i] + o.capexGrid[i] + o.capexCooling[i], o.capexLand[i], o.capexHazard[i],
            o.pvElectricity[i], o.pvCarbon[i], o.pvWater[i] + o.pvWaterPenalty[i], o.pvLabor[i]];
  }

  function dominantDrivers(o) {
    var n = o.tco.length, comp = [], med = [], medTco = median(o.tco), out = [];
    for (var i = 0; i < n; i++) comp.push(components(o, i));
    for (var k = 0; k < DRIVERS.length; k++) med.push(median(comp.map(function (c) { return c[k]; })));
    for (i = 0; i < n; i++) {
      var above = o.tco[i] - medTco > 0, best = 0, bestVal = above ? -Infinity : Infinity;
      for (k = 0; k < DRIVERS.length; k++) {
        var d = comp[i][k] - med[k];
        if (above ? d > bestVal : d < bestVal) { bestVal = d; best = k; }
      }
      out.push({ driver: DRIVERS[best], side: above ? "more expensive" : "cheaper", deviation: bestVal });
    }
    return out;
  }

  return { prepare: prepare, run: run, baselineScenario: baselineScenario, median: median, pvFactor: pvFactor,
           DRIVERS: DRIVERS };
})();

if (typeof window !== "undefined") window.CostModel = CostModel;
