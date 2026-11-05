/**
 * AP Vote Share Tracker (Cipher survey) - Project Andhra Pradesh.
 *
 *   GET /api/voteshare            full dashboard (every DMA window found)
 *   GET /api/voteshare?refresh=1  re-read the Google Sheets now
 *
 * Reads every tab of the configured spreadsheets with one service account,
 * recognises the AC master and the CM / party / Alliance / govt-rating report
 * tabs by their content, and computes the statistics in utils/voteshareStats.
 * New days added to the sheets appear automatically (5-minute cache).
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { google } = require("googleapis");
const authenticateUser = require("../middleware/authenticateUser");
const { parseWorkbooks } = require("../utils/voteshareParser");
const { buildDashboard, filterByDate, dateBounds } = require("../utils/voteshareStats");

const router = express.Router();
router.use(authenticateUser);

// Restricted for now to the people listed here (no role-based bypass). The hub
// card in DirectorDashboards.js uses the same list only to decide visibility.
const VOTESHARE_EMAILS = ["pardhasaradhi@showtimeconsulting.in"];
const norm = (v) => String(v == null ? "" : v).replace(/["'\s]/g, "").toLowerCase();
router.use((req, res, next) => {
  if (!VOTESHARE_EMAILS.includes(norm(req.user && req.user.email))) {
    return res.status(403).json({ error: "Not authorised to view this dashboard." });
  }
  next();
});

const SHEET_IDS = (process.env.VOTESHARE_SHEET_IDS ||
  "148qSk09SH7PS1xq8Jcuni_FnCafWHIBisDsQ0xdUcA4,1HPrYlTsZBZ6hZ9ikSB0LYzgtN6634tZ2mA4cJfFyfM4")
  .split(",").map((s) => s.trim()).filter(Boolean);

function keyFile() {
  const cands = [process.env.VOTESHARE_KEY_FILE,
    path.join(__dirname, "..", "config", "voteshare-key.json"),
    path.join(__dirname, "..", "config", "ap-proforma-key.json")].filter(Boolean);
  return cands.find((f) => fs.existsSync(f)) || cands[0];
}
const serviceEmail = () => { try { return JSON.parse(fs.readFileSync(keyFile(), "utf8")).client_email || ""; } catch (e) { return ""; } };

async function readSpreadsheet(sheets, id) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: "properties(title),sheets(properties(title,hidden))" });
  const titles = (meta.data.sheets || []).filter((s) => !s.properties.hidden).map((s) => s.properties.title);
  const r = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: id,
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const tabs = {};
  (r.data.valueRanges || []).forEach((vr, i) => { tabs[titles[i]] = vr.values || []; });
  return { id, sheetTitle: meta.data.properties.title, tabs };
}

function explain(err) {
  const m = String((err && err.message) || err);
  if (/permission|PERMISSION_DENIED|403/i.test(m)) {
    const who = serviceEmail();
    return `A sheet is not shared with the service account${who ? ` (${who})` : ""}. Share both sheets with Viewer access.`;
  }
  if (/not found|404/i.test(m)) return "A Google Sheet ID was not found - check VOTESHARE_SHEET_IDS.";
  if (/invalid_grant|account not found/i.test(m)) return "The service-account key is no longer valid. Create a new JSON key.";
  if (/ENOENT/.test(m)) return `Service-account key not found at ${keyFile()}.`;
  return m;
}

const CACHE_MS = 5 * 60 * 1000;
let sheetCache = null;            // { at, parsed, bounds }
const viewCache = new Map();      // "from|to" -> gzipped JSON (cleared on every sheet re-read)

async function readSheets() {
  const auth = new google.auth.GoogleAuth({ keyFile: keyFile(), scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
  const books = await Promise.all(SHEET_IDS.map((id) => readSpreadsheet(sheets, id)));
  const parsed = parseWorkbooks(books);
  return { at: Date.now(), parsed, bounds: dateBounds(parsed) };
}

const isoOk = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");

router.get("/", async (req, res) => {
  try {
    if (!sheetCache || req.query.refresh === "1" || Date.now() - sheetCache.at > CACHE_MS) {
      sheetCache = await readSheets();
      viewCache.clear();
    }
    const { bounds } = sheetCache;
    let from = isoOk(req.query.from) || bounds.min || "";
    let to = isoOk(req.query.to) || bounds.max || "";
    if (from && to && from > to) [from, to] = [to, from];
    const key = `${from}|${to}`;
    if (!viewCache.has(key)) {
      const dash = buildDashboard(filterByDate(sheetCache.parsed, from, to));
      dash.dateRange = { min: bounds.min, max: bounds.max, from, to };
      dash.fetchedAt = new Date(sheetCache.at).toISOString();
      if (viewCache.size > 30) viewCache.delete(viewCache.keys().next().value);
      viewCache.set(key, zlib.gzipSync(JSON.stringify(dash)));
    }
    const gz = viewCache.get(key);
    res.set("Content-Type", "application/json; charset=utf-8");
    res.set("Cache-Control", "no-store");
    if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
      res.set("Content-Encoding", "gzip");
      return res.send(gz);
    }
    return res.send(zlib.gunzipSync(gz));
  } catch (err) {
    console.warn("[voteshare]", err.message);
    res.status(502).json({ error: explain(err) });
  }
});

module.exports = router;
