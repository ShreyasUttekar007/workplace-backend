const mongoose = require("mongoose");
const { Schema } = mongoose;

const GattSchema = new Schema(
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

GattSchema.pre("save", async function () {
  try {
    await this.populate("userId", "email").execPopulate();
    
  } catch (error) {
    console.error("Error during population:", error);
  }
});

const Gatt = mongoose.model("Gatt", GattSchema);

module.exports = Gatt;
