/**
 * Punjab AC Proformas - sheet parser.
 *
 * One Google Sheet holds every AC. Tabs are recognised by their HEADER ROW
 * (not by tab name), so renaming or reordering tabs is harmless:
 *
 *   assessment  - "Halka Incharge" + "Winnability" / "Cadre Support"   (one row per AC)
 *   disputes    - "Dispute" column                                      (one row per AC)
 *   issues      - "Issue Summary"                                       (numbered list per row)
 *   demands     - "Demand Summary"                                      (numbered list, or one demand per row)
 *   joinees     - "Joining Probability" / "Joinee"                      (one row per person)
 *   any other tab with an "AC Name" / "AC No" column is attached to its AC as an extra table.
 *
 * ACs are keyed by AC number. Rows that only carry a name are matched loosely
 * ("Rajasansi" = "Raja Sansi", "Fatehgarh Sahib, Sirhind" -> Fatehgarh Sahib)
 * against the 117-AC reference list. Phone numbers are masked; the full number
 * stays on the server in `phones` (ref -> { number, name, tab, ac }).
 */

const clean = (v) => String(v == null ? "" : v).replace(/[​⁠﻿]/g, "").replace(/ /g, " ").replace(/\r/g, "").trim();
const oneLine = (v) => clean(v).replace(/\s+/g, " ");
const nameKey = (v) => oneLine(v).toLowerCase().replace(/\(\s*sc\s*\)?/g, "").replace(/[^a-z]/g, "");
const num = (v) => { const n = Number(String(v == null ? "" : v).replace(/,/g, "").trim()); return Number.isFinite(n) && String(v).trim() !== "" ? n : null; };

/* ------------------------------ reference ACs ------------------------------ */

const DISTRICT_REGION = {
  amritsar: "Majha", gurdaspur: "Majha", pathankot: "Majha", tarntaran: "Majha",
  jalandhar: "Doaba", kapurthala: "Doaba", hoshiarpur: "Doaba", sbsnagar: "Doaba", nawanshahr: "Doaba", shahidbhagatsinghnagar: "Doaba",
};
const regionOfDistrict = (d) => DISTRICT_REGION[nameKey(d)] || (d ? "Malwa" : "");

function makeResolver(refAcs) {
  const byNo = new Map(refAcs.map((a) => [a.no, a]));
  const byKey = new Map(refAcs.map((a) => [nameKey(a.name), a.no]));
  const resolve = (no, name) => {
    const n = num(no);
    if (n && byNo.has(Math.round(n))) return Math.round(n);
    const k = nameKey(name);
    if (!k) return null;
    if (byKey.has(k)) return byKey.get(k);
    for (const part of oneLine(name).split(/[,/&]| and /i)) {                 // "Fatehgarh Sahib, Sirhind"
      const pk = nameKey(part);
      if (pk && byKey.has(pk)) return byKey.get(pk);
    }
    for (const [rk, rn] of byKey) if (k.length >= 5 && (rk.startsWith(k) || k.startsWith(rk))) return rn;
    return null;
  };
  return { byNo, resolve };
}

/* --------------------------------- phones --------------------------------- */

const PHONE_RX = /(?:\+?91[\s-]?)?(?<![\d])[6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4}(?![\d])/g;
function makePhoneBook() {
  const phones = new Map();
  let seq = 0;
  /** Replace every phone number in `text` with a masked form; returns { text, refs }. */
  const mask = (text, ctx) => {
    const refs = [];
    const out = clean(text).replace(PHONE_RX, (m) => {
      const digits = m.replace(/\D/g, "").slice(-10);
      const ref = `p${++seq}`;
      const masked = `${digits.slice(0, 2)}XXXXXX${digits.slice(-2)}`;
      phones.set(ref, { number: `+91-${digits}`, name: ctx.name || "", tab: ctx.tab || "", ac: ctx.ac || "" });
      refs.push({ ref, masked });
      return masked;
    });
    return { text: out, refs };
  };
  return { phones, mask };
}

/* ------------------------------- tab parsing ------------------------------- */

