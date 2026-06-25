const fs = require("fs");
const { google } = require("googleapis");
const EmployeeData = require("../models/EmployeeData");
const User = require("../models/User");
require("dotenv").config();

// ---- Config from environment ----
const SHEET_ID = process.env.EMPLOYEE_SHEET_ID;
// e.g. "Copy of DB Data 1!A1:AA"  (tab name + range). Defaults to a wide range.
const SHEET_RANGE = process.env.EMPLOYEE_SHEET_RANGE || "A1:AA";
// Whether to overwrite leave balances from the sheet (see caveat in deploy notes).
const SYNC_LEAVE_BALANCES =
  (process.env.SHEET_SYNC_LEAVE_BALANCES || "true").toLowerCase() !== "false";

// Build a Google Sheets client from a service-account file or inline JSON.
function getCredentials() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!path) {
    throw new Error(
      "No Google credentials: set GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON"
    );
  }
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

async function getSheetRows() {
  if (!SHEET_ID) throw new Error("EMPLOYEE_SHEET_ID is not set");
  const creds = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth: await auth.getClient() });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE,
  });
  return res.data.values || [];
}

const clean = (v) => (v === undefined || v === null ? "" : String(v).trim());
const num = (v) => {
  const n = parseFloat(clean(v));
  return isNaN(n) ? 0 : n;
};

// Map a sheet row (object keyed by header) to the EmployeeData fields.
function toEmployeeDoc(r) {
  const doc = {
    gender: clean(r.gender),
    employeeCode: clean(r.employeeCode),
    employeeName: clean(r.employeeName),
    employeePhoneNumber: clean(r.employeePhoneNumber),
    department: clean(r.department),
    role: clean(r.role),
    reportingManager: clean(r.reportingManager),
    reportingManagerCode: clean(r.reportingManagerCode),
    reportingManagerEmail: clean(r.reportingManagerEmail),
    reportingManager1: clean(r.reportingManager1),
    reportingManagerCode1: clean(r.reportingManagerCode1),
    reportingManagerEmail1: clean(r.reportingManagerEmail1),
    reportingManager2: clean(r.reportingManager2),
    reportingManagerCode2: clean(r.reportingManagerCode2),
    reportingManagerEmail2: clean(r.reportingManagerEmail2),
    reportingManager3: clean(r.reportingManager3),
    reportingManagerCode3: clean(r.reportingManagerCode3),
    reportingManagerEmail3: clean(r.reportingManagerEmail3),
  };
  if (SYNC_LEAVE_BALANCES) {
    doc.sickLeave = clean(r.sickLeave);
    doc.paidLeave = clean(r.paidLeave);
    doc.restrictedHoliday = clean(r.restrictedHoliday);
    doc.menstrualLeave = clean(r.menstrualLeave);
    doc.regularizationLeave = clean(r.regularizationLeave);
    doc.compensationLeave = num(r.compensationLeave);
    doc.onOfficeDuty = num(r.onOfficeDuty);
  }
  return doc;
}

/**
 * Sync employees from the Google Sheet into MongoDB.
 *  - EmployeeData: upserted (created/updated) keyed by employeeEmail.
 *  - User: updated (NOT created) — department, team, primary & secondary RM.
 *
 * options.dryRun: if true, computes changes but writes nothing.
 * Returns a summary object.
 */
async function syncEmployeesFromSheet(options = {}) {
  const dryRun = !!options.dryRun;
  const rows = await getSheetRows();
  if (rows.length < 2) {
    return { ok: false, message: "Sheet has no data rows", rows: rows.length };
  }

  const headers = rows[0].map((h) => clean(h));
  const summary = {
    ok: true,
    dryRun,
    totalRows: rows.length - 1,
    employeesUpserted: 0,
    usersUpdated: 0,
    usersNotFound: 0,
    skippedNoEmail: 0,
    leaveBalancesSynced: SYNC_LEAVE_BALANCES,
    errors: [],
  };

  for (let i = 1; i < rows.length; i++) {
    const r = {};
    headers.forEach((h, idx) => (r[h] = rows[i][idx]));

    const email = clean(r.employeeEmail).toLowerCase();
    if (!email) {
      summary.skippedNoEmail++;
      continue;
    }

    try {
      const empDoc = toEmployeeDoc(r);
      empDoc.employeeEmail = email;

      if (!dryRun) {
        await EmployeeData.updateOne(
          { employeeEmail: { $regex: new RegExp(`^${email}$`, "i") } },
          { $set: empDoc },
          { upsert: true }
        );
      }
      summary.employeesUpserted++;

      // Update the matching User (login account) — org structure only.
      const userUpdate = {
        department: clean(r.department),
        reportingManagerEmail: clean(r.reportingManagerEmail),
        reportingManagerName: clean(r.reportingManager),
        secondaryReportingManagerEmail: clean(r.reportingManagerEmail1),
        secondaryReportingManagerName: clean(r.reportingManager1),
      };
      // 'role' from the sheet best matches the portal's "team" concept.
      if (clean(r.role)) userUpdate.team = clean(r.role);

      if (!dryRun) {
        const res = await User.updateOne(
          { email: { $regex: new RegExp(`^${email}$`, "i") } },
          { $set: userUpdate }
        );
        if (res.matchedCount > 0) summary.usersUpdated++;
        else summary.usersNotFound++;
      } else {
        const exists = await User.exists({
          email: { $regex: new RegExp(`^${email}$`, "i") },
        });
        exists ? summary.usersUpdated++ : summary.usersNotFound++;
      }
    } catch (e) {
      summary.errors.push({ email, error: e.message });
    }
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

module.exports = { syncEmployeesFromSheet };
