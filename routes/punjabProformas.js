/**
 * AC Proformas for Project - Punjab.
 *
 *   GET  /api/punjab-proformas/data[?refresh=1]   every AC dossier + statewide summary (one sheet)
 *   GET  /api/punjab-proformas/geo                117 AC boundaries for the 3D map
 *   GET  /api/punjab-proformas/geo/villages/:no   village boundaries inside one AC
 *   POST /api/punjab-proformas/reveal             full number for one masked contact (logged)
 *
 * One Google Sheet holds every AC (tabs recognised by their header row - see
 * utils/punjabProformaParser.js). Phone numbers never leave the server unless a
 * permitted user reveals one; every reveal is written to ProformaAudit
 * (ac = "punjab-<AC no>").
 *
 * Config (.env, all optional):
 *   PUNJAB_PROFORMA_SHEET_ID   defaults to the Punjab proforma sheet below
 *   PUNJAB_PROFORMA_KEY_FILE   service-account JSON (fallbacks listed in keyFile())
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { google } = require("googleapis");
const authenticateUser = require("../middleware/authenticateUser");
const { parsePunjabProformas } = require("../utils/punjabProformaParser");
const ProformaAudit = require("../models/ProformaAudit");

const router = express.Router();
router.use(authenticateUser);

/* --------------------------------- access --------------------------------- */
// Restricted to these people only (no role-based bypass). This list is what
// actually enforces access; WelcomePage.js / DirectorDashboards.js only decide
// whether the tile is shown. Keep the three lists in step.
const PUNJAB_PROFORMA_EMAILS = [
  "pardhasaradhi@showtimeconsulting.in",
  "sonkar.shalini@showtimeconsulting.in",
].map((e) => e.toLowerCase());

const norm = (v) => String(v == null ? "" : v).replace(/["'\s]/g, "").toLowerCase();
router.use((req, res, next) => {
  if (!PUNJAB_PROFORMA_EMAILS.includes(norm(req.user && req.user.email))) {
    return res.status(403).json({ error: "Not authorised to view Punjab AC proformas." });
  }
  next();
});

/* --------------------------------- config --------------------------------- */
const SHEET_ID = process.env.PUNJAB_PROFORMA_SHEET_ID || "17-Fg3_jhEwEgBZU2GpGyWgoN75dC6TSHV0rjf_ohPBk";
const ROOT = path.join(__dirname, "..");
const GEO_DIR = path.join(ROOT, "data", "punjab-geo");

function keyFile() {
  const cands = [
    process.env.PUNJAB_PROFORMA_KEY_FILE,
    path.join(ROOT, "config", "punjab-proforma-key.json"),
    process.env.GOOGLE_SHEETS_KEY_FILE,
    path.join(ROOT, "config", "gsheets-key.json"),
    path.join(ROOT, "config", "ap-proforma-key.json"),
  ].filter(Boolean).map((f) => (path.isAbsolute(f) ? f : path.join(ROOT, f)));
  return cands.find((f) => fs.existsSync(f)) || cands[0];
}
const serviceEmail = () => { try { return JSON.parse(fs.readFileSync(keyFile(), "utf8")).client_email || ""; } catch (e) { return ""; } };

/* ------------------------------- geometry ------------------------------- */
let geoCache = null;      // { gz, ref }
let villageCache = null;  // parsed villages.json
function geo() {
  if (!geoCache) {
    const raw = fs.readFileSync(path.join(GEO_DIR, "acs.json"), "utf8");
    const j = JSON.parse(raw);
    geoCache = { gz: zlib.gzipSync(raw), ref: j.acs.map(({ no, name, district, pc }) => ({ no, name, district, pc })) };
  }
  return geoCache;
}
function villages() {
  if (!villageCache) villageCache = JSON.parse(fs.readFileSync(path.join(GEO_DIR, "villages.json"), "utf8"));
  return villageCache;
}

/* --------------------------------- fetch ---------------------------------- */
const CACHE_MS = 5 * 60 * 1000;
let cache = null; // { at, parsed, title, gz }

async function readSheet() {
  const kf = keyFile();
  if (!fs.existsSync(kf)) { const e = new Error(`Service-account key not found at ${kf}.`); e.code = "NO_KEY"; throw e; }
  const auth = new google.auth.GoogleAuth({ keyFile: kf, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID, fields: "properties(title),sheets(properties(title,hidden))" });
  const titles = (meta.data.sheets || []).filter((s) => !s.properties.hidden).map((s) => s.properties.title);
  const r = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SHEET_ID,
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "FORMATTED_VALUE",
  });
  const tabs = {};
  (r.data.valueRanges || []).forEach((vr, i) => { tabs[titles[i]] = vr.values || []; });
  return { tabs, title: meta.data.properties.title };
}