/** Find the header row (first of the top 8 rows that names an AC column) and map columns by matcher. */
function header(grid) {
  for (let i = 0; i < Math.min(8, grid.length); i++) {
    const h = (grid[i] || []).map((x) => oneLine(x).toLowerCase());
    if (h.some((x) => /^ac\s*name|^assembly|^constituency/.test(x)) || h.some((x) => /^ac\s*no/.test(x))) return { at: i, h };
  }
  return null;
}
const col = (h, rx) => h.findIndex((x) => rx.test(x));

function kindOf(h) {
  const j = h.join(" | ");
  if (/halka\s*in-?charge/.test(j) && /(winnab|cadre\s*support|candidate\s*assess)/.test(j)) return "assessment";
  if (/disput/.test(j)) return "disputes";
  if (/issue\s*summary|major\s*issue/.test(j)) return "issues";
  if (/demand\s*summary|major\s*demand/.test(j)) return "demands";
  if (/joining\s*prob|joinee/.test(j)) return "joinees";
  return "other";
}

/* ------------------------------ normalisation ------------------------------ */

const NORM = {
  cadre: [[/strong/i, "Strong"], [/moder|average|medium/i, "Moderate"], [/weak|poor|low/i, "Weak"]],
  candidate: [[/retain|continue/i, "Retain"], [/activ/i, "Need to Activate"], [/change|replace/i, "Need to Change"]],
  financial: [[/good|strong|sound/i, "Good"], [/aver|moder|medium/i, "Average"], [/poor|weak|low/i, "Poor"]],
  cooperation: [[/not\s*(at\s*all)?|non|un-?coop/i, "Not Cooperative"], [/very|highly|fully/i, "Very Cooperative"], [/mod|medr|partial|some/i, "Moderately Cooperative"]],
  winnability: [[/high|strong/i, "High"], [/med|moder|average/i, "Medium"], [/low|weak|poor/i, "Low"]],
};
const normRating = (kind, v) => {
  const t = oneLine(v);
  if (!t) return "";
  const hit = NORM[kind].find(([rx]) => rx.test(t));
  return hit ? hit[1] : t;
};

/** Points used by the readiness score (0-100) for each rating. */
const POINTS = {
  winnability: { High: 100, Medium: 60, Low: 20 },
  cadre: { Strong: 100, Moderate: 60, Weak: 20 },
  candidate: { Retain: 100, "Need to Activate": 55, "Need to Change": 10 },
  financial: { Good: 100, Average: 60, Poor: 20 },
  cooperation: { "Very Cooperative": 100, "Moderately Cooperative": 60, "Not Cooperative": 10 },
};
const WEIGHTS = { winnability: 30, cadre: 20, candidate: 20, financial: 10, cooperation: 10, attendance: 10 };
const DISPUTE_PENALTY = 8;
const BANDS = [[75, "Strong"], [60, "Steady"], [45, "Watch"], [0, "Weak"]];

function attendance(v) {
  const m = oneLine(v).match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const present = Number(m[1]); const total = Number(m[2]);
    if (total > 0) return { text: `${present}/${total}`, present, total, pct: Math.round(Math.min(present / total, 1) * 100) };
  }
  const p = oneLine(v).match(/(\d+(?:\.\d+)?)\s*%/);
  if (p) return { text: `${p[1]}%`, present: null, total: null, pct: Math.round(Number(p[1])) };
  return oneLine(v) ? { text: oneLine(v), present: null, total: null, pct: null } : null;
}

function readiness(a, hasDispute) {
  let got = 0; let w = 0;
  const parts = [];
  Object.keys(WEIGHTS).forEach((k) => {
    let pts = null;
    if (k === "attendance") pts = a.attendance && a.attendance.pct != null && a.attendance.total >= 5 ? a.attendance.pct : null;
    else pts = POINTS[k][a[k]] != null ? POINTS[k][a[k]] : null;
    if (pts == null) return;
    got += pts * WEIGHTS[k]; w += WEIGHTS[k];
    parts.push({ key: k, points: pts, weight: WEIGHTS[k] });
  });
  if (!w) return null;
  const raw = got / w;
  const score = Math.max(0, Math.round(raw - (hasDispute ? DISPUTE_PENALTY : 0)));
  return { score, band: BANDS.find(([min]) => score >= min)[1], parts, coverage: Math.round((w / 100) * 100), disputePenalty: hasDispute ? DISPUTE_PENALTY : 0 };
}

