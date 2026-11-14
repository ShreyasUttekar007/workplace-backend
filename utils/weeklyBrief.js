/**
 * AP Vote-share tracker - Weekly Brief (one-page Saturday report).
 *
 * A "week" runs Sunday..Saturday. For a chosen week ending:
 *   - every share is POOLED across all interviews of that week (weighted by
 *     each day's sample), and compared with the same pooled figure for the
 *     week before - far steadier than comparing two single days;
 *   - whether a change is real is judged against the two weeks' combined
 *     margin of error (same methods as the live dashboard);
 *   - seat-health bands and trend alerts are taken from the live dashboard
 *     computed "as of" the week's last day and the previous week's last day.
 *
 * All share values are fractions (0..1); all change values are in % (x100).
 */

const { buildDashboard, filterByDate } = require("./voteshareStats");

const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e6) / 1e6);
const p1 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 10); // fraction -> %
const d1 = (a, b) => (a == null || b == null ? null : Math.round((a - b) * 1000) / 10);  // change in %
const sgn = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x}`);
const NDA_PARTIES = ["TDP", "JSP", "BJP"];
const LEADER = { CBN: "HCM Chandrababu Naidu", JMR: "YS Jagan Mohan Reddy", PK: "DCM Pawan Kalyan", LN: "HITM Nara Lokesh" };

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dow = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay(); // 6 = Saturday
const fmtD = (iso) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const wd = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
  const dm = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${wd}, ${dm} ${d.getUTCFullYear()}`;
};

function allDates(parsed) {
  const s = new Set();
  parsed.masters.forEach((m) => m.rows.forEach((r) => s.add(r.date)));
  parsed.reports.forEach((r) => Object.values(r.entities).forEach((e) => e.series.forEach((x) => s.add(x.date))));
  return [...s].sort();
}

/** Every Saturday that closes a week with data, newest first; plus "week to date" if the data ends mid-week. */
function listWeekEnds(parsed) {
  const dates = allDates(parsed);
  if (!dates.length) return [];
  const has = new Set(dates);
  const weekHasData = (end) => { for (let i = 0; i < 7; i++) if (has.has(addDays(end, -i))) return true; return false; };
  let sat = dates[dates.length - 1];
  while (dow(sat) !== 6) sat = addDays(sat, -1);        // Saturday on/before the last data day
  const out = [];
  const last = dates[dates.length - 1];
  if (dow(last) !== 6 && last > sat) out.push({ end: last, label: `Week to date — ${fmtD(last)}`, toDate: true });
  for (let end = sat; end >= dates[0] || weekHasData(end); end = addDays(end, -7)) {
    if (weekHasData(end)) out.push({ end, label: `Week ending ${fmtD(end)}`, toDate: false });
    if (end < dates[0]) break;
  }
  return out;
}

/* --------------------------------- pooling --------------------------------- */

/** Sample-weighted pool of {values, sample} points. Returns { n, days, values } (values are fractions). */
function pool(points) {
  const out = { n: 0, days: 0, values: {} };
  const wsum = {};
  points.forEach((p) => {
    const w = Number.isFinite(p.sample) && p.sample > 0 ? p.sample : 1;
    out.n += Number.isFinite(p.sample) ? p.sample : 0;
    out.days += 1;
    Object.entries(p.values).forEach(([k, v]) => {
      if (!Number.isFinite(v)) return;
      out.values[k] = (out.values[k] || 0) + v * w;
      wsum[k] = (wsum[k] || 0) + w;
    });
  });
  Object.keys(out.values).forEach((k) => { out.values[k] /= wsum[k]; });
  return out;
}

/** Margin of error of a change between two pooled shares (%, 95%). */
function changeMoe(pNow, nNow, pPrev, nPrev) {
  if (pNow == null || pPrev == null || !nNow || !nPrev) return null;
  const v = (pNow * (1 - pNow)) / nNow + (pPrev * (1 - pPrev)) / nPrev;
  return Math.round(1.96 * Math.sqrt(Math.max(v, 0)) * 1000) / 10;
}

const inRange = (dte, a, b) => dte >= a && dte <= b;

/* -------------------------- per-window computations ------------------------ */

