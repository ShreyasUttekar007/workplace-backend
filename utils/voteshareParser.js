/**
 * AP Vote-share tracker - sheet parser.
 *
 * Two kinds of tab are understood, and recognised by their CONTENT, not names:
 *
 *  1. MASTER (long format)  - one row per Date x Assembly Constituency:
 *       Date | AC NO | AC Name | PC Name | Zone | AE2024 Winner | NDA Contest | Sample
 *       | party block (TDP YSRCP JSP BJP INC Others, TDP Margin, Leading)
 *       | alliance block (NDA YSRCP INDIA Others, NDA Margin, Leading)
 *       | CM block (CBN JMR PK LN Others, CBN Margin, Leading)
 *       | <Metric> Score / Rating / Rank  (Govt Performance, MLA Performance, ...)
 *     Column names repeat across blocks ("YSRCP", "Others", "Leading"), so
 *     columns are read by their position inside each block.
 *
 *  2. REPORT (formatted)    - CM / party / Alliance / state govt rating tabs.
 *     Stacked tables (State, voter groups, Zone, PC); each entity has one row
 *     per date with the label only on its first row, plus a 2024 baseline and
 *     change columns. New days ADD rows inside every block, so nothing assumes
 *     a fixed number of dates.
 *
 * Every value is a share in 0..1 (percent strings and 0..100 numbers are
 * normalised). Dates are parsed to ISO (YYYY-MM-DD) - never sorted as text.
 */

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

const clean = (v) => String(v == null ? "" : v).replace(/[\u2060\u200B\uFEFF]/g, "").replace(/\u00A0/g, " ").trim();
const oneLine = (v) => clean(v).replace(/\s+/g, " ");

function toISODate(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && v > 20000 && v < 80000) {           // Sheets serial date
    const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = clean(v);
  let m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]+(\d{2,4})$/);  // 31-Oct-2026
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo == null) return null;
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(y, mo, Number(m[1]))).toISOString().slice(0, 10);
  }
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);                      // 2026-10-31
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);                    // 31/10/2026 (day first, Indian)
  if (m) {
    const a = +m[1], b = +m[2];
    const [day, mon] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    return new Date(Date.UTC(+m[3], mon - 1, day)).toISOString().slice(0, 10);
  }
  return null;
}

/** Number from a cell; percent strings -> fraction. Returns null if not numeric. */
function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = clean(v).replace(/,/g, "");
  if (!s || /^#|N\/A/i.test(s)) return null;
  const pct = /%$/.test(s);
  const n = Number(s.replace(/%$/, ""));
  if (!Number.isFinite(n)) return null;
  return pct ? n / 100 : n;
}

/** A vote share: accept 0..1, or 0..100 (converted). */
const share = (v) => {
  const n = num(v);
  if (n == null) return null;
  return Math.abs(n) > 1.5 ? n / 100 : n;
};

const windowOf = (...texts) => {
  for (const t of texts) {
    const m = String(t || "").match(/(\d+)\s*-?\s*D(?:ay)?\s*M(?:oving)?\s*A(?:vg|verage)?/i) ||
              String(t || "").match(/(\d+)\s*DMA/i);
    if (m) return `${m[1]}DMA`;
  }
  return "";
};

/* --------------------------------- MASTER --------------------------------- */

const PARTY_COLS = ["TDP", "YSRCP", "JSP", "BJP", "INC", "Others"];
const ALLIANCE_COLS = ["NDA", "YSRCP", "INDIA", "Others"];
const CM_COLS = ["CBN", "JMR", "PK", "LN", "Others"];

function isMasterHeader(row) {
  const h = (row || []).map((x) => oneLine(x).toLowerCase());
  return h.includes("date") && h.some((x) => /^ac\s*no/.test(x)) && h.some((x) => /^ac\s*name/.test(x));
}

function mapMasterColumns(header) {
  const h = header.map(oneLine);
  const col = {};
  let block = null;
  h.forEach((name, i) => {
    const n = name.toLowerCase();
    if (n === "date") col.date = i;
    else if (/^ac\s*no/.test(n)) col.acNo = i;
    else if (/^ac\s*name/.test(n)) col.acName = i;
    else if (/^pc\s*name/.test(n)) col.pc = i;
    else if (n === "zone") col.zone = i;
    else if (/ae\s*2024\s*winner/.test(n)) col.winner2024 = i;
    else if (/nda\s*contest/.test(n)) col.ndaContest = i;
    else if (n === "sample") col.sample = i;
    else if (name === "TDP" && block !== "party") { block = "party"; col["party.TDP"] = i; }
    else if (name === "NDA") { block = "alliance"; col["alliance.NDA"] = i; }
    else if (name === "CBN") { block = "cm"; col["cm.CBN"] = i; }
    else if (/margin$/i.test(name) && block) col[`${block}.margin`] = i;
    else if (/^leading$/i.test(name) && block) col[`${block}.leading`] = i;
    else if (/(score|rating|rank)$/i.test(name)) {
      const m = name.match(/^(.*?)\s+(score|rating|rank)$/i);
      const metric = m[1].replace(/\s+/g, " ").trim();
      col[`perf.${metric}.${m[2].toLowerCase()}`] = i;
      block = null;
    } else if (block === "party" && PARTY_COLS.includes(name)) col[`party.${name}`] = i;
    else if (block === "alliance" && ALLIANCE_COLS.includes(name)) col[`alliance.${name}`] = i;
    else if (block === "cm" && CM_COLS.includes(name)) col[`cm.${name}`] = i;
  });
  return col;
}

