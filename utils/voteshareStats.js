/**
 * AP Vote-share tracker - statistics.
 *
 * Turns parsed sheets into everything the leadership dashboard shows. All
 * shares are fractions (0..1); "pts" outputs are percentage points (x100).
 *
 * Methods (kept deliberately standard and explainable):
 *  - Margin of error for a share:          1.96 * sqrt(p(1-p)/n)
 *  - SE of a lead (two shares, same poll):  sqrt((p1 + p2 - (p1-p2)^2) / n)
 *  - Win probability:                       Phi(margin / SE)            (normal approx.)
 *  - Seat projection:                       sum of win probabilities, 90% band
 *                                           = E +/- 1.645 * sqrt(sum p(1-p))
 *  - Momentum:                              OLS slope (pts/day) over the last <=14 points
 *  - Anomalies:                             robust z of the day-over-day change across ACs
 *                                           (median / 1.4826*MAD), plus each AC against its
 *                                           own history once >= 10 days exist
 *  - Drivers:                               Pearson r with a two-sided p-value
 */

const pts = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10);
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);

/* ------------------------------- primitives ------------------------------- */

function normCdf(z) {
  // Abramowitz & Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t *
    Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

const seProp = (p, n) => (n > 0 && p != null ? Math.sqrt(Math.max(p * (1 - p), 0) / n) : null);
const seDiff = (p1, p2, n) => (n > 0 && p1 != null && p2 != null
  ? Math.sqrt(Math.max(p1 + p2 - (p1 - p2) ** 2, 1e-9) / n) : null);

function median(a) {
  const s = a.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function mad(a) {
  const m = median(a);
  return m == null ? null : median(a.filter(Number.isFinite).map((x) => Math.abs(x - m)));
}
function mean(a) { const s = a.filter(Number.isFinite); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; }
function sd(a) {
  const s = a.filter(Number.isFinite); if (s.length < 2) return null;
  const m = mean(s); return Math.sqrt(s.reduce((x, y) => x + (y - m) ** 2, 0) / (s.length - 1));
}

const dayIndex = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000);

/** OLS slope of y against calendar day; returns slope per day, r2, n. */
function trend(points) {
  const p = points.filter((x) => Number.isFinite(x.y));
  if (p.length < 2) return { slope: null, r2: null, n: p.length };
  const xs = p.map((x) => dayIndex(x.date));
  const ys = p.map((x) => x.y);
  const mx = mean(xs); const my = mean(ys);
  let sxy = 0; let sxx = 0; let syy = 0;
  xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
  if (!sxx) return { slope: null, r2: null, n: p.length };
  const slope = sxy / sxx;
  return { slope, r2: syy ? (sxy * sxy) / (sxx * syy) : 1, n: p.length };
}

function pearson(xs, ys) {
  const pairs = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = pairs.length;
  if (n < 5) return { r: null, p: null, n };
  const mx = mean(pairs.map((q) => q[0])); const my = mean(pairs.map((q) => q[1]));
  let sxy = 0; let sxx = 0; let syy = 0;
  pairs.forEach(([x, y]) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; });
  if (!sxx || !syy) return { r: null, p: null, n };
  const r = sxy / Math.sqrt(sxx * syy);
  const t = r * Math.sqrt((n - 2) / Math.max(1 - r * r, 1e-12));
  // normal approximation to the t distribution (fine for n >= 30; flagged below otherwise)
  const p = 2 * (1 - normCdf(Math.abs(t)));
  return { r, p, n, slope: sxy / sxx };
}

/* --------------------------- report (official) series --------------------------- */

const KIND_MAIN = { party: "TDP", alliance: "NDA", cm: "CBN", govt: "Net" };
const KIND_RIVAL = { party: "YSRCP", alliance: "YSRCP", cm: "JMR" };

