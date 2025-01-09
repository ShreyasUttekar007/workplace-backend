const mongoose = require("mongoose");
const { Schema } = mongoose;

const MomSchema = new Schema(
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
    leaderName: {
      type: String,
      required: [true, "Please enter Leader's Name"],
      trim: true,
    },
    dom: {
      type: String,
      required: [true, "Please enter Dom"],
      trim: true,
    },
    designation: {
      type: String,
      required: [true, "Please enter Designation"],
      trim: true,
    },
    partyName: {
      type: String,
      required: [true, "Please enter a Party Name"],
      trim: true,
    },
    remarks: {
      type: String,
      required: [true, "Please select a Party Name"],
      trim: true,
    },
    tags: {
      type: [String],
      trim: true,
    },
    photo: {
      type: String,
    },
    document: {
      type: String,
    },
  },
  { timestamps: true }
);

MomSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    console.log("User Email:", this.userId.email);
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Mom = mongoose.model("Mom", MomSchema);

module.exports = Mom;
