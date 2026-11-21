/**
 * Check the Punjab AC proforma sheet from the server, without the web app.
 *   node scripts/punjab-proforma-check.js
 * Prints which tabs were recognised, how many ACs each covers, and statewide
 * counts. Exits non-zero (with a plain reason) if the key or sharing is wrong.
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { parsePunjabProformas } = require("../utils/punjabProformaParser");

const ROOT = path.join(__dirname, "..");
const SHEET_ID = process.env.PUNJAB_PROFORMA_SHEET_ID || "17-Fg3_jhEwEgBZU2GpGyWgoN75dC6TSHV0rjf_ohPBk";
const cands = [process.env.PUNJAB_PROFORMA_KEY_FILE, path.join(ROOT, "config", "punjab-proforma-key.json"), process.env.GOOGLE_SHEETS_KEY_FILE, path.join(ROOT, "config", "gsheets-key.json"), path.join(ROOT, "config", "ap-proforma-key.json")]
  .filter(Boolean).map((f) => (path.isAbsolute(f) ? f : path.join(ROOT, f)));
const keyFile = cands.find((f) => fs.existsSync(f));

(async () => {
  if (!keyFile) { console.error("NO KEY FILE. Save the service-account JSON as config/punjab-proforma-key.json"); process.exit(2); }
  const who = JSON.parse(fs.readFileSync(keyFile, "utf8")).client_email;
  console.log("key file      :", keyFile);
  console.log("service email :", who, "(the sheet must be shared with this address)");
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "properties(title),sheets(properties(title,hidden))" });
  const titles = meta.data.sheets.filter((s) => !s.properties.hidden).map((s) => s.properties.title);
  const r = await sheets.spreadsheets.values.batchGet({ spreadsheetId: SHEET_ID, ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`), valueRenderOption: "FORMATTED_VALUE" });
  const tabs = {}; r.data.valueRanges.forEach((vr, i) => { tabs[titles[i]] = vr.values || []; });
  const ref = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "punjab-geo", "acs.json"), "utf8")).acs.map(({ no, name, district, pc }) => ({ no, name, district, pc }));
  const p = parsePunjabProformas(tabs, ref);
  console.log("sheet         :", meta.data.properties.title);
  p.tabs.forEach((t) => console.log(`  tab "${t.title}" -> ${t.kind} | rows ${t.rows} | ACs ${t.acs == null ? "-" : t.acs}`));
  const s = p.state;
  console.log("tracked ACs   :", s.trackedAcs, "| avg readiness:", s.avgReadiness, "| disputes:", s.acsWithDisputes, "| issues:", s.issueItems, "| demands:", s.demandItems, "| joinees:", s.joinees);
  console.log("phones masked :", p.phones.size);
  if (p.issues.length) console.log("NOTE          :", p.issues.join(" "));
  console.log("OK");
})().catch((e) => {
  const m = String(e.message || e);
  if (/permission|403/i.test(m)) console.error("SHEET NOT SHARED with the service account above - share it with Viewer access.");
  else if (/invalid_grant/i.test(m)) console.error("KEY INVALID (deleted/rotated) - create a new JSON key.");
  else console.error("FAILED:", m);
  process.exit(1);
});