function withNet(values) {
  // govt rating: net approval = Above Average - Below Average (fallback: VG+G - B-VB)
  const v = { ...values };
  const above = v["Above Average"] != null ? v["Above Average"] : (v["Very Good"] || 0) + (v.Good || 0);
  const below = v["Below Average"] != null ? v["Below Average"] : (v.Bad || 0) + (v["Very Bad"] || 0);
  v.Net = above - below;
  return v;
}

function summariseEntity(ent, kind) {
  const series = ent.series.map((p) => ({ ...p, values: kind === "govt" ? withNet(p.values) : p.values }));
  if (!series.length) return null;
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const first = series[0];
  const keys = Object.keys(last.values);
  const tail = series.slice(-14);
  const out = {
    type: ent.type, group: ent.group, label: ent.label, zone: ent.zone,
    latestDate: last.date, sample: last.sample, leading: last.leading,
    values: {}, d1: {}, dAll: {}, vsBase: {}, slope: {}, moe: {},
    margin: last.margin, baseline: ent.baseline ? { label: ent.baseline.label, values: ent.baseline.values, margin: ent.baseline.margin, leading: ent.baseline.leading } : null,
    spark: series.slice(-60).map((p) => ({ date: p.date, v: p.values[KIND_MAIN[kind]] })),
  };
  keys.forEach((k) => {
    const v = last.values[k];
    out.values[k] = r4(v);
    if (prev && prev.values[k] != null) out.d1[k] = pts(v - prev.values[k]);
    if (series.length > 1 && first.values[k] != null) out.dAll[k] = pts(v - first.values[k]);
    if (out.baseline && out.baseline.values[k] != null) out.vsBase[k] = pts(v - out.baseline.values[k]);
    const t = trend(tail.map((p) => ({ date: p.date, y: p.values[k] })));
    out.slope[k] = t.slope == null ? null : Math.round(t.slope * 10000) / 100; // pts/day
    if (k !== "Net" && last.sample) out.moe[k] = pts(1.96 * seProp(v, last.sample));
  });
  const main = KIND_MAIN[kind]; const rival = KIND_RIVAL[kind];
  if (rival && last.values[main] != null && last.values[rival] != null) {
    const m = last.values[main] - last.values[rival];
    const se = seDiff(last.values[main], last.values[rival], last.sample);
    out.lead = { main, rival, pts: pts(m), z: se ? r3(m / se) : null, significant: se ? Math.abs(m / se) >= 1.96 : null };
  }
  return out;
}

function summariseReports(reports, window) {
  const out = {};
  reports.filter((r) => r.window === window || (!r.window && !window)).forEach((r) => {
    const ents = Object.values(r.entities).map((e) => summariseEntity(e, r.kind)).filter(Boolean);
    out[r.kind] = {
      state: ents.find((e) => e.type === "state") || null,
      stateSeries: (Object.values(r.entities).find((e) => e.type === "state") || { series: [] }).series
        .map((p) => ({ date: p.date, sample: p.sample, ...(r.kind === "govt" ? withNet(p.values) : p.values) })),
      zones: ents.filter((e) => e.type === "zone"),
      pcs: ents.filter((e) => e.type === "pc"),
      segments: ents.filter((e) => e.type === "segment"),
      zoneSeries: Object.fromEntries(Object.values(r.entities).filter((e) => e.type === "zone")
        .map((e) => [e.label, e.series.map((p) => ({ date: p.date, ...(r.kind === "govt" ? withNet(p.values) : p.values) }))])),
    };
  });
  return out;
}

/* ------------------------------ AC (master) stats ------------------------------ */

const NDA_PARTIES = new Set(["TDP", "JSP", "BJP", "NDA"]);
const side = (party) => (NDA_PARTIES.has(String(party).toUpperCase()) ? "NDA"
  : /YSRCP/i.test(party) ? "YSRCP" : party || "—");

function category(z) {
  if (z == null) return "Unknown";
  if (z >= 1.96) return "Safe NDA";
  if (z >= 1.0) return "Lean NDA";
  if (z > -1.0) return "Toss-up";
  if (z > -1.96) return "Lean YSRCP";
  return "Safe YSRCP";
}

