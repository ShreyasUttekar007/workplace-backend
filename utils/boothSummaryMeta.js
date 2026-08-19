// Per-AC summary metadata, seeded from Summary - Booth Wise Details.csv.
// Holds columns that live only in the summary sheet (Region, Mapped Resource,
// DPOC, Priority, Category, ACM Name). Counts are computed live from booth data.
const path = require("path");
const fs = require("fs");

let META = [];
try {
  META = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "boothSummaryMeta.json"), "utf8")
  );
} catch (e) {
  console.error("[boothSummaryMeta] could not load data/boothSummaryMeta.json:", e.message);
}

const byAcNo = {};
META.forEach((m) => { if (m.acNo != null) byAcNo[Number(m.acNo)] = m; });

module.exports = {
  all: () => META,
  forAcNo: (acNo) => byAcNo[Number(acNo)] || null,
};