function parseMaster(grid) {
  const hi = grid.findIndex(isMasterHeader);
  if (hi < 0) return null;
  const col = mapMasterColumns(grid[hi]);
  const issues = [];
  const rows = [];
  const perfMetrics = [...new Set(Object.keys(col).filter((k) => k.startsWith("perf."))
    .map((k) => k.split(".")[1]))];

  for (let i = hi + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const date = toISODate(r[col.date]);
    const acNo = num(r[col.acNo]);
    if (!date || acNo == null) {
      if (r.some((x) => clean(x))) issues.push(`Row ${i + 1}: missing/invalid date or AC number - skipped.`);
      continue;
    }
    const pick = (prefix, names) => {
      const o = {};
      names.forEach((nm) => { const c = col[`${prefix}.${nm}`]; if (c != null) o[nm] = share(r[c]); });
      if (col[`${prefix}.margin`] != null) o.margin = share(r[col[`${prefix}.margin`]]);
      if (col[`${prefix}.leading`] != null) o.leading = clean(r[col[`${prefix}.leading`]]);
      return o;
    };
    const perf = {};
    perfMetrics.forEach((m) => {
      perf[m] = {
        score: num(r[col[`perf.${m}.score`]]),
        rating: clean(r[col[`perf.${m}.rating`]]),
        rank: num(r[col[`perf.${m}.rank`]]),
      };
    });
    rows.push({
      date, acNo: Math.round(acNo), acName: clean(r[col.acName]), pc: clean(r[col.pc]), zone: clean(r[col.zone]),
      winner2024: clean(r[col.winner2024]), ndaContest: clean(r[col.ndaContest]),
      sample: num(r[col.sample]),
      party: pick("party", PARTY_COLS), alliance: pick("alliance", ALLIANCE_COLS), cm: pick("cm", CM_COLS), perf,
    });
  }

  // duplicates (same date + AC) - keep the last one, report it
  const seen = new Map();
  rows.forEach((x, idx) => {
    const k = `${x.date}|${x.acNo}`;
    if (seen.has(k)) issues.push(`Duplicate row for AC ${x.acNo} on ${x.date} - the later row is used.`);
    seen.set(k, idx);
  });
  const unique = [...seen.values()].map((i) => rows[i]);
  return { rows: unique, perfMetrics, issues };
}

/* --------------------------------- REPORT --------------------------------- */

const reportKind = (tabName) => {
  const n = tabName.toLowerCase();
  if (/govt|government|rating/.test(n)) return "govt";
  if (/alliance/.test(n)) return "alliance";
  if (/party/.test(n)) return "party";
  if (/\bcm\b|chief|cm analysis/.test(n)) return "cm";
  return null;
};

const ENTITY_TYPE = (firstHeader) => {
  const t = oneLine(firstHeader).toLowerCase();
  if (/^overall/.test(t)) return "state";
  if (/voter|group/.test(t)) return "segment";
  if (/^zone/.test(t)) return "zone";
  if (/^pc|parliament/.test(t)) return "pc";
  if (/^ac|assembly/.test(t)) return "ac";
  return "other";
};

/**
 * Parse one report tab into entity series:
 *   { kind, window, entities: { key: { type, group, label, zone, series:[{date, sample, values, leading, margin, change}], baseline } } }
 */
