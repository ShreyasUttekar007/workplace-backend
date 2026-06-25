const cron = require("node-cron");
const { syncEmployeesFromSheet } = require("../utils/sheetSync");

// Cron expression for the auto-sync. Default: every 30 minutes.
// Override with SHEET_SYNC_CRON (e.g. "0 * * * *" hourly, "0 2 * * *" 2am daily).
const SCHEDULE = process.env.SHEET_SYNC_CRON || "*/30 * * * *";
const ENABLED = (process.env.SHEET_SYNC_ENABLED || "true").toLowerCase() !== "false";

function startSheetSyncJob() {
  if (!ENABLED) {
    console.log("Sheet auto-sync is disabled (SHEET_SYNC_ENABLED=false).");
    return;
  }
  if (!process.env.EMPLOYEE_SHEET_ID) {
    console.warn("Sheet auto-sync not started: EMPLOYEE_SHEET_ID is not set.");
    return;
  }
  cron.schedule(
    SCHEDULE,
    async () => {
      try {
        const result = await syncEmployeesFromSheet({ dryRun: false });
        console.log(
          `[Sheet sync] ${result.employeesUpserted} employees, ` +
            `${result.usersUpdated} users updated, ` +
            `${result.usersNotFound} users not found, ` +
            `${result.errors.length} errors.`
        );
      } catch (e) {
        console.error("[Sheet sync] failed:", e.message);
      }
    },
    { timezone: "Asia/Kolkata" }
  );
  console.log(`Sheet auto-sync scheduled: "${SCHEDULE}" (Asia/Kolkata).`);
}

module.exports = { startSheetSyncJob };