function acStats(master) {
  const rows = master.rows;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const latest = dates[dates.length - 1];
  const prevD = dates.length > 1 ? dates[dates.length - 2] : null;
  const byAc = new Map();
  rows.forEach((r) => {
    if (!byAc.has(r.acNo)) byAc.set(r.acNo, []);
    byAc.get(r.acNo).push(r);
  });
  byAc.forEach((list) => list.sort((a, b) => (a.date < b.date ? -1 : 1)));

  const acs = [];
  byAc.forEach((list, acNo) => {
    const cur = list.find((r) => r.date === latest);
    if (!cur) return; // AC missing on the latest date - reported in issues
    const prev = prevD ? list.find((r) => r.date === prevD) : null;
    const first = list[0];
    const nda = cur.alliance.NDA; const ys = cur.alliance.YSRCP; const n = cur.sample;
    const margin = nda != null && ys != null ? nda - ys : null;
    const se = seDiff(nda, ys, n);
    const z = se && margin != null ? margin / se : null;
    const pNda = z == null ? null : normCdf(z);
    const marginOf = (r) => (r && r.alliance.NDA != null && r.alliance.YSRCP != null ? r.alliance.NDA - r.alliance.YSRCP : null);
    const hist = list.map((r) => ({ date: r.date, y: marginOf(r) }));
    const t = trend(hist.slice(-14));
    const leader = margin == null ? "—" : margin >= 0 ? "NDA" : "YSRCP";
    const was = side(cur.winner2024);
    const cbnM = cur.cm.CBN != null && cur.cm.JMR != null ? cur.cm.CBN - cur.cm.JMR : null;
    acs.push({
      acNo, acName: cur.acName, pc: cur.pc, zone: cur.zone, winner2024: cur.winner2024, side2024: was,
      ndaContest: cur.ndaContest, sample: n,
      nda: r4(nda), ysrcp: r4(ys), margin: pts(margin), moe: pts(1.96 * (se || 0)),
      z: r3(z), pNda: r3(pNda), category: category(z), leader,
      status: was === "NDA" && leader === "YSRCP" ? "Lost vs 2024" : was === "YSRCP" && leader === "NDA" ? "Gained vs 2024" : "Held",
      d1: prev ? pts(margin - marginOf(prev)) : null,
      dAll: list.length > 1 ? pts(margin - marginOf(first)) : null,
      slope: t.slope == null ? null : Math.round(t.slope * 10000) / 100,
      party: Object.fromEntries(Object.entries(cur.party).map(([k, v]) => [k, typeof v === "number" ? r4(v) : v])),
      cm: Object.fromEntries(Object.entries(cur.cm).map(([k, v]) => [k, typeof v === "number" ? r4(v) : v])),
      cbnMargin: pts(cbnM),
      cbnD1: prev && prev.cm.CBN != null && cur.cm.CBN != null ? pts(cur.cm.CBN - prev.cm.CBN) : null,
      leaderPremium: cur.ndaContest === "TDP" && cur.cm.CBN != null && cur.party.TDP != null ? pts(cur.cm.CBN - cur.party.TDP) : null,
      pkPremium: cur.cm.PK != null && cur.party.JSP != null ? pts(cur.cm.PK - cur.party.JSP) : null,
      perf: cur.perf,
      sampleD1: prev && prev.sample ? Math.round(((n - prev.sample) / prev.sample) * 1000) / 10 : null,
      leaderChanged: prev ? (marginOf(prev) >= 0) !== (margin >= 0) : false,
      cmLeaderChanged: prev && prev.cm.leading && cur.cm.leading ? prev.cm.leading !== cur.cm.leading : false,
      series: list.slice(-60).map((r) => ({
        date: r.date, margin: pts(marginOf(r)), nda: pts(r.alliance.NDA), ysrcp: pts(r.alliance.YSRCP),
        tdp: pts(r.party.TDP), cbn: pts(r.cm.CBN), jmr: pts(r.cm.JMR), pk: pts(r.cm.PK),
      })),
      _hist: hist,
    });
  });
  acs.sort((a, b) => a.acNo - b.acNo);
  return { acs, dates, latest, prevD };
}

