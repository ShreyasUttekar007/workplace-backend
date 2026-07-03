// scripts/seedPunjabUsers.js
// -----------------------------------------------------------------------------
// Tags the Punjab field team so the app scopes them to Punjab.
//
// How scoping works in this app: `user.location` holds the state name, and the
// MoM / Leader-Meeting routes filter by it (allowedStates now includes "Punjab").
// So all this script does is set  location = "Punjab"  on the mapped users.
//
// SAFE: it only UPDATES users that already exist (matched by email). It never
// creates accounts and never touches passwords (the password pre-save hook only
// re-hashes when the password field itself changes). Emails it can't find are
// listed at the end so you can create them via the normal admin flow, then re-run.
//
// Run from the workplace-backend folder:
//     node scripts/seedPunjabUsers.js
//
// Dry run (prints what it WOULD change, writes nothing):
//     node scripts/seedPunjabUsers.js --dry
// -----------------------------------------------------------------------------

require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const User = require("../models/User");

const DRY = process.argv.includes("--dry");
const MONGO = config.mongodbURI || process.env.MONGODB_URI || process.env.MONGO_URI;

if (!MONGO) {
  console.error("No Mongo connection string (config.mongodbURI / MONGODB_URI).");
  process.exit(1);
}

const seed = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "punjabUsersSeed.json"), "utf8")
);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

(async () => {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log(`${DRY ? "[DRY RUN] " : ""}Seeding ${seed.length} Punjab users...\n`);

  let updated = 0;
  const missing = [];

  for (const u of seed) {
    const email = (u.email || "").toLowerCase().trim();
    if (!email) continue;

    const user = await User.findOne({ email: new RegExp(`^${esc(email)}$`, "i") });
    if (!user) {
      missing.push(email);
      continue;
    }

    if (user.location === "Punjab") {
      console.log(`  = ${email} already Punjab`);
      continue;
    }

    console.log(`  ✓ ${email}  location: "${user.location || ""}" -> "Punjab"`);
    if (!DRY) {
      user.location = "Punjab";
      await user.save(); // password untouched -> not re-hashed
    }
    updated++;
  }

  console.log(`\n${DRY ? "[DRY RUN] would update" : "Updated"} ${updated} user(s).`);
  if (missing.length) {
    console.log(`\n${missing.length} email(s) NOT found (create them, then re-run):`);
    missing.forEach((m) => console.log("   -", m));
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
