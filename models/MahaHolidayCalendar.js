const mongoose = require("mongoose");

const mahaHolidaySchema = new mongoose.Schema({
  date: { type: String, required: true },
  day: { type: String, required: true },
  holiday: { type: String, required: true },
  holidayType: { type: String, required: true },
});

const MahaHoliday = mongoose.model("MahaHoliday", mahaHolidaySchema);

module.exports = MahaHoliday;