/* ---------------------------------- seats ---------------------------------- */

function seatProjection(acs) {
  const p = acs.map((a) => a.pNda).filter(Number.isFinite);
  const E = p.reduce((s, x) => s + x, 0);
  const sdv = Math.sqrt(p.reduce((s, x) => s + x * (1 - x), 0));
  const cats = ["Safe NDA", "Lean NDA", "Toss-up", "Lean YSRCP", "Safe YSRCP"];
  const byCat = Object.fromEntries(cats.map((c) => [c, acs.filter((a) => a.category === c).length]));
  const byZone = {};
  acs.forEach((a) => {
    const z = (byZone[a.zone] = byZone[a.zone] || { zone: a.zone, NDA: 0, YSRCP: 0, total: 0, expected: 0, 2024: 0, ...Object.fromEntries(cats.map((c) => [c, 0])) });
    z.total++; z[a.leader] = (z[a.leader] || 0) + 1; z.expected += a.pNda || 0; z[a.category]++;
    if (a.side2024 === "NDA") z[2024]++;
  });
  Object.values(byZone).forEach((z) => { z.expected = Math.round(z.expected * 10) / 10; });
  const leaders = (key) => {
    const c = {};
    acs.forEach((a) => { const l = key(a) || "—"; c[l] = (c[l] || 0) + 1; });
    return c;
  };
  return {
    ndaLeading: acs.filter((a) => a.leader === "NDA").length,
    ysrcpLeading: acs.filter((a) => a.leader === "YSRCP").length,
    expectedNda: Math.round(E * 10) / 10,
    band90: [Math.max(0, Math.round(E - 1.645 * sdv)), Math.min(acs.length, Math.round(E + 1.645 * sdv))],
    total: acs.length,
    nda2024: acs.filter((a) => a.side2024 === "NDA").length,
    byCategory: byCat,
    byZone: Object.values(byZone).sort((a, b) => a.zone.localeCompare(b.zone, undefined, { numeric: true })),
    partyLeaders: leaders((a) => a.party.leading),
    cmLeaders: leaders((a) => a.cm.leading),
    lost: acs.filter((a) => a.status === "Lost vs 2024").map((a) => a.acNo),
    gained: acs.filter((a) => a.status === "Gained vs 2024").map((a) => a.acNo),
  };
}

/* -------------------------------- anomalies -------------------------------- */

