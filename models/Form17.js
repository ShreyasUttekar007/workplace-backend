const mongoose = require("mongoose");
const { Schema } = mongoose;

const Form17Schema = new Schema(
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
    formDocument17: {
      type: String,
    },
  },
  { timestamps: true }
);

Form17Schema.pre("save", async function () {
  try {
    await this.populate("userId", "email");
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Form17 = mongoose.model("Form17", Form17Schema);

module.exports = Form17;
