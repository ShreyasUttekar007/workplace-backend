const mongoose = require("mongoose");
const { Schema } = mongoose;

const MediaScanSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    constituency: {
      type: String,
      required: [true, "Please select a Constituency"],
      trim: true,
    },
    organization:{
      type: String,
    },
    organizationName:{
      type: String,
    },
    headline: {
      type: String,
    },
    summary: {
      type: String,
    },
    source: {
      type: String,
    },
    link: {
      type: String,
    },
    sentiment: {
      type: String,
    },
  },
  { timestamps: true }
);

MediaScanSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    console.log("User Email:", this.userId.email);
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const MediaScan = mongoose.model("MediaScan", MediaScanSchema);

module.exports = MediaScan;
