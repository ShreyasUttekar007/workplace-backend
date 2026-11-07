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
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6); // keep precision: round only once, at display

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

/* ------------------------------ names & labels ------------------------------ */

const LEADER = { CBN: "HCM Chandrababu Naidu", JMR: "YS Jagan Mohan Reddy", PK: "DCM Pawan Kalyan", LN: "HITM Nara Lokesh" };
const NDA_PARTIES = new Set(["TDP", "JSP", "BJP"]);
const sgn = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x}`);

/** How firm a lead is, in plain words (|z| = lead / its standard error). */
function strengthOf(z) {
  if (z == null) return "Unknown";
  const a = Math.abs(z);
  if (a >= 1.96) return "Comfortable lead";
  if (a >= 1.0) return "Narrow lead";
  return "Too close to call";
}

/* ------------------------------ AC (master) stats ------------------------------ */

function acStats(master) {
  const rows = master.rows;
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const latest = dates[dates.length - 1];
  const prevD = dates.length > 1 ? dates[dates.length - 2] : null;
  const byAc = new Map();
  rows.forEach((r) => { if (!byAc.has(r.acNo)) byAc.set(r.acNo, []); byAc.get(r.acNo).push(r); });
  byAc.forEach((list) => list.sort((a, b) => (a.date < b.date ? -1 : 1)));

  const acs = [];
  byAc.forEach((list, acNo) => {
    const cur = list.find((r) => r.date === latest);
    if (!cur) return;
    const prev = prevD ? list.find((r) => r.date === prevD) : null;
    const first = list[0];
    // Seat calls use the PARTY question throughout, so every figure shown for a seat adds up:
    // NDA side = TDP + JSP + BJP party shares; the other side = YSRCP's party share.
    const ndaOf = (r) => (r ? ["TDP", "JSP", "BJP"].reduce((t, k) => t + (r.party[k] || 0), 0) : null);
    const n = cur.sample;
    const nda = ndaOf(cur); const ys = cur.party.YSRCP;
    const marginOf = (r) => (r && r.party.YSRCP != null ? ndaOf(r) - r.party.YSRCP : null);
    const margin = marginOf(cur);
    const se = seDiff(nda, ys, n);
    const z = se && margin != null ? margin / se : null;
    const pNda = z == null ? null : normCdf(z);
    const hist = list.map((r) => ({ date: r.date, y: marginOf(r) }));
    const t = trend(hist.slice(-14));
    const contest = NDA_PARTIES.has(cur.ndaContest) ? cur.ndaContest : "TDP";
    const projected = margin == null ? "—" : margin >= 0 ? contest : "YSRCP";
    const won = String(cur.winner2024 || "").toUpperCase();
    const own = cur.party[contest];
    const standalone = own != null && cur.party.YSRCP != null ? own - cur.party.YSRCP : null;
    const cbnM = cur.cm.CBN != null && cur.cm.JMR != null ? cur.cm.CBN - cur.cm.JMR : null;
    const cmLead = ["CBN", "JMR", "PK", "LN"].filter((k) => cur.cm[k] != null).sort((a, b) => cur.cm[b] - cur.cm[a])[0] || null;
    const ranked = ["TDP", "YSRCP", "JSP", "BJP", "INC"].filter((k) => cur.party[k] != null).sort((a, b) => cur.party[b] - cur.party[a]);
    const topParty = ranked[0] || null;
    const topGap = ranked.length > 1 ? cur.party[ranked[0]] - cur.party[ranked[1]] : null;
    acs.push({
      acNo, acName: cur.acName, pc: cur.pc, zone: cur.zone, sample: n,
      winner2024: won, contestParty: contest, projected,
      outcome: !won || projected === "—" ? "—" : won === projected ? `${projected} holds` : `${projected} gains from ${won}`,
      changed: !!won && projected !== "—" && won !== projected,
      nda: r4(nda), ysrcp: r4(ys), margin: pts(margin), moe: pts(1.96 * (se || 0)),
      topParty, topGap: pts(topGap), runnerUp: ranked[1] || null,
      z: r3(z), pNda: r3(pNda), strength: strengthOf(z),
      standalone: pts(standalone),
      allianceDependent: standalone != null && margin != null && standalone < 0 && margin > 0,
      d1: prev ? pts(margin - marginOf(prev)) : null,
      dAll: list.length > 1 ? pts(margin - marginOf(first)) : null,
      slope: t.slope == null ? null : Math.round(t.slope * 10000) / 100,
      trendDays: t.n,
      party: Object.fromEntries(Object.entries(cur.party).map(([k, v]) => [k, typeof v === "number" ? r4(v) : v])),
      cm: Object.fromEntries(Object.entries(cur.cm).map(([k, v]) => [k, typeof v === "number" ? r4(v) : v])),
      cmLeader: cmLead, cbnMargin: pts(cbnM),
      cbnD1: prev && prev.cm.CBN != null && cur.cm.CBN != null ? pts(cur.cm.CBN - prev.cm.CBN) : null,
      leaderPremium: contest === "TDP" && cur.ndaContest === "TDP" && cur.cm.CBN != null && cur.party.TDP != null ? pts(cur.cm.CBN - cur.party.TDP) : null,
      pkPremium: cur.cm.PK != null && cur.party.JSP != null ? pts(cur.cm.PK - cur.party.JSP) : null,
      perf: cur.perf,
      sampleD1: prev && prev.sample ? Math.round(((n - prev.sample) / prev.sample) * 1000) / 10 : null,
      leaderChanged: prev && marginOf(prev) != null && margin != null ? (marginOf(prev) >= 0) !== (margin >= 0) : false,
      cmLeaderChanged: prev && prev.cm.leading && cur.cm.leading ? prev.cm.leading !== cur.cm.leading : false,
      series: list.slice(-90).map((r) => ({
        date: r.date, margin: pts(marginOf(r)), tdp: pts(r.party.TDP), ysrcp: pts(r.party.YSRCP), jsp: pts(r.party.JSP), bjp: pts(r.party.BJP),
        cbn: pts(r.cm.CBN), jmr: pts(r.cm.JMR), pk: pts(r.cm.PK), ln: pts(r.cm.LN),
      })),
      _hist: hist,
    });
  });
  acs.sort((a, b) => a.acNo - b.acNo);
  return { acs, dates, latest, prevD };
}

/* ---------------------------------- seats ---------------------------------- */

const STRENGTHS = ["Comfortable lead", "Narrow lead", "Too close to call"];

function seatProjection(acs) {
  const parties = ["TDP", "JSP", "BJP", "YSRCP"];
  const byParty = {};
  parties.forEach((p) => {
    const contested = p === "YSRCP" ? acs : acs.filter((a) => a.contestParty === p);
    const ahead = acs.filter((a) => a.projected === p);
    const exp = p === "YSRCP" ? contested.reduce((s, a) => s + (1 - (a.pNda || 0)), 0)
      : contested.reduce((s, a) => s + (a.pNda || 0), 0);
    byParty[p] = {
      party: p, contested: contested.length,
      won2024: acs.filter((a) => a.winner2024 === p).length,
      ahead: ahead.length, expected: Math.round(exp),
      ...Object.fromEntries(STRENGTHS.map((s) => [s, ahead.filter((a) => a.strength === s).length])),
      gains: ahead.filter((a) => a.winner2024 && a.winner2024 !== p).length,
      losses: acs.filter((a) => a.winner2024 === p && a.projected !== p).length,
      dependent: p === "YSRCP" ? 0 : contested.filter((a) => a.allianceDependent).length,
    };
  });
  const p = acs.map((a) => a.pNda).filter(Number.isFinite);
  const E = p.reduce((s, x) => s + x, 0);
  const sdv = Math.sqrt(p.reduce((s, x) => s + x * (1 - x), 0));
  const zones = {};
  acs.forEach((a) => {
    const z = (zones[a.zone] = zones[a.zone] || { zone: a.zone, total: 0, TDP: 0, JSP: 0, BJP: 0, YSRCP: 0, close: 0 });
    z.total++; if (z[a.projected] != null) z[a.projected]++; if (a.strength === "Too close to call") z.close++;
  });
  return {
    total: acs.length,
    byParty,
    ndaAhead: acs.filter((a) => a.projected !== "YSRCP" && a.projected !== "—").length,
    ndaExpected: Math.round(E),
    ndaRange: [Math.max(0, Math.round(E - 1.645 * sdv)), Math.min(acs.length, Math.round(E + 1.645 * sdv))],
    nda2024: acs.filter((a) => NDA_PARTIES.has(a.winner2024)).length,
    tooClose: acs.filter((a) => a.strength === "Too close to call").length,
    byZone: Object.values(zones).sort((a, b) => a.zone.localeCompare(b.zone, undefined, { numeric: true })),
    changed: acs.filter((a) => a.changed).map((a) => a.acNo),
  };
}

/* -------------------------------- anomalies -------------------------------- */

const KIND_TEXT = { party: (m) => `support for ${m}`, alliance: (m) => `support for the ${m}`, cm: (m) => `support for ${LEADER[m] || m} as CM`, govt: () => "net approval of the state government" };

function anomalies(acs, stateBlocks, latest) {
  const out = [];
  const robust = (vals) => {
    const m = median(vals); const d = mad(vals);
    return (v) => (v == null || m == null || !d ? null : (v - m) / (1.4826 * d));
  };
  const zM = robust(acs.map((a) => a.d1).filter(Number.isFinite));
  const zC = robust(acs.map((a) => a.cbnD1).filter(Number.isFinite));
  acs.forEach((a) => {
    const z1 = zM(a.d1);
    if (z1 != null && Math.abs(z1) >= 3.5 && Math.abs(a.d1) >= 1) {
      out.push({ type: "Sudden change", severity: Math.abs(z1) >= 5 ? "High" : "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, change: a.d1, score: r3(z1),
        text: `${a.acName}: the gap between ${a.contestParty} and YSRCP moved ${sgn(a.d1)}% in one day — far more than in other constituencies.` });
    }
    const z2 = zC(a.cbnD1);
    if (z2 != null && Math.abs(z2) >= 3.5 && Math.abs(a.cbnD1) >= 1) {
      out.push({ type: "Sudden change", severity: Math.abs(z2) >= 5 ? "High" : "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, change: a.cbnD1, score: r3(z2),
        text: `${a.acName}: support for ${LEADER.CBN} as CM moved ${sgn(a.cbnD1)}% in one day — far more than elsewhere.` });
    }
    const diffs = [];
    for (let i = 1; i < a._hist.length; i++) {
      const y0 = a._hist[i - 1].y; const y1 = a._hist[i].y;
      if (Number.isFinite(y0) && Number.isFinite(y1)) diffs.push(y1 - y0);
    }
    if (diffs.length >= 10) {
      const today = diffs[diffs.length - 1]; const past = diffs.slice(0, -1);
      const s = sd(past); const m = mean(past);
      if (s && Math.abs((today - m) / s) >= 3 && Math.abs(today) >= 0.01) {
        out.push({ type: "Break from usual pattern", severity: "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, change: pts(today), score: r3((today - m) / s),
          text: `${a.acName}: today's movement (${sgn(pts(today))}%) is far outside this constituency's usual day-to-day pattern.` });
      }
    }
    if (a.leaderChanged) {
      out.push({ type: "Lead changed hands", severity: "High", acNo: a.acNo, acName: a.acName, zone: a.zone, change: a.d1,
        text: `${a.acName}: ${a.projected} is now ahead (gap ${sgn(Math.abs(a.margin))}%).` });
    }
    if (a.cmLeaderChanged) {
      out.push({ type: "Lead changed hands", severity: "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, change: a.cbnD1,
        text: `${a.acName}: ${LEADER[a.cm.leading] || a.cm.leading} is now the most preferred Chief Minister here.` });
    }
    if (a.sampleD1 != null && a.sampleD1 <= -30) {
      out.push({ type: "Fewer interviews", severity: "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, change: a.sampleD1,
        text: `${a.acName}: ${Math.abs(a.sampleD1)}% fewer interviews than the day before — treat today's figures with caution.` });
    }
  });
  Object.entries(stateBlocks).forEach(([kind, blk]) => {
    const main = KIND_MAIN[kind];
    const segs = (blk.segments || []).filter((s) => s.d1 && s.d1[main] != null);
    const zS = robust(segs.map((s) => s.d1[main]));
    segs.forEach((s) => {
      const z = zS(s.d1[main]);
      if (z != null && Math.abs(z) >= 3.5 && Math.abs(s.d1[main]) >= 1) {
        out.push({ type: "Voter group shift", severity: "Medium", segment: `${s.group}: ${s.label}`, change: s.d1[main], score: r3(z),
          text: `${s.label} (${s.group.toLowerCase()}): ${KIND_TEXT[kind](main)} moved ${sgn(s.d1[main])}% in one day — unusual compared with other groups.` });
      }
    });
  });
  const sev = { High: 0, Medium: 1 };
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || Math.abs(b.score || 0) - Math.abs(a.score || 0)).map((x) => ({ ...x, date: latest }));
}

