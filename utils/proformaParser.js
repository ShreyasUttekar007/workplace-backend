/**
 * AC Proforma ("AC Bible") parser.
 *
 * Turns the raw value grids of a Google Sheet (one grid per tab) into a
 * structured dossier the portal can present. Pure functions only - no network,
 * no database - so it can be tested against an exported workbook.
 *
 * The sheet is hand-maintained, so the parser is deliberately tolerant:
 *  - tabs are recognised by keywords in their names, not exact names
 *  - tables are found by detecting title rows, header rows and data rows
 *  - multi-row headers are merged; repeated header rows are dropped (and noted)
 *  - template rows (only a serial number or label filled in) are counted as
 *    "not filled" rather than shown as data
 *  - stray helper data far below a table (chart sources etc.) is ignored
 *  - election results, which are laid out sideways, get a dedicated parser
 * Anything it cannot classify is still shown as a plain table, never dropped.
 */

/* ----------------------------- basic helpers ----------------------------- */

const clean = (v) =>
  String(v == null ? "" : v)
    .replace(/[\u2060\u200B\u200C\u200D\uFEFF]/g, "")
    .replace(/\u00A0/g, " ")
    .replace(/\r/g, "")
    .trim();

const oneLine = (s) => clean(s).replace(/\s+/g, " ");
const isNumeric = (s) => /\d/.test(s) && /^[\d,.\s()%+\-/|]+$/.test(s);
const slug = (s) =>
  oneLine(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "col";

const HEADER_WORDS = new RegExp(
  "\\b(s\\.?\\s?no|sno|sr|name|caste|age|mobile|phone|contact|occupation|profession|designation|" +
  "status|type|details?|mandal|town|zone|parliament|assembly|village|ward|cluster|unit|booth|" +
  "location|remarks?|issues?|leaders?|number|percentage|inclination|parameters|project|timeline|" +
  "month|grading|feedback|impact|influence|activity|profile|assessment|demand|threat|gender|" +
  "votes?|voters|margin|channel|journalist|stringer|area|timings|footfall|photo|cost|investment|" +
  "snapshot|strategy|scenario|concerns?|actionables?|challenges|reservation|winner|party|year|" +
  "con|pc|ac|outreach|perception|coordination|management|intervention|conflict)\\b",
  "i"
);

const nonEmpty = (row) =>
  (row || []).map((v, i) => [i, clean(v)]).filter(([, v]) => v !== "");

const firstLine = (v) => oneLine(String(v).split("\n").find((x) => x.trim()) || "");

function isHeaderRow(cells) {
  if (cells.length < 2) return false;
  if (cells.some(([, v]) => firstLine(v).length > 70 || isNumeric(v) || /^https?:\/\//i.test(v))) return false;
  const hits = cells.filter(([, v]) => HEADER_WORDS.test(firstLine(v))).length;
  return hits >= Math.max(1, Math.ceil(cells.length * 0.3));
}

const isLong = (v) => v.length > 110 || /\n/.test(v);

/* ----------------------------- phone handling ---------------------------- */

const PHONE_LABEL = /mobile|phone|contact\s*no|whatsapp/i;
const looksLikePhone = (v) => {
  const d = String(v).replace(/[^\d]/g, "");
  return d.length >= 10 && d.length <= 13 && /^[+\d][\d\s\-()]+$/.test(String(v).trim());
};
const maskPhone = (v) => {
  const d = String(v).replace(/[^\d]/g, "");
  if (d.length < 6) return "•••";
  return `${d.slice(0, 2)}${"•".repeat(Math.max(d.length - 5, 3))}${d.slice(-3)}`;
};

/* ------------------------ column -> canonical field ---------------------- */

const CANON = [
  [/^s\.?\s?no\b|^sno\b|^sr\.?\b|^s\.\s*no/i, "sno"],
  [/name of the (leader|influencer)|^name\b|leader name|stringer name/i, "name"],
  [/caste category/i, "casteCategory"],
  [/caste/i, "caste"],
  [/^age\b/i, "age"],
  [/gender/i, "gender"],
  [PHONE_LABEL, "phone"],
  [/occupation|profession/i, "occupation"],
  [/inclination|^party\b/i, "party"],
  [/designation/i, "designation"],
  [/level of influence/i, "influence"],
  [/impact on no of votes|no of votes|votes he/i, "votes"],
  [/^status\b/i, "status"],
  [/recent activity/i, "activity"],
  [/^(ac|assembly( constituency)?)$/i, "skip"],
  [/profile|profle|profie|profil\b/i, "profile"],
  [/assessment/i, "assessment"],
  [/reason/i, "reason"],
  [/action[a-z]*ables?\b|actiomable|actionable/i, "actionable"],
  [/remarks?/i, "remarks"],
  [/mandal|town/i, "mandal"],
  [/village|ward/i, "village"],
];
const canonOf = (label) => {
  for (const [rx, key] of CANON) if (rx.test(label)) return key;
  return null;
};

/* ------------------------------ block parser ------------------------------ */

/**
 * Split a grid into blocks: { title, columns, rows, notes, items, template }.
 * `skip` is a Set of row indexes already consumed by a special parser.
 */
function parseBlocks(grid, skip = new Set()) {
  const blocks = [];
  let cur = null;
  let gap = 0;

  const newBlock = (title = "") => {
    cur = { title, columns: [], rows: [], notes: [], items: [], templateRows: 0, issues: [] };
    blocks.push(cur);
    return cur;
  };

  const nextCells = (from) => {
    for (let j = from; j < grid.length; j++) {
      if (skip.has(j)) continue;
      const c = nonEmpty(grid[j]);
      if (c.length) return c;
    }
    return null;
  };

  for (let i = 0; i < grid.length; i++) {
    if (skip.has(i)) continue;
    const cells = nonEmpty(grid[i]);
    if (!cells.length) { gap++; continue; }
    const afterGap = gap; gap = 0;

    // A long gap ends whatever we were building.
    if (afterGap >= 6 && cur) cur = null;

    if (cells.length === 1) {
      const [col, v] = cells[0];

      // Sub-header directly under a header (e.g. "MPTCs won- Panchayats won").
      if (cur && cur.columns.length && !cur.rows.length && !isNumeric(v)) {
        const target = cur.columns.find((c) => c.idx === col);
        if (target) { target.label = `${target.label} (${oneLine(v).slice(0, 60)})`; continue; }
      }

      // Title + body in one cell ("Political History ...\nThe Assembly ...").
      if (isLong(v)) {
        const lines = v.split("\n").map((s) => s.trim()).filter(Boolean);
        const head = lines[0] || "";
        if (lines.length > 1 && head.length <= 90) {
          (cur || newBlock()).notes.push({ title: oneLine(head), body: lines.slice(1).join("\n") });
        } else {
          (cur || newBlock()).notes.push({ title: "", body: v });
        }
        continue;
      }

      // A lone serial number / label under a header = an unfilled template row.
      if (cur && cur.columns.length && (isNumeric(v) || /^(unit|cluster|booth)\s*\d+$/i.test(v))) {
        cur.templateRows++;
        continue;
      }

      // Otherwise a section title (if short) or a list item.
      if (v.length <= 90 && !isNumeric(v) && col <= 1) {
        const nxt = nextCells(i + 1);
        if (!cur || cur.columns.length || cur.rows.length || cur.notes.length || cur.items.length ||
            (nxt && isHeaderRow(nxt))) {
          newBlock(oneLine(v));
          continue;
        }
      }
      (cur || newBlock()).items.push(oneLine(v));
      continue;
    }

    // Two cells: short label + long text = a titled note ("Opposition Overview").
    if (cells.length === 2 && cells[0][1].length <= 70 && isLong(cells[1][1]) && !isNumeric(cells[0][1]) &&
        !(cur && cur.columns.length && cur.columns.some((c) => c.idx === cells[1][0]) &&
          isNumeric(cells[0][1]))) {
      (cur || newBlock()).notes.push({ title: oneLine(cells[0][1]), body: cells[1][1] });
      continue;
    }

    const strongHeader = () => {
      const hits = cells.filter(([, v]) => HEADER_WORDS.test(firstLine(v))).length;
      return hits >= Math.max(2, Math.ceil(cells.length * 0.6)) && cells.every(([, v]) => firstLine(v).length <= 40);
    };
    if (isHeaderRow(cells) && (!(cur && cur.columns.length && cur.rows.length) || strongHeader())) {
      if (cur && cur.columns.length && !cur.rows.length) {
        // Second header row right after the first: merge or drop.
        const same = cells.filter(([idx, v]) => {
          const c = cur.columns.find((x) => x.idx === idx);
          return c && oneLine(c.label).toLowerCase() === oneLine(v).toLowerCase();
        }).length;
        if (same >= cells.length / 2) { continue; }
        cur.issues.push("A second header row was found and ignored - check that data columns line up.");
        continue;
      }
      if (!cur || cur.columns.length) newBlock(cur && !cur.columns.length ? cur.title : "");
      cur.columns = cells.map(([idx, label]) => ({
        idx, label: firstLine(label), key: slug(firstLine(label)), canon: canonOf(firstLine(label)),
      }));
      // de-duplicate keys
      const seen = {};
      cur.columns.forEach((c) => { seen[c.key] = (seen[c.key] || 0) + 1; if (seen[c.key] > 1) c.key += `_${seen[c.key]}`; });
      continue;
    }

    // Data row.
    if (!cur) newBlock();
    if (!cur.columns.length) {
      // Headerless rows: keep as list items ("1 | The lack of a proper ...").
      cur.items.push(cells.map(([, v]) => oneLine(v)).filter((v) => !/^\d+$/.test(v) || cells.length === 1).join(" — "));
      continue;
    }
    const row = {};
    let filled = 0;
    cur.columns.forEach((c) => {
      let v = clean((grid[i] || [])[c.idx]);
      if (/no\.?\s*of|number|total|count/i.test(c.label) && /^(1\/1\/1900|12\/31\/1899|1900-01-01.*|1899-12-3[01].*)$/.test(v)) {
        v = "1";
        cur.issues.push(`"${c.label}" is formatted as a date in the sheet; read as 1.`);
      } else if (/no\.?\s*of|total|mandal|ward|gps?\b/i.test(c.label) && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) {
        // e.g. "1/5" typed into a cell that Sheets turned into the date 1/5/2024 - keep what was typed
        v = v.split("/").slice(0, 2).join("/");
        cur.issues.push(`"${c.label}" is formatted as a date in the sheet; shown as ${v}.`);
      }
      if (v) { row[c.key] = v; filled++; }
    });
    const onlySerial = filled <= 1 && (row[cur.columns[0].key] || "").match(/^[\w\s.]{0,12}$/);
    if (onlySerial) { cur.templateRows++; continue; }
    // Formula residue from Sheets AI functions - never show it.
    Object.keys(row).forEach((k) => { if (/^=\w+\(/.test(row[k])) delete row[k]; });
    cur.rows.push(row);
  }

  // Drop untitled helper lists (stray chart-source columns), empty shells, and
  // untitled empty copies of a header that already appeared above.
  const sig = (b) => b.columns.map((c) => c.label.toLowerCase()).join("|");
  return blocks.filter((b, i) => {
    if (!b.title && !b.rows.length && !b.notes.length && b.columns.length &&
        blocks.slice(0, i).some((x) => {
          const have = new Set(x.columns.map((c) => c.label.toLowerCase()));
          return sig(x) === sig(b) || b.columns.every((c) => have.has(c.label.toLowerCase()));
        })) return false;
    if (b.columns.length || b.rows.length || b.notes.length) return true;
    if (!b.title && b.items.every((x) => x.length <= 25)) return false;
    return b.items.length > 0 || b.title;
  });
}

/* ---------------------- sideways election-result tables ------------------- */

const YEAR_ROW = /^((19|20)\d{2})(\s+by\s*election)?$/i;

function parseElections(grid) {
  const out = { Assembly: [], Parliament: [] };
  const used = new Set();
  let mode = null;
  let winCol = 5; // Kadapa layout; re-detected from each block's header row

  for (let i = 0; i < grid.length; i++) {
    const a = clean((grid[i] || [])[0]);
    if (/assembly\s+elections?/i.test(a)) { mode = "Assembly"; used.add(i); continue; }
    if (/general\s+elections?|parliament/i.test(a) && /retro|election/i.test(a)) { mode = "Parliament"; used.add(i); continue; }
    if (!mode) continue;

    // header rows of the election block (Election Year / Candidate / (AGE) / Votes)
    if (/^election year/i.test(a) || /candidate name|\(age|votes secured/i.test(nonEmpty(grid[i]).map(([, v]) => v).join(" "))) {
      const w = nonEmpty(grid[i]).find(([, v]) => /^winner/i.test(v) || /^margin/i.test(v));
      if (w) winCol = w[0];
      used.add(i); continue;
    }

    const m = a.match(YEAR_ROW);
    if (!m) {
      if (/key leaders|demographics|political history|major issues/i.test(a)) mode = null;
      continue;
    }

    const r0 = grid[i] || [], r1 = grid[i + 1] || [], r2 = grid[i + 2] || [], r3 = grid[i + 3] || [];
    const candidates = [];
    for (let c = 1; c < Math.min(winCol, 5); c++) {
      const party = clean(r0[c]);
      const name = clean(r1[c]);
      if (!party && !name) continue;
      const votesRaw = clean(r3[c]);
      const vm = votesRaw.replace(/,/g, "").match(/(\d+)/);
      const pm = votesRaw.match(/\(([\d.]+)\s*%?\)?/);
      candidates.push({
        party, name, ageGender: clean(r2[c]).replace(/\s*\|\s*/, " · "),
        votes: vm ? Number(vm[1]) : null,
        pct: pm ? Number(pm[1]) : null,
      });
    }
    const winner = clean(r0[winCol]);
    const marginRaw = clean(r1[winCol]).replace(/,/g, "").replace(/\.0+$/, "");
    let reason = "";
    let j = i + 4;
    for (; j < Math.min(grid.length, i + 7); j++) {
      const t = clean((grid[j] || [])[0]);
      if (/^reason/i.test(t)) {
        reason = t.replace(/^reason[^\n:]*[:\n]?\s*/i, "").trim();
        used.add(j);
        break;
      }
    }
    [i, i + 1, i + 2, i + 3].forEach((x) => used.add(x));

    // shares: use recorded % if present, else share of the votes listed
    const total = candidates.reduce((s, c) => s + (c.votes || 0), 0);
    candidates.forEach((c) => { c.shareOfListed = total && c.votes ? Math.round((c.votes / total) * 1000) / 10 : null; });

    out[mode].push({
      year: m[1], label: clean(r0[0]).replace(/\s+/g, " "), byElection: !!m[3],
      candidates, winner, margin: /^\d+$/.test(marginRaw) ? Number(marginRaw) : null, reason,
    });
  }
  return { elections: out, used };
}

/* ----------------------------- caste parsing ------------------------------ */

const partySplit = (s) => {
  const out = {};
  String(s || "").replace(/(YSRCP|TDP|JSP|BJP|INC|CONGRESS|OTHERS?)\s*[-:]?\s*(\d+(?:\.\d+)?)\s*%/gi,
    (_, p, n) => { out[p.toUpperCase().replace("CONGRESS", "INC")] = Number(n); return ""; });
  return out;
};
const countPct = (s) => {
  const t = String(s || "").trim();
  const bare = t.replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(bare)) {           // a lone number: small = percentage, large = voter count
    const v = Number(bare);
    return v <= 100 ? { count: null, pct: v } : { count: v, pct: null };
  }
  const n = t.replace(/,/g, "").match(/(\d{3,})/);
  const p = t.match(/([\d.]+)\s*%/);
  return { count: n ? Number(n[1]) : null, pct: p ? Number(p[1]) : null };
};

/* --------------------------- people normalisation -------------------------- */

function toPeople(block, phones, tabName) {
  return block.rows.map((row, idx) => {
    const p = { fields: {}, extra: [] };
    block.columns.forEach((c) => {
      const v = row[c.key];
      if (!v) return;
      if (c.canon === "phone" || (looksLikePhone(v) && /mobile|phone|contact/i.test(c.label))) {
        const ref = `ph${phones.size + 1}`;
        phones.set(ref, { number: v.replace(/\.0$/, ""), tab: tabName, name: "" });
        p.fields.phone = { masked: maskPhone(v), ref };
        return;
      }
      if (c.canon === "skip") return;
      if (c.canon && c.canon !== "sno" && !p.fields[c.canon]) p.fields[c.canon] = v;
      else if (c.canon !== "sno") p.extra.push({ label: c.label, value: v });
    });
    if (p.fields.phone) phones.get(p.fields.phone.ref).name = p.fields.name || "";
    p.id = `${slug(tabName)}-${idx}`;
    return p;
  }).filter((p) => p.fields.name || Object.keys(p.fields).length > 2);
}

/** Mask phone numbers inside a generic table, in place. */
function maskTable(block, phones, tabName) {
  const phoneCols = block.columns.filter((c) => c.canon === "phone" || PHONE_LABEL.test(c.label));
  if (!phoneCols.length) return;
  const nameCol = block.columns.find((c) => c.canon === "name");
  block.rows.forEach((row) => {
    phoneCols.forEach((c) => {
      const v = row[c.key];
      if (!v || !looksLikePhone(v)) return;
      const ref = `ph${phones.size + 1}`;
      phones.set(ref, { number: v, tab: tabName, name: nameCol ? row[nameCol.key] || "" : "" });
      row[c.key] = { masked: maskPhone(v), ref };
    });
  });
}

/* ---------------------------- tab classification --------------------------- */

const KINDS = [
  [/itinerary/i, "index", "hidden"],
  [/2024\s*analysis|post\s*election/i, "analysis", "profile"],
  [/mandal\s*town|mandaltown/i, "mandals", "profile"],
  [/caste\s*analysis/i, "caste", "caste"],
  [/neutral\s*influencer/i, "people", "leaders"],
  [/key\s*party|all\s*key/i, "people", "leaders"],
  [/top\s*ysrcp/i, "people", "leaders"],
  [/mandal\s*and\s*frontal|frontal/i, "people", "leaders"],
  [/cluster|unit|booths?\s*assess/i, "org", "organisation"],
  [/weak|focus\s*booth/i, "booths", "organisation"],
  [/political\s*conflict/i, "conflicts", "risk"],
  [/inactive|disgruntled/i, "people", "risk"],
  [/probable\s*joining/i, "people", "risk"],
  [/probable\s*defection/i, "people", "risk"],
  [/troublemaker/i, "people", "risk"],
  [/govt|government/i, "table", "governance"],
  [/infrastructure/i, "table", "governance"],
  [/hotspot/i, "table", "governance"],
  [/mla\s*feedback/i, "table", "governance"],
  [/stringer|media/i, "table", "media"],
];
const classify = (name) => {
  for (const [rx, kind, section] of KINDS) if (rx.test(name)) return { kind, section };
  return { kind: "table", section: "other" };
};

const prettyName = (name) => oneLine(name)
  .replace(/\bNomin$/i, "Nominated")
  .replace(/\bAssessmen$/i, "Assessment")
  .replace(/\bleaders\s+l$/i, "Leaders")
  .replace(/\s{2,}/g, " ");

/* --------------------------------- main ---------------------------------- */

/**
 * @param {Object<string, string[][]>} tabs  tab name -> value grid
 * @returns {{ dossier: object, phones: Map<string, {number,tab,name}> }}
 */
function parseProforma(tabs) {
  const phones = new Map();
  const sections = [];
  const completeness = [];
  let profile = null;
  let castes = [];
  let elections = { Assembly: [], Parliament: [] };
  let keyLeaders = null;
  let narratives = [];
  let demographics = null;

  for (const [rawName, grid] of Object.entries(tabs)) {
    const name = prettyName(rawName);
    const { kind, section } = classify(name);
    if (kind === "index") continue;

    let skip = new Set();
    if (kind === "analysis") {
      const r = parseElections(grid);
      elections = r.elections;
      skip = r.used;
    }

    const blocks = parseBlocks(grid, skip);
    const dataRows = blocks.reduce((s, b) => s + b.rows.length + b.notes.length + b.items.length, 0);
    const template = blocks.reduce((s, b) => s + b.templateRows, 0);
    completeness.push({
      tab: name, section, rows: dataRows, templateRows: template,
      status: dataRows === 0 ? "empty" : template > dataRows ? "partial" : "filled",
      issues: blocks.flatMap((b) => b.issues),
    });

    if (kind === "analysis") {
      blocks.forEach((b) => {
        const labels = b.columns.map((c) => c.label.toLowerCase()).join("|");
        if (/zone/.test(labels) && /mla/.test(labels) && b.rows[0]) {
          profile = {};
          b.columns.forEach((c) => { if (b.rows[0][c.key]) profile[c.label] = b.rows[0][c.key]; });
        } else if (/caste/.test(labels) && /inclin/.test(labels)) {
          const cName = b.columns[0], cPct = b.columns[1];
          const cTrad = b.columns.find((c) => /trad/i.test(c.label));
          const cCur = b.columns.find((c) => /current/i.test(c.label));
          const cLead = b.columns.find((c) => /leader/i.test(c.label));
          castes = b.rows.map((r) => ({
            caste: r[cName.key], ...countPct(r[cPct.key]),
            traditional: partySplit(cTrad && r[cTrad.key]),
            current: partySplit(cCur && r[cCur.key]),
            leaders: cLead ? r[cLead.key] || "" : "",
          })).filter((c) => c.caste);
        } else if (/key leaders/i.test(b.title) || (/name/.test(labels) && /party/.test(labels))) {
          keyLeaders = { title: b.title || "Key Leaders in the AC", people: toPeople(b, phones, name) };
        } else if (/demograph/i.test(b.title) || /total votes in mandal/.test(labels)) {
          demographics = b;
        }
        b.notes.forEach((n) => {
          let t = String(n.title || "").replace(/^["'“”\s]+|["'“”\s]+$/g, "");
          if (/(winning|loosing|losing)/i.test(t)) t = "Reason for winning / losing the election";
          narratives.push({ ...n, title: t });
        });
        if (b.items.length && b.title) narratives.push({ title: b.title, items: b.items });
      });
      continue;
    }

    if (kind === "caste") {
      blocks.forEach((b) => {
        const nc0 = b.columns.find((c) => /^number/i.test(c.label));
        const pc0 = b.columns.find((c) => /^percent/i.test(c.label));
        if (!nc0 || !pc0) return;
        const nums = (key) => b.rows.map((r) => Number(String(r[key] || "").replace(/[,%\s]/g, ""))).filter((v) => Number.isFinite(v) && v > 0);
        const med = (a) => { const x = [...a].sort((p, q) => p - q); return x.length ? x[Math.floor(x.length / 2)] : null; };
        const mN = med(nums(nc0.key)); const mP = med(nums(pc0.key));
        if (mN != null && mP != null && mN <= 100 && mP > 100) {
          b.rows.forEach((r) => { const t = r[nc0.key]; r[nc0.key] = r[pc0.key]; r[pc0.key] = t; });
          b.issues.push("The Number and Percentage columns are swapped in the sheet; they have been read the right way round.");
        }
      });
      blocks.forEach((b) => {
        // Percentages may be entered as fractions (0.2957), as percents (29.57), or - in the
        // same sheet - a mix of both. Decide each row from its voter count where possible.
        const pc = b.columns.find((c) => /^percent/i.test(c.label));
        const nc = b.columns.find((c) => /^number/i.test(c.label));
        if (pc) {
          const val = (r) => { const t = String(r[pc.key] == null ? "" : r[pc.key]).trim(); if (!t) return null; const v = Number(t.replace(/[%\s,]/g, "")); return Number.isFinite(v) ? v : null; };
          const cnt = (r) => { if (!nc) return null; const v = Number(String(r[nc.key] || "").replace(/[,\s]/g, "")); return Number.isFinite(v) && v > 0 ? v : null; };
          // ratio = count / value. Rows entered as fractions all imply the electorate (count / 0.2957);
          // rows entered as percents imply a value 100x smaller. Cluster on the largest ratio.
          const withBoth = b.rows.filter((r) => val(r) != null && val(r) > 0 && cnt(r));
          const ratio = (r) => cnt(r) / val(r);
          const rmax = withBoth.length ? Math.max(...withBoth.map(ratio)) : null;
          const top = withBoth.filter((r) => ratio(r) >= rmax / 10);
          // a fraction can never exceed 1, so a top cluster containing any value > 1 is in percents
          const topAreFractions = top.length > 0 && top.every((r) => val(r) <= 1);
          const allSmall = b.rows.filter((r) => val(r) != null).every((r) => val(r) <= 1);
          const mixed = [];
          b.rows.forEach((r) => {
            const v = val(r); if (v == null) return;
            let isFraction;
            if (withBoth.length >= 2 && cnt(r)) isFraction = topAreFractions && ratio(r) >= rmax / 10;
            else isFraction = allSmall && v <= 1;         // no counts to go on: only if every value looks like a fraction
            if (isFraction) r[pc.key] = String(Math.round(v * 1000) / 10);
            else if (topAreFractions) mixed.push(r);
          });
          if (mixed.length) {
            const nameCol = b.columns.find((c) => /caste\s*name/i.test(c.label)) || b.columns[1];
            b.issues.push(`Percentage format differs for ${mixed.map((r) => r[nameCol.key]).join(", ")} (entered as a percent, others as fractions) — read correctly from the voter count.`);
          }
        }
      });
      blocks.forEach((b) => {
        const num = b.columns.find((c) => /^number/i.test(c.label));
        const pct = b.columns.find((c) => /^percent/i.test(c.label));
        if (!num || !pct) return;
        const after = b.columns.slice(b.columns.indexOf(num));
        b.rows.forEach((r) => {
          if (/%/.test(r[num.key] || "") && /YSRCP|TDP/i.test(r[pct.key] || "")) {
            const { count, pct: p } = countPct(r[num.key]);
            const vals = after.map((c) => r[c.key]);
            after.forEach((c, k) => { r[c.key] = k === 0 ? String(count || "") : k === 1 ? String(p || "") : vals[k - 1]; });
            b.issues.push(`Row "${r[b.columns[1].key]}" was one column out of line and has been realigned.`);
          }
        });
      });
    }

    if (kind === "mandals") {
      const CODE = { S: "Strong", F: "Favourable", B: "Battleground", D: "Difficult" };
      blocks.forEach((b) => {
        const sc = b.columns.find((c) => /status/i.test(c.label));
        if (sc) b.rows.forEach((r) => { const v = String(r[sc.key] || "").trim().toUpperCase(); if (CODE[v]) r[sc.key] = CODE[v]; });
      });
    }

    const out = { tab: name, kind, section, blocks: [] };
    blocks.forEach((b) => {
      const blk = { title: b.title, notes: b.notes, items: b.items, templateRows: b.templateRows, issues: b.issues };
      if (kind === "people" || (kind === "org" && b.columns.some((c) => c.canon === "name"))) {
        blk.people = toPeople(b, phones, name);
        blk.columns = b.columns.map(({ label, key, canon }) => ({ label, key, canon }));
      } else {
        maskTable(b, phones, name);
        blk.columns = b.columns.map(({ label, key, canon }) => ({ label, key, canon }));
        blk.rows = b.rows;
      }
      out.blocks.push(blk);
    });
    sections.push(out);
  }

  // ---- headline KPIs, computed from the real data ----
  const find = (rx) => sections.find((s) => rx.test(s.tab));
  const countPeople = (rx) => {
    const s = find(rx);
    return s ? s.blocks.reduce((n, b) => n + (b.people ? b.people.length : (b.rows || []).length), 0) : 0;
  };
  const mandalSec = find(/mandal\s*town|mandaltown/i);
  const mandalRow = mandalSec && mandalSec.blocks[0] && mandalSec.blocks[0].rows[0];
  const pick = (row, rx) => {
    if (!row) return "";
    const blk = mandalSec.blocks[0];
    const c = blk.columns.find((x) => rx.test(x.label));
    return c ? row[c.key] || "" : "";
  };
  const conflictsSec = find(/political\s*conflict/i);
  const openConflicts = conflictsSec ? conflictsSec.blocks.reduce((n, b) =>
    n + (b.rows || []).filter((r) => !/resolved/i.test(JSON.stringify(r)) || /not\s*resolved/i.test(JSON.stringify(r))).length, 0) : 0;
  const latestAssembly = [...elections.Assembly].sort((a, b) => b.year - a.year)[0];

  const mandalRows = (mandalSec && mandalSec.blocks[0] && mandalSec.blocks[0].rows) || [];
  const numOf = (v) => { const n = Number(String(v || "").replace(/[,\s]/g, "")); return Number.isFinite(n) && n > 0 ? n : null; };
  const voterSum = mandalRows.length > 1 ? mandalRows.reduce((t, r) => t + (numOf(pick(r, /total voters/i)) || 0), 0) : 0;
  const statuses = mandalRows.map((r) => pick(r, /status/i)).filter(Boolean);
  const statusSummary = new Set(statuses).size <= 1 ? (statuses[0] || "")
    : Object.entries(statuses.reduce((m, x) => ({ ...m, [x]: (m[x] || 0) + 1 }), {})).map(([k, n]) => `${n} ${k}`).join(" · ");

  const kpis = {
    totalVoters: (voterSum ? voterSum.toLocaleString("en-IN") : "") || pick(mandalRow, /total voters/i) ||
      (demographics && demographics.rows[0] ? Object.values(demographics.rows[0])[1] : ""),
    margin2024: latestAssembly && latestAssembly.margin ? latestAssembly.margin : pick(mandalRow, /margin/i),
    winner2024: latestAssembly ? latestAssembly.winner : "",
    mandalStatus: statusSummary || pick(mandalRow, /status/i),
    weakBooths: countPeople(/weak|focus\s*booth/i),
    openConflicts,
    disgruntled: countPeople(/inactive|disgruntled/i),
    probableJoinings: countPeople(/probable\s*joining/i),
    troublemakers: countPeople(/troublemaker/i),
    govtIssues: countPeople(/govt|government/i),
  };

  // --- Fallbacks for ACs whose "2024 Analysis" tab is not filled in yet ---
  if (!profile) {
    // Zone / Parliament / Assembly are repeated on every row of tables like the weak-booth list.
    for (const s2 of sections) {
      for (const b of s2.blocks) {
        const zc = (b.columns || []).find((c) => /^zone$/i.test(c.label));
        const pcc = (b.columns || []).find((c) => /^parliament/i.test(c.label));
        const rows = b.rows || [];
        if (zc && pcc && rows[0] && rows[0][zc.key]) {
          profile = { Zone: rows[0][zc.key], "Parliament Constituency": rows[0][pcc.key] };
          const ac = (b.columns || []).find((c) => /^assembly/i.test(c.label));
          if (ac && rows[0][ac.key]) profile["Assembly Constituency"] = rows[0][ac.key];
          break;
        }
      }
      if (profile) break;
    }
    if (profile && mandalRows.length) profile["No Of Mandals/Towns"] = String(mandalRows.length);
    if (profile) profile._source = "derived";
  }
  if (!castes.length) {
    const cs = sections.find((x) => x.kind === "caste");
    const cb = cs && cs.blocks.find((b) => b.rows && b.rows.length);
    if (cb) {
      const col = (rx) => cb.columns.find((c) => rx.test(c.label));
      const cName = col(/caste\s*name/i); const cNum = col(/^number/i); const cPct = col(/^percent/i);
      const cTrad = col(/trad/i); const cCur = col(/current/i); const cLead = col(/leader/i);
      castes = cb.rows.map((r) => ({
        caste: cName ? r[cName.key] : "",
        count: cNum ? numOf(r[cNum.key]) : null,
        pct: cPct && r[cPct.key] !== undefined && r[cPct.key] !== "" ? Number(r[cPct.key]) : null,
        traditional: partySplit(cTrad && r[cTrad.key]),
        current: partySplit(cCur && r[cCur.key]),
        leaders: cLead ? r[cLead.key] || "" : "",
      })).filter((c) => c.caste);
    }
  }
  if (profile && profile._source) delete profile._source;

  return {
    dossier: {
      profile, kpis, castes, elections, keyLeaders, demographics: demographics
        ? { columns: demographics.columns.map(({ label, key }) => ({ label, key })), rows: demographics.rows } : null,
      narratives, sections, completeness,
    },
    phones,
  };
}

module.exports = { parseProforma, parseBlocks, parseElections, partySplit, countPct, maskPhone, classify };
