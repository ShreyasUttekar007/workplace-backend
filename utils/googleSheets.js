// Google Sheets reader with a small in-memory cache.
// The service-account key is read from a file OUTSIDE the repo:
//   GOOGLE_SHEETS_KEY_FILE  (default: ./config/gsheets-key.json)
// The spreadsheet id comes from:
//   PUNJAB_SHEET_ID
const path = require("path");
const fs = require("fs");

let googleapis = null;
try {
  googleapis = require("googleapis");
} catch (e) {
  console.error("[googleSheets] 'googleapis' is not installed. Run: npm install googleapis");
}

const KEY_FILE =
  process.env.GOOGLE_SHEETS_KEY_FILE ||
  path.join(__dirname, "..", "config", "gsheets-key.json");

const CACHE_MS = Number(process.env.SHEETS_CACHE_MS || 5 * 60 * 1000);
const cache = new Map(); // key -> { at, rows }

let clientPromise = null;
function getClient() {
  if (!googleapis) throw new Error("googleapis package is not installed on the server.");
  if (!fs.existsSync(KEY_FILE)) {
    throw new Error(`Google service-account key not found at ${KEY_FILE}`);
  }
  if (!clientPromise) {
    const { google } = googleapis;
    const auth = new google.auth.GoogleAuth({
      keyFile: KEY_FILE,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    clientPromise = auth.getClient().then((authClient) =>
      google.sheets({ version: "v4", auth: authClient })
    );
  }
  return clientPromise;
}

// Read a whole tab as a 2-D array of raw cell values.
async function readTab(tabName, { spreadsheetId, force = false } = {}) {
  const sheetId = spreadsheetId || process.env.PUNJAB_SHEET_ID;
  if (!sheetId) throw new Error("PUNJAB_SHEET_ID is not set in the environment.");
  const key = `${sheetId}::${tabName}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_MS) return hit.rows;

  const sheets = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `'${tabName}'`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });
  const rows = res.data.values || [];
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

const clearCache = () => cache.clear();

module.exports = { readTab, clearCache, KEY_FILE };
