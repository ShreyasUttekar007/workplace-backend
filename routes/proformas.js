/**
 * AC Proformas ("AC Bible") for Project - Andhra Pradesh.
 *
 *   GET  /api/proformas/list                 ACs configured
 *   GET  /api/proformas/ac/:key[?refresh=1]  parsed dossier for one AC
 *   POST /api/proformas/ac/:key/reveal       full number for one masked contact (logged)
 *   GET  /api/proformas/audit                recent reveals (admin)
 *
 * One Google Sheet per AC, all read with one service account. Phone numbers
 * never leave the server unless a permitted user reveals one, and every reveal
 * is written to the ProformaAudit collection.
 *
 * Adding an AC: duplicate the proforma sheet, share it (Viewer) with the
 * service account, and add it to config/ap-proformas.json:
 *   { "pulivendula": { "name": "Pulivendula", "district": "YSR Kadapa", "sheetId": "..." } }
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const authenticateUser = require("../middleware/authenticateUser");
const { parseProforma } = require("../utils/proformaParser");
const ProformaAudit = require("../models/ProformaAudit");

const router = express.Router();
router.use(authenticateUser);

/* --------------------------------- access --------------------------------- */
// Same list as the AP Leadership Dashboards (single source of truth).
let canViewAP = null;
try { canViewAP = require("./dashboards").canViewAP; } catch (e) { canViewAP = null; }
const isAdmin = (req) => (req.user?.roles || []).includes("admin");
const allowed = (req) => (typeof canViewAP === "function" ? canViewAP(req) : isAdmin(req));

router.use((req, res, next) => {
  if (!allowed(req)) return res.status(403).json({ error: "Not authorised to view AC proformas." });
  next();
});

/* -------------------------------- registry -------------------------------- */
const DEFAULT_REGISTRY = {
  kadapa: {
    name: "Kadapa",
    district: "YSR Kadapa",
    sheetId: "1uBNoaWJQGI-xRA8CUXrWhAjaBwQAYjwpIH9H9d1zRXo",
  },
};
const REGISTRY_FILE = path.join(__dirname, "..", "config", "ap-proformas.json");

function registry() {
  let extra = {};
  try {
    if (fs.existsSync(REGISTRY_FILE)) extra = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
  } catch (e) {
    console.warn("[proformas] config/ap-proformas.json is not valid JSON - ignoring it:", e.message);
  }
  return { ...DEFAULT_REGISTRY, ...extra };
}

const KEY_FILE = process.env.AP_PROFORMA_KEY_FILE ||
  path.join(__dirname, "..", "config", "ap-proforma-key.json");

const serviceEmail = () => {
  try { return JSON.parse(fs.readFileSync(KEY_FILE, "utf8")).client_email || ""; } catch (e) { return ""; }
};

/* --------------------------------- fetch ---------------------------------- */
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map(); // key -> { at, dossier, phones, title }

async function fetchTabs(sheetId) {
  if (!fs.existsSync(KEY_FILE)) {
    const e = new Error(`Service-account key not found at ${KEY_FILE}.`);
    e.code = "NO_KEY"; throw e;
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "properties(title),sheets(properties(title,hidden))",
  });
  const titles = (meta.data.sheets || [])
    .filter((s) => !s.properties.hidden)
    .map((s) => s.properties.title);
  const r = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: sheetId,
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: "FORMATTED_VALUE",
  });
  const tabs = {};
  (r.data.valueRanges || []).forEach((vr, i) => { tabs[titles[i]] = vr.values || []; });
  return { tabs, title: meta.data.properties.title };
}

function explain(err) {
  const m = String(err && err.message || err);
  if (err && err.code === "NO_KEY") return m + " Copy the service-account JSON to that path (chmod 600).";
  if (/permission|PERMISSION_DENIED|403/i.test(m)) {
    const who = serviceEmail();
    return `The sheet is not shared with the service account${who ? ` (${who})` : ""}. Share it with Viewer access.`;
  }
  if (/not found|404/i.test(m)) return "The Google Sheet ID was not found - check the sheetId for this AC.";
  if (/invalid_grant|account not found/i.test(m)) return "The service-account key is no longer valid (deleted or rotated). Create a new JSON key.";
  return m;
}

async function load(key, force) {
  const reg = registry();
  const ac = reg[key];
  if (!ac) { const e = new Error("Unknown AC."); e.status = 404; throw e; }
  const hit = cache.get(key);
  if (hit && !force && Date.now() - hit.at < CACHE_MS) return hit;
  const { tabs, title } = await fetchTabs(ac.sheetId);
  const { dossier, phones } = parseProforma(tabs);
  const entry = { at: Date.now(), dossier, phones, title, ac };
  cache.set(key, entry);
  return entry;
}

/* -------------------------------- endpoints ------------------------------- */
router.get("/list", (req, res) => {
  const reg = registry();
  res.json(Object.entries(reg).map(([key, v]) => ({ key, name: v.name || key, district: v.district || "" }))
    .sort((a, b) => a.name.localeCompare(b.name)));
});

router.get("/ac/:key", async (req, res) => {
  try {
    const e = await load(req.params.key, req.query.refresh === "1");
    res.json({
      key: req.params.key,
      name: e.ac.name || req.params.key,
      district: e.ac.district || "",
      sheetTitle: e.title,
      sheetUrl: `https://docs.google.com/spreadsheets/d/${e.ac.sheetId}/edit`,
      fetchedAt: new Date(e.at).toISOString(),
      ...e.dossier,
    });
  } catch (err) {
    console.warn("[proformas]", req.params.key, err.message);
    res.status(err.status || 502).json({ error: explain(err) });
  }
});

router.post("/ac/:key/reveal", express.json(), async (req, res) => {
  try {
    const ref = String((req.body && req.body.ref) || "");
    const e = await load(req.params.key, false);
    const hit = e.phones.get(ref);
    if (!hit) return res.status(404).json({ error: "Contact not found - refresh the page and try again." });
    ProformaAudit.create({
      email: req.user?.email || "", ac: req.params.key, tab: hit.tab, person: hit.name,
      ref, ip: (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim(),
    }).catch((x) => console.warn("[proformas] audit write failed:", x.message));
    res.json({ number: hit.number });
  } catch (err) {
    res.status(err.status || 502).json({ error: explain(err) });
  }
});

router.get("/audit", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only." });
  const rows = await ProformaAudit.find({}).sort({ createdAt: -1 }).limit(200).lean();
  res.json(rows);
});

module.exports = router;