function anomalies(acs, stateBlocks, latest) {
  const out = [];
  const robust = (vals) => {
    const m = median(vals); const d = mad(vals);
    return (v) => (v == null || m == null || !d ? null : (v - m) / (1.4826 * d));
  };
  // 1) cross-sectional: unusual daily move in NDA margin and CBN share
  const zM = robust(acs.map((a) => a.d1).filter(Number.isFinite));
  const zC = robust(acs.map((a) => a.cbnD1).filter(Number.isFinite));
  acs.forEach((a) => {
    const z1 = zM(a.d1);
    if (z1 != null && Math.abs(z1) >= 3.5 && Math.abs(a.d1) >= 1) {
      out.push({ type: "Unusual move", severity: Math.abs(z1) >= 5 ? "High" : "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone,
        metric: "NDA margin", change: a.d1, score: r3(z1),
        text: `${a.acName}: NDA margin moved ${a.d1 > 0 ? "+" : ""}${a.d1} pts in a day (${Math.abs(z1).toFixed(1)}× the typical AC move)` });
    }
    const z2 = zC(a.cbnD1);
    if (z2 != null && Math.abs(z2) >= 3.5 && Math.abs(a.cbnD1) >= 1) {
      out.push({ type: "Unusual move", severity: Math.abs(z2) >= 5 ? "High" : "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone,
        metric: "CBN preference", change: a.cbnD1, score: r3(z2),
        text: `${a.acName}: CBN preference moved ${a.cbnD1 > 0 ? "+" : ""}${a.cbnD1} pts in a day (${Math.abs(z2).toFixed(1)}× typical)` });
    }
    // 2) temporal: today's move vs this AC's own history (needs >= 10 days)
    const diffs = [];
    for (let i = 1; i < a._hist.length; i++) {
      const y0 = a._hist[i - 1].y; const y1 = a._hist[i].y;
      if (Number.isFinite(y0) && Number.isFinite(y1)) diffs.push(y1 - y0);
    }
    if (diffs.length >= 10) {
      const today = diffs[diffs.length - 1]; const past = diffs.slice(0, -1);
      const s = sd(past); const m = mean(past);
      if (s && Math.abs((today - m) / s) >= 3 && Math.abs(today) >= 0.01) {
        out.push({ type: "Break from own trend", severity: "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone,
          metric: "NDA margin", change: pts(today), score: r3((today - m) / s),
          text: `${a.acName}: today's NDA-margin move is ${((today - m) / s).toFixed(1)} SD from its own recent pattern` });
      }
    }
    // 3) lead changes and data quality
    if (a.leaderChanged) {
      out.push({ type: "Lead change", severity: "High", acNo: a.acNo, acName: a.acName, zone: a.zone, metric: "Alliance lead",
        change: a.d1, text: `${a.acName}: alliance lead switched to ${a.leader} (margin now ${a.margin > 0 ? "+" : ""}${a.margin} pts)` });
    }
    if (a.cmLeaderChanged) {
      out.push({ type: "Lead change", severity: "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, metric: "CM preference",
        change: a.cbnD1, text: `${a.acName}: CM-preference lead switched to ${a.cm.leading}` });
    }
    if (a.sampleD1 != null && a.sampleD1 <= -30) {
      out.push({ type: "Data quality", severity: "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, metric: "Sample",
        change: a.sampleD1, text: `${a.acName}: sample fell ${Math.abs(a.sampleD1)}% day-on-day — treat today's figures with caution` });
    }
  });
  // 4) segment-level: unusual daily movement among voter groups (official tables)
  Object.entries(stateBlocks).forEach(([kind, blk]) => {
    const main = KIND_MAIN[kind];
    const segs = (blk.segments || []).filter((s) => s.d1 && s.d1[main] != null);
    const zS = robust(segs.map((s) => s.d1[main]));
    segs.forEach((s) => {
      const z = zS(s.d1[main]);
      if (z != null && Math.abs(z) >= 3.5 && Math.abs(s.d1[main]) >= 1) {
        out.push({ type: "Segment shift", severity: "Medium", segment: `${s.group}: ${s.label}`, metric: `${main} (${kind})`,
          change: s.d1[main], score: r3(z),
          text: `${s.group} – ${s.label}: ${main} ${s.d1[main] > 0 ? "+" : ""}${s.d1[main]} pts day-on-day (${Math.abs(z).toFixed(1)}× typical segment move)` });
      }
    });
  });
  const sev = { High: 0, Medium: 1, Low: 2 };
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || Math.abs(b.score || 0) - Math.abs(a.score || 0)).map((x) => ({ ...x, date: latest }));
}

/* ------------------------------- correlations ------------------------------- */

function drivers(acs, perfMetrics) {
  const y = acs.map((a) => a.margin);
  const out = perfMetrics.map((m) => {
    const x = acs.map((a) => (a.perf[m] ? a.perf[m].score : null));
    const c = pearson(x, y);
    return {
      metric: m, r: r3(c.r), p: c.p == null ? null : Number(c.p.toPrecision(2)), n: c.n,
      significant: c.p != null && c.p < 0.05,
      ptsPer10: c.slope == null ? null : Math.round(c.slope * 0.1 * 10) / 10, // margin pts per +0.10 score
      intercept: c.slope == null ? null : r3(mean(y) - c.slope * mean(x)),
      slope: c.slope == null ? null : r3(c.slope),
      // scatter points are rebuilt in the browser from the AC table (no duplication)
    };
  });
  return out.sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
}

