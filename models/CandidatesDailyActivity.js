// models/CandidatesDailyActivity.js
const mongoose = require("mongoose");

// Single activity (all strings, all optional)
const ActivitySchema = new mongoose.Schema(
  {
    activityType: { type: String, trim: true, default: "" },
    activityDetails: { type: String, trim: true, default: "" },
    activityImage: { type: String, trim: true, default: "" }, // optional per-activity image
    date: { type: String, trim: true, default: "" }, // NEW: activity date (e.g., "2025-11-08")
  },
  { _id: false }
);

// Probable SHS candidate
const ProbableCandidateSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    party: { type: String, trim: true, default: "SHS" }, // default SHS
    candidateImage: { type: String, trim: true, default: "" },
    activities: { type: [ActivitySchema], default: [] },
  },
  { _id: false }
);

// Opposition candidate
const OppositionCandidateSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, default: "" },
    designation: { type: String, trim: true, default: "" },
    party: { type: String, trim: true, default: "" }, // no default
    candidateImage: { type: String, trim: true, default: "" },
    activities: { type: [ActivitySchema], default: [] },
  },
  { _id: false }
);

const CandidatesDailyActivitySchema = new mongoose.Schema(
  {
    pc: { type: String, trim: true, default: "" },
    constituency: { type: String, trim: true, default: "" },
    ward: { type: String, trim: true, default: "" },

    // optional page-level image
    activityImage: { type: String, trim: true, default: "" },

    // structured candidate sections
    probableCandidates: { type: [ProbableCandidateSchema], default: [] },
    oppositionCandidates: { type: [OppositionCandidateSchema], default: [] },

    majorPoliticalDevelopmentDetails: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  "CandidatesDailyActivity",
  CandidatesDailyActivitySchema
);
