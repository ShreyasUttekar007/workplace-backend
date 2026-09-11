const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const { readTab, clearCache } = require("../utils/googleSheets");

router.use(authenticateUser);

// Directors + reporting managers: full access to every dashboard.
const DASHBOARD_EMAILS_RAW = [
  "anuragsaxena@showtimeconsulting.in",
  "pardhasaradhi@showtimeconsulting.in",
  "rs@showtimeconsulting.in",
  "khushboo@showtimeconsulting.in",
  "sonkar.shalini@showtimeconsulting.in",
  "rajvardhan@showtimeconsulting.in",
  "faisalgani@showtimeconsulting.in",
];

// Additional viewers for the Leadership Dashboards hub + Caste Census only.
// (To give someone the Interventions dashboard too, move their address up into
//  DASHBOARD_EMAILS instead.)
const CASTE_VIEWER_EMAILS_RAW = [
  // (empty - add an address here for hub + Caste Census access only)
];

// normalise hard: trim, lowercase, strip any surrounding quotes/spaces
const norm = (v) => String(v == null ? "" : v).replace(/["'\s]/g, "").toLowerCase();
const DASHBOARD_EMAILS = DASHBOARD_EMAILS_RAW.map((e) => e.toLowerCase());
const CASTE_VIEWER_EMAILS = CASTE_VIEWER_EMAILS_RAW.map((e) => e.toLowerCase());

const emailOf = (req) => norm(req.user?.email);
const isAdmin = (req) => (req.user?.roles || []).includes("admin");

// Hub + Caste Census access
const canView = (req) =>
  DASHBOARD_EMAILS.includes(emailOf(req)) ||
  CASTE_VIEWER_EMAILS.includes(emailOf(req)) ||
  isAdmin(req);

// Interventions dashboard is limited to the core directors/managers list
const canViewInterventions = (req) =>
  DASHBOARD_EMAILS.includes(emailOf(req)) || isAdmin(req);

const CASTE_TAB = process.env.CASTE_CENSUS_TAB || "Caste census daily update";

const num = (v) => {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();


// Sheets returns dated headers as formatted strings (e.g. "23-08-2026", "23/08/2026",
// "2026-08-23"). Parse them properly so the trend axis shows real dates.
function parseHeaderDate(h) {
  const s = String(h || "").trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); // YYYY-MM-DD
  if (m) return { y: +m[1], mo: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);      // DD-MM-YYYY or MM-DD-YYYY
  if (m) return { a: +m[1], b: +m[2], y: +m[3], ambiguous: true };
  const d = new Date(s);
  if (!isNaN(d.getTime())) return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate() };
  return null;
}
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const pad = (n) => String(n).padStart(2, "0");

// Resolve DD/MM vs MM/DD across the whole set: the columns run in date order, so
// pick the reading that produces an increasing sequence.
function resolveDateLabels(rawLabels) {
  const parsed = rawLabels.map(parseHeaderDate);
  const anyAmbiguous = parsed.some((p) => p && p.ambiguous);
  let dayFirst = true;
  if (anyAmbiguous) {
    const score = (df) => {
      let prev = 0, ok = 0;
      parsed.forEach((p) => {
        if (!p) return;
        const mo = p.ambiguous ? (df ? p.b : p.a) : p.mo;
        const d = p.ambiguous ? (df ? p.a : p.b) : p.d;
        if (mo < 1 || mo > 12 || d < 1 || d > 31) { ok -= 5; return; }
        const t = p.y * 10000 + mo * 100 + d;
        if (t >= prev) ok += 1;
        prev = t;
      });
      return ok;
    };
    dayFirst = score(true) >= score(false);
  }
  return parsed.map((p, i) => {
    if (!p) return { display: String(rawLabels[i]), iso: "" };
    const mo = p.ambiguous ? (dayFirst ? p.b : p.a) : p.mo;
    const d = p.ambiguous ? (dayFirst ? p.a : p.b) : p.d;
    return {
      display: `${pad(d)} ${MONTHS[Math.min(Math.max(mo, 1), 12) - 1]}`,
      iso: `${p.y}-${pad(mo)}-${pad(d)}`,
    };
  });
}

function parseCasteSheet(rows) {
  let hIdx = rows.findIndex((r) => (r || []).some((c) => clean(c).toLowerCase() === "ac name"));
  if (hIdx === -1) hIdx = 0;
  const header = (rows[hIdx] || []).map((c) => clean(c));
  const lower = header.map((h) => h.toLowerCase());
  const col = (needle) => lower.findIndex((h) => h.includes(needle));

  const idx = {
    zone: col("zone"),
    resource: col("mapped resource"),
    district: col("district"),
    dpoc: col("dpoc"),
    acNo: col("ac no"),
    acName: col("ac name"),
    halka: col("halka incharge"),
    totalBooth: lower.findIndex((h) => h.includes("total") && h.includes("booth")),
    distributed: lower.findIndex((h) => h.includes("voter list distributed")),
    digitalised: lower.findIndex((h) => h.includes("digitalised") && h.includes("booth")),
    status: lower.findIndex((h) => h.includes("digitalised status")),
    remark: col("remark"),
  };

  // Dated columns = the daily trend.
  const dateCols = [];
  header.forEach((h, i) => {
    if (!h) return;
    const d = new Date(h);
    const looksDate = /\d{1,4}[-/]\d{1,2}[-/]\d{1,4}/.test(h) || /\d{1,2}\s*[A-Za-z]{3}/.test(h);
    if (looksDate && !isNaN(d.getTime())) dateCols.push({ i, label: h });
  });

  const records = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const acName = clean(row[idx.acName]);
    if (!acName) continue;
    const total = num(row[idx.totalBooth]);
    const digi = num(row[idx.digitalised]);
    const dist = num(row[idx.distributed]);
    records.push({
      zone: clean(row[idx.zone]),
      mappedResource: clean(row[idx.resource]),
      district: clean(row[idx.district]),
      dpoc: clean(row[idx.dpoc]),
      acNo: num(row[idx.acNo]),
      acName,
      halkaIncharge: clean(row[idx.halka]),
      totalBooth: total,
      distributed: dist,
      digitalised: digi,
      status: clean(row[idx.status]) || "Not Started",
      pct: total > 0 ? Math.round((digi / total) * 1000) / 10 : 0,
      distPct: total > 0 ? Math.round((dist / total) * 1000) / 10 : 0,
      remark: clean(row[idx.remark]),
      series: dateCols.map((d) => num(row[d.i])),
    });
  }
  return { records, dateLabels: dateCols.map((d) => d.label) };
}