/* --------------------------------- at risk --------------------------------- */

function atRisk(acs) {
  const bad = /bad|low/i;
  return acs.filter((a) => a.side2024 === "NDA" && a.margin != null)
    .map((a) => {
      const weak = ["MLA Performance", "MLA Availability", "MLA Behaviour", "MLA Retention"]
        .filter((m) => a.perf[m] && bad.test(a.perf[m].rating));
      let score = 0;
      score += a.margin < 0 ? 40 : a.margin < 5 ? 25 : a.margin < 10 ? 10 : 0;
      score += a.category === "Toss-up" ? 15 : /YSRCP/.test(a.category) ? 25 : 0;
      score += weak.length * 6;
      score += a.slope != null && a.slope < 0 ? Math.min(Math.abs(a.slope) * 10, 15) : 0;
      return { acNo: a.acNo, acName: a.acName, zone: a.zone, pc: a.pc, margin: a.margin, category: a.category,
        weakMla: weak, slope: a.slope, riskScore: Math.round(score) };
    })
    .filter((x) => x.riskScore >= 25)
    .sort((a, b) => b.riskScore - a.riskScore);
}

/* --------------------------------- insights -------------------------------- */

function insights(ctx) {
  const { seats, reps, acs, anomalies: an, drivers: dr } = ctx;
  const out = [];
  const sgn = (x) => (x > 0 ? `+${x}` : `${x}`);
  out.push({ tone: seats.expectedNda >= seats.nda2024 ? "good" : "warn",
    text: `Projected NDA seats ${seats.expectedNda} (90% range ${seats.band90[0]}–${seats.band90[1]}) vs ${seats.nda2024} won in 2024; NDA leads in ${seats.ndaLeading} of ${seats.total} ACs.` });
  const al = reps.alliance && reps.alliance.state;
  if (al && al.vsBase.NDA != null) {
    out.push({ tone: al.vsBase.NDA >= 0 ? "good" : "warn",
      text: `NDA vote share ${(al.values.NDA * 100).toFixed(1)}% (${sgn(al.vsBase.NDA)} pts vs AE2024); YSRCP ${(al.values.YSRCP * 100).toFixed(1)}% (${sgn(al.vsBase.YSRCP)} pts).` });
  }
  const cm = reps.cm && reps.cm.state;
  if (cm && cm.vsBase.CBN != null) {
    out.push({ tone: cm.vsBase.CBN >= 0 ? "good" : "warn",
      text: `CBN preferred by ${(cm.values.CBN * 100).toFixed(1)}% vs JMR ${(cm.values.JMR * 100).toFixed(1)}% — CBN ${sgn(cm.vsBase.CBN)} pts vs the 2024 survey; PK ${sgn(cm.vsBase.PK)} pts.` });
  }
  const gv = reps.govt && reps.govt.state;
  if (gv) out.push({ tone: gv.values.Net >= 0 ? "good" : "warn", text: `State government net approval ${sgn(pts(gv.values.Net))} pts (Above-average minus below-average rating).` });
  if (seats.byCategory["Toss-up"]) out.push({ tone: "warn", text: `${seats.byCategory["Toss-up"]} ACs are statistical toss-ups — the lead is inside the margin of error.` });
  if (seats.lost.length) {
    const names = acs.filter((a) => seats.lost.includes(a.acNo)).slice(0, 5).map((a) => a.acName).join(", ");
    out.push({ tone: "bad", text: `${seats.lost.length} NDA-held seat${seats.lost.length > 1 ? "s" : ""} now trail YSRCP: ${names}${seats.lost.length > 5 ? "…" : ""}.` });
  }
  // voter segments whose NDA swing vs AE2024 is larger than their own margin of error
  const segs = ((reps.alliance && reps.alliance.segments) || [])
    .filter((x) => x.vsBase.NDA != null && x.moe && x.moe.NDA != null && Math.abs(x.vsBase.NDA) > x.moe.NDA);
  const losers = segs.filter((x) => x.vsBase.NDA < 0).sort((a, b) => a.vsBase.NDA - b.vsBase.NDA).slice(0, 4);
  const gainers = segs.filter((x) => x.vsBase.NDA > 0).sort((a, b) => b.vsBase.NDA - a.vsBase.NDA).slice(0, 3);
  if (losers.length) {
    out.push({ tone: "bad", text: `NDA has lost ground vs AE2024 among ${losers.map((x) => `${x.label} (${sgn(x.vsBase.NDA)})`).join(", ")} — beyond the margin of error.` });
  }
  if (gainers.length) {
    out.push({ tone: "good", text: `Biggest NDA gains vs AE2024: ${gainers.map((x) => `${x.label} (${sgn(x.vsBase.NDA)})`).join(", ")}.` });
  }
  const strongest = (dr || []).find((d) => d.significant);
  if (strongest) out.push({ tone: "info", text: `${strongest.metric} is the strongest driver of the NDA margin across ACs (r = ${strongest.r}): +0.10 in score ≈ ${sgn(strongest.ptsPer10)} pts of margin.` });
  const hi = an.filter((x) => x.severity === "High").length;
  if (an.length) out.push({ tone: hi ? "bad" : "info", text: `${an.length} anomal${an.length === 1 ? "y" : "ies"} flagged on the latest day${hi ? ` (${hi} high severity)` : ""}.` });
  return out;
}