/* ------------------------------- free text ------------------------------- */

/** "1. A\n2. B" / "1) A 2)B" / bullet lines -> ["A","B"]. */
function splitNumbered(text) {
  const t = clean(text);
  if (!t) return [];
  const parts = t.split(/(?:^|\n|\s)(?=\d{1,2}\s*[.)]\s*\S)/).map((x) => x.replace(/^\d{1,2}\s*[.)]\s*/, "").trim()).filter(Boolean);
  if (parts.length > 1) return parts;
  const lines = t.split(/\n+/).map((x) => x.replace(/^[-•*●▪]\s*/, "").trim()).filter(Boolean);
  return lines.length > 1 && lines.every((l) => l.length < 260) ? lines : [t];
}
const tidyTitle = (s) => oneLine(s).replace(/^["'“”\s]+|["'“”\s]+$/g, "").replace(/[:.\-–]+$/, "").trim();
const isJunk = (s) => !/[a-z0-9]{2}/i.test(String(s || ""));
/** Numbered items only ("1. a 2. b"); anything else stays one block. */
function splitNumberedStrict(text) {
  const t = clean(text);
  if (!t) return [];
  const parts = t.split(/(?:^|\n|\s)(?=\d{1,2}\s*[.)]\s*\S)/).map((x) => x.replace(/^\d{1,2}\s*[.)]\s*/, "").trim()).filter(Boolean);
  return parts.length > 1 && /^\s*1\s*[.)]/.test(t) ? parts : [t];
}

