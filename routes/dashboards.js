const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const { readTab, clearCache } = require("../utils/googleSheets");

router.use(authenticateUser);

const DASHBOARD_EMAILS = [
  "anuragsaxena@showtimeconsulting.in",
  "pardhasaradhi@showtimeconsulting.in",
  "rs@showtimeconsulting.in",
  "khushboo@showtimeconsulting.in",
  "sonkar.shalini@showtimeconsulting.in",
  "rajvardhan@showtimeconsulting.in",
];
const canView = (req) => {
  const email = (req.user?.email || "").trim().toLowerCase();
  const roles = req.user?.roles || [];
  return DASHBOARD_EMAILS.includes(email) || roles.includes("admin");
};

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

module.exports = router;
