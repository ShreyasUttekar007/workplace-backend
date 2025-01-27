const mongoose = require("mongoose");
const { Schema } = mongoose;

const CasteSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
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
    caste: {
      type: String,
      required: [true, "Please enter Caste"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Please enter Category"],
      trim: true,
    },
  },
  { timestamps: true }
);

CasteSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Caste = mongoose.model("Caste", CasteSchema);

module.exports = Caste;
