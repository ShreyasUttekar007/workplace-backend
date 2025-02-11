const express = require("express");
const MahaHoliday = require("../models/MahaHolidayCalendar"); // Import the model
const router = express.Router();

// GET API to fetch all holidays
router.get("/holidays", async (req, res) => {
  try {
    const holidays = await MahaHoliday.find();
    res.status(200).json(holidays);
  } catch (error) {
    res.status(500).json({ message: "Error fetching holidays", error });
  }
});

module.exports = router;