/* Issue / demand themes - plain keyword buckets, shown with their counts. */
const THEMES = [
  ["Drugs & crime", /\b(drugs?|narcotics?|chitta|substance|addict\w*|de-addiction|smuggl\w*|crimes?|criminal|theft|thefts|robber\w*|snatch\w*|gangsters?|extortion|police|law\s*(?:&|and)\s*order|cctv|surveillance|illegal liquor)\b/i],
  ["Health", /\b(health\w*|hospitals?|doctors?|medical|medicines?|dispensar\w*|cardiac|heart|cancer|clinics?|ambulance|phc|chc|nurses?|treatment)\b/i],
  ["Roads & transport", /\b(roads?|bridges?|traffic|railway|crossings?|bus|buses|transport|flyover|highways?|potholes?|street\s*lights?|connectivity|bypass|infrastructure)\b/i],
  ["Water & sanitation", /\b(water\w*|drain\w*|sewer\w*|sewage|sanitation|floods?|flooding|canals?|storm\w*|garbage|waste|ponds?|groundwater)\b/i],
  ["Education", /\b(schools?|colleges?|universit\w*|education\w*|teachers?|students?|girls'? college|higher-education|literacy|coaching|libraries|library|degree college)\b/i],
  ["Jobs & industry", /\b(jobs?|employment|unemploy\w*|industr\w*|factor(?:y|ies)|skills?|businesse?s?|traders?|trade|migration|youth|it city)\b/i],
  ["Agriculture", /\b(farm\w*|crops?|paddy|wheat|mandis?|procurement|fertili[sz]ers?|dap|urea|agricultur\w*|motor connections?|irrigation|stubble|msp|kisan|tubewells?|grain|agrarian|distributory)\b/i],
  ["Women & welfare", /\b(wom[ae]n'?s?|girls?'?|anganwadi|pensions?|nutrition|ration|welfare|dharamshala|inflation|prices?|widows?|elderly|disabled|shagun|schemes?|housing|plots?|marla|sewa kendras?)\b/i],
  ["Governance & corruption", /\b(corrupt\w*|bribe\w*|irregularit\w*|transparency|gmada|registry|registration|land records?|patwari|tehsil|bureaucra\w*|administration|officials?|encroach\w*|district|sub-?tehsil|land rights|status)\b/i],
  ["Mining & environment", /\b(mining|sand|gravel|dumpers?|pollut\w*|environment\w*|trees?|forests?|erosion)\b/i],
  ["Civic amenities", /\b(parking|community cent(?:re|er)s?|stadiums?|parks?|sports|playgrounds?|gyms?|religious|gurdwaras?|temples?|cremation|graveyard|kabristan|markets?|holy city)\b/i],
  ["Power", /\b(electricity|power\s*(?:supply|cuts?|grid)|transformers?|bijli|power)\b/i],
];
const matchThemes = (t) => THEMES.filter(([, rx]) => rx.test(t)).map(([n]) => n);
/** Classify on the title first; fall back to the brief only when the title matches nothing. */
const themesOf = (title, brief) => {
  const a = matchThemes(String(title || ""));
  if (a.length) return a;
  const b = matchThemes(String(brief || ""));
  return b.length ? b.slice(0, 2) : ["Other"];
};

const CASTE_RX = /sikh|jatt|jat\b|\bsc\b|brahmin|mazhabi|saini|hindu|dalit|ramdasia|ravidas|kamboj|\bobc\b|\bbc\b|valmiki|khatri|arora|labana|bania|muslim|christian|rajput|ghumiar|kumhar|tarkhan|ramgarhia|baniya|aggarwal|mahajan/i;

/** "Name | 50 Years | Jatt Sikh | Halka In-charge" (also "Name\n(48| Jatt Sikh| District President)"). */
function parsePerson(raw) {
  let t = clean(raw).replace(/^\d{1,2}\s*[.)]\s*/, "").replace(/\n+/g, " ").trim();
  if (!t) return null;
  // "Name (48| caste | designation)" -> pipes inside parentheses
  const pm = t.match(/^(.*?)\(([^)]*\|[^)]*)\)\s*$/);
  if (pm) t = `${pm[1].trim()} | ${pm[2]}`;
  const bits = t.split("|").map((x) => x.trim()).filter(Boolean);
  const p = { name: "", age: "", caste: "", designation: "" };
  if (bits.length <= 1) {
    const dm = t.match(/^(.*?)\s*\((.+)\)\s*$/);
    if (dm) { p.name = dm[1].trim(); p.designation = dm[2].trim(); } else p.name = t;
    return p;
  }
  p.name = bits.shift();
  const rest = [];
  bits.forEach((b) => {
    const a = b.match(/^(\d{2})(?:\s*(?:years?|yrs?))?$/i);
    if (a && !p.age) p.age = a[1];
    else if (!p.caste && CASTE_RX.test(b) && b.length < 40) p.caste = b;
    else rest.push(b);
  });
  p.designation = rest.join(" · ");
  return p;
}

/** Leaders column -> { sides: [[person]], text }. Sides split on "v/s" / "vs". */
function parseLeaders(text) {
  const t = clean(text);
  if (!t) return { sides: [], text: "" };
  const sides = t.split(/\n\s*v\s*\/?\s*s\.?\s*\n|\bv\/s\b|\s+vs\.?\s+/i).map((s) => s.trim()).filter(Boolean);
  return {
    text: t,
    sides: sides.map((s) => s.split(/\n\s*\n|\n(?=\s*\d{1,2}\s*[.)])/).map(parsePerson).filter((p) => p && p.name)),
  };
}

/* --------------------------------- parse ---------------------------------- */

/**
 * tabs: { [tabTitle]: string[][] }   refAcs: [{ no, name, district, pc }]
 * returns { acs: { [no]: dossier }, state, phones, tabs: [{ title, kind, rows }], issues: [] }
 */
