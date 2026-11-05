/**
 * Check the AP vote-share sheets end to end, from the server:
 *   node scripts/voteshare-check.js
 * Reads the live sheets with the real service account and prints what the
 * parser and statistics make of them.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { parseWorkbooks } = require("../utils/voteshareParser");
const { buildDashboard, dateBounds } = require("../utils/voteshareStats");

const IDS = (process.env.VOTESHARE_SHEET_IDS ||
  "148qSk09SH7PS1xq8Jcuni_FnCafWHIBisDsQ0xdUcA4,1HPrYlTsZBZ6hZ9ikSB0LYzgtN6634tZ2mA4cJfFyfM4").split(",").map((s) => s.trim());
const KEY = [process.env.VOTESHARE_KEY_FILE, path.join(__dirname, "..", "config", "voteshare-key.json"),
  path.join(__dirname, "..", "config", "ap-proforma-key.json")].filter(Boolean).find((f) => fs.existsSync(f));

(async () => {
  if (!KEY) { console.log("NO KEY FILE: put the JSON at config/voteshare-key.json"); process.exit(1); }
  const k = JSON.parse(fs.readFileSync(KEY, "utf8"));
  console.log("key:", KEY, "| service account:", k.client_email);
  const auth = new google.auth.GoogleAuth({ keyFile: KEY, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
  const books = [];
  for (const id of IDS) {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "properties(title),sheets(properties(title,hidden))" });
      const titles = meta.data.sheets.filter((s) => !s.properties.hidden).map((s) => s.properties.title);
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: id, ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
        valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
      const tabs = {}; r.data.valueRanges.forEach((vr, i) => { tabs[titles[i]] = vr.values || []; });
      console.log(`\nSHEET ${meta.data.properties.title}: tabs = ${titles.join(" | ")}`);
      books.push({ sheetTitle: meta.data.properties.title, tabs });
    } catch (e) {
      console.log(`\nSHEET ${id}: ERROR ${e.message}`);
      if (/permission/i.test(e.message)) console.log(`-> share it (Viewer) with ${k.client_email}`);
    }
  }
  const parsed = parseWorkbooks(books);
  console.log("\nrecognised master tabs:", parsed.masters.map((m) => `${m.tab} (${m.rows.length} rows, window "${m.window || "inherit"}")`).join(", ") || "NONE");
  console.log("recognised report tabs:", parsed.reports.map((r) => `${r.tab} [${r.kind}, ${r.window || "no window"}]`).join(", ") || "NONE");
  console.log("not recognised:", parsed.skipped.join(", ") || "none");
  console.log("dates available:", JSON.stringify(dateBounds(parsed)));
  const d = buildDashboard(parsed);
  for (const w of d.windows) {
    const x = d.byWindow[w];
    console.log(`\n=== ${w}: ${x.firstDate} -> ${x.latestDate} (${x.days} days), ${x.acs.length} ACs`);
    if (x.seats) {
      Object.values(x.seats.byParty).forEach((p) => console.log(`  ${p.party.padEnd(6)} ahead in ${p.ahead} of ${p.contested} (won ${p.won2024} in 2024) | comfortable ${p["Comfortable lead"]}, narrow ${p["Narrow lead"]}, too close ${p["Too close to call"]}`));
      console.log(`  too close to call: ${x.seats.tooClose}`);
    }
    console.log(`anomalies: ${x.anomalies.length} | at-risk seats: ${x.atRisk.length} | issues: ${x.issues.length ? x.issues.join(" ; ") : "none"}`);
    x.insights.forEach((i) => console.log("  -", i.text));
  }
})();
