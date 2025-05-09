const mongoose = require("mongoose");
const { Schema } = mongoose;

const AcReportSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    state: {
      type: String,
      trim: true,
    },
    zone: {
      type: String,
      required: [true, "Please select a Zone"],
      trim: true,
    },
    district: {
      type: String,
      required: [true, "Please select a District"],
      trim: true,
    },
    pc: {
      type: String,
      required: [true, "Please select a pc"],
      trim: true,
    },
    constituency: {
      type: String,
      required: [true, "Please select a Constituency"],
      trim: true,
    },
    document: {
      type: String,
    },
    form20Document: {
      type: String,
    },
    boothReport: {
      type: String,
    },
    pcMom: {
      type: String,
    },
  },
  { timestamps: true }
);

AcReportSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Report = mongoose.model("Report", AcReportSchema);

module.exports = Report;