function parsePunjabProformas(tabs, refAcs) {
  const { byNo, resolve } = makeResolver(refAcs);
  const { phones, mask } = makePhoneBook();
  const acs = {};
  const issuesLog = [];
  const tabInfo = [];
  const unmatched = [];

  const ensure = (no) => {
    if (!acs[no]) {
      const r = byNo.get(no) || {};
      acs[no] = {
        no, name: r.name || `AC ${no}`, district: r.district || "", pc: r.pc || "", region: "",
        reserved: /\(sc\)/i.test(r.name || ""), tracked: false, category: "", priority: "",
        assessment: null, disputes: [], issues: [], demands: [], joinees: [], other: [],
      };
    }
    return acs[no];
  };

  Object.entries(tabs || {}).forEach(([title, grid]) => {
    const hd = header(grid || []);
    if (!hd) { tabInfo.push({ title, kind: "skipped", rows: 0, note: "No AC Name / AC No column found." }); return; }
    const { at, h } = hd;
    const kind = kindOf(h);
    const cNo = col(h, /^ac\s*no|^ac\s*number/);
    const cName = col(h, /^ac\s*name|^assembly|^constituency/);
    const cDist = col(h, /^district/);
    const cRegion = col(h, /^region|^zone/);
    let used = 0;
    const rowsOut = [];

    for (let i = at + 1; i < grid.length; i++) {
      const r = (grid[i] || []).map(clean);
      if (!r.some(Boolean)) continue;
      const rawName = cName >= 0 ? r[cName] : "";
      const no = resolve(cNo >= 0 ? r[cNo] : "", rawName);
      if (!no) { if (rawName || (cNo >= 0 && r[cNo])) unmatched.push(`${title}: "${rawName || r[cNo]}"`); continue; }
      const a = ensure(no);
      if (cDist >= 0 && r[cDist] && !a.sheetDistrict) a.sheetDistrict = oneLine(r[cDist]);
      if (cRegion >= 0 && r[cRegion] && !a.region) a.region = oneLine(r[cRegion]);
      const ctx = { tab: title, ac: String(no) };
      used++;

      if (kind === "assessment") {
        const g = (rx) => { const c = col(h, rx); return c >= 0 ? r[c] : ""; };
        a.tracked = true;
        a.category = oneLine(g(/^category/));
        a.priority = oneLine(g(/^priority/));
        if (oneLine(g(/^ac\s*name/))) a.sheetName = oneLine(g(/^ac\s*name/));
        const incharge = oneLine(g(/^halka\s*in-?charge(\s*name)?$/));
        const cadreRemark = mask(g(/cadre.*(remark|reason)/), { ...ctx, name: incharge });
        const candRemark = mask(g(/candidate.*(remark|reason)/), { ...ctx, name: incharge });
        a.assessment = {
          incharge,
          cadre: normRating("cadre", g(/^cadre\s*support$/)), cadreRemark: cadreRemark.text,
          candidate: normRating("candidate", g(/^candidate\s*assessment$/)), candidateRemark: candRemark.text,
          financial: normRating("financial", g(/^financial/)),
          cooperation: normRating("cooperation", g(/^cooperat/)),
          winnability: normRating("winnability", g(/^winnab/)),
          attendance: attendance(g(/attendance/)),
          phoneRefs: [...cadreRemark.refs, ...candRemark.refs],
        };
      } else if (kind === "disputes") {
        const leaders = parseLeaders(g2(h, r, /^leader/));
        const desc = mask(g2(h, r, /disput|descrip/), ctx);
        const act = mask(g2(h, r, /actionable|action/), ctx);
        if (leaders.text || desc.text || act.text) {
          a.disputes.push({ acLabel: rawName, leaders, description: desc.text, actionable: act.text, phoneRefs: [...desc.refs, ...act.refs] });
        }
      } else if (kind === "issues" || kind === "demands") {
        const sumC = col(h, kind === "issues" ? /issue\s*summary|^issues?$/ : /demand\s*summary|^demands?$/);
        const briefC = col(h, /^brief|detail|descrip/);
        const sum = splitNumbered(sumC >= 0 ? r[sumC] : "").map(tidyTitle).filter((x) => !isJunk(x));
        const briefRaw = briefC >= 0 ? r[briefC] : "";
        const briefs = splitNumberedStrict(briefRaw);
        const push = (title, brief, shared) => {
          const b = mask(brief || "", ctx);
          const tt = title || (b.text.split(/[.;\n]/)[0] || "").slice(0, 90);
          if (isJunk(tt) && isJunk(b.text)) return;
          a[kind].push({ title: tt, brief: title ? b.text : b.text.slice(tt.length).replace(/^[.;:\s]+/, ""), shared: !!shared, themes: themesOf(tt, b.text) });
        };
        if (sum.length <= 1) push(sum[0] || "", briefRaw);                       // one item: keep the whole brief
        else if (briefs.length === sum.length) sum.forEach((t, k) => push(t, briefs[k]));
        else {                                                                     // titles only; brief shown once for the row
          sum.forEach((t, k) => push(t, k === 0 ? briefRaw : "", k === 0 && !isJunk(briefRaw)));
        }
      } else if (kind === "joinees") {
        const g = (rx) => { const c = col(h, rx); return c >= 0 ? r[c] : ""; };
        const name = oneLine(g(/^name$/));
        if (!name) continue;
        const facRaw = oneLine(g(/facilitat/));
        const facName = (facRaw.split("|")[0] || "").trim();
        const facPhone = mask(facRaw, { ...ctx, name: facName || name });
        const facBits = facPhone.text.split("|").map((x) => x.trim()).filter(Boolean);
        const profile = mask(g(/profile|brief/), { ...ctx, name });
        a.joinees.push({
          name, age: oneLine(g(/^age/)).replace(/\.0$/, ""), caste: oneLine(g(/^caste/)), party: oneLine(g(/^party/)),
          profile: profile.text, influence: oneLine(g(/influence/)), voterImpact: oneLine(g(/voter\s*impact/)),
          probability: oneLine(g(/probab/)), expectation: oneLine(g(/expect/)),
          facilitator: { name: facBits[0] || "", designation: facBits.slice(1).filter((x) => !/X{6}/.test(x)).join(" · "), phone: facPhone.refs[0] || null },
          phoneRefs: [...profile.refs, ...facPhone.refs],
        });
      } else {
        const cols = h.map((x, j) => ({ j, label: oneLine((grid[at] || [])[j]) })).filter((c) => c.label && c.j !== cName && c.j !== cNo && c.j !== cDist && c.j !== cRegion);
        const row = {};
        cols.forEach((c) => { row[c.label] = mask(r[c.j] || "", ctx).text; });
        if (Object.values(row).some(Boolean)) {
          let t = a.other.find((x) => x.tab === title);
          if (!t) { t = { tab: title, columns: cols.map((c) => c.label), rows: [] }; a.other.push(t); }
          t.rows.push(row);
        }
      }
      rowsOut.push(no);
    }
    tabInfo.push({ title, kind, rows: used, acs: new Set(rowsOut).size });
  });

  function g2(hh, r, rx) { const c = col(hh, rx); return c >= 0 ? r[c] : ""; }

  /* finish each AC */
  Object.values(acs).forEach((a) => {
    a.district = a.sheetDistrict || a.district;
    if (!a.region) a.region = regionOfDistrict(a.district);
    a.reserved = a.reserved || /\(sc\)/i.test(a.sheetName || "");
    a.displayName = a.sheetName || a.name.replace(/\s*\(SC\)$/i, "");
    a.readiness = a.assessment ? readiness(a.assessment, a.disputes.length > 0) : null;
    a.counts = { disputes: a.disputes.length, issues: a.issues.length, demands: a.demands.length, joinees: a.joinees.length };
    a.completeness = {
      assessment: !!a.assessment, disputes: a.disputes.length > 0, issues: a.issues.length > 0,
      demands: a.demands.length > 0, joinees: a.joinees.length > 0,
    };
    delete a.sheetDistrict;
  });

  if (unmatched.length) issuesLog.push(`Rows not matched to any AC: ${unmatched.slice(0, 12).join("; ")}${unmatched.length > 12 ? ` and ${unmatched.length - 12} more` : ""}.`);
  return { acs, phones, tabs: tabInfo, issues: issuesLog, state: summarise(acs) };
}