function explain(err) {
  const m = String((err && err.message) || err);
  if (err && err.code === "NO_KEY") return `${m} Save the service-account JSON as config/punjab-proforma-key.json (chmod 600).`;
  if (/permission|PERMISSION_DENIED|403/i.test(m)) {
    const who = serviceEmail();
    return `The Punjab proforma sheet is not shared with the service account${who ? ` (${who})` : ""}. Share it with Viewer access.`;
  }
  if (/not found|404/i.test(m)) return "The Punjab proforma Google Sheet was not found - check PUNJAB_PROFORMA_SHEET_ID.";
  if (/invalid_grant|account not found/i.test(m)) return "The service-account key is no longer valid (deleted or rotated). Create a new JSON key.";
  if (/ENOENT/.test(m)) return `A data file is missing on the server: ${m}`;
  return m;
}

async function load(force) {
  if (cache && !force && Date.now() - cache.at < CACHE_MS) return cache;
  const { tabs, title } = await readSheet();
  const parsed = parsePunjabProformas(tabs, geo().ref);
  const acs = Object.values(parsed.acs).sort((a, b) => a.no - b.no);
  const body = {
    sheetTitle: title,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
    fetchedAt: new Date().toISOString(),
    tabs: parsed.tabs, issues: parsed.issues, state: parsed.state, acs,
  };
  cache = { at: Date.now(), parsed, title, gz: zlib.gzipSync(JSON.stringify(body)) };
  return cache;
}

const sendGz = (req, res, gz) => {
  res.set("Content-Type", "application/json; charset=utf-8");
  res.set("Cache-Control", "no-store");
  if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) { res.set("Content-Encoding", "gzip"); return res.send(gz); }
  return res.send(zlib.gunzipSync(gz));
};

/* -------------------------------- endpoints ------------------------------- */
router.get("/data", async (req, res) => {
  try {
    const c = await load(req.query.refresh === "1");
    sendGz(req, res, c.gz);
  } catch (err) {
    console.warn("[punjab-proformas]", err.message);
    res.status(err.status || 502).json({ error: explain(err) });
  }
});

router.get("/geo", (req, res) => {
  try { sendGz(req, res, geo().gz); } catch (err) { res.status(500).json({ error: explain(err) }); }
});

router.get("/geo/villages/:no", (req, res) => {
  try {
    const no = String(parseInt(req.params.no, 10));
    const v = villages();
    res.json({ no: Number(no), q: v.q, villages: v.villages[no] || [] });
  } catch (err) { res.status(500).json({ error: explain(err) }); }
});

router.post("/reveal", express.json(), async (req, res) => {
  try {
    const ref = String((req.body && req.body.ref) || "");
    const c = await load(false);
    const hit = c.parsed.phones.get(ref);
    if (!hit) return res.status(404).json({ error: "Contact not found - refresh the page and try again." });
    ProformaAudit.create({
      email: (req.user && req.user.email) || "", ac: `punjab-${hit.ac}`, tab: hit.tab, person: hit.name, ref,
      ip: (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim(),
    }).catch((x) => console.warn("[punjab-proformas] audit write failed:", x.message));
    res.json({ number: hit.number });
  } catch (err) {
    res.status(err.status || 502).json({ error: explain(err) });
  }
});

module.exports = router;
