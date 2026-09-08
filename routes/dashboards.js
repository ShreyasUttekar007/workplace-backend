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
    const trend = [];
    dateLabels.forEach((label, i) => {
      const value = records.reduce((a, r) => a + (r.series[i] || 0), 0);
      if (value > 0) trend.push({ label, value });
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
