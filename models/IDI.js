const mongoose = require("mongoose");
const { Schema } = mongoose;

const IdISchema = new Schema(
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
    respondentName: {
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
    contact: {
      type: String,
      required: [true, "Please enter a Contact Number"],
      trim: true,
    },
    document: {
      type: String,
    },
  },
  { timestamps: true }
);

IdISchema.pre("save", async function () {
  try {
    await this.populate("userId", "email");
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const IdI = mongoose.model("IdI", IdISchema);

module.exports = IdI;
