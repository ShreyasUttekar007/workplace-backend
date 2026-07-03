// routes/punjab.js
// -----------------------------------------------------------------------------
// Punjab project support endpoints. Mounted at /api/punjab in app.js.
//
//   GET /api/punjab/geo     -> Region > District > AC tree (cascading dropdowns
//                              in the new-MoM form and the Cab form)
//   GET /api/punjab/acs     -> flat [{region, district, ac_no, ac_name}]
//   GET /api/punjab/people  -> Punjab field team [{name, email, role, region}]
//                              (used to populate the "PC Mapped" column in the
//                              Punjab PCM Activity & Attendance form)
//
// Uses the same authenticateUser middleware as the other feature routes so the
// data is only available to logged-in users, consistent with the rest of the app.
// -----------------------------------------------------------------------------

const express = require("express");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const authenticateUser = require("../middleware/authenticateUser");
const punjabGeo = require("../utils/punjabGeo");

router.use(authenticateUser);

// Cascading dropdown data.
router.get("/geo", (_req, res) => {
  res.status(200).json(punjabGeo.tree());
});

// Flat AC list (handy for validation / search).
router.get("/acs", (_req, res) => {
  const acs = punjabGeo.acList();
  res.status(200).json({ count: acs.length, acs });
});

// Punjab field team — for the PCM form's "PC Mapped" options.
let PEOPLE = [];
try {
  PEOPLE = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "data", "punjabPeople.json"), "utf8")
  );
} catch (e) {
  console.error("[punjab] could not load data/punjabPeople.json:", e.message);
}
router.get("/people", (req, res) => {
  const role = (req.query.role || "").toLowerCase(); // optional: "acm" | "zonal"
  const out = role ? PEOPLE.filter((p) => (p.role || "").toLowerCase() === role) : PEOPLE;
  res.status(200).json({ count: out.length, people: out });
});

module.exports = router;
