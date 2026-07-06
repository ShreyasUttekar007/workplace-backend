const mongoose = require("mongoose");
const { Schema } = mongoose;
const BoothsAp = require("../models/BoothListAP");
const punjabGeo = require("../utils/punjabGeo");

const StakeholderSchema = new Schema(
  {
    name: { type: String, trim: true },
    designation: { type: String, trim: true },
    phone: { type: String, trim: true }, // stored as +91-XXXXXXXXXX
    party: { type: String, trim: true }, // Punjab only (AAP, SDA, INC, ...)
  },
  { _id: false }
);
const DiscussionSchema = new Schema(
  { point: { type: String, trim: true }, details: { type: String, trim: true } },
  { _id: false }
);
const StcActionableSchema = new Schema(
  {
    issue: { type: String, trim: true },
    actionable: { type: String, trim: true },
    timeline: { type: String, trim: true },
  },
  { _id: false }
);
const LeaderActionableSchema = new Schema(
  {
    issue: { type: String, trim: true },
    actionable: { type: String, trim: true },
    partyLeader: { type: String, trim: true },
    timeline: { type: String, trim: true },
  },
  { _id: false }
);

const MomFormatSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, trim: true },
    createdByEmail: { type: String, trim: true },
    state: { type: String, trim: true },

    // Meeting info
    meetingDate: { type: String, trim: true },
    meetingTime: { type: String, trim: true },
    numStakeholders: { type: String, trim: true },
    duration: { type: String, trim: true },

    // Location: AC dropdown = "Meeting Location" = Assembly Constituency
    location: { type: String, trim: true },
    // Auto-captured GPS "lat,long" for the Google Maps link
    gMapLocation: { type: String, trim: true },

    // Auto-derived from the AC for dashboard filters/counts
    zone: { type: String, trim: true },
    district: { type: String, trim: true },
    pc: { type: String, trim: true },
    // Punjab uses Region > District > AC. Region is stored here (and mirrored
    // into `zone` so all existing zone-based filters/counts keep working).
    region: { type: String, trim: true },

    // Respondent (primary stakeholder) — surfaced on the dashboard
    respondentName: { type: String, trim: true },
    respondentDesignation: { type: String, trim: true },
    respondentParty: { type: String, trim: true }, // Punjab only
    respondentPhoto: { type: String, trim: true },

    stakeholders: { type: [StakeholderSchema], default: [] },
    discussionPoints: { type: [DiscussionSchema], default: [] },
    stcActionables: { type: [StcActionableSchema], default: [] },
    leaderActionables: { type: [LeaderActionableSchema], default: [] },

    nextMeetingDate: { type: String, trim: true },
    remarks: { type: String, trim: true },

    reviewStatus: {
      type: String,
      enum: ["Not Reviewed", "State Lead Reviewed", "Zonal Reviewed"],
      default: "Not Reviewed",
      trim: true,
    },
  },
  { timestamps: true }
);

// Populate zone / district / pc from the selected Assembly Constituency
// so the dashboard Zone / PC / AC filters and counts work.
// For Punjab, geography comes from the static Punjab file (Region > District >
// AC); Region is stored in both `region` and `zone` so all existing zone-based
// filters keep functioning without any special-casing downstream.
async function fillGeography(doc) {
  try {
    if (!doc.location) return;

    if ((doc.state || "").trim() === "Punjab") {
      const hit = punjabGeo.lookupAc(doc.location);
      if (hit) {
        doc.region = hit.region;
        doc.zone = hit.region; // mirror so zone filters/counts still work
        doc.district = hit.district;
        doc.pc = ""; // Punjab has no PC layer
      }
      return; // don't fall through to the AP booth lookup
    }

    const ac = await BoothsAp.findOne({ constituency: doc.location });
    if (ac) {
      doc.zone = ac.zone;
      doc.district = ac.district;
      doc.pc = ac.pc;
    }
  } catch (e) {
    // non-fatal — geography is best-effort
  }
}

MomFormatSchema.pre("save", async function (next) {
  await fillGeography(this);
  next();
});

module.exports = mongoose.model("MomFormat", MomFormatSchema);
