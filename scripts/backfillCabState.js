/**
 * One-off: stamp state="Andhra Pradesh" on cab records created before the
 * `state` field existed, so the state-split KPI counts are accurate.
 *
 * Dry run (shows what WOULD change, changes nothing):
 *   node scripts/backfillCabState.js
 * Apply:
 *   node scripts/backfillCabState.js --apply
 */
require("dotenv").config();
const mongoose = require("mongoose");
const CabRecord = require("../models/CabRequests");

const APPLY = process.argv.includes("--apply");
const MISSING = { $or: [{ state: { $exists: false } }, { state: "" }, { state: null }] };

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const before = {
    ap: await CabRecord.countDocuments({ state: "Andhra Pradesh" }),
    punjab: await CabRecord.countDocuments({ state: "Punjab" }),
    missing: await CabRecord.countDocuments(MISSING),
  };
  console.log("BEFORE:", before);

  if (!APPLY) {
    console.log(
      `\nDRY RUN — would set state="Andhra Pradesh" on ${before.missing} record(s).`
    );
    console.log("Re-run with --apply to make the change.");
    process.exit(0);
  }

  const result = await CabRecord.updateMany(MISSING, {
    $set: { state: "Andhra Pradesh" },
  });
  console.log("Updated:", result.modifiedCount);

  console.log("AFTER:", {
    ap: await CabRecord.countDocuments({ state: "Andhra Pradesh" }),
    punjab: await CabRecord.countDocuments({ state: "Punjab" }),
    missing: await CabRecord.countDocuments(MISSING),
  });
  process.exit(0);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
