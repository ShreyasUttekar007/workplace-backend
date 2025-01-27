const mongoose = require("mongoose");
const { Schema } = mongoose;

const Form20Schema = new Schema(
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
    document: {
      type: String,
    },
  },
  { timestamps: true }
);

Form20Schema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Form20 = mongoose.model("Form20", Form20Schema);

module.exports = Form20;
