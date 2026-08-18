const mongoose = require("mongoose");
const { Schema } = mongoose;
const YNM = { type: String, trim: true, default: "" };

const PunjabBoothDetailsSchema = new Schema(
  {
    district: { type: String, trim: true },
    ac: { type: String, trim: true },
    acNo: { type: Number, index: true },
    partNo: { type: Number },
    partRaw: { type: String, trim: true },

    voterListReceivedAtOffice: YNM,
    voterListDistributed: YNM,
    casteCensusStatus: YNM,
    voterListReceived: YNM,
    boothPradhanAppointed: YNM,
    womenBoothPradhanAppointed: YNM,
    scBoothPradhanAppointed: YNM,
    bcBoothPradhanAppointed: YNM,
    youthBoothPradhanAppointed: YNM,
    committee11Formed: YNM,
    circleInchargeMapped: YNM,

    circleInchargeName: { type: String, trim: true, default: "" },
    boothPocName: { type: String, trim: true, default: "" },
    remark: { type: String, trim: true, default: "" },

    status: { type: String, trim: true, default: "draft" },
    filledByEmail: { type: String, trim: true, default: "" },
    filledByName: { type: String, trim: true, default: "" },
    submittedAt: { type: Date },
  },
  { timestamps: true }
);
PunjabBoothDetailsSchema.index({ acNo: 1, partNo: 1 }, { unique: true });

module.exports = mongoose.model("PunjabBoothDetails", PunjabBoothDetailsSchema);