/* ------------------------------- correlations ------------------------------- */

const METRIC_SHORT = {
  "Govt Performance": "the state government", "MLA Performance": "their MLA's work", "MLA Availability": "their MLA's availability",
  "MLA Behaviour": "their MLA's behaviour", "MLA Retention": "re-electing their MLA",
};
const METRIC_TEXT = {
  "Govt Performance": "How people rate the state government",
  "MLA Performance": "How people rate their MLA's work",
  "MLA Availability": "How available the MLA is to people",
  "MLA Behaviour": "How people rate the MLA's behaviour",
  "MLA Retention": "Whether people want the MLA again",
};

function drivers(acs, perfMetrics) {
  const y = acs.map((a) => a.margin);
  return perfMetrics.map((m) => {
    const x = acs.map((a) => (a.perf[m] ? a.perf[m].score : null));
    const c = pearson(x, y);
    const r = c.r;
    return {
      metric: m, label: METRIC_TEXT[m] || m, r: r3(r), p: c.p == null ? null : Number(c.p.toPrecision(2)), n: c.n,
      significant: c.p != null && c.p < 0.05,
      strengthText: r == null ? "—" : Math.abs(r) >= 0.7 ? "Very strong link" : Math.abs(r) >= 0.5 ? "Strong link" : Math.abs(r) >= 0.3 ? "Moderate link" : "Weak link",
      ptsPer10: c.slope == null ? null : Math.round(c.slope * 0.1 * 10) / 10,
      intercept: c.slope == null ? null : r3(mean(y) - c.slope * mean(x)),
      slope: c.slope == null ? null : r3(c.slope),
    };
  }).sort((a, b) => Math.abs(b.r || 0) - Math.abs(a.r || 0));
}

