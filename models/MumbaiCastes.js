const mongoose = require("mongoose");
const { Schema } = mongoose;

const MumbaiCasteSchema = new Schema(
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
      trim: true,
    },
    district: {
      type: String,
      trim: true,
    },
    pc: {
      type: String,
      trim: true,
    },
    ward: {
      type: String,
      trim: true,
    },
    constituency: {
      type: String,
      required: [true, "Please select a Constituency"],
      trim: true,
    },
    percentage: {
      type: String,
      required: [true, "Please enter Leader's Percentage"],
      trim: true,
    },
    community: {
      type: String,
      required: [true, "Please enter Caste"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Please enter Category"],
      trim: true,
    },
    voters: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

MumbaiCasteSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const MumbaiCaste = mongoose.model("MumbaiCaste", MumbaiCasteSchema);

module.exports = MumbaiCaste;
