const mongoose = require("mongoose");
const { Schema } = mongoose;

const PunjabBoothListSchema = new Schema(
  {
    district: { type: String, trim: true },
    ac: { type: String, trim: true },
    acNo: { type: Number, index: true },
    partNo: { type: Number },
    partName: { type: String, trim: true },
    partRaw: { type: String, trim: true },
  },
  { timestamps: true }
);
PunjabBoothListSchema.index({ acNo: 1, partNo: 1 }, { unique: true });

module.exports = mongoose.model("PunjabBoothList", PunjabBoothListSchema);