/* --------------------------------- at risk --------------------------------- */
/*
 * A seat is "at risk" for the party that won it in 2024 when ANY of these is true:
 *   High    - Losing:        the other side is now ahead
 *   High    - Too close:     the lead is smaller than the survey can reliably measure
 *   Medium  - Narrow lead:   ahead, but only just beyond the margin of error
 *   Watch   - Needs allies:  in a TDP seat, TDP's own vote is below YSRCP's; ahead only with JSP/BJP votes
 *   Watch   - Slipping:      comfortable lead, but falling by 0.25% a day or more (needs >= 7 days of data)
 * Weak MLA ratings are listed as context; they do not decide the level.
 */
function atRisk(acs) {
  const bad = /bad|low/i;
  const out = [];
  acs.forEach((a) => {
    const held = a.winner2024;
    if (!held || a.margin == null) return;
    const heldNda = NDA_PARTIES.has(held);
    const lead = heldNda ? a.margin : -a.margin;            // + means the 2024 winner's side is still ahead
    const reasons = [];
    let level = null;
    const f1 = (x) => Math.abs(x).toFixed(1);
    if (lead < 0) { level = "High"; reasons.push(`${heldNda ? "YSRCP" : `the NDA candidate (${a.contestParty})`} is now ahead by ${f1(a.margin)}%`); }
    else if (a.strength === "Too close to call") { level = "High"; reasons.push(`lead of ${f1(lead)}% is smaller than the survey margin of error (±${a.moe}%)`); }
    else if (a.strength === "Narrow lead") { level = "Medium"; reasons.push(`narrow lead of ${f1(lead)}%`); }
    // "Needs allies" applies to TDP seats only: JSP and BJP candidates rely on TDP voters by design.
    if (heldNda && a.allianceDependent && a.contestParty === "TDP") {
      level = level || "Watch";
      reasons.push(`TDP's own vote is ${f1(a.standalone)}% below YSRCP — ahead only with JSP/BJP votes`);
    }
    // a trend is only meaningful with at least a week of daily points
    const slope = a.trendDays >= 7 ? (heldNda ? a.slope : (a.slope == null ? null : -a.slope)) : null;
    if (slope != null && slope <= -0.25) { level = level || "Watch"; reasons.push(`lead falling by ${Math.abs(slope).toFixed(2)}% a day`); }
    if (!level) return;
    const weak = ["MLA Performance", "MLA Availability", "MLA Behaviour", "MLA Retention"].filter((m) => a.perf[m] && bad.test(a.perf[m].rating));
    out.push({
      acNo: a.acNo, acName: a.acName, zone: a.zone, pc: a.pc, heldBy: held, contestParty: a.contestParty, projected: a.projected,
      lead: Math.round(lead * 10) / 10, moe: a.moe, strength: a.strength, standalone: a.standalone, level, reasons, weakMla: weak, slope,
    });
  });
  const order = { High: 0, Medium: 1, Watch: 2 };
  return out.sort((x, y) => order[x.level] - order[y.level] || x.lead - y.lead);
}

