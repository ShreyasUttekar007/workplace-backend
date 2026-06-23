const express = require("express");
const router = express.Router();
const PcmReport = require("../models/PcmReport");
const authenticateUser = require("../middleware/authenticateUser");
const { sendPcmReport } = require("./pcmReportJob");

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

module.exports = router;