/* ---------------------------------- build ---------------------------------- */

function buildDashboard(parsed) {
  const { masters, reports, skipped } = parsed;
  const reportWindows = [...new Set(reports.map((r) => r.window).filter(Boolean))];
  const windows = [...new Set([...reportWindows, ...masters.map((m) => m.window).filter(Boolean)])]
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const result = { windows: windows.length ? windows : ["Tracker"], byWindow: {}, skipped };

  result.windows.forEach((w) => {
    const master = masters.find((m) => m.window === w) ||
      (masters.find((m) => !m.window) && (reportWindows.length <= 1 || w === result.windows[0]) ? masters.find((m) => !m.window) : null);
    const reps = summariseReports(reports, reportWindows.length ? w : "");
    const issues = [...(master ? master.issues : [])];
    let acs = []; let dates = []; let latest = null; let prevD = null;
    if (master) ({ acs, dates, latest, prevD } = acStats(master));
    if (master && acs.length < new Set(master.rows.map((r) => r.acNo)).size) {
      issues.push(`${new Set(master.rows.map((r) => r.acNo)).size - acs.length} AC(s) have no row on the latest date ${latest}.`);
    }
    // PC -> zone from the master (the report only labels some PCs)
    const pcZone = {}; acs.forEach((a) => { if (a.pc && a.zone) pcZone[a.pc] = a.zone; });
    Object.values(reps).forEach((blk) => (blk.pcs || []).forEach((p) => { if (!p.zone) p.zone = pcZone[p.label] || ""; }));

    const seats = acs.length ? seatProjection(acs) : null;
    const an = anomalies(acs, reps, latest);
    const perfMetrics = master ? master.perfMetrics : [];
    const dr = acs.length ? drivers(acs, perfMetrics) : [];
    const risk = atRisk(acs);
    const repDates = [...new Set(Object.values(reps).flatMap((b) => b.stateSeries.map((p) => p.date)))].sort();
    acs.forEach((a) => { delete a._hist; });

    result.byWindow[w] = {
      window: w,
      latestDate: latest || repDates[repDates.length - 1] || null,
      previousDate: prevD,
      firstDate: dates[0] || repDates[0] || null,
      days: Math.max(dates.length, repDates.length),
      state: reps, acs, seats, anomalies: an, drivers: dr, atRisk: risk, perfMetrics,
      insights: seats ? insights({ seats, reps, acs, anomalies: an, drivers: dr }) : [],
      issues,
    };
  });
  return result;
}

module.exports = { buildDashboard, normCdf, seDiff, seProp, trend, pearson, median, mad };
