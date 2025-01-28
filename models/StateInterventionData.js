const mongoose = require("mongoose");
const { Schema } = mongoose;
const Booths = require("../models/BoothList");

const stateInterventionDataSchema = new mongoose.Schema(
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
    district: {
      type: String,
      trim: true,
    },
    constituency: {
      type: String,
      required: [true, "Please select a Constituency"],
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
    category: {
      type: String,
      trim: true,
      required: [true, "Please select a Category"],
    },
  },
  { timestamps: true }
);

// Pre-save hook to fetch and set `zone` and `district` from `Booths`
stateInterventionDataSchema.pre("save", async function (next) {
  try {
    // Fetch data from Booths based on constituency
    const stateData = await Booths.findOne({ constituency: this.constituency });
    if (stateData) {
      this.zone = stateData.zone; // Set `zone` from Booths
      this.district = stateData.district; // Set `district` from Booths
    }

    next();
  } catch (error) {
    next(error); // Pass error to the next middleware
  }
});

const StateInterventionData = mongoose.model("StateInterventionData", stateInterventionDataSchema);

module.exports = StateInterventionData;
