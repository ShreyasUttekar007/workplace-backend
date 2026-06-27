const express = require("express");
const router = express.Router();
const PcmReport = require("../models/PcmReport");
const authenticateUser = require("../middleware/authenticateUser");
const { sendPcmReport } = require("./pcmReportJob");
const MomFormat = require("../models/MomFormat");
const NewMom = require("../models/NewMomModel");

router.use(authenticateUser);

// Get today's report (or null if not started yet)
router.get("/today", async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];
    const r = await PcmReport.findOne({ date });
    res.status(200).json(r || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upsert today's report
router.post("/save", async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split("T")[0];
    const payload = {
      ...req.body,
      date,
      updatedByEmail: (req.user && req.user.email) || req.body.updatedByEmail || "",
    };
    const r = await PcmReport.findOneAndUpdate({ date }, payload, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });
    res.status(200).json(r);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manually trigger the email now (useful for testing without waiting for 8 PM)
router.post("/send-now", async (req, res) => {
  try {
    await sendPcmReport();
    res.status(200).json({ message: "PCM report email triggered." });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Per-person Minutes-of-Meeting counts for a given day.
// Returns counts grouped by the recorder's name, so the PCM tracker can
// fuzzy-match each PCM to their meeting count for that date.
// Query: ?date=YYYY-MM-DD  (defaults to today, Asia/Kolkata)
router.get("/mom-counts", async (req, res) => {
  try {
    let date = (req.query.date || "").trim();
    if (!date) {
      // Today's date in Asia/Kolkata as YYYY-MM-DD
      const now = new Date(
        new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
      );
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      date = `${y}-${m}-${d}`;
    }

    const counts = {}; // normalizedName -> { name, count }
    const norm = (s) =>
      (s || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .sort()
        .join(" ");

    const add = (name) => {
      const key = norm(name);
      if (!key) return;
      if (!counts[key]) counts[key] = { name: name.trim(), count: 0 };
      counts[key].count += 1;
    };

    // New meetings (MomFormat) — meetingDate stored as a string.
    const fmt = await MomFormat.find({ meetingDate: date }).select(
      "createdByName meetingDate"
    );
    fmt.forEach((r) => add(r.createdByName));

    // Legacy meetings (NewMom) — date stored in `dom`, recorder via userName.
    try {
      const legacy = await NewMom.find({ dom: date }).populate(
        "userId",
        "userName"
      );
      legacy.forEach((m) => add((m.userId && m.userId.userName) || ""));
    } catch (e) {
      /* legacy collection optional */
    }

    res.status(200).json({
      date,
      counts: Object.values(counts), // [{ name, count }]
    });
  } catch (e) {
    console.error("mom-counts error:", e.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
