/**
 * Check an AC proforma sheet end to end, from the server:
 *   node scripts/proforma-check.js            (all configured ACs)
 *   node scripts/proforma-check.js kadapa
 * Reads the live sheet with the real service account and prints what the
 * parser makes of it. Contact numbers are never printed.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { parseProforma } = require("../utils/proformaParser");

const KEY_FILE = process.env.AP_PROFORMA_KEY_FILE || path.join(__dirname, "..", "config", "ap-proforma-key.json");
const REG = { kadapa: { name: "Kadapa", sheetId: "1uBNoaWJQGI-xRA8CUXrWhAjaBwQAYjwpIH9H9d1zRXo" } };
const extraFile = path.join(__dirname, "..", "config", "ap-proformas.json");
if (fs.existsSync(extraFile)) Object.assign(REG, JSON.parse(fs.readFileSync(extraFile, "utf8")));

(async () => {
  if (!fs.existsSync(KEY_FILE)) { console.log("KEY FILE MISSING:", KEY_FILE); process.exit(1); }
  const key = JSON.parse(fs.readFileSync(KEY_FILE, "utf8"));
  console.log("service account:", key.client_email, "| key id:", String(key.private_key_id || "").slice(0, 12));
  const auth = new google.auth.GoogleAuth({ keyFile: KEY_FILE, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });

  for (const [k, ac] of Object.entries(REG).filter(([k]) => !process.argv[2] || k === process.argv[2])) {
    console.log(`\n==== ${ac.name} (${k}) ====`);
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId: ac.sheetId, fields: "properties(title),sheets(properties(title,hidden))" });
      const titles = meta.data.sheets.filter((s) => !s.properties.hidden).map((s) => s.properties.title);
      console.log("sheet:", meta.data.properties.title, "|", titles.length, "tabs");
      const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: ac.sheetId, ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`) });
      const tabs = {}; r.data.valueRanges.forEach((vr, i) => { tabs[titles[i]] = vr.values || []; });
      const { dossier: d, phones } = parseProforma(tabs);
      console.log("profile :", JSON.stringify(d.profile));
      console.log("kpis    :", JSON.stringify(d.kpis));
      console.log("castes  :", d.castes.length, "| elections:", d.elections.Assembly.length, "assembly +", d.elections.Parliament.length, "parliament");
      console.log("contacts masked:", phones.size);
      console.log("tabs:");
      d.completeness.forEach((c) => console.log(`  ${c.status.padEnd(8)} ${c.tab.padEnd(38)} ${c.rows} entries${c.templateRows ? `, ${c.templateRows} unfilled` : ""}${c.issues.length ? "  ! " + [...new Set(c.issues)].join(" ") : ""}`));
    } catch (e) {
      const m = e.message || String(e);
      console.log("ERROR:", m);
      if (/permission/i.test(m)) console.log(`-> Share the sheet (Viewer) with ${key.client_email}`);
      if (/not found/i.test(m)) console.log("-> Check the sheetId");
    }
  }
})();
