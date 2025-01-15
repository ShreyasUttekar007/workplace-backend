const mongoose = require("mongoose");
const { Schema } = mongoose;
const AcData = require("../models/BmcMapping");

const interventionDataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    zone: {
      type: String,
      trim: true,
    },
    pc: {
      type: String,
      trim: true,
    },
    constituency: {
      type: String,
      required: [true, "Please select a Constituency"],
      trim: true,
    },
    ward: {
      type: String,
      required: [true, "Please select a Ward"],
      trim: true,
    },
    interventionType: {
      type: String,
      required: [true, "Please select a Intervention Type"],
      trim: true,
    },
    interventionIssues: {
      type: String,
      trim: true,
      required: [true, "Please enter the issue"],
    },
    interventionIssueBrief: {
      type: String,
      trim: true,
      required: [true, "Please enter a brief description of the issue"],
    },
    interventionAction: {
      type: String,
      trim: true,
      default: "Not Solved",
    },
    department: {
      type: String,
      trim: true,
    },
    suggestedActionable: {
      type: String,
      trim: true,
    },
    facilitatorNumber: {
      type: String,
      trim: true,
    },
    facilitatorName: {
      type: String,
      trim: true,
    },
    leaderNumber: {
      type: String,
      trim: true,
    },
    leaderName: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      trim: true,
      required: [true, "Please select a Category"],
    },
  },
  { timestamps: true }
);

// Pre-save hook to fetch and set zone and boothType from AcData
interventionDataSchema.pre("save", async function (next) {
  try {
    // Fetch data from AcData
    const acData = await AcData.findOne({ booth: this.booth });
    if (acData) {
      if (acData.zone) this.zone = acData.zone; // Set zone
      if (acData.pc) this.pc = acData.pc; // Set boothType
    }

    next();
  } catch (error) {
    next(error);
  }
});

const InterventionData = mongoose.model("interventionData", interventionDataSchema);

module.exports = InterventionData;