function masterFor(parsed, w, windows, reportWindows) {
  return parsed.masters.find((m) => m.window === w) ||
    (parsed.masters.find((m) => !m.window) && (reportWindows.length <= 1 || w === windows[0])
      ? parsed.masters.find((m) => !m.window) : null);
}
const reportsFor = (parsed, w, reportWindows) =>
  parsed.reports.filter((r) => (reportWindows.length ? r.window === w : !r.window));

/** Pool one week of master rows into per-AC figures. */
function weekAcs(master, a, b) {
  const byAc = new Map();
  (master ? master.rows : []).forEach((r) => {
    if (!inRange(r.date, a, b)) return;
    if (!byAc.has(r.acNo)) byAc.set(r.acNo, []);
    byAc.get(r.acNo).push(r);
  });
  const out = new Map();
  byAc.forEach((rows, acNo) => {
    const last = rows[rows.length - 1];
    const pts = rows.map((r) => ({ sample: r.sample, values: r.party }));
    const pl = pool(pts);
    const nda = NDA_PARTIES.reduce((t, k) => t + (pl.values[k] || 0), 0);
    const ys = pl.values.YSRCP;
    if (ys == null) return;
    const margin = nda - ys;
    const se = pl.n > 0 ? Math.sqrt(Math.max(nda + ys - margin ** 2, 1e-9) / pl.n) : null;
    const cm = pool(rows.map((r) => ({ sample: r.sample, values: r.cm }))).values;
    const contest = NDA_PARTIES.includes(last.ndaContest) ? last.ndaContest : "TDP";
    out.set(acNo, {
      acNo, acName: last.acName, pc: last.pc, zone: last.zone, winner2024: String(last.winner2024 || "").toUpperCase(),
      contestParty: contest, n: pl.n, days: pl.days,
      nda: r4(nda), ysrcp: r4(ys), margin: p1(margin),
      moe: se == null ? null : Math.round(1.96 * se * 1000) / 10,
      side: margin >= 0 ? contest : "YSRCP",
      tooClose: se != null && Math.abs(margin / se) < 1,   // same rule as the dashboard's "Too close to call"
      cm,
    });
  });
  return out;
}

/** Pool one week of a report entity's series. */
function weekEntity(ent, a, b, govt) {
  const pts = ent.series.filter((x) => inRange(x.date, a, b)).map((x) => ({ sample: x.sample, values: x.values }));
  if (!pts.length) return null;
  const pl = pool(pts);
  if (govt) {
    const above = pl.values["Above Average"] != null ? pl.values["Above Average"] : (pl.values["Very Good"] || 0) + (pl.values.Good || 0);
    const below = pl.values["Below Average"] != null ? pl.values["Below Average"] : (pl.values.Bad || 0) + (pl.values["Very Bad"] || 0);
    pl.values["Above Average"] = above; pl.values["Below Average"] = below; pl.values.Net = above - below;
  }
  return pl;
}

/** Pool a week of master rows by zone or PC: sample-weighted party shares. */
function regionPool(master, a, b, key) {
  const g = new Map();
  (master ? master.rows : []).forEach((r) => {
    if (!inRange(r.date, a, b)) return;
    const k = String(r[key] || "").trim();
    if (!k) return;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push({ sample: r.sample, values: r.party });
  });
  const out = new Map();
  g.forEach((pts, k) => {
    const pl = pool(pts);
    const nda = NDA_PARTIES.reduce((t, x) => t + (pl.values[x] || 0), 0);
    out.set(k, { n: pl.n, tdp: pl.values.TDP, ysrcp: pl.values.YSRCP, jsp: pl.values.JSP, bjp: pl.values.BJP,
      nda, gap: pl.values.YSRCP != null ? nda - pl.values.YSRCP : null });
  });
  return out;
}