/* --------------------------------- insights -------------------------------- */

function insights(ctx) {
  const { seats, reps, acs, anomalies: an, drivers: dr } = ctx;
  const out = [];
  const bp = seats.byParty;
  const won = (p) => `${p} won ${bp[p].won2024} in 2024`;
  out.push({ tone: "info",
    text: `If an election were held today: TDP would be ahead in ${bp.TDP.ahead} of the ${bp.TDP.contested} seats it contests (${won("TDP")}), JSP in ${bp.JSP.ahead} of ${bp.JSP.contested} (${won("JSP")}), BJP in ${bp.BJP.ahead} of ${bp.BJP.contested} (${won("BJP")}), and YSRCP in ${bp.YSRCP.ahead} (it won ${bp.YSRCP.won2024}).` });
  if (seats.tooClose) out.push({ tone: "warn", text: `${seats.tooClose} seat${seats.tooClose > 1 ? "s are" : " is"} too close to call — the gap between the NDA side and YSRCP is smaller than the survey can reliably measure.` });
  const weakHeld = acs.filter((a) => NDA_PARTIES.has(a.winner2024) && !a.changed && a.health && a.health.band === "Weak").length;
  if (weakHeld) out.push({ tone: "bad", text: `${weakHeld} seat${weakHeld > 1 ? "s" : ""} the NDA won in 2024 ${weakHeld > 1 ? "are" : "is"} now rated Weak on seat health — see Flip watch for what is driving each one.` });
  const pa = reps.party && reps.party.state;
  if (pa) {
    const part = ["TDP", "YSRCP", "JSP", "BJP"].filter((p) => pa.values[p] != null)
      .map((p) => `${p} ${(pa.values[p] * 100).toFixed(1)}%${pa.vsBase[p] != null ? ` (${sgn(pa.vsBase[p])}% since 2024)` : ""}`);
    out.push({ tone: pa.vsBase.TDP >= 0 ? "good" : "warn", text: `Vote share today: ${part.join(", ")}.` });
  }
  if (bp.TDP.dependent) out.push({ tone: "warn", text: `In ${bp.TDP.dependent} TDP seat${bp.TDP.dependent > 1 ? "s" : ""}, TDP's own vote is below YSRCP's; the NDA is ahead there only with JSP and BJP votes.` });
  if (bp.JSP.dependent) out.push({ tone: "info", text: `In ${bp.JSP.dependent} of ${bp.JSP.contested} JSP seats, JSP's own vote is smaller than YSRCP's; the NDA is ahead there because of TDP and BJP supporters' votes.` });
  const cm = reps.cm && reps.cm.state;
  if (cm) {
    out.push({ tone: cm.vsBase.CBN >= 0 ? "good" : "warn",
      text: `${(cm.values.CBN * 100).toFixed(1)}% want ${LEADER.CBN} as Chief Minister and ${(cm.values.JMR * 100).toFixed(1)}% want ${LEADER.JMR}. Support for ${LEADER.CBN} is ${cm.vsBase.CBN >= 0 ? "up" : "down"} ${Math.abs(cm.vsBase.CBN)}% compared with the 2024 survey, while ${LEADER.PK} is ${cm.vsBase.PK >= 0 ? "up" : "down"} ${Math.abs(cm.vsBase.PK)}%.` });
  }
  const lp = acs.filter((a) => a.leaderPremium != null);
  if (lp.length) {
    const behind = lp.filter((a) => a.leaderPremium < 0).length;
    const avg = Math.round((lp.reduce((t, a) => t + a.leaderPremium, 0) / lp.length) * 10) / 10;
    out.push({ tone: "info",
      text: behind === lp.length
        ? `In all ${lp.length} TDP seats, preference for ${LEADER.CBN} as Chief Minister is lower than TDP's vote share (by ${Math.abs(avg)}% on average).`
        : `In ${behind} of ${lp.length} TDP seats, preference for ${LEADER.CBN} as Chief Minister is lower than TDP's vote share.` });
  }
  const segs = ((reps.party && reps.party.segments) || [])
    .filter((x) => x.vsBase.TDP != null && x.moe && x.moe.TDP != null && Math.abs(x.vsBase.TDP) > x.moe.TDP);
  const losers = segs.filter((x) => x.vsBase.TDP < 0).sort((a, b) => a.vsBase.TDP - b.vsBase.TDP).slice(0, 4);
  if (losers.length) out.push({ tone: "bad", text: `TDP has lost support since 2024 among ${losers.map((x) => `${x.label} (${x.vsBase.TDP}%)`).join(", ")}.` });
  const gainers = segs.filter((x) => x.vsBase.TDP > 0).sort((a, b) => b.vsBase.TDP - a.vsBase.TDP).slice(0, 3);
  if (gainers.length) out.push({ tone: "good", text: `TDP's biggest gains since 2024: ${gainers.map((x) => `${x.label} (${sgn(x.vsBase.TDP)}%)`).join(", ")}.` });
  const gv = reps.govt && reps.govt.state;
  if (gv && gv.values["Above Average"] != null) {
    out.push({ tone: gv.values.Net >= 0 ? "good" : "warn",
      text: `${(gv.values["Above Average"] * 100).toFixed(0)}% rate the state government above average and ${(gv.values["Below Average"] * 100).toFixed(0)}% below average.` });
  }
  const strongest = (dr || []).find((d) => d.significant && d.r > 0);
  if (strongest) out.push({ tone: "info", text: `Where people rate ${METRIC_SHORT[strongest.metric] || strongest.metric} more highly, the NDA's lead over YSRCP is clearly bigger — the strongest pattern in the data.` });
  const hi = an.filter((x) => x.severity === "High").length;
  if (an.length) out.push({ tone: hi ? "bad" : "info", text: `${an.length} unusual movement${an.length === 1 ? "" : "s"} on the latest day${hi ? `, ${hi} of them important` : ""} — see Alerts.` });
  return out;
}

