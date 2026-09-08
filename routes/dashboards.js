const express = require("express");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const { readTab, clearCache } = require("../utils/googleSheets");

router.use(authenticateUser);

// Directors + reporting managers who can open these dashboards.
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
  const n = Number(String(v).toString().replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// Find the header row (the one containing "AC Name") and map columns.
function parseCasteSheet(rows) {
  let hIdx = rows.findIndex((r) => (r || []).some((c) => clean(c).toLowerCase() === "ac name"));
  if (hIdx === -1) hIdx = 0;
  const header = (rows[hIdx] || []).map((c) => clean(c));
  const lower = header.map((h) => h.toLowerCase());
  const col = (needle) => lower.findIndex((h) => h.includes(needle));

  const idx = {
    zone: col("zone"),
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

  // Date columns = headers that look like a date (the daily trend).
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
    records.push({
      zone: clean(row[idx.zone]),
      district: clean(row[idx.district]),
      dpoc: clean(row[idx.dpoc]),
      acNo: num(row[idx.acNo]),
      acName,
      halkaIncharge: clean(row[idx.halka]),
      totalBooth: total,
      distributed: num(row[idx.distributed]),
      digitalised: digi,
      status: clean(row[idx.status]) || "Not Started",
      pct: total > 0 ? Math.round((digi / total) * 1000) / 10 : 0,
      remark: clean(row[idx.remark]),
      series: dateCols.map((d) => num(row[d.i])),
    });
  }
  return { records, dateLabels: dateCols.map((d) => d.label) };
}

const statusBucket = (s) => {
  const t = (s || "").toLowerCase();
  if (t.includes("complete")) return "Completed";
  if (t.includes("progress")) return "In Progress";
  return "Not Started";
};

router.get("/caste-census", async (req, res) => {
  try {
    if (!canView(req)) return res.status(403).json({ error: "Not authorised to view dashboards." });
    const zone = clean(req.query.zone);
    const rows = await readTab(CASTE_TAB, { force: req.query.refresh === "1" });
    const { records, dateLabels } = parseCasteSheet(rows);

    const inZone = zone && zone.toLowerCase() !== "all"
      ? records.filter((r) => r.zone.toLowerCase() === zone.toLowerCase())
      : records;

    const totalACs = inZone.length;
    const totalBooths = inZone.reduce((a, r) => a + r.totalBooth, 0);
    const totalDigitalised = inZone.reduce((a, r) => a + r.digitalised, 0);
    const overallPct = totalBooths > 0 ? Math.round((totalDigitalised / totalBooths) * 1000) / 10 : 0;

    // Daily trend = column-wise totals across the date columns.
    const trend = dateLabels.map((label, i) => ({
      label,
      value: inZone.reduce((a, r) => a + (r.series[i] || 0), 0),
    }));

    // District rollup (digitalised vs remaining).
    const byDistrict = {};
    inZone.forEach((r) => {
      const d = r.district || "Unknown";
      if (!byDistrict[d]) byDistrict[d] = { district: d, total: 0, digitalised: 0 };
      byDistrict[d].total += r.totalBooth;
      byDistrict[d].digitalised += r.digitalised;
    });
    const districts = Object.values(byDistrict)
      .map((d) => ({ ...d, remaining: Math.max(d.total - d.digitalised, 0) }))
      .sort((a, b) => b.total - a.total);

    // Zone rollup (always all zones, for the zone bar).
    const byZone = {};
    records.forEach((r) => {
      const z = r.zone || "Unknown";
      if (!byZone[z]) byZone[z] = { zone: z, total: 0, digitalised: 0, acs: 0 };
      byZone[z].total += r.totalBooth;
      byZone[z].digitalised += r.digitalised;
      byZone[z].acs += 1;
    });
    const zones = Object.values(byZone).map((z) => ({
      ...z,
      pct: z.total > 0 ? Math.round((z.digitalised / z.total) * 1000) / 10 : 0,
    }));

    const ranked = [...inZone].sort((a, b) => b.pct - a.pct);
    const top5 = ranked.slice(0, 5).map((r) => ({ acName: r.acName, pct: r.pct }));
    const bottom5 = ranked.slice(-5).reverse().map((r) => ({ acName: r.acName, pct: r.pct }));

    const statusCounts = { Completed: 0, "In Progress": 0, "Not Started": 0 };
    inZone.forEach((r) => { statusCounts[statusBucket(r.status)] += 1; });

    // DPOC performance (avg % of their ACs).
    const byDpoc = {};
    inZone.forEach((r) => {
      const d = r.dpoc || "Unknown";
      if (!byDpoc[d]) byDpoc[d] = { dpoc: d, sum: 0, n: 0 };
      byDpoc[d].sum += r.pct;
      byDpoc[d].n += 1;
    });
    const dpocs = Object.values(byDpoc)
      .map((d) => ({ dpoc: d.dpoc, pct: Math.round((d.sum / d.n) * 10) / 10 }))
      .sort((a, b) => b.pct - a.pct);

    res.json({
      zones: zones.map((z) => z.zone),
      kpis: { totalACs, totalBooths, totalDigitalised, overallPct },
      zoneRollup: zones,
      districts,
      trend,
      top5,
      bottom5,
      statusCounts,
      dpocs,
      table: inZone.map((r) => ({
        zone: r.zone, district: r.district, acNo: r.acNo, acName: r.acName,
        halkaIncharge: r.halkaIncharge, totalBooth: r.totalBooth,
        distributed: r.distributed, digitalised: r.digitalised,
        pct: r.pct, status: r.status, remark: r.remark,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Force a cache refresh.
router.post("/refresh", async (req, res) => {
  if (!canView(req)) return res.status(403).json({ error: "Not authorised." });
  clearCache();
  res.json({ message: "Cache cleared." });
});

module.exports = router;