function stateBlock(reps, kind, a, b, pa, pb, master) {
  const rep = reps.find((r) => r.kind === kind);
  const ent = rep && Object.values(rep.entities).find((e) => e.type === "state");
  let now = ent ? weekEntity(ent, a, b, kind === "govt") : null;
  let prev = ent ? weekEntity(ent, pa, pb, kind === "govt") : null;
  // fall back to the master (statewide = pool of every AC interview) for party / cm
  if (!now && master && (kind === "party" || kind === "cm")) {
    const rows = (x, y) => master.rows.filter((r) => inRange(r.date, x, y)).map((r) => ({ sample: r.sample, values: kind === "party" ? r.party : r.cm }));
    const n0 = rows(a, b); const p0 = rows(pa, pb);
    now = n0.length ? pool(n0) : null;
    prev = p0.length ? pool(p0) : null;
  }
  if (!now) return null;
  const keys = Object.keys(now.values);
  const out = { n: now.n, days: now.days, prevN: prev ? prev.n : 0, values: {}, prev: {}, change: {}, moe: {}, significant: {} };
  keys.forEach((k) => {
    const v = now.values[k]; const pv = prev ? prev.values[k] : null;
    out.values[k] = r4(v);
    out.prev[k] = r4(pv);
    out.change[k] = pv == null ? null : d1(v, pv);
    if (k !== "Net") {
      const m = changeMoe(v, now.n, pv, prev ? prev.n : 0);
      out.moe[k] = m;
      out.significant[k] = m != null && out.change[k] != null ? Math.abs(out.change[k]) > m : null;
    }
  });
  const baseline = ent && ent.baseline ? ent.baseline.values : null;
  if (baseline) out.vs2024 = Object.fromEntries(keys.filter((k) => baseline[k] != null).map((k) => [k, d1(now.values[k], baseline[k])]));
  return out;
}

/* -------------------------------- takeaways -------------------------------- */

function takeaways(m) {
  const out = [];
  const few = (list, n = 3) => list.slice(0, n).map((x) => x.acName).join(", ") + (list.length > n ? ` and ${list.length - n} more` : "");
  const h = m.state.headline;
  if (h) {
    out.push({
      tone: h.change == null ? "info" : !h.significant ? "info" : h.change >= 0 ? "good" : "warn",
      text: `Across this week's interviews the NDA parties together stand at ${p1(h.nda)}% against YSRCP's ${p1(h.ysrcp)}%`
        + (h.change == null ? " — this is the first week of data, so there is no earlier week to compare." :
          ` — ${sgn(h.change)}% on last week, ${h.significant ? "a real change, bigger than" : "within"} the survey's margin of error (±${h.moe}%).`),
    });
  }
  if (m.seats && m.seats.aheadPrev != null) {
    const s = m.seats;
    out.push({ tone: s.aheadNow >= s.aheadPrev ? "info" : "warn",
      text: `Pooling the whole week's interviews, the NDA side is ahead in ${s.aheadNow} of ${s.total} seats (${s.aheadPrev} last week); ${s.tooCloseNow} are too close to call (${s.tooClosePrev} last week).` });
    if (s.gained.length) out.push({ tone: "good", text: `Moved to the NDA side this week: ${few(s.gained)}.` });
    if (s.lost.length) out.push({ tone: "bad", text: `Moved to YSRCP this week: ${few(s.lost)}.` });
    if (!s.gained.length && !s.lost.length) out.push({ tone: "info", text: "No seat changed sides this week." });
  }
  if (m.watch && m.watch.bandsNow && m.watch.bandsPrev) {
    const wNow = m.watch.bandsNow.Weak || 0; const wPrev = m.watch.bandsPrev.Weak || 0;
    if (wNow !== wPrev) out.push({ tone: wNow > wPrev ? "bad" : "good", text: `Seats rated Weak on seat health went from ${wPrev} to ${wNow} over the week — see Flip watch for what is driving each one.` });
  }
  const gl = m.groups.filter((g) => g.significant && g.change < 0).sort((x, y) => x.change - y.change)[0];
  const gg = m.groups.filter((g) => g.significant && g.change > 0).sort((x, y) => y.change - x.change)[0];
  if (gl) out.push({ tone: "bad", text: `TDP lost real ground this week among ${gl.label} (${gl.group.toLowerCase()}): ${sgn(gl.change)}%.` });
  if (gg) out.push({ tone: "good", text: `TDP's clearest gain this week: ${gg.label} (${gg.group.toLowerCase()}), ${sgn(gg.change)}%.` });
  const up = m.movers.up[0]; const dn = m.movers.down[0];
  if (dn && dn.change <= -1) out.push({ tone: "bad", text: `Biggest move away from the NDA: ${dn.acName} (${dn.zone}), where the gap over YSRCP moved ${sgn(dn.change)}% this week.` });
  if (up && up.change >= 1) out.push({ tone: "good", text: `Biggest move towards the NDA: ${up.acName} (${up.zone}), ${sgn(up.change)}% this week.` });
  const z = [...m.zones].filter((x) => x.change != null).sort((x, y) => Math.abs(y.change) - Math.abs(x.change))[0];
  if (z && Math.abs(z.change) >= 0.8) out.push({ tone: z.change >= 0 ? "good" : "warn", text: `${z.zone} moved the most among zones: the NDA–YSRCP gap there is ${sgn(z.change)}% on last week.` });
  const cm = m.state.cm;
  if (cm && cm.change.CBN != null) {
    out.push({ tone: cm.change.CBN >= 0 ? "good" : "warn",
      text: `${p1(cm.values.CBN)}% want ${LEADER.CBN} as Chief Minister (${sgn(cm.change.CBN)}% on last week); ${LEADER.JMR} is at ${p1(cm.values.JMR)}% (${sgn(cm.change.JMR)}%).` });
  }
  const gv = m.state.govt;
  if (gv && gv.values.Net != null && gv.prev.Net != null) {
    const c = d1(gv.values.Net, gv.prev.Net);
    out.push({ tone: c >= 0 ? "good" : "warn", text: `Net rating of the state government (above-average minus below-average) is ${sgn(p1(gv.values.Net))}%, ${c >= 0 ? "up" : "down"} ${Math.abs(c)}% on last week.` });
  }
  if (m.watch && m.watch.alerts.length) out.push({ tone: "warn", text: `${m.watch.alerts.length} seat${m.watch.alerts.length > 1 ? "s" : ""} ended the week with an active trend alert (lead shrinking or a sustained shift).` });
  return out.slice(0, 9);
}

