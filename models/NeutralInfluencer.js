// models/NeutralInfluencer.js
const mongoose = require("mongoose");
const Booths = require("../models/BoothList");
const BoothsAp = require("../models/BoothListAP");

const { Schema } = mongoose;

const NeutralInfluencerSchema = new Schema(
  {
    // who created it
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // location packing (auto-filled in pre-save)
    state: { type: String, trim: true }, // read from req.user.location or client (like SocialListening)
    zone: { type: String, trim: true },
    district: { type: String, trim: true }, // also available as a filter, but not input (can be auto-packed)
    pc: { type: String, trim: true },

    // UI fields
    constituency: {
      type: String,
      trim: true,
      required: [true, "Please select a constituency"],
    }, // *AC
    blockName: { type: String, trim: true, required: true }, // *Block Name
    villageOrWard: { type: String, trim: true, required: true }, // *Village/Ward
    institutionOrOther: { type: String, trim: true, required: true }, // *Institution/Other

    dateOfMeeting: { type: String, trim: true }, // keep string to mirror SocialListening
    contactPersonName: { type: String, trim: true, required: true }, // *Name
    contactNumber: { type: String, trim: true, required: true }, // *Contact

    professionRole: {
      type: String,
      trim: true,
      default: "Others",
    }, // dropdown

    organisationName: { type: String, trim: true }, // optional

    pointsOfDiscussion: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

// Auto-pack zone/district/pc from Booth lists (same pattern as SocialListening)
NeutralInfluencerSchema.pre("save", async function (next) {
  try {
    let stateData;
    const ac = this.constituency;

    if (this.state === "Maharashtra") {
      stateData = await Booths.findOne({ constituency: ac });
    } else if (this.state === "Andhra Pradesh") {
      stateData = await BoothsAp.findOne({ constituency: ac });
    } else if (this.state === "Bengal") {
      stateData = await BoothsAp.findOne({ constituency: ac });
    } else if (this.state === "Uttar Pradesh") {
      stateData = await BoothsAp.findOne({ constituency: ac });
    }

    if (stateData) {
      this.zone = stateData.zone;
      this.district = stateData.district;
      this.pc = stateData.pc;
    }

    next();
  } catch (err) {
    next(err);
  }
});

module.exports = mongoose.model("NeutralInfluencer", NeutralInfluencerSchema);