/* ------------------------------ statewide view ------------------------------ */

function summarise(acs) {
  const list = Object.values(acs).filter((a) => a.tracked);
  const all = Object.values(acs);
  const count = (arr, f) => arr.reduce((m, a) => { const k = f(a) || "Not rated"; m[k] = (m[k] || 0) + 1; return m; }, {});
  const regions = [...new Set(list.map((a) => a.region).filter(Boolean))].sort();
  const byRegion = regions.map((r) => {
    const xs = list.filter((a) => a.region === r);
    const sc = xs.map((a) => a.readiness && a.readiness.score).filter(Number.isFinite);
    return {
      region: r, acs: xs.length,
      winnability: count(xs, (a) => a.assessment && a.assessment.winnability),
      cadre: count(xs, (a) => a.assessment && a.assessment.cadre),
      candidate: count(xs, (a) => a.assessment && a.assessment.candidate),
      avgReadiness: sc.length ? Math.round(sc.reduce((t, x) => t + x, 0) / sc.length) : null,
      disputes: xs.filter((a) => a.disputes.length).length,
      issues: xs.reduce((t, a) => t + a.issues.length, 0),
    };
  });
  const cross = {};
  list.forEach((a) => {
    const c = (a.assessment && a.assessment.cadre) || "Not rated";
    const w = (a.assessment && a.assessment.winnability) || "Not rated";
    cross[c] = cross[c] || {}; cross[c][w] = (cross[c][w] || 0) + 1;
  });
  const themeCount = (kind) => {
    const m = {};
    all.forEach((a) => a[kind].forEach((it) => it.themes.forEach((t) => {
      m[t] = m[t] || { theme: t, items: 0, acs: new Set(), byRegion: {} };
      m[t].items++; m[t].acs.add(a.no); m[t].byRegion[a.region] = (m[t].byRegion[a.region] || 0) + 1;
    })));
    return Object.values(m).map((x) => ({ ...x, acs: x.acs.size })).sort((p, q) => q.items - p.items);
  };
  const att = list.map((a) => a.assessment && a.assessment.attendance).filter((x) => x && x.total >= 5);
  const scores = list.map((a) => a.readiness && a.readiness.score).filter(Number.isFinite);
  return {
    trackedAcs: list.length,
    totalAcs: 117,
    reserved: list.filter((a) => a.reserved).length,
    winnability: count(list, (a) => a.assessment && a.assessment.winnability),
    cadre: count(list, (a) => a.assessment && a.assessment.cadre),
    candidate: count(list, (a) => a.assessment && a.assessment.candidate),
    financial: count(list, (a) => a.assessment && a.assessment.financial),
    cooperation: count(list, (a) => a.assessment && a.assessment.cooperation),
    category: count(list, (a) => a.category && `Category ${a.category}`),
    bands: count(list, (a) => a.readiness && a.readiness.band),
    avgReadiness: scores.length ? Math.round(scores.reduce((t, x) => t + x, 0) / scores.length) : null,
    avgAttendance: att.length ? Math.round(att.reduce((t, x) => t + x.present, 0) / att.reduce((t, x) => t + x.total, 0) * 100) : null,
    acsWithDisputes: all.filter((a) => a.disputes.length).length,
    issueItems: all.reduce((t, a) => t + a.issues.length, 0),
    demandItems: all.reduce((t, a) => t + a.demands.length, 0),
    acsWithIssues: all.filter((a) => a.issues.length).length,
    acsWithDemands: all.filter((a) => a.demands.length).length,
    joinees: all.reduce((t, a) => t + a.joinees.length, 0),
    byRegion, cross,
    issueThemes: themeCount("issues"),
    demandThemes: themeCount("demands"),
    weights: WEIGHTS, points: POINTS, disputePenalty: DISPUTE_PENALTY, bandRules: BANDS.map(([min, b]) => ({ band: b, min })),
  };
}

module.exports = { parsePunjabProformas, splitNumbered, parseLeaders, parsePerson, attendance, nameKey, themesOf };