/* ---------------------------------- build ---------------------------------- */

function buildWeeklyBrief(parsed, end) {
  // Weeks run Sunday..Saturday. A mid-week "week to date" starts on its own
  // Sunday and is compared with the last FULL week before it.
  const b = end;
  const toDate = dow(end) !== 6;
  const a = toDate ? addDays(end, -dow(end)) : addDays(end, -6);   // the week's Sunday
  const pb = addDays(a, -1); const pa = addDays(a, -7);            // previous full week
  const snapNow = buildDashboard(filterByDate(parsed, "", b));
  const snapPrev = buildDashboard(filterByDate(parsed, "", pb));
  const reportWindows = [...new Set(parsed.reports.map((r) => r.window).filter(Boolean))];
  const windows = snapNow.windows;
  const out = { week: { start: a, end: b, prevStart: pa, prevEnd: pb, toDate,
    label: toDate ? `Week to date — ${fmtD(b)}` : `Week ending ${fmtD(b)}`, endLabel: fmtD(b) }, windows, byWindow: {} };

  windows.forEach((w) => {
    const master = masterFor(parsed, w, windows, reportWindows);
    const reps = reportsFor(parsed, w, reportWindows);
    const now = weekAcs(master, a, b);
    const prev = weekAcs(master, pa, pb);
    const hasPrev = prev.size > 0;

    const acs = [...now.values()].map((x) => {
      const p = prev.get(x.acNo);
      return { ...x, marginPrev: p ? p.margin : null, sidePrev: p ? p.side : null,
        change: p ? Math.round((x.margin - p.margin) * 10) / 10 : null };
    });
    const gained = acs.filter((x) => x.sidePrev === "YSRCP" && x.side !== "YSRCP");
    const lost = acs.filter((x) => x.sidePrev && x.sidePrev !== "YSRCP" && x.side === "YSRCP");
    const seats = acs.length ? {
      total: acs.length,
      aheadNow: acs.filter((x) => x.side !== "YSRCP").length,
      aheadPrev: hasPrev ? [...prev.values()].filter((x) => x.side !== "YSRCP").length : null,
      ysrcpNow: acs.filter((x) => x.side === "YSRCP").length,
      tooCloseNow: acs.filter((x) => x.tooClose).length,
      tooClosePrev: hasPrev ? [...prev.values()].filter((x) => x.tooClose).length : null,
      gained: gained.map(({ acNo, acName, zone, margin, change }) => ({ acNo, acName, zone, margin, change })),
      lost: lost.map(({ acNo, acName, zone, margin, change }) => ({ acNo, acName, zone, margin, change })),
      nda2024: acs.filter((x) => NDA_PARTIES.includes(x.winner2024)).length,
    } : null;

    const movers = { up: [], down: [] };
    const mv = acs.filter((x) => x.change != null).sort((x, y) => y.change - x.change)
      .map(({ acNo, acName, zone, pc: p, margin, marginPrev, change, side }) => ({ acNo, acName, zone, pc: p, margin, marginPrev, change, side }));
    movers.up = mv.filter((x) => x.change > 0).slice(0, 5);
    movers.down = mv.filter((x) => x.change < 0).reverse().slice(0, 5);

    const zPoolNow = regionPool(master, a, b, "zone");
    const zPoolPrev = regionPool(master, pa, pb, "zone");
    const zSeats = {};
    acs.forEach((x) => {
      const z = (zSeats[x.zone] = zSeats[x.zone] || { seats: 0, ahead: 0, aheadPrev: 0, prevSeats: 0 });
      z.seats++; if (x.side !== "YSRCP") z.ahead++;
      if (x.sidePrev != null) { z.prevSeats++; if (x.sidePrev !== "YSRCP") z.aheadPrev++; }
    });
    const dd = (nw, pv) => (nw == null || pv == null ? null : Math.round((nw - pv) * 1000) / 10);
    const zones = [...zPoolNow.keys()].map((zn) => {
      const nw = zPoolNow.get(zn); const pv = zPoolPrev.get(zn) || {};
      const sMeta = zSeats[zn] || { seats: 0, ahead: 0, aheadPrev: 0, prevSeats: 0 };
      return {
        zone: zn, seats: sMeta.seats, ahead: sMeta.ahead,
        aheadPrev: sMeta.prevSeats ? sMeta.aheadPrev : null, n: nw.n,
        tdp: r4(nw.tdp), tdpCh: dd(nw.tdp, pv.tdp), ysrcp: r4(nw.ysrcp), ysrcpCh: dd(nw.ysrcp, pv.ysrcp),
        jsp: r4(nw.jsp), jspCh: dd(nw.jsp, pv.jsp), bjp: r4(nw.bjp), bjpCh: dd(nw.bjp, pv.bjp),
        gap: p1(nw.gap), gapCh: dd(nw.gap, pv.gap), change: dd(nw.gap, pv.gap),
      };
    }).sort((x, y) => x.zone.localeCompare(y.zone, undefined, { numeric: true }));

    const pPoolNow = regionPool(master, a, b, "pc");
    const pPoolPrev = regionPool(master, pa, pb, "pc");
    const pMeta = {};
    acs.forEach((x) => {
      const q = (pMeta[x.pc] = pMeta[x.pc] || { zone: x.zone, seats: 0, ahead: 0, aheadPrev: 0, prevSeats: 0 });
      q.seats++; if (x.side !== "YSRCP") q.ahead++;
      if (x.sidePrev != null) { q.prevSeats++; if (x.sidePrev !== "YSRCP") q.aheadPrev++; }
    });
    const pcs = [...pPoolNow.keys()].map((name) => {
      const nw = pPoolNow.get(name); const pv = pPoolPrev.get(name) || {};
      const q = pMeta[name] || { zone: "", seats: 0, ahead: 0, aheadPrev: 0, prevSeats: 0 };
      return { pc: name, zone: q.zone, seats: q.seats, ahead: q.ahead, aheadPrev: q.prevSeats ? q.aheadPrev : null,
        tdp: r4(nw.tdp), tdpCh: dd(nw.tdp, pv.tdp), ysrcp: r4(nw.ysrcp), ysrcpCh: dd(nw.ysrcp, pv.ysrcp),
        gap: p1(nw.gap), gapCh: dd(nw.gap, pv.gap) };
    }).sort((x, y) => (x.zone === y.zone ? x.pc.localeCompare(y.pc) : String(x.zone).localeCompare(String(y.zone), undefined, { numeric: true })));

    const state = {
      party: stateBlock(reps, "party", a, b, pa, pb, master),
      alliance: stateBlock(reps, "alliance", a, b, pa, pb, null),
      cm: stateBlock(reps, "cm", a, b, pa, pb, master),
      govt: stateBlock(reps, "govt", a, b, pa, pb, null),
    };

    if (state.party) {
      const spa = state.party;
      const nda = NDA_PARTIES.reduce((t, k) => t + (spa.values[k] || 0), 0);
      const ndaPrev = spa.prev.TDP != null ? NDA_PARTIES.reduce((t, k) => t + (spa.prev[k] || 0), 0) : null;
      const ch = ndaPrev == null ? null : d1(nda, ndaPrev);
      const moe = changeMoe(nda, spa.n, ndaPrev, spa.prevN);
      const v24 = spa.vs2024 || {};
      const ndaVs2024 = ["TDP", "JSP", "BJP"].every((k) => v24[k] != null)
        ? Math.round((v24.TDP + v24.JSP + v24.BJP) * 10) / 10 : null;
      state.headline = { nda: r4(nda), ndaPrev: r4(ndaPrev), ysrcp: spa.values.YSRCP, ysrcpPrev: spa.prev.YSRCP,
        change: ch, ysrcpChange: spa.change.YSRCP, moe, significant: ch != null && moe != null ? Math.abs(ch) > moe : null,
        vs2024: ndaVs2024, ysrcpVs2024: v24.YSRCP != null ? v24.YSRCP : null };
    }

    const groups = [];
    const partyRep = reps.find((r) => r.kind === "party");
    if (partyRep) {
      Object.values(partyRep.entities).filter((e) => e.type === "segment").forEach((e) => {
        const nw = weekEntity(e, a, b); const pv = weekEntity(e, pa, pb);
        if (!nw || nw.values.TDP == null) return;
        const ch = pv && pv.values.TDP != null ? d1(nw.values.TDP, pv.values.TDP) : null;
        const moe = pv ? changeMoe(nw.values.TDP, nw.n, pv.values.TDP, pv.n) : null;
        groups.push({ group: e.group, label: e.label, tdp: r4(nw.values.TDP), ysrcp: r4(nw.values.YSRCP),
          change: ch, ysrcpChange: pv && pv.values.YSRCP != null ? d1(nw.values.YSRCP, pv.values.YSRCP) : null,
          moe, significant: ch != null && moe != null && Math.abs(ch) > moe });
      });
      groups.sort((x, y) => (y.significant === x.significant ? Math.abs(y.change || 0) - Math.abs(x.change || 0) : y.significant ? 1 : -1));
    }

    const sN = snapNow.byWindow[w] || {}; const sP = snapPrev.byWindow[w] || {};
    const watch = {
      bandsNow: sN.health ? sN.health.bands : null,
      bandsPrev: sP.health ? sP.health.bands : null,
      expectedNow: sN.seats ? sN.seats.ndaExpected : null,
      expectedPrev: sP.seats ? sP.seats.ndaExpected : null,
      rangeNow: sN.seats ? sN.seats.ndaRange : null,
      riskHighNow: sN.atRisk ? sN.atRisk.filter((x) => x.level === "High").length : null,
      riskHighPrev: sP.atRisk ? sP.atRisk.filter((x) => x.level === "High").length : null,
      alerts: (sN.anomalies || []).filter((x) => x.type === "Could flip" || x.type === "Sustained shift").slice(0, 4)
        .map(({ type, acName, zone, text }) => ({ type, acName, zone, text })),
      asOf: sN.latestDate || null, prevAsOf: sP.latestDate || null,
    };

    const weekRows = master ? master.rows.filter((r) => inRange(r.date, a, b)) : [];
    const sample = {
      interviews: weekRows.reduce((t, r) => t + (r.sample || 0), 0),
      days: [...new Set(weekRows.map((r) => r.date))].length,
      acsCovered: now.size,
      prevInterviews: master ? master.rows.filter((r) => inRange(r.date, pa, pb)).reduce((t, r) => t + (r.sample || 0), 0) : 0,
    };

    const model = { window: w, seats, movers, zones, pcs, state, groups, watch, sample, hasPrev };
    model.takeaways = takeaways(model);
    out.byWindow[w] = model;
  });
  return out;
}

module.exports = { buildWeeklyBrief, listWeekEnds };