function parseReport(grid, tabName) {
  const kind = reportKind(tabName);
  if (!kind) return null;
  const issues = [];
  const entities = {};
  let window = windowOf(tabName);

  let groupRow = null;   // row with "Current Survey ..." / baseline / change group labels
  let header = null;     // column -> label
  let ranges = null;     // { cur:[a,b], base:[a,b], chg:[a,b] }
  let etype = null;
  let curGroup = "";
  let curEntity = null;

  for (let i = 0; i < grid.length; i++) {
    const r = grid[i] || [];
    const cells = r.map((x, j) => [j, oneLine(x)]).filter(([, v]) => v);
    if (!cells.length) continue;

    // group-label row: "Current Survey [30DMA] | Survey 2024 | CBN Change"
    if (cells.some(([, v]) => /current\s*survey/i.test(v))) {
      groupRow = cells;
      window = window || windowOf(...cells.map(([, v]) => v));
      continue;
    }
    // header row: has "Sample" in it
    if (cells.some(([, v]) => /^sample$/i.test(v)) && !toISODate(r[0])) {
      header = {};
      r.forEach((x, j) => { const v = oneLine(x); if (v) header[j] = v; });
      etype = ENTITY_TYPE(cells[0][1]);
      const starts = (groupRow || []).map(([j, v]) => ({ j, v }));
      const cur = starts.find((s) => /current/i.test(s.v));
      const base = starts.find((s) => /survey\s*(20|may)|vote\s*share|ae\s*20|baseline|20\d\d/i.test(s.v) && !/current/i.test(s.v));
      const chg = starts.find((s) => /change/i.test(s.v));
      const maxCol = Math.max(...Object.keys(header).map(Number));
      const curStart = cur ? cur.j : 0;
      const baseStart = base ? base.j : maxCol + 1;
      const chgStart = chg ? chg.j : maxCol + 1;
      ranges = {
        cur: [curStart, Math.min(baseStart, chgStart) - 1],
        base: base ? [baseStart, chgStart - 1] : null,
        chg: chg ? [chgStart, maxCol] : null,
        baseLabel: base ? base.v : "",
      };
      curGroup = ""; curEntity = null;
      continue;
    }
    if (/^table\s*\d/i.test(cells[0][1])) continue;

    const date = toISODate(r[0]);
    if (!date || !header || !ranges) continue;

    // labels carry down: col B = group/entity, col C = sub-label
    const b = oneLine(r[1]);
    const c = oneLine(r[2]);
    if (etype === "segment") {
      if (b) curGroup = b;
      if (c || b) curEntity = `${curGroup}::${c || b}`;
    } else if (b) {
      curEntity = b;
    }
    if (!curEntity) continue;

    const key = `${etype}::${curEntity}`;
    if (!entities[key]) {
      const [g, l] = etype === "segment" ? curEntity.split("::") : ["", curEntity];
      entities[key] = { type: etype, group: g.replace(/\s+/g, " "), label: l, zone: etype === "pc" ? c : "", series: [], baseline: null };
    }
    const ent = entities[key];
    if (etype === "pc" && c && !ent.zone) ent.zone = c;

    const readBlock = ([a, z]) => {
      const out = { values: {} };
      for (let j = a; j <= z; j++) {
        const lab = header[j];
        if (!lab || j <= 2) continue;
        if (/^sample$/i.test(lab)) out.sample = num(r[j]);
        else if (/^leading$/i.test(lab)) out.leading = oneLine(r[j]);
        else if (/margin$/i.test(lab)) out.margin = share(r[j]);
        else { const v = share(r[j]); if (v != null) out.values[lab] = v; }
      }
      return out;
    };

    const cur = readBlock(ranges.cur);
    if (cur.sample == null && !Object.keys(cur.values).length) continue;
    const point = { date, sample: cur.sample, values: cur.values, leading: cur.leading || "", margin: cur.margin };
    if (ranges.chg) {
      const ch = readBlock(ranges.chg);
      point.change = ch.values; // e.g. { "Vote Share": .., "Margin": .. }
      if (ch.margin != null) point.change.Margin = ch.margin;
    }
    ent.series.push(point);

    if (ranges.base && !ent.baseline) {
      const bb = readBlock(ranges.base);
      if (Object.keys(bb.values).length) ent.baseline = { label: ranges.baseLabel, ...bb };
    }
  }

  // sort each series by real date, de-duplicate dates (keep last)
  Object.values(entities).forEach((e) => {
    const m = new Map();
    e.series.forEach((p) => m.set(p.date, p));
    e.series = [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  });
  return { kind, window, entities, issues };
}

/* ------------------------------ classification ---------------------------- */

/** Classify every tab of every spreadsheet and parse what is understood. */
function parseWorkbooks(books) {
  const masters = [];
  const reports = [];
  const skipped = [];
  for (const { sheetTitle, tabs } of books) {
    for (const [tab, grid] of Object.entries(tabs)) {
      const head = (grid || []).slice(0, 5);
      if (head.some(isMasterHeader)) {
        const m = parseMaster(grid);
        if (m && m.rows.length) { masters.push({ sheetTitle, tab, window: windowOf(tab, sheetTitle), ...m }); continue; }
      }
      const rep = parseReport(grid, tab);
      if (rep && Object.keys(rep.entities).length) { reports.push({ sheetTitle, tab, ...rep }); continue; }
      skipped.push(`${sheetTitle} / ${tab}`);
    }
  }
  return { masters, reports, skipped };
}

module.exports = { parseWorkbooks, parseMaster, parseReport, toISODate, num, share, windowOf };