// Returns the whole dataset; the UI filters/aggregates client-side (72 rows).
router.get("/caste-census", async (req, res) => {
  try {
    if (!canView(req)) return res.status(403).json({ error: "Not authorised to view dashboards." });
    const rows = await readTab(CASTE_TAB, { force: req.query.refresh === "1" });
    const { records, dateLabels } = parseCasteSheet(rows);

    // Column-wise totals for the trend; drop columns that are entirely empty
    // (blank sheet columns would otherwise show as a drop to zero).
    const nice = resolveDateLabels(dateLabels);
    const trend = [];
    dateLabels.forEach((label, i) => {
      const value = records.reduce((a, r) => a + (r.series[i] || 0), 0);
      if (value > 0) {
        trend.push({
          label: nice[i].display || String(label),
          iso: nice[i].iso || "",
          value,
        });
      }
    });

    res.json({ records, trend, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/refresh", async (req, res) => {
  if (!canView(req)) return res.status(403).json({ error: "Not authorised." });
  clearCache();
  res.json({ message: "Cache cleared." });
});


/* ------------------- Region Wise Interventions dashboard ------------------- */
const INTERVENTIONS_TAB = process.env.INTERVENTIONS_TAB || "Region wise Intervention";

const isVacant = (v) => {
  const t = clean(v).toLowerCase();
  return !t || ["not appointed", "na", "n/a", "-", "nil", "none", "vacant"].includes(t);
};

const ISSUE_CATEGORIES = [
  ["Caste Census & Booth Committees", [
    "caste census", "caste cenus", "booth committee", "booth commitee", "booth commmitee",
    "committee formation", "circle committee", "booth pradhan", "committees",
  ]],
  ["Internal Coordination & Factionalism", [
    "coordination", "cordination", "factional", "faction", "internal difference",
    "internal conflict", "internal issue", "differences", "conflict", "friction",
    "discontent", "sidelined", "rift", "perception",
  ]],
  ["Leadership Vacancy & Absence", [
    "not appointed", "non-appointment", "no halka incharge", "vacant", "vacancy",
    "absence", "absent", "inactive", "activation of", "weak and inactive",
  ]],
  ["Candidate & Alignment Dynamics", [
    "joining", "candidature", "party switch", "induction", "alliance", "ticket",
    "defect", "candidate",
  ]],
  ["Wing & Organizational Setup", [
    "wing", "office setup", "party office", "organisational weakness",
    "organizational weakness", "organisational work", "organizational work",
  ]],
];

function categorise(rec) {
  // A Category column in the sheet always wins, if present.
  if (rec.category) return rec.category;
  // Classify on the Issue Summary (the Brief is long prose and over-matches).
  const primary = (rec.issueSummary || "").toLowerCase();
  for (const [name, keys] of ISSUE_CATEGORIES) {
    if (keys.some((k) => primary.includes(k))) return name;
  }
  const secondary = (rec.brief || "").toLowerCase();
  for (const [name, keys] of ISSUE_CATEGORIES) {
    if (keys.some((k) => secondary.includes(k))) return name;
  }
  return "Other Local Matters";
}

function parseInterventions(rows) {
  let hIdx = rows.findIndex((r) => (r || []).some((c) => clean(c).toLowerCase() === "ac name"));
  if (hIdx === -1) hIdx = 0;
  const header = (rows[hIdx] || []).map((c) => clean(c));
  const lower = header.map((h) => h.toLowerCase());
  const col = (n) => lower.findIndex((h) => h.includes(n));
  const idx = {
    region: col("region"),
    district: col("district"),
    acNo: col("ac no"),
    acName: col("ac name"),
    coordinator: col("halka coordinator"),
    incharge: lower.findIndex((h) => h.includes("halka incharge") || h.includes("halka in-charge")),
    leader: col("leader involved"),
    issueSummary: col("issue summary"),
    brief: col("brief"),
    actionable: col("political actionable"),
    category: col("category"),
  };

  const out = [];
  for (let r = hIdx + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const acName = clean(row[idx.acName]);
    if (!acName) continue;
    const rec = {
      region: clean(row[idx.region]),
      district: clean(row[idx.district]),
      acNo: num(row[idx.acNo]),
      acName,
      halkaCoordinator: clean(row[idx.coordinator]),
      halkaIncharge: clean(row[idx.incharge]),
      leaderInvolved: clean(row[idx.leader]),
      issueSummary: clean(row[idx.issueSummary]),
      brief: clean(row[idx.brief]),
      politicalActionable: clean(row[idx.actionable]),
      category: idx.category > -1 ? clean(row[idx.category]) : "",
    };
    rec.category = categorise(rec);
    rec.inchargeVacant = isVacant(rec.halkaIncharge);
    rec.coordinatorVacant = isVacant(rec.halkaCoordinator);
    out.push(rec);
  }
  return out;
}

router.get("/interventions", async (req, res) => {
  try {
    if (!canViewInterventions(req)) return res.status(403).json({ error: "Not authorised to view dashboards." });
    const rows = await readTab(INTERVENTIONS_TAB, {
      spreadsheetId: process.env.INTERVENTIONS_SHEET_ID,
      keyFile: process.env.INTERVENTIONS_KEY_FILE,
      force: req.query.refresh === "1",
    });
    const records = parseInterventions(rows);
    res.json({ records, updatedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
