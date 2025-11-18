// models/SocialListening.js
const mongoose = require("mongoose");
const { Schema } = mongoose;

const Booths = require("../models/BoothList");
const BoothsAp = require("../models/BoothListAP");

// Subdoc for party-wise notes
const PartyNoteSchema = new Schema(
  {
    party: { type: String, trim: true, required: true },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const SocialListeningSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    state: { type: String, trim: true },
    zone: { type: String, trim: true },
    district: { type: String, trim: true },
    pc: { type: String, trim: true },

    constituency: {
      type: String,
      trim: true,
      required: [true, "Please select a constituency"],
      index: true,
    },

    blockName: { type: String, trim: true, required: true },
    villageOrWard: { type: String, trim: true, required: true },

    // Stored as string per your requirement (e.g., "11-11-2025")
    dateOfMeeting: { type: String, trim: true },
    numberOfPeople: { type: String, trim: true },
    placeOfMeeting: { type: String, trim: true },

    overallSentiments: {
      type: [PartyNoteSchema],
      default: [],
    },

    spPerception: {
      type: String,
      trim: true,
      required: true, // Positive / Negative / Neutral
    },

    keyIssues: { type: String, trim: true },
    communityMoodNarratives: { type: String, trim: true },
    remarks: { type: String, trim: true },
  },
  { timestamps: true }
);

// Auto-fill zone/district/pc based on state + constituency
SocialListeningSchema.pre("save", async function (next) {
  try {
    // If you need user email or validation, you can use this; otherwise remove.
    // const user = await mongoose.model("User").findById(this.userId).select("email");

    let stateData = null;

    if (this.state === "Maharashtra") {
      stateData = await Booths.findOne({ constituency: this.constituency });
    } else if (this.state === "Andhra Pradesh") {
      stateData = await BoothsAp.findOne({ constituency: this.constituency });
    } else if (this.state === "Bengal") {
      stateData = await BoothsAp.findOne({ constituency: this.constituency });
    } else if (this.state === "Uttar Pradesh") {
      stateData = await BoothsAp.findOne({ constituency: this.constituency });
    }

    if (stateData) {
      this.zone = stateData.zone || this.zone;
      this.district = stateData.district || this.district;
      this.pc = stateData.pc || this.pc;
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("SocialListening", SocialListeningSchema);