/* ---------------------------------- build ---------------------------------- */

/* ------------------------------- seat health ------------------------------- */
/*
 * Seat Health Score (0-100), always from the NDA side's point of view:
 *   Vote lead      0-50  = 50 x P(NDA side genuinely ahead)   (allows for the margin of error)
 *   Trend          0-20  = 10 neutral; +/- up to 10 for the 14-day trend (needs >= 7 days of data)
 *   Local ratings  0-30  = each rating's rank among all ACs, weighted by how strongly that rating is
 *                          linked to the NDA lead statewide (correlation r). In seats YSRCP won in 2024,
 *                          the MLA ratings describe a YSRCP MLA, so they count the other way.
 * Bands (NDA side's strength): Strong >= 75, Stable 60-74, Watch 45-59, Weak < 45.
 */
const HEALTH_BANDS = [[75, "Strong"], [60, "Stable"], [45, "Watch"], [0, "Weak"]];
const RATING_LABEL = {
  "Govt Performance": "State government rating", "MLA Performance": "MLA's work",
  "MLA Availability": "MLA's availability", "MLA Behaviour": "MLA's behaviour", "MLA Retention": "Want MLA again",
};

function seatHealth(acs, drv, perfMetrics) {
  const N = acs.length;
  const usable = (drv || []).filter((d) => d.significant && d.r > 0);
  const totalR = usable.reduce((t, d) => t + d.r, 0) || 1;
  const weight = Object.fromEntries(usable.map((d) => [d.metric, d.r / totalR]));
  const avg = {};
  perfMetrics.forEach((m) => {
    const v = acs.map((a) => a.perf[m] && a.perf[m].score).filter(Number.isFinite);
    avg[m] = v.length ? v.reduce((t, x) => t + x, 0) / v.length : null;
  });
  // rank -> percentile (1 = best in state). Use the sheet's own rank when present, else rank the scores.
  const pctOf = (a, m) => {
    const p = a.perf[m];
    if (!p) return null;
    if (Number.isFinite(p.rank) && N > 1) return 1 - (p.rank - 1) / (N - 1);
    const better = acs.filter((x) => x.perf[m] && x.perf[m].score > p.score).length;
    return 1 - better / Math.max(N - 1, 1);
  };

  acs.forEach((a) => {
    const lead = 50 * (a.pNda == null ? 0.5 : a.pNda);
    const trendReady = (a.trendDays || 0) >= 7 && a.slope != null;
    const trend = trendReady ? 10 + Math.max(-10, Math.min(10, a.slope * 20)) : 10;
    const ysrcpMla = a.winner2024 === "YSRCP";
    let local = 0;
    const factors = [];
    perfMetrics.forEach((m) => {
      const pct = pctOf(a, m);
      if (pct == null) return;
      const isMla = /^MLA/i.test(m);
      const forNda = isMla && ysrcpMla ? 1 - pct : pct;     // a well-rated YSRCP MLA helps YSRCP
      if (weight[m]) local += 30 * weight[m] * forNda;
      factors.push({
        metric: m, label: RATING_LABEL[m] || m, weight: Math.round((weight[m] || 0) * 100),
        score: a.perf[m].score != null ? Math.round(a.perf[m].score * 1000) / 10 : null,
        stateAvg: avg[m] != null ? Math.round(avg[m] * 1000) / 10 : null,
        rank: a.perf[m].rank != null ? a.perf[m].rank : null, rating: a.perf[m].rating || "",
        effect: Math.round((forNda - 0.5) * 2 * (weight[m] || 0) * 100) / 100,   // -w .. +w : helps (+) or hurts (-) the NDA side
        ysrcpMla: isMla && ysrcpMla,
      });
    });
    const score = Math.round(lead + trend + local);
    const band = HEALTH_BANDS.find(([min]) => score >= min)[1];
    // days until the lead would reach zero at the current trend (only with >= 7 days of data)
    const ndaLead = a.margin;
    const towardsZero = trendReady && ndaLead != null && a.slope != null && Math.sign(a.slope) === -Math.sign(ndaLead) && a.slope !== 0;
    const daysToFlip = towardsZero ? Math.round(Math.abs(ndaLead / a.slope)) : null;
    // 7-day change of the NDA side's lead
    const ser = a.series || [];
    const last = ser[ser.length - 1];
    let change7 = null;
    if (last) {
      const cut = new Date(Date.parse(`${last.date}T00:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
      const base = [...ser].reverse().find((p) => p.date <= cut);
      if (base && base.margin != null && last.margin != null) change7 = Math.round((last.margin - base.margin) * 10) / 10;
    }
    a.health = {
      score, band,
      parts: { lead: Math.round(lead), trend: Math.round(trend), local: Math.round(local) },
      trendReady, daysToFlip, change7,
      factors: factors.sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect)),
    };
  });

  const flipped = acs.filter((a) => a.changed);
  return {
    weights: usable.map((d) => ({ metric: d.metric, label: RATING_LABEL[d.metric] || d.metric, weight: Math.round((weight[d.metric] || 0) * 100), r: d.r })),
    bands: Object.fromEntries(HEALTH_BANDS.map(([, b]) => [b, acs.filter((a) => a.health.band === b).length])),
    flippedToNda: flipped.filter((a) => a.projected !== "YSRCP").length,
    flippedToYsrcp: flipped.filter((a) => a.projected === "YSRCP").length,
    trendingToFlip: acs.filter((a) => a.health.daysToFlip != null && a.health.daysToFlip <= 30).length,
    trendReady: acs.some((a) => a.health.trendReady),
    maxTrendDays: Math.max(0, ...acs.map((a) => a.trendDays || 0)),
  };
}

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
    if (master && master.rows.length) ({ acs, dates, latest, prevD } = acStats(master));
    const pcZone = {}; acs.forEach((a) => { if (a.pc && a.zone) pcZone[a.pc] = a.zone; });
    Object.values(reps).forEach((blk) => (blk.pcs || []).forEach((p) => { if (!p.zone) p.zone = pcZone[p.label] || ""; }));

    const seats = acs.length ? seatProjection(acs) : null;
    const an = anomalies(acs, reps, latest);
    const perfMetrics = master ? master.perfMetrics : [];
    const dr = acs.length ? drivers(acs, perfMetrics) : [];
    const risk = atRisk(acs);
    const health = acs.length ? seatHealth(acs, dr, perfMetrics) : null;
    // Trend-based flags (need >= 7 days): sustained 7-day shifts and leads on course to flip.
    acs.forEach((a) => {
      const h = a.health; if (!h) return;
      if (h.daysToFlip != null && h.daysToFlip <= 30) {
        an.unshift({ type: "Could flip", severity: "High", acNo: a.acNo, acName: a.acName, zone: a.zone, change: h.change7, date: latest,
          text: `${a.acName}: ${a.projected === "YSRCP" ? "YSRCP" : `the NDA (${a.contestParty})`} lead of ${Math.abs(a.margin)}% is shrinking ${Math.abs(a.slope)}% a day — at this pace it would be gone in about ${h.daysToFlip} days.` });
      } else if (h.change7 != null && Math.abs(h.change7) >= 3) {
        an.unshift({ type: "Sustained shift", severity: Math.abs(h.change7) >= 5 ? "High" : "Medium", acNo: a.acNo, acName: a.acName, zone: a.zone, change: h.change7, date: latest,
          text: `${a.acName}: over the last 7 days the NDA side's lead moved ${h.change7 > 0 ? "+" : ""}${h.change7}% (${h.change7 > 0 ? "towards" : "away from"} the NDA).` });
      }
    });
    const repDates = [...new Set(Object.values(reps).flatMap((b) => b.stateSeries.map((p) => p.date)))].sort();
    acs.forEach((a) => { delete a._hist; });

    result.byWindow[w] = {
      window: w,
      latestDate: latest || repDates[repDates.length - 1] || null,
      previousDate: prevD,
      firstDate: dates[0] || repDates[0] || null,
      days: Math.max(dates.length, repDates.length),
      state: reps, acs, seats, anomalies: an, drivers: dr, atRisk: risk, perfMetrics, health,
      insights: seats ? insights({ seats, reps, acs, anomalies: an, drivers: dr, risk }) : [],
      issues,
    };
  });
  return result;
}

/** Keep only data between two ISO dates (inclusive); either bound may be empty. */
function filterByDate(parsed, from, to) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  return {
    ...parsed,
    masters: parsed.masters.map((m) => ({ ...m, rows: m.rows.filter((r) => inRange(r.date)) })),
    reports: parsed.reports.map((r) => ({
      ...r,
      entities: Object.fromEntries(Object.entries(r.entities).map(([k, e]) => [k, { ...e, series: e.series.filter((p) => inRange(p.date)) }])),
    })),
  };
}

function dateBounds(parsed) {
  const all = [
    ...parsed.masters.flatMap((m) => m.rows.map((r) => r.date)),
    ...parsed.reports.flatMap((r) => Object.values(r.entities).flatMap((e) => e.series.map((p) => p.date))),
  ].sort();
  return { min: all[0] || null, max: all[all.length - 1] || null };
}

module.exports = { buildDashboard, filterByDate, dateBounds, LEADER, normCdf, seDiff, seProp, trend, pearson, median, mad };
