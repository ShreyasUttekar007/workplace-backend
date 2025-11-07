const mongoose = require("mongoose");

const CandidatesDailyActivitySchema = new mongoose.Schema(
  {
    pc: { type: String, trim: true, default: "" },
    constituency: { type: String, trim: true, default: "" },
    ward: { type: String, trim: true, default: "" },
    activityImage: { type: String, trim: true, default: "" },
    probableShsCandidateName: { type: [String], trim: true, default: "" },
    shsDesignation: { type: [String], trim: true, default: "" },
    shsActivityType: { type: [String], trim: true, default: "" },
    shsActivityDetails: { type: [String], trim: true, default: "" },
    oppositionCandidateName: { type: [String], trim: true, default: "" },
    candidateParty: { type: [String], trim: true, default: "" },
    oppositionCandidateDesignation: { type: [String], trim: true, default: "" },
    oppositionActivityType: { type: [String], trim: true, default: "" },
    oppositionActivityDetails: { type: [String], trim: true, default: "" },
    majorPoliticalDevelopmentDetails: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "CandidatesDailyActivity",
  CandidatesDailyActivitySchema
);
