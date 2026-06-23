const mongoose = require("mongoose");

const PcmRowSchema = new mongoose.Schema(
  {
    slNo: Number,
    pcmName: String,
    pcMapped: String,
    attendance: String, // Present / Absent / Vacant
    cabUsed: String, // Yes / No / NA
    escalationRaised: String,
    oppositionRaised: String,
    meetingConducted: String,
    note: String,
  },
  { _id: false }
);

const ZonalRowSchema = new mongoose.Schema(
  {
    slNo: Number,
    zone: String,
    pcsMapped: String,
    zonal: String,
    meetingsConducted: String,
  },
  { _id: false }
);

const SnapshotSchema = new mongoose.Schema(
  {
    totalPcms: Number,
    pcmsPresent: Number,
    pcmsAbsent: Number,
    vacantPcs: Number,
    zonalsPresent: Number,
    zonalsAbsent: Number,
    meetingsScheduled: Number,
    cabIssuesPcs: Number,
    totalEscalations: Number,
  },
  { _id: false }
);

const PcmReportSchema = new mongoose.Schema(
  {
    date: { type: String, index: true }, // YYYY-MM-DD (one report per day)
    snapshot: SnapshotSchema,
    pcmRows: [PcmRowSchema],
    zonalRows: [ZonalRowSchema],
    note: String,
    updatedByName: String,
    updatedByEmail: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("PcmReport", PcmReportSchema);
