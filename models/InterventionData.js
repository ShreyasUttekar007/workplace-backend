const mongoose = require("mongoose");
const { Schema } = mongoose;
const BmcMapping = require("../models/BmcMapping");

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
      required: [true, "Please select an Intervention Type"],
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
    rework: {
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

// Pre-save hook to fetch and set `zone` and `pc` from `BmcMapping`
interventionDataSchema.pre("save", async function (next) {
  try {
    // Fetch data from BmcMapping based on constituency
    const bmcData = await BmcMapping.findOne({ constituency: this.constituency });
    if (bmcData) {
      this.zone = bmcData.zone; // Set `zone` from BmcMapping
      this.pc = bmcData.pc; // Set `pc` from BmcMapping
    }

    next();
  } catch (error) {
    next(error); // Pass error to the next middleware
  }
});

const InterventionData = mongoose.model("InterventionData", interventionDataSchema);

module.exports = InterventionData;
